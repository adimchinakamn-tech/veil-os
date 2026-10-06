/**
 * Veil — YouTube data layer for the Stream section (server-side only).
 *
 * The Stream section is Veil's own way to watch YouTube: the browser
 * talks ONLY to this origin. Search/trending/video metadata are fetched
 * from the freetube mini-service's battle-proven Invidious-compat API
 * (:3031 — Piped-backed with a stale-if-error pool, background gate
 * retries and proxy-host sibling fallback), and every media byte
 * (streams, HLS manifests, thumbnails, avatars) is re-served through
 * OUR /api/yt/s byte proxy. No YouTube/Piped/LBRY request is ever made
 * by the user's browser — that is the whole point of the section.
 *
 * Shapes returned here are section-native (YtCard/YtVideo) so the client
 * never sees the upstream Invidious/Piped wire format.
 *
 * Feeds rotate: "foryou" blends the trending wire with the channels
 * THIS device watches (sent up by the client, never stored);
 * "shorts" deals a fresh hand of channel shelves on every rebuild;
 * both are served stale-while-revalidating so they answer instantly.
 */

/** The freetube-service's Invidious-compat API (see mini-services/freetube-service/invidious-compat.ts). */
const FT_BASE = "http://localhost:3031/ft-invidious";

/* ------------------------------------------------------------------ */
/* Public shapes                                                        */
/* ------------------------------------------------------------------ */

export interface YtCard {
  id: string;
  title: string;
  author: string;
  authorId: string;
  verified: boolean;
  durationSec: number;
  views: number;
  published: string;
  /** Absolute publish time (unix seconds) when upstream carries it —
   * powers the channel Popular/Newest/Oldest sorts. */
  publishedAt?: number;
  live: boolean;
  /** True for channel-shelf shorts (vertical feed items). */
  short?: boolean;
  /** Same-origin proxy URL for the channel's REAL avatar/logo — present
   * whenever the wire that produced this card carried it (channel rails,
   * subs, popular); otherwise the client backfills it via /api/yt/avatars. */
  avatar?: string;
  /** Why this card is in the feed ("from <channel>" / "because you watched …")
   * — set on personalized For You + Shorts items so the UI can say it. */
  why?: string;
  /** Same-origin proxy URL (always /api/yt/s?u=…). */
  thumb: string;
}

export interface YtFormat {
  /** hls = adaptive manifest (hls.js), progressive = direct muxed file,
   * adaptive = VIDEO-ONLY high-res track (paired with an audio one
   * client-side via MediaSource — this is where 1080p+ lives). */
  kind: "hls" | "progressive" | "adaptive";
  label: string;
  mime: string;
  /** Same-origin proxy URL. */
  url: string;
  /** adaptive only — pixel height (powers the quality menu + the
   * "best ≤1080" default pick). */
  height?: number;
  fps?: number;
  bitrate?: number;
}

/** A closed-caption track (WebVTT) — the bytes ride /api/yt/s like
 * every other media, so captions stay same-origin. */
export interface YtCaption {
  label: string;
  code: string;
  url: string;
}

export interface YtVideo {
  card: YtCard;
  description: string;
  likes: number;
  /** dislike count — upstream usually hides it (0), but the /next
   * enrichment surfaces it when YouTube exposes it. */
  dislikes: number;
  /** Same-origin proxy URL for the channel avatar. */
  authorAvatar: string;
  formats: YtFormat[];
  /** audio-only tracks (best first) — the pairing half of the adaptive
   * combo. Empty when upstream only had muxed formats (gates). */
  audio: YtFormat[];
  /** closed-caption tracks (WebVTT through the byte proxy). */
  captions: YtCaption[];
  related: YtCard[];
}

/** Gate answer: the video exists but YouTube's bot-gate is currently
 * refusing stream extraction for it (rotates on minute scales; the
 * service retries it in the background and keeps the last good body
 * in a stale-if-error pool). */
export interface YtGate {
  gated: true;
  message: string;
}

/** A channel page: header info + the videos and shorts shelves. The
 * *Next fields are continuation tokens — "Load more" on either shelf
 * pages deeper (Piped hands ~30 videos / ~48 shorts per page). */
export interface YtChannel {
  id: string;
  name: string;
  verified: boolean;
  /** Same-origin proxy URL for the channel avatar. */
  avatar: string;
  subs: number;
  description: string;
  videos: YtCard[];
  shorts: YtCard[];
  /** continuation token for the next page of videos (null = shelf end). */
  videosNext: string | null;
  /** continuation token for the next page of shorts (null = shelf end). */
  shortsNext: string | null;
}

/** A community post from the channel's Posts tab — text (with line
 * breaks), likes, comment count, publish age, image attachments and an
 * optional poll. Avatars + images arrive as same-origin proxy URLs. */
