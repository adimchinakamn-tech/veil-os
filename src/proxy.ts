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

export default function veilGate(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Entry-door requests and Next internals manage themselves.
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/")) {
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
  // Everything except the entry door and Next internals; the logic above
  // filters the rest.
  matcher: ["/((?!api|_next).*)"],
};
