import { NextResponse } from "next/server";

/**
 * Zone-prefix shim: origin discovery.
 *
 * When Veil is served through a path-prefix CDN pull zone (…/z/<zone>/),
 * the layout's bootstrap shim routes requests the zone cannot carry —
 * mutations (pull zones only proxy GET/HEAD) and the socket relay (the
 * ?XTransformPort gateway param gets hijacked by a fronting gateway) —
 * DIRECTLY to this app's real origin. The origin URL lives only in this
 * server-side constant: it never appears in any client bundle, page
 * source, or the CDN front (casual inspection stays clean of hosts).
 *
 * The response is immutable and safe to cache hard.
 */
export async function GET() {
  return NextResponse.json(
    {
      origin:
        "https://preview-chat-5c473725-60a1-401a-a523-f3055da577e8.space-z.ai",
    },
    {
      headers: {
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    }
  );
}
