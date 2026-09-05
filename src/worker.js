/**
 * TheTracker API Worker — proxies Supabase calls server-side.
 * Keys are read from environment variables (Secrets in Cloudflare Dashboard).
 * Static assets are served by the [assets] binding automatically.
 */

import { handleAssistantRequest, askAssistant } from "./assistant.js";
import { handleTranslate } from "./translate.js";
import { serveBundle } from "./bundles.js";
import { handleMcp } from "./mcp.js";
import { handleV1, mcpAuthenticate, importRowsWithKey } from "./api-v1.js";
import { agentReply, quickAnswer, VERBS } from "./telegram-agent.js";
import { handleCalendar } from "./calendar.js";
import { handleDocumentAnalyze } from "./documents.js";
import { runNotificationCron, linkChannelByCode, notifyTarget, sendTelegram, sendWhatsapp, sendSms, sendEmail, rpc, t as channelText,
         bot as botText, menuKeyboard, menuAction, urlButton, formatItems, telegramItems, linkChannelDirect, linkChannelByPhone, contactKeyboard,
         sendChatAction, fetchTelegramFile, bytesToBase64, TELEGRAM_FILE_MAX, answerCallback, clearInlineButtons, confirmButtons, actionButtons } from "./notify.js";
import { ALLOWED_EXT, fileExt, parseWorkbook, draftPayload, commitImport } from "./telegram-import.js";
import { extractIntent, describeAction, formatSearch, executeAction, runTelegramDigests } from "./telegram-actions.js";
import { hmacHex, telegramFileRoute, handleTelegramFile, offerDocument, handleDocCallback } from "./telegram-documents.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function supaHeaders(env) {
  return {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
  };
}

// Cloudflare Workers cache fetch() responses by default at the edge.
// Pass this to every Supabase call so the worker always asks Supabase
// directly and never serves a stale cached count.
const NO_CACHE = { cacheTtl: 0, cacheEverything: false };

// --- Route handlers ---

/** إعدادات العميل العامة — مفتاح anon عام بطبيعته (RLS هي الحماية)، لكنه لا يكتب في الملفات. */
/* قالب الاستيراد: تنزيل حقيقي عبر رابط عادي (Content-Disposition)، لا Blob ولا
   نقرة مبرمجة — تلك هشة في Safari. رؤوس الأعمدة بلغة الصفحة، عبر ?lang=. */
const IMPORT_TEMPLATE_HEADERS = {
  ar: ["العنوان", "تاريخ الاستحقاق", "التصنيف", "بريد المسؤول", "مبلغ المخالفة", "الشركة (العميل)", "رقم الدعوى", "رقم المخالفة", "الموقع", "الحالة"],
  en: ["Title", "Due date", "Category", "Assignee email", "Fine amount", "Client company", "Case number", "Violation number", "Location", "Status"],
  fr: ["Titre", "Date d'échéance", "Catégorie", "E-mail du responsable", "Montant de l'amende", "Entreprise cliente", "Numéro de dossier", "Numéro d'infraction", "Lieu", "Statut"],
  ur: ["عنوان", "مقررہ تاریخ", "زمرہ", "ذمہ دار کا ای میل", "جرمانے کی رقم", "کلائنٹ کمپنی", "مقدمہ نمبر", "خلاف ورزی نمبر", "مقام", "حالت"],
};
const IMPORT_TEMPLATE_SAMPLE = { ar: "مثال: جلسة محكمة", en: "Example: court hearing", fr: "Exemple : audience", ur: "مثال: عدالتی سماعت" };

function handleImportTemplate(url) {
  const lang = IMPORT_TEMPLATE_HEADERS[url.searchParams.get("lang")] ? url.searchParams.get("lang") : "ar";
  const headers = IMPORT_TEMPLATE_HEADERS[lang];
  const due = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const sample = [IMPORT_TEMPLATE_SAMPLE[lang], due, "", "", "0", "", "", "", "", "open"];
  const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const csv = "﻿" + headers.map(q).join(",") + "\r\n" + sample.map(q).join(",") + "\r\n";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="thetracker-template.csv"',
      "Cache-Control": "no-store",
    },
  });
}

function handleConfig(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({ error: "not configured" }, 503);
  return json({
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    // معرف عميل جوجل معلومة عامة (يظهر في المتصفح) ويلزم زر الدخول بجوجل
    googleClientId: env.GOOGLE_CLIENT_ID || null,
    // مفتاح Google Picker (عام ومقيد بالنطاق) لربط ملفات جوجل درايف بالعناصر
    googleApiKey: env.GOOGLE_API_KEY || null,
    // التحويل المباشر إلى جوجل يظهر اسم نطاقنا، لكنه يحتاج تسجيل عنوان العودة
    // /login في مشروع جوجل. حتى يسجل، يبقى مسار سوبابيس القياسي هو العامل.
    googleDirect: String(env.GOOGLE_DIRECT_LOGIN || "") === "on",
    // معلومات عامة لربط القنوات (لا أسرار)
    telegramBot: env.TELEGRAM_BOT_USERNAME || null,
    whatsappNumber: env.WHATSAPP_PUBLIC_NUMBER || null,
    smsEnabled: !!(env.SMS_PROVIDER),
  });
}

/** أرقام المنصة — دالة SQL مجمعة (SECURITY DEFINER) تعيد أعدادا فقط، بلا بيانات شركات. */
async function handleStats(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({});
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/platform_stats`, {
    method: "POST",
    headers: { ...supaHeaders(env), Accept: "application/json", "Content-Type": "application/json" },
    body: "{}",
    cf: NO_CACHE,
  });
  if (!res.ok) return json({});
  const data = await res.json();
  return json(data && typeof data === "object" ? data : {});
}

async function handleContact(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid body" }, 400); }
  const { subject, name, email, message } = body || {};
  if (!name || !email || !message) return json({ error: "missing fields" }, 400);
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({ error: "not configured" }, 503);

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/contact_messages`, {
    method: "POST",
    headers: { ...supaHeaders(env), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ subject, name, email, message }),
  });
  return json({ ok: res.ok }, res.status);
}

// --- تحقق جلسة المستخدم (JWT سوبابيس) لمسارات تخص حسابا بعينه ---
async function authedUser(request, env) {
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ") || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth },
    cf: NO_CACHE,
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user && user.id ? user : null;
}

/* ============================================================
 * /api/v1 — واجهة عامة بمفتاح: Authorization: Bearer tt_live_…
 * POST /api/v1/import  ← JSON (مصفوفة أو {rows,tracker}) أو CSV/Excel كملف
 * GET  /api/v1/items?tracker=&format=json|csv
 * GET  /api/v1/ping
 * ============================================================ */
