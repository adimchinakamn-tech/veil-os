import { NextRequest, NextResponse } from "next/server";
import { existsSync, statSync, readFileSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { VAULT_DIR } from "@/lib/veil/custom-wallpapers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Veil — serve custom wallpaper bytes.
 *
 *   GET /api/wallpapers/file?id=<hex>[&thumb=1]
 *
 * Streams the media (or the ffmpeg poster with &thumb=1) with the recorded
 * content type, immutable caching and single-range support so applied video
 * wallpapers can seek. Public — ids are 128-bit random, same model as the
 * chat file vault and the gif cache.
 */

function loadMeta(id: string): { type: string; name: string } | null {
  try {
    const raw = readFileSync(path.join(VAULT_DIR, `${id}.json`), "utf8");
    const m = JSON.parse(raw) as { name?: string; type?: string };
    return { type: m.type || "application/octet-stream", name: m.name || "wallpaper" };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  try {
    const id = (req.nextUrl.searchParams.get("id") || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (id.length < 16 || id.length > 64) {
      return NextResponse.json({ ok: false, error: "No such wallpaper." }, { status: 404 });
    }
    const thumb = req.nextUrl.searchParams.get("thumb") === "1";
    const file = thumb ? path.join(VAULT_DIR, `${id}.jpg`) : path.join(VAULT_DIR, id);
    if (!existsSync(file)) {
      return NextResponse.json({ ok: false, error: "No such wallpaper." }, { status: 404 });
    }
    const meta = loadMeta(id);
    const type = thumb ? "image/jpeg" : meta?.type || "application/octet-stream";
    const size = statSync(file).size;
    const name = (meta?.name || "wallpaper").replace(/["\\\r\n]/g, "_");

    const baseHeaders: Record<string, string> = {
      "Content-Type": type,
      "Content-Disposition": `inline; filename="${name}"`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    };

    // Single-range support (video seeking / scrubbing).
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
        return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
          status: 206,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Content-Length": String(end - start + 1),
          },
        });
      }
    }

    const stream = createReadStream(file);
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 200,
      headers: { ...baseHeaders, "Content-Length": String(size) },
    });
  } catch (err) {
    console.error("[wallpapers/file] serve error", err);
    return NextResponse.json({ ok: false, error: "Could not read that wallpaper." }, { status: 500 });
  }
}
