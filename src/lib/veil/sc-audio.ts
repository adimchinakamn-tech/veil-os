/**
 * Veil Music — the SoundCloud audio engine (SERVER-ONLY, zero API keys).
 *
 * Full-song playback, the honest way: SoundCloud's own web app talks to a
 * public api-v2 with a client_id that ships inside their JS bundles — no
 * secret, no account, the same credential every soundcloud.com visitor
 * uses. Veil extracts that id on demand (homepage → asset bundles →
 * `client_id:"…"` literal), caches it for 12h and re-discovers on 401.
 *
 * The chain (all verified against the live API):
 *   1. search    api-v2.soundcloud.com/search/tracks?q=…&client_id=…
 *                → full tracks (a few rights-limited ones expose only
 *                30s "preview" transcodings — flagged, never guessed).
 *   2. track     api-v2.soundcloud.com/tracks/{id}?client_id=…
 *                → media.transcodings[]
 *   3. transcode {transcoding-url}?client_id=…
 *                → signed cf-media.sndcdn.com mp3 URL (~30min TTL)
 *   4. bytes     Range-capable 206s straight off the CDN.
 *
 * Everything runs through Node's fetch with a browser UA — api-v2 is
 * plain JSON, no cookies, no login. Callers must never log the client_id
 * or hand it to the client; the routes below are the only surface.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/* ------------------------------------------------------------------ */
/* client_id discovery + cache                                         */
/* ------------------------------------------------------------------ */

const CLIENT_ID_TTL = 12 * 60 * 60 * 1000;
let clientId: { id: string; at: number } | null = null;
let discovering: Promise<string> | null = null;

/** Pull the current public web client_id out of the JS bundles the
 *  soundcloud.com homepage references. Only literal `client_id:"…"`
 *  assignments count — the GA cookie readers (`client_id:n(59).get(…)`)
 *  must never match. */
