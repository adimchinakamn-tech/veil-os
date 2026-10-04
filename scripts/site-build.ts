import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "fs"
import { execSync } from "child_process"

/**
 * site-build.ts — stamp the static copy + generate the jsDelivr XHTML
 * exact copies + export REAL data from the live app.
 *
 *   bun scripts/site-build.ts
 *
 * What it does:
 *   1. Stamps every site/*.html with the build time (data-veil-build).
 *   2. Bumps site/version.json (commit sha + built stamp).
 *   3. Copies the live chat snapshot to site/data/latest.json so the
 *      site directory is SELF-CONTAINED — Cloudflare Pages / Vercel
 *      static deploys only serve site/, and the runtime reads the data
 *      same-origin from the same deploy (instant, no CDN lag).
 *   4. Exports the real app data the pages render from:
 *        data/arcade.json     — the full 840-title catalog + hot row
 *        data/wallpapers.json — the curated 4K feed (page 1)
 *        data/updates.json    — the site updates feed
 *      (all fetched from the running dev server; skipped when offline)
 *   5. Generates site/*.xhtml — IDENTICAL pages that jsDelivr serves
 *      as application/xhtml+xml (plain .html is force-served as
 *      text/plain by jsDelivr's anti-phishing policy).
 *      Conversion: xmlns on <html>, self-closed void elements, CDATA-
 *      wrapped inline scripts, internal .html links → .xhtml.
 *
 * The backup loop commits + pushes site/ after every snapshot, so all
 * copies stay in sync automatically.
 */

const ROOT = "/home/z/my-project"
const SITE = ROOT + "/site"
const PAGES = [
  "index", "chat", "arcade", "ai", "stream", "wallpapers",
  "music", "links", "history", "updates", "settings",
]

function stamp(): string {
  const iso = new Date().toISOString().replace(/\.\d+Z$/, "Z")
  for (const p of PAGES) {
    const f = `${SITE}/${p}.html`
    if (!existsSync(f)) continue
    let html = readFileSync(f, "utf-8")
    html = html.replace(/data-veil-build="[^"]*"/, `data-veil-build="${iso}"`)
    writeFileSync(f, html)
  }
  return iso
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
    xhtmlPages: PAGES.map((p) => `site/${p}.xhtml`),
  }, null, 2) + "\n")
}

/* --- live-data exports -------------------------------------------------- */

async function fetchJson(url: string, timeoutMs = 15000): Promise<any | null> {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    const r = await fetch(url, { signal: ctl.signal, cache: "no-store" })
    clearTimeout(t)
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

async function exportData(): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {}

  // chat snapshot (same-origin deploy data)
  try {
    const snap = readFileSync(ROOT + "/backups/chat/latest.json", "utf-8")
    mkdirSync(SITE + "/data", { recursive: true })
    writeFileSync(SITE + "/data/latest.json", snap)
    out.chat = true
  } catch {
    out.chat = false
  }

  // arcade — walk every page (60/page) + the hot row
  const arcade: { items: any[]; hot: any[]; total: number } = { items: [], hot: [], total: 0 }
  for (let page = 1; page <= 40; page++) {
    const j = await fetchJson(`http://localhost:3000/api/arcade?page=${page}`)
    if (!j || !Array.isArray(j.items) || j.items.length === 0) break
    arcade.items.push(...j.items)
    arcade.total = j.total ?? arcade.items.length
    if (!j.hasMore) break
  }
  const hot = await fetchJson("http://localhost:3000/api/arcade?hot=1")
  arcade.hot = (hot && Array.isArray(hot.items)) ? hot.items : []
  if (arcade.items.length) {
    writeFileSync(SITE + "/data/arcade.json", JSON.stringify(arcade))
    out.arcade = true
  } else {
    out.arcade = existsSync(SITE + "/data/arcade.json") // keep the old copy
  }

  // wallpapers — curated feed page 1 + the live motionbgs shelf
  const wp = await fetchJson("http://localhost:3000/api/wallpapers")
  if (wp && Array.isArray(wp.items) && wp.items.length) {
    writeFileSync(SITE + "/data/wallpapers.json", JSON.stringify(wp))
    out.wallpapers = true
  } else {
    out.wallpapers = existsSync(SITE + "/data/wallpapers.json")
  }
  const wpl = await fetchJson("http://localhost:3000/api/wallpapers/live")
  if (wpl && Array.isArray(wpl.items) && wpl.items.length) {
    writeFileSync(SITE + "/data/wallpapers-live.json", JSON.stringify(wpl))
    out.wallpapersLive = true
  } else {
    out.wallpapersLive = existsSync(SITE + "/data/wallpapers-live.json")
  }

  // updates — the public feed
  const up = await fetchJson("http://localhost:3000/api/updates")
  if (up && Array.isArray(up.updates)) {
    writeFileSync(SITE + "/data/updates.json", JSON.stringify(up))
    out.updates = true
  } else {
    out.updates = existsSync(SITE + "/data/updates.json")
  }

  return out
}

