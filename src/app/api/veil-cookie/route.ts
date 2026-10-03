import { storeCookieString } from "@/lib/veil/jar";
import { viewerFromRequest } from "@/lib/veil/viewer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Veil — document.cookie relay.
 *
 * The runtime script injected into rendered pages forwards every client-side
 * cookie write here so the server-side jar learns about them; later proxied
 * requests replay them upstream. Keeps consent flows and simple logins alive.
 */
export async function POST(req: Request) {
  const viewer = viewerFromRequest(req);
  try {
    const data = (await req.json()) as {
      host?: unknown;
      cookie?: unknown;
      cookies?: unknown;
    };
    const host = typeof data.host === "string" ? data.host.toLowerCase() : "";
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) {
      return new Response(null, { status: 204 });
    }
    const items: string[] = [];
    if (typeof data.cookie === "string") items.push(data.cookie);
    if (Array.isArray(data.cookies)) {
      for (const c of data.cookies) {
        if (typeof c === "string") items.push(c);
      }
    }
    for (const c of items.slice(0, 20)) {
      try {
        await storeCookieString(viewer, host, c);
      } catch {
        /* one bad cookie must not break the rest */
      }
    }
  } catch {
    /* ignore malformed relay */
  }
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}
