/**
 * Veil — server-side bridge to the git version's shared chat room
 * (site/data/chat-live.json on GitHub, written by the CDN copies'
 * live.js through the Contents API).
 *
 * Until now the bridge was one-directional (website → git via the
 * backup loop). This module completes it in the other direction so the
 * two chats are ONE room:
 *   - reads (local file first — the backup loop refreshes it from
 *     origin/main every 30s; jsDelivr as fallback) power /api/chat-live
 *     and the shared presence count
 *   - writes (GitHub Contents API PUT with sha + 409 retries, then a
 *     jsDelivr purge — the exact protocol live.js speaks) power
 *     moderation: deleting a git message or banning a git user from the
 *     WEBSITE rewrites the shared file every CDN copy reads.
 */

import { readFileSync, existsSync } from "fs"
import { execSync } from "child_process"
import path from "path"

export interface LiveMessage {
  id: string
  username: string
  content: string
  createdAt: string
  editedAt?: string
}

export interface LiveUser {
  username: string
  displayName?: string
  avatarColor?: string
  pw?: string
  createdAt?: string
  lastSeen?: string
  role?: string
  banned?: boolean
  banReason?: string | null
  muted?: boolean
}

export interface LiveRoom {
  users: Record<string, LiveUser>
  messages: LiveMessage[]
  updatedAt?: string
}

const REPO = { owner: "ok5678765s", repo: "veil-os", branch: "main", file: "site/data/chat-live.json" }
const API_FILE = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/${REPO.file}`
const CDN_FILE = `https://cdn.jsdelivr.net/gh/${REPO.owner}/${REPO.repo}@${REPO.branch}/${REPO.file}`
const PURGE_FILE = `https://purge.jsdelivr.net/gh/${REPO.owner}/${REPO.repo}@${REPO.branch}/${REPO.file}`

const EMPTY_ROOM: LiveRoom = { users: {}, messages: [] }

/* ------------------------------------------------------------------ */
/* reads                                                                */
/* ------------------------------------------------------------------ */

let readCache: { at: number; room: LiveRoom } | null = null
const READ_TTL = 15_000

function parseRoom(text: string): LiveRoom {
  try {
    const raw = JSON.parse(text) as Partial<LiveRoom>
    return {
      users: raw.users && typeof raw.users === "object" ? raw.users : {},
      messages: Array.isArray(raw.messages) ? raw.messages : [],
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
    }
  } catch {
    return EMPTY_ROOM
  }
}

function readLocalFile(): LiveRoom | null {
  try {
    const p = path.join(process.cwd(), "site", "data", "chat-live.json")
    if (!existsSync(p)) return null
    return parseRoom(readFileSync(p, "utf-8"))
  } catch {
    return null
  }
}

