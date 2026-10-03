/* Sulfur OS app — Notes: quick rich notes with local persistence. */
(function () {
"use strict";
var REG = window.SulfurApps || (window.SulfurApps = {});
REG["notes"] = {
    id: "notes", name: "Notes", desc: "quick notes — they persist across boots.",
    icon: "note", color: "#facc15", cat: "tool", w: 620, h: 640,
    mount: function (root, ctx) {
        root.className = "so-module";
        var st = document.createElement("style");
        st.textContent = [
            ".nt{height:100%;display:flex;flex-direction:column;background:#0c0d18;color:#e4e4e7}",
            ".nt .bar{display:flex;gap:8px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.07);background:#101120}",
            ".nt .list{width:190px;border-right:1px solid rgba(255,255,255,.07);overflow:auto;padding:10px;display:flex;flex-direction:column;gap:7px;background:#0f1019;flex-shrink:0}",
            ".nt .ni{text-align:left;border-radius:10px;padding:9px 12px;background:#161827;border:1px solid rgba(255,255,255,.07);color:#d4d4d8;cursor:pointer}",
            ".nt .ni:hover{background:#1d2033}",
            ".nt .ni.on{border-color:rgba(250,204,21,.45);background:rgba(250,204,21,.1)}",
            ".nt .ni b{display:block;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
            ".nt .ni span{font-size:10.5px;color:#71717a}",
            ".nt .wrap{flex:1;display:flex;min-width:0}",
            ".nt textarea{flex:1;background:transparent;border:none;outline:none;resize:none;color:#e4e4e7;font:14px/1.6 ui-sans-serif,system-ui;padding:18px 20px;min-width:0}"
        ].join("\n");
        root.appendChild(st);
        var notes = ctx.storage.get("notes", "") ? JSON.parse(ctx.storage.get("notes", "[]")) : [];
        if (!notes.length) notes = [{ t: "welcome", b: "Notes keep their text across boots.\n\nEverything the OS saves rides in local storage." }];
        var cur = 0;
        var wrap = document.createElement("div");
        wrap.className = "nt";
        wrap.innerHTML = "<div class='bar'><button class='so-btn primary' style='--acc:#facc15' id='ntNew'>new note</button><button class='so-btn' id='ntDel' title='delete note'>delete</button><span style='flex:1'></span><span id='ntStat' style='font-size:11.5px;color:#71717a;align-self:center'></span></div>" +
            "<div class='wrap'><div class='list' id='ntList'></div><textarea id='ntBody' aria-label='note body' placeholder='write…'></textarea></div>";
        root.appendChild(wrap);
        var $ = function (id) { return wrap.querySelector("#" + id); };
        function save() {
            try { ctx.storage.set("notes", JSON.stringify(notes)); } catch (e) {}
        }
        function paint() {
            $("ntList").innerHTML = "";
            notes.forEach(function (n, i) {
                var b = document.createElement("div");
                b.className = "ni" + (i === cur ? " on" : "");
                b.innerHTML = "<b>" + (n.t || "untitled").replace(/</g, "&lt;") + "</b><span>" + ((n.b || "").split("\n")[0] || "empty").slice(0, 26).replace(/</g, "&lt;") + "</span>";
                b.addEventListener("click", function () { cur = i; paint(); });
                $("ntList").appendChild(b);
            });
            $("ntBody").value = notes[cur] ? notes[cur].b : "";
            $("ntStat").textContent = notes.length + " notes · " + ($("ntBody").value.length) + " chars";
            ctx.setTitle((notes[cur] && notes[cur].t) || "Notes");
        }
        $("ntBody").addEventListener("input", function () {
            var v = this.value;
            notes[cur].b = v;
            notes[cur].t = (v.split("\n")[0] || "untitled").slice(0, 30);
            save();
            $("ntStat").textContent = notes.length + " notes · " + v.length + " chars";
        });
        $("ntNew").addEventListener("click", function () {
            notes.unshift({ t: "untitled", b: "" });
            cur = 0;
            save(); paint();
            $("ntBody").focus();
        });
        $("ntDel").addEventListener("click", function () {
            if (notes.length <= 1) { notes = [{ t: "untitled", b: "" }]; }
            else { notes.splice(cur, 1); cur = Math.max(0, cur - 1); }
            save(); paint();
            ctx.toast("note deleted");
        });
        paint();
    }
};
})();
