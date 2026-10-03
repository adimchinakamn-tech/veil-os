/**
 * freetube-service — ft-electron-bridge.js
 *
 * Browser replacement for the program's preload: implements the same
 * window.ftElectron API the FreeTube renderer expects, but routes the
 * calls over HTTP/SSE to the real program running in the service.
 */
(() => {
  if (window.ftElectron) return;

  // Mount base — the app may be served at / (service directly) or /ft
  // (through the Next rewrite). All bridge paths derive from it.
  const BASE = (location.pathname.replace(/\/(index\.html)?$/, "") || "").replace(/\/$/, "");
  const INSTANCE_HOST = "freetube-instance.veil.local";

  /* Per-viewer isolation: this browser's key rides every IPC call so the
     service routes us to OUR program process — searches, watch history,
     playlists and settings are private per visitor, never shared.
     Resolution: the shell's ?vv= stamp (works cross-origin, e.g. the
     offline file's app frame) → the site's veil_viewer cookie (the
     same-origin embed inside the app). */
  let VIEWER = "";
  try {
    const q = new URLSearchParams(location.search).get("vv");
    if (q && /^[A-Za-z0-9_-]{6,64}$/.test(q)) VIEWER = q;
  } catch (e) { /* no search */ }
  if (!VIEWER) {
    try {
      const m = /(?:^|;\s*)veil_viewer=([A-Za-z0-9_-]{6,64})/.exec(document.cookie || "");
      if (m) VIEWER = m[1];
    } catch (e) { /* no cookie access */ }
  }
  const VVQ = VIEWER ? "?vv=" + encodeURIComponent(VIEWER) : "";

  /* First-open determinism: FreeTube 0.25.3's router hardcodes the
     empty-hash route to the (empty, fresh-profile) Subscriptions list —
     which reads as broken. The service seed's documented intent is "first
     open shows content" (Most Popular = trending), so redirect empty
     hashes there before the renderer boots. Deep links (#/watch/…,
     #/search/…) arrive with their hash and are untouched. */
  try {
    if (!location.hash || location.hash === "#" || location.hash === "#/") {
      location.replace(location.pathname + location.search + "#/popular");
    }
  } catch (e) { /* keep going */ }

  /* Route the program's instance fetches (https://freetube-instance.veil.local/...)
     to the same-origin compat API. */
  const origFetch = window.fetch.bind(window);

  /* Static-asset cache control: the program builds ROOT-RELATIVE
     ("/static/…") and ABSOLUTE same-origin ("…/ft/static/…") URLs at
     runtime. Older copies were served with mislabeled brotli locales under
     a hard 1h cache — rewriting every static URL with a build stamp busts
     those stale entries once, scopes root-relative ones onto BASE, and the
     stamp only changes when the service build does. */
  const FT_BUILD = "20260907b";
  const bustStatic = (u) => {
    try {
      const abs = new URL(u, location.href);
      if (abs.origin !== location.origin) return null;
      // Normalize: strip the app mount (BASE) if present so both shapes
      // match — the program's own URL builder already emits "/ft/static/…"
      // (publicPath from the script src), some paths come root-relative.
      const base = BASE || "";
      let path = abs.pathname;
      if (base && path.startsWith(base + "/")) path = path.slice(base.length);
      if (!/^\/static\/.+/.test(path)) return null;
      abs.pathname = base + path; // re-mount (identity for BASE-prefixed inputs)
      abs.search = (abs.search ? abs.search + "&" : "") + "v=" + FT_BUILD;
      return abs.href;
    } catch (e) { return null; }
  };

  /* Guarded fetch for the compat API: converts network-layer failures and
     plain-text proxy 500s ("Internal Server Error") into Invidious-shaped
     JSON error responses, so the program's own res.json() never crashes
     with `Unexpected token 'I', "Internal S"...`. */
  async function safeApi(path, init) {
    let r;
    try {
      r = await origFetch(path, init);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "veil bridge: could not reach the FreeTube service", errorType: "api_request_failed" }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }
    const ct = (r.headers && r.headers.get("content-type")) || "";
    if (!r.ok && ct.indexOf("json") === -1) {
      return new Response(
        JSON.stringify({ error: "veil bridge: upstream HTTP " + r.status, errorType: "api_request_failed" }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }
    return r;
  }

  window.fetch = async (input, init) => {
    try {
      const u = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (/^https?:\/\/freetube-instance\.veil\.local(?::\d+)?(\/.*)?$/i.test(u)) {
        const path = "/ft-invidious" + (u.replace(/^[a-z]+:\/\/[^/]+/i, "") || "/");
        if (typeof input === "string" || !(input instanceof Request)) {
          return safeApi(path, init);
        }
        // Materialize Request bodies (stream bodies are unfetchable rebuilt)
        const isBody = input.method !== "GET" && input.method !== "HEAD";
        const body = isBody ? await input.clone().arrayBuffer() : undefined;
        return safeApi(path, {
          method: input.method,
          headers: [...input.headers.entries()],
          body: body && body.byteLength ? body : undefined,
          credentials: "same-origin",
        });
      }
      // Root-relative runtime fetches (e.g. /static/external-player-map.json)
      // and the program's absolute same-origin static URLs → cache-busted
      const busted = bustStatic(u);
      if (busted) {
        return origFetch(busted, init);
      }
      if (BASE && /^\/static\//.test(u) && typeof input === "string") {
        return origFetch(bustStatic(BASE + u) || BASE + u, init);
      }
    } catch (e) { /* fall through */ }
    return origFetch(input, init);
  };

  /* DOM thumbnail rewrite: the renderer builds <img> srcs from its
     instance setting (https://freetube-instance.veil.local/vi/…). That
     pseudo-host has no DNS — rewrite every such src to the same-origin
     compat route the fetch wrapper uses (/ft-invidious/…), including
     ones the app sets later (Vue re-renders). */
  function veilImgSrc(el) {
    try {
      var s = el.getAttribute && el.getAttribute("src");
      if (!s || s.charAt(0) === "/") return;
      var m = /^https?:\/\/freetube-instance\.veil\.local(?::\d+)?(\/.*)?$/i.exec(s);
      if (m) el.setAttribute("src", "/ft-invidious" + (m[1] || "/"));
    } catch (e) { /* not an element we can touch */ }
  }
  try {
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var mu = muts[i];
        if (mu.type === "attributes") { veilImgSrc(mu.target); continue; }
        var add = mu.addedNodes;
        for (var j = 0; j < add.length; j++) {
          var n = add[j];
          if (!n || n.nodeType !== 1) continue;
          if (n.tagName === "IMG") veilImgSrc(n);
          else if (n.querySelectorAll) {
            var imgs = n.querySelectorAll("img");
            for (var k = 0; k < imgs.length; k++) veilImgSrc(imgs[k]);
          }
        }
      }
    }).observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["src"],
    });
  } catch (e) { /* observer unavailable */ }

  const listeners = new Map(); // channel -> Set<fn>

  function onChannel(ch, cb) {
    if (!listeners.has(ch)) listeners.set(ch, new Set());
    listeners.get(ch).add(cb);
  }

  async function invoke(channel, ...args) {
    const r = await origFetch(BASE + "/ipc/invoke" + VVQ, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel, args }),
    });
    let j;
    try {
      j = await r.json();
    } catch (e) {
      // Non-JSON body (e.g. a plain-text proxy 500) — surface a real Error
      // so the program shows its own error UX instead of an "Unexpected
      // token" crash dialog.
      throw new Error("bridge /ipc/invoke " + channel + ": HTTP " + r.status + " (non-JSON response)");
    }
    if (j.ok) return j.value;
    const err = new Error(j.error?.message || `ipc error: ${channel}`);
    err.ipcChannel = channel;
    throw err;
  }

  function send(channel, ...args) {
    origFetch(BASE + "/ipc/invoke" + VVQ, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel, args }),
    }).catch(() => {});
  }

  // SSE: broadcasts from the program's webContents.send — events are
  // scoped server-side to this viewer's process, so the connection must
  // carry the same key (?vv=; the cookie rides along when same-origin).
  try {
    const es = new EventSource(BASE + "/ipc/events" + VVQ);
    es.onmessage = (m) => {
      try {
        const { channel, args } = JSON.parse(m.data);
        // Self-healing: if the program restarted underneath us (crash +
        // auto-restart), reload the page so the app re-boots cleanly
        // instead of leaving a stuck half-alive UI.
        if (channel === "veil-restart" && window.__veilSawFirstBoot) {
          try { window.location.reload(); } catch (e) {}
          return;
        }
        if (channel === "veil-restart") { window.__veilSawFirstBoot = true; return; }
        const set = listeners.get(channel);
        if (set) {
          const fakeEvent = { preventDefault: () => {}, sender: null };
          for (const cb of set) {
            try { cb(fakeEvent, ...(args || [])); } catch (e) { console.warn("[ft-bridge] cb", channel, e); }
          }
        }
      } catch (e) { console.warn("[ft-bridge] sse", e); }
    };
  } catch (e) { console.warn("[ft-bridge] EventSource", e); }

  function dbCall(channel) {
    return (action, data) => invoke(channel, data != null ? { action, data } : { action });
  }

  function syncHandler(ch) {
    return (cb) => onChannel(ch, (payload) => {
      // main sends (event, { event: <realEvent>, data }) — normalize
      const p = payload && typeof payload === "object" && "event" in payload ? payload : { event: null, data: payload };
      cb(p.event, p.data);
    });
  }

  window.ftElectron = {
    getSystemLocale: () => invoke("get-system-locale"),
    isWaylandPlatform: async () => false,
    openInNewWindow: (url, opts, a) => send("create-new-window", url, opts, a),
    enableProxy: (n) => send("enable-proxy", n),
    disableProxy: () => send("disable-proxy"),
    setInvidiousAuthorization: (n, t) => send("set-invidious-authorization", n, t),
    clearInvidiousAuthorization: () => send("set-invidious-authorization", null),
    startPowerSaveBlocker: () => send("start-power-save-blocker"),
    stopPowerSaveBlocker: () => send("stop-power-save-blocker"),
    getReplaceHttpCache: () => invoke("get-replace-http-cache"),
    toggleReplaceHttpCache: () => send("toggle-replace-http-cache"),
    requestPiP: () => {
      const v = document.querySelector("video.player");
      v?.ui?.getControls?.()?.togglePiP?.();
    },
    requestFullscreen: () => {
      const v = document.querySelector("video.player");
      v?.ui?.getControls?.()?.toggleFullScreen?.();
    },
    playerCacheGet: (n) => invoke("player-cache-get", n),
    playerCacheSet: async (n, r) => { await invoke("player-cache-set", n, r); },
    generatePoToken: (n, r, t, a) => invoke("generate-po-token", n, r, t, a),
    chooseDefaultFolder: () => send("choose-default-folder"),
    writeToDefaultFolder: async (n, r) => await invoke("write-to-default-folder", n, r),
    relaunch: () => send("relaunch-request"),
    openInExternalPlayer: (n) => { if (navigator.userActivation?.isActive) send("open-in-external-player", n); },
    handleOpenInExternalPlayerResult: (n) => onChannel("open-in-external-player-result", (a, b, c) => n(a, b, c)),
    setZoomFactor: (n) => { if (typeof n === "number" && n > 0) { document.body.style.zoom = String(n); } },
    getNavigationHistory: () => invoke("get-navigation-history"),
    dbSettings: dbCall("db-settings"),
    dbHistory: dbCall("db-history"),
    dbProfiles: dbCall("db-profiles"),
    dbPlaylists: dbCall("db-playlists"),
    dbSearchHistory: dbCall("db-search-history"),
    dbSubscriptionCache: dbCall("db-subscription-cache"),
    handleChangeView: (n) => onChannel("change-view", (a) => n(a)),
    handleOpenUrl: (n) => { onChannel("open-url", (a) => n(a)); send("app-ready"); },
    handleUpdateSearchInputText: (n) => {
      onChannel("update-search-input-text", (a) => n(a));
      send("search-input-handling-ready");
    },
    handleSyncSettings: syncHandler("sync-settings"),
    handleSyncHistory: syncHandler("sync-history"),
    handleSyncSearchHistory: syncHandler("sync-search-history"),
    handleSyncProfiles: syncHandler("sync-profiles"),
    handleSyncPlaylists: syncHandler("sync-playlists"),
    handleSyncSubscriptionCache: syncHandler("sync-subscription-cache"),
  };

  // Dark theme like the desktop app default
  try {
    const apply = () => { document.documentElement.dataset.systemTheme = "dark"; document.body.dataset.systemTheme = "dark"; };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply, { once: true });
    else apply();
  } catch (e) { /* noop */ }
})();
