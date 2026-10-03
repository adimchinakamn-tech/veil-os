/* Sulfur OS app — Synth: a playable two-octave keyboard with waveform
   choice and a live oscilloscope. WebAudio, zero deps. */
(function () {
"use strict";
var REG = window.SulfurApps || (window.SulfurApps = {});
REG["synth"] = {
    id: "synth", name: "Synth", desc: "a playable keyboard — sine, square, saw, triangle.",
    icon: "music", color: "#8b5cf6", cat: "creative", w: 700, h: 560,
    mount: function (root, ctx) {
        root.className = "so-module";
        var st = document.createElement("style");
        st.textContent = [
            ".sy{height:100%;display:flex;flex-direction:column;gap:12px;padding:16px;overflow:auto;background:#0c0d18;color:#e4e4e7}",
            ".sy canvas{width:100%;height:88px;border-radius:12px;background:#0e1019;border:1px solid rgba(255,255,255,.08)}",
            ".sy .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
            ".sy select{background:#14151f;border:1px solid rgba(255,255,255,.12);color:#e4e4e7;border-radius:9px;padding:8px 12px;font:inherit;outline:none}",
            ".sy .keys{display:flex;gap:3px;flex:1;min-height:150px;padding-bottom:6px;user-select:none}",
            ".sy .k{flex:1;position:relative;border-radius:0 0 9px 9px;background:linear-gradient(180deg,#f4f4f2,#d8d8d4);border:1px solid #b8b8b2;cursor:pointer;min-height:150px}",
            ".sy .k[data-sharp='1']{flex:.62;background:linear-gradient(180deg,#2a2a30,#15151a);border-color:#000;z-index:2;margin:0 -4.5%;min-height:96px;transform:translateY(-18px)}",
            ".sy .k.on{background:linear-gradient(180deg,#c4b5fd,#8b5cf6);box-shadow:0 0 22px rgba(139,92,246,.6)}",
            ".sy .k span{position:absolute;bottom:7px;left:0;right:0;text-align:center;font-size:9.5px;color:#71717a;font-weight:700;pointer-events:none}",
            ".sy .k[data-sharp='1'] span{color:#71717a}"
        ].join("\n");
        root.appendChild(st);
        var NOTES = [
            ["C4", 261.63, 0], ["C#4", 277.18, 1], ["D4", 293.66, 0], ["D#4", 311.13, 1],
            ["E4", 329.63, 0], ["F4", 349.23, 0], ["F#4", 369.99, 1], ["G4", 392.0, 0], ["G#4", 415.3, 1],
            ["A4", 440.0, 0], ["A#4", 466.16, 1], ["B4", 493.88, 0], ["C5", 523.25, 0], ["C#5", 554.37, 1],
            ["D5", 587.33, 0], ["D#5", 622.25, 1], ["E5", 659.25, 0], ["F5", 698.46, 0], ["F#5", 739.99, 1],
            ["G5", 783.99, 0], ["G#5", 830.61, 1], ["A5", 880.0, 0], ["A#5", 932.33, 1], ["B5", 987.77, 0]
        ];
        var KEYS = { a: "C4", w: "C#4", s: "D4", e: "D#4", d: "E4", f: "F4", t: "F#4", g: "G4", y: "G#4", h: "A4", u: "A#4", j: "B4", k: "C5", o: "C#5", l: "D5", p: "D#5", ";": "E5", "'": "F5" };
        var actx = null, wave = "sine", voices = {};
        var wrap = document.createElement("div");
        wrap.className = "sy";
        wrap.innerHTML =
            "<div class='row'><select id='syWave' aria-label='waveform'><option value='sine'>sine</option><option value='square'>square</option><option value='sawtooth'>saw</option><option value='triangle'>triangle</option></select>" +
            "<label style='font-size:12px;color:#a1a1aa;display:inline-flex;align-items:center;gap:7px'>volume <input type='range' id='syVol' min='0' max='100' value='38' style='width:130px'></label>" +
            "<span style='font-size:11.5px;color:#71717a'>play with the mouse or A–' keys</span></div>" +
            "<canvas height='88' aria-label='oscilloscope'></canvas>" +
            "<div class='keys' id='syKeys'></div>";
        root.appendChild(wrap);
        var keysEl = wrap.querySelector("#syKeys");
        var keyByNote = {};
        NOTES.forEach(function (n) {
            var k = document.createElement("div");
            k.className = "k";
            k.dataset.note = n[0];
            k.dataset.sharp = n[2] ? "1" : "0";
            k.innerHTML = "<span>" + n[0] + "</span>";
            keysEl.appendChild(k);
            keyByNote[n[0]] = k;
        });
        function audio() {
            if (!actx) {
                try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
            }
            if (actx.state === "suspended") actx.resume();
            return actx;
        }
        function on(note) {
            var a = audio();
            if (!a || voices[note]) return;
            var f = null;
            for (var i = 0; i < NOTES.length; i++) if (NOTES[i][0] === note) f = NOTES[i][1];
            if (!f) return;
            var o = a.createOscillator(), gn = a.createGain();
            o.type = wave;
            o.frequency.value = f;
            var v = (parseInt(wrap.querySelector("#syVol").value, 10) / 100) * 0.28;
            gn.gain.setValueAtTime(0, a.currentTime);
            gn.gain.linearRampToValueAtTime(v, a.currentTime + 0.012);
            o.connect(gn); gn.connect(a.destination);
            o.start();
            voices[note] = { o: o, gn: gn };
            keyByNote[note].classList.add("on");
        }
        function off(note) {
            var v = voices[note];
            if (!v || !actx) return;
            delete voices[note];
            var a = actx;
            v.gn.gain.cancelScheduledValues(a.currentTime);
            v.gn.gain.setTargetAtTime(0, a.currentTime, 0.05);
            setTimeout(function () { try { v.o.stop(); } catch (e) {} }, 260);
            keyByNote[note].classList.remove("on");
        }
        Object.keys(keyByNote).forEach(function (note) {
            var el = keyByNote[note];
            el.addEventListener("pointerdown", function (e) { e.preventDefault(); on(note); });
            el.addEventListener("pointerup", function () { off(note); });
            el.addEventListener("pointerleave", function () { off(note); });
        });
        document.addEventListener("keydown", function (e) {
            var n = KEYS[e.key.toLowerCase()];
            if (n && !e.repeat && !e.metaKey && !e.ctrlKey) on(n);
        });
        document.addEventListener("keyup", function (e) {
            var n = KEYS[e.key.toLowerCase()];
            if (n) off(n);
        });
        wrap.querySelector("#syWave").addEventListener("change", function () { wave = this.value; });
        /* oscilloscope */
        var cv = wrap.querySelector("canvas"), og = cv.getContext("2d");
        function drawScope() {
            var W = cv.width = cv.clientWidth || 600;
            og.clearRect(0, 0, W, 88);
            og.strokeStyle = "#a78bfa";
            og.lineWidth = 2;
            og.beginPath();
            var t = actx ? actx.currentTime * 4 : 0;
            var active = Object.keys(voices).length > 0;
            for (var x = 0; x < W; x += 3) {
                var phase = (x / W) * Math.PI * 8 + t;
                var amp = active ? 26 : 7;
                var y = 44 + Math.sin(phase * (wave === "square" ? 1 : 1.4)) * amp * (wave === "sawtooth" ? (phase % 2) : 1);
                if (wave === "square") y = 44 + (Math.sin(phase) > 0 ? -amp : amp) * 0.55;
                if (x === 0) og.moveTo(x, y); else og.lineTo(x, y);
            }
            og.stroke();
            requestAnimationFrame(drawScope);
        }
        drawScope();
    }
};
})();
