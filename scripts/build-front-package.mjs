#!/usr/bin/env node
/**
 * Veil — build the jsDelivr front code download.
 *
 * Packages the canonical CDN front (cdn/ — one splash + iframe stub per
 * section, both .html and .xhtml, icon, _headers) into a zip with a
 * README that explains deploying it on any GitHub repo via jsDelivr and
 * retargeting it at a different live origin.
 *
 * Output:
 *   public/veil-jsdelivr-front.zip  → served at /veil-jsdelivr-front.zip
 *   download/veil-jsdelivr-front.zip → the project's download shelf
 *
 * Run: bun scripts/build-front-package.mjs
 */

import { cpSync, mkdirSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const ROOT = "/home/z/my-project";
const STAGE = join(ROOT, "tmp/front-package/veil-jsdelivr-front");
const README = `# Veil jsDelivr front — the smaller redirector

This is the static "front" that streams the LIVE Veil OS desktop from any
static host. It is what the public jsDelivr mirrors run: a tiny splash
screen (animated orbs, progress bar, retry) that hands the whole viewport
to a full-screen iframe pointing at the live app.

## What's inside

- \`index.html\` / \`index.xhtml\` — the front door (splash + iframe)
- \`chat.html\`, \`stream.html\`, \`arcade.html\`, \`wallpapers.html\`,
  \`music.html\`, \`links.html\`, \`history.html\`, \`updates.html\`,
  \`settings.html\`, \`ai.html\` (+ \`.xhtml\` twins) — section doors that
  deep-link straight into that part of the app
- \`veil-icon-192.png\` — the favicon / touch icon
- \`_headers\` — caching headers for hosts that honor them (Cloudflare
  Pages, Netlify)

## Deploy it (GitHub + jsDelivr, free)

1. Create a public GitHub repo and copy these files to its root.
2. Open it at:

   https://cdn.jsdelivr.net/gh/<your-user>/<your-repo>@main/index.html

That's the whole deploy — jsDelivr serves any public repo file.
(\`@main\` pins the branch; commit new versions and they appear after the
CDN cache expires, or immediately after a purge — see below.)

## Where does the iframe go?

Two layers keep the front alive without manual edits:

1. **The fingerprint.** The live origin is embedded as an XOR-obfuscated
   hex string (\`var BUILD = "…"\`, key \`0x5b\`) so view-source never
   shows the host. To retarget every page by hand, regenerate the
   fingerprint from your origin:

   \`\`\`js
   const origin = "https://your-live-origin.example";
   const build = [...origin].map(c => (c.charCodeAt(0) ^ 0x5b)
     .toString(16).padStart(2, "0")).join("");
   // swap var BUILD = "<build>" in every .html/.xhtml
   \`\`\`

2. **The beacon (self-heal).** On load, the front also fetches:

   https://cdn.jsdelivr.net/gh/ok5678765s/veil-os@main/backups/live-origin.json

   If the beacon names a live origin different from the embedded
   fingerprint (the upstream session moved), the front follows the
   beacon automatically — no redeploy needed. To aim the beacon at a
   different upstream entirely, point that URL at your own repo/JSON.

## Purging the jsDelivr cache after an edit

\`\`\`sh
curl https://purge.jsdelivr.net/gh/<your-user>/<your-repo>@main/index.html
\`\`\`

(Purge per path; jsDelivr throttles very frequent purges per path, so
purge when you actually change files.)

## Notes

- The splash fades only when a REAL cross-origin document loads — a dead
  upstream keeps the splash + "Still connecting…" retry box on screen.
- Nothing here phones home except the iframe itself and the beacon fetch.
- Zero dependencies, zero build step — plain HTML/CSS/JS, ~12KB a page.
`;

rmSync(join(ROOT, "tmp/front-package"), { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

/* copy the canonical front */
for (const f of readdirSync(join(ROOT, "cdn"))) {
  const p = join(ROOT, "cdn", f);
  if (statSync(p).isFile()) cpSync(p, join(STAGE, f));
}
writeFileSync(join(STAGE, "README.md"), README);

/* zip it */
mkdirSync(join(ROOT, "public"), { recursive: true });
mkdirSync(join(ROOT, "download"), { recursive: true });
execSync(
  `cd ${join(ROOT, "tmp/front-package")} && zip -r -q ${join(ROOT, "public/veil-jsdelivr-front.zip")} veil-jsdelivr-front`,
);
cpSync(join(ROOT, "public/veil-jsdelivr-front.zip"), join(ROOT, "download/veil-jsdelivr-front.zip"));

const size = statSync(join(ROOT, "public/veil-jsdelivr-front.zip")).size;
console.log(JSON.stringify({ ok: true, zip: "public/veil-jsdelivr-front.zip", bytes: size }));
