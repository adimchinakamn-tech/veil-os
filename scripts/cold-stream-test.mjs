/**
 * Cold-streaming test: pick motionbgs items NOT in the disk cache,
 * request their vw=1080 URLs, and measure time-to-FIRST-BYTE (the
 * number that decides whether the browser page freezes: it must be
 * sub-second now that cold GETs stream while curl downloads) plus the
 * total time, and check that unrelated requests stay instant while
 * cold downloads are in flight.
 */
const BASE = "http://localhost:3000";
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(2)}s] ${m}`);

const main = async () => {
  // use a category unlikely to be warm — "space"
  const cat = await fetch(`${BASE}/api/wallpapers/live?cat=space`).then((r) => r.json());
  const items = (cat.items || []).slice(0, 4);
  log(`catalog: ${items.length} items, first=${items[0]?.name}`);

  for (const it of items) {
    const u = `${BASE}/api/p/https/motionbgs.com${it.video.replace("https://motionbgs.com", "")}?vw=1080`;
    const s = Date.now();
    let ttfb = null;
    let bytes = 0;
    try {
      const r = await fetch(u, { headers: { range: "bytes=0-" } });
      const reader = r.body.getReader();
      // read until ~1.5MB or done, measuring TTFB
      const deadline = Date.now() + 45000;
      while (bytes < 1_500_000 && Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) break;
        if (ttfb === null) ttfb = Date.now() - s;
        bytes += value.byteLength;
        // cancel after first chunks — we only care about TTFB + early flow
        if (bytes > 300_000) {
          await reader.cancel();
          break;
        }
      }
      log(`${it.slug.slice(0, 34)}: status=${r.status} ttfb=${ttfb ?? "never"}ms earlyBytes=${bytes} x-veil=${r.headers.get("x-veil-mbgs")}`);
    } catch (e) {
      log(`${it.slug.slice(0, 34)}: ERROR ${e.message}`);
    }
  }

  // probe: unrelated endpoints stay instant while (possible) downloads run
  const ps = Date.now();
  await fetch(`${BASE}/api/wallpapers/live?cat=recent`);
  log(`PROBE catalog: ${Date.now() - ps}ms`);
  const pt = Date.now();
  const thumb = await fetch(`${BASE}/api/p/https/motionbgs.com${items[3].thumb.replace("https://motionbgs.com", "")}`);
  await thumb.arrayBuffer();
  log(`PROBE thumb: ${Date.now() - pt}ms status=${thumb.status}`);
};

main().catch((e) => { console.error("SCRIPT ERROR", e); process.exit(1); });
