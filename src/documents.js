/**
 * تحليل المستندات — /api/documents/analyze
 * يستقبل نص مستند (مستخرج من PDF في المتصفح) أو صورة (base64)، ويعيد حقولا
 * منظمة: نوع المستند، عنوانه، رقمه، الجهة، تاريخ الإصدار، تاريخ الانتهاء، المبلغ،
 * رقم الدعوى، الشركة. الصور تقرأ بنموذج رؤية من Workers AI ثم يستخرج منها.
 * لا يخزن شيء هنا؛ الحفظ يتم من المتصفح عبر سوبابيس بصلاحيات المستخدم.
 */

const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
/* Llama 4 Scout: متعدد اللغات أصلا (عربية/إنجليزية) ويقبل الصورة في الرسائل — اختير بعد اختبار فعلي على صورة سجل تجاري ثنائي اللغة */
const VISION_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
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

/* مفاتيح التفاصيل التي يطلبها النموذج: إن عرفت القواعد النوع تذكر حقوله وحدها، وإلا تعرض مفاتيح كل نوع باختصار */
function detailKeysHint(kind) {
  const specs = KIND_FIELDS[kind];
  if (specs) return `"details": { ${specs.map((s) => `"${s.key}": ${s.ar} / ${s.en}`).join(", ")} }  (نوع هذه الورقة على الأرجح ${kind})`;
  const all = Object.keys(KIND_FIELDS).map((k) => k + ": " + KIND_FIELDS[k].map((s) => s.key).join(", ")).join("\n  ");
  return `"details": كائن بمفاتيح النوع الذي اخترته فقط، من هذه القائمة:\n  ${all}`;
}

function extractionPrompt(text, kind) {
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
  "confidence": رقم من 0 إلى 1,
  ${detailKeysHint(kind)}
}

قواعد: لا تحول بين التقويمين أبدا، فقط انسخ التاريخ كما ورد وحدد تقويمه (السنوات 13xx و14xx هجرية، و19xx و20xx ميلادية). الأرقام غربية. لا تخترع قيما غير موجودة في النص.
details: كل بيان مكتوب في الورقة يوضع تحت مفتاحه (الأسماء نصا كما وردت، المبالغ أرقاما، التواريخ "YYYY-MM-DD" بلا تحويل)، ولا يوضع مفتاح لا قيمة له في النص. الأوراق السعودية ثنائية اللغة: القيمة قد تقع بين التسمية الإنجليزية والتسمية العربية.

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
function plusOneYear(iso) {
  if (!iso) return null;
  const parts = iso.split("-").map(Number);
  const d = new Date(Date.UTC(parts[0] + 1, parts[1] - 1, parts[2]));
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
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

/* قيمة تفصيل واحدة كما يجب أن تخرج: التواريخ ISO ميلادية، المبالغ أرقام، المعرفات مطابقة لنمطها، النصوص حتى 200 حرف */
function sanitizeDetail(spec, value) {
  if (value == null) return null;
  const raw = westernize(String(value)).trim();
  if (!raw) return null;
  if (spec.type === "date") return isoDate(raw);
  if (spec.type === "number") { const numeric = Number(raw.replace(/[^0-9.\-]/g, "")); return isFinite(numeric) && numeric > 0 ? numeric : null; }
  if (spec.type === "id") return new RegExp("^(?:" + spec.pattern + ")$").test(raw) ? raw : null;
  return raw.replace(/\s+/g, " ").slice(0, 200).trim() || null;
}

/* ما يصلح لتحديث ملف الشركة من هذه الورقة: أوراق الشركة نفسها فقط، لا فواتير الغير ولا هويات الأفراد */
const PROFILE_KINDS = ["commercial_register", "vat_certificate", "zakat_certificate", "gosi_certificate", "chamber_certificate", "saudization_certificate", "articles_of_association", "bylaws", "license"];
function profileUpdates(kind, details, shortAddress) {
  const out = {};
  if (!PROFILE_KINDS.includes(kind)) return out;
  if (details.vat_number) out.vat_number = details.vat_number;
  if (details.cr_number) out.cr_number = details.cr_number;
  if (details.unified_number) out.unified_number = details.unified_number;
  const legalName = details.taxpayer_name || details.company_name || details.establishment_name;
  if (legalName) out.legal_name = legalName;
  if (shortAddress) out.national_address_short = shortAddress;
  return out;
}

export function clean(out) {
  const source = out && typeof out === "object" ? out : {};
  const date = (value, calendarName) => normalizeDate(value, calendarName);
  const num = (value) => { const numeric = Number(String(value ?? "").replace(/[^0-9.\-]/g, "")); return isFinite(numeric) && numeric !== 0 ? numeric : null; };
  const str = (value) => (value == null ? null : String(value).trim().slice(0, 300) || null);
  const kind = DOC_KINDS.includes(source.kind) ? source.kind : "other";
  const rawDetails = source.details && typeof source.details === "object" ? source.details : {};
  const details = {}, detailLabels = {};
  for (const spec of KIND_FIELDS[kind] || []) {
    detailLabels[spec.key] = { ar: spec.ar, en: spec.en };
    const value = sanitizeDetail(spec, rawDetails[spec.key]);
    if (value != null) details[spec.key] = value;
  }
  return {
    kind,
    title: str(source.title),
    number: str(source.number),
    issuer: str(source.issuer),
    party: str(source.party),
    issue_date: date(source.issue_date, source.issue_date_calendar),
    expiry_date: date(source.expiry_date, source.expiry_date_calendar) || plusOneYear(date(source.issue_date, source.issue_date_calendar)),
    /* لا تاريخ انتهاء في الورقة: يفترض سنة من الإصدار (قاعدة المهندس رعد) ويعلم أنه مفترض */
    expiry_assumed: !date(source.expiry_date, source.expiry_date_calendar) && !!date(source.issue_date, source.issue_date_calendar),
    amount: num(source.amount),
    case_number: str(source.case_number),
    court: str(source.court),
    summary: str(source.summary),
    /* أي جهة يفتحها هذا المستند: شركة أو عمل حر أو شخص — يملأ نوع الحساب عند التسجيل */
    entity_hint: ["company", "establishment", "freelance", "individual", "nonprofit", "government"].includes(source.entity_hint) ? source.entity_hint : null,
    confidence: Math.max(0, Math.min(1, Number(source.confidence) || 0)),
    /* كل بيان في الورقة بمفتاحه، وتسمياته بالعربية والإنجليزية، وما يصلح منها لتحديث ملف الشركة */
    details,
    detail_labels: detailLabels,
    profile_updates: profileUpdates(kind, details, source.short_address),
  };
}

/* قواعد حتمية للمستندات السعودية الشائعة: تعمل قبل النموذج وبعده، ولا تخترع شيئا */
/* بعض ملفات PDF العربية تخرج نصها بأشكال العرض (Presentation Forms) وحروفا
   مفرقة بمسافات، فلا يطابقها أي تعبير. نعيدها إلى حروفها الأساسية ونلصق
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
  /* «ا ل س ج ل» → «السجل»: تلصق الحروف المفردة المتتابعة */
  return String(text || "").replace(/(?:[\u0600-\u06FF]\s){2,}[\u0600-\u06FF]/g, function (run) {
    return run.replace(/\s+/g, "");
  });
}

/* أشكال العرض العربية (U+FB50–FEFF) في ملفات PDF الرسمية تقرأ تماما بعد التطبيع NFKC؛
   المشوه فعلا هو النص المفرق حروفا (كل حرف كلمة). */
export function normalizeArabicText(text) {
  const base = String(text || "").normalize("NFKC").replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\u0640]/g, "");
  return base.split(/\r?\n/).map(repairVisualOrder).join("\n");
}

/* بعض ملفات PDF الرسمية تخرج العربية بترتيب بصري: كل حرف كلمة مستقلة، والحروف والكلمات معكوسة.
   لكل سطر: تلصق الحروف المفردة، ثم تقارن نسخة معكوسة (ترتيب الرموز معكوس، وحروف الرموز العربية معكوسة،
   والمقاطع اللاتينية/الرقمية تبقى بترتيبها) بالأصل بمقياس كلمات عربية شائعة، وتختار الأقرأ. */