async function handleNotifyTest(request, env) {
  const user = await authedUser(request, env);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (!env.WORKER_SECRET) return json({ error: "not configured" }, 503);
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const channel = String((body && body.channel) || "email");
  let target;
  try { target = await notifyTarget(env, user.id, channel); } catch { target = null; }
  const lang = (target && target.lang) || "ar";
  const userTimeZone = (target && target.tz) || "Asia/Riyadh";
  try {
    if (channel === "email") {
      const to = (target && target.email) || user.email;
      if (!to) return json({ error: "no_email" }, 400);
      await sendEmail(env, { to, lang, title: channelText(lang).test, due_at: new Date().toISOString(), tz: userTimeZone });
    } else {
      const ext = target && target.external_id;
      if (!ext) return json({ error: "channel_not_linked" }, 400);
      const text = channelText(lang).test;
      if (channel === "telegram") await sendTelegram(env, ext, text);
      else if (channel === "whatsapp") await sendWhatsapp(env, ext, text);
      else if (channel === "sms") await sendSms(env, ext, text);
      else return json({ error: "unknown_channel" }, 400);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: "send_failed", detail: String((e && e.message) || e).slice(0, 200) }, 502);
  }
}

/** لغة الرد على من لم يربط بعد: لغة تطبيق تلغرام عنده إن كانت من لغاتنا */
function telegramLang(code) {
  const c = String(code || "").slice(0, 2).toLowerCase();
  return ["ar", "en", "fr", "ur"].includes(c) ? c : "ar";
}

/** اسم المستخدم بلغة المحادثة: الإنجليزي حين تكون اللغة en/fr وهو موجود، وإلا العربي — نفس منطق userDisplayName في common.js */
function targetDisplayName(target, lang, fallbackName) {
  const preferEnglish = lang === "en" || lang === "fr";
  const fullName = target && target.full_name;
  const fullNameEn = target && target.full_name_en;
  if (preferEnglish && fullNameEn) return fullNameEn;
  return fullName || fullNameEn || fallbackName || "";
}

// --- رمز ربط موقع (HMAC بسر الـ Worker، الدالة hmacHex في telegram-documents.js): زر داخل البوت يفتح الإعدادات فتربط الجلسة المحادثة بلا أي كتابة ---
async function makeLinkToken(env, chatId) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // صالح يوما
  const body = `${chatId}.${exp}`;
  return `${body}.${await hmacHex(env.WORKER_SECRET, body)}`;
}
async function readLinkToken(env, token) {
  const m = String(token || "").match(/^(-?\d{1,20})\.(\d{1,12})\.([a-f0-9]{64})$/);
  if (!m) return null;
  if (Number(m[2]) < Math.floor(Date.now() / 1000)) return null;
  const expect = await hmacHex(env.WORKER_SECRET, `${m[1]}.${m[2]}`);
  return expect === m[3] ? m[1] : null;
}

/** الترحيب بعد الربط: باسم المستخدم وشركته وبلغة ملفه، مع لوحة الأزرار */
/* تنبيهات الإدارة على تيليغرام: ربط جديد، أو شخص غير مرتبط يكتب للبوت (أمر المهندس رعد: «أعرف من تواصل معه») */
const ADMIN_TEXT = {
  ar: { linked: (n, o, u) => "ربط جديد على البوت: " + n + (o ? " — " + o : "") + (u ? " (@" + u + ")" : ""), stranger: (n, u, t) => "شخص غير مرتبط كتب للبوت: " + (n || "-") + (u ? " (@" + u + ")" : "") + "\n«" + t + "»" },
  en: { linked: (n, o, u) => "New bot link: " + n + (o ? " — " + o : "") + (u ? " (@" + u + ")" : ""), stranger: (n, u, t) => "Unlinked person wrote to the bot: " + (n || "-") + (u ? " (@" + u + ")" : "") + "\n«" + t + "»" },
  fr: { linked: (n, o, u) => "Nouveau lien au bot : " + n + (o ? " — " + o : "") + (u ? " (@" + u + ")" : ""), stranger: (n, u, t) => "Personne non liee a ecrit au bot : " + (n || "-") + (u ? " (@" + u + ")" : "") + "\n«" + t + "»" },
  ur: { linked: (n, o, u) => "بوٹ پر نیا لنک: " + n + (o ? " — " + o : "") + (u ? " (@" + u + ")" : ""), stranger: (n, u, t) => "غیر منسلک شخص نے بوٹ کو لکھا: " + (n || "-") + (u ? " (@" + u + ")" : "") + "\n«" + t + "»" },
};
let adminChatsCache = { at: 0, rows: [] };
const strangerAlertAt = new Map();
async function notifyAdmins(env, kind, info) {
  if (!env.WORKER_SECRET) return;
  try {
    if (Date.now() - adminChatsCache.at > 60_000) { adminChatsCache = { at: Date.now(), rows: (await rpc(env, "platform_admin_chats", { p_secret: env.WORKER_SECRET })) || [] }; }
    for (const a of adminChatsCache.rows) {
      if (info.actorUserId && a.user_id === info.actorUserId) continue;
      if (String(a.chat_id) === String(info.chatId)) continue;
      if (kind === "stranger") { const k = a.chat_id + ":" + info.chatId; const last = strangerAlertAt.get(k) || 0; if (Date.now() - last < 600_000) continue; strangerAlertAt.set(k, Date.now()); }
      const t = ADMIN_TEXT[a.lang] || ADMIN_TEXT.ar;
      const text = kind === "linked" ? t.linked(info.name || "-", info.org || "", info.username || "") : t.stranger(info.name || "", info.username || "", String(info.text || "").slice(0, 200));
      try { await sendTelegram(env, a.chat_id, text); } catch {}
    }
  } catch (e) { console.log("admin alert failed", String(e && e.message || e).slice(0, 120)); }
}

async function greetLinked(env, chatId, userId, fallbackLang, fallbackName) {
  let target = null;
  try { target = await notifyTarget(env, userId, "telegram"); } catch {}
  const lang = (target && target.lang) || fallbackLang || "ar";
  const name = targetDisplayName(target, lang, fallbackName);
  try { await sendTelegram(env, chatId, channelText(lang).linked(name, target && target.org_name), menuKeyboard(lang)); } catch {}
  return lang;
}

/** رسالة "اربط حسابك" لمن لم يربط: زر يفتح الموقع (ربط تلقائي) */
async function askToLink(env, chatId, lang) {
  const b = botText(lang);
  let extra = {};
  if (env.WORKER_SECRET) {
    const token = await makeLinkToken(env, chatId);
    extra = urlButton(b.linkBtn, `https://appmails.net/app/settings?tglink=${encodeURIComponent(token)}`);
  }
  try { await sendTelegram(env, chatId, b.linkIntro, extra); } catch {}
  // الطريق الثاني: مشاركة رقم الجوال المسجل في الملف الشخصي (زر واحد)
  try { await sendTelegram(env, chatId, b.phoneHint, contactKeyboard(lang)); } catch {}
}

