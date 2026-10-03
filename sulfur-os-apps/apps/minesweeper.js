/* Sulfur OS app module — Minesweeper (ported from the standalone Sulfur OS page) */
(function () {
  "use strict";
  var REG = window.SulfurApps || (window.SulfurApps = {});
  REG["minesweeper"] = {
    id: "minesweeper",
    name: "Minesweeper",
    desc: "Sweep a 12×12 field — flags, chording and a safe first click.",
    icon: "custom:M5 21V4m0 10s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z",
    color: "#f59e0b",
    cat: "game",
    w: 480, h: 640,
    mount: function (root, ctx) {
      root.style.setProperty("--acc", "#f59e0b");

      var st = document.createElement("style");
      st.textContent = [
        ".sa-minesweeper{position:relative;height:100%;display:flex;flex-direction:column;align-items:center;gap:12px;padding:12px 12px 14px;overflow:auto;background:#0c0c0e;color:#e4e4e7;font:13.5px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}",
        ".sa-minesweeper *{box-sizing:border-box}",
        ".sa-minesweeper .app{width:100%;max-width:440px;display:flex;flex-direction:column;gap:12px;min-width:0}",
        ".sa-minesweeper .hrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
        ".sa-minesweeper .hrow .name{font-size:15px;font-weight:700;letter-spacing:.01em}",
        ".sa-minesweeper .spacer{flex:1}",
        ".sa-minesweeper .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
        ".sa-minesweeper .btn{min-height:36px;min-width:36px;padding:0 14px;border-radius:8px;border:1px solid #27272a;background:#18181b;color:#e4e4e7;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px;transition:background .15s,border-color .15s,transform .06s}",
        ".sa-minesweeper .btn:hover{background:#202024;border-color:#3f3f46}",
        ".sa-minesweeper .btn:active{transform:scale(.98)}",
        ".sa-minesweeper .btn:focus-visible{outline:2px solid var(--acc);outline-offset:2px}",
        ".sa-minesweeper .btn.primary{background:var(--acc);border-color:var(--acc);color:#1c1917}",
        ".sa-minesweeper .btn.primary:hover{filter:brightness(1.08)}",
        ".sa-minesweeper .btn.sq{width:36px;padding:0;font-size:15px}",
        ".sa-minesweeper .btn.toggle[aria-pressed=\"true\"]{background:rgba(245,158,11,.2);border-color:var(--acc);color:var(--acc)}",
        ".sa-minesweeper .hud{display:flex;gap:8px;flex-wrap:wrap;align-items:stretch}",
        ".sa-minesweeper .stat{display:flex;flex-direction:column;align-items:center;justify-content:center;background:#18181b;border:1px solid #27272a;border-radius:12px;padding:5px 12px;min-width:70px;min-height:48px}",
        ".sa-minesweeper .stat .label{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#a1a1aa;font-weight:600}",
        ".sa-minesweeper .stat .value{font-size:16px;font-weight:700;line-height:1.25}",
        ".sa-minesweeper .c-mine{color:#fb7185}.sa-minesweeper .c-time{color:#e4e4e7}.sa-minesweeper .c-best{color:var(--acc)}",
        ".sa-minesweeper .statechip{display:flex;align-items:center;justify-content:center;background:#18181b;border:1px solid #27272a;border-radius:12px;padding:5px 14px;min-height:48px;font-size:12px;font-weight:600;color:#a1a1aa;flex:1}",
        ".sa-minesweeper .statechip.win{color:var(--acc);border-color:rgba(245,158,11,.4)}",
        ".sa-minesweeper .statechip.lose{color:#fb7185;border-color:rgba(239,68,68,.4)}",
        ".sa-minesweeper .panel{position:relative;width:min(100%,404px);margin:0 auto}",
        ".sa-minesweeper .grid{display:grid;grid-template-columns:repeat(12,1fr);gap:2px;background:#101013;border:1px solid #27272a;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);padding:8px;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:manipulation}",
        ".sa-minesweeper .cell{aspect-ratio:1;border:0;padding:0;background:#27272a;color:#e4e4e7;border-radius:4px;display:flex;align-items:center;justify-content:center;font-family:inherit;font-weight:700;font-size:clamp(11px,2.8vw,15px);cursor:pointer;transition:background .12s,transform .06s}",
        ".sa-minesweeper .cell:hover{background:#333338}",
        ".sa-minesweeper .cell:active{transform:scale(.88)}",
        ".sa-minesweeper .cell:focus-visible{outline:2px solid var(--acc);outline-offset:-2px}",
        ".sa-minesweeper .cell.rev{background:#141417;cursor:default}",
        ".sa-minesweeper .cell.rev:hover{background:#141417}",
        ".sa-minesweeper .cell.flag{color:var(--acc)}",
        ".sa-minesweeper .cell.q{color:#a1a1aa;font-style:italic}",
        ".sa-minesweeper .cell.mine{background:rgba(239,68,68,.16);color:#fb7185;cursor:default}",
        ".sa-minesweeper .cell.boom{background:#ef4444;color:#1c1917;cursor:default}",
        ".sa-minesweeper .cell.wrong{background:rgba(239,68,68,.1);color:#fb7185;text-decoration:line-through;cursor:default}",
        ".sa-minesweeper .n1{color:#60a5fa}.sa-minesweeper .n2{color:#22d3ee}.sa-minesweeper .n3{color:#fb7185}.sa-minesweeper .n4{color:#a78bfa}",
        ".sa-minesweeper .n5{color:var(--acc)}.sa-minesweeper .n6{color:#fbbf24}.sa-minesweeper .n7{color:#e4e4e7}.sa-minesweeper .n8{color:#a1a1aa}",
        ".sa-minesweeper .hint{font-size:12px;color:#a1a1aa;margin:0;text-align:center;line-height:1.5}",
        ".sa-minesweeper .overlay{position:absolute;inset:0;border-radius:12px;background:rgba(9,9,11,.88);display:flex;align-items:center;justify-content:center;z-index:12;opacity:0;pointer-events:none;transition:opacity .25s}",
        ".sa-minesweeper .overlay.show{opacity:1;pointer-events:auto}",
        ".sa-minesweeper .ov-card{text-align:center;padding:18px}",
        ".sa-minesweeper .ov-title{margin:0;font-size:22px;font-weight:800}",
        ".sa-minesweeper .ov-title.win{color:var(--acc)}",
        ".sa-minesweeper .ov-title.lose{color:#fb7185}",
        ".sa-minesweeper .ov-sub{margin:6px 0 16px;font-size:13px;color:#a1a1aa}",
        ".sa-minesweeper .ov-sub b{color:#fbbf24}"
      ].join("\n");
      root.appendChild(st);

      var wrap = document.createElement("div");
      wrap.className = "sa-minesweeper";
      root.appendChild(wrap);
      wrap.innerHTML = [
        '<div class="app">',
        '  <div class="hrow">',
        '    <span class="name">Minesweeper</span><span class="spacer"></span>',
        '    <button class="btn sq toggle" data-el="btnFlagMode" aria-label="Toggle flag mode" aria-pressed="false" title="Flag mode: tap to flag">\u2691</button>',
        '    <button class="btn" data-el="btnRestart">Restart</button>',
        '  </div>',
        '  <div class="hud">',
        '    <div class="stat"><span class="label">Mines</span><span class="value mono c-mine" data-el="mines">20</span></div>',
        '    <div class="statechip" data-el="stateChip" aria-live="polite">Ready \u2014 first click is safe</div>',
        '    <div class="stat"><span class="label">Time</span><span class="value mono c-time" data-el="time">0s</span></div>',
        '    <div class="stat"><span class="label">Best</span><span class="value mono c-best" data-el="best">\u2014</span></div>',
        '  </div>',
        '  <div class="panel">',
        '    <div class="grid" data-el="grid" role="grid" aria-label="Minesweeper board, 12 by 12 with 20 mines"></div>',
        '    <div class="overlay" data-el="overlay">',
        '      <div class="ov-card">',
        '        <p class="ov-title" data-el="ovTitle">Boom!</p>',
        '        <p class="ov-sub" data-el="ovSub"></p>',
        '        <button class="btn primary" data-el="btnAgain">Play again</button>',
        '      </div>',
        '    </div>',
        '  </div>',
        '  <p class="hint">Left-click reveal \u00B7 right-click / long-press flag (\u2691 \u2192 ? \u2192 none) \u00B7 tap a number to chord</p>',
        '</div>'
      ].join("\n");

      var $ = function (name) { return wrap.querySelector('[data-el="' + name + '"]'); };

      var ROWS = 12, COLS = 12, MINES = 20, TOTAL = ROWS * COLS;
      var gridEl = $("grid");

      // st: 0 covered, 1 revealed, 2 flag, 3 question
      var cells, els, state, flags, time, timerInt, revealedCount, flagMode;
      var bestTime = parseInt(ctx.storage.get("best", "0") || "", 10) || 0;

      var timeouts = [];
      function t(fn, ms) { var id = setTimeout(fn, ms); timeouts.push(id); return id; }
      function clearT(id) { var i = timeouts.indexOf(id); if (i >= 0) timeouts.splice(i, 1); clearTimeout(id); }

      function idx(r, c) { return r * COLS + c; }
      function neighbors(r, c) {
        var out = [];
        for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          var nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) out.push([nr, nc]);
        }
        return out;
      }

      function newGame() {
        cells = [];
        for (var i = 0; i < TOTAL; i++) cells.push({ mine: false, adj: 0, st: 0 });
        state = "ready"; flags = 0; time = 0; revealedCount = 0;
        if (timerInt) { clearInterval(timerInt); timerInt = null; }
        $("time").textContent = "0s";
        $("mines").textContent = MINES;
        var chip = $("stateChip");
        chip.textContent = "Ready \u2014 first click is safe";
        chip.className = "statechip";
        $("overlay").classList.remove("show");
        renderBest();
        buildDom();
      }

      function buildDom() {
        gridEl.innerHTML = "";
        els = [];
        for (var r = 0; r < ROWS; r++) {
          var row = [];
          for (var c = 0; c < COLS; c++) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "cell";
            (function (rr, cc, btn) {
              bindCell(btn, rr, cc);
            })(r, c, b);
            gridEl.appendChild(b);
            row.push(b);
          }
          els.push(row);
        }
        renderAll();
      }

      function placeMines(sr, sc) {
        var excluded = {};
        excluded[idx(sr, sc)] = true;
        var nb = neighbors(sr, sc);
        for (var i = 0; i < nb.length; i++) excluded[idx(nb[i][0], nb[i][1])] = true;
        var placed = 0;
        while (placed < MINES) {
          var p = Math.floor(Math.random() * TOTAL);
          if (excluded[p] || cells[p].mine) continue;
          cells[p].mine = true;
          placed++;
        }
        for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) {
          if (cells[idx(r, c)].mine) continue;
          var n = neighbors(r, c), count = 0;
          for (var k = 0; k < n.length; k++) if (cells[idx(n[k][0], n[k][1])].mine) count++;
          cells[idx(r, c)].adj = count;
        }
      }

      function startTimer() {
        if (timerInt) return;
        timerInt = setInterval(function () {
          time++;
          $("time").textContent = time + "s";
        }, 1000);
      }
      function stopTimer() { if (timerInt) { clearInterval(timerInt); timerInt = null; } }

      // ---- actions ----
      function reveal(r, c) {
        if (state === "won" || state === "lost") return;
        var cell = cells[idx(r, c)];
        if (cell.st === 2) return;
        if (cell.st === 1) { chord(r, c); return; }
        if (state === "ready") {
          placeMines(r, c);
          state = "playing";
          startTimer();
          var chip = $("stateChip");
          chip.textContent = "Playing";
          chip.className = "statechip";
        }
        if (cell.mine) { lose(r, c); return; }
        var stack = [[r, c]];
        while (stack.length) {
          var pair = stack.pop();
          var cr = pair[0], cc = pair[1];
          var cur = cells[idx(cr, cc)];
          if (cur.st === 1 || cur.st === 2 || cur.mine) continue;
          cur.st = 1;
          revealedCount++;
          if (cur.adj === 0) {
            var nbs = neighbors(cr, cc);
            for (var i = 0; i < nbs.length; i++) {
              var n = cells[idx(nbs[i][0], nbs[i][1])];
              if (n.st !== 1 && n.st !== 2) stack.push(nbs[i]);
            }
          }
        }
        renderAll();
        if (revealedCount === TOTAL - MINES) win();
      }

      function chord(r, c) {
        var cell = cells[idx(r, c)];
        if (cell.st !== 1 || cell.adj === 0) return;
        var nbs = neighbors(r, c), f = 0;
        for (var i = 0; i < nbs.length; i++) if (cells[idx(nbs[i][0], nbs[i][1])].st === 2) f++;
        if (f !== cell.adj) return;
        for (var j = 0; j < nbs.length; j++) {
          var nr = nbs[j][0], nc = nbs[j][1];
          var ncell = cells[idx(nr, nc)];
          if (ncell.st === 0 || ncell.st === 3) {
            if (ncell.mine) { lose(nr, nc); return; }
            reveal(nr, nc);
            if (state === "lost") return;
          }
        }
      }

      function flagCycle(r, c) {
        if (state !== "playing" && state !== "ready") return;
        var cell = cells[idx(r, c)];
        if (cell.st === 1) return;
        if (cell.st === 0) cell.st = 2;
        else if (cell.st === 2) cell.st = 3;
        else cell.st = 0;
        flags = 0;
        for (var i = 0; i < TOTAL; i++) if (cells[i].st === 2) flags++;
        $("mines").textContent = MINES - flags;
        renderCell(r, c);
      }

      function lose(r, c) {
        state = "lost";
        stopTimer();
        for (var i = 0; i < TOTAL; i++) {
          var cell = cells[i];
          if (cell.mine && cell.st !== 2) cell.st = 1;
        }
        cells[idx(r, c)].st = 1;
        renderAll(true, r, c);
        var chip = $("stateChip");
        chip.textContent = "Boom \u2014 mine hit";
        chip.className = "statechip lose";
        $("ovTitle").textContent = "Boom!";
        $("ovTitle").className = "ov-title lose";
        $("ovSub").textContent = "";
        $("ovSub").appendChild(document.createTextNode("You hit a mine after "));
        var b = document.createElement("b"); b.textContent = time + "s";
        $("ovSub").appendChild(b);
        $("ovSub").appendChild(document.createTextNode(" \u00B7 " + revealedCount + " / " + (TOTAL - MINES) + " cleared"));
        $("overlay").classList.add("show");
      }

      function win() {
        state = "won";
        stopTimer();
        flags = 0;
        for (var i = 0; i < TOTAL; i++) if (cells[i].mine) { cells[i].st = 2; flags++; }
        $("mines").textContent = MINES - flags;
        renderAll();
        var chip = $("stateChip");
        chip.textContent = "Cleared in " + time + "s";
        chip.className = "statechip win";
        var isBest = !bestTime || time < bestTime;
        if (isBest) { bestTime = time; ctx.storage.set("best", String(bestTime)); renderBest(); }
        $("ovTitle").textContent = "Cleared!";
        $("ovTitle").className = "ov-title win";
        $("ovSub").textContent = "";
        $("ovSub").appendChild(document.createTextNode("Field swept in "));
        var b = document.createElement("b"); b.textContent = time + "s";
        $("ovSub").appendChild(b);
        $("ovSub").appendChild(document.createTextNode(isBest ? " \u00B7 new best!" : " \u00B7 best " + bestTime + "s"));
        $("overlay").classList.add("show");
        if (isBest) ctx.toast("New best time: " + time + "s", "ok");
      }

      function renderBest() {
        $("best").textContent = bestTime ? bestTime + "s" : "\u2014";
      }

      // ---- rendering ----
      function renderAll(loseMode, boomR, boomC) {
        for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) renderCell(r, c, loseMode, boomR, boomC);
      }

      function renderCell(r, c, loseMode, boomR, boomC) {
        var cell = cells[idx(r, c)];
        var el = els[r][c];
        var cls = "cell";
        var txt = "";
        var label = "Row " + (r + 1) + " column " + (c + 1) + ", ";
        if (cell.st === 1) {
          if (cell.mine) {
            cls += loseMode && r === boomR && c === boomC ? " boom" : " mine";
            txt = "\u25CF";
            label += "mine";
          } else {
            cls += " rev";
            if (cell.adj > 0) { cls += " n" + cell.adj; txt = String(cell.adj); label += cell.adj; }
            else label += "empty";
          }
        } else if (cell.st === 2) {
          cls += " flag";
          if (loseMode && !cell.mine) cls += " wrong";
          txt = "\u2691";
          label += "flagged";
        } else if (cell.st === 3) {
          cls += " q";
          txt = "?";
          label += "unsure";
        } else label += "covered";
        if (el.className !== cls) el.className = cls;
        if (el.textContent !== txt) el.textContent = txt;
        el.setAttribute("aria-label", label);
      }

      // ---- events ----
      var lpTimer = null, suppressClick = false, lastLP = 0, lpStart = null;

      function bindCell(btn, r, c) {
        btn.addEventListener("click", function () {
          if (suppressClick) { suppressClick = false; return; }
          if (flagMode) flagCycle(r, c);
          else reveal(r, c);
        });
        btn.addEventListener("contextmenu", function (e) {
          e.preventDefault();
          if (Date.now() - lastLP < 450) return; // long-press already handled it
          flagCycle(r, c);
        });
        btn.addEventListener("pointerdown", function (e) {
          if (state === "won" || state === "lost") return;
          lpStart = { x: e.clientX, y: e.clientY };
          lpTimer = t(function () {
            lastLP = Date.now();
            suppressClick = true;
            flagCycle(r, c);
          }, 380);
        });
        btn.addEventListener("pointermove", function (e) {
          if (!lpStart || !lpTimer) return;
          if (Math.abs(e.clientX - lpStart.x) > 8 || Math.abs(e.clientY - lpStart.y) > 8) {
            clearT(lpTimer); lpTimer = null;
          }
        });
        var cancel = function () { if (lpTimer) { clearT(lpTimer); lpTimer = null; } lpStart = null; };
        btn.addEventListener("pointerup", cancel);
        btn.addEventListener("pointercancel", cancel);
        btn.addEventListener("pointerleave", cancel);
      }

      var flagBtn = $("btnFlagMode");
      flagBtn.addEventListener("click", function () {
        flagMode = !flagMode;
        flagBtn.setAttribute("aria-pressed", String(flagMode));
      });

      $("btnRestart").addEventListener("click", newGame);
      $("btnAgain").addEventListener("click", newGame);

      newGame();
      try { root.focus({ preventScroll: true }); } catch (e) { root.focus(); }

      return {
        onClose: function () {
          stopTimer();
          for (var i = 0; i < timeouts.length; i++) clearTimeout(timeouts[i]);
          timeouts.length = 0;
        }
      };
    }
  };
})();
