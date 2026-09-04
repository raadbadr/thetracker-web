/**
 * تحليل المستندات — /api/documents/analyze
 * يستقبل نص مستند (مستخرج من PDF في المتصفح) أو صورة (base64)، ويعيد حقولا
 * منظمة: نوع المستند، عنوانه، رقمه، الجهة، تاريخ الإصدار، تاريخ الانتهاء، المبلغ،
 * رقم الدعوى، الشركة. الصور تقرأ بنموذج رؤية من Workers AI ثم يستخرج منها.
 * لا يخزن شيء هنا؛ الحفظ يتم من المتصفح عبر سوبابيس بصلاحيات المستخدم.
 */

const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const MAX_TEXT = 12000;

const DOC_KINDS = [
  "commercial_register",   // السجل التجاري
  "articles_of_association", // عقد تأسيس الشركة
  "bylaws",                // النظام الأساسي
  "chamber_certificate",   // شهادة الغرفة التجارية
  "gosi_certificate",      // شهادة التأمينات الاجتماعية
  "zakat_certificate",     // شهادة الزكاة والدخل
  "saudization_certificate", // شهادة السعودة / نطاقات
  "lease_contract",        // عقد إيجار
  "vat_certificate",       // الشهادة الضريبية
  "license",               // رخصة (بلدية، مهنية، دفاع مدني…)
  "contract",              // عقد
  "case_filing",           // صحيفة دعوى / لائحة / مرفوعات قضائية
  "court_ruling",          // حكم قضائي
  "hearing_notice",        // إشعار جلسة
  "violation",             // مخالفة
  "invoice",               // فاتورة
  "power_of_attorney",     // وكالة شرعية
  "id_document",           // هوية / إقامة
  "passport",              // جواز سفر
  "driving_license",       // رخصة قيادة
  "vehicle_registration",  // استمارة مركبة
  "insurance_policy",      // وثيقة تأمين
  "employment_contract",   // عقد عمل
  "other",
];

function extractionPrompt(text) {
  return `أنت مساعد قانوني في مكتب محاماة سعودي. اقرأ نص المستند التالي واستخرج حقوله في JSON فقط بلا أي كلام آخر.

المفاتيح المطلوبة (اتركها null إن لم توجد):
{
  "kind": واحد من ${JSON.stringify(DOC_KINDS)},
  "title": عنوان قصير واضح بالعربية (مثل "السجل التجاري لشركة كذا"),
  "number": رقم المستند الرئيسي (رقم السجل / الرقم الضريبي / رقم الرخصة / رقم الصك…),
  "issuer": الجهة المصدرة,
  "party": اسم الشركة أو الشخص صاحب المستند,
  "issue_date": التاريخ كما هو مكتوب في المستند بصيغة "YYYY-MM-DD" بدون تحويل (إن كان هجريا اكتبه هجريا مثل "1446-03-12"),
  "issue_date_calendar": "hijri" أو "gregorian",
  "expiry_date": تاريخ الانتهاء أو الاستحقاق أو الجلسة القادمة كما هو مكتوب بصيغة "YYYY-MM-DD" بدون تحويل,
  "expiry_date_calendar": "hijri" أو "gregorian",
  "amount": رقم بالريال إن وجد مبلغ,
  "case_number": رقم الدعوى أو القضية إن وجد,
  "court": المحكمة إن وجدت,
  "summary": جملة واحدة تصف المستند,
  "confidence": رقم من 0 إلى 1
}

قواعد: لا تحول بين التقويمين أبدا، فقط انسخ التاريخ كما ورد وحدد تقويمه (السنوات 13xx و14xx هجرية، و19xx و20xx ميلادية). الأرقام غربية. لا تخترع قيما غير موجودة في النص.

النص:
"""
${text}
"""`;
}

