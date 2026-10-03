/**
 * Veil single-file build — Veil's own UI on the WISP-style engine.
 *
 * Engine: the GUST single-file browser (upload/index.html — libcurl.js
 * WASM + WISP tunneling, no service worker, runs from file://).
 * The engine's OWN UI is hidden entirely; scripts/veil-shell.* inject
 * the Veil site's design (newtab + control bar + sections) and drive
 * the engine through its hidden controls.
 *
 * Wallpaper pack: embedded at NATIVE resolution (4K where the source
 * is 4K) as inert <script type="text/veil-asset"> blocks (fast HTML
 * parse, no giant JSON.parse); thumbs ship as small data URIs.
 *
 * Attribution (AGPL-3.0, engine by github.com/nautilus-os/GUST) is
 * kept as a header comment in the output — required and honest.
 *
 * Run:  bun scripts/build-veil.mjs
 */
import { readFileSync, writeFileSync, statSync, openSync, writeSync, closeSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/home/z/my-project";
const GUST = join(ROOT, "upload/index.html");
const ASSETS = "/tmp/veil-offline-assets";
const SHELL_CSS = join(ROOT, "scripts/veil-shell.css");
const SHELL_HTML = join(ROOT, "scripts/veil-shell.html");
const SHELL_JS = join(ROOT, "scripts/veil-shell.js");
const OUT = join(ROOT, "download/veil-offline.html");

/* ── the set pack (mirrors UPLOADED_PACK in src/lib/veil/wallpapers.ts) ── */
const PACK = [
  { key: "backrooms",           kind: "video", name: "Backrooms",               tags: ["live", "dark", "abstract"],    desc: "Endless yellow hallways" },
  { key: "cherry-blossom",      kind: "video", name: "Cherry Blossom",          tags: ["live", "nature", "aesthetic"], desc: "Petals on the wind" },
  { key: "trionda-ball",        kind: "video", name: "Trionda Ball",            tags: ["live", "abstract"],            desc: "Rolling geometry" },
  { key: "minecraft-earth",     kind: "video", name: "Minecraft Earth",         tags: ["live", "minecraft", "nature"], desc: "A whole world turning" },
  { key: "minecraft-fireplace", kind: "video", name: "Minecraft Fireplace",     tags: ["live", "minecraft", "aesthetic"], desc: "Cozy blocky embers" },
  { key: "spiderman-gravity",   kind: "video", name: "Spider-Man — Gravity",    tags: ["live", "spider-man", "superhero"], desc: "Falling with style" },
  { key: "mobile-video",        kind: "video", name: "Motion Loop I",           tags: ["live", "aesthetic"],           desc: "Ambient drift" },
  { key: "mobile-video2",       kind: "video", name: "Motion Loop II",          tags: ["live", "aesthetic"],           desc: "Ambient drift, again" },
  { key: "neon-aurora",         kind: "image", ext: "png", name: "Neon Aurora",        tags: ["static", "aesthetic", "abstract"], desc: "Electric skies" },
  { key: "cubes",               kind: "image", ext: "jpg", name: "Cube Field",           tags: ["static", "abstract"],          desc: "Isometric calm" },
  { key: "jellyfish",           kind: "image", ext: "jpg", name: "Jellyfish Drift",       tags: ["static", "nature", "aesthetic"], desc: "Deep-sea lanterns" },
  { key: "lake",                kind: "image", ext: "jpg", name: "Still Lake",            tags: ["static", "nature"],            desc: "Mirror water" },
  { key: "minecraft-bee",       kind: "image", ext: "png", name: "Minecraft Bee",         tags: ["static", "minecraft"],         desc: "The pollinator at rest" },
  { key: "minecraft-blocks",    kind: "image", ext: "jpg", name: "Minecraft Blocks",      tags: ["static", "minecraft"],         desc: "Terrain, cubed" },
  { key: "spiderman",           kind: "image", ext: "jpg", name: "Spider-Man Art",        tags: ["static", "spider-man", "superhero"], desc: "Web-head, inked" },
  { key: "aluminium",           kind: "image", ext: "jpg", name: "Liquid Aluminium",      tags: ["static", "abstract", "aesthetic"], desc: "Molten chrome waves" },
  { key: "apocalyptic",         kind: "image", ext: "png", name: "Apocalyptic Skyline",   tags: ["static", "dark", "fantasy"],   desc: "The last city" },
];

/* Procedural themes (same gradients the Veil app ships) */
const THEME_LIST = [
  { key: "sulfur",  name: "Sulfur Drift",   tags: ["live", "abstract", "aesthetic"], desc: "Warm amber particles adrift" },
  { key: "emerald", name: "Emerald Tide",   tags: ["live", "abstract"],              desc: "Deep green gradients breathing" },
  { key: "aurora",  name: "Aurora Field",   tags: ["live", "nature", "aesthetic"],   desc: "Northern lights, procedurally" },
  { key: "nebula",  name: "Nebula Bloom",   tags: ["live", "space", "abstract"],     desc: "A galaxy slowly blooming" },
  { key: "grid",    name: "Vapor Grid",     tags: ["live", "cyberpunk", "abstract"], desc: "Endless synthwave horizon" },
  { key: "sunset",  name: "Synth Sunset",   tags: ["live", "aesthetic"],             desc: "A sun that never quite sets" },
  { key: "ocean",   name: "Deep Current",   tags: ["live", "nature"],                desc: "Caustic light underwater" },
  { key: "ash",     name: "Ash & Ember",    tags: ["live", "dark", "abstract"],      desc: "Embers rising from grey" },
  { key: "mono",    name: "Mono Waves",     tags: ["live", "minimal", "abstract"],   desc: "Greyscale sine waves" },
];
const THEMES = {}; /* the shell computes theme gradients itself — kept for compat */

const VEIL_FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2334d399' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 22s8-3.6 8-10V5.5L12 2 4 5.5V12c0 6.4 8 10 8 10Z'/%3E%3Cpath d='M9 12h2v4'/%3E%3C/svg%3E";

const b64 = (p) => readFileSync(p).toString("base64");
const fsize = (p) => statSync(p).size;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const IMG_MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webm: "video/webm", mp4: "video/mp4" };
const SKIP_MEDIA = process.env.VEIL_SKIP_MEDIA === "1"; /* dry-run: no media bytes */

/* ── 1. pack manifest + thumbs (small JSON) + asset blocks (raw text) ── */
let mediaBytes = 0;
let missing = [];
const packJson = [];
const thumbsJson = {};
const assetBlocks = [];
for (const w of PACK) {
  const ext = w.ext || (w.kind === "video" ? "mp4" : "jpg");
  const mime = IMG_MIME[ext] || "application/octet-stream";
  const src = join(ASSETS, `${w.key}.${ext}`);
  const thumb = join(ASSETS, `thumb-${w.key}.jpg`);
  if (SKIP_MEDIA) {
    packJson.push({ id: `up-${w.key}`, key: w.key, name: w.name, kind: w.kind, tags: w.tags, desc: w.desc, mime });
    continue;
  }
  let ok = true;
  try { mediaBytes += fsize(src); } catch { ok = false; missing.push(w.key); }
  if (ok) {
    packJson.push({ id: `up-${w.key}`, key: w.key, name: w.name, kind: w.kind, tags: w.tags, desc: w.desc, mime });
    assetBlocks.push(`<script type="text/veil-asset" id="veilA:${w.key}" data-mime="${mime}">${b64(src)}</script>`);
    try { thumbsJson[w.key] = `data:image/jpeg;base64,${b64(thumb)}`; } catch { /* optional */ }
  }
}
if (missing.length && !SKIP_MEDIA) {
  console.warn(`⚠ missing media assets (skipped in pack): ${missing.join(", ")}`);
  console.warn(`  run scripts/prepare-offline-assets.sh first`);
}

/* ── 1b. the stash pack — fully-inlined games (inline-stash.mjs) ──
   Each game ships as ONE base64 veil-asset block (key "stash:<id>") —
   base64 because raw game HTML contains literal "</script>" sequences
   that would terminate the host script tag early. The pack is the
   shrunk build (shrink-stash.mjs): every resource byte stored once. */
