/**
 * Quasar Remux API (v2.1.0) — optional ffmpeg remux-to-HLS endpoint.
 *
 *   POST /api/remux { url: <absolute http(s) URL> }
 *     -> 200  playlist body (text/plain) with segments rewritten to
 *             /api/remux/seg?id=<jobId>&n=<basename>
 *     -> 501  { error: "remux-disabled", hint: "set QUASAR_REMUX=1" }
 *     -> 503  { error: "ffmpeg-missing" }
 *     -> 403  { error: "blocked-target" }   (SSRF guard)
 *     -> 502  { error: "remux-failed" }     (ffmpeg failure / timeout / saturation)
 *
 * Honest scope: remuxes progressive / adaptive direct-media URLs via ffmpeg
 * stream-copy (see src/lib/proxy/yt-remux.ts for the documented ceiling:
 * YouTube SABR/UMP responses are NOT parsed by this path).
 */

import { NextRequest } from "next/server";
import { allowRequest, assertSafeTarget, clientKeyOf, gate } from "@/lib/veil/quasar/security";
import { ffmpegAvailable, remuxEnabled, remuxToHls } from "@/lib/veil/quasar/yt-remux";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const denied = gate(req, false);
  if (denied) return denied;
  if (!allowRequest(clientKeyOf(req))) {
    return Response.json({ error: "rate-limited" }, { status: 429 });
  }

  // Feature flag first — 501 regardless of the request body.
  if (!remuxEnabled()) {
    return Response.json(
      { error: "remux-disabled", hint: "set QUASAR_REMUX=1" },
      { status: 501 }
    );
  }

  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad-json" }, { status: 400 });
  }
  if (typeof body.url !== "string") {
    return Response.json({ error: "bad-url" }, { status: 400 });
  }
  let target: URL;
  try {
    target = new URL(body.url); // must be absolute
  } catch {
    return Response.json({ error: "bad-url" }, { status: 400 });
  }

  // Probe ffmpeg before touching the network.
  if (!(await ffmpegAvailable())) {
    return Response.json({ error: "ffmpeg-missing" }, { status: 503 });
  }

  // Engine SSRF guard — DNS-resolving, same one the proxy route uses.
  // (yt-remux.ts independently refuses non-http(s) schemes before spawn.)
  try {
    await assertSafeTarget(target);
  } catch {
    return Response.json({ error: "blocked-target" }, { status: 403 });
  }

  const result = await remuxToHls(target.href);
  if (!result) {
    return Response.json({ error: "remux-failed" }, { status: 502 });
  }

  return new Response(result.playlist, {
    status: 200,
    headers: {
      "content-type": result.contentType, // text/plain; charset=utf-8 (hls.js parses fine)
      "cache-control": "no-store",
      "x-quasar-version": "remux",
    },
  });
}
