/**
 * Quasar Client Hooks (v2.0.4, Veil integration)
 * ------------------------------------------------
 * A bundle injected as the first <script> of every proxied HTML page.
 * It installs runtime shims so that dynamic JavaScript inside proxied pages
 * keeps hitting the proxy:
 *
 *   - fetch / XMLHttpRequest / sendBeacon / EventSource
 *   - WebSocket (routed through the ws-bridge mini-service)
 *   - Element.setAttribute + src/href/action/srcset property setters
 *   - History API (pushState / replaceState)
 *   - window.open → NEW VEIL TABS (never escapes to the host browser)
 *   - MutationObserver URL safety net for late-inserted DOM
 *   - document.cookie (in-memory shim synced to the server cookie jar)
 *   - v2.0.4: per-origin storage partitioning, virtual location layer
 *     (virtLoc sites), postMessage origin unwrap (pmOrigins), stealth marks
 *   - Service worker isolation (target sites cannot register their own SW)
 *   - Navigation API interception (Chromium) for same-origin escape hatches
 *
 * VEIL BRIDGES (kept from the previous integration — the shell depends on
 * them): __veil nav/title/mouse/esc/open-tab postMessages drive tab titles,
 * history rows, the control-bar reveal, Escape handling and popup tabs.
 *
 * The bundle is plain ES5-ish code: no backticks, no template interpolation,
 * so it can be safely embedded as a string inside HTML.
 */

import { CODEC_SOURCE } from "./codec-server";
import { QUASAR_VERSION } from "./version";
import { ADBLOCK_SOURCE } from "./adblock";
import { STEALTH_SOURCE } from "./stealth";
import { DIRECT_MEDIA_HOSTS } from "./site-fixes";
import type { SiteFix } from "./site-fixes";

