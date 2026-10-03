/**
 * Veil — Quasar engine cookie sync API.
 * ------------------------------------------------------------------
 * Ported from the user-uploaded quasar-proxy engine (src/app/api/cookie/route.ts).
 *
 * Cookie sync API for the client document.cookie shim.
 *   GET  /api/cookie?url=<real target url>  -> { cookies: {...} }
 *   POST /api/cookie  body { url, cookies } -> merged into the server jar
 */

import { NextRequest } from "next/server";
import { mergeClientCookies, snapshotCookies } from "@/lib/veil/quasar/cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function originOf(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const origin = originOf(new URL(req.url).searchParams.get("url"));
  if (!origin) return Response.json({ cookies: {} });
  return Response.json({ cookies: snapshotCookies(origin) });
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = (await req.json()) as { url?: string; cookies?: Record<string, string> };
    const origin = originOf(body.url ?? null);
    if (!origin) return new Response(null, { status: 400 });
    mergeClientCookies(origin, body.cookies ?? {});
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 400 });
  }
}
