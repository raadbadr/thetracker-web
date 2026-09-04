      $("editCancelBtn").addEventListener("click", closeEdit);
      $("editForm").addEventListener("submit", function (ev) {
        ev.preventDefault();
        if (!state.editing) return;
        var title = $("editTitle").value.trim();
        if (!title) { setMsg("editMsg", T("titleRequired"), "error"); $("editTitle").focus(); return; }
        var trackerId = $("editTracker").value;
        if (!trackerId) { setMsg("editMsg", T("trackerRequired"), "error"); $("editTracker").focus(); return; }
        clearMsg("editMsg");
        var patch = {
          title: title,
          tracker_id: trackerId,
          due_at: fromLocalInput($("editDue").value),
          category: $("editCategory").value.trim() || null,
          assignee_id: $("editAssignee").value || null,
          amount: numOrNull($("editAmount").value),
          client_name: $("editClient").value.trim() || null,
          client_name_en: $("editClientEn").value.trim() || null,
          case_number: $("editCaseNumber").value.trim() || null,
          status: $("editStatus").value || "open"
        };
        var id = state.editing.id;
        guard(function () {
          $("editSaveBtn").disabled = true;
          return app.updateItem(id, patch).then(function () {
            toast("saved");
            closeEdit();
            return refresh();
          });
        }).then(function () { $("editSaveBtn").disabled = false; }, function (err) {
          $("editSaveBtn").disabled = false;
          fail(err, "editMsg");
        });
      });

      document.addEventListener("keydown", function (ev) {
        if (ev.key !== "Escape") return;
        if (!$("editPanel").hidden) closeEdit();
        else if (!$("addItemPanel").hidden) { hide("addItemPanel"); clearMsg("addMsg"); }
      });

      /* ---------- calendar ---------- */

      function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }

      function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

      /* Grid always starts on Sunday; rows = as many full weeks as the month needs.
         الشهر هنا هو الشهر المعروض فعلا: ميلادي أو هجري بحسب الوضع. */
      function calRange() {
        var first = calendarIsHijri() ? startOfHijriMonth(state.month) : startOfMonth(state.month);
        var daysInMonth = calendarIsHijri()
          ? Math.round((shiftHijriMonth(first, 1) - first) / 86400000)
          : new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
        var rows = Math.ceil((first.getDay() + daysInMonth) / 7);
        var start = addDays(first, -first.getDay());
        var end = addDays(start, rows * 7);
        return { start: start, end: end, cells: rows * 7, first: first, days: daysInMonth };
      }

      function loadCalendar() {
        var r = calRange();
        return app.listItems({ from: r.start.toISOString(), to: r.end.toISOString(), limit: 1000 }).then(function (items) {
          state.calItems = (items || []).filter(matchesView);
          renderCalendar();
        }).catch(function (err) {
          state.calItems = [];
          renderCalendar();
          fail(err);
        });
      }

      /* تقويم أم القرى عبر Intl: الشبكة نفسها تتبع الشهر الهجري في الوضع الهجري */
      var HIJRI_LOCALE = "ar-SA-u-ca-islamic-umalqura-nu-latn";   /* الأرقام غربية دائما */

      function hijriParts(date) {
        try {
          var parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
            day: "numeric", month: "numeric", year: "numeric"
          }).formatToParts(date);
          var out = {};
          parts.forEach(function (p) { if (p.type !== "literal") out[p.type] = parseInt(p.value, 10); });
          return out;
        } catch (e) { return null; }
      }

      function hijriTitle(date) {
        try {
          return new Intl.DateTimeFormat(HIJRI_LOCALE, { month: "long", year: "numeric" }).format(date);
        } catch (e) { return ""; }
      }

      function startOfHijriMonth(date) {
        var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        var p = hijriParts(d);
        if (!p) return startOfMonth(date);
        var guard = 0;
        while (p && p.day > 1 && guard < 40) {
          d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (p.day - 1));
          p = hijriParts(d);
          guard++;
          if (p && p.day === 1) break;
        }
        return d;
      }

      function shiftHijriMonth(date, dir) {
        var start = startOfHijriMonth(date);
        var probe = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (dir > 0 ? 31 : -2));
        return startOfHijriMonth(probe);
      }

      function calendarIsHijri() { return state.calMode === "hijri"; }

      function renderCalendar() {
        if (!state.month) return;
        var grid = $("calGrid");
        grid.innerHTML = "";
        $("calTitle").textContent = calendarIsHijri()
          ? hijriTitle(state.month)
          : T("month" + (state.month.getMonth() + 1)) + " " + state.month.getFullYear();

        DAY_KEYS.forEach(function (k) {
          var h = document.createElement("div");
          h.className = "cal-dow";
          h.textContent = T(k);
          grid.appendChild(h);
        });

        var byDay = {};
        state.calItems.forEach(function (it) {
          if (!it.due_at) return;
          var d = new Date(it.due_at);
          if (isNaN(d.getTime())) return;
          var k = dateKey(d);
          (byDay[k] = byDay[k] || []).push(it);
        });

        var r = calRange();
        var todayKey = dateKey(new Date());
        var monthEnd = addDays(r.first, r.days);
        for (var i = 0; i < r.cells; i++) {
          var d = addDays(r.start, i);
          var key = dateKey(d);
          var outside = d < r.first || d >= monthEnd;
          var cell = document.createElement("div");
          cell.className = "cal-cell" +
            (outside ? " is-outside" : "") +
            (key === todayKey ? " is-today" : "");
          var num = document.createElement("div");
          num.className = "cal-day";
          if (calendarIsHijri()) {
            var hp = hijriParts(d);
            num.textContent = hp ? String(hp.day) : String(d.getDate());
            var sub = document.createElement("span");
            sub.className = "cal-day-sub";
            sub.textContent = " · " + d.getDate();
            num.appendChild(sub);
          } else {
            num.textContent = String(d.getDate());
          }
          cell.appendChild(num);

          var list = byDay[key] || [];
          list.slice(0, MAX_CHIPS).forEach(function (it) {
            var chip = document.createElement("button");
            chip.type = "button";
            chip.className = "cal-chip status-" + statusKeyOf(it);
            chip.textContent = it.title || "";
            chip.title = it.title || "";
            chip.dataset.id = it.id;
            cell.appendChild(chip);
          });
          if (list.length > MAX_CHIPS) {
            var more = document.createElement("div");
            more.className = "cal-more";
            more.textContent = "+" + (list.length - MAX_CHIPS);
            more.title = fmt("moreItems", { n: list.length - MAX_CHIPS });
            cell.appendChild(more);
          }
          grid.appendChild(cell);
        }
      }

      $("calGrid").addEventListener("click", function (ev) {
        var c = ev.target.closest(".cal-chip");
        if (!c) return;
        var it = findItem(c.dataset.id);
        if (it) openEdit(it);
      });
      function setAnchorFromMonth() {
        state.calAnchor = new Date(state.month.getFullYear(), state.month.getMonth(), state.month.getDate() + 15);
      }

      $("calPrevBtn").addEventListener("click", function () {
        state.month = calendarIsHijri()
          ? shiftHijriMonth(state.month, -1)
          : new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
        setAnchorFromMonth();
        loadCalendar();
      });
      $("calNextBtn").addEventListener("click", function () {
        state.month = calendarIsHijri()
          ? shiftHijriMonth(state.month, 1)
          : new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
        setAnchorFromMonth();
        loadCalendar();
      });

      document.addEventListener("click", function (ev) {
        var btn = ev.target.closest("[data-cal-mode]");
        if (!btn) return;
        state.calMode = btn.dataset.calMode === "hijri" ? "hijri" : "greg";
        try { localStorage.setItem("tracker_cal_mode", state.calMode); } catch (e) { /* ignore */ }
        var g = $("calGregBtn"), h = $("calHijriBtn");
        if (g) g.classList.toggle("is-active", state.calMode === "greg");
        if (h) h.classList.toggle("is-active", state.calMode === "hijri");
        var anchor = state.calAnchor || new Date();
        state.month = calendarIsHijri() ? startOfHijriMonth(anchor) : startOfMonth(anchor);
        loadCalendar();
      });
      $("calTodayBtn").addEventListener("click", function () {
        var now = new Date();
        state.month = calendarIsHijri() ? startOfHijriMonth(now) : startOfMonth(now);
        loadCalendar();
      });

      /* ---------- language change hook (called from setLang) ---------- */

      window.__dashboardRerender = function () {
        if (!app || !state.org) return;
        renderTopBar();
        renderSelects();
        renderList();
        renderCalendar();
      };

      /* Deferred scripts (supabase-js, app.js, common.js) run before DOMContentLoaded. */
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
      else boot();
    })();
  