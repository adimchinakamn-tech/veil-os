/**
 * Veil — Takeout archive extraction (client-safe, worker-safe).
 *
 * The streaming tar/zip walkers that pull subscriptions + watch-history
 * out of a Google Takeout archive WITHOUT materializing the archive:
 * the browser's native DecompressionStream gunzips .tgz slices, a
 * sequential tar walker consumes entries as they flow, and zips are
 * read random-access via File.slice + the central directory. Only the
 * few KB of candidate text are ever held.
 *
 * This module is imported BOTH by the Stream section (small files run
 * inline) and by takeout-worker.ts (big archives run on a Web Worker so
 * the main thread — and the whole UI — never stutters, no matter how
 * many gigabytes walk through).
 */

import {
  ANY_TEXT_RE,
  SUBS_FILE_RE,
  HISTORY_JSON_RE,
  isHistoryFile,
  parseWatchHistoryJson,
  parseWatchHistoryHtml,
  mergeHistoryRows,
  WatchHistoryHtmlReducer,
  type TakeoutHistoryRow,
} from "@/lib/veil/takeout-parse";

/** Sniff a dropped file's magic bytes so a renamed download still routes
 * correctly — people rename archives, browsers mangle names, and the
 * bytes never lie:
 *   1f 8b      → gzip (.tgz / .tar.gz)
 *   PK\x03…    → zip  (Google Takeout's other export format)
 *   "ustar"@257→ plain uncompressed .tar
 *   otherwise  → text (.csv / .json) */
export async function sniffFileKind(file: File): Promise<"gzip" | "zip" | "tar" | "text"> {
  try {
    const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
    if (head[0] === 0x1f && head[1] === 0x8b) return "gzip";
    if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)) {
      return "zip";
    }
    if (head.length >= 262) {
      const magic = String.fromCharCode(head[257], head[258], head[259], head[260]);
      if (magic === "ustar") return "tar";
    }
  } catch {
    /* fall through to text */
  }
  return "text";
}

/* ------------------------------------------------------------------ */
/* Local archive extraction — the multi-GB Takeout path               */
/* ------------------------------------------------------------------ */
/* A real Takeout with videos included runs to GIGABYTES. Uploading
 * that anywhere is a non-starter — instead the archive is streamed
 * through ON THIS DEVICE: the browser's native DecompressionStream
 * gunzips it, a streaming tar walker (or, for zips, random-access
 * reads via File.slice + the central directory) pulls out only the
 * few KB that matter — subscriptions csv/json, watch-history
 * json/html — and everything else (the videos, photos, mail…) is
 * read past and discarded. Nothing is uploaded; memory stays
 * bounded no matter how big the archive is. */

/** per-file cap for collected text candidates (subs/veil json). */
const LOCAL_TEXT_CAP = 4 * 1024 * 1024;
/** watch-history.json allowance (heavy watchers carry years). */
const LOCAL_HISTORY_JSON_CAP = 12 * 1024 * 1024;
/** watch-history.html allowance — the real thing runs 50MB+; it's
 * stream-REDUCED to rows, so memory stays bounded regardless. */
const LOCAL_HISTORY_HTML_CAP = 320 * 1024 * 1024;
/** how many text candidates we keep (tar bombs stop here). */
const LOCAL_MAX_TEXTS = 40;
/** streamed-bytes progress report cadence (every pct-point or 128MB). */
const PROGRESS_STEP_BYTES = 128 * 1024 * 1024;

export interface YouTubeImportProgress {
  /** 0..1 of the COMPRESSED bytes consumed so far. */
  pct: number;
  total: number;
  scanned: number;
  /** short names of candidate files found so far ("subscriptions.csv"). */
  found: string[];
}

export interface LocalExtractResult {
  texts: { name: string; text: string }[];
  historyRows: TakeoutHistoryRow[];
  /** the stream died mid-archive (truncated download) — we still keep
   * whatever was readable before the break. */
  truncated: boolean;
  entries: number;
}

/** Progress pump — shared by both extractors: throttled to whole
 * percent points (or big byte jumps) so React re-renders stay cheap. */
