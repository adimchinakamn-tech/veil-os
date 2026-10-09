/**
 * Veil — shared Google Takeout parsers (client-safe: no node imports).
 *
 * Used by BOTH the browser import flow (streaming extraction — big
 * archives never leave the device) and the /api/yt/takeout fallback
 * route. Owns:
 *   - the file-name matchers that decide what an archive entry IS
 *   - the My Activity watch-history.json parser (compact rows)
 *   - the watch-history.html parser (Google's OTHER history shape —
 *     a 50MB+ HTML activity log; parsed either whole or STREAMING in
 *     chunks, because the real thing is far too big to hold as text)
 *   - row merging (dedupe by video, newest first, capped)
 *
 * Wire shape (compact keys — a decade of history rides this):
 *   { id, t, c?, cid?, at? }
 */

/** Compact watch-history row. */
export interface TakeoutHistoryRow {
  /** video id (from the watch?v= param) */
  id: string;
  /** video title ("Watched " prefix already stripped) */
  t: string;
  /** channel display name */
  c?: string;
  /** channel id (UC…) */
  cid?: string;
  /** watched-at time (unix ms) — 0 when Google didn't stamp it */
  at?: number;
}

/** how many rows an import keeps (newest first). Effectively unlimited —
 * a full YouTube Takeout history imports whole; the client's IndexedDB
 * history store caps at HISTORY_CAP = 1,000,000 rows and trims oldest.
 * Byte caps in the extract layer bound the input size, so this is just
 * the row-level paranoia ceiling. (2026-10-07 "stream history should be
 * infinite max 1,000,000", re-confirmed 2026-10-09 "MAKEIT 1 MILLION".) */
export const MAX_HISTORY_ROWS = 1_000_000;

/* ------------------------------------------------------------------ */
/* file-name matchers                                                  */
/* ------------------------------------------------------------------ */

/** subscriptions.csv / subscriptions.json — wherever Google nested it. */
export const SUBS_FILE_RE = /(^|\/)[^/]*subscri[^/]*\.(csv|json)$/i;
/** any csv/json (fallback candidate pool for the subs parse). */
export const ANY_TEXT_RE = /(^|\/)[^/]*\.(csv|json)$/i;
/** My Activity JSON history (watch-history.json). */
export const HISTORY_JSON_RE = /(^|\/)[^/]*watch[-_]?history[^/]*\.json$/i;
/** My Activity HTML history (watch-history.html — the OTHER shape
 * Google exports; heavy watchers carry 50MB+ of it). */
export const HISTORY_HTML_RE = /(^|\/)[^/]*watch[-_]?history[^/]*\.html$/i;

/** Does this archive entry name look like watch history we import?
 * Excludes kids-profile history (`…/kids/<name>/watch-history.html`) —
 * that's a separate profile's past, not the main account's. */
export function isHistoryFile(name: string): boolean {
  if (!HISTORY_JSON_RE.test(name) && !HISTORY_HTML_RE.test(name)) return false;
  return !/(^|\/)kids\//i.test(name);
}

/* ------------------------------------------------------------------ */
/* watch-history.json (the My Activity shape)                          */
/* ------------------------------------------------------------------ */

/** Parse a Google Takeout watch-history.json into compact rows.
 * Handles the real-world variants:
 *   title     — "Watched <video title>" (prefix stripped)
 *   titleUrl  — https://www.youtube.com/watch?v=ID  (no url → removed
 *               video / ad / live entry — skipped)
 *   subtitles — [{ name: channel, url: /channel/UC… | /@handle }]
 *   time      — ISO timestamp (undated entries keep at=0)
 * Repeat watches are deduped keeping the first occurrence (the file is
 * newest-first, so that's the newest stamp). */
