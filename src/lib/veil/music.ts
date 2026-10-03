/**
 * Veil Music — the Spotify-powered soundtrack.
 *
 * Zero API keys: the public oEmbed endpoint (open.spotify.com/oembed)
 * resolves titles + cover art for ANY track / album / playlist / artist /
 * episode URL, and the official embed iframe (open.spotify.com/embed/…)
 * plays it with Spotify's own controls. Both fetches flow through the
 * veil's /api/p proxy so everything stays same-origin from the page's
 * perspective; the embed iframe itself loads directly from
 * open.spotify.com (it makes its own same-origin API calls).
 *
 * Song search: full-length playback. The public SoundCloud web API
 * (the same client_id every soundcloud.com visitor carries, extracted
 * live from their JS bundles server-side) answers the search, and each
 * result streams its ENTIRE song through /api/music/scstream — a byte
 * proxy over the signed CDN mp3, Range-capable for scrubbing. Tracks
 * whose rights only permit 30-second clips upstream are badged so the
 * honesty rule survives. If SoundCloud blinks, the search route falls
 * back to the iTunes index (30s previews, badged) so the box never
 * goes dark.
 *
 * The section overlay and the persistent player bar (page-root mounted,
 * survives section changes) talk through window events:
 *   veil:music-play   { embed, title, art, kind }  — start playing
 *   veil:music-attach { attach }                   — wide panel vs pill
 */

import { routeUrl } from "@/lib/veil/shared";

export type MusicKind = "track" | "album" | "playlist" | "artist" | "episode" | "show";

export interface MusicItem {
  kind: MusicKind;
  id: string;
  /** Fallback label while (or if) oEmbed hasn't resolved. */
  label: string;
}

export interface MusicMeta {
  title: string;
  art: string;
}

/* ------------------------------------------------------------------ */
/* Song search (SoundCloud full songs, /api/music/scsearch)            */
/* ------------------------------------------------------------------ */

/** One searchable song. SoundCloud results stream FULL tracks on
 *  demand through /api/music/scstream (preview "" until resolved);
 *  iTunes fallback items carry a 30s preview m4a directly. */
export interface MusicSearchResult {
  id: string;
  title: string;
  artist: string;
  album: string;
  art: string;
  preview: string;
  apple: string;
  ms: number;
  source: "soundcloud" | "itunes";
  /** True when rights only allow a 30-second clip upstream. */
  previewOnly: boolean;
  /** The track's soundcloud.com page (SoundCloud results only). */
  permalink: string;
}

/** Search songs server-side. Empty array on failure (the UI shows its
 *  own honest message; callers prefer keeping previous results). */
