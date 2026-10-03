/**
 * Quasar Service Worker
 * ---------------------
 * Registered with scope /p/ (allowed via the Service-Worker-Allowed header on
 * /api/sw). It controls every proxied page and acts as a safety net that the
 * injected hooks can't cover:
 *
 *   - Cross-origin subresource requests (dynamic imports, workers, media,
 *     anything built from raw strings the rewriter never saw) are intercepted
 *     and re-routed through /p/.
 *   - Same-origin requests that escaped onto app paths (root-relative URLs)
 *     are resolved against the real target URL derived from the referer.
 *   - Requests already shaped like /p/... pass through untouched.
 *
 * The codec source is prepended so the worker can encode/decode blobs itself.
 */

import { CODEC_SOURCE } from "./codec-server";
import { DIRECT_MEDIA_HOSTS } from "./site-fixes";

const SW_SOURCE = String.raw`
var C = self.__QUASAR_CODEC__;
var APP = self.location.origin;
var APP_PREFIX = APP + '/p/';

function isProxyable(u) { return u.protocol === 'http:' || u.protocol === 'https:'; }

/**
 * True when the request's referrer is itself a proxied page. The service
 * worker cannot decrypt AES blobs, so resolving escaped same-origin requests
 * is delegated to the server via the special "/p/!rel<rest>" path — the
 * server resolves the rest-path against the referer's real target.
 */
function refererIsProxied(request) {
  try {
    var r = request.referrer;
    if (!r) return null;
    var ru = new URL(r);
    if (ru.origin !== APP) return null;
    var m = ru.pathname.match(/^\/p\/[A-Za-z0-9_-]+(\/.*)?$/);
    return m ? ru.pathname : null;
  } catch (e) { return null;
  }
}

function toProxy(abs) {
  var u = new URL(abs);
  return APP + '/p/' + C.encodeOrigin(u.origin) + u.pathname + u.search;
}

var SW_HEADER_BLOCKLIST = {
  host: 1, connection: 1, 'content-length': 1, 'accept-encoding': 1,
  origin: 1, referer: 1, cookie: 1, 'x-quasar-target': 1
};

/* v2.0.4 direct-media hosts (server-configured, QUASAR_DIRECT_MEDIA_HOSTS):
   requests to these are NOT intercepted — the browser fetches them itself.
   Empty by default (googlevideo's SABR responses lack CORS headers, which
   starves MSE in direct mode; see site-fixes.ts). */
var QDIRECT_MEDIA = __QUASAR_DIRECT_MEDIA__;
function isDirectMediaHost(u) {
  try {
    var h = String(u.hostname || '').toLowerCase();
    for (var i = 0; i < QDIRECT_MEDIA.length; i++) {
      var s = QDIRECT_MEDIA[i];
      if (h === s || h.slice(-(s.length + 1)) === '.' + s) return true;
    }
  } catch (e) {}
  return false;
}

/* ---------- v1.3.8 adblock network counter ----------
   The server answers known ad/tracker URLs with 204 + x-quasar-blocked.
   Every blocked response seen here bumps a global counter that is posted
   to all controlled pages (the injected adblock layer relays it to the
   app chrome). Batched so a burst of blocks costs one message. */
var netBlocked = 0;
var netTimer = null;
function tallyBlocked(res) {
  try {
    if (res && res.headers && res.headers.get('x-quasar-blocked')) {
      netBlocked++;
      if (!netTimer) {
        netTimer = setTimeout(function () {
          netTimer = null;
          self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(function (cs) {
            for (var i = 0; i < cs.length; i++) {
              try { cs[i].postMessage({ __quasar: 'net-blocked', total: netBlocked }); } catch (e) {}
            }
          }).catch(function () {});
        }, 800);
      }
    }
  } catch (e) {}
}

function filteredHeaders(request) {
  var h = new Headers();
  var it = request.headers.entries();
  while (true) {
    var n = it.next();
    if (n.done) break;
    var name = n.value[0].toLowerCase();
    if (!SW_HEADER_BLOCKLIST[name]) h.set(n.value[0], n.value[1]);
  }
  // Preserve the original referer for the server, which restores it against
  // the real target (hotlink protection, CSRF referer checks). The server
  // strips this header again before forwarding.
  try {
    if (request.referrer && request.referrer !== 'about:client') {
      h.set('x-quasar-referer', request.referrer);
    }
  } catch (e) {}
  return h;
}

self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function (e) {
  var req = e.request;

  // Never intercept WebSocket handshakes — they must reach the network
  // (Caddy forwards /ws-bridge to the bridge mini-service).
  if (req.mode === 'websocket' || req.destination === 'websocket') return;

  var url = new URL(req.url);

  if (url.origin === APP) {
    if (url.pathname.indexOf('/p/') === 0) {
      // Actively re-issue proxied requests. Plain passthrough stalls requests
      // with ReadableStream bodies (YouTube's innertube client streams POSTs).
      e.respondWith((async function () {
        try {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            var buf = await req.arrayBuffer();
            var h = new Headers(req.headers);
            h.delete('content-length');
            h.delete('host');
            h.delete('connection');
            h.delete('accept-encoding');
            var res2 = await fetch(req.url, {
              method: req.method,
              headers: h,
              body: buf,
              credentials: 'include'
            });
            tallyBlocked(res2);
            return res2;
          }
          var res1 = await fetch(req);
          tallyBlocked(res1);
          return res1;
        } catch (err) {
          return new Response('', { status: 502 });
        }
      })());
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return; // let hooks handle others (already encoded)
    if (url.pathname.indexOf('/ws-bridge') === 0) return;      // WS bridge pass-through
    if (req.mode === 'navigate') return;                        // let the app handle navigation
    var real = refererIsProxied(req);
    if (/^\/api(\/|$)/.test(url.pathname)) return;            // Quasar's own APIs (cookie sync, …)
    if (/^\/(_next|quasar|download)(\/|$)/.test(url.pathname) && !real) return;
    if (!real) return;
    // Escaped same-origin request (root-relative URL built by the page).
    // "/p/!rel<rest>" + the preserved referer header lets the server resolve
    // it against the real target URL (the SW can't decrypt AES blobs).
    e.respondWith(fetch(APP + '/p/!rel' + url.pathname + url.search, {
      method: req.method,
      headers: filteredHeaders(req),
      redirect: 'follow'
    }).then(function (res) { tallyBlocked(res); return res; }).catch(function () { return new Response('', { status: 502 }); }));
    return;
  }

  if (!isProxyable(url)) return;

  // v2.0.4 direct-media hosts: do NOT tunnel — let the request fall through
  // to the network so the browser itself connects with its real Chrome TLS
  // fingerprint and the user's real IP. Empty by default (see site-fixes.ts).
  if (isDirectMediaHost(url)) return;

  // Cross-origin absolute request from a controlled page -> proxy it.
  e.respondWith(fetch(toProxy(url.href), {
    method: req.method,
    headers: filteredHeaders(req),
    redirect: 'follow'
  }).then(function (res) { tallyBlocked(res); return res; }).catch(function () { return new Response('', { status: 502 }); }));
});
`;

export const SW_SCRIPT =
  CODEC_SOURCE +
  "\nvar __QUASAR_DIRECT_MEDIA__ = " +
  JSON.stringify(DIRECT_MEDIA_HOSTS) +
  ";\n" +
  SW_SOURCE;