const AR_LETTER = "[\u0621-\u064A\u0671-\u06D3]";
const AR_COMMON = ["السجل","التجاري","تجاري","شركة","رقم","تاريخ","الاسم","اسم","المنشأة","وزارة","التجارة","الوطني","الموحد","انتهاء","الانتهاء","إصدار","الإصدار","شهادة","المملكة","العربية","السعودية","النشاط","المدينة","الرياض","جدة","محدودة","مسؤولية","ذات","مؤسسة","الرقم","الضريبي","الهوية","الجواز","وثيقة","العمل","الحر","رخصة","الرخصة","عقد","الطرف","المحكمة","الدعوى","القضية","المدعي","عليه","الحكم","الغرفة","التأمينات","الزكاة","صاحب","صالحة","حتى","في","من","إلى","على","بتاريخ","المعتمد","المصدر","الجهة","نوع","الكيان","التسجيل","الموقع","العنوان","بلدية","أمانة","مخالفة","المخالفة","غرامة","الفاتورة","ريال"];
function arabicScore(line) {
  const words = line.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const w of words) {
    const core = w.replace(/[^\u0621-\u064A\u0671-\u06D3]/g, "");
    if (!core) continue;
    if (AR_COMMON.indexOf(core) !== -1) score += 3;
    if (/^ال/.test(core)) score += 1;          /* الكلمات تبدأ بـ«ال» في العربية السليمة */
    if (/(ة|ات|ية|ين|ون)$/.test(core)) score += 1;
  }
  return score;
}
function joinSingles(line) {
  /* «ش ر ك ة» → «شركة»: سلسلة حروف عربية مفردة تفصلها مسافات */
  return line.replace(new RegExp("(?:" + AR_LETTER + "\\s){2,}" + AR_LETTER, "g"), (run) => run.replace(/\s+/g, ""));
}
function reverseVisual(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean).reverse();
  /* المقاطع اللاتينية/الرقمية المتتالية تعود إلى ترتيبها الأصلي، والحروف العربية تعكس داخل كل رمز */
  const out = []; let latin = [];
  const flush = () => { if (latin.length) { out.push(...latin.reverse()); latin = []; } };
  for (const tok of tokens) {
    if (new RegExp(AR_LETTER).test(tok)) { flush(); out.push([...tok].reverse().join("")); }
    else if (/^[^\w\u0621-\u06D3]+$/.test(tok)) { flush(); out.push(tok); } /* علامات الترقيم تبقى في موضعها المعكوس */
    else latin.push(tok);
  }
  flush();
  return out.join(" ");
}
/* سطر مفكك حروفا (كل حرف عنصر نصي): المسافة الواحدة بين حرفين عربيين فاصل رسم لا فاصل كلمة،
   والمسافتان أو أكثر فاصل كلمة حقيقي. */
function looksGlyphSplit(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  const singles = tokens.filter((t) => new RegExp("^" + AR_LETTER + "$").test(t)).length;
  return tokens.length >= 6 && singles / tokens.length >= 0.4 && /\S {2,}\S/.test(line);
}
function collapseGlyphGaps(line) {
  return line.replace(new RegExp("(" + AR_LETTER + ") (?=" + AR_LETTER + ")", "g"), "$1").replace(/ {2,}/g, " ");
}
function repairVisualOrder(line) {
  if (!new RegExp(AR_LETTER).test(line)) return line;
  const joined = looksGlyphSplit(line) ? collapseGlyphGaps(line) : joinSingles(line);
  const flipped = reverseVisual(joined);
  const a = arabicScore(joined), b = arabicScore(flipped);
  return b > a ? flipped : joined;
}

