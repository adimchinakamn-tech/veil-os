/**
 * Quasar Cookie Jar
 * -----------------
 * Server-side in-memory cookie store keyed by target origin.
 * Set-Cookie from targets is absorbed here and re-issued on later requests,
 * so login sessions survive. The client shim also syncs document.cookie
 * writes into this jar via /api/cookie.
 */

const jars = new Map<string, Map<string, string>>();

const MAX_ORIGINS = 250;
const MAX_COOKIES_PER_ORIGIN = 120;

const EXPIRED_RE = /max-age\s*=\s*0(?![0-9])/i;

function jarFor(origin: string): Map<string, string> {
  let jar = jars.get(origin);
  if (!jar) {
    if (jars.size >= MAX_ORIGINS) {
      const oldest = jars.keys().next().value;
      if (oldest) jars.delete(oldest);
    }
    jar = new Map();
    jars.set(origin, jar);
  }
  return jar;
}

function isExpired(setCookie: string): boolean {
  if (EXPIRED_RE.test(setCookie)) return true;
  const m = setCookie.match(/expires=([^;]+)/i);
  if (m) {
    const d = new Date(m[1]);
    if (!isNaN(d.getTime()) && d.getTime() < Date.now()) return true;
  }
  return false;
}

/** Absorb Set-Cookie headers from a target response. */
export function storeSetCookies(origin: string, setCookies: string[]): void {
  if (!setCookies.length) return;
  const jar = jarFor(origin);
  for (const sc of setCookies) {
    const pair = sc.split(";")[0] ?? "";
    const i = pair.indexOf("=");
    if (i <= 0) continue;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (!name) continue;
    if (isExpired(sc) || value === "") {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
  while (jar.size > MAX_COOKIES_PER_ORIGIN) {
    const first = jar.keys().next().value;
    if (!first) break;
    jar.delete(first);
  }
}

/** Merge cookies pushed by the client document.cookie shim. */
export function mergeClientCookies(origin: string, cookies: Record<string, string>): void {
  if (!cookies || typeof cookies !== "object") return;
  const jar = jarFor(origin);
  for (const [name, value] of Object.entries(cookies)) {
    if (!name) continue;
    if (value === "") jar.delete(name);
    else jar.set(name, String(value).slice(0, 4096));
  }
}

/** Build a Cookie header for a target origin (null when empty). */
export function cookieHeader(origin: string): string | null {
  const jar = jars.get(origin);
  if (!jar || jar.size === 0) return null;
  const parts: string[] = [];
  for (const [k, v] of jar.entries()) parts.push(k + "=" + v);
  return parts.length ? parts.join("; ") : null;
}

/** Snapshot of a jar (for the client shim bootstrap). */
export function snapshotCookies(origin: string): Record<string, string> {
  const jar = jars.get(origin);
  if (!jar) return {};
  return Object.fromEntries(jar.entries());
}
