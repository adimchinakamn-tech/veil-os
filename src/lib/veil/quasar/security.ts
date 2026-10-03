/**
 * Quasar Security Layer
 * ---------------------
 * Server-side hardening applied to every proxied request:
 *
 *   1. SSRF guard — target URLs must be http(s), must not carry credentials,
 *      must not point at loopback / private / link-local / metadata addresses
 *      (verified by resolving DNS, not just string checks). Bypass with
 *      QUASAR_ALLOW_PRIVATE=1 for LAN self-hosting.
 *   2. Rate limiting — per-client token bucket so the proxy can't be hammered
 *      into becoming a flood tool.
 *   3. Optional password gate — set QUASAR_PASSWORD to require a signed
 *      session cookie (POST /api/session) before proxy endpoints answer.
 */

import { lookup } from "node:dns/promises";
import { NextRequest } from "next/server";
import { authRequired, isAuthedRequest } from "./auth";

/* ------------------------------------------------------------------ */
/* SSRF guard                                                          */
/* ------------------------------------------------------------------ */

const ALLOW_PRIVATE = !!process.env.QUASAR_ALLOW_PRIVATE;

/** Reserved IPv4 ranges (start, end) as 32-bit ints — loopback, RFC1918, CGNAT, link-local, metadata. */
const V4_BLOCKED: [number, number][] = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8        "this network"
  [0x0a000000, 0x0affffff], // 10/8             private
  [0x64400000, 0x647fffff], // 100.64/10        CGNAT
  [0x7f000000, 0x7fffffff], // 127/8            loopback
  [0xa9fe0000, 0xa9feffff], // 169.254/16       link-local (incl. cloud metadata)
  [0xac100000, 0xac1fffff], // 172.16/12        private
  [0xc0000000, 0xc00000ff], // 192.0.0/24       IETF protocol assignments
  [0xc0000200, 0xc00003ff], // 192.0.2/24       TEST-NET-1
  [0xc0a80000, 0xc0a8ffff], // 192.168/16       private
  [0xc6120000, 0xc613ffff], // 198.18/15        benchmarking
  [0xc6336400, 0xc63364ff], // 198.51.100/24    TEST-NET-2
  [0xcb007100, 0xcb0071ff], // 203.0.113/24     TEST-NET-3
  [0xe0000000, 0xefffffff], // 224/4            multicast
  [0xf0000000, 0xffffffff], // 240/4 + broadcast
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable -> treat as blocked
  return V4_BLOCKED.some(([a, b]) => n >= a && n <= b);
}

function isBlockedIpv6(ip: string): boolean {
  const s = ip.toLowerCase().replace(/%.*$/, ""); // strip zone id
  if (s === "::" || s === "::1") return true;
  if (s.startsWith("fe8") || s.startsWith("fe9") || s.startsWith("fea") || s.startsWith("feb"))
    return true; // fe80::/10 link-local
  if (s.startsWith("fc") || s.startsWith("fd")) return true; // fc00::/7 ULA
  if (s.startsWith("ff")) return true; // multicast
  // IPv4-mapped / NAT64 forms (::ffff:10.0.0.1, ::ffff:a00:1, 64:ff9b::…)
  const mapped = s.match(/(?:^|:)(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?:%.*|$)/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}

function isBlockedIp(ip: string): boolean {
  return ip.includes(":") ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

/** Hostnames that must never be targeted even before DNS. */
const HOSTNAME_BLOCKLIST =
  /^(localhost[\.-]?[\w-]*|.*\.local(ed)?|.*\.localhost|.*\.internal|.*\.lan|.*\.corp|.*\.home|metadata\.google\.internal|metadata\.goog)$/i;

interface DnsVerdict {
  ok: boolean;
  reason?: string;
}
const dnsCache = new Map<string, { verdict: DnsVerdict; ts: number }>();
const DNS_TTL_MS = 60_000;
const DNS_CACHE_MAX = 1000;

/**
 * Throws when the target URL must not be fetched. DNS verdicts are cached for
 * 60s to keep page-load fan-out fast (a TOCTOU window remains; documented).
 *
 * `clientHostname` enables the bridge exemption: the WebSocket hook probes
 * the WS bridge on the OPERATOR'S OWN host (`<same-host>:3310/ws-bridge`) —
 * that request arrives relayed by the service worker and must not be
 * blocked by the private-host rules, while cross-host bridge scans stay
 * blocked.
 */
export async function assertSafeTarget(
  target: string | URL,
  clientHostname?: string
): Promise<void> {
  let u: URL;
  try {
    u = target instanceof URL ? target : new URL(target);
  } catch {
    throw new Error("invalid-target||The target URL could not be parsed.||" + String(target));
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(
      "blocked-scheme||Only http and https targets can be proxied.||" + u.protocol
    );
  }
  if (u.username || u.password) {
    throw new Error(
      "blocked-credentials||URLs with embedded credentials are not allowed.||" + u.host
    );
  }

  // Same-host bridge exemption (see docstring above).
  const barePath = u.pathname.replace(/\/+$/, "");
  if (
    clientHostname &&
    u.hostname === clientHostname &&
    u.port === "3310" &&
    barePath === "/ws-bridge"
  ) {
    return;
  }

  const host = u.hostname.toLowerCase();
  if (!ALLOW_PRIVATE && HOSTNAME_BLOCKLIST.test(host)) {
    throw new Error(
      "blocked-host||This host is on the proxy's blocklist (internal/loopback names).||" +
        host
    );
  }

  if (ALLOW_PRIVATE) return;

  // Literal IPs are checked without DNS.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    if (isBlockedIpv4(host)) {
      throw new Error(
        "blocked-private||Requests to private, loopback or metadata addresses are blocked.||" +
          host
      );
    }
    return;
  }
  if (host.includes(":")) {
    // bare IPv6 literal
    if (isBlockedIpv6(host)) {
      throw new Error(
        "blocked-private||Requests to private, loopback or metadata addresses are blocked.||" +
          host
      );
    }
    return;
  }

  const now = Date.now();
  const cached = dnsCache.get(host);
  if (cached && now - cached.ts < DNS_TTL_MS) {
    if (!cached.verdict.ok) {
      throw new Error(
        "blocked-private||" + (cached.verdict.reason || "Target host is not allowed.") + "||" + host
      );
    }
    return;
  }

  let verdict: DnsVerdict;
  try {
    const records = await lookup(host, { all: true, verbatim: true });
    if (!records.length) {
      verdict = { ok: false, reason: "DNS lookup returned no addresses." };
    } else {
      const bad = records.find((r) => isBlockedIp(r.address));
      verdict = bad
        ? {
            ok: false,
            reason: `Target resolves to a blocked (private/loopback) address (${bad.address}).`,
          }
        : { ok: true };
    }
  } catch (err) {
    verdict = {
      ok: false,
      reason:
        "DNS lookup failed — the domain may not exist or is unreachable. (" +
        (err instanceof Error ? err.message : String(err)) +
        ")",
    };
  }
  if (dnsCache.size > DNS_CACHE_MAX) dnsCache.clear();
  dnsCache.set(host, { verdict, ts: now });

  if (!verdict.ok) {
    throw new Error(
      (host.startsWith("127.") ? "blocked-private" : "dns-failure") +
        "||" +
        (verdict.reason || "Target host is not allowed.") +
        "||" +
        host
    );
  }
}

