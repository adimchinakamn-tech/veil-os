/**
 * Quasar ws-bridge
 * ----------------
 * Standalone Bun mini-service that bridges WebSockets for the Quasar proxy.
 *
 * Why: the Next.js app cannot proxy WebSocket connections. Proxied pages run
 * injected hooks that open `new WebSocket("/ws-bridge?XTransformPort=3310&target=<ENC>")`
 * on the app's origin; the Caddy gateway forwards that request (via the
 * XTransformPort query hint) to this service on port 3310. We decode the
 * `target` blob with the shared multi-format codec (src/lib/veil/quasar/codec-server.ts
 * — accepts AES-256-GCM, session-XOR and legacy "quasar-v1" XOR blobs) or take
 * an explicit raw ws://|wss:// target, dial the real server, and pipe messages
 * bidirectionally.
 *
 * Protocol (must match the client hook exactly):
 *   1. Client connects to /ws-bridge?target=<blob>
 *   2. Bridge upgrades the socket and dials the target immediately
 *   3. Client's FIRST message must be exactly `__QUASAR_READY__`
 *      -> bridge flushes anything the target already sent (e.g. banners)
 *   4. From then on every message is piped verbatim in both directions.
 *
 * Messages may be text or binary; they are forwarded as-is (string stays a
 * string, binary stays an ArrayBuffer). While one side is still connecting,
 * messages from the other side are buffered (200 messages max; overflow closes
 * the socket with 1011).
 */

import type { ServerWebSocket } from "bun";
// v2.0.4: outbound dials moved to the `ws` package — Bun's native WebSocket
// client cannot set custom headers, and Discord's gateway validates the
// Origin/User-Agent pair of the handshake. `ws` lets the bridge present the
// REAL target origin (https://discord.com) plus a browser-grade User-Agent.
import WS from "ws";
// Shared codec lives in the main project; bun resolves relative TS imports
// natively (codec-server only uses node:crypto/node:fs/node:path, all
// available in bun). The key file (.quasar-key) is found by searching upward
// from cwd, so this nested mini-service shares the deployment key.
import { decodeBlobRaw } from "../../src/lib/veil/quasar/codec-server";

const PORT = 3310; // hardcoded on purpose — must match Caddy XTransformPort routing
const READY_MAGIC = "__QUASAR_READY__";
const BUFFER_CAP = 200;

/* ---------------------------------- codec --------------------------------- */

/**
 * Decode an encoded `target` blob (any format the shared codec supports:
 * AES-256-GCM, session-XOR, legacy "quasar-v1" XOR) into a real URL, which
 * MUST be a ws:// or wss:// URL — the bridge never dials http(s). Returns
 * null for anything undecodable or non-ws.
 */
export function decodeTarget(blob: string): string | null {
  const raw = decodeBlobRaw(blob);
  if (!raw || !/^wss?:\/\//i.test(raw)) return null;
  return raw;
}

/* ------------------------------- raw targets ------------------------------ */

/**
 * Hostnames the bridge refuses to dial for RAW targets (loopback / private
 * ranges / link-local / mDNS-style suffixes). Raw targets arrive over the
 * operator's own gateway/TLS, so they are accepted verbatim once screened.
 */
const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?$)/i;
const LOCAL_SUFFIX_RE = /\.(local|internal|lan)$/i;

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_HOST_RE.test(hostname) || LOCAL_SUFFIX_RE.test(hostname);
}

/**
 * Accept the `target` query param in either form:
 *  - a raw ws://|wss:// URL (robustness for deployments where the key file
 *    differs between processes) — screened against loopback/private hosts;
 *  - an encoded blob via decodeTarget (shared multi-format codec).
 */
function resolveTarget(blob: string): string | null {
  if (/^wss?:\/\//i.test(blob)) {
    try {
      const u = new URL(blob);
      if (u.protocol !== "ws:" && u.protocol !== "wss:") return null;
      if (isPrivateHost(u.hostname)) return null;
      return blob;
    } catch {
      return null;
    }
  }
  return decodeTarget(blob);
}

/* --------------------------------- session -------------------------------- */

type WireMessage = string | ArrayBuffer | Uint8Array;

