/**
 * freetube-service — grayjay-relay.ts
 *
 * Innertube /player relay for the Grayjay Desktop program.
 *
 * Google gates this datacenter IP for youtubei /player requests from the
 * program's own innertube clients (VideoLoad hangs / "Video could not
 * load"), while Piped instances — which run their own innertube with
 * working deciphering — DO answer. This module synthesizes an innertube
 * /player response from Piped's /streams data so the Grayjay YouTube
 * plugin can render watch pages and play videos.
 *
 * The plugin's player URLs are patched to
 *   http://127.0.0.1:3031/gj/player?...
 * (see download/grayjay-desktop/…plugin_scripts/<youtube-id> patches).
 *
 * Endpoints:
 *   POST|GET /gj/player          → innertube /player-shaped JSON
 *   GET       /gj/hls/:id/master.m3u8  → HLS master playlist
 *   GET       /gj/hls/:id/media.m3u8   → HLS media playlist (Piped progressive)
 */

import { piped } from "./invidious-compat";

const PROGRESSIVE_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept: "application/json",
};

type GjFormat = {
  itag: number;
  url: string;
  mimeType: string;
  bitrate?: number;
  width?: number;
  height?: number;
  fps?: number;
  qualityLabel?: string;
  approxDurationMs?: string;
  initRange?: { start: string; end: string };
  indexRange?: { start: string; end: string };
  audioQuality?: string;
  contentLength?: string;
};

/* Piped /streams → the parts we need, with a short cache so the plugin's
   multi-client player probes (HTML5 → Android → VR → VisionOS) hit one
   upstream fetch. */
const streamsCache = new Map<string, { at: number; d: any }>();
const STREAMS_TTL = 90_000;

async function pipedStreams(id: string): Promise<any> {
  const hit = streamsCache.get(id);
  if (hit && Date.now() - hit.at < STREAMS_TTL) return hit.d;
  const d = await piped(`/streams/${id}`);
  streamsCache.set(id, { at: Date.now(), d });
  if (streamsCache.size > 200) {
    // trim oldest
    const first = streamsCache.keys().next().value;
    if (first) streamsCache.delete(first);
  }
  return d;
}

function channelIdOf(d: any): string {
  const s = String(d?.uploaderUrl || "");
  const m = /\/channel\/(UC[\w-]{6,})/.exec(s);
  return m ? m[1] : `UC${String(d?.uploader || "unknown").replace(/\W/g, "").slice(0, 20)}`;
}

/** Piped format → innertube adaptive format shape. */
function mapAdaptive(v: any, durationSec: number): GjFormat | null {
  if (!v?.url) return null;
  const codec = v.codec ? `; codecs="${v.codec}"` : "";
  return {
    itag: Number(v.itag ?? 0),
    url: String(v.url),
    mimeType: `${v.mimeType || "video/mp4"}${codec}`,
    bitrate: Math.round(Number(v.bitrate ?? 0)),
    width: v.width ? Number(v.width) : undefined,
    height: v.height ? Number(v.height) : undefined,
    fps: v.fps ? Number(v.fps) : undefined,
    qualityLabel: v.quality ? String(v.quality) : undefined,
    approxDurationMs: String(Math.round(durationSec * 1000)),
    initRange: { start: String(v.initStart ?? 0), end: String(Math.max(Number(v.initEnd ?? 0), 1)) },
    indexRange: { start: String(v.indexStart ?? 0), end: String(Math.max(Number(v.indexEnd ?? 0), 1)) },
  };
}