class ProgressPump {
  private lastPct = -1;
  private lastBytes = 0;
  constructor(
    private readonly total: number,
    private readonly onProgress: ((p: YouTubeImportProgress) => void) | undefined,
    private readonly foundRef: { found: string[] },
  ) {}
  tick(scanned: number): void {
    if (!this.onProgress) return;
    const pct = this.total > 0 ? Math.min(1, scanned / this.total) : 1;
    if (pct >= this.lastPct + 0.01 || scanned - this.lastBytes >= PROGRESS_STEP_BYTES || pct >= 1) {
      this.lastPct = pct;
      this.lastBytes = scanned;
      this.onProgress({ pct, total: this.total, scanned, found: [...this.foundRef.found] });
    }
  }
}

/** What the tar walker should do with a regular file entry. */
type TarWant = "text" | "history-json" | "history-html" | "skip";

/** Decide how to treat an archive entry by name (shared by the tar
 * stream walker and the zip random-access reader). */
function wantEntry(name: string, size: number): TarWant {
  if (size <= 0) return "skip";
  if (isHistoryFile(name)) {
    return HISTORY_JSON_RE.test(name) ? "history-json" : "history-html";
  }
  /* text candidates: subscriptions-shaped names first, then any
   * csv/json as the fallback pool — EXCLUDING watch-history files and
   * Google's /channels/ folder (that's the user's OWN channel profile
   * — channel.csv carries a perfectly-shaped UC row that would
   * otherwise land as a "subscription"). */
  if (/(^|\/)channels\//i.test(name)) return "skip";
  if (size <= LOCAL_TEXT_CAP && (SUBS_FILE_RE.test(name) || ANY_TEXT_RE.test(name))) {
    return "text";
  }
  return "skip";
}

/** Decode bytes → text respecting UTF-8 continuation boundaries. */
function decodeUtf8(chunks: Uint8Array[]): string {
  const dec = new TextDecoder("utf-8");
  let out = "";
  for (const c of chunks) out += dec.decode(c, { stream: true });
  return (out + dec.decode()).replace(/^\uFEFF/, "");
}

/** Sequential tar walker over a decompressed byte stream. Handles
 * the shapes Google emits: ustar name+prefix, GNU long names ('L'),
 * pax path overrides ('x'), zero-block end mark, 512-byte padding.
 * Data is CONSUMED as it flows — non-candidate bytes are never held. */
async function walkTarStream(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  onEntryData: (name: string, want: TarWant, text: string) => void,
  onHtmlChunk: (chunk: string) => void,
  onHtmlEnd: () => void,
  entryCap: number,
): Promise<{ entries: number; cleanEnd: boolean }> {
  const reader = stream.getReader();
  let pending: Uint8Array[] = [];
  let pendingLen = 0;
  let entries = 0;

  const checkSignal = () => {
    if (signal?.aborted) {
      throw new DOMException("import cancelled", "AbortError");
    }
  };
  const fill = async (n: number): Promise<boolean> => {
    while (pendingLen < n) {
      checkSignal();
      const { done, value } = await reader.read();
      if (done) return false;
      if (value.byteLength > 0) {
        /* COPY the chunk: the native pipe (blob stream → transforms)
         * may recycle its chunk buffers once they flow downstream —
         * any subarray view we hold across an await would silently
         * alias recycled bytes and desync the walk (found the hard
         * way on a real 3.4GB Takeout: garbage "headers" at ~19MB). */
        pending.push(value.slice());
        pendingLen += value.byteLength;
      }
    }
    return true;
  };
  /** take exactly n bytes (caller guaranteed fill(n) first). */
  const take = (n: number): Uint8Array => {
    if (pending.length === 1) {
      const only = pending[0];
      if (only.byteLength === n) {
        pending = [];
        pendingLen = 0;
        return only;
      }
      if (only.byteLength > n) {
        pending = [only.subarray(n)];
        pendingLen -= n;
        return only.subarray(0, n);
      }
    }
    const out = new Uint8Array(n);
    let off = 0;
    while (off < n) {
      const head = pending[0];
      const takeN = Math.min(head.byteLength, n - off);
      out.set(head.subarray(0, takeN), off);
      off += takeN;
      if (takeN === head.byteLength) pending.shift();
      else pending[0] = head.subarray(takeN);
      pendingLen -= takeN;
    }
    return out;
  };
  /** consume & discard n bytes — WITHOUT losing the tail of the chunk
   * they come from. (An earlier version read a whole chunk and subtracted
   * it from n, silently throwing away chunkSize − n bytes whenever n was
   * small — e.g. the 416-byte tar padding after a multi-MB video — which
   * desynced the walk by exactly one chunk-tail and fed it garbage
   * "headers" ~19MB into real 3.4GB Takeouts. Everything now flows
   * through pending so remainders stay available to the next read.) */
  const discard = async (n: number): Promise<void> => {
    while (n > 0) {
      if (pendingLen === 0 && !(await fill(1))) return;
      const d = Math.min(n, pendingLen);
      take(d);
      n -= d;
    }
  };

  let cleanEnd = false;
  try {
    let pendingName: string | null = null;
    headerLoop: while (true) {
      if (entries >= entryCap) break;
      if (!(await fill(512))) break;
      const block = take(512);
      if (block[0] === 0 && block.every((b) => b === 0)) {
        cleanEnd = true; /* the archive's own end mark — a tar without
         * one was cut short, whatever the gzip layer thinks */
        break;
      }
      const rawName = new TextDecoder("latin1")
        .decode(block.subarray(0, 100))
        .replace(/\0[\s\S]*$/, "");
      const prefix = new TextDecoder("latin1")
        .decode(block.subarray(345, 500))
        .replace(/\0[\s\S]*$/, "")
        .trim();
      let name = pendingName ?? (prefix ? `${prefix}/${rawName}` : rawName);
      pendingName = null;
      const sizeField = new TextDecoder("latin1").decode(block.subarray(124, 136));
      let size: number;
      if (sizeField.charCodeAt(0) & 0x80) {
        break; /* base-256 huge size — not a Takeout shape */
      } else {
        size = parseInt(sizeField.replace(/[\0 ]/g, ""), 8);
      }
      if (!Number.isFinite(size) || size < 0) break;
      const type = String.fromCharCode(block[156] || 0x30);
      entries++;

      if (type === "L" || type === "x" || type === "X") {
        /* meta blocks: GNU long name / pax path override — small, and
         * they rename the NEXT entry. */
        const meta: Uint8Array[] = [];
        let left = Math.min(size, 64 * 1024);
        while (left > 0) {
          if (pendingLen === 0 && !(await fill(Math.min(left, 65536)))) break;
          const d = Math.min(left, pendingLen);
          meta.push(take(d));
          left -= d;
        }
        if (size > 64 * 1024) await discard(size - Math.min(size, 64 * 1024));
        await discard((512 - (size % 512)) % 512);
        const metaText = decodeUtf8(meta).replace(/\0[\s\S]*$/, "");
        if (type === "L") {
          pendingName = metaText;
        } else {
          const m = /\d+ path=([^\n]+)\n/.exec(metaText);
          if (m) pendingName = m[1];
        }
        continue;
      }

      if (type === "0" || type === "\0" || type === "7") {
        const want = wantEntry(name, size);
        if (want === "history-html") {
          const dec = new TextDecoder("utf-8");
          let left = size;
          let total = 0;
          while (left > 0) {
            if (pendingLen === 0 && !(await fill(Math.min(left, 524288)))) break;
            const d = Math.min(left, pendingLen);
            const chunk = take(d);
            left -= d;
            total += d;
            if (total <= LOCAL_HISTORY_HTML_CAP) onHtmlChunk(dec.decode(chunk, { stream: true }));
          }
          onHtmlChunk(dec.decode()); /* flush the decoder */
          onHtmlEnd();
        } else if (want === "text" || want === "history-json") {
          const cap = want === "history-json" ? LOCAL_HISTORY_JSON_CAP : LOCAL_TEXT_CAP;
          if (size > cap) {
            await discard(size);
          } else {
            const parts: Uint8Array[] = [];
            let left = size;
            while (left > 0) {
              if (pendingLen === 0 && !(await fill(Math.min(left, 262144)))) break;
              const d = Math.min(left, pendingLen);
              parts.push(take(d));
              left -= d;
            }
            onEntryData(name, want, decodeUtf8(parts));
          }
        } else {
          await discard(size);
        }
      } else {
        /* dirs, symlinks, hardlinks… — data (if any) is never wanted */
        await discard(size);
      }
      await discard((512 - (size % 512)) % 512);
      void name;
      name = "";
      continue headerLoop;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { entries, cleanEnd };
}

/** Extract candidates from a .tgz / .tar by STREAMING it — never
 * materializing more than a few MB no matter the archive size. */
export async function extractTarLocal(
  file: File,
  gzip: boolean,
  signal: AbortSignal | undefined,
  onProgress: ((p: YouTubeImportProgress) => void) | undefined,
): Promise<LocalExtractResult> {
  const foundRef = { found: [] as string[] };
  const pump = new ProgressPump(file.size, onProgress, foundRef);
  let scanned = 0;
  (extractTarLocal as unknown as { lastScanned?: number }).lastScanned = -1;

  /* WHY SLICE READS AND NOT file.stream(): a multi-GB archive must
   * arrive byte-perfect through the whole pipe, and the blob's
   * sequential stream proved unreliable in exactly the setup that
   * matters (a huge CDP-attached file piped through transforms —
   * recycled chunk buffers silently delivered stale bytes ~19MB in,
   * desyncing the tar walk). File.slice() range reads are the path
   * that is byte-exact at every offset, so the gunzip is fed from an
   * explicit slice-reading source: 8MB at a time, pulled on demand,
   * progress counted on the compressed side. */
  const SLICE = 8 * 1024 * 1024;
  let sliceOff = 0;
  const sliceSource = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (signal?.aborted) {
        controller.error(new DOMException("import cancelled", "AbortError"));
        return;
      }
      if (sliceOff >= file.size) {
        controller.close();
        return;
      }
      try {
        const end = Math.min(file.size, sliceOff + SLICE);
        const buf = await file.slice(sliceOff, end).arrayBuffer();
        sliceOff = end;
        scanned = end;
        (extractTarLocal as unknown as { lastScanned?: number }).lastScanned = scanned;
        pump.tick(scanned);
        if (buf.byteLength > 0) controller.enqueue(new Uint8Array(buf));
        else controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
  const stream = gzip
    ? sliceSource.pipeThrough(
        new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>,
      )
    : sliceSource;

  const texts: { name: string; text: string }[] = [];
  const htmlReducers: WatchHistoryHtmlReducer[] = [];
  let jsonHistories: TakeoutHistoryRow[][] = [];
  let currentHtml: WatchHistoryHtmlReducer | null = null;

  const onEntryData = (name: string, want: TarWant, text: string) => {
    if (want === "history-json") {
      const rows = parseWatchHistoryJson(text);
      if (rows.length > 0) {
        jsonHistories.push(rows);
        foundRef.found.push(name.split("/").pop() ?? name);
      }
      return;
    }
    if (texts.length < LOCAL_MAX_TEXTS) {
      texts.push({ name, text });
      foundRef.found.push(name.split("/").pop() ?? name);
    }
  };

  let truncated = false;
  let truncReason: string | null = null;
  let entries = 0;
  try {
    const r = await walkTarStream(
      stream,
      signal,
      onEntryData,
      (chunk) => {
        currentHtml = currentHtml ?? new WatchHistoryHtmlReducer();
        currentHtml.feed(chunk);
      },
      () => {
        if (currentHtml) {
          htmlReducers.push(currentHtml);
          currentHtml = null;
        }
      },
      200000,
    );
    entries = r.entries;
    /* honest truncation signal: EITHER the gzip layer errored (caught
     * below) OR the tar never reached its zero-block end mark — some
     * browsers end a cut gzip stream cleanly at a flush boundary, and
     * the missing end mark is the truth the tar itself tells us. */
    truncated = !r.cleanEnd;
    if (truncated && !truncReason) truncReason = "no tar end-mark";
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    /* corrupt/truncated gzip — keep what we already collected */
    truncated = true;
    truncReason = "gzip-error: " + (e instanceof Error ? e.message : String(e));
  }
  if (currentHtml) {
    htmlReducers.push(currentHtml);
    currentHtml = null;
  }
  const historyRows = mergeHistoryRows(
    ...jsonHistories,
    ...htmlReducers.map((r) => r.finish()),
  );
  (extractTarLocal as unknown as { lastScanned?: number }).lastScanned = scanned;
  (extractTarLocal as unknown as { lastReason?: string | null }).lastReason = truncReason;
  return { texts, historyRows, truncated, entries };
}

/* ------------------------------------------------------------------ */
/* zip — random access via File.slice (cheap range reads on a local
 * file) + the central directory, WITH zip64 support (a multi-GB
 * Takeout zip with thousands of entries needs it). */

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | b[o + 3] << 24) >>> 0;
const u64 = (b: Uint8Array, o: number) => u32(b, o) + u32(b, o + 4) * 0x100000000;

interface ZipWanted {
  name: string;
  method: number;
  compSize: number;
  uncompSize: number;
  localOff: number;
  want: TarWant;
}

/** Inflate raw-deflate bytes with the browser's native stream. */
async function inflateRawLocal(bytes: Uint8Array): Promise<Uint8Array | null> {
  const ds = new DecompressionStream("deflate-raw" as CompressionFormat);
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  try {
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  } catch {
    return null;
  }
}

export async function extractZipLocal(
  file: File,
  signal: AbortSignal | undefined,
  onProgress: ((p: YouTubeImportProgress) => void) | undefined,
): Promise<LocalExtractResult> {
  const foundRef = { found: [] as string[] };
  const pump = new ProgressPump(file.size, onProgress, foundRef);
  pump.tick(0);
  const size = file.size;
  const tailLen = Math.min(size, 1024 * 1024);
  const tail = new Uint8Array(await file.slice(size - tailLen).arrayBuffer());

  /* 1 — End Of Central Directory (PK\x05\x06), scanning back; the
   * comment length must account exactly for the bytes after it. */
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      const commentLen = u16(tail, i + 20);
      if (i + 22 + commentLen === tail.length) {
        eocd = i;
        break;
      }
    }
  }
  if (eocd < 0) throw new Error("not a readable zip (no end-of-directory record)");
  let cdCount = u16(tail, eocd + 10);
  let cdOff = u32(tail, eocd + 16);
  let cdSize = u32(tail, eocd + 12);

  /* 2 — zip64? (marker values, or a >4GB / >65535-entry archive) */
  if (cdOff === 0xffffffff || cdCount === 0xffff || cdSize === 0xffffffff) {
    /* locator PK\x06\x07 sits just before the EOCD */
    for (let i = Math.min(eocd - 20, tail.length - 20); i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x06 && tail[i + 3] === 0x07) {
        const e64 = u64(tail, i + 8);
        const head = new Uint8Array(await file.slice(e64, e64 + 56).arrayBuffer());
        if (u32(head, 0) !== 0x06064b50) break;
        cdCount = u64(head, 32);
        cdSize = u64(head, 40);
        cdOff = u64(head, 48);
        break;
      }
    }
  }
  if (cdOff + cdSize > size || cdCount > 400000) {
    throw new Error("not a readable zip (bad central directory)");
  }

  /* 3 — walk the central directory (one range read). */
  const cd = new Uint8Array(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const wanted: ZipWanted[] = [];
  const nameDec = new TextDecoder("utf-8");
  let off = 0;
  for (let n = 0; n < cdCount; n++) {
    if (off + 46 > cd.length) break;
    if (u32(cd, off) !== 0x02014b50) break;
    const method = u16(cd, off + 10);
    let compSize = u32(cd, off + 20);
    let uncompSize = u32(cd, off + 24);
    const nameLen = u16(cd, off + 28);
    const extraLen = u16(cd, off + 30);
    const commentLen = u16(cd, off + 32);
    let localOff = u32(cd, off + 42);
    off += 46;
    const name = nameDec.decode(cd.subarray(off, off + nameLen)).replace(/^\uFEFF/, "");
    off += nameLen;
    /* zip64 extra field (id 0x0001) — 64-bit replacements for whichever
     * fields hit the marker values, in this fixed order. */
    const extraEnd = off + extraLen;
    if (localOff === 0xffffffff || compSize === 0xffffffff || uncompSize === 0xffffffff) {
      let eo = off;
      while (eo + 4 <= extraEnd) {
        const id = u16(cd, eo);
        const sz = u16(cd, eo + 2);
        if (id === 0x0001) {
          let fo = eo + 4;
          if (uncompSize === 0xffffffff && fo + 8 <= extraEnd) {
            uncompSize = u64(cd, fo);
            fo += 8;
          }
          if (compSize === 0xffffffff && fo + 8 <= extraEnd) {
            compSize = u64(cd, fo);
            fo += 8;
          }
          if (localOff === 0xffffffff && fo + 8 <= extraEnd) {
            localOff = u64(cd, fo);
          }
          break;
        }
        eo += 4 + sz;
      }
    }
    off = extraEnd + commentLen;
    if (name.endsWith("/")) continue; /* directory */
    const want = wantEntry(name, uncompSize);
    if (want === "skip") continue;
    if (method !== 0 && method !== 8) continue;
    if (localOff >= size || compSize > size) continue;
    wanted.push({ name, method, compSize, uncompSize, localOff, want });
    if (wanted.length >= LOCAL_MAX_TEXTS + 8) break;
  }

  /* 4 — read only the wanted entries (a range read each). */
  const texts: { name: string; text: string }[] = [];
  const jsonHistories: TakeoutHistoryRow[][] = [];
  const htmlTexts: string[] = [];
  let readBytes = 0;
  for (const w of wanted) {
    if (signal?.aborted) throw new DOMException("import cancelled", "AbortError");
    const lhead = new Uint8Array(await file.slice(w.localOff, w.localOff + 30).arrayBuffer());
    if (u32(lhead, 0) !== 0x04034b50) continue;
    const lNameLen = u16(lhead, 26);
    const lExtraLen = u16(lhead, 28);
    const dataStart = w.localOff + 30 + lNameLen + lExtraLen;
    if (dataStart + w.compSize > size) continue;
    const raw = new Uint8Array(await file.slice(dataStart, dataStart + w.compSize).arrayBuffer());
    readBytes += 30 + lNameLen + lExtraLen + w.compSize;
    pump.tick(Math.min(file.size, (cdOff + cdSize + readBytes) | 0));
    const bytes = w.method === 0 ? raw : await inflateRawLocal(raw);
    if (!bytes || bytes.length === 0) continue;
    if (w.want === "history-html") {
      if (bytes.length <= LOCAL_HISTORY_HTML_CAP) {
        htmlTexts.push(decodeUtf8([bytes]));
        foundRef.found.push(w.name.split("/").pop() ?? w.name);
      }
    } else if (w.want === "history-json") {
      if (bytes.length <= LOCAL_HISTORY_JSON_CAP) {
        const rows = parseWatchHistoryJson(decodeUtf8([bytes]));
        if (rows.length > 0) {
          jsonHistories.push(rows);
          foundRef.found.push(w.name.split("/").pop() ?? w.name);
        }
      }
    } else if (bytes.length <= LOCAL_TEXT_CAP) {
      texts.push({ name: w.name, text: decodeUtf8([bytes]) });
      foundRef.found.push(w.name.split("/").pop() ?? w.name);
    }
  }
  pump.tick(file.size);
  const historyRows = mergeHistoryRows(
    ...jsonHistories,
    ...htmlTexts.map((t) => parseWatchHistoryHtml(t)),
  );
  return { texts, historyRows, truncated: false, entries: cdCount };
}
/* QA harness: expose the extractors so agent-browser can run the REAL
 * code paths on a captured File outside the React component tree
 * (window.__veilExtract — same trick as the __veilTakeout debug hook). */
if (typeof window !== "undefined") {
  (window as unknown as { __veilExtract?: unknown }).__veilExtract = {
    tar: extractTarLocal,
    zip: extractZipLocal,
  };
}
