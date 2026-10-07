/**
 * Quasar HTTP Agent (v2.0.4, extended v2.1.0)
 * -------------------------------------------
 * Shared undici connection pools for all upstream proxy fetches.
 *
 * JS-heavy sites (Discord, YouTube, Reddit…) load 100+ parallel subresources;
 * undici's default HTTP/1.1 dispatcher serializes each origin onto at most
 * ~6 connections. The direct Agent:
 *   - enables HTTP/2 (allowH2) where the target supports it — multiplexed
 *     streams over one TLS connection, dramatically better TTFB bursts;
 *   - keeps a generous per-origin connection pool for HTTP/1.1 origins;
 *   - never times out bodies (video ranges / SSE / long downloads must
 *     survive), matching the header-only abort policy in fetcher.ts.
 *
 * v2.1.0 — QUASAR_UPSTREAM_PROXY (e.g. http://user:pass@residential-gw:8080)
 * chains every upstream request through an outbound HTTP(S) proxy via undici
 * ProxyAgent (CONNECT tunnel). This is the documented cheap fallback for
 * anti-bot-fingerprinted targets (real residential IP beats datacenter
 * reputation). Per-tab egress overrides select which pool a request uses:
 *   auto/absent → upstream proxy when configured, else direct pool
 *   direct      → always the direct pool (never the upstream proxy)
 *   upstream    → always the upstream proxy (falls back to direct when unset)
 * Note: CONNECT tunneling speaks HTTP/1.1 to the proxy; origin connections
 * through the tunnel are HTTP/1.1 (allowH2 does not apply).
 *
 * Disable HTTP/2 on the direct pool with QUASAR_NO_H2=1.
 */

import { Agent, ProxyAgent } from "undici";

const HEADER_TIMEOUT_MS = 35_000; // above fetcher's 30s header abort timer
const CONNECT_TIMEOUT_MS = 15_000;
/** Max sockets per origin (undici default is 6 — far too few for SPAs). */
const CONNECTIONS_PER_ORIGIN = 128;

let agent: Agent | null | undefined;
let proxyAgent: ProxyAgent | null | undefined;

function poolOptions() {
  return {
    connections: CONNECTIONS_PER_ORIGIN,
    pipelining: 1,
    connect: { timeout: CONNECT_TIMEOUT_MS },
    bodyTimeout: 0,
    headersTimeout: HEADER_TIMEOUT_MS,
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 120_000,
  };
}

/** The shared direct dispatcher, or undefined when H2 pooling is disabled. */
export function quasarDispatcher(): Agent | undefined {
  if (agent === undefined) {
    if (process.env.QUASAR_NO_H2 === "1") {
      agent = null;
    } else {
      try {
        agent = new Agent({ allowH2: true, ...poolOptions() });
      } catch (err) {
        console.error("[quasar] http agent init failed, using default dispatcher", err);
        agent = null;
      }
    }
  }
  return agent ?? undefined;
}

/** QUASAR_UPSTREAM_PROXY value (undefined when not configured). */
export function upstreamProxyUrl(): string | undefined {
  const v = process.env.QUASAR_UPSTREAM_PROXY?.trim();
  return v ? v : undefined;
}

/**
 * The upstream-proxy dispatcher (CONNECT tunnel through QUASAR_UPSTREAM_PROXY),
 * or undefined when no upstream proxy is configured / initialization failed.
 */
export function upstreamDispatcher(): ProxyAgent | undefined {
  if (proxyAgent === undefined) {
    const uri = upstreamProxyUrl();
    if (!uri) {
      proxyAgent = null;
    } else {
      try {
        const opts: Record<string, unknown> = { uri, ...poolOptions() };
        // Support http://user:pass@host:port — ProxyAgent also accepts a
        // `token` header form; the URL userinfo form is the common one.
        const auth = new URL(uri);
        if (auth.username || auth.password) {
          opts.token =
            "Basic " +
            Buffer.from(
              decodeURIComponent(auth.username) + ":" + decodeURIComponent(auth.password)
            ).toString("base64");
        }
        proxyAgent = new ProxyAgent(opts as ConstructorParameters<typeof ProxyAgent>[0]);
        console.log(
          "[quasar] upstream proxy pool active -> " + auth.protocol + "//" + auth.host +
            " (CONNECT tunnel, HTTP/1.1)"
        );
      } catch (err) {
        console.error("[quasar] upstream proxy agent init failed", err);
        proxyAgent = null;
      }
    }
  }
  return proxyAgent ?? undefined;
}

/**
 * Resolve the dispatcher for a request's egress mode.
 *   "direct"   → direct pool (never the upstream proxy)
 *   "upstream" → upstream proxy pool, falling back to direct when unconfigured
 *   otherwise  → upstream proxy when configured, else direct pool
 */
export function dispatcherFor(egress?: string): Agent | ProxyAgent | undefined {
  const proxy = upstreamDispatcher();
  if (egress === "direct") return quasarDispatcher();
  if (egress === "upstream") return proxy ?? quasarDispatcher();
  return proxy ?? quasarDispatcher();
}
