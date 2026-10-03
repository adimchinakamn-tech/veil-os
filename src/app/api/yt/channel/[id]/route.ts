/**
 * Veil — Stream channel page.
 *
 * GET /api/yt/channel/[id]
 *   → header (avatar, name, subs, description) + the channel's videos and
 *     shorts shelves, all with same-origin proxied thumbs/avatars, plus
 *     continuation tokens for paging either shelf deeper.
 *
 * GET /api/yt/channel/[id]?more=videos|shorts|streams|posts&continuation=<token>
 *   → the NEXT page of that shelf ({ cards, next } for the video-ish
 *     tabs, { posts, next } for posts) — "Load more". streams + posts
 *     accept an EMPTY continuation (their FIRST page — those tabs are
 *     lazy-loaded on click).
 *
 * A gate answer comes back as { gated: true, message } with HTTP 200 so the
 * client treats it as data.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { ytChannel, ytChannelMore } from "@/lib/veil/yt";

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
  const url = new URL(req.url);
  const more = url.searchParams.get("more");
  const continuation = url.searchParams.get("continuation") ?? "";
  const body =
    (more === "videos" || more === "shorts" || more === "streams" || more === "posts") &&
    (continuation || more === "streams" || more === "posts")
      ? await ytChannelMore(id, more, continuation)
      : await ytChannel(id);
  return Response.json(body, {
    headers: { ...CORS, "cache-control": "no-store" },
  });
}
