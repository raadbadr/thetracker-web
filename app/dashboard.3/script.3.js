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
          status: $("editStatus").value || "open",
          remind_before: $("editRemind").value || null
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
          state.calAll = (items || []).filter(matchesView);
          state.calItems = applyCalFilter(state.calAll);
          renderCalendar();
        }).catch(function (err) {
          state.calItems = [];
          renderCalendar();
          fail(err);
        });
      }

      /* تقويم أم القرى عبر Intl: الشبكة نفسها تتبع الشهر الهجري في الوضع الهجري */
      /* اسم الشهر الهجري بلغة الواجهة نفسها (لا «ربيع» في الإنجليزية)، والأرقام غربية دائما */
      function hijriLocale() {
        var lo = app.lang();
        var base = lo === "ur" ? "ur-PK" : (lo === "ar" ? "ar-SA" : (lo === "fr" ? "fr-FR" : "en-US"));
        return base + "-u-ca-islamic-umalqura-nu-latn";
      }

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
          return new Intl.DateTimeFormat(hijriLocale(), { month: "long", year: "numeric" }).format(date);
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

      /* فلاتر التقويم الماستر: تصنيف بلا إعادة جلب؛ الأوراق = عناصر بنوع مستند، والمهام = ما ليس قضية ولا مخالفة ولا ورقة */
      function calKind(it) {
        if (it && it.data && it.data.document_kind) return "documents";
        if (isCaseItem(it)) return "cases";
        if (isViolationItem(it)) return "violations";
        return "tasks";
      }
      function applyCalFilter(list) {
        var f = state.calFilter || "all";
        return f === "all" ? (list || []) : (list || []).filter(function (it) { return calKind(it) === f; });
      }
      function wireCalFilters() {
        var box = $("calFilters");
        if (!box) return;
        /* الرئيسية فقط: هي التقويم الماستر. تُقرأ الوجهة من الرابط لا من state،
           لأن هذه الدالة تُنادى عند تحميل السكربت قبل أن يُحدَّد viewType. */
        box.hidden = !!currentViewType();
        box.addEventListener("click", function (ev) {
          var btn = ev.target.closest("[data-cal-filter]");
          if (!btn) return;
          state.calFilter = btn.getAttribute("data-cal-filter") || "all";
          box.querySelectorAll("[data-cal-filter]").forEach(function (b) { b.classList.toggle("is-active", b === btn); b.setAttribute("aria-pressed", b === btn ? "true" : "false"); });
          state.calItems = applyCalFilter(state.calAll || state.calItems);
          renderCalendar();
        });
      }

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
            var paper = paperKindOf(it);
            var chip = document.createElement("button");
            chip.type = "button";
            chip.className = "cal-chip " + (paper ? "is-paper" : "status-" + statusKeyOf(it));
            chip.textContent = paper ? paperEventLabel(it, paper) : (it.title || "");
            chip.title = chip.textContent;
            chip.dataset.id = it.id;
            if (paper) chip.dataset.paper = "1";
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

      /* الورقة الرسمية حدث بلونه: «انتهاء السجل التجاري»، والنقر يفتحها في المستندات */
      var PAPER_LABEL = {
        commercial_register: { ar: "السجل التجاري", en: "Commercial register", fr: "Registre de commerce", ur: "تجارتی رجسٹر" },
        vat_certificate: { ar: "الشهادة الضريبية", en: "VAT certificate", fr: "Certificat de TVA", ur: "ویٹ سرٹیفکیٹ" },
        gosi_certificate: { ar: "شهادة التأمينات", en: "GOSI certificate", fr: "Certificat GOSI", ur: "جی او ایس آئی سرٹیفکیٹ" },
        zakat_certificate: { ar: "شهادة الزكاة", en: "Zakat certificate", fr: "Certificat de zakat", ur: "زکوٰۃ سرٹیفکیٹ" },
        chamber_certificate: { ar: "شهادة الغرفة", en: "Chamber certificate", fr: "Certificat de chambre", ur: "چیمبر سرٹیفکیٹ" },
        saudization_certificate: { ar: "شهادة السعودة", en: "Saudization certificate", fr: "Certificat de saoudisation", ur: "سعودائزیشن سرٹیفکیٹ" },
        license: { ar: "الرخصة", en: "Licence", fr: "Licence", ur: "لائسنس" },
        lease_contract: { ar: "عقد الإيجار", en: "Lease contract", fr: "Bail", ur: "کرایہ نامہ" },
        insurance_policy: { ar: "وثيقة التأمين", en: "Insurance policy", fr: "Police d'assurance", ur: "انشورنس پالیسی" },
        id_document: { ar: "الهوية", en: "ID", fr: "Pièce d'identité", ur: "شناخت" },
        passport: { ar: "الجواز", en: "Passport", fr: "Passeport", ur: "پاسپورٹ" },
        driving_license: { ar: "رخصة القيادة", en: "Driving licence", fr: "Permis de conduire", ur: "ڈرائیونگ لائسنس" },
        vehicle_registration: { ar: "الاستمارة", en: "Vehicle registration", fr: "Carte grise", ur: "گاڑی رجسٹریشن" },
        power_of_attorney: { ar: "الوكالة", en: "Power of attorney", fr: "Procuration", ur: "وکالت نامہ" },
        employment_contract: { ar: "عقد العمل", en: "Employment contract", fr: "Contrat de travail", ur: "ملازمت کا معاہدہ" },
        articles_of_association: { ar: "عقد التأسيس", en: "Articles of association", fr: "Statuts", ur: "بانی معاہدہ" },
        bylaws: { ar: "النظام الأساسي", en: "Bylaws", fr: "Statuts", ur: "بنیادی قواعد" }
      };
      var EXPIRY_WORD = { ar: "انتهاء", en: "Expires", fr: "Expiration", ur: "اختتام" };

      function paperKindOf(item) {
        var kind = ((item && item.data) || {}).document_kind;
        return kind && PAPER_LABEL[kind] ? kind : "";
      }

      function paperEventLabel(item, kind) {
        var l = (app && app.lang && app.lang()) || document.documentElement.lang || "ar";
        var name = PAPER_LABEL[kind][l] || PAPER_LABEL[kind].ar;
        return (EXPIRY_WORD[l] || EXPIRY_WORD.ar) + " " + name;
      }

      $("calGrid").addEventListener("click", function (ev) {
        var c = ev.target.closest(".cal-chip");
        if (!c) return;
        if (c.dataset.paper) { window.location.href = "/app/documents.html#" + encodeURIComponent(c.dataset.id); return; }
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
      wireCalFilters();
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
  