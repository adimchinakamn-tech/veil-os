/* Sulfur OS app module — Markdown Editor (ported from the standalone Sulfur OS page) */
(function () {
  "use strict";
  var REG = window.SulfurApps || (window.SulfurApps = {});
  REG["markdown"] = {
    id: "markdown",
    name: "Markdown",
    desc: "Split-pane editor with live preview, stats and .md export.",
    icon: "note",
    color: "#f59e0b",
    cat: "tool",
    w: 860, h: 620,
    mount: function (root, ctx) {
      root.style.setProperty("--acc", "#f59e0b");

      var st = document.createElement("style");
      st.textContent = [
        ".sa-markdown{position:relative;height:100%;display:flex;flex-direction:column;background:#0c0c0e;color:#e4e4e7;font:13.5px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden}",
        ".sa-markdown *{box-sizing:border-box}",
        ".sa-markdown :focus-visible{outline:2px solid var(--acc);outline-offset:2px}",
        ".sa-markdown .hrow{display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(24,24,27,.92);border-bottom:1px solid #27272a;flex:none;flex-wrap:wrap}",
        ".sa-markdown .hrow .name{font-size:14px;font-weight:700;white-space:nowrap}",
        ".sa-markdown .spacer{flex:1}",
        ".sa-markdown .tbtn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:36px;padding:0 14px;border-radius:8px;background:#202024;border:1px solid #27272a;color:#e4e4e7;font-size:12.5px;font-weight:600;font-family:inherit;cursor:pointer;transition:background .12s,border-color .12s,transform .06s}",
        ".sa-markdown .tbtn:hover{background:#26262b;border-color:#3f3f46}",
        ".sa-markdown .tbtn:active{transform:scale(.97)}",
        ".sa-markdown .tbtn.amber{background:var(--acc);border-color:transparent;color:#1c1206}",
        ".sa-markdown .tbtn.amber:hover{filter:brightness(1.08)}",
        ".sa-markdown .tools{display:flex;gap:5px;padding:8px 12px;border-bottom:1px solid #27272a;background:#101012;flex:none;overflow-x:auto}",
        ".sa-markdown .tools button{min-width:40px;height:38px;padding:0 11px;border-radius:8px;background:#202024;border:1px solid #27272a;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#a1a1aa;cursor:pointer;font-family:inherit;transition:background .12s,border-color .12s,color .12s,transform .06s;flex:none}",
        ".sa-markdown .tools button:hover{background:#26262b;color:#e4e4e7}",
        ".sa-markdown .tools button:active{transform:scale(.96)}",
        ".sa-markdown .tools .k{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;color:#e4e4e7}",
        ".sa-markdown .split{flex:1;display:flex;flex-wrap:wrap;min-height:0;overflow:auto}",
        ".sa-markdown .pane{flex:1 1 300px;min-width:260px;height:100%;display:flex;flex-direction:column}",
        ".sa-markdown .pane+.pane{border-left:1px solid #27272a}",
        ".sa-markdown .ph{flex:none;display:flex;align-items:center;gap:8px;padding:7px 14px;font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#71717a;border-bottom:1px solid #27272a;background:#101012}",
        ".sa-markdown .ph .dot{width:6px;height:6px;border-radius:50%;background:var(--acc)}",
        ".sa-markdown textarea{flex:1;min-height:120px;width:100%;resize:none;border:0;outline:none;background:#0c0c0e;color:#e4e4e7;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.7;padding:16px;tab-size:2}",
        ".sa-markdown .pvwrap{flex:1;min-height:0;overflow-y:auto;padding:18px 22px;background:#0c0c0e}",
        ".sa-markdown .pv{max-width:44em;font-size:14px;line-height:1.65;color:#e4e4e7;word-wrap:break-word}",
        ".sa-markdown .pv h1,.sa-markdown .pv h2,.sa-markdown .pv h3,.sa-markdown .pv h4{margin:18px 0 8px;line-height:1.25;color:#fafafa}",
        ".sa-markdown .pv h1{font-size:26px;border-bottom:1px solid #27272a;padding-bottom:6px}",
        ".sa-markdown .pv h2{font-size:21px}",
        ".sa-markdown .pv h3{font-size:17px}",
        ".sa-markdown .pv h4{font-size:15px}",
        ".sa-markdown .pv p{margin:8px 0}",
        ".sa-markdown .pv a{color:var(--acc);text-decoration:underline;text-underline-offset:2px}",
        ".sa-markdown .pv a:hover{filter:brightness(1.1)}",
        ".sa-markdown .pv code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;background:rgba(245,158,11,.12);color:#fcd34d;border-radius:5px;padding:1px 5px}",
        ".sa-markdown .pv pre{margin:10px 0;background:#131316;border:1px solid #27272a;border-radius:10px;padding:12px 14px;overflow-x:auto}",
        ".sa-markdown .pv pre code{background:none;color:#d4d4d8;padding:0;font-size:12px;line-height:1.6}",
        ".sa-markdown .pv blockquote{margin:10px 0;padding:2px 14px;border-left:3px solid var(--acc);background:rgba(245,158,11,.07);border-radius:0 8px 8px 0;color:#a1a1aa}",
        ".sa-markdown .pv ul,.sa-markdown .pv ol{margin:8px 0;padding-left:26px}",
        ".sa-markdown .pv li{margin:3px 0}",
        ".sa-markdown .pv ul ul,.sa-markdown .pv ol ol,.sa-markdown .pv ul ol,.sa-markdown .pv ol ul{margin:3px 0}",
        ".sa-markdown .pv hr{border:0;border-top:1px solid #27272a;margin:18px 0}",
        ".sa-markdown .pv del{color:#71717a}",
        ".sa-markdown .pv>:first-child{margin-top:0}",
        ".sa-markdown .foot{display:flex;align-items:center;gap:16px;padding:7px 14px;border-top:1px solid #27272a;background:rgba(24,24,27,.92);flex:none;font-size:12px;color:#71717a;flex-wrap:wrap}",
        ".sa-markdown .foot b{color:#a1a1aa;font-family:ui-monospace,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;font-weight:600}",
        ".sa-markdown .saved{margin-left:auto;display:flex;align-items:center;gap:6px;font-size:11.5px;color:#a1a1aa;opacity:0;transition:opacity .25s}",
        ".sa-markdown .saved.show{opacity:1}",
        ".sa-markdown .saved i{width:7px;height:7px;border-radius:50%;background:var(--acc);display:inline-block}"
      ].join("\n");
      root.appendChild(st);

      var wrap = document.createElement("div");
      wrap.className = "sa-markdown";
      root.appendChild(wrap);
      wrap.innerHTML = [
        '<div class="hrow">',
        '  <span class="name">Markdown</span><span class="spacer"></span>',
        '  <button class="tbtn" data-el="copyHtml">Copy HTML</button>',
        '  <button class="tbtn amber" data-el="exportMd">Export .md</button>',
        '</div>',
        '<div class="tools" role="toolbar" aria-label="Formatting">',
        '  <button data-a="bold" title="Bold" aria-label="Bold"><b>B</b></button>',
        '  <button data-a="italic" title="Italic" aria-label="Italic"><i>I</i></button>',
        '  <button data-a="h" title="Heading (toggle ##)" aria-label="Toggle heading"><span class="k">H</span></button>',
        '  <button data-a="code" title="Inline code" aria-label="Inline code"><span class="k">&lt;&gt;</span></button>',
        '  <button data-a="quote" title="Quote" aria-label="Quote"><span class="k">&gt;</span></button>',
        '  <button data-a="ul" title="Bullet list" aria-label="Bullet list"><span class="k">\u2022</span></button>',
        '  <button data-a="ol" title="Numbered list" aria-label="Numbered list"><span class="k">1.</span></button>',
        '</div>',
        '<div class="split">',
        '  <section class="pane" aria-label="Editor">',
        '    <div class="ph"><span class="dot"></span>Markdown</div>',
        '    <textarea data-el="ta" spellcheck="false" aria-label="Markdown source" placeholder="# Start typing\u2026"></textarea>',
        '  </section>',
        '  <section class="pane" aria-label="Preview">',
        '    <div class="ph"><span class="dot"></span>Preview</div>',
        '    <div class="pvwrap"><div class="pv" data-el="pv" aria-live="polite"></div></div>',
        '  </section>',
        '</div>',
        '<footer class="foot">',
        '  <span><b data-el="w">0</b> words</span>',
        '  <span><b data-el="c">0</b> chars</span>',
        '  <span><b data-el="l">1</b> lines</span>',
        '  <span class="saved" data-el="saved" aria-live="polite"><i></i><span data-el="savedTxt">Saved</span></span>',
        '</footer>'
      ].join("\n");

      var $ = function (name) { return wrap.querySelector('[data-el="' + name + '"]'); };
      var DEFAULT = "# Welcome to **Sulfur Markdown**\n\nA tiny editor with a live preview \u2014 everything runs offline in one file.\n\n## Features\n- Headings, **bold**, *italic*, ~~strike~~\n- `inline code` and fenced blocks\n- Nested lists\n  - like this one\n- [links](https://example.com) open in a new tab\n\n1. ordered lists\n2. also work\n\n> Block quotes look like this.\n\n---\n\n```js\nfunction greet(name) {\n  return \"Hello, \" + name;\n}\n```\n\nHTML in your text, like <script>alert(1)<\/script>, is escaped and shown as plain text.\n";

      var timeouts = [];
      function t(fn, ms) { var id = setTimeout(fn, ms); timeouts.push(id); return id; }

      function esc(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
      }

      /* ---- clipboard with fallback (helper node stays inside root) ---- */
      function copyText(text, okMsg) {
        var legacy = function () {
          try {
            var ta = document.createElement("textarea");
            ta.value = text; ta.setAttribute("readonly", "");
            ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
            root.appendChild(ta);
            ta.select(); ta.setSelectionRange(0, text.length);
            var ok = document.execCommand("copy");
            root.removeChild(ta);
            ctx.toast(ok ? (okMsg || "Copied") : "Copy failed", ok ? "ok" : "warn");
          } catch (e) { ctx.toast("Copy failed", "warn"); }
        };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { ctx.toast(okMsg || "Copied", "ok"); }, legacy);
            return;
          }
        } catch (e) {}
        legacy();
      }

      /* ================= tiny markdown renderer ================= */
      function inline(s) {
        var codes = [];
        var x = esc(s);
        x = x.replace(/`([^`\n]+)`/g, function (m, c) { codes.push("<code>" + c + "</code>"); return "\u0000I" + (codes.length - 1) + "\u0000"; });
        x = x.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        x = x.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>");
        x = x.replace(/~~([^~]+)~~/g, "<del>$1</del>");
        x = x.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, txt, url) {
          var safe = (/^(https?:\/\/|mailto:|\/\/|#|\/)/i.test(url)) ? url : "#";
          return "<a href=\"" + safe + "\" target=\"_blank\" rel=\"noopener noreferrer\">" + txt + "</a>";
        });
        x = x.replace(/\u0000I(\d+)\u0000/g, function (m, i) { return codes[+i] || ""; });
        return x;
      }
      var HR = /^(\s*)(-{3,}|\*{3,}|_{3,})\s*$/;
      var LI = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
      var HD = /^(#{1,4})\s+(.*)$/;
      function blockStart(line) {
        return HD.test(line) || /^>\s?/.test(line) || LI.test(line) || HR.test(line) ||
          /^\u0000B\d+\u0000\s*$/.test(line);
      }
      function processLines(lines, codes) {
        var out = [], i = 0;
        while (i < lines.length) {
          var line = lines[i];
          if (!line.trim()) { i++; continue; }
          var bm = /^\u0000B(\d+)\u0000\s*$/.exec(line);
          if (bm) { out.push(codes[+bm[1]] || ""); i++; continue; }
          if (HR.test(line)) { out.push("<hr>"); i++; continue; }
          var hm = HD.exec(line);
          if (hm) { out.push("<h" + hm[1].length + ">" + inline(hm[2]) + "</h" + hm[1].length + ">"); i++; continue; }
          if (/^>\s?/.test(line)) {
            var q = [];
            while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, "")); i++; }
            out.push("<blockquote>" + processLines(q, codes) + "</blockquote>");
            continue;
          }
          if (LI.test(line)) {
            var items = [];
            while (i < lines.length) {
              var m = LI.exec(lines[i]);
              if (!m) break;
              items.push({ ind: Math.min(3, Math.floor(m[1].replace(/\t/g, "  ").length / 2)), ord: /\d/.test(m[2][0]), txt: m[3] });
              i++;
            }
            out.push(buildList(items));
            continue;
          }
          var para = [];
          while (i < lines.length && lines[i].trim() && !blockStart(lines[i])) { para.push(lines[i]); i++; }
          out.push("<p>" + para.map(inline).join("<br>") + "</p>");
        }
        return out.join("\n");
      }
      function buildList(items) {
        var pos = 0, prev = items[0].ind;
        for (var k = 1; k < items.length; k++) {
          if (items[k].ind > prev) items[k].ind = prev + 1; /* quantize nesting jumps */
          prev = items[k].ind;
        }
        function parse(indent) {
          var ord = items[pos].ord, html = "<" + (ord ? "ol" : "ul") + ">";
          while (pos < items.length && items[pos].ind >= indent) {
            html += "<li>" + inline(items[pos].txt); pos++;
            if (pos < items.length && items[pos].ind > indent) html += parse(items[pos].ind);
            html += "</li>";
          }
          return html + "</" + (ord ? "ol" : "ul") + ">";
        }
        return parse(items[0].ind);
      }
      function renderMD(src) {
        var codes = [];
        var s = String(src == null ? "" : src).replace(/```[^\n]*\n([\s\S]*?)(?:```|(?![\s\S]))/g, function (m, c) {
          codes.push("<pre><code>" + esc(c.replace(/\n$/, "")) + "</code></pre>");
          return "\u0000B" + (codes.length - 1) + "\u0000";
        });
        var html = processLines(s.split("\n"), codes);
        return html.replace(/\u0000B(\d+)\u0000/g, function (m, i) { return codes[+i] || ""; });
      }
      /* ================= end renderer ================= */

      /* ---- editor wiring ---- */
      var ta = $("ta"), pv = $("pv");
      function update() {
        try { pv.innerHTML = renderMD(ta.value); } catch (e) { pv.textContent = "Render error"; }
        var v = ta.value;
        $("w").textContent = (v.match(/\S+/g) || []).length;
        $("c").textContent = v.length;
        $("l").textContent = v ? v.split("\n").length : 1;
        scheduleSave();
      }
      ta.addEventListener("input", update);

      /* ---- toolbar ---- */
      function wrapSel(before, after) {
        var s = ta.selectionStart, e = ta.selectionEnd;
        ta.setRangeText(before + ta.value.slice(s, e) + after, s, e);
        ta.focus();
        ta.setSelectionRange(s + before.length, e + before.length);
        update();
      }
      function prefixLines(pfx) {
        var v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
        var ls = v.lastIndexOf("\n", s - 1) + 1;
        var le = v.indexOf("\n", e); if (le < 0) le = v.length;
        var lines = v.slice(ls, le).split("\n");
        var all = lines.length > 0 && lines.every(function (l) { return l.indexOf(pfx) === 0; });
        var out = lines.map(function (l) { return all ? l.slice(pfx.length) : pfx + l; }).join("\n");
        ta.setRangeText(out, ls, le);
        ta.focus();
        ta.setSelectionRange(ls, ls + out.length);
        update();
      }
      Array.prototype.forEach.call(wrap.querySelectorAll(".tools button"), function (b) {
        b.addEventListener("click", function () {
          var a = b.getAttribute("data-a");
          if (a === "bold") wrapSel("**", "**");
          else if (a === "italic") wrapSel("*", "*");
          else if (a === "code") wrapSel("`", "`");
          else if (a === "h") prefixLines("## ");
          else if (a === "quote") prefixLines("> ");
          else if (a === "ul") prefixLines("- ");
          else if (a === "ol") prefixLines("1. ");
        });
      });

      /* ---- tab inserts two spaces (indent / outdent selection) ---- */
      ta.addEventListener("keydown", function (e) {
        if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        var v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
        if (s === en && !e.shiftKey) { ta.setRangeText("  ", s, en, "end"); }
        else {
          var ls = v.lastIndexOf("\n", s - 1) + 1;
          var le = v.indexOf("\n", en); if (le < 0) le = v.length;
          var lines = v.slice(ls, le).split("\n");
          var out = lines.map(function (l) {
            if (e.shiftKey) { return l.replace(/^ {1,2}/, "") || ""; }
            return "  " + l;
          }).join("\n");
          ta.setRangeText(out, ls, le);
          ta.setSelectionRange(ls, ls + out.length);
        }
        update();
      });

      /* ---- export & copy ---- */
      $("exportMd").addEventListener("click", function () {
        try {
          var b = new Blob([ta.value], { type: "text/markdown;charset=utf-8" });
          var u = URL.createObjectURL(b);
          var a = document.createElement("a");
          a.href = u; a.download = "sulfur-note.md";
          root.appendChild(a); a.click(); a.remove();
          t(function () { try { URL.revokeObjectURL(u); } catch (e) {} }, 4000);
          ctx.toast("Exported .md", "ok");
        } catch (err) { ctx.toast("Export failed", "warn"); }
      });
      $("copyHtml").addEventListener("click", function () { copyText(renderMD(ta.value), "HTML copied"); });

      /* ---- autosave / restore ---- */
      var saveT = 0, savedT = 0;
      function scheduleSave() { if (saveT) clearTimeout(saveT); saveT = t(saveNow, 700); }
      function saveNow() {
        ctx.storage.set("draft", ta.value);
        $("savedTxt").textContent = "Saved";
        $("saved").classList.add("show");
        if (savedT) clearTimeout(savedT);
        savedT = t(function () { $("saved").classList.remove("show"); }, 2200);
      }
      (function restore() {
        var restored = false;
        try {
          var raw = ctx.storage.get("draft", "");
          if (typeof raw === "string" && raw.length > 0 && raw !== DEFAULT) { ta.value = raw; restored = true; }
          else ta.value = DEFAULT;
        } catch (e) { ta.value = DEFAULT; }
        update();
        if (restored) ctx.toast("Draft restored", "info");
      })();

      return {
        onClose: function () {
          for (var i = 0; i < timeouts.length; i++) clearTimeout(timeouts[i]);
          timeouts.length = 0;
          saveT = 0; savedT = 0;
        }
      };
    }
  };
})();