/* --- .html → .xhtml conversion (well-formed XML) ----------------------- */

function selfCloseVoids(html: string): string {
  // Void elements that must be <tag ... /> in XML. Won't touch tags that
  // are already self-closed (attributes end with "/" before ">").
  const voids = ["meta", "link", "img", "br", "hr", "input", "source", "area", "base", "col", "embed", "track", "wbr"]
  for (const tag of voids) {
    const re = new RegExp(`<${tag}((?:"[^"]*"|'[^']*'|[^"'>])*?)\\s*(?<!/)>`, "g")
    html = html.replace(re, `<${tag}$1 />`)
  }
  return html
}

function cdataScripts(html: string): string {
  // Inline scripts contain <, &&, ++ — XML-unsafe. Wrap in CDATA.
  return html.replace(
    /(<script>)([\s\S]*?)(<\/script>)/g,
    (_m, open: string, body: string, close: string) => {
      if (!body.trim()) return `${open}${body}${close}`
      return `${open}\n//<![CDATA[\n${body.replace(/\]\]>/g, "]]&gt;")}\n//]]>\n${close}`
    },
  )
}

function addAttrValues(html: string): string {
  // HTML allows valueless attributes (<span data-x>); XML requires
  // data-x="". Adds ="" to bare names — but ONLY in unquoted regions of
  // the tag (quoted attribute values may contain "word word" sequences
  // that must never be touched).
  const fixInner = (inner: string): string => {
    const parts: string[] = []
    const re = /("[^"]*"|'[^']*')/g
    let last = 0
    let mm: RegExpExecArray | null
    while ((mm = re.exec(inner)) !== null) {
      parts.push(inner.slice(last, mm.index)) // unquoted chunk
      parts.push(mm[0]) // quoted chunk — verbatim
      last = mm.index + mm[0].length
    }
    parts.push(inner.slice(last))
    return parts
      .map((chunk, i) =>
        i % 2 === 0
          ? chunk.replace(
              /(\s)([a-zA-Z_][\w:.-]*)(?!=)(?=[\s/>]|$)/g,
              '$1$2=""',
            )
          : chunk,
      )
      .join("")
  }
  return html.replace(
    /<([a-zA-Z](?:"[^"]*"|'[^']*'|[^>"'])*)>/g,
    (m, inner: string) => {
      if (m.startsWith("</") || m.startsWith("<!") || m.startsWith("<?")) return m
      return `<${fixInner(inner)}>`
    },
  )
}

function toXhtml(html: string): string {
  let out = html
  // Protect inline script BODIES first — the tag-scanning regexes below
  // must never see markup-like strings inside JS (game HTML builders,
  // regex literals like /<base\s/…). Placeholder them out, restore after.
  const scripts: string[] = []
  out = out.replace(
    /(<script>)([\s\S]*?)(<\/script>)/g,
    (_m, open: string, body: string, close: string) => {
      if (!body.trim()) return `${open}${body}${close}`
      const i = scripts.push(body) - 1
      return `${open}__VEIL_SCRIPT_${i}__${close}`
    },
  )
  // XML namespace on the root element (browsers default it, but be proper).
  out = out.replace(/<html(\s)/, '<html xmlns="http://www.w3.org/1999/xhtml"$1')
  // Internal page links point at the xhtml siblings.
  for (const p of PAGES) {
    out = out.split(`${p}.html`).join(`${p}.xhtml`)
  }
  out = addAttrValues(out)
  out = selfCloseVoids(out)
  // Restore the scripts, CDATA-wrapped so their <, &&, ++ are XML-safe.
  out = out.replace(
    /(<script>)(__VEIL_SCRIPT_(\d+)__)(<\/script>)/g,
    (_m, open: string, _ph: string, idx: string, close: string) =>
      `${open}\n//<![CDATA[\n${scripts[Number(idx)].replace(/\]\]>/g, "]]&gt;")}\n//]]>\n${close}`,
  )
  return out
}

const stampIso = stamp()
writeVersion(stampIso)
exportData().then((dataOk) => {
  for (const p of PAGES) {
    const src = `${SITE}/${p}.html`
    if (!existsSync(src)) continue
    writeFileSync(`${SITE}/${p}.xhtml`, toXhtml(readFileSync(src, "utf-8")))
  }

  // The MIME probe served its purpose (application/xhtml+xml confirmed).
  const probe = `${SITE}/mime-test.xhtml`
  if (existsSync(probe)) rmSync(probe)

  console.log(JSON.stringify({ stamped: stampIso, pages: PAGES.length, xhtml: PAGES.length, data: dataOk }))
})
