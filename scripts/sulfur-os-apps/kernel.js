/* ══════════════════════════════════════════════════════════════════
   SULFUR OS — the whole-project extension kernel
   A Chrome-OS-style desktop environment that runs inside one HTML
   file, launched from veil-offline.html's Arcade. Everything the
   2.2 MB source project ships — the boot chooser, the tab strip,
   the browser toolbar, the new tab page, the app launcher with its
   categories, the app windows, the coin economy (blackjack) —
   recreated as vanilla JS, plus the tunnel: the OS browses
   the real web through the veil engine's WISP pipeline.
   ══════════════════════════════════════════════════════════════════ */
(function () {
"use strict";

/* ── the tunnel: this page lives in an iframe of veil-offline.html;
     the engine's request router accepts {t:'q'} from any frame and
     replies {t:'r'} to the sender — same protocol the proxied pages
     use. Ids 2e6+ keep clear of the engine's own counters. ─────── */
var TUN_RID = 2000000, TUN_PENDING = {};
window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.t !== "r" || typeof d.i !== "number" || d.i < 2000000) return;
    var p = TUN_PENDING[d.i];
    if (!p) return;
    delete TUN_PENDING[d.i];
    clearTimeout(p.tm);
    if (d.e) p.rej(new Error(String(d.e)));
    else p.res(d);
});
function tunFetch(url, opts) {
    opts = opts || {};
    return new Promise(function (res, rej) {
        var i = ++TUN_RID;
        var tm = setTimeout(function () { delete TUN_PENDING[i]; rej(new Error("Timeout")); }, 45000);
        TUN_PENDING[i] = { res: res, rej: rej, tm: tm };
        var o = { headers: Object.assign({
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "accept": "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.9"
        }, opts.headers || {}) };
        if (opts.method) o.method = opts.method;
        parent.postMessage({ t: "q", i: i, url: url, opts: o }, "*");
    });
}
function tunText(url, opts) {
    return tunFetch(url, opts).then(function (r) {
        if (r.s && r.s >= 400) throw new Error("HTTP " + r.s);
        var bin = atob(r.d || "");
        return decodeURIComponent(escape(bin));
    });
}
function tunJson(url, opts) { return tunText(url, opts).then(JSON.parse); }
function tunnelOk() {
    try { return !!parent && parent !== window; } catch (e) { return false; }
}

/* ── persistence: opaque origins block localStorage — try, then
     fall back to memory (and tell the user once, quietly) ───────── */
var store = (function () {
    try { var k = "__s"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return localStorage; }
    catch (e) {
        var m = {};
        return { getItem: function (k) { return k in m ? m[k] : null; },
                 setItem: function (k, v) { m[k] = String(v); },
                 removeItem: function (k) { delete m[k]; } };
    }
})();
function loadJSON(key, fb) { try { return JSON.parse(store.getItem(key) || "null") || fb; } catch (e) { return fb; } }
function saveJSON(key, v) { try { store.setItem(key, JSON.stringify(v)); } catch (e) {} }

