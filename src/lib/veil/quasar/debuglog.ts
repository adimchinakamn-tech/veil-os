/**
 * Quasar Debug Ring (v2.1.0)
 * --------------------------
 * In-memory ring buffer of recent proxied requests, surfaced by /api/debug
 * and the UI debug panel. One entry per upstream operation with the fields
 * that actually answer "why is this site broken": status, content type,
 * per-tab context (container/egress), cache disposition, site-fix id, total
 * latency. Bounded (500 entries) and allocation-light — safe to keep always
 * on; the panel is the only exposed surface (password-gated when configured).
 */

export interface DebugEntry {
  t: number;
  method: string;
  target: string;
  status: number;
  contentType: string;
  ms: number;
  /** memhit | 304hit | stale | miss | blocked | - */
  cache: string;
  container: string;
  egress: string;
  fix: string;
  bytes?: number;
}

// globalThis-backed: /p/ (writer) and /api/debug (reader) are separate
// Turbopack route bundles and must observe the same ring.
const MAX_ENTRIES = 500;
const ring: DebugEntry[] = ((globalThis as Record<string, unknown>).__quasarDebugRing ??= []) as DebugEntry[];

export function recordRequest(entry: DebugEntry): void {
  if (ring.length >= MAX_ENTRIES) {
    ring.shift();
    const st = globalThis as Record<string, unknown>;
    st.__quasarDebugDropped = (Number(st.__quasarDebugDropped) || 0) + 1;
  }
  ring.push(entry);
}

export function recentRequests(n = 200): DebugEntry[] {
  return ring.slice(-Math.min(Math.max(n, 1), MAX_ENTRIES)).reverse();
}

export function debugStats(): {
  total: number;
  dropped: number;
  byCache: Record<string, number>;
  avgMs: number;
} {
  const byCache: Record<string, number> = {};
  let ms = 0;
  for (const e of ring) {
    byCache[e.cache] = (byCache[e.cache] ?? 0) + 1;
    ms += e.ms;
  }
  const dropped = Number((globalThis as Record<string, unknown>).__quasarDebugDropped) || 0;
  return {
    total: ring.length + dropped,
    dropped,
    byCache,
    avgMs: ring.length ? Math.round(ms / ring.length) : 0,
  };
}
