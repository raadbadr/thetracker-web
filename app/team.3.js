    /* Team page logic — runs after the deferred scripts (supabase-js, app.js, common.js). */
    (function () {
      "use strict";

      var PRICING_PATH = "/pricing.html";
      var LOGIN_URL = window.location.origin + "/login.html";
      var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      var app = null;
      var state = { loaded: false, workLoaded: false, error: null, canManage: false, members: [], invitations: [], limits: {}, work: [], roles: {} };
      var RASI_CYCLE = ["", "R", "A", "S", "I"];

      function $(id) { return document.getElementById(id); }

      function t(key) {
        if (app && typeof app.t === "function") return app.t(key);
        var dict = translations[lang()] || translations.ar;
        return dict[key] || translations.ar[key] || key;
      }

      /* Plain-text placeholder fill: "{name}" → value. */
      function tf(key, vars) {
        var s = t(key);
        Object.keys(vars || {}).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); });
        return s;
      }

      function esc(s) {
        if (app && typeof app.escapeHtml === "function") return app.escapeHtml(s);
        return String(s === null || s === undefined ? "" : s)
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      }

      /* HTML placeholder fill: the template is escaped, the values are HTML already. */
      function tfHtml(key, htmlVars) {
        var s = esc(t(key));
        Object.keys(htmlVars || {}).forEach(function (k) { s = s.split("{" + k + "}").join(htmlVars[k]); });
        return s;
      }

      function fmtDate(iso, opts) { return (app && app.fmtDate) ? app.fmtDate(iso, opts) : ""; }
      function toast(message, kind) { if (app && app.toast) app.toast(message, kind); }
      function show(id, on) { var el = $(id); if (el) el.hidden = !on; }

      function roleName(role) {
        if (role === "owner") return t("roleOwner");
        if (role === "admin") return t("roleAdmin");
        return t("roleMember");
      }
      function memberEmail(m) { var p = m.profiles || {}; return p.email || m.invited_email || ""; }
      function memberName(m) { var p = m.profiles || {}; return p.full_name || memberEmail(m) || "-"; }
      function findMember(userId) {
        for (var i = 0; i < state.members.length; i++) if (state.members[i].user_id === userId) return state.members[i];
        return null;
      }

      function errorMessage(err) {
        if (!err) return t("genericError");
        if (err.code === "PLAN_LIMIT") return t("planLimitMembers");
        if (err.code === "NO_ORG") return t("noOrg");
        var msg = String(err.message || "").toLowerCase();
        if (msg === "invalid email") return t("invalidEmail");
        if (err.sbCode === "23505" || msg.indexOf("duplicate key") !== -1) return t("alreadyInvited");
        if (err.sbCode === "42501" || msg.indexOf("row-level security") !== -1 || msg.indexOf("permission denied") !== -1 || msg === "not allowed") return t("notAllowed");
        return t("genericError");
      }

      /* ---------- status lines ---------- */

      function setStatus(key, kind) {
        var el = $("teamStatus");
        if (!el) return;
        el.textContent = key ? t(key) : "";
        el.className = "waitlist-msg" + (kind ? " " + kind : "");
        el.hidden = !key;
      }

      function setMsg(id, text, kind) {
        var el = $(id);
        if (!el) return;
        el.textContent = text || "";
        el.className = "waitlist-msg" + (kind ? " " + kind : "");
        el.hidden = !text;
      }

      function setInviteMsg(text, kind) {
        var el = $("inviteMsg");
        if (!el) return;
        el.textContent = text || "";
        el.className = "waitlist-msg" + (kind ? " " + kind : "");
        el.hidden = !text;
      }

      /* ---------- plan capacity ---------- */

      function memberLimit() {
        var lim = state.limits ? state.limits.members : null;
        return (typeof lim === "number" && lim > 0) ? lim : null;
      }

      /* Pending invitations count as reserved seats: the DB enforces the limit when the invitee joins. */
      function isFull() {
        var lim = memberLimit();
        if (lim === null) return false;
        return (state.members.length + state.invitations.length) >= lim;
      }

      function upgradeLinkHtml() {
        return '<a href="' + PRICING_PATH + '">' + esc(t("upgradeLink")) + "</a>";
      }

      function renderCapacity() {
        var el = $("capacityLine");
        if (!el) return;
        if (!state.loaded) { el.hidden = true; return; }
        var lim = memberLimit();
        var used = '<span class="highlight">' + state.members.length + "</span>";
        var html = lim === null
          ? tfHtml("capacityUnlimited", { used: used })
          : tfHtml("capacityLimited", { used: used, limit: '<span class="highlight">' + lim + "</span>" });
        if (state.canManage && state.invitations.length) {
          html += " · " + tfHtml("capacityPending", { n: '<span class="highlight">' + state.invitations.length + "</span>" });
        }
        if (isFull()) html += "<br>" + esc(t("capacityFull")) + " " + upgradeLinkHtml();
        el.innerHTML = html;
        el.hidden = false;
      }

      /* ---------- members ---------- */

      function departmentName(m) {
        if (m.role === "owner" || m.role === "admin") return t("dept_management");
        if (!m.department) return t("deptUnset");
        return (app && app.departmentLabel) ? app.departmentLabel(m.department) : m.department;
      }

      function personKindName(k) {
        if (!k) return "-";
        var key = { partner: "personPartner", manager: "personManager", employee: "personEmployee", contractor: "personContractor" }[k];
        return key ? t(key) : "-";
      }

      /* البريد الطويل ينكسر عند @ وعند النقاط لا في منتصف الكلمة */
      function emailHtml(value) {
        var text = String(value == null ? "" : value);
        if (!text) return "-";
        return esc(text).replace(/@/g, "<wbr>@").replace(/\./g, "<wbr>.");
      }

      function renderMembers() {
        var grid = $("membersGrid");
        if (!grid) return;
        show("readOnlyNote", state.loaded && !state.canManage);
        if (!state.loaded) { grid.innerHTML = ""; show("membersEmpty", false); return; }

        var me = (app && app.user) ? app.user.id : null;
        grid.innerHTML = state.members.map(function (m) {
          var isOwner = m.role === "owner";
          var isSelf = !!me && m.user_id === me;
          var name = memberName(m);
          var email = memberEmail(m);

          var badges = '<span class="chat-option-btn" style="cursor:default">' + esc(roleName(m.role)) + "</span>";
          if (isSelf) badges += ' <span class="chat-option-btn" style="cursor:default">' + esc(t("you")) + "</span>";
          if (m.status && m.status !== "active") badges += ' <span class="chat-option-btn" style="cursor:default">' + esc(t("statusInvited")) + "</span>";

          var rows =
            '<div class="platform-stat-detail-row"><span>' + esc(t("emailLabel")) + "</span>" +
              '<span class="platform-stat-detail-val" dir="ltr" style="overflow-wrap:break-word;word-break:break-word">' + emailHtml(email) + "</span></div>" +
            '<div class="platform-stat-detail-row"><span>' + esc(t("personKindLabel")) + "</span>" +
              '<span class="platform-stat-detail-val">' + esc(personKindName(m.person_kind)) + "</span></div>" +
            '<div class="platform-stat-detail-row"><span>' + esc(t("departmentLabel")) + "</span>" +
              '<span class="platform-stat-detail-val">' + esc(departmentName(m)) + "</span></div>" +
            '<div class="platform-stat-detail-row"><span>' + esc(t("jobTitleLabel")) + "</span>" +
              '<span class="platform-stat-detail-val">' + esc(m.job_title || "-") + "</span></div>" +
            '<div class="platform-stat-detail-row"><span>' + esc(t("joinedLabel")) + "</span>" +
              '<span class="platform-stat-detail-val">' + esc(fmtDate(m.created_at) || "-") + "</span></div>";

          var controls = "";
          if (state.canManage) {
            controls +=
              '<div class="waitlist-form">' +
                '<select class="waitlist-input" data-dept-user="' + esc(m.user_id) + '" aria-label="' + esc(t("departmentLabel")) + '"' + (isOwner ? " disabled" : "") + '>' +
                  '<option value=""' + (!m.department ? " selected" : "") + ">" + esc(t("deptUnset")) + "</option>" +
                  (app && app.departments ? app.departments() : []).map(function (d) {
                    return '<option value="' + d.value + '"' + (m.department === d.value ? " selected" : "") + ">" + esc(app.departmentLabel(d.value)) + "</option>";
                  }).join("") +
                "</select>" +
                '<select class="waitlist-input" data-person-user="' + esc(m.user_id) + '" aria-label="' + esc(t("personKindLabel")) + '">' +
                  '<option value=""' + (!m.person_kind ? " selected" : "") + ">" + esc(t("personUnset")) + "</option>" +
                  ["partner", "manager", "employee", "contractor"].map(function (k) {
                    return '<option value="' + k + '"' + (m.person_kind === k ? " selected" : "") + ">" + esc(personKindName(k)) + "</option>";
                  }).join("") +
                "</select>" +
                '<input type="text" class="waitlist-input" data-title-user="' + esc(m.user_id) + '" maxlength="80" value="' + esc(m.job_title || "") + '" placeholder="' + esc(t("jobTitleLabel")) + '" dir="auto">' +
              "</div>";
          }
          if (state.canManage && !isOwner && !isSelf) {
            controls =
              '<div class="waitlist-form">' +
                '<select class="waitlist-input" data-role-user="' + esc(m.user_id) + '" aria-label="' + esc(t("changeRoleLabel")) + '">' +
                  '<option value="member"' + (m.role === "member" ? " selected" : "") + ">" + esc(t("roleMember")) + "</option>" +
                  '<option value="admin"' + (m.role === "admin" ? " selected" : "") + ">" + esc(t("roleAdmin")) + "</option>" +
                "</select>" +
                '<button type="button" class="chat-option-btn" data-remove-user="' + esc(m.user_id) + '" data-name="' + esc(name) + '">' + esc(t("removeBtn")) + "</button>" +
              "</div>";
          }

          return '<div class="feature-card" role="listitem">' +
                   "<h3>" + esc(name) + "</h3>" +
                   "<p>" + badges + "</p>" +
                   '<div class="platform-stat-detail">' + rows + controls + "</div>" +
                 "</div>";
        }).join("");
        show("membersEmpty", !state.members.length);
      }

      function onMembersClick(ev) {
        var btn = ev.target.closest("[data-remove-user]");
        if (!btn) return;
        var userId = btn.getAttribute("data-remove-user");
        var name = btn.getAttribute("data-name") || "";
        if (!window.confirm(tf("confirmRemove", { name: name }))) return;
        btn.disabled = true;
        app.removeMember(userId).then(function () {
          toast(t("memberRemoved"), "success");
          return loadAll();
        }).catch(function (err) {
          btn.disabled = false;
          toast(errorMessage(err), "error");
        });
      }

      function onPersonChange(ev) {
        var kindSel = ev.target.closest("[data-person-user]");
        var titleIn = ev.target.closest("[data-title-user]");
        var node = kindSel || titleIn;
        if (!node) return;
        var userId = node.getAttribute(kindSel ? "data-person-user" : "data-title-user");
        var fields = kindSel ? { person_kind: node.value } : { job_title: node.value };
        node.disabled = true;
        app.setMemberPerson(userId, fields).then(function () {
          var m = state.members.filter(function (x) { return x.user_id === userId; })[0];
          if (m) { if (kindSel) m.person_kind = node.value || null; else m.job_title = node.value || null; }
          toast(t("saved"));
        }).catch(function () { toast(t("genericError")); })
          .finally(function () { node.disabled = false; });
      }

      function onMembersChange(ev) {
        var deptSel = ev.target.closest("[data-dept-user]");
        if (deptSel) {
          var dUser = deptSel.getAttribute("data-dept-user"), dMember = findMember(dUser), prevDept = dMember ? (dMember.department || "") : "";
          deptSel.disabled = true;
          app.setMemberPerson(dUser, { department: deptSel.value || null }).then(function (rows) {
            if (!rows || !rows.length) throw new Error("not allowed");
            if (dMember) dMember.department = deptSel.value || null;
            toast(t("deptUpdated"), "success");
            render();
          }).catch(function (err) {
            deptSel.value = prevDept; deptSel.disabled = false;
            toast(errorMessage(err), "error");
          });
          return;
        }
        var sel = ev.target.closest("[data-role-user]");
        if (!sel) return;
        var userId = sel.getAttribute("data-role-user");
        var member = findMember(userId);
        var prevRole = member ? member.role : "member";
        var nextRole = sel.value;
        if (nextRole === prevRole) return;
        sel.disabled = true;
        app.setMemberRole(userId, nextRole).then(function (rows) {
          /* RLS silently updates nothing when the caller is not allowed. */
          if (!rows || !rows.length) throw new Error("not allowed");
          if (member) member.role = nextRole;
          toast(t("roleUpdated"), "success");
          render();
        }).catch(function (err) {
          sel.value = prevRole;
          sel.disabled = false;
          toast(errorMessage(err), "error");
        });
      }

      /* ---------- invitations ---------- */

      function renderInvite() {
        var visible = state.loaded && state.canManage;
        show("inviteCard", visible);
        if (!visible) return;

        var link = $("loginLinkText");
        if (link) { link.textContent = LOGIN_URL; link.href = LOGIN_URL; }

        var full = isFull();
        var busy = $("inviteForm").getAttribute("data-busy") === "1";
        $("inviteEmail").disabled = full || busy;
        $("inviteRole").disabled = full || busy;
        $("inviteBtn").disabled = full || busy;
        var limitMsg = $("inviteLimitMsg");
        if (full) {
          limitMsg.innerHTML = esc(t("planLimitMembers")) + " " + upgradeLinkHtml();
          limitMsg.hidden = false;
        } else {
          limitMsg.hidden = true;
        }
        renderInvitations();
      }

      function renderInvitations() {
        var list = $("invitationsList");
        if (!list) return;
        list.innerHTML = state.invitations.map(function (inv) {
          var email = String(inv.email || "");
          return '<div class="platform-stat-detail-row">' +
                   '<span><span dir="ltr" style="overflow-wrap:break-word;word-break:break-word">' + emailHtml(email) + "</span> · " + esc(roleName(inv.role)) + " · " + esc(tf("invitedOn", { date: fmtDate(inv.created_at) || "-" })) + "</span>" +
                   '<span class="platform-stat-detail-val"><button type="button" class="chat-option-btn" data-cancel-invite="' + esc(inv.id) + '" data-email="' + esc(email) + '">' + esc(t("cancelInviteBtn")) + "</button></span>" +
                 "</div>";
        }).join("");
        list.hidden = !state.invitations.length;
        show("invitationsEmpty", !state.invitations.length);
      }

      function onInvitationsClick(ev) {
        var btn = ev.target.closest("[data-cancel-invite]");
        if (!btn) return;
        var id = btn.getAttribute("data-cancel-invite");
        var email = btn.getAttribute("data-email") || "";
        if (!window.confirm(tf("confirmCancelInvite", { email: email }))) return;
        btn.disabled = true;
        app.cancelInvitation(id).then(function () {
          toast(t("inviteCancelled"), "success");
          return loadAll();
        }).catch(function (err) {
          btn.disabled = false;
          toast(errorMessage(err), "error");
        });
      }

      function onInviteSubmit(ev) {
        ev.preventDefault();
        var form = $("inviteForm");
        var input = $("inviteEmail");
        var role = $("inviteRole").value === "admin" ? "admin" : "member";
        var email = String(input.value || "").trim().toLowerCase();

        if (!EMAIL_RE.test(email)) { setInviteMsg(t("invalidEmail"), "error"); input.focus(); return; }
        if (isFull()) { setInviteMsg(t("planLimitMembers"), "error"); return; }
        if (state.members.some(function (m) { return memberEmail(m).toLowerCase() === email; })) { setInviteMsg(t("alreadyMember"), "error"); return; }
        if (state.invitations.some(function (i) { return String(i.email || "").toLowerCase() === email; })) { setInviteMsg(t("alreadyInvited"), "error"); return; }

        form.setAttribute("data-busy", "1");
        renderInvite();
        setInviteMsg(t("inviteSending"));
        app.inviteMember(email, role).then(function () {
          input.value = "";
          setInviteMsg(tf("inviteCreated", { email: email }), "success");
          return loadAll();
        }).catch(function (err) {
          setInviteMsg(errorMessage(err), "error");
        }).then(function () {
          form.removeAttribute("data-busy");
          renderInvite();
        });
      }

      function onCopyLink() {
        var done = function () { toast(t("linkCopied"), "success"); };
        var fallback = function () {
          try {
            var range = document.createRange();
            range.selectNodeContents($("loginLinkText"));
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            if (document.execCommand("copy")) done();
            sel.removeAllRanges();
          } catch (e) { /* clipboard blocked: the link stays visible and selectable */ }
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(LOGIN_URL).then(done).catch(fallback);
        } else {
          fallback();
        }
      }

      /* ---------- load & render ---------- */

      /* ---------- توزيع الأعمال ---------- */

      function memberById(id) {
        for (var i = 0; i < state.members.length; i++) if (state.members[i].user_id === id) return state.members[i];
        return null;
      }

      function nameOf(id) {
        var m = memberById(id);
        return m ? memberName(m) : "";
      }

      /* الرقم القياسي (ITM-) داخلي لا يُعرض: يظهر رقم القضية أو المخالفة أو المستند */
      function shownNumber(it) {
        var d = it.data || {};
        return String(it.case_number || d.number || d.violation_number ||
                      d["رقم المخالفة"] || d["رقم الدعوى"] || d["رقم القضية"] || "").trim();
      }

      function workload() {
        var now = Date.now();
        var by = {};
        state.members.forEach(function (m) { by[m.user_id] = { open: 0, overdue: 0, done: 0 }; });
        state.work.forEach(function (it) {
          var slot = by[it.assignee_id];
          if (!slot) return;
          if (it.status === "done") { slot.done++; return; }
          if (it.status === "cancelled") return;
          slot.open++;
          var due = it.due_at ? new Date(it.due_at).getTime() : null;
          if (due && due < now) slot.overdue++;
        });
        return by;
      }

      /* الدور بكلمته الكاملة بلغة الواجهة: لا R ولا A ولا حرفان من الاسم */
      function roleWord(role) { return role ? t("rasiWord" + role) : ""; }

      /* شرائح الأعضاء بالاسم الكامل: نقرة تسند، نقرة على غيره تنقل، نقرة على المسند تلغي */
      function memberDots(itemId, assigned) {
        var dots = state.members.filter(function (m) { return m.status === "active"; }).map(function (m) {
          var on = m.user_id === assigned;
          return '<button type="button" class="mchip' + (on ? " is-on" : "") + '"' +
                 ' data-assign-item="' + esc(itemId) + '" data-assign-user="' + esc(m.user_id) + '"' +
                 ' aria-pressed="' + (on ? "true" : "false") + '">' +
                 esc(memberName(m)) + "</button>";
        }).join("");
        return '<div class="mdots" role="group" aria-label="' + esc(t("assignTo")) + '">' + dots + "</div>";
      }

      function memberOptions(selected) {
        var html = '<option value="">' + esc(t("assignPick")) + "</option>";
        state.members.forEach(function (m) {
          html += '<option value="' + esc(m.user_id) + '"' + (m.user_id === selected ? " selected" : "") + ">" +
                  esc(memberName(m)) + "</option>";
        });
        return html;
      }

      function renderWorkload() {
        var card = $("workloadCard");
        if (!card) return;
        show("workloadCard", state.loaded && state.workLoaded);
        if (!state.loaded || !state.workLoaded) return;

        var now = Date.now();
        var cols = [{ id: "", name: t("unassign") }].concat(state.members.map(function (m) { return { id: m.user_id, name: memberName(m) }; }));
        var open = state.work.filter(function (it) { return it.status !== "done" && it.status !== "cancelled"; });

        $("wlBoard").innerHTML = cols.map(function (c) {
          var mine = open.filter(function (it) { return (it.assignee_id || "") === c.id; });
          var late = mine.filter(function (it) { return it.due_at && new Date(it.due_at).getTime() < now; }).length;
          var done = c.id ? state.work.filter(function (it) { return it.assignee_id === c.id && it.status === "done"; }).length : 0;
          var head = '<div class="wl-col-head"><strong>' + esc(c.name) + "</strong><span>" +
                     esc(t("wlOpen")) + " " + mine.length +
                     (late ? ' · <span class="is-late">' + esc(t("wlOverdue")) + " " + late + "</span>" : "") +
                     (c.id ? " · " + esc(t("wlDone")) + " " + done : "") + "</span></div>";
          var list = mine.map(function (it) {
            var isLate = it.due_at && new Date(it.due_at).getTime() < now;
            var meta = [shownNumber(it), it.due_at ? fmtDate(it.due_at) : t("noDue")].filter(Boolean).join(" · ");
            return '<div class="wl-card' + (isLate ? " is-late" : "") + '" data-item="' + esc(it.id) + '">' +
                     '<b data-tr>' + esc(it.title || "-") + "</b><span>" + esc(meta) + "</span>" +
                     memberDots(it.id, it.assignee_id || "") +
                   "</div>";
          }).join("");
          return '<div class="wl-col" data-col="' + esc(c.id) + '">' + head + '<div class="wl-list">' + (list || '<div class="wl-empty">' + esc(t("unassignedEmpty")) + "</div>") + "</div></div>";
        }).join("");
        if (app.translateNodes) app.translateNodes($("wlBoard"));
      }

      function assignTo(itemId, userId) {
        return app.assignItem(itemId, userId || null).then(function () {
          toast(userId ? tf("assignDone", { name: nameOf(userId) }) : t("unassign"), "success");
          return loadWork();
        }).catch(function (err) { toast(errorMessage(err), "error"); return loadWork(); });
      }

      function onDotClick(ev) {
        var dot = ev.target.closest("[data-assign-user]");
        if (!dot || dot.disabled) return;
        var itemId = dot.getAttribute("data-assign-item"), userId = dot.getAttribute("data-assign-user");
        var wasOn = dot.getAttribute("aria-pressed") === "true";
        dot.disabled = true;
        assignTo(itemId, wasOn ? "" : userId);
      }

      function onAssignChange(ev) {
        var sel = ev.target.closest("[data-assign-item]");
        if (!sel) return;
        sel.disabled = true;
        assignTo(sel.getAttribute("data-assign-item"), sel.value);
      }

      /* السحب والإفلات بين الأعمدة */

      function loadWork() {
        return app.teamWorkItems().then(function (rows) {
          state.work = rows || [];
          window.__teamWork = state.work;   /* الدردشة تستخدمها لربط الملفات بقضية */
          return loadRoles();
        }).catch(function () { /* الأعمال ليست حرجة لعرض الفريق */ });
      }

      /* ---------- مصفوفة RASI ---------- */
      function loadRoles() {
        return app.listItemRoles().then(function (rows) {
          var map = {};
          (rows || []).forEach(function (r) { (map[r.item_id] = map[r.item_id] || {})[r.user_id] = r.role; });
          state.roles = map;
          state.workLoaded = true;          /* الآن فقط تظهر البطاقتان، مرة واحدة */
          renderWorkload();
          renderRasi();
        }).catch(function () {
          state.workLoaded = true;
          renderWorkload();
          renderRasi();
        });
      }

      function rasiRows() {
        var q = String(($("rasiSearch") && $("rasiSearch").value) || "").trim().toLowerCase();
        return state.work.filter(function (it) {
          if (it.status !== "open") return false;
          if (!q) return true;
          return String(it.title || "").toLowerCase().indexOf(q) !== -1 ||
                 String(shownNumber(it)).toLowerCase().indexOf(q) !== -1 ||
                 String(it.item_number || "").toLowerCase().indexOf(q) !== -1;
        }).slice(0, 150);
      }

      /* التوزيع السريع: صف لكل عنصر مفتوح وشرائح بأسماء الأعضاء */
      function renderQuick() {
        var list = $("quickList");
        if (!list) return;
        var members = state.members.filter(function (m) { return m.status === "active"; });
        var rows = state.work.filter(function (it) { return it.status === "open"; }).slice(0, 100);
        renderQuickAddMembers();
        if (!members.length || !rows.length) { list.innerHTML = ""; return; }
        list.innerHTML = rows.map(function (it) {
          var num = shownNumber(it);
          var meta = [num ? '<span class="rasi-code">' + esc(num) + "</span>" : "", it.due_at ? esc(fmtDate(it.due_at)) : ""].filter(Boolean).join(" · ");
          var chips = members.map(function (m) {
            var role = (state.roles[it.id] || {})[m.user_id] || "";
            return '<button type="button" class="rasi-chip' + (role ? " is-" + role : "") + '" data-q-item="' + esc(it.id) + '" data-q-user="' + esc(m.user_id) + '">' +
                   esc(memberName(m)) + (role ? "<b>" + esc(roleWord(role)) + "</b>" : "") + "</button>";
          }).join("");
          return '<div class="user-row"><div><strong>' + esc(it.title || "-") + "</strong>" + (meta ? "<span>" + meta + "</span>" : "") + "</div>" +
                 '<div class="rasi-chips">' + chips + "</div></div>";
        }).join("");
      }

      function renderQuickAddMembers() {
        var sel = $("quickAddMember");
        if (!sel) return;
        var keep = sel.value;
        var members = state.members.filter(function (m) { return m.status === "active"; });
        sel.innerHTML = '<option value="">' + esc(t("quickAddNobody")) + "</option>" +
          members.map(function (m) { return '<option value="' + esc(m.user_id) + '">' + esc(memberName(m)) + "</option>"; }).join("");
        if (keep) sel.value = keep;
        var input = $("quickAddText"); if (input) input.placeholder = t("quickAddPh");
      }

      /* اسم المنفذ الذي فهمه المحلل ("لأحمد") ← عضو من الفريق */
      function memberByName(name) {
        var q = String(name || "").trim().toLowerCase();
        if (!q) return null;
        var members = state.members.filter(function (m) { return m.status === "active"; });
        for (var i = 0; i < members.length; i++) {
          var n = memberName(members[i]).toLowerCase(), e = String((members[i].profiles || {}).email || "").toLowerCase();
          if (n === q || e === q) return members[i];
        }
        for (var j = 0; j < members.length; j++) {
          var nn = memberName(members[j]).toLowerCase();
          if (nn.indexOf(q) !== -1 || q.indexOf(nn.split(" ")[0]) !== -1) return members[j];
        }
        return null;
      }

      /* قاعدة: المهمة تتبع قضية أو مخالفة دائما؛ إن لم يعرف الأصل من النص تعرض المرشحات للاختيار */
      var pendingAdd = null;

      function submitQuickAdd(payload, assignee) {
        var input = $("quickAddText"), msg = $("quickAddMsg");
        return app.quickAddItem(payload, assignee).then(function (res) {
          if (res && res.status === "needs_parent") {
            pendingAdd = { payload: payload, assignee: assignee };
            var sel = $("quickAddParent");
            sel.innerHTML = (res.candidates || []).map(function (c) {
              var label = [c.title, c.client_name, c.case_number ? t("fCase") + " " + c.case_number : "", c.violation_number ? "#" + c.violation_number : ""].filter(Boolean).join(" — ");
              return '<option value="' + esc(c.id) + '">' + esc(label) + "</option>";
            }).join("");
            show("quickParentRow", true);
            msg.className = "waitlist-msg"; msg.textContent = t("quickAddNeedsParent");
            return null;
          }
          var who = assignee ? " — " + nameOf(assignee) : "";
          var title = (res && res.title) || payload.title;
          msg.className = "waitlist-msg success"; msg.textContent = tf("quickAddDone", { title: title, who: who });
          toast(tf("quickAddDone", { title: title, who: who }), "success");
          pendingAdd = null; show("quickParentRow", false);
          input.value = ""; $("quickAddMember").value = "";
          return loadWork();
        });
      }

      function onQuickAdd(ev) {
        ev.preventDefault();
        var input = $("quickAddText"), btn = $("quickAddBtn"), msg = $("quickAddMsg");
        var text = String(input.value || "").trim();
        if (!text) { input.focus(); return; }
        btn.disabled = true; msg.hidden = false; msg.className = "waitlist-msg"; msg.textContent = t("quickAddParsing");
        show("quickParentRow", false); pendingAdd = null;
        app.parseIntent(text).then(function (intent) {
          var it = (intent && intent.item) || {};
          if (!it.title) it.title = text.slice(0, 160);
          var chosen = $("quickAddMember").value || null;
          var m = !chosen && intent && intent.member ? memberByName(intent.member) : null;
          var assignee = chosen || (m ? m.user_id : null);
          return submitQuickAdd({ kind: it.kind || "task", title: it.title, due_at: it.due_at || null, amount: it.amount, client_name: it.client_name, case_number: it.case_number, violation_number: it.violation_number, location: it.location, notes: it.notes }, assignee);
        }).catch(function (err) {
          msg.className = "waitlist-msg error"; msg.textContent = errorMessage(err);
        }).then(function () { btn.disabled = false; });
      }

      function onQuickParent() {
        if (!pendingAdd) return;
        var sel = $("quickAddParent"), btn = $("quickParentBtn"), msg = $("quickAddMsg");
        if (!sel.value) return;
        btn.disabled = true;
        var payload = {}; for (var k in pendingAdd.payload) if (Object.prototype.hasOwnProperty.call(pendingAdd.payload, k)) payload[k] = pendingAdd.payload[k];
        payload.parent_id = sel.value;
        submitQuickAdd(payload, pendingAdd.assignee).catch(function (err) {
          msg.className = "waitlist-msg error"; msg.textContent = errorMessage(err);
        }).then(function () { btn.disabled = false; });
      }

      function onQuickClick(ev) {
        var btn = ev.target.closest("[data-q-item]");
        if (!btn || btn.disabled) return;
        var itemId = btn.getAttribute("data-q-item"), userId = btn.getAttribute("data-q-user");
        var current = (state.roles[itemId] || {})[userId] || "";
        var mode = current === "R" ? "S" : current === "S" ? null : "R";
        btn.disabled = true;
        app.distributeItem(itemId, userId, mode).then(function (res) {
          state.roles[itemId] = (res && res.roles) || {};
          state.work.forEach(function (it) {
            if (it.id !== itemId) return;
            if (mode === "R") it.assignee_id = userId;
            else if (it.assignee_id === userId) it.assignee_id = null;
          });
          renderQuick();
          renderRasi();
          renderWorkload();
          toast(t("rasiSaved"), "success");
        }).catch(function (err) {
          btn.disabled = false;
          toast(errorMessage(err), "error");
        });
      }

      function renderRasi() {
        var card = $("rasiCard");
        if (!card) return;
        show("rasiCard", state.loaded && state.workLoaded);
        if (!state.loaded || !state.workLoaded) return;
        renderQuick();
        var members = state.members.filter(function (m) { return m.status === "active"; });
        var rows = rasiRows();
        var table = $("rasiTable");
        var placeholder = $("rasiSearch"); if (placeholder) placeholder.placeholder = t("rasiSearch");
        if (!members.length) { table.tHead.innerHTML = ""; table.tBodies[0].innerHTML = ""; $("rasiEmpty").textContent = t("rasiNoMembers"); show("rasiEmpty", true); return; }
        if (!rows.length) { table.tHead.innerHTML = ""; table.tBodies[0].innerHTML = ""; $("rasiEmpty").textContent = t("rasiEmpty"); show("rasiEmpty", true); return; }
        show("rasiEmpty", false);
        table.tHead.innerHTML = "<tr><th>" + esc(t("rasiItemCol")) + "</th>" +
          members.map(function (m) { return "<th>" + esc(memberName(m)) + "</th>"; }).join("") + "</tr>";
        table.tBodies[0].innerHTML = rows.map(function (it) {
          var meta = [shownNumber(it), it.due_at ? fmtDate(it.due_at) : ""].filter(Boolean).join(" · ");
          var cells = members.map(function (m) {
            var role = (state.roles[it.id] || {})[m.user_id] || "";
            var word = roleWord(role);
            return '<td><button type="button" class="rasi-cell' + (role ? " is-" + role : "") + '" data-rasi-item="' + esc(it.id) + '" data-rasi-user="' + esc(m.user_id) + '" title="' + esc(t("rasiDragHint")) + '" aria-label="' + esc(memberName(m) + (word ? " — " + word : "")) + '">' + esc(word || "—") + "</button></td>";
          }).join("");
          return '<tr><td><div class="rasi-item"><strong>' + esc(it.title || "-") + "</strong>" + (meta ? "<small>" + esc(meta) + "</small>" : "") + "</div></td>" + cells + "</tr>";
        }).join("");
      }

      /* ---------- الأدوار بالنقر: يختار الحرف مرة ثم تنقر الخلايا ---------- */
      var armedRole = null;

      function applyRole(itemId, userId, role, cell) {
        if (cell) cell.disabled = true;
        return app.setItemRole(itemId, userId, role || null).then(function () {
          var row = state.roles[itemId] = state.roles[itemId] || {};
          /* معتمد واحد لكل عنصر: من يأخذ A يزيح من قبله */
          if (role === "A") Object.keys(row).forEach(function (u) { if (row[u] === "A" && u !== userId) delete row[u]; });
          if (role) row[userId] = role; else delete row[userId];
          renderRasi();
          toast(t("rasiDropped"), "success");
        }).catch(function (err) {
          if (cell) cell.disabled = false;
          toast(errorMessage(err), "error");
        });
      }

      function setArmed(role) {
        armedRole = role;
        var palette = $("rasiPalette");
        if (!palette) return;
        palette.querySelectorAll("[data-role]").forEach(function (chip) {
          var on = chip.getAttribute("data-role") === (role == null ? "\u0000" : role);
          chip.classList.toggle("is-armed", on);
          chip.setAttribute("aria-pressed", on ? "true" : "false");
        });
      }

      function wireRasi() {
        var palette = $("rasiPalette"), table = $("rasiTable");
        if (!palette || !table) return;
        palette.addEventListener("click", function (ev) {
          var chip = ev.target.closest("[data-role]");
          if (!chip) return;
          var role = chip.getAttribute("data-role");
          setArmed(armedRole === role ? null : role);   /* نقرة ثانية تلغي الاختيار */
        });
        table.addEventListener("click", function (ev) {
          var cell = ev.target.closest("[data-rasi-item]");
          if (!cell || cell.disabled) return;
          var itemId = cell.getAttribute("data-rasi-item"), userId = cell.getAttribute("data-rasi-user");
          var current = (state.roles[itemId] || {})[userId] || "";
          if (armedRole === null) { toast(t("rasiPickFirst")); return; }
          var next = (armedRole === current) ? "" : armedRole;   /* النقر على الدور نفسه يزيله */
          applyRole(itemId, userId, next, cell);
        });
        /* لوحة المفاتيح: ركز الخلية واضغط الحرف أو Delete */
        table.addEventListener("keydown", function (ev) {
          var cell = ev.target.closest("[data-rasi-item]");
          if (!cell) return;
          var key = String(ev.key || "").toUpperCase();
          var role = ["R", "A", "S", "I"].indexOf(key) !== -1 ? key : (ev.key === "Delete" || ev.key === "Backspace" ? "" : null);
          if (role === null) return;
          ev.preventDefault();
          applyRole(cell.getAttribute("data-rasi-item"), cell.getAttribute("data-rasi-user"), role, cell);
        });
      }



      function render() {
        if (state.error) setStatus("loadError", "error");
        else if (!state.loaded) setStatus("loading");
        else setStatus(null);
        renderCapacity();
        renderMembers();
        renderInvite();
        renderWorkload();
        renderRasi();
        show("chatLinkCard", state.loaded);
      }

      function loadAll() {
        return Promise.all([
          app.listMembers(),
          app.planLimits().catch(function () { return {}; }),
          state.canManage ? app.listInvitations().catch(function () { return []; }) : Promise.resolve([])
        ]).then(function (res) {
          state.members = res[0] || [];
          state.limits = res[1] || {};
          state.invitations = res[2] || [];
          state.loaded = true;
          state.error = null;
          render();
          return loadWork();
        }).catch(function (err) {
          state.error = err;
          render();
        });
      }

      function showUnavailable() {
        show("teamCard", false);
        show("inviteCard", false);
        show("workloadCard", false);
        show("rasiCard", false);
        show("chatLinkCard", false);
        show("noOrgCard", false);
        show("unavailableCard", true);
      }

      function showNoOrg() {
        show("teamCard", false);
        show("inviteCard", false);
        show("workloadCard", false);
        show("rasiCard", false);
        show("chatLinkCard", false);
        show("unavailableCard", false);
        show("noOrgCard", true);
      }

      function boot() {
        app = window.trackerApp || null;
        window.__teamRender = render;

        $("membersGrid").addEventListener("click", onMembersClick);
        $("membersGrid").addEventListener("change", onMembersChange);
        $("membersGrid").addEventListener("change", onPersonChange);
        $("invitationsList").addEventListener("click", onInvitationsClick);
        function memberColumns() {
          return [
            { label: t("membersTitle"), get: memberName },
            { label: t("emailLabel"), get: memberEmail },
            { label: t("roleLabel"), get: function (m) { return roleName(m.role); } },
            { label: t("personKindLabel"), get: function (m) { return personKindName(m.person_kind); } },
            { label: t("jobTitleLabel"), get: function (m) { return m.job_title || ""; } },
            { label: t("joinedLabel"), get: function (m) { return fmtDate(m.created_at); } }
          ];
        }
        function stamp(ext) { return "team-" + new Date().toISOString().slice(0, 10) + "." + ext; }

        /* زر تصدير واحد يسأل عن نوع الملف */
        function exportMenu(btn, run) {
          var wrap = btn.parentNode;
          var open = wrap.querySelector(".export-menu");
          if (open) { open.remove(); return; }
          var box = document.createElement("div");
          box.className = "export-menu";
          box.innerHTML = '<button type="button" data-fmt="xlsx">' + esc(t("exportXlsx")) + "</button>" +
                          '<button type="button" data-fmt="csv">' + esc(t("exportCsv")) + "</button>";
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

        $("exportMembersBtn").addEventListener("click", function () {
          var btn = this;
          exportMenu(btn, function (fmt) {
            if (fmt === "csv") { app.exportCsv(stamp("csv"), state.members, memberColumns()); return; }
            btn.disabled = true;
            app.exportXlsx(stamp("xlsx"), state.members, memberColumns(), t("membersTitle"))
              .catch(function () { toast(t("genericError"), "error"); })
              .then(function () { btn.disabled = false; });
          });
        });
        $("exportChatBtn").addEventListener("click", function () {
          var btn = this;
          exportMenu(btn, function (fmt) {
            var name = "chat-" + new Date().toISOString().slice(0, 10);
            btn.disabled = true;
            app.listTeamMessages(5000).then(function (rows) {
              if (fmt === "csv") { app.exportCsv(name + ".csv", rows || [], chatColumns()); return null; }
              return app.exportXlsx(name + ".xlsx", rows || [], chatColumns(), t("chatTitle"));
            }).catch(function (err) { toast(errorMessage(err), "error"); })
              .then(function () { btn.disabled = false; });
          });
        });
        $("wlBoard").addEventListener("change", onAssignChange);
        $("wlBoard").addEventListener("click", onDotClick);
        wireRasi();
        $("rasiSearch").addEventListener("input", function () { renderRasi(); });
        $("quickList").addEventListener("click", onQuickClick);
        $("quickAddForm").addEventListener("submit", onQuickAdd);
        $("quickParentBtn").addEventListener("click", onQuickParent);
        $("rasiToggle").addEventListener("click", function () {
          var wrap = $("rasiMatrixWrap");
          wrap.hidden = !wrap.hidden;
          $("rasiToggle").textContent = t(wrap.hidden ? "rasiShowMatrix" : "rasiHideMatrix");
        });
      function chatColumns() {
        return [
          { label: t("colDate"), get: function (m) { return fmtDate(m.created_at, { withTime: true }); } },
          { label: t("colFrom"), get: function (m) { return nameOf(m.author_id); } },
          { label: t("colTo"), get: function (m) { return m.to_user_id ? nameOf(m.to_user_id) : t("chatTeam"); } },
          { label: t("colMessage"), get: function (m) { return m.body; } }
        ];
      }

      /* البحث عن مستخدم مسجل ثم دعوته بنقرة */
      function renderLookup(rows) {
        var box = $("lookupResult");
        if (!rows || !rows.length) {
          box.hidden = false;
          box.innerHTML = '<p class="waitlist-msg">' + esc(t("lookupNone")) + "</p>";
          return;
        }
        var html = "";
        rows.forEach(function (r) {
          var meta = [r.email || "", r.phone || "", r.profile_number || ""].filter(Boolean).join(" · ");
          html += '<div class="user-row"><div>' +
                  "<strong>" + esc(r.full_name || r.email || "") + "</strong>" +
                  "<span>" + esc(meta) + "</span></div>" +
                  '<button type="button" class="waitlist-btn" data-invite-email="' + esc(r.email || "") + '">' +
                  esc(t("inviteBtn")) + "</button></div>";
        });
        box.hidden = false;
        box.innerHTML = html;
      }

      $("lookupBtn").addEventListener("click", function () {
        var q = String($("lookupQuery").value || "").trim();
        var btn = this;
        btn.disabled = true;
        app.findProfileForInvite(q).then(function (rows) {
          renderLookup(rows || []);
        }).catch(function () {
          renderLookup([]);
        }).finally(function () { btn.disabled = false; });
      });

      $("lookupResult").addEventListener("click", function (ev) {
        var btn = ev.target.closest("[data-invite-email]");
        if (!btn) return;
        var email = btn.dataset.inviteEmail;
        if (!email) return;
        $("inviteEmail").value = email;
        $("inviteForm").dispatchEvent(new Event("submit", { cancelable: true }));
      });

        $("inviteForm").addEventListener("submit", onInviteSubmit);
        $("copyLinkBtn").addEventListener("click", onCopyLink);

        if (!app || !app.ready) { showUnavailable(); return; }
        setStatus("loading");
        app.ready.then(function (res) {
          if (app.unavailable || (res && res.unavailable)) { showUnavailable(); return; }
          if (!app.org) { showNoOrg(); return; }
          var role = app.role();
          state.canManage = role === "owner" || role === "admin";
          return loadAll();
        }).catch(function (err) {
          state.error = err;
          render();
        });
      }

      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
      else boot();
    })();
  