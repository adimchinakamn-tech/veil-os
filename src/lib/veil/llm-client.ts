/**
 * Veil — resilient LLM client (shared by /api/ai and /api/ai-operator).
 *
 * The model gateway intermittently answers TRANSIENT errors that used to
 * surface to users as instant 502 "assistant unavailable" pages:
 *
 *   401 {"error":"missing X-Token header"}  — a half-provisioned/stale
 *        SDK instance whose requests go out without credentials. A fresh
 *        ZAI.create() re-reads the credentials and heals it.
 *   429 rate limit                          — bursts of requests (chat +
 *        operator + builds in parallel) trip the quota for a few seconds.
 *   5xx / connection resets / wedged creates — plain flakiness.
 *
 * llmCreate() wraps zai.chat.completions.create with:
 *   - a process-cached ZAI instance for the FIRST attempt (cheap path),
 *   - a FRESH instance for every retry (heals the 401 token case),
 *   - exponential backoff between attempts (heals 429 bursts),
 *   - an optional per-attempt create timeout so the existing "model
 *     server never started writing" watchdog semantics are preserved
 *     per attempt instead of across the whole retry budget.
 *
 * Retry safety: a failed create() has no side effects — the stream/completion
 * is only consumed by the caller AFTER this resolves, so nothing is
 * double-delivered. Errors DURING consumption are not retried here (deltas
 * may already have reached the client); the routes' own watchdogs own that
 * territory.
 */

export type LlmChatParams = Record<string, unknown> & {
  stream?: boolean;
  messages?: unknown;
};

type ZaiInstance = Awaited<
  ReturnType<(typeof import("z-ai-web-dev-sdk"))["default"]["create"]>
>;

/* Transient upstream failure signatures worth a retry. Deliberately broad
 * on status codes (401/403/408/429/5xx) and transport errors; the SDK
 * reports HTTP failures as "API request failed with status NNN: …". */
const TRANSIENT_LLM_ERROR =
  /status (401|403|408|429|5\d\d)\b|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed|network error|socket hang up|create timed out|API request failed/i;

export function isTransientLlmError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return TRANSIENT_LLM_ERROR.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      t = setTimeout(() => reject(new Error(what)), ms);
    }),
  ]).finally(() => {
    if (t) clearTimeout(t);
  });
}

/* Process-cached SDK instance. Invalidated (nulled) whenever an attempt
 * fails transiently so the next attempt rebuilds credentials from disk. */
let cachedZai: ZaiInstance | null = null;

/* The SDK reads a .z-ai-config file from cwd / $HOME / /etc (in that
 * order). On the dev box /etc/.z-ai-config exists — nothing to do. On
 * serverless deploys (Vercel) none of them exist, so before the first
 * create() we materialize the config from ZAI_* env vars (set in the
 * Vercel dashboard — never committed). */
async function ensureZaiConfig(): Promise<void> {
  try {
    const { existsSync, writeFileSync } = await import("fs");
    const { join } = await import("path");
    const os = await import("os");
    const existing = [
      join(process.cwd(), ".z-ai-config"),
      join(os.homedir(), ".z-ai-config"),
      "/etc/.z-ai-config",
    ].some((p) => existsSync(p));
    if (existing) return;

    const env = process.env;
    const cfg = {
      baseUrl: env.ZAI_BASE_URL,
      apiKey: env.ZAI_API_KEY,
      chatId: env.ZAI_CHAT_ID,
      token: env.ZAI_TOKEN,
      userId: env.ZAI_USER_ID,
    };
    if (!cfg.apiKey && !cfg.token) return; // nothing to materialize
    const json = JSON.stringify(cfg);

    // Prefer cwd (SDK's first search path); fall back to $HOME; last
    // resort /tmp + chdir so the SDK's cwd-relative lookup finds it.
    const spots = [process.cwd(), os.homedir()];
    for (const dir of spots) {
      try {
        writeFileSync(join(dir, ".z-ai-config"), json);
        return;
      } catch {
        /* read-only */
      }
    }
    try {
      writeFileSync("/tmp/.z-ai-config", json);
      process.chdir("/tmp");
    } catch {
      /* give up — the create() below will surface the error */
    }
  } catch {
    /* config bootstrap must never block the call */
  }
}