const STASH_DIR = join(ASSETS, "stash");
const STASH_PRETTY_PATH = join(ROOT, "public/arcade/stash-titles.json");
let stashEmbed = {}; /* id → bytes — the shell's embedded flag */
let stashList = []; /* the full catalog (embedded + CDN-only ids) */
let stashPretty = {}; /* id → pretty title */
let stashFiles = []; /* { id, path } — streaming write, one at a time */
let stashBytes = 0;
try {
  const manifest = JSON.parse(readFileSync(join(STASH_DIR, "stash-embed.json"), "utf8"));
  stashPretty = JSON.parse(readFileSync(STASH_PRETTY_PATH, "utf8"));
  for (const e of manifest) {
    const p = join(STASH_DIR, `${e.id}.html`);
    let size;
    try { size = fsize(p); } catch { continue; }
    stashEmbed[e.id] = size;
    stashBytes += size;
    stashFiles.push({ id: e.id, path: p });
  }
  if (!stashFiles.length) throw new Error("no game files found");
  stashList = Object.keys(stashPretty);
} catch (e) {
  console.warn(`⚠ stash pack not embedded: ${e.message}`);
  console.warn("  run: bun scripts/inline-stash.mjs && bun scripts/shrink-stash.mjs");
}
if (stashList.length) {
  /* the embedded catalog renders in pretty-name order, like the site */
  stashList.sort((a, b) => String(stashPretty[a] || a).localeCompare(String(stashPretty[b] || b)));
}

/* ── 1b-2. curated titles — some catalog entries carry placeholder
   names from their source pages ("Game 24875", "cool ixl work",
   "Unity WebGL Player", mojibake). Fixed here so pack pages and the
   embedded catalog read right. */
const TITLE_OVERRIDES = {
  /* pack III picks */
  clyourturntodie: "Your Turn To Die",
  cldeltatraveler: "Delta Traveler",
  clwebfishing: "Web Fishing",
  clfnfvoid: "FNF VS Void",
  clgarcello: "FNF: Garcello Mod",
  clfnfwhitty: "FNF VS Whitty",
  clfnfmiku: "FNF: Miku Mod",
  clfnfneo: "FNF: Neo Mod",
  clfnfzardy: "FNF VS Zardy",
  cldogeminer2: "Dogeminer 2",
  clbaldidecomp: "Baldi's Basics: Ultra Decompile",
  /* pack IV picks */
  clquake: "Quake",
  clhalflife: "Half-Life (Xash3D)",
  cltiberiandawn: "Command & Conquer",
  clredalert: "Command & Conquer: Red Alert",
  clpostal: "POSTAL 1",
  clsonic1mobile: "Sonic The Hedgehog",
  clsonic2mobile: "Sonic The Hedgehog 2",
  clceleste: "Celeste Classic (PICO-8)",
  clceleste2: "Celeste Classic 2",
  cltouhou: "Touhou 1: Highly Responsive to Prayers",
  cltouhou2: "Touhou 2: Story of Eastern Wonderland",
  cltouhou3: "Touhou 3: Phantasmagoria of Dim. Dream",
  cltouhou4: "Touhou 4: Lotus Land Story",
  cltouhou5: "Touhou 5: Mystic Square",
  cltaisei: "Taisei Project",
  clmario64webgl: "Super Mario 64 (WebGL)",
  clsmbremastered: "Super Mario Bros Remastered",
  clHelltaker: "Helltaker",
  clBountyOfOne: "Bounty of One",
  clspelunky: "Spelunky Classic HD",
  /* junk-title rescue round — source pages carried engine splash
   * screens ("Clickteam Fusion… Runtime"), template variables
   * ("${pageTitle}") and SEO spam ("Play it now at CoolmathGames.com") */
  clBrawlstars: "Brawl Stars Clicker",
  cldrweedgaster: "Dr. Weedgaster",
  cljumbomario: "Jumbo Mario",
  clmotox3mm: "Moto X3M",
  clskywire2: "Skywire 2",
  clomegalayers: "Omega Layers",
  clplinko: "Plinko",
  clpushyourluck: "Push Your Luck",
  clgrowmi: "Growmi",
  cltagcm: "Tag",
};
for (const [k, v] of Object.entries(TITLE_OVERRIDES)) stashPretty[k] = v;
if (stashList.length) {
  stashList.sort((a, b) => String(stashPretty[a] || a).localeCompare(String(stashPretty[b] || b)));
}

/* ── 1c. extension split — the small/mid games ride inside the base
   file (~240MB window); the heavy titles ship as drop-in packs
   (veil-ext-*.html) that install by drag-drop. Custom splits can pin
   exact game ids per pack via scripts/veil-ext-packs.json — leave a
   pack's "games" empty to auto-balance, or list ids to curate one
   (that's how the next extension gets authored). */
const PACKS_CFG_PATH = join(ROOT, "scripts/veil-ext-packs.json");
let packsCfg = { baseBudgetMB: 87, packs: [] };
try { packsCfg = JSON.parse(readFileSync(PACKS_CFG_PATH, "utf8")); } catch (e) { /* defaults */ }
const BASE_BUDGET = Math.max(8, Number(packsCfg.baseBudgetMB) || 87) * 1024 * 1024;

for (const g of stashFiles) g.bytes = fsize(g.path);
const asc = [...stashFiles].sort((a, b) => a.bytes - b.bytes);
const baseGames = [];
let baseGameBytes = 0;
for (const g of asc) {
    if (baseGameBytes + g.bytes > BASE_BUDGET) break;
    baseGames.push(g);
    baseGameBytes += g.bytes;
}
const taken = new Set(baseGames.map((g) => g.id));
const packDefs = [];
for (const p of packsCfg.packs || []) {
    if (!p || !p.id) continue;
    const games = (p.games || []).map((id) => stashFiles.find((g) => g.id === id)).filter(Boolean);
    for (const g of games) taken.add(g.id);
    packDefs.push({
        id: p.id, name: p.name || p.id, desc: p.desc || "",
        file: p.file || `veil-ext-${packDefs.length + 1}.html`,
        games,
    });
}
if (!packDefs.length) {
    packDefs.push({ id: "stash-1", name: "Stash Pack I", desc: "", file: "veil-ext-games-1.html", games: [] });
    packDefs.push({ id: "stash-2", name: "Stash Pack II", desc: "", file: "veil-ext-games-2.html", games: [] });
}
/* auto-fill: the remaining titles, balanced across the unfilled packs
   (largest game → currently-lightest pack) */
const rest = stashFiles.filter((g) => !taken.has(g.id)).sort((a, b) => b.bytes - a.bytes);
const packWeight = (p) => p.games.reduce((s, x) => s + x.bytes, 0);
for (const g of rest) {
    let target = packDefs[0];
    for (const p of packDefs) if (packWeight(p) < packWeight(target)) target = p;
    target.games.push(g);
}
const baseEmbed = {};
for (const g of baseGames) baseEmbed[g.id] = g.bytes;

/* ── 2. GUST → Veil engine transform ─────────────────────────── */
let html = readFileSync(GUST, "utf8");
const before = html.length;

/* 2a. fonts: Geist + Geist Mono (the app's own faces) */
const GF_OLD = "family=JetBrains+Mono:wght@400;600&family=Space+Grotesk:wght@400;500;600;700&display=swap";
const GF_NEW = "family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;600&display=swap";
html = html.split(GF_OLD).join(GF_NEW);
html = html.split("Space Grotesk").join("Geist");
html = html.split("JetBrains Mono").join("Geist Mono");

/* 2a-2. radii — Veil uses 12/16px */
html = html.split("--radius-md: 10px").join("--radius-md: 12px");
html = html.split("--radius-lg: 20px").join("--radius-lg: 16px");

/* 2a-3. internal pseudo-scheme (all functional, consistent) */
html = html.split("gust://").join("veil://");

/* 2b. root palette — zinc + emerald (engine surfaces that remain visible:
      the error overlay, internal pages) */
