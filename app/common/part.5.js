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
