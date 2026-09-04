/**
 * TheTracker API Worker — proxies Supabase calls server-side.
 * Keys are read from environment variables (Secrets in Cloudflare Dashboard).
 * Static assets are served by the [assets] binding automatically.
 */

import { handleAssistantRequest, askAssistant } from "./assistant.js";
import { handleCalendar } from "./calendar.js";
import { handleDocumentAnalyze } from "./documents.js";
import { runNotificationCron, linkChannelByCode, notifyTarget, sendTelegram, sendWhatsapp, sendSms, sendEmail, rpc, t as channelText,
         bot as botText, menuKeyboard, menuAction, urlButton, formatItems, telegramItems, linkChannelDirect, linkChannelByPhone, contactKeyboard,
         sendChatAction, fetchTelegramFile, bytesToBase64, TELEGRAM_FILE_MAX, answerCallback, clearInlineButtons, confirmButtons, actionButtons } from "./notify.js";
import { ALLOWED_EXT, fileExt, parseWorkbook, draftPayload, commitImport } from "./telegram-import.js";
import * as XLSX from "xlsx";
import { extractIntent, describeAction, formatSearch, executeAction, runTelegramDigests } from "./telegram-actions.js";

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

/** إعدادات العميل العامة — مفتاح anon عام بطبيعته (RLS هي الحماية)، لكنه لا يُكتب في الملفات. */
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
    // معرّف عميل جوجل معلومة عامة (يظهر في المتصفح) ويلزم زر الدخول بجوجل
    googleClientId: env.GOOGLE_CLIENT_ID || null,
    // مفتاح Google Picker (عام ومقيّد بالنطاق) لربط ملفات جوجل درايف بالعناصر
    googleApiKey: env.GOOGLE_API_KEY || null,
    // التحويل المباشر إلى جوجل يظهر اسم نطاقنا، لكنه يحتاج تسجيل عنوان العودة
    // /login في مشروع جوجل. حتى يُسجَّل، يبقى مسار سوبابيس القياسي هو العامل.
    googleDirect: String(env.GOOGLE_DIRECT_LOGIN || "") === "on",
    // معلومات عامة لربط القنوات (لا أسرار)
    telegramBot: env.TELEGRAM_BOT_USERNAME || null,
    whatsappNumber: env.WHATSAPP_PUBLIC_NUMBER || null,
    smsEnabled: !!(env.SMS_PROVIDER),
  });
}

/** أرقام المنصة — دالة SQL مجمّعة (SECURITY DEFINER) تعيد أعداداً فقط، بلا بيانات شركات. */
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

