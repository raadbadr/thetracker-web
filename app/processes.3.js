    (function () {
      "use strict";
      var app = null;
      var AREAS = ["lawsuits","violations","contracts","licenses","documents","other"];
      var STATUSES = ["draft","review","published","archived"];
      var state = { list: [], members: [], names: {}, draft: null, area: "", search: "" };
      function $(id) { return document.getElementById(id); }
      function t(k) { if (app && app.t) return app.t(k); var d = translations[lang()] || translations.ar; return d[k] || translations.ar[k] || k; }
      function esc(v) { return app && app.escapeHtml ? app.escapeHtml(v) : String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]; }); }
      function show(id, on) { var el = $(id); if (el) el.hidden = !on; }
      function name(uid) { return uid ? (state.names[uid] || "-") : "-"; }
      function memberOptions(sel, allowEmpty) {
        var html = allowEmpty ? '<option value="">' + esc(t("none")) + "</option>" : "";
        state.members.forEach(function (m) { html += '<option value="' + esc(m.user_id) + '"' + (sel === m.user_id ? " selected" : "") + ">" + esc(state.names[m.user_id] || "") + "</option>"; });
        return html;
      }
      /* حرفان من الاسم يكفيان للتعرف على الشخص في دائرة صغيرة */
      function initialsOf(text) {
        var parts = String(text || "").trim().split(/\s+/).filter(Boolean)
          .map(function (w) { return w.replace(/^ال(?=.)/, ""); }); /* «الشمري» تُقرأ شينا لا ألفا */
        if (!parts.length) return "؟";
        if (parts.length === 1) return parts[0].slice(0, 2);
        return parts[0].slice(0, 1) + parts[1].slice(0, 1);
      }

      function rolePicker(stepIndex, role, current) {
        var list = state.members || [];
        if (!list.length) return '<span class="role-empty">' + esc(t("noMembersYet")) + "</span>";
        return list.map(function (m) {
          var full = state.names[m.user_id] || "";
          var on = current === m.user_id;
          return '<button type="button" class="avatar-btn' + (on ? " is-on" : "") + '" data-avatar="1"' +
                 ' data-i="' + stepIndex + '" data-role="' + role + '" data-member="' + esc(m.user_id) + '"' +
                 ' aria-pressed="' + (on ? "true" : "false") + '" title="' + esc(full) + '">' +
                 esc(initialsOf(full)) + "</button>";
        }).join("");
      }

      function newStep() { return { id: "s_" + Math.random().toString(36).slice(2, 7), type: "task", title: "", role: "", R: "", A: "", C: "", I: "", note: "", yesTarget: "", noTarget: "" }; }

      /* ---------- القائمة ---------- */
      function renderList() {
        var rows = state.list.filter(function (p) {
          if (state.area && p.area !== state.area) return false;
          if (state.search && (p.name + " " + (p.code || "")).toLowerCase().indexOf(state.search.toLowerCase()) === -1) return false;
          return true;
        });
        var body = $("listBody"); body.innerHTML = "";
        show("listWrap", rows.length > 0); show("listEmpty", rows.length === 0);
        rows.forEach(function (p) {
          var tr = document.createElement("tr");
          tr.innerHTML = '<td dir="ltr">' + esc(p.code || "") + "</td>" +
            '<td><a href="#" class="item-title" data-tr data-open="' + esc(p.id) + '">' + esc(p.name) + "</a></td>" +
            "<td>" + esc(t("area_" + (p.area || "other"))) + "</td>" +
            "<td>" + esc(name(p.owner_id)) + "</td>" +
            "<td>" + esc(String((p.steps || []).length)) + "</td>" +
            '<td><span class="status-pill ' + esc(p.status) + '">' + esc(t("status_" + p.status)) + "</span></td>" +
            '<td><div class="chat-options row-actions">' +
              '<button type="button" class="icon-btn" data-edit="' + esc(p.id) + '" title="' + esc(t("edit")) + '" aria-label="' + esc(t("edit")) + '">' +
                '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>' +
                "<span>" + esc(t("edit")) + "</span></button></div></td>";
          body.appendChild(tr);
        });
        /* النص الحر يُعرض بلغة القارئ متى توفرت الترجمة المشتركة */
        if (app && app.translateNodes) app.translateNodes(body);
      }

      /* ---------- المحرر ---------- */
      function openEditor(p) {
        state.draft = p ? JSON.parse(JSON.stringify(p)) : { name: "", area: "lawsuits", steps: [newStep()], status: "draft" };
        if (!Array.isArray(state.draft.steps) || !state.draft.steps.length) state.draft.steps = [newStep()];
        $("editorTitle").textContent = p ? t("editorEdit") + " — " + (p.code || "") : t("editorNew");
        $("fName").value = state.draft.name || "";
        $("fArea").innerHTML = AREAS.map(function (a) { return '<option value="' + a + '"' + (state.draft.area === a ? " selected" : "") + ">" + esc(t("area_" + a)) + "</option>"; }).join("");
        $("fOwner").innerHTML = memberOptions(state.draft.owner_id, true);
        $("fStatus").innerHTML = STATUSES.map(function (s) { return '<option value="' + s + '"' + (state.draft.status === s ? " selected" : "") + ">" + esc(t("status_" + s)) + "</option>"; }).join("");
        $("fFrequency").value = state.draft.frequency || ""; $("fTrigger").value = state.draft.trigger_text || "";
        $("fInputs").value = state.draft.inputs || ""; $("fOutputs").value = state.draft.outputs || ""; $("fDescription").value = state.draft.description || "";
        show("deleteBtn", !!p);
        renderSteps();
        show("listCard", false); show("detailCard", false); show("editorCard", true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      function renderSteps() {
        var box = $("steps"); box.innerHTML = "";
        state.draft.steps.forEach(function (st, i) {
          var row = document.createElement("div"); row.className = "step-row";
          var targets = state.draft.steps.map(function (_, j) { return '<option value="' + (j + 1) + '">' + (j + 1) + "</option>"; }).join("");
          row.innerHTML =
            '<span class="snum">' + (i + 1) + "</span>" +
            '<div class="step-tools">' +
              '<button type="button" class="st-tool" data-up="' + i + '" title="' + esc(t("moveUp")) + '">↑</button>' +
              '<button type="button" class="st-tool" data-down="' + i + '" title="' + esc(t("moveDown")) + '">↓</button>' +
              '<button type="button" class="st-tool is-danger" data-del="' + i + '" title="' + esc(t("delete")) + '" aria-label="' + esc(t("delete")) + '">' +
                '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:15px;height:15px;fill:currentColor"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button></div>' +
            '<div class="sgrid">' +
              '<label><span class="mini-label">' + esc(t("stepType")) + '</span><select class="waitlist-input" data-f="type" data-i="' + i + '">' +
                '<option value="task"' + (st.type !== "decision" ? " selected" : "") + ">" + esc(t("typeTask")) + "</option>" +
                '<option value="decision"' + (st.type === "decision" ? " selected" : "") + ">" + esc(t("typeDecision")) + "</option></select></label>" +
              '<label><span class="mini-label">' + esc(t("stepTitle")) + '</span><input type="text" class="waitlist-input" data-f="title" data-i="' + i + '" value="' + esc(st.title) + '" maxlength="200" dir="auto"></label>' +
            "</div>" +
            '<div class="raci-grid">' +
              ["R","A","C","I"].map(function (k) {
                return '<div class="role-pick"><span class="mini-label">' + k + " — " + esc(t("raci_" + k)) + "</span>" +
                       '<div class="avatars">' + rolePicker(i, k, st[k] || "") + "</div></div>";
              }).join("") +
            "</div>" +
            (st.type === "decision"
              ? '<div class="raci-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))"><label><span class="mini-label">' + esc(t("yesTo")) + '</span><select class="waitlist-input" data-f="yesTarget" data-i="' + i + '"><option value="">-</option>' + targets + '</select></label>' +
                '<label><span class="mini-label">' + esc(t("noTo")) + '</span><select class="waitlist-input" data-f="noTarget" data-i="' + i + '"><option value="">-</option>' + targets + "</select></label></div>"
              : "") +
            '<label style="display:block;margin-top:.5rem"><span class="mini-label">' + esc(t("stepNote")) + '</span><input type="text" class="waitlist-input" data-f="note" data-i="' + i + '" value="' + esc(st.note || "") + '" maxlength="300" dir="auto"></label>';
          box.appendChild(row);
          if (st.type === "decision") { row.querySelector('[data-f="yesTarget"]').value = st.yesTarget || ""; row.querySelector('[data-f="noTarget"]').value = st.noTarget || ""; }
        });
      }
      function readForm() {
        var d = state.draft;
        d.name = $("fName").value.trim(); d.area = $("fArea").value; d.owner_id = $("fOwner").value || null; d.status = $("fStatus").value;
        d.frequency = $("fFrequency").value.trim(); d.trigger_text = $("fTrigger").value.trim(); d.inputs = $("fInputs").value.trim(); d.outputs = $("fOutputs").value.trim(); d.description = $("fDescription").value.trim();
        return d;
      }

      /* ---------- التفاصيل: RACI + المخطط ---------- */
      function openDetail(p) {
        $("detailTitle").textContent = (p.code ? p.code + " · " : "") + p.name;
        $("detailMeta").textContent = [t("area_" + (p.area || "other")), name(p.owner_id), p.trigger_text ? t("fTrigger") + ": " + p.trigger_text : ""].filter(Boolean).join(" · ");
        var people = {};
        (p.steps || []).forEach(function (s) { ["R","A","C","I"].forEach(function (k) { if (s[k]) people[s[k]] = true; }); });
        var ids = Object.keys(people);
        var html = '<table class="raci-table"><thead><tr><th>' + esc(t("stepTitle")) + "</th>" + ids.map(function (id) { return "<th>" + esc(name(id)) + "</th>"; }).join("") + "</tr></thead><tbody>";
        (p.steps || []).forEach(function (s, i) {
          html += "<tr><td>" + (i + 1) + '. <span data-tr>' + esc(s.title) + "</span></td>" + ids.map(function (id) {
            var letters = ["R","A","C","I"].filter(function (k) { return s[k] === id; });
            return "<td>" + letters.map(function (k) { return '<span class="raci-badge raci-' + k + '">' + k + "</span>"; }).join(" ") + "</td>";
          }).join("") + "</tr>";
        });
        $("raciWrap").innerHTML = html + "</tbody></table>";
        var flow = "";
        (p.steps || []).forEach(function (s, i) {
          var who = ["R","A"].map(function (k) { return s[k] ? k + ": " + name(s[k]) : ""; }).filter(Boolean).join(" · ");
          flow += '<div class="flow-node ' + (s.type === "decision" ? "decision" : "") + '"><strong>' + (i + 1) + '. <span data-tr>' + esc(s.title || "") + "</span></strong>" + (who ? '<span class="role">' + esc(who) + "</span>" : "") +
                  (s.type === "decision" ? '<span class="role flow-branch">' + esc(t("yes")) + " → " + esc(s.yesTarget || "-") + " · " + esc(t("no")) + " → " + esc(s.noTarget || "-") + "</span>" : "") + "</div>";
          if (i < p.steps.length - 1) flow += '<div class="flow-arrow"></div>';
        });
        $("flow").innerHTML = flow || '<p class="empty-note">' + esc(t("noSteps")) + "</p>";
        /* نداء واحد للتفاصيل كلها: الخطوات نص حر يقرؤه كل عضو بلغته */
        if (app && app.translateNodes) app.translateNodes($("detailCard") || $("flow"));
        state.current = p;
        show("listCard", false); show("editorCard", false); show("detailCard", true);
      }

      function load() {
        return Promise.all([app.listProcesses(), app.listMembers()]).then(function (res) {
          state.list = res[0] || []; state.members = res[1] || []; state.names = {};
          state.members.forEach(function (m) { var pr = m.profiles || {}; state.names[m.user_id] = pr.full_name || pr.email || ""; });
          /* المرشح يبنى مرة، ويحتفظ باختيار المستخدم بعد كل حفظ أو حذف */
          var filterHtml = '<option value="">' + esc(t("allAreas")) + "</option>" + AREAS.map(function (a) { return '<option value="' + a + '">' + esc(t("area_" + a)) + "</option>"; }).join("");
          var asel = $("areaFilter");
          if (asel.innerHTML !== filterHtml) asel.innerHTML = filterHtml;
          asel.value = state.area || "";
          renderList();
        });
      }
      function wire() {
        $("newBtn").addEventListener("click", function () { openEditor(null); });
        $("search").addEventListener("input", function () { state.search = this.value.trim(); renderList(); });
        $("areaFilter").addEventListener("change", function () { state.area = this.value; renderList(); });
        $("listBody").addEventListener("click", function (e) {
          var o = e.target.closest("[data-open]"), ed = e.target.closest("[data-edit]");
          if (o) { e.preventDefault(); var p = state.list.filter(function (x) { return x.id === o.dataset.open; })[0]; if (p) openDetail(p); }
          else if (ed) { var q = state.list.filter(function (x) { return x.id === ed.dataset.edit; })[0]; if (q) openEditor(q); }
        });
        $("addStep").addEventListener("click", function () { readForm(); state.draft.steps.push(newStep()); renderSteps(); });
        $("steps").addEventListener("change", function (e) {
          var el = e.target; if (!el.dataset.f) return;
          var i = Number(el.dataset.i); state.draft.steps[i][el.dataset.f] = el.value;
          if (el.dataset.f === "type") renderSteps();
        });
        $("steps").addEventListener("input", function (e) { var el = e.target; if (el.dataset.f) state.draft.steps[Number(el.dataset.i)][el.dataset.f] = el.value; });
        $("steps").addEventListener("click", function (e) {
          var av = e.target.closest("[data-avatar]");
          if (av) {
            var ai = Number(av.dataset.i), role = av.dataset.role, id = av.dataset.member;
            var step = state.draft.steps[ai];
            step[role] = step[role] === id ? "" : id;
            av.parentElement.querySelectorAll("[data-avatar]").forEach(function (b) {
              var on = b.dataset.member === step[role];
              b.classList.toggle("is-on", on);
              b.setAttribute("aria-pressed", on ? "true" : "false");
            });
            return;
          }
          var up = e.target.closest("[data-up]"), dn = e.target.closest("[data-down]"), del = e.target.closest("[data-del]");
          var st = state.draft.steps;
          if (up) { var i = Number(up.dataset.up); if (i > 0) { var x = st[i]; st[i] = st[i - 1]; st[i - 1] = x; renderSteps(); } }
          else if (dn) { var j = Number(dn.dataset.down); if (j < st.length - 1) { var y = st[j]; st[j] = st[j + 1]; st[j + 1] = y; renderSteps(); } }
          else if (del) {
            if (st.length > 1 && window.confirm(t("confirmDeleteStep"))) { st.splice(Number(del.dataset.del), 1); renderSteps(); }
          }
        });
        $("form").addEventListener("submit", function (e) {
          e.preventDefault();
          var d = readForm();
          if (!d.name) { $("fName").focus(); return; }
          $("saveBtn").disabled = true;
          app.saveProcess(d).then(function () { return load(); }).then(function () { show("editorCard", false); show("listCard", true); })
            .catch(function () { var m = $("msg"); m.textContent = t("saveFailed"); m.hidden = false; })
            .finally(function () { $("saveBtn").disabled = false; });
        });
        $("cancelBtn").addEventListener("click", function () { show("editorCard", false); show("listCard", true); });
        $("deleteBtn").addEventListener("click", function () {
          if (!state.draft.id || !window.confirm(t("deleteConfirm"))) return;
          app.deleteProcess(state.draft.id).then(load).then(function () { show("editorCard", false); show("listCard", true); });
        });
        $("editBtn").addEventListener("click", function () { openEditor(state.current); });
        $("backBtn").addEventListener("click", function () { show("detailCard", false); show("listCard", true); });
      }
      window.__processesRefresh = function () { renderList(); };

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
  