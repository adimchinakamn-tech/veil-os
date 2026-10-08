#!/usr/bin/env node
/**
 * Veil — retarget the jsDelivr front stubs at a (new) live origin.
 *
 * Every front stub (root index.html/.xhtml, site/, cdn/, m1..m10/) carries
 * the upstream origin as an XOR-obfuscated "BUILD" fingerprint so
 * view-source never shows the host. When the preview session moves (a new
 * chat continuation gets a new preview URL), the old fingerprint dies and
 * every mirror shows the gateway's "404 page not found".
 *
 *   bun scripts/retarget-fronts.mjs https://preview-chat-…space-z.ai
 *
 * What it does:
 *   1. verifies the origin answers (curl /api/veil/whereami → JSON with
 *      an `at` field) — a dead or foreign origin is refused;
 *   2. rewrites the BUILD fingerprint in every stub (html + xhtml);
 *   3. rewrites the origin constant in src/app/api/cdn-target/route.ts;
 *   4. makes sure every stub carries the beacon-fallback block (fetches
 *      backups/live-origin.json from jsDelivr and follows it when the
 *      fingerprint is stale) so the NEXT move self-heals without this
 *      script;
 *   5. writes backups/live-origin.json (the beacon itself).
 *
 * Idempotent: running it twice with the same origin changes nothing.
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/home/z/my-project";
const XOR_KEY = 0x5b;

const argv = process.argv.slice(2);
const origin = argv[0]?.replace(/\/+$/, "");
if (!origin || !/^https:\/\/[a-z0-9.-]+\.space-z\.ai$/i.test(origin)) {
  console.error("usage: bun scripts/retarget-fronts.mjs https://preview-chat-<id>.space-z.ai");
  process.exit(2);
}

/* ---- fast path: decode the current fingerprint ------------------------ */
const encode = (s) => Array.from(s, (ch) => (ch.charCodeAt(0) ^ XOR_KEY).toString(16).padStart(2, "0")).join("");
function currentFingerprint() {
  try {
    const t = readFileSync(join(ROOT, "m1/index.html"), "utf8");
    const m = /var BUILD = "([0-9a-f]+)";/.exec(t);
    if (!m) return null;
    let u = "";
    for (let i = 0; i < m[1].length; i += 2) u += String.fromCharCode(parseInt(m[1].substr(i, 2), 16) ^ XOR_KEY);
    return u.replace(/\/+$/, "");
  } catch {
    return null;
  }
}
function currentBeacon() {
  try {
    const j = JSON.parse(readFileSync(join(ROOT, "backups/live-origin.json"), "utf8"));
    return typeof j.origin === "string" ? j.origin.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

/* already current (and the beacon agrees) → zero network, zero writes */
if (currentFingerprint() === origin) {
  if (currentBeacon() !== origin) {
    writeFileSync(
      join(ROOT, "backups/live-origin.json"),
      JSON.stringify({ origin, at: new Date().toISOString() }, null, 2) + "\n",
    );
  }
  console.log(JSON.stringify({ ok: true, origin, alreadyCurrent: true, filesSeen: 0, filesPatched: 0 }));
  process.exit(0);
}

/* ---- 1. liveness check (a dead origin must never be baked in) ---------- */
async function verifyOrigin() {
  try {
    const r = await fetch(`${origin}/api/veil/whereami`, {
      signal: AbortSignal.timeout(15000),
      headers: { "user-agent": "veil-retarget/1.0" },
    });
    if (!r.ok) return `HTTP ${r.status}`;
    const j = await r.json().catch(() => null);
    if (!j || typeof j.at !== "string") return "not a Veil origin (no whereami)";
    return null; // alive
  } catch (e) {
    return String(e?.cause || e?.message || e).slice(0, 120);
  }
}
const dead = await verifyOrigin();
if (dead) {
  console.error(`retarget-fronts: REFUSING — ${origin} is not reachable (${dead})`);
  process.exit(1);
}

/* ---- 2. fingerprint ---------------------------------------------------- */
const BUILD = encode(origin);

/* ---- 3. collect every stub -------------------------------------------- */
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (/\.(x?html)$/.test(name)) yield p;
  }
}
const STUB_DIRS = ["site", "cdn", ...Array.from({ length: 10 }, (_, i) => `m${i + 1}`)];
const files = [
  join(ROOT, "index.html"),
  join(ROOT, "index.xhtml"),
  ...STUB_DIRS.flatMap((d) => {
    try {
      return readdirSync(join(ROOT, d))
        .filter((f) => /\.(x?html)$/.test(f))
        .map((f) => join(ROOT, d, f));
    } catch {
      return [];
    }
  }),
];

