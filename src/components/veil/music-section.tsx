"use client";

/**
 * Veil Music — the Spotify section overlay.
 *
 * Three shelves of oEmbed-verified Spotify items (Charts / Legends /
 * Pop now), a search box that doubles as a paste-a-link resolver (any
 * open.spotify.com URL or spotify: URI plays the official embed; a free
 * text query runs a real song search), and the persistent player bar
 * (page-root mounted) that keeps playing after the section closes.
 *
 * Search results come from the SoundCloud-backed /api/music/scsearch
 * route: title + artist + artwork + FULL-track playback — the song
 * streams end-to-end (native <audio> in the persistent player, real
 * controls, scrub bar) through /api/music/scstream's byte proxy.
 * Rights-limited tracks (30s previews upstream) and the iTunes
 * fallback carry an honest "30s preview" badge. Card covers for the
 * curated shelves resolve through the veil's /api/p proxy
 * (open.spotify.com/oembed); playback for those is Spotify's official
 * embed iframe.
 *
 * Attach lifecycle: the section tells the persistent bar to go wide
 * (veil:music-attach true on mount / false on unmount). Playing an item
 * dispatches veil:music-play; the bar handles the rest.
 */

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  Disc3,
  Link2,
  Loader2,
  Music2,
  PauseCircle,
  Play,
  Search,
  Sparkles,
  Waves,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OfflineDownload } from "@/components/veil/offline-download";
import {
  MUSIC_ROWS,
  fetchMusicMeta,
  musicOpenUrl,
  parseSpotifyInput,
  playMusic,
  playPreview,
  searchMusic,
  setMusicAttached,
  type MusicItem,
  type MusicMeta,
  type MusicSearchResult,
} from "@/lib/veil/music";
import { routeUrl } from "@/lib/veil/shared";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Card with on-demand oEmbed metadata                                  */
/* ------------------------------------------------------------------ */

