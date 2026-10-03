/**
 * Veil — music search API v2 (full songs via SoundCloud).
 *
 * The user-facing search now runs against SoundCloud's public web API
 * (same client_id every soundcloud.com visitor carries — extracted
 * live from their JS bundles, see src/lib/veil/sc-audio.ts). Full
 * tracks resolve to signed progressive mp3s on cf-media.sndcdn.com and
 * stream through /api/music/scstream — full-length playback, not
 * 30-second clips. A few rights-limited tracks only expose preview
 * transcodings upstream; those come back flagged (previewOnly) so the
 * UI can badge them honestly.
 *
 * Fallback: if SoundCloud is unreachable (id rotation, upstream hiccup)
 * the route degrades to the iTunes index (/api/music/search's engine,
 * 30-second previews) so search never shows an empty shelf without an
 * explanation. Items carry `source` so both players know which engine
 * they're holding.
 *
 * Response shape:
 *   { q, source, items: [{ id, title, artist, album, art, preview,
 *       apple, ms, source, previewOnly, permalink }] }
 *
 * CORS-open like the other music routes: the single-file Veil build
 * (file://) calls this from its birth origin (Origin: null).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { scSearchTracks } from "@/lib/veil/sc-audio";

const ITUNES_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const NEUTRAL_UA = "Veil/1.0 (+https://veil.app)";
const MAX_RESULTS = 16;

export interface SearchItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  art: string;
  preview: string;
  apple: string;
  ms: number;
  source: "soundcloud" | "itunes";
  previewOnly: boolean;
  permalink: string;
}

/* ------------------------------------------------------------------ */
/* iTunes fallback (compact twin of /api/music/search)                 */
/* ------------------------------------------------------------------ */

function upscaleArt(url: string): string {
  return url.replace(/\/\d+x\d+bb\./, "/200x200bb.");
}

function iTunesItem(r: Record<string, unknown>): SearchItem | null {
  const preview = typeof r.previewUrl === "string" ? r.previewUrl : "";
  if (!preview) return null;
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
    source: "itunes",
    previewOnly: true, // iTunes only ever hands out 30s clips
    permalink: "",
  };
}

async function iTunesSearch(q: string): Promise<SearchItem[]> {
  const url =
    "https://itunes.apple.com/search?media=music&entity=song&limit=24&country=US&term=" +
    encodeURIComponent(q);
  for (const ua of [ITUNES_UA, NEUTRAL_UA]) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: { "user-agent": ua, accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { results?: unknown[] };
      const items = (Array.isArray(data.results) ? data.results : [])
        .map((r) => iTunesItem(r as Record<string, unknown>))
        .filter((x): x is SearchItem => x !== null)
        .slice(0, MAX_RESULTS);
      if (items.length > 0) return items;
    } catch {
      /* try the next UA */
    }
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* route                                                               */
/* ------------------------------------------------------------------ */

/* CORS — the single-file Veil build (file://) browses from its birth
 * origin; file:// pages send Origin: null. */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
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

  // 1. SoundCloud — the full-song engine.
  try {
    const tracks = await scSearchTracks(q, MAX_RESULTS);
    if (tracks.length > 0) {
      const items: SearchItem[] = tracks.map((t) => ({
        id: String(t.id),
        title: t.title,
        artist: t.artist,
        album: "",
        art: t.art,
        preview: "", // resolved on demand by /api/music/scstream
        apple: "",
        ms: t.ms,
        source: "soundcloud",
        previewOnly: t.previewOnly,
        permalink: t.permalink,
      }));
      return cors(
        Response.json(
          { q, source: "soundcloud", items },
          { headers: { "cache-control": "public, max-age=300" } }
        )
      );
    }
  } catch {
    /* fall through to iTunes */
  }

  // 2. iTunes fallback — honest 30s previews, flagged as such.
  try {
    const items = await iTunesSearch(q);
    if (items.length > 0) {
      return cors(
        Response.json(
          { q, source: "itunes", items },
          { headers: { "cache-control": "public, max-age=300" } }
        )
      );
    }
    return cors(
      Response.json(
        { q, source: "none", items: [], error: "No playable songs matched — try a shorter query." },
        { status: 200 }
      )
    );
  } catch {
    return cors(
      Response.json(
        { q, source: "none", items: [], error: "song search is unreachable right now — try again in a moment" },
        { status: 502 }
      )
    );
  }
}
