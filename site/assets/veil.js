/* ============================================================
   Veil — shared runtime for the static mirror.
   Works on every host that serves this site/ directory:
     - Cloudflare Pages / Vercel (site/ IS the web root —
       data + pages deploy together, always fresh, zero CDN lag)
     - jsDelivr .xhtml (repo layout)
     - raw.githack (repo layout)
   Perf rules:
     - Data is fetched RELATIVE first (same-origin, no CORS hop,
       fresh on every Cloudflare/Vercel deploy); the absolute
       jsDelivr URL is only a fallback.
     - Renders are signature-gated: if nothing changed, zero DOM
       work happens (no innerHTML churn, no GIF reloads, no
       scroll jumps).
     - New messages are APPENDED — existing DOM nodes are never
       touched, so images/GIFs and scroll position survive.
     - Polling pauses while the tab is hidden.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- base resolution ---------- */
  // Repo layout hosts:  .../veil-os@main/site/<page>  → base .../site/
  // Deploy hosts:       /<page>                      → base /
  // Both make SITE_BASE + "data/latest.json" correct.
  var HERE = window.location.href.split("#")[0].split("?")[0];
  var SITE_BASE = HERE.replace(/[^/]*$/, "");          // .../site/ or /
  var REPO_BASE = SITE_BASE.replace(/[^/]*\/$/, "");   // .../veil-os@main/

  window.VEIL = {
    base: SITE_BASE,
    asset: function (p) { return SITE_BASE + p; },
    repoFile: function (p) { return REPO_BASE + p; },
    /* Same-origin, deploy-fresh data (primary on ALL hosts). */
    dataLatest: SITE_BASE + "data/latest.json",
    dataVersion: SITE_BASE + "version.json",
    /* Absolute CDN fallbacks for exotic hosts / missing local data. */
    cdnLatest: "https://cdn.jsdelivr.net/gh/ok5678765s/veil-os@main/backups/chat/latest.json",
    cdnVersion: "https://cdn.jsdelivr.net/gh/ok5678765s/veil-os@main/site/version.json",
    latestJson: function () { return REPO_BASE + "backups/chat/latest.json"; },
    versionJson: function () { return REPO_BASE + "site/version.json"; },
  };

  /* ---------- multi-source fetch (primary → fallbacks) ---------- */
  function fetchJson(urls) {
    var i = 0;
    function tryNext() {
      if (i >= urls.length) return Promise.reject(new Error("all sources failed"));
      var url = urls[i++];
      return fetch(url, { cache: "no-store" }).then(function (r) {
        if (r.ok) return r.json();
        return tryNext();
      }, tryNext);
    }
    return tryNext();
  }
  window.VEIL.fetchJson = fetchJson;

  /* ---------- clock ---------- */
  var clockNodes = null;
  function tickClock() {
    if (!clockNodes) clockNodes = Array.prototype.slice.call(document.querySelectorAll("[data-veil-clock]"));
    if (!clockNodes.length) return;
    var d = new Date();
    var hh = d.getHours(), mm = d.getMinutes(), ss = d.getSeconds();
    var ampm = hh >= 12 ? "PM" : "AM";
    var h12 = hh % 12 === 0 ? 12 : hh % 12;
    var pad = function (n) { return String(n).padStart(2, "0"); };
    var t = h12 + ":" + pad(mm) + ":" + pad(ss) + " " + ampm;
    var days = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
    var months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
    var ds = days[d.getDay()] + ", " + months[d.getMonth()] + " " + d.getDate();
    for (var i = 0; i < clockNodes.length; i++) {
      var n = clockNodes[i];
      if (n.hasAttribute("data-date")) n.textContent = ds;
      else if (n.hasAttribute("data-seconds")) n.textContent = t;
      else n.textContent = h12 + ":" + pad(mm) + " " + ampm;
    }
  }
  tickClock();
  setInterval(function () { if (!document.hidden) tickClock(); }, 1000);

  /* ---------- helpers ---------- */
  function initials(name) {
    return (name || "?").trim().split(/\s+/).map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase();
  }
  function relTime(iso) {
    var then = new Date(iso).getTime();
    if (!then) return "";
    var s = Math.max(0, (Date.now() - then) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    if (s < 86400 * 30) return Math.floor(s / 86400) + "d ago";
    var d = new Date(iso);
    return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear();
  }
  function clockTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var hh = d.getHours(), mm = String(d.getMinutes()).padStart(2, "0");
    var ampm = hh >= 12 ? "PM" : "AM";
    var h12 = hh % 12 === 0 ? 12 : hh % 12;
    return h12 + ":" + mm + " " + ampm;
  }
  function dateLabel(iso) {
    var d = new Date(iso);
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- message content renderer ---------- */
  var GIF_RE = /^https?:\/\/(?:media\d*\.giphy\.com|media\.giphy\.com|i\.giphy\.com|media\.tenor\.com)\/\S+\.(?:gif|png|webp|mp4)(?:\?\S*)?$/i;

  function renderContent(text) {
    var out = "";
    String(text || "").split(/(\s+)/).forEach(function (tok) {
      if (/^https?:\/\/\S+$/i.test(tok)) {
        var url = tok.replace(/[.,!?]+$/, "");
        if (GIF_RE.test(url)) {
          out += '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"><img class="gif" src="' + esc(url) + '" alt="GIF shared in chat" loading="lazy" /></a>';
        } else {
          out += '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + "</a>";
        }
      } else {
        out += esc(tok);
      }
    });
    return out;
  }
  window.VEIL.renderContent = renderContent;

  /* ---------- chat renderer (site/chat.html) ---------- */
  var chatState = {
    renderedIds: [],      // message ids currently in the DOM (order)
    firstRender: true,
    lastData: null,
    lastAcctSig: "",
    lastCountShown: -1,
  };

  function setLive(ok) {
    var p = document.getElementById("live-pill");
    if (!p) return;
    p.className = "pill live" + (ok ? "" : " err");
    p.innerHTML = '<span class="pulse-dot" aria-hidden="true"></span>' + (ok ? "LIVE" : "RECONNECTING");
  }

  function updateSyncStamp() {
    var stamp = document.getElementById("backup-age");
    if (!stamp || !chatState.lastData || !chatState.lastData.exportedAt) return;
    stamp.textContent = "synced " + relTime(chatState.lastData.exportedAt);
  }

  function showNewMsgs(n) {
    var b = document.getElementById("new-msgs");
    if (!b) return;
    b.textContent = "↓ " + n + (n === 1 ? " new message" : " new messages");
    b.style.display = "inline-flex";
  }
  function hideNewMsgs() {
    var b = document.getElementById("new-msgs");
    if (b) b.style.display = "none";
  }

  /* Filter + sort the #general stream once per fetch. */
  function channelMsgs(data) {
    return (data.messages || [])
      .filter(function (m) { return !m.channelId || m.channelId === "main" || m.channelId === "general"; })
      .sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
  }

  /* Build the HTML for a SLICE of messages, grouping against `prevMsg`. */
  function buildMsgHtml(msgs, accounts, byId, prevMsg) {
    var html = "";
    var prevAuthor = prevMsg ? prevMsg.accountId : null;
    var prevDay = prevMsg ? dateLabel(prevMsg.createdAt) : null;
    msgs.forEach(function (m) {
      var a = accounts[m.accountId] || { username: "unknown", displayName: "unknown", avatarColor: "#2c3e50", role: "member" };
      var name = a.displayName || a.username;
      var day = dateLabel(m.createdAt);
      var first = m.accountId !== prevAuthor || day !== prevDay;

      if (day !== prevDay) {
        html += '<div class="group-label" style="text-align:center;padding:14px 0 4px">' + esc(day) + "</div>";
      }

      html += '<div class="msg' + (first ? " first" : "") + '">';
      if (first) {
        html += '<div class="ava" style="background:' + esc(a.avatarColor || "#2c3e50") + '">' + esc(initials(name)) + "</div>";
        html += '<div class="mbody"><div class="mhead">';
        html += '<span class="mauthor">' + esc(name) + "</span>";
        if (a.role === "admin" || a.role === "owner") html += '<span class="mtag">ADMIN</span>';
        html += '<span class="mtime" title="' + esc(m.createdAt) + '">' + esc(clockTime(m.createdAt)) + "</span>";
        html += "</div>";
      } else {
        html += '<div class="ava" style="visibility:hidden;background:#000">' + esc(initials(name)) + "</div>";
        html += '<div class="mbody"><div class="mhead"><span class="mtime" style="opacity:0">.</span></div>';
      }
      var reply = "";
      if (m.replyTo && byId[m.replyTo]) {
        var ra = accounts[byId[m.replyTo].accountId] || { displayName: "unknown" };
        reply = '<div class="pill" style="display:inline-block;margin-bottom:4px">↩ ' + esc(ra.displayName || "?") + ": " + esc(String(byId[m.replyTo].content || "").slice(0, 60)) + "</div><br/>";
      }
      html += '<div class="mtext">' + reply + renderContent(m.content) + "</div></div></div>";

      prevAuthor = m.accountId; prevDay = day;
    });
    return html;
  }

  function isPrefix(prev, next) {
    if (prev.length > next.length) return false;
    for (var i = 0; i < prev.length; i++) if (prev[i] !== next[i]) return false;
    return true;
  }

  function acctSig(accounts) {
    return (accounts || []).map(function (a) {
      return a.id + ":" + (a.displayName || a.username) + ":" + a.role + ":" + (a.legacy ? 1 : 0);
    }).join("|");
  }

  function updateCountPill(n) {
    if (n === chatState.lastCountShown) return;
    chatState.lastCountShown = n;
    var count = document.getElementById("chat-count");
    if (count) count.textContent = n + (n === 1 ? " message" : " messages");
  }

  function renderChat(data) {
    var list = document.getElementById("chat-messages");
    if (!list) return;

    var accounts = {};
    (data.accounts || []).forEach(function (a) { accounts[a.id] = a; });
    var byId = {};
    (data.messages || []).forEach(function (m) { byId[m.id] = m; });

    var msgs = channelMsgs(data);
    var newIds = msgs.map(function (m) { return m.id; });
    var oldIds = chatState.renderedIds;

    /* 1. Nothing changed → zero DOM work. */
    if (!chatState.firstRender && isPrefix(newIds, oldIds) && oldIds.length === newIds.length) {
      updateCountPill(msgs.length);
      return;
    }

    var nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 140;

    /* 2. Pure append → insert only the new slice. Existing nodes (GIFs,
          scroll position, :hover) are never touched. */
    if (!chatState.firstRender && oldIds.length > 0 && isPrefix(oldIds, newIds)) {
      var tail = msgs.slice(oldIds.length);
      var last = msgs[oldIds.length - 1];
      list.insertAdjacentHTML("beforeend", buildMsgHtml(tail, accounts, byId, last));
      chatState.renderedIds = newIds;
      updateCountPill(msgs.length);
      if (nearBottom) {
        list.scrollTop = list.scrollHeight;
        hideNewMsgs();
      } else {
        showNewMsgs(tail.length);
      }
      return;
    }

    /* 3. Full render (first paint, deletions, edits). */
    var html = buildMsgHtml(msgs, accounts, byId, null);
    if (!msgs.length) {
      html = '<div style="text-align:center;padding:60px 20px;color:var(--text-2)"><div style="font-size:44px;margin-bottom:10px">💬</div>No messages yet — the live site has them first.</div>';
    }
    list.innerHTML = html;
    chatState.renderedIds = newIds;
    chatState.firstRender = false;
    updateCountPill(msgs.length);
    list.scrollTop = list.scrollHeight;
    hideNewMsgs();
  }

  function renderPlayers(data) {
    /* Signature-gated: the members sidebar only re-renders when an
       account was added / renamed / re-rolled — not on every poll. */
    var sig = acctSig(data.accounts || []);
    if (sig === chatState.lastAcctSig) return;
    chatState.lastAcctSig = sig;

    var box = document.getElementById("players-list");
    if (box) {
      var html = '<div class="group-label">Members — ' + (data.accounts || []).length + "</div>";
      var sorted = (data.accounts || []).slice().sort(function (a, b) {
        var rank = function (x) { return x.role === "admin" || x.role === "owner" ? 0 : 1; };
        return rank(a) - rank(b) || a.username.localeCompare(b.username);
      });
      sorted.forEach(function (a) {
        var name = a.displayName || a.username;
        html += '<div class="prow">';
        html += '<div class="pava" style="background:' + esc(a.avatarColor || "#2c3e50") + '">' + esc(initials(name)) + '<span class="dot' + (a.legacy ? "" : " on") + '"></span></div>';
        html += '<div><div class="pname">' + esc(name);
        if (a.role === "admin" || a.role === "owner") html += ' <span class="pbadge">ADMIN</span>';
        html += "</div>";
        html += '<div style="font-size:11px;color:var(--text-2)">@' + esc(a.username) + "</div></div></div>";
      });
      box.innerHTML = html;
    }

    var mcount = document.getElementById("members-count");
    if (mcount) mcount.textContent = (data.accounts || []).length + " total";
  }

  function loadChat() {
    /* Primary: same-origin site/data/latest.json — on Cloudflare Pages /
       Vercel this is served from the SAME deploy as the page (instant,
       no CDN staleness). Fallback: absolute jsDelivr (CORS on), then the
       relative repo path (githack / full-repo hosts). */
    fetchJson([
      window.VEIL.dataLatest,
      window.VEIL.cdnLatest,
      window.VEIL.latestJson(),
    ])
      .then(function (data) {
        chatState.lastData = data;
        renderChat(data);
        renderPlayers(data);
        setLive(true);
        updateSyncStamp();
        var err = document.getElementById("chat-error");
        if (err) err.style.display = "none";
      })
      .catch(function () {
        setLive(false);
        var err = document.getElementById("chat-error");
        if (err) err.style.display = "block";
      });
  }

  if (document.getElementById("chat-messages")) {
    loadChat();
    setInterval(function () { if (!document.hidden) loadChat(); }, 30000);
    setInterval(function () { if (!document.hidden) updateSyncStamp(); }, 10000);
    /* Coming back to the tab? Refresh immediately instead of waiting
       out the rest of the 30s cycle. */
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) loadChat();
    });

    var newMsgsBtn = document.getElementById("new-msgs");
    if (newMsgsBtn) newMsgsBtn.addEventListener("click", function () {
      var l = document.getElementById("chat-messages");
      if (l) l.scrollTop = l.scrollHeight;
      hideNewMsgs();
    });
    var scrollBox = document.getElementById("chat-messages");
    if (scrollBox) scrollBox.addEventListener("scroll", function () {
      var b = document.getElementById("new-msgs");
      if (!b || b.style.display === "none") return;
      if (scrollBox.scrollHeight - scrollBox.scrollTop - scrollBox.clientHeight < 140) hideNewMsgs();
    }, { passive: true });
  }

  /* ---------- "open the live app" dialog (read-only mirror explainer) ---------- */
  var liveDialog = document.getElementById("live-dialog");
  document.querySelectorAll(".js-open-live").forEach(function (b) {
    b.addEventListener("click", function () {
      if (!liveDialog) return;
      if (typeof liveDialog.showModal === "function") liveDialog.showModal();
      else liveDialog.setAttribute("open", "open");
    });
  });
  var liveClose = document.getElementById("live-dialog-close");
  if (liveClose) liveClose.addEventListener("click", function () {
    if (liveDialog && liveDialog.close) liveDialog.close();
  });
  if (liveDialog) liveDialog.addEventListener("click", function (e) {
    if (e.target === liveDialog && liveDialog.close) liveDialog.close();
  });

  /* ---------- version pill: "site updated — refresh" ---------- */
  function pollVersion() {
    fetchJson([
      window.VEIL.dataVersion + "?t=" + Date.now(),
      window.VEIL.cdnVersion + "?t=" + Date.now(),
      window.VEIL.versionJson() + "?t=" + Date.now(),
    ])
      .then(function (v) {
        if (!v || !v.built) return;
        var pageStamp = document.documentElement.getAttribute("data-veil-build") || "0";
        if (v.built > pageStamp) {
          var pill = document.getElementById("refresh-pill");
          if (pill) pill.style.display = "inline-flex";
        }
      })
      .catch(function () {});
  }
  if (document.getElementById("refresh-pill")) {
    setTimeout(pollVersion, 4000);
    setInterval(function () { if (!document.hidden) pollVersion(); }, 30000);
  }

  /* ---------- copy buttons (links page) ---------- */
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-copy]");
    if (!b) return;
    e.preventDefault();
    var txt = b.getAttribute("data-copy");
    function done() {
      b.classList.add("done");
      b.textContent = "copied ✓";
      setTimeout(function () { b.classList.remove("done"); b.textContent = "copy"; }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = txt; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (x) {}
      document.body.removeChild(ta);
    }
  });
})();
