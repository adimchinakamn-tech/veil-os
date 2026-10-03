/**
 * shrink-stash.mjs — the corner-cut pass for the embedded Stash pack.
 *
 * The inliner emitted every resource's data URI TWICE per game: once in
 * MAP (absolute URL → data) and once in SUF (last path segment → data).
 * The SUF literal is redundant — it can be derived from MAP at runtime
 * with a few string ops (no byte duplication). This pass:
 *
 *   1. parses each game's MAP + SUF literals,
 *   2. derives the suffix index exactly the way the inliner built it
 *      (same cleaning rule, same first-wins order),
 *   3. VERIFIES the derived index is key-for-key, value-for-value
 *      identical to the literal it replaces,
 *   4. only then swaps `var SUF = {…};` for the runtime builder.
 *
 * Any file whose derived index doesn't match is skipped untouched.
 * Result: the pack's embedded bytes roughly halve (each resource stored
 * exactly once — in MAP), zero behavior change.
 *
 * Run:  bun scripts/shrink-stash.mjs
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = "/tmp/veil-offline-assets/stash";

const LAZY_SUF = `var SUF = (function () {
    /* corner-cut: the suffix index is DERIVED from MAP at runtime, so each
       resource's bytes are stored exactly ONCE (in MAP). This builder was
       verified identical to the literal map it replaced. */
    var idx = {};
    for (var k in MAP) {
      var s = k.split("#")[0].split("?")[0];
      var i = s.lastIndexOf("/");
      s = i >= 0 ? s.slice(i + 1) : s;
      if (s && !Object.prototype.hasOwnProperty.call(idx, s)) idx[s] = MAP[k];
    }
    return idx;
  })();`;

/* the exact derivation the inliner used (first-wins, same clean rule) */
function derive(map) {
  const idx = {};
  for (const k of Object.keys(map)) {
    let s = k.split("#")[0].split("?")[0];
    const i = s.lastIndexOf("/");
    s = i >= 0 ? s.slice(i + 1) : s;
    if (s && !Object.prototype.hasOwnProperty.call(idx, s)) idx[s] = map[k];
  }
  return idx;
}

/* flat JSON object literal extractor — the inliner's maps are flat
   string→string objects produced by JSON.stringify, so the first
   balanced {} after the marker is the whole literal (base64 / URLs /
   MIME types contain no braces or quotes). */
function extractLiteral(html, marker) {
  const at = html.indexOf(marker);
  if (at === -1) return null;
  /* the CURRENT inliner emits the lazy derivation directly
     (var SUF = (function () { … })();) — nothing left to shrink */
  if (html.slice(at + marker.length, at + marker.length + 1) === "(") return { lazy: true };
  const open = html.indexOf("{", at + marker.length);
  if (open === -1) return null;
  let depth = 0, inStr = false;
  for (let i = open; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return { start: at, end: html.indexOf(";", i) + 1, obj: JSON.parse(html.slice(open, i + 1)) }; }
  }
  return null;
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".html")).sort();
let packBefore = 0, packAfter = 0, changed = 0;
const skipped = [];
for (const f of files) {
  const p = join(DIR, f);
  const html = readFileSync(p, "utf8");
  packBefore += html.length;
  const sufLit = extractLiteral(html, "var SUF = ");
  const mapLit = extractLiteral(html, "var MAP = ");
  if (!sufLit || !mapLit) { skipped.push(f + " (no literals)"); continue; }
  if (sufLit.lazy) { skipped.push(f + " (already lazy)"); packAfter += html.length; continue; }
  const derived = derive(mapLit.obj);
  const orig = sufLit.obj;
  const ok =
    Object.keys(orig).length === Object.keys(derived).length &&
    Object.keys(orig).every((k) => derived[k] === orig[k]);
  if (!ok) { skipped.push(f + " (index mismatch)"); continue; }
  const out = html.slice(0, sufLit.start) + LAZY_SUF + html.slice(sufLit.end);
  writeFileSync(p, out);
  packAfter += out.length;
  changed++;
}
/* refresh the manifest byte counts so build-veil.mjs logs truthfully */
const manPath = join(DIR, "stash-embed.json");
const manifest = JSON.parse(readFileSync(manPath, "utf8"));
for (const e of manifest) {
  try { e.bytes = statSync(join(DIR, e.id + ".html")).size; } catch {}
}
writeFileSync(manPath, JSON.stringify(manifest, null, 2));

const mb = (n) => (n / 1048576).toFixed(2);
console.log(`shrink: ${changed}/${files.length} games rewritten`);
console.log(`pack: ${mb(packBefore)} MB → ${mb(packAfter)} MB (saved ${mb(packBefore - packAfter)} MB)`);
if (skipped.length) console.log(`skipped (kept literal SUF): ${skipped.join(", ")}`);
