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

  /* ============================================================
   * حقول التاريخ — المتصفح يفرض ترتيب لغته: على جهاز أمريكي يكتب 08/24/2026،
   * والمتفق عليه في المنصة يوم-شهر-سنة كما تعرضه fmtDate في كل الجداول.
   * ولا تُغيَّر صيغة <input type="date"> لا بـ lang ولا بـ CSS (مجرّب)،
   * فنعرض حقلا نصيا بصيغتنا ونُبقي حقل المتصفح فوق زر التقويم:
   * القيمة والمعرّف والتحقق تبقى كما هي، فلا تتغير صفحة واحدة.
   * ============================================================ */

  var CAL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z"/></svg>';

  /* الرقم يُكتب من اليسار دائما (dir=ltr) فالفراغ في يمين الحقل،
     ولذلك التقويم يمين الحقل فيزيائيا في العربية والإنجليزية معا. */
  var DATE_CSS = [
    ".date-field{position:relative;display:block;width:100%}",
    ".date-field>input[type=text]{width:100%;padding-right:2.9rem;padding-left:.9rem;text-align:left}",
    ".date-field>.date-native{position:absolute;right:0;left:auto;top:0;height:100%;width:46px;",
    "min-width:0;margin:0;padding:0;border:0;background:transparent;opacity:0;cursor:pointer;z-index:2;",
    "color:transparent;-webkit-appearance:none;appearance:none}",
    ".date-field>.date-native::-webkit-calendar-picker-indicator{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;margin:0;padding:0}",
    ".date-field>.date-native::-webkit-datetime-edit,.date-field>.date-native::-webkit-inner-spin-button{opacity:0}",
    ".date-field>.date-ico{position:absolute;right:.85rem;left:auto;top:50%;transform:translateY(-50%);",
    "width:20px;height:20px;color:var(--text-secondary);pointer-events:none;z-index:1}",
    ".date-field>.date-ico svg{width:20px;height:20px;display:block;fill:currentColor}"
  ].join("");

  function dmyMask(v, withTime) {
    var d = String(v || "").replace(/[^0-9]/g, "").slice(0, withTime ? 12 : 8);
    var out = d.slice(0, 2);
    if (d.length > 2) out += "-" + d.slice(2, 4);
    if (d.length > 4) out += "-" + d.slice(4, 8);
    if (withTime && d.length > 8) out += " " + d.slice(8, 10);
    if (withTime && d.length > 10) out += ":" + d.slice(10, 12);
    return out;
  }

  /* يوم-شهر-سنة → قيمة الحقل الأصلية، وnull إن كان التاريخ ناقصا أو غير حقيقي */
  function dmyToValue(v, withTime) {
    var m = String(v || "").match(withTime
      ? /^(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2})$/
      : /^(\d{2})-(\d{2})-(\d{4})$/);
    if (!m) return null;
    var day = +m[1], mon = +m[2], year = +m[3], hh = withTime ? +m[4] : 0, mm = withTime ? +m[5] : 0;
    if (mon < 1 || mon > 12 || day < 1 || day > 31 || year < 1000 || hh > 23 || mm > 59) return null;
    var probe = new Date(year, mon - 1, day);
    if (probe.getMonth() !== mon - 1 || probe.getDate() !== day) return null;
    var iso = m[3] + "-" + m[2] + "-" + m[1];
    return withTime ? iso + "T" + m[4] + ":" + m[5] : iso;
  }

  function valueToDmy(v, withTime) {
    var m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!m) return "";
    var date = m[3] + "-" + m[2] + "-" + m[1];
    return withTime && m[4] ? date + " " + m[4] + ":" + m[5] : date;
  }

  function upgradeDateField(el) {
    var withTime = el.type === "datetime-local";
    var wrap = document.createElement("span");
    wrap.className = "date-field";
    el.parentNode.insertBefore(wrap, el);

    var text = document.createElement("input");
    text.type = "text";
    text.className = el.className;
    text.dir = "ltr";
    text.autocomplete = "off";
    text.setAttribute("inputmode", "numeric");
    text.maxLength = withTime ? 16 : 10;
    text.placeholder = withTime ? "31-12-2026 14:30" : "31-12-2026";
    if (el.disabled) text.disabled = true;
    if (el.getAttribute("aria-label")) text.setAttribute("aria-label", el.getAttribute("aria-label"));
    if (el.id) text.id = el.id + "Text";
    var label = el.closest ? el.closest("label") : null;
    if (label && !label.getAttribute("for")) label.appendChild(document.createComment(""));

    wrap.appendChild(text);
    wrap.appendChild(el);
    var ico = document.createElement("span");
    ico.className = "date-ico";
    ico.innerHTML = CAL_ICON;
    wrap.appendChild(ico);
    el.classList.add("date-native");
    el.setAttribute("aria-hidden", "true");
    el.tabIndex = -1;

    function paint() { if (document.activeElement !== text) text.value = valueToDmy(el.value, withTime); }

    /* أي كود في أي صفحة يكتب el.value = "2026-08-24" يرى الحقل يتحدث فورا */
    var proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (proto && proto.get && proto.set) {
      Object.defineProperty(el, "value", {
        configurable: true,
        get: function () { return proto.get.call(el); },
        set: function (v) { proto.set.call(el, v); paint(); }
      });
    }
    el.addEventListener("change", paint);
    el.addEventListener("input", paint);

    text.addEventListener("input", function () {
      var masked = dmyMask(text.value, withTime);
      if (masked !== text.value) text.value = masked;
      var value = dmyToValue(masked, withTime);
      if (value !== null) { proto.set.call(el, value); fireEvent(el, "change"); }
      else if (!masked) { proto.set.call(el, ""); fireEvent(el, "change"); }
    });
    text.addEventListener("blur", function () {
      var value = dmyToValue(text.value, withTime);
      if (value === null && text.value) { proto.set.call(el, ""); fireEvent(el, "change"); }
      paint();
    });
    paint();
  }

  function fireEvent(el, name) {
    var ev;
    try { ev = new Event(name, { bubbles: true }); }
    catch (e) { ev = document.createEvent("Event"); ev.initEvent(name, true, false); }
    el.dispatchEvent(ev);
  }

  function dateFields(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var list = scope.querySelectorAll('input[type="date"], input[type="datetime-local"]');
    Array.prototype.forEach.call(list, function (el) {
      if (el.getAttribute("data-dmy")) return;
      el.setAttribute("data-dmy", "1");
      try { upgradeDateField(el); } catch (e) { /* الحقل الأصلي يبقى صالحا */ }
    });
  }

  /* form.reset() لا يمر بأي حدث على الحقل، فنعيد الرسم بعده */
  function repaintDateFields() {
    var wraps = document.querySelectorAll(".date-field");
    Array.prototype.forEach.call(wraps, function (wrap) {
      var native = wrap.querySelector(".date-native"), text = wrap.querySelector('input[type="text"]');
      if (!native || !text || document.activeElement === text) return;
      text.value = valueToDmy(native.value, native.type === "datetime-local");
    });
  }

  function bootDateFields() {
    var style = document.createElement("style");
    style.textContent = DATE_CSS;
    document.head.appendChild(style);
    dateFields(document);
    document.addEventListener("reset", function () { setTimeout(repaintDateFields, 0); }, true);
    if (typeof MutationObserver === "undefined") return;
    var pending = null;
    new MutationObserver(function () {
      if (pending) return;
      pending = setTimeout(function () { pending = null; dateFields(document); }, 60);
    }).observe(document.body, { childList: true, subtree: true });
  }

  /* القائمة الجانبية تركب بعد اكتمال تعريف الواجهة، وأي خطأ فيها لا يوقف الصفحة. */
  function bootSidebar() {
    try { mountSidebar(); } catch (e) { /* تجاهل */ }
    try { mountTopbar(); } catch (e) { /* تجاهل */ }
    try { keepInsideApp(); } catch (e) { /* تجاهل */ }
    try { bootDateFields(); } catch (e) { /* تجاهل */ }
    var readyGate = app && app.ready && typeof app.ready.then === "function" ? app.ready : null;
    if (readyGate) readyGate.then(function () {
      try { mountProfileGate(); } catch (e) { /* تجاهل */ }
      try { announceJoinedOrgs(); } catch (e) { /* تجاهل */ }
    }).catch(function () { /* الصفحة تتكفل بالخطأ */ });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootSidebar);
  else bootSidebar();
})();