/* ── tiny dom kit ──────────────────────────────────────────────── */
function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}
function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}
function icon(name, size) {
    /* inline stroke icons (lucide-ish) — the whole set the OS needs */
    var P = {
        plus: "M12 5v14M5 12h14", x: "M18 6 6 18M6 6l12 12", search: "M21 21l-4.3-4.3m1.8-5.2a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
        home: "m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10",
        back: "m12 19-7-7 7-7M19 12H5", fwd: "m5 12 7-7 7 7M12 19V5", reload: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6",
        grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z", star: "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z",
        clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2", power: "M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0",
        wifi: "M5 12.6a10 10 0 0 1 14 0M8.5 16a5.5 5.5 0 0 1 7 0M12 20h.01", battery: "M15 20h-2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2ZM5 9h2v6H5z",
        volume: "M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7", chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
        code: "m16 18 6-6-6-6M8 6l-6 6 6 6", lock: "M5 11h14v11H5zM8 11V7a4 4 0 1 1 8 0v4", wave: "M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0",
        gamepad: "M6 12h4M8 10v4M15 11h.01M18 13h.01M17.3 5H6.7a4.7 4.7 0 0 0-4.6 5.6l1 5.3a3 3 0 0 0 5.2 1.3L10 15h4l1.7 2.2a3 3 0 0 0 5.2-1.3l1-5.3A4.7 4.7 0 0 0 17.3 5Z",
        coins: "M12 8c3.3 0 6-1.1 6-2.5S15.3 3 12 3 6 4.1 6 5.5 8.7 8 12 8ZM6 5.5v5C6 12 8.7 13 12 13s6-1.1 6-2.5v-5M6 10.5v5C6 17 8.7 18 12 18s6-1.1 6-2.5v-5",
        cards: "M2 7h13v10H2zM15 8.5 20 6v10l-5-2.5", store: "m3 9 1-5h16l1 5M4 9v11h16V9M9 20v-6h6v6",
        user: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
        globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20",
        yt: "M2.5 17a24 24 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49 49 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24 24 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49 49 0 0 1-16.2 0A2 2 0 0 1 2.5 17M10 15l5-3-5-3z",
        play: "m6 4 14 8-14 8z", music: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
        game: "M6 12h4M8 10v4M15 11h.01M18 13h.01M17.3 5H6.7a4.7 4.7 0 0 0-4.6 5.6l1 5.3a3 3 0 0 0 5.2 1.3L10 15h4l1.7 2.2a3 3 0 0 0 5.2-1.3l1-5.3A4.7 4.7 0 0 0 17.3 5Z",
        wrench: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z",
        palette: "M12 22a10 10 0 0 1 0-20c5 0 9 3.6 9 8 0 3-2.5 4-4.5 4H15a2 2 0 0 0-2 2c0 1 .7 1.5.7 2.5S12.7 22 12 22ZM7.5 10.5h.01M12 7h.01M16.5 10.5h.01",
        spark: "m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z",
        weather: "M17.5 19a4.5 4.5 0 1 0-1-8.9 6 6 0 1 0-11 2.9A4 4 0 0 0 6 19z", gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2.1-1.6-2-3.4-2.5 1a7.6 7.6 0 0 0-2-1.2L14.5 2h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.5-1-2 3.4 2.1 1.6a7.4 7.4 0 0 0 0 2.4l-2.1 1.6 2 3.4 2.5-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.5 1 2-3.4-2.1-1.6c.1-.4.1-.8.1-1.2z",
        book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z",
        note: "M4 4h16v12l-4 4H4zM16 20v-4h4M8 8h8M8 12h5", trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6",
        warn: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
        check: "M20 6 9 17l-5-5", send: "m22 2-7 20-4-9-9-4z", shuffle: "M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.6-8.6c.8-1.1 2-1.7 3.3-1.7H22M18 2l4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8M18 14l4 4-4 4"
    };
    var path = P[name];
    if (!path && /^custom:/.test(name)) path = name.slice(7);
    return '<svg viewBox="0 0 24 24" width="' + (size || 16) + '" height="' + (size || 16) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (path || P.globe) + '"/></svg>';
}
function fmtClock(d) {
    var h = d.getHours(), m = d.getMinutes();
    var ap = h < 12 ? "AM" : "PM";
    h = h % 12 || 12;
    return h + ":" + (m < 10 ? "0" : "") + m + " " + ap;
}

/* ── OS state ──────────────────────────────────────────────────── */
var S = {
    booted: false,
    tabs: [],            /* {id, kind:'ntp'|'app'|'web', appId, url, title, el, hist:[], hi:-1} */
    activeId: null,
    seq: 1,
    coins: loadJSON("sulfur:coins", 120),
    owned: loadJSON("sulfur:owned", ["classic"]),
    name: store.getItem("sulfur:name") || "Guest",
    wallpaper: store.getItem("sulfur:wp") || "aurora"
};
var WALLPAPERS = {
    /* each wallpaper: the base gradient + the two ambient blob colors
       that drift behind the glass (see body::before/::after in css) */
    aurora:   { bg: "radial-gradient(120% 90% at 20% 0%, #2a2f5e 0%, #1a1b2e 45%, #0f1015 100%)", a: "#34d399", b: "#f59e0b" },
    dusk:     { bg: "linear-gradient(180deg, #3b2a4a 0%, #1a1b2e 55%, #0f1015 100%)", a: "#c084fc", b: "#fb7185" },
    ember:    { bg: "radial-gradient(100% 80% at 80% 10%, #4a2a1a 0%, #241214 40%, #0d0908 100%)", a: "#fb923c", b: "#ef4444" },
    forest:   { bg: "radial-gradient(120% 90% at 30% 10%, #1a3a2e 0%, #122219 50%, #0a100c 100%)", a: "#4ade80", b: "#14b8a6" },
    mono:     { bg: "linear-gradient(180deg, #232326 0%, #131316 100%)", a: "#a1a1aa", b: "#52525b" },
    midnight: { bg: "radial-gradient(110% 100% at 50% 0%, #101c38 0%, #0c1226 60%, #070a16 100%)", a: "#38bdf8", b: "#34d399" },
    sunset:   { bg: "linear-gradient(165deg, #45283c 0%, #71334a 30%, #b4543a 62%, #2b1a24 100%)", a: "#fb923c", b: "#f472b6" },
    sakura:   { bg: "radial-gradient(120% 100% at 70% 0%, #4a2438 0%, #2c1524 55%, #170d16 100%)", a: "#f9a8d4", b: "#c084fc" },
    abyss:    { bg: "radial-gradient(130% 110% at 40% 100%, #0d3a3a 0%, #0a2229 55%, #061218 100%)", a: "#2dd4bf", b: "#0ea5e9" },
    nebula:   { bg: "radial-gradient(110% 90% at 30% 20%, #34204f 0%, #201436 50%, #100a1e 100%)", a: "#a78bfa", b: "#f0abfc" }
};

