/**
 * Veil — 4K wallpaper catalog browser API (4kwallpapers.com).
 *
 * Serves a parsed slice of the site's public catalog (curated home feed,
 * category listings with pagination, and its search — /search/?text=) as
 * JSON. Everything is fetched server-side with a browser UA, cached in
 * memory for 10 minutes, and validated against a strict category whitelist.
 *
 * Item shape:
 *   { id, name, slug, category, thumb, detail }
 * The lightbox resolves actual downloadable resolutions via
 * /api/wallpapers/detail.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://4kwallpapers.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TTL_MS = 10 * 60 * 1000;
const CACHE_CAP = 48;

/** Whitelisted category keys → site paths. */
const CATEGORIES: Record<string, string> = {
  recent: "",
  nature: "nature",
  anime: "anime",
  abstract: "abstract",
  cars: "cars",
  minimal: "minimal",
  dark: "black-dark",
  fantasy: "fantasy",
  space: "space-art",
  aesthetic: "aesthetic-wallpapers",
  animals: "animals",
  architecture: "architecture",
  flowers: "flowers",
  movies: "movies",
  music: "music",
  cute: "cute",
};

export interface CatalogItem {
  id: number;
  name: string;
  slug: string;
  category: string;
  thumb: string;
  detail: string;
}

interface PageCache {
  at: number;
  items: CatalogItem[];
  hasMore: boolean;
}

const cache = new Map<string, PageCache>();
const inFlight = new Map<string, Promise<{ items: CatalogItem[]; hasMore: boolean }>>();

function listingUrl(cat: string, page: number, q: string): string {
  // The site's search form posts to /search/ with the field named "text".
  // (The old search.php?q= endpoint died and answers a 404 page that still
  // carries the recent feed — which parsed as unfiltered results and made
  // search look completely broken. "text=" works for single- AND multi-word
  // queries; "q=" only matches single tags.)
  if (q) return `${BASE}/search/?text=${encodeURIComponent(q)}`;
  const slug = CATEGORIES[cat] ?? "";
  if (slug === "") return page > 1 ? `${BASE}/?page=${page}` : `${BASE}/`;
  return page > 1 ? `${BASE}/${slug}/?page=${page}` : `${BASE}/${slug}/`;
}

function titleFromSlug(slug: string): string {
  return slug
    .replace(/-\d+$/, "")
    .split("-")
    .map((w) => (w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(" ");
}

/** Decode the handful of entities the site leaves in alt/title text. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/** Normalize any /images/walls/thumbs(_2t)/NNN.ext src to the small thumb. */
function normalizeThumb(src: string): string {
  const tm = /\/images\/walls\/thumbs(?:_2t)?\/(\d+)\.(jpe?g|png|webp)/i.exec(src);
  if (tm) return `${BASE}/images/walls/thumbs/${tm[1]}.${tm[2]}`;
  return src.startsWith("http") ? src : "";
}

/**
 * Parse listing items. The site uses two wall layouts:
 *  1. anchor wrapping the thumbnail (search + category pages)
 *  2. <p itemprop="associatedMedia"> blocks where the detail anchor is EMPTY
 *     and sits *after* the img (tag/collection pages like /spiderman-wallpapers/)
 * Both passes run; ids dedupe.
 */
function parseItems(html: string, fallbackCat: string): CatalogItem[] {
  const items: CatalogItem[] = [];
  const seen = new Set<number>();

  const push = (detail: string, slug: string, id: number, imgAttrs: string): void => {
    if (!Number.isFinite(id) || seen.has(id)) return;
    const src = /src="([^"]+)"/.exec(imgAttrs)?.[1] ?? "";
    const alt = /alt="([^"]*)"/.exec(imgAttrs)?.[1] ?? "";
    const thumb = normalizeThumb(src);
    if (!thumb) return;
    const detailPath = detail.startsWith("http") ? detail : `${BASE}${detail}`;
    let category = fallbackCat;
    try {
      const catMatch = /^\/([a-z-]+)\//.exec(new URL(detailPath).pathname);
      if (catMatch) category = catMatch[1].replace(/-/g, " ");
    } catch {
      /* keep fallback */
    }
    const name = alt
      ? decodeEntities(alt.split(",")[0].trim().slice(0, 80))
      : titleFromSlug(slug);
    seen.add(id);
    items.push({ id, name, slug, category, thumb, detail: detailPath });
  };

  // Pass 1: anchor immediately wrapping an <img>.
  const re = /<a[^>]+href="((?:https?:\/\/[^"]*|)\/(?:[a-z-]+)\/([a-z0-9-]+)-(\d+)\.html?)"[^>]*>\s*(?:<[^a>][^>]*>\s*)*<img([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    push(m[1], m[2], Number.parseInt(m[3], 10), m[4]);
    if (items.length >= 48) return items;
  }

  // Pass 2: associatedMedia blocks (anchor after the img).
  const blockRe = /<p[^>]*itemprop="associatedMedia"[^>]*>([\s\S]*?)<\/p>/gi;
  while ((m = blockRe.exec(html)) !== null) {
    const d = /href="((?:https?:\/\/[^"]*|)\/(?:[a-z-]+)\/([a-z0-9-]+)-(\d+)\.html?)"/i.exec(m[1]);
    if (!d) continue; // pack/collection tiles have no .html detail link
    const img = /<img[^>]*>/i.exec(m[1]);
    if (!img) continue;
    push(d[1], d[2], Number.parseInt(d[3], 10), img[0].replace(/^<img/, ""));
    if (items.length >= 48) return items;
  }
  return items;
}

