import { readFileSync, writeFileSync, existsSync, rmSync } from "fs"
import { execSync } from "child_process"

/**
 * site-build.ts — stamp the static mirror + generate the jsDelivr XHTML
 * exact copies.
 *
 *   bun scripts/site-build.ts
 *
 * What it does:
 *   1. Stamps every site/*.html with the build time (data-veil-build).
 *   2. Bumps site/version.json (commit sha + built stamp).
 *   3. Generates site/*.xhtml — IDENTICAL pages that jsDelivr will serve
 *      as application/xhtml+xml (real rendered pages; plain .html is
 *      force-served as text/plain by jsDelivr's anti-phishing policy).
 *      Conversion: xmlns on <html>, self-closed void elements, CDATA-
 *      wrapped inline scripts, internal .html links → .xhtml.
 *
 * The backup loop commits + pushes site/ after every snapshot, so all
 * copies stay in sync automatically.
 */

const ROOT = "/home/z/my-project"
const SITE = ROOT + "/site"
const PAGES = ["index", "chat", "arcade", "ai", "stream", "wallpapers", "status"]

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
  // XML namespace on the root element (browsers default it, but be proper).
  out = out.replace(/<html(\s)/, '<html xmlns="http://www.w3.org/1999/xhtml"$1')
  // Internal page links point at the xhtml siblings.
  for (const p of PAGES) {
    out = out.split(`${p}.html`).join(`${p}.xhtml`)
  }
  out = addAttrValues(out)
  out = selfCloseVoids(out)
  out = cdataScripts(out)
  return out
}

const stampIso = stamp()
writeVersion(stampIso)

for (const p of PAGES) {
  const src = `${SITE}/${p}.html`
  if (!existsSync(src)) continue
  writeFileSync(`${SITE}/${p}.xhtml`, toXhtml(readFileSync(src, "utf-8")))
}

// The MIME probe served its purpose (application/xhtml+xml confirmed).
const probe = `${SITE}/mime-test.xhtml`
if (existsSync(probe)) rmSync(probe)

console.log(JSON.stringify({ stamped: stampIso, pages: PAGES.length, xhtml: PAGES.length }))
