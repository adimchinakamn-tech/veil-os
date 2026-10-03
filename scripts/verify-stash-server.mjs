/* Veil — offline game verification server.
 * Serves /tmp/veil-offline-assets over HTTP :3099 for the test harness.
 * Run: bun scripts/verify-stash-server.mjs (background)
 */
const DIR = "/tmp/veil-offline-assets";
Bun.serve({
  port: 3099,
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path === "/") path = "/stash-test.html";
    if (path === "/manifest.json") path = "/stash/stash-embed.json";
    const file = DIR + path.replace(/\.\./g, "");
    const type =
      /\.html?$/.test(path) ? "text/html; charset=utf-8" :
      /\.json$/.test(path) ? "application/json" :
      "application/octet-stream";
    try {
      const bytes = await Bun.file(file).arrayBuffer();
      return new Response(bytes, { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  },
});
console.log("verify server on :3099");