/* ── toast ─────────────────────────────────────────────────────── */
var toastTimer = null;
function toast(msg, kind) {
    var t = document.getElementById("soToast");
    if (!t) return;
    t.innerHTML = icon(kind === "ok" ? "check" : kind === "err" ? "warn" : "spark", 15) + "<span>" + esc(msg) + "</span>";
    t.className = "on " + (kind || "info");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ""; }, 3200);
}

/* ── app registry (modules attach to window.SulfurApps) ────────── */
function reg() { return window.SulfurApps || (window.SulfurApps = {}); }

/* the launcher catalog — modules self-register; this decorates any
   missing entries and fixes category order */
function appList() {
    var out = [];
    var R = reg();
    for (var k in R) {
        var a = R[k];
        if (!a || !a.mount) continue;
        out.push(a);
    }
    out.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
    return out;
}

/* ════ BOOT ═══════════════════════════════════════════════════════ */
function boot() {
    document.getElementById("soBootBtn").addEventListener("click", function () {
        var b = document.getElementById("soBoot");
        b.classList.add("spin");
        setTimeout(function () {
            b.classList.add("gone");
            S.booted = true;
            startOS();
            setTimeout(function () { b.remove(); }, 700);
        }, 1250);
    });
    document.getElementById("soBootName").addEventListener("input", function () {
        S.name = this.value.trim() || "Guest";
        store.setItem("sulfur:name", S.name);
    });
    document.getElementById("soBootName").value = S.name;
    var s = document.getElementById("soBootSkip");
    if (s) s.addEventListener("click", function () { document.getElementById("soBootBtn").click(); });
}

/* ════ THE OS ════════════════════════════════════════════════════ */
function startOS() {
    document.body.classList.add("booted");
    applyWallpaper();
    tickClock();
    setInterval(tickClock, 5000);
    var dn = document.getElementById("soDockName").querySelector("span");
    if (dn) dn.textContent = S.name;
    var ntp = newTab("ntp");
    /* open the launcher hint once */
    if (!store.getItem("sulfur:seen")) {
        store.setItem("sulfur:seen", "1");
        toast("Welcome to Sulfur OS — hit the grid button (bottom-right) for every app");
    }
}
function applyWallpaper() {
    var w = WALLPAPERS[S.wallpaper] || WALLPAPERS.aurora;
    document.body.style.background = w.bg;
    document.body.style.backgroundAttachment = "fixed";
    /* the ambient blobs behind the glass pick up the wallpaper's mood */
    document.body.style.setProperty("--wpA", w.a);
    document.body.style.setProperty("--wpB", w.b);
}
function tickClock() {
    var d = new Date();
    var c = document.getElementById("soClock");
    if (c) c.textContent = fmtClock(d);
    var d2 = document.getElementById("soDockClock");
    if (d2) d2.textContent = fmtClock(d);
}

