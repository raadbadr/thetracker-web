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
function westernize(t) { return String(t || "").replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d] || d); }
function findDate(text, labels) {
  const re = new RegExp("(?:" + labels.join("|") + ")[^0-9]{0,40}(\\d{4}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{1,2}|\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{4})", "i");
  const m = text.match(re);
  if (!m) return null;
  let d = m[1].replace(/[\/.]/g, "-").split("-").map((x) => x.padStart(2, "0"));
  if (d[0].length === 4) return { raw: `${d[0]}-${d[1]}-${d[2]}`, year: Number(d[0]) };
  return { raw: `${d[2]}-${d[1]}-${d[0]}`, year: Number(d[2]) };
}
function findAfter(text, labels, pattern) {
  const re = new RegExp("(?:" + labels.join("|") + ")\\s*[:：\\-]?\\s*(" + pattern + ")", "i");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}
function rulesExtract(rawText) {
  const text = westernize(rawText).replace(/[\u200f\u200e]/g, "");
  const has = (re) => re.test(text);
  const out = {};
  if (has(/عقد\s*تأسيس|عقد\s*التأسيس|عقد\s*شركة|articles\s*of\s*(?:association|incorporation)|memorandum\s*of\s*association/i)) {
    out.kind = "articles_of_association";
    out.party = findAfter(text, ["اسم\\s*الشركة", "تحت\\s*اسم", "باسم", "شركة"], "[^\\n:،,]{3,80}");
    out.number = findAfter(text, ["رقم\\s*العقد", "رقم\\s*التوثيق", "رقم\\s*الوثيقة", "رقم\\s*السجل"], "[0-9]{4,20}");
    out.issuer = has(/وزارة\s*التجارة/) ? "وزارة التجارة" : (has(/كاتب\s*(?:ال)?عدل|العدل/) ? "وزارة العدل" : null);
  } else if (has(/النظام\s*الأساس|النظام\s*الاساس|bylaws/i)) {
    out.kind = "bylaws";
    out.party = findAfter(text, ["اسم\\s*الشركة", "شركة"], "[^\\n:،,]{3,80}");
    out.issuer = "وزارة التجارة";
  } else if (has(/الغرفة\s*التجارية|غرفة\s*(?:الرياض|جدة|الشرقية|مكة|المدينة)|chamber\s*of\s*commerce/i)) {
    out.kind = "chamber_certificate";
    out.number = findAfter(text, ["رقم\\s*العضوية", "رقم\\s*الاشتراك", "رقم\\s*الشهادة", "membership\\s*(?:No\\.?|number)?"], "[0-9]{4,15}");
    out.party = findAfter(text, ["اسم\\s*المنشأة", "الاسم\\s*التجاري", "اسم\\s*الشركة", "اسم\\s*العضو"], "[^\\n:]{3,80}");
    out.issuer = (text.match(/الغرفة\s*التجارية[^\n:،,]{0,30}|غرفة\s*[^\n:،,]{2,25}/) || [])[0] || "الغرفة التجارية";
  } else if (has(/التأمينات\s*الاجتماعية|GOSI/i)) {
    out.kind = "gosi_certificate"; out.issuer = "المؤسسة العامة للتأمينات الاجتماعية";
    out.number = findAfter(text, ["رقم\\s*الاشتراك", "رقم\\s*المنشأة", "رقم\\s*الشهادة", "رقم\\s*المشترك"], "[0-9]{6,15}");
    out.party = findAfter(text, ["اسم\\s*المنشأة", "اسم\\s*صاحب\\s*العمل", "اسم\\s*الشركة"], "[^\\n:]{3,80}");
  } else if (has(/شهادة\s*(?:الزكاة|زكاة|الزكاة\s*والدخل)|zakat/i)) {
    out.kind = "zakat_certificate"; out.issuer = "هيئة الزكاة والضريبة والجمارك";
    out.number = findAfter(text, ["رقم\\s*الشهادة", "الرقم\\s*المميز", "رقم\\s*المكلف"], "[0-9]{6,15}");
    out.party = findAfter(text, ["اسم\\s*المكلف", "اسم\\s*المنشأة", "اسم\\s*الشركة"], "[^\\n:]{3,80}");
  } else if (has(/شهادة\s*(?:السعودة|التوطين)|نطاقات|قوى|saudi[sz]ation|nitaqat/i)) {
    out.kind = "saudization_certificate"; out.issuer = "وزارة الموارد البشرية والتنمية الاجتماعية";
    out.number = findAfter(text, ["رقم\\s*الشهادة", "رقم\\s*المنشأة", "الرقم\\s*الموحد"], "[0-9]{6,15}");
    out.party = findAfter(text, ["اسم\\s*المنشأة", "اسم\\s*الشركة"], "[^\\n:]{3,80}");
  } else if (has(/عقد\s*(?:إيجار|ايجار|الإيجار|الايجار)|إيجار\s*موثق|lease\s*(?:agreement|contract)/i)) {
    out.kind = "lease_contract";
    out.number = findAfter(text, ["رقم\\s*العقد", "رقم\\s*عقد\\s*الإيجار", "رقم\\s*التوثيق", "contract\\s*(?:No\\.?|number)?"], "[0-9A-Za-z\\-]{4,25}");
    out.issuer = has(/إيجار|ايجار/) && has(/منصة|شبكة|موثق/) ? "منصة إيجار" : null;
    const rent = text.match(/(?:قيمة\s*(?:الإيجار|الايجار|العقد)|الأجرة\s*السنوية|إجمالي\s*(?:الإيجار|العقد))[^0-9]{0,30}([0-9][0-9,\.]{2,})/);
    if (rent) out.amount = Number(rent[1].replace(/,/g, "")) || null;
  } else if (has(/السجل\s*التجاري|سجل\s*تجاري|commercial\s*regist/i)) {
    out.kind = "commercial_register";
    out.issuer = "وزارة التجارة";
    out.number = findAfter(text, ["رقم\\s*السجل\\s*التجاري", "رقم\\s*السجل", "السجل\\s*التجاري\\s*رقم", "C\\.?R\\.?\\s*(?:No\\.?|number)?"], "\\d{10}") || (text.match(/\b[1247]\d{9}\b/) || [])[0] || null;
    out.party = findAfter(text, ["اسم\\s*المنشأة", "الاسم\\s*التجاري", "اسم\\s*الشركة", "اسم\\s*التاجر", "الاسم"], "[^\\n:]{3,80}");
  } else if (has(/شهادة\s*(?:تسجيل\s*)?(?:في\s*)?ضريبة|الرقم\s*الضريبي|VAT/i)) {
    out.kind = "vat_certificate"; out.issuer = "هيئة الزكاة والضريبة والجمارك";
    out.number = findAfter(text, ["الرقم\\s*الضريبي", "رقم\\s*التسجيل\\s*الضريبي", "VAT\\s*(?:No\\.?|number)?"], "3\\d{14}") || (text.match(/\b3\d{14}\b/) || [])[0] || null;
    out.party = findAfter(text, ["اسم\\s*المكلف", "اسم\\s*المنشأة", "الاسم\\s*التجاري", "اسم\\s*الشركة"], "[^\\n:]{3,80}");
  } else if (has(/رخصة|ترخيص|licen[cs]e/i)) {
    out.kind = "license";
    out.number = findAfter(text, ["رقم\\s*الرخصة", "رقم\\s*الترخيص", "Licen[cs]e\\s*(?:No\\.?|number)?"], "[A-Za-z0-9\\-\\/]{4,30}");
    out.party = findAfter(text, ["اسم\\s*المنشأة", "الاسم\\s*التجاري", "اسم\\s*الشركة", "اسم\\s*المرخص\\s*له"], "[^\\n:]{3,80}");
  }
  const exp = findDate(text, ["تاريخ\\s*(?:ال)?انتهاء", "ينتهي\\s*(?:في|بتاريخ)", "صالح(?:ة)?\\s*حتى", "تاريخ\\s*نهاية", "الانتهاء", "expir(?:y|es|ation)\\s*(?:date)?", "valid\\s*(?:until|to)"]);
  const iss = findDate(text, ["تاريخ\\s*(?:ال)?إصدار", "تاريخ\\s*(?:ال)?اصدار", "تاريخ\\s*التسجيل", "تاريخ\\s*(?:ال)?بداية", "صدر\\s*(?:في|بتاريخ)", "issue\\s*date", "issued\\s*on", "registration\\s*date"]);
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
      gosi_certificate: "شهادة التأمينات الاجتماعية", zakat_certificate: "شهادة الزكاة", saudization_certificate: "شهادة السعودة", lease_contract: "عقد الإيجار" };
    m.title = (names[rules.kind] || "مستند") + (rules.party ? " — " + rules.party : rules.number ? " " + rules.number : "");
  }
  return m;
}