function MusicCard({
  item,
  active,
  index,
  onPlay,
}: {
  item: MusicItem;
  active: boolean;
  index: number;
  onPlay: (item: MusicItem, meta: MusicMeta | null) => void;
}) {
  const [meta, setMeta] = React.useState<MusicMeta | null>(null);
  const [tried, setTried] = React.useState(false);
  const reduceMotion = useReducedMotion();

  // Resolve cover art + real title once (through the veil's proxy).
  React.useEffect(() => {
    let cancelled = false;
    fetchMusicMeta(item.kind, item.id).then((m) => {
      if (!cancelled) {
        setMeta(m);
        setTried(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [item.kind, item.id]);

  const label = meta?.title ?? item.label;
  const art = meta?.art;

  return (
    <motion.button
      type="button"
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.04, 0.25) }}
      onClick={() => onPlay(item, meta)}
      aria-label={`Play ${label} on Spotify`}
      className={cn(
        "group relative w-36 shrink-0 snap-start rounded-2xl border p-2.5 text-left outline-none transition-all duration-200",
        active
          ? "border-fuchsia-500/60 bg-fuchsia-500/10 shadow-[0_16px_36px_-14px_rgba(217,70,239,0.5)]"
          : "border-zinc-800/80 bg-zinc-900/60 hover:-translate-y-1 hover:border-fuchsia-500/50 hover:bg-zinc-900"
      )}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-zinc-800">
        {art ? (
          <img
            src={art}
            alt={`${label} cover art`}
            loading="lazy"
            decoding="async"
            className={cn(
              "size-full object-cover transition-transform duration-500 group-hover:scale-[1.05]",
              active && "scale-100"
            )}
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-gradient-to-br from-fuchsia-500/20 via-zinc-800 to-zinc-900 text-zinc-500">
            {tried ? (
              <Disc3 aria-hidden className="size-8" />
            ) : (
              <Loader2 aria-hidden className="size-8 animate-spin text-fuchsia-300/70" />
            )}
          </div>
        )}
        {/* Play affordance */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center justify-center rounded-xl bg-zinc-950/0 transition-all duration-200 group-hover:bg-zinc-950/35",
            active ? "bg-zinc-950/0" : "opacity-0 group-hover:opacity-100"
          )}
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-fuchsia-500 text-zinc-950 shadow-xl shadow-fuchsia-500/40 transition-transform duration-200 scale-75 group-hover:scale-100">
            {active ? (
              <PauseCircle className="size-5" aria-hidden />
            ) : (
              <Play className="size-5 translate-x-[1px]" aria-hidden />
            )}
          </span>
        </span>
        {active && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full border border-fuchsia-400/40 bg-zinc-950/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-fuchsia-300 backdrop-blur-sm">
            <Music2 aria-hidden className="size-2.5" />
            Live
          </span>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-[12.5px] font-medium leading-tight text-zinc-100" title={label}>
        {label}
      </p>
      <p className="mt-0.5 text-[10.5px] capitalize leading-tight text-zinc-500">{item.kind}</p>
    </motion.button>
  );
}

/* ------------------------------------------------------------------ */
/* Search-result song card                                              */
/* ------------------------------------------------------------------ */

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function SongCard({
  song,
  index,
  active,
  onPlay,
}: {
  song: MusicSearchResult;
  index: number;
  active: boolean;
  onPlay: (song: MusicSearchResult) => void;
}) {
  const [artOk, setArtOk] = React.useState(true);
  const full = song.source === "soundcloud" && !song.previewOnly;
  const dur = fmtMs(song.ms);
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.035, 0.28) }}
      onClick={() => onPlay(song)}
      aria-label={`Play ${song.title} by ${song.artist}${
        full ? " — full song" : " — 30 second preview"
      }`}
      className={cn(
        "group relative flex w-[188px] shrink-0 snap-start gap-3 rounded-2xl border p-2.5 text-left outline-none transition-all duration-200",
        active
          ? "border-fuchsia-500/60 bg-fuchsia-500/10 shadow-[0_16px_36px_-14px_rgba(217,70,239,0.5)]"
          : "border-zinc-800/80 bg-zinc-900/60 hover:-translate-y-1 hover:border-fuchsia-500/50 hover:bg-zinc-900"
      )}
    >
      <div className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-zinc-800">
        {song.art && artOk ? (
          <img
            src={routeUrl(song.art)}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setArtOk(false)}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-gradient-to-br from-fuchsia-500/20 via-zinc-800 to-zinc-900 text-zinc-500">
            <Disc3 aria-hidden className="size-5" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <p className="line-clamp-2 text-[12.5px] font-medium leading-tight text-zinc-100" title={song.title}>
          {song.title}
        </p>
        <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-tight text-zinc-500" title={song.artist}>
          {song.artist}
        </p>
        <span className="mt-1 flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider",
              full
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                : "border-zinc-700/60 bg-zinc-950/60 text-zinc-400"
            )}
          >
            {full ? (
              <Waves aria-hidden className="size-2.5" />
            ) : (
              <Play aria-hidden className="size-2" />
            )}
            {full ? "Full song" : "30s preview"}
          </span>
          {dur && (
            <span
              className="text-[10px] tabular-nums text-zinc-500"
              title="Track length"
            >
              {dur}
            </span>
          )}
        </span>
      </div>
    </motion.button>
  );
}

/* ------------------------------------------------------------------ */
/* Section                                                              */
/* ------------------------------------------------------------------ */

