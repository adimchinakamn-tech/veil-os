"use client";

/**
 * Veil — the applied live wallpaper, played in two stages.
 *
 * Used by every surface that shows the applied wallpaper full-bleed (the
 * start page backdrop, the arcade's xylora-style catalog backdrop).
 *
 *  1. FAST START — the preview-quality variant (the motionbgs 1080p render
 *     or the pack's 720p sibling) begins playing immediately. A quarter of
 *     the pixels means the backdrop is moving within a second or two even
 *     on a completely cold cache, instead of staring at the poster for
 *     many seconds while a 4K file trickles in.
 *
 *  2. THE 4K UPGRADE — a hidden preloader element (no decode pipeline:
 *     muted, not playing, 1px) buffers the full-resolution original in
 *     the background. The moment it can play through, the visible element
 *     swaps its src to the 4K file — served from the server's disk cache
 *     with immutable browser caching, so the swap is instant on warm
 *     revisits — and resumes exactly where the preview had reached.
 *
 * If the full file never becomes playable (network died mid-download),
 * the backdrop simply keeps playing the preview variant: graceful, never
 * a dead poster.
 */

import * as React from "react";
import { previewVideoSrcFor } from "@/lib/veil/wallpapers";

export function BackdropVideo({ src, poster }: { src: string; poster?: string }) {
  const preview = React.useMemo(() => previewVideoSrcFor(src), [src]);
  const [full, setFull] = React.useState(false);
  const mainRef = React.useRef<HTMLVideoElement | null>(null);
  const resumeAt = React.useRef(0);
  const onPreviewStage = Boolean(preview) && !full;
  const activeSrc = onPreviewStage ? (preview as string) : src;

  // A newly applied wallpaper restarts at the fast-start stage.
  React.useEffect(() => {
    setFull(false);
    resumeAt.current = 0;
  }, [src]);

  const upgrade = () => {
    if (!full) {
      // Remember where the preview had reached so the 4K swap is
      // positionally seamless.
      resumeAt.current = mainRef.current?.currentTime ?? 0;
      setFull(true);
    }
  };

  return (
    <>
      <video
        key={activeSrc}
        ref={mainRef}
        src={activeSrc}
        poster={poster}
        muted
        loop
        autoPlay
        playsInline
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (resumeAt.current > 0 && Number.isFinite(v.duration) && v.duration > 0) {
            try {
              v.currentTime = resumeAt.current % v.duration;
            } catch {
              /* seek before ready — the loop restart is an acceptable fallback */
            }
          }
          void v.play().catch(() => {
            /* muted autoplay is allowed; a rare rejection just waits for the attribute */
          });
        }}
        className="size-full object-cover"
      />
      {/* The hidden 4K preloader — buffers (never decodes/renders) the
          full-resolution file while the preview plays. */}
      {onPreviewStage && (
        <video
          src={src}
          muted
          playsInline
          preload="auto"
          aria-hidden
          tabIndex={-1}
          onCanPlayThrough={upgrade}
          onCanPlay={upgrade}
          className="pointer-events-none absolute left-0 top-0 size-px opacity-0"
        />
      )}
    </>
  );
}
