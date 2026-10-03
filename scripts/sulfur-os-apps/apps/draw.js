/* Sulfur OS app module — Drawing Pad (ported from the standalone Sulfur OS page) */
(function () {
  "use strict";
  var REG = window.SulfurApps || (window.SulfurApps = {});
  REG["draw"] = {
    id: "draw",
    name: "Drawing Pad",
    desc: "Smooth pen strokes, eraser, undo history and PNG export.",
    icon: "custom:M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
    color: "#f59e0b",
    cat: "creative",
    w: 820, h: 600,
    mount: function (root, ctx) {
      root.style.setProperty("--acc", "#f59e0b");

      var st = document.createElement("style");
      st.textContent = [
        ".sa-draw{position:relative;height:100%;display:flex;flex-direction:column;background:#0c0c0e;color:#e4e4e7;font:13.5px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden}",
        ".sa-draw *{box-sizing:border-box}",
        ".sa-draw :focus-visible{outline:2px solid var(--acc);outline-offset:2px}",
        ".sa-draw .hrow{display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(24,24,27,.92);border-bottom:1px solid #27272a;flex:none;flex-wrap:wrap}",
        ".sa-draw .hrow .name{font-size:14px;font-weight:700;white-space:nowrap}",
        ".sa-draw .spacer{flex:1}",
        ".sa-draw .ibtn{width:40px;height:40px;display:grid;place-items:center;border-radius:8px;background:#202024;border:1px solid #27272a;cursor:pointer;color:#a1a1aa;transition:background .12s,border-color .12s,transform .06s,opacity .12s;font-family:inherit}",
        ".sa-draw .ibtn:hover{background:#26262b;border-color:#3f3f46;color:#e4e4e7}",
        ".sa-draw .ibtn:active{transform:scale(.96)}",
        ".sa-draw .ibtn:disabled{opacity:.35;cursor:not-allowed}",
        ".sa-draw .wrap{flex:1;display:flex;min-height:0;flex-wrap:wrap;overflow:auto}",
        ".sa-draw .side{flex:0 0 210px;max-width:100%;overflow-y:auto;border-right:1px solid #27272a;background:#101012;padding:12px;display:flex;flex-direction:column;gap:14px}",
        ".sa-draw .lbl{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#71717a;margin:0 0 6px;display:block}",
        ".sa-draw .t2{display:grid;grid-template-columns:1fr 1fr;gap:5px}",
        ".sa-draw .t2 button{min-height:44px;border-radius:8px;background:#202024;border:1px solid #27272a;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:10.5px;font-weight:600;color:#a1a1aa;cursor:pointer;transition:background .12s,border-color .12s,color .12s,transform .06s;font-family:inherit}",
        ".sa-draw .t2 button:hover{background:#26262b;color:#e4e4e7}",
        ".sa-draw .t2 button:active{transform:scale(.97)}",
        ".sa-draw .t2 button.on{background:rgba(245,158,11,.14);border-color:rgba(245,158,11,.55);color:var(--acc)}",
        ".sa-draw .pal{display:grid;grid-template-columns:repeat(5,1fr);gap:5px}",
        ".sa-draw .sw{height:36px;border-radius:7px;border:1px solid rgba(255,255,255,.16);cursor:pointer;transition:transform .1s,box-shadow .1s}",
        ".sa-draw .sw:hover{transform:scale(1.09)}",
        ".sa-draw .sw.on{box-shadow:0 0 0 2px #101012,0 0 0 4px var(--acc)}",
        ".sa-draw input[type=color]{-webkit-appearance:none;appearance:none;width:100%;height:40px;border:1px solid #27272a;border-radius:8px;background:#202024;padding:4px;cursor:pointer}",
        ".sa-draw input[type=color]::-webkit-color-swatch-wrapper{padding:0}",
        ".sa-draw input[type=color]::-webkit-color-swatch{border:0;border-radius:5px}",
        ".sa-draw input[type=color]::-moz-color-swatch{border:0;border-radius:5px}",
        ".sa-draw .sizerow{display:flex;align-items:center;justify-content:space-between;margin-bottom:2px}",
        ".sa-draw .sizerow b{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:var(--acc);font-variant-numeric:tabular-nums}",
        ".sa-draw input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:36px;background:transparent;cursor:pointer}",
        ".sa-draw input[type=range]::-webkit-slider-runnable-track{height:6px;border-radius:3px;background:#27272a}",
        ".sa-draw input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;border-radius:50%;background:var(--acc);margin-top:-7px;box-shadow:0 1px 4px rgba(0,0,0,.5)}",
        ".sa-draw input[type=range]::-moz-range-track{height:6px;border-radius:3px;background:#27272a}",
        ".sa-draw input[type=range]::-moz-range-thumb{width:20px;height:20px;border:0;border-radius:50%;background:var(--acc)}",
        ".sa-draw .pv{margin-top:8px;height:56px;border-radius:8px;border:1px dashed #3f3f46;display:grid;place-items:center;background:#141416}",
        ".sa-draw .pv i{display:block;border-radius:50%;background:var(--acc);transition:width .08s,height .08s,background .08s}",
        ".sa-draw .hint{font-size:11px;color:#71717a;line-height:1.6;margin:10px 0 0}",
        ".sa-draw .stage{flex:1 1 260px;min-width:0;min-height:0;display:grid;place-items:center;padding:16px;background:#0b0b0d;position:relative;overflow:auto}",
        ".sa-draw .board{position:relative;max-width:100%;max-height:100%;border:1px solid #27272a;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);overflow:hidden;line-height:0}",
        ".sa-draw canvas{touch-action:none;cursor:crosshair;display:block;max-width:100%;max-height:100%;width:auto;height:auto}",
        ".sa-draw .ghost{position:absolute;border-radius:50%;pointer-events:none;border:1.5px solid rgba(251,191,36,.9);transform:translate(-50%,-50%);display:none;z-index:5}",
        ".sa-draw .cf{position:absolute;inset:0;background:rgba(0,0,0,.62);display:none;align-items:center;justify-content:center;z-index:100;padding:16px}",
        ".sa-draw .cf.show{display:flex}",
        ".sa-draw .cfc{background:#18181b;border:1px solid #27272a;border-radius:12px;padding:20px;max-width:340px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,.4)}",
        ".sa-draw .cfc h3{font-size:15px;font-weight:700;margin:0 0 6px}",
        ".sa-draw .cfc p{font-size:13px;color:#a1a1aa;margin:0 0 18px}",
        ".sa-draw .cf-a{display:flex;gap:10px;justify-content:flex-end}",
        ".sa-draw .btn{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 16px;border-radius:8px;background:#202024;border:1px solid #27272a;color:#e4e4e7;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:background .12s,border-color .12s,transform .06s}",
        ".sa-draw .btn:hover{background:#26262b;border-color:#3f3f46}",
        ".sa-draw .btn:active{transform:scale(.97)}",
        ".sa-draw .btn.amber{background:var(--acc);border-color:transparent;color:#1c1206}",
        ".sa-draw .btn.amber:hover{filter:brightness(1.08)}"
      ].join("\n");
      root.appendChild(st);

      var wrap = document.createElement("div");
      wrap.className = "sa-draw";
      root.appendChild(wrap);
      wrap.innerHTML = [
        '<div class="hrow">',
        '  <span class="name">Drawing Pad</span><span class="spacer"></span>',
        '  <button class="ibtn" data-el="undo" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" disabled><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h6.5a3.5 3.5 0 1 1 0 7H7"/><path d="M6 4 3 7l3 3"/></svg></button>',
        '  <button class="ibtn" data-el="redo" aria-label="Redo (Ctrl+Y)" title="Redo (Ctrl+Y)" disabled><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 7H6.5a3.5 3.5 0 1 0 0 7H9"/><path d="M10 4l3 3-3 3"/></svg></button>',
        '  <button class="ibtn" data-el="png" aria-label="Save PNG" title="Save PNG"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v7M5 7l3 3 3-3"/><path d="M3 11v1.5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V11"/></svg></button>',
        '  <button class="ibtn" data-el="clear" aria-label="Clear drawing" title="Clear drawing"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h11M6 4V2.8c0-.4.4-.8.8-.8h2.4c.4 0 .8.4.8.8V4M4 4l.6 9.2c0 .4.4.8.9.8h5c.5 0 .9-.4.9-.8L12 4"/></svg></button>',
        '</div>',
        '<div class="wrap">',
        '  <aside class="side">',
        '    <div>',
        '      <label class="lbl" id="lbl-tool">Tool</label>',
        '      <div class="t2" role="group" aria-labelledby="lbl-tool">',
        '        <button data-el="brushBtn" class="on" aria-label="Brush"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M11.3 2.2l2.5 2.5-8.7 8.7-3.4 1 1-3.4 8.6-8.8z"/></svg>brush</button>',
        '        <button data-el="eraseBtn" aria-label="Eraser"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2.5 11.5l6.3-8.7 4.9 3.6-6.2 8.6H4.7l-2.2-3.5z"/><path d="M6.2 6.4l4.4 3.2"/></svg>erase</button>',
        '      </div>',
        '    </div>',
        '    <div>',
        '      <label class="lbl" id="lbl-pal">Swatches</label>',
        '      <div class="pal" data-el="pal" role="group" aria-labelledby="lbl-pal"></div>',
        '    </div>',
        '    <div class="sec-col">',
        '      <label class="lbl" for="custom">Custom color</label>',
        '      <input type="color" data-el="custom" value="#f59e0b" aria-label="Custom color">',
        '    </div>',
        '    <div class="sec-col">',
        '      <div class="sizerow"><label class="lbl" for="size" style="margin:0">Brush size</label><b data-el="sizeVal">6 px</b></div>',
        '      <input type="range" data-el="size" min="1" max="40" step="1" value="6" aria-label="Brush size, 1 to 40 pixels">',
        '      <div class="pv" aria-hidden="true"><i data-el="pvd"></i></div>',
        '      <p class="hint">One finger draws on touch. Undo keeps the last 30 strokes.</p>',
        '    </div>',
        '  </aside>',
        '  <main class="stage" data-el="stage">',
        '    <div class="board"><canvas data-el="cv" width="1200" height="800" aria-label="Drawing canvas \u2014 draw here"></canvas></div>',
        '    <div class="ghost" data-el="ghost" aria-hidden="true"></div>',
        '  </main>',
        '</div>',
        '<div class="cf" data-el="confirm" role="dialog" aria-modal="true" aria-labelledby="cfTitle">',
        '  <div class="cfc">',
        '    <h3 data-el="cfTitle">Are you sure?</h3>',
        '    <p data-el="cfMsg"></p>',
        '    <div class="cf-a">',
        '      <button class="btn" data-el="cfNo">Cancel</button>',
        '      <button class="btn amber" data-el="cfOk">Confirm</button>',
        '    </div>',
        '  </div>',
        '</div>'
      ].join("\n");

      var $ = function (name) { return wrap.querySelector('[data-el="' + name + '"]'); };
      var W = 1200, H = 800, BG = "#101014";
      var COLORS = ["#f59e0b", "#fbbf24", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#3b82f6", "#14b8a6", "#22c55e", "#f4f4f5"];

      var timeouts = [];
      function t(fn, ms) { var id = setTimeout(fn, ms); timeouts.push(id); return id; }

      /* ---- confirm (in-app, never native) ---- */
      var cf = $("confirm"), cfRes = null;
      function cfEnd(v) { cf.classList.remove("show"); if (cfRes) { var r = cfRes; cfRes = null; r(v); } }
      $("cfOk").addEventListener("click", function () { cfEnd(true); });
      $("cfNo").addEventListener("click", function () { cfEnd(false); });
      cf.addEventListener("click", function (e) { if (e.target === cf) cfEnd(false); });
      function confirmDlg(title, msg, okLabel) {
        $("cfTitle").textContent = title; $("cfMsg").textContent = msg;
        $("cfOk").textContent = okLabel || "Confirm";
        cf.classList.add("show"); $("cfOk").focus();
        return new Promise(function (res) { cfRes = res; });
      }

      /* ---- state ---- */
      var color = "#f59e0b", brush = 6, mode = "brush";
      var cv = $("cv"), c = cv.getContext("2d");
      var drawing = false, last = null, lastMid = null;
      var undoS = [], redoS = [];
      var ghostEl = $("ghost"), stage = $("stage");

      c.fillStyle = BG; c.fillRect(0, 0, W, H);
      c.lineCap = "round"; c.lineJoin = "round";
      undoS.push(c.getImageData(0, 0, W, H));

      /* ---- palette ---- */
      var palEl = $("pal");
      COLORS.forEach(function (col) {
        var b = document.createElement("button");
        b.className = "sw"; b.style.background = col;
        b.setAttribute("aria-label", col); b.title = col;
        b.addEventListener("click", function () { setColor(col); setMode("brush"); });
        palEl.appendChild(b);
      });
      function setColor(col) {
        color = col;
        Array.prototype.forEach.call(palEl.children, function (el, i) {
          el.classList.toggle("on", COLORS[i] === col && mode === "brush");
        });
        try { $("custom").value = col; } catch (e) {}
        $("pvd").style.background = col;
        ghost();
      }
      function setMode(m) {
        mode = m;
        $("brushBtn").classList.toggle("on", m === "brush");
        $("eraseBtn").classList.toggle("on", m === "eraser");
        cv.style.cursor = m === "eraser" ? "cell" : "crosshair";
        pvd.style.background = m === "eraser" ? "#71717a" : color;
        Array.prototype.forEach.call(palEl.children, function (el, i) {
          el.classList.toggle("on", COLORS[i] === color && m === "brush");
        });
        ghost();
      }
      $("brushBtn").addEventListener("click", function () { setMode("brush"); });
      $("eraseBtn").addEventListener("click", function () { setMode("eraser"); });
      $("custom").addEventListener("input", function (e) { setColor(e.target.value); setMode("brush"); });

      /* ---- brush size ---- */
      var pvd = $("pvd");
      function applySize(v) {
        brush = v; $("sizeVal").textContent = v + " px";
        pvd.style.width = v + "px"; pvd.style.height = v + "px";
        pvd.style.background = mode === "eraser" ? "#71717a" : color;
        ghost();
      }
      $("size").addEventListener("input", function (e) { applySize(parseInt(e.target.value, 10) || 1); });
      applySize(6);

      /* ---- drawing ---- */
      function pos(e) {
        var r = cv.getBoundingClientRect();
        return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
      }
      function begin(p) {
        drawing = true; last = p; lastMid = p;
        c.strokeStyle = mode === "eraser" ? BG : color;
        c.fillStyle = c.strokeStyle;
        c.lineWidth = brush;
        c.beginPath(); c.arc(p.x, p.y, brush / 2, 0, Math.PI * 2); c.fill();
      }
      function extend(p) {
        if (!drawing) return;
        var mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
        c.beginPath();
        c.moveTo(lastMid.x, lastMid.y);
        c.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
        c.stroke();
        last = p; lastMid = mid;
      }
      function endStroke() {
        if (!drawing) return;
        drawing = false; last = null; lastMid = null;
        try { undoS.push(c.getImageData(0, 0, W, H)); } catch (e) {}
        if (undoS.length > 31) undoS.shift();
        redoS.length = 0; syncHist();
      }
      cv.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        try { cv.setPointerCapture(e.pointerId); } catch (err) {}
        begin(pos(e));
      });
      cv.addEventListener("pointermove", function (e) { extend(pos(e)); ghostMove(e); });
      cv.addEventListener("pointerup", endStroke);
      cv.addEventListener("pointercancel", endStroke);

      /* ---- ghost cursor preview ---- */
      function ghost() {
        if (mode === "eraser") { ghostEl.style.background = "rgba(161,161,170,.15)"; ghostEl.style.borderColor = "rgba(251,191,36,.9)"; }
        else { ghostEl.style.background = color; ghostEl.style.borderColor = "rgba(255,255,255,.55)"; }
      }
      function ghostMove(e) {
        var r = cv.getBoundingClientRect(), sr = stage.getBoundingClientRect();
        var k = r.width / W;
        var d = Math.max(3, brush * k);
        ghostEl.style.width = d + "px"; ghostEl.style.height = d + "px";
        ghostEl.style.left = (e.clientX - sr.left + stage.scrollLeft) + "px";
        ghostEl.style.top = (e.clientY - sr.top + stage.scrollTop) + "px";
        ghostEl.style.display = "block";
      }
      cv.addEventListener("pointerenter", function () { ghost(); });
      cv.addEventListener("pointerleave", function () { ghostEl.style.display = "none"; });

      /* ---- history ---- */
      function undo() {
        if (undoS.length < 2) return;
        redoS.push(undoS.pop());
        c.putImageData(undoS[undoS.length - 1], 0, 0);
        syncHist();
      }
      function redo() {
        if (!redoS.length) return;
        var snap = redoS.pop();
        undoS.push(snap);
        c.putImageData(snap, 0, 0);
        syncHist();
      }
      function syncHist() {
        $("undo").disabled = undoS.length < 2;
        $("redo").disabled = !redoS.length;
      }
      $("undo").addEventListener("click", undo);
      $("redo").addEventListener("click", redo);
      syncHist();

      /* ---- clear / save ---- */
      function wipe() {
        c.fillStyle = BG; c.fillRect(0, 0, W, H);
        try { undoS.push(c.getImageData(0, 0, W, H)); } catch (e) {}
        if (undoS.length > 31) undoS.shift();
        redoS.length = 0; syncHist();
      }
      $("clear").addEventListener("click", function () {
        confirmDlg("Clear drawing?", "The whole canvas goes back to blank. Undo can bring it back.", "Clear").then(function (ok) {
          if (!ok) return;
          wipe(); ctx.toast("Canvas cleared", "info");
        });
      });
      $("png").addEventListener("click", function () {
        try {
          var a = document.createElement("a");
          a.href = cv.toDataURL("image/png");
          a.download = "sulfur-drawing.png";
          root.appendChild(a); a.click(); a.remove();
          ctx.toast("PNG saved", "ok");
        } catch (err) { ctx.toast("Save failed", "warn"); }
      });

      /* ---- keyboard on root ---- */
      root.addEventListener("keydown", function (e) {
        if (cf.classList.contains("show")) { if (e.key === "Escape") cfEnd(false); return; }
        var tgt = e.target;
        if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT")) return;
        if (e.ctrlKey || e.metaKey) {
          var k = e.key.toLowerCase();
          if (k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
          else if (k === "y") { e.preventDefault(); redo(); }
        }
      });

      setColor("#f59e0b"); setMode("brush");
      try { root.focus({ preventScroll: true }); } catch (e) { root.focus(); }

      return {
        onClose: function () {
          for (var i = 0; i < timeouts.length; i++) clearTimeout(timeouts[i]);
          timeouts.length = 0;
          if (cfRes) { var r = cfRes; cfRes = null; r(false); }
        }
      };
    }
  };
})();
