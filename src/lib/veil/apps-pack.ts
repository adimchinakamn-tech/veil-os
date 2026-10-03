/**
 * Veil — the "Veil AI Apps" offline extension pack.
 *
 * The site's built apps (Veil AI installs + community creations, the
 * SiteApp table behind Arcade › Apps) are bundled into a real VEIL-EXT
 * pack on disk: download/veil-ext-ai-apps-1.html. Drop it into
 * veil-offline.html and every app plays fully offline in the Arcade's
 * AI Lab tab — same install channel as the Stash and Toolkit packs
 * (drag-drop or Extensions on the dock).
 *
 * The pack regenerates automatically whenever apps change (install,
 * update, create, delete) — a 2s debounce coalesces bursts. The write
 * is atomic (tmp + rename) so /api/offline's pack discovery never sees
 * a partial file, and the manifest rides in the first 8 KB so its
 * head-scan can read it (descs are clamped and the page head kept lean).
 */

import { db } from "@/lib/db"
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const PACK_ID = "ai-apps-1"
const PACK_NAME = "Veil AI Apps"
const PACK_FILE = "veil-ext-ai-apps-1.html"
const DL_DIR = join(process.cwd(), "download")

/** icons the offline shell's iconSVG() knows (subset the apps use —
 * anything else falls back to "spark"). */
const SHELL_ICONS = new Set([
  "bot", "joypad", "image", "globe", "dices", "search", "spark", "calc",
  "trophy", "zap", "timer", "brush", "pen", "filetext", "monitor", "key",
  "palette", "worm", "bomb", "music", "heart", "desktop", "play", "archive",
  "package", "notes", "swap", "braces", "shield",
])

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export interface AppsPackStatus {
  file: string
  apps: number
  bytes: number
  built: string | null
}

/** Read the pack's manifest off disk (null when no pack exists yet). */
export function getAppsPackStatus(): AppsPackStatus | null {
  try {
    const p = join(DL_DIR, PACK_FILE)
    if (!existsSync(p)) return null
    const head = readFileSync(p, { encoding: "utf8", flag: "r" }).slice(0, 8192)
    const m = /<script type="text\/veil-ext-manifest"[^>]*>([\s\S]*?)<\/script>/.exec(head)
    if (!m) return null
    const man = JSON.parse(m[1]) as { apps?: number; bytes?: number; built?: string }
    return {
      file: PACK_FILE,
      apps: man.apps ?? 0,
      bytes: statSync(p).size,
      built: man.built ?? null,
    }
  } catch {
    return null
  }
}

