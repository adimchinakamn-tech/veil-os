/**
 * Veil — catch-all fetch endpoint.
 *
 * GET /api/p/https/example.com/path?q=1
 *   -> loads https://example.com/path?q=1 server-side,
 *      resolves every URL so subresources stay on this origin,
 *      drops framing/blocking headers, and streams the result back.
 */

import { captureSetCookies, cookieHeaderFor } from "@/lib/veil/jar";
import { isAdHost } from "@/lib/veil/adblock";
import { viewerFromRequest } from "@/lib/veil/viewer";
import { is4kWallpaperThumb, isMotionbgsMedia, serveMotionbgsMedia } from "@/lib/veil/mbgs-media";
import { curlFetchText } from "@/lib/veil/curl-fetch";
import {
  extractTarget,
  rewriteCss,
  rewriteHtml,
  rewriteTextUrls,
  errorPage,
  resolveAndRoute,
  serpPage,
  parseBingRss,
  parseBraveSerp,
  swShim,
  wallPage,
  type SerpItem,
} from "@/lib/veil/rewrite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIMEOUT_MS = 25_000;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Second-chance user agent for CDNs that reject browser UAs over HTTP/1.1. */
const FALLBACK_UA = "Veil/1.0 (+https://veil.app)";

/** Hosts that must never be fetched (SSRF protection). */
const BLOCKED_HOST =
  /^(localhost$|localhost\.|127\.|0\.0\.0\.0$|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|\[::1\]$|fc00:|fd[0-9a-f]{2}:|fe80:|.+\.local$|.+\.internal$|.+\.localhost$)/i;

/**
 * Request headers never forwarded upstream: hop-by-hop headers, the ones we
 * re-derive ourselves (origin/referer/cookie/UA policy) and the runtime's
 * page hint. Everything else (incl. custom x-* API headers) passes through so
 * SPA API calls (e.g. YouTube innertube) work unmodified.
 */
const DROP_REQ_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "upgrade",
  "proxy-connection",
  "te",
  "trailer",
  "content-length",
  "transfer-encoding",
  "accept-encoding",
  "cookie",
  "cookie2",
  "origin",
  "referer",
  "x-veil-page",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-real-ip",
  "via",
  "forwarded",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest",
  "sec-fetch-user",
]);

/** Response headers we strip before returning content to the client. */
const STRIP_RES_HEADERS = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "strict-transport-security",
  "set-cookie",
  "set-cookie2",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "alt-svc",
  "report-to",
  "nel",
]);

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function blockedResponse(target: string): Response {
  return htmlResponse(
    errorPage(
      target,
      "This address is blocked.",
      "Private and internal network addresses cannot be fetched for security reasons."
    ),
    403
  );
}

/* ── bot-wall detection ──────────────────────────────────────────────────
 * Big-name sites refuse datacenter IPs with their own challenge/block
 * pages (Cloudflare "Just a moment...", Reddit "blocked by network
 * security", "Access denied", ...). Left alone, those pages render as a
 * confusing blob inside the veil and read like a Veil bug. We detect the
 * signature, give the fetch ONE second chance through curl's TLS
 * fingerprint (the same trick the wallpaper accelerator uses -- some
 * Cloudflare configurations wall only the runtime's undici fingerprint),
 * and if the site still refuses, render Veil's own honest explanation
 * page instead of the site's wall.
 *
 * Gated on status 401/403/429/503 AND a body signature so ordinary
 * pages that merely mention "firewall" (status 200) never trigger. */
const BOT_WALL_BODY =
  /just a moment|attention required|checking your browser|verify (you are|that you're|you're) human|press & hold|blocked by network security|you've been blocked|ddos protection|firewall block|request blocked|unusual traffic|cf-challenge|challenge-platform|cf-error-details|captcha-delivery|px-captcha/i;