/** Build the innertube /player response for a video. */
export async function gjPlayerResponse(id: string): Promise<any> {
  const d = await pipedStreams(id);
  const durationSec = Number(d?.duration ?? 0);

  const adaptive: GjFormat[] = [];
  for (const v of d?.videoStreams || []) {
    if (v?.videoOnly === false) continue; // combined goes to `formats`
    const f = mapAdaptive(v, durationSec);
    if (f) adaptive.push(f);
  }
  for (const a of d?.audioStreams || []) {
    if (!a?.url) continue;
    const f = mapAdaptive(a, durationSec);
    if (f) {
      f.audioQuality = /high/i.test(String(a.quality))
        ? "AUDIO_QUALITY_HIGH"
        : /low/i.test(String(a.quality))
          ? "AUDIO_QUALITY_LOW"
          : "AUDIO_QUALITY_MEDIUM";
      adaptive.push(f);
    }
  }

  const formats: GjFormat[] = [];
  for (const v of d?.videoStreams || []) {
    if (v?.videoOnly !== false) continue;
    const codec = v.codec ? `; codecs="${v.codec}"` : "";
    formats.push({
      itag: Number(v.itag ?? 18),
      url: String(v.url),
      mimeType: `${v.mimeType || "video/mp4"}${codec}`,
      bitrate: Math.round(Number(v.bitrate ?? 0)),
      width: v.width ? Number(v.width) : undefined,
      height: v.height ? Number(v.height) : undefined,
      approxDurationMs: String(Math.round(durationSec * 1000)),
    });
  }

  // When upstream is gated to ONLY the combined (video+audio) progressive
  // format, synthesize proper adaptive entries from the real MP4 header so
  // the plugin builds an unmuxed descriptor and the player's sourceAuto
  // has video+audio streams to pick (both stream from the same combined
  // URL — the browser plays them as-is).
  if (adaptive.length === 0 && formats.length > 0) {
    const combined = formats[0];
    const ranges = await mp4Ranges(String(combined.url)).catch(() => null);
    const init = ranges ? `${ranges.initStart}-${ranges.initEnd}` : "0-999";
    const index = ranges ? `${ranges.indexStart}-${ranges.indexEnd}` : "1000-1999";
    const w = combined.width || 640;
    const h = combined.height || 360;
    adaptive.push({
      itag: 18,
      url: combined.url,
      mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
      bitrate: 800_000,
      width: w,
      height: h,
      fps: 30,
      qualityLabel: "360p",
      approxDurationMs: String(Math.round(durationSec * 1000)),
      initRange: { start: init.split("-")[0], end: init.split("-")[1] },
      indexRange: { start: index.split("-")[0], end: index.split("-")[1] },
    });
    adaptive.push({
      itag: 139,
      url: combined.url,
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      bitrate: 48_000,
      approxDurationMs: String(Math.round(durationSec * 1000)),
      audioQuality: "AUDIO_QUALITY_MEDIUM",
      initRange: { start: init.split("-")[0], end: init.split("-")[1] },
      indexRange: { start: index.split("-")[0], end: index.split("-")[1] },
    });
  }

  const captionTracks = (d?.subtitles || [])
    .filter((s: any) => s?.url && /vtt|text/i.test(String(s.format || "vtt")))
    .slice(0, 12)
    .map((s: any) => ({
      baseUrl: String(s.url),
      name: { simpleText: String(s.name || s.languageCode || "Subtitles") },
      languageCode: String(s.languageCode || "en"),
      kind: "asr",
    }));

  const hlsUrl = `http://127.0.0.1:3031/gj/hls/${id}/master.m3u8`;

  return {
    responseContext: { visitorData: "" },
    playabilityStatus: { status: "OK", playableInEmbed: true },
    streamingData: {
      expiresInSeconds: "21540",
      hlsManifestUrl: hlsUrl,
      ...(adaptive.length ? { adaptiveFormats: adaptive } : {}),
      ...(formats.length ? { formats } : {}),
    },
    videoDetails: {
      videoId: id,
      title: String(d?.title || ""),
      channelId: channelIdOf(d),
      author: String(d?.uploader || ""),
      shortDescription: String(d?.description || ""),
      lengthSeconds: String(Math.round(durationSec)),
      viewCount: String(Math.round(Number(d?.views ?? 0))),
      author: String(d?.uploader || ""),
      isLiveContent: false,
      isLive: false,
      thumbnail: {
        thumbnails: thumbsFor(String(d?.thumbnailUrl || "")),
      },
    },
    ...(captionTracks.length
      ? { captions: { playerCaptionsTracklistRenderer: { captionTracks } } }
      : {}),
    microformat: {
      playerMicroformatRenderer: {
        viewCount: String(Math.round(Number(d?.views ?? 0))),
        publishDate: String(d?.uploadDate || "").slice(0, 10),
        lengthSeconds: String(Math.round(durationSec)),
      },
    },
  };
}

