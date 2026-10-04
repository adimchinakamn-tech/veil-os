import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs"
import { execSync } from "child_process"

/**
 * site-build.ts — stamp the static mirror with a build time + bump
 * site/version.json so every CDN page knows a new version shipped.
 *
 *   bun scripts/site-build.ts          # stamp + bump version.json
 *
 * The 30s chat-backup loop calls stampOnly() indirectly by including
 * site/ in its git add; this script is the authoritative stamper used
 * by hand and by the loop when it commits.
 */

const ROOT = "/home/z/my-project"
const SITE = ROOT + "/site"
const PAGES = ["index", "chat", "arcade", "ai", "stream", "wallpapers", "status"]

function stamp(): string {
  const now = new Date()
  const iso = now.toISOString()
  // HTML attribute value — keep it compact and lexicographically sortable.
  const stamp = iso.replace(/\.\d+Z$/, "Z")
  for (const p of PAGES) {
    const f = `${SITE}/${p}.html`
    if (!existsSync(f)) continue
    let html = readFileSync(f, "utf-8")
    html = html.replace(/data-veil-build="[^"]*"/, `data-veil-build="${stamp}"`)
    writeFileSync(f, html)
  }
  return stamp
}

function writeVersion(stampIso: string): void {
  let sha = ""
  try {
    sha = execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf-8" }).trim()
  } catch {
    sha = "unknown"
  }
  writeFileSync(`${SITE}/version.json`, JSON.stringify({
    built: stampIso,
    commit: sha,
    pages: PAGES.map((p) => `site/${p}.html`),
  }, null, 2) + "\n")
}

const stampIso = stamp()
writeVersion(stampIso)
console.log(JSON.stringify({ stamped: stampIso, pages: PAGES.length }))
