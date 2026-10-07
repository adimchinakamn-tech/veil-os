/**
 * Quasar URL Codec
 * ----------------
 * Encodes the ORIGIN (scheme://host[:port]) of a target URL into an
 * XOR-obfuscated base64url blob. The original path/query stay readable in the
 * proxied URL, so relative URL resolution inside proxied pages "just works":
 *
 *   https://en.wikipedia.org/wiki/Main_Page
 *     => /p/<blob>/wiki/Main_Page
 *
 * v2.1.0 — blobs may additionally carry a per-tab context suffix (appended to
 * the encrypted plaintext after a '~'): container id (multi-account cookie/
 * storage isolation), egress mode and a User-Agent override. The suffix is
 * opaque to whoever holds the blob — it is validated server-side on decode.
 *
 * Isomorphic: uses btoa/atob + TextEncoder so the exact same logic runs on
 * the server (route handlers), in injected page hooks, in the service worker,
 * and in the mini-service WebSocket bridge.
 */

export const CODEC_SECRET = "quasar-v1";

/**
 * Build the isomorphic client codec source for a given XOR secret.
 * The secret arrives BASE64-ENCODED and is embedded safely (no raw bytes in
 * JS source) and decoded via atob; key bytes are derived char-by-char so
 * they match the server's latin1 byte-for-byte derivation even for binary
 * secrets. The production secret comes from codec-server.ts (per-deployment
 * random, stored in .quasar-key); "quasar-v1" stays the legacy default.
 */
export function buildCodecSource(secretB64: string, prefixed = false): string {
  return `(function(g){
  var SECRET = atob(${JSON.stringify(secretB64)});
  var PREFIX = ${prefixed ? 2 : 0};
  function keyBytes(){
    var k = new Uint8Array(SECRET.length);
    for (var i = 0; i < k.length; i++) k[i] = SECRET.charCodeAt(i) & 0xff;
    return k;
  }
  function xorBytes(bytes){
    var key = keyBytes();
    var out = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ key[i % key.length];
    return out;
  }
  function b64urlEncode(bytes){
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str){
    str = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4 !== 0) str += '=';
    var bin = atob(str);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function encodeOrigin(origin, ctx){
    var s = String(origin);
    if (ctx) s += '~' + String(ctx);
    var x = xorBytes(new TextEncoder().encode(s));
    if (PREFIX) {
      var withPrefix = new Uint8Array(x.length + 1);
      withPrefix[0] = PREFIX;
      withPrefix.set(x, 1);
      x = withPrefix;
    }
    return b64urlEncode(x);
  }
  function decodeOrigin(blob){
    try {
      var bytes = b64urlDecode(blob);
      if (PREFIX && bytes.length > 1 && bytes[0] === PREFIX) {
        bytes = bytes.subarray(1);
      }
      return new TextDecoder().decode(xorBytes(bytes));
    } catch (e) { return null; }
  }
  g.__QUASAR_CODEC__ = { encodeOrigin: encodeOrigin, decodeOrigin: decodeOrigin };
})(typeof self !== 'undefined' ? self : globalThis);`;
}

/** Legacy bundle source (hardcoded secret) — kept for compatibility. */
export const CODEC_SOURCE = buildCodecSource(btoa(CODEC_SECRET));

function xorBytes(bytes: Uint8Array): Uint8Array {
  const key = new TextEncoder().encode(CODEC_SECRET);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ key[i % key.length];
  return out;
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string): Uint8Array {
  let t = String(str).replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4 !== 0) t += "=";
  const bin = atob(t);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function encodeOrigin(origin: string, ctx?: string): string {
  const s = String(origin) + (ctx ? "~" + ctx : "");
  return b64urlEncode(xorBytes(new TextEncoder().encode(s)));
}

/**
 * Decode a legacy-format blob (origin only, no context suffix). Returns null
 * when the blob is invalid.
 */
export function decodeOrigin(blob: string): string | null {
  try {
    const s = new TextDecoder().decode(xorBytes(b64urlDecode(blob)));
    const origin = s.split("~")[0] ?? s;
    return /^https?:\/\//.test(origin) ? origin : null;
  } catch {
    return null;
  }
}

const BLOB_RE = /^[A-Za-z0-9_-]+$/;

/** Convert any absolute http(s) URL into its proxied path (`/p/<blob>/...`). */
export function proxyPath(url: string | URL): string {
  const u = url instanceof URL ? url : new URL(url);
  return "/p/" + encodeOrigin(u.origin) + u.pathname + u.search + u.hash;
}

/**
 * Parse a raw proxied pathname (percent-encoding preserved) plus optional
 * search string into the real target parts.
 */
export function parseProxiedPath(
  pathname: string,
  search = ""
): { origin: string; rest: string; target: string } | null {
  const m = pathname.match(/^\/p\/([A-Za-z0-9_-]+)(\/[^?]*)?$/);
  if (!m) return null;
  if (!BLOB_RE.test(m[1])) return null;
  const origin = decodeOrigin(m[1]);
  if (!origin) return null;
  const rest = m[2] ?? "/";
  return { origin, rest, target: origin + rest + (search || "") };
}

/** Decode a proxied href back into the real URL (used client-side & server-side). */
export function decodeProxiedHref(href: string): string | null {
  try {
    const u = new URL(href);
    const parsed = parseProxiedPath(u.pathname, u.search);
    if (!parsed) return null;
    return parsed.origin + parsed.rest + u.search + u.hash;
  } catch {
    return null;
  }
}

/** True when the string looks like a URL rather than a search query. */
export function looksLikeUrl(input: string): boolean {
  const s = input.trim();
  if (!s || /\s/.test(s)) return false;
  if (/^https?:\/\//i.test(s)) return true;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(s)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(s)) return true;
  if (/^\[[0-9a-f:]+\](:\d+)?(\/.*)?$/i.test(s)) return true; // IPv6 literal
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(s);
}

/**
 * Tracking parameters stripped from address-bar navigations only (never from
 * in-page links — that would break sites that require their own params).
 * Conservative list: pure analytics identifiers, nothing functional.
 */
const TRACKING_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "utm_id", "utm_campaign_id", "utm_reader", "utm_social", "utm_name",
  "fbclid", "gclid", "gbraid", "wbraid", "dclid", "msclkid", "twclid",
  "mc_cid", "mc_eid", "igshid", "igsh", "si", "ref_src", "ref_url",
  "_hsenc", "_hsmi", "yclid", "vrclid", "ttclid", "s_kwcid", "elqTrackId",
];

/** Remove known tracking params from a URL (returns the input untouched on parse errors). */
export function stripTrackingParams(url: string): string {
  try {
    const u = new URL(url);
    let changed = false;
    for (const p of TRACKING_PARAMS) {
      if (u.searchParams.has(p)) {
        u.searchParams.delete(p);
        changed = true;
      }
    }
    return changed ? u.toString() : url;
  } catch {
    return url;
  }
}

export const SEARCH_ENGINES: Record<string, string> = {
  brave: "https://search.brave.com/search?q=",
  duckduckgo: "https://lite.duckduckgo.com/lite/?q=",
  google: "https://www.google.com/search?q=",
  bing: "https://www.bing.com/search?q=",
  startpage: "https://www.startpage.com/sp/search?query=",
  wikipedia: "https://en.wikipedia.org/w/index.php?search=",
};
