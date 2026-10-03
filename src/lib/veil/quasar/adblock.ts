/**
 * Quasar Adblocker (v1.3.8)
 * -------------------------
 * Two blocking layers + a popup/popunder killer:
 *
 *   1. NETWORK layer (server-side, `isAdUrl`) — the /p/ route answers known
 *      ad & tracker URLs with an empty 204 + `x-quasar-blocked: ad` before
 *      any upstream connection is made. This kills ad scripts, tracking
 *      beacons, ad iframes and analytics pixels for every site, even ones
 *      whose DOM we never see.
 *   2. DOM layer (client-side, `ADBLOCK_SOURCE`) — an injected bundle that
 *      removes ad elements that already made it into the page (self-hosted
 *      ad slots, taboola/outbrain widgets, anti-adblock scripts), hides
 *      known ad containers via CSS, blocks `window.open` popunders and
 *      keeps `target=_blank` links inside the tunnel. It reports blocked
 *      counts to the browser chrome via postMessage.
 *
 * The lists use exact-host-suffix matching for hostnames (no substring
 * false positives like "media.net" matching "media.netflix.com") and
 * literal path tokens for URL patterns.
 */

/* ------------------------------------------------------------------ */
/* Ad / tracker host list (suffix match, lowercase)                    */
/* ------------------------------------------------------------------ */

export const AD_HOSTS: string[] = [
  // Google ads + tracking
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "googletagservices.com",
  "google-analytics.com",
  "googletagmanager.com",
  "analytics.google.com",
  "adservice.google.com",
  "adsystem.google.com",
  "2mdn.net",
  "ads.yimg.com",
  // Exchanges / SSPs / DSPs
  "adnxs.com",
  "pubmatic.com",
  "rubiconproject.com",
  "openx.net",
  "casalemedia.com",
  "smartadserver.com",
  "adform.net",
  "yieldlab.net",
  "indexww.com",
  "adsrvr.org",
  "sharethrough.com",
  "teads.tv",
  "yieldmo.com",
  "33across.com",
  "adsafeprotected.com",
  "doubleverify.com",
  "moatads.com",
  "improvedigital.com",
  "gumgum.com",
  "1rx.io",
  "sovrn.com",
  "lijit.com",
  "media.net",
  "bidr.io",
  "criteo.com",
  "criteo.net",
  "criteo.biz",
  "outbrain.com",
  "taboola.com",
  "taboolasyndication.com",
  "amazon-adsystem.com",
  "adroll.com",
  "mgid.com",
  // Pop / push networks
  "popads.net",
  "popcash.net",
  "popmyads.com",
  "propellerads.com",
  "propellerclick.com",
  "adsterra.com",
  "hilltopads.net",
  "hilltopads.com",
  "exoclick.com",
  "exosrv.com",
  "clicksor.com",
  "zeropark.com",
  "trafficjunky.net",
  "trafficfactory.biz",
  // Session-replay & behavior trackers
  "hotjar.com",
  "hotjar.io",
  "clarity.ms",
  "mixpanel.com",
  "segment.io",
  "segment.com",
  "amplitude.com",
  "fullstory.com",
  "mouseflow.com",
  "luckyorange.com",
  "crazyegg.com",
  "inspectlet.com",
  "mc.yandex.ru",
  "an.yandex.ru",
  "cloudflareinsights.com",
  // Social pixels
  "connect.facebook.net",
  "ads-twitter.com",
  "analytics.twitter.com",
  "ads.linkedin.com",
  "snap.licdn.com",
  "bat.bing.com",
  "ads.linkedin.com",
];

/** Literal tokens matched against pathname+query (lowercased). */
export const AD_PATHS: string[] = [
  "/pagead/",
  "/ptracking",
  "/adserver.",
  "/adframe.",
  "/googleads",
  "/popunder",
  "popunder",
  "get_midroll",
  "/ads.js",
  "/api/stats/ads",
  "/bannerad",
  "blockadblock",
  "detectadblock",
  "/doubleclick",
];

/**
 * CSS selector list for known ad containers — hidden immediately and
 * removed by the client sweeper. Kept specific to avoid nuking legit
 * content ("ad-" alone would match "read-only", "gradient", …).
 */