/** تنفيذ زر من القائمة لمستخدم مربوط */
async function runMenu(env, chatId, userId, action) {
  let target = null;
  try { target = await notifyTarget(env, userId, "telegram"); } catch {}
  const lang = (target && target.lang) || "ar";
  const userTimeZone = (target && target.tz) || "Asia/Riyadh";
  const b = botText(lang);
  if (action === "upcoming" || action === "overdue") {
    let rows = [];
    try { rows = await telegramItems(env, userId, action, 8); } catch {}
    const text = formatItems(lang, rows, action === "overdue" ? b.overdueTitle : b.upcomingTitle, action === "overdue" ? b.noOverdue : b.noUpcoming, userTimeZone);
    try { await sendTelegram(env, chatId, text, menuKeyboard(lang)); } catch {}
    /* رد الزر يُسجل مثل بقية الردود كي يرى مدير المنصة المحادثة كاملة */
    await logBotReply(env, chatId, userId, text);
  } else if (action === "dashboard") {
    try { await sendTelegram(env, chatId, b.openDash, urlButton(b.openDash, "https://appmails.net/app/dashboard.html")); } catch {}
  } else if (action === "company") {
    await companyMenu(env, chatId, userId, lang);
  } else {
    try { await sendTelegram(env, chatId, b.help, menuKeyboard(lang)); } catch {}
  }
}

/** المساعد الذكي داخل تلغرام: يجيب من بيانات المستخدم وحدها (قراءة فقط) بلغة ملفه */
const TG_LANG_NAMES = { ar: "العربية الفصحى", en: "English", fr: "le français", ur: "اردو" };
const tgAiBuckets = new Map();
function tgAiRateLimited(chatId) {
  const now = Date.now(); let b = tgAiBuckets.get(chatId);
  if (!b || now - b.start >= 60_000) { b = { start: now, count: 0 }; tgAiBuckets.set(chatId, b); }
  b.count += 1; if (tgAiBuckets.size > 5000) tgAiBuckets.clear();
  return b.count > 12;
}
async function telegramAssistantReply(env, chatId, userId, text, attachment) {
  if (tgAiRateLimited(chatId)) return null;
  let target = null, upcoming = [], overdue = [];
  try { target = await notifyTarget(env, userId, "telegram"); } catch {}
  try { upcoming = await telegramItems(env, userId, "upcoming", 15); } catch {}
  try { overdue = await telegramItems(env, userId, "overdue", 15); } catch {}
  const lang = (target && target.lang) || "ar";
  const facts = {
    user: { name: targetDisplayName(target, lang, ""), company: (target && target.org_name) || "" },
    now_riyadh: new Date().toLocaleString("en-GB", { timeZone: "Asia/Riyadh" }),
    upcoming_items: upcoming, overdue_items: overdue,
    counts: { upcoming: Array.isArray(upcoming) ? upcoming.length : 0, overdue: Array.isArray(overdue) ? overdue.length : 0 },
    dashboard_url: "https://appmails.net/app/dashboard.html",
    import_url: "https://appmails.net/app/documents.html#importFlow",
  };
  if (attachment) facts.attachment = { name: attachment.name || "", kind: attachment.kind || "file", content: String(attachment.content || "").slice(0, 9000) };
  const system = `أنت مساعد TheTracker داخل تلغرام، تخدم المستخدم ${facts.user.name || ""}${facts.user.company ? ` من شركة «${facts.user.company}»` : ""}.
التراكر منصة لتتبع القضايا والمخالفات والعقود والمواعيد من ملفات إكسل، مع تقويم وتنبيهات.
قواعدك:
- أجب بـ${TG_LANG_NAMES[lang] || "العربية الفصحى"} دائما، باختصار وود ومباشرة، والأرقام غربية (1234567890) والتواريخ بتوقيت الرياض.
- اعتمد على الحقائق أدناه وحدها (مواعيده القادمة والمتأخرة وعدها)؛ إن سئلت عن شيء ليس فيها قل إنك لا تراه هنا ووجهه إلى لوحة التحكم.
- التسجيل والإنجاز والإسناد تتم عبر أزرار تأكيد يعرضها النظام تلقائيا حين يكتب المستخدم طلبه صراحة (مثل: «سجل جلسة القضية 4521 الأحد 10 صباحا»). لا تقل أبدا إنك تنتظر تفعيل أدوات أو أنك ستسجل الطلب للمتابعة — إن بدا أنه يريد تسجيل شيء فاطلب منه كتابته بهذه الصيغة في سطر واحد، أو أجب من الحقائق.
- لا تعد بتعديل أو حذف شيء بنفسك؛ لأي تعديل يدوي وجهه إلى لوحة التحكم: ${facts.dashboard_url}
- لا تختلق أرقاما أو قضايا أو تواريخ. لا تخرج عن مواضيع التراكر.
- إن وجد "attachment" في الحقائق فهو محتوى ملف/صورة أرسله المستخدم الآن: افهم المطلوب من رسالته، وإلا فلخصه واستخرج منه المواعيد والأرقام والأطراف المهمة، واذكر ما يمكنه فعله به في التراكر (الاستيراد من ${facts.import_url} إن كان جدولا). لا تقل إنك لا تستطيع قراءة الملفات — المحتوى أمامك.
الحقائق (JSON): ${JSON.stringify(facts).slice(0, 20000)}`;
  return askAssistant(env, system, [{ role: "user", content: text }]);
}

/** رسالة صوتية ← نص (Whisper على Workers AI) */
async function transcribeTelegramVoice(env, media) {
  if (!env.AI) return null;
  const { bytes } = await fetchTelegramFile(env, media.file_id);
  const out = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: bytesToBase64(bytes) });
  return String((out && out.text) || "").trim() || null;
}

/** مستند أو صورة ← نص: تحويل Markdown (PDF/إكسل/CSV/صور…)؛ وللصور محاولة قراءة بصرية أولا */
async function readTelegramDocument(env, media, name, mime) {
  if (!env.AI) return null;
  const { bytes } = await fetchTelegramFile(env, media.file_id);
  const isImage = /^image\//.test(mime || "");
  if (isImage) {
    try {
      const out = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
        messages: [{ role: "user", content: "Read everything written in this image (Arabic or English) and transcribe it faithfully as text, then describe what the document is." }],
        image: `data:${mime};base64,${bytesToBase64(bytes)}`,
        max_tokens: 900,
      });
      const text = String((out && (out.response || out.result)) || "").trim();
      if (text) return text;
    } catch (e) { console.error("[telegram] vision failed:", String((e && e.message) || e).slice(0, 200)); }
  }
  const results = await env.AI.toMarkdown([{ name: name || "file", blob: new Blob([bytes], { type: mime || "application/octet-stream" }) }]);
  const first = Array.isArray(results) ? results[0] : results;
  const data = first && (first.data || first.markdown || "");
  return String(data || "").trim() || null;
}

