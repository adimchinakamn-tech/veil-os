/**
 * Favicon service — fetches and caches site icons so the browser UI can
 * show favicons for quick links, tabs and history without third-party
 * requests from the client.
 *   GET /api/favicon?host=example.com
 */

import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Entry = { buf: ArrayBuffer; ct: string };
const cache = new Map<string, Entry>();
const MAX_ENTRIES = 256;

const HOST_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#27272a"/><circle cx="16" cy="16" r="6" fill="#7c3aed"/></svg>`;

async function tryFetch(url: string): Promise<Entry | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36" },
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > 500_000) return null;
    const ct = res.headers.get("content-type") ?? "image/png";
    if (!ct.startsWith("image/") && !ct.includes("octet-stream")) return null;
    return { buf, ct };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const host = (new URL(req.url).searchParams.get("host") ?? "").toLowerCase().trim();
  const headers = {
    "cache-control": "public, max-age=86400",
    "content-type": "image/svg+xml",
  };
  if (!HOST_RE.test(host)) {
    return new Response(FALLBACK_SVG, { headers });
  }

  const hit = cache.get(host);
  if (hit) {
    return new Response(hit.buf, { headers: { ...headers, "content-type": hit.ct } });
  }

  const entry =
    (await tryFetch(`https://icons.duckduckgo.com/ip3/${host}.ico`)) ??
    (await tryFetch(`https://www.google.com/s2/favicons?domain=${host}&sz=64`));

  if (!entry) {
    return new Response(FALLBACK_SVG, { headers });
  }

  if (cache.size >= MAX_ENTRIES) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(host, entry);
  return new Response(entry.buf, { headers: { ...headers, "content-type": entry.ct } });
}
