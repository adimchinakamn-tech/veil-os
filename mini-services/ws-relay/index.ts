/**
 * veil ws-relay — WebSocket relay mini-service (fixed port 3003).
 *
 * Purpose: pages rendered inside the Veil app are served from the machine's
 * single exposed origin, so origin-relative WebSocket URLs cannot reach remote
 * ws:// / wss:// servers. This relay bridges the gap:
 *
 *   browser  ⇄  Caddy gateway (single exposed port)  ⇄  this service (3003)  ⇄  upstream ws(s):// server
 *
 * The gateway forwards any request carrying ?XTransformPort=3003 to this
 * service with the URL path always "/", so clients connect with:
 *
 *   new WebSocket("/?XTransformPort=3003&target=" + encodeURIComponent("wss://host/path"))
 *
 * Query parameters (path must be "/"):
 *   - target    (required)  URL-encoded absolute ws:// or wss:// URL.
 *   - protocols (optional)  comma-separated WebSocket subprotocols offered to
 *                           the upstream. When this query parameter is absent,
 *                           the client's Sec-WebSocket-Protocol header is used.
 *
 * SSRF protection (validation runs BEFORE the client upgrade is accepted):
 *   - scheme must be ws/wss; URLs with credentials (user:pass@) are rejected
 *   - host must not be localhost, *.localhost, *.local, *.internal
 *     (plus *.corp and *.home.arpa as extra hardening)
 *   - IP literals in private/reserved ranges are rejected — IPv4 and IPv6,
 *     including IPv4-mapped (::ffff:a.b.c.d) and NAT64-wrapped (64:ff9b::a.b.c.d)
 *   - DNS names are resolved with node:dns/promises lookup(hostname, {all:true})
 *     and rejected when ANY resolved address is private/reserved (covers DNS
 *     rebinding attempts pointing public names at internal IPs)
 *   - only ports 80 and 443 (explicit or default) are allowed
 */

import { lookup } from 'node:dns/promises';
import type { ServerWebSocket } from 'bun';

const PORT = 3003;
const MAX_PENDING_FRAMES = 256; // client frames buffered while the upstream handshake is in flight
const MAX_REASON_BYTES = 123; // RFC 6455: close reason ≤ 123 bytes of UTF-8
const HEARTBEAT_MS = 25_000; // keep both hops alive through NATs / idle timeouts

let connCounter = 0;

function log(msg: string): void {
  console.log(`[ws-relay] ${new Date().toISOString()} ${msg}`);
}

// ---------------------------------------------------------------------------
// IP classification (SSRF protection)
// ---------------------------------------------------------------------------

/** Parse a dotted-quad IPv4 literal into octets, or null. */
function parseIPv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return o;
}

/** True when the IPv4 address is private / reserved / non-routable. */
function isReservedIPv4(o: number[]): boolean {
  const [a, b, c] = o;
  if (a === 0) return true; // 0.0.0.0/8 — "this host" (incl. 0.0.0.0)
  if (a === 10) return true; // 10.0.0.0/8 — private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 — CGNAT shared
  if (a === 127) return true; // 127.0.0.0/8 — loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 — link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 — private
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24 — special use / TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 192.88.99.0/24 — 6to4 relay anycast
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 — private
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 — benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 — TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 — TEST-NET-3
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved (incl. 255.255.255.255)
  return false;
}

type IPv6 = { groups: number[]; embeddedIPv4: number[] | null };

/**
 * Parse an IPv6 literal (no brackets, no zone id) into 8 numeric groups.
 * Handles "::" compression and trailing dotted-quad notation (::ffff:127.0.0.1).
 */
