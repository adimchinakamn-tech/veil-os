/**
 * Veil — wallpaper manifest + persisted wallpaper state.
 *
 * Files live in public/ at the root: /wp-<key>.<ext> for the uploaded pack,
 * plus 720p hover-preview siblings under /wp-prev/<key>.mp4. Videos loop
 * muted as live backgrounds; images render as still backgrounds; animated
 * themes are pure-CSS gradients (zero bandwidth). Every surface sits on a
 * scrim so text stays readable.
 *
 * Persisted state (localStorage, all client-side):
 *   veil.wallpaper         → WallpaperSelection  (the applied background)
 *   veil.wallpaper.favs    → string[]            (♥-ed pack ids)
 *   veil.wallpaper.library → WallpaperSelection[] (♥-saved live/4K cards)
 *
 * Changes dispatch DOM events so every open surface re-syncs:
 *   veil:wallpaper-changed / veil:wallpaper-favs-changed /
 *   veil:wallpaper-library-changed
 */

export interface VeilWallpaper {
  id: string;
  name: string;
  kind: "image" | "video" | "animated";
  /** Null for animated themes; local root-relative for the uploaded pack. */
  src: string | null;
  thumb?: string | null;
  /** Vibe tags used by the filter rail + search. */
  tags: string[];
  desc?: string;
  /** Animated-theme key (see THEME_GRADIENTS). */
  theme?: string;
}

/** What gets persisted when a wallpaper is applied. */
export interface WallpaperSelection {
  id: string;
  /** "" for animated themes (the theme field carries the look). */
  src: string;
  kind: "image" | "video" | "animated";
  name: string;
  thumb?: string;
  theme?: string;
}

/* ── The uploaded pack (mirrors scripts/build-veil.mjs) ──────────────── */

export const UPLOADED_PACK: VeilWallpaper[] = [
  { id: "backrooms", thumb: "/wp-thumbs/backrooms.jpg",           kind: "video", name: "Backrooms",            src: "/wp-backrooms.mp4",           tags: ["live", "dark", "abstract"],    desc: "Endless yellow hallways" },
  { id: "cherry-blossom", thumb: "/wp-thumbs/cherry-blossom.jpg",      kind: "video", name: "Cherry Blossom",       src: "/wp-cherry-blossom.mp4",      tags: ["live", "nature", "aesthetic"], desc: "Petals on the wind" },
  { id: "trionda-ball", thumb: "/wp-thumbs/trionda-ball.jpg",        kind: "video", name: "Trionda Ball",         src: "/wp-trionda-ball.mp4",        tags: ["live", "abstract"],            desc: "Rolling geometry" },
  { id: "minecraft-earth", thumb: "/wp-thumbs/minecraft-earth.jpg",     kind: "video", name: "Minecraft Earth",      src: "/wp-minecraft-earth.mp4",     tags: ["live", "minecraft", "nature"], desc: "A whole world turning" },
  { id: "minecraft-fireplace", thumb: "/wp-thumbs/minecraft-fireplace.jpg", kind: "video", name: "Minecraft Fireplace",  src: "/wp-minecraft-fireplace.mp4", tags: ["live", "minecraft", "aesthetic"], desc: "Cozy blocky embers" },
  { id: "spiderman-gravity", thumb: "/wp-thumbs/spiderman-gravity.jpg",   kind: "video", name: "Spider-Man — Gravity", src: "/wp-spiderman-gravity.mp4",   tags: ["live", "superhero"],           desc: "Falling with style" },
  { id: "mobile-video", thumb: "/wp-thumbs/mobile-video.jpg",        kind: "video", name: "Motion Loop I",        src: "/wp-mobile-video.mp4",        tags: ["live", "aesthetic"],           desc: "Ambient drift" },
  { id: "mobile-video2", thumb: "/wp-thumbs/mobile-video2.jpg",       kind: "video", name: "Motion Loop II",       src: "/wp-mobile-video2.mp4",       tags: ["live", "aesthetic"],           desc: "Ambient drift, again" },
  { id: "neon-aurora", thumb: "/wp-thumbs/neon-aurora.jpg",         kind: "image", name: "Neon Aurora",          src: "/wp-neon-aurora.png",         tags: ["static", "aesthetic", "abstract"], desc: "Electric skies" },
  { id: "cubes", thumb: "/wp-thumbs/cubes.jpg",               kind: "image", name: "Cube Field",           src: "/wp-cubes.jpg",               tags: ["static", "abstract"],          desc: "Isometric calm" },
  { id: "jellyfish", thumb: "/wp-thumbs/jellyfish.jpg",           kind: "image", name: "Jellyfish Drift",      src: "/wp-jellyfish.jpg",           tags: ["static", "nature", "aesthetic"], desc: "Deep-sea lanterns" },
  { id: "lake", thumb: "/wp-thumbs/lake.jpg",                kind: "image", name: "Still Lake",           src: "/wp-lake.jpg",                tags: ["static", "nature"],            desc: "Mirror water" },
  { id: "minecraft-bee", thumb: "/wp-thumbs/minecraft-bee.jpg",       kind: "image", name: "Minecraft Bee",        src: "/wp-minecraft-bee.png",       tags: ["static", "minecraft"],         desc: "The pollinator at rest" },
  { id: "minecraft-blocks", thumb: "/wp-thumbs/minecraft-blocks.jpg",    kind: "image", name: "Minecraft Blocks",     src: "/wp-minecraft-blocks.jpg",    tags: ["static", "minecraft"],         desc: "Terrain, cubed" },
  { id: "spiderman", thumb: "/wp-thumbs/spiderman.jpg",           kind: "image", name: "Spider-Man Art",       src: "/wp-spiderman.jpg",           tags: ["static", "superhero"],         desc: "Web-head, inked" },
  { id: "aluminium", thumb: "/wp-thumbs/aluminium.jpg",           kind: "image", name: "Liquid Aluminium",     src: "/wp-aluminium.jpg",           tags: ["static", "abstract", "aesthetic"], desc: "Molten chrome waves" },
  { id: "apocalyptic", thumb: "/wp-thumbs/apocalyptic.jpg",         kind: "image", name: "Apocalyptic Skyline",  src: "/wp-apocalyptic.png",         tags: ["static", "dark", "fantasy"],   desc: "The last city" },
];

