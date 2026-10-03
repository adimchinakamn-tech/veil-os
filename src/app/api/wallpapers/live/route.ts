/**
 * Veil — live wallpapers catalog browser API (motionbgs.com).
 *
 * Serves a parsed slice of motionbgs.com's public live-wallpaper catalog
 * (their tag listings, the 4K/mobile feeds and their search) as JSON.
 * Everything is fetched server-side with a browser-like UA, cached in
 * memory for 10 minutes, and validated against a strict category
 * whitelist so the path can never be pointed anywhere unexpected.
 *
 * The site lists each wallpaper as:
 *   <a title="Name live wallpaper" href=/slug> …
 *     <img src=/i/c/364x205/media/{id}/{file}.jpg …>
 * and serves the looping video at /media/{id}/{slug}.3840x2160.mp4 — both
 * patterns are stable, so the items resolve to a thumb + a video URL that
 * the client routes through the veil (the server serves those videos
 * from its curl-backed disk cache — see lib/veil/mbgs-media.ts).
 *
 * Response shape:
 *   { items: [{ id, name, slug, thumb, video }], page, hasMore, category }
 */

import { curlFetchText } from "@/lib/veil/curl-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://motionbgs.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TTL_MS = 10 * 60 * 1000;
const CACHE_CAP = 48;

/** Whitelisted category keys → site paths.
 *
 *  2026-09 site restructure notes (verified by probing motionbgs.com):
 *  - tag pages live at /tag:{name}/ — the old /tag/{name}/ paths now 404.
 *  - several tags the UI offered were never real site tags (or were
 *    dropped): cars, minimal, animals → remapped to live equivalents
 *    (tag:car, tag:simple, tag:cat) so every topic chip returns a feed.
 *  - the recent feed paginates at /2/, /3/… and /mobile/2/ works too.
 */
const CATEGORIES: Record<string, string> = {
  recent: "",
  anime: "tag:anime",
  superhero: "tag:superhero",
  nature: "tag:nature",
  scifi: "tag:sci-fi",
  cyberpunk: "tag:cyberpunk",
  space: "tag:space",
  dark: "tag:dark",
  city: "tag:city",
  aesthetic: "tag:aesthetic",
  animals: "tag:cat",
  fantasy: "tag:fantasy",
  horror: "tag:horror",
  minimal: "tag:simple",
  cars: "tag:car",
  neon: "tag:neon",
  "4k": "4k",
  mobile: "mobile",
};

export interface LiveItem {
  id: number;
  name: string;
  slug: string;
  thumb: string;
  video: string;
}

interface PageCache {
  at: number;
  items: LiveItem[];
  hasMore: boolean;
}

const cache = new Map<string, PageCache>();
const inFlight = new Map<string, Promise<{ items: LiveItem[]; hasMore: boolean }>>();

function listingUrl(cat: string, page: number, q: string): string {
  if (q) {
    const u = new URL(`${BASE}/search`);
    u.searchParams.set("q", q);
    return u.href;
  }
  const slug = CATEGORIES[cat] ?? "";
  if (slug === "") {
    // the recent feed paginates at /2/, /3/… off the homepage
    return page > 1 ? `${BASE}/${page}/` : `${BASE}/`;
  }
  return page > 1 ? `${BASE}/${slug}/${page}/` : `${BASE}/${slug}/`;
}

/**
 * Parse listing items. The markup is minified (unquoted attributes, one
 * physical line), so walk the titled anchors and pick up the next media
 * thumb that follows each one.
 */
function parseItems(html: string): LiveItem[] {
  const items: LiveItem[] = [];
  const seen = new Set<number>();
  // Anchors may carry a /mobile/ prefix on the mobile feed (portrait
  // wallpapers listed at href=/mobile/{slug}).
  const anchorRe = /<a title="([^"]{1,140}?) live wallpaper" href=\/(?:mobile\/)?([a-z0-9-]+)>/g;
  // Posters come in several crops (364x205 landscape, 235x418 portrait) —
  // accept any /i/c/{W}x{H}/ prefix and re-request at 546x308.
  const thumbRe = /\/i\/c\/\d+x\d+\/media\/(\d+)\/([a-z0-9.-]+?\.jpe?g)/;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const name = m[1].trim();
    const slug = m[2];
    // The poster <img> follows the anchor inside the same figure block.
    const tail = html.slice(m.index, m.index + 900);
    const t = thumbRe.exec(tail);
    if (!t) continue;
    const id = Number.parseInt(t[1], 10);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      name,
      slug,
      thumb: `${BASE}/i/c/546x308/media/${t[1]}/${t[2]}`,
      // 4K render is the canonical file (every entry transcodes to
      // 3840x2160; the server-side media accelerator falls back to
      // 1080p/540p for the rare entry without a 4K render)
      video: `${BASE}/media/${t[1]}/${slug}.3840x2160.mp4`,
    });
    if (items.length >= 60) break; // hard cap per page
  }
  return items;
}

async function fetchPage(
  key: string,
  url: string
): Promise<{ items: LiveItem[]; hasMore: boolean }> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return { items: cached.items, hasMore: cached.hasMore };
  }
  const running = inFlight.get(key);
  if (running) return running;

  const task = (async () => {
    try {
      // Cloudflare fronts the site and walls the runtime fetch's TLS
      // fingerprint with a hard 403 (not an intermittent challenge
      // anymore). curl's handshake sails through — same trick the media
      // cache uses — so catalog pages go curl-first, native fetch as the
      // fallback in case this box loses curl.
      let body: string | null = null;
      for (let attempt = 1; attempt <= 2 && body === null; attempt++) {
        try {
          const r = await curlFetchText(url, { timeoutS: 20, referer: "https://motionbgs.com/" });
          if (r.status >= 200 && r.status < 400) body = r.body;
        } catch {
          /* retry */
        }
      }
      if (body === null) {
        try {
          const res = await fetch(url, {
            cache: "no-store",
            headers: {
              "user-agent": UA,
              accept: "text/html,application/xhtml+xml,*/*;q=0.8",
              "accept-language": "en-US,en;q=0.9",
            },
            redirect: "follow",
            signal: AbortSignal.timeout(20_000),
          });
          if (res.ok) body = await res.text();
        } catch {
          /* dead end — report below */
        }
      }
      if (body === null) throw new Error("upstream unreachable");
      const items = parseItems(body);
      // Full pages carry ~35 items; anything close has a next page. Search
      // is single-page. (The recent feed paginates at /2/ since the site
      // restructure, so it gets load-more like everything else.)
      const hasMore = items.length >= 30 && !key.startsWith("q:");
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

/* CORS — the single-file Veil build (file://) browses this catalog from
 * its birth origin; file:// pages send Origin: null. */
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
    : Math.min(Math.max(Number.parseInt(sp.get("page") ?? "1", 10) || 1, 1), 50);

  if (!(cat in CATEGORIES)) {
    return Response.json({ error: "unknown category" }, { status: 400 });
  }

  const key = `${q ? `q:${q}` : `c:${cat}`}#${page}`;
  try {
    const { items, hasMore } = await fetchPage(key, listingUrl(cat, page, q));
    return cors(
      Response.json(
        { items, page, hasMore, category: cat },
        { headers: { "cache-control": "public, max-age=600" } }
      )
    );
  } catch {
    return cors(
      Response.json(
        {
          error: "the live wallpaper catalog is unreachable right now",
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
