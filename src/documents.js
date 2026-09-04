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
  const s = String(raw || "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

/* تحويل هجري (أم القرى) → ميلادي حسابيا: نقدر اليوم ثم نبحث حوله عن اليوم الذي
   ينتج التاريخ الهجري نفسه في Intl. لا نثق بتحويل النموذج اللغوي. */
const HIJRI_FMT = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: "numeric", year: "numeric" });
function hijriParts(d) {
  const out = {};
  for (const p of HIJRI_FMT.formatToParts(d)) if (p.type !== "literal") out[p.type] = parseInt(p.value, 10);
  return out;
}
function hijriToGregorian(y, m, d) {
  // تقدير: 1 محرم 1 ه ≈ 16 يوليو 622 م، والسنة الهجرية 354.367 يوما
  const approx = new Date(Date.UTC(622, 6, 16) + ((y - 1) * 354.367 + (m - 1) * 29.53 + (d - 1)) * 86400000);
  for (let off = -40; off <= 40; off++) {
    const cand = new Date(approx.getTime() + off * 86400000);
    const h = hijriParts(cand);
    if (h.year === y && h.month === m && h.day === d) return cand;
  }
  return null;
}
function normalizeDate(value, calendar) {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const isHijri = calendar === "hijri" || (y >= 1300 && y < 1600);
  if (isHijri) {
    const g = hijriToGregorian(y, mo, d);
    return g ? g.toISOString().slice(0, 10) : null;
  }
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function clean(out) {
  const o = out && typeof out === "object" ? out : {};
  const date = (v, cal) => normalizeDate(v, cal);
  const num = (v) => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isFinite(n) && n !== 0 ? n : null; };
  const str = (v) => (v == null ? null : String(v).trim().slice(0, 300) || null);
  return {
    kind: DOC_KINDS.includes(o.kind) ? o.kind : "other",
    title: str(o.title),
    number: str(o.number),
    issuer: str(o.issuer),
    party: str(o.party),
    issue_date: date(o.issue_date, o.issue_date_calendar),
    expiry_date: date(o.expiry_date, o.expiry_date_calendar),
    amount: num(o.amount),
    case_number: str(o.case_number),
    court: str(o.court),
    summary: str(o.summary),
    confidence: Math.max(0, Math.min(1, Number(o.confidence) || 0)),
  };
}

/* قواعد حتمية للمستندات السعودية الشائعة: تعمل قبل النموذج وبعده، ولا تخترع شيئا */
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
  { kind: "commercial_register", test: /السجل\s*التجاري|سجل\s*تجاري|commercial\s*regist/i, issuer: "وزارة التجارة",
    number: ["رقم\\s*السجل\\s*التجاري", "رقم\\s*السجل", "C\\.?R\\.?\\s*(?:No\\.?)?"], numPat: "[1247]\\d{9}", party: ["اسم\\s*المنشأة", "الاسم\\s*التجاري", "اسم\\s*الشركة", "اسم\\s*التاجر"] },
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
  { kind: "id_document", test: /الهوية\s*الوطنية|بطاقة\s*(?:ال)?هوية|إقامة|رخصة\s*إقامة|جواز\s*سفر|passport|national\s*id|iqama/i, issuer: "وزارة الداخلية",
    number: ["رقم\\s*الهوية", "رقم\\s*الإقامة", "رقم\\s*الجواز", "ID\\s*(?:No\\.?)?"], numPat: "[12]\\d{9}|[A-Z]\\d{7,9}", party: ["الاسم", "اسم\\s*صاحب\\s*الهوية"] },
  { kind: "license", test: new RegExp(wordBoundaryAr("رخصة|الرخصة|ترخيص|الترخيص|تصريح|التصريح") + "|licen[cs]e|permit", "i"),
    number: ["رقم\\s*الرخصة", "رقم\\s*الترخيص", "رقم\\s*التصريح", "Licen[cs]e\\s*(?:No\\.?)?"], numPat: "[A-Za-z0-9\\-\\/]{4,30}", party: ["اسم\\s*المنشأة", "الاسم\\s*التجاري", "اسم\\s*الشركة", "اسم\\s*المرخص\\s*له"],
    issuerTest: [[/البلدية|أمانة/, "الأمانة / البلدية"], [/الدفاع\s*المدني/, "الدفاع المدني"], [/الهيئة\s*العامة\s*للنقل/, "الهيئة العامة للنقل"], [/وزارة\s*الصحة/, "وزارة الصحة"]] },
  { kind: "contract", test: new RegExp(wordBoundaryAr("عقد|العقد|اتفاقية|الاتفاقية") + "|contract|agreement", "i"),
    number: ["رقم\\s*العقد", "رقم\\s*الاتفاقية", "contract\\s*(?:No\\.?)?"], numPat: "[0-9A-Za-z\\-\\/]{3,25}", party: ["الطرف\\s*الأول", "الطرف\\s*الثاني", "العميل"],
    amount: /(?:قيمة\s*العقد|إجمالي\s*(?:قيمة\s*)?العقد|المبلغ\s*الإجمالي|contract\s*value)[^0-9]{0,25}([0-9][0-9,\.]{2,})/i },
];