html = html.replace(
  /(:root\s*\{)([\s\S]*?)(\})/,
  (m, open, body, close) => {
    const map = {
      "--bg0: #0d0f12": "--bg0: #09090b",
      "--bg1: #181c21": "--bg1: #18181b",
      "--bg2: #1c2026": "--bg2: #1f1f23",
      "--bg3: #252b33": "--bg3: #27272a",
      "--bg-elevated: #161a1f": "--bg-elevated: #131316",
      "--bd: #4f5963": "--bd: #3f3f46",
      "--bd2: #5a6370": "--bd2: #52525b",
      "--tx: #f0f4f8": "--tx: #fafafa",
      "--tx2: #b8c4d0": "--tx2: #a1a1aa",
      "--tx3: #7d8a98": "--tx3: #71717a",
      "--ac: #9de5ff": "--ac: #34d399",
      "--ac2: #70d4ff": "--ac2: #10b981",
      "--ok: #8aefb0": "--ok: #34d399",
    };
    let out = body;
    for (const [from, to] of Object.entries(map)) out = out.split(from).join(to);
    return open + out + close;
  }
);
html = html.split("#9de5ff").join("#34d399");
html = html.split("rgba(157,229,255").join("rgba(52,211,153");
html = html.split("rgba(157, 229, 255").join("rgba(52, 211, 153");
html = html.split("rgba(100,210,255").join("rgba(16,185,129");
html = html.split("rgba(100, 210, 255").join("rgba(16, 185, 129");
html = html.split("#70d4ff").join("#10b981");
html = html.split("rgba(112,212,255").join("rgba(16,185,129");
html = html.split("rgba(112, 212, 255").join("rgba(16, 185, 129");