const HOOK_SOURCE = String.raw`
(function () {
'use strict';
if (window.__QUASAR_HOOKS__) return;
window.__QUASAR_HOOKS__ = true;
var C = window.__QUASAR_CODEC__;
var APP = location.origin;
var APP_PREFIX = APP + '/p/';
var BRIDGE_PORT = 3310;

/* Native-look helper: swaps a wrapper into place with native name/length
   descriptors and registers it with the stealth layer so that
   wrapper.toString() reports "function <key>() { [native code] }". */
function nativeLike(obj, key, wrapper, len) {
  var st = window.__QUASAR_STEALTH__;
  try {
    Object.defineProperty(obj, key, {
      value: wrapper, writable: true, enumerable: true, configurable: true
    });
  } catch (e) { try { obj[key] = wrapper; } catch (e2) {} }
  try { Object.defineProperty(wrapper, 'name', { value: key, configurable: true }); } catch (e) {}
  try { if (len != null) Object.defineProperty(wrapper, 'length', { value: len, configurable: true }); } catch (e) {}
  try { if (st && st.mark) st.mark(wrapper, 'function ' + key + '() { [native code] }'); } catch (e) {}
  return wrapper;
}

/* Page context injected by the server. Clients cannot decrypt AES blobs, so
   the real target origin of THIS document is handed over here instead. */
var PAGE_DATA = window.__QUASAR_DATA__ || {};

function isProxyable(u) { return u.protocol === 'http:' || u.protocol === 'https:'; }

/* v2.0.4 direct-media hosts (server-configured via QUASAR_DIRECT_MEDIA_HOSTS,
   handed over in PAGE_DATA.dm): the browser fetches these itself instead of
   the proxy. Empty by default — googlevideo's SABR responses lack CORS
   headers, so proxied streaming stays the working default. */
var DIRECT_MEDIA_HOSTS = (PAGE_DATA && PAGE_DATA.dm) || [];
function isDirectHost(u) {
  try {
    var h = String(u.hostname || '').toLowerCase();
    for (var i = 0; i < DIRECT_MEDIA_HOSTS.length; i++) {
      var s = DIRECT_MEDIA_HOSTS[i];
      if (h === s || h.slice(-(s.length + 1)) === '.' + s) return true;
    }
  } catch (e) {}
  return false;
}

/* Sticky target origin: captured once at document start so URL mapping keeps
   working even if a SPA degrades the visible path away from /p/<blob>/... . */
var TARGET_ORIGIN = null;
try {
  if (PAGE_DATA.o) {
    TARGET_ORIGIN = PAGE_DATA.o;
  } else {
    var initBlob = (location.pathname.match(/^\/p\/([A-Za-z0-9_-]+)/) || [])[1];
    if (initBlob) TARGET_ORIGIN = C.decodeOrigin(initBlob);
  }
} catch (e) { TARGET_ORIGIN = TARGET_ORIGIN || null; }

function currentTargetOrigin() {
  try {
    if (PAGE_DATA.o) return PAGE_DATA.o;
    var m = location.pathname.match(/^\/p\/([A-Za-z0-9_-]+)/);
    if (m) {
      var o = C.decodeOrigin(m[1]);
      if (o) return o;
    }
  } catch (e) {}
  return TARGET_ORIGIN;
}

function currentRealHref() {
  try {
    var m = location.pathname.match(/^\/p\/([A-Za-z0-9_-]+)(\/.*)?$/);
    if (m) {
      var origin = PAGE_DATA.o || C.decodeOrigin(m[1]);
      if (origin) return origin + (m[2] || '/') + location.search;
    }
  } catch (e) {}
  return TARGET_ORIGIN ? TARGET_ORIGIN + '/' : null;
}

function toProxy(absURL) {
  try {
    var u = new URL(absURL);
    if (!isProxyable(u)) return absURL;
    if (isDirectHost(u)) return absURL;
    if (u.origin === APP) {
      if (u.pathname.indexOf('/p/') === 0) return u.href;
      var ro = currentTargetOrigin();
      if (ro) {
        return APP + '/p/' + C.encodeOrigin(ro) + u.pathname + u.search;
      }
      return u.href;
    }
    return APP + '/p/' + C.encodeOrigin(u.origin) + u.pathname + u.search + (u.hash || '');
  } catch (e) { return absURL; }
}

function resolve(u) {
  try {
    if (u == null) return u;
    var s = String(u);
    if (s === '') return s;
    if (s.charAt(0) === '#') return s;
    if (/^(data|blob|javascript|mailto|tel|about|sms|magnet|irc|file):/i.test(s)) return s;
    var abs = new URL(s, location.href);
    if (!isProxyable(abs)) return abs.href;
    if (isDirectHost(abs)) return abs.href;
    return toProxy(abs.href);
  } catch (e) { return u; }
}
window.__quasarResolve = resolve;
window.__quasarRealHref = currentRealHref;

function rewriteSrcset(v) {
  return String(v).split(',').map(function (part) {
    var t = part.trim();
    if (!t) return '';
    var segs = t.split(/\s+/);
    if (segs[0]) segs[0] = resolve(segs[0]);
    return segs.join(' ');
  }).filter(function (s) { return s !== ''; }).join(', ');
}

/* ---------- parent sync ---------- */
var lastPinged = null;
var lastTitle = null;
function pingParent() {
  try {
    if (window.parent && window.parent !== window) {
      var real = currentRealHref();
      if (real && real !== lastPinged) {
        lastPinged = real;
        window.parent.postMessage({ __quasar: 'location', url: real, title: document.title || '' }, APP);
        /* Veil shell bridge — drives tab titles, history rows and the
           loading state, exactly like the built-in engine's control script. */
        window.parent.postMessage({ __veil: 1, type: 'nav', url: real, d: { title: document.title || '' } }, APP);
      }
    }
  } catch (e) {}
}
function pingTitle() {
  try {
    if (window.parent && window.parent !== window) {
      var t = document.title || '';
      if (t !== lastTitle) {
        lastTitle = t;
        window.parent.postMessage({ __veil: 1, type: 'title', d: { title: t } }, APP);
      }
    }
  } catch (e) {}
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', pingParent);
} else {
  pingParent();
}
window.addEventListener('load', pingParent);
setInterval(pingTitle, 2000);

/* Veil control-bar reveal relay: mouse near the frame's top edge */
window.addEventListener('mousemove', function (e) {
  try {
    if (e.clientY <= 120 && window.parent && window.parent !== window) {
      window.parent.postMessage({ __veil: 1, type: 'mouse', d: { y: e.clientY } }, APP);
    }
  } catch (e) {}
}, { passive: true });

/* Escape relay — the frame owns focus, the shell's own listener never fires */
window.addEventListener('keydown', function (e) {
  try {
    if (e.key === 'Escape' && window.parent && window.parent !== window) {
      window.parent.postMessage({ __veil: 1, type: 'esc' }, APP);
    }
  } catch (e) {}
}, true);

/* ---------- keyboard shortcut relay ---------- */
/* Keyboard shortcuts (Alt+T/W/←/→/R) are handled by the Quasar app window.
   While the proxied page has focus, its key events never reach the parent —
   relay only our own Alt-chords so browser-style shortcuts keep working
   inside the tunnel. */
try {
  document.addEventListener('keydown', function (e) {
    try {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      var k = (e.key || '').toLowerCase();
      if (k !== 't' && k !== 'w' && k !== 'r' && k !== 'arrowleft' && k !== 'arrowright') return;
      e.preventDefault();
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ __quasar: 'shortcut', key: k }, APP);
      }
    } catch (err) {}
  }, true);
} catch (e) {}

/* ---------- capture originals ---------- */
var _fetch = window.fetch;
var _nativeReplaceState = History.prototype.replaceState; // true native, pre-patch

/* ---------- fetch ---------- */
if (_fetch) {
  var fetchWrapper = function (input, init) {
    try {
      if (typeof input === 'string' || input instanceof URL) {
        input = resolve(input);
      } else if (input && typeof input === 'object' && typeof input.url === 'string') {
        var nu = resolve(input.url);
        if (nu !== input.url) input = new Request(nu, input);
      }
    } catch (e) {}
    return _fetch.call(window, input, init);
  };
  nativeLike(window, 'fetch', fetchWrapper, 1);
}

/* ---------- XMLHttpRequest ---------- */
var _xhrOpen = XMLHttpRequest.prototype.open;
var xhrOpenWrapper = function (method, url) {
  var args = Array.prototype.slice.call(arguments);
  try { args[1] = resolve(url); } catch (e) {}
  return _xhrOpen.apply(this, args);
};
nativeLike(XMLHttpRequest.prototype, 'open', xhrOpenWrapper, 3);

/* ---------- sendBeacon ---------- */
/* Patched on Navigator.prototype (not the instance) so the shim leaves no
   own-property trail on navigator for detection scripts to find. */
try {
  if (navigator.sendBeacon) {
    var sbTarget = typeof Navigator === 'function' &&
      Object.getOwnPropertyDescriptor(Navigator.prototype, 'sendBeacon')
      ? Navigator.prototype : navigator;
    var _sb = navigator.sendBeacon.bind(navigator);
    var sbWrapper = function (url, data) {
      try { return _sb(resolve(url), data); } catch (e) { return false; }
    };
    nativeLike(sbTarget, 'sendBeacon', sbWrapper, 2);
  }
} catch (e) {}

/* ---------- EventSource ---------- */
try {
  if (window.EventSource) {
    var _ES = window.EventSource;
    var QEventSource = class extends _ES {
      constructor(url, cfg) {
        try { url = resolve(url); } catch (e) {}
        super(url, cfg);
      }
    };
    nativeLike(window, 'EventSource', QEventSource, 1);
  }
} catch (e) {}

/* ---------- blob URL registry ---------- */
/* blob: URLs (MediaSource / objectURL video flows) are same-origin by
   design and must NEVER be rewritten. The passthrough keeps them
   byte-identical while presenting a clean native-looking surface. */
try {
  if (window.URL && URL.createObjectURL) {
    var _cOU = URL.createObjectURL;
    nativeLike(URL, 'createObjectURL', function (obj) {
      return _cOU.apply(URL, arguments);
    }, 1);
    var _rOU = URL.revokeObjectURL;
    nativeLike(URL, 'revokeObjectURL', function (obj) {
      try { return _rOU.apply(URL, arguments); } catch (e) {}
    }, 1);
  }
} catch (e) {}

/* ---------- Worker / SharedWorker ---------- */
/* Worker scripts are fetched through the service worker (cross-origin) or the
   SW's referer resolution (root-relative). Mapping the constructor URL keeps
   same-origin absolute paths inside the tunnel even without a SW yet. */
try {
  if (window.Worker) {
    var _Wk = window.Worker;
    var QWorker = function (url, opts) {
      try { url = resolve(url); } catch (e) {}
      return new _Wk(url, opts);
    };
    QWorker.prototype = _Wk.prototype;
    Object.defineProperty(QWorker, 'name', { value: 'Worker' });
    nativeLike(window, 'Worker', QWorker, 1);
  }
  if (window.SharedWorker) {
    var _SWk = window.SharedWorker;
    var QSharedWorker = function (url, opts) {
      try { url = resolve(url); } catch (e) {}
      return new _SWk(url, opts);
    };
    QSharedWorker.prototype = _SWk.prototype;
    Object.defineProperty(QSharedWorker, 'name', { value: 'SharedWorker' });
    nativeLike(window, 'SharedWorker', QSharedWorker, 1);
  }
} catch (e) {}

/* ---------- WebSocket via bridge ---------- */
/* The bridge (mini-service on :BRIDGE_PORT) can be reached three ways:
   1. sandbox gateway      /ws-bridge?XTransformPort=3310
   2. same-origin revproxy /ws-bridge
   3. direct bridge port   http(s)://<host>:3310/ws-bridge
   The bridge serves HTTP and WS on the same port and replies 400 to a GET
   without a target, so a one-time fetch probe can verify each transport —
   a plain 404 (e.g. self-hosted Next.js without a reverse proxy) means the
   path is unhandled and the next candidate must be tried. */
try {
  if (window.WebSocket) {
    var _WS = window.WebSocket;
    var WS_BRIDGE_IDX = 0;
    (function probeBridge(i) {
      if (i > 2 || !_fetch) return;
      var url, opts;
      if (i === 0) {
        url = APP + '/ws-bridge?XTransformPort=' + BRIDGE_PORT;
        opts = undefined;
      } else if (i === 1) {
        url = APP + '/ws-bridge';
        opts = undefined;
      } else {
        // Cross-origin candidate: a plain fetch would die on CORS even when
        // the bridge is reachable, so probe with no-cors and accept an
        // opaque (network-level success) response. WebSockets themselves are
        // not subject to CORS, so reachability is all we need here.
        url = (location.protocol === 'https:' ? 'https://' : 'http://') +
          location.hostname + ':' + BRIDGE_PORT + '/ws-bridge';
        opts = { mode: 'no-cors', cache: 'no-store' };
      }
      try {
        _fetch(url, opts).then(function (r) {
          var ok = opts ? !!(r && (r.type === 'opaque' || r.status === 400))
                        : !!(r && r.status === 400);
          if (ok) WS_BRIDGE_IDX = i;
          else probeBridge(i + 1);
        }).catch(function () { probeBridge(i + 1); });
      } catch (e) {}
    })(0);
    var QWebSocket = class extends _WS {
      constructor(url, protocols) {
        var target = url;
        try {
          var u = new URL(String(url), location.href);
          // Map raw ws(s):// targets onto the bridge; skip URLs that are
          // already bridge requests (idempotent). Keep the original scheme —
          // the bridge decodes and validates ws:// | wss:// itself.
          if ((u.protocol === 'ws:' || u.protocol === 'wss:') && u.pathname.indexOf('/ws-bridge') !== 0) {
            var q = 'target=' + encodeURIComponent(C.encodeOrigin(u.href.replace(/#.*$/, '')));
            var wss = location.protocol === 'https:' ? 'wss:' : 'ws:';
            var candidates = [
              APP + '/ws-bridge?XTransformPort=' + BRIDGE_PORT + '&' + q,
              APP + '/ws-bridge?' + q,
              wss + '//' + location.hostname + ':' + BRIDGE_PORT + '/ws-bridge?' + q
            ];
            target = candidates[WS_BRIDGE_IDX];
          }
        } catch (e) {}
        super(target, protocols);
        var sock = this;
        try {
          // Bridge handshake: must be the very first message on the wire.
          this.addEventListener('open', function () {
            try { sock.send('__QUASAR_READY__'); } catch (e) {}
          });
        } catch (e) {}
      }
    };
    nativeLike(window, 'WebSocket', QWebSocket, 1);
  }
} catch (e) {}

/* ---------- setAttribute ---------- */
var URL_ATTRS = {
  href: 1, src: 1, action: 1, formaction: 1, poster: 1, data: 1, background: 1,
  cite: 1, longdesc: 1, manifest: 1, icon: 1, 'xlink:href': 1
};
var SRCSET_ATTRS = { srcset: 1, imagesrcset: 1 };
var _setAttribute = Element.prototype.setAttribute;
var setAttrWrapper = function (name, value) {
  try {
    var n = String(name).toLowerCase();
    // Subresource integrity can never match — resources are re-served by the
    // proxy — so runtime-created scripts/links must not carry it either.
    if (n === 'integrity') return;
    if (typeof value === 'string') {
      if (SRCSET_ATTRS[n]) {
        value = rewriteSrcset(value);
      } else if (URL_ATTRS[n]) {
        if (n === 'ping') {
          value = value.split(/\s+/).map(function (p) { return p ? resolve(p) : p; }).join(' ');
        } else {
          value = resolve(value);
        }
      }
    }
  } catch (e) {}
  return _setAttribute.call(this, name, value);
};
nativeLike(Element.prototype, 'setAttribute', setAttrWrapper, 2);

/* ---------- element URL properties ---------- */
/* kind 0 = single URL (resolved), kind 1 = srcset-style list */
[
  ['HTMLImageElement', 'src', 0],
  ['HTMLImageElement', 'srcset', 1],
  ['HTMLScriptElement', 'src', 0],
  ['HTMLLinkElement', 'href', 0],
  ['HTMLAnchorElement', 'href', 0],
  ['HTMLAreaElement', 'href', 0],
  ['HTMLFormElement', 'action', 0],
  ['HTMLIFrameElement', 'src', 0],
  ['HTMLFrameElement', 'src', 0],
  ['HTMLMediaElement', 'src', 0],
  ['HTMLSourceElement', 'src', 0],
  ['HTMLSourceElement', 'srcset', 1],
  ['HTMLTrackElement', 'src', 0],
  ['HTMLEmbedElement', 'src', 0],
  ['HTMLObjectElement', 'data', 0],
  ['HTMLInputElement', 'formaction', 0]
].forEach(function (pair) {
  try {
    var ctor = window[pair[0]];
    if (!ctor || !ctor.prototype) return;
    var prop = pair[1];
    var kind = pair[2];
    var d = Object.getOwnPropertyDescriptor(ctor.prototype, prop);
    if (!d || !d.set || !d.get) return;
    Object.defineProperty(ctor.prototype, prop, {
      get: function () { return d.get.call(this); },
      set: function (v) {
        try {
          if (typeof v === 'string') v = kind ? rewriteSrcset(v) : resolve(v);
        } catch (e) {}
        d.set.call(this, v);
      },
      configurable: true,
      enumerable: true
    });
    /* accessor toString spoofing: sites inspect descriptor get/set sources */
    try {
      var dd = Object.getOwnPropertyDescriptor(ctor.prototype, prop);
      var st = window.__QUASAR_STEALTH__;
      if (dd && dd.get && st && st.mark) st.mark(dd.get, 'function get ' + prop + '() { [native code] }');
      if (dd && dd.set && st && st.mark) st.mark(dd.set, 'function set ' + prop + '() { [native code] }');
    } catch (e) {}
  } catch (e) {}
});

/* ---------- History API ---------- */
try {
  ['pushState', 'replaceState'].forEach(function (fn) {
    var orig = History.prototype[fn];
    var hWrapper = function (state, title, url) {
      try {
        if (url != null && url !== '') url = resolve(url);
        else url = location.href;
      } catch (e) {}
      var out = orig.call(this, state, title, url);
      try { setTimeout(pingParent, 0); } catch (e) {}
      return out;
    };
    nativeLike(History.prototype, fn, hWrapper, 3);
  });
  window.addEventListener('popstate', function () { try { pingParent(); } catch (e) {} });
} catch (e) {}

/* ---------- window.open + new-tab links: open INSIDE Veil ---------- */
/* Popups, target=_blank links and ad redirects must never escape to the
   host browser — they open as fresh Veil tabs through the engine lane.
   The parent shell listens for {__veil:1, type:'open-tab'} and handles
   the rest. AD popups (matched by the adblock layer that loaded before
   this engine) are counted and dropped instead of opened. Sites that poke
   the returned window get an inert stub so their code keeps running. */

function toReal(u) {
  try {
    if (u == null) return null;
    var s = String(u);
    if (s === '') return currentRealHref();
    if (s.charAt(0) === '#') return (currentRealHref() || '') + s;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:/i.test(s)) return s;
    /* already proxied? decode the /p/<blob>/... form back to the real URL */
    try {
      var pu = new URL(s, location.href);
      if (pu.origin === APP && pu.pathname.indexOf('/p/') === 0) {
        var m = pu.pathname.match(/^\/p\/([A-Za-z0-9_-]+)(\/.*)?$/);
        if (m) {
          var po = C.decodeOrigin(m[1]);
          /* Client codec can only decode session-XOR blobs; AES blobs decode
             to garbage — validate the origin shape, don't trust it. */
          if (po && /^https?:\/\//i.test(po)) {
            return po + (m[2] || '/') + pu.search + (pu.hash || '');
          }
          /* AES blob (or garbage): hand the PROXIED path to the shell; it
             resolves the real URL server-side (/api/codec) before opening
             the tab. */
          return pu.pathname + pu.search + (pu.hash || '');
        }
        return null;
      }
    } catch (e) {}
    /* relative or absolute real URL — resolve against the REAL page URL */
    var base = currentRealHref() || (TARGET_ORIGIN ? TARGET_ORIGIN + '/' : null);
    if (!base) return null;
    var abs = new URL(s, base);
    if (!isProxyable(abs)) return null;
    return abs.href;
  } catch (e) { return null; }
}

function fakeWindow() {
  var noop = function () {};
  var stub = {
    closed: false, opener: null, name: '', status: '', innerWidth: 0, innerHeight: 0,
    close: noop, focus: noop, blur: noop, print: noop, moveTo: noop, resizeTo: noop,
    scrollTo: noop, setInterval: noop, setTimeout: function (fn) { return 0; },
    clearTimeout: noop, clearInterval: noop,
    postMessage: noop, addEventListener: noop, removeEventListener: noop,
    location: { href: 'about:blank', replace: noop, assign: noop, reload: noop, toString: function () { return 'about:blank'; } },
    document: { write: noop, writeln: noop, open: noop, close: noop, title: '' },
    navigator: navigator
  };
  try { Object.defineProperty(stub, 'closed', { get: function () { return true; } }); } catch (e) {}
  return stub;
}

function isAdTarget(u) {
  try {
    var ab = window.__QUASAR_ADBLOCK__;
    return !!(ab && typeof ab.isAd === 'function' && ab.isAd(u));
  } catch (e) { return false; }
}

function openInVeil(url) {
  try {
    window.parent.postMessage({ __veil: 1, type: 'open-tab', url: url, d: {} }, APP);
  } catch (e) {}
}

try {
  nativeLike(window, 'open', function open(url, name, specs) {
    try {
      var real = toReal(url);
      if (real && /^https?:/i.test(real)) {
        if (isAdTarget(real)) {
          /* counted + dropped by the adblock layer (stats surface in the UI) */
          try { window.__QUASAR_ADBLOCK__.count('popups'); } catch (e0) {}
          return fakeWindow();
        }
        openInVeil(real);
        return fakeWindow();
      }
      if (real && real.charAt(0) === '/' && real.indexOf('/p/') === 0) {
        openInVeil(real);
        return fakeWindow();
      }
      if (real) return fakeWindow();
    } catch (e) {}
    return fakeWindow();
  }, 3);
} catch (e) {}

/* target=_blank / named-target anchors + target=_top escape attempts.
   _blank and named targets become new Veil tabs; _top/_parent (which
   would replace the whole Veil OS with the proxied page!) are demoted
   to normal in-frame navigation. AD targets are counted + blocked. */
try {
  document.addEventListener('click', function (e) {
    try {
      if (!e.target || !e.target.closest) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest('a[href]');
      if (!a) return;
      var tgt = (a.getAttribute('target') || '').toLowerCase();
      if (!tgt || tgt === '_self') return;
      var href = a.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#') return;
      if (tgt === '_top' || tgt === '_parent') {
        /* navigate THIS frame instead of hijacking the whole window */
        e.preventDefault();
        e.stopPropagation();
        window.location.href = resolve(href);
        return;
      }
      /* _blank or a named window → new Veil tab */
      var real = toReal(href);
      if (real && /^https?:/i.test(real)) {
        if (isAdTarget(real)) {
          try { window.__QUASAR_ADBLOCK__.count('popups'); } catch (e0) {}
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        openInVeil(real);
      } else if (real && real.indexOf('/p/') === 0) {
        e.preventDefault();
        e.stopPropagation();
        openInVeil(real);
      }
    } catch (e2) {}
  }, true);
} catch (e) {}

/* ---------- document.cookie shim (synced with server jar) ---------- */
var cookieMap = {};
var cookieSyncTimer = null;
function syncCookies() {
  clearTimeout(cookieSyncTimer);
  cookieSyncTimer = setTimeout(function () {
    try {
      var real = currentRealHref();
      if (!real || !_fetch) return;
      _fetch(APP + '/api/cookie', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: real, cookies: cookieMap })
      }).catch(function () {});
    } catch (e) {}
  }, 500);
}
try {
  Object.defineProperty(document, 'cookie', {
    get: function () {
      var out = [];
      for (var k in cookieMap) out.push(k + '=' + cookieMap[k]);
      return out.join('; ');
    },
    set: function (v) {
      try {
        var parts = String(v).split(';');
        var kv = parts[0] || '';
        var i = kv.indexOf('=');
        if (i > 0) {
          var name = kv.slice(0, i).trim();
          var val = kv.slice(i + 1).trim();
          var meta = parts.slice(1).join(';').toLowerCase();
          var isDelete = /max-age\s*=\s*0(?![0-9])/.test(meta) ||
            (meta.indexOf('expires=') !== -1 && /(197[0-9]|196[0-9])/.test(meta));
          if (isDelete || val === '') delete cookieMap[name];
          else cookieMap[name] = val;
          syncCookies();
        }
      } catch (e) {}
      return v;
    },
    configurable: true
  });
  try {
    var cd = Object.getOwnPropertyDescriptor(document, 'cookie');
    var stC = window.__QUASAR_STEALTH__;
    if (cd && cd.get && stC && stC.mark) stC.mark(cd.get, 'function get cookie() { [native code] }');
    if (cd && cd.set && stC && stC.mark) stC.mark(cd.set, 'function set cookie() { [native code] }');
  } catch (e) {}
  var real0 = currentRealHref();
  if (real0 && _fetch) {
    _fetch(APP + '/api/cookie?url=' + encodeURIComponent(real0))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && data.cookies) {
          for (var k in data.cookies) cookieMap[k] = data.cookies[k];
        }
      })
      .catch(function () {});
  }
} catch (e) {}

/* ---------- v2.0.4 storage partitioning ---------- */
/* localStorage/sessionStorage are namespaced by the REAL target origin so
   two proxied sites can never read each other's boot state (Discord keeps
   gateway state in localStorage — unpartitioned it corrupted across sites
   sharing the app origin). Shims are window-instance accessors presenting
   native-looking methods via the stealth registry. */
try {
  var qNs = '__quasar:' + (currentTargetOrigin() || '@null') + ':';
  function qOwnKeys(real) {
    var out = [];
    try {
      for (var i = 0; i < real.length; i++) {
        var k = real.key(i);
        if (k !== null && k.indexOf(qNs) === 0) out.push(k.slice(qNs.length));
      }
    } catch (e) {}
    return out;
  }
  function makeStorageShim(real) {
    if (!real) return null;
    var shim = Object.create(Storage.prototype);
    nativeLike(shim, 'getItem', function getItem(k) { try { return real.getItem(qNs + String(k)); } catch (e) { return null; } }, 1);
    nativeLike(shim, 'setItem', function setItem(k, v) { real.setItem(qNs + String(k), String(v)); }, 2);
    nativeLike(shim, 'removeItem', function removeItem(k) { try { real.removeItem(qNs + String(k)); } catch (e) {} }, 1);
    nativeLike(shim, 'key', function key(i) { var ks = qOwnKeys(real); return i >= 0 && i < ks.length ? ks[i] : null; }, 1);
    nativeLike(shim, 'clear', function clear() { var ks = qOwnKeys(real); for (var i = 0; i < ks.length; i++) { try { real.removeItem(qNs + ks[i]); } catch (e) {} } }, 0);
    try {
      var st0 = window.__QUASAR_STEALTH__;
      var lenGet = function () { return qOwnKeys(real).length; };
      if (st0 && st0.mark) st0.mark(lenGet, 'function get length() { [native code] }');
      Object.defineProperty(shim, 'length', { get: lenGet, set: undefined, configurable: true, enumerable: true });
    } catch (e) {}
    return new Proxy(shim, {
      get: function (t, k) {
        if (typeof k === 'symbol' || k === 'then' || k === 'toJSON') {
          try { return t[k]; } catch (e) { return undefined; }
        }
        try { if (k in t) return t[k]; } catch (e) {}
        try { var v = real.getItem(qNs + k); return v === null ? undefined : v; } catch (e) { return undefined; }
      },
      set: function (t, k, v) {
        if (typeof k === 'symbol') { try { t[k] = v; } catch (e) {} return true; }
        try { if (k in t) { t[k] = v; return true; } } catch (e) {}
        try { real.setItem(qNs + k, String(v)); } catch (e) {}
        return true;
      },
      deleteProperty: function (t, k) {
        try { if (typeof k !== 'symbol' && k in t) delete t[k]; } catch (e) {}
        try { if (typeof k !== 'symbol') real.removeItem(qNs + k); } catch (e) {}
        return true;
      },
      has: function (t, k) {
        try { if (k in t) return true; } catch (e) {}
        try { return typeof k !== 'symbol' && real.getItem(qNs + k) !== null; } catch (e) { return false; }
      },
      ownKeys: function () { return qOwnKeys(real); },
      getOwnPropertyDescriptor: function (t, k) {
        if (typeof k !== 'symbol') {
          try {
            var v = real.getItem(qNs + k);
            if (v !== null) return { value: v, writable: true, enumerable: true, configurable: true };
          } catch (e) {}
        }
        try { return Reflect.getOwnPropertyDescriptor(t, k); } catch (e) { return undefined; }
      }
    });
  }
  var qLsShim = makeStorageShim(window.localStorage);
  var qSsShim = makeStorageShim(window.sessionStorage);
  if (qLsShim) Object.defineProperty(window, 'localStorage', { get: function () { return qLsShim; }, set: undefined, configurable: true, enumerable: true });
  if (qSsShim) Object.defineProperty(window, 'sessionStorage', { get: function () { return qSsShim; }, set: undefined, configurable: true, enumerable: true });
  try {
    var st0b = window.__QUASAR_STEALTH__;
    if (st0b && st0b.mark) {
      var dLs = Object.getOwnPropertyDescriptor(window, 'localStorage');
      var dSs = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
      if (dLs && dLs.get) st0b.mark(dLs.get, 'function get localStorage() { [native code] }');
      if (dSs && dSs.get) st0b.mark(dSs.get, 'function get sessionStorage() { [native code] }');
    }
  } catch (e) {}
} catch (e) {}

/* ---------- service worker isolation ---------- */
try {
  if (navigator.serviceWorker) {
    // Capture the real methods BEFORE no-oping them for target sites — some
    // pages (YouTube) enumerate + unregister foreign service workers.
    var swContainer = navigator.serviceWorker;
    var swTarget = (typeof ServiceWorkerContainer === 'function') ? ServiceWorkerContainer.prototype : swContainer;
    var _swRegister = swContainer.register.bind(swContainer);
    var _swGetRegs = swContainer.getRegistrations
      ? swContainer.getRegistrations.bind(swContainer)
      : null;
    /* Patched on the prototype — no own-property trail on the container. */
    nativeLike(swTarget, 'register', function register() { return new Promise(function () {}); }, 1);
    if (swContainer.getRegistrations) {
      nativeLike(swTarget, 'getRegistrations', function getRegistrations() { return Promise.resolve([]); }, 0);
    }
    if (swContainer.getRegistration) {
      nativeLike(swTarget, 'getRegistration', function getRegistration() { return Promise.resolve(undefined); }, 1);
    }
    (function ensureOurSw() {
      try {
        var p = _swGetRegs ? _swGetRegs.call(navigator.serviceWorker) : Promise.resolve([]);
        Promise.resolve(p).then(function (regs) {
          var ours = (regs || []).some(function (r) {
            return r.scope && r.scope.indexOf(APP_PREFIX) === 0;
          });
          if (!ours) return _swRegister('/api/sw', { scope: '/p/' });
        }).catch(function () {});
      } catch (e) {}
    })();
  }
} catch (e) {}

/* ---------- Navigation API (Chromium) ---------- */
try {
  // YouTube & co. drive SPA routing through navigation.navigate() — map the
  // URL through the proxy. (Plain interception of same-origin escapes caused
  // navigation storms, so we only rewrite the requested URL here.)
  if (window.navigation && typeof window.navigation.navigate === 'function') {
    var _navNavigate = window.navigation.navigate.bind(window.navigation);
    var navTarget = (typeof Navigation === 'function') ? Navigation.prototype : window.navigation;
    var navWrapper = function (url, opts) {
      try {
        if (url != null) url = resolve(url);
      } catch (e) {}
      return _navNavigate(url, opts);
    };
    nativeLike(navTarget, 'navigate', navWrapper, 1);
  }
} catch (e) {}

/* ---------- URL repair for history escapes ---------- */
/* Some pages grab a CLEAN native pushState/replaceState from a helper iframe
   and apply it to this window's history (anti-tamper), which rewrites the URL
   off the /p/... path and breaks the proxy context. navigate events fire no
   matter how the history was written, so we watch them and repair the URL
   back onto the proxied path using our own captured-native replaceState. */
try {
  var repairTimer = null;
  var navObj = window.navigation;
  if (navObj && typeof navObj.addEventListener === 'function') {
    var repairHandler = function (e) {
      try {
        if (!TARGET_ORIGIN || e.hashChange) return;
        var dest = e.destination && e.destination.url;
        if (!dest) return;
        var du = new URL(dest);
        if (du.origin !== APP) return;                // cross-origin: cannot repair
        if (du.pathname.indexOf('/p/') === 0) return; // already proxied
        if (du.pathname.indexOf('/ws-bridge') === 0) return; // bridge transport
        clearTimeout(repairTimer);
        repairTimer = setTimeout(function () {
          try {
            if (location.pathname.indexOf('/p/') === 0) return; // fixed already
            var mapped = APP + '/p/' + C.encodeOrigin(TARGET_ORIGIN) + du.pathname + du.search;
            _nativeReplaceState.call(history, history.state, '', mapped);
            setTimeout(pingParent, 0);
          } catch (err) {}
        }, 30);
      } catch (err) {}
    };
    navObj.addEventListener('navigate', repairHandler);
  }
} catch (e) {}

/* ---------- v2.0.4 virtual location (virtLoc sites) ---------- */
/* The AST rewriter renames free location / window.location /
   document.location READS to __quasar_loc$. The shim reports the REAL
   target URL on every read property (href/origin/host/protocol/...) while
   navigation (href=, pathname=, assign, replace) is steered through the
   tunnel. Non-configurable descriptors mirror native Location semantics. */
function qLocRealUrl() {
  try {
    var m = location.pathname.match(/^\/p\/([A-Za-z0-9_-]+)(\/.*)?$/);
    var origin = (PAGE_DATA && PAGE_DATA.o) || (m ? C.decodeOrigin(m[1]) : null);
    if (!origin) return location.href;
    return origin + ((m && m[2]) || '/') + location.search + location.hash;
  } catch (e) { return location.href; }
}
function installVirtualLocation() {
  if (window.__quasar_loc$) return;
  var shim = {};
  var stV = window.__QUASAR_STEALTH__;
  function realStr() { try { return qLocRealUrl(); } catch (e) { return location.href; } }
  function realURL() { try { return new URL(realStr()); } catch (e) { return null; } }
  function markGet(key, fn) {
    try { if (stV && stV.mark) stV.mark(fn, 'function get ' + key + '() { [native code] }'); } catch (e) {}
    return fn;
  }
  function rd(key, fn) {
    Object.defineProperty(shim, key, { get: markGet(key, fn), set: undefined, configurable: false, enumerable: true });
  }
  rd('origin', function () { var u = realURL(); return u ? u.origin : ''; });
  rd('protocol', function () { var u = realURL(); return u ? u.protocol : 'https:'; });
  rd('host', function () { var u = realURL(); return u ? u.host : ''; });
  rd('hostname', function () { var u = realURL(); return u ? u.hostname : ''; });
  rd('port', function () { var u = realURL(); return u ? u.port : ''; });
  rd('ancestorOrigins', function () {
    var o = currentTargetOrigin() || '';
    return {
      length: 1,
      item: function (i) { return i === 0 ? o : null; },
      contains: function (s) { return String(s) === o; },
      '0': o
    };
  });
  /* href: reads report the real URL, writes navigate through the tunnel. */
  Object.defineProperty(shim, 'href', {
    get: markGet('href', realStr),
    set: function (v) { try { location.href = resolve(v); } catch (e) { location.href = v; } },
    configurable: false, enumerable: true
  });
  /* pathname/search/hash: relative writes resolve against the proxied URL,
     which keeps them in-tunnel by construction. */
  ['pathname', 'search', 'hash'].forEach(function (key) {
    Object.defineProperty(shim, key, {
      get: markGet(key, function () {
        var u = realURL();
        if (!u) return key === 'pathname' ? '/' : '';
        return u[key];
      }),
      set: function (v) { try { location[key] = v; } catch (e) {} },
      configurable: false, enumerable: true
    });
  });
  shim.assign = function (u) { try { location.assign(resolve(u)); } catch (e) { try { location.assign(u); } catch (e2) {} } };
  shim.replace = function (u) { try { location.replace(resolve(u)); } catch (e) { try { location.replace(u); } catch (e2) {} } };
  shim.reload = function () { try { location.reload(); } catch (e) {} };
  shim.toString = function () { return realStr(); };
  shim.valueOf = function () { return realStr(); };
  try { shim[Symbol.toPrimitive] = function () { return realStr(); }; } catch (e) {}
  try { if (stV && stV.mark) { stV.mark(shim.toString, 'function toString() { [native code] }'); stV.mark(shim.valueOf, 'function valueOf() { [native code] }'); stV.mark(shim.assign, 'function assign() { [native code] }'); stV.mark(shim.replace, 'function replace() { [native code] }'); stV.mark(shim.reload, 'function reload() { [native code] }'); } } catch (e) {}
  window.__quasar_loc$ = shim;
}

/* ---------- per-site client fixes (__QUASAR_SITE__) ---------- */
var CLIENT_FIXES = {
  fixHasFocus: function () {
    /* Media-heavy pages pause/blur when the tunnel iframe loses focus —
       report a focused, visible document. */
    try {
      Object.defineProperty(document, 'hasFocus', { value: function () { return true; }, configurable: true });
      Object.defineProperty(document, 'visibilityState', { get: function () { return 'visible'; }, configurable: true });
      Object.defineProperty(document, 'hidden', { get: function () { return false; }, configurable: true });
    } catch (e) {}
  },
  fakeNotifications: function () {
    /* Sites gate features behind Notification.permission — grant it freely
       (no real notification permission is ever requested). */
    try {
      if (window.Notification) {
        Object.defineProperty(Notification, 'permission', { get: function () { return 'granted'; }, configurable: true });
        Notification.requestPermission = function (cb) {
          try { if (cb) cb('granted'); } catch (err) {}
          return Promise.resolve('granted');
        };
      }
    } catch (e) {}
  },
  pmOrigins: function () {
    /* v2.0.4 OAuth/popup handshake: postMessage targetOrigins naming the REAL
       site origin are remapped to the app origin (the actual receiver), and
       incoming messages arriving from the app origin (parent frame, sibling
       proxied windows) are presented with the site's own origin so
       event.origin === 'https://discord.com' style checks pass. */
    try {
      var own = currentTargetOrigin() || '';
      if (!own) return;
      var _pm = window.postMessage ? window.postMessage.bind(window) : null;
      if (_pm) {
        var pmWrapper = function postMessage(message, targetOrigin, transfer) {
          try {
            if (typeof targetOrigin === 'string' && targetOrigin && targetOrigin !== '*') {
              if (targetOrigin === own || targetOrigin.replace(/\/$/, '') === own) targetOrigin = APP;
            }
          } catch (e) {}
          return _pm(message, targetOrigin, transfer);
        };
        nativeLike(window, 'postMessage', pmWrapper, 3);
      }
      function wrapEvent(ev) {
        try {
          if (!ev || typeof ev !== 'object') return ev;
          if (ev.origin !== APP) return ev;
          var fake = {
            data: ev.data, type: ev.type, origin: own, lastEventId: ev.lastEventId,
            source: ev.source, ports: ev.ports, target: ev.target,
            currentTarget: ev.currentTarget, eventPhase: ev.eventPhase,
            bubbles: ev.bubbles, cancelable: ev.cancelable,
            defaultPrevented: ev.defaultPrevented, isTrusted: ev.isTrusted,
            timeStamp: ev.timeStamp
          };
          fake.preventDefault = function () { try { ev.preventDefault(); } catch (e) {} };
          fake.stopPropagation = function () { try { ev.stopPropagation(); } catch (e) {} };
          fake.stopImmediatePropagation = function () { try { ev.stopImmediatePropagation(); } catch (e) {} };
          return fake;
        } catch (e) { return ev; }
      }
      function wrapHandler(fn) {
        return function (ev) { return fn.call(this, wrapEvent(ev)); };
      }
      var _wAdd = window.addEventListener ? window.addEventListener.bind(window) : null;
      if (_wAdd) {
        nativeLike(window, 'addEventListener', function addEventListener(type, fn, opts) {
          try {
            if (type === 'message' && typeof fn === 'function') return _wAdd('message', wrapHandler(fn), opts);
          } catch (e) {}
          return _wAdd(type, fn, opts);
        }, 3);
      }
      try {
        var _omDesc = Object.getOwnPropertyDescriptor(window, 'onmessage') ||
          (typeof Window !== 'undefined' && Object.getOwnPropertyDescriptor(Window.prototype, 'onmessage'));
        Object.defineProperty(window, 'onmessage', {
          get: function () { return _omDesc && _omDesc.get ? _omDesc.get.call(window) : null; },
          set: function (fn) {
            var w = (typeof fn === 'function') ? wrapHandler(fn) : fn;
            if (_omDesc && _omDesc.set) _omDesc.set.call(window, w);
          },
          configurable: true, enumerable: true
        });
      } catch (e) {}
    } catch (e) {}
  }
};
try {
  var siteCfg = window.__QUASAR_SITE__ || {};
  if (siteCfg.virtLoc) installVirtualLocation();
  var hookList = siteCfg.hooks || [];
  for (var hi = 0; hi < hookList.length; hi++) {
    var fixFn = CLIENT_FIXES[hookList[hi]];
    if (typeof fixFn === 'function') { try { fixFn(); } catch (e) {} }
  }
} catch (e) {}

/* ---------- MutationObserver URL safety net ---------- */
/* Last-line DOM trap: every element inserted by any means (innerHTML,
   template cloning, parser) has its URL-bearing attributes mapped into the
   tunnel if the static rewriter and the setters both missed it. */
try {
  var moPending = [];
  var moScheduled = false;
  var URLISH_RE = /^https?:\/\//i;
  var MO_ATTRS = ['href','src','action','formaction','poster','data','background','cite','icon','srcset','imagesrcset','data-src','data-original','data-poster','data-href','data-url','data-background-image'];
  function moFlush() {
    moScheduled = false;
    var batch = moPending;
    moPending = [];
    for (var i = 0; i < batch.length; i++) {
      var el = batch[i];
      try {
        if (!el || el.nodeType !== 1 || !el.attributes) continue;
        for (var a = 0; a < MO_ATTRS.length; a++) {
          var name = MO_ATTRS[a];
          if (!el.hasAttribute(name)) continue;
          var val = el.getAttribute(name);
          if (!val || val.charAt(0) === '#' || val.indexOf('/p/') === 0) continue;
          if (URLISH_RE.test(val) || (val.charAt(0) === '/' && val.charAt(1) !== '/' && TARGET_ORIGIN)) {
            var mapped = resolve(val);
            if (mapped && mapped !== val) _setAttribute.call(el, name, mapped);
          }
        }
      } catch (err) {}
    }
  }
  function moQueue(el) {
    moPending.push(el);
    if (!moScheduled) { moScheduled = true; setTimeout(moFlush, 16); }
  }
  var qMo = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (!n || n.nodeType !== 1) continue;
        moQueue(n);
        try {
          if (n.querySelectorAll) {
            var inner = n.querySelectorAll('[href],[src],[action],[poster],[srcset],[data-src]');
            for (var k = 0; k < inner.length; k++) moQueue(inner[k]);
          }
        } catch (err) {}
      }
    }
  });
  qMo.observe(document.documentElement || document, { childList: true, subtree: true });
} catch (e) {}

try {
  console.log('%cQUASAR%c engine active', 'background:#7c3aed;color:#fff;padding:2px 6px;border-radius:4px;font-weight:bold', 'color:#a78bfa;padding:2px 4px');
} catch (e) {}
})();
`;

