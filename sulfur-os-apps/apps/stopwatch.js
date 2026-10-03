/* Sulfur OS app — Stopwatch & Timer (tools pack) */
(function () {
  "use strict";

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  var REG = window.SulfurApps || (window.SulfurApps = {});
  REG["stopwatch"] = {
    id: "stopwatch",
    name: "Stopwatch",
    desc: "Stopwatch with laps plus a countdown timer with alarm",
    icon: "custom:M10 2h4M12 14l3-3M4 14a8 8 0 1 0 16 0a8 8 0 1 0-16 0z",
    color: "#f97316",
    cat: "tool",
    w: 620, h: 560,
    mount: function (root, ctx) {
      ctx = ctx || {};
      var toast = ctx.toast || function () {};
      var store = ctx.storage || null;
      root.classList.add("sa-stopwatch");
      root.style.setProperty("--acc", "#f97316");
      root.style.setProperty("--accd", "rgba(249,115,22,.16)");

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
      var sw = load("sw", null) || {};
      sw.elapsed = Number(sw.elapsed) || 0;
      sw.running = !!sw.running;
      sw.startedAt = Number(sw.startedAt) || 0;
      sw.laps = (Object.prototype.toString.call(sw.laps) === "[object Array]") ? sw.laps : [];
      sw.laps = sw.laps.filter(function (l) { return l && isFinite(l.total) && isFinite(l.split); });

      var tm = load("tm", null) || {};
      tm.total = Number(tm.total) || 300000;
      tm.remaining = isFinite(tm.remaining) ? Math.max(0, Number(tm.remaining)) : 300000;
      tm.running = !!tm.running;
      tm.endAt = Number(tm.endAt) || 0;

      var tab = "sw";
      var raf = 0;
      var AC = null;

      function swElapsed() {
        return sw.running ? sw.elapsed + (Date.now() - sw.startedAt) : sw.elapsed;
      }
      function tmRemaining() {
        return tm.running ? Math.max(0, tm.endAt - Date.now()) : tm.remaining;
      }
      function saveSw() { save("sw", sw); }
      function saveTm() { save("tm", tm); }

      /* ---- audio ---- */
      function ensureAC() {
        try {
          var Ctor = window.AudioContext || window.webkitAudioContext;
          if (!Ctor) return null;
          if (!AC) AC = new Ctor();
          if (AC.state === "suspended") { AC.resume(); }
          return AC;
        } catch (e) { return null; }
      }
      function beep() {
        var ac = ensureAC();
        if (!ac) return;
        try {
          var t0 = ac.currentTime;
          for (var i = 0; i < 3; i++) {
            var t = t0 + i * 0.5;
            var o = ac.createOscillator();
            var g = ac.createGain();
            o.type = "square";
            o.frequency.setValueAtTime(i === 2 ? 1174.7 : 880, t);
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
            o.connect(g);
            g.connect(ac.destination);
            o.start(t);
            o.stop(t + 0.26);
          }
        } catch (e) { /* audio unavailable */ }
      }

      /* ---- dom ---- */
      var css = document.createElement("style");
      css.textContent = [
        ".sa-stopwatch{position:relative;width:100%;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;background:#131316;color:#e4e4e7;font:13px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;box-sizing:border-box}",
        ".sa-stopwatch *{box-sizing:border-box}",
        ".sa-stopwatch .tabs{flex:none;display:flex;justify-content:center;padding:10px 10px 0}",
        ".sa-stopwatch .seg{display:flex;border:1px solid #27272a;border-radius:10px;overflow:hidden}",
        ".sa-stopwatch .seg button{min-height:34px;padding:0 18px;border:0;background:transparent;color:#a1a1aa;font:inherit;cursor:pointer}",
        ".sa-stopwatch .seg button:hover{background:#1f1f23;color:#e4e4e7}",
        ".sa-stopwatch .seg button.on{background:var(--accd);color:var(--acc);font-weight:600}",
        ".sa-stopwatch .seg button:focus-visible{outline:2px solid var(--acc);outline-offset:-2px}",
        ".sa-stopwatch .view{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;padding:14px 14px 12px;gap:12px;overflow:hidden}",
        ".sa-stopwatch .big{font:700 52px/1.05 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e4e4e7;font-variant-numeric:tabular-nums;letter-spacing:-1px;white-space:nowrap}",
        ".sa-stopwatch .sub{font-size:12px;color:#71717a;font-variant-numeric:tabular-nums;min-height:16px}",
        ".sa-stopwatch .ctrls{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}",
        ".sa-stopwatch .btn{min-height:38px;padding:0 20px;border-radius:10px;border:1px solid #27272a;background:#18181b;color:#e4e4e7;font:inherit;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:background .15s,border-color .15s,transform .06s;user-select:none}",
        ".sa-stopwatch .btn:hover{background:#1f1f23;border-color:#3f3f46}",
        ".sa-stopwatch .btn:active{transform:translateY(1px)}",
        ".sa-stopwatch .btn:focus-visible{outline:2px solid var(--acc);outline-offset:2px}",
        ".sa-stopwatch .btn.pri{background:var(--acc);border-color:var(--acc);color:#2a1305;font-weight:600;min-width:110px}",
        ".sa-stopwatch .btn.pri:hover{filter:brightness(1.1)}",
        ".sa-stopwatch .btn.warn{background:var(--acc);border-color:var(--acc);color:#2a1305;font-weight:600}",
        ".sa-stopwatch .btn:disabled{opacity:.4;cursor:default;transform:none}",
        ".sa-stopwatch .lapsbox{flex:1;min-height:0;width:100%;max-width:420px;display:flex;flex-direction:column;border:1px solid #27272a;border-radius:12px;background:#18181b;overflow:hidden}",
        ".sa-stopwatch .lapshead{flex:none;display:flex;align-items:center;padding:7px 12px;border-bottom:1px solid #27272a;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:.8px}",
        ".sa-stopwatch .lapshead .clr{margin-left:auto;min-height:22px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:#71717a;font:inherit;font-size:11px;cursor:pointer}",
        ".sa-stopwatch .lapshead .clr:hover{color:#f43f5e;background:#f43f5e1a}",
        ".sa-stopwatch .lapshead .clr:focus-visible{outline:2px solid var(--acc);outline-offset:1px}",
        ".sa-stopwatch .laps{flex:1;min-height:0;overflow:auto}",
        ".sa-stopwatch .lap{display:flex;align-items:center;gap:10px;padding:7px 12px;border-bottom:1px solid #1e1e22;font-variant-numeric:tabular-nums}",
        ".sa-stopwatch .lap:last-child{border-bottom:0}",
        ".sa-stopwatch .lap .n{flex:none;width:52px;color:#71717a;font-size:12px}",
        ".sa-stopwatch .lap .sp{flex:1;text-align:right;font:12.5px ui-monospace,Menlo,Consolas,monospace;color:#e4e4e7;white-space:nowrap}",
        ".sa-stopwatch .lap .tt{flex:none;width:96px;text-align:right;font:12.5px ui-monospace,Menlo,Consolas,monospace;color:#71717a;white-space:nowrap}",
        ".sa-stopwatch .lap .tag{flex:none;font-size:9.5px;letter-spacing:.5px;border-radius:5px;padding:1px 5px;text-transform:uppercase}",
        ".sa-stopwatch .lap.best .sp{color:#34d399}",
        ".sa-stopwatch .lap.best .tag{background:#34d3991a;color:#34d399}",
        ".sa-stopwatch .lap.worst .sp{color:#f43f5e}",
        ".sa-stopwatch .lap.worst .tag{background:#f43f5e1a;color:#f43f5e}",
        ".sa-stopwatch .empty{padding:18px 12px;text-align:center;color:#71717a;font-size:12px}",
        ".sa-stopwatch .khint{flex:none;font-size:10.5px;color:#52525b;letter-spacing:.3px}",
        ".sa-stopwatch kbd{font:10px ui-monospace,monospace;background:#1f1f23;border:1px solid #3f3f46;border-radius:4px;padding:1px 4px;color:#a1a1aa}",
        ".sa-stopwatch .ringwrap{position:relative;width:190px;height:190px;flex:none;display:flex;align-items:center;justify-content:center}",
        ".sa-stopwatch .ringwrap svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)}",
        ".sa-stopwatch .ringwrap .track{fill:none;stroke:#27272a;stroke-width:9}",
        ".sa-stopwatch .ringwrap .prog{fill:none;stroke:var(--acc);stroke-width:9;stroke-linecap:round;transition:stroke .2s}",
        ".sa-stopwatch .ringwrap.done .prog{stroke:#f43f5e;animation:sa-stopwatch-pulse 1s ease-in-out infinite}",
        "@keyframes sa-stopwatch-pulse{0%,100%{stroke-opacity:1}50%{stroke-opacity:.35}}",
        ".sa-stopwatch .ringwrap .big{position:relative;font-size:44px}",
        ".sa-stopwatch .presets{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}",
        ".sa-stopwatch .chip{min-height:30px;padding:0 12px;border-radius:999px;border:1px solid #27272a;background:#18181b;color:#a1a1aa;font:inherit;font-size:12px;cursor:pointer}",
        ".sa-stopwatch .chip:hover{border-color:#3f3f46;color:#e4e4e7}",
        ".sa-stopwatch .chip.on{border-color:var(--acc);color:var(--acc);background:var(--accd)}",
        ".sa-stopwatch .chip:focus-visible{outline:2px solid var(--acc);outline-offset:2px}",
        ".sa-stopwatch .chip:disabled{opacity:.4;cursor:default}",
        ".sa-stopwatch .setrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center}",
        ".sa-stopwatch .num{width:64px;min-height:34px;border-radius:10px;border:1px solid #27272a;background:#0e0e11;color:#e4e4e7;padding:0 8px;font:inherit;text-align:center}",
        ".sa-stopwatch .num:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 2px var(--accd)}",
        ".sa-stopwatch .num:disabled{opacity:.5}",
        ".sa-stopwatch .lbl{color:#71717a;font-size:12px}"
      ].join("\n");
      root.appendChild(css);

      var wrap = document.createElement("div");
      wrap.className = "sa-stopwatch";
      root.appendChild(wrap);
      wrap.innerHTML =
        '<div class="tabs"><div class="seg" role="tablist" aria-label="Mode">' +
          '<button type="button" role="tab" data-tab="sw" class="on" aria-selected="true">Stopwatch</button>' +
          '<button type="button" role="tab" data-tab="tm" aria-selected="false">Timer</button>' +
        '</div></div>' +
        '<div class="view" id="vsw">' +
          '<div class="big" id="swtime">00:00.00</div>' +
          '<div class="sub" id="swsub"></div>' +
          '<div class="ctrls">' +
            '<button class="btn" id="swreset" aria-label="Reset stopwatch">Reset</button>' +
            '<button class="btn pri" id="swgo">Start</button>' +
            '<button class="btn" id="swlap" disabled>Lap</button>' +
          '</div>' +
          '<div class="lapsbox">' +
            '<div class="lapshead"><span id="lapcount">Laps</span><button class="clr" id="lapclear" aria-label="Clear laps">clear</button></div>' +
            '<div class="laps" id="laps"><div class="empty">No laps yet \u2014 press <b>Lap</b> while running.</div></div>' +
          '</div>' +
          '<div class="khint"><kbd>Space</kbd> start / pause \u00b7 <kbd>L</kbd> lap \u00b7 <kbd>R</kbd> reset</div>' +
        '</div>' +
        '<div class="view" id="vtm" hidden>' +
          '<div class="ringwrap" id="ringwrap">' +
            '<svg viewBox="0 0 190 190" aria-hidden="true"><circle class="track" cx="95" cy="95" r="82"/><circle class="prog" id="prog" cx="95" cy="95" r="82"/></svg>' +
            '<div class="big" id="tmtime">05:00</div>' +
          '</div>' +
          '<div class="presets" id="presets">' +
            '<button class="chip" data-min="1">1m</button><button class="chip" data-min="3">3m</button>' +
            '<button class="chip on" data-min="5">5m</button><button class="chip" data-min="10">10m</button>' +
            '<button class="chip" data-min="25">25m</button>' +
          '</div>' +
          '<div class="setrow">' +
            '<span class="lbl">min</span><input class="num" id="tmin" type="number" min="0" max="999" value="5" aria-label="Minutes">' +
            '<span class="lbl">sec</span><input class="num" id="tsec" type="number" min="0" max="59" value="0" aria-label="Seconds">' +
          '</div>' +
          '<div class="ctrls">' +
            '<button class="btn" id="tmreset">Reset</button>' +
            '<button class="btn pri" id="tmgo">Start</button>' +
            '<button class="btn warn" id="tmoff" hidden>Dismiss alarm</button>' +
          '</div>' +
        '</div>';

      var vsw = wrap.querySelector("#vsw");
      var vtm = wrap.querySelector("#vtm");
      var swtime = wrap.querySelector("#swtime");
      var swsub = wrap.querySelector("#swsub");
      var swgo = wrap.querySelector("#swgo");
      var swlap = wrap.querySelector("#swlap");
      var swreset = wrap.querySelector("#swreset");
      var lapsEl = wrap.querySelector("#laps");
      var lapcount = wrap.querySelector("#lapcount");
      var lapclear = wrap.querySelector("#lapclear");
      var tmtime = wrap.querySelector("#tmtime");
      var tmgo = wrap.querySelector("#tmgo");
      var tmreset = wrap.querySelector("#tmreset");
      var tmoff = wrap.querySelector("#tmoff");
      var prog = wrap.querySelector("#prog");
      var ringwrap = wrap.querySelector("#ringwrap");
      var tmin = wrap.querySelector("#tmin");
      var tsec = wrap.querySelector("#tsec");
      var CIRC = 2 * Math.PI * 82;

      function fmtSW(ms) {
        ms = Math.max(0, ms);
        var h = Math.floor(ms / 3600000);
        var m = Math.floor(ms / 60000) % 60;
        var s = Math.floor(ms / 1000) % 60;
        var cs = Math.floor((ms % 1000) / 10);
        return (h ? h + ":" + pad2(m) : pad2(m)) + ":" + pad2(s) + "." + pad2(cs);
      }
      function fmtTM(ms) {
        ms = Math.max(0, Math.round(ms / 1000) * 1000);
        var m = Math.floor(ms / 60000);
        var s = Math.floor(ms / 1000) % 60;
        return pad2(m) + ":" + pad2(s);
      }

      /* ---- stopwatch ---- */
      function renderSw() {
        var el = swElapsed();
        swtime.textContent = fmtSW(el);
        var lapLine = "";
        if (sw.running) {
          var lastTotal = sw.laps.length ? sw.laps[sw.laps.length - 1].total : 0;
          lapLine = "Lap " + (sw.laps.length + 1) + " \u00b7 " + fmtSW(el - lastTotal);
        } else if (el > 0) {
          lapLine = "paused at " + fmtSW(el);
        }
        swsub.textContent = lapLine;
        swgo.textContent = sw.running ? "Pause" : (el > 0 ? "Resume" : "Start");
        swlap.disabled = !sw.running;
        renderLaps();
      }
      function renderLaps() {
        lapcount.textContent = sw.laps.length ? "Laps (" + sw.laps.length + ")" : "Laps";
        lapclear.style.display = sw.laps.length ? "" : "none";
        if (!sw.laps.length) {
          lapsEl.innerHTML = '<div class="empty">No laps yet \u2014 press <b>Lap</b> while running.</div>';
          return;
        }
        var best = null, worst = null;
        if (sw.laps.length >= 2) {
          best = Infinity; worst = -Infinity;
          sw.laps.forEach(function (l) {
            best = Math.min(best, l.split);
            worst = Math.max(worst, l.split);
          });
          if (best === worst) { best = worst = null; }
        }
        var rows = [];
        for (var i = sw.laps.length - 1; i >= 0; i--) {
          var l = sw.laps[i];
          var cls = "lap";
          var tag = "";
          if (best != null && l.split === best) { cls += " best"; tag = '<span class="tag">best</span>'; }
          else if (worst != null && l.split === worst) { cls += " worst"; tag = '<span class="tag">worst</span>'; }
          rows.push('<div class="' + cls + '"><span class="n">Lap ' + l.n + '</span><span class="sp">' + fmtSW(l.split) + "</span>" + tag + '<span class="tt">' + fmtSW(l.total) + "</span></div>");
        }
        lapsEl.innerHTML = rows.join("");
      }
      function swToggle() {
        if (sw.running) {
          sw.elapsed = swElapsed();
          sw.running = false;
          toast("Paused at " + fmtSW(sw.elapsed), "info");
        } else {
          sw.startedAt = Date.now();
          sw.running = true;
          ensureAC();
        }
        saveSw();
        renderSw();
        ensureLoop();
      }
      function swLap() {
        if (!sw.running) return;
        var total = swElapsed();
        var lastTotal = sw.laps.length ? sw.laps[sw.laps.length - 1].total : 0;
        var split = total - lastTotal;
        sw.laps.push({ n: sw.laps.length + 1, total: total, split: split });
        if (sw.laps.length > 200) sw.laps = sw.laps.slice(-200);
        saveSw();
        renderSw();
        toast("Lap " + sw.laps.length + " \u2014 " + fmtSW(split), "ok");
      }
      function swReset() {
        var had = swElapsed() > 0 || sw.laps.length;
        sw.running = false;
        sw.elapsed = 0;
        sw.startedAt = 0;
        sw.laps = [];
        saveSw();
        renderSw();
        if (had) toast("Stopwatch reset", "info");
      }

      /* ---- timer ---- */
      var alarmDone = false;
      function setTmInputsFromMs(ms) {
        tmin.value = String(Math.floor(ms / 60000));
        tsec.value = String(Math.floor((ms % 60000) / 1000));
      }
      function markPreset(min) {
        wrap.querySelectorAll("#presets .chip").forEach(function (c) {
          c.classList.toggle("on", Number(c.getAttribute("data-min")) === min && tm.total === min * 60000);
        });
      }
      function renderTm() {
        var rem = tmRemaining();
        tmtime.textContent = fmtTM(rem);
        var frac = tm.total > 0 ? rem / tm.total : 0;
        prog.style.strokeDasharray = CIRC.toFixed(2);
        prog.style.strokeDashoffset = (CIRC * (1 - frac)).toFixed(2);
        tmgo.textContent = tm.running ? "Pause" : (rem < tm.total && rem > 0 ? "Resume" : "Start");
        tmgo.disabled = tm.total <= 0;
        tmin.disabled = tm.running;
        tsec.disabled = tm.running;
        var done = alarmDone && !tm.running && rem <= 0;
        ringwrap.classList.toggle("done", done);
        tmoff.hidden = !done;
      }
      function tmToggle() {
        ensureAC();
        if (tm.running) {
          tm.remaining = Math.max(0, tm.endAt - Date.now());
          tm.running = false;
          toast("Timer paused \u2014 " + fmtTM(tm.remaining) + " left", "info");
        } else {
          var rem = tmRemaining();
          if (rem <= 0) rem = tm.total;
          if (rem <= 0) { toast("Set a duration first", "warn"); return; }
          alarmDone = false;
          tm.endAt = Date.now() + rem;
          tm.running = true;
        }
        saveTm();
        renderTm();
        ensureLoop();
      }
      function tmReset() {
        tm.running = false;
        tm.remaining = tm.total;
        alarmDone = false;
        saveTm();
        renderTm();
      }
      function tmFinish() {
        tm.running = false;
        tm.remaining = 0;
        alarmDone = true;
        saveTm();
        renderTm();
        beep();
        toast("Time is up \u2014 " + fmtTM(tm.total) + " elapsed", "warn");
      }
      function setTmMs(ms) {
        if (tm.running) return;
        tm.total = ms;
        tm.remaining = ms;
        alarmDone = false;
        setTmInputsFromMs(ms);
        saveTm();
        renderTm();
      }
      function fromInputs() {
        if (tm.running) return;
        var m = Math.max(0, Math.min(999, parseInt(tmin.value, 10) || 0));
        var s = Math.max(0, Math.min(59, parseInt(tsec.value, 10) || 0));
        var ms = (m * 60 + s) * 1000;
        setTmMs(ms);
        markPreset(m + s / 60);
      }

      /* ---- loop ---- */
      function ensureLoop() {
        if (!raf && (sw.running || tm.running)) raf = requestAnimationFrame(loopStep);
      }
      function loopStep() {
        raf = 0;
        if (sw.running) renderSw();
        if (tm.running) {
          if (tmRemaining() <= 0) { tmFinish(); }
          else renderTm();
        }
        if (sw.running || tm.running) raf = requestAnimationFrame(loopStep);
      }

      /* ---- wiring ---- */
      swgo.addEventListener("click", swToggle);
      swlap.addEventListener("click", swLap);
      swreset.addEventListener("click", swReset);
      lapclear.addEventListener("click", function () {
        sw.laps = [];
        saveSw();
        renderSw();
        toast("Laps cleared", "info");
      });
      tmgo.addEventListener("click", tmToggle);
      tmreset.addEventListener("click", tmReset);
      tmoff.addEventListener("click", function () {
        alarmDone = false;
        renderTm();
        tmreset.focus();
      });
      [tmin, tsec].forEach(function (inp) {
        inp.addEventListener("input", fromInputs);
        inp.addEventListener("keydown", function (e) { e.stopPropagation(); });
      });
      wrap.addEventListener("click", function (e) {
        var tabB = e.target.closest ? e.target.closest("[data-tab]") : null;
        if (tabB) {
          tab = tabB.getAttribute("data-tab");
          vsw.hidden = tab !== "sw";
          vtm.hidden = tab !== "tm";
          wrap.querySelectorAll("[data-tab]").forEach(function (b) {
            var on = b === tabB;
            b.classList.toggle("on", on);
            b.setAttribute("aria-selected", String(on));
          });
          return;
        }
        var chip = e.target.closest ? e.target.closest("[data-min]") : null;
        if (chip) {
          var min = Number(chip.getAttribute("data-min"));
          setTmMs(min * 60000);
          wrap.querySelectorAll("#presets .chip").forEach(function (c) {
            c.classList.toggle("on", c === chip);
          });
        }
      });

      root.addEventListener("keydown", function (e) {
        var t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
        if (e.key === " ") {
          e.preventDefault();
          if (tab === "sw") swToggle(); else tmToggle();
        } else if (e.key === "l" || e.key === "L") {
          e.preventDefault();
          swLap();
        } else if (e.key === "r" || e.key === "R") {
          e.preventDefault();
          if (tab === "sw") swReset(); else tmReset();
        }
      });

      /* init */
      setTmInputsFromMs(tm.total);
      markPreset(Math.round(tm.total / 60000));
      if (tm.running && tmRemaining() <= 0) { tmFinish(); }
      renderSw();
      renderTm();
      ensureLoop();

      return {
        onClose: function () {
          if (raf) { cancelAnimationFrame(raf); raf = 0; }
          if (sw.running) { sw.elapsed = swElapsed(); sw.running = false; sw.startedAt = 0; saveSw(); }
          if (tm.running) { tm.remaining = tmRemaining(); tm.running = false; tm.endAt = 0; saveTm(); }
        }
      };
    }
  };
})();
