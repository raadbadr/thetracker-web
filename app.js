/**
 * app.js — TheTracker shared auth helper (plain script, no modules).
 *
 * Loads after the supabase-js UMD bundle (window.supabase) and exposes
 * window.trackerAuth = {
 *   ready, client, session, unavailable,
 *   getSession(), signInWithGoogle(), signInWithApple(),
 *   signInWithEmail(email), signInWithPhone(phone),
 *   verifyOtp(phone, token), signOut()
 * }
 *
 * - Fetches /api/config → { supabaseUrl, supabaseAnonKey }. If the endpoint
 *   is missing or not configured (503), trackerAuth.unavailable = true and
 *   `ready` still resolves so pages keep working.
 * - On pages with the header login link (#loginMenuBtn) it switches the link
 *   to the dashboard when a session exists; window.__trackerAuthRefresh
 *   re-applies that after setLang().
 * - On login.html (#loginCard) it wires the sign-in buttons and forms.
 */
(function () {
  "use strict";

  var DASHBOARD_PATH = "/app/dashboard.html";
  var LOGIN_PATH = "login.html";
  var CONFIG_URL = "/api/config";
  var GSI_SRC = "https://accounts.google.com/gsi/client";
  var googleClientId = null;   /* عام؛ يأتي من /api/config */

  /* Arabic fallbacks, used only when the page has no `translations` object. */
  var FALLBACK = {
    loginLink: "تسجيل الدخول",
    dashboardLink: "لوحة التحكم",
    statusSending: "جارٍ الإرسال...",
    statusRedirecting: "جارٍ تحويلك إلى مزوّد الخدمة...",
    statusEmailSent: "تحقق من بريدك الإلكتروني، فقد أرسلنا إليك رابط الدخول.",
    statusCodeSent: "أرسلنا رمز التحقق إلى جوالك.",
    statusVerifying: "جارٍ التحقق...",
    statusSuccess: "تم تسجيل الدخول، جارٍ تحويلك...",
    statusWrongCode: "رمز التحقق غير صحيح أو منتهي الصلاحية، حاول مرة أخرى.",
    statusUnavailable: "خدمة تسجيل الدخول غير متاحة حالياً، حاول لاحقاً أو تواصل مع الدعم.",
    statusProviderUnavailable: "هذه الطريقة غير متاحة حالياً، جرّب طريقة أخرى.",
    statusRateLimit: "محاولات كثيرة، حاول مرة أخرى بعد قليل.",
    statusInvalidEmail: "أدخل بريداً إلكترونياً صحيحاً.",
    statusInvalidPhone: "أدخل رقم الجوال بالصيغة الدولية، مثل +9665xxxxxxx",
    statusError: "حدث خطأ، حاول مرة أخرى."
  };

  var auth = {
    ready: null,
    client: null,
    session: null,
    unavailable: false,
    getSession: getSession,
    signInWithGoogle: function () { return signInWithOAuth("google"); },
    signInWithApple: function () { return signInWithOAuth("apple"); },
    signInWithEmail: signInWithEmail,
    signInWithPhone: signInWithPhone,
    verifyOtp: verifyOtp,
    signOut: signOut
  };
  window.trackerAuth = auth;

  /* ---------- i18n helpers (read the page's own translations) ---------- */

  function pageTranslations() {
    try {
      /* `translations` is a top-level const in the page's inline script. */
      return (typeof translations === "object" && translations) ? translations : null;
    } catch (e) {
      return null;
    }
  }

  function currentLang() {
    try {
      if (typeof lang === "function") {
        var l = lang();
        if (l) return l;
      }
    } catch (e) { /* page has no lang() helper */ }
    try {
      return localStorage.getItem("tracker_lang") || "ar";
    } catch (e) {
      return "ar";
    }
  }

  function t(key) {
    var dict = pageTranslations();
    var l = currentLang();
    if (dict && dict[l] && dict[l][key]) return dict[l][key];
    if (dict && dict.ar && dict.ar[key]) return dict.ar[key];
    return FALLBACK[key] || "";
  }

  /* ---------- client bootstrap ---------- */

  /* الوجهة بعد الدخول: المسار المطلوب في ?next= إن كان مساراً داخلياً آمناً
     تحت /app/ (تضعه common.js عند حراسة الصفحات)، وإلا لوحة التحكم. */
  function nextPath() {
    try {
      var n = new URLSearchParams(window.location.search).get("next") || "";
      if (/^\/app\/[A-Za-z0-9._\-\/]*$/.test(n) && n.indexOf("//") === -1 && n.indexOf("..") === -1) {
        return n;
      }
    } catch (e) { /* متصفح قديم بلا URLSearchParams */ }
    return DASHBOARD_PATH;
  }

  function redirectUrl() {
    return window.location.origin + nextPath();
  }

  function unavailableError() {
    var err = new Error("Authentication is not available");
    err.code = "unavailable";
    return err;
  }

  function requireClient() {
    if (!auth.client) throw unavailableError();
    return auth.client;
  }

  function unwrap(result) {
    if (result && result.error) throw result.error;
    return result ? result.data : null;
  }

  function loadConfig() {
    return fetch(CONFIG_URL, { cache: "no-store", headers: { Accept: "application/json" } })
      .then(function (res) {
        if (!res.ok) throw new Error("config unavailable (" + res.status + ")");
        return res.json();
      });
  }

  function init() {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      auth.unavailable = true;
      return Promise.resolve();
    }
    return loadConfig()
      .then(function (cfg) {
        if (!cfg || !cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error("config incomplete");
        googleClientId = cfg.googleClientId || null;
        auth.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
        auth.client.auth.onAuthStateChange(function (_event, session) {
          auth.session = session || null;
          refreshLoginMenu();
        });
        return auth.client.auth.getSession()
          .then(function (r) { auth.session = (r && r.data && r.data.session) || null; })
          .catch(function () { auth.session = null; });
      })
      .catch(function () {
        auth.unavailable = true;
        auth.client = null;
        auth.session = null;
      });
  }

  /* ---------- public API ---------- */

  function getSession() {
    return auth.ready.then(function () {
      if (!auth.client) return null;
      return auth.client.auth.getSession().then(function (r) {
        var s = (r && r.data && r.data.session) || null;
        auth.session = s;
        return s;
      });
    });
  }

  function signInWithOAuth(provider) {
    return auth.ready.then(function () {
      var client = requireClient();
      return client.auth.signInWithOAuth({
        provider: provider,
        options: { redirectTo: redirectUrl() }
      });
    }).then(unwrap);
  }

  function signInWithEmail(email) {
    return auth.ready.then(function () {
      var client = requireClient();
      return client.auth.signInWithOtp({
        email: String(email || "").trim().toLowerCase(),
        options: { emailRedirectTo: redirectUrl() }
      });
    }).then(unwrap);
  }

  function signInWithPhone(phone) {
    return auth.ready.then(function () {
      var client = requireClient();
      return client.auth.signInWithOtp({ phone: String(phone || "").trim() });
    }).then(unwrap);
  }

  function verifyOtp(phone, token) {
    return auth.ready.then(function () {
      var client = requireClient();
      return client.auth.verifyOtp({
        phone: String(phone || "").trim(),
        token: String(token || "").trim(),
        type: "sms"
      });
    }).then(unwrap).then(function (data) {
      if (data && data.session) {
        auth.session = data.session;
        window.location.href = nextPath();
      }
      return data;
    });
  }

  function signOut() {
    return auth.ready.then(function () {
      var client = requireClient();
      return client.auth.signOut();
    }).then(unwrap).then(function (data) {
      auth.session = null;
      refreshLoginMenu();
      return data;
    });
  }

  /* ---------- header login link (#loginMenuBtn) ---------- */

  function refreshLoginMenu() {
    var btn = document.getElementById("loginMenuBtn");
    if (!btn) return;
    var value = document.getElementById("loginMenuValue");
    if (auth.session) {
      if (value) value.textContent = t("dashboardLink");
      btn.setAttribute("href", DASHBOARD_PATH);
    } else {
      if (value) value.textContent = t("loginLink");
      btn.setAttribute("href", LOGIN_PATH);
    }
  }
  window.__trackerAuthRefresh = refreshLoginMenu;

  /* ---------- login.html wiring (#loginCard) ---------- */

  function normalizePhone(raw) {
    var p = String(raw || "").replace(/[\s\-().]/g, "");
    if (/^00\d+$/.test(p)) p = "+" + p.slice(2);
    else if (/^05\d{8}$/.test(p)) p = "+966" + p.slice(1);   /* Saudi local format */
    else if (/^5\d{8}$/.test(p)) p = "+966" + p;
    else if (/^966\d{9}$/.test(p)) p = "+" + p;
    return p;
  }

  function isValidPhone(p) { return /^\+[1-9]\d{7,14}$/.test(p); }
  function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

  function errorKey(err, context) {
    if (!err) return "statusError";
    if (auth.unavailable || err.code === "unavailable") return "statusUnavailable";
    var code = String(err.code || "").toLowerCase();
    var msg = String(err.message || "").toLowerCase();
    var status = Number(err.status || 0);
    if (status === 429 || code.indexOf("rate_limit") !== -1 || msg.indexOf("rate limit") !== -1) return "statusRateLimit";
    if (context === "otp" && (code === "otp_expired" || msg.indexOf("token") !== -1 || msg.indexOf("otp") !== -1 || msg.indexOf("invalid") !== -1)) return "statusWrongCode";
    if (code === "provider_disabled" || code === "email_provider_disabled" || code === "phone_provider_disabled" ||
        code === "otp_disabled" || code === "sms_send_failed" || code === "signup_disabled" ||
        msg.indexOf("not enabled") !== -1 || msg.indexOf("unsupported provider") !== -1 ||
        msg.indexOf("provider is not") !== -1 || msg.indexOf("signups not allowed") !== -1 ||
        msg.indexOf("not supported") !== -1) return "statusProviderUnavailable";
    if (context === "email" && (code === "validation_failed" || msg.indexOf("invalid") !== -1)) return "statusInvalidEmail";
    if (context === "phone" && (code === "validation_failed" || msg.indexOf("invalid") !== -1)) return "statusInvalidPhone";
    return "statusError";
  }

  /* ---------- تسجيل الدخول بجوجل من نطاقنا (Google Identity Services) ----------
     مسار OAuth العادي ينقل المتصفح إلى <project>.supabase.co، فتُظهر جوجل ذلك
     المضيف للمستخدم. زر جوجل الرسمي يبقي نافذة اختيار الحساب على appmails.net،
     ثم نسلّم رمز الهوية (ID token) إلى سوبابيس مباشرة. إن تعذّر تحميل مكتبة جوجل
     نرجع إلى مسار التحويل القديم. */

  var gsiPromise = null;   /* Promise<google.accounts.id | null> */
  var gsiNonce = null;     /* النسخة الأصلية من nonce؛ سوبابيس يطابقها مع بصمتها */

  function randomNonce() {
    var bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    var raw = "";
    for (var i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);
    return window.btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function sha256Hex(text) {
    var data = new window.TextEncoder().encode(text);
    return window.crypto.subtle.digest("SHA-256", data).then(function (buf) {
      var arr = new Uint8Array(buf);
      var out = "";
      for (var i = 0; i < arr.length; i++) out += ("0" + arr[i].toString(16)).slice(-2);
      return out;
    });
  }

  function loadGsi() {
    if (gsiPromise) return gsiPromise;
    gsiPromise = new Promise(function (resolve) {
      if (!googleClientId || !window.crypto || !window.crypto.subtle || !window.TextEncoder) { resolve(null); return; }
      if (window.google && window.google.accounts && window.google.accounts.id) { resolve(window.google.accounts.id); return; }
      var el = document.createElement("script");
      el.src = GSI_SRC;
      el.async = true;
      el.defer = true;
      el.onload = function () {
        resolve((window.google && window.google.accounts && window.google.accounts.id) || null);
      };
      el.onerror = function () { resolve(null); };
      document.head.appendChild(el);
    });
    return gsiPromise;
  }

  function gsiButtonOptions(slot) {
    var width = Math.round((slot.getBoundingClientRect && slot.getBoundingClientRect().width) || 0);
    if (!width) width = 320;
    return {
      type: "standard",
      theme: "outline",              /* زر جوجل الأبيض الرسمي — أوضح على البطاقة الداكنة */
      size: "large",
      text: "signin_with",           /* "تسجيل الدخول باستخدام Google" بالعربية */
      shape: "rectangular",
      logo_alignment: "left",
      locale: currentLang(),
      width: Math.max(200, Math.min(400, width))
    };
  }

  /* يعرض زر جوجل داخل `slot` ويعيد Promise<boolean> بنجاح العرض. */
  function mountGoogleButton(slot, hooks) {
    return loadGsi().then(function (idApi) {
      if (!idApi || !auth.client) return false;
      gsiNonce = randomNonce();
      return sha256Hex(gsiNonce).then(function (hashed) {
        idApi.initialize({
          client_id: googleClientId,
          nonce: hashed,
          ux_mode: "popup",
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: function (resp) {
            var credential = resp && resp.credential;
            if (!credential) { hooks.onError({ code: "gsi_no_credential" }); return; }
            hooks.onStart();
            auth.client.auth.signInWithIdToken({ provider: "google", token: credential, nonce: gsiNonce })
              .then(function (res) {
                if (res && res.error) { hooks.onError(res.error); return; }
                window.location.href = nextPath();
              })
              .catch(function (err) { hooks.onError(err); });
          }
        });
        renderGoogleButton(slot, idApi);
        /* إعادة الرسم عند تغيير المظهر أو اللغة (setTheme/setLang يغيّران <html>). */
        if (typeof MutationObserver !== "undefined") {
          new MutationObserver(function () { renderGoogleButton(slot, idApi); })
            .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "lang", "dir"] });
        }
        return true;
      });
    }).catch(function () { return false; });
  }

  function renderGoogleButton(slot, idApi) {
    try {
      slot.innerHTML = "";
      idApi.renderButton(slot, gsiButtonOptions(slot));
    } catch (e) { /* لو فشل الرسم يظهر الزر البديل */ }
  }

  function initLoginPage() {
    var card = document.getElementById("loginCard");
    if (!card) return;

    var googleBtn = document.getElementById("googleBtn");
    var appleBtn = document.getElementById("appleBtn");
    var emailForm = document.getElementById("emailForm");
    var emailInput = document.getElementById("loginEmail");
    var emailBtn = document.getElementById("emailBtn");
    var phoneForm = document.getElementById("phoneForm");
    var phoneInput = document.getElementById("loginPhone");
    var phoneBtn = document.getElementById("phoneBtn");
    var otpForm = document.getElementById("otpForm");
    var otpInput = document.getElementById("loginOtp");
    var otpBtn = document.getElementById("otpBtn");
    var statusEl = document.getElementById("loginStatus");
    var buttons = [googleBtn, appleBtn, emailBtn, phoneBtn, otpBtn];
    var pendingPhone = "";

    /* Pre-fill the email from ?email=… (the home page waitlist form sends it). */
    try {
      var preset = new URLSearchParams(window.location.search).get("email");
      if (preset && emailInput && !emailInput.value) emailInput.value = preset.trim();
    } catch (e) { /* ignore malformed query */ }

    function setStatus(key, kind) {
      if (!statusEl) return;
      statusEl.textContent = t(key);
      statusEl.className = "waitlist-msg" + (kind ? " " + kind : "");
      statusEl.style.display = "block";
    }

    function setBusy(on) {
      buttons.forEach(function (b) { if (b) b.disabled = !!on; });
    }

    function fail(err, context) {
      setBusy(false);
      setStatus(errorKey(err, context), "error");
    }

    function guardUnavailable() {
      if (auth.unavailable || !auth.client) {
        setStatus("statusUnavailable", "error");
        return true;
      }
      return false;
    }

    /* Re-enable buttons when the page is restored from the back/forward cache. */
    window.addEventListener("pageshow", function (ev) {
      if (ev.persisted) setBusy(false);
    });

    if (googleBtn) googleBtn.addEventListener("click", function () {
      if (guardUnavailable()) return;
      setBusy(true);
      setStatus("statusRedirecting");
      auth.signInWithGoogle().catch(function (err) { fail(err, "oauth"); });
    });

    /* زر جوجل الرسمي يحل مكان الزر أعلاه حين تتوفر مكتبة جوجل ومعرّف العميل. */
    var googleSlot = document.getElementById("googleGsi");
    if (googleSlot) {
      auth.ready.then(function () {
        return mountGoogleButton(googleSlot, {
          onStart: function () { setBusy(true); setStatus("statusVerifying"); },
          onError: function (err) { fail(err, "oauth"); }
        });
      }).then(function (ok) {
        if (ok) return;
        /* تعذّر تحميل مكتبة جوجل: نكشف الزر البديل بمسار التحويل. */
        googleSlot.style.display = "none";
        if (googleBtn) googleBtn.style.display = "";
      }).catch(function () {
        googleSlot.style.display = "none";
        if (googleBtn) googleBtn.style.display = "";
      });
    }

    if (appleBtn) appleBtn.addEventListener("click", function () {
      if (guardUnavailable()) return;
      setBusy(true);
      setStatus("statusRedirecting");
      auth.signInWithApple().catch(function (err) { fail(err, "oauth"); });
    });

    if (emailForm) emailForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var email = String(emailInput ? emailInput.value : "").trim().toLowerCase();
      if (!isValidEmail(email)) { setStatus("statusInvalidEmail", "error"); if (emailInput) emailInput.focus(); return; }
      if (guardUnavailable()) return;
      setBusy(true);
      setStatus("statusSending");
      auth.signInWithEmail(email).then(function () {
        setBusy(false);
        setStatus("statusEmailSent", "success");
      }).catch(function (err) { fail(err, "email"); });
    });

    if (phoneForm) phoneForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var phone = normalizePhone(phoneInput ? phoneInput.value : "");
      if (!isValidPhone(phone)) { setStatus("statusInvalidPhone", "error"); if (phoneInput) phoneInput.focus(); return; }
      if (guardUnavailable()) return;
      if (phoneInput) phoneInput.value = phone;
      setBusy(true);
      setStatus("statusSending");
      auth.signInWithPhone(phone).then(function () {
        pendingPhone = phone;
        setBusy(false);
        if (otpForm) otpForm.style.display = "";
        if (otpInput) { otpInput.value = ""; otpInput.focus(); }
        setStatus("statusCodeSent", "success");
      }).catch(function (err) { fail(err, "phone"); });
    });

    if (otpForm) otpForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var token = String(otpInput ? otpInput.value : "").replace(/\D/g, "");
      if (token.length !== 6 || !pendingPhone) { setStatus("statusWrongCode", "error"); if (otpInput) otpInput.focus(); return; }
      if (guardUnavailable()) return;
      setBusy(true);
      setStatus("statusVerifying");
      auth.verifyOtp(pendingPhone, token).then(function (data) {
        if (data && data.session) {
          setStatus("statusSuccess", "success");      /* verifyOtp already redirects */
        } else {
          setBusy(false);
          setStatus("statusWrongCode", "error");
        }
      }).catch(function (err) { fail(err, "otp"); });
    });

    /* Already signed in → straight to the dashboard. */
    auth.ready.then(function () {
      if (auth.unavailable || !auth.client) {
        setStatus("statusUnavailable", "error");
        return;
      }
      auth.client.auth.onAuthStateChange(function (event, session) {
        if (session && event === "SIGNED_IN") window.location.replace(nextPath());
      });
      return auth.getSession().then(function (session) {
        if (session) window.location.replace(nextPath());
      });
    }).catch(function () { /* never block the page */ });
  }

  /* ---------- boot ---------- */

  auth.ready = init().then(function () {
    refreshLoginMenu();
  });

  function boot() {
    refreshLoginMenu();
    initLoginPage();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
