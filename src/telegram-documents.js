/* بوت تيليغرام — الأوراق: ورقة ترسل إلى البوت تقرأ بالقواعد (بلا نموذج)، تعرض على المستخدم بخلاصة إنسانية
   (نوعها، صاحبها، رقمها، تاريخا إصدارها وانتهائها) وزري «حفظ في المستندات» / «لا»، وبالتأكيد تحفظ مستندا كاملا
   في «المستندات» بكل حقولها، مع رابط موقع لملفها يبقى قابلا للفتح من صفحة المستندات (يمر عبر الـ Worker ويجلب
   الملف من تيليغرام عند كل فتح). ما يصلح لتحديث بطاقة الشركة يعرض بعدها بزرين ولا يكتب إلا بموافقة مالك أو مدير.
   لا رقم قياسي داخلي ولا أسماء حقول تصل إلى المستخدم؛ بلا تشكيل، وأرقام غربية، والتواريخ يوم-شهر-سنة. */
import { rpc, sendTelegram, menuKeyboard, bot as botText } from "./notify.js";
import { analyzeTextOffline, KIND_LABELS_AR } from "./documents.js";

const DOCS_URL = "https://appmails.net/app/documents.html";

// ---------- توقيع رابط الملف (HMAC بسر الـ Worker) ----------
export async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/* معرفات ملفات تيليغرام حروف base64url فقط؛ التوقيع أول 32 خانة ست عشرية من HMAC-SHA256(file_id) */
const FILE_ROUTE = /^\/api\/telegram\/file\/([A-Za-z0-9_-]{8,200})\/([a-f0-9]{32})$/;
export function telegramFileRoute(path) {
  const m = String(path || "").match(FILE_ROUTE);
  return m ? { fileId: m[1], sig: m[2] } : null;
}
export async function telegramFileSig(env, fileId) {
  return (await hmacHex(env.WORKER_SECRET, String(fileId))).slice(0, 32);
}
export async function verifyFileSig(env, fileId, sig) {
  if (!env.WORKER_SECRET || !/^[a-f0-9]{32}$/.test(String(sig || ""))) return false;
  const want = await telegramFileSig(env, fileId);
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= want.charCodeAt(i) ^ String(sig).charCodeAt(i);
  return diff === 0;
}
export function safeFileName(name, fallback) {
  const clean = String(name || "").replace(/[\\/\x00-\x1f\x7f"';%]/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);
  return clean || fallback || "file";
}
export async function telegramFileUrl(env, fileId, name) {
  const sig = await telegramFileSig(env, fileId);
  return `https://appmails.net/api/telegram/file/${fileId}/${sig}` + (name ? "?name=" + encodeURIComponent(safeFileName(name)) : "");
}

const MIME = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8" };
export function mimeForName(name, fallback) {
  const ext = String(name || "").toLowerCase().match(/\.([a-z0-9]{1,5})$/);
  return (ext && MIME[ext[1]]) || fallback || "application/octet-stream";
}
const EXT_FOR_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic", "application/pdf": "pdf" };
/* اسم المرفق في المستندات: اسم الملف كما أرسله المستخدم، وللصور (بلا اسم) اسم الورقة بالعربية وامتدادها */
export function attachmentName(kind, name, mime) {
  const given = String(name || "").trim();
  if (given && /\.[A-Za-z0-9]{1,5}$/.test(given) && !/^(photo|file|image|document)\.[a-z0-9]+$/i.test(given)) return safeFileName(given);
  return (KIND_LABELS_AR[kind] || "مستند") + "." + (EXT_FOR_MIME[String(mime || "").toLowerCase()] || "jpg");
}

/** GET /api/telegram/file/<file_id>/<sig>?name= — يتحقق من التوقيع ثم يجلب الملف من تيليغرام ويمرره كما هو */
export async function handleTelegramFile(env, fileId, sig, url) {
  const notFound = () => new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!env.TELEGRAM_BOT_TOKEN || !(await verifyFileSig(env, fileId, sig))) return notFound();
  let info = null;
  try { info = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`).then((r) => r.json()); } catch { info = null; }
  const path = info && info.ok && info.result && info.result.file_path;
  if (!path) return notFound();
  let res = null;
  try { res = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`); } catch { res = null; }
  if (!res || !res.ok || !res.body) return notFound();
  const name = safeFileName(url && url.searchParams ? url.searchParams.get("name") : "", String(path).split("/").pop());
  const type = mimeForName(name, mimeForName(path, res.headers.get("content-type")));
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");
  const headers = new Headers({
    "Content-Type": type,
    "Content-Disposition": `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  const len = res.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  return new Response(res.body, { status: 200, headers });
}

// ---------- النصوص (أربع لغات، بلا تشكيل، أرقام غربية) ----------
const KIND_LABELS = {
  ar: KIND_LABELS_AR,
  en: { commercial_register: "Commercial register", vat_certificate: "VAT certificate", license: "Licence", articles_of_association: "Articles of association", bylaws: "Bylaws",
        chamber_certificate: "Chamber of commerce certificate", gosi_certificate: "GOSI certificate", zakat_certificate: "Zakat certificate", saudization_certificate: "Saudization certificate",
        lease_contract: "Lease contract", power_of_attorney: "Power of attorney", court_ruling: "Court ruling", case_filing: "Statement of claim", hearing_notice: "Hearing notice",
        violation: "Violation", invoice: "Invoice", id_document: "ID document", passport: "Passport", driving_license: "Driving licence", vehicle_registration: "Vehicle registration",
        insurance_policy: "Insurance policy", employment_contract: "Employment contract", contract: "Contract" },
  fr: { commercial_register: "Registre de commerce", vat_certificate: "Attestation TVA", license: "Licence", articles_of_association: "Statuts constitutifs", bylaws: "Règlement intérieur",
        chamber_certificate: "Attestation chambre de commerce", gosi_certificate: "Attestation GOSI", zakat_certificate: "Attestation Zakat", saudization_certificate: "Attestation de saoudisation",
        lease_contract: "Contrat de bail", power_of_attorney: "Procuration", court_ruling: "Jugement", case_filing: "Requête", hearing_notice: "Avis d'audience",
        violation: "Infraction", invoice: "Facture", id_document: "Pièce d'identité", passport: "Passeport", driving_license: "Permis de conduire", vehicle_registration: "Carte grise",
        insurance_policy: "Police d'assurance", employment_contract: "Contrat de travail", contract: "Contrat" },
  ur: { commercial_register: "کمرشل رجسٹر", vat_certificate: "ٹیکس سرٹیفکیٹ", license: "لائسنس", articles_of_association: "کمپنی کا معاہدہ تاسیس", bylaws: "بنیادی قواعد",
        chamber_certificate: "چیمبر آف کامرس سرٹیفکیٹ", gosi_certificate: "GOSI سرٹیفکیٹ", zakat_certificate: "زکوۃ سرٹیفکیٹ", saudization_certificate: "سعودائزیشن سرٹیفکیٹ",
        lease_contract: "کرایہ نامہ", power_of_attorney: "مختار نامہ", court_ruling: "عدالتی فیصلہ", case_filing: "دعوی", hearing_notice: "سماعت کا نوٹس",
        violation: "خلاف ورزی", invoice: "انوائس", id_document: "شناختی دستاویز", passport: "پاسپورٹ", driving_license: "ڈرائیونگ لائسنس", vehicle_registration: "گاڑی کی رجسٹریشن",
        insurance_policy: "انشورنس پالیسی", employment_contract: "ملازمت کا معاہدہ", contract: "معاہدہ" },
};
const T = {
  ar: { name: "باسم", number: "الرقم", amount: "المبلغ", issued: "الإصدار", expires: "الانتهاء", assumed: "(مفترض: سنة من الإصدار)", ask: "أحفظها في المستندات؟",
        yes: "💾 حفظ في المستندات", no: "لا", saved: "حفظت في المستندات", updated: "حدثت في المستندات", num: "رقم", exp: "ينتهي", open: "فتح المستندات",
        skipped: "لم تحفظ.", noOrg: "لا شركة مرتبطة بحسابك؛ أنشئ الشركة من الموقع أولا.", sep: "، ",
        profAsk: "في الورقة بيانات تختلف عن بطاقة الشركة:", profCurrent: "المسجل", profNone: "غير مسجل", profQ: "أحدث بطاقة الشركة بها؟",
        profYes: "✅ تحديث بطاقة الشركة", profNo: "لا", profDone: "حدثت بطاقة الشركة:", profKept: "بقيت بطاقة الشركة كما هي.", profForbidden: "تحديث بطاقة الشركة للمالك أو المدير فقط.",
        fields: { vat_number: "الرقم الضريبي", cr_number: "رقم السجل التجاري", unified_number: "الرقم الوطني الموحد", legal_name: "الاسم النظامي", legal_name_en: "الاسم النظامي بالإنجليزية" } },
  en: { name: "Name", number: "Number", amount: "Amount", issued: "Issued", expires: "Expires", assumed: "(assumed: one year from issue)", ask: "Save it to Documents?",
        yes: "💾 Save to Documents", no: "No", saved: "Saved to Documents", updated: "Updated in Documents", num: "no.", exp: "expires", open: "Open Documents",
        skipped: "Not saved.", noOrg: "No company is linked to your account; create it on the website first.", sep: ", ",
        profAsk: "The paper carries details that differ from the company record:", profCurrent: "on record", profNone: "none", profQ: "Update the company record with them?",
        profYes: "✅ Update company record", profNo: "No", profDone: "Company record updated:", profKept: "The company record was left unchanged.", profForbidden: "Only the owner or an admin can update the company record.",
        fields: { vat_number: "VAT number", cr_number: "CR number", unified_number: "Unified national number", legal_name: "Legal name", legal_name_en: "Legal name (English)" } },
  fr: { name: "Nom", number: "Numéro", amount: "Montant", issued: "Délivré le", expires: "Expire le", assumed: "(supposé : un an après la délivrance)", ask: "L'enregistrer dans Documents ?",
        yes: "💾 Enregistrer dans Documents", no: "Non", saved: "Enregistré dans Documents", updated: "Mis à jour dans Documents", num: "n°", exp: "expire le", open: "Ouvrir Documents",
        skipped: "Non enregistré.", noOrg: "Aucune société liée à votre compte ; créez-la d'abord sur le site.", sep: ", ",
        profAsk: "Le document porte des données différentes de la fiche société :", profCurrent: "enregistré", profNone: "aucun", profQ: "Mettre à jour la fiche société ?",
        profYes: "✅ Mettre à jour la fiche", profNo: "Non", profDone: "Fiche société mise à jour :", profKept: "La fiche société reste inchangée.", profForbidden: "Seul le propriétaire ou un administrateur peut modifier la fiche société.",
        fields: { vat_number: "Numéro de TVA", cr_number: "Numéro de registre de commerce", unified_number: "Numéro national unifié", legal_name: "Nom légal", legal_name_en: "Nom légal (anglais)" } },
  ur: { name: "نام", number: "نمبر", amount: "رقم", issued: "اجرا", expires: "میعاد", assumed: "(فرضی: اجرا سے ایک سال)", ask: "دستاویزات میں محفوظ کروں؟",
        yes: "💾 دستاویزات میں محفوظ کریں", no: "نہیں", saved: "دستاویزات میں محفوظ", updated: "دستاویزات میں اپ ڈیٹ", num: "نمبر", exp: "میعاد", open: "دستاویزات کھولیں",
        skipped: "محفوظ نہیں ہوا۔", noOrg: "آپ کے اکاؤنٹ سے کوئی کمپنی منسلک نہیں؛ پہلے ویب سائٹ پر کمپنی بنائیں۔", sep: "، ",
        profAsk: "دستاویز میں کمپنی ریکارڈ سے مختلف معلومات ہیں:", profCurrent: "ریکارڈ میں", profNone: "درج نہیں", profQ: "کمپنی ریکارڈ اپ ڈیٹ کروں؟",
        profYes: "✅ کمپنی ریکارڈ اپ ڈیٹ کریں", profNo: "نہیں", profDone: "کمپنی ریکارڈ اپ ڈیٹ ہو گیا:", profKept: "کمپنی ریکارڈ ویسا ہی رہا۔", profForbidden: "کمپنی ریکارڈ صرف مالک یا ایڈمن بدل سکتا ہے۔",
        fields: { vat_number: "ٹیکس نمبر", cr_number: "کمرشل رجسٹر نمبر", unified_number: "یونیفائیڈ نیشنل نمبر", legal_name: "قانونی نام", legal_name_en: "قانونی نام (انگریزی)" } },
};
const texts = (lang) => T[lang] || T.ar;
export function kindLabel(lang, kind) {
  const table = KIND_LABELS[lang] || KIND_LABELS.ar;
  return table[kind] || KIND_LABELS.ar[kind] || (lang === "ar" || lang === "ur" ? "مستند" : "Document");
}
/* يوم-شهر-سنة من YYYY-MM-DD؛ أي شكل آخر يعاد كما هو */
export function dmy(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(iso || "");
}

/* خلاصة الورقة قبل الحفظ: نوعها، صاحبها، رقمها هي (لا الرقم القياسي)، تاريخاها، ثم السؤال */
export function docConfirmText(lang, f) {
  const t = texts(lang);
  const lines = ["📄 " + kindLabel(lang, f.kind)];
  if (f.party) lines.push(t.name + ": " + f.party);
  if (f.number) lines.push(t.number + ": " + f.number);
  if (f.amount) lines.push(t.amount + ": " + f.amount);
  if (f.issue_date) lines.push(t.issued + ": " + dmy(f.issue_date));
  if (f.expiry_date) lines.push(t.expires + ": " + dmy(f.expiry_date) + (f.expiry_assumed ? " " + t.assumed : ""));
  lines.push("", t.ask);
  return lines.join("\n");
}
export function docButtons(lang) {
  const t = texts(lang);
  return { reply_markup: { inline_keyboard: [[{ text: t.yes, callback_data: "doc:y" }, { text: t.no, callback_data: "doc:n" }]] } };
}
/* بعد الحفظ: «حفظت في المستندات: السجل التجاري — رقم 7055060102 — ينتهي 24-08-2027» */
export function docSavedText(lang, r) {
  const t = texts(lang);
  const parts = [(r.status === "updated" ? t.updated : t.saved) + ": " + kindLabel(lang, r.kind)];
  if (r.number) parts.push(t.num + " " + r.number);
  if (r.expiry_date) parts.push(t.exp + " " + dmy(r.expiry_date));
  return parts.join(" — ");
}
export function profileOfferText(lang, updates, current) {
  const t = texts(lang);
  const lines = [t.profAsk];
  for (const k of Object.keys(updates || {})) {
    const have = current && current[k] ? String(current[k]) : t.profNone;
    lines.push("• " + (t.fields[k] || k) + ": " + updates[k] + " (" + t.profCurrent + ": " + have + ")");
  }
  lines.push(t.profQ);
  return lines.join("\n");
}

async function logReply(env, chatId, userId, text) {
  if (!env.WORKER_SECRET || !text) return;
  try {
    await rpc(env, "log_telegram_message", { p_secret: env.WORKER_SECRET, p_chat_id: String(chatId), p_username: "bot", p_first_name: "TheTracker",
      p_body: String(text).slice(0, 4000), p_user_id: userId || null, p_action: "reply" });
  } catch (e) { console.log("reply log failed", String(e && e.message || e).slice(0, 200)); }
}

/** الورقة وصلت ونصها مقروء: إن عرفتها القواعد عرضت خلاصتها بزري حفظ/لا وحفظت مسودتها؛ وإلا يعود false ليجيب المساعد كالمعتاد */
export async function offerDocument(env, ctx) {
  if (!env.WORKER_SECRET || !ctx || !ctx.file || !ctx.file.file_id) return false;
  let fields = null;
  try { fields = analyzeTextOffline(ctx.text); } catch { fields = null; }
  if (!fields || !fields.kind || fields.kind === "other") return false;
  const lang = ctx.lang || "ar";
  const file = { file_id: ctx.file.file_id, name: attachmentName(fields.kind, ctx.isPhoto ? "" : ctx.file.name, ctx.file.mime), mime: ctx.file.mime || null, size_bytes: Number(ctx.file.size_bytes) || 0 };
  try { await rpc(env, "telegram_draft_put", { p_secret: env.WORKER_SECRET, p_chat_id: String(ctx.chatId), p_user_id: ctx.userId, p_payload: { type: "doc", doc: fields, file } }); }
  catch (e) { console.log("doc draft failed", String(e && e.message || e).slice(0, 200)); return false; }
  const text = docConfirmText(lang, fields);
  try { await sendTelegram(env, ctx.chatId, text, docButtons(lang)); }
  catch (e) { console.log("doc offer failed", String(e && e.message || e).slice(0, 200)); return false; }
  await logReply(env, ctx.chatId, ctx.userId, text);
  return true;
}

/** أزرار doc:y / doc:n / prof:y / prof:n — يعيد true إن كان الزر من هذا التدفق */
export async function handleDocCallback(env, ctx) {
  const data = String(ctx.data || "");
  if (!/^(doc|prof):[yn]$/.test(data)) return false;
  const lang = ctx.lang || "ar"; const t = texts(lang); const b = botText(lang);
  const chat = String(ctx.chatId);
  const say = async (text, extra) => { try { await sendTelegram(env, ctx.chatId, text, extra || menuKeyboard(lang)); } catch {} await logReply(env, ctx.chatId, ctx.userId, text); };
  const take = async (type) => {
    let d = null;
    try { d = await rpc(env, "telegram_draft_take", { p_secret: env.WORKER_SECRET, p_chat_id: chat }); } catch { d = null; }
    return d && d.payload && d.payload.type === type && String(d.user_id) === String(ctx.userId) ? d.payload : null;
  };
  const openBtn = { text: t.open, url: DOCS_URL };
  if (data === "doc:n") { await take("doc"); await say(t.skipped); return true; }
  if (data === "prof:n") { await take("prof"); await say(t.profKept); return true; }
  if (data === "doc:y") {
    const d = await take("doc");
    if (!d || !d.doc || !d.file) { await say(b.importExpired); return true; }
    let r = null;
    try {
      const external_url = await telegramFileUrl(env, d.file.file_id, d.file.name);
      r = await rpc(env, "telegram_save_document", { p_secret: env.WORKER_SECRET, p_user_id: ctx.userId, p_doc: d.doc,
        p_file: { name: d.file.name, mime: d.file.mime, size_bytes: d.file.size_bytes, external_url } });
    } catch (e) {
      const msg = String(e && e.message || e); console.log("doc save failed", msg.slice(0, 200));
      await say(/PLAN_LIMIT/.test(msg) ? b.importLimit : b.importFailed); return true;
    }
    if (!r || r.status === "no_org") { await say(t.noOrg); return true; }
    if (r.status !== "created" && r.status !== "updated") { await say(b.importFailed); return true; }
    const updates = r.profile_updates && typeof r.profile_updates === "object" ? r.profile_updates : {};
    const mayUpdate = Object.keys(updates).length > 0 && (r.role === "owner" || r.role === "admin");
    if (mayUpdate) {
      let stored = true;
      try { await rpc(env, "telegram_draft_put", { p_secret: env.WORKER_SECRET, p_chat_id: chat, p_user_id: ctx.userId, p_payload: { type: "prof", updates } }); } catch { stored = false; }
      if (stored) {
        await say(docSavedText(lang, r) + "\n\n" + profileOfferText(lang, updates, r.profile_current),
          { reply_markup: { inline_keyboard: [[{ text: t.profYes, callback_data: "prof:y" }, { text: t.profNo, callback_data: "prof:n" }], [openBtn]] } });
        return true;
      }
    }
    await say(docSavedText(lang, r), { reply_markup: { inline_keyboard: [[openBtn]] } });
    return true;
  }
  if (data === "prof:y") {
    const d = await take("prof");
    if (!d || !d.updates) { await say(b.importExpired); return true; }
    let r = null;
    try { r = await rpc(env, "telegram_apply_profile", { p_secret: env.WORKER_SECRET, p_user_id: ctx.userId, p_updates: d.updates }); }
    catch (e) { console.log("profile apply failed", String(e && e.message || e).slice(0, 200)); await say(b.importFailed); return true; }
    if (r && r.status === "ok") {
      const keys = Array.isArray(r.applied) ? r.applied : Object.keys(d.updates);
      await say(t.profDone + " " + keys.map((k) => t.fields[k] || k).join(t.sep)); return true;
    }
    if (r && r.status === "forbidden") { await say(t.profForbidden); return true; }
    await say(b.importFailed); return true;
  }
  return false;
}
