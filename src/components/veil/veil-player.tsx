"use client";

/**
 * Veil Music — the persistent player bar.
 *
 * Mounted ONCE at the page root (outside every section overlay) so the
 * Spotify embed iframe NEVER unmounts when sections open and close —
 * music keeps playing while you browse the web through the veil.
 *
 * Two playback engines behind one bar:
 *  - EMBED (curated shelves / pasted links): Spotify's official iframe.
 *  - SONG (search results): a native <audio> element streaming through
 *    the veil — FULL SoundCloud tracks via /api/music/scstream (a
 *    Range-capable byte proxy over the signed CDN mp3), or a 30-second
 *    preview for rights-limited / fallback results, badged honestly.
 *    Real transport controls, a scrub bar and the artwork.
 *
 * Two visual states of the same DOM node (the arcade's tuck-away trick):
 *  - ATTACHED (the Music section is open, or the pill was expanded): a
 *    wide bottom-right panel with cover art, title and the full player.
 *  - DOCKED (default): a compact pill; the embed is clipped to zero
 *    height but stays mounted and rendering — media elements do not
 *    pause when hidden, so the audio continues. Previews simply pause
 *    when the pill is docked? No — docked keeps playing too; the pill
 *    shows art + title + a play/pause toggle for previews.
 *
 * Layering: z-[130] — above the opaque section overlays (z-[120]) so the
 * panel is reachable while the Music section is open, below dialogs
 * (z-[200]) and toasts (z-[250]).
 */

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ExternalLink,
  Music2,
  PanelTopClose,
  PanelTopOpen,
  Pause,
  Play,
  X,
} from "lucide-react";
import type { MusicKind, MusicPlayDetail, MusicPreviewDetail } from "@/lib/veil/music";
import { setMusicAttached } from "@/lib/veil/music";
import { cn } from "@/lib/utils";

