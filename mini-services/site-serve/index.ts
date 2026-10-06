/**
 * site-serve — serves the static git copy (site/) with /api/* proxied
 * to the Next app on :3000, so the pages resolve the API base
 * same-origin exactly like they would behind the real gateway.
 * Port: fixed 3021.
 */
import { createServer, request as httpRequest } from "http"
import { readFileSync, existsSync } from "fs"
import { extname, join, normalize } from "path"

const ROOT = "/home/z/my-project/site"
const PORT = 3021
const APP = "http://localhost:3000"

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".xhtml": "application/xhtml+xml",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
}

createServer((req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`)
  // proxy every /api/* to the app, streaming the body through
  if (url.pathname.startsWith("/api/")) {
    const proxy = httpRequest(
      APP + url.pathname + url.search,
      { method: req.method, headers: { ...req.headers, host: "localhost:3000" } },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers)
        up.pipe(res)
      },
    )
    proxy.on("error", () => {
      res.writeHead(502, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: "app unreachable" }))
    })
    req.pipe(proxy)
    return
  }
  // static
  let path = normalize(join(ROOT, decodeURIComponent(url.pathname)))
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden")
    return
  }
  if (path === ROOT || path === ROOT + "/") path = join(ROOT, "index.html")
  if (!existsSync(path) && existsSync(path + ".html")) path += ".html"
  if (!existsSync(path)) {
    res.writeHead(404, { "content-type": "text/plain" })
    res.end("not found")
    return
  }
  const body = readFileSync(path)
  res.writeHead(200, {
    "content-type": MIME[extname(path)] || "application/octet-stream",
    "cache-control": "no-store",
  })
  res.end(body)
}).listen(PORT, () => console.log(`[site-serve] http://localhost:${PORT} → ${ROOT} (+ /api → :3000)`))
