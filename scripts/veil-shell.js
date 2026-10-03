/* ═══════════════════════════════════════════════════════════════════
   Veil shell runtime — the site's app logic on the engine's bones.

   The engine (GUST/WISP tunnel, libcurl WASM) keeps its own hidden
   chrome; this shell drives it through those hidden controls:
     navigate  → set #url value + click #go
     back/fwd  → click #back / #fwd
     reload    → click #reload
     new tab   → click #newTab
     home      → click #home (shows the newtab → we show ours)
     tabs      → mirror #tabStrip .tab[data-tab-id] elements
     URL       → value-setter hook on #url (+ poll)
     loading   → #progressWrap .hidden observer
     newtab    → #newtab.active observer
   ═══════════════════════════════════════════════════════════════════ */
(function () {
"use strict";

/* ── tiny helpers ─────────────────────────────────────────────── */
var $ = function (id) { return document.getElementById(id); };
/* HTML-tokenizer safety: this file's text is scanned by the HTML parser
   BEFORE JS ever runs — a raw comment-opener sequence inside a string,
   regex or comment flips the tokenizer into "escaped" state, and a raw
   script-open sequence after that goes "double escaped", where the real
   end-tag of this script no longer fires: the rest of the 159MB document
   gets swallowed as script text and the shell never boots (spent an
   evening on that one). Rule: build those sequences from pieces —
   CMT_OPEN / CMT_CLOSE / TAG_S — and never type them out. */
var CMT_OPEN = "<!" + "--";
var CMT_CLOSE = "--" + ">";
var TAG_S = "<scr" + "ipt";
var LS = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
};
function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}
/* ── the download password gate ──────────────────────────────────
   Every /api/offline download (the base file AND each extension
   pack) requires the password — the origin checks ?pw= before a
   byte streams. The shell asks once, verifies against the origin,
   remembers it per device, then appends &pw= to every gated link. */
var DL_PW_KEY = "veil:dl:pw";
function veilDlPw() { return LS.get(DL_PW_KEY) || ""; }
function veilDlGo(url, name) {
    var pw = veilDlPw();
    if (pw) {
        window.open(url + (url.indexOf("?") === -1 ? "?" : "&") + "pw=" + encodeURIComponent(pw), "_blank", "noopener");
        toast("downloading " + (name || "the pack") + "…");
        return;
    }
    veilDlAsk(url, name);
}
function veilDlAsk(url, name) {
    if ($("veilDlGate")) return; /* one prompt at a time */
    var wrap = el("div");
    wrap.id = "veilDlGate";
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(9,10,12,.62);backdrop-filter:blur(3px)";
    var card = el("div");
    card.style.cssText = "width:min(340px,calc(100vw - 48px));padding:22px;border-radius:16px;border:1px solid rgba(52,211,153,.28);background:linear-gradient(160deg,rgba(24,26,33,.97),rgba(15,16,21,.97));box-shadow:0 30px 80px rgba(0,0,0,.6);color:#e4e4e7;font-family:inherit";
    var hd = el("p");
    hd.style.cssText = "margin:0;font-size:14px;font-weight:700;color:#fafafa";
    hd.textContent = "downloads are locked";
    card.appendChild(hd);
    var sub = el("p");
    sub.style.cssText = "margin:7px 0 16px;font-size:12px;line-height:1.5;color:#a1a1aa";
    sub.textContent = "the offline file and every extension pack share one password — enter it once, this device remembers.";
    card.appendChild(sub);
    var row = el("div");
    row.style.cssText = "display:flex;gap:8px";
    var inp = el("input");
    inp.type = "password";
    inp.placeholder = "password";
    inp.setAttribute("aria-label", "Download password");
    inp.autocomplete = "off";
    inp.spellcheck = false;
    inp.style.cssText = "flex:1;min-width:0;height:38px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#fafafa;padding:0 12px;font-size:13px;outline:none";
    row.appendChild(inp);
    var go = el("button");
    go.type = "button";
    go.textContent = "unlock";
    go.style.cssText = "height:38px;padding:0 16px;border:0;border-radius:10px;background:#34d399;color:#052e22;font-weight:700;font-size:12.5px;cursor:pointer";
    row.appendChild(go);
    card.appendChild(row);
    var msg = el("p");
    msg.hidden = true;
    msg.style.cssText = "margin:10px 0 0;font-size:11.5px;color:#fbbf24";
    card.appendChild(msg);
    var close = function () { wrap.remove(); };
    wrap.addEventListener("click", function (ev) { if (ev.target === wrap) close(); });
    var attempt = function () {
        var val = inp.value.trim();
        if (!val) { inp.focus(); return; }
        go.disabled = true;
        go.textContent = "checking…";
        msg.hidden = true;
        fetch(VEIL_ORIGIN + "/api/offline?verify=1&pw=" + encodeURIComponent(val), { cache: "no-store" })
            .then(function (r) { return r.ok ? r.json() : { ok: false }; })
            .then(function (d) {
                if (d && d.ok) {
                    LS.set(DL_PW_KEY, val);
                    close();
                    veilDlGo(url, name);
                } else {
                    go.disabled = false;
                    go.textContent = "unlock";
                    msg.hidden = false;
                    msg.textContent = "wrong password — downloads stay locked";
                    inp.select();
                }
            })
            .catch(function () {
                go.disabled = false;
                go.textContent = "unlock";
                msg.hidden = false;
                msg.textContent = "couldn't reach the origin — check the connection";
            });
    };
    go.addEventListener("click", attempt);
    inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); attempt(); } });
    card.addEventListener("keydown", function (ev) { if (ev.key === "Escape") close(); });
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    setTimeout(function () { inp.focus(); }, 30);
}
/* ── Birth origin: stamped at download time (offline-download.tsx swaps
   the "__VEIL_ORIGIN__" literal for the site the file was born from).
   The online catalogs (live + 4K wallpapers) and Veil AI are served by
   that origin; everything embedded (pack, themes, arcade CDN) works
   without it. */
var VEIL_ORIGIN = "__VEIL_ORIGIN__";
/* unstamped copies (served statically, copied around) have no birth
   origin — the literal itself must read as "none" or every origin-
   gated feature would build garbage URLs. The regex avoids spelling
   the literal out again so origin-stamping (which swaps the full
   literal for the real origin) can't accidentally neutralize itself. */
if (/^__VEIL/.test(VEIL_ORIGIN)) VEIL_ORIGIN = "";
/* Absolute http(s) URL → same-origin-routed veil URL on the birth
   origin (mirrors the website's routeUrl). Media elements (<img>/<video>)
   load these without CORS; fetch() works via the Origin:null hatch. */
function veilRoute(abs) {
    var s = String(abs || "");
    var m = /^(https?):\/\/([^\/?#]+)([^#]*)?$/i.exec(s);
    if (!m || !VEIL_ORIGIN) return s;
    return VEIL_ORIGIN + "/api/p/" + m[1] + "/" + m[2] + (m[3] || "/");
}
function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}

/* ── Lucide icon library (inline, stroke) ─────────────────────── */
var ICONS = {
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1"/>',
    bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
    joypad: '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    dices: '<rect width="12" height="12" x="2" y="2" rx="2" ry="2"/><rect width="12" height="12" x="10" y="10" rx="2" ry="2"/><path d="M22 3h.01"/><path d="M14.5 14.5h.01"/><path d="M18 18h.01"/><path d="M22 7h.01"/><path d="M7 22h.01"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    spark: '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>',
    chevup: '<path d="m18 15-6-6-6 6"/>',
    chevdown: '<path d="m6 9 6 6 6-6"/>',
    back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    fwd: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    reload: '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    max: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    min: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    video: '<path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2" ry="2"/>',
    desktop: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    dl: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    square: '<rect width="12" height="12" x="6" y="6" rx="1"/>',
    square: '<rect width="12" height="12" x="6" y="6" rx="1"/>',
    kbd: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    waves: '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    "cloud-sun": '<path d="M12 2v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="M20 12h2"/><path d="m19.07 4.93-1.41 1.41"/><path d="M15.947 12.65a4 4 0 0 0-2.525-5.548"/><path d="M13.4 21H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 0 1 0 9h-4.1"/>',
    "cloud-moon": '<path d="M13 22a5 5 0 0 1-5-5 4.9 4.9 0 0 1 1.3-3.35A5.57 5.57 0 0 1 10.4 8a6.62 6.62 0 0 1 .17-1.5A6 6 0 0 0 18.5 13h.4a4.5 4.5 0 0 1 .4 9"/>',
    "cloud-rain": '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/>',
    "cloud-snow": '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M8 15h.01"/><path d="M8 19h.01"/><path d="M12 17h.01"/><path d="M12 21h.01"/><path d="M16 15h.01"/><path d="M16 19h.01"/>',
    "cloud-drizzle": '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M8 19v1"/><path d="M8 14v1"/><path d="M16 19v1"/><path d="M16 14v1"/><path d="M12 21v1"/><path d="M12 16v1"/>',
    "cloud-fog": '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="M16 5h.01"/>',
    "cloud-lightning": '<path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973"/><path d="m13 12-3 5h4l-3 5"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    gear: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
    link2: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
    panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="m9 14 3-3 3 3"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
    archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
    package: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    blocks: '<rect width="7" height="7" x="14" y="3" rx="1"/><path d="M10 21V8a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1"/><path d="M6 21V10"/><path d="M10 14h4"/><path d="M10 18h4"/>',
    clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    calc: '<rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    /* toolkit app icons (notes/swap/braces) + the dock Upload button */
    notes: '<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11l5-5V5a2 2 0 0 0-2-2h-3Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/><path d="M8 8h2"/><path d="M8 12h6"/>',
    swap: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
    braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    grid2: '<path d="M3 3h18v18H3z"/><path d="M3 12h18"/><path d="M12 3v18"/>',
    worm: '<path d="M4 12a4 4 0 0 1 4-4h6a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h7"/><circle cx="17.5" cy="8.5" r=".5"/>',
    columns: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/>',
    bomb: '<circle cx="10.5" cy="14.5" r="6.5"/><path d="M14.5 10.5 19 6"/><path d="m17.5 4.5 2 2"/>',
    brush: '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-1.45 1.78-1.95 2.28 1.08 1.1 2.44 2.02 3.95 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.28z"/>',
    pen: '<path d="M21.17 6.81a2.82 2.82 0 0 0-3.98-3.98L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/>',
    filetext: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
    key: '<path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
    palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    /* weather pin + hide-UI (zen) buttons */
    pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'
};
function iconSVG(name, cls) {
    var body = ICONS[name] || ICONS.alert;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="luc ' + (cls || "") + '">' + body + "</svg>";
}
(function hydrateIcons(root) {
    (root || document).querySelectorAll("i[data-icon]").forEach(function (i) {
        i.outerHTML = iconSVG(i.getAttribute("data-icon"), i.className || "");
    });
})();

/* ═══ 1. ENGINE BRIDGE ═══════════════════════════════════════ */
var gUrl = null, gGo = null, gBack = null, gFwd = null, gReload = null,
    gHome = null, gNewTab = null, gStrip = null, gNewtab = null,
    gProgressWrap = null;
var internalSet = false;

/* ── Per-viewer identity (server-state isolation) ──────────────
   The FreeTube program at the birth origin gives every visitor their own
   program process — searches, watch history, playlists and settings are
   private, never shared. The key: this browser's random anonymous id in
   localStorage "veil:viewer" (the SAME key the website uses, so a copy of
   the file opened from the site's origin continues the same sandbox),
   stamped on the program frame as ?vv= (cross-origin frames can't ride the
   site's first-party cookie). No personal data — an opaque random id. */
function veilViewerId() {
    try {
        var id = LS.get("veil:viewer");
        if (!id || !/^[A-Za-z0-9_-]{6,64}$/.test(String(id))) {
            id = String((window.crypto && crypto.randomUUID) ? crypto.randomUUID()
                : ("v-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)));
            LS.set("veil:viewer", id);
        }
        return id;
    } catch (e) { return null; }
}
function withViewerStamp(url) {
    var id = veilViewerId();
    if (!id) return url;
    var m = /^([^#]*)(#[\s\S]*)?$/.exec(String(url));
    if (!m) return url;
    return m[1] + (m[1].indexOf("?") >= 0 ? "&" : "?") + "vv=" + encodeURIComponent(id) + (m[2] || "");
}

function findEngine() {
    gUrl = $("url"); gGo = $("go"); gBack = $("back"); gFwd = $("fwd");
    gReload = $("reload"); gHome = $("home"); gNewTab = $("newTab");
    gStrip = $("tabStrip"); gNewtab = $("newtab");
    gProgressWrap = $("progressWrap");
    return !!(gUrl && gGo && gNewtab);
}

/* the website's normalizeInput — the engine follows Settings › Appearance
   (localStorage "veil:search-engine"); Bing stays the default because it
   renders server-side and answers datacenter IPs. */
var SEARCH_ENGINES = {
    bing: { label: "Bing", host: "bing.com", make: function (q) { return "https://www.bing.com/search?q=" + encodeURIComponent(q); } },
    duckduckgo: { label: "DuckDuckGo", host: "duckduckgo.com", make: function (q) { return "https://duckduckgo.com/?q=" + encodeURIComponent(q); } },
    google: { label: "Google", host: "google.com", make: function (q) { return "https://www.google.com/search?q=" + encodeURIComponent(q); } },
    brave: { label: "Brave", host: "search.brave.com", make: function (q) { return "https://search.brave.com/search?q=" + encodeURIComponent(q); } }
};
function searchEngineId() {
    var id = LS.get("veil:search-engine");
    return (id && SEARCH_ENGINES[id]) ? id : "bing";
}
function normalizeInput(raw) {
    var input = String(raw || "").trim();
    if (!input) return null;
    if (/^https?:\/\//i.test(input)) return input;
    var looksLikeDomain = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d+)?([/?#].*)?$/i.test(input);
    if (looksLikeDomain && !input.includes(" ")) return "https://" + input;
    return SEARCH_ENGINES[searchEngineId()].make(input);
}

/* ── Veil-local programs (mirror of the site's shared.ts routing) ──
   freetube.veil.local / grayjay.veil.local are pseudo-hosts: in the
   FILE they resolve to the birth origin's own /ft/ and /web/ programs
   (the origin serves the real apps). No birth origin → friendly toast. */
function veilAppUrl(raw) {
    var s = String(raw || "");
    var m = /^https?:\/\/([^\/?#]+)([^#]*)(#.*)?$/i.exec(s);
    if (!m) return null;
    var host = m[1].toLowerCase();
    var path = m[2] || "/";
    var hash = m[3] || "";
    if (!/\.veil\.local$/i.test(host)) return null;
    if (!VEIL_ORIGIN) return { noOrigin: true };
    if (/^freetube\.veil\.local$/i.test(host)) {
        var h = hash.replace(/^#\/?/, "");
        return { url: VEIL_ORIGIN + "/ft/" + (h ? "#/" + h.replace(/^\//, "") : ""), label: "freetube.veil.local" };
    }
    if (/^grayjay\.veil\.local$/i.test(host)) {
        return { url: VEIL_ORIGIN + "/web/index.html" + (hash || ""), label: "grayjay.veil.local" };
    }
    return { url: VEIL_ORIGIN + "/ft/", label: "freetube.veil.local" };
}
/* Real YouTube URL → the FreeTube program's hash route (mirrors the
   site's mapYouTubeToFreeTube). Returns null for non-YouTube URLs. */
function mapYouTubeToFreeTube(raw) {
    var u;
    try { u = new URL(raw); } catch (e) { return null; }
    var yt = /(^|\.)((youtube\.com|youtu\.be|youtube-nocookie\.com))$/i.test(u.hostname) ||
        (/^m\./i.test(u.hostname) && /(^|\.)youtube\.com$/i.test(u.hostname));
    if (!yt) return null;
    var v = u.searchParams.get("v");
    var watch = v ||
        (/youtu\.be$/i.test(u.hostname) && u.pathname.length > 1 ? u.pathname.slice(1).split("/")[0] : null) ||
        (/^\/embed\//.test(u.pathname) ? u.pathname.replace(/^\/embed\//, "").split("/")[0] : null) ||
        (/^\/shorts\//.test(u.pathname) ? u.pathname.replace(/^\/shorts\//, "").split("/")[0] : null);
    if (watch) return "https://freetube.veil.local/#/watch/" + encodeURIComponent(watch);
    if (/^\/results$|^\/search$/.test(u.pathname)) {
        var q = u.searchParams.get("search_query") || u.searchParams.get("q");
        if (q) return "https://freetube.veil.local/#/search/" + encodeURIComponent(q);
    }
    var ch = /^\/channel\/(UC[\w-]+)/.exec(u.pathname);
    if (ch) return "https://freetube.veil.local/#/channel/" + ch[1];
    if (/^\/(c|user|@)/.test(u.pathname)) return "https://freetube.veil.local/";
    if (u.pathname === "/" || u.pathname === "") return "https://freetube.veil.local/";
    return null;
}

function engineNavigate(input) {
    var target = normalizeInput(input);
    if (!target || !gGo) return;
    /* Veil-local programs + real YouTube URLs → the FreeTube/GrayJay
       programs (served by the birth origin), exactly like the site. */
    var app = veilAppUrl(target);
    if (app === null) {
        var mapped = mapYouTubeToFreeTube(target);
        if (mapped) app = veilAppUrl(mapped);
    }
    if (app && app.noOrigin) {
        toast("The programs live at the file's birth origin — re-download Veil.html to use FreeTube here.");
        return;
    }
    if (app && app.url) { openApp(app, target); return; }
    closeApp(true);
    internalSet = true;
    try { gUrl.value = target; } finally { internalSet = false; }
    gGo.click();
}

/* ── Veil programs (direct birth-origin frame) ──────────────────────
   The engine browses through public WISP relays — they can never reach
   the birth origin's own programs (localhost/sandbox loopback), which
   used to leave FreeTube loading forever. Instead the program opens in
   its own full-screen frame loaded straight from the origin, exactly
   like the website does; the bar, tabs and Esc stay in charge. */
var appOpen = false, appInfo = null, appLoadTimer = null, appFailTimer = null;
function appEls() { return { root: $("veilApp"), frame: $("veilAppFrame") }; }
function openApp(app, pseudoUrl) {
    var els = appEls();
    if (!els.root || !els.frame) return;
    var isGrayjay = /grayjay/i.test(app.label || "");
    appInfo = app;
    appOpen = true;
    var wasNtp = htmlEl.classList.contains("veil-ntp");
    htmlEl.classList.remove("veil-ntp");
    setBarOpen(false);
    closeAllSections();
    els.root.classList.add("open");
    $("veilAppTitle").textContent = isGrayjay ? "GrayJay" : "FreeTube";
    $("veilAppHost").textContent = app.label || "program.veil.local";
    $("veilAppBadge").textContent = isGrayjay ? "CREATORS" : "PRIVATE TUBE";
    var ic = $("veilAppIcon");
    if (ic) ic.innerHTML = iconSVG(isGrayjay ? "globe" : "video", "");
    var fail = $("veilAppFail");
    if (fail) fail.hidden = true;
    /* load cover: black + emerald spinner (the boot-screen look) */
    var cover = $("veilAppLoad");
    if (cover) { cover.classList.add("on"); cover.style.display = ""; }
    clearTimeout(appLoadTimer);
    appLoadTimer = setTimeout(function () {
        if (appOpen && cover && cover.classList.contains("on")) showAppFail();
    }, 25000);
    els.frame.onload = function () {
        clearTimeout(appLoadTimer);
        clearTimeout(appFailTimer);
        if (cover) cover.classList.remove("on");
        /* hide the cover's tail */
        setTimeout(function () { if (cover && !cover.classList.contains("on")) cover.style.display = "none"; }, 320);
    };
    try { if (els.frame.contentWindow) els.frame.contentWindow.stop(); } catch (e) { /* keep going */ }
    /* FreeTube gets the viewer stamp (its service isolates per visitor);
       GrayJay's own server ignores it — leave that frame URL untouched. */
    els.frame.src = isGrayjay ? app.url : withViewerStamp(app.url);
    /* URL pill + a history record for the shell's own recents */
    var pill = $("veilUrlInput");
    var showUrl = pseudoUrl && /^https?:/i.test(pseudoUrl) ? pseudoUrl : (app.label ? "https://" + app.label + "/" : app.url);
    if (pill && showUrl) pill.value = showUrl;
    try { $("veilUrlHost").textContent = (app.label || "").replace(/^https?:\/\//, ""); } catch (e) {}
    if (showUrl && !wasNtp) recordVisit(showUrl);
    else if (showUrl && wasNtp) recordVisit(showUrl);
    updateChrome();
}
function showAppFail() {
    var fail = $("veilAppFail");
    if (!fail) return;
    var cover = $("veilAppLoad");
    if (cover) cover.classList.remove("on");
    fail.hidden = false;
    $("veilAppFailMsg").textContent = "The program's origin did not answer — it may be offline, or this copy of the file has no reachable birth origin.";
}
function closeApp(silent) {
    if (!appOpen) return;
    appOpen = false;
    appInfo = null;
    clearTimeout(appLoadTimer);
    clearTimeout(appFailTimer);
    var els = appEls();
    if (els.root) els.root.classList.remove("open");
    if (els.frame) { try { els.frame.src = "about:blank"; } catch (e) {} }
    var fail = $("veilAppFail");
    if (fail) fail.hidden = true;
    /* hand the URL pill back to the engine's real page */
    onEngineUrl(lastEngineUrl);
    syncMode();
    updateChrome();
}
(function wireAppFrame() {
    var root = $("veilApp");
    if (!root) return;
    $("veilAppClose").addEventListener("click", function () { closeApp(); });
    $("veilAppReload").addEventListener("click", function () {
        if (!appInfo) return;
        var cover = $("veilAppLoad");
        if (cover) { cover.classList.add("on"); cover.style.display = ""; }
        var fail = $("veilAppFail");
        if (fail) fail.hidden = true;
        var f = $("veilAppFrame");
        try { if (f.contentWindow) f.contentWindow.location.reload(); } catch (e) { f.src = appInfo.url; }
        clearTimeout(appLoadTimer);
        appLoadTimer = setTimeout(function () {
            if (appOpen && cover && cover.classList.contains("on")) showAppFail();
        }, 25000);
    });
    $("veilAppFull").addEventListener("click", function () { toggleFullscreen(); });
    $("veilAppRetry").addEventListener("click", function () {
        if (appInfo) openApp(appInfo, $("veilUrlInput") && $("veilUrlInput").value || null);
    });
    $("veilAppGiveUp").addEventListener("click", function () { closeApp(); });
})();

/* ═══ 2. STATE + MODE ═════════════════════════════════════════ */
var htmlEl = document.documentElement;
htmlEl.classList.add("veil-shell-on");
htmlEl.classList.add("veil-ntp");
LS.set("gust:tutorial:v1", "done"); /* the engine's tutorial never shows */

var barOpen = false;
function setBarOpen(open) {
    barOpen = open;
    htmlEl.classList.toggle("veil-bar-open", open);
    $("veilBar").classList.toggle("inert", !open);
    if (open) {
        requestAnimationFrame(function () { $("veilUrlInput").focus(); });
    } else {
        $("veilUrlInput").blur();
    }
    updateChrome();
}
function toggleBar() { setBarOpen(!barOpen); }

function isSectionOpen() {
    return !!document.querySelector(".veil-sec.open, #veilTitle.open, #veilLb.open");
}
function anySection() { return !!document.querySelector(".veil-sec.open"); }
function closeAllSections() {
    document.querySelectorAll(".veil-sec.open").forEach(function (s) { s.classList.remove("open"); });
}

function updateChrome() {
    var ntp = htmlEl.classList.contains("veil-ntp");
    var full = !!document.fullscreenElement;
    var corner = $("veilCorner"), nudge = $("veilFsNudge");
    corner.classList.toggle("show", !ntp && !barOpen);
    nudge.classList.toggle("show", !ntp && !barOpen && !full && !isSectionOpen() && !appOpen);
    /* Wallpaper behind translucent app sections: the start-page CONTENT
       fades out whenever a full-screen layer owns the viewport (open
       section, lightbox, running game, browsing app) while the wallpaper
       backdrop keeps painting through the section's scrim. The backdrop
       VIDEO pauses only under the heavy/opaque layers — the wallpapers
       gallery (it streams its own hover previews), the lightbox, a
       running game, or the browsing app. A paused <video> still paints
       its frame, so the background never blanks; every other section
       (History, Music, Settings, AI, Links, Keys) keeps the live
       wallpaper moving. */
    var covered = isSectionOpen() || appOpen;
    var heavy = !!document.querySelector("#veilSecWp.open, #veilLb.open, #veilTitle.open") || appOpen;
    var nt = $("veilNt");
    if (nt) nt.classList.toggle("covered", covered);
    var vid = $("veilNtVid");
    if (vid) {
        try {
            if (heavy) {
                if (!vid.paused) vid.pause();
            } else if (vid.style.display !== "none" && vid.src && vid.paused) {
                var pr = vid.play();
                if (pr && pr.catch) pr.catch(function () {});
            }
        } catch (e) { /* never let chrome sync break the shell */ }
    }
}

function syncMode() {
    var ntp = !!(gNewtab && gNewtab.classList.contains("active"));
    var was = htmlEl.classList.contains("veil-ntp");
    if (ntp !== was) htmlEl.classList.toggle("veil-ntp", ntp);
    if (!ntp && barOpen) { /* keep bar while browsing */ }
    if (ntp) setBarOpen(false);
    updateChrome();
}

/* ═══ 3. TAB MIRROR ═══════════════════════════════════════════ */
function syncTabs() {
    if (!gStrip) return;
    var gTabs = gStrip.querySelectorAll(".tab[data-tab-id]");
    var wrap = $("veilTabs");
    wrap.classList.toggle("multi", gTabs.length > 1);
    wrap.classList.toggle("solo", gTabs.length <= 1);
    var frag = document.createDocumentFragment();
    var activeTitle = "";
    gTabs.forEach(function (gt) {
        var id = gt.getAttribute("data-tab-id");
        var active = gt.classList.contains("active");
        var titleEl = gt.querySelector(".tab-title");
        var title = (titleEl && titleEl.textContent) || "New Tab";
        if (active) activeTitle = title;
        var t = el("div", "veil-tab" + (active ? " on" : ""));
        t.setAttribute("role", "tab");
        t.setAttribute("aria-selected", active ? "true" : "false");
        t.setAttribute("data-gid", id);
        /* favicon: reuse the engine's rendered icon (img) or a letter tile */
        var fi = el("span", "fi");
        var img = gt.querySelector(".tab-icon img");
        if (img && img.src) {
            var im = el("img");
            im.src = img.src; im.alt = "";
            im.onerror = function () { im.remove(); fi.classList.add("ltr"); };
            fi.appendChild(im);
        } else {
            fi = el("span", "fi ltr");
            fi.textContent = (title || "?").charAt(0).toUpperCase();
        }
        t.appendChild(fi);
        var tt = el("span", "tt", title || "New tab");
        t.appendChild(tt);
        var x = el("span", "x");
        x.setAttribute("role", "button");
        x.setAttribute("aria-label", "Close tab");
        x.title = "Close tab";
        x.innerHTML = iconSVG("x", "luc-14");
        x.addEventListener("click", function (e) {
            e.stopPropagation();
            var gx = gt.querySelector(".tab-close");
            if (gx) gx.click(); else gt.remove();
        });
        t.appendChild(x);
        t.addEventListener("click", function () {
            gt.click();
        });
        t.addEventListener("mousedown", function (e) {
            if (e.button === 1) {
                e.preventDefault();
                var gx = gt.querySelector(".tab-close");
                if (gx) gx.click();
            }
        });
        frag.appendChild(t);
    });
    wrap.innerHTML = "";
    wrap.appendChild(frag);
    /* newtab's corner button a11y + active tab title for history */
    if (activeTitle) recordTitle(activeTitle);
}

/* ═══ 4. URL SYNC ══════════════════════════════════════════════ */
var editingUrl = false;
var lastEngineUrl = "";
function onEngineUrl(v) {
    if (editingUrl || internalSet) { lastEngineUrl = v; return; }
    lastEngineUrl = v;
    var pill = $("veilUrlInput");
    var show = v && v.indexOf("veil://") === 0 ? "" : v;
    if (pill.value !== show) pill.value = show;
    try {
        $("veilUrlHost").textContent = v && v.indexOf("veil://") !== 0 ? new URL(v).hostname : "";
    } catch (e) { $("veilUrlHost").textContent = ""; }
    recordVisit(v);
}
function hookUrlValue() {
    if (!gUrl) return;
    var desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    try {
        Object.defineProperty(gUrl, "value", {
            get: function () { return desc.get.call(this); },
            set: function (v) { desc.set.call(this, v); onEngineUrl(desc.get.call(this)); },
            configurable: true
        });
    } catch (e) { /* fall back to polling */ }
    setInterval(function () {
        if (!gUrl) return;
        var v = gUrl.value;
        if (v !== lastEngineUrl) onEngineUrl(v);
    }, 600);
}

/* ═══ 5. HISTORY (own, tiny) ═══════════════════════════════════ */
var HIST_KEY = "veil:history:v1";
function readHist() {
    try {
        var a = JSON.parse(LS.get(HIST_KEY) || "[]");
        return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
}
function writeHist(a) { LS.set(HIST_KEY, JSON.stringify(a.slice(0, 24))); }
var pendingVisitUrl = "";
function recordVisit(url) {
    if (!url || url.indexOf("veil://") === 0) return;
    pendingVisitUrl = url;
    var list = readHist();
    var host = "";
    try { host = new URL(url).hostname; } catch (e) {}
    var hit = list.find(function (v) { return v.url === url; });
    var now = new Date().toISOString();
    if (hit) { hit.at = now; hit.n = (hit.n || 1) + 1; }
    else list.unshift({ url: url, host: host, title: host, at: now, n: 1 });
    writeHist(list);
    renderRecent();
    renderHistSection();
}
function recordTitle(title) {
    if (!pendingVisitUrl || !title || title === "Loading…" || title === "New Tab") return;
    var list = readHist();
    var hit = list.find(function (v) { return v.url === pendingVisitUrl; });
    if (hit && hit.title !== title) {
        hit.title = title;
        writeHist(list);
        renderRecent();
        renderHistSection();
    }
}
function hostOf(u) { try { return new URL(u).hostname; } catch (e) { return u; } }
function timeAgo(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return "";
    var s = Math.max(1, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return s + "s ago";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    var h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    var d = Math.floor(h / 24);
    if (d < 30) return d + "d ago";
    return new Date(iso).toLocaleDateString();
}
function letterTile(host, cls) {
    var t = el("span", cls || "fv");
    t.textContent = (host || "?").replace(/^www\./, "").charAt(0).toUpperCase();
    return t;
}
function renderRecent() {
    var wrap = $("veilRecent"), grid = $("veilRecentGrid");
    var list = readHist().slice(0, 4);
    wrap.style.display = list.length ? "" : "none";
    grid.innerHTML = "";
    list.forEach(function (v) {
        var card = el("button", "card");
        card.type = "button";
        card.appendChild(letterTile(v.host));
        var tx = el("span", "tx");
        var tt = el("span", "tt", v.title || v.url.replace(/^https?:\/\//, ""));
        var ss = el("span", "ss", v.host + " · " + timeAgo(v.at) + (v.n > 1 ? " · " + v.n + "×" : ""));
        tx.appendChild(tt); tx.appendChild(ss);
        card.appendChild(tx);
        card.addEventListener("click", function () { engineNavigate(v.url); });
        grid.appendChild(card);
    });
}
function renderHistSection() {
    var listEl = $("veilHistList"), cnt = $("veilHistCount");
    if (!listEl) return;
    var list = readHist();
    cnt.textContent = list.length + " sites";
    listEl.innerHTML = "";
    if (!list.length) {
        var empty = el("div", "loadbox warn");
        empty.innerHTML = iconSVG("history", "") + "<div>Nothing yet — the veil keeps your steps private, but it remembers where you've been this session.</div>";
        listEl.appendChild(empty);
        return;
    }
    list.forEach(function (v) {
        var row = el("div", "veil-hist-row");
        row.setAttribute("role", "button");
        row.tabIndex = 0;
        row.appendChild(letterTile(v.host));
        var tx = el("span", "tx");
        tx.appendChild(el("span", "tt", v.title || v.url.replace(/^https?:\/\//, "")));
        tx.appendChild(el("span", "ss", v.host + " · " + timeAgo(v.at) + (v.n > 1 ? " · " + v.n + "×" : "")));
        row.appendChild(tx);
        var del = el("span", "del");
        del.innerHTML = iconSVG("x", "luc-14");
        del.setAttribute("role", "button");
        del.title = "Remove";
        del.addEventListener("click", function (e) {
            e.stopPropagation();
            writeHist(readHist().filter(function (x) { return x.url !== v.url; }));
            renderRecent(); renderHistSection();
        });
        row.appendChild(del);
        var go = function () { engineNavigate(v.url); };
        row.addEventListener("click", go);
        row.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
        listEl.appendChild(row);
    });
}

/* ═══ 6. CLOCK + WEATHER ═══════════════════════════════════════ */
var greetCache = "";
function tickClock() {
    var now = new Date();
    /* Settings › Appearance: 24-hour clock (veil:clock-24h) */
    var h24 = LS.get("veil:clock-24h") === "1";
    $("veilClock").textContent = now.toLocaleTimeString([], {
        hour: h24 ? "2-digit" : "numeric", minute: "2-digit", hour12: !h24
    });
    $("veilDate").textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
    /* The greeting rides the SAME 1s tick — it used to render only when
       the weather refreshed (every 30 min), so an afternoon boot kept
       saying “Good afternoon” deep into the evening. */
    var gname = (LS.get("veil:greeting-name") || "").trim().slice(0, 24);
    var txt = greetingFor(now.getHours()) + (gname ? ",\u00A0" + gname : "");
    if (txt !== greetCache) {
        greetCache = txt;
        var g = $("veilWxGreet");
        if (g) g.textContent = txt;
    }
}
setInterval(tickClock, 1000); tickClock();

var WMO = {
    0: ["sun", "Clear"], 1: ["cloud-sun", "Mostly clear"], 2: ["cloud-sun", "Partly cloudy"], 3: ["cloud", "Overcast"],
    45: ["cloud-fog", "Fog"], 48: ["cloud-fog", "Rime fog"],
    51: ["cloud-drizzle", "Light drizzle"], 53: ["cloud-drizzle", "Drizzle"], 55: ["cloud-drizzle", "Heavy drizzle"],
    61: ["cloud-rain", "Light rain"], 63: ["cloud-rain", "Rain"], 65: ["cloud-rain", "Heavy rain"],
    66: ["cloud-rain", "Freezing rain"], 67: ["cloud-rain", "Freezing rain"],
    71: ["cloud-snow", "Light snow"], 73: ["cloud-snow", "Snow"], 75: ["cloud-snow", "Heavy snow"], 77: ["cloud-snow", "Snow grains"],
    80: ["cloud-rain", "Rain showers"], 81: ["cloud-rain", "Rain showers"], 82: ["cloud-rain", "Violent showers"],
    85: ["cloud-snow", "Snow showers"], 86: ["cloud-snow", "Snow showers"],
    95: ["cloud-lightning", "Thunderstorm"], 96: ["cloud-lightning", "Storm + hail"], 99: ["cloud-lightning", "Storm + hail"]
};
/* night forms — a sun glyph plus the word “Clear” at 9 PM is a lie;
   after sundown codes 0/1/2 draw the moon shapes and 0 says so */
var WMO_NIGHT = {
    0: ["moon", "Clear night"], 1: ["cloud-moon", "Mostly clear"], 2: ["cloud-moon", "Partly cloudy"]
};
var wx = null;
var UNIT_KEY = "veil:temp-unit";
var WX_CACHE_KEY = "veil:wx:last-good";
function unitF() { return LS.get(UNIT_KEY) === "F"; }
function greetingFor(h) {
    /* Evening from 17:00, night from 21:00 — the same boundaries the
       live site uses, so both surfaces agree on when the day turns. */
    if (h < 5) return "Good night";
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    if (h < 21) return "Good evening";
    return "Good night";
}
function wxTone(desc) {
    var d = (desc || "").toLowerCase();
    var h = new Date().getHours();
    var night = h < 6 || h >= 19;
    if (d.indexOf("thunder") !== -1 || d.indexOf("lightning") !== -1) return "#fcd34d";
    if (d.indexOf("snow") !== -1 || d.indexOf("ice") !== -1 || d.indexOf("sleet") !== -1) return "#bae6fd";
    if (d.indexOf("drizzle") !== -1 || d.indexOf("rain") !== -1 || d.indexOf("shower") !== -1) return "#7dd3fc";
    if (d.indexOf("fog") !== -1 || d.indexOf("haze") !== -1 || d.indexOf("mist") !== -1) return "#d4d4d8";
    if (d.indexOf("clear") !== -1 || d.indexOf("sunny") !== -1) return night ? "#fef3c7" : "#fbbf24";
    if (d.indexOf("cloud") !== -1 || d.indexOf("partly") !== -1 || d.indexOf("overcast") !== -1) return night ? "#e4e4e7" : "#fde68a";
    return "#d4d4d8";
}
function renderWeather() {
    var wrap = $("veilWxWrap");
    if (!wx) { wrap.style.visibility = "hidden"; return; }
    wrap.style.visibility = "visible";
    var c = wx.tempC;
    /* night comes from the PROVIDER's is_day for this exact point (a
       pinned faraway city reads its own sky); the clock hour is only
       the fallback when the provider didn't answer */
    var h = new Date().getHours();
    var night = wx.isDay === 0 ? true : wx.isDay === 1 ? false : (h < 6 || h >= 19);
    var entry = (night && WMO_NIGHT[wx.code]) || WMO[wx.code];
    var icon = entry ? entry[0] : "cloud";
    var iconEl = $("veilWxIcon");
    iconEl.innerHTML = iconSVG(icon, "luc-14");
    iconEl.firstChild.style.color = wxTone(wx.desc);
    var temp = $("veilWxTemp");
    temp.textContent = unitF() ? Math.round(c * 9 / 5 + 32) + "°F" : Math.round(c) + "°C";
    var desc = wx.desc || "";
    /* the day label (“Clear”) reads wrong after sundown — swap in the
       night form when the provider's own words match the day form */
    if (night && WMO_NIGHT[wx.code] && WMO[wx.code] && desc === WMO[wx.code][1]) desc = WMO_NIGHT[wx.code][1];
    $("veilWxDesc").textContent = desc + (wx.stale ? " ·" : "");
    temp.title = (wx.place ? wx.place + "\n" : "") +
        "Feels like " + Math.round(unitF() ? wx.feelsC * 9 / 5 + 32 : wx.feelsC) + (unitF() ? "°F" : "°C") +
        (wx.humidity != null ? " · Humidity " + wx.humidity + "%" : "") +
        "\nClick to switch °C / °F";
    temp.setAttribute("aria-label", "Temperature " + Math.round(c) + " degrees Celsius. Click to switch units.");
}
function fetchWeather() {
    /* a pinned city (the weather popover) beats every auto path —
       IP geolocation can be a metro off, and the pin is the truth */
    var pin = wxPin();
    if (pin) { openMeteo(pin.lat, pin.lon, pin.place + " · pinned"); return; }
    /* whatismyip.com-style: the BROWSER asks ipwho.is for its own IP
       (the request carries this machine's real public IP), then an
       Open-Meteo POINT forecast at those exact coordinates — the model
       cell that actually contains the point, not a coarse "nearest
       area" (wttr.in's approach), which is what read a few degrees off. */
    fetch("https://ipwho.is/", { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (g) {
            if (!g || !g.success || !isFinite(g.latitude) || !isFinite(g.longitude)) throw 0;
            return openMeteo(
                g.latitude, g.longitude,
                [g.city, g.country_code].filter(Boolean).join(", ")
            );
        })
        .catch(function () { return wttrFallback(); });
}
function openMeteo(lat, lon, place) {
    var u = "https://api.open-meteo.com/v1/forecast" +
        "?latitude=" + encodeURIComponent(lat) +
        "&longitude=" + encodeURIComponent(lon) +
        "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day" +
        "&daily=sunrise,sunset&timezone=auto&forecast_days=1";
    return fetch(u, { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (j) {
            var c = j && j.current;
            if (!c || !isFinite(c.temperature_2m)) throw 0;
            wx = {
                tempC: c.temperature_2m, feelsC: isFinite(c.apparent_temperature) ? c.apparent_temperature : c.temperature_2m,
                desc: (WMO[c.weather_code] ? WMO[c.weather_code][1] : ""), code: parseInt(c.weather_code, 10),
                isDay: c.is_day === 1 || c.is_day === "1" ? 1 : (c.is_day === 0 || c.is_day === "0" ? 0 : null),
                humidity: c.relative_humidity_2m != null ? Math.round(c.relative_humidity_2m) : null,
                place: place || ""
            };
            LS.set(WX_CACHE_KEY, JSON.stringify(wx));
            renderWeather();
        })
        .catch(function () { return wttrFallback(); });
}
function wttrFallback() {
    /* last resort: wttr.in's own IP guess + the cached last-good read so
       the chip still paints (marked ·) when everything is offline */
    fetch("https://wttr.in/?format=j1", { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (j) {
            var cur = j && j.current_condition && j.current_condition[0];
            if (!cur) throw 0;
            var desc = "";
            try { desc = cur.weatherDesc[0].value; } catch (e) {}
            /* WWO text is day-blind — it happily says “Sunny” at 9 PM.
               When the local clock says night, call it what it looks
               like (the wttr path only runs unpinned, so local hour ≈
               the point's hour). */
            var wh = new Date().getHours();
            var wnight = wh < 6 || wh >= 19;
            if (wnight) {
                var low = (desc || "").trim().toLowerCase();
                if (low === "sunny" || low === "clear" || low === "sunny/clear" || low === "clear/sunny") desc = "Clear night";
            }
            var place = "";
            try {
                var near = (j.nearest_area && j.nearest_area[0]) || {};
                place = [near.areaName[0].value, near.region[0].value || near.country[0].value].filter(Boolean).join(", ");
            } catch (e) {}
            wx = {
                tempC: parseFloat(cur.temp_C), feelsC: parseFloat(cur.FeelsLikeC),
                desc: desc, code: parseInt(cur.weatherCode, 10),
                isDay: wnight ? 0 : 1,
                humidity: cur.humidity != null ? parseInt(cur.humidity, 10) : null,
                place: place
            };
            LS.set(WX_CACHE_KEY, JSON.stringify(wx));
            renderWeather();
        })
        .catch(function () {
            var raw = LS.get(WX_CACHE_KEY);
            if (raw) {
                try {
                    var c = JSON.parse(raw);
                    wx = { tempC: c.tempC, feelsC: c.feelsC, desc: c.desc, code: c.code, isDay: c.isDay != null ? c.isDay : null, humidity: c.humidity, place: c.place || "", stale: true };
                    renderWeather();
                    return;
                } catch (e) {}
            }
            wx = null; renderWeather();
        });
}
$("veilWxTemp").addEventListener("click", function () {
    LS.set(UNIT_KEY, unitF() ? "C" : "F"); renderWeather();
});

/* ── weather pin — set the city by hand ─────────────────────────
   “got the weather wrong” usually means IP geolocation put the chip
   in the wrong city. The pin geocodes a typed city (Open-Meteo's
   public geocoder) and every forecast runs on those exact coords. */
var WX_PIN_KEY = "veil:wx:pin";
function wxPin() {
    try {
        var p = JSON.parse(LS.get(WX_PIN_KEY) || "null");
        return (p && isFinite(p.lat) && isFinite(p.lon)) ? p : null;
    } catch (e) { return null; }
}
function wxPinSync() {
    var pin = wxPin();
    var btn = $("veilWxPinBtn");
    if (btn) {
        btn.classList.toggle("on", !!pin);
        btn.title = pin ? "Pinned: " + pin.place + " — click to change" : "Weather not right? Set your city";
    }
    var auto = $("veilWxPopAuto");
    if (auto) auto.hidden = !pin;
    var sub = $("veilWxPopSub");
    /* the hint shows what the detector actually found — the pinned
       line when pinned, the detected city otherwise (never a nag) */
    if (sub) {
        if (pin) sub.textContent = "Pinned to " + pin.place;
        else if (wx && wx.place) sub.textContent = "Auto-detected · " + wx.place;
        else sub.textContent = "Detecting your location…";
    }
    return pin;
}
function wxPinToggle() {
    var pop = $("veilWxPop");
    if (!pop) return;
    pop.hidden = !pop.hidden;
    if (pop.hidden) return;
    wxPinSync();
    var msg = $("veilWxPopMsg");
    if (msg) msg.hidden = true;
    var inp = $("veilWxPopInput");
    inp.value = "";
    setTimeout(function () { inp.focus(); }, 40);
}
function wxGeocode(q) {
    /* the geocoder's name field has no region syntax — “Austin, TX”
       answers with zero rows, so a comma query retries on the bare city */
    var tryName = function (name) {
        return fetch("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(name) +
            "&count=1&language=en&format=json", { cache: "no-store" })
            .then(function (r) { if (!r.ok) throw 0; return r.json(); });
    };
    return tryName(q).then(function (j) {
        var hit = j && j.results && j.results[0];
        if (hit) return hit;
        var city = q.split(",")[0].trim();
        if (!city || city === q) throw 0;
        return tryName(city).then(function (j2) {
            var hit2 = j2 && j2.results && j2.results[0];
            if (!hit2) throw 0;
            return hit2;
        });
    });
}
function wxPinApply() {
    var q = $("veilWxPopInput").value.trim();
    if (!q) return;
    var msg = $("veilWxPopMsg");
    msg.hidden = false;
    msg.textContent = "Looking up “" + q.slice(0, 40) + "”…";
    wxGeocode(q)
        .then(function (hit) {
            if (!isFinite(hit.latitude) || !isFinite(hit.longitude)) throw 0;
            var place = [hit.name, hit.admin1 && hit.admin1 !== hit.name ? hit.admin1 : null, hit.country_code]
                .filter(Boolean).join(", ");
            LS.set(WX_PIN_KEY, JSON.stringify({ place: place, lat: hit.latitude, lon: hit.longitude }));
            $("veilWxPop").hidden = true;
            wxPinSync();
            toast("weather pinned to " + place);
            fetchWeather();
        })
        .catch(function () {
            msg.hidden = false;
            msg.textContent = "couldn't find “" + q.slice(0, 40) + "” — try “City, State”";
        });
}
if ($("veilWxPinBtn")) {
    $("veilWxPinBtn").addEventListener("click", function (e) { e.stopPropagation(); wxPinToggle(); });
    $("veilWxPopSet").addEventListener("click", wxPinApply);
    $("veilWxPopInput").addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); wxPinApply(); }
    });
    $("veilWxPopAuto").addEventListener("click", function () {
        LS.del(WX_PIN_KEY);
        $("veilWxPop").hidden = true;
        wxPinSync();
        toast("weather back to auto location");
        fetchWeather();
    });
    document.addEventListener("click", function (e) {
        var pop = $("veilWxPop");
        if (pop.hidden) return;
        if (pop.contains(e.target) || $("veilWxPinBtn").contains(e.target)) return;
        pop.hidden = true;
    });
    wxPinSync();
}

/* ── hide UI (zen) — just the wallpaper ─────────────────────────
   The tiny top-left button: every interface layer fades out, the
   wallpaper keeps painting, click again (or Esc) to bring it back. */
var zenOn = false;
function setZen(on) {
    zenOn = on;
    htmlEl.classList.toggle("veil-zen", on);
    var b = $("veilZenBtn");
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.title = on ? "Show the interface (Esc)" : "Hide the interface — just the wallpaper (Esc brings it back)";
    b.innerHTML = iconSVG(on ? "eye" : "eyeoff", "") + "<span>" + (on ? "show UI" : "hide UI") + "</span>";
    if (on) {
        /* fold everything away — the wallpaper is the whole view */
        if (barOpen) setBarOpen(false);
        if ($("veilLb").classList.contains("open")) closeLightbox();
        if ($("veilTitle").classList.contains("open")) closeTitle();
        if (appOpen) { try { closeApp(); } catch (e) {} }
        if (anySection()) { closeAllSections(); updateChrome(); }
        $("veilWxPop").hidden = true;
    }
}
if ($("veilZenBtn")) {
    $("veilZenBtn").addEventListener("click", function () { setZen(!zenOn); });
}

fetchWeather();
setInterval(fetchWeather, 30 * 60 * 1000);

/* ═══ 7. COMMAND BAR (newtab) + suggestions ════════════════════ */
var QUICK_LINKS = [
    { name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Main_Page", host: "en.wikipedia.org", desc: "The free encyclopedia" },
    { name: "Hacker News", url: "https://news.ycombinator.com/", host: "news.ycombinator.com", desc: "Tech news, distilled", aliases: "hn reddit news" },
    { name: "MDN Docs", url: "https://developer.mozilla.org/en-US/", host: "developer.mozilla.org", desc: "Web documentation", aliases: "mdn docs javascript" },
    { name: "BBC News", url: "https://www.bbc.com/news", host: "www.bbc.com", desc: "World headlines", aliases: "bbc news world" },
    { name: "Lite CNN", url: "https://lite.cnn.com/", host: "lite.cnn.com", desc: "Text-only edition", aliases: "cnn news lite" },
    { name: "Bing", url: "https://www.bing.com/", host: "www.bing.com", desc: "Web search — Veil's engine", aliases: "search bing" },
    { name: "FreeTube", url: "https://freetube.veil.local/", host: "freetube.veil.local", desc: "Veil's private YouTube — the program", aliases: "youtube yt freetube videos watch" },
    { name: "GrayJay", url: "https://grayjay.veil.local/", host: "grayjay.veil.local", desc: "Follow creators, not platforms — the program", aliases: "grayjay gj creators" }
];

var sugRows = [], sugSel = 0, sugOpen = false;
var arcCache = null; /* the stash list, lazy */
function ensureArcList() {
    if (arcCache || arcCache === false) return;
    /* embedded catalog first — stash suggestions work with zero
       connection; the CDN fetch below upgrades it when online */
    if (window.__VEIL_STASH_LIST__ && window.__VEIL_STASH_LIST__.length) {
        arcCache = window.__VEIL_STASH_LIST__.map(function (raw) {
            return { raw: String(raw), name: stashName(raw) };
        });
    }
    fetch(UGS_LIST, { cache: "force-cache" })
        .then(function (r) { if (!r.ok) throw 0; return r.text(); })
        .then(function (text) {
            var m = /let\s+files\s*=\s*\[([\s\S]*?)\]/.exec(text);
            if (!m) throw 0;
            arcCache = JSON.parse("[" + m[1].replace(/,\s*$/, "") + "]")
                .map(String).filter(function (s) { return s && s.length > 1; })
                .map(function (raw) { return { raw: raw, name: cleanName(raw) }; });
        })
        .catch(function () { if (!arcCache) arcCache = false; });
}

function buildSuggestions(q) {
    var query = (q || "").trim().toLowerCase();
    if (!query) return [];
    var rows = [];
    /* Curated links rank ABOVE history: typing "youtube" must surface the
       FreeTube program first — a stray "youtube - Search" Bing history hit
       used to own the top slot, so Enter re-searched instead of opening the
       program. */
    QUICK_LINKS.forEach(function (l) {
        if (rows.length >= 5) return;
        var hay = (l.name + " " + l.host + " " + (l.aliases || "")).toLowerCase();
        if (hay.indexOf(query) !== -1) {
            rows.push({ k: "l", kind: "link", title: l.name, sub: l.desc ? l.desc + " · " + l.host : l.host, host: l.host, url: l.url });
        }
    });
    readHist().forEach(function (v) {
        if (rows.length >= 8) return;
        var hay = ((v.title || "") + " " + v.host + " " + v.url).toLowerCase();
        if (hay.indexOf(query) !== -1) {
            rows.push({ k: "h", kind: "hist", title: v.title || v.url.replace(/^https?:\/\//, ""), sub: v.host + " · " + timeAgo(v.at), host: v.host, url: v.url });
        }
    });
    if (arcCache && arcCache.length) {
        arcCache.forEach(function (g) {
            if (rows.length >= 9) return;
            if (g.name.toLowerCase().indexOf(query) !== -1 || g.raw.toLowerCase().indexOf(query) !== -1) {
                /* title = display name; titleObj = the stash game object
                   pickSuggestion hands to launchTitle (the old duplicate
                   `title` key clobbered the display name with "[object
                   Object]"). */
                rows.push({ k: "g", kind: "title", title: g.name, sub: "Arcade · the stash", url: "", titleObj: g });
            }
        });
    }
    var target = normalizeInput(q.trim());
    if (target) {
        var domainish = !q.trim().includes(" ") && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d+)?([/?#].*)?$/i.test(q.trim());
        rows.push({
            k: "a", kind: "action",
            title: domainish ? "Go to " + q.trim() : "Search Bing for “" + q.trim() + "”",
            sub: domainish ? target : "www.bing.com",
            url: target
        });
    }
    return rows.slice(0, 7);
}

function renderSuggestions() {
    var box = $("veilSug");
    box.innerHTML = "";
    if (!sugOpen || !sugRows.length) { box.classList.remove("open"); return; }
    sugRows.forEach(function (r, i) {
        var row = el("button", "row" + (i === sugSel ? " sel" : ""));
        row.type = "button";
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", i === sugSel ? "true" : "false");
        var ic = el("span", "ic " + (r.host ? "img" : r.kind === "title" ? "gm" : "act"));
        if (r.host) {
            var lt = el("span", "ltr", r.host.replace(/^www\./, "").charAt(0).toUpperCase());
            ic.appendChild(lt);
        } else if (r.kind === "title") {
            ic.innerHTML = iconSVG("joypad", "luc-14");
        } else {
            ic.innerHTML = iconSVG(r.kind === "action" ? "search" : "history", "luc-14");
        }
        row.appendChild(ic);
        var tx = el("span", "tx");
        tx.appendChild(el("span", "tt", r.title));
        tx.appendChild(el("span", "ss", r.sub));
        row.appendChild(tx);
        if (i === sugSel) {
            var k = el("span", "ent"); k.innerHTML = '<kbd class="veil-kbd">Enter</kbd>';
            row.appendChild(k);
        }
        row.addEventListener("mousedown", function (e) { e.preventDefault(); });
        row.addEventListener("click", function () { pickSuggestion(r); });
        box.appendChild(row);
    });
    box.classList.add("open");
}
function pickSuggestion(r) {
    sugOpen = false;
    $("veilSug").classList.remove("open");
    var input = $("veilNtInput");
    input.value = "";
    if (r.kind === "title") { arcTab = "stash"; openSection("arcade"); launchTitle(r.titleObj || r.title); return; }
    if (r.url) engineNavigate(r.url);
}
var ntInput = $("veilNtInput");
ntInput.addEventListener("input", function () {
    sugRows = buildSuggestions(this.value);
    sugSel = 0;
    sugOpen = this.value.trim().length > 0;
    if (sugOpen && this.value.trim().length >= 2) ensureArcList();
    renderSuggestions();
});
ntInput.addEventListener("focus", function () {
    sugOpen = this.value.trim().length > 0;
    renderSuggestions();
});
ntInput.addEventListener("blur", function () {
    setTimeout(function () { sugOpen = false; renderSuggestions(); }, 150);
});
ntInput.addEventListener("keydown", function (e) {
    if (!sugOpen || !sugRows.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); sugSel = (sugSel + 1) % sugRows.length; renderSuggestions(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sugSel = (sugSel - 1 + sugRows.length) % sugRows.length; renderSuggestions(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); sugOpen = false; renderSuggestions(); }
});
$("veilNtForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (sugOpen && sugRows[sugSel]) { pickSuggestion(sugRows[sugSel]); return; }
    var t = normalizeInput(ntInput.value);
    if (t) { engineNavigate(t); ntInput.value = ""; }
});
setTimeout(function () { try { ntInput.focus(); } catch (e) {} }, 120);

/* ── hero splash texts — 75% of loads swap the tagline ───────────
   Same mechanic as the website's start page (the user's lines):
   a random pick replaces the NTP tagline. 1% of loads get the
   special gold "passwords" line instead. ?splash=<line> forces a
   specific one (case-insensitive; "5rew21"/"passwords" force the
   special; any other value — incl. "1" — picks a random line).
   Runs at script parse (shell JS sits at the body end, h2 exists)
   and the boot cover hides the swap from first paint. */
(function veilSplash() {
    var LINES = ["Your Back", "I know its the best", "happy?", "1+1=11", "woah", "better than the rest", "Technoblade Never dies", "battle royale", "If your enemy's know your next move dont move", "fire hurts- Trust me", "Why did I pick the name veil IDK", "WORDS", "gravity hurts", "verified by me"];
    var SPECIAL = "passwords 5rew21";
    var h2 = document.querySelector("#veilShell .veil-nt-h2") || document.querySelector(".veil-nt-h2");
    if (!h2) return;
    function pick() { return LINES[Math.floor(Math.random() * LINES.length)]; }
    var forced = null, special = false;
    try {
        /* raw extraction, NOT URLSearchParams: it decodes "+" as a
           space, so the "1+1=11" line could never match its own
           override */
        var m = /[?&]splash=([^&]*)/i.exec(location.search);
        if (m) {
            var q;
            try { q = decodeURIComponent(m[1]); } catch (e2) { q = m[1]; }
            q = q.trim().toLowerCase();
            if (q === "5rew21" || q === "passwords" || q === SPECIAL.toLowerCase()) {
                forced = SPECIAL; special = true;
            } else {
                for (var i = 0; i < LINES.length; i++) {
                    if (LINES[i].toLowerCase() === q) { forced = LINES[i]; break; }
                }
                if (!forced) forced = pick(); /* param present but no match → random */
            }
        }
    } catch (e) { /* bad query — fall through to the dice roll */ }
    if (!forced) {
        var roll = Math.random();
        if (roll < 0.01) { forced = SPECIAL; special = true; }       /* the 1% gold drop */
        else if (roll < 0.76) forced = pick();                       /* 75% normal pool */
    }
    if (!forced) return;
    h2.textContent = forced;
    h2.classList.add("splash");
    if (special) h2.classList.add("gold");
})();

/* ═══ 8. BROWSER BAR wiring ════════════════════════════════════ */
$("veilCorner").addEventListener("click", toggleBar);
$("veilHideBar").addEventListener("click", function () { setBarOpen(false); });
$("veilBack").addEventListener("click", function () {
    if (appOpen) { closeApp(); return; } /* back out of the program */
    if (gBack && !gBack.disabled) gBack.click();
});
$("veilFwd").addEventListener("click", function () {
    if (appOpen) return;
    if (gFwd && !gFwd.disabled) gFwd.click();
});
$("veilReload").addEventListener("click", function () {
    if (appOpen) { $("veilAppReload").click(); return; } /* reload the program */
    if (gReload) gReload.click();
});
$("veilNewTab").addEventListener("click", function () {
    if (appOpen) closeApp(true);
    if (gNewTab) gNewTab.click();
});
$("veilExit").addEventListener("click", function () {
    closeApp(true);
    if (gHome) gHome.click();
    setBarOpen(false);
});
$("veilCloseAll").addEventListener("click", function () {
    closeApp(true);
    /* close every GUST tab except the active one, then go home */
    if (!gStrip) return;
    var tabs = gStrip.querySelectorAll(".tab[data-tab-id]");
    var active = gStrip.querySelector(".tab.active");
    tabs.forEach(function (t) {
        if (t !== active) {
            var x = t.querySelector(".tab-close");
            if (x) x.click();
        }
    });
    if (gHome) gHome.click();
});
var urlInput = $("veilUrlInput");
urlInput.addEventListener("focus", function () {
    editingUrl = true;
    requestAnimationFrame(function () { urlInput.select(); });
});
urlInput.addEventListener("blur", function () {
    editingUrl = false;
    onEngineUrl(lastEngineUrl);
});
urlInput.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
        e.preventDefault();
        editingUrl = false;
        onEngineUrl(lastEngineUrl);
        urlInput.blur();
    }
});
$("veilUrlForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var t = normalizeInput(urlInput.value);
    if (t) {
        editingUrl = false;
        engineNavigate(t);
        setBarOpen(false);
    } else {
        editingUrl = false;
        onEngineUrl(lastEngineUrl);
    }
});
function toggleFullscreen() {
    try {
        if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
        else document.documentElement.requestFullscreen().catch(function () {});
    } catch (e) {}
}
$("veilFull").addEventListener("click", toggleFullscreen);
$("veilFsNudge").addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", updateChrome);

/* mirror back/fwd availability + loading cover */
var loadVisTimer = null;
function setLoadCover(on) {
    var v = $("veilLoad");
    if (!v) return;
    if (on) {
        v.classList.add("on");
        /* grace delay: sub-250ms loads never flash the black cover */
        if (loadVisTimer) clearTimeout(loadVisTimer);
        loadVisTimer = setTimeout(function () { v.classList.add("vis"); }, 250);
    } else {
        if (loadVisTimer) { clearTimeout(loadVisTimer); loadVisTimer = null; }
        v.classList.remove("vis");
        /* keep display for the fade-out tail, then hide fully */
        setTimeout(function () { if (!v.classList.contains("vis")) v.classList.remove("on"); }, 300);
    }
}
function hookEngineBits() {
    if (gProgressWrap) {
        var syncLoad = function () {
            var on = !gProgressWrap.classList.contains("hidden");
            setLoadCover(on);
        };
        new MutationObserver(syncLoad).observe(gProgressWrap, { attributes: true, attributeFilter: ["class"] });
        syncLoad();
    }
    var syncNav = function () {
        $("veilBack").disabled = !!(gBack && gBack.disabled);
        $("veilFwd").disabled = !!(gFwd && gFwd.disabled);
    };
    [gBack, gFwd].forEach(function (b) {
        if (b) new MutationObserver(syncNav).observe(b, { attributes: true, attributeFilter: ["disabled"] });
    });
    syncNav();
}

/* ═══ 9. SECTIONS ══════════════════════════════════════════════ */
function openSection(name) {
    closeAllSections();
    var map = { wp: "veilSecWp", arcade: "veilSecArcade", ai: "veilSecAi", links: "veilSecLinks", hist: "veilSecHist", keys: "veilSecKeys", music: "veilSecMusic", settings: "veilSecSettings", ext: "veilSecExt", stream: "veilSecStream", chat: "veilSecChat" };
    var id = map[name];
    if (!id) return;
    closeApp(true);
    $(id).classList.add("open");
    if (id === "veilSecArcade") openArcade();
    if (id === "veilSecWp") renderWpGrid();
    if (id === "veilSecMusic") musicSectionOpen();
    if (id === "veilSecSettings") renderSettings();
    if (id === "veilSecExt") renderExtPanel();
    if (id === "veilSecStream") streamSectionOpen();
    if (id === "veilSecChat") veilChatOpen();
    updateChrome();
}
document.querySelectorAll("[data-sec]").forEach(function (b) {
    b.addEventListener("click", function () { openSection(b.getAttribute("data-sec")); });
});
document.querySelectorAll(".veil-sec [data-close]").forEach(function (b) {
    b.addEventListener("click", function () {
        b.closest(".veil-sec").classList.remove("open");
        updateChrome();
    });
});

/* links grid */
(function renderLinks() {
    var grid = $("veilLinksGrid");
    QUICK_LINKS.forEach(function (l) {
        var card = el("button", "veil-link-card");
        card.type = "button";
        var fv = letterTile(l.host, "fv");
        card.appendChild(fv);
        var tx = el("span", "tx");
        tx.appendChild(el("span", "tt", l.name));
        tx.appendChild(el("span", "ss", l.desc + " · " + l.host));
        card.appendChild(tx);
        card.appendChild(el("span", "tag", "Launch"));
        card.addEventListener("click", function () { engineNavigate(l.url); });
        grid.appendChild(card);
    });
})();

/* shortcuts sheet */
(function renderKeys() {
    var rows = [
        ["Fullscreen", "F"], ["Show the control bar", "Ctrl", "L"], ["New tab", "Ctrl", "T"],
        ["Close tab", "Ctrl", "W"], ["Back / Forward", "Alt", "←→"], ["Cycle tabs", "Ctrl", "Tab"],
        ["Focus the omnibox", "Ctrl", "L"], ["Keyboard shortcuts", "?"], ["Back to the start page", "Esc"]
    ];
    var grid = $("veilKeysGrid");
    rows.forEach(function (r) {
        var row = el("div", "veil-keys-row");
        row.appendChild(el("span", "act", r[0]));
        var ks = el("span", "ks");
        for (var i = 1; i < r.length; i++) {
            var k = el("kbd", "veil-kbd", r[i]);
            ks.appendChild(k);
        }
        row.appendChild(ks);
        grid.appendChild(row);
    });
})();
$("veilKeysBtn").addEventListener("click", function () { openSection("keys"); });

/* ═══ 9a. THE TUNNEL — origin-free networking through the engine ══
   Unstamped copies (no birth origin) used to politely die: music
   search, the Live/4K wallpaper catalogs and 4K resolution lookups
   all needed the origin's server-side APIs. But this file CARRIES a
   full tunneling browser engine (libcurl WASM + WISP relays) — the
   same pipeline that browses pages — and its request router accepts
   messages from THIS window too (the engine's dispatcher takes
   {t:'q'} from any frame, self included, and replies {t:'r'} to the
   sender). So the shell borrows the engine's legs:

     tunFetch(url, opts) → { s, m, h, d }   (d = base64 body)

   Ids live at 1e6+ (the engine's frames count from 1), replies route
   by id, 45s timeout — and AbortError'd requests (tab switch resets
   the engine's abort controller) just reject like any network error,
   so callers degrade instead of hanging. */
var TUN_RID = 1000000;
var TUN_PENDING = {};
var TUN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.t !== "r" || typeof d.i !== "number" || d.i < 1000000) return;
    var p = TUN_PENDING[d.i];
    if (!p) return;
    delete TUN_PENDING[d.i];
    clearTimeout(p.tm);
    if (d.e) p.rej(new Error(String(d.e)));
    else p.res(d);
});
function tunReady() {
    return window._libcurlReady === true || (typeof window._libcurlReady === "undefined" && findEngine());
}
function tunFetch(url, opts) {
    opts = opts || {};
    return new Promise(function (res, rej) {
        if (!tunReady()) { rej(new Error("engine not ready")); return; }
        var i = ++TUN_RID;
        var tm = setTimeout(function () {
            delete TUN_PENDING[i];
            rej(new Error("Timeout"));
        }, 45000);
        TUN_PENDING[i] = { res: res, rej: rej, tm: tm };
        var o = { headers: Object.assign({ "user-agent": TUN_UA, "accept": "text/html,application/xhtml+xml,application/json,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" }, opts.headers || {}) };
        if (opts.method) o.method = opts.method;
        if (opts.body) o.body = opts.body;
        window.postMessage({ t: "q", i: i, url: url, opts: o }, "*");
    });
}
function tunText(url, opts) {
    return tunFetch(url, opts).then(function (r) {
        if (r.s && r.s >= 400) throw new Error("HTTP " + r.s);
        var bin = atob(r.d || "");
        return decodeURIComponent(escape(bin));
    });
}
function tunJson(url, opts) {
    return tunText(url, opts).then(function (t) { return JSON.parse(t); });
}
function tunBlob(url, opts) {
    return tunFetch(url, opts).then(function (r) {
        if (r.s && r.s >= 400) throw new Error("HTTP " + r.s);
        var bin = atob(r.d || "");
        var arr = new Uint8Array(bin.length);
        for (var k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
        return URL.createObjectURL(new Blob([arr], { type: r.m || "application/octet-stream" }));
    });
}

/* ── SoundCloud client-side engine (the sc-audio.ts port) ────────
   Same chain the origin's /api/music routes run, executed through
   the tunnel: discover the public web client_id from soundcloud.com's
   JS bundles (cached in localStorage, 12h), search api-v2, resolve
   progressive streams to signed CDN mp3s. The signed URLs go
   straight into <audio src> — media elements don't enforce CORS, so
   full songs play from file:// with no origin at all. */
var SC = {
    id: null, idAt: 0,
    clientId: function (force) {
        if (!force && SC.id && Date.now() - SC.idAt < 12 * 3600 * 1000) return Promise.resolve(SC.id);
        if (SC._disc) return SC._disc;
        SC._disc = tunText("https://soundcloud.com/", { headers: { accept: "text/html" } })
            .then(function (html) {
                var seen = {}, bundles = [];
                var re = /https:\/\/a-v2\.sndcdn\.com\/assets\/[\w.-]+\.js/g, m;
                while ((m = re.exec(html))) {
                    if (!seen[m[0]]) { seen[m[0]] = 1; bundles.push(m[0]); }
                    if (bundles.length >= 12) break;
                }
                if (!bundles.length) throw new Error("no sndcdn bundles");
                return Promise.all(bundles.map(function (b) {
                    return tunText(b, { headers: { accept: "*/*" } }).catch(function () { return ""; });
                }));
            })
            .then(function (texts) {
                for (var j = 0; j < texts.length; j++) {
                    var m = /client_id[":]\s*"([A-Za-z0-9_-]{20,50})"/.exec(texts[j]);
                    if (m) {
                        SC.id = m[1]; SC.idAt = Date.now();
                        try { LS.set("veil:sc-id", SC.id + "@" + SC.idAt); } catch (e) {}
                        return SC.id;
                    }
                }
                throw new Error("client_id not found");
            })
            .finally(function () { SC._disc = null; });
        return SC._disc;
    },
    api: function (path, force) {
        return SC.clientId(force).then(function (id) {
            return tunJson("https://api-v2.soundcloud.com" + path + (path.indexOf("?") > -1 ? "&" : "?") + "client_id=" + id, { headers: { accept: "application/json" } });
        }).catch(function (err) {
            if (!force && /HTTP 401|401/.test(String(err && err.message))) return SC.api(path, true);
            throw err;
        });
    },
    toTrack: function (t) {
        if (!t || t.kind !== "track" || t.streamable === false) return null;
        var tr = (t.media && t.media.transcodings) || [];
        if (!tr.length) return null;
        var id = Number(t.id);
        if (!isFinite(id) || id <= 0) return null;
        var previewOnly = !tr.some(function (x) { return typeof x.url === "string" && x.url.indexOf("/stream/") > -1; });
        var artRaw = typeof t.artwork_url === "string" ? t.artwork_url : "";
        return {
            id: id,
            title: t.title || "Untitled",
            artist: (t.user && t.user.username) || "Unknown artist",
            art: artRaw.replace(/-(large|badge|small|tiny|t\d+x\d+)\.(jpg|png|webp)/i, "-t200x200.$2"),
            ms: previewOnly ? (Number(t.full_duration) || Number(t.duration) || 0) : (Number(t.duration) || 0),
            previewOnly: previewOnly,
            permalink: typeof t.permalink_url === "string" ? t.permalink_url : ""
        };
    },
    search: function (q, limit) {
        limit = limit || 16;
        var key = "scq:" + q.trim().toLowerCase();
        var hit = null;
        try { hit = JSON.parse(LS.get(key) || "null"); } catch (e) {}
        if (hit && Date.now() - hit.at < 10 * 60 * 1000 && hit.items && hit.items.length) return Promise.resolve(hit.items);
        return SC.api("/search/tracks?q=" + encodeURIComponent(q.trim()) + "&limit=" + Math.min(32, limit * 2))
            .then(function (d) {
                var items = (d.collection || []).map(SC.toTrack).filter(Boolean).slice(0, limit);
                if (items.length) { try { LS.set(key, JSON.stringify({ at: Date.now(), items: items })); } catch (e) {} }
                return items;
            });
    },
    resolveStream: function (trackId, force) {
        var ck = "scs:" + trackId;
        var hit = null;
        try { hit = JSON.parse(LS.get(ck) || "null"); } catch (e) {}
        if (!force && hit && hit.url && Date.now() - hit.at < 10 * 60 * 1000) return Promise.resolve(hit);
        return SC.api("/tracks/" + trackId, force).then(function (t) {
            var tr = (t.media && t.media.transcodings) || [];
            var prog = tr.filter(function (x) { return x.format && x.format.protocol === "progressive" && typeof x.url === "string"; });
            var pick = prog.filter(function (x) { return x.url.indexOf("/stream/") > -1; })[0] || prog.filter(function (x) { return x.url.indexOf("/preview/") > -1; })[0];
            if (!pick) throw new Error("no progressive transcode");
            return SC.clientId(force).then(function (id) {
                return tunJson(pick.url + "?client_id=" + id, { headers: { accept: "application/json" } });
            }).then(function (d) {
                if (!d || typeof d.url !== "string" || !/^https:\/\//.test(d.url)) throw new Error("no CDN url");
                var st = { url: d.url, previewOnly: pick.url.indexOf("/preview/") > -1, ms: Number(t.duration) || 0, at: Date.now() };
                try { LS.set(ck, JSON.stringify(st)); } catch (e) {}
                return st;
            });
        }).catch(function (err) {
            if (!force && /HTTP 401|401/.test(String(err && err.message))) return SC.resolveStream(trackId, true);
            throw err;
        });
    }
};
try {
    var _sci = LS.get("veil:sc-id") || "";
    var _at = _sci.indexOf("@");
    if (_at > -1) { SC.id = _sci.slice(0, _at); SC.idAt = Number(_sci.slice(_at + 1)) || 0; }
} catch (e) {}

/* ── client-side catalog parsers (the wallpaper routes, ported) ── */
var WP4K_BASE = "https://4kwallpapers.com";
var WP4K_CATS = { recent: "", nature: "nature", anime: "anime", abstract: "abstract", cars: "cars", minimal: "minimal", dark: "black-dark", fantasy: "fantasy", space: "space-art", aesthetic: "aesthetic-wallpapers", animals: "animals", architecture: "architecture", flowers: "flowers", movies: "movies", music: "music", cute: "cute" };
var WPMBG_BASE = "https://motionbgs.com";
var WPMBG_CATS = { recent: "", anime: "tag:anime", superhero: "tag:superhero", nature: "tag:nature", scifi: "tag:sci-fi", cyberpunk: "tag:cyberpunk", space: "tag:space", dark: "tag:dark", city: "tag:city", aesthetic: "tag:aesthetic", animals: "tag:cat", fantasy: "tag:fantasy", horror: "tag:horror", minimal: "tag:simple", cars: "tag:car", neon: "tag:neon", "4k": "4k", mobile: "mobile" };
function wpDecodeEntities(s) {
    return String(s).replace(/&#0?39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}
function wpTitleFromSlug(slug) {
    return slug.replace(/-\d+$/, "").split("-").map(function (w) { return w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w.toUpperCase(); }).join(" ");
}
function wpNormalizeThumb(src) {
    var tm = /\/images\/walls\/thumbs(?:_2t)?\/(\d+)\.(jpe?g|png|webp)/i.exec(src);
    if (tm) return WP4K_BASE + "/images/walls/thumbs/" + tm[1] + "." + tm[2];
    return /^http/.test(src) ? src : "";
}
function wpParse4k(html, fallbackCat) {
    var items = [], seen = {};
    function push(detail, slug, id, imgAttrs) {
        if (!isFinite(id) || seen[id]) return;
        var src = (/src="([^"]+)"/.exec(imgAttrs) || [])[1] || "";
        var alt = (/alt="([^"]*)"/.exec(imgAttrs) || [])[1] || "";
        var thumb = wpNormalizeThumb(src);
        if (!thumb) return;
        var detailPath = /^http/.test(detail) ? detail : WP4K_BASE + detail;
        var category = fallbackCat;
        try {
            var cm = /^\/([a-z-]+)\//.exec(new URL(detailPath).pathname);
            if (cm) category = cm[1].replace(/-/g, " ");
        } catch (e) {}
        var name = alt ? wpDecodeEntities(alt.split(",")[0].trim().slice(0, 80)) : wpTitleFromSlug(slug);
        seen[id] = 1;
        items.push({ id: id, name: name, slug: slug, category: category, thumb: thumb, detail: detailPath });
    }
    var re = /<a[^>]+href="((?:https?:\/\/[^"]*|)\/(?:[a-z-]+)\/([a-z0-9-]+)-(\d+)\.html?)"[^>]*>\s*(?:<[^a>][^>]*>\s*)*<img([^>]*)>/gi, m;
    while ((m = re.exec(html))) {
        push(m[1], m[2], parseInt(m[3], 10), m[4]);
        if (items.length >= 48) return items;
    }
    var blockRe = /<p[^>]*itemprop="associatedMedia"[^>]*>([\s\S]*?)<\/p>/gi;
    while ((m = blockRe.exec(html))) {
        var d = /href="((?:https?:\/\/[^"]*|)\/(?:[a-z-]+)\/([a-z0-9-]+)-(\d+)\.html?)"/i.exec(m[1]);
        if (!d) continue;
        var img = /<img[^>]*>/i.exec(m[1]);
        if (!img) continue;
        push(d[1], d[2], parseInt(d[3], 10), img[0].replace(/^<img/, ""));
        if (items.length >= 48) return items;
    }
    return items;
}
function wpParseMbg(html) {
    var items = [], seen = {};
    var anchorRe = /<a title="([^"]{1,140}?) live wallpaper" href=\/(?:mobile\/)?([a-z0-9-]+)>/g;
    var thumbRe = /\/i\/c\/\d+x\d+\/media\/(\d+)\/([a-z0-9.-]+?\.jpe?g)/;
    var m;
    while ((m = anchorRe.exec(html))) {
        var name = m[1].trim(), slug = m[2];
        var tail = html.slice(m.index, m.index + 900);
        var t = thumbRe.exec(tail);
        if (!t) continue;
        var id = parseInt(t[1], 10);
        if (!isFinite(id) || seen[id]) continue;
        seen[id] = 1;
        items.push({
            id: id, name: name, slug: slug,
            thumb: WPMBG_BASE + "/i/c/546x308/media/" + t[1] + "/" + t[2],
            video: WPMBG_BASE + "/media/" + t[1] + "/" + slug + ".3840x2160.mp4"
        });
        if (items.length >= 60) break;
    }
    return items;
}
function wp4kUrl(cat, page, q) {
    if (q) return WP4K_BASE + "/search/?text=" + encodeURIComponent(q);
    var slug = WP4K_CATS[cat] || "";
    if (slug === "") return page > 1 ? WP4K_BASE + "/?page=" + page : WP4K_BASE + "/";
    return page > 1 ? WP4K_BASE + "/" + slug + "/?page=" + page : WP4K_BASE + "/" + slug + "/";
}
function wpMbgUrl(cat, page, q) {
    if (q) return WPMBG_BASE + "/search?q=" + encodeURIComponent(q);
    var slug = WPMBG_CATS[cat] || "";
    if (slug === "") return page > 1 ? WPMBG_BASE + "/" + page + "/" : WPMBG_BASE + "/";
    return page > 1 ? WPMBG_BASE + "/" + slug + "/" + page + "/" : WPMBG_BASE + "/" + slug + "/";
}
function wp4kVariants(q) {
    var out = [];
    var tokens = q.split(/[\s-]+/).filter(Boolean);
    if (q.indexOf(" ") > -1) out.push(q.replace(/ +/g, "-"));
    if (q.indexOf("-") > -1) out.push(q.replace(/-+/g, " "));
    var joined = tokens.join("");
    if (joined && joined !== q) out.push(joined);
    var longest = tokens.filter(function (t) { return t.length >= 3; }).sort(function (a, b) { return b.length - a.length; })[0];
    if (longest && tokens.length > 1) out.push(longest);
    var uniq = {};
    return out.filter(function (v) { return v !== q && !uniq[v] && (uniq[v] = 1); });
}
function wp4kDetailParse(html) {
    var resolutions = [], seen = {};
    var re = /\/images\/wallpapers\/([a-z0-9-]+)-(\d{3,4})x(\d{3,4})-(\d+)\.(jpe?g|png)/gi, m;
    while ((m = re.exec(html))) {
        var file = "/images/wallpapers/" + m[1] + "-" + m[2] + "x" + m[3] + "-" + m[4] + "." + m[5];
        if (seen[file]) continue;
        seen[file] = 1;
        resolutions.push({ w: parseInt(m[2], 10), h: parseInt(m[3], 10), url: WP4K_BASE + file });
    }
    resolutions.sort(function (a, b) { return b.w * b.h - a.w * a.h; });
    var ratio = function (r) { return Math.abs(r.w / r.h - 16 / 9); };
    var landscape = resolutions.filter(function (r) { return r.w >= r.h; });
    var best = (landscape.length ? landscape.slice().sort(function (a, b) { return ratio(a) - ratio(b) || b.w - a.w; })[0] : null) || resolutions[0] || null;
    var title = (/<title>([^<]{1,120})<\/title>/i.exec(html) || [])[1] || "";
    return { ok: !!best, name: title.replace(/\s*Wallpaper.*$/i, "").trim(), resolutions: resolutions, best: best };
}

/* motionbgs videos are hotlink-protected — direct <video src> fails
   from file://. Origin-free copies pull them through the tunnel as
   blobs instead: the full 4K file first (they ARE 4K wallpapers —
   play what the catalog promises), then the 1080p and 540p
   fallbacks for slow connections. Session-cached. */
var MBGS_VID_CACHE = {};
function mbgsIsDirect(url) {
    return /^https?:\/\/(?:[\w-]+\.)*motionbgs\.com\/media\//i.test(String(url || ""));
}
function mbgsResolveVideo(key, url) {
    if (MBGS_VID_CACHE[key]) return Promise.resolve(MBGS_VID_CACHE[key]);
    if (MBGS_VID_CACHE[key] === false) return Promise.reject(new Error("no variant"));
    var variants = [
        url,
        url.replace(/\.3840x2160\.mp4(\?.*)?$/, ".1920x1080.mp4"),
        url.replace(/\.3840x2160\.mp4(\?.*)?$/, ".960x540.mp4")
    ];
    var tryAt = function (i) {
        if (i >= variants.length) { MBGS_VID_CACHE[key] = false; return Promise.reject(new Error("no variant")); }
        return tunBlob(variants[i])
            .then(function (b) { MBGS_VID_CACHE[key] = b; return b; })
            .catch(function () { return tryAt(i + 1); });
    };
    return tryAt(0);
}

/* ═══ 9b. MUSIC — search, shelves, persistent player ═══════════ */
/* Mirrors the website's MusicSection + VeilMusicPlayer: song search
   runs through the birth origin's /api/music/scsearch (SoundCloud's
   public web API server-side → FULL tracks streamed via
   /api/music/scstream; rights-limited + fallback results are badged
   30s previews), curated Spotify shelves (oEmbed art + official
   embed), and a persistent pill that keeps playing across section
   switches. No birth origin → search + streams politely degrade;
   shelves still play their embeds (loaded straight from
   open.spotify.com). */
var MUSIC_ROWS = [
    { label: "Charts", items: [
        { kind: "playlist", id: "37i9dQZF1DXcBWIGoYBM5M", label: "Today's Top Hits" },
        { kind: "playlist", id: "37i9dQZF1DX4JAvHpjipBk", label: "New Music Friday" },
        { kind: "playlist", id: "37i9dQZF1DX0XUsuxWHRQd", label: "RapCaviar" },
        { kind: "playlist", id: "37i9dQZF1DX10zKzsJ2jva", label: "Viva Latino" }
    ]},
    { label: "Legends", items: [
        { kind: "artist", id: "3fMbdgg4jU18AjLCKBhRSm", label: "Michael Jackson" },
        { kind: "artist", id: "7dGJo4pcD2V6oG8kP0tJRR", label: "Eminem" },
        { kind: "artist", id: "4tZwfgrHOc3mvqYlEYSvVi", label: "Daft Punk" },
        { kind: "artist", id: "2ye2Wgw4gimLv2eAKyk1NB", label: "Metallica" },
        { kind: "playlist", id: "37i9dQZF1DWXRqgorJj26U", label: "Rock Classics" },
        { kind: "playlist", id: "37i9dQZF1DX4UtSsGT1Sbe", label: "All Out 80s" }
    ]},
    { label: "Pop now", items: [
        { kind: "artist", id: "06HL4z0CvFAxyc27GXpf02", label: "Taylor Swift" },
        { kind: "artist", id: "1Xyo4u8uXC1ZmMpatF05PJ", label: "The Weeknd" },
        { kind: "artist", id: "6qqNVTkY8uBg9cP3Jd7DAH", label: "Billie Eilish" },
        { kind: "artist", id: "0du5cEVh5yTK9QJze8zA0C", label: "Bruno Mars" },
        { kind: "artist", id: "1uNFoZAHBGtllmzznpCI3s", label: "Justin Bieber" },
        { kind: "artist", id: "26VFTg2z8YR0cCuwLzESi2", label: "Halsey" }
    ]}
];
function parseSpotifyInput(input) {
    var s = String(input || "").trim();
    if (!s) return null;
    var uri = /^spotify:(track|album|playlist|artist|episode|show):([A-Za-z0-9]+)$/i.exec(s);
    if (uri) return { kind: uri[1].toLowerCase(), id: uri[2] };
    var url = /^https?:\/\/(?:[\w-]+\.)*spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/i.exec(s);
    if (url) return { kind: url[1].toLowerCase(), id: url[2] };
    return null;
}
function musicEmbedUrl(kind, id) {
    return "https://open.spotify.com/embed/" + kind + "/" + id + "?utm_source=veil";
}
function musicOpenUrl(kind, id) {
    return "https://open.spotify.com/" + kind + "/" + id;
}
function spotifySearchUrlFor(title, artist) {
    return "https://open.spotify.com/search/" + encodeURIComponent((title + " " + artist).trim());
}

/* ── persistent player state ──────────────────────────────────── */
var vm = { track: null, attached: false };
var vmAudio = null;
function vmFmt(s) {
    if (!isFinite(s) || s < 0) s = 0;
    var m = Math.floor(s / 60), x = Math.floor(s % 60);
    return m + ":" + (x < 10 ? "0" : "") + x;
}
function vmEls() {
    return {
        root: $("veilMusic"), card: document.querySelector("#veilMusic .vm-card"),
        art: $("veilMuArt"), artBtn: $("veilMuArtBtn"), artIc: document.querySelector("#veilMuArtBtn .vm-art-ic"),
        eq: $("veilMuEq"), kicker: $("veilMuKicker"), title: $("veilMuTitle"), sub: $("veilMuSub"),
        toggle: $("veilMuToggle"), expand: $("veilMuExpand"), full: $("veilMuFull"), stop: $("veilMuStop"),
        body: $("veilMuBody"), scrub: $("veilMuScrub"), bigPlay: $("veilMuBigPlay"),
        t1: $("veilMuT1"), t2: $("veilMuT2"), bar: $("veilMuBar"), fill: $("veilMuBarFill"), knob: $("veilMuBarKnob"),
        handTxt: $("veilMuHandTxt"), handLink: $("veilMuHandLink"), embedWrap: $("veilMuEmbedWrap"), embed: $("veilMuEmbed"), audio: $("veilMuAudio")
    };
}
function vmApplyChrome() {
    var e = vmEls();
    if (!e.root) return;
    e.root.hidden = !vm.track;
    e.root.classList.toggle("attached", !!vm.attached);
    if (!vm.track) { e.body.hidden = true; return; }
    var prev = !!vm.track.preview;
    e.body.hidden = !vm.attached;
    e.scrub.hidden = !(vm.attached && prev);
    e.embedWrap.hidden = !(vm.attached && !prev);
    e.toggle.hidden = !prev;
    e.expand.hidden = vm.attached;
    e.full.hidden = false;
    e.kicker.textContent = prev
        ? (vm.track.preview.previewOnly ? "Now playing · 30s preview" : "Now playing · SoundCloud")
        : "Now playing · Spotify";
    e.kicker.hidden = !vm.attached;
    e.sub.hidden = !(vm.attached && vm.track.sub);
    vmSetPlayIcons(e, prev && vmAudio && !vmAudio.paused);
}
function vmSetPlayIcons(e, playing) {
    var ic = playing ? "pause" : "play";
    if (e.toggle) e.toggle.innerHTML = iconSVG(ic, "");
    if (e.bigPlay) e.bigPlay.innerHTML = iconSVG(ic, "");
    if (e.eq) e.eq.hidden = !playing;
    if (e.artBtn) e.artBtn.classList.toggle("playing", !!playing);
}
function vmPlayEmbed(kind, id, title, art) {
    var e = vmEls();
    vm.track = { kind: kind, title: title || "Spotify", art: art || "", preview: null, sub: "" };
    if (vmAudio) { try { vmAudio.pause(); } catch (err) {} }
    /* starting a track while the section is open → wide panel */
    var sec = $("veilSecMusic");
    if (sec && sec.classList.contains("open")) vm.attached = true;
    if (e.embed) e.embed.src = musicEmbedUrl(kind, id);
    e.full.href = musicOpenUrl(kind, id);
    e.full.title = "Open in Spotify";
    vmApplyChrome();
    vmPaint();
}
function vmDur() {
    /* the audio element's duration, falling back to the known full
       length when a stream's metadata reports Infinity */
    if (vmAudio && isFinite(vmAudio.duration) && vmAudio.duration > 0) return vmAudio.duration;
    if (vm.track && vm.track.preview && !vm.track.preview.previewOnly) return (vm.track.preview.ms || 0) / 1000;
    return (vmAudio && isFinite(vmAudio.duration) && vmAudio.duration > 0) ? vmAudio.duration : 0;
}
function vmPlayPreview(song) {
    var e = vmEls();
    var isSC = song.source === "soundcloud";
    var previewOnly = isSC ? !!song.previewOnly : true;
    if (!VEIL_ORIGIN) {
        /* origin-free: SC streams resolve through the tunnel to signed
           CDN mp3s (media elements ignore CORS — they just play);
           iTunes previews are direct https mp3s */
        if (isSC) {
            vmTrackSetup(song, e, previewOnly, null);
            vmApplyChrome();
            vmPaint();
            SC.resolveStream(Number(song.id))
                .then(function (st) {
                    if (vm.track && vm.track.preview && String(vm.track.preview.pendingId) === String(song.id)) {
                        vm.track.preview.pendingId = null;
                        vm.track.preview.url = st.url;
                        vm.track.preview.previewOnly = previewOnly || !!st.previewOnly;
                        if (vmAudio) {
                            vmAudio.src = st.url;
                            var pr2 = vmAudio.play();
                            if (pr2 && pr2.catch) pr2.catch(function () { vmApplyChrome(); });
                        }
                        vmPaint();
                    }
                })
                .catch(function () {
                    toast("Couldn't resolve that track's stream — try another result.");
                    if (vm.track && vm.track.preview) vm.track.preview.pendingId = null;
                    vmApplyChrome();
                });
            return;
        }
        if (!song.preview) {
            toast("That result has no playable stream.");
            return;
        }
        vmTrackSetup(song, e, true, song.preview);
        vmAudio.src = song.preview;
        var pr3 = vmAudio.play();
        if (pr3 && pr3.catch) pr3.catch(function () { vmApplyChrome(); });
        vmApplyChrome();
        vmPaint();
        return;
    }
    var url = isSC
        ? VEIL_ORIGIN + "/api/music/scstream?id=" + encodeURIComponent(song.id)
        : veilRoute(song.preview);
    vmTrackSetup(song, e, previewOnly, url);
    vmAudio.src = vm.track.preview.url;
    var pr = vmAudio.play();
    if (pr && pr.catch) pr.catch(function () { vmApplyChrome(); });
    vmApplyChrome();
    vmPaint();
}
/* shared track bootstrapping for both origin and origin-free paths */
function vmTrackSetup(song, e, previewOnly, url) {
    var isSC = song.source === "soundcloud";
    var full = isSC && song.permalink ? song.permalink : spotifySearchUrlFor(song.title, song.artist);
    vm.track = {
        kind: "track",
        title: song.title,
        art: song.art ? veilRoute(song.art) : "",
        sub: song.artist + (song.album ? " · " + song.album : ""),
        preview: { url: url || "", pendingId: url ? null : song.id, full: full, previewOnly: previewOnly, source: isSC ? "soundcloud" : "itunes", ms: song.ms || 0 }
    };
    /* starting a track while the section is open → wide panel */
    var sec = $("veilSecMusic");
    if (sec && sec.classList.contains("open")) vm.attached = true;
    if (e.embed) e.embed.src = "about:blank";
    e.full.href = full;
    e.full.title = previewOnly ? "Full track on Spotify" : "Open on SoundCloud";
    if (e.handTxt) e.handTxt.textContent = previewOnly ? "30-second preview" : "Full song from SoundCloud";
    e.handLink.href = full;
    e.handLink.textContent = previewOnly ? "play the full track on Spotify" : "open on SoundCloud";
    if (!vmAudio) {
        vmAudio = e.audio;
        vmAudio.addEventListener("play", vmApplyChrome);
        vmAudio.addEventListener("pause", vmApplyChrome);
        vmAudio.addEventListener("ended", vmApplyChrome);
        vmAudio.addEventListener("error", function () {
            if (vm.track && vm.track.preview) {
                if (vm.track.preview.pendingId) return; /* still resolving — the resolver reports its own failure */
                toast("Couldn't stream that track — try another result.");
            }
            vmApplyChrome();
        });
        vmAudio.addEventListener("timeupdate", function () {
            var el = vmEls();
            var d = vmDur();
            var f = d > 0 ? vmAudio.currentTime / d : 0;
            if (el.t1) el.t1.textContent = vmFmt(vmAudio.currentTime);
            if (el.t2) el.t2.textContent = vmFmt(d);
            if (el.fill) el.fill.style.width = (f * 100).toFixed(2) + "%";
            if (el.knob) el.knob.style.left = (f * 100).toFixed(2) + "%";
            if (el.bar) el.bar.setAttribute("aria-valuenow", Math.round(f * 100));
        });
    }
}
function vmPaint() {
    var e = vmEls();
    if (!vm.track) return;
    if (vm.track.art) {
        e.art.src = vm.track.art;
        e.art.hidden = false;
        e.artIc.style.display = "none";
    } else {
        e.art.hidden = true;
        e.artIc.style.display = "";
    }
    e.title.textContent = vm.track.title;
    e.title.title = vm.track.title;
    if (vm.track.sub) { e.sub.textContent = vm.track.sub; e.sub.hidden = !vm.attached; }
}
function vmTogglePlay() {
    if (!vmAudio || !vm.track || !vm.track.preview) return;
    if (vmAudio.paused) { var pr = vmAudio.play(); if (pr && pr.catch) pr.catch(function () {}); }
    else vmAudio.pause();
}
function vmSeekFrac(frac) {
    var d = vmDur();
    if (!vmAudio || !isFinite(d) || d <= 0) return;
    vmAudio.currentTime = Math.max(0, Math.min(1, frac)) * d;
}
function vmStop() {
    vm.track = null;
    vm.attached = false;
    if (vmAudio) { try { vmAudio.pause(); vmAudio.src = ""; } catch (e) {} }
    var el = vmEls();
    if (el.embed) el.embed.src = "about:blank";
    vmApplyChrome();
}
(function wirePlayer() {
    var e = vmEls();
    if (!e.root) return;
    e.stop.addEventListener("click", vmStop);
    e.toggle.addEventListener("click", vmTogglePlay);
    e.bigPlay.addEventListener("click", vmTogglePlay);
    e.artBtn.addEventListener("click", vmTogglePlay);
    e.expand.addEventListener("click", function () { vm.attached = true; vmApplyChrome(); });
    document.addEventListener("keydown", function (ev) {
        if (e.bar && document.activeElement === e.bar) {
            var d = vmDur() || 30;
            var f = vmAudio ? vmAudio.currentTime / d : 0;
            if (ev.key === "ArrowRight") { vmSeekFrac(f + 0.05); ev.preventDefault(); }
            if (ev.key === "ArrowLeft") { vmSeekFrac(f - 0.05); ev.preventDefault(); }
        }
    });
    e.bar.addEventListener("click", function (ev) {
        var r = e.bar.getBoundingClientRect();
        vmSeekFrac((ev.clientX - r.left) / r.width);
    });
})();
/* dock/attach with the section: any path that closes veilSecMusic
   (close button, Escape, opening another section) docks the player —
   playback itself is untouched, exactly like the website. */
(function watchMusicSection() {
    var sec = $("veilSecMusic");
    if (!sec) return;
    new MutationObserver(function () {
        if (!sec.classList.contains("open")) {
            if (vm.track && vm.attached) { vm.attached = false; vmApplyChrome(); }
        }
    }).observe(sec, { attributes: true, attributeFilter: ["class"] });
})();
function musicSectionOpen() {
    renderMusicShelves();
    if (vm.track) { vm.attached = true; vmApplyChrome(); }
}

/* ── section UI: search + shelves ─────────────────────────────── */
var muMetaCache = {};
function fetchMusicMeta(kind, id, cb) {
    var open = musicOpenUrl(kind, id);
    if (muMetaCache[open] !== undefined) { cb(muMetaCache[open]); return; }
    if (!VEIL_ORIGIN) {
        /* origin-free: Spotify's oEmbed is a public JSON endpoint —
           the tunnel fetches it directly */
        tunJson("https://open.spotify.com/oembed?url=" + encodeURIComponent(open))
            .then(function (d) {
                var m = (d && typeof d.title === "string" && typeof d.thumbnail_url === "string")
                    ? { title: d.title, art: d.thumbnail_url } : null;
                muMetaCache[open] = m;
                cb(m);
            })
            .catch(function () { cb(null); });
        return;
    }
    fetch(veilRoute("https://open.spotify.com/oembed?url=" + encodeURIComponent(open)), { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (d) {
            var m = (d && typeof d.title === "string" && typeof d.thumbnail_url === "string")
                ? { title: d.title, art: veilRoute(d.thumbnail_url) } : null;
            muMetaCache[open] = m;
            cb(m);
        })
        .catch(function () { cb(null); });
}
function renderMusicShelves() {
    var host = $("veilMuShelves");
    if (!host || host.__built) return;
    host.__built = true;
    MUSIC_ROWS.forEach(function (row) {
        var sec = el("div", "veil-mu-row");
        var hd = el("div", "veil-mu-row-hd");
        hd.appendChild(el("h3", null, row.label));
        var ln = el("span", "ln"); hd.appendChild(ln);
        sec.appendChild(hd);
        var shelf = el("div", "veil-mu-shelf veil-slim");
        row.items.forEach(function (it) {
            shelf.appendChild(makeEmbedCard(it));
        });
        sec.appendChild(shelf);
        host.appendChild(sec);
    });
}
function makeEmbedCard(it) {
    var card = el("button", "veil-mu-card");
    card.type = "button";
    card.setAttribute("aria-label", "Play " + it.label + " on Spotify");
    var art = el("span", "art");
    art.innerHTML = iconSVG("music", "luc-14");
    card.appendChild(art);
    var tx = el("span", "tx");
    tx.appendChild(el("span", "tt", it.label));
    tx.appendChild(el("span", "ss", it.kind));
    card.appendChild(tx);
    var play = el("span", "pl");
    play.innerHTML = iconSVG("play", "");
    card.appendChild(play);
    var active = false;
    card.addEventListener("click", function () {
        fetchMusicMeta(it.kind, it.id, function (m) {
            vmPlayEmbed(it.kind, it.id, m ? m.title : it.label, m ? m.art : "");
        });
    });
    /* cover art resolves lazily through the oEmbed proxy */
    fetchMusicMeta(it.kind, it.id, function (m) {
        if (m && m.art) {
            art.innerHTML = "";
            var img = el("img");
            img.alt = ""; img.loading = "lazy"; img.decoding = "async";
            img.src = m.art;
            img.onerror = function () { art.innerHTML = iconSVG("music", "luc-14"); };
            art.appendChild(img);
        }
        if (m && m.title) {
            var tt = card.querySelector(".tt");
            if (tt) tt.textContent = m.title;
        }
    });
    return card;
}
function renderSearchResults(items, q, cached) {
    var wrap = $("veilMuResults"), shelf = $("veilMuResShelf"), title = $("veilMuResTitle");
    shelf.innerHTML = "";
    if (!items || !items.length) return;
    items.forEach(function (song) {
        var full = song.source === "soundcloud" && !song.previewOnly;
        var card = el("button", "veil-mu-song");
        card.type = "button";
        card.setAttribute("aria-label", "Play " + song.title + " by " + song.artist + (full ? " — full song" : " — 30 second preview"));
        var art = el("span", "art");
        if (song.art) {
            var img = el("img");
            img.alt = ""; img.loading = "lazy";
            img.src = veilRoute(song.art);
            img.onerror = function () { art.innerHTML = iconSVG("music", "luc-14"); };
            art.appendChild(img);
        } else {
            art.innerHTML = iconSVG("music", "luc-14");
        }
        card.appendChild(art);
        var tx = el("span", "tx");
        tx.appendChild(el("span", "tt", song.title));
        tx.appendChild(el("span", "ss", song.artist));
        var meta = el("span", "meta");
        var pv = el("span", full ? "pv full" : "pv");
        pv.innerHTML = iconSVG(full ? "waves" : "play", "luc-14") + (full ? "Full song" : "30s preview");
        meta.appendChild(pv);
        if (song.ms > 0) meta.appendChild(el("span", "dur", vmFmt(Math.round(song.ms / 1000))));
        tx.appendChild(meta);
        card.appendChild(tx);
        card.addEventListener("click", function () {
            vmPlayPreview(song);
            var prev = shelf.querySelector(".on");
            if (prev) prev.classList.remove("on");
            card.classList.add("on");
        });
        shelf.appendChild(card);
    });
    title.textContent = "Results for \u201C" + q + "\u201D" + (cached ? " — cached" : "");
    wrap.hidden = false;
}
/* the last 12 searches (≤ 32 songs each) ride in localStorage — when the
   birth origin is down (or gone) the library is still browsable offline */
function muCacheRead(q) {
    try {
        var c = JSON.parse(localStorage.getItem("veil:mu-cache") || "[]");
        for (var i = 0; i < c.length; i++) if (c[i].q === q) return c[i];
    } catch (err) {}
    return null;
}
function muCacheWrite(q, items) {
    try {
        var c = JSON.parse(localStorage.getItem("veil:mu-cache") || "[]");
        c = c.filter(function (x) { return x.q !== q; });
        c.unshift({ q: q, at: Date.now(), items: items.slice(0, 32) });
        localStorage.setItem("veil:mu-cache", JSON.stringify(c.slice(0, 12)));
    } catch (err) { /* storage full or blocked — the cache is best-effort */ }
}
(function wireMusicForm() {
    var form = $("veilMuForm");
    if (!form) return;
    form.addEventListener("submit", function (e) {
        e.preventDefault();
        var raw = $("veilMuInput").value.trim();
        var note = $("veilMuNote");
        if (!raw) return;
        var parsed = parseSpotifyInput(raw);
        if (parsed) {
            note.hidden = true;
            fetchMusicMeta(parsed.kind, parsed.id, function (m) {
                vmPlayEmbed(parsed.kind, parsed.id, m ? m.title : "Spotify", m ? m.art : "");
            });
            $("veilMuInput").value = "";
            return;
        }
        if (!VEIL_ORIGIN) {
            /* origin-free path: the engine's tunnel runs the SoundCloud
               chain right here (client-side sc-audio port) — full songs,
               same badging, no re-download needed */
            note.hidden = true;
            var go0 = $("veilMuGo");
            if (go0) go0.classList.add("busy");
            var shelf0 = $("veilMuResShelf"), wrap0 = $("veilMuResults"), title0 = $("veilMuResTitle");
            wrap0.hidden = false;
            title0.textContent = "Searching\u2026";
            shelf0.innerHTML = Array.apply(null, Array(5)).map(function () {
                return '<button type="button" class="veil-mu-song ghost" aria-hidden="true" tabindex="-1"></button>';
            }).join("");
            SC.search(raw.slice(0, 80), 16)
                .then(function (tracks) {
                    if (go0) go0.classList.remove("busy");
                    var items = (tracks || []).map(function (t) {
                        return {
                            id: String(t.id), title: t.title, artist: t.artist, album: "",
                            art: t.art, preview: "", apple: t.permalink, ms: t.ms,
                            source: "soundcloud", previewOnly: !!t.previewOnly, permalink: t.permalink
                        };
                    });
                    if (!items.length) {
                        wrap0.hidden = true;
                        var hitN = muCacheRead(raw.toLowerCase());
                        if (hitN && hitN.items.length) {
                            note.textContent = "No live results — showing cached ones from an earlier search.";
                            note.hidden = false;
                            renderSearchResults(hitN.items, raw, true);
                            return;
                        }
                        note.textContent = "No playable songs matched — try a shorter query (title or artist).";
                        note.hidden = false;
                        return;
                    }
                    muCacheWrite(raw.toLowerCase(), items);
                    renderSearchResults(items, raw);
                })
                .catch(function () {
                    if (go0) go0.classList.remove("busy");
                    wrap0.hidden = true;
                    var hit = muCacheRead(raw.toLowerCase());
                    if (hit && hit.items.length) {
                        note.textContent = "The tunnel is unreachable — showing the cached results. Links still work.";
                        note.hidden = false;
                        renderSearchResults(hit.items, raw, true);
                        return;
                    }
                    note.textContent = "Song search is unreachable right now — try again in a moment.";
                    note.hidden = false;
                });
            return;
        }
        note.hidden = true;
        var go = $("veilMuGo");
        if (go) go.classList.add("busy");
        var shelf = $("veilMuResShelf"), wrap = $("veilMuResults"), title = $("veilMuResTitle");
        wrap.hidden = false;
        title.textContent = "Searching\u2026";
        shelf.innerHTML = Array.apply(null, Array(5)).map(function () {
            return '<button type="button" class="veil-mu-song ghost" aria-hidden="true" tabindex="-1"></button>';
        }).join("");
        fetch(VEIL_ORIGIN + "/api/music/scsearch?q=" + encodeURIComponent(raw.slice(0, 80)), { cache: "no-store" })
            .then(function (r) { if (!r.ok) throw 0; return r.json(); })
            .then(function (d) {
                if (go) go.classList.remove("busy");
                var items = d && d.items ? d.items : [];
                if (!items.length) {
                    wrap.hidden = true;
                    note.textContent = "No playable songs matched — try a shorter query (title or artist).";
                    note.hidden = false;
                    return;
                }
                muCacheWrite(raw.toLowerCase(), items);
                renderSearchResults(items, raw);
            })
            .catch(function () {
                if (go) go.classList.remove("busy");
                wrap.hidden = true;
                var hit = muCacheRead(raw.toLowerCase());
                if (hit && hit.items.length) {
                    note.textContent = "The origin is unreachable — showing the cached results. Titles and links work; playback returns when it's back.";
                    note.hidden = false;
                    renderSearchResults(hit.items, raw, true);
                    return;
                }
                note.textContent = "Song search is unreachable right now — try again in a moment.";
                note.hidden = false;
            });
    });
    var clear = $("veilMuClear");
    if (clear) clear.addEventListener("click", function () {
        $("veilMuResults").hidden = true;
        $("veilMuResShelf").innerHTML = "";
        $("veilMuNote").hidden = true;
    });
})();

/* ═══ 9c. SETTINGS — the control room rows ═════════════════════ */
/* Mirrors the website's SettingsSection › Appearance (+ a local-data
   clear). Every row writes the same localStorage keys the website uses,
   so the file and the site share settings when opened on one machine. */
function applyNtDim() {
    var d = $("veilNtDim");
    if (!d) return;
    var v = LS.get("veil:backdrop-dim");
    var op = v === "55" ? 0.55 : v === "25" ? 0.25 : 0;
    if (op > 0) { d.style.display = ""; d.style.opacity = String(op); }
    else d.style.display = "none";
}
function settingsChanged() {
    tickClock();
    renderWeather();
    applyNtDim();
}
function setRow(opts) {
    /* opts: {icon,label,hint,value,options[{id,label}],onPick(id)} */
    var row = el("div", "veil-set-row");
    var left = el("div", "left");
    var ic = el("span", "ic");
    ic.innerHTML = iconSVG(opts.icon, "");
    left.appendChild(ic);
    var tx = el("div", "tx");
    tx.appendChild(el("p", "lb", opts.label));
    tx.appendChild(el("p", "ss", opts.hint));
    left.appendChild(tx);
    row.appendChild(left);
    var grp = el("div", "grp");
    grp.setAttribute("role", "radiogroup");
    grp.setAttribute("aria-label", opts.label);
    opts.options.forEach(function (o) {
        var b = el("button", "opt" + (opts.value === o.id ? " on" : ""));
        b.type = "button";
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", opts.value === o.id ? "true" : "false");
        b.textContent = o.label;
        b.addEventListener("click", function () {
            opts.onPick(o.id);
            grp.querySelectorAll(".opt").forEach(function (x) { x.classList.remove("on"); x.setAttribute("aria-checked", "false"); });
            b.classList.add("on");
            b.setAttribute("aria-checked", "true");
        });
        grp.appendChild(b);
    });
    row.appendChild(grp);
    return row;
}
function setTextRow(opts) {
    /* opts: {icon,label,hint,value,placeholder,onInput(v)} */
    var row = el("div", "veil-set-row text");
    var left = el("div", "left");
    var ic = el("span", "ic");
    ic.innerHTML = iconSVG(opts.icon, "");
    left.appendChild(ic);
    var tx = el("div", "tx");
    tx.appendChild(el("p", "lb", opts.label));
    tx.appendChild(el("p", "ss", opts.hint));
    left.appendChild(tx);
    row.appendChild(left);
    var inp = el("input", "veil-set-input");
    inp.type = "text";
    inp.value = opts.value;
    inp.placeholder = opts.placeholder || "";
    inp.setAttribute("aria-label", opts.label);
    inp.spellcheck = false;
    inp.maxLength = 24;
    var t = null;
    inp.addEventListener("input", function () {
        window.clearTimeout(t);
        var v = inp.value;
        t = window.setTimeout(function () { opts.onInput(v); }, 220);
    });
    row.appendChild(inp);
    return row;
}
function setDangerRow(opts) {
    /* opts: {icon,label,hint,confirm,onConfirm} */
    var row = el("div", "veil-set-row danger");
    var left = el("div", "left");
    var ic = el("span", "ic");
    ic.innerHTML = iconSVG(opts.icon, "");
    left.appendChild(ic);
    var tx = el("div", "tx");
    tx.appendChild(el("p", "lb", opts.label));
    tx.appendChild(el("p", "ss", opts.hint));
    left.appendChild(tx);
    row.appendChild(left);
    var b = el("button", "veil-set-wipe");
    b.type = "button";
    b.textContent = opts.confirm || "Clear";
    var armed = false, disarm = null;
    b.addEventListener("click", function () {
        if (armed) {
            opts.onConfirm();
            armed = false;
            window.clearTimeout(disarm);
            b.classList.remove("armed");
            b.textContent = opts.confirm || "Clear";
            return;
        }
        armed = true;
        b.classList.add("armed");
        b.textContent = "Sure?";
        disarm = window.setTimeout(function () {
            armed = false;
            b.classList.remove("armed");
            b.textContent = opts.confirm || "Clear";
        }, 3500);
    });
    row.appendChild(b);
    return row;
}
function setInfoRow(opts) {
    /* opts: {icon,label,hint,badge} — a static, non-interactive row
       (behavior facts, e.g. the fixed restart contract). */
    var row = el("div", "veil-set-row");
    var left = el("div", "left");
    var ic = el("span", "ic");
    ic.innerHTML = iconSVG(opts.icon, "");
    left.appendChild(ic);
    var tx = el("div", "tx");
    tx.appendChild(el("p", "lb", opts.label));
    tx.appendChild(el("p", "ss", opts.hint));
    left.appendChild(tx);
    row.appendChild(left);
    var b = el("span", "veil-set-fixed");
    b.textContent = opts.badge || "Fixed";
    row.appendChild(b);
    return row;
}
function renderSettings() {
    var host = $("veilSetRows");
    if (!host) return;
    host.innerHTML = "";
    var clock24 = LS.get("veil:clock-24h") === "1";
    host.appendChild(setRow({
        icon: "history", label: "Clock format",
        hint: "The start-page clock — 12-hour or 24-hour time.",
        value: clock24 ? "24" : "12",
        options: [{ id: "12", label: "12h" }, { id: "24", label: "24h" }],
        onPick: function (id) { LS.set("veil:clock-24h", id === "24" ? "1" : "0"); settingsChanged(); }
    }));
    host.appendChild(setRow({
        icon: "cloud-sun", label: "Weather units",
        hint: "The start-page weather chip — Celsius or Fahrenheit.",
        value: unitF() ? "F" : "C",
        options: [{ id: "C", label: "°C" }, { id: "F", label: "°F" }],
        onPick: function (id) { LS.set(UNIT_KEY, id); settingsChanged(); }
    }));
    host.appendChild(setRow({
        icon: "search", label: "Search engine",
        hint: "What the omnibox queries when input isn't a URL. Bing renders server-side; the others may show their JS shells through the veil.",
        value: searchEngineId(),
        options: Object.keys(SEARCH_ENGINES).map(function (k) { return { id: k, label: SEARCH_ENGINES[k].label }; }),
        onPick: function (id) { LS.set("veil:search-engine", id); settingsChanged(); }
    }));
    host.appendChild(setRow({
        icon: "video", label: "Hover previews",
        hint: "Resting on a live wallpaper card streams a quiet preview. Off saves bandwidth and decoders.",
        value: LS.get("veil:hover-previews") === "0" ? "off" : "on",
        options: [{ id: "on", label: "On" }, { id: "off", label: "Off" }],
        onPick: function (id) { LS.set("veil:hover-previews", id === "on" ? "1" : "0"); settingsChanged(); }
    }));
    var dim = LS.get("veil:backdrop-dim");
    if (dim !== "25" && dim !== "55") dim = "0";
    host.appendChild(setRow({
        icon: "moon", label: "Backdrop dim",
        hint: "A dark scrim between the wallpaper and the page — easier reading on bright wallpapers.",
        value: dim,
        options: [{ id: "0", label: "Off" }, { id: "25", label: "Subtle" }, { id: "55", label: "Deep" }],
        onPick: function (id) { LS.set("veil:backdrop-dim", id); settingsChanged(); }
    }));
    host.appendChild(setTextRow({
        icon: "sun", label: "Greeting name",
        hint: "The weather chip's greeting learns your name — \u201CGood evening, Sam\u201D.",
        value: (LS.get("veil:greeting-name") || "").slice(0, 24),
        placeholder: "Your name (optional)",
        onInput: function (v) {
            v = v.trim().slice(0, 24);
            if (v) LS.set("veil:greeting-name", v); else LS.del("veil:greeting-name");
            settingsChanged();
        }
    }));

    /* ── Browsing — session behavior (mirrors the website's Browsing
       tab; the veil:keep-session key is shared with the site). The file
       has always KEPT the session across tab switches, so "keep" is the
       default here; opting into "Start page" mirrors the website's
       reset-on-return. Read live: the very next switch obeys. */
    host.appendChild(setRow({
        icon: "panel", label: "When I come back",
        hint: "Opening another browser tab (or switching away) and returning — reset to the start page, or keep the page you were on. Applies to the very next switch.",
        value: LS.get("veil:keep-session") === "0" ? "reset" : "keep",
        options: [{ id: "reset", label: "Start page" }, { id: "keep", label: "Keep my page" }],
        onPick: function (id) { LS.set("veil:keep-session", id === "keep" ? "1" : "0"); }
    }));
    host.appendChild(setInfoRow({
        icon: "reload", label: "Restart behavior",
        hint: "Always the start page. Reloading the veil (or reopening it later) never restores the previous browsing session — the saved tab strip is scrubbed on every boot.",
        badge: "Fixed"
    }));
    host.appendChild(setDangerRow({
        icon: "trash", label: "Wallpaper selection",
        hint: "The currently applied background (keeps your favorites).",
        confirm: "Clear",
        onConfirm: function () {
            LS.del(WP_KEY);
            curSel = null;
            /* mirror applyWallpaper's reset, then show the default theme
               (applyWallpaper(null) is not a valid call shape) */
            var img = $("veilNtImg"), vid = $("veilNtVid"), fill = $("veilNtFill");
            img.style.display = "none"; vid.style.display = "none";
            try { vid.pause(); } catch (e) {}
            img.classList.remove("ambient"); vid.classList.remove("ambient");
            if (fill) { fill.classList.remove("on"); fill.style.display = "none"; fill.style.backgroundImage = ""; }
            var themeDiv = $("veilNtTheme");
            if (themeDiv) themeDiv.style.display = "";
            renderWpGrid();
            toast("Wallpaper selection cleared — the default look is back.");
        }
    }));
    host.appendChild(setDangerRow({
        icon: "trash", label: "Favorites & recent sites",
        hint: "Wallpaper hearts and this file's own recents list.",
        confirm: "Clear",
        onConfirm: function () {
            LS.del(FAV_KEY);
            LS.del(HIST_KEY);
            renderRecent();
            renderHistSection();
            renderWpGrid();
            toast("Favorites and recents cleared.");
        }
    }));
}

/* ═══ 10. WALLPAPERS ═══════════════════════════════════════════ */
var WP_KEY = "veil:wallpaper:v1";
var FAV_KEY = "veil:wallpaper-favs:v1";
var PACK = (window.__VEIL_PACK__ || []).map(function (w) {
    return { id: w.id, name: w.name, kind: w.kind, tags: w.tags, desc: w.desc, mime: w.mime, key: w.key };
});
var THEMES = window.__VEIL_THEMES__ || {};
var THEME_LIST = window.__VEIL_THEME_LIST__ || [];
var THUMBS = window.__VEIL_THUMBS__ || {};
var UGS_LIST = "https://cdn.jsdelivr.net/gh/bubbls/ugs-singlefile@main/games.js";
var UGS_FILE = "https://cdn.jsdelivr.net/gh/bubbls/ugs-singlefile/UGS-Files/";

/* embedded assets live in text/veil-asset script blocks */
var blobCache = {};
function assetBlob(key, mime) {
    if (blobCache[key]) return blobCache[key];
    var node = document.getElementById("veilA:" + key);
    var blob = null;
    if (node) {
        try {
            var bin = atob(node.textContent.replace(/\s+/g, ""));
            var u8 = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            blob = new Blob([u8], { type: mime });
        } catch (e) { return null; }
    } else if (EXT_BLOBS[key]) {
        /* extension-pack asset (installed this session) */
        blob = EXT_BLOBS[key];
    } else return null;
    var url = URL.createObjectURL(blob);
    blobCache[key] = url;
    return url;
}
function packById(id) { for (var i = 0; i < PACK.length; i++) if (PACK[i].id === id) return PACK[i]; return null; }
function readSel() {
    try {
        var s = JSON.parse(LS.get(WP_KEY) || "null");
        if (s && (s.kind === "image" || s.kind === "video" || s.kind === "theme")) return s;
    } catch (e) {}
    return null;
}
function writeSel(s) { LS.set(WP_KEY, JSON.stringify(s)); }
function readFavs() {
    try { var a = JSON.parse(LS.get(FAV_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function writeFavs(a) { LS.set(FAV_KEY, JSON.stringify(a.slice(-400))); }

var curSel = readSel();
var THEME_VARS = {
    sulfur:  ["rgba(250,204,21,.14)", "rgba(251,146,60,.10)", "linear-gradient(to bottom, #451a03, #09090b)"],
    emerald: ["rgba(16,185,129,.16)", "rgba(13,148,136,.10)", "linear-gradient(to bottom, #022c22, #09090b)"],
    aurora:  ["rgba(52,211,153,.13)", "rgba(129,140,248,.12)", "linear-gradient(to bottom, #022c22, #09090b, #1e1b4b)"],
    nebula:  ["rgba(167,139,250,.14)", "rgba(236,72,153,.10)", "linear-gradient(to bottom, #2e1065, #09090b)"],
    grid:    ["rgba(236,72,153,.10)", "rgba(34,211,238,.10)", "linear-gradient(to bottom, #4a044e, #09090b)"],
    sunset:  ["rgba(251,146,60,.15)", "rgba(244,63,94,.10)", "linear-gradient(to bottom, #431407, #09090b)"],
    ocean:   ["rgba(56,189,248,.13)", "rgba(45,212,191,.10)", "linear-gradient(to bottom, #082f49, #09090b)"],
    ash:     ["rgba(161,161,170,.10)", "rgba(239,68,68,.07)", "linear-gradient(to bottom, #18181b, #09090b)"],
    mono:    ["rgba(228,228,231,.08)", "rgba(113,113,122,.08)", "linear-gradient(to bottom, #18181b, #000)"]
};
/* Ambient-fill helper: squarish/portrait sources (w/h < 1.2) would be
   heavily cover-cropped on landscape screens ("zoomed in"). Those render
   contained (whole picture) over a blurred poster/thumbnail filling the
   screen. Landscape 4:3+ keeps the classic full-bleed cover. */
function setAmbientFill(el, src, w, h) {
    var fill = $("veilNtFill");
    if (!fill) return;
    var squarish = w > 0 && h > 0 && w / h < 1.2;
    if (squarish) {
        el.classList.add("ambient");
        var poster = el.tagName === "VIDEO"
            ? (el.getAttribute("poster") || (src && String(src).indexOf("data:") === 0 ? src : null))
            : src;
        if (poster) {
            fill.style.backgroundImage = "url(\"" + poster + "\")";
            fill.classList.add("on");
            fill.style.display = "";
        }
    } else {
        el.classList.remove("ambient");
        fill.classList.remove("on");
        fill.style.display = "none";
        fill.style.backgroundImage = "";
    }
}

function applyWallpaper(s, persist) {
    var themeDiv = $("veilNtTheme"), img = $("veilNtImg"), vid = $("veilNtVid");
    img.style.display = "none"; vid.style.display = "none"; vid.pause();
    img.classList.remove("ambient"); vid.classList.remove("ambient");
    var fill = $("veilNtFill");
    if (fill) { fill.classList.remove("on"); fill.style.display = "none"; fill.style.backgroundImage = ""; }
    if (s.kind === "theme") {
        themeDiv.style.display = "";
        var tv = THEME_VARS[s.theme] || THEME_VARS.emerald;
        themeDiv.style.background = tv[2];
        themeDiv.querySelector(".orbA").style.background = tv[0];
        themeDiv.querySelector(".orbB").style.background = tv[1];
    } else if (s.kind === "image") {
        themeDiv.style.display = "none";
        var p = packById(s.id);
        var src = s.src && s.src.indexOf("data:") === 0 ? s.src : (p ? assetBlob(p.key, p.mime) : s.src);
        if (src) {
            var tries = 0;
            var armRetry = function () {
                img.onload = function () {
                    setAmbientFill(img, img.src, img.naturalWidth, img.naturalHeight);
                    img.onload = null; img.onerror = null;
                };
                img.onerror = function () {
                    /* online wallpapers can lose the race with a cold
                       server compile on boot — retry a couple of times */
                    img.onerror = null;
                    if (/^https?:/.test(String(src)) && tries < 2) {
                        tries++;
                        setTimeout(function () { img.src = src; armRetry(); }, 3500 * tries);
                    }
                };
            };
            armRetry();
            img.src = src; img.style.display = "";
        }
    } else if (s.kind === "video") {
        themeDiv.style.display = "none";
        var pv = packById(s.id);
        var vsrc = s.src && s.src.indexOf("data:") === 0 ? s.src : (pv ? assetBlob(pv.key, pv.mime) : s.src);
        if (vsrc) {
            var poster = s.thumb || (THUMBS[pv ? pv.key : ""] || null);
            if (poster) vid.poster = poster;
            vid.onerror = function () {
                /* online wallpapers die quietly when the origin is gone:
                   fall back to the poster still-frame, then the theme */
                vid.onerror = null;
                if (vid.poster) {
                    img.onload = function () { setAmbientFill(img, img.src, img.naturalWidth, img.naturalHeight); };
                    img.src = vid.poster;
                    vid.style.display = "none";
                    img.style.display = "";
                    toast("The live wallpaper's stream is unreachable — showing its poster frame", true);
                }
            };
            vid.onloadedmetadata = function () {
                setAmbientFill(vid, vid.poster || null, vid.videoWidth, vid.videoHeight);
                vid.onloadedmetadata = null;
            };
            if (!VEIL_ORIGIN && mbgsIsDirect(vsrc)) {
                /* hotlink-protected live video + no origin: resolve a
                   tunneled blob, keep s.src (the real URL) for persistence */
                var apToken = s;
                vid.style.display = "";
                mbgsResolveVideo(s.id, vsrc).then(function (burl) {
                    if (curSel !== apToken) return; /* a different wallpaper took over */
                    vid.src = burl;
                    var pr2 = vid.play();
                    if (pr2 && pr2.catch) pr2.catch(function () {});
                }).catch(function () {
                    if (curSel !== apToken) return;
                    vid.onerror = null;
                    if (vid.poster) {
                        img.onload = function () { setAmbientFill(img, img.src, img.naturalWidth, img.naturalHeight); };
                        img.src = vid.poster;
                        vid.style.display = "none";
                        img.style.display = "";
                    }
                    toast("The live wallpaper wouldn't stream — showing its poster frame", true);
                });
            } else {
                vid.src = vsrc;
                vid.style.display = "";
                var pr = vid.play();
                if (pr && pr.catch) pr.catch(function () {});
            }
        }
    }
    if (persist !== false) writeSel(s);
    curSel = s;
}
/* upload flow (session) */
var uploadInput = null;
document.querySelector('[data-wtab="upload"]').addEventListener("click", function () {
    if (!uploadInput) {
        uploadInput = el("input");
        uploadInput.type = "file";
        uploadInput.accept = "image/*,video/*";
        uploadInput.style.display = "none";
        document.body.appendChild(uploadInput);
        uploadInput.addEventListener("change", function () {
            var f = uploadInput.files && uploadInput.files[0];
            if (!f) return;
            var r = new FileReader();
            r.onload = function () {
                var uri = String(r.result || "");
                var sel = { id: "up-custom", src: uri, kind: /^video\//.test(f.type) ? "video" : "image", name: f.name.replace(/\.[a-z0-9]+$/i, "") };
                applyWallpaper(sel, true);
                toast("Wallpaper applied");
            };
            r.readAsDataURL(f);
            uploadInput.value = "";
        });
    }
    uploadInput.click();
});
/* tabs */
var wpTab = "pack";
var wpPackQ = ""; /* the local (pack/themes) query — the online tabs keep their own st.q */
document.querySelectorAll(".veil-wp-tabs .tb").forEach(function (tb) {
    if (tb.getAttribute("data-wtab") !== "upload") {
        tb.addEventListener("click", function () {
            document.querySelectorAll(".veil-wp-tabs .tb").forEach(function (x) { x.classList.toggle("on", x === tb); });
            wpTab = tb.getAttribute("data-wtab");
            /* a query is per-tab — switching resets it (same UX as the category chips) */
            wpPackQ = "";
            liveState.q = ""; k4State.q = "";
            if ($("veilWpSearch")) $("veilWpSearch").value = "";
            renderWpGrid();
        });
    }
});
function isApplied(id) { return !!(curSel && curSel.id === id); }

/* ── online catalogs (Live = motionbgs, 4K = 4kwallpapers) ───────
   The same feeds the website browses, served by this file's birth
   origin (/api/wallpapers/live, /api/wallpapers). Media streams back
   through the origin's veil door (curl-accelerated disk cache for the
   live videos), so nothing ever hits a bot wall. */
var LIVE_CATS = [
    ["recent", "Recent"], ["anime", "Anime"], ["superhero", "Superhero"],
    ["nature", "Nature"], ["scifi", "Sci-Fi"], ["cyberpunk", "Cyberpunk"], ["space", "Space"],
    ["dark", "Dark"], ["city", "City"], ["aesthetic", "Aesthetic"], ["animals", "Animals"],
    ["fantasy", "Fantasy"], ["horror", "Horror"], ["minimal", "Minimal"], ["cars", "Cars"], ["neon", "Neon"]
];
var K4_CATS = [
    ["recent", "Recent"], ["nature", "Nature"], ["anime", "Anime"],
    ["abstract", "Abstract"], ["cars", "Cars"], ["minimal", "Minimal"], ["dark", "Dark"],
    ["fantasy", "Fantasy"], ["space", "Space"], ["aesthetic", "Aesthetic"], ["animals", "Animals"],
    ["architecture", "Architecture"], ["flowers", "Flowers"], ["movies", "Movies"], ["music", "Music"], ["cute", "Cute"]
];
var liveState = { cat: "recent", q: "", page: 1, items: [], hasMore: false, loading: false, loaded: false, warmed: "" };
var hoverToken = 0; /* stale hover-blob guard */
var k4State = { cat: "recent", q: "", page: 1, items: [], hasMore: false, loading: false, loaded: false };
function onlineState() { return wpTab === "live" ? liveState : k4State; }

var wpSearchTimer = null;
$("veilWpSearch").addEventListener("input", function () {
    clearTimeout(wpSearchTimer);
    var v = this.value;
    wpSearchTimer = setTimeout(function () {
        var q = v.trim().toLowerCase();
        /* the set pack + themes are LOCAL — filter them right here, no
           origin needed. Only the Live/4K tabs query the online feeds. */
        if (wpTab === "pack" || wpTab === "themes" || wpTab === "upload") {
            if (q === wpPackQ) return;
            wpPackQ = q;
            renderWpGrid();
            return;
        }
        var st = onlineState();
        if (q === st.q) return;
        st.q = q;
        st.page = 1;
        loadOnlineFeed(true);
    }, 400);
});

function renderCats() {
    var which = wpTab;
    var cats = which === "live" ? LIVE_CATS : K4_CATS;
    var st = onlineState();
    var box = $("veilWpCats");
    box.innerHTML = "";
    box.setAttribute("aria-label", which === "live" ? "Live wallpaper categories" : "4K wallpaper categories");
    cats.forEach(function (c) {
        var chip = el("button", "chip" + (st.cat === c[0] ? " on" : ""), c[1]);
        chip.type = "button";
        chip.setAttribute("role", "tab");
        chip.setAttribute("aria-selected", st.cat === c[0] ? "true" : "false");
        chip.addEventListener("click", function () {
            if (st.cat === c[0]) return;
            st.cat = c[0];
            st.q = "";
            st.page = 1;
            $("veilWpSearch").value = "";
            renderCats();
            loadOnlineFeed(true);
        });
        box.appendChild(chip);
    });
}

function setWpStat(text, isErr) {
    var s = $("veilWpStat");
    s.textContent = text || "";
    s.classList.toggle("err", !!isErr);
}

function onlineApiBase() {
    return wpTab === "live" ? "/api/wallpapers/live" : "/api/wallpapers";
}

/* ── offline catalog cache ──────────────────────────────────────
   The Live/4K catalogs stream from the network (through the origin or
   the tunnel). When neither answers — plane wifi, captive portals,
   engine cold start — the last page that loaded HERE replays from
   localStorage so the tab still shows a real grid, and a dead-end
   banner offers the embedded pack (which always works). */
var WP_CACHE_KEY = "veil:wp-cache:v1";
function wpCacheLoad(tab, cat, q) {
    try {
        var all = JSON.parse(localStorage.getItem(WP_CACHE_KEY) || "{}");
        var e = all[tab + "|" + cat + "|" + (q || "")];
        return e && e.items && e.items.length ? e : null;
    } catch (err) { return null; }
}
function wpCacheSave(tab, cat, q, items, hasMore) {
    try {
        var all = JSON.parse(localStorage.getItem(WP_CACHE_KEY) || "{}");
        var key = tab + "|" + cat + "|" + (q || "");
        var trimmed = (items || []).slice(0, 60);
        if (JSON.stringify(trimmed).length > 200000) trimmed = trimmed.slice(0, 28);
        all[key] = { items: trimmed, hasMore: !!hasMore, at: Date.now() };
        var keys = Object.keys(all);
        if (keys.length > 24) {
            keys.sort(function (a, b) { return (all[a].at || 0) - (all[b].at || 0); });
            while (keys.length > 24) delete all[keys.shift()];
        }
        localStorage.setItem(WP_CACHE_KEY, JSON.stringify(all));
    } catch (err) {
        /* quota — keep the newest half and the fresh entry only */
        try {
            var all2 = JSON.parse(localStorage.getItem(WP_CACHE_KEY) || "{}");
            var k2 = Object.keys(all2);
            k2.sort(function (a, b) { return (all2[a].at || 0) - (all2[b].at || 0); });
            k2.slice(0, Math.ceil(k2.length / 2)).forEach(function (k) { delete all2[k]; });
            all2[tab + "|" + cat + "|" + (q || "")] = { items: (items || []).slice(0, 30), hasMore: !!hasMore, at: Date.now() };
            localStorage.setItem(WP_CACHE_KEY, JSON.stringify(all2));
        } catch (e2) { /* no storage at all — the cache is best-effort */ }
    }
}
function wpCacheAge(at) {
    var s = Math.max(1, Math.round((Date.now() - at) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " d ago";
}
function renderOfflineDeadEnd(err, isLive) {
    var grid = $("veilWpGrid");
    if (!grid) return;
    grid.innerHTML = "";
    $("veilWpMore").hidden = true;
    $("veilWpCount").textContent = "";
    $("veilWpSub2").textContent = "the catalog needs the network — the pack never does";
    var nb = el("div", "loadbox warn");
    nb.innerHTML = iconSVG("cloud", "") +
        '<div><b>The ' + (isLive ? "live" : "4K") + " catalog streams from the network</b>, and it isn't answering" +
        (err && err.message ? " (" + esc(err.message) + ")" : "") +
        '.<br>Everything embedded in this file keeps working — and the next time the catalog loads, it caches itself for offline.</div>';
    var btn = el("button", "chip on");
    btn.type = "button";
    btn.innerHTML = iconSVG("image", "luc-14") + "<span>open the embedded pack — always offline</span>";
    btn.setAttribute("aria-label", "Switch to the embedded wallpaper pack");
    btn.addEventListener("click", function () {
        var t = document.querySelector('[data-wtab="pack"]');
        if (t) t.click();
    });
    nb.appendChild(btn);
    grid.appendChild(nb);
    setWpStat("Catalog offline — the pack works", true);
}

function loadOnlineFeed(replace) {
    var st = onlineState();
    var next = replace ? 1 : st.page + 1;
    if (st.loading) return;
    st.loading = true;
    if (replace) {
        st.items = [];
        st.hasMore = false;
        $("veilWpGrid").innerHTML = "";
        var box = el("div", "loadbox");
        box.innerHTML = iconSVG("reload", "spin") + "<div>" + (VEIL_ORIGIN ? "Loading the catalog from Veil's origin…" : "Loading the catalog through the tunnel…") + "</div>";
        $("veilWpGrid").appendChild(box);
        $("veilWpMore").hidden = true;
        setWpStat("Loading…");
    } else {
        setWpStat("Loading more…");
    }
    var applyResults = function (items, hasMore) {
        st.loading = false;
        st.loaded = true;
        if (replace) st.items = items;
        else {
            var seen = {};
            st.items.forEach(function (x) { seen[x.id] = 1; });
            items.forEach(function (x) { if (!seen[x.id]) st.items.push(x); });
        }
        st.page = next;
        st.hasMore = !!hasMore;
        /* first pages get an offline copy — the next time the network (or
           the engine) is down, the catalog replays from localStorage */
        if (next === 1) wpCacheSave(wpTab, st.cat, st.q, st.items, hasMore);
        renderOnlineGrid();
    };
    var failResults = function (err) {
        st.loading = false;
        st.loaded = true;
        if (replace) {
            var cached = wpCacheLoad(wpTab, st.cat, st.q);
            if (cached) {
                st.items = cached.items;
                st.page = 1;
                st.hasMore = false;
                renderOnlineGrid();
                setWpStat("Offline — showing the " + (wpTab === "live" ? "live" : "4K") + " catalog you loaded here · cached " + wpCacheAge(cached.at || Date.now()), true);
                $("veilWpSub2").textContent = "cached copy — posters already seen may still glow; fresh ones return with the network";
                return;
            }
            st.items = [];
            renderOfflineDeadEnd(err, wpTab === "live");
            return;
        }
        renderOnlineGrid();
        setWpStat("The catalog is unreachable right now" + (err && err.message ? " (" + err.message + ")" : ""), true);
    };
    if (!VEIL_ORIGIN) {
        /* origin-free: the engine's tunnel fetches the catalog pages and
           the ported parsers slice them right here — same feeds, no site */
        var isLive = wpTab === "live";
        var url = isLive ? wpMbgUrl(st.cat, next, st.q) : wp4kUrl(st.cat, next, st.q);
        var attempt = 0;
        var tryFetch = function (u) {
            tunText(u)
                .then(function (html) {
                    var items = isLive ? wpParseMbg(html) : wpParse4k(html, st.cat === "recent" ? "recent" : st.cat);
                    /* the 4K search is an exact-tag match — when the query as
                       typed finds nothing, retry the looser rewrites */
                    if (!isLive && !items.length && st.q && attempt < wp4kVariants(st.q).length) {
                        var v = wp4kVariants(st.q)[attempt++];
                        tryFetch(wp4kUrl(st.cat, 1, v));
                        return;
                    }
                    var hasMore = isLive
                        ? (items.length >= 30 && !st.q)
                        : (items.length >= 40 && !st.q);
                    applyResults(items, hasMore);
                })
                .catch(failResults);
        };
        tryFetch(url);
        return;
    }
    var params = "?cat=" + encodeURIComponent(st.cat) + "&page=" + next;
    if (st.q) params += "&q=" + encodeURIComponent(st.q);
    fetch(VEIL_ORIGIN + onlineApiBase() + params, { cache: "no-store" })
        .then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            var ct = r.headers.get("content-type") || "";
            /* a captive portal or a restarting origin answers HTML — never
               let that surface as "Unexpected token" */
            if (ct.indexOf("json") === -1) throw new Error("the origin answered a web page");
            return r.json();
        })
        .then(function (j) { applyResults(j && j.items || [], !!(j && j.hasMore)); })
        .catch(failResults);
}

function renderOriginNotice() {
    /* unreachable-feature notice is nearly retired: the tunnel serves
       the catalogs even without a birth origin. Kept as the dead-end
       for copies whose engine can't tunnel either. */
    var grid = $("veilWpGrid");
    grid.innerHTML = "";
    $("veilWpMore").hidden = true;
    $("veilWpCount").textContent = "";
    var nb = el("div", "loadbox warn");
    nb.innerHTML = iconSVG("alert", "") +
        '<div>The catalogs load through this file\'s tunneling engine — it is not answering. Reload the page (the engine warms up in a few seconds) and try again. The embedded pack and themes always work offline.</div>';
    grid.appendChild(nb);
    setWpStat("Tunnel unavailable");
    $("veilWpSub2").textContent = "The engine needs a moment — reload once";
}

function renderOnlineGrid() {
    var st = onlineState();
    var grid = $("veilWpGrid");
    grid.innerHTML = "";
    var favs = readFavs();
    var isLive = wpTab === "live";
    $("veilWpSub").textContent = isLive
        ? "Live wallpapers — motionbgs.com, streamed through the veil"
        : "4K wallpapers — the catalog, streamed through the veil";
    $("veilWpSub2").textContent = isLive
        ? (VEIL_ORIGIN ? "Hover to preview · click to apply — videos load from the origin's cache" : "Hover to preview · click to apply — videos stream through the tunnel")
        : "Click a wallpaper to preview and apply its best 4K file";
    $("veilWpCount").textContent = st.items.length ? st.items.length + (isLive ? " live" : " in 4K") : "";
    if (!st.items.length) {
        var nb = el("div", "loadbox warn");
        nb.innerHTML = iconSVG("search", "") + '<div>No wallpapers matched' + (st.q ? ' "' + esc(st.q) + '"' : "") + ".</div>";
        grid.appendChild(nb);
        $("veilWpMore").hidden = true;
        return;
    }
    st.items.forEach(function (w) {
        var id = (isLive ? "mbg-" : "4k-") + w.id;
        var card = el("div", "veil-wp-card" + (isApplied(id) ? " has-active" : ""));
        card.setAttribute("role", "button");
        card.tabIndex = 0;
        card.setAttribute("aria-label", (w.name || "wallpaper") + (isLive ? " (live wallpaper)" : " (4K wallpaper)"));
        var media = el("div", "media");
        var thumbUrl = veilRoute(w.thumb);
        var im = el("img");
        im.alt = ""; im.loading = "lazy";
        im.src = thumbUrl;
        /* Thumbnail self-heal (mirrors the app's grid cards): cold thumbs
           fail transiently through the proxy; the server-side retry chain
           commits the file within seconds, so one delayed remount recovers
           the card. Only genuinely dead thumbs stay dimmed. */
        var thumbRound = 0;
        im.onerror = function () {
            if (thumbRound < 1) {
                thumbRound++;
                window.setTimeout(function () { im.src = thumbUrl; }, 3000);
                return;
            }
            im.style.opacity = ".2";
        };
        media.appendChild(im);
        var hoverVid = null;
        card.appendChild(media);
        var kind = el("span", "kind " + (isLive ? "live" : "k4"));
        kind.innerHTML = iconSVG(isLive ? "video" : "image", "luc-14") + (isLive ? "live" : "4K");
        card.appendChild(kind);
        if (isApplied(id)) card.appendChild(el("span", "active", "Active"));
        var fav = el("span", "fav" + (favs.indexOf(id) !== -1 ? " on" : ""));
        fav.setAttribute("role", "button");
        fav.title = "Favorite";
        fav.innerHTML = iconSVG("heart", "luc-14");
        fav.addEventListener("click", function (e) {
            e.stopPropagation();
            var f = readFavs();
            var i = f.indexOf(id);
            if (i === -1) f.push(id); else f.splice(i, 1);
            writeFavs(f);
            fav.classList.toggle("on", i === -1);
        });
        card.appendChild(fav);
        var shade = el("div", "shade");
        card.appendChild(shade);
        var meta = el("div", "meta");
        meta.appendChild(el("span", "nm", w.name || "Untitled"));
        var src = el("span", "src", isLive ? "motionbgs" : "4kwallpapers");
        meta.appendChild(src);
        card.appendChild(meta);
        if (isLive) {
            var vidUrl = veilRoute(w.video);
            var hoverResolveBusy = false;
            card.addEventListener("mouseenter", function () {
                /* Settings › Appearance can disable hover previews —
                   read live so the flip applies immediately. */
                if (LS.get("veil:hover-previews") === "0") return;
                if (!hoverVid) {
                    hoverVid = el("video");
                    hoverVid.muted = true; hoverVid.loop = true; hoverVid.playsInline = true;
                    hoverVid.preload = "none";
                    hoverVid.poster = thumbUrl;
                    hoverVid.className = "hovervid";
                    /* appended AFTER the thumb <img> so the video paints on top */
                    media.appendChild(hoverVid);
                    if (!VEIL_ORIGIN && mbgsIsDirect(vidUrl)) {
                        /* hotlink-protected + no origin: resolve a tunneled
                           blob on first hover (session-cached — later cards
                           with the same id reuse it instantly) */
                        var hovToken = ++hoverToken;
                        mbgsResolveVideo(id, vidUrl).then(function (burl) {
                            if (hovToken !== hoverToken || !hoverVid.isConnected) return;
                            hoverVid.src = burl;
                            var hp = hoverVid.play();
                            if (hp && hp.catch) hp.catch(function () {});
                        }).catch(function () { /* poster stays */ });
                    } else {
                        hoverVid.src = vidUrl;
                    }
                } else if (!hoverVid.src && !hoverResolveBusy) {
                    hoverVid.src = vidUrl;
                }
                if (hoverVid.src) {
                    var pr = hoverVid.play();
                    if (pr && pr.catch) pr.catch(function () {});
                }
            });
            card.addEventListener("mouseleave", function () {
                if (hoverVid) { hoverVid.pause(); }
            });
        }
        var open = function () {
            openLightbox({
                id: id, key: null, kind: isLive ? "video" : "image",
                name: w.name, src: isLive ? veilRoute(w.video) : "", thumb: thumbUrl,
                detail: !isLive ? w.detail : null, cat: w.category || (isLive ? "live" : "4k"),
                tags: isLive ? ["live", "motionbgs"] : ["4k", w.category || "catalog"],
                online: true
            });
        };
        card.addEventListener("click", open);
        card.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
        grid.appendChild(card);
    });
    $("veilWpMore").hidden = !st.hasMore;
    setWpStat(st.items.length + (isLive ? " live wallpapers" : " wallpapers"));
    if (isLive) prewarmLive(st);
}

/* staggered HEAD pre-warms: the origin's disk cache downloads the first
   few videos so hover previews start almost instantly */
function prewarmLive(st) {
    var key = st.cat + "#" + st.q;
    if (st.warmed === key || !st.items.length) return;
    st.warmed = key;
    st.items.slice(0, 6).forEach(function (it, i) {
        setTimeout(function () {
            fetch(veilRoute(it.video), { method: "HEAD" }).catch(function () {});
        }, 350 + i * 450);
    });
}

$("veilWpShuffle").addEventListener("click", function () {
    var st = liveState;
    if (st.loading) return;
    setWpStat("Shuffling…");
    var cats = LIVE_CATS.map(function (c) { return c[0]; });
    var cat = cats[Math.floor(Math.random() * cats.length)];
    var pick = function (pool) {
        var it = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
        if (!it) throw 0;
        var sel = {
            id: "mbg-" + it.id, kind: "video", name: it.name,
            src: veilRoute(it.video), thumb: veilRoute(it.thumb)
        };
        applyWallpaper(sel, true);
        toast("Shuffled — " + (it.name || "a live wallpaper"));
        if (wpTab === "live") renderOnlineGrid();
    };
    if (!VEIL_ORIGIN) {
        tunText(wpMbgUrl(cat, 1, ""))
            .then(function (html) {
                var pool = wpParseMbg(html);
                if (!pool.length && st.items.length) pool = st.items;
                pick(pool);
            })
            .catch(function () {
                if (st.items.length) { try { pick(st.items); return; } catch (e) {} }
                setWpStat("Shuffle failed — try again", true);
            });
        return;
    }
    fetch(VEIL_ORIGIN + "/api/wallpapers/live?cat=" + encodeURIComponent(cat), { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (j) {
            pick((j && j.items && j.items.length) ? j.items : st.items);
        })
        .catch(function () {
            setWpStat("Shuffle failed — try again", true);
        });
});

$("veilWpMoreBtn").addEventListener("click", function () { loadOnlineFeed(false); });

function renderWpGrid() {
    var grid = $("veilWpGrid");
    grid.innerHTML = "";
    var online = wpTab === "live" || wpTab === "4k";
    $("veilWpOnline").hidden = !online;
    if (online) {
        $("veilWpShuffle").hidden = wpTab !== "live";
        renderCats();
        var st = onlineState();
        if (!st.loaded) { loadOnlineFeed(true); return; }
        renderOnlineGrid();
        return;
    }
    var favs = readFavs();
    var items;
    if (wpTab === "themes") {
        items = THEME_LIST.map(function (t) { return { id: "anim-" + t.key, name: t.name, kind: "theme", theme: t.key, tags: t.tags, desc: t.desc }; });
        $("veilWpSub").textContent = "Procedural animated themes — pure CSS, zero bytes";
        $("veilWpCount").textContent = items.length + " themes";
    } else {
        items = PACK.slice();
        $("veilWpSub").textContent = "The set pack — embedded at native 4K, works offline";
    }
    /* the local query filters BOTH the pack and the themes — name, tags
       and description all count as matches */
    if (wpPackQ) {
        items = items.filter(function (w) {
            var hay = ((w.name || "") + " " + ((w.tags || [])).join(" ") + " " + (w.desc || "")).toLowerCase();
            return hay.indexOf(wpPackQ) !== -1;
        });
        if (wpTab === "themes") $("veilWpSub").textContent = items.length + " theme" + (items.length === 1 ? "" : "s") + " match “" + wpPackQ + "”";
        else $("veilWpSub").textContent = items.length + " wallpaper" + (items.length === 1 ? "" : "s") + " match “" + wpPackQ + "” — embedded, works offline";
        if (!items.length) {
            grid.innerHTML = "";
            var nbq = el("div", "loadbox warn");
            nbq.innerHTML = iconSVG("search", "") + '<div>No wallpapers matched "' + esc(wpPackQ) + '".</div>';
            grid.appendChild(nbq);
            $("veilWpSub2").textContent = "Try another word — or clear the search to see the whole pack";
            return;
        }
    }
    if (wpTab !== "themes") {
        items.sort(function (a, b) {
            var fa = favs.indexOf(a.id) !== -1, fb = favs.indexOf(b.id) !== -1;
            return fa !== fb ? (fa ? -1 : 1) : 0;
        });
        $("veilWpCount").textContent = items.length + " wallpapers";
    }
    $("veilWpSub2").textContent = wpTab === "themes"
        ? "Live gradients and drifting light — the site's own animated backdrops"
        : "Click any card to preview, then set it as your start-page background";
    items.forEach(function (w) {
        var card = el("div", "veil-wp-card" + (isApplied(w.id) ? " has-active" : ""));
        card.setAttribute("role", "button");
        card.tabIndex = 0;
        card.setAttribute("aria-label", (w.name || "wallpaper") + (w.kind === "video" ? " (live wallpaper)" : w.kind === "theme" ? " (animated theme)" : " (wallpaper)"));
        var media = el("div", "media");
        if (w.kind === "theme") {
            var tv = THEME_VARS[w.theme] || THEME_VARS.emerald;
            var thm = el("div", "thm");
            thm.style.background = tv[2];
            media.appendChild(thm);
            var o = el("div", "veil-orb-a");
            o.style.cssText = "position:absolute;top:-30%;left:15%;width:70%;height:70%;border-radius:999px;filter:blur(60px);background:" + tv[0];
            media.appendChild(o);
        } else if (w.kind === "video") {
            if (THUMBS[w.key]) {
                /* Poster card: the embedded thumb jpeg is the card visual (a
                   <video> cannot render a jpeg src — that showed dark cards).
                   The real video plays in the preview/lightbox. */
                var imv = el("img");
                imv.alt = ""; imv.loading = "lazy";
                imv.src = THUMBS[w.key];
                media.appendChild(imv);
            } else {
                var v = el("video");
                v.muted = true; v.loop = true; v.playsInline = true; v.preload = "metadata";
                v.src = assetBlob(w.key, w.mime);
                media.appendChild(v);
                card.addEventListener("mouseenter", function () { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); });
                card.addEventListener("mouseleave", function () { v.pause(); });
            }
        } else {
            var im = el("img");
            im.alt = ""; im.loading = "lazy";
            im.src = THUMBS[w.key] || assetBlob(w.key, w.mime);
            media.appendChild(im);
        }
        card.appendChild(media);
        var kind = el("span", "kind " + (w.kind === "video" ? "live" : w.kind === "theme" ? "theme" : "static"));
        kind.innerHTML = iconSVG(w.kind === "video" ? "video" : w.kind === "theme" ? "spark" : "image", "luc-14") + (w.kind === "video" ? "live" : w.kind === "theme" ? "theme" : "4K");
        card.appendChild(kind);
        if (isApplied(w.id)) card.appendChild(el("span", "active", "Active"));
        var fav = el("span", "fav" + (favs.indexOf(w.id) !== -1 ? " on" : ""));
        fav.setAttribute("role", "button");
        fav.title = "Favorite";
        fav.innerHTML = iconSVG("heart", "luc-14");
        fav.addEventListener("click", function (e) {
            e.stopPropagation();
            var f = readFavs();
            var i = f.indexOf(w.id);
            if (i === -1) f.push(w.id); else f.splice(i, 1);
            writeFavs(f);
            fav.classList.toggle("on", i === -1);
        });
        card.appendChild(fav);
        var shade = el("div", "shade");
        card.appendChild(shade);
        var meta = el("div", "meta");
        meta.appendChild(el("span", "nm", w.name || "Untitled"));
        meta.appendChild(el("span", "ds", w.desc || ""));
        card.appendChild(meta);
        var open = function () { openLightbox(w); };
        card.addEventListener("click", open);
        card.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
        grid.appendChild(card);
    });
}

/* lightbox */
var lbItem = null;
var lbToken = 0; /* async lightbox guards: stale blob resolutions must not land */
var lbDetail = null; /* resolved 4K-catalog resolutions (detail fetch) */
var lbDetailPromise = null; /* in-flight ensure4kDetail() */
function openLightbox(w) {
    lbItem = w;
    lbDetail = null;
    lbDetailPromise = null;
    $("veilLbTitle").textContent = w.name || "Untitled";
    var kindEl = $("veilLbKind");
    var kind = w.kind === "video" ? "live · 4K" : w.kind === "theme" ? "animated theme" : "static · 4K";
    kindEl.style.cssText = "border-radius:999px;padding:3px 10px;font-size:10.5px;font-weight:600;color:" +
        (w.kind === "video" ? "#6ee7b7" : w.kind === "theme" ? "#c7d2fe" : "#99f6e4") + ";border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06)";
    kindEl.textContent = kind;
    var media = $("veilLbMedia");
    media.innerHTML = "";
    var resBox = $("veilLbRes");
    resBox.hidden = true;
    resBox.innerHTML = "";
    if (w.kind === "theme") {
        var tv = THEME_VARS[w.theme] || THEME_VARS.emerald;
        media.style.background = tv[2];
        var thm = el("div", "thm");
        thm.style.cssText = "position:absolute;inset:0;background:" + tv[2];
        media.appendChild(thm);
        var o = el("div", "veil-orb-a");
        o.style.cssText = "position:absolute;top:-25%;left:20%;width:60%;height:70%;border-radius:999px;filter:blur(80px);background:" + tv[0];
        media.appendChild(o);
    } else if (w.kind === "video") {
        var v = el("video");
        v.controls = true; v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
        if (w.online) {
            v.poster = w.thumb || "";
            if (!VEIL_ORIGIN && mbgsIsDirect(w.src)) {
                /* hotlink-protected source + no origin: pull it through
                   the tunnel (poster shows while the blob streams in) */
                var vToken = (lbToken = (lbToken || 0) + 1);
                mbgsResolveVideo(w.id, w.src).then(function (burl) {
                    if (lbItem !== w || vToken !== lbToken) return;
                    v.src = burl;
                    var pv = v.play();
                    if (pv && pv.catch) pv.catch(function () {});
                }).catch(function () {
                    if (lbItem !== w) return;
                    /* leave the poster — apply will report its own failure */
                });
            } else {
                v.src = w.src;
            }
        } else {
            v.src = assetBlob(w.key, w.mime);
            if (THUMBS[w.key]) v.poster = THUMBS[w.key];
        }
        media.appendChild(v);
    } else {
        var im = el("img");
        if (w.online) {
            im.src = w.thumb;
            /* the 4K-catalog lightbox resolves the real resolutions behind
               the scenes and upgrades the preview to the best file */
            if (w.detail) { lbDetail = null; lbDetailPromise = null; ensure4kDetail().catch(function () {}); }
        } else {
            im.src = assetBlob(w.key, w.mime);
        }
        im.alt = w.name || "";
        media.appendChild(im);
    }
    var tags = $("veilLbTags");
    tags.innerHTML = "";
    (w.tags || []).forEach(function (t) { tags.appendChild(el("span", "tg", t)); });
    var applyBtn = $("veilLbApply");
    applyBtn.className = "primary";
    applyBtn.innerHTML = iconSVG("desktop", "luc-14") + " Set as background";
    $("veilLb").classList.add("open");
    updateChrome();
}
function fetch4kDetail(w) {
    var viaOrigin = function () {
        return fetch(VEIL_ORIGIN + "/api/wallpapers/detail?url=" + encodeURIComponent(w.detail), { cache: "no-store" })
            .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
            .then(function (j) {
                if (!j || !j.ok || !j.best) throw new Error(j && j.error ? j.error : "no resolutions");
                return j;
            });
    };
    if (VEIL_ORIGIN) return viaOrigin();
    /* origin-free: tunnel the detail page and parse resolutions here */
    return tunText(w.detail).then(function (html) {
        var j = wp4kDetailParse(html);
        if (!j || !j.ok || !j.best) throw new Error("no resolutions");
        return j;
    });
}
/* Resolve (or re-resolve) the 4K files for the current lightbox item.
   Apply/Download call this on demand too — a slow upstream must never
   leave the buttons silently doing nothing. */
function ensure4kDetail() {
    if (!lbItem || !lbItem.detail) return Promise.reject(new Error("no detail url"));
    if (lbDetail && lbDetail.best) return Promise.resolve(lbDetail);
    if (lbDetailPromise) return lbDetailPromise;
    var w = lbItem;
    var resBox = $("veilLbRes");
    resBox.hidden = false;
    resBox.innerHTML = '<span class="wait">' + iconSVG("reload", "luc-14 spin") + "Resolving resolutions…</span>";
    lbDetailPromise = fetch4kDetail(w)
        .then(function (j) {
            lbDetailPromise = null;
            if (lbItem !== w) return null;
            lbDetail = j;
            resBox.innerHTML = "";
            (j.resolutions || []).slice(0, 6).forEach(function (r) {
                var pill = el("span", "res-pill" + (r === j.best ? " best" : ""), r.w + "×" + r.h);
                if (r === j.best) pill.title = "Applied resolution";
                resBox.appendChild(pill);
            });
            var note = el("span", null, "Applies the " + j.best.w + "×" + j.best.h + " file");
            note.style.color = "#71717a";
            resBox.appendChild(note);
            /* upgrade the preview to the best file itself */
            var imgEl = document.querySelector("#veilLbMedia img");
            if (imgEl) imgEl.src = veilRoute(j.best.url);
            return j;
        })
        .catch(function (err) {
            lbDetailPromise = null;
            if (lbItem !== w) throw err;
            resBox.hidden = false;
            resBox.innerHTML = '<span class="wait">' + iconSVG("alert", "luc-14") +
                "Couldn't resolve the 4K files" + (err && err.message ? " (" + esc(err.message) + ")" : "") +
                " — Set as background / Download will retry.</span>";
            throw err;
        });
    return lbDetailPromise;
}
function closeLightbox() {
    var lb = $("veilLb");
    lb.classList.remove("open");
    var v = lb.querySelector("video");
    if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
    updateChrome();
}
$("veilLbX").addEventListener("click", closeLightbox);
$("veilLb").addEventListener("click", function (e) { if (e.target === $("veilLb")) closeLightbox(); });
$("veilLbApply").addEventListener("click", function () {
    if (!lbItem) return;
    var applyBtn = $("veilLbApply");
    var done = function (sel) {
        applyWallpaper(sel, true);
        toast("Wallpaper applied");
        renderWpGrid();
        applyBtn.className = "ok";
        applyBtn.innerHTML = iconSVG("check", "luc-14") + " Applied";
        setTimeout(function () {
            if (!$("veilLb").classList.contains("open")) return;
            applyBtn.className = "primary";
            applyBtn.innerHTML = iconSVG("desktop", "luc-14") + " Set as background";
        }, 2200);
    };
    if (lbItem.kind === "theme") {
        done({ id: lbItem.id, kind: "theme", name: lbItem.name, theme: lbItem.theme });
        return;
    }
    var embedded = packById(lbItem.id);
    /* pack items + live wallpapers apply straight away (the pack resolves
       its embedded blob; live videos stream from the origin's cache) */
    if (embedded || lbItem.kind === "video") {
        var sel = { id: lbItem.id, kind: lbItem.kind, name: lbItem.name, src: embedded ? "" : lbItem.src };
        if (lbItem.online && lbItem.thumb) sel.thumb = lbItem.thumb;
        done(sel);
        return;
    }
    /* 4K-catalog online image: the best file must resolve — wait for it
       instead of applying nothing (or worse, the tiny catalog thumb) */
    applyBtn.innerHTML = iconSVG("reload", "luc-14 spin") + " Resolving 4K…";
    ensure4kDetail().then(function (j) {
        if (!j || !j.best || !lbItem) return;
        done({
            id: lbItem.id, kind: "image", name: lbItem.name,
            src: veilRoute(j.best.url), thumb: lbItem.thumb,
        });
    }).catch(function () {
        toast("The 4K file didn't resolve — check the connection and try again", true);
        applyBtn.className = "primary";
        applyBtn.innerHTML = iconSVG("desktop", "luc-14") + " Set as background";
    });
});
$("veilLbDl").addEventListener("click", function () {
    if (!lbItem || lbItem.kind === "theme") return;
    var name = (lbItem.name || "veil-wallpaper").replace(/[^\w\d-]+/g, "-").toLowerCase();
    var ext = lbItem.kind === "video" ? ".mp4" : ".jpg";
    if (!lbItem.online) {
        var a = el("a");
        a.href = assetBlob(lbItem.key, lbItem.mime) || "";
        a.download = name + ext;
        document.body.appendChild(a); a.click(); a.remove();
        toast("Downloading the 4K original");
        return;
    }
    /* online + no origin: the tunnel pulls the bytes and a blob URL
       drives the download (no __veil-dl trick possible without the
       origin's content-disposition, but tunneled bytes download fine) */
    if (!VEIL_ORIGIN) {
        var startTunDl = function (url) {
            toast("Downloading through the tunnel…");
            tunBlob(url).then(function (burl) {
                var a3 = el("a");
                a3.href = burl;
                a3.download = name + ext;
                document.body.appendChild(a3); a3.click(); a3.remove();
                setTimeout(function () { URL.revokeObjectURL(burl); }, 60000);
                toast("Downloading " + name + ext);
            }).catch(function () {
                toast("The download failed — the tunnel couldn't fetch that file", true);
            });
        };
        if (lbItem.kind === "video") { startTunDl(lbItem.src); return; }
        if (lbDetail && lbDetail.best) { startTunDl(lbDetail.best.url); return; }
        toast("Resolving the 4K file…");
        ensure4kDetail().then(function (j) {
            if (j && j.best) startTunDl(j.best.url);
        }).catch(function () {
            toast("The 4K file didn't resolve — try again", true);
        });
        return;
    }
    /* online: hand the URL to the browser's download manager with a
       __veil-dl marker — the origin answers content-disposition:
       attachment, which needs no CORS (works from file://, where a
       programmatic fetch+blob of a big live video dies with “Failed
       to fetch”) and streams straight to disk. */
    var startDl = function (url) {
        var a2 = el("a");
        a2.href = url + (url.indexOf("?") === -1 ? "?" : "&") + "__veil-dl=" + encodeURIComponent(name + ext);
        a2.download = name + ext;
        a2.target = "_blank";
        a2.rel = "noopener";
        document.body.appendChild(a2); a2.click(); a2.remove();
        toast("Downloading " + name + ext);
    };
    if (lbItem.kind === "video") { startDl(lbItem.src); return; }
    if (lbDetail && lbDetail.best) { startDl(veilRoute(lbDetail.best.url)); return; }
    toast("Resolving the 4K file…");
    ensure4kDetail().then(function (j) {
        if (j && j.best) startDl(veilRoute(j.best.url));
    }).catch(function () {
        toast("The 4K file didn't resolve — try again", true);
    });
});

/* ═══ 11. ARCADE — tabs: the stash / bloxd ═══════════════════ */
function cleanName(raw) {
    var s = String(raw || "");
    if (s.indexOf("cl") === 0) s = s.slice(2);
    s = s.replace(/\.(html?|swf)$/i, "");
    s = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    s = s.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
    s = s.replace(/[_+.]+/g, " ");
    s = s.replace(/\b(v\d+)\b/gi, "");
    s = s.replace(/\s+/g, " ").trim();
    s = s.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    return s || String(raw || "Title");
}

/* ── tab switching ───────────────────────────────────────────── */
var arcTab = "stash";
function setArcTab(tab, force) {
    if (!force && tab === arcTab && $("veilArcViewStash").hidden === (tab !== "stash")) return;
    var prev = arcTab;
    arcTab = tab;
    document.querySelectorAll(".arc-tab").forEach(function (b) {
        b.setAttribute("aria-selected", b.getAttribute("data-arc-tab") === tab ? "true" : "false");
    });
    $("veilArcViewStash").hidden = tab !== "stash";
    $("veilArcViewMath").hidden = tab !== "math";
    $("veilArcViewSulfur").hidden = tab !== "sulfur";
    $("veilArcViewGnmath").hidden = tab !== "gnmath";
    $("veilArcViewLab").hidden = tab !== "lab";
    $("veilArcViewAilab").hidden = tab !== "ailab";
    var sec = $("veilSecArcade");
    var meta = $("veilArcMeta");
    if (tab === "stash") {
        if (stashTitles) stashMeta();
        else { meta.textContent = "The Stash — plays in-frame, no pop-ups"; }
    } else if (tab === "sulfur") {
        var nS = 0;
        for (var sk in EXT_APPS) if (EXT_APPS[sk].cat !== "gn-math" && EXT_APPS[sk].cat !== "ai") nS++;
        meta.textContent = nS ? "Veil Toolkit — " + nS + " apps from the Veil Toolkit pack, zero connection" : "Veil Toolkit — the tools arrive by the Veil Toolkit extension";
        $("veilArcCount").textContent = nS ? nS + " apps" : "";
        renderSulfur($("veilSulfurSearch") ? $("veilSulfurSearch").value : "");
    } else if (tab === "gnmath") {
        var nG = 0;
        for (var gk in EXT_APPS) if (EXT_APPS[gk].cat === "gn-math") nG++;
        meta.textContent = nG ? "gn-math — " + nG + " math games on this file, zero connection" : "gn-math — the math arcade arrives by the GN-Math packet";
        $("veilArcCount").textContent = nG ? nG + " games" : "";
        renderGnMath($("veilGnmathSearch") ? $("veilGnmathSearch").value : "");
    } else if (tab === "lab") {
        var nL = 0;
        for (var lk in EXT_APPS) if (EXT_APPS[lk].cat === "lab") nL++;
        meta.textContent = nL ? "Veil Lab — " + nL + " experiment" + (nL === 1 ? "" : "s") + " on this file, zero connection" : "Veil Lab — visual experiments arrive by the Veil Lab packet";
        $("veilArcCount").textContent = nL ? nL + (nL === 1 ? " app" : " apps") : "";
        renderLab($("veilLabSearch") ? $("veilLabSearch").value : "");
    } else if (tab === "ailab") {
        var nA = 0;
        for (var ak in EXT_APPS) if (EXT_APPS[ak].cat === "ai") nA++;
        meta.textContent = nA
            ? "AI Lab — " + nA + " app" + (nA === 1 ? "" : "s") + " built by Veil AI in the chat"
            : "AI Lab — apps Veil AI builds for you, on demand";
        $("veilArcCount").textContent = nA ? nA + (nA === 1 ? " app" : " apps") : "";
        renderAilab($("veilAilabSearch") ? $("veilAilabSearch").value : "");
    } else if (tab === "math") {
        meta.textContent = "veil math — the number rush · sprint / survival / zen · streaks, levels, bests";
        $("veilArcCount").textContent = "";
        mathEnsure();
    }
    /* (the stash-leaving count clear used to live here — it wiped the
       counts the toolkit/gn-math branches had just set; each branch now
       owns its own count text) */
}
document.querySelectorAll(".arc-tab").forEach(function (b) {
    b.addEventListener("click", function () { setArcTab(b.getAttribute("data-arc-tab")); });
});
if ($("veilSulfurSearch")) {
    $("veilSulfurSearch").addEventListener("input", function () { renderSulfur(this.value); });
}
if ($("veilGnmathSearch")) {
    $("veilGnmathSearch").addEventListener("input", function () { renderGnMath(this.value); });
}
if ($("veilLabSearch")) {
    $("veilLabSearch").addEventListener("input", function () { renderLab(this.value); });
}
if ($("veilAilabSearch")) {
    $("veilAilabSearch").addEventListener("input", function () { renderAilab(this.value); });
}

/* ── the stash view — embedded pack first, CDN merge online ──
   The offline build embeds the full title list plus a curated pack of
   fully-inlined games (text/veil-asset script blocks, key
   "stash:<id>"). They play instantly from the file — no CDN, no
   connection. Non-embedded titles still stream from the UGS CDN when
   a connection exists. */
var STASH_EMB = window.__VEIL_STASH_EMB__ || null;
var STASH_LIST = window.__VEIL_STASH_LIST__ || null;
var STASH_PRETTY = window.__VEIL_STASH_PRETTY__ || {};
/* titles that are the ENGINE's splash screen, not the game — entries
   whose fetched "pretty" name is one of these display as their cleaned
   id instead (unique beats a wall of clones) */
var STASH_GENERIC = {
    "Unity WebGL Player": 1,
    "PICO-8 Cartridge": 1,
    "Clickteam Fusion Developer 2.5 HTML5 Runtime": 1,
    "Clickteam Fusion Developer 2.5+ HTML5 Runtime": 1,
    "Game": 1,
    "New Game": 1,
    "about:blank": 1,
};
var stashTitles = null;
/* raw ids worth listing — the CDN's own list file carries a few
   degenerate entries ("?", "1", "cln", "cl1", bare digits) whose
   cleaned names would display as garbage tiles; after the "cl" cloak
   strip the remainder needs 3+ sane characters */
function stashIdOk(raw) {
    var s = String(raw || "");
    if (/^cl/i.test(s) && s.length > 2) s = s.slice(2);
    return /^[a-z0-9][\w.-]*$/i.test(s) && s.replace(/[\W_.-]/gi, "").length >= 3;
}
/* which extension pack carries a given title — built from the
   catalog's per-pack asset lists so a failed CDN launch can point
   the user at the one download that makes the title playable
   offline forever */
var PACK_OF = {};
(function packOfInit() {
    (window.__VEIL_EXTS_CATALOG__ || []).forEach(function (p) {
        (p && p.assets || []).forEach(function (k) {
            if (k.indexOf("stash:") === 0 && !PACK_OF[k.slice(6)]) PACK_OF[k.slice(6)] = p;
        });
    });
})();
function stashName(raw) {
    var p = STASH_PRETTY && STASH_PRETTY[raw];
    /* engine splash screens masquerading as titles — dozens of catalog
       entries share them ("Unity WebGL Player" ×85, "PICO-8 Cartridge"
       ×42); fall back to the unique cleaned id instead of a wall of
       clones (curated overrides in the build win first — they replace
       the pretty value itself) */
    if (p && !STASH_GENERIC[p]) return p;
    return cleanName(raw);
}
function openArcade() {
    if (!stashTitles) loadStash();
    setArcTab(arcTab, true);
}
function stashMeta() {
    /* the async catalog load can land while another tab (toolkit /
       gn-math / bloxd) owns the meta line — never stomp their text */
    if (arcTab !== "stash") return;
    var n = stashTitles ? stashTitles.length : 0;
    var e = 0;
    if (stashTitles) for (var i = 0; i < stashTitles.length; i++) if (stashTitles[i].emb) e++;
    var meta = $("veilArcMeta");
    if (STASH_EMB && n) {
        meta.textContent = "The Stash — " + n.toLocaleString() + " titles · " + e + " play offline" +
            (typeof EXT_COUNT === "number" && EXT_COUNT > 0 ? " (" + EXT_COUNT + " via packs)" : "");
    } else if (n) {
        meta.textContent = "The Stash — plays in-frame, no pop-ups";
    }
    $("veilArcCount").textContent = n ? n.toLocaleString() + " titles" : "";
}
function loadStash() {
    var list = $("veilArcList");
    list.innerHTML = "";
    /* 1. instant — the embedded catalog (works with zero connection) */
    if (STASH_EMB && STASH_LIST) {
        stashTitles = STASH_LIST.map(function (raw) {
            return { raw: raw, name: stashName(raw), emb: !!STASH_EMB[raw] };
        });
        stashMeta();
        renderStash($("veilArcSearch").value);
        /* 2. background refresh — merge the live CDN list (new titles,
           newest state) when a connection exists; embedded flags stick */
        fetch(UGS_LIST, { cache: "no-store" }).then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.text();
        }).then(function (text) {
            var m = /let\s+files\s*=\s*\[([\s\S]*?)\]/.exec(text);
            if (!m) throw new Error("no list found");
            var ids = JSON.parse("[" + m[1].replace(/,\s*$/, "") + "]")
                .map(String).filter(function (s) { return s && s.length > 1 && stashIdOk(s); });
            var seen = {};
            for (var i = 0; i < stashTitles.length; i++) seen[stashTitles[i].raw] = 1;
            var added = 0;
            for (var j = 0; j < ids.length; j++) {
                if (!seen[ids[j]]) { stashTitles.push({ raw: ids[j], name: stashName(ids[j]), emb: !!STASH_EMB[ids[j]] }); added++; }
            }
            if (added) {
                stashTitles.sort(function (a, b) { return a.name.localeCompare(b.name); });
                stashMeta();
                if (arcTab === "stash") renderStash($("veilArcSearch").value);
            }
        }).catch(function () { /* offline — the embedded catalog stands */ });
        return;
    }
    /* no embedded pack in this build — CDN path (the online behavior) */
    var box = el("div", "loadbox");
    box.innerHTML = iconSVG("reload", "spin") + "<div>Loading the stash from its CDN…</div>";
    list.appendChild(box);
    fetch(UGS_LIST, { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
        .then(function (text) {
            var m = /let\s+files\s*=\s*\[([\s\S]*?)\]/.exec(text);
            if (!m) throw new Error("no list found");
            stashTitles = JSON.parse("[" + m[1].replace(/,\s*$/, "") + "]")
                .map(String).filter(function (s) { return s && s.length > 1 && stashIdOk(s); })
                .map(function (raw) { return { raw: raw, name: stashName(raw), emb: false }; });
            stashMeta();
            renderStash($("veilArcSearch").value);
        })
        .catch(function (err) {
            list.innerHTML = "";
            var eb = el("div", "loadbox warn");
            eb.innerHTML = iconSVG("alert", "") + "<div>Couldn't reach the stash CDN" + (err && err.message ? " (" + esc(err.message) + ")" : "") + ".</div>";
            var btn = el("button", null, "Retry");
            btn.type = "button";
            btn.addEventListener("click", loadStash);
            eb.appendChild(btn);
            list.appendChild(eb);
        });
}
function renderStash(q) {
    var list = $("veilArcList");
    if (!stashTitles) return;
    q = (q || "").toLowerCase().trim();
    list.innerHTML = "";
    var byLetter = {}, order = [];
    stashTitles.forEach(function (g) {
        if (q && g.name.toLowerCase().indexOf(q) === -1 && g.raw.toLowerCase().indexOf(q) === -1) return;
        var L = (g.name.charAt(0) || "#").toUpperCase();
        if (!/[A-Z]/.test(L)) L = "#";
        if (!byLetter[L]) { byLetter[L] = []; order.push(L); }
        byLetter[L].push(g);
    });
    order.sort();
    if (!order.length) {
        var nb = el("div", "loadbox warn");
        nb.innerHTML = iconSVG("search", "") + '<div>Nothing in the stash matches "' + esc(q) + '".</div>';
        list.appendChild(nb);
        return;
    }
    order.forEach(function (L) {
        list.appendChild(el("div", "veil-g-letter", L === "#" ? "0–9" : L));
        var grid = el("div", "veil-g-grid");
        byLetter[L].forEach(function (g) {
            var b = el("button", "veil-g-btn" + (g.emb ? " emb" : ""), g.name);
            b.type = "button";
            b.title = g.name + (g.emb ? " — embedded · plays offline" : " — play in-frame");
            b.addEventListener("click", function () { launchTitle(g); });
            grid.appendChild(b);
        });
        list.appendChild(grid);
    });
}
$("veilArcSearch").addEventListener("input", function () { renderStash(this.value); });

var curTitle = null;
function launchTitle(g) {
    curTitle = g;
    $("veilTitleName").textContent = g.name;
    var layer = $("veilTitle");
    layer.classList.add("open");
    var loading = $("veilTitleLoading");
    var frame = $("veilTitleFrame");
    frame.removeAttribute("srcdoc");
    /* embedded pack — the whole game is already inside this file */
    if (g.emb && STASH_EMB && STASH_EMB[g.raw]) {
        loading.style.display = "";
        loading.className = "loadbox";
        loading.innerHTML = iconSVG("reload", "spin") + "<div>Unpacking " + esc(g.name) + "…</div>";
        requestAnimationFrame(function () {
            var node = document.getElementById("veilA:stash:" + g.raw);
            if (!node) { extLaunch(g, loading, frame); return; }
            try {
                var bin = atob(node.textContent.replace(/\s+/g, ""));
                frame.srcdoc = bin;
                loading.style.display = "none";
                loading.innerHTML = "";
            } catch (e) { cdnLaunch(g, loading, frame); }
        });
        updateChrome();
        return;
    }
    cdnLaunch(g, loading, frame);
    updateChrome();
}
/* The stash's CDN stubs play inside a srcdoc frame — but a srcdoc
   document's URL is "about:srcdoc", which is NOT a valid URL base.
   Unity's loader does `new URL(streamingAssetsUrl, document.URL)` →
   TypeError → the frame stays black forever (engine never boots).
   Fix: give the stub its real CDN identity inside the frame —
   re-point document.URL/documentURI at the stub's own address (the
   exact base it was built for) and inject a <base> for every other
   relative resolution (engine fetch("data.bin"), img/link tags). */
function stStubBoot(html, stubUrl) {
    var probe = '<' + 'script>try{Object.defineProperty(document,"URL",{value:' +
        JSON.stringify(stubUrl) + ',configurable:true});' +
        'Object.defineProperty(document,"documentURI",{value:' + JSON.stringify(stubUrl) +
        ',configurable:true});}catch(e){}<\/script>';
    if (!/<base\s/i.test(html)) {
        if (/<head[^>]*>/i.test(html))
            html = html.replace(/<head[^>]*>/i, function (m) { return m + '<base href="' + stubUrl + '">'; });
        else html = '<base href="' + stubUrl + '">' + html;
    }
    return probe + html;
}
function cdnLaunch(g, loading, frame) {
    loading.style.display = "";
    loading.className = "loadbox";
    loading.innerHTML = iconSVG("reload", "spin") + "<div>Fetching " + esc(g.name) + "…</div>";
    var file = /\.[a-z0-9]+$/i.test(g.raw) ? g.raw : g.raw + ".html";
    var stubUrl = UGS_FILE + encodeURIComponent(file);
    fetch(stubUrl + "?t=" + Date.now(), { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
        .then(function (html) {
            frame.srcdoc = stStubBoot(html, stubUrl);
            loading.style.display = "none";
            loading.innerHTML = "";
        })
        .catch(function (err) {
            loading.style.display = "";
            loading.className = "loadbox warn";
            loading.innerHTML = iconSVG("alert", "") + "<div>Couldn't load " + esc(g.name) + (err && err.message ? " — " + esc(err.message) : "") + ".</div>" +
                "<div style='margin-top:6px;font-size:11.5px;line-height:1.5;opacity:.75'>online-only titles stream from the stash's CDN — the ones with a green dot play straight from this file.</div>";
            /* if an extension pack carries this title, offer the one
               download that makes it playable offline forever */
            var pk = PACK_OF[g.raw];
            if (pk && pk.id && VEIL_ORIGIN) {
                var pb = el("button", null, "get " + (pk.name || "the pack") + " — plays offline");
                pb.type = "button";
                pb.addEventListener("click", function () {
                    veilDlGo(VEIL_ORIGIN + "/api/offline?ext=" + encodeURIComponent(pk.id), pk.name || "the pack");
                });
                loading.appendChild(pb);
            }
            var btn = el("button", null, "Retry");
            btn.type = "button";
            btn.addEventListener("click", function () { launchTitle(g); });
            loading.appendChild(btn);
        });
    updateChrome();
}
function closeTitle() {
    var layer = $("veilTitle");
    layer.classList.remove("open");
    $("veilTitleFrame").removeAttribute("srcdoc");
    var loading = $("veilTitleLoading");
    loading.className = "loadbox";
    loading.innerHTML = iconSVG("reload", "spin") + "<div>Fetching title…</div>";
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    updateChrome();
}
$("veilTitleClose").addEventListener("click", closeTitle);
$("veilTitleReload").addEventListener("click", function () { if (curTitle) launchTitle(curTitle); });
$("veilTitleFull").addEventListener("click", function () {
    var wrap = $("veilTitleBody");
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    else if (wrap.requestFullscreen) wrap.requestFullscreen().catch(function () {});
});

/* ── Veil Math — the number rush, native (no origin, no iframe) ──
   Replaced the bloxd.io embed at the owner's request — and unlike the
   embed it plays fully offline. Three modes: sprint (60 seconds),
   survival (3 lives, shrinking timer), zen (practice, no clock).
   Streak multipliers, difficulty tiers every 5 correct, per-mode
   bests in localStorage — the site's Veil Math, offline edition. */
var MATH = {
    phase: "home", mode: "sprint",
    q: null, input: "",
    score: 0, streak: 0, bestStreak: 0, lives: 3,
    correct: 0, answered: 0,
    timeLeft: 60, timer: null,
    qT: 12, qTMax: 12, qTimer: null,
    wired: false
};

function mathRi(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function mathQ(level) {
    var lvl = Math.max(1, Math.min(9, level));
    var kinds = lvl >= 3 ? ["add", "sub", "mul", "mul", "div"] : ["add", "add", "sub", "mul"];
    var k = kinds[mathRi(0, kinds.length - 1)];
    var a, b, c;
    if (k === "add") {
        if (lvl >= 5 && Math.random() < 0.4) {
            a = mathRi(20, 99); b = mathRi(10, 89); c = mathRi(10, 89);
            return { t: a + " + " + b + " + " + c, a: a + b + c };
        }
        a = lvl <= 1 ? mathRi(2, 12) : mathRi(10, 30 + lvl * 12);
        b = lvl <= 1 ? mathRi(2, 12) : mathRi(10, 30 + lvl * 12);
        return { t: a + " + " + b, a: a + b };
    }
    if (k === "sub") {
        a = lvl <= 1 ? mathRi(4, 15) : mathRi(20, 60 + lvl * 15);
        b = lvl <= 1 ? mathRi(2, 9) : mathRi(10, a);
        if (lvl >= 4 && Math.random() < 0.3) b = a + mathRi(1, 9);
        return { t: a + " − " + b, a: a - b };
    }
    if (k === "div") {
        b = mathRi(2, 4 + lvl); c = mathRi(2, 9 + lvl); a = b * c;
        return { t: a + " ÷ " + b, a: c };
    }
    if (lvl >= 4 && Math.random() < 0.25) { a = mathRi(5, 12 + lvl); return { t: a + "²", a: a * a }; }
    a = mathRi(2, 6 + lvl * 2); b = mathRi(2, 9);
    return { t: a + " × " + b, a: a * b };
}

function mathBestKey(m) { return "veil:math:best:" + m; }
function mathReadBest(m) {
    try { var v = Number(LS.get(mathBestKey(m))); return isFinite(v) && v > 0 ? v : 0; } catch (e) { return 0; }
}
function mathLevel() { return 1 + Math.floor(MATH.correct / 5); }

function mathStart(mode) {
    MATH.mode = mode;
    MATH.phase = "playing";
    MATH.score = 0; MATH.streak = 0; MATH.bestStreak = 0;
    MATH.lives = 3; MATH.correct = 0; MATH.answered = 0;
    MATH.timeLeft = 60; MATH.input = "";
    MATH.q = mathQ(1);
    mathRender();
    if (mode === "sprint") {
        MATH.timer = setInterval(function () {
            MATH.timeLeft--;
            if (MATH.timeLeft <= 0) { mathEnd(); return; }
            var bar = $("arcMathClockFill");
            if (bar) bar.style.width = (MATH.timeLeft / 60 * 100) + "%";
            var n = $("arcMathClockTxt");
            if (n) n.textContent = MATH.timeLeft + "s left · " + MATH.correct + " correct";
        }, 1000);
    }
    if (mode === "survival") mathQTimerStart();
}

function mathQTimerStart() {
    if (MATH.qTimer) clearInterval(MATH.qTimer);
    MATH.qTMax = Math.max(5, 12 - (mathLevel() - 1));
    MATH.qT = MATH.qTMax;
    var bar = $("arcMathQFill");
    if (bar) bar.style.width = "100%";
    MATH.qTimer = setInterval(function () {
        if (MATH.phase !== "playing") return;
        MATH.qT = Math.max(0, +(MATH.qT - 0.1).toFixed(1));
        var b = $("arcMathQFill");
        if (b) b.style.width = (MATH.qT / MATH.qTMax * 100) + "%";
        if (MATH.qT <= 0) mathResolve(null);
    }, 100);
}

function mathResolve(given) {
    if (MATH.phase !== "playing" || !MATH.q) return;
    var ok = given != null && given === MATH.q.a;
    MATH.answered++;
    MATH.lastOk = ok;
    MATH.lastGiven = given;
    if (MATH.qTimer) { clearInterval(MATH.qTimer); MATH.qTimer = null; }
    if (ok) {
        var mult = Math.min(5, 1 + Math.floor((MATH.streak + 1) / 3));
        var gain = (10 + mathLevel() * 2 + (MATH.mode === "sprint" ? 4 : 0)) * mult;
        MATH.score += gain;
        MATH.streak++;
        MATH.bestStreak = Math.max(MATH.bestStreak, MATH.streak);
        MATH.correct++;
        MATH.flash = { good: true, text: "+" + gain };
    } else {
        MATH.streak = 0;
        MATH.flash = { good: false, text: given == null ? "time!" : "miss" };
        if (MATH.mode === "survival") MATH.lives--;
    }
    MATH.phase = "flash";
    mathRender();
    setTimeout(function () {
        if (MATH.phase !== "flash") return;
        if (MATH.mode === "survival" && MATH.lives <= 0) { mathEnd(); return; }
        MATH.phase = "playing";
        MATH.input = "";
        MATH.flash = null;
        MATH.q = mathQ(mathLevel());
        mathRender();
        if (MATH.mode === "survival") mathQTimerStart();
    }, MATH.lastOk ? 450 : 900);
}

function mathEnd() {
    if (MATH.timer) { clearInterval(MATH.timer); MATH.timer = null; }
    if (MATH.qTimer) { clearInterval(MATH.qTimer); MATH.qTimer = null; }
    MATH.phase = "over";
    MATH.newBest = false;
    if (MATH.mode !== "zen" && MATH.score > mathReadBest(MATH.mode)) {
        try { LS.set(mathBestKey(MATH.mode), String(MATH.score)); } catch (e) {}
        MATH.newBest = true;
    }
    mathRender();
}

function mathKey(d) {
    MATH.input = (MATH.input.replace("-", "").length >= 7 ? MATH.input : MATH.input + d);
    mathRenderInput();
}
function mathRenderInput() {
    var n = $("arcMathInput");
    if (n) n.textContent = MATH.input || "0";
}

function mathRender() {
    var box = $("arcMath");
    if (!box) return;
    if (MATH.phase === "home" || MATH.phase === "over") {
        var modes = [
            { id: "sprint", t: "Sprint", d: "60 seconds. As many as you can.", best: mathReadBest("sprint") },
            { id: "survival", t: "Survival", d: "3 lives. Escalating pressure.", best: mathReadBest("survival") },
            { id: "zen", t: "Zen", d: "No clock. No lives. Just math.", best: 0 }
        ];
        var html = "";
        if (MATH.phase === "over") {
            var acc = MATH.answered ? Math.round(MATH.correct / MATH.answered * 100) : 0;
            html += '<div class="mm-over">' +
                '<p class="mm-k">' + (MATH.mode === "zen" ? "session over" : "run over") + '</p>' +
                '<p class="mm-big">' + (MATH.mode === "zen" ? MATH.correct + " correct" : MATH.score.toLocaleString()) + (MATH.mode !== "zen" ? '<small>pts</small>' : "") + '</p>' +
                (MATH.newBest ? '<p class="mm-nb">' + iconSVG("trophy", "luc-14") + " new personal best</p>" : "") +
                '<div class="mm-stats">' +
                '<div><b>' + MATH.answered + '</b><span>answered</span></div>' +
                '<div><b>' + acc + '%</b><span>accuracy</span></div>' +
                '<div><b>' + MATH.bestStreak + '</b><span>best streak</span></div>' +
                '<div><b>' + mathLevel() + '</b><span>level</span></div>' +
                '</div>' +
                '<div class="mm-acts"><button type="button" class="mm-go" data-math-run="' + MATH.mode + '">' + iconSVG("reload", "luc-14") + " run it back</button>" +
                '<button type="button" class="mm-plain" data-math-home="1">' + iconSVG("back", "luc-14") + " change mode</button></div>" +
                "</div>";
        }
        html += '<div class="mm-home">';
        modes.forEach(function (m) {
            html += '<button type="button" class="mm-mode" data-math-run="' + m.id + '">' +
                '<span class="mm-t">' + m.t + (m.best ? ' <i class="mm-best">' + m.best.toLocaleString() + "</i>" : "") + "</span>" +
                '<span class="mm-d">' + m.d + "</span></button>";
        });
        html += "</div>";
        box.innerHTML = html;
        return;
    }

    /* playing / flash */
    var hud = "";
    if (MATH.mode === "survival") {
        var hearts = "";
        for (var i = 0; i < 3; i++) hearts += '<i class="mm-heart' + (i < MATH.lives ? " on" : "") + '"></i>';
        hud += '<span class="mm-hud mm-lives">' + hearts + "</span>";
    }
    if (MATH.streak >= 2) hud += '<span class="mm-hud mm-streak' + (MATH.streak >= 3 ? " fire" : "") + '">' + MATH.streak + "×</span>";
    if (MATH.mode !== "zen") hud += '<span class="mm-hud mm-score">' + MATH.score.toLocaleString() + "</span>";
    hud += '<span class="mm-hud mm-lvl">lvl ' + mathLevel() + "</span>";

    var clock = "";
    if (MATH.mode === "sprint") {
        clock = '<div class="mm-clock" role="progressbar" aria-label="Sprint clock" aria-valuenow="' + MATH.timeLeft + '" aria-valuemin="0" aria-valuemax="60">' +
            '<div class="mm-clock-fill' + (MATH.timeLeft <= 8 ? " hot" : MATH.timeLeft <= 20 ? " warm" : "") + '" id="arcMathClockFill" style="width:' + (MATH.timeLeft / 60 * 100) + '%"></div></div>' +
            '<p class="mm-clock-t" id="arcMathClockTxt">' + MATH.timeLeft + "s left · " + MATH.correct + " correct</p>";
    }
    var qclock = "";
    if (MATH.mode === "survival" && MATH.phase === "playing") {
        qclock = '<div class="mm-qclock"><div class="mm-qfill' + (MATH.qT / MATH.qTMax < 0.3 ? " hot" : "") + '" id="arcMathQFill" style="width:' + (MATH.qT / MATH.qTMax * 100) + '%"></div></div>';
    }
    var flash = "";
    if (MATH.phase === "flash" && MATH.flash) {
        flash = '<p class="mm-verdict ' + (MATH.flash.good ? "ok" : "no") + '">' +
            (MATH.flash.good ? "correct" + (MATH.streak >= 3 ? " — you're on fire" : "") :
                (MATH.lastGiven != null ? MATH.lastGiven + " — nope · it was <b>" + MATH.q.a + "</b>" : "time! · it was <b>" + MATH.q.a + "</b>")) + "</p>";
    }
    var q = MATH.q || { t: "", a: 0 };
    var shown = MATH.phase === "flash" && !MATH.lastOk && MATH.input === "" ? "—" : (MATH.input || "0");

    var keys = "";
    "789456123".split("").forEach(function (d) { keys += '<button type="button" class="mm-key" data-math-key="' + d + '">' + d + "</button>"; });
    keys += '<button type="button" class="mm-key mm-soft" data-math-neg="1">±</button>' +
        '<button type="button" class="mm-key mm-soft" data-math-back="1">⌫</button>' +
        '<button type="button" class="mm-key mm-soft" data-math-clr="1">C</button>' +
        '<button type="button" class="mm-key mm-zero" data-math-key="0">0</button>' +
        '<button type="button" class="mm-key mm-go" data-math-enter="1">↵</button>';

    box.innerHTML =
        '<div class="mm-top"><button type="button" class="mm-end" data-math-home="1">' + iconSVG("back", "luc-14") + " end</button>" +
        '<span class="mm-hudrow">' + hud + "</span></div>" + clock +
        '<div class="mm-q' + (MATH.phase === "flash" ? (MATH.flash && MATH.flash.good ? " ok" : " no") : "") + '">' +
        '<p class="mm-tier">' + (MATH.mode === "zen" ? "zen · take your time" : "level " + mathLevel()) + "</p>" +
        '<p class="mm-text">' + q.t + "</p>" + qclock +
        '<p class="mm-ans' + (MATH.phase === "flash" ? (MATH.flash && MATH.flash.good ? " ok" : " no") : "") + '" id="arcMathInput" aria-live="polite">' + shown + "</p>" +
        flash + "</div>" +
        '<div class="mm-pad">' + keys + "</div>" +
        '<p class="mm-hint">or just type — digits, minus, Backspace, Enter</p>';
}

function mathEnsure() {
    if (!MATH.wired) {
        MATH.wired = true;
        mathWire();
    }
    mathRender();
    /* the engine's hidden browsing frame loves to keep keyboard focus —
       pull it onto the game so physical keys reach the document handler */
    var box = $("arcMath");
    if (box) { try { box.focus({ preventScroll: true }); } catch (e) {} }
}
function mathWire() {
    var box = $("arcMath");
    if (!box) return;
    box.addEventListener("click", function (ev) {
        var b = ev.target.closest("button");
        if (!b) return;
        if (b.getAttribute("data-math-run")) { mathStart(b.getAttribute("data-math-run")); return; }
        if (b.getAttribute("data-math-home")) { if (MATH.timer) clearInterval(MATH.timer); if (MATH.qTimer) clearInterval(MATH.qTimer); MATH.phase = "home"; MATH.flash = null; mathRender(); return; }
        if (MATH.phase !== "playing") return;
        if (b.getAttribute("data-math-key")) { mathKey(b.getAttribute("data-math-key")); return; }
        if (b.getAttribute("data-math-neg")) { MATH.input = MATH.input.charAt(0) === "-" ? MATH.input.slice(1) : "-" + MATH.input; mathRenderInput(); return; }
        if (b.getAttribute("data-math-back")) { MATH.input = MATH.input.slice(0, -1); mathRenderInput(); return; }
        if (b.getAttribute("data-math-clr")) { MATH.input = ""; mathRenderInput(); return; }
        if (b.getAttribute("data-math-enter")) { mathSubmit(); }
    });
    document.addEventListener("keydown", function (ev) {
        if (arcTab !== "math" || $("veilSecArcade") && !document.getElementById("veilSecArcade").classList.contains("open")) return;
        var t = ev.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
        if (MATH.phase === "playing") {
            if (/^[0-9]$/.test(ev.key)) { ev.preventDefault(); mathKey(ev.key); }
            else if (ev.key === "-") { ev.preventDefault(); MATH.input = MATH.input.charAt(0) === "-" ? MATH.input.slice(1) : "-" + MATH.input; mathRenderInput(); }
            else if (ev.key === "Backspace") { ev.preventDefault(); MATH.input = MATH.input.slice(0, -1); mathRenderInput(); }
            else if (ev.key === "Enter") { ev.preventDefault(); mathSubmit(); }
        } else if ((MATH.phase === "home" || MATH.phase === "over") && ev.key === "Enter") {
            ev.preventDefault();
            mathStart(MATH.mode);
        }
    });
}

function mathSubmit() {
    if (MATH.phase !== "playing" || !MATH.input || MATH.input === "-") return;
    mathResolve(Number(MATH.input));
}

/* ═══ 11b. EXTENSIONS — drop-in packs that grow this file ═════
   The base build ships the shell, the wallpapers and the light/mid
   stash games; the heavy titles live in separate extension files
   (veil-ext-*.html) — standalone pages carrying the same
   text/veil-asset script blocks plus a VEIL-EXT manifest.
   Drop one anywhere on this page (or "add extension" in the stash
   tab) and its games become embedded titles launched from Blobs.
   IndexedDB keeps packs installed across reloads where the browser
   allows it (file:// pages often refuse — there a pack loads
   per-session and is one drag away next time). The format is open:
   any file with a valid VEIL-EXT manifest + asset blocks installs,
   so future packs (more games, other media) slot straight in. */
var EXT_CATALOG = window.__VEIL_EXTS_CATALOG__ || [];
var EXT_INSTALLED = {};   /* packId → manifest */
var EXT_BLOBS = {};       /* assetKey → Blob (this session) */
var EXT_COUNT = 0;        /* stash games unlocked by packs */
var EXT_APPS = {};        /* "app:key" → { key,name,desc,icon,cat,pack,packName } — toolkit/ai packet apps */
var EXT_QUEUE = [];       /* pending extension files (multi-upload) */
var EXT_DB = null;        /* IndexedDB handle (best-effort) */
var EXT_BUSY = false;
var EXT_BASE_SNAP = STASH_EMB ? Object.keys(STASH_EMB).length : 0;

(function extInit() {
    try {
        var rq = indexedDB.open("veil-ext", 1);
        rq.onupgradeneeded = function () {
            var db = rq.result;
            if (!db.objectStoreNames.contains("assets")) db.createObjectStore("assets");
            if (!db.objectStoreNames.contains("exts")) db.createObjectStore("exts");
        };
        rq.onsuccess = function () { EXT_DB = rq.result; extRestore(); };
        rq.onerror = rq.onblocked = function () { EXT_DB = null; };
    } catch (e) { EXT_DB = null; }
    extBarInit();
    extPanelInit();
    extDropInit();
    renderExtBar();
    renderSulfurBar();
    renderGnmathBar();
    renderLabBar();
    renderAilabBar();
    renderExtPanel();
})();

function extIdbPut(store, key, val) {
    if (!EXT_DB) return;
    try {
        var tx = EXT_DB.transaction(store, "readwrite");
        tx.objectStore(store).put(val, key);
        tx.onerror = function () {};
    } catch (e) {}
}
function extIdbDel(store, key) {
    if (!EXT_DB) return;
    try {
        var tx = EXT_DB.transaction(store, "readwrite");
        tx.objectStore(store).delete(key);
        tx.onerror = function () {};
    } catch (e) {}
}
function extRestore() {
    /* boot-time: manifests only (tiny) — asset blobs are read lazily
       from the "assets" store the first time a packed game launches */
    if (!EXT_DB) return;
    try {
        var rq = EXT_DB.transaction("exts", "readonly").objectStore("exts").getAll();
        rq.onsuccess = function () {
            var mans = (rq.result || []).filter(function (m) { return m && m.sig === "VEIL-EXT" && m.id; });
            if (!mans.length) return;
            mans.forEach(extApplyMan);
            extRefresh();
        };
        rq.onerror = function () {};
    } catch (e) {}
}
function extApplyMan(man) {
    EXT_INSTALLED[man.id] = man;
    if (STASH_EMB) {
        (man.assets || []).forEach(function (k) {
            if (k.indexOf("stash:") === 0) STASH_EMB[k.slice(6)] = 1;
        });
    }
    /* app-carrying packs (the toolkit) carry appList — self-contained
       apps that run
       from Blobs (launched from the “toolkit” arcade tab, or from
       other apps via the window.__veilExt bridge) */
    (man.appList || []).forEach(function (a) {
        if (!a || !a.key) return;
        EXT_APPS[a.key] = {
            key: a.key, name: a.name || a.key,
            desc: a.desc || "", icon: a.icon || "spark",
            cat: a.cat || "app", kb: a.kb || 0,
            pack: man.id, packName: man.name || man.id
        };
    });
}
function extParse(text) {
    var mm = new RegExp(TAG_S + ' type="text/veil-ext-man' + 'ifest"[^>]*>([\\s\\S]*?)<\\/scr' + 'ipt>').exec(text);
    if (!mm) return null;
    var man = null;
    try { man = JSON.parse(mm[1]); } catch (e) { return null; }
    if (!man || man.sig !== "VEIL-EXT" || !Array.isArray(man.assets) || !man.assets.length) return null;
    var re = new RegExp(TAG_S + ' type="text/veil-asset" id="veilA:([^"]+)"[^>]*>', 'g');
    var ranges = {}, m;
    while ((m = re.exec(text))) {
        var cs = m.index + m[0].length;
        var ce = text.indexOf("<\/script>", cs);
        if (ce > cs) ranges[m[1]] = [cs, ce];
    }
    return { man: man, text: text, ranges: ranges };
}
function extMB(b) { return Math.round((b || 0) / 1048576) + " MB"; }
function extInstallFile(f) {
    if (!f) return;
    if (f.size > 900 * 1048576) { toast("that file is far too big to be an extension", true); return; }
    /* multi-upload: files beyond the first queue up behind the running one */
    if (EXT_BUSY) {
        EXT_QUEUE.push(f);
        toast((f.name || "extension") + " queued — " + EXT_QUEUE.length + " waiting", false);
        return;
    }
    /* claim the busy slot NOW — the FileReader read is ASYNC, and without
       an early claim a multi-select batch would fan out into parallel
       reads whose installs all race; every one but the first gets
       rejected by extInstallText's busy guard (only pack #1 installed).
       Claim → read → hand the slot off → pump whatever the outcome. */
    EXT_BUSY = true;
    /* BIG packs (the ~300 MB stash packs) can't ride the text path —
       readAsText on one makes a ~600 MB string and the renderer dies
       mid-unpack (the page freezes, nothing installs). Stream them:
       byte-scan in small slices, decode one asset at a time. */
    if (f.size >= EXT_STREAM_MIN) {
        void extInstallStream(f).then(function () { extPumpQueue(); });
        return;
    }
    var rd = new FileReader();
    rd.onload = function () {
        EXT_BUSY = false; /* hand the slot to extInstallText (it re-claims) */
        void extInstallText(String(rd.result || ""), f.name);
        /* rejected text (bad pack / duplicate) leaves the slot free — pump
           the queue; if the install is running, the pump no-ops on EXT_BUSY */
        extPumpQueue();
    };
    rd.onerror = function () { EXT_BUSY = false; toast("couldn't read " + (f.name || "that file"), true); extPumpQueue(); };
    try { rd.readAsText(f); } catch (e) { EXT_BUSY = false; toast("couldn't read that file", true); extPumpQueue(); }
}
/* ── the big-pack streaming installer ──────────────────────────
   The stash packs run ~300 MB. Reading one whole as TEXT makes a
   ~600 MB string and the renderer dies mid-unpack — the "big packs
   don't work" bug: the page freezes, nothing installs, the games
   never show up. This path never materializes the whole file: it
   scans the pack in small Blob-sliced windows (O(1) slices, one
   chunk in memory), finds each asset's byte range, and decodes ONE
   asset at a time — peak memory is about one scan chunk plus one
   asset instead of the whole pack. Asset payloads are base64 (the
   alphabet can't contain "<" or '"', so the needle scans and the
   closing-tag hunt are collision-proof). */
var EXT_STREAM_MIN = 8 * 1048576;   /* above this, use the streaming path */
var EXT_SCAN_CHUNK = 4 * 1048576;   /* scan window */
var EXT_CLOSER = "<\/scr" + "ipt>"; /* the block closer, tokenizer-safe */

function extScanChunk(f, needle, fromByte) {
    /* first byte offset at/after fromByte where `needle` (ASCII)
       occurs in the file — -1 when absent. Blob.slice is O(1), so
       each window costs only its own few MB. */
    var nd = new Uint8Array(needle.length);
    for (var q = 0; q < needle.length; q++) nd[q] = needle.charCodeAt(q);
    var first = nd[0], nlen = nd.length;
    var pos = Math.max(0, fromByte | 0);
    return new Promise(function (resolve) {
        (function walk() {
            if (pos + nlen > f.size) { resolve(-1); return; }
            var len = Math.min(EXT_SCAN_CHUNK + nlen - 1, f.size - pos);
            f.slice(pos, pos + len).arrayBuffer().then(function (ab) {
                var b = new Uint8Array(ab);
                var hit = -1;
                outer: for (var i = 0; i + nlen <= b.length; i++) {
                    if (b[i] !== first) continue;
                    for (var k = 1; k < nlen; k++) { if (b[i + k] !== nd[k]) continue outer; }
                    hit = i; break;
                }
                if (hit >= 0) { resolve(pos + hit); return; }
                pos += EXT_SCAN_CHUNK; /* the next window re-scans the overlap */
                walk();
            }).catch(function () { resolve(-2); });
        })();
    });
}
function extRangeText(f, cs, ce) {
    return f.slice(cs, ce).arrayBuffer().then(function (ab) { return new TextDecoder().decode(ab); });
}
function extRangeBlob(f, cs, ce) {
    /* decode one base64 asset range into a Blob — the range is pure
       ASCII, so one native TextDecoder pass + a regex whitespace strip
       beats per-char string building by two orders of magnitude (the
       per-char version blocked the main thread for ~5s PER ASSET) */
    return f.slice(cs, ce).arrayBuffer().then(function (ab) {
        var b64 = new TextDecoder().decode(ab).replace(/\s+/g, "");
        var bin = atob(b64);
        var out = new Uint8Array(bin.length);
        for (var j = 0; j < bin.length; j++) out[j] = bin.charCodeAt(j);
        return new Blob([out], { type: "text/html" });
    });
}
function extInstallStream(f) {
    /* claims the busy slot on entry and releases it on every exit */
    EXT_BUSY = true;
    var cursor = 0;
    var fail = function (msg) {
        EXT_BUSY = false;
        toast(msg, true);
        return false;
    };
    return extScanChunk(f, TAG_S + ' type="text/veil-ext-manifest"', 0).then(function (mpos) {
        if (mpos < 0) return fail("not a Veil extension — " + (f.name || "that file") + " (no VEIL-EXT manifest found)");
        return extScanChunk(f, EXT_CLOSER, mpos).then(function (mend) {
            if (mend < 0) return fail("the manifest block in " + (f.name || "that file") + " never closes");
            return extRangeText(f, mpos, mend).then(function (txt) {
                var man = null;
                try { man = JSON.parse(txt.slice(txt.indexOf(">") + 1).trim()); } catch (e) { man = null; }
                if (!man || man.sig !== "VEIL-EXT" || !Array.isArray(man.assets) || !man.assets.length)
                    return fail("not a Veil extension — " + (f.name || "that file") + " (bad manifest)");
                if (EXT_INSTALLED[man.id]) return fail((man.name || man.id) + " is already installed");
                var keys = man.assets.slice(); /* NEVER mutate man.assets — extApplyMan needs it */
                var total = keys.length;
                var have = 0, done = 0;
                extProgress(man, 0, total);
                return new Promise(function (resolve) {
                    (function step() {
                        if (!keys.length) {
                            EXT_BUSY = false;
                            if (!have) { toast("that extension carries no assets", true); resolve(false); return; }
                            extApplyMan(man);
                            extIdbPut("exts", man.id, man);
                            extRefresh();
                            var n = 0;
                            (man.assets || []).forEach(function (k) { if (k.indexOf("app:") !== 0) n++; });
                            var na = (man.appList || []).length;
                            var what = na && !n ? (na + (na === 1 ? " app" : " apps")) :
                                n && !na ? (n + (n === 1 ? " game" : " games")) :
                                (n + (n === 1 ? " game" : " games") + " · " + na + (na === 1 ? " app" : " apps"));
                            toast((man.name || "extension") + " installed — " + what + " unlocked" + (EXT_DB ? "" : " (this session)") + (EXT_QUEUE.length ? " · " + EXT_QUEUE.length + " more queued" : ""));
                            resolve(true);
                            return;
                        }
                        var key = keys.shift();
                        var next = function () { done++; extProgress(man, done, total); setTimeout(step, 0); };
                        extScanChunk(f, 'id="veilA:' + key + '"', cursor).then(function (h2) {
                            if (h2 < 0) return extScanChunk(f, 'id="veilA:' + key + '"', 0); /* out-of-order wrap */
                            return h2;
                        }).then(function (h2) {
                            if (h2 < 0) { next(); return; } /* missing asset tolerated */
                            extScanChunk(f, ">", h2).then(function (gt) {
                                if (gt < 0) { next(); return; }
                                extScanChunk(f, EXT_CLOSER, gt + 1).then(function (cend) {
                                    if (cend < 0) { next(); return; }
                                    if (cend > cursor) cursor = cend;
                                    extRangeBlob(f, gt + 1, cend).then(function (blob) {
                                        if (blob) { EXT_BLOBS[key] = blob; extIdbPut("assets", key, blob); have++; }
                                        next();
                                    }).catch(function () { next(); });
                                }).catch(function () { next(); });
                            }).catch(function () { next(); });
                        }).catch(function () { next(); });
                    })();
                });
            });
        });
    }).catch(function () { return fail("couldn't read " + (f.name || "that file")); });
}
function extInstallFiles(files) {
    /* the dock Upload button — install EVERY selected extension in order */
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    var rejected = 0;
    list.forEach(function (f) {
        if (f.size > 900 * 1048576) { rejected++; return; }
        if (EXT_BUSY) EXT_QUEUE.push(f);
        else extInstallFile(f);
    });
    if (rejected) toast(rejected + (rejected === 1 ? " file was" : " files were") + " too big to be extensions", true);
}
function extPumpQueue() {
    if (EXT_BUSY || !EXT_QUEUE.length) return;
    var f = EXT_QUEUE.shift();
    extInstallFile(f);
}
function extInstallText(text, srcName) {
    if (EXT_BUSY) { toast("still unpacking the last pack…", true); return Promise.resolve(false); }
    var parsed = extParse(text);
    if (!parsed) {
        toast("not a Veil extension" + (srcName ? " — " + srcName : "") + " (no VEIL-EXT manifest found)", true);
        return Promise.resolve(false);
    }
    var man = parsed.man;
    if (EXT_INSTALLED[man.id]) { toast((man.name || man.id) + " is already installed", true); return Promise.resolve(false); }
    var have = 0;
    man.assets.forEach(function (k) { if (parsed.ranges[k]) have++; });
    if (!have) { toast("that extension carries no assets", true); return Promise.resolve(false); }
    EXT_BUSY = true;
    extProgress(man, 0, have);
    return new Promise(function (resolve) {
        var keys = man.assets.slice();
        var i = 0;
        (function step() {
            if (i >= keys.length) {
                EXT_BUSY = false;
                extApplyMan(man);
                extIdbPut("exts", man.id, man);
                extRefresh();
                var n = 0;
                (man.assets || []).forEach(function (k) { if (parsed.ranges[k] && k.indexOf("app:") !== 0) n++; });
                var na = (man.appList || []).length;
                var what = na && !n ? (na + (na === 1 ? " app" : " apps")) :
                    n && !na ? (n + (n === 1 ? " game" : " games")) :
                    (n + (n === 1 ? " game" : " games") + " · " + na + (na === 1 ? " app" : " apps"));
                toast((man.name || "extension") + " installed — " + what + " unlocked" + (EXT_DB ? "" : " (this session)") + (EXT_QUEUE.length ? " · " + EXT_QUEUE.length + " more queued" : ""));
                resolve(true);
                extPumpQueue();
                return;
            }
            var key = keys[i++];
            var r = parsed.ranges[key];
            var save = function (blob) {
                if (blob) { EXT_BLOBS[key] = blob; extIdbPut("assets", key, blob); }
                extProgress(man, i, keys.length);
                setTimeout(step, 0);
            };
            if (!r) { save(null); return; }
            try {
                var b64 = parsed.text.slice(r[0], r[1]).replace(/\s+/g, "");
                var bin = atob(b64);
                var u8 = new Uint8Array(bin.length);
                for (var j = 0; j < bin.length; j++) u8[j] = bin.charCodeAt(j);
                save(new Blob([u8], { type: "text/html" }));
            } catch (e) { save(null); }
        })();
    });
}
function extProgress(man, done, total) {
    var isAppPack = (man.appList || []).length > 0 && !(man.games > 0);
    var unit = isAppPack ? "apps" : "games";
    var line = "unpacking " + (man.name || man.id) + " — " + done + " / " + total + " " + unit + "…";
    var bar = $("veilExtBar");
    if (bar) {
        bar.hidden = false;
        $("veilExtLine").textContent = line;
        var p = $("veilExtProg");
        if (p) {
            p.hidden = false;
            var f = p.firstElementChild;
            if (f) f.style.width = (total ? Math.round((done / total) * 100) : 0) + "%";
        }
    }
    /* mirror into the Extensions section's own progress row when open */
    var zp = $("veilExtZoneProg");
    if (zp) {
        zp.hidden = false;
        var zl = $("veilExtZoneLine");
        if (zl) zl.textContent = line;
        var zf = zp.querySelector(".vx-prog > span") || zp.querySelector("span");
        if (zf) zf.style.width = (total ? Math.round((done / total) * 100) : 0) + "%";
    }
    /* mirror into the sulfur tab's own bar when that view exists */
    var su = $("veilSulfurBar");
    if (su) {
        su.hidden = false;
        $("veilSulfurLine").textContent = line;
        var sp = $("veilSulfurProg");
        if (sp) {
            sp.hidden = false;
            var sf = sp.firstElementChild;
            if (sf) sf.style.width = (total ? Math.round((done / total) * 100) : 0) + "%";
        }
    }
    /* mirror into the gn-math tab's own bar when that view exists */
    var gb = $("veilGnmathBar");
    if (gb) {
        gb.hidden = false;
        $("veilGnmathLine").textContent = line;
        var gp = $("veilGnmathProg");
        if (gp) {
            gp.hidden = false;
            var gf = gp.firstElementChild;
            if (gf) gf.style.width = (total ? Math.round((done / total) * 100) : 0) + "%";
        }
    }
}
function extRemove(id) {
    var man = EXT_INSTALLED[id];
    if (!man) return;
    delete EXT_INSTALLED[id];
    (man.assets || []).forEach(function (k) {
        delete EXT_BLOBS[k];
        delete blobCache[k];
        extIdbDel("assets", k);
        if (STASH_EMB && k.indexOf("stash:") === 0) delete STASH_EMB[k.slice(6)];
        if (k.indexOf("app:") === 0) delete EXT_APPS[k];
    });
    extIdbDel("exts", id);
    extRefresh();
    toast((man.name || id) + " removed");
}
function extRefresh() {
    var n = STASH_EMB ? Object.keys(STASH_EMB).length : 0;
    EXT_COUNT = Math.max(0, n - EXT_BASE_SNAP);
    if (stashTitles) {
        stashTitles.forEach(function (t) { t.emb = !!(STASH_EMB && STASH_EMB[t.raw]); });
        stashMeta();
        if (arcTab === "stash") renderStash($("veilArcSearch").value);
    }
    renderExtBar();
    renderSulfurBar();
    renderGnmathBar();
    renderLabBar();
    renderAilabBar();
    renderExtPanel();
    if (arcTab === "sulfur") renderSulfur($("veilSulfurSearch") ? $("veilSulfurSearch").value : "");
    if (arcTab === "gnmath") renderGnMath($("veilGnmathSearch") ? $("veilGnmathSearch").value : "");
    if (arcTab === "lab") renderLab($("veilLabSearch") ? $("veilLabSearch").value : "");
    if (arcTab === "ailab") renderAilab($("veilAilabSearch") ? $("veilAilabSearch").value : "");
}
function renderExtBar() {
    var bar = $("veilExtBar");
    if (!bar) return;
    if (EXT_BUSY) return; /* the progress pass owns the bar right now */
    var ids = Object.keys(EXT_INSTALLED);
    var known = EXT_CATALOG.length;
    if (!ids.length && !known) { bar.hidden = true; return; }
    bar.hidden = false;
    var prog = $("veilExtProg");
    if (prog) { prog.hidden = true; if (prog.firstElementChild) prog.firstElementChild.style.width = "0"; }
    var chips = $("veilExtChips");
    chips.innerHTML = "";
    var mkChip = function (name, count, on, man) {
        var c = el("span", "vx-chip" + (on ? " on" : ""));
        c.innerHTML = iconSVG("package", "luc-14") + esc(name) + '<b class="vx-n">' + count + " games</b>";
        c.title = name + " — " + count + (count === 1 ? " game" : " games") + (on ? " · installed" : " · available");
        if (on && man) {
            var x = el("span", "vx-x");
            x.title = "remove " + name;
            x.setAttribute("role", "button");
            x.setAttribute("aria-label", "remove " + name);
            x.innerHTML = iconSVG("x", "luc-14");
            x.addEventListener("click", function (ev) { ev.stopPropagation(); extRemove(man.id); });
            c.appendChild(x);
        }
        return c;
    };
    EXT_CATALOG.forEach(function (p) {
        var ins = EXT_INSTALLED[p.id];
        chips.appendChild(mkChip(p.name, p.games || 0, !!ins, ins || { id: p.id }));
        if (!ins) {
            var a = el("a", "vx-dl");
            a.href = VEIL_ORIGIN ? VEIL_ORIGIN + "/api/offline?ext=" + encodeURIComponent(p.id) : "#";
            if (VEIL_ORIGIN) {
                a.title = "download " + p.name + " (" + extMB(p.bytes) + ") — password required";
                (function (u, nm) {
                    a.addEventListener("click", function (ev) { ev.preventDefault(); veilDlGo(u, nm); });
                })(a.href, p.name);
            }
            a.setAttribute("aria-label", "download " + p.name);
            a.innerHTML = iconSVG("dl", "luc-14");
            chips.appendChild(a);
        }
    });
    ids.forEach(function (id) {
        if (EXT_CATALOG.some(function (p) { return p.id === id; })) return;
        var man = EXT_INSTALLED[id];
        chips.appendChild(mkChip(man.name || id, (man.assets || []).length, true, man));
    });
    var line = $("veilExtLine");
    if (EXT_COUNT > 0) {
        line.textContent = EXT_COUNT + " games unlocked by extensions" + (EXT_DB ? " · packs stay installed on this device" : " · packs load per-session here");
    } else if (known) {
        var g = 0, b = 0;
        EXT_CATALOG.forEach(function (p) { g += p.games || 0; b += p.bytes || 0; });
        line.textContent = known + " extension " + (known === 1 ? "pack" : "packs") + " · " + g + " more games · " + extMB(b) + " — drop one in";
    } else {
        line.textContent = "drop a Veil extension anywhere on this page to install it";
    }
}
function extBarInit() {
    var btn = $("veilExtAdd");
    var inp = $("veilExtFile");
    if (btn && inp) {
        btn.addEventListener("click", function () { inp.value = ""; inp.click(); });
        inp.addEventListener("change", function () {
            /* the picker is multi-select — install EVERYTHING chosen */
            if (inp.files && inp.files.length) extInstallFiles(inp.files);
        });
    }
    var sub = $("veilSulfurAdd");
    if (sub && inp) sub.addEventListener("click", function () { inp.value = ""; inp.click(); });
    var gnb = $("veilGnmathAdd");
    if (gnb && inp) gnb.addEventListener("click", function () { inp.value = ""; inp.click(); });
    var aib = $("veilAilabAdd");
    if (aib && inp) aib.addEventListener("click", function () { inp.value = ""; inp.click(); });
    var lbb = $("veilLabAdd");
    if (lbb && inp) lbb.addEventListener("click", function () { inp.value = ""; inp.click(); });
}

/* ── the Extensions section — the panel behind the dock's package icon.
       Everything pack-related in ONE place: upload (click or drop),
       installed packs (remove / jump), and the catalog with download
       buttons while online. Only in this offline HTML file — the live
       site ships the pack downloads from its own download button. */
function extPanelInit() {
    var zone = $("veilExtZone");
    var pick = $("veilExtPick");
    var inp = $("veilExtZoneFile");
    if (!zone || !inp) return;
    var openPicker = function () { inp.value = ""; inp.click(); };
    if (pick) pick.addEventListener("click", function (ev) { ev.stopPropagation(); openPicker(); });
    zone.addEventListener("click", function () { openPicker(); });
    zone.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); openPicker(); }
    });
    inp.addEventListener("change", function () {
        if (inp.files && inp.files.length) extInstallFiles(inp.files);
    });
    /* the zone is also a drop target — a visual magnet for the pack files
       (the whole-page drop overlay still catches everything else) */
    ["dragenter", "dragover"].forEach(function (ev) {
        zone.addEventListener(ev, function (e) {
            e.preventDefault();
            e.stopPropagation();
            zone.classList.add("over");
        });
    });
    ["dragleave", "drop"].forEach(function (ev) {
        zone.addEventListener(ev, function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (ev === "drop") {
                var fs = e.dataTransfer && e.dataTransfer.files;
                if (fs && fs.length) extInstallFiles(fs);
            }
            zone.classList.remove("over");
        });
    });
    /* self-scrolling lists — live fade / “more below” sync */
    ["veilExtInstScroll", "veilExtAvailScroll"].forEach(function (wid) {
        var wrap = $(wid);
        if (!wrap) return;
        var lst = wrap.querySelector(".veil-ex-list");
        if (!lst) return;
        lst.addEventListener("scroll", function () { extScrollSync(wrap, lst); }, { passive: true });
    });
    /* outer body — the section-level “scroll for more” affordance */
    var secBody = ($("veilSecExt") || {}).querySelector ? $("veilSecExt").querySelector(".veil-sec-body") : null;
    if (secBody) secBody.addEventListener("scroll", extSectionScrollSync, { passive: true });
    if (!window.__extScrollResize) {
        window.__extScrollResize = true;
        window.addEventListener("resize", extScrollSyncAll, { passive: true });
    }
}
function extPackCounts(man) {
    var g = 0, a = 0;
    (man.assets || []).forEach(function (k) { if (k.indexOf("app:") === 0) a++; else if (k.indexOf("stash:") === 0) g++; });
    var na = (man.appList || []).length;
    if (na > a) a = na;
    return { g: g, a: a };
}
function extPackCountLabel(man) {
    var c = extPackCounts(man);
    var parts = [];
    if (c.g) parts.push(c.g + (c.g === 1 ? " game" : " games"));
    if (c.a) parts.push(c.a + (c.a === 1 ? " app" : " apps"));
    if (man.bytes) parts.push(extMB(man.bytes));
    return parts.join(" · ") || "pack";
}
function renderExtPanel() {
    var list = $("veilExtInstList");
    if (!list) return;
    var sec = $("veilSecExt");
    if (sec && !sec.classList.contains("open") && !EXT_BUSY) return;
    var zp = $("veilExtZoneProg");
    if (zp && !EXT_BUSY) {
        zp.hidden = true;
        var zf = zp.querySelector(".vx-prog > span") || zp.querySelector("span");
        if (zf) zf.style.width = "0";
    }
    list.innerHTML = "";
    var avail = $("veilExtAvailList");
    if (avail) avail.innerHTML = "";

    /* ── installed ── */
    var ids = Object.keys(EXT_INSTALLED);
    var instHd = $("veilExInstHd");
    if (instHd) instHd.hidden = !ids.length;
    ids.forEach(function (id) {
        var man = EXT_INSTALLED[id];
        var c = extPackCounts(man);
        var isGnm = /^gn[-_ ]?math/i.test(id) || /gn[-_ ]?math/i.test(man.name || "") ||
            (man.appList || []).some(function (a) { return a && a.cat === "gn-math"; });
        var isAi = (man.appList || []).some(function (a) { return a && a.cat === "ai"; });
        var row = el("div", "veil-ex-row on");
        row.title = (man.name || id) + " — installed" + (EXT_DB ? " · saved on this device" : " · this session only");
        var ic = el("span", "ex-ic");
        ic.innerHTML = iconSVG(isAi ? "bot" : "package", "luc-20");
        row.appendChild(ic);
        var tx = el("div", "ex-tx");
        tx.appendChild(el("span", "ex-nm", man.name || id));
        tx.appendChild(el("span", "ex-ds", extPackCountLabel(man) + (EXT_DB ? " · stays installed" : " · this session") + (isAi ? " · by Veil AI" : "")));
        row.appendChild(tx);
        var go = el("button", "ex-go");
        go.type = "button";
        go.title = c.a ? "open the packet's apps" : "open the stash games";
        go.setAttribute("aria-label", "open what " + (man.name || id) + " added");
        go.innerHTML = iconSVG(c.a ? (isAi ? "bot" : isGnm ? "calc" : "spark") : "archive", "luc-16");
        go.addEventListener("click", function () {
            openSection("arcade");
            if (isAi) setArcTab("ailab");
            else if (c.a && isGnm) setArcTab("gnmath");
            else if (c.a) setArcTab("sulfur");
            else setArcTab("stash");
        });
        row.appendChild(go);
        var x = el("button", "ex-x");
        x.type = "button";
        x.title = "remove " + (man.name || id);
        x.setAttribute("aria-label", "remove " + (man.name || id));
        x.innerHTML = iconSVG("x", "luc-16");
        x.addEventListener("click", function () { extRemove(id); });
        row.appendChild(x);
        list.appendChild(row);
    });

    /* ── available (catalog packs not yet installed) ── */
    var av = EXT_CATALOG.filter(function (p) { return !EXT_INSTALLED[p.id]; });
    var avHd = $("veilExAvailHd");
    if (avHd) avHd.hidden = !av.length;
    var availWrap = $("veilExtAvailScroll");
    if (avail) avail.hidden = !av.length;
    if (availWrap) availWrap.hidden = !av.length;
    av.forEach(function (p) {
        var row = el("div", "veil-ex-row");
        row.title = p.name + " — " + extPackCountLabel(p);
        var ic = el("span", "ex-ic");
        ic.innerHTML = iconSVG("package", "luc-20");
        row.appendChild(ic);
        var tx = el("div", "ex-tx");
        tx.appendChild(el("span", "ex-nm", p.name || p.id));
        var blurb = (p.games ? p.games + (p.games === 1 ? " game" : " games") : "") +
            (p.apps ? (p.games ? " · " : "") + p.apps + (p.apps === 1 ? " app" : " apps") : "") +
            (p.bytes ? " · " + extMB(p.bytes) : "");
        tx.appendChild(el("span", "ex-ds", blurb || p.desc || "pack"));
        if (p.desc && blurb) tx.appendChild(el("span", "ex-sub", p.desc));
        row.appendChild(tx);
        if (VEIL_ORIGIN) {
            var a = el("a", "ex-dl");
            a.href = VEIL_ORIGIN + "/api/offline?ext=" + encodeURIComponent(p.id);
            a.title = "download " + (p.name || p.id) + " — then drop it into this page (password required)";
            (function (u, nm) {
                a.addEventListener("click", function (ev) { ev.preventDefault(); veilDlGo(u, nm); });
            })(a.href, p.name || p.id);
            a.setAttribute("aria-label", "download " + (p.name || p.id));
            a.innerHTML = iconSVG("dl", "luc-16") + "<span>download</span>";
            row.appendChild(a);
        } else {
            var off = el("span", "ex-off");
            off.title = "grab this pack from the veil site while online";
            off.innerHTML = iconSVG("dl", "luc-16") + "<span>from the veil site</span>";
            row.appendChild(off);
        }
        avail.appendChild(row);
    });

    /* ── headline + count chip ── */
    var sub = $("veilExtSub");
    if (sub) {
        var unlocked = EXT_COUNT;
        var apps = Object.keys(EXT_APPS).length;
        sub.textContent = !ids.length
            ? "Drop-in packs that grow this file — games, apps, more"
            : ids.length + (ids.length === 1 ? " pack" : " packs") + " installed" +
              (unlocked ? " · " + unlocked + (unlocked === 1 ? " game" : " games") : "") +
              (apps ? " · " + apps + (apps === 1 ? " app" : " apps") : "");
    }
    var chip = $("veilExtCount");
    if (chip) {
        var total = ids.length + av.length;
        chip.textContent = total ? (ids.length + " / " + total + " packs") : "";
        chip.style.display = total ? "" : "none";
    }
    var note = $("veilExtNote");
    if (note) note.hidden = false;
    /* lists are (re)built — size the fades + “more below” chips */
    extScrollSyncAll();
}
/* ── self-scrolling pack lists ─────────────────────────────────
   each list gets its own frame (max-height + overflow) so every pack is
   reachable even when the panel itself can't scroll (short screens, odd
   viewport modes). The wrapper carries fade overlays + a live “N more
   below” chip, driven by these classes:
     .can-scroll — content overflows the frame
     .at-top / .at-bot — edges reached (fade at that edge hides) */
function extScrollSync(wrap, list) {
    if (!wrap || !list) return;
    var can = list.scrollHeight > list.clientHeight + 4;
    var atTop = list.scrollTop <= 4;
    var atBot = list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
    wrap.classList.toggle("can-scroll", can);
    wrap.classList.toggle("at-top", atTop);
    wrap.classList.toggle("at-bot", atBot);
    var chip = wrap.querySelector(".sc-more");
    if (chip) {
        var b = chip.querySelector("b");
        if (!b) return;
        if (!can) { b.textContent = ""; return; }
        var row = list.firstElementChild;
        var rh = row ? row.offsetHeight + 8 : 64;
        var left = Math.max(0, list.scrollHeight - list.clientHeight - list.scrollTop);
        b.textContent = Math.max(1, Math.round(left / rh)) + " more below";
    }
}
function extScrollSyncAll() {
    ["veilExtInstScroll", "veilExtAvailScroll"].forEach(function (wid) {
        var wrap = $(wid);
        if (!wrap || wrap.hidden) return;
        extScrollSync(wrap, wrap.querySelector(".veil-ex-list"));
    });
    extSectionScrollSync();
}
/* outer panel body still has content below the fold? → show the
   viewport-level “scroll for more” fade + chip pinned to the section bottom */
function extSectionScrollSync() {
    var sec = $("veilSecExt");
    if (!sec) return;
    var body = sec.querySelector(".veil-sec-body");
    if (!body) return;
    var more = body.scrollHeight > body.clientHeight + 4 &&
               body.scrollTop + body.clientHeight < body.scrollHeight - 4;
    sec.classList.toggle("sec-more", more);
}
function extDropInit() {
    var ov = $("veilExtDrop");
    if (!ov) return;
    var depth = 0;
    var hasFiles = function (e) {
        try { return Array.prototype.indexOf.call(e.dataTransfer.types, "Files") !== -1; } catch (err) { return false; }
    };
    document.addEventListener("dragenter", function (e) {
        if (!hasFiles(e)) return;
        depth++;
        ov.hidden = false;
    });
    document.addEventListener("dragleave", function () {
        depth = Math.max(0, depth - 1);
        if (!depth) ov.hidden = true;
    });
    document.addEventListener("dragover", function (e) { if (hasFiles(e)) e.preventDefault(); });
    document.addEventListener("drop", function (e) {
        if (!hasFiles(e)) return;
        e.preventDefault(); /* a dropped file must never navigate away */
        depth = 0;
        ov.hidden = true;
        var fs = e.dataTransfer.files;
        if (fs && fs.length) extInstallFiles(fs);
    });
}
function extAssetBlob(key) {
    if (EXT_BLOBS[key]) return Promise.resolve(EXT_BLOBS[key]);
    if (!EXT_DB) return Promise.resolve(null);
    return new Promise(function (resolve) {
        try {
            var rq = EXT_DB.transaction("assets", "readonly").objectStore("assets").get(key);
            rq.onsuccess = function () {
                if (rq.result) EXT_BLOBS[key] = rq.result;
                resolve(rq.result || null);
            };
            rq.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
    });
}
function extLaunch(g, loading, frame) {
    loading.style.display = "";
    loading.className = "loadbox";
    loading.innerHTML = iconSVG("reload", "spin") + "<div>Unpacking " + esc(g.name) + " from its pack…</div>";
    extAssetBlob("stash:" + g.raw).then(function (b) {
        if (!b) { cdnLaunch(g, loading, frame); return; }
        return b.text().then(function (t) {
            frame.srcdoc = t;
            loading.style.display = "none";
            loading.innerHTML = "";
        });
    }).catch(function () { cdnLaunch(g, loading, frame); });
}

/* ── the toolkit tab — apps carried by the Veil Toolkit pack ──
   Each app is ONE self-contained page (notes, timers, converters,
   the whole general-purpose toolkit) living in a Blob; launching
   plays it in the same title player the stash uses. Known-but-
   missing packs offer their download link; unknown ones explain
   the Upload button on the dock. */
function suApps() {
    var out = [];
    for (var k in EXT_APPS) if (EXT_APPS[k].cat !== "gn-math" && EXT_APPS[k].cat !== "ai" && EXT_APPS[k].cat !== "lab") out.push(EXT_APPS[k]);
    out.sort(function (a, b) {
        var c = (a.cat || "").localeCompare(b.cat || "");
        if (c) return c;
        return (a.name || "").localeCompare(b.name || "");
    });
    return out;
}
function aiApps() {
    var out = [];
    for (var k in EXT_APPS) if (EXT_APPS[k].cat === "ai") out.push(EXT_APPS[k]);
    out.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
    return out;
}
function gnmApps() {
    var out = [];
    for (var k in EXT_APPS) if (EXT_APPS[k].cat === "gn-math") out.push(EXT_APPS[k]);
    out.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
    return out;
}
function gnmCatalogPacks() {
    return EXT_CATALOG.filter(function (p) {
        return /^gn[-_ ]?math/i.test(p.id) || /gn[-_ ]?math/i.test(p.name || "");
    });
}
function suCatalogPacks() {
    return EXT_CATALOG.filter(function (p) {
        return /^tools/i.test(p.id) || /toolkit/i.test(p.name || "");
    });
}
function sulfurLaunch(app) {
    curTitle = { raw: app.key, name: app.name, emb: true, app: app };
    $("veilTitleName").textContent = app.name;
    var layer = $("veilTitle");
    layer.classList.add("open");
    var loading = $("veilTitleLoading");
    var frame = $("veilTitleFrame");
    frame.removeAttribute("srcdoc");
    loading.style.display = "";
    loading.className = "loadbox";
    loading.innerHTML = iconSVG("reload", "spin") + "<div>Unpacking " + esc(app.name) + " from " + esc(app.packName || "the Veil Toolkit") + "…</div>";
    extAssetBlob(app.key).then(function (b) {
        if (!b) throw new Error("blob missing");
        return b.text();
    }).then(function (t) {
        frame.srcdoc = t;
        loading.style.display = "none";
        loading.innerHTML = "";
    }).catch(function () {
        loading.style.display = "";
        loading.className = "loadbox warn";
        loading.innerHTML = iconSVG("alert", "") + "<div>" + esc(app.name) + " isn't loaded in this session — re-upload " + esc(app.packName || "the Veil Toolkit") + " (Extensions on the dock, next to Settings).</div>";
    });
    updateChrome();
}
function renderSulfur(q) {
    var list = $("veilSulfurList");
    if (!list) return;
    q = (q || "").toLowerCase().trim();
    list.innerHTML = "";
    var apps = suApps().filter(function (a) {
        return !q || (a.name + " " + a.desc + " " + a.cat).toLowerCase().indexOf(q) !== -1;
    });
    var suSec = $("veilSecArcade");
    if (!suSec.classList.contains("open")) return;
    if (!apps.length) {
        var empty = el("div", "loadbox warn su-empty");
        empty.innerHTML = iconSVG("package", "") + "<div>No toolkit apps" + (q ? ' match "' + esc(q) + '"' : "") + " installed yet.</div>";
        var hint = el("p", "su-hint");
        hint.innerHTML = "grab the Veil Toolkit below" + (VEIL_ORIGIN ? " (or the download buttons)" : "") +
            ", then open <b>Extensions</b> on the dock (next to Settings) — one pick installs every app at once.";
        empty.appendChild(hint);
        list.appendChild(empty);
    } else {
        var grid = el("div", "veil-su-grid");
        apps.forEach(function (a) {
            var card = el("button", "veil-su-card");
            card.type = "button";
            card.title = a.name + " — " + a.desc + " · " + (a.packName || "");
            card.setAttribute("aria-label", "open " + a.name);
            card.innerHTML =
                '<span class="su-ic">' + iconSVG(a.icon, "luc-20") + "</span>" +
                '<span class="su-nm">' + esc(a.name) + "</span>" +
                '<span class="su-ds">' + esc(a.desc || "") + "</span>" +
                '<span class="su-pk">' + esc((a.packName || a.pack || "").replace(/^sulfur[- ]?/i, "packet ") || "the Veil Toolkit") + "</span>";
            card.addEventListener("click", function () { sulfurLaunch(a); });
            grid.appendChild(card);
        });
        list.appendChild(grid);
    }
    renderSulfurBar();
}
function renderSulfurBar() {
    var bar = $("veilSulfurBar");
    if (!bar) return;
    if (EXT_BUSY) return; /* the progress pass owns the bars right now */
    var suPacks = suCatalogPacks();
    var installedSu = [];
    for (var id in EXT_INSTALLED) {
        if (EXT_INSTALLED[id].appList && EXT_INSTALLED[id].appList.length) installedSu.push(EXT_INSTALLED[id]);
    }
    var nApps = Object.keys(EXT_APPS).length;
    if (!installedSu.length && !suPacks.length) { bar.hidden = true; return; }
    bar.hidden = false;
    var prog = $("veilSulfurProg");
    if (prog) { prog.hidden = true; if (prog.firstElementChild) prog.firstElementChild.style.width = "0"; }
    var chips = $("veilSulfurChips");
    chips.innerHTML = "";
    suPacks.forEach(function (p) {
        var ins = EXT_INSTALLED[p.id];
        var c = el("span", "vx-chip" + (ins ? " on" : ""));
        c.innerHTML = iconSVG("package", "luc-14") + esc(p.name) +
            '<b class="vx-n">' + (p.apps || 0) + " apps</b>";
        c.title = p.name + " — " + (p.apps || 0) + " apps · " + extMB(p.bytes) + (ins ? " · installed" : " · available");
        if (ins) {
            var x = el("span", "vx-x");
            x.title = "remove " + p.name;
            x.setAttribute("role", "button");
            x.setAttribute("aria-label", "remove " + p.name);
            x.innerHTML = iconSVG("x", "luc-14");
            x.addEventListener("click", function (ev) { ev.stopPropagation(); extRemove(p.id); });
            c.appendChild(x);
        }
        chips.appendChild(c);
        if (!ins) {
            var a = el("a", "vx-dl");
            a.href = VEIL_ORIGIN ? VEIL_ORIGIN + "/api/offline?ext=" + encodeURIComponent(p.id) : "#";
            if (VEIL_ORIGIN) {
                a.title = "download " + p.name + " (" + extMB(p.bytes) + ") — password required";
                (function (u, nm) {
                    a.addEventListener("click", function (ev) { ev.preventDefault(); veilDlGo(u, nm); });
                })(a.href, p.name);
            }
            a.setAttribute("aria-label", "download " + p.name);
            a.innerHTML = iconSVG("dl", "luc-14");
            chips.appendChild(a);
        }
    });
    installedSu.forEach(function (man) {
        if (suPacks.some(function (p) { return p.id === man.id; })) return;
        var c = el("span", "vx-chip on");
        c.innerHTML = iconSVG("package", "luc-14") + esc(man.name || man.id) +
            '<b class="vx-n">' + (man.appList || []).length + " apps</b>";
        var x = el("span", "vx-x");
        x.title = "remove " + (man.name || man.id);
        x.setAttribute("role", "button");
        x.setAttribute("aria-label", "remove " + (man.name || man.id));
        x.innerHTML = iconSVG("x", "luc-14");
        x.addEventListener("click", function (ev) { ev.stopPropagation(); extRemove(man.id); });
        c.appendChild(x);
        chips.appendChild(c);
    });
    var line = $("veilSulfurLine");
    if (nApps > 0) {
        line.textContent = nApps + " toolkit apps installed" + (EXT_DB ? " · the pack stays on this device" : " · the pack loads per-session here");
    } else {
        var g = 0;
        suPacks.forEach(function (p) { g += p.apps || 0; });
        line.textContent = "the Veil Toolkit · " + g + " apps waiting — add it with the dock Upload button";
    }
}
/* programmatic + debug handle (E2E installs, future UI) — also the
   bridge sibling apps use to find each other */
window.__veilExt = {
    installText: function (t) { return extInstallText(String(t), ""); },
    installFile: extInstallFile,
    installFiles: extInstallFiles,
    remove: extRemove,
    apps: function () { return suApps(); },
    blob: function (key) { return extAssetBlob(key); },
    state: function () {
        return {
            installed: Object.keys(EXT_INSTALLED),
            blobs: Object.keys(EXT_BLOBS).length,
            extGames: EXT_COUNT,
            extApps: Object.keys(EXT_APPS).length,
            idb: !!EXT_DB
        };
    }
};
/* ── the gn-math tab — the GN-Math packet's games, graph-paper
   amber cards, same blob-launch channel as the toolkit apps */
function renderGnMath(q) {
    var list = $("veilGnmathList");
    if (!list) return;
    q = (q || "").toLowerCase().trim();
    list.innerHTML = "";
    var apps = gnmApps().filter(function (a) {
        return !q || (a.name + " " + a.desc).toLowerCase().indexOf(q) !== -1;
    });
    var suSec = $("veilSecArcade");
    if (!suSec.classList.contains("open")) return;
    if (!apps.length) {
        var empty = el("div", "loadbox warn su-empty gnm-empty");
        empty.innerHTML = iconSVG("calc", "") + "<div>No gn-math games" + (q ? ' match "' + esc(q) + '"' : "") + " installed yet.</div>";
        var hint = el("p", "su-hint");
        hint.innerHTML = "grab the GN-Math Packet below" + (VEIL_ORIGIN ? " (or its download button)" : "") +
            ", then open <b>Extensions</b> on the dock (next to Settings) — or just drag the packet file onto the page.";
        empty.appendChild(hint);
        list.appendChild(empty);
    } else {
        var grid = el("div", "veil-su-grid gnm-grid");
        apps.forEach(function (a) {
            var card = el("button", "veil-su-card gnm-card");
            card.type = "button";
            card.title = a.name + " — " + a.desc + " · " + (a.packName || "");
            card.setAttribute("aria-label", "open " + a.name);
            card.innerHTML =
                '<span class="su-ic">' + iconSVG(a.icon, "luc-20") + "</span>" +
                '<span class="su-nm">' + esc(a.name) + "</span>" +
                '<span class="su-ds">' + esc(a.desc || "") + "</span>" +
                '<span class="su-pk">' + esc((a.packName || a.pack || "").replace(/^gn[-_ ]?math[-_ ]?/i, "") || "gn-math") + "</span>";
            card.addEventListener("click", function () { sulfurLaunch(a); });
            grid.appendChild(card);
        });
        list.appendChild(grid);
    }
    renderGnmathBar();
}
function renderGnmathBar() {
    var bar = $("veilGnmathBar");
    if (!bar) return;
    if (EXT_BUSY) return; /* the progress pass owns the bars right now */
    var gPacks = gnmCatalogPacks();
    var installedG = [];
    for (var id in EXT_INSTALLED) {
        var man = EXT_INSTALLED[id];
        if ((man.appList || []).some(function (a) { return a && a.cat === "gn-math"; })) installedG.push(man);
    }
    var nApps = gnmApps().length;
    if (!installedG.length && !gPacks.length) { bar.hidden = true; return; }
    bar.hidden = false;
    var prog = $("veilGnmathProg");
    if (prog) { prog.hidden = true; if (prog.firstElementChild) prog.firstElementChild.style.width = "0"; }
    var chips = $("veilGnmathChips");
    chips.innerHTML = "";
    gPacks.forEach(function (p) {
        var ins = EXT_INSTALLED[p.id];
        var c = el("span", "vx-chip" + (ins ? " on" : ""));
        c.innerHTML = iconSVG("package", "luc-14") + esc(p.name) +
            '<b class="vx-n">' + (p.apps || 0) + " games</b>";
        c.title = p.name + " — " + (p.apps || 0) + " math games · " + extMB(p.bytes) + (ins ? " · installed" : " · available");
        if (ins) {
            var x = el("span", "vx-x");
            x.title = "remove " + p.name;
            x.setAttribute("role", "button");
            x.setAttribute("aria-label", "remove " + p.name);
            x.innerHTML = iconSVG("x", "luc-14");
            x.addEventListener("click", function (ev) { ev.stopPropagation(); extRemove(p.id); });
            c.appendChild(x);
        }
        chips.appendChild(c);
        if (!ins) {
            var a = el("a", "vx-dl");
            a.href = VEIL_ORIGIN ? VEIL_ORIGIN + "/api/offline?ext=" + encodeURIComponent(p.id) : "#";
            if (VEIL_ORIGIN) {
                a.title = "download " + p.name + " (" + extMB(p.bytes) + ") — password required";
                (function (u, nm) {
                    a.addEventListener("click", function (ev) { ev.preventDefault(); veilDlGo(u, nm); });
                })(a.href, p.name);
            }
            a.setAttribute("aria-label", "download " + p.name);
            a.innerHTML = iconSVG("dl", "luc-14");
            chips.appendChild(a);
        }
    });
    installedG.forEach(function (man) {
        if (gPacks.some(function (p) { return p.id === man.id; })) return;
        var n = (man.appList || []).filter(function (a) { return a && a.cat === "gn-math"; }).length;
        var c = el("span", "vx-chip on");
        c.innerHTML = iconSVG("package", "luc-14") + esc(man.name || man.id) +
            '<b class="vx-n">' + n + " games</b>";
        var x = el("span", "vx-x");
        x.title = "remove " + (man.name || man.id);
        x.setAttribute("role", "button");
        x.setAttribute("aria-label", "remove " + (man.name || man.id));
        x.innerHTML = iconSVG("x", "luc-14");
        x.addEventListener("click", function (ev) { ev.stopPropagation(); extRemove(man.id); });
        c.appendChild(x);
        chips.appendChild(c);
    });
    var line = $("veilGnmathLine");
    if (nApps > 0) {
        line.textContent = nApps + " gn-math games installed" + (EXT_DB ? " · the packet stays on this device" : " · the packet loads per-session here");
    } else {
        var g = 0;
        gPacks.forEach(function (p) { g += p.apps || 0; });
        line.textContent = gPacks.length + " packet" + (gPacks.length === 1 ? "" : "s") + " · " + g + " math games waiting — one click in Extensions installs them";
    }
}

/* ── the ai lab view — apps BUILT by Veil AI (Extension Maker in the
   chat). Every app is one self-contained page living in a Blob; the
   same player runs it. No catalog here — these are made by hand, on
   demand, in the Veil AI chat. */
function renderAilab(q) {
    var list = $("veilAilabList");
    if (!list) return;
    q = (q || "").toLowerCase().trim();
    list.innerHTML = "";
    var apps = aiApps().filter(function (a) {
        return !q || (a.name + " " + a.desc + " " + a.cat).toLowerCase().indexOf(q) !== -1;
    });
    var sec = $("veilSecArcade");
    if (!sec.classList.contains("open")) return;
    if (!apps.length) {
        var empty = el("div", "loadbox warn ai-empty");
        empty.innerHTML = iconSVG("bot", "") + "<div>No AI-made apps" + (q ? ' match "' + esc(q) + '"' : "") + " yet.</div>";
        var hint = el("p", "ai-hint");
        hint.innerHTML = "open <b>Veil AI</b> on the dock, hit <b>Extension Maker</b>, and describe an app or game — \u201Ca neon snake with a high score\u201D. The answer arrives as an installable extension that lands right here.";
        empty.appendChild(hint);
        list.appendChild(empty);
    } else {
        var grid = el("div", "veil-su-grid ai");
        apps.forEach(function (a) {
            var card = el("button", "veil-su-card ai");
            card.type = "button";
            card.title = a.name + " — " + a.desc + " · " + (a.packName || "");
            card.setAttribute("aria-label", "open " + a.name);
            card.innerHTML =
                '<span class="su-ic">' + iconSVG(a.icon, "luc-20") + "</span>" +
                '<span class="su-nm">' + esc(a.name) + "</span>" +
                '<span class="su-ds">' + esc(a.desc || "") + "</span>" +
                '<span class="su-pk">' + esc(a.packName || "made by Veil AI") + "</span>";
            card.addEventListener("click", function () { sulfurLaunch(a); });
            grid.appendChild(card);
        });
        list.appendChild(grid);
    }
    renderAilabBar();
}
function renderAilabBar() {
    var bar = $("veilAilabBar");
    if (!bar) return;
    if (EXT_BUSY) return; /* the progress pass owns the bars right now */
    var aiPacks = [];
    for (var id in EXT_INSTALLED) {
        var man = EXT_INSTALLED[id];
        if ((man.appList || []).some(function (a) { return a && a.cat === "ai"; })) aiPacks.push(man);
    }
    var nApps = aiApps().length;
    if (!aiPacks.length) { bar.hidden = true; return; }
    bar.hidden = false;
    var prog = $("veilAilabProg");
    if (prog) { prog.hidden = true; if (prog.firstElementChild) prog.firstElementChild.style.width = "0"; }
    var chips = $("veilAilabChips");
    chips.innerHTML = "";
    aiPacks.forEach(function (man) {
        var n = (man.appList || []).filter(function (a) { return a && a.cat === "ai"; }).length;
        var c = el("span", "vx-chip on");
        c.innerHTML = iconSVG("bot", "luc-14") + esc(man.name || man.id) +
            '<b class="vx-n">' + n + (n === 1 ? " app" : " apps") + "</b>";
        c.title = (man.name || man.id) + " — built by Veil AI" + (EXT_DB ? " · stays installed" : " · this session");
        var x = el("span", "vx-x");
        x.title = "remove " + (man.name || man.id);
        x.setAttribute("role", "button");
        x.setAttribute("aria-label", "remove " + (man.name || man.id));
        x.innerHTML = iconSVG("x", "luc-14");
        x.addEventListener("click", function (ev) { ev.stopPropagation(); extRemove(man.id); });
        c.appendChild(x);
        chips.appendChild(c);
    });
    var line = $("veilAilabLine");
    line.textContent = nApps + " AI-made app" + (nApps === 1 ? "" : "s") + " · built in the Veil AI chat" +
        (EXT_DB ? " · stays on this device" : " · loads per-session here");
}

/* ═══ 12. VEIL AI ══════════════════════════════════════════════ */
var aiMsgs = [];
var aiBusy = false;
/* while a request is in flight: its cancel handle. The send button
   becomes a STOP button — a slow or hung build must never lock the chat. */
var aiStopFn = null;
function setAiSend(busy) {
    var b = $("veilAiSend");
    if (!b) return;
    if (busy) {
        b.setAttribute("aria-label", "Stop generating");
        b.title = "Stop — cancel and keep your text";
        b.classList.add("stop");
        b.innerHTML = iconSVG("square", "fill-c");
    } else {
        b.setAttribute("aria-label", "Send");
        b.title = "";
        b.classList.remove("stop");
        b.innerHTML = iconSVG("send", "");
    }
}
/* while a request is in flight: its cancel handle. The send button
   becomes a STOP button — a slow or hung build must never lock the chat. */
var aiStopFn = null;
function setAiSend(busy) {
    var b = $("veilAiSend");
    if (!b) return;
    if (busy) {
        b.setAttribute("aria-label", "Stop generating");
        b.title = "Stop — cancel and keep your text";
        b.classList.add("stop");
        b.innerHTML = iconSVG("square", "fill-c");
    } else {
        b.setAttribute("aria-label", "Send");
        b.title = "";
        b.classList.remove("stop");
        b.innerHTML = iconSVG("send", "");
    }
}
/* Veil AI is served by this file's birth origin — the SAME engine the
   website uses (/api/ai → z-ai LLM with the Veil-aware system prompt).
   The old keyless pollinations.ai fallback stays for origin-less copies
   (it now usually 402s, so the origin path is the real one). */
var AI_URL = VEIL_ORIGIN ? VEIL_ORIGIN + "/api/ai" : "https://text.pollinations.ai/openai";
function mdLite(src) {
    var out = esc(src);
    out = out.replace(/```([\s\S]*?)```/g, function (_, code) {
        return "<pre><code>" + code.replace(/^\n+|\n+$/g, "") + "</code></pre>";
    });
    out = out.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/^[-•] (.+)$/gm, '<li>$1</li>');
    out = out.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, "<ul>$1</ul>");
    out = out.split(/\n{2,}/).map(function (p) {
        var t = p.trim();
        if (!t) return "";
        if (t.indexOf("<pre>") === 0 || t.indexOf("<ul>") === 0) return t;
        return "<p>" + t.replace(/\n/g, "<br>") + "</p>";
    }).join("");
    return out;
}
function renderAi() {
    var msgs = $("veilAiMsgs");
    msgs.innerHTML = "";
    $("veilAiEmpty").style.display = aiMsgs.length ? "none" : "";
    $("veilAiCount").textContent = aiMsgs.length ? aiMsgs.length + (aiMsgs.length === 1 ? " message" : " messages") : "";
    aiMsgs.forEach(function (m) {
        if (m.role === "user") {
            var u = el("div", "veil-msg user");
            u.textContent = m.content;
            msgs.appendChild(u);
        } else {
            var b = el("div", "veil-msg bot" + (m.thinking ? " think" + (m.content ? " stream" : "") : "") + (m.lite ? " lite" : ""));
            if (m.thinking) {
                if (aiMaker) {
                    /* maker builds never paint the raw HTML into the chat —
                       the moment the code starts (fence / doctype / metadata
                       comment) the bubble switches to a live "building"
                       panel; the code's only home is the View HTML viewer */
                    var cut = aiLiveCut(String(m.content || ""));
                    if (cut.building) {
                        b.innerHTML = (cut.prose ? mdLite(cut.prose) : "") +
                            '<div class="ai-build"><span class="pkg">' + iconSVG("package", "luc-14 spin") +
                            '</span><span class="tx"><b>Veil AI is building the app\u2026</b><i>' +
                            (cut.bytes / 1024).toFixed(1) + " KB written \u2014 the code stays hidden until it lands</i></span></div>";
                    } else if (cut.prose) {
                        b.innerHTML = mdLite(cut.prose) + '<span class="ai-caret"></span>';
                    } else {
                        b.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
                    }
                } else if (m.content) {
                    /* deltas are streaming in — prose so far + a live caret */
                    b.innerHTML = mdLite(m.content) + '<span class="ai-caret"></span>';
                } else {
                    b.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
                }
            } else {
                /* a built extension renders as its own install card — the
                   giant app code (fenced or raw) leaves the prose */
                var body = m.ext ? aiStripExtHtml(String(m.content)) : m.content;
                b.innerHTML = (m.lite ? '<span class="ai-lite-tag">' + iconSVG("spark", "luc-14") + "veil lite · offline brain</span>" : "") + mdLite(body);
                if (m.ext) b.appendChild(aiExtCard(m));
            }
            msgs.appendChild(b);
        }
    });
    var sc = $("veilAiScroll");
    sc.scrollTop = sc.scrollHeight;
}
var aiText = $("veilAiText");
function autoGrow() {
    aiText.style.height = "36px";
    var h = Math.min(aiText.scrollHeight, 132);
    aiText.style.height = h + "px";
}
aiText.addEventListener("input", autoGrow);
aiText.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendAi();
    }
});
$("veilAiSend").addEventListener("click", sendAi);
document.querySelectorAll(".veil-ai-sug").forEach(function (b) {
    b.addEventListener("click", function () {
        var q = b.querySelector(".ss").textContent;
        aiText.value = q;
        autoGrow();
        sendAi();
    });
});

/* ── Extension Maker — Veil AI builds extensions for THIS file ──
   A mode of the chat: describe an app or game, the model returns one
   self-contained HTML page, the chat renders it as a card with an
   Install button, and the package wraps into the same VEIL-EXT format
   the hand-built packs use (manifest + base64 asset, category "ai" →
   the Arcade's AI Lab tab). Install runs through extInstallText —
   IndexedDB persistence, drag-drop parity, everything. */
var aiMaker = false;
var AI_EXT_PROMPT = [
    "You are Veil AI in Extension Maker mode. The user describes an app or game; you build it as ONE complete, self-contained HTML page that becomes a Veil extension.",
    "Reply with one short intro sentence, then ONE fenced code block tagged html containing the ENTIRE app, and nothing after it.",
    "Right after the doctype, first line inside the block, emit a metadata comment: " + CMT_OPEN + " veil-ext {\"name\":\"Short Name\",\"desc\":\"One-line description\",\"icon\":\"icon\"} " + CMT_CLOSE,
    "icon must be ONE of: bot, joypad, image, globe, dices, search, spark, calc, trophy, zap, timer, brush, pen, filetext, monitor, key, palette, worm, bomb, music, heart, desktop, play, archive, package.",
    "Hard rules: zero external requests (no CDN, fetch, imports, web fonts or web images — inline style and script tags only); dark theme with one emerald or violet accent; responsive; touch AND keyboard; proper doctype, charset and viewport meta plus a title; localStorage guarded with try/catch; no alert/confirm/prompt; no libraries; aim for 150-600 lines of genuinely fun, polished app.",
    "The page runs in a sandboxed iframe: never touch window.top, never navigate away.",
    "If the request is unclear, pick a reasonable interpretation and build it — never answer with questions instead of the code block."
].join("\n");
function setAiMaker(on) {
    aiMaker = on;
    var b = $("veilAiMaker");
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    $("veilAiMakerDot").hidden = !on;
    aiText.placeholder = on
        ? "Describe the extension to build — “a neon snake game with a high score”…"
        : "Ask Veil AI…";
    aiText.classList.toggle("maker", on);
    if (on) aiText.focus();
}
if ($("veilAiMaker")) {
    $("veilAiMaker").addEventListener("click", function () { setAiMaker(!aiMaker); });
}
if ($("veilAiMkCard")) {
    $("veilAiMkCard").addEventListener("click", function () {
        setAiMaker(true);
    });
}

/* Pull the app out of an Extension Maker reply (fallback for replies
   the server did not pre-extract — e.g. the origin-less pollinations
   path). Mirrors the server's parse rules — INCLUDING the fence-less
   shape: some model turns ship the raw page without ``` fences, so the
   extraction anchors on the veil-ext metadata comment or the doctype
   instead and a missing fence never costs the install card. */
function aiExtParse(txt) {
    var src = String(txt || "");
    var fence = /```(?:html)?\s*\n([\s\S]*?)```/.exec(src);
    var html = fence ? fence[1].trim() : "";
    if (html.length < 400) {
        var start = -1;
        var metaAll = new RegExp(CMT_OPEN + "\\s*veil-ext\\s*\\{[\\s\\S]*?\\}\\s*" + CMT_CLOSE).exec(src);
        if (metaAll) start = metaAll.index;
        if (start === -1) start = src.toLowerCase().lastIndexOf("<!doctype html");
        if (start !== -1) {
            var end = src.toLowerCase().lastIndexOf("</html>");
            if (end !== -1 && end > start) {
                var cut = src.slice(start, end + 7).trim();
                var docIn = cut.toLowerCase().indexOf("<!doctype html");
                if (docIn > 0) cut = cut.slice(docIn).trim();
                if (cut.length >= 400) html = cut;
            }
        }
    }
    if (html.length < 400) return null;
    var name = "", desc = "", icon = "spark";
    var RX_EXT_META = new RegExp(CMT_OPEN + "\\s*veil-ext\\s*(\\{[\\s\\S]*?\\})\\s*" + CMT_CLOSE);
    var meta = RX_EXT_META.exec(html) || RX_EXT_META.exec(src);
    if (meta) {
        try {
            var j = JSON.parse(meta[1]);
            if (typeof j.name === "string") name = j.name.trim().slice(0, 40);
            if (typeof j.desc === "string") desc = j.desc.trim().slice(0, 140);
            if (typeof j.icon === "string" && /^[a-z0-9]+$/i.test(j.icon)) icon = j.icon.toLowerCase();
        } catch (e) {}
    }
    var title = /<title>([^<]{1,80})<\/title>/i.exec(html);
    if (!name && title) name = title[1].trim().slice(0, 40);
    if (!name) name = "AI Extension";
    if (!desc) {
        var md = /<meta\s+name=["']description["']\s+content=["']([^"']{1,200})["']/i.exec(html);
        desc = md ? md[1].trim().slice(0, 140) : "Made by Veil AI";
    }
    html = html.replace(new RegExp(CMT_OPEN + "\\s*veil-ext\\s*\\{[\\s\\S]*?\\}\\s*" + CMT_CLOSE), "").trim();
    return { name: name, desc: desc, icon: icon, html: html, id: "" };
}

/* The built app's code leaves the chat prose (fenced or raw) — the
   install card is the single place it's shown. */
function aiStripExtHtml(content) {
    var out = String(content || "").replace(/```(?:html)?\s*\n[\s\S]*?```/g, "").trim();
    if (/<\/html>/i.test(out)) {
        var anchor = new RegExp(CMT_OPEN + "\\s*veil-ext\\s*\\{[\\s\\S]*?\\}\\s*" + CMT_CLOSE + "|<!doctype html", "i").exec(out);
        if (anchor) out = anchor.index > 0 ? out.slice(0, anchor.index).trim() : "";
    }
    return out;
}

/* live variant for maker replies still streaming: cut the visible text
   at the first sign of the app's code (open fence / doctype / metadata
   comment) so the raw HTML is never painted into the chat while it's
   being written — returns the prose so far + bytes of code landed */
function aiLiveCut(s) {
    var src = String(s || "");
    var cut = -1;
    var f = src.indexOf("```");
    if (f !== -1) cut = f;
    var d = src.toLowerCase().indexOf("<!doctype html");
    if (d !== -1 && (cut === -1 || d < cut)) cut = d;
    var mta = src.indexOf(CMT_OPEN + " veil-ext");
    if (mta !== -1 && (cut === -1 || mta < cut)) cut = mta;
    if (cut === -1) return { prose: src, building: false, bytes: 0 };
    return { prose: src.slice(0, cut).trim(), building: true, bytes: Math.max(0, src.length - cut) };
}

/* unicode-safe base64 */
function aiB64(str) {
    try {
        var bytes = new TextEncoder().encode(str);
        var bin = "";
        for (var i = 0; i < bytes.length; i += 0x8000) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        return btoa(bin);
    } catch (e) {
        return btoa(unescape(encodeURIComponent(str)));
    }
}

/* Wrap a built app into a full VEIL-EXT package — the exact format
   extParse installs. (All literal closing-tag strings below use the
   escaped form so this script never terminates itself when the file
   is inlined into HTML.) */
function aiExtPackage(m) {
    var ext = m.ext;
    var id = ext.id || ("ai-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    var key = "app:" + id;
    var b64 = aiB64(ext.html);
    var kb = Math.round(ext.html.length / 1024);
    var man = {
        sig: "VEIL-EXT", v: 1, id: id, name: ext.name, desc: ext.desc || "Made by Veil AI",
        assets: [key],
        appList: [{ key: key, name: ext.name, desc: ext.desc || "", icon: ext.icon || "spark", cat: "ai", kb: kb }],
        bytes: ext.html.length, games: 0, apps: 1,
        built: new Date().toISOString().slice(0, 10)
    };
    var pkg = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
        '<title>Veil Extension — ' + esc(ext.name) + '</title>\n' +
        '<meta name="description" content="An AI-made Veil extension — ' + esc(ext.desc || "built by Veil AI") + '.">\n' +
        '</head>\n<body>\n' +
        TAG_S + ' type="text/veil-ext-man' + 'ifest" id="veilExtManifest">' + JSON.stringify(man) + '<\/scr' + 'ipt>\n' +
        '<main style="max-width:480px;margin:40px auto;padding:28px;background:#131316;border:1px solid rgba(139,92,246,.35);border-radius:18px;color:#e4e4e7;font-family:ui-monospace,monospace">' +
        '<p style="font-size:10.5px;font-weight:700;letter-spacing:.22em;color:#a78bfa;margin:0 0 8px">VEIL EXTENSION · AI MADE</p>' +
        '<h1 style="font-size:22px;color:#fafafa;margin:0 0 6px">' + esc(ext.name) + '</h1>' +
        '<p style="font-size:12.5px;color:#a1a1aa;margin:0 0 14px">' + esc(ext.desc || "") + ' · ' + kb + ' KB · made by Veil AI</p>' +
        '<p style="font-size:12.5px;line-height:1.55;color:#a1a1aa;border:1px dashed rgba(139,92,246,.45);border-radius:12px;padding:12px 14px;background:rgba(139,92,246,.06)">Open <b>veil-offline.html</b> → <b>Extensions</b> on the dock — pick this file, or drag it onto the page. The app lands under <b>Arcade → ai lab</b>.</p>' +
        '</main>\n' +
        TAG_S + ' type="text/veil-asset" id="veilA:' + key + '" data-mime="text/html">' + b64 + '<\/scr' + 'ipt>\n' +
        '</body>\n</html>\n';
    return { text: pkg, id: id, kb: kb };
}

function aiExtCard(m) {
    var ext = m.ext;
    var card = el("div", "veil-ai-ext");
    var head = el("div", "ax-hd");
    var done = ext.id && EXT_INSTALLED[ext.id];
    head.innerHTML =
        '<span class="ax-ic">' + iconSVG(ext.icon || "package", "luc-16") + "</span>" +
        '<span class="ax-tx"><b>' + esc(ext.name) + "</b><i>" + esc(ext.desc || "") + "</i></span>" +
        '<span class="ax-kb">' + Math.round(ext.html.length / 1024) + " KB</span>";
    card.appendChild(head);
    var row = el("div", "ax-row");
    var install = el("button", "ax-btn go" + (done ? " done" : ""));
    install.type = "button";
    install.innerHTML = iconSVG(done ? "check" : "package", "luc-14") +
        "<span>" + (done ? "installed — open the arcade" : "install now") + "</span>";
    install.setAttribute("aria-label", (done ? "open" : "install") + " " + ext.name);
    install.addEventListener("click", function () { aiExtInstall(m, install); });
    row.appendChild(install);
    var dl = el("button", "ax-btn");
    dl.type = "button";
    dl.title = "save the package file — installs on any Veil copy";
    dl.innerHTML = iconSVG("dl", "luc-14") + "<span>download</span>";
    dl.addEventListener("click", function () {
        var p = aiExtPackage(m);
        ext.id = ext.id || p.id;
        var blob = new Blob([p.text], { type: "text/html" });
        var url = URL.createObjectURL(blob);
        var a = el("a");
        a.href = url;
        a.download = "veil-ext-" + p.id + ".html";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
    row.appendChild(dl);
    var view = el("button", "ax-btn");
    view.type = "button";
    view.innerHTML = iconSVG("eye", "luc-14") + "<span>view HTML</span>";
    view.setAttribute("aria-label", "view the actual HTML source of " + ext.name);
    view.addEventListener("click", function () { aiCodeView(m); });
    row.appendChild(view);
    card.appendChild(row);
    return card;
}

/* ── View HTML — the actual code, full screen ─────────────────────
   The Extension Maker's output is a real self-contained page; the
   viewer shows its source with line numbers, a copy button, a live
   preview tab and a raw .html save — so the code is never a mystery
   box behind an install button. Esc / backdrop / X close it. */
var CV_LINES_MAX = 1500;
function aiCopyText(text, btn) {
    var done = function () {
        btn.classList.add("ok");
        btn.innerHTML = iconSVG("check", "luc-14") + "<span>copied</span>";
        setTimeout(function () {
            btn.classList.remove("ok");
            btn.innerHTML = iconSVG("copy", "luc-14") + "<span>copy code</span>";
        }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { aiCopyFallback(text, done); });
    } else {
        aiCopyFallback(text, done);
    }
}
function aiCopyFallback(text, done) {
    try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        ta.remove();
        done();
    } catch (err) {
        toast("Couldn't reach the clipboard");
    }
}
function aiSlug(name) {
    var s = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return (s || "veil-ext") + ".html";
}
function aiCodeView(m) {
    var ext = m.ext;
    aiCodeViewClose();
    var lines = String(ext.html).replace(/\r\n?/g, "\n").split("\n");
    var cut = lines.length > CV_LINES_MAX;
    var view = cut ? lines.slice(0, CV_LINES_MAX) : lines;
    var kb = Math.round(ext.html.length / 1024);

    var wrap = el("div", "veil-codeview");
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-label", ext.name + " — HTML source");

    var head = el("div", "cv-hd");
    head.innerHTML =
        '<span class="cv-ic">' + iconSVG("filetext", "luc-16") + "</span>" +
        '<span class="cv-tx"><b>' + esc(ext.name) + " — HTML</b><i>the actual source code \u00b7 " +
        lines.length.toLocaleString() + " lines \u00b7 " + kb + " KB</i></span>";
    var x = el("button", "cv-x");
    x.type = "button";
    x.title = "close (Esc)";
    x.setAttribute("aria-label", "close the code viewer");
    x.innerHTML = iconSVG("x", "luc-14");
    x.addEventListener("click", aiCodeViewClose);
    head.appendChild(x);
    wrap.appendChild(head);

    var bar = el("div", "cv-bar");
    var copy = el("button", "cv-btn");
    copy.type = "button";
    copy.innerHTML = iconSVG("copy", "luc-14") + "<span>copy code</span>";
    copy.addEventListener("click", function () { aiCopyText(ext.html, copy); });
    bar.appendChild(copy);
    var prev = el("button", "cv-btn");
    prev.type = "button";
    prev.title = "run the app in a new tab";
    prev.innerHTML = iconSVG("external", "luc-14") + "<span>open preview</span>";
    prev.addEventListener("click", function () {
        var url = URL.createObjectURL(new Blob([ext.html], { type: "text/html" }));
        window.open(url, "_blank");
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    });
    bar.appendChild(prev);
    var raw = el("button", "cv-btn");
    raw.type = "button";
    raw.title = "save the app page itself";
    raw.innerHTML = iconSVG("dl", "luc-14") + "<span>save .html</span>";
    raw.addEventListener("click", function () {
        var url = URL.createObjectURL(new Blob([ext.html], { type: "text/html" }));
        var a = el("a");
        a.href = url;
        a.download = aiSlug(ext.name);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    });
    bar.appendChild(raw);
    var note = el("span", "cv-note");
    note.textContent = "runs anywhere — a single self-contained page";
    bar.appendChild(note);
    wrap.appendChild(bar);

    var body = el("div", "cv-body veil-slim");
    var pre = el("pre", "cv-pre");
    /* textContent — the source must render as text, never as markup */
    pre.textContent = view.map(function (ln, i) {
        return String(i + 1).padStart(5, " ") + "  \u2502  " + (ln || " ");
    }).join("\n");
    body.appendChild(pre);
    if (cut) {
        var more = el("p", "cv-more");
        more.textContent = "+" + (lines.length - CV_LINES_MAX).toLocaleString() +
            " more lines — copy code or save .html for the full source.";
        body.appendChild(more);
    }
    wrap.appendChild(body);

    var back = el("div", "cv-back");
    back.addEventListener("click", aiCodeViewClose);
    var shell = document.getElementById("veilShell") || document.body;
    shell.appendChild(back);
    shell.appendChild(wrap);
    shell.classList.add("cv-open");

    document.addEventListener("keydown", aiCodeViewEsc);
}
function aiCodeViewEsc(e) {
    if (e.key === "Escape") { e.stopPropagation(); aiCodeViewClose(); }
}
function aiCodeViewClose() {
    document.removeEventListener("keydown", aiCodeViewEsc);
    var shell = document.getElementById("veilShell") || document.body;
    shell.classList.remove("cv-open");
    shell.querySelectorAll(".veil-codeview, .cv-back").forEach(function (n) { n.remove(); });
}
function aiExtInstall(m, btn) {
    var ext = m.ext;
    if (ext.id && EXT_INSTALLED[ext.id]) {
        openSection("arcade");
        setArcTab("ailab");
        return;
    }
    var p = aiExtPackage(m);
    ext.id = p.id;
    btn.disabled = true;
    btn.classList.add("busy");
    btn.innerHTML = iconSVG("reload", "luc-14 spin") + "<span>installing…</span>";
    extInstallText(p.text, "AI-made extension").then(function (ok) {
        btn.disabled = false;
        btn.classList.remove("busy");
        if (ok) {
            btn.classList.add("done");
            btn.innerHTML = iconSVG("check", "luc-14") + "<span>installed — open the arcade</span>";
        } else {
            btn.innerHTML = iconSVG("package", "luc-14") + "<span>install now</span>";
        }
    });
}

/* ── Veil Lite — the offline brain ──────────────────────────────
   When the birth origin is unreachable AND the keyless pollinations
   fallback is down (paywalled 402s, captive portals, planes), AI used
   to die with a raw network error. Instead Veil Lite answers locally:
   identity, quick math, time/date, splash quotes and a real guide to
   everything this file embeds. The full engine returns with the
   network — the reply carries a "veil lite" tag so it's honest. */
function aiSafeMath(expr) {
    var e = String(expr || "").replace(/[^0-9+\-*/().% ]/g, "").trim();
    if (!e || !/[0-9]/.test(e) || !/[+\-*/%]/.test(e)) return null;
    try {
        var v = Function('"use strict"; return (' + e + ")")();
        return typeof v === "number" && isFinite(v) ? String(Math.round(v * 1e10) / 1e10) : null;
    } catch (err) { return null; }
}
function veilOfflineBrain(text) {
    var t = String(text || "").toLowerCase().trim();
    if (aiMaker) {
        return "The Extension Maker needs the live Veil AI engine — I'm **Veil Lite**, the offline spark, and building whole apps is beyond me without the model.\n\n- Reconnect (or open this file while its birth origin answers) and hit **Extension Maker** again\n- The Arcade's **ai lab** tab keeps every extension already built\n- Everything embedded — games, wallpapers, tools — keeps working right now";
    }
    if (/^(hi|hey+|hello|yo|sup|hai|good (morning|afternoon|evening))\b/.test(t) || t === "hi!" ) {
        return "Hey — I'm **Veil Lite**, Veil AI's offline spark. No network, still talking.\n\nQuick math, the time, a splash quote, or a tour of what this file carries — ask away. The full engine wakes the moment the birth origin answers.";
    }
    if (/who are you|your name|what are you|are you (an? )?(ai|bot|robot|real)/.test(t)) {
        return "I'm **Veil Lite** — the part of Veil AI that lives inside this file. The full assistant runs on the birth origin's engine; when the network can't reach it, I answer from here so the chat never goes dark.";
    }
    var mathHit = /((?:\d+(?:\.\d+)?\s*[+\-*/%]\s*)+\d+(?:\.\d+)?)/.exec(t.replace(/,/g, ""));
    if (mathHit && /what|how much|=|calc|plus|minus|times|calculate|^[\d\s+\-*/%.]+$/.test(t)) {
        var v = aiSafeMath(mathHit[1]);
        if (v !== null) return "`" + mathHit[1].trim() + " = " + v + "`\n\nOffline math never misses. Need the full assistant for anything deeper — it's back the moment the origin answers.";
    }
    if (/\b(time|clock|what day|today|date)\b/.test(t)) {
        var d = new Date();
        return "It's **" + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + "** on " + d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" }) + " — device clock, no network needed.";
    }
    if (/splash|quote|motivat|inspire|mantra/.test(t)) {
        var pool = ["Your Back", "I know its the best", "happy?", "1+1=11", "woah", "better than the rest", "Technoblade Never dies", "battle royale", "If your enemy's know your next move dont move", "fire hurts- Trust me", "Why did I pick the name veil IDK", "WORDS", "gravity hurts", "verified by me"];
        return '"' + pool[Math.floor(Math.random() * pool.length)] + '"\n\n— straight from this file\'s own splash pool.';
    }
    if (/arcade|game|play|bored|something fun/.test(t)) {
        return "The **Arcade** on the dock is fully embedded — zero network needed:\n\n- **stash packs i & ii** — dozens of real games, playable right now\n- **veil games, gn math, tools** — the built-in packs\n- **ai lab** — extensions Veil AI built earlier\nHit the joystick icon, or search a title inside.";
    }
    if (/wallpaper|background|\bbg\b|live wall/.test(t)) {
        return "**Wallpapers** on the dock: the embedded **pack** works with zero network, plus animated **themes** and your uploads. The **Live** and **4K** catalogs stream from the network — when it's back they load again (and what you last loaded is cached for offline).";
    }
    if (/youtube|freetube|video|watch|channel|subscribe/.test(t)) {
        return "**FreeTube** — the private YouTube program — runs from this file's birth origin, so it needs the origin reachable. The moment it answers, `freetube.veil.local` (or typing any youtube link) opens the real app with subscriptions and history.";
    }
    if (/music|song|spotify|playlist/.test(t)) {
        return "The **Music** section searches and streams through the tunnel — it needs a network. Everything else embedded (arcade, wallpaper pack, tools) runs without one.";
    }
    if (/search|browse|website|internet|web/.test(t)) {
        return "Browsing tunnels the web through public relays — no birth origin needed, but it does need a network. Search from the command bar (or `Ctrl+K`), and try `wikipedia.org`, `bing.com` or `lite.cnn.com` — those fly through the veil.";
    }
    if (/password|unlock|code/.test(t)) {
        return "The download password lives on the site — I keep it out of the offline brain on purpose.";
    }
    if (/thank|thanks|thx|ty\b/.test(t)) {
        return "Anytime — that's what the offline spark is for.";
    }
    if (/help|what can you do|commands|features/.test(t)) {
        return "Offline, I can:\n\n- **math** — `what is 23*7`\n- **time & date** — `what time is it`\n- **splash quotes** — `give me a splash line`\n- **guide the file** — arcade, wallpapers, freetube, music, browsing\nThe full engine handles everything else once the network's back.";
    }
    return "The live engine is out of reach from here, and that one's past my offline brain.\n\nI've got quick **math**, the **time**, **splash quotes**, and guides for the **arcade / wallpapers / freetube** while you wait — the full Veil AI answers again the moment this file's birth origin responds.";
}
function sendAi() {
    var text = aiText.value.trim();
    if (!text || aiBusy) return;
    aiText.value = ""; autoGrow();
    aiMsgs.push({ role: "user", content: text });
    aiMsgs.push({ role: "assistant", content: "", thinking: true });
    renderAi();
    aiBusy = true;
    $("veilAiSend").disabled = true;
    var idx = aiMsgs.length - 1;
    var history = aiMsgs.filter(function (m) { return !m.thinking; }).slice(-12).map(function (m) {
        /* never send the built app's code back — a 10KB ext reply would
           400 the request schema on the very next message ("Couldn't
           reach the assistant" right after the first build) */
        var c = m.ext
            ? (aiStripExtHtml(String(m.content)) || "[Built \u201c" + m.ext.name + "\u201d \u2014 an installable extension]")
            : String(m.content);
        return { role: m.role, content: c.slice(0, 20000) };
    });

    /* live paint while deltas stream in — throttled so a fast model
       can't thrash the DOM */
    var paintTimer = null;
    function paint(force) {
        if (force) { clearTimeout(paintTimer); paintTimer = null; }
        if (paintTimer) return;
        paintTimer = setTimeout(function () {
            paintTimer = null;
            renderAi();
        }, 90);
    }
    function appendDelta(d) {
        aiMsgs[idx].content += d;
        paint(false);
    }
    function done(txt, ext) {
        var msg = { role: "assistant", content: txt };
        if (aiMaker) {
            var e = ext || aiExtParse(txt);
            if (e) { e.id = e.id || ""; msg.ext = e; }
        }
        aiMsgs[idx] = msg;
        finish();
    }
    function finish() {
        clearTimeout(paintTimer);
        paintTimer = null;
        aiBusy = false;
        $("veilAiSend").disabled = false;
        renderAi();
    }

    /* stage 1 — the birth origin, streamed (SSE): deltas land live, a
       heartbeat keeps outer proxies from cutting long builds short */
    function originStage() {
        if (!VEIL_ORIGIN) return Promise.reject(new Error("no birth origin"));
        return fetch(AI_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(aiMaker
                ? { make: "ext", stream: true, messages: history }
                : { stream: true, messages: history })
        }).then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            var ct = r.headers.get("content-type") || "";
            if (ct.indexOf("application/json") !== -1) {
                /* compat path — the origin answered JSON */
                return r.json().then(function (j) {
                    if (!j || !j.reply) throw new Error((j && j.error) || "empty reply");
                    return { txt: j.reply, ext: (aiMaker && j && j.ext) || null };
                });
            }
            if (ct.indexOf("text/event-stream") === -1) {
                throw new Error("the origin answered a web page instead of the assistant");
            }
            var reader = r.body.getReader();
            var dec = new TextDecoder();
            var carry = "", full = "", final = null;
            function frame(raw) {
                var lines = String(raw).split("\n");
                for (var i = 0; i < lines.length; i++) {
                    if (lines[i].indexOf("data:") !== 0) continue; /* heartbeats */
                    var payload = lines[i].slice(5).trim();
                    if (!payload) continue;
                    var j = null;
                    try { j = JSON.parse(payload); } catch (e) { continue; }
                    if (typeof j.delta === "string" && j.delta) {
                        full += j.delta;
                        appendDelta(j.delta);
                    } else if (j.done) {
                        final = { txt: j.reply || full, ext: (aiMaker && j.ext) || null };
                        return true;
                    } else if (j.error) {
                        throw new Error(j.error);
                    }
                }
                return false;
            }
            function pump() {
                return reader.read().then(function (res) {
                    if (res.done) {
                        if (final) return final;
                        if (full) return { txt: full, ext: null };
                        throw new Error("the stream closed early");
                    }
                    carry += dec.decode(res.value, { stream: true });
                    var sep;
                    while ((sep = carry.indexOf("\n\n")) >= 0) {
                        if (frame(carry.slice(0, sep))) return final;
                        carry = carry.slice(sep + 2);
                    }
                    return pump();
                });
            }
            return pump();
        });
    }

    /* stage 2 — the keyless pollinations fallback (often 402'd, but
       free when it works; content-type checked before any parse) */
    function pollinationsStage() {
        return fetch("https://text.pollinations.ai/openai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "openai",
                messages: [{ role: "system", content: aiMaker ? AI_EXT_PROMPT : "You are Veil AI, the assistant inside Veil — a privacy-first browser that tunnels the web through the veil. Be concise, warm, and helpful. Use markdown sparingly (bold, lists, code)." }].concat(history),
                stream: false
            })
        }).then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            var ct = r.headers.get("content-type") || "";
            if (ct.indexOf("json") === -1) throw new Error("the model service answered a web page");
            return r.json();
        }).then(function (j) {
            var txt = (j && (j.reply || (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content))) || "";
            if (!txt) throw new Error("empty reply");
            return { txt: txt, ext: null };
        });
    }

    /* stage 3 — Veil Lite: typed out locally, zero network */
    function liteStage() {
        var txt = veilOfflineBrain(text);
        aiMsgs[idx] = { role: "assistant", content: "", thinking: true, lite: true };
        renderAi();
        var words = txt.split(" ");
        var i = 0;
        var typing = setInterval(function () {
            if (i >= words.length) {
                clearInterval(typing);
                aiMsgs[idx] = { role: "assistant", content: txt, lite: true };
                finish();
                return;
            }
            aiMsgs[idx].content += (i ? " " : "") + words[i++];
            paint(true);
        }, 26);
    }

    originStage()
        .then(function (res) { done(res.txt, res.ext); })
        .catch(function () {
            pollinationsStage()
                .then(function (res) { done(res.txt, res.ext); })
                .catch(function () { liteStage(); });
        });
}
renderAi();

/* ═══ 13. TOAST ════════════════════════════════════════════════ */
var toastTimer = null;
function toast(msg, isErr) {
    var t = $("veilToast");
    $("veilToastTx").textContent = msg;
    t.classList.toggle("err", !!isErr);
    t.querySelector("svg").style.color = isErr ? "#f87171" : "#34d399";
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
}

/* ═══ 14. GLOBAL KEYS (capture) ════════════════════════════════ */
document.addEventListener("keydown", function (e) {
    var tgt = e.target;
    var typing = tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable);

    if (e.key === "Escape") {
        if (zenOn) { setZen(false); return; }
        if ($("veilLb").classList.contains("open")) { closeLightbox(); return; }
        if ($("veilTitle").classList.contains("open")) { closeTitle(); return; }
        if (appOpen) { closeApp(); return; }
        if (anySection()) { closeAllSections(); updateChrome(); return; }
        if (barOpen) { setBarOpen(false); return; }
        return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "l" || e.key === "L")) {
        e.preventDefault(); e.stopImmediatePropagation();
        setBarOpen(true);
        requestAnimationFrame(function () { urlInput.focus(); urlInput.select(); });
        return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (gNewTab) gNewTab.click();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "w" || e.key === "W")) {
        e.preventDefault(); e.stopImmediatePropagation();
        var act = gStrip && gStrip.querySelector(".tab.active .tab-close");
        if (act) act.click();
        return;
    }
    if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); e.stopImmediatePropagation(); if (gBack && !gBack.disabled) gBack.click(); return; }
    if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); e.stopImmediatePropagation(); if (gFwd && !gFwd.disabled) gFwd.click(); return; }
    if ((e.key === "f" || e.key === "F") && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault(); e.stopImmediatePropagation();
        toggleFullscreen();
        return;
    }
    if (e.key === "?" && !typing) {
        e.preventDefault(); e.stopImmediatePropagation();
        openSection("keys");
        return;
    }
}, true);

/* ═══ 15. BOOT ═════════════════════════════════════════════════ */
function boot() {
    if (!findEngine()) {
        setTimeout(boot, 150);
        return;
    }
    hookUrlValue();
    hookEngineBits();

    /* engine → shell observers */
    new MutationObserver(syncMode).observe(gNewtab, { attributes: true, attributeFilter: ["class"] });
    new MutationObserver(function () { syncTabs(); }).observe(gStrip, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    syncMode();
    syncTabs();

    /* Settings › Browsing: "When I come back" — leaving this document
       (host tab switch / another tab opened) and RETURNING can reset to
       the start page, mirroring the website's reset-on-return. The file
       has always kept the session, so the default is "keep" — only an
       explicit "Start page" choice (veil:keep-session === "0") resets.
       Read live: the very next switch obeys a fresh setting. */
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState !== "visible") return;
        if (LS.get("veil:keep-session") !== "0") return;
        /* start mode has nothing to reset — only a live page counts */
        if (!gNewtab || gNewtab.classList.contains("active")) return;
        if (appOpen) { try { closeApp(); } catch (e) {} }
        if (anySection()) { closeAllSections(); updateChrome(); }
        if (barOpen) setBarOpen(false);
        if (gHome) gHome.click();
    });

    /* restore wallpaper */
    if (curSel) applyWallpaper(curSel, false);
    /* Settings › Appearance: the saved backdrop dim applies at boot */
    applyNtDim();

    renderRecent();
    renderHistSection();
    renderSuggestions();
    updateChrome();
    revealWhenReady();
}

/* ── boot cover lifecycle ─────────────────────────────────────────
   The shell script parses before the ~93MB of embedded asset text, so
   the UI is live while the document is still "loading". The black
   screen + emerald bar covers everything until BOTH the document parse
   and the engine (libcurl WASM) are ready — then the wallpaper is
   re-applied (embedded assets now exist) and the cover fades out.
   #veilBoot is the first-paint twin injected at the very top of <body>
   by the build (the engine's 3.8MB of markup parses for seconds before
   this script can turn on #veilLoad) — dismissed here as well. */
function dismissBootCover() {
    var b = $("veilBoot");
    if (!b || b.__dismissed) return;
    b.__dismissed = true;
    b.style.opacity = "0";
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 350);
}
function revealWhenReady() {
    if (revealWhenReady.done) return;
    var parsed = document.readyState === "interactive" || document.readyState === "complete";
    var engReady = window._libcurlReady === true;
    /* veil-bench: the engine's relay-benchmark phase (its splash sits
       z-99995, above the shell) — keep the boot cover until it's over. */
    var benching = htmlEl.classList.contains("veil-bench");
    if (parsed && engReady && !benching) {
        /* debounce: the benchmark splash can appear a tick AFTER libcurl
           reports ready — hold the cover ~1.2s to catch that start */
        if (!revealWhenReady.engAt) revealWhenReady.engAt = Date.now();
        if (Date.now() - revealWhenReady.engAt < 1200) { setTimeout(revealWhenReady, 300); return; }
        revealWhenReady.done = true;
        try { if (curSel) applyWallpaper(curSel, false); } catch (e) {}
        setLoadCover(false);
        dismissBootCover();
        return;
    }
    if (!revealWhenReady.deadline) revealWhenReady.deadline = Date.now() + 90000;
    if (Date.now() > revealWhenReady.deadline) {
        revealWhenReady.done = true;
        try { if (curSel) applyWallpaper(curSel, false); } catch (e) {}
        setLoadCover(false);
        dismissBootCover();
        return;
    }
    setTimeout(revealWhenReady, 250);
}

/* cover ON from the very first shell-script moment (the element lives
   just above this script in the same injection chunk) — no grace delay
   at boot: full black immediately */
(function () {
    var v = $("veilLoad");
    if (v) v.classList.add("on", "vis");
})();

/* ═══ 18. THE LAB TAB — visual experiments from the Veil Lab packet
   (veil-ext-lab-1.html: a neon piano synth + a gravity sandbox);
   same blob-launch channel as the toolkit / gn-math apps. ═══════ */
function labApps() {
    var out = [];
    for (var k in EXT_APPS) if (EXT_APPS[k].cat === "lab") out.push(EXT_APPS[k]);
    out.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
    return out;
}
function labCatalogPacks() {
    return EXT_CATALOG.filter(function (p) {
        return /^lab/i.test(p.id) || /\blab\b/i.test(p.name || "");
    });
}
function renderLab(q) {
    var list = $("veilLabList");
    if (!list) return;
    q = (q || "").toLowerCase().trim();
    list.innerHTML = "";
    var apps = labApps().filter(function (a) {
        return !q || (a.name + " " + a.desc).toLowerCase().indexOf(q) !== -1;
    });
    var sec = $("veilSecArcade");
    if (!sec.classList.contains("open")) return;
    if (!apps.length) {
        var empty = el("div", "loadbox warn su-empty lab-empty");
        empty.innerHTML = iconSVG("zap", "") + "<div>No lab experiments" + (q ? ' match "' + esc(q) + '"' : "") + " installed yet.</div>";
        var hint = el("p", "su-hint");
        hint.innerHTML = "grab the Veil Lab packet below" + (VEIL_ORIGIN ? " (or its download button)" : "") +
            " — a neon piano synth and a gravity sandbox, zero connection. Install it via <b>Extensions</b> on the dock, or just drag the packet onto the page.";
        empty.appendChild(hint);
        list.appendChild(empty);
    } else {
        var grid = el("div", "veil-su-grid lab-grid");
        apps.forEach(function (a) {
            var card = el("button", "veil-su-card lab");
            card.type = "button";
            card.title = a.name + " — " + a.desc + " · " + (a.packName || "");
            card.setAttribute("aria-label", "open " + a.name);
            card.innerHTML =
                '<span class="su-ic">' + iconSVG(a.icon || "zap", "luc-20") + "</span>" +
                '<span class="su-nm">' + esc(a.name) + "</span>" +
                '<span class="su-ds">' + esc(a.desc || "") + "</span>" +
                '<span class="su-pk">' + esc(a.packName || "veil lab") + "</span>";
            card.addEventListener("click", function () { sulfurLaunch(a); });
            grid.appendChild(card);
        });
        list.appendChild(grid);
    }
    renderLabBar();
}
function renderLabBar() {
    var bar = $("veilLabBar");
    if (!bar) return;
    if (EXT_BUSY) return; /* the progress pass owns the bars right now */
    var lPacks = labCatalogPacks();
    var installedL = [];
    for (var id in EXT_INSTALLED) {
        var man = EXT_INSTALLED[id];
        if ((man.appList || []).some(function (a) { return a && a.cat === "lab"; })) installedL.push(man);
    }
    var nApps = labApps().length;
    if (!installedL.length && !lPacks.length) { bar.hidden = true; return; }
    bar.hidden = false;
    var prog = $("veilLabProg");
    if (prog) { prog.hidden = true; if (prog.firstElementChild) prog.firstElementChild.style.width = "0"; }
    var chips = $("veilLabChips");
    chips.innerHTML = "";
    lPacks.forEach(function (p) {
        var ins = EXT_INSTALLED[p.id];
        var c = el("span", "vx-chip" + (ins ? " on" : ""));
        c.innerHTML = iconSVG("package", "luc-14") + esc(p.name) +
            '<b class="vx-n">' + (p.apps || 0) + " apps</b>";
        c.title = p.name + " — " + (p.apps || 0) + " experiments · " + extMB(p.bytes) + (ins ? " · installed" : " · available");
        if (ins) {
            var x = el("span", "vx-x");
            x.title = "remove " + p.name;
            x.setAttribute("role", "button");
            x.setAttribute("aria-label", "remove " + p.name);
            x.innerHTML = iconSVG("x", "luc-14");
            x.addEventListener("click", function (ev) { ev.stopPropagation(); extRemove(p.id); });
            c.appendChild(x);
        }
        chips.appendChild(c);
        if (!ins) {
            var a = el("a", "vx-dl");
            a.href = VEIL_ORIGIN ? VEIL_ORIGIN + "/api/offline?ext=" + encodeURIComponent(p.id) : "#";
            if (VEIL_ORIGIN) {
                a.title = "download " + p.name + " (" + extMB(p.bytes) + ") — password required";
                (function (u, nm) {
                    a.addEventListener("click", function (ev) { ev.preventDefault(); veilDlGo(u, nm); });
                })(a.href, p.name);
            }
            a.setAttribute("aria-label", "download " + p.name);
            a.innerHTML = iconSVG("dl", "luc-14");
            chips.appendChild(a);
        }
    });
    installedL.forEach(function (man) {
        if (lPacks.some(function (p) { return p.id === man.id; })) return;
        var n = (man.appList || []).filter(function (a) { return a && a.cat === "lab"; }).length;
        var c = el("span", "vx-chip on");
        c.innerHTML = iconSVG("package", "luc-14") + esc(man.name || man.id) +
            '<b class="vx-n">' + n + " apps</b>";
        var x = el("span", "vx-x");
        x.title = "remove " + (man.name || man.id);
        x.setAttribute("role", "button");
        x.setAttribute("aria-label", "remove " + (man.name || man.id));
        x.innerHTML = iconSVG("x", "luc-14");
        x.addEventListener("click", function (ev) { ev.stopPropagation(); extRemove(man.id); });
        c.appendChild(x);
        chips.appendChild(c);
    });
    var line = $("veilLabLine");
    if (line) line.textContent = nApps ? "veil lab · " + nApps + " experiment" + (nApps === 1 ? "" : "s") + " on this file" : "the lab packet";
}

/* ═══ 19. VEIL STREAM — YouTube through the veil, offline edition ═══
   Mirrors the site's Stream section on the same architecture: ALL
   metadata + every media byte flows through the birth origin's
   /api/yt/* routes (CORS-open), which re-serve YouTube data through
   its own proxy chain. The browser in this file never contacts
   YouTube — from the network's view it's plain traffic to the veil
   origin. Needs the origin online; without one (unstamped copy) or
   offline, the section is honest about it. Adaptive (HLS) answers
   play through the embedded hls.js; progressive files play natively. */
var stCards = {};        /* id → card (instant watch metadata) */
var stFeedLoaded = false;
var stSearchQ = null;
var stPage = "foryou";
var stWatchId = null;
var stGateRounds = 0;
var stGateTimer = null;
var stGateTick = null;
var stHlsLoading = null;
var stLoadTimer = null;  /* the "Opening the stream… Ns" overlay clock */

function stAbs(u) {
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    return VEIL_ORIGIN ? VEIL_ORIGIN + u : u;
}
function stNote(msg, on) {
    var n = $("veilStNote");
    if (!n) return;
    n.hidden = !on;
    n.textContent = msg || "";
}
function stFetch(path, retryLeft) {
    /* one quiet retry — cold routes 502 through the gateway while the
       dev origin compiles them (see chatApi) */
    return fetch(VEIL_ORIGIN + path, { cache: "no-store" }).then(function (r) {
        if ((r.status === 502 || r.status === 503 || r.status === 504) && !retryLeft) {
            return new Promise(function (res) { setTimeout(res, 900); }).then(function () {
                return stFetch(path, 1);
            });
        }
        return r.json().then(function (body) {
            if (!r.ok && body && !body.gated) throw new Error(body.error || ("HTTP " + r.status));
            return body;
        });
    });
}
function stFmtDur(s) {
    s = Math.max(0, Math.floor(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x;
}
function stFmtViews(n) {
    if (!n) return "";
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B views";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M views";
    if (n >= 1e3) return (n / 1e3).toFixed(0) + "K views";
    return n + " views";
}
/* ── per-device follows + lists (the same localStorage keys the site's
   Stream uses — a stamped file is its own device with its own store) ── */
var ST_SUBS_KEY = "veil.stream.subs.v1";
var ST_PL_KEY = "veil.stream.playlists.v1";
var ST_FEED_CACHE_KEY = "veil:st-feed-cache:v1";
function stReadSubs() {
    try { var m = JSON.parse(LS.get(ST_SUBS_KEY) || "null"); return (m && typeof m === "object" && !Array.isArray(m)) ? m : {}; } catch (e) { return {}; }
}
function stWriteSubs(m) { try { LS.set(ST_SUBS_KEY, JSON.stringify(m)); } catch (e) {} }
function stSubscribed(id) { return !!(id && stReadSubs()[id]); }
function stToggleSub(id, name, avatar) {
    if (!id) return false;
    var m = stReadSubs();
    if (m[id]) delete m[id];
    else m[id] = { name: name || id, avatar: avatar || null, at: Date.now() };
    stWriteSubs(m);
    return !!m[id];
}
function stReadPls() {
    try {
        var a = JSON.parse(LS.get(ST_PL_KEY) || "null");
        return Array.isArray(a) ? a.filter(function (p) { return p && p.id && Array.isArray(p.items); }) : [];
    } catch (e) { return []; }
}
function stWritePls(a) { try { LS.set(ST_PL_KEY, JSON.stringify(a)); } catch (e) {} }
function stWatchLaterOf() {
    var a = stReadPls(), pl = null;
    for (var i = 0; i < a.length; i++) if (a[i].id === "watchlater") { pl = a[i]; break; }
    if (!pl) {
        pl = { id: "watchlater", name: "Watch Later", at: 0, items: [] };
        a.unshift(pl);
        stWritePls(a); /* persist immediately — every caller reads a fresh copy */
    }
    return pl;
}
function stToggleWatchLater(card) {
    if (!card || !card.id) return false;
    stWatchLaterOf(); /* make sure Watch Later exists on disk first */
    var a = stReadPls(), pl = null, have = -1;
    for (var i = 0; i < a.length; i++) if (a[i].id === "watchlater") { pl = a[i]; break; }
    if (!pl) return false;
    for (var j = 0; j < pl.items.length; j++) if (pl.items[j] && pl.items[j].id === card.id) { have = j; break; }
    if (have >= 0) pl.items.splice(have, 1);
    else pl.items.unshift({ id: card.id, title: card.title || "", thumb: card.thumb || "", author: card.author || "", authorId: card.authorId || "", durationSec: card.durationSec || 0, views: card.views || 0 });
    pl.at = Date.now();
    stWritePls(a);
    return have < 0;
}
function stSavedInWL(id) {
    var pl = stWatchLaterOf();
    for (var i = 0; i < pl.items.length; i++) if (pl.items[i] && pl.items[i].id === id) return true;
    return false;
}
/* syncs the watch view's follow / watch-later buttons to the current card */
function stSyncCardActions() {
    var c = stCards[stWatchId] || {};
    var sub = $("veilStSubBtn"), save = $("veilStSaveBtn");
    if (sub) {
        if (c.authorId) {
            sub.hidden = false;
            var on = stSubscribed(c.authorId);
            sub.classList.toggle("on", on);
            var sp = sub.querySelector("span");
            if (sp) sp.textContent = on ? "Subscribed" : "Subscribe";
        } else sub.hidden = true;
    }
    if (save) {
        if (stWatchId) {
            save.hidden = false;
            save.classList.toggle("on", stSavedInWL(stWatchId));
        } else save.hidden = true;
    }
}
/* last good feed paint, cached — warm boots render instantly while the
   fresh feed fetch races in behind it */
function stFeedCacheGet() {
    try {
        var c = JSON.parse(LS.get(ST_FEED_CACHE_KEY) || "null");
        return (c && Array.isArray(c.cards) && c.cards.length) ? c : null;
    } catch (e) { return null; }
}
function stFeedCacheSet(cards) {
    try { LS.set(ST_FEED_CACHE_KEY, JSON.stringify({ at: Date.now(), cards: (cards || []).slice(0, 48) })); } catch (e) {}
}
function streamSectionOpen() {
    if (!VEIL_ORIGIN) {
        var g = $("veilStGrid");
        g.innerHTML = "";
        var box = el("div", "veil-st-empty");
        box.innerHTML = iconSVG("monitor", "") +
            "<b>Stream needs its origin</b>" +
            "<div>This copy has no birth origin stamped — download it fresh from the veil site (the <b>offline</b> pill) and Veil Stream rides along, searching and streaming YouTube straight through the origin's proxy.</div>";
        g.appendChild(box);
        $("veilStRowHd").hidden = true;
        stNote("", false);
        return;
    }
    if (!stFeedLoaded) stLoadFeed("foryou");
}
function stSkeletons(n) {
    var g = $("veilStGrid");
    g.innerHTML = "";
    for (var i = 0; i < (n || 8); i++) {
        var c = el("div", "veil-st-card");
        c.innerHTML = '<span class="veil-st-load"></span>';
        g.appendChild(c);
    }
}
function stLoadFeed(kind) {
    /* the browse pages: for you (personalized by what this file has
       watched), shorts, popular, and this file's own history rail. */
    kind = kind || "foryou";
    stPage = kind;
    stSearchQ = null;
    document.querySelectorAll("#veilStRail [data-stpage]").forEach(function (b) {
        b.setAttribute("aria-pressed", b.getAttribute("data-stpage") === kind ? "true" : "false");
    });
    if (kind === "history") { stRenderHistory(); return; }
    if (kind === "playlists") { stRenderPlaylists(); return; }
    var titles = { foryou: "For you", shorts: "Shorts", popular: "Popular right now", subs: "Subscriptions" };
    var rowIcons = { foryou: "spark", shorts: "zap", popular: "flame", history: "history", subs: "radio" };
    stRowTone(kind);
    $("veilStRowHd").hidden = false;
    $("veilStRowTitle").textContent = titles[kind] || "For you";
    $("veilStRowCount").textContent = "";
    $("veilStClear").hidden = true;
    stNote("", false);
    if (kind === "subs") {
        /* the channels this file follows — newest uploads from each */
        var ids = Object.keys(stReadSubs());
        if (!ids.length) {
            stFeedLoaded = true;
            stRenderCards([]);
            var se = el("div", "veil-st-empty");
            se.innerHTML = iconSVG("radio", "") +
                "<b>You're not following any channels yet</b>" +
                "<div>Open a video or channel and hit <b>Subscribe</b> — this page fills with the newest uploads from everyone you follow, kept on this device.</div>";
            $("veilStGrid").innerHTML = "";
            $("veilStGrid").appendChild(se);
            return;
        }
        stSkeletons(8);
        stFetch("/api/yt/feed?kind=subs&ids=" + encodeURIComponent(ids.join(","))).then(function (body) {
            stFeedLoaded = true;
            if (body && body.gated) { stRenderCards([]); stNote(body.message || "YouTube is rate-limiting the subscriptions feed right now", true); return; }
            var cards = Array.isArray(body) ? body : [];
            stRenderCards(cards, { newIds: stHistoryIds() });
            stRowCount(cards.length);
        }).catch(function (e) {
            stFeedLoaded = true;
            stRenderCards([]);
            stNote((e && e.message) || "the subscriptions feed didn't load", true);
        });
        return;
    }
    var cached = kind === "foryou" ? stFeedCacheGet() : null;
    if (cached) {
        /* warm boot: paint the last good For you instantly, then the
           fresh fetch below re-renders over it when it lands */
        stRenderCards(cached.cards);
        stRowCount(cached.cards.length);
    } else {
        stSkeletons(8);
    }
    if (kind === "shorts") {
        /* the shorts page — a wrapped grid of vertical cards, like the
           site's channel shorts shelf */
        var sqs = "/api/yt/feed?kind=shorts";
        var sch = stWatchedChannels(6);
        if (sch.length) sqs += "&chans=" + encodeURIComponent(sch.join(","));
        stFetch(sqs).then(function (body) {
            stFeedLoaded = true;
            if (body && body.gated) { stRenderCards([]); stNote(body.message || "YouTube is rate-limiting shorts right now", true); return; }
            stRenderShorts(Array.isArray(body) ? body : []);
            stRowCount(Array.isArray(body) ? body.length : 0, "shorts");
        }).catch(function (e) {
            stFeedLoaded = true;
            stRenderCards([]);
            stNote((e && e.message) || "the shorts didn't load", true);
        });
        return;
    }
    var qs = "/api/yt/feed?kind=" + (kind === "foryou" ? "foryou" : kind);
    if (kind === "foryou") {
        var chans = stWatchedChannels(8);
        if (chans.length) qs += "&chans=" + encodeURIComponent(chans.join(","));
    }
    stFetch(qs).then(function (body) {
        stFeedLoaded = true;
        if (body && body.gated) {
            $("veilStGrid").innerHTML = "";
            var box = el("div", "veil-st-empty");
            box.innerHTML = iconSVG("shield", "") +
                "<b>YouTube is rate-limiting the feed right now</b>" +
                "<div>" + esc(body.message || "") + "</div>";
            $("veilStGrid").appendChild(box);
            return;
        }
        var fresh = Array.isArray(body) ? body : [];
        stRenderCards(fresh, { newIds: kind === "foryou" ? stHistoryIds() : null });
        stRowCount(fresh.length);
        if (kind === "foryou") { stFeedCacheSet(fresh); stLoadShortsShelf(); }
    }).catch(function (e) {
        stFeedLoaded = true;
        $("veilStGrid").innerHTML = "";
        var box = el("div", "veil-st-empty");
        box.innerHTML = iconSVG("alert", "") +
            "<b>The feed didn't load</b>" +
            "<div>" + esc(e && e.message ? e.message : "the origin is unreachable") + " — retry in a moment.</div>";
        $("veilStGrid").appendChild(box);
    });
}

function stRowTone(kind) {
    var ic = $("veilStRowIc");
    if (!ic) return;
    var icons = { foryou: "spark", shorts: "zap", popular: "flame", history: "history", subs: "radio", playlists: "notes" };
    var tones = { foryou: "rose", shorts: "fuchsia", popular: "amber", history: "zinc", subs: "cyan", playlists: "violet" };
    ic.className = "rh-ic " + (tones[kind] || "rose");
    ic.innerHTML = iconSVG(icons[kind] || "spark", "");
}
function stRowCount(n, what) {
    var el = $("veilStRowCount");
    if (!el) return;
    el.textContent = n ? (n + " " + (what || (stPage === "shorts" ? "shorts" : "videos"))) : "";
}
/* the shorts shelf for the For you page — a fuchsia-tinted horizontal
   rail dropped between the card rows (grid-column 1/-1, position 8) */
var stShelfLoaded = false;
function stLoadShortsShelf() {
    if (stShelfLoaded) { stInsertShortsShelf(CHAT.stShorts || []); return; }
    var qs = "/api/yt/feed?kind=shorts";
    var sch = stWatchedChannels(6);
    if (sch.length) qs += "&chans=" + encodeURIComponent(sch.join(","));
    stFetch(qs).then(function (body) {
        if (!Array.isArray(body) || !body.length) return;
        var cards = body.filter(function (c) { return c && c.id && c.thumb; }).slice(0, 14);
        if (!cards.length) return;
        CHAT.stShorts = cards;
        stShelfLoaded = true;
        stInsertShortsShelf(cards);
    }).catch(function () { /* the shelf is dressing — feed stays fine */ });
}
function stInsertShortsShelf(cards) {
    var g = $("veilStGrid");
    if (!g || !cards || !cards.length) return;
    var old = g.querySelector(".veil-st-shelf");
    if (old) old.remove();
    var shelf = el("div", "veil-st-shelf");
    shelf.setAttribute("role", "group");
    shelf.setAttribute("aria-label", "Shorts shelf");
    cards.forEach(function (c) { if (c && c.id) stCards[c.id] = c; });
    var html = '<div class="hd">' +
        '<span class="ic">' + iconSVG("zap", "luc-14") + "</span>" +
        '<span class="t">Shorts</span><span class="ln"></span>' +
        '<span class="n">' + cards.length + " on the wire</span></div>" +
        '<div class="rail veil-slim">';
    cards.forEach(function (c) {
        html += '<button type="button" class="veil-st-shcard" aria-label="' + esc(c.title || "short") + '">' +
            '<span class="th"><img src="' + esc(stAbs(c.thumb)) + '" alt="" loading="lazy" />' +
            (c.durationSec ? '<span class="dur">' + esc(stFmtDur(c.durationSec)) + "</span>" : "") + "</span>" +
            '<span class="tx"><span class="tt">' + esc(c.title || "") + "</span>" +
            '<span class="by">' + esc(c.author || "") + "</span></span></button>";
    });
    html += "</div>";
    shelf.innerHTML = html;
    shelf.querySelectorAll(".veil-st-shcard").forEach(function (b, i) {
        (function (c) {
            b.addEventListener("click", function () { stWatch(c.id, c); });
        })(cards[i]);
    });
    /* drop it after the 8th card (the first grid row) like the site */
    var at = Math.min(8, g.children.length);
    g.insertBefore(shelf, g.children[at] || null);
}

/* the Shorts browse page — vertical cards in a tighter grid */
function stRenderShorts(cards) {
    var g = $("veilStGrid");
    g.innerHTML = "";
    g.classList.add("shorts");
    cards.forEach(function (c) { if (c && c.id) stCards[c.id] = c; });
    if (!cards.length) {
        g.classList.remove("shorts");
        var box = el("div", "veil-st-empty");
        box.innerHTML = iconSVG("zap", "") + "<b>No shorts came back</b><div>Try again in a moment — the wire reloads.</div>";
        g.appendChild(box);
        return;
    }
    var frag = document.createDocumentFragment();
    cards.forEach(function (c) {
        var b = el("button", "veil-st-shcard big");
        b.type = "button";
        b.setAttribute("aria-label", c.title || "short");
        b.innerHTML =
            '<span class="th"><img src="' + esc(stAbs(c.thumb || "")) + '" alt="" loading="lazy" />' +
            (c.durationSec ? '<span class="dur">' + esc(stFmtDur(c.durationSec)) + "</span>" : "") + "</span>" +
            '<span class="tx"><span class="tt">' + esc(c.title || "") + "</span>" +
            '<span class="by">' + esc(c.author || "") + "</span></span>";
        (function (cc) {
            b.addEventListener("click", function () { stWatch(cc.id, cc); });
        })(c);
        frag.appendChild(b);
    });
    g.appendChild(frag);
}

/* ── this file's watch history (localStorage, private to the device) ── */
var ST_HIST_KEY = "veil:st-history:v1";
function stHistory() {
    try { return JSON.parse(LS.get(ST_HIST_KEY) || "[]"); } catch (e) { return []; }
}
function stHistoryPush(c) {
    if (!c || !c.id) return;
    var h = stHistory().filter(function (x) { return x.id !== c.id; });
    h.unshift({
        id: c.id, title: c.title || "", author: c.author || "",
        authorId: c.authorId || "", thumb: c.thumb || "",
        durationSec: c.durationSec || 0, views: c.views || 0, at: Date.now()
    });
    try { LS.set(ST_HIST_KEY, JSON.stringify(h.slice(0, 60))); } catch (e) {}
}
function stWatchedChannels(n) {
    var counts = {};
    stHistory().forEach(function (x) { if (x.authorId) counts[x.authorId] = (counts[x.authorId] || 0) + 1; });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, n || 8);
}
/* ids this file already watched — the “new upload” dots compare against it */
function stHistoryIds() {
    var s = {};
    stHistory().forEach(function (x) { if (x && x.id) s[x.id] = 1; });
    return s;
}
function stRenderHistory() {
    stFeedLoaded = true;
    stRowTone("history");
    $("veilStRowHd").hidden = false;
    $("veilStRowTitle").textContent = "History — what this file watched";
    stRowCount(stHistory().length, "watched");
    $("veilStClear").hidden = true;
    stNote("", false);
    var h = stHistory();
    var g = $("veilStGrid");
    g.innerHTML = "";
    g.classList.remove("shorts");
    if (!h.length) {
        var box = el("div", "veil-st-empty");
        box.innerHTML = iconSVG("history", "") +
            "<b>Nothing watched here yet</b>" +
            "<div>Every video you open from this file lands in this page — kept on this device only, never sent anywhere.</div>";
        g.appendChild(box);
        return;
    }
    stRenderCards(h);
}
/* ── the playlists page — Watch Later first, covers like the site's ── */
var stPlView = null; /* when a list is open: its id */
function stRenderPlaylists() {
    stFeedLoaded = true;
    stPlView = null;
    stRowTone("playlists");
    $("veilStRowHd").hidden = false;
    $("veilStRowTitle").textContent = "Playlists";
    stRowCount(0, "");
    $("veilStClear").hidden = true;
    stNote("", false);
    var lists = stReadPls();
    if (!lists.some(function (p) { return p.id === "watchlater"; })) {
        lists = stWatchLaterOf(); /* ensure + persist Watch Later at the head */
        stWritePls(lists);
    }
    var g = $("veilStGrid");
    g.innerHTML = "";
    g.classList.remove("shorts");
    var frag = document.createDocumentFragment();
    lists.forEach(function (pl) {
        var cover = (pl.items && pl.items[0]) || null;
        var b = el("button", "veil-st-pl");
        b.type = "button";
        b.setAttribute("aria-label", "Open playlist " + (pl.name || "list") + " — " + (pl.items ? pl.items.length : 0) + " videos");
        b.innerHTML = '<span class="th">' + (cover && cover.thumb ? '<img src="' + esc(stAbs(cover.thumb)) + '" alt="" loading="lazy" />' : '<i class="ph">' + iconSVG("notes", "") + '</i>') +
            '<span class="n">' + (pl.items ? pl.items.length : 0) + '</span></span>' +
            '<span class="nm">' + esc(pl.name || "List") + '</span>';
        b.addEventListener("click", function () { stPlOpen(pl.id); });
        frag.appendChild(b);
    });
    g.appendChild(frag);
    if (lists.length === 1 && lists[0].items.length === 0) {
        var box = el("div", "veil-st-empty");
        box.innerHTML = iconSVG("notes", "") +
            "<b>Watch Later is empty</b>" +
            "<div>While watching a video, hit <b>Watch Later</b> — it's saved to this device. Open it here any time, no account, no server.</div>";
        g.appendChild(box);
    }
}
function stPlOpen(id) {
    var pl = null;
    stReadPls().forEach(function (p) { if (p.id === id) pl = p; });
    if (!pl) { stRenderPlaylists(); return; }
    stPlView = id;
    stRowTone("playlists");
    $("veilStRowHd").hidden = false;
    $("veilStRowTitle").textContent = pl.name || "List";
    stRowCount(pl.items.length);
    $("veilStClear").hidden = true;
    stNote("", false);
    stRenderCards(pl.items.slice());
}
function stCardEl(c) {
    var b = el("button", "veil-st-card");
    b.type = "button";
    b.setAttribute("aria-label", (c.title || "video") + (c.live ? " (live)" : ""));
    var th = '<span class="th">' + (c.thumb ? '<img src="' + esc(stAbs(c.thumb)) + '" alt="" loading="lazy" />' : "") +
        (c.live ? '<span class="live">LIVE</span>' : "") +
        (!c.live && c.durationSec ? '<span class="dur">' + esc(stFmtDur(c.durationSec)) + "</span>" : "") + "</span>";
    b.innerHTML = th +
        '<span class="tt">' + esc(c.title || "") + "</span>" +
        '<span class="by">' + esc(c.author || "") + (c.verified ? ' <span class="v">✓</span>' : "") +
        (c.views ? ' <span class="v">· ' + esc(stFmtViews(c.views)) + "</span>" : "") + "</span>";
    b.addEventListener("click", function () { stWatch(c.id, c); });
    return b;
}
function stRenderCards(cards, opts) {
    var g = $("veilStGrid");
    g.innerHTML = "";
    g.classList.remove("shorts");
    cards.forEach(function (c) { if (c && c.id) stCards[c.id] = c; });
    if (!cards.length) {
        var box = el("div", "veil-st-empty");
        box.innerHTML = iconSVG("search", "") + "<b>Nothing here</b><div>No videos in this answer — try a search.</div>";
        g.appendChild(box);
        return;
    }
    var newIds = (opts && opts.newIds) || null;
    cards.forEach(function (c) {
        var node = stCardEl(c);
        if (newIds && c.id && !newIds[c.id]) {
            var dot = el("span", "veil-st-newdot");
            dot.title = "new upload — not watched yet";
            dot.setAttribute("role", "img");
            dot.setAttribute("aria-label", "new upload");
            node.appendChild(dot);
        }
        g.appendChild(node);
    });
}
$("veilStForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var q = $("veilStInput").value.trim();
    if (!q) return;
    stSearchQ = q;
    $("veilStRowHd").hidden = false;
    $("veilStRowTitle").textContent = 'Results — "' + q + '"';
    $("veilStClear").hidden = false;
    stNote("", false);
    stSkeletons(8);
    stFetch("/api/yt/search?q=" + encodeURIComponent(q)).then(function (body) {
        if (body && body.gated) {
            stRenderCards([]);
            stNote(body.message || "YouTube is rate-limiting search right now", true);
            return;
        }
        stRenderCards(Array.isArray(body) ? body : []);
    }).catch(function (err) {
        stRenderCards([]);
        stNote((err && err.message) || "the search didn't complete", true);
    });
});
$("veilStClear").addEventListener("click", function () {
    $("veilStInput").value = "";
    stLoadFeed(stPage);
});
/* the pages rail — For you / Shorts / Popular / History */
document.querySelectorAll("#veilStRail [data-stpage]").forEach(function (b) {
    b.addEventListener("click", function () { stLoadFeed(b.getAttribute("data-stpage")); });
});
$("veilStReload").addEventListener("click", function () {
    if (stSearchQ) { $("veilStForm").requestSubmit(); return; }
    stShelfLoaded = false;
    stLoadFeed(stPage);
});
$("veilStBack").addEventListener("click", function () { stCloseWatch(); });
$("veilStRetry").addEventListener("click", function () { if (stWatchId) { stGateRounds = 0; stLoadVideo(stWatchId); } });
/* follow + save (per-device, same keys the site's Stream uses) */
$("veilStSubBtn").addEventListener("click", function () {
    var c = stCards[stWatchId] || {};
    if (!c.authorId) return;
    var on = stToggleSub(c.authorId, c.author, c.authorAvatar || null);
    stSyncCardActions();
    toast(on ? "Subscribed to " + (c.author || "the channel") + " — its uploads land in Subscriptions." : "Unsubscribed from " + (c.author || "the channel") + ".");
});
$("veilStSaveBtn").addEventListener("click", function () {
    var c = stCards[stWatchId] || {};
    if (!stWatchId) return;
    var added = stToggleWatchLater(c);
    stSyncCardActions();
    toast(added ? "Saved to Watch Later." : "Removed from Watch Later.");
});
$("veilStChSubBtn").addEventListener("click", function () {
    if (!stCh || !stCh.id) return;
    var on = stToggleSub(stCh.id, stCh.name, null);
    this.classList.toggle("on", on);
    var sp = this.querySelector("span");
    if (sp) sp.textContent = on ? "Subscribed" : "Subscribe";
    toast(on ? "Subscribed to " + (stCh.name || "the channel") + "." : "Unsubscribed from " + (stCh.name || "the channel") + ".");
});

function stLoading(on) {
    var l = $("veilStLoading");
    if (!l) return;
    l.hidden = !on;
    if (stLoadTimer) { clearInterval(stLoadTimer); stLoadTimer = null; }
    if (on) {
        var secs = 0;
        $("veilStLoadSecs").textContent = "0";
        stLoadTimer = setInterval(function () {
            secs++;
            var n = $("veilStLoadSecs");
            if (n) n.textContent = String(secs);
        }, 1000);
    }
}
/* the "or try another video" rail — cards this file has already seen
   (trending/search) minus the current one; on a gate this is the
   fastest path to something playable. */
function stRenderAlt(id) {
    var alt = $("veilStAlt"), hd = $("veilStAltHd");
    if (!alt || !hd) return;
    alt.innerHTML = "";
    var seen = 0;
    for (var cid in stCards) {
        if (cid === id || seen >= 10) continue;
        var c = stCards[cid];
        if (!c || !c.id || !c.title) continue;
        seen++;
        var b = el("button", "veil-st-rel");
        b.type = "button";
        b.setAttribute("aria-label", c.title || "video");
        b.innerHTML =
            '<span class="th">' + (c.thumb ? '<img src="' + esc(stAbs(c.thumb)) + '" alt="" loading="lazy" />' : "") +
            (c.durationSec ? '<span class="dur">' + esc(stFmtDur(c.durationSec)) + "</span>" : "") + "</span>" +
            '<span class="tx"><span class="tt">' + esc(c.title) + "</span>" +
            '<span class="by">' + esc(c.author || "") + "</span></span>";
        (function (cc) {
            b.addEventListener("click", function () { stWatch(cc.id, cc); });
        })(c);
        alt.appendChild(b);
    }
    hd.hidden = alt.children.length === 0;
}
function stCloseWatch() {
    stWatchId = null;
    if (stGateTimer) { clearTimeout(stGateTimer); stGateTimer = null; }
    if (stGateTick) { clearInterval(stGateTick); stGateTick = null; }
    stLoading(false);
    stCmtsReset();
    var v = $("veilStVid");
    try { v.pause(); } catch (e) {}
    v.removeAttribute("src");
    try { v.load(); } catch (e) {}
    var shell = document.querySelector("#veilStPlayer");
    if (shell && shell.__veilHls) { try { shell.__veilHls.destroy(); } catch (e) {} shell.__veilHls = null; }
    $("veilStWatch").hidden = true;
    if (stCh) { $("veilStChannel").hidden = false; }
    else { $("veilStBrowse").hidden = false; }
}
function stWatch(id, card) {
    if (card) stCards[id] = card;
    stWatchId = id;
    stGateRounds = 0;
    if (stGateTimer) { clearTimeout(stGateTimer); stGateTimer = null; }
    stHistoryPush(stCards[id] || card || { id: id });
    $("veilStBrowse").hidden = true;
    $("veilStChannel").hidden = true;
    $("veilStWatch").hidden = false;
    var c = stCards[id] || {};
    $("veilStTitle").textContent = c.title || "Loading…";
    stRenderByLine(c);
    $("veilStDesc").textContent = "";
    $("veilStRelated").innerHTML = "";
    $("veilStRelHd").hidden = true;
    $("veilStAlt").innerHTML = "";
    $("veilStAltHd").hidden = true;
    $("veilStGate").hidden = true;
    $("veilStNoVideo").hidden = true;
    var v = $("veilStVid");
    v.removeAttribute("poster");
    v.removeAttribute("src");
    if (c.thumb) { try { v.setAttribute("poster", stAbs(c.thumb)); } catch (e) {} }
    stCmtsLoad(id);
    stLoadVideo(id);
}
/* the watch view's by-line — the author is a channel button when the
   id is known (cards + related rail capture it) */
function stRenderByLine(c) {
    var by = $("veilStBy");
    var extra = (c.views ? " · " + stFmtViews(c.views) : "") + (c.published ? " · " + esc(c.published) : "");
    by.innerHTML = "";
    if (c.authorId) {
        var b = el("button", "st-by-btn");
        b.type = "button";
        b.setAttribute("aria-label", "Open channel: " + (c.author || "channel"));
        b.innerHTML = iconSVG("users", "") + "<span>" + esc(c.author || "") + (c.verified ? " ✓" : "") + "</span>";
        b.addEventListener("click", function () { stOpenChannel(c.authorId, c.author); });
        by.appendChild(b);
        var s = el("span", "st-by-x");
        s.textContent = extra;
        by.appendChild(s);
    } else {
        by.textContent = (c.author || "") + (c.verified ? " ✓" : "") + extra;
    }
    stSyncCardActions();
}
function stLoadVideo(id) {
    $("veilStGate").hidden = true;
    $("veilStNoVideo").hidden = true;
    stLoading(true);
    /* quick=1 — the site's lane: bounded wait, the full extraction keeps
       running in the background and the retry lands on the parked body */
    stFetch("/api/yt/video/" + encodeURIComponent(id) + "?quick=1").then(function (body) {
        if (!stWatchId || stWatchId !== id) return; /* user moved on */
        stLoading(false);
        if (body && body.gated) {
            /* "still warming up" → the background load is racing; retry
               softly (site pattern) instead of throwing a gate panel */
            if (/warming/i.test(body.message || "") && stGateRounds < 8) {
                stGateRounds++;
                stLoading(true);
                setTimeout(function () {
                    if (stWatchId === id) stLoadVideo(id);
                }, 2600);
                return;
            }
            stShowGate(id, body.message || "YouTube is rate-limiting this video's stream right now.");
            return;
        }
        stGateRounds = 0;
        if (stGateTimer) { clearTimeout(stGateTimer); stGateTimer = null; }
        if (stGateTick) { clearInterval(stGateTick); stGateTick = null; }
        $("veilStAlt").innerHTML = "";
        $("veilStAltHd").hidden = true;
        var card = body.card || stCards[id] || {};
        $("veilStTitle").textContent = card.title || "";
        stRenderByLine(card);
        var desc = String(body.description || "").trim();
        $("veilStDesc").textContent = desc.length ? desc.slice(0, 1400) : "";
        /* related rail */
        var rel = $("veilStRelated");
        rel.innerHTML = "";
        (body.related || []).slice(0, 14).forEach(function (r) {
            if (!r || !r.id || r.id === id) return;
            stCards[r.id] = r;
            var b = el("button", "veil-st-rel");
            b.type = "button";
            b.setAttribute("aria-label", r.title || "related video");
            b.innerHTML =
                '<span class="th">' + (r.thumb ? '<img src="' + esc(stAbs(r.thumb)) + '" alt="" loading="lazy" />' : "") +
                (r.durationSec ? '<span class="dur">' + esc(stFmtDur(r.durationSec)) + "</span>" : "") + "</span>" +
                '<span class="tx"><span class="tt">' + esc(r.title || "") + "</span>" +
                '<span class="by">' + esc(r.author || "") + "</span></span>";
            b.addEventListener("click", function () { stWatch(r.id, r); });
            rel.appendChild(b);
        });
        $("veilStRelHd").hidden = rel.children.length === 0;
        /* formats: prefer HLS (adaptive) → first progressive */
        var fmts = body.formats || [];
        if (!fmts.length) {
            $("veilStNoVideo").hidden = false;
            return;
        }
        var hls = null, i;
        for (i = 0; i < fmts.length; i++) if (fmts[i].kind === "hls") { hls = fmts[i]; break; }
        var pick = hls || fmts[0];
        var v = $("veilStVid");
        var shell = $("veilStPlayer");
        if (shell && shell.__veilHls) { try { shell.__veilHls.destroy(); } catch (e) {} shell.__veilHls = null; }
        if (card.thumb) { try { v.setAttribute("poster", stAbs(card.thumb)); } catch (e) {} }
        if (pick.kind === "hls") {
            stEnsureHls().then(function (Hls) {
                if (!stWatchId || stWatchId !== id) return;
                if (Hls && Hls.isSupported()) {
                    var h = new Hls({ enableWorker: true });
                    shell.__veilHls = h;
                    h.loadSource(stAbs(pick.url));
                    h.attachMedia(v);
                    h.on(Hls.Events.ERROR, function (_ev, data) {
                        if (data && data.fatal) {
                            /* one network recovery round, then the honest panel */
                            try { h.startLoad(); } catch (e) {}
                        }
                    });
                } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
                    v.src = stAbs(pick.url); /* Safari native HLS */
                } else {
                    var pf = null;
                    for (var j = 0; j < fmts.length; j++) if (fmts[j].kind === "progressive") { pf = fmts[j]; break; }
                    if (pf) v.src = stAbs(pf.url);
                    else $("veilStNoVideo").hidden = false;
                }
            });
        } else {
            v.src = stAbs(pick.url);
        }
        v.play().catch(function () { /* autoplay guard — controls are there */ });
    }).catch(function (e) {
        if (!stWatchId || stWatchId !== id) return;
        stLoading(false);
        stShowGate(id, (e && e.message) || "the stream source didn't answer — try again in a moment");
    });
}
function stShowGate(id, msg) {
    $("veilStGate").hidden = false;
    $("veilStGateMsg").textContent = msg;
    stRenderAlt(id);
    if (stGateTick) { clearInterval(stGateTick); stGateTick = null; }
    var waitMs = stGateRounds < 8 ? 15000 : 60000;
    var left = Math.ceil(waitMs / 1000);
    var upd = function () {
        left--;
        if (left <= 0) { clearInterval(stGateTick); stGateTick = null; return; }
        var n = $("veilStGateNext");
        if (n) n.textContent = "auto-retrying in " + left + "s";
    };
    $("veilStGateNext").textContent = "auto-retrying in " + left + "s";
    stGateTick = setInterval(upd, 1000);
    if (stGateTimer) clearTimeout(stGateTimer);
    stGateTimer = setTimeout(function () {
        stGateTimer = null;
        if (stWatchId === id) {
            stGateRounds++;
            stLoadVideo(id);
        }
    }, waitMs);
}
/* ═══ channel view — Videos / Shorts / Live / Posts, all through the
   birth origin's /api/yt/channel routes. Videos + Shorts arrive with the
   channel answer; Live + Posts lazy-load their first page on first visit
   (?more=streams|posts with no continuation) and page via continuations. */
var stCh = null; /* { id, name, tab, next:{videos,shorts,live,posts}, loaded:{...} } */
var stChCards = {}; /* channel id → name (for back-navigation labels) */

function stChNote(msg, on) {
    var n = $("veilStChNote");
    if (!n) return;
    n.hidden = !on;
    n.textContent = msg || "";
}
function stFmtSubs(n) {
    if (!n) return "";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M subscribers";
    if (n >= 1e3) return (n / 1e3).toFixed(0) + "K subscribers";
    return n + " subscribers";
}
function stChReset() {
    stCh = null;
    stChNote("", false);
    $("veilStChGrid").innerHTML = "";
    var p = $("veilStChPosts");
    if (p) { p.innerHTML = ""; p.hidden = true; }
    $("veilStChMoreWrap").hidden = true;
    document.querySelectorAll("#veilStChTabs .veil-st-ch-tab").forEach(function (b) {
        b.classList.toggle("is-on", b.getAttribute("data-chtab") === "videos");
    });
}
function stOpenChannel(id, name) {
    if (!VEIL_ORIGIN || !id) return;
    stCloseWatch(true);
    stChReset();
    if (name) stChCards[id] = name;
    stCh = {
        id: id,
        name: stChCards[id] || name || "",
        tab: "videos",
        next: { videos: null, shorts: null, live: null, posts: null },
        loaded: { videos: false, shorts: false, live: false, posts: false },
    };
    $("veilStBrowse").hidden = true;
    $("veilStChannel").hidden = false;
    $("veilStChName").textContent = stCh.name || "Loading…";
    $("veilStChSubs").textContent = "";
    var chsub = $("veilStChSubBtn");
    if (chsub) {
        chsub.hidden = false;
        var onNow = stSubscribed(id);
        chsub.classList.toggle("on", onNow);
        var csp = chsub.querySelector("span");
        if (csp) csp.textContent = onNow ? "Subscribed" : "Subscribe";
    }
    var chav = $("veilStChAvatar");
    if (chav) { chav.removeAttribute("src"); chav.hidden = true; }
    var chtx = $("veilStChAvatarTxt");
    if (chtx) { chtx.textContent = ""; chtx.hidden = true; }
    $("veilStChDesc").textContent = "";
    $("veilStChDesc").hidden = true;
    stChSkeletons(8);
    stFetch("/api/yt/channel/" + encodeURIComponent(id)).then(function (body) {
        if (!stCh || stCh.id !== id) return;
        if (body && body.gated) {
            $("veilStChGrid").innerHTML = "";
            stChNote(body.message || "the channel didn't answer — try again in a moment", true);
            return;
        }
        stCh.name = body.name || stCh.name;
        stChCards[id] = stCh.name;
        $("veilStChName").textContent = stCh.name + (body.verified ? " ✓" : "");
        $("veilStChSubs").textContent = body.subs ? stFmtSubs(body.subs) : "";
        if (body.avatar) {
            var im = $("veilStChAvatar");
            im.src = stAbs(body.avatar);
            im.hidden = false;
            var tx = $("veilStChAvatarTxt");
            if (tx) tx.hidden = true;
        } else {
            var tx2 = $("veilStChAvatarTxt");
            if (tx2) { tx2.textContent = (stCh.name || "?").slice(0, 1).toUpperCase(); tx2.hidden = false; }
        }
        if (body.description) {
            $("veilStChDesc").textContent = body.description.slice(0, 600);
            $("veilStChDesc").hidden = false;
        }
        stCh.next.videos = body.videosNext || null;
        stCh.next.shorts = body.shortsNext || null;
        var vids = (body.videos || []).map(function (v) { v.short = false; return v; });
        var shorts = (body.shorts || []).map(function (v) { v.short = true; return v; });
        stCh.loaded.videos = true;
        stCh.loaded.shorts = true;
        stChCacheCards(shorts);
        if (stCh.tab === "videos") stChRenderCards(vids);
    }).catch(function (e) {
        if (!stCh || stCh.id !== id) return;
        $("veilStChGrid").innerHTML = "";
        stChNote((e && e.message) || "the channel didn't load — try again in a moment", true);
    });
}
function stChSkeletons(n) {
    var g = $("veilStChGrid");
    g.innerHTML = "";
    for (var i = 0; i < (n || 8); i++) {
        var c = el("div", "veil-st-card");
        c.innerHTML = '<span class="veil-st-load"></span>';
        g.appendChild(c);
    }
}
function stChCacheCards(cards) {
    (cards || []).forEach(function (c) { if (c && c.id) stCards[c.id] = c; });
}
function stChRenderCards(cards) {
    var g = $("veilStChGrid");
    var p = $("veilStChPosts");
    if (p) { p.innerHTML = ""; p.hidden = true; }
    g.innerHTML = "";
    stCh.seen = {};
    cards.forEach(function (c) { if (c && c.id) stCh.seen[c.id] = true; });
    stChCacheCards(cards);
    if (!cards.length) {
        var box = el("div", "veil-st-empty");
        box.innerHTML = iconSVG("search", "") + "<b>Nothing on this tab</b><div>No videos came back — try another tab.</div>";
        g.appendChild(box);
        $("veilStChMoreWrap").hidden = true;
        return;
    }
    cards.forEach(function (c) { g.appendChild(stCardEl(c)); });
    $("veilStChMoreWrap").hidden = !stCh.next[stCh.tab];
    var lbl = $("veilStChMore").querySelector("span");
    if (lbl) lbl.textContent = "Load more " + (stCh.tab === "live" ? "streams" : stCh.tab);
}
function stChPostEl(p) {
    var a = el("article", "veil-st-post");
    var head = '<div class="p-hd">' +
        (p.avatar ? '<img class="p-av" src="' + esc(stAbs(p.avatar)) + '" alt="" />' : '<span class="p-av p-dot">' + esc((p.author || "•").slice(0, 1).toUpperCase()) + "</span>") +
        '<div class="p-by"><b>' + esc(p.author || "") + "</b><span>" + esc(p.published || "community post") + "</span></div></div>";
    var body = p.text ? '<p class="p-tx">' + esc(p.text).replace(/\n/g, "<br>") + "</p>" : "";
    var imgs = "";
    if (p.images && p.images.length) {
        imgs = '<div class="p-imgs n' + Math.min(4, p.images.length) + '">' +
            p.images.slice(0, 4).map(function (u) { return '<img src="' + esc(stAbs(u)) + '" alt="" loading="lazy" />'; }).join("") + "</div>";
    }
    var poll = "";
    if (p.poll && p.poll.options && p.poll.options.length) {
        poll = '<div class="p-poll">' + (p.poll.question ? "<b>" + esc(p.poll.question) + "</b>" : "") +
            p.poll.options.map(function (o) {
                return '<div class="p-opt"><span class="bar" style="width:' + Math.min(100, Math.max(3, o.pct || 0)) + '%"></span>' +
                    '<span class="tx">' + esc(o.text || "") + "</span><span class='pct'>" + (o.pct || 0) + "%</span></div>";
            }).join("") + "</div>";
    }
    var foot = '<div class="p-ft"><span>' + iconSVG("heart", "") + (p.likes ? " " + stFmtCount(p.likes) : " —") + "</span>" +
        "<span>" + iconSVG("chat", "") + (p.comments ? " " + stFmtCount(p.comments) : " —") + "</span></div>";
    a.innerHTML = head + body + imgs + poll + foot;
    return a;
}
function stFmtCount(n) {
    if (!n) return "0";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
}
function stChRenderPosts(posts, append) {
    var g = $("veilStChGrid");
    var p = $("veilStChPosts");
    g.innerHTML = "";
    if (!append) p.innerHTML = "";
    if (!posts.length && !append) {
        var box = el("div", "veil-st-empty");
        box.style.gridColumn = "1 / -1";
        box.innerHTML = iconSVG("chat", "") + "<b>No posts</b><div>This channel hasn't posted anything yet.</div>";
        p.appendChild(box);
        p.hidden = false;
        $("veilStChMoreWrap").hidden = true;
        return;
    }
    posts.forEach(function (post) { p.appendChild(stChPostEl(post)); });
    p.hidden = false;
    $("veilStChMoreWrap").hidden = !stCh.next.posts;
}
function stChSetTab(tab) {
    if (!stCh) return;
    stCh.tab = tab;
    document.querySelectorAll("#veilStChTabs .veil-st-ch-tab").forEach(function (b) {
        b.classList.toggle("is-on", b.getAttribute("data-chtab") === tab);
    });
    stChNote("", false);
    if (tab === "videos" || tab === "shorts") {
        /* those shelves came with the channel answer — refetch to redraw
         * simply (the answer is cached upstream, this is cheap) */
        stChSkeletons(8);
        stFetch("/api/yt/channel/" + encodeURIComponent(stCh.id)).then(function (body) {
            if (!stCh || stCh.tab !== tab) return;
            if (body && !body.gated) {
                stCh.next.videos = body.videosNext || null;
                stCh.next.shorts = body.shortsNext || null;
                var cards = tab === "videos" ? (body.videos || []) : (body.shorts || []);
                stChRenderCards(cards);
            } else if (body && body.gated) {
                $("veilStChGrid").innerHTML = "";
                stChNote(body.message || "the shelf didn't answer", true);
            }
        }).catch(function (e) {
            $("veilStChGrid").innerHTML = "";
            stChNote((e && e.message) || "the shelf didn't load", true);
        });
        return;
    }
    /* live + posts — lazy first page, then continuations */
    stChLoadMore(true);
}
function stChLoadMore(first) {
    if (!stCh) return;
    var tab = stCh.tab;
    var token = stCh.next[tab] || null;
    if (!first && !token) return;
    if ((tab === "videos" || tab === "shorts") && !token) return;
    var more = tab === "live" ? "streams" : tab;
    var path = "/api/yt/channel/" + encodeURIComponent(stCh.id) + "?more=" + more +
        (token && !first ? "&continuation=" + encodeURIComponent(token) : "");
    if (first) {
        if (tab === "live") stChSkeletons(8);
        else { $("veilStChGrid").innerHTML = ""; var pp = $("veilStChPosts"); pp.innerHTML = ""; pp.hidden = true; $("veilStChMoreWrap").hidden = true; }
    }
    stFetch(path).then(function (body) {
        if (!stCh || stCh.tab !== tab) return;
        if (body && body.gated) {
            stChNote(body.message || "this tab didn't answer — try again in a moment", true);
            if (first) { $("veilStChGrid").innerHTML = ""; }
            return;
        }
        stCh.next[tab] = body.next || null;
        if (tab === "posts") {
            stChRenderPosts(body.posts || [], !first);
        } else {
            var fresh = (body.cards || []).map(function (v) { v.short = tab === "shorts"; return v; });
            if (first) stChRenderCards(fresh);
            else {
                var g = $("veilStChGrid");
                stCh.seen = stCh.seen || {};
                fresh.forEach(function (c) {
                    if (c && c.id && !stCh.seen[c.id]) {
                        stCh.seen[c.id] = true;
                        g.appendChild(stCardEl(c));
                    }
                });
                $("veilStChMoreWrap").hidden = !stCh.next[tab];
            }
        }
    }).catch(function (e) {
        if (!stCh || stCh.tab !== tab) return;
        stChNote((e && e.message) || "this tab didn't load", true);
    });
}
document.querySelectorAll("#veilStChTabs .veil-st-ch-tab").forEach(function (b) {
    b.addEventListener("click", function () { stChSetTab(b.getAttribute("data-chtab")); });
});
$("veilStChBack").addEventListener("click", function () {
    stChReset();
    $("veilStChannel").hidden = true;
    $("veilStBrowse").hidden = false;
    stLoadFeed();
});
$("veilStChMore").addEventListener("click", function () { stChLoadMore(false); });

/* ═══ watch-view comments — read-only through the origin's comments
   route; the count rides the header pill, the list opens on demand. */
var stCmts = null; /* { id, items, next, open, loaded } */
function stCmtsReset() {
    stCmts = null;
    $("veilStCmtsHd").hidden = true;
    $("veilStCmts").hidden = true;
    $("veilStCmts").innerHTML = "";
    $("veilStCmtsToggle").setAttribute("aria-expanded", "false");
}
function stCmtsEl(c) {
    var d = el("div", "veil-st-cmt");
    var av = c.avatar
        ? '<img class="c-av" src="' + esc(stAbs(c.avatar)) + '" alt="" loading="lazy" />'
        : '<span class="c-av c-dot">' + esc((c.author || "?").replace(/^@/, "").slice(0, 1).toUpperCase()) + "</span>";
    d.innerHTML = av +
        '<div class="c-bd"><p class="c-hd"><b>' + esc(c.author || "") + "</b>" +
        (c.verified ? ' <span class="v">✓</span>' : "") +
        (c.pinned ? ' <span class="pin">pinned</span>' : "") +
        (c.published ? ' <span class="c-when">' + esc(c.published) + "</span>" : "") + "</p>" +
        '<p class="c-tx">' + esc(c.content || "").replace(/\n/g, "<br>") + "</p>" +
        (c.likes ? '<p class="c-lk">' + iconSVG("heart", "") + " " + stFmtCount(c.likes) +
            (c.replies ? ' <span class="c-rp">· ' + c.replies + " replies</span>" : "") + "</p>" : c.replies ? '<p class="c-lk"><span class="c-rp">' + c.replies + " replies</span></p>" : "") +
        "</div>";
    return d;
}
function stCmtsRender() {
    var box = $("veilStCmts");
    box.innerHTML = "";
    if (stCmts.sort === "new" && stCmts.degraded) {
        var deg = el("p", "st-cmt-degraded");
        deg.textContent = "newest-first isn't available for this video right now — YouTube's default order shown";
        box.appendChild(deg);
    }
    (stCmts.items || []).forEach(function (c) { box.appendChild(stCmtsEl(c)); });
    if (stCmts.next) {
        var more = el("button", "veil-mu-clear st-cmt-more");
        more.type = "button";
        more.innerHTML = iconSVG("chevdown", "") + "<span>Load more comments</span>";
        more.addEventListener("click", function () {
            stFetch("/api/yt/comments/" + encodeURIComponent(stCmts.id) + "?continuation=" + encodeURIComponent(stCmts.next) + (stCmts.sort === "new" ? "&sort=new" : "")).then(function (body) {
                if (!stCmts) return;
                if (body && !body.gated) {
                    (body.comments || []).forEach(function (c) { box.insertBefore(stCmtsEl(c), more); });
                    stCmts.next = body.next || null;
                    if (!stCmts.next) more.remove();
                }
            }).catch(function () { /* a failed page keeps the list */ });
        });
        box.appendChild(more);
    } else if ((stCmts.items || []).length === 0) {
        var p = el("p", "st-cmt-empty");
        p.textContent = "no comments came back for this video";
        box.appendChild(p);
    }
}
function stCmtsLoad(id, sort) {
    stCmts = { id: id, items: [], next: null, open: false, loaded: false, sort: sort === "new" ? "new" : "top" };
    $("veilStCmtsHd").hidden = true;
    $("veilStCmts").hidden = true;
    $("veilStCmts").innerHTML = "";
    $("veilStCmtsTop").classList.toggle("on", stCmts.sort === "top");
    $("veilStCmtsNew").classList.toggle("on", stCmts.sort === "new");
    stFetch("/api/yt/comments/" + encodeURIComponent(id) + (stCmts.sort === "new" ? "?sort=new" : "")).then(function (body) {
        if (!stCmts || stCmts.id !== id) return;
        if (body && body.gated) return; /* stay hidden — gate answer */
        stCmts.loaded = true;
        stCmts.items = body.comments || [];
        stCmts.next = body.next || null;
        if (body.sortApplied === false) {
            stCmts.degraded = true;
        }
        $("veilStCmtsCount").textContent = body.count ? stFmtCount(body.count) + " on YouTube · read only" : "read-only";
        $("veilStCmtsHd").hidden = false;
        if (stCmts.open) stCmtsRender();
    }).catch(function () { /* comments are optional dressing */ });
}
$("veilStCmtsToggle").addEventListener("click", function () {
    if (!stCmts) return;
    stCmts.open = !stCmts.open;
    $("veilStCmtsToggle").setAttribute("aria-expanded", String(stCmts.open));
    $("veilStCmts").hidden = !stCmts.open;
    document.querySelector(".veil-st-cmts-chev").classList.toggle("is-open", stCmts.open);
    if (stCmts.open && stCmts.loaded) stCmtsRender();
});
$("veilStCmtsTop").addEventListener("click", function () {
    if (!stCmts || stCmts.sort === "top") return;
    stCmts.open = true;
    stCmtsLoad(stCmts.id, "top");
});
$("veilStCmtsNew").addEventListener("click", function () {
    if (!stCmts || stCmts.sort === "new") return;
    stCmts.open = true;
    stCmtsLoad(stCmts.id, "new");
});

/* hls.js rides inside this file as a veil-asset block ("hlsjs") —
   decoded to a Blob URL and evaluated on first adaptive playback. */
function stEnsureHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (stHlsLoading) return stHlsLoading;
    stHlsLoading = new Promise(function (resolve) {
        var node = document.getElementById("veilA:hlsjs");
        if (!node) return resolve(null);
        var url = assetBlob("hlsjs", "application/javascript");
        if (!url) return resolve(null);
        fetch(url).then(function (r) { return r.text(); }).then(function (t) {
            try { (0, eval)(t); } catch (e) { return resolve(null); }
            resolve(window.Hls || null);
        }).catch(function () { resolve(null); });
    });
    return stHlsLoading;
}

setTimeout(boot, 80);

/* ═══ 16. VEIL CHAT — the living room, through the birth origin ══
   The site's chat as a shell section: the same accounts (login /
   register → token), the same #general room, realtime over the
   socket.io client embedded by the build (polling fallback keeps
   it near-live even without the socket), and the GIF picker on
   the origin's giphy-backed /api/gif-search — infinite pages.
   Everything rides VEIL_ORIGIN (stamped at download); unstamped
   copies get the honest gate note. */
var CHAT = {
    account: null, token: "",
    socket: null, sockOk: false,
    booting: false,
    poll: null,             /* setInterval handle when the socket is down */
    msgs: [],               /* ordered, dedup by id */
    seen: {},
    mode: "login",
    gifQ: "trending", gifPage: 1, gifHasMore: false, gifLoading: false,
    opened: false, booted: false,
    lastTypingAt: 0,
    typing: {},            /* username → last-seen ms (4s window) */
    members: [],           /* full roster from /api/chat-members */
    online: {},            /* username → 1 (socket presence) */
    membersPoll: null
};

/* typing line above the composer */
function chatTypingRender() {
    var n = $("veilChatTyping");
    if (!n) return;
    var now = Date.now();
    var names = [];
    if (CHAT.typing) {
        for (var k in CHAT.typing) {
            if (now - CHAT.typing[k] < 4000) names.push(k);
            else delete CHAT.typing[k];
        }
    }
    if (!names.length) { n.hidden = true; n.textContent = ""; return; }
    n.hidden = false;
    n.textContent = names.length === 1
        ? names[0] + " is typing…"
        : names.slice(0, 2).join(" and ") + (names.length > 2 ? " + " + (names.length - 2) + " more" : "") + " are typing…";
}

/* the players panel — roster + live online dots */
function chatMembersLoad() {
    if (!CHAT.token || !VEIL_ORIGIN) return;
    chatApi("/api/chat-members?token=" + encodeURIComponent(CHAT.token)).then(function (d) {
        CHAT.members = (d && d.members) || [];
        CHAT.booting = false;
        chatMembersRender();
    }).catch(function () { /* roster is dressing */ });
}
function chatMembersRender() {
    var list = $("veilChatMembersList");
    if (!list) return;
    $("veilChatMembers").hidden = !CHAT.account;
    var mem = CHAT.members || [];
    if (CHAT.booting && !mem.length) {
        $("veilChatMembersCount").textContent = "…";
        list.innerHTML = '<div class="mb-empty">connecting…</div>';
        return;
    }
    $("veilChatMembersCount").textContent = String(mem.length);
    if (!mem.length) { list.innerHTML = '<div class="mb-empty">nobody yet</div>'; return; }
    /* the site's roster: online + offline buckets, role-colored names,
       @handles, tag badges and OWNER/MOD pills */
    var onl = [], off = [];
    mem.forEach(function (m) {
        ((CHAT.online && CHAT.online[m.username]) ? onl : off).push(m);
    });
    function row(m, on) {
        var name = (m.displayName && String(m.displayName).trim()) || m.username || "someone";
        var isOwner = chatIsOwner(m);
        var isMod = chatIsMod(m);
        var ncol = isOwner ? "#f59e0b" : (isMod ? "#34d399" : "#e4e4e7");
        var color = /^#[0-9a-f]{6}$/i.test(m.avatarColor || "") ? m.avatarColor : "#27272a";
        var av = m.avatarImage
            ? '<img src="' + chatEsc(veilRoute(m.avatarImage)) + '" alt="" />'
            : chatEsc(chatInitials(name));
        var tagb = m.tag
            ? '<span class="tagb"' + (/^#[0-9a-f]{3,8}$/i.test(m.tagColor || "") ? ' style="color:' + chatEsc(m.tagColor) + ";border-color:" + chatEsc(m.tagColor) + '55"' : "") + '>' + chatEsc(m.tag) + "</span>"
            : "";
        var pill = isOwner ? '<span class="ownertag">OWNER</span>' : (isMod ? '<span class="modtag">MOD</span>' : "");
        return '<div class="mb' + (on ? " on" : "") + (CHAT.account && m.id === CHAT.account.id ? " me" : "") + '" title="' + chatEsc(name) + (on ? " · online" : "") + '">' +
            '<span class="av" style="background:' + color + '">' + av +
            '<span class="dot"></span></span>' +
            '<span class="mtx"><span class="nm" style="color:' + ncol + '">' + chatEsc(name) + "</span>" + tagb +
            '<span class="un">@' + chatEsc(m.username || "") + "</span></span>" +
            pill + "</div>";
    }
    var html = "";
    if (onl.length) {
        html += '<p class="mb-hd on">Online — ' + onl.length + "</p>";
        onl.forEach(function (m) { html += row(m, true); });
    } else {
        html += '<p class="mb-hd">No one online right now.</p>';
    }
    if (off.length) {
        html += '<p class="mb-hd">Offline — ' + off.length + "</p>";
        off.slice(0, 30).forEach(function (m) { html += row(m, false); });
    }
    list.innerHTML = html;
}

/* ── file upload — up to 300 MB streamed to the origin, real progress ── */
function chatUploadFile(file) {
    if (!file || !CHAT.token || !VEIL_ORIGIN) return;
    if (file.size > 300 * 1024 * 1024) { toast("That file is over the 300 MB limit.", true); return; }
    var up = $("veilChatUp");
    up.hidden = false;
    $("veilChatUpName").textContent = file.name;
    $("veilChatUpPct").textContent = "0%";
    $("veilChatUpFill").style.width = "0%";
    var xhr = new XMLHttpRequest();
    xhr.open("POST", VEIL_ORIGIN + "/api/chat-file?token=" + encodeURIComponent(CHAT.token) +
        "&name=" + encodeURIComponent(file.name.slice(0, 120)) +
        "&type=" + encodeURIComponent(file.type || ""));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) {
            var pct = Math.round(e.loaded / e.total * 100);
            $("veilChatUpPct").textContent = pct + "%";
            $("veilChatUpFill").style.width = pct + "%";
        }
    };
    xhr.onload = function () {
        up.hidden = true;
        try {
            var d = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300 && d.ok && d.file) {
                var f = d.file;
                var link = VEIL_ORIGIN + "/api/chat-file?id=" + encodeURIComponent(f.id) +
                    "&n=" + encodeURIComponent(f.name) + "&s=" + f.size +
                    "&t=" + encodeURIComponent(f.type);
                chatJ("/api/chat-data", { token: CHAT.token, channelId: "main", content: link }).then(function (dd) {
                    if (dd && dd.message) chatAppend(dd.message);
                }).catch(function () {
                    $("veilChatInput").value = link;
                    toast("Uploaded — hit send to share it.");
                });
            } else {
                toast(d.error || "Upload failed — try again.", true);
            }
        } catch (e) { toast("Upload failed — try again.", true); }
    };
    xhr.onerror = function () { up.hidden = true; toast("Upload failed — network hiccup.", true); };
    xhr.send(file);
}
var CHAT_KEY = "veil:chat-account";

function chatApi(path, opts, retryLeft) {
    /* All chat APIs are CORS-open (Origin: null friendly). The dev
       origin lazy-compiles cold routes (6s+) and the gateway 502s at
       ~5s — so one quiet retry rescues first-hit sends and loads. */
    return fetch(VEIL_ORIGIN + path, opts || {}).then(function (r) {
        if ((r.status === 502 || r.status === 503 || r.status === 504) && !retryLeft) {
            return new Promise(function (res) { setTimeout(res, 900); }).then(function () {
                return chatApi(path, opts, 1);
            });
        }
        return r.json().catch(function () { return {}; });
    }).then(function (d) {
        if (d && d.ok === false) throw new Error(d.error || "request failed");
        return d;
    }).catch(function (e) {
        if (!retryLeft && e instanceof TypeError) {
            return new Promise(function (res) { setTimeout(res, 900); }).then(function () {
                return chatApi(path, opts, 1);
            });
        }
        throw e;
    });
}
function chatJ(path, body) {
    return chatApi(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
}

function chatSaveSession() {
    LS.set(CHAT_KEY, JSON.stringify({ account: CHAT.account, token: CHAT.token }));
}
function chatClearSession() {
    LS.del(CHAT_KEY);
    CHAT.account = null; CHAT.token = "";
}

function chatIsOwner(a) {
    return !!a && String(a.username || "").toLowerCase() === "veil";
}
function chatIsMod(a) {
    if (!a) return false;
    if (chatIsOwner(a)) return true;
    return a.role === "moderator" || a.role === "admin";
}
function chatEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}
function chatTime(iso) {
    try {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return "";
        var h = d.getHours(), m = d.getMinutes();
        return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
    } catch (e) { return ""; }
}
function chatInitials(name) {
    var p = String(name || "?").trim().split(/\s+/).filter(Boolean);
    if (!p.length) return "?";
    if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
    return (p[0][0] + p[1][0]).toUpperCase();
}
function chatIsGif(t) {
    t = String(t || "").trim();
    if (/^\/gifs\/[a-z0-9-]+\.gif$/i.test(t)) return true;
    /* same-origin proxy GIFs — the bytes ride VEIL_ORIGIN via chatAbs */
    if (/^\/api\/gif-file\/[A-Za-z0-9_-]{4,32}(\?|$)/.test(t)) return true;
    return /^https:\/\/media\d*\.giphy\.com\/media\//i.test(t);
}

/* ── file attachments (up to 300 MB through /api/chat-file) ── */
function chatAbs(u) {
    u = String(u || "");
    if (/^https?:\/\//i.test(u) || !u) return u;
    return (VEIL_ORIGIN || "") + u;
}
function chatFileOf(t) {
    var m = /^(?:https?:\/\/[^\s]+)?\/api\/chat-file\?(\S+)$/i.exec(String(t || "").trim());
    if (!m) return null;
    try {
        var p = new URLSearchParams(m[1]);
        var id = p.get("id");
        if (!id) return null;
        return { url: String(t).trim(), name: p.get("n") || "file", size: Number(p.get("s")) || 0, type: p.get("t") || "application/octet-stream" };
    } catch (e) { return null; }
}
function chatFmtBytes(n) {
    if (!n) return "";
    if (n >= 1073741824) return (n / 1073741824).toFixed(1).replace(/\.0$/, "") + " GB";
    if (n >= 1048576) return (n / 1048576).toFixed(1).replace(/\.0$/, "") + " MB";
    if (n >= 1024) return (n / 1024).toFixed(0) + " KB";
    return n + " B";
}
function chatFileHtml(f) {
    var url = chatAbs(f.url);
    var t = String(f.type || "").toLowerCase();
    if (t.indexOf("image/") === 0) {
        return '<a href="' + chatEsc(url) + '" target="_blank" rel="noopener noreferrer" title="' + chatEsc(f.name) + '">' +
            '<img class="fileimg" src="' + chatEsc(url) + '" alt="' + chatEsc(f.name) + '" loading="lazy" /></a>';
    }
    if (t.indexOf("video/") === 0) {
        return '<video class="filevid" src="' + chatEsc(url) + '" controls preload="metadata"></video>';
    }
    if (t.indexOf("audio/") === 0) {
        return '<audio class="fileaud" src="' + chatEsc(url) + '" controls preload="metadata"></audio>';
    }
    return '<a class="filecard" href="' + chatEsc(url + (url.indexOf("?") >= 0 ? "&" : "?") + "download=1") + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="fc-ic">' + iconSVG("filetext", "") + "</span>" +
        '<span class="fc-bd"><b>' + chatEsc(f.name) + "</b><small>" + chatFmtBytes(f.size) + " · click to download</small></span>" +
        '<span class="fc-dl">' + iconSVG("dl", "") + "</span></a>";
}

/* render one message row — the SITE's flat look: avatar left, name +
   tag + time, content flat (no bubbles), grouped when the same author
   talks within 5 minutes, files render inline. */
function chatMsgHtml(m, prev) {
    var a = m.account || {};
    var mine = CHAT.account && a.id === CHAT.account.id;
    var owner = chatIsOwner(a);
    var mod = chatIsMod(a);
    var name = (a.displayName && String(a.displayName).trim()) || a.username || "someone";
    var color = /^#[0-9a-f]{6}$/i.test(a.avatarColor || "") ? a.avatarColor : "#27272a";
    var av = a.avatarImage
        ? '<img src="' + chatEsc(veilRoute(a.avatarImage)) + '" alt="" />'
        : chatEsc(chatInitials(name));
    var content = String(m.content || "");
    var file = chatFileOf(content);
    var bodyHtml;
    if (file) {
        bodyHtml = chatFileHtml(file);
    } else if (chatIsGif(content)) {
        bodyHtml = '<img class="gifmsg" src="' + chatEsc(chatAbs(content)) + '" alt="shared gif" loading="lazy" />';
    } else {
        var parts = content.split(/(https?:\/\/[^\s]+)/g);
        bodyHtml = parts.map(function (p) {
            /* posted links ride the veil origin when one is set — a plain
               external href would walk the viewer's browser straight to the
               third party (real IP + firewall-visible connection) */
            return /^https?:\/\//.test(p)
                ? '<a href="' + chatEsc(veilRoute(p)) + '" target="_blank" rel="noopener noreferrer">' + chatEsc(p) + "</a>"
                : chatEsc(p);
        }).join("");
    }
    var grouped = !!(prev && prev.account && prev.account.id === a.id &&
        (new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime()) < 5 * 60 * 1000);
    return '<div class="veil-chat-msg' + (grouped ? " grouped" : "") + (mine ? " mine" : "") + '" data-mid="' + chatEsc(m.id) + '">' +
        (grouped ? '<span class="av ghost"></span>' : '<span class="av" style="background:' + color + '">' + av + "</span>") +
        '<span class="bd">' +
        (grouped ? "" :
            '<span class="meta">' +
            '<span class="nm' + (owner ? " owner" : (mod ? " mod" : "")) + '">' + chatEsc(name) + "</span>" +
            (a.tag ? '<span class="tagb"' + (/^#[0-9a-f]{3,8}$/i.test(a.tagColor || "") ? ' style="color:' + chatEsc(a.tagColor) + ";border-color:" + chatEsc(a.tagColor) + '55"' : "") + '>' + chatEsc(a.tag) + "</span>" : "") +
            (owner ? '<span class="ownertag">OWNER</span>' : "") +
            (mod && !owner ? '<span class="modtag">MOD</span>' : "") +
            '<span class="tm">' + chatTime(m.createdAt) + "</span>" +
            "</span>") +
        '<span class="bub">' + bodyHtml + "</span>" +
        "</span></div>";
}

function chatScrollDown(smooth) {
    var list = $("veilChatList");
    if (!list) return;
    requestAnimationFrame(function () {
        list.scrollTo({ top: list.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    });
}

function chatAppend(m) {
    if (!m || !m.id || CHAT.seen[m.id]) return;
    CHAT.seen[m.id] = 1;
    CHAT.msgs.push(m);
    var list = $("veilChatList");
    if (!list) return;
    var empty = list.querySelector(".empty");
    if (empty) empty.remove();
    var prev = CHAT.msgs.length > 1 ? CHAT.msgs[CHAT.msgs.length - 2] : null;
    var wrap = el("div");
    wrap.innerHTML = chatMsgHtml(m, prev);
    list.appendChild(wrap.firstChild);
    /* keep the DOM bounded — matches the API's 50-message window */
    while (list.children.length > 60) list.removeChild(list.firstChild);
    var nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 160;
    if (nearBottom || (CHAT.account && m.account && m.account.id === CHAT.account.id)) {
        chatScrollDown(false);
    }
}

function chatRenderAll() {
    var list = $("veilChatList");
    if (!list) return;
    /* don't yank a reader to the bottom on poll re-renders — only
       scroll when they were already near the bottom (or it's fresh) */
    var nearBottom = !CHAT._renderedOnce ||
        (list.scrollHeight - list.scrollTop - list.clientHeight < 160);
    CHAT._renderedOnce = true;
    list.innerHTML = "";
    if (!CHAT.msgs.length) {
        var emp = el("div", "empty");
        emp.innerHTML = iconSVG("chat", "luc-22") + "<div>No one has said anything yet.<br/>Be the first — say hi.</div>";
        list.appendChild(emp);
        return;
    }
    var frag = document.createDocumentFragment();
    CHAT.msgs.forEach(function (m, i) {
        var w = el("div");
        w.innerHTML = chatMsgHtml(m, i > 0 ? CHAT.msgs[i - 1] : null);
        frag.appendChild(w.firstChild);
    });
    list.appendChild(frag);
    if (nearBottom) chatScrollDown(false);
}

/* ── realtime: socket.io (embedded by the build) + poll fallback ── */
function chatSockConnect() {
    if (!window.io || !VEIL_ORIGIN) return;
    try {
        var s = io(VEIL_ORIGIN + "/?XTransformPort=3004", {
            transports: ["polling", "websocket"],
            reconnection: true,
            reconnectionAttempts: 12,
            reconnectionDelay: 1500
        });
        CHAT.socket = s;
        s.on("connect", function () {
            CHAT.sockOk = true;
            CHAT.booting = false;
            chatPollStop();
            chatLiveBadge(true);
            /* the socket only carries NEW messages — backfill the history
               here too, so a failed first fetch can't leave an empty room */
            chatRefresh();
            /* signed session token — the relay derives identity from it and
               ignores client-claimed fields (anti-impersonation) */
            s.emit("identify", { token: CHAT.token });
            s.emit("subscribe", { channelId: "main" });
        });
        s.on("disconnect", function () {
            CHAT.sockOk = false;
            chatLiveBadge(false);
            chatPollStart();
        });
        s.on("connect_error", function () {
            chatLiveBadge(false);
            chatPollStart();
        });
        s.on("message", function (d) {
            if (!d || !d.id || d.channelId !== "main") return;
            if (!d.account) return;
            /* resolve the author's live role/tag from the roster — the
               relay payload carries none (same trick the site uses) */
            var known = null;
            (CHAT.members || []).forEach(function (m) {
                if (m && d.account && (m.id === d.account.accountId || m.username === d.account.username)) known = m;
            });
            chatAppend({
                id: d.id,
                channelId: "main",
                content: d.content,
                createdAt: new Date(d.ts || Date.now()).toISOString(),
                account: {
                    id: d.account.accountId,
                    username: d.account.username,
                    displayName: d.account.displayName,
                    avatarColor: d.account.avatarColor || "#27272a",
                    avatarImage: d.account.avatarImage || null,
                    role: known ? (known.role || "member") : "member",
                    tag: known ? (known.tag || null) : null,
                    tagColor: known ? (known.tagColor || null) : null
                }
            });
        });
        /* typing indicators + live presence (the site's chat has both) */
        s.on("typing", function (d) {
            if (!d || d.channelId !== "main" || !d.account || !d.account.username) return;
            if (CHAT.account && d.account.username === CHAT.account.username) return;
            CHAT.typing = CHAT.typing || {};
            CHAT.typing[d.account.username] = Date.now();
            chatTypingRender();
        });
        s.on("stop_typing", function (d) {
            if (!d || !d.account || !d.account.username) return;
            if (CHAT.typing) { delete CHAT.typing[d.account.username]; chatTypingRender(); }
        });
        s.on("presence", function (d) {
            if (!d || d.channelId !== "main") return;
            CHAT.online = {};
            (d.users || []).forEach(function (u) { if (u && u.username) CHAT.online[u.username] = 1; });
            chatMembersRender();
        });
    } catch (e) { /* socket stays down — polling covers it */ }
}
function chatSockClose() {
    if (CHAT.socket) { try { CHAT.socket.close(); } catch (e) {} }
    CHAT.socket = null; CHAT.sockOk = false;
}
function chatPollStart() {
    if (CHAT.poll || !CHAT.account) return;
    CHAT.poll = setInterval(chatRefresh, 5000);
}
function chatPollStop() {
    if (CHAT.poll) { clearInterval(CHAT.poll); CHAT.poll = null; }
}

/* pull the last 50 and merge (poll path + first load) */
function chatRefresh(showSpin) {
    return chatApi("/api/chat-data?channel=main").then(function (d) {
        (d.messages || []).forEach(function (m) {
            if (!CHAT.seen[m.id]) {
                CHAT.seen[m.id] = 1;
                CHAT.msgs.push(m);
            }
        });
        chatRenderAll();
    }).catch(function () { /* transient — keep the session */ });
}

function chatLiveBadge(on) {
    var n = $("veilChatLive");
    if (n) n.classList.toggle("on", !!on);
}

/* ── auth UI ── */
function chatShowAuth() {
    $("veilChatGate").hidden = true;
    $("veilChatRoom").hidden = true;
    $("veilChatHd").hidden = true;
    $("veilChatAuth").hidden = false;
    $("veilChatSub").textContent = "The veil's living room — say hi";
    setTimeout(function () { var u = $("veilChatUser"); if (u) u.focus(); }, 60);
}
function chatShowRoom() {
    $("veilChatGate").hidden = true;
    $("veilChatAuth").hidden = true;
    $("veilChatRoom").hidden = false;
    $("veilChatHd").hidden = false;
    $("veilChatMembers").hidden = false;
    $("veilChatSub").textContent = "#general · " + (CHAT.account ? (CHAT.account.displayName || CHAT.account.username) : "");
    if (CHAT.account) $("veilChatCoins").textContent = "🪙 " + (CHAT.account.coins || 0);
    chatScrollDown(false);
}
function chatEnter() {
    chatShowRoom();
    CHAT.booting = true; /* the players panel says connecting… until the roster or the socket lands */
    CHAT.seen = {}; CHAT.msgs = [];
    chatRefresh().then(function () {
        chatSockConnect();
        if (!CHAT.sockOk) chatPollStart();
        setTimeout(function () { if (!CHAT.sockOk) chatPollStart(); }, 2500);
    });
    chatMembersLoad();
    if (CHAT.membersPoll) clearInterval(CHAT.membersPoll);
    CHAT.membersPoll = setInterval(chatMembersLoad, 30000);
    if (!CHAT.typTicker) CHAT.typTicker = setInterval(chatTypingRender, 1500);
}
function chatAuthErr(msg) {
    var n = $("veilChatErr");
    if (!msg) { n.hidden = true; n.textContent = ""; return; }
    n.hidden = false;
    n.textContent = msg;
}
function chatAuthSubmit(ev) {
    ev.preventDefault();
    if (!VEIL_ORIGIN) return;
    var u = $("veilChatUser").value.trim();
    var p = $("veilChatPass").value;
    var dn = $("veilChatName").value.trim();
    if (CHAT.mode === "register") {
        if (u.length < 3) { chatAuthErr("Username must be at least 3 characters."); return; }
        if (p.length < 6) { chatAuthErr("Password must be at least 6 characters."); return; }
    } else if (!u || !p) {
        chatAuthErr("Username and password, please.");
        return;
    }
    var go = $("veilChatGo");
    go.disabled = true;
    go.textContent = CHAT.mode === "register" ? "Creating account…" : "Checking…";
    chatAuthErr("");
    var body = CHAT.mode === "register" ? { username: u, password: p, displayName: dn } : { username: u, password: p };
    var path = CHAT.mode === "register" ? "/api/chat-auth/register" : "/api/chat-auth/login";
    chatJ(path, body).then(function (d) {
        if (d && d.account && d.token) {
            CHAT.account = d.account;
            CHAT.token = d.token;
            chatSaveSession();
            $("veilChatPass").value = "";
            toast("Welcome to the room, " + ((d.account.displayName || d.account.username)) + ".");
            chatEnter();
        } else {
            throw new Error("bad response");
        }
    }).catch(function (err) {
        var msg = String((err && err.message) || "");
        if (/failed to fetch|network|load/i.test(msg)) msg = "The birth origin didn't answer — it may be offline or waking up. Try again in a moment.";
        chatAuthErr(msg || "Something went wrong — try again.");
    }).finally(function () {
        go.disabled = false;
        go.textContent = CHAT.mode === "register" ? "Create account & enter" : "Enter the room";
    });
}
function chatSignOut() {
    chatSockClose();
    chatPollStop();
    if (CHAT.membersPoll) { clearInterval(CHAT.membersPoll); CHAT.membersPoll = null; }
    chatClearSession();
    CHAT.seen = {}; CHAT.msgs = [];
    CHAT.typing = {}; CHAT.members = []; CHAT.online = {};
    if (CHAT.typTicker) { clearInterval(CHAT.typTicker); CHAT.typTicker = null; }
    $("veilChatList").innerHTML = "";
    $("veilChatGifs").hidden = true;
    $("veilChatTyping").hidden = true;
    $("veilChatUp").hidden = true;
    $("veilChatMembers").hidden = true;
    chatShowAuth();
    toast("Signed out of Veil Chat.");
}

/* ── send ── */
function chatSend(ev) {
    ev.preventDefault();
    var inp = $("veilChatInput");
    var content = inp.value.trim();
    if (!content || !CHAT.token) return;
    var btn = document.querySelector("#veilChatForm .sendbtn");
    if (btn) btn.disabled = true;
    inp.value = "";
    chatJ("/api/chat-data", { token: CHAT.token, channelId: "main", content: content }).then(function (d) {
        if (d && d.message) {
            chatAppend(d.message);
            if (d.account) { CHAT.account = d.account; $("veilChatCoins").textContent = "🪙 " + (d.account.coins || 0); }
        }
    }).catch(function (err) {
        inp.value = content; /* give the words back */
        toast(String((err && err.message) || "Message didn't send"), true);
    }).finally(function () {
        if (btn) btn.disabled = false;
        inp.focus();
    });
}

/* ── GIF drawer (giphy-backed, infinite pages) ── */
function chatGifToggle(open) {
    var drawer = $("veilChatGifs");
    var btn = $("veilChatGifBtn");
    var want = open == null ? drawer.hidden : open;
    drawer.hidden = !want;
    btn.classList.toggle("on", want);
    if (want && !$("veilChatGifGrid").children.length) chatGifLoad("trending", 1, true);
    if (want) setTimeout(function () { $("veilChatGifQ").focus(); }, 40);
}
function chatGifLoad(q, page, reset) {
    if (CHAT.gifLoading) return;
    if (reset) CHAT.gifQ = q;
    CHAT.gifLoading = true;
    var grid = $("veilChatGifGrid");
    var more = $("veilChatGifMore");
    if (reset) {
        grid.innerHTML = '<div class="ldg">Loading GIFs…</div>';
        more.hidden = true;
    } else {
        more.textContent = "Loading more…";
    }
    chatApi("/api/gif-search?q=" + encodeURIComponent(q) + "&page=" + page).then(function (d) {
        var gifs = (d && d.gifs) || [];
        if (reset) grid.innerHTML = "";
        else {
            var ldg = grid.querySelector(".ldg");
            if (ldg) ldg.remove();
        }
        var seen = {};
        grid.querySelectorAll(".cell").forEach(function (c) { seen[c.getAttribute("data-gid")] = 1; });
        gifs.forEach(function (g) {
            if (seen[g.id]) return;
            var cell = el("button", "cell");
            cell.type = "button";
            cell.setAttribute("data-gid", g.id);
            if (g.title) cell.title = g.title;
            cell.innerHTML = '<img src="' + chatEsc(chatAbs(g.preview)) + '" alt="" loading="lazy" />';
            cell.addEventListener("click", function () {
                chatGifToggle(false);
                /* keep the RELATIVE /api/gif-file/<id> in the message: the
                   website's GIF renderer matches it directly, and this file
                   renders it through chatAbs (chatIsGif now knows the shape) */
                $("veilChatInput").value = g.url;
                $("veilChatInput").focus();
                toast("GIF staged — hit send.");
            });
            grid.appendChild(cell);
        });
        CHAT.gifPage = page;
        CHAT.gifHasMore = !!(d && d.hasMore);
        more.hidden = !CHAT.gifHasMore;
        more.textContent = "More GIFs ↓";
        $("veilChatGifSrc").textContent = d && d.source === "local"
            ? "offline pack — giphy.com unreachable from the origin"
            : "∞ from giphy.com — search anything";
    }).catch(function () {
        if (reset) grid.innerHTML = "";
        more.hidden = true;
        $("veilChatGifSrc").textContent = "GIF search didn't answer — try again.";
    }).finally(function () {
        CHAT.gifLoading = false;
    });
}

/* ── section lifecycle ── */
function veilChatOpen() {
    if (CHAT.opened) return;
    CHAT.opened = true;
    if (!VEIL_ORIGIN) {
        $("veilChatGate").hidden = false;
        $("veilChatAuth").hidden = true;
        $("veilChatRoom").hidden = true;
        return;
    }
    /* session boot: same storage key the site uses, so an account
       saved by the site's page on this device carries over. */
    var saved = null;
    try { saved = JSON.parse(LS.get(CHAT_KEY) || "null"); } catch (e) {}
    if (saved && saved.account && saved.token) {
        CHAT.account = saved.account;
        CHAT.token = saved.token;
        chatEnter();
    } else {
        chatShowAuth();
    }
}

/* wire the section once */
(function chatWire() {
    if (!$("veilSecChat")) return;
    $("veilChatTabIn").addEventListener("click", function () {
        CHAT.mode = "login";
        $("veilChatTabIn").classList.add("on");
        $("veilChatTabUp").classList.remove("on");
        $("veilChatNameRow").hidden = true;
        $("veilChatGo").textContent = "Enter the room";
        chatAuthErr("");
    });
    $("veilChatTabUp").addEventListener("click", function () {
        CHAT.mode = "register";
        $("veilChatTabUp").classList.add("on");
        $("veilChatTabIn").classList.remove("on");
        $("veilChatNameRow").hidden = false;
        $("veilChatGo").textContent = "Create account & enter";
        chatAuthErr("");
    });
    $("veilChatAuthForm").addEventListener("submit", chatAuthSubmit);
    $("veilChatForm").addEventListener("submit", chatSend);
    $("veilChatOut").addEventListener("click", chatSignOut);
    $("veilChatFileBtn").addEventListener("click", function () { $("veilChatFileInput").click(); });
    $("veilChatFileInput").addEventListener("change", function () {
        var f = this.files && this.files[0];
        this.value = "";
        if (f) chatUploadFile(f);
    });
    $("veilChatGifBtn").addEventListener("click", function () { chatGifToggle(); });
    $("veilChatGifClose").addEventListener("click", function () { chatGifToggle(false); });
    $("veilChatGifMore").addEventListener("click", function () {
        if (!CHAT.gifLoading && CHAT.gifHasMore) chatGifLoad(CHAT.gifQ, CHAT.gifPage + 1, false);
    });
    $("veilChatGifQ").addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
            ev.preventDefault();
            var q = this.value.trim();
            if (q) chatGifLoad(q, 1, true);
        }
    });
    /* close the GIF drawer when leaving the section */
    document.querySelectorAll("#veilSecChat [data-close]").forEach(function (b) {
        b.addEventListener("click", function () { chatGifToggle(false); });
    });
})();

/* expose a tiny debug handle */
window.__veilShell = { engineNavigate: engineNavigate, openSection: openSection, toast: toast, chat: CHAT };
})();