/** الرسالة (نص/صوت/ملف) ← نية ← بحث فوري، أو عرض فعل بزري تأكيد، أو جواب المساعد */
const ADD_VERBS = VERBS.add;
/* بوابة أخيرة قبل أي إرسال: لا أسماء حقول ولا JSON ولا معرفات داخلية ولا مصطلحات تقنية تصل إلى المستخدم */
const HUMANIZE_EMPTY = { ar: "لم أفهم الطلب، أعد صياغته بكلمات أخرى.", en: "I did not understand, please rephrase.", fr: "Je n'ai pas compris, reformulez.", ur: "سمجھ نہیں آیا، دوبارہ لکھیں۔" };
function humanize(text, lang) {
  let t = String(text || "");
  t = t.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "");
  /* الأرقام القياسية الداخلية (ITM-/ORG-/USR-) لا تصل إلى المستخدم أبدا، حتى لو قلد النموذج ردا قديما */
  t = t.replace(/\b(?:ITM|ORG|USR)-\d{8}-\d{4}\b\s*[|—-]?\s*/g, "");
  const lines = t.split("\n").filter((line) => {
    const l = line.trim();
    if (!l) return true;
    if (/[{}\[\]]/.test(l) && /["':]/.test(l)) return false;                 /* JSON أو مصفوفات */
    if (/\b[a-z]+_[a-z_]+\b/.test(l)) return false;                          /* أسماء حقول snake_case */
    if (/ISO ?8601|null|undefined|uuid|jsonb|rpc|sql|payload|schema/i.test(l)) return false;
    if (/^(missing|none|n\/a)\b/i.test(l)) return false;
    return true;
  });
  t = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return t || (HUMANIZE_EMPTY[lang] || HUMANIZE_EMPTY.ar);
}
function sanitizeIntentItem(item, text) {
  const out = {};
  const arabicMsg = /[\u0600-\u06FF]/.test(text || "");
  for (const k of Object.keys(item || {})) {
    let v = item[k];
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "string") {
      v = v.trim();
      /* هذيان النموذج: نص طويل أو شرح إنجليزي داخل رسالة عربية */
      if (v.length > 120) continue;
      if (arabicMsg && (v.match(/[A-Za-z]{3,}/g) || []).length >= 4) continue;
      if (/^(missing|none|null|n\/a|leave blank|not applicable)/i.test(v)) continue;
    }
    out[k] = v;
  }
  return out;
}

/* كل كتابة تمر من هنا: مسودة في القاعدة + وصف ما سيحدث + زرا تأكيد/إلغاء؛ التنفيذ في act:y فقط */
async function askToConfirm(env, chatId, userId, intent, lang, pre, userTimeZone) {
  const token = Math.random().toString(36).slice(2, 8); /* يربط الزر بمسودته: زر قديم لا ينفذ مسودة أحدث */
  try { await rpc(env, "telegram_draft_put", { p_secret: env.WORKER_SECRET, p_chat_id: String(chatId), p_user_id: userId, p_payload: { type: "action", intent, token } }); }
  catch { return false; }
  const ask = humanize(describeAction(lang, intent, userTimeZone), lang);
  try { await sendTelegram(env, chatId, (pre || "") + ask, actionButtons(lang, token)); } catch {}
  await logBotReply(env, chatId, userId, ask);
  return true;
}

async function smartReply(env, chatId, userId, text, lang, tgName, attachment, prefix, userTimeZone) {
  const b = botText(lang);
  const pre = prefix || "";
  /* أولا: الأوامر المباشرة المعروفة (قضايا، المستندات، رقم السجل…) تجاب من البيانات فورا، قبل أي تخمين نية */
  if (!attachment) {
    let quick = null;
    try { quick = await quickAnswer(env, { chatId, userId, text, lang, userTimeZone }); } catch {}
    if (quick && quick.text) {
      const quickText = humanize(quick.text, lang);
      try { await sendTelegram(env, chatId, pre + quickText, menuKeyboard(lang)); } catch {}
      await logBotReply(env, chatId, userId, quickText);
      return;
    }
  }
  let intent = { action: "question" };
  try { intent = await extractIntent(env, text, attachment ? { attachment } : null); } catch {}
  if (intent.item) intent.item = sanitizeIntentItem(intent.item, text);
  /* الإضافة لا تقترح إلا بفعل صريح في الرسالة؛ كلمة أو سؤال ليس طلب تسجيل */
  if (intent.action === "add" && !ADD_VERBS.test(text)) intent.action = "question";
  /* الإنجاز والإسناد كذلك: فعل صريح في الرسالة وإلا فهي سؤال أو تعليق (أحسنت ليست أمرا بالإقفال) */
  if (intent.action === "done" && !VERBS.done.test(text)) intent.action = "question";
  if (intent.action === "assign" && !VERBS.assign.test(text)) intent.action = "question";
  if (intent.action === "add" || intent.action === "done" || intent.action === "assign") {
    if (intent.action === "add" && !(intent.item && intent.item.title)) intent.action = "question";
    else if (await askToConfirm(env, chatId, userId, intent, lang, pre, userTimeZone)) return;
    else intent.action = "question";
  }
  /* الوكيل الذكي أولا: يعرف من يخاطب، يستعمل أدوات تراكر (بحث، مواعيد، إضافة، إنجاز، إسناد) باسمه، ويتذكر المحادثة */
  let agent = null;
  try {
    let target = null;
    try { target = await notifyTarget(env, userId, "telegram"); } catch {}
    agent = await agentReply(env, { chatId, userId, text, lang, name: tgName, orgName: (target && target.org_name) || "", attachment, userTimeZone });
  } catch (e) { console.log("agent failed", String(e && e.message || e).slice(0, 200)); agent = null; }
  /* النموذج أراد كتابة (إنجاز/إضافة/إسناد): لا ينفذ؛ يعرض ما فهمه وينتظر زر التأكيد */
  if (agent && agent.pending) {
    const pending = agent.pending;
    if (pending.item) pending.item = sanitizeIntentItem(pending.item, text);
    if (await askToConfirm(env, chatId, userId, pending, lang, pre, userTimeZone)) return;
  }
  if (agent && agent.text) {
    const agentText = humanize(agent.text, lang);
    try { await sendTelegram(env, chatId, pre + agentText, menuKeyboard(lang)); } catch {}
    await logBotReply(env, chatId, userId, agentText);
    return;
  }
  if (intent.action === "search" && intent.query) {
    let rows = [];
    try { rows = await rpc(env, "telegram_search", { p_secret: env.WORKER_SECRET, p_user_id: userId, p_query: intent.query, p_limit: 8 }); } catch {}
    try { await sendTelegram(env, chatId, pre + formatSearch(lang, intent.query, rows, userTimeZone), menuKeyboard(lang)); } catch {}
    return;
  }
  let reply = null;
  try { reply = await telegramAssistantReply(env, chatId, userId, text, attachment); } catch {}
  if (!reply) reply = attachment ? b.fileUnreadable : channelText(lang).alreadyLinked(tgName);
  reply = humanize(reply, lang);
  try { await sendTelegram(env, chatId, pre + reply, menuKeyboard(lang)); } catch {}
  await logBotReply(env, chatId, userId, reply);
}