interface Session {
  /** Real outbound URL (ws:// or wss://) decoded from the query blob. */
  target: string;
  /** Browser's requested Sec-WebSocket-Protocol header (raw, may be comma list). */
  protocols: string | null;
  /** True once the client sent `__QUASAR_READY__`. */
  ready: boolean;
  /** True once the outbound socket is open. */
  targetOpen: boolean;
  /** Outbound WebSocket to the real server (ws package client). */
  targetWs: WS | null;
  /** Browser -> target messages held while the target is still connecting. */
  clientToTarget: WireMessage[];
  /** Target -> browser messages held until the client sends READY. */
  targetToClient: WireMessage[];
}

function newSession(target: string, protocols: string | null): Session {
  return {
    target,
    protocols,
    ready: false,
    targetOpen: false,
    targetWs: null,
    clientToTarget: [],
    targetToClient: [],
  };
}

/* --------------------------------- helpers -------------------------------- */

function log(...args: unknown[]): void {
  console.log("[ws-bridge]", ...args);
}

function logErr(...args: unknown[]): void {
  console.error("[ws-bridge]", ...args);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Origin (scheme + host) of a ws://|wss:// URL — https for wss, http for ws. */
function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol === "wss:" ? "https" : "http"}://${u.host}`;
  } catch {
    return null;
  }
}

/** Browser-grade handshake headers the target gateway would expect. */
const OUTBOUND_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * Clamp a close code to something legal to put on the wire.
 * 1004/1005/1006/1015 must never appear in a Close frame, and anything
 * outside 1000-4999 is invalid -> all become 1000 (normal closure).
 */
function clampCloseCode(code: unknown): number {
  const n = Math.floor(Number(code));
  if (!Number.isFinite(n)) return 1000;
  if (n === 1004 || n === 1005 || n === 1006 || n === 1015) return 1000;
  if (n >= 1000 && n <= 4999) return n;
  return 1000;
}

function tryCloseClient(ws: ServerWebSocket<Session>, code: number, reason?: string): void {
  try {
    ws.close(clampCloseCode(code), reason ?? "");
  } catch {
    try {
      ws.close(1000, "");
    } catch {
      /* already closed */
    }
  }
}

function sendToClient(ws: ServerWebSocket<Session>, data: WireMessage): boolean {
  try {
    ws.send(data as string | ArrayBufferLike);
    return true;
  } catch {
    return false;
  }
}

function sendToTarget(session: Session, data: WireMessage): boolean {
  const tw = session.targetWs;
  if (!tw || !session.targetOpen) return false;
  try {
    tw.send(data as string | ArrayBufferLike);
    return true;
  } catch {
    return false;
  }
}

/** Push `data` into a capped buffer. Returns false (and pushes nothing) on overflow. */
function bufferMessage(buf: WireMessage[], data: WireMessage): boolean {
  if (buf.length >= BUFFER_CAP) return false;
  buf.push(data);
  return true;
}

function flushClientToTarget(session: Session): void {
  const tw = session.targetWs;
  if (!tw || !session.targetOpen) return;
  while (session.clientToTarget.length > 0) {
    const msg = session.clientToTarget.shift()!;
    try {
      tw.send(msg as string | ArrayBufferLike);
    } catch {
      break;
    }
  }
}

function flushTargetToClient(ws: ServerWebSocket<Session>, session: Session): void {
  while (session.targetToClient.length > 0) {
    const msg = session.targetToClient.shift()!;
    if (!sendToClient(ws, msg)) break;
  }
}

/** Close the outbound target socket (used when the browser side goes away). */
function closeTarget(session: Session, reason: string): void {
  const tw = session.targetWs;
  if (!tw) return;
  try {
    tw.close(1000, reason);
  } catch {
    /* already closed / still connecting */
  }
  session.targetWs = null;
  session.targetOpen = false;
}