/**
 * The full client bundle: codec → stealth layer (toString spoofing,
 * webdriver, fingerprint farbling) → adblock layer (popups, DOM sweeper,
 * counters) → hook engine. Order matters: stealth installs first so every
 * later patch can register itself as native, the adblocker follows so the
 * engine's patches never resurrect a popup path, and all layers share the
 * codec's encodeOrigin. QUASAR_NO_STEALTH=1 drops the stealth bundle.
 */
const STEALTH_ACTIVE = process.env.QUASAR_NO_STEALTH !== "1";
export const HOOK_BUNDLE =
  CODEC_SOURCE +
  "\n" +
  (STEALTH_ACTIVE ? STEALTH_SOURCE + "\n" : "") +
  ADBLOCK_SOURCE +
  "\n" +
  HOOK_SOURCE;

/* ------------------------------------------------------------------ */
/* Head injection parts                                                */
/* ------------------------------------------------------------------ */

/** JSON for inline <script> embedding (escape </script> breakouts). */
function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * The two head scripts injected BEFORE the hook bundle (buffered and
 * streaming pipelines both use this):
 *   __QUASAR_DATA__ — real target origin/URL of this document (clients can't
 *     decrypt AES blobs, so page context is handed over in plaintext here).
 *   __QUASAR_SITE__ — per-site client hook names to run at document start.
 */
export function quasarHeadParts(
  targetUrl: string,
  site: SiteFix | null
): { pageDataTag: string; siteConfigTag: string } {
  let origin = "";
  try {
    origin = new URL(targetUrl).origin;
  } catch {
    origin = "";
  }
  return {
    pageDataTag: `<script data-quasar="page">window.__QUASAR_DATA__={o:${inlineJson(origin)},u:${inlineJson(targetUrl)},v:${inlineJson(QUASAR_VERSION)},dm:${inlineJson(DIRECT_MEDIA_HOSTS)}};</script>`,
    siteConfigTag: `<script data-quasar="site">window.__QUASAR_SITE__=${inlineJson({
      hooks: site?.clientHooks ?? [],
      virtLoc: !!site?.flags?.virtLoc,
    })};</script>`,
  };
}
