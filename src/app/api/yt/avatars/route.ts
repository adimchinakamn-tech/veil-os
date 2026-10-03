/**
 * Veil — Stream channel-avatar batch lookup.
 *
 * GET /api/yt/avatars?ids=UC…,UC…  (cap 30 ids)
 *
 * The client's card grid sends the distinct channel ids its visible
 * cards carry; the answer is { avatars: { "UC…": "/api/yt/s?u=…" } } —
 * each value a same-origin proxy URL for the channel's REAL logo.
 * Channels with no avatar are simply absent from the map (the client
 * keeps its gradient-initial fallback for those).
 *
 * Per-id results are cached server-side for 30 minutes (avatars barely
 * change), and the underlying channel pages are themselves cached by
 * the freetube compat service — so this stays cheap even when the grid
 * re-asks as the user scrolls.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { ytAvatars } from "@/lib/veil/yt";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  const ids = (sp.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const avatars = await ytAvatars(ids);
  return Response.json({ avatars }, {
    headers: { ...CORS, "cache-control": "no-store" },
  });
}
