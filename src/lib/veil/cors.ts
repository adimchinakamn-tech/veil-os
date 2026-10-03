/**
 * Veil — CORS hatch for the single-file build.
 *
 * The offline veil-offline.html runs from file://, so every fetch it
 * makes back to its birth origin is cross-origin with `Origin: null`.
 * The wallpaper catalog routes already do this by hand; this shared
 * helper gives the chat routes the same treatment so Veil Chat works
 * through the HTML version too. Tokens travel in the request body —
 * no cookies — so a wildcard origin is safe.
 */

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

/** Stamp the CORS headers onto an outgoing Response. */
export function cors(res: Response): Response {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v)
  return res
}

/** Preflight answer for route-level `export async function OPTIONS`. */
export function corsOptions(): Response {
  return cors(new Response(null, { status: 204 }))
}