/* أكثر من شركة؟ يختار مرة واحدة بأزرار، وتحفظ الشركة النشطة للمحادثة؛ زر «الشركة» أو كلمة «الشركات» تعيد الاختيار */
const ORG_WORDS = /^(الشركات|شركاتي|بدل الشركة|غير الشركة|تغيير الشركة|companies|switch company|change company)$/i;
const ORG_TEXT = {
  ar: { pick: "أي شركة نتكلم عنها؟", set: (n) => "الشركة الآن: " + n },
  en: { pick: "Which company are we talking about?", set: (n) => "Company now: " + n },
  fr: { pick: "De quelle societe parlons-nous ?", set: (n) => "Societe : " + n },
  ur: { pick: "کس کمپنی کی بات کریں؟", set: (n) => "کمپنی اب: " + n },
};
async function orgChoices(env, userId) {
  try { return (await rpc(env, "telegram_org_choices", { p_secret: env.WORKER_SECRET, p_user_id: userId })) || []; } catch { return []; }
}
async function sendOrgChooser(env, chatId, lang, choices) {
  const t = ORG_TEXT[lang] || ORG_TEXT.ar;
  const rows = choices.map((o) => [{ text: (o.active ? "✓ " : "") + o.name, callback_data: "org:" + o.id }]);
  await sendTelegram(env, chatId, t.pick, { reply_markup: { inline_keyboard: rows } });
}
async function needsOrgChoice(env, chatId, userId, lang) {
  const choices = await orgChoices(env, userId);
  if (choices.length <= 1 || choices.some((o) => o.active)) return false;
  await sendOrgChooser(env, chatId, lang, choices);
  return true;
}
/* زر «الشركة»: أكثر من شركة → اختيار؛ شركة واحدة → بياناتها المفيدة مباشرة */
async function companyMenu(env, chatId, userId, lang) {
  const choices = await orgChoices(env, userId);
  if (choices.length > 1) { await sendOrgChooser(env, chatId, lang, choices); return; }
  const out = await agentReply(env, { chatId, userId, text: "الشركة", lang });
  try { await sendTelegram(env, chatId, (out && out.text) || "-", menuKeyboard(lang)); } catch {}
}

/* رد البوت يسجل كالرسائل الواردة: ذاكرة للوكيل، ورؤية للإدارة (من كلم البوت وبماذا رد) */
async function logBotReply(env, chatId, userId, text) {
  if (!env.WORKER_SECRET || !text) return;
  try {
    await rpc(env, "log_telegram_message", { p_secret: env.WORKER_SECRET, p_chat_id: String(chatId), p_username: "bot", p_first_name: "TheTracker",
      p_body: String(text).slice(0, 4000), p_user_id: userId || null, p_action: "reply" });
  } catch (e) { console.log("reply log failed", String(e && e.message || e).slice(0, 200)); }
}

