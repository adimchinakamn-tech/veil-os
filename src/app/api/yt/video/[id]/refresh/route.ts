/**
 * Veil — Stream self-heal: force a FRESH extraction for one video.
 *
 * GET /api/yt/video/[id]/refresh
 *   → the service rides the upstream gate flap (innertube multi-round +
 *     byte-probed piped pass — see refreshStreams in the freetube-service)
 *     and answers with a fresh, same-origin-URL body plus an
 *     x-veil-playable header (1 = real bytes verified, 0 = fresh metadata
 *     only). Called by the watch view when the player's stream URLs went
 *     stale mid-session (403s) — the player hot-swaps onto the fresh
 *     formats and resumes at the same timestamp.
 *
 * A full failure answers 503 { gated, message } so the UI can surface an
 * honest "still gated" state instead of an infinite spinner.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { ytVideoRefresh } from "@/lib/veil/yt";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const video = await ytVideoRefresh(id);
    return Response.json(video, {
      headers: { ...CORS, "cache-control": "no-store", "x-veil-playable": "1" },
    });
  } catch (e) {
    return Response.json(
      {
        gated: true,
        message:
          String((e as Error)?.message || e) ||
          "the stream source stayed gated through the whole refresh — try again in a minute",
      },
      { status: 503, headers: { ...CORS, "cache-control": "no-store" } },
    );
  }
}
