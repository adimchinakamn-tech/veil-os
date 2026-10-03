/**
 * Veil — 4K wallpaper resolution resolver (4kwallpapers.com).
 *
 * A wallpaper's detail page lists its downloadable files:
 *   /images/wallpapers/{slug}-{WxH}-{id}.jpg
 * This endpoint parses them and returns every resolution plus the best
 * "apply" pick (largest 16:9 file, falling back to the largest file).
 *
 * GET /api/wallpapers/detail?url=https://4kwallpapers.com/nature/foo-123.html
 *   -> { ok, name?, thumb?, resolutions: [{ w, h, url }], best }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://4kwallpapers.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; payload: unknown }>();

/* CORS — the single-file Veil build (file://) resolves resolutions from
 * its birth origin; file:// pages send Origin: null. */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function cors(res: Response): Response {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

export async function OPTIONS(): Promise<Response> {
  return cors(new Response(null, { status: 204 }));
}

export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  const url = (sp.get("url") ?? "").trim();

  // Only 4kwallpapers.com detail pages, http(s) only.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Response.json({ error: "invalid url" }, { status: 400 });
  }
  if (parsed.protocol !== "https:" || parsed.hostname.replace(/^www\./, "") !== "4kwallpapers.com") {
    return Response.json({ error: "unsupported host" }, { status: 400 });
  }

  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return cors(Response.json(cached.payload));
  }

  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        "user-agent": UA,
        accept: "text/html,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const html = await res.text();

    const resolutions: { w: number; h: number; url: string }[] = [];
    const seen = new Set<string>();
    const re = /\/images\/wallpapers\/([a-z0-9-]+)-(\d{3,4})x(\d{3,4})-(\d+)\.(jpe?g|png)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const file = `/images/wallpapers/${m[1]}-${m[2]}x${m[3]}-${m[4]}.${m[5]}`;
      if (seen.has(file)) continue;
      seen.add(file);
      resolutions.push({
        w: Number.parseInt(m[2], 10),
        h: Number.parseInt(m[3], 10),
        url: `${BASE}${file}`,
      });
    }
    resolutions.sort((a, b) => b.w * b.h - a.w * a.h);

    // Best pick: largest 16:9-ish file, else the largest overall.
    const ratio = (r: { w: number; h: number }) => Math.abs(r.w / r.h - 16 / 9);
    const landscape = resolutions.filter((r) => r.w >= r.h);
    const best =
      (landscape.length
        ? [...landscape].sort((a, b) => ratio(a) - ratio(b) || b.w - a.w)[0]
        : null) ?? resolutions[0] ?? null;

    const title = /<title>([^<]{1,120})<\/title>/i.exec(html)?.[1]?.replace(/\s*Wallpaper.*$/i, "") ?? "";
    const payload = {
      ok: resolutions.length > 0,
      name: title.trim(),
      resolutions,
      best,
    };
    if (payload.ok) cache.set(url, { at: Date.now(), payload });
    return cors(
      Response.json(payload, {
        headers: { "cache-control": "public, max-age=900" },
      })
    );
  } catch {
    return cors(
      Response.json(
        { ok: false, error: "could not resolve this wallpaper's resolutions", resolutions: [], best: null },
        { status: 502 }
      )
    );
  }
}