/* ── tabs ─────────────────────────────────────────────────────── */
function tabById(id) { for (var i = 0; i < S.tabs.length; i++) if (S.tabs[i].id === id) return S.tabs[i]; return null; }
function newTab(kind, arg, noFocus) {
    var t = {
        id: S.seq++, kind: kind, appId: kind === "app" ? arg : null,
        url: kind === "web" ? arg : "", title: "New Tab", hist: [], hi: -1
    };
    S.tabs.push(t);
    renderTabstrip();
    if (!noFocus) focusTab(t.id);
    else renderViewport();
    return t;
}
function closeTab(id) {
    var t = tabById(id);
    if (!t) return;
    if (t.cleanup) { try { t.cleanup(); } catch (e) {} }
    var i = S.tabs.indexOf(t);
    S.tabs.splice(i, 1);
    if (!S.tabs.length) { newTab("ntp"); return; }
    if (S.activeId === id) {
        var next = S.tabs[Math.max(0, i - 1)];
        focusTab(next.id);
    } else renderTabstrip();
}
function focusTab(id) {
    S.activeId = id;
    var t = tabById(id);
    renderTabstrip();
    renderViewport();
    if (t && t.kind === "web" && !t.loaded) loadWeb(t, t.url);
}
function renderTabstrip() {
    var strip = document.getElementById("soTabs");
    strip.innerHTML = "";
    S.tabs.forEach(function (t) {
        var b = el("button", "so-tab" + (t.id === S.activeId ? " on" : ""));
        b.type = "button";
        b.setAttribute("aria-label", "switch to " + t.title);
        b.draggable = true;
        var ic = t.kind === "app" ? (reg()[t.appId] || {}).icon :
                 t.kind === "web" ? "globe" : "plus";
        b.innerHTML = '<span class="ti">' + icon(ic === undefined ? "globe" : ic, 13) + "</span>" +
            '<span class="tt">' + esc(t.title.slice(0, 22)) + "</span>" +
            '<span class="tx" role="button" aria-label="close tab">' + icon("x", 12) + "</span>";
        b.addEventListener("click", function (e) {
            if (e.target.closest && e.target.closest(".tx")) { closeTab(t.id); return; }
            focusTab(t.id);
        });
        b.addEventListener("dragstart", function (e) { e.dataTransfer.setData("text/so-tab", String(t.id)); });
        b.addEventListener("drop", function (e) {
            var src = Number(e.dataTransfer.getData("text/so-tab"));
            if (!src || src === t.id) return;
            e.preventDefault();
            var st = tabById(src), gt = tabById(t.id);
            if (!st || !gt) return;
            S.tabs.splice(S.tabs.indexOf(st), 1);
            S.tabs.splice(S.tabs.indexOf(gt), 0, st);
            renderTabstrip();
        });
        b.addEventListener("dragover", function (e) { e.preventDefault(); });
        strip.appendChild(b);
    });
    var add = el("button", "so-tab-add");
    add.type = "button";
    add.title = "New tab";
    add.setAttribute("aria-label", "new tab");
    add.innerHTML = icon("plus", 13);
    add.addEventListener("click", function () { newTab("ntp"); });
    strip.appendChild(add);
}

/* ── the viewport: ntp | app | web ────────────────────────────── */
function renderViewport() {
    var vp = document.getElementById("soViewport");
    var t = tabById(S.activeId);
    vp.innerHTML = "";
    document.getElementById("soAddr").value = t && t.kind === "web" ? t.url : "";
    var back = document.getElementById("soBack"), fwd = document.getElementById("soFwd"), rel = document.getElementById("soRel");
    back.disabled = !t || t.hi <= 0;
    fwd.disabled = !t || t.hi >= (t.hist.length - 1);
    if (!t) return;
    if (t.kind === "ntp") vp.appendChild(ntpPage(t));
    else if (t.kind === "app") vp.appendChild(appWindow(t));
    else vp.appendChild(webPage(t));
}

