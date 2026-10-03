/**
 * Sulfur OS pack assembler — one file, two outputs.
 *
 * 1. scripts/sulfur-os-apps/build/sulfur-os.html
 *    The whole OS (kernel + every app module) as ONE self-contained
 *    page — openable directly in a browser for testing.
 *
 * 2. download/veil-ext-sulfur-1.html
 *    The same page base64-embedded as a VEIL-EXT pack (manifest +
 *    one app asset) — drag-drop installable into veil-offline.html,
 *    launchable from Arcade › toolkit. In there it gains the tunnel
 *    (the veil engine's WISP pipeline) and the shared coin economy.
 *
 * Run:  bun scripts/build-sulfur-pack.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/home/z/my-project";
const SRC = join(ROOT, "scripts/sulfur-os-apps");
const OUT_DIR = join(SRC, "build");
const PACK = join(ROOT, "download/veil-ext-sulfur-1.html");

const b64 = (p) => readFileSync(p).toString("base64");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fsize = (p) => statSync(p).size;

/* the chrome icons the static shell needs before JS runs */
const CHROME_ICONS = {
    __SVG_BACK__: "m12 19-7-7 7-7M19 12H5",
    __SVG_FWD__: "m5 12 7-7 7 7M12 19V5",
    __SVG_RELOAD__: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6",
    __SVG_HOME__: "m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
    __SVG_COINS__: "M12 8c3.3 0 6-1.1 6-2.5S15.3 3 12 3 6 4.1 6 5.5 8.7 8 12 8ZM6 5.5v5C6 12 8.7 13 12 13s6-1.1 6-2.5v-5M6 10.5v5C6 17 8.7 18 12 18s6-1.1 6-2.5v-5",
    __SVG_X__: "M18 6 6 18M6 6l12 12",
    __SVG_WIFI__: "M5 12.6a10 10 0 0 1 14 0M8.5 16a5.5 5.5 0 0 1 7 0M12 20h.01",
    __SVG_BATTERY__: "M15 20h-2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2ZM5 9h2v6H5z",
    __SVG_USER__: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
    __SVG_PALETTE__: "M12 22a10 10 0 0 1 0-20c5 0 9 3.6 9 8 0 3-2.5 4-4.5 4H15a2 2 0 0 0-2 2c0 1 .7 1.5.7 2.5S12.7 22 12 22ZM7.5 10.5h.01M12 7h.01M16.5 10.5h.01",
    __SVG_GRID__: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"
};
const svg = (d, size = 16) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const FAVICON =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2334d399' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 22s8-3.6 8-10V5.5L12 2 4 5.5V12c0 6.4 8 10 8 10Z'/%3E%3Cpath d='M9 12h2v4'/%3E%3C/svg%3E";
const SHIELD_SVG =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-3.6 8-10V5.5L12 2 4 5.5V12c0 6.4 8 10 8 10Z"/></svg>';

/* ── assemble the one-file OS page ─────────────────────────────── */
const kernelCSS = readFileSync(join(SRC, "kernel.css"), "utf8");
const kernelJS = readFileSync(join(SRC, "kernel.js"), "utf8");
const appFiles = [
    "apps/tetris.js", "apps/snake.js", "apps/minesweeper.js", "apps/2048.js",
    "apps/memory.js", "apps/brick.js", "apps/flap.js",
    "apps/blackjack.js",
    "apps/notes.js", "apps/calendar.js", "apps/markdown.js", "apps/json-formatter.js",
    "apps/passgen.js", "apps/color.js", "apps/draw.js", "apps/synth.js",
    "apps/pomodoro.js", "apps/stopwatch.js", "apps/world-clock.js",
    "apps/weather.js", "apps/ytsearch.js"
];
const appScripts = appFiles
    .map((f) => readFileSync(join(SRC, f), "utf8"))
    .map((js) => `<script>\n${js}\n</script>`)
    .join("\n");

let page = readFileSync(join(SRC, "shell.html"), "utf8");
page = page.replace("/*__KERNEL_CSS__*/", () => kernelCSS);
page = page.replace("/*__KERNEL_JS__*/", () => kernelJS);
page = page.replace("<!--__APP_SCRIPTS__-->", () => appScripts);
for (const [ph, d] of Object.entries(CHROME_ICONS)) page = page.split(ph).join(svg(d, 16));

mkdirSync(OUT_DIR, { recursive: true });
const osPage = join(OUT_DIR, "sulfur-os.html");
writeFileSync(osPage, page);

