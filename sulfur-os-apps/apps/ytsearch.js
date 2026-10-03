/* Sulfur OS app — YouTube Search: queries YouTube through the
   tunnel and lists videos with thumbnails; picks open straight in
   the veil's full browser. No API key — it scrapes the public
   search page's ytInitialData JSON. */
(function () {
"use strict";
var REG = window.SulfurApps || (window.SulfurApps = {});
REG["ytsearch"] = {
    id: "ytsearch", name: "YouTube Search", desc: "search youtube through the tunnel — results open in the veil.",
    icon: "yt", color: "#ff0033", cat: "media", w: 720, h: 700,
    mount: function (root, ctx) {
        root.className = "so-module";
        var st = document.createElement("style");
        st.textContent = [
            ".yt{min-height:100%;display:flex;flex-direction:column;background:#0c0d18;color:#e4e4e7}",
            ".yt *{box-sizing:border-box}",
            ".yt form{display:flex;gap:8px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.07);background:#101120;position:sticky;top:0;z-index:2}",
            ".yt form input{flex:1;background:#14151f;border:1px solid rgba(255,255,255,.1);border-radius:99px;padding:10px 17px;color:#e4e4e7;outline:none;font-size:13.5px}",
            ".yt form input:focus{border-color:rgba(255,0,51,.5)}",
            ".yt .res{flex:1;overflow:auto;padding:12px 16px 22px;display:flex;flex-direction:column;gap:11px}",
            ".yt .vid{display:flex;gap:13px;background:rgba(24,26,38,.55);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:11px;cursor:pointer;transition:background .15s,transform .12s;text-align:left}",
            ".yt .vid:hover{background:rgba(36,39,58,.85);transform:translateY(-2px)}",
            ".yt .th{width:168px;height:94px;flex-shrink:0;border-radius:9px;background:#18181b;object-fit:cover;display:block}",
            ".yt .vi{min-width:0;display:flex;flex-direction:column;gap:4px}",
            ".yt .vi b{font-size:13.5px;line-height:1.4;color:#fafafa;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
            ".yt .vi span{font-size:11.5px;color:#a1a1aa}",
            ".yt .st{padding:20px;font-size:12.5px;color:#71717a;text-align:center}"
        ].join("\n");
        root.appendChild(st);
        var wrap = document.createElement("div");
        wrap.className = "yt";
        wrap.innerHTML =
            "<form><input type='text' placeholder='search youtube…' aria-label='youtube search' autocomplete='off'>" +
            "<button class='so-btn primary' style='--acc:#ff0033' type='submit'>search</button></form>" +
            "<div class='res'><div class='st'>searches run through the veil tunnel — results open in the veil browser</div></div>";
        root.appendChild(wrap);
        var form = wrap.querySelector("form"), res = wrap.querySelector(".res");
        form.addEventListener("submit", function (e) {
            e.preventDefault();
            var q = form.querySelector("input").value.trim();
            if (!q) return;
            res.innerHTML = "<div class='st'>searching “" + q.replace(/</g, "&lt;") + "”…</div>";
            ctx.tunnel.text("https://www.youtube.com/results?search_query=" + encodeURIComponent(q), {
                headers: { accept: "text/html" }
            }).then(function (html) {
                var vids = [];
                var m = /ytInitialData\s*=\s*(\{.+?\});<\/script>/.exec(html);
                if (!m) { res.innerHTML = "<div class='st'>couldn't parse the results — YouTube may be gating this network.</div>"; return; }
                var data;
                try { data = JSON.parse(m[1]); } catch (err) { res.innerHTML = "<div class='st'>results JSON didn't parse.</div>"; return; }
                var walk = function (node) {
                    if (!node || typeof node !== "object" || vids.length >= 24) return;
                    var vr = node.videoRenderer || node.compactVideoRenderer;
                    if (vr && vr.videoId && vr.title) {
                        var title = (((vr.title.runs || [])[0]) || {}).text || "";
                        var who = (((vr.ownerText && vr.ownerText.runs) || [])[0] || {}).text || "";
                        var views = ((vr.shortViewCountText && vr.shortViewCountText.simpleText) || "");
                        var len = ((vr.lengthText && vr.lengthText.simpleText) || "");
                        var th = ((vr.thumbnail && vr.thumbnail.thumbnails) || [])[0];
                        vids.push({ id: vr.videoId, title: title, who: who, views: views, len: len, thumb: th ? th.url : "" });
                    }
                    for (var k in node) { if (vids.length >= 24) break; if (node[k] && typeof node[k] === "object") walk(node[k]); }
                };
                walk(data);
                if (!vids.length) { res.innerHTML = "<div class='st'>no results parsed — try another query.</div>"; return; }
                res.innerHTML = "";
                vids.forEach(function (v) {
                    var b = document.createElement("button");
                    b.className = "vid";
                    b.type = "button";
                    b.innerHTML = (v.thumb ? "<img class='th' src='" + v.thumb.replace(/^http:/, "https:") + "' alt='' loading='lazy'>" : "<span class='th'></span>") +
                        "<span class='vi'><b>" + v.title.replace(/</g, "&lt;") + "</b>" +
                        "<span>" + v.who + (v.views ? " · " + v.views : "") + (v.len ? " · " + v.len : "") + "</span></span>";
                    b.addEventListener("click", function () {
                        try { parent.__veilShell.engineNavigate("https://www.youtube.com/watch?v=" + v.id); ctx.toast("opening in the veil"); }
                        catch (e) { window.open("https://www.youtube.com/watch?v=" + v.id, "_blank"); }
                    });
                    res.appendChild(b);
                });
                ctx.setTitle("YT — " + q.slice(0, 16));
            }).catch(function (err) {
                res.innerHTML = "<div class='st'>search failed (" + (err && err.message || "unreachable") + ") — the tunnel needs the veil engine.</div>";
            });
        });
    }
};
})();