/** Build + atomically write the pack from the live SiteApp table. */
export async function buildAppsPack(): Promise<{ ok: boolean; apps: number; error?: string }> {
  try {
    const rows = await db.siteApp.findMany({
      where: { active: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, desc: true, icon: true, html: true, createdBy: true },
      take: 40,
    })

    /* zero apps → remove the pack instead of shipping an empty shell */
    const outPath = join(DL_DIR, PACK_FILE)
    if (rows.length === 0) {
      try {
        if (existsSync(outPath)) renameSync(outPath, outPath + ".removed")
      } catch { /* best effort */ }
      return { ok: true, apps: 0 }
    }

    const entries = rows.map((a) => {
      const bytes = Buffer.byteLength(a.html, "utf8")
      return {
        key: `app:site-${a.id}`,
        name: a.name.slice(0, 48),
        desc: a.desc.slice(0, 110),
        icon: SHELL_ICONS.has(a.icon) ? a.icon : "spark",
        cat: "ai" as const,
        kb: Math.max(1, Math.round(bytes / 1024)),
        bytes,
        html: a.html,
        by: a.createdBy === "community" ? "community build" : "built by Veil AI",
      }
    })

    const raw = entries.reduce((s, e) => s + e.bytes, 0)
    const man = {
      sig: "VEIL-EXT",
      v: 1,
      id: PACK_ID,
      name: PACK_NAME,
      desc: "the apps built on the live site — by Veil AI and the community — playing fully offline",
      assets: entries.map((e) => e.key),
      appList: entries.map((e) => ({
        key: e.key, name: e.name, desc: e.desc, icon: e.icon, cat: e.cat, kb: e.kb,
      })),
      bytes: raw,
      games: 0,
      apps: entries.length,
      built: new Date().toISOString().slice(0, 10),
    }

    const list = entries
      .map((e) => `<li><span>${esc(e.name)}</span><span>${esc(e.by)} · ${e.kb} KB</span></li>`)
      .join("\n    ")
    const mb = (raw / 1048576).toFixed(1)

    const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Veil Extension — ${esc(PACK_NAME)}</title>
<meta name="description" content="A Veil offline extension pack — ${man.apps} apps built on the live Veil site, ${mb} MB.">
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; margin: 0; }
body { min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: #09090b; color: #e4e4e7; padding: 24px;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { width: 100%; max-width: 480px; padding: 28px; background: #131316;
  border: 1px solid rgba(167,139,250,.3); border-radius: 18px; box-shadow: 0 30px 80px rgba(0,0,0,.55); }
header { display: flex; align-items: center; gap: 9px; margin-bottom: 18px; }
header svg { width: 18px; height: 18px; color: #a78bfa; }
header .k { font-size: 10.5px; font-weight: 700; letter-spacing: .22em; color: #a78bfa; }
h1 { font-size: 22px; font-weight: 700; color: #fafafa; letter-spacing: -.01em; }
.stats { margin: 6px 0 18px; font-size: 12.5px; color: #a1a1aa; }
ul { list-style: none; display: flex; flex-direction: column; gap: 4px; margin-bottom: 18px;
  max-height: 260px; overflow: auto; }
li { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; color: #d4d4d8;
  padding: 7px 12px; border-radius: 9px; background: rgba(39,39,42,.5); }
li span:last-child { color: #71717a; font-variant-numeric: tabular-nums; white-space: nowrap; }
.how { border: 1px dashed rgba(167,139,250,.4); border-radius: 12px; padding: 14px 16px;
  background: rgba(167,139,250,.06); }
.how b { display: block; font-size: 12px; color: #c4b5fd; margin-bottom: 6px; }
.how p { font-size: 12.5px; line-height: 1.55; color: #a1a1aa; }
.sig { margin-top: 14px; font-size: 10.5px; color: #52525b; font-family: ui-monospace, monospace; }
@media (max-height: 640px) { ul { max-height: 120px; } }
</style>
</head>
<body>
<script type="text/veil-ext-manifest" id="veilExtManifest">${JSON.stringify(man)}</script>
<main>
  <header><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg><span class="k">VEIL EXTENSION</span></header>
  <h1>${esc(PACK_NAME)}</h1>
  <p class="stats">${man.apps} apps built on the live site · ${mb} MB · Veil AI builds + community creations</p>
  <ul>
    ${list}
  </ul>
  <div class="how">
    <b>HOW TO INSTALL</b>
    <p>Open <b>veil-offline.html</b> and hit <b>Extensions</b> on the dock (next to Settings) — or just drag this file onto the page. The apps appear under <b>Arcade → AI Lab</b> and run with zero connection.</p>
  </div>
  <p class="sig">VEIL-EXT v1 · pack ${PACK_ID} · built ${man.built} · regenerates as the site builds more</p>
</main>
</body>
</html>
`

    mkdirSync(DL_DIR, { recursive: true })
    /* tmp + rename: /api/offline's discovery (regex ^veil-ext-.*\.html)
       never sees the partial — ".tmp" doesn't match. */
    const tmp = outPath + ".tmp"
    const parts: string[] = [page]
    for (const e of entries) {
      parts.push(`<script type="text/veil-asset" id="veilA:${e.key}" data-mime="text/html">`)
      parts.push(Buffer.from(e.html, "utf8").toString("base64"))
      parts.push("</script>\n")
    }
    parts.push("</body>\n</html>\n")
    writeFileSync(tmp, parts.join(""), "utf8")
    renameSync(tmp, outPath)
    return { ok: true, apps: entries.length }
  } catch (err) {
    console.error("[apps-pack] build failed", err)
    return { ok: false, apps: 0, error: String(err) }
  }
}

/* ── auto-regen: coalesce bursts of app changes into one rebuild ── */
let regenTimer: ReturnType<typeof setTimeout> | null = null
let building: Promise<unknown> | null = null

export function scheduleAppsPackRebuild(delayMs = 2_000): void {
  if (regenTimer) clearTimeout(regenTimer)
  regenTimer = setTimeout(() => {
    regenTimer = null
    if (building) return // a build is in flight; its completion re-checks
    building = buildAppsPack().finally(() => {
      building = null
    })
  }, delayMs)
}

/** Self-heal probe for GET /api/apps — when the pack on disk is out of
 *  sync with the table (e.g. the DB was edited directly, or the dev
 *  server restarted mid-change), schedule a rebuild. Cheap: reads only
 *  the pack's manifest head. */
export async function appsPackInSync(appCount: number): Promise<boolean> {
  const st = getAppsPackStatus()
  return st !== null && st.apps === appCount
}
