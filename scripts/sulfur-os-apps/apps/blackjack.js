/* Sulfur OS app — Blackjack: bet coins, hit, stand, double. The
   dealer stands on 17. Coins persist through the shared economy. */
(function () {
"use strict";
var REG = window.SulfurApps || (window.SulfurApps = {});
REG["blackjack"] = {
    id: "blackjack", name: "Blackjack", desc: "bet coins against the dealer — blackjack pays 3:2.",
    icon: "cards", color: "#a855f7", cat: "game", w: 620, h: 660,
    mount: function (root, ctx) {
        root.className = "so-module";
        root.style.setProperty("--acc", "#a855f7");
        var st = document.createElement("style");
        st.textContent = [
            ".bj{height:100%;display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px;overflow:auto;background:radial-gradient(120% 90% at 50% 0%,#12241a 0%,#0c0d18 60%);color:#e4e4e7}",
            ".bj *{box-sizing:border-box}",
            ".bj .tbl{width:100%;max-width:470px;flex:1;display:flex;flex-direction:column;gap:10px;border:1px solid rgba(34,197,94,.25);border-radius:17px;background:rgba(20,60,35,.35);padding:16px;min-height:300px}",
            ".bj .row{display:flex;gap:8px;flex-wrap:wrap;min-height:96px;align-content:flex-start}",
            ".bj .lab{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#86efac;opacity:.85}",
            ".bj .lab.dlr{color:#fca5a5}",
            ".bj .pc{position:relative;width:66px;height:94px;border-radius:9px;background:#f7f7f4;color:#16181d;box-shadow:0 6px 16px rgba(0,0,0,.4);display:flex;flex-direction:column;justify-content:space-between;padding:7px 8px;font-family:ui-monospace,monospace;font-size:13px;font-weight:700;transform:translateY(0);animation:bjDeal .3s ease}",
            "@keyframes bjDeal{from{transform:translateY(-16px) rotate(-4deg);opacity:0}}",
            ".bj .pc.red{color:#dc2626}",
            ".bj .pc.hole{background:repeating-linear-gradient(45deg,#312e81,#312e81 6px,#4338ca 6px,#4338ca 12px);color:transparent}",
            ".bj .pc .rk{font-size:14px}.bj .pc .su{font-size:15px;align-self:flex-end}",
            ".bj .tot{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:22px;padding:0 7px;border-radius:99px;background:rgba(255,255,255,.1);font-size:12px;font-weight:700;font-family:ui-monospace,monospace}",
            ".bj .ctrl{display:flex;gap:8px;flex-wrap:wrap;width:100%;max-width:470px}",
            ".bj .bet{display:flex;gap:6px;align-items:center;width:100%;max-width:470px;flex-wrap:wrap}",
            ".bj .chips{display:flex;gap:6px}",
            ".bj .chip{width:40px;height:40px;border-radius:99px;border:3px dashed rgba(255,255,255,.5);font-weight:800;font-size:12px;color:#fff;cursor:pointer;font-family:ui-monospace,monospace}",
            ".bj .chip:hover{transform:translateY(-2px)}",
            ".bj .res{width:100%;max-width:470px;text-align:center;font-size:15px;font-weight:800;min-height:22px;color:#fbbf24}",
            ".bj .hand-tot{display:flex;gap:7px;align-items:center}"
        ].join("\n");
        root.appendChild(st);

        var coins = 0;
        try { coins = JSON.parse(ctx.storage.get("coins", "0")) || 0; } catch (e) {}
        /* bridge into the shared economy: prefer the OS coins when present */
        if (ctx.coins && ctx.coins.get) { coins = ctx.coins.get(); }
        var g = { bet: 10, ph: [], dh: [], phase: "bet", msg: "" };

        var wrap = document.createElement("div");
        wrap.className = "bj";
        root.appendChild(wrap);
        wrap.innerHTML =
            "<div class='res' id='bjRes'>place your bet</div>" +
            "<div class='tbl'>" +
            "<div><div class='lab dlr'>DEALER <span class='tot' id='bjDT' hidden>0</span></div><div class='row' id='bjD'></div></div>" +
            "<div style='flex:1'></div>" +
            "<div><div class='lab'>YOU <span class='tot' id='bjPT' hidden>0</span></div><div class='row' id='bjP'></div></div>" +
            "</div>" +
            "<div class='bet'><span style='color:#a1a1aa;font-weight:700;font-size:12.5px'>BET</span><b id='bjBet' style='font-size:16px;color:#fbbf24'>10</b>" +
            "<span class='chips'><button class='chip' style='background:#ef4444' data-v='5'>5</button><button class='chip' style='background:#3b82f6' data-v='25'>25</button><button class='chip' style='background:#22c55e' data-v='100'>100</button><button class='chip' style='background:#e5e7eb;color:#111' data-v='0'>clear</button></span></div>" +
            "<div class='ctrl'>" +
            "<button class='so-btn primary' id='bjDealB'>deal</button>" +
            "<button class='so-btn' id='bjHit' disabled>hit</button>" +
            "<button class='so-btn' id='bjStand' disabled>stand</button>" +
            "<button class='so-btn' id='bjDbl' disabled>double</button>" +
            "</div>";

        var $ = function (id) { return wrap.querySelector("#" + id); };
        var SUITS = ["♠", "♥", "♦", "♣"], RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
        function shoe() {
            var d = [];
            SUITS.forEach(function (s) { RANKS.forEach(function (r) { d.push({ r: r, s: s }); }); });
            for (var i = d.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = d[i]; d[i] = d[j]; d[j] = t; }
            return d;
        }
        function val(h) {
            var v = 0, aces = 0;
            h.forEach(function (c) {
                if (c.r === "A") { aces++; v += 11; }
                else if (["J", "Q", "K"].indexOf(c.r) > -1) v += 10;
                else v += parseInt(c.r, 10);
            });
            while (v > 21 && aces > 0) { v -= 10; aces--; }
            return v;
        }
        function card(c, hole) {
            var d = document.createElement("div");
            var red = c.s === "♥" || c.s === "♦";
            d.className = "pc" + (red ? " red" : "") + (hole ? " hole" : "");
            if (!hole) d.innerHTML = "<span class='rk'>" + c.r + "</span><span class='su'>" + c.s + "</span>";
            return d;
        }
        function paint() {
            $("bjBet").textContent = g.bet;
            var dp = $("bjD"), pp = $("bjP");
            dp.innerHTML = ""; pp.innerHTML = "";
            g.dh.forEach(function (c, i) { dp.appendChild(card(c, i === 1 && g.phase === "play")); });
            g.ph.forEach(function (c) { pp.appendChild(card(c)); });
            var showDT = g.dh.length > 0;
            $("bjDT").hidden = !showDT;
            if (g.phase === "play" && g.dh.length) {
                $("bjDT").textContent = val(g.dh.slice(0, 1)) + "+?";
            } else {
                $("bjDT").textContent = val(g.dh);
            }
            $("bjPT").hidden = g.ph.length === 0;
            $("bjPT").textContent = val(g.ph);
            $("bjRes").textContent = g.msg || (g.phase === "bet" ? "place your bet" : "");
            $("bjDealB").disabled = g.phase === "play";
            $("bjHit").disabled = g.phase !== "play";
            $("bjStand").disabled = g.phase !== "play";
            $("bjDbl").disabled = g.phase !== "play" || g.ph.length !== 2;
        }
        function settle(delta, msg) {
            g.phase = "bet";
            if (delta > 0) { g.msg = msg + " — you win " + delta + "!"; ctx.coins.add(delta); ctx.toast("+" + delta + " coins — blackjack", "ok"); }
            else if (delta < 0) { g.msg = msg + " — you lose " + (-delta) + "."; ctx.coins.spend(Math.min(-delta, 9999)); }
            else { g.msg = msg + " — push."; }
            paint();
        }
        function dealerPlay() {
            g.phase = "dealer";
            while (val(g.dh) < 17) g.dh.push(deck.pop());
            var pv = val(g.ph), dv = val(g.dh);
            if (dv > 21) settle(g.bet, "dealer busts (" + dv + ")");
            else if (dv > pv) settle(-g.bet, "dealer " + dv + " beats your " + pv);
            else if (dv < pv) settle(g.bet, "your " + pv + " beats dealer " + dv);
            else settle(0, "push at " + pv);
        }
        var deck = shoe();
        function deal() {
            if (g.bet <= 0) { ctx.toast("click a chip to bet first", "err"); return; }
            if (deck.length < 20) deck = shoe();
            g.ph = [deck.pop(), deck.pop()];
            g.dh = [deck.pop(), deck.pop()];
            g.msg = "";
            g.phase = "play";
            if (val(g.ph) === 21) {
                g.phase = "done";
                var win = Math.floor(g.bet * 1.5);
                settle(win, "BLACKJACK");
                return;
            }
            paint();
        }
        $("bjDealB").addEventListener("click", deal);
        $("bjHit").addEventListener("click", function () {
            g.ph.push(deck.pop());
            if (val(g.ph) > 21) settle(-g.bet, "you bust (" + val(g.ph) + ")");
            else paint();
        });
        $("bjStand").addEventListener("click", dealerPlay);
        $("bjDbl").addEventListener("click", function () {
            if (g.ph.length !== 2) return;
            g.bet = Math.min(g.bet * 2, 5000);
            g.ph.push(deck.pop());
            if (val(g.ph) > 21) settle(-g.bet, "you bust (" + val(g.ph) + ")");
            else dealerPlay();
        });
        wrap.querySelectorAll(".chip").forEach(function (ch) {
            ch.addEventListener("click", function () {
                if (g.phase === "play") return;
                var v = parseInt(ch.getAttribute("data-v"), 10);
                g.bet = v === 0 ? 0 : Math.min(g.bet + v, 5000);
                paint();
            });
        });
        paint();
        window.__sulfurOpenBlackjack = function () {
            var os = window.__sulfurOS;
            if (os && os.openApp) os.openApp("blackjack");
        };
    }
};
})();
