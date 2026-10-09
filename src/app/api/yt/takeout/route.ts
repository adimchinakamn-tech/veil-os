/**
 * Veil — YouTube Takeout archive reader (.tgz / .tar / .zip).
 *
 * Google Takeout lets you export TWO archive shapes: a .tgz (gzipped
 * tar) and a .zip — whichever the user picked, THAT is the file the
 * "Import from YouTube" flow needs to swallow. The browser can't
 * gunzip/untar/unzip on its own, so the archive comes here: this route
 * decompresses it, walks the entries, finds the subscriptions .csv/.json
 * inside (wherever Google put it this year), and hands the decoded text
 * back to the client, which runs the existing Takeout parser (and also
 * sniffs Veil backup JSONs that arrive through the same door). A full
 * Takeout also carries watch-history.json — parsed here into compact
 * rows so the client can mark those videos as watched.
 *
 * Nothing is stored — bytes in, text/rows out, same request.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { gunzipSync, inflateRawSync } from "node:zlib";
import {
  ANY_TEXT_RE,
  SUBS_FILE_RE,
  HISTORY_JSON_RE,
  isHistoryFile,
  parseWatchHistoryJson,
  type TakeoutHistoryRow,
} from "@/lib/veil/takeout-parse";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

/** 64MB — a subscriptions-only Takeout is KBs; a full one is GBs and
 * gets an honest error instead of a memory spike on a 3.9GB box. */
const MAX_BYTES = 64 * 1024 * 1024;
/** never decode more than this per candidate file (paranoia — a rogue
 * entry can't make us materialize a giant string). */
const MAX_FILE_BYTES = 4 * 1024 * 1024;
/** watch-history.json gets a bigger allowance — heavy watchers carry
 * years of activity in one file (still bounded by the archive cap;
 * this route is only the fallback for browsers without
 * DecompressionStream — the client-side path allows even more). */
const MAX_HISTORY_BYTES = 48 * 1024 * 1024;
/** cap on scanned archive entries (a zip/tar bomb stops here). */
const MAX_ENTRIES = 5000;
interface ArchiveEntry {
  name: string;
  data: Buffer;
}

/* ------------------------------------------------------------------ */
/* tar walking (the .tgz path)                                         */
/* ------------------------------------------------------------------ */

/** Walk a (decompressed) tar buffer. Handles the shapes Google emits:
 * plain ustar (name + prefix), GNU long names ('L' blocks), pax
 * extended headers ('x' blocks with a path= record), dirs, and the
 * standard 512-byte blocking with the zero-block end mark. */
