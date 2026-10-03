/**
 * Veil — GN-Math arcade API.
 *
 * Serves the title catalog used by the gn-math.dev site (the "zones"
 * list): each entry has a display name, a cover wallpaper and a
 * self-contained single-file HTML title hosted on a public CDN. The
 * catalog is fetched at most once every 10 minutes through a
 * module-level cache; on failure the last cached list is served.
 *
 * Only locally-hosted titles ({HTML_URL} entries) are returned — the
 * handful of external promo links (Discord invite, …) are dropped.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ZONES_URL =
  "https://cdn.jsdelivr.net/gh/freebuisness/assets@main/zones.json";
const COVER_URL = "https://cdn.jsdelivr.net/gh/freebuisness/covers@main";
const HTML_URL = "https://cdn.jsdelivr.net/gh/freebuisness/html@main";
const TTL_MS = 10 * 60 * 1000;
const UA = "Veil/1.0 (+https://veil.app)";

export interface GnTitle {
  id: number;
  name: string;
  /** Absolute CDN url of the cover wallpaper (PNG/WebP). */
  cover: string;
  /** Absolute CDN url of the single-file title HTML. */
  html: string;
  author: string | null;
}

interface ZoneShape {
  id?: number | string;
  name?: string;
  cover?: string;
  url?: string;
  author?: string;
}

interface CatalogCache {
  titles: GnTitle[];
  fetchedAt: number;
}

let cache: CatalogCache | null = null;
let inFlight: Promise<GnTitle[]> | null = null;

/** Normalize one zone entry; null when it isn't a locally-hosted title. */
function normalizeZone(z: ZoneShape): GnTitle | null {
  const url = typeof z.url === "string" ? z.url : "";
  // Only self-hosted titles: "{HTML_URL}/0.html" style entries.
  if (!url.startsWith("{HTML_URL}/")) return null;
  const file = url.slice("{HTML_URL}/".length);
  const id = typeof z.id === "number" ? z.id : Number.parseInt(String(z.id), 10);
  const name = typeof z.name === "string" ? z.name.trim() : "";
  if (!Number.isFinite(id) || !name || !file) return null;

  const coverFile =
    typeof z.cover === "string" && z.cover.startsWith("{COVER_URL}/")
      ? z.cover.slice("{COVER_URL}/".length)
      : `${id}.png`;
  const author =
    typeof z.author === "string" && z.author.trim() ? z.author.trim() : null;

  return {
    id,
    name,
    cover: `${COVER_URL}/${coverFile}`,
    html: `${HTML_URL}/${file}`,
    author,
  };
}

function normalize(json: unknown): GnTitle[] {
  if (!Array.isArray(json)) return [];
  const titles: GnTitle[] = [];
  const seen = new Set<string>();
  for (const raw of json) {
    if (!raw || typeof raw !== "object") continue;
    const g = normalizeZone(raw as ZoneShape);
    if (!g) continue;
    // The upstream list occasionally repeats ids — keep the first.
    if (seen.has(String(g.id))) continue;
    seen.add(String(g.id));
    titles.push(g);
  }
  return titles;
}

async function fetchTitles(): Promise<GnTitle[]> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return cache.titles;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch(ZONES_URL, {
        cache: "no-store",
        headers: { "user-agent": UA, accept: "*/*" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`zones fetch failed: ${res.status}`);
      const json: unknown = await res.json();
      const titles = normalize(json);
      if (titles.length > 0) {
        cache = { titles, fetchedAt: Date.now() };
      }
      return cache?.titles ?? [];
    } catch {
      if (cache) cache = { titles: cache.titles, fetchedAt: Date.now() };
      return cache?.titles ?? [];
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export async function GET(req: Request): Promise<Response> {
  const titles = await fetchTitles();
  const q = new URL(req.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
  const filtered =
    q.length > 0
      ? titles.filter((g) => g.name.toLowerCase().includes(q))
      : titles;

  return Response.json(
    { titles: filtered, total: titles.length },
    { headers: { "cache-control": "no-store" } }
  );
}
