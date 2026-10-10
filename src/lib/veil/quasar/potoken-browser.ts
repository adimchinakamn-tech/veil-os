/**
 * Quasar Browser poToken Provider (v2.1.0, optional + experimental)
 * ------------------------------------------------------------------
 * Attacks the documented hard ceiling of the jsdom provider (see potoken.ts):
 * YouTube's BotGuard routinely WITHHOLDS the WebPO minter signal when its
 * bytecode runs inside synthetic DOM environments (jsdom), so the server-side
 * jsdom minter can never be built. This provider runs the SAME BotGuard flow
 * (challenge → interpreter → snapshot → GenerateIT → WebPO mint) inside a REAL
 * headless Chromium (playwright-core), where the runtime-integrity checks are
 * far more likely to pass — BotGuard is known to mint in genuine browsers
 * where jsdom fails.
 *
 * HONESTY NOTE: this raises the odds — it is NOT a guarantee. BotGuard may
 * still refuse a headless browser (automation fingerprints, datacenter IP
 * reputation, missing codecs, CSP blocking script injection, ...), and the
 * in-page recipe below mirrors bgutils' reverse-engineered flow, which
 * YouTube can change at any time (the snapshot/mint API shapes are probed
 * defensively for exactly that reason). Every failure degrades to `null`;
 * the caller (potoken.ts) then falls back to the jsdom path or tokenless
 * requests, so enabling this flag can never make anything worse.
 *
 * Opt-in: QUASAR_POTOKEN_BROWSER=1 (default: this module is fully inert and
 * the rest of Quasar behaves exactly as before).
 * Chromium binary: QUASAR_CHROMIUM_PATH if set, otherwise playwright-core's
 * own resolution (downloaded browsers or a system chrome via its channel
 * lookup). playwright-core / playwright are OPTIONAL peers, deliberately NOT
 * in package.json — they are imported dynamically inside try/catch; if the
 * import fails the module logs once and acts disabled until process restart.
 *
 * This module NEVER throws: every await is guarded and the public surface
 * only returns values or `null`.
 */

/** Exact required log line when playwright-core is missing. */
const PW_MISSING_LOG =
  "[quasar] QUASAR_POTOKEN_BROWSER=1 but playwright is not installed (bun add playwright-core + system chromium)";

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo"; // WEB player attestation request key
const GOOG_API_KEY = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw"; // public WAA key
const WAA_GENERATE_IT =
  "https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT";

/** Hard timeout for one whole mint (navigation + challenge + mint). */
const MINT_TIMEOUT_MS = 20_000;
const NAV_TIMEOUT_MS = 12_000;
const LOAD_TIMEOUT_MS = 8_000;
/** Small warm-up so the page's own player/BotGuard bootstrap has a beat. */
const WARMUP_MS = 1_200;
/** Launch timeout inside playwright itself (overall race governs anyway). */
const LAUNCH_TIMEOUT_MS = 15_000;

/** Successful mints are cached per binding for 6 h, LRU max 50. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 50;
/** A binding whose mint failed is not retried for 10 min (negative cache). */
const NEG_TTL_MS = 10 * 60 * 1000;
const NEG_MAX = 200;
/** Warnings ("no minter" etc.) are rate-limited to one per 10 min. */
const WARN_TTL_MS = 10 * 60 * 1000;
/** A browser that cannot launch cools the whole provider down 10 min. */
const LAUNCH_COOLDOWN_MS = 10 * 60 * 1000;
/** Guard against pathological loops: N consecutive mint failures (e.g. every
 * new videoId timing out) also trips a global 10-min cooldown. */
const MAX_CONSECUTIVE_FAILURES = 3;
const FAILURE_COOLDOWN_MS = 10 * 60 * 1000;

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface BrowserPoToken {
  poToken: string;
  integrityTokenBased?: boolean;
  source: "browser";
}

