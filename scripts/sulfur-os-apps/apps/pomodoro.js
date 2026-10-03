/* Sulfur OS app module — Pomodoro (ported from the standalone Sulfur OS page) */
(function () {
  "use strict";
  var REG = window.SulfurApps || (window.SulfurApps = {});
  REG["pomodoro"] = {
    id: "pomodoro",
    name: "Pomodoro",
    desc: "Focus timer, stopwatch, session dots and a WebAudio chime.",
    icon: "clock",
    color: "#f59e0b",
    cat: "tool",
    w: 480, h: 640,
    mount: function (root, ctx) {
      root.style.setProperty("--acc", "#f59e0b");

      var st = document.createElement("style");
      st.textContent = [
        ".sa-pomodoro{height:100%;overflow-y:auto;background:#0c0c0e;color:#e4e4e7;font:13.5px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}",
        ".sa-pomodoro *{box-sizing:border-box}",
        ".sa-pomodoro :focus-visible{outline:2px solid var(--acc);outline-offset:2px}",
        ".sa-pomodoro main{display:flex;flex-direction:column;align-items:center;padding:16px 14px 26px;gap:16px}",
        ".sa-pomodoro .tabs{display:flex;gap:5px;background:#131316;border:1px solid #27272a;padding:5px;border-radius:12px}",
        ".sa-pomodoro .tabs button{min-height:38px;padding:0 20px;border:0;border-radius:8px;font-size:13px;font-weight:600;color:#a1a1aa;background:none;cursor:pointer;font-family:inherit;transition:background .12s,color .12s,transform .06s}",
        ".sa-pomodoro .tabs button:hover{color:#e4e4e7}",
        ".sa-pomodoro .tabs button:active{transform:scale(.97)}",
        ".sa-pomodoro .tabs button.on{background:rgba(245,158,11,.14);color:var(--acc);box-shadow:inset 0 0 0 1px rgba(245,158,11,.4)}",
        ".sa-pomodoro .view{display:none;width:100%;max-width:420px;flex-direction:column;align-items:center;gap:18px}",
        ".sa-pomodoro .view.on{display:flex}",
        ".sa-pomodoro .ringbox{position:relative;width:min(240px,72vw);aspect-ratio:1}",
        ".sa-pomodoro .ringbox svg{width:100%;height:100%;transform:rotate(-90deg)}",
        ".sa-pomodoro .track{fill:none;stroke:#27272a;stroke-width:10}",
        ".sa-pomodoro .prog{fill:none;stroke:var(--acc);stroke-width:10;stroke-linecap:round;transition:stroke-dashoffset .25s linear}",
        ".sa-pomodoro .ringtxt{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}",
        ".sa-pomodoro .clock{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:clamp(36px,11vw,50px);font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:.01em}",
        ".sa-pomodoro .phase{font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--acc)}",
        ".sa-pomodoro .dots{display:flex;gap:7px}",
        ".sa-pomodoro .dots i{width:10px;height:10px;border-radius:50%;background:#27272a;transition:background .2s,box-shadow .2s}",
        ".sa-pomodoro .dots i.on{background:var(--acc);box-shadow:0 0 8px rgba(245,158,11,.7)}",
        ".sa-pomodoro .ctrls{display:flex;gap:10px}",
        ".sa-pomodoro .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 22px;border-radius:8px;background:#202024;border:1px solid #27272a;color:#e4e4e7;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;transition:background .12s,border-color .12s,transform .06s}",
        ".sa-pomodoro .btn:hover{background:#26262b;border-color:#3f3f46}",
        ".sa-pomodoro .btn:active{transform:scale(.97)}",
        ".sa-pomodoro .btn.amber{background:var(--acc);border-color:transparent;color:#1c1206}",
        ".sa-pomodoro .btn.amber:hover{filter:brightness(1.08)}",
        ".sa-pomodoro .btn:disabled{opacity:.4;cursor:not-allowed}",
        ".sa-pomodoro .card{width:100%;background:#18181b;border:1px solid #27272a;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);padding:16px 18px}",
        ".sa-pomodoro .card h2{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#71717a;margin:0 0 12px}",
        ".sa-pomodoro .strow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0}",
        ".sa-pomodoro .strow+.strow{border-top:1px solid #202024}",
        ".sa-pomodoro .strow .lab{font-size:13.5px;color:#a1a1aa}",
        ".sa-pomodoro .strow .sub{display:block;font-size:11px;color:#71717a}",
        ".sa-pomodoro .stp{display:flex;align-items:center;gap:10px}",
        ".sa-pomodoro .stp button{width:40px;height:40px;border-radius:8px;background:#202024;border:1px solid #27272a;display:grid;place-items:center;font-size:19px;color:#a1a1aa;cursor:pointer;font-family:inherit;transition:background .12s,border-color .12s,color .12s,transform .06s}",
        ".sa-pomodoro .stp button:hover{background:#26262b;color:#e4e4e7;border-color:#3f3f46}",
        ".sa-pomodoro .stp button:active{transform:scale(.94)}",
        ".sa-pomodoro .stp b{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:19px;font-weight:700;color:var(--acc);min-width:34px;text-align:center;font-variant-numeric:tabular-nums}",
        ".sa-pomodoro .stp span{font-size:11px;color:#71717a}",
        ".sa-pomodoro .stat{width:100%;text-align:center;font-size:12.5px;color:#71717a;margin:0}",
        ".sa-pomodoro .stat b{color:var(--acc);font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700}",
        ".sa-pomodoro .note{font-size:11.5px;color:#71717a;text-align:center;line-height:1.6;margin:10px 0 0}",
        ".sa-pomodoro .swlaps{width:100%;max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:6px}",
        ".sa-pomodoro .lap{display:grid;grid-template-columns:56px 1fr 1fr;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;font-variant-numeric:tabular-nums;padding:9px 13px;border-radius:8px;background:#141417;border:1px solid #202024;color:#a1a1aa}",
        ".sa-pomodoro .lap .n{color:#71717a}",
        ".sa-pomodoro .lap .tot{color:#e4e4e7}",
        ".sa-pomodoro .laps-empty{text-align:center;color:#71717a;font-size:12.5px;padding:18px 0 6px;margin:0}",
        ".sa-pomodoro .ibtn{width:40px;height:40px;display:grid;place-items:center;border-radius:8px;background:#202024;border:1px solid #27272a;cursor:pointer;color:#a1a1aa;transition:background .12s,border-color .12s,transform .06s;font-family:inherit}",
        ".sa-pomodoro .ibtn:hover{background:#26262b;border-color:#3f3f46;color:#e4e4e7}",
        ".sa-pomodoro .ibtn:active{transform:scale(.96)}",
        ".sa-pomodoro .ibtn.on{background:rgba(245,158,11,.14);border-color:rgba(245,158,11,.5);color:var(--acc)}",
        ".sa-pomodoro .toprow{width:100%;max-width:420px;display:flex;align-items:center;gap:8px}",
        ".sa-pomodoro .toprow .name{font-size:14px;font-weight:700}",
        ".sa-pomodoro .spacer{flex:1}"
      ].join("\n");
      root.appendChild(st);

      var wrap = document.createElement("div");
      wrap.className = "sa-pomodoro";
      root.appendChild(wrap);
      wrap.innerHTML = [
        '<main>',
        '  <div class="toprow">',
        '    <span class="name">Pomodoro</span><span class="spacer"></span>',
        '    <button class="ibtn" data-el="mute" aria-label="Mute chime" title="Mute chime" aria-pressed="false">',
        '      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6v4h2.4L8.5 13V3L4.9 6H2.5z"/><path data-el="sndOn" d="M10.5 5.5a4 4 0 0 1 0 5M12.3 3.8a6.5 6.5 0 0 1 0 8.4"/><path data-el="sndOff" d="M10.5 6l4 4M14.5 6l-4 4" style="display:none"/></svg>',
        '    </button>',
        '  </div>',
        '  <div class="tabs" role="tablist" aria-label="Mode">',
        '    <button data-el="tabTimer" class="on" role="tab" aria-selected="true" aria-controls="viewTimer">Timer</button>',
        '    <button data-el="tabStop" role="tab" aria-selected="false" aria-controls="viewStop">Stopwatch</button>',
        '  </div>',
        '  <section class="view on" data-el="viewTimer" role="tabpanel" aria-label="Pomodoro timer">',
        '    <div class="ringbox">',
        '      <svg viewBox="0 0 240 240" aria-hidden="true">',
        '        <circle class="track" cx="120" cy="120" r="104"/>',
        '        <circle class="prog" data-el="prog" cx="120" cy="120" r="104"/>',
        '      </svg>',
        '      <div class="ringtxt">',
        '        <div class="clock" data-el="clock" aria-live="off">25:00</div>',
        '        <div class="phase" data-el="phaseLbl">Focus</div>',
        '        <div class="dots" data-el="dots" aria-label="Sessions this cycle"><i></i><i></i><i></i><i></i></div>',
        '      </div>',
        '    </div>',
        '    <div class="ctrls">',
        '      <button class="btn" data-el="reset">Reset</button>',
        '      <button class="btn amber" data-el="start" style="min-width:130px">Start</button>',
        '    </div>',
        '    <div class="card">',
        '      <h2>Settings</h2>',
        '      <div class="strow">',
        '        <span class="lab">Focus<span class="sub">5 \u2013 60 min</span></span>',
        '        <div class="stp">',
        '          <button data-k="focus" data-d="-1" aria-label="Less focus minutes">\u2212</button>',
        '          <b data-el="fVal">25</b><span>min</span>',
        '          <button data-k="focus" data-d="1" aria-label="More focus minutes">+</button>',
        '        </div>',
        '      </div>',
        '      <div class="strow">',
        '        <span class="lab">Break<span class="sub">1 \u2013 30 min</span></span>',
        '        <div class="stp">',
        '          <button data-k="break" data-d="-1" aria-label="Less break minutes">\u2212</button>',
        '          <b data-el="bVal">5</b><span>min</span>',
        '          <button data-k="break" data-d="1" aria-label="More break minutes">+</button>',
        '        </div>',
        '      </div>',
        '      <p class="note">Long break of <b data-el="longVal">15</b> min lands after every 4th focus session.</p>',
        '    </div>',
        '    <p class="stat"><b data-el="done">0</b> focus sessions completed today</p>',
        '  </section>',
        '  <section class="view" data-el="viewStop" role="tabpanel" aria-label="Stopwatch">',
        '    <div class="ringbox" style="display:grid;place-items:center">',
        '      <div class="clock" data-el="swClock" style="font-size:clamp(38px,12vw,54px)">00:00<span style="opacity:.55">.00</span></div>',
        '    </div>',
        '    <div class="ctrls">',
        '      <button class="btn" data-el="swLap" disabled>Lap</button>',
        '      <button class="btn amber" data-el="swStart" style="min-width:130px">Start</button>',
        '      <button class="btn" data-el="swReset">Reset</button>',
        '    </div>',
        '    <div class="swlaps" data-el="laps" aria-label="Laps">',
        '      <p class="laps-empty">No laps yet \u2014 hit Lap while the stopwatch runs.</p>',
        '    </div>',
        '  </section>',
        '</main>'
      ].join("\n");

      var $ = function (name) { return wrap.querySelector('[data-el="' + name + '"]'); };

      /* ---- settings / persisted state ---- */
      var set = { focus: 25, brk: 5, mute: false, done: 0, doneDay: "" };
      try {
        var raw = ctx.storage.get("settings", "");
        if (raw) {
          var d = JSON.parse(raw);
          if (d && typeof d === "object") {
            if (d.focus >= 5 && d.focus <= 60) set.focus = d.focus;
            if (typeof d.break === "number" && d.break >= 1 && d.break <= 30) set.brk = d.break;
            if (typeof d.mute === "boolean") set.mute = d.mute;
            if (typeof d.done === "number") set.done = d.done;
            if (typeof d.doneDay === "string") set.doneDay = d.doneDay;
          }
        }
      } catch (e) {}
      function today() { try { return new Date().toISOString().slice(0, 10); } catch (e) { return ""; } }
      if (set.doneDay !== today()) { set.done = 0; set.doneDay = today(); }
      function persist() {
        ctx.storage.set("settings", JSON.stringify({ focus: set.focus, break: set.brk, mute: set.mute, done: set.done, doneDay: set.doneDay }));
      }

      /* ---- chime (web audio, muted toggle, fully guarded) ---- */
      var actx = null;
      function chime() {
        if (set.mute) return;
        try {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          if (!actx) actx = new AC();
          if (actx.state === "suspended" && actx.resume) actx.resume();
          var t0 = actx.currentTime, notes = [880, 1174.7, 1568];
          for (var i = 0; i < notes.length; i++) {
            var o = actx.createOscillator(), g = actx.createGain();
            o.type = "sine"; o.frequency.value = notes[i];
            var tt = t0 + i * 0.18;
            g.gain.setValueAtTime(0.0001, tt);
            g.gain.exponentialRampToValueAtTime(0.16, tt + 0.03);
            g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.55);
            o.connect(g); g.connect(actx.destination);
            o.start(tt); o.stop(tt + 0.65);
          }
        } catch (e) {}
      }
      var muteBtn = $("mute");
      function paintMute() {
        muteBtn.classList.toggle("on", !set.mute);
        muteBtn.setAttribute("aria-pressed", String(!set.mute));
        muteBtn.setAttribute("aria-label", set.mute ? "Unmute chime" : "Mute chime");
        $("sndOn").style.display = set.mute ? "none" : "";
        $("sndOff").style.display = set.mute ? "" : "none";
      }
      muteBtn.addEventListener("click", function () {
        set.mute = !set.mute; persist(); paintMute();
        ctx.toast(set.mute ? "Chime muted" : "Chime on", "info");
      });

      /* ---- tabs ---- */
      var mode = "timer";
      function setMode(m) {
        mode = m;
        $("tabTimer").classList.toggle("on", m === "timer");
        $("tabStop").classList.toggle("on", m === "stop");
        $("tabTimer").setAttribute("aria-selected", String(m === "timer"));
        $("tabStop").setAttribute("aria-selected", String(m === "stop"));
        $("viewTimer").classList.toggle("on", m === "timer");
        $("viewStop").classList.toggle("on", m === "stop");
        paintTitle(); paintSW();
      }
      $("tabTimer").addEventListener("click", function () { setMode("timer"); });
      $("tabStop").addEventListener("click", function () { setMode("stop"); });

      /* ---- timer ---- */
      var T = { phase: "focus", total: 0, remain: 0, running: false, endAt: 0 };
      var R = 104, CIRC = 2 * Math.PI * R;
      function phaseMin(p) { return p === "focus" ? set.focus : (p === "short" ? set.brk : longMin()); }
      function longMin() { return Math.max(1, Math.min(60, set.brk * 3)); }
      function phaseName(p) { return p === "focus" ? "focus" : (p === "short" ? "break" : "long break"); }
      function setPhase(p, run) {
        T.phase = p; T.total = phaseMin(p) * 60000; T.remain = T.total;
        T.running = !!run; T.endAt = Date.now() + T.remain;
        $("phaseLbl").textContent = p === "focus" ? "Focus" : (p === "short" ? "Break" : "Long break");
        paintT();
      }
      function startPause() {
        if (T.running) { T.remain = Math.max(0, T.endAt - Date.now()); T.running = false; paintT(); return; }
        if (T.remain <= 0) T.remain = T.total;
        T.running = true; T.endAt = Date.now() + T.remain;
        paintT();
      }
      $("start").addEventListener("click", startPause);
      $("reset").addEventListener("click", function () { T.running = false; setPhase(T.phase, false); });
      function fmt(ms) {
        var s = Math.max(0, Math.ceil(ms / 1000));
        var m = Math.floor(s / 60);
        return (m < 10 ? "0" : "") + m + ":" + ((s % 60) < 10 ? "0" : "") + (s % 60);
      }
      function paintT() {
        var remain = T.running ? Math.max(0, T.endAt - Date.now()) : T.remain;
        $("clock").textContent = fmt(remain);
        var prog = $("prog");
        prog.setAttribute("stroke-dasharray", CIRC.toFixed(1));
        prog.setAttribute("stroke-dashoffset", (CIRC * (T.total ? remain / T.total : 1)).toFixed(1));
        $("start").textContent = T.running ? "Pause" : (remain < T.total ? "Resume" : "Start");
        var dots = $("dots").children, shown = set.done % 4;
        if (T.phase === "long" && set.done > 0) shown = 4;
        for (var i = 0; i < 4; i++) dots[i].classList.toggle("on", i < shown);
        $("done").textContent = set.done;
        paintTitle();
      }
      function onPhaseEnd() {
        chime();
        if (T.phase === "focus") {
          set.done++; set.doneDay = today(); persist();
          var next = (set.done % 4 === 0) ? "long" : "short";
          setPhase(next, true);
          ctx.toast(next === "long" ? "Focus complete \u2014 long break time" : "Focus complete \u2014 take a break", "ok");
        } else {
          setPhase("focus", true);
          ctx.toast("Break over \u2014 back to focus", "info");
        }
      }
      var timerInt = setInterval(function () {
        if (T.running) {
          if (Date.now() >= T.endAt) { onPhaseEnd(); return; }
          paintT();
        }
      }, 200);

      /* ---- steppers ---- */
      function bump(key, d) {
        var lim = key === "focus" ? [5, 60] : [1, 30];
        var v = set[key] + d;
        if (v < lim[0] || v > lim[1]) return;
        set[key] = v;
        $("fVal").textContent = set.focus;
        $("bVal").textContent = set.brk;
        $("longVal").textContent = longMin();
        persist();
        if (!T.running && ((key === "focus" && T.phase === "focus") || (key === "break" && T.phase !== "focus"))) {
          T.total = phaseMin(T.phase) * 60000; T.remain = T.total; paintT();
        } else if (T.running) ctx.toast("Applies from the next phase", "info");
      }
      Array.prototype.forEach.call(wrap.querySelectorAll(".stp button"), function (b) {
        b.addEventListener("click", function () { bump(b.getAttribute("data-k"), parseInt(b.getAttribute("data-d"), 10)); });
      });

      /* ---- stopwatch ---- */
      var SW = { running: false, t0: 0, acc: 0, laps: [] };
      function swNow() { return SW.acc + (SW.running ? Math.max(0, performance.now() - SW.t0) : 0); }
      function fmtSW(ms) {
        var t = Math.floor(ms), cs = Math.floor((t % 1000) / 10);
        var s = Math.floor(t / 1000) % 60, m = Math.floor(t / 60000);
        function p2(n) { return (n < 10 ? "0" : "") + n; }
        return p2(m) + ":" + p2(s) + "." + (cs < 10 ? "0" : "") + cs;
      }
      function paintSW() {
        var clockEl = $("swClock");
        clockEl.textContent = "";
        var txt = fmtSW(swNow());
        var a = document.createElement("span"); a.textContent = txt.slice(0, 5);
        var b = document.createElement("span"); b.style.opacity = ".55"; b.textContent = txt.slice(5);
        clockEl.appendChild(a); clockEl.appendChild(b);
        $("swStart").textContent = SW.running ? "Stop" : (SW.acc > 0 ? "Resume" : "Start");
        $("swLap").disabled = !SW.running;
        $("swReset").disabled = SW.running;
      }
      $("swStart").addEventListener("click", function () {
        if (SW.running) { SW.acc = swNow(); SW.running = false; }
        else { SW.running = true; SW.t0 = performance.now(); }
        paintSW(); paintTitle();
      });
      $("swLap").addEventListener("click", function () {
        if (!SW.running) return;
        SW.laps.unshift(swNow());
        if (SW.laps.length > 200) SW.laps.pop();
        renderLaps();
      });
      $("swReset").addEventListener("click", function () {
        SW.running = false; SW.acc = 0; SW.laps = [];
        renderLaps(); paintSW(); paintTitle();
      });
      function renderLaps() {
        var box = $("laps");
        box.innerHTML = "";
        if (!SW.laps.length) {
          var p = document.createElement("p");
          p.className = "laps-empty";
          p.textContent = "No laps yet \u2014 hit Lap while the stopwatch runs.";
          box.appendChild(p); return;
        }
        SW.laps.forEach(function (t, i) {
          var n = SW.laps.length - i;
          var split = t - (SW.laps[i + 1] || 0);
          var row = document.createElement("div");
          row.className = "lap";
          var c1 = document.createElement("span"); c1.className = "n"; c1.textContent = "LAP " + (n < 10 ? "0" : "") + n;
          var c2 = document.createElement("span"); c2.className = "s"; c2.textContent = fmtSW(split);
          var c3 = document.createElement("span"); c3.className = "tot"; c3.textContent = fmtSW(t);
          row.appendChild(c1); row.appendChild(c2); row.appendChild(c3);
          box.appendChild(row);
        });
      }

      /* ---- window title tick (OS-level, not document.title) ---- */
      function paintTitle() {
        var t = "Pomodoro";
        if (mode === "timer") {
          var remain = T.running ? Math.max(0, T.endAt - Date.now()) : T.remain;
          if (T.running || remain < T.total) t = fmt(remain) + " \u00B7 " + phaseName(T.phase);
        } else if (SW.running) t = fmtSW(swNow()).slice(0, 8) + " \u00B7 stopwatch";
        try { ctx.setTitle(t); } catch (e) {}
      }

      /* ---- init ---- */
      $("fVal").textContent = set.focus;
      $("bVal").textContent = set.brk;
      $("longVal").textContent = longMin();
      paintMute();
      setPhase("focus", false);
      paintSW();
      renderLaps();
      var swInt = setInterval(function () { if (mode === "stop" && SW.running) { paintSW(); paintTitle(); } }, 53);
      try { root.focus({ preventScroll: true }); } catch (e) { root.focus(); }

      return {
        onClose: function () {
          clearInterval(timerInt);
          clearInterval(swInt);
          try { if (actx && actx.close) actx.close(); } catch (e) {}
        }
      };
    }
  };
})();