function parseJson(raw) {
  const text = String(raw || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

/* تحويل هجري (أم القرى) → ميلادي حسابيا: نقدر اليوم ثم نبحث حوله عن اليوم الذي
   ينتج التاريخ الهجري نفسه في Intl. لا نثق بتحويل النموذج اللغوي. */
const HIJRI_FMT = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: "numeric", year: "numeric" });
function hijriParts(date) {
  const out = {};
  for (const part of HIJRI_FMT.formatToParts(date)) if (part.type !== "literal") out[part.type] = parseInt(part.value, 10);
  return out;
}
function hijriToGregorian(year, month, day) {
  // تقدير: 1 محرم 1 ه ≈ 16 يوليو 622 م، والسنة الهجرية 354.367 يوما
  const approx = new Date(Date.UTC(622, 6, 16) + ((year - 1) * 354.367 + (month - 1) * 29.53 + (day - 1)) * 86400000);
  for (let dayOffset = -40; dayOffset <= 40; dayOffset++) {
    const candidate = new Date(approx.getTime() + dayOffset * 86400000);
    const hijri = hijriParts(candidate);
    if (hijri.year === year && hijri.month === month && hijri.day === day) return candidate;
  }
  return null;
}
function normalizeDate(value, calendar) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (!match) return null;
  const year = +match[1], month = +match[2], day = +match[3];
  const isHijri = calendar === "hijri" || (year >= 1300 && year < 1600);
  if (isHijri) {
    const gregorianDate = hijriToGregorian(year, month, day);
    return gregorianDate ? gregorianDate.toISOString().slice(0, 10) : null;
  }
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function clean(out) {
  const source = out && typeof out === "object" ? out : {};
  const date = (value, calendarName) => normalizeDate(value, calendarName);
  const num = (value) => { const numeric = Number(String(value ?? "").replace(/[^0-9.\-]/g, "")); return isFinite(numeric) && numeric !== 0 ? numeric : null; };
  const str = (value) => (value == null ? null : String(value).trim().slice(0, 300) || null);
  return {
    kind: DOC_KINDS.includes(source.kind) ? source.kind : "other",
    title: str(source.title),
    number: str(source.number),
    issuer: str(source.issuer),
    party: str(source.party),
    issue_date: date(source.issue_date, source.issue_date_calendar),
    expiry_date: date(source.expiry_date, source.expiry_date_calendar),
    amount: num(source.amount),
    case_number: str(source.case_number),
    court: str(source.court),
    summary: str(source.summary),
    /* أي جهة يفتحها هذا المستند: شركة أو عمل حر أو شخص — يملأ نوع الحساب عند التسجيل */
    entity_hint: ["company", "establishment", "freelance", "individual", "nonprofit", "government"].includes(source.entity_hint) ? source.entity_hint : null,
    confidence: Math.max(0, Math.min(1, Number(source.confidence) || 0)),
  };
}

/* قواعد حتمية للمستندات السعودية الشائعة: تعمل قبل النموذج وبعده، ولا تخترع شيئا */
/* بعض ملفات PDF العربية تُخرج نصها بأشكال العرض (Presentation Forms) وحروفاً
   مفرّقة بمسافات، فلا يطابقها أي تعبير. نعيدها إلى حروفها الأساسية ونلصق
   الحروف المفردة قبل أي مطابقة. الأرقام والتواريخ لا تتأثر بهذا الخلل. */
function arabicPresentationToBase(text) {
  return String(text || "").replace(/[\uFB50-\uFDFF\uFE70-\uFEFF]/g, function (ch) {
    var decomposed = ch.normalize("NFKD");
    var out = "";
    for (var i = 0; i < decomposed.length; i++) {
      var c = decomposed[i];
      if (c >= "\u0600" && c <= "\u06FF") out += c;
    }
    return out || ch;
  });
}

function joinSpacedArabic(text) {
  /* «ا ل س ج ل» → «السجل»: تُلصق الحروف المفردة المتتابعة */
  return String(text || "").replace(/(?:[\u0600-\u06FF]\s){2,}[\u0600-\u06FF]/g, function (run) {
    return run.replace(/\s+/g, "");
  });
}

export function looksMangledArabic(text) {
  var value = String(text || "");
  if (/[\uFB50-\uFDFF\uFE70-\uFEFF]/.test(value)) return true;
  var singles = (value.match(/(?:^|\s)[\u0600-\u06FF](?=\s|$)/g) || []).length;
  var words = (value.match(/\S+/g) || []).length;
  return words > 10 && singles / words > 0.3;
}

