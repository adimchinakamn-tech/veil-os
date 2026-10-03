/* Sulfur OS app module — Color Lab (ported from the standalone Sulfur OS page) */
(function () {
  "use strict";
  var REG = window.SulfurApps || (window.SulfurApps = {});
  REG["color"] = {
    id: "color",
    name: "Color Lab",
    desc: "Convert, contrast-check and palette-build colors offline.",
    icon: "palette",
    color: "#f59e0b",
    cat: "creative",
    w: 880, h: 620,
    mount: function (root, ctx) {
      root.style.setProperty("--acc", "#f59e0b");

      var st = document.createElement("style");
      st.textContent = [
        ".sa-color{height:100%;overflow:auto;background:#0c0c0e;color:#e4e4e7;font:13.5px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}",
        ".sa-color *{box-sizing:border-box}",
        ".sa-color :focus-visible{outline:2px solid var(--acc);outline-offset:2px}",
        ".sa-color main{width:100%;max-width:920px;margin:0 auto;padding:16px 14px 28px;display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;align-items:start}",
        ".sa-color .card{background:#18181b;border:1px solid #27272a;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);padding:16px 18px;min-width:0}",
        ".sa-color .card h2{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#71717a;margin:0 0 12px}",
        ".sa-color .full{grid-column:1/-1}",
        ".sa-color .bigsw{height:148px;border-radius:12px;border:1px solid #27272a;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;transition:background .12s;box-shadow:inset 0 0 60px rgba(0,0,0,.15)}",
        ".sa-color .bigsw .hx{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:22px;font-weight:700;letter-spacing:.04em}",
        ".sa-color .bigsw .cc{font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.75}",
        ".sa-color .pickrow{display:flex;gap:10px;margin-top:14px}",
        ".sa-color input[type=color]{-webkit-appearance:none;appearance:none;width:56px;height:44px;flex:none;border:1px solid #27272a;border-radius:8px;background:#202024;padding:4px;cursor:pointer}",
        ".sa-color input[type=color]::-webkit-color-swatch-wrapper{padding:0}",
        ".sa-color input[type=color]::-webkit-color-swatch{border:0;border-radius:5px}",
        ".sa-color input[type=color]::-moz-color-swatch{border:0;border-radius:5px}",
        ".sa-color .hexin{flex:1;min-width:0;height:44px;border-radius:8px;border:1px solid #27272a;background:#141417;color:#e4e4e7;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:15px;letter-spacing:.05em;text-transform:uppercase;padding:0 14px;transition:border-color .12s}",
        ".sa-color .hexin:focus{outline:none;border-color:rgba(245,158,11,.55)}",
        ".sa-color .hexin.bad{border-color:#ef4444}",
        ".sa-color .hintline{font-size:11px;color:#71717a;margin:7px 0 0;min-height:16px}",
        ".sa-color .btnrow{display:flex;gap:10px;margin-top:14px}",
        ".sa-color .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;flex:1;padding:0 16px;border-radius:8px;background:#202024;border:1px solid #27272a;color:#e4e4e7;font-size:13.5px;font-weight:600;font-family:inherit;cursor:pointer;transition:background .12s,border-color .12s,transform .06s}",
        ".sa-color .btn:hover{background:#26262b;border-color:#3f3f46}",
        ".sa-color .btn:active{transform:scale(.97)}",
        ".sa-color .btn.amber{background:var(--acc);border-color:transparent;color:#1c1206}",
        ".sa-color .btn.amber:hover{filter:brightness(1.08)}",
        ".sa-color .srow{display:grid;grid-template-columns:22px 1fr 44px;align-items:center;gap:10px;margin-top:8px}",
        ".sa-color .srow .sl{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;font-weight:700;color:var(--acc)}",
        ".sa-color .srow .sv{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#a1a1aa;text-align:right;font-variant-numeric:tabular-nums}",
        ".sa-color .grad{position:relative;height:36px}",
        ".sa-color .gbar{position:absolute;left:0;right:0;top:14px;height:8px;border-radius:4px;background:#27272a;pointer-events:none}",
        ".sa-color .grad input{position:absolute;inset:0;width:100%;height:36px;margin:0;cursor:pointer}",
        ".sa-color .grad input::-webkit-slider-runnable-track{background:transparent;height:36px}",
        ".sa-color .grad input::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#fbbf24;border:2.5px solid #18181b;box-shadow:0 1px 5px rgba(0,0,0,.6);margin-top:9px}",
        ".sa-color .grad input::-moz-range-track{background:transparent;height:36px}",
        ".sa-color .grad input::-moz-range-thumb{width:13px;height:13px;border-radius:50%;background:#fbbf24;border:2.5px solid #18181b}",
        ".sa-color .vrow{display:flex;align-items:center;gap:10px;padding:7px 0}",
        ".sa-color .vrow+.vrow{border-top:1px solid #202024}",
        ".sa-color .vrow .k{font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#71717a;width:44px;flex:none}",
        ".sa-color .vrow .v{flex:1;min-width:0;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13.5px;color:#e4e4e7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".sa-color .cp{width:40px;height:40px;flex:none;display:grid;place-items:center;border-radius:8px;background:#202024;border:1px solid #27272a;color:#a1a1aa;cursor:pointer;transition:background .12s,border-color .12s,color .12s,transform .06s}",
        ".sa-color .cp:hover{background:#26262b;border-color:#3f3f46;color:var(--acc)}",
        ".sa-color .cp:active{transform:scale(.94)}",
        ".sa-color .crow{display:flex;align-items:center;gap:12px;padding:10px 0}",
        ".sa-color .crow+.crow{border-top:1px solid #202024}",
        ".sa-color .chipdemo{width:56px;height:44px;border-radius:8px;border:1px solid #27272a;display:grid;place-items:center;font-weight:700;font-size:15px;flex:none}",
        ".sa-color .crow .info{flex:1;min-width:0}",
        ".sa-color .crow .rt{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:16px;font-variant-numeric:tabular-nums;color:#e4e4e7}",
        ".sa-color .crow .rl{font-size:11.5px;color:#71717a;margin:2px 0 0}",
        ".sa-color .bdg{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:700;letter-spacing:.04em;padding:3px 8px;border-radius:999px;border:1px solid #27272a;color:#71717a;flex:none}",
        ".sa-color .bdg.ok{background:rgba(245,158,11,.14);border-color:rgba(245,158,11,.45);color:var(--acc)}",
        ".sa-color .bdg.no{background:rgba(239,68,68,.1);border-color:rgba(239,68,68,.4);color:#f87171}",
        ".sa-color .best{font-size:12px;color:#a1a1aa;margin:8px 0 0}",
        ".sa-color .best b{color:var(--acc)}",
        ".sa-color .strip{display:flex;gap:5px}",
        ".sa-color .strip button{flex:1;min-width:0;height:46px;border-radius:7px;border:1px solid rgba(255,255,255,.14);cursor:pointer;transition:transform .1s,box-shadow .1s;position:relative}",
        ".sa-color .strip button:hover{transform:translateY(-3px)}",
        ".sa-color .strip button.cur{box-shadow:0 0 0 2px #18181b,0 0 0 4px var(--acc)}",
        ".sa-color .palgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(46px,1fr));gap:9px}",
        ".sa-color .psw{position:relative;height:46px;border-radius:8px;border:1px solid rgba(255,255,255,.16);cursor:pointer;transition:transform .1s,box-shadow .1s}",
        ".sa-color .psw:hover{transform:scale(1.06)}",
        ".sa-color .psw.cur{box-shadow:0 0 0 2px #18181b,0 0 0 4px var(--acc)}",
        ".sa-color .psw .rm{position:absolute;top:-8px;right:-8px;width:24px;height:24px;border-radius:50%;background:#202024;border:1px solid #3f3f46;color:#a1a1aa;display:grid;place-items:center;font-size:13px;line-height:1;opacity:0;transition:opacity .12s,background .12s,color .12s}",
        ".sa-color .psw:hover .rm,.sa-color .psw:focus-visible .rm{opacity:1}",
        ".sa-color .psw .rm:hover{background:#3a2626;color:#f87171;border-color:rgba(239,68,68,.5)}",
        ".sa-color .palempty{font-size:12.5px;color:#71717a;text-align:center;padding:10px 0 4px}",
        ".sa-color .subh{margin:16px 0 12px}",
        ".sa-color .palhead{display:flex;align-items:baseline;gap:10px}",
        ".sa-color .palcount{margin-left:auto;color:#71717a;font-weight:600;letter-spacing:0;text-transform:none;font-size:11px}"
      ].join("\n");
      root.appendChild(st);

      var wrap = document.createElement("div");
      wrap.className = "sa-color";
      root.appendChild(wrap);
      wrap.innerHTML = [
        '<main>',
        '  <section class="card">',
        '    <h2>Pick</h2>',
        '    <div class="bigsw" data-el="bigsw"><span class="hx" data-el="bigHex">#F59E0B</span><span class="cc" data-el="bigC">on amber</span></div>',
        '    <div class="pickrow">',
        '      <input type="color" data-el="cpick" value="#f59e0b" aria-label="Color picker">',
        '      <input type="text" data-el="hexin" class="hexin" value="#F59E0B" spellcheck="false" autocomplete="off" aria-label="Hex value, like #F59E0B">',
        '    </div>',
        '    <div class="hintline" data-el="hexhint">Hex accepts #rgb or #rrggbb</div>',
        '    <div class="srow"><span class="sl">H</span><div class="grad"><div class="gbar" data-el="hBar"></div><input type="range" data-el="hIn" min="0" max="360" step="1" value="38" aria-label="Hue"></div><span class="sv" data-el="hV">38\u00B0</span></div>',
        '    <div class="srow"><span class="sl">S</span><div class="grad"><div class="gbar" data-el="sBar"></div><input type="range" data-el="sIn" min="0" max="100" step="1" value="92" aria-label="Saturation"></div><span class="sv" data-el="sV">92%</span></div>',
        '    <div class="srow"><span class="sl">L</span><div class="grad"><div class="gbar" data-el="lBar"></div><input type="range" data-el="lIn" min="0" max="100" step="1" value="50" aria-label="Lightness"></div><span class="sv" data-el="lV">50%</span></div>',
        '    <div class="btnrow">',
        '      <button class="btn" data-el="randBtn">Random</button>',
        '      <button class="btn amber" data-el="addBtn">Save color</button>',
        '    </div>',
        '  </section>',
        '  <section class="card">',
        '    <h2>Values</h2>',
        '    <div class="vrow"><span class="k">HEX</span><span class="v" data-el="vHex">#F59E0B</span><button class="cp" data-copy="hex" aria-label="Copy HEX"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="2"/><path d="M3 11V4a2 2 0 0 1 2-2h7"/></svg></button></div>',
        '    <div class="vrow"><span class="k">RGB</span><span class="v" data-el="vRgb">rgb(245, 158, 11)</span><button class="cp" data-copy="rgb" aria-label="Copy RGB"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="2"/><path d="M3 11V4a2 2 0 0 1 2-2h7"/></svg></button></div>',
        '    <div class="vrow"><span class="k">HSL</span><span class="v" data-el="vHsl">hsl(38, 92%, 50%)</span><button class="cp" data-copy="hsl" aria-label="Copy HSL"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="2"/><path d="M3 11V4a2 2 0 0 1 2-2h7"/></svg></button></div>',
        '    <h2 class="subh">WCAG contrast</h2>',
        '    <div class="crow">',
        '      <div class="chipdemo" data-el="chipB">Aa</div>',
        '      <div class="info"><div class="rt" data-el="crB">2.15 : 1</div><div class="rl">vs black text</div></div>',
        '      <span class="bdg" data-el="bdBAA">AA \u2717</span><span class="bdg" data-el="bdBAAA">AAA \u2717</span>',
        '    </div>',
        '    <div class="crow">',
        '      <div class="chipdemo" data-el="chipW">Aa</div>',
        '      <div class="info"><div class="rt" data-el="crW">2.15 : 1</div><div class="rl">vs white text</div></div>',
        '      <span class="bdg" data-el="bdWAA">AA \u2717</span><span class="bdg" data-el="bdWAAA">AAA \u2717</span>',
        '    </div>',
        '    <p class="best">Best text on this color: <b>white</b> \u00B7 AA needs 4.5:1, AAA needs 7:1</p>',
        '    <h2 class="subh">Shades &amp; tints</h2>',
        '    <div class="strip" data-el="strip" role="group" aria-label="Shades and tints, click to copy"></div>',
        '  </section>',
        '  <section class="card full">',
        '    <div class="palhead"><h2>Saved palette</h2><span class="palcount" data-el="palCount">0 / 24</span></div>',
        '    <div class="palgrid" data-el="palgrid"></div>',
        '    <p class="palempty" data-el="palempty">Nothing saved yet \u2014 pick a color and hit \u201CSave color\u201D. Click a swatch to load it, hover and \u00D7 (or right-click) to remove.</p>',
        '  </section>',
        '</main>'
      ].join("\n");

      var $ = function (name) { return wrap.querySelector('[data-el="' + name + '"]'); };
      var MAXPAL = 24;

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

      /* ---- conversions ---- */
      function hex2rgb(h) {
        return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
      }
      function rgb2hex(r, g, b) {
        var f = function (x) { var s = Math.max(0, Math.min(255, Math.round(x))).toString(16); return s.length < 2 ? "0" + s : s; };
        return "#" + f(r) + f(g) + f(b);
      }
      function rgb2hsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, h = 0, s = 0;
        if (max !== min) {
          var d = max - min;
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
          if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
          else if (max === g) h = (b - r) / d + 2;
          else h = (r - g) / d + 4;
          h *= 60;
        }
        return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
      }
      function hsl2hex(h, s, l) {
        s /= 100; l /= 100;
        var r, g, b;
        if (s === 0) { r = g = b = l; }
        else {
          var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
          var t = function (x) {
            if (x < 0) x += 1; if (x > 1) x -= 1;
            if (x < 1 / 6) return p + (q - p) * 6 * x;
            if (x < 1 / 2) return q;
            if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
            return p;
          };
          h = (h % 360) / 360;
          r = t(h + 1 / 3); g = t(h); b = t(h - 1 / 3);
        }
        return rgb2hex(r * 255, g * 255, b * 255);
      }
      function lum(hex) {
        var c = hex2rgb(hex), f = function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
      }
      function ratio(a, b) {
        var l1 = Math.max(a, b), l2 = Math.min(a, b);
        return (l1 + 0.05) / (l2 + 0.05);
      }
      function mix(hex, to, f) {
        var a = hex2rgb(hex), b = hex2rgb(to);
        return rgb2hex(a.r + (b.r - a.r) * f, a.g + (b.g - a.g) * f, a.b + (b.b - a.b) * f);
      }

      /* ---- state ---- */
      var hex = "#f59e0b";
      var pal = [];
      try {
        var raw = ctx.storage.get("palette", "");
        if (raw) {
          var d = JSON.parse(raw);
          if (Object.prototype.toString.call(d) === "[object Array]") {
            d.forEach(function (c) { if (/^#[0-9a-fA-F]{6}$/.test(c)) pal.push(c.toLowerCase()); });
            pal = pal.slice(0, MAXPAL);
          }
        }
      } catch (e) { pal = []; }

      /* ---- paint everything ---- */
      function setHex(h) {
        hex = h.toLowerCase();
        var rgb = hex2rgb(hex), hsl = rgb2hsl(rgb.r, rgb.g, rgb.b);
        $("bigsw").style.background = hex;
        $("bigHex").textContent = hex.toUpperCase();
        var l = lum(hex);
        var white = ratio(1, l), black = ratio(l, 0);
        var useWhite = white >= black;
        $("bigsw").style.color = useWhite ? "#ffffff" : "#000000";
        $("bigC").textContent = "best text: " + (useWhite ? "white" : "black");
        $("cpick").value = hex;
        $("vHex").textContent = hex.toUpperCase();
        $("vRgb").textContent = "rgb(" + rgb.r + ", " + rgb.g + ", " + rgb.b + ")";
        $("vHsl").textContent = "hsl(" + hsl.h + ", " + hsl.s + "%, " + hsl.l + "%)";
        $("hIn").value = hsl.h; $("sIn").value = hsl.s; $("lIn").value = hsl.l;
        $("hV").textContent = hsl.h + "\u00B0"; $("sV").textContent = hsl.s + "%"; $("lV").textContent = hsl.l + "%";
        $("sBar").style.background = "linear-gradient(90deg," + hsl2hex(hsl.h, 0, hsl.l) + "," + hsl2hex(hsl.h, 100, hsl.l) + ")";
        $("lBar").style.background = "linear-gradient(90deg,#000," + hsl2hex(hsl.h, hsl.s, 50) + ",#fff)";
        var rB = Math.round(black * 100) / 100, rW = Math.round(white * 100) / 100;
        $("crB").textContent = rB.toFixed(2) + " : 1";
        $("crW").textContent = rW.toFixed(2) + " : 1";
        $("chipB").style.background = hex; $("chipB").style.color = "#000000";
        $("chipW").style.background = hex; $("chipW").style.color = "#ffffff";
        badge($("bdBAA"), black >= 4.5, "AA"); badge($("bdBAAA"), black >= 7, "AAA");
        badge($("bdWAA"), white >= 4.5, "AA"); badge($("bdWAAA"), white >= 7, "AAA");
        var best = wrap.querySelector(".best");
        best.textContent = "";
        var b1 = document.createElement("b"); b1.textContent = useWhite ? "white" : "black";
        best.appendChild(b1);
        best.appendChild(document.createTextNode(" \u00B7 AA needs 4.5:1, AAA needs 7:1"));
        renderStrip(); renderPal();
      }
      function badge(el, ok, label) {
        el.textContent = label + (ok ? " \u2713" : " \u2717");
        el.classList.toggle("ok", ok);
        el.classList.toggle("no", !ok);
      }

      /* ---- inputs ---- */
      $("cpick").addEventListener("input", function (e) {
        $("hexin").value = e.target.value.toUpperCase();
        $("hexin").classList.remove("bad");
        $("hexhint").textContent = "Hex accepts #rgb or #rrggbb";
        setHex(e.target.value);
      });
      $("hexin").addEventListener("input", function (e) {
        var v = e.target.value.trim(), m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v), el = $("hexin");
        if (!m) {
          el.classList.add("bad");
          $("hexhint").textContent = v ? "Not a valid hex color" : "Hex accepts #rgb or #rrggbb";
          return;
        }
        el.classList.remove("bad");
        $("hexhint").textContent = "Hex accepts #rgb or #rrggbb";
        var hx = m[1].length === 3 ? m[1].split("").map(function (c) { return c + c; }).join("") : m[1];
        setHex("#" + hx);
      });
      $("hexin").addEventListener("blur", function () { $("hexin").value = hex.toUpperCase(); });
      ["hIn", "sIn", "lIn"].forEach(function (id) {
        $(id).addEventListener("input", function () {
          var h = +$("hIn").value, s = +$("sIn").value, l = +$("lIn").value;
          var nx = hsl2hex(h, s, l);
          $("hV").textContent = h + "\u00B0"; $("sV").textContent = s + "%"; $("lV").textContent = l + "%";
          $("hexin").value = nx.toUpperCase();
          setHex(nx);
        });
      });
      $("randBtn").addEventListener("click", function () {
        var h = Math.floor(Math.random() * 360), s = 40 + Math.floor(Math.random() * 60), l = 25 + Math.floor(Math.random() * 55);
        var nx = hsl2hex(h, s, l);
        $("hexin").value = nx.toUpperCase();
        setHex(nx);
      });

      /* ---- value copy buttons ---- */
      Array.prototype.forEach.call(wrap.querySelectorAll(".cp"), function (b) {
        b.addEventListener("click", function () {
          var what = b.getAttribute("data-copy"), txt;
          if (what === "hex") txt = hex.toUpperCase();
          else if (what === "rgb") txt = $("vRgb").textContent;
          else txt = $("vHsl").textContent;
          copyText(txt, what.toUpperCase() + " copied");
        });
      });

      /* ---- shades & tints ---- */
      function renderStrip() {
        var strip = $("strip");
        strip.innerHTML = "";
        for (var k = 0; k < 11; k++) {
          var c;
          if (k < 5) c = mix(hex, "#000000", (5 - k) / 5);
          else if (k === 5) c = hex;
          else c = mix(hex, "#ffffff", (k - 5) / 5);
          var b = document.createElement("button");
          b.style.background = c;
          b.title = c.toUpperCase();
          b.setAttribute("aria-label", "Copy " + c.toUpperCase());
          if (k === 5) b.className = "cur";
          (function (cc) { b.addEventListener("click", function () { copyText(cc.toUpperCase(), cc.toUpperCase() + " copied"); }); })(c);
          strip.appendChild(b);
        }
      }

      /* ---- saved palette ---- */
      var persistT = 0;
      function persistPal() {
        ctx.storage.set("palette", JSON.stringify(pal));
      }
      function renderPal() {
        var grid = $("palgrid");
        grid.innerHTML = "";
        $("palCount").textContent = pal.length + " / " + MAXPAL;
        $("palempty").style.display = pal.length ? "none" : "";
        pal.forEach(function (c, i) {
          var b = document.createElement("button");
          b.className = "psw" + (c === hex ? " cur" : "");
          b.style.background = c;
          b.title = esc(c.toUpperCase()) + " \u2014 click to load, right-click to remove";
          b.setAttribute("aria-label", "Load " + c.toUpperCase() + ". Press Delete to remove.");
          b.addEventListener("click", function () {
            $("hexin").value = c.toUpperCase();
            setHex(c);
          });
          b.addEventListener("contextmenu", function (e) {
            e.preventDefault();
            removeAt(i);
          });
          b.addEventListener("keydown", function (e) {
            if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeAt(i); }
          });
          var rm = document.createElement("span");
          rm.className = "rm";
          rm.textContent = "\u00D7";
          rm.setAttribute("aria-hidden", "true");
          rm.addEventListener("click", function (e) { e.stopPropagation(); removeAt(i); });
          b.appendChild(rm);
          grid.appendChild(b);
        });
      }
      function removeAt(i) {
        var c = pal.splice(i, 1);
        renderPal(); persistPal();
        if (c.length) ctx.toast(c[0].toUpperCase() + " removed", "info");
      }
      $("addBtn").addEventListener("click", function () {
        var i = pal.indexOf(hex);
        if (i >= 0) pal.splice(i, 1);
        pal.unshift(hex);
        var dropped = false;
        while (pal.length > MAXPAL) { pal.pop(); dropped = true; }
        renderPal(); persistPal();
        ctx.toast(dropped ? "Saved \u2014 oldest color dropped" : hex.toUpperCase() + " saved", "ok");
      });

      /* ---- hue bar gradient (static rainbow) ---- */
      $("hBar").style.background = "linear-gradient(90deg,#f00,#ff0 16.6%,#0f0 33.3%,#0ff 50%,#00f 66.6%,#f0f 83.3%,#f00)";
      setHex("#f59e0b");

      return {
        onClose: function () {
          if (persistT) clearTimeout(persistT);
        }
      };
    }
  };
})();