async function readCdn(): Promise<LiveRoom | null> {
  try {
    const res = await fetch(`${CDN_FILE}?t=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    return parseRoom(await res.text())
  } catch {
    return null
  }
}

/** The shared room, freshest copy available. Cached briefly so presence
 * beats and chat polls don't hammer anything. */
export async function readLiveRoom(force = false): Promise<LiveRoom> {
  if (!force && readCache && Date.now() - readCache.at < READ_TTL) return readCache.room
  let room = readLocalFile()
  if (!room || Object.keys(room.users).length === 0) room = await readCdn()
  room = room ?? EMPTY_ROOM
  readCache = { at: Date.now(), room }
  return room
}

/** Users active in the live room within the presence window (4 min,
 * the same window live.js uses). */
export async function liveRoomActiveUsers(windowMs = 4 * 60_000): Promise<LiveUser[]> {
  const room = await readLiveRoom()
  const now = Date.now()
  const out: LiveUser[] = []
  for (const u of Object.values(room.users)) {
    if (!u?.username || u.banned) continue
    const seen = u.lastSeen ? Date.parse(u.lastSeen) : 0
    if (seen && now - seen < windowMs) out.push(u)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* writes — the live.js protocol, server-side                          */
/* ------------------------------------------------------------------ */

function ghToken(): string {
  try {
    const p = path.join(process.cwd(), "tmp", "gh-token.txt")
    if (existsSync(p)) {
      const t = readFileSync(p, "utf-8").trim()
      if (t) return t
    }
  } catch {
    /* no token file */
  }
  try {
    const creds = readFileSync(`${process.env.HOME || "/home/z"}/.git-credentials`, "utf-8")
    const m = /https:\/\/[^:]*:([^@]+)@github\.com/.exec(creds)
    if (m) return m[1].trim()
  } catch {
    /* no stored credentials */
  }
  return ""
}

async function purgeCdn(): Promise<void> {
  try {
    await fetch(PURGE_FILE, { method: "POST", signal: AbortSignal.timeout(5000) })
  } catch {
    /* purge is best-effort — jsDelivr's 7-day browser cache still ages
     * out, and the local file + latest.json are the fresher sources */
  }
}

/** Mutate the shared room through the GitHub Contents API (PUT with the
 * current sha, retrying on 409 conflicts — browsers race us the same
 * way live.js does). Throws when no token is available or the write
 * exhausts its retries. */
export async function writeLiveRoom(mutator: (room: LiveRoom) => void): Promise<LiveRoom> {
  const token = ghToken()
  if (!token) throw new Error("no GitHub token available for the live room")

  let lastErr: unknown = null
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const head = await fetch(API_FILE, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "user-agent": "veil-os-live-bridge",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      })
      if (!head.ok) throw new Error(`contents fetch ${head.status}`)
      const meta = (await head.json()) as { sha?: string; content?: string }
      if (!meta.sha) throw new Error("contents fetch carried no sha")

      let room: LiveRoom
      try {
        const decoded = Buffer.from(meta.content ?? "", "base64").toString("utf-8")
        room = parseRoom(decoded)
      } catch {
        room = EMPTY_ROOM
      }

      mutator(room)

      const body = {
        message: "veil: live room update from the website",
        content: Buffer.from(JSON.stringify(room), "utf-8").toString("base64"),
        sha: meta.sha,
        branch: REPO.branch,
      }
      const put = await fetch(API_FILE, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
          "user-agent": "veil-os-live-bridge",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      })
      if (put.status === 409) {
        lastErr = new Error("conflict (409)")
        continue /* someone else wrote first — refetch and re-apply */
      }
      if (!put.ok) throw new Error(`contents put ${put.status}`)
      readCache = null /* force the next read to see the new state */
      void purgeCdn()
      return room
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("live room write failed")
}

/** Remove a message by id from the shared room. Returns true when it was
 * there (and is now gone). */
export async function liveDeleteMessage(messageId: string): Promise<boolean> {
  let removed = false
  await writeLiveRoom((room) => {
    const before = room.messages.length
    room.messages = room.messages.filter((m) => m.id !== messageId)
    removed = room.messages.length < before
    room.updatedAt = new Date().toISOString()
  })
  return removed
}

/** Ban (or mute, or lift) a live-room user by username — flags travel in
 * the shared file; live.js enforces them on login/send/heartbeat.
 * `purgeMessages` matches the website's ban semantics. */
export async function liveSetUserFlag(
  username: string,
  flag: "banned" | "muted",
  value: boolean,
  reason?: string,
  purgeMessages = false,
): Promise<LiveUser | null> {
  const key = username.toLowerCase()
  let target: LiveUser | null = null
  await writeLiveRoom((room) => {
    const u = room.users[key]
    if (!u) return
    target = u
    if (flag === "banned") {
      u.banned = value || undefined
      u.banReason = value ? reason ?? "banned by a moderator" : null
      if (value) u.muted = undefined
    } else {
      u.muted = value || undefined
    }
    if (purgeMessages && value) {
      room.messages = room.messages.filter((m) => (m.username || "").toLowerCase() !== key)
    }
    room.updatedAt = new Date().toISOString()
  })
  return target
}

/** Look up a live-room user by username (case-insensitive). */
export async function liveFindUser(username: string): Promise<LiveUser | null> {
  const room = await readLiveRoom(true)
  return room.users[username.toLowerCase()] ?? null
}