export async function searchMusic(
  q: string,
  signal?: AbortSignal
): Promise<MusicSearchResult[]> {
  const query = q.trim();
  if (!query) return [];
  try {
    const res = await fetch(
      `/api/music/scsearch?q=${encodeURIComponent(query)}`,
      { signal }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: MusicSearchResult[] };
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

/** The SoundCloud stream URL for a search result — the route resolves
 *  the signed CDN mp3 server-side and proxies the bytes with ranges. */
export function scStreamUrl(song: Pick<MusicSearchResult, "id">): string {
  return `/api/music/scstream?id=${encodeURIComponent(song.id)}`;
}

/** The full-track hand-off: Spotify's own search page for the song.
 *  (There is no keyless way to resolve a song NAME to a Spotify ID, so
 *  the honest full-play affordance is their search — one click when
 *  you're signed in.) */
export function spotifySearchUrl(song: { title: string; artist: string }): string {
  return `https://open.spotify.com/search/${encodeURIComponent(
    `${song.title} ${song.artist}`.trim()
  )}`;
}

export interface MusicTrack {
  kind: MusicKind;
  embed: string;
  title: string;
  art: string;
}

/* ------------------------------------------------------------------ */
/* Curated catalog (oEmbed-verified IDs)                                */
/* ------------------------------------------------------------------ */

export const MUSIC_ROWS: { label: string; items: MusicItem[] }[] = [
  {
    label: "Charts",
    items: [
      { kind: "playlist", id: "37i9dQZF1DXcBWIGoYBM5M", label: "Today's Top Hits" },
      { kind: "playlist", id: "37i9dQZF1DX4JAvHpjipBk", label: "New Music Friday" },
      { kind: "playlist", id: "37i9dQZF1DX0XUsuxWHRQd", label: "RapCaviar" },
      { kind: "playlist", id: "37i9dQZF1DX10zKzsJ2jva", label: "Viva Latino" },
    ],
  },
  {
    label: "Legends",
    items: [
      { kind: "artist", id: "3fMbdgg4jU18AjLCKBhRSm", label: "Michael Jackson" },
      { kind: "artist", id: "7dGJo4pcD2V6oG8kP0tJRR", label: "Eminem" },
      { kind: "artist", id: "4tZwfgrHOc3mvqYlEYSvVi", label: "Daft Punk" },
      { kind: "artist", id: "2ye2Wgw4gimLv2eAKyk1NB", label: "Metallica" },
      { kind: "playlist", id: "37i9dQZF1DWXRqgorJj26U", label: "Rock Classics" },
      { kind: "playlist", id: "37i9dQZF1DX4UtSsGT1Sbe", label: "All Out 80s" },
    ],
  },
  {
    label: "Pop now",
    items: [
      { kind: "artist", id: "06HL4z0CvFAxyc27GXpf02", label: "Taylor Swift" },
      { kind: "artist", id: "1Xyo4u8uXC1ZmMpatF05PJ", label: "The Weeknd" },
      { kind: "artist", id: "6qqNVTkY8uBg9cP3Jd7DAH", label: "Billie Eilish" },
      { kind: "artist", id: "0du5cEVh5yTK9QJze8zA0C", label: "Bruno Mars" },
      { kind: "artist", id: "1uNFoZAHBGtllmzznpCI3s", label: "Justin Bieber" },
      { kind: "artist", id: "26VFTg2z8YR0cCuwLzESi2", label: "Halsey" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* URL parsing + embeds                                                 */
/* ------------------------------------------------------------------ */

/** Parse any open.spotify.com URL (incl. /intl-xx/ paths) or a bare
 *  spotify:{kind}:{id} URI into its parts. Null when not Spotify. */
export function parseSpotifyInput(input: string): { kind: MusicKind; id: string } | null {
  const s = input.trim();
  if (!s) return null;
  const uri = /^spotify:(track|album|playlist|artist|episode|show):([A-Za-z0-9]+)$/i.exec(s);
  if (uri) return { kind: uri[1].toLowerCase() as MusicKind, id: uri[2] };
  const url =
    /^https?:\/\/(?:[\w-]+\.)*spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/i.exec(
      s
    );
  if (url) return { kind: url[1].toLowerCase() as MusicKind, id: url[2] };
  return null;
}

/** The official embed player URL for a Spotify item. */
export function musicEmbedUrl(kind: MusicKind, id: string): string {
  return `https://open.spotify.com/embed/${kind}/${id}?utm_source=veil`;
}

/** Canonical open.spotify.com URL (for oEmbed lookups). */
export function musicOpenUrl(kind: MusicKind, id: string): string {
  return `https://open.spotify.com/${kind}/${id}`;
}

/* ------------------------------------------------------------------ */
/* oEmbed metadata (title + cover art) through the veil                */
/* ------------------------------------------------------------------ */

const metaCache = new Map<string, MusicMeta | null>();

/** Resolve a Spotify item's title + cover art via the public oEmbed
 *  endpoint, routed through /api/p. Cached per open URL; null on failure
 *  (callers fall back to the curated label). */
export async function fetchMusicMeta(
  kind: MusicKind,
  id: string,
  signal?: AbortSignal
): Promise<MusicMeta | null> {
  const open = musicOpenUrl(kind, id);
  if (metaCache.has(open)) return metaCache.get(open) ?? null;
  try {
    const res = await fetch(
      routeUrl(`https://open.spotify.com/oembed?url=${encodeURIComponent(open)}`),
      { signal }
    );
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { title?: string; thumbnail_url?: string };
    const meta: MusicMeta | null =
      data && typeof data.title === "string" && typeof data.thumbnail_url === "string"
        ? { title: data.title, art: routeUrl(data.thumbnail_url) }
        : null;
    metaCache.set(open, meta);
    return meta;
  } catch {
    // Don't cache failures hard — a transient proxy hiccup shouldn't pin
    // a card to its fallback label forever.
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Player events (section ↔ persistent bar)                            */
/* ------------------------------------------------------------------ */

export interface MusicPlayDetail {
  kind: MusicKind;
  embed: string;
  title: string;
  art: string;
  /** Search result: a native <audio> stream instead of the Spotify
   *  embed — a FULL SoundCloud song (or a 30s preview on fallback /
   *  rights-limited tracks). Null for embed playback. */
  preview?: MusicPreviewDetail;
}

export interface MusicPreviewDetail {
  /** The audio URL (scstream route or routed iTunes m4a). */
  url: string;
  artist: string;
  album: string;
  /** External hand-off: the song's SoundCloud page, or Spotify's
   *  search when only a preview could be offered. */
  full: string;
  /** True = this stream is a 30-second clip, not the whole song. */
  previewOnly: boolean;
  /** Which engine is feeding the audio element. */
  source: "soundcloud" | "itunes";
  /** The track's full length in ms (duration fallback for streams
   *  whose mp3 metadata reports Infinity). */
  ms: number;
}

/** Start playing an item in the persistent player. */
export function playMusic(kind: MusicKind, id: string, meta: MusicMeta | null): void {
  window.dispatchEvent(
    new CustomEvent<MusicPlayDetail>("veil:music-play", {
      detail: {
        kind,
        embed: musicEmbedUrl(kind, id),
        title: meta?.title ?? "Spotify",
        art: meta?.art ?? "",
      },
    })
  );
}

/** Start playing a search result in the persistent player — full
 *  SoundCloud song when the result allows it, 30s preview otherwise
 *  (iTunes fallback / rights-limited tracks, badged honestly). */
export function playPreview(song: MusicSearchResult): void {
  const isSC = song.source === "soundcloud";
  const previewOnly = isSC ? song.previewOnly : true;
  window.dispatchEvent(
    new CustomEvent<MusicPlayDetail>("veil:music-play", {
      detail: {
        kind: "track",
        embed: "",
        title: song.title,
        art: song.art ? routeUrl(song.art) : "",
        preview: {
          url: isSC ? scStreamUrl(song) : routeUrl(song.preview),
          artist: song.artist,
          album: song.album,
          full:
            isSC && song.permalink
              ? song.permalink
              : spotifySearchUrl(song),
          previewOnly,
          source: isSC ? "soundcloud" : "itunes",
          ms: song.ms,
        },
      },
    })
  );
}

/** Tell the persistent player to show its wide panel (section open) or
 *  collapse to the pill (music keeps playing either way). */
export function setMusicAttached(attach: boolean): void {
  window.dispatchEvent(new CustomEvent("veil:music-attach", { detail: { attach } }));
}
