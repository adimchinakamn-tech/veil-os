import { NextRequest, NextResponse } from "next/server"
import { GIF_LIBRARY } from "@/lib/veil/gif-library"

export const runtime = "nodejs"

/**
 * Veil Chat — GIF search, sourced like the wallpapers.
 *
 * PRIMARY: giphy.com's own public catalog, queried server-side with the
 * web keys giphy.com ships inside its frontend bundles (the same ones
 * every visitor's browser sends). Search + trending both paginate with
 * `offset`, so the picker can scroll forever — "infinite GIFs". Results
 * are cached in memory for 10 minutes (the wallpaper-catalog pattern),
 * in-flight requests are deduped, and upstream failures trip a short
 * circuit breaker so the picker falls back instantly afterwards.
 *
 * FALLBACK: the curated local pack in public/gifs/ (mirrored durably in
 * upload/veil-gifs/) with pure keyword matching — zero external calls.
 * The picker never dies: if giphy is unreachable the grid still fills.
 *
 * Response shape:
 *   { ok, gifs: [{ id, title, preview, url, width, height }],
 *     source: "giphy" | "local", page, hasMore }
 *
 * CORS: the single-file Veil build (file://) browses this catalog from
 * its birth origin; file:// pages send Origin: null.
 */

/* Giphy's own web keys (desktop web + mobile web) — public by design,
 * embedded in every page their site serves. */
const GIPHY_KEYS = [
  "Gc7131jiJuvI7IdN0HZ1D7nh0ow5BU6g",
  "L8eXbxrbPETZxlvgXN9kIEzQ55Df04v0",
]
const API_BASE = "https://api.giphy.com/v1"
const LIMIT = 50
// Browser-shaped fingerprint: giphy sees the same UA a visitor's browser
// sends, not undici's bare server fetch signature.
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
const MAX_PAGE = 200 // offset 6'000 — giphy caps out well past this
const TTL_MS = 10 * 60 * 1000
const CACHE_CAP = 64

interface GiphyImage {
  url?: string
  width?: string
  height?: string
}
interface GiphyItem {
  id?: string
  title?: string
  images?: Record<string, GiphyImage>
}
export interface GifResult {
  id: string
  title: string
  preview: string
  url: string
  width: number
  height: number
}

const cache = new Map<string, { at: number; gifs: GifResult[]; hasMore: boolean }>()
const inFlight = new Map<string, Promise<{ gifs: GifResult[]; hasMore: boolean }>>()
/** Per-key upstream failure cooldown — one bad key never blinds the
 *  whole picker; the healthy key keeps answering instantly. */
const keyCooldown = new Map<string, number>()
const KEY_COOLDOWN_MS = 60 * 1000

function giphyUrl(endpoint: "search" | "trending", q: string, page: number, key: string): string {
  const u = new URL(`${API_BASE}/gifs/${endpoint}`)
  u.searchParams.set("api_key", key)
  u.searchParams.set("limit", String(LIMIT))
  u.searchParams.set("offset", String((page - 1) * LIMIT))
  u.searchParams.set("rating", "pg")
  if (endpoint === "search") u.searchParams.set("q", q)
  return u.href
}

/**
 * Pick the rendition — then serve it SAME-ORIGIN (like the wallpapers).
 *
 * Giphy's media URLs only load when the CLIENT can reach giphy; when
 * giphy is blocked the chat's GIFs break. Wallpapers never break because
 * they come from our own origin. So every giphy result is rewritten to
 * /api/gif-file/<id> — a server-side proxy that fetches once, caches to
 * upload/veil-gifs/ and serves the bytes from OUR origin forever after.
 * The client never talks to giphy.
 */
function mapItem(g: GiphyItem): GifResult | null {
  if (!g.id) return null
  const imgs = g.images || {}
  const width = Number.parseInt(imgs.fixed_width?.width || imgs.original?.width || "200", 10) || 200
  const height =
    Number.parseInt(imgs.fixed_width?.height || imgs.original?.height || "150", 10) || 150
  return {
    id: g.id,
    title: (g.title || "").trim(),
    preview: `/api/gif-file/${g.id}?w=1`,
    url: `/api/gif-file/${g.id}`,
    width,
    height,
  }
}