function thumbsFor(u: string): Array<{ url: string; width: number; height: number }> {
  if (!u) return [];
  return [
    { url: u.replace(/\/[^/]+$/, "/hqdefault.jpg"), width: 480, height: 360 },
    { url: u, width: 640, height: 480 },
  ];
}

/* ------------------------------------------------------------------ */
/* MP4 header parsing (real init/index boundaries for the DASH build)   */
/* ------------------------------------------------------------------ */

/**
 * Fetch the MP4 header and walk its boxes to find the real init-segment
 * boundary (ftyp..moov end) and — when present — the sidx (segment index)
 * boundary. YouTube progressive MP4s are ftyp+moov+mdat (non-fragmented),
 * so the index falls back to the moov end.
 */
export async function mp4Ranges(url: string): Promise<{ initStart: number; initEnd: number; indexStart: number; indexEnd: number } | null> {
  const HEAD = 131_072; // 128KB covers ftyp+moov for typical itag-18 files
  try {
    const res = await fetch(url, {
      headers: { ...PROGRESSIVE_HEADERS, range: `bytes=0-${HEAD - 1}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok && res.status !== 206) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    // walk top-level boxes
    let off = 0;
    let moovEnd = -1;
    let sidxEnd = -1;
    while (off + 8 <= buf.length) {
      const size = (buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3];
      const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
      if (size < 8 || off + size > buf.length + 8) break;
      if (type === "moov") moovEnd = off + size;
      if (type === "sidx") sidxEnd = off + size;
      off += size;
    }
    if (moovEnd === -1) return null;
    const indexEnd = sidxEnd > 0 ? sidxEnd : moovEnd;
    return { initStart: 0, initEnd: moovEnd - 1, indexStart: moovEnd, indexEnd: Math.max(indexEnd - 1, moovEnd) };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* HLS playlists                                                        */
/* ------------------------------------------------------------------ */

export async function gjHlsMaster(id: string): Promise<string> {
  // A single-variant master wrapping the media playlist.
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:6",
    `#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360`,
    `media.m3u8`,
    "",
  ].join("\n");
}

export async function gjHlsMedia(id: string): Promise<string> {
  const d = await pipedStreams(id);
  const duration = Math.max(1, Math.round(Number(d?.duration ?? 0)));
  const prog = (d?.videoStreams || []).find((v: any) => v?.videoOnly === false && v?.url);
  const src = prog?.url || (d?.audioStreams || [])[0]?.url;
  if (!src) throw new Error("no playable progressive url");
  // Single-segment VOD playlist pointing at the whole progressive MP4.
  // hls.js probes self-initializing MP4 segments (moov+mdat in one payload)
  // and routes them through its MP4 path — no EXT-X-MAP needed.
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:6",
    "#EXT-X-TARGETDURATION:" + duration,
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXTINF:${duration}.000,`,
    String(src),
    "#EXT-X-ENDLIST",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* HTTP handler                                                          */
/* ------------------------------------------------------------------ */

const CORS_JSON = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "cache-control": "no-store",
};

export async function handleGrayjay(path: string, req: Request, url: URL): Promise<Response | null> {
  // /gjmedia/direct/:id — the patched Grayjay web player fetches this to
  // swap the (desktop-loopback) DASH manifest for a directly playable
  // progressive URL; native <video> playback needs no MSE fragmentation.
  const direct = /^\/gjmedia\/direct\/([\w-]{6,20})$/.exec(path);
  if (direct) {
    const id = direct[1];
    try {
      const d = await pipedStreams(id);
      const prog = (d?.videoStreams || []).find((v: any) => v?.videoOnly === false && v?.url);
      const src = prog?.url || (d?.audioStreams || []).find((a: any) => a?.url)?.url;
      if (!src) throw new Error("no progressive stream available");
      return new Response(JSON.stringify({ url: String(src), type: "video/mp4", id }), { headers: CORS_JSON });
    } catch (err) {
      return new Response(JSON.stringify({ error: String((err as Error)?.message || err) }), {
        status: 502,
        headers: CORS_JSON,
      });
    }
  }

  // /gj/player — innertube player relay (the plugin POSTs JSON bodies)
  if (path === "/gj/player") {
    let id = url.searchParams.get("id") || "";
    console.log(`[gj-relay] /gj/player id=${id} method=${req.method} ua=${(req.headers.get("user-agent") || "").slice(0, 40)}`);
    if (!id) {
      try {
        const body = (await req.json()) as { videoId?: string; video_id?: string };
        id = String(body?.videoId || body?.video_id || "");
      } catch {
        /* GET without body */
      }
    }
    if (!/^[\w-]{6,20}$/.test(id)) {
      return new Response(JSON.stringify({ error: "bad video id" }), { status: 400, headers: CORS_JSON });
    }
    try {
      const payload = await gjPlayerResponse(id);
      return new Response(JSON.stringify(payload), { headers: CORS_JSON });
    } catch (err) {
      // innertube-shaped error the plugin's fallback chain understands
      return new Response(
        JSON.stringify({
          playabilityStatus: {
            status: "ERROR",
            reason: `veil relay: ${String((err as Error)?.message || err).slice(0, 160)}`,
          },
        }),
        { status: 200, headers: CORS_JSON },
      );
    }
  }

  // /gj/hls/:id/master.m3u8|media.m3u8 — HLS playlists
  const hlsMatch = /^\/gj\/hls\/([\w-]{6,20})\/(master|media)\.m3u8$/.exec(path);
  if (hlsMatch) {
    const [, id, kind] = hlsMatch;
    try {
      const body = kind === "master" ? await gjHlsMaster(id) : await gjHlsMedia(id);
      return new Response(body, {
        headers: { "content-type": "application/vnd.apple.mpegurl", "access-control-allow-origin": "*", "cache-control": "no-store" },
      });
    } catch (err) {
      return new Response(`#EXTM3U\n#EXT-X-ERROR:${String((err as Error)?.message || err).slice(0, 120)}\n`, {
        status: 500,
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      });
    }
  }

  // /gj/hls/seg.m3u8?range=a-b&id=… — proxy byte ranges of the progressive
  // stream so the player stays same-origin through the service and the
  // Piped URL never has to be CORS- or IP-visible to the Grayjay client.
  if (path === "/gj/hls/seg.m3u8") {
    const range = url.searchParams.get("range") || "";
    const id = url.searchParams.get("id") || "";
    const m = /^(\d+)-(\d+)$/.exec(range);
    if (!m || !/^[\w-]{6,20}$/.test(id)) return new Response("bad range", { status: 400 });
    try {
      const d = await pipedStreams(id);
      const prog = (d?.videoStreams || []).find((v: any) => v?.videoOnly === false && v?.url);
      const src = String(prog?.url || "");
      if (!src) return new Response("no stream", { status: 404 });
      const upstream = await fetch(src, {
        headers: { ...PROGRESSIVE_HEADERS, range: `bytes=${m[1]}-${m[2]}` },
        signal: AbortSignal.timeout(20_000),
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "content-type": upstream.headers.get("content-type") || "video/mp4",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=1800",
          ...(upstream.headers.get("content-range")
            ? { "content-range": upstream.headers.get("content-range") as string }
            : {}),
          ...(upstream.headers.get("accept-ranges") ? { "accept-ranges": "bytes" } : {}),
        },
      });
    } catch (err) {
      return new Response(String((err as Error)?.message || err), { status: 502 });
    }
  }

  return null;
}
