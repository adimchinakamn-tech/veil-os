#!/usr/bin/env bun
/**
 * Veil — Stash game inliner.
 *
 * The Stash's UGS files are tiny HTML STUBS: a <base href> pointing at a
 * jsdelivr GitHub repo plus runtime-loaded assets (scripts injected with
 * setAttribute, images/fetches built from string literals). They only
 * work online. This tool walks each stub's whole dependency tree and
 * produces a fully self-contained HTML file that runs offline:
 *
 *   1. fetch the stub, parse <base href>
 *   2. rewrite the static tree: <script src> → inline <script>,
 *      <link stylesheet> → inline <style> (with url() → data URIs),
 *      <img>/<audio>/<video>/<source>/poster/favicon → data URIs
 *   3. scan every JS/CSS text for asset-path string literals
 *      (png/jpg/svg/mp3/ogg/json/js/atlas/…) and fetch each candidate
 *      (strict URL resolution first, then base-dir join — the stubs use
 *      both styles)
 *   4. inject the veil-res SHIM as the first <head> script: a map of
 *      absolute-URL → data URI plus fetch / XHR / Element.setAttribute /
 *      HTMLImage·Script·Link·Media `.src`/`.href` patches so the game's
 *      RUNTIME requests (created assets, injected scripts, fetched JSON)
 *      resolve from the embedded map instead of the network
 *
 * Output: /tmp/veil-offline-assets/stash/<id>.html + stash-embed.json
 * manifest (id → pretty title, bytes, resource count) for build-veil.mjs.
 *
 * Usage:
 *   bun scripts/inline-stash.mjs                # curated default pack
 *   bun scripts/inline-stash.mjs clfoo,clbar    # explicit ids
 *   VEIL_STASH_BUDGET_MB=90 bun scripts/...     # pack budget override
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/home/z/my-project";
const OUT_DIR = "/tmp/veil-offline-assets/stash";
const UGS_FILE = "https://cdn.jsdelivr.net/gh/bubbls/ugs-singlefile/UGS-Files/";
const PRETTY = JSON.parse(readFileSync(join(ROOT, "public/arcade/stash-titles.json"), "utf8"));

const BUDGET_MB = Number(process.env.VEIL_STASH_BUDGET_MB || 100);
const PER_GAME_MB = Number(process.env.VEIL_STASH_PERGAME_MB || 16);
const PER_RES_MB = 24;

/* MIME by extension */
const MIME = {
  html: "text/html", js: "text/javascript", mjs: "text/javascript", css: "text/css",
  json: "application/json", xml: "application/xml", txt: "text/plain", vsh: "text/plain", fsh: "text/plain", glsl: "text/plain",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon", bmp: "image/bmp",
  mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac",
  mp4: "video/mp4", webm: "video/webm", ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2",
  atlas: "text/plain", fnt: "text/plain", bin: "application/octet-stream", data: "application/octet-stream", mem: "application/octet-stream", wasm: "application/wasm",
  unityweb: "application/octet-stream", unity3d: "application/octet-stream", pk3: "application/octet-stream", rom: "application/octet-stream", gba: "application/octet-stream",
};
const mimeOf = (name, ct) => {
  const m = /\.([a-z0-9]+)(?:$|\?)/i.exec(name);
  if (m && MIME[m[1].toLowerCase()]) return MIME[m[1].toLowerCase()];
  if (ct && ct !== "application/octet-stream" && ct !== "text/plain") return ct.split(";")[0];
  if (ct && /^text\//.test(ct)) return ct.split(";")[0];
  return "application/octet-stream";
};

/* ── curated pack: single-player-friendly classics from the stash ── */
const DEFAULT_PACK = [
  // platformers & parkour
  "clovo", "clovodimensions", "clvex7", "clvex6", "clvex5", "clrun3", "clrun2",
  "clbigflappytowertinysquare", "clflappybird", "cldoodlejump", "clcrossyroad",
  "clblockcraftparkour", "cljetpackjoyride", "clfinalninja", "cldrift3d",
  // skill / physics
  "cl2048", "cl2048cupcakes", "clslope", "clslope3", "cldriftboss",
  "cltinyfishing", "clicefishing", "cllearntofly", "cllearntofly2", "cllearntofly3",
  "clburritobison", "clsuika", "clmotox3m2", "clmotox3m3", "clmotox3mpoolparty",
  "clmotox3mspookyland", "clmotox3mwinter", "clmotoroadrash",
  "clworldshardestgame", "clworldshardestgame2", "climpossiblequiz", "climpossiblequiz2",
  // two-player same-keyboard (work offline)
  "clbasketrandom", "clsoccerrandom", "clvolleyrandom", "clboxingrandom",
  "clpingpongchaos", "clwrestlejump", "cltemplerun2", "clgunblood",
  // endless runners
  "clsubwaysurferslondon", "clsubwaysurfersbarcelona", "clsubwaybreakdancing",
  // retro / emulator one-files
  "clsupermario", "clcatmario", "cldoom", "cldoom2", "clsm64greenstars", "clsupermario64",
  "clpokemonleafgreen", "clpokemonfirered", "clpokemonemerald",
  // puzzles & boards
  "clchess", "clcheckers", "cltetris", "clminesweeperplus", "clsolitaire",
  "clsudoku", "clstacktris", "clstackballio", "clhelixjump",
  // idle / clicker
  "clcookieclicker", "clcookie-clicker",
  // the Eaglercraft offline one-files (bloxd-adjacent voxel, fully offline)
  "clEaglercraft-Beta-1.3-Offline", "clEaglercraftL_19_v0_7_0_Offline_Signed",
];

let ids = process.argv[2]
  ? process.argv[2].split(",").map((s) => s.trim()).filter(Boolean)
  : DEFAULT_PACK;

mkdirSync(OUT_DIR, { recursive: true });

/* validate ids against the real CDN list (also filters my typos) */
{
  const listURL = "https://cdn.jsdelivr.net/gh/bubbls/ugs-singlefile@main/games.js";
  try {
    const txt = await (await fetch(listURL, { signal: AbortSignal.timeout(20000) })).text();
    const m = /let\s+files\s*=\s*\[([\s\S]*?)\]/.exec(txt);
    const real = new Set(JSON.parse("[" + m[1].replace(/,\s*$/, "") + "]").map(String));
    const bad = ids.filter((id) => !real.has(id));
    if (bad.length) console.log(`⚠ dropping ids not on the CDN list: ${bad.join(", ")}`);
    ids = ids.filter((id) => real.has(id));
  } catch (e) {
    console.log("⚠ couldn't validate ids against the CDN list — running all as given");
  }
}

/* ── fetch helpers ─────────────────────────────────────────────── */
const fetchCache = new Map(); /* url → {ok, status, ct, u8, text} */
const fetchInflight = new Map();
async function fetchRes(url) {
  if (fetchCache.has(url)) return fetchCache.get(url);
  if (fetchInflight.has(url)) return fetchInflight.get(url);
  const p = (async () => {
    const miss = { ok: false, status: 0, url };
    try {
      const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(14000) });
      if (!r.ok) { fetchCache.set(url, miss); return miss; }
      const ct = r.headers.get("content-type") || "";
      const ab = await r.arrayBuffer();
      const u8 = new Uint8Array(ab);
      return {
        ok: true, status: r.status, ct, u8,
        text: () => new TextDecoder().decode(u8),
        url: r.url || url,
      };
    } catch {
      return miss;
    } finally {
      /* cache filled by caller path below; remove inflight marker */
    }
  })();
  fetchInflight.set(url, p);
  const r = await p;
  fetchCache.set(url, r);
  fetchInflight.delete(url);
  return r;
}

