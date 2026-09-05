  /* ============================================================
   * منتقي التاريخ الموحد لصفحات التطبيق.
   * منتقي المتصفح الأصلي لا يخدم الثيم (أمر المهندس رعد)، فكل حقل
   * input[type=date] أو input[type=datetime-local] يخفى ويبقى حاملا للقيمة
   * بصيغة ISO (YYYY-MM-DD أو YYYY-MM-DDTHH:MM) كي لا يتغير منطق الصفحات،
   * ويظهر مكانه حقل عرض يوم-شهر-سنة بأرقام غربية (صيغة fmtDate في الجداول) مع المقابل
   * الهجري (أم القرى) تحته، ونافذة معتمة واحدة مشتركة بشبكة ميلادية أو هجرية.
   * ============================================================ */

  var DP_TEXT = {
    ar: { today: "اليوم", clear: "مسح", done: "تم", prev: "الشهر السابق", next: "الشهر التالي", gregorian: "ميلادي", hijri: "هجري",
          hour: "الساعة", minute: "الدقيقة", am: "AM", pm: "PM", era: "هـ", pick: "اختيار التاريخ", weekStart: 0,
          days: ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"],
          monthsG: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
          monthsH: ["محرم", "صفر", "ربيع الأول", "ربيع الآخر", "جمادى الأولى", "جمادى الآخرة", "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة"] },
    en: { today: "Today", clear: "Clear", done: "Done", prev: "Previous month", next: "Next month", gregorian: "Gregorian", hijri: "Hijri",
          hour: "Hour", minute: "Minute", am: "AM", pm: "PM", era: "AH", pick: "Pick a date", weekStart: 1,
          days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
          monthsG: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
          monthsH: ["Muharram", "Safar", "Rabi I", "Rabi II", "Jumada I", "Jumada II", "Rajab", "Shaban", "Ramadan", "Shawwal", "Dhu al-Qadah", "Dhu al-Hijjah"] },
    fr: { today: "Aujourd'hui", clear: "Effacer", done: "OK", prev: "Mois précédent", next: "Mois suivant", gregorian: "Grégorien", hijri: "Hégirien",
          hour: "Heure", minute: "Minute", am: "AM", pm: "PM", era: "AH", pick: "Choisir une date", weekStart: 1,
          days: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
          monthsG: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
          monthsH: ["Mouharram", "Safar", "Rabi I", "Rabi II", "Joumada I", "Joumada II", "Rajab", "Chaabane", "Ramadan", "Chawwal", "Dhou al-Qida", "Dhou al-Hijja"] },
    ur: { today: "آج", clear: "صاف کریں", done: "ہو گیا", prev: "پچھلا مہینہ", next: "اگلا مہینہ", gregorian: "عیسوی", hijri: "ہجری",
          hour: "گھنٹہ", minute: "منٹ", am: "AM", pm: "PM", era: "ھ", pick: "تاریخ منتخب کریں", weekStart: 0,
          days: ["اتوار", "پیر", "منگل", "بدھ", "جمعرات", "جمعہ", "ہفتہ"],
          monthsG: ["جنوری", "فروری", "مارچ", "اپریل", "مئی", "جون", "جولائی", "اگست", "ستمبر", "اکتوبر", "نومبر", "دسمبر"],
          monthsH: ["محرم", "صفر", "ربیع الاول", "ربیع الثانی", "جمادی الاول", "جمادی الثانی", "رجب", "شعبان", "رمضان", "شوال", "ذوالقعدہ", "ذوالحجہ"] }
  };

  var DP_CSS = [
    /* حقل العرض يحل محل الحقل الأصلي في مكانه نفسه ويرث ارتفاع الحقول واستدارتها من القاعدة العامة */
    ".dp-wrap{position:relative;display:block;flex:1 1 auto;min-width:0;max-width:100%}",
    ".dp-wrap>.dp-native{display:none!important}",
    ".dp-wrap>.dp-input{width:100%;min-width:0;cursor:pointer;padding-right:2.6rem;padding-left:.9rem;text-align:left;",
    "background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238A97A3' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='5' width='18' height='16' rx='3'/%3E%3Cpath d='M3 10h18M8 3v4M16 3v4'/%3E%3C/svg%3E\");",
    "background-repeat:no-repeat;background-size:17px 17px;background-position:right .8rem center}",
    ".dp-wrap>.dp-input[readonly]{cursor:pointer}",
    ".dp-sub{margin-top:.2rem;font-size:.72rem;line-height:1.25;color:var(--text-secondary);text-align:start;overflow-wrap:anywhere}",
    ".dp-sub:empty{display:none}",
    /* النافذة: بطاقة زجاجية واحدة مشتركة، فوق الشريطين وتحت بوابة الملف الشخصي */
    ".dp-backdrop{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.45);display:none}",
    ".dp-backdrop.is-open{display:block}",
    ".dp-pop{position:fixed;top:0;left:0;z-index:201;width:min(400px,calc(100vw - 16px));box-sizing:border-box;padding:.85rem;",
    "border-radius:16px;background:var(--bg-mid,#1a2933);border:1px solid var(--glass-border);box-shadow:0 16px 40px rgba(0,0,0,.45),0 0 0 1px var(--glass-border);",
    "color:var(--text-primary);display:none;flex-direction:column;gap:.5rem}",
    ".dp-pop.is-open{display:flex}",
    ".dp-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem}",
    ".dp-title{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;align-items:center;gap:.1rem;text-align:center}",
    ".dp-month{font-size:1rem;font-weight:700;color:var(--text-primary)}",
    ".dp-alt{font-size:.74rem;color:var(--text-secondary)}",
    ".dp-nav{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;padding:0;border:1px solid var(--glass-border);",
    "border-radius:12px;background:transparent;color:var(--text-secondary);cursor:pointer;-webkit-appearance:none;appearance:none}",
    ".dp-nav:hover{background:var(--glass-border);color:var(--text-primary)}",
    ".dp-nav svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}",
    "[dir=rtl] .dp-nav svg{transform:scaleX(-1)}",
    ".dp-cals{display:flex;gap:.3rem;padding:.2rem;border-radius:12px;background:var(--glass);border:1px solid var(--glass-border)}",
    ".dp-pill{flex:1 1 0;min-height:32px;padding:0 .75rem;border:0;border-radius:10px;background:transparent;color:var(--text-secondary);",
    "font:inherit;font-size:.82rem;font-weight:700;cursor:pointer;-webkit-appearance:none;appearance:none}",
    ".dp-pill:hover{color:var(--text-primary)}",
    ".dp-pill.is-active{background:var(--primary);color:var(--btn-ink,#fff)}",
    ".dp-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px}",
    ".dp-dow{min-height:24px;display:flex;align-items:center;justify-content:center;padding:0 1px;font-size:.56rem;line-height:1.1;font-weight:600;letter-spacing:-.01em;",
    "color:var(--text-secondary);text-align:center;white-space:normal;overflow-wrap:anywhere;-webkit-hyphens:auto;hyphens:auto}",
    ".dp-day{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;height:36px;padding:0;border:0;border-radius:10px;",
    "background:transparent;color:var(--text-primary);font:inherit;font-size:.9rem;font-weight:600;line-height:1;cursor:pointer;-webkit-appearance:none;appearance:none}",
    ".dp-day small{font-size:.58rem;font-weight:500;line-height:1;color:var(--text-secondary);margin-top:3px}",
    ".dp-day:hover{background:var(--glass-border)}",
    ".dp-day:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}",
    ".dp-day.is-out{opacity:.35}",
    ".dp-day.is-today{box-shadow:inset 0 0 0 2px var(--primary)}",
    ".dp-day.is-selected,.dp-day.is-selected:hover{background:var(--primary);color:var(--btn-ink,#fff);opacity:1}",
    ".dp-day.is-selected small{color:inherit;opacity:.85}",
    ".dp-time{display:flex;align-items:center;gap:.4rem}",
    ".dp-time select.waitlist-input{flex:1 1 0;min-width:0;padding-inline-start:.6rem}",
    ".dp-colon{font-weight:700;color:var(--text-secondary)}",
    ".dp-foot{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem}",
    ".dp-foot>*{margin:0}",
    ".dp-foot .dp-done{margin-inline-start:auto}",
    /* الجوال: ورقة تخرج من أسفل الشاشة بطبقة تعتيم، وكل هدف لمس 44 بكسل فأكثر */
    "@media(max-width:600px){.dp-pop.is-sheet{top:auto!important;left:0!important;right:0;bottom:0;width:auto;max-height:88vh;overflow-y:auto;",
    "border-radius:20px 20px 0 0;padding:1rem 1rem calc(1rem + env(safe-area-inset-bottom))}",
    ".dp-nav{width:44px;height:44px}.dp-pill{min-height:44px}.dp-day{height:44px;font-size:1rem}.dp-day small{font-size:.62rem}",
    ".dp-foot>button{min-height:44px}.dp-time select.waitlist-input{height:44px;min-height:44px}",
    "body.dp-sheet-open{overflow:hidden}}"
  ].join("");

  var dp = { pop: null, backdrop: null, grid: null, active: null, view: null, cal: "g", hour: 9, minute: 0, gridHtml: "", timeKey: "", lastClose: 0 };
  var dpRecords = [];
  var DP_CAL_KEY = "tracker_dp_cal";
  try { dp.cal = localStorage.getItem(DP_CAL_KEY) === "h" ? "h" : "g"; } catch (e) { /* ميلادي */ }

  function dpText() { return DP_TEXT[lang()] || DP_TEXT.ar; }
  function dpPad(n) { return (n < 10 ? "0" : "") + n; }
  function dpIsRtl() { return String(document.documentElement.getAttribute("dir") || "").toLowerCase() === "rtl"; }
  function dpIsNarrow() { return !!(window.matchMedia && window.matchMedia("(max-width:600px)").matches); }
  function dpHour12() { return !!(app.profile && app.profile.time_format === "12"); }

  /* ---- الهجري بتقويم أم القرى عبر Intl، بمنسق واحد مخبأ ونتائج مخبأة ---- */
  var dpHijriFmt = null, dpHijriCache = {}, dpHijriCacheSize = 0;
  function dpHijri(y, m, d) {
    var key = y + "-" + m + "-" + d;
    if (dpHijriCache[key] !== undefined) return dpHijriCache[key];
    var out = null;
    try {
      if (!dpHijriFmt) dpHijriFmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { timeZone: "UTC", numberingSystem: "latn", year: "numeric", month: "numeric", day: "numeric" });
      var parts = dpHijriFmt.formatToParts(new Date(Date.UTC(y, m, d)));
      out = {};
      parts.forEach(function (p) { if (p.type === "year" || p.type === "month" || p.type === "day") out[p.type] = parseInt(p.value, 10); });
      if (!out.year || !out.month || !out.day) out = null;
    } catch (e) { out = null; }
    if (dpHijriCacheSize > 4000) { dpHijriCache = {}; dpHijriCacheSize = 0; }
    dpHijriCache[key] = out; dpHijriCacheSize++;
    return out;
  }
  /* اليوم الميلادي المطابق لـ (سنة، شهر، يوم) هجريا: تقدير ثم بحث في الأيام المجاورة */
  function dpHijriToGreg(hy, hm, hd) {
    var approx = new Date(Date.UTC(622, 6, 16) + ((hy - 1) * 354.367 + (hm - 1) * 29.53 + (hd - 1)) * 86400000);
    for (var i = 0; i <= 24; i++) {
      var off = i % 2 ? -Math.ceil(i / 2) : i / 2;
      var c = new Date(approx.getTime() + off * 86400000);
      var h = dpHijri(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate());
      if (h && h.year === hy && h.month === hm && h.day === hd) return { y: c.getUTCFullYear(), m: c.getUTCMonth(), d: c.getUTCDate() };
    }
    return null;
  }

  /* ---- القيمة: قراءة ISO من الحقل الأصلي وكتابتها ---- */
  function dpParseValue(native) {
    var m = String(native.value || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!m) return null;
    var p = { y: +m[1], m: +m[2] - 1, d: +m[3], hh: m[4] ? +m[4] : 0, mm: m[5] ? +m[5] : 0 };
    var chk = new Date(p.y, p.m, p.d);
    if (chk.getFullYear() !== p.y || chk.getMonth() !== p.m || chk.getDate() !== p.d) return null;
    return p;
  }
  function dpToValue(kind, y, m, d, hh, mm) {
    var s = y + "-" + dpPad(m + 1) + "-" + dpPad(d);
    return kind === "datetime" ? s + "T" + dpPad(hh || 0) + ":" + dpPad(mm || 0) : s;
  }
  /* يوم-شهر-سنة بأرقام غربية كما تكتبه fmtDate في كل الجداول */
  function dpDmy(y, m, d) { return dpPad(d) + "-" + dpPad(m + 1) + "-" + y; }
  /* الكتابة تقنع نفسها: الأرقام تفصل تلقائيا يوم-شهر-سنة (أو سنة-شهر-يوم إن بدأت بسنة ميلادية أو هجرية) ثم ساعة:دقيقة */
  function dpMask(raw, withTime) {
    var d = String(raw || "").replace(/[^0-9]/g, "").slice(0, withTime ? 12 : 8);
    var y4 = +d.slice(0, 4);
    var yearFirst = d.length >= 4 && ((y4 >= 1300 && y4 < 1600) || (y4 >= 1900 && y4 < 2200)) && +d.slice(2, 4) > 12;
    var out;
    if (yearFirst) { out = d.slice(0, 4); if (d.length > 4) out += "-" + d.slice(4, 6); if (d.length > 6) out += "-" + d.slice(6, 8); }
    else { out = d.slice(0, 2); if (d.length > 2) out += "-" + d.slice(2, 4); if (d.length > 4) out += "-" + d.slice(4, 8); }
    if (withTime && d.length > 8) out += " " + d.slice(8, 10);
    if (withTime && d.length > 10) out += ":" + d.slice(10, 12);
    return out;
  }
  function dpHijriText(t, y, m, d) {
    var h = dpHijri(y, m, d);
    return h ? h.day + " " + t.monthsH[h.month - 1] + " " + h.year + " " + t.era : "";
  }
  function dpTimeText(t, hh, mm) {
    if (!dpHour12()) return dpPad(hh) + ":" + dpPad(mm);
    return ((hh % 12) || 12) + ":" + dpPad(mm) + " " + (hh < 12 ? t.am : t.pm);
  }
  /* للصفحات: التاريخ نفسه ميلاديا وهجريا بلغة الواجهة */
  function formatDateBoth(iso) {
    var t = dpText(), s = String(iso || "").trim(), p = null;
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/);
    if (m) p = { y: +m[1], m: +m[2] - 1, d: +m[3], hh: m[4] ? +m[4] : null, mm: m[5] ? +m[5] : 0 };
    else if (s) { var d = new Date(s); if (!isNaN(d.getTime())) p = { y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), hh: d.getHours(), mm: d.getMinutes() }; }
    if (!p) return { gregorian: "", hijri: "" };
    var g = dpDmy(p.y, p.m, p.d);
    if (p.hh !== null) g += " " + dpTimeText(t, p.hh, p.mm);
    return { gregorian: g, hijri: dpHijriText(t, p.y, p.m, p.d) };
  }

  /* ---- تحسين حقل: يغلف، ويخفى الأصل، ويرسم حقل العرض والسطر الهجري ---- */
  var dpValueDesc = null;
  try { dpValueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value"); } catch (e) { dpValueDesc = null; }

  function dpEnsureStyle() {
    if (document.getElementById("dpStyle")) return;
    var style = document.createElement("style");
    style.id = "dpStyle";
    style.textContent = DP_CSS;
    document.head.appendChild(style);
    /* form.reset() لا يمر بأي حدث على الحقل نفسه، فنعيد الرسم بعده */
    document.addEventListener("reset", function () { setTimeout(function () { dpRecords.forEach(function (r) { dpRefresh(r); }); }, 0); }, true);
  }

  /* ============================================================
   * حاسبة المدة والعدّاد التنازلي (أمر المهندس رعد 2026-09-05):
   * بجانب كل حقل تاريخ يحمل data-duration حقل «المدة بالأيام»: كتابة 60 تضبط
   * التاريخ بعد 60 يوما، واختيار تاريخ يحسب الأيام، وتحته سطر «المتبقي 59 يوما و13 ساعة»
   * يتحدث كل دقيقة. والعناصر التي تحمل data-due (في الجداول) تأخذ النص نفسه بلا إعادة رسم.
   * ============================================================ */
  var DUR_TEXT = {
    ar: { days: "المدة بالأيام", left: "المتبقي {t}", late: "متأخر {t}", today: "ينتهي اليوم", d: ["يوم", "يومان", "{n} أيام", "{n} يوما"], h: ["ساعة", "ساعتان", "{n} ساعات", "{n} ساعة"], and: " و" },
    en: { days: "Duration in days", left: "{t} left", late: "{t} overdue", today: "Ends today", d: ["1 day", "2 days", "{n} days", "{n} days"], h: ["1 hour", "2 hours", "{n} hours", "{n} hours"], and: " and " },
    fr: { days: "Durée en jours", left: "Reste {t}", late: "En retard de {t}", today: "Expire aujourd'hui", d: ["1 jour", "2 jours", "{n} jours", "{n} jours"], h: ["1 heure", "2 heures", "{n} heures", "{n} heures"], and: " et " },
    ur: { days: "مدت (دن)", left: "{t} باقی", late: "{t} تاخیر", today: "آج ختم", d: ["1 دن", "2 دن", "{n} دن", "{n} دن"], h: ["1 گھنٹہ", "2 گھنٹے", "{n} گھنٹے", "{n} گھنٹے"], and: " اور " }
  };
  function durText() { return DUR_TEXT[lang()] || DUR_TEXT.ar; }
  function durUnit(forms, n) {
    var f = n === 1 ? forms[0] : n === 2 ? forms[1] : (n >= 3 && n <= 10 ? forms[2] : forms[3]);
    return f.replace("{n}", String(n));
  }
  /* نص العدّاد لتاريخ ISO: أيام وساعات، أو «ينتهي اليوم»، أو التأخر */
  function remainingText(iso) {
    if (!iso) return "";
    var ms = new Date(iso).getTime() - Date.now();
    if (isNaN(ms)) return "";
    var t = durText(), abs = Math.abs(ms);
    var days = Math.floor(abs / 86400000), hours = Math.floor((abs % 86400000) / 3600000);
    if (ms >= 0 && days === 0 && hours === 0) return t.today;
    var parts = [];
    if (days) parts.push(durUnit(t.d, days));
    if (hours || !days) parts.push(durUnit(t.h, hours));
    var text = parts.join(t.and);
    return (ms >= 0 ? t.left : t.late).replace("{t}", text);
  }
  app.remainingText = remainingText;

  function durDaysFromValue(native) {
    var v = native.value; if (!v) return "";
    var d = new Date(native.type === "datetime-local" ? v : v + "T09:00:00");
    if (isNaN(d.getTime())) return "";
    return String(Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000)));
  }
  function durValueFromDays(native, n) {
    var d = new Date(Date.now() + n * 86400000);
    var pad = function (x) { return (x < 10 ? "0" : "") + x; };
    var ymd = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    if (native.type !== "datetime-local") return ymd;
    /* مدة بالأيام تنتهي بنهاية يومها الأخير (23:59) ما لم يكن للحقل وقت محدد من قبل */
    var cur = native.value && native.value.length >= 16 ? native.value.slice(11, 16) : "23:59";
    return ymd + "T" + cur;
  }
  var durRecords = [];
  function mountDurationCalc(native) {
    if (native.__dur) return;
    var field = native.closest(".form-field") || native.closest("label") || native.parentNode;
    if (!field || !field.parentNode) return;
    var t = durText();
    var wrap = document.createElement("label");
    wrap.className = "form-field dur-field";
    wrap.innerHTML = "<span></span>" +
      '<input type="number" class="waitlist-input dur-days" min="0" max="3650" step="1" inputmode="numeric" dir="ltr" autocomplete="off">' +
      '<span class="dur-countdown" aria-live="polite"></span>';
    field.parentNode.insertBefore(wrap, field.nextSibling);
    var days = wrap.querySelector(".dur-days"), out = wrap.querySelector(".dur-countdown");
    var rec = { native: native, days: days, out: out, label: wrap.firstChild };
    native.__dur = rec; durRecords.push(rec);
    days.addEventListener("input", function () {
      var n = parseInt(days.value, 10);
      if (!isFinite(n) || n < 0) { if (!days.value) { native.value = ""; native.dispatchEvent(new Event("input", { bubbles: true })); durRefresh(rec); } return; }
      native.value = durValueFromDays(native, n);
      native.dispatchEvent(new Event("input", { bubbles: true }));
      native.dispatchEvent(new Event("change", { bubbles: true }));
      durRefresh(rec, true);
    });
    native.addEventListener("input", function () { durRefresh(rec); });
    native.addEventListener("change", function () { durRefresh(rec); });
    var form = native.closest("form");
    if (form) form.addEventListener("reset", function () { setTimeout(function () { durRefresh(rec); }, 0); });
    durRefresh(rec);
  }
  function durRefresh(rec, keepDays) {
    var t = durText();
    if (rec.label.textContent !== t.days) rec.label.textContent = t.days;
    if (!keepDays && document.activeElement !== rec.days) {
      var d = durDaysFromValue(rec.native);
      if (rec.days.value !== d) rec.days.value = d;
    }
    var text = rec.native.value ? remainingText(rec.native.type === "datetime-local" ? rec.native.value : rec.native.value + "T09:00:00") : "";
    if (rec.out.textContent !== text) rec.out.textContent = text;
    rec.out.classList.toggle("is-late", !!rec.native.value && new Date(rec.native.type === "datetime-local" ? rec.native.value : rec.native.value + "T09:00:00").getTime() < Date.now());
  }
  /* عناصر الجداول: <span data-due="ISO"> يمتلئ بالنص ويتحدث كل دقيقة */
  function refreshDueLabels(root) {
    (root || document).querySelectorAll("[data-due]").forEach(function (el) {
      var text = remainingText(el.getAttribute("data-due"));
      if (el.textContent !== text) el.textContent = text;
      el.classList.toggle("is-late", !!text && new Date(el.getAttribute("data-due")).getTime() < Date.now());
    });
  }
  app.refreshDueLabels = refreshDueLabels;
  function durTick() {
    durRecords = durRecords.filter(function (r) { return document.documentElement.contains(r.native); });
    durRecords.forEach(function (r) { durRefresh(r); });
    refreshDueLabels(document);
  }
  setInterval(durTick, 60000);
  if (window.MutationObserver) {
    var durMo = new MutationObserver(function (muts) {
      var need = false;
      muts.forEach(function (m) { [].forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1 && (n.hasAttribute && n.hasAttribute("data-due") || n.querySelector && n.querySelector("[data-due]"))) need = true; }); });
      if (need) refreshDueLabels(document);
    });
    if (document.body) durMo.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener("DOMContentLoaded", function () { durMo.observe(document.body, { childList: true, subtree: true }); });
  }

  function enhanceDateInputs(root) {
    var scope = root && root.querySelectorAll ? root : document;
    dpEnsureStyle();
    dpRecords = dpRecords.filter(function (r) { return document.documentElement.contains(r.native); });
    if (dp.active && dpRecords.indexOf(dp.active) === -1) dpClose(false);
    var sel = "input[type=date]:not([data-dp]),input[type=datetime-local]:not([data-dp])";
    var list = Array.prototype.slice.call(scope.querySelectorAll(sel));
    if (scope !== document && scope.matches && scope.matches(sel)) list.unshift(scope);
    list.forEach(function (native) { try { dpEnhance(native); } catch (e) { /* يبقى الحقل الأصلي */ } });
    (root || document).querySelectorAll('input[data-duration]').forEach(function (native) { try { mountDurationCalc(native); } catch (e) { /* الحقل يبقى بلا حاسبة */ } });
  }

  function dpEnhance(native) {
    if (!native.parentNode || native.closest(".dp-pop")) return;
    native.setAttribute("data-dp", "1");
    var rec = { native: native, kind: native.type === "datetime-local" ? "datetime" : "date", dirty: false };
    var wrap = document.createElement("div");
    wrap.className = "dp-wrap";
    native.parentNode.insertBefore(wrap, native);
    var display = document.createElement("input");
    display.type = "text";
    display.className = "waitlist-input dp-input";
    display.dir = "ltr";
    display.setAttribute("autocomplete", "off");
    display.setAttribute("spellcheck", "false");
    display.setAttribute("inputmode", "numeric");
    display.maxLength = rec.kind === "datetime" ? 16 : 10;
    display.setAttribute("aria-haspopup", "dialog");
    display.setAttribute("aria-expanded", "false");
    display.setAttribute("placeholder", native.getAttribute("placeholder") || (rec.kind === "datetime" ? "31-12-2026 14:30" : "31-12-2026"));
    var sub = document.createElement("div");
    sub.className = "dp-sub";
    /* حقل العرض أولا ليكون هو ما تشير إليه بطاقة label عند النقر عليها */
    wrap.appendChild(display);
    wrap.appendChild(native);
    wrap.appendChild(sub);
    native.classList.add("dp-native");
    native.tabIndex = -1;
    native.setAttribute("aria-hidden", "true");
    rec.wrap = wrap; rec.display = display; rec.sub = sub;
    native.__dp = rec;
    dpRecords.push(rec);
    dpHookValue(rec);
    dpBind(rec);
    dpRefresh(rec);
  }

  /* الصفحات تكتب القيمة مباشرة (el.value = ...) بلا أحداث: نلتقط الكتابة على هذا العنصر وحده */
  function dpHookValue(rec) {
    if (!dpValueDesc || !dpValueDesc.set || !dpValueDesc.get) return;
    try {
      Object.defineProperty(rec.native, "value", {
        configurable: true, enumerable: true,
        get: function () { return dpValueDesc.get.call(this); },
        set: function (v) { dpValueDesc.set.call(this, v); dpRefresh(rec); }
      });
    } catch (e) { /* يكفي التحديث عند الفتح */ }
    if (window.MutationObserver) {
      new MutationObserver(function () { dpRefresh(rec); }).observe(rec.native, { attributes: true, attributeFilter: ["value", "disabled", "readonly"] });
    }
  }

  function dpRefresh(rec) {
    var t = dpText(), p = dpParseValue(rec.native);
    var typing = rec.dirty && document.activeElement === rec.display;
    rec.display.readOnly = dpIsNarrow() || rec.native.readOnly;
    rec.display.disabled = rec.native.disabled;
    rec.display.setAttribute("aria-label", t.pick);
    var text = "", hijri = "";
    if (p) {
      text = dpDmy(p.y, p.m, p.d) + (rec.kind === "datetime" ? " " + dpTimeText(t, p.hh, p.mm) : "");
      hijri = dpHijriText(t, p.y, p.m, p.d);
    } else if (rec.native.value) text = String(rec.native.value);
    if (!typing) { rec.dirty = false; if (rec.display.value !== text) rec.display.value = text; }
    if (rec.sub.textContent !== hijri) rec.sub.textContent = hijri;
    if (rec.native.__dur) durRefresh(rec.native.__dur);   /* حاسبة المدة تتبع القيمة المكتوبة برمجيا أيضا */
  }

  function dpSetValue(rec, value) {
    var before = rec.native.value;
    rec.native.value = value;
    dpRefresh(rec);
    if (before !== rec.native.value) {
      rec.native.dispatchEvent(new Event("input", { bubbles: true }));
      rec.native.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (dp.active === rec) dpRender();
  }

  /* ما يكتبه المستخدم في حقل العرض: 22/09/2026 أو 2026-09-22 أو 1448/03/10 هجريا، وبعده وقت اختياري 09:30 */
  function dpCommitTyped(rec) {
    var raw = String(rec.display.value || "").trim();
    rec.dirty = false;
    if (!raw) { dpSetValue(rec, ""); return; }
    var time = null;
    var tm = raw.match(/\s+(\d{1,2})[:.](\d{2})\s*([aApP][mM]|ص|م)?$/);
    if (tm) {
      time = { hh: +tm[1], mm: +tm[2] };
      if (tm[3] && /^[pP]|م/.test(tm[3]) && time.hh < 12) time.hh += 12;
      if (tm[3] && /^[aA]|ص/.test(tm[3]) && time.hh === 12) time.hh = 0;
      if (time.hh > 23 || time.mm > 59) time = null;
      raw = raw.slice(0, tm.index).trim();
    }
    var iso = typeof parseAnyDate === "function" ? parseAnyDate(raw) : null;
    if (!iso) { dpRefresh(rec); return; }
    var cur = dpParseValue(rec.native);
    var hh = time ? time.hh : (cur ? cur.hh : dp.hour), mm = time ? time.mm : (cur ? cur.mm : dp.minute);
    dpSetValue(rec, dpToValue(rec.kind, +iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), hh, mm));
  }

  function dpMoveDays(rec, delta) {
    var cur = dpParseValue(rec.native);
    var base = cur ? new Date(cur.y, cur.m, cur.d) : new Date();
    var n = new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta);
    dpSetValue(rec, dpToValue(rec.kind, n.getFullYear(), n.getMonth(), n.getDate(), cur ? cur.hh : dp.hour, cur ? cur.mm : dp.minute));
    if (dp.active === rec) { dpSetView(dp.view.cal, n); dpRender(); }
  }

  function dpBind(rec) {
    var display = rec.display;
    display.addEventListener("focus", function () {
      if (Date.now() - dp.lastClose < 300) return;
      dpOpen(rec);
    });
    display.addEventListener("click", function () { if (dp.active !== rec) dpOpen(rec); });
    display.addEventListener("input", function () {
      rec.dirty = true;
      if (/[^0-9\-\/. :]/.test(display.value)) return;
      var masked = dpMask(display.value, rec.kind === "datetime");
      if (masked !== display.value) display.value = masked;
      var complete = rec.kind === "datetime" ? /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/.test(masked) : /^\d{2}-\d{2}-\d{4}$/.test(masked);
      if (complete) dpCommitTyped(rec);
    });
    display.addEventListener("blur", function () { if (rec.dirty) dpCommitTyped(rec); });
    display.addEventListener("keydown", function (e) {
      var k = e.key;
      if (k === "Escape") { if (dp.active === rec) { e.preventDefault(); dpClose(false); } return; }
      if (k === "Tab") { if (dp.active === rec) dpClose(false); return; }
      if (k === "Enter") { e.preventDefault(); if (rec.dirty) dpCommitTyped(rec); else if (dp.active === rec) dpClose(false); else dpOpen(rec); return; }
      if (k === " " && !rec.dirty) { e.preventDefault(); if (dp.active !== rec) dpOpen(rec); return; }
      if (rec.dirty) return;
      var rtl = rec.display.dir === "rtl";
      var step = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1, ArrowUp: -7, ArrowDown: 7 }[k];
      if (step) { e.preventDefault(); dpMoveDays(rec, step); }
    });
    rec.native.addEventListener("change", function () { dpRefresh(rec); });
    rec.native.addEventListener("input", function () { dpRefresh(rec); });
  }

  /* ---- النافذة المشتركة ---- */
  function dpEnsurePop() {
    if (dp.pop) return;
    var backdrop = document.createElement("div");
    backdrop.className = "dp-backdrop";
    var pop = document.createElement("div");
    pop.className = "dp-pop";
    pop.setAttribute("role", "dialog");
    pop.innerHTML =
      '<div class="dp-head">' +
        '<button type="button" class="dp-nav dp-prev"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>' +
        '<div class="dp-title"><strong class="dp-month"></strong><span class="dp-alt"></span></div>' +
        '<button type="button" class="dp-nav dp-next"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>' +
      "</div>" +
      '<div class="dp-cals" role="tablist"><button type="button" class="dp-pill" data-cal="g" role="tab"></button><button type="button" class="dp-pill" data-cal="h" role="tab"></button></div>' +
      '<div class="dp-grid" role="grid"></div>' +
      '<div class="dp-time" hidden><select class="waitlist-input dp-hour"></select><span class="dp-colon">:</span><select class="waitlist-input dp-min"></select><select class="waitlist-input dp-mer" hidden></select></div>' +
      '<div class="dp-foot"><button type="button" class="chat-option-btn dp-today"></button><button type="button" class="chat-option-btn dp-clear"></button><button type="button" class="waitlist-btn dp-done" hidden></button></div>';
    document.body.appendChild(backdrop);
    document.body.appendChild(pop);
    dp.pop = pop; dp.backdrop = backdrop;
    dp.grid = pop.querySelector(".dp-grid");

    pop.addEventListener("click", function (e) {
      var rec = dp.active; if (!rec) return;
      var day = e.target.closest(".dp-day");
      if (day) { dpSelectDay(+day.getAttribute("data-y"), +day.getAttribute("data-m"), +day.getAttribute("data-d")); return; }
      if (e.target.closest(".dp-prev")) { dpShiftView(-1); dpRender(); return; }
      if (e.target.closest(".dp-next")) { dpShiftView(1); dpRender(); return; }
      var pill = e.target.closest(".dp-pill");
      if (pill) { dpSwitchCal(pill.getAttribute("data-cal")); return; }
      if (e.target.closest(".dp-today")) { var n = new Date(); dpSelectDay(n.getFullYear(), n.getMonth(), n.getDate()); return; }
      if (e.target.closest(".dp-clear")) { dpSetValue(rec, ""); dpClose(true); return; }
      if (e.target.closest(".dp-done")) { dpClose(true); }
    });
    pop.addEventListener("change", function (e) {
      if (!e.target.closest(".dp-time")) return;
      dpReadTime();
      var rec = dp.active, cur = rec ? dpParseValue(rec.native) : null;
      if (rec && cur) dpSetValue(rec, dpToValue(rec.kind, cur.y, cur.m, cur.d, dp.hour, dp.minute));
    });
    pop.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); dpClose(true); return; }
      var day = e.target.closest ? e.target.closest(".dp-day") : null;
      if (!day) return;
      var rtl = dpIsRtl();
      var step = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (!step) return;
      e.preventDefault();
      var days = Array.prototype.slice.call(dp.grid.querySelectorAll(".dp-day"));
      var i = days.indexOf(day) + step;
      if (i < 0) { dpShiftView(-1); dpRender(); days = dp.grid.querySelectorAll(".dp-day"); i = Math.max(0, days.length + i - 7); }
      else if (i >= days.length) { dpShiftView(1); dpRender(); days = dp.grid.querySelectorAll(".dp-day"); i = Math.min(days.length - 1, i - days.length + 7); }
      if (days[i]) days[i].focus();
    });
    backdrop.addEventListener("click", function () { dpClose(false); });
    var outside = function (e) {
      var rec = dp.active; if (!rec) return;
      if (dp.pop.contains(e.target) || rec.wrap.contains(e.target)) return;
      dpClose(false);
    };
    document.addEventListener("mousedown", outside, true);
    document.addEventListener("touchstart", outside, { capture: true, passive: true });
    window.addEventListener("resize", function () {
      dpRecords.forEach(function (r) { r.display.readOnly = dpIsNarrow() || r.native.readOnly; });
      if (dp.active) dpLayout();
    });
    document.addEventListener("scroll", function () { if (dp.active && !dp.pop.classList.contains("is-sheet")) dpPosition(); }, { capture: true, passive: true });
  }

  function dpOpen(rec) {
    if (rec.native.disabled || rec.native.readOnly) return;
    dpEnsurePop();
    if (dp.active && dp.active !== rec) dpClose(false);
    dp.active = rec;
    var cur = dpParseValue(rec.native);
    dp.hour = cur ? cur.hh : 9; dp.minute = cur ? cur.mm : 0;
    dpSetView(dp.cal, cur ? new Date(cur.y, cur.m, cur.d) : new Date());
    dp.gridHtml = "";
    rec.display.setAttribute("aria-expanded", "true");
    dp.pop.classList.add("is-open");
    dpRender();
    dpLayout();
  }

  function dpClose(refocus) {
    var rec = dp.active;
    if (!rec) return;
    dp.active = null;
    dp.lastClose = Date.now();
    dp.pop.classList.remove("is-open");
    dp.backdrop.classList.remove("is-open");
    document.body.classList.remove("dp-sheet-open");
    rec.display.setAttribute("aria-expanded", "false");
    if (refocus) { try { rec.display.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  /* ورقة سفلية على الجوال، ونافذة تحت الحقل (أو فوقه إن ضاق المكان) على الحاسب */
  function dpLayout() {
    var narrow = dpIsNarrow();
    dp.pop.classList.toggle("is-sheet", narrow);
    dp.backdrop.classList.toggle("is-open", narrow);
    document.body.classList.toggle("dp-sheet-open", narrow);
    dpPosition();
  }
  function dpPosition() {
    var pop = dp.pop, rec = dp.active;
    if (!rec) return;
    if (pop.classList.contains("is-sheet")) { pop.style.top = ""; pop.style.left = ""; return; }
    var r = rec.display.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    var pw = pop.offsetWidth, ph = pop.offsetHeight;
    var rtl = dpIsRtl();
    var left = rtl ? r.right - pw : r.left;
    left = Math.max(8, Math.min(left, vw - pw - 8));
    var top = r.bottom + 6;
    if (top + ph > vh - 8) {
      var above = r.top - 6 - ph;
      if (above >= 8) top = above;
      else {
        /* لا مكان تحت الحقل ولا فوقه: بجانبه (جهة نهاية السطر أولا) إن اتسع العرض، وإلا داخل الشاشة فحسب */
        var sides = rtl ? [r.left - 8 - pw, r.right + 8] : [r.right + 8, r.left - 8 - pw];
        for (var s = 0; s < sides.length; s++) { if (sides[s] >= 8 && sides[s] + pw <= vw - 8) { left = sides[s]; break; } }
        top = Math.max(8, Math.min(r.top, vh - ph - 8));
      }
    }
    pop.style.left = Math.round(left) + "px";
    pop.style.top = Math.round(top) + "px";
  }

  function dpSetView(cal, date) {
    var v = { cal: cal === "h" ? "h" : "g", y: date.getFullYear(), m: date.getMonth() };
    var h = dpHijri(v.y, v.m, date.getDate());
    if (!h) v.cal = "g";
    v.hy = h ? h.year : 0; v.hm = h ? h.month : 0;
    dp.view = v;
  }
  function dpShiftView(delta) {
    var v = dp.view;
    if (v.cal === "h") {
      var hm = v.hm + delta, hy = v.hy;
      while (hm < 1) { hm += 12; hy--; }
      while (hm > 12) { hm -= 12; hy++; }
      var g = dpHijriToGreg(hy, hm, 1);
      if (!g) return;
      v.hy = hy; v.hm = hm; v.y = g.y; v.m = g.m;
    } else {
      var d = new Date(v.y, v.m + delta, 1);
      v.y = d.getFullYear(); v.m = d.getMonth();
      var h = dpHijri(v.y, v.m, 1);
      if (h) { v.hy = h.year; v.hm = h.month; }
    }
  }
  function dpSwitchCal(cal) {
    var rec = dp.active, v = dp.view;
    if (!rec || cal === v.cal) return;
    var cur = dpParseValue(rec.native), anchor = null;
    if (cur) {
      var inView = v.cal === "h" ? (function () { var h = dpHijri(cur.y, cur.m, cur.d); return h && h.year === v.hy && h.month === v.hm; })() : (cur.y === v.y && cur.m === v.m);
      if (inView) anchor = new Date(cur.y, cur.m, cur.d);
    }
    if (!anchor) { var g = v.cal === "h" ? dpHijriToGreg(v.hy, v.hm, 1) : { y: v.y, m: v.m, d: 1 }; anchor = g ? new Date(g.y, g.m, g.d) : new Date(); }
    dp.cal = cal === "h" ? "h" : "g";
    try { localStorage.setItem(DP_CAL_KEY, dp.cal); } catch (e) { /* ignore */ }
    dpSetView(dp.cal, anchor);
    dpRender();
  }

  function dpSelectDay(y, m, d) {
    var rec = dp.active;
    if (!rec) return;
    dpSetValue(rec, dpToValue(rec.kind, y, m, d, dp.hour, dp.minute));
    if (rec.kind === "date") dpClose(true);
  }

  function dpReadTime() {
    var pop = dp.pop;
    var h = +pop.querySelector(".dp-hour").value, mn = +pop.querySelector(".dp-min").value;
    if (dpHour12()) { var pm = pop.querySelector(".dp-mer").value === "pm"; h = (h % 12) + (pm ? 12 : 0); }
    dp.hour = h; dp.minute = mn;
  }
  function dpFillTime(t) {
    var pop = dp.pop, h12 = dpHour12(), key = lang() + ":" + (h12 ? "12" : "24");
    var hourSel = pop.querySelector(".dp-hour"), minSel = pop.querySelector(".dp-min"), merSel = pop.querySelector(".dp-mer");
    if (dp.timeKey !== key) {
      dp.timeKey = key;
      var hh = "", i;
      if (h12) for (i = 1; i <= 12; i++) hh += '<option value="' + i + '">' + i + "</option>";
      else for (i = 0; i < 24; i++) hh += '<option value="' + i + '">' + dpPad(i) + "</option>";
      hourSel.innerHTML = hh;
      var mm = "";
      for (i = 0; i < 60; i++) mm += '<option value="' + i + '">' + dpPad(i) + "</option>";
      minSel.innerHTML = mm;
      merSel.innerHTML = '<option value="am">' + escapeHtml(t.am) + '</option><option value="pm">' + escapeHtml(t.pm) + "</option>";
      hourSel.setAttribute("aria-label", t.hour); minSel.setAttribute("aria-label", t.minute);
    }
    merSel.hidden = !h12;
    hourSel.value = String(h12 ? ((dp.hour % 12) || 12) : dp.hour);
    minSel.value = String(dp.minute);
    if (h12) merSel.value = dp.hour < 12 ? "am" : "pm";
  }

  /* الشبكة: 6 أسابيع، في الوضع الهجري تتبع الشهر الهجري وتكتب أيامه، والعدد الصغير هو مقابل اليوم في التقويم الآخر */
  function dpCells(t) {
    var v = dp.view, cells = [], start, i;
    if (v.cal === "h") {
      var g = dpHijriToGreg(v.hy, v.hm, 1);
      if (!g) { v.cal = "g"; return dpCells(t); }
      start = new Date(g.y, g.m, g.d);
    } else start = new Date(v.y, v.m, 1);
    var offset = (start.getDay() - t.weekStart + 7) % 7;
    for (i = 0; i < 42; i++) {
      var c = new Date(start.getFullYear(), start.getMonth(), start.getDate() - offset + i);
      var cy = c.getFullYear(), cm = c.getMonth(), cd = c.getDate();
      var h = dpHijri(cy, cm, cd);
      var inMonth = v.cal === "h" ? !!(h && h.year === v.hy && h.month === v.hm) : cm === v.m;
      cells.push({ y: cy, m: cm, d: cd, h: h, inMonth: inMonth, main: v.cal === "h" ? (h ? h.day : "") : cd, small: v.cal === "h" ? cd : (h ? h.day : "") });
    }
    return cells;
  }
  function dpSpan(names, a, b, era) {
    if (!a || !b) return "";
    if (a.month === b.month && a.year === b.year) return names[a.month - 1] + " " + a.year + era;
    if (a.year === b.year) return names[a.month - 1] + " - " + names[b.month - 1] + " " + a.year + era;
    return names[a.month - 1] + " " + a.year + " - " + names[b.month - 1] + " " + b.year + era;
  }

  function dpRender() {
    var rec = dp.active;
    if (!rec || !dp.pop) return;
    var t = dpText(), v = dp.view, pop = dp.pop;
    var cur = dpParseValue(rec.native), now = new Date();
    var cells = dpCells(t);
    var first = null, last = null;
    cells.forEach(function (c) { if (c.inMonth) { if (!first) first = c; last = c; } });
    var title, alt;
    if (v.cal === "h") {
      title = t.monthsH[v.hm - 1] + " " + v.hy + " " + t.era;
      alt = first && last ? dpSpan(t.monthsG, { month: first.m + 1, year: first.y }, { month: last.m + 1, year: last.y }, "") : "";
    } else {
      title = t.monthsG[v.m] + " " + v.y;
      alt = first && last ? dpSpan(t.monthsH, first.h, last.h, " " + t.era) : "";
    }
    pop.querySelector(".dp-month").textContent = title;
    pop.querySelector(".dp-alt").textContent = alt;
    pop.querySelector(".dp-prev").setAttribute("aria-label", t.prev);
    pop.querySelector(".dp-next").setAttribute("aria-label", t.next);
    pop.setAttribute("aria-label", t.pick);
    pop.setAttribute("lang", lang());
    Array.prototype.forEach.call(pop.querySelectorAll(".dp-pill"), function (b) {
      var isH = b.getAttribute("data-cal") === "h";
      b.textContent = isH ? t.hijri : t.gregorian;
      b.classList.toggle("is-active", (v.cal === "h") === isH);
      b.setAttribute("aria-selected", (v.cal === "h") === isH ? "true" : "false");
    });
    var html = "";
    for (var i = 0; i < 7; i++) html += '<div class="dp-dow" role="columnheader">' + escapeHtml(t.days[(t.weekStart + i) % 7]) + "</div>";
    cells.forEach(function (c) {
      var isToday = c.y === now.getFullYear() && c.m === now.getMonth() && c.d === now.getDate();
      var isSel = !!(cur && cur.y === c.y && cur.m === c.m && cur.d === c.d);
      var label = dpDmy(c.y, c.m, c.d) + (c.h ? " - " + c.h.day + " " + t.monthsH[c.h.month - 1] + " " + c.h.year + " " + t.era : "");
      html += '<button type="button" class="dp-day' + (c.inMonth ? "" : " is-out") + (isToday ? " is-today" : "") + (isSel ? " is-selected" : "") +
        '" role="gridcell" data-y="' + c.y + '" data-m="' + c.m + '" data-d="' + c.d + '" aria-label="' + escapeHtml(label) + '"' +
        (isToday ? ' aria-current="date"' : "") + (isSel ? ' aria-pressed="true"' : "") + ">" + c.main + "<small>" + c.small + "</small></button>";
    });
    if (html !== dp.gridHtml) { dp.gridHtml = html; dp.grid.innerHTML = html; }
    var timeRow = pop.querySelector(".dp-time");
    timeRow.hidden = rec.kind !== "datetime";
    if (rec.kind === "datetime") dpFillTime(t);
    pop.querySelector(".dp-today").textContent = t.today;
    pop.querySelector(".dp-clear").textContent = t.clear;
    var done = pop.querySelector(".dp-done");
    done.hidden = rec.kind !== "datetime";
    done.textContent = t.done;
  }

  /* تغيير لغة الواجهة يعيد كتابة النصوص المعروضة، لا أكثر */
  function dpOnLang() {
    dpRecords.forEach(dpRefresh);
    if (dp.active) { dp.timeKey = ""; dp.gridHtml = ""; dpRender(); dpPosition(); }
  }

  app.enhanceDateInputs = enhanceDateInputs;
  app.formatDateBoth = formatDateBoth;

  if (/^\/app\//.test(String(window.location.pathname || ""))) {
    var dpTimer = null;
    var dpSchedule = function () { clearTimeout(dpTimer); dpTimer = setTimeout(function () { enhanceDateInputs(document); }, 80); };
    var dpArm = function () {
      try { enhanceDateInputs(document); } catch (e) { /* تبقى الحقول الأصلية */ }
      if (window.MutationObserver) {
        new MutationObserver(dpSchedule).observe(document.documentElement, { childList: true, subtree: true });
        new MutationObserver(dpOnLang).observe(document.documentElement, { attributes: true, attributeFilter: ["lang", "dir"] });
      }
    };
    var dpReady = app && app.ready && typeof app.ready.then === "function" ? app.ready : null;
    if (dpReady) dpReady.then(dpArm, dpArm);
    else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", dpArm);
    else dpArm();
  }

