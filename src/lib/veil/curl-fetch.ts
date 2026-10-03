import { spawn } from "node:child_process";

/**
 * Veil — curl-backed page fetcher.
 *
 * Cloudflare fronts motionbgs.com and now walls the Node runtime's own
 * `fetch` (undici) on a TLS/JA3 fingerprint check — same URL, same UA,
 * undici gets 403 while curl sails through (verified both ways from this
 * box). The media cache (lib/veil/mbgs-media.ts) already routes videos
 * through a curl subprocess for exactly this reason; this helper extends
 * the same trick to catalog HTML pages: small bodies, no disk cache
 * needed — just spawn curl, capture stdout.
 *
 * Output contract: the body goes to stdout; curl's `-w` trailer is
 * appended after it with a private marker so one pipe carries both.
 */

const STATUS_MARK = "\n__VEIL_CURL_STATUS__";

const CURL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface CurlTextResult {
  status: number;
  body: string;
}

/**
 * GET `url` with curl and resolve `{ status, body }`.
 * Rejects only when curl itself fails (exit ≠ 0 / spawn error / timeout) —
 * HTTP 4xx/5xx still resolve so callers can decide what they mean.
 */
export function curlFetchText(
  url: string,
  opts: { timeoutS?: number; referer?: string; accept?: string } = {}
): Promise<CurlTextResult> {
  const timeoutS = opts.timeoutS ?? 20;
  return new Promise((resolve, reject) => {
    const args = [
      "-sS", // quiet, but surface real errors
      "--location", "--max-redirs", "4", // /search?q=x 302s to /tag:x/
      "--max-time", String(timeoutS),
      "--retry", "1",
      "--compressed",
      "-A", CURL_UA,
      "-H", `accept: ${opts.accept ?? "text/html,application/xhtml+xml,*/*;q=0.8"}`,
      "-H", "accept-language: en-US,en;q=0.9",
    ];
    if (opts.referer) args.push("-H", `referer: ${opts.referer}`);
    args.push("-w", `${STATUS_MARK}%{http_code}`, url);

    const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    // a catalog page is ~100–300 KB — safe to buffer in one string
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("error", (e) => reject(e));
    child.on("close", (exit) => {
      if (exit !== 0) {
        reject(new Error(`curl exit ${exit}${err ? `: ${err.trim().slice(0, 160)}` : ""}`));
        return;
      }
      const i = out.lastIndexOf(STATUS_MARK);
      if (i < 0) {
        reject(new Error("curl output missing status trailer"));
        return;
      }
      const status = Number.parseInt(out.slice(i + STATUS_MARK.length).trim(), 10);
      resolve({ status: Number.isFinite(status) ? status : 0, body: out.slice(0, i) });
    });
  });
}
