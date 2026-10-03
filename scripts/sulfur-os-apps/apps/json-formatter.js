/* Sulfur OS app — JSON Formatter (tools pack) */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var SAMPLE = '{\n  "name": "Sulfur OS",\n  "version": 2,\n  "offline": true,\n  "packs": ["games", "tools"],\n  "window": {\n    "w": 640,\n    "h": 480,\n    "min": { "w": 300, "h": 240 }\n  },\n  "notes": null\n}';

  var REG = window.SulfurApps || (window.SulfurApps = {});
  REG["json-formatter"] = {
    id: "json-formatter",
    name: "JSON Formatter",
    desc: "Pretty-print, minify, validate and explore JSON",
    icon: "code",
    color: "#2dd4bf",
    cat: "tool",
    w: 780, h: 560,
    mount: function (root, ctx) {
      ctx = ctx || {};
      var toast = ctx.toast || function () {};
      var store = ctx.storage || null;
      root.classList.add("sa-json-formatter");
      root.style.setProperty("--acc", "#2dd4bf");
      root.style.setProperty("--accd", "rgba(45,212,191,.15)");
      root.style.setProperty("--accf", "rgba(45,212,191,.6)");

      function load(k, d) {
        try {
          var v = store ? store.get(k, null) : null;
          if (v == null || v === "") return d;
          var p = JSON.parse(v);
          return p == null ? d : p;
        } catch (e) { return d; }
      }
      function save(k, v) { try { if (store) store.set(k, JSON.stringify(v)); } catch (e) {} }

      /* ---- state ---- */
      var raw = load("raw", null);
      if (raw == null) { raw = SAMPLE; save("raw", raw); }
      raw = String(raw);
      var indent = load("indent", 2);
      if (indent !== 2 && indent !== 4 && indent !== "tab") indent = 2;
      var sort = load("sort", false) === true;
      var view = load("view", "text");
      if (view !== "text" && view !== "tree") view = "text";
      var parsed = null, parseErr = null, outText = "", debTimer = 0;

      function indStr() { return indent === "tab" ? "\t" : "     ".slice(0, indent); }

      function sortDeep(v) {
        if (Object.prototype.toString.call(v) === "[object Array]") return v.map(sortDeep);
        if (v && typeof v === "object") {
          var out = {};
          Object.keys(v).sort().forEach(function (k) { out[k] = sortDeep(v[k]); });
          return out;
        }
        return v;
      }
      function parseNow() {
        parseErr = null;
        parsed = null;
        if (!raw.trim()) { return; }
        try { parsed = JSON.parse(raw); }
        catch (e) { parseErr = e; }
      }
      function buildOut(minify) {
        if (parsed == null) { outText = raw; return; }
        var v = sort ? sortDeep(parsed) : parsed;
        outText = JSON.stringify(v, null, minify ? 0 : indStr());
        if (minify && outText === "undefined") outText = "";
      }
      function countNodes(v) {
        if (v === null || typeof v !== "object") return 1;
        var n = 1, vals;
        if (Object.prototype.toString.call(v) === "[object Array]") vals = v;
        else vals = Object.keys(v).map(function (k) { return v[k]; });
        for (var i = 0; i < vals.length; i++) n += countNodes(vals[i]);
        return n;
      }
      function countKeys(v) {
        if (v === null || typeof v !== "object" || Object.prototype.toString.call(v) === "[object Array]") {
          if (Object.prototype.toString.call(v) === "[object Array]") { var n = 0; for (var i = 0; i < v.length; i++) n += countKeys(v[i]); return n; }
          return 0;
        }
        var t = 0, ks = Object.keys(v);
        for (var j = 0; j < ks.length; j++) t += 1 + countKeys(v[ks[j]]);
        return t;
      }
      function maxDepth(v) {
        if (v === null || typeof v !== "object") return 0;
        if (Object.prototype.toString.call(v) === "[object Array]") {
          var d = 0;
          for (var i = 0; i < v.length; i++) d = Math.max(d, maxDepth(v[i]));
          return d + 1;
        }
        var ks = Object.keys(v), d2 = 0;
        for (var j = 0; j < ks.length; j++) d2 = Math.max(d2, maxDepth(v[ks[j]]));
        return d2 + 1;
      }
      function byteLen(s) {
        try { if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length; } catch (e) {}
        try { return unescape(encodeURIComponent(s)).length; } catch (e2) { return s.length; }
      }
      function rootType(v) {
        if (v === null) return "null";
        if (Object.prototype.toString.call(v) === "[object Array]") return "array";
        if (typeof v === "object") return "object";
        return typeof v;
      }

      /* ---- dom ---- */
      var css = document.createElement("style");
      css.textContent = [
        ".sa-json-formatter{position:relative;width:100%;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;background:#131316;color:#e4e4e7;font:13px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;box-sizing:border-box}",
        ".sa-json-formatter *{box-sizing:border-box}",
        ".sa-json-formatter .bar{flex:none;display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #27272a;flex-wrap:wrap}",
        ".sa-json-formatter .btn{min-height:34px;padding:0 12px;border-radius:10px;border:1px solid #27272a;background:#18181b;color:#e4e4e7;font:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:background .15s,border-color .15s,transform .06s;user-select:none}",
        ".sa-json-formatter .btn:hover{background:#1f1f23;border-color:#3f3f46}",
        ".sa-json-formatter .btn:active{transform:translateY(1px)}",
        ".sa-json-formatter .btn:focus-visible{outline:2px solid var(--acc);outline-offset:2px}",
        ".sa-json-formatter .btn.pri{background:var(--acc);border-color:var(--acc);color:#062a26;font-weight:600}",
        ".sa-json-formatter .btn.pri:hover{filter:brightness(1.12)}",
        ".sa-json-formatter .btn.tog{color:#a1a1aa}",
        ".sa-json-formatter .btn.tog.on{color:var(--acc);border-color:var(--accf);background:var(--accd)}",
        ".sa-json-formatter .btn:disabled{opacity:.4;cursor:default;transform:none}",
        ".sa-json-formatter .seg{display:flex;border:1px solid #27272a;border-radius:10px;overflow:hidden;margin-left:auto}",
        ".sa-json-formatter .seg button{min-height:32px;padding:0 12px;border:0;background:transparent;color:#a1a1aa;font:inherit;cursor:pointer}",
        ".sa-json-formatter .seg button:hover{background:#1f1f23;color:#e4e4e7}",
        ".sa-json-formatter .seg button.on{background:var(--accd);color:var(--acc);font-weight:600}",
        ".sa-json-formatter .seg button:focus-visible{outline:2px solid var(--acc);outline-offset:-2px}",
        ".sa-json-formatter .seg.small{margin-left:0}",
        ".sa-json-formatter .seg.small button{min-height:28px;padding:0 10px;font-size:12px}",
        ".sa-json-formatter .main{flex:1;min-height:0;display:flex;flex-wrap:wrap;overflow:hidden}",
        ".sa-json-formatter .pane{flex:1 1 300px;min-width:240px;display:flex;flex-direction:column;min-height:0;overflow:hidden}",
        ".sa-json-formatter .ph{flex:none;display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #27272a;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:.8px}",
        ".sa-json-formatter .ph .grow{flex:1}",
        ".sa-json-formatter .mini{min-height:24px;min-width:24px;padding:0 6px;border:0;border-radius:6px;background:transparent;color:#71717a;font:inherit;font-size:11px;cursor:pointer}",
        ".sa-json-formatter .mini:hover{color:#e4e4e7;background:#1f1f23}",
        ".sa-json-formatter .mini:focus-visible{outline:2px solid var(--acc);outline-offset:1px}",
        ".sa-json-formatter textarea{flex:1;min-height:0;width:100%;resize:none;border:0;background:#0e0e11;color:#e4e4e7;padding:10px;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre;overflow:auto}",
        ".sa-json-formatter textarea:focus{outline:none}",
        ".sa-json-formatter .outwrap{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}",
        ".sa-json-formatter .status{flex:none;display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #27272a;font-size:12px;min-height:0}",
        ".sa-json-formatter .ok{color:#34d399}",
        ".sa-json-formatter .bad{color:#f87171}",
        ".sa-json-formatter .stats{color:#71717a;font-size:11.5px;margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
        ".sa-json-formatter .err{flex:none;margin:8px 10px 0;border:1px solid #5f2120;background:#1c1113;border-radius:12px;padding:8px 10px;overflow:auto}",
        ".sa-json-formatter .eh{font-size:12px;color:#f87171;font-weight:600}",
        ".sa-json-formatter .em{font-size:11.5px;color:#a1a1aa;margin-top:2px}",
        ".sa-json-formatter .es{margin:6px 0 0;font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e4e4e7;white-space:pre;overflow:auto}",
        ".sa-json-formatter .es .c{color:#f87171}",
        ".sa-json-formatter .tree{flex:1;min-height:0;overflow:auto;padding:8px 10px;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#0e0e11}",
        ".sa-json-formatter .tn{--d:0}",
        ".sa-json-formatter .tc{display:none;padding-left:16px;border-left:1px solid #27272a;margin-left:7px}",
        ".sa-json-formatter .tn.open>.tc{display:block}",
        ".sa-json-formatter .row{display:flex;align-items:baseline;gap:4px;flex-wrap:wrap;min-width:0}",
        ".sa-json-formatter .tg{flex:none;width:18px;height:18px;border:0;border-radius:5px;background:transparent;font:10px/18px ui-monospace,monospace;cursor:pointer;transition:transform .12s;color:#a1a1aa}",
        ".sa-json-formatter .tg:hover{background:#1f1f23;color:#e4e4e7}",
        ".sa-json-formatter .tg:focus-visible{outline:2px solid var(--acc);outline-offset:1px}",
        ".sa-json-formatter .tg::before{content:'\\25b8';display:inline-block;transition:transform .12s}",
        ".sa-json-formatter .tn.open>.row .tg::before{transform:rotate(90deg)}",
        ".sa-json-formatter .tn.leaf>.row{padding-left:18px}",
        ".sa-json-formatter .row .sp{flex:none;width:18px}",
        ".sa-json-formatter .tk{color:#7dd3fc;word-break:break-all}",
        ".sa-json-formatter .tv{word-break:break-all;min-width:0}",
        ".sa-json-formatter .pv{color:#71717a;font-size:11px}",
        ".sa-json-formatter .tv.s{color:#86efac}",
        ".sa-json-formatter .tv.n{color:#fcd34d}",
        ".sa-json-formatter .tv.b{color:#f0abfc}",
        ".sa-json-formatter .tv.z{color:#fb7185}",
        ".sa-json-formatter .hint{color:#71717a;font-size:12px;padding:24px 14px;text-align:center;line-height:1.7}"
      ].join("\n");
      root.appendChild(css);

      var wrap = document.createElement("div");
      wrap.className = "sa-json-formatter";
      root.appendChild(wrap);
      wrap.innerHTML =
        '<div class="bar">' +
          '<button class="btn pri" data-act="format">Format</button>' +
          '<button class="btn" data-act="minify">Minify</button>' +
          '<button class="btn" data-act="validate">Validate</button>' +
          '<button class="btn" data-act="sample">Sample</button>' +
          '<button class="btn" data-act="copy">Copy</button>' +
          '<button class="btn" data-act="clear">Clear</button>' +
          '<button class="btn tog' + (sort ? " on" : "") + '" data-act="sort" aria-pressed="' + sort + '">Sort keys</button>' +
          '<div class="seg small" role="group" aria-label="Indent">' +
            '<button type="button" data-ind="2">2</button><button type="button" data-ind="4">4</button><button type="button" data-ind="tab">Tab</button>' +
          '</div>' +
          '<div class="seg" role="group" aria-label="Output view">' +
            '<button type="button" data-view="text">Text</button><button type="button" data-view="tree">Tree</button>' +
          '</div>' +
        '</div>' +
        '<div class="main">' +
          '<div class="pane">' +
            '<div class="ph">Input<span class="grow"></span><span id="instats"></span></div>' +
            '<textarea id="in" spellcheck="false" aria-label="JSON input" placeholder="Paste JSON here\u2026"></textarea>' +
          '</div>' +
          '<div class="pane outwrap">' +
            '<div class="status" id="status"></div>' +
            '<div class="err" id="errbox" hidden></div>' +
            '<textarea id="out" readonly spellcheck="false" aria-label="Formatted JSON output" title="Click to select all"></textarea>' +
            '<div class="ph" id="treebar" hidden>Tree<span class="grow"></span><button class="mini" data-act="expandall">expand all</button><button class="mini" data-act="collapseall">collapse all</button></div>' +
            '<div class="tree" id="tree" hidden></div>' +
          '</div>' +
        '</div>';

      var inTa = wrap.querySelector("#in");
      var outTa = wrap.querySelector("#out");
      var statusEl = wrap.querySelector("#status");
      var errBox = wrap.querySelector("#errbox");
      var treeEl = wrap.querySelector("#tree");
      var treeBar = wrap.querySelector("#treebar");
      var inStats = wrap.querySelector("#instats");
      inTa.value = raw;

      function errInfo(e) {
        var msg = (e && e.message) || String(e);
        var line = null, col = null, off = null;
        var m = msg.match(/position (\d+)/);
        if (m) off = parseInt(m[1], 10);
        var m2 = msg.match(/line (\d+)(?: column (\d+))?/);
        if (m2) { line = parseInt(m2[1], 10); col = m2[2] ? parseInt(m2[2], 10) : null; }
        if (off != null && (line == null || col == null)) {
          line = 1; col = off + 1;
          for (var i = 0; i < off && i < raw.length; i++) {
            if (raw.charCodeAt(i) === 10) { line++; col = off - i; }
          }
        } else if (line != null && col == null) { col = 1; }
        if (line == null) { line = 1; col = 1; }
        return { msg: msg, line: line, col: col, off: off };
      }

      function renderErr() {
        if (!parseErr) { errBox.hidden = true; errBox.innerHTML = ""; return; }
        var info = errInfo(parseErr);
        var lines = raw.split("\n");
        var lt = lines[Math.min(info.line - 1, lines.length - 1)] || "";
        var caret = new Array(Math.max(0, info.col - 1) + 1).join(" ") + "^";
        errBox.hidden = false;
        errBox.innerHTML =
          '<div class="eh">\u2717 Parse error \u2014 line ' + info.line + ", column " + info.col +
          (info.off != null ? ' <span style="font-weight:400">(offset ' + info.off + ")</span>" : "") + "</div>" +
          '<div class="em">' + esc(info.msg) + "</div>" +
          '<pre class="es">' + esc(lt.length > 400 ? lt.slice(0, 400) + "\u2026" : lt) + "\n" + '<span class="c">' + esc(caret) + "</span></pre>";
      }

      function valClass(v) {
        if (typeof v === "string") return "s";
        if (typeof v === "number") return "n";
        if (typeof v === "boolean") return "b";
        return "z";
      }
      function leafHTML(v) {
        var s = v === null ? "null" : (typeof v === "string" ? JSON.stringify(v) : String(v));
        return '<span class="tv ' + valClass(v) + '">' + esc(s.length > 4000 ? s.slice(0, 4000) + "\u2026" : s) + "</span>";
      }
      function treeHTML(val, key, depth) {
        var isArr = Object.prototype.toString.call(val) === "[object Array]";
        var k = key == null ? "" : '<span class="tk">' + esc(JSON.stringify(key)) + ':</span>';
        if (val === null || typeof val !== "object") {
          return '<div class="tn leaf"><div class="row">' + k + leafHTML(val) + "</div></div>";
        }
        var keys = isArr ? val : Object.keys(val);
        var n = keys.length;
        var prev = isArr ? "[\u2026] " + n + " item" + (n === 1 ? "" : "s") : "{\u2026} " + n + " key" + (n === 1 ? "" : "s");
        var open = depth < 2 ? " open" : "";
        var kids = "";
        for (var i = 0; i < n; i++) {
          var ck = isArr ? null : keys[i];
          var cv = isArr ? keys[i] : val[ck];
          kids += treeHTML(cv, ck, depth + 1);
        }
        return '<div class="tn' + open + '"><div class="row">' +
          '<button class="tg" aria-label="Toggle branch"></button>' + k +
          '<span class="pv">' + (n === 0 ? (isArr ? "[]" : "{}") : prev) + "</span></div>" +
          '<div class="tc">' + kids + "</div></div>";
      }

      function renderStatus() {
        var st = "";
        if (!raw.trim()) {
          statusEl.innerHTML = '<span class="bad">Empty input</span>';
        } else if (parseErr) {
          var info = errInfo(parseErr);
          statusEl.innerHTML = '<span class="bad">\u2717 Invalid JSON \u2014 line ' + info.line + ", col " + info.col + "</span>";
        } else {
          st = '<span class="ok">\u2713 Valid JSON</span>';
          var statsTxt = rootType(parsed) + " \u00b7 " + countNodes(parsed) + " nodes \u00b7 " + countKeys(parsed) + " keys \u00b7 depth " + maxDepth(parsed) + " \u00b7 " + raw.length + " chars \u00b7 " + byteLen(outText) + " B";
          st += '<span class="stats">' + esc(statsTxt) + "</span>";
          statusEl.innerHTML = st;
        }
        inStats.textContent = raw.length ? raw.length + " chars" : "";
      }

      function renderOut() {
        outTa.value = outText;
        if (view === "text") {
          outTa.hidden = false; treeEl.hidden = true; treeBar.hidden = true;
        } else {
          outTa.hidden = true; treeBar.hidden = false; treeEl.hidden = false;
          if (parsed == null) {
            treeEl.innerHTML = '<div class="hint">' + (parseErr ? "Fix the parse error to see the tree." : "Paste some JSON to explore its structure.") + "</div>";
          } else {
            treeEl.innerHTML = treeHTML(parsed, null, 0);
          }
        }
      }

      function refresh() {
        parseNow();
        buildOut(false);
        renderErr();
        renderStatus();
        renderOut();
      }

      function setView(v) {
        view = v;
        save("view", view);
        wrap.querySelectorAll("[data-view]").forEach(function (b) {
          b.classList.toggle("on", b.getAttribute("data-view") === view);
        });
        renderOut();
      }
      function setIndent(v) {
        indent = v;
        save("indent", indent);
        wrap.querySelectorAll("[data-ind]").forEach(function (b) {
          b.classList.toggle("on", String(b.getAttribute("data-ind")) === String(indent));
        });
        refresh();
      }

      function copyOut() {
        if (!outText) { toast("Nothing to copy yet", "warn"); return; }
        var done = function () { toast("Copied " + outText.length + " characters", "ok"); };
        var fallback = function () {
          if (view !== "text") setView("text");
          outTa.focus();
          outTa.select();
          toast("Output selected \u2014 press Ctrl+C", "info");
        };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(outText).then(done, fallback);
          } else fallback();
        } catch (e) { fallback(); }
      }

      /* ---- interactions ---- */
      inTa.addEventListener("input", function () {
        raw = inTa.value;
        save("raw", raw);
        if (debTimer) clearTimeout(debTimer);
        debTimer = setTimeout(function () { debTimer = 0; refresh(); }, 250);
      });
      inTa.addEventListener("keydown", function (e) { e.stopPropagation(); });

      outTa.addEventListener("click", function () {
        outTa.focus();
        outTa.select();
      });

      wrap.addEventListener("click", function (e) {
        var tg = e.target.closest ? e.target.closest(".tg") : null;
        if (tg) {
          var tn = tg.closest(".tn");
          if (tn) tn.classList.toggle("open");
          return;
        }
        var b = e.target.closest ? e.target.closest("[data-act],[data-view],[data-ind]") : null;
        if (!b) return;
        if (b.hasAttribute("data-view")) { setView(b.getAttribute("data-view")); return; }
        if (b.hasAttribute("data-ind")) {
          var iv2 = b.getAttribute("data-ind");
          setIndent(iv2 === "tab" ? "tab" : parseInt(iv2, 10));
          return;
        }
        var a = b.getAttribute("data-act");
        if (a === "format") {
          parseNow();
          if (parseErr || parsed == null) { refresh(); toast("Cannot format \u2014 invalid JSON", "warn"); return; }
          buildOut(false);
          raw = outText; inTa.value = raw; save("raw", raw);
          refresh();
          toast("Formatted", "ok");
        } else if (a === "minify") {
          parseNow();
          if (parseErr || parsed == null) { refresh(); toast("Cannot minify \u2014 invalid JSON", "warn"); return; }
          buildOut(true);
          raw = outText; inTa.value = raw; save("raw", raw);
          refresh();
          toast("Minified to " + raw.length + " chars", "ok");
        } else if (a === "validate") {
          parseNow();
          if (parseErr) {
            var info = errInfo(parseErr);
            refresh();
            toast("Invalid \u2014 line " + info.line + ", col " + info.col, "warn");
          } else {
            refresh();
            toast("Valid JSON \u00b7 " + countNodes(parsed) + " nodes", "ok");
          }
        } else if (a === "sample") {
          raw = SAMPLE; inTa.value = raw; save("raw", raw); refresh();
        } else if (a === "copy") {
          copyOut();
        } else if (a === "clear") {
          raw = ""; inTa.value = ""; save("raw", raw); refresh();
        } else if (a === "sort") {
          sort = !sort;
          save("sort", sort);
          b.classList.toggle("on", sort);
          b.setAttribute("aria-pressed", String(sort));
          refresh();
        } else if (a === "expandall") {
          treeEl.querySelectorAll(".tn").forEach(function (n) { n.classList.add("open"); });
        } else if (a === "collapseall") {
          treeEl.querySelectorAll(".tn").forEach(function (n) { n.classList.remove("open"); });
        }
      });

      root.addEventListener("keydown", function (e) {
        if ((e.ctrlKey || e.metaKey) && (e.key === "Enter" || e.key === "\n")) {
          e.preventDefault();
          wrap.querySelector('[data-act="format"]').click();
        }
      });

      wrap.querySelectorAll("[data-ind]").forEach(function (b) {
        b.classList.toggle("on", String(b.getAttribute("data-ind")) === String(indent));
      });
      wrap.querySelectorAll("[data-view]").forEach(function (b) {
        b.classList.toggle("on", b.getAttribute("data-view") === view);
      });
      refresh();

      return {
        onClose: function () {
          if (debTimer) { clearTimeout(debTimer); debTimer = 0; }
        }
      };
    }
  };
})();