export const DEFAULT_WALLPAPER = "neon-aurora";

/* ── Procedural animated themes (pure CSS) ──────────────────────────── */

/** Theme key → tailwind gradient stops (kept in sync with the section's
 *  MINI_THEMES map — the start page and the gallery share the same look). */
export const THEME_GRADIENTS: Record<string, string> = {
  sulfur: "from-amber-400/70 to-orange-600/60",
  emerald: "from-emerald-400/70 to-teal-600/60",
  aurora: "from-emerald-400/60 to-indigo-500/60",
  nebula: "from-violet-400/70 to-fuchsia-600/60",
  grid: "from-fuchsia-500/60 to-cyan-400/60",
  sunset: "from-orange-400/70 to-rose-600/60",
  ocean: "from-sky-400/70 to-teal-400/60",
  ash: "from-zinc-400/60 to-red-500/40",
  mono: "from-zinc-300/60 to-zinc-600/60",
};

export const ANIMATED_THEMES: VeilWallpaper[] = [
  { id: "theme-sulfur", kind: "animated", name: "Sulfur",   src: null, theme: "sulfur", tags: ["live"], desc: "Molten amber haze" },
  { id: "theme-emerald", kind: "animated", name: "Emerald", src: null, theme: "emerald", tags: ["live"], desc: "Deep green calm" },
  { id: "theme-aurora", kind: "animated", name: "Aurora",   src: null, theme: "aurora", tags: ["live"], desc: "Northern lights" },
  { id: "theme-nebula", kind: "animated", name: "Nebula",   src: null, theme: "nebula", tags: ["live"], desc: "Stellar dust" },
  { id: "theme-grid", kind: "animated", name: "Synthgrid", src: null, theme: "grid", tags: ["live"], desc: "Neon circuitry" },
  { id: "theme-sunset", kind: "animated", name: "Sunset",   src: null, theme: "sunset", tags: ["live"], desc: "Last light" },
  { id: "theme-ocean", kind: "animated", name: "Ocean",     src: null, theme: "ocean", tags: ["live"], desc: "Rolling blue" },
  { id: "theme-ash", kind: "animated", name: "Ash",         src: null, theme: "ash", tags: ["live"], desc: "Embers and dust" },
  { id: "theme-mono", kind: "animated", name: "Mono",       src: null, theme: "mono", tags: ["live"], desc: "Quiet grayscale" },
];

/* ── Filter rail (Settings-consistent ids) ──────────────────────────── */

export const WALLPAPER_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "favorites", label: "Favorites" },
  { id: "live", label: "Live" },
  { id: "static", label: "Static" },
  { id: "nature", label: "Nature" },
  { id: "abstract", label: "Abstract" },
  { id: "aesthetic", label: "Aesthetic" },
  { id: "minecraft", label: "Minecraft" },
  { id: "superhero", label: "Superhero" },
  { id: "dark", label: "Dark" },
  { id: "fantasy", label: "Fantasy" },
];

