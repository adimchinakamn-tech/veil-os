/* Sulfur OS app module — 2048 (ported from the standalone Sulfur OS page) */
(function () {
  "use strict";
  var REG = window.SulfurApps || (window.SulfurApps = {});
  REG["2048"] = {
    id: "2048",
    name: "2048",
    desc: "Slide and merge tiles to build the golden 2048.",
    icon: "grid",
    color: "#f59e0b",
    cat: "game",
    w: 470, h: 640,
    mount: function (root, ctx) {
      root.style.setProperty("--acc", "#f59e0b");

      var st = document.createElement("style");
      st.textContent = [
        ".sa-2048{position:relative;height:100%;display:flex;flex-direction:column;align-items:center;gap:12px;padding:12px 12px 14px;overflow:auto;background:#0c0c0e;color:#e4e4e7;font:13.5px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}",
        ".sa-2048 *{box-sizing:border-box}",
        ".sa-2048 .app{width:100%;max-width:460px;display:flex;flex-direction:column;gap:12px;min-width:0}",
        ".sa-2048 .hrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
        ".sa-2048 .hrow .name{font-size:15px;font-weight:700;letter-spacing:.01em}",
        ".sa-2048 .spacer{flex:1}",
        ".sa-2048 .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
        ".sa-2048 .btn{min-height:36px;min-width:36px;padding:0 14px;border-radius:8px;border:1px solid #27272a;background:#18181b;color:#e4e4e7;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px;transition:background .15s,border-color .15s,transform .06s}",
        ".sa-2048 .btn:hover{background:#202024;border-color:#3f3f46}",
        ".sa-2048 .btn:active{transform:scale(.98)}",
        ".sa-2048 .btn:focus-visible{outline:2px solid var(--acc);outline-offset:2px}",
        ".sa-2048 .btn.primary{background:var(--acc);border-color:var(--acc);color:#1c1917}",
        ".sa-2048 .btn.primary:hover{filter:brightness(1.08)}",
        ".sa-2048 .btn.sq{width:36px;padding:0;font-size:15px}",
        ".sa-2048 .hud{display:flex;gap:8px;flex-wrap:wrap}",
        ".sa-2048 .stat{position:relative;display:flex;flex-direction:column;align-items:center;background:#18181b;border:1px solid #27272a;border-radius:12px;padding:6px 16px;min-width:84px;flex:1}",
        ".sa-2048 .stat .label{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#a1a1aa;font-weight:600}",
        ".sa-2048 .stat .value{font-size:18px;font-weight:700;color:var(--acc);line-height:1.3}",
        ".sa-2048 .sf{position:absolute;top:-4px;right:10px;font-size:13px;font-weight:700;color:#fbbf24;opacity:0;pointer-events:none}",
        ".sa-2048 .sf.go{animation:sa2048floatUp .6s ease-out}",
        "@keyframes sa2048floatUp{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-26px)}}",
        ".sa-2048 .board{position:relative;width:min(88%,420px);aspect-ratio:1;margin:0 auto;background:#101013;border:1px solid #27272a;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);touch-action:none;user-select:none;-webkit-user-select:none}",
        ".sa-2048 .bg{position:absolute;inset:0;display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(4,1fr);gap:2.5%;padding:2.5%}",
        ".sa-2048 .bg i{background:#18181b;border-radius:8px}",
        ".sa-2048 .tiles{position:absolute;inset:0}",
        ".sa-2048 .tile{position:absolute;left:2.5%;top:2.5%;width:21.875%;height:21.875%;transition:transform .13s ease-in-out;z-index:5}",
        ".sa-2048 .tile.ghost{z-index:4;opacity:.7}",
        ".sa-2048 .tile-inner{position:absolute;inset:0;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:800;background:#27272a;color:#e4e4e7;box-shadow:0 2px 6px rgba(0,0,0,.35)}",
        ".sa-2048 .tile.new .tile-inner{animation:sa2048in .19s ease}",
        ".sa-2048 .tile.merged .tile-inner{animation:sa2048pop .17s ease}",
        "@keyframes sa2048in{from{opacity:0;transform:scale(.35)}to{opacity:1;transform:scale(1)}}",
        "@keyframes sa2048pop{0%{transform:scale(1)}45%{transform:scale(1.18)}100%{transform:scale(1)}}",
        ".sa-2048 .len1 .tile-inner,.sa-2048 .len2 .tile-inner{font-size:clamp(26px,8.4vw,42px)}",
        ".sa-2048 .len3 .tile-inner{font-size:clamp(21px,6.7vw,33px)}",
        ".sa-2048 .len4 .tile-inner{font-size:clamp(17px,5.4vw,27px)}",
        ".sa-2048 .len5 .tile-inner{font-size:clamp(13px,4.3vw,21px)}",
        ".sa-2048 .tile-inner[data-v=\"2\"]{background:#27272a;color:#e4e4e7}",
        ".sa-2048 .tile-inner[data-v=\"4\"]{background:#3f3f46;color:#e4e4e7}",
        ".sa-2048 .tile-inner[data-v=\"8\"]{background:#54432c;color:#fde68a}",
        ".sa-2048 .tile-inner[data-v=\"16\"]{background:#68511f;color:#fef3c7}",
        ".sa-2048 .tile-inner[data-v=\"32\"]{background:#7d5c19;color:#fff}",
        ".sa-2048 .tile-inner[data-v=\"64\"]{background:#946914;color:#fff}",
        ".sa-2048 .tile-inner[data-v=\"128\"]{background:#ad770f;color:#fff}",
        ".sa-2048 .tile-inner[data-v=\"256\"]{background:#b97f0e;color:#fff}",
        ".sa-2048 .tile-inner[data-v=\"512\"]{background:#dd910c;color:#1c1917}",
        ".sa-2048 .tile-inner[data-v=\"1024\"]{background:#eda50b;color:#1c1917}",
        ".sa-2048 .tile-inner[data-v=\"2048\"]{background:#f59e0b;color:#1c1917;box-shadow:0 0 22px rgba(245,158,11,.55),0 2px 6px rgba(0,0,0,.35)}",
        ".sa-2048 .tile-inner[data-v=\"big\"]{background:#fbbf24;color:#1c1917;box-shadow:0 0 30px rgba(251,191,36,.6),0 2px 6px rgba(0,0,0,.35)}",
        ".sa-2048 .overlay{position:absolute;inset:0;border-radius:12px;background:rgba(9,9,11,.87);display:flex;align-items:center;justify-content:center;z-index:20;opacity:0;pointer-events:none;transition:opacity .25s}",
        ".sa-2048 .overlay.show{opacity:1;pointer-events:auto}",
        ".sa-2048 .ov-card{text-align:center;padding:18px}",
        ".sa-2048 .ov-title{margin:0;font-size:24px;font-weight:800}",
        ".sa-2048 .ov-title.win{color:var(--acc)}",
        ".sa-2048 .ov-title.lose{color:#fb7185}",
        ".sa-2048 .ov-sub{margin:8px 0 16px;font-size:14px;color:#a1a1aa}",
        ".sa-2048 .ov-sub b{color:#e4e4e7}",
        ".sa-2048 .ov-btns{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}",
        ".sa-2048 .hint{font-size:12px;color:#a1a1aa;margin:0;text-align:center;line-height:1.5}",
        ".sa-2048 .hint b{color:var(--acc)}"
      ].join("\n");
      root.appendChild(st);

      var wrap = document.createElement("div");
      wrap.className = "sa-2048";
      root.appendChild(wrap);
      wrap.innerHTML = [
        '<div class="app">',
        '  <div class="hrow">',
        '    <span class="name">2048</span><span class="spacer"></span>',
        '    <button class="btn sq" data-el="btnHelp" aria-label="How to play">?</button>',
        '    <button class="btn" data-el="btnNew">New game</button>',
        '  </div>',
        '  <div class="hud">',
        '    <div class="stat"><span class="label">Score</span><span class="value mono" data-el="score">0</span><span class="sf" data-el="scoreFloat" aria-hidden="true"></span></div>',
        '    <div class="stat"><span class="label">Best</span><span class="value mono" data-el="best">0</span></div>',
        '  </div>',
        '  <div class="board" data-el="board" aria-label="2048 board. Use arrow keys or swipe to slide tiles.">',
        '    <div class="bg" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>',
        '    <div class="tiles" data-el="tiles" aria-hidden="true"></div>',
        '    <div class="overlay" data-el="overlay">',
        '      <div class="ov-card">',
        '        <p class="ov-title" data-el="ovTitle">Game over</p>',
        '        <p class="ov-sub" data-el="ovSub"></p>',
        '        <div class="ov-btns">',
        '          <button class="btn" data-el="btnKeep" hidden>Keep going</button>',
        '          <button class="btn primary" data-el="btnAgain">Play again</button>',
        '        </div>',
        '      </div>',
        '    </div>',
        '  </div>',
        '  <p class="hint">Arrow keys / WASD / swipe to slide \u00B7 merge equal tiles to reach <b>2048</b></p>',
        '</div>',
        '<div class="modal" data-el="helpModal" role="dialog" aria-modal="true" style="position:absolute;inset:0;background:rgba(0,0,0,.65);display:none;align-items:center;justify-content:center;z-index:60;padding:16px">',
        '  <div class="card" style="background:#18181b;border:1px solid #27272a;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);max-width:400px;width:100%;padding:18px">',
        '    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><h2 style="margin:0;font-size:15px;font-weight:700;flex:1">How to play</h2><button class="btn sq" data-el="btnClose" aria-label="Close help">\u2715</button></div>',
        '    <ul style="margin:0;padding-left:18px;font-size:13px;color:#d4d4d8;line-height:1.65">',
        '      <li><b>Slide</b> \u2014 arrow keys, WASD, or swipe. Every tile moves as far as it can.</li>',
        '      <li><b>Merge</b> \u2014 two equal tiles colliding fuse into one, doubling its value.</li>',
        '      <li><b>Score</b> \u2014 each merge adds the new tile\u2019s value to your score. Best is saved locally.</li>',
        '      <li><b>Win</b> \u2014 build the <b>2048</b> tile, then keep going for a higher score if you dare.</li>',
        '      <li><b>Lose</b> \u2014 the board fills up and no slide can move. New game starts over.</li>',
        '    </ul>',
        '  </div>',
        '</div>'
      ].join("\n");

      var $ = function (name) { return wrap.querySelector('[data-el="' + name + '"]'); };

      var SIZE = 4;
      var STEP = 111.42857142857143; // (cell% + gap%) / cell% — translate % of tile width
      var tilesEl = $("tiles"), board = $("board"), overlay = $("overlay");
      var scoreEl = $("score"), bestEl = $("best"), scoreFloat = $("scoreFloat");
      var ovTitle = $("ovTitle"), ovSub = $("ovSub"), btnKeep = $("btnKeep");

      var timeouts = [];
      function t(fn, ms) { var id = setTimeout(fn, ms); timeouts.push(id); return id; }

      var grid, tiles, ghosts, idSeq, score, best, won, over;
      best = parseInt(ctx.storage.get("best", "0") || "", 10) || 0;
      bestEl.textContent = best;

      function reset() {
        grid = [[null, null, null, null], [null, null, null, null], [null, null, null, null], [null, null, null, null]];
        tiles = []; ghosts = []; idSeq = 1;
        score = 0; won = false; over = false;
        scoreEl.textContent = "0";
        overlay.classList.remove("show");
        tilesEl.innerHTML = "";
        spawn(); spawn();
        render();
      }

      function spawn() {
        var empty = [];
        for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) if (!grid[r][c]) empty.push([r, c]);
        if (!empty.length) return null;
        var cell = empty[Math.floor(Math.random() * empty.length)];
        var tl = { id: idSeq++, r: cell[0], c: cell[1], v: Math.random() < 0.9 ? 2 : 4, el: null, fresh: true, popped: false };
        grid[tl.r][tl.c] = tl;
        tiles.push(tl);
        return tl;
      }

      // dir: 0 left, 1 right, 2 up, 3 down
      function move(dir) {
        if (over) return;
        var moved = false, gained = 0, mergeSrcs = [];
        var horiz = dir < 2;
        for (var line = 0; line < SIZE; line++) {
          var list = [];
          for (var i = 0; i < SIZE; i++) {
            var tl = horiz ? grid[line][i] : grid[i][line];
            if (tl) list.push(tl);
          }
          if (dir === 1 || dir === 3) list.reverse();
          var out = [];
          for (var j = 0; j < list.length; j++) {
            var tile = list[j], lastT = out.length ? out[out.length - 1] : null;
            if (lastT && lastT.v === tile.v && !lastT.merged) {
              lastT.v *= 2; lastT.merged = true; lastT.popped = false;
              gained += lastT.v; moved = true;
              mergeSrcs.push({ src: tile, dst: lastT });
            } else {
              tile.merged = false;
              out.push(tile);
            }
          }
          for (var k = 0; k < out.length; k++) {
            var tt = out[k];
            var pos = (dir === 0 || dir === 2) ? k : SIZE - 1 - k;
            if (horiz) {
              if (tt.r !== line || tt.c !== pos) moved = true;
              tt.r = line; tt.c = pos;
            } else {
              if (tt.c !== line || tt.r !== pos) moved = true;
              tt.c = line; tt.r = pos;
            }
          }
          for (var m = 0; m < SIZE; m++) { if (horiz) grid[line][m] = null; else grid[m][line] = null; }
          for (var n = 0; n < out.length; n++) {
            if (horiz) grid[line][out[n].c] = out[n]; else grid[out[n].r][line] = out[n];
          }
        }
        if (!moved) return;
        var now = Date.now();
        for (var g = 0; g < mergeSrcs.length; g++) {
          var pr = mergeSrcs[g];
          pr.src.r = pr.dst.r; pr.src.c = pr.dst.c;
          pr.src.isGhost = true;
          ghosts.push({ tile: pr.src, until: now + 150 });
          (function (src) {
            t(function () {
              if (src.el && src.el.parentNode) src.el.parentNode.removeChild(src.el);
            }, 165);
          })(pr.src);
          var idx = tiles.indexOf(pr.src);
          if (idx >= 0) tiles.splice(idx, 1);
        }
        spawn();
        if (gained > 0) {
          score += gained;
          scoreEl.textContent = score;
          if (score > best) { best = score; bestEl.textContent = best; ctx.storage.set("best", String(best)); }
          scoreFloat.textContent = "+" + gained;
          scoreFloat.classList.remove("go");
          void scoreFloat.offsetWidth;
          scoreFloat.classList.add("go");
        }
        var has2048 = false;
        for (var q = 0; q < tiles.length; q++) if (tiles[q].v === 2048) { has2048 = true; break; }
        if (!won && has2048) { won = true; showEnd(true); ctx.toast("You built 2048 — keep going?", "ok"); }
        else if (!canMove()) { over = true; showEnd(false); }
        render();
      }

      function canMove() {
        for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) {
          var v = grid[r][c] ? grid[r][c].v : 0;
          if (v === 0) return true;
          if (c + 1 < SIZE && grid[r][c + 1] && grid[r][c + 1].v === v) return true;
          if (r + 1 < SIZE && grid[r + 1][c] && grid[r + 1][c].v === v) return true;
        }
        return false;
      }

      function showEnd(win) {
        ovTitle.textContent = win ? "You win!" : "Game over";
        ovTitle.className = "ov-title " + (win ? "win" : "lose");
        ovSub.textContent = "";
        ovSub.appendChild(document.createTextNode("Score "));
        var b1 = document.createElement("b"); b1.textContent = score; ovSub.appendChild(b1);
        ovSub.appendChild(document.createTextNode(" \u00B7 Best "));
        var b2 = document.createElement("b"); b2.textContent = best; ovSub.appendChild(b2);
        btnKeep.hidden = !win;
        overlay.classList.add("show");
      }

      // ---- rendering ----
      function makeEl(tl) {
        var el = document.createElement("div");
        el.className = "tile";
        var inner = document.createElement("div");
        inner.className = "tile-inner";
        el.appendChild(inner);
        tl.el = el;
        tilesEl.appendChild(el);
      }

      function render() {
        var now = Date.now();
        for (var i = ghosts.length - 1; i >= 0; i--) {
          var g = ghosts[i];
          if (g.until <= now) {
            if (g.tile.el && g.tile.el.parentNode) g.tile.el.parentNode.removeChild(g.tile.el);
            ghosts.splice(i, 1);
          } else if (!g.tile.el) {
            makeEl(g.tile);
          }
        }
        var all = tiles.concat(ghosts.map(function (g) { return g.tile; }));
        for (var j = 0; j < all.length; j++) {
          var tl = all[j];
          if (!tl.el) makeEl(tl);
          tl.el.style.transform = "translate(" + (tl.c * STEP) + "%," + (tl.r * STEP) + "%)";
          var inner = tl.el.firstChild;
          var vAttr = tl.v <= 2048 ? String(tl.v) : "big";
          if (inner.getAttribute("data-v") !== vAttr) inner.setAttribute("data-v", vAttr);
          var text = String(tl.v);
          if (inner.textContent !== text) inner.textContent = text;
          var len = Math.min(5, text.length);
          var lenClass = "tile len" + len;
          if (tl.isGhost) lenClass += " ghost";
          if (tl.fresh) { lenClass += " new"; tl.fresh = false; }
          else if (!tl.popped && tl.merged) { lenClass += " merged"; tl.popped = true; }
          if (tl.el.className !== lenClass) tl.el.className = lenClass;
        }
      }

      // ---- input ----
      var helpOpen = false;
      var KEYS = { ArrowLeft: 0, ArrowRight: 1, ArrowUp: 2, ArrowDown: 3, a: 0, d: 1, w: 2, s: 3, A: 0, D: 1, W: 2, S: 3 };
      function grabKeys() { try { root.focus({ preventScroll: true }); } catch (e) { root.focus(); } }

      root.addEventListener("keydown", function (e) {
        if (e.target && e.target.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
        if (helpOpen) { if (e.key === "Escape") { e.preventDefault(); setHelp(false); } return; }
        var d = KEYS[e.key];
        if (d !== undefined) { e.preventDefault(); move(d); }
      });

      var touch = null;
      board.addEventListener("touchstart", function (e) {
        if (e.touches.length === 1) touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }, { passive: true });
      board.addEventListener("touchend", function (e) {
        if (!touch) return;
        var dx = e.changedTouches[0].clientX - touch.x;
        var dy = e.changedTouches[0].clientY - touch.y;
        touch = null;
        if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
        if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : 0);
        else move(dy > 0 ? 3 : 2);
      });

      $("btnNew").addEventListener("click", function () { reset(); grabKeys(); });
      $("btnAgain").addEventListener("click", function () { reset(); grabKeys(); });
      btnKeep.addEventListener("click", function () { overlay.classList.remove("show"); grabKeys(); });

      var helpModal = $("helpModal"), btnHelp = $("btnHelp"), btnClose = $("btnClose");
      function setHelp(open) {
        helpOpen = open;
        helpModal.style.display = open ? "flex" : "none";
        if (open) btnClose.focus(); else btnHelp.focus();
      }
      btnHelp.addEventListener("click", function () { setHelp(true); });
      btnClose.addEventListener("click", function () { setHelp(false); });
      helpModal.addEventListener("click", function (e) { if (e.target === helpModal) setHelp(false); });

      reset();
      grabKeys();

      return {
        onClose: function () {
          for (var i = 0; i < timeouts.length; i++) clearTimeout(timeouts[i]);
          timeouts.length = 0;
        }
      };
    }
  };
})();