/* 2c. head: title, description, favicon */
html = html.replace(
  /<meta name="description" content="[^"]*" \/>/,
  '<meta name="description" content="Veil — the whole web, through the veil." />'
);
html = html.replace(/<title>[^<]*<\/title>/, "<title>Veil</title>");
html = html.replace(
  /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,[^"]*" \/>/,
  `<link rel="icon" type="image/svg+xml" href="${VEIL_FAVICON}" />`
);

/* 2e. remaining visible "GUST" tokens — word-boundary safe */
html = html.replace(/\bGUST\+/g, "Veil+");
html = html.replace(/\bGUST\b/g, "Veil");
html = html.replace(/GUST's/g, "Veil's");
html = html.replace(/(?<![a-zA-Z0-9_:\-.])gust(?![a-zA-Z0-9_:\-.])/g, "veil");

/* 2f. brand strings */
html = html.split("Nautilus Labs").join("Veil Labs");
/* the engine's own repo self-link must stay real (AGPL) */
html = html.split("nautilus-os/Veil").join("nautilus-os/GUST");
html = html.split("The team behind GUST").join("The team behind Veil");
html = html.split("favorites = raw ? JSON.parse(raw) : [{ url: DISCORD_INTERNAL, name: 'Discord' }];").join(
  "favorites = raw ? JSON.parse(raw) : [];"
);

/* ── 2g. search engine = the website's engine (Bing) ────────── */
html = html.replace(
  /return ls\.getItem\('gust:engine:v1'\) \|\| 'ddg'; \} catch \{ return 'ddg'; \}/,
  "return ls.getItem('gust:engine:v1') || 'bing'; } catch { return 'bing'; }"
);
html = html.split('const key = selectedEngine || "ddg";').join('const key = selectedEngine || "bing";');

/* ── 2h. Bing identity-flow fix (the "Bing having troubles" bug) ──
      Through WISP relays, bing.com's anonymous-id handshake
      (form-POST to /identity/idtokenv2) answers 200 with an EMPTY
      body instead of the expected 302-back — the engine then renders
      that empty doc as the page → blank frame, every search. Fix at
      three layers: page-script submit interceptor, programmatic
      form.submit() override, and identity GET navigations bounce to
      the Bing homepage (exactly where Bing's own 302 sends you). */
html = html.split("const action = resolve(form.action || BASE);").join(
  "const action = resolve(form.action || BASE);" +
  "try { const _vb = new URL(action); if (/(^|\\.)bing\\.com$/.test(_vb.hostname) && _vb.pathname.indexOf('/identity/') === 0) return; } catch (e2) {}"
);
html = html.split("const action = resolve(form.getAttribute('action') || BASE);").join(
  "const action = resolve(form.getAttribute('action') || BASE);" +
  "try { const _vb2 = new URL(action); if (/(^|\\.)bing\\.com$/.test(_vb2.hostname) && _vb2.pathname.indexOf('/identity/') === 0) return; } catch (e3) {}"
);
html = html.split("function canonicalizeHost(url) {").join(
  "function canonicalizeHost(url) {" +
  "try { if (/(^|\\.)bing\\.com$/.test(url.hostname) && /^\\/identity\\//.test(url.pathname)) { url.hostname = 'www.bing.com'; url.pathname = '/'; url.search = ''; url.hash = ''; } } catch (e4) {}"
);

/* ── 2h-2. session restore — REMOVED by user directive: a restart
      always lands on the start page. GUST saved its whole tab strip to
      gust:tabs:v1 and rehydrated it at boot ("loadTabs"); the build
      scrubs the key right before the restore so the engine boots its
      FRESH-INSTALL path (empty strip, the newtab panel active — exactly
      the website's "restart = start page" contract). Bookmarks,
      favorites, cookies and the wallpaper stay (not session state). */
html = html.split("const tabsLoaded = loadTabs();").join(
  "const tabsLoaded = (function () { try { ls.removeItem(TAB_CACHE_KEY); } catch (e) { } return loadTabs(); })();"
);

/* 2i-1. user-visible engine strings — relay/veil wording.
      The engine's internals (minified identifiers, WASM binding names
      like request_set_proxy, storage keys) stay untouched — only the
      strings a user can actually read are reworded. */
const ENGINE_STRINGS = [
  ["The connection to the proxy server was interrupted", "The connection to the relay was interrupted"],
  ["The proxy server may have briefly disconnected", "The relay may have briefly disconnected"],
  ["The website might not support proxy access", "The website might not support relayed access"],
  ["Some sites block proxy connections", "Some sites block relayed connections"],
  ["Use Proxy", "Use Relay"],
  ["Switch Proxy", "Switch Relay"],
  ["Proxy Authentication Required", "Relay Authentication Required"],
  ["websocket proxy url not set", "websocket relay url not set"],
  ["diagnosing proxy or network issues", "diagnosing connection or network issues"],
  ["through the WISP proxy", "through the WISP relay"],
  ["run through the proxy", "run through the relay"],
  ["retry using the fallback proxy", "retry using the fallback relay"],
  ["route favicons through the proxy", "route favicons through the veil"],
  ['"only through the proxy" guarantee', '"only through the veil" guarantee'],
  ["itch.io free games", "itch.io freebies"],
  ["Epic free games", "Epic freebies"],
  ["PC Gamer RSS via proxy", "pcgamer.com RSS via the veil"],
  /* engine code comments (invisible at runtime, reworded for the scrub) */
  ["WebSocket proxy tunnelling", "WebSocket relay tunnelling"],
  ["Set base href before proxy script injection", "Set base href before veil script injection"],
  ["The proxy script click handler", "The veil script click handler"],
  ["Insert proxy script as very first child", "Insert veil script as very first child"],
  ["the JS-enabled proxy frame", "the JS-enabled veil frame"],
  ["a full proxy bypass", "a full tunnel bypass"],
  ["are fetched through the proxy and re-pointed", "are fetched through the veil and re-pointed"],
  ["route them through the proxy once they land", "route them through the veil once they land"],
  ["through the proxy instead of causing a native", "through the veil instead of causing a native"],
  ["re-route it through the proxy immediately", "re-route it through the veil immediately"],
  ["route to the real proxy instead of a middle frame", "route to the real engine instead of a middle frame"],
  ["Runs independently of the main proxy script", "Runs independently of the main veil script"],
  ["it yields the location proxy only when", "it yields the location view only when"],
  ["Reload the page so the proxy script is re-injected", "Reload the page so the veil script is re-injected"],
  ["running the proxy runtime and", "running the veil runtime and"],
  ["they fire outside the proxy tunnel in a blob iframe", "they fire outside the veil tunnel in a blob iframe"],
  ["on any proxy failure we fall back", "on any relay failure we fall back"],
  ["ensure that the proxy url has a valid protocol", "ensure that the relay url has a valid protocol"],
  ["applications using wsproxy can easily", "applications using the websocket layer can easily"],
  ["links never escape the proxy iframe", "links never escape the veil iframe"],
  ["//parse the wsproxy url", "//parse the ws url"],
  ["stays right after the proxy script", "stays right after the injected script"],
  ["built inside the proxy runtime via window", "built inside the veil runtime via window"],
  ["Empty proxy response", "Empty veil response"],
  ["if the proxy script has an error", "if the veil script has an error"],
  ["Insert right after the proxy script", "Insert right after the engine script"],
  ["Proxy favicons through WISP", "Route favicons through WISP"],
  ["Only proxy relative or http(s) specifiers", "Only route relative or http(s) specifiers"],
  ["ES module graph proxy loader", "ES module graph veil loader"],
  ["All proxy communication targets", "All engine communication targets"],
  ["when its own proxy fetch resolves", "when its own veil fetch resolves"],
  ["through the proxy and render it as a self-contained blob", "through the veil and render it as a self-contained blob"],
  ["Resolve proxy favicons asynchronously", "Resolve site favicons asynchronously"],
  ["but our proxy fetch is async", "but our veil fetch is async"],
];
for (const [from, to] of ENGINE_STRINGS) html = html.split(from).join(to);
/* Hidden-UI quick-link + category labels (external URLs stay functional) */
html = html.split("'PC Gamer'").join("'PC Gaming'");
html = html.split("['Games',").join("['Play',");

/* 2i. attribution header — AGPL notice for the vendored engine */
html = html.replace(
  "<head>",
  `<head>
<!-- ══════════════════════════════════════════════════════════════
     Veil — single-file build. UI & design: Veil.
     Browsing engine: GUST — https://github.com/nautilus-os/GUST
     (AGPL-3.0, © its authors), vendored & modified: Veil UI shell,
     WISP defaults, Bing default + identity-flow fix, wallpaper pack.
     This file therefore ships under AGPL-3.0.
     Embedded third-party: libcurl.js (curl license), acorn (MIT).
     ══════════════════════════════════════════════════════════════ -->`
);

/* 2j. boot-benchmark bridge — the engine appends its own relay-benchmark
      splash (z-99995, ABOVE the shell) right after libcurl loads. It
      toggles an html class so the shell's boot cover can span the whole
      boot (parse → WASM → relay benchmark → newtab) with ONE consistent
      black + emerald screen. */
html = html.split("function showBootBenchmark() {").join(
  "function showBootBenchmark() { try { document.documentElement.classList.add('veil-bench'); } catch (e) {}"
);
html = html.split("function hideBootBenchmark() {").join(
  "function hideBootBenchmark() { try { document.documentElement.classList.remove('veil-bench'); } catch (e) {}"
);

/* 2k. multiplayer WebSockets — colyseus/Node-"ws" style call fix.
      Libraries like colyseus (bloxd.io's multiplayer client) call
      new WebSocket(url, { headers, protocols }) FIRST — the Node "ws"
      signature. In a plain browser that throws synchronously and the
      library catches + retries with plain protocols. But through THIS
      engine the page-side WebSocket patch never throws (it postMessages
      to the host), so the first attempt becomes the ONLY attempt — and
      CurlWebSocket does protocols.join(", ") which crashes on the
      options object → the game's server connection dies as an async
      error ("no internet connection"). Sanitize in handleWsOpen so the
      object form resolves to its .protocols array (or undefined). */
html = html.split("const ws = new libcurl.WebSocket(url, protocols || undefined);").join(
  "const ws = new libcurl.WebSocket(url, Array.isArray(protocols) ? protocols : (typeof protocols === 'string' && protocols) ? protocols : (protocols && Array.isArray(protocols.protocols)) ? protocols.protocols : undefined);"
);

/* ── 3. inject the Veil shell ───────────────────────────────── */
const css = readFileSync(SHELL_CSS, "utf8");
const dom = readFileSync(SHELL_HTML, "utf8");
const js = readFileSync(SHELL_JS, "utf8");

/* 3-0. FIRST-PAINT BOOT COVER — the initial loading screen.
   The engine's ~3.8MB of markup + scripts parse for several seconds
   before the shell chunk (injected at the body END) can turn on
   #veilLoad. This inline-styled twin sits as the FIRST child of <body>
   so it paints on the very first body layout: black screen + emerald
   sweep bar + spinning wheel + VEIL mark — identical to the site's
   loading screen. The shell's revealWhenReady() fades it out once the
   engine + document are ready. */
const bodyOpen = html.search(/<body[^>]*>/i);
if (bodyOpen === -1) throw new Error("no <body> in engine HTML");
const bodyOpenEnd = html.indexOf(">", bodyOpen) + 1;
const BOOT_SWEEP = "__veilBootSweep";
const bootCover = `<div id="veilBoot" aria-hidden="true" style="position:fixed;inset:0;z-index:2147483647;background:#09090b;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;opacity:1;transition:opacity .3s ease">
  <div style="position:absolute;left:0;right:0;top:0;height:3px;overflow:hidden;background:rgba(16,185,129,.1)">
    <div style="position:absolute;inset:0;width:50%;background:linear-gradient(to right,transparent,#34d399,transparent);animation:${BOOT_SWEEP} 1.1s ease-in-out infinite"></div>
  </div>
  <div style="position:relative;width:40px;height:40px">
    <div style="position:absolute;inset:0;border-radius:999px;border:3px solid #27272a"></div>
    <div style="position:absolute;inset:-3px;border-radius:999px;border:3px solid transparent;border-top-color:#34d399;animation:__veilBootSpin .9s linear infinite"></div>
  </div>
  <div style="display:flex;align-items:center;gap:8px;opacity:.8">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-3.6 8-10V5.5L12 2 4 5.5V12c0 6.4 8 10 8 10Z"/><path d="M9 12h2v4"/></svg>
    <span style="font-size:12px;font-weight:500;letter-spacing:.2em;color:#71717a;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">VEIL</span>
  </div>
  <style>@keyframes ${BOOT_SWEEP}{from{transform:translateX(-100%)}to{transform:translateX(250%)}}@keyframes __veilBootSpin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){#veilBoot div{animation-duration:2.2s!important}}</style>
</div>\n`;
html = html.slice(0, bodyOpenEnd) + bootCover + html.slice(bodyOpenEnd);

/* CSS: right before the first </style> (head) — no flash of engine chrome */
const styleClose = html.indexOf("</style>");
html =
  html.slice(0, styleClose) +
  "\n/* ═══ Veil shell ═══ */\n" +
  css +
  "\n" +
  html.slice(styleClose);

/* DOM + pack + JS BEFORE the asset blocks: the shell boots as soon as its
   script parses (the engine's markup is ahead of it), while the ~93MB of
   inert base64 asset text parses in the background behind the boot cover.
   Assets are read lazily (assetBlob) once they exist. */

/* Streamed assembly — the output is ~¼–⅔ of a GB, so files are written
   in chunks (per-asset) instead of one giant string join. */
const wchunk = (fd, s) => {
  const CH = 1 << 23; /* 8MB slices */
  for (let i = 0; i < s.length; i += CH) writeSync(fd, s.slice(i, i + CH));
};

/* ── 3b. extension pack files — written FIRST so the base's catalog
   can carry their true file sizes. Layout: a small standalone page
   (opens fine in any browser, explains itself) + the VEIL-EXT
   manifest as the FIRST body child (head-readable) + the same
   veil-asset blocks the base uses. */
const SHIELD_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-3.6 8-10V5.5L12 2 4 5.5V12c0 6.4 8 10 8 10Z"/><path d="M9 12h2v4"/></svg>`;
function packPage(man, games) {
    const list = games.map((g) => {
        let nm = stashPretty[g.id] ? String(stashPretty[g.id]) : g.id;
        if (!nm || /^about:blank$/i.test(nm) || /^https?:/i.test(nm)) {
            /* the source page had no real title — fall back to the id */
            nm = String(g.id).replace(/^cl/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
        }
        return `<li><span>${esc(nm)}</span><span>${(g.bytes / 1048576).toFixed(1)} MB</span></li>`;
    }).join("\n    ");
    const mb = (man.bytes / 1048576).toFixed(0);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Veil Extension — ${esc(man.name)}</title>
<meta name="description" content="A Veil offline extension pack — ${man.games} embedded games, ${mb} MB.">
<link rel="icon" type="image/svg+xml" href="${VEIL_FAVICON}" />
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; margin: 0; }
body { min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: #09090b; color: #e4e4e7; padding: 24px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { width: 100%; max-width: 480px; padding: 28px; background: #131316;
  border: 1px solid #27272a; border-radius: 18px; box-shadow: 0 30px 80px rgba(0,0,0,.55); }
header { display: flex; align-items: center; gap: 9px; margin-bottom: 18px; }
header .k { font-size: 10.5px; font-weight: 700; letter-spacing: .22em; color: #34d399; }
h1 { font-size: 22px; font-weight: 700; color: #fafafa; letter-spacing: -.01em; }
.stats { margin: 6px 0 18px; font-size: 12.5px; color: #a1a1aa; }
ul { list-style: none; display: flex; flex-direction: column; gap: 4px; margin-bottom: 18px;
  max-height: 220px; overflow: auto; }
li { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; color: #d4d4d8;
  padding: 7px 12px; border-radius: 9px; background: rgba(39,39,42,.5); }
li span:last-child { color: #71717a; font-variant-numeric: tabular-nums; white-space: nowrap; }
.how { border: 1px dashed rgba(52,211,153,.35); border-radius: 12px; padding: 14px 16px;
  background: rgba(16,185,129,.05); }
.how b { display: block; font-size: 12px; color: #34d399; margin-bottom: 6px; }
.how p { font-size: 12.5px; line-height: 1.55; color: #a1a1aa; }
.sig { margin-top: 14px; font-size: 10.5px; color: #52525b; font-family: ui-monospace, monospace; }
@media (max-height: 640px) { ul { max-height: 120px; } }
</style>
</head>
<body>
<script type="text/veil-ext-manifest" id="veilExtManifest">${JSON.stringify(man)}</script>
<main>
  <header>${SHIELD_SVG}<span class="k">VEIL EXTENSION</span></header>
  <h1>${esc(man.name)}</h1>
  <p class="stats">${man.games} games · ${mb} MB · drop into veil-offline.html to unlock fully-offline play</p>
  <ul>
    ${list}
  </ul>
  <div class="how">
    <b>HOW TO INSTALL</b>
    <p>Open <b>veil-offline.html</b>, then drag this file anywhere onto the page — or hit <b>Extensions</b> on the dock (next to Settings) and choose this file. Every game above becomes an embedded title that plays with zero connection.</p>
  </div>
  <p class="sig">VEIL-EXT v1 · pack ${esc(man.id)} · built ${man.built}</p>
</main>
</body>
</html>
`;
}
const builtPacks = [];
for (const p of packDefs) {
    if (!p.games.length) continue;
    const raw = p.games.reduce((s, g) => s + g.bytes, 0);
    const man = {
        sig: "VEIL-EXT", v: 1, id: p.id, name: p.name, desc: p.desc,
        assets: p.games.map((g) => "stash:" + g.id),
        bytes: raw, games: p.games.length,
        built: new Date().toISOString().slice(0, 10),
    };
    const out = join(ROOT, "download", p.file);
    const fdP = openSync(out, "w");
    try {
        wchunk(fdP, packPage(man, p.games));
        for (const g of p.games) {
            wchunk(fdP, `<script type="text/veil-asset" id="veilA:stash:${g.id}" data-mime="text/html">`);
            wchunk(fdP, b64(g.path));
            wchunk(fdP, "</script>\n");
        }
        wchunk(fdP, "</body>\n</html>\n");
    } finally {
        closeSync(fdP);
    }
    builtPacks.push({ id: p.id, name: p.name, desc: p.desc, file: p.file, games: p.games.length, bytes: fsize(out), assets: man.assets });
    console.log(`pack “${p.name}”: ${p.games.length} games · ${(raw / 1048576).toFixed(1)} MB raw · file ${(fsize(out) / 1048576).toFixed(1)} MB → download/${p.file}`);
}

/* ── 3c. VEIL TOOLKIT PACKET — the general-purpose extension that
   REPLACES the sulfur packets (one pack, tools not games):
   scripts/tools-apps/*.html, each ONE self-contained page. Manifest
   carries appList; asset keys "app:tool-*", cats "tool"/"studio" →
   the Arcade's "toolkit" tab. Same install channel: drag-drop /
   Upload dock button / the toolkit tab. */
const TOOLS_DIR = join(ROOT, "scripts/tools-apps");
const TOOLS_PACKET = {
    id: "tools-1", name: "Veil Toolkit", file: "veil-ext-tools-1.html",
    desc: "the veil toolkit — general-purpose JavaScript tools, not games: notes, markdown, synth, drawing, timers, converters, colors, calc, passwords & json.",
    apps: [
        { key: "app:tool-sticky", file: "sticky.html", name: "Sticky Notes", icon: "notes", cat: "studio",
          desc: "color-coded stickies that remember everything" },
        { key: "app:tool-markdown", file: "markdown.html", name: "Markdown Editor", icon: "filetext", cat: "studio",
          desc: "write markdown, watch it render live with stats" },
        { key: "app:tool-synth", file: "synth.html", name: "WebAudio Synth", icon: "music", cat: "studio",
          desc: "a playable polyphonic synth with a scope" },
        { key: "app:tool-draw", file: "draw.html", name: "Drawing Pad", icon: "brush", cat: "studio",
          desc: "brushes, eraser, undo and PNG export" },
        { key: "app:tool-pomodoro", file: "pomodoro.html", name: "Pomodoro", icon: "timer", cat: "tool",
          desc: "25/5 focus timer with chimes plus a lap stopwatch" },
        { key: "app:tool-convert", file: "convert.html", name: "Unit Converter", icon: "swap", cat: "tool",
          desc: "length, mass, temperature, speed, data, area & time" },
        { key: "app:tool-color", file: "color.html", name: "Color Studio", icon: "palette", cat: "tool",
          desc: "pick, convert, contrast-check and palette colors" },
        { key: "app:tool-calc", file: "calc.html", name: "Calculator", icon: "calc", cat: "tool",
          desc: "expression calculator with history & keyboard input" },
        { key: "app:tool-passgen", file: "passgen.html", name: "Password Gen", icon: "key", cat: "tool",
          desc: "strong passwords & passphrases, entropy metered" },
        { key: "app:tool-json", file: "json.html", name: "JSON Formatter", icon: "braces", cat: "tool",
          desc: "format, validate, sort and highlight json" },
    ],
};
function toolsPackPage(man, apps) {
    const list = apps.map((a) => {
        return `<li><span>${esc(a.name)}</span><span>${(a.bytes / 1024).toFixed(0)} KB</span></li>`;
    }).join("\n    ");
    const mb = (man.bytes / 1048576).toFixed(1);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Veil Extension — ${esc(man.name)}</title>
<meta name="description" content="A Veil offline extension pack — ${man.apps} self-contained tool apps, ${mb} MB.">
<link rel="icon" type="image/svg+xml" href="${VEIL_FAVICON}" />
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; margin: 0; }
body { min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: #09090b; color: #e4e4e7; padding: 24px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { width: 100%; max-width: 480px; padding: 28px; background: #131316;
  border: 1px solid rgba(52,211,153,.25); border-radius: 18px; box-shadow: 0 30px 80px rgba(0,0,0,.55); }
header { display: flex; align-items: center; gap: 9px; margin-bottom: 18px; }
header .k { font-size: 10.5px; font-weight: 700; letter-spacing: .22em; color: #34d399; }
h1 { font-size: 22px; font-weight: 700; color: #fafafa; letter-spacing: -.01em; }
.stats { margin: 6px 0 18px; font-size: 12.5px; color: #a1a1aa; }
ul { list-style: none; display: flex; flex-direction: column; gap: 4px; margin-bottom: 18px;
  max-height: 260px; overflow: auto; }
li { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; color: #d4d4d8;
  padding: 7px 12px; border-radius: 9px; background: rgba(39,39,42,.5); }
li span:last-child { color: #71717a; font-variant-numeric: tabular-nums; white-space: nowrap; }
.how { border: 1px dashed rgba(52,211,153,.4); border-radius: 12px; padding: 14px 16px;
  background: rgba(52,211,153,.05); }
.how b { display: block; font-size: 12px; color: #6ee7b7; margin-bottom: 6px; }
.how p { font-size: 12.5px; line-height: 1.55; color: #a1a1aa; }
.sig { margin-top: 14px; font-size: 10.5px; color: #52525b; font-family: ui-monospace, monospace; }
@media (max-height: 640px) { ul { max-height: 120px; } }
</style>
</head>
<body>
<script type="text/veil-ext-manifest" id="veilExtManifest">${JSON.stringify(man)}</script>
<main>
  <header>${SHIELD_SVG}<span class="k">VEIL EXTENSION</span></header>
  <h1>${esc(man.name)}</h1>
  <p class="stats">${man.apps} self-contained tool apps · ${mb} MB · general-purpose JavaScript, not games</p>
  <ul>
    ${list}
  </ul>
  <div class="how">
    <b>HOW TO INSTALL</b>
    <p>Open <b>veil-offline.html</b> and hit <b>Extensions</b> on the dock (next to Settings) — or just drag this file onto the page. The apps appear under <b>Arcade → toolkit</b> and run with zero connection.</p>
  </div>
  <p class="sig">VEIL-EXT v1 · pack ${esc(man.id)} · built ${man.built}</p>
</main>
</body>
</html>
`;
}
for (const p of [TOOLS_PACKET]) {
    /* resolve + size every app first (missing files are fatal — the
       pack is the product) */
    const apps = [];
    for (const a of p.apps) {
        const path = join(TOOLS_DIR, a.file);
        const bytes = fsize(path);
        if (!bytes) throw new Error(`toolkit app missing: ${path}`);
        apps.push({ ...a, bytes, path });
    }
    const raw = apps.reduce((s, a) => s + a.bytes, 0);
    const man = {
        sig: "VEIL-EXT", v: 1, id: p.id, name: p.name, desc: p.desc,
        assets: apps.map((a) => a.key),
        appList: apps.map((a) => ({
            key: a.key, name: a.name, desc: a.desc, icon: a.icon, cat: a.cat, kb: Math.round(a.bytes / 1024),
        })),
        bytes: raw, games: 0, apps: apps.length,
        built: new Date().toISOString().slice(0, 10),
    };
    const out = join(ROOT, "download", p.file);
    const fdP = openSync(out, "w");
    try {
        wchunk(fdP, toolsPackPage(man, apps));
        for (const a of apps) {
            wchunk(fdP, `<script type="text/veil-asset" id="veilA:${a.key}" data-mime="text/html">`);
            wchunk(fdP, b64(a.path));
            wchunk(fdP, "</script>\n");
        }
        wchunk(fdP, "</body>\n</html>\n");
    } finally {
        closeSync(fdP);
    }
    builtPacks.push({
        id: p.id, name: p.name, desc: p.desc, file: p.file,
        games: 0, apps: apps.length, appList: man.appList, bytes: fsize(out),
    });
    console.log(`toolkit pack “${p.name}”: ${apps.length} apps · ${(raw / 1024).toFixed(0)} KB raw · file ${(fsize(out) / 1024).toFixed(0)} KB → download/${p.file}`);
}

/* ── 3d. GN-MATH PACKET — the gn-math arcade on a file: five
   self-contained math games (scripts/gnmath-apps/*.html, each ONE
   page, graph-paper amber identity). Same appList/asset mechanism
   as the toolkit (asset keys "app:gnm-*", cat "gn-math"), landing in the
   offline Arcade's "gn-math" tab. */
const GNMATH_DIR = join(ROOT, "scripts/gnmath-apps");
const GNMATH_PACKETS = [
    {
        id: "gnmath-1", name: "GN-Math Packet", file: "veil-ext-gnmath-1.html",
        desc: "gn-math on a file — the 60-second trainer, duels, make-24, tables and rush.",
        apps: [
            { key: "app:gnm-trainer", file: "gn-math-trainer.html", name: "60s Trainer", icon: "zap", cat: "gn-math",
              desc: "the flagship — one minute, as many as you can, streaks stack" },
            { key: "app:gnm-duel", file: "math-duel.html", name: "Math Duel", icon: "trophy", cat: "gn-math",
              desc: "two players, one screen — steal each other's misses" },
            { key: "app:gnm-24", file: "make-24.html", name: "Make 24", icon: "dices", cat: "gn-math",
              desc: "four numbers, four operators, one target — always solvable" },
            { key: "app:gnm-tables", file: "times-tables.html", name: "Times Tables", icon: "grid2", cat: "gn-math",
              desc: "own every table 2–12, star every row" },
            { key: "app:gnm-rush", file: "number-rush.html", name: "Number Rush", icon: "timer", cat: "gn-math",
              desc: "true or false, 45 seconds, equations get meaner" },
        ],
    },
];
function gnmathPackPage(man, apps) {
    const list = apps.map((a) => `<li><span>${esc(a.name)}</span><span>${(a.bytes / 1024).toFixed(0)} KB</span></li>`).join("\n    ");
    const kb = Math.round(man.bytes / 1024);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Veil Extension — ${esc(man.name)}</title>
<meta name="description" content="A Veil offline extension pack — ${man.apps} self-contained gn-math games, ${kb} KB.">
<link rel="icon" type="image/svg+xml" href="${VEIL_FAVICON}" />
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; margin: 0; }
body { min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background-color: #0a0907;
  background-image:
    linear-gradient(rgba(245,158,11,.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(245,158,11,.05) 1px, transparent 1px),
    linear-gradient(rgba(245,158,11,.09) 1px, transparent 1px),
    linear-gradient(90deg, rgba(245,158,11,.09) 1px, transparent 1px);
  background-size: 26px 26px, 26px 26px, 130px 130px, 130px 130px;
  color: #e4e4e7; padding: 24px;
  font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; }
main { width: 100%; max-width: 480px; padding: 28px; background: #131316;
  border: 1px solid rgba(245,158,11,.3); border-radius: 18px; box-shadow: 0 30px 80px rgba(0,0,0,.55); }
header { display: flex; align-items: center; gap: 9px; margin-bottom: 18px; }
header .k { font-size: 10.5px; font-weight: 700; letter-spacing: .22em; color: #f59e0b; }
h1 { font-size: 22px; font-weight: 700; color: #fafafa; letter-spacing: -.01em; }
h1 span { color: #f59e0b; }
.stats { margin: 6px 0 18px; font-size: 12.5px; color: #a1a1aa; }
ul { list-style: none; display: flex; flex-direction: column; gap: 4px; margin-bottom: 18px;
  max-height: 220px; overflow: auto; }
li { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; color: #d4d4d8;
  padding: 7px 12px; border-radius: 9px; background: rgba(39,39,42,.5); }
li span:last-child { color: #71717a; font-variant-numeric: tabular-nums; white-space: nowrap; }
.how { border: 1px dashed rgba(245,158,11,.4); border-radius: 12px; padding: 14px 16px;
  background: rgba(245,158,11,.05); }
.how b { display: block; font-size: 12px; color: #fbbf24; margin-bottom: 6px; }
.how p { font-size: 12.5px; line-height: 1.55; color: #a1a1aa; }
.sig { margin-top: 14px; font-size: 10.5px; color: #52525b; font-family: ui-monospace, monospace; }
@media (max-height: 640px) { ul { max-height: 120px; } }
</style>
</head>
<body>
<script type="text/veil-ext-manifest" id="veilExtManifest">${JSON.stringify(man)}</script>
<main>
  <header>${SHIELD_SVG.replace('#34d399', '#f59e0b')}<span class="k">VEIL EXTENSION</span></header>
  <h1>gn<span>-</span>math packet</h1>
  <p class="stats">${man.apps} self-contained math games · ${kb} KB · drop into veil-offline.html to unlock</p>
  <ul>
    ${list}
  </ul>
  <div class="how">
    <b>HOW TO INSTALL</b>
    <p>Open <b>veil-offline.html</b> and hit <b>Extensions</b> on the dock (next to Settings) — pick this file. Or just drag it onto the page. The games land under <b>Arcade → gn-math</b> and run with zero connection.</p>
  </div>
  <p class="sig">VEIL-EXT v1 · pack ${esc(man.id)} · built ${man.built}</p>
</main>
</body>
</html>
`;
}
for (const p of GNMATH_PACKETS) {
    const apps = [];
    for (const a of p.apps) {
        const path = join(GNMATH_DIR, a.file);
        const bytes = fsize(path);
        if (!bytes) throw new Error(`gn-math app missing: ${path}`);
        apps.push({ ...a, bytes, path });
    }
    const raw = apps.reduce((s, a) => s + a.bytes, 0);
    const man = {
        sig: "VEIL-EXT", v: 1, id: p.id, name: p.name, desc: p.desc,
        assets: apps.map((a) => a.key),
        appList: apps.map((a) => ({
            key: a.key, name: a.name, desc: a.desc, icon: a.icon, cat: a.cat, kb: Math.round(a.bytes / 1024),
        })),
        bytes: raw, games: 0, apps: apps.length,
        built: new Date().toISOString().slice(0, 10),
    };
    const out = join(ROOT, "download", p.file);
    const fdP = openSync(out, "w");
    try {
        wchunk(fdP, gnmathPackPage(man, apps));
        for (const a of apps) {
            wchunk(fdP, `<script type="text/veil-asset" id="veilA:${a.key}" data-mime="text/html">`);
            wchunk(fdP, b64(a.path));
            wchunk(fdP, "</script>\n");
        }
        wchunk(fdP, "</body>\n</html>\n");
    } finally {
        closeSync(fdP);
    }
    builtPacks.push({
        id: p.id, name: p.name, desc: p.desc, file: p.file,
        games: 0, apps: apps.length, appList: man.appList, bytes: fsize(out),
    });
    console.log(`gn-math pack “${p.name}”: ${apps.length} games · ${(raw / 1024).toFixed(0)} KB raw · file ${(fsize(out) / 1024).toFixed(0)} KB → download/${p.file}`);
}
/* ── 3e. VEIL LAB PACKET — visual experiments, not games and not
   tools: scripts/lab-apps/*.html. Two self-contained pages (a neon
   piano synth with a live spectrum visualizer + recorder, and a
   gravity sandbox with orbital scenes). Asset keys "app:lab-*",
   cat "lab" → the offline Arcade's "lab" tab. */
const LAB_DIR = join(ROOT, "scripts/lab-apps");
const LAB_PACKETS = [
    {
        id: "lab-1", name: "Veil Lab", file: "veil-ext-lab-1.html",
        desc: "visual experiments — a neon piano synth with live visualizer & recorder, and an orbital gravity sandbox.",
        apps: [
            { key: "app:lab-piano", file: "neon-piano.html", name: "Neon Piano", icon: "music", cat: "lab",
              desc: "a playable synth — waveforms, octaves, sustain, recording & a neon spectrum" },
            { key: "app:lab-gravity", file: "gravity-lab.html", name: "Gravity Lab", icon: "zap", cat: "lab",
              desc: "an orbital sandbox — plant wells, fling comets, watch galaxies shear" },
        ],
    },
];
function labPackPage(man, apps) {
    const list = apps.map((a) => `<li><span>${esc(a.name)}</span><span>${(a.bytes / 1024).toFixed(0)} KB</span></li>`).join("\n    ");
    const kb = Math.round(man.bytes / 1024);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Veil Extension — ${esc(man.name)}</title>
<meta name="description" content="A Veil offline extension pack — ${man.apps} visual experiments, ${kb} KB.">
<link rel="icon" type="image/svg+xml" href="${VEIL_FAVICON}" />
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; margin: 0; }
body { min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background-color: #0a070a;
  background-image:
    radial-gradient(600px 300px at 50% -10%, rgba(217,70,239,.08), transparent 70%);
  color: #e4e4e7; padding: 24px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { width: 100%; max-width: 480px; padding: 28px; background: #131316;
  border: 1px solid rgba(217,70,239,.3); border-radius: 18px; box-shadow: 0 30px 80px rgba(0,0,0,.55); }
header { display: flex; align-items: center; gap: 9px; margin-bottom: 18px; }
header .k { font-size: 10.5px; font-weight: 700; letter-spacing: .22em; color: #e879f9; }
h1 { font-size: 22px; font-weight: 700; color: #fafafa; letter-spacing: -.01em; }
h1 span { color: #e879f9; }
.stats { margin: 6px 0 18px; font-size: 12.5px; color: #a1a1aa; }
ul { list-style: none; display: flex; flex-direction: column; gap: 4px; margin-bottom: 18px;
  max-height: 220px; overflow: auto; }
li { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; color: #d4d4d8;
  padding: 7px 12px; border-radius: 9px; background: rgba(39,39,42,.5); }
li span:last-child { color: #71717a; font-variant-numeric: tabular-nums; white-space: nowrap; }
.how { border: 1px dashed rgba(217,70,239,.4); border-radius: 12px; padding: 14px 16px;
  background: rgba(217,70,239,.05); }
.how b { display: block; font-size: 12px; color: #f0abfc; margin-bottom: 6px; }
.how p { font-size: 12.5px; line-height: 1.55; color: #a1a1aa; }
.sig { margin-top: 14px; font-size: 10.5px; color: #52525b; font-family: ui-monospace, monospace; }
@media (max-height: 640px) { ul { max-height: 120px; } }
</style>
</head>
<body>
<script type="text/veil-ext-manifest" id="veilExtManifest">${JSON.stringify(man)}</script>
<main>
  <header>${SHIELD_SVG.replace('#34d399', '#e879f9')}<span class="k">VEIL EXTENSION</span></header>
  <h1>veil <span>lab</span></h1>
  <p class="stats">${man.apps} visual experiments · ${kb} KB · drop into veil-offline.html to unlock</p>
  <ul>
    ${list}
  </ul>
  <div class="how">
    <b>HOW TO INSTALL</b>
    <p>Open <b>veil-offline.html</b> and hit <b>Extensions</b> on the dock (next to Settings) — pick this file. Or just drag it onto the page. The experiments land under <b>Arcade → lab</b> and run with zero connection.</p>
  </div>
  <p class="sig">VEIL-EXT v1 · pack ${esc(man.id)} · built ${man.built}</p>
</main>
</body>
</html>
`;
}
for (const p of LAB_PACKETS) {
    const apps = [];
    for (const a of p.apps) {
        const path = join(LAB_DIR, a.file);
        const bytes = fsize(path);
        if (!bytes) throw new Error(`lab app missing: ${path}`);
        apps.push({ ...a, bytes, path });
    }
    const raw = apps.reduce((s, a) => s + a.bytes, 0);
    const man = {
        sig: "VEIL-EXT", v: 1, id: p.id, name: p.name, desc: p.desc,
        assets: apps.map((a) => a.key),
        appList: apps.map((a) => ({
            key: a.key, name: a.name, desc: a.desc, icon: a.icon, cat: a.cat, kb: Math.round(a.bytes / 1024),
        })),
        bytes: raw, games: 0, apps: apps.length,
        built: new Date().toISOString().slice(0, 10),
    };
    const out = join(ROOT, "download", p.file);
    const fdP = openSync(out, "w");
    try {
        wchunk(fdP, labPackPage(man, apps));
        for (const a of apps) {
            wchunk(fdP, `<script type="text/veil-asset" id="veilA:${a.key}" data-mime="text/html">`);
            wchunk(fdP, b64(a.path));
            wchunk(fdP, "</script>\n");
        }
        wchunk(fdP, "</body>\n</html>\n");
    } finally {
        closeSync(fdP);
    }
    builtPacks.push({
        id: p.id, name: p.name, desc: p.desc, file: p.file,
        games: 0, apps: apps.length, appList: man.appList, bytes: fsize(out),
    });
    console.log(`lab pack "${p.name}": ${apps.length} experiments · ${(raw / 1024).toFixed(0)} KB raw · file ${(fsize(out) / 1024).toFixed(0)} KB → download/${p.file}`);
}
/* the pack manifest script — built AFTER the packs so the catalog
   carries their true file sizes */
/* merge any pack files already on disk that this run did NOT rebuild
   (e.g. the 250 MB game packs — regenerating them needs the stash
   inline+shrink pipeline, but the files themselves are durable; the
   catalog must list every pack the user can actually download) */
try {
  const PUB = join(ROOT, "download");
  const known = new Set(builtPacks.map((p) => p.file));
  for (const f of readdirSync(PUB)) {
    if (!/^veil-ext-.*\.html$/i.test(f) || known.has(f)) continue;
    const p = join(PUB, f);
    let man = null;
    try {
      const fdH = openSync(p, "r");
      try {
        const buf = Buffer.alloc(8192);
        const n = readSync(fdH, buf, 0, 8192, 0);
        const m = /<script type="text\/veil-ext-manifest"[^>]*>([\s\S]*?)<\/script>/.exec(buf.subarray(0, n).toString("utf8"));
        if (m) man = JSON.parse(m[1]);
      } finally { closeSync(fdH); }
    } catch { /* unreadable — skip */ }
    if (!man || man.sig !== "VEIL-EXT" || !man.id) continue;
    if (builtPacks.some((x) => x.id === man.id)) continue;
    builtPacks.push({
      id: man.id, name: man.name || man.id, desc: man.desc || "",
      file: f, games: man.games || 0, apps: man.apps || 0,
      assets: man.assets || [],
      bytes: fsize(p),
    });
    console.log(`catalog pack “${man.name || man.id}”: prebuilt file kept → public/${f} (${(fsize(p) / 1048576).toFixed(0)} MB, ${man.games || 0} games)`);
  }
  /* stable order: pack number in the filename */
  builtPacks.sort((a, b) => a.file.localeCompare(b.file, undefined, { numeric: true }));
} catch { /* download dir unreadable — catalog stays as built */ }
const packScript = `<script>
window.__VEIL_PACK__ = ${JSON.stringify(packJson)};
window.__VEIL_THEMES__ = ${JSON.stringify(THEMES)};
window.__VEIL_THEME_LIST__ = ${JSON.stringify(THEME_LIST)};
window.__VEIL_THUMBS__ = ${JSON.stringify(thumbsJson)};
window.__VEIL_STASH_EMB__ = ${JSON.stringify(baseEmbed)};
window.__VEIL_STASH_LIST__ = ${JSON.stringify(stashList)};
window.__VEIL_STASH_PRETTY__ = ${JSON.stringify(stashPretty)};
window.__VEIL_EXTS_CATALOG__ = ${JSON.stringify(builtPacks)};
</script>`;

const bodyClose = html.lastIndexOf("</body>");
const headPart = html.slice(0, bodyClose);
const tailPart = html.slice(bodyClose);
const fd = openSync(OUT, "w");
try {
  wchunk(fd, headPart);
  wchunk(fd, dom + "\n");
  /* socket.io-client — Veil Chat's realtime legs in the HTML version
     (loaded before the shell so window.io exists; ~40 KB). Without it
     the chat section falls back to REST polling. */
  {
    const sioPath = join(ROOT, "node_modules/socket.io-client/dist/socket.io.min.js");
    try {
      wchunk(fd, `<script>\n${readFileSync(sioPath, "utf8")}\n</script>\n`);
      console.log(`socket.io-client embedded for Veil Chat: ${(fsize(sioPath) / 1024).toFixed(0)} KB`);
    } catch (e) {
      console.warn(`⚠ socket.io-client not embedded (Chat realtime degrades to polling): ${e.message}`);
    }
  }
  wchunk(fd, packScript + "\n<script>\n" + js + "\n</script>\n");
  for (const b of assetBlocks) { wchunk(fd, b); wchunk(fd, "\n"); }
/* hls.js — the Stream section's adaptive player (embedded once,
   decoded to a Blob on first use; ~620 KB) */
{
    const hlsPath = join(ROOT, "node_modules/hls.js/dist/hls.min.js");
    try {
        wchunk(fd, `<script type="text/veil-asset" id="veilA:hlsjs" data-mime="application/javascript">`);
        wchunk(fd, b64(hlsPath));
        wchunk(fd, "</script>\n");
        console.log(`hls.js embedded for the Stream section: ${(fsize(hlsPath) / 1024).toFixed(0)} KB`);
    } catch (e) {
        console.warn(`⚠ hls.js not embedded (Stream adaptive playback off): ${e.message}`);
    }
}
  for (const g of baseGames) {
    wchunk(fd, `<script type="text/veil-asset" id="veilA:stash:${g.id}" data-mime="text/html">`);
    wchunk(fd, b64(g.path));
    wchunk(fd, "</script>\n");
  }
  wchunk(fd, tailPart);
} finally {
  closeSync(fd);
}

/* ── 3.5 exact size pad — user wants the file at ~190 MB ──────
   Append exactly 1 MiB (1,048,576 bytes) as a harmless HTML comment after
   </html>. Browsers ignore it; the origin stamping window is at the head. */
{
  const PAD_TARGET = 1048576;
  const marker = "<!-- VEIL SIZE PAD (exactly 1 MiB, do not remove): ";
  const closer = " -->\n";
  const vBytes = PAD_TARGET - Buffer.byteLength(marker) - Buffer.byteLength(closer);
  const padFd = openSync(OUT, "a");
  try {
    writeSync(padFd, marker);
    const chunk = "V".repeat(65536);
    let left = vBytes;
    while (left > 0) {
      const n = Math.min(left, chunk.length);
      writeSync(padFd, n === chunk.length ? chunk : "V".repeat(n));
      left -= n;
    }
    writeSync(padFd, closer);
  } finally {
    closeSync(padFd);
  }
  console.log(`size pad appended: exactly ${PAD_TARGET} bytes (1 MiB)`);
}

/* ── 4. done ────────────────────────────────────────────────── */
console.log(
  `veil-offline.html written: ${(fsize(OUT) / 1024 / 1024).toFixed(2)} MB ` +
  `(engine ${(before / 1024 / 1024).toFixed(2)} MB + wallpapers ${(mediaBytes / 1024 / 1024).toFixed(2)} MB + stash-base ${(baseGameBytes / 1024 / 1024).toFixed(2)} MB, ` +
  `${packJson.length} wallpapers@native-res, ${THEME_LIST.length} themes, ${baseGames.length}/${stashList.length} stash games embedded)` +
  (missing.length ? ` — MISSING: ${missing.join(", ")}` : "")
);
if (builtPacks.length) {
  const packBytes = builtPacks.reduce((s, p) => s + p.bytes, 0);
  console.log(
    `+ ${builtPacks.length} extension packs: ${builtPacks.map((p) => `${p.name} (${(p.bytes / 1048576).toFixed(0)} MB, ${p.games} games)`).join(", ")}` +
    ` — base + packs = ${((fsize(OUT) + packBytes) / 1048576).toFixed(0)} MB total, full capability`
  );
}
