/* Sulfur OS app — Calendar (tools pack) */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function uid() {
    return "e" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  var REG = window.SulfurApps || (window.SulfurApps = {});
  REG["calendar"] = {
    id: "calendar",
    name: "Calendar",
    desc: "Month grid with events, colored dots and a day list",
    icon: "custom:M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
    color: "#f59e0b",
    cat: "tool",
    w: 760, h: 560,
    mount: function (root, ctx) {
      ctx = ctx || {};
      var toast = ctx.toast || function () {};
      var store = ctx.storage || null;
      root.classList.add("sa-calendar");
      root.style.setProperty("--acc", "#f59e0b");
      root.style.setProperty("--accd", "rgba(245,158,11,.16)");
      root.style.setProperty("--accf", "rgba(245,158,11,.9)");

      var COLORS = ["#f59e0b", "#14b8a6", "#a78bfa", "#f43f5e", "#38bdf8", "#34d399", "#eab308", "#f472b6"];
      var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      var DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

      function load(k, d) {
        try {
          var v = store ? store.get(k, null) : null;
          if (v == null || v === "") return d;
          var p = JSON.parse(v);
          return p == null ? d : p;
        } catch (e) { return d; }
      }
      function save(k, v) {
        try { if (store) store.set(k, JSON.stringify(v)); } catch (e) { /* full */ }
      }

      /* ---- state ---- */
      var events = load("events", []);
      if (Object.prototype.toString.call(events) !== "[object Array]") events = [];
      events = events.filter(function (e) {
        return e && typeof e.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && typeof e.title === "string";
      });
      events.forEach(function (e) {
        if (!e.id) e.id = uid();
        if (COLORS.indexOf(e.color) < 0) e.color = COLORS[0];
      });

      var today = new Date();
      var viewY = today.getFullYear();
      var viewM = today.getMonth();
      var sel = null;          // "YYYY-MM-DD"
      var editId = null;       // event being inline-edited
      var adding = false;      // "add another" keep-focus mode

      function keyOf(y, m, d) { return y + "-" + pad2(m + 1) + "-" + pad2(d); }
      function todayKey() { return keyOf(today.getFullYear(), today.getMonth(), today.getDate()); }
      function eventsOn(k) {
        return events.filter(function (e) { return e.date === k; });
      }
      function monthCount() {
        var pre = viewY + "-" + pad2(viewM + 1);
        return events.filter(function (e) { return e.date.indexOf(pre) === 0; }).length;
      }
      function saveEvents() { save("events", events); }

      /* ---- dom ---- */
      var css = document.createElement("style");
      css.textContent = [
        ".sa-calendar{position:relative;width:100%;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;background:#131316;color:#e4e4e7;font:13px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;box-sizing:border-box}",
        ".sa-calendar *{box-sizing:border-box}",
        ".sa-calendar .bar{flex:none;display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #27272a;flex-wrap:wrap}",
        ".sa-calendar .bar h2{margin:0;font-size:14px;font-weight:600;letter-spacing:.2px;color:#e4e4e7;min-width:128px;text-align:center}",
        ".sa-calendar .cnt{color:#71717a;font-size:12px;margin-left:auto;margin-right:6px}",
        ".sa-calendar .btn{min-height:34px;min-width:34px;padding:0 12px;border-radius:10px;border:1px solid #27272a;background:#18181b;color:#e4e4e7;font:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:background .15s,border-color .15s,color .15s,transform .06s;user-select:none}",
        ".sa-calendar .btn:hover{background:#1f1f23;border-color:#3f3f46}",
        ".sa-calendar .btn:active{transform:translateY(1px)}",
        ".sa-calendar .btn:focus-visible{outline:2px solid var(--acc);outline-offset:2px}",
        ".sa-calendar .btn.pri{background:var(--acc);border-color:var(--acc);color:#17130a;font-weight:600}",
        ".sa-calendar .btn.pri:hover{filter:brightness(1.12)}",
        ".sa-calendar .btn.sq{width:34px;padding:0;font-size:16px;color:#a1a1aa}",
        ".sa-calendar .btn:disabled{opacity:.4;cursor:default;transform:none}",
        ".sa-calendar .body{flex:1;min-height:0;display:flex;flex-wrap:wrap;overflow:hidden}",
        ".sa-calendar .main{flex:1 1 340px;min-width:280px;display:flex;flex-direction:column;overflow:hidden}",
        ".sa-calendar .dow{flex:none;display:grid;grid-template-columns:repeat(7,1fr);border-bottom:1px solid #27272a;text-align:center;font-size:10.5px;letter-spacing:.8px;text-transform:uppercase;color:#71717a}",
        ".sa-calendar .dow div{padding:5px 0}",
        ".sa-calendar .grid{flex:1;min-height:0;display:grid;grid-template-columns:repeat(7,1fr);grid-auto-rows:1fr;overflow:auto}",
        ".sa-calendar .cell{position:relative;border:0;border-right:1px solid #1e1e22;border-bottom:1px solid #1e1e22;background:transparent;color:inherit;font:inherit;text-align:left;padding:3px 4px;display:flex;flex-direction:column;align-items:flex-start;gap:2px;cursor:pointer;min-width:0;overflow:hidden}",
        ".sa-calendar .cell:nth-child(7n){border-right:0}",
        ".sa-calendar .cell:hover{background:#ffffff08}",
        ".sa-calendar .cell:focus-visible{outline:2px solid var(--acc);outline-offset:-2px;z-index:1}",
        ".sa-calendar .cell.off{cursor:default;background:#10101399}",
        ".sa-calendar .cell.off:hover{background:#10101399}",
        ".sa-calendar .cell.sel{background:var(--accd);box-shadow:inset 0 0 0 1px var(--accf)}",
        ".sa-calendar .dnum{width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;color:#d4d4d8;flex:none}",
        ".sa-calendar .cell.today .dnum{background:var(--acc);color:#17130a;font-weight:700}",
        ".sa-calendar .chip{max-width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:5px;padding:0 4px;font-size:10px;line-height:15px;color:#fff}",
        ".sa-calendar .dots{display:flex;align-items:center;gap:3px;flex-wrap:wrap;min-height:6px}",
        ".sa-calendar .dot{width:6px;height:6px;border-radius:50%;flex:none}",
        ".sa-calendar .more{font-size:10px;color:#71717a}",
        ".sa-calendar .side{flex:0 0 236px;max-width:236px;display:flex;flex-direction:column;border-left:1px solid #27272a;min-height:0;overflow:hidden}",
        ".sa-calendar .shead{flex:none;padding:10px 12px 8px;border-bottom:1px solid #27272a}",
        ".sa-calendar .shead h3{margin:0;font-size:13px;font-weight:600;color:#e4e4e7}",
        ".sa-calendar .shead p{margin:2px 0 0;font-size:11.5px;color:#71717a}",
        ".sa-calendar .addrow{flex:none;display:flex;gap:6px;padding:10px 10px;border-bottom:1px solid #27272a}",
        ".sa-calendar .inp{flex:1;min-width:0;min-height:34px;border-radius:10px;border:1px solid #27272a;background:#0e0e11;color:#e4e4e7;padding:0 10px;font:inherit}",
        ".sa-calendar .inp:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 2px var(--accd)}",
        ".sa-calendar .inp:focus-visible{outline:none}",
        ".sa-calendar .list{flex:1;min-height:0;overflow:auto;padding:8px 10px;display:flex;flex-direction:column;gap:6px}",
        ".sa-calendar .ev{display:flex;align-items:center;gap:8px;border:1px solid #27272a;background:#18181b;border-radius:12px;padding:7px 9px;min-width:0}",
        ".sa-calendar .evdot{width:10px;height:10px;border-radius:50%;flex:none;cursor:pointer;border:1px solid #ffffff22}",
        ".sa-calendar .evdot:hover{transform:scale(1.25)}",
        ".sa-calendar .evtitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:#e4e4e7;cursor:text;padding:2px 0}",
        ".sa-calendar .evtitle:hover{color:#fff;text-decoration:underline dotted #52525b}",
        ".sa-calendar .evdel{flex:none;width:24px;height:24px;border:0;background:transparent;color:#71717a;border-radius:7px;cursor:pointer;font-size:14px;line-height:1}",
        ".sa-calendar .evdel:hover{color:#f43f5e;background:#f43f5e1a}",
        ".sa-calendar .evdel:focus-visible{outline:2px solid var(--acc);outline-offset:1px}",
        ".sa-calendar .evedit{flex:1;min-width:0;min-height:28px;border-radius:8px;border:1px solid var(--acc);background:#0e0e11;color:#e4e4e7;padding:0 8px;font:inherit;font-size:12.5px}",
        ".sa-calendar .evedit:focus{outline:none}",
        ".sa-calendar .empty{margin:auto;text-align:center;color:#71717a;font-size:12.5px;padding:24px 12px;line-height:1.7}",
        ".sa-calendar .khint{flex:none;padding:6px 10px;border-top:1px solid #27272a;font-size:10.5px;color:#52525b;letter-spacing:.3px}",
        ".sa-calendar kbd{font:10px ui-monospace,monospace;background:#1f1f23;border:1px solid #3f3f46;border-radius:4px;padding:1px 4px;color:#a1a1aa}"
      ].join("\n");
      root.appendChild(css);

      var wrap = document.createElement("div");
      wrap.className = "sa-calendar";
      root.appendChild(wrap);
      wrap.innerHTML =
        '<div class="bar">' +
          '<button class="btn sq" data-act="prev" aria-label="Previous month" title="Previous month (Left)">&#8249;</button>' +
          '<h2 id="mtitle"></h2>' +
          '<button class="btn sq" data-act="next" aria-label="Next month" title="Next month (Right)">&#8250;</button>' +
          '<span class="cnt" id="mcount"></span>' +
          '<button class="btn" data-act="today">Today</button>' +
        '</div>' +
        '<div class="body">' +
          '<div class="main">' +
            '<div class="dow">' + DOW.map(function (d) { return "<div>" + d + "</div>"; }).join("") + '</div>' +
            '<div class="grid" id="grid" role="grid" aria-label="Days"></div>' +
          '</div>' +
          '<div class="side">' +
            '<div class="shead"><h3 id="dtitle">Select a date</h3><p id="dsub"></p></div>' +
            '<div class="addrow">' +
              '<input class="inp" id="addinp" placeholder="Add event&hellip;" aria-label="New event title" maxlength="120" disabled>' +
              '<button class="btn pri" id="addbtn" aria-label="Add event" title="Add event (Enter)">+</button>' +
            '</div>' +
            '<div class="list" id="elist"></div>' +
            '<div class="khint"><kbd>&larr;</kbd><kbd>&rarr;</kbd> month &nbsp; <kbd>&uarr;</kbd><kbd>&darr;</kbd> day &nbsp; <kbd>T</kbd> today</div>' +
          '</div>' +
        '</div>';

      var gridEl = wrap.querySelector("#grid");
      var mtitle = wrap.querySelector("#mtitle");
      var mcount = wrap.querySelector("#mcount");
      var dtitle = wrap.querySelector("#dtitle");
      var dsub = wrap.querySelector("#dsub");
      var elist = wrap.querySelector("#elist");
      var addinp = wrap.querySelector("#addinp");
      var addbtn = wrap.querySelector("#addbtn");

      /* ---- render ---- */
      function renderGrid() {
        mtitle.textContent = MONTHS[viewM] + " " + viewY;
        mcount.textContent = monthCount() ? monthCount() + " event" + (monthCount() === 1 ? "" : "s") : "";
        var first = new Date(viewY, viewM, 1).getDay();
        var dim = new Date(viewY, viewM + 1, 0).getDate();
        var tk = todayKey();
        var html = [];
        for (var i = 0; i < first; i++) html.push('<button class="cell off" tabindex="-1" disabled aria-hidden="true"></button>');
        for (var d = 1; d <= dim; d++) {
          var k = keyOf(viewY, viewM, d);
          var evs = eventsOn(k);
          var cls = "cell" + (k === tk ? " today" : "") + (k === sel ? " sel" : "");
          var inner = '<span class="dnum">' + d + "</span>";
          if (evs.length) {
            inner += '<span class="chip" style="background:' + evs[0].color + 'cc">' + esc(evs[0].title) + "</span>";
            var dots = evs.slice(0, 4).map(function (e) { return '<i class="dot" style="background:' + e.color + '"></i>'; }).join("");
            if (evs.length > 4) dots += '<i class="more">+' + (evs.length - 4) + "</i>";
            inner += '<span class="dots">' + dots + "</span>";
          }
          html.push('<button class="' + cls + '" data-date="' + k + '" role="gridcell" aria-label="' + k + (evs.length ? ", " + evs.length + " events" : "") + '">' + inner + "</button>");
        }
        gridEl.innerHTML = html.join("");
      }

      function renderSide() {
        if (!sel) {
          dtitle.textContent = "Select a date";
          dsub.textContent = "Click any day to see and add events";
          addinp.disabled = true;
          addbtn.disabled = true;
          elist.innerHTML = '<div class="empty">Pick a day on the grid.<br>Events show up here with colored dots.</div>';
          return;
        }
        var dt = new Date(sel + "T00:00:00");
        var wd = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dt.getDay()];
        dtitle.textContent = wd + ", " + MONTHS[dt.getMonth()] + " " + dt.getDate();
        dsub.textContent = sel + " \u00b7 " + eventsOn(sel).length + " event" + (eventsOn(sel).length === 1 ? "" : "s");
        addinp.disabled = false;
        addbtn.disabled = false;
        var evs = eventsOn(sel);
        if (!evs.length) {
          elist.innerHTML = '<div class="empty">No events this day.<br>Type a title above and press <b>+</b> or Enter.</div>';
          return;
        }
        elist.innerHTML = evs.map(function (e) {
          if (e.id === editId) {
            return '<div class="ev"><input class="evedit" data-edit="' + e.id + '" value="' + esc(e.title) + '" aria-label="Edit event title"></div>';
          }
          return '<div class="ev" data-id="' + e.id + '">' +
            '<span class="evdot" style="background:' + e.color + '" title="Cycle color" data-cyc="' + e.id + '"></span>' +
            '<span class="evtitle" data-editgo="' + e.id + '" title="Click to edit">' + esc(e.title) + "</span>" +
            '<button class="evdel" data-del="' + e.id + '" aria-label="Delete event" title="Delete">&times;</button>' +
          "</div>";
        }).join("");
        var ed = elist.querySelector(".evedit");
        if (ed) {
          ed.focus();
          ed.setSelectionRange(ed.value.length, ed.value.length);
          ed.addEventListener("keydown", function (ev) {
            if (ev.key === "Enter") { commitEdit(ed.value); }
            else if (ev.key === "Escape") { editId = null; renderSide(); }
            ev.stopPropagation();
          });
          ed.addEventListener("blur", function () { commitEdit(ed.value); });
        }
      }

      function commitEdit(val) {
        if (!editId) return;
        var v = String(val || "").trim();
        for (var i = 0; i < events.length; i++) {
          if (events[i].id === editId) {
            if (v) { events[i].title = v.slice(0, 120); toast("Event updated", "ok"); }
            else { events.splice(i, 1); toast("Empty title — event removed", "warn"); }
            break;
          }
        }
        editId = null;
        saveEvents();
        renderGrid();
        renderSide();
      }

      function render() { renderGrid(); renderSide(); }

      /* ---- actions ---- */
      function shiftMonth(n) {
        var m = viewM + n, y = viewY;
        if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
        if (y < 1900 || y > 2100) return;
        viewM = m; viewY = y;
        renderGrid();
      }
      function goToday() {
        viewY = today.getFullYear(); viewM = today.getMonth();
        sel = todayKey();
        render();
      }
      function shiftSel(days) {
        var base = sel ? new Date(sel + "T00:00:00") : new Date(today.getFullYear(), today.getMonth(), today.getDate());
        base.setDate(base.getDate() + days);
        viewY = base.getFullYear(); viewM = base.getMonth();
        sel = keyOf(viewY, viewM, base.getDate());
        render();
      }
      function addEvent() {
        var t = addinp.value.trim();
        if (!sel || !t) { if (!t) toast("Type an event title first", "warn"); return; }
        events.push({ id: uid(), date: sel, title: t.slice(0, 120), color: COLORS[events.length % COLORS.length] });
        saveEvents();
        addinp.value = "";
        render();
        addinp.focus();
        toast("Event added to " + sel, "ok");
      }

      /* ---- events (delegated) ---- */
      wrap.addEventListener("click", function (e) {
        var el = e.target.closest ? e.target.closest("[data-act],[data-date],[data-del],[data-cyc],[data-editgo]") : null;
        if (!el) return;
        if (el.hasAttribute("data-act")) {
          var a = el.getAttribute("data-act");
          if (a === "prev") shiftMonth(-1);
          else if (a === "next") shiftMonth(1);
          else if (a === "today") goToday();
          return;
        }
        if (el.hasAttribute("data-date")) {
          sel = el.getAttribute("data-date");
          viewY = Number(sel.slice(0, 4)); viewM = Number(sel.slice(5, 7)) - 1;
          render();
          if (adding) { addinp.focus(); }
          return;
        }
        if (el.hasAttribute("data-del")) {
          var id = el.getAttribute("data-del");
          for (var i = 0; i < events.length; i++) {
            if (events[i].id === id) { toast("Deleted \u201c" + events[i].title.slice(0, 40) + "\u201d", "info"); events.splice(i, 1); break; }
          }
          saveEvents(); render();
          return;
        }
        if (el.hasAttribute("data-cyc")) {
          var cid = el.getAttribute("data-cyc");
          events.forEach(function (ev) {
            if (ev.id === cid) ev.color = COLORS[(COLORS.indexOf(ev.color) + 1) % COLORS.length];
          });
          saveEvents(); render();
          return;
        }
        if (el.hasAttribute("data-editgo")) {
          editId = el.getAttribute("data-editgo");
          renderSide();
        }
      });

      addbtn.addEventListener("click", addEvent);
      addinp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); addEvent(); }
        e.stopPropagation();
      });

      root.addEventListener("keydown", function (e) {
        var t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
        if (e.key === "ArrowLeft") { e.preventDefault(); shiftMonth(-1); }
        else if (e.key === "ArrowRight") { e.preventDefault(); shiftMonth(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); shiftSel(-7); }
        else if (e.key === "ArrowDown") { e.preventDefault(); shiftSel(7); }
        else if (e.key === "t" || e.key === "T") { e.preventDefault(); goToday(); }
        else if (e.key === "Enter") { e.preventDefault(); if (sel) addinp.focus(); }
      });

      goToday();
      return {
        onClose: function () { /* no timers — nothing to clean up */ }
      };
    }
  };
})();
