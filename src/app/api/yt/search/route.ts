/**
 * Veil — Stream search.
 *
 * GET /api/yt/search?q=…
 *
 * Same-origin video search for the Stream section (Piped-backed, gate-
 * aware — see src/lib/veil/yt.ts).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { ytSearch } from "@/lib/veil/yt";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: Request): Promise<Response> {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) {
    return Response.json([], { headers: { ...CORS, "cache-control": "no-store" } });
  }
  const body = await ytSearch(q);
  return Response.json(body, {
    headers: { ...CORS, "cache-control": "no-store" },
  });
}
