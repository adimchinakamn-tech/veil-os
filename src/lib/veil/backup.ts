/**
 * Veil — full-device backup engine (Takeout for EVERYTHING).
 *
 * History: the old export only shipped the `veil.stream.*` family, so a
 * backup silently lost the wallpaper (selection + ♥ favorites + saved
 * live/4K library), the core settings, the start-page layout & links,
 * arcade favourites and every `veil:*` preference (clock, units, search
 * engine, hover previews, backdrop dim, greeting, panic / cloak keys…).
 * Users exported "it", wiped or moved browsers, imported "it" — and
 * nothing came back. (AI conversations are sessionStorage by design —
 * session-scoped — so they stay outside the device backup.)
 *
 * This module owns the FULL device backup:
 *
 *   export → { format: "veil.backup.v2", exportedAt, keys: { …raw strings } }
 *            every localStorage key Veil owns (`veil.*` + `veil:*`), values
 *            exactly as on disk, so the file imports on any browser.
 *
 *   import → accepts BOTH this v2 envelope AND the legacy flat
 *            { "veil.stream.x": "…" } map (old exports keep working).
 *            Stream collections keep their merge-by-id semantics (delegated
 *            to importStreamDataMap); wallpaper favs/library union by id;
 *            everything else replaces wholesale — then the change events
 *            fire so the live UI snaps to the restored state.
 *
 * All writes are size-capped and try/catch'd — a corrupt value can never
 * abort the whole restore.
 */

import { importStreamDataMap, type StreamImportSummary } from "@/components/veil/stream-section";

export const BACKUP_FORMAT = "veil.backup.v2";

/** Every localStorage key Veil owns is namespaced `veil.` or `veil:`. */
const VEIL_KEY_RE = /^veil[.:]/;
const STREAM_PREFIX = "veil.stream.";
/** Defensive ceiling per value — no legit Veil value approaches this. */
const MAX_VALUE_CHARS = 2 * 1024 * 1024;

/* ── Export ─────────────────────────────────────────────────────────── */

export interface VeilBackupFile {
  format: typeof BACKUP_FORMAT;
  app: "Veil";
  exportedAt: string;
  keys: Record<string, string>;
}

/** Collect every Veil localStorage entry as { key: rawString }. */
export function exportVeilBackup(): VeilBackupFile {
  const keys: Record<string, string> = {};
  if (typeof window !== "undefined") {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && VEIL_KEY_RE.test(k)) keys[k] = window.localStorage.getItem(k) ?? "";
    }
  }
  return {
    format: BACKUP_FORMAT,
    app: "Veil",
    exportedAt: new Date().toISOString(),
    keys,
  };
}

/* ── Stats (the Data card chips) ────────────────────────────────────── */

export interface VeilBackupStats {
  totalKeys: number;
  history: number;
  subs: number;
  playlists: number;
  liked: number;
  wallpaperSet: boolean;
  wallpaperFavs: number;
  savedWallpapers: number;
  prefs: number;
  links: number;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** One-glance count of everything the backup will carry. */
export function veilBackupStats(): VeilBackupStats {
  let totalKeys = 0;
  let prefs = 0;
  let wallpaperSet = false;
  if (typeof window !== "undefined") {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !VEIL_KEY_RE.test(k)) continue;
      totalKeys++;
      if (k.startsWith(STREAM_PREFIX)) continue;
      if (k === "veil.wallpaper") {
        wallpaperSet = !!window.localStorage.getItem(k);
        continue;
      }
      prefs++;
    }
  }
  const stream = readJson<{ history?: unknown[]; subs?: object; playlists?: unknown[] }>(
    "veil.stream.history.v1",
    {},
  );
  const subs = readJson<Record<string, unknown>>("veil.stream.subs.v1", {});
  const playlists = readJson<unknown[]>("veil.stream.playlists.v1", []);
  const ratings = readJson<Record<string, string>>("veil.stream.ratings.v1", {});
  const favs = readJson<string[]>("veil.wallpaper.favs", []);
  const lib = readJson<unknown[]>("veil.wallpaper.library", []);
  const links = readJson<unknown[]>("veil:links:v1", []);
  return {
    totalKeys,
    history: Array.isArray(stream) ? stream.length : 0,
    subs: Object.keys(subs ?? {}).length,
    playlists: Array.isArray(playlists) ? playlists.length : 0,
    liked: Object.values(ratings).filter((r) => r === "like").length,
    wallpaperSet,
    wallpaperFavs: Array.isArray(favs) ? favs.length : 0,
    savedWallpapers: Array.isArray(lib) ? lib.length : 0,
    prefs,
    links: Array.isArray(links) ? links.length : 0,
  };
}

