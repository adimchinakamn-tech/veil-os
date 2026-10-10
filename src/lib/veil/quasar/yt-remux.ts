/**
 * Quasar yt-remux (v2.1.0) — optional, flag-gated ffmpeg remux-to-HLS.
 * ---------------------------------------------------------------
 * Honest scope: this remuxes PROGRESSIVE / adaptive DIRECT-MEDIA URLs
 * (mp4/webm, existing m3u8→HLS, ts streams, etc.) via ffmpeg stream-copy
 * (`-c copy` — no transcoding, so it is cheap but format-faithful). It gives
 * self-hosters a complete-playback path for direct media URLs and for
 * YouTube formats that still expose progressive streams.
 *
 * It does NOT parse YouTube's proprietary SABR/UMP (YouTube Media
 * Connected/UMP POST) responses — that stays the documented hard ceiling
 * (see potoken.ts / worklog Task 11): SABR only carries segmented,
 * licence-bound media and ffmpeg cannot ingest it as a plain http source.
 *
 * Design: everything is gated behind QUASAR_REMUX=1, ffmpeg is probed with
 * a real spawn (no shell), every job works inside a private mkdtemp dir,
 * failures ALWAYS degrade to `null` (never throw to the caller), and
 * concurrency is bounded so the box can't be turned into an ffmpeg farm.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Enabled only when explicitly opted in — off by default everywhere. */
export function remuxEnabled(): boolean {
  return process.env.QUASAR_REMUX === "1";
}

/* ------------------------------------------------------------------ */
/* ffmpeg availability probe                                           */
/* ------------------------------------------------------------------ */

const PROBE_TTL_MS = 60_000; // negative result memoized for 60s per spec (positive too)
let ffmpegProbe: { ok: boolean; ts: number } | null = null;

/** Spawns `ffmpeg -version` (no shell) and resolves true iff it exits 0. */
export async function ffmpegAvailable(): Promise<boolean> {
  const now = Date.now();
  if (ffmpegProbe && now - ffmpegProbe.ts < PROBE_TTL_MS) return ffmpegProbe.ok;

  const ok = await new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (v: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    let child: ChildProcess;
    try {
      child = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    } catch {
      resolve(false); // spawn() itself refused (rare; ENOENT arrives as 'error' below)
      return;
    }
    child.on("error", () => done(false)); // ENOENT / EACCES etc.
    child.on("close", (code) => done(code === 0));
  });

  ffmpegProbe = { ok, ts: Date.now() };
  return ok;
}

/* ------------------------------------------------------------------ */
/* Job registry — jobId -> { dir, createdAt }, 10-minute expiry        */
/* ------------------------------------------------------------------ */

interface RemuxJob {
  dir: string;
  createdAt: number;
}

const jobs = new Map<string, RemuxJob>();
const JOB_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CONCURRENT = 3; // hard cap on live ffmpeg jobs
let active = 0;