export interface YtPost {
  id: string;
  author: string;
  avatar: string;
  published: string;
  likes: number;
  comments: number;
  text: string;
  images: string[];
  poll?: { question: string; options: { text: string; pct: number }[] };
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

interface UpstreamCard {
  type?: string;
  isShort?: boolean;
  title?: string;
  videoId?: string;
  author?: string;
  authorId?: string;
  authorVerified?: boolean;
  videoThumbnails?: { quality?: string; url?: string; width?: number; height?: number }[];
  viewCount?: number;
  publishedText?: string;
  published?: number;
  lengthSeconds?: number;
  liveNow?: boolean;
}

interface UpstreamFormat {
  qualityLabel?: string;
  type?: string;
  url?: string;
  bitrate?: number;
  height?: number;
  fps?: number;
}

interface UpstreamVideo extends UpstreamCard {
  description?: string;
  likeCount?: number;
  dislikeCount?: number;
  authorThumbnails?: { url?: string; width?: number }[];
  formatStreams?: UpstreamFormat[];
  adaptiveFormats?: UpstreamFormat[];
  recommendedVideos?: UpstreamCard[];
  /** invidious-style caption tracks: { label, language_code, url }. */
  captions?: { label?: string; language_code?: string; url?: string }[];
}

/** Encode an absolute URL for OUR byte proxy. */
export function proxyUrl(abs: string): string {
  return "/api/yt/s?u=" + encodeURIComponent(abs);
}

/**
 * Rewrite any upstream URL into OUR byte proxy. Handles two shapes:
 *  1. the service's own proxy URLs (`http://localhost:3031/ft-invidious/stream?u=<enc>`)
 *     — the inner `u` is re-hosted on /api/yt/s with identical semantics;
 *  2. plain absolute http(s) URLs.
 */
export function toProxyUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  const svcPrefix = FT_BASE + "/stream?u=";
  if (raw.startsWith(svcPrefix)) {
    const inner = raw.slice(svcPrefix.length);
    try {
      return proxyUrl(decodeURIComponent(inner));
    } catch {
      return proxyUrl(inner);
    }
  }
  if (/^https?:\/\//i.test(raw)) return proxyUrl(raw);
  return "";
}

/** Pick the best thumbnail from the Invidious thumbnails ladder. */
function bestThumb(thumbs: UpstreamCard["videoThumbnails"]): string {
  if (!thumbs || thumbs.length === 0) return "";
  const pick =
    thumbs.find((t) => t.quality === "maxresdefault") ||
    thumbs.find((t) => t.quality === "maxresdefault.webp") ||
    thumbs.find((t) => t.quality === "hqdefault") ||
    thumbs.find((t) => t.quality === "hq720") ||
    thumbs.find((t) => (t.width ?? 0) >= 320) ||
    thumbs[0];
  return toProxyUrl(pick?.url);
}

/** Normalize an upstream author id to a bare UC/HC id — the compat
 * service emits path forms ("/channel/UC…", "/channel/UC…/shorts") for
 * trending/search/shelf items while related items carry bare ids; anything
 * else (handles) blanks so the UI simply hides the channel link. */
function normAuthorId(raw: string | undefined): string {
  if (!raw) return "";
  const stripped = String(raw).replace(/\/(videos|shorts|streams|playlists|community|about)$/i, "");
  const m = /(?:^|\/)(UC[\w-]{6,}|HC[\w-]{6,})$/.exec(stripped);
  return m ? m[1] : "";
}

function mapCard(v: UpstreamCard): YtCard {
  return {
    id: v.videoId ?? "",
    title: v.title ?? "",
    author: v.author ?? "",
    authorId: normAuthorId(v.authorId),
    verified: Boolean(v.authorVerified),
    durationSec: v.lengthSeconds ?? 0,
    views: v.viewCount ?? 0,
    published: v.publishedText ?? "",
    publishedAt: v.published && v.published > 0 ? v.published : undefined,
    live: Boolean(v.liveNow),
    short: Boolean(v.isShort),
    thumb: bestThumb(v.videoThumbnails),
  };
}

function isHlsFormat(f: UpstreamFormat): boolean {
  const t = (f.type ?? "").toLowerCase();
  if (t.includes("mpegurl")) return true;
  return /\.m3u8([?#]|$)/i.test(f.url ?? "");
}

/** Caption track URLs arrive in two shapes from the compat service:
 *  1. its own relative proxy form (`/ft-invidious/timedtext?u=<enc>` —
 *     mapCaption wraps piped/innertube timedtext URLs that way) — the
 *     inner absolute URL is re-hosted on OUR /api/yt/s;
 *  2. plain absolute http(s) URLs (already un-wrapped). */
function captionUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = /^\/ft-invidious\/timedtext\?u=(.+)$/.exec(raw);
  if (m) {
    try {
      return proxyUrl(decodeURIComponent(m[1]));
    } catch {
      return "";
    }
  }
  return toProxyUrl(raw);
}

function qualityLabelOf(f: UpstreamFormat, fallback: string): string {
  const l = (f.qualityLabel ?? "").trim();
  if (l && !/^hls$/i.test(l)) return l;
  const t = (f.type ?? "").toLowerCase();
  const m = /codecs="?[^"]*?(\d{3,4})/.exec(t); // e.g. codecs="avc1.64001f" → height hint is unreliable, but avc1.6440 etc.
  return m && Number(m[1]) <= 2160 ? `${m[1]}p` : fallback;
}

function mapVideo(v: UpstreamVideo): YtVideo {
  const formats: YtFormat[] = [];
  const audio: YtFormat[] = [];
  const seen = new Set<string>();
  const push = (f: UpstreamFormat, kind: "hls" | "progressive") => {
    const url = toProxyUrl(f.url);
    if (!url || seen.has(url)) return;
    seen.add(url);
    formats.push({
      kind,
      label: kind === "hls" ? "Auto (adaptive)" : qualityLabelOf(f, "video"),
      mime: f.type ?? (kind === "hls" ? "application/x-mpegurl" : "video/mp4"),
      url,
    });
  };
  // Combined/progressive first (native <video>), then HLS manifests — the
  // player prefers the adaptive combo when available and falls back to
  // these when MSE is missing.
  for (const f of v.formatStreams ?? []) {
    if (isHlsFormat(f)) push(f, "hls");
    else push(f, "progressive");
  }
  /* The quality ladder: adaptiveFormats carry the VIDEO-ONLY tracks
   * (1080p / 1440p / 4K — the muxed formatStreams cap at 360-720p) and
   * the AUDIO-ONLY tracks. The video ones surface as kind "adaptive"
   * (the client pairs one with an audio track through MediaSource);
   * the audio ones go to their own list, best bitrate first. */
  for (const f of v.adaptiveFormats ?? []) {
    const url = toProxyUrl(f.url);
    if (!url || seen.has(url)) continue;
    const t = (f.type ?? "").toLowerCase();
    if (isHlsFormat(f)) {
      seen.add(url);
      formats.push({
        kind: "hls",
        label: "Auto (adaptive)",
        mime: f.type ?? "application/x-mpegurl",
        url,
      });
    } else if (t.startsWith("audio/")) {
      seen.add(url);
      const kbps = Math.round((f.bitrate ?? 0) / 1000);
      const q = (f.qualityLabel ?? "").trim();
      audio.push({
        kind: "adaptive",
        label: /k$/i.test(q) ? q : kbps > 0 ? `${kbps}k` : q || "audio",
        mime: f.type ?? "audio/mp4",
        url,
        bitrate: f.bitrate,
      });
    } else if (t.startsWith("video/")) {
      seen.add(url);
      formats.push({
        kind: "adaptive",
        label: qualityLabelOf(f, "adaptive"),
        mime: f.type ?? "video/mp4",
        url,
        height: f.height,
        fps: f.fps,
        bitrate: f.bitrate,
      });
    }
  }
  audio.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  const avatar =
    toProxyUrl(
      (v.authorThumbnails ?? []).filter((t) => t.url).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url,
    ) || "";

  return {
    card: mapCard(v),
    description: (v.description ?? "").replace(/<br\s*\/?>/gi, "\n"),
    likes: v.likeCount ?? 0,
    dislikes: v.dislikeCount ?? 0,
    authorAvatar: avatar,
    formats,
    audio,
    captions: (v.captions ?? [])
      .map((c) => ({
        label: (c.label || c.language_code || "captions").trim(),
        code: c.language_code || "",
        url: captionUrl(c.url),
      }))
      .filter((c) => c.url),
    related: (v.recommendedVideos ?? []).map(mapCard).filter((c) => c.id && c.title),
  };
}

/* ------------------------------------------------------------------ */
/* Service fetch + tiny caches (stale-while-revalidate)                 */
/* ------------------------------------------------------------------ */

const CACHE_TTL = { feed: 60_000, search: 120_000, video: 45_000, foryou: 90_000, shorts: 120_000 };
/* gates ("YouTube is rate-limiting…") live in the cache for at most
 * this long — long enough to absorb a double-click, short enough that
 * the client's next auto-retry actually re-probes upstream. */
const GATE_TTL = 6_000;
/** how long past its TTL a still-good body may be served INSTANTLY while
 * a single background refresh runs — this is what keeps feed requests
 * at ~0ms instead of re-fanning-out every few minutes. */
const STALE_SERVE_MS = 8 * 60_000;
/** the quick video lane answers within this budget (the full-length load
 * keeps running in the background and lands in the cache) — a slow
 * gate-retry upstream becomes a fast "press play again" instead of a
 * 30-second spinner. */
const QUICK_WAIT_MS = 12_000;
/** the soft budget for the shorts viewer's auto-retries — they only need
 * to check whether the background warm has parked the body yet. */
const SOFT_WAIT_MS = 3_000;
type CacheEntry<T> = { at: number; body: T };
const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function isGate(v: unknown): boolean {
  return Boolean(v && typeof v === "object" && "gated" in (v as object));
}

/** Start (or join) the single in-flight load for a key. Success lands in
 * the cache; failure leaves any previous body untouched. */
function kick<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = loader()
    .then((body) => {
      cache.set(key, { at: Date.now(), body });
      inflight.delete(key);
      if (cache.size > 150) {
        // drop the oldest third — a Map keeps insertion order. Entries here
        // are whole feed pages / video bodies (heavy: cards + formats +
        // related lists), so 150 kept the dev-server heap ~40MB lighter
        // than the old 300 cap with no observable hit-rate change.
        for (const k of [...cache.keys()].slice(0, 50)) cache.delete(k);
      }
      return body as T;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });
  inflight.set(key, p);
  p.catch(() => {}); // a background refresh may reject silently — never crash the process
  return p;
}

/** Cache wrapper with stale-while-revalidate: a fresh hit answers from
 * memory; a stale-but-good body is served IMMEDIATELY while exactly one
 * background reload runs; only a true cold miss waits for the loader. */
async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  gateTtlMs = 0,
  staleServeMs = 0,
): Promise<T> {
  const hit = cache.get(key);
  const now = Date.now();
  /* a gate answer uses its OWN (short) TTL: YouTube's bot-gate rotates
   * on minute scales, and caching the throttled answer for the normal
   * TTL would keep serving the SAME gate to every retry. */
  if (hit && now - hit.at < (isGate(hit.body) ? gateTtlMs : ttlMs)) return hit.body as T;
  /* stale window — the whole point: the user never waits for a rebuild */
  if (hit && staleServeMs > 0 && !isGate(hit.body) && now - hit.at < ttlMs + staleServeMs) {
    kick(key, loader).catch(() => {});
    return hit.body as T;
  }
  try {
    return await kick(key, loader);
  } catch {
    /* the reload failed — a previously served body is better than an error */
    if (hit) return hit.body as T;
    throw new Error("the stream source didn't answer");
  }
}

/**
 * Fetch from the freetube-service's Invidious-compat API. Returns
 * `{ ok, status, body }` — a non-2xx with a JSON error body (the gate!)
 * is DATA, not an exception.
 */
