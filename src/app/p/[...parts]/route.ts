/**
 * Veil — Quasar engine proxy endpoint (v1.3.8).
 * ------------------------------------------------------------------
 * Ported from the user-uploaded quasar-proxy engine (src/app/p/[...parts]/route.ts).
 *
 * GET /p/<blob>/<path>?<query>
 *
 * The Quasar engine's main reverse-proxy route. Supports every common HTTP
 * method, browser-driven redirect following with per-hop cookie handling,
 * streaming HTML rewriting, AST-based JS rewriting, CSS/HLS/JSON rewriting,
 * binary streaming, branded error pages — plus the security layer (SSRF
 * guard, rate limit, optional password gate) and the v1.3.8 network-layer
 * adblocker.
 *
 * Special blob: `!rel` resolves the rest-path against the real target of the
 * request's referer. The service worker uses this for escaped root-relative
 * requests because it cannot decrypt AES blobs itself.
 *
 * VEIL ADDITION: a curl second chance for walled documents — before giving
 * up on a 401/403/429, retry once through curl's TLS fingerprint (some CDNs
 * wall undici while curl passes; verified from this box).
 */

import { NextRequest } from "next/server";
import { parseProxiedPath, proxyPath } from "@/lib/veil/quasar/codec-server";
import { proxyFetch, buildResponseBody, mapReferer } from "@/lib/veil/quasar/fetcher";
import { errorPageResponse } from "@/lib/veil/quasar/error-page";
import { assertSafeTarget, allowRequest, clientKeyOf, gate } from "@/lib/veil/quasar/security";
import { isAdUrl } from "@/lib/veil/quasar/adblock";
import { QUASAR_VERSION } from "@/lib/veil/quasar/version";
import { curlFetchText } from "@/lib/veil/curl-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIMPLE_HINTS: [RegExp, string][] = [
  [/getaddrinfo|ENOTFOUND|dns-failure|dns/i, "DNS lookup failed — the domain may not exist or is unreachable."],
  [/blocked-private|blocked-host|blocked-credentials/, "The request was blocked by the proxy's security policy (private/loopback targets are not allowed)."],
  [/blocked-scheme/, "Only http and https URLs can be proxied."],
  [/aborted|timeout|UND_ERR|ECONNRESET/i, "The connection timed out or was reset."],
  [/certificate|SSL|TLS/i, "TLS negotiation with the target failed."],
  [/ECONNREFUSED/i, "The target refused the connection."],
];

/** Statuses that mean "the edge does not want THIS client" — worth a curl
 * retry: node's fetch (undici) carries a TLS fingerprint some CDNs wall
 * (Wikimedia's edge 403s undici while curl passes — same URL, same UA,
 * verified from this box). */
const WALL_STATUSES = [401, 403, 429];

