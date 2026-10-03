/**
 * Veil — referer-based fallback proxy.
 *
 * Sites that build URLs at runtime (Polymer shadow DOM, JS module loaders,
 * location.href assignments) resolve root-relative paths against THIS origin
 * instead of the veiled page's origin — e.g. YouTube's search form submits to
 * /results and its player loads /s/player/<id>/base.js. Those requests land
 * here; we use the Referer (always a veiled /api/p/… URL) to figure out which
 * site the request actually belongs to and 307-redirect it through the proxy.
 * Method and body are preserved, so form POSTs and XHRs survive too.
 */

import { extractTarget, toRouteUrl } from "@/lib/veil/rewrite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function notFound(): Response {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>404 — Veil</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#09090b;color:#a1a1aa;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="text-align:center"><div style="font-size:44px">404</div><p>This page does not exist.</p></div>
</body></html>`,
    { status: 404, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

async function handle(req: Request): Promise<Response> {
  const u = new URL(req.url);

  // Only unmatched paths reach this catch-all. Everything under /api,
  // /_next, public files and / itself is routed by more specific handlers.
  if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/_next/")) {
    return notFound();
  }

  let siteOrigin: string | null = null;

  // Primary: the Referer is one of our veiled URLs — the request belongs to
  // that page's site.
  const ref = req.headers.get("referer");
  if (ref) {
    try {
      const refUrl = new URL(ref);
      const refTarget = extractTarget(refUrl.pathname, refUrl.search);
      if (refTarget) {
        siteOrigin = new URL(refTarget).origin;
      }
    } catch {
      /* not a usable referer */
    }
  }

  // Fallback: the veil-site cookie stamped by the injected runtime. Raw
  // same-origin requests from anti-tamper app shells carry a raw referer (or
  // none), but always carry our cookies.
  if (!siteOrigin) {
    const cookieHeader = req.headers.get("cookie") || "";
    const m = cookieHeader.match(/(?:^|;\s*)veil-site=([^;]+)/);
    if (m) {
      try {
        const decoded = decodeURIComponent(m[1]);
        const cu = new URL(decoded);
        if (cu.protocol === "http:" || cu.protocol === "https:") {
          siteOrigin = cu.origin;
        }
      } catch {
        /* ignore malformed stamp */
      }
    }
  }

  if (!siteOrigin) return notFound();

  // Rebuild the intended absolute URL: veiled site origin + requested path.
  const intended = siteOrigin + u.pathname + u.search;
  const routed = toRouteUrl(intended);
  if (routed === intended) return notFound();

  // 307 preserves the method and body (form POSTs, XHR payloads).
  return new Response(null, {
    status: 307,
    headers: { location: routed, "cache-control": "no-store" },
  });
}

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
  handle as HEAD,
};