/** Drops expired jobs and best-effort rm -rf's their temp dirs. */
function sweepJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt <= JOB_TTL_MS) continue;
    jobs.delete(id);
    void rm(job.dir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* remuxToHls                                                          */
/* ------------------------------------------------------------------ */

const REMUX_TIMEOUT_MS = 25_000; // whole ffmpeg run is bounded; kill on overrun
const SEGMENT_NAME_RE = /^[A-Za-z0-9._-]+$/; // ffmpeg seg%05d.ts output always matches

/**
 * Runs ffmpeg against `sourceUrl` in a private temp dir, waits for EXIT
 * (25s timeout kill), then rewrites the produced index.m3u8 so every
 * segment URI points back at /api/remux/seg?id=<jobId>&n=<basename>.
 * Returns null on ANY failure (bad scheme, saturated, ffmpeg error,
 * timeout, unreadable playlist) — callers must never see a throw.
 *
 * The playlist is served as text/plain deliberately: hls.js-style XHR
 * players parse it fine, and it avoids native-player content-type sniffing.
 */
export async function remuxToHls(
  sourceUrl: string
): Promise<{ playlist: ReadableStream<Uint8Array>; contentType: string } | null> {
  // Scheme check BEFORE anything else — must hold independently of the
  // route's own SSRF guard (file://, data:, ftp: ... never reach spawn).
  let target: URL;
  try {
    target = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;
  if (!remuxEnabled()) return null; // defense-in-depth; route handles 501

  sweepJobs();
  if (active >= MAX_CONCURRENT) return null; // saturated — caller gets null
  active++;

  let dir: string | null = null;
  try {
    dir = await mkdtemp(path.join(tmpdir(), "quasar-remux-"));
    const playlistPath = path.join(dir, "index.m3u8");

    // Required remux args + quiet/non-interactive extras (-nostdin prevents
    // ffmpeg stalling on stdin; argv is used directly, never a shell).
    const args = [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      target.href,
      "-c",
      "copy",
      "-f",
      "hls",
      "-hls_time",
      "4",
      "-hls_list_size",
      "0",
      "-hls_segment_filename",
      path.join(dir, "seg%05d.ts"),
      playlistPath,
    ];

    const { code, stderrTail } = await runFfmpeg(args);
    if (code !== 0) {
      console.warn(
        "[quasar-remux] ffmpeg exited",
        code,
        "for",
        target.hostname,
        stderrTail ? `(tail): ${stderrTail}` : ""
      );
      return null;
    }

    const m3u8 = await readFile(playlistPath, "utf8"); // throws -> catch -> null
    if (!m3u8.trim()) return null;

    const jobId = randomUUID();
    const playlist = rewritePlaylist(m3u8, jobId);
    jobs.set(jobId, { dir, createdAt: Date.now() });
    dir = null; // ownership transferred to the registry (cleaned up on expiry)
    setTimeout(sweepJobs, JOB_TTL_MS + 1_000).unref();

    const bytes = new TextEncoder().encode(playlist);
    return {
      playlist: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      contentType: "text/plain; charset=utf-8",
    };
  } catch {
    return null;
  } finally {
    active--;
    if (dir) void rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Runs one ffmpeg invocation, resolving its exit code (null on signal) and a stderr tail. */
function runFfmpeg(args: string[]): Promise<{ code: number | null; stderrTail: string }> {
  return new Promise((resolve) => {
    let stderrTail = "";
    let settled = false;
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stderrTail });
    };

    let child: ChildProcess;
    try {
      child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (err) {
      resolve({ code: -1, stderrTail: String(err) });
      return;
    }

    const timer = setTimeout(() => child.kill("SIGKILL"), REMUX_TIMEOUT_MS);
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-8192); // bounded
    });
    child.on("error", (err) => {
      stderrTail = (stderrTail + String(err)).slice(-8192);
      finish(-1);
    });
    child.on("close", (code) => finish(code));
  });
}

/**
 * Rewrites every segment URI in an ffmpeg HLS playlist to the seg route.
 * Non-comment, non-empty lines are URIs; only basenames matching the strict
 * segment charset are rewritten (ffmpeg's segNNNNN.ts always qualifies).
 */
function rewritePlaylist(m3u8: string, jobId: string): string {
  const lines = m3u8.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const base = trimmed.split(/[\\/]/).pop() ?? "";
    if (!SEGMENT_NAME_RE.test(base)) return line;
    return `/api/remux/seg?id=${encodeURIComponent(jobId)}&n=${encodeURIComponent(base)}`;
  });
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* serveSegment — strict path safety                                   */
/* ------------------------------------------------------------------ */

/**
 * Serves one segment file from the in-memory job registry. Safety layers:
 *   1. name charset is locked to /^[A-Za-z0-9._-]+$/ and ".." is refused
 *      outright (the charset alone would still admit a literal "..");
 *   2. the lexical path must resolve INSIDE the job dir (path.resolve +
 *      prefix check, never equal to the dir itself);
 *   3. fs.stat must report a regular file, and realpath must still land
 *      inside the job dir — a symlink pointing outside is never followed.
 */
export async function serveSegment(
  jobId: string,
  name: string
): Promise<{ body: Buffer; contentType: string } | null> {
  sweepJobs();
  if (!jobId || !name) return null;
  if (!SEGMENT_NAME_RE.test(name)) return null;
  if (name.includes("..")) return null;

  const job = jobs.get(jobId);
  if (!job) return null;

  const dir = path.resolve(job.dir);
  const filePath = path.resolve(dir, name);
  if (filePath === dir || !filePath.startsWith(dir + path.sep)) return null;

  try {
    const st = await stat(filePath);
    if (!st.isFile()) return null;
    const real = await realpath(filePath); // never follow symlinks outside
    if (real !== dir && !real.startsWith(dir + path.sep)) return null;
    const body = await readFile(filePath);
    return { body, contentType: "video/mp2t" };
  } catch {
    return null;
  }
}
