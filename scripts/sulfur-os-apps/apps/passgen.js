/* Sulfur OS app module — Password Generator (ported from the standalone Sulfur OS page) */
(function () {
  "use strict";
  var REG = window.SulfurApps || (window.SulfurApps = {});
  REG["passgen"] = {
    id: "passgen",
    name: "Password Gen",
    desc: "Offline crypto-strong passwords and passphrases with entropy math.",
    icon: "lock",
    color: "#f59e0b",
    cat: "tool",
    w: 560, h: 640,
    mount: function (root, ctx) {
      root.style.setProperty("--acc", "#f59e0b");

      var st = document.createElement("style");
      st.textContent = [
        ".sa-passgen{height:100%;overflow-y:auto;background:#0c0c0e;color:#e4e4e7;font:13.5px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}",
        ".sa-passgen *{box-sizing:border-box}",
        ".sa-passgen :focus-visible{outline:2px solid var(--acc);outline-offset:2px}",
        ".sa-passgen main{width:100%;max-width:540px;margin:0 auto;padding:16px 14px 28px;display:flex;flex-direction:column;gap:16px}",
        ".sa-passgen .hrow{display:flex;align-items:center;gap:8px;width:100%;max-width:540px;margin:0 auto;padding:12px 14px 0}",
        ".sa-passgen .hrow .name{font-size:14px;font-weight:700;white-space:nowrap}",
        ".sa-passgen .spacer{flex:1}",
        ".sa-passgen .tabs{display:flex;gap:5px;background:#131316;border:1px solid #27272a;padding:5px;border-radius:12px}",
        ".sa-passgen .tabs button{flex:1;min-height:38px;border:0;border-radius:8px;font-size:13px;font-weight:600;color:#a1a1aa;background:none;cursor:pointer;font-family:inherit;transition:background .12s,color .12s,transform .06s}",
        ".sa-passgen .tabs button:hover{color:#e4e4e7}",
        ".sa-passgen .tabs button:active{transform:scale(.97)}",
        ".sa-passgen .tabs button.on{background:rgba(245,158,11,.14);color:var(--acc);box-shadow:inset 0 0 0 1px rgba(245,158,11,.4)}",
        ".sa-passgen .card{background:#18181b;border:1px solid #27272a;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);padding:16px 18px}",
        ".sa-passgen .card h2{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#71717a;margin:0 0 12px}",
        ".sa-passgen .out{width:100%;text-align:left;background:#101013;border:1px solid #27272a;border-radius:12px;padding:16px;min-height:64px;cursor:copy;transition:border-color .12s,background .12s;font-family:inherit;color:inherit}",
        ".sa-passgen .out:hover{border-color:rgba(245,158,11,.5);background:#121215}",
        ".sa-passgen .out:active{transform:scale(.99)}",
        ".sa-passgen .outv{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:17px;line-height:1.45;color:#e4e4e7;word-break:break-all}",
        ".sa-passgen .outv::after{content:\"\";display:inline-block;width:9px;height:18px;margin-left:3px;vertical-align:-3px;background:var(--acc);animation:sa-pg-blink 1.1s steps(1) infinite}",
        "@keyframes sa-pg-blink{50%{opacity:0}}",
        ".sa-passgen .outnote{font-size:11px;color:#71717a;margin:8px 0 0}",
        ".sa-passgen .btnrow{display:flex;gap:10px;margin-top:12px}",
        ".sa-passgen .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;flex:1;padding:0 16px;border-radius:8px;background:#202024;border:1px solid #27272a;color:#e4e4e7;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit;transition:background .12s,border-color .12s,transform .06s}",
        ".sa-passgen .btn:hover{background:#26262b;border-color:#3f3f46}",
        ".sa-passgen .btn:active{transform:scale(.97)}",
        ".sa-passgen .btn.amber{background:var(--acc);border-color:transparent;color:#1c1206}",
        ".sa-passgen .btn.amber:hover{filter:brightness(1.08)}",
        ".sa-passgen .sliderow{display:flex;align-items:center;justify-content:space-between;margin-bottom:2px}",
        ".sa-passgen .sliderow .lab{font-size:13px;color:#a1a1aa}",
        ".sa-passgen .sliderow b{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;color:var(--acc);font-variant-numeric:tabular-nums}",
        ".sa-passgen input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:38px;background:transparent;cursor:pointer}",
        ".sa-passgen input[type=range]::-webkit-slider-runnable-track{height:6px;border-radius:3px;background:#27272a}",
        ".sa-passgen input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;border-radius:50%;background:var(--acc);margin-top:-7px;box-shadow:0 1px 4px rgba(0,0,0,.5)}",
        ".sa-passgen input[type=range]::-moz-range-track{height:6px;border-radius:3px;background:#27272a}",
        ".sa-passgen input[type=range]::-moz-range-thumb{width:20px;height:20px;border:0;border-radius:50%;background:var(--acc)}",
        ".sa-passgen .togs{display:grid;grid-template-columns:1fr 1fr;gap:8px}",
        ".sa-passgen .tog{display:flex;align-items:center;gap:9px;min-height:44px;padding:0 12px;border-radius:8px;background:#141417;border:1px solid #27272a;font-size:12.5px;color:#a1a1aa;text-align:left;cursor:pointer;font-family:inherit;transition:background .12s,border-color .12s,color .12s,transform .06s}",
        ".sa-passgen .tog:hover{background:#1a1a1f;color:#e4e4e7}",
        ".sa-passgen .tog:active{transform:scale(.98)}",
        ".sa-passgen .tog.on{background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.45);color:#e4e4e7}",
        ".sa-passgen .tog .bx{width:18px;height:18px;border-radius:5px;border:1.5px solid #3f3f46;flex:none;display:grid;place-items:center;transition:background .12s,border-color .12s}",
        ".sa-passgen .tog.on .bx{background:var(--acc);border-color:var(--acc)}",
        ".sa-passgen .tog .bx svg{opacity:0;transition:opacity .12s}",
        ".sa-passgen .tog.on .bx svg{opacity:1}",
        ".sa-passgen .tog.wide{grid-column:1/-1}",
        ".sa-passgen .meter{height:6px;border-radius:3px;background:#27272a;overflow:hidden;margin:10px 0 8px}",
        ".sa-passgen .meter i{display:block;height:100%;border-radius:3px;background:var(--acc);transition:width .25s,background .25s}",
        ".sa-passgen .mrow{display:flex;align-items:baseline;justify-content:space-between;gap:10px}",
        ".sa-passgen .mrow .bits{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;color:#a1a1aa;font-variant-numeric:tabular-nums}",
        ".sa-passgen .tier{font-size:13px;font-weight:700}",
        ".sa-passgen .crack{font-size:12px;color:#71717a;margin:6px 0 0}",
        ".sa-passgen .crack b{color:#a1a1aa;font-weight:600}",
        ".sa-passgen .hist{display:flex;flex-direction:column;gap:6px}",
        ".sa-passgen .hrowbtn{display:flex;align-items:center;gap:10px;width:100%;text-align:left;min-height:44px;padding:8px 12px;border-radius:8px;background:#141417;border:1px solid #202024;cursor:copy;transition:background .12s,border-color .12s;font-family:inherit;color:inherit}",
        ".sa-passgen .hrowbtn:hover{background:#191920;border-color:rgba(245,158,11,.4)}",
        ".sa-passgen .hrowbtn:active{transform:scale(.99)}",
        ".sa-passgen .hrowbtn .idx{font-size:10.5px;font-weight:700;color:#71717a;flex:none;width:20px}",
        ".sa-passgen .hrowbtn .mask,.sa-passgen .hrowbtn .val{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;color:#a1a1aa;word-break:break-all}",
        ".sa-passgen .hrowbtn .val{display:none;color:#e4e4e7}",
        ".sa-passgen .hrowbtn:hover .val,.sa-passgen .hrowbtn:focus-visible .val{display:inline}",
        ".sa-passgen .hrowbtn:hover .mask,.sa-passgen .hrowbtn:focus-visible .mask{display:none}",
        ".sa-passgen .hrowbtn .meta{margin-left:auto;font-size:10.5px;color:#71717a;flex:none}",
        ".sa-passgen .hempty{font-size:12.5px;color:#71717a;text-align:center;padding:8px 0;margin:0}",
        ".sa-passgen .note{font-size:11.5px;color:#71717a;line-height:1.6;margin:10px 0 0}",
        ".sa-passgen .seg2{display:flex;gap:5px}",
        ".sa-passgen .seg2 button{flex:1;min-height:38px;border-radius:8px;background:#141417;border:1px solid #27272a;font-size:12.5px;font-weight:600;color:#a1a1aa;cursor:pointer;font-family:inherit;transition:background .12s,color .12s,border-color .12s,transform .06s}",
        ".sa-passgen .seg2 button:hover{color:#e4e4e7}",
        ".sa-passgen .seg2 button:active{transform:scale(.97)}",
        ".sa-passgen .seg2 button.on{background:rgba(245,158,11,.14);border-color:rgba(245,158,11,.5);color:var(--acc)}",
        ".sa-passgen #pwPanel,.sa-passgen #ppPanel{display:none}",
        ".sa-passgen #pwPanel.on,.sa-passgen #ppPanel.on{display:block}"
      ].join("\n");
      root.appendChild(st);

      var wrap = document.createElement("div");
      wrap.className = "sa-passgen";
      root.appendChild(wrap);
      var CHECK = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#1c1206" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5l2.5 2.5L10 3.5"/></svg>';
      wrap.innerHTML = [
        '<div class="hrow">',
        '  <span class="name">Password Gen</span><span class="spacer"></span>',
        '  <span style="font-size:10px;font-weight:700;letter-spacing:.14em;color:var(--acc);text-transform:uppercase">offline \u00B7 crypto rng</span>',
        '</div>',
        '<main>',
        '  <div class="tabs" role="tablist" aria-label="Generator mode">',
        '    <button data-el="tabPw" class="on" role="tab" aria-selected="true">Password</button>',
        '    <button data-el="tabPp" role="tab" aria-selected="false">Passphrase</button>',
        '  </div>',
        '  <div class="card">',
        '    <button class="out" data-el="out" aria-label="Generated output \u2014 press to copy">',
        '      <span class="outv" data-el="outv"></span>',
        '      <span class="outnote">Click to copy</span>',
        '    </button>',
        '    <div class="btnrow">',
        '      <button class="btn" data-el="copyBtn">Copy</button>',
        '      <button class="btn amber" data-el="regen">Regenerate</button>',
        '    </div>',
        '  </div>',
        '  <div class="card">',
        '    <h2>Strength</h2>',
        '    <div class="mrow">',
        '      <span class="tier" data-el="tier">\u2014</span>',
        '      <span class="bits" data-el="bits">0 bits of entropy</span>',
        '    </div>',
        '    <div class="meter"><i data-el="bar" style="width:0%"></i></div>',
        '    <p class="crack" data-el="crack"></p>',
        '  </div>',
        '  <div class="card" data-el="pwPanel">',
        '    <h2>Password options</h2>',
        '    <div class="sliderow"><span class="lab">Length</span><b data-el="lenVal">20</b></div>',
        '    <input type="range" data-el="len" min="8" max="64" step="1" value="20" aria-label="Password length, 8 to 64">',
        '    <div class="togs" style="margin-top:10px">',
        '      <button class="tog on" data-el="tgLower" role="checkbox" aria-checked="true"><span class="bx">' + CHECK + '</span>abc lowercase</button>',
        '      <button class="tog on" data-el="tgUpper" role="checkbox" aria-checked="true"><span class="bx">' + CHECK + '</span>ABC uppercase</button>',
        '      <button class="tog on" data-el="tgNums" role="checkbox" aria-checked="true"><span class="bx">' + CHECK + '</span>123 digits</button>',
        '      <button class="tog on" data-el="tgSyms" role="checkbox" aria-checked="true"><span class="bx">' + CHECK + '</span>!@# symbols</button>',
        '      <button class="tog wide" data-el="tgAmb" role="checkbox" aria-checked="false"><span class="bx">' + CHECK + '</span>Exclude ambiguous 0&nbsp;O&nbsp;1&nbsp;l&nbsp;I&nbsp;|</button>',
        '    </div>',
        '  </div>',
        '  <div class="card" data-el="ppPanel">',
        '    <h2>Passphrase options</h2>',
        '    <div class="sliderow"><span class="lab">Words</span><b data-el="wordVal">5</b></div>',
        '    <input type="range" data-el="words" min="4" max="8" step="1" value="5" aria-label="Word count, 4 to 8">',
        '    <div class="sliderow" style="margin-top:10px"><span class="lab">Separator</span></div>',
        '    <div class="seg2" role="group" aria-label="Separator">',
        '      <button data-el="sepHyphen">Hyphen (-)</button>',
        '      <button data-el="sepSpace" class="on">Space</button>',
        '    </div>',
        '    <p class="note" style="margin-top:12px" data-el="wlNote"></p>',
        '  </div>',
        '  <div class="card">',
        '    <h2>History \u2014 last 8</h2>',
        '    <div class="hist" data-el="hist"><p class="hempty">Generated passwords appear here. Hover to peek, click to copy.</p></div>',
        '    <p class="note" style="margin-top:10px">History lives in memory only \u2014 nothing secret is written to storage.</p>',
        '  </div>',
        '</main>'
      ].join("\n");

      var $ = function (name) { return wrap.querySelector('[data-el="' + name + '"]'); };
      var LOWER = "abcdefghijklmnopqrstuvwxyz", UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", NUMS = "0123456789", SYMS = "!@#$%^&*()-_=+[]{};:,.?/";
      var WORDS = ("amber anchor apple arbor arrow atlas autumn bacon bamboo banjo basil beacon beech beryl birch bison blaze bloom blossom breeze bridge bronze brook bubble bucket cactus candle canvas canyon caramel cargo cedar cinder citrus cliff clover cobalt coral cosmic cotton coyote crane crater crimson crown crystal dahlia daisy dawn delta denim diamond dolphin domino dragon drift eagle echo eclipse ember emerald falcon fern fjord flame flint forest fossil galaxy garnet ginger glacier granite grove harbor hazel heron honey indigo ivory jade jasmine kayak kelp koala lagoon lantern lemon lilac lotus lunar lynx maple marble meadow melon meteor mint mirror moss nebula nectar nova oasis ocean olive onyx opal orbit orchid otter panda pebble pine plum poppy prism quill ripple robin").split(" ");

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

      /* ---- unbiased random int [0,n) ---- */
      function rnd(n) {
        try {
          if (window.crypto && crypto.getRandomValues) {
            var lim = Math.floor(0x100000000 / n) * n, buf = new Uint32Array(1);
            do { crypto.getRandomValues(buf); } while (buf[0] >= lim);
            return buf[0] % n;
          }
        } catch (e) {}
        return Math.floor(Math.random() * n);
      }

      /* ---- state (options persisted; history memory-only) ---- */
      var mode = "pw", len = 20, wordCount = 5, sep = " ";
      var sets = { lower: true, upper: true, nums: true, syms: true };
      var amb = false, hist = [], current = "", currentBits = 0, currentKind = "";
      try {
        var raw = ctx.storage.get("opts", "");
        if (raw) {
          var d = JSON.parse(raw);
          if (d && typeof d === "object") {
            if (d.len >= 8 && d.len <= 64) len = d.len;
            if (d.words >= 4 && d.words <= 8) wordCount = d.words;
            if (typeof d.lower === "boolean") sets.lower = d.lower;
            if (typeof d.upper === "boolean") sets.upper = d.upper;
            if (typeof d.nums === "boolean") sets.nums = d.nums;
            if (typeof d.syms === "boolean") sets.syms = d.syms;
            if (typeof d.amb === "boolean") amb = d.amb;
            if (d.sep === "-" || d.sep === " ") sep = d.sep;
            if (d.mode === "pw" || d.mode === "pp") mode = d.mode;
          }
        }
      } catch (e) {}
      function persistOpts() {
        ctx.storage.set("opts", JSON.stringify({ mode: mode, len: len, words: wordCount, lower: sets.lower, upper: sets.upper, nums: sets.nums, syms: sets.syms, amb: amb, sep: sep }));
      }

      function pool() {
        var p = "";
        if (sets.lower) p += LOWER;
        if (sets.upper) p += UPPER;
        if (sets.nums) p += NUMS;
        if (sets.syms) p += SYMS;
        if (amb) p = p.replace(/[0OlI1|]/g, "");
        return p;
      }
      function genPassword() {
        var p = pool(), out = "";
        for (var i = 0; i < len; i++) out += p[rnd(p.length)];
        return out;
      }
      function genPassphrase() {
        var w = [];
        for (var i = 0; i < wordCount; i++) w.push(WORDS[rnd(WORDS.length)]);
        return w.join(sep);
      }

      /* ---- strength ---- */
      function tierOf(bits) {
        if (bits < 28) return ["Very weak", "#ef4444"];
        if (bits < 36) return ["Weak", "#f97316"];
        if (bits < 60) return ["Fair", "#eab308"];
        if (bits < 100) return ["Strong", "#f59e0b"];
        return ["Excellent", "#fde047"];
      }
      function crackTime(bits) {
        var s = Math.pow(2, bits - 1) / 1e10;
        if (!isFinite(s)) return "beyond comprehension";
        var r = function (x) { return x >= 100 ? Math.round(x) : Math.round(x * 10) / 10; };
        if (s < 1) return "instant";
        if (s < 60) return r(s) + " seconds";
        if (s < 3600) return r(s / 60) + " minutes";
        if (s < 86400) return r(s / 3600) + " hours";
        if (s < 31557600) return r(s / 86400) + " days";
        var y = s / 31557600;
        if (y < 1e3) return r(y) + " years";
        if (y < 1e6) return r(y / 1e3) + " thousand years";
        if (y < 1e9) return r(y / 1e6) + " million years";
        if (y < 1e12) return r(y / 1e9) + " billion years";
        if (y < 1e15) return r(y / 1e12) + " trillion years";
        var e = Math.floor(Math.log10(y));
        return (y / Math.pow(10, e)).toFixed(1) + "\u00D710^" + e + " years";
      }

      /* ---- generate & paint ---- */
      function generate(pushHist) {
        if (mode === "pw") {
          current = genPassword();
          currentBits = len * Math.log2(pool().length || 1);
          currentKind = len + " chars";
        } else {
          current = genPassphrase();
          currentBits = wordCount * Math.log2(WORDS.length);
          currentKind = wordCount + " words";
        }
        $("outv").textContent = current;
        var t = tierOf(currentBits);
        $("tier").textContent = t[0];
        $("tier").style.color = t[1];
        $("bits").textContent = currentBits.toFixed(1) + " bits of entropy";
        $("bar").style.width = Math.max(3, Math.min(100, currentBits / 128 * 100)) + "%";
        $("bar").style.background = t[1];
        $("crack").textContent = "Crack time at 10 billion guesses/s: " + crackTime(currentBits);
        if (pushHist) {
          hist.unshift({ v: current, bits: currentBits, kind: currentKind });
          if (hist.length > 8) hist.length = 8;
          renderHist();
        }
      }
      function renderHist() {
        var box = $("hist");
        box.innerHTML = "";
        if (!hist.length) {
          var p = document.createElement("p");
          p.className = "hempty";
          p.textContent = "Generated passwords appear here. Hover to peek, click to copy.";
          box.appendChild(p);
          return;
        }
        hist.forEach(function (h, i) {
          var row = document.createElement("button");
          row.className = "hrowbtn";
          row.type = "button";
          row.setAttribute("aria-label", "Copy history entry " + (i + 1));
          var idx = document.createElement("span"); idx.className = "idx"; idx.textContent = (i + 1);
          var mask = document.createElement("span"); mask.className = "mask";
          mask.textContent = "\u2022".repeat(Math.min(h.v.length, 24)) + (h.v.length > 24 ? "\u2026" : "");
          var val = document.createElement("span"); val.className = "val"; val.textContent = h.v;
          var meta = document.createElement("span"); meta.className = "meta";
          meta.textContent = Math.round(h.bits) + "b \u00B7 " + h.kind;
          row.appendChild(idx); row.appendChild(mask); row.appendChild(val); row.appendChild(meta);
          row.addEventListener("click", function () { copyText(h.v, "Copied from history"); });
          box.appendChild(row);
        });
      }

      /* ---- controls ---- */
      function setMode(m) {
        mode = m;
        $("tabPw").classList.toggle("on", m === "pw");
        $("tabPp").classList.toggle("on", m === "pp");
        $("tabPw").setAttribute("aria-selected", String(m === "pw"));
        $("tabPp").setAttribute("aria-selected", String(m === "pp"));
        $("pwPanel").classList.toggle("on", m === "pw");
        $("ppPanel").classList.toggle("on", m === "pp");
        persistOpts();
        generate(true);
      }
      $("tabPw").addEventListener("click", function () { setMode("pw"); });
      $("tabPp").addEventListener("click", function () { setMode("pp"); });

      $("len").addEventListener("input", function (e) { len = parseInt(e.target.value, 10) || 8; $("lenVal").textContent = len; generate(true); persistOpts(); });
      $("words").addEventListener("input", function (e) { wordCount = parseInt(e.target.value, 10) || 4; $("wordVal").textContent = wordCount; generate(true); persistOpts(); });

      var togMap = { tgLower: "lower", tgUpper: "upper", tgNums: "nums", tgSyms: "syms" };
      function paintTog(id) {
        var on;
        if (id === "tgAmb") on = amb; else on = sets[togMap[id]];
        var el = $(id);
        el.classList.toggle("on", on);
        el.setAttribute("aria-checked", String(on));
      }
      Object.keys(togMap).forEach(function (id) {
        $(id).addEventListener("click", function () {
          var k = togMap[id], others = false;
          for (var key in sets) if (key !== k && sets[key]) { others = true; break; }
          if (sets[k] && !others) { ctx.toast("At least one character set must stay on", "warn"); return; }
          sets[k] = !sets[k];
          paintTog(id);
          generate(true); persistOpts();
        });
      });
      $("tgAmb").addEventListener("click", function () {
        amb = !amb;
        paintTog("tgAmb");
        generate(true); persistOpts();
      });

      $("sepHyphen").addEventListener("click", function () { sep = "-"; paintSep(); generate(true); persistOpts(); });
      $("sepSpace").addEventListener("click", function () { sep = " "; paintSep(); generate(true); persistOpts(); });
      function paintSep() {
        $("sepHyphen").classList.toggle("on", sep === "-");
        $("sepSpace").classList.toggle("on", sep === " ");
      }

      $("regen").addEventListener("click", function () { generate(true); ctx.toast("Regenerated", "info"); });
      function doCopy() { copyText(current, "Password copied"); }
      $("copyBtn").addEventListener("click", doCopy);
      $("out").addEventListener("click", doCopy);

      /* ---- restore option state + init ---- */
      $("len").value = len; $("lenVal").textContent = len;
      $("words").value = wordCount; $("wordVal").textContent = wordCount;
      ["tgLower", "tgUpper", "tgNums", "tgSyms", "tgAmb"].forEach(paintTog);
      paintSep();
      $("wlNote").textContent = "Drawn from an embedded list of " + WORDS.length + " words \u2014 fully offline, cryptographically shuffled picks.";
      setMode(mode);
      try { root.focus({ preventScroll: true }); } catch (e) { root.focus(); }

      return {
        onClose: function () {
          hist.length = 0;
        }
      };
    }
  };
})();
