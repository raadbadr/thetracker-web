/**
 * app/common.js — TheTracker shared data layer for the app pages (plain script, no modules).
 *
 * Loads after supabase-js (window.supabase) and /app.js (window.trackerAuth) and exposes
 * window.trackerApp = {
 *   ready, client, user, profile, orgs, org, role(),
 *   setCurrentOrg(orgId), createOrg(name, entityType),
 *   effectivePlan(), plans(), planLimits(), subscription(),
 *   listTrackers(), createTracker({name,color,columns}), deleteTracker(id),
 *   listItems({trackerId,status,from,to,search,limit}), countItems(), insertItems(rows),
 *   updateItem(id, patch), deleteItem(id),
 *   listImports(), createImport({tracker_id,filename,rows_count,mapping}), importsThisMonth(),
 *   listMembers(), listInvitations(), inviteMember(email, role), cancelInvitation(id),
 *   removeMember(userId), setMemberRole(userId, role),
 *   listRules(), saveRule(rule), deleteRule(id),
 *   channelLinks(), requestChannelCode(channel), setSmsPhone(phone), unlinkChannel(channel),
 *   testChannel(channel),
 *   calendarToken(), calendarUrl(), regenerateCalendarToken(),
 *   updateProfile({full_name,lang,tz}),
 *   isPlatformAdmin(), adminListOrgs(), adminActivate({org_id,plan_code,months,note}),
 *   adminContactMessages(),
 *   lang(), t(key), fmtDate(iso, {withTime}), parseExcelDate(value), toast(message, kind),
 *   escapeHtml(s), randomCode(len), unavailableMessage()
 * }
 *
 * - `ready` waits for trackerAuth.ready. No session → redirect to /login.html?next=<path>
 *   (the promise never resolves). Supabase not configured → resolves { unavailable: true }.
 * - Every Supabase result is checked for { error } and re-thrown as an Error(error.message).
 *   Plan-limit trigger errors (message contains "PLAN_LIMIT") get err.code = "PLAN_LIMIT".
 * - Table/column names follow supabase/migrations/0001_init.sql.
 */
