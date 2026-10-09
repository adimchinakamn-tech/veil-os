/**
 * Generate synthetic Google Takeout archives for verifying the
 * 1,000,000-row YouTube history import.
 *   bun run scripts/gen-takeout.mjs <rows> <out.tar|out.tgz> [prefix]
 */
import { writeFileSync } from "node:fs";

const rows = parseInt(process.argv[2] ?? "50000", 10);
const out = process.argv[3] ?? "/tmp/takeout.tgz";
const idPrefix = process.argv[4] ?? "Vq";

/* deterministic pseudo-random base62 ids */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function id(n) {
  let s = "";
  let x = (n * 2654435761) >>> 0;
  let y = (n * 40503) >>> 0;
  let z = (n * 69069 + 1) >>> 0;
  for (let i = 0; i < 11; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    y = (y * 1103515245 + 12345) >>> 0;
    z = (z ^ (z << 13)) >>> 0;
    z = (z ^ (z >>> 17)) >>> 0;
    z = (z ^ (z << 5)) >>> 0;
    s += ALPHABET[((x ^ y ^ z) % 64 + 64) % 64];
  }
  return idPrefix + s;
}

const compact = process.argv[5] === "compact";
const parts = new Array(rows);
const t0 = Date.now();
for (let i = 0; i < rows; i++) {
  const at = t0 - i * 37000; /* one watch every ~37s, newest first */
  if (compact) {
    parts[i] =
      `{"title":"Watched V${i}"` +
      `,"titleUrl":"https://www.youtube.com/watch?v=${id(i)}"` +
      `,"subtitles":[{"name":"C${i % 900}","url":"https://www.youtube.com/channel/UC${id(i + 7).slice(2)}"}]` +
      `,"time":"${new Date(at).toISOString()}"}`;
  } else {
    parts[i] =
      `{"header":"YouTube","title":"Watched Verification Video ${i}"` +
      `,"titleUrl":"https://www.youtube.com/watch?v=${id(i)}"` +
      `,"subtitles":[{"name":"QA Channel ${i % 900}","url":"https://www.youtube.com/channel/UC${id(i + 7).slice(2)}"}]` +
      `,"time":"${new Date(at).toISOString()}","products":["YouTube"]}`;
  }
}
const json = `[${parts.join(",")}]`;
console.log(`json: ${(json.length / 1e6).toFixed(1)} MB for ${rows.toLocaleString()} rows`);

/* ---- minimal ustar tar with one member ---- */
/* ustar header layout: name@0[100] mode@100[8] uid@108[8] gid@116[8]
 * size@124[12] mtime@136[12] chksum@148[8] type@156[1] magic@257[6] */
const NAME = "Takeout/YouTube and YouTube Music/history/watch-history.json";
const data = Buffer.from(json, "utf8");
const oct = (n, len) => n.toString(8).padStart(len - 1, "0") + "\0";
const header = Buffer.alloc(512);
header.write(NAME, 0, 100, "utf8");
header.write(oct(0o644, 8), 100, 8, "utf8"); /* mode */
header.write(oct(0, 8), 108, 8, "utf8"); /* uid */
header.write(oct(0, 8), 116, 8, "utf8"); /* gid */
header.write(oct(data.length, 12), 124, 12, "utf8"); /* size */
header.write(oct(Math.floor(t0 / 1000), 12), 136, 12, "utf8"); /* mtime */
header.write("        ", 148, 8, "utf8"); /* checksum placeholder */
header.write("0", 156, 1, "utf8"); /* type: file */
header.write("ustar", 257, 6, "utf8");
header.write("00", 263, 2, "utf8");
let sum = 0;
for (const b of header) sum += b;
header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf8");
const pad = (512 - (data.length % 512)) % 512;
const tar = Buffer.concat([header, data, Buffer.alloc(pad), Buffer.alloc(1024)]);

if (out.endsWith(".tgz") || out.endsWith(".tar.gz")) {
  const gz = Bun.gzipSync(tar);
  writeFileSync(out, gz);
  console.log(`wrote ${out}: ${(gz.length / 1e6).toFixed(1)} MB (.tgz)`);
} else {
  writeFileSync(out, tar);
  console.log(`wrote ${out}: ${(tar.length / 1e6).toFixed(1)} MB (.tar)`);
}