/**
 * The site's search is an EXACT tag match: "spider-man" is one tag,
 * "attack on titan" another — any other spacing/hyphenation returns nothing.
 * When the query as typed finds nothing, retry these progressively looser
 * rewrites (deduped, original-first) so users never hit a false dead end.
 */
function searchVariants(q: string): string[] {
  const out: string[] = [];
  const tokens = q.split(/[\s-]+/).filter(Boolean);
  if (q.includes(" ")) out.push(q.replace(/ +/g, "-"));
  if (q.includes("-")) out.push(q.replace(/-+/g, " "));
  const joined = tokens.join("");
  if (joined && joined !== q) out.push(joined);
  const longest = tokens.filter((t) => t.length >= 3).sort((a, b) => b.length - a.length)[0];
  if (longest && tokens.length > 1) out.push(longest);
  return [...new Set(out)];
}

async function fetchPage(
  key: string,
  url: string,
  fallbackCat: string
): Promise<{ items: CatalogItem[]; hasMore: boolean }> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return { items: cached.items, hasMore: cached.hasMore };
  }
  const running = inFlight.get(key);
  if (running) return running;

  const task = (async () => {
    try {
      let res: Response | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          res = await fetch(url, {
            cache: "no-store",
            headers: {
              "user-agent": UA,
              accept: "text/html,application/xhtml+xml,*/*;q=0.8",
              "accept-language": "en-US,en;q=0.9",
            },
            redirect: "follow",
            signal: AbortSignal.timeout(20_000),
          });
          // /search/ normally answers 200; tolerate a 404 that still carries
          // result markup (the site has done both over time) — parse any body.
          if (res.ok || (res.status === 404 && url.includes("/search/"))) break;
          if (res.status !== 403 && res.status !== 429) break;
        } catch {
          /* retry */
        }
      }
      if (!res) throw new Error("upstream unreachable");
      const html = await res.text();
      const items = parseItems(html, fallbackCat);
      const hasMore = items.length >= 20 && !key.startsWith("q:");
      if (items.length > 0) {
        cache.set(key, { at: Date.now(), items, hasMore });
        if (cache.size > CACHE_CAP) {
          const keys = [...cache.keys()].slice(0, Math.ceil(CACHE_CAP / 4));
          for (const k of keys) cache.delete(k);
        }
      }
      return { items, hasMore };
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, task);
  return task;
}

/* CORS — the single-file Veil build (downloaded to disk, opened from
 * file://) browses this catalog from its birth origin. file:// pages
 * send Origin: null, so echo * and answer the preflight. */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function cors(res: Response): Response {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

export async function OPTIONS(): Promise<Response> {
  return cors(new Response(null, { status: 204 }));
}

export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  const cat = sp.get("cat") ?? "recent";
  const q = (sp.get("q") ?? "").trim().slice(0, 60);
  const page = q
    ? 1
    : Math.min(Math.max(Number.parseInt(sp.get("page") ?? "1", 10) || 1, 1), 100);

  if (!(cat in CATEGORIES)) {
    return Response.json({ error: "unknown category" }, { status: 400 });
  }

  const key = `${q ? `q:${q}` : `c:${cat}`}#${page}`;
  try {
    let { items, hasMore } = await fetchPage(key, listingUrl(cat, page, q), cat);
    // Exact-tag search: if the query as typed found nothing, progressively
    // retry separator rewrites ("spider man" → "spider-man" → "spiderman" →
    // "spider") before giving up, so a stray space is never a dead end.
    if (q && items.length === 0) {
      for (const variant of searchVariants(q)) {
        const r = await fetchPage(`q:${variant}#1`, listingUrl(cat, 1, variant), cat);
        if (r.items.length > 0) {
          items = r.items;
          hasMore = r.hasMore;
          break;
        }
      }
    }
    // Search replies are never browser-cached: a transient empty result
    // (upstream hiccup, ladder miss) must not pin "No wallpapers matched"
    // for 10 minutes. The in-memory server cache still dedupes upstream.
    // Empty category slices get the same treatment for the same reason.
    const cc = q || items.length === 0 ? "no-store" : "public, max-age=600";
    return cors(
      Response.json({ items, page, hasMore, category: cat }, {
        headers: { "cache-control": cc },
      })
    );
  } catch {
    return cors(
      Response.json(
        {
          error: "the wallpaper catalog is unreachable right now",
          items: [],
          page,
          hasMore: false,
          category: cat,
        },
        { status: 502 }
      )
    );
  }
}
