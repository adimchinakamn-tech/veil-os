import { NextRequest, NextResponse } from "next/server";
import { createWriteStream, unlinkSync, renameSync } from "node:fs";
import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { ownerPasswordOk } from "@/lib/veil/owner-auth";
import { VAULT_DIR, vaultBytes, makePoster, bustCustomCache } from "@/lib/veil/custom-wallpapers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Veil — custom wallpaper uploads ("My pack → Add yours").
 *
 *   POST /api/wallpapers/upload?password=…&name=…&type=…
 *     Raw octet-stream body → upload/veil-wallpapers/<id> + <id>.json
 *     sidecar. Owner-password gated (the pack is the site's shared pack).
 *     Images (png/jpg/webp/gif/avif) and videos (mp4/webm/mov/mkv) only,
 *     up to 300 MB, streamed to disk — a 300 MB video never sits in
 *     memory. Videos get an ffmpeg poster frame so the grid card paints
 *     instantly like the built-ins.
 *
 * The vault is capped at 3 GB total (owner deletable, never auto-evicted —
 * an applied wallpaper must never vanish under the backdrop).
 */

const MAX_BYTES = 300 * 1024 * 1024; // 300 MB per file
const VAULT_CAP = 3 * 1024 * 1024 * 1024; // 3 GB total

const IMAGE_TYPES = /^image\/(png|jpeg|jpg|webp|gif|avif)$/i;
const VIDEO_TYPES = /^video\/(mp4|webm|quicktime|x-matroska)$/i;

const EXT_GUESS: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif",
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm",
  ".mov": "video/quicktime", ".mkv": "video/x-matroska",
};

function ok(data: Record<string, unknown>, status = 200): Response {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function fail(error: string, status: number): Response {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const q = req.nextUrl.searchParams;
    if (!(await ownerPasswordOk(q.get("password")))) {
      return fail("Wrong owner password.", 403);
    }

    // Reject before touching disk when the vault is already full.
    if (vaultBytes() > VAULT_CAP) {
      return fail(
        "The wallpaper vault is full (3 GB). Delete some uploads in My pack first.",
        507,
      );
    }

    const declared = Number(req.headers.get("content-length") || "0");
    if (declared > MAX_BYTES) {
      return fail("That file is over the 300 MB limit.", 413);
    }

    const name = (q.get("name") || "wallpaper").replace(/[\\/]+/g, "_").trim().slice(0, 120) || "wallpaper";
    let type = (q.get("type") || "").trim().slice(0, 120);
    if (type && !/^[\w.+-]+\/[\w.+-]+$/.test(type)) type = "";
    if (!type) type = EXT_GUESS[path.extname(name).toLowerCase()] || "";

    let kind: "image" | "video" | null = IMAGE_TYPES.test(type)
      ? "image"
      : VIDEO_TYPES.test(type)
        ? "video"
        : null;
    // Browsers sometimes lose the mime on drag-drop — the extension decides.
    if (!kind) {
      const ext = path.extname(name).toLowerCase();
      const guessed = EXT_GUESS[ext] || "";
      if (IMAGE_TYPES.test(guessed)) {
        type = guessed;
        kind = "image";
      } else if (VIDEO_TYPES.test(guessed)) {
        type = guessed;
        kind = "video";
      } else {
        return fail(
          "Wallpapers must be images (png/jpg/webp/gif/avif) or videos (mp4/webm/mov/mkv).",
          415,
        );
      }
    }

    if (!req.body) return fail("No file bytes in the request.", 400);

    await mkdir(VAULT_DIR, { recursive: true });
    const id = randomBytes(16).toString("base64url");
    const tmp = path.join(VAULT_DIR, `.${id}.part`);
    const finalPath = path.join(VAULT_DIR, id);

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

    // Videos get a poster frame so the card paints instantly.
    let poster = false;
    if (kind === "video") {
      poster = await makePoster(finalPath, path.join(VAULT_DIR, `${id}.jpg`));
      if (!poster) {
        try {
          unlinkSync(path.join(VAULT_DIR, `${id}.jpg`));
        } catch {
          /* nothing to clean */
        }
      }
    }

    const pretty =
      name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim().slice(0, 60) || "My wallpaper";
    const sidecar = {
      name: pretty,
      type,
      size: total,
      kind,
      poster,
      at: new Date().toISOString(),
    };
    await writeFile(path.join(VAULT_DIR, `${id}.json`), JSON.stringify(sidecar), "utf8");
    bustCustomCache();

    return ok({
      wallpaper: {
        id: `up-${id}`,
        name: pretty,
        kind,
        src: `/api/wallpapers/file?id=${id}`,
        thumb: poster ? `/api/wallpapers/file?id=${id}&thumb=1` : null,
        tags: ["uploaded"],
        desc: "Uploaded into My pack",
        size: total,
      },
    });
  } catch (err) {
    console.error("[wallpapers/upload] error", err);
    return fail("Upload failed — try again.", 500);
  }
}
