/**
 * Veil — music search API (song lookup for the Music section).
 *
 * Spotify's own search needs OAuth tokens (the anonymous web-player token
 * endpoint is 403-blocked upstream and their search page is a pure JS
 * shell), and every keyless cross-resolver (Odesli, Deezer) is dead or
 * bot-walled from a server. The iTunes Search API is the one public,
 * keyless, reliable song index left: it answers title, artist, album,
 * artwork and — the part that makes Veil Music genuinely searchable — a
 * 30-second playable preview m4a for every result.
 *
 * So Veil search = iTunes for discovery, previews play natively through
 * the veil's proxy, and each result links out to a full Spotify search
 * for the signed-in full track. Search results are NOT Spotify embeds
 * (no keyless way to turn "blinding lights" into a Spotify ID exists);
 * pasted Spotify links and curated shelves still play the real embeds.
 *
 * Response shape:
 *   { q, items: [{ id, title, artist, album, art, preview, apple, ms }] }
 *
 * CORS-open like the wallpaper catalog routes: the single-file Veil build
 * (file://) calls this from its birth origin, and file:// pages send
 * Origin: null.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const NEUTRAL_UA = "Veil/1.0 (+https://veil.app)";
const TTL_MS = 10 * 60 * 1000;
const CACHE_CAP = 48;
const MAX_RESULTS = 16;

interface SearchItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  art: string;
  preview: string;
  apple: string;
  ms: number;
}

interface QueryCache {
  at: number;
  items: SearchItem[];
}

const cache = new Map<string, QueryCache>();
const inFlight = new Map<string, Promise<SearchItem[]>>();

/** iTunes' artwork URLs embed the size ("…/100x100bb.jpg") — swap it for
 *  a crisper 200x200 crop; harmless when the pattern is absent. */
function upscaleArt(url: string): string {
  return url.replace(/\/\d+x\d+bb\./, "/200x200bb.");
}

/** The interesting subset of an iTunes result, sanitized. */
function toItem(r: Record<string, unknown>): SearchItem | null {
  const preview = typeof r.previewUrl === "string" ? r.previewUrl : "";
  if (!preview) return null; // unplayable results are noise in a player UI
  const id = String(r.trackId ?? "");
  if (!id) return null;
  return {
    id,
    title: String(r.trackName ?? "Unknown"),
    artist: String(r.artistName ?? "Unknown"),
    album: String(r.collectionName ?? ""),
    art: upscaleArt(String(r.artworkUrl100 ?? "")),
    preview,
    apple: String(r.trackViewUrl ?? ""),
    ms: Number.isFinite(r.trackTimeMillis) ? Number(r.trackTimeMillis) : 0,
  };
}

async function runSearch(q: string): Promise<SearchItem[]> {
  const url =
    "https://itunes.apple.com/search?media=music&entity=song&limit=24&country=US&term=" +
    encodeURIComponent(q);
  // Browser UA first, neutral veil UA on 403/429 — the same retry shape
  // the wallpaper catalog routes use (bot-walls are fingerprint roulette).
  let res: Response | null = null;
  for (const ua of [UA, NEUTRAL_UA]) {
    try {
      res = await fetch(url, {
        cache: "no-store",
        headers: { "user-agent": ua, accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) break;
      if (res.status !== 403 && res.status !== 429) break;
    } catch {
      /* try the next UA */
    }
  }
  if (!res || !res.ok) throw new Error(`upstream ${res ? res.status : "unreachable"}`);
  const data = (await res.json()) as { results?: unknown[] };
  const items = (Array.isArray(data.results) ? data.results : [])
    .map((r) => toItem(r as Record<string, unknown>))
    .filter((x): x is SearchItem => x !== null)
    .slice(0, MAX_RESULTS);
  return items;
}

async function searchCached(q: string): Promise<SearchItem[]> {
  const cached = cache.get(q);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.items;
  const running = inFlight.get(q);
  if (running) return running;
  const task = runSearch(q)
    .then((items) => {
      if (items.length > 0) {
        cache.set(q, { at: Date.now(), items });
        if (cache.size > CACHE_CAP) {
          for (const k of [...cache.keys()].slice(0, Math.ceil(CACHE_CAP / 4))) {
            cache.delete(k);
          }
        }
      }
      return items;
    })
    .finally(() => inFlight.delete(q));
  inFlight.set(q, task);
  return task;
}

/* CORS — the single-file Veil build (file://) browses from its birth
 * origin; file:// pages send Origin: null. */
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
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (!q) {
    return cors(Response.json({ q, items: [], error: "empty query" }, { status: 400 }));
  }
  try {
    const items = await searchCached(q);
    return cors(
      Response.json(
        { q, items },
        { headers: { "cache-control": "public, max-age=300" } }
      )
    );
  } catch {
    return cors(
      Response.json(
        {
          q,
          items: [],
          error: "song search is unreachable right now — try again in a moment",
        },
        { status: 502 }
      )
    );
  }
}
