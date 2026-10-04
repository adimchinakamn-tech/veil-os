/**
 * Quasar HTTP Agent (v2.0.4)
 * --------------------------
 * Shared undici connection pool for all upstream proxy fetches.
 *
 * JS-heavy sites (Discord, YouTube, Reddit…) load 100+ parallel subresources;
 * undici's default HTTP/1.1 dispatcher serializes each origin onto at most
 * ~6 connections. This Agent:
 *   - enables HTTP/2 (allowH2) where the target supports it — multiplexed
 *     streams over one TLS connection, dramatically better TTFB bursts;
 *   - keeps a generous per-origin connection pool for HTTP/1.1 origins;
 *   - never times out bodies (video ranges / SSE / long downloads must
 *     survive), matching the header-only abort policy in fetcher.ts.
 *
 * Disable HTTP/2 with QUASAR_NO_H2=1 (falls back to the default dispatcher).
 */

import { Agent } from "undici";

const HEADER_TIMEOUT_MS = 35_000; // above fetcher's 30s header abort timer
const CONNECT_TIMEOUT_MS = 15_000;
/** Max sockets per origin (undici default is 6 — far too few for SPAs). */
const CONNECTIONS_PER_ORIGIN = 128;

let agent: Agent | null | undefined;

/** The shared dispatcher, or undefined when H2 pooling is disabled. */
export function quasarDispatcher(): Agent | undefined {
  if (agent === undefined) {
    if (process.env.QUASAR_NO_H2 === "1") {
      agent = null;
    } else {
      try {
        agent = new Agent({
          allowH2: true,
          connections: CONNECTIONS_PER_ORIGIN,
          pipelining: 1,
          connect: { timeout: CONNECT_TIMEOUT_MS },
          bodyTimeout: 0,
          headersTimeout: HEADER_TIMEOUT_MS,
          keepAliveTimeout: 30_000,
          keepAliveMaxTimeout: 120_000,
        });
      } catch (err) {
        console.error("[quasar] http agent init failed, using default dispatcher", err);
        agent = null;
      }
    }
  }
  return agent ?? undefined;
}