export function looksMangledArabic(text) {
  var value = normalizeArabicText(text);
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
/* ===== كل ورقة ببياناتها كلها، لا تشخيص واحد =====
   لكل نوع قائمة حقول: مفتاح، اسم عربي وإنجليزي، تسميات (عربية وإنجليزية معا لأن الأوراق السعودية ثنائية اللغة
   والقيمة كثيرا ما تقع بين التسميتين)، ونوع القيمة: text | number | date | id (يتحقق بنمطه).
   core: الحقل الرئيسي الذي يقابله (number/party/issue_date/expiry_date/amount/case_number/court) فيتبادلان القيمة.
   long: نص طويل يتجاوز التسميات (منطوق الحكم). keepLabel: التسمية جزء من القيمة (الدائرة الثالثة). */
const F = (key, type, ar, en, labels, extra) => Object.assign({ key, ar, en, type, labels }, extra || {});
const CR_PAT = "7\\d{9}", ID_PAT = "[12]\\d{9}", VAT_PAT = "3\\d{13}3", TOKEN_PAT = "[0-9A-Za-z\\-\\/]{4,25}";
const LB = {
  cr: ["رقم\\s*السجل\\s*التجاري", "رقم\\s*السجل", "C\\.?R\\.?\\s*(?:No\\.?|Number)?", "Commercial\\s*Regist(?:ration|er)\\s*(?:No\\.?|Number)?"],
  unified: ["الرقم\\s*الوطني\\s*الموحد", "الرقم\\s*الموحد", "National\\s*Number", "Unified\\s*(?:National\\s*)?(?:No\\.?|Number)"],
  est: ["اسم\\s*المنشأة", "الاسم\\s*التجاري", "اسم\\s*الشركة", "اسم\\s*المؤسسة", "Establishment\\s*Name", "Company\\s*Name", "Trade\\s*Name", "Business\\s*Name", "Entity\\s*Name"],
  taxpayer: ["اسم\\s*المكلف", "Taxpayer\\s*Name"],
  tin: ["الرقم\\s*المميز", "TIN"],
  cert: ["رقم\\s*الشهادة", "Certificate\\s*(?:No\\.?|Number)"],
  issue: ["تاريخ\\s*(?:ال)?[إا]صدار", "صدر\\s*(?:في|بتاريخ)", "Issue\\s*Date", "Issued\\s*on", "Release\\s*Date", "Date\\s*of\\s*Issue"],
  expiry: ["تاريخ\\s*(?:ال)?[إا]نتهاء", "ينتهي\\s*(?:في|بتاريخ)", "صالح(?:ة)?\\s*(?:حتى|إلى|الى)", "تاريخ\\s*نهاية", "الانتهاء", "Expir(?:y|es|ation)\\s*(?:Date)?", "Valid\\s*(?:Until|To|Till)", "End\\s*Date"],
  name: ["الاسم\\s*(?:الكامل|الرباعي)?", "Full\\s*Name", "Name"],
  id: ["رقم\\s*الهوية", "رقم\\s*(?:ال)?[إا]قامة", "ID\\s*(?:No\\.?|Number)", "Iqama\\s*(?:No\\.?|Number)?", "National\\s*ID(?:\\s*(?:No\\.?|Number))?"],
  dob: ["تاريخ\\s*الميلاد", "Date\\s*of\\s*Birth", "DOB", "Birth\\s*Date"],
  nationality: ["الجنسية", "Nationality"],
  caseNo: ["رقم\\s*(?:ال)?دعوى", "رقم\\s*القضية", "رقم\\s*القيد", "Case\\s*(?:No\\.?|Number)"],
  court: ["اسم\\s*المحكمة", "Court\\s*Name"],
  circuit: ["الدائرة", "Circuit"],
  plaintiff: ["المدعي(?:ة)?(?!\\s*علي?ه)", "Plaintiff", "Claimant"],
  defendant: ["المدع[يى]\\s*علي?ه(?:ا|م)?", "Defendant", "Respondent"],
  contractNo: ["رقم\\s*(?:ال)?عقد", "رقم\\s*التوثيق", "Contract\\s*(?:No\\.?|Number)"],
  start: ["تاريخ\\s*(?:ال)?بداية(?:\\s*(?:ال)?عقد)?", "بداية\\s*(?:ال)?عقد", "تاريخ\\s*المباشرة", "Start\\s*Date", "Commencement\\s*Date"],
  end: ["تاريخ\\s*(?:ال)?نهاية(?:\\s*(?:ال)?عقد)?", "نهاية\\s*(?:ال)?عقد", "End\\s*Date", "Expiry\\s*Date"],
  activity: ["(?:ال)?نشاط(?:ات)?(?:\\s*(?:الرئيسي|التجاري))?", "الأنشطة", "Activit(?:y|ies)"],
  capital: ["رأس\\s*(?:ال)?مال", "راس\\s*(?:ال)?مال", "Capital"],
  hq: ["المركز\\s*الرئيسي", "مقر\\s*الشركة", "Head\\s*Office", "Headquarters"],
};
const courtFields = (extra) => [
  F("case_number", "id", "رقم الدعوى", "Case No.", LB.caseNo, { pattern: "\\d{3,20}(?:\\/\\d{2,4})?", core: "case_number" }),
  F("court", "text", "المحكمة", "Court", LB.court, { core: "court" }),
  F("circuit", "text", "الدائرة", "Circuit", LB.circuit, { keepLabel: true }),
  F("plaintiff", "text", "المدعي", "Plaintiff", LB.plaintiff, { core: "party" }),
  F("defendant", "text", "المدعى عليه", "Defendant", LB.defendant),
].concat(extra);
const crField = () => F("cr_number", "id", "رقم السجل التجاري", "CR Number", LB.cr, { pattern: CR_PAT });
const issueField = (ar, en, more) => F("issue_date", "date", ar || "تاريخ الإصدار", en || "Issue Date", (more || []).concat(LB.issue), { core: "issue_date" });
const expiryField = (ar, en, more) => F("expiry_date", "date", ar || "تاريخ الانتهاء", en || "Expiry Date", (more || []).concat(LB.expiry), { core: "expiry_date" });
export const KIND_FIELDS = {
  vat_certificate: [
    F("tin", "id", "الرقم المميز", "TIN", LB.tin, { pattern: "3\\d{9}" }),
    F("certificate_number", "id", "رقم الشهادة", "Certificate No.", LB.cert, { pattern: "\\d{6,20}" }),
    F("certificate_date", "date", "تاريخ الشهادة", "Certificate date", ["تاريخ\\s*الشهادة", "Certificate\\s*Date"].concat(LB.issue), { core: "issue_date" }),
    F("taxpayer_name", "text", "اسم المكلف", "Taxpayer Name", LB.taxpayer, { core: "party" }),
    F("vat_number", "id", "رقم التسجيل الضريبي", "VAT Registration Number", ["رقم\\s*التسجيل\\s*الضريبي", "الرقم\\s*الضريبي", "VAT\\s*(?:Registration\\s*)?(?:No\\.?|Number)"], { pattern: VAT_PAT, core: "number" }),
    F("effective_date", "date", "تاريخ نفاذ التسجيل", "Effective Registration Date", ["تاريخ\\s*نفاذ\\s*(?:ال)?تسجيل", "Effective\\s*(?:Registration\\s*)?Date"]),
    F("address", "text", "عنوان المكلف", "Taxpayer Address", ["عنوان\\s*المكلف", "Taxpayer\\s*Address", "العنوان"]),
    F("cr_number", "id", "رقم السجل التجاري", "CR / License", ["CR\\s*\\/\\s*License"].concat(LB.cr), { pattern: CR_PAT }),
    F("tax_period", "text", "الفترة الضريبية", "Tax Period", ["الفترة\\s*الضريبية", "Tax\\s*Period"]),
    F("first_filing_due", "date", "تاريخ استحقاق أول إقرار", "First Filing due date", ["تاريخ\\s*استحقاق\\s*[أا]ول\\s*[إا]قرار", "First\\s*Filing\\s*due\\s*date"]),
  ],
  commercial_register: [
    F("cr_number", "id", "رقم السجل التجاري", "CR Number", LB.cr, { pattern: CR_PAT, core: "number" }),
    F("unified_number", "id", "الرقم الوطني الموحد", "Unified National Number", LB.unified, { pattern: CR_PAT }),
    F("company_name", "text", "اسم الشركة", "Company Name", LB.est, { core: "party" }),
    F("entity_type", "text", "نوع الكيان", "Entity Type", ["نوع\\s*الكيان", "الشكل\\s*القانوني", "Entity\\s*Type", "Legal\\s*Form"]),
    F("characteristics", "text", "صفات الشركة", "Company Characteristics", ["صفات\\s*الشركة", "Company\\s*Characteristics"]),
    F("status", "text", "حالة السجل", "Status", ["حالة\\s*السجل", "الحالة", "Status"]),
    issueField("تاريخ الإصدار", "Release date"), expiryField(),
    F("city", "text", "المدينة", "City", ["المدينة", "City"]),
    F("activity", "text", "النشاط", "Activity", LB.activity),
    F("capital", "number", "رأس المال", "Capital", LB.capital),
  ],
  articles_of_association: [
    F("notarization_number", "id", "رقم التوثيق", "Notarization No.", ["رقم\\s*التوثيق", "رقم\\s*(?:ال)?عقد", "رقم\\s*(?:ال)?وثيقة", "Notarization\\s*(?:No\\.?|Number)", "Document\\s*(?:No\\.?|Number)"], { pattern: "\\d{4,20}", core: "number" }),
    F("company_name", "text", "اسم الشركة", "Company Name", LB.est.concat(["تحت\\s*اسم"]), { core: "party" }),
    F("capital", "number", "رأس المال", "Capital", LB.capital),
    F("headquarters", "text", "المركز الرئيسي", "Head Office", LB.hq),
    F("duration", "text", "مدة الشركة", "Duration", ["مدة\\s*الشركة", "Duration"]),
    issueField("تاريخ العقد", "Contract Date", ["تاريخ\\s*(?:ال)?عقد", "تاريخ\\s*التوثيق", "Contract\\s*Date"]),
  ],
  bylaws: [
    F("company_name", "text", "اسم الشركة", "Company Name", LB.est, { core: "party" }),
    F("capital", "number", "رأس المال", "Capital", LB.capital),
    F("headquarters", "text", "المركز الرئيسي", "Head Office", LB.hq),
  ],
  gosi_certificate: [
    F("subscription_number", "id", "رقم الاشتراك", "Subscription No.", ["رقم\\s*الاشتراك", "رقم\\s*المشترك", "رقم\\s*المنشأة", "Subscription\\s*(?:No\\.?|Number)", "Establishment\\s*(?:No\\.?|Number)"], { pattern: "\\d{6,15}", core: "number" }),
    F("certificate_number", "id", "رقم الشهادة", "Certificate No.", LB.cert, { pattern: TOKEN_PAT }),
    F("establishment_name", "text", "اسم المنشأة", "Establishment Name", LB.est.concat(["اسم\\s*صاحب\\s*العمل", "Employer\\s*Name"]), { core: "party" }),
    crField(), issueField(), expiryField(),
  ],
  zakat_certificate: [
    F("certificate_number", "id", "رقم الشهادة", "Certificate No.", LB.cert, { pattern: "\\d{4,20}", core: "number" }),
    F("tin", "id", "الرقم المميز", "TIN", LB.tin.concat(["رقم\\s*المكلف"]), { pattern: "3\\d{9}" }),
    F("taxpayer_name", "text", "اسم المكلف", "Taxpayer Name", LB.taxpayer.concat(LB.est), { core: "party" }),
    crField(),
    F("fiscal_year", "text", "السنة المالية", "Fiscal Year", ["السنة\\s*المالية", "العام\\s*المالي", "الفترة\\s*(?:المالية|الزكوية)", "Fiscal\\s*Year", "Financial\\s*Year"]),
    issueField(), expiryField(),
  ],
  chamber_certificate: [
    F("membership_number", "id", "رقم العضوية", "Membership No.", ["رقم\\s*العضوية", "رقم\\s*الاشتراك", "Membership\\s*(?:No\\.?|Number)"], { pattern: "\\d{4,15}", core: "number" }),
    F("grade", "text", "الدرجة", "Grade", ["الدرجة", "درجة\\s*(?:ال)?عضوية", "Grade", "Membership\\s*Class"]),
    F("establishment_name", "text", "اسم المنشأة", "Establishment Name", LB.est.concat(["اسم\\s*العضو", "Member\\s*Name"]), { core: "party" }),
    crField(), issueField(), expiryField(),
  ],
  saudization_certificate: [
    F("establishment_number", "id", "رقم المنشأة", "Establishment No.", ["رقم\\s*المنشأة", "الرقم\\s*الموحد\\s*للمنشأة", "Establishment\\s*(?:No\\.?|Number)"], { pattern: "\\d{1,3}-\\d{5,12}|\\d{6,15}" }),
    F("certificate_number", "id", "رقم الشهادة", "Certificate No.", LB.cert, { pattern: TOKEN_PAT, core: "number" }),
    F("nitaqat_color", "text", "النطاق", "Nitaqat", ["النطاق", "نطاق\\s*(?:ال)?منشأة", "لون\\s*(?:ال)?نطاق", "Nitaqat(?:\\s*(?:Color|Range|Band))?"]),
    F("establishment_name", "text", "اسم المنشأة", "Establishment Name", LB.est, { core: "party" }),
    crField(), issueField(), expiryField(),
  ],
  id_document: [
    F("id_number", "id", "رقم الهوية", "ID Number", LB.id, { pattern: ID_PAT, core: "number" }),
    F("full_name", "text", "الاسم", "Full Name", LB.name.concat(["اسم\\s*صاحب\\s*الهوية"]), { core: "party" }),
    F("date_of_birth", "date", "تاريخ الميلاد", "Date of Birth", LB.dob),
    issueField(), expiryField(),
    F("nationality", "text", "الجنسية", "Nationality", LB.nationality),
    F("place_of_issue", "text", "مكان الإصدار", "Place of Issue", ["مكان\\s*(?:ال)?[إا]صدار", "جهة\\s*(?:ال)?[إا]صدار", "Place\\s*of\\s*Issue"]),
  ],
  passport: [
    F("passport_number", "id", "رقم الجواز", "Passport No.", ["رقم\\s*(?:ال)?جواز", "Passport\\s*(?:No\\.?|Number)"], { pattern: "[A-Z]\\d{6,9}|\\d{7,9}", core: "number" }),
    F("full_name", "text", "الاسم", "Full Name", LB.name.concat(["اسم\\s*صاحب\\s*الجواز", "Surname", "Given\\s*Names?"]), { core: "party" }),
    F("nationality", "text", "الجنسية", "Nationality", LB.nationality),
    F("date_of_birth", "date", "تاريخ الميلاد", "Date of Birth", LB.dob),
    issueField(), expiryField(),
  ],
  driving_license: [
    F("license_number", "id", "رقم الرخصة", "License No.", ["رقم\\s*(?:ال)?رخصة", "Licen[cs]e\\s*(?:No\\.?|Number)"], { pattern: ID_PAT + "|\\d{6,12}", core: "number" }),
    F("id_number", "id", "رقم الهوية", "ID Number", LB.id, { pattern: ID_PAT }),
    F("full_name", "text", "الاسم", "Full Name", LB.name.concat(["اسم\\s*صاحب\\s*الرخصة"]), { core: "party" }),
    F("date_of_birth", "date", "تاريخ الميلاد", "Date of Birth", LB.dob),
    F("license_class", "text", "نوع الرخصة", "Class", ["نوع\\s*(?:ال)?رخصة", "الفئة", "Licen[cs]e\\s*(?:Type|Class)", "Class"]),
    issueField(), expiryField(),
  ],
  vehicle_registration: [
    F("serial_number", "id", "الرقم التسلسلي", "Serial No.", ["الرقم\\s*التسلسلي", "Serial\\s*(?:No\\.?|Number)"], { pattern: "\\d{6,12}", core: "number" }),
    F("plate_number", "text", "رقم اللوحة", "Plate No.", ["رقم\\s*(?:ال)?لوحة", "اللوحة", "Plate\\s*(?:No\\.?|Number)?"]),
    F("chassis_number", "id", "رقم الهيكل", "Chassis No.", ["رقم\\s*الهيكل", "Chassis\\s*(?:No\\.?|Number)", "VIN"], { pattern: "[A-HJ-NPR-Z0-9]{11,17}" }),
    F("owner", "text", "اسم المالك", "Owner", ["اسم\\s*المالك", "المالك", "Owner(?:\\s*Name)?"], { core: "party" }),
    F("make", "text", "الماركة", "Make", ["الماركة", "الصنع", "Make", "Manufacturer"]),
    F("model", "text", "الطراز", "Model", ["الطراز", "الموديل", "Model"]),
    F("year", "id", "سنة الصنع", "Model Year", ["سنة\\s*(?:ال)?صنع", "Model\\s*Year", "Year"], { pattern: "(?:19|20)\\d{2}" }),
    F("color", "text", "اللون", "Color", ["اللون", "Colou?r"]),
    expiryField(),
  ],
  insurance_policy: [
    F("policy_number", "id", "رقم الوثيقة", "Policy No.", ["رقم\\s*(?:ال)?وثيقة", "رقم\\s*(?:ال)?بوليصة", "Policy\\s*(?:No\\.?|Number)"], { pattern: TOKEN_PAT, core: "number" }),
    F("insured", "text", "المؤمن له", "Insured", ["اسم\\s*المؤمن\\s*له", "المؤمن\\s*له", "Insured(?:\\s*Name)?", "Policy\\s*Holder"], { core: "party" }),
    F("insurer", "text", "شركة التأمين", "Insurer", ["شركة\\s*التأمين", "المؤمن(?!\\s*له)", "Insurer", "Insurance\\s*Company"]),
    F("coverage", "text", "نوع التغطية", "Coverage", ["نوع\\s*(?:ال)?تغطية", "التغطية", "Coverage", "Type\\s*of\\s*Cover"]),
    F("start_date", "date", "بداية الوثيقة", "Effective Date", ["بداية\\s*(?:ال)?(?:وثيقة|تغطية)", "تاريخ\\s*بداية\\s*(?:ال)?(?:وثيقة|تغطية)", "Effective\\s*Date", "Policy\\s*Start"].concat(LB.start), { core: "issue_date" }),
    F("end_date", "date", "نهاية الوثيقة", "Expiry Date", ["نهاية\\s*(?:ال)?(?:وثيقة|تغطية)", "تاريخ\\s*نهاية\\s*(?:ال)?(?:وثيقة|تغطية)", "Policy\\s*End"].concat(LB.expiry, LB.end), { core: "expiry_date" }),
    F("premium", "number", "قسط التأمين", "Premium", ["إجمالي\\s*(?:ال)?قسط", "اجمالي\\s*(?:ال)?قسط", "قسط\\s*التأمين", "القسط", "(?:Total\\s*)?Premium"], { core: "amount" }),
  ],
  license: [
    F("permit_number", "id", "رقم الرخصة", "License No.", ["رقم\\s*(?:ال)?رخصة", "رقم\\s*(?:ال)?ترخيص", "رقم\\s*(?:ال)?تصريح", "رقم\\s*(?:ال)?وثيقة", "رقم\\s*(?:ال)?تسجيل", "Licen[cs]e\\s*(?:No\\.?|Number)", "Permit\\s*(?:No\\.?|Number)", "Document\\s*(?:No\\.?|Number)"], { pattern: "[0-9A-Za-z\\-\\/]{4,30}", core: "number" }),
    F("holder_name", "text", "اسم المرخص له", "Licensee", LB.est.concat(["اسم\\s*المرخص\\s*له", "اسم\\s*صاحب\\s*(?:ال)?(?:وثيقة|رخصة|ترخيص)", "اسم\\s*(?:ال)?مستفيد", "Licen[cs]ee(?:\\s*Name)?", "Holder\\s*Name", "Permit\\s*Holder"], LB.name), { core: "party" }),
    F("id_number", "id", "رقم الهوية", "ID Number", LB.id, { pattern: ID_PAT }),
    crField(),
    F("activity", "text", "النشاط", "Activity", LB.activity.concat(["نوع\\s*(?:ال)?(?:رخصة|نشاط)", "Licen[cs]e\\s*Type"])),
    issueField(), expiryField(),
  ],
  hearing_notice: courtFields([
    F("hearing_date", "date", "تاريخ الجلسة", "Hearing Date", ["تاريخ\\s*(?:ال)?جلسة", "موعد\\s*(?:ال)?جلسة", "Hearing\\s*Date"], { core: "expiry_date" }),
    F("hearing_time", "text", "وقت الجلسة", "Hearing Time", ["وقت\\s*(?:ال)?جلسة", "الساعة", "Hearing\\s*Time"], { pattern: "\\d{1,2}[:.]\\d{2}\\s*(?:صباحا|مساء|ص|م|AM|PM)?" }),
  ]),
  case_filing: courtFields([
    F("filing_date", "date", "تاريخ القيد", "Filing Date", ["تاريخ\\s*(?:ال)?قيد", "تاريخ\\s*رفع\\s*(?:ال)?دعوى", "تاريخ\\s*(?:ال)?تقديم", "Filing\\s*Date"].concat(LB.issue), { core: "issue_date" }),
    F("claim_amount", "number", "قيمة المطالبة", "Claim Amount", ["قيمة\\s*(?:ال)?مطالبة", "مبلغ\\s*(?:ال)?مطالبة", "المطالبة", "Claim\\s*(?:Amount|Value)"], { core: "amount" }),
    F("subject", "text", "موضوع الدعوى", "Subject", ["موضوع\\s*(?:ال)?دعوى", "Subject"], { long: true }),
  ]),
  court_ruling: courtFields([
    F("ruling_number", "id", "رقم الصك", "Ruling No.", ["رقم\\s*الصك", "رقم\\s*الحكم", "رقم\\s*القرار", "Ruling\\s*(?:No\\.?|Number)", "Judg?ment\\s*(?:No\\.?|Number)", "Deed\\s*(?:No\\.?|Number)"], { pattern: "\\d{4,20}", core: "number" }),
    F("ruling_date", "date", "تاريخ الحكم", "Ruling Date", ["تاريخ\\s*(?:ال)?(?:حكم|صك|قرار)", "Ruling\\s*Date", "Judg?ment\\s*Date"].concat(LB.issue), { core: "issue_date" }),
    F("verdict", "text", "منطوق الحكم", "Verdict", ["منطوق\\s*الحكم", "نص\\s*الحكم", "حكمت\\s*(?:المحكمة|الدائرة)", "Verdict", "Judg?ment\\s*Text"], { long: true }),
  ]),
  violation: [
    F("violation_number", "id", "رقم المخالفة", "Violation No.", ["رقم\\s*(?:ال)?مخالفة", "رقم\\s*القرار", "رقم\\s*(?:ال)?[إا]شعار", "رقم\\s*(?:ال)?مرجع", "Violation\\s*(?:No\\.?|Number)", "Reference\\s*(?:No\\.?|Number)", "Ticket\\s*(?:No\\.?|Number)"], { pattern: TOKEN_PAT, core: "number" }),
    F("issuer", "text", "الجهة المصدرة", "Issuer", ["الجهة\\s*(?:المصدرة|المخالفة|الرقابية)?", "Issu(?:er|ed\\s*by)", "Authority"]),
    F("violator", "text", "المخالف", "Violator", ["اسم\\s*(?:ال)?منشأة", "اسم\\s*(?:ال)?مخالف", "المخالف", "Violator", "Offender"], { core: "party" }),
    F("amount", "number", "مبلغ المخالفة", "Amount", ["مبلغ\\s*(?:ال)?(?:مخالفة|غرامة)", "قيمة\\s*(?:ال)?(?:مخالفة|غرامة)", "الغرامة", "المبلغ", "Fine\\s*Amount", "Amount", "Fine"], { core: "amount" }),
    F("violation_date", "date", "تاريخ المخالفة", "Violation Date", ["تاريخ\\s*(?:ال)?مخالفة", "تاريخ\\s*(?:ال)?ضبط", "Violation\\s*Date"].concat(LB.issue), { core: "issue_date" }),
    F("due_date", "date", "تاريخ الاستحقاق", "Due Date", ["تاريخ\\s*(?:ال)?استحقاق", "تاريخ\\s*(?:ال)?سداد", "آخر\\s*موعد", "اخر\\s*موعد", "Due\\s*Date", "Pay\\s*by"], { core: "expiry_date" }),
    F("location", "text", "الموقع", "Location", ["الموقع", "مكان\\s*(?:ال)?مخالفة", "موقع\\s*(?:ال)?مخالفة", "Location"]),
    F("description", "text", "وصف المخالفة", "Description", ["وصف\\s*(?:ال)?مخالفة", "نوع\\s*(?:ال)?مخالفة", "بيان\\s*(?:ال)?مخالفة", "البيان", "Description", "Violation\\s*Type"], { long: true }),
  ],
  invoice: [
    F("invoice_number", "id", "رقم الفاتورة", "Invoice No.", ["رقم\\s*(?:ال)?فاتورة", "Invoice\\s*(?:No\\.?|Number|#)"], { pattern: "[0-9A-Za-z\\-\\/]{3,25}", core: "number" }),
    F("invoice_date", "date", "تاريخ الفاتورة", "Invoice Date", ["تاريخ\\s*(?:ال)?فاتورة", "Invoice\\s*Date", "Date"].concat(LB.issue), { core: "issue_date" }),
    F("due_date", "date", "تاريخ الاستحقاق", "Due Date", ["تاريخ\\s*(?:ال)?استحقاق", "Due\\s*Date"], { core: "expiry_date" }),
    F("seller", "text", "المورد", "Seller", ["اسم\\s*(?:ال)?(?:مورد|بائع)", "المورد", "البائع", "Seller", "Supplier", "Vendor"]),
    F("buyer", "text", "العميل", "Buyer", ["اسم\\s*(?:ال)?(?:عميل|مشتري)", "العميل", "المشتري", "Buyer", "Customer", "Bill\\s*To", "Client"], { core: "party" }),
    F("vat_number", "id", "الرقم الضريبي", "VAT Number", ["الرقم\\s*الضريبي", "رقم\\s*التسجيل\\s*الضريبي", "VAT\\s*(?:Registration\\s*)?(?:No\\.?|Number)"], { pattern: VAT_PAT }),
    F("subtotal", "number", "المجموع الفرعي", "Subtotal", ["المجموع\\s*الفرعي", "الإجمالي\\s*(?:قبل|غير\\s*شامل)\\s*(?:ال)?ضريبة", "Sub\\s*-?\\s*total", "Total\\s*(?:before|excl(?:uding|\\.)?)\\s*VAT", "Taxable\\s*Amount"]),
    F("vat_amount", "number", "قيمة الضريبة", "VAT Amount", ["قيمة\\s*(?:ال)?ضريبة", "مبلغ\\s*(?:ال)?ضريبة", "ضريبة\\s*القيمة\\s*المضافة(?:\\s*\\(?\\d{1,2}\\s*%\\)?)?", "VAT\\s*Amount", "VAT\\s*\\(?\\d{1,2}\\s*%\\)?", "Tax\\s*Amount"]),
    F("total", "number", "الإجمالي", "Total", ["الإجمالي\\s*(?:شامل\\s*(?:ال)?ضريبة|النهائي|المستحق)?", "المجموع\\s*(?:الكلي|النهائي)?", "إجمالي\\s*(?:المبلغ|الفاتورة)", "Grand\\s*Total", "Total\\s*(?:Amount|Due|incl(?:uding|\\.)?\\s*VAT)?", "Amount\\s*Due"], { core: "amount" }),
  ],
  lease_contract: [
    F("contract_number", "id", "رقم العقد", "Contract No.", LB.contractNo, { pattern: TOKEN_PAT, core: "number" }),
    F("landlord", "text", "المؤجر", "Landlord", ["اسم\\s*المؤجر", "المؤجر(?:ة)?", "المالك", "Landlord", "Lessor", "Owner"]),
    F("tenant", "text", "المستأجر", "Tenant", ["اسم\\s*المستأجر", "المستأجر(?:ة)?", "Tenant", "Lessee"], { core: "party" }),
    F("property", "text", "العقار", "Property", ["وصف\\s*(?:ال)?(?:عقار|وحدة)", "عنوان\\s*(?:ال)?عقار", "نوع\\s*(?:ال)?(?:عقار|وحدة)", "العقار", "الوحدة", "Property(?:\\s*(?:Description|Address|Type))?", "Unit(?:\\s*(?:No\\.?|Number|Type))?"]),
    F("start_date", "date", "تاريخ بداية العقد", "Start Date", LB.start, { core: "issue_date" }),
    F("end_date", "date", "تاريخ نهاية العقد", "End Date", LB.end, { core: "expiry_date" }),
    F("annual_rent", "number", "قيمة الإيجار السنوي", "Annual Rent", ["قيمة\\s*(?:ال)?[إا]يجار(?:\\s*السنوي(?:ة)?)?", "الأجرة\\s*السنوية", "الاجرة\\s*السنوية", "(?:ال)?[إا]يجار\\s*السنوي", "Annual\\s*Rent", "Rent(?:al)?\\s*(?:Amount|Value)"], { core: "amount" }),
    F("total_value", "number", "إجمالي قيمة العقد", "Total Contract Value", ["إجمالي\\s*(?:قيمة\\s*)?(?:ال)?عقد", "اجمالي\\s*(?:قيمة\\s*)?(?:ال)?عقد", "قيمة\\s*(?:ال)?عقد", "Total\\s*(?:Contract\\s*)?(?:Value|Amount)", "Contract\\s*Value"]),
  ],
  power_of_attorney: [
    F("poa_number", "id", "رقم الوكالة", "POA No.", ["رقم\\s*(?:ال)?وكالة", "رقم\\s*التوثيق", "رقم\\s*(?:ال)?صك", "Power\\s*of\\s*Attorney\\s*(?:No\\.?|Number)", "POA\\s*(?:No\\.?|Number)", "Deed\\s*(?:No\\.?|Number)"], { pattern: "\\d{6,20}", core: "number" }),
    F("principal", "text", "الموكل", "Principal", ["اسم\\s*الموكل", "الموكل(?:ة|ون|ين)?", "Principal", "Grantor"], { core: "party" }),
    F("agent", "text", "الوكيل", "Agent", ["اسم\\s*الوكيل", "الوكيل(?:ة)?", "Agent(?:\\s*Name)?", "Attorney\\s*Name"]),
    issueField("تاريخ الوكالة", "Issue Date", ["تاريخ\\s*(?:ال)?وكالة", "تاريخ\\s*التوثيق"]),
    expiryField("تاريخ انتهاء الوكالة", "Expiry Date", ["تاريخ\\s*(?:ال)?[إا]نتهاء\\s*(?:ال)?وكالة"]),
    F("scope", "text", "نص الوكالة", "Scope", ["نص\\s*(?:ال)?وكالة", "بنود\\s*(?:ال)?وكالة", "صلاحيات\\s*(?:ال)?وكيل", "نطاق\\s*(?:ال)?وكالة", "موضوع\\s*(?:ال)?وكالة", "Scope", "Powers"], { long: true }),
  ],
  employment_contract: [
    F("contract_number", "id", "رقم العقد", "Contract No.", LB.contractNo, { pattern: TOKEN_PAT, core: "number" }),
    F("employee", "text", "الموظف", "Employee", ["اسم\\s*(?:ال)?(?:موظف|عامل)", "الموظف(?:ة)?", "العامل(?:ة)?", "الطرف\\s*الثاني", "Employee(?:\\s*Name)?", "Second\\s*Party", "Worker"], { core: "party" }),
    F("employer", "text", "صاحب العمل", "Employer", ["صاحب\\s*العمل", "اسم\\s*(?:ال)?منشأة", "الطرف\\s*الأول", "الطرف\\s*الاول", "Employer(?:\\s*Name)?", "First\\s*Party", "Establishment\\s*Name"]),
    F("job_title", "text", "المهنة", "Job Title", ["المهنة", "المسمى\\s*الوظيفي", "الوظيفة", "Job\\s*Title", "Occupation", "Position", "Profession"]),
    F("salary", "number", "الراتب", "Salary", ["الراتب\\s*(?:الأساسي|الاساسي|الشهري)?", "الأجر\\s*(?:الأساسي|الشهري)?", "الاجر\\s*(?:الاساسي|الشهري)?", "(?:Basic|Monthly)\\s*(?:Salary|Wage)", "Salary", "Wage"], { core: "amount" }),
    F("start_date", "date", "تاريخ بداية العقد", "Start Date", LB.start, { core: "issue_date" }),
    F("end_date", "date", "تاريخ نهاية العقد", "End Date", LB.end, { core: "expiry_date" }),
    F("duration", "text", "مدة العقد", "Contract Duration", ["مدة\\s*(?:ال)?عقد", "(?:Contract\\s*)?Duration"]),
    F("id_number", "id", "رقم الهوية", "ID Number", LB.id, { pattern: ID_PAT }),
  ],
  contract: [
    F("contract_number", "id", "رقم العقد", "Contract No.", LB.contractNo.concat(["رقم\\s*الاتفاقية", "Agreement\\s*(?:No\\.?|Number)"]), { pattern: TOKEN_PAT, core: "number" }),
    F("first_party", "text", "الطرف الأول", "First Party", ["الطرف\\s*الأول", "الطرف\\s*الاول", "First\\s*Party"], { core: "party" }),
    F("second_party", "text", "الطرف الثاني", "Second Party", ["الطرف\\s*الثاني", "Second\\s*Party"]),
    F("contract_date", "date", "تاريخ العقد", "Contract Date", ["تاريخ\\s*(?:ال)?(?:عقد|اتفاقية)", "تاريخ\\s*(?:ال)?تحرير", "حرر\\s*(?:في|بتاريخ)", "Contract\\s*Date", "Agreement\\s*Date"].concat(LB.issue), { core: "issue_date" }),
    F("start_date", "date", "تاريخ البداية", "Start Date", LB.start),
    F("end_date", "date", "تاريخ النهاية", "End Date", LB.end, { core: "expiry_date" }),
    F("value", "number", "قيمة العقد", "Contract Value", ["قيمة\\s*(?:ال)?عقد", "إجمالي\\s*(?:قيمة\\s*)?(?:ال)?عقد", "اجمالي\\s*(?:قيمة\\s*)?(?:ال)?عقد", "المبلغ\\s*الإجمالي", "Contract\\s*Value", "Total\\s*(?:Value|Amount)"], { core: "amount" }),
    F("subject", "text", "موضوع العقد", "Subject", ["موضوع\\s*(?:ال)?(?:عقد|اتفاقية)", "Subject", "Scope\\s*of\\s*Work"], { long: true }),
  ],
};

/* التسمية كلمة كاملة: لا تبدأ داخل كلمة عربية أو لاتينية ولا تنتهي داخلها */
const LABEL_EDGE_L = "(?<![\\u0621-\\u064A\\u0671-\\u06D3A-Za-z])", LABEL_EDGE_R = "(?![\\u0621-\\u064A\\u0671-\\u06D3A-Za-z])";
const wrapLabel = (label) => LABEL_EDGE_L + "(?:" + label + ")" + LABEL_EDGE_R;
const DATE_TOKEN = /\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}/;
/* عناوين أقسام تنهي أي قيمة نصية وليست تسمية حقل */
const STOP_HEADINGS = ["Basic\\s*data", "البيانات\\s*الأساسية", "البيانات\\s*الاساسية"];

