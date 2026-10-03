/**
 * Veil — same-origin reverse proxy to the FreeTube program service (:3031).
 *
 * The real FreeTube desktop client runs as a mini-service (per-viewer
 * processes, its own SQLite data). Its patched renderer is mount-aware:
 * served at /ft it derives every bridge path (ipc, static, cache-busting)
 * from the mount, and rewrites its instance API calls onto the
 * same-origin /ft-invidious route. This proxy mirrors both mounts onto
 * the Next.js origin so the website's browser can embed the program in
 * a plain same-origin iframe — exactly like the offline file version
 * does through its birth origin.
 *
 * Transport notes (learned the hard way):
 *  - SSE (/ipc/events) must STREAM — never buffer event-stream responses.
 *  - The service labels the program's shipped .json.br locales with
 *    content-encoding: br. Whether the runtime's fetch auto-decompresses
 *    those (Bun does; Node/undici only what it negotiated) differs, so a
 *    content-length vs actual-byte comparison decides whether the
 *    encoding header survives the hop. Forwarding it blindly would make
 *    the browser decompress already-decompressed bytes.
 */

const FT_UPSTREAM = "http://localhost:3031";

/** Request headers worth carrying upstream (never accept-encoding — the
 *  proxy's own fetch negotiates its own compression). */
const FWD_REQ_HEADERS = new Set([
  "content-type",
  "accept",
  "cookie",
  "x-veil-viewer",
  "range",
  "if-none-match",
  "if-modified-since",
  "authorization",
  "user-agent",
]);

/** Response headers worth carrying back (content-length/transfer-encoding
 *  are owned by this origin's server). */
const FWD_RES_HEADERS = new Set([
  "content-type",
  "cache-control",
  "content-encoding",
  "content-disposition",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
  "vary",
  "access-control-allow-origin",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-max-age",
  "x-ft-viewer",
]);

/** Hop-by-hop / connection-scoped — never forward. */
const STRIP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
]);

/** The origin the visitor's BROWSER is on — the base every absolute
 * media URL the FreeTube service bakes into its API answers must carry.
 *
 * Why this matters: the service defaults to its own request origin
 * (http://localhost:3031) when nobody tells it otherwise. That address is
 * unreachable from a visitor's browser (they ride the gateway, not the
 * box), so every video the app tried to play pointed at a dead host and
 * the player spun forever — feeds, search and thumbnails all worked
 * (they ride same-origin relative paths) which is exactly the "videos
 * load forever, everything else works" report.
 *
 * Resolution order (most-truthful first):
 *  1. the fetch's Referer — the page's own origin, protocol included
 *     (the /ft iframe runs referrerPolicy=same-origin, so its API calls
 *     carry it; a reverse-proxy chain cannot lie about the scheme here);
 *  2. proxy headers — x-forwarded-host / host (+ x-forwarded-proto),
 *     the shape Caddy forwards;
 *  3. this request's own origin (direct localhost access).
 */
function publicOriginOf(req: Request, incoming: URL): string {
  const ref = req.headers.get("referer");
  if (ref) {
    try {
      const u = new URL(ref);
      if (u.protocol === "http:" || u.protocol === "https:") return `${u.protocol}//${u.host}`;
    } catch {
      /* unparseable referer — keep falling back */
    }
  }
  const xfHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = xfHost || req.headers.get("host") || incoming.host;
  const xfProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = xfProto === "https" || xfProto === "http" ? xfProto : "http";
  return `${proto}://${host}`;
}

export async function proxyToFtService(
  req: Request,
  opts: { strip?: string } = {},
): Promise<Response> {
  const incoming = new URL(req.url);
  // Forward the RAW pathname (the service decodes it itself — pre-decoding
  // here would double-decode paths that legitimately contain %XX).
  // `strip` removes the mount prefix: the program's index.html references
  // its renderer with RELATIVE urls (renderer.js, static/…), so a page
  // mounted at /ft/ asks for /ft/renderer.js — the service serves that
  // file at /renderer.js. This mirrors the Next-rewrite integration the
  // service's bridge was designed around (BASE-aware, prefix stripped).
  let rawPath = incoming.pathname;
  if (opts.strip) {
    if (rawPath === opts.strip || rawPath === opts.strip + "/") rawPath = "/";
    else if (rawPath.startsWith(opts.strip + "/")) rawPath = rawPath.slice(opts.strip.length);
  }
  const upstream = new URL(FT_UPSTREAM + rawPath + incoming.search);

  const fwdHeaders: HeadersInit = {};
  req.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (FWD_REQ_HEADERS.has(k) && !STRIP.has(k)) fwdHeaders[k] = value;
  });
  // Tell the service which origin the BROWSER is on, so the absolute
  // /stream URLs it bakes into API bodies resolve from the visitor's
  // machine (see publicOriginOf). Server-side callers (the Stream
  // section's yt.ts) never send a Referer and keep their own localhost
  // base — their re-hosting logic is untouched.
  fwdHeaders["x-veil-origin"] = publicOriginOf(req, incoming);

  // Stream request bodies through (POST /ipc/invoke payloads are small but
  // this keeps it future-proof); duplex is required for streaming bodies.
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers: fwdHeaders,
    redirect: "manual",
    ...(hasBody && req.body ? { body: req.body, duplex: "half" } : {}),
  };

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream.toString(), init);
  } catch (err) {
    return Response.json(
      { error: `veil ft-proxy: could not reach the FreeTube service (${String(err)})` },
      { status: 502, headers: { "content-type": "application/json", "cache-control": "no-store" } },
    );
  }

  const resHeaders = new Headers();
  upstreamRes.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (FWD_RES_HEADERS.has(k) && !STRIP.has(k)) resHeaders.set(k, value);
  });

  const ct = (upstreamRes.headers.get("content-type") || "").toLowerCase();

  // SSE: pass the stream straight through (buffering would kill events).
  if (ct.includes("text/event-stream")) {
    // Next's Response handles ReadableStream bodies; keep it un-stuffed.
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: resHeaders,
    });
  }

  // Uncompressed responses — including every media byte stream (video
  // ranges, HLS playlists, segments) — pass straight through. Buffering
  // them meant a `range: bytes=0-` request downloaded the WHOLE file
  // server-side before the browser saw its first byte: long videos took
  // minutes to start and every seek paid it again. Only compressed
  // bodies (the .json.br locales) still buffer, for the decompression
  // check below.
  const encEarly = upstreamRes.headers.get("content-encoding");
  if (!encEarly) {
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: resHeaders,
    });
  }

  // HEAD has no body to inspect — forward status + headers as-is.
  if (req.method === "HEAD") {
    resHeaders.delete("content-encoding");
    return new Response(null, { status: upstreamRes.status, headers: resHeaders });
  }

  // Compressed bodies: buffer once so the br/gzip pass-through can be
  // decided by comparing the advertised length with the real byte count.
  const buf = await upstreamRes.arrayBuffer().catch(() => new ArrayBuffer(0));
  const enc = upstreamRes.headers.get("content-encoding");
  const len = upstreamRes.headers.get("content-length");
  const stillCompressed = Boolean(enc) && len !== null && Number(len) === buf.byteLength;
  if (!stillCompressed) resHeaders.delete("content-encoding");

  return new Response(buf, { status: upstreamRes.status, headers: resHeaders });
}
