/**
 * Quasar poToken Provider (v2.1.0, optional)
 * ------------------------------------------
 * YouTube's innertube API demands a poToken (BotGuard attestation) for
 * playback on suspicious clients; the streaming server's undici requests are
 * exactly that. This module runs BotGuard SERVER-SIDE (bgutils-js + jsdom),
 * fetches a WebPO integrity token, and mints per-request poTokens that get
 * injected into proxied `/youtubei/v1/*` POST bodies as
 * `serviceIntegrityDimensions.poToken` (see fetcher.ts).
 *
 * Failure policy: EVERY step degrades to "no token" — the original request
 * body is forwarded unchanged, so a BotGuard outage can never break proxied
 * YouTube any harder than before. Failures are cached (10 min) to avoid
 * hammering the attestation endpoints. The minter itself is cached for the
 * integrity token's TTL (capped at 6 h).
 *
 * Env: QUASAR_YT_POTOKEN=0 disables the module entirely (default enabled
 * since the deps ship with the project).
 *
 * v2.1.0: when QUASAR_POTOKEN_BROWSER=1, injection first tries the optional
 * REAL-browser minter (potoken-browser.ts, playwright-core) — it attacks
 * the jsdom ceiling below by running BotGuard in genuine Chromium. It raises
 * the odds but is not a guarantee; any miss falls back to this jsdom path,
 * so the default (flag unset) behavior is byte-for-byte unchanged.
 */

import { fetch as undiciFetch } from "undici";
import { browserPoTokenEnabled, mintPoTokenBrowser } from "./potoken-browser";

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo"; // WEB player attestation request key
const GOOG_API_KEY = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw"; // public WAA key
const WAA_GENERATE_IT =
  "https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT";
const FAIL_TTL_MS = 10 * 60 * 1000;
/** BotGuard environment rejection (VM runs but withholds the WebPO signal in
 *  synthetic DOMs) is systematic, not transient — cool down for a full hour. */
const HARD_FAIL_TTL_MS = 60 * 60 * 1000;
const MAX_TTL_MS = 6 * 60 * 60 * 1000;

export function poTokenEnabled(): boolean {
  return process.env.QUASAR_YT_POTOKEN !== "0";
}

interface MinterBox {
  minter: {
    mintAsWebsafeString(contentBinding: string): Promise<string>;
  };
  /** Keep the jsdom window + VM referenced for as long as the minter lives. */
  keepAlive: unknown;
  expiresAt: number;
}

let minterBox: MinterBox | null = null;
let inflight: Promise<MinterBox | null> | null = null;
let lastFailure = 0;
let hardFailure = false;

