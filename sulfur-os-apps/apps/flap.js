/* Sulfur OS app — Flap: one-tap flight through the gaps. */
(function () {
"use strict";
var REG = window.SulfurApps || (window.SulfurApps = {});
REG["flap"] = {
    id: "flap", name: "Flap", desc: "one tap, infinite gaps — medals pay coins.",
    icon: "play", color: "#eab308", cat: "game", w: 480, h: 660,
    mount: function (root, ctx) {
        root.className = "so-module";
        var st = document.createElement("style");
        st.textContent = [
            ".fl{height:100%;display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px;overflow:auto;background:#0c0d18;color:#e4e4e7}",
            ".fl canvas{border-radius:14px;background:linear-gradient(180deg,#1a2340,#0e1220);border:1px solid rgba(255,255,255,.09);touch-action:none;max-width:100%}",
            ".fl .hd{font-size:12.5px;color:#a1a1aa}",
            ".fl .hd b{color:#fde047;font-family:ui-monospace,monospace}"
        ].join("\n");
        root.appendChild(st);
        var wrap = document.createElement("div");
        wrap.className = "fl";
        wrap.innerHTML = "<div class='hd'>score <b id='flS'>0</b> · best <b id='flB'>0</b></div><canvas width='380' height='560' aria-label='flap game'></canvas><button class='so-btn primary' style='--acc:#eab308' id='flGo'>start / flap (space)</button>";
        root.appendChild(wrap);
        var cv = wrap.querySelector("canvas"), g = cv.getContext("2d");
        var W = cv.width, H = cv.height;
        var best = parseInt(ctx.storage.get("best", "0"), 10) || 0;
        var G = { y: H / 2, v: 0, pipes: [], t: 0, score: 0, live: false };
        function paintHd() {
            wrap.querySelector("#flS").textContent = G.score;
            wrap.querySelector("#flB").textContent = best;
        }
        function reset() {
            G = { y: H / 2, v: 0, pipes: [], t: 0, score: 0, live: false };
            paintHd();
        }
        function flap() {
            if (!G.live) { G.live = true; G.v = -6.4; return; }
            G.v = -6.4;
        }
        function draw() {
            g.clearRect(0, 0, W, H);
            /* pipes */
            G.pipes.forEach(function (p) {
                g.fillStyle = "#2dd485";
                g.fillRect(p.x, 0, 54, p.top);
                g.fillRect(p.x, p.top + 148, 54, H - p.top - 148);
                g.fillStyle = "rgba(0,0,0,.25)";
                g.fillRect(p.x + 44, 0, 10, p.top);
                g.fillRect(p.x + 44, p.top + 148, 10, H - p.top - 148);
            });
            /* bird */
            g.save();
            g.translate(W / 3, G.y);
            g.rotate(Math.max(-.5, Math.min(.9, G.v / 12)));
            g.fillStyle = "#fde047";
            g.beginPath(); g.ellipse(0, 0, 15, 12, 0, 0, Math.PI * 2); g.fill();
            g.fillStyle = "#18181b";
            g.beginPath(); g.arc(6, -3, 2.6, 0, Math.PI * 2); g.fill();
            g.fillStyle = "#f97316";
            g.beginPath(); g.moveTo(12, 0); g.lineTo(22, 3); g.lineTo(12, 6); g.fill();
            g.restore();
            if (!G.live) {
                g.fillStyle = "rgba(226,232,240,.8)";
                g.font = "700 15px ui-sans-serif,system-ui";
                g.textAlign = "center";
                g.fillText("tap or press space to flap", W / 2, H / 2 - 70);
            }
        }
        var last = 0;
        function step(ts) {
            var dt = Math.min(32, ts - last || 16); last = ts;
            if (G.live) {
                G.v += 0.36 * (dt / 16);
                G.y += G.v * (dt / 16);
                G.t += dt;
                if (G.t > 1500) {
                    G.t = 0;
                    G.pipes.push({ x: W + 30, top: 70 + Math.random() * (H - 320) });
                }
                G.pipes.forEach(function (p) { p.x -= 2.6 * (dt / 16); });
                G.pipes = G.pipes.filter(function (p) { return p.x > -70; });
                /* score */
                G.pipes.forEach(function (p) {
                    if (!p.done && p.x + 54 < W / 3 - 15) { p.done = 1; G.score++; paintHd(); }
                });
                /* collisions */
                var hit = G.y < 8 || G.y > H - 8;
                G.pipes.forEach(function (p) {
                    var bx = W / 3;
                    if (bx + 15 > p.x && bx - 15 < p.x + 54 && (G.y - 12 < p.top || G.y + 12 > p.top + 148)) hit = true;
                });
                if (hit) {
                    G.live = false;
                    if (G.score > best) {
                        best = G.score;
                        ctx.storage.set("best", String(best));
                        var pay = best * 2;
                        ctx.coins.add(pay);
                        ctx.toast("new best " + best + " — +" + pay + " coins", "ok");
                    }
                    paintHd();
                }
            }
            draw();
            requestAnimationFrame(step);
        }
        cv.addEventListener("pointerdown", function () { flap(); });
        wrap.querySelector("#flGo").addEventListener("click", flap);
        document.addEventListener("keydown", function (e) {
            if (e.code === "Space") { e.preventDefault(); flap(); }
        });
        paintHd();
        requestAnimationFrame(step);
    }
};
})();
