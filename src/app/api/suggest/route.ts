/**
 * Search suggestions — server-side proxy over DuckDuckGo's autocomplete
 * endpoint so the browser never talks to third parties directly.
 *   GET /api/suggest?q=ne -> { q, suggestions: [...] }
 */

import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CacheEntry = { at: number; suggestions: string[] };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 200;

export async function GET(req: NextRequest): Promise<Response> {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (!q) return Response.json({ q, suggestions: [] });

  const hit = cache.get(q.toLowerCase());
  if (hit && Date.now() - hit.at < TTL_MS) {
    return Response.json({ q, suggestions: hit.suggestions });
  }

  let suggestions: string[] = [];
  try {
    const res = await fetch("https://duckduckgo.com/ac/?q=" + encodeURIComponent(q) + "&type=list", {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[1])) {
        suggestions = data[1].map((s: unknown) => String(s)).slice(0, 8);
      } else if (data && Array.isArray(data[0]?.suggestion)) {
        suggestions = data[0].suggestion.map((s: { phrase?: unknown }) => String(s.phrase ?? "")).filter(Boolean).slice(0, 8);
      }
    }
  } catch {
    suggestions = [];
  }

  if (cache.size >= MAX_ENTRIES) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(q.toLowerCase(), { at: Date.now(), suggestions });
  return Response.json({ q, suggestions });
}
