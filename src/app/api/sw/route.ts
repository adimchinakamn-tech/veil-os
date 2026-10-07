/**
 * Quasar Service Worker script — served at /api/sw.
 * `Service-Worker-Allowed: /p/` lets the worker register with the /p/ scope
 * even though the script lives at /api/sw.
 */

import { SW_SCRIPT } from "@/lib/veil/quasar/sw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return new Response(SW_SCRIPT, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "service-worker-allowed": "/p/",
      "cache-control": "no-store",
      "x-quasar-sw": "1",
    },
  });
}