async function handle(req: NextRequest): Promise<Response> {
  const started = Date.now();
  const url = new URL(req.url);
  const method = req.method;

  // Optional password gate (no-op unless QUASAR_PASSWORD is set).
  const denied = gate(req, method === "GET");
  if (denied) return denied;

  // Per-client rate limiting.
  if (!allowRequest(clientKeyOf(req))) {
    return errorPageResponse(429, "Too many requests through this proxy — slow down a little.", url.pathname, "The per-client rate limit was hit. Retry in a few seconds.");
  }

  // `!rel` blobs are resolved against the referer's real target.
  const refererTarget = mapReferer(
    req.headers.get("x-quasar-referer") ?? req.headers.get("referer")
  );
  const parsed = parseProxiedPath(url.pathname, url.search, refererTarget);
  if (!parsed) {
    return errorPageResponse(400, "The proxied URL could not be decoded.", url.pathname, "Malformed Quasar URL blob.");
  }

  let body: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    try {
      body = await req.arrayBuffer();
    } catch {
      body = undefined;
    }
  }

  // ---- Adblocker, network layer (v1.3.8) ----------------------------
  // Known ad/tracker endpoints get an empty 204 before any upstream
  // connection: kills ad scripts, beacons, ad iframes and analytics for
  // every proxied page, no matter how the URL was constructed. The service
  // worker counts the x-quasar-blocked header and reports it to the UI.
  if (isAdUrl(parsed.target)) {
    console.log(`[quasar] BLOCKED (ad) ${method} ${parsed.target.slice(0, 120)}`);
    return new Response(null, {
      status: 204,
      headers: {
        "x-quasar-blocked": "ad",
        "x-quasar-version": QUASAR_VERSION,
        "access-control-allow-origin": "*",
      },
    });
  }

  try {
    const { response: res, finalUrl } = await proxyFetch(method, parsed.target, req.headers, body);

    /* curl second chance for walled documents — before giving up on a
     * 401/403/429, retry once through curl's TLS fingerprint. Covers HTML
     * plus the small text assets sites need to actually render (CSS, JS,
     * SVG) — big media keeps streaming through the normal lane. */
    if (method === "GET" && WALL_STATUSES.includes(res.status)) {
      const ct = (res.headers.get("content-type") ?? "").toLowerCase();
      const curlable =
        ct.includes("text/html") ||
        ct.includes("application/xhtml") ||
        ct.includes("text/css") ||
        ct.includes("javascript") ||
        ct.includes("ecmascript") ||
        ct.includes("image/svg+xml") ||
        ct.includes("application/xml") ||
        ct.includes("text/plain") ||
        ct === "";
      if (curlable) {
        try {
          const curled = await curlFetchText(parsed.target, {
            accept: ct.includes("text/css")
              ? "text/css,*/*;q=0.1"
              : ct.includes("javascript")
                ? "*/*"
                : "text/html,application/xhtml+xml,*/*;q=0.8",
          });
          if (
            curled.status >= 200 &&
            curled.status < 400 &&
            curled.body.length < 4_000_000
          ) {
            try {
              await res.body?.cancel();
            } catch {
              /* already gone */
            }
            const synth = new Response(curled.body, {
              status: curled.status,
              headers: { "content-type": ct || "text/html; charset=utf-8" },
            });
            const outcome = await buildResponseBody(synth, parsed.target, method);
            console.log(
              `[quasar] ${method} ${parsed.target} -> ${curled.status} via curl second chance (${Date.now() - started}ms)`
            );
            return new Response(outcome.body, { status: outcome.status, headers: outcome.headers });
          }
        } catch {
          /* curl failed — fall through with the original response */
        }
      }
    }

    // Redirect chain handed back to the browser: every hop becomes its own
    // proxied request with native semantics (method downgrades, per-hop
    // cookie absorption, canonical visible /p/ URL afterwards).
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (loc) {
        try {
          const next = new URL(loc, finalUrl);
          const headers = new Headers({ location: proxyPath(next.href) });
          res.body?.cancel();
          console.log(`[quasar] ${method} ${finalUrl} -> ${res.status} (redirect, ${Date.now() - started}ms)`);
          return new Response(null, { status: res.status, headers });
        } catch {
          /* fall through to normal handling */
        }
      }
    }

    const outcome = await buildResponseBody(res, finalUrl, method);
    console.log(
      `[quasar] ${method} ${finalUrl} -> ${outcome.status} ${String(res.headers.get("content-type") ?? "").split(";")[0]} (${Date.now() - started}ms)`
    );
    return new Response(outcome.body, { status: outcome.status, headers: outcome.headers });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const parts = raw.split("||");
    const cause = (parts[0] ?? raw).slice(0, 300);
    const hint = parts.length >= 2 ? parts[1] : "";
    const target = parts.length >= 2 ? parts[2] : parsed.target;
    const friendly = SIMPLE_HINTS.find(([re]) => re.test(raw))?.[1] || hint || "The target server could not be reached.";
    console.error(`[quasar] ${method} ${parsed.target} FAILED: ${cause}`);
    return errorPageResponse(502, cause || "Upstream request failed.", target, friendly);
  }
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
