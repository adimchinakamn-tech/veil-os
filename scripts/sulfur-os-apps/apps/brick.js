/* Sulfur OS app — Brick Breaker: paddle, ball, five rows, coins. */
(function () {
"use strict";
var REG = window.SulfurApps || (window.SulfurApps = {});
REG["brick"] = {
    id: "brick", name: "Brick Breaker", desc: "paddle, ball, 40 bricks — clear rows for coins.",
    icon: "game", color: "#f97316", cat: "game", w: 620, h: 700,
    mount: function (root, ctx) {
        root.className = "so-module";
        var st = document.createElement("style");
        st.textContent = [
            ".bb{height:100%;display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px;overflow:auto;background:#0c0d18;color:#e4e4e7}",
            ".bb canvas{border-radius:14px;background:#101120;border:1px solid rgba(255,255,255,.09);touch-action:none;max-width:100%}",
            ".bb .hd{display:flex;gap:16px;font-size:12.5px;color:#a1a1aa}",
            ".bb .hd b{color:#fdba74;font-family:ui-monospace,monospace}"
        ].join("\n");
        root.appendChild(st);
        var wrap = document.createElement("div");
        wrap.className = "bb";
        wrap.innerHTML = "<div class='hd'>score <b id='bbS'>0</b> · lives <b id='bbL'>3</b> · level <b id='bbV'>1</b></div><canvas width='540' height='560' aria-label='brick breaker board'></canvas><div style='display:flex;gap:8px'><button class='so-btn primary' style='--acc:#f97316' id='bbGo'>launch</button><button class='so-btn' id='bbNew'>restart</button></div>";
        root.appendChild(wrap);
        var cv = wrap.querySelector("canvas"), g = cv.getContext("2d");
        var W = cv.width, H = cv.height;
        var game = { px: W / 2 - 45, pw: 90, bx: W / 2, by: H - 60, vx: 3.4, vy: -4.2, bricks: [], score: 0, lives: 3, level: 1, live: false };
        function bricksFor(lv) {
            var rows = 4 + Math.min(2, lv), cols = 8, out = [];
            for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
                out.push({ x: 18 + c * 64, y: 60 + r * 26, w: 58, h: 18, hp: r < 2 ? 2 : 1, hue: (r * 47 + lv * 30) % 360 });
            }
            return out;
        }
        game.bricks = bricksFor(1);
        function paintHd() {
            wrap.querySelector("#bbS").textContent = game.score;
            wrap.querySelector("#bbL").textContent = game.lives;
            wrap.querySelector("#bbV").textContent = game.level;
        }
        function draw() {
            g.clearRect(0, 0, W, H);
            /* bricks */
            game.bricks.forEach(function (b) {
                if (b.hp <= 0) return;
                g.fillStyle = b.hp === 2 ? "hsl(" + b.hue + ",80%,62%)" : "hsl(" + b.hue + ",45%,34%)";
                g.fillRect(b.x, b.y, b.w, b.h);
            });
            /* paddle */
            g.fillStyle = "#f97316";
            g.beginPath(); g.roundRect(game.px, H - 26, game.pw, 12, 6); g.fill();
            /* ball */
            g.fillStyle = "#fafafa";
            g.beginPath(); g.arc(game.bx, game.by, 7, 0, Math.PI * 2); g.fill();
            if (!game.live) {
                g.fillStyle = "rgba(226,232,240,.75)";
                g.font = "600 14px ui-sans-serif,system-ui";
                g.textAlign = "center";
                g.fillText("press launch · drag or ← → to move", W / 2, H / 2);
            }
        }
        function step() {
            if (!game.live) { draw(); requestAnimationFrame(step); return; }
            game.bx += game.vx; game.by += game.vy;
            if (game.bx < 8 || game.bx > W - 8) game.vx = -game.vx;
            if (game.by < 8) game.vy = -game.vy;
            /* paddle bounce */
            if (game.by > H - 34 && game.by < H - 18 && game.bx > game.px - 6 && game.bx < game.px + game.pw + 6) {
                game.vy = -Math.abs(game.vy);
                game.vx = ((game.bx - (game.px + game.pw / 2)) / (game.pw / 2)) * 5.2;
            }
            /* floor */
            if (game.by > H + 10) {
                game.lives--;
                paintHd();
                if (game.lives <= 0) {
                    game.live = false;
                    ctx.toast("out of lives — score " + game.score, "err");
                } else { game.bx = W / 2; game.by = H - 60; game.vx = 3.4; game.vy = -4.2; }
            }
            /* bricks */
            game.bricks.forEach(function (b) {
                if (b.hp <= 0) return;
                if (game.bx > b.x - 6 && game.bx < b.x + b.w + 6 && game.by > b.y - 6 && game.by < b.y + b.h + 6) {
                    b.hp--;
                    game.vy = -game.vy;
                    game.score += 10;
                    paintHd();
                }
            });
            var left = game.bricks.filter(function (b) { return b.hp > 0; }).length;
            if (left === 0) {
                game.level++;
                game.bricks = bricksFor(game.level);
                game.bx = W / 2; game.by = H - 60;
                game.live = false;
                ctx.coins.add(25);
                ctx.toast("level " + game.level + "! +25 coins", "ok");
            }
            draw();
            requestAnimationFrame(step);
        }
        cv.addEventListener("mousemove", function (e) {
            var r = cv.getBoundingClientRect();
            var x = (e.clientX - r.left) * (W / r.width);
            game.px = Math.max(0, Math.min(W - game.pw, x - game.pw / 2));
        });
        cv.addEventListener("touchmove", function (e) {
            e.preventDefault();
            var r = cv.getBoundingClientRect();
            var x = (e.touches[0].clientX - r.left) * (W / r.width);
            game.px = Math.max(0, Math.min(W - game.pw, x - game.pw / 2));
        }, { passive: false });
        document.addEventListener("keydown", function (e) {
            if (e.key === "ArrowLeft") game.px = Math.max(0, game.px - 26);
            if (e.key === "ArrowRight") game.px = Math.min(W - game.pw, game.px + 26);
        });
        wrap.querySelector("#bbGo").addEventListener("click", function () { game.live = true; });
        wrap.querySelector("#bbNew").addEventListener("click", function () {
            game.score = 0; game.lives = 3; game.level = 1;
            game.bricks = bricksFor(1);
            game.bx = W / 2; game.by = H - 60; game.live = false;
            paintHd();
        });
        paintHd();
        draw();
        requestAnimationFrame(step);
    }
};
})();