/* ── Storage helpers ────────────────────────────────────────────────── */

const SEL_KEY = "veil.wallpaper";
const FAVS_KEY = "veil.wallpaper.favs";
const LIB_KEY = "veil.wallpaper.library";

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full/blocked — state stays in-memory for this session */
  }
}

function ping(event: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(event));
}

function asSelection(v: unknown): WallpaperSelection | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Partial<WallpaperSelection>;
  if (typeof s.id !== "string" || typeof s.kind !== "string") return null;
  if (s.kind !== "image" && s.kind !== "video" && s.kind !== "animated") return null;
  return {
    id: s.id,
    src: typeof s.src === "string" ? s.src : "",
    kind: s.kind,
    name: typeof s.name === "string" ? s.name : "",
    thumb: typeof s.thumb === "string" ? s.thumb : undefined,
    theme: typeof s.theme === "string" ? s.theme : undefined,
  };
}

/* ── Applied selection ──────────────────────────────────────────────── */

export function loadWallpaperSelection(): WallpaperSelection | null {
  return asSelection(readJson<unknown>(SEL_KEY, null));
}

/** Persist + announce the applied wallpaper (pack cards). */
export function saveWallpaperSelection(sel: WallpaperSelection): void {
  writeJson(SEL_KEY, sel);
  ping("veil:wallpaper-changed");
}

/** Persist + announce the applied wallpaper with full data (live/4K cards). */
export function saveWallpaperData(sel: WallpaperSelection): void {
  writeJson(SEL_KEY, sel);
  ping("veil:wallpaper-changed");
}

export function clearWallpaperSelection(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(SEL_KEY);
    } catch {
      /* ignore */
    }
  }
  ping("veil:wallpaper-changed");
}

/* ── Favorites ──────────────────────────────────────────────────────── */

export function readFavoriteIds(): Set<string> {
  const ids = readJson<string[]>(FAVS_KEY, []);
  return new Set(Array.isArray(ids) ? ids.filter((i) => typeof i === "string") : []);
}

export function toggleWallpaperFavorite(id: string): void {
  const ids = readFavoriteIds();
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  writeJson(FAVS_KEY, [...ids]);
  ping("veil:wallpaper-favs-changed");
}

/* ── Saved library (live/4K cards ♥-ed into My pack) ────────────────── */

export function loadLibrary(): WallpaperSelection[] {
  const list = readJson<unknown[]>(LIB_KEY, []);
  if (!Array.isArray(list)) return [];
  return list.map(asSelection).filter((s): s is WallpaperSelection => s !== null);
}

export function libraryHas(id: string): boolean {
  return loadLibrary().some((s) => s.id === id);
}

export function saveToLibrary(sel: WallpaperSelection): void {
  const lib = loadLibrary().filter((s) => s.id !== sel.id);
  lib.unshift(sel);
  writeJson(LIB_KEY, lib.slice(0, 60));
  ping("veil:wallpaper-library-changed");
}

export function removeFromLibrary(id: string): void {
  writeJson(LIB_KEY, loadLibrary().filter((s) => s.id !== id));
  ping("veil:wallpaper-library-changed");
}

export function clearLibrary(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(LIB_KEY);
    } catch {
      /* ignore */
    }
  }
  ping("veil:wallpaper-library-changed");
}

/* ── The rendered My-pack grid ──────────────────────────────────────── */

function selectionAsCard(sel: WallpaperSelection): VeilWallpaper {
  return {
    id: sel.id,
    name: sel.name,
    kind: sel.kind,
    src: sel.src || null,
    thumb: sel.thumb ?? null,
    theme: sel.theme,
    tags: ["saved"],
    desc: "Saved into My pack",
  };
}

/**
 * The full "My pack" grid: the currently applied live/4K selection injected
 * at the front, favorites floated to the top, then the uploaded pack, then
 * library saves.
 */
export function fullPack(): VeilWallpaper[] {
  const favs = readFavoriteIds();
  const lib = loadLibrary();
  const sel = loadWallpaperSelection();

  const base = [...UPLOADED_PACK, ...lib.map(selectionAsCard)];
  const cards =
    sel && !base.some((w) => w.id === sel.id) ? [selectionAsCard(sel), ...base] : [...base];

  // Stable sort: favorites first, everything else keeps its order.
  return cards
    .map((w, i) => ({ w, i }))
    .sort((a, b) => Number(favs.has(b.w.id)) - Number(favs.has(a.w.id)) || a.i - b.i)
    .map(({ w }) => w);
}

