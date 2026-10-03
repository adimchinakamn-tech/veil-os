/**
 * Veil — the owner password, centralized.
 *
 * Every password gate (Veil AI chat, feed posting, app deletes,
 * dev-request ops, the owner-password API itself) checks through here so
 * ONE change (Updates → Owner Mode → Password) applies everywhere.
 *
 * Storage: the `OwnerSecret` KV row "owner-password" holds an scrypt hash
 * ("salt:hex"). NO row = the built-in password. The row is read through a
 * 15s in-process cache — password-gated routes are rare, and a change
 * invalidates it immediately.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import { db } from "@/lib/db"

/* The default owner password (used only while no OwnerSecret row exists).
 *
 * DEV sandbox: the built-in legacy default keeps working.
 * PRODUCTION: the password comes from OWNER_DEFAULT_PASSWORD — deploy/boot
 * generates one into the volume (deploy/start.sh) so a public repo can
 * never leak owner access to someone else's deployment. */
const DEV_DEFAULT_PASSWORD = "T@@OTgs45+HAPP"
function defaultPassword(): string {
  const fromEnv = process.env.OWNER_DEFAULT_PASSWORD
  if (fromEnv) return fromEnv
  if (process.env.NODE_ENV === "production") {
    // Production without a configured password: refuse rather than fall
    // back to a value that ships in the repo (fail closed — the owner sets
    // a real password via env/first-boot generation).
    return randomBytes(24).toString("base64url")
  }
  return DEV_DEFAULT_PASSWORD
}
const SETTING_KEY = "owner-password"

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 100

/* scrypt params — N=16384 (2^14), r=8, p=1, 32-byte key. Cheap enough for
 * the rare gated request, strong enough for a hobby-site owner password. */
const SCRYPT = { N: 16384, r: 8, p: 1 } as const

function hashPassword(pw: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(pw, salt, 32, SCRYPT)
  return `${salt.toString("hex")}:${key.toString("hex")}`
}

function verifyHash(pw: string, stored: string): boolean {
  const [saltHex, keyHex] = stored.split(":")
  if (!saltHex || !keyHex) return false
  try {
    const salt = Buffer.from(saltHex, "hex")
    const expect = Buffer.from(keyHex, "hex")
    if (expect.length !== 32) return false
    const got = scryptSync(pw, salt, expect.length, SCRYPT)
    return timingSafeEqual(expect, got)
  } catch {
    return false
  }
}

let cache: { at: number; hash: string | null } | null = null
const CACHE_MS = 15_000

async function currentHash(): Promise<string | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.hash
  let hash: string | null = null
  try {
    const row = await db.ownerSecret.findUnique({ where: { key: SETTING_KEY } })
    hash = row?.value ?? null
  } catch {
    /* DB hiccup — fall back to the last known value (or default) */
    hash = cache?.hash ?? null
  }
  cache = { at: Date.now(), hash }
  return hash
}

/** Timing-safe owner password check — the ONE gate every route uses. */
export async function ownerPasswordOk(p: unknown): Promise<boolean> {
  if (typeof p !== "string" || !p) return false
  const hash = await currentHash()
  if (hash) return verifyHash(p, hash)
  /* no custom password set — the default, compared in constant time */
  const a = Buffer.from(defaultPassword(), "utf8")
  const b = Buffer.from(p, "utf8")
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Change the owner password. `current` must be the valid (old) one. */
export async function setOwnerPassword(
  current: unknown,
  next: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const okCurrent = await ownerPasswordOk(current)
  if (!okCurrent) return { ok: false, error: "Current password is wrong." }
  if (typeof next !== "string" || next.length < PASSWORD_MIN) {
    return { ok: false, error: `New password must be at least ${PASSWORD_MIN} characters.` }
  }
  if (next.length > PASSWORD_MAX) {
    return { ok: false, error: `New password must be at most ${PASSWORD_MAX} characters.` }
  }
  if (next === current) {
    return { ok: false, error: "New password is the same as the old one." }
  }
  const value = hashPassword(next)
  await db.ownerSecret.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value },
    update: { value },
  })
  cache = null
  return { ok: true }
}

/** Drop the custom password back to the built-in (owner-initiated reset). */
export async function resetOwnerPassword(current: unknown): Promise<{ ok: boolean; error?: string }> {
  const okCurrent = await ownerPasswordOk(current)
  if (!okCurrent) return { ok: false, error: "Current password is wrong." }
  await db.ownerSecret.deleteMany({ where: { key: SETTING_KEY } })
  cache = null
  return { ok: true }
}