// --- تحقق جلسة المستخدم (JWT سوبابيس) لمسارات تخص حساباً بعينه ---
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
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function v1Json(data, status = 200) {
  const r = json(data, status);
  r.headers.set("Access-Control-Allow-Origin", "*");
  return r;
}
async function v1Auth(request, env) {
  if (!env.WORKER_SECRET) return { error: v1Json({ error: "not configured" }, 503) };
  const m = (request.headers.get("Authorization") || "").match(/^Bearer\s+(tt_live_[a-f0-9]{48})$/i);
  if (!m) return { error: v1Json({ error: "missing or malformed API key" }, 401) };
  const hash = await sha256Hex(m[1]);
  let who = null;
  try { who = await rpc(env, "api_key_resolve", { p_secret: env.WORKER_SECRET, p_hash: hash }); } catch { who = null; }
  if (!who || !who.org_id) return { error: v1Json({ error: "invalid or revoked API key" }, 401) };
  return { hash, who };
}
function csvOf(rows) {
  const keys = ["number", "title", "category", "tracker", "status", "due_at", "assignee_email", "amount", "client_name", "case_number", "created_at"];
  const extra = new Set();
  rows.forEach((r) => Object.keys(r.data || {}).forEach((k) => extra.add(k)));
  const cols = keys.concat([...extra]);
  const q = (v) => '"' + String(v === null || v === undefined ? "" : (typeof v === "object" ? JSON.stringify(v) : v)).replace(/"/g, '""') + '"';
  const lines = [cols.map(q).join(",")];
  rows.forEach((r) => lines.push(cols.map((c) => q(c in r ? r[c] : (r.data || {})[c])).join(",")));
  return "\ufeff" + lines.join("\r\n");
}
async function handleV1(request, env, url) {
  const path = url.pathname;
  const auth = await v1Auth(request, env);
  if (auth.error) return auth.error;
  const { hash, who } = auth;

  if (path === "/api/v1/ping") return v1Json({ ok: true, org: who.org_name });

  if (path === "/api/v1/items" && request.method === "GET") {
    const tracker = url.searchParams.get("tracker") || null;
    let rows = [];
    try { rows = (await rpc(env, "api_items_export", { p_secret: env.WORKER_SECRET, p_hash: hash, p_tracker: tracker })) || []; }
    catch (e) { return v1Json({ error: String(e.message || e).slice(0, 200) }, 500); }
    if ((url.searchParams.get("format") || "").toLowerCase() === "csv") {
      return new Response(csvOf(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=items.csv", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
    }
    return v1Json({ count: rows.length, items: rows });
  }

  if (path === "/api/v1/import" && request.method === "POST") {
    const ct = (request.headers.get("Content-Type") || "").toLowerCase();
    let bytes = null, filename = "api.csv", trackerName = url.searchParams.get("tracker") || null;
    try {
      if (ct.includes("multipart/form-data")) {
        const form = await request.formData();
        const f = form.get("file");
        if (!f || typeof f.arrayBuffer !== "function") return v1Json({ error: "file field missing" }, 400);
        trackerName = trackerName || form.get("tracker") || null;
        filename = f.name || filename; bytes = await f.arrayBuffer();
      } else if (ct.includes("application/json") || ct.includes("text/json")) {
        const body = await request.json();
        const rows = Array.isArray(body) ? body : (body.rows || body.items || body.data || []);
        if (!Array.isArray(rows) || !rows.length) return v1Json({ error: "no rows" }, 400);
        trackerName = trackerName || body.tracker || null;
        const ws = XLSX.utils.json_to_sheet(rows.map((r) => (r && typeof r === "object") ? r : { title: String(r) }));
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, trackerName || "data");
        bytes = XLSX.write(wb, { type: "array", bookType: "csv" }); filename = (trackerName || "api") + ".csv";
      } else {
        bytes = await request.arrayBuffer(); filename = (trackerName || "api") + (ct.includes("spreadsheet") || ct.includes("excel") ? ".xlsx" : ".csv");
      }
    } catch (e) { return v1Json({ error: "unreadable body: " + String(e.message || e).slice(0, 120) }, 400); }
    if (!ALLOWED_EXT.includes(fileExt(filename))) return v1Json({ error: "unsupported file type" }, 415);

    let parsed;
    try { parsed = parseWorkbook(bytes, filename); } catch (e) { return v1Json({ error: "cannot parse: " + String(e.message || e).slice(0, 120) }, 422); }
    const payload = draftPayload(parsed);
    const results = [], errors = [];
    for (const sh of payload.sheets) {
      try {
        results.push(await rpc(env, "api_import", {
          p_secret: env.WORKER_SECRET, p_hash: hash, p_filename: filename,
          p_tracker_name: trackerName || sh.tracker || sh.name, p_columns: sh.columns || [], p_mapping: sh.mapping || {}, p_rows: sh.rows || [],
        }));
      } catch (e) { errors.push({ sheet: sh.name, message: String(e.message || e).slice(0, 200) }); }
    }
    return v1Json({ ok: errors.length === 0, results, errors, unusable: (parsed.unusable || []).map((u) => ({ sheet: u.name, rows: u.skipped })) }, errors.length && !results.length ? 422 : 200);
  }
  return v1Json({ error: "not found" }, 404);
}

/** POST /api/notify/test { channel } — رسالة تجريبية لقناة المستخدم الحالي */
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

/** لغة الرد على من لم يُربط بعد: لغة تطبيق تلغرام عنده إن كانت من لغاتنا */
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

// --- رمز ربط موقّع (HMAC بسر الـ Worker): زر داخل البوت يفتح الإعدادات فتربط الجلسة المحادثة بلا أي كتابة ---
async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function makeLinkToken(env, chatId) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // صالح يوماً
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
async function greetLinked(env, chatId, userId, fallbackLang, fallbackName) {
  let target = null;
  try { target = await notifyTarget(env, userId, "telegram"); } catch {}
  const lang = (target && target.lang) || fallbackLang || "ar";
  const name = targetDisplayName(target, lang, fallbackName);
  try { await sendTelegram(env, chatId, channelText(lang).linked(name, target && target.org_name), menuKeyboard(lang)); } catch {}
  return lang;
}

/** رسالة "اربط حسابك" لمن لم يُربط: زر يفتح الموقع (ربط تلقائي) */
async function askToLink(env, chatId, lang) {
  const b = botText(lang);
  let extra = {};
  if (env.WORKER_SECRET) {
    const token = await makeLinkToken(env, chatId);
    extra = urlButton(b.linkBtn, `https://appmails.net/app/settings?tglink=${encodeURIComponent(token)}`);
  }
  try { await sendTelegram(env, chatId, b.linkIntro, extra); } catch {}
  // الطريق الثاني: مشاركة رقم الجوال المسجَّل في الملف الشخصي (زر واحد)
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
  } else if (action === "dashboard") {
    try { await sendTelegram(env, chatId, b.openDash, urlButton(b.openDash, "https://appmails.net/app/dashboard.html")); } catch {}
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
- أجب بـ${TG_LANG_NAMES[lang] || "العربية الفصحى"} دائماً، باختصار وودّ ومباشرة، والأرقام غربية (1234567890) والتواريخ بتوقيت الرياض.
- اعتمد على الحقائق أدناه وحدها (مواعيده القادمة والمتأخرة وعدّها)؛ إن سُئلت عن شيء ليس فيها قل إنك لا تراه هنا ووجّهه إلى لوحة التحكم.
- التسجيل والإنجاز والإسناد تتم عبر أزرار تأكيد يعرضها النظام تلقائياً حين يكتب المستخدم طلبه صراحةً (مثل: «سجّل جلسة القضية 4521 الأحد 10 صباحاً»). لا تقل أبداً إنك تنتظر تفعيل أدوات أو أنك ستسجّل الطلب للمتابعة — إن بدا أنه يريد تسجيل شيء فاطلب منه كتابته بهذه الصيغة في سطر واحد، أو أجب من الحقائق.
- لا تعِد بتعديل أو حذف شيء بنفسك؛ لأي تعديل يدوي وجّهه إلى لوحة التحكم: ${facts.dashboard_url}
- لا تختلق أرقاماً أو قضايا أو تواريخ. لا تخرج عن مواضيع التراكر.
- إن وُجد "attachment" في الحقائق فهو محتوى ملف/صورة أرسله المستخدم الآن: افهم المطلوب من رسالته، وإلا فلخّصه واستخرج منه المواعيد والأرقام والأطراف المهمة، واذكر ما يمكنه فعله به في التراكر (الاستيراد من ${facts.import_url} إن كان جدولاً). لا تقل إنك لا تستطيع قراءة الملفات — المحتوى أمامك.
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

/** مستند أو صورة ← نص: تحويل Markdown (PDF/إكسل/CSV/صور…)؛ وللصور محاولة قراءة بصرية أولاً */
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

/** الرسالة (نص/صوت/ملف) ← نيّة ← بحث فوري، أو عرض فعل بزرّي تأكيد، أو جواب المساعد */
async function smartReply(env, chatId, userId, text, lang, tgName, attachment, prefix, userTimeZone) {
  const b = botText(lang);
  let intent = { action: "question" };
  try { intent = await extractIntent(env, text, attachment ? { attachment } : null); } catch {}
  const pre = prefix || "";
  if (intent.action === "add" || intent.action === "done" || intent.action === "assign") {
    if (intent.action === "add" && !(intent.item && intent.item.title)) intent.action = "question";
    else {
      try { await rpc(env, "telegram_draft_put", { p_secret: env.WORKER_SECRET, p_chat_id: String(chatId), p_user_id: userId, p_payload: { type: "action", intent } }); }
      catch { intent.action = "question"; }
    }
    if (intent.action !== "question") {
      try { await sendTelegram(env, chatId, pre + describeAction(lang, intent, userTimeZone), actionButtons(lang)); } catch {}
      return;
    }
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
  try { await sendTelegram(env, chatId, pre + reply, menuKeyboard(lang)); } catch {}
}

/** POST /api/telegram/webhook — كل رسالة تُسجَّل ويُرَدّ عليها: ربط (/start الرمز)، قائمة أزرار، أو دعوة للربط */
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

  // 1) الربط بالرمز — يصل تلقائياً من رمز QR/الرابط العميق (/start الرمز) أو مكتوباً
  const m = text.match(/^\/start\s+([A-Za-z0-9]{4,12})$/) || text.match(/^([A-Za-z0-9]{6,12})$/);
  if (m) {
    userId = await linkChannelByCode(env, "telegram", m[1], chatId);
    action = userId ? "linked" : "bad_code";
    if (userId) await greetLinked(env, chatId, userId, tgLang, tgName);
    else { try { await sendTelegram(env, chatId, channelText(tgLang).badCode); } catch {} }
    await logMessage();
    return json({ ok: true });
  }

  // 2) مشاركة جهة الاتصال (رقم صاحب المحادثة نفسه): الربط بالرقم المسجَّل في الملف الشخصي
  const contact = msg && msg.contact;
  if (contact && contact.phone_number && (!contact.user_id || String(contact.user_id) === String(from.id))) {
    userId = null;
    try { userId = await linkChannelByPhone(env, "telegram", contact.phone_number, chatId); } catch {}
    action = userId ? "linked" : "bad_code";
    if (userId) await greetLinked(env, chatId, userId, tgLang, tgName);
    else { try { await sendTelegram(env, chatId, botText(tgLang).phoneNotFound, { reply_markup: { remove_keyboard: true } }); } catch {} }
    await logMessage();
    return json({ ok: true });
  }

  // 3) رسالة عادية أو زر أو وسائط: سجّلها واعرف صاحب المحادثة (إن كانت مربوطة)
  const voice = msg.voice || msg.audio || msg.video_note || null;
  const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;
  const doc = msg.document || null;
  const caption = String((msg && msg.caption) || "").trim();
  const mediaLabel = voice ? "[voice]" : doc ? `[file: ${doc.file_name || doc.mime_type || "document"}]` : photo ? "[photo]" : "";
  if (mediaLabel && !text) { /* يُسجَّل نوع الوسيط مع تعليقه */ }
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
  if (!owner) { await askToLink(env, chatId, tgLang); return json({ ok: true }); }

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
    // 3-ب) إكسل أو CSV: يُقرأ بمنطق صفحة الاستيراد، ويُعرض ملخصه بزرّي حفظ/إلغاء
    if (doc && ALLOWED_EXT.includes(fileExt(doc.file_name))) {
      let parsed = null;
      try { const { bytes } = await fetchTelegramFile(env, doc.file_id); parsed = parseWorkbook(bytes, doc.file_name || "file.xlsx"); }
      catch (e) { console.error("[telegram] xlsx parse failed:", String((e && e.message) || e).slice(0, 200)); }
      if (!parsed || !parsed.sheets.length) { try { await sendTelegram(env, chatId, b.importNothing, menuKeyboard(lang)); } catch {} return json({ ok: true }); }
      try { await rpc(env, "telegram_draft_put", { p_secret: env.WORKER_SECRET, p_chat_id: String(chatId), p_user_id: owner, p_payload: draftPayload(parsed) }); }
      catch (e) { try { await sendTelegram(env, chatId, b.importFailed, menuKeyboard(lang)); } catch {} return json({ ok: true }); }
      const lines = parsed.sheets.map((sh) => b.importSheet(sh.tracker || sh.name, sh.records.length, sh.skipped)).join("\n");
      const summary = b.importFound(doc.file_name || "file", parsed.sheets.length) + "\n" + lines + "\n\n" + b.importAsk;
      try { await sendTelegram(env, chatId, summary, confirmButtons(lang)); } catch {}
      return json({ ok: true });
    }
    // 3-ج) مستند أو صورة: نقرأه ثم نجيب عن تعليقه (أو نلخّصه)
    const media = doc || photo;
    const name = (doc && doc.file_name) || (photo ? "photo.jpg" : "file");
    const mime = (doc && doc.mime_type) || (photo ? "image/jpeg" : "application/octet-stream");
    let content = null;
    try { content = await readTelegramDocument(env, media, name, mime); } catch (e) { console.error("[telegram] read file failed:", String((e && e.message) || e).slice(0, 200)); }
    if (!content) { try { await sendTelegram(env, chatId, b.fileUnreadable, menuKeyboard(lang)); } catch {} return json({ ok: true }); }
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
  if (data === "act:n") {
    try { await rpc(env, "telegram_draft_take", { p_secret: env.WORKER_SECRET, p_chat_id: String(chatId) }); } catch {}
    try { await sendTelegram(env, chatId, b.importCancelled, menuKeyboard(lang)); } catch {}
    return json({ ok: true });
  }
  if (data === "act:y") {
    let draft = null;
    try { draft = await rpc(env, "telegram_draft_take", { p_secret: env.WORKER_SECRET, p_chat_id: String(chatId) }); } catch {}
    const intent = draft && draft.payload && draft.payload.type === "action" ? draft.payload.intent : null;
    if (!intent || String(draft.user_id) !== String(owner)) { try { await sendTelegram(env, chatId, b.importExpired, menuKeyboard(lang)); } catch {} return json({ ok: true }); }
    await sendChatAction(env, chatId, "typing");
    let out;
    try { out = await executeAction(env, owner, intent, lang); }
    catch (e) { out = { text: /PLAN_LIMIT/.test(String((e && e.message) || e)) ? b.importLimit : b.importFailed, extra: menuKeyboard(lang) }; }
    if (out.keepDraft) { try { await rpc(env, "telegram_draft_put", { p_secret: env.WORKER_SECRET, p_chat_id: String(chatId), p_user_id: owner, p_payload: { type: "action", intent } }); } catch {} }
    try { await sendTelegram(env, chatId, out.text, out.extra); } catch {}
    return json({ ok: true });
  }
  // اختيار القضية/المخالفة التي تتبعها المهمة
  if (data.startsWith("par:")) {
    let draft = null;
    try { draft = await rpc(env, "telegram_draft_take", { p_secret: env.WORKER_SECRET, p_chat_id: String(chatId) }); } catch {}
    const intent = draft && draft.payload && draft.payload.type === "action" ? draft.payload.intent : null;
    if (!intent || String(draft.user_id) !== String(owner)) { try { await sendTelegram(env, chatId, b.importExpired, menuKeyboard(lang)); } catch {} return json({ ok: true }); }
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

/** POST /api/intent { text } — سطر الإدخال الذكي في الموقع: نفس مستخرِج النيّة الذي يستخدمه البوت */
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

/** POST /api/telegram/link { token } — المستخدم المسجَّل يربط محادثة البوت بضغطة الزر الذي أرسله البوت */
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

    // HTTPS إلزامي — الطلبات على http تُحوَّل دائماً (بدل الاعتماد على إعداد اللوحة)
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

    // إثبات ملكية النطاق لجوجل — يُقدَّم من الـ Worker لأن طبقة الأصول تحوّل
    // /x.html إلى /x، وجوجل تطلب الملف على مساره الحرفي بامتداده.
    if (env.GOOGLE_SITE_VERIFICATION_FILE && path === "/" + env.GOOGLE_SITE_VERIFICATION_FILE) {
      return new Response("google-site-verification: " + env.GOOGLE_SITE_VERIFICATION_FILE, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    // Only handle /api/* routes — everything else is static assets
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);

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
        /* قراءة المستندات تستهلك حصة الذكاء، فتلزمها جلسة مستخدم وحدّ معدل كالنيّة */
        const docUser = await authedUser(request, env);
        if (!docUser) return json({ error: "unauthorized" }, 401);
        if (tgAiRateLimited("doc:" + docUser.id)) return json({ error: "rate_limited" }, 429);
        return await handleDocumentAnalyze(request, env);
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
