/**
 * Quasar Fetcher
 * --------------
 * Builds outbound requests from proxied requests (header mapping, referer
 * restoration, cookie jar injection) and builds client responses (header
 * filtering, body rewriting, streaming pass-through, charset handling).
 */

import { parseProxiedPath } from "./codec-server";
import { cookieHeader, storeSetCookies } from "./cookies";
import { rewriteHtml, rewriteCss, rewriteM3u8, rewriteJsonMedia } from "./rewriter";
import { HOOK_BUNDLE, quasarHeadParts } from "./hooks";
import { siteFixFor, type SiteFix } from "./site-fixes";
import { rewriteJs } from "./js-ast";
import { createHtmlStream } from "./html-stream";
import { assertSafeTarget } from "./security";
import { QUASAR_VERSION } from "./version";
// Raw, UNPATCHED undici fetch. The proxy engine must never go through
// Next.js's globalThis.fetch wrapper: its dev instrumentation (data-cache
// wrapping / response cloning) corrupts large streamed upstream bodies and
// can return synthetic "Unknown Error" responses (observed with multi-MB
// HTML pages). serverExternalPackages keeps undici unbundled.
import { fetch as undiciFetch } from "undici";

const MAX_REDIRECTS = 8;
/** How long to wait for response HEADERS (the body streams unrestricted after). */
const REQUEST_TIMEOUT_MS = 30_000;
/** One silent retry for idempotent requests that fail at the network level. */
const RETRY_DELAY_MS = 250;
/** Bodies larger than this are streamed untouched (JSON/m3u8 rewrites skipped). */
const MAX_REWRITE_BYTES = 12 * 1024 * 1024;

/** Headers we never copy from the browser request to the target request. */
const REQ_HEADER_BLOCKLIST = new Set([
  "host",
  "connection",
  "content-length",
  "accept-encoding",
  "cookie",
  "origin",
  "referer",
  "x-quasar-target",
  "x-quasar-referer",
  "upgrade-insecure-requests",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest",
  "sec-fetch-user",
  "sec-fetch-storage-access",
  "te",
  "trailer",
  "transfer-encoding",
  "expect",
  "keep-alive",
]);

/** Response headers we forward back to the browser. */
const FORWARD_RES_HEADERS = [
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
  "expires",
  "pragma",
  "vary",
  "accept-ranges",
  "content-range",
  "content-disposition",
  "content-length",
  "age",
  "retry-after",
];

/** Recover the real referer from our proxied referer URL. */
export function mapReferer(referer: string | null): string | undefined {
  if (!referer) return undefined;
  try {
    const u = new URL(referer);
    const parsed = parseProxiedPath(u.pathname, u.search);
    if (!parsed) return undefined;
    return parsed.origin + parsed.rest + u.search;
  } catch {
    return undefined;
  }
}

/** Iterate every header of the client request (some values may repeat). */
function forEachClientHeader(headers: Headers, fn: (name: string, value: string) => void): void {
  headers.forEach((value, name) => fn(name.toLowerCase(), value));
}

export interface ProxiedRequestResult {
  response: Response;
  finalUrl: string;
}

/** Hostname of the incoming request's Host header (port stripped, brackets kept). */
function clientHostnameOf(headers: Headers): string | undefined {
  const host = headers.get("host");
  if (!host) return undefined;
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end > 0 ? h.slice(0, end + 1) : h;
  }
  return h.split(":")[0];
}

/**
 * Fetch a target and hand redirects back to the browser (the route rewrites
 * the Location into a proxied path): every hop becomes its own proxied
 * request with native browser semantics — method downgrades, body handling,
 * per-hop cookie absorption and a canonical visible /p/ URL afterwards.
 */
export async function proxyFetch(
  method: string,
  startTarget: string,
  clientHeaders: Headers,
  body: ArrayBuffer | undefined
): Promise<ProxiedRequestResult> {
  const targetUrl = new URL(startTarget);

  // SSRF guard (also re-applied per hop by the browser-driven redirect chain).
  // The client host unlocks the same-host WS-bridge probe exemption.
  await assertSafeTarget(targetUrl, clientHostnameOf(clientHeaders));

  const jarCookie = cookieHeader(targetUrl.origin);

  const headers = new Headers();
  forEachClientHeader(clientHeaders, (name, value) => {
    if (!REQ_HEADER_BLOCKLIST.has(name)) headers.set(name, value);
  });
  if (jarCookie) headers.set("cookie", jarCookie);

  // Per-site request fixes (headers stripped/merged for this host).
  const fix = siteFixFor(startTarget);
  for (const name of fix?.stripRequestHeaders ?? []) headers.delete(name);
  for (const [name, value] of Object.entries(fix?.requestHeaders ?? {})) {
    headers.set(name, value);
  }

  // Restore the referer the target would have seen. The service worker
  // strips `referer` from proxied requests but preserves it under
  // x-quasar-referer, so hotlink/CSRF-referer checks keep working.
  const referer = mapReferer(
    clientHeaders.get("referer") ?? clientHeaders.get("x-quasar-referer")
  );
  if (referer) {
    try {
      if (new URL(referer).origin === targetUrl.origin) headers.set("referer", referer);
      else headers.set("referer", targetUrl.origin + "/");
    } catch {
      /* ignore */
    }
  }
  // Map Origin to the target so CORS-stateful endpoints behave.
  const clientOrigin = clientHeaders.get("origin");
  if (clientOrigin && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    headers.set("origin", targetUrl.origin);
  }

  let res: Response;
  try {
    res = await fetchWithRetry(startTarget, method, headers, body);
  } catch (err) {
    throw enhanceFetchError(err, startTarget);
  }

  // Absorb Set-Cookie from this response (3xx or final — login flows set
  // session cookies on the 302/303 responses themselves).
  const setCookies =
    typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  if (setCookies.length) storeSetCookies(targetUrl.origin, setCookies);

  return { response: res, finalUrl: startTarget };
}