/* ── NEW TAB PAGE — the Sulfur identity ────────────────────────── */
function ntpPage(t) {
    var w = el("div", "so-ntp");
    var logo = el("div", "so-logo");
    logo.innerHTML = '<span class="mark">Sulfur</span><span class="os">OS</span>';
    w.appendChild(logo);
    var tag = el("p", "so-tag", "the whole web, through the veil.");
    /* splash texts — 75% of NTP views swap the tagline (the user's
       lines, same mechanic as the Veil start page; every new tab
       rolls fresh). 1% gets the special gold "passwords" line. */
    var LINES = ["Your Back", "I know its the best", "happy?", "1+1=11", "woah", "better than the rest", "CHIKEN JOCKEY!!!", "battle royale", "If your enemy's know your next move dont move", "fire hurts- Trust me", "Why did I pick the name veil IDK", "WORDS", "gravity hurts", "verified by me"];
    var SPECIAL = "passwords 5rew21";
    var roll = Math.random();
    if (roll < 0.01) {
        tag.textContent = SPECIAL;
        tag.classList.add("splash", "gold");
    } else if (roll < 0.76) {
        tag.textContent = LINES[Math.floor(Math.random() * LINES.length)];
        tag.classList.add("splash");
    }
    w.appendChild(tag);
    var form = el("form", "so-search");
    form.innerHTML = icon("search", 17) + '<input type="text" placeholder="Search the web or type a URL" aria-label="Search the web or type a URL" autocomplete="off">';
    form.addEventListener("submit", function (e) {
        e.preventDefault();
        var q = form.querySelector("input").value.trim();
        if (!q) return;
        t.kind = "web";
        t.title = q.slice(0, 24);
        t.hist = []; t.hi = -1; t.loaded = false;
        navigateWeb(t, normalizeInput(q));
        renderTabstrip();
    });
    w.appendChild(form);
    var grid = el("div", "so-shortcuts");
    SHORTCUTS.forEach(function (s) {
        var b = el("button", "so-sc");
        b.type = "button";
        b.innerHTML = '<span class="ic" style="--c:' + s.color + '">' + icon(s.icon, 20) + "</span><span>" + esc(s.name) + "</span>";
        b.addEventListener("click", function () { openTarget(s.target); });
        grid.appendChild(b);
    });
    w.appendChild(grid);
    var apps = appList();
    var mine = el("div", "so-mine");
    var mh = el("p", "so-mh", "installed apps");
    mine.appendChild(mh);
    var row = el("div", "so-mine-row");
    apps.slice(0, 10).forEach(function (a) {
        var b = el("button", "so-sc small");
        b.type = "button";
        b.title = a.desc || a.name;
        b.innerHTML = '<span class="ic" style="--c:' + (a.color || "#16a34a") + '">' + icon(a.icon || "spark", 15) + "</span><span>" + esc(a.name) + "</span>";
        b.addEventListener("click", function () { openApp(a.id); });
        row.appendChild(b);
    });
    if (apps.length > 10) {
        var more = el("button", "so-sc small more");
        more.type = "button";
        more.innerHTML = icon("grid", 15) + "<span>all " + apps.length + "</span>";
        more.addEventListener("click", openLauncher);
        row.appendChild(more);
    }
    mine.appendChild(row);
    w.appendChild(mine);
    return w;
}
var SHORTCUTS = [
    { name: "YouTube", icon: "yt", color: "#ff0033", target: "web:https://www.youtube.com" },
    { name: "Web Search", icon: "search", color: "#16a34a", target: "web:https://www.bing.com" },
    { name: "Weather", icon: "weather", color: "#0ea5e9", target: "app:weather" },
    { name: "YouTube Search", icon: "play", color: "#ef4444", target: "app:ytsearch" },
    { name: "Blackjack", icon: "cards", color: "#a855f7", target: "app:blackjack" },
    { name: "Games", icon: "game", color: "#0891b2", target: "launcher" },
    { name: "Tetris", icon: "game", color: "#f59e0b", target: "app:tetris" },
    { name: "Snake", icon: "game", color: "#22c55e", target: "app:snake" }
];
function openTarget(target) {
    if (target === "launcher") { openLauncher(); return; }
    var i = target.indexOf(":");
    var kind = target.slice(0, i), arg = target.slice(i + 1);
    if (kind === "app") openApp(arg);
    else if (kind === "web") {
        var t = tabById(S.activeId);
        if (t && t.kind === "ntp") {
            t.kind = "web"; t.title = arg.replace(/^https?:\/\//, "").slice(0, 24);
            t.hist = []; t.hi = -1; t.loaded = false;
            navigateWeb(t, arg);
            renderTabstrip();
        } else newTab("web", arg);
    }
}

/* ── app windows ──────────────────────────────────────────────── */
function openApp(id) {
    var a = reg()[id];
    if (!a) { toast("That app isn't in this build", "err"); return; }
    var t = newTab("app", id);
    t.title = a.name;
    renderTabstrip();
    return t;
}
function appWindow(t) {
    var a = reg()[t.appId] || {};
    var wrap = el("div", "so-appwin");
    wrap.style.setProperty("--acc", a.color || "#16a34a");
    if (a.w) wrap.style.maxWidth = Math.min(a.w + 40, 1180) + "px";
    var bar = el("div", "so-appbar");
    bar.innerHTML = '<span class="ai">' + icon(a.icon || "spark", 16) + "</span>" +
        '<span class="an">' + esc(a.name || "App") + "</span>" +
        '<span class="ad">' + esc(a.desc || "") + "</span>";
    var xb = el("button", "ax");
    xb.type = "button";
    xb.title = "Close";
    xb.setAttribute("aria-label", "close app");
    xb.innerHTML = icon("x", 14);
    xb.addEventListener("click", function () { closeTab(t.id); });
    bar.appendChild(xb);
    wrap.appendChild(bar);
    var body = el("div", "so-appbody");
    wrap.appendChild(body);
    /* the ctx contract every module speaks */
    var ctx = {
        storage: {
            get: function (k, d) { var v = store.getItem("sulfur:app:" + t.appId + ":" + k); return v == null ? d : v; },
            set: function (k, v) { store.setItem("sulfur:app:" + t.appId + ":" + k, String(v)); }
        },
        toast: toast,
        setTitle: function (title) { t.title = String(title).slice(0, 26) || t.title; renderTabstrip(); },
        close: function () { closeTab(t.id); },
        coins: {
            get: function () { return S.coins; },
            add: function (n) { addCoins(n, "the " + (a.name || "app")); },
            spend: function (n) { return spendCoins(n, a.name || "the app"); }
        },
        tunnel: { text: tunText, json: tunJson, ok: tunnelOk },
        newTab: function (kind, arg) { return newTab(kind, arg); }
    };
    try { a.mount(body, ctx); }
    catch (e) {
        body.innerHTML = '<div class="so-crash">' + icon("warn", 18) + "<b>" + esc(a.name || "The app") + " hit a snag</b><code>" + esc(e && e.message || e) + "</code></div>";
    }
    return wrap;
}

/* ── the browser: toolbar + reader-mode web view ─────────────── */
function normalizeInput(q) {
    q = q.trim();
    if (/^(https?|about):/i.test(q)) return q;
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q) && !/\s/.test(q)) return "https://" + q;
    return "https://www.bing.com/search?q=" + encodeURIComponent(q);
}
function navigateWeb(t, url) {
    if (!/^https?:/i.test(url)) { toast("Only http(s) pages load in the OS browser", "err"); return; }
    t.hist = t.hist.slice(0, t.hi + 1);
    t.hist.push(url);
    t.hi = t.hist.length - 1;
    t.url = url;
    loadWeb(t, url);
    renderTabstrip();
    document.getElementById("soAddr").value = url;
}
function loadWeb(t, url) {
    t.loaded = true;
    var host = document.querySelector(".so-webview[data-for='" + t.id + "']");
    if (!host) { renderViewport(); host = document.querySelector(".so-webview[data-for='" + t.id + "']"); }
    if (!host) return;
    var status = host.querySelector(".wv-status");
    var body = host.querySelector(".wv-body");
    status.innerHTML = icon("reload", 14) + " <span>Loading " + esc(url.replace(/^https?:\/\//, "").slice(0, 44)) + " through the tunnel…</span>";
    status.className = "wv-status loading";
    body.innerHTML = "";
    if (!tunnelOk()) {
        status.className = "wv-status err";
        status.innerHTML = icon("warn", 14) + " <span>No tunnel — the OS browser needs the veil engine (launch Sulfur OS from inside veil-offline.html).</span>";
        return;
    }
    tunText(url).then(function (html) {
        if (tabById(t.id) !== t) return;
        renderReader(host, t, url, html);
    }).catch(function (err) {
        if (tabById(t.id) !== t) return;
        status.className = "wv-status err";
        status.innerHTML = icon("warn", 14) + " <span>" + esc(url.replace(/^https?:\/\//, "").slice(0, 40)) + " didn't answer (" + esc(err && err.message || "unreachable") + ").</span>";
    });
}
function webPage(t) {
    var w = el("div", "so-webview");
    w.setAttribute("data-for", t.id);
    w.innerHTML = '<div class="wv-status loading">' + icon("reload", 14) + " <span>Ready…</span></div>" +
        '<div class="wv-reader wv-body" id="wvBody' + t.id + '"></div>' +
        '<form class="wv-find"><input type="text" placeholder="find in page"><span class="wv-count"></span></form>';
    return w;
}
/* reader-mode renderer: strip scripts, keep semantics, rewrite links */
function renderReader(host, t, url, html) {
    var status = host.querySelector(".wv-status");
    var body = host.querySelector(".wv-body");
    status.className = "wv-status ok";
    status.innerHTML = icon("globe", 14) + " <span>" + esc(url.replace(/^https?:\/\//, "").slice(0, 60)) + "</span>";
    try {
        var doc = new DOMParser().parseFromString(html, "text/html");
        doc.querySelectorAll("script,style,noscript,iframe,svg,link,meta").forEach(function (n) { n.remove(); });
        var base = new URL(url);
        var title = (doc.title || "").trim() || base.hostname;
        t.title = title.slice(0, 26);
        renderTabstrip();
        /* absolutize images (media elements load cross-origin fine) */
        doc.querySelectorAll("img").forEach(function (im) {
            var src = im.getAttribute("src") || "";
            if (!src || /^(data|blob):/i.test(src)) return;
            try { im.src = new URL(src, base).href; } catch (e) { im.remove(); return; }
            im.loading = "lazy";
            if (!im.alt) im.alt = "";
        });
        doc.querySelectorAll("a").forEach(function (a) {
            var href = a.getAttribute("href") || "";
            if (!href || href.charAt(0) === "#") { a.addEventListener("click", function (e) { e.preventDefault(); }); return; }
            var abs;
            try { abs = new URL(href, base).href; } catch (e) { a.remove(); return; }
            if (!/^https?:/i.test(abs)) { a.addEventListener("click", function (e) { e.preventDefault(); }); return; }
            a.setAttribute("data-href", abs);
            a.addEventListener("click", function (e) {
                e.preventDefault();
                navigateWeb(t, abs);
            });
        });
        var inner = doc.body ? doc.body.innerHTML : esc(html.slice(0, 2000));
        body.innerHTML =
            '<h1 class="wv-title">' + esc(title) + "</h1>" +
            '<p class="wv-url">' + icon("globe", 12) + " " + esc(base.hostname) + ' · <button type="button" class="wv-open">open in the veil</button></p>' +
            '<div class="wv-content">' + inner + "</div>";
        var op = body.querySelector(".wv-open");
        if (op) op.addEventListener("click", function () {
            try { parent.__veilShell.engineNavigate(url); }
            catch (e) { toast("The veil shell didn't take the URL — copy it instead"); }
        });
    } catch (e) {
        body.innerHTML = '<p class="wv-p">The page parsed badly (' + esc(e.message) + ") — try the “open in the veil” button.</p>";
    }
}

/* ── launcher overlay ─────────────────────────────────────────── */
function openLauncher() {
    var l = document.getElementById("soLauncher");
    l.classList.add("open");
    renderLauncher("");
    document.getElementById("soLaunchQ").focus();
}
function closeLauncher() {
    document.getElementById("soLauncher").classList.remove("open");
}
function renderLauncher(q) {
    var rail = document.getElementById("soLRail");
    var grid = document.getElementById("soLGrid");
    var cat = document.querySelector("#soLRail .lc.on");
    var curCat = cat ? cat.getAttribute("data-cat") : "all";
    rail.innerHTML = "";
    var cats = [["all", "All", "grid"], ["game", "Games", "game"], ["tool", "Tools", "wrench"], ["creative", "Creative", "palette"], ["media", "Media", "play"]];
    cats.forEach(function (c) {
        var b = el("button", "lc" + (curCat === c[0] ? " on" : ""));
        b.type = "button";
        b.setAttribute("data-cat", c[0]);
        b.innerHTML = icon(c[2], 15) + "<span>" + c[1] + "</span>";
        b.addEventListener("click", function () {
            curCat = c[0];
            document.querySelectorAll("#soLRail .lc").forEach(function (x) { x.classList.remove("on"); });
            b.classList.add("on");
            renderLauncher(q);
        });
        rail.appendChild(b);
    });
    var apps = appList().filter(function (a) {
        if (curCat !== "all" && (a.cat || "tool") !== curCat) return false;
        if (q && (a.name + " " + (a.desc || "")).toLowerCase().indexOf(q.toLowerCase()) === -1) return false;
        return true;
    });
    grid.innerHTML = "";
    if (!apps.length) {
        grid.innerHTML = '<div class="so-lempty">' + icon("search", 20) + "<p>No apps match" + (q ? " “" + esc(q) + "”" : "") + ".</p></div>";
        return;
    }
    apps.forEach(function (a) {
        var b = el("button", "so-lapp");
        b.type = "button";
        b.title = a.desc || a.name;
        b.style.setProperty("--c", a.color || "#16a34a");
        b.innerHTML = '<span class="ic">' + icon(a.icon || "spark", 22) + "</span>" +
            '<span class="nm">' + esc(a.name) + "</span>" +
            '<span class="ds">' + esc((a.desc || "").slice(0, 64)) + "</span>";
        b.addEventListener("click", function () { closeLauncher(); openApp(a.id); });
        grid.appendChild(b);
    });
}

/* ── the coins economy ────────────────────────────────────────── */
function addCoins(n, why) {
    S.coins = Math.max(0, S.coins + (n || 0));
    saveJSON("sulfur:coins", S.coins);
    paintCoins();
    if (n > 0) toast("+" + n + " coins — " + why, "ok");
}
function spendCoins(n, why) {
    if (S.coins < n) { toast("Not enough coins (" + S.coins + "/" + n + ")", "err"); return false; }
    S.coins -= n;
    saveJSON("sulfur:coins", S.coins);
    paintCoins();
    if (why) toast("−" + n + " coins — " + why, "info");
    return true;
}
function paintCoins() {
    var c = document.getElementById("soCoins");
    if (c) c.textContent = S.coins.toLocaleString();
}

/* ── chrome wiring ────────────────────────────────────────────── */
document.getElementById("soBack").addEventListener("click", function () {
    var t = tabById(S.activeId);
    if (!t || t.hi <= 0) return;
    t.hi--;
    t.url = t.hist[t.hi];
    loadWeb(t, t.url);
    document.getElementById("soAddr").value = t.url;
});
document.getElementById("soFwd").addEventListener("click", function () {
    var t = tabById(S.activeId);
    if (!t || t.hi >= t.hist.length - 1) return;
    t.hi++;
    t.url = t.hist[t.hi];
    loadWeb(t, t.url);
    document.getElementById("soAddr").value = t.url;
});
document.getElementById("soRel").addEventListener("click", function () {
    var t = tabById(S.activeId);
    if (!t) return;
    if (t.kind === "web") { t.loaded = false; loadWeb(t, t.url); }
    else renderViewport();
});
document.getElementById("soAddr").addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    var v = this.value.trim();
    if (!v) return;
    var t = tabById(S.activeId);
    if (!t) return;
    if (t.kind === "web") navigateWeb(t, normalizeInput(v));
    else {
        t.kind = "web";
        t.title = v.slice(0, 24);
        t.hist = []; t.hi = -1; t.loaded = false;
        navigateWeb(t, normalizeInput(v));
        renderTabstrip();
    }
});
document.getElementById("soHome").addEventListener("click", function () {
    var t = tabById(S.activeId);
    if (t) { t.kind = "ntp"; t.title = "New Tab"; renderTabstrip(); renderViewport(); }
});
document.getElementById("soDockGrid").addEventListener("click", openLauncher);
document.getElementById("soLaunchX").addEventListener("click", closeLauncher);
document.getElementById("soLauncher").addEventListener("click", function (e) {
    if (e.target === this) closeLauncher();
});
document.getElementById("soLaunchQ").addEventListener("input", function () {
    renderLauncher(this.value.trim().toLowerCase());
});
document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeLauncher();
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        openLauncher();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "t") {
        e.preventDefault();
        newTab("ntp");
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "w") {
        e.preventDefault();
        if (S.activeId) closeTab(S.activeId);
    }
});
/* wallpaper picker inside settings chip */
document.getElementById("soWp").addEventListener("click", function () {
    var keys = Object.keys(WALLPAPERS);
    var i = keys.indexOf(S.wallpaper);
    S.wallpaper = keys[(i + 1) % keys.length];
    store.setItem("sulfur:wp", S.wallpaper);
    applyWallpaper();
    toast("Wallpaper: " + S.wallpaper);
});

/* the OS bridge apps can call (open apps, tabs, toasts) */
window.__sulfurOS = { openApp: openApp, newTab: newTab, toast: toast };
paintCoins();
boot();
})();