function looksBotWalled(status: number, body: string): boolean {
  if (![401, 403, 429, 503].includes(status)) return false;
  // Scan the WHOLE body: Reddit's block page carries its message inside a
  // JS bundle near the END of a 220KB shell (verified live), so a head
  // slice misses it. The status gate keeps ordinary pages (200) out, and
  // one regex pass over a few MB is still sub-millisecond per KB.
  return BOT_WALL_BODY.test(body);
}

/** True for search-engine SERP URLs that Veil renders itself. */
function isBingSerp(u: URL): boolean {
  return (
    /^(www\.)?bing\.com$/i.test(u.hostname) &&
    (u.pathname === "/search" || u.pathname === "/search/")
  );
}

function isBraveSerp(u: URL): boolean {
  return /^search\.brave\.com$/i.test(u.hostname) && u.pathname === "/search";
}

/**
 * Fetch Google News' RSS search feed (server-rendered XML, no JS needed).
 *
 * WHY: Bing's RSS endpoint is effectively bot-walled from this server's
 * egress — verified Sep-16 it echoes the query in the feed title but fills
 * <item>s with UNRELATED cached results ("cute cats" returned German
 * AirPods threads, cm/meter conversions, NZ TV listings). Google News' RSS
 * is open, stable and query-honest, so it is the Bing engine's primary
 * source; Bing's own feed remains the fallback for if/when it heals.
 * Same <item><title><link><description> shape, so parseBingRss parses it.
 */
