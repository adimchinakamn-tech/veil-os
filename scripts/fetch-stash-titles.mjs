#!/usr/bin/env node
/**
 * Veil — Stash real-title crawler (one-time / refreshable).
 *
 * The UGS single-file game HTMLs on jsdelivr carry real <title> tags
 * ("clstickmanduel.html" → <title>Stickman Duel</title>). This script
 * range-fetches just the first 16 KB of every file in the CDN list,
 * extracts + cleans the <title>, filters junk ("really cool flash
 * game", "Untitled", …) and writes a static sidecar JSON:
 *
 *   public/arcade/stash-titles.json   { "<raw id>": "Real Title", … }
 *
 * The stash tab (ugs.html) and /api/arcade/stash both prefer these real
 * names and fall back to the prettifier when a title is missing/junk.
 *
 * Usage:  bun scripts/fetch-stash-titles.mjs [--conc=8] [--out=…]
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const LIST =
  "https://cdn.jsdelivr.net/gh/bubbls/ugs-singlefile@main/games.js";
const FILE_BASE =
  "https://cdn.jsdelivr.net/gh/bubbls/ugs-singlefile/UGS-Files/";

const argv = process.argv.slice(2);
const conc = Number(argv.find((a) => a.startsWith("--conc="))?.slice(7)) || 8;
const out =
  argv.find((a) => a.startsWith("--out="))?.slice(6) ||
  join(process.cwd(), "public/arcade/stash-titles.json");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/* ---------- list parsing (same scanner as the API route) ---------- */
function parseFileList(src) {
  const start = src.indexOf("[");
  if (start === -1) return [];
  let depth = 0;
  let inString = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(src.slice(start, i + 1));
          if (Array.isArray(parsed))
            return parsed.filter((x) => typeof x === "string");
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

/* ---------- title cleaning ---------- */
const ENT = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–",
};
function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ""; }
    })
    .replace(/&#(\d+);/g, (_, d) => {
      try { return String.fromCodePoint(Number(d)); } catch { return ""; }
    })
    .replace(/&([a-z]+);/gi, (m, name) => ENT[name.toLowerCase()] ?? m);
}

const JUNK =
  /^(untitled( document| page)?|new page|document|html|index|home|home ?page|blank|game|games|play|play game|my game|mygame|loading|loading\.\.\.|please wait|error|404|not found|access denied|just a moment|redirect(ing)?(\.\.\.)?|(really )?cool (flash )?game( \d+)?|the game|title|page title)$/i;
const JUNK_IN = /cool (flash|new)? ?game|untitled|just a moment|cloudflare|are you (a )?(robot|human)|click here to (play|continue|verify)/i;

function cleanTitle(raw, id) {
  let t = decodeEntities(raw).replace(/\s+/g, " ").trim();
  if (!t) return "";
  // "10 Minutes Till Dawn | Seraph" → keep the game name only
  t = t.split(/\s+[|·|]\s+/)[0].trim();
  if (!t) return "";
  if (t.length < 2 || t.length > 80) return "";
  if (t.split(" ").length > 10) return "";
  if (JUNK.test(t) || JUNK_IN.test(t)) return "";
  // Titles that are the id itself give nothing the prettifier doesn't.
  const alnum = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (alnum(t) === alnum(id) && !/\s/.test(t)) return "";
  return t;
}

function extractTitle(html) {
  const m = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html);
  return m ? m[1] : "";
}

function fileUrl(raw) {
  const normalized =
    raw.includes(".") && raw.lastIndexOf(".") > 0 ? raw : `${raw}.html`;
  return FILE_BASE + encodeURIComponent(normalized);
}

/* ---------- crawl ---------- */
async function fetchTitle(id, attempt = 0) {
  try {
    const res = await fetch(fileUrl(id), {
      headers: {
        "user-agent": UA,
        range: "bytes=0-16383",
        accept: "*/*",
        // range + content-encoding:br breaks bun's fetch decompression —
        // ask for identity so the partial bytes decode as-is
        "accept-encoding": "identity",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(25_000),
    });
    if (res.status !== 200 && res.status !== 206) return "";
    const buf = Buffer.from(await res.arrayBuffer());
    const head = buf.subarray(0, 16384).toString("latin1");
    if (/^Couldn't find the requested file/.test(head.trim())) return "";
    return cleanTitle(extractTitle(head), id);
  } catch {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1) + Math.random() * 400));
      return fetchTitle(id, attempt + 1);
    }
    return "";
  }
}

async function main() {
  console.log("[stash-titles] fetching CDN list…");
  const listRes = await fetch(LIST, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(30_000),
  });
  if (!listRes.ok) throw new Error(`list ${listRes.status}`);
  const ids = parseFileList(await listRes.text());
  console.log(`[stash-titles] ${ids.length} ids; concurrency ${conc}`);

  // Keep any previously-crawled titles (id set union) so a partial re-run
  // doesn't lose ground.
  const titles = {};
  if (existsSync(out)) {
    try { Object.assign(titles, JSON.parse(readFileSync(out, "utf8"))); } catch {}
  }

  let done = 0, hits = 0, next = 0;
  const errors = [];
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++].trim();
      if (!id || titles[id] !== undefined) { done++; continue; }
      const t = await fetchTitle(id);
      if (t) { titles[id] = t; hits++; }
      else errors.push(id);
      done++;
      if (done % 100 === 0) {
        console.log(`[stash-titles] ${done}/${ids.length} · real titles ${hits}`);
        // checkpoint so a crash keeps progress
        flush(titles);
      }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  flush(titles);
  console.log(`[stash-titles] DONE — ${Object.keys(titles).length} real titles (${hits} new this run); ${errors.length} without titles`);

  function flush(map) {
    const sorted = {};
    for (const k of Object.keys(map).sort()) sorted[k] = map[k];
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(sorted));
  }
}

main().catch((e) => {
  console.error("[stash-titles] fatal:", e);
  process.exit(1);
});
