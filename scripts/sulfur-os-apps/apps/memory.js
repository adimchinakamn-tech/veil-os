/* Sulfur OS app — Memory Match: flip pairs, chain streaks, earn coins. */
(function () {
"use strict";
var REG = window.SulfurApps || (window.SulfurApps = {});
REG["memory"] = {
    id: "memory", name: "Memory Match", desc: "flip pairs, chain streaks — every win pays coins.",
    icon: "grid", color: "#22c55e", cat: "game", w: 560, h: 660,
    mount: function (root, ctx) {
        root.className = "so-module";
        var st = document.createElement("style");
        st.textContent = [
            ".mm{height:100%;display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px;overflow:auto;background:#0c0d18;color:#e4e4e7}",
            ".mm *{box-sizing:border-box}",
            ".mm .hd{display:flex;gap:14px;align-items:center;font-size:12.5px;color:#a1a1aa}",
            ".mm .hd b{color:#4ade80;font-family:ui-monospace,monospace}",
            ".mm .grid{display:grid;grid-template-columns:repeat(4,74px);gap:9px}",
            ".mm .c{width:74px;height:74px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:#181a2a;cursor:pointer;font-size:28px;display:flex;align-items:center;justify-content:center;transition:transform .2s,background .2s;color:transparent}",
            ".mm .c.up{background:#20223a;color:#e4e4e7;transform:rotateY(0) scale(1.02)}",
            ".mm .c.done{background:rgba(34,197,94,.16);border-color:rgba(34,197,94,.4);color:#86efac;cursor:default}",
            ".mm .msg{font-size:13px;color:#fbbf24;font-weight:700;min-height:20px}"
        ].join("\n");
        root.appendChild(st);
        var EMO = ["🍎","🚀","🎧","🌵","🎲","🔥","🌙","⚡"];
        var g = { first: null, lock: false, moves: 0, found: 0, streak: 0 };
        var wrap = document.createElement("div");
        wrap.className = "mm";
        wrap.innerHTML = "<div class='hd'>moves <b id='mmM'>0</b> · pairs <b id='mmP'>0/8</b> · streak <b id='mmS'>0</b></div><div class='msg' id='mmMsg'></div><div class='grid' id='mmG'></div><button class='so-btn primary' style='--acc:#22c55e' id='mmNew'>new game</button>";
        root.appendChild(wrap);
        var $ = function (id) { return wrap.querySelector("#" + id); };
        function deal() {
            var deck = EMO.concat(EMO);
            for (var i = deck.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
            g = { first: null, lock: false, moves: 0, found: 0, streak: 0 };
            $("mmG").innerHTML = "";
            deck.forEach(function (e, idx) {
                var c = document.createElement("button");
                c.className = "c"; c.type = "button";
                c.dataset.v = e;
                c.setAttribute("aria-label", "card");
                c.addEventListener("click", function () { flip(c); });
                $("mmG").appendChild(c);
            });
            paint();
        }
        function paint() {
            $("mmM").textContent = g.moves;
            $("mmP").textContent = g.found + "/8";
            $("mmS").textContent = g.streak;
        }
        function flip(c) {
            if (g.lock || c.classList.contains("up") || c.classList.contains("done")) return;
            c.classList.add("up");
            c.textContent = c.dataset.v;
            if (!g.first) { g.first = c; return; }
            g.moves++;
            if (g.first.dataset.v === c.dataset.v) {
                g.streak++; g.found++;
                g.first.classList.add("done"); c.classList.add("done");
                g.first = null;
                paint();
                if (g.found === 8) {
                    var pay = Math.max(6, 30 - g.moves);
                    ctx.coins.add(pay);
                    $("mmMsg").textContent = "cleared in " + g.moves + " moves — +" + pay + " coins";
                }
            } else {
                g.streak = 0;
                g.lock = true;
                var a = g.first; g.first = null;
                paint();
                setTimeout(function () {
                    a.classList.remove("up"); a.textContent = "";
                    c.classList.remove("up"); c.textContent = "";
                    g.lock = false;
                }, 700);
            }
        }
        $("mmNew").addEventListener("click", deal);
        deal();
    }
};
})();