const websocket = {
  open(ws: ServerWebSocket<Session>): void {
    const session = ws.data;
    log(`client connected, dialing ${session.target}`);

    // IMMEDIATELY after upgrade: dial the real target server with faithful
    // handshake headers (Origin = the target's own origin, browser UA).
    let tw: WS;
    try {
      const origin = originOf(session.target);
      const protocols = session.protocols
        ? session.protocols.split(",").map((p) => p.trim()).filter(Boolean)
        : [];
      tw = new WS(session.target, protocols, {
        headers: {
          ...OUTBOUND_HEADERS,
          ...(origin ? { Origin: origin } : {}),
        },
        // Browsers never negotiate permessage-deflate — stay faithful.
        perMessageDeflate: false,
        handshakeTimeout: 15_000,
      });
    } catch (err) {
      logErr(`failed to create outbound socket for ${session.target}:`, err);
      tryCloseClient(ws, 1011, "bridge dial failed");
      return;
    }
    tw.binaryType = "arraybuffer";
    session.targetWs = tw;

    tw.on("open", () => {
      session.targetOpen = true;
      log(`-> ${hostOf(session.target)} (open)`);
      flushClientToTarget(session);
    });

    tw.on("message", (data: WS.RawData, isBinary: boolean) => {
      if (!session.ready) {
        // Client hasn't completed the READY handshake yet -> buffer.
        if (!bufferMessage(session.targetToClient, isBinary ? (data as ArrayBuffer) : (data as string))) {
          log(`targetToClient buffer overflow (${BUFFER_CAP}) -> closing client 1011`);
          tryCloseClient(ws, 1011, "bridge buffer overflow");
        }
        return;
      }
      if (isBinary && !(data instanceof ArrayBuffer)) {
        // Defensive: ws always honors binaryType, but never ship a Buffer[] on accident.
        const buf = data as Buffer;
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        if (!sendToClient(ws, ab)) {
          /* client backpressure — drop, as before */
        }
        return;
      }
      sendToClient(ws, data as string | ArrayBuffer);
    });

    tw.on("close", (code: number, reason: Buffer) => {
      const clamped = clampCloseCode(code);
      const reasonStr = reason?.toString() ?? "";
      log(`<- close ${clamped}${reasonStr ? ` (${reasonStr})` : ""}`);
      session.targetWs = null;
      session.targetOpen = false;
      tryCloseClient(ws, clamped, reasonStr || undefined);
    });

    tw.on("error", (err: Error) => {
      logErr(`-> ${hostOf(session.target)} (error: outbound connection failed: ${err?.message ?? "unknown"})`);
      session.targetOpen = false;
      tryCloseClient(ws, 1011, "target connection failed");
    });
  },

  message(ws: ServerWebSocket<Session>, message: string | Buffer): void {
    const session = ws.data;

    // Handshake: the FIRST message from a session must be exactly this string.
    if (!session.ready) {
      if (typeof message === "string" && message === READY_MAGIC) {
        session.ready = true;
        log(`client ready (target ${hostOf(session.target)})`);
        flushTargetToClient(ws, session);
      } else {
        log("dropped pre-handshake message (client must send __QUASAR_READY__ first)");
      }
      return;
    }

    // Data path: browser -> target.
    if (session.targetOpen) {
      sendToTarget(session, message);
    } else if (!bufferMessage(session.clientToTarget, message)) {
      log(`clientToTarget buffer overflow (${BUFFER_CAP}) -> closing client 1011`);
      tryCloseClient(ws, 1011, "bridge buffer overflow");
    }
  },

  close(ws: ServerWebSocket<Session>): void {
    const session = ws.data;
    log(`client disconnected (target was ${hostOf(session.target)})`);
    // Browser side went away -> tear down the outbound socket.
    closeTarget(session, "client gone");
  },

  error(ws: ServerWebSocket<Session>, err: Error): void {
    logErr("client socket error:", err?.message ?? err);
    closeTarget(ws.data, "client error");
  },
};

/* ---------------------------------- serve --------------------------------- */

Bun.serve({
  port: PORT,

  fetch(req, server): Response | undefined {
    const url = new URL(req.url);

    if (url.pathname === "/ws-bridge") {
      // `target` is either an encoded blob (multi-format codec) or a raw
      // ws://|wss:// URL; XTransformPort is only a gateway routing hint and
      // is intentionally ignored here.
      const blob = url.searchParams.get("target");
      if (!blob) {
        return new Response("bad request: missing target", { status: 400 });
      }
      const target = resolveTarget(blob);
      if (!target) {
        return new Response("bad request: invalid target", { status: 400 });
      }

      // Preserve the browser's requested subprotocol(s) for the outbound dial.
      const protoHeader = req.headers.get("sec-websocket-protocol");
      const protocols = protoHeader && protoHeader.trim() ? protoHeader.trim() : null;

      const session = newSession(target, protocols);
      let upgraded = false;
      try {
        upgraded = server.upgrade(req, { data: session });
      } catch (err) {
        logErr("upgrade threw:", err);
        upgraded = false;
      }
      if (!upgraded) {
        return new Response("bad request: websocket upgrade failed", { status: 400 });
      }
      return undefined; // 101 Switching Protocols already sent
    }

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    return new Response("not found", { status: 404 });
  },

  websocket,
});

log(`listening on http://localhost:${PORT} (bridge at /ws-bridge)`);
