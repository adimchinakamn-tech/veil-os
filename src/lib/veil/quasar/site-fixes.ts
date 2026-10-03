/**
 * Quasar Per-Site Fix Database
 * ----------------------------
 * Declarative compatibility overrides consulted by the engine on every
 * request, keyed by hostname suffix (longest match wins). Three consumers:
 *
 *   - fetcher.ts     → requestHeaders / stripRequestHeaders merged into the
 *                      upstream request; flags gate body rewriting.
 *   - rewriter.ts    → flags + the client-hook list injected into HTML.
 *   - hooks bundle   → clientHooks executed at document-start (__QUASAR_SITE__).
 *
 * Philosophy: only record what is KNOWN to differ. Flags are escape hatches —
 * when a site breaks under the AST rewriter, `noAst` drops it back to runtime
 * hooks instead of shipping a broken page.
 */

export interface SiteFlags {
  /** Skip acorn-based JS rewriting for this site (runtime hooks still apply). */
  noAst?: boolean;
  /** Skip the streaming HTML rewriter and use the buffered pipeline. */
  noStream?: boolean;
  /** Skip conservative JSON media-URL rewriting. */
  noJsonMedia?: boolean;
}

export interface SiteFix {
  id: string;
  /** Hostname suffixes this fix applies to ("youtube.com" matches www.youtube.com). */
  match: string[];
  /** Extra headers merged into the upstream request. */
  requestHeaders?: Record<string, string>;
  /** Headers removed from the upstream request. */
  stripRequestHeaders?: string[];
  flags?: SiteFlags;
  /** Names of client-side fixes (see hooks.ts CLIENT_FIXES) to run on page load. */
  clientHooks?: string[];
  note?: string;
}

const FIXES: SiteFix[] = [
  {
    id: "google",
    match: ["google.com", "googleapis.com", "gstatic.com", "googleusercontent.com", "googlevideo.com"],
    flags: { noAst: true },
    note: "Enormous anti-tamper bundles — AST pass is skipped; runtime hooks + SW carry the load.",
  },
  {
    id: "youtube",
    match: ["youtube.com", "youtu.be", "youtube-nocookie.com"],
    flags: { noAst: true },
    clientHooks: ["fixHasFocus"],
    note: "Search/UI/browse work via URL repair; playback needs poToken (target-side anti-bot, affects all proxies).",
  },
  {
    id: "discord",
    match: ["discord.com", "discordapp.com", "discordapp.net"],
    clientHooks: ["fakeNotifications", "fixHasFocus"],
    note: "Voice/RTC is native WebRTC — WS + REST work through the bridge.",
  },
  {
    id: "spotify",
    match: ["spotify.com", "scdn.co", "spotifycdn.com"],
    flags: { noAst: true },
    clientHooks: ["fixHasFocus"],
  },
  {
    id: "x-twitter",
    match: ["twitter.com", "x.com", "twimg.com"],
    flags: { noAst: true },
    clientHooks: ["fixHasFocus"],
    note: "Login-gated; heavy integrity checks on scripts.",
  },
  {
    id: "meta",
    match: ["facebook.com", "instagram.com", "cdninstagram.com", "fbcdn.net"],
    flags: { noAst: true },
    clientHooks: ["fixHasFocus"],
    note: "Login + bot walls are target-side; page rendering is kept intact.",
  },
  {
    id: "reddit",
    match: ["reddit.com", "redditstatic.com", "redd.it"],
    flags: { noAst: true },
    note: "Datacenter-IP rate limits are target-side.",
  },
  {
    id: "twitch",
    match: ["twitch.tv", "twitchcdn.net", "ttvnw.net"],
    flags: { noAst: true },
    clientHooks: ["fixHasFocus"],
    note: "Live playback uses HLS (m3u8 rewriting covers manifests).",
  },
  {
    id: "github",
    match: ["github.com", "githubusercontent.com", "github.io"],
    note: "Full AST + streaming pipeline stays on; GitHub is the regression canary.",
  },
  {
    id: "netflix",
    match: ["netflix.com", "nflxvideo.net", "nflxext.com"],
    clientHooks: ["fixHasFocus"],
    note: "Widevine DRM streams cannot be decrypted by any rewriting proxy.",
  },
  {
    id: "wikipedia",
    match: ["wikipedia.org", "wikimedia.org", "wiktionary.org", "wikidata.org"],
    note: "Rate limits against datacenter IPs are target-side.",
  },
  {
    id: "roblox",
    match: ["roblox.com", "rbxcdn.com", "roblox-api.com"],
    flags: { noAst: true },
    clientHooks: ["fakeNotifications"],
  },
  {
    id: "duckduckgo",
    match: ["duckduckgo.com", "ddg.gg"],
    note: "lite/html endpoints proxy well; js endpoint bot-walls datacenter IPs.",
  },
  {
    id: "hackernews",
    match: ["news.ycombinator.com", "ycombinator.com"],
    note: "Plain HTML — the streaming rewriter's easiest case.",
  },
  {
    id: "openstreetmap",
    match: ["openstreetmap.org", "osm.org"],
    note: "Leaflet tiles + JS survive the full pipeline; good AST canary.",
  },
];

/* ------------------------------------------------------------------ */
/* Lookup                                                              */
/* ------------------------------------------------------------------ */

const cache = new Map<string, SiteFix | null>();

function suffixMatch(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith("." + suffix);
}

/** Resolve the fix for a URL (null when no entry matches). Cached per hostname. */
export function siteFixFor(url: string | URL): SiteFix | null {
  let host: string;
  try {
    host = (url instanceof URL ? url : new URL(url)).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (cache.has(host)) return cache.get(host) ?? null;
  let found: SiteFix | null = null;
  let bestLen = -1;
  for (const fix of FIXES) {
    for (const suffix of fix.match) {
      if (suffixMatch(host, suffix) && suffix.length > bestLen) {
        found = fix;
        bestLen = suffix.length;
      }
    }
  }
  if (cache.size > 500) cache.clear();
  cache.set(host, found);
  return found;
}

/** All client hook names referenced by the database (validation aid). */
export const CLIENT_HOOK_NAMES: string[] = Array.from(
  new Set(FIXES.flatMap((f) => f.clientHooks ?? []))
);
