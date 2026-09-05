      $("newOrgBtn").addEventListener("click", function () {
        var f = $("newOrgForm");
        f.hidden = !f.hidden;
        clearMsg("newOrgMsg");
        if (!f.hidden) $("newOrgName").focus();
      });
      $("newOrgCancel").addEventListener("click", function () { hide("newOrgForm"); clearMsg("newOrgMsg"); });
      $("newOrgForm").addEventListener("submit", function (ev) {
        ev.preventDefault();
        createOrgFlow($("newOrgName").value, "newOrgMsg");
      });
      $("createOrgForm").addEventListener("submit", function (ev) {
        ev.preventDefault();
        var sel = $("createOrgType");
        createOrgFlow($("createOrgName").value, "createOrgMsg", sel ? sel.value : "company");
      });

      /* أنواع الحسابات تأتي من النواة المشتركة، والاسم يتبع النوع المختار. */
      window.__fillOrgTypes = function () {
        var sel = $("createOrgType");
        if (!sel || !app || !app.entityTypes) return;
        var keep = sel.value;
        sel.innerHTML = app.entityTypes().map(function (t) {
          return '<option value="' + t.value + '">' + (t[l] || t.ar) + "</option>";
        }).join("");
        if (keep) sel.value = keep;
        var input = $("createOrgName");
        if (input) input.placeholder = T(app.isPersonType(sel.value) ? "selfNamePlaceholder" : "newOrgPlaceholder");
      };
      $("createOrgType").addEventListener("change", function () {
        var input = $("createOrgName");
        if (!input || !app || !app.isPersonType) return;
        input.placeholder = T(app.isPersonType(this.value) ? "selfNamePlaceholder" : "newOrgPlaceholder");
        if (app.isPersonType(this.value) && !String(input.value || "").trim() && app.profile && app.profile.full_name) {
          input.value = app.profile.full_name;
        }
      });
      $("signOutBtn").addEventListener("click", function () {
        var go = function () { window.location.href = "/login.html"; };
        if (window.trackerAuth && window.trackerAuth.signOut) window.trackerAuth.signOut().then(go, go);
        else go();
      });

      /* ---------- stats ---------- */

      function countWhere(build) {
        var q = app.client.from("items").select("id", { count: "exact", head: true }).eq("org_id", state.org.id);
        q = build(q);
        return q.then(function (r) {
          if (r && r.error) throw new Error(r.error.message);
          return (r && typeof r.count === "number") ? r.count : 0;
        });
      }

      function loadStats() {
        if (state.viewType) return loadViewStats();
        var now = new Date();
        var nowIso = now.toISOString();
        var in7 = new Date(now.getTime() + 7 * 86400000).toISOString();
        return Promise.all([
          app.countItems({ status: "open" }),
          countWhere(function (q) { return q.eq("status", "open").gte("due_at", nowIso).lte("due_at", in7); }),
          countWhere(function (q) { return q.eq("status", "open").lt("due_at", nowIso); }),
          app.countItems({ status: "done" })
        ]).then(function (n) {
          $("statOpenVal").textContent = String(n[0]);
          $("statDue7Val").textContent = String(n[1]);
          $("statOverdueVal").textContent = String(n[2]);
          $("statDoneVal").textContent = String(n[3]);
          statsReady();
        }).catch(function (err) { statsReady(); fail(err); });
      }

      /* أرقام اللوحة الفرعية تحسب من عناصرها هي لا من عناصر الشركة كلها. */
      function loadViewStats() {
        var now = Date.now();
        var in7 = now + 7 * 86400000;
        return app.listItems({}).then(function (rows) {
          var items = (rows || []).filter(matchesView);
          var open = 0, due7 = 0, overdue = 0, done = 0;
          items.forEach(function (it) {
            var due = it.due_at ? new Date(it.due_at).getTime() : null;
            if (it.status === "done") { done++; return; }
            if (it.status === "open") {
              open++;
              if (due && due >= now && due <= in7) due7++;
              if (due && due < now) overdue++;
            }
          });
          $("statOpenVal").textContent = String(open);
          $("statDue7Val").textContent = String(due7);
          $("statOverdueVal").textContent = String(overdue);
          statsReady();
          $("statDoneVal").textContent = String(done);
        }).catch(function (err) { fail(err); });
      }

      /* ---------- tabs ---------- */

      function setTab(tab) {
        /* التقويم صار دائم الظهور في العمود الجانبي، فالتبويبات لم تعد تخفيه. */
        if (document.getElementById("dashboard") && document.getElementById("dashboard").dataset.laidOut) {
          state.tab = "list";
          $("listPanel").hidden = false;
          $("calendarPanel").hidden = false;
          return;
        }
        /* التقويم لا يُخفى في أي حال: القائمة والتقويم يظهران معا */
        state.tab = "list";
        $("listPanel").hidden = false;
        $("calendarPanel").hidden = false;
        [$("tabListBtn"), $("tabCalendarBtn")].forEach(function (b) {
          var active = b.dataset.tab === state.tab;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-selected", active ? "true" : "false");
        });
        try { localStorage.setItem(TAB_KEY, state.tab); } catch (e) { /* storage blocked */ }
      }
      function restoreTab() {
        var saved = "list";
        try { saved = localStorage.getItem(TAB_KEY) || "list"; } catch (e) { /* ignore */ }
        setTab(saved);
      }
      $("tabListBtn").addEventListener("click", function () { setTab("list"); });
      $("tabCalendarBtn").addEventListener("click", function () { setTab("calendar"); });

      /* ---------- selects / filters ---------- */

      function renderSelects() {
        fillSelect($("filterTracker"), trackerOptions("filterAllTrackers"), state.filters.tracker);
        fillSelect($("filterStatus"), statusOptions(true), state.filters.status);
        fillSelect($("addTracker"), trackerOptions("chooseTracker"), $("addTracker").value);
        fillSelect($("addAssignee"), memberOptions(), $("addAssignee").value);
        fillSelect($("editTracker"), trackerOptions("chooseTracker"), $("editTracker").value);
        fillSelect($("editAssignee"), memberOptions(), $("editAssignee").value);
        fillSelect($("editStatus"), statusOptions(false), $("editStatus").value);
        $("noTrackersHint").hidden = state.trackers.length > 0;
      }

      function exportColumns() {
        var items = state.items || [];
        var extra = {};
        items.forEach(function (it) { Object.keys(it.data || {}).forEach(function (k) { extra[k] = true; }); });
        var cols = [
          /* الرقم القياسي داخلي: التصدير يحمل رقم الورقة أو القضية أو المخالفة */
          { label: T("colNumber"), get: function (r) { var d = r.data || {};
              return String(r.case_number || d.number || d.violation_number || d["رقم المخالفة"] || "").trim(); } },
          { label: T("colTitle"), get: function (r) { return r.title; } },
          { label: "category", get: function (r) { return r.category; } },
          { label: T("colTracker"), get: function (r) { return r.trackers && r.trackers.name || ""; } },
          { label: T("colStatus"), get: function (r) { return r.status; } },
          { label: T("colDue"), get: function (r) { return r.due_at ? app.fmtDate(r.due_at, { withTime: true }) : ""; } },
          { label: T("colAssignee"), get: function (r) { return r.assignee_id ? assigneeName(r.assignee_id) : ""; } },
          { label: T("colAmount"), get: function (r) { return r.amount; } },
          { label: T("colClient"), get: function (r) { return r.client_name; } },
          { label: T("colCaseNumber"), get: function (r) { return r.case_number; } }
        ].concat(Object.keys(extra).map(function (k) { return { label: k, get: function (r) { return (r.data || {})[k]; } }; }));
        return { items: items, cols: cols };
      }

      function exportName(ext) {
        return (state.viewType || "items") + "-" + new Date().toISOString().slice(0, 10) + "." + ext;
      }

      /* زر تصدير واحد: يُضغط فيسأل عن نوع الملف، بلا زرين متجاورين */
      function exportMenu(btn, run) {
        var wrap = btn.parentNode;
        var open = wrap.querySelector(".export-menu");
        if (open) { open.remove(); return; }
        var box = document.createElement("div");
        box.className = "export-menu";
        box.innerHTML =
          '<button type="button" data-fmt="xlsx">' + esc(T("exportXlsx")) + "</button>" +
          '<button type="button" data-fmt="csv">' + esc(T("exportCsv")) + "</button>";
        wrap.appendChild(box);
        box.addEventListener("click", function (ev) {
          var pick = ev.target.closest("[data-fmt]");
          if (!pick) return;
          box.remove();
          run(pick.getAttribute("data-fmt"));
        });
        setTimeout(function () {
          document.addEventListener("click", function away(e) {
            if (!wrap.contains(e.target)) { box.remove(); document.removeEventListener("click", away); }
          });
        }, 0);
      }

      $("exportBtn").addEventListener("click", function () {
        var btn = this;
        exportMenu(btn, function (fmt) {
          var data = exportColumns();
          if (fmt === "csv") { app.exportCsv(exportName("csv"), data.items, data.cols); return; }
          btn.disabled = true;
          app.exportXlsx(exportName("xlsx"), data.items, data.cols, T(VIEW_TYPES[state.viewType] ? VIEW_TYPES[state.viewType].titleKey : "appName"))
            .catch(function () { toast("genericError", "error"); })
            .then(function () { btn.disabled = false; });
        });
      });
      $("filterTracker").addEventListener("change", function () { state.filters.tracker = this.value; loadItems(); });
      $("filterStatus").addEventListener("change", function () { state.filters.status = this.value; loadItems(); });
      $("filterSearch").addEventListener("input", function () {
        var v = this.value;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { state.filters.search = v.trim(); loadItems(); }, SEARCH_DELAY);
      });
      document.addEventListener("change", function (ev) {
        if (!ev.target) return;
        if (ev.target.id === "clientFilter") { state.clientFilter = ev.target.value || ""; renderList(); return; }
        if (ev.target.id === "expenseCatFilter") { state.expenseCat = ev.target.value || ""; renderList(); return; }
        if (ev.target.id === "expenseYearFilter") { state.expenseYear = ev.target.value || ""; renderList(); }
      });

      $("filterForm").addEventListener("submit", function (ev) {
        ev.preventDefault();
        if (searchTimer) clearTimeout(searchTimer);
        state.filters.search = $("filterSearch").value.trim();
        loadItems();
      });

      /* ---------- list ---------- */

      var pendingOpenItem = (function () {
        try { return new URLSearchParams(window.location.search).get("item") || ""; } catch (e) { return ""; }
      })();

      function loadItems() {
        var f = state.filters;
        var q = { trackerId: f.tracker || undefined, search: f.search || undefined };
        if (f.status === "overdue") { q.status = "open"; q.to = new Date().toISOString(); }
        else if (f.status) q.status = f.status;
        return app.listItems(q).then(function (items) {
          /* الأوراق الرسمية مكانها صفحة المستندات وحدها، فلا تتكرر في هذه القائمة */
          state.items = (items || []).filter(matchesView).filter(function (it) { return !(it.data && it.data.document_kind); });
          if (f.status === "overdue") state.items = state.items.filter(function (it) { return !!it.due_at; });
          clearMsg("listMsg");
          renderList();
          if (pendingOpenItem) {
            var hit = state.items.filter(function (it) { return it.id === pendingOpenItem; })[0];
            pendingOpenItem = "";
            if (hit) openEdit(hit);
          }
        }).catch(function (err) {
          state.items = [];
          renderList();
          fail(err, "listMsg");
        });
      }

      function numOrNull(v) {
        var s = String(v == null ? "" : v).trim();
        if (!s) return null;
        var n = Number(s);
        return isFinite(n) ? n : null;
      }

      function actionBtn(item, action, key, extra) {
        return '<button type="button" class="chat-option-btn' + (extra ? " " + extra : "") + '" data-action="' + action +
          '" data-id="' + esc(item.id) + '">' + esc(T(key)) + "</button>";
      }

      /* ---------- جدول المخالفات ---------- */

      function dataOf(item, keys) {
        var d = item.data || {};
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (d[k] !== undefined && d[k] !== null && String(d[k]).trim() !== "") return String(d[k]).trim();
        }
        return "";
      }

      function violationFields(item) {
        return {
          number: dataOf(item, ["violation_number", "رقم المخالفة"]) || item.case_number || "",
          date: dataOf(item, ["violation_date", "تاريخ المخالفة"]),
          issuer: dataOf(item, ["location", "جهة اصدار المخالفة", "جهة الإصدار"]),
          vtype: dataOf(item, ["نوع المخالفة", "violation_type"]),
          objection: dataOf(item, ["حالة التظلم", "التظلم امام الامانة", "objection"]),
          client: (app.clientDisplayName ? app.clientDisplayName(item) : item.client_name) || dataOf(item, ["الشركة", "client"]),
          caseNumber: item.case_number || dataOf(item, ["رقم الدعوى", "رقم القضية"])
        };
      }

      function money(n) {
        var v = Number(n);
        if (!isFinite(v) || !v) return "-";
        return app.fmtAmount(v) + ' <span class="sar-symbol" aria-label="ريال سعودي"></span>';
      }

      function shortDate(v) {
        if (!v) return "-";
        var d = new Date(v);
        if (!isNaN(d.getTime())) return app.fmtDate(d.toISOString());
        return String(v);
      }

      function renderClientFilter(items) {
        var sel = $("clientFilter");
        if (!sel) return;
        var names = {};
        items.forEach(function (it) {
          var shown = (app.clientDisplayName ? app.clientDisplayName(it) : it.client_name) || "";
          if (shown) names[shown] = true;
        });
        var list = Object.keys(names).sort();
        var current = state.clientFilter || "";
        paintEl(sel).html = '<option value="">' + esc(T("allClients")) + "</option>" +
          list.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + "</option>"; }).join("");
        sel.value = current;
      }

      function renderTotals(items) {
        var box = $("violationTotals");
        if (!box) return;
        var total = items.length;
        var sum = 0, unpaidSum = 0, overdue = 0;
        var now = Date.now();
        items.forEach(function (it) {
          var amt = Number(it.amount) || 0;
          sum += amt;
          if (it.status !== "done") unpaidSum += amt;
          if (it.status === "open" && it.due_at && new Date(it.due_at).getTime() < now) overdue++;
        });
        paintEl(box).html =
          '<div class="total-card"><span class="total-label">' + esc(T("totalCount")) + '</span><span class="total-value">' + esc(String(total)) + "</span></div>" +
          '<div class="total-card"><span class="total-label">' + esc(T("totalAmount")) + '</span><span class="total-value">' + money(sum) + "</span></div>" +
          '<div class="total-card"><span class="total-label">' + esc(T("totalUnpaid")) + '</span><span class="total-value">' + money(unpaidSum) + "</span></div>" +
          '<div class="total-card"><span class="total-label">' + esc(T("totalOverdue")) + '</span><span class="total-value">' + esc(String(overdue)) + "</span></div>";
      }

      /* ---------- مصاريف التشغيل: شاشتها لا تشبه القضايا ---------- */
      var EXP_MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

      function expenseFields(item) {
        var d = item.due_at || dataOf(item, ["تاريخ الصرف", "التاريخ", "date"]);
        return {
          date: d,
          year: d ? String(new Date(d).getFullYear()) : "",
          month: d ? new Date(d).getMonth() : null,
          cat: item.category || dataOf(item, ["البند", "بند المصروف", "category"]) || T("expNoCat"),
          desc: item.title || "",
          vendor: item.client_name || dataOf(item, ["الجهة", "المورد", "vendor", "supplier"]),
          method: dataOf(item, ["طريقة الدفع", "payment_method", "وسيلة الدفع"]),
          invoice: dataOf(item, ["رقم الفاتورة", "invoice_number"])
        };
      }

      function expenseRows() {
        return (state.items || []).map(function (it) { return { item: it, f: expenseFields(it), amount: Number(it.amount) || 0 }; });
      }

      function expenseFiltered(rows) {
        return rows.filter(function (r) {
          if (state.expenseCat && r.f.cat !== state.expenseCat) return false;
          if (state.expenseYear && r.f.year !== state.expenseYear) return false;
          return true;
        });
      }

      function renderExpenseFilters(rows) {
        var cats = {}, years = {};
        rows.forEach(function (r) { if (r.f.cat) cats[r.f.cat] = true; if (r.f.year) years[r.f.year] = true; });
        var catSel = $("expenseCatFilter"), yearSel = $("expenseYearFilter");
        if (catSel) {
          catSel.innerHTML = '<option value="">' + esc(T("allCats")) + "</option>" +
            Object.keys(cats).sort().map(function (c) {
              return '<option value="' + esc(c) + '"' + (c === state.expenseCat ? " selected" : "") + ">" + esc(c) + "</option>";
            }).join("");
        }
        if (yearSel) {
          yearSel.innerHTML = '<option value="">' + esc(T("allYears")) + "</option>" +
            Object.keys(years).sort().reverse().map(function (y) {
              return '<option value="' + esc(y) + '"' + (y === state.expenseYear ? " selected" : "") + ">" + esc(y) + "</option>";
            }).join("");
        }
      }

      function expenseSums(rows) {
        var now = Date.now(), sum = 0, paid = 0, due = 0, overdue = 0;
        rows.forEach(function (r) {
          sum += r.amount;
          if (r.item.status === "done") paid += r.amount;
          else if (r.item.status !== "cancelled") {
            due += r.amount;
            if (r.f.date && new Date(r.f.date).getTime() < now) overdue += r.amount;
          }
        });
        return { count: rows.length, sum: sum, paid: paid, due: due, overdue: overdue };
      }

      function renderExpenseTotals(rows) {
        var box = $("expenseTotals");
        if (!box) return;
        var t = expenseSums(rows);
        paintEl(box).html =
          '<div class="total-card"><span class="total-label">' + esc(T("expCount")) + '</span><span class="total-value">' + esc(String(t.count)) + "</span></div>" +
          '<div class="total-card"><span class="total-label">' + esc(T("expTotal")) + '</span><span class="total-value">' + money(t.sum) + "</span></div>" +
          '<div class="total-card"><span class="total-label">' + esc(T("expPaid")) + '</span><span class="total-value">' + money(t.paid) + "</span></div>" +
          '<div class="total-card"><span class="total-label">' + esc(T("expDue")) + '</span><span class="total-value">' + money(t.due) + "</span></div>";
      }

      /* أعمدة الأشهر بالمبالغ لا بالعدد: المصروف يقرأ بالريال */
      function monthBarsHtml(values) {
        var max = Math.max.apply(null, values.concat([1]));
        var bars = '<div class="chart-bars">';
        values.forEach(function (v, i) {
          var h = Math.max(4, Math.round((v / max) * 150));
          bars += '<div class="chart-col"><span class="chart-val">' + (v ? shortMoney(v) : "") + "</span>" +
                  '<span class="chart-bar" style="height:' + h + 'px"></span>' +
                  '<span class="chart-label">' + EXP_MONTHS[i] + "</span></div>";
        });
        return bars + "</div>";
      }

      function categoryBreakdown(rows) {
        var sums = {};
        rows.forEach(function (r) { if (r.amount) sums[r.f.cat] = (sums[r.f.cat] || 0) + r.amount; });
        return Object.keys(sums).map(function (k) { return { label: k, value: Math.round(sums[k]) }; })
          .sort(function (a, b) { return b.value - a.value; }).slice(0, 6);
      }

      function renderExpensesChart() {
        var card = document.getElementById("expensesChart");
        if (!card) return;
        var rows = expenseFiltered(expenseRows());
        var year = state.expenseYear || String(new Date().getFullYear());
        var months = EXP_MONTHS.map(function () { return 0; });
        rows.forEach(function (r) {
          if (r.f.month === null || r.f.year !== year) return;
          months[r.f.month] += r.amount;
        });
        var byCat = categoryBreakdown(rows);
        var donut = donutHtml(byCat, "noExpenseData");
        var t = expenseSums(rows);
        var monthsWith = months.filter(function (v) { return v > 0; }).length;

        paintEl(card).html =
          "<h2>" + esc(T("expIndicatorsTitle")) + "</h2>" +
          '<div class="ind-grid">' +
            '<div class="ind-card"><h3>' + esc(T("expMonthlyTitle").replace("{y}", year)) + "</h3>" + monthBarsHtml(months) + "</div>" +
            '<div class="ind-card"><h3>' + esc(T("expByCatTitle").replace("{n}", String(byCat.length))) + "</h3>" + donut.html + "</div>" +
          "</div>" +
          '<div class="ind-totals">' +
            '<div class="ind-total"><b>' + shortMoney(t.sum) + "</b><span>" + esc(T("expTotal")) + "</span></div>" +
            '<div class="ind-total"><b>' + shortMoney(t.due) + "</b><span>" + esc(T("expDue")) + "</span></div>" +
            '<div class="ind-total"><b>' + shortMoney(t.overdue) + "</b><span>" + esc(T("expOverdue")) + "</span></div>" +
            '<div class="ind-total"><b>' + shortMoney(monthsWith ? t.sum / monthsWith : 0) + "</b><span>" + esc(T("expAvgMonth")) + "</span></div>" +
          "</div>";
      }

      function renderExpenses() {
        var all = expenseRows();
        renderExpenseFilters(all);
        var rows = expenseFiltered(all).sort(function (a, b) {
          return new Date(b.f.date || 0).getTime() - new Date(a.f.date || 0).getTime();
        });
        renderExpenseTotals(rows);
        var body = $("expensesBody");
        if (!body) return;
        body.innerHTML = "";
        $("expensesWrap").hidden = rows.length === 0;
        $("emptyList").hidden = rows.length > 0;
        rows.forEach(function (r) {
          var item = r.item, f = r.f, sk = statusKeyOf(item);
          var tr = document.createElement("tr");
          tr.innerHTML =
            '<td class="cell-num">' + esc(shortDate(f.date)) + "</td>" +
            "<td>" + esc(f.cat || "-") + "</td>" +
            '<td><span class="item-title">' + esc(f.desc || "-") + "</span>" +
              (f.invoice ? '<span class="item-cat">' + esc(f.invoice) + "</span>" : "") + "</td>" +
            "<td>" + esc(f.vendor || "-") + "</td>" +
            '<td class="cell-num">' + money(item.amount) + "</td>" +
            "<td>" + esc(f.method || "-") + "</td>" +
            '<td><span class="status-' + sk + '">' + esc(T(sk === "done" ? "expStatusPaid" : STATUS_KEYS[sk])) + "</span></td>" +
            '<td><div class="chat-options row-actions">' +
              (item.status === "done" ? actionBtn(item, "reopen", "actionReopen") : actionBtn(item, "done", "expActionPay")) +
              actionBtn(item, "edit", "actionEdit") +
              actionBtn(item, "delete", "actionDelete", "is-danger") +
            "</div></td>";
          body.appendChild(tr);
        });
      }

      function renderViolations() {
        var items = state.items.filter(function (it) {
          if (!state.clientFilter) return true;
          var shown = (app.clientDisplayName ? app.clientDisplayName(it) : it.client_name) || "";
          return shown === state.clientFilter || it.client_name === state.clientFilter || it.client_name_en === state.clientFilter;
        });
        renderClientFilter(state.items);
        renderTotals(items);
        var body = $("violationsBody");
        body.innerHTML = "";
        $("violationsWrap").hidden = items.length === 0;
        $("emptyList").hidden = items.length > 0;
        items.forEach(function (item) {
          var f = violationFields(item);
          var sk = statusKeyOf(item);
          var tr = document.createElement("tr");
          tr.innerHTML =
            '<td class="cell-num">' + esc(f.number || "-") + "</td>" +
            '<td class="cell-num">' + esc(shortDate(f.date)) + "</td>" +
            '<td data-tr>' + esc(f.client || "-") + "</td>" +
            "<td>" + esc(f.issuer || "-") + "</td>" +
            '<td class="cell-num">' + money(item.amount) + "</td>" +
            "<td>" + esc(f.vtype || "-") + "</td>" +
            "<td>" + esc(f.objection || "-") + "</td>" +
            '<td class="cell-num">' + (f.caseNumber
              ? '<a href="#" class="case-link" data-case="' + esc(f.caseNumber) + '">' + esc(f.caseNumber) + "</a>"
              : "-") + "</td>" +
            '<td class="cell-num">' + (item.due_at ? esc(app.fmtDate(item.due_at)) : "-") + "</td>" +
            '<td><span class="status-' + sk + '">' + esc(T(STATUS_KEYS[sk])) + "</span></td>" +
            '<td><div class="chat-options row-actions">' +
              (item.status === "done" ? actionBtn(item, "reopen", "actionReopen") : actionBtn(item, "done", "actionDone")) +
              actionBtn(item, "edit", "actionEdit") +
              actionBtn(item, "delete", "actionDelete", "is-danger") +
            "</div></td>";
          body.appendChild(tr);
        });
      }

      /* رقم الدعوى يجمع المخالفة وقضيتها وملفاتهما */
      /* أنواع أبناء القضية بترتيب قراءتها في الملف */
      var CASE_SECTIONS = [
        { kind: "session",   key: "secSessions" },
        { kind: "ruling",    key: "secRulings" },
        { kind: "execution", key: "secExecutions" },
        { kind: "violation", key: "secViolations" },
        { kind: "task",      key: "secTasks" },
        { kind: "document",  key: "secDocuments" }
      ];

      function caseRowsHtml(rows) {
        var html = '<div class="table-wrap"><table class="items-table"><thead><tr>' +
          "<th>" + esc(T("colTitle")) + "</th><th>" + esc(T("colDue")) + "</th>" +
          "<th>" + esc(T("colAmount")) + "</th><th>" + esc(T("colStatus")) + "</th>" +
          "<th>" + esc(T("attachTitle")) + "</th><th></th></tr></thead><tbody>";
        rows.forEach(function (r) {
          html += "<tr><td>" + esc(r.title || "-") + "</td>" +
                  '<td class="cell-num">' + (r.due_at ? esc(app.fmtDate(r.due_at)) : "-") + "</td>" +
                  '<td class="cell-num">' + money(r.amount) + "</td>" +
                  "<td>" + esc(r.status === "done" ? T("statusDone") : T("statusOpen")) + "</td>" +
                  '<td class="cell-num">' + esc(String(r.attachments || 0)) + "</td>" +
                  '<td><button type="button" class="chat-option-btn" data-bundle-open="' + esc(r.id) + '">' + esc(T("actionEdit")) + "</button></td></tr>";
        });
        return html + "</tbody></table></div>";
      }

      /* ملف القضية الكامل: يفتح من رقم القضية أو من صفها */
      function openCaseFile(itemId) {
        var box = $("caseBundle");
        if (!box || !app.client) return;
        app.client.rpc("case_file", { p_org: app.org.id, p_case: itemId }).then(function (res) {
          var data = res && res.data;
          if (!data || data.error || !data.head) { paintEl(box).html = '<p class="empty-note">' + esc(T("caseBundleEmpty")) + "</p>"; return; }
          var head = data.head, kids = data.children || [];
          var d = head.data || {};
          var facts = [
            [T("colCaseNumber"), head.case_number],
            [T("fieldClient"), head.client_name],
            [T("fieldCourt"), d.court],
            [T("fieldStage"), head.stage],
            [T("colAmount"), head.amount != null ? money(head.amount) : null]
          ].filter(function (f) { return f[1]; });
          var html = "<h3>" + esc(head.title || T("caseFileTitle")) + "</h3>" +
            '<div class="totals-row">' + facts.map(function (f) {
              return '<div class="total-card"><span class="total-label">' + esc(f[0]) + '</span><span class="total-value">' + f[1] + "</span></div>";
            }).join("") + "</div>";
          CASE_SECTIONS.forEach(function (sec) {
            var rows = kids.filter(function (k) { return k.kind === sec.kind; });
            if (!rows.length) return;
            html += "<h4>" + esc(T(sec.key)) + " (" + rows.length + ")</h4>" + caseRowsHtml(rows);
          });
          if (!kids.length) html += '<p class="empty-note">' + esc(T("caseFileEmpty")) + "</p>";
          paintEl(box).html = html;
          try { box.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) { /* تجاهل */ }
        }).catch(function () {
          paintEl(box).html = '<p class="empty-note">' + esc(T("caseBundleEmpty")) + "</p>";
        });
      }

      function openCaseBundle(caseNumber) {
        var box = $("caseBundle");
        if (!box) return;
        app.caseBundle(caseNumber).then(function (rows) {
          var list = rows || [];
          if (!list.length) {
            paintEl(box).html = "<h3>" + esc(T("caseBundleTitle").replace("{n}", caseNumber)) + '</h3><p class="empty-note">' + esc(T("caseBundleEmpty")) + "</p>";
            return;
          }
          var html = "<h3>" + esc(T("caseBundleTitle").replace("{n}", caseNumber)) + "</h3>" +
            '<div class="table-wrap">' +
            "<table><thead><tr>" +
            "<th>" + esc(T("colTitle")) + "</th><th>" + esc(T("fieldCategory")) + "</th>" +
            "<th>" + esc(T("colDue")) + "</th><th>" + esc(T("colAmount")) + "</th>" +
            "<th>" + esc(T("attachTitle")) + "</th><th></th></tr></thead><tbody>";
          list.forEach(function (r) {
            html += "<tr><td>" + esc(r.title || "-") + "</td>" +
                    "<td>" + esc(r.category || "-") + "</td>" +
                    '<td class="cell-num">' + (r.due_at ? esc(app.fmtDate(r.due_at)) : "-") + "</td>" +
                    '<td class="cell-num">' + money(r.amount) + "</td>" +
                    '<td class="cell-num">' + esc(String(r.attachments || 0)) + "</td>" +
                    '<td><button type="button" class="chat-option-btn" data-bundle-open="' + esc(r.item_id) + '">' + esc(T("actionEdit")) + "</button></td></tr>";
          });
          html += "</tbody></table></div>";
          paintEl(box).html = html;
        }).catch(function () {
          paintEl(box).html = "<h3>" + esc(T("caseBundleTitle").replace("{n}", caseNumber)) + '</h3><p class="empty-note">' + esc(T("caseBundleEmpty")) + "</p>";
        });
      }

      document.addEventListener("click", function (ev) {
        var link = ev.target.closest(".case-link");
        if (link) {
          ev.preventDefault();
          openCaseBundle(link.dataset.case);
          return;
        }
        var fileBtn = ev.target.closest("[data-case-file]");
        if (fileBtn) { ev.preventDefault(); openCaseFile(fileBtn.dataset.caseFile); return; }
        var openBtn = ev.target.closest("[data-bundle-open]");
        if (openBtn) {
          var id = openBtn.dataset.bundleOpen;
          var item = (state.items || []).filter(function (it) { return it.id === id; })[0];
          if (item) openEdit(item);
        }
      });

      function translateView() {
        if (!app.translateNodes) return;
        var root = document.getElementById("dashboard");
        if (root) app.translateNodes(root);
      }

      function renderList() {
        renderChart();
        renderCasesChart();
        renderExpensesChart();
        if (state.viewType === "violations") {
          $("violationsBar").hidden = false;
          $("tableWrap").hidden = true;
          $("expensesBar").hidden = true;
          $("expensesWrap").hidden = true;
          renderViolations();
          return;
        }
        if (state.viewType === "expenses") {
          $("expensesBar").hidden = false;
          $("tableWrap").hidden = true;
          $("violationsBar").hidden = true;
          $("violationsWrap").hidden = true;
          renderExpenses();
          return;
        }
        $("expensesBar").hidden = true;
        $("expensesWrap").hidden = true;
        $("violationsBar").hidden = true;
        $("violationsWrap").hidden = true;
        var body = $("itemsBody");
        body.innerHTML = "";
        var items = state.items;
        $("emptyList").hidden = items.length > 0;
        $("tableWrap").hidden = items.length === 0;
        items.forEach(function (item) {
          var sk = statusKeyOf(item);
          var tr = document.createElement("tr");
          tr.innerHTML =
            '<td><span class="item-title" data-tr>' + esc(item.title) + "</span>" +
              (item.category ? '<span class="item-cat">' + esc(item.category) + "</span>" : "") + "</td>" +
            "<td>" + esc(trackerName(item)) + "</td>" +
            '<td class="col-due">' + (item.due_at ? esc(app.fmtDate(item.due_at, { withTime: true })) : esc(T("noDue"))) + "</td>" +
            "<td>" + esc(assigneeName(item.assignee_id)) + "</td>" +
            '<td><span class="status-' + sk + '">' + esc(T(STATUS_KEYS[sk])) + "</span></td>" +
            '<td><div class="chat-options row-actions">' +
              (state.viewType === "cases"
                ? '<button type="button" class="chat-option-btn is-icon" data-case-file="' + esc(item.id) + '" title="' + esc(T("openCaseFile")) + '" aria-label="' + esc(T("openCaseFile")) + '">' +
                  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/></svg></button>'
                : "") +
              (item.status === "done" ? actionBtn(item, "reopen", "actionReopen") : actionBtn(item, "done", "actionDone")) +
              actionBtn(item, "edit", "actionEdit") +
              actionBtn(item, "delete", "actionDelete", "is-danger") +
            "</div></td>";
          body.appendChild(tr);
        });
        translateView();
      }

      /* جدولا القائمة والمخالفات يتشاركان الأزرار نفسها، فالمستمع على المستند */
      document.addEventListener("click", function (ev) {
        var b = ev.target.closest("button[data-action]");
        if (!b || !b.closest("#itemsBody, #violationsBody")) return;
        var item = findItem(b.dataset.id);
        if (!item) return;
        var action = b.dataset.action;
        if (action === "done") setItemStatus(item, "done", "itemDone");
        else if (action === "reopen") setItemStatus(item, "open", "itemReopened");
        else if (action === "edit") openEdit(item);
        else if (action === "delete") deleteItem(item);
      });

      function setItemStatus(item, status, key) {
        guard(function () {
          return app.updateItem(item.id, { status: status }).then(function () {
            toast(key);
            return refresh();
          });
        }).catch(function (err) { fail(err, "listMsg"); });
      }

      function deleteItem(item) {
        if (!window.confirm(T("confirmDelete"))) return;
        guard(function () {
          return app.deleteItem(item.id).then(function () {
            if (state.editing && state.editing.id === item.id) closeEdit();
            toast("deleted");
            return refresh();
          });
        }).catch(function (err) { fail(err, "listMsg"); });
      }

      /* ---------- add item / new tracker ---------- */

      $("addItemBtn").addEventListener("click", function () {
        if (state.viewType && VIEW_TYPES[state.viewType]) {
          var catField = $("addCategory");
          if (catField && !catField.value) catField.value = VIEW_TYPES[state.viewType].defaultCategory;
        }
        var p = $("addItemPanel");
        p.hidden = !p.hidden;
        clearMsg("addMsg");
        if (!p.hidden) { closeEdit(); $("addTitle").focus(); }
      });
      $("addCancelBtn").addEventListener("click", function () { hide("addItemPanel"); clearMsg("addMsg"); });

      $("addItemForm").addEventListener("submit", function (ev) {
        ev.preventDefault();
        var title = $("addTitle").value.trim();
        if (!title) { setMsg("addMsg", T("titleRequired"), "error"); $("addTitle").focus(); return; }
        var trackerId = $("addTracker").value;
        if (!trackerId) { setMsg("addMsg", T("trackerRequired"), "error"); $("addTracker").focus(); return; }
        clearMsg("addMsg");
        var row = {
          tracker_id: trackerId,
          title: title,
          due_at: fromLocalInput($("addDue").value),
          category: $("addCategory").value.trim() || null,
          assignee_id: $("addAssignee").value || null,
          amount: numOrNull($("addAmount").value),
          client_name: $("addClient").value.trim() || null,
          client_name_en: $("addClientEn").value.trim() || null,
          case_number: $("addCaseNumber").value.trim() || null,
          status: "open"
        };
        guard(function () {
          $("addSaveBtn").disabled = true;
          return app.insertItems([row]).then(function () {
            toast("itemAdded");
            $("addTitle").value = "";
            $("addDue").value = "";
            $("addCategory").value = "";
            $("addAmount").value = "";
            $("addClient").value = "";
            $("addClientEn").value = "";
            $("addCaseNumber").value = "";
            return refresh();
          });
        }).then(function () { $("addSaveBtn").disabled = false; }, function (err) {
          $("addSaveBtn").disabled = false;
          fail(err, "addMsg");
        });
      });

      $("newTrackerBtn").addEventListener("click", function () {
        var f = $("newTrackerForm");
        f.hidden = !f.hidden;
        clearMsg("newTrackerMsg");
        if (!f.hidden) $("newTrackerName").focus();
      });
      $("newTrackerCancel").addEventListener("click", function () { hide("newTrackerForm"); clearMsg("newTrackerMsg"); });
      $("newTrackerForm").addEventListener("submit", function (ev) {
        ev.preventDefault();
        var name = $("newTrackerName").value.trim();
        if (!name) { setMsg("newTrackerMsg", T("trackerNameRequired"), "error"); return; }
        clearMsg("newTrackerMsg");
        guard(function () {
          return app.createTracker({ name: name }).then(function (t) {
            state.trackers.push(t);
            renderSelects();
            $("addTracker").value = t.id;
            $("newTrackerName").value = "";
            hide("newTrackerForm");
            toast("trackerCreated");
          });
        }).catch(function (err) { fail(err, "newTrackerMsg"); });
      });

      /* ---------- التذكير قبل الموعد ---------- */
      /* القيم كما تكتبها القاعدة في items.remind_before، وnull يعني القاعدة العامة للسجل */
      var REMIND_CHOICES = ["", "1 day", "3 days", "7 days", "14 days", "30 days"];
      var REMIND_KEYS = { "": "remindDefault", "1 day": "remindDay", "3 days": "remind3Days",
                          "7 days": "remindWeek", "14 days": "remind2Weeks", "30 days": "remindMonth" };

      /* القاعدة تعيد المدة نصا مثل "7 days" أو "1 day" أو "7 days 00:00:00" */
      function remindValue(raw) {
        var v = String(raw == null ? "" : raw).trim();
        if (!v) return "";
        var m = v.match(/(\d+)\s*(day|days|mon|mons|month|months|week|weeks)/i);
        if (!m) return "";
        var n = Number(m[1]);
        var unit = m[2].toLowerCase();
        if (unit.indexOf("week") === 0) n *= 7;
        if (unit.indexOf("mon") === 0) n *= 30;
        var text = n === 1 ? "1 day" : n + " days";
        return REMIND_CHOICES.indexOf(text) === -1 ? "" : text;
      }

      function fillRemindOptions(sel, current) {
        if (!sel) return;
        sel.innerHTML = REMIND_CHOICES.map(function (v) {
          return '<option value="' + v + '">' + esc(T(REMIND_KEYS[v])) + "</option>";
        }).join("");
        sel.value = remindValue(current);
      }

      /* ---------- inline edit ---------- */

      function openEdit(item) {
        state.editing = item;
        hide("addItemPanel");
        $("editTitle").value = item.title || "";
        $("editTracker").value = item.tracker_id || "";
        $("editDue").value = toLocalInput(item.due_at);
        $("editCategory").value = item.category || "";
        $("editAssignee").value = item.assignee_id || "";
        $("editStatus").value = STATUS_KEYS[item.status] && item.status !== "overdue" ? item.status : "open";
        $("editAmount").value = item.amount != null ? item.amount : "";
        $("editClient").value = item.client_name || "";
        $("editClientEn").value = item.client_name_en || "";
        $("editCaseNumber").value = item.case_number || "";
        fillRemindOptions($("editRemind"), item.remind_before);
        clearMsg("editMsg");
        show("editPanel");
        loadAttachments();
        try { $("editPanel").scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) { /* ignore */ }
        $("editTitle").focus();
      }

      /* ---------- المرفقات ---------- */

      function humanSize(bytes) {
        var n = Number(bytes) || 0;
        if (n < 1024) return n + " B";
        if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
        return (n / 1048576).toFixed(1) + " MB";
      }

      function renderAttachments(rows) {
        var box = $("attachList");
        if (!box) return;
        if (!rows || !rows.length) { paintEl(box).html = '<p class="empty-note">' + esc(T("attachEmpty")) + "</p>"; return; }
        var html = "";
        rows.forEach(function (a) {
          html += '<div class="attach-row"><a href="#" data-attach-open="' + esc(a.id) + '">' + esc(a.name) + "</a>" +
                  "<span>" + esc(a.external_url ? T("attachLinkLabel") : humanSize(a.size_bytes)) + "</span>" +
                  '<button type="button" class="chat-option-btn" data-attach-del="' + esc(a.id) + '">' + esc(T("delete")) + "</button></div>";
        });
        paintEl(box).html = html;
      }

      function loadAttachments() {
        if (!state.editing) return Promise.resolve();
        return app.listAttachments(state.editing.id).then(function (rows) {
          state.attachments = rows || [];
          renderAttachments(state.attachments);
        }).catch(function () { renderAttachments([]); });
      }

      function attachById(id) {
        return (state.attachments || []).filter(function (a) { return a.id === id; })[0] || null;
      }

      function wireAttachments() {
        var fileInput = $("attachFile");
        if (fileInput) fileInput.addEventListener("change", function () {
          var file = this.files && this.files[0];
          if (!file || !state.editing) return;
          setMsg("attachMsg", T("attachUploading"));
          app.uploadAttachment(state.editing.id, file).then(function () {
            setMsg("attachMsg", T("attachDone"), "success");
            return loadAttachments();
          }).catch(function (err) {
            var code = String((err && (err.message || err.code)) || "");
            setMsg("attachMsg", code.indexOf("PLAN_LIMIT_STORAGE") !== -1 ? T("attachLimit") : T("attachFailed"), "error");
          }).finally(function () { fileInput.value = ""; });
        });

        var driveBtn = $("attachDriveBtn");
        function syncDriveBtn() { if (driveBtn) driveBtn.hidden = !(app.driveAvailable && app.driveAvailable()); }
        syncDriveBtn();
        document.addEventListener("tracker:drive", syncDriveBtn);
        if (driveBtn) driveBtn.addEventListener("click", function () {
          if (!state.editing) return;
          setMsg("attachMsg", T("attachUploading"));
          app.pickFromDrive().then(function (docs) {
            return app.attachDriveFiles(state.editing.id, docs);
          }).then(function (n) {
            setMsg("attachMsg", n ? T("attachDone") : "", n ? "success" : "");
            return loadAttachments();
          }).catch(function (err) {
            if (String(err && err.message) === "cancelled") { clearMsg("attachMsg"); return; }
            setMsg("attachMsg", T("attachFailed"), "error");
          });
        });

        var linkBtn = $("attachLinkBtn");
        if (linkBtn) linkBtn.addEventListener("click", function () {
          var url = String($("attachLink").value || "").trim();
          if (!url || !state.editing) return;
          setMsg("attachMsg", T("attachUploading"));
          app.addAttachmentLink(state.editing.id, url.split("/").pop() || url, url).then(function () {
            $("attachLink").value = "";
            setMsg("attachMsg", T("attachDone"), "success");
            return loadAttachments();
          }).catch(function () { setMsg("attachMsg", T("attachFailed"), "error"); });
        });

        var list = $("attachList");
        if (list) list.addEventListener("click", function (ev) {
          var openBtn = ev.target.closest("[data-attach-open]");
          var delBtn = ev.target.closest("[data-attach-del]");
          if (openBtn) {
            ev.preventDefault();
            var att = attachById(openBtn.dataset.attachOpen);
            if (!att) return;
            var w = window.open("about:blank", "_blank");
            app.attachmentUrl(att).then(function (url) {
              if (!url) { if (w) w.close(); return; }
              if (w) w.location = url; else window.location.assign(url);
            }).catch(function () { if (w) w.close(); setMsg("attachMsg", T("attachFailed"), "error"); });
          } else if (delBtn) {
            var target = attachById(delBtn.dataset.attachDel);
            if (!target) return;
            if (!window.confirm(T("attachDeleteConfirm"))) return;
            app.deleteAttachment(target).then(loadAttachments)
              .catch(function () { setMsg("attachMsg", T("attachFailed"), "error"); });
          }
        });
      }

      function closeEdit() {
        state.editing = null;
        hide("editPanel");
        clearMsg("editMsg");
      }

