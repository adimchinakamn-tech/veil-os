/**
 * Veil — AI attachment vault (shared helpers).
 *
 * Files attached in Veil AI conversations (the assistant section and the
 * Updates › Veil AI operator thread) live here: raw bytes under
 * upload/ai-attachments/<id> with a <id>.json sidecar recording the
 * original name, mime and size. Serving goes through
 * /api/ai-attachments/file?id=… (public — ids are 128-bit random).
 *
 * The vault is capped at 2 GB total; the upload route evicts the OLDEST
 * files first when a new upload would cross the cap. Attachments are
 * conversation context, not forever-storage — a dev request that
 * references a file keeps working for days, not months.
 */

import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const VAULT_DIR = path.join(process.cwd(), "upload", "ai-attachments");

export const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB per file
export const VAULT_CAP = 2 * 1024 * 1024 * 1024; // 2 GB total

export interface AttachmentMeta {
  name: string;
  type: string;
  size: number;
  createdAt?: number;
}

/** Total bytes currently in the vault (0 when missing). */
export function vaultBytes(): number {
  try {
    let total = 0;
    for (const f of readdirSync(VAULT_DIR)) {
      if (f.startsWith(".")) continue;
      try {
        total += statSync(path.join(VAULT_DIR, f)).size;
      } catch {
        /* raced delete */
      }
    }
    return total;
  } catch {
    return 0;
  }
}

/** Oldest-first vault entries (id + bytes + mtime) for eviction. */
export function vaultEntriesOldestFirst(): { id: string; bytes: number; mtime: number }[] {
  try {
    const out: { id: string; bytes: number; mtime: number }[] = [];
    for (const f of readdirSync(VAULT_DIR)) {
      if (!/^[A-Za-z0-9_-]{16,64}$/.test(f)) continue;
      try {
        const st = statSync(path.join(VAULT_DIR, f));
        out.push({ id: f, bytes: st.size, mtime: st.mtimeMs });
      } catch {
        /* raced delete */
      }
    }
    return out.sort((a, b) => a.mtime - b.mtime);
  } catch {
    return [];
  }
}

/** Read a sidecar, tolerating missing/corrupt files. */
export function readMeta(id: string): AttachmentMeta | null {
  try {
    const raw = readFileSync(path.join(VAULT_DIR, `${id}.json`), "utf8");
    const m = JSON.parse(raw) as Partial<AttachmentMeta>;
    return {
      name: typeof m.name === "string" && m.name ? m.name : "file",
      type: typeof m.type === "string" && m.type ? m.type : "application/octet-stream",
      size: Number(m.size) || 0,
      createdAt: Number(m.createdAt) || undefined,
    };
  } catch {
    return null;
  }
}

/** A sane mime from a filename extension when the browser lost it. */
export function mimeFromName(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif",
    ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm",
    ".mov": "video/quicktime", ".mkv": "video/x-matroska",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
    ".pdf": "application/pdf", ".zip": "application/zip",
    ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv",
    ".json": "application/json", ".js": "text/javascript", ".ts": "text/plain",
    ".tsx": "text/plain", ".html": "text/html", ".css": "text/css",
    ".py": "text/plain", ".xml": "application/xml", ".yml": "text/plain",
    ".yaml": "text/plain", ".sh": "text/plain",
  };
  return map[ext] || "";
}

/** Inline-able text file? (content rides in the prompt itself) */
export function isTextLike(name: string, type: string): boolean {
  if (/^text\//i.test(type)) return true;
  if (/json|javascript|xml|csv|yaml/i.test(type)) return true;
  return /\.(txt|md|markdown|csv|json|js|mjs|cjs|ts|tsx|jsx|html?|css|py|rb|go|rs|java|c|h|cpp|hpp|sh|bash|zsh|yml|yaml|toml|ini|cfg|log|sql|env)$/i.test(name);
}

export function vaultPath(id: string): string {
  return path.join(VAULT_DIR, id);
}

export function vaultFileExists(id: string): boolean {
  return existsSync(vaultPath(id));
}
