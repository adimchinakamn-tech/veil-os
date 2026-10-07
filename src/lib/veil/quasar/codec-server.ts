/**
 * Quasar Server Codec — AES-256-GCM encrypted proxied URLs
 * --------------------------------------------------------
 * Server-only counterpart of codec.ts. Every URL the SERVER emits (rewritten
 * static assets, redirects, address-bar navigations via /api/codec) is
 * AES-256-GCM encrypted with a per-deployment key held in `.quasar-key`
 * (auto-generated on first boot, never shipped to browsers). Only the ORIGIN
 * is encrypted; the path stays readable so relative resolution keeps working:
 *
 *   https://en.wikipedia.org/wiki/Main_Page
 *     => /p/<aes-blob>/wiki/Main_Page
 *
 * v2.1.0 — the encrypted plaintext may carry a per-tab context suffix
 * ("~c=<container>~e=<egress>~u=<b64 ua>") that drives multi-account
 * containers, egress selection and UA overrides. Old blobs decode unchanged.
 *
 * Decoding accepts three blob formats (first byte of the raw payload):
 *   0x01 — AES-256-GCM (server-emitted, strongest)
 *   0x02 — session XOR (client-generated: hooks/SW can't run async WebCrypto
 *          in sync setters, so client URLs use a per-deployment rotated XOR
 *          secret that is at least never hardcoded in the repo)
 *   none — legacy XOR with the historical hardcoded "quasar-v1" secret
 *
 * SECURITY MODEL (honest threat statement): encryption hides target URLs from
 * passive observers — browser history, screenshots, logs, Referer headers.
 * It is NOT protection against the proxy's own users, who can always see the
 * pages they browse.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHmac } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve, dirname } from "node:path";
import { buildCodecSource } from "./codec";

/* ------------------------------------------------------------------ */
/* Key management                                                      */
/* ------------------------------------------------------------------ */

interface KeyFile {
  v: number;
  /** 32-byte AES-256 key, hex */
  aes: string;
  /** session-XOR secret, base64 (rotated per deployment, embedded in client bundles) */
  xor: string;
  /** salt for the optional password-gate HMAC, hex */
  salt: string;
}

const KEY_FILE_NAME = ".quasar-key";
let cachedKey: KeyFile | null = null;

/** Search upward for an existing key file (bridge mini-service has a nested cwd). */
function findKeyFile(): string | null {
  const env = process.env.QUASAR_KEY_FILE;
  if (env) return resolve(env);
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, KEY_FILE_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function ensureKey(): KeyFile {
  if (cachedKey) return cachedKey;
  const path = findKeyFile() ?? join(process.cwd(), KEY_FILE_NAME);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as KeyFile;
    if (
      parsed &&
      parsed.aes &&
      /^[0-9a-f]{64}$/.test(parsed.aes) &&
      parsed.xor &&
      parsed.salt
    ) {
      cachedKey = parsed;
      return parsed;
    }
  } catch {
    /* generate below */
  }
  const fresh: KeyFile = {
    v: 1,
    aes: randomBytes(32).toString("hex"),
    xor: randomBytes(24).toString("base64"),
    salt: randomBytes(16).toString("hex"),
  };
  try {
    // Exclusive create: with several server workers racing on cold boot,
    // exactly one key wins and everyone re-reads the same file — blobs from
    // one worker must never be undecodable for another.
    writeFileSync(path, JSON.stringify(fresh, null, 2), { mode: 0o600, flag: "wx" });
    cachedKey = fresh;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EEXIST") {
      // Another worker won the race — use their key.
      try {
        cachedKey = JSON.parse(readFileSync(path, "utf8")) as KeyFile;
        if (cachedKey && cachedKey.aes && cachedKey.xor && cachedKey.salt) return cachedKey;
      } catch {
        /* fall through to ephemeral */
      }
      console.error("[quasar] key file exists but is unreadable, using ephemeral key");
      cachedKey = fresh;
    } else {
      console.error("[quasar] could not persist key file, using ephemeral key:", err);
      cachedKey = fresh;
    }
  }
  return cachedKey;
}

