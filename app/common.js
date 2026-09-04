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
  var ITEM_COLUMNS = "id,item_number,title,category,due_at,status,assignee_id,amount,client_name,case_number,data,tracker_id,trackers(name)";
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
     أرقام غربية دائماً، بلا اختلاف بين اللغات. المنطقة الزمنية قابلة للاختيار
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

  /* المبلغ القياسي: فاصلة آلاف وخانتان عشريتان ثابتتان دائماً، أرقام غربية —
     نفس formatAmountWestern في تطبيق باركينزي (en_US_POSIX، خانتان لا أكثر
     ولا أقل). لا يُستخدم للعروض المصغّرة (K/M) في لوحات المؤشرات؛ تلك عرض
     مكثّف متعمّد لمساحة ضيقة، ليست الصيغة القياسية للمبلغ الدقيق. */
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
    /* كل جهة هو عضو نشط فيها: التي يملكها والتي دُعي إليها سواء، ومعها نوعها */
    return client.from("org_members")
      .select("org_id, role, status, organizations(id,name,plan_code,plan_expires_at,org_profiles(entity_type))")
      .eq("user_id", user.id)
      .eq("status", "active")
      .then(unwrap)
      .then(function (rows) {
        return (rows || []).filter(function (r) { return r.organizations; }).map(function (r) {
          var o = r.organizations;
          var prof = o.org_profiles;
          if (Array.isArray(prof)) prof = prof[0];
          return { id: o.id, name: o.name, plan_code: o.plan_code, plan_expires_at: o.plan_expires_at,
                   role: r.role, entity_type: (prof && prof.entity_type) || null };
        });
      })
      .catch(function () {
        /* لو تعذر ضم بطاقة الجهة لا نفقد قائمة الحسابات */
        return client.from("org_members")
          .select("org_id, role, status, organizations(id,name,plan_code,plan_expires_at)")
          .eq("user_id", user.id).eq("status", "active").then(unwrap)
          .then(function (rows) {
            return (rows || []).filter(function (r) { return r.organizations; }).map(function (r) {
              var o = r.organizations;
              return { id: o.id, name: o.name, plan_code: o.plan_code, plan_expires_at: o.plan_expires_at, role: r.role, entity_type: null };
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

  function init() {
    var auth = window.trackerAuth;
    if (!auth || !auth.ready) {
      app.unavailable = true;
      return Promise.resolve({ unavailable: true });
    }
    return auth.ready.then(function () {
      if (auth.unavailable || !auth.client) {
        app.unavailable = true;
        return { unavailable: true };
      }
      app.client = auth.client;
      return auth.getSession().then(function (session) {
        if (!session || !session.user) return redirectToLogin();
        app.user = session.user;
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
          return acceptInvitations(app.client);
        }).then(function (joined) {
          app.joinedOrgs = joined;
          return loadOrgs(app.client, app.user);
        }).then(function (orgs) {
          app.orgs = orgs;
          app.org = pickOrg(orgs);
          try { if (app.org) localStorage.setItem(ORG_KEY, app.org.id); } catch (e) { /* ignore */ }
          return loadServices(app.client, app.org);
        }).then(function (services) {
          app.services = services; /* null = غير معروف (لا تصفية)، مصفوفة = المسموح فقط */
          return { user: app.user, profile: app.profile, orgs: app.orgs, org: app.org, services: app.services };
        });
      });
    });
  }

  app.ready = init();

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
     تتحقق من الرقم (سجل تجاري / رخصة / هوية بحسب النوع) وتاريخ الانتهاء وتسجّله مستنداً أولاً. */
  function createOrg(name, entityType, regNumber, regExpiry) {
    return run(function (client) {
      var clean = String(name || "").trim();
      if (!clean) throw new Error("name required");
      var type = entityTypeValue(entityType);
      return client.rpc("create_org_registered", { p_name: clean, p_entity_type: type, p_reg_number: String(regNumber || "").trim(), p_reg_expiry: regExpiry || null })
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
    if (type === "company" || type === "establishment") return { kind: "commercial_register", pattern: /^[1247][0-9]{9}$/ };
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
      /* مصفوفة فارغة تعني أن عضويته لم تُقرأ (شركة حُذفت، أو معرّف قديم في المتصفح):
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

  function addAttachmentLink(itemId, name, url) {
    return run(function (client) {
      var orgId = requireOrg();
      var clean = String(url || "").trim();
      if (!/^https?:\/\//i.test(clean)) throw new Error("invalid url");
      return client.from("attachments").insert({
        org_id: orgId,
        item_id: itemId || null,
        name: String(name || clean).slice(0, 200),
        external_url: clean,
        uploaded_by: app.user.id
      }).select("*").single().then(unwrap);
    });
  }

  /* ---------- قراءة المستندات: الورقة تُقرأ في المتصفح ثم يحللها الخادم ----------
     كل ما يمكن استخراجه من المستند يُملأ تلقائياً، والإدخال اليدوي للمراجعة فقط. */
  var PDF_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  var PDF_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  function fileToImageData(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = reject;
      r.readAsDataURL(file);
    }).then(function (dataUrl) {
      /* صور الجوال الكبيرة تفشل قراءتها: تُصغَّر إلى 1800 بكسل */
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          var MAX = 1800, w = img.width, h = img.height;
          if (w <= MAX && h <= MAX) { resolve(dataUrl); return; }
          var k = Math.min(MAX / w, MAX / h);
          var c = document.createElement("canvas");
          c.width = Math.round(w * k); c.height = Math.round(h * k);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL("image/jpeg", 0.85));
        };
        img.onerror = function () { resolve(dataUrl); };
        img.src = dataUrl;
      });
    });
  }

  function pdfRead(file) {
    return loadScriptOnce(PDF_SRC, function () { return !!window.pdfjsLib; }).then(function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
      return file.arrayBuffer();
    }).then(function (buf) {
      return window.pdfjsLib.getDocument({ data: buf }).promise;
    }).then(function (pdf) {
      var pages = Math.min(pdf.numPages, 4), chain = Promise.resolve(), text = "";
      for (var i = 1; i <= pages; i++) {
        (function (n) {
          chain = chain.then(function () { return pdf.getPage(n); })
            .then(function (page) { return page.getTextContent(); })
            .then(function (tc) { text += tc.items.map(function (it) { return it.str; }).join(" ") + "\n"; });
        })(i);
      }
      return chain.then(function () { return { text: text.trim(), pdf: pdf }; });
    });
  }

  function pdfPageImage(pdf, n) {
    return pdf.getPage(n).then(function (page) {
      var base = page.getViewport({ scale: 1 });
      var scale = Math.min(2, 1800 / Math.max(base.width, base.height));
      var vp = page.getViewport({ scale: scale });
      var c = document.createElement("canvas");
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      var ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () { return c.toDataURL("image/jpeg", 0.85); });
    });
  }

  function analyzeDocument(payload) {
    var auth = window.trackerAuth;
    var session = auth && auth.getSession ? auth.getSession() : Promise.resolve(null);
    return Promise.resolve(session).then(function (sess) {
      var headers = { "Content-Type": "application/json" };
      var jwt = sess && sess.access_token;
      if (jwt) headers.Authorization = "Bearer " + jwt;
      return fetch("/api/documents/analyze", { method: "POST", headers: headers, body: JSON.stringify(payload) });
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || "analyze_failed");
        return d.fields;
      });
    });
  }

  /* أوراقنا الرسمية تكتب تاريخها هجرياً أو ميلادياً، وحقل التاريخ القياسي
     في المتصفح ميلادي فقط. نقبل الصيغتين ونحوّل الهجري بتقويم أم القرى. */
  function hijriPartsOf(date) {
    var fmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn",
      { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric" });
    var out = {};
    fmt.formatToParts(date).forEach(function (part) {
      if (part.type === "year" || part.type === "month" || part.type === "day") out[part.type] = parseInt(part.value, 10);
    });
    return out;
  }

  function hijriToGregorianISO(year, month, day) {
    var approx = new Date(Date.UTC(622, 6, 16) + ((year - 1) * 354.367 + (month - 1) * 29.53 + (day - 1)) * 86400000);
    for (var off = -40; off <= 40; off++) {
      var candidate = new Date(approx.getTime() + off * 86400000);
      var h = hijriPartsOf(candidate);
      if (h.year === year && h.month === month && h.day === day) return candidate.toISOString().slice(0, 10);
    }
    return null;
  }

  /* يقبل 1447/05/10 و1447-05-10 و2026-12-01 و01/12/2026، ويعيد ISO ميلادياً */
  function parseAnyDate(value) {
    var text = String(value == null ? "" : value).trim();
    if (!text) return null;
    text = text.replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
               .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });
    var ymd = text.match(/^(\d{3,4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
    var dmy = text.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{3,4})$/);
    var year, month, day;
    if (ymd) { year = +ymd[1]; month = +ymd[2]; day = +ymd[3]; }
    else if (dmy) { day = +dmy[1]; month = +dmy[2]; year = +dmy[3]; }
    else return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (year >= 1300 && year < 1600) return hijriToGregorianISO(year, month, day);
    if (year < 1900 || year > 2200) return null;
    return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }

  /* التاريخ الميلادي مكتوباً بالهجري ليطمئن صاحبه أن ما فهمه النظام صحيح */
  function gregorianToHijriText(iso) {
    if (!iso) return "";
    var d = new Date(iso + "T12:00:00Z");
    if (isNaN(d.getTime())) return "";
    var h = hijriPartsOf(d);
    if (!h.year) return "";
    return h.year + "/" + String(h.month).padStart(2, "0") + "/" + String(h.day).padStart(2, "0") + " هـ";
  }

  /* ملفات PDF العربية كثيراً ما تُخرج نصاً مشوّهاً (أشكال عرض وحروف مفرّقة
     بترتيب بصري) لا يُقرأ: نكتشفه ونرسل صورة الصفحة ليقرأها نموذج الرؤية. */
  function textLooksMangled(text) {
    var value = String(text || "");
    if (/[\uFB50-\uFDFF\uFE70-\uFEFF]/.test(value)) return true;
    var singles = (value.match(/(?:^|\s)[\u0600-\u06FF](?=\s|$)/g) || []).length;
    var words = (value.match(/\S+/g) || []).length;
    return words > 10 && singles / words > 0.3;
  }

  /* يعيد حقول المستند: نوعه، الجهة التي يفتحها، الاسم، الرقم، تاريخ الانتهاء */
  function readDocumentFile(file) {
    if (!file) return Promise.reject(new Error("no_file"));
    var isPdf = /\.pdf$/i.test(file.name || "") || file.type === "application/pdf";
    if (!isPdf) return fileToImageData(file).then(function (img) { return analyzeDocument({ image: img }); });
    return pdfRead(file).then(function (r) {
      if (r.text && r.text.length >= 40 && !textLooksMangled(r.text)) return analyzeDocument({ text: r.text });
      /* PDF ممسوح ضوئياً: تُقرأ صورة صفحته الأولى */
      return pdfPageImage(r.pdf, 1).then(function (img) { return analyzeDocument({ image: img }); });
    });
  }

  /* ---------- Google Drive: اختيار ملف من درايف المستخدم وربطه بالعنصر ----------
     يعمل عبر Google Picker بصلاحية drive.file (غير حساسة): المستخدم يختار الملف
     بنفسه، ونخزن رابطه واسمه فقط؛ الملف يبقى في درايفه. */
  var DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
  var driveConfig = { clientId: null, apiKey: null };
  var driveToken = null;

  function driveAvailable() { return !!(driveConfig.clientId && driveConfig.apiKey); }

  function driveAppId() { return String(driveConfig.clientId || "").split("-")[0] || ""; }

  function loadScriptOnce(src, test) {
    return new Promise(function (resolve, reject) {
      if (test()) { resolve(); return; }
      var el = document.createElement("script");
      el.src = src; el.async = true;
      el.onload = function () { resolve(); };
      el.onerror = function () { reject(new Error("load_failed")); };
      document.head.appendChild(el);
    });
  }

  function driveAccessToken() {
    if (driveToken && driveToken.expires > Date.now()) return Promise.resolve(driveToken.token);
    return loadScriptOnce("https://accounts.google.com/gsi/client", function () { return !!(window.google && window.google.accounts && window.google.accounts.oauth2); })
      .then(function () {
        return new Promise(function (resolve, reject) {
          var tc = window.google.accounts.oauth2.initTokenClient({
            client_id: driveConfig.clientId,
            scope: DRIVE_SCOPE,
            callback: function (resp) {
              if (!resp || !resp.access_token) { reject(new Error("no_token")); return; }
              driveToken = { token: resp.access_token, expires: Date.now() + (Number(resp.expires_in) || 3000) * 1000 - 60000 };
              resolve(resp.access_token);
            },
            error_callback: function () { reject(new Error("denied")); }
          });
          tc.requestAccessToken({ prompt: driveToken ? "" : "consent" });
        });
      });
  }

  function pickFromDrive(opts) {
    var multi = !opts || opts.multi !== false;
    if (!driveAvailable()) return Promise.reject(new Error("drive_unavailable"));
    return driveAccessToken().then(function (token) {
      return loadScriptOnce("https://apis.google.com/js/api.js", function () { return !!window.gapi; })
        .then(function () { return new Promise(function (resolve) { window.gapi.load("picker", { callback: resolve }); }); })
        .then(function () {
          return new Promise(function (resolve, reject) {
            var view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
            var builder = new window.google.picker.PickerBuilder()
              .setOAuthToken(token)
              .setDeveloperKey(driveConfig.apiKey)
              .setAppId(driveAppId())
              .setLocale(lang() === "ar" || lang() === "ur" ? "ar" : lang())
              .addView(view);
            if (multi) builder.enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED);
            var picker = builder
              .setCallback(function (data) {
                if (data.action === window.google.picker.Action.PICKED) resolve(data.docs || []);
                else if (data.action === window.google.picker.Action.CANCEL) reject(new Error("cancelled"));
              })
              .build();
            picker.setVisible(true);
          });
        });
    });
  }

  /* ملف درايف المختار يُنزَّل مؤقتا في المتصفح ليقرأه المحلل، ولا يُرفع لتخزيننا.
     ملفات جوجل (مستند/جدول) تُصدَّر PDF أو XLSX لأنها لا تنزل كما هي. */
  var GOOGLE_EXPORT = {
    "application/vnd.google-apps.document": ["application/pdf", ".pdf"],
    "application/vnd.google-apps.presentation": ["application/pdf", ".pdf"],
    "application/vnd.google-apps.drawing": ["application/pdf", ".pdf"],
    "application/vnd.google-apps.spreadsheet": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"]
  };

  function driveDownload(doc) {
    if (!doc || !doc.id) return Promise.reject(new Error("no_file"));
    return driveAccessToken().then(function (token) {
      var exp = GOOGLE_EXPORT[doc.mimeType];
      var url = exp
        ? "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(doc.id) + "/export?mimeType=" + encodeURIComponent(exp[0])
        : "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(doc.id) + "?alt=media";
      return fetch(url, { headers: { Authorization: "Bearer " + token } }).then(function (r) {
        if (!r.ok) throw new Error("drive_download_" + r.status);
        return r.blob();
      }).then(function (blob) {
        var name = String(doc.name || "drive-file");
        if (exp && name.slice(-exp[1].length).toLowerCase() !== exp[1]) name += exp[1];
        try { return new File([blob], name, { type: blob.type || (exp ? exp[0] : doc.mimeType) || "application/octet-stream" }); }
        catch (e) { blob.name = name; return blob; }
      });
    });
  }

  /* يربط ملفات درايف المختارة بعنصر: صف مرفق لكل ملف برابطه (بلا رفع) */
  /* ------------------------------------------------------------
   * التخزين في Google Drive الخاص بالمستخدم (خيار؛ الافتراضي تخزين المنصة)
   * الرفع يحتاج رمز OAuth فقط (drive.file) ولا يحتاج مفتاح Picker.
   * ------------------------------------------------------------ */
  var DRIVE_API = "https://www.googleapis.com/drive/v3";
  var DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
  var DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
  var DRIVE_ROOT_NAME = "TheTracker";
  var DRIVE_FALLBACK_TEXT = {
    ar: "لم يتم الحفظ في Google Drive، فحُفظ الملف في تخزين المنصة.",
    en: "Google Drive was unavailable, so the file was saved to platform storage.",
    fr: "Google Drive indisponible : le fichier a été enregistré sur la plateforme.",
    ur: "Google Drive دستیاب نہیں تھا، فائل پلیٹ فارم اسٹوریج میں محفوظ ہو گئی۔"
  };

  function driveOAuthAvailable() { return !!driveConfig.clientId; }

  /* وضع التخزين الفعّال: درايف فقط إن اختاره المستخدم في ملفه وكان عميل جوجل مضبوطاً */
  function storageMode() {
    var mode = app.profile && app.profile.storage_mode;
    return mode === "drive" && driveOAuthAvailable() ? "drive" : "platform";
  }

  function driveFetch(token, url, opts) {
    var o = opts || {};
    var headers = Object.assign({ Authorization: "Bearer " + token }, o.headers || {});
    return fetch(url, { method: o.method || "GET", headers: headers, body: o.body }).then(function (res) {
      if (res.status === 204) return null;
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) {
          var err = new Error("drive_" + res.status);
          err.status = res.status; err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function driveEscape(v) { return String(v || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }

  function driveFindOrCreateFolder(token, name, parentId, props) {
    var q = "mimeType='" + DRIVE_FOLDER_MIME + "' and trashed=false and '" + (parentId || "root") + "' in parents";
    if (props && props.tracker_org) q += " and appProperties has { key='tracker_org' and value='" + driveEscape(props.tracker_org) + "' }";
    else q += " and name='" + driveEscape(name) + "'";
    return driveFetch(token, DRIVE_API + "/files?q=" + encodeURIComponent(q) + "&fields=files(id,name)&pageSize=1&spaces=drive")
      .then(function (data) {
        var found = data && data.files && data.files[0];
        if (found) return found.id;
        var meta = { name: name, mimeType: DRIVE_FOLDER_MIME, parents: [parentId || "root"] };
        if (props) meta.appProperties = props;
        return driveFetch(token, DRIVE_API + "/files?fields=id", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(meta)
        }).then(function (f) { return f.id; });
      });
  }

  /* مجلد «TheTracker/اسم الشركة» في درايف المستخدم، مع تخزين معرّفه محلياً */
  function driveFolderFor(token, orgId, orgName, fresh) {
    var key = "tracker_drive_folder:" + orgId;
    var cached = !fresh && localStorage.getItem(key);
    if (cached) return Promise.resolve(cached);
    return driveFindOrCreateFolder(token, DRIVE_ROOT_NAME, "root", null)
      .then(function (rootId) { return driveFindOrCreateFolder(token, orgName || "Company", rootId, { tracker_org: orgId }); })
      .then(function (id) { localStorage.setItem(key, id); return id; });
  }

  function driveUploadFile(token, file, folderId) {
    var boundary = "tracker" + randomCode(12);
    var meta = { name: file.name || "file", parents: [folderId] };
    var body = new Blob([
      "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) + "\r\n",
      "--" + boundary + "\r\nContent-Type: " + (file.type || "application/octet-stream") + "\r\n\r\n",
      file,
      "\r\n--" + boundary + "--"
    ]);
    return driveFetch(token, DRIVE_UPLOAD + "?uploadType=multipart&fields=id,name,mimeType,size,webViewLink", {
      method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body: body
    });
  }

  /* مشاركة الملف (قراءة) مع أعضاء الشركة الفعّالين — بلا رسائل بريد، وبلا إيقاف الرفع عند الفشل */
  function driveShareWithTeam(token, fileId) {
    return listMembers().then(function (members) {
      var emails = [];
      (members || []).forEach(function (m) {
        var email = m.profiles && m.profiles.email;
        if (m.status === "active" && m.user_id !== app.user.id && email && emails.indexOf(email) === -1) emails.push(email);
      });
      return emails.reduce(function (p, email) {
        return p.then(function () {
          return driveFetch(token, DRIVE_API + "/files/" + fileId + "/permissions?sendNotificationEmail=false&fields=id", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "user", role: "reader", emailAddress: email })
          }).catch(function () { return null; });
        });
      }, Promise.resolve());
    }).catch(function () { return null; });
  }

  function storeInDrive(file) {
    var orgId = requireOrg();
    var orgName = (app.org && app.org.name) || "";
    return driveAccessToken().then(function (token) {
      return driveFolderFor(token, orgId, orgName).then(function (folderId) {
        return driveUploadFile(token, file, folderId).catch(function (err) {
          if (err && err.status !== 404) throw err;
          /* المجلد المخزَّن محلياً حُذف من درايف: أعد إيجاده مرة واحدة */
          return driveFolderFor(token, orgId, orgName, true).then(function (fid) { return driveUploadFile(token, file, fid); });
        });
      }).then(function (f) {
        return driveShareWithTeam(token, f.id).then(function () {
          return { id: f.id, name: f.name || file.name, mime: f.mimeType || file.type || null,
                   size: Number(f.size) || file.size || 0, url: f.webViewLink || ("https://drive.google.com/file/d/" + f.id + "/view") };
        });
      });
    });
  }

  /* الطريق الواحد لحفظ ملف وتسجيله في attachments: درايف إن اختاره المستخدم (مع سقوط آمن إلى المنصة)، وإلا تخزين المنصة */
  function storeAttachment(file, meta, path) {
    if (!file) return Promise.reject(new Error("file required"));
    var orgId = requireOrg();
    var base = Object.assign({ org_id: orgId, uploaded_by: app.user.id }, meta || {});
    function viaPlatform() {
      return run(function (client) {
        return client.storage.from(ATTACH_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })
          .then(function (res) {
            if (res && res.error) throw res.error;
            return client.from("attachments").insert(Object.assign({}, base, {
              name: file.name || "file", mime: file.type || null, size_bytes: file.size || 0, storage_path: path
            })).select("*").single().then(unwrap)
              .catch(function (err) {
                /* لا نترك ملفا يتيما في التخزين إذا رفضت القاعدة الصف */
                client.storage.from(ATTACH_BUCKET).remove([path]);
                throw err;
              });
          });
      });
    }
    if (storageMode() !== "drive") return viaPlatform();
    return storeInDrive(file).then(function (d) {
      return run(function (client) {
        return client.from("attachments").insert(Object.assign({}, base, {
          name: String(d.name || "file").slice(0, 200), mime: d.mime, size_bytes: d.size,
          external_url: d.url, drive_file_id: d.id
        })).select("*").single().then(unwrap);
      });
    }).catch(function (err) {
      if (err && /^drive_|^no_token$|^denied$|^load_failed$/.test(String(err.message || ""))) {
        toast(DRIVE_FALLBACK_TEXT[lang()] || DRIVE_FALLBACK_TEXT.ar, "error");
        return viaPlatform();
      }
      throw err;
    });
  }

  function attachDriveFiles(itemId, docs) {
    var list = (docs || []).filter(function (d) { return d && d.url; });
    return list.reduce(function (p, d) {
      return p.then(function () {
        return run(function (client) {
          var orgId = requireOrg();
          return client.from("attachments").insert({
            org_id: orgId, item_id: itemId || null,
            name: String(d.name || "Google Drive").slice(0, 200),
            mime: d.mimeType || null,
            size_bytes: Number(d.sizeBytes) || 0,
            external_url: d.url,
            uploaded_by: app.user.id
          }).then(unwrap);
        });
      });
    }, Promise.resolve()).then(function () { return list.length; });
  }

  function attachmentUrl(att) {
    if (!att) return Promise.resolve(null);
    if (att.external_url) return Promise.resolve(att.external_url);
    return run(function (client) {
      return client.storage.from(ATTACH_BUCKET).createSignedUrl(att.storage_path, 300).then(function (res) {
        if (res && res.error) throw res.error;
        return res.data ? res.data.signedUrl : null;
      });
    });
  }

  function deleteAttachment(att) {
    return run(function (client) {
      if (!att || !att.id) throw new Error("attachment required");
      return client.from("attachments").delete().eq("id", att.id).then(unwrap).then(function () {
        if (att.storage_path) return client.storage.from(ATTACH_BUCKET).remove([att.storage_path]);
        return null;
      });
    });
  }

  function storageUsed() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("attachments").select("size_bytes").eq("org_id", orgId).not("storage_path", "is", null).then(unwrap)
        .then(function (rows) {
          return (rows || []).reduce(function (sum, r) { return sum + (Number(r.size_bytes) || 0); }, 0);
        });
    });
  }

  function renameOrg(name) {
    return run(function (client) {
      var orgId = requireOrg();
      var clean = String(name || "").trim();
      if (!clean) throw new Error("name required");
      return client.from("organizations").update({ name: clean }).eq("id", orgId).select("*").single()
        .then(unwrap)
        .then(function (row) {
          app.org.name = row.name;
          for (var i = 0; i < app.orgs.length; i++) if (app.orgs[i].id === row.id) app.orgs[i].name = row.name;
          return row;
        });
    });
  }

  function deleteOrg(orgId) {
    return run(function (client) {
      var id = orgId || requireOrg();
      return client.from("organizations").delete().eq("id", id).then(unwrap).then(function () {
        app.orgs = app.orgs.filter(function (o) { return o.id !== id; });
        app.org = app.orgs.length ? app.orgs[0] : null;
        try { app.org ? localStorage.setItem(ORG_KEY, app.org.id) : localStorage.removeItem(ORG_KEY); } catch (e) { /* ignore */ }
        return true;
      });
    });
  }

  /* بحث عن مستخدم مسجل لدعوته (مطابقة تامة للبريد أو الجوال أو رقمه القياسي). */
  function findProfileForInvite(query) {
    return run(function (client) {
      return client.rpc("find_profile_for_invite", { p_query: String(query || "") }).then(unwrap);
    });
  }

  function effectivePlan() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.rpc("effective_plan", { o: orgId }).then(unwrap).then(function (code) { return code || "trial"; });
    });
  }

  function plans() {
    return run(function (client) {
      return client.from("plans").select("*").order("sort_order", { ascending: true }).then(unwrap);
    });
  }

  function planLimits() {
    return Promise.all([effectivePlan(), plans()]).then(function (res) {
      var code = res[0];
      var list = res[1] || [];
      for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i].limits || {};
      return {};
    });
  }

  function subscription() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("subscriptions").select("*")
        .eq("org_id", orgId).eq("status", "active")
        .order("created_at", { ascending: false }).limit(1).maybeSingle()
        .then(unwrap);
    });
  }

  /* ============================================================
   * Trackers
   * ============================================================ */

  function listTrackers() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("trackers").select("*").eq("org_id", orgId)
        .order("created_at", { ascending: true }).then(unwrap);
    });
  }

  function createTracker(tracker) {
    return run(function (client) {
      var orgId = requireOrg();
      var row = {
        org_id: orgId,
        name: String((tracker && tracker.name) || "").trim(),
        color: (tracker && tracker.color) || null,
        columns: (tracker && tracker.columns) || [],
        created_by: app.user.id
      };
      if (!row.name) throw new Error("name required");
      return client.from("trackers").insert(row).select("*").single().then(unwrap);
    });
  }

  function deleteTracker(id) {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("trackers").delete().eq("org_id", orgId).eq("id", id).then(unwrap);
    });
  }

  /* ============================================================
   * Items
   * ============================================================ */

  function listItems(filters) {
    var f = filters || {};
    return run(function (client) {
      var orgId = requireOrg();
      var q = client.from("items").select(ITEM_COLUMNS).eq("org_id", orgId);
      if (f.trackerId) q = q.eq("tracker_id", f.trackerId);
      if (f.status) q = q.eq("status", f.status);
      if (f.from) q = q.gte("due_at", f.from);
      if (f.to) q = q.lte("due_at", f.to);
      if (f.search) {
        var term = String(f.search).trim().replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
        if (term) q = q.ilike("title", "%" + term + "%");
      }
      q = q.order("due_at", { ascending: true, nullsFirst: false }).limit(f.limit || 500);
      return q.then(unwrap).then(function (rows) { return rows || []; });
    });
  }

  function countItems(filters) {
    var f = filters || {};
    return run(function (client) {
      var orgId = requireOrg();
      var q = client.from("items").select("id", { count: "exact", head: true }).eq("org_id", orgId);
      if (f.trackerId) q = q.eq("tracker_id", f.trackerId);
      if (f.status) q = q.eq("status", f.status);
      return q.then(unwrapCount);
    });
  }

  function insertItems(rows) {
    return run(function (client) {
      var orgId = requireOrg();
      var list = (rows || []).map(function (r) {
        if (!r || !r.tracker_id) throw new Error("tracker_id required on every item");
        var row = {};
        for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) row[k] = r[k];
        row.org_id = orgId;
        row.title = String(row.title || "").trim() || "-";
        if (!row.created_by) row.created_by = app.user.id;
        return row;
      });
      var inserted = [];
      var chunks = [];
      for (var i = 0; i < list.length; i += INSERT_CHUNK) chunks.push(list.slice(i, i + INSERT_CHUNK));
      return chunks.reduce(function (p, chunk) {
        return p.then(function () {
          return client.from("items").insert(chunk).select("id").then(unwrap).then(function (data) {
            inserted = inserted.concat(data || []);
          });
        });
      }, Promise.resolve()).then(function () { return inserted; });
    });
  }

  function updateItem(id, patch) {
    return run(function (client) {
      var orgId = requireOrg();
      var clean = {};
      for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k) && k !== "id" && k !== "org_id") clean[k] = patch[k];
      return client.from("items").update(clean).eq("org_id", orgId).eq("id", id).select(ITEM_COLUMNS).single().then(unwrap);
    });
  }

  function deleteItem(id) {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("items").delete().eq("org_id", orgId).eq("id", id).then(unwrap);
    });
  }

  /* ============================================================
   * Imports
   * ============================================================ */

  function listImports() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("imports").select("*, trackers(name)").eq("org_id", orgId)
        .order("created_at", { ascending: false }).then(unwrap);
    });
  }

  function createImport(imp) {
    return run(function (client) {
      var orgId = requireOrg();
      var row = {
        org_id: orgId,
        tracker_id: (imp && imp.tracker_id) || null,
        filename: (imp && imp.filename) || null,
        rows_count: (imp && imp.rows_count) || 0,
        mapping: (imp && imp.mapping) || {},
        created_by: app.user.id
      };
      return client.from("imports").insert(row).select("*").single().then(unwrap);
    });
  }

  function importsThisMonth() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("imports").select("id", { count: "exact", head: true })
        .eq("org_id", orgId).gte("created_at", startOfMonthIso()).then(unwrapCount);
    });
  }

  /* ============================================================
   * Members & invitations
   * ============================================================ */

  function listMembers() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("org_members").select("org_id,user_id,role,status,invited_email,created_at,job_title,person_kind,department")
        .eq("org_id", orgId).order("created_at", { ascending: true })
        .then(unwrap)
        .then(function (members) {
          members = members || [];
          if (!members.length) return members;
          var ids = members.map(function (m) { return m.user_id; });
          /* org_members.user_id points at auth.users, so profiles are fetched separately and attached. */
          return client.from("profiles").select("id,full_name,email,phone").in("id", ids)
            .then(unwrap)
            .then(function (profiles) {
              var byId = {};
              (Array.isArray(profiles) ? profiles : []).forEach(function (p) { byId[p.id] = p; });
              members.forEach(function (m) {
                var p = byId[m.user_id] || null;
                m.profiles = p ? { full_name: p.full_name, email: p.email, phone: p.phone }
                               : { full_name: null, email: m.invited_email || null, phone: null };
              });
              return members;
            });
        });
    });
  }

  function listInvitations() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("invitations").select("*").eq("org_id", orgId).is("accepted_at", null)
        .order("created_at", { ascending: false }).then(unwrap);
    });
  }

  function inviteMember(email, memberRole) {
    return run(function (client) {
      var orgId = requireOrg();
      var clean = String(email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error("invalid email");
      var r = memberRole === "admin" ? "admin" : "member";
      return client.from("invitations")
        .insert({ org_id: orgId, email: clean, role: r, invited_by: app.user.id })
        .select("*").single().then(unwrap);
    });
  }

  function cancelInvitation(id) {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("invitations").delete().eq("org_id", orgId).eq("id", id).then(unwrap);
    });
  }

  /* ============================================================
   * مكان عمل الفريق: توزيع الأعمال والتواصل وتوجيه المهمات
   * ============================================================ */

  /* أعمال الشركة كلها بأصحابها، ليحسب عبء كل عضو وتظهر الأعمال بلا صاحب. */
  function teamWorkItems() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("items")
        .select("id,item_number,title,category,due_at,status,assignee_id")
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
   * مخالفة، مبلغ) تُحل فوراً في المتصفح. لا شبكة ولا انتظار إن كفت القواعد.
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

  /* الوقت يُلتقط فقط قريباً من "الساعة" أو ملاصقاً لمؤشر ص/م أو بصيغة HH:MM — أرقام
     أخرى في النص (رقم القضية مثلاً) لا تُخلط بوقت الجلسة أبداً */
  function timeOfDayFromMatch(hourText, minuteText, meridiemMark) {
    var hour = Number(hourText) || 0, minute = Number(minuteText) || 0;
    meridiemMark = (meridiemMark || "").toLowerCase();
    if (/^(م|مساء|مساءً|pm)$/.test(meridiemMark) && hour < 12) hour += 12;
    if (/^(ص|صباحا|صباحاً|am)$/.test(meridiemMark) && hour === 12) hour = 0;
    return { hour: hour, minute: minute };
  }
  function extractTimeOfDay(text, defaultHour, defaultMinute) {
    var match = text.match(/الساعة\s*(\d{1,2})(?::(\d{2}))?\s*(ص|صباحا|صباحاً|م|مساء|مساءً|am|pm)?/i);
    if (match) return timeOfDayFromMatch(match[1], match[2], match[3]);
    match = text.match(/\b(\d{1,2}):(\d{2})\b/);
    if (match) return timeOfDayFromMatch(match[1], match[2], null);
    match = text.match(/\b(\d{1,2})\s*(ص|صباحا|صباحاً|م|مساء|مساءً|am|pm)\b/i);
    if (match) return timeOfDayFromMatch(match[1], null, match[2]);
    return { hour: defaultHour, minute: defaultMinute };
  }
  function extractDueDate(text, referenceNow) {
    if (/غدا|غداً|بكرة|بكره/.test(text) && !/بعد\s*غد/.test(text)) return addDaysInRiyadh(referenceNow, 1);
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

  /* يعيد عنصراً كاملاً إن وثقت القواعد من نوعه وموعده، وإلا null لتذهب للنموذج اللغوي */
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
    "@media(max-width:900px){.app-sidebar{position:static;inset:auto;width:auto;flex-direction:row;overflow-x:auto;",
    "border-inline-end:0;border-bottom:1px solid var(--glass-border);padding:.6rem;gap:.4rem}",
    ".app-sidebar-title,.app-sidebar-spacer{display:none}",
    ".app-sidebar a,.app-sidebar button{width:auto;white-space:nowrap;padding:.55rem .75rem;font-size:.85rem}",
    "body.has-app-sidebar .container{padding-inline-start:1rem}}",
    ":root{--gap:1.5rem}",
    /* ــ تناسق عناصر الإدخال في كل صفحات التطبيق ــ
       المتصفح يفرض شكله على input[type=search] وعلى select فيخرجان بارتفاع
       واستدارة مختلفين عن بقية الحقول والأزرار. هنا يُلغى ذلك مرة واحدة:
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

  function serviceAllowed(key) {
    if (!key || key === "dashboard") return true; /* مقصد الحارس لا يُحجب */
    if (!app || !Array.isArray(app.services)) return true; /* غير معروف بعد: لا نخفي شيئاً */
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
    /* القائمة بيانات: لا تُرسم قبل أن تُعرف خدمات الاشتراك، فلا تتغير أمام المستخدم */
    if (!sidebarReady) return;
    enforceServiceAccess();
    var here = String(window.location.pathname || "");
    var html = '<div class="app-sidebar-title">' + escapeHtml(sidebarLabel({ ar: "الخدمات", en: "Services", fr: "Services", ur: "خدمات" })) + "</div>";
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

  function mountSidebar() {
    if (document.getElementById("appSidebar")) return;
    if (!/^\/app\//.test(String(window.location.pathname || ""))) return;
    var style = document.createElement("style");
    style.textContent = SIDEBAR_CSS;
    document.head.appendChild(style);

    var nav = document.createElement("nav");
    nav.id = "appSidebar";
    nav.className = "app-sidebar";
    nav.setAttribute("aria-label", sidebarLabel({ ar: "قائمة الخدمات", en: "Services menu", fr: "Menu des services", ur: "خدمات کا مینو" }));
    document.body.insertBefore(nav, document.body.firstChild);
    document.body.classList.add("has-app-sidebar");

    /* روابط الأعلى صارت مكررة مع القائمة الجانبية. */
    var quick = document.getElementById("quickLinks");
    if (quick) quick.hidden = true;

    var ready = app && app.ready && typeof app.ready.then === "function" ? app.ready : null;
    var paint = function () {
      if (isPlatformAdmin()) nav.dataset.admin = "1";
      sidebarReady = true;
      renderSidebar();
    };
    if (ready) ready.then(paint, paint);
    else paint();

    /* إعادة الرسم عند تغيير اللغة (setLang يغير lang/dir على <html>). */
    if (typeof MutationObserver !== "undefined") {
      new MutationObserver(function () { renderSidebar(); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ["lang", "dir"] });
    }
  }

  app.listTrackers = listTrackers;
  app.createTracker = createTracker;
  app.deleteTracker = deleteTracker;
  app.listItems = listItems;
  app.countItems = countItems;
  app.insertItems = insertItems;
  app.updateItem = updateItem;
  app.deleteItem = deleteItem;
  app.listImports = listImports;
  app.createImport = createImport;
  app.importsThisMonth = importsThisMonth;
  app.listMembers = listMembers;
  app.listInvitations = listInvitations;
  app.inviteMember = inviteMember;
  app.cancelInvitation = cancelInvitation;
  app.teamWorkItems = teamWorkItems;
  app.assignItem = assignItem;
  app.listTeamMessages = listTeamMessages;
  app.sendTeamMessage = sendTeamMessage;
  app.deleteTeamMessage = deleteTeamMessage;
  app.markChatRead = markChatRead;
  app.exportCsv = exportCsv;
  app.apiKeys = apiKeys;
  app.createApiKey = createApiKey;
  app.revokeApiKey = revokeApiKey;
  app.removeMember = removeMember;
  app.setMemberRole = setMemberRole;
  app.listRules = listRules;
  app.saveRule = saveRule;
  app.deleteRule = deleteRule;
  app.channelLinks = channelLinks;
  app.requestChannelCode = requestChannelCode;
  app.setSmsPhone = setSmsPhone;
  app.unlinkChannel = unlinkChannel;
  app.listItemRoles = listItemRoles;
  app.setItemRole = setItemRole;
  app.distributeItem = distributeItem;
  app.parseIntent = parseIntent;
  app.sendTeamFile = sendTeamFile;
  app.listChatFiles = listChatFiles;
  app.quickAddItem = quickAddItem;
  app.linkTelegramByToken = linkTelegramByToken;
  app.testChannel = testChannel;
  app.calendarToken = calendarToken;
  app.calendarUrl = calendarUrl;
  app.regenerateCalendarToken = regenerateCalendarToken;
  app.updateProfile = updateProfile;
  app.isPlatformAdmin = isPlatformAdmin;
  app.platformAdmins = platformAdmins;
  app.setPlatformAdmin = setPlatformAdmin;
  app.activityFeed = activityFeed;
  app.achievements = achievements;
  /* قاعدة الثبات: لا كتابة بمحتوى مطابق، والعنصر يظهر مع محتواه لا قبله */
  function paint(el, html) {
    var node = typeof el === "string" ? document.getElementById(el) : el;
    if (!node) return false;
    if (node.__sig === html) return false;
    node.__sig = html;
    node.innerHTML = html;
    if (node.hidden) node.hidden = false;
    return true;
  }

  app.paint = paint;
  app.exportXlsx = exportXlsx;
  app.setMemberPerson = setMemberPerson;
  app.departments = departments;
  app.openNewOrgDialog = openNewOrgDialog;
  app.registrationRule = registrationRule;
  app.departmentLabel = departmentLabel;
  app.serviceAllowed = serviceAllowed;
  app.entityTypes = function () { return ENTITY_TYPES.slice(); };
  app.entityLabel = entityLabel;
  app.isPersonType = isPersonType;
  app.orgProfile = orgProfile;
  app.saveOrgProfile = saveOrgProfile;
  app.orgDocumentsStatus = orgDocumentsStatus;
  app.listProcesses = listProcesses;
  app.saveProcess = saveProcess;
  app.deleteProcess = deleteProcess;
  app.listRisks = listRisks;
  app.saveRisk = saveRisk;
  app.deleteRisk = deleteRisk;
  app.caseBundle = caseBundle;
  app.listAttachments = listAttachments;
  app.uploadAttachment = uploadAttachment;
  app.addAttachmentLink = addAttachmentLink;
  app.driveAvailable = driveAvailable;
  app.driveOAuthAvailable = driveOAuthAvailable;
  app.storageMode = storageMode;
  app.connectDrive = driveAccessToken;
  app.readDocumentFile = readDocumentFile;
  app.pickFromDrive = pickFromDrive;
  app.driveDownload = driveDownload;
  app.attachDriveFiles = attachDriveFiles;
  app.attachmentUrl = attachmentUrl;
  app.deleteAttachment = deleteAttachment;
  app.storageUsed = storageUsed;
  app.renameOrg = renameOrg;
  app.deleteOrg = deleteOrg;
  app.findProfileForInvite = findProfileForInvite;
  app.requestPlan = requestPlan;
  app.planRequests = planRequests;
  app.cancelPlanRequest = cancelPlanRequest;
  app.adminPlanRequests = adminPlanRequests;
  app.adminDecideRequest = adminDecideRequest;
  app.adminListOrgs = adminListOrgs;
  app.adminActivate = adminActivate;
  app.adminContactMessages = adminContactMessages;
  app.adminTelegramMessages = adminTelegramMessages;
  app.lang = lang;
  app.t = t;
  app.fmtDate = fmtDate;
  app.fmtAmount = fmtAmount;
  app.parseExcelDate = parseExcelDate;
  app.toast = toast;
  app.escapeHtml = escapeHtml;
  app.randomCode = randomCode;
  app.unavailableMessage = unavailableMessage;

  /* ============================================================
   * الشريط العلوي للتطبيق — روابط الخدمات، واسم المستخدم، وجرس التنبيهات،
   * وزر خروج صغير. يظهر أسفل شريط الموقع في كل صفحات /app.
   * ============================================================ */

  /* الشريط العلوي للتنقل العام، والقائمة الجانبية للخدمات: لا يتكرر عنصر بينهما. */
  var TOPNAV = [
    { href: "/about.html", labels: { ar: "الدليل", en: "Guide", fr: "Guide", ur: "رہنما" } },
    { href: "/#contact", labels: { ar: "تواصل معنا", en: "Contact us", fr: "Nous contacter", ur: "رابطہ کریں" } }
  ];

  var BELL_LABELS = { ar: "التنبيهات", en: "Notifications", fr: "Notifications", ur: "اطلاعات" };
  var ORG_LABELS = { ar: "الحساب", en: "Account", fr: "Compte", ur: "اکاؤنٹ" };
  var NEW_ORG_LABELS = { ar: "＋ حساب جديد", en: "＋ New account", fr: "＋ Nouveau compte", ur: "＋ نیا اکاؤنٹ" };
  var BELL_DELETE = { ar: "حذف التنبيه", en: "Delete", fr: "Supprimer", ur: "حذف کریں" };
  var BELL_CLEAR = { ar: "حذف كل التنبيهات", en: "Clear all", fr: "Tout effacer", ur: "سب حذف کریں" };
  var BELL_EMPTY = { ar: "لا توجد تنبيهات بعد.", en: "No notifications yet.", fr: "Aucune notification pour le moment.", ur: "ابھی کوئی اطلاع نہیں۔" };
  var BELL_SEEN_KEY = "tracker_bell_seen";

  var TOPBAR_CSS = [
    ".app-topbar{position:fixed;inset-block-start:var(--site-header-h,61px);inset-inline:0;height:64px;box-sizing:border-box;z-index:45;display:flex;align-items:center;",
    "justify-content:space-between;gap:1.5rem;padding:0 1.75rem;background:var(--glass);-webkit-backdrop-filter:blur(20px);",
    ".app-topbar>*{max-height:40px}",
    "backdrop-filter:blur(20px);border-bottom:1px solid var(--glass-border);box-shadow:0 6px 18px rgba(0,0,0,.12)}",
    ".app-topnav{display:flex;align-items:center;gap:.4rem;overflow:visible;scrollbar-width:none;margin-inline-end:auto}",
    ".app-sidebar-toggle{flex:0 0 auto;margin-inline-end:-.9rem}",
    ".app-topnav::-webkit-scrollbar{display:none}",
    ".app-topnav>a,.app-topnav>button,.app-menu-wrap>button{position:relative;display:inline-flex;align-items:center;gap:.4rem;height:40px;box-sizing:border-box;padding:0 1rem;border:0;",
    ".app-topbar button{-webkit-appearance:none;appearance:none}",
    "border-radius:12px;background:transparent;color:var(--text-secondary);font:inherit;font-size:.92rem;font-weight:600;",
    "white-space:nowrap;text-decoration:none;cursor:pointer;transition:all .25s ease}",
    ".app-topnav>a:hover,.app-topnav>button:hover{background:var(--glass-border);color:var(--text-primary)}",
    ".app-topnav>a.is-active{color:var(--primary)}",
    ".app-topnav>a.is-active{background:var(--glass-border);color:var(--text-primary)}",
    ".app-topnav>a.is-active::after{content:'';position:absolute;inset-inline:1rem;bottom:-.65rem;height:3px;border-radius:3px;background:var(--primary)}",
    ".app-userbox{display:flex;align-items:center;gap:.75rem;flex:0 0 auto;max-height:40px}",
    ".app-orgbox{display:flex;align-items:center;gap:.55rem;height:40px;box-sizing:border-box;padding:0 .55rem 0 .9rem;border-radius:14px;",
    "background:var(--glass);border:1px solid var(--glass-border);color:var(--text-primary)}",
    ".app-orgbox:hover{border-color:var(--primary)}",
    ".app-orglabel{font-size:.72rem;font-weight:700;color:var(--text-secondary);letter-spacing:.02em}",
    ".app-orgselect{max-width:190px;padding:.3rem 1.4rem .3rem .4rem;border:0;border-radius:10px;background:transparent;",
    "color:var(--text-primary);font:inherit;font-size:.88rem;font-weight:700;cursor:pointer;-webkit-appearance:none;appearance:none;",
    "background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);",
    "background-position:calc(0.55rem) center,calc(0.9rem) center;background-size:5px 5px,5px 5px;background-repeat:no-repeat}",
    ".app-orgselect option{color:#12212b;background:#fff}",
    "@media(max-width:900px){.app-orgselect{max-width:130px}}",
    ".app-username{display:inline-flex;align-items:center;gap:.5rem;max-width:240px;height:40px;box-sizing:border-box;padding:0 1rem;border-radius:14px;",
    "background:var(--glass-border);color:var(--text-primary);font-size:.85rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".app-iconbtn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;box-sizing:border-box;padding:0;border:1px solid var(--glass-border);",
    "[dir=rtl] #topSignOut svg{transform:scaleX(-1)}",
    "border-radius:12px;background:transparent;color:var(--text-secondary);cursor:pointer;transition:all .25s ease}",
    ".app-iconbtn:hover{background:var(--glass-border);color:var(--text-primary)}",
    ".app-iconbtn svg{width:19px;height:19px;fill:currentColor}",
    "html[dir=\"rtl\"] #topSignOut svg{transform:scaleX(-1)}",
    ".app-bell-badge{position:absolute;inset-block-start:-6px;inset-inline-end:-6px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;",
    "background:#e5484d;color:#fff;font-size:.68rem;font-weight:700;display:flex;align-items:center;justify-content:center}",
    ".app-bell-panel{position:absolute;inset-block-start:46px;inset-inline-end:0;width:300px;max-height:60vh;overflow-y:auto;padding:.5rem;",
    "border-radius:16px;background:var(--bg-mid,#1a2933);",
    "border:1px solid var(--glass-border);box-shadow:0 18px 40px var(--shadow-dark);display:none;z-index:60}",
    ".app-bell-panel.is-open{display:block}",
    ".app-bell-item{padding:.65rem .75rem;border-radius:12px;font-size:.82rem;color:var(--text-secondary);margin-bottom:.25rem}",
    ".app-bell-item.is-unread{background:var(--glass-border)}",
    ".app-bell-item.is-link{cursor:pointer}",
    ".app-bell-item.is-link:hover{background:var(--glass-border)}",
    ".app-bell-num{display:block;font-size:.72rem;opacity:.75;margin-bottom:.15rem}",
    ".app-bell-item{position:relative;padding-inline-end:1.9rem}",
    ".app-bell-del{position:absolute;inset-inline-end:.35rem;inset-block-start:.45rem;width:22px;height:22px;padding:0;",
    "border:0;border-radius:8px;background:transparent;color:var(--text-secondary);font-size:.8rem;line-height:1;cursor:pointer}",
    ".app-bell-del:hover{background:var(--glass-border);color:var(--text-primary)}",
    ".app-bell-clear{display:block;width:100%;margin-top:.35rem;padding:.5rem;border:0;border-radius:10px;",
    "background:transparent;color:var(--text-secondary);font:inherit;font-size:.8rem;font-weight:700;cursor:pointer}",
    ".app-bell-clear:hover{background:var(--glass-border);color:var(--text-primary)}",
    ".app-bell-item strong{display:block;color:var(--text-primary);font-size:.9rem;margin-bottom:.15rem}",
    ".app-bell-empty{padding:.9rem .7rem;font-size:.85rem;color:var(--text-secondary);text-align:center}",
    ".app-menu-wrap{position:relative;display:inline-flex}",
    ".app-menu-panel{position:absolute;inset-block-start:46px;inset-inline-start:0;width:220px;padding:.4rem;border-radius:16px;background:var(--bg-mid,#1a2933);",
    "border:1px solid var(--glass-border);",
    "box-shadow:0 18px 40px var(--shadow-dark);display:none;z-index:60}",
    ".app-menu-panel.is-open{display:block}",
    ".app-menu-panel a{display:block;padding:.6rem .75rem;border-radius:10px;color:var(--text-secondary);font-size:.9rem;font-weight:600;text-decoration:none}",
    ".app-menu-panel a:hover{background:var(--glass-border);color:var(--text-primary)}",
    "body.has-app-topbar{padding-top:calc(var(--site-header-h,61px) + 64px)}",
    "body.has-app-topbar .container>.header{display:none}",   /* العناوين الكبيرة (لوحة التحكم/القضايا…) لا داعي لها: الموقع واضح من الشريطين */
    "body.has-app-topbar .container{padding-top:2rem}",
    "body.has-app-topbar .app-sidebar{inset-block-start:calc(var(--site-header-h,61px) + 64px)}",
    "@media(max-width:900px){.app-topbar{position:static;height:auto;flex-wrap:wrap;padding:.5rem .75rem;gap:.5rem}",
    ".app-topnav{overflow-x:auto}",
    "body.has-app-topbar{padding-top:52px}.app-username{max-width:150px}",
    ".app-bell-panel,.app-menu-panel{inset-block-start:auto;inset-inline-end:auto;position:fixed;inset-inline:1rem;width:auto}}"
  ].join("");

  /* الاسم بلغة الواجهة: الإنجليزي حين تكون اللغة en/fr وهو موجود، وإلا العربي —
     كلاهما يكتبه المستخدم بنفسه في الإعدادات، لا اشتقاق آلي بينهما. */
  function userDisplayName() {
    var p = app.profile || {};
    var u = app.user || {};
    var meta = (u.user_metadata || {});
    var preferEnglish = lang() === "en" || lang() === "fr";
    if (preferEnglish && p.full_name_en) return p.full_name_en;
    return p.full_name || p.full_name_en || meta.full_name || meta.name || u.email || "";
  }

  function bellSeenAt() {
    try { return localStorage.getItem(BELL_SEEN_KEY) || ""; } catch (e) { return ""; }
  }

  function myNotifications() {
    return run(function (client) {
      return client.from("notifications")
        .select("id,status,channel,scheduled_at,sent_at,created_at,read_at,payload")
        .eq("user_id", app.user.id)
        .eq("channel", "inapp")
        .order("created_at", { ascending: false })
        .limit(12)
        .then(unwrap);
    });
  }

  function deleteNotification(id) {
    return run(function (client) {
      return client.from("notifications").delete().eq("id", id).eq("user_id", app.user.id).then(unwrap);
    });
  }

  function clearNotifications() {
    return run(function (client) {
      return client.from("notifications").delete().eq("user_id", app.user.id).eq("channel", "inapp").then(unwrap);
    });
  }

  /* تصدير CSV: BOM ليفتحه إكسل بالعربية، وكل خلية محاطة بعلامتي اقتباس */
  function exportCsv(filename, rows, columns) {
    var cols = columns || Object.keys((rows && rows[0]) || {});
    var q = function (v) {
      if (v === null || v === undefined) v = "";
      else if (typeof v === "object") v = JSON.stringify(v);
      return '"' + String(v).replace(/"/g, '""') + '"';
    };
    var lines = [cols.map(function (c) { return q(c.label || c); }).join(",")];
    (rows || []).forEach(function (r) {
      lines.push(cols.map(function (c) { return q(typeof c === "object" ? (typeof c.get === "function" ? c.get(r) : r[c.key]) : r[c]); }).join(","));
    });
    var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename || "export.csv";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- التصدير إلى إكسل: ملف xlsx حقيقي بالعربية بلا تشويه ---------- */
  var XLSX_SRC = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  var xlsxPromise = null;

  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise(function (resolve, reject) {
      var el = document.createElement("script");
      el.src = XLSX_SRC;
      el.onload = function () { window.XLSX ? resolve(window.XLSX) : reject(new Error("xlsx_missing")); };
      el.onerror = function () { xlsxPromise = null; reject(new Error("xlsx_load_failed")); };
      document.head.appendChild(el);
    });
    return xlsxPromise;
  }

  function cellValue(row, col) {
    var value = (typeof col === "object")
      ? (typeof col.get === "function" ? col.get(row) : row[col.key])
      : row[col];
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return value;
  }

  /* نفس توقيع exportCsv تماما: (اسم الملف، الصفوف، الأعمدة) */
  function exportXlsx(filename, rows, columns, sheetName) {
    var cols = columns || Object.keys((rows && rows[0]) || {});
    return loadXlsx().then(function (XLSX) {
      var header = cols.map(function (col) { return String(col.label || col); });
      var body = (rows || []).map(function (row) {
        return cols.map(function (col) {
          var value = cellValue(row, col);
          var numericOrValue = (typeof value === "string" && value.trim() !== "" && isFinite(Number(value))) ? Number(value) : value;
          return numericOrValue;
        });
      });
      var worksheet = XLSX.utils.aoa_to_sheet([header].concat(body));
      /* عرض العمود يتبع أطول قيمة فيه حتى يقرأ الجدول بلا توسيع يدوي */
      worksheet["!cols"] = header.map(function (label, columnIndex) {
        var longest = label.length;
        body.forEach(function (row) { var len = String(row[columnIndex] == null ? "" : row[columnIndex]).length; if (len > longest) longest = len; });
        return { wch: Math.min(60, Math.max(10, longest + 2)) };
      });
      var name = String(sheetName || "").slice(0, 28) || "Sheet1";
      var workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, name);
      XLSX.writeFile(workbook, filename || "export.xlsx");
      return true;
    });
  }

  function apiKeys() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("api_keys").select("id,name,prefix,created_at,last_used_at,revoked_at")
        .eq("org_id", orgId).is("revoked_at", null).order("created_at", { ascending: false }).then(unwrap);
    });
  }
  function createApiKey(name) {
    return run(function (client) {
      var orgId = requireOrg();
      return client.rpc("api_key_create", { p_org: orgId, p_name: String(name || "").trim() }).then(unwrap);
    });
  }
  function revokeApiKey(id) {
    return run(function (client) { return client.rpc("api_key_revoke", { p_id: id }).then(unwrap); });
  }

  function markChatRead(peerId) {
    return run(function (client) {
      return client.rpc("mark_chat_read", { peer: peerId || null }).then(unwrap);
    });
  }

  function markNotificationsRead() {
    return run(function (client) {
      return client.rpc("mark_notifications_read").then(unwrap);
    });
  }

  /* أين أنا الآن؟ اسم الشركة الحالية ظاهر دائما ويبدل من مكانه. */
  var REG_TEXT = {
    ar: { expiryHint: "1447/05/10 هجري أو 2026-12-01 ميلادي", expiryReads: "يفهمه النظام:", expiryBad: "لم أفهم التاريخ — اكتبه هكذا 1447/05/10 أو 2026-12-01.", expiryNone: "اتركه فارغاً إن كان المستند بلا تاريخ انتهاء (السجل التجاري الجديد لا ينتهي).", fileFirst: "ارفع المستند الرسمي (سجل تجاري أو وثيقة عمل حر أو هوية) ليُقرأ منه كل شيء", reading: "جاري قراءة المستند…", readDone: "قُرئ المستند وعُبِّئ منه:", readNothing: "قُرئ المستند ولم تُستخرج بيانات، أكمل الحقول.", readFailed: "تعذرت قراءة المستند، أكمل الحقول يدوياً.", readName: "الاسم", readNumber: "الرقم", readExpiry: "تاريخ الانتهاء", commercial_register: "رقم السجل التجاري", id_document: "رقم الهوية الوطنية", license: "رقم الرخصة / الوثيقة", expiry: "تاريخ انتهاء المستند (إن وجد)", file: "ملف المستند (PDF أو صورة، اختياري)",
          gate: "لا تُنشأ الجهة بلا مستندها الرسمي: الرقم وتاريخ الانتهاء إلزاميان، ويُسجَّل أول مستند في ملفها.", invalid: "الرقم غير صحيح.", expiryRequired: "تاريخ الانتهاء إلزامي.", fileFailed: "أُنشئت الجهة لكن تعذّر رفع الملف؛ أضفه من صفحة المستندات." },
    en: { expiryHint: "1447/05/10 Hijri or 2026-12-01", expiryReads: "Understood as:", expiryBad: "Date not understood — write 1447/05/10 or 2026-12-01.", expiryNone: "Leave empty if the document has no expiry (the new commercial register never expires).", fileFirst: "Upload the official document (commercial register, freelance permit or ID) and it fills the fields", reading: "Reading the document…", readDone: "Read and filled in:", readNothing: "The document was read but nothing was extracted; fill the fields.", readFailed: "Could not read the document; fill the fields manually.", readName: "name", readNumber: "number", readExpiry: "expiry date", commercial_register: "Commercial register number", id_document: "National ID number", license: "License / permit number", expiry: "Document expiry date (if any)", file: "Document file (PDF or image, optional)",
          gate: "No entity without its official document: number and expiry are required, and it becomes the first paper on file.", invalid: "Invalid number.", expiryRequired: "Expiry date is required.", fileFailed: "Created, but the file could not be uploaded; add it from Documents." },
    fr: { expiryHint: "1447/05/10 hégirien ou 2026-12-01", expiryReads: "Compris comme :", expiryBad: "Date non comprise — écrivez 1447/05/10 ou 2026-12-01.", expiryNone: "Laissez vide si le document n’expire pas (le nouveau registre de commerce n’expire jamais).", fileFirst: "Téléversez le document officiel (registre de commerce, permis d’indépendant ou pièce d’identité) : il remplit les champs", reading: "Lecture du document…", readDone: "Lu et rempli :", readNothing: "Document lu, rien n’a été extrait ; complétez les champs.", readFailed: "Lecture impossible ; complétez les champs à la main.", readName: "nom", readNumber: "numéro", readExpiry: "date d’expiration", commercial_register: "Numéro du registre de commerce", id_document: "Numéro de carte d’identité", license: "Numéro de licence / permis", expiry: "Date d’expiration du document (le cas échéant)", file: "Fichier du document (PDF ou image, facultatif)",
          gate: "Aucune entité sans son document officiel : numéro et date d’expiration obligatoires ; il devient la première pièce du dossier.", invalid: "Numéro invalide.", expiryRequired: "Date d’expiration obligatoire.", fileFailed: "Créée, mais le fichier n’a pu être envoyé ; ajoutez-le depuis Documents." },
    ur: { expiryHint: "1447/05/10 ہجری یا 2026-12-01", expiryReads: "سسٹم نے سمجھا:", expiryBad: "تاریخ سمجھ نہیں آئی — 1447/05/10 یا 2026-12-01 لکھیں۔", expiryNone: "اگر دستاویز کی میعاد نہیں تو خالی چھوڑیں (نیا کمرشل رجسٹر ختم نہیں ہوتا)۔", fileFirst: "سرکاری دستاویز اپ لوڈ کریں (کمرشل رجسٹر، فری لانس اجازت نامہ یا شناخت) — خانے خود بھر جائیں گے", reading: "دستاویز پڑھی جا رہی ہے…", readDone: "پڑھ کر بھر دیا:", readNothing: "دستاویز پڑھی گئی مگر کچھ نہ ملا؛ خانے بھریں۔", readFailed: "دستاویز نہیں پڑھی جا سکی؛ خانے خود بھریں۔", readName: "نام", readNumber: "نمبر", readExpiry: "میعاد", commercial_register: "کمرشل رجسٹر نمبر", id_document: "قومی شناختی نمبر", license: "لائسنس / اجازت نامہ نمبر", expiry: "دستاویز کی میعاد (اگر ہو)", file: "دستاویز کی فائل (PDF یا تصویر، اختیاری)",
          gate: "سرکاری دستاویز کے بغیر کوئی ادارہ نہیں: نمبر اور میعاد لازمی ہیں، اور یہ فائل کی پہلی دستاویز بنتی ہے۔", invalid: "نمبر غلط ہے۔", expiryRequired: "میعاد ختم ہونے کی تاریخ لازمی ہے۔", fileFailed: "بن گیا، مگر فائل اپ لوڈ نہ ہو سکی؛ دستاویزات سے شامل کریں۔" }
  };

  var NEW_ORG_TEXT = {
    ar: { title: "حساب جديد", hint: "اختر نوع الحساب ثم اكتب الاسم.", type: "نوع الحساب", name: "اسم الجهة", nameSelf: "اسمك الكامل", save: "إنشاء", cancel: "إلغاء", error: "تعذر الإنشاء، حاول مرة أخرى." },
    en: { title: "New account", hint: "Choose the account type, then enter the name.", type: "Account type", name: "Entity name", nameSelf: "Your full name", save: "Create", cancel: "Cancel", error: "Could not create it, try again." },
    fr: { title: "Nouveau compte", hint: "Choisissez le type de compte, puis saisissez le nom.", type: "Type de compte", name: "Nom de l'entité", nameSelf: "Votre nom complet", save: "Créer", cancel: "Annuler", error: "Création impossible, réessayez." },
    ur: { title: "نیا اکاؤنٹ", hint: "اکاؤنٹ کی قسم منتخب کریں پھر نام لکھیں۔", type: "اکاؤنٹ کی قسم", name: "ادارے کا نام", nameSelf: "آپ کا پورا نام", save: "بنائیں", cancel: "منسوخ", error: "نہیں بن سکا، دوبارہ کوشش کریں۔" }
  };

  /* إضافة شركة من الشريط العلوي مباشرة */
  function openNewOrgDialog() {
    if (document.getElementById("appNewOrg")) return;
    var t = NEW_ORG_TEXT[lang()] || NEW_ORG_TEXT.ar;
    var rt = REG_TEXT[lang()] || REG_TEXT.ar;
    var style = document.createElement("style");
    style.textContent = PROFILE_CSS;
    document.head.appendChild(style);

    var gate = document.createElement("div");
    gate.id = "appNewOrg";
    gate.className = "app-gate";
    gate.innerHTML =
      '<div class="app-gate-card" role="dialog" aria-modal="true">' +
        "<h2>" + escapeHtml(t.title) + "</h2><p>" + escapeHtml(t.hint) + "</p>" +
        "<label>" + escapeHtml(rt.fileFirst) +
          '<input type="file" id="newOrgFile" accept=".pdf,image/*"></label>' +
        '<div id="newOrgRead" style="font-size:.85rem;color:var(--text-secondary);margin:-.4rem 0 .8rem"></div>' +
        "<label>" + escapeHtml(t.type) +
          '<select id="newOrgType">' + ENTITY_TYPES.map(function (e) {
            return '<option value="' + e.value + '">' + escapeHtml(e[lang()] || e.ar) + "</option>";
          }).join("") + "</select></label>" +
        '<label id="newOrgNameLabel">' + escapeHtml(t.name) +
          '<input type="text" id="newOrgInput" maxlength="120" autocomplete="organization" dir="auto"></label>' +
        '<p class="app-gate-hint" style="font-size:.85rem;color:var(--text-secondary);margin:.25rem 0 .5rem">' + escapeHtml(rt.gate) + "</p>" +
        '<label id="newOrgRegLabel">' + escapeHtml(rt.commercial_register) +
          '<input type="text" id="newOrgReg" maxlength="40" dir="ltr" inputmode="numeric" autocomplete="off"></label>' +
        "<label>" + escapeHtml(rt.expiry) +
          '<input type="text" id="newOrgExpiry" dir="ltr" autocomplete="off" placeholder="' + escapeHtml(rt.expiryHint) + '"></label>' +
        '<div id="newOrgExpiryEcho" style="font-size:.8rem;color:var(--text-secondary);margin:-.6rem 0 .8rem"></div>' +

        '<button type="button" id="newOrgSave">' + escapeHtml(t.save) + "</button>" +
        '<button type="button" id="newOrgCancelBtn" style="margin-top:.6rem;background:transparent;color:var(--text-secondary)">' + escapeHtml(t.cancel) + "</button>" +
        '<div class="app-gate-msg" id="newOrgErr"></div>' +
      "</div>";
    document.body.appendChild(gate);
    var input = document.getElementById("newOrgInput");
    if (input) input.focus();

    document.getElementById("newOrgCancelBtn").addEventListener("click", function () { gate.remove(); });
    var typeSel = document.getElementById("newOrgType");
    var nameLabel = document.getElementById("newOrgNameLabel");
    var regLabel = document.getElementById("newOrgRegLabel");
    var syncRegLabel = function () { if (regLabel) regLabel.childNodes[0].nodeValue = rt[registrationRule(typeSel ? typeSel.value : "company").kind]; };
    syncRegLabel();
    if (typeSel && nameLabel) typeSel.addEventListener("change", function () {
      syncRegLabel();
      nameLabel.childNodes[0].nodeValue = isPersonType(typeSel.value) ? t.nameSelf : t.name;
      if (isPersonType(typeSel.value) && !String(input.value || "").trim() && app.profile && app.profile.full_name) {
        input.value = app.profile.full_name;
      }
    });
    /* ما فهمه النظام من التاريخ يُعرض تحته: ميلادي وهجري معاً */
    var expiryEl = document.getElementById("newOrgExpiry");
    var expiryEcho = document.getElementById("newOrgExpiryEcho");
    function showExpiry() {
      if (!expiryEl || !expiryEcho) return;
      var raw = String(expiryEl.value || "").trim();
      if (!raw) { expiryEcho.textContent = rt.expiryNone; return; }
      var iso = parseAnyDate(raw);
      expiryEcho.textContent = iso ? (rt.expiryReads + " " + iso + " — " + gregorianToHijriText(iso)) : rt.expiryBad;
    }
    if (expiryEl) { expiryEl.addEventListener("input", showExpiry); showExpiry(); }

    /* الورقة تُقرأ فور اختيارها فتملأ النوع والاسم والرقم وتاريخ الانتهاء */
    var fileInput = document.getElementById("newOrgFile");
    var readMsg = document.getElementById("newOrgRead");
    if (fileInput) fileInput.addEventListener("change", function () {
      var f = this.files && this.files[0];
      if (!f || !readMsg) return;
      readMsg.textContent = rt.reading;
      readDocumentFile(f).then(function (fields) {
        if (!fields) throw new Error("empty");
        var filled = [];
        if (fields.entity_hint && typeSel) {
          typeSel.value = entityTypeValue(fields.entity_hint);
          syncRegLabel();
          nameLabel.childNodes[0].nodeValue = isPersonType(typeSel.value) ? t.nameSelf : t.name;
          filled.push(entityLabel(typeSel.value));
        }
        if (fields.party && input && !String(input.value || "").trim()) { input.value = fields.party; filled.push(rt.readName); }
        var regEl = document.getElementById("newOrgReg");
        if (fields.number && regEl && !String(regEl.value || "").trim()) { regEl.value = String(fields.number).replace(/\s/g, ""); filled.push(rt.readNumber); }
        var expEl = document.getElementById("newOrgExpiry");
        if (fields.expiry_date && expEl && !String(expEl.value || "").trim()) {
          expEl.value = String(fields.expiry_date).slice(0, 10);
          showExpiry();
          filled.push(rt.readExpiry);
        }
        if (!fields.expiry_date) showExpiry();
        readMsg.textContent = filled.length ? rt.readDone + " " + filled.join("، ") : rt.readNothing;
      }).catch(function () { readMsg.textContent = rt.readFailed; });
    });

    document.getElementById("newOrgSave").addEventListener("click", function () {
      var name = String(input.value || "").trim();
      var err = document.getElementById("newOrgErr");
      if (!name) { input.focus(); return; }
      var type = typeSel ? typeSel.value : "company";
      var reg = String((document.getElementById("newOrgReg") || {}).value || "").replace(/\s/g, "");
      var expiryRaw = String((document.getElementById("newOrgExpiry") || {}).value || "").trim();
      var expiry = expiryRaw ? parseAnyDate(expiryRaw) : null;
      if (expiryRaw && !expiry) { err.textContent = rt.expiryBad; document.getElementById("newOrgExpiry").focus(); return; }
      var fileEl = document.getElementById("newOrgFile");
      var file = fileEl && fileEl.files && fileEl.files[0];
      if (!registrationRule(type).pattern.test(reg)) { err.textContent = rt.invalid; document.getElementById("newOrgReg").focus(); return; }
      err.textContent = "";
      var btn = this;
      btn.disabled = true;
      createOrg(name, type, reg, expiry).then(function (org) {
        /* الملف نفسه يُرفع مرفقاً على مستند التسجيل الذي أنشأته القاعدة */
        if (file && org && org.item_id) {
          return uploadAttachment(org.item_id, file).catch(function () { err.textContent = rt.fileFailed; return null; });
        }
        return null;
      }).then(function () {
        window.location.href = "/app/dashboard.html";
      }).catch(function (e) {
        btn.disabled = false;
        var code = String((e && e.message) || "");
        err.textContent = /REG_NUMBER_INVALID/.test(code) ? rt.invalid : /REG_EXPIRY_REQUIRED/.test(code) ? rt.expiryRequired : t.error;
      });
    });
  }

  function orgBoxHtml() {
    var orgs = (app && app.orgs) || [];
    var current = app && app.org ? app.org : null;
    if (!current && !orgs.length) return "";
    /* الاسم ونوعه: الشخصي يُعرف من الشركة بنظرة، وكل ما هو عضو فيه معروض */
    var opts = orgs.map(function (o) {
      var type = o.entity_type ? entityLabel(o.entity_type) : "";
      var label = (o.name || "") + (type ? " — " + type : "");
      return '<option value="' + escapeHtml(o.id) + '"' + (current && o.id === current.id ? " selected" : "") + ">" +
             escapeHtml(label) + "</option>";
    }).join("");
    opts += '<option value="__new">' + escapeHtml(sidebarLabel(NEW_ORG_LABELS)) + "</option>";
    return '<div class="app-orgbox" title="' + escapeHtml(sidebarLabel(ORG_LABELS)) + '">' +
             '<span class="app-orglabel">' + escapeHtml(sidebarLabel(ORG_LABELS)) + "</span>" +
             '<select class="app-orgselect" id="topOrgSelect">' + opts + "</select>" +
           "</div>";
  }

  var topbarHtml = "";

  function renderTopbar() {
    var bar = document.getElementById("appTopbar");
    if (!bar) return;
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

    var html =
      '<button type="button" class="app-iconbtn app-sidebar-toggle" id="topSidebarToggle" aria-controls="appSidebar" ' +
        'aria-label="' + escapeHtml(sidebarLabel(SIDEBAR_TOGGLE_LABELS)) + '" title="' + escapeHtml(sidebarLabel(SIDEBAR_TOGGLE_LABELS)) + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg></button>' +
      '<nav class="app-topnav">' + nav + "</nav>" +
      '<div class="app-userbox">' +
        orgBoxHtml() +
        '<span class="app-username" id="topUserName" title="' + escapeHtml(userDisplayName()) + '">' + escapeHtml(userDisplayName()) + "</span>" +
        '<button type="button" class="app-iconbtn" id="topBellBtn" aria-label="' + escapeHtml(sidebarLabel(BELL_LABELS)) + '">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5S10.5 3.17 10.5 4v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>' +
          '<span class="app-bell-badge" id="topBellBadge" hidden>0</span></button>' +
        '<button type="button" class="app-iconbtn" id="topSignOut" aria-label="' + escapeHtml(sidebarLabel(SIGN_OUT_LABELS)) + '">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.59L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg></button>' +
        '<div class="app-bell-panel" id="topBellPanel"><div class="app-bell-empty">' + escapeHtml(sidebarLabel(BELL_EMPTY)) + "</div></div>" +
      "</div>";

    if (html === topbarHtml) return;   /* نفس المحتوى: لا إعادة رسم ولا مستمعون جدد */
    topbarHtml = html;
    bar.innerHTML = html;

    var bell = document.getElementById("topBellBtn");
    var bellPanel = document.getElementById("topBellPanel");

    var toggle = document.getElementById("topSidebarToggle");
    if (toggle) {
      applySidebarVisibility(sidebarVisible());
      toggle.addEventListener("click", function (ev) {
        ev.stopPropagation();
        applySidebarVisibility(!sidebarVisible(), true);
      });
    }

    if (bellPanel) bellPanel.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var go = ev.target.closest("[data-bell-go]");
      if (go && !ev.target.closest("[data-bell-del]")) { window.location.href = go.dataset.bellGo; return; }
      var del = ev.target.closest("[data-bell-del]");
      if (del) {
        del.disabled = true;
        deleteNotification(del.dataset.bellDel).then(function () { loadBell(); }).catch(function () { del.disabled = false; });
        return;
      }
      if (ev.target.closest("#bellClearAll")) {
        clearNotifications().then(function () { loadBell(); }).catch(function () { /* تجاهل */ });
      }
    });

    if (bell && bellPanel) bell.addEventListener("click", function (ev) {
      ev.stopPropagation();
      bellPanel.classList.toggle("is-open");
      if (!bellPanel.classList.contains("is-open")) return;
      var badge = document.getElementById("topBellBadge");
      if (badge) { badge.hidden = true; badge.textContent = "0"; }
      /* نعلمها مقروءة أولا ثم نعيد التحميل، وإلا عاد العداد بصف لم يحدث بعد. */
      markNotificationsRead().then(function () { loadBell(); }).catch(function () { loadBell(); });
    });

    document.addEventListener("click", function () {
      if (bellPanel) bellPanel.classList.remove("is-open");
    });

    var orgSel = document.getElementById("topOrgSelect");
    if (orgSel) orgSel.addEventListener("change", function () {
      if (this.value === "__new") {
        this.value = app.org ? app.org.id : "";
        openNewOrgDialog();
        return;
      }
      if (app.org && this.value !== app.org.id) setCurrentOrg(this.value);
    });

    var out = document.getElementById("topSignOut");
    if (out) out.addEventListener("click", function () {
      var auth = window.trackerAuth;
      var done = function () { window.location.replace("/login"); };
      if (auth && typeof auth.signOut === "function") auth.signOut().then(done, done);
      else done();
    });
  }

  /* تنبيهات الفريق تخزن بنوعها لا بنصها، فيقرأها كل مستخدم بلغته. */
  var BELL_TEAM_TEXT = {
    invite: {
      ar: "دعوة للانضمام إلى شركة {org}", en: "Invitation to join {org}",
      fr: "Invitation à rejoindre {org}", ur: "{org} میں شامل ہونے کی دعوت"
    },
    joined: {
      ar: "انضممت إلى شركة {org}", en: "You joined {org}",
      fr: "Vous avez rejoint {org}", ur: "آپ {org} میں شامل ہو گئے"
    },
    member_joined: {
      ar: "{actor} انضم إلى شركة {org}", en: "{actor} joined {org}",
      fr: "{actor} a rejoint {org}", ur: "{actor} {org} میں شامل ہو گئے"
    },
    team_room: {
      ar: "{actor} في دردشة الفريق: {item}", en: "{actor} in team chat: {item}",
      fr: "{actor} dans la discussion : {item}", ur: "{actor} ٹیم چیٹ میں: {item}"
    },
    team_message: {
      ar: "رسالة من {actor}", en: "Message from {actor}",
      fr: "Message de {actor}", ur: "{actor} کی طرف سے پیغام"
    },
    assigned: {
      ar: "أسندت إليك: {item}", en: "Assigned to you: {item}",
      fr: "Qui vous est assigné : {item}", ur: "آپ کے سپرد: {item}"
    }
  };

  function bellTitle(payload) {
    var map = BELL_TEAM_TEXT[payload.kind];
    if (!map) return "";
    return sidebarLabel(map)
      .replace("{org}", payload.org_name || "")
      .replace("{actor}", payload.actor || "")
      .replace("{item}", payload.item_title || payload.excerpt || "");
  }

  /* وجهة كل تنبيه: رسالة فريق → المحادثة، دعوة → الفريق، عنصر → لوحته مفتوحا على العنصر */
  function bellTarget(n) {
    var p = n.payload || {};
    var kind = p.kind || "";
    if (kind === "team_message") return "/app/team.html?chat=" + encodeURIComponent(p.author_id || "");
    if (kind === "invite") return "/app/team.html";
    if (p.item_id) {
      var cat = String(p.category || p.item_category || "");
      var view = /مخالف/.test(cat) ? "?type=violations&" : (/قض|دعو/.test(cat) ? "?type=cases&" : "?");
      return "/app/dashboard.html" + view + "item=" + encodeURIComponent(p.item_id);
    }
    return "";
  }

  function loadBell() {
    var panel = document.getElementById("topBellPanel");
    if (!panel) return;
    myNotifications().then(function (rows) {
      var list = rows || [];
      if (!list.length) {
        panel.innerHTML = '<div class="app-bell-empty">' + escapeHtml(sidebarLabel(BELL_EMPTY)) + "</div>";
        return;
      }
      var html = "";
      var unseen = 0;
      list.forEach(function (n) {
        var payload = n.payload || {};
        var title = bellTitle(payload) || payload.title || payload.item_title || "";
        var due = payload.due_at || null;
        var number = payload.item_number || "";
        if (!n.read_at) unseen++;
        var target = bellTarget(n);
        html += '<div class="app-bell-item' + (n.read_at ? "" : " is-unread") + (target ? " is-link" : "") + '"' +
                (target ? ' data-bell-go="' + escapeHtml(target) + '"' : "") + ">" +
                '<button type="button" class="app-bell-del" data-bell-del="' + escapeHtml(n.id) + '" aria-label="' +
                escapeHtml(sidebarLabel(BELL_DELETE)) + '" title="' + escapeHtml(sidebarLabel(BELL_DELETE)) + '">✕</button>' +
                "<strong>" + escapeHtml(title || sidebarLabel(BELL_LABELS)) + "</strong>" +
                (number ? '<span class="app-bell-num">' + escapeHtml(number) + "</span>" : "") +
                escapeHtml(due ? fmtDate(due, { withTime: true }) : fmtDate(n.created_at, { withTime: true })) +
                "</div>";
      });
      panel.innerHTML = html +
        '<button type="button" class="app-bell-clear" id="bellClearAll">' + escapeHtml(sidebarLabel(BELL_CLEAR)) + "</button>";
      var badge = document.getElementById("topBellBadge");
      if (!badge) return;
      if (unseen > 0 && !panel.classList.contains("is-open")) {
        badge.textContent = String(unseen);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }).catch(function () { /* التنبيهات ليست حرجة */ });
  }

  /* داخل التطبيق لا يخرج المستخدم من حسابه: روابط الموقع العام تفتح في تبويب
     جديد، ورابط "تسجيل الدخول" في التذييل لا معنى له بعد الدخول. */
  function keepInsideApp() {
    /* لا شيء يخرج المستخدم من لوحته: روابط الموقع العام في التذييل تزال داخل
       التطبيق، وما تبقى من روابط خارجية يفتح في تبويب جديد. */
    /* نخفي روابط الموقع العام في التذييل فقط، ونبقي روابط التطبيق مثل لوحة التحكم. */
    var footerRows = document.querySelectorAll(".footer-links");
    for (var f = 0; f < footerRows.length; f++) {
      var kids = footerRows[f].querySelectorAll("a[href]");
      var visible = 0;
      for (var j = 0; j < kids.length; j++) {
        var h = kids[j].getAttribute("href") || "";
        if (h.indexOf("/app/") === 0) { visible++; continue; }
        kids[j].hidden = true;
      }
      footerRows[f].hidden = visible === 0;
    }

    /* زر الخروج واحد فقط، في الشريط العلوي؛ أي زر آخر في الصفحات يخفى. */
    var strays = document.querySelectorAll("#signOutCard, #signOutBtn, #quickLinks");
    for (var i = 0; i < strays.length; i++) strays[i].hidden = true;

    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.getAttribute("href") || "";
      if (href.indexOf("/login") === 0 || href.indexOf("login.html") !== -1) { a.hidden = true; continue; }
      if (href.charAt(0) === "#" || href.indexOf("mailto:") === 0 || href.indexOf("webcal:") === 0) continue;
      var outside = href.indexOf("/app/") !== 0 && href.indexOf("http") !== 0 ? true : (href.indexOf(window.location.origin + "/app/") === 0 ? false : href.indexOf("http") === 0);
      if (href.indexOf("/app/") === 0) continue;
      if (outside && !a.target) { a.target = "_blank"; a.rel = "noopener"; }
    }
  }

  function syncSiteHeaderHeight() {
    var h = document.querySelector(".site-header");
    var px = h ? Math.round(h.getBoundingClientRect().height) : 61;
    if (px > 0) document.documentElement.style.setProperty("--site-header-h", px + "px");
  }

  function mountTopbar() {
    if (document.getElementById("appTopbar")) return;
    if (!/^\/app\//.test(String(window.location.pathname || ""))) return;
    syncSiteHeaderHeight();
    window.addEventListener("resize", syncSiteHeaderHeight);
    var style = document.createElement("style");
    style.textContent = TOPBAR_CSS;
    document.head.appendChild(style);
    var bar = document.createElement("header");
    bar.id = "appTopbar";
    bar.className = "app-topbar";
    document.body.insertBefore(bar, document.body.firstChild);
    document.body.classList.add("has-app-topbar");

    var ready = app && app.ready && typeof app.ready.then === "function" ? app.ready : null;
    if (ready) ready.then(function () {
      renderTopbar();
      loadBell();
    }).catch(function () { renderTopbar(); });
    else renderTopbar();

    if (typeof MutationObserver !== "undefined") {
      new MutationObserver(function () { renderTopbar(); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ["lang", "dir"] });
    }
  }

  /* ============================================================
   * إكمال الملف الشخصي — لا يستخدم أحد المنصة قبل تسجيل اسمه الكامل ورقم جواله.
   * ============================================================ */

  var PROFILE_TEXT = {
    ar: { title: "أكمل بياناتك", intro: "نحتاج اسمك الكامل ورقم جوالك قبل استخدام المنصة.", name: "الاسم الكامل", phone: "رقم الجوال", save: "حفظ ومتابعة", error: "تعذر الحفظ، حاول مرة أخرى.", invalid: "أدخل اسما كاملا ورقم جوال بالصيغة الدولية مثل +9665xxxxxxx" },
    en: { title: "Complete your details", intro: "We need your full name and mobile number before you use the platform.", name: "Full name", phone: "Mobile number", save: "Save and continue", error: "Could not save, try again.", invalid: "Enter a full name and a mobile number in international format, e.g. +9665xxxxxxx" },
    fr: { title: "Complétez vos informations", intro: "Nous avons besoin de votre nom complet et de votre numéro de mobile.", name: "Nom complet", phone: "Numéro de mobile", save: "Enregistrer et continuer", error: "Enregistrement impossible, réessayez.", invalid: "Saisissez un nom complet et un numéro au format international, ex. +9665xxxxxxx" },
    ur: { title: "اپنی تفصیلات مکمل کریں", intro: "پلیٹ فارم استعمال کرنے سے پہلے ہمیں آپ کا پورا نام اور موبائل نمبر درکار ہے۔", name: "پورا نام", phone: "موبائل نمبر", save: "محفوظ کریں اور جاری رکھیں", error: "محفوظ نہیں ہو سکا، دوبارہ کوشش کریں۔", invalid: "پورا نام اور بین الاقوامی فارمیٹ میں نمبر درج کریں، مثلا +9665xxxxxxx" }
  };

  var PROFILE_CSS = [
    ".app-gate{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:1.5rem;",
    "background:rgba(10,18,24,.75);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}",
    ".app-gate-card{width:min(460px,100%);padding:1.75rem;border-radius:22px;background:var(--bg-mid,#1a2933);",
    "border:1px solid var(--glass-border);box-shadow:0 24px 60px rgba(0,0,0,.45)}",
    ".app-gate-card h2{margin:0 0 .35rem;font-size:1.3rem;color:var(--text-primary)}",
    ".app-gate-card p{margin:0 0 1.1rem;font-size:.9rem;color:var(--text-secondary)}",
    ".app-gate-card label{display:block;margin-bottom:.9rem;font-size:.85rem;color:var(--text-secondary)}",
    ".app-gate-card input,.app-gate-card select{width:100%;margin-top:.35rem;padding:.7rem .9rem;border-radius:12px;",
    "border:1px solid var(--glass-border);background:var(--glass);color:var(--text-primary);font:inherit}",
    ".app-gate-card select{appearance:none;-webkit-appearance:none}",
    ".app-gate-card button{width:100%;padding:.75rem 1rem;border:0;border-radius:12px;background:var(--primary);",
    "color:var(--btn-ink,#fff);font:inherit;font-weight:700;cursor:pointer}",
    ".app-gate-msg{margin-top:.8rem;font-size:.85rem;color:#ff8f8f;min-height:1.2em}"
  ].join("");

  function profileText() {
    return PROFILE_TEXT[lang()] || PROFILE_TEXT.ar;
  }

  function profileComplete() {
    var p = app.profile || {};
    return !!(String(p.full_name || "").trim() && String(p.phone || "").trim());
  }

  (function fetchDriveConfig() {
    try {
      fetch("/api/config", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (cfg) {
        if (!cfg) return;
        driveConfig.clientId = cfg.googleClientId || null;
        driveConfig.apiKey = cfg.googleApiKey || null;
        document.documentElement.dataset.drive = driveAvailable() ? "1" : "0";
        document.dispatchEvent(new CustomEvent("tracker:drive", { detail: { available: driveAvailable() } }));
      }).catch(function () { /* بلا درايف */ });
    } catch (e) { /* ignore */ }
  })();

  function mountProfileGate() {
    if (document.getElementById("appProfileGate")) return;
    if (!/^\/app\//.test(String(window.location.pathname || ""))) return;
    if (profileComplete()) return;

    var t = profileText();
    var style = document.createElement("style");
    style.textContent = PROFILE_CSS;
    document.head.appendChild(style);

    var gate = document.createElement("div");
    gate.id = "appProfileGate";
    gate.className = "app-gate";
    gate.innerHTML =
      '<div class="app-gate-card" role="dialog" aria-modal="true">' +
        "<h2>" + escapeHtml(t.title) + "</h2><p>" + escapeHtml(t.intro) + "</p>" +
        "<label>" + escapeHtml(t.name) + '<input type="text" id="gateName" maxlength="120" autocomplete="name" value="' +
          escapeHtml(String((app.profile || {}).full_name || "")) + '" dir="auto"></label>' +
        "<label>" + escapeHtml(t.phone) + '<input type="tel" id="gatePhone" dir="ltr" placeholder="+9665xxxxxxx" autocomplete="tel" value="' +
          escapeHtml(String((app.profile || {}).phone || "")) + '"></label>' +
        '<button type="button" id="gateSave">' + escapeHtml(t.save) + "</button>" +
        '<div class="app-gate-msg" id="gateMsg"></div>' +
      "</div>";
    document.body.appendChild(gate);

    document.getElementById("gateSave").addEventListener("click", function () {
      var name = String(document.getElementById("gateName").value || "").trim();
      var phone = String(document.getElementById("gatePhone").value || "").trim().replace(/[\s-]/g, "");
      var msg = document.getElementById("gateMsg");
      if (name.split(/\s+/).length < 2 || !/^\+[1-9]\d{7,14}$/.test(phone)) { msg.textContent = t.invalid; return; }
      var btn = document.getElementById("gateSave");
      btn.disabled = true;
      msg.textContent = "";
      updateProfile({ full_name: name, phone: phone }).then(function () {
        gate.remove();
      }).catch(function () {
        btn.disabled = false;
        msg.textContent = t.error;
      });
    });
  }

  var JOINED_LABELS = {
    ar: "انضممت إلى شركة {name}. تجدها في مبدل الشركات.",
    en: "You joined {name}. You will find it in the company switcher.",
    fr: "Vous avez rejoint {name}. Retrouvez-la dans le sélecteur d'entreprise.",
    ur: "آپ {name} میں شامل ہو گئے۔ یہ کمپنی سوئچر میں ملے گی۔"
  };

  /* المدعو يعرف بانضمامه بدل أن تظهر له شركة جديدة بلا تفسير. */
  function announceJoinedOrgs() {
    var joined = app.joinedOrgs || [];
    joined.forEach(function (row, i) {
      var name = row.joined_org_name || "";
      setTimeout(function () {
        toast(sidebarLabel(JOINED_LABELS).replace("{name}", name), "success");
      }, 600 + i * 800);
    });
  }

  /* القائمة الجانبية تركب بعد اكتمال تعريف الواجهة، وأي خطأ فيها لا يوقف الصفحة. */
  function bootSidebar() {
    try { mountSidebar(); } catch (e) { /* تجاهل */ }
    try { mountTopbar(); } catch (e) { /* تجاهل */ }
    try { keepInsideApp(); } catch (e) { /* تجاهل */ }
    var readyGate = app && app.ready && typeof app.ready.then === "function" ? app.ready : null;
    if (readyGate) readyGate.then(function () {
      try { mountProfileGate(); } catch (e) { /* تجاهل */ }
      try { announceJoinedOrgs(); } catch (e) { /* تجاهل */ }
    }).catch(function () { /* الصفحة تتكفل بالخطأ */ });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootSidebar);
  else bootSidebar();
})();
