/**
 * Cookie sync API for the client document.cookie shim.
 *   GET  /api/cookie?url=<real target url>&c=<container>  -> { cookies: {...} }
 *   POST /api/cookie  body { url, cookies, container }    -> merged into the server jar
 *
 * v2.1.0 — jars are partitioned per container as well as per origin, so two
 * containers can hold two independent sessions on the same site.
 */

import { NextRequest } from "next/server";
import { mergeClientCookies, snapshotCookies, normContainer } from "@/lib/veil/quasar/cookies";

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
  const sp = new URL(req.url).searchParams;
  const origin = originOf(sp.get("url"));
  const container = normContainer(sp.get("c"));
  if (!origin) return Response.json({ cookies: {} });
  return Response.json({ cookies: snapshotCookies(origin, container) });
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = (await req.json()) as {
      url?: string;
      cookies?: Record<string, string>;
      container?: string;
    };
    const origin = originOf(body.url ?? null);
    if (!origin) return new Response(null, { status: 400 });
    mergeClientCookies(origin, body.cookies ?? {}, normContainer(body.container));
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 400 });
  }
}
