    /* Dashboard logic — uses window.trackerApp (app/common.js) for all data access. */
    (function () {
      "use strict";

      var DAY_KEYS = ["daySun", "dayMon", "dayTue", "dayWed", "dayThu", "dayFri", "daySat"];
      var STATUS_KEYS = { open: "statusOpen", overdue: "statusOverdue", done: "statusDone", cancelled: "statusCancelled" };
      var MAX_CHIPS = 3;
      var TAB_KEY = "tracker_dash_tab";
      var SEARCH_DELAY = 300;

      var app = null;
      var state = {
        org: null,
        trackers: [],
        members: [],
        names: {},
        items: [],
        week: null,
        caseHead: null,
        caseKids: [],
        pendingParent: "",
        calItems: [],
        viewType: "",
        clientFilter: "",
        calMode: (function () { try { return localStorage.getItem("tracker_cal_mode") || "greg"; } catch (e) { return "greg"; } })(),
        calAnchor: new Date(),
        filters: { tracker: "", status: "", search: "" },
        tab: "list",
        month: null,
        editing: null,
        busy: false
      };
      var searchTimer = null;

      /* ---------- helpers ---------- */

      function $(id) { return document.getElementById(id); }

      function T(key) {
        var d = translations[lang()] || translations.ar;
        return (d && d[key]) || translations.ar[key] || key;
      }

      function fmt(key, vars) {
        var s = T(key);
        Object.keys(vars || {}).forEach(function (k) { s = s.replace("{" + k + "}", String(vars[k])); });
        return s;
      }

      function esc(s) {
        return String(s === null || s === undefined ? "" : s)
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      }

      function show(id) { var el = $(id); if (el) el.hidden = false; }
      function hide(id) { var el = $(id); if (el) el.hidden = true; }

      function setMsg(id, text, kind, html) {
        var el = $(id);
        if (!el) return;
        if (html) el.innerHTML = html; else el.textContent = text || "";
        el.className = "waitlist-msg" + (kind ? " " + kind : "");
        el.hidden = false;
      }
      function clearMsg(id) { var el = $(id); if (el) { el.textContent = ""; el.hidden = true; } }

      function toast(key, kind) { if (app && app.toast) app.toast(T(key), kind || "success"); }

      function pad(n) { return (n < 10 ? "0" : "") + n; }
      function toLocalInput(iso) {
        if (!iso) return "";
        var d = new Date(iso);
        if (isNaN(d.getTime())) return "";
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
      }
      function fromLocalInput(v) {
        if (!v) return null;
        var d = new Date(v);
        return isNaN(d.getTime()) ? null : d.toISOString();
      }
      function dateKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

      function isOverdue(item) {
        return item.status === "open" && !!item.due_at && new Date(item.due_at).getTime() < Date.now();
      }
      function statusKeyOf(item) { return isOverdue(item) ? "overdue" : (STATUS_KEYS[item.status] ? item.status : "open"); }

      function trackerName(item) {
        if (item.trackers && item.trackers.name) return item.trackers.name;
        for (var i = 0; i < state.trackers.length; i++) if (state.trackers[i].id === item.tracker_id) return state.trackers[i].name;
        return "";
      }
      function assigneeName(id) { return (id && state.names[id]) ? state.names[id] : T("noAssignee"); }

      function findItem(id) {
        var lists = [state.items, state.calItems];
        for (var l = 0; l < lists.length; l++) for (var i = 0; i < lists[l].length; i++) if (lists[l][i].id === id) return lists[l][i];
        return null;
      }

      function planLimitHtml(limit) {
        return esc(T(limit === "members" ? "planLimitMembers" : "planLimitItems")) +
          ' <a href="/pricing.html">' + esc(T("planLimitLink")) + "</a>";
      }

      /* Shows a friendly message for a failed call; msgId = inline message element (optional). */
      function fail(err, msgId) {
        if (window.console) console.warn("dashboard:", err && err.message ? err.message : err);
        if (err && err.code === "PLAN_LIMIT") {
          if (msgId) setMsg(msgId, "", "error", planLimitHtml(err.limit));
          else if (app && app.toast) app.toast(T(err.limit === "members" ? "planLimitMembers" : "planLimitItems"), "error");
          return;
        }
        var key = (err && err.code === "NO_ORG") ? "noOrg" : (msgId ? "genericError" : "errorLoad");
        if (msgId) setMsg(msgId, T(key), "error");
        else if (app && app.toast) app.toast(T(key), "error");
      }

      /* Serialises user actions: ignores clicks while a previous action is in flight. */
      function guard(fn) {
        if (state.busy) return Promise.resolve();
        state.busy = true;
        var p;
        try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
        return p.then(function (v) { state.busy = false; return v; }, function (e) { state.busy = false; throw e; });
      }

      function fillSelect(sel, options, value) {
        if (!sel) return;
        var sig = options.map(function (o) { return o.value + "\u0001" + o.label; }).join("\u0002");
        if (sel.dataset.sig === sig) {            /* نفس الخيارات: لا إعادة بناء */
          sel.value = value || "";
          if (sel.value !== (value || "") && sel.options.length) sel.selectedIndex = 0;
          return;
        }
        sel.dataset.sig = sig;
        sel.innerHTML = "";
        options.forEach(function (o) {
          var op = document.createElement("option");
          op.value = o.value;
          op.textContent = o.label;
          sel.appendChild(op);
        });
        sel.value = value || "";
        if (sel.value !== (value || "") && sel.options.length) sel.selectedIndex = 0;
      }

      function trackerOptions(firstKey) {
        return [{ value: "", label: T(firstKey) }].concat(state.trackers.map(function (t) { return { value: t.id, label: t.name }; }));
      }
      function memberOptions() {
        return [{ value: "", label: T("noAssignee") }].concat(state.members.map(function (m) {
          return { value: m.user_id, label: state.names[m.user_id] || m.user_id };
        }));
      }
      function statusOptions(withAll) {
        var list = withAll ? [{ value: "", label: T("filterAllStatuses") }] : [];
        list.push({ value: "open", label: T("statusOpen") });
        if (withAll) list.push({ value: "overdue", label: T("statusOverdue") });
        list.push({ value: "done", label: T("statusDone") });
        list.push({ value: "cancelled", label: T("statusCancelled") });
        return list;
      }

      /* ---------- لوحات فرعية: القضايا والمخالفات ---------- */

      var VIEW_TYPES = {
        cases: { titleKey: "viewCases", defaultCategory: "قضية",
                 words: ["قضية", "قضايا", "case", "cases", "affaire", "مقدمہ"] },
        violations: { titleKey: "viewViolations", defaultCategory: "مخالفة",
                      words: ["مخالفة", "مخالفات", "violation", "violations", "infraction", "خلاف"] },
        expenses: { titleKey: "viewExpenses", defaultCategory: "مصروف",
                    words: ["مصروف", "مصاريف", "expense", "expenses", "dépense", "اخراجات"] }
      };

      function currentViewType() {
        try {
          var v = new URLSearchParams(window.location.search).get("type");
          return VIEW_TYPES[v] ? v : "";
        } catch (e) { return ""; }
      }

      function isOfType(item, type) {
        var view = VIEW_TYPES[type];
        if (!view) return true;
        var hay = ((item.category || "") + " " + (item.title || "")).toLowerCase();
        for (var i = 0; i < view.words.length; i++) if (hay.indexOf(view.words[i].toLowerCase()) !== -1) return true;
        return false;
      }

      function isCaseItem(item) { return isOfType(item, "cases"); }
      function isViolationItem(item) { return isOfType(item, "violations"); }

      function matchesView(item) { return isOfType(item, state.viewType); }

      function applyViewTitle() {
        var view = VIEW_TYPES[state.viewType];
        if (!view) return;
        var h1 = document.querySelector('h1[data-i18n="title"]');
        if (h1) { h1.textContent = T(view.titleKey); h1.removeAttribute("data-i18n"); }
        document.title = T(view.titleKey) + " | TheTracker";
      }

      /* ---------- مؤشر المخالفات ---------- */

      function violationMetrics(items) {
        var total = items.length, objected = 0, court = 0, repeated = 0;
        var numbers = {};
        items.forEach(function (it) {
          var data = it.data || {};
          var blob = JSON.stringify(data) + " " + (it.title || "") + " " + (it.category || "");
          if (/تظلم|تظلم|objection|appeal/i.test(blob)) objected++;
          if (/محكمة|court/i.test(blob)) court++;
          var num = data.violation_number || data["رقم المخالفة"] || data.number || null;
          if (num) {
            num = String(num).trim();
            numbers[num] = (numbers[num] || 0) + 1;
          }
        });
        Object.keys(numbers).forEach(function (k) { if (numbers[k] > 1) repeated += numbers[k]; });
        return [
          { key: "chartTotal", value: total },
          { key: "chartObjected", value: objected },
          { key: "chartCourt", value: court },
          { key: "chartRepeated", value: repeated }
        ];
      }

      var DONUT_COLORS = ["#0e3a4d", "#cfe9f5", "#5f7a88", "#7fd3f0", "#00a0d2", "#9fb6c0"];

      function shortMoney(n) {
        var v = Number(n) || 0;
        var t;
        if (v >= 1000000) t = (v / 1000000).toFixed(v >= 10000000 ? 0 : 1).replace(/\.0$/, "") + "M";
        else if (v >= 1000) t = Math.round(v / 1000) + "K";
        else t = String(Math.round(v));
        return t + ' <span class="sar-symbol" aria-label="ريال سعودي"></span>';
      }

      function courtBreakdown(items) {
        var counts = {};
        items.forEach(function (it) {
          var court = dataOf(it, ["المحكمة", "الجهة القضائية", "محكمة الدرجة الأولى", "court"]);
          if (!court) return;
          counts[court] = (counts[court] || 0) + 1;
        });
        return Object.keys(counts).map(function (k) { return { label: k, value: counts[k] }; })
          .sort(function (a, b) { return b.value - a.value; }).slice(0, 6);
      }

      function donutSvg(parts, total) {
        if (!total) return "";
        var r = 60, c = 2 * Math.PI * r, offset = 0, seg = "";
        parts.forEach(function (p, i) {
          var len = (p.value / total) * c;
          seg += '<circle r="' + r + '" cx="80" cy="80" fill="transparent" stroke="' + DONUT_COLORS[i % DONUT_COLORS.length] +
                 '" stroke-width="34" stroke-dasharray="' + len.toFixed(2) + " " + (c - len).toFixed(2) +
                 '" stroke-dashoffset="' + (-offset).toFixed(2) + '" transform="rotate(-90 80 80)"></circle>';
          offset += len;
        });
        return '<svg viewBox="0 0 160 160" width="170" height="170" role="img">' + seg + "</svg>";
      }

      /* مؤشرات القضايا: نفس لغة مؤشر المخالفات، بمقاييس القضايا ومحور العملاء. */
      function caseMetrics(items) {
        var now = Date.now();
        var total = items.length, open = 0, overdue = 0, done = 0;
        items.forEach(function (it) {
          var due = it.due_at ? new Date(it.due_at).getTime() : null;
          if (it.status === "done") { done++; return; }
          if (it.status === "cancelled") return;
          open++;
          if (due && due < now) overdue++;
        });
        return [
          { key: "caseTotal", value: total },
          { key: "caseOpen", value: open },
          { key: "caseOverdue", value: overdue },
          { key: "caseDone", value: done }
        ];
      }

      function clientBreakdown(items) {
        var counts = {};
        items.forEach(function (it) {
          var name = it.client_name || dataOf(it, ["العميل", "اسم العميل", "الموكل", "client", "client_name"]);
          if (!name) return;
          counts[name] = (counts[name] || 0) + 1;
        });
        return Object.keys(counts).map(function (k) { return { label: k, value: counts[k] }; })
          .sort(function (a, b) { return b.value - a.value; }).slice(0, 6);
      }

      function barsHtml(metrics) {
        var max = Math.max.apply(null, metrics.map(function (m) { return m.value; }).concat([1]));
        var bars = '<div class="chart-bars">';
        metrics.forEach(function (m) {
          var h = Math.max(6, Math.round((m.value / max) * 150));
          bars += '<div class="chart-col"><span class="chart-val">' + esc(String(m.value)) + "</span>" +
                  '<span class="chart-bar" style="height:' + h + 'px"></span>' +
                  '<span class="chart-label">' + esc(T(m.key)) + "</span></div>";
        });
        return bars + "</div>";
      }

      function donutHtml(parts, emptyKey) {
        var total = parts.reduce(function (a, p) { return a + p.value; }, 0);
        if (!total) return { html: '<p class="empty-note">' + esc(T(emptyKey)) + "</p>", total: 0 };
        var legend = "";
        parts.forEach(function (p, i) {
          var pct = ((p.value / total) * 100).toFixed(2);
          legend += '<div><span class="dot" style="background:' + DONUT_COLORS[i % DONUT_COLORS.length] + '"></span>' +
                    esc(p.label) + " — " + esc(String(p.value)) + " (" + esc(pct) + "%)</div>";
        });
        return { html: '<div class="ind-body">' + donutSvg(parts, total) + '<div class="donut-legend">' + legend + "</div></div>", total: total };
      }

      function renderCasesChart() {
        var card = document.getElementById("casesChart");
        if (!card) return;
        var items = (state.items || []).filter(function (it) { return isCaseItem(it); });
        var clients = clientBreakdown(items);
        var donut = donutHtml(clients, "noClientData");

        var totalAmount = 0, doneAmount = 0;
        items.forEach(function (it) {
          var amt = Number(it.amount) || 0;
          totalAmount += amt;
          if (it.status === "done") doneAmount += amt;
        });

        paintEl(card).html =
          "<h2>" + esc(T("casesIndicatorsTitle")) + "</h2>" +
          '<div class="ind-grid">' +
            '<div class="ind-card"><h3>' + esc(T("casesChartTitle")) + "</h3>" + barsHtml(caseMetrics(items)) + "</div>" +
            '<div class="ind-card"><h3>' + esc(T("clientsTitle").replace("{n}", String(donut.total))) + "</h3>" + donut.html + "</div>" +
          "</div>" +
          '<div class="ind-totals">' +
            '<div class="ind-total"><b>' + shortMoney(totalAmount) + "</b><span>" + esc(T("caseAmount")) + "</span></div>" +
            '<div class="ind-total"><b>' + shortMoney(doneAmount) + "</b><span>" + esc(T("caseDoneAmount")) + "</span></div>" +
          "</div>";
      }

      function renderChart() {
        var card = document.getElementById("violationsChart");
        if (!card) return;
        var items = (state.items || []).filter(function (it) { return isViolationItem(it); });
        var bars = barsHtml(violationMetrics(items));

        var courts = courtBreakdown(items);
        var courtTotal = courts.reduce(function (a, p) { return a + p.value; }, 0);
        var legend = "";
        courts.forEach(function (p, i) {
          var pct = courtTotal ? ((p.value / courtTotal) * 100).toFixed(2) : "0";
          legend += '<div><span class="dot" style="background:' + DONUT_COLORS[i % DONUT_COLORS.length] + '"></span>' +
                    esc(p.label) + " — " + esc(String(p.value)) + " (" + esc(pct) + "%)</div>";
        });
        var donut = courtTotal
          ? '<div class="ind-body">' + donutSvg(courts, courtTotal) + '<div class="donut-legend">' + legend + "</div></div>"
          : '<p class="empty-note">' + esc(T("noCourtData")) + "</p>";

        var totalAmount = 0, cancelledAmount = 0;
        items.forEach(function (it) {
          var amt = Number(it.amount) || 0;
          totalAmount += amt;
          var blob = JSON.stringify(it.data || {}) + " " + (it.title || "");
          if (it.status === "cancelled" || /إلغاء|الغاء|قبول التظلم/.test(blob)) cancelledAmount += amt;
        });

        paintEl(card).html =
          "<h2>" + esc(T("indicatorsTitle")) + "</h2>" +
          '<div class="ind-grid">' +
            '<div class="ind-card"><h3>' + esc(T("chartTitle")) + "</h3>" + bars + "</div>" +
            '<div class="ind-card"><h3>' + esc(T("courtsTitle").replace("{n}", String(courtTotal))) + "</h3>" + donut + "</div>" +
          "</div>" +
          '<div class="ind-totals">' +
            '<div class="ind-total"><b>' + shortMoney(totalAmount) + "</b><span>" + esc(T("totalAmount")) + "</span></div>" +
            '<div class="ind-total"><b>' + shortMoney(cancelledAmount) + "</b><span>" + esc(T("cancelledAmount")) + "</span></div>" +
          "</div>";
      }

      /* ---------- الخط الزمني للإنجازات ---------- */

      var TL_KINDS = {
        item_created: "tlCreated", item_done: "tlDone", import: "tlImport",
        attachment: "tlAttachment", member: "tlMember", subscription: "tlPlan"
      };

      function relativeDay(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return "";
        var days = Math.floor((Date.now() - d.getTime()) / 86400000);
        if (days <= 0) return T("tlToday");
        if (days === 1) return T("tlYesterday");
        if (days < 30) return fmt("tlDaysAgo", { n: days });
        return app.fmtDate(iso);
      }

      /* شريط باركينزي: المساري زمني، المعالم علامات ملونة، والمقبض يقف على "الان" */
      var TLX_STEPS = 10000;
      var TLX_THUMB_W = 36;

      function tlxLeft(ratio, isRtl) {
        var r = isRtl ? 1 - ratio : ratio;
        return "calc(" + (TLX_THUMB_W / 2) + "px + (100% - " + TLX_THUMB_W + "px) * " + r + ")";
      }

      function tlxFmtDate(ms) {
        var lo = app.lang();
        var loc = lo === "ur" ? "ur-PK" : lo;
        return new Date(ms).toLocaleDateString(loc, { year: "numeric", month: "short", day: "numeric", numberingSystem: "latn" });
      }

      function tlxShortDate(ms) {
        var lo = app.lang();
        var loc = lo === "ur" ? "ur-PK" : lo;
        return new Date(ms).toLocaleDateString(loc, { month: "short", day: "numeric", numberingSystem: "latn" });
      }

      var tlState = { rows: [], stats: null, month: null };

      function renderTimeline(rows, stats) {
        var card = document.getElementById("timelineCard");
        if (!card) return;
        tlState.rows = rows || []; tlState.stats = stats || null;
        if (!tlState.month) { var n0 = new Date(); tlState.month = new Date(n0.getFullYear(), n0.getMonth(), 1); }
        var isRtl = (document.documentElement.getAttribute("dir") || "rtl") === "rtl";
        var html = "<h2>" + esc(T("timelineTitle")) + "</h2>";
        if (stats) {
          html += '<div class="ach-row">' +
            '<div class="ach-card"><b>' + esc(String(stats.done_this_month || 0)) + "</b><span>" + esc(T("achDoneMonth")) + "</span></div>" +
            '<div class="ach-card"><b>' + esc(String(stats.items_total || 0)) + "</b><span>" + esc(T("achItems")) + "</span></div>" +
            '<div class="ach-card"><b>' + esc(String(stats.files_total || 0)) + "</b><span>" + esc(T("achFiles")) + "</span></div>" +
            '<div class="ach-card"><b>' + esc(String(stats.imports_total || 0)) + "</b><span>" + esc(T("achImports")) + "</span></div>" +
            "</div>";
        }
        var events = (rows || []).map(function (r) {
          var ms = new Date(r.at).getTime();
          return isNaN(ms) ? null : { ms: ms, kind: r.kind, title: r.title || "", meta: r.meta || {} };
        }).filter(Boolean).sort(function (a, b) { return a.ms - b.ms; });

        /* شريط الشهر المعروض: من أول يوم فيه إلى آخر يوم */
        var monthStart = tlState.month;
        var monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
        var minMs = monthStart.getTime(), maxMs = monthEnd.getTime() - 1;
        var nowMs = Date.now();
        var isCurrent = nowMs >= minMs && nowMs <= maxMs;
        var todayMs = isCurrent ? nowMs : (nowMs > maxMs ? maxMs : minMs);
        var spanMs = maxMs - minMs;
        var daysInMonth = Math.round(spanMs / 86400000);
        var ratioOf = function (ms) { return Math.max(0, Math.min(1, (ms - minMs) / spanMs)); };
        events = events.filter(function (ev) { return ev.ms >= minMs && ev.ms <= maxMs; });
        var fillPct = 100;

        var ms = "";
        events.forEach(function (ev, i) {
          /* الرقم القياسي (RSK-/ITM-/ORG-…) داخلي: يحذف من أول العنوان إن سبقه */
          var shownTitle = String(ev.title || "").replace(/^\s*[A-Z]{2,4}-\d{6,8}-\d{3,5}\s*[·—–-]?\s*/, "").trim();
          var label = T(TL_KINDS[ev.kind] || "tlCreated") + (shownTitle ? " — " + shownTitle : "");
          ms += '<div class="tlx-ms" role="button" tabindex="0" data-idx="' + i + '" title="' + esc(label + " · " + tlxShortDate(ev.ms)) + '" data-kind="' + esc(ev.kind) + '" data-step="' + Math.round(ratioOf(ev.ms) * TLX_STEPS) + '" style="left:' + tlxLeft(ratioOf(ev.ms), isRtl) + '">' +
                '<span class="tlx-ms-label">' + esc(label) + "</span>" +
                '<span class="tlx-ms-date">' + esc(tlxShortDate(ev.ms)) + "</span>" +
                '<span class="tlx-ms-tick" aria-hidden="true"></span></div>';
        });

        /* أيام الشهر */
        var months = "";
        var lo = app.lang(); var loc = lo === "ur" ? "ur-PK" : lo;
        var todayKeyD = new Date(nowMs); var todayDay = isCurrent ? todayKeyD.getDate() : -1;
        for (var day = 1; day <= daysInMonth; day++) {
          var dms = new Date(monthStart.getFullYear(), monthStart.getMonth(), day).getTime();
          var rr = ratioOf(dms);
          months += '<span class="tlx-day-tick" style="left:' + tlxLeft(rr, isRtl) + '"></span>' +
                    '<span class="tlx-day-label' + (day === todayDay ? " is-today" : "") + '" style="left:' + tlxLeft(rr, isRtl) + '">' + day + "</span>";
        }
        var monthTitle = monthStart.toLocaleDateString(loc, { month: "long", year: "numeric", numberingSystem: "latn" });
        var nextMonthStart = monthEnd.getTime();

        var todayStep = Math.round(ratioOf(todayMs) * TLX_STEPS);
        html += '<div class="tlx" id="tlx" dir="' + (isRtl ? "rtl" : "ltr") + '" style="--timeline-fill-pct:' + fillPct + '%;--tlx-days:' + daysInMonth + '" data-today-step="' + todayStep + '">' +
          '<div class="tlx-title">' +
            '<button type="button" class="tlx-nav-btn" id="tlxMonthPrev" aria-label="' + esc(T("tlPrev")) + '"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M14.5 5.5 8 12l6.5 6.5"/></svg></button>' +
            "<span>" + esc(monthTitle) + "</span>" +
            '<button type="button" class="tlx-nav-btn" id="tlxMonthNext"' + (nextMonthStart > nowMs ? " disabled" : "") + ' aria-label="' + esc(T("tlNext")) + '"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M9.5 5.5 16 12l-6.5 6.5"/></svg></button>' +
          "</div>" +
          '<div class="tlx-nav-row">' +
            '<div class="tlx-scroll" id="tlxScroll"><div class="tlx-range-wrap">' + ms + months +
              '<input type="range" id="tlxSlider" min="0" max="' + TLX_STEPS + '" value="' + todayStep + '" step="1" aria-label="' + esc(T("timelineTitle")) + '">' +
              (isCurrent ? '<div class="tlx-today is-at-today" id="tlxToday" style="left:' + tlxLeft(ratioOf(todayMs), isRtl) + '"><span class="tlx-today-label">' + esc(T("tlNow")) + "</span></div>" : "") +
            "</div></div>" +
          "</div>" +
          '<div class="tlx-ends">' +
            '<button type="button" class="tlx-nav-btn" id="tlxPrev" aria-label="' + esc(T("tlPrev")) + '"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M14.5 5.5 8 12l6.5 6.5"/></svg></button>' +
            '<span class="tlx-ends-dates"><span>' + esc(tlxFmtDate(minMs)) + "</span><span>" + esc(tlxFmtDate(maxMs)) + "</span></span>" +
            '<button type="button" class="tlx-nav-btn" id="tlxNext" aria-label="' + esc(T("tlNext")) + '"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M9.5 5.5 16 12l-6.5 6.5"/></svg></button>' +
          "</div>" +
          /* الحدث المختار بكلماته أسفل الصف الموجود لا فوقه: «الحدث 3 من 7 — استيراد ملف · 5 سبتمبر»؛ ارتفاعه محجوز لسطرين فلا يقفز شيء */
          (events.length ? '<div class="tlx-current" id="tlxCurrent" aria-live="polite"></div>' : "") +
        "</div>";
        if (!events.length) html += '<p class="empty-note">' + esc(T("timelineEmpty")) + "</p>";
        if (card.__sig === html) return;
        card.__sig = html;
        card.innerHTML = html;
        card.hidden = false;
        wireTimeline();
      }

      function wireTimeline() {
        var bar = document.getElementById("tlx"), slider = document.getElementById("tlxSlider");
        if (!bar || !slider) return;
        var marks = [].slice.call(bar.querySelectorAll(".tlx-ms"));
        var stops = marks.map(function (m) { return Number(m.dataset.step); });
        stops = stops.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
        var today = document.getElementById("tlxToday"), prev = document.getElementById("tlxPrev"), next = document.getElementById("tlxNext");
        var SNAP = Math.round(TLX_STEPS * 0.015);
        var todayStep = Number(bar.dataset.todayStep) || TLX_STEPS;

        var current = document.getElementById("tlxCurrent");
        var selIdx = -1;
        /* pos: موضع المقبض؛ idx (اختياري): حدث بعينه — فتصل الأحداث المتزامنة في اليوم نفسه واحدا واحدا */
        function apply(pos, idx) {
          var p = Number(pos);
          bar.style.setProperty("--timeline-fill-pct", Math.max(0, Math.min(100, (p / TLX_STEPS) * 100)) + "%");
          if (today) today.classList.toggle("is-at-today", Math.abs(p - todayStep) <= SNAP);
          var active = null;
          if (typeof idx === "number" && marks[idx]) active = marks[idx];
          else {
            var best = -1;
            marks.forEach(function (m) { var st = Number(m.dataset.step); if (st <= p && st > best) { best = st; active = m; } });
            /* في اليوم الواحد أحداث عدة: يُختار آخرها فيبقى «التالي» ينتقل للأمام */
            if (active) marks.forEach(function (m) { if (m.dataset.step === active.dataset.step) active = m; });
          }
          /* المؤشر يعد «على الحدث» حين يقف المقبض عنده؛ وإلا فالسهمان يقاسان من موضع المقبض نفسه */
          var onEvent = !!active && Math.abs(Number(active.dataset.step) - p) <= SNAP;
          selIdx = onEvent ? Number(active.dataset.idx) : -1;
          marks.forEach(function (m) {
            m.classList.toggle("is-active", m === active);
            m.setAttribute("aria-pressed", m === active ? "true" : "false");
            /* العلامة الواقعة تحت المقبض لا تعترض سحبه؛ نقرة هناك تصل المقبض ويلتقطها الالتصاق */
            m.classList.toggle("is-under-thumb", Math.abs(Number(m.dataset.step) - p) <= SNAP);
          });
          /* السهمان يعملان ما دام هناك حدث في اتجاههما، وإلا يخفتان */
          if (prev) prev.disabled = !marks.length || (onEvent ? selIdx <= 0 : !marks.some(function (m) { return Number(m.dataset.step) < p; }));
          if (next) next.disabled = !marks.length || (onEvent ? selIdx >= marks.length - 1 : !marks.some(function (m) { return Number(m.dataset.step) > p; }));
          if (current) {
            var text = "";
            if (active) {
              var lab = active.querySelector(".tlx-ms-label"), dt = active.querySelector(".tlx-ms-date");
              text = T("tlEventOf").replace("{i}", String(Number(active.dataset.idx) + 1)).replace("{n}", String(marks.length)) +
                     " — " + (lab ? lab.textContent : "") + (dt ? " · " + dt.textContent : "");
            }
            if (current.textContent !== text) current.textContent = text;
          }
        }
        slider.addEventListener("input", function () {
          var v = Number(this.value);
          var nearest = null;
          for (var i = 0; i < stops.length; i++) if (Math.abs(v - stops[i]) <= SNAP && (nearest === null || Math.abs(v - stops[i]) < Math.abs(v - nearest))) nearest = stops[i];
          if (nearest !== null) { v = nearest; this.value = String(v); }
          apply(v);
        });
        /* نقرة أو Enter على العلامة تختار حدثها */
        function pick(m) { var st = Number(m.dataset.step); slider.value = String(st); apply(st, Number(m.dataset.idx)); scrollTo(st); }
        marks.forEach(function (m) {
          m.addEventListener("click", function () { pick(m); });
          m.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(m); } });
        });
        function shiftMonth(dir) {
          var m = tlState.month;
          tlState.month = new Date(m.getFullYear(), m.getMonth() + dir, 1);
          renderTimeline(tlState.rows, tlState.stats);
        }
        var mp = document.getElementById("tlxMonthPrev"), mn = document.getElementById("tlxMonthNext");
        if (mp) mp.addEventListener("click", function () { shiftMonth(-1); });
        if (mn) mn.addEventListener("click", function () { shiftMonth(1); });

        var sc = document.getElementById("tlxScroll");
        var isRtl = bar.getAttribute("dir") === "rtl";
        function scrollTo(step) {
          if (!sc) return;
          var ratio = step / TLX_STEPS;
          var x = (isRtl ? (1 - ratio) : ratio) * sc.scrollWidth - sc.clientWidth / 2;
          x = Math.max(0, Math.min(sc.scrollWidth - sc.clientWidth, x));
          try { sc.scrollTo({ left: isRtl ? -(sc.scrollWidth - sc.clientWidth - x) : x, behavior: "smooth" }); } catch (e) { sc.scrollLeft = x; }
        }
        /* السابق/التالي يمشيان على الأحداث واحدا واحدا (حتى المتزامنة)، وبلا أحداث في الاتجاه يتحرك المقبض يوما */
        function jump(dir) {
          var p = Number(slider.value);
          var ni = selIdx >= 0 ? selIdx + dir : -1;
          if (selIdx < 0) {
            if (dir < 0) { for (var i = marks.length - 1; i >= 0; i--) if (Number(marks[i].dataset.step) < p) { ni = i; break; } }
            else { for (var j = 0; j < marks.length; j++) if (Number(marks[j].dataset.step) > p) { ni = j; break; } }
          }
          if (ni >= 0 && ni < marks.length) pick(marks[ni]);
        }
        if (prev) prev.addEventListener("click", function () { jump(-1); });
        if (next) next.addEventListener("click", function () { jump(1); });
        /* العنوان يظهر كاملا: الحشو العلوي للمسطرة يتسع لأطول عنوان (3 أسطر أو أكثر) وتاريخه */
        if (sc) {
          var maxH = 0;
          marks.forEach(function (m) { var l = m.querySelector(".tlx-ms-label"); if (l && l.offsetHeight > maxH) maxH = l.offsetHeight; });
          var need = Math.ceil(maxH + 28);   /* قاعدة العنوان تعلو مركز المسار 30px، وهامش 4px فوق أعلى سطر */
          var pad = Math.max(61, need) + "px";
          if (sc.style.paddingTop !== pad) sc.style.paddingTop = pad;
        }
        apply(todayStep);
        scrollTo(todayStep);
      }

      function loadTimeline() {
        var card = document.getElementById("timelineCard");
        if (!card) return Promise.resolve();
        return Promise.all([app.activityFeed(1000), app.achievements()])
          .then(function (res) { renderTimeline(res[0] || [], res[1]); })
          .catch(function () { renderTimeline([], null); });
      }

      /* ---------- تخطيط لوحة المعلومات (خدمات + تقويم دائم الظهور) ---------- */

      var SERVICES = [
        { key: "svcImport", href: "/app/documents.html#importFlow",
          icon: '<path d="M19 12v7H5v-7H3v9h18v-9h-2zM11 3v10.17l-3.59-3.58L6 11l6 6 6-6-1.41-1.41L13 13.17V3h-2z"/>' },
        { key: "svcAdd", action: "add",
          icon: '<path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm0 16H5V9h14v11zm-6-8h-2v2H9v2h2v2h2v-2h2v-2h-2v-2z"/>' },
        { key: "svcTeam", href: "/app/team.html",
          icon: '<path d="M16 11a3 3 0 100-6 3 3 0 000 6zm-8 0a3 3 0 100-6 3 3 0 000 6zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>' },
        { key: "svcTelegram", href: "/app/settings.html",
          icon: '<path d="M9.04 15.47l-.37 5.2c.53 0 .76-.23 1.04-.5l2.5-2.39 5.18 3.79c.95.52 1.63.25 1.88-.88l3.4-15.95c.31-1.4-.5-1.95-1.43-1.6L1.6 10.8c-1.36.53-1.34 1.29-.23 1.63l5.1 1.59L18.3 6.58c.56-.36 1.06-.16.65.2L9.04 15.47z"/>' },
        { key: "svcCalendar", href: "/app/settings.html",
          icon: '<path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm0 16H5V9h14v11zM7 11h5v5H7z"/>' }
      ];

      function buildServices() {
        var html = "";
        SERVICES.forEach(function (svc) {
          var btn = svc.href
            ? '<a class="waitlist-btn" href="' + svc.href + '">' + esc(T("startService")) + "</a>"
            : '<button type="button" class="waitlist-btn" data-svc="' + svc.key + '">' + esc(T("startService")) + "</button>";
          html += '<div class="svc-card">' +
                  '<span class="svc-icon"><svg viewBox="0 0 24 24" aria-hidden="true">' + svc.icon + "</svg></span>" +
                  "<h3>" + esc(T(svc.key + "Title")) + "</h3>" +
                  "<p>" + esc(T(svc.key + "Text")) + "</p>" + btn + "</div>";
        });
        return html;
      }

      /* الأرقام تظهر مرة واحدة بعد وصولها كلها، لا صفرا ثم قيمة */
      /* لا يعاد رسم بطاقة بمحتوى مطابق، ولا تظهر بطاقة قبل محتواها */
      function paintEl(el) {
        return {
          set html(v) {
            if (!el || el.__sig === v) return;
            el.__sig = v;
            el.innerHTML = v;
            el.hidden = false;
          }
        };
      }

      function statsReady() {
        var sec = document.querySelector(".stats-section");
        if (sec) sec.hidden = false;
      }

      function layoutDashboard() {
        var dash = $("dashboard");
        if (!dash || dash.dataset.laidOut) return;
        var stats = dash.querySelector(".stats-section");
        var main = dash.querySelector(".content");
        var calendar = $("calendarPanel");
        if (!main || !calendar) return;

        var grid = document.createElement("div");
        grid.className = "dash-grid";
        var mainCol = document.createElement("div");
        mainCol.className = "dash-main";
        var sideCol = document.createElement("aside");
        sideCol.className = "dash-side";

        /* بطاقة الخدمات فوق القائمة */
        var services = document.createElement("div");
        services.className = "content";
        services.innerHTML = "<h2>" + esc(T("servicesTitle")) + '</h2><div class="svc-grid">' + buildServices() + "</div>";

        /* التقويم يخرج من التبويبات ويظهر دائما في العمود الجانبي */
        var calCard = document.createElement("div");
        calCard.className = "content cal-card";
        /* بلا عنوان للبطاقة: التقويم يعرف نفسه (أمر المهندس رعد) */

        dash.insertBefore(grid, dash.firstChild);

        /* لكل شاشة مؤشرها فوق بعرض الصفحة: القضايا مؤشرها، والمخالفات مؤشرها،
           ولوحة التحكم تجمع الاثنين. */
        function addChart(id) {
          var chart = document.createElement("div");
          chart.className = "content chart-card";
          chart.id = id;
          chart.hidden = true;   /* لا إطار فارغ قبل الرسم */
          dash.insertBefore(chart, dash.firstChild);
        }
        /* ملخص الأسبوع تحت المؤشرات مباشرة، في الرئيسية وحدها */
        if (!state.viewType) {
          var week = document.createElement("div");
          week.className = "content";
          week.id = "weekCard";
          week.hidden = true;   /* لا إطار فارغ قبل حسابه */
          dash.insertBefore(week, dash.firstChild);
        }
        if (state.viewType === "violations") addChart("violationsChart");
        else if (state.viewType === "cases") addChart("casesChart");
        else if (state.viewType === "expenses") addChart("expensesChart");
        else { addChart("violationsChart"); addChart("casesChart"); }

        calCard.appendChild(calendar);
        if (!state.viewType) {
          /* الرئيسية: التقويم بكامل العرض، ثم الخدمات متجاورة تحته، ثم القائمة */
          grid.classList.add("dash-grid--single");
          /* التقويم أول اللوحة بعرض الصفحة كاملا (أمر المهندس رعد)، لا داخل العمود */
          calCard.classList.add("cal-card--top");
          mainCol.appendChild(services);
          mainCol.appendChild(main);
        } else {
          /* القضايا والمخالفات: التقويم نفسه الكبير أول الصفحة بعرضها (أمر المهندس رعد)، ثم القائمة */
          calCard.classList.add("cal-card--top");
          mainCol.appendChild(main);
        }
        /* لوحة التحكم الرئيسية: المربعات الأربعة أول شيء فوق بعرض الصفحة */
        if (stats) {
          if (!state.viewType) { stats.classList.add("stats-top"); dash.insertBefore(stats, dash.firstChild); }
          else sideCol.appendChild(stats);
        }

        grid.appendChild(mainCol);
        if (state.viewType) grid.appendChild(sideCol);

        /* الخط الزمني يتصدر اللوحة بعرض الصفحة (وبعد المؤشرات في لوحتي القضايا والمخالفات) */
        var timeline = document.createElement("div");
        timeline.className = "content";
        timeline.id = "timelineCard";
        timeline.hidden = true;   /* يظهر مع أول رسم له */
        dash.insertBefore(timeline, grid);
        /* الرئيسية: المربعات الأربعة أولا ثم التقويم تحتها مباشرة (أمر المهندس رعد)؛ بقية الصفحات: التقويم أولا */
        var statsTop = dash.querySelector(".stats-section.stats-top");
        /* الفلاتر للرئيسية وحدها: تُخفى هنا لا عند تحميل السكربت، لأن viewType
           لا يُعرف إلا بعد قراءة ?type= من الرابط. */
        var calFilters = document.getElementById("calFilters");
        if (calFilters) calFilters.hidden = !!state.viewType;

        /* مصاريف التشغيل بلا تقويم: مواعيدها ليست جلسات ولا مخالفات (أمر المهندس رعد) */
        if (state.viewType === "expenses") calCard.remove();
        else if (statsTop && statsTop.parentNode === dash) dash.insertBefore(calCard, statsTop.nextSibling);
        else dash.insertBefore(calCard, dash.firstChild);

        var tabs = dash.querySelector(".tabs-row");
        if (tabs) tabs.hidden = true;
        /* التقويم دائم الظهور بعد ترتيب اللوحة، مهما قال التبويب المحفوظ */
        calendar.hidden = false;
        var listPanel = $("listPanel");
        if (listPanel) listPanel.hidden = false;

        services.addEventListener("click", function (ev) {
          var btn = ev.target.closest("[data-svc]");
          if (!btn) return;
          if (btn.dataset.svc === "svcAdd") { var add = $("addItemBtn"); if (add) add.click(); }
        });

        dash.dataset.laidOut = "1";
      }

      /* ---------- boot ---------- */

      function showUnavailable() {
        hide("loadingCard");
        hide("createOrgCard");
        hide("dashboard");
        show("unavailableCard");
      }

      function boot() {
        app = window.trackerApp;
        if (!app || !app.ready) { showUnavailable(); return; }
        app.ready.then(function (res) {
          if (!res || res.unavailable || app.unavailable || !app.client) { showUnavailable(); return; }
          hide("loadingCard");
          renderTopBar();
          if (!app.org) {
            show("createOrgCard");
            if (typeof window.__fillOrgTypes === "function") window.__fillOrgTypes();
            if (typeof window.__renderPackCards === "function") window.__renderPackCards();
            return;
          }
          state.org = app.org;
          state.month = startOfMonth(new Date());
          state.viewType = currentViewType();
          applyViewTitle();
          renderSelects();
          restoreTab();
          show("dashboard");
          layoutDashboard();
          wireAttachments();
          loadTimeline();
          try {
            if (new URLSearchParams(window.location.search).get("neworg")) {
              var f = $("newOrgForm");
              if (f) { f.hidden = false; $("newOrgName").focus(); }
            }
          } catch (e) { /* ignore */ }
          return loadAll();
        }).catch(function (err) {
          hide("loadingCard");
          fail(err);
        });
      }

      function loadAll() {
        return Promise.all([app.listTrackers(), app.listMembers()]).then(function (res) {
          state.trackers = res[0] || [];
          state.members = res[1] || [];
          state.names = {};
          state.members.forEach(function (m) {
            var p = m.profiles || {};
            state.names[m.user_id] = p.full_name || p.email || "";
          });
          renderSelects();
        }).catch(function (err) { fail(err); }).then(function () {
          return Promise.all([loadStats(), loadItems(), loadCalendar(), loadWeek().then(renderWeek)]);
        });
      }

      function refresh() {
        return Promise.all([loadStats(), loadItems(), loadCalendar(), loadWeek().then(renderWeek)]);
      }

      /* ---------- top bar / organizations ---------- */

      function renderTopBar() {
        var owns = !!(app.org && app.user && app.org.owner_id === app.user.id) || !!(app.org && app.org.role === "owner");
        var rn = $("renameOrgBtn"), dl = $("deleteOrgBtn");
        if (rn) rn.hidden = !app.org;
        if (dl) dl.hidden = !owns;
        var orgs = app.orgs || [];
        var sw = $("orgSwitcher");
        $("orgRow").hidden = !app.org;
        if (app.org) {
          $("orgName").textContent = app.org.name || "";
          if (orgs.length > 1) {
            fillSelect(sw, orgs.map(function (o) { return { value: o.id, label: o.name }; }), app.org.id);
            sw.hidden = false;
            $("orgName").hidden = true;
          } else {
            sw.hidden = true;
            $("orgName").hidden = false;
          }
        }
        sw.setAttribute("aria-label", T("switchOrg"));
        $("linkAdmin").hidden = !app.isPlatformAdmin();
        /* اسم الشركة وتبديلها صارا في الشريط العلوي، وإدارتها في الإعدادات. */
        hide("topBar");
      }

      function createOrgFlow(name, msgId, type) {
        var clean = String(name || "").trim();
        if (!clean) { setMsg(msgId, T("orgNameRequired"), "error"); return; }
        clearMsg(msgId);
        /* لا جهة بلا مستندها الرسمي: الحوار المشترك يطلب رقم السجل/الرخصة/الهوية وتاريخ انتهائه ثم ينشئ */
        if (app.openNewOrgDialog) {
          app.openNewOrgDialog();
          var typeSel = document.getElementById("newOrgType"), nameInp = document.getElementById("newOrgInput");
          if (typeSel && type) { typeSel.value = type; typeSel.dispatchEvent(new Event("change")); }
          if (nameInp) {
            nameInp.value = clean;
            nameInp.dataset.prefill = "1"; /* اسم مقترح: الاسم النظامي في المستند يعلو عليه */
            var reg = document.getElementById("newOrgReg");
            if (reg) reg.focus();
          }
          return;
        }
        guard(function () {
          return app.createOrg(clean, type).then(function () {
            toast("orgCreated");
            window.location.reload();
          });
        }).catch(function (err) { fail(err, msgId); });
      }

      $("orgSwitcher").addEventListener("change", function () {
        if (this.value && app && app.org && this.value !== app.org.id) app.setCurrentOrg(this.value);
      });
      $("renameOrgBtn").addEventListener("click", function () {
        if (!app.org) return;
        var form = $("renameOrgForm");
        $("renameOrgName").value = app.org.name || "";
        form.hidden = !form.hidden;
        if (!form.hidden) $("renameOrgName").focus();
      });

      $("renameOrgCancel").addEventListener("click", function () { $("renameOrgForm").hidden = true; });

      $("renameOrgForm").addEventListener("submit", function (ev) {
        ev.preventDefault();
        var name = String($("renameOrgName").value || "").trim();
        if (!name) return;
        app.renameOrg(name).then(function () {
          $("renameOrgForm").hidden = true;
          renderTopBar();
          app.toast(T("orgRenamed"));
        }).catch(function (err) { fail(err); });
      });

      $("deleteOrgBtn").addEventListener("click", function () {
        if (!app.org) return;
        if (!window.confirm(T("deleteOrgConfirm").replace("{name}", app.org.name || ""))) return;
        app.deleteOrg().then(function () { window.location.reload(); })
          .catch(function (err) { fail(err); });
      });

