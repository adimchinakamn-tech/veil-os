/**
 * Veil — Stream feed (For You / Shorts / Popular / Subscriptions).
 *
 * GET /api/yt/feed?kind=foryou|shorts|popular|subs|trending
 *   &chans=UC…,UC…  — the channels THIS device watches (client-side
 *                     history only; never stored) — powers For You AND
 *                     the shorts blend (your channels' shorts lead)
 *   &boost=UC…,UC…  — the channels this device SUBSCRIBED to or LIKED
 *                     videos from (client-side only) — the strongest
 *                     personal signal: their videos lead For You with
 *                     wider rails, and their shorts shelves run wider
 *                     (the user's standing order)
 *   &vids=id1,id2    — the videos this device watched most recently —
 *                     their "up next" recs get woven into For You
 *   &ids=UC…,UC…     — subs only: the channels this device follows —
 *                     their latest uploads, merged newest-first
 *   &fresh=1         — bust the cache and deal a new blend now
 *   &shuffle=1       — shorts only: force a fresh hand of shelves
 *   &exclude=id,…    — shorts only: the infinite viewer's "more"
 *                     rounds — deals a hand of shorts it hasn't shown
 *
 * Same-origin JSON for the Stream section's browse grid. Backed by the
 * freetube-service's Piped layer (with its gate-retry machinery); see
 * src/lib/veil/yt.ts. All feeds are served stale-while-revalidating, so
 * they answer instantly and keep rotating in the background.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { ytPopularFeed, ytForYou, ytForYouPage, ytShortsFeed, ytSubsFeed, ytSubsFeedPage } from "@/lib/veil/yt";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

/** POST — the INFINITE rivers. The client owns the cursor state and
 *  POSTs it back each round:
 *    { kind:"subs",  ids:[…], cursors:{UCa: "1|6|", …} }
 *    { kind:"foryou", chans:[…], vids:[…], boost:[…], seen:[…],
 *                    cursors:{} (round 1) | {UCa: "1|8|tok", …} }
 *  Deep-page continuation tokens are far too long for a GET query
 *  string once a Takeout import brings in dozens of channels, and the
 *  For You river carries the whole seen-list besides — so this is a
 *  body. Response: { cards, next } (next = null when the river is
 *  dry). See ytSubsFeedPage / ytForYouPage. */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    | { kind?: string; ids?: unknown; cursors?: unknown; chans?: unknown; vids?: unknown; boost?: unknown; seen?: unknown; fresh?: unknown }
    | null;
  if (!body || (body.kind !== "subs" && body.kind !== "foryou")) {
    return Response.json(
      { error: "bad request — expected { kind: 'subs' | 'foryou', … }" },
      {
        status: 400,
        headers: CORS,
      },
    );
  }
  const strArray = (x: unknown): string[] =>
    Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];
  const cursors =
    body.cursors && typeof body.cursors === "object" && !Array.isArray(body.cursors)
      ? Object.fromEntries(
          Object.entries(body.cursors as Record<string, unknown>).filter(
            ([k, v]) => typeof k === "string" && typeof v === "string" && v,
          ),
        )
      : {};
  if (body.kind === "foryou") {
    /* the INFINITE For You river — round 1 when cursors is empty, deep
     * rounds otherwise. `seen` = watched + already-on-screen ids, so the
     * feed never re-deals anything this device has already watched. */
    const out = await ytForYouPage(
      strArray(body.chans),
      strArray(body.vids),
      strArray(body.boost),
      strArray(body.seen).slice(0, 400),
      Object.keys(cursors).length > 0 ? cursors : null,
    );
    return Response.json(out, {
      headers: { ...CORS, "cache-control": "no-store" },
    });
  }
  const ids = strArray(body.ids);
  const out = await ytSubsFeedPage(ids, cursors);
  return Response.json(out, {
    headers: { ...CORS, "cache-control": "no-store" },
  });
}

export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind") ?? "foryou";
  let body;
  if (kind === "shorts") {
    const chans = (sp.get("chans") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const boost = (sp.get("boost") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const exclude = (sp.get("exclude") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 150); /* rolling window — the most recent slides matter */
    body = await ytShortsFeed(sp.get("shuffle") === "1", chans, exclude, boost);
  } else if (kind === "foryou") {
    const chans = (sp.get("chans") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const vids = (sp.get("vids") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const boost = (sp.get("boost") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    body = await ytForYou(chans, vids, sp.get("fresh") === "1", boost);
  } else if (kind === "subs") {
    /* Subscriptions — the channels this device follows (client-side
     * localStorage; never stored server-side), latest uploads merged
     * newest-first. */
    const ids = (sp.get("ids") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    body = await ytSubsFeed(ids);
  } else {
    /* Popular = the derived popular wire (trending channels' most-viewed
     * recent uploads, ranked by views) — the upstream type=popular is a
     * stub that returns trending verbatim, so it can't be used here. */
    body = await ytPopularFeed();
  }
  return Response.json(body, {
    headers: { ...CORS, "cache-control": "no-store" },
  });
}