/* ── the VEIL-EXT pack around it ───────────────────────────────── */
const bytes = fsize(osPage);
const man = {
    sig: "VEIL-EXT", v: 1,
    id: "sulfur-1", name: "Sulfur OS",
    desc: "the whole-project pack: a Chrome-OS-style desktop with tabs, the app launcher, 21 apps (games, tools, creative), the coin economy with blackjack, and a tunnel-powered browser — the 2.2 MB Sulfur OS source recreated as one file. Sulfur proxy uses Google — may not work.",
    assets: ["app:sulfur-os"],
    appList: [{
        key: "app:sulfur-os", name: "Sulfur OS",
        desc: "the Chrome-desktop virtual environment — boot it like a whole OS. Sulfur proxy uses Google — may not work.",
        icon: "desktop", cat: "app", kb: Math.round(bytes / 1024)
    }],
    bytes, games: 0, apps: 1,
    built: new Date().toISOString().slice(0, 10)
};

const appNames = [
    ["Tetris", "game"], ["Snake", "game"], ["Minesweeper", "game"], ["2048", "game"],
    ["Memory Match", "game"], ["Brick Breaker", "game"], ["Flap", "game"], ["Blackjack", "game"],
    ["Notes", "tool"], ["Calendar", "tool"],
    ["Markdown Editor", "tool"], ["JSON Formatter", "tool"], ["Password Gen", "tool"],
    ["Color Studio", "creative"], ["Drawing Pad", "creative"], ["WebAudio Synth", "creative"],
    ["Pomodoro", "tool"], ["Stopwatch", "tool"], ["World Clock", "tool"],
    ["Weather (live, tunnel)", "tool"], ["YouTube Search (live, tunnel)", "media"]
];
const list = appNames.map(([n, c]) => `<li data-c="${c}"><span>${esc(n)}</span><i>${c}</i></li>`).join("\n    ");
const mb = (bytes / 1048576).toFixed(2);

const packPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Veil Extension — Sulfur OS</title>
<meta name="description" content="A Veil offline extension — the whole Sulfur OS Chrome-desktop environment, ${mb} MB, 21 apps, one file. Sulfur proxy uses Google — may not work.">
<link rel="icon" type="image/svg+xml" href="${FAVICON}" />
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; margin: 0; }
body { min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(120% 90% at 20% 0%, #2a2f5e 0%, #1a1b2e 45%, #0f1015 100%);
  color: #e4e4e7; padding: 24px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { width: 100%; max-width: 520px; padding: 28px; background: rgba(19,19,22,.92);
  border: 1px solid rgba(52,211,153,.25); border-radius: 18px; box-shadow: 0 30px 80px rgba(0,0,0,.55); }
header { display: flex; align-items: center; gap: 9px; margin-bottom: 18px; }
header .k { font-size: 10.5px; font-weight: 700; letter-spacing: .22em; color: #34d399; }
h1 { font-size: 23px; font-weight: 800; color: #fafafa; letter-spacing: -.01em; }
h1 span { font-weight: 200; color: #34d399; }
.stats { margin: 6px 0 16px; font-size: 12.5px; color: #a1a1aa; }
ul { list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 18px;
  max-height: 300px; overflow: auto; }
li { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; color: #d4d4d8;
  padding: 6px 11px; border-radius: 8px; background: rgba(39,39,42,.5); }
li i { color: #71717a; font-style: normal; flex-shrink: 0; }
.how { border: 1px dashed rgba(52,211,153,.4); border-radius: 12px; padding: 14px 16px;
  background: rgba(52,211,153,.05); }
.how b { display: block; font-size: 12px; color: #6ee7b7; margin-bottom: 6px; }
.how p { font-size: 12.5px; line-height: 1.55; color: #a1a1aa; }
.sig { margin-top: 14px; font-size: 10.5px; color: #52525b; font-family: ui-monospace, monospace; }
@media (max-width: 520px) { ul { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<script type="text/veil-ext-manifest" id="veilExtManifest">${JSON.stringify(man)}</script>
<main>
  <header>${SHIELD_SVG}<span class="k">VEIL EXTENSION</span></header>
  <h1>Sulfur<span>OS</span></h1>
  <p class="stats">the whole-project pack · one OS app, 21 apps inside · ${mb} MB · drop into veil-offline.html to install</p>
  <ul>
    ${list}
  </ul>
  <div class="how">
    <b>HOW TO INSTALL</b>
    <p>Open <b>veil-offline.html</b> and hit <b>Extensions</b> on the dock (next to Settings) — or just drag this file onto the page. Sulfur OS appears under <b>Arcade → toolkit</b>; launching it boots a whole desktop with tabs, an app launcher, the coin economy and a browser that surfs through the veil's tunnel. Heads-up: the Sulfur proxy uses Google — may not work.</p>
  </div>
  <p class="sig">VEIL-EXT v1 · pack ${man.id} · built ${man.built} · kernel + 21 app modules, zero deps</p>
</main>
<script type="text/veil-asset" id="veilA:app:sulfur-os" data-mime="text/html">${b64(osPage)}</script>
</body>
</html>
`;

writeFileSync(PACK, packPage);
console.log(`sulfur-os.html: ${(bytes / 1024).toFixed(0)} KB (kernel + ${appFiles.length} apps) → ${osPage}`);
console.log(`pack “Sulfur OS”: 1 OS app · ${mb} MB → ${PACK}`);
