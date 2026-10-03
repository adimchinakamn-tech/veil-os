/**
 * Veil — the custom wallpaper vault (shared server-side helpers).
 *
 * Owner-uploaded wallpapers live in upload/veil-wallpapers/:
 *   <id>       the media bytes (image or video)
 *   <id>.json  sidecar { name, type, size, kind, poster, at }
 *   <id>.jpg   poster frame for videos (ffmpeg, best effort)
 *
 * Ids are 128-bit base64url — unguessable, so serving is public like the
 * gif cache. The pack list they feed into is site-wide ("My pack" in the
 * gallery), while uploads/deletes are owner-password gated.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

export const VAULT_DIR = path.join(process.cwd(), "upload", "veil-wallpapers");

export interface CustomWallpaper {
  id: string; // "up-<hex>"
  name: string;
  kind: "image" | "video";
  src: string; // /api/wallpapers/file?id=<hex>
  thumb: string | null;
  tags: string[];
  desc: string;
  size: number;
}

interface Sidecar {
  name: string;
  type: string;
  size: number;
  kind: "image" | "video";
  poster?: boolean;
  at: string;
}

/* ── listing (30s cache, busted by upload/delete) ───────────────────── */

let cache: { at: number; list: CustomWallpaper[] } | null = null;

export function bustCustomCache(): void {
  cache = null;
}

function mtimeOf(id: string): number {
  try {
    return statSync(path.join(VAULT_DIR, id)).mtimeMs;
  } catch {
    return 0;
  }
}

export function listCustomWallpapers(): CustomWallpaper[] {
  if (cache && Date.now() - cache.at < 30_000) return cache.list;
  const out: CustomWallpaper[] = [];
  try {
    for (const f of readdirSync(VAULT_DIR)) {
      if (f.startsWith(".") || !f.endsWith(".json")) continue;
      const id = f.slice(0, -5);
      if (!id || !existsSync(path.join(VAULT_DIR, id))) continue;
      try {
        const meta = JSON.parse(readFileSync(path.join(VAULT_DIR, f), "utf8")) as Sidecar;
        if (typeof meta.name !== "string" || (meta.kind !== "image" && meta.kind !== "video")) continue;
        out.push({
          id: `up-${id}`,
          name: meta.name,
          kind: meta.kind,
          src: `/api/wallpapers/file?id=${id}`,
          thumb: meta.poster ? `/api/wallpapers/file?id=${id}&thumb=1` : null,
          tags: ["uploaded"],
          desc: "Uploaded into My pack",
          size: typeof meta.size === "number" ? meta.size : 0,
        });
      } catch {
        /* corrupt sidecar — skip */
      }
    }
  } catch {
    /* no vault yet */
  }
  // Newest uploads first.
  out.sort((a, b) => mtimeOf(b.id.slice(3)) - mtimeOf(a.id.slice(3)));
  cache = { at: Date.now(), list: out };
  return out;
}

/* ── vault size ─────────────────────────────────────────────────────── */

export function vaultBytes(): number {
  try {
    let total = 0;
    for (const f of readdirSync(VAULT_DIR)) {
      if (f.startsWith(".") || f.endsWith(".json") || f.endsWith(".part")) continue;
      try {
        total += statSync(path.join(VAULT_DIR, f)).size;
      } catch {
        /* raced away */
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/* ── video poster (ffmpeg, best effort) ─────────────────────────────── */

/**
 * Grabs the frame at ~1s scaled to 640px wide. 12s hard timeout; failure
 * just means no poster (cards fall back to the video itself).
 */
export function makePoster(file: string, poster: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-ss", "1", "-i", file,
      "-frames:v", "1",
      "-vf", "scale=640:-2",
      "-q:v", "4",
      "-y", poster,
    ]);
    let settled = false;
    const done = (good: boolean) => {
      if (settled) return;
      settled = true;
      resolve(good && existsSync(poster));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done(false);
    }, 12_000);
    child.on("error", () => {
      clearTimeout(timer);
      done(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done(code === 0);
    });
  });
}