async function readImage(env, base64) {
  const bin = atob(String(base64 || "").replace(/^data:[^,]+,/, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const res = await env.AI.run(VISION_MODEL, {
    prompt: "This is a scanned Arabic/English official document. Transcribe ALL visible text exactly, line by line, keeping labels and their values together (e.g. 'رقم السجل التجاري: 1010123456', 'تاريخ الانتهاء: 1447-05-10'). Digits must be Western. No commentary.",
    image: Array.from(bytes),
    max_tokens: 2000,
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
  let parsed = null;
  try {
    const out = await env.AI.run(TEXT_MODEL, {
      messages: [{ role: "user", content: extractionPrompt(text) }],
      max_tokens: 700,
      temperature: 0.1,
    });
    parsed = parseJson(out && (out.response || out.result));
  } catch (e) { parsed = null; }
  /* النموذج قد يخطئ أو يفشل؛ القواعد الحتمية تكمل أو تصحح، ولا نفشل ما دامت وجدت شيئا */
  const merged = mergeRules(parsed, rules);
  if (!parsed && !rules.kind) return new Response(JSON.stringify({ error: "extract_failed" }), { status: 502, headers });
  return new Response(JSON.stringify({ fields: clean(merged), text_chars: text.length, rules: Object.keys(rules) }), { headers });
}