/* «31/08/2026» أو «2026/09/01» أو «1448/04/30» (هجري يحول بأم القرى) → YYYY-MM-DD ميلادي */
function isoDate(raw) {
  const match = westernize(String(raw || "")).match(DATE_TOKEN);
  if (!match) return null;
  const parts = match[0].replace(/[\/.]/g, "-").split("-").map((part) => part.padStart(2, "0"));
  return normalizeDate(parts[0].length === 4 ? parts.join("-") : `${parts[2]}-${parts[1]}-${parts[0]}`);
}

/* كل مواقع تسميات حقول هذا النوع في النص، مرتبة، بلا تداخل (الأطول يغلب عند نفس البداية) */
function labelHits(specs, text) {
  const hits = [];
  for (const spec of specs) for (const label of spec.labels) {
    const re = new RegExp(wrapLabel(label), "gi");
    let m;
    while ((m = re.exec(text))) { if (!m[0]) { re.lastIndex++; continue; } hits.push({ start: m.index, end: m.index + m[0].length, spec }); }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  for (const hit of hits) if (!kept.length || hit.start >= kept[kept.length - 1].end) kept.push(hit);
  return kept;
}

/* قيمة نصية: أول سطر غير فارغ بعد التسمية (قد تكون القيمة في السطر التالي)، تقطع عند نقطتين تسبقهما تسمية
   حقل آخر لم نعرفه، وعند تسمية حقل آخر أينما وقعت، وعند تسمية الحقل نفسه إن ختمت السطر (الصيغة ثنائية اللغة:
   «Taxpayer Name PARKINZI Company اسم المكلف») لا إن جاءت كلمة في القيمة («المورد: شركة المورد المحدودة») */
function tidyText(head, cuts) {
  let value = head.split(/\n/).map((line) => line.trim()).find(Boolean) || "";
  const colon = value.indexOf(":");
  if (colon !== -1) value = value.slice(0, colon).trim().replace(/\s*\S+$/, "");
  for (const re of [cuts.others, cuts.ownAtEnd]) {
    const stop = value.search(re);
    if (stop === 0) return null;
    if (stop > 0) value = value.slice(0, stop);
  }
  value = value.replace(/\s+/g, " ").replace(/[\s:\-–—،,;.]+$/, "").trim();
  return value.length >= 2 ? value.slice(0, 200).trim() : null;
}
function textCuts(spec, specs) {
  const others = specs.filter((other) => other !== spec).flatMap((other) => other.labels).concat(STOP_HEADINGS).map(wrapLabel);
  return { others: new RegExp(others.join("|"), "i"), ownAtEnd: new RegExp("(?:" + spec.labels.map(wrapLabel).join("|") + ")\\s*$", "i") };
}
function tidyLong(head) {
  const value = head.split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  return value.length >= 2 ? value.slice(0, 200).trim() : null;
}

function detailValue(spec, segment, cuts, labelText) {
  const head = segment.replace(/^[\s:\-–—.]+/, "");
  if (spec.type === "date") return isoDate(head.slice(0, 60));
  if (spec.type === "number") {
    const match = head.slice(0, 60).match(/[0-9][0-9,]*(?:\.[0-9]+)?/);
    const numeric = match ? Number(match[0].replace(/,/g, "")) : NaN;
    return isFinite(numeric) && numeric > 0 ? numeric : null;
  }
  if (spec.type === "id") { const match = head.slice(0, 80).match(new RegExp("(?<![0-9A-Za-z])(?:" + spec.pattern + ")(?![0-9A-Za-z])")); return match ? match[0] : null; }
  if (spec.pattern) { const match = head.slice(0, 80).match(new RegExp(spec.pattern, "i")); return match ? match[0].trim() : null; }
  const value = spec.long ? tidyLong(head) : tidyText(head, cuts);
  return value && spec.keepLabel ? labelText.trim() + " " + value : value;
}

/* كل بيانات الورقة من نوعها: تسمية ثم قيمة. القيمة هي ما بين التسمية وأول تسمية لحقل آخر (تسمية الحقل نفسه
   بلغته الثانية تبقى داخل المقطع)، فتصح الصيغ الثلاث: «التسمية: القيمة»، و«English label  القيمة  التسمية العربية»،
   والتسمية في سطر والقيمة في التالي. */
export function extractDetails(kind, rawText) {
  const specs = KIND_FIELDS[kind];
  if (!specs) return {};
  const text = westernize(rawText).replace(/：/g, ":");
  const hits = labelHits(specs, text);
  const cutsBySpec = new Map();
  const details = {};
  hits.forEach((hit, index) => {
    const spec = hit.spec;
    if (details[spec.key] != null) return;
    let next = index + 1;
    while (next < hits.length && hits[next].spec === spec) next++;
    const segmentEnd = spec.long ? Math.min(text.length, hit.end + 400) : (next < hits.length ? hits[next].start : text.length);
    if (!cutsBySpec.has(spec)) cutsBySpec.set(spec, textCuts(spec, specs));
    const value = detailValue(spec, text.slice(hit.end, segmentEnd), cutsBySpec.get(spec), text.slice(hit.start, hit.end));
    if (value != null) details[spec.key] = value;
  });
  return details;
}

/* جدول الأوراق الرسمية المعروفة: كل نوع بكلماته ومسميات رقمه وجهته. يفحص بالترتيب. */
const wordBoundaryAr = (pattern) => "(?<![\\u0600-\\u06FF])(?:" + pattern + ")(?![\\u0600-\\u06FF])";
const KIND_RULES = [
  /* رقم السجل التجاري السعودي عشر خانات تبدأ بـ7 دائما (رقم المهندس رعد 7055060102)؛ أرقام الهوية تبدأ بـ1 أو 2 وليست سجلا */
  { kind: "commercial_register", entity: "company", test: /^(?![\s\S]*(?:ضريبة\s*القيمة|الرقم\s*الضريبي|شهادة\s*(?:تسجيل\s*)?(?:في\s*)?ضريبة|\bVAT\b|شهادة\s*(?:ال|لل)?زكاة|الزكاة\s*والدخل|(?:ال|لل)تأمينات\s*الاجتماعية|(?:ال|لل)غرفة\s*التجارية|شهادة\s*(?:السعودة|التوطين)|نطاقات))[\s\S]*(?:السجل\s*التجاري|سجل\s*تجاري|رقم\s*السجل|شهادة\s*(?:ال)?سجل|commercial\s*regist|(?=[\s\S]*سجل)(?=[\s\S]*\b7\d{9}\b))/i, issuer: "وزارة التجارة",
    number: ["رقم\\s*السجل\\s*التجاري", "رقم\\s*السجل", "الرقم\\s*الوطني\\s*الموحد", "الرقم\\s*الموحد", "C\\.?R\\.?\\s*(?:No\\.?)?", "national\\s*number", "unified\\s*number", "registration\\s*number"],
    numPat: "7\\d{9}",
    party: ["اسم\\s*المنشأة", "الاسم\\s*التجاري", "اسم\\s*الشركة", "اسم\\s*التاجر", "business\\s*name", "trade\\s*name", "company\\s*name", "entity\\s*name"] },
  { kind: "articles_of_association", test: /عقد\s*(?:ال)?تأسيس|عقد\s*شركة|articles\s*of\s*(?:association|incorporation)|memorandum\s*of\s*association/i,
    number: ["رقم\\s*العقد", "رقم\\s*التوثيق", "رقم\\s*الوثيقة"], numPat: "\\d{4,20}", party: ["اسم\\s*الشركة", "تحت\\s*اسم", "باسم"], issuerTest: [[/وزارة\s*التجارة/, "وزارة التجارة"], [/كاتب\s*(?:ال)?عدل|العدل/, "وزارة العدل"]] },
  { kind: "bylaws", test: /النظام\s*الأساس|النظام\s*الاساس|bylaws/i, issuer: "وزارة التجارة", party: ["اسم\\s*الشركة", "شركة"] },
  { kind: "chamber_certificate", test: /(?:ال|لل)غرفة\s*التجارية|غرفة\s*(?:الرياض|جدة|الشرقية|مكة|المدينة|القصيم|عسير|حائل|تبوك|جازان|نجران|الجوف|الباحة)|chamber\s*of\s*commerce/i, issuer: "الغرفة التجارية",
    number: ["رقم\\s*العضوية", "رقم\\s*الاشتراك", "رقم\\s*الشهادة", "membership\\s*(?:No\\.?)?"], numPat: "\\d{4,15}", party: ["اسم\\s*المنشأة", "الاسم\\s*التجاري", "اسم\\s*الشركة", "اسم\\s*العضو"] },
  { kind: "gosi_certificate", test: /(?:ال|لل)تأمينات\s*الاجتماعية|GOSI/i, issuer: "المؤسسة العامة للتأمينات الاجتماعية",
    number: ["رقم\\s*الاشتراك", "رقم\\s*المنشأة", "رقم\\s*الشهادة", "رقم\\s*المشترك"], numPat: "\\d{6,15}", party: ["اسم\\s*المنشأة", "اسم\\s*صاحب\\s*العمل", "اسم\\s*الشركة"] },
  { kind: "zakat_certificate", test: /شهادة\s*(?:الزكاة|زكاة)|الزكاة\s*والدخل|zakat/i, issuer: "هيئة الزكاة والضريبة والجمارك",
    number: ["رقم\\s*الشهادة", "الرقم\\s*المميز", "رقم\\s*المكلف"], numPat: "\\d{6,15}", party: ["اسم\\s*المكلف", "اسم\\s*المنشأة", "اسم\\s*الشركة"] },
  /* كل فاتورة تحمل رقما ضريبيا وكلمة «ضريبة»، وشهادة التسجيل الضريبي لا تحمل كلمة «فاتورة» أبدا */
  { kind: "vat_certificate", test: /^(?![\s\S]*(?:فاتورة|invoice))[\s\S]*(?:شهادة\s*(?:تسجيل\s*)?(?:في\s*)?ضريبة|الرقم\s*الضريبي|ضريبة\s*القيمة\s*المضافة|VAT)/i, issuer: "هيئة الزكاة والضريبة والجمارك",
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
    number: ["رقم\\s*الفاتورة", "invoice\\s*(?:No\\.?|#|Number)"], numPat: "[0-9A-Za-z\\-\\/]{3,25}", party: ["العميل", "اسم\\s*العميل", "المشتري", "bill\\s*to"],
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
/* الشهادات المتخصصة أولا: كثير من الأوراق (الضريبية، الزكاة، التأمينات، الغرفة) تحمل «رقم السجل التجاري» كحقل،
   فلا يكون السجل قويا إلا بعنوانه هو (شهادة السجل التجاري) لا بمجرد ذكر رقمه */
const SPECIFIC_PAPER = /ضريبة\s*القيمة|الرقم\s*الضريبي|شهادة\s*(?:تسجيل\s*)?(?:في\s*)?ضريبة|\bVAT\b|شهادة\s*(?:ال|لل)?زكاة|الزكاة\s*والدخل|(?:ال|لل)تأمينات\s*الاجتماعية|GOSI|(?:ال|لل)غرفة\s*التجارية|chamber\s*of\s*commerce|شهادة\s*(?:السعودة|التوطين)|نطاقات/i;
const STRONG_KINDS = [
  { kind: "vat_certificate", when: (t) => !/فاتورة|invoice/i.test(t) && ((/\b3\d{13}3\b/.test(t) && /(?:ضريب|VAT)/i.test(t)) || /شهادة\s*(?:تسجيل\s*)?(?:في\s*)?ضريبة\s*القيمة/.test(t)) },
  { kind: "zakat_certificate", when: (t) => /شهادة\s*(?:ال|لل)?زكاة|الزكاة\s*والدخل/.test(t) },
  { kind: "gosi_certificate", when: (t) => /(?:ال|لل)تأمينات\s*الاجتماعية/.test(t) },
  { kind: "chamber_certificate", when: (t) => /(?:ال|لل)غرفة\s*التجارية/.test(t) },
  { kind: "saudization_certificate", when: (t) => /شهادة\s*(?:السعودة|التوطين)|نطاقات/.test(t) },
  { kind: "power_of_attorney", when: (t) => /(?:رقم\s*)?(?:ال)?وكالة/.test(t) && /كاتب\s*(?:ال)?عدل|ناجز|الموكل/.test(t) },
  { kind: "articles_of_association", when: (t) => /عقد\s*(?:ال)?تأسيس/.test(t) },
  { kind: "commercial_register", when: (t) => !SPECIFIC_PAPER.test(t) && (
      /شهادة\s*(?:ال)?سجل\s*(?:ال)?تجاري|commercial\s*registration\s*certificate/i.test(t) ||
      /(?<!رقم\s)(?<!رقم)السجل\s*التجاري/.test(t) ||
      (/وزارة\s*التجارة/.test(t) && /\b7\d{9}\b/.test(t))) }
];

function strongKind(text) {
  const hit = STRONG_KINDS.find((r) => r.when(text));
  return hit ? hit.kind : null;
}

export function rulesExtract(rawText) {
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
  if (out.kind === "commercial_register" && !out.party) {
    /* السجل الجديد يكتب اسم الشركة بلا تسمية: أول «شركة/مؤسسة …» ليست وصف شكل قانوني */
    /* أوصاف الشكل القانوني ليست اسما، حتى إن جاءت حروفها مشوهة («تاذ» بدل «ذات») */
    const legalForm = /ذات|تاذ|مسؤولي|مسئولي|محدود|محدةدو|مساهمة|الشخص|شخص|مهنية|توصية|تضامن|قابضة|أجنبية|فردية|واحد|اوحد/;
    const re = /(?:^|\s)((?:شركة|مؤسسة)\s+[^\d:،,()\n]{2,60}?)(?=\s+(?:\d|:|الرقم|رقم|تاريخ|نوع|حالة|صفات|\S*(?:شهاد|هادة|سجل)\S*|$))/g;
    let m;
    while ((m = re.exec(text))) {
      const cand = m[1].trim();
      if (!legalForm.test(cand) && cand.split(/\s+/).length <= 7) { out.party = cand; break; }
    }
  }

  /* أوراق المحاكم: رقم الدعوى واسم المحكمة والدائرة تقرأ مباشرة */
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
  /* تسمية التاريخ مشوهة أو غائبة: إن كان في الورقة تاريخ واحد فهو تاريخ إصدارها (السجل الجديد بلا انتهاء) */
  if (!out.issue_date && !out.expiry_date) {
    const all = (westernize(text).match(/\b(?:\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})\b/g) || []);
    const uniq = all.filter((d, i) => all.indexOf(d) === i);
    if (uniq.length === 1) {
      let parts = uniq[0].replace(/[\/.]/g, "-").split("-").map((x) => x.padStart(2, "0"));
      if (parts[0].length !== 4) parts = [parts[2], parts[1], parts[0]];
      out.issue_date = parts.join("-"); out.issue_date_calendar = Number(parts[0]) < 1700 ? "hijri" : "gregorian";
    }
  }
  /* كل بيانات الورقة بمفاتيحها. الحقل الرئيسي وتفصيله يتبادلان: التفصيل المسمى يملأ الرئيسي الغائب
     (والاسم المسمى أصدق من اسم مخمن)، والرئيسي يملأ تفصيلا لم تجده تسميته (تسمية مشوهة أو غائبة). */
  if (out.kind && KIND_FIELDS[out.kind]) {
    const details = extractDetails(out.kind, text);
    for (const spec of KIND_FIELDS[out.kind]) {
      if (!spec.core) continue;
      if (details[spec.key] == null) {
        const coreValue = spec.type === "date" ? normalizeDate(out[spec.core], out[spec.core + "_calendar"]) : out[spec.core];
        if (coreValue != null) details[spec.key] = coreValue;
      } else if (spec.core === "party" || out[spec.core] == null || (spec.core === "number" && !/\d/.test(String(out.number)))) {
        /* رقم مستند بلا رقم واحد فيه كلمة التقطت خطأ؛ التفصيل المتحقق بنمطه أصدق */
        out[spec.core] = details[spec.key];
        if (spec.type === "date") out[spec.core + "_calendar"] = "gregorian";
      }
    }
    out.details = details;
  }
  /* العنوان الوطني المختصر: أربعة أحرف وأربعة أرقام (مثل RRRD2929) */
  const shortAddress = text.match(/(?<![A-Za-z0-9])[A-Z]{4}\d{4}(?![A-Za-z0-9])/);
  if (shortAddress) out.short_address = shortAddress[0];
  return out;
}
export function mergeRules(model, rules) {
  const merged = model && typeof model === "object" ? { ...model } : {};
  for (const key of Object.keys(rules)) {
    const isMissing = merged[key] == null || merged[key] === "" || merged[key] === 0 || (key === "kind" && merged[key] === "other");
    if (isMissing) merged[key] = rules[key];
  }
  /* التفاصيل: ما قرأته القواعد بتسميته ونمطه يغلب، والنموذج يكمل الفراغات فقط */
  const modelDetails = merged.details && typeof merged.details === "object" ? merged.details : {};
  merged.details = Object.assign({}, modelDetails, rules.details || {});
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
  const raw = String(base64 || "");
  const dataUrl = /^data:/.test(raw) ? raw : "data:image/png;base64," + raw;
  const res = await env.AI.run(VISION_MODEL, {
    messages: [{ role: "user", content: [
      { type: "text", text: "This is an official Saudi document that mixes Arabic and English. Transcribe ALL visible text exactly, line by line, keeping each label and its value together on one line (e.g. 'رقم السجل التجاري: 1010123456'). Keep numbers and dates exactly as printed. Output plain text only, no commentary." },
      { type: "image_url", image_url: { url: dataUrl } }
    ] }],
    max_tokens: 1400,
    temperature: 0.1,
  });
  const choice = res && res.choices && res.choices[0];
  const content = (choice && choice.message && choice.message.content) || (res && (res.response || res.result || res.description)) || "";
  return normalizeArabicText(String(content)).trim();
}

export async function handleDocumentAnalyze(request, env) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (!env.AI) return new Response(JSON.stringify({ error: "ai_unavailable" }), { status: 503, headers });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!body) return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400, headers });

  let text = normalizeArabicText(String(body.text || "")).slice(0, MAX_TEXT);
  /* نص PDF عربي مشوه (أشكال عرض أو حروف مفرقة) لا يفهم: تقرأ صورة الصفحة بدله */
  const mangled = text.trim() ? looksMangledArabic(text) : false;
  try {
    if ((!text.trim() || mangled) && body.image) text = (await readImage(env, body.image)).slice(0, MAX_TEXT);
    else if (mangled) return new Response(JSON.stringify({ error: "mangled_text" }), { status: 422, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: "image_read_failed" }), { status: 502, headers });
  }
  if (text.trim().length < 12) return new Response(JSON.stringify({ error: "no_text" }), { status: 422, headers });

  const rules = rulesExtract(text);
  /* القواعد وحدها تحسم فقط حين تكون واثقة (عنوان الورقة صريح + رقم + تاريخ)؛ وإلا يقرأ النموذج والقواعد تدقق وتكمل */
  const fast = isFastPathRequested(request) || (rules.strong && rules.kind && rules.number && (rules.expiry_date || rules.issue_date));
  if (fast && rules.kind) {
    const merged = mergeRules(null, rules);
    merged.summary = merged.title; merged.confidence = 0.9;
    return new Response(JSON.stringify({ fields: clean(merged), text_chars: text.length, rules: Object.keys(rules), fast: true }), { headers });
  }
  let parsed = null;
  try {
    const out = await env.AI.run(TEXT_MODEL, {
      messages: [{ role: "user", content: extractionPrompt(text, rules.kind) }],
      max_tokens: 900,
      temperature: 0.1,
    });
    parsed = parseJson(out && (out.response || out.result));
  } catch (e) { parsed = null; }
  /* النموذج قد يخطئ أو يفشل؛ القواعد الحتمية تكمل أو تصحح، ولا نفشل ما دامت وجدت شيئا */
  const merged = mergeRules(parsed, rules);
  if (!parsed && !rules.kind) return new Response(JSON.stringify({ error: "extract_failed" }), { status: 502, headers });
  return new Response(JSON.stringify({ fields: clean(merged), text_chars: text.length, rules: Object.keys(rules) }), { headers });
}