/* ------------------------------------------------------------------ */
/* Rate limiting                                                       */
/* ------------------------------------------------------------------ */

const BURST = 400; // bucket size — a heavy page load fires ~150-250 requests
const REFILL_PER_SEC = 25; // sustained rate

const buckets = new Map<string, { tokens: number; ts: number }>();
let lastPrune = 0;

function pruneBuckets(now: number): void {
  if (now - lastPrune < 60_000 && buckets.size < 5000) return;
  lastPrune = now;
  for (const [k, b] of buckets) {
    if (now - b.ts > 120_000) buckets.delete(k);
  }
}

/** True when the request is allowed under the per-client token bucket. */
export function allowRequest(clientKey: string): boolean {
  const now = Date.now();
  pruneBuckets(now);
  const b = buckets.get(clientKey);
  if (!b) {
    buckets.set(clientKey, { tokens: BURST - 1, ts: now });
    return true;
  }
  const elapsedSec = (now - b.ts) / 1000;
  b.tokens = Math.min(BURST, b.tokens + elapsedSec * REFILL_PER_SEC);
  b.ts = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

/** Best-effort client identity for rate limiting. */
export function clientKeyOf(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "local";
}

/* ------------------------------------------------------------------ */
/* Optional password gate                                              */
/* ------------------------------------------------------------------ */

export { authRequired, isAuthedRequest, checkPassword, SESSION_COOKIE } from "./auth";

/**
 * Returns a 401 Response when the password gate is active and the request is
 * not authenticated; null when the request may proceed.
 */
export function gate(req: NextRequest, isNavigation: boolean): Response | null {
  if (!authRequired()) return null;
  if (isAuthedRequest(req)) return null;
  if (isNavigation) {
    const html = gateHtml();
    return new Response(html, {
      status: 401,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return Response.json({ error: "auth-required" }, { status: 401 });
}

function gateHtml(): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Locked — Quasar</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background:#09090b; color:#e4e4e7; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { width:100%; max-width:400px; background:rgba(24,24,27,.85); border:1px solid #27272a; border-radius:16px; padding:36px 32px; text-align:center; }
  .orb { width:52px; height:52px; margin:0 auto 18px; border-radius:50%;
    background:conic-gradient(from 120deg,#7c3aed,#d946ef,#f59e0b,#7c3aed); animation:spin 6s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  h1 { font-size:18px; font-weight:700; }
  p { margin-top:8px; font-size:13px; color:#a1a1aa; }
  input { margin-top:18px; width:100%; padding:11px 14px; border-radius:10px; border:1px solid #3f3f46;
    background:#131316; color:#e4e4e7; font:inherit; font-size:14px; }
  input:focus { outline:none; border-color:#7c3aed; }
  button { margin-top:12px; width:100%; cursor:pointer; font:inherit; font-size:14px; font-weight:600;
    padding:11px 20px; border-radius:10px; border:none; background:linear-gradient(135deg,#7c3aed,#a855f7); color:#fff; }
  button:hover { filter:brightness(1.1); }
  .err { margin-top:10px; font-size:12px; color:#f87171; min-height:16px; }
</style></head><body>
<main class="card">
  <div class="orb" aria-hidden="true"></div>
  <h1>This proxy is locked</h1>
  <p>Enter the access password to continue.</p>
  <form onsubmit="return (function(f){
    var b=f.querySelector('button'); var e=f.parentElement.querySelector('.err');
    b.disabled=true; e.textContent='';
    fetch('/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:f.pw.value})})
      .then(function(r){ if(r.ok){ location.reload(); } else { e.textContent='Wrong password.'; b.disabled=false; } })
      .catch(function(){ e.textContent='Network error.'; b.disabled=false; });
    return false; })(this)">
    <input type="password" name="pw" placeholder="Password" autofocus autocomplete="current-password">
    <button type="submit">Unlock</button>
    <div class="err"></div>
  </form>
</main>
</body></html>`;
}