async function fetchGnewsRss(q: string): Promise<SerpItem[] | null> {
  const rssUrl = new URL("https://news.google.com/rss/search");
  rssUrl.searchParams.set("q", q);
  rssUrl.searchParams.set("hl", "en-US");
  rssUrl.searchParams.set("gl", "US");
  rssUrl.searchParams.set("ceid", "US:en");
  try {
    const res = await fetch(rssUrl.href, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/rss+xml, application/xml, text/xml, */*",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
      redirect: "follow",
    });
    if (!res.ok) return null;
    return parseBingRss(await res.text());
  } catch {
    return null;
  }
}

/** Fetch Bing's RSS SERP (server-rendered, no JS needed). */
async function fetchBingRss(q: string): Promise<SerpItem[] | null> {
  const rssUrl = new URL("https://www.bing.com/search");
  rssUrl.searchParams.set("q", q);
  rssUrl.searchParams.set("format", "rss");
  rssUrl.searchParams.set("count", "20");
  try {
    const res = await fetch(rssUrl.href, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/rss+xml, application/xml, text/xml, */*",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
      redirect: "follow",
    });
    if (!res.ok) return null;
    return parseBingRss(await res.text());
  } catch {
    return null;
  }
}

/**
 * In-memory SERP cache. Brave rate-limits this server's IP aggressively
 * (a burst of ~2 requests, then 429 for a minute), so identical queries are
 * served from memory for 10 minutes. Local-memory only — no middleware.
 */
const SERP_CACHE = new Map<string, { at: number; items: SerpItem[] }>();
const SERP_CACHE_TTL = 10 * 60 * 1000;
const SERP_CACHE_MAX = 60;

function serpCacheGet(key: string): SerpItem[] | null {
  const hit = SERP_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > SERP_CACHE_TTL) {
    SERP_CACHE.delete(key);
    return null;
  }
  return hit.items;
}

function serpCacheSet(key: string, items: SerpItem[]): void {
  if (SERP_CACHE.size >= SERP_CACHE_MAX) {
    const oldest = SERP_CACHE.keys().next().value;
    if (oldest !== undefined) SERP_CACHE.delete(oldest);
  }
  SERP_CACHE.set(key, { at: Date.now(), items });
}

/** Fetch Brave's HTML SERP and parse the server-rendered results. */
async function fetchBraveSerp(q: string): Promise<SerpItem[] | null> {
  const braveUrl = new URL("https://search.brave.com/search");
  braveUrl.searchParams.set("q", q);
  try {
    const res = await fetch(braveUrl.href, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
      redirect: "follow",
    });
    if (!res.ok) return null;
    const items = parseBraveSerp(await res.text());
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

/**
 * Search engines whose HTML SERP needs JavaScript render as an empty shell
 * through the veil (Bing) or rate-limit aggressively (Brave, 429 per IP).
 * For those we fetch a JS-free representation ourselves — Brave's HTML parses
 * server-side, Bing's RSS feed is plain XML — and render Veil's own results
 * page. Returns null on any failure so the request falls through to the
 * normal proxy path (best effort).
 */
async function serpResponse(targetUrl: URL): Promise<Response | null> {
  const q = (targetUrl.searchParams.get("q") || "").trim();
  if (!q) return null;

  if (isBraveSerp(targetUrl)) {
    const cached = serpCacheGet("brave:" + q.toLowerCase());
    if (cached) {
      return htmlResponse(
        serpPage("Brave", "https://search.brave.com/search", targetUrl.href, q, cached)
      );
    }
    const brave = await fetchBraveSerp(q);
    if (brave && brave.length > 0) {
      serpCacheSet("brave:" + q.toLowerCase(), brave);
      return htmlResponse(
        serpPage("Brave", "https://search.brave.com/search", targetUrl.href, q, brave)
      );
    }
    // Brave was rate-limited or changed markup — fall back to the open feeds
    // so search keeps working (labelled honestly). Google News' RSS first —
    // Bing's own feed is bot-walled from this egress and answers with
    // unrelated cached items.
    const gnews = await fetchGnewsRss(q);
    if (gnews && gnews.length > 0) {
      return htmlResponse(
        serpPage(
          "Brave",
          "https://search.brave.com/search",
          targetUrl.href,
          q,
          gnews.slice(0, 10),
          "Brave was busy — served from Google News' open feed"
        )
      );
    }
    const bing = await fetchBingRss(q);
    if (bing && bing.length > 0) {
      return htmlResponse(
        serpPage(
          "Brave",
          "https://search.brave.com/search",
          targetUrl.href,
          q,
          bing.slice(0, 10),
          "Brave was busy — Bing fallback"
        )
      );
    }
    return null;
  }

  if (isBingSerp(targetUrl)) {
    const cached = serpCacheGet("bing:" + q.toLowerCase());
    if (cached) {
      return htmlResponse(
        serpPage("Bing", "https://www.bing.com/search", targetUrl.href, q, cached)
      );
    }
    // Primary: Google News' open RSS (query-honest). Fallback: Bing's own
    // RSS feed (bot-walled from this egress — often returns unrelated items).
    const gnews = await fetchGnewsRss(q);
    if (gnews && gnews.length > 0) {
      serpCacheSet("bing:" + q.toLowerCase(), gnews);
      return htmlResponse(
        serpPage(
          "Bing",
          "https://www.bing.com/search",
          targetUrl.href,
          q,
          gnews.slice(0, 10),
          "served from Google News' open feed — Bing's own feed ignores queries from this server"
        )
      );
    }
    const bing = await fetchBingRss(q);
    if (bing && bing.length > 0) {
      serpCacheSet("bing:" + q.toLowerCase(), bing);
      return htmlResponse(
        serpPage("Bing", "https://www.bing.com/search", targetUrl.href, q, bing)
      );
    }
    return null;
  }

  return null;
}

/**
 * True when an HTML document request is the top of a veiled browsing context
 * (the main iframe's initial load or a same-site in-frame navigation), as
 * opposed to a nested foreign embed. The referer tells them apart:
 *  - no referer / non-veiled referer  -> main frame (the app embeds with
 *    referrerPolicy=no-referrer; in-frame navs send veiled referers)
 *  - veiled referer on the same host or registrable domain -> same-site nav
 *  - veiled referer on a foreign site -> nested embed (do not stamp)
 */
function isMainVeilDocument(req: Request, targetUrl: URL): boolean {
  const ref = req.headers.get("referer");
  if (!ref) return true;
  try {
    const ru = new URL(ref);
    const rt = extractTarget(ru.pathname, ru.search);
    if (!rt) return true; // referer is our own app shell, not a veiled page
    const refHost = new URL(rt).hostname.toLowerCase();
    const targetHost = targetUrl.hostname.toLowerCase();
    const reg = (h: string) => h.split(".").slice(-2).join(".");
    return refHost === targetHost || reg(refHost) === reg(targetHost);
  } catch {
    return true;
  }
}

async function handle(req: Request): Promise<Response> {
  // Per-viewer cookie jar scoping (pseudonymous id — see viewer.ts).
  const viewer = viewerFromRequest(req as Parameters<typeof viewerFromRequest>[0]);
  const u = new URL(req.url);
  const target = extractTarget(u.pathname, u.search);

  if (!target) {
    return Response.json(
      { error: "Invalid address. Expected /api/p/{https|http}/{host}/{path}." },
      { status: 400 }
    );
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return htmlResponse(errorPage(target, "That URL could not be parsed."), 400);
  }

  // SSRF guard: block private/internal hosts and unusual ports.
  if (BLOCKED_HOST.test(targetUrl.hostname) || targetUrl.username || targetUrl.password) {
    return blockedResponse(target);
  }
  if (targetUrl.port && !["80", "443"].includes(targetUrl.port)) {
    return blockedResponse(target);
  }

  // Search SERPs: render Veil's own results page (Brave HTML / Bing RSS).
  if (isBraveSerp(targetUrl) || isBingSerp(targetUrl)) {
    const serp = await serpResponse(targetUrl);
    if (serp) return serp;
    // Engine fetch failed → fall through to the normal proxy path.
  }

  // Ad / tracker / popup-network hosts: empty response, cached for a day.
  // Scripts fail silently, iframes stay blank and pixels never load.
  if (isAdHost(targetUrl.hostname)) {
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": "public, max-age=86400",
        "x-veil-blocked": "ad",
      },
    });
  }

  // motionbgs.com media accelerator — the applied live wallpapers and their
  // hover previews stream through here. Instead of proxying every byte
  // range live from motionbgs' Cloudflare (1-2s per range, intermittent
  // 403 challenges on the runtime fetch fingerprint, and never browser-
  // cached because of no-store), the accelerator:
  //   - downloads via curl (the fingerprint Cloudflare actually allows)
  //     into a bounded disk cache — a looping wallpaper is fetched exactly
  //     once, ever, per video, then served locally with full range support
  //   - answers immutable + etag so the BROWSER caches it too (repeat
  //     visits never touch the server)
  //   - live-streams cold downloads (first bytes as curl writes them)
  //   - honors ?vw=1080 (preview-quality variant for hovers/popups) and
  //     canonicalizes stale/low-res paths up to the 4K render
  // Any accelerator failure falls through to the generic proxy below.
  if (
    (isMotionbgsMedia(targetUrl) || is4kWallpaperThumb(targetUrl)) &&
    (req.method === "GET" || req.method === "HEAD")
  ) {
    try {
      return await serveMotionbgsMedia(targetUrl, req);
    } catch {
      /* fall through to the generic proxy */
    }
  }

  // ---- build the upstream request headers ----
  // Forward everything except the drop-list; the caller's own browser UA and
  // custom API headers (x-goog-*, authorization…) survive, which is what makes
  // SPA endpoints accept our server-side calls.
  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (!DROP_REQ_HEADERS.has(k.toLowerCase())) headers.set(k, v);
  });
  headers.set("user-agent", req.headers.get("user-agent") || USER_AGENT);
  if (!headers.has("accept")) headers.set("accept", "*/*");
  if (!headers.has("accept-language")) headers.set("accept-language", "en-US,en;q=0.9");
  headers.set("accept-encoding", "identity");

  // Replay stored cookies for this host (server-side jar, viewer-scoped).
  try {
    const jarCookie = await cookieHeaderFor(viewer, targetUrl.hostname, targetUrl.pathname);
    if (jarCookie) headers.set("cookie", jarCookie);
  } catch {
    /* jar unavailable — proceed without cookies */
  }

  // Origin/Referer: prefer the veiled page URL reported by the runtime
  // (x-veil-page), falling back to the target itself.
  let refUrl: URL = targetUrl;
  const pageHint = req.headers.get("x-veil-page");
  if (pageHint) {
    try {
      const p = new URL(pageHint);
      if (p.protocol === "http:" || p.protocol === "https:") refUrl = p;
    } catch {
      /* ignore malformed hint */
    }
  }
  try {
    headers.set("origin", refUrl.origin);
    headers.set(
      "referer",
      refUrl.href.length > 1800 ? refUrl.origin + refUrl.pathname : refUrl.href
    );
  } catch {
    /* non-special URL — skip */
  }

  let body: ArrayBuffer | undefined;
  if (!["GET", "HEAD"].includes(req.method)) {
    body = await req.arrayBuffer();
    if (body.byteLength === 0) body = undefined;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  const doFetch = (ua?: string) => {
    const h = ua ? new Headers(headers) : headers;
    if (ua) h.set("user-agent", ua);
    return fetch(target, {
      method: req.method,
      headers: h,
      body,
      redirect: "manual",
      signal: ctrl.signal,
      cache: "no-store",
    }) as Promise<Response>;
  };

  let upstream: Response;
  try {
    upstream = await doFetch();
    if (upstream.status === 403 || upstream.status === 429) {
      // Retry once with the neutral client UA (some CDNs only allow
      // identified clients on HTTP/1.1 connections).
      try {
        const retried = await doFetch(FALLBACK_UA);
        if (retried.status < 400) upstream = retried;
      } catch {
        /* keep the original response */
      }
    }
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "AbortError"
        ? "The site took too long to respond (25s timeout)."
        : "The request failed — the site may be unreachable from this server.";
    const detail = e instanceof Error && e.message && e.name !== "AbortError" ? e.message.slice(0, 200) : undefined;
    return htmlResponse(errorPage(target, msg, detail), 502);
  } finally {
    clearTimeout(timer);
  }

  // Follow redirects ourselves so the Location header stays on this origin.
  const status = upstream.status;
  if ([301, 302, 303, 307, 308].includes(status)) {
    // Cookies set on the redirect hop belong in the jar.
    try {
      await captureSetCookies(viewer, targetUrl.hostname, upstream.headers);
    } catch {
      /* non-fatal */
    }
    const loc = upstream.headers.get("location");
    if (loc) {
      const routed = resolveAndRoute(loc, target);
      return new Response(null, {
        status,
        headers: { location: routed, "cache-control": "no-store" },
      });
    }
    return new Response(null, { status, headers: { "cache-control": "no-store" } });
  }

  // Capture upstream cookies into the jar (they never reach the client copy).
  try {
    await captureSetCookies(viewer, targetUrl.hostname, upstream.headers);
  } catch {
    /* non-fatal */
  }

  // Copy through safe headers.
  const ct0 = (upstream.headers.get("content-type") || "").toLowerCase();
  const outHeaders = new Headers();
  upstream.headers.forEach((v, k) => {
    if (!STRIP_RES_HEADERS.has(k.toLowerCase())) outHeaders.set(k, v);
  });
  outHeaders.set("cache-control", "no-store");

  // Script-cache lane: `Sec-Fetch-Dest: script` fetches (page <script>s,
  // worker module imports) get a short browser cache. Worker module
  // imports are latency-critical — BareMux pings a freshly-created
  // SharedWorker with a 1.5s deadline WHILE it imports its multi-MB
  // transport bundle; a cold multi-second proxy hop makes the ping time
  // out and the site declares the port dead ("websocket did not open",
  // the embedded-browser portals die exactly there). The veil never
  // rewrites plain JS bodies, so cached bytes equal fresh bytes; five
  // minutes is long enough to cover a reload and short enough that a
  // site's deployed JS changes show up almost immediately.
  const fetchDest = (req.headers.get("sec-fetch-dest") || "").toLowerCase();
  const isScriptCacheable =
    fetchDest === "script" &&
    (ct0.includes("javascript") || ct0.includes("ecmascript") || ct0.includes("module"));
  if (isScriptCacheable) {
    outHeaders.set("cache-control", "public, max-age=300");
  }

  // Contain any Service-Worker-Allowed scope inside the veiled path space.
  // An upstream "/" would otherwise let a registered worker claim the app's
  // OWN root paths (the browser trusts the header); re-anchoring it onto
  // /api/p/<site>/ keeps the worker contained to its site's lane.
  const swa = outHeaders.get("service-worker-allowed");
  if (swa) {
    const contained = resolveAndRoute(swa, target);
    if (contained && contained !== swa) outHeaders.set("service-worker-allowed", contained);
  }

  // Bodyless statuses (204/205/304 — beacons, pixels, ad endpoints) must not
  // carry a body, or the Response constructor throws.
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status, headers: outHeaders });
  }

  const ct = ct0;
  const isHtml =
    ct.includes("text/html") ||
    ct.includes("application/xhtml") ||
    ct === "" ||
    // gn-math.dev serves its game documents as text/plain (the site's own
    // shell injects them client-side); inside the veil they must render as
    // real documents — full HTML rewrite, base-tag fix, runtime injection.
    (ct.startsWith("text/plain") && /\.(html?|xhtml)$/i.test(targetUrl.pathname));
  const isCss = ct.includes("text/css");

  if (isHtml && !ct.includes("download")) {
    // Decode with the page's declared charset, then serve as UTF-8.
    let charset = "utf-8";
    const cs = ct.match(/charset=["']?([\w-]+)/i);
    if (cs) charset = cs[1].toLowerCase();
    const buf = await upstream.arrayBuffer();
    let text: string;
    try {
      text = new TextDecoder(charset, { fatal: false }).decode(buf);
    } catch {
      text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    }
    if (!/<html|<head|<body|<!doctype/i.test(text)) {
      // Probably not really HTML (JSON API etc.) — pass through untouched.
      return new Response(buf, { status, headers: outHeaders });
    }
    // Bot-walled? One second chance through curl's TLS fingerprint (some
    // walls only block the runtime's undici fingerprint), and if the site
    // still refuses, Veil's own honest explanation page instead of the
    // site's confusing "network security" blob.
    if (looksBotWalled(status, text)) {
      let rescued = false;
      if (req.method === "GET") {
        try {
          const curled = await curlFetchText(target, {
            timeoutS: 20,
            referer: refUrl.origin,
          });
          if (
            curled.status >= 200 &&
            curled.status < 400 &&
            /<html|<head|<body|<!doctype/i.test(curled.body) &&
            !looksBotWalled(curled.status, curled.body)
          ) {
            text = curled.body;
            rescued = true;
          }
        } catch {
          /* still walled — fall through to the wall page */
        }
      }
      if (!rescued) {
        return htmlResponse(wallPage(target, targetUrl.hostname), 403);
      }
    }
    // JS-visible cookies from the jar are replayed inside the page so
    // document.cookie reads work for the rendered site.
    let cookies: string[] | undefined;
    try {
      const jsCookies = await cookieHeaderFor(viewer, targetUrl.hostname, targetUrl.pathname, {
        jsVisible: true,
      });
      if (jsCookies) cookies = jsCookies.split("; ");
    } catch {
      /* jar unavailable */
    }
    const rewritten = rewriteHtml(text, target, { cookies });
    outHeaders.set("content-type", "text/html; charset=utf-8");
    // Stamp which site this document is veiling (HttpOnly: the page's own JS
    // — including cookie sweeps inside app shells — cannot see or delete it).
    // The root catch-all reads it to route raw same-origin requests (anti-
    // tamper app shells like YouTube issue those with raw referers).
    // Only the top of a veiled browsing context may stamp: nested foreign
    // embeds (e.g. YouTube's passive accounts.google.com sign-in iframe)
    // must not hijack the stamp.
    if (isMainVeilDocument(req, targetUrl)) {
      outHeaders.append(
        "set-cookie",
        `veil-site=${encodeURIComponent(targetUrl.origin)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`
      );
    }
    return new Response(rewritten, { status, headers: outHeaders });
  }

  if (isCss) {
    let charset = "utf-8";
    const cs = ct.match(/charset=["']?([\w-]+)/i);
    if (cs) charset = cs[1].toLowerCase();
    const buf = await upstream.arrayBuffer();
    let text: string;
    try {
      text = new TextDecoder(charset, { fatal: false }).decode(buf);
    } catch {
      text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    }
    const rewritten = rewriteCss(text, target);
    outHeaders.set("content-type", "text/css; charset=utf-8");
    return new Response(rewritten, { status, headers: outHeaders });
  }

  // Text bodies that embed absolute URLs (JSON APIs, DASH/HLS manifests,
  // feeds): rewrite them so runtime-set resources (video streams, images,
  // player endpoints) are fetched through the proxy. This is what lets
  // YouTube actually play video instead of showing an offline error.
  const isJson = ct.includes("json");
  const isXml = ct.includes("xml") && !ct.includes("xhtml");
  const isManifest = ct.includes("mpegurl");
  const isPlain = ct.startsWith("text/plain");
  if (isJson || isXml || isManifest || isPlain) {
    const buf = await upstream.arrayBuffer();
    if (buf.byteLength && buf.byteLength <= 8_000_000) {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
      if (text.includes("http://") || text.includes("https://")) {
        const head = text.slice(0, 64).trim();
        const mutable =
          isJson ||
          isXml ||
          isManifest ||
          head.startsWith("{") ||
          head.startsWith("[") ||
          head.includes("#EXTM3U");
        if (mutable) {
          const rewritten = rewriteTextUrls(text, target);
          const baseCt = (ct.split(";")[0] || "text/plain").trim();
          outHeaders.set("content-type", baseCt + "; charset=utf-8");
          return new Response(rewritten, { status, headers: outHeaders });
        }
      }
    }
    return new Response(buf, { status, headers: outHeaders });
  }

  // Worker scripts — service workers carry a `Service-Worker: script`
  // request header; plain/shared/worklet workers carry
  // `Sec-Fetch-Dest: worker|sharedworker|serviceworker|…`. Buffer the body
  // and prepend the veil routing shim so the worker's own fetches /
  // importScripts / WebSocket dials stay on the veil. Without it a
  // registered SW serves raw paths that land here unrouted and 404, and a
  // transport worker (BareMux/wisp — the engine inside embedded site
  // browsers) dials raw same-origin ws:// paths that die with "websocket
  // did not open": both boot SW-dependent sites into a broken shell.
  const fetchDestCached = fetchDest;
  const isWorkerScript =
    (req.headers.get("service-worker") || "").includes("script") ||
    fetchDestCached === "worker" ||
    fetchDestCached === "sharedworker" ||
    fetchDestCached === "serviceworker" ||
    fetchDestCached === "audioworklet" ||
    fetchDestCached === "paintworklet";
  if (isWorkerScript) {
    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > 0 && buf.byteLength <= 4_000_000) {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
      const shimmed = swShim(target) + "\n;" + text;
      const baseCt = (ct.split(";")[0] || "text/javascript").trim();
      outHeaders.set("content-type", baseCt + "; charset=utf-8");
      /* plain/shared worker scripts are cacheable too (deterministic shim);
       * the MAIN service-worker script stays no-store so update checks
       * always observe the live copy */
      if (fetchDestCached === "worker" || fetchDestCached === "sharedworker") {
        outHeaders.set("cache-control", "public, max-age=300");
      }
      return new Response(shimmed, { status, headers: outHeaders });
    }
    return new Response(buf, { status, headers: outHeaders });
  }

  // Everything else streams straight through (images, fonts, video, …).
  return new Response(upstream.body, { status, headers: outHeaders });
}

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
  handle as HEAD,
};
