/**
 * app/common.js — TRACKER shared data layer for the app pages (plain script, no modules).
 *
 * Loads after supabase-js (window.supabase) and /app.js (window.trackerAuth) and exposes
 * window.trackerApp = {
 *   ready, client, user, profile, orgs, org, role(),
 *   setCurrentOrg(orgId), createOrg(name),
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
  var ITEM_COLUMNS = "id,title,category,due_at,status,assignee_id,data,tracker_id,trackers(name)";
  var INSERT_CHUNK = 200;

  /* Fallback strings (used only when the page has no `translations` object or lacks the key). */
  var FALLBACK = {
    ar: {
      serviceUnavailableTitle: "الخدمة قيد التجهيز",
      serviceUnavailableText: "نعمل حالياً على تجهيز الخدمة، حاول مرة أخرى لاحقاً.",
      noOrg: "لا توجد شركة محددة، أنشئ شركتك أولاً.",
      planLimitItems: "وصلت إلى الحد الأقصى لعدد العناصر في باقتك الحالية، رقِّ باقتك لإضافة المزيد.",
      planLimitMembers: "وصلت إلى الحد الأقصى لعدد الأعضاء في باقتك الحالية، رقِّ باقتك لإضافة المزيد.",
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

  function fmtDate(iso, opts) {
    if (!iso) return "";
    var d = iso instanceof Date ? iso : new Date(iso);
    if (isNaN(d.getTime())) return "";
    var withTime = !!(opts && opts.withTime);
    var locales = { ar: "ar-SA-u-ca-gregory-nu-latn", ur: "ur-PK-u-ca-gregory-nu-latn", en: "en-GB", fr: "fr-FR" };
    var options = { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TIME_ZONE };
    if (withTime) {
      options.hour = "2-digit";
      options.minute = "2-digit";
      options.hour12 = false;
    }
    var text;
    try {
      text = new Intl.DateTimeFormat(locales[lang()] || locales.en, options).format(d);
    } catch (e) {
      text = d.toISOString().slice(0, withTime ? 16 : 10).replace("T", " ");
    }
    return toWesternDigits(text);
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
            return { id: user.id, full_name: fallbackName, email: user.email || null, phone: user.phone || null,
                     lang: lang(), tz: TIME_ZONE, is_platform_admin: false };
          });
      });
  }

  function loadOrgs(client, user) {
    return client.from("org_members")
      .select("org_id, role, status, organizations(id,name,plan_code,plan_expires_at)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .then(unwrap)
      .then(function (rows) {
        return (rows || []).filter(function (r) { return r.organizations; }).map(function (r) {
          var o = r.organizations;
          return { id: o.id, name: o.name, plan_code: o.plan_code, plan_expires_at: o.plan_expires_at, role: r.role };
        });
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
          return loadOrgs(app.client, app.user);
        }).then(function (orgs) {
          app.orgs = orgs;
          app.org = pickOrg(orgs);
          try { if (app.org) localStorage.setItem(ORG_KEY, app.org.id); } catch (e) { /* ignore */ }
          return { user: app.user, profile: app.profile, orgs: app.orgs, org: app.org };
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

  function createOrg(name) {
    return run(function (client) {
      var clean = String(name || "").trim();
      if (!clean) throw new Error("name required");
      return client.from("organizations")
        .insert({ name: clean, owner_id: app.user.id })
        .select("id,name,plan_code,plan_expires_at")
        .single()
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

  function effectivePlan() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.rpc("effective_plan", { o: orgId }).then(unwrap).then(function (code) { return code || "free"; });
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
      return client.from("org_members").select("org_id,user_id,role,status,invited_email,created_at")
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
        channels: (r.channels && r.channels.length) ? r.channels : ["email"],
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
      if (p.lang !== undefined) clean.lang = p.lang;
      if (p.tz !== undefined) clean.tz = p.tz;
      return client.from("profiles").update(clean).eq("id", app.user.id).select("*").single()
        .then(unwrap)
        .then(function (row) { app.profile = row; return row; });
    });
  }

  /* ============================================================
   * Platform admin
   * ============================================================ */

  function isPlatformAdmin() {
    return !!(app.profile && app.profile.is_platform_admin);
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
  app.removeMember = removeMember;
  app.setMemberRole = setMemberRole;
  app.listRules = listRules;
  app.saveRule = saveRule;
  app.deleteRule = deleteRule;
  app.channelLinks = channelLinks;
  app.requestChannelCode = requestChannelCode;
  app.setSmsPhone = setSmsPhone;
  app.unlinkChannel = unlinkChannel;
  app.testChannel = testChannel;
  app.calendarToken = calendarToken;
  app.calendarUrl = calendarUrl;
  app.regenerateCalendarToken = regenerateCalendarToken;
  app.updateProfile = updateProfile;
  app.isPlatformAdmin = isPlatformAdmin;
  app.adminListOrgs = adminListOrgs;
  app.adminActivate = adminActivate;
  app.adminContactMessages = adminContactMessages;
  app.lang = lang;
  app.t = t;
  app.fmtDate = fmtDate;
  app.parseExcelDate = parseExcelDate;
  app.toast = toast;
  app.escapeHtml = escapeHtml;
  app.randomCode = randomCode;
  app.unavailableMessage = unavailableMessage;
})();