/* bounded parallel map */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(n, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx).catch((e) => ({ error: e }));
    }
  });
  await Promise.all(workers);
  return out;
}

/* try strict resolution then base-dir join for root-relative paths */
async function fetchSmart(path, base) {
  const candidates = [];
  try {
    candidates.push(new URL(path, base).href);
  } catch {}
  const baseDir = base.replace(/[^/]*$/, "");
  if (path.startsWith("/") && !path.startsWith("//")) {
    candidates.push(baseDir + path.slice(1));
  } else if (!/^[a-z]+:\/\//i.test(path)) {
    candidates.push(baseDir + path);
  }
  for (const c of candidates) {
    const r = await fetchRes(c);
    if (r.ok) return r;
  }
  return null;
}

const b64 = (u8) => Buffer.from(u8).toString("base64");
const dataURI = (entry, name) => `data:${mimeOf(name, entry.ct)};base64,${b64(entry.u8)}`;

/* escape inline script/style text for embedding.
   The HTML parser scans inlined JS for "<script" / "</script" / "<!--"
   even inside JS STRINGS — a game doing document.write('<script …>')
   would otherwise close the outer tag and dump its source as page text
   (exactly the "44KB of text" failures). \u escapes keep string and
   regex content identical ("<\u0073cript" === "<script"). */