(function () {
  "use strict";

  var LOGIN_PATH = "/login.html";
  var ORG_KEY = "tracker_org";
  var LANG_KEY = "tracker_lang";
  var TIME_ZONE = "Asia/Riyadh";
  var ITEM_COLUMNS = "id,item_number,title,category,due_at,status,assignee_id,amount,client_name,client_name_en,case_number,data,tracker_id,trackers(name),remind_before,created_at,updated_at";
  var INSERT_CHUNK = 200;

  /* Fallback strings (used only when the page has no `translations` object or lacks the key). */
  var FALLBACK = {
    ar: {
      serviceUnavailableTitle: "الخدمة قيد التجهيز",
      serviceUnavailableText: "نعمل حاليا على تجهيز الخدمة، حاول مرة أخرى لاحقا.",
      noOrg: "لا توجد شركة محددة، أنشئ شركتك أولا.",
      planLimitItems: "وصلت إلى الحد الأقصى لعدد العناصر في باقتك الحالية، رق باقتك لإضافة المزيد.",
      planLimitMembers: "وصلت إلى الحد الأقصى لعدد الأعضاء في باقتك الحالية، رق باقتك لإضافة المزيد.",
      genericError: "حدث خطأ، حاول مرة أخرى.",
      saved: "تم الحفظ.",
      deleted: "تم الحذف."
    },
    en: {
      serviceUnavailableTitle: "Service is being prepared",
      serviceUnavailableText: "We are setting up the service. Please try again later.",
      noOrg: "No company selected. Create your company first.",
      planLimitItems: "You have reached the item limit of your current plan. Upgrade to add more.",
      planLimitMembers: "You have reached the member limit of your current plan. Upgrade to add more.",
      genericError: "Something went wrong. Please try again.",
      saved: "Saved.",
      deleted: "Deleted."
    },
    fr: {
      serviceUnavailableTitle: "Service en cours de préparation",
      serviceUnavailableText: "Nous préparons le service. Veuillez réessayer plus tard.",
      noOrg: "Aucune entreprise sélectionnée. Créez d'abord votre entreprise.",
      planLimitItems: "Vous avez atteint la limite d'éléments de votre forfait actuel. Passez à un forfait supérieur pour en ajouter.",
      planLimitMembers: "Vous avez atteint la limite de membres de votre forfait actuel. Passez à un forfait supérieur pour en ajouter.",
      genericError: "Une erreur est survenue. Veuillez réessayer.",
      saved: "Enregistré.",
      deleted: "Supprimé."
    },
    ur: {
      serviceUnavailableTitle: "سروس تیار کی جا رہی ہے",
      serviceUnavailableText: "ہم سروس تیار کر رہے ہیں، براہ کرم بعد میں دوبارہ کوشش کریں۔",
      noOrg: "کوئی کمپنی منتخب نہیں، پہلے اپنی کمپنی بنائیں۔",
      planLimitItems: "آپ اپنے موجودہ پلان میں آئٹمز کی حد تک پہنچ چکے ہیں، مزید شامل کرنے کے لیے پلان اپ گریڈ کریں۔",
      planLimitMembers: "آپ اپنے موجودہ پلان میں اراکین کی حد تک پہنچ چکے ہیں، مزید شامل کرنے کے لیے پلان اپ گریڈ کریں۔",
      genericError: "کچھ غلط ہو گیا، براہ کرم دوبارہ کوشش کریں۔",
      saved: "محفوظ ہو گیا۔",
      deleted: "حذف ہو گیا۔"
    }
  };

  var app = {
    ready: null,
    client: null,
    user: null,
    profile: null,
    orgs: [],
    org: null,
    joinedOrgs: [],
    unavailable: false
  };
  window.trackerApp = app;

  /* ============================================================
   * Generic helpers
   * ============================================================ */

  function lang() {
    try {
      return localStorage.getItem(LANG_KEY) || "ar";
    } catch (e) {
      return "ar";
    }
  }

  function pageTranslations() {
    try {
      /* `translations` is a top-level const in the page's inline script. */
      return (typeof translations === "object" && translations) ? translations : null;
    } catch (e) {
      return null;
    }
  }

  function t(key) {
    var dict = pageTranslations();
    var l = lang();
    if (dict && dict[l] && dict[l][key]) return dict[l][key];
    if (dict && dict.ar && dict.ar[key]) return dict.ar[key];
    if (FALLBACK[l] && FALLBACK[l][key]) return FALLBACK[l][key];
    if (FALLBACK.ar[key]) return FALLBACK.ar[key];
    return key;
  }

  function unavailableMessage() {
    return { title: t("serviceUnavailableTitle"), text: t("serviceUnavailableText") };
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function randomCode(len) {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    var n = len || 8;
    var out = "";
    var buf = new Uint8Array(n);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(buf);
    } else {
      for (var j = 0; j < n; j++) buf[j] = Math.floor(Math.random() * 256);
    }
    for (var i = 0; i < n; i++) out += alphabet.charAt(buf[i] % alphabet.length);
    return out;
  }

  /* Eastern Arabic / Persian digits → Western digits. */
  function toWesternDigits(s) {
    return String(s).replace(/[٠-٩۰-۹]/g, function (d) {
      var c = d.charCodeAt(0);
      return String(c >= 0x06F0 ? c - 0x06F0 : c - 0x0660);
    });
  }

  /* الصيغة القياسية الواحدة لكل عرض تاريخ في المنصة، مطابقة لمعيار تطبيق
     باركينزي بالضبط (dd-MM-yyyy / HH:mm / dd-MM-yyyy HH:mm): ميلادي، 24 ساعة،
     أرقام غربية دائما، بلا اختلاف بين اللغات. المنطقة الزمنية قابلة للاختيار
     من كل مستخدم عبر الإعدادات (profile.tz)، وتوقيت الرياض هو الافتراضي فقط
     حين لا يختار المستخدم غيره. */
  function fmtDate(iso, opts) {
    if (!iso) return "";
    var d = iso instanceof Date ? iso : new Date(iso);
    if (isNaN(d.getTime())) return "";
    var withTime = !!(opts && opts.withTime);
    var timeOnly = !!(opts && opts.timeOnly);
    var userTimeZone = (app.profile && app.profile.tz) || TIME_ZONE;
    var userHour12 = !!(app.profile && app.profile.time_format === "12");
    var parts;
    try {
      parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: userTimeZone, numberingSystem: "latn",
        year: "numeric", month: "2-digit", day: "2-digit", hour: userHour12 ? "numeric" : "2-digit", minute: "2-digit", hour12: userHour12
      }).formatToParts(d);
    } catch (e) {
      var iso16 = d.toISOString().slice(0, 16).replace("T", " ");
      return timeOnly ? iso16.slice(11) : (withTime ? iso16 : iso16.slice(0, 10));
    }
    var byType = {};
    parts.forEach(function (p) { byType[p.type] = p.value; });
    var dayPeriod = String(byType.dayPeriod || "").replace(/\s/g, "").toUpperCase();
    var timePart = userHour12 ? (byType.hour + ":" + byType.minute + " " + dayPeriod) : (byType.hour + ":" + byType.minute);
    if (timeOnly) return timePart;
    var datePart = byType.day + "-" + byType.month + "-" + byType.year;
    return withTime ? (datePart + " " + timePart) : datePart;
  }

  /* المبلغ القياسي: فاصلة آلاف وخانتان عشريتان ثابتتان دائما، أرقام غربية —
     نفس formatAmountWestern في تطبيق باركينزي (en_US_POSIX، خانتان لا أكثر
     ولا أقل). لا يستخدم للعروض المصغرة (K/M) في لوحات المؤشرات؛ تلك عرض
     مكثف متعمد لمساحة ضيقة، ليست الصيغة القياسية للمبلغ الدقيق. */
  function fmtAmount(n) {
    var v = Number(n);
    if (!isFinite(v)) v = 0;
    try {
      return new Intl.NumberFormat("en-US", { numberingSystem: "latn", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
    } catch (e) {
      return v.toFixed(2);
    }
  }

  /* Wall-clock components → Date in the browser's local time zone; returns ISO or null. */
  function fromWall(y, m, d, h, mi, s) {
    if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
    var dt = new Date(y, m - 1, d, h || 0, mi || 0, s || 0, 0);
    if (isNaN(dt.getTime()) || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return dt.toISOString();
  }

  function fromExcelSerial(n) {
    if (!(n > 0 && n < 2958466)) return null;                 /* 1900-01-01 .. 9999-12-31 */
    var ms = Math.round((n - 25569) * 86400000);              /* 25569 = days from 1899-12-30 to 1970-01-01 */
    var u = new Date(ms);                                     /* components read in UTC = sheet wall clock */
    return fromWall(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate(),
                    u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
  }

  function parseExcelDate(value) {
    if (value === null || value === undefined || value === "") return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString();
    if (typeof value === "number") return fromExcelSerial(value);

    var s = toWesternDigits(String(value)).trim();
    if (!s) return null;
    var m;

    /* Pure number as text → Excel serial. */
    if (/^\d+(\.\d+)?$/.test(s) && s.length <= 7) return fromExcelSerial(parseFloat(s));

    /* ISO with explicit time zone (Z or ±hh:mm) → trust the engine. */
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
      var z = new Date(s);
      return isNaN(z.getTime()) ? null : z.toISOString();
    }

    /* yyyy-mm-dd / yyyy/mm/dd [hh:mm[:ss]] as local wall clock. */
    m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) return fromWall(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));

    /* dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy [hh:mm[:ss]] [AM|PM] */
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/);
    if (m) {
      var y = +m[3];
      if (m[3].length <= 2) y += 2000;
      var h = +(m[4] || 0);
      var ap = (m[7] || "").toUpperCase();
      if (ap === "PM" && h < 12) h += 12;
      if (ap === "AM" && h === 12) h = 0;
      return fromWall(y, +m[2], +m[1], h, +(m[5] || 0), +(m[6] || 0));
    }

    var fallback = new Date(s);
    return isNaN(fallback.getTime()) ? null : fallback.toISOString();
  }

  /* ---------- toast (glass panel + .waitlist-msg, styles injected once) ---------- */

  var toastTimer = null;

  function ensureToastStyles() {
    if (document.getElementById("trackerToastStyles")) return;
    var style = document.createElement("style");
    style.id = "trackerToastStyles";
    style.textContent =
      /* .waitlist-msg — copied verbatim from index.html / login.html */
      ".waitlist-msg { margin-top: 0.5rem; font-size: 0.85rem; }\n" +
      ".waitlist-msg.success { color: var(--success); }\n" +
      ".waitlist-msg.error { color: var(--error); }\n" +
      /* glass panel — background/border/radius/shadow/transition copied from header.css .menu-dropdown */
      ".tracker-toast {\n" +
      "  position: fixed;\n" +
      "  bottom: 1.5rem;\n" +
      "  left: 50%;\n" +
      "  z-index: 2000;\n" +
      "  min-width: 240px;\n" +
      "  width: max-content;\n" +
      "  max-width: calc(100vw - 2rem);\n" +
      "  padding: 0.75rem 1.25rem;\n" +
      "  color: var(--text-primary);\n" +
      "  background: var(--glass-strong);\n" +
      "  backdrop-filter: blur(30px) saturate(180%);\n" +
      "  -webkit-backdrop-filter: blur(30px) saturate(180%);\n" +
      "  border: 1.5px solid var(--glass-border);\n" +
      "  border-radius: 14px;\n" +
      "  box-shadow: 0 8px 24px var(--shadow-dark), 0 3px 8px rgba(0,0,0,0.08), inset 0 0 0 1px rgba(255,255,255,0.1);\n" +
      "  opacity: 0;\n" +
      "  visibility: hidden;\n" +
      "  transform: translate(-50%, 10px) scale(0.96);\n" +
      "  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);\n" +
      "  overflow: hidden;\n" +
      "}\n" +
      ".tracker-toast.show { opacity: 1; visibility: visible; transform: translate(-50%, 0) scale(1); }\n" +
      ".tracker-toast .waitlist-msg { margin: 0; text-align: center; }\n";
    document.head.appendChild(style);
  }

  function toast(message, kind) {
    ensureToastStyles();
    var el = document.getElementById("trackerToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "trackerToast";
      el.className = "tracker-toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      var p = document.createElement("p");
      p.className = "waitlist-msg";
      el.appendChild(p);
      document.body.appendChild(el);
    }
    var msg = el.firstChild;
    msg.textContent = String(message || "");
    msg.className = "waitlist-msg" + (kind ? " " + kind : "");
    if (toastTimer) clearTimeout(toastTimer);
    el.classList.remove("show");
    /* Force a reflow so the transition replays when the same toast is reused. */
    void el.offsetWidth;
    el.classList.add("show");
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 3500);
  }

  /* ============================================================
   * Supabase plumbing
   * ============================================================ */

  function sbError(error) {
    var message = (error && error.message) ? String(error.message) : String(error || "unknown error");
    var err = new Error(message);
    if (error && error.code) err.sbCode = error.code;
    if (message.indexOf("PLAN_LIMIT") !== -1) {
      err.code = "PLAN_LIMIT";
      err.limit = message.indexOf("PLAN_LIMIT_MEMBERS") !== -1 ? "members" : "items";
    }
    return err;
  }

  /* Checks a supabase-js result; throws on error, returns data. */
  function unwrap(result) {
    if (result && result.error) throw sbError(result.error);
    return result ? result.data : null;
  }

  /* Like unwrap but also returns the count of a { count: "exact" } query. */
  function unwrapCount(result) {
    if (result && result.error) throw sbError(result.error);
    return (result && typeof result.count === "number") ? result.count : 0;
  }

  function requireClient() {
    if (!app.client) {
      var err = new Error("Service unavailable");
      err.code = "unavailable";
      throw err;
    }
    return app.client;
  }

  function requireOrg() {
    if (!app.org || !app.org.id) {
      var err = new Error(t("noOrg"));
      err.code = "NO_ORG";
      throw err;
    }
    return app.org.id;
  }

  /* Runs fn() after `ready`, inside a promise so thrown errors become rejections. */
  function run(fn) {
    return app.ready.then(function () { return fn(requireClient()); });
  }

  function startOfMonthIso() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).toISOString();
  }

  function addMonths(date, months) {
    var d = new Date(date.getTime());
    d.setMonth(d.getMonth() + months);
    return d;
  }

  /* ============================================================
   * Boot: session → profile → organizations → current org
   * ============================================================ */

  function redirectToLogin() {
    var next = window.location.pathname + (window.location.search || "");
    window.location.href = LOGIN_PATH + "?next=" + encodeURIComponent(next);
    return new Promise(function () { /* never resolves: the page is navigating away */ });
  }

  function loadProfile(client, user) {
    return client.from("profiles").select("*").eq("id", user.id).maybeSingle()
      .then(unwrap)
      .then(function (row) {
        if (row) return row;
        var meta = user.user_metadata || {};
        var fallbackName = meta.full_name || meta.name || String(user.email || "").split("@")[0] || null;
        var draft = { id: user.id, full_name: fallbackName, email: user.email || null, phone: user.phone || null };
        return client.from("profiles").upsert(draft, { onConflict: "id" }).select("*").single()
          .then(unwrap)
          .catch(function (err) {
            /* RLS may forbid the insert (the auth trigger normally creates the row); keep going. */
            if (window.console) console.warn("trackerApp: profile upsert failed:", err.message);
            return { id: user.id, full_name: fallbackName, full_name_en: null, email: user.email || null, phone: user.phone || null,
                     lang: lang(), tz: TIME_ZONE, time_format: "24", is_platform_admin: false };
          });
      });
  }

  function loadOrgs(client, user) {
    /* كل جهة هو عضو نشط فيها: التي يملكها والتي دعي إليها سواء، ومعها نوعها */
    return client.from("org_members")
      .select("org_id, role, status, organizations(id,name,name_en,plan_code,plan_expires_at,org_profiles(entity_type))")
      .eq("user_id", user.id)
      .eq("status", "active")
      .then(unwrap)
      .then(function (rows) {
        return (rows || []).filter(function (r) { return r.organizations; }).map(function (r) {
          var o = r.organizations;
          var prof = o.org_profiles;
          if (Array.isArray(prof)) prof = prof[0];
          return { id: o.id, name: o.name, name_en: o.name_en || null, plan_code: o.plan_code, plan_expires_at: o.plan_expires_at,
                   role: r.role, entity_type: (prof && prof.entity_type) || null };
        });
      })
      .catch(function () {
        /* لو تعذر ضم بطاقة الجهة لا نفقد قائمة الحسابات */
        return client.from("org_members")
          .select("org_id, role, status, organizations(id,name,name_en,plan_code,plan_expires_at)")
          .eq("user_id", user.id).eq("status", "active").then(unwrap)
          .then(function (rows) {
            return (rows || []).filter(function (r) { return r.organizations; }).map(function (r) {
              var o = r.organizations;
              return { id: o.id, name: o.name, name_en: o.name_en || null, plan_code: o.plan_code, plan_expires_at: o.plan_expires_at, role: r.role, entity_type: null };
            });
          });
      });
  }

  /* الدعوة تصل صاحبها عند أول فتح للتطبيق: القاعدة تدخله في الشركة وتختم الدعوة،
     وتعيد الشركات التي انضم إليها الآن ليراها في إشعار بدل انضمام صامت. */
  function acceptInvitations(client) {
    return client.rpc("accept_my_invitations").then(unwrap)
      .then(function (rows) { return Array.isArray(rows) ? rows : []; })
      .catch(function (err) {
        if (window.console) console.warn("trackerApp: accepting invitations failed:", err.message);
        return [];
      });
  }

  function pickOrg(orgs) {
    if (!orgs.length) return null;
    var saved = null;
    try { saved = localStorage.getItem(ORG_KEY); } catch (e) { /* storage blocked */ }
    for (var i = 0; i < orgs.length; i++) if (orgs[i].id === saved) return orgs[i];
    return orgs[0];
  }

  /* لا صفحة تبقى على «جاري التحميل» بلا سبب معروف: كل مرحلة من الإقلاع مسجلة،
     وأي فشل أو بطء يُبلَّغ إلى سجل الخادم (/api/client-error) بلا أي بيانات شخصية، وتظهر للمستخدم بطاقة «غير متاح». */
  var initStep = "start";
  function reportClientError(kind, detail) {
    try {
      var body = JSON.stringify({ kind: kind, detail: String(detail || "").slice(0, 400), step: initStep,
        page: String(window.location.pathname || "").slice(0, 80), ua: String(navigator.userAgent || "").slice(0, 100), lang: lang(),
        w: window.innerWidth, sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller) });
      if (navigator.sendBeacon) navigator.sendBeacon("/api/client-error", body);
      else fetch("/api/client-error", { method: "POST", body: body, keepalive: true });
    } catch (e) { /* ignore */ }
  }
  var reported = 0;
  window.addEventListener("error", function (ev) { if (reported++ < 3) reportClientError("window_error", (ev && ev.message) + " @" + (ev && ev.filename ? String(ev.filename).split("/").pop() + ":" + ev.lineno : "")); });
  window.addEventListener("unhandledrejection", function (ev) { var r = ev && ev.reason; if (reported++ < 3) reportClientError("unhandled_rejection", r && (r.message || r.code || JSON.stringify(r)) || r); });

  function init() {
    var auth = window.trackerAuth;
    if (!auth || !auth.ready) {
      app.unavailable = true;
      reportClientError("no_auth_module", "trackerAuth missing");
      return Promise.resolve({ unavailable: true });
    }
    setTimeout(function () { if (initStep !== "done" && initStep !== "redirect") reportClientError("init_slow", "15s and still at " + initStep); }, 15000);
    return auth.ready.then(function () {
      if (auth.unavailable || !auth.client) {
        app.unavailable = true;
        reportClientError("auth_unavailable", "");
        return { unavailable: true };
      }
      app.client = auth.client;
      initStep = "session";
      return auth.getSession().then(function (session) {
        if (!session || !session.user) { initStep = "redirect"; return redirectToLogin(); }
        app.user = session.user;
        initStep = "profile";
        return loadProfile(app.client, app.user).then(function (profile) {
          app.profile = profile;
          /* لغة الملف الشخصي هي المرجع: واجهة واحدة بلغة واحدة على كل جهاز (لا «Account» وسط صفحة عربية) */
          try {
            var wanted = profile && profile.lang;
            if (wanted && ["ar", "en", "fr", "ur"].indexOf(wanted) !== -1 && wanted !== lang()) {
              localStorage.setItem(LANG_KEY, wanted);
              if (typeof window.setLang === "function") window.setLang(wanted);
            }
          } catch (e) { /* ignore */ }
          initStep = "invitations";
          return acceptInvitations(app.client);
        }).then(function (joined) {
          app.joinedOrgs = joined;
          initStep = "orgs";
          return loadOrgs(app.client, app.user);
        }).then(function (orgs) {
          app.orgs = orgs;
          app.org = pickOrg(orgs);
          try { if (app.org) localStorage.setItem(ORG_KEY, app.org.id); } catch (e) { /* ignore */ }
          initStep = "services";
          return loadServices(app.client, app.org);
        }).then(function (services) {
          app.services = services; /* null = غير معروف (لا تصفية)، مصفوفة = المسموح فقط */
          initStep = "done";
          return { user: app.user, profile: app.profile, orgs: app.orgs, org: app.org, services: app.services };
        });
      });
    }).catch(function (err) {
      /* فشل الإقلاع لا يُترك صامتا: يُبلَّغ ويُعرض بدل صفحة تحميل أبدية */
      var detail = err && (err.message || err.code || err.error_description) || String(err);
      reportClientError("init_failed", detail);
      if (window.console) console.error("trackerApp init failed at", initStep, err);
      app.unavailable = true;
      app.initError = detail;
      return { unavailable: true, error: detail, step: initStep };
    });
  }

  app.ready = init();

  /* ------------------------------------------------------------
   * حارس الرسم: لا ارتعاش ولا ظهور من الأسفل. الصفحة تبقى على بطاقة التحميل وحدها
   * حتى تصل بياناتها ويهدأ رسمها، ثم تظهر كاملة مرة واحدة من أعلى الصفحة.
   * (أمر المهندس رعد: «تحميل الصفحة يكتمل ويظهر من فوق، ما أبغى حركات الارتعاش»)
   * ------------------------------------------------------------ */
  var BOOT_CLASS = "app-booting";
  function bootGuardStart() {
    if (!/^\/app\//.test(String(window.location.pathname || ""))) return;
    try { if ("scrollRestoration" in history) history.scrollRestoration = "manual"; } catch (e) { /* ignore */ }
    document.documentElement.classList.add(BOOT_CLASS);
    var style = document.createElement("style");
    style.id = "appBootGuard";
    style.textContent =
      "html." + BOOT_CLASS + " .container>*:not(#loadingCard),html." + BOOT_CLASS + " #appTopbar,html." + BOOT_CLASS + " #appSidebar{visibility:hidden!important}" +
      "html." + BOOT_CLASS + " #loadingCard,html." + BOOT_CLASS + " #loadingCard[hidden]{display:block!important;visibility:visible!important}" +
      "html." + BOOT_CLASS + " *{transition:none!important;animation-duration:0s!important}";
    document.head.appendChild(style);
    /* لا تُترك الصفحة مخفية أبدا: مهما حدث تظهر بعد 8 ثوان */
    setTimeout(function () { bootGuardReveal(); }, 8000);
  }
  var revealed = false;
  function bootGuardReveal() {
    if (revealed) return;
    revealed = true;
    var finish = function () {
      document.documentElement.classList.remove(BOOT_CLASS);
      var hash = String(window.location.hash || "").slice(1);
      var target = hash ? document.getElementById(hash) : null;
      if (target && target.scrollIntoView) target.scrollIntoView({ block: "start" });
      else window.scrollTo(0, 0);
      var style = document.getElementById("appBootGuard");
      if (style) setTimeout(function () { style.remove(); }, 50);
    };
    if (window.requestAnimationFrame) requestAnimationFrame(function () { requestAnimationFrame(finish); }); else finish();
  }
  /* يهدأ الرسم = لا تغيير في الشجرة لمدة 300ms بعد جاهزية البيانات (وبحد أقصى 3 ثوان) */
  function settleThenReveal() {
    if (revealed) return;
    var timer = null;
    var done = function () { if (obs) obs.disconnect(); bootGuardReveal(); };
    var arm = function () { clearTimeout(timer); timer = setTimeout(done, 300); };
    var obs = window.MutationObserver ? new MutationObserver(arm) : null;
    if (obs) obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    arm();
    setTimeout(done, 3000);
  }
  bootGuardStart();

  /* اتجاه حقول النص يتبع لغة ما يُكتب فيها لا لغة الصفحة (أمر المهندس رعد): كل حقل نص بلا dir صريح يأخذ dir=auto؛
     المعرفات (بريد، رابط، هاتف، أرقام، تواريخ) تبقى كما حددتها صفحتها */
  var AUTO_DIR_SKIP = /^(email|url|tel|number|date|time|datetime-local|month|week|color|range|file|checkbox|radio|hidden|submit|button|reset|image|password)$/i;
  function autoDirInputs(root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll("input:not([dir]),textarea:not([dir])").forEach(function (el) {
      if (el.tagName === "INPUT" && AUTO_DIR_SKIP.test(el.getAttribute("type") || "text")) return;
      if (el.getAttribute("inputmode") === "numeric" || el.getAttribute("inputmode") === "decimal") { el.setAttribute("dir", "ltr"); return; }
      el.setAttribute("dir", "auto");
    });
  }
  if (/^\/app\//.test(String(window.location.pathname || ""))) {
    var autoDirTimer = null;
    var scheduleAutoDir = function () { clearTimeout(autoDirTimer); autoDirTimer = setTimeout(function () { autoDirInputs(document); }, 60); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleAutoDir); else scheduleAutoDir();
    if (window.MutationObserver) new MutationObserver(scheduleAutoDir).observe(document.documentElement, { childList: true, subtree: true });
  }
  app.autoDirInputs = autoDirInputs;
  app.ready.then(function (res) {
    if (!res || res.unavailable) { bootGuardReveal(); return; }
    settleThenReveal();
  }, function () { bootGuardReveal(); });

  /* ============================================================
   * Organizations & plans
   * ============================================================ */

  function role() {
    return app.org ? (app.org.role || null) : null;
  }

  function setCurrentOrg(orgId) {
    try { localStorage.setItem(ORG_KEY, orgId); } catch (e) { /* ignore */ }
    window.location.reload();
  }

  /* لا جهة بلا مستندها الرسمي: الدالة create_org_registered في القاعدة هي الطريق الوحيد،
     تتحقق من الرقم (سجل تجاري / رخصة / هوية بحسب النوع) وتاريخ الانتهاء وتسجله مستندا أولا. */
  function createOrg(name, entityType, regNumber, regExpiry, nameEn) {
    return run(function (client) {
      var clean = String(name || "").trim();
      var cleanEn = String(nameEn || "").trim();
      if (!clean && !cleanEn) throw new Error("name required");
      var type = entityTypeValue(entityType);
      return client.rpc("create_org_registered", { p_name: clean, p_entity_type: type, p_reg_number: String(regNumber || "").trim(), p_reg_expiry: regExpiry || null, p_name_en: cleanEn || null })
        .then(unwrap)
        .then(function (org) {
          org.role = "owner";
          app.orgs.push(org);
          app.org = org;
          try { localStorage.setItem(ORG_KEY, org.id); } catch (e) { /* ignore */ }
          return org;
        });
    });
  }

  /* رقم المستند الرسمي بحسب نوع الجهة (نفس قواعد القاعدة) */
  function registrationRule(entityType) {
    var type = entityTypeValue(entityType);
    /* السجل التجاري للشركات والمؤسسات: الرقم الوطني الموحد، 10 أرقام تبدأ بـ 7 (سلسلة 700…؛ سجل المهندس رعد نفسه 705…) */
    if (type === "company" || type === "establishment") return { kind: "commercial_register", pattern: /^7[0-9]{9}$/ };
    if (type === "individual") return { kind: "id_document", pattern: /^[12][0-9]{9}$/ };
    return { kind: "license", pattern: /^[A-Za-z0-9\-\/]{4,30}$/ };
  }

  /* ---------- المرفقات (PDF / Word / صور) وروابط جوجل درايف ---------- */

  var ATTACH_BUCKET = "attachments";

  /* كل ما يخص رقم قضية واحد: عناصره وعدد مرفقاته */
  /* الخط الزمني للإنجازات */
  function activityFeed(limit) {
    return run(function (client) {
      var orgId = requireOrg();
      return client.rpc("activity_feed", { p_org: orgId, p_limit: Number(limit) || 30 }).then(unwrap);
    });
  }

  function achievements() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.rpc("achievements", { p_org: orgId }).then(unwrap).then(function (rows) {
        return (rows && rows[0]) || null;
      });
    });
  }

  /* ---------- بطاقة المنشأة وأوراقها الرسمية (نواة مشتركة لكل قطاع) ---------- */

  /* من يستعمل المنصة: منشأة تجارية أو شخص يرتب أوراقه. نفس القيم في القاعدة. */
  var ENTITY_TYPES = [
    { value: "company",       ar: "شركة",                     en: "Company",             fr: "Société",             ur: "کمپنی" },
    { value: "establishment", ar: "مؤسسة",                    en: "Establishment",       fr: "Établissement",       ur: "ادارہ" },
    { value: "freelance",     ar: "وثيقة عمل حر",             en: "Freelance permit",    fr: "Travail indépendant", ur: "فری لانس اجازت" },
    { value: "individual",    ar: "شخص",                      en: "Individual",          fr: "Particulier",         ur: "انفرادی" },
    { value: "nonprofit",     ar: "جمعية أو منظمة غير ربحية", en: "Nonprofit",           fr: "Association",         ur: "غیر منافع بخش" },
    { value: "government",    ar: "جهة حكومية",               en: "Government body",     fr: "Entité publique",     ur: "سرکاری ادارہ" }
  ];

  function entityTypeValue(v) {
    var wanted = String(v || "").trim();
    for (var i = 0; i < ENTITY_TYPES.length; i++) if (ENTITY_TYPES[i].value === wanted) return wanted;
    return "company";
  }

  function entityLabel(v) {
    var row = null, wanted = entityTypeValue(v);
    ENTITY_TYPES.forEach(function (t) { if (t.value === wanted) row = t; });
    return row ? (row[lang()] || row.ar) : "";
  }

  /* الشخص يسجل باسمه، والمنشأة باسمها: نص واحد لا يصلح للاثنين. */
  function isPersonType(v) { return entityTypeValue(v) === "individual"; }

  var ORG_PROFILE_FIELDS = ["entity_type", "legal_name", "cr_number", "vat_number", "unified_number",
    "license_number", "national_address", "phone", "email", "website", "iban", "bank_name", "account_name", "notes"];

  /* الأقسام: المالك/المشرف/الإدارة يرون كل شيء؛ الباقون بحسب خريطة department_services في القاعدة */
  var DEPARTMENTS = [
    { value: "management", ar: "الإدارة",           en: "Management", fr: "Direction",              ur: "انتظامیہ" },
    { value: "legal",      ar: "القسم القانوني",     en: "Legal",      fr: "Juridique",              ur: "قانونی شعبہ" },
    { value: "hr",         ar: "الموارد البشرية",    en: "HR",         fr: "Ressources humaines",    ur: "انسانی وسائل" },
    { value: "finance",    ar: "القسم المالي",       en: "Finance",    fr: "Finance",                ur: "مالیات" },
    { value: "operations", ar: "التشغيل",            en: "Operations", fr: "Opérations",             ur: "آپریشنز" },
    { value: "other",      ar: "أخرى",               en: "Other",      fr: "Autre",                  ur: "دیگر" }
  ];
  function departments() { return DEPARTMENTS.slice(); }
  function departmentLabel(v) {
    var row = null; DEPARTMENTS.forEach(function (d) { if (d.value === String(v || "")) row = d; });
    return row ? (row[lang()] || row.ar) : "";
  }

  /* خدمات المستخدم في الشركة الحالية — من القاعدة، لا من الواجهة */
  function loadServices(client, org) {
    if (!org) return Promise.resolve(null);
    return client.rpc("my_services", { p_org: org.id }).then(unwrap)
      /* مصفوفة فارغة تعني أن عضويته لم تقرأ (شركة حذفت، أو معرف قديم في المتصفح):
         لا نخفي القائمة كلها في هذه الحال، فالإخفاء الكامل يعطل المنصة على صاحبها. */
      .then(function (list) { return (Array.isArray(list) && list.length) ? list : null; })
      .catch(function () { return null; });
  }

  function orgProfile() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("org_profiles").select("*").eq("org_id", orgId).maybeSingle().then(unwrap);
    });
  }

  function saveOrgProfile(row) {
    return run(function (client) {
      var orgId = requireOrg();
      var r = row || {};
      var clean = { org_id: orgId, updated_by: app.user.id };
      ORG_PROFILE_FIELDS.forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(r, k)) return;
        var v = r[k];
        if (k === "national_address") clean[k] = v && typeof v === "object" ? v : {};
        else clean[k] = (v === "" || v == null) ? null : String(v).trim();
      });
      if (!clean.entity_type) clean.entity_type = "company";
      return client.from("org_profiles").upsert(clean, { onConflict: "org_id" }).select("*").single().then(unwrap);
    });
  }

  /* حالة الأوراق الرسمية: ما هو محفوظ، وما ينتهي قريبا، وما ينقص */
  function orgDocumentsStatus() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.rpc("org_documents_status", { p_org: orgId }).then(unwrap).then(function (d) {
        return d || { papers: [], extra: [] };
      });
    });
  }

  /* ---------- مكتبة الإجراءات وسجل المخاطر ---------- */

  function listProcesses() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("processes").select("*").eq("org_id", orgId).order("updated_at", { ascending: false }).then(unwrap);
    });
  }

  function saveProcess(row) {
    return run(function (client) {
      var orgId = requireOrg();
      var r = row || {};
      var clean = {
        name: String(r.name || "").trim(), area: r.area || null, description: r.description || null,
        trigger_text: r.trigger_text || null, inputs: r.inputs || null, outputs: r.outputs || null,
        frequency: r.frequency || null, owner_id: r.owner_id || null,
        steps: Array.isArray(r.steps) ? r.steps : [], status: r.status || "draft"
      };
      if (!clean.name) throw new Error("name required");
      if (r.id) return client.from("processes").update(clean).eq("id", r.id).eq("org_id", orgId).select("*").single().then(unwrap);
      clean.org_id = orgId; clean.created_by = app.user.id;
      return client.from("processes").insert(clean).select("*").single().then(unwrap);
    });
  }

  function deleteProcess(id) {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("processes").delete().eq("id", id).eq("org_id", orgId).then(unwrap);
    });
  }

  function listRisks() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("risks").select("*").eq("org_id", orgId).order("updated_at", { ascending: false }).then(unwrap);
    });
  }

  function saveRisk(row) {
    return run(function (client) {
      var orgId = requireOrg();
      var r = row || {};
      var n = function (v) { var x = parseInt(v, 10); return x >= 1 && x <= 5 ? x : null; };
      var clean = {
        title: String(r.title || "").trim(), category: r.category || null, client_name: r.client_name || null,
        case_number: r.case_number || null, process_id: r.process_id || null, owner_id: r.owner_id || null,
        description: r.description || null, identified_at: r.identified_at || null, review_at: r.review_at || null,
        root_cause: r.root_cause || null, consequences: r.consequences || null, existing_controls: r.existing_controls || null,
        likelihood: n(r.likelihood), impact: n(r.impact), res_likelihood: n(r.res_likelihood), res_impact: n(r.res_impact),
        strategy: r.strategy || "mitigate", status: r.status || "open",
        actions: Array.isArray(r.actions) ? r.actions : []
      };
      if (!clean.title) throw new Error("title required");
      if (r.id) return client.from("risks").update(clean).eq("id", r.id).eq("org_id", orgId).select("*").single().then(unwrap);
      clean.org_id = orgId; clean.created_by = app.user.id;
      return client.from("risks").insert(clean).select("*").single().then(unwrap);
    });
  }

  function deleteRisk(id) {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("risks").delete().eq("id", id).eq("org_id", orgId).then(unwrap);
    });
  }

  function caseBundle(caseNumber) {
    return run(function (client) {
      var orgId = requireOrg();
      return client.rpc("case_bundle", { p_org: orgId, p_case: String(caseNumber || "") }).then(unwrap);
    });
  }

  function listAttachments(itemId) {
    return run(function (client) {
      var orgId = requireOrg();
      var q = client.from("attachments").select("*").eq("org_id", orgId);
      if (itemId) q = q.eq("item_id", itemId);
      return q.order("created_at", { ascending: false }).then(unwrap);
    });
  }

  function uploadAttachment(itemId, file) {
    var orgId = requireOrg();
    if (!file) return Promise.reject(new Error("file required"));
    var safe = String(file.name || "file").replace(/[^\w.\- \u0600-\u06FF]/g, "_").slice(-120);
    var path = orgId + "/" + (itemId || "org") + "/" + randomCode(10).toLowerCase() + "-" + safe;
    return storeAttachment(file, { item_id: itemId || null }, path);
  }

