/**
 * Veil — the FreeTube program mount (/ft/*).
 *
 * The website's browser embeds the program in a same-origin iframe at
 * /ft (the pseudo-host freetube.veil.local maps here). Everything under
 * this mount proxies to the FreeTube service on :3031: the app shell,
 * its static renderer files, and the per-viewer /ft/ipc/* bridge calls.
 */

import { proxyToFtService } from "@/lib/veil/ft-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ ftpath?: string[] }> };

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  await ctx.params; // optional catch-all — params unused, prefix is fixed
  return proxyToFtService(req, { strip: "/ft" });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
