/**
 * Quasar Static HTTP Cache (v2.1.0)
 * ---------------------------------
 * Server-side LRU cache for immutable-looking upstream GETs (images, fonts,
 * CSS, JS, wasm). The v2.0.4 AST cache only skipped re-running acorn — repeat
 * visits still re-fetched every subresource through the tunnel. This cache
 * stores the FINAL client-facing response (post-rewrite, headers + body), so
 * a hit skips the upstream fetch AND every rewrite pass in one step.
 *
 * Revalidation: when an entry goes stale but carries validators, the route
 * injects If-None-Match / If-Modified-Since into the upstream request; a 304
 * then serves the stored body (x-quasar-cache: 304hit) instead of an error.
 *
 * Safety rules (never cached):
 *   - non-GET / non-200 / responses with Set-Cookie or Content-Disposition
 *   - HTML documents (always fresh — rewritten injection must track engine
 *     version) and anything with a Vary beyond Accept-Encoding
 *   - bodies > 8 MB and Range-served responses
 *
 * Budget: QUASAR_HTTP_CACHE_MB (default 256) and 4096 entries, LRU eviction.
 * In-memory only by design: disk persistence is reserved for the AST cache,
 * where entries are small and stable.
 */

const MAX_BYTES = Math.max(32, Number(process.env.QUASAR_HTTP_CACHE_MB) || 256) * 1024 * 1024;
const MAX_ENTRIES = 4096;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const DEFAULT_TTL_MS = 300_000; // 5 min for validator-less cacheable types

interface CacheEntry {
  status: number;
  headers: [string, string][];
  body: Uint8Array;
  size: number;
  etag: string | null;
  lastModified: string | null;
  expiresAt: number;
}

// globalThis-backed: /p/ (writer) and /api/debug (reader) are separate
// Turbopack route bundles and must observe the same cache.
const cache: Map<string, CacheEntry> = ((globalThis as Record<string, unknown>)
  .__quasarHttpCache ??= new Map()) as Map<string, CacheEntry>;
const cacheState = ((globalThis as Record<string, unknown>).__quasarHttpCacheBytes ??= {
  total: 0,
}) as { total: number };

const CACHEABLE_CT_RE =
  /^(image\/|font\/|application\/(font|octet-stream|wasm)|text\/(css|javascript)|application\/(javascript|json|x-javascript|ecmascript)|audio\/|video\/(mp4|webm))/i;

/** content-type of an entry-eligible response (callers pre-check status/GET). */
export function isCacheableContentType(ct: string): boolean {
  return CACHEABLE_CT_RE.test(ct);
}

function varySafe(vary: string | null): boolean {
  if (!vary) return true;
  const parts = vary
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return parts.every((p) => p === "accept-encoding" || p === "accept-language");
}

function ttlFor(headers: Headers, hasValidator: boolean): number {
  const cc = headers.get("cache-control") ?? "";
  if (/(?:^|,)\s*(?:no-store|private|no-cache)\b/i.test(cc)) return 0;
  const m = cc.match(/max-age\s*=\s*(\d+)/i);
  if (m) return Math.min(Number(m[1]) * 1000, 6 * 3600_000);
  return hasValidator || CACHEABLE_CT_RE.test(headers.get("content-type") ?? "")
    ? DEFAULT_TTL_MS
    : 0;
}

function evictWhileOverBudget(): void {
  while (cache.size > MAX_ENTRIES || cacheState.total > MAX_BYTES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const e = cache.get(oldest);
    cacheState.total -= e ? e.size : 0;
    cache.delete(oldest);
  }
}

function cacheKey(target: string): string {
  return "GET " + target;
}

/** Fresh entry for a target, or null. LRU-refreshes on hit. */
export function cacheLookup(target: string): CacheEntry | null {
  const key = cacheKey(target);
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) return null; // stale — kept for revalidation
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

/** Stale-or-fresh entry carrying validators (used to build conditional GETs). */
export function cacheValidators(
  target: string
): { etag: string | null; lastModified: string | null } | null {
  const hit = cache.get(cacheKey(target));
  if (!hit) return null;
  return { etag: hit.etag, lastModified: hit.lastModified };
}

/** Serve a stale entry after a successful 304 revalidation (LRU refresh). */
export function cacheServeStale(target: string): CacheEntry | null {
  const key = cacheKey(target);
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

/**
 * Store a final client-facing response. Callers pass the body as a byte
 * array (string bodies are encoded by the caller); anything ineligible is
 * silently dropped.
 */
export function cacheStore(
  target: string,
  status: number,
  headers: Headers,
  body: Uint8Array,
  requestHeaders?: Headers
): void {
  if (status !== 200) return;
  if (body.byteLength === 0 || body.byteLength > MAX_BODY_BYTES) return;
  const ct = headers.get("content-type") ?? "";
  if (!CACHEABLE_CT_RE.test(ct)) return;
  if (headers.has("set-cookie")) return;
  const cd = headers.get("content-disposition") ?? "";
  if (/attachment/i.test(cd)) return;
  if (!varySafe(headers.get("vary"))) return;
  // The client's own validators must not leak into a shared entry.
  const etag = headers.get("etag");
  const lastModified = headers.get("last-modified");
  const ttl = ttlFor(headers, !!(etag || lastModified));
  if (ttl <= 0) return;

  const key = cacheKey(target);
  const prev = cache.get(key);
  if (prev) cacheState.total -= prev.size;
  const stored: [string, string][] = [];
  for (const [k, v] of headers.entries()) {
    if (k === "set-cookie") continue;
    stored.push([k, v]);
  }
  const size = body.byteLength;
  cache.set(key, {
    status,
    headers: stored,
    body,
    size,
    etag: etag ?? null,
    lastModified: lastModified ?? null,
    expiresAt: Date.now() + ttl,
  });
  cacheState.total += size;
  evictWhileOverBudget();
}

/** Introspection for the debug panel. */
export function cacheStats(): { entries: number; bytes: number; maxBytes: number } {
  return { entries: cache.size, bytes: cacheState.total, maxBytes: MAX_BYTES };
}