/* ---- 4. the beacon-fallback block (idempotent insert) ------------------ */
const BEACON_URL = "https://cdn.jsdelivr.net/gh/ok5678765s/veil-os@main/backups/live-origin.json";
const BEACON_MARK = "veil-beacon";
const BEACON_BLOCK = `
  /* ${BEACON_MARK} — self-heal: if this front's fingerprint went stale
   * (the live session moved to a new preview URL), follow the beacon
   * the box pushes to the repo (served + purged via jsDelivr). Never
   * overrides a frame that already finished loading the real app. */
  try {
    fetch("${BEACON_URL}", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var o = j && typeof j.origin === "string" ? j.origin : "";
        if (!/^https:\\/\\/preview-chat-[a-f0-9-]+\\.space-z\\.ai$/.test(o) || o === U) return;
        if (loaded) return; /* the fingerprint origin answered — keep it */
        try { frame.contentWindow.location.replace(o); }
        catch (e2) { frame.src = o; }
      })
      .catch(function () {});
  } catch (e3) { /* old browsers keep the fingerprint path */ }
`;

let patched = 0;
let fingerprints = 0;
let beacons = 0;

for (const f of files) {
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  let next = text;

  /* 4a. swap the fingerprint */
  if (/var BUILD = "[0-9a-f]+";/.test(next)) {
    next = next.replace(/var BUILD = "[0-9a-f]+";/, `var BUILD = "${BUILD}";`);
    if (next !== text) fingerprints++;
  }

  /* 4b. inject/refresh the beacon block right after the initial
   * navigation (the `try { frame.contentWindow.location.replace(U); }`
   * ... `})();` tail of the boot IIFE) */
  if (next.includes(BEACON_MARK)) {
    beacons++;
  } else {
    const anchor = /  try \{\n    frame\.contentWindow\.location\.replace\(U\);\n  \} catch \(e\) \{\n    frame\.src = U;\n  \}\n\}\)\(\);/;
    if (anchor.test(next)) {
      next = next.replace(anchor, (m) => m.replace(/\}\)\(\);/, `${BEACON_BLOCK}})();`));
      beacons++;
    }
  }

  if (next !== text) {
    writeFileSync(f, next);
    patched++;
  }
}

/* ---- 5. the cdn-target origin constant --------------------------------- */
const cdnTargetPath = join(ROOT, "src/app/api/cdn-target/route.ts");
try {
  const t = readFileSync(cdnTargetPath, "utf8");
  const nextT = t.replace(
    /origin:\s*\n?\s*"https:\/\/[^"]+"/,
    `origin:\n        "${origin}"`,
  );
  if (nextT !== t) {
    writeFileSync(cdnTargetPath, nextT);
    patched++;
  }
} catch {
  /* cdn-target route missing — skip */
}

/* ---- 6. write the beacon (only when the origin actually changed) -------- */
const beaconPath = join(ROOT, "backups/live-origin.json");
if (currentBeacon() !== origin) {
  writeFileSync(
    beaconPath,
    JSON.stringify({ origin, at: new Date().toISOString() }, null, 2) + "\n",
  );
}

/* ---- 7. purge the jsDelivr edge for every front file that changed ------ */
/* Retargets are rare (once per session move) so a full purge is safe and
 * required: the fronts + the beacon are the things jsDelivr would other-
 * wise keep serving stale for up to 12h. */
async function purgeAll(paths) {
  const base = "https://purge.jsdelivr.net/gh/ok5678765s/veil-os@main/";
  let ok = 0;
  const batch = [...paths];
  const workers = Array.from({ length: 8 }, async () => {
    while (batch.length > 0) {
      const p = batch.pop();
      try {
        const r = await fetch(base + p, { signal: AbortSignal.timeout(10000) });
        if (r.ok) ok++;
      } catch {
        /* individual purge failures are fine — TTL expires anyway */
      }
    }
  });
  await Promise.all(workers);
  return ok;
}

const repoRel = (abs) => abs.slice(ROOT.length + 1);
const purgeTargets = [
  ...files.map(repoRel),
  "backups/live-origin.json",
];
let purged = 0;
if (patched > 0 || currentBeacon() !== origin) {
  purged = await purgeAll(purgeTargets);
}

console.log(
  JSON.stringify({
    ok: true,
    alreadyCurrent: false,
    origin,
    filesSeen: files.length,
    filesPatched: patched,
    fingerprintsSwapped: fingerprints,
    beaconsPresent: beacons,
    purged,
    beacon: beaconPath,
  }),
);