const AR_DIGITS = { "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9","۰":"0","۱":"1","۲":"2","۳":"3","۴":"4","۵":"5","۶":"6","۷":"7","۸":"8","۹":"9" };
function westernize(text) { return String(text || "").replace(/[٠-٩۰-۹]/g, (digit) => AR_DIGITS[digit] || digit); }
function findDate(text, labels) {
  const dateRegex = new RegExp("(?:" + labels.join("|") + ")[^0-9]{0,40}(\\d{4}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{1,2}|\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{4})", "i");
  const dateMatch = text.match(dateRegex);
  if (!dateMatch) return null;
  let dateParts = dateMatch[1].replace(/[\/.]/g, "-").split("-").map((part) => part.padStart(2, "0"));
  if (dateParts[0].length === 4) return { raw: `${dateParts[0]}-${dateParts[1]}-${dateParts[2]}`, year: Number(dateParts[0]) };
  return { raw: `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`, year: Number(dateParts[2]) };
}
function findAfter(text, labels, pattern) {
  const labelRegex = new RegExp("(?:" + labels.join("|") + ")\\s*[:：\\-]?\\s*(" + pattern + ")", "i");
  const labelMatch = text.match(labelRegex);
  return labelMatch ? labelMatch[1].trim() : null;
}
/* جدول الأوراق الرسمية المعروفة: كل نوع بكلماته ومسمّيات رقمه وجهته. يُفحص بالترتيب. */
const wordBoundaryAr = (pattern) => "(?<![\\u0600-\\u06FF])(?:" + pattern + ")(?![\\u0600-\\u06FF])";
const KIND_RULES = [
  { kind: "commercial_register", entity: "company", test: /السجل\s*التجاري|سجل\s*تجاري|رقم\s*السجل|شهادة\s*(?:ال)?سجل|commercial\s*regist/i, issuer: "وزارة التجارة",
    number: ["رقم\\s*السجل\\s*التجاري", "رقم\\s*السجل", "الرقم\\s*الوطني\\s*الموحد", "الرقم\\s*الموحد", "C\\.?R\\.?\\s*(?:No\\.?)?", "national\\s*number", "unified\\s*number", "registration\\s*number"],
    numPat: "[1247]\\d{9}",
    party: ["اسم\\s*المنشأة", "الاسم\\s*التجاري", "اسم\\s*الشركة", "اسم\\s*التاجر", "business\\s*name", "trade\\s*name", "company\\s*name", "entity\\s*name"] },
  { kind: "articles_of_association", test: /عقد\s*(?:ال)?تأسيس|عقد\s*شركة|articles\s*of\s*(?:association|incorporation)|memorandum\s*of\s*association/i,
    number: ["رقم\\s*العقد", "رقم\\s*التوثيق", "رقم\\s*الوثيقة"], numPat: "\\d{4,20}", party: ["اسم\\s*الشركة", "تحت\\s*اسم", "باسم"], issuerTest: [[/وزارة\s*التجارة/, "وزارة التجارة"], [/كاتب\s*(?:ال)?عدل|العدل/, "وزارة العدل"]] },
  { kind: "bylaws", test: /النظام\s*الأساس|النظام\s*الاساس|bylaws/i, issuer: "وزارة التجارة", party: ["اسم\\s*الشركة", "شركة"] },
  { kind: "chamber_certificate", test: /الغرفة\s*التجارية|غرفة\s*(?:الرياض|جدة|الشرقية|مكة|المدينة|القصيم|عسير|حائل|تبوك|جازان|نجران|الجوف|الباحة)|chamber\s*of\s*commerce/i, issuer: "الغرفة التجارية",
    number: ["رقم\\s*العضوية", "رقم\\s*الاشتراك", "رقم\\s*الشهادة", "membership\\s*(?:No\\.?)?"], numPat: "\\d{4,15}", party: ["اسم\\s*المنشأة", "الاسم\\s*التجاري", "اسم\\s*الشركة", "اسم\\s*العضو"] },
  { kind: "gosi_certificate", test: /التأمينات\s*الاجتماعية|GOSI/i, issuer: "المؤسسة العامة للتأمينات الاجتماعية",
    number: ["رقم\\s*الاشتراك", "رقم\\s*المنشأة", "رقم\\s*الشهادة", "رقم\\s*المشترك"], numPat: "\\d{6,15}", party: ["اسم\\s*المنشأة", "اسم\\s*صاحب\\s*العمل", "اسم\\s*الشركة"] },
  { kind: "zakat_certificate", test: /شهادة\s*(?:الزكاة|زكاة)|الزكاة\s*والدخل|zakat/i, issuer: "هيئة الزكاة والضريبة والجمارك",
    number: ["رقم\\s*الشهادة", "الرقم\\s*المميز", "رقم\\s*المكلف"], numPat: "\\d{6,15}", party: ["اسم\\s*المكلف", "اسم\\s*المنشأة", "اسم\\s*الشركة"] },
  { kind: "vat_certificate", test: /شهادة\s*(?:تسجيل\s*)?(?:في\s*)?ضريبة|الرقم\s*الضريبي|ضريبة\s*القيمة\s*المضافة|VAT/i, issuer: "هيئة الزكاة والضريبة والجمارك",
    number: ["الرقم\\s*الضريبي", "رقم\\s*التسجيل\\s*الضريبي", "VAT\\s*(?:No\\.?)?"], numPat: "3\\d{14}", party: ["اسم\\s*المكلف", "اسم\\s*المنشأة", "الاسم\\s*التجاري", "اسم\\s*الشركة"] },
  { kind: "saudization_certificate", test: /شهادة\s*(?:السعودة|التوطين)|نطاقات|saudi[sz]ation|nitaqat/i, issuer: "وزارة الموارد البشرية والتنمية الاجتماعية",
    number: ["رقم\\s*الشهادة", "رقم\\s*المنشأة", "الرقم\\s*الموحد"], numPat: "\\d{6,15}", party: ["اسم\\s*المنشأة", "اسم\\s*الشركة"] },
  { kind: "lease_contract", test: /عقد\s*(?:إيجار|ايجار|الإيجار|الايجار)|lease\s*(?:agreement|contract)/i,
    number: ["رقم\\s*العقد", "رقم\\s*التوثيق", "contract\\s*(?:No\\.?)?"], numPat: "[0-9A-Za-z\\-]{4,25}", party: ["المستأجر", "اسم\\s*المستأجر"], issuerTest: [[/منصة|شبكة|موثق/, "منصة إيجار"]],
    amount: /(?:قيمة\s*(?:الإيجار|الايجار|العقد)|الأجرة\s*السنوية|إجمالي\s*(?:الإيجار|العقد))[^0-9]{0,30}([0-9][0-9,\.]{2,})/ },
  { kind: "power_of_attorney", test: new RegExp(wordBoundaryAr("وكالة|الوكالة|توكيل") + "|power\\s*of\\s*attorney", "i"), issuer: "وزارة العدل",
    number: ["رقم\\s*الوكالة", "رقم\\s*التوثيق", "الرقم"], numPat: "\\d{6,20}", party: ["الموكل", "اسم\\s*الموكل"] },
  { kind: "hearing_notice", test: /إشعار\s*(?:ب)?(?:موعد\s*)?جلسة|موعد\s*(?:ال)?جلسة|تحديد\s*جلسة|hearing/i, issuer: "المحكمة",
    number: ["رقم\\s*(?:ال)?دعوى", "رقم\\s*القضية"], numPat: "\\d{4,20}", party: ["المدعي", "المدعى\\s*عليه"] },
  { kind: "case_filing", test: /صحيفة\s*(?:ال)?دعوى|لائحة\s*(?:ال)?دعوى|مذكرة\s*(?:جوابية|دفاع)|statement\s*of\s*claim/i, issuer: "المحكمة",
    number: ["رقم\\s*(?:ال)?دعوى", "رقم\\s*القضية", "رقم\\s*القيد"], numPat: "\\d{4,20}", party: ["المدعي", "المدعى\\s*عليه"] },
  { kind: "court_ruling", test: new RegExp(wordBoundaryAr("صك\\s*حكم|حكم\\s*(?:نهائي|ابتدائي|غيابي|حضوري)?|الحكم|قرار\\s*(?:المحكمة|الدائرة)|منطوق\\s*الحكم") + "|judg?ment|ruling", "i"), issuer: "وزارة العدل",
    number: ["رقم\\s*الصك", "رقم\\s*الحكم", "رقم\\s*القرار"], numPat: "\\d{6,20}", party: ["المدعي", "المدعى\\s*عليه"] },
  { kind: "violation", test: new RegExp(wordBoundaryAr("مخالفة|المخالفة|غرامة|الغرامة") + "|violation|fine\\s*notice|ticket", "i"),
    number: ["رقم\\s*المخالفة", "رقم\\s*القرار", "رقم\\s*الإشعار"], numPat: "\\d{4,20}", party: ["اسم\\s*المنشأة", "اسم\\s*المخالف", "المخالف"],
    amount: /(?:مبلغ\s*(?:المخالفة|الغرامة)|قيمة\s*(?:المخالفة|الغرامة)|الغرامة|المبلغ)[^0-9]{0,25}([0-9][0-9,\.]{1,})/ },
  { kind: "invoice", test: /فاتورة|invoice|tax\s*invoice/i,
    number: ["رقم\\s*الفاتورة", "invoice\\s*(?:No\\.?|#)?"], numPat: "[0-9A-Za-z\\-\\/]{3,25}", party: ["العميل", "اسم\\s*العميل", "المشتري", "bill\\s*to"],
    amount: /(?:الإجمالي|المجموع|الإجمالي\s*شامل|total\s*(?:amount)?|grand\s*total)[^0-9]{0,25}([0-9][0-9,\.]{1,})/i },
  { kind: "passport", entity: "individual", test: /جواز\s*(?:ال)?سفر|passport/i, issuer: "المديرية العامة للجوازات",
    number: ["رقم\\s*(?:ال)?جواز", "passport\\s*(?:No\\.?)?"], numPat: "[A-Z]\\d{6,9}|\\d{7,9}", party: ["الاسم", "اسم\\s*صاحب\\s*الجواز"] },
  { kind: "id_document", entity: "individual", test: /الهوية\s*الوطنية|بطاقة\s*(?:ال)?هوية|إقامة|رخصة\s*إقامة|جواز\s*سفر|passport|national\s*id|iqama/i, issuer: "وزارة الداخلية",
    number: ["رقم\\s*الهوية", "رقم\\s*الإقامة", "رقم\\s*الجواز", "ID\\s*(?:No\\.?)?"], numPat: "[12]\\d{9}|[A-Z]\\d{7,9}", party: ["الاسم", "اسم\\s*صاحب\\s*الهوية"] },
  { kind: "license", entity: "freelance", test: /وثيقة\s*(?:ال)?عمل\s*(?:ال)?حر|العمل\s*الحر|freelanc/i,
    issuer: "وزارة الموارد البشرية والتنمية الاجتماعية",
    number: ["رقم\\s*(?:ال)?وثيقة", "رقم\\s*(?:ال)?تسجيل", "رقم\\s*(?:ال)?رخصة"], numPat: "[0-9A-Za-z\\-]{4,25}",
    party: ["اسم\\s*صاحب\\s*(?:ال)?وثيقة", "اسم\\s*(?:ال)?مستفيد", "الاسم"] },
  { kind: "driving_license", test: /رخصة\s*(?:ال)?قيادة|driv(?:ing|er'?s)\s*licen[cs]e/i, issuer: "الإدارة العامة للمرور",
    number: ["رقم\\s*(?:ال)?رخصة", "رقم\\s*الهوية"], numPat: "[12]\\d{9}|\\d{6,12}", party: ["الاسم", "اسم\\s*صاحب\\s*الرخصة"] },
  { kind: "vehicle_registration", test: /استمارة\s*(?:ال)?(?:سيارة|مركبة)|رخصة\s*سير|vehicle\s*registration/i, issuer: "الإدارة العامة للمرور",
    number: ["الرقم\\s*التسلسلي", "رقم\\s*اللوحة", "رقم\\s*الهيكل", "plate\\s*(?:No\\.?)?"], numPat: "[0-9A-Za-z\\-]{4,20}", party: ["اسم\\s*المالك", "المالك"] },
  { kind: "license", test: new RegExp(wordBoundaryAr("رخصة|الرخصة|ترخيص|الترخيص|تصريح|التصريح") + "|licen[cs]e|permit", "i"),
    number: ["رقم\\s*الرخصة", "رقم\\s*الترخيص", "رقم\\s*التصريح", "Licen[cs]e\\s*(?:No\\.?)?"], numPat: "[A-Za-z0-9\\-\\/]{4,30}", party: ["اسم\\s*المنشأة", "الاسم\\s*التجاري", "اسم\\s*الشركة", "اسم\\s*المرخص\\s*له"],
    issuerTest: [[/البلدية|أمانة/, "الأمانة / البلدية"], [/الدفاع\s*المدني/, "الدفاع المدني"], [/الهيئة\s*العامة\s*للنقل/, "الهيئة العامة للنقل"], [/وزارة\s*الصحة/, "وزارة الصحة"]] },
  { kind: "insurance_policy", test: /وثيقة\s*(?:ال)?تأمين|بوليصة\s*(?:ال)?تأمين|insurance\s*policy/i,
    number: ["رقم\\s*(?:ال)?وثيقة", "رقم\\s*(?:ال)?بوليصة", "policy\\s*(?:No\\.?)?"], numPat: "[0-9A-Za-z\\-\\/]{4,25}", party: ["اسم\\s*المؤمن\\s*له", "المؤمن\\s*له"],
    amount: /(?:إجمالي\s*القسط|قسط\s*التأمين|القسط|premium)[^0-9]{0,25}([0-9][0-9,\.]{1,})/i },
  { kind: "employment_contract", test: /عقد\s*(?:ال)?عمل|employment\s*contract/i, issuer: "وزارة الموارد البشرية والتنمية الاجتماعية",
    number: ["رقم\\s*(?:ال)?عقد", "رقم\\s*التوثيق"], numPat: "[0-9A-Za-z\\-]{4,25}", party: ["اسم\\s*الموظف", "العامل", "الطرف\\s*الثاني"],
    amount: /(?:الراتب\s*(?:الأساسي|الشهري)?|الأجر\s*(?:الشهري|الأساسي)|salary)[^0-9]{0,25}([0-9][0-9,\.]{1,})/i },
  { kind: "contract", test: new RegExp(wordBoundaryAr("عقد|العقد|اتفاقية|الاتفاقية") + "|contract|agreement", "i"),
    number: ["رقم\\s*العقد", "رقم\\s*الاتفاقية", "contract\\s*(?:No\\.?)?"], numPat: "[0-9A-Za-z\\-\\/]{3,25}", party: ["الطرف\\s*الأول", "الطرف\\s*الثاني", "العميل"],
    amount: /(?:قيمة\s*العقد|إجمالي\s*(?:قيمة\s*)?العقد|المبلغ\s*الإجمالي|contract\s*value)[^0-9]{0,25}([0-9][0-9,\.]{2,})/i },
];

/* إشارات لا تحتمل اللبس: حين تتحقق، لا رأي للنموذج فيها.
   الترتيب مهم: الأخص أولا. */
const STRONG_KINDS = [
  { kind: "commercial_register", when: (t) =>
      (/وزارة\s*التجارة/.test(t) && /\b[1247]\d{9}\b/.test(t)) ||
      /(?:رقم\s*)?السجل\s*التجاري/.test(t) },
  { kind: "vat_certificate", when: (t) => /\b3\d{13}3\b/.test(t) && /(?:ضريب|VAT)/i.test(t) },
  { kind: "zakat_certificate", when: (t) => /شهادة\s*(?:ال)?زكاة|الزكاة\s*والدخل/.test(t) },
  { kind: "gosi_certificate", when: (t) => /التأمينات\s*الاجتماعية/.test(t) },
  { kind: "chamber_certificate", when: (t) => /الغرفة\s*التجارية/.test(t) },
  { kind: "saudization_certificate", when: (t) => /شهادة\s*(?:السعودة|التوطين)|نطاقات/.test(t) },
  { kind: "power_of_attorney", when: (t) => /(?:رقم\s*)?(?:ال)?وكالة/.test(t) && /كاتب\s*(?:ال)?عدل|ناجز|الموكل/.test(t) },
  { kind: "articles_of_association", when: (t) => /عقد\s*(?:ال)?تأسيس/.test(t) }
];

function strongKind(text) {
  const hit = STRONG_KINDS.find((r) => r.when(text));
  return hit ? hit.kind : null;
}

function rulesExtract(rawText) {
  const text = joinSpacedArabic(arabicPresentationToBase(westernize(rawText))).replace(/[\u200f\u200e]/g, "");
  const out = {};
  const strong = strongKind(text);
  const rule = strong
    ? (KIND_RULES.find((r) => r.kind === strong) || KIND_RULES.find((r) => r.test.test(text)))
    : KIND_RULES.find((r) => r.test.test(text));
  if (strong) out.strong = true;
  if (rule) {
    out.kind = rule.kind;
    if (rule.number) out.number = findAfter(text, rule.number, rule.numPat || "[0-9A-Za-z\\-\\/]{3,25}") || null;
    if (!out.number && rule.numPat && /^\[?[0-9\\\\d]/.test(rule.numPat)) out.number = (text.match(new RegExp("\\b(?:" + rule.numPat + ")\\b")) || [])[0] || null;
    if (rule.party) out.party = findAfter(text, rule.party, "[^\\n:،,]{3,80}") || null;
    if (rule.issuerTest) for (const [re, name] of rule.issuerTest) if (re.test(text)) { out.issuer = name; break; }
    if (!out.issuer && rule.issuer) out.issuer = rule.issuer;
    if (rule.entity) out.entity_hint = rule.entity;
    if (rule.amount) { const amountMatch = text.match(rule.amount); if (amountMatch) out.amount = Number(amountMatch[1].replace(/,/g, "")) || null; }
  }
  /* شهادة السجل تكتب اسم المنشأة تحت عنوانها بلا تسمية: نأخذ ما بينه وأول حقل */
  if (out.kind === "commercial_register" && !out.party) {
    const afterTitle = text.match(/(?:شهادة\s*(?:ال)?سجل\s*(?:ال)?تجاري|commercial\s*registration\s*certificate)\s+(.{3,80}?)\s+(?:الرقم|رقم\s|national\s*number|unified|status|entity\s*type|release\s*date|تاريخ|حالة|نوع)/i);
    if (afterTitle) out.party = afterTitle[1].replace(/[:\-–\s]+$/, "").trim();
  }

  /* أوراق المحاكم: رقم الدعوى واسم المحكمة والدائرة تُقرأ مباشرة */
  if (["hearing_notice", "case_filing", "court_ruling"].includes(out.kind)) {
    out.case_number = findAfter(text, ["رقم\\s*(?:ال)?دعوى", "رقم\\s*القضية", "رقم\\s*القيد", "case\\s*(?:No\\.?|number)?"], "\\d{3,20}(?:\\/\\d{2,4})?") || (out.kind !== "court_ruling" ? out.number : null);
    const court = text.match(/(?:المحكمة|محكمة)\s*[^\n:،,]{2,45}/);
    if (court) out.court = court[0].trim();
    const circuit = text.match(/الدائرة\s*[^\n:،,]{2,30}/);
    if (circuit) out.court = (out.court ? out.court + " — " : "") + circuit[0].trim();
  }
  /* رقم عام: "رقم ...: 123456" إن لم تجده القاعدة */
  if (!out.number) { const genericNumberMatch = text.match(/رقم\s*[^:：\n]{0,25}[:：]\s*([0-9]{5,20})/); if (genericNumberMatch) out.number = genericNumberMatch[1]; }
  const expiryDateInfo = findDate(text, ["تاريخ\\s*(?:ال)?انتهاء", "ينتهي\\s*(?:في|بتاريخ)", "صالح(?:ة)?\\s*حتى", "تاريخ\\s*نهاية", "الانتهاء", "تاريخ\\s*(?:ال)?جلسة", "موعد\\s*(?:ال)?جلسة", "تاريخ\\s*(?:ال)?استحقاق", "تاريخ\\s*(?:ال)?سداد", "expir(?:y|es|ation)\\s*(?:date)?", "valid\\s*(?:until|to)", "due\\s*date", "hearing\\s*date"]);
  const issueDateInfo = findDate(text, ["تاريخ\\s*(?:ال)?إصدار", "تاريخ\\s*(?:ال)?اصدار", "تاريخ\\s*التسجيل", "تاريخ\\s*(?:ال)?بداية", "تاريخ\\s*(?:ال)?تحرير", "تاريخ\\s*العقد", "صدر\\s*(?:في|بتاريخ)", "حرر\\s*(?:في|بتاريخ)", "issue\\s*date", "issued\\s*on", "registration\\s*date", "date"]);
  if (expiryDateInfo) { out.expiry_date = expiryDateInfo.raw; out.expiry_date_calendar = expiryDateInfo.year < 1700 ? "hijri" : "gregorian"; }
  if (issueDateInfo) { out.issue_date = issueDateInfo.raw; out.issue_date_calendar = issueDateInfo.year < 1700 ? "hijri" : "gregorian"; }
  return out;
}
function mergeRules(model, rules) {
  const merged = model && typeof model === "object" ? { ...model } : {};
  for (const key of Object.keys(rules)) {
    const isMissing = merged[key] == null || merged[key] === "" || merged[key] === 0 || (key === "kind" && merged[key] === "other");
    if (isMissing) merged[key] = rules[key];
  }
  /* النص صريح: عبارة المستند ورقمه أصدق من تخمين النموذج */
  if (rules.kind && (rules.strong || merged.kind == null || merged.kind === "other")) merged.kind = rules.kind;
  delete merged.strong;
  if (!merged.title && rules.kind) {
    const names = { commercial_register: "السجل التجاري", vat_certificate: "الشهادة الضريبية", license: "الرخصة",
      articles_of_association: "عقد التأسيس", bylaws: "النظام الأساسي", chamber_certificate: "شهادة الغرفة التجارية",
      gosi_certificate: "شهادة التأمينات الاجتماعية", zakat_certificate: "شهادة الزكاة", saudization_certificate: "شهادة السعودة", lease_contract: "عقد الإيجار",
      power_of_attorney: "الوكالة", court_ruling: "الحكم", case_filing: "صحيفة الدعوى", hearing_notice: "إشعار الجلسة", violation: "المخالفة", invoice: "الفاتورة", id_document: "الهوية", passport: "جواز السفر", driving_license: "رخصة القيادة",
      vehicle_registration: "استمارة المركبة", insurance_policy: "وثيقة التأمين", employment_contract: "عقد العمل", contract: "العقد" };
    merged.title = (names[rules.kind] || "مستند") + (rules.party ? " — " + rules.party : rules.number ? " " + rules.number : "");
  }
  return merged;
}

function isFastPathRequested(request) { try { return new URL(request.url).searchParams.get("fast") === "1"; } catch { return false; } }

async function readImage(env, base64) {
  const bin = atob(String(base64 || "").replace(/^data:[^,]+,/, ""));
  const bytes = new Uint8Array(bin.length);
  for (let index = 0; index < bin.length; index++) bytes[index] = bin.charCodeAt(index);
  const res = await env.AI.run(VISION_MODEL, {
    prompt: "This is a scanned Arabic/English official document. Transcribe ALL visible text exactly, line by line, keeping labels and their values together (e.g. 'رقم السجل التجاري: 1010123456', 'تاريخ الانتهاء: 1447-05-10'). Digits must be Western. No commentary.",
    image: Array.from(bytes),
    max_tokens: 1400,
  });
  return String((res && (res.response || res.description)) || "").trim();
}

export async function handleDocumentAnalyze(request, env) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!env.AI) return new Response(JSON.stringify({ error: "ai_unavailable" }), { status: 503, headers });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!body) return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400, headers });

  let text = String(body.text || "").slice(0, MAX_TEXT);
  /* نص PDF عربي مشوّه (أشكال عرض أو حروف مفرّقة) لا يُفهم: تُقرأ صورة الصفحة بدله */
  const mangled = text.trim() ? looksMangledArabic(text) : false;
  try {
    if ((!text.trim() || mangled) && body.image) text = (await readImage(env, body.image)).slice(0, MAX_TEXT);
    else if (mangled) return new Response(JSON.stringify({ error: "mangled_text" }), { status: 422, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: "image_read_failed" }), { status: 502, headers });
  }
  if (text.trim().length < 12) return new Response(JSON.stringify({ error: "no_text" }), { status: 422, headers });

  const rules = rulesExtract(text);
  const fast = isFastPathRequested(request) || (rules.kind && (rules.number || rules.party) && (rules.expiry_date || rules.issue_date));
  if (fast && rules.kind) {
    const merged = mergeRules(null, rules);
    merged.summary = merged.title; merged.confidence = 0.9;
    return new Response(JSON.stringify({ fields: clean(merged), text_chars: text.length, rules: Object.keys(rules), fast: true }), { headers });
  }
  let parsed = null;
  try {
    const out = await env.AI.run(TEXT_MODEL, {
      messages: [{ role: "user", content: extractionPrompt(text) }],
      max_tokens: 450,
      temperature: 0.1,
    });
    parsed = parseJson(out && (out.response || out.result));
  } catch (e) { parsed = null; }
  /* النموذج قد يخطئ أو يفشل؛ القواعد الحتمية تكمل أو تصحح، ولا نفشل ما دامت وجدت شيئا */
  const merged = mergeRules(parsed, rules);
  if (!parsed && !rules.kind) return new Response(JSON.stringify({ error: "extract_failed" }), { status: 502, headers });
  return new Response(JSON.stringify({ fields: clean(merged), text_chars: text.length, rules: Object.keys(rules) }), { headers });
}