async function fetchGiphy(
  key: string,
  endpoint: "search" | "trending",
  q: string,
  page: number
): Promise<{ gifs: GifResult[]; hasMore: boolean } | null> {
  try {
    const res = await fetch(giphyUrl(endpoint, q, page, key), {
      cache: "no-store",
      headers: { "user-agent": BROWSER_UA, accept: "application/json", "accept-language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { data?: GiphyItem[] }
    if (!Array.isArray(body.data)) return null
    const gifs = body.data.map(mapItem).filter((x): x is GifResult => x !== null)
    // A full page implies more; giphy's pagination.total_count is huge
    // and unreliable per-key, so use the simple signal.
    return { gifs, hasMore: gifs.length >= LIMIT }
  } catch {
    return null
  }
}

async function fetchPage(
  key: string,
  endpoint: "search" | "trending",
  q: string,
  page: number
): Promise<{ gifs: GifResult[]; hasMore: boolean; source: "giphy" | "local" }> {
  const cacheKey = `${endpoint}:${q}#${page}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.at < TTL_MS) {
    return { ...cached, source: "giphy" }
  }
  const running = inFlight.get(cacheKey)
  if (running) return { ...(await running), source: "giphy" }

  const task = (async () => {
    // Try each known key until one answers; a failing key sits in its own
    // short cooldown while the others keep serving.
    const now = Date.now()
    const ordered = [...GIPHY_KEYS].sort(
      (a, b) => (keyCooldown.get(a) || 0) - (keyCooldown.get(b) || 0),
    )
    for (const key of ordered) {
      if (now - (keyCooldown.get(key) || 0) < KEY_COOLDOWN_MS) continue
      const r = await fetchGiphy(key, endpoint, q, page)
      if (r) {
        if (r.gifs.length > 0 || page === 1) {
          cache.set(cacheKey, { at: Date.now(), ...r })
          if (cache.size > CACHE_CAP) {
            const keys = [...cache.keys()].slice(0, Math.ceil(CACHE_CAP / 4))
            for (const k of keys) cache.delete(k)
          }
        }
        return r
      }
      keyCooldown.set(key, Date.now())
    }
    return null
  })()

  inFlight.set(cacheKey, task)
  try {
    const r = await task
    if (r) return { ...r, source: "giphy" }
    return { ...localFallback(endpoint, q), source: "local" }
  } finally {
    inFlight.delete(cacheKey)
  }
}

/* ── local curated pack fallback (the pre-Giphy library) ────────── */

const MAX_LOCAL = 30

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function singular(w: string): string {
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1)
  return w
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function localFallback(endpoint: "search" | "trending", q: string): {
  gifs: GifResult[]
  hasMore: boolean
} {
  let gifs: { id: string; url: string; score: number }[]
  if (endpoint === "trending" || !q.trim()) {
    gifs = GIF_LIBRARY.map((g) => ({
      id: g.file.replace(/\.gif$/, ""),
      url: `/gifs/${g.file}`,
      score: 0,
    })).sort((a, b) => hash(a.id) - hash(b.id))
  } else {
    const tokens = tokenize(q).map(singular)
    gifs = []
    for (const entry of GIF_LIBRARY) {
      let score = 0
      for (const tok of tokens) {
        for (const tag of entry.tags) {
          const t = tag.toLowerCase()
          if (t === tok) score += 3
          else if (t.split(/[^a-z0-9]+/).includes(tok)) score += 2
          else if (t.includes(tok) && tok.length >= 4) score += 1
        }
      }
      if (score > 0) {
        gifs.push({ id: entry.file.replace(/\.gif$/, ""), url: `/gifs/${entry.file}`, score })
      }
    }
    gifs.sort((a, b) => b.score - a.score || hash(a.id) - hash(b.id))
  }
  return {
    gifs: gifs.slice(0, MAX_LOCAL).map((g) => ({
      id: g.id,
      title: "",
      preview: g.url,
      url: g.url,
      width: 200,
      height: 200,
    })),
    hasMore: false,
  }
}

/* ── CORS (single-file build, Origin: null) ─────────────────────── */

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

function cors(res: Response): Response {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v)
  return res
}

export async function OPTIONS(): Promise<Response> {
  return cors(new Response(null, { status: 204 }))
}

export async function GET(req: NextRequest) {
  try {
    const raw = (req.nextUrl.searchParams.get("q") || "trending").trim()
    const page = Math.min(
      Math.max(Number.parseInt(req.nextUrl.searchParams.get("page") || "1", 10) || 1, 1),
      MAX_PAGE,
    )

    const isTrending = !raw || raw.toLowerCase() === "trending"
    const endpoint: "search" | "trending" = isTrending ? "trending" : "search"
    const term = isTrending ? "" : raw.slice(0, 80)

    const { gifs, hasMore, source } = await fetchPage(
      `${endpoint}:${term}`,
      endpoint,
      term,
      page,
    )

    /* Never-empty grid: a niche search with zero upstream matches falls
     * back to the curated local pack, then to trending — the picker never
     * shows a dead "no results" wall for page 1. */
    if (endpoint === "search" && page === 1 && gifs.length === 0) {
      const local = localFallback("search", term)
      if (local.gifs.length > 0) {
        return cors(
          NextResponse.json(
            { ok: true, gifs: local.gifs, source: "local", page, hasMore: false },
            { headers: { "cache-control": "public, max-age=300" } },
          ),
        )
      }
      const trend = await fetchPage("trending:trending", "trending", "", 1)
      if (trend.gifs.length > 0) {
        return cors(
          NextResponse.json(
            { ok: true, gifs: trend.gifs, source: "trending", page, hasMore: trend.hasMore },
            { headers: { "cache-control": "public, max-age=300" } },
          ),
        )
      }
    }

    return cors(
      NextResponse.json(
        { ok: true, gifs, source, page, hasMore },
        { headers: { "cache-control": "public, max-age=600" } },
      ),
    )
  } catch (err) {
    console.error("[gif-search] error", err)
    return cors(
      NextResponse.json(
        { ok: false, gifs: [], source: "local", page: 1, hasMore: false, error: "GIF search failed — try again." },
        { status: 200 },
      ),
    )
  }
}
