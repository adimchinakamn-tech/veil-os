"use client";

/**
 * Veil logo — the original shield mark from the first landing page,
 * revived. A shield with a keyhole cut, emerald on an emerald tile,
 * and the "Veil." wordmark with its emerald period.
 *
 * <VeilMark />        → just the shield glyph (currentColor)
 * <VeilLogo />        → inline tile + wordmark (matches the old header)
 * <VeilLogo corner /> → fixed top-right glassy badge that floats over
 *                       the start-page wallpaper (home page only)
 */

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export function VeilMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M12 22s8-3.6 8-10V5.5L12 2 4 5.5V12c0 6.4 8 10 8 10Z" />
      <path d="M9 12h2v4" />
    </svg>
  );
}

/**
 * The emerald tile from the old header logo: soft emerald fill, ring,
 * and a hover glow — exactly the treatment it had before.
 */
export function VeilLogoTile({
  className,
  iconClassName = "h-4.5 w-4.5",
}: {
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30 transition duration-300 group-hover:bg-emerald-500/25 group-hover:ring-emerald-400/50 group-hover:shadow-[0_0_24px_-6px_rgba(52,211,153,0.6)]",
        className
      )}
    >
      <VeilMark className={iconClassName} />
    </span>
  );
}

export function VeilLogo({
  corner = false,
  className,
  tileClassName,
  iconClassName,
  wordmarkClassName,
  onActivate,
  title = "Veil",
}: {
  /** Fixed top-right glassy badge over the wallpaper. */
  corner?: boolean;
  className?: string;
  tileClassName?: string;
  iconClassName?: string;
  wordmarkClassName?: string;
  /** Click handler — the old logo scrolled back to top. */
  onActivate?: () => void;
  title?: string;
}) {
  const reduceMotion = useReducedMotion();

  const inner = (
    <>
      <VeilLogoTile
        className={tileClassName ?? (corner ? "h-8 w-8" : "h-9 w-9")}
        iconClassName={iconClassName ?? (corner ? "h-4 w-4" : "h-4.5 w-4.5")}
      />
      <span
        className={cn(
          "font-semibold tracking-tight text-zinc-100",
          corner ? "text-[14px] drop-shadow-sm" : "text-[17px]",
          wordmarkClassName
        )}
      >
        Veil<span className="text-emerald-400">.</span>
      </span>
    </>
  );

  /* ---- Corner badge: fixed top-right, glassy, floats over the wallpaper ---- */
  if (corner) {
    return (
      <motion.button
        type="button"
        aria-label="Veil — back to top"
        title={title}
        onClick={onActivate}
        initial={reduceMotion ? false : { opacity: 0, y: -12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "group fixed right-4 top-4 z-40 flex items-center gap-2 rounded-full border border-white/10 bg-black/40 py-1.5 pl-1.5 pr-4 shadow-xl shadow-black/40 backdrop-blur-md transition duration-300 hover:border-emerald-500/40 hover:bg-black/55 active:scale-[0.97] sm:right-6 sm:top-5",
          className
        )}
      >
        {inner}
      </motion.button>
    );
  }

  /* ---- Inline logo (old header style) ---- */
  const cls = cn("group flex items-center gap-2.5", className);
  if (onActivate) {
    return (
      <button type="button" title={title} onClick={onActivate} className={cls}>
        {inner}
      </button>
    );
  }
  return (
    <span className={cls}>
      {inner}
    </span>
  );
}
