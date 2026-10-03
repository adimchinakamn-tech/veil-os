/**
 * Veil — runtime cookie writes.
 *
 * The client runtime virtualizes document.cookie inside veiled pages; when
 * page JS sets a cookie it is posted here so the per-site jar stays in sync
 * (and later requests replay it to the upstream server).
 */

import { NextResponse } from "next/server";
import { storeCookieString } from "@/lib/veil/jar";
import { viewerFromRequest } from "@/lib/veil/viewer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export async function POST(req: Request) {
  let body: { host?: unknown; cookie?: unknown };
  try {
    body = (await req.json()) as { host?: unknown; cookie?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const host = typeof body.host === "string" ? body.host.trim().toLowerCase() : "";
  const cookie = typeof body.cookie === "string" ? body.cookie : "";

  if (!host || !HOST_RE.test(host)) {
    return NextResponse.json({ error: "Invalid host." }, { status: 400 });
  }
  if (!cookie || cookie.length > 4096) {
    return NextResponse.json({ error: "Invalid cookie." }, { status: 400 });
  }

  try {
    // Scoped to the calling viewer's jar — same-origin relay requests
    // carry the first-party veil_viewer cookie automatically.
    await storeCookieString(viewerFromRequest(req), host, cookie);
  } catch {
    return NextResponse.json({ error: "Could not store cookie." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
