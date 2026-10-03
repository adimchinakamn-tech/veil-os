/**
 * Reproduce the user's freeze: gallery load + hover sweep + lightbox click,
 * with the browser's real request pattern (Range GETs on <video> sources),
 * against uncached motionbgs media. Measures whether unrelated requests
 * (thumbs, catalog API) stall behind the hanging video GETs.
 */
const BASE = "http://localhost:3000";
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(2)}s] ${m}`);

async function timed(name, url, opts) {
  const s = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(60000), ...opts });
    const len = r.headers.get("content-length") ?? "?";
    log(`${name}: ${r.status} len=${len} took ${((Date.now() - s) / 1000).toFixed(2)}s`);
    return r;
  } catch (e) {
    log(`${name}: FAILED after ${((Date.now() - s) / 1000).toFixed(2)}s — ${e.message}`);
    return null;
  }
}

const main = async () => {
  // 1. catalog fetch (like the Live tab)
  const cat = await timed("catalog /api/wallpapers/live", `${BASE}/api/wallpapers/live?cat=recent`);
  const data = await cat.json();
  const items = (data.items || []).slice(0, 8);
  log(`catalog gave ${items.length} items; first=${items[0]?.name}`);

  // 2. fire 6 hover-video GETs on COLD vw=1080 urls (like a mouse sweep
  //    mounting <video preload=auto>), then immediately probe the same
  //    endpoints the page needs (a thumb + the catalog again).
  const videoJobs = items.slice(0, 6).map((it, i) =>
    (async () => {
      const u = `${BASE}/api/p/https/motionbgs.com${it.video.replace("https://motionbgs.com", "")}?vw=1080`;
      const s = Date.now();
      try {
        const r = await fetch(u, { headers: { range: "bytes=0-" }, signal: AbortSignal.timeout(60000) });
        log(`hover-video[${i}] ${items[i].slug.slice(0, 30)}: ${r.status} took ${((Date.now() - s) / 1000).toFixed(2)}s`);
      } catch (e) {
        log(`hover-video[${i}]: FAILED after ${((Date.now() - s) / 1000).toFixed(2)}s — ${e.message}`);
      }
    })()
  );

  // small delay so the video GETs are in flight
  await new Promise((r) => setTimeout(r, 300));

  // 3. THE PROBE: while videos are cold-downloading, can the page still
  //    load a thumb and re-fetch the catalog? (This is what "freezes".)
  await timed("PROBE thumb (cold)", `${BASE}/api/p/${items[7].thumb.replace("https://", "").replace("http://", "")}`);
  await timed("PROBE catalog re-fetch", `${BASE}/api/wallpapers/live?cat=recent`);

  await Promise.allSettled(videoJobs);
  log("all hover-video GETs settled");

  // 4. post-check: the same videos again (should be warm/cached now)
  const again = await fetch(
    `${BASE}/api/p/https/motionbgs.com${items[0].video.replace("https://motionbgs.com", "")}?vw=1080`,
    { headers: { range: "bytes=0-1023" } }
  );
  log(`warm re-GET #0: ${again.status} len=${again.headers.get("content-length")}`);
};

main().catch((e) => { console.error("SCRIPT ERROR", e); process.exit(1); });