async function ftFetch(
  path: string,
  qs: string,
  timeoutMs = 30_000,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = `${FT_BASE}${path}${qs ? (qs.startsWith("?") ? qs : `?${qs}`) : ""}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json", "user-agent": "veil-stream/1.0" },
      cache: "no-store",
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: { error: `could not reach the stream source (${String(err).slice(0, 120)})` } };
  }
}

function asGate(body: unknown): YtGate | null {
  const msg = (body as { error?: string } | null)?.error;
  if (!msg) return null;
  return {
    gated: true,
    message:
      "YouTube is rate-limiting this video's stream right now — it's being auto-retried in the background. Press play again in a minute, or try another video.",
  };
}

/** Fisher–Yates shuffle (in place) — used so every feed rebuild picks a
 * different slice of the wire instead of the same head every time. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

export async function ytFeed(
  kind: "trending" | "popular" = "trending",
  region = "US",
): Promise<YtCard[] | YtGate> {
  return cached(`feed:${kind}:${region}`, CACHE_TTL.feed, async () => {
    const qs = kind === "popular" ? `?type=popular&region=${region}` : `?region=${region}`;
    const r = await ftFetch("/api/v1/trending", qs);
    if (!r.ok) {
      const gate = asGate(r.body);
      if (gate) return gate;
      return [] as YtCard[];
    }
    const items = Array.isArray(r.body) ? (r.body as UpstreamCard[]) : [];
    return items
      .map(mapCard)
      .filter((c) => c.id && c.title)
      .slice(0, 40);
  }, GATE_TTL, STALE_SERVE_MS);
}

export async function ytSearch(query: string): Promise<YtCard[] | YtGate> {
  const q = query.trim().slice(0, 120);
  if (!q) return [];
  return cached(`search:${q.toLowerCase()}`, CACHE_TTL.search, async () => {
    const r = await ftFetch("/api/v1/search", `?q=${encodeURIComponent(q)}&type=video`);
    if (!r.ok) {
      const gate = asGate(r.body);
      if (gate) return gate;
      return [] as YtCard[];
    }
    const items = Array.isArray(r.body) ? (r.body as UpstreamCard[]) : [];
    return items
      .map(mapCard)
      .filter((c) => c.id && c.title)
      .slice(0, 30);
  }, GATE_TTL);
}

/** Fetch one channel's shorts shelf (mapped cards, in shelf order). */
async function fetchChannelShorts(id: string): Promise<YtCard[]> {
  try {
    const r = await ftFetch(`/api/v1/channels/${id}/shorts`, "", 20_000);
    if (!r.ok) return [] as YtCard[];
    const vids = (r.body as { videos?: UpstreamCard[] })?.videos ?? [];
    return vids.map(mapCard).filter((c) => c.id && c.title);
  } catch {
    return [] as YtCard[];
  }
}

/** The Shorts page feed — blended from the shorts shelves of the channels
 * THIS device watches (they lead the blend, tagged why) plus a RANDOM
 * slice of the channels on the wire (trending + popular), each shelf
 * entered at a random offset, round-robin interleaved from a random
 * start. Every rebuild is a fresh mix, and `reshuffle` (the reload
 * button) forces one immediately instead of waiting for the TTL.
 * `exclude` (the infinite viewer's "more" rounds) deals a hand of shorts
 * the viewer hasn't already shown — and never hard-stops. */
export async function ytShortsFeed(
  reshuffle = false,
  chans: string[] = [],
  exclude: string[] = [],
  boost: string[] = [],
): Promise<YtCard[] | YtGate> {
  /* boost channels (subscribed + liked) lead the shelf list, then the
   * watched ones — up to 8 channels get their own shelf */
  const okId = (id: string) => /^(UC|HC)[\w-]{6,}$/.test(id);
  const mine = [...new Set([...boost.filter(okId), ...chans.filter(okId)])].slice(0, 8);
  const boostSet = new Set(boost.filter(okId));
  const skip = new Set(exclude.map((s) => s.trim()).filter(Boolean));
  const isMore = skip.size > 0;
  const key = `feed:shorts:${mine.join(",")}`;
  if (reshuffle) cache.delete(key);
  /* "more" rounds are one-shot random deals — caching them by an
   * ever-changing exclude list would only ever hit once anyway. */
  if (isMore) return blendShorts(mine, skip, boostSet);
  return cached(key, CACHE_TTL.shorts, () => blendShorts(mine, skip, boostSet), GATE_TTL, STALE_SERVE_MS);
}

async function blendShorts(mine: string[], skip: Set<string>, boostSet: Set<string> = new Set()): Promise<YtCard[] | YtGate> {
  const [trend, pop] = await Promise.all([ytFeed("trending"), ytFeed("popular")]);
  if (!Array.isArray(trend)) return trend; // propagate the gate
  if (!Array.isArray(pop)) return pop;
  /* popularity-ranked shelf pick: sort the shelf by views and deal from
   * the POPULAR head (with a small jitter window so the same channel
   * doesn't contribute the identical hand every rebuild) — the feed
   * leads with each channel's most-watched shorts instead of whatever
   * the shelf happens to be ordered by. "more" rounds widen the window
   * so your channels keep surfacing fresh-but-still-popular shorts as
   * you scroll the infinite deck. */
  const rankShelf = (cards: YtCard[], per: number, window: number): YtCard[] => {
    const ranked = [...cards].sort((a, b) => (b.views || 0) - (a.views || 0));
    const w = Math.min(ranked.length, per + window);
    const maxOff = Math.max(0, w - per);
    const off = Math.floor(Math.random() * (maxOff + 1));
    return ranked.slice(off, off + per);
  };
  /* your shelves first — the shorts feed leads with the channels this
   * device actually watches, tagged with why; SUBSCRIBED + LIKED channels
   * (the boost set — the user's standing order) get a WIDER shelf (8
   * picks instead of 5) and a "new from …" tag so they visibly lead;
   * each shelf's most-watched shorts surface first (ranked), and "more"
   * rounds reach a little deeper down the ranked list for variety */
  const advance = skip.size > 0;
  const mineShelves = await Promise.all(
    mine.map(async (id) => {
      const cards = await fetchChannelShorts(id);
      const isBoost = boostSet.has(id);
      const per = isBoost ? 8 : 5;
      const picked = rankShelf(cards, per, advance ? 10 : 2);
      return picked.map((c) => ({
        ...c,
        short: true,
        why: isBoost
          ? c.author
            ? `new from ${c.author}`
            : "new from your channels"
          : c.author
            ? `from ${c.author}`
            : "from a channel you watch",
      }));
    }),
  );
  /* discovery pool = distinct channels across both wires (minus the
   * ones already covered by your shelves); each rebuild deals a
   * different hand so the shelf actually changes — and "more" rounds
   * deal a wider, deeper hand so each infinite round feels chunky */
  const isMore = skip.size > 0;
  const handSize = isMore ? 14 : mineShelves.some((s) => s.length > 0) ? 8 : 10;
  const perShelf = isMore ? 8 : 6;
  const mineSet = new Set(mine);
  const pool = shuffle(
    [...new Set([...trend, ...pop].map((c) => c.authorId).filter((id) => id && !mineSet.has(id)))],
  ).slice(0, handSize);
  const shelves = await Promise.all(
    pool.map(async (id) => {
      const cards = await fetchChannelShorts(id);
      /* ranked by views, dealt from the popular head with a small jitter
       * so the hand re-deals without ever burying a channel's hottest
       * shorts; the #1 pick carries the popular tag so the grid SHOWS
       * that these are the most-watched, not just the newest */
      const picked = rankShelf(cards, perShelf, isMore ? 4 : 3);
      return picked.map((c, i) => ({
        ...c,
        short: true,
        why: i === 0 && (c.views || 0) > 0 ? "popular right now" : undefined,
      }));
    }),
  );
  /* round-robin interleave: your shelves lead the rotation, then the
   * discovery hand — no single channel dominates and consecutive
   * rebuilds start differently */
  const live = [...mineShelves, ...shelves].filter((s) => s.length > 0);
  const out: YtCard[] = [];
  const seen = new Set<string>();
  const rot = live.length > 0 ? Math.floor(Math.random() * live.length) : 0;
  const ordered = [...live.slice(rot), ...live.slice(0, rot)];
  const maxLen = ordered.reduce((n, s) => Math.max(n, s.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const s of ordered) {
      const c = s[i];
      if (c && !seen.has(c.id)) {
        seen.add(c.id);
        out.push(c);
      }
    }
  }
  /* the infinite viewer's "more" rounds: keep only unseen shorts; if
   * the well runs dry, top up from everything (wrapped) so the feed
   * NEVER hard-stops — scrolling always brings something. */
  if (skip.size > 0) {
    const fresh = out.filter((c) => !skip.has(c.id));
    if (fresh.length < 6 && out.length > 0) {
      for (const c of out) {
        if (fresh.length >= 12) break;
        if (!fresh.some((f) => f.id === c.id)) fresh.push(c);
      }
    }
    return fresh.slice(0, 30);
  }
  return out.slice(0, 60);
}

/** A channel's most-viewed recent uploads — the popular half of its
 * shelf, read off the same service-cached channel page the For You
 * rails use. (Piped has no popular endpoint — the compat layer's
 * type=popular is a stub that returns trending verbatim — so
 * popularity is DERIVED from the view counts channel pages carry.)
 * The channel's REAL avatar rides every card (authorThumbnails →
 * /api/yt/s proxy) so the grid shows actual channel logos. */
async function fetchChannelBest(id: string, per: number): Promise<YtCard[]> {
  try {
    const r = await ftFetch(`/api/v1/channels/${id}`, "", 20_000);
    if (!r.ok) return [] as YtCard[];
    const c = r.body as UpstreamChannel;
    const avatar = toProxyUrl(
      (c.authorThumbnails ?? []).filter((t) => t.url).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url,
    ) || "";
    const cards = c.latestVideos ?? [];
    return cards
      .map(mapCard)
      .filter((x) => x.id && x.title)
      .map((x) => ({ ...x, ...(avatar ? { avatar } : {}) }))
      .sort((a, b) => (b.views || 0) - (a.views || 0))
      .slice(0, per);
  } catch {
    return [] as YtCard[];
  }
}

/** The POPULAR wire — the most-viewed recent uploads of the channels
 * the trending wire (US + GB) currently carries, globally ranked by
 * views. This is what the Popular page shows, one of the wires For
 * You blends, and the fix for "no popular videos": the trending list
 * itself is live-event-heavy (watchalongs with 4-digit concurrent
 * viewer counts), while these channel shelves surface the big hits. */
export async function ytPopularFeed(): Promise<YtCard[] | YtGate> {
  return cached("feed:popularwire", CACHE_TTL.feed, async () => {
    const [us, gb] = await Promise.all([
      ytFeed("trending", "US").catch(() => null),
      ytFeed("trending", "GB").catch(() => null),
    ]);
    const wires = [us, gb].filter((w): w is YtCard[] => Array.isArray(w) && w.length > 0);
    if (wires.length === 0) {
      const gate = [us, gb].find((w) => w && !Array.isArray(w));
      if (gate && !Array.isArray(gate)) return gate as YtGate;
      return [] as YtCard[];
    }
    /* channels ordered by how hot their wire card is — the top 12 each
     * contribute their best two recent uploads */
    const seen = new Set<string>();
    const chans: string[] = [];
    for (const c of wires.flat().sort((a, b) => (b.views || 0) - (a.views || 0))) {
      if (c.authorId && !seen.has(c.authorId)) {
        seen.add(c.authorId);
        chans.push(c.authorId);
      }
    }
    const shelves = await Promise.all(chans.slice(0, 12).map((id) => fetchChannelBest(id, 2)));
    return shelves
      .flat()
      .filter((c) => c.id && c.title)
      .sort((a, b) => (b.views || 0) - (a.views || 0))
      .slice(0, 30);
  }, GATE_TTL, STALE_SERVE_MS);
}

/** For You — actually for YOU, but PROPORTIONALLY: the channels this
 * device watches contribute a couple of newest uploads each, and
 * YouTube's own "up next" for the recently watched videos contributes a
 * couple of silent recommendations — a SMALL deck woven through the
 * trending wire 1:2. Watching one or two football videos must not turn
 * the whole feed into football: personal cards stay a seasoning (a
 * third of the page at most), never the meal. `fresh` (the reload
 * button) busts the cache for an immediate new blend. */
export async function ytForYou(
  watched: string[],
  vids: string[] = [],
  fresh = false,
  boost: string[] = [],
): Promise<YtCard[] | YtGate> {
  const chans = [...new Set(watched.filter((id) => /^(UC|HC)[\w-]{6,}$/.test(id)))].slice(0, 8);
  const wanted = [...new Set(vids.filter((id) => /^[-\w]{6,20}$/.test(id)))].slice(0, 3);
  /* boost = the channels this device SUBSCRIBED to or LIKED videos from —
   * a stronger signal than watching, so their rails run wider and the
   * personal ceiling lifts (see blendForYou) */
  const boosted = [...new Set(boost.filter((id) => /^(UC|HC)[\w-]{6,}$/.test(id)))].slice(0, 8);
  const key = `foryou:${chans.join(",")}|${wanted.join(",")}|b:${boosted.join(",")}`;
  if (fresh) cache.delete(key);
  return cached(
    key,
    CACHE_TTL.foryou,
    async () => {
      const page = await ytForYouPage(chans, wanted, boosted, [], null);
      if ("gated" in page) return page;
      return page.cards;
    },
    GATE_TTL,
    STALE_SERVE_MS,
  );
}

/* ------------------------------------------------------------------ */
/* For You — INFINITE pages (YouTube-home-style deep scroll)            */
/* ------------------------------------------------------------------ */

/** One round of the INFINITE For You feed — YouTube's home page keeps
 * dealing candidates as you scroll, and so does this. Round 1 is the
 * curated blend (trending + popular wire, watched/subscribed channel
 * rails, up-next recs). Rounds 2+ walk the CHANNEL RIVER: every channel
 * the blend touched (subscribed/liked/watched, then — as the river
 * thins — fresh channels off the trending wires) deals its next few
 * uploads, round-robin interleaved, newest uploads leading.
 *
 * The client owns the river state and POSTs it back each round:
 *   { kind:"foryou", chans, vids, boost, seen, cursors } — cursors
 *   empty = round 1; otherwise { channelId: riverCursor }.
 * `seen` carries everything already on screen (and watched — the feed
 * never re-deals a video this device has already seen). Response:
 * { cards, next } — next null = the river is dry. */
export interface YtForYouPage {
  cards: YtCard[];
  /** alive river cursors for the next deep round (null = dry). */
  next: Record<string, string> | null;
}

export async function ytForYouPage(
  chans: string[],
  vids: string[],
  boost: string[],
  seenList: string[],
  cursors: Record<string, string> | null,
): Promise<YtForYouPage | YtGate> {
  const okId = (id: string) => /^(UC|HC)[\w-]{6,}$/.test(id);
  const seen = new Set(seenList.map((s) => s.trim()).filter(Boolean));
  const boostClean = [...new Set(boost.filter(okId))].slice(0, 8);
  if (!cursors || Object.keys(cursors).length === 0) {
    /* ROUND 1 — the curated blend, watched videos filtered out, with
     * the channel river seeded from every rail the blend touched */
    const blend = await blendForYou(
      [...new Set(chans.filter(okId))].slice(0, 8),
      [...new Set(vids.filter((id) => /^[-\w]{6,20}$/.test(id)))].slice(0, 3),
      boostClean,
      seen,
    );
    if ("gated" in blend) return blend;
    const river: Record<string, string> = {};
    for (const [id, cur] of Object.entries(blend.river)) {
      if (okId(id) && typeof cur === "string" && cur) river[id] = cur;
    }
    /* a cold device (no history, no subs) still gets an INFINITE feed —
     * top the river up from the wire channels the blend just used (the
     * popular wire already warmed their pages at the service layer) */
    if (Object.keys(river).length < FORYOU_RIVER_MIN) {
      const known = new Set([...Object.keys(river), ...boostClean]);
      await riverExpand(river, FORYOU_RIVER_MIN + FORYOU_RIVER_GROW, known);
    }
    return { cards: blend.cards, next: Object.keys(river).length > 0 ? river : null };
  }
  /* DEEP ROUND — the river */
  return foryouDeepRound(boostClean, seen, cursors);
}

/** when the river thins below this many alive channels, fresh ones from
 * the trending/popular wires join it — this is what makes the feed
 * effectively endless, the way YouTube's home never really stops. */
const FORYOU_RIVER_MIN = 10;
const FORYOU_RIVER_GROW = 12;
/** uploads each river channel deals per deep round / round cap. */
const FORYOU_DEEP_PER = 4;
const FORYOU_DEEP_ROUND = 36;

/** Pull fresh channels off the (cached) trending + popular wires into a
 * river map — round-1 seeding and the deep-round expansion share this.
 * Only ids not already in `known` join, each starting a fresh header
 * page cursor. */
async function riverExpand(
  river: Record<string, string>,
  cap: number,
  known: Set<string>,
): Promise<void> {
  const wires = await Promise.all([
    ytFeed("trending", "US").catch(() => [] as YtCard[]),
    ytFeed("trending", "GB").catch(() => [] as YtCard[]),
    ytPopularFeed().catch(() => [] as YtCard[]),
  ]);
  for (const c of wires.flat()) {
    if (Object.keys(river).length >= cap) break;
    if (!c.authorId || !/^(UC|HC)[\w-]{6,}$/.test(c.authorId) || known.has(c.authorId)) continue;
    known.add(c.authorId);
    river[c.authorId] = packRiverCursor("", 0);
  }
}

async function foryouDeepRound(
  boost: string[],
  seen: Set<string>,
  cursorsIn: Record<string, string>,
): Promise<YtForYouPage> {
  const okId = (id: string) => /^(UC|HC)[\w-]{6,}$/.test(id);
  const boostSet = new Set(boost);
  let river: [string, string][] = Object.entries(cursorsIn)
    .filter(([id, cur]) => okId(id) && typeof cur === "string" && cur)
    .slice(0, 40);
  /* the river thinned — fresh channels join from the (cached) trending
   * + popular wires, exactly the candidate-generation YouTube's home
   * does when it runs low: new shelves, same feed */
  if (river.length < FORYOU_RIVER_MIN) {
    const known = new Set(river.map(([id]) => id));
    for (const b of boost) known.add(b);
    const asMap = Object.fromEntries(river);
    await riverExpand(asMap, FORYOU_RIVER_MIN + FORYOU_RIVER_GROW, known);
    river = Object.entries(asMap);
  }
  /* deal the next uploads from every alive channel (parallel; each
   * token's page is cached, so advancing a cursor is usually free) */
  const steps = await Promise.all(
    river.map(async ([id, cur]) => {
      const step = await riverStep(id, cur, FORYOU_DEEP_PER);
      return step ? { id, cards: step.cards, next: step.next } : null;
    }),
  );
  const live = steps.filter((s): s is { id: string; cards: YtCard[]; next: string | null } => s !== null);
  /* boost channels lead the round-robin, and no channel owns a stretch
   * of the deep feed — the interleave keeps the mix breathing */
  live.sort((a, b) => (boostSet.has(b.id) ? 1 : 0) - (boostSet.has(a.id) ? 1 : 0));
  const out: YtCard[] = [];
  const dup = new Set<string>();
  const maxLen = live.reduce((n, s) => Math.max(n, s.cards.length), 0);
  for (let i = 0; i < maxLen && out.length < FORYOU_DEEP_ROUND; i++) {
    for (const s of live) {
      if (out.length >= FORYOU_DEEP_ROUND) break;
      const c = s.cards[i];
      if (!c || dup.has(c.id) || seen.has(c.id)) continue;
      dup.add(c.id);
      out.push({
        ...c,
        why: c.author
          ? boostSet.has(s.id)
            ? `new from ${c.author}`
            : `more from ${c.author}`
          : "from a channel you watch",
      });
    }
  }
  const next: Record<string, string> = {};
  for (const s of live) if (s.next) next[s.id] = s.next;
  return { cards: out, next: Object.keys(next).length > 0 ? next : null };
}

/** the hard ceiling on WATCHED-channel personal cards in a For You blend
 * — one accidental watch must not hijack the page. Subscribed + liked
 * channels (the boost set) are the exception the user asked for: each one
 * lifts the ceiling, up to double. */
const FORYOU_PERSONAL_CAP = 12;

/** words that carry no identity — live-sports spam is full of them */
const TITLE_STOPWORDS = new Set([
  "live", "4k", "hd", "hdtv", "ncaaf", "ncaa", "nfl", "nba", "mlb", "nhl", "ufc",
  "college", "football", "basketball", "stream", "streaming", "watch", "full",
  "game", "games", "week", "highlights", "espn", "fox", "free", "men", "women",
  "the", "and", "for", "new", "video", "official", "highlights",
]);

function titleTokens(t: string): Set<string> {
  return new Set(
    t
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !/^\d+$/.test(w) && !TITLE_STOPWORDS.has(w)),
  );
}

/** near-duplicate guard: the SAME live game streamed by six different
 * channels (or the same clip re-uploaded everywhere) collapses to the
 * first card — "half my feed is football for no reason" is exactly this.
 * Two distinctive shared tokens + Jaccard ≥ 0.45 = same thing. */
function nearDup(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  if (inter < 2) return false;
  return inter / (a.size + b.size - inter) >= 0.45;
}

/** the round-1 blend result — the page of cards plus the seeded river
 * (channel id → cursor) the deep rounds walk. */
interface ForYouBlend {
  cards: YtCard[];
  river: Record<string, string>;
}

async function blendForYou(
  chans: string[],
  vids: string[],
  boost: string[] = [],
  skip: Set<string> = new Set(),
): Promise<ForYouBlend | YtGate> {
  /* a WIDE wire: US + GB trending PLUS the derived POPULAR wire (the
   * most-viewed recent uploads of the channels trending carries) —
   * popular videos are half the point of a For You page, so they ride
   * the same wire as trending. The lists are round-robin interleaved
   * BEFORE the near-dup pass so no single region/kind can front-load
   * the page and push the rest past the cap (and one saturated region
   * — college football Saturday — can't fill it either). */
  const wires = await Promise.all([
    ytFeed("trending", "US").catch(() => null),
    ytFeed("trending", "GB").catch(() => null),
    ytPopularFeed().catch(() => null),
  ]);
  const live = wires.filter((w): w is YtCard[] => Array.isArray(w) && w.length > 0);
  if (live.length === 0) {
    const gate = wires.find((w) => w && !Array.isArray(w));
    if (gate && !Array.isArray(gate)) return gate as YtGate;
    return [] as YtCard[];
  }
  const trend: YtCard[] = [];
  const maxLen = Math.max(...live.map((l) => l.length));
  for (let i = 0; i < maxLen; i++) {
    for (const l of live) {
      if (l[i]) trend.push(l[i]);
    }
  }
  const seen = new Set<string>();
  const personal: YtCard[] = [];
  const boostSet = new Set(boost);
  const personalCap = Math.min(FORYOU_PERSONAL_CAP * 2, FORYOU_PERSONAL_CAP + boost.length * 2);
  /* the river seed — every rail channel's cursor right after the cards
   * its rail consumed (deep rounds continue exactly where the rails
   * stopped, no gaps, no repeats) */
  const riverCur: Record<string, string> = {};
  const put = (c: YtCard, why?: string) => {
    if (!c.id || seen.has(c.id) || skip.has(c.id) || personal.length >= personalCap) return;
    seen.add(c.id);
    personal.push(why ? { ...c, why } : { ...c });
  };
  /* personal rail 1 — each followed/liked channel gets a WIDER rail
   * (four newest + its most-viewed recent upload, tagged "new from …")
   * because the user asked to SEE MORE of exactly those channels;
   * plain watched channels keep the seasoning rail (two newest + best).
   * The compat service caches channel pages, so these are cheap after
   * the first hit. */
  const railChans = [...new Set([...boost, ...chans])];
  const railJobs = railChans.map(async (id) => {
    try {
      const r = await ftFetch(`/api/v1/channels/${id}`, "", 20_000);
      if (!r.ok) return;
      const c = r.body as UpstreamChannel;
      const cards = c.latestVideos ?? [];
      /* the channel's REAL avatar rides every rail card — the grid shows
       * actual channel logos, exactly like YouTube's home feed */
      const avatar = toProxyUrl(
        (c.authorThumbnails ?? []).filter((t) => t.url).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url,
      ) || "";
      const mapped = cards.map(mapCard).filter((x) => x.id && x.title).map((x) => ({ ...x, ...(avatar ? { avatar } : {}) }));
      const isBoost = boostSet.has(id);
      const take = isBoost ? 4 : 2;
      /* seed the river right after this rail's head — the cursor points
       * INTO the header page (skip = consumed), so the deep rounds pick
       * up upload #take+1, not page #2 */
      if (mapped.length > 0) riverCur[id] = packRiverCursor("", Math.min(take, mapped.length));
      for (const c2 of mapped.slice(0, take))
        put(
          c2,
          isBoost
            ? c2.author
              ? `new from ${c2.author}`
              : "new from your channels"
            : c2.author
              ? `from ${c2.author}`
              : "from a channel you watch",
        );
      const best = [...mapped].sort((a, b) => (b.views || 0) - (a.views || 0))[0];
      if (best) put(best, best.author ? `popular on ${best.author}` : "a popular pick");
    } catch {
      /* channel rail failed — the rest of the blend still stands */
    }
  });
  /* personal rail 2 — YouTube's own "up next" for the videos this
   * device watched most recently: real recommendations, silent (no
   * "because you watched" callout — they're simply recommendations).
   * These ride the LIGHT meta endpoint (/next data — likes + related,
   * no stream extraction), so a gate window can't stretch the blend. */
  const relJobs = vids.map(async (id) => {
    try {
      const r = await ftFetch(`/api/v1/videos/${id}/meta`, "", 12_000);
      if (!r.ok) return;
      const cards = ((r.body as { recommendedVideos?: UpstreamCard[] })?.recommendedVideos ?? [])
        .map(mapCard)
        .filter((c) => c.id && c.title)
        .slice(0, 2);
      for (const c of cards) put(c);
    } catch {
      /* related rail failed — fine */
    }
  });
  await Promise.all([...railJobs, ...relJobs]);
  /* the wire: trending + popular minus already-seen, with same-thing
   * spam collapsed (the same live game from six channels counts once) */
  const seenToks: Set<string>[] = [];
  const wire: YtCard[] = [];
  for (const c of trend) {
    if (seen.has(c.id) || skip.has(c.id)) continue;
    const tok = titleTokens(c.title);
    if (seenToks.some((s) => nearDup(tok, s))) continue;
    seenToks.push(tok);
    seen.add(c.id);
    wire.push(c);
    if (wire.length >= 60) break; // enough de-spammed wire for a 48-cap page
  }
  /* weave: ONE personal pick for every TWO wire cards, rotated so the
   * mix re-deals every reload; with no history the page is simply the
   * (de-spammed) wire — first paint is never blocked on personalization */
  const shift = personal.length > 1 ? Math.floor(Math.random() * Math.min(personal.length, 8)) : 0;
  const deck = personal.length > 0 ? [...personal.slice(shift), ...personal.slice(0, shift)] : [];
  const out: YtCard[] = [];
  let p = 0;
  let n = 0;
  for (const c of wire) {
    if (n % 2 === 0 && p < deck.length) out.push(deck[p++]);
    seen.add(c.id);
    out.push(c);
    n++;
  }
  while (p < deck.length) out.push(deck[p++]);
  return { cards: out.slice(0, 48), river: riverCur };
}

async function loadVideo(id: string): Promise<YtVideo | YtGate> {
  const r = await ftFetch(`/api/v1/videos/${id}`, "", 90_000);
  if (!r.ok) {
    const gate = asGate(r.body);
    if (gate) return gate;
    return { gated: true, message: "the stream source didn't answer — try again in a moment" } as YtGate;
  }
  const v = r.body as UpstreamVideo;
  if (!v || !v.videoId) {
    return { gated: true, message: "the stream source returned an empty answer — try again" } as YtGate;
  }
  return mapVideo(v);
}

export async function ytVideo(
  id: string,
  quick = false,
  soft = false,
): Promise<YtVideo | YtGate> {
  if (!/^[-\w]{6,20}$/.test(id)) return { gated: true, message: "bad video id" };
  const key = `video:${id}`;
  if (!quick) {
    return cached(key, CACHE_TTL.video, () => loadVideo(id), GATE_TTL);
  }
  /* QUICK LANE — the shorts viewer + watch view's first probe. A fresh
   * hit answers instantly; otherwise the full-length load keeps running
   * in the background (landing in the cache for the retry) while we
   * answer within the budget. A cold 30-second gate-retry upstream
   * becomes a fast "press play again" — and the play-again hits the
   * body the background load just parked. `soft` = the shorts viewer's
   * auto-retries: a 3s budget, because each gated retry only needs to
   * check whether the background warm has parked the body yet. */
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (isGate(hit.body) ? GATE_TTL : CACHE_TTL.video)) {
    return hit.body as YtVideo | YtGate;
  }
  const bg = kick(key, () => loadVideo(id)).catch(() => null);
  const budget = soft ? SOFT_WAIT_MS : QUICK_WAIT_MS;
  const early = (await Promise.race([
    bg,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), budget)),
  ])) as YtVideo | YtGate | null;
  if (early) return early;
  return {
    gated: true,
    message: "this stream is still warming up — press play again and it usually snaps right in",
  };
}

/** On-demand SELF-HEAL: force a fresh extraction on the service (innertube
 * multi-round arc riding the gate flap + a byte-probed piped pass) and
 * swap the cached body for the fresh one. Used by the watch view when the
 * player's stream URLs have gone stale (403s from expired signatures).
 * The service only answers 200 with BYTE-PLAYABLE formats — anything else
 * is a gate, which we park in the cache so the watch view's auto-retry +
 * relay machinery takes over instead of looping dead URLs. */
export async function ytVideoRefresh(id: string): Promise<YtVideo> {
  if (!/^[-\w]{6,20}$/.test(id)) throw new Error("bad video id");
  const key = `video:${id}`;
  cache.delete(key);
  /* Raw fetch (not ftFetch) — the service's full refresh arc can ride ~60s
   * and the 503 body carries the gate message. */
  const res = await fetch(`${FT_BASE}/api/v1/videos/${id}?force=1`, {
    signal: AbortSignal.timeout(75_000),
    headers: { accept: "application/json", "user-agent": "veil-stream/1.0" },
    cache: "no-store",
  }).catch(() => null);
  const gate: YtGate = {
    gated: true,
    message:
      "the stream bytes are still gated upstream — auto-retrying every few seconds; the relay player below can play it right now",
  };
  if (!res || !res.ok) {
    cache.set(key, { at: Date.now(), body: gate });
    throw new Error(gate.message);
  }
  const body = (await res.json().catch(() => null)) as UpstreamVideo | null;
  if (!body || !body.videoId) {
    cache.set(key, { at: Date.now(), body: gate });
    throw new Error(gate.message);
  }
  const video = mapVideo(body);
  cache.set(key, { at: Date.now(), body: video });
  return video;
}

/** Likes + related ONLY, straight from the compat service's /next data —
 * INDEPENDENT of the stream-extraction gate. The watch RELAY lane (a
 * gated video) still gets real like counts and real up-next
 * recommendations; zeros when /next has nothing. */
export interface YtVideoMeta {
  likes: number;
  dislikes: number;
  /** the video description from the /next data — gate-independent, so
   * the relay lane (a gated video playing through the embed) still
   * shows the real description instead of nothing. */
  description: string;
  related: YtCard[];
}
export async function ytVideoMeta(id: string): Promise<YtVideoMeta> {
  if (!/^[-\w]{6,20}$/.test(id)) return { likes: 0, dislikes: 0, description: "", related: [] };
  try {
    const r = await ftFetch(`/api/v1/videos/${id}/meta`, "", 15_000);
    if (!r.ok) return { likes: 0, dislikes: 0, description: "", related: [] };
    const b = r.body as {
      likeCount?: number;
      dislikeCount?: number;
      description?: string;
      descriptionHtml?: string;
      recommendedVideos?: UpstreamCard[];
    };
    return {
      likes: b.likeCount ?? 0,
      dislikes: b.dislikeCount ?? 0,
      description: String(b.description ?? b.descriptionHtml ?? "").replace(
        /<br\s*\/?>/gi,
        "\n",
      ),
      related: (b.recommendedVideos ?? []).map(mapCard).filter((c) => c.id && c.title),
    };
  } catch {
    return { likes: 0, dislikes: 0, description: "", related: [] };
  }
}

/* ------------------------------------------------------------------ */
/* Comments (read-only threads — the wire the compat service maps from
/* Piped /comments, replies included)                                  */
/* ------------------------------------------------------------------ */

export interface YtComment {
  author: string;
  authorId: string;
  avatar: string;
  content: string;
  published: string;
  likes: number;
  /** reply thread size (0 = none) */
  replies: number;
  /** continuation token that loads the reply thread (null = none). */
  replyToken: string | null;
  pinned: boolean;
  verified: boolean;
}
export interface YtComments {
  count: number;
  comments: YtComment[];
  /** next-page token (null = no more top-level comments). */
  next: string | null;
  /** false when a sort=new ask couldn't be honored (YouTube hid the sort
   * menu for this video right now — top order came back instead). */
  sortApplied?: boolean;
}

interface UpstreamComments {
  commentCount?: number;
  sortApplied?: boolean;
  comments?: {
    author?: string;
    authorThumbnails?: { url?: string; width?: number }[];
    authorId?: string;
    content?: string;
    publishedText?: string;
    likeCount?: number;
    replyCount?: number;
    pinned?: boolean;
    verified?: boolean;
    replies?: { replyCount?: number; continuation?: string | null };
  }[];
  continuation?: string | null;
}

/** A video's comment thread — top-level page or a continuation/
 * reply page. `continuation` is either the next-page token (more
 * top-level comments) or a comment's repliesPage token (its thread).
 * `sort` ("top" default | "new") picks the comments sort on the first
 * page — paging tokens stay inside the picked order. */
export async function ytComments(
  id: string,
  continuation = "",
  sort: "top" | "new" = "top",
): Promise<YtComments | YtGate> {
  if (!/^[-\w]{6,20}$/.test(id)) return { gated: true, message: "bad video id" };
  const key = `comments:${id}:${continuation.slice(0, 64)}:${sort}`;
  return cached(key, 120_000, async () => {
    const params = new URLSearchParams();
    if (continuation) params.set("continuation", continuation);
    if (sort === "new") params.set("sort_by", "new");
    const qs = params.toString() ? `?${params.toString()}` : "";
    const r = await ftFetch(`/api/v1/comments/${id}`, qs, 30_000);
    if (!r.ok) {
      const gate = asGate(r.body);
      if (gate) return gate;
      return { count: 0, comments: [], next: null } as YtComments;
    }
    const b = r.body as UpstreamComments;
    const list = b.comments ?? [];
    return {
      count: b.commentCount ?? list.length,
      comments: list
        .filter((c) => (c.content ?? "").trim() && (c.author ?? "").trim())
        .map((c) => ({
          author: c.author ?? "",
          authorId: c.authorId ?? "",
          avatar: toProxyUrl(
            /* largest source — the smallest (32px) goes blurry in the
             * 32-px avatar circles on hidpi screens */
            (c.authorThumbnails ?? []).filter((t) => t.url).sort((a, b2) => (b2.width ?? 0) - (a.width ?? 0))[0]?.url,
          ) || "",
          /* upstream comments carry light HTML (links, <br>) — render as
           * plain text (tags stripped, entities already decoded upstream) */
          content: (c.content ?? "")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]*>/g, "")
            .trim(),
          published: c.publishedText ?? "",
          likes: c.likeCount ?? 0,
          replies: c.replyCount ?? 0,
          replyToken: c.replies?.continuation || null,
          pinned: Boolean(c.pinned),
          verified: Boolean(c.verified),
        })),
      next: b.continuation || null,
      sortApplied: b.sortApplied !== false,
    } as YtComments;
  }, GATE_TTL, STALE_SERVE_MS);
}

/* ------------------------------------------------------------------ */
/* Subscriptions feed — the channels this device follows, latest first */
/* ------------------------------------------------------------------ */

/** The subscriptions wire: each followed channel's latest uploads
 * (read off the same service-cached channel pages the For You rails
 * use), merged and sorted newest-first. The follow list itself lives
 * on the device (localStorage) — the server never stores it. */
export async function ytSubsFeed(ids: string[]): Promise<YtCard[] | YtGate> {
  const clean = [...new Set(ids.filter((id) => /^(UC|HC)[\w-]{6,}$/.test(id)))].slice(0, 12);
  if (clean.length === 0) return [] as YtCard[];
  return cached(
    `subs:${clean.join(",")}`,
    5 * 60_000,
    async () => {
      const shelves = await Promise.all(
        clean.map(async (id) => {
          try {
            const r = await ftFetch(`/api/v1/channels/${id}`, "", 20_000);
            if (!r.ok) return [] as YtCard[];
            const c = r.body as UpstreamChannel;
            const name = (c.author ?? "").trim();
            /* real channel logo on every subs card */
            const avatar = toProxyUrl(
              (c.authorThumbnails ?? []).filter((t) => t.url).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url,
            ) || "";
            return (c.latestVideos ?? [])
              .map(mapCard)
              .filter((v) => v.id && v.title)
              .slice(0, 5)
              .map((v) => ({
                ...v,
                ...(avatar ? { avatar } : {}),
                why: name ? `from ${name}` : "from a channel you follow",
              }));
          } catch {
            return [] as YtCard[];
          }
        }),
      );
      return shelves
        .flat()
        .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
        .slice(0, 40);
    },
    GATE_TTL,
    STALE_SERVE_MS,
  );
}

/* ------------------------------------------------------------------ */
/* Subscriptions feed — INFINITE pages (YouTube-style deep scroll)      */
/* ------------------------------------------------------------------ */

/** One round of the infinite Subscriptions river.
 *
 * YouTube's subs page is one chronological stream that keeps going:
 * scroll and older uploads from every followed channel keep appending.
 * This is the stateless server half — the client owns the cursor map
 * (what page each channel is on) and POSTs it back each round:
 *
 *   round 1   cursors={}          → each channel's LATEST ~6 uploads,
 *                                    merged newest-first, plus each
 *                                    channel's continuation token
 *   round N   cursors={UCa: tok,…} → the NEXT ~6 uploads of every
 *                                    channel that still has a token
 *                                    (finished channels drop out)
 *
 * Response: { cards, next } — `next` is the updated cursor map (only
 * channels with more pages). When it's empty the river is exhausted
 * and the client shows "You're all caught up".
 *
 * Channel pages come off the same caches the channel page + For You
 * rails use, so round 1 usually answers instantly. The follow list
 * itself NEVER reaches the server beyond this request — it stays in
 * the client's localStorage. */
export interface YtSubsPage {
  cards: YtCard[];
  next: Record<string, string>;
}

const SUBS_PAGE_PER_CHANNEL = 6;

/* ------------------------------------------------------------------ */
/* River cursors — token + how much of that page was already dealt    */
/* ------------------------------------------------------------------ */

/** Channel pages hand ~30 uploads per page, but rivers deal a few per
 * round — a cursor must therefore carry BOTH the continuation token
 * and the consumed offset, or every round would silently skip the
 * rest of the page (24 of 30 uploads — the missing-uploads bug this
 * replaces). Format: `1|<skip>|<token>` — an empty token means the
 * channel's header page. A bare token (no `1|` prefix) parses as
 * skip 0, so river states from the old scheme keep working. */
function packRiverCursor(tok: string, skip: number): string {
  return `1|${Math.max(0, Math.floor(skip))}|${tok ?? ""}`;
}

function unpackRiverCursor(cur: string): { tok: string; skip: number } {
  if (typeof cur !== "string" || !cur) return { tok: "", skip: 0 };
  const m = /^1\|(\d+)\|([\s\S]*)$/.exec(cur);
  if (m) return { tok: m[2], skip: Number(m[1]) };
  return { tok: cur, skip: 0 };
}

/** Deal the next `per` uploads of one river channel, advancing its
 * cursor. tok="" reads the channel's header page (service-cached);
 * otherwise the continuation page (cached per token, so re-dealing
 * the same page at a new skip is a cache hit). A page boundary never
 * costs a round — the deal rolls straight onto the following page.
 * Returns null when the channel's shelf is dry (or gated). */
async function riverStep(
  id: string,
  cur: string,
  per: number,
): Promise<{ cards: YtCard[]; next: string | null } | null> {
  let { tok, skip } = unpackRiverCursor(cur);
  for (let hop = 0; hop < 3; hop++) {
    let cards: YtCard[];
    let pageNext: string | null;
    if (!tok) {
      try {
        const r = await ftFetch(`/api/v1/channels/${id}`, "", 45_000);
        if (!r.ok) return null;
        const c = r.body as UpstreamChannel;
        cards = (c.latestVideos ?? []).map(mapCard).filter((v) => v.id && v.title);
        pageNext = c.continuation || null;
      } catch {
        return null;
      }
    } else {
      try {
        const page = await ytChannelMore(id, "videos", tok);
        if ("gated" in page) return null;
        cards = page.cards;
        pageNext = page.next;
      } catch {
        return null;
      }
    }
    const slice = cards.slice(skip, skip + per);
    if (slice.length > 0) {
      const consumed = skip + slice.length;
      const next =
        consumed >= cards.length
          ? pageNext
            ? packRiverCursor(pageNext, 0)
            : null
          : packRiverCursor(tok, consumed);
      return { cards: slice, next };
    }
    /* this page is exhausted mid-cursor — roll onto the next one */
    if (!pageNext) return null;
    tok = pageNext;
    skip = 0;
  }
  return null;
}

export async function ytSubsFeedPage(
  ids: string[],
  cursors: Record<string, string>,
): Promise<YtSubsPage | YtGate> {
  const clean = [...new Set(ids.filter((id) => /^(UC|HC)[\w-]{6,}$/.test(id)))].slice(0, 30);
  if (clean.length === 0) return { cards: [], next: {} };

  const shelves = await Promise.all(
    clean.map(async (id): Promise<{ id: string; cards: YtCard[]; next: string | null }> => {
      /* riverStep deals the next slice WITHOUT skipping the rest of the
       * page (the cursor carries the consumed offset) — round 1 reads
       * the channel header, deep rounds continue where the last round
       * stopped, page boundaries roll automatically */
      const step = await riverStep(id, cursors[id] ?? packRiverCursor("", 0), SUBS_PAGE_PER_CHANNEL);
      return step ? { id, cards: step.cards, next: step.next } : { id, cards: [], next: null };
    }),
  );

  /* one chronological river, deduped by video id, newest first */
  const seen = new Set<string>();
  const cards: YtCard[] = [];
  for (const v of shelves
    .flatMap((s) => s.cards)
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    cards.push(v.author ? { ...v, why: `from ${v.author}` } : v);
  }

  const next: Record<string, string> = {};
  for (const s of shelves) if (s.next) next[s.id] = s.next;
  return { cards, next };
}

/* ------------------------------------------------------------------ */
/* Channel avatars — batch lookup for the client's card grid           */
/* ------------------------------------------------------------------ */

/** One channel's REAL avatar (same-origin proxy URL), cached hard —
 * avatars basically never change, and the underlying channel page is
 * itself cached by the compat service, so this stays cheap. */
export async function ytAvatar(id: string): Promise<string> {
  if (!/^(UC|HC)[\w-]{6,}$/.test(id)) return "";
  return cached(`avatar:${id}`, 30 * 60_000, async () => {
    try {
      const r = await ftFetch(`/api/v1/channels/${id}`, "", 20_000);
      if (!r.ok) return "";
      const c = r.body as UpstreamChannel;
      return (
        toProxyUrl(
          (c.authorThumbnails ?? []).filter((t) => t.url).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url,
        ) || ""
      );
    } catch {
      return "";
    }
  });
}

/** Batch avatar lookup — the client sends the distinct channel ids its
 * visible cards carry; the answer maps each to a proxy avatar URL (ids
 * with no avatar are simply absent from the map). Served as one cheap
 * JSON round-trip so the grid can stamp REAL channel logos everywhere. */
export async function ytAvatars(ids: string[]): Promise<Record<string, string>> {
  const clean = [...new Set(ids.filter((id) => /^(UC|HC)[\w-]{6,}$/.test(id)))].slice(0, 30);
  const out: Record<string, string> = {};
  await Promise.all(
    clean.map(async (id) => {
      const a = await ytAvatar(id);
      if (a) out[id] = a;
    }),
  );
  return out;
}

/* Keep the browse wires hot and rotating: a light loop that refreshes
 * trending/popular/shorts every few minutes so the FIRST feed request
 * of any session is already warm (and the shorts shelf keeps dealing
 * new mixes instead of sitting on one cached blend). Started once from
 * instrumentation; every tick is fire-and-forget and can never throw. */
let warmerStarted = false;
export function startFeedWarmer(): void {
  if (warmerStarted) return;
  warmerStarted = true;
  console.log("[veil] stream feed warmer started (feeds rotate every 3 min)");
  const warm = () => {
    ytFeed("trending", "US").catch(() => {});
    ytFeed("trending", "GB").catch(() => {});
    ytFeed("popular", "US").catch(() => {}); /* shorts discovery pool */
    ytPopularFeed().catch(() => {});
    ytShortsFeed().catch(() => {});
  };
  warm();
  const t = setInterval(warm, 3 * 60_000);
  t.unref?.();
}

interface UpstreamChannel {
  author?: string;
  authorId?: string;
  authorVerified?: boolean;
  subCount?: number;
  description?: string;
  authorThumbnails?: { url?: string; width?: number }[];
  latestVideos?: UpstreamCard[];
  /** Piped's nextpage continuation token — deeper videos pages. */
  continuation?: string | null;
}

/** A channel-shelf continuation answer (videos, shorts, live streams or
 * posts — `cards` for the video-ish tabs, `posts` for the Posts tab). */
export interface YtChannelPage {
  cards: YtCard[];
  /** Posts-tab page (absent on video-ish tabs). */
  posts?: YtPost[];
  /** next continuation token (null = shelf end). */
  next: string | null;
}

/** The wire shape a Posts answer carries upstream (avatar + images are
 * absolute URLs until mapPost re-hosts them on the byte proxy). */
interface UpstreamPost {
  postId?: string;
  author?: string;
  avatar?: string;
  published?: string;
  likes?: number;
  comments?: number;
  text?: string;
  images?: string[];
  poll?: { question?: string; options?: { text?: string; pct?: number }[] } | null;
}

function mapPost(p: UpstreamPost): YtPost {
  return {
    id: p.postId ?? "",
    author: p.author ?? "",
    avatar: toProxyUrl(p.avatar ?? ""),
    published: p.published ?? "",
    likes: p.likes ?? 0,
    comments: p.comments ?? 0,
    text: p.text ?? "",
    images: (p.images ?? []).map((u) => toProxyUrl(u)).filter(Boolean),
    poll: p.poll && (p.poll.options ?? []).length > 0
      ? {
          question: p.poll.question ?? "",
          options: (p.poll.options ?? []).map((o) => ({ text: o.text ?? "", pct: Math.max(0, Math.min(100, Math.round(o.pct ?? 0))) })),
        }
      : undefined,
  };
}

/** Fetch a channel page — header + videos (invidious /channels/:id) and
 * shorts (the compat service's /shorts shelf) in parallel. Both shelves
 * carry continuation tokens so the page can page deeper on demand
 * (Piped hands ~30 videos / ~48 shorts per page). */
export async function ytChannel(id: string): Promise<YtChannel | YtGate> {
  if (!/^(UC|HC)[\w-]{6,}$/.test(id)) return { gated: true, message: "bad channel id" };
  return cached(`channel:${id}`, 120_000, async () => {
    const [r, rs] = await Promise.all([
      ftFetch(`/api/v1/channels/${id}`, "", 45_000),
      ftFetch(`/api/v1/channels/${id}/shorts`, "", 45_000),
    ]);
    if (!r.ok) {
      const gate = asGate(r.body);
      if (gate) return gate;
      return { gated: true, message: "the channel didn't answer — try again in a moment" } as YtGate;
    }
    const c = r.body as UpstreamChannel;
    if (!c || !c.author) {
      return { gated: true, message: "the channel came back empty — try again" } as YtGate;
    }
    const shortsBody =
      rs.ok && Array.isArray((rs.body as { videos?: UpstreamCard[] })?.videos)
        ? (rs.body as { videos: UpstreamCard[]; continuation?: string | null })
        : { videos: [] as UpstreamCard[], continuation: null };
    const avatar = toProxyUrl(
      (c.authorThumbnails ?? []).filter((t) => t.url).sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url,
    ) || "";
    return {
      id,
      name: c.author,
      verified: Boolean(c.authorVerified),
      avatar,
      subs: c.subCount ?? 0,
      description: (c.description ?? "").trim(),
      videos: (c.latestVideos ?? []).map(mapCard).filter((v) => v.id && v.title).map((v) => ({ ...v, short: false })),
      shorts: shortsBody.videos.map(mapCard).filter((v) => v.id && v.title).map((v) => ({ ...v, short: true })),
      videosNext: c.continuation || null,
      shortsNext: shortsBody.continuation || null,
    };
  }, GATE_TTL);
}

/** Fetch the NEXT page of a channel shelf ("Load more") — the continuation
 * token comes from the channel answer (or a previous page). Videos page
 * via /nextpage/channel/:id; shorts, live streams and posts page via the
 * compat-service channel tabs; cards keep their shelf's `short` flag,
 * streams carry `live`. An EMPTY continuation on streams/posts asks for
 * the tab's FIRST page (the frontend lazy-loads those tabs on click). */
export async function ytChannelMore(
  id: string,
  tab: "videos" | "shorts" | "streams" | "posts",
  continuation: string,
): Promise<YtChannelPage | YtGate> {
  if (!/^(UC|HC)[\w-]{6,}$/.test(id)) {
    return { gated: true, message: "bad channel page request" };
  }
  return cached(`channelmore:${id}:${tab}:${continuation}`, 120_000, async () => {
    let path: string;
    if (tab === "videos") {
      if (!continuation) return { cards: [], next: null };
      path = `/api/v1/channels/${id}/videos?continuation=${encodeURIComponent(continuation)}`;
    } else if (tab === "shorts") {
      if (!continuation) return { cards: [], next: null };
      path = `/api/v1/channels/${id}/shorts?continuation=${encodeURIComponent(continuation)}`;
    } else if (tab === "streams") {
      path = `/api/v1/channels/${id}/streams${continuation ? `?continuation=${encodeURIComponent(continuation)}` : ""}`;
    } else {
      path = `/api/v1/channels/${id}/community${continuation ? `?continuation=${encodeURIComponent(continuation)}` : ""}`;
    }
    const r = await ftFetch(path, "", 45_000);
    if (!r.ok) {
      const gate = asGate(r.body);
      if (gate) return gate;
      return { gated: true, message: "the channel page didn't answer — try again in a moment" } as YtGate;
    }
    if (tab === "posts") {
      const rawPosts = r.body as { posts?: UpstreamPost[]; continuation?: string | null };
      const posts = (rawPosts.posts ?? []).map(mapPost).filter((p) => p.id && (p.text || p.images.length > 0 || p.poll));
      return { cards: [], posts, next: rawPosts.continuation || null };
    }
    const raw = r.body as { latestVideos?: UpstreamCard[]; videos?: UpstreamCard[]; continuation?: string | null };
    const list = (tab === "shorts" || tab === "streams" ? raw.videos : raw.latestVideos) ?? [];
    const cards = list
      .map(mapCard)
      .filter((v) => v.id && v.title)
      .map((v) => ({ ...v, short: tab === "shorts" }));
    return { cards, next: raw.continuation || null };
  }, GATE_TTL);
}