/**
 * One outbound fetch attempt. The abort timer covers only the wait for
 * response HEADERS — once headers arrive it is cleared so long-lived bodies
 * (video ranges, HLS segments, EventSource/SSE, big downloads) are never
 * killed mid-stream.
 */
function fetchOnce(
  target: string,
  method: string,
  headers: Headers,
  body: ArrayBuffer | undefined
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new DOMException("Timed out waiting for response headers", "TimeoutError")),
    REQUEST_TIMEOUT_MS
  );
  return undiciFetch(target, {
    method,
    // Veil note: cast needed — the global (lib.dom-style) Headers type and
    // undici's own HeadersInit declaration differ at the TYPE level only;
    // undici accepts a standard Headers instance at runtime.
    headers: headers as unknown as import("undici").HeadersInit,
    body: method === "GET" || method === "HEAD" ? undefined : body,
    redirect: "manual",
    signal: ctrl.signal,
  })
    .then((res) => res as unknown as Response)
    .finally(() => clearTimeout(timer));
}

/**
 * Fetch with a single silent retry for idempotent requests hit by transient
 * network errors (DNS blips, reset connections). Redirects stay manual so the
 * retry never re-submits anything destructive.
 */
async function fetchWithRetry(
  target: string,
  method: string,
  headers: Headers,
  body: ArrayBuffer | undefined
): Promise<Response> {
  const idempotent = method === "GET" || method === "HEAD";
  let lastErr: unknown;
  for (let attempt = 0; attempt <= (idempotent ? 1 : 0); attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
    try {
      return await fetchOnce(target, method, headers, body);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function enhanceFetchError(err: unknown, target: string): Error {
  const cause = err instanceof Error ? err.message : String(err);
  let hint = "The target server could not be reached.";
  if (/getaddrinfo|ENOTFOUND|dns|EAI_AGAIN/i.test(cause)) {
    hint = "DNS lookup failed — the domain may not exist or is unreachable from this network.";
  } else if (/aborted|timeout|ECONNRESET|UND_ERR/i.test(cause)) {
    hint = "The connection timed out or was reset by the target.";
  } else if (/certificate|SSL|TLS/i.test(cause)) {
    hint = "TLS/SSL negotiation with the target failed.";
  } else if (/ECONNREFUSED/i.test(cause)) {
    hint = "The target refused the connection.";
  }
  const e = new Error(cause + "||" + hint + "||" + target);
  e.name = "QuasarFetchError";
  return e;
}

/** Copy safe response headers, dropping proxy-breaking and identity-breaking ones. */
export function buildClientHeaders(res: Response, finalUrl: string): Headers {
  const out = new Headers();
  for (const name of FORWARD_RES_HEADERS) {
    const v = res.headers.get(name);
    if (v !== null) out.set(name, v);
  }
  // undici transparently decompresses; stale identity headers would break clients.
  if (res.headers.has("content-encoding")) {
    out.delete("content-encoding");
    out.delete("content-length");
  }
  out.set("x-quasar-target", finalUrl);
  out.set("x-quasar-version", QUASAR_VERSION);
  return out;
}

function charsetOf(contentType: string): string {
  const m = contentType.match(/charset=([^;]+)/i);
  return m ? m[1].trim().replace(/["']/g, "") : "utf-8";
}

function decodeBuffer(buf: ArrayBuffer, charset: string): string {
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

export interface BodyOutcome {
  body: BodyInit | null;
  headers: Headers;
  status: number;
}

/** True when the response declares a body size we are willing to buffer. */
function sizeWithin(res: Response, max: number): boolean {
  const len = Number(res.headers.get("content-length") || 0);
  return !(len > max);
}

/** Build the head-injection block (page data + site config + hooks). */
function buildInjection(targetUrl: string, site: SiteFix | null): string {
  const { pageDataTag, siteConfigTag } = quasarHeadParts(targetUrl, site);
  return pageDataTag + siteConfigTag + `<script data-quasar="engine">${HOOK_BUNDLE}</script>`;
}

/** Produce the client-facing body for a proxied response (rewrite or stream). */
export async function buildResponseBody(
  res: Response,
  finalUrl: string,
  method: string
): Promise<BodyOutcome> {
  const headers = buildClientHeaders(res, finalUrl);
  const status = res.status;
  if (method === "HEAD" || status === 204 || status === 304) {
    return { body: null, headers, status };
  }

  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const lower = contentType.toLowerCase();
  const fix = siteFixFor(finalUrl);
  const flags = fix?.flags ?? {};

  if (lower.includes("text/html") || lower.includes("application/xhtml")) {
    const injection = buildInjection(finalUrl, fix);

    // Preferred path: stream the document through the incremental rewriter —
    // first paint happens while the rest of the body is still in flight.
    if (res.body && !flags.noStream) {
      try {
        headers.set("content-type", "text/html; charset=utf-8");
        headers.delete("content-length");
        headers.set("cache-control", "no-cache");
        const stream = createHtmlStream(finalUrl, {
          charset: charsetOf(lower),
          injection,
        });
        return { body: res.body.pipeThrough(stream), headers, status };
      } catch (err) {
        console.error("[quasar] html stream init failed, using buffered pipeline", err);
      }
    }

    // Buffered fallback (also used when the upstream gave us no stream).
    const buf = await res.arrayBuffer();
    const charset = charsetOf(lower);
    let html = decodeBuffer(buf, charset);
    try {
      html = rewriteHtml(html, finalUrl, { site: fix, injection });
    } catch (err) {
      console.error("[quasar] html rewrite failed", err);
    }
    headers.set("content-type", "text/html; charset=utf-8");
    headers.delete("content-length");
    // Rewritten HTML must never be served from the browser's HTTP cache —
    // stale bundles were the #1 source of "the page broke after an update".
    // no-cache still allows ETag revalidation, so nothing is wasted.
    headers.set("cache-control", "no-cache");
    return { body: html, headers, status };
  }

  // JavaScript — AST-based rewriting (acorn). Regex fallback is built into
  // rewriteJs for unparseable code; huge bundles stream untouched.
  let pathname = "";
  try {
    pathname = new URL(finalUrl).pathname;
  } catch {
    /* keep empty */
  }
  const isJs =
    /\b(?:javascript|ecmascript)\b/i.test(lower) || /\.(?:m?js|esm)$/i.test(pathname);
  const noAst = flags.noAst || process.env.QUASAR_NO_AST === "1";
  if (isJs && !noAst && sizeWithin(res, MAX_REWRITE_BYTES)) {
    try {
      const text = decodeBuffer(await res.arrayBuffer(), charsetOf(lower));
      const result = rewriteJs(text, finalUrl, /\.mjs$/i.test(pathname));
      if (result.changed) headers.delete("content-length");
      return { body: result.code, headers, status };
    } catch (err) {
      console.error("[quasar] js rewrite failed", err);
    }
  }

  // HLS playlists — rewrite segment/variant URIs so players stay in the tunnel.
  const isM3u8 =
    lower.includes("mpegurl") ||
    /\.m3u8($|\?)/i.test(finalUrl) ||
    /\.m3u8$/i.test(new URL(finalUrl).pathname);
  if (isM3u8 && sizeWithin(res, MAX_REWRITE_BYTES)) {
    try {
      const text = decodeBuffer(await res.arrayBuffer(), charsetOf(lower));
      headers.set("content-type", "application/vnd.apple.mpegurl");
      headers.delete("content-length");
      return { body: rewriteM3u8(text, finalUrl), headers, status };
    } catch (err) {
      console.error("[quasar] m3u8 rewrite failed", err);
    }
  }

  // JSON payloads — conservatively proxy media URLs (thumbnails, posters,
  // video sources) discovered as string values. Non-media values are never
  // touched, so signatures / issuer fields / redirect URIs stay intact.
  if (
    (lower.includes("application/json") || lower.includes("+json")) &&
    !lower.includes("jwt") &&
    !flags.noJsonMedia &&
    sizeWithin(res, MAX_REWRITE_BYTES)
  ) {
    try {
      const text = decodeBuffer(await res.arrayBuffer(), charsetOf(lower));
      const rewritten = rewriteJsonMedia(text, finalUrl);
      headers.delete("content-length");
      return { body: rewritten === text ? text : rewritten, headers, status };
    } catch (err) {
      console.error("[quasar] json rewrite failed", err);
    }
  }

  if (lower.includes("text/css")) {
    const buf = await res.arrayBuffer();
    const charset = charsetOf(lower);
    let css = decodeBuffer(buf, charset);
    try {
      css = rewriteCss(css, finalUrl);
    } catch (err) {
      console.error("[quasar] css rewrite failed", err);
    }
    headers.set("content-type", "text/css; charset=utf-8");
    headers.delete("content-length");
    return { body: css, headers, status };
  }

  // Everything else streams straight through (video ranges, images, JSON, JS…).
  return { body: res.body, headers, status };
}
