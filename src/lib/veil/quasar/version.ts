/**
 * Quasar version — single source of truth.
 * Surfaced in the UI (header badge, footer, download card), the error pages,
 * the `x-quasar-version` response header on every proxied response, and the
 * generated self-host package (see scripts/make-release.sh).
 */

export const QUASAR_VERSION = "1.3.8";

/** One-line-per-release notes, newest first (kept short for UI display). */
export const RELEASE_NOTES: string[] = [
  "v1.3.8 — built-in adblocker: network layer answers known ad & tracker URLs with empty 204s before any upstream connection, DOM layer sweeps ad elements (adsbygoogle slots, taboola/outbrain widgets, anti-adblock scripts) and hides ad containers; popup & popunder blocker (window.open hardened, target=_blank popunders in-tunneled or counted) with a live blocked counter in the browser chrome; upstream fetches moved to raw undici so Next's fetch instrumentation can no longer corrupt large streamed pages",
  "v1.2.7 — streaming HTML rewriter (first paint while the body is still in flight), AST-based JS rewriting via acorn, full DOM trap layer (MutationObserver safety net, srcset setters, focus/notification fixes), per-site fix database, AES-256-GCM encrypted proxied URLs with per-deployment keys, SSRF guard + rate limiting + optional password gate, HLS (m3u8) rewriting, JSON media URLs, redirect-hop cookie fix (login flows), stream-safe timeouts, referer restoration, Worker hooks, tracking-param stripping, keyboard shortcuts (Alt+T/W/←/→), compact new-tab page",
  "v1.1 — self-host download package, WS transport auto-detection",
  "v1.0 — engine core: rewriter, hooks, service worker, WS bridge, tabbed UI",
];