function parseTar(buf: Buffer): ArchiveEntry[] {
  const out: ArchiveEntry[] = [];
  let off = 0;
  let pendingName: string | null = null;
  while (off + 512 <= buf.length && out.length < MAX_ENTRIES) {
    const block = buf.subarray(off, off + 512);
    /* the end-of-archive mark is a run of zero blocks */
    if (block[0] === 0 && block.every((b) => b === 0)) break;
    const rawName = block.toString("utf8", 0, 100).replace(/\0[\s\S]*$/, "");
    const prefix = block.toString("utf8", 345, 500).replace(/\0[\s\S]*$/, "").trim();
    let name = pendingName ?? (prefix ? `${prefix}/${rawName}` : rawName);
    pendingName = null;
    /* size — octal ASCII (strip NULs/spaces). A high-bit lead byte
     * means base-256 (huge file): treat as unusable and stop. */
    const sizeField = block.toString("ascii", 124, 136);
    let size: number;
    if (sizeField.charCodeAt(0) & 0x80) {
      size = Number.NaN;
    } else {
      size = parseInt(sizeField.replace(/[\0 ]/g, ""), 8);
    }
    const type = String.fromCharCode(block[156] || 0x30);
    const dataStart = off + 512;
    const safeSize = Number.isFinite(size) && size >= 0 ? size : Number.NaN;
    if (!Number.isFinite(safeSize) || dataStart + safeSize > buf.length) break;
    const data = buf.subarray(dataStart, dataStart + safeSize);
    if (type === "L") {
      /* GNU long name — applies to the NEXT header */
      pendingName = data.toString("utf8").replace(/\0[\s\S]*$/, "");
    } else if (type === "x" || type === "X") {
      /* pax extended header — only the path override matters here */
      const m = /\d+ path=([^\n]+)\n/.exec(data.toString("utf8"));
      if (m) pendingName = m[1];
    } else if (type === "0" || type === "\0" || type === "7") {
      if (safeSize > 0 && safeSize <= MAX_FILE_BYTES) {
        out.push({ name, data: Buffer.from(data) });
      }
    }
    off = dataStart + Math.ceil(safeSize / 512) * 512;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* zip walking (the .zip path — Google Takeout's other export format)  */
/* ------------------------------------------------------------------ */

/** Walk a zip via its central directory (the reliable way — local
 * headers can carry zero sizes when the data-descriptor flag is set).
 * Stored (0) and deflate (8) entries are handled; everything else is
 * skipped. Zip64 archives (>4GB) get an honest refusal. */
function parseZip(buf: Buffer): ArchiveEntry[] {
  /* 1 — find the End Of Central Directory record (PK\x05\x06), scanning
   * back from the tail (a trailing comment can follow it). */
  const scanStart = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= scanStart; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const cdCount = buf.readUInt16LE(eocd + 10);
  let cdOff = buf.readUInt32LE(eocd + 16);
  /* zip64 marker values → refuse honestly (no Takeout subscriptions
   * file needs a >4GB archive) */
  if (cdOff === 0xffffffff || cdCount === 0xffff) return [];

  /* 2 — walk the central directory entries (PK\x01\x02). */
  const out: ArchiveEntry[] = [];
  let off = cdOff;
  for (let n = 0; n < cdCount && n < MAX_ENTRIES; n++) {
    if (off + 46 > buf.length) break;
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const uncompSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen).replace(/^\uFEFF/, "");
    off += 46 + nameLen + extraLen + commentLen;
    if (compSize === 0xffffffff || localOff === 0xffffffff) continue; /* zip64 entry — skip */
    if (uncompSize > MAX_FILE_BYTES || compSize > MAX_FILE_BYTES) continue;
    if (name.endsWith("/")) continue; /* directory */

    /* 3 — read the local header at localOff to find where the data
     * actually starts (its own name/extra lengths can differ). */
    if (localOff + 30 > buf.length) continue;
    if (buf.readUInt32LE(localOff) !== 0x04034b50) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    if (dataStart + compSize > buf.length) continue;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    try {
      if (method === 0) {
        if (compSize > 0) out.push({ name, data: Buffer.from(raw) });
      } else if (method === 8) {
        const data = inflateRawSync(raw);
        if (data.length > 0 && data.length <= MAX_FILE_BYTES) out.push({ name, data });
      }
      /* other methods (bzip2 etc.) — Takeout never emits them; skip */
    } catch {
      /* one corrupt entry doesn't kill the walk */
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* the route                                                           */
/* ------------------------------------------------------------------ */

/** Compact watch-history row — the shared parser's wire shape. */
type HistoryRow = TakeoutHistoryRow;

export async function POST(req: Request): Promise<Response> {
  const ab = await req.arrayBuffer().catch(() => null);
  if (!ab || ab.byteLength === 0) {
    return Response.json(
      { error: "the archive came through empty — try exporting it again" },
      { status: 400, headers: CORS },
    );
  }
  if (ab.byteLength > MAX_BYTES) {
    return Response.json(
      {
        error:
          "that archive is over 64MB — export YouTube → subscriptions (+ history) only (Deselect all first), not your whole Takeout",
      },
      { status: 413, headers: CORS },
    );
  }
  let buf = Buffer.from(ab);
  /* sniff the magic bytes — NOT the extension (people rename downloads):
   *   1f 8b      = gzip (.tgz / .tar.gz)
   *   PK\x03\x04 = zip  (Google Takeout's other export format)
   *   plain tar is detected by the walker finding valid ustar headers */
  const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  const isZip =
    (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05)) ||
    /(\.zip)$/i.test(new URL(req.url).searchParams.get("name") ?? "");
  if (isGzip) {
    try {
      buf = gunzipSync(buf);
    } catch {
      return Response.json(
        { error: "couldn't decompress that .tgz — it may be truncated; re-download it and try again" },
        { status: 400, headers: CORS },
      );
    }
  }

  let entries: ArchiveEntry[] = [];
  if (isZip && !(buf.length > 512 && buf.subarray(257, 262).toString("ascii") === "ustar")) {
    try {
      entries = parseZip(buf);
    } catch {
      entries = [];
    }
  }
  if (entries.length === 0) {
    try {
      entries = parseTar(buf);
    } catch {
      entries = [];
    }
  }
  if (entries.length === 0 && (isZip || isGzip)) {
    /* zip walk failed on a sniffed zip → say zip; tar walk failed on
     * gzip → say tgz; both honest, both actionable */
    return Response.json(
      {
        error: isZip
          ? "couldn't read that .zip — it may be a multi-part or >4GB archive; re-export YouTube → subscriptions only"
          : "that doesn't look like a readable Takeout archive — re-download it from takeout.google.com and try again",
      },
      { status: 400, headers: CORS },
    );
  }
  if (entries.length === 0) {
    return Response.json(
      {
        error:
          "that doesn't look like a Takeout archive — expected the .tgz or .zip Google hands you (or the subscriptions .csv/.json inside it)",
      },
      { status: 400, headers: CORS },
    );
  }

  /* subscriptions first (wherever it sits in the tree), then any other
   * csv/json as a fallback — capped so a huge archive can't flood back.
   * watch-history files are EXCLUDED from the text candidates (a
   * decade of activity would flood the response) — they're parsed
   * server-side into compact rows instead. */
  const subs = entries.filter((e) => SUBS_FILE_RE.test(e.name));
  const rest = entries
    .filter((e) => !SUBS_FILE_RE.test(e.name) && !isHistoryFile(e.name) && ANY_TEXT_RE.test(e.name))
    .slice(0, 12);
  const picked = [...subs.slice(0, 12), ...rest];

  /* watch-history.json → compact rows (server-side parse, newest first) */
  let history: HistoryRow[] = [];
  const historyEntries = entries.filter(
    (e) => HISTORY_JSON_RE.test(e.name) && e.data.length <= MAX_HISTORY_BYTES,
  );
  for (const e of historyEntries) {
    const rows = parseWatchHistoryJson(e.data.toString("utf8").replace(/^\uFEFF/, ""));
    if (rows.length > history.length) history = rows; /* biggest/richest file wins */
  }

  if (picked.length === 0 && history.length === 0) {
    return Response.json(
      {
        files: [],
        error: "no subscriptions .csv/.json or watch-history found inside that archive — re-export with YouTube → subscriptions (+ history) selected",
      },
      { status: 404, headers: CORS },
    );
  }
  return Response.json(
    {
      files: picked.map((e) => ({
        name: e.name,
        text: e.data.toString("utf8").replace(/^\uFEFF/, ""),
      })),
      ...(history.length > 0 ? { history } : {}),
    },
    { headers: { ...CORS, "cache-control": "no-store" } },
  );
}
