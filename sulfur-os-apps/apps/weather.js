/* Sulfur OS app — Weather: live conditions through the tunnel.
   wttr.in's JSON API needs no key; the OS's tunnel fetches it. */
(function () {
"use strict";
var REG = window.SulfurApps || (window.SulfurApps = {});
REG["weather"] = {
    id: "weather", name: "Weather", desc: "live conditions for any city, through the tunnel.",
    icon: "weather", color: "#0ea5e9", cat: "tool", w: 560, h: 640,
    mount: function (root, ctx) {
        root.className = "so-module";
        var st = document.createElement("style");
        st.textContent = [
            ".wx{min-height:100%;display:flex;flex-direction:column;align-items:center;gap:14px;padding:22px 18px;background:radial-gradient(120% 90% at 50% 0%,#12293a 0%,#0c0d18 65%);color:#e4e4e7;overflow:auto}",
            ".wx form{display:flex;gap:8px;width:100%;max-width:380px}",
            ".wx .cur{display:flex;align-items:center;gap:16px;width:100%;max-width:380px;background:rgba(14,165,233,.1);border:1px solid rgba(14,165,233,.3);border-radius:17px;padding:20px 24px}",
            ".wx .big{font-size:44px;font-weight:800;letter-spacing:-.03em}",
            ".wx .meta{display:flex;flex-direction:column;gap:2px}",
            ".wx .meta b{font-size:16px}",
            ".wx .meta span{font-size:12px;color:#7dd3fc}",
            ".wx .fc{display:flex;gap:8px;width:100%;max-width:380px;overflow-x:auto}",
            ".wx .day{flex-shrink:0;width:86px;background:rgba(24,26,38,.6);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:10px 8px;display:flex;flex-direction:column;align-items:center;gap:5px;font-size:11.5px}",
            ".wx .day b{font-size:11px;color:#7dd3fc;letter-spacing:.06em}",
            ".wx .day .t{font-weight:700;font-size:13px}",
            ".wx .st{font-size:12px;color:#a1a1aa;max-width:380px;text-align:center}"
        ].join("\n");
        root.appendChild(st);
        var last = ctx.storage.get("city", "") || "";
        var wrap = document.createElement("div");
        wrap.className = "wx";
        wrap.innerHTML =
            "<form><input class='so-input' style='flex:1' placeholder='city (e.g. Baltimore)' value='" + last.replace(/'/g, "&#39;") + "' aria-label='city'><button class='so-btn primary' style='--acc:#0ea5e9' type='submit'>get</button></form>" +
            "<div class='st'>weather by wttr.in, fetched through the veil tunnel</div>";
        root.appendChild(wrap);
        var form = wrap.querySelector("form");
        form.addEventListener("submit", function (e) {
            e.preventDefault();
            var city = form.querySelector("input").value.trim();
            if (!city) return;
            ctx.storage.set("city", city);
            load(city);
        });
        function load(city) {
            var stEl = wrap.querySelector(".st");
            stEl.textContent = "loading " + city + "…";
            ctx.tunnel.json("https://wttr.in/" + encodeURIComponent(city) + "?format=j1").then(function (d) {
                var c = (d.current_condition || [])[0] || {};
                var area = ((d.weather || [])[0] || {});
                var name = (area.areaName || city).toString();
                var desc = (c.weatherDesc || [{}])[0].value || "";
                var celsius = parseInt(c.temp_C || "0", 10);
                wrap.querySelectorAll(".cur,.fc").forEach(function (n) { n.remove(); });
                var cur = document.createElement("div");
                cur.className = "cur";
                cur.innerHTML = "<span class='big'>" + celsius + "°<small style='font-size:19px;font-weight:600;color:#7dd3fc'>C</small></span>" +
                    "<span class='meta'><b>" + name + " — " + desc + "</b>" +
                    "<span>feels " + c.FeelsLikeC + "°C · humidity " + c.humidity + "% · wind " + c.windspeedKmph + " km/h</span>" +
                    "<span>" + (c.localObsDateTime || "") + "</span></span>";
                wrap.insertBefore(cur, stEl);
                var fc = document.createElement("div");
                fc.className = "fc";
                (d.weather || []).slice(0, 3).forEach(function (day) {
                    var dEl = document.createElement("div");
                    dEl.className = "day";
                    dEl.innerHTML = "<b>" + (day.date || "").slice(5) + "</b>" +
                        "<span class='t'>" + day.mintempC + "°–" + day.maxtempC + "°</span>" +
                        "<span style='color:#a1a1aa'>☀ " + ((day.hourly || [])[4] || {}).chanceofsunshine + "%</span>" +
                        "<span style='color:#a1a1aa'>☂ " + ((day.hourly || [])[4] || {}).chanceofrain + "%</span>";
                    fc.appendChild(dEl);
                });
                wrap.insertBefore(fc, stEl);
                stEl.textContent = "live — " + name.toLowerCase() + ", via wttr.in";
                ctx.setTitle("Weather — " + name);
            }).catch(function (err) {
                stEl.textContent = "couldn't reach wttr.in (" + (err && err.message || "unreachable") + ") — is the tunnel up?";
            });
        }
        if (last) load(last);
    }
};
})();