interface Track {
  kind: MusicKind;
  embed: string;
  title: string;
  art: string;
  preview?: MusicPreviewDetail;
}

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function VeilMusicPlayer() {
  const [track, setTrack] = React.useState<Track | null>(null);
  const [attached, setAttached] = React.useState(false);
  const [closing, setClosing] = React.useState(false);

  // Native audio state (element + transport). dur falls back to the
  // known full length when a stream's mp3 metadata reports Infinity.
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [pos, setPos] = React.useState(0);
  const [dur, setDur] = React.useState(0);
  const [audioError, setAudioError] = React.useState(false);
  /* The known-full-length fallback, mirrored into a ref so seek() can
   * use it for Infinity-duration streams (progressive mp3s whose
   * metadata never resolves). */
  const durRef = React.useRef(0);
  React.useEffect(() => {
    durRef.current = dur;
  }, [dur]);
  /* Monotonic play counter — bumped on EVERY play dispatch. It rides
   * the media element keys so re-playing the SAME song remounts the
   * element (autoPlay re-fires) instead of silently doing nothing. */
  const [playNonce, setPlayNonce] = React.useState(0);
  /* Pending stop timer — a new track within the 180ms close window must
   * cancel it (the old bug: the timer fired AFTER the new track was set
   * and nulled it). */
  const stopTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const onPlay = (e: Event) => {
      const d = (e as CustomEvent<MusicPlayDetail>).detail;
      if (!d?.embed && !d?.preview) return;
      /* cancel any pending stop — this dispatch wins */
      if (stopTimerRef.current !== null) {
        clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
      setTrack({
        kind: d.kind,
        embed: d.embed,
        title: d.title,
        art: d.art,
        preview: d.preview,
      });
      setClosing(false);
      setPlaying(Boolean(d.preview));
      setPos(0);
      setDur(d.preview && !d.preview.previewOnly ? d.preview.ms / 1000 : 0);
      setAudioError(false);
      setPlayNonce((n) => n + 1);
    };
    const onAttach = (e: Event) =>
      setAttached(Boolean((e as CustomEvent<{ attach?: boolean }>).detail?.attach));
    window.addEventListener("veil:music-play", onPlay);
    window.addEventListener("veil:music-attach", onAttach);
    return () => {
      window.removeEventListener("veil:music-play", onPlay);
      window.removeEventListener("veil:music-attach", onAttach);
      if (stopTimerRef.current !== null) clearTimeout(stopTimerRef.current);
    };
  }, []);

  // Stop = unmount the media (kills the audio) + hide everything.
  const stop = () => {
    setClosing(true);
    setMusicAttached(false);
    /* tell the Music section (and anyone listening) so "Live" badges
     * and now-playing state clear instead of sticking forever */
    window.dispatchEvent(new CustomEvent("veil:music-stop"));
    if (stopTimerRef.current !== null) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = window.setTimeout(() => {
      stopTimerRef.current = null;
      setTrack(null);
      setAttached(false);
      setClosing(false);
      setPlaying(false);
    }, 180);
  };

  // Native audio transport for previews.
  const toggle = React.useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      if (a.ended) a.currentTime = 0; /* replay after end, not a dead 0s */
      void a.play().catch(() => {});
    } else a.pause();
  }, []);

  const seek = React.useCallback((frac: number) => {
    const a = audioRef.current;
    if (!a) return;
    /* Infinity-duration streams: fall back to the known full length —
     * the scrub bar used to silently no-op on those. */
    const total =
      Number.isFinite(a.duration) && a.duration > 0 ? a.duration : durRef.current;
    if (!Number.isFinite(total) || total <= 0) return;
    a.currentTime = Math.max(0, Math.min(1, frac)) * total;
    setPos(a.currentTime);
  }, []);

  if (!track) return null;

  const isPreview = Boolean(track.preview);
  const previewOnly = track.preview?.previewOnly ?? true;
  const progress = dur > 0 ? Math.min(1, pos / dur) : 0;

  return (
    <AnimatePresence>
      {!closing && (
        <motion.div
          key="veil-music-player"
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className={cn(
            "fixed right-3 bottom-3 z-[130] select-none sm:right-5 sm:bottom-5",
            attached ? "w-[min(94vw,400px)]" : "w-auto"
          )}
          role="region"
          aria-label="Veil music player"
        >
          <div
            className={cn(
              "overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-950/95 text-zinc-100 shadow-2xl shadow-black/60 backdrop-blur-xl",
              attached ? "" : "rounded-full border-zinc-800/80 bg-zinc-950/90"
            )}
          >
            {/* Header / pill row — shared chrome for both engines. */}
            <div
              className={cn(
                "flex items-center gap-3",
                attached ? "px-4 py-3" : "h-12 pl-2 pr-1.5"
              )}
            >
              {track.art ? (
                <button
                  type="button"
                  onClick={isPreview ? toggle : undefined}
                  aria-label={isPreview ? (playing ? "Pause" : "Play") : undefined}
                  className={cn("relative shrink-0", isPreview && "cursor-pointer")}
                  tabIndex={isPreview ? 0 : -1}
                >
                  <img
                    src={track.art}
                    alt=""
                    aria-hidden
                    className={cn(
                      "shrink-0 rounded-lg object-cover ring-1 ring-zinc-700/60",
                      attached ? "size-11" : "size-9"
                    )}
                  />
                  {isPreview && (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-0 flex items-center justify-center rounded-lg bg-zinc-950/0 transition",
                        !playing ? "bg-zinc-950/45 opacity-0 hover:opacity-100" : ""
                      )}
                    >
                      {playing ? (
                        <span className="flex items-end gap-[2px]" aria-hidden>
                          <i className="vm-eq vm-eq1" />
                          <i className="vm-eq vm-eq2" />
                          <i className="vm-eq vm-eq3" />
                        </span>
                      ) : (
                        <Play className="size-4 text-white" aria-hidden />
                      )}
                    </span>
                  )}
                </button>
              ) : (
                <span
                  aria-hidden
                  className={cn(
                    "flex shrink-0 items-center justify-center rounded-lg bg-fuchsia-500/15 ring-1 ring-fuchsia-500/30",
                    attached ? "size-11" : "size-9"
                  )}
                >
                  <Music2 className="size-5 text-fuchsia-300" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                {attached && (
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-fuchsia-300/80">
                    {audioError
                      ? "Playback error"
                      : isPreview
                        ? previewOnly
                          ? "Now playing · 30s preview"
                          : "Now playing · SoundCloud"
                        : "Now playing · Spotify"}
                  </p>
                )}
                <p
                  className={cn(
                    "truncate font-medium",
                    audioError ? "text-rose-300/90" : "text-zinc-100",
                    attached ? "text-[13px] leading-tight" : "text-[12.5px]"
                  )}
                  title={audioError ? "Couldn't stream that one — try another result." : track.title}
                >
                  {audioError ? "Couldn't stream — try another" : track.title}
                </p>
                {attached && track.preview && (
                  <p className="truncate text-[11.5px] leading-tight text-zinc-500">
                    {track.preview.artist}
                    {track.preview.album ? ` · ${track.preview.album}` : ""}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {isPreview && !attached && (
                  <button
                    type="button"
                    aria-label={playing ? "Pause" : "Play"}
                    title={playing ? "Pause" : "Play"}
                    onClick={toggle}
                    className="flex size-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-800/70 hover:text-fuchsia-300"
                  >
                    {playing ? (
                      <Pause aria-hidden className="size-4" />
                    ) : (
                      <Play aria-hidden className="size-4" />
                    )}
                  </button>
                )}
                {!attached && (
                  <button
                    type="button"
                    aria-label="Expand the music player"
                    title="Expand player"
                    onClick={() => setAttached(true)}
                    className="flex size-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-800/70 hover:text-fuchsia-300"
                  >
                    <PanelTopOpen aria-hidden className="size-4" />
                  </button>
                )}
                {attached && (
                  <button
                    type="button"
                    aria-label="Collapse the music player to a pill"
                    title="Collapse to pill"
                    onClick={() => setAttached(false)}
                    className="flex size-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-800/70 hover:text-fuchsia-300"
                  >
                    <PanelTopClose aria-hidden className="size-4" />
                  </button>
                )}
                <a
                  href={track.preview?.full ?? track.embed}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={
                    track.preview
                      ? previewOnly
                        ? "Open the full track on Spotify"
                        : "Open this song on SoundCloud"
                      : "Open the Spotify embed in a new tab"
                  }
                  title={
                    track.preview
                      ? previewOnly
                        ? "Full track on Spotify"
                        : "Open on SoundCloud"
                      : "Open in Spotify"
                  }
                  className="flex size-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-800/70 hover:text-emerald-300"
                >
                  <ExternalLink aria-hidden className="size-4" />
                </a>
                <button
                  type="button"
                  aria-label="Stop the music"
                  title="Stop"
                  onClick={stop}
                  className="flex size-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-800/70 hover:text-rose-300"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </div>
            </div>

            {/* The playback surface.
                EMBED — mounted whenever an embed track exists. ATTACHED:
                full size inside the panel. DOCKED: clipped to zero height
                but still rendered (audio keeps playing). The key switches
                the iframe when a NEW track starts, which stops the old one.
                PREVIEW — a native <audio> with its own scrub bar; the
                element itself is always mounted (even docked) so playback
                never pauses on collapse, the controls only show attached. */}
            {isPreview ? (
              <audio
                ref={audioRef}
                key={`${track.preview?.url ?? "none"}#${playNonce}`}
                src={track.preview?.url}
                autoPlay
                preload="auto"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => {
                  setPlaying(false);
                  setPos(0);
                }}
                onError={() => {
                  setPlaying(false);
                  setAudioError(true);
                }}
                onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
                onDurationChange={(e) => {
                  const d = e.currentTarget.duration;
                  // Some progressive mp3s report Infinity until fully
                  // buffered — keep the known full length instead.
                  if (Number.isFinite(d) && d > 0) setDur(d);
                }}
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration;
                  if (Number.isFinite(d) && d > 0) setDur(d);
                }}
                className="hidden"
              />
            ) : (
              <div
                className={cn(
                  attached ? "block border-t border-zinc-800/80" : "h-0 overflow-hidden"
                )}
              >
                <iframe
                  key={`${track.embed}#${playNonce}`}
                  src={track.embed}
                  title={`Spotify embed: ${track.title}`}
                  width="100%"
                  height={track.kind === "track" ? 152 : 352}
                  style={{ height: track.kind === "track" ? 152 : 352, border: 0, display: "block" }}
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  loading="lazy"
                />
              </div>
            )}

            {/* Preview scrub bar — the attached panel's own transport UI. */}
            {isPreview && attached && (
              <div className="border-t border-zinc-800/80 px-4 py-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={toggle}
                    aria-label={playing ? "Pause" : "Play"}
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-fuchsia-500 text-fuchsia-950 shadow-lg shadow-fuchsia-500/30 transition hover:bg-fuchsia-400"
                  >
                    {playing ? (
                      <Pause aria-hidden className="size-4.5" />
                    ) : (
                      <Play aria-hidden className="size-4.5 translate-x-[1px]" />
                    )}
                  </button>
                  <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-zinc-400">
                    {fmtTime(pos)}
                  </span>
                  <div
                    role="slider"
                    aria-label="Seek within the song"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress * 100)}
                    tabIndex={0}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      seek((e.clientX - r.left) / r.width);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowRight") seek(progress + 0.05);
                      if (e.key === "ArrowLeft") seek(progress - 0.05);
                    }}
                    className="group relative h-4 flex-1 cursor-pointer"
                  >
                    <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-fuchsia-400"
                        style={{ width: `${progress * 100}%` }}
                      />
                    </div>
                    <div
                      className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow ring-2 ring-fuchsia-500/60 transition group-hover:opacity-100"
                      style={{ left: `${progress * 100}%` }}
                    />
                  </div>
                  <span className="w-9 shrink-0 text-[11px] tabular-nums text-zinc-400">
                    {fmtTime(dur)}
                  </span>
                </div>
                <p className="mt-2 text-[11px] leading-snug text-zinc-500">
                  {audioError ? (
                    <span className="text-rose-300/90">
                      Couldn&apos;t stream that one — try another result.
                    </span>
                  ) : previewOnly ? (
                    <>
                      30-second preview ·{" "}
                      <a
                        href={track.preview?.full}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-300 underline-offset-2 hover:underline"
                      >
                        play the full track on Spotify
                      </a>
                    </>
                  ) : (
                    <>
                      Full song from SoundCloud ·{" "}
                      <a
                        href={track.preview?.full}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-300 underline-offset-2 hover:underline"
                      >
                        open on SoundCloud
                      </a>
                    </>
                  )}
                </p>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