/** POST /api/telegram/webhook — كل رسالة تسجل ويرد عليها: ربط (/start الرمز)، قائمة أزرار، أو دعوة للربط */
async function handleTelegramWebhook(request, env) {
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const got = request.headers.get("x-telegram-bot-api-secret-token") || "";
    if (got !== env.TELEGRAM_WEBHOOK_SECRET) return json({ ok: false }, 401);
  }
  let update;
  try { update = await request.json(); } catch { return json({ ok: true }); }
  if (update && update.callback_query) return handleTelegramCallback(env, update.callback_query);
  const msg = update && (update.message || update.edited_message);
  const chatId = msg && msg.chat && msg.chat.id;
  /* البوت مساعد شخصي لحساب مرتبط: لا يعمل في المجموعات والقنوات، فلا يضغط أحد زر تأكيد عن غيره */
  if (msg && msg.chat && msg.chat.type && msg.chat.type !== "private") return json({ ok: true });
  const text = String((msg && msg.text) || "").trim();
  if (!chatId) return json({ ok: true });
  const from = (msg && msg.from) || {};
  const tgLang = telegramLang(from.language_code);
  const tgName = from.first_name || "";
  let userId = null, action = "none";
  const logMessage = async () => {
    if (!env.WORKER_SECRET) return null;
    try {
      return await rpc(env, "log_telegram_message", {
        p_secret: env.WORKER_SECRET, p_chat_id: String(chatId), p_username: from.username || null,
        p_first_name: [from.first_name, from.last_name].filter(Boolean).join(" ") || null,
        p_body: text || null, p_user_id: userId, p_action: action,
      });
    } catch { return null; }
  };

  // 1) الربط بالرمز — يصل تلقائيا من رمز QR/الرابط العميق (/start الرمز) أو مكتوبا
  const m = text.match(/^\/start\s+([A-Za-z0-9]{4,12})$/) || text.match(/^([A-Za-z0-9]{6,12})$/);
  if (m) {
    userId = await linkChannelByCode(env, "telegram", m[1], chatId);
    action = userId ? "linked" : "bad_code";
    if (userId) {
      await greetLinked(env, chatId, userId, tgLang, tgName);
      let tgt = null; try { tgt = await notifyTarget(env, userId, "telegram"); } catch {}
      await notifyAdmins(env, "linked", { chatId, actorUserId: userId, name: targetDisplayName(tgt, tgLang, tgName), org: (tgt && tgt.org_name) || "", username: from.username || "" });
    }
    else { try { await sendTelegram(env, chatId, channelText(tgLang).badCode); } catch {} }
    await logMessage();
    return json({ ok: true });
  }

  // 2) مشاركة جهة الاتصال (رقم صاحب المحادثة نفسه): الربط بالرقم المسجل في الملف الشخصي
  const contact = msg && msg.contact;
  if (contact && contact.phone_number && (!contact.user_id || String(contact.user_id) === String(from.id))) {
    userId = null;
    try { userId = await linkChannelByPhone(env, "telegram", contact.phone_number, chatId); } catch {}
    action = userId ? "linked" : "bad_code";
    if (userId) {
      await greetLinked(env, chatId, userId, tgLang, tgName);
      let tgt = null; try { tgt = await notifyTarget(env, userId, "telegram"); } catch {}
      await notifyAdmins(env, "linked", { chatId, actorUserId: userId, name: targetDisplayName(tgt, tgLang, tgName), org: (tgt && tgt.org_name) || "", username: from.username || "" });
    }
    else { try { await sendTelegram(env, chatId, botText(tgLang).phoneNotFound, { reply_markup: { remove_keyboard: true } }); } catch {} }
    await logMessage();
    return json({ ok: true });
  }

  // 3) رسالة عادية أو زر أو وسائط: سجلها واعرف صاحب المحادثة (إن كانت مربوطة)
  const voice = msg.voice || msg.audio || msg.video_note || null;
  const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;
  const doc = msg.document || null;
  const caption = String((msg && msg.caption) || "").trim();
  const mediaLabel = voice ? "[voice]" : doc ? `[file: ${doc.file_name || doc.mime_type || "document"}]` : photo ? "[photo]" : "";
  if (mediaLabel && !text) { /* يسجل نوع الوسيط مع تعليقه */ }
  const logBody = mediaLabel ? `${mediaLabel} ${caption}`.trim() : text;
  const owner = await (async () => {
    if (!env.WORKER_SECRET) return null;
    try {
      return await rpc(env, "log_telegram_message", {
        p_secret: env.WORKER_SECRET, p_chat_id: String(chatId), p_username: from.username || null,
        p_first_name: [from.first_name, from.last_name].filter(Boolean).join(" ") || null,
        p_body: logBody || null, p_user_id: null, p_action: "none",
      });
    } catch { return null; }
  })();
  const menu = menuAction(text);
  if (!owner) {
    await askToLink(env, chatId, tgLang);
    await notifyAdmins(env, "stranger", { chatId, name: tgName, username: from.username || "", text });
    return json({ ok: true });
  }

  // 3-أ) صوت: نفهمه ثم نجيب كأنه نص
  if (voice || doc || photo) {
    let target = null;
    try { target = await notifyTarget(env, owner, "telegram"); } catch {}
    const lang = (target && target.lang) || tgLang;
    const userTimeZone = (target && target.tz) || "Asia/Riyadh";
    const b = botText(lang);
    await sendChatAction(env, chatId, "typing");
    const size = Number((voice && voice.file_size) || (doc && doc.file_size) || (photo && photo.file_size) || 0);
    if (size > TELEGRAM_FILE_MAX) { try { await sendTelegram(env, chatId, b.fileTooBig, menuKeyboard(lang)); } catch {} return json({ ok: true }); }
    if (voice) {
      let transcript = null;
      try { transcript = await transcribeTelegramVoice(env, voice); } catch (e) { console.error("[telegram] whisper failed:", String((e && e.message) || e).slice(0, 200)); }
      if (!transcript) { try { await sendTelegram(env, chatId, b.fileUnreadable, menuKeyboard(lang)); } catch {} return json({ ok: true }); }
      const spokenMenu = menuAction(transcript);
      if (spokenMenu) { await runMenu(env, chatId, owner, spokenMenu); return json({ ok: true }); }
      await smartReply(env, chatId, owner, transcript, lang, targetDisplayName(target, lang, tgName), null, b.voiceHeard + "«" + transcript + "»\n\n", userTimeZone);
      return json({ ok: true });
    }
    // 3-ب) إكسل أو CSV: يقرأ بمنطق صفحة الاستيراد، ويعرض ملخصه بزري حفظ/إلغاء
    if (doc && ALLOWED_EXT.includes(fileExt(doc.file_name))) {
      let parsed = null;
      try { const { bytes } = await fetchTelegramFile(env, doc.file_id); parsed = parseWorkbook(bytes, doc.file_name || "file.xlsx"); }
      catch (e) { console.error("[telegram] xlsx parse failed:", String((e && e.message) || e).slice(0, 200)); }
      if (!parsed || !parsed.sheets.length) { try { await sendTelegram(env, chatId, b.importNothing, menuKeyboard(lang)); } catch {} return json({ ok: true }); }
      try { await rpc(env, "telegram_draft_put", { p_secret: env.WORKER_SECRET, p_chat_id: String(chatId), p_user_id: owner, p_payload: draftPayload(parsed) }); }
      catch (e) { try { await sendTelegram(env, chatId, b.importFailed, menuKeyboard(lang)); } catch {} return json({ ok: true }); }
      const lines = parsed.sheets.map((sh) => b.importSheet(sh.tracker || sh.name, sh.records.length, sh.skipped)).join("\n");
      let orgLine = ""; /* الشركة التي ستُكتب فيها الصفوف (النشطة في البوت) تظهر قبل التأكيد */
      try { const orgs = await orgChoices(env, owner); const cur = orgs.find((o) => o && o.active) || orgs[0]; if (cur && cur.name) orgLine = "\n🏢 " + cur.name; } catch {}
      const summary = b.importFound(doc.file_name || "file", parsed.sheets.length) + "\n" + lines + orgLine + "\n\n" + b.importAsk;
      try { await sendTelegram(env, chatId, summary, confirmButtons(lang)); } catch {}
      return json({ ok: true });
    }
    // 3-ج) مستند أو صورة: نقرأه ثم نجيب عن تعليقه (أو نلخصه)
    const media = doc || photo;
    const name = (doc && doc.file_name) || (photo ? "photo.jpg" : "file");
    const mime = (doc && doc.mime_type) || (photo ? "image/jpeg" : "application/octet-stream");
    let content = null;
    try { content = await readTelegramDocument(env, media, name, mime); } catch (e) { console.error("[telegram] read file failed:", String((e && e.message) || e).slice(0, 200)); }
    if (!content) { try { await sendTelegram(env, chatId, b.fileUnreadable, menuKeyboard(lang)); } catch {} return json({ ok: true }); }
    /* ورقة رسمية أو قانونية تعرفها القواعد: خلاصتها بزري حفظ/لا ثم تحفظ مستندا كاملا بملفها؛ وإلا يجيب المساعد كالمعتاد */
    if (await offerDocument(env, { chatId, userId: owner, lang, text: content, isPhoto: !!photo, file: { file_id: media.file_id, name, mime, size_bytes: size } })) return json({ ok: true });
    await smartReply(env, chatId, owner, caption || b.fileQuestion, lang, targetDisplayName(target, lang, tgName), { name, kind: photo ? "image" : "file", content }, "", userTimeZone);
    return json({ ok: true });
  }
  if (menu) { await runMenu(env, chatId, owner, menu); return json({ ok: true }); }
  if (text === "/start") { await greetLinked(env, chatId, owner, tgLang, tgName); return json({ ok: true }); }
  // نص حر من مستخدم مربوط: افهم المقصود (تسجيل/إنجاز/إسناد/بحث) أو أجب من بياناته
  let target = null;
  try { target = await notifyTarget(env, owner, "telegram"); } catch {}
  const lang = (target && target.lang) || tgLang;
  const userTimeZone = (target && target.tz) || "Asia/Riyadh";
  if (ORG_WORDS.test(text)) { await companyMenu(env, chatId, owner, lang); return json({ ok: true }); }
  if (await needsOrgChoice(env, chatId, owner, lang)) return json({ ok: true });
  await sendChatAction(env, chatId, "typing");
  await smartReply(env, chatId, owner, text, lang, targetDisplayName(target, lang, tgName), null, "", userTimeZone);
  return json({ ok: true });
}

