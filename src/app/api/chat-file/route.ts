import { NextRequest, NextResponse } from "next/server";
import { createWriteStream, existsSync, statSync, readdirSync, unlinkSync, renameSync, readFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { getAccountFromToken } from "@/lib/chat-auth";
import { cors, corsOptions } from "@/lib/veil/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Veil — chat file attachments (up to 300 MB).
 *
 * POST /api/chat-file?token=…&name=…&type=…
 *   Raw octet-stream body → stored to upload/veil-chat-files/<id> with a
 *   <id>.json sidecar (name/type/size/owner). STREAMED to disk — a 300 MB
 *   video never sits in memory. Requires a chat token.
 *
 * GET  /api/chat-file?id=…[&download=1]
 *   Serves the bytes with the recorded content type: images/video/audio/
 *   pdf play INLINE (bubbles render them), everything else downloads.
 *   Single-range requests honored (video seeking). Public but the ids
 *   are 128-bit random — same model as the gif cache.
 *
 * CORS-open (Origin: null from the single-file build) — same hatch the
 * other chat routes use.
 *
 * Housekeeping: the vault is capped (~1.2 GB) — uploads past the cap
 * evict the OLDEST files first (with their sidecars), and the folder is
 * excluded from the backup snapshots (chat files are re-uploadable;
 * the messages themselves live in the DB, which is backed up).
 */

const MAX_BYTES = 300 * 1024 * 1024; // 300 MB per file
const VAULT_CAP = 1.2 * 1024 * 1024 * 1024; // total vault size before eviction
const DIR = path.join(process.cwd(), "upload", "veil-chat-files");

const INLINE_TYPES = /^(image|video|audio)\/|^application\/pdf$/i;

function ok(data: Record<string, unknown>, status = 200): Response {
  return cors(NextResponse.json({ ok: true, ...data }, { status }));
}
function fail(error: string, status: number): Response {
  return cors(NextResponse.json({ ok: false, error }, { status }));
}

export async function OPTIONS(): Promise<Response> {
  return corsOptions();
}

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const q = req.nextUrl.searchParams;
    const token = q.get("token") || "";
    const account = await getAccountFromToken(token);
    if (!account) {
      return fail("Invalid or expired token.", 401);
    }

    // The declared size (clients always set it) — reject before touching disk.
    const declared = Number(req.headers.get("content-length") || "0");
    if (declared > MAX_BYTES) {
      return fail("That file is over the 300 MB limit.", 413);
    }

    const name = (q.get("name") || "file").replace(/[\\/]+/g, "_").trim().slice(0, 120) || "file";
    let type = (q.get("type") || "").trim().slice(0, 120);
    if (type && !/^[\w.+-]+\/[\w.+-]+$/.test(type)) type = "";
    if (!type) {
      // guess from the extension so inline rendering works even when the
      // browser lost the mime (drag-drop sometimes does)
      const ext = path.extname(name).toLowerCase();
      const guess: Record<string, string> = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
        ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
        ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
        ".pdf": "application/pdf", ".txt": "text/plain", ".json": "application/json",
      };
      type = guess[ext] || "application/octet-stream";
    }

    if (!req.body) {
      return fail("No file bytes in the request.", 400);
    }

    await mkdir(DIR, { recursive: true });
    sweepStaleParts();

    /* ---- Chunked mode (sid + chunk + chunks + size, final=1 on the last) ----
     * Some fronting proxies cap request bodies at ~1 MB, which killed any
     * upload bigger than a screenshot. The client slices big files into
     * 512 KB pieces; we append them to .<sid>.part and finalize when the
     * last slice lands. Small files still use the single-shot path. */
    const sid = (q.get("sid") || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (sid) {
      if (sid.length < 8 || sid.length > 80) return fail("Bad upload session id.", 400);
      const chunkIdx = Number(q.get("chunk") || "0");
      const chunkTotal = Number(q.get("chunks") || "0");
      const totalSize = Number(q.get("size") || "0");
      const isFinal = q.get("final") === "1";
      if (
        !Number.isInteger(chunkIdx) || chunkIdx < 0 ||
        !Number.isInteger(chunkTotal) || chunkTotal < 1 || chunkTotal > 100000 ||
        chunkIdx >= chunkTotal ||
        !Number.isFinite(totalSize) || totalSize < 1 || totalSize > MAX_BYTES
      ) {
        return fail("Bad chunk parameters.", 400);
      }

      const part = path.join(DIR, `.${sid}.part`);
      const already = existsSync(part) ? statSync(part).size : 0;
      // Chunks must arrive in order: chunk i may only land when the part
      // file holds all previous slices. (512 KB granularity, last slice may
      // be shorter — the exact byte count is verified at finalize.)
      if (already > totalSize) {
        await rm(part, { force: true });
        return fail("Upload session corrupted — restart the upload.", 400);
      }

      const out = createWriteStream(part, { flags: chunkIdx === 0 ? "w" : "a" });
      let total = already;
      let overCap = false;
      try {
        const reader = req.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_BYTES) {
            overCap = true;
            break;
          }
          if (!out.write(value)) await once(out, "drain");
        }
      } finally {
        await new Promise<void>((resolve) => out.end(() => resolve()));
      }
      if (overCap) {
        await rm(part, { force: true });
        return fail("That file is over the 300 MB limit.", 413);
      }
      if (total === 0) {
        await rm(part, { force: true });
        return fail("Empty file.", 400);
      }

      if (!isFinal) {
        return ok({ pending: true, received: total });
      }

      // Finalize: the assembled size must match the declared total exactly.
      const assembled = statSync(part).size;
      if (assembled !== totalSize) {
        await rm(part, { force: true });
        return fail(`Upload incomplete (${assembled} of ${totalSize} bytes) — try again.`, 400);
      }
      const id = randomBytes(16).toString("base64url");
      renameSync(part, path.join(DIR, id));
      const sidecar = { name, type, size: assembled, by: account.username, at: new Date().toISOString() };
      await writeFile(path.join(DIR, `${id}.json`), JSON.stringify(sidecar), "utf8");
      evictOldest();
      return ok({ file: { id, name, type, size: assembled } });
    }

    /* ---- Single-shot mode (unchanged behavior) ---- */
    const id = randomBytes(16).toString("base64url");
    const tmp = path.join(DIR, `.${id}.part`);
    const finalPath = path.join(DIR, id);

    // stream: reader → file, byte-capped
    const out = createWriteStream(tmp);
    let total = 0;
    let aborted = false;
    try {
      const reader = req.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) {
          aborted = true;
          break;
        }
        if (!out.write(value)) await once(out, "drain");
      }
    } finally {
      await new Promise<void>((resolve) => out.end(() => resolve()));
    }
    if (aborted || total === 0) {
      await rm(tmp, { force: true });
      return fail(aborted ? "That file is over the 300 MB limit." : "Empty file.", aborted ? 413 : 400);
    }

    renameSync(tmp, finalPath);
    const sidecar = { name, type, size: total, by: account.username, at: new Date().toISOString() };
    await writeFile(path.join(DIR, `${id}.json`), JSON.stringify(sidecar), "utf8");

    evictOldest();

    return ok({ file: { id, name, type, size: total } });
  } catch (err) {
    console.error("[chat-file] upload error", err);
    return fail("Upload failed — try again.", 500);
  }
}

