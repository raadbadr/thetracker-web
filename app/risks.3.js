    (function () {
      "use strict";
      var app = null;
      var CATS = ["legal","procedural","financial","compliance","reputation","operational"];
      var STRATS = ["mitigate","accept","transfer","avoid"];
      var STATUSES = ["open","in_progress","monitoring","closed"];
      var state = { list: [], members: [], names: {}, processes: [], draft: null, mode: "inherent", cell: null, search: "", status: "", tracker: null };
      function $(id) { return document.getElementById(id); }
      function t(k) { if (app && app.t) return app.t(k); var d = translations[lang()] || translations.ar; return d[k] || translations.ar[k] || k; }
      function esc(v) { return app && app.escapeHtml ? app.escapeHtml(v) : String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]; }); }
      function show(id, on) { var el = $(id); if (el) el.hidden = !on; }
      function name(uid) { return uid ? (state.names[uid] || "-") : "-"; }
      function band(score) { return score >= 16 ? "critical" : score >= 10 ? "high" : score >= 5 ? "moderate" : "low"; }
      function badge(l, i) {
        l = Number(l) || 0; i = Number(i) || 0;
        if (!l || !i) return '<span class="rating low" style="opacity:.5">' + esc(t("notScored")) + "</span>";
        var s = l * i, b = band(s);
        return '<span class="rating ' + b + '" title="' + l + " × " + i + '">' + esc(t("band_" + b)) + " " + s + "</span>";
      }
      function scaleOptions(sel, key) {
        var html = '<option value="">' + esc(t("choose")) + "</option>";
        for (var v = 1; v <= 5; v++) html += '<option value="' + v + '"' + (Number(sel) === v ? " selected" : "") + ">" + v + " — " + esc(t(key + v)) + "</option>";
        return html;
      }
      function memberOptions(sel) {
        var html = '<option value="">' + esc(t("none")) + "</option>";
        state.members.forEach(function (m) { html += '<option value="' + esc(m.user_id) + '"' + (sel === m.user_id ? " selected" : "") + ">" + esc(state.names[m.user_id] || "") + "</option>"; });
        return html;
      }

      /* ---------- الخريطة الحرارية والمؤشرات ---------- */
      function renderHeat() {
        var counts = {};
        state.list.forEach(function (r) {
          var L = state.mode === "residual" ? (r.res_likelihood || r.likelihood) : r.likelihood;
          var I = state.mode === "residual" ? (r.res_impact || r.impact) : r.impact;
          if (L && I) counts[L + "-" + I] = (counts[L + "-" + I] || 0) + 1;
        });
        var cells = "";
        for (var l = 5; l >= 1; l--) for (var i = 1; i <= 5; i++) {
          var key = l + "-" + i, n = counts[key] || 0, b = band(l * i);
          cells += '<div class="heat-cell c-' + b + (n ? "" : " zero") + (state.cell === key ? " sel" : "") + '" data-cell="' + key + '" title="' + esc(t("likelihood")) + " " + l + " × " + esc(t("impact")) + " " + i + " = " + (l * i) + '"><span>' + (n || "·") + "</span></div>";
        }
        var xl = ""; for (var k = 1; k <= 5; k++) xl += "<span>" + k + "</span>";
        $("heat").innerHTML = '<div class="heat-wrap"><div class="heat-ylab">' + esc(t("likelihood")) + ' ↑</div><div><div class="heat">' + cells + '</div><div class="heat-xlab">' + xl + '</div><div class="heat-axis">' + esc(t("impact")) + " →</div></div></div>";
        show("clearCell", !!state.cell);
        $("modeInherent").classList.toggle("is-active", state.mode === "inherent");
        $("modeResidual").classList.toggle("is-active", state.mode === "residual");
      }
      function renderKpis() {
        var open = 0, critical = 0, overdue = 0, actions = 0;
        var today = new Date().toISOString().slice(0, 10);
        state.list.forEach(function (r) {
          if (r.status !== "closed") open++;
          if (r.likelihood && r.impact && band(r.likelihood * r.impact) === "critical" && r.status !== "closed") critical++;
          if (r.review_at && r.review_at < today && r.status !== "closed") overdue++;
          (r.actions || []).forEach(function (a) { if (!a.done) actions++; });
        });
        $("kpis").innerHTML =
          '<div class="kpi"><b>' + state.list.length + "</b><span>" + esc(t("kpiTotal")) + "</span></div>" +
          '<div class="kpi"><b>' + open + "</b><span>" + esc(t("kpiOpen")) + "</span></div>" +
          '<div class="kpi"><b style="color:#e5484d">' + critical + "</b><span>" + esc(t("kpiCritical")) + "</span></div>" +
          '<div class="kpi"><b style="color:#f2a33c">' + overdue + "</b><span>" + esc(t("kpiReviewOverdue")) + "</span></div>" +
          '<div class="kpi"><b>' + actions + "</b><span>" + esc(t("kpiActions")) + "</span></div>";
      }
      function renderList() {
        var rows = state.list.filter(function (r) {
          if (state.status && r.status !== state.status) return false;
          if (state.cell) {
            var L = state.mode === "residual" ? (r.res_likelihood || r.likelihood) : r.likelihood;
            var I = state.mode === "residual" ? (r.res_impact || r.impact) : r.impact;
            if (L + "-" + I !== state.cell) return false;
          }
          if (state.search) {
            var hay = [r.title, r.code, r.client_name, r.case_number, r.category].join(" ").toLowerCase();
            if (hay.indexOf(state.search.toLowerCase()) === -1) return false;
          }
          return true;
        });
        var body = $("listBody"); body.innerHTML = "";
        show("listWrap", rows.length > 0); show("listEmpty", rows.length === 0);
        rows.forEach(function (r) {
          var tr = document.createElement("tr");
          var meta = [r.code, r.case_number ? t("colCase") + " " + r.case_number : "", r.owner_id ? name(r.owner_id) : "", r.review_at ? t("colReview") + " " + app.fmtDate(r.review_at) : ""].filter(Boolean).join(" · ");
          tr.innerHTML = '<td><span class="item-title" data-tr>' + esc(r.title) + '</span><span class="item-cat">' + esc(meta) + "</span>" +
            (r.review_at ? '<span class="item-cat due-left" data-due="' + esc(r.review_at) + '"></span>' : "") + "</td>" +
            "<td>" + esc(t("cat_" + (r.category || "legal"))) + "</td>" +
            "<td>" + esc(r.client_name || "-") + "</td>" +
            "<td>" + badge(r.likelihood, r.impact) + "</td>" +
            "<td>" + badge(r.res_likelihood, r.res_impact) + "</td>" +
            "<td>" + esc(t("rstatus_" + r.status)) + " · " + esc(t("strat_" + r.strategy)) + "</td>" +
            '<td><div class="chat-options row-actions">' +
              '<button type="button" class="icon-btn" data-edit="' + esc(r.id) + '" title="' + esc(t("edit")) + '" aria-label="' + esc(t("edit")) + '">' +
                '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>' +
                "<span>" + esc(t("edit")) + "</span></button></div></td>";
          body.appendChild(tr);
        });
        /* النص الحر يُعرض بلغة القارئ متى توفرت الترجمة المشتركة */
        if (app && app.translateNodes) app.translateNodes(body);
      }
      function renderAll() { renderKpis(); renderHeat(); renderList(); }

      /* ---------- المحرر ---------- */
      function openEditor(r) {
        state.draft = r ? JSON.parse(JSON.stringify(r)) : { title: "", category: "legal", strategy: "mitigate", status: "open", identified_at: new Date().toISOString().slice(0, 10), actions: [] };
        if (!Array.isArray(state.draft.actions)) state.draft.actions = [];
        var d = state.draft;
        $("editorTitle").textContent = r ? t("editorEdit") + " — " + (r.code || "") : t("editorNew");
        $("fTitle").value = d.title || "";
        $("fCategory").innerHTML = CATS.map(function (c) { return '<option value="' + c + '"' + (d.category === c ? " selected" : "") + ">" + esc(t("cat_" + c)) + "</option>"; }).join("");
        $("fClient").value = d.client_name || ""; $("fCase").value = d.case_number || "";
        $("fProcess").innerHTML = '<option value="">' + esc(t("none")) + "</option>" + state.processes.map(function (p) { return '<option value="' + esc(p.id) + '"' + (d.process_id === p.id ? " selected" : "") + ">" + esc((p.code ? p.code + " · " : "") + p.name) + "</option>"; }).join("");
        $("fOwner").innerHTML = memberOptions(d.owner_id);
        $("fIdentified").value = d.identified_at || ""; $("fReview").value = d.review_at || "";
        $("fDescription").value = d.description || ""; $("fRootCause").value = d.root_cause || ""; $("fConsequences").value = d.consequences || ""; $("fControls").value = d.existing_controls || "";
        $("fL").innerHTML = scaleOptions(d.likelihood, "L"); $("fI").innerHTML = scaleOptions(d.impact, "I");
        $("fRL").innerHTML = scaleOptions(d.res_likelihood, "L"); $("fRI").innerHTML = scaleOptions(d.res_impact, "I");
        $("fStrategy").innerHTML = STRATS.map(function (s) { return '<option value="' + s + '"' + (d.strategy === s ? " selected" : "") + ">" + esc(t("strat_" + s)) + "</option>"; }).join("");
        $("fStatus").innerHTML = STATUSES.map(function (s) { return '<option value="' + s + '"' + (d.status === s ? " selected" : "") + ">" + esc(t("rstatus_" + s)) + "</option>"; }).join("");
        show("deleteBtn", !!r);
        renderActions(); updateScore();
        show("registerCard", false); show("overviewCard", false); show("editorCard", true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      function updateScore() {
        var l = Number($("fL").value), i = Number($("fI").value), rl = Number($("fRL").value), ri = Number($("fRI").value);
        var parts = [];
        if (l && i) parts.push(t("inherent") + ": " + t("band_" + band(l * i)) + " (" + (l * i) + ")");
        if (rl && ri) parts.push(t("residual") + ": " + t("band_" + band(rl * ri)) + " (" + (rl * ri) + ")");
        $("scoreLine").textContent = parts.join(" · ");
      }
      function renderActions() {
        var box = $("actions"); box.innerHTML = "";
        state.draft.actions.forEach(function (a, i) {
          var row = document.createElement("div"); row.className = "action-row";
          row.innerHTML = '<input type="text" class="waitlist-input" data-af="title" data-i="' + i + '" value="' + esc(a.title || "") + '" placeholder="' + esc(t("actionTitle")) + '" maxlength="200" dir="auto">' +
            '<select class="waitlist-input" data-af="owner_id" data-i="' + i + '">' + memberOptions(a.owner_id) + "</select>" +
            '<input type="date" class="waitlist-input" data-af="due" data-i="' + i + '" value="' + esc(a.due || "") + '" dir="ltr" data-duration="compact">' +
            '<label class="rule-check" style="white-space:nowrap"><input type="checkbox" data-af="done" data-i="' + i + '"' + (a.done ? " checked" : "") + "> " + esc(t("done")) + "</label>" +
            '<button type="button" class="st-tool is-danger" data-adel="' + i + '" title="' + esc(t("delete")) + '" aria-label="' + esc(t("delete")) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>';
          box.appendChild(row);
        });
      }
      function readForm() {
        var d = state.draft;
        d.title = $("fTitle").value.trim(); d.category = $("fCategory").value; d.client_name = $("fClient").value.trim(); d.case_number = $("fCase").value.trim();
        d.process_id = $("fProcess").value || null; d.owner_id = $("fOwner").value || null; d.identified_at = $("fIdentified").value || null; d.review_at = $("fReview").value || null;
        d.description = $("fDescription").value.trim(); d.root_cause = $("fRootCause").value.trim(); d.consequences = $("fConsequences").value.trim(); d.existing_controls = $("fControls").value.trim();
        d.likelihood = $("fL").value || null; d.impact = $("fI").value || null; d.res_likelihood = $("fRL").value || null; d.res_impact = $("fRI").value || null;
        d.strategy = $("fStrategy").value; d.status = $("fStatus").value;
        return d;
      }

      /* إجراءات المعالجة ذات التاريخ تضاف كعناصر متابعة (تنبيهات تلقائية) */
      function ensureTracker() {
        if (state.tracker) return Promise.resolve(state.tracker);
        var NAMES = { ar: "إدارة المخاطر", en: "Risk management", fr: "Gestion des risques", ur: "خطرات کا انتظام" };
        return app.listTrackers().then(function (list) {
          var vals = Object.keys(NAMES).map(function (k) { return NAMES[k]; });
          var found = (list || []).filter(function (tr) { return vals.indexOf(tr.name) !== -1; })[0];
          if (found) { state.tracker = found; return found; }
          return app.createTracker({ name: NAMES[lang()] || NAMES.ar }).then(function (tr) { state.tracker = tr; return tr; });
        });
      }
      function syncActionItems(risk) {
        var pending = (risk.actions || []).filter(function (a) { return a.title && a.due && !a.item_id && !a.done; });
        if (!pending.length) return Promise.resolve(risk);
        return ensureTracker().then(function (tr) {
          var rows = pending.map(function (a) {
            /* الرمز القياسي للخطر داخلي: يبقى في data لا في العنوان الظاهر */
            return { tracker_id: tr.id, title: a.title, due_at: new Date(a.due + "T09:00:00").toISOString(),
                     status: "open", category: t("riskActionCategory"), assignee_id: a.owner_id || null, client_name: risk.client_name || null,
                     case_number: risk.case_number || null, data: { risk_id: risk.id, risk_title: risk.title, risk_code: risk.code || null } };
          });
          return app.insertItems(rows).then(function (inserted) {
            (inserted || []).forEach(function (it, i) { pending[i].item_id = it.id; });
            return app.saveRisk(risk);
          });
        });
      }

      function load() {
        return Promise.all([app.listRisks(), app.listMembers(), app.listProcesses()]).then(function (res) {
          state.list = res[0] || []; state.members = res[1] || []; state.processes = res[2] || []; state.names = {};
          state.members.forEach(function (m) { var pr = m.profiles || {}; state.names[m.user_id] = pr.full_name || pr.email || ""; });
          /* المرشح يبنى مرة، ويحتفظ باختيار المستخدم بعد كل حفظ أو حذف */
          var filterHtml = '<option value="">' + esc(t("allStatuses")) + "</option>" + STATUSES.map(function (s) { return '<option value="' + s + '">' + esc(t("rstatus_" + s)) + "</option>"; }).join("");
          var fsel = $("statusFilter");
          if (fsel.innerHTML !== filterHtml) fsel.innerHTML = filterHtml;
          fsel.value = state.status || "";
          renderAll();
        });
      }
      /* أعمدة السجل بأسمائها المعروضة، تستعمل في CSV وإكسل معا */
      function riskColumns() {
        var keys = ["code","title","category","client_name","case_number","likelihood","impact","res_likelihood","res_impact","strategy","status","review_at"];
        var labels = { code: t("colCode"), title: t("colTitle"), category: t("colCategory"), client_name: t("colClient"),
          case_number: t("colCase"), likelihood: t("colLikelihood"), impact: t("colImpact"),
          res_likelihood: t("colResLikelihood"), res_impact: t("colResImpact"), strategy: t("colStrategy"),
          status: t("colStatus"), review_at: t("colReview") };
        return keys.map(function (k) {
          return { label: labels[k] || k, get: function (r) { return r[k] == null ? "" : r[k]; } };
        });
      }

      function exportCsv() { app.exportCsv("risks.csv", state.list || [], riskColumns()); }

      function exportXlsx() {
        var xlsxBtn = $("xlsxBtn"); xlsxBtn.disabled = true;
        app.exportXlsx("risks.xlsx", state.list || [], riskColumns(), t("title"))
          .catch(function () { /* يظل الزر متاحا لإعادة المحاولة */ })
          .then(function () { xlsxBtn.disabled = false; });
      }

      function wire() {
        $("newBtn").addEventListener("click", function () { openEditor(null); });
        /* زر واحد للتصدير، والنوع يُختار بعده */
        var exportBtn = $("exportBtn"), exportMenu = $("exportMenu");
        function closeExport() { exportMenu.hidden = true; exportBtn.setAttribute("aria-expanded", "false"); }
        exportBtn.addEventListener("click", function (ev) {
          ev.stopPropagation();
          exportMenu.hidden = !exportMenu.hidden;
          exportBtn.setAttribute("aria-expanded", exportMenu.hidden ? "false" : "true");
        });
        document.addEventListener("click", closeExport);
        exportMenu.addEventListener("click", function (ev) { ev.stopPropagation(); });
        $("csvBtn").addEventListener("click", function () { closeExport(); exportCsv(); });
        $("xlsxBtn").addEventListener("click", function () { closeExport(); exportXlsx(); });
        $("search").addEventListener("input", function () { state.search = this.value.trim(); renderList(); });
        $("statusFilter").addEventListener("change", function () { state.status = this.value; renderList(); });
        document.addEventListener("click", function (e) {
          var m = e.target.closest("[data-mode]"); if (m) { state.mode = m.dataset.mode; state.cell = null; renderAll(); return; }
          var c = e.target.closest(".heat-cell"); if (c) { state.cell = state.cell === c.dataset.cell ? null : c.dataset.cell; renderHeat(); renderList(); return; }
          if (e.target.closest("#clearCell")) { state.cell = null; renderHeat(); renderList(); }
        });
        $("listBody").addEventListener("click", function (e) {
          var ed = e.target.closest("[data-edit]"); if (!ed) return;
          var r = state.list.filter(function (x) { return x.id === ed.dataset.edit; })[0]; if (r) openEditor(r);
        });
        ["fL","fI","fRL","fRI"].forEach(function (id) { $(id).addEventListener("change", updateScore); });
        $("addAction").addEventListener("click", function () { readForm(); state.draft.actions.push({ title: "", owner_id: "", due: "", done: false }); renderActions(); });
        $("actions").addEventListener("input", function (e) { var el = e.target; if (el.dataset.af) state.draft.actions[Number(el.dataset.i)][el.dataset.af] = el.type === "checkbox" ? el.checked : el.value; });
        $("actions").addEventListener("change", function (e) { var el = e.target; if (el.dataset.af) state.draft.actions[Number(el.dataset.i)][el.dataset.af] = el.type === "checkbox" ? el.checked : el.value; });
        $("actions").addEventListener("click", function (e) { var d = e.target.closest("[data-adel]"); if (d && window.confirm(t("confirmDeleteAction"))) { state.draft.actions.splice(Number(d.dataset.adel), 1); renderActions(); } });
        $("form").addEventListener("submit", function (e) {
          e.preventDefault();
          var d = readForm();
          if (!d.title) { $("fTitle").focus(); return; }
          $("saveBtn").disabled = true;
          app.saveRisk(d).then(syncActionItems).then(load).then(function () { show("editorCard", false); show("registerCard", true); show("overviewCard", true); })
            .catch(function () { var m = $("msg"); m.textContent = t("saveFailed"); m.hidden = false; })
            .finally(function () { $("saveBtn").disabled = false; });
        });
        $("cancelBtn").addEventListener("click", function () { show("editorCard", false); show("registerCard", true); show("overviewCard", true); });
        $("deleteBtn").addEventListener("click", function () {
          if (!state.draft.id || !window.confirm(t("deleteConfirm"))) return;
          app.deleteRisk(state.draft.id).then(load).then(function () { show("editorCard", false); show("registerCard", true); show("overviewCard", true); });
        });
      }
      window.__risksRefresh = renderAll;
      function boot() {
        app = window.trackerApp;
        if (!app || !app.ready) { show("loadingCard", false); show("unavailableCard", true); return; }
        app.ready.then(function (res) {
          show("loadingCard", false);
          if (!res || res.unavailable || app.unavailable) { show("unavailableCard", true); return; }
          if (!app.org) { show("noOrgCard", true); return; }
          wire(); show("view", true); return load();
        }).catch(function () { show("loadingCard", false); show("unavailableCard", true); });
      }
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
    })();
  