async function getZai(fresh: boolean): Promise<ZaiInstance> {
  if (!fresh && cachedZai) return cachedZai;
  await ensureZaiConfig();
  const mod = (await import("z-ai-web-dev-sdk")) as unknown as {
    default: { create: () => Promise<ZaiInstance> } | null;
  };
  if (!mod?.default) throw new Error("the SDK failed to load");
  const zai = await mod.default.create();
  cachedZai = zai;
  return zai;
}

/** Drop the cached instance (next call re-creates it with fresh creds). */
export function invalidateLlmClient(): void {
  cachedZai = null;
}

export interface LlmCreateOptions {
  /** Total attempts including the first (default 3). */
  attempts?: number;
  /** Per-attempt timeout on the create() call itself, mirroring the
   * routes' CREATE_TIMEOUT_MS watchdog. 0/undefined = no timeout. */
  createTimeoutMs?: number;
  /** Backoff before retry #n (n = 1, 2, …). Default: 1.1s then 3.2s. */
  backoffMs?: (retryNo: number) => number;
  /** Optional observer (e.g. logging / SSE retry notices). */
  onRetry?: (retryNo: number, delayMs: number, err: unknown) => void;
}

/**
 * Call zai.chat.completions.create with transient-failure retries.
 * Generic over the return type — pass AsyncIterable<unknown> for
 * `stream: true` calls, or the SDK completion type for JSON calls.
 */

/**
 * Vision variant — zai.chat.completions.createVision. Identical retry
 * semantics to llmCreate, but routes through the multimodal endpoint
 * (message content may carry {type:"image_url"} parts). Falls back to
 * plain create() when the vision endpoint rejects the request shape.
 */
export async function llmCreateVision<T = unknown>(
  params: LlmChatParams,
  opts: LlmCreateOptions = {}
): Promise<T> {
  const attempts = Math.max(1, Math.min(4, opts.attempts ?? 3));
  const backoff =
    opts.backoffMs ?? ((n: number) => (n === 1 ? 1_100 : 3_200));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const zai = await getZai(attempt > 1);
      const vision = (zai.chat.completions as unknown as {
        createVision?: (p: unknown) => Promise<T>;
      }).createVision;
      if (typeof vision !== "function") {
        // SDK without the vision method — degrade to the plain call
        // (text parts still work; images are dropped by the gateway).
        return await llmCreate<T>(params, opts);
      }
      const call = vision(params);
      if (opts.createTimeoutMs && opts.createTimeoutMs > 0) {
        return await withTimeout(
          call,
          opts.createTimeoutMs,
          "the model server never started writing (create timed out)"
        );
      }
      return await call;
    } catch (e) {
      lastErr = e;
      if (attempt >= attempts || !isTransientLlmError(e)) throw e;
      const delay = backoff(attempt);
      try {
        opts.onRetry?.(attempt, delay, e);
      } catch {
        /* observer must never break the retry */
      }
      await sleep(delay);
    }
  }
  throw lastErr;
}
export async function llmCreate<T = unknown>(
  params: LlmChatParams,
  opts: LlmCreateOptions = {}
): Promise<T> {
  const attempts = Math.max(1, Math.min(4, opts.attempts ?? 3));
  const backoff =
    opts.backoffMs ?? ((n: number) => (n === 1 ? 1_100 : 3_200));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const zai = await getZai(attempt > 1);
      const call = zai.chat.completions.create(
        params as Parameters<ZaiInstance["chat"]["completions"]["create"]>[0]
      ) as Promise<T>;
      if (opts.createTimeoutMs && opts.createTimeoutMs > 0) {
        return await withTimeout(
          call,
          opts.createTimeoutMs,
          "the model server never started writing (create timed out)"
        );
      }
      return await call;
    } catch (e) {
      lastErr = e;
      if (attempt >= attempts || !isTransientLlmError(e)) throw e;
      const delay = backoff(attempt);
      try {
        opts.onRetry?.(attempt, delay, e);
      } catch {
        /* observer must never break the retry */
      }
      await sleep(delay);
    }
  }
  throw lastErr;
}
