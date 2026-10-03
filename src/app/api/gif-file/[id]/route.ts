import { NextRequest, NextResponse } from "next/server"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"

export const runtime = "nodejs"

/**
 * Veil — same-origin GIF file server ("gifs sourced like the wallpapers").
 *
 * GET /api/gif-file/<giphyId>        → message rendition (original cut)
 * GET /api/gif-file/<giphyId>?w=1    → grid preview rendition (200w cut)
 *
 * Why: giphy.com media URLs break whenever the *client's* network blocks
 * giphy. Wallpapers never break because they are served from our own
 * origin. This route gives GIFs the same property:
 *
 *   1. Cache: every fetched gif is stored durably in upload/veil-gifs/
 *      (same revert-proof store the wallpapers mirror into).
 *   2. Serve: bytes come from OUR origin — the client never talks to
 *      giphy at all.
 *   3. Fetch: only the SERVER talks to giphy's CDN (one rendition per
 *      id, cached forever after).
 *
 * Giphy media ids are plain alphanumeric — anything else is rejected
 * (SSRF guard). Old chat messages that contain raw giphy URLs are
 * rewritten client-side to /api/gif-file/<id>, so history heals too.
 */

const CACHE_DIR = path.join(process.cwd(), "upload", "veil-gifs")
const CDN_BASE = "https://media.giphy.com/media"
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

/** 1x1 transparent gif — served when upstream is unreachable so the
 *  message bubble keeps its layout instead of showing a broken-image icon. */
const FALLBACK_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
)

function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{4,32}$/.test(id)
}

function cachePath(id: string, preview: boolean): string {
  return path.join(CACHE_DIR, `giphy-${id}${preview ? "-w" : ""}.gif`)
}

const inflight = new Map<string, Promise<Buffer | null>>()

async function fetchGif(id: string, preview: boolean): Promise<Buffer | null> {
  const file = cachePath(id, preview)
  try {
    const buf = await readFile(file)
    return buf
  } catch {
    /* not cached yet */
  }
  // Giphy rendition paths: /media/<id>/giphy.gif is the original; the
  // sized cuts live under /media/<id>/<name>.gif. Use giphy.gif (message)
  // and 200w.gif (preview) — both keyless CDN-stable.
  const rendition = preview ? "200w" : "giphy"
  const key = `${id}:${preview ? "w" : "m"}`
  let task = inflight.get(key)
  if (!task) {
    task = (async () => {
      try {
        const res = await fetch(`${CDN_BASE}/${id}/${rendition}.gif`, {
          headers: { "user-agent": UA, accept: "image/gif,*/*" },
          signal: AbortSignal.timeout(15_000),
          redirect: "follow",
        })
        if (!res.ok) return null
        const contentType = res.headers.get("content-type") || ""
        if (!contentType.includes("gif") && !contentType.includes("octet-stream")) {
          return null
        }
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.byteLength < 64 || buf.byteLength > 15_000_000) return null
        // Persist to the durable cache (best-effort).
        try {
          if (!existsSync(CACHE_DIR)) await mkdir(CACHE_DIR, { recursive: true })
          await writeFile(file, buf)
        } catch {
          /* cache write is optional */
        }
        return buf
      } catch {
        return null
      } finally {
        inflight.delete(key)
      }
    })()
    inflight.set(key, task)
  }
  return task
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params
  if (!isSafeId(id)) {
    return new NextResponse("bad id", { status: 400 })
  }
  const preview = req.nextUrl.searchParams.get("w") === "1"
  const buf = await fetchGif(id, preview)
  if (!buf) {
    // Upstream unreachable and nothing cached — keep layout with the
    // transparent placeholder instead of a hard error.
    return new NextResponse(new Uint8Array(FALLBACK_GIF), {
      status: 200,
      headers: {
        "content-type": "image/gif",
        "cache-control": "public, max-age=300",
        "x-veil-gif": "fallback",
      },
    })
  }
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "content-type": "image/gif",
      "cache-control": "public, max-age=31536000, immutable",
      "x-veil-gif": "served",
    },
  })
}
