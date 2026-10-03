/**
 * Veil — server-side viewer resolution.
 *
 * Every browser that visits Veil gets a pseudonymous "viewer" id. All
 * persisted state (site history, FreeTube searches, FreeTube watch history)
 * is scoped to that id, so nothing ever leaks between users.
 *
 * Resolution order (first hit wins):
 *   1. `x-veil-viewer` header (set by our own fetch wrapper)
 *   2. `veil_viewer` cookie    (stamped on first landing page hit)
 *   3. `?vv=` query param      (used by the offline html + direct links)
 *   4. IP + User-Agent hash    (stable fallback for cookieless first hits)
 */

import { createHash } from "crypto";

const VALID_RE = /^[A-Za-z0-9_-]{6,64}$/;

/** Resolve the viewer id from any incoming request. Always returns a string. */
export function viewerFromRequest(
  req: Request & {
    cookies?: { get?: (name: string) => { value?: string } | undefined };
    nextUrl?: { searchParams?: URLSearchParams };
  }
): string {
  const header = req.headers.get("x-veil-viewer");
  if (header && VALID_RE.test(header)) return header;

  // Cookie (works for both NextRequest.cookies and a raw Request via the
  // cookie header — first match wins).
  const cookieFromApi = req.cookies?.get?.("veil_viewer")?.value;
  if (cookieFromApi && VALID_RE.test(cookieFromApi)) return cookieFromApi;
  const rawCookie = req.headers.get("cookie") ?? "";
  const m = /(?:^|;\s*)veil_viewer=([A-Za-z0-9_-]{6,64})/.exec(rawCookie);
  if (m) return m[1];

  const vv =
    req.nextUrl?.searchParams?.get("vv") ??
    new URL(req.url, "http://local").searchParams.get("vv");
  if (vv && VALID_RE.test(vv)) return vv;

  return fallbackViewer(req.headers.get("user-agent") ?? "", clientIp(req));
}

/** Hash of IP + UA — stable for a given browser network position. */
export function fallbackViewer(ua: string, ip: string): string {
  const h = createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 16);
  return `v-${h}`;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/** Stamp the veil_viewer cookie on a JSON response (idempotent). */
export function stampViewerCookie<T>(json: T, viewer: string): Response {
  const res = Response.json(json);
  res.headers.append(
    "set-cookie",
    `veil_viewer=${viewer}; Path=/; Max-Age=31536000; SameSite=Lax`
  );
  return res;
}
