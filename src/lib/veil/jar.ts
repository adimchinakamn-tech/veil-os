/**
 * Veil — per-site cookie jar, scoped per viewer.
 *
 * Upstream `set-cookie` headers are captured into SQLite and replayed on
 * later requests to the same site (domain/path matched), so sessions survive
 * across page loads. JS-visible (non-httpOnly) cookies are additionally
 * injected into the client runtime so `document.cookie` behaves correctly
 * inside the rendered page. Every row is scoped to a pseudonymous viewer id
 * (src/lib/veil/viewer.ts) — jars are never shared between visitors.
 */

import { db } from "@/lib/db";

const CACHE_TTL_MS = 3_000;
const MAX_COOKIES_PER_HOST = 80;

interface JarRow {
  host: string;
  name: string;
  value: string;
  path: string;
  hostOnly: boolean;
  httpOnly: boolean;
  expiresAt: Date | null;
}

/** Short-lived in-memory cache keyed by viewer|host (invalidated on writes).
 * Bounded: one key per viewer×host pair — a long-lived viewer browsing
 * hundreds of hosts through the veil would otherwise grow this forever. */
const cache = new Map<string, { at: number; rows: JarRow[] }>();
const JAR_CACHE_CAP = 256;

function invalidate(viewer: string, host: string) {
  cache.delete(`${viewer}|${host.toLowerCase()}`);
}