function rulesExtract(rawText) {
  const text = westernize(rawText).replace(/[\u200f\u200e]/g, "");
  const out = {};
  const rule = KIND_RULES.find((r) => r.test.test(text));
  if (rule) {
    out.kind = rule.kind;
    if (rule.number) out.number = findAfter(text, rule.number, rule.numPat || "[0-9A-Za-z\\-\\/]{3,25}") || null;
    if (!out.number && rule.numPat && /^\[?[0-9\\\\d]/.test(rule.numPat)) out.number = (text.match(new RegExp("\\b(?:" + rule.numPat + ")\\b")) || [])[0] || null;
    if (rule.party) out.party = findAfter(text, rule.party, "[^\\n:،,]{3,80}") || null;
    if (rule.issuerTest) for (const [re, name] of rule.issuerTest) if (re.test(text)) { out.issuer = name; break; }
    if (!out.issuer && rule.issuer) out.issuer = rule.issuer;
    if (rule.amount) { const m = text.match(rule.amount); if (m) out.amount = Number(m[1].replace(/,/g, "")) || null; }
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
  const exp = findDate(text, ["تاريخ\\s*(?:ال)?انتهاء", "ينتهي\\s*(?:في|بتاريخ)", "صالح(?:ة)?\\s*حتى", "تاريخ\\s*نهاية", "الانتهاء", "تاريخ\\s*(?:ال)?جلسة", "موعد\\s*(?:ال)?جلسة", "تاريخ\\s*(?:ال)?استحقاق", "تاريخ\\s*(?:ال)?سداد", "expir(?:y|es|ation)\\s*(?:date)?", "valid\\s*(?:until|to)", "due\\s*date", "hearing\\s*date"]);
  const iss = findDate(text, ["تاريخ\\s*(?:ال)?إصدار", "تاريخ\\s*(?:ال)?اصدار", "تاريخ\\s*التسجيل", "تاريخ\\s*(?:ال)?بداية", "تاريخ\\s*(?:ال)?تحرير", "تاريخ\\s*العقد", "صدر\\s*(?:في|بتاريخ)", "حرر\\s*(?:في|بتاريخ)", "issue\\s*date", "issued\\s*on", "registration\\s*date", "date"]);
  if (exp) { out.expiry_date = exp.raw; out.expiry_date_calendar = exp.year < 1700 ? "hijri" : "gregorian"; }
  if (iss) { out.issue_date = iss.raw; out.issue_date_calendar = iss.year < 1700 ? "hijri" : "gregorian"; }
  return out;
}
function mergeRules(model, rules) {
  const m = model && typeof model === "object" ? { ...model } : {};
  for (const k of Object.keys(rules)) {
    const bad = m[k] == null || m[k] === "" || m[k] === 0 || (k === "kind" && m[k] === "other");
    if (bad) m[k] = rules[k];
  }
  if (rules.kind && m.kind !== rules.kind && (m.kind === "other" || m.kind == null)) m.kind = rules.kind;
  if (!m.title && rules.kind) {
    const names = { commercial_register: "السجل التجاري", vat_certificate: "الشهادة الضريبية", license: "الرخصة",
      articles_of_association: "عقد التأسيس", bylaws: "النظام الأساسي", chamber_certificate: "شهادة الغرفة التجارية",
      gosi_certificate: "شهادة التأمينات الاجتماعية", zakat_certificate: "شهادة الزكاة", saudization_certificate: "شهادة السعودة", lease_contract: "عقد الإيجار",
      power_of_attorney: "الوكالة", court_ruling: "الحكم", case_filing: "صحيفة الدعوى", hearing_notice: "إشعار الجلسة", violation: "المخالفة", invoice: "الفاتورة", id_document: "الهوية", contract: "العقد" };
    m.title = (names[rules.kind] || "مستند") + (rules.party ? " — " + rules.party : rules.number ? " " + rules.number : "");
  }
  return m;
}

function url_fast(request) { try { return new URL(request.url).searchParams.get("fast") === "1"; } catch { return false; } }

async function readImage(env, base64) {
  const bin = atob(String(base64 || "").replace(/^data:[^,]+,/, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
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
  try {
    if (!text.trim() && body.image) text = (await readImage(env, body.image)).slice(0, MAX_TEXT);
  } catch (e) {
    return new Response(JSON.stringify({ error: "image_read_failed" }), { status: 502, headers });
  }
  if (text.trim().length < 12) return new Response(JSON.stringify({ error: "no_text" }), { status: 422, headers });

  const rules = rulesExtract(text);
  const fast = url_fast(request) || (rules.kind && (rules.number || rules.party) && (rules.expiry_date || rules.issue_date));
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
