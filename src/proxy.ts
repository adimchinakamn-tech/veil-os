/**
 * Veil — origin-path rescue. (Next 16 request gate — the `proxy.ts`
 * convention that replaced middleware in Next 16.)
 *
 * Pages rendered through the veil build some URLs at RUNTIME with the
 * app origin instead of the site origin:
 *
 *   location.href = "/logout"          (resolves against the frame origin)
 *   location.origin + "/api/x"         (the frame origin leaks in)
 *   fetch("/hp/api/model")             (root-relative: base tag can't help)
 *
 * Those requests leave the veil and hit this app's own router — the user
 * sees this app's 404 page INSIDE the frame ("the site did not render").
 * The browser 308-collapses any `//` in such URLs too, mangling them twice.
 *
 * Rescue: any non-app request whose Referer is one of OUR route URLs
 * (`/api/p/{scheme}/{host}/…` — the URL of the page the request came from)
 * is redirected to the same path ON THAT SITE through the veil. The
 * referer only ever reaches this server (site traffic is fetched
 * server-side), so nothing leaks upstream. Redirects are pointed at the
 * REFERER's origin — the browser's real origin — because the gateway strips
 * the port from the Host header and Next dev rewrites hosts to localhost,
 * so the server's own idea of the origin cannot be trusted. A forged
 * referer gains nothing: it can only redirect a request it made itself to
 * the entry door, which is a public service by design. Requests without a
 * veil referer (the app itself, direct visits, static assets) pass through
 * untouched.
 */

import { NextRequest, NextResponse } from "next/server";

const ROUTE_PREFIX = "/api/p/";

/* ── CORS for the app's own APIs ─────────────────────────────────────────
 * When Veil is served through a path-prefix CDN pull zone, mutations and
 * the socket relay bypass the zone and hit this origin directly
 * (cross-origin from the zone's page). Pull-zone caches only carry
 * GET/HEAD, so POST/PUT/PATCH/DELETE and their preflights arrive here
 * with a foreign Origin and need permissive CORS to be readable. Chat
 * auth is Bearer-token based (headers, not cookies), so wildcard origins
 * grant no session powers; the low-value viewer-stats cookie simply
 * doesn't ride on cross-origin calls. */
const API_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods":
    "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-veil-viewer, x-veil-token, x-requested-with",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

export default function veilGate(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // API CORS: answer preflights directly, tag real responses.
  if (pathname.startsWith("/api/")) {
    if (req.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: API_CORS });
    }
    const res = NextResponse.next();
    for (const [k, v] of Object.entries(API_CORS)) res.headers.set(k, v);
    return res;
  }
  if (pathname.startsWith("/_next/")) {
    return NextResponse.next();
  }

  const ref = req.headers.get("referer") || "";
  if (!ref.includes("/api/p/")) return NextResponse.next();

  // The browser's real origin (survives gateway Host rewriting).
  let refOrigin = "";
  try {
    refOrigin = new URL(ref).origin;
  } catch {
    return NextResponse.next();
  }
  if (!refOrigin) return NextResponse.next();

  // Pull the real site origin out of the route-shaped referer:
  //   http://localhost:81/api/p/https/www.bing.com/search?q=1
  const m = ref.match(/\/api\/p\/(https?)\/([^/?#]+)/i);
  if (!m) return NextResponse.next();

  const scheme = m[1].toLowerCase();
  const host = m[2];
  const dest = `${ROUTE_PREFIX}${scheme}/${host}${pathname}${search}`;

  // 308 preserves method semantics for GET/HEAD; 307 preserves method AND
  // body for POST/PUT — a site's form/API posts must replay through the door.
  const status = req.method === "GET" || req.method === "HEAD" ? 308 : 307;
  return NextResponse.redirect(new URL(dest, refOrigin), status);
}

export const config = {
  // Everything except Next internals; the logic above filters the rest.
  // /api must be included for the CORS block (zone-served deployments
  // preflight + mutate cross-origin); it used to be excluded.
  matcher: ["/((?!_next).*)"],
};
