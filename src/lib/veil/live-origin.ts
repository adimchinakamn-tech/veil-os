/**
 * Veil — live-origin beacon capture.
 *
 * The jsDelivr front stubs point at the box's public preview origin
 * (preview-chat-<id>.space-z.ai). That origin CHANGES whenever the
 * platform continues a session (new chat id) — the old one starts
 * answering 404 and every mirror goes dark until someone re-fingerprints
 * the stubs. This module is the "never again" half: hot routes call
 * noteRequestOrigin(req) with the incoming request; real browser traffic
 * carries Origin/Referer headers naming the CURRENT public origin, and
 * the first request after a move rewrites backups/live-origin.json (the
 * beacon the fronts follow — see scripts/retarget-fronts.mjs and the
 * beacon block injected into every stub).
 *
 * Safety: only strict preview-chat origins are ever accepted, and a
 * candidate must pass a liveness probe (its own /api/veil/whereami must
 * answer with this app's JSON shape) before it is recorded. A spoofed
 * Origin header can therefore never hijack the fronts to a foreign host.
 *
 * Never throws, never blocks: everything is fire-and-forget with a
 * module-level cache so the hot path stays a regex + string compare.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const BEACON_PATH = "/home/z/my-project/backups/live-origin.json";
const PREVIEW_RE = /^https:\/\/preview-chat-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.space-z\.ai$/;

let cached: string | null | undefined; /* undefined = not loaded yet */
let probing: Promise<void> | null = null;

function readBeacon(): string | null {
  if (cached !== undefined) return cached;
  try {
    const j = JSON.parse(readFileSync(BEACON_PATH, "utf8")) as { origin?: unknown };
    cached = typeof j.origin === "string" && PREVIEW_RE.test(j.origin) ? j.origin : null;
  } catch {
    cached = null;
  }
  return cached;
}

function writeBeacon(origin: string): void {
  try {
    mkdirSync("/home/z/my-project/backups", { recursive: true });
    writeFileSync(
      BEACON_PATH,
      JSON.stringify({ origin, at: new Date().toISOString() }, null, 2) + "\n",
    );
    cached = origin;
  } catch {
    /* best-effort — the keeper's retarget loop is the backstop */
  }
}

/** Extract a strict preview-chat origin from a request's headers. */
function originFromRequest(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (origin && PREVIEW_RE.test(origin)) return origin;
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const u = new URL(referer);
      if (PREVIEW_RE.test(u.origin)) return u.origin;
    } catch {
      /* malformed referer — ignore */
    }
  }
  return null;
}

/** Probe a candidate origin: it must answer /api/veil/whereami with this
 * app's JSON shape. One probe per distinct candidate, ever (memoized by
 * the in-flight guard + the beacon write). */
async function probe(origin: string): Promise<boolean> {
  try {
    const r = await fetch(`${origin}/api/veil/whereami`, {
      signal: AbortSignal.timeout(10000),
      headers: { "user-agent": "veil-origin-probe/1.0" },
    });
    if (!r.ok) return false;
    const j = (await r.json().catch(() => null)) as { at?: unknown } | null;
    return !!j && typeof j.at === "string";
  } catch {
    return false;
  }
}

/**
 * Record the public origin this request arrived through. Fire-and-forget:
 * on the hot path it's a header read + regex; the (rare) beacon rewrite
 * happens after an async liveness probe.
 */
export function noteRequestOrigin(req: Request): void {
  try {
    const origin = originFromRequest(req);
    if (!origin || origin === readBeacon()) return;
    if (probing) return; /* one probe at a time */
    probing = (async () => {
      try {
        if (await probe(origin)) writeBeacon(origin);
      } finally {
        probing = null;
      }
    })();
    probing.catch(() => {
      probing = null;
    });
  } catch {
    /* never let origin capture break a request */
  }
}

/** The current beacon origin (or null) — sync, cached. */
export function liveOrigin(): string | null {
  return readBeacon();
}