/** ضغطة زر داخل رسالة البوت: تأكيد الاستيراد أو إلغاؤه */
async function handleTelegramCallback(env, cq) {
  const chatId = cq.message && cq.message.chat && cq.message.chat.id;
  const data = String(cq.data || "");
  const from = cq.from || {};
  await answerCallback(env, cq.id);
  if (!chatId) return json({ ok: true });
  if (cq.message && cq.message.chat && cq.message.chat.type && cq.message.chat.type !== "private") return json({ ok: true });
  await clearInlineButtons(env, chatId, cq.message && cq.message.message_id);
  let owner = null;
  try {
    owner = await rpc(env, "log_telegram_message", {
      p_secret: env.WORKER_SECRET, p_chat_id: String(chatId), p_username: from.username || null,
      p_first_name: [from.first_name, from.last_name].filter(Boolean).join(" ") || null,
      p_body: "[button] " + data, p_user_id: null, p_action: "none",
    });
  } catch {}
  const tgLang = telegramLang(from.language_code);
  if (!owner) { await askToLink(env, chatId, tgLang); return json({ ok: true }); }
  let target = null;
  try { target = await notifyTarget(env, owner, "telegram"); } catch {}
  const lang = (target && target.lang) || tgLang;
  const b = botText(lang);
  if (data.indexOf("org:") === 0) {
    let r = null;
    try { r = await rpc(env, "telegram_set_org", { p_secret: env.WORKER_SECRET, p_user_id: owner, p_org: data.slice(4) }); } catch {}
    const t = ORG_TEXT[lang] || ORG_TEXT.ar;
    try { await sendTelegram(env, chatId, r && r.status === "ok" ? t.set(r.name) : t.pick, menuKeyboard(lang)); } catch {}
    return json({ ok: true });
  }
  if (/^(doc|prof):/.test(data) && await handleDocCallback(env, { chatId, userId: owner, lang, data })) return json({ ok: true });
  const act = data.match(/^act:(y|n)(?::([a-z0-9]+))?$/);
  if (act) {
    let draft = null;
    try { draft = await rpc(env, "telegram_draft_take", { p_secret: env.WORKER_SECRET, p_chat_id: String(chatId) }); } catch {}
    const payload = draft && draft.payload && draft.payload.type === "action" ? draft.payload : null;
    /* الزر يحمل رمز مسودته؛ إن كان لغيرها أعيدت المسودة إلى مكانها وأُبلغ أن هذا الزر انتهى */
    const stale = payload && payload.token && payload.token !== (act[2] || "");
    if (stale) {
      try { await rpc(env, "telegram_draft_put", { p_secret: env.WORKER_SECRET, p_chat_id: String(chatId), p_user_id: draft.user_id, p_payload: payload }); } catch {}
      try { await sendTelegram(env, chatId, b.importExpired, menuKeyboard(lang)); } catch {}
      return json({ ok: true });
    }
    if (act[1] === "n") {
      try { await sendTelegram(env, chatId, b.importCancelled, menuKeyboard(lang)); } catch {}
      return json({ ok: true });
    }
    const intent = payload ? payload.intent : null;
    if (!intent || String(draft.user_id) !== String(owner)) { try { await sendTelegram(env, chatId, b.importExpired, menuKeyboard(lang)); } catch {} return json({ ok: true }); }
    await sendChatAction(env, chatId, "typing");
    let out;
    try { out = await executeAction(env, owner, intent, lang); }
    catch (e) { out = { text: /PLAN_LIMIT/.test(String((e && e.message) || e)) ? b.importLimit : b.importFailed, extra: menuKeyboard(lang) }; }
    if (out.keepDraft) { try { await rpc(env, "telegram_draft_put", { p_secret: env.WORKER_SECRET, p_chat_id: String(chatId), p_user_id: owner, p_payload: { ...payload, intent } }); } catch {} }
    try { await sendTelegram(env, chatId, out.text, out.extra); } catch {}
    return json({ ok: true });
  }
  // اختيار القضية/المخالفة التي تتبعها المهمة
  if (data.startsWith("par:")) {
    let draft = null;
    try { draft = await rpc(env, "telegram_draft_take", { p_secret: env.WORKER_SECRET, p_chat_id: String(chatId) }); } catch {}
    const intent = draft && draft.payload && draft.payload.type === "action" ? draft.payload.intent : null;
    if (!intent || String(draft.user_id) !== String(owner)) { try { await sendTelegram(env, chatId, b.importExpired, menuKeyboard(lang)); } catch {} return json({ ok: true }); }
    /* زر اختيار القضية يكمل إضافة فقط؛ لا ينفذ إنجازا أو إسنادا معلقا */
    if (intent.action !== "add") {
      try { await rpc(env, "telegram_draft_put", { p_secret: env.WORKER_SECRET, p_chat_id: String(chatId), p_user_id: owner, p_payload: draft.payload }); } catch {}
      try { await sendTelegram(env, chatId, b.importExpired, menuKeyboard(lang)); } catch {}
      return json({ ok: true });
    }
    intent.item = intent.item || {}; intent.item.parent_id = data.slice(4);
    await sendChatAction(env, chatId, "typing");
    let out;
    try { out = await executeAction(env, owner, intent, lang); }
    catch (e) { out = { text: /PLAN_LIMIT/.test(String((e && e.message) || e)) ? b.importLimit : b.importFailed, extra: menuKeyboard(lang) }; }
    try { await sendTelegram(env, chatId, out.text, out.extra); } catch {}
    return json({ ok: true });
  }
  if (data === "imp:n") {
    try { await rpc(env, "telegram_draft_take", { p_secret: env.WORKER_SECRET, p_chat_id: String(chatId) }); } catch {}
    try { await sendTelegram(env, chatId, b.importCancelled, menuKeyboard(lang)); } catch {}
    return json({ ok: true });
  }
  if (data === "imp:y") {
    let draft = null;
    try { draft = await rpc(env, "telegram_draft_take", { p_secret: env.WORKER_SECRET, p_chat_id: String(chatId) }); } catch {}
    if (!draft || !draft.payload || String(draft.user_id) !== String(owner)) {
      try { await sendTelegram(env, chatId, b.importExpired, menuKeyboard(lang)); } catch {}
      return json({ ok: true });
    }
    await sendChatAction(env, chatId, "typing");
    const { results, errors } = await commitImport(env, owner, draft.payload);
    let text = "";
    if (results.length) text += b.importDoneTitle + "\n" + results.map((r) => b.importDoneLine(r.tracker_name, r.inserted || 0, !!r.tracker_new)).join("\n");
    if (errors.length) text += (text ? "\n\n" : "") + (errors.some((e) => e.limit) ? b.importLimit : b.importFailed);
    if (!text) text = b.importFailed;
    try { await sendTelegram(env, chatId, text, results.length ? urlButton(b.openDash, "https://appmails.net/app/dashboard.html") : menuKeyboard(lang)); } catch {}
    return json({ ok: true });
  }
  return json({ ok: true });
}

/** POST /api/intent { text } — سطر الإدخال الذكي في الموقع: نفس مستخرج النية الذي يستخدمه البوت */
async function handleIntent(request, env) {
  const user = await authedUser(request, env);
  if (!user) return json({ error: "unauthorized" }, 401);
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const text = String((body && body.text) || "").slice(0, 1000).trim();
  if (!text) return json({ action: "none" });
  if (tgAiRateLimited("web:" + user.id)) return json({ error: "rate_limited" }, 429);
  try { return json(await extractIntent(env, text, null)); } catch { return json({ action: "none" }); }
}

