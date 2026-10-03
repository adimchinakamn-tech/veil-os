import { NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { VAULT_DIR, readMeta, vaultFileExists } from "@/lib/veil/ai-attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Veil — serve AI attachment bytes.
 *
 *   GET /api/ai-attachments/file?id=<base64url>
 *
 * Streams the stored file with its recorded content type, immutable
 * caching and single-range support (video/audio attachments can seek).
 * Public — ids are 128-bit random.
 */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    const id = (req.nextUrl.searchParams.get("id") || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (id.length < 16 || id.length > 64) {
      return NextResponse.json({ ok: false, error: "No such attachment." }, { status: 404 });
    }
    const file = path.join(VAULT_DIR, id);
    if (!vaultFileExists(id)) {
      return NextResponse.json({ ok: false, error: "No such attachment." }, { status: 404 });
    }
    const meta = readMeta(id);
    const type = meta?.type || "application/octet-stream";
    const size = statSync(file).size;
    const name = (meta?.name || "file").replace(/["\\\r\n]/g, "_");

    const baseHeaders: Record<string, string> = {
      "Content-Type": type,
      "Content-Disposition": `inline; filename="${name}"`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    };

    const rangeHeader = req.headers.get("range");
    if (rangeHeader) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (m) {
        const start = m[1] === "" ? 0 : Number(m[1]);
        const end = Math.min(m[2] === "" ? size - 1 : Number(m[2]), size - 1);
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${size}` },
          });
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
    console.error("[ai-attachments file GET]", err);
    return NextResponse.json({ ok: false, error: "Attachment read failed." }, { status: 500 });
  }
}
