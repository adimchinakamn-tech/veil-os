/**
 * Veil — Stream byte proxy (the "undiscovered" part).
 *
 * GET /api/yt/s?u=<absolute upstream URL>
 *
 * Every byte the Stream section plays or displays passes through here:
 * HLS manifests, video segments, progressive files, thumbnails and
 * avatars. The user's browser talks ONLY to this origin — YouTube,
 * Piped's proxies and LBRY never see the visitor, and the visitor's
 * network never sees them.
 *
 * Split of labor:
 *  - media (m3u8/mp4/m4a/webm/ts/vtt, /videoplayback, /streams, timedtext)
 *    → forwarded to the freetube-service's /stream handler, which adds
 *      proxy-host sibling fallback and its gate-hardened upstream fetch;
 *      HLS manifests that pass through get their inner refs re-hosted
 *      from the service's path (/ft-invidious/stream?u=…) onto this
 *      route so the chain stays on OUR namespace;
 *  - images (thumbnails/avatars) → fetched directly (no gate on those),
 *    cached for a day.
 *
 * Range requests are forwarded verbatim — seeks get real 206s.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FT_STREAM = "http://localhost:3031/ft-invidious/stream";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

/* ------------------------------------------------------------------ */
/* SSRF guard — the proxy must never loop back at us or private nets    */
/* ------------------------------------------------------------------ */

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "::1" || h === "0.0.0.0" || h.endsWith(".local") || h.endsWith(".internal")) {
    return true;
  }
  if (h === "metadata.google.internal" || h.startsWith("169.254.")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

/** Media path shapes the service's /stream handler accepts (kept in sync
 * with its own guard) — everything else must be an image to pass here. */
const MEDIA_SHAPE =
  /\/(streams|videoplayback|api\/timedtext|manifest)\b|\.(mp4|m4a|m3u8|ts|webm|vtt)\b/i;
const IMAGE_SHAPE = /\.(jpe?g|png|webp|gif|ico|avif)\b/i;
/* Google-hosted image URLs carry NO file extension:
 *   avatars   yt3.googleusercontent.com/<hash>=s176-c-k-c0x00ffffff-no-rj
 *   banners   …=w2560-fcrop64=…-k-c0xffffffff-no-nd-rw
 *   piped's   piped-proxy.ducks.party/<hash>=s160-c…?host=yt3.googleusercontent.com
 * The sizing suffix (=s<w>x<h>… / =w<w>… / =h<h>…) plus the googleusercontent
 * / ytimg host param are the tell — video never rides those shapes. */
const GC_SIZE_SUFFIX = /=[swh]\d{2,5}(?:-|x|,|$)/;
const GC_HOST_PARAM = /(?:\?|&)host=[a-z0-9.-]*(?:googleusercontent\.com|ytimg\.com|ggpht\.com)/i;

/** True when the URL points at a Google-CDN IMAGE (avatars, banners,
 * extensionless thumbs) — checked only after the media shapes. */
function isGoogleImage(target: URL): boolean {
  if (!GC_SIZE_SUFFIX.test(target.pathname)) return false;
  if (GC_HOST_PARAM.test(target.search)) return true;
  return /(?:^|\.)((?:yt3|yt4)\.(?:googleusercontent|ggpht)\.com|i\.ytimg\.com)$/i.test(target.hostname);
}
/* Google user-content images carry NO file extension — the size/param
 * suffix is the marker: avatars "…=s160-c-k-…", community-post images
 * "…=w608-h1080-…", channel banners "…=w1060-fcrop64=1,…". Without this
 * branch every PFP on channels/comments/posts 403s (thumbnails still
 * match IMAGE_SHAPE via /vi/<id>/hq720.jpg). */
const GOOGLE_IMG_SHAPE = /=[swh]\d{1,5}(?:[-=][^/?]*)?$/i;

/* ------------------------------------------------------------------ */
/* Handlers                                                             */
/* ------------------------------------------------------------------ */

async function proxyImage(target: URL): Promise<Response> {
  // The Node origin's own fetch (undici) is TLS-walled from these CDNs
  // (JA3 gate — see lib/veil/curl-fetch.ts for the precedent); the bun
  // freetube-service reaches them fine, so images hop through its
  // /image handler (localhost only).
  const upstreamUrl = `http://localhost:3031/ft-invidious/image?u=${encodeURIComponent(target.href)}`;
  const res = await fetch(upstreamUrl, {
    headers: { "user-agent": UA, accept: "image/*,*/*" },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
    redirect: "follow",
  }).catch((err) => {
    console.error("[yt/s] image hop failed:", String(err));
    return null;
  });
  if (!res || !res.ok) {
    return Response.json(
      { error: "the image source refused this request" },
      { status: 502, headers: { ...CORS, "cache-control": "no-store" } },
    );
  }
  const buf = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
  return new Response(buf, {
    status: 200,
    headers: {
      ...CORS,
      "content-type": res.headers.get("content-type") ?? "image/jpeg",
      "cache-control": res.headers.get("cache-control") ?? "public, max-age=86400",
    },
  });
}

async function proxyMedia(target: URL, range: string | null, method: "GET" | "HEAD"): Promise<Response> {
  // Forward through the freetube-service's stream handler: sibling proxy
  // fallback + gate-hardened upstream logic live there.
  const upstreamUrl = `${FT_STREAM}?u=${encodeURIComponent(target.href)}`;
  const headers: Record<string, string> = { "user-agent": UA, accept: "*/*" };
  if (range) headers.range = range;
  let res: Response;
  try {
    res = await fetch(upstreamUrl, {
      method,
      headers,
      redirect: "follow",
      // No hard abort: video bodies run for minutes (the service itself
      // documents this); a 30-minute ceiling catches pathological hangs.
      signal: AbortSignal.timeout(30 * 60_000),
    });
  } catch {
    return Response.json(
      { error: "the stream source didn't answer — try again in a moment" },
      { status: 502, headers: { ...CORS, "cache-control": "no-store" } },
    );
  }
  if (!res.ok && res.status !== 206) {
    await res.arrayBuffer().catch(() => {}); // drain
    return Response.json(
      { error: `the stream source refused this request (HTTP ${res.status}) — it may be rotating, try again` },
      { status: 502, headers: { ...CORS, "cache-control": "no-store" } },
    );
  }

  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  const looksManifest = ct.includes("mpegurl") || /\.m3u8([?#]|$)/i.test(target.pathname);
  if (looksManifest && res.status === 200 && method === "GET") {
    const text = await res.text().catch(() => "");
    // The service rewrites manifest refs to ITS path — re-host every one
    // of them onto OUR namespace so the whole chain stays /api/yt/*.
    const out = text.split("/ft-invidious/stream?u=").join("/api/yt/s?u=");
    return new Response(out, {
      status: 200,
      headers: {
        ...CORS,
        "content-type": "application/vnd.apple.mpegurl",
        "cache-control": "no-store",
      },
    });
  }

  const out = new Headers(CORS);
  out.set("accept-ranges", res.headers.get("accept-ranges") ?? "bytes");
  out.set("cache-control", "no-store");
  for (const h of ["content-type", "content-length", "content-range", "etag", "last-modified"]) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  if (method === "HEAD") return new Response(null, { status: res.status, headers: out });
  return new Response(res.body, { status: res.status, headers: out });
}

export async function GET(req: Request): Promise<Response> {
  return handle(req, "GET");
}
export async function HEAD(req: Request): Promise<Response> {
  return handle(req, "HEAD");
}

async function handle(req: Request, method: "GET" | "HEAD"): Promise<Response> {
  const u = new URL(req.url).searchParams.get("u");
  if (!u) {
    return Response.json({ error: "missing url" }, { status: 400, headers: { ...CORS, "cache-control": "no-store" } });
  }
  let target: URL;
  try {
    target = new URL(u);
  } catch {
    return Response.json({ error: "bad url" }, { status: 400, headers: { ...CORS, "cache-control": "no-store" } });
  }
  if (!/^https?:$/.test(target.protocol) || isPrivateHost(target.hostname)) {
    return Response.json({ error: "forbidden host" }, { status: 403, headers: { ...CORS, "cache-control": "no-store" } });
  }
  const pathShape = target.pathname + target.search;
  const isImage = IMAGE_SHAPE.test(target.pathname) || GOOGLE_IMG_SHAPE.test(target.pathname);
  const isMedia = MEDIA_SHAPE.test(pathShape);
  if (!isImage && !isMedia) {
    return Response.json(
      { error: "not a media or image path" },
      { status: 403, headers: { ...CORS, "cache-control": "no-store" } },
    );
  }

  try {
    if (isImage) return await proxyImage(target);
    return await proxyMedia(target, req.headers.get("range"), method);
  } catch {
    return Response.json(
      { error: "the proxy failed this request" },
      { status: 502, headers: { ...CORS, "cache-control": "no-store" } },
    );
  }
}
