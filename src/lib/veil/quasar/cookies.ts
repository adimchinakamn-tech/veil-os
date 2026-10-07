/**
 * Quasar Cookie Jar
 * -----------------
 * Server-side in-memory cookie store keyed by (container, target origin).
 * Set-Cookie from targets is absorbed here and re-issued on later requests,
 * so login sessions survive. The client shim also syncs document.cookie
 * writes into this jar via /api/cookie.
 *
 * v2.1.0 — the jar is partitioned per CONTAINER as well as per origin: two
 * tabs using different containers can be logged into the same site as two
 * different accounts (Firefox-container style), and incognito containers get
 * a jar that is dropped wholesale when the last incognito tab closes.
 * The built-in container ("default") preserves pre-2.1 behavior exactly.
 */

export const DEFAULT_CONTAINER = "default";

/** jar key = container + "\n" + origin (container sanitized by callers).
 *  State lives on globalThis: Next.js (Turbopack) compiles each route as its
 *  own bundle — without this, /api/cookie and /p/ would hold two different
 *  jars and cookie sync would silently break. */
const jars: Map<string, Map<string, string>> = ((globalThis as Record<string, unknown>).__quasarCookieJars ??= new Map()) as Map<string, Map<string, string>>;

const MAX_ORIGINS = 250;
const MAX_COOKIES_PER_ORIGIN = 120;

const EXPIRED_RE = /max-age\s*=\s*0(?![0-9])/i;

/** Normalize an externally supplied container id (falls back to default). */
export function normContainer(container: string | null | undefined): string {
  if (!container) return DEFAULT_CONTAINER;
  const c = String(container);
  return /^[A-Za-z0-9_-]{1,40}$/.test(c) ? c : DEFAULT_CONTAINER;
}

function jarKey(origin: string, container: string): string {
  return container + "\n" + origin;
}

function jarFor(origin: string, container: string): Map<string, string> {
  const key = jarKey(origin, container);
  let jar = jars.get(key);
  if (!jar) {
    if (jars.size >= MAX_ORIGINS) {
      const oldest = jars.keys().next().value;
      if (oldest) jars.delete(oldest);
    }
    jar = new Map();
    jars.set(key, jar);
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
export function storeSetCookies(
  origin: string,
  setCookies: string[],
  container: string = DEFAULT_CONTAINER
): void {
  if (!setCookies.length) return;
  const jar = jarFor(origin, container);
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
export function mergeClientCookies(
  origin: string,
  cookies: Record<string, string>,
  container: string = DEFAULT_CONTAINER
): void {
  if (!cookies || typeof cookies !== "object") return;
  const jar = jarFor(origin, container);
  for (const [name, value] of Object.entries(cookies)) {
    if (!name) continue;
    if (value === "") jar.delete(name);
    else jar.set(name, String(value).slice(0, 4096));
  }
}

/** Build a Cookie header for a target origin (null when empty). */
export function cookieHeader(
  origin: string,
  container: string = DEFAULT_CONTAINER
): string | null {
  const jar = jars.get(jarKey(origin, container));
  if (!jar || jar.size === 0) return null;
  const parts: string[] = [];
  for (const [k, v] of jar.entries()) parts.push(k + "=" + v);
  return parts.length ? parts.join("; ") : null;
}

/** Snapshot of a jar (for the client shim bootstrap). */
export function snapshotCookies(
  origin: string,
  container: string = DEFAULT_CONTAINER
): Record<string, string> {
  const jar = jars.get(jarKey(origin, container));
  if (!jar) return {};
  return Object.fromEntries(jar.entries());
}

/**
 * Drop every jar of a container (incognito hygiene: called when the last
 * tab of an ephemeral container closes). Returns the number of jars removed.
 */
export function clearContainer(container: string): number {
  const c = normContainer(container);
  if (c === DEFAULT_CONTAINER) return 0; // never nuke the default jar
  let removed = 0;
  for (const key of Array.from(jars.keys())) {
    if (key.split("\n")[0] === c) {
      jars.delete(key);
      removed++;
    }
  }
  return removed;
}

/** Introspection for the debug panel: jars grouped by container. */
export function jarStats(): { container: string; origin: string; cookies: number }[] {
  const out: { container: string; origin: string; cookies: number }[] = [];
  for (const [key, jar] of jars.entries()) {
    const i = key.indexOf("\n");
    out.push({
      container: key.slice(0, i),
      origin: key.slice(i + 1),
      cookies: jar.size,
    });
  }
  return out;
}