/* ── URL helpers ────────────────────────────────────────────────────── */

/** Local pack files + data URIs serve same-origin; absolute URLs route. */
export function isLocalAsset(src: string | null | undefined): boolean {
  const s = (src ?? "").trim();
  if (!s) return false;
  return s.startsWith("/") || s.startsWith("data:");
}

/**
 * A renderable URL for a saved/thumb src: data URIs and root-relative paths
 * pass through; absolute http(s) URLs are re-pointed through the veil (their
 * CDNs bot-wall direct browser hits, but answer our server).
 */
export function renderSrc(src: string | null | undefined): string | null {
  const s = (src ?? "").trim();
  if (!s) return null;
  if (isLocalAsset(s)) return s;
  if (/^https?:\/\//i.test(s)) {
    // Inline routeUrl to avoid a client/server import cycle in this module.
    const replaced = s.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//, "$1/");
    const encoded = replaced.replace(
      /%(?![0-9A-Fa-f]{2})|[^A-Za-z0-9\-._~!$&'()*+,;=:@/?#%]/g,
      (ch: string) => (ch === "%" ? "%25" : encodeURIComponent(ch))
    );
    return `/api/p/${encoded}`;
  }
  return null;
}

/**
 * The motionbgs catalog poster for a video URL (absolute or already routed):
 * https://motionbgs.com/media/{id}/{slug}.3840x2160.mp4 → the 546x308 jpg.
 * Routed so the thumb loads through our server-side cache.
 */
export function motionbgsPoster(videoUrl: string | null | undefined): string | null {
  const s = (videoUrl ?? "").trim();
  if (!s) return null;
  const m = /https:\/\/motionbgs\.com\/media\/(\d+)\/([a-z0-9.-]+?)\.mp4/i.exec(s);
  if (!m) return null;
  return renderSrc(`https://motionbgs.com/i/c/546x308/media/${m[1]}/${m[2]}.jpg`);
}

/**
 * Preview-quality src for ANY applied/routed wallpaper video — the shared
 * engine behind the start-page backdrop's two-stage playback, the gallery
 * hover previews and the preview popup:
 *  - local pack videos map to their 720p sibling under /wp-prev/
 *  - routed (or absolute) motionbgs videos map to the 1080p variant
 *    (?vw=1080 — a quarter of the 4K pixels; the server's media
 *    accelerator serves that variant from its curl-backed disk cache)
 *
 * Full-resolution playback stays what Apply/Download/the eventual upgrade
 * use; this is only the fast-start stage. Returns null when no lighter
 * variant exists (unknown srcs render at full quality directly).
 */
export function previewVideoSrcFor(src: string | null | undefined): string | null {
  const s = (src ?? "").trim();
  if (!s) return null;
  // Local pack video: /wp-{name}.mp4 → /wp-prev/{name}.mp4 (720p sibling).
  if (isLocalAsset(s)) {
    const m = /^\/wp-([\w-]+)\.mp4$/i.exec(s);
    return m ? `/wp-prev/${m[1]}.mp4` : null;
  }
  // Routed motionbgs video (routeUrl turns "https://" into "https/").
  if (/^\/api\/p\/https\/motionbgs\.com\/media\/.+\.mp4$/i.test(s)) {
    return `${s}${s.includes("?") ? "&" : "?"}vw=1080`;
  }
  // Absolute motionbgs video URL.
  if (/^https?:\/\/([\w-]+\.)*motionbgs\.com\//i.test(s)) {
    const routed = renderSrc(s);
    if (!routed) return null;
    return `${routed}${routed.includes("?") ? "&" : "?"}vw=1080`;
  }
  return null;
}

/** Resolve a pack wallpaper by id. */
export function wallpaperById(id: string | null | undefined): VeilWallpaper | null {
  if (!id) return null;
  return (
    UPLOADED_PACK.find((w) => w.id === id) ??
    ANIMATED_THEMES.find((w) => w.id === id) ??
    null
  );
}

/** Back-compat minimal manifest (id/file/kind/tag) for older callers. */
export interface Wallpaper {
  id: string;
  name: string;
  file: string;
  kind: "image" | "video";
  tag: string;
}

export const WALLPAPERS: Wallpaper[] = UPLOADED_PACK.map((w) => ({
  id: w.id,
  name: w.name,
  file: w.src ?? "",
  kind: w.kind === "video" ? "video" : "image",
  tag: w.tags[0] ?? "misc",
}));