/** Delete abandoned chunked-upload parts older than 2 hours (dead tabs,
 *  network drops) so the vault never fills with orphans. */
function sweepStaleParts(): void {
  try {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const f of readdirSync(DIR)) {
      if (!f.startsWith(".") || !f.endsWith(".part")) continue;
      try {
        const st = statSync(path.join(DIR, f));
        if (st.mtimeMs < cutoff) unlinkSync(path.join(DIR, f));
      } catch {
        /* raced away */
      }
    }
  } catch {
    /* dir may not exist yet */
  }
}

/* ------------------------------------------------------------------ */
/* Serve                                                               */
/* ------------------------------------------------------------------ */

interface Sidecar {
  name: string;
  type: string;
  size: number;
  by?: string;
  at?: string;
}

function loadMeta(id: string): Sidecar | null {
  try {
    const raw = readFileSync(path.join(DIR, `${id}.json`), "utf8");
    const m = JSON.parse(raw) as Sidecar;
    if (typeof m.name !== "string" || typeof m.size !== "number") return null;
    return { name: m.name, type: m.type || "application/octet-stream", size: m.size, by: m.by, at: m.at };
  } catch {
    return null;
  }
}

/** Content-Disposition: inline for things the bubble can render. */
function disposition(meta: Sidecar, download: boolean): string {
  const inline = !download && INLINE_TYPES.test(meta.type);
  const fn = encodeURIComponent(meta.name).replace(/['\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename*=UTF-8''${fn}`;
}

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const id = (req.nextUrl.searchParams.get("id") || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (id.length < 16 || id.length > 64) return fail("No such file.", 404);
    const meta = loadMeta(id);
    const file = path.join(DIR, id);
    if (!meta || !existsSync(file)) return fail("No such file.", 404);

    const size = statSync(file).size;
    const download = req.nextUrl.searchParams.get("download") === "1";
    const baseHeaders: Record<string, string> = {
      "Content-Type": meta.type,
      "Content-Disposition": disposition(meta, download),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    };

    // single-range support (video seeking)
    const rangeHeader = req.headers.get("range");
    if (rangeHeader) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (m) {
        const start = m[1] === "" ? 0 : Number(m[1]);
        const end = Math.min(m[2] === "" ? size - 1 : Number(m[2]), size - 1);
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
          return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
        }
        const stream = createReadStream(file, { start, end });
        const res = new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
          status: 206,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Content-Length": String(end - start + 1),
          },
        });
        return cors(res);
      }
    }

    const stream = createReadStream(file);
    const res = new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 200,
      headers: { ...baseHeaders, "Content-Length": String(size) },
    });
    return cors(res);
  } catch (err) {
    console.error("[chat-file] serve error", err);
    return fail("Could not read that file.", 500);
  }
}

/* ------------------------------------------------------------------ */
/* Vault eviction (oldest first, ~1.2 GB cap)                          */
/* ------------------------------------------------------------------ */

function evictOldest(): void {
  try {
    const entries = readdirSync(DIR).filter((f) => !f.startsWith(".") && !f.endsWith(".json") && !f.endsWith(".part"));
    let total = 0;
    const files: { name: string; size: number; mtime: number }[] = [];
    for (const f of entries) {
      try {
        const st = statSync(path.join(DIR, f));
        total += st.size;
        files.push({ name: f, size: st.size, mtime: st.mtimeMs });
      } catch {
        /* raced away */
      }
    }
    if (total <= VAULT_CAP) return;
    files.sort((a, b) => a.mtime - b.mtime);
    for (const f of files) {
      if (total <= VAULT_CAP) break;
      try {
        unlinkSync(path.join(DIR, f.name));
        unlinkSync(path.join(DIR, `${f.name}.json`));
        total -= f.size;
      } catch {
        /* best effort */
      }
    }
  } catch {
    /* the vault dir may not exist yet */
  }
}
