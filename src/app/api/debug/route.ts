/**
 * Quasar Debug API (v2.1.0)
 * -------------------------
 * GET /api/debug — recent proxied requests + engine stats for the UI debug
 * panel. Also accepts { op: "reload-fixes" } POSTs to force a site-fix pack
 * reload without waiting for the 30s watcher.
 *
 * Access: open on private deployments; when QUASAR_PASSWORD is set the same
 * session gate as the proxy endpoints applies (it exposes target URLs, which
 * is exactly what the unlocked user is already browsing).
 */

import { NextRequest } from "next/server";
import { recentRequests, debugStats } from "@/lib/veil/quasar/debuglog";
import { cacheStats } from "@/lib/veil/quasar/http-cache";
import { jarStats } from "@/lib/veil/quasar/cookies";
import { reloadSiteFixes } from "@/lib/veil/quasar/site-fixes";
import { upstreamProxyUrl } from "@/lib/veil/quasar/http-agent";
import { QUASAR_VERSION } from "@/lib/veil/quasar/version";
import { gate, isAuthedRequest, authRequired } from "@/lib/veil/quasar/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const denied = gate(req, false);
  if (denied) return denied;
  if (authRequired() && !isAuthedRequest(req)) {
    return Response.json({ error: "locked" }, { status: 401 });
  }
  return Response.json({
    version: QUASAR_VERSION,
    uptimeSec: Math.round(process.uptime()),
    upstreamProxy: upstreamProxyUrl() ? "configured" : "none",
    requests: recentRequests(200),
    stats: debugStats(),
    httpCache: cacheStats(),
    cookieJars: jarStats(),
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const denied = gate(req, false);
  if (denied) return denied;
  if (authRequired() && !isAuthedRequest(req)) {
    return Response.json({ error: "locked" }, { status: 401 });
  }
  let body: { op?: string } = {};
  try {
    body = (await req.json()) as { op?: string };
  } catch {
    /* empty body is fine */
  }
  if (body.op === "reload-fixes") {
    const n = reloadSiteFixes();
    return Response.json({ ok: true, activePackEntries: n });
  }
  return Response.json({ error: "bad-op" }, { status: 400 });
}