export function MusicSection({ onBack, open = true }: { onBack: () => void; open?: boolean }) {
  const reduceMotion = useReducedMotion();
  const [input, setInput] = React.useState("");
  const [resolving, setResolving] = React.useState(false);
  const [linkError, setLinkError] = React.useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = React.useState<string | null>(null);
  // Song-search state (free-text queries; Spotify links still resolve
  // directly). Results render as their own shelf above the curated rows.
  const [results, setResults] = React.useState<MusicSearchResult[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchError, setSearchError] = React.useState<string | null>(null);
  /* Search sequencing: only the LATEST submission may commit its results
   * (two quick searches used to race and the slower/older response won,
   * showing results for query A under a "Results for B" header). */
  const searchSeq = React.useRef(0);

  // Wide panel while the section is OPEN; pill (music still playing) after.
  // Driven by the `open` PROP, not mount/unmount — sections stay mounted
  // (hidden) once opened, so the old mount-only effect never re-attached
  // the panel and closing the section never docked it back to the pill.
  React.useEffect(() => {
    setMusicAttached(open);
  }, [open]);

  // The persistent player's Stop clears our now-playing state so "Live"
  // badges and Pause icons don't stick on cards forever.
  React.useEffect(() => {
    const onStop = () => setNowPlaying(null);
    window.addEventListener("veil:music-stop", onStop);
    return () => window.removeEventListener("veil:music-stop", onStop);
  }, []);

  const handlePlay = React.useCallback(
    (item: MusicItem, meta: MusicMeta | null) => {
      playMusic(item.kind, item.id, meta);
      setNowPlaying(musicOpenUrl(item.kind, item.id));
    },
    []
  );

  const handlePlaySong = React.useCallback((song: MusicSearchResult) => {
    playPreview(song);
    setNowPlaying(`preview:${song.id}`);
  }, []);

  // The one box does both: a Spotify URL/URI resolves + plays the embed;
  // anything else is a song search (title/artist/lyric fragment) whose
  // results stream full SoundCloud tracks (or badged 30s previews).
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = input.trim();
    if (!raw) return;
    const parsed = parseSpotifyInput(raw);
    if (!parsed) {
      setLinkError(null);
      setSearchError(null);
      setSearching(true);
      setSearchQuery(raw);
      const seq = ++searchSeq.current;
      searchMusic(raw)
        .then((items) => {
          if (seq !== searchSeq.current) return; /* a newer search won */
          setResults(items);
          if (items.length === 0) {
            setSearchError("No playable songs matched — try a shorter query (title or artist).");
          }
        })
        .catch(() => {
          if (seq !== searchSeq.current) return;
          setResults([]);
          setSearchError("Song search is unreachable right now — try again in a moment.");
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
      return;
    }
    setResolving(true);
    const { kind, id } = parsed;
    fetchMusicMeta(kind, id)
      .then((meta) => {
        playMusic(kind, id, meta);
        setNowPlaying(musicOpenUrl(kind, id));
        setInput("");
      })
      .catch(() => {
        setLinkError("Couldn't reach Spotify through the veil — try again in a moment.");
      })
      .finally(() => setResolving(false));
  };

  return (
    <div className="flex h-full w-full flex-col text-zinc-100">
      {/* Header */}
      <header className="shrink-0 border-b border-zinc-800/80 px-4 pb-4 pt-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            aria-label="Back to the start page"
            className="h-9 gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <ArrowLeft aria-hidden className="size-4" />
            <span className="hidden sm:inline">Back</span>
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-fuchsia-500/15 ring-1 ring-fuchsia-500/30">
              <Music2 aria-hidden className="size-4.5 text-fuchsia-300" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[17px] font-semibold tracking-tight">
                Veil Music<span className="text-fuchsia-400">.</span>
              </h2>
              <p className="truncate text-[11.5px] text-zinc-400">
                Spotify shelves, SoundCloud search &amp; links — playing through the veil
              </p>
            </div>
          </div>
          <OfflineDownload variant="pill" />
        </div>

        {/* Search + paste-a-link — one box, both worlds */}
        <form
          onSubmit={submit}
          role="search"
          className="mx-auto mt-4 flex w-full max-w-5xl items-center gap-2"
        >
          <div className="group relative flex-1">
            <Link2
              aria-hidden
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500 transition group-focus-within:text-fuchsia-400"
            />
            <Input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setLinkError(null);
                setSearchError(null);
              }}
              placeholder="Search any song or artist — full tracks stream from SoundCloud, or paste a Spotify link…"
              aria-label="Search songs or paste a Spotify link"
              spellCheck={false}
              autoCapitalize="none"
              autoComplete="off"
              className="h-11 rounded-2xl border-zinc-800 bg-zinc-900/70 pl-10 pr-4 text-[14px] text-zinc-100 placeholder:text-zinc-500 focus-visible:border-fuchsia-500/60 focus-visible:ring-fuchsia-500/25"
            />
          </div>
          <button
            type="submit"
            disabled={resolving || searching || !input.trim()}
            className="flex h-11 items-center gap-1.5 rounded-2xl bg-fuchsia-500 px-4 text-[14px] font-semibold text-fuchsia-950 shadow-lg shadow-fuchsia-500/25 transition hover:bg-fuchsia-400 disabled:opacity-50"
          >
            {resolving || searching ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : (
              <Search aria-hidden className="size-4" />
            )}
            <span className="hidden sm:inline">{resolving ? "Playing" : "Search"}</span>
          </button>
        </form>
        {linkError && (
          <p className="mx-auto mt-2 w-full max-w-5xl truncate text-[12px] text-rose-300/90" role="alert">
            {linkError}
          </p>
        )}
        {searchError && !searching && (
          <p className="mx-auto mt-2 w-full max-w-5xl truncate text-[12px] text-rose-300/90" role="alert">
            {searchError}
          </p>
        )}
      </header>

      {/* Shelves */}
      <div className="veil-scroll-slim min-h-0 flex-1 overflow-y-auto px-4 pb-16 pt-6 sm:px-6">
        <div className="mx-auto w-full max-w-5xl space-y-8">
          {/* Song-search results — sits above the curated shelves while a
              query is live. */}
          {(results !== null || searching) && (
            <section aria-label="Search results">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  {searching ? "Searching…" : `Results for “${searchQuery}”`}
                </h3>
                <span className="h-px flex-1 bg-gradient-to-r from-zinc-800 to-transparent" />
                {results !== null && !searching && (
                  <button
                    type="button"
                    onClick={() => {
                      setResults(null);
                      setSearchError(null);
                      setSearchQuery("");
                    }}
                    className="rounded-full border border-zinc-800 bg-zinc-900/70 px-2.5 py-0.5 text-[10.5px] font-medium text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
                  >
                    Clear
                  </button>
                )}
              </div>
              {searching ? (
                <div className="flex gap-2.5 overflow-hidden">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-[76px] w-[188px] shrink-0 animate-pulse rounded-2xl border border-zinc-800/80 bg-zinc-900/50"
                    />
                  ))}
                </div>
              ) : results && results.length > 0 ? (
                <div className="veil-scroll-slim -mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-2">
                  {results.map((song, i) => (
                    <SongCard
                      key={song.id}
                      song={song}
                      index={i}
                      active={nowPlaying === `preview:${song.id}`}
                      onPlay={handlePlaySong}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          )}

          {MUSIC_ROWS.map((row) => (
            <section key={row.label} aria-label={row.label}>
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  {row.label}
                </h3>
                <span className="h-px flex-1 bg-gradient-to-r from-zinc-800 to-transparent" />
              </div>
              <div className="veil-scroll-slim -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">
                {row.items.map((item, i) => (
                  <MusicCard
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    index={i}
                    active={nowPlaying === musicOpenUrl(item.kind, item.id)}
                    onPlay={handlePlay}
                  />
                ))}
              </div>
            </section>
          ))}

          {/* Honest playback note */}
          <p className="flex items-start gap-2 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-4 text-[12px] leading-relaxed text-zinc-400">
            <Sparkles aria-hidden className="mt-0.5 size-3.5 shrink-0 text-fuchsia-300/80" />
            <span>
              Search streams <span className="font-medium text-emerald-300">full songs</span> from SoundCloud — a few
              tracks only allow 30-second previews (marked on the card). Shelf items and pasted links run
              Spotify&apos;s official player. Close this section and the music keeps playing: a pill follows you
              around the veil.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
