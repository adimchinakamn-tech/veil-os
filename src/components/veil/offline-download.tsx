"use client";

/**
 * Veil — offline download button.
 *
 * DISABLED: the single-file offline build (a GUST-engine derivative) is no
 * longer produced — per product decision the site keeps its own engine and
 * no "download Veil" affordances. The component remains as a no-op so every
 * section that imports it keeps compiling; if the offline pack ever returns,
 * restore the original implementation from the git history.
 */

export function OfflineDownload({
  variant = "header",
  className,
}: {
  variant?: "header" | "pill";
  className?: string;
}) {
  // No-op: renders nothing on purpose.
  void variant;
  void className;
  return null;
}
