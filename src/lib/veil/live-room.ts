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

/* The live room lives on the `presence` branch (chat writes never touch
 * main, so the FTP/Pages/Vercel deploy pipelines don't re-run per
 * message). The legacy lane on `main` is merged on every read — pages
 * built before the branch move and stale Vercel builds still read/write
 * main, and their users + messages must survive the union. */
const REPO = { owner: "ok5678765s", repo: "veil-os", branch: "presence", file: "site/data/chat-live.json" }
const LEGACY_BRANCH = "main"
const API_FILE = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/${REPO.file}`
const CDN_FILE = `https://cdn.jsdelivr.net/gh/${REPO.owner}/${REPO.repo}@${REPO.branch}/${REPO.file}`
const CDN_FILE_LEGACY = `https://cdn.jsdelivr.net/gh/${REPO.owner}/${REPO.repo}@${LEGACY_BRANCH}/${REPO.file}`
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

async function readCdnLane(url: string): Promise<LiveRoom | null> {
  try {
    const res = await fetch(`${url}?t=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    return parseRoom(await res.text())
  } catch {
    return null
  }
}

/* Union of both lanes — users by freshest lastSeen (passwords and
 * createdAt carried over when the legacy copy is newer), messages by
 * id, ordered by createdAt. Mirrors live.js mergeRooms exactly so
 * both sides always agree on the merged state. The room keeps a
 * rolling window of the latest 100 messages (the 101st message deletes
 * the 1st — user-requested cap). */
const ROOM_MAX_MESSAGES = 100
function mergeRooms(primary: LiveRoom, legacy: LiveRoom | null | undefined): LiveRoom {
  const out: LiveRoom = {
    users: { ...(primary.users ?? {}) },
    messages: [...(primary.messages ?? [])],
    updatedAt: primary.updatedAt,
  }
  if (!legacy?.users) return out
  for (const [k, lu] of Object.entries(legacy.users)) {
    if (!lu || typeof lu !== "object") continue
    const cur = out.users[k]
    if (!cur) {
      out.users[k] = lu
      continue
    }
    const ct = Date.parse(cur.lastSeen ?? "") || 0
    const lt = Date.parse(lu.lastSeen ?? "") || 0
    if (lt > ct) {
      if (!lu.pw && cur.pw) lu.pw = cur.pw
      if (!lu.createdAt && cur.createdAt) lu.createdAt = cur.createdAt
      out.users[k] = lu
    }
  }
  const seen = new Set<string>()
  const msgs: LiveMessage[] = []
  for (const m of [...out.messages, ...(legacy.messages ?? [])]) {
    if (m?.id && !seen.has(m.id)) {
      seen.add(m.id)
      msgs.push(m)
    }
  }
  msgs.sort((a, b) => (Date.parse(a.createdAt ?? "") || 0) - (Date.parse(b.createdAt ?? "") || 0))
  out.messages = msgs.slice(-ROOM_MAX_MESSAGES)
  return out
}

/** The shared room, freshest copy available. Cached briefly so presence
 * beats and chat polls don't hammer anything. */
export async function readLiveRoom(force = false): Promise<LiveRoom> {
  if (!force && readCache && Date.now() - readCache.at < READ_TTL) return readCache.room
  /* both CDN lanes in parallel, merged — presence is the live source,
   * main is the legacy lane old builds still write to */
  const [p, l] = await Promise.all([readCdnLane(CDN_FILE), readCdnLane(CDN_FILE_LEGACY)])
  let room: LiveRoom | null = p || l ? mergeRooms(p ?? EMPTY_ROOM, l) : null
  if (!room || Object.keys(room.users).length === 0) {
    /* CDN dark (offline box / jsDelivr hiccup) — the working-tree copy
     * of main's file is a last-resort legacy lane */
    const local = readLocalFile()
    if (local && Object.keys(local.users).length > 0) {
      room = mergeRooms(p ?? EMPTY_ROOM, local)
    }
  }
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
      /* head + legacy lane in parallel: the sha MUST be the presence
       * branch's (writes land there), and the legacy lane is merged in
       * so a ban/delete also covers users that only exist on main */
      const [head, legacy] = await Promise.all([
        fetch(`${API_FILE}?ref=${REPO.branch}&t=${Date.now()}`, {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "user-agent": "veil-os-live-bridge",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        }),
        readCdnLane(CDN_FILE_LEGACY),
      ])
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
      room = mergeRooms(room, legacy)

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

/** Edit a live-room message (the author only — username must match).
 * Content is replaced and editedAt stamped so every surface renders the
 * "(edited)" marker. Returns the patched message when it worked. */
export async function liveEditMessage(
  messageId: string,
  username: string,
  content: string,
): Promise<LiveMessage | null> {
  const key = (username || "").toLowerCase()
  let hit: LiveMessage | null = null
  await writeLiveRoom((room) => {
    const m = room.messages.find(
      (x) => x.id === messageId && (x.username || "").toLowerCase() === key,
    )
    if (!m) return
    m.content = content
    m.editedAt = new Date().toISOString()
    hit = m
    room.updatedAt = new Date().toISOString()
    room.messages = room.messages.slice(-ROOM_MAX_MESSAGES)
  })
  return hit
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