async function discoverClientId(): Promise<string> {
  const home = await fetch("https://soundcloud.com/", {
    headers: { "user-agent": UA, accept: "text/html" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!home.ok) throw new Error(`soundcloud home ${home.status}`);
  const html = await home.text();
  const bundles = [
    ...new Set(
      [...html.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/[\w.-]+\.js/g)].map((m) => m[0])
    ),
  ].slice(0, 12);
  if (bundles.length === 0) throw new Error("no sndcdn bundles on the homepage");

  // Parallel download, in-order scan, first literal wins.
  const texts = await Promise.all(
    bundles.map((b) =>
      fetch(b, { headers: { "user-agent": UA }, cache: "no-store", signal: AbortSignal.timeout(15_000) })
        .then((r) => (r.ok ? r.text() : ""))
        .catch(() => "")
    )
  );
  for (const js of texts) {
    const m = /client_id[":]\s*"([A-Za-z0-9_-]{20,50})"/.exec(js);
    if (m) return m[1];
  }
  throw new Error("client_id literal not found in any bundle");
}

/** The current client_id (cached 12h). `force` re-discovers — used when
 *  api-v2 answers 401 (SoundCloud rotates the id every few weeks). */
export async function getClientId(force = false): Promise<string> {
  if (!force && clientId && Date.now() - clientId.at < CLIENT_ID_TTL) return clientId.id;
  if (discovering) return discovering;
  discovering = discoverClientId()
    .then((id) => {
      clientId = { id, at: Date.now() };
      return id;
    })
    .finally(() => {
      discovering = null;
    });
  return discovering;
}

/* ------------------------------------------------------------------ */
/* api-v2 fetch helper (401 → one forced re-discovery)                 */
/* ------------------------------------------------------------------ */

async function scApi(path: string): Promise<Record<string, unknown>> {
  const url = `https://api-v2.soundcloud.com${path}${path.includes("?") ? "&" : "?"}client_id=${await getClientId()}`;
  let res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (res.status === 401) {
    const fresh = `https://api-v2.soundcloud.com${path}${path.includes("?") ? "&" : "?"}client_id=${await getClientId(true)}`;
    res = await fetch(fresh, {
      headers: { "user-agent": UA, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  }
  if (!res.ok) throw new Error(`api-v2 ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* search                                                              */
/* ------------------------------------------------------------------ */

export interface SCTrack {
  id: number;
  title: string;
  artist: string;
  /** 200×200 artwork URL (sndcdn CDN), "" when the track has none. */
  art: string;
  /** What the listener gets: the real song length for full tracks,
   *  the underlying full length for preview-only ones. */
  ms: number;
  /** True when rights only allow 30-second previews upstream. */
  previewOnly: boolean;
  /** The track's soundcloud.com page. */
  permalink: string;
}

/** A search hit is only honest if it can actually play: it must be a
 *  streamable track with transcoding media. */
function toTrack(t: Record<string, unknown>): SCTrack | null {
  if (t.kind !== "track" || t.streamable === false) return null;
  const transcodings = ((t.media as Record<string, unknown> | undefined)?.transcodings ?? []) as {
    url?: unknown;
  }[];
  if (transcodings.length === 0) return null;
  const id = Number(t.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  // Full transcodings live under …/stream/…, rights-limited ones only
  // under …/preview/… — that is the whole "full vs 30s" question.
  // PROTOCOL matters too: the stream route only plays PROGRESSIVE mp3s,
  // so a track whose /stream/ transcode is HLS-only can't deliver the
  // full song — badge it honestly as preview instead of promising 4
  // minutes and cutting at 0:30.
  const previewOnly = !transcodings.some(
    (x) =>
      typeof x.url === "string" &&
      x.url.includes("/stream/") &&
      (x.format as { protocol?: unknown } | undefined)?.protocol === "progressive"
  );
  const duration = Number(t.duration) || 0;
  const fullDuration = Number(t.full_duration) || 0;
  const ms = previewOnly ? fullDuration || duration : duration;
  const artRaw = typeof t.artwork_url === "string" ? t.artwork_url : "";
  const art = artRaw.replace(/-(large|badge|small|tiny|t\d+x\d+)\.(jpg|png|webp)/i, "-t200x200.$2");
  return {
    id,
    title: typeof t.title === "string" && t.title ? t.title : "Untitled",
    artist:
      ((t.user as Record<string, unknown> | undefined)?.username as string | undefined) ?? "Unknown artist",
    art,
    ms,
    previewOnly,
    permalink: typeof t.permalink_url === "string" ? t.permalink_url : "",
  };
}

const searchCache = new Map<string, { at: number; items: SCTrack[] }>();
const SEARCH_TTL = 10 * 60 * 1000;
/* Bounded caches — entries used to live forever (a slow memory leak on
 * a long-running server). Same eviction policy as the iTunes route. */
const SEARCH_CACHE_CAP = 48;
const searchInFlight = new Map<string, Promise<SCTrack[]>>();

function cacheSet<K, V>(map: Map<K, { at: number }>, cap: number, key: K, value: V & { at: number }): void {
  map.set(key, value);
  if (map.size > cap) {
    /* evict the OLDEST entry (Maps iterate in insertion order) */
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

export async function scSearchTracks(q: string, limit = 16): Promise<SCTrack[]> {
  const key = q.trim().toLowerCase();
  if (!key) return [];
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_TTL) return hit.items;
  /* in-flight dedupe — duplicate concurrent queries hit api-v2 once */
  const running = searchInFlight.get(key);
  if (running) return running;
  const job = (async () => {
    const data = await scApi(
      `/search/tracks?q=${encodeURIComponent(key)}&limit=${Math.min(32, limit * 2)}`
    );
    const raw = (Array.isArray(data.collection) ? data.collection : []) as Record<string, unknown>[];
    const items = raw.map(toTrack).filter((x): x is SCTrack => x !== null).slice(0, limit);
    if (items.length > 0) cacheSet(searchCache, SEARCH_CACHE_CAP, key, { at: Date.now(), items });
    return items;
  })();
  searchInFlight.set(key, job);
  try {
    return await job;
  } finally {
    searchInFlight.delete(key);
  }
}

/* ------------------------------------------------------------------ */
/* stream resolution (track → signed CDN mp3)                          */
/* ------------------------------------------------------------------ */

export interface SCStream {
  /** Signed cf-media.sndcdn.com URL (~30min TTL upstream). */
  url: string;
  previewOnly: boolean;
  ms: number;
}

const streamCache = new Map<number, { at: number; stream: SCStream }>();
const STREAM_TTL = 10 * 60 * 1000;
const STREAM_CACHE_CAP = 64;
const resolving = new Map<number, Promise<SCStream>>();

async function resolveStreamUncached(trackId: number): Promise<SCStream> {
  const t = await scApi(`/tracks/${trackId}`);
  const transcodings = ((t.media as Record<string, unknown> | undefined)?.transcodings ?? []) as {
    format?: { protocol?: unknown };
    url?: unknown;
  }[];
  // Progressive mp3 only (HLS would need a player stack for no benefit).
  const progressive = transcodings.filter(
    (x) => (x.format as { protocol?: string } | undefined)?.protocol === "progressive" && typeof x.url === "string"
  );
  const full = progressive.find((x) => typeof x.url === "string" && x.url.includes("/stream/"));
  const pick = full ?? progressive.find((x) => typeof x.url === "string" && x.url.includes("/preview/"));
  if (!pick || typeof pick.url !== "string") throw new Error("no progressive transcode for this track");
  const transcodeUrl = pick.url;

  let signed: Response | null = null;
  for (const attempt of [false, true]) {
    const res = await fetch(`${transcodeUrl}?client_id=${await getClientId(attempt)}`, {
      headers: { "user-agent": UA, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (res.ok) {
      signed = res;
      break;
    }
    // 401 → the id rotated; retry once with a fresh discovery.
    if (res.status !== 401 || attempt) throw new Error(`transcode resolve ${res.status}`);
  }
  if (!signed) throw new Error("transcode resolve failed");

  const d = (await signed.json()) as { url?: unknown };
  if (typeof d?.url !== "string" || !/^https:\/\//.test(d.url)) {
    throw new Error("transcode did not return a CDN url");
  }
  return {
    url: d.url,
    previewOnly: transcodeUrl.includes("/preview/"),
    ms: Number(t.duration) || 0,
  };
}

export async function scResolveStream(trackId: number, force = false): Promise<SCStream> {
  const hit = streamCache.get(trackId);
  if (!force && hit && Date.now() - hit.at < STREAM_TTL) return hit.stream;
  const running = resolving.get(trackId);
  if (running && !force) return running;
  const task = resolveStreamUncached(trackId)
    .then((stream) => {
      cacheSet(streamCache, STREAM_CACHE_CAP, trackId, { at: Date.now(), stream });
      return stream;
    })
    .finally(() => resolving.delete(trackId));
  resolving.set(trackId, task);
  return task;
}
