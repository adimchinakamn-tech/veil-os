/**
 * Veil — Stream video detail + playable formats.
 *
 * GET /api/yt/video/[id]
 *   → same-origin metadata + same-origin stream URLs for the Stream
 *     section player. A gate answer comes back as { gated: true, message }
 *     with HTTP 200 so the client treats it as data (the service
 *     auto-retries gated videos in the background — "press play again in
 *     a minute" is real).
 *
 * GET /api/yt/video/[id]?meta=1
 *   → likes + related ONLY (the /next data) — independent of the
 *     extraction gate; the relay lane uses it for real counts and
 *     recommendations while the player is gated.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { ytVideo, ytVideoMeta } from "@/lib/veil/yt";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  /* meta=1 — likes + related from /next, gate-independent (see above) */
  if (sp.get("meta") === "1") {
    const body = await ytVideoMeta(id);
    return Response.json(body, {
      headers: { ...CORS, "cache-control": "no-store" },
    });
  }
  /* quick=1 — the shorts viewer + watch view's first probe: bounded wait,
   * background warm (see ytVideo's quick lane in src/lib/veil/yt.ts).
   * soft=1 — the shorts viewer's auto-retries: a 3s budget, since they
   * only check whether the background warm has parked the body yet. */
  const quick = sp.get("quick") === "1";
  const soft = sp.get("soft") === "1";
  const body = await ytVideo(id, quick, soft);
  return Response.json(body, {
    headers: { ...CORS, "cache-control": "no-store" },
  });
}

