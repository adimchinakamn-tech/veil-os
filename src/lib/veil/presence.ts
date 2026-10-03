/**
 * Veil presence — the site-wide "who's online" hub.
 *
 * Every open Veil tab heartbeats to /api/presence every ~15s. A heartbeat
 * carries the visitor's chat account when one is signed in (read fresh
 * from localStorage each beat, so login/logout is picked up immediately).
 * Entries expire after PRESENCE_TTL without a beat.
 *
 * The hub is a module-level singleton: it lives as long as the dev
 * server process (same pattern as the updates feed cache). Presence is
 * intentionally ephemeral — nothing is persisted to the database.
 */

export interface PresenceAccount {
  accountId: string
  username: string
  displayName: string
  avatarColor: string
  avatarImage: string | null
}

export interface PresenceUser extends PresenceAccount {
  /** Most recent heartbeat, epoch ms. */
  lastSeen: number
}

export interface PresenceSnapshot {
  /** Unique visitors online (accounts + guests). */
  total: number
  /** Visitors without a signed-in chat account. */
  guests: number
  /** Signed-in users, deduped by accountId, freshest data wins. */
  users: PresenceUser[]
  ts: number
}

/** How long a visitor stays "online" after its last heartbeat. 75s
 * tolerates background-tab timer throttling (~1 beat/min) without
 * flapping, while still clearing people who actually left. */
export const PRESENCE_TTL_MS = 75_000
/** Cap on tracked visitors — a defensive ceiling, not a real limit. */
const MAX_VISITORS = 5_000

interface Visitor extends Partial<PresenceAccount> {
  lastSeen: number
}

// visitorId (the veil_vid cookie) -> heartbeat record
const visitors = new Map<string, Visitor>()

function safeAccount(raw: unknown): PresenceAccount | null {
  if (!raw || typeof raw !== "object") return null
  const a = raw as Record<string, unknown>
  const accountId = typeof a.accountId === "string" ? a.accountId.trim() : ""
  const username = typeof a.username === "string" ? a.username.trim() : ""
  if (!accountId || !username) return null
  const displayName =
    typeof a.displayName === "string" && a.displayName.trim()
      ? a.displayName.trim().slice(0, 48)
      : username.slice(0, 32)
  let avatarImage: string | null = null
  if (typeof a.avatarImage === "string") {
    const s = a.avatarImage.slice(0, 2048)
    // Only same-origin paths, data: images and plain http(s) URLs —
    // never anything script-y.
    if (/^(\/|data:image\/|https?:\/\/)/i.test(s)) avatarImage = s
  }
  let avatarColor = typeof a.avatarColor === "string" ? a.avatarColor.trim() : ""
  if (!/^#[0-9a-f]{3,8}$/i.test(avatarColor)) avatarColor = "#f97316"
  return {
    accountId: accountId.slice(0, 64),
    username: username.slice(0, 32),
    displayName,
    avatarColor,
    avatarImage,
  }
}

/** Record a heartbeat. Returns the fresh snapshot. */
export function touchPresence(visitorId: string, rawAccount: unknown): PresenceSnapshot {
  const now = Date.now()
  const account = safeAccount(rawAccount)
  const prev = visitors.get(visitorId)
  const entry: Visitor = {
    lastSeen: now,
    // An account is sticky per visitor: once signed in, a beat without
    // account data (e.g. a race right after logout) still shows the
    // previous identity only while it stays fresh — the explicit
    // `account: null` clear happens below.
    ...(account ? { ...account } : (prev ?? {})),
  }
  if (account === null && rawAccount === null) {
    // Explicit "no account" beat — drop any stale identity (the user
    // signed out since the last beat).
    delete entry.accountId
    delete entry.username
    delete entry.displayName
    delete entry.avatarColor
    delete entry.avatarImage
  }
  visitors.set(visitorId, entry)
  if (visitors.size > MAX_VISITORS) {
    // Trim the oldest entries if something pathological happens.
    const byAge = [...visitors.entries()].sort((x, y) => x[1].lastSeen - y[1].lastSeen)
    for (const [id] of byAge.slice(0, visitors.size - MAX_VISITORS)) visitors.delete(id)
  }
  return getPresence(now)
}

/** Prune expired entries and build the public snapshot. */
export function getPresence(now = Date.now()): PresenceSnapshot {
  const users = new Map<string, PresenceUser>()
  let total = 0
  let guests = 0
  for (const [id, v] of visitors) {
    if (now - v.lastSeen > PRESENCE_TTL_MS) {
      visitors.delete(id)
      continue
    }
    total++
    if (v.accountId && v.username) {
      const existing = users.get(v.accountId)
      if (!existing || v.lastSeen > existing.lastSeen) {
        users.set(v.accountId, {
          accountId: v.accountId,
          username: v.username,
          displayName: v.displayName || v.username,
          avatarColor: v.avatarColor || "#f97316",
          avatarImage: v.avatarImage ?? null,
          lastSeen: v.lastSeen,
        })
      }
    } else {
      guests++
    }
  }
  const list = [...users.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  )
  return { total, guests, users: list, ts: now }
}
