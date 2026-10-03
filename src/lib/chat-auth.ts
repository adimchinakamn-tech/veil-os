import { createHmac, timingSafeEqual } from "crypto"
import { readFileSync } from "fs"
import { db } from "@/lib/db"

/**
 * Session tokens are HMAC-SHA256 signed: base64url(payloadJSON) + "." + sig.
 * The payload carries the account's identity snapshot (id, username, display
 * name, avatar, role) so the realtime relay (mini-services/chat-service — a
 * separate process that cannot touch the DB) can trust the identity WITHOUT
 * any client-claimed fields. The signing secret lives in db/chat-secret.key,
 * shared with the relay (same box, mode 0600).
 *
 * This replaced the old base64(accountId) token, which was trivially
 * forgeable (anyone who saw an account id — e.g. from a presence broadcast —
 * could mint a working "token" for it, including the admin's).
 */

export type SessionPayload = {
  id: string
  username: string
  displayName: string
  avatarColor: string
  avatarImage: string | null
  role: "member" | "moderator" | "admin"
  iat: number
  exp: number // epoch ms — 30 days
}

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

let cachedSecret: Buffer | null = null
function sessionSecret(): Buffer {
  if (cachedSecret) return cachedSecret
  cachedSecret = Buffer.from(
    readFileSync("/home/z/my-project/db/chat-secret.key", "utf-8").trim(),
    "utf-8",
  )
  return cachedSecret
}

function b64url(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64url")
}

function fromB64url(s: string): string {
  return Buffer.from(s, "base64url").toString("utf-8")
}

function sign(data: string): string {
  return createHmac("sha256", sessionSecret()).update(data).digest("base64url")
}

export function makeToken(a: {
  id: string
  username: string
  displayName: string
  avatarColor: string
  avatarImage: string | null
  role: string
}): string {
  const payload: SessionPayload = {
    id: a.id,
    username: a.username,
    displayName: a.displayName,
    avatarColor: a.avatarColor,
    avatarImage: a.avatarImage,
    role: ("member moderator admin".split(" ").includes(a.role)
      ? a.role
      : "member") as SessionPayload["role"],
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS,
  }
  const body = b64url(JSON.stringify(payload))
  return body + "." + sign(body)
}

/** Verify a token's signature + expiry. Returns the account id, or null for
 *  any bad/legacy/expired token. Old base64 tokens fail here by design. */
export function parseToken(token: string | undefined | null): string | null {
  const p = verifySessionToken(token)
  return p ? p.id : null
}

/** Full-payload verification (signature + expiry). Shared format with the
 *  chat relay, which re-implements the same HMAC check locally. */
export function verifySessionToken(
  token: string | undefined | null,
): SessionPayload | null {
  if (!token || typeof token !== "string") return null
  const parts = token.split(".")
  if (parts.length !== 2) return null
  const [body, sig] = parts
  if (!body || !sig) return null
  let expected: string
  try {
    expected = sign(body)
  } catch {
    return null
  }
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(fromB64url(body)) as SessionPayload
    if (!payload || typeof payload.id !== "string" || !payload.id) return null
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null
    if (typeof payload.username !== "string" || !payload.username) return null
    return payload
  } catch {
    return null
  }
}

export type ChatAccountPublic = {
  id: string
  username: string
  displayName: string
  avatarColor: string
  avatarImage: string | null
  bio: string
  role: "member" | "moderator" | "admin"
  muted: boolean
  banned: boolean
  banReason: string | null
  ipBanned: boolean
  coins: number
  tag: string | null
  tagColor: string | null
  pfpAccessory: string | null
  createdAt: Date
}

export function toPublicAccount(a: {
  id: string
  username: string
  displayName: string
  avatarColor: string
  avatarImage: string | null
  bio: string
  role: string
  muted: boolean
  banned: boolean
  banReason: string | null
  ipBanned: boolean
  coins: number
  tag?: string | null
  tagColor?: string | null
  pfpAccessory?: string | null
  createdAt: Date
}): ChatAccountPublic {
  return {
    id: a.id,
    username: a.username,
    displayName: a.displayName,
    avatarColor: a.avatarColor,
    avatarImage: a.avatarImage,
    bio: a.bio,
    role: (["member", "moderator", "admin"].includes(a.role)
      ? a.role
      : "member") as ChatAccountPublic["role"],
    muted: a.muted,
    banned: a.banned,
    banReason: a.banReason,
    ipBanned: a.ipBanned,
    coins: typeof a.coins === "number" ? a.coins : 0,
    tag: a.tag ?? null,
    tagColor: a.tagColor ?? null,
    pfpAccessory: a.pfpAccessory ?? null,
    createdAt: a.createdAt,
  }
}

// Returns the account row (full) or null if token invalid/banned.
// Role/mute state is ALWAYS re-read from the DB here (token role is only a
// snapshot for the realtime relay — never a privilege source for APIs).
export async function getAccountFromToken(
  token: string | undefined | null,
) {
  const id = parseToken(token)
  if (!id) return null
  const account = await db.chatAccount.findUnique({ where: { id } })
  if (!account) return null
  if (account.banned || account.ipBanned) return null
  return account
}
