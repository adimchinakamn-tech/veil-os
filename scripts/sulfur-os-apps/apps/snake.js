/* Sulfur OS app module — Snake (ported from the standalone Sulfur OS page) */
(function () {
  "use strict";
  var REG = window.SulfurApps || (window.SulfurApps = {});
  REG["snake"] = {
    id: "snake",
    name: "Snake",
    desc: "Grow the amber snake, chase bonuses, dodge walls and your tail.",
    icon: "wave",
    color: "#f59e0b",
    cat: "game",
    w: 440, h: 620,
    mount: function (root, ctx) {
      root.style.setProperty("--acc", "#f59e0b");

      var st = document.createElement("style");
      st.textContent = [
        ".sa-snake{position:relative;height:100%;display:flex;flex-direction:column;align-items:center;gap:10px;padding:12px 12px 14px;overflow:auto;background:#0c0c0e;color:#e4e4e7;font:13.5px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}",
        ".sa-snake *{box-sizing:border-box}",
        ".sa-snake .app{width:100%;max-width:430px;display:flex;flex-direction:column;gap:10px;min-width:0}",
        ".sa-snake .hrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
        ".sa-snake .hrow .name{font-size:15px;font-weight:700;letter-spacing:.01em}",
        ".sa-snake .spacer{flex:1}",
        ".sa-snake .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
        ".sa-snake .btn{min-height:36px;min-width:36px;padding:0 14px;border-radius:8px;border:1px solid #27272a;background:#18181b;color:#e4e4e7;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px;transition:background .15s,border-color .15s,transform .06s}",
        ".sa-snake .btn:hover{background:#202024;border-color:#3f3f46}",
        ".sa-snake .btn:active{transform:scale(.98)}",
        ".sa-snake .btn:focus-visible{outline:2px solid var(--acc);outline-offset:2px}",
        ".sa-snake .btn.primary{background:var(--acc);border-color:var(--acc);color:#1c1917}",
        ".sa-snake .btn.primary:hover{filter:brightness(1.08)}",
        ".sa-snake .btn.sq{width:36px;padding:0;font-size:15px}",
        ".sa-snake .hud{display:flex;gap:8px;flex-wrap:wrap}",
        ".sa-snake .stat{display:flex;flex-direction:column;align-items:center;background:#18181b;border:1px solid #27272a;border-radius:12px;padding:6px 14px;min-width:74px;flex:1}",
        ".sa-snake .stat .label{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#a1a1aa;font-weight:600}",
        ".sa-snake .stat .value{font-size:18px;font-weight:700;color:var(--acc);line-height:1.3}",
        ".sa-snake .panel{position:relative;background:#18181b;border:1px solid #27272a;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);padding:8px}",
        ".sa-snake .cv{display:block;width:100%;height:auto;max-width:378px;margin:0 auto;border-radius:8px;background:#0e0d0b;touch-action:none}",
        ".sa-snake .overlay{position:absolute;inset:0;border-radius:12px;background:rgba(9,9,11,.85);display:flex;align-items:center;justify-content:center;z-index:12;opacity:0;pointer-events:none;transition:opacity .25s}",
        ".sa-snake .overlay.show{opacity:1;pointer-events:auto}",
        ".sa-snake .ov-card{text-align:center;padding:18px}",
        ".sa-snake .ov-title{margin:0;font-size:22px;font-weight:800}",
        ".sa-snake .ov-title.win{color:var(--acc)}",
        ".sa-snake .ov-title.lose{color:#fb7185}",
        ".sa-snake .ov-title.pause{color:#e4e4e7}",
        ".sa-snake .ov-sub{margin:8px 0 16px;font-size:13px;color:#a1a1aa}",
        ".sa-snake .ov-sub b{color:#fbbf24}",
        ".sa-snake .ov-stats{display:flex;justify-content:center;gap:18px;margin:0 0 16px;flex-wrap:wrap}",
        ".sa-snake .ov-stats div{display:flex;flex-direction:column;min-width:64px}",
        ".sa-snake .ov-stats dt{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#a1a1aa}",
        ".sa-snake .ov-stats dd{margin:0;font-size:20px;font-weight:700;color:var(--acc)}",
        ".sa-snake .dpad{display:none;grid-template-columns:repeat(3,60px);grid-template-rows:repeat(2,50px);gap:8px;justify-content:center;margin:2px auto 0}",
        ".sa-snake.touch .dpad{display:grid}",
        ".sa-snake .dpad .btn{font-size:19px;width:100%}",
        ".sa-snake .dpad .u{grid-column:2}",
        ".sa-snake .dpad .l{grid-column:1;grid-row:2}.sa-snake .dpad .d{grid-column:2;grid-row:2}.sa-snake .dpad .r{grid-column:3;grid-row:2}",
        ".sa-snake .hint{font-size:12px;color:#a1a1aa;margin:0;text-align:center;line-height:1.5}",
        ".sa-snake .hint b{color:var(--acc)}",
        ".sa-snake .modal{position:absolute;inset:0;background:rgba(0,0,0,.65);display:none;align-items:center;justify-content:center;z-index:60;padding:16px}",
        ".sa-snake .modal.open{display:flex}",
        ".sa-snake .modal .card{background:#18181b;border:1px solid #27272a;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);max-width:400px;width:100%;padding:18px}",
        ".sa-snake .modal-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}",
        ".sa-snake .modal-head h2{margin:0;font-size:15px;font-weight:700;flex:1}",
        ".sa-snake .help-list{margin:0;padding-left:18px;font-size:13px;color:#d4d4d8;line-height:1.65}",
        ".sa-snake .help-list b{color:var(--acc);font-weight:600}"
      ].join("\n");
      root.appendChild(st);

      var wrap = document.createElement("div");
      wrap.className = "sa-snake";
      root.appendChild(wrap);
      wrap.innerHTML = [
        '<div class="app">',
        '  <div class="hrow">',
        '    <span class="name">Snake</span><span class="spacer"></span>',
        '    <button class="btn sq" data-el="btnPause" aria-label="Pause or resume">\u23F8</button>',
        '    <button class="btn sq" data-el="btnHelp" aria-label="How to play">?</button>',
        '    <button class="btn" data-el="btnRestart">Restart</button>',
        '  </div>',
        '  <div class="hud">',
        '    <div class="stat"><span class="label">Score</span><span class="value mono" data-el="score">0</span></div>',
        '    <div class="stat"><span class="label">Best</span><span class="value mono" data-el="best">0</span></div>',
        '    <div class="stat"><span class="label">Speed</span><span class="value mono" data-el="speed">L1</span></div>',
        '  </div>',
        '  <div class="panel">',
        '    <canvas class="cv" data-el="cv" width="378" height="378" role="img" aria-label="Snake field. Guide the snake with arrow keys, WASD, swipes, or the d-pad."></canvas>',
        '    <div class="overlay" data-el="pauseOv">',
        '      <div class="ov-card">',
        '        <p class="ov-title pause">Paused</p>',
        '        <p class="ov-sub">Press <b>P</b> or <b>Space</b> to resume</p>',
        '        <button class="btn primary" data-el="btnResume">Resume</button>',
        '      </div>',
        '    </div>',
        '    <div class="overlay" data-el="endOv">',
        '      <div class="ov-card">',
        '        <p class="ov-title lose" data-el="endTitle">Game over</p>',
        '        <p class="ov-sub" data-el="endSub">The snake bit off more than it could chew.</p>',
        '        <dl class="ov-stats mono">',
        '          <div><dt>Score</dt><dd data-el="stScore">0</dd></div>',
        '          <div><dt>Length</dt><dd data-el="stLen">3</dd></div>',
        '          <div><dt>Best</dt><dd data-el="stBest">0</dd></div>',
        '        </dl>',
        '        <button class="btn primary" data-el="btnAgain">Play again</button>',
        '      </div>',
        '    </div>',
        '  </div>',
        '  <div class="dpad" aria-label="Direction pad">',
        '    <button class="btn u" data-dir="up" aria-label="Up">\u25B2</button>',
        '    <button class="btn l" data-dir="left" aria-label="Left">\u25C0</button>',
        '    <button class="btn d" data-dir="down" aria-label="Down">\u25BC</button>',
        '    <button class="btn r" data-dir="right" aria-label="Right">\u25B6</button>',
        '  </div>',
        '  <p class="hint">Arrows / WASD / swipe \u00B7 <b>\u25CF</b> food +1 \u00B7 <b style="color:#fb7185">\u25C6</b> bonus +5 (expires) \u00B7 speed up every 5 foods</p>',
        '</div>',
        '<div class="modal" data-el="helpModal" role="dialog" aria-modal="true">',
        '  <div class="card">',
        '    <div class="modal-head"><h2>How to play</h2><button class="btn sq" data-el="btnClose" aria-label="Close help">\u2715</button></div>',
        '    <ul class="help-list">',
        '      <li><b>Steer</b> \u2014 arrow keys, WASD, swipes on the board, or the d-pad on touch screens.</li>',
        '      <li><b>Eat</b> \u2014 amber dots are worth 1 point and grow the snake by one.</li>',
        '      <li><b>Bonus</b> \u2014 the rose diamond is worth 5 points, but it fades after ~7 seconds.</li>',
        '      <li><b>Speed</b> \u2014 every 5 foods the snake gets faster (L1, L2, \u2026).</li>',
        '      <li><b>Death</b> \u2014 walls and your own tail are fatal. <b>P</b> / <b>Space</b> pauses; Space restarts after a crash.</li>',
        '    </ul>',
        '  </div>',
        '</div>'
      ].join("\n");

      var $ = function (name) { return wrap.querySelector('[data-el="' + name + '"]'); };

      var GRID = 21, CELL = 18, SIZE = GRID * CELL; // 378
      var cv = $("cv"), c = cv.getContext("2d");
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = SIZE * dpr; cv.height = SIZE * dpr;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);

      var DIRS = { up: { r: -1, c: 0 }, down: { r: 1, c: 0 }, left: { r: 0, c: -1 }, right: { r: 0, c: 1 } };
      var snake, dir, queue, food, bonus, score, foods, best, over, paused, helpOpen, deathFlash;

      best = parseInt(ctx.storage.get("best", "0") || "", 10) || 0;
      $("best").textContent = best;

      function reset() {
        snake = [{ r: 10, c: 10 }, { r: 10, c: 9 }, { r: 10, c: 8 }];
        dir = DIRS.right; queue = [];
        bonus = null;
        score = 0; foods = 0; over = false; paused = false; deathFlash = 0;
        food = spawnFood();
        $("score").textContent = "0";
        $("speed").textContent = "L1";
        $("endOv").classList.remove("show");
        $("pauseOv").classList.remove("show");
        $("btnPause").textContent = "\u23F8";
      }

      function freeCell() {
        while (true) {
          var r = Math.floor(Math.random() * GRID), cc = Math.floor(Math.random() * GRID);
          var onSnake = snake.some(function (p) { return p.r === r && p.c === cc; });
          var onFood = food && food.r === r && food.c === cc;
          var onBonus = bonus && bonus.r === r && bonus.c === cc;
          if (!onSnake && !onFood && !onBonus) return { r: r, c: cc };
        }
      }
      function spawnFood() { return freeCell(); }
      function interval() { return Math.max(70, 150 - 12 * Math.floor(foods / 5)); }

      function turn(name) {
        var nd = DIRS[name];
        if (!nd || over) return;
        var lastD = queue.length ? queue[queue.length - 1] : dir;
        if (nd.r === -lastD.r && nd.c === -lastD.c) return; // no 180°
        if (nd.r === lastD.r && nd.c === lastD.c) return;
        if (queue.length < 3) queue.push(nd);
      }

      function tick() {
        while (queue.length) {
          var nd = queue.shift();
          if (!(nd.r === -dir.r && nd.c === -dir.c)) { dir = nd; break; }
        }
        var head = snake[0];
        var nh = { r: head.r + dir.r, c: head.c + dir.c };
        if (nh.r < 0 || nh.r >= GRID || nh.c < 0 || nh.c >= GRID) return die();
        var eating = food && nh.r === food.r && nh.c === food.c;
        var bonusEat = bonus && nh.r === bonus.r && nh.c === bonus.c;
        var body = eating || bonusEat ? snake : snake.slice(0, snake.length - 1);
        for (var i = 0; i < body.length; i++) {
          if (body[i].r === nh.r && body[i].c === nh.c) return die();
        }
        snake.unshift(nh);
        if (eating) {
          score += 1; foods += 1;
          food = spawnFood();
          if (!bonus && Math.random() < 0.25) {
            bonus = freeCell();
            bonus.until = Date.now() + 7000;
          }
          syncHUD();
        } else if (bonusEat) {
          score += 5;
          bonus = null;
          syncHUD();
        } else {
          snake.pop();
        }
      }

      function die() {
        over = true;
        deathFlash = Date.now();
        if (score > best) {
          best = score; ctx.storage.set("best", String(best));
          $("best").textContent = best;
          ctx.toast("New best score: " + best, "ok");
        }
        $("stScore").textContent = score;
        $("stLen").textContent = snake.length;
        $("stBest").textContent = best;
        $("endOv").classList.add("show");
      }

      function syncHUD() {
        $("score").textContent = score;
        $("speed").textContent = "L" + (Math.floor(foods / 5) + 1);
      }

      // ---- drawing ----
      var rr = function (x, y, w, h, rad) {
        if (c.roundRect) { c.beginPath(); c.roundRect(x, y, w, h, rad); c.fill(); }
        else c.fillRect(x, y, w, h);
      };

      function draw() {
        for (var r = 0; r < GRID; r++) for (var cc = 0; cc < GRID; cc++) {
          c.fillStyle = (r + cc) % 2 === 0 ? "#0e0d0b" : "#121110";
          c.fillRect(cc * CELL, r * CELL, CELL, CELL);
        }
        if (food) {
          c.fillStyle = "#fbbf24";
          c.shadowColor = "rgba(245,158,11,.8)"; c.shadowBlur = 12;
          c.beginPath(); c.arc((food.c + .5) * CELL, (food.r + .5) * CELL, 5.5, 0, Math.PI * 2); c.fill();
          c.shadowBlur = 0;
          c.fillStyle = "#fde68a";
          c.beginPath(); c.arc((food.c + .5) * CELL, (food.r + .5) * CELL, 2.2, 0, Math.PI * 2); c.fill();
        }
        if (bonus) {
          var left = Math.max(0, (bonus.until - Date.now()) / 7000);
          var bx = (bonus.c + .5) * CELL, by = (bonus.r + .5) * CELL;
          var pulse = 4.6 + Math.sin(Date.now() / 130) * 1.6;
          c.save();
          c.translate(bx, by); c.rotate(Math.PI / 4);
          c.fillStyle = "#fb7185";
          c.shadowColor = "rgba(251,113,133,.7)"; c.shadowBlur = 10;
          c.fillRect(-pulse, -pulse, pulse * 2, pulse * 2);
          c.restore();
          c.strokeStyle = "rgba(251,113,133,.75)";
          c.lineWidth = 1.6;
          c.beginPath();
          c.arc(bx, by, 8.5, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2);
          c.stroke();
          if (left <= 0) bonus = null;
        }
        var n = snake.length;
        for (var i = n - 1; i >= 0; i--) {
          var seg = snake[i];
          var f = n === 1 ? 0 : i / (n - 1);
          var col = i === 0 ? "#fbbf24" : mix("#f59e0b", "#8a5a08", f);
          c.fillStyle = over && Date.now() - deathFlash < 600 && Math.floor((Date.now() - deathFlash) / 120) % 2 === 0 ? "#7f1d1d" : col;
          rr(seg.c * CELL + 1, seg.r * CELL + 1, CELL - 2, CELL - 2, i === 0 ? 6 : 4);
        }
        if (snake.length) {
          var h = snake[0];
          var hx = (h.c + .5) * CELL, hy = (h.r + .5) * CELL;
          var ox = dir.c * 3.2, oy = dir.r * 3.2;
          var px = -dir.r * 3.2, py = dir.c * 3.2;
          c.fillStyle = "#1c1917";
          c.beginPath(); c.arc(hx + ox + px, hy + oy + py, 1.8, 0, Math.PI * 2); c.fill();
          c.beginPath(); c.arc(hx + ox - px, hy + oy - py, 1.8, 0, Math.PI * 2); c.fill();
        }
      }

      function mix(a, b, t) {
        var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
        var r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
        var g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
        var bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
        return "rgb(" + r + "," + g + "," + bl + ")";
      }

      // ---- loop (rAF + accumulator) ----
      var acc = 0, last = performance.now(), raf = 0, closed = false;
      function loop(now) {
        if (closed) return;
        var dt = Math.min(100, now - last);
        last = now;
        if (!paused && !over && !helpOpen) {
          acc += dt;
          var iv = interval();
          while (acc >= iv) { tick(); acc -= iv; iv = interval(); }
        }
        draw();
        raf = requestAnimationFrame(loop);
      }

      // ---- input on root ----
      var KEYMAP = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right", W: "up", S: "down", A: "left", D: "right" };
      function grabKeys() { try { root.focus({ preventScroll: true }); } catch (e) { root.focus(); } }

      root.addEventListener("keydown", function (e) {
        if (e.target && e.target.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
        if (helpOpen) { if (e.key === "Escape") { e.preventDefault(); setHelp(false); } return; }
        if (e.key === "p" || e.key === "P") { e.preventDefault(); setPaused(!paused); return; }
        if (e.key === " ") {
          e.preventDefault();
          if (over) reset();
          else setPaused(!paused);
          return;
        }
        var m = KEYMAP[e.key];
        if (m) { e.preventDefault(); if (paused) setPaused(false); turn(m); }
      });
      root.addEventListener("keyup", function (e) { if (e.key === " ") e.preventDefault(); });

      root.addEventListener("focusout", function () {
        setTimeout(function () {
          var a = document.activeElement;
          if ((a === document.body || a === null || a === undefined || !root.contains(a)) && !over && !paused && !helpOpen) setPaused(true);
        }, 0);
      });

      function setPaused(p) {
        if (over && p) return;
        paused = p;
        $("pauseOv").classList.toggle("show", p);
        $("btnPause").textContent = p ? "\u25B6" : "\u23F8";
      }

      var swipe = null;
      cv.addEventListener("touchstart", function (e) {
        if (e.touches.length === 1) swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }, { passive: true });
      cv.addEventListener("touchend", function (e) {
        if (!swipe) return;
        var dx = e.changedTouches[0].clientX - swipe.x;
        var dy = e.changedTouches[0].clientY - swipe.y;
        swipe = null;
        if (Math.abs(dx) < 22 && Math.abs(dy) < 22) return;
        if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? "right" : "left");
        else turn(dy > 0 ? "down" : "up");
      });

      var pad = wrap.querySelectorAll(".dpad .btn");
      for (var p = 0; p < pad.length; p++) {
        (function (btn) {
          btn.addEventListener("click", function () {
            if (paused) setPaused(false);
            turn(btn.getAttribute("data-dir"));
            grabKeys();
          });
        })(pad[p]);
      }

      try {
        if ((window.matchMedia && matchMedia("(pointer:coarse)").matches) || ("ontouchstart" in window)) wrap.classList.add("touch");
      } catch (e) {}

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
        }
      };
    }
  };
})();
