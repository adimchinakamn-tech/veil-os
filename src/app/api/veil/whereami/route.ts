/**
 * Veil — "where am I" echo (diagnostic + front auto-retarget source).
 *
 * Returns the request's Host / X-Forwarded-* headers so the box can learn
 * the PUBLIC origin it is being visited through (the preview gateway
 * rewrites nothing here — whatever Host arrives is what the user typed).
 * Also the canonical answer for "which origin should the jsDelivr fronts
 * point at": when hit through the preview domain it reports that exact
 * public origin, and the front-retarget job records it.
 */

export const dynamic = "force-dynamic";

import { noteRequestOrigin } from "@/lib/veil/live-origin";

export async function GET(req: Request): Promise<Response> {
  noteRequestOrigin(req);
  const h = req.headers;
  return Response.json(
    {
      host: h.get("host"),
      forwardedHost: h.get("x-forwarded-host"),
      forwardedProto: h.get("x-forwarded-proto") ?? "https",
      origin: h.get("origin"),
      referer: h.get("referer"),
      at: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