const safeJS = (t) =>
  t.replace(/<\/script/gi, "<\\/script")
   .replace(/<script/gi, "<\\u0073cript")
   .replace(/<!--/g, "<\\u0021--");
const safeCSS = (t) => t.replace(/<\/style/gi, "\\003c /style");

/* ── asset literal scanner ─────────────────────────────────────── */
const ASSET_RE = /["`'](https?:\/\/[^"'`\s<>]+?\.(?:png|jpe?g|gif|webp|svg|ico|bmp|mp3|ogg|wav|m4a|aac|flac|mp4|webm|json|atlas|fnt|xml|glsl|vsh|fsh|wasm|unityweb|bin|data|mem|js|css|ttf|otf|woff2?))["'`]|["'`]((?:[\w\-./@~ ]*[/\\.@])?[\w\-.,@~ ]+\.(?:png|jpe?g|gif|webp|svg|ico|bmp|mp3|ogg|wav|m4a|aac|flac|mp4|webm|json|atlas|fnt|xml|glsl|vsh|fsh|wasm|unityweb|bin|data|mem|js|css|ttf|otf|woff2?))["'`]/gi;
function scanLiterals(text) {
  const out = new Set();
  if (!text) return out;
  let m;
  ASSET_RE.lastIndex = 0;
  while ((m = ASSET_RE.exec(text))) {
    const s = m[1] || m[2]; /* m[1]: absolute http(s) URL, m[2]: relative path */
    if (!s || s.length > 250) continue;
    out.add(s.replace(/\\/g, "/"));
  }
  return out;
}

/* inline a CSS text: url(...) → data URIs, @import → inlined text */
async function inlineCSS(css, base, ctx) {
  let out = css;
  /* @import */
  const imports = [...css.matchAll(/@import\s+(?:url\()?["']([^"']+)["']\)?\s*;/gi)];
  for (const im of imports) {
    const r = await fetchSmart(im[1], base);
    if (r && addBudget(r, ctx)) {
      const inner = await inlineCSS(r.text(), r.url, ctx);
      out = out.replace(im[0], inner);
    }
  }
  /* url(...) */
  const urls = [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)];
  for (const u of urls) {
    const ref = u[1];
    if (/^(data:|blob:|#)/i.test(ref)) continue;
    const r = await fetchSmart(ref, base);
    if (r && addBudget(r, ctx)) out = out.split(u[0]).join(`url("${dataURI(r, ref)}")`);
  }
  return out;
}

/* budget tracking per game */
function addBudget(entry, ctx) {
  const mb = entry.u8.length / 1048576;
  if (entry.u8.length > PER_RES_MB * 1048576) return false;
  if (ctx.bytes + entry.u8.length > PER_GAME_MB * 1048576) return false;
  ctx.bytes += entry.u8.length;
  ctx.count++;
  return true;
}

/* ── SHIM (injected first in <head>) ───────────────────────────── */
function shim(base, map) {
  return `<script>
/* Veil offline pack — resource shim (auto-generated by inline-stash.mjs) */
(function () {
  var BASE = ${JSON.stringify(base)};
  var MAP = ${JSON.stringify(map)};
  var SUF = (function () {
    /* the suffix index is DERIVED from MAP at runtime, so each resource's
       bytes are stored exactly ONCE (in MAP) — no literal duplicate map */
    var idx = {};
    for (var k in MAP) {
      var s = k.split("#")[0].split("?")[0];
      var i = s.lastIndexOf("/");
      s = i >= 0 ? s.slice(i + 1) : s;
      if (s && !Object.prototype.hasOwnProperty.call(idx, s)) idx[s] = MAP[k];
    }
    return idx;
  })();
  function res(u) {
    try {
      if (u == null) return null; u = String(u);
      if (/^(data:|blob:|about:|javascript:|mailto:)/i.test(u)) return null;
      if (u.indexOf(BASE) !== 0) {
        try { u = new URL(u, BASE).href; } catch (e) { return null; }
      }
      var d = MAP[u]; if (d) return d;
      var clean = u.split("#")[0].split("?")[0];
      d = MAP[clean]; if (d) return d;
      var i = clean.lastIndexOf("/");
      d = i >= 0 ? SUF[clean.slice(i + 1)] : null;
      return d || null;
    } catch (e) { return null; }
  }
  window.__veilRes = res;
  var F = window.fetch;
  window.fetch = function (input, init) {
    try {
      var u = input && input.url != null ? input.url : input;
      var d = res(u);
      if (d) return F(d, init);
    } catch (e) {}
    return F.apply(window, arguments);
  };
  var O = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function () {
    try {
      if (arguments[1] != null && /get/i.test(String(arguments[0] || "get"))) {
        var d = res(arguments[1]);
        if (d) arguments[1] = d;
      }
    } catch (e) {}
    return O.apply(this, arguments);
  };
  function ps(proto, prop) {
    try {
      var d = Object.getOwnPropertyDescriptor(proto, prop);
      if (!d || !d.set) return;
      Object.defineProperty(proto, prop, {
        get: function () { return d.get.call(this); },
        set: function (v) { var r = res(v); return d.set.call(this, r != null ? r : v); },
        configurable: true, enumerable: d.enumerable
      });
    } catch (e) {}
  }
  ps(HTMLImageElement.prototype, "src");
  ps(HTMLScriptElement.prototype, "src");
  ps(HTMLLinkElement.prototype, "href");
  ps(HTMLMediaElement.prototype, "src");
  ps(HTMLSourceElement.prototype, "src");
  var SA = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (n, v) {
    try {
      var t = this.tagName;
      if ((n === "src" || n === "href") && v != null && /^(IMG|SCRIPT|AUDIO|VIDEO|SOURCE|LINK|IMAGE|TRACK|EMBED)$/i.test(t)) {
        var r = res(v);
        if (r != null) v = r;
      }
    } catch (e) {}
    return SA.call(this, n, v);
  };
})();
</script>`;
}

/* ── per-game inliner ──────────────────────────────────────────── */
async function inlineGame(id) {
  const t0 = Date.now();
  const stubURL = UGS_FILE + encodeURIComponent(id) + ".html";
  let stub = await fetchRes(stubURL);
  if (!stub.ok) stub = await fetchRes(stubURL + "?r=1"); /* one retry */
  if (!stub.ok) return { id, ok: false, why: `stub HTTP ${stub.status}` };
  let html = stub.text();
  const ctx = { bytes: stub.u8.length, count: 0 };
  const ruffleProbes = [];

  /* base href */
  let base = stubURL;
  const bm = /<base\s+href=["']([^"']+)["']/i.exec(html);
  if (bm) {
    try { base = new URL(bm[1], stubURL).href; } catch {}
  }

  /* collect + inline <script src> (static). Each fetched script's own
     URL becomes the base for the literals found inside it (loaders
     resolve siblings against THEMSELVES, not the stub). Ruffle scripts
     get a publicPath config + a package probe for their wasm/core. */
  const sources = []; /* { text, baseUrl } */
  const scripts = [...html.matchAll(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi)];
  for (const s of scripts) {
    const r = await fetchSmart(s[2], base);
    if (r && addBudget(r, ctx)) {
      const attrs = (s[1] + " " + s[3]).replace(/\b(defer|async)\b/gi, "").trim();
      const text = safeJS(r.text());
      let pre = "";
      const scriptURL = r.url || s[2];
      if (/@ruffle-rs\/ruffle|\/ruffle\.(min\.)?js/i.test(scriptURL)) {
        const dir = scriptURL.replace(/[^/]*$/, "");
        pre = `<script>window.RufflePlayer = window.RufflePlayer || {}; RufflePlayer.config = Object.assign({ publicPath: ${JSON.stringify(dir)} }, RufflePlayer.config || {});</script>\n`;
        ruffleProbes.push(dir);
      }
      html = html.replace(s[0], `${pre}<script ${attrs}>\n${text}\n</script>`);
      sources.push({ text: r.text(), baseUrl: (scriptURL.match(/.*\//) || [""])[0] });
    } else if (r) {
      html = html.replace(s[0], `<!-- veil: skipped oversized script ${s[2]} -->`);
    }
  }

  /* <link rel=stylesheet> */
  const links = [...html.matchAll(/<link\b([^>]*\brel=["']?stylesheet["']?[^>]*)>/gi)];
  for (const l of links) {
    const hm = /href=["']([^"']+)["']/i.exec(l[0]);
    if (!hm) continue;
    const r = await fetchSmart(hm[1], base);
    if (r && addBudget(r, ctx)) {
      const css = await inlineCSS(r.text(), r.url, ctx);
      html = html.replace(l[0], `<style>\n${safeCSS(css)}\n</style>`);
      sources.push({ text: css, baseUrl: (r.url.match(/.*\//) || [""])[0] });
    }
  }

  /* inline <style> blocks */
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
  for (const st of styles) {
    const css = await inlineCSS(st[1], base, ctx);
    if (css !== st[1]) html = html.replace(st[0], `<style>${safeCSS(css)}</style>`);
  }

  /* static media attrs: img src, audio/video/source src, poster, favicon */
  const MEDIA_ATTR = /(\b(?:src|poster|data-src|href)\s*=\s*)(["'])((?:(?!data:|blob:|javascript:|#)[^"'\s>]+\.(?:png|jpe?g|gif|webp|svg|ico|bmp|mp3|ogg|wav|m4a|mp4|webm)))(["'])/gi;
  const mediaJobs = [...html.matchAll(MEDIA_ATTR)];
  for (const j of mediaJobs) {
    const r = await fetchSmart(j[3], base);
    if (r && addBudget(r, ctx)) {
      const uri = dataURI(r, j[3]);
      const rebuilt = `${j[1]}${j[2]}${uri}${j[4]}`;
      html = html.split(j[0]).join(rebuilt);
    }
  }

  /* scan every JS/CSS source for asset literals — each resolved against
     the base of the file it came from (multi-base), absolute URLs as-is */
  const map = {};
  const literals = new Set();
  for (const src2 of sources) {
    for (const l of scanLiterals(src2.text)) literals.add(l + "\u0000" + src2.baseUrl);
  }
  for (const s of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const l of scanLiterals(s[1])) literals.add(l + "\u0000" + base);
  }
  for (const s of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const l of scanLiterals(s[1])) literals.add(l + "\u0000" + base);
  }
  /* ruffle package probe: the core.ruffle.<hash>.js names are built by
     concatenation (never literals) — list the package dir instead */
  for (const dir of ruffleProbes) {
    try {
      const listing = await (await fetch(dir.replace(/cdn\.jsdelivr\.net\/npm\//, "data.jsdelivr.com/v1/packages/npm/").replace(/\/$/, ""), { signal: AbortSignal.timeout(10000) }).catch(() => null))?.json();
      const flat = [];
      (function walk(fs) { for (const f of fs || []) { if (f.type === "directory") walk(f.files); else flat.push(f.name); } })(listing?.files);
      for (const name of flat) {
        if (/\.wasm$/.test(name) || /^core\.ruffle\.[^.]+\.js$/.test(name)) literals.add(name + "\u0000" + dir);
      }
    } catch {}
  }

  let fetched = 0, failed = 0;
  const litList = [...literals];
  const litResults = await pool(litList, 8, async (combo) => {
    const parts = combo.split("\u0000");
    const lit = parts[0], litBase = parts[1] || base;
    let r;
    if (/^https?:\/\//i.test(lit)) { r = await fetchRes(lit); if (!r.ok) r = null; }
    else r = await fetchSmart(lit, litBase);
    return { lit, litBase, r };
  });
  for (const res of litResults) {
    const { lit, r } = res;
    if (!r) { failed++; continue; }
    if (!addBudget(r, ctx)) continue;
    const uri = dataURI(r, r.url || lit);
    try {
      const abs = /^https?:\/\//i.test(lit) ? lit : new URL(lit, res.litBase || base).href;
      map[abs] = uri;
      if (r.url && !map[r.url]) map[r.url] = uri;
      const clean = abs.split("#")[0].split("?")[0];
      if (!map[clean]) map[clean] = uri;
      fetched++;
    } catch {}
  }

  /* inject the shim right after <head> (before everything else) */
  html = html.replace(/<head([^>]*)>/i, (m0) => m0 + "\n" + shim(base, map));

  const pretty = PRETTY[id] || null;
  const out = {
    id, ok: true, base, title: pretty || id,
    bytes: Buffer.byteLength(html, "utf8"), resBytes: ctx.bytes,
    resources: ctx.count, literals: literals.size,
    fetched, failed, ms: Date.now() - t0,
  };
  writeFileSync(join(OUT_DIR, `${id}.html`), html);
  return out;
}

/* ============ main ============ */
let spent = 0;
const results = [];
/* resume support: already-inlined games are skipped */
const pending = ids.filter((id) => {
  try { return statSync(join(OUT_DIR, `${id}.html`)).size < 200; } catch { return true; }
});
if (pending.length < ids.length) console.log(`resuming: ${ids.length - pending.length} already inlined, ${pending.length} to go`);

/* games run 4-at-a-time (each with 8-way resource fetches) */
const batchResults = await pool(pending, 4, (id) => inlineGame(id));
for (const r of batchResults) {
  if (!r) continue;
  if (r.ok && r.bytes < PER_GAME_MB * 1048576 * 1.5) {
    results.push(r);
  } else {
    console.log(`X ${r.id.padEnd(42)} ${r.ok ? `too big (${(r.bytes / 1048576).toFixed(1)}MB)` : r.why}`);
  }
}
/* plus any previously-inlined games (for the manifest) */
for (const id of ids) {
  if (pending.includes(id)) continue;
  try {
    const st = statSync(join(OUT_DIR, `${id}.html`));
    if (st.size >= 200) results.push({ id, ok: true, title: PRETTY[id] || id, bytes: st.size, resBytes: 0, resources: 0, literals: 0, fetched: 0, failed: 0, ms: 0 });
  } catch {}
}
for (const r of results) {
  spent += r.bytes;
  console.log(
    `+ ${r.id.padEnd(42)} ${(r.bytes / 1048576).toFixed(2).padStart(7)}MB` +
    (r.title !== r.id ? `  - ${r.title}` : "")
  );
}

const manifest = results
  .filter((r) => !r.tooBig)
  .map(({ id, title, bytes, resources }) => ({ id, title, bytes, resources }));
writeFileSync(join(OUT_DIR, "stash-embed.json"), JSON.stringify(manifest, null, 2));
console.log(
  `\n── pack: ${manifest.length}/${ids.length} games · ${(spent / 1048576).toFixed(2)}MB embedded ` +
  `→ ${OUT_DIR}/stash-embed.json`
);
