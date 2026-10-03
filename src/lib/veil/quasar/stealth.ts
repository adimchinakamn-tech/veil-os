/**
 * Quasar Stealth Layer (client bundle)
 * ------------------------------------
 * Loaded BEFORE the adblocker and the hook engine on every proxied page.
 * Owns everything that hides the fact that the runtime has been patched:
 *
 *   1. NATIVE-LOOK REGISTRY — every function Quasar swaps in is registered
 *      via __QUASAR_STEALTH__.mark(fn, nativeString) so that
 *      Function.prototype.toString reports "function fetch() { [native code] }"
 *      for it. The toString override itself is registered, delegates to the
 *      real toString for every unregistered function, and its property
 *      descriptor (writable / non-enumerable / configurable) matches native.
 *
 *   2. webdriver = false — navigator.webdriver reports false (getter shape
 *      preserved on both Navigator.prototype and the instance).
 *
 *   3. FINGERPRINT FARBLING — light, session-stable noise so canvas / WebGL /
 *      audio fingerprint hashes are unique per page-load but consistent for
 *      repeated reads of the same canvas/buffer (noise keyed by a per-canvas
 *      seed + byte offset, so cross-read comparisons never diverge):
 *        - CanvasRenderingContext2D.getImageData
 *        - HTMLCanvasElement.toDataURL / toBlob (via a noised temp copy)
 *        - WebGL(2)RenderingContext.readPixels
 *        - AudioBuffer.getChannelData
 *
 * Disable with QUASAR_NO_STEALTH=1 (checked when the bundle is assembled in
 * hooks.ts). Plain ES5-ish code, no backticks, safe to embed in HTML.
 */

