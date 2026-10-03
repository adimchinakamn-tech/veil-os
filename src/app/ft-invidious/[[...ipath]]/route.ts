/**
 * Veil — the FreeTube data-source route (/ft-invidious/*).
 *
 * The program's patched renderer points its Invidious-compatible API
 * calls and thumbnail loads at the pseudo-instance freetube-instance.veil.local,
 * and its bridge rewrites every one of those onto this same-origin route.
 * Proxied straight through to the service's compat layer.
 */

import { proxyToFtService } from "@/lib/veil/ft-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ ipath?: string[] }> };

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  await ctx.params;
  return proxyToFtService(req, {});
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