export const AD_CSS = [
  "ins.adsbygoogle",
  '[id^="google_ads"]',
  '[id^="div-gpt-ad"]',
  '[id^="aswift"]',
  'iframe[src*="doubleclick"]',
  'iframe[src*="googlesyndication"]',
  'iframe[src*="googleadservices"]',
  'iframe[src*="amazon-adsystem"]',
  '[class*="taboola"]',
  '[class*="OUTBRAIN"]',
  '[class*="outbrain"]',
  '[class*="AdSlot"]',
  '[class*="ad-slot"]',
  '[class*="ad-banner"]',
  '[class*="ad-container"]',
  '[class*="ad-wrapper"]',
  '[class*="advert-"]',
  '[class*="-advert"]',
  '[class*="popunder"]',
  '[id*="popunder"]',
  '[data-ad-slot]',
  '[data-ad-client]',
  'a[href*="doubleclick.net"]',
  '[aria-label="advertisement" i]',
  '[aria-label="Advertisement" i]',
  '[id*="sponsored-slot"]',
].join(",");

/* ------------------------------------------------------------------ */
/* Server-side network filter                                          */
/* ------------------------------------------------------------------ */

/** True when a URL is a known ad / tracker endpoint (empty 204 in the route). */
export function isAdUrl(target: string | URL): boolean {
  let u: URL;
  try {
    u = target instanceof URL ? target : new URL(target);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  for (const t of AD_HOSTS) {
    if (host === t || host.endsWith("." + t)) return true;
  }
  const pq = (u.pathname + u.search).toLowerCase();
  for (const t of AD_PATHS) {
    if (pq.includes(t)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Client bundle source                                                */
/* ------------------------------------------------------------------ */

/**
 * The DOM-layer bundle injected ahead of the hook engine on every proxied
 * page. Plain ES5-ish code (no backticks) so it can be embedded in HTML.
 * VEIL INTEGRATION: the popup blocker (window.open override) and the
 * target=_blank click interceptor are intentionally NOT installed here —
 * the hook engine owns both and opens popups as VEIL TABS via the shell's
 * open-tab bridge. This layer keeps: the ad element sweeper,
 * MutationObserver removal, ad-container CSS, the blocked-counters
 * reported to the app chrome, the isAd() matcher the engine consults
 * before opening popup tabs, and relaying service-worker network-block
 * totals up to the parent.
 */
export const ADBLOCK_SOURCE = `(function () {
'use strict';
if (window.__QUASAR_ADBLOCK__) return;
window.__QUASAR_ADBLOCK__ = true;
var APP = location.origin;
var C = window.__QUASAR_CODEC__;
var AD_HOSTS = ${JSON.stringify(AD_HOSTS)};
var AD_PATHS = ${JSON.stringify(AD_PATHS)};
var AD_CSS = ${JSON.stringify(AD_CSS)};

/* ---------- counters + parent sync ---------- */
var stats = { ads: 0, popups: 0 };
var postTimer = null;
function postStats() {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ __quasar: 'adblock', ads: stats.ads, popups: stats.popups }, APP);
    }
  } catch (e) {}
}
function count(kind) {
  stats[kind]++;
  if (!postTimer) {
    postTimer = setTimeout(function () { postTimer = null; postStats(); }, 400);
  }
}
/* Engine-facing API: the hook engine (loaded after this layer) calls isAd()
 * before opening a window.open popup / target=_blank link as a Veil tab —
 * ad targets are counted + dropped, everything else opens in Veil. */
window.__QUASAR_ADBLOCK__ = { stats: stats, count: count, isAd: isAdUrl };

/* ---------- relay service-worker network-block totals ---------- */
try {
  window.addEventListener('message', function (e) {
    try {
      var d = e.data;
      if (!d || d.__quasar !== 'net-blocked' || e.source === window.parent) return;
      d.relayed = true;
      window.parent.postMessage(d, APP);
    } catch (err) {}
  }, false);
} catch (e) {}

/* ---------- URL matching ---------- */
function isAdUrl(u) {
  try {
    var p = new URL(u, location.href);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return false;
    var h = p.hostname.toLowerCase();
    for (var i = 0; i < AD_HOSTS.length; i++) {
      var t = AD_HOSTS[i];
      if (h === t || h.slice(-(t.length + 1)) === '.' + t) return true;
    }
    var pq = (p.pathname + p.search).toLowerCase();
    for (var j = 0; j < AD_PATHS.length; j++) {
      if (pq.indexOf(AD_PATHS[j]) !== -1) return true;
    }
    return false;
  } catch (e) { return false; }
}

/* Minimal resolver (runs before the hook engine; same URL mapping). */
function res(u) {
  try {
    var s = String(u == null ? '' : u);
    if (!s || s.charAt(0) === '#') return s;
    if (/^(data|blob|javascript|mailto|tel|about|sms|magnet|irc|file):/i.test(s)) return s;
    var abs = new URL(s, location.href);
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return abs.href;
    if (abs.origin === APP) return abs.href;
    var o = (window.__QUASAR_DATA__ && window.__QUASAR_DATA__.o) || null;
    if (!o || !C) return abs.href;
    return APP + '/p/' + C.encodeOrigin(abs.origin) + abs.pathname + abs.search + (abs.hash || '');
  } catch (e) { return u; }
}

/* ---------- popup policy (Veil) ---------- */
/* v1.3.8 stock blocks window.open + target=_blank here. In Veil the HOOK
 * ENGINE owns both surfaces: window.open and _blank links open as fresh
 * VEIL TABS through the shell's open-tab bridge (the user's requirement:
 * popups never escape to the host browser), and the engine consults
 * isAd() above so AD popups are still counted + dropped. Installing a
 * blocker here would fight the engine for the same globals. */

/* ---------- DOM ad sweeper ---------- */
function ensureStyle() {
  try {
    if (document.querySelector('style[data-quasar="adblock"]')) return;
    var s = document.createElement('style');
    s.setAttribute('data-quasar', 'adblock');
    s.textContent = AD_CSS + '{display:none !important;visibility:hidden !important;}';
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {}
}

function elSrc(el) {
  try {
    return el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('data') || '';
  } catch (e) { return ''; }
}

function killEl(el) {
  try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e) {}
}

function sweepNode(node) {
  try {
    if (!node || node.nodeType !== 1) return;
    var tag = (node.tagName || '').toLowerCase();
    if (tag === 'script' || tag === 'iframe' || tag === 'img' || tag === 'embed' ||
        tag === 'object' || tag === 'source' || tag === 'link' || tag === 'ins') {
      var s = elSrc(node);
      if (s && isAdUrl(s)) { count('ads'); killEl(node); return; }
    }
    var m = false;
    try { m = node.matches ? node.matches(AD_CSS) : false; } catch (e0) {}
    if (m) { count('ads'); killEl(node); }
  } catch (e) {}
}

function sweepDeep(root) {
  try {
    if (!root || !root.querySelectorAll) return;
    var ads = root.querySelectorAll(AD_CSS);
    for (var i = 0; i < ads.length; i++) { stats.ads++; killEl(ads[i]); }
    var tagged = root.querySelectorAll('script[src],iframe[src],img[src],embed[src],object[data],ins[src],link[href]');
    for (var j = 0; j < tagged.length; j++) {
      var s = elSrc(tagged[j]);
      if (s && isAdUrl(s)) { stats.ads++; killEl(tagged[j]); }
    }
    if (ads.length + tagged.length > 0) postStats();
  } catch (e) {}
}

function boot() {
  try { ensureStyle(); } catch (e) {}
  try { sweepDeep(document.body || document.documentElement); } catch (e) {}
}

try {
  var mo = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (!n || n.nodeType !== 1) continue;
        sweepNode(n);
        try {
          if (n.querySelectorAll) {
            var inner = n.querySelectorAll(AD_CSS + ',script[src],iframe[src],img[src]');
            for (var k = 0; k < inner.length; k++) sweepNode(inner[k]);
          }
        } catch (e) {}
      }
    }
  });
  if (document.documentElement) {
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    }, { once: true });
  }
} catch (e) {}

/* Periodic sweep: catches late-loaded ad shells the observer batches miss. */
setInterval(function () { try { sweepDeep(document.body || document.documentElement); } catch (e) {} }, 10000);

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
`;
