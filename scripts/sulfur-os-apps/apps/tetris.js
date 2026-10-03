/* Sulfur OS app module — Tetris (ported from the standalone Sulfur OS page) */
(function () {
  "use strict";
  var REG = window.SulfurApps || (window.SulfurApps = {});
  REG["tetris"] = {
    id: "tetris",
    name: "Tetris",
    desc: "Stack, clear and speed-run the classic falling-block well.",
    icon: "gamepad",
    color: "#f59e0b",
    cat: "game",
    w: 600, h: 640,
    mount: function (root, ctx) {
      root.style.setProperty("--acc", "#f59e0b");

      var st = document.createElement("style");
      st.textContent = [
        ".sa-tetris{position:relative;height:100%;display:flex;flex-direction:column;align-items:center;gap:10px;padding:12px 12px 14px;overflow:auto;background:#0c0c0e;color:#e4e4e7;font:13.5px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}",
        ".sa-tetris *{box-sizing:border-box}",
        ".sa-tetris .app{width:100%;max-width:470px;display:flex;flex-direction:column;gap:10px;min-width:0}",
        ".sa-tetris .hrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
        ".sa-tetris .hrow .name{font-size:15px;font-weight:700;letter-spacing:.01em}",
        ".sa-tetris .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
        ".sa-tetris .spacer{flex:1}",
        ".sa-tetris .btn{min-height:36px;min-width:36px;padding:0 14px;border-radius:8px;border:1px solid #27272a;background:#18181b;color:#e4e4e7;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px;transition:background .15s,border-color .15s,transform .06s}",
        ".sa-tetris .btn:hover{background:#202024;border-color:#3f3f46}",
        ".sa-tetris .btn:active{transform:scale(.98)}",
        ".sa-tetris .btn:focus-visible{outline:2px solid var(--acc);outline-offset:2px}",
        ".sa-tetris .btn.primary{background:var(--acc);border-color:var(--acc);color:#1c1917}",
        ".sa-tetris .btn.primary:hover{filter:brightness(1.08)}",
        ".sa-tetris .btn.sq{width:36px;padding:0;font-size:15px}",
        ".sa-tetris .row{display:flex;gap:12px;align-items:flex-start;justify-content:center;flex-wrap:wrap}",
        ".sa-tetris .panel{position:relative;background:#18181b;border:1px solid #27272a;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);padding:8px}",
        ".sa-tetris .board{display:block;width:240px;max-width:100%;height:auto;border-radius:8px;background:#0d0c0a}",
        ".sa-tetris .side{display:flex;flex-direction:column;gap:8px;width:152px}",
        ".sa-tetris .sgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}",
        ".sa-tetris .stat{display:flex;flex-direction:column;align-items:center;background:#18181b;border:1px solid #27272a;border-radius:12px;padding:5px 4px;min-height:46px;justify-content:center}",
        ".sa-tetris .stat .label{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#a1a1aa;font-weight:600}",
        ".sa-tetris .stat .value{font-size:14px;font-weight:700;color:var(--acc);line-height:1.25}",
        ".sa-tetris .stat.plain .value{color:#e4e4e7}",
        ".sa-tetris .prev{display:flex;flex-direction:column;align-items:center;gap:4px;background:#18181b;border:1px solid #27272a;border-radius:12px;padding:8px 8px 6px}",
        ".sa-tetris .prev .label{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#a1a1aa;font-weight:600}",
        ".sa-tetris .prev canvas{display:block}",
        ".sa-tetris .hint{font-size:12px;color:#a1a1aa;margin:0;text-align:center;line-height:1.5}",
        ".sa-tetris .hint b{color:var(--acc)}",
        ".sa-tetris .overlay{position:absolute;inset:0;border-radius:12px;background:rgba(9,9,11,.85);display:flex;align-items:center;justify-content:center;z-index:12;opacity:0;pointer-events:none;transition:opacity .25s}",
        ".sa-tetris .overlay.show{opacity:1;pointer-events:auto}",
        ".sa-tetris .ov-card{text-align:center;padding:14px;max-width:230px;margin:0 auto}",
        ".sa-tetris .ov-title{margin:0;font-size:21px;font-weight:800}",
        ".sa-tetris .ov-title.lose{color:#fb7185}",
        ".sa-tetris .ov-title.pause{color:#e4e4e7}",
        ".sa-tetris .ov-sub{margin:6px 0 12px;font-size:12px;color:#a1a1aa}",
        ".sa-tetris .ov-sub b{color:#fbbf24}",
        ".sa-tetris .ov-stats{display:flex;flex-direction:column;gap:2px;margin:0 0 14px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
        ".sa-tetris .ov-stats div{display:flex;justify-content:space-between;gap:16px;font-size:12px}",
        ".sa-tetris .ov-stats span{color:#a1a1aa}",
        ".sa-tetris .ov-stats b{color:var(--acc)}",
        ".sa-tetris .pads{display:none;grid-template-columns:repeat(3,1fr);gap:8px;margin:2px auto 0;width:100%;max-width:260px}",
        ".sa-tetris.touch .pads{display:grid}",
        ".sa-tetris .pads .btn{min-height:48px;font-size:18px}",
        ".sa-tetris .pads .btn small{font-size:10px;font-weight:700;letter-spacing:.08em}",
        ".sa-tetris .modal{position:absolute;inset:0;background:rgba(0,0,0,.65);display:none;align-items:center;justify-content:center;z-index:60;padding:16px}",
        ".sa-tetris .modal.open{display:flex}",
        ".sa-tetris .modal .card{background:#18181b;border:1px solid #27272a;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);max-width:410px;width:100%;padding:18px}",
        ".sa-tetris .modal-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}",
        ".sa-tetris .modal-head h2{margin:0;font-size:15px;font-weight:700;flex:1}",
        ".sa-tetris .help-list{margin:0;padding-left:18px;font-size:13px;color:#d4d4d8;line-height:1.65}",
        ".sa-tetris .help-list b{color:var(--acc);font-weight:600}"
      ].join("\n");
      root.appendChild(st);

      var wrap = document.createElement("div");
      wrap.className = "sa-tetris";
      root.appendChild(wrap);
      wrap.innerHTML = [
        '<div class="app">',
        '  <div class="hrow">',
        '    <span class="name">Tetris</span><span class="spacer"></span>',
        '    <button class="btn sq" data-el="btnPause" aria-label="Pause or resume">\u23F8</button>',
        '    <button class="btn sq" data-el="btnHelp" aria-label="How to play">?</button>',
        '    <button class="btn" data-el="btnRestart">Restart</button>',
        '  </div>',
        '  <div class="row">',
        '    <div class="panel">',
        '      <canvas class="board" data-el="board" width="240" height="480" role="img" aria-label="Tetris well, 10 by 20."></canvas>',
        '      <div class="overlay" data-el="pauseOv">',
        '        <div class="ov-card">',
        '          <p class="ov-title pause">Paused</p>',
        '          <p class="ov-sub">Press <b>P</b> to resume</p>',
        '          <button class="btn primary" data-el="btnResume">Resume</button>',
        '        </div>',
        '      </div>',
        '      <div class="overlay" data-el="endOv">',
        '        <div class="ov-card">',
        '          <p class="ov-title lose">Stack overflow</p>',
        '          <p class="ov-sub">The well filled up.</p>',
        '          <div class="ov-stats" data-el="endStats"></div>',
        '          <button class="btn primary" data-el="btnAgain">Play again</button>',
        '        </div>',
        '      </div>',
        '    </div>',
        '    <div class="side">',
        '      <div class="sgrid">',
        '        <div class="stat"><span class="label">Score</span><span class="value mono" data-el="score">0</span></div>',
        '        <div class="stat"><span class="label">Best</span><span class="value mono" data-el="best">0</span></div>',
        '        <div class="stat plain"><span class="label">Lines</span><span class="value mono" data-el="lines">0</span></div>',
        '        <div class="stat plain"><span class="label">Level</span><span class="value mono" data-el="level">1</span></div>',
        '      </div>',
        '      <div class="prev"><span class="label">Next</span><canvas data-el="next" width="84" height="48" aria-label="Next piece preview"></canvas></div>',
        '      <div class="prev"><span class="label">Hold</span><canvas data-el="hold" width="84" height="48" aria-label="Held piece"></canvas></div>',
        '    </div>',
        '  </div>',
        '  <div class="pads" aria-label="Touch controls">',
        '    <button class="btn" data-el="padHold" aria-label="Hold piece"><small>HOLD</small></button>',
        '    <button class="btn" data-el="padRot" aria-label="Rotate">\u27F3</button>',
        '    <button class="btn" data-el="padHard" aria-label="Hard drop"><small>DROP</small></button>',
        '    <button class="btn" data-el="padLeft" aria-label="Move left">\u25C0</button>',
        '    <button class="btn" data-el="padDown" aria-label="Soft drop">\u25BC</button>',
        '    <button class="btn" data-el="padRight" aria-label="Move right">\u25B6</button>',
        '  </div>',
        '  <p class="hint">\u2190\u2192 move \u00B7 \u2193 soft \u00B7 \u2191/X rotate (Z ccw) \u00B7 <b>Space</b> hard drop \u00B7 C hold \u00B7 P pause</p>',
        '</div>',
        '<div class="modal" data-el="helpModal" role="dialog" aria-modal="true" aria-labelledby="helpTitle">',
        '  <div class="card">',
        '    <div class="modal-head"><h2 data-el="helpTitle">How to play</h2><button class="btn sq" data-el="btnClose" aria-label="Close help">\u2715</button></div>',
        '    <ul class="help-list">',
        '      <li><b>Fall</b> \u2014 pieces drop from the top; fill a full row to clear it.</li>',
        '      <li><b>Score</b> \u2014 100 / 300 / 500 / 800 \u00D7 level for 1\u20134 rows at once, +1 per soft-dropped cell, +2 per hard-dropped cell.</li>',
        '      <li><b>Level</b> \u2014 every 10 cleared lines speeds up the fall.</li>',
        '      <li><b>Hold</b> \u2014 <b>C</b> banks the current piece and swaps it for the held one (once per drop).</li>',
        '      <li><b>Controls</b> \u2014 \u2190 \u2192 move \u00B7 \u2193 soft drop \u00B7 \u2191 or X rotate \u00B7 Z rotate counter-clockwise \u00B7 Space hard drop \u00B7 P pause.</li>',
        '      <li><b>Rotation</b> nudges off walls with basic wall kicks; the ghost outline shows where the piece will land.</li>',
        '    </ul>',
        '  </div>',
        '</div>'
      ].join("\n");

      var $ = function (name) { return wrap.querySelector('[data-el="' + name + '"]'); };

      var ROWS = 20, COLS = 10, CELL = 24;
      var boardCv = $("board"), nextCv = $("next"), holdCv = $("hold");
      var bctx = boardCv.getContext("2d"), nctx = nextCv.getContext("2d"), hctx = holdCv.getContext("2d");
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      boardCv.width = 240 * dpr; boardCv.height = 480 * dpr; bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      nextCv.width = 84 * dpr; nextCv.height = 48 * dpr; nctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      nextCv.style.width = "84px"; nextCv.style.height = "48px";
      holdCv.width = 84 * dpr; holdCv.height = 48 * dpr; hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      holdCv.style.width = "84px"; holdCv.style.height = "48px";

      // pieces: 1=I 2=O 3=T 4=S 5=Z 6=J 7=L — amber reserved for the I piece
      var BASE = {
        1: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
        2: [[1, 1], [1, 1]],
        3: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
        4: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
        5: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
        6: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
        7: [[0, 0, 1], [1, 1, 1], [0, 0, 0]]
      };
      var COLOR = { 1: "#f59e0b", 2: "#facc15", 3: "#a78bfa", 4: "#22d3ee", 5: "#fb7185", 6: "#60a5fa", 7: "#fb923c" };
      var KICKS = [0, -1, 1, -2, 2];

      var board, cur, nextType, holdType, holdUsed, bag;
      var score, lines, level, best, over, paused, clearing, softHeld, helpOpen;
      var hudCache = { score: -1, lines: -1, level: -1, best: -1 };
      best = parseInt(ctx.storage.get("best", "0") || "", 10) || 0;

      function shuffle(a) {
        for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
        return a;
      }
      function fromBag() { if (!bag || !bag.length) bag = shuffle([1, 2, 3, 4, 5, 6, 7]); return bag.pop(); }

      function collides(m, r, c) {
        for (var y = 0; y < m.length; y++) for (var x = 0; x < m[y].length; x++) {
          if (!m[y][x]) continue;
          var rr = r + y, cc = c + x;
          if (cc < 0 || cc >= COLS || rr >= ROWS) return true;
          if (rr >= 0 && board[rr][cc]) return true;
        }
        return false;
      }
      function clone(m) { return m.map(function (row) { return row.slice(); }); }

      function spawn(type) {
        var m = clone(BASE[type]);
        var c = Math.floor((COLS - m.length) / 2);
        var r = -1;
        if (collides(m, r, c)) { r = -2; }
        if (collides(m, r, c)) { gameOver(); return false; }
        cur = { type: type, m: m, r: r, c: c };
        return true;
      }
      function spawnNext() {
        var t = nextType;
        nextType = fromBag();
        drawPreview(nctx, nextType, false);
        return spawn(t);
      }

      function rotCW(m) {
        var n = m.length, r = [];
        for (var y = 0; y < n; y++) { r.push([]); for (var x = 0; x < n; x++) r[y].push(m[n - 1 - x][y]); }
        return r;
      }
      function rotCCW(m) {
        var n = m.length, r = [];
        for (var y = 0; y < n; y++) { r.push([]); for (var x = 0; x < n; x++) r[y].push(m[x][n - 1 - y]); }
        return r;
      }
      function rotate(cw) {
        if (!cur || paused || over || clearing) return;
        var m = cw ? rotCW(cur.m) : rotCCW(cur.m);
        for (var k = 0; k < KICKS.length; k++) {
          if (!collides(m, cur.r, cur.c + KICKS[k])) { cur.m = m; cur.c += KICKS[k]; return; }
        }
      }
      function move(dc) {
        if (!cur || paused || over || clearing) return;
        if (!collides(cur.m, cur.r, cur.c + dc)) cur.c += dc;
      }
      function step(soft) {
        if (!cur) return;
        if (!collides(cur.m, cur.r + 1, cur.c)) {
          cur.r++;
          if (soft) { score += 1; syncHUD(); }
        } else lock();
      }
      function hardDrop() {
        if (!cur || paused || over || clearing) return;
        var d = 0;
        while (!collides(cur.m, cur.r + d + 1, cur.c)) d++;
        score += d * 2;
        cur.r += d;
        lock();
      }
      function lock() {
        if (!cur) return;
        var visible = false;
        for (var y = 0; y < cur.m.length; y++) for (var x = 0; x < cur.m[y].length; x++) {
          if (!cur.m[y][x]) continue;
          var rr = cur.r + y, cc = cur.c + x;
          if (rr >= 0) { board[rr][cc] = cur.type; visible = true; }
        }
        cur = null;
        if (!visible) { gameOver(); return; }
        holdUsed = false;
        drawPreview(hctx, holdType, holdUsed);
        var full = [];
        for (var r = 0; r < ROWS; r++) {
          var f = true;
          for (var c = 0; c < COLS; c++) if (!board[r][c]) { f = false; break; }
          if (f) full.push(r);
        }
        if (full.length) {
          clearing = { rows: full, until: performance.now() + 150 };
        } else {
          spawnNext();
        }
        syncHUD();
      }
      function finishClearing() {
        var n = clearing.rows.length;
        for (var i = 0; i < n; i++) {
          board.splice(clearing.rows[i], 1);
          board.unshift(new Array(COLS).fill(0));
        }
        lines += n;
        score += [0, 100, 300, 500, 800][n] * level;
        level = 1 + Math.floor(lines / 10);
        clearing = null;
        syncHUD();
        spawnNext();
      }
      function doHold() {
        if (!cur || holdUsed || paused || over || clearing) return;
        var t = cur.type;
        if (holdType === undefined || holdType === null) {
          holdType = t;
          spawnNext();
        } else {
          var swap = holdType;
          holdType = t;
          spawn(swap);
        }
        holdUsed = true;
        drawPreview(hctx, holdType, true);
      }

      function fallInterval() { return Math.max(60, Math.round(800 * Math.pow(0.88, level - 1))); }

      function gameOver() {
        over = true;
        cur = null;
        var isBest = score > best;
        if (isBest) {
          best = score; ctx.storage.set("best", String(best));
          ctx.toast("New best score: " + best, "ok");
        }
        var stats = $("endStats");
        stats.textContent = "";
        [["Score", score], ["Lines", lines], ["Level", level], ["Best", best + (isBest ? " \u2605" : "")]].forEach(function (pair) {
          var row = document.createElement("div");
          var a = document.createElement("span"); a.textContent = pair[0];
          var b = document.createElement("b"); b.textContent = pair[1];
          row.appendChild(a); row.appendChild(b);
          stats.appendChild(row);
        });
        $("endOv").classList.add("show");
        syncHUD();
      }

      function reset() {
        board = [];
        for (var r = 0; r < ROWS; r++) board.push(new Array(COLS).fill(0));
        bag = []; cur = null; holdType = null; holdUsed = false;
        score = 0; lines = 0; level = 1; over = false; paused = false; clearing = null; softHeld = false;
        nextType = fromBag();
        $("endOv").classList.remove("show");
        $("pauseOv").classList.remove("show");
        $("btnPause").textContent = "\u23F8";
        spawnNext();
        drawPreview(hctx, holdType, false);
        syncHUD();
      }

      function syncHUD() {
        if (hudCache.score !== score) { $("score").textContent = score; hudCache.score = score; }
        if (hudCache.lines !== lines) { $("lines").textContent = lines; hudCache.lines = lines; }
        if (hudCache.level !== level) { $("level").textContent = level; hudCache.level = level; }
        if (hudCache.best !== best) { $("best").textContent = best; hudCache.best = best; }
      }

      // ---- drawing ----
      function rr2(c, x, y, w, h, rad) {
        c.beginPath();
        if (c.roundRect) c.roundRect(x, y, w, h, rad);
        else c.rect(x, y, w, h);
      }
      function drawBlock(c, x, y, size, color, alpha) {
        c.save();
        if (alpha !== undefined) c.globalAlpha = alpha;
        var pad = Math.max(1, size * 0.05);
        c.fillStyle = color;
        rr2(c, x + pad, y + pad, size - pad * 2, size - pad * 2, size * 0.16); c.fill();
        c.fillStyle = "rgba(255,255,255,.22)";
        rr2(c, x + pad * 2.4, y + pad * 2.4, size - pad * 4.8, size * 0.32, size * 0.1); c.fill();
        c.strokeStyle = "rgba(0,0,0,.45)";
        c.lineWidth = 1;
        rr2(c, x + pad + .5, y + pad + .5, size - pad * 2 - 1, size - pad * 2 - 1, size * 0.16); c.stroke();
        c.restore();
      }
      function drawGhost(c, x, y, size, color) {
        c.save();
        c.strokeStyle = color;
        c.globalAlpha = .5;
        c.lineWidth = 1.5;
        rr2(c, x + 3, y + 3, size - 6, size - 6, size * 0.16); c.stroke();
        c.globalAlpha = .1;
        c.fillStyle = color;
        rr2(c, x + 3, y + 3, size - 6, size - 6, size * 0.16); c.fill();
        c.restore();
      }

      function draw() {
        bctx.fillStyle = "#0d0c0a";
        bctx.fillRect(0, 0, 240, 480);
        bctx.strokeStyle = "rgba(255,255,255,.035)";
        bctx.lineWidth = 1;
        for (var x = 0; x <= COLS; x++) { bctx.beginPath(); bctx.moveTo(x * CELL + .5, 0); bctx.lineTo(x * CELL + .5, 480); bctx.stroke(); }
        for (var y = 0; y <= ROWS; y++) { bctx.beginPath(); bctx.moveTo(0, y * CELL + .5); bctx.lineTo(240, y * CELL + .5); bctx.stroke(); }
        var flash = clearing ? (Math.floor((performance.now() - (clearing.until - 150)) / 60) % 2 === 0) : false;
        for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
          var t = board[r][c];
          if (!t) continue;
          var isClr = clearing && clearing.rows.indexOf(r) >= 0;
          drawBlock(bctx, c * CELL, r * CELL, CELL, isClr ? (flash ? "#fbbf24" : COLOR[t]) : COLOR[t], isClr ? (flash ? 1 : .55) : 1);
        }
        if (cur && !over && !clearing) {
          var gy = cur.r;
          while (!collides(cur.m, gy + 1, cur.c)) gy++;
          for (var yy = 0; yy < cur.m.length; yy++) for (var xx = 0; xx < cur.m[yy].length; xx++) {
            if (!cur.m[yy][xx]) continue;
            var gc = cur.c + xx;
            if (gy + yy >= 0 && gy !== cur.r) drawGhost(bctx, gc * CELL, (gy + yy) * CELL, CELL, COLOR[cur.type]);
          }
          for (var y2 = 0; y2 < cur.m.length; y2++) for (var x2 = 0; x2 < cur.m[y2].length; x2++) {
            if (!cur.m[y2][x2]) continue;
            var rc = cur.r + y2, cc2 = cur.c + x2;
            if (rc >= 0) drawBlock(bctx, cc2 * CELL, rc * CELL, CELL, COLOR[cur.type]);
          }
        }
      }

      function drawPreview(c, type, dim) {
        c.clearRect(0, 0, 84, 48);
        if (type === null || type === undefined) {
          c.strokeStyle = "rgba(255,255,255,.12)";
          c.setLineDash([4, 4]);
          rr2(c, 20, 12, 44, 24, 6); c.stroke();
          c.setLineDash([]);
          return;
        }
        var m = BASE[type];
        var minx = 9, maxx = -1, miny = 9, maxy = -1;
        for (var y = 0; y < m.length; y++) for (var x = 0; x < m[y].length; x++) {
          if (m[y][x]) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
        }
        var size = 16;
        var w = (maxx - minx + 1) * size, h = (maxy - miny + 1) * size;
        var ox = (84 - w) / 2 - minx * size, oy = (48 - h) / 2 - miny * size;
        if (dim) c.globalAlpha = .45;
        for (var yy = 0; yy < m.length; yy++) for (var xx = 0; xx < m[yy].length; xx++) {
          if (m[yy][xx]) drawBlock(c, ox + xx * size, oy + yy * size, size, COLOR[type]);
        }
        c.globalAlpha = 1;
      }

      // ---- input (bound to root — the OS focuses it) ----
      var held = { left: null, right: null };
      var DAS = 160, ARR = 45;
      function handleDAS(now) {
        ["left", "right"].forEach(function (side) {
          var h = held[side];
          if (!h) return;
          if (now - h.t0 > DAS && now - h.last > ARR) { move(side === "left" ? -1 : 1); h.last = now; }
        });
      }

      function grabKeys() { try { root.focus({ preventScroll: true }); } catch (e) { root.focus(); } }

      root.addEventListener("keydown", function (e) {
        if (e.target && e.target.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return; // let focused buttons work
        if (helpOpen) { if (e.key === "Escape") { e.preventDefault(); setHelp(false); } return; }
        var k = e.key;
        if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowDown" || k === "ArrowUp" || k === " ") e.preventDefault();
        if (k === "p" || k === "P") { setPaused(!paused); return; }
        if (over || paused || clearing) { if (k === " " && over) reset(); return; }
        if (k === "ArrowLeft") { if (!held.left) { held.left = { t0: performance.now(), last: performance.now() }; move(-1); } }
        else if (k === "ArrowRight") { if (!held.right) { held.right = { t0: performance.now(), last: performance.now() }; move(1); } }
        else if (k === "ArrowDown") { softHeld = true; step(true); }
        else if (k === "ArrowUp" || k === "x" || k === "X") rotate(true);
        else if (k === "z" || k === "Z") rotate(false);
        else if (k === " ") hardDrop();
        else if (k === "c" || k === "C") doHold();
      });
      root.addEventListener("keyup", function (e) {
        if (e.key === "ArrowLeft") held.left = null;
        else if (e.key === "ArrowRight") held.right = null;
        else if (e.key === "ArrowDown") softHeld = false;
      });

      // pause when focus leaves the app window entirely
      root.addEventListener("focusout", function () {
        setTimeout(function () {
          var a = document.activeElement;
          if ((a === document.body || a === null || a === undefined || !root.contains(a)) && !over && !paused && !helpOpen) setPaused(true);
        }, 0);
      });

      // ---- touch pads ----
      var padInts = [];
      function padBtn(name, action, repeat) {
        var el = $(name), int = null;
        el.addEventListener("pointerdown", function (e) {
          e.preventDefault();
          action();
          if (repeat) { int = setInterval(action, 110); padInts.push(int); }
        });
        var stop = function () { if (int) { clearInterval(int); int = null; } };
        el.addEventListener("pointerup", stop);
        el.addEventListener("pointercancel", stop);
        el.addEventListener("pointerleave", stop);
      }
      padBtn("padLeft", function () { move(-1); }, true);
      padBtn("padRight", function () { move(1); }, true);
      padBtn("padDown", function () { step(true); }, true);
      padBtn("padRot", function () { rotate(true); }, false);
      padBtn("padHard", hardDrop, false);
      padBtn("padHold", doHold, false);
      try {
        if ((window.matchMedia && matchMedia("(pointer:coarse)").matches) || ("ontouchstart" in window)) wrap.classList.add("touch");
      } catch (e) {}

      function setPaused(p) {
        if (over && p) return;
        paused = p;
        $("pauseOv").classList.toggle("show", p);
        $("btnPause").textContent = p ? "\u25B6" : "\u23F8";
      }

      // ---- loop ----
      var acc = 0, last = performance.now(), raf = 0, closed = false;
      function loop(now) {
        if (closed) return;
        var dt = Math.min(100, now - last);
        last = now;
        if (!over && !paused && !helpOpen) {
          if (clearing) {
            if (now >= clearing.until) finishClearing();
          } else {
            handleDAS(now);
            acc += dt;
            var iv = softHeld ? Math.min(35, fallInterval()) : fallInterval();
            while (acc >= iv) {
              step(softHeld);
              acc -= iv;
              if (over || clearing || !cur) { acc = 0; break; }
            }
          }
        }
        draw();
        raf = requestAnimationFrame(loop);
      }

      $("btnRestart").addEventListener("click", function () { reset(); grabKeys(); });
      $("btnAgain").addEventListener("click", function () { reset(); grabKeys(); });
      $("btnPause").addEventListener("click", function () { setPaused(!paused); grabKeys(); });
      $("btnResume").addEventListener("click", function () { setPaused(false); grabKeys(); });

      var helpModal = $("helpModal"), btnHelp = $("btnHelp"), btnClose = $("btnClose");
      function setHelp(open) {
        helpOpen = open;
        helpModal.classList.toggle("open", open);
        if (open) btnClose.focus(); else btnHelp.focus();
      }
      btnHelp.addEventListener("click", function () { setHelp(true); });
      btnClose.addEventListener("click", function () { setHelp(false); });
      helpModal.addEventListener("click", function (e) { if (e.target === helpModal) setHelp(false); });

      reset();
      raf = requestAnimationFrame(loop);
      grabKeys();

      return {
        onClose: function () {
          closed = true;
          if (raf) cancelAnimationFrame(raf);
          for (var i = 0; i < padInts.length; i++) clearInterval(padInts[i]);
          padInts.length = 0;
        }
      };
    }
  };
})();
