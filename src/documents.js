/**
 * تحليل المستندات — /api/documents/analyze
 * يستقبل نص مستند (مستخرج من PDF في المتصفح) أو صورة (base64)، ويعيد حقولاً
 * منظمة: نوع المستند، عنوانه، رقمه، الجهة، تاريخ الإصدار، تاريخ الانتهاء، المبلغ،
 * رقم الدعوى، الشركة. الصور تُقرأ بنموذج رؤية من Workers AI ثم يُستخرج منها.
 * لا يُخزَّن شيء هنا؛ الحفظ يتم من المتصفح عبر سوبابيس بصلاحيات المستخدم.
 */

const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const MAX_TEXT = 12000;

const DOC_KINDS = [
  "commercial_register",   // السجل التجاري
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
  "issue_date": التاريخ كما هو مكتوب في المستند بصيغة "YYYY-MM-DD" بدون تحويل (إن كان هجرياً اكتبه هجرياً مثل "1446-03-12"),
  "issue_date_calendar": "hijri" أو "gregorian",
  "expiry_date": تاريخ الانتهاء أو الاستحقاق أو الجلسة القادمة كما هو مكتوب بصيغة "YYYY-MM-DD" بدون تحويل,
  "expiry_date_calendar": "hijri" أو "gregorian",
  "amount": رقم بالريال إن وُجد مبلغ,
  "case_number": رقم الدعوى أو القضية إن وُجد,
  "court": المحكمة إن وُجدت,
  "summary": جملة واحدة تصف المستند,
  "confidence": رقم من 0 إلى 1
}

قواعد: لا تحوّل بين التقويمين أبداً، فقط انسخ التاريخ كما ورد وحدد تقويمه (السنوات 13xx و14xx هجرية، و19xx و20xx ميلادية). الأرقام غربية. لا تخترع قيماً غير موجودة في النص.

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

/* تحويل هجري (أم القرى) → ميلادي حسابياً: نقدّر اليوم ثم نبحث حوله عن اليوم الذي
   يُنتج التاريخ الهجري نفسه في Intl. لا نثق بتحويل النموذج اللغوي. */
const HIJRI_FMT = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: "numeric", year: "numeric" });
function hijriParts(d) {
  const out = {};
  for (const p of HIJRI_FMT.formatToParts(d)) if (p.type !== "literal") out[p.type] = parseInt(p.value, 10);
  return out;
}
function hijriToGregorian(y, m, d) {
  // تقدير: 1 محرم 1 هـ ≈ 16 يوليو 622 م، والسنة الهجرية 354.367 يوماً
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

async function readImage(env, base64) {
  const bin = atob(String(base64 || "").replace(/^data:[^,]+,/, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const res = await env.AI.run(VISION_MODEL, {
    prompt: "اكتب كل النص الظاهر في هذه الوثيقة كما هو، سطراً سطراً، بلا شرح.",
    image: Array.from(bytes),
    max_tokens: 1500,
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
  if (!text.trim()) return new Response(JSON.stringify({ error: "no_text" }), { status: 422, headers });

  try {
    const out = await env.AI.run(TEXT_MODEL, {
      messages: [{ role: "user", content: extractionPrompt(text) }],
      max_tokens: 700,
      temperature: 0.1,
    });
    const parsed = parseJson(out && (out.response || out.result));
    if (!parsed) return new Response(JSON.stringify({ error: "extract_failed" }), { status: 502, headers });
    return new Response(JSON.stringify({ fields: clean(parsed), text_chars: text.length }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: "extract_failed" }), { status: 502, headers });
  }
}