function jarCacheSet(key: string, rows: JarRow[]): void {
  cache.set(key, { at: Date.now(), rows });
  if (cache.size > JAR_CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

async function rowsForHost(viewer: string, host: string): Promise<JarRow[]> {
  const key = host.toLowerCase();
  const ckey = `${viewer}|${key}`;
  const hit = cache.get(ckey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows;

  const rows = (await db.siteCookie.findMany({
    where: { viewer, host: key },
    orderBy: { createdAt: "asc" },
  })) as unknown as JarRow[];

  const now = Date.now();
  const live = rows.filter((r) => !r.expiresAt || r.expiresAt.getTime() > now);
  const stale = rows.filter((r) => r.expiresAt && r.expiresAt.getTime() <= now);
  if (stale.length) {
    db.siteCookie
      .deleteMany({ where: { viewer, host: key, expiresAt: { lte: new Date(now) } } })
      .catch(() => {});
    jarCacheSet(ckey, live);
    return live;
  }
  jarCacheSet(ckey, live);
  return live;
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  const p = cookiePath || "/";
  if (p === "/") return true;
  const norm = requestPath === "/" ? "" : requestPath;
  return norm === p || norm.startsWith(p.endsWith("/") ? p : p + "/");
}

function hostMatches(requestHost: string, row: JarRow): boolean {
  if (row.hostOnly) return requestHost === row.host;
  return requestHost === row.host || requestHost.endsWith("." + row.host);
}

/**
 * Build a `Cookie:` header value for the given viewer's host/path.
 * With `jsVisible`, only non-httpOnly cookies are included (for document.cookie).
 */
export async function cookieHeaderFor(
  viewer: string,
  host: string,
  path: string,
  opts?: { jsVisible?: boolean }
): Promise<string | null> {
  const h = host.toLowerCase();
  let rows: JarRow[];
  try {
    rows = await rowsForHost(viewer, h);
  } catch {
    return null;
  }
  const matched = rows
    .filter((r) => hostMatches(h, r) && pathMatches(path || "/", r.path))
    .filter((r) => (opts?.jsVisible ? !r.httpOnly : true))
    // Longest path first, then oldest first (browser-like precedence).
    .sort((a, b) => b.path.length - a.path.length);
  if (!matched.length) return null;
  return matched.map((r) => `${r.name}=${r.value}`).join("; ");
}

export interface ParsedCookie {
  name: string;
  value: string;
  path: string;
  host: string;
  hostOnly: boolean;
  httpOnly: boolean;
  secure: boolean;
  expiresAt: Date | null;
  deleteCookie: boolean;
}

/** Parse a single `set-cookie` header value. */
export function parseSetCookie(header: string, requestHost: string): ParsedCookie | null {
  const raw = header.trim();
  if (!raw) return null;
  const parts = raw.split(";");
  const nv = parts[0] ?? "";
  const eq = nv.indexOf("=");
  const name = (eq === -1 ? nv : nv.slice(0, eq)).trim();
  if (!name) return null;
  const value = (eq === -1 ? "" : nv.slice(eq + 1)).trim();

  let path = "/";
  let domain = "";
  let hostOnly = true;
  let httpOnly = false;
  let secure = false;
  let expiresAt: Date | null = null;
  let deleteCookie = false;

  for (const part of parts.slice(1)) {
    const t = part.trim();
    if (!t) continue;
    const ci = t.indexOf("=");
    const key = (ci === -1 ? t : t.slice(0, ci)).trim().toLowerCase();
    const sval = (ci === -1 ? "" : t.slice(ci + 1)).trim();
    if (key === "domain" && sval) {
      domain = sval.replace(/^\./, "").toLowerCase();
      hostOnly = false;
    } else if (key === "path" && sval) {
      path = sval.startsWith("/") ? sval : "/";
    } else if (key === "httponly") {
      httpOnly = true;
    } else if (key === "secure") {
      secure = true;
    } else if (key === "max-age") {
      const s = parseInt(sval, 10);
      if (!Number.isNaN(s)) {
        if (s <= 0) {
          expiresAt = new Date(0);
          deleteCookie = true;
        } else {
          expiresAt = new Date(Date.now() + s * 1000);
        }
      }
    } else if (key === "expires") {
      const dt = Date.parse(sval);
      if (!Number.isNaN(dt)) {
        expiresAt = new Date(dt);
        if (dt <= Date.now()) deleteCookie = true;
      }
    }
  }

  // A domain attribute may not escape the request host's registrable side:
  // only accept it if it is a suffix of the request host (or equal).
  const scopeHost = hostOnly || !domain ? requestHost.toLowerCase() : domain;
  if (!hostOnly && domain && domain !== requestHost.toLowerCase() && !requestHost.toLowerCase().endsWith("." + domain)) {
    // Cross-site cookie attempt — store it host-only instead.
    return {
      name, value, path, host: requestHost.toLowerCase(), hostOnly: true,
      httpOnly, secure, expiresAt, deleteCookie,
    };
  }

  return { name, value, path, host: scopeHost, hostOnly, httpOnly, secure, expiresAt, deleteCookie };
}

async function upsertCookie(viewer: string, c: ParsedCookie): Promise<void> {
  if (c.deleteCookie || (c.expiresAt && c.expiresAt.getTime() <= Date.now())) {
    await db.siteCookie.deleteMany({
      where: { viewer, host: c.host, name: c.name, path: c.path },
    });
  } else {
    await db.siteCookie.upsert({
      where: {
        viewer_host_name_path: {
          viewer, host: c.host, name: c.name, path: c.path,
        },
      },
      create: {
        viewer,
        host: c.host, name: c.name, value: c.value, path: c.path,
        hostOnly: c.hostOnly, httpOnly: c.httpOnly, secure: c.secure,
        expiresAt: c.expiresAt,
      },
      update: {
        value: c.value, hostOnly: c.hostOnly, httpOnly: c.httpOnly,
        secure: c.secure, expiresAt: c.expiresAt,
      },
    });
  }
  invalidate(viewer, c.host);
  invalidate(viewer, c.host.split(".").slice(-2).join("."));
}

/** Read every `set-cookie` header from an upstream response into the viewer's jar. */
export async function captureSetCookies(
  viewer: string,
  host: string,
  headers: Headers
): Promise<void> {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  let list: string[] = [];
  if (typeof getSetCookie === "function") {
    list = getSetCookie.call(headers);
  } else {
    const combined = headers.get("set-cookie");
    if (combined) {
      // Heuristic split: a comma followed by something that looks like `name=`
      list = combined.split(/,(?=\s*[^;=\s]+\s*=)/);
    }
  }
  if (!list.length) return;
  const requestHost = host.toLowerCase();
  for (const h of list) {
    try {
      const parsed = parseSetCookie(h, requestHost);
      if (parsed) await upsertCookie(viewer, parsed);
    } catch {
      /* one bad cookie must not break the response */
    }
  }
  // Cap the jar per host (drop oldest overflow).
  try {
    const count = await db.siteCookie.count({ where: { viewer, host: requestHost } });
    if (count > MAX_COOKIES_PER_HOST) {
      const overflow = await db.siteCookie.findMany({
        where: { viewer, host: requestHost },
        orderBy: { createdAt: "asc" },
        take: count - MAX_COOKIES_PER_HOST,
        select: { id: true },
      });
      if (overflow.length) {
        await db.siteCookie.deleteMany({ where: { id: { in: overflow.map((o) => o.id) } } });
      }
    }
  } catch {
    /* non-fatal */
  }
}

/** Store a `document.cookie`-style string from the client runtime into the viewer's jar. */
export async function storeCookieString(
  viewer: string,
  host: string,
  cookieStr: string
): Promise<void> {
  const requestHost = host.toLowerCase();
  const parsed = parseSetCookie(cookieStr, requestHost);
  if (!parsed) return;
  await upsertCookie(viewer, parsed);
}
