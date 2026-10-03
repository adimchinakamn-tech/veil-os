/**
 * Veil — Stream comment threads (read-only).
 *
 * GET /api/yt/comments/[id]?sort=new
 *   → the video's top-level comments, newest-first (default: top).
 *
 * GET /api/yt/comments/[id]?continuation=<token>
 *   → the next page of top-level comments, OR a single comment's reply
 *     thread (when the token is that comment's repliesPage token — the
 *     upstream treats both identically).
 *
 * Same-origin JSON; avatars in the list are already proxy URLs. A gate
 * answer comes back as { gated: true, message } with HTTP 200.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { ytComments } from "@/lib/veil/yt";

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
  const continuation = sp.get("continuation") ?? "";
  const sort = sp.get("sort") === "new" ? "new" : "top";
  const body = await ytComments(id, continuation, sort);
  return Response.json(body, {
    headers: { ...CORS, "cache-control": "no-store" },
  });
}