/* ----------------------------------------------------------------------- */
/* Minimal structural types for playwright-core. The real package is an    */
/* OPTIONAL peer and must never be imported statically (types included).   */
/* ----------------------------------------------------------------------- */
interface PWLaunchOptions {
  headless: boolean;
  executablePath?: string;
  timeout?: number;
  args?: string[];
}
interface PWPage {
  goto(
    url: string,
    opts?: { waitUntil?: "commit" | "domcontentloaded" | "load" | "networkidle"; timeout?: number }
  ): Promise<unknown>;
  waitForLoadState(state: "domcontentloaded" | "load" | "networkidle", opts?: { timeout?: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<R, A>(fn: (arg: A) => Promise<R>, arg: A): Promise<R>;
  close(opts?: { runBeforeUnload?: boolean }): Promise<void>;
}
interface PWContext {
  newPage(): Promise<PWPage>;
  addInitScript(script: () => void): Promise<void>;
  close(opts?: { reason?: string }): Promise<void>;
}
interface PWBrowser {
  newContext(opts?: Record<string, unknown>): Promise<PWContext>;
  process?(): { kill(signal?: string): boolean | undefined } | null;
  close(opts?: { reason?: string }): Promise<void>;
}
interface PWChromium {
  launch(opts: PWLaunchOptions): Promise<PWBrowser>;
}

/* ----------------------------------------------------------------------- */
/* Module state                                                            */
/* ----------------------------------------------------------------------- */

/** undefined = not attempted yet, null = import failed (act disabled). */
let chromium: PWChromium | null | undefined;
let browserPromise: Promise<PWBrowser> | null = null;
let browserProc: { kill(signal?: string): boolean | undefined } | null = null;
let processHooksInstalled = false;
/** Import failed → permanently disabled until process restart (logged once). */
let playwrightDisabled = false;

let globalCooldownUntil = 0;
let consecutiveFailures = 0;
let lastWarnAt = 0;

/** Successful mints: binding → token (LRU, 6 h TTL). */
const cache = new Map<string, { token: BrowserPoToken; expiresAt: number }>();
/** Failed mints: binding → retry-not-before timestamp. */
const negCache = new Map<string, number>();
/** Dedupe concurrent mints of the same binding. */
const inflight = new Map<string, Promise<BrowserPoToken | null>>();

/* ----------------------------------------------------------------------- */
/* Public API                                                              */
/* ----------------------------------------------------------------------- */

export function browserPoTokenEnabled(): boolean {
  return process.env.QUASAR_POTOKEN_BROWSER === "1";
}

/**
 * Mint a poToken bound to `videoId` (any content binding is accepted; video
 * IDs navigate to the genuine embed page). Never throws — any failure
 * returns null and the caller falls back to the jsdom provider.
 */
export async function mintPoTokenBrowser(videoId: string): Promise<BrowserPoToken | null> {
  if (!browserPoTokenEnabled()) return null;
  const binding = typeof videoId === "string" ? videoId.trim() : "";

  const hit = cacheGet(binding);
  if (hit) return hit;

  const pending = inflight.get(binding);
  if (pending) return pending;

  const promise = mintOnce(binding).finally(() => {
    inflight.delete(binding);
  });
  inflight.set(binding, promise);
  return promise;
}

/** Cached result for a binding, or null. Never triggers a mint. */
export function browserPoTokenFor(videoId: string): BrowserPoToken | null {
  if (!browserPoTokenEnabled()) return null;
  const binding = typeof videoId === "string" ? videoId.trim() : "";
  return cacheGet(binding);
}

/* ----------------------------------------------------------------------- */
/* Mint orchestration                                                      */
/* ----------------------------------------------------------------------- */

async function mintOnce(binding: string): Promise<BrowserPoToken | null> {
  if (playwrightDisabled) return null;
  if (Date.now() < globalCooldownUntil) return null;

  const negUntil = negCache.get(binding);
  if (negUntil && Date.now() < negUntil) return null;

  // Boxed so TS flow analysis can't narrow the finally-side reference to
  // `never` (the assignment happens inside the async IIFE below).
  const box: { context: PWContext | null } = { context: null };
  const startedAt = Date.now();
  try {
    const work = (async (): Promise<BrowserPoToken> => {
      const browser = await getBrowser();
      const context = await browser.newContext(contextOptions());
      box.context = context;
      // Best-effort softening of the loudest automation tells. Honest: this
      // is shallow and BotGuard may still fingerprint the environment.
      try {
        await context.addInitScript(stealthInit);
      } catch {
        /* cosmetic only */
      }
      const page = await context.newPage();

      // Fresh page per mint. A video-ID-shaped binding gets the genuine
      // embed page; anything else gets the bare site (an equally genuine
      // BotGuard environment — the challenge itself is not video-bound).
      const embedUrl =
        /^[\w-]{6,20}$/.test(binding)
          ? `https://www.youtube.com/embed/${encodeURIComponent(binding)}`
          : "https://www.youtube.com/";
      let navigated = true;
      try {
        await page.goto(embedUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      } catch {
        navigated = false;
      }
      if (!navigated) {
        try {
          await page.goto("https://www.youtube.com/", {
            waitUntil: "domcontentloaded",
            timeout: NAV_TIMEOUT_MS,
          });
        } catch {
          /* keep going — the evaluate below will fail honestly if the page is dead */
        }
      }
      try {
        await page.waitForLoadState("load", { timeout: LOAD_TIMEOUT_MS });
      } catch {
        /* load-event timeout is tolerated */
      }
      try {
        await page.waitForTimeout(WARMUP_MS);
      } catch {
        /* ignore */
      }

      const outcome = await page.evaluate(inPageMint, {
        requestKey: REQUEST_KEY,
        googApiKey: GOOG_API_KEY,
        waaUrl: WAA_GENERATE_IT,
        binding,
      });
      if (outcome && typeof outcome.error === "string" && outcome.error) {
        throw new Error(outcome.error);
      }
      const poToken = outcome && typeof outcome.poToken === "string" ? outcome.poToken : "";
      if (!poToken) throw new Error("in-page mint returned no token");
      return {
        poToken,
        integrityTokenBased: outcome.integrityTokenBased === true,
        source: "browser" as const,
      };
    })();

    // Hard timeout for the whole mint. On timeout this resolves null while
    // the outer finally closes the context, which aborts the in-flight
    // evaluate/page — nothing leaks, nothing throws.
    const token = await raceTimeout(work, MINT_TIMEOUT_MS);
    if (!token) throw new Error(`mint did not finish within ${MINT_TIMEOUT_MS}ms`);

    consecutiveFailures = 0;
    negCache.delete(binding);
    cacheSet(binding, token);
    return token;
  } catch (err) {
    recordFailure(err, Date.now() - startedAt, binding);
    return null;
  } finally {
    const context = box.context;
    if (context) {
      // Closing the context also closes the page and aborts any in-flight
      // evaluate (this is the timeout path's cleanup).
      await context.close().catch(() => {});
    }
  }
}

function recordFailure(err: unknown, elapsedMs: number, binding: string): void {
  const msg = String((err as { message?: string })?.message ?? err);

  // Missing playwright already logged its exact once-only line.
  if (playwrightDisabled) return;

  if (/launch|executable|browserType|Failed to launch/i.test(msg)) {
    // Spec: a browser that cannot launch cools the whole provider down.
    globalCooldownUntil = Date.now() + LAUNCH_COOLDOWN_MS;
    consecutiveFailures = 0;
    console.error(
      `[quasar] browser poToken: chromium launch failed (${msg}) — cooling down 10 min (jsdom path stays active)`
    );
    return;
  }

  // Per-binding negative cache so one dead binding doesn't re-mint per hit.
  negCacheSet(binding);

  consecutiveFailures += 1;
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    globalCooldownUntil = Date.now() + FAILURE_COOLDOWN_MS;
    consecutiveFailures = 0;
    console.warn(
      `[quasar] browser poToken: ${MAX_CONSECUTIVE_FAILURES} consecutive mint failures — cooling down 10 min (${msg})`
    );
    return;
  }
  warnOncePer10Min(
    `[quasar] browser poToken: mint failed after ${elapsedMs}ms for "${binding || "<generic>"}" — falling back to jsdom/tokenless (${msg})`
  );
}

function warnOncePer10Min(message: string): void {
  const now = Date.now();
  if (now - lastWarnAt < WARN_TTL_MS) return;
  lastWarnAt = now;
  console.warn(message);
}

/* ----------------------------------------------------------------------- */
/* Browser lifecycle (lazy singleton, killed best-effort on exit/SIGTERM)  */
/* ----------------------------------------------------------------------- */

async function loadChromium(): Promise<PWChromium> {
  if (chromium !== undefined) {
    if (!chromium) throw new Error("playwright-unavailable");
    return chromium;
  }
  try {
    // playwright-core is an optional peer NOT in package.json. Dynamic import
    // + serverExternalPackages keep it a plain runtime require: if it is not
    // installed this fails at runtime only (never at build), inside this
    // try/catch, and the provider logs once and acts disabled.
    // @ts-expect-error — optional peer dependency, absent from package.json on purpose
    const mod = (await import(/* webpackIgnore: true */ "playwright-core")) as {
      chromium?: PWChromium;
    };
    if (!mod || !mod.chromium) throw new Error("playwright-core exposed no chromium API");
    chromium = mod.chromium;
    return chromium;
  } catch {
    chromium = null;
    playwrightDisabled = true;
    console.error(PW_MISSING_LOG);
    throw new Error("playwright-unavailable");
  }
}

async function getBrowser(): Promise<PWBrowser> {
  if (browserPromise) return browserPromise;
  const pw = await loadChromium();
  const executablePath = process.env.QUASAR_CHROMIUM_PATH?.trim() || undefined;
  browserPromise = pw
    .launch({
      headless: true,
      executablePath,
      timeout: LAUNCH_TIMEOUT_MS,
      // --no-sandbox: required in most containers; --disable-dev-shm-usage:
      // small /dev/shm; AutomationControlled off: one less headless tell.
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
    })
    .then((browser) => {
      try {
        browserProc = browser.process?.() ?? null;
      } catch {
        browserProc = null;
      }
      installProcessHooks();
      return browser;
    });
  // A failed launch must not poison the singleton forever — the next
  // attempt (after the 10-min cooldown) gets a fresh shot.
  browserPromise.catch(() => {
    browserPromise = null;
  });
  return browserPromise;
}

function installProcessHooks(): void {
  if (processHooksInstalled) return;
  processHooksInstalled = true;
  const killSync = (): void => {
    const proc = browserProc;
    try {
      proc?.kill("SIGKILL");
    } catch {
      /* best-effort */
    }
    browserProc = null;
  };
  // 'exit' handlers must be sync → SIGKILL the chromium child so an exiting
  // Node process cannot orphan headless browsers.
  process.once("exit", killSync);
  // On SIGTERM: kill the browser, then re-raise. Our once-handler removes
  // itself, so the re-raised signal reaches default handling / other
  // listeners with normal termination semantics preserved.
  process.once("SIGTERM", () => {
    killSync();
    try {
      process.kill(process.pid, "SIGTERM");
    } catch {
      process.exit(0);
    }
  });
}

function contextOptions(): Record<string, unknown> {
  return {
    // "HeadlessChrome" in the UA is an easy BotGuard tell; present as a
    // normal desktop Chrome. Honest: UA spoofing is shallow.
    userAgent: CHROME_UA,
    viewport: { width: 1280, height: 720 },
    locale: "en-US",
  };
}

/** Runs in the page before any page script (playwright serializes this). */
function stealthInit(): void {
  try {
    Object.defineProperty(Navigator.prototype, "webdriver", {
      get: () => false, // genuine Chrome reports false; playwright sets true
      configurable: true,
    });
  } catch {
    /* cosmetic only */
  }
}

/* ----------------------------------------------------------------------- */
/* Caches (LRU)                                                            */
/* ----------------------------------------------------------------------- */

function cacheGet(binding: string): BrowserPoToken | null {
  const entry = cache.get(binding);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(binding);
    return null;
  }
  cache.delete(binding);
  cache.set(binding, entry); // LRU refresh
  return entry.token;
}

function cacheSet(binding: string, token: BrowserPoToken): void {
  cache.delete(binding);
  while (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  cache.set(binding, { token, expiresAt: Date.now() + CACHE_TTL_MS });
}

function negCacheSet(binding: string): void {
  negCache.delete(binding);
  while (negCache.size >= NEG_MAX) {
    const oldest = negCache.keys().next();
    if (oldest.done) break;
    negCache.delete(oldest.value);
  }
  negCache.set(binding, Date.now() + NEG_TTL_MS);
}

/* ----------------------------------------------------------------------- */
/* Timeout helper                                                          */
/* ----------------------------------------------------------------------- */

/** Resolves null if `work` doesn't settle within `ms`; never rejects. */
function raceTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/* ----------------------------------------------------------------------- */
/* The in-page recipe                                                      */
/*                                                                         */
/* Runs INSIDE the genuine Chromium page (playwright serializes this       */
/* function; it must not close over module scope — everything arrives via  */
/* `cfg`). It mirrors bgutils' flow: GenerateIT challenge → inject the     */
/* interpreter into the real page realm → snapshot the program → exchange  */
/* for an integrity token → bind the WebPO minter → mint. YouTube's raw VM */
/* API shapes vary across rollouts, so each step probes defensively.       */
/* ----------------------------------------------------------------------- */

interface InPageCfg {
  requestKey: string;
  googApiKey: string;
  waaUrl: string;
  binding: string;
}
interface InPageResult {
  poToken?: string;
  integrityTokenBased?: boolean;
  error?: string;
}

async function inPageMint(cfg: InPageCfg): Promise<InPageResult> {
  try {
    const b64ToBytes = (input: string): Uint8Array => {
      let s = input.replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4 !== 0) s += "=";
      const bin = atob(s);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    };
    const toWebsafeB64 = (data: ArrayLike<number>): string => {
      let bin = "";
      for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i]);
      return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    };
    const asWebsafeString = (value: unknown): string | null => {
      if (typeof value === "string" && value.length > 0) return value;
      if (value instanceof Uint8Array) return toWebsafeB64(value);
      if (ArrayBuffer.isView(value)) {
        const view = value as ArrayBufferView;
        return toWebsafeB64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      }
      if (Array.isArray(value)) return toWebsafeB64(value);
      return null;
    };
    const generateIt = async (body: unknown[]): Promise<unknown[]> => {
      // Same endpoint/headers bgutils uses — but sent FROM the genuine
      // youtube.com origin, so cookies/referrer/TLS match a real client.
      const res = await fetch(cfg.waaUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json+protobuf",
          "x-goog-api-key": cfg.googApiKey,
          "x-user-agent": "grpc-web-javascript/0.1",
        },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) throw new Error(`GenerateIT failed: ${res.status}`);
      return (await res.json()) as unknown[];
    };

    // 1. BotGuard challenge (interpreter script + bytecode program).
    const challenge = await generateIt([cfg.requestKey]);
    const interpreterJs = challenge?.[0];
    const program = challenge?.[1];
    const globalName =
      typeof challenge?.[2] === "string" && challenge[2] ? challenge[2] : "_pmhHklvI";
    if (typeof interpreterJs !== "string" || !interpreterJs) {
      throw new Error("challenge: no interpreter script");
    }
    if (typeof program !== "string" || !program) throw new Error("challenge: no program");

    // 2. Run the interpreter in the REAL page realm — the whole point of
    // this provider. Inline <script> matches how YouTube itself loads it;
    // a page CSP could block it, in which case we retry via indirect eval
    // (same CSP gate) before giving up.
    const runInPage = (js: string): void => {
      const scriptEl = document.createElement("script");
      scriptEl.textContent = js;
      document.documentElement.appendChild(scriptEl); // inline scripts run synchronously
      scriptEl.remove();
    };
    runInPage(interpreterJs);
    let factory = (window as unknown as Record<string, unknown>)[globalName];
    if (typeof factory !== "function") {
      try {
        (0, eval)(interpreterJs); // indirect eval → global scope, like jsdom's win.eval
      } catch {
        /* factory check below decides */
      }
      factory = (window as unknown as Record<string, unknown>)[globalName];
    }
    if (typeof factory !== "function") {
      throw new Error(`botguard global missing after injection: ${globalName} (CSP?)`);
    }

    // 3. Snapshot: run the program, collect the WebPO signal functions.
    // The raw VM's constructor/snapshot shapes vary across YouTube rollouts
    // (bgutils wraps the same variance) — probe call-style then ctor-style,
    // promise-style then callback-style, and accept the first response.
    const webPoSignalOutput: unknown[] = [];
    type VmInstance = { snapshot?: (...args: unknown[]) => unknown };
    const factoryFn = factory as (prog: string) => VmInstance;
    const factoryCtor = factory as unknown as new (prog: string) => VmInstance;
    const instances: VmInstance[] = [];
    try {
      const inst = factoryFn(program);
      if (inst && typeof inst === "object") instances.push(inst);
    } catch {
      /* try ctor shape */
    }
    if (instances.length === 0) {
      try {
        const inst = new factoryCtor(program);
        if (inst && typeof inst === "object") instances.push(inst);
      } catch {
        /* handled below */
      }
    }
    const awaitable = (v: unknown): Promise<unknown> | null =>
      v && typeof (v as { then?: unknown }).then === "function" ? (v as Promise<unknown>) : null;

    let botguardResponse: unknown;
    let haveResponse = false;
    for (const inst of instances) {
      const snap = inst.snapshot;
      if (typeof snap !== "function") continue;
      // Shape A: snapshot({ webPoSignalOutput }) → Promise<string>
      try {
        const r = await snap.call(inst, { webPoSignalOutput });
        const p = awaitable(r);
        const value = p ? await p : r;
        if (typeof value === "string" && value) {
          botguardResponse = value;
          haveResponse = true;
          break;
        }
      } catch {
        /* fall through */
      }
      // Shape B: snapshot({ webPoSignalOutput }, callback)
      try {
        const value = await new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("snapshot callback timeout")), 8_000);
          try {
            const ret = snap.call(inst, { webPoSignalOutput }, (resp: unknown) => {
              clearTimeout(timer);
              resolve(resp);
            });
            const p = awaitable(ret);
            if (p) {
              p.then(
                (v: unknown) => {
                  clearTimeout(timer);
                  resolve(v);
                },
                (e: unknown) => {
                  clearTimeout(timer);
                  reject(e);
                }
              );
            }
          } catch (e) {
            clearTimeout(timer);
            reject(e);
          }
        });
        if (typeof value === "string" && value) {
          botguardResponse = value;
          haveResponse = true;
          break;
        }
      } catch {
        /* try next instance */
      }
    }
    if (!haveResponse) throw new Error("botguard snapshot produced no response (API shape mismatch)");
    if (webPoSignalOutput.length === 0) {
      // The same documented ceiling as jsdom: BotGuard can still refuse a
      // headless browser (fingerprinting, IP reputation, ...). Honest fail.
      throw new Error("webpo-signal-missing (environment rejected by BotGuard)");
    }

    // 4. Exchange the snapshot for an integrity token.
    const itJson = await generateIt([cfg.requestKey, botguardResponse]);
    const integrityToken = itJson?.[0];
    if (typeof integrityToken !== "string" || !integrityToken) {
      throw new Error("GenerateIT returned no integrity token");
    }

    // 5. Bind + mint — must happen in the page realm: the WebPO signal
    // functions only exist here. Raw VM minters may expose different method
    // names / argument types than bgutils' wrapper, so probe a few shapes.
    const getMinter = webPoSignalOutput[0];
    if (typeof getMinter !== "function") throw new Error("webpo getMinter signal missing");
    const minter: unknown = await (getMinter as (token: Uint8Array) => Promise<unknown>)(
      b64ToBytes(integrityToken)
    );
    const minterObj = minter as {
      mintAsWebsafeString?: (b: string) => Promise<unknown>;
      mint?: (a: unknown) => Promise<unknown>;
    };
    const bindingBytes = new TextEncoder().encode(cfg.binding);
    const minterFn = typeof minter === "function" ? (minter as (a: unknown) => Promise<unknown>) : null;

    let poToken: string | null = null;
    if (typeof minterObj?.mintAsWebsafeString === "function") {
      try {
        poToken = asWebsafeString(await minterObj.mintAsWebsafeString(cfg.binding));
      } catch {
        /* try raw mint shapes */
      }
    }
    if (!poToken && typeof minterObj?.mint === "function") {
      try {
        poToken = asWebsafeString(await minterObj.mint(cfg.binding));
      } catch {
        /* try bytes */
      }
      if (!poToken) {
        try {
          poToken = asWebsafeString(await minterObj.mint(bindingBytes));
        } catch {
          /* give up below */
        }
      }
    }
    if (!poToken && minterFn) {
      try {
        poToken = asWebsafeString(await minterFn(cfg.binding));
      } catch {
        /* try bytes */
      }
      if (!poToken) {
        try {
          poToken = asWebsafeString(await minterFn(bindingBytes));
        } catch {
          /* give up below */
        }
      }
    }
    if (!poToken || !/^[A-Za-z0-9_-]{20,}$/.test(poToken)) {
      throw new Error("minter produced no usable poToken");
    }
    return { poToken, integrityTokenBased: true };
  } catch (e) {
    return { error: String((e as { message?: string })?.message ?? e) };
  }
}