function parseIPv6(host: string): IPv6 | null {
  if (host.includes('%')) return null; // zone ids (fe80::1%eth0) — treat as unusable/link-local
  let h = host;
  let embeddedIPv4: number[] | null = null;

  const lastColon = h.lastIndexOf(':');
  if (lastColon !== -1 && h.slice(lastColon + 1).includes('.')) {
    const v4 = parseIPv4(h.slice(lastColon + 1));
    if (!v4) return null;
    embeddedIPv4 = v4;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    h = h.slice(0, lastColon + 1) + hi + ':' + lo;
  }

  const parts = h.split('::');
  if (parts.length > 2) return null;

  const groups = (s: string): number[] | null => {
    if (s === '') return [];
    const out: number[] = [];
    for (const g of s.split(':')) {
      if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const left = groups(parts[0]);
  if (left === null) return null;
  if (parts.length === 1) {
    return left.length === 8 ? { groups: left, embeddedIPv4 } : null;
  }
  const right = groups(parts[1]);
  if (right === null) return null;
  const fill = 8 - left.length - right.length;
  if (fill < 0) return null;
  return { groups: [...left, ...new Array<number>(fill).fill(0), ...right], embeddedIPv4 };
}

/** True when the IPv6 address is private / reserved / non-routable. */
function isReservedIPv6(v6: IPv6): boolean {
  const g = v6.groups;
  const [a, b] = g;
  if (g.every((x) => x === 0)) return true; // :: — unspecified
  if (a === 0 && b === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0 && g[6] === 0 && g[7] === 1) {
    return true; // ::1 — loopback
  }
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 — unique local (fd00::/8)
  if ((a & 0xffc0) === 0xfe80) return true; // fe80::/10 — link-local
  if (a === 0x2001 && b === 0x0db8) return true; // 2001:db8::/32 — documentation

  // IPv4-mapped (::ffff:0:0/96) and NAT64 well-known prefix (64:ff9b::/96):
  // the address reaches the IPv4 internet, so judge it by the embedded IPv4.
  const mapped = a === 0 && b === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff;
  const nat64 = a === 0x64 && b === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0;
  if (mapped || nat64) {
    const v4 = v6.embeddedIPv4 ?? [(g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff, g[7] & 0xff];
    return isReservedIPv4(v4);
  }
  return false;
}

type LiteralStatus = 'public-literal' | 'reserved-literal' | 'not-literal';

/** Classify a hostname: public IP literal, reserved IP literal, or DNS name. */
function literalStatus(hostname: string): LiteralStatus {
  const v4 = parseIPv4(hostname);
  if (v4) return isReservedIPv4(v4) ? 'reserved-literal' : 'public-literal';
  const v6 = parseIPv6(hostname);
  if (v6) return isReservedIPv6(v6) ? 'reserved-literal' : 'public-literal';
  return 'not-literal';
}

/** Hostnames that are internal by convention regardless of DNS. */
function isBlockedHostname(h: string): boolean {
  if (h === 'localhost') return true;
  for (const suffix of ['localhost', 'local', 'internal', 'corp', 'home.arpa']) {
    if (h === suffix || h.endsWith('.' + suffix)) return true;
  }
  return false;
}

/**
 * Resolve a DNS hostname and return an error string when ANY resolved address
 * is private/reserved (or the name cannot be resolved at all).
 */
async function dnsCheck(hostname: string): Promise<string | null> {
  let records: { address: string; family: number }[];
  try {
    records = await lookup(hostname, { all: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code ?? 'unknown';
    return `cannot resolve target host "${hostname}" (${code})`;
  }
  if (records.length === 0) return `target host "${hostname}" resolves to no addresses`;
  for (const { address, family } of records) {
    if (family === 6) {
      const v6 = parseIPv6(address);
      if (!v6) return `unparseable IPv6 address for "${hostname}" (${address})`;
      if (isReservedIPv6(v6)) return `"${hostname}" resolves to a private/reserved address (${address})`;
    } else {
      const v4 = parseIPv4(address);
      if (!v4) return `unparseable IPv4 address for "${hostname}" (${address})`;
      if (isReservedIPv4(v4)) return `"${hostname}" resolves to a private/reserved address (${address})`;
    }
  }
  return null; // every address is public
}

// ---------------------------------------------------------------------------
// Target validation
// ---------------------------------------------------------------------------

type TargetVerdict = { ok: true; href: string } | { ok: false; status: number; error: string };

async function validateTarget(raw: string | null): Promise<TargetVerdict> {
  if (raw === null || raw.trim() === '') {
    return { ok: false, status: 400, error: 'missing required query parameter: target' };
  }
  const rawTarget = raw.trim();

  let url: URL;
  try {
    url = new URL(rawTarget);
  } catch {
    return { ok: false, status: 400, error: 'target is not a parseable absolute URL' };
  }

  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    return { ok: false, status: 400, error: `target scheme must be ws:// or wss:// (got "${url.protocol}")` };
  }

  // Credentials in the URL are never forwarded and always suspicious.
  if (url.username !== '' || url.password !== '' || /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(rawTarget)) {
    return { ok: false, status: 403, error: 'target must not contain credentials (user:pass@)' };
  }

  // Only the standard HTTP(S)/WS(S) ports are reachable through the gateway.
  if (url.port !== '' && url.port !== '80' && url.port !== '443') {
    return { ok: false, status: 403, error: `target port must be 80 or 443 (got ${url.port})` };
  }

  // URL.hostname keeps the brackets around IPv6 literals — strip them for parsing.
  const host = url.hostname.toLowerCase();
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const h = bare.endsWith('.') ? bare.slice(0, -1) : bare; // tolerate DNS root dot
  if (h === '') {
    return { ok: false, status: 400, error: 'target has an empty host' };
  }
  if (isBlockedHostname(h)) {
    return { ok: false, status: 403, error: `target hostname "${h}" is not allowed` };
  }

  const lit = literalStatus(h);
  if (lit === 'reserved-literal') {
    return { ok: false, status: 403, error: `target address ${h} is private/reserved` };
  }
  if (lit === 'not-literal') {
    const dnsError = await dnsCheck(h);
    if (dnsError) return { ok: false, status: 403, error: dnsError };
  }

  return { ok: true, href: url.href };
}

// ---------------------------------------------------------------------------
// Close code / reason hygiene (RFC 6455)
// ---------------------------------------------------------------------------

/** Map any close code onto one that is legal to put on the wire. */
function sanitizeCloseCode(code: number): number {
  if (code >= 1000 && code <= 1003) return code;
  if (code >= 1007 && code <= 1011) return code;
  if (code >= 3000 && code <= 4999) return code;
  if (code === 1006 || code === 1015 || !Number.isFinite(code)) return 1011; // abnormal / TLS failure
  return 1000;
}

/** Truncate a close reason to 123 bytes of valid UTF-8. */
function clampReason(reason: string): string {
  if (!reason) return '';
  const bytes = Buffer.from(reason, 'utf8');
  if (bytes.length <= MAX_REASON_BYTES) return reason;
  let cut = MAX_REASON_BYTES;
  while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut--; // don't split a UTF-8 sequence
  return bytes.subarray(0, cut).toString('utf8');
}

// ---------------------------------------------------------------------------
// Relay wiring
// ---------------------------------------------------------------------------

type UpstreamFrame = string | Uint8Array; // Buffer is a Uint8Array

type RelayState = {
  id: number;
  target: string;
  protocols: string[];
  upstream: WebSocket | null;
  pending: UpstreamFrame[]; // frames from the client buffered until the upstream opens
  clientGone: boolean;
  upstreamSettled: boolean;
  heartbeat: ReturnType<typeof setInterval> | null;
};

const OPEN = 1;
const CONNECTING = 0;

function stopHeartbeat(st: RelayState): void {
  if (st.heartbeat !== null) {
    clearInterval(st.heartbeat);
    st.heartbeat = null;
  }
}

/** Ping a socket if the runtime supports it (keeps NAT mappings / idle timers warm). */
function safePing(sock: { ping?: (data?: string | Buffer) => void }): void {
  try {
    sock.ping?.();
  } catch {
    /* best effort */
  }
}

function onClientOpen(ws: ServerWebSocket<RelayState>): void {
  const st = ws.data;
  let upstream: WebSocket;
  try {
    upstream = new WebSocket(st.target, st.protocols.length > 0 ? st.protocols : undefined);
  } catch (err) {
    // e.g. malformed subprotocol tokens — fail fast instead of stranding the client
    log(`#${st.id} upstream construction failed (${st.target}): ${(err as Error)?.message ?? err}`);
    st.upstreamSettled = true;
    try {
      ws.close(1011, 'invalid target or protocols');
    } catch {
      /* already closed */
    }
    return;
  }
  upstream.binaryType = 'arraybuffer';
  st.upstream = upstream;

  st.heartbeat = setInterval(() => {
    if (!st.clientGone) safePing(ws);
    if (upstream.readyState === OPEN) safePing(upstream);
  }, HEARTBEAT_MS);

  upstream.onopen = () => {
    if (st.clientGone) {
      try {
        upstream.close(1000, 'client disconnected');
      } catch {
        /* already gone */
      }
      return;
    }
    const queue = st.pending;
    st.pending = [];
    for (const frame of queue) {
      try {
        upstream.send(frame as string | ArrayBufferLike);
      } catch {
        /* drop */
      }
    }
  };

  upstream.onmessage = (ev: MessageEvent) => {
    if (st.clientGone) return;
    const data = ev.data;
    try {
      if (typeof data === 'string' || data instanceof ArrayBuffer) {
        ws.send(data); // text or binary frame — forward faithfully
      } else if (data instanceof Blob) {
        void data
          .arrayBuffer()
          .then((ab) => ws.send(ab))
          .catch(() => {});
      } else {
        ws.send(data as Uint8Array); // TypedArray / DataView — Bun accepts these directly
      }
    } catch {
      /* client vanished mid-send */
    }
  };

  upstream.onclose = (ev: CloseEvent) => {
    if (st.upstreamSettled) return;
    st.upstreamSettled = true;
    stopHeartbeat(st);
    try {
      ws.close(sanitizeCloseCode(ev.code), clampReason(ev.reason)); // propagate close code/reason
    } catch {
      /* already closed */
    }
    log(`#${st.id} upstream closed (${st.target}) code=${ev.code}`);
  };

  upstream.onerror = () => {
    if (st.upstreamSettled) return;
    st.upstreamSettled = true;
    stopHeartbeat(st);
    try {
      ws.close(1011, 'upstream connection failed');
    } catch {
      /* already closed */
    }
    log(`#${st.id} upstream error (${st.target})`);
  };

  log(`#${st.id} relay open -> ${st.target}`);
}

function onClientMessage(ws: ServerWebSocket<RelayState>, message: string | Buffer): void {
  const st = ws.data;
  const upstream = st.upstream;
  if (!upstream || st.clientGone || st.upstreamSettled) return;

  if (upstream.readyState === OPEN) {
    try {
      upstream.send(message as string | ArrayBufferLike);
    } catch {
      /* drop */
    }
  } else if (upstream.readyState === CONNECTING) {
    // Handshake still in flight — buffer and flush when the upstream opens.
    if (st.pending.length < MAX_PENDING_FRAMES) {
      st.pending.push(message as UpstreamFrame);
    } else {
      st.clientGone = true;
      st.pending = [];
      stopHeartbeat(st);
      try {
        upstream.close();
      } catch {
        /* already closing */
      }
      try {
        ws.close(1013, 'relay queue overflow');
      } catch {
        /* already closed */
      }
      log(`#${st.id} dropped: pending queue overflow`);
    }
  }
  // CLOSING / CLOSED upstream → drop the frame
}

function onClientClose(ws: ServerWebSocket<RelayState>, code: number, reason: string): void {
  const st = ws.data;
  st.clientGone = true;
  st.pending = [];
  stopHeartbeat(st);
  const upstream = st.upstream;
  if (upstream) {
    if (upstream.readyState === OPEN) {
      try {
        upstream.close(sanitizeCloseCode(code), clampReason(reason));
      } catch {
        /* already closed */
      }
    } else if (upstream.readyState === CONNECTING) {
      try {
        upstream.close(); // finishes handshake then closes; onopen also short-circuits via clientGone
      } catch {
        /* already closing */
      }
    }
  }
  log(`#${st.id} client closed <- ${st.target} code=${code}`);
}

// ---------------------------------------------------------------------------
// HTTP server + WebSocket upgrade
// ---------------------------------------------------------------------------

function text(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

Bun.serve<RelayState>({
  port: PORT,
  idleTimeout: 255, // seconds — max allowed; heartbeat keeps live connections open past it

  async fetch(req, srv) {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return text(200, 'ok');
    }

    if (url.pathname !== '/') {
      return text(404, 'not found');
    }

    const upgradeHeader = (req.headers.get('upgrade') ?? '').toLowerCase();
    if (upgradeHeader !== 'websocket') {
      return text(400, 'expected a websocket upgrade request on "/"');
    }

    const verdict = await validateTarget(url.searchParams.get('target'));
    if (!verdict.ok) {
      log(`rejected ${url.pathname}${url.search} -> ${verdict.status}: ${verdict.error}`);
      return text(verdict.status, verdict.error);
    }

    // Query param wins; otherwise forward the client's negotiated protocol list.
    const protocolsParam = url.searchParams.get('protocols');
    const protocolsSource =
      protocolsParam !== null ? protocolsParam : (req.headers.get('sec-websocket-protocol') ?? '');
    const protocols = protocolsSource
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const state: RelayState = {
      id: ++connCounter,
      target: verdict.href,
      protocols,
      upstream: null,
      pending: [],
      clientGone: false,
      upstreamSettled: false,
      heartbeat: null,
    };

    if (srv.upgrade(req, { data: state })) {
      return; // connection upgraded — further I/O happens through the websocket handlers
    }
    return text(400, 'websocket upgrade failed');
  },

  websocket: {
    open: onClientOpen,
    message: onClientMessage,
    close: onClientClose,
    drain() {
      /* backpressure: rely on Bun's internal buffering */
    },
  },
});

console.log(`veil ws-relay listening on ${PORT}`);