async function buildMinter(): Promise<MinterBox | null> {
  // bgutils-js v4 exposes subpath exports only (no "." root): botguard has
  // the client + challenge fetcher, webpo has the minter.
  const [bg, bgwebpo, jsdomMod] = await Promise.all([
    import("bgutils-js/botguard"),
    import("bgutils-js/webpo"),
    import("jsdom"),
  ]);
  const { JSDOM } = jsdomMod;

  // 1. Fetch the BotGuard challenge (interpreter script + bytecode program).
  const challenge = await bg.getChallenge({
    requestKey: REQUEST_KEY,
    fetchFunction: undiciFetch as unknown as typeof fetch,
  });
  const interpreterJs =
    challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (!interpreterJs || !challenge.program) {
    throw new Error("challenge missing interpreter/program");
  }

  // 2. Run the interpreter inside a fresh jsdom window (the VM's global object).
  const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
    url: "https://www.youtube.com/",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const win = dom.window;
  win.eval(interpreterJs);

  // 3. Load the bytecode program into the VM and take a snapshot.
  const globalName = challenge.globalName ?? "_pmhHklvI";
  const botguard = await bg.BotGuardClient.create({
    globalObject: win,
    globalName,
    program: challenge.program,
  });
  const webPoSignalOutput: unknown[] = [];
  const botguardResponse = await botguard.snapshot({
    webPoSignalOutput,
    skipPrivacyBuffer: true,
  } as never);
  if (!webPoSignalOutput.length) {
    // The VM completed but did not emit the WebPO minter — BotGuard's runtime
    // integrity checks rejected this environment. Requests proceed tokenless.
    throw new Error("webpo-signal-missing (environment rejected by BotGuard)");
  }

  // 4. Exchange the snapshot for an integrity token (WAA GenerateIT).
  const itRes = await undiciFetch(WAA_GENERATE_IT, {
    method: "POST",
    headers: {
      "content-type": "application/json+protobuf",
      "x-goog-api-key": GOOG_API_KEY,
      "x-user-agent": "grpc-web-javascript/0.1",
    },
    body: JSON.stringify([REQUEST_KEY, botguardResponse]),
  });
  if (!itRes.ok) throw new Error(`GenerateIT failed: ${itRes.status}`);
  const itJson = (await itRes.json()) as [string, number, number, string];
  const integrityToken = itJson?.[0];
  if (!integrityToken) throw new Error("GenerateIT returned no token");

  // 5. Bind the minter (webPoSignalOutput[0] + integrity token).
  const minter = await bgwebpo.WebPoMinter.create(
    { integrityToken },
    webPoSignalOutput as never
  );

  const ttlMs = Math.min(
    MAX_TTL_MS,
    Math.max(10 * 60 * 1000, Math.floor((itJson?.[1] ?? 21600) * 0.8) * 1000)
  );
  return {
    minter,
    keepAlive: { dom, botguard },
    expiresAt: Date.now() + ttlMs,
  };
}

async function getMinter(): Promise<MinterBox | null> {
  if (!poTokenEnabled()) return null;
  if (minterBox && Date.now() < minterBox.expiresAt) return minterBox;
  const cooldown = hardFailure ? HARD_FAIL_TTL_MS : FAIL_TTL_MS;
  if (Date.now() - lastFailure < cooldown) return null;
  if (!inflight) {
    inflight = buildMinter()
      .then((box) => {
        if (box) {
          minterBox = box;
          hardFailure = false;
        } else {
          lastFailure = Date.now();
        }
        return box;
      })
      .catch((err) => {
        const msg = String(err?.message ?? err);
        console.error("[quasar] poToken generation failed (requests proceed tokenless):", msg);
        lastFailure = Date.now();
        hardFailure = /webpo-signal-missing/i.test(msg);
        return null;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * Inject a poToken into a proxied `/youtubei/v1/*` JSON request body.
 * Returns the ORIGINAL buffer unless a token was successfully minted —
 * this function never throws and never produces invalid JSON.
 */
export async function injectPoTokenIfNeeded(body: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const text = new TextDecoder().decode(body);
    const json = JSON.parse(text) as Record<string, unknown>;
    if (!json || typeof json !== "object") return body;

    // Content binding: the video ID when present (content-bound token),
    // otherwise a generic binding — matches YouTube's web client behavior.
    const binding =
      (typeof json.videoId === "string" && json.videoId) ||
      (typeof json.contentBinding === "string" && json.contentBinding) ||
      "";

    // v2.1.0: browser-first when explicitly enabled. mintPoTokenBrowser
    // never throws; null → fall through to the jsdom/bgutils path.
    let poToken: string | null = null;
    if (browserPoTokenEnabled()) {
      poToken = (await mintPoTokenBrowser(binding))?.poToken ?? null;
    }
    if (!poToken) {
      const box = await getMinter();
      if (box) poToken = await box.minter.mintAsWebsafeString(binding);
    }
    if (!poToken) return body;

    if (!json.serviceIntegrityDimensions) {
      json.serviceIntegrityDimensions = { poToken };
    }
    const out = new TextEncoder().encode(JSON.stringify(json));
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
  } catch {
    return body;
  }
}