/** The session-XOR secret as a plain string (embedded into client bundles). */
export function sessionXorSecret(): string {
  return Buffer.from(ensureKey().xor, "base64").toString("latin1");
}

/* ------------------------------------------------------------------ */
/* base64url helpers                                                   */
/* ------------------------------------------------------------------ */

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Buffer {
  let t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4 !== 0) t += "=";
  return Buffer.from(t, "base64");
}

function xorWith(bytes: Buffer, secret: string): Buffer {
  const key = Buffer.from(secret, "latin1");
  const out = Buffer.allocUnsafe(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ key[i % key.length];
  return out;
}

/* ------------------------------------------------------------------ */
/* Encoding (server-emitted URLs are always AES)                       */
/* ------------------------------------------------------------------ */

export function encodeOriginAes(origin: string, ctx?: string): string {
  const key = Buffer.from(ensureKey().aes, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plain = String(origin) + (ctx ? "~" + ctx : "");
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // payload = 0x01 || iv(12) || ct || tag(16)
  const payload = Buffer.concat([Buffer.from([0x01]), iv, ct, tag]);
  return b64url(payload);
}

/** Session-XOR blob (what client bundles produce — server must accept it). */
export function encodeOriginSession(origin: string): string {
  const payload = Buffer.concat([
    Buffer.from([0x02]),
    xorWith(Buffer.from(String(origin), "utf8"), sessionXorSecret()),
  ]);
  return b64url(payload);
}

/** Legacy hardcoded-secret blob (accepted for compatibility with old pages). */
export function encodeOriginLegacy(origin: string): string {
  return b64url(xorWith(Buffer.from(String(origin), "utf8"), "quasar-v1"));
}

/* ------------------------------------------------------------------ */
/* Decoding                                                            */
/* ------------------------------------------------------------------ */

function tryAes(payload: Buffer): string | null {
  try {
    if (payload.length < 30 || payload[0] !== 0x01) return null;
    const iv = payload.subarray(1, 13);
    const tag = payload.subarray(payload.length - 16);
    const ct = payload.subarray(13, payload.length - 16);
    const key = Buffer.from(ensureKey().aes, "hex");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    return out || null;
  } catch {
    return null;
  }
}

function xorBuf(buf: Buffer, secret: string): string {
  const key = Buffer.from(secret, "latin1");
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key[i % key.length];
  return out.toString("utf8");
}

/** URLs/origins are printable ASCII — used to reject wrong-key garbage. */
function printable(s: string): boolean {
  return !!s && s.length >= 4 && /^[!-~]+$/.test(s);
}

/**
 * Decode any supported blob with NO scheme validation (the ws-bridge uses
 * this for ws://|wss:// targets). Formats are told apart by their first
 * payload byte; unprefixed payloads try legacy first, then session XOR.
 * Returns null for undecodable input.
 */
export function decodeBlobRaw(blob: string): string | null {
  if (!blob || blob.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(blob)) return null;
  let payload: Buffer;
  try {
    payload = unb64url(blob);
  } catch {
    return null;
  }
  if (payload.length < 4 || payload.length > 2048) return null;

  if (payload[0] === 0x01) {
    const aes = tryAes(payload);
    if (aes && printable(aes)) return aes;
    return null; // tagged AES that fails auth is never a fallback candidate
  }
  if (payload[0] === 0x02) {
    const s = xorBuf(payload.subarray(1), sessionXorSecret());
    return printable(s) ? s : null;
  }
  // Unprefixed: legacy historical default first (most common), then session.
  const legacy = xorBuf(payload, "quasar-v1");
  if (printable(legacy)) return legacy;
  const session = xorBuf(payload, sessionXorSecret());
  if (printable(session)) return session;
  return null;
}

/** Decode a blob into an http(s) origin, or null. */
export function decodeOrigin(blob: string): string | null {
  const raw = decodeBlobRaw(blob);
  if (raw) {
    const origin = raw.split("~")[0] ?? raw;
    if (/^https?:\/\//.test(origin)) return origin;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* v2.1.0 — per-tab context (container / egress / UA override)          */
/* ------------------------------------------------------------------ */

export interface BlobCtx {
  /** Container id (multi-account isolation). "default" when absent. */
  container: string;
  /** Egress mode: undefined (auto), "direct" or "upstream". */
  egress?: "direct" | "upstream";
  /** User-Agent override (validated printable string). */
  ua?: string;
}

export const DEFAULT_CONTAINER = "default";

/** Per-request context as carried through to the fetcher (all optional). */
export interface RequestCtx {
  container?: string;
  egress?: "direct" | "upstream";
  ua?: string;
}

const CONTAINER_RE = /^[A-Za-z0-9_-]{1,40}$/;
const B64URL_RE = /^[A-Za-z0-9_-]{1,400}$/;

/** Build the canonical plaintext suffix for a context ("c=x~e=direct~u=..."). */
export function encodeCtxSuffix(ctx: Partial<Pick<BlobCtx, "container" | "egress" | "ua">>): string {
  const parts: string[] = [];
  if (ctx.container && ctx.container !== DEFAULT_CONTAINER && CONTAINER_RE.test(ctx.container)) {
    parts.push("c=" + ctx.container);
  }
  if (ctx.egress === "direct" || ctx.egress === "upstream") parts.push("e=" + ctx.egress);
  if (ctx.ua) {
    const b64 = Buffer.from(ctx.ua.slice(0, 300), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    if (B64URL_RE.test(b64)) parts.push("u=" + b64);
  }
  return parts.join("~");
}

/** Parse + strictly validate a plaintext suffix. Invalid pieces are dropped. */
export function parseCtxSuffix(suffix: string): BlobCtx {
  const ctx: BlobCtx = { container: DEFAULT_CONTAINER };
  if (!suffix) return ctx;
  for (const pair of suffix.split("~")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const k = pair.slice(0, eq);
    const v = pair.slice(eq + 1);
    if (k === "c" && CONTAINER_RE.test(v)) ctx.container = v;
    else if (k === "e" && (v === "direct" || v === "upstream")) ctx.egress = v;
    else if (k === "u" && B64URL_RE.test(v)) {
      try {
        let t = v.replace(/-/g, "+").replace(/_/g, "/");
        while (t.length % 4 !== 0) t += "=";
        const ua = Buffer.from(t, "base64").toString("utf8");
        // Header value safety: printable ASCII without CR/LF (header injection).
        if (ua && ua.length <= 300 && /^[\x20-\x7e]+$/.test(ua)) ctx.ua = ua;
      } catch {
        /* drop invalid ua */
      }
    }
  }
  return ctx;
}

/** Decode a blob into origin + parsed context (null when undecodable). */
export function decodeBlobFull(blob: string): (BlobCtx & { origin: string }) | null {
  const raw = decodeBlobRaw(blob);
  if (!raw) return null;
  const tilde = raw.indexOf("~");
  const origin = tilde === -1 ? raw : raw.slice(0, tilde);
  if (!/^https?:\/\//.test(origin)) return null;
  const ctx = parseCtxSuffix(tilde === -1 ? "" : raw.slice(tilde + 1));
  return { origin, ...ctx };
}

/* ------------------------------------------------------------------ */
/* Path helpers (server variants)                                      */
/* ------------------------------------------------------------------ */

const BLOB_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Convert an absolute http(s) URL into its encrypted proxied path.
 * `ctx` is an already-encoded plaintext suffix (encodeCtxSuffix output).
 */
export function proxyPath(url: string | URL, ctx?: string): string {
  const u = url instanceof URL ? url : new URL(url);
  return "/p/" + encodeOriginAes(u.origin, ctx) + u.pathname + u.search + u.hash;
}

/**
 * Parse a proxied pathname into target parts + per-tab context.
 * The special blob `!rel` resolves the rest-path against `refererHref` (a
 * full proxied href — the service worker uses this for escaped root-relative
 * requests because it cannot decrypt AES blobs itself). The referer's blob
 * also supplies the context for !rel requests, so containers survive
 * root-relative subresource loads.
 */
export function parseProxiedRequest(
  pathname: string,
  search = "",
  refererHref?: string | null
): { origin: string; rest: string; target: string; container: string; egress?: "direct" | "upstream"; ua?: string } | null {
  const m = pathname.match(/^\/p\/(!rel|[A-Za-z0-9_-]+)(\/[^?]*)?$/);
  if (!m) return null;
  const blob = m[1];
  const rest = m[2] ?? "/";
  if (blob === "!rel") {
    if (!refererHref) return null;
    try {
      const ru = new URL(refererHref);
      const rm = ru.pathname.match(/^\/p\/([A-Za-z0-9_-]+)(\/[^?]*)?$/);
      const full = rm ? decodeBlobFull(rm[1]) : null;
      if (!full) return null;
      return {
        origin: full.origin,
        rest,
        target: full.origin + rest + (search || ""),
        container: full.container,
        egress: full.egress,
        ua: full.ua,
      };
    } catch {
      return null;
    }
  }
  if (!BLOB_RE.test(blob)) return null;
  const full = decodeBlobFull(blob);
  if (!full) return null;
  return {
    origin: full.origin,
    rest,
    target: full.origin + rest + (search || ""),
    container: full.container,
    egress: full.egress,
    ua: full.ua,
  };
}

/**
 * Parse a proxied pathname into target parts (no per-tab context).
 * The special blob `!rel` resolves the rest-path against `refererHref`
 * (a full proxied href). Kept alongside parseProxiedRequest for callers
 * that only need origin+rest (fetcher referer mapping, decodeProxiedHref).
 */
export function parseProxiedPath(
  pathname: string,
  search = "",
  refererHref?: string | null
): { origin: string; rest: string; target: string } | null {
  const m = pathname.match(/^\/p\/(!rel|[A-Za-z0-9_-]+)(\/[^?]*)?$/);
  if (!m) return null;
  const blob = m[1];
  const rest = m[2] ?? "/";
  if (blob === "!rel") {
    if (!refererHref) return null;
    try {
      const rh = new URL(refererHref);
      const rm = rh.pathname.match(/^\/p\/([A-Za-z0-9_-]+)(\/[^?]*)?$/);
      const full = rm ? decodeBlobFull(rm[1]) : null;
      if (!full) return null;
      return { origin: full.origin, rest, target: full.origin + rest + (search || "") };
    } catch {
      return null;
    }
  }
  if (!BLOB_RE.test(blob)) return null;
  const full = decodeBlobFull(blob);
  if (!full) return null;
  return { origin: full.origin, rest, target: full.origin + rest + (search || "") };
}

/** Decode a proxied href back into the real URL (server side). */
export function decodeProxiedHref(href: string): string | null {
  try {
    const u = new URL(href);
    const parsed = parseProxiedPath(u.pathname, u.search);
    if (!parsed) return null;
    return parsed.origin + parsed.rest + u.search + u.hash;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Client bundle source                                                */
/* ------------------------------------------------------------------ */

/**
 * CODEC_SOURCE for client bundles (hooks, service worker): isomorphic XOR
 * with the per-deployment session secret. The secret travels base64-encoded
 * so no raw bytes land in the JS source, and the client derives key bytes
 * char-by-char to match the server's latin1 derivation. Clients never
 * receive the AES key and never decode AES blobs — page context is delivered
 * via __QUASAR_DATA__ injection instead.
 */
export const CODEC_SOURCE = buildCodecSource(
  Buffer.from(sessionXorSecret(), "latin1").toString("base64"),
  true // session blobs carry the 0x02 prefix so the server decodes them deterministically
);

/* ------------------------------------------------------------------ */
/* Optional password gate helpers (salt lives in the key file)         */
/* ------------------------------------------------------------------ */

export function authSalt(): string {
  return ensureKey().salt;
}

/** HMAC-SHA256(password, salt) — the value stored in the session cookie. */
export function sessionTokenFor(password: string): string {
  return createHmac("sha256", authSalt()).update(String(password)).digest("hex");
}