export function parseWatchHistoryJson(text: string): TakeoutHistoryRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, "")) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const rows: TakeoutHistoryRow[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, any>;
    const url = typeof o.titleUrl === "string" ? o.titleUrl : "";
    const vm = /[?&]v=([\w-]{6,})/.exec(url);
    if (!vm) continue; /* no video link — removed/ad/aggregate entry */
    const id = vm[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const title =
      typeof o.title === "string" ? o.title.replace(/^Watched\s+/i, "").slice(0, 140) : "";
    const sub = Array.isArray(o.subtitles) ? (o.subtitles[0] as Record<string, any> | undefined) : undefined;
    const chanName = sub && typeof sub.name === "string" ? sub.name.slice(0, 80) : undefined;
    let cid: string | undefined;
    if (sub && typeof sub.url === "string") {
      /* only real channel ids — /@handle urls don't resolve through the
       * channel route, so the card falls back to plain channel-name text */
      const cm = /\/channel\/(UC[\w-]{6,})/.exec(sub.url);
      if (cm) cid = cm[1];
    }
    let at = 0;
    if (typeof o.time === "string") {
      const t = Date.parse(o.time);
      if (Number.isFinite(t)) at = t;
    }
    rows.push({
      id,
      t: title || "(untitled)",
      ...(chanName ? { c: chanName } : {}),
      ...(cid ? { cid } : {}),
      ...(at ? { at } : {}),
    });
    if (rows.length >= MAX_HISTORY_ROWS * 2) break; /* hard paranoia cap */
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* watch-history.html (the OTHER history shape)                        */
/* ------------------------------------------------------------------ */

/** Decode the handful of HTML entities Google emits inside titles. */
function unescapeHtml(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => {
      try {
        return String.fromCodePoint(parseInt(d, 10));
      } catch {
        return "";
      }
    });
}

/** Google writes dates like "Sep 26, 2026, 2:11:03 PM EDT" with a
 * U+202F (narrow no-break space) before the meridiem — normalize to a
 * plain space so Date.parse is reliable across engines. */
function parseActivityDate(raw: string): number {
  const norm = raw.replace(/[\u202f\u00a0]/g, " ").trim();
  const t = Date.parse(norm);
  return Number.isFinite(t) ? t : 0;
}

/** One watch entry as the HTML lays it out:
 *   Watched <a href="…watch?v=ID">TITLE</a><br>
 *   [<a href="…/channel/UC…">CHANNEL</a><br>]
 *   Sep 26, 2026, 2:11:03 PM EDT<br>
 * Entries without a watch link (ads, removed videos, "Visited…") don't
 * match and are skipped; channel is optional (~24% of real entries
 * have none). */
const HTML_ENTRY_RE =
  /Watched\s*<a\s[^>]*href="[^"]*?[?&]v=([\w-]{6,})"[^>]*>([^<]*)<\/a>(?:<br\s*\/?>)?(?:<a\s[^>]*href="[^"]*?\/channel\/(UC[\w-]{6,})"[^>]*>([^<]*)<\/a>)?(?:<br\s*\/?>)?([^<]*)/g;

/** Parse a (small) watch-history.html wholesale. */
export function parseWatchHistoryHtml(text: string): TakeoutHistoryRow[] {
  const reducer = new WatchHistoryHtmlReducer();
  reducer.feed(text);
  return reducer.finish();
}

/** Streaming parser for watch-history.html — feed() it chunks in any
 * size (the real file is 50MB+; this never holds more than the current
 * entry's tail). Google writes the log newest-first, so the first
 * occurrence of a video id wins (its newest watch). */
export class WatchHistoryHtmlReducer {
  private carry = "";
  private rows: TakeoutHistoryRow[] = [];
  private seen = new Set<string>();

  feed(chunk: string): void {
    if (this.rows.length >= MAX_HISTORY_ROWS * 2) return;
    const buf = this.carry + chunk;
    HTML_ENTRY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    let lastEnd = 0;
    while ((m = HTML_ENTRY_RE.exec(buf)) !== null) {
      lastEnd = HTML_ENTRY_RE.lastIndex;
      this.push(m[1], m[2], m[3], m[4], m[5]);
      if (this.rows.length >= MAX_HISTORY_ROWS * 2) break;
    }
    /* keep the un-matched tail plus a safety margin so an entry split
     * across the chunk boundary still matches next time (entries are a
     * few hundred bytes; 2KB of margin is generous) */
    this.carry = buf.slice(Math.max(0, lastEnd === 0 ? Math.max(0, buf.length - 2048) : lastEnd - 2048));
    if (this.carry.length > 8192) this.carry = this.carry.slice(-8192);
  }

  /** Flush the final carry (the file ends with a complete entry — the
   * last match can be sitting in it). */
  finish(): TakeoutHistoryRow[] {
    if (this.carry && this.rows.length < MAX_HISTORY_ROWS * 2) {
      HTML_ENTRY_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = HTML_ENTRY_RE.exec(this.carry)) !== null) {
        this.push(m[1], m[2], m[3], m[4], m[5]);
      }
      this.carry = "";
    }
    /* newest first (file order), capped */
    return this.rows.slice(0, MAX_HISTORY_ROWS);
  }

  private push(id: string, title: string, cid: string | undefined, chan: string | undefined, dateRaw: string | undefined): void {
    if (!id || this.seen.has(id)) return;
    this.seen.add(id);
    const t = unescapeHtml(title).trim().slice(0, 140) || "(untitled)";
    const at = dateRaw ? parseActivityDate(dateRaw) : 0;
    const c = chan ? unescapeHtml(chan).trim().slice(0, 80) : undefined;
    this.rows.push({
      id,
      t,
      ...(c ? { c } : {}),
      ...(cid ? { cid } : {}),
      ...(at ? { at } : {}),
    });
  }
}

/* ------------------------------------------------------------------ */
/* merging                                                             */
/* ------------------------------------------------------------------ */

/** Merge history row sets (json + html can BOTH be present in one
 * archive): dedupe by video id keeping the newest stamp, newest
 * first, capped. */
export function mergeHistoryRows(...sets: TakeoutHistoryRow[][]): TakeoutHistoryRow[] {
  const byId = new Map<string, TakeoutHistoryRow>();
  for (const set of sets) {
    for (const r of set) {
      if (!r?.id) continue;
      const prev = byId.get(r.id);
      if (!prev || (r.at ?? 0) > (prev.at ?? 0)) byId.set(r.id, r);
    }
  }
  const rows = [...byId.values()].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return rows.slice(0, MAX_HISTORY_ROWS);
}
