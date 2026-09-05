    /* الدردشة داخل صفحة الفريق */
    (function () {
      "use strict";

      var TEAM = "";                       /* معرف محادثة الفريق كله */
      var SEEN_KEY = "tracker_chat_seen";  /* آخر وقت قراءة لكل محادثة، في هذا المتصفح */
      var POLL_MS = 15000;                 /* استقصاء احتياطي إن انقطع البث الحي */

      var app = null;
      var state = { members: [], messages: [], thread: TEAM, live: false, channel: null, poll: null, seen: {} };

      function $(id) { return document.getElementById(id); }
      function lang() { try { return localStorage.getItem("tracker_lang") || "ar"; } catch (e) { return "ar"; } }
      function t(key) { var d = translations[lang()] || translations.ar; return d[key] || translations.ar[key] || key; }
      function tf(key, vars) { var s = t(key); Object.keys(vars || {}).forEach(function (k) { s = s.split("{" + k + "}").join(String(vars[k])); }); return s; }
      function esc(s) {
        if (app && typeof app.escapeHtml === "function") return app.escapeHtml(s);
        return String(s === null || s === undefined ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      }
      function show(id, on) { var el = $(id); if (el) el.hidden = !on; }
      function toast(m, k) { if (app && app.toast) app.toast(m, k); }
      function me() { return app && app.user ? app.user.id : null; }

      function memberById(id) { for (var i = 0; i < state.members.length; i++) if (state.members[i].user_id === id) return state.members[i]; return null; }
      function nameOf(id) { var m = memberById(id); if (!m) return "-"; var p = m.profiles || {}; return p.full_name || p.email || m.invited_email || "-"; }
      /* لا حروف أولى: أيقونة شخص للمحادثة الفردية وأيقونة مجموعة لمحادثة الفريق،
         والاسم الكامل مكتوب بجانبها كما هو. */
      var PERSON_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-4.42 0-8 2.24-8 5v3h16v-3c0-2.76-3.58-5-8-5z"/></svg>';
      var GROUP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11a4 4 0 100-8 4 4 0 000 8zm-8 0a4 4 0 100-8 4 4 0 000 8zm0 2c-3.33 0-6 1.79-6 4v3h12v-3c0-2.21-2.67-4-6-4zm8 0c-.83 0-1.6.12-2.3.32C15.1 14.2 16 15.5 16 17v3h6v-3c0-2.21-2.67-4-6-4z"/></svg>';

      function loadSeen() { try { state.seen = JSON.parse(localStorage.getItem(SEEN_KEY) || "{}") || {}; } catch (e) { state.seen = {}; } }
      function markSeen(thread) {
        state.seen[thread || TEAM] = new Date().toISOString();
        try { localStorage.setItem(SEEN_KEY, JSON.stringify(state.seen)); } catch (e) { /* التخزين محجوب */ }
      }

      /* أي محادثة تخص هذه الرسالة؟ الفريق كله، أو الطرف الآخر في محادثة خاصة. */
      function threadOf(msg) {
        if (!msg.to_user_id) return TEAM;
        return msg.author_id === me() ? msg.to_user_id : msg.author_id;
      }

      function unreadCount(thread) {
        var since = state.seen[thread || TEAM] || "";
        var n = 0;
        state.messages.forEach(function (m) {
          if (threadOf(m) !== thread) return;
          if (m.author_id === me()) return;
          if (!since || m.created_at > since) n++;
        });
        return n;
      }

      function lastMessage(thread) {
        var last = null;
        state.messages.forEach(function (m) { if (threadOf(m) === thread && (!last || m.created_at > last.created_at)) last = m; });
        return last;
      }

      /* ---------- المحادثات ---------- */

      function renderThreads() {
        var list = $("threadList");
        var rows = [{ id: TEAM, name: t("chatTeam"), sub: t("chatTeamHint"), star: true }];
        state.members.forEach(function (m) {
          if (m.user_id === me()) return;
          rows.push({ id: m.user_id, name: nameOf(m.user_id), sub: t("chatPrivate") });
        });
        var threadsHtml = rows.map(function (r) {
          var last = lastMessage(r.id);
          var sub = last ? (last.author_id === me() ? "" : "") + String(last.body || "").replace(/\s+/g, " ").slice(0, 60) : r.sub;
          var unread = unreadCount(r.id);
          return '<button type="button" class="chat-thread' + (state.thread === r.id ? " is-active" : "") + '" data-thread="' + esc(r.id) + '" role="listitem">' +
                   '<span class="chat-avatar">' + (r.star ? GROUP_ICON : PERSON_ICON) + "</span>" +
                   "<span><span class=\"chat-thread-name\">" + esc(r.name) + "</span><span class=\"chat-thread-sub\">" + esc(sub) + "</span></span>" +
                   (unread ? '<span class="chat-badge" aria-label="' + esc(tf("chatUnread", { n: unread })) + '">' + unread + "</span>" : "<span></span>") +
                 "</button>";
        }).join("");
        if (threadsHtml !== lastThreadsHtml) { lastThreadsHtml = threadsHtml; list.innerHTML = threadsHtml; }
      }

      function renderHead() {
        var isTeam = state.thread === TEAM;
        $("paneAvatar").innerHTML = isTeam ? GROUP_ICON : PERSON_ICON;
        $("paneName").textContent = isTeam ? t("chatTeam") : nameOf(state.thread);
        $("paneSub").textContent = isTeam ? t("chatTeamHint") : t("chatPrivate");
      }

      function dayKey(iso) { var d = new Date(iso); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
      function dayLabel(iso) {
        var d = new Date(iso), now = new Date();
        if (dayKey(iso) === dayKey(now.toISOString())) return t("chatToday");
        return app && app.fmtDate ? app.fmtDate(iso) : d.toLocaleDateString();
      }
      function timeLabel(iso) {
        return (app && app.fmtDate) ? app.fmtDate(iso, { timeOnly: true }) : "";
      }

      var lastMsgsHtml = "", lastThreadsHtml = "";

      function renderMessages() {
        var box = $("messages");
        var mine = me();
        var rows = state.messages.filter(function (m) { return threadOf(m) === state.thread; })
          .sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; });
        if (!rows.length) { box.innerHTML = '<p class="chat-empty">' + esc(t("chatEmpty")) + "</p>"; return; }
        var html = "", lastDay = "";
        var canManage = app && app.role && (app.role() === "owner" || app.role() === "admin");
        rows.forEach(function (m) {
          var dk = dayKey(m.created_at);
          if (dk !== lastDay) { html += '<div class="chat-day">' + esc(dayLabel(m.created_at)) + "</div>"; lastDay = dk; }
          var isMine = m.author_id === mine;
          var del = (isMine || canManage) ? '<button type="button" class="chat-msg-del" data-del="' + esc(m.id) + '">' + esc(t("chatDelete")) + "</button>" : "";
          html += '<div class="chat-msg ' + (isMine ? "is-mine" : "is-theirs") + '">' +
                    (!isMine && state.thread === TEAM ? '<span class="chat-msg-author">' + esc(nameOf(m.author_id)) + "</span>" : "") +
                    (m.attachments ? fileBubble(m.attachments, isMine) : '<div class="chat-bubble" data-tr>' + esc(m.body || "") + "</div>") +
                    '<div class="chat-msg-meta"><span>' + esc(timeLabel(m.created_at)) + "</span>" + del + "</div>" +
                  "</div>";
        });
        if (html === lastMsgsHtml) return;          /* لا شيء جديد: لا إعادة رسم ولا قفز */
        var atBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 40;
        lastMsgsHtml = html;
        box.innerHTML = html;
        if (app.translateNodes) app.translateNodes(box);
        if (atBottom) box.scrollTop = box.scrollHeight;
      }

      /* ---------- الملفات ---------- */
      function fmtSize(n) { n = Number(n) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : n + " B"; }
      function fileIcon(mime, name) {
        var m = String(mime || ""), n = String(name || "").toLowerCase();
        if (/^image\//.test(m)) return "🖼️";
        if (/pdf/.test(m) || /\.pdf$/.test(n)) return "📕";
        if (/sheet|excel|csv/.test(m) || /\.(xlsx|xls|csv)$/.test(n)) return "📊";
        if (/word|document/.test(m) || /\.(docx?|rtf)$/.test(n)) return "📝";
        if (/^audio\//.test(m)) return "🎙️";
        if (/^video\//.test(m)) return "🎬";
        return "📎";
      }
      function fileBubble(att, isMine) {
        var linked = att.item_id ? itemTitle(att.item_id) : "";
        return '<div class="chat-bubble chat-file"><span class="chat-file-icon">' + fileIcon(att.mime, att.name) + "</span>" +
               '<div class="chat-file-meta"><strong>' + esc(att.name || "") + "</strong><small>" + esc(fmtSize(att.size_bytes)) + (linked ? " · " + esc(linked) : "") + "</small>" +
               '<a href="#" data-file="' + esc(att.id) + '" data-path="' + esc(att.storage_path || "") + '">' + esc(t("chatDownload")) + "</a></div></div>";
      }
      function itemTitle(id) {
        var w = (window.__teamWork || []).filter(function (it) { return it.id === id; })[0];
        return w ? (w.title || "") : "";
      }
      function openFile(att) {
        if (!app || !app.attachmentUrl) return;
        var w = window.open("about:blank", "_blank");
        app.attachmentUrl(att).then(function (url) {
          if (!url) { if (w) w.close(); return; }
          if (w) w.location = url; else window.location.assign(url);
        }).catch(function () { if (w) w.close(); $("chatError").textContent = t("chatLoadError"); show("chatError", true); });
      }
      function renderFiles() {
        var box = $("chatFiles");
        if (!box || box.hidden) return;
        app.listChatFiles(state.thread === TEAM ? null : state.thread).then(function (rows) {
          if (!rows.length) { box.innerHTML = '<p class="chat-empty">' + esc(t("chatFilesEmpty")) + "</p>"; return; }
          var html = "", lastMonth = "";
          rows.forEach(function (f) {
            var mk = String(f.created_at || "").slice(0, 7);
            if (mk !== lastMonth) { html += "<h4>" + esc(monthLabel(f.created_at)) + "</h4>"; lastMonth = mk; }
            html += '<div class="chat-file-row"><span>' + fileIcon(f.mime, f.name) + '</span><span class="grow">' + esc(f.name || "") + "</span>" +
                    "<small>" + esc(fmtSize(f.size_bytes)) + " · " + esc(nameOf(f.uploaded_by)) + "</small>" +
                    '<a href="#" data-file="' + esc(f.id) + '" data-path="' + esc(f.storage_path || "") + '">' + esc(t("chatDownload")) + "</a></div>";
          });
          box.innerHTML = html;
        }).catch(function () { box.innerHTML = '<p class="chat-empty">' + esc(t("chatLoadError")) + "</p>"; });
      }
      function monthLabel(iso) {
        try { return new Date(iso).toLocaleDateString(l === "ur" ? "ur-PK" : l === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : l, { month: "long", year: "numeric" }); } catch (e) { return String(iso || "").slice(0, 7); }
      }
      var pendingFile = null;
      function pickFile(file) {
        if (!file) return;
        if (file.size > 25 * 1024 * 1024) { $("chatError").textContent = t("chatFileTooBig"); show("chatError", true); return; }
        pendingFile = file;
        $("fileBarName").textContent = file.name + " (" + fmtSize(file.size) + ")";
        var sel = $("fileLinkTo");
        var opts = (window.__teamWork || []).filter(function (it) { return it.status === "open"; }).slice(0, 200);
        sel.innerHTML = '<option value="">' + esc(t("chatFileNoLink")) + "</option>" + opts.map(function (it) {
          /* رقم الورقة نفسها لا الرقم القياسي الداخلي */
          var d = it.data || {};
          var num = String(it.case_number || d.number || d.violation_number || "").trim();
          return '<option value="' + esc(it.id) + '">' + esc(it.title || "") + (num ? " (" + esc(num) + ")" : "") + "</option>";
        }).join("");
        show("fileBar", true);
      }
      function sendFile() {
        if (!pendingFile) return;
        var btn = $("fileSendBtn"); btn.disabled = true; btn.textContent = t("chatUploading");
        var to = state.thread === TEAM ? null : state.thread;
        var itemId = $("fileLinkTo").value || null;
        app.sendTeamFile(pendingFile, to, itemId).then(function (row) {
          pendingFile = null; $("chatFile").value = ""; show("fileBar", false);
          if (row) { upsert(row); markSeen(state.thread); render(); }
          if (!$("chatFiles").hidden) renderFiles();
        }).catch(function (err) {
          $("chatError").textContent = err && err.message ? err.message : t("chatLoadError"); show("chatError", true);
        }).finally(function () { btn.disabled = false; btn.textContent = t("chatSendFile"); });
      }

      /* شيء جديد في الدردشة؟ تصعد بطاقتها إلى أعلى الصفحة. */
      function liftIfNew() {
        var card = $("chatCard"), team = $("teamCard");
        if (!card || !team || !team.parentNode) return;
        var total = 0;
        state.members.forEach(function (m) { if (m.user_id !== me()) total += unreadCount(m.user_id); });
        total += unreadCount(TEAM);
        if (total > 0 && card.nextSibling !== team) team.parentNode.insertBefore(card, team);
      }

      function render() {
        liftIfNew();
        renderThreads();
        renderHead();
        renderMessages();
        var live = $("liveDot");
        live.textContent = t(state.live ? "chatLive" : "chatOffline");
        live.classList.toggle("is-on", !!state.live);
        var input = $("chatInput");
        if (input) input.placeholder = t("chatPlaceholder");
      }
      window.__chatRender = render;

      function openThread(id) {
        state.thread = id || TEAM;
        markSeen(state.thread);
        render();
        $("chatInput").focus();
        /* تنبيهات الجرس عن هذه المحادثة تعلم مقروءة */
        if (app && app.markChatRead) app.markChatRead(state.thread === TEAM ? null : state.thread).catch(function () {});
      }

      /* ---------- البيانات ---------- */

      function load() {
        return Promise.all([app.listMembers(), app.listTeamMessages(500)]).then(function (res) {
          state.members = res[0] || [];
          state.messages = res[1] || [];
          
          show("chatCard", true);
          render();
        });
      }

      function refresh() {
        return app.listTeamMessages(500).then(function (rows) {
          state.messages = rows || [];
          render();
        }).catch(function () { /* الاستقصاء ليس حرجا */ });
      }

      function upsert(msg) {
        for (var i = 0; i < state.messages.length; i++) if (state.messages[i].id === msg.id) { state.messages[i] = msg; return; }
        state.messages.push(msg);
      }

      /* البث الحي عبر Supabase Realtime؛ وإن تعذر، استقصاء كل 15 ثانية. */
      var TYPING_TTL = 3000;
      var typingTimer = null, lastTypingSent = 0;

      function showTyping(name) {
        var el = $("typingLine");
        if (!el) return;
        el.textContent = t("chatTyping").split("{name}").join(name || "");
        el.hidden = false;
        if (typingTimer) clearTimeout(typingTimer);
        typingTimer = setTimeout(function () { el.hidden = true; }, TYPING_TTL);
      }

      function broadcastTyping() {
        if (!state.channel || !state.live) return;
        var now = Date.now();
        if (now - lastTypingSent < 1500) return;
        lastTypingSent = now;
        var meRow = state.members.filter(function (m) { return m.user_id === me(); })[0];
        var name = (meRow && meRow.profiles && (meRow.profiles.full_name || meRow.profiles.email)) || (app.profile && app.profile.full_name) || "";
        try {
          state.channel.send({ type: "broadcast", event: "typing", payload: { from: me(), to: state.thread === TEAM ? null : state.thread, name: name } });
        } catch (e) { /* غير حرج */ }
      }

      function subscribe() {
        var client = app.client;
        if (!client || typeof client.channel !== "function") { startPolling(); return; }
        var orgId = app.org.id;
        /* سياسات الخصوصية تطبق على قناة البث أيضا، فلا بد من رمز جلسة المستخدم
           وإلا وصلت الحالة "متصل" بلا أي رسالة من الطرف الآخر. */
        var setAuth = function (session) {
          try { if (session && session.access_token && client.realtime && client.realtime.setAuth) client.realtime.setAuth(session.access_token); } catch (e) { /* ignore */ }
        };
        try { client.auth.getSession().then(function (r) { setAuth(r && r.data && r.data.session); }); } catch (e) { /* ignore */ }
        try { client.auth.onAuthStateChange(function (_e, session) { setAuth(session); }); } catch (e) { /* ignore */ }
        startPolling();   /* شبكة أمان دائمة كل 15 ثانية حتى مع البث الحي */
        state.channel = client.channel("team_messages:" + orgId)
          .on("broadcast", { event: "typing" }, function (msg) {
            var p = (msg && msg.payload) || {};
            if (!p.from || p.from === me()) return;
            var mine = state.thread === TEAM ? p.to === null : (p.to === me() && p.from === state.thread);
            if (mine) showTyping(p.name);
          })
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "team_messages", filter: "org_id=eq." + orgId }, function (payload) {
            var msg = payload.new;
            if (!msg) return;
            /* الخصوصية تطبق في القاعدة، وهنا نحترمها مرة أخرى احتياطا */
            if (msg.to_user_id && msg.to_user_id !== me() && msg.author_id !== me()) return;
            upsert(msg);
            if (threadOf(msg) === state.thread) markSeen(state.thread);
            render();
          })
          .on("postgres_changes", { event: "DELETE", schema: "public", table: "team_messages", filter: "org_id=eq." + orgId }, function (payload) {
            var old = payload.old || {};
            state.messages = state.messages.filter(function (m) { return m.id !== old.id; });
            render();
          })
          .subscribe(function (status) {
            state.live = status === "SUBSCRIBED";
            render();
          });
      }

      function startPolling() { if (!state.poll) state.poll = setInterval(refresh, POLL_MS); }
      function stopPolling() { if (state.poll) { clearInterval(state.poll); state.poll = null; } }

      /* ---------- الإرسال ---------- */

      function send(ev) {
        if (ev) ev.preventDefault();
        var input = $("chatInput");
        var body = String(input.value || "").trim();
        if (!body) return;
        var btn = $("sendBtn");
        btn.disabled = true;
        var to = state.thread === TEAM ? null : state.thread;
        app.sendTeamMessage(body, to, null).then(function (row) {
          input.value = "";
          autosize(input);
          if (row) { upsert(row); markSeen(state.thread); render(); }
        }).catch(function (err) {
          $("chatError").textContent = err && err.message ? err.message : t("chatLoadError");
          show("chatError", true);
        }).finally(function () { btn.disabled = false; input.focus(); });
      }

      function autosize(el) { el.style.height = "auto"; el.style.height = Math.min(160, el.scrollHeight) + "px"; }

      function boot() {
        app = window.trackerApp || null;
        loadSeen();
        $("attachBtn").addEventListener("click", function () { $("chatFile").click(); });
        $("chatFile").addEventListener("change", function () { pickFile(this.files && this.files[0]); });
        $("fileSendBtn").addEventListener("click", sendFile);
        $("fileCancelBtn").addEventListener("click", function () { pendingFile = null; $("chatFile").value = ""; show("fileBar", false); });
        $("filesBtn").addEventListener("click", function () { var box = $("chatFiles"); box.hidden = !box.hidden; if (!box.hidden) renderFiles(); });
        document.addEventListener("click", function (ev) {
          var a = ev.target.closest("[data-file]");
          if (!a) return;
          ev.preventDefault();
          openFile({ id: a.getAttribute("data-file"), storage_path: a.getAttribute("data-path") });
        });
        $("threadList").addEventListener("click", function (ev) {
          var b = ev.target.closest("[data-thread]");
          if (b) openThread(b.getAttribute("data-thread"));
        });
        $("composeForm").addEventListener("submit", send);
        $("chatInput").addEventListener("keydown", function (ev) {
          if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); send(); }
        });
        $("chatInput").addEventListener("input", function () { autosize(this); if (this.value.trim()) broadcastTyping(); });
        (function () {
          var msgs = $("messages");
          if (msgs && !$("typingLine")) {
            var line = document.createElement("div");
            line.id = "typingLine";
            line.className = "inline-hint";
            line.hidden = true;
            msgs.parentNode.insertBefore(line, msgs.nextSibling);
          }
        })();
        $("messages").addEventListener("click", function (ev) {
          var b = ev.target.closest("[data-del]");
          if (!b) return;
          if (!window.confirm(t("chatConfirmDelete"))) return;
          var id = b.getAttribute("data-del");
          app.deleteTeamMessage(id).then(function () {
            state.messages = state.messages.filter(function (m) { return m.id !== id; });
            render();
          }).catch(function (err) { toast(err && err.message ? err.message : t("chatLoadError"), "error"); });
        });

        if (!app || !app.ready) {  return; }
        app.ready.then(function (res) {
          if (app.unavailable || (res && res.unavailable)) {  return; }
          if (!app.org) {  return; }
          try {
            var qs = new URLSearchParams(window.location.search);
            var p = qs.get("with") || qs.get("chat");
            if (p) state.thread = p;
          } catch (e) { /* ignore */ }
          return load().then(function () {
            subscribe();
            if (app.markChatRead) app.markChatRead(state.thread === TEAM ? null : state.thread).catch(function () {});
          });
        }).catch(function (err) {
          
          $("chatError").textContent = err && err.message ? err.message : t("chatLoadError");
          show("chatError", true);
          show("chatCard", true);
        });
      }

      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
      else boot();
    })();
  