export const STEALTH_SOURCE = `(function () {
'use strict';
if (window.__QUASAR_STEALTH__) return;
window.__QUASAR_STEALTH__ = true;

/* ------------------------------------------------------------------ */
/* 1. Native-look registry + Function.prototype.toString spoof          */
/* ------------------------------------------------------------------ */
var REG = new Map();
var _fnToString = Function.prototype.toString;

function mark(fn, nativeString) {
  try {
    if (typeof fn !== 'function') return fn;
    REG.set(fn, nativeString || ('function ' + (fn.name || '') + '() { [native code] }'));
    return fn;
  } catch (e) { return fn; }
}

var toStringProxy = function toString() {
  try {
    if (REG.has(this)) return REG.get(this);
  } catch (e) {}
  return _fnToString.call(this);
};
/* make the override itself look native before installing it */
mark(toStringProxy, 'function toString() { [native code] }');
try { Function.prototype.toString = toStringProxy; } catch (e) {}

/* helper shared by the stealth bundle and (via mark) later bundles */
function nativeLike(obj, key, wrapper, len) {
  try {
    Object.defineProperty(obj, key, {
      value: wrapper, writable: true, enumerable: true, configurable: true
    });
  } catch (e) {
    try { obj[key] = wrapper; } catch (e2) {}
  }
  try { Object.defineProperty(wrapper, 'name', { value: key, configurable: true }); } catch (e) {}
  try { if (len != null) Object.defineProperty(wrapper, 'length', { value: len, configurable: true }); } catch (e) {}
  mark(wrapper, 'function ' + key + '() { [native code] }');
  return wrapper;
}

window.__QUASAR_STEALTH__ = { mark: mark, nativeLike: nativeLike };

/* ------------------------------------------------------------------ */
/* 2. navigator.webdriver = false                                       */
/* ------------------------------------------------------------------ */
try {
  var webdrv = function () { return false; };
  mark(webdrv, 'function get webdriver() { [native code] }');
  Object.defineProperty(Navigator.prototype, 'webdriver', {
    get: webdrv, set: undefined, configurable: true, enumerable: true
  });
} catch (e) {}
try {
  var webdrv2 = function () { return false; };
  mark(webdrv2, 'function get webdriver() { [native code] }');
  Object.defineProperty(navigator, 'webdriver', {
    get: webdrv2, set: undefined, configurable: true, enumerable: true
  });
} catch (e) {}

/* ------------------------------------------------------------------ */
/* 3. Fingerprint farbling                                              */
/* ------------------------------------------------------------------ */
/* Per-canvas stable seed: noise for byte i is derived from
   (seed, i), so two reads of the same canvas agree exactly, while
   the seed itself is fresh per page-load — the hash other sites
   compute is unique here but stable while you stay on the page. */
var SEEDS = new WeakMap();
function seedOf(obj) {
  var s = SEEDS.get(obj);
  if (s == null) { s = (Math.random() * 0xffffffff) >>> 0; SEEDS.set(obj, s); }
  return s;
}
function deltaAt(seed, i) {
  /* deterministic -1 / +1. Nonlinear murmur3-style finalizer: XOR-only
     mixing is linear, which would make any two seeds produce identical
     (or fully complementary) patterns — multiplication breaks that. */
  var h = ((seed ^ Math.imul(i + 1, 2246822519)) >>> 0);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return (h & 1) === 1 ? 1 : -1;
}
function farbleBytes(bytes, seed) {
  for (var i = 0; i < bytes.length; i += 16) {
    var v = bytes[i] + deltaAt(seed, i);
    if (v >= 0 && v <= 255) bytes[i] = v;
  }
}

/* ---- canvas 2D: getImageData ---- */
try {
  if (window.CanvasRenderingContext2D) {
    var _getImageData = CanvasRenderingContext2D.prototype.getImageData;
    var gidWrapper = function getImageData(sx, sy, sw, sh) {
      var img = _getImageData.apply(this, arguments);
      try {
        if (img && img.data && img.data.length) farbleBytes(img.data, seedOf(this.canvas));
      } catch (e) {}
      return img;
    };
    nativeLike(CanvasRenderingContext2D.prototype, 'getImageData', gidWrapper, 4);
  }
} catch (e) {}

/* ---- canvas 2D: toDataURL / toBlob via a noised temp copy ---- */
try {
  if (window.HTMLCanvasElement) {
    var _getContext = HTMLCanvasElement.prototype.getContext;
    var _toDataURL = HTMLCanvasElement.prototype.toDataURL;
    var _toBlob = HTMLCanvasElement.prototype.toBlob;

    /* returns a noised 2D copy of the canvas, or null when the canvas
       cannot be read (tainted / zero-sized / non-2d) — the native call
       then runs unchanged and throws exactly what the site expects. */
    function noisedCopy(cv) {
      try {
        if (!cv || !cv.width || !cv.height) return null;
        var ctx = _getContext.call(cv, '2d');
        if (!ctx || !ctx.getImageData) return null;
        var img = ctx.getImageData(0, 0, cv.width, cv.height); /* goes through the farbling wrapper */
        var tmp = document.createElement('canvas');
        tmp.width = cv.width; tmp.height = cv.height;
        tmp.getContext('2d').putImageData(img, 0, 0);
        return tmp;
      } catch (e) { return null; }
    }

    var dupWrapper = function toDataURL() {
      var tmp = noisedCopy(this);
      if (tmp) return _toDataURL.apply(tmp, arguments);
      return _toDataURL.apply(this, arguments);
    };
    nativeLike(HTMLCanvasElement.prototype, 'toDataURL', dupWrapper, 0);

    var blobWrapper = function toBlob(callback, type, quality) {
      var tmp = noisedCopy(this);
      if (tmp) return _toBlob.call(tmp, callback, type, quality);
      return _toBlob.apply(this, arguments);
    };
    nativeLike(HTMLCanvasElement.prototype, 'toBlob', blobWrapper, 1);
  }
} catch (e) {}

/* ---- WebGL / WebGL2: readPixels ---- */
try {
  var wrapReadPixels = function (proto, label) {
    if (!proto || !proto.readPixels) return;
    var _readPixels = proto.readPixels;
    var rpWrapper = function readPixels(x, y, w, h, format, type, pixels) {
      var out = _readPixels.apply(this, arguments);
      try {
        if (pixels && pixels.length && this.canvas) {
          farbleBytes(pixels, seedOf(this.canvas));
        }
      } catch (e) {}
      return out;
    };
    nativeLike(proto, 'readPixels', rpWrapper, 4);
  };
  if (window.WebGLRenderingContext) wrapReadPixels(window.WebGLRenderingContext.prototype, 'webgl');
  if (window.WebGL2RenderingContext) wrapReadPixels(window.WebGL2RenderingContext.prototype, 'webgl2');
} catch (e) {}

/* ---- audio: AudioBuffer.getChannelData ---- */
try {
  if (window.AudioBuffer && AudioBuffer.prototype.getChannelData) {
    var _getChannelData = AudioBuffer.prototype.getChannelData;
    var NOISED = new WeakSet(); /* each live array is noised exactly once */
    var BUFS = new WeakMap();   /* stable per-buffer seed */
    var gcdWrapper = function getChannelData(channel) {
      var arr = _getChannelData.apply(this, arguments);
      try {
        if (arr && arr.length && !NOISED.has(arr)) {
          NOISED.add(arr);
          var s = BUFS.get(this);
          if (s == null) { s = (Math.random() * 0xffffffff) >>> 0; BUFS.set(this, s); }
          for (var i = 0; i < arr.length; i += 61) {
            arr[i] = arr[i] + deltaAt(s, i) * 1e-7; /* inaudible */
          }
        }
      } catch (e) {}
      return arr;
    };
    nativeLike(AudioBuffer.prototype, 'getChannelData', gcdWrapper, 1);
  }
} catch (e) {}
})();
`;