/* ── Import ─────────────────────────────────────────────────────────── */

export interface BackupImportSummary {
  /** Stream-family result (history/subs/playlists/liked/prefs/notInterested). */
  stream: StreamImportSummary;
  /** The applied wallpaper selection came back. */
  wallpaper: boolean;
  /** ♥-ed wallpaper pack ids restored (merged count). */
  wallpaperFavs: number;
  /** Saved live/4K wallpaper cards restored (merged count). */
  savedWallpapers: number;
  /** Non-stream keys restored (settings, prefs, links, arcade, AI, chat…). */
  restoredKeys: number;
  /** Total Veil keys now on this device. */
  totalKeys: number;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Merge a Veil backup (v2 envelope or legacy flat stream map) into this
 *  device. Stream collections merge by id — nothing is deleted; the
 *  wallpaper selection, settings and every preference replace wholesale
 *  (that IS their state); ♥ favorites and the saved library union by id.
 *  Fires every change event so panels update without a reload. */
export function importVeilBackup(raw: string): BackupImportSummary {
  const parsed: unknown = JSON.parse(raw);
  if (!isPlainObject(parsed)) {
    throw new Error("not a Veil backup — expected a JSON object");
  }

  /* v2 envelope { format, keys } — or legacy flat { "veil.x": "…" } map. */
  let map: Record<string, unknown>;
  if (parsed.format === BACKUP_FORMAT && isPlainObject(parsed.keys)) {
    map = parsed.keys;
  } else if (Object.keys(parsed).length > 0 && Object.keys(parsed).every((k) => VEIL_KEY_RE.test(k))) {
    map = parsed;
  } else {
    throw new Error("not a Veil backup — no Veil data keys found in this file");
  }

  /* 1 — stream family: reuse the battle-tested merge-by-id importer. */
  const streamKeys: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (k.startsWith(STREAM_PREFIX)) streamKeys[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  let stream: StreamImportSummary = { history: 0, subs: 0, playlists: 0, liked: 0, prefs: false };
  if (Object.keys(streamKeys).length > 0) {
    stream = importStreamDataMap(JSON.stringify(streamKeys));
  }

  /* 2 — everything else. */
  const summary: BackupImportSummary = {
    stream,
    wallpaper: false,
    wallpaperFavs: 0,
    savedWallpapers: 0,
    restoredKeys: 0,
    totalKeys: 0,
  };
  const ping = (event: string) => window.dispatchEvent(new Event(event));

  const writeRaw = (key: string, value: string): boolean => {
    if (value.length > MAX_VALUE_CHARS) return false;
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };

  for (const [k, v] of Object.entries(map)) {
    if (!VEIL_KEY_RE.test(k) || k.startsWith(STREAM_PREFIX)) continue;
    const rawStr = typeof v === "string" ? v : JSON.stringify(v);
    if (!rawStr || rawStr.length > MAX_VALUE_CHARS) continue;

    switch (k) {
      /* applied wallpaper — validate shape, replace, announce */
      case "veil.wallpaper": {
        const sel = safeParse(rawStr);
        if (
          isPlainObject(sel) &&
          typeof sel.id === "string" &&
          typeof sel.kind === "string" &&
          ["image", "video", "animated"].includes(sel.kind) &&
          writeRaw(k, rawStr)
        ) {
          summary.wallpaper = true;
          summary.restoredKeys++;
          ping("veil:wallpaper-changed");
        }
        break;
      }

      /* ♥ favorites — union of ids */
      case "veil.wallpaper.favs": {
        const ids = safeParse(rawStr);
        if (Array.isArray(ids)) {
          const cur = new Set(
            Array.isArray(safeParse(window.localStorage.getItem(k) ?? ""))
              ? ((safeParse(window.localStorage.getItem(k) ?? "") as unknown[]) ?? []).filter(
                  (x): x is string => typeof x === "string",
                )
              : [],
          );
          for (const id of ids) if (typeof id === "string") cur.add(id);
          if (writeRaw(k, JSON.stringify([...cur]))) {
            summary.wallpaperFavs = cur.size;
            summary.restoredKeys++;
            ping("veil:wallpaper-favs-changed");
          }
        }
        break;
      }

      /* saved live/4K cards — union by id, imported first */
      case "veil.wallpaper.library": {
        const list = safeParse(rawStr);
        if (Array.isArray(list)) {
          const cur = Array.isArray(safeParse(window.localStorage.getItem(k) ?? ""))
            ? ((safeParse(window.localStorage.getItem(k) ?? "") as unknown[]) ?? [])
            : [];
          const seen = new Set(
            cur
              .filter(isPlainObject)
              .map((s) => (typeof s.id === "string" ? s.id : ""))
              .filter(Boolean),
          );
          const merged = [...cur];
          for (const s of list) {
            if (isPlainObject(s) && typeof s.id === "string" && !seen.has(s.id)) {
              merged.push(s);
              seen.add(s.id);
            }
          }
          if (writeRaw(k, JSON.stringify(merged.slice(0, 60)))) {
            summary.savedWallpapers = merged.length;
            summary.restoredKeys++;
            ping("veil:wallpaper-library-changed");
          }
        }
        break;
      }

      /* chat sign-in — light shape check, replace, announce (the chat app
       * re-verifies with the server on its next 10-min tick / reload) */
      case "veil:chat-account": {
        const acc = safeParse(rawStr);
        if (isPlainObject(acc) && isPlainObject(acc.account) && writeRaw(k, rawStr)) {
          summary.restoredKeys++;
          ping("veil:chat-account-updated");
        }
        break;
      }

      /* core settings / prefs / links / arcade / AI chats / layout /
       * viewer / panic+cloak / tabs — replace wholesale when present. */
      default: {
        if (writeRaw(k, rawStr)) {
          summary.restoredKeys++;
          if (k === "veil.settings") ping("veil:settings-changed");
          else if (k === "veil.start.layout.v1") ping("veil:layout-changed");
        }
      }
    }
  }

  if (typeof window !== "undefined") {
    let n = 0;
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && VEIL_KEY_RE.test(k)) n++;
    }
    summary.totalKeys = n;
  }
  return summary;
}

/** Human summary of a restore, e.g. "wallpaper · 12 history · 3 subs ·
 *  14 settings" — used by both import surfaces (Data card + Stream menu). */
export function describeRestore(s: BackupImportSummary): string {
  const bits: string[] = [];
  if (s.wallpaper) bits.push("wallpaper");
  if (s.wallpaperFavs) bits.push(`${s.wallpaperFavs} wallpaper ♥`);
  if (s.savedWallpapers) bits.push(`${s.savedWallpapers} saved wallpaper${s.savedWallpapers === 1 ? "" : "s"}`);
  if (s.stream.history) bits.push(`${s.stream.history} history`);
  if (s.stream.subs) bits.push(`${s.stream.subs} subscription${s.stream.subs === 1 ? "" : "s"}`);
  if (s.stream.playlists) bits.push(`${s.stream.playlists} playlist${s.stream.playlists === 1 ? "" : "s"}`);
  if (s.stream.liked) bits.push(`${s.stream.liked} liked`);
  if (s.stream.notInterested) bits.push(`${s.stream.notInterested} hidden`);
  if (s.restoredKeys) bits.push(`${s.restoredKeys} setting/link key${s.restoredKeys === 1 ? "" : "s"}`);
  return bits.join(" · ");
}
