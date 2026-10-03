/* Sulfur OS app — World Clock (tools pack) */
(function () {
  "use strict";

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  var CITIES = [
    { z: "UTC", n: "UTC", s: "Coordinated Universal" },
    { z: "Pacific/Honolulu", n: "Honolulu", s: "Hawaii" },
    { z: "America/Los_Angeles", n: "Los Angeles", s: "Pacific" },
    { z: "America/Denver", n: "Denver", s: "Mountain" },
    { z: "America/Mexico_City", n: "Mexico City", s: "Central Mexico" },
    { z: "America/Chicago", n: "Chicago", s: "Central" },
    { z: "America/New_York", n: "New York", s: "Eastern" },
    { z: "America/Bogota", n: "Bogot\u00e1", s: "Colombia" },
    { z: "America/Sao_Paulo", n: "S\u00e3o Paulo", s: "Brazil" },
    { z: "America/Buenos_Aires", n: "Buenos Aires", s: "Argentina" },
    { z: "Atlantic/Reykjavik", n: "Reykjav\u00edk", s: "Iceland" },
    { z: "Europe/London", n: "London", s: "United Kingdom" },
    { z: "Europe/Paris", n: "Paris", s: "Central European" },
    { z: "Europe/Berlin", n: "Berlin", s: "Central European" },
    { z: "Europe/Athens", n: "Athens", s: "Eastern European" },
    { z: "Europe/Moscow", n: "Moscow", s: "Moscow Time" },
    { z: "Africa/Cairo", n: "Cairo", s: "Egypt" },
    { z: "Africa/Lagos", n: "Lagos", s: "West Africa" },
    { z: "Africa/Johannesburg", n: "Johannesburg", s: "South Africa" },
    { z: "Asia/Dubai", n: "Dubai", s: "Gulf" },
    { z: "Asia/Kolkata", n: "Mumbai", s: "India" },
    { z: "Asia/Bangkok", n: "Bangkok", s: "Indochina" },
    { z: "Asia/Shanghai", n: "Shanghai", s: "China" },
    { z: "Asia/Tokyo", n: "Tokyo", s: "Japan" },
    { z: "Asia/Seoul", n: "Seoul", s: "Korea" },
    { z: "Australia/Sydney", n: "Sydney", s: "Eastern Australia" },
    { z: "Pacific/Auckland", n: "Auckland", s: "New Zealand" }
  ];

  var REG = window.SulfurApps || (window.SulfurApps = {});
  REG["world-clock"] = {
    id: "world-clock",
    name: "World Clock",
    desc: "Analog + digital clocks for cities worldwide",
    icon: "clock",
    color: "#22d3ee",
    cat: "tool",
    w: 680, h: 560,
    mount: function (root, ctx) {
      ctx = ctx || {};
      var toast = ctx.toast || function () {};
      var store = ctx.storage || null;
      root.classList.add("sa-world-clock");
      root.style.setProperty("--acc", "#22d3ee");
      root.style.setProperty("--accd", "rgba(34,211,238,.15)");

      function load(k, d) {
        try {
          var v = store ? store.get(k, null) : null;
          if (v == null || v === "") return d;
          var p = JSON.parse(v);
          return p == null ? d : p;
        } catch (e) { return d; }
      }
      function save(k, v) { try { if (store) store.set(k, JSON.stringify(v)); } catch (e) {} }

      /* ---- state ---- */
      var zones = load("zones", null);
      if (!Object.prototype.toString.call(zones) || !zones.length) {
        zones = [];
        try {
          var local = Intl.DateTimeFormat().resolvedOptions().timeZone;
          if (CITIES.some(function (c) { return c.z === local; })) zones.push(local);
        } catch (e) {}
        ["America/New_York", "Europe/London", "Asia/Tokyo"].forEach(function (z) {
          if (zones.indexOf(z) < 0) zones.push(z);
        });
      }
      zones = zones.filter(function (z) { return CITIES.some(function (c) { return c.z === z; }); }).slice(0, 12);
      var h12 = load("h12", false) === true;

      /* ---- formatter cache ---- */
      var F = {};
      function partsFmt(z) {
        var key = "p" + z + (h12 ? "12" : "24");
        if (!F[key]) {
          F[key] = new Intl.DateTimeFormat("en-US", { timeZone: z, hourCycle: h12 ? "h12" : "h23", hour: h12 ? "numeric" : "2-digit", minute: "2-digit", second: "2-digit" });
        }
        return F[key];
      }
      function dateFmt(z) {
        var key = "d" + z;
        if (!F[key]) F[key] = new Intl.DateTimeFormat("en-US", { timeZone: z, weekday: "short", month: "short", day: "numeric" });
        return F[key];
      }
      function keyFmt(z) {
        var key = "k" + z;
        if (!F[key]) F[key] = new Intl.DateTimeFormat("en-US", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit" });
        return F[key];
      }
      function zoneParts(z, now) {
        var out = { h: 0, m: 0, s: 0, ap: "" };
        try {
          var ps = partsFmt(z).formatToParts(now);
          for (var i = 0; i < ps.length; i++) {
            var p = ps[i];
            if (p.type === "hour") out.h = parseInt(p.value, 10);
            else if (p.type === "minute") out.m = parseInt(p.value, 10);
            else if (p.type === "second") out.s = parseInt(p.value, 10);
            else if (p.type === "dayPeriod") out.ap = p.value;
          }
          if (isNaN(out.h)) out.h = 0;
          if (isNaN(out.m)) out.m = 0;
          if (isNaN(out.s)) out.s = 0;
        } catch (e) { out.h = out.m = out.s = 0; }
        return out;
      }
      function offsetStr(z, now) {
        try {
          var s = new Intl.DateTimeFormat("en-US", { timeZone: z, timeZoneName: "shortOffset" }).format(now);
          var m = s.match(/GMT([+\-]\d{1,2})(?::(\d{2}))?/);
          if (m) return "UTC" + m[1] + (m[2] && m[2] !== "00" ? ":" + m[2] : "");
        } catch (e) {}
        try {
          var p = new Intl.DateTimeFormat("en-US", { timeZone: z, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
          var q = p.match(/(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})/);
          if (q) {
            var asUTC = Date.UTC(+q[3], +q[1] - 1, +q[2], +q[4], +q[5], +q[6]);
            var diff = Math.round((asUTC - now.getTime()) / 60000);
            var sign = diff < 0 ? "\u2212" : "+";
            var ad = Math.abs(diff);
            return "UTC" + sign + Math.floor(ad / 60) + (ad % 60 ? ":" + pad2(ad % 60) : "");
          }
        } catch (e) {}
        return "UTC?";
      }
      function ymd(dateFmtStr) {
        var q = String(dateFmtStr).match(/(\d{2})\/(\d{2})\/(\d{4})/);
        return q ? q[3] + q[1] + q[2] : "";
      }

      var SUN = '<svg viewBox="0 0 24 24" class="ic sun" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
      var MOON = '<svg viewBox="0 0 24 24" class="ic moon" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/></svg>';

      function clockSVG() {
        var ticks = "";
        for (var i = 0; i < 12; i++) {
          var a = i * 30 * Math.PI / 180;
          var r1 = i % 3 === 0 ? 38.5 : 41.5;
          var x1 = (50 + r1 * Math.sin(a)).toFixed(2), y1 = (50 - r1 * Math.cos(a)).toFixed(2);
          var x2 = (50 + 45.5 * Math.sin(a)).toFixed(2), y2 = (50 - 45.5 * Math.cos(a)).toFixed(2);
          ticks += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>';
        }
        return '<svg class="clk" viewBox="0 0 100 100" aria-hidden="true"><circle class="face" cx="50" cy="50" r="47.5"/><g class="ticks">' + ticks + '</g>' +
          '<line class="hh" x1="50" y1="55" x2="50" y2="29"/><line class="mh" x1="50" y1="58" x2="50" y2="19"/><line class="sh" x1="50" y1="61" x2="50" y2="13"/><circle class="hub" cx="50" cy="50" r="3.2"/></svg>';
      }

      /* ---- dom ---- */
      var css = document.createElement("style");
      css.textContent = [
        ".sa-world-clock{position:relative;width:100%;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;background:#131316;color:#e4e4e7;font:13px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;box-sizing:border-box}",
        ".sa-world-clock *{box-sizing:border-box}",
        ".sa-world-clock .bar{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #27272a;flex-wrap:wrap}",
        ".sa-world-clock .sel{flex:1;min-width:150px;min-height:34px;border-radius:10px;border:1px solid #27272a;background:#0e0e11;color:#e4e4e7;padding:0 8px;font:inherit;cursor:pointer}",
        ".sa-world-clock .sel:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 2px var(--accd)}",
        ".sa-world-clock .btn{min-height:34px;min-width:34px;padding:0 14px;border-radius:10px;border:1px solid #27272a;background:#18181b;color:#e4e4e7;font:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:background .15s,border-color .15s,transform .06s;user-select:none}",
        ".sa-world-clock .btn:hover{background:#1f1f23;border-color:#3f3f46}",
        ".sa-world-clock .btn:active{transform:translateY(1px)}",
        ".sa-world-clock .btn:focus-visible{outline:2px solid var(--acc);outline-offset:2px}",
        ".sa-world-clock .btn.pri{background:var(--acc);border-color:var(--acc);color:#06222a;font-weight:600}",
        ".sa-world-clock .btn.pri:hover{filter:brightness(1.12)}",
        ".sa-world-clock .btn:disabled{opacity:.4;cursor:default;transform:none}",
        ".sa-world-clock .seg{display:flex;border:1px solid #27272a;border-radius:10px;overflow:hidden;margin-left:auto}",
        ".sa-world-clock .seg button{min-height:32px;padding:0 12px;border:0;background:transparent;color:#a1a1aa;font:inherit;cursor:pointer}",
        ".sa-world-clock .seg button:hover{background:#1f1f23;color:#e4e4e7}",
        ".sa-world-clock .seg button.on{background:var(--accd);color:var(--acc);font-weight:600}",
        ".sa-world-clock .seg button:focus-visible{outline:2px solid var(--acc);outline-offset:-2px}",
        ".sa-world-clock .cards{flex:1;min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(252px,1fr));gap:10px;padding:10px;align-content:start}",
        ".sa-world-clock .card{position:relative;display:flex;align-items:center;gap:12px;border:1px solid #27272a;background:#18181b;border-radius:12px;padding:10px 12px;min-width:0}",
        ".sa-world-clock .card:hover{border-color:#3f3f46}",
        ".sa-world-clock .clk{width:62px;height:62px;flex:none}",
        ".sa-world-clock .face{fill:#0e0e11;stroke:#3f3f46;stroke-width:2.5}",
        ".sa-world-clock .ticks line{stroke:#52525b;stroke-width:2.5}",
        ".sa-world-clock .hh,.sa-world-clock .mh,.sa-world-clock .sh{transform-box:view-box;transform-origin:50px 50px;stroke-linecap:round}",
        ".sa-world-clock .hh{stroke:#e4e4e7;stroke-width:4.5}",
        ".sa-world-clock .mh{stroke:#a1a1aa;stroke-width:3.2}",
        ".sa-world-clock .sh{stroke:var(--acc);stroke-width:1.8}",
        ".sa-world-clock .hub{fill:var(--acc)}",
        ".sa-world-clock .meta{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}",
        ".sa-world-clock .city{font-size:13.5px;font-weight:600;color:#e4e4e7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".sa-world-clock .sub{font-size:11px;color:#71717a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".sa-world-clock .dig{flex:none;text-align:right;min-width:0}",
        ".sa-world-clock .t{font:600 19px/1.15 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e4e4e7;font-variant-numeric:tabular-nums;white-space:nowrap}",
        ".sa-world-clock .t small{font-size:11px;color:#a1a1aa;font-weight:400;margin-left:3px}",
        ".sa-world-clock .dt{font-size:11px;color:#71717a;white-space:nowrap;margin-top:2px;display:flex;align-items:center;gap:4px;justify-content:flex-end}",
        ".sa-world-clock .badge{color:#a1a1aa;background:#27272a;border-radius:5px;padding:0 4px;font-size:10px;line-height:15px}",
        ".sa-world-clock .ic{width:13px;height:13px;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}",
        ".sa-world-clock .sun{stroke:#fbbf24}",
        ".sa-world-clock .moon{stroke:#818cf8}",
        ".sa-world-clock .rm{position:absolute;top:5px;right:5px;width:22px;height:22px;border:0;border-radius:6px;background:transparent;color:#52525b;font-size:13px;line-height:1;cursor:pointer;opacity:0;transition:opacity .15s,color .15s}",
        ".sa-world-clock .card:hover .rm,.sa-world-clock .rm:focus-visible{opacity:1}",
        ".sa-world-clock .rm:hover{color:#f43f5e;background:#f43f5e1a}",
        ".sa-world-clock .rm:focus-visible{outline:1px solid var(--acc)}",
        ".sa-world-clock .empty{grid-column:1/-1;text-align:center;color:#71717a;font-size:12.5px;padding:36px 12px;line-height:1.7}"
      ].join("\n");
      root.appendChild(css);

      var wrap = document.createElement("div");
      wrap.className = "sa-world-clock";
      root.appendChild(wrap);
      wrap.innerHTML =
        '<div class="bar">' +
          '<select class="sel" id="zsel" aria-label="Add a city"></select>' +
          '<button class="btn pri" id="zadd">Add city</button>' +
          '<div class="seg" role="group" aria-label="Hour format">' +
            '<button type="button" data-h12="1">12h</button><button type="button" data-h12="0" class="on">24h</button>' +
          '</div>' +
        '</div>' +
        '<div class="cards" id="cards"></div>';

      var cardsEl = wrap.querySelector("#cards");
      var zsel = wrap.querySelector("#zsel");
      var zadd = wrap.querySelector("#zadd");
      var refs = []; // live per-card element refs

      function cityOf(z) {
        for (var i = 0; i < CITIES.length; i++) if (CITIES[i].z === z) return CITIES[i];
        return { z: z, n: z, s: "" };
      }

      function renderSelect() {
        var opts = CITIES.filter(function (c) { return zones.indexOf(c.z) < 0; })
          .map(function (c) { return '<option value="' + c.z + '">' + c.n + " \u2014 " + c.s + "</option>"; });
        zsel.innerHTML = opts.length ? opts.join("") : '<option value="">All cities added</option>';
        zadd.disabled = !opts.length;
      }

      function buildCards() {
        refs = [];
        if (!zones.length) {
          cardsEl.innerHTML = '<div class="empty">No cities yet.<br>Pick one above and press <b>Add city</b> \u2014 clocks tick with real zone rules (DST included).</div>';
          return;
        }
        var now = new Date();
        cardsEl.innerHTML = zones.map(function (z) {
          var c = cityOf(z);
          return '<div class="card" data-z="' + z + '">' +
            clockSVG() +
            '<div class="meta"><div class="city">' + c.n + '</div><div class="sub" data-r="sub"></div></div>' +
            '<div class="dig"><div class="t" data-r="t"></div><div class="dt" data-r="dt"></div></div>' +
            '<button class="rm" data-rm="' + z + '" aria-label="Remove ' + c.n + '">\u00d7</button>' +
          "</div>";
        }).join("");
        var list = cardsEl.querySelectorAll(".card");
        for (var i = 0; i < list.length; i++) {
          var el = list[i];
          refs.push({
            z: el.getAttribute("data-z"),
            hh: el.querySelector(".hh"), mh: el.querySelector(".mh"), sh: el.querySelector(".sh"),
            t: el.querySelector('[data-r="t"]'), sub: el.querySelector('[data-r="sub"]'), dt: el.querySelector('[data-r="dt"]'),
            lastMin: -1, lastOff: "", lastDay: -1
          });
        }
        tick(true);
      }

      function tick(force) {
        var now = new Date();
        var localK = ymd(new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit" }).format(now));
        for (var i = 0; i < refs.length; i++) {
          var r = refs[i];
          var p = zoneParts(r.z, now);
          var tstr = (h12 ? p.h : pad2(p.h)) + ":" + pad2(p.m) + ":" + pad2(p.s);
          var ap = h12 ? " <small>" + (p.ap || "") + "</small>" : "";
          r.t.innerHTML = tstr + ap;
          var hA = (p.h % 12 + p.m / 60) * 30, mA = (p.m + p.s / 60) * 6, sA = p.s * 6;
          r.hh.style.transform = "rotate(" + hA.toFixed(2) + "deg)";
          r.mh.style.transform = "rotate(" + mA.toFixed(2) + "deg)";
          r.sh.style.transform = "rotate(" + sA.toFixed(2) + "deg)";
          var minuteChanged = r.lastMin !== p.m;
          if (force || minuteChanged) {
            r.lastMin = p.m;
            var off = offsetStr(r.z, now);
            if (off !== r.lastOff) { r.lastOff = off; }
            r.sub.textContent = cityOf(r.z).s + " \u00b7 " + off;
            var dstr = "", badge = "";
            try {
              dstr = dateFmt(r.z).format(now);
              var zk = ymd(keyFmt(r.z).format(now));
              if (zk && localK && zk !== localK) badge = zk > localK ? "Tomorrow" : "Yesterday";
            } catch (e) {}
            r.dt.innerHTML = (p.h >= 6 && p.h < 18 ? SUN : MOON) + "<span>" + dstr + "</span>" + (badge ? '<span class="badge">' + badge + "</span>" : "");
          }
        }
      }

      /* ---- actions ---- */
      function addCity() {
        var z = zsel.value;
        if (!z || zones.indexOf(z) >= 0) return;
        zones.push(z);
        save("zones", zones);
        renderSelect();
        buildCards();
        toast(cityOf(z).n + " added", "ok");
      }
      function removeCity(z) {
        zones = zones.filter(function (x) { return x !== z; });
        save("zones", zones);
        renderSelect();
        buildCards();
      }

      zadd.addEventListener("click", addCity);
      zsel.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); addCity(); }
        e.stopPropagation();
      });
      wrap.addEventListener("click", function (e) {
        var rm = e.target.closest ? e.target.closest("[data-rm]") : null;
        if (rm) { removeCity(rm.getAttribute("data-rm")); return; }
        var hb = e.target.closest ? e.target.closest("[data-h12]") : null;
        if (hb) {
          h12 = hb.getAttribute("data-h12") === "1";
          save("h12", h12);
          wrap.querySelectorAll("[data-h12]").forEach(function (b) { b.classList.toggle("on", b === hb); });
          F = {};
          tick(true);
        }
      });

      renderSelect();
      buildCards();
      var iv = setInterval(function () { tick(false); }, 1000);

      return {
        onClose: function () {
          if (iv) { clearInterval(iv); iv = 0; }
        }
      };
    }
  };
})();
