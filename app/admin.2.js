    /* Platform admin console — data via window.trackerApp (app/common.js). */
    (function () {
      "use strict";

      const COUNT_CHUNK = 6;          /* organizations counted per round (2 HEAD requests each) */
      const OWNER_CHUNK = 100;        /* profile ids per "in" query */
      const STATUS_KEYS = { new: "statusNew", read: "statusRead", replied: "statusReplied", closed: "statusClosed" };

      let app = null;
      let orgs = [];                  /* organizations (+ subscriptions) from adminListOrgs() */
      let owners = {};                /* owner_id → { email, full_name } */
      let counts = {};                /* org_id → { members, items } (null = count unavailable) */
      let plansList = [];
      let messages = [];
      let orgsLoaded = false;
      let msgsLoaded = false;
      let filterText = "";

      const $ = (id) => document.getElementById(id);
      const T = (key) => {
        const dict = translations[l] || translations.ar;
        return dict[key] || translations.ar[key] || key;
      };
      const esc = (s) => String(s === null || s === undefined ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      const fmtDate = (iso, opts) => (app && app.fmtDate) ? app.fmtDate(iso, opts) : String(iso || "");

      /* ---------- view state ---------- */

      function show(id) {
        ["loadingCard", "unavailableCard", "deniedCard", "adminView"].forEach(c => {
          const el = $(c);
          if (el) el.style.display = c === id ? "" : "none";
        });
      }

      function setStatus(el, text, kind) {
        if (!el) return;
        if (!text) { el.style.display = "none"; el.textContent = ""; return; }
        el.textContent = text;
        el.className = "waitlist-msg" + (kind ? " " + kind : "");
        el.style.display = "block";
      }

      function errorText(err) {
        if (err && err.code === "PLAN_LIMIT") return T(err.limit === "members" ? "planLimitMembers" : "planLimitItems");
        const msg = err && err.message ? String(err.message) : "";
        return T("genericError") + (msg ? " (" + msg + ")" : "");
      }

      /* ---------- helpers ---------- */

      function planByCode(code) {
        for (let i = 0; i < plansList.length; i++) if (plansList[i].code === code) return plansList[i];
        return null;
      }

      function planName(code) {
        const p = planByCode(code);
        if (!p) return code || "—";
        return p["name_" + l] || p.name_en || p.code;
      }

      function defaultMonthsFor(code) {
        const p = planByCode(code);
        if (code === "yearly") return "12";
        if (p && p.price_yearly_sar !== null && p.price_yearly_sar !== undefined && (p.price_monthly_sar === null || p.price_monthly_sar === undefined)) return "12";
        return "1";
      }

      function ownerEmail(org) {
        const p = owners[org.owner_id];
        return p && p.email ? p.email : "";
      }

      function countText(orgId, field) {
        const c = counts[orgId];
        if (!c || c[field] === undefined) return "…";
        if (c[field] === null) return "—";
        return String(c[field]);
      }

      function expiryText(org) {
        if (!org.plan_expires_at) return T("noExpiry");
        const d = new Date(org.plan_expires_at);
        const text = fmtDate(org.plan_expires_at);
        if (!isNaN(d.getTime()) && d.getTime() < Date.now()) return text + " (" + T("expired") + ")";
        return text;
      }

      function matchesFilter(org) {
        if (!filterText) return true;
        const hay = (String(org.name || "") + " " + ownerEmail(org)).toLowerCase();
        return hay.indexOf(filterText) !== -1;
      }

      function row(labelKey, valueHtml, extraAttrs) {
        return '<div class="platform-stat-detail-row"><span>' + esc(T(labelKey)) + '</span>' +
               '<span class="platform-stat-detail-val"' + (extraAttrs || "") + '>' + valueHtml + '</span></div>';
      }

      /* ---------- (1) organizations ---------- */

      function orgCard(org) {
        const email = ownerEmail(org);
        return '<div class="feature-card" data-org="' + esc(org.id) + '">' +
          '<h3>' + esc(org.name) + '</h3>' +
          row("colOwner", email ? esc(email) : "—", ' style="overflow-wrap:anywhere"') +
          row("colPlan", esc(planName(org.plan_code))) +
          row("colExpires", esc(expiryText(org))) +
          row("colMembers", esc(countText(org.id, "members")), ' data-count="members:' + esc(org.id) + '"') +
          row("colItems", esc(countText(org.id, "items")), ' data-count="items:' + esc(org.id) + '"') +
          row("colCreated", esc(fmtDate(org.created_at, { withTime: true }))) +
          '<div class="chat-options"><button type="button" class="chat-option-btn" data-activate="' + esc(org.id) + '">' +
          esc(T("activateRowBtn")) + '</button></div>' +
          '</div>';
      }

      function renderOrgs() {
        const grid = $("orgsGrid");
        const countEl = $("orgsCount");
        if (!grid) return;
        if (!orgs.length) {
          grid.innerHTML = "";
          countEl.textContent = "";
          setStatus($("orgsStatus"), T("orgsEmpty"));
          return;
        }
        const list = orgs.filter(matchesFilter);
        grid.innerHTML = list.map(orgCard).join("");
        countEl.textContent = T("orgsCountLabel") + " " + list.length + (filterText ? " / " + orgs.length : "");
        grid.querySelectorAll("[data-activate]").forEach(btn => {
          btn.addEventListener("click", () => openActivate(btn.getAttribute("data-activate")));
        });
      }

      function refreshCountCells() {
        document.querySelectorAll("[data-count]").forEach(el => {
          const parts = String(el.getAttribute("data-count")).split(":");
          el.textContent = countText(parts.slice(1).join(":"), parts[0]);
        });
      }

      function countRows(table, orgId) {
        return app.client.from(table).select("*", { count: "exact", head: true }).eq("org_id", orgId)
          .then(r => {
            if (r && r.error) throw new Error(r.error.message);
            return (r && typeof r.count === "number") ? r.count : 0;
          })
          .catch(() => null);
      }

      function loadCounts(snapshot) {
        const ids = snapshot.map(o => o.id);
        let i = 0;
        function next() {
          if (orgs !== snapshot) return Promise.resolve();      /* a reload replaced the list */
          const chunk = ids.slice(i, i + COUNT_CHUNK);
          if (!chunk.length) return Promise.resolve();
          i += COUNT_CHUNK;
          return Promise.all(chunk.map(id =>
            Promise.all([countRows("org_members", id), countRows("items", id)])
              .then(res => { counts[id] = { members: res[0], items: res[1] }; })
          )).then(() => { refreshCountCells(); return next(); });
        }
        return next();
      }

      function loadOwners(snapshot) {
        const ids = [];
        snapshot.forEach(o => { if (o.owner_id && ids.indexOf(o.owner_id) === -1) ids.push(o.owner_id); });
        const chunks = [];
        for (let i = 0; i < ids.length; i += OWNER_CHUNK) chunks.push(ids.slice(i, i + OWNER_CHUNK));
        return chunks.reduce((p, chunk) => p.then(() =>
          app.client.from("profiles").select("id,email,full_name").in("id", chunk).then(r => {
            if (r && r.error) throw new Error(r.error.message);
            (r.data || []).forEach(p => { owners[p.id] = p; });
          })
        ), Promise.resolve()).catch(() => { /* owner email is optional */ });
      }

      function loadOrgs() {
        setStatus($("orgsStatus"), T("loading"));
        $("orgsRefresh").disabled = true;
        return Promise.all([app.adminListOrgs(), plansList.length ? Promise.resolve(plansList) : app.plans()])
          .then(res => {
            orgs = res[0] || [];
            plansList = res[1] || [];
            counts = {};
            orgsLoaded = true;
            setStatus($("orgsStatus"), "");
            const snapshot = orgs;
            return loadOwners(snapshot).then(() => {
              /* الملاك أولا: البطاقات ترسم مرة واحدة بأسمائهم لا بشرطة ثم اسم */
              if (orgs === snapshot) { renderOrgs(); renderActivateOptions(); }
              return loadCounts(snapshot);
            }).catch(() => { renderOrgs(); renderActivateOptions(); });
          })
          .catch(err => { setStatus($("orgsStatus"), T("loadError") + " " + (err && err.message ? err.message : ""), "error"); })
          .then(() => { $("orgsRefresh").disabled = false; });
      }

      /* ---------- (2) activate a subscription ---------- */

      function fillSelect(sel, placeholderKey, options, keep) {
        const current = keep !== undefined ? keep : sel.value;
        let html = '<option value="" disabled' + (current ? "" : " selected") + '>' + esc(T(placeholderKey)) + '</option>';
        options.forEach(o => {
          html += '<option value="' + esc(o.value) + '"' + (o.value === current ? " selected" : "") + '>' + esc(o.label) + '</option>';
        });
        sel.innerHTML = html;
        if (current && sel.value !== current) sel.value = "";
      }

      function renderActivateOptions() {
        const sorted = orgs.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), l));
        fillSelect($("actOrg"), "orgSelectPlaceholder", sorted.map(o => ({
          value: o.id,
          label: (o.name || "") + (ownerEmail(o) ? " — " + ownerEmail(o) : "")
        })));
        fillSelect($("actPlan"), "planSelectPlaceholder", plansList.map(p => ({ value: p.code, label: planName(p.code) })));
      }

      function openActivate(orgId) {
        const org = orgs.filter(o => o.id === orgId)[0];
        if (!org) return;
        $("actOrg").value = orgId;
        if (planByCode(org.plan_code)) {
          $("actPlan").value = org.plan_code;
          $("actMonths").value = defaultMonthsFor(org.plan_code);
        }
        setStatus($("actStatus"), "");
        const card = $("activateCard");
        if (card && card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "start" });
        $("actPlan").focus({ preventScroll: true });
      }

      function onActivateSubmit(ev) {
        ev.preventDefault();
        const orgId = $("actOrg").value;
        const planCode = $("actPlan").value;
        const months = Number($("actMonths").value) || 1;
        const note = String($("actNote").value || "").trim();
        const btn = $("actBtn");
        if (!orgId || !planCode) { setStatus($("actStatus"), T("activateMissing"), "error"); return; }
        btn.disabled = true;
        setStatus($("actStatus"), T("activating"));
        app.adminActivate({ org_id: orgId, plan_code: planCode, months: months, note: note || null })
          .then(() => {
            btn.disabled = false;
            $("actNote").value = "";
            setStatus($("actStatus"), T("activated"), "success");
            app.toast(T("activated"), "success");
            return loadOrgs();
          })
          .catch(err => {
            btn.disabled = false;
            setStatus($("actStatus"), errorText(err), "error");
          });
      }

      /* ---------- (3) contact messages ---------- */

      function statusLabel(status) {
        const s = String(status || "").toLowerCase();
        return STATUS_KEYS[s] ? T(STATUS_KEYS[s]) : (status || "—");
      }

      function messageCard(m) {
        const email = String(m.email || "").trim();
        const emailHtml = email
          ? '<a href="mailto:' + esc(email) + '">' + esc(email) + '</a>'
          : "—";
        return '<div class="feature-card" data-message="' + esc(m.id) + '">' +
          '<h3>' + esc(m.subject && String(m.subject).trim() ? m.subject : T("noSubject")) + '</h3>' +
          row("colDate", esc(fmtDate(m.created_at, { withTime: true }))) +
          row("colName", m.name ? esc(m.name) : "—", ' style="overflow-wrap:anywhere"') +
          row("colEmail", emailHtml, ' style="overflow-wrap:anywhere"') +
          row("colStatus", '<span class="highlight">' + esc(statusLabel(m.status)) + '</span>') +
          '<p style="white-space:pre-wrap;overflow-wrap:anywhere;margin-top:0.75rem;margin-bottom:0">' + esc(m.message) + '</p>' +
          '</div>';
      }

      function renderMessages() {
        const grid = $("msgsGrid");
        const countEl = $("msgsCount");
        if (!grid) return;
        if (!messages.length) {
          grid.innerHTML = "";
          countEl.textContent = "";
          setStatus($("msgsStatus"), T("messagesEmpty"));
          return;
        }
        grid.innerHTML = messages.map(messageCard).join("");
        countEl.textContent = T("messagesCountLabel") + " " + messages.length;
      }

      function loadMessages() {
        setStatus($("msgsStatus"), T("loading"));
        $("msgsRefresh").disabled = true;
        return app.adminContactMessages()
          .then(rows => {
            messages = rows || [];
            msgsLoaded = true;
            setStatus($("msgsStatus"), "");
            renderMessages();
          })
          .catch(err => { setStatus($("msgsStatus"), T("loadError") + " " + (err && err.message ? err.message : ""), "error"); })
          .then(() => { $("msgsRefresh").disabled = false; });
      }

      /* ---------- رسائل تلغرام ---------- */

      let tgMessages = [];

      function tgCard(m) {
        const who = (m.profiles && (m.profiles.full_name || m.profiles.email)) || "";
        const chat = (m.username ? "@" + esc(m.username) + " · " : "") + esc(m.first_name || "") +
                     ' <span dir="ltr">(' + esc(String(m.chat_id)) + ")</span>";
        return '<div class="feature-card">' +
          row("colChat", chat) +
          (who ? row("colUser", esc(who)) : "") +
          row("colText", '<span dir="auto">' + esc(m.body || "") + "</span>") +
          row("colAction", '<span class="highlight">' + esc(T("tgAction_" + (m.action || "none"))) + "</span>") +
          row("colDate", esc(fmtDate(m.created_at, { withTime: true }))) + "</div>";
      }

      function renderTgMessages() {
        const grid = $("tgGrid"), countEl = $("tgCount");
        if (!grid) return;
        if (!tgMessages.length) {
          grid.innerHTML = ""; countEl.textContent = "";
          setStatus($("tgStatus"), T("tgMsgsEmpty"));
          return;
        }
        grid.innerHTML = tgMessages.map(tgCard).join("");
        countEl.textContent = T("tgMsgsCountLabel") + " " + tgMessages.length;
        setStatus($("tgStatus"), "");
      }

      function loadTgMessages() {
        setStatus($("tgStatus"), T("loading"));
        $("tgRefresh").disabled = true;
        return app.adminTelegramMessages(200)
          .then(rows => { tgMessages = rows || []; renderTgMessages(); })
          .catch(err => { setStatus($("tgStatus"), T("loadError") + " " + (err && err.message ? err.message : ""), "error"); })
          .then(() => { $("tgRefresh").disabled = false; });
      }

      /* ---------- طلبات الترقية ---------- */

      let requests = [];
      let reqsLoaded = false;

      function requestCard(r) {
        const org = (r.organizations && r.organizations.name) || r.org_id;
        const pending = r.status === "pending";
        const actions = pending
          ? '<div class="chat-options" style="margin-top:0.75rem">' +
            '<button type="button" class="waitlist-btn" data-req-approve="' + esc(r.id) + '">' + esc(T("approveBtn")) + '</button>' +
            '<button type="button" class="chat-option-btn" data-req-reject="' + esc(r.id) + '">' + esc(T("rejectBtn")) + '</button>' +
            '</div>'
          : "";
        return '<div class="feature-card">' +
          row("orgNameLabel", esc(org)) +
          row("colPlan", esc(planName(r.plan_code)) + " · " + esc(String(r.months)) + " " + esc(T("monthsLabel"))) +
          row("colDate", esc(fmtDate(r.created_at, { withTime: true }))) +
          row("colStatus", '<span class="highlight">' + esc(T("reqStatus_" + r.status)) + "</span>") +
          actions + "</div>";
      }

      function renderRequests() {
        const grid = $("reqGrid");
        if (!grid) return;
        if (!requests.length) {
          grid.innerHTML = "";
          setStatus($("reqStatus"), T("requestsEmpty"));
          return;
        }
        setStatus($("reqStatus"), "");
        grid.innerHTML = requests.map(requestCard).join("");
      }

      function loadRequests() {
        setStatus($("reqStatus"), T("loading"));
        $("reqRefresh").disabled = true;
        return app.adminPlanRequests()
          .then(rows => {
            requests = rows || [];
            reqsLoaded = true;
            renderRequests();
          })
          .catch(err => { setStatus($("reqStatus"), T("loadError") + " " + (err && err.message ? err.message : ""), "error"); })
          .then(() => { $("reqRefresh").disabled = false; });
      }

      function onRequestAction(ev) {
        const approveBtn = ev.target.closest("[data-req-approve]");
        const rejectBtn = ev.target.closest("[data-req-reject]");
        const id = approveBtn ? approveBtn.dataset.reqApprove : (rejectBtn ? rejectBtn.dataset.reqReject : null);
        if (!id) return;
        const req = requests.filter(r => r.id === id)[0];
        if (!req) return;
        const approve = !!approveBtn;
        (approveBtn || rejectBtn).disabled = true;
        setStatus($("reqStatus"), T("savingReq"));
        app.adminDecideRequest(req, approve)
          .then(() => { setStatus($("reqStatus"), T("savedReq"), "success"); return Promise.all([loadRequests(), loadOrgs()]); })
          .catch(err => { setStatus($("reqStatus"), T("loadError") + " " + (err && err.message ? err.message : ""), "error"); });
      }

      /* ---------- wiring ---------- */

      function bind() {
        $("orgFilter").addEventListener("input", () => {
          filterText = String($("orgFilter").value || "").trim().toLowerCase();
          if (orgsLoaded) renderOrgs();
        });
        $("orgsRefresh").addEventListener("click", () => { loadOrgs(); });
        $("msgsRefresh").addEventListener("click", () => { loadMessages(); });
        $("tgRefresh").addEventListener("click", () => { loadTgMessages(); });
        $("reqRefresh").addEventListener("click", () => { loadRequests(); });
        $("reqGrid").addEventListener("click", onRequestAction);
        $("actPlan").addEventListener("change", () => { $("actMonths").value = defaultMonthsFor($("actPlan").value); });
        $("activateForm").addEventListener("submit", onActivateSubmit);
      }

      /* Re-render the dynamic parts after setLang(). */
      window.__adminRefresh = function () {
        if (orgsLoaded) { renderOrgs(); renderActivateOptions(); }
        if (msgsLoaded) renderMessages();
        if (reqsLoaded) renderRequests();
      };

      /* ---------- platform admins ---------- */

      function paCard(admin) {
        const isSelf = app.user && admin.id === app.user.id;
        const removeBtn = isSelf ? "" :
          '<button type="button" class="waitlist-btn" data-pa-remove="' + esc(admin.email) + '">' + esc(T("paRemoveBtn")) + "</button>";
        return '<div class="feature-card" data-pa="' + esc(admin.id) + '">' +
          '<h3>' + esc(admin.full_name || admin.email || "-") + (isSelf ? " · " + esc(T("paYou")) : "") + "</h3>" +
          '<p dir="ltr">' + esc(admin.email || "") + "</p>" +
          '<p>' + esc(fmtDate(admin.created_at)) + "</p>" +
          removeBtn +
        "</div>";
      }

      function loadPlatformAdmins() {
        return app.platformAdmins().then(list => {
          $("paGrid").innerHTML = (list || []).map(paCard).join("");
        }).catch(err => { setStatus($("paStatus"), errorText(err), "error"); });
      }

      function bindPlatformAdmins() {
        $("paAddBtn").addEventListener("click", () => {
          const email = ($("paEmail").value || "").trim();
          if (!email) return;
          setStatus($("paStatus"), T("paSaving"));
          app.setPlatformAdmin(email, true).then(() => {
            $("paEmail").value = "";
            setStatus($("paStatus"), T("paAdded").replace("{email}", email), "success");
            return loadPlatformAdmins();
          }).catch(err => { setStatus($("paStatus"), errorText(err), "error"); });
        });
        $("paGrid").addEventListener("click", (ev) => {
          const btn = ev.target.closest("[data-pa-remove]");
          if (!btn) return;
          const email = btn.getAttribute("data-pa-remove");
          setStatus($("paStatus"), T("paSaving"));
          app.setPlatformAdmin(email, false).then(() => {
            setStatus($("paStatus"), T("paRemoved").replace("{email}", email), "success");
            return loadPlatformAdmins();
          }).catch(err => { setStatus($("paStatus"), errorText(err), "error"); });
        });
      }

      function boot() {
        app = window.trackerApp;
        if (!app || !app.ready) { show("unavailableCard"); return; }
        app.ready.then(state => {
          if (app.unavailable || (state && state.unavailable)) { show("unavailableCard"); return; }
          if (!app.isPlatformAdmin()) { show("deniedCard"); return; }
          show("adminView");
          bind();
          bindPlatformAdmins();
          loadPlatformAdmins();
          loadOrgs();
          loadMessages();
          loadTgMessages();
          loadRequests();
        }).catch(() => { show("unavailableCard"); });
      }

      /* Deferred scripts (supabase-js, /app.js, /app/common.js) run before DOMContentLoaded. */
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
      else boot();
    })();
  