/** POST /api/telegram/link { token } — المستخدم المسجل يربط محادثة البوت بضغطة الزر الذي أرسله البوت */
async function handleTelegramLink(request, env) {
  const user = await authedUser(request, env);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (!env.WORKER_SECRET) return json({ error: "not configured" }, 503);
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const chatId = await readLinkToken(env, body && body.token);
  if (!chatId) return json({ error: "bad_token" }, 400);
  try { await linkChannelDirect(env, user.id, "telegram", chatId); } catch (e) {
    return json({ error: "link_failed", detail: String((e && e.message) || e).slice(0, 200) }, 502);
  }
  await greetLinked(env, chatId, user.id, "ar", "");
  return json({ ok: true });
}

/** GET/POST /api/whatsapp/webhook — تحقق Meta + رسالة تحتوي رمز الربط */
async function handleWhatsappWebhook(request, env, url) {
  if (request.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && env.WHATSAPP_VERIFY_TOKEN && token === env.WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge || "", { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("forbidden", { status: 403 });
  }
  let body;
  try { body = await request.json(); } catch { return json({ ok: true }); }
  try {
    const entries = (body && body.entry) || [];
    for (const e of entries) {
      for (const ch of e.changes || []) {
        for (const m of (ch.value && ch.value.messages) || []) {
          const from = m.from;
          const text = String((m.text && m.text.body) || "").trim();
          const code = text.match(/([A-Za-z0-9]{6,12})/);
          if (from && code) {
            const userId = await linkChannelByCode(env, "whatsapp", code[1], from);
            try { await sendWhatsapp(env, from, userId ? channelText("ar").linked : channelText("ar").badCode); } catch {}
          }
        }
      }
    }
  } catch {}
  return json({ ok: true });
}

// --- Main router ---

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // HTTPS إلزامي — الطلبات على http تحول دائما (بدل الاعتماد على إعداد اللوحة)
    if (url.protocol === "http:") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }

    // تقويم ICS — /api/calendar/<token>.ics
    const cal = path.match(/^\/api\/calendar\/([a-f0-9]{16,64})\.ics$/i);
    if (cal && request.method === "GET") {
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return new Response("not configured", { status: 503 });
      return handleCalendar(cal[1], env);
    }

    // ملف أرسله المستخدم إلى بوت تيليغرام: رابط موقع (HMAC) يبقى قابلا للفتح من صفحة المستندات — GET /api/telegram/file/<id>/<sig>
    const tgFile = telegramFileRoute(path);
    if (tgFile && request.method === "GET") { try { return await handleTelegramFile(env, tgFile.fileId, tgFile.sig, url); } catch { return new Response("not found", { status: 404 }); } }

    // إثبات ملكية النطاق لجوجل — يقدم من الـ Worker لأن طبقة الأصول تحول
    // /x.html إلى /x، وجوجل تطلب الملف على مساره الحرفي بامتداده.
    if (env.GOOGLE_SITE_VERIFICATION_FILE && path === "/" + env.GOOGLE_SITE_VERIFICATION_FILE) {
      return new Response("google-site-verification: " + env.GOOGLE_SITE_VERIFICATION_FILE, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    // Only handle /api/* routes — everything else is static assets
    if (path === "/mcp" || path === "/mcp/") return await handleMcp(request, env, url, { authenticate: mcpAuthenticate, importRows: importRowsWithKey });
    /* الشكل نفسه الذي ربط به خادم باركينزي في هرمس (رابط فقط بلا ترويسة): المفتاح داخل المسار /mcp/tt_live_… */
    const mcpKeyInPath = path.match(/^\/mcp\/(tt_live_[a-f0-9]{48})\/?$/i);
    if (mcpKeyInPath) {
      const withKey = new Request(request, { headers: new Headers(request.headers) });
      withKey.headers.set("Authorization", "Bearer " + mcpKeyInPath[1]);
      return await handleMcp(withKey, env, url, { authenticate: mcpAuthenticate, importRows: importRowsWithKey });
    }
    if (!path.startsWith("/api/")) {
      /* ملف مقسم أجزاء؟ يجمع كما هو؛ وإلا يخدم من الأصول الثابتة */
      if (/\.(js|css)$/.test(path)) {
        try { const bundled = await serveBundle(request, env, url); if (bundled) return bundled; }
        catch (e) { console.log("bundle error", path, String(e && e.message || e)); }
      }
      return env.ASSETS.fetch(request);
    }

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    try {
      if (path.startsWith("/api/v1/")) return await handleV1(request, env, url);
      if (path === "/api/config" && request.method === "GET") return handleConfig(env);
      if (path === "/api/stats" && request.method === "GET") return await handleStats(env);
      if (path === "/api/assistant" && request.method === "POST") return await handleAssistantRequest(request, env);
      if (path === "/api/documents/template" && request.method === "GET") {
        return handleImportTemplate(url);
      }
      if (path === "/api/documents/analyze" && request.method === "POST") {
        /* قراءة المستندات تستهلك حصة الذكاء، فتلزمها جلسة مستخدم وحد معدل كالنية */
        const docUser = await authedUser(request, env);
        if (!docUser) return json({ error: "unauthorized" }, 401);
        if (tgAiRateLimited("doc:" + docUser.id)) return json({ error: "rate_limited" }, 429);
        return await handleDocumentAnalyze(request, env);
      }
      if (path === "/api/translate" && request.method === "POST") {
        /* ترجمة العرض: جلسة مستخدم + حد معدل، والنتائج تخزن مؤقتا في القاعدة */
        const trUser = await authedUser(request, env);
        if (!trUser) return json({ error: "unauthorized" }, 401);
        if (tgAiRateLimited("tr:" + trUser.id)) return json({ error: "rate_limited" }, 429);
        return await handleTranslate(request, env);
      }
      if (path === "/api/client-error" && request.method === "POST") {
        /* تقارير إقلاع الواجهة: تسجل في سجل الـ Worker فقط (wrangler tail)، لا تخزن ولا تحمل بيانات شخصية */
        const raw = (await request.text()).slice(0, 2000);
        console.log("client-error", raw, "ip:", request.headers.get("cf-connecting-ip") || "");
        return new Response(null, { status: 204 });
      }
      if (path === "/api/contact" && request.method === "POST") return await handleContact(request, env);
      if (path === "/api/notify/test" && request.method === "POST") return await handleNotifyTest(request, env);
      if (path === "/api/telegram/webhook" && request.method === "POST") return await handleTelegramWebhook(request, env);
      if (path === "/api/telegram/link" && request.method === "POST") return await handleTelegramLink(request, env);
      if (path === "/api/intent" && request.method === "POST") return await handleIntent(request, env);
      if (path === "/api/whatsapp/webhook") return await handleWhatsappWebhook(request, env, url);
      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: "server error" }, 500);
    }
  },

  // Cron كل 5 دقائق: توليد التنبيهات المستحقة وإرسالها عبر القنوات
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runNotificationCron(env).then((r) => console.log("[cron]", JSON.stringify(r))).catch((e) => console.error("[cron]", String(e))));
    // الإيجاز الصباحي (07:00 بتوقيت كل مستخدم) وتجهيز جلسات الغد (18:00)
    ctx.waitUntil(runTelegramDigests(env).then((r) => console.log("[digest]", JSON.stringify(r))).catch((e) => console.error("[digest]", String(e))));
  },
};
