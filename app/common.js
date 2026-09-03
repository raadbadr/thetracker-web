/**
 * app/common.js — TheTracker shared data layer for the app pages (plain script, no modules).
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
   * تُبنى هنا مرة واحدة بدل تكرارها في خمس صفحات.
   * ============================================================ */

  var NAV_ITEMS = [
    { href: "/app/dashboard.html", path: "dashboard",
      icon: '<path d="M4 13h6V4H4v9zm0 7h6v-5H4v5zm9 0h7v-9h-7v9zm0-16v5h7V4h-7z"/>',
      labels: { ar: "لوحة التحكم", en: "Dashboard", fr: "Tableau de bord", ur: "ڈیش بورڈ" } },
    { href: "/app/import.html", path: "import",
      icon: '<path d="M19 12v7H5v-7H3v9h18v-9h-2zM11 3v10.17l-3.59-3.58L6 11l6 6 6-6-1.41-1.41L13 13.17V3h-2z"/>',
      labels: { ar: "استيراد إكسل", en: "Excel import", fr: "Import Excel", ur: "ایکسل درآمد" } },
    { href: "/app/team.html", path: "team",
      icon: '<path d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>',
      labels: { ar: "الفريق", en: "Team", fr: "Équipe", ur: "ٹیم" } },
    { href: "/app/settings.html", path: "settings",
      icon: '<path d="M19.14 12.94a7.07 7.07 0 000-1.88l2.03-1.58a.5.5 0 00.12-.64l-1.92-3.32a.5.5 0 00-.61-.22l-2.39.96a7.03 7.03 0 00-1.62-.94l-.36-2.54a.5.5 0 00-.5-.42h-3.84a.5.5 0 00-.5.42l-.36 2.54c-.58.24-1.12.56-1.62.94l-2.39-.96a.5.5 0 00-.61.22L2.65 8.84a.5.5 0 00.12.64l2.03 1.58a7.07 7.07 0 000 1.88l-2.03 1.58a.5.5 0 00-.12.64l1.92 3.32c.13.22.39.3.61.22l2.39-.96c.5.38 1.04.7 1.62.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.58-.24 1.12-.56 1.62-.94l2.39.96c.22.08.48 0 .61-.22l1.92-3.32a.5.5 0 00-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1112 8.5a3.5 3.5 0 010 7z"/>',
      labels: { ar: "الإعدادات", en: "Settings", fr: "Paramètres", ur: "ترتیبات" } },
    { href: "/app/admin.html", path: "admin", adminOnly: true,
      icon: '<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>',
      labels: { ar: "إدارة المنصة", en: "Platform admin", fr: "Administration", ur: "پلیٹ فارم ایڈمن" } },
  ];

  var SIGN_OUT_LABELS = { ar: "تسجيل الخروج", en: "Sign out", fr: "Se déconnecter", ur: "سائن آؤٹ" };

  var SIDEBAR_CSS = [
    ".app-sidebar{position:fixed;inset-block:52px 0;inset-inline-start:0;width:232px;padding:1.25rem .85rem;",
    "display:flex;flex-direction:column;gap:.35rem;z-index:40;overflow-y:auto;background:var(--glass);",
    "-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);border-inline-end:1px solid var(--glass-border)}",
    ".app-sidebar-title{font-size:.75rem;font-weight:700;letter-spacing:.04em;opacity:.6;padding:0 .6rem .5rem;color:var(--text-secondary)}",
    ".app-sidebar a,.app-sidebar button{display:flex;align-items:center;justify-content:space-between;gap:.65rem;width:100%;padding:.7rem .8rem;border:0;border-radius:14px;",
    "background:transparent;color:var(--text-secondary);font:inherit;font-size:.95rem;font-weight:600;text-decoration:none;cursor:pointer;text-align:start;",
    "transition:all .25s cubic-bezier(.4,0,.2,1)}",
    ".app-sidebar a:hover,.app-sidebar button:hover{background:var(--glass-border);color:var(--text-primary)}",
    ".app-sidebar a.is-active{background:var(--primary);color:#fff;box-shadow:0 6px 18px var(--shadow-dark)}",
    ".app-sidebar svg{width:20px;height:20px;flex:0 0 auto;fill:currentColor}",
    ".app-sidebar-spacer{flex:1 1 auto}",
    "body.has-app-sidebar .container{padding-inline-start:calc(232px + 1.5rem)}",
    "@media(max-width:900px){.app-sidebar{position:static;inset:auto;width:auto;flex-direction:row;overflow-x:auto;",
    "border-inline-end:0;border-bottom:1px solid var(--glass-border);padding:.6rem;gap:.4rem}",
    ".app-sidebar-title,.app-sidebar-spacer{display:none}",
    ".app-sidebar a,.app-sidebar button{width:auto;white-space:nowrap;padding:.55rem .75rem;font-size:.85rem}",
    "body.has-app-sidebar .container{padding-inline-start:1rem}}"
  ].join("");

  function sidebarLabel(map) {
    var l = lang();
    return map[l] || map.ar;
  }

  function renderSidebar() {
    var nav = document.getElementById("appSidebar");
    if (!nav) return;
    var here = String(window.location.pathname || "");
    var html = '<div class="app-sidebar-title">' + escapeHtml(sidebarLabel({ ar: "الخدمات", en: "Services", fr: "Services", ur: "خدمات" })) + "</div>";
    NAV_ITEMS.forEach(function (item) {
      if (item.adminOnly && !nav.dataset.admin) return;
      var active = here.indexOf("/" + item.path) !== -1 ? " is-active" : "";
      html += '<a class="app-sidebar-link' + active + '" href="' + item.href + '">' +
              "<span>" + escapeHtml(sidebarLabel(item.labels)) + "</span>" +
              '<svg viewBox="0 0 24 24" aria-hidden="true">' + item.icon + "</svg></a>";
    });
    html += '<div class="app-sidebar-spacer"></div>';
    html += '<button type="button" id="sidebarSignOut">' +
            "<span>" + escapeHtml(sidebarLabel(SIGN_OUT_LABELS)) + "</span>" +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.59L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg></button>';
    nav.innerHTML = html;
    var out = document.getElementById("sidebarSignOut");
    if (out) out.addEventListener("click", function () {
      var auth = window.trackerAuth;
      var done = function () { window.location.replace("/login"); };
      if (auth && typeof auth.signOut === "function") auth.signOut().then(done, done);
      else done();
    });
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

    renderSidebar();

    var ready = app && app.ready && typeof app.ready.then === "function" ? app.ready : null;
    if (ready) ready.then(function () {
      if (!isPlatformAdmin()) return;
      nav.dataset.admin = "1";
      renderSidebar();
    }).catch(function () { /* الصفحة تتكفل بعرض الخطأ */ });

    /* إعادة الرسم عند تغيير اللغة (setLang يغيّر lang/dir على <html>). */
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
  app.requestPlan = requestPlan;
  app.planRequests = planRequests;
  app.cancelPlanRequest = cancelPlanRequest;
  app.adminPlanRequests = adminPlanRequests;
  app.adminDecideRequest = adminDecideRequest;
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

  /* ============================================================
   * الشريط العلوي للتطبيق — روابط الخدمات، واسم المستخدم، وجرس التنبيهات،
   * وزر خروج صغير. يظهر أسفل شريط الموقع في كل صفحات /app.
   * ============================================================ */

  var TOPNAV = [
    { href: "/app/dashboard.html", labels: { ar: "لوحة المعلومات", en: "Dashboard", fr: "Tableau de bord", ur: "ڈیش بورڈ" } },
    { menu: true, labels: { ar: "الخدمات الإلكترونية", en: "e-Services", fr: "Services en ligne", ur: "برقی خدمات" } },
    { href: "/about.html", labels: { ar: "الدليل", en: "Guide", fr: "Guide", ur: "رہنما" } },
    { href: "/#contact", labels: { ar: "تواصل معنا", en: "Contact us", fr: "Nous contacter", ur: "رابطہ کریں" } }
  ];

  var BELL_LABELS = { ar: "التنبيهات", en: "Notifications", fr: "Notifications", ur: "اطلاعات" };
  var BELL_EMPTY = { ar: "لا توجد تنبيهات بعد.", en: "No notifications yet.", fr: "Aucune notification pour le moment.", ur: "ابھی کوئی اطلاع نہیں۔" };
  var BELL_SEEN_KEY = "tracker_bell_seen";

  var TOPBAR_CSS = [
    ".app-topbar{position:fixed;inset-block-start:52px;inset-inline:0;height:56px;z-index:45;display:flex;align-items:center;",
    "justify-content:space-between;gap:1rem;padding:0 1.1rem;background:var(--glass);-webkit-backdrop-filter:blur(20px);",
    "backdrop-filter:blur(20px);border-bottom:1px solid var(--glass-border)}",
    ".app-topnav{display:flex;align-items:center;gap:.25rem;overflow:visible;scrollbar-width:none}",
    ".app-topnav::-webkit-scrollbar{display:none}",
    ".app-topnav>a,.app-topnav>button,.app-menu-wrap>button{position:relative;display:inline-flex;align-items:center;gap:.35rem;padding:.5rem .85rem;border:0;",
    ".app-topbar button{-webkit-appearance:none;appearance:none}",
    "border-radius:10px;background:transparent;color:var(--text-secondary);font:inherit;font-size:.9rem;font-weight:600;",
    "white-space:nowrap;text-decoration:none;cursor:pointer;transition:all .25s ease}",
    ".app-topnav>a:hover,.app-topnav>button:hover{background:var(--glass-border);color:var(--text-primary)}",
    ".app-topnav>a.is-active{color:var(--primary)}",
    ".app-topnav>a.is-active::after{content:'';position:absolute;inset-inline:.85rem;bottom:-.55rem;height:3px;border-radius:3px;background:var(--primary)}",
    ".app-userbox{display:flex;align-items:center;gap:.5rem;flex:0 0 auto}",
    ".app-username{display:inline-flex;align-items:center;gap:.5rem;max-width:230px;padding:.45rem .85rem;border-radius:12px;",
    "background:var(--glass-border);color:var(--text-primary);font-size:.85rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".app-iconbtn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;padding:0;border:1px solid var(--glass-border);",
    "border-radius:12px;background:transparent;color:var(--text-secondary);cursor:pointer;transition:all .25s ease}",
    ".app-iconbtn:hover{background:var(--glass-border);color:var(--text-primary)}",
    ".app-iconbtn svg{width:19px;height:19px;fill:currentColor}",
    ".app-bell-badge{position:absolute;inset-block-start:-6px;inset-inline-end:-6px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;",
    "background:#e5484d;color:#fff;font-size:.68rem;font-weight:700;display:flex;align-items:center;justify-content:center}",
    ".app-bell-panel{position:absolute;inset-block-start:46px;inset-inline-end:0;width:300px;max-height:60vh;overflow-y:auto;padding:.5rem;",
    "border-radius:16px;background:var(--bg-mid,#1a2933);",
    "border:1px solid var(--glass-border);box-shadow:0 18px 40px var(--shadow-dark);display:none;z-index:60}",
    ".app-bell-panel.is-open{display:block}",
    ".app-bell-item{padding:.6rem .7rem;border-radius:10px;font-size:.85rem;color:var(--text-secondary)}",
    ".app-bell-item strong{display:block;color:var(--text-primary);font-size:.9rem;margin-bottom:.15rem}",
    ".app-bell-empty{padding:.9rem .7rem;font-size:.85rem;color:var(--text-secondary);text-align:center}",
    ".app-menu-wrap{position:relative;display:inline-flex}",
    ".app-menu-panel{position:absolute;inset-block-start:46px;inset-inline-start:0;width:220px;padding:.4rem;border-radius:16px;background:var(--bg-mid,#1a2933);",
    "border:1px solid var(--glass-border);",
    "box-shadow:0 18px 40px var(--shadow-dark);display:none;z-index:60}",
    ".app-menu-panel.is-open{display:block}",
    ".app-menu-panel a{display:block;padding:.6rem .75rem;border-radius:10px;color:var(--text-secondary);font-size:.9rem;font-weight:600;text-decoration:none}",
    ".app-menu-panel a:hover{background:var(--glass-border);color:var(--text-primary)}",
    "body.has-app-topbar{padding-top:108px}",
    "body.has-app-topbar .app-sidebar{inset-block-start:108px}",
    "@media(max-width:900px){.app-topbar{position:static;height:auto;flex-wrap:wrap;padding:.5rem .75rem;gap:.5rem}",
    ".app-topnav{overflow-x:auto}",
    "body.has-app-topbar{padding-top:52px}.app-username{max-width:150px}",
    ".app-bell-panel,.app-menu-panel{inset-block-start:auto;inset-inline-end:auto;position:fixed;inset-inline:1rem;width:auto}}"
  ].join("");

  function userDisplayName() {
    var p = app.profile || {};
    var u = app.user || {};
    var meta = (u.user_metadata || {});
    return p.full_name || meta.full_name || meta.name || u.email || "";
  }

  function bellSeenAt() {
    try { return localStorage.getItem(BELL_SEEN_KEY) || ""; } catch (e) { return ""; }
  }

  function myNotifications() {
    return run(function (client) {
      return client.from("notifications")
        .select("id,status,channel,scheduled_at,sent_at,created_at,payload")
        .eq("user_id", app.user.id)
        .order("created_at", { ascending: false })
        .limit(8)
        .then(unwrap);
    });
  }

  function renderTopbar() {
    var bar = document.getElementById("appTopbar");
    if (!bar) return;
    var here = String(window.location.pathname || "");
    var sidebar = document.getElementById("appSidebar");
    var services = "";
    NAV_ITEMS.forEach(function (item) {
      if (item.adminOnly && !(sidebar && sidebar.dataset.admin)) return;
      services += '<a href="' + item.href + '">' + escapeHtml(sidebarLabel(item.labels)) + "</a>";
    });
    var nav = "";
    TOPNAV.forEach(function (item, i) {
      var label = escapeHtml(sidebarLabel(item.labels));
      if (item.menu) {
        nav += '<span class="app-menu-wrap">' +
               '<button type="button" id="topServicesBtn" aria-haspopup="true" aria-expanded="false">' + label +
               '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style="fill:currentColor"><path d="M7 10l5 5 5-5z"/></svg></button>' +
               '<div class="app-menu-panel" id="topServicesPanel">__SERVICES__</div></span>';
      } else {
        var inApp = item.href.indexOf("/app/") === 0;
        var active = inApp && here.indexOf(item.href) === 0 ? "is-active" : "";
        var target = inApp ? "" : ' target="_blank" rel="noopener"';
        nav += '<a class="' + active + '" href="' + item.href + '"' + target + ">" + label + "</a>";
      }
    });

    bar.innerHTML =
      '<nav class="app-topnav">' + nav.replace("__SERVICES__", services) + "</nav>" +
      '<div class="app-userbox">' +
        '<span class="app-username" id="topUserName" title="' + escapeHtml(userDisplayName()) + '">' + escapeHtml(userDisplayName()) + "</span>" +
        '<button type="button" class="app-iconbtn" id="topBellBtn" aria-label="' + escapeHtml(sidebarLabel(BELL_LABELS)) + '">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5S10.5 3.17 10.5 4v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>' +
          '<span class="app-bell-badge" id="topBellBadge" hidden>0</span></button>' +
        '<button type="button" class="app-iconbtn" id="topSignOut" aria-label="' + escapeHtml(sidebarLabel(SIGN_OUT_LABELS)) + '">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.59L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg></button>' +
        '<div class="app-bell-panel" id="topBellPanel"><div class="app-bell-empty">' + escapeHtml(sidebarLabel(BELL_EMPTY)) + "</div></div>" +
      "</div>";

    var bell = document.getElementById("topBellBtn");
    var bellPanel = document.getElementById("topBellPanel");
    var svcBtn = document.getElementById("topServicesBtn");
    var svcPanel = document.getElementById("topServicesPanel");

    if (svcBtn && svcPanel) svcBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (bellPanel) bellPanel.classList.remove("is-open");
      svcPanel.classList.toggle("is-open");
      svcBtn.setAttribute("aria-expanded", svcPanel.classList.contains("is-open") ? "true" : "false");
    });

    if (bell && bellPanel) bell.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (svcPanel) svcPanel.classList.remove("is-open");
      bellPanel.classList.toggle("is-open");
      if (!bellPanel.classList.contains("is-open")) return;
      try { localStorage.setItem(BELL_SEEN_KEY, new Date().toISOString()); } catch (e) { /* ignore */ }
      var badge = document.getElementById("topBellBadge");
      if (badge) badge.hidden = true;
      loadBell();
    });

    document.addEventListener("click", function () {
      if (bellPanel) bellPanel.classList.remove("is-open");
      if (svcPanel) svcPanel.classList.remove("is-open");
    });

    var out = document.getElementById("topSignOut");
    if (out) out.addEventListener("click", function () {
      var auth = window.trackerAuth;
      var done = function () { window.location.replace("/login"); };
      if (auth && typeof auth.signOut === "function") auth.signOut().then(done, done);
      else done();
    });
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
      var seen = bellSeenAt();
      var unseen = 0;
      list.forEach(function (n) {
        var payload = n.payload || {};
        var title = payload.title || payload.item_title || "";
        var when = n.sent_at || n.scheduled_at || n.created_at;
        if (!seen || String(n.created_at) > seen) unseen++;
        html += '<div class="app-bell-item"><strong>' + escapeHtml(title || sidebarLabel(BELL_LABELS)) + "</strong>" +
                escapeHtml(fmtDate(when, { withTime: true })) + "</div>";
      });
      panel.innerHTML = html;
      var badge = document.getElementById("topBellBadge");
      if (badge && unseen > 0 && !panel.classList.contains("is-open")) {
        badge.textContent = String(unseen);
        badge.hidden = false;
      }
    }).catch(function () { /* التنبيهات ليست حرجة */ });
  }

  /* داخل التطبيق لا يخرج المستخدم من حسابه: روابط الموقع العام تُفتح في تبويب
     جديد، ورابط "تسجيل الدخول" في التذييل لا معنى له بعد الدخول. */
  function keepInsideApp() {
    /* لا شيء يُخرج المستخدم من لوحته: روابط الموقع العام في التذييل تُزال داخل
       التطبيق، وما تبقّى من روابط خارجية يُفتح في تبويب جديد. */
    var footerLinks = document.querySelectorAll(".footer-links");
    for (var f = 0; f < footerLinks.length; f++) footerLinks[f].hidden = true;

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

  function mountTopbar() {
    if (document.getElementById("appTopbar")) return;
    if (!/^\/app\//.test(String(window.location.pathname || ""))) return;
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

  /* القائمة الجانبية تُركّب بعد اكتمال تعريف الواجهة، وأي خطأ فيها لا يوقف الصفحة. */
  function bootSidebar() {
    try { mountSidebar(); } catch (e) { /* تجاهل */ }
    try { mountTopbar(); } catch (e) { /* تجاهل */ }
    try { keepInsideApp(); } catch (e) { /* تجاهل */ }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootSidebar);
  else bootSidebar();
})();
