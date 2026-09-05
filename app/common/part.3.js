  /* ============================================================
   * مكان عمل الفريق: توزيع الأعمال والتواصل وتوجيه المهمات
   * ============================================================ */

  /* أعمال الشركة كلها بأصحابها، ليحسب عبء كل عضو وتظهر الأعمال غير مسندة. */
  function teamWorkItems() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("items")
        .select("id,item_number,title,category,due_at,status,assignee_id,case_number,client_name,violation_number:data->>violation_number,doc_number:data->>number")
        .eq("org_id", orgId)
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(1000)
        .then(unwrap)
        .then(function (rows) { return rows || []; });
    });
  }

  /* الإسناد نفسه ينبه العضو عبر مشغل في القاعدة، فلا شيء يرسل من هنا. */
  function assignItem(itemId, userId) {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("items").update({ assignee_id: userId || null })
        .eq("org_id", orgId).eq("id", itemId).select("id,assignee_id").single().then(unwrap);
    });
  }

  function listTeamMessages(limit) {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("team_messages").select("*, attachments(id,name,mime,size_bytes,storage_path,external_url,item_id,created_at)")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(limit || 50)
        .then(unwrap)
        .then(function (rows) { return rows || []; });
    });
  }

  function sendTeamMessage(body, toUserId, itemId) {
    return run(function (client) {
      var orgId = requireOrg();
      var text = String(body || "").trim();
      if (!text) throw new Error("empty message");
      return client.from("team_messages")
        .insert({ org_id: orgId, author_id: app.user.id, to_user_id: toUserId || null,
                  item_id: itemId || null, body: text.slice(0, 2000) })
        .select("*").single().then(unwrap);
    });
  }

  /* ملف في الدردشة: مسار منظم الشركة/chat/المحادثة/السنة-الشهر/الملف، صف في attachments، ثم رسالة تشير إليه.
     itemId اختياري: يربط الملف بقضية أو مخالفة فيظهر في ملفها أيضا. */
  function sendTeamFile(file, toUserId, itemId) {
    var orgId = requireOrg();
    if (!file) return Promise.reject(new Error("file required"));
    var safe = String(file.name || "file").replace(/[^\w.\- \u0600-\u06FF]/g, "_").slice(-120);
    var thread = toUserId ? String(toUserId) : "team";
    var d = new Date(), ym = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    var path = orgId + "/chat/" + thread + "/" + ym + "/" + randomCode(10).toLowerCase() + "-" + safe;
    return storeAttachment(file, { item_id: itemId || null, channel: "chat", thread_key: thread }, path)
      .then(function (att) {
        return run(function (client) {
          return client.from("team_messages")
            .insert({ org_id: orgId, author_id: app.user.id, to_user_id: toUserId || null, item_id: itemId || null,
                      body: "📎 " + String(file.name || safe).slice(0, 180), attachment_id: att.id })
            .select("*, attachments(id,name,mime,size_bytes,storage_path,external_url,item_id,created_at)").single().then(unwrap);
        });
      });
  }

  /* ملفات محادثة بعينها (للوحة "الملفات") */
  function listChatFiles(toUserId) {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("attachments").select("id,name,mime,size_bytes,storage_path,external_url,item_id,uploaded_by,created_at")
        .eq("org_id", orgId).eq("channel", "chat").eq("thread_key", toUserId ? String(toUserId) : "team")
        .order("created_at", { ascending: false }).limit(300).then(unwrap).then(function (rows) { return rows || []; });
    });
  }

  function deleteTeamMessage(id) {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("team_messages").delete().eq("org_id", orgId).eq("id", id).then(unwrap);
    });
  }

  function removeMember(userId) {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("org_members").delete().eq("org_id", orgId).eq("user_id", userId).then(unwrap);
    });
  }

  function setMemberRole(userId, memberRole) {
    return run(function (client) {
      var orgId = requireOrg();
      var r = memberRole === "admin" ? "admin" : (memberRole === "owner" ? "owner" : "member");
      return client.from("org_members").update({ role: r }).eq("org_id", orgId).eq("user_id", userId)
        .select("*").then(unwrap);
    });
  }

  /* صفة الشخص ومسماه الوظيفي: شريك أو مدير أو موظف أو متعاقد — تخص كل منشأة */
  function setMemberPerson(userId, fields) {
    return run(function (client) {
      var orgId = requireOrg();
      var f = fields || {};
      var row = {};
      if (Object.prototype.hasOwnProperty.call(f, "job_title")) row.job_title = String(f.job_title || "").trim() || null;
      if (Object.prototype.hasOwnProperty.call(f, "person_kind")) {
        var k = String(f.person_kind || "");
        row.person_kind = ["partner", "manager", "employee", "contractor"].indexOf(k) !== -1 ? k : null;
      }
      /* القسم يحدد ما يراه العضو من خدمات (my_services في القاعدة هي الحكم) */
      if (Object.prototype.hasOwnProperty.call(f, "department")) {
        var d = String(f.department || "");
        row.department = DEPARTMENTS.some(function (x) { return x.value === d; }) ? d : null;
      }
      if (!Object.keys(row).length) return null;
      return client.from("org_members").update(row).eq("org_id", orgId).eq("user_id", userId).select("*").then(unwrap);
    });
  }

  /* ============================================================
   * Reminder rules
   * ============================================================ */

  function listRules() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("reminder_rules").select("*, trackers(name), items(title)").eq("org_id", orgId)
        .order("created_at", { ascending: false }).then(unwrap);
    });
  }

  function saveRule(rule) {
    return run(function (client) {
      var orgId = requireOrg();
      var r = rule || {};
      var row = {
        tracker_id: r.tracker_id || null,
        item_id: r.item_id || null,
        offset_minutes: Number(r.offset_minutes) || 1440,
        channels: (r.channels && r.channels.length) ? r.channels : ["telegram"],
        target: r.target === "all" ? "all" : "assignee"
      };
      if (!row.tracker_id && !row.item_id) throw new Error("tracker_id or item_id required");
      if (r.id) {
        return client.from("reminder_rules").update(row).eq("org_id", orgId).eq("id", r.id).select("*").single().then(unwrap);
      }
      row.org_id = orgId;
      return client.from("reminder_rules").insert(row).select("*").single().then(unwrap);
    });
  }

  function deleteRule(id) {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("reminder_rules").delete().eq("org_id", orgId).eq("id", id).then(unwrap);
    });
  }

  /* ============================================================
   * Notification channels
   * ============================================================ */

  function channelLinks() {
    return run(function (client) {
      return client.from("channel_links").select("*").eq("user_id", app.user.id)
        .order("channel", { ascending: true }).then(unwrap);
    });
  }

  function requestChannelCode(channel) {
    return run(function (client) {
      var code = randomCode(8);
      return client.from("channel_links")
        .upsert({ user_id: app.user.id, channel: channel, verify_code: code, external_id: null, verified_at: null },
                { onConflict: "user_id,channel" })
        .select("*").single()
        .then(unwrap)
        .then(function () { return code; });
    });
  }

  function setSmsPhone(phone) {
    return run(function (client) {
      var clean = String(phone || "").replace(/[\s\-().]/g, "");
      if (!/^\+[1-9]\d{7,14}$/.test(clean)) throw new Error("invalid phone");
      return client.from("channel_links")
        .upsert({ user_id: app.user.id, channel: "sms", external_id: clean, verify_code: null,
                  verified_at: new Date().toISOString() },
                { onConflict: "user_id,channel" })
        .select("*").single().then(unwrap);
    });
  }

  /* ربط محادثة تلغرام من زر داخل البوت: الرمز الموقع يأتي في رابط الإعدادات (?tglink=) */
  function linkTelegramByToken(token) {
    return app.ready.then(function () {
      requireClient();
      return window.trackerAuth.getSession();
    }).then(function (session) {
      var jwt = session && session.access_token;
      if (!jwt) return redirectToLogin();
      return fetch("/api/telegram/link", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + jwt },
        body: JSON.stringify({ token: token })
      }).then(function (res) {
        return res.json().catch(function () { return { error: "HTTP " + res.status }; });
      });
    });
  }

  /* ---------- مصفوفة RASI: أدوار الأعضاء على العناصر ---------- */
  function listItemRoles(itemIds) {
    return run(function (client) {
      var orgId = requireOrg();
      var q = client.from("item_roles").select("item_id,user_id,role,updated_at").eq("org_id", orgId);
      if (Array.isArray(itemIds) && itemIds.length) q = q.in("item_id", itemIds);
      return q.then(unwrap).then(function (rows) { return rows || []; });
    });
  }

  /* role: "R" | "A" | "S" | "I" | null (حذف). المعتمد A واحد لكل عنصر: يزال السابق أولا. */
  function setItemRole(itemId, userId, role) {
    return run(function (client) {
      var orgId = requireOrg();
      if (!role) {
        return client.from("item_roles").delete().eq("org_id", orgId).eq("item_id", itemId).eq("user_id", userId).then(unwrap);
      }
      var pre = role === "A"
        ? client.from("item_roles").delete().eq("org_id", orgId).eq("item_id", itemId).eq("role", "A").neq("user_id", userId).then(unwrap)
        : Promise.resolve();
      return pre.then(function () {
        return client.from("item_roles")
          .upsert({ org_id: orgId, item_id: itemId, user_id: userId, role: role, set_by: app.user.id, updated_at: new Date().toISOString() },
                  { onConflict: "item_id,user_id" })
          .select("item_id,user_id,role").single().then(unwrap);
      });
    });
  }

  /* توزيع بضغطة: mode = "R" (منفذ + مكلف، والموزع معتمد A تلقائيا) | "S" (مساند) | null (إزالة) */
  function distributeItem(itemId, userId, mode) {
    return run(function (client) {
      requireOrg();
      return client.rpc("distribute_item", { p_item: itemId, p_user: userId, p_mode: mode || "clear" }).then(unwrap);
    });
  }

  /* سطر الإدخال الذكي: النص ← نية (عنوان/نوع/موعد/عميل/رقم دعوى/اسم المنفذ) عبر ال Worker بجلسة المستخدم */
  /* ============================================================
   * إدخال سريع بلا ذكاء اصطناعي: أنماط معروفة (تاريخ، وقت، رقم قضية أو
   * مخالفة، مبلغ) تحل فورا في المتصفح. لا شبكة ولا انتظار إن كفت القواعد.
   * ============================================================ */
  var QUICK_ADD_WEEKDAYS = { "الاحد": 0, "الأحد": 0, "الاثنين": 1, "الإثنين": 1, "الثلاثاء": 2, "الاربعاء": 3, "الأربعاء": 3, "الخميس": 4, "الجمعة": 5, "السبت": 6 };
  var QUICK_ADD_KIND_PATTERNS = { violation: /مخالفة|مخالفه|غرامة|fine|violation/i, session: /جلسة|جلسه|نظر الدعوى|hearing|session|قضية|دعوى/i };
  var QUICK_ADD_TRIGGER_WORDS = /سجل|أضف|اضف|ضيف|موعد|جلسة|جلسه|نظر الدعوى|مخالفة|مخالفه|غرامة|مهمة|مهمه|deadline|hearing|session|fine|violation|appointment|add|schedule/i;
  var QUICK_ADD_NUMERIC_DATE = /\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b|\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/;

  function riyadhNow() {
    var parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
    var wallClock = {};
    parts.forEach(function (part) { wallClock[part.type] = part.value; });
    return { year: Number(wallClock.year), month: Number(wallClock.month), day: Number(wallClock.day), hour: Number(wallClock.hour), minute: Number(wallClock.minute) };
  }
  function riyadhIso(year, month, day, hour, minute) {
    var pad = function (num) { return String(num).padStart(2, "0"); };
    return year + "-" + pad(month) + "-" + pad(day) + "T" + pad(hour) + ":" + pad(minute) + ":00+03:00";
  }
  function riyadhWeekday(year, month, day) {
    /* Sunday=0..Saturday=6 بحسب توقيت الرياض، بلا التواء المنطقة الزمنية المحلية للمتصفح */
    return new Date(Date.UTC(year, month - 1, day, -3)).getUTCDay();
  }
  function addDaysInRiyadh(fromDate, daysToAdd) {
    var shifted = new Date(Date.UTC(fromDate.year, fromDate.month - 1, fromDate.day) + daysToAdd * 86400000);
    return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
  }

  /* الوقت يلتقط فقط قريبا من "الساعة" أو ملاصقا لمؤشر ص/م أو بصيغة HH:MM — أرقام
     أخرى في النص (رقم القضية مثلا) لا تخلط بوقت الجلسة أبدا */
  function timeOfDayFromMatch(hourText, minuteText, meridiemMark) {
    var hour = Number(hourText) || 0, minute = Number(minuteText) || 0;
    meridiemMark = (meridiemMark || "").toLowerCase();
    if (/^(م|مساء|مساء|pm)$/.test(meridiemMark) && hour < 12) hour += 12;
    if (/^(ص|صباحا|صباحا|am)$/.test(meridiemMark) && hour === 12) hour = 0;
    return { hour: hour, minute: minute };
  }
  function extractTimeOfDay(text, defaultHour, defaultMinute) {
    var match = text.match(/الساعة\s*(\d{1,2})(?::(\d{2}))?\s*(ص|صباحا|صباحا|م|مساء|مساء|am|pm)?/i);
    if (match) return timeOfDayFromMatch(match[1], match[2], match[3]);
    match = text.match(/\b(\d{1,2}):(\d{2})\b/);
    if (match) return timeOfDayFromMatch(match[1], match[2], null);
    match = text.match(/\b(\d{1,2})\s*(ص|صباحا|صباحا|م|مساء|مساء|am|pm)\b/i);
    if (match) return timeOfDayFromMatch(match[1], null, match[2]);
    return { hour: defaultHour, minute: defaultMinute };
  }
  function extractDueDate(text, referenceNow) {
    if (/غدا|غدا|بكرة|بكره/.test(text) && !/بعد\s*غد/.test(text)) return addDaysInRiyadh(referenceNow, 1);
    if (/بعد\s*غد/.test(text)) return addDaysInRiyadh(referenceNow, 2);
    var daysAfterMatch = text.match(/بعد\s*(\d{1,3})\s*(?:يوم|أيام|ايام)/);
    if (daysAfterMatch) return addDaysInRiyadh(referenceNow, Number(daysAfterMatch[1]));
    var numericDate = text.match(QUICK_ADD_NUMERIC_DATE);
    if (numericDate) {
      if (numericDate[1]) return { year: Number(numericDate[1]), month: Number(numericDate[2]), day: Number(numericDate[3]) };
      var fullYear = Number(numericDate[6]); if (fullYear < 100) fullYear += 2000;
      return { year: fullYear, month: Number(numericDate[5]), day: Number(numericDate[4]) };
    }
    for (var weekdayName in QUICK_ADD_WEEKDAYS) {
      if (text.indexOf(weekdayName) === -1) continue;
      var targetWeekday = QUICK_ADD_WEEKDAYS[weekdayName];
      var todayWeekday = riyadhWeekday(referenceNow.year, referenceNow.month, referenceNow.day);
      var daysUntilTarget = (targetWeekday - todayWeekday + 7) % 7;
      if (daysUntilTarget === 0) daysUntilTarget = 7;
      if (/القادم|القادمة|الجاي|الجاية|بعد اسبوع|بعد أسبوع/.test(text)) daysUntilTarget += 7;
      return addDaysInRiyadh(referenceNow, daysUntilTarget);
    }
    return null;
  }

  /* يعيد عنصرا كاملا إن وثقت القواعد من نوعه وموعده، وإلا null لتذهب للنموذج اللغوي */
  function quickParseFast(text) {
    var trimmedText = String(text || "").trim();
    if (!trimmedText || !QUICK_ADD_TRIGGER_WORDS.test(trimmedText)) return null;
    var kind = QUICK_ADD_KIND_PATTERNS.violation.test(trimmedText) ? "violation" : QUICK_ADD_KIND_PATTERNS.session.test(trimmedText) ? "session" : "task";
    var now = riyadhNow();
    var dueDate = extractDueDate(trimmedText, now);
    if (!dueDate) return null;
    var dueTime = extractTimeOfDay(trimmedText, kind === "violation" ? 23 : 9, kind === "violation" ? 59 : 0);
    var caseNumber = (trimmedText.match(/(?:دعوى|قضية|القضية|الدعوى|case)\s*(?:رقم|no\.?|#)?\s*([0-9]{2,})/i) || [])[1] || null;
    var violationNumber = (trimmedText.match(/(?:مخالفة|مخالفه)\s*(?:رقم|no\.?|#)?\s*([0-9]{2,})/i) || [])[1] || null;
    var amountMatch = trimmedText.match(/(?:مبلغ|قيمة|غرامة)[^0-9]{0,15}([0-9][0-9,\.]{1,})\s*(?:ريال|رس|sar)?/i) || trimmedText.match(/([0-9][0-9,\.]{2,})\s*(?:ريال|رس|sar)/i);
    var amount = amountMatch ? Number(String(amountMatch[1]).replace(/,/g, "")) : null;
    return {
      action: "add",
      item: {
        kind: kind, title: trimmedText.slice(0, 160),
        due_at: riyadhIso(dueDate.year, dueDate.month, dueDate.day, dueTime.hour, dueTime.minute),
        case_number: caseNumber, violation_number: violationNumber, amount: amount
      },
      fast: true
    };
  }
  app.quickParseFast = quickParseFast;

  function parseIntent(text) {
    var fast = quickParseFast(text);
    if (fast) return Promise.resolve(fast);
    return app.ready.then(function () {
      requireClient();
      return window.trackerAuth.getSession();
    }).then(function (session) {
      var jwt = session && session.access_token;
      if (!jwt) return redirectToLogin();
      return fetch("/api/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + jwt },
        body: JSON.stringify({ text: String(text || "") })
      }).then(function (res) { return res.json().catch(function () { return { action: "none" }; }); });
    });
  }

  /* إنشاء عنصر في متتبع نوعه وتوزيعه على المنفذ في خطوة واحدة */
  function quickAddItem(item, assigneeId) {
    return run(function (client) {
      var orgId = requireOrg();
      var payload = {}; for (var k in item) if (Object.prototype.hasOwnProperty.call(item, k)) payload[k] = item[k];
      payload.org_id = orgId;
      return client.rpc("quick_add_item", { p_item: payload, p_assignee: assigneeId || null }).then(unwrap);
    });
  }

  function unlinkChannel(channel) {
    return run(function (client) {
      return client.from("channel_links").delete().eq("user_id", app.user.id).eq("channel", channel).then(unwrap);
    });
  }

  function testChannel(channel) {
    return app.ready.then(function () {
      requireClient();
      return window.trackerAuth.getSession();
    }).then(function (session) {
      var token = session && session.access_token;
      if (!token) return redirectToLogin();
      return fetch("/api/notify/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ channel: channel })
      }).then(function (res) {
        return res.json().catch(function () { return { error: "HTTP " + res.status }; });
      });
    });
  }

  /* ============================================================
   * Calendar feed tokens
   * ============================================================ */

  function createCalendarToken(client, orgId) {
    return client.from("calendar_tokens").insert({ user_id: app.user.id, org_id: orgId })
      .select("token").single().then(unwrap).then(function (row) { return row.token; });
  }

  function calendarToken() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("calendar_tokens").select("token").eq("user_id", app.user.id).eq("org_id", orgId)
        .maybeSingle().then(unwrap)
        .then(function (row) { return row ? row.token : createCalendarToken(client, orgId); });
    });
  }

  function calendarUrl() {
    return calendarToken().then(function (token) {
      return window.location.origin + "/api/calendar/" + token + ".ics";
    });
  }

  function regenerateCalendarToken() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("calendar_tokens").delete().eq("user_id", app.user.id).eq("org_id", orgId)
        .then(unwrap).then(function () { return createCalendarToken(client, orgId); });
    });
  }

  /* ============================================================
   * Profile
   * ============================================================ */

  function updateProfile(patch) {
    return run(function (client) {
      var p = patch || {};
      var clean = {};
      if (p.full_name !== undefined) clean.full_name = String(p.full_name || "").trim() || null;
      if (p.full_name_en !== undefined) clean.full_name_en = String(p.full_name_en || "").trim() || null;
      if (p.phone !== undefined) {
        var cleanPhone = String(p.phone || "").trim();
        if (!cleanPhone) throw new Error("phone required");
        clean.phone = cleanPhone;
      }
      if (p.lang !== undefined) clean.lang = p.lang;
      if (p.tz !== undefined) clean.tz = p.tz;
      if (p.time_format !== undefined) clean.time_format = p.time_format === "12" ? "12" : "24";
      if (p.storage_mode !== undefined) clean.storage_mode = p.storage_mode === "drive" ? "drive" : "platform";
      return client.from("profiles").update(clean).eq("id", app.user.id).select("*").single()
        .then(unwrap)
        .then(function (row) { app.profile = row; return row; });
    });
  }

  /* ============================================================
   * Platform admin
   * ============================================================ */

  function platformAdmins() {
    return run(function (client) { return client.rpc("platform_admins_list").then(unwrap); });
  }
  function setPlatformAdmin(email, admin) {
    return run(function (client) { return client.rpc("platform_admin_set", { p_email: email, p_admin: !!admin }).then(unwrap); });
  }

  function isPlatformAdmin() {
    return !!(app.profile && app.profile.is_platform_admin);
  }

  /* ---------- طلبات الترقية (داخل الموقع، بلا بريد) ---------- */

  function requestPlan(input) {
    return run(function (client) {
      var a = input || {};
      var orgId = requireOrg();
      if (!a.plan_code) throw new Error("plan_code required");
      var row = {
        org_id: orgId,
        plan_code: a.plan_code,
        months: Number(a.months) || (a.plan_code === "yearly" ? 12 : 1),
        note: a.note || null,
        created_by: app.user.id
      };
      return client.from("plan_requests").insert(row).select("*").single().then(unwrap);
    });
  }

  function planRequests() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("plan_requests").select("*").eq("org_id", orgId)
        .order("created_at", { ascending: false }).limit(10).then(unwrap);
    });
  }

  function cancelPlanRequest(id) {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("plan_requests").update({ status: "cancelled" })
        .eq("id", id).eq("org_id", orgId).eq("status", "pending").then(unwrap);
    });
  }

  function adminPlanRequests() {
    return run(function (client) {
      return client.from("plan_requests").select("*, organizations(name)")
        .order("created_at", { ascending: false }).limit(100).then(unwrap);
    });
  }

  /* موافقة مدير المنصة: تفعيل الاشتراك ثم ختم الطلب. */
  function adminDecideRequest(req, approve) {
    if (!req || !req.id) return Promise.reject(new Error("request required"));
    var finish = function () {
      return run(function (client) {
        return client.from("plan_requests")
          .update({ status: approve ? "approved" : "rejected", decided_by: app.user.id, decided_at: new Date().toISOString() })
          .eq("id", req.id).then(unwrap);
      });
    };
    if (!approve) return finish();
    return adminActivate({ org_id: req.org_id, plan_code: req.plan_code, months: req.months, note: "من طلب داخل الموقع" })
      .then(finish);
  }

  function adminListOrgs() {
    return run(function (client) {
      return client.from("organizations").select("*, subscriptions(*)")
        .order("created_at", { ascending: false }).then(unwrap);
    });
  }

  function adminActivate(input) {
    return run(function (client) {
      var a = input || {};
      if (!a.org_id || !a.plan_code) throw new Error("org_id and plan_code required");
      var months = Number(a.months) || 0;
      var expiresAt = months > 0 ? addMonths(new Date(), months).toISOString() : null;
      var sub = {
        org_id: a.org_id,
        plan_code: a.plan_code,
        status: "active",
        expires_at: expiresAt,
        activated_by: app.user.id,
        note: a.note || null
      };
      return client.from("subscriptions").insert(sub).select("*").single().then(unwrap)
        .then(function (row) {
          return client.from("organizations")
            .update({ plan_code: a.plan_code, plan_expires_at: expiresAt })
            .eq("id", a.org_id)
            .then(unwrap)
            .then(function () { return row; });
        });
    });
  }

  function adminContactMessages() {
    return run(function (client) {
      return client.from("contact_messages").select("*").order("created_at", { ascending: false }).then(unwrap);
    });
  }

  /* سجل رسائل بوت تلغرام (RLS: مدير المنصة فقط) مع صاحب المحادثة إن كانت مربوطة */
  function adminTelegramMessages(limit) {
    return run(function (client) {
      return client.from("telegram_messages").select("*, profiles(email, full_name)")
        .order("created_at", { ascending: false }).limit(Number(limit) || 200).then(unwrap);
    });
  }

  /* ============================================================
   * Public API
   * ============================================================ */

  app.role = role;
  app.setCurrentOrg = setCurrentOrg;
  app.createOrg = createOrg;
  app.effectivePlan = effectivePlan;
  app.plans = plans;
  app.planLimits = planLimits;
  app.subscription = subscription;
  /* ============================================================
   * قائمة الخدمات الجانبية — تظهر في كل صفحات التطبيق بعد تسجيل الدخول،
   * على اليمين في العربية والأردية وعلى اليسار في الإنجليزية والفرنسية.
   * تبنى هنا مرة واحدة بدل تكرارها في خمس صفحات.
   * ============================================================ */

  var NAV_ITEMS = [
    { href: "/app/dashboard.html", path: "dashboard", service: "dashboard",
      icon: '<path d="M4 13h6V4H4v9zm0 7h6v-5H4v5zm9 0h7v-9h-7v9zm0-16v5h7V4h-7z"/>',
      labels: { ar: "لوحة التحكم", en: "Dashboard", fr: "Tableau de bord", ur: "ڈیش بورڈ" } },
    { href: "/app/dashboard.html?type=cases", path: "type=cases", service: "cases",
      icon: '<path d="M20 6h-3V4a2 2 0 00-2-2H9a2 2 0 00-2 2v2H4a2 2 0 00-2 2v11a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2zM9 4h6v2H9V4zm11 15H4V8h16v11z"/><path d="M11 10h2v7h-2z"/>',
      labels: { ar: "القضايا", en: "Cases", fr: "Affaires", ur: "مقدمات" } },
    { href: "/app/dashboard.html?type=violations", path: "type=violations", service: "violations",
      icon: '<path d="M12 2L1 21h22L12 2zm1 15h-2v-2h2v2zm0-4h-2V9h2v4z"/>',
      labels: { ar: "المخالفات", en: "Violations", fr: "Infractions", ur: "خلاف ورزیاں" } },
    { href: "/app/dashboard.html?type=expenses", path: "type=expenses", service: "expenses", iconMask: true,
      labels: { ar: "مصاريف التشغيل", en: "Expenses", fr: "Charges", ur: "اخراجات" } },
    { href: "/app/documents.html", path: "documents", service: "documents",
      icon: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13zM8 13h8v2H8v-2zm0 4h8v2H8v-2z"/>',
      labels: { ar: "المستندات", en: "Documents", fr: "Documents", ur: "دستاویزات" } },
    { href: "/app/processes.html", path: "processes", service: "processes",
      icon: '<path d="M3 5h8v4H3V5zm10 0h8v4h-8V5zM3 15h8v4H3v-4zm10 0h8v4h-8v-4zM7 9v6h2V9H7zm10 0v6h2V9h-2z"/>',
      labels: { ar: "مكتبة الإجراءات", en: "Process library", fr: "Bibliothèque des procédures", ur: "طریقہ کار لائبریری" } },
    { href: "/app/risks.html", path: "risks", service: "risks",
      icon: '<path d="M12 2L2 7v6c0 5.25 3.75 10.15 10 11.5C18.25 23.15 22 18.25 22 13V7l-10-5zm-1 6h2v6h-2V8zm0 8h2v2h-2v-2z"/>',
      labels: { ar: "إدارة المخاطر", en: "Risk management", fr: "Gestion des risques", ur: "خطرات کا انتظام" } },
    { href: "/app/team.html", path: "team", service: "team",
      icon: '<path d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>',
      labels: { ar: "الفريق", en: "Team", fr: "Équipe", ur: "ٹیم" } },
    { href: "/app/settings.html", path: "settings", service: "settings",
      icon: '<path d="M19.14 12.94a7.07 7.07 0 000-1.88l2.03-1.58a.5.5 0 00.12-.64l-1.92-3.32a.5.5 0 00-.61-.22l-2.39.96a7.03 7.03 0 00-1.62-.94l-.36-2.54a.5.5 0 00-.5-.42h-3.84a.5.5 0 00-.5.42l-.36 2.54c-.58.24-1.12.56-1.62.94l-2.39-.96a.5.5 0 00-.61.22L2.65 8.84a.5.5 0 00.12.64l2.03 1.58a7.07 7.07 0 000 1.88l-2.03 1.58a.5.5 0 00-.12.64l1.92 3.32c.13.22.39.3.61.22l2.39-.96c.5.38 1.04.7 1.62.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.58-.24 1.12-.56 1.62-.94l2.39.96c.22.08.48 0 .61-.22l1.92-3.32a.5.5 0 00-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1112 8.5a3.5 3.5 0 010 7z"/>',
      labels: { ar: "الإعدادات", en: "Settings", fr: "Paramètres", ur: "ترتیبات" } },
    { href: "/app/admin.html", path: "admin", adminOnly: true,
      icon: '<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>',
      labels: { ar: "إدارة المنصة", en: "Platform admin", fr: "Administration", ur: "پلیٹ فارم ایڈمن" } },
  ];

  var SIGN_OUT_LABELS = { ar: "تسجيل الخروج", en: "Sign out", fr: "Se déconnecter", ur: "سائن آؤٹ" };

  var SIDEBAR_CSS = [
    ".app-sidebar{position:fixed;inset-block:52px 0;inset-inline-start:0;width:240px;padding:1.5rem 1rem;",
    "display:flex;flex-direction:column;gap:.35rem;z-index:40;overflow-y:auto;background:var(--glass);",
    "-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);border-inline-end:1px solid var(--glass-border)}",
    ".app-sidebar-title{font-size:.72rem;font-weight:700;letter-spacing:.08em;opacity:.55;padding:0 .75rem .75rem;color:var(--text-secondary);text-transform:uppercase}",
    ".app-sidebar a,.app-sidebar button{display:flex;align-items:center;justify-content:flex-start;gap:.7rem;width:100%;padding:.75rem .9rem;border:0;border-radius:14px;",
    "background:transparent;color:var(--text-secondary);font:inherit;font-size:.95rem;font-weight:600;text-decoration:none;cursor:pointer;text-align:start;",
    "transition:all .25s cubic-bezier(.4,0,.2,1)}",
    ".app-sidebar a:hover,.app-sidebar button:hover{background:var(--glass-border);color:var(--text-primary)}",
    ".app-sidebar a.is-active{background:var(--primary);color:var(--btn-ink,#fff);box-shadow:0 6px 18px var(--shadow-dark)}",
    ".app-sidebar svg{width:20px;height:20px;flex:0 0 auto;fill:currentColor}",
    ".app-sidebar-spacer{flex:1 1 auto}",
    "body.has-app-sidebar .container{max-width:1400px;padding-inline-start:calc(240px + 2rem)}",
    /* ــ الجوال (≤900px): الشريط الجانبي درج ينزلق من جانب البداية، بطبقة تعتيم، ويحمل روابط القائمة العلوية واسم المستخدم ــ */
    ".app-drawer-head,.app-drawer-nav{display:none}",
    ".app-drawer-backdrop{position:fixed;inset:0;z-index:68;background:rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .25s ease}",
    "@media(max-width:900px){html body.has-app-sidebar .app-sidebar,html body.sidebar-off .app-sidebar{display:flex;position:fixed;inset-block:0;inset-inline-start:0;",
    "width:min(84vw,320px);max-width:100vw;padding:1rem 1rem calc(1rem + env(safe-area-inset-bottom));z-index:70;border-inline-end:1px solid var(--glass-border);",
    "background:var(--bg-mid,#1a2933);transform:translateX(-100%);transition:transform .3s cubic-bezier(.4,0,.2,1);box-shadow:none}",
    "html[dir=rtl] body.has-app-sidebar .app-sidebar{transform:translateX(100%)}",
    "html body.drawer-open .app-sidebar,html[dir=rtl] body.drawer-open .app-sidebar{transform:none;box-shadow:0 18px 40px var(--shadow-dark)}",
    "html body.drawer-open .app-drawer-backdrop{opacity:1;pointer-events:auto}",
    "html body.drawer-open{overflow:hidden}",
    ".app-drawer-head{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.25rem .25rem 1rem;color:var(--text-primary);font-weight:700;font-size:.95rem}",
    ".app-drawer-head a{min-width:0;white-space:normal;overflow-wrap:anywhere;color:inherit;text-decoration:none;padding:.5rem .25rem}",
    ".app-drawer-nav{display:flex;flex-direction:column;gap:.25rem;margin-bottom:.75rem;padding-bottom:.75rem;border-bottom:1px solid var(--glass-border)}",
    ".app-sidebar a,.app-sidebar button{min-height:44px;font-size:1rem}",
    "html body.has-app-sidebar .container,html body.sidebar-off.has-app-sidebar .container{max-width:100%;padding-inline:1rem}",
    /* قواعد عامة لمحتوى كل الصفحات على الجوال: لا شيء أعرض من الشاشة، الجداول تتمرر داخل نفسها، النماذج تتكدس */
    /* أي عنصر أعرض من الشاشة لا يوسع نافذة التخطيط في متصفحات الجوال (وإلا اتسع الشريط الثابت معها وانزاح) */
    "html{overflow-x:hidden}body{overflow-x:hidden;overflow-x:clip}",
    ".content{padding:1.1rem}",
    ".content table{display:block;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}",
    ".content img,.content svg,.content canvas,.content video{max-width:100%}",
    ".content .waitlist-form,.content .chat-options{flex-wrap:wrap}",
    ".content .waitlist-form{flex-direction:column;align-items:stretch}.content .waitlist-form>*{width:100%;max-width:100%;box-sizing:border-box}",
    ".content pre,.content code{white-space:pre-wrap;word-break:break-word}}",
    "@media(max-width:600px){.waitlist-input,.content select,.content textarea,.content input:not([type=checkbox]):not([type=radio]){font-size:16px}",
    ".waitlist-btn,.chat-option-btn,.app-iconbtn{min-height:44px}.app-iconbtn{min-width:44px}}",
    ":root{--gap:1.5rem}",
    /* أزرار الأفعال في صف واحد بمسافات متساوية (أمر المهندس رعد): لا هامش فرديا لأي زر، والأيقونات بحجم واحد */
    ".content .chat-options,.content .doc-actions,.content .row-actions,.content .paper-actions{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}",
    ".content .chat-options>*,.content .doc-actions>*,.content .row-actions>*,.content .paper-actions>*{margin:0!important}",
    ".content .chat-options>a:not([class]){display:inline-flex;align-items:center}",
    ".content button.icon-btn,.content a.icon-btn,.content .chat-option-btn.icon-only{width:44px;height:44px;padding:0;display:inline-flex;align-items:center;justify-content:center}",
    /* ــ تناسق عناصر الإدخال في كل صفحات التطبيق ــ
       المتصفح يفرض شكله على input[type=search] وعلى select فيخرجان بارتفاع
       واستدارة مختلفين عن بقية الحقول والأزرار. هنا يلغى ذلك مرة واحدة:
       ارتفاع واحد 42 بكسل، استدارة واحدة 12 بكسل، وسهم واحد للقوائم. */
    ":root{--field-h:42px;--field-r:12px}",
    "body .waitlist-input,body select.waitlist-input,body input.waitlist-input,body textarea.waitlist-input,",
    "body .waitlist-btn,body .chat-option-btn{-webkit-appearance:none;appearance:none;border-radius:var(--field-r)}",
    "body .waitlist-input,body .waitlist-btn,body .chat-option-btn{min-height:var(--field-h);box-sizing:border-box}",
    "body input.waitlist-input,body select.waitlist-input{height:var(--field-h);padding-block:0;line-height:normal}",
    "body textarea.waitlist-input{min-height:calc(var(--field-h) * 2);height:auto;padding-block:.6rem}",
    "body input[type=search].waitlist-input::-webkit-search-decoration,",
    "body input[type=search].waitlist-input::-webkit-search-cancel-button{-webkit-appearance:none}",
    "body input[type=date].waitlist-input,body input[type=datetime-local].waitlist-input,body input[type=month].waitlist-input{min-width:0}",
    "body input[type=date].waitlist-input::-webkit-date-and-time-value{text-align:start}",
    /* سهم القائمة: رسم واحد لكل القوائم، في نهاية السطر حسب اتجاه اللغة */
    "body select.waitlist-input{background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.6 6 6.4 11 1.6' fill='none' stroke='%238A97A3' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\");",
    "background-repeat:no-repeat;background-size:12px 8px;padding-inline-end:2.2rem}",
    "[dir=rtl] body select.waitlist-input{background-position:left .85rem center}",
    "[dir=ltr] body select.waitlist-input{background-position:right .85rem center}",
    "body select.waitlist-input::-ms-expand{display:none}",
    /* ــ زر الإغلاق الدائري (نمط تطبيق باركينزي: StandardCloseButton) ــ
       الإلغاء يصير علامة × داخل دائرة أعلى النافذة، في بداية السطر حسب اتجاه
       اللغة (يمين في العربية والأردية، يسار في الإنجليزية والفرنسية). */
    "body .close-x{width:40px;height:40px;min-height:40px;min-width:40px;padding:0;flex:0 0 40px;",
    "border-radius:50%;display:inline-flex;align-items:center;justify-content:center;",
    "background:var(--bg-top);color:var(--primary);border:1px solid var(--glass-border);",
    "box-shadow:0 2px 4px rgba(0,0,0,.2);cursor:pointer;font-size:0}",
    "body .close-x svg{width:16px;height:16px;display:block}",
    "body .close-x:hover{background:var(--glass-strong)}",
    "body .close-x.is-corner{position:absolute;top:1rem;inset-inline-start:1rem;z-index:5}",
    "body .has-close-x{position:relative}",
    "body .waitlist-form>.close-x,body .form-actions>.close-x{width:40px;max-width:40px;flex:0 0 40px}",
    /* داخل نوافذ app-gate: قاعدة الأزرار هناك تمدد كل زر بعرض النافذة، فتُخصَّص هنا: دائرة في الزاوية والعنوان في المنتصف */
    "body .app-gate-card button.close-x{width:40px;height:40px;min-height:40px;padding:0;border-radius:50%;grid-column:auto;",
    "background:var(--bg-top);color:var(--primary);border:1px solid var(--glass-border);box-shadow:0 2px 4px rgba(0,0,0,.2);",
    "position:absolute;top:1.1rem;inset-inline-start:1.1rem;z-index:5;font-weight:400}",
    "body .app-gate-card.has-close-x h2{text-align:center;padding-inline:48px;min-height:40px;display:flex;align-items:center;justify-content:center}",
    /* صف الأدوات: كل ما فيه على خط واحد بارتفاع واحد */
    "body .toolbar,body .filters-row{align-items:center}",
    "body .toolbar>*,body .filters-row>*{margin:0}",
    /* عنوان العنصر ووسمه: الوسم في سطر مستقل ولا يلتصق بالكلمة قبله */
    "body .item-title{display:block}",
    "body .item-cat{display:block;margin-top:.2rem;font-size:.78rem;color:var(--text-secondary);opacity:.85}",
    "body .cell-stack{display:flex;flex-direction:column;gap:.2rem}",
    /* رمز الريال السعودي (الطريقة نفسها في باركينزي: قناع من rial-symbol.png بلون النص) */
    ".app-sidebar-sar{display:inline-block;width:20px;height:20px;flex:0 0 20px;background-color:currentColor;",
    "-webkit-mask:url(/rial-symbol.png) center/contain no-repeat;mask:url(/rial-symbol.png) center/contain no-repeat}",
    ".sar-symbol{display:inline-block;width:.95em;height:.95em;vertical-align:-.1em;background-color:currentColor;-webkit-mask:url(/rial-symbol.png) center/contain no-repeat;mask:url(/rial-symbol.png) center/contain no-repeat;margin:0 .12em}",
    "body .content{margin-bottom:var(--gap)}",
    "body .content:last-child{margin-bottom:0}",
    "body .dash-grid,body .dash-main,body .dash-side,body .features-grid,body .ind-grid,body .svc-grid,body .ach-row,body .platform-stats-list,body .user-list,body .chat-shell{gap:var(--gap)}",
    "body .dash-main,body .dash-side{display:grid;align-content:start}",
    "body .dash-grid{margin-bottom:var(--gap)}",
    "body .stats-section,body .chart-card,body #timelineCard{margin-bottom:var(--gap)}",
    "body .dash-side .content,body .dash-main .content{margin-bottom:0}",
    "body .invite-block,body .attach-block{margin-top:var(--gap)}",
    "body .waitlist-form+.waitlist-form,body .waitlist-form+.chat-options,body .chat-options+.waitlist-form,body .waitlist-form+.platform-stat-detail,body .waitlist-form+details{margin-top:.75rem}",
    "body [hidden]{display:none!important}",
    "body .content>*+*{margin-top:.75rem}",
    "body .content>h2+*{margin-top:0}",
    "body .content>h2{margin-top:var(--gap)}",
    "body .content>h2:first-child{margin-top:0}",
    "body h2{margin-top:var(--gap)}",
    "body .content>h2:first-child,body .content>h2:first-of-type{margin-top:0}",
    "body.sidebar-off .app-sidebar{display:none}",
    "body.sidebar-off.has-app-sidebar .container{padding-inline-start:1rem}",
    /* الإيقاع العمودي داخل البطاقات — قاعدة عامة لكل صفحات التطبيق (لا إصلاحات متفرقة):
       عنوان القسم يأخذ هواء فوقه، وآخر عنصر في البطاقة لا يلتصق بحافتها، والقوائم والشبكات تفصل عما بعدها */
    ".content h3{margin:1.75rem 0 .75rem}",
    ".content h2+h3,.content h3:first-child{margin-top:.25rem}",
    /* عناوين البطاقات داخل التطبيق هادئة: لا خط تحتها ولا حجم عنوان صفحة */
    "body .content h2{font-size:1.15rem;font-weight:700;padding-bottom:0;border-bottom:0;background:none;",
    "color:var(--text-primary);-webkit-text-fill-color:currentColor;letter-spacing:0}",
    ".content>:last-child{margin-bottom:0}",
    ".content .features-grid+h3,.content .user-list+h3,.content table+h3,.content .table-wrap+h3{margin-top:2rem}",
    ".content .features-grid+p,.content .user-list+p{margin-top:1rem}",
  ].join("");

  function sidebarLabel(map) {
    var l = lang();
    return map[l] || map.ar;
  }

  var SIDEBAR_TOGGLE_LABELS = { ar: "إظهار الخدمات أو إخفاؤها", en: "Show or hide services", fr: "Afficher ou masquer les services", ur: "خدمات دکھائیں یا چھپائیں" };
  var SIDEBAR_KEY = "tracker_sidebar";

  /* القائمة الجانبية تطوى وتفتح، وتبقى على اختيار المستخدم بين الصفحات. */
  function sidebarVisible() {
    try { return localStorage.getItem(SIDEBAR_KEY) !== "off"; } catch (e) { return true; }
  }

  function applySidebarVisibility(on, remember) {
    document.body.classList.toggle("sidebar-off", !on);
    var nav = document.getElementById("appSidebar");
    if (nav) nav.setAttribute("aria-hidden", on ? "false" : "true");
    var btn = document.getElementById("topSidebarToggle");
    if (btn) btn.setAttribute("aria-expanded", on ? "true" : "false");
    if (remember) { try { localStorage.setItem(SIDEBAR_KEY, on ? "on" : "off"); } catch (e) { /* التخزين محجوب */ } }
  }

  /* الجوال: زر ☰ يفتح الدرج بدل طي الشريط، والدرج يغلق بالطبقة أو برابط أو بـ Escape أو بالعودة إلى مقاس المكتب */
  var MOBILE_SHELL = "(max-width:900px)";
  function isMobileShell() { return !!(window.matchMedia && window.matchMedia(MOBILE_SHELL).matches); }
  function setDrawer(open) {
    document.body.classList.toggle("drawer-open", !!open);
    var nav = document.getElementById("appSidebar");
    if (nav && open) nav.setAttribute("aria-hidden", "false");
    var btn = document.getElementById("topSidebarToggle");
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function topnavLinksHtml() {
    var here = String(window.location.pathname || "");
    var nav = "";
    TOPNAV.forEach(function (item) {
      if (item.service && !serviceAllowed(item.service)) return;
      var label = escapeHtml(sidebarLabel(item.labels));
      var inApp = item.href.indexOf("/app/") === 0;
      var active = inApp && here.indexOf(item.href) === 0 ? "is-active" : "";
      var target = inApp ? "" : ' target="_blank" rel="noopener"';
      nav += '<a class="' + active + '" href="' + item.href + '"' + target + ">" + label + "</a>";
    });
    return nav;
  }
  var DRAWER_CLOSE_LABELS = { ar: "إغلاق القائمة", en: "Close menu", fr: "Fermer le menu", ur: "مینو بند کریں" };
  function drawerHeadHtml() {
    return '<div class="app-drawer-head"><a href="/app/settings.html#profileCard">' + escapeHtml(userDisplayName()) + "</a>" +
      '<button type="button" class="app-iconbtn" data-drawer-close aria-label="' + escapeHtml(sidebarLabel(DRAWER_CLOSE_LABELS)) + '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.3 1.41 1.41 6.3-6.3 6.3 6.3 1.41-1.41-6.3-6.3 6.3-6.3z"/></svg></button></div>' +
      '<div class="app-drawer-nav">' + topnavLinksHtml() + "</div>";
  }

  function serviceAllowed(key) {
    if (!key || key === "dashboard") return true; /* مقصد الحارس لا يحجب */
    if (!app || !Array.isArray(app.services)) return true; /* غير معروف بعد: لا نخفي شيئا */
    return app.services.indexOf(key) !== -1;
  }

  /* الصفحة الحالية ليست من خدمات قسمه؟ إلى لوحة التحكم (المسموحة للجميع) */
  function enforceServiceAccess() {
    if (!app || !Array.isArray(app.services)) return;
    var here = String(window.location.pathname || ""), qs = String(window.location.search || "");
    var current = null;
    NAV_ITEMS.forEach(function (item) {
      if (!item.service) return;
      if (item.path.indexOf("type=") === 0) { if (qs.indexOf(item.path) !== -1) current = item.service; }
      else if (item.path !== "dashboard" && here.indexOf("/" + item.path) !== -1) current = item.service;
    });
    if (current && !serviceAllowed(current)) window.location.replace("/app/dashboard.html");
  }

  var sidebarReady = false;
  var sidebarHtml = "";

  function renderSidebar() {
    var nav = document.getElementById("appSidebar");
    if (!nav) return;
    /* القائمة بيانات: لا ترسم قبل أن تعرف خدمات الاشتراك، فلا تتغير أمام المستخدم */
    if (!sidebarReady) return;
    enforceServiceAccess();
    var here = String(window.location.pathname || "");
    var html = drawerHeadHtml() + '<div class="app-sidebar-title">' + escapeHtml(sidebarLabel({ ar: "الخدمات", en: "Services", fr: "Services", ur: "خدمات" })) + "</div>";
    NAV_ITEMS.forEach(function (item) {
      if (item.adminOnly && !nav.dataset.admin) return;
      if (!serviceAllowed(item.service)) return;
      var qs = String(window.location.search || "");
      var active = "";
      if (item.path.indexOf("type=") === 0) {
        active = qs.indexOf(item.path) !== -1 ? " is-active" : "";
      } else if (item.path === "dashboard") {
        active = here.indexOf("/dashboard") !== -1 && qs.indexOf("type=") === -1 ? " is-active" : "";
      } else {
        active = here.indexOf("/" + item.path) !== -1 ? " is-active" : "";
      }
      var glyph = item.iconMask
        ? '<span class="app-sidebar-sar" aria-hidden="true"></span>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true">' + item.icon + "</svg>";
      html += '<a class="app-sidebar-link' + active + '" href="' + item.href + '">' +
              glyph + "<span>" + escapeHtml(sidebarLabel(item.labels)) + "</span></a>";
    });
    if (html === sidebarHtml) return;
    sidebarHtml = html;
    nav.innerHTML = html;
  }

  /* ============================================================
   * زر الإغلاق الدائري — كتلة مستقلة، لا تلمس شيئا من تخطيط الصفحات.
   * كل زر إلغاء يصير × داخل دائرة كما في تطبيق باركينزي: في اللوحات
   * الكبيرة يعلو زاوية اللوحة عند بداية الاتجاه، وفي الصفوف القصيرة
   * يبقى مكانه بالشكل نفسه. الكلمة تبقى في title و aria-label.
   * ============================================================ */
  var CLOSE_X_LABEL = { ar: "إلغاء", en: "Cancel", fr: "Annuler", ur: "منسوخ" };
  /* الزر: الحاوية التي يعلو زاويتها، أو "" ليبقى في مكانه داخل الصف */
  var CLOSE_X_BUTTONS = {
    editCancelBtn: "editPanel",
    addCancelBtn: "addItemPanel",
    docCancelBtn: "docForm",
    cancelBtn: "editorCard",
    renameOrgCancel: "",
    newOrgCancel: "",
    newTrackerCancel: ""
  };
  var CLOSE_X_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
    '<path d="M3.2 3.2 12.8 12.8M12.8 3.2 3.2 12.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

  function closeXify(btn, host) {
    if (!btn || btn.classList.contains("close-x")) return;
    var word = sidebarLabel(CLOSE_X_LABEL);
    btn.removeAttribute("data-i18n");
    btn.innerHTML = CLOSE_X_SVG;
    btn.classList.add("close-x");
    btn.title = word;
    btn.setAttribute("aria-label", word);
    if (host) {
      host.classList.add("has-close-x");
      btn.classList.add("is-corner");
      host.insertBefore(btn, host.firstChild);
    }
  }

  function mountCloseX() {
    if (!/^\/app\//.test(String(window.location.pathname || ""))) return;
    Object.keys(CLOSE_X_BUTTONS).forEach(function (id) {
      var btn = document.getElementById(id);
      if (!btn) return;
      var hostId = CLOSE_X_BUTTONS[id];
      closeXify(btn, hostId ? document.getElementById(hostId) : null);
    });
  }

  function mountSidebar() {
    if (document.getElementById("appSidebar")) return;
    if (!/^\/app\//.test(String(window.location.pathname || ""))) return;
    var style = document.createElement("style");
    style.textContent = SIDEBAR_CSS;
    document.head.appendChild(style);

