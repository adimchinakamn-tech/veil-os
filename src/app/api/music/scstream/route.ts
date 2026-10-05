/**
 * Veil — SoundCloud full-song stream (byte proxy).
 *
 * GET /api/music/scstream?id={soundcloudTrackId}
 *
 * Resolves the track's progressive transcode → signed cf-media mp3
 * (see src/lib/veil/sc-audio.ts) and pipes the bytes through this
 * origin so <audio> elements stay same-origin in the app — and
 * cross-origin-but-CORS-clean for the single-file build (file:// +
 * Origin: null). Range requests are forwarded verbatim (seeks get
 * real 206s), signed URLs are cached ~10 min (they live ~30 upstream),
 * and a mid-cache signature expiry triggers exactly one forced
 * re-resolve before giving up with a clean 502.
 *
 * The signed URL never reaches the client: this route is the surface.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { scResolveStream } from "@/lib/veil/sc-audio";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
};

function cors(res: Response): Response {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

export async function OPTIONS(): Promise<Response> {
  return cors(new Response(null, { status: 204 }));
}

async function fetchBytes(url: string, range: string | null, clientSignal?: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = { "user-agent": UA, accept: "*/*" };
  if (range) headers.range = range;
  /* TTFB-only ceiling: connect + first byte must land in 20s. The body
   * itself streams as long as the client keeps reading — the old
   * blanket 15-minute fetch timeout killed long songs mid-playback on
   * slow connections. Client aborts (seeking away, closing the tab)
   * cancel the upstream pull via a composite signal. */
  const ttfb = AbortSignal.timeout(20_000);
  const signal = clientSignal ? AbortSignal.any([clientSignal, ttfb]) : ttfb;
  return fetch(url, {
    headers,
    cache: "no-store",
    signal,
  });
}

/** Pass an upstream media response through with honest media headers. */
function mediaPassThrough(up: Response, status?: number): Response {
  const h = new Headers();
  h.set("content-type", up.headers.get("content-type") ?? "audio/mpeg");
  h.set("accept-ranges", "bytes");
  const cl = up.headers.get("content-length");
  if (cl) h.set("content-length", cl);
  const cr = up.headers.get("content-range");
  if (cr) h.set("content-range", cr);
  h.set("cache-control", "no-store"); // signed URLs rotate upstream
  return cors(new Response(up.body, { status: status ?? up.status, headers: h }));
}

export async function GET(req: Request): Promise<Response> {
  const id = (new URL(req.url).searchParams.get("id") ?? "").trim();
  if (!/^\d{1,12}$/.test(id)) {
    return cors(
      Response.json({ error: "bad track id" }, { status: 400, headers: { "cache-control": "no-store" } })
    );
  }
  const trackId = Number(id);
  const range = req.headers.get("range");

  try {
    const stream = await scResolveStream(trackId);
    let up = await fetchBytes(stream.url, range, req.signal);
    // Signed URL went stale inside our cache window → re-resolve once.
    if (up.status === 403 || up.status === 401) {
      await up.arrayBuffer().catch(() => {}); // drain the stale body
      const fresh = await scResolveStream(trackId, true);
      const retry = await fetchBytes(fresh.url, range, req.signal);
      if (retry.ok || retry.status === 206) {
        return mediaPassThrough(retry);
      }
      await retry.arrayBuffer().catch(() => {});
      return cors(
        Response.json(
          { error: "the stream source refused this track — try another result" },
          { status: 502, headers: { "cache-control": "no-store" } }
        )
      );
    }
    if (up.ok || up.status === 206) return mediaPassThrough(up);

    // Real failure — small body, read it to keep the socket clean.
    await up.arrayBuffer().catch(() => {});
    return cors(
      Response.json(
        { error: "the stream source refused this track — try another result" },
        { status: 502, headers: { "cache-control": "no-store" } }
      )
    );
  } catch {
    return cors(
      Response.json(
        { error: "couldn't resolve this track right now — try another result" },
        { status: 502, headers: { "cache-control": "no-store" } }
      )
    );
  }
}
