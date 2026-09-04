/**
 * TheTracker API Worker — proxies Supabase calls server-side.
 * Keys are read from environment variables (Secrets in Cloudflare Dashboard).
 * Static assets are served by the [assets] binding automatically.
 */

import { handleAssistantRequest, askAssistant } from "./assistant.js";
import { handleCalendar } from "./calendar.js";
import { runNotificationCron, linkChannelByCode, notifyTarget, sendTelegram, sendWhatsapp, sendSms, sendEmail, rpc, t as channelText,
         bot as botText, menuKeyboard, menuAction, urlButton, formatItems, telegramItems, linkChannelDirect, linkChannelByPhone, contactKeyboard } from "./notify.js";

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
function handleConfig(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json({ error: "not configured" }, 503);
  return json({
    supabaseUrl: env.SUPABASE_URL,
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    // معرّف عميل جوجل معلومة عامة (يظهر في المتصفح) ويلزم زر الدخول بجوجل
    googleClientId: env.GOOGLE_CLIENT_ID || null,
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
  try {
    if (channel === "email") {
      const to = (target && target.email) || user.email;
      if (!to) return json({ error: "no_email" }, 400);
      await sendEmail(env, { to, lang, title: channelText(lang).test, due_at: new Date().toISOString() });
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
  const name = (target && target.full_name) || fallbackName || "";
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
  const b = botText(lang);
  if (action === "upcoming" || action === "overdue") {
    let rows = [];
    try { rows = await telegramItems(env, userId, action, 8); } catch {}
    const text = formatItems(lang, rows, action === "overdue" ? b.overdueTitle : b.upcomingTitle, action === "overdue" ? b.noOverdue : b.noUpcoming);
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
async function telegramAssistantReply(env, chatId, userId, text) {
  if (tgAiRateLimited(chatId)) return null;
  let target = null, upcoming = [], overdue = [];
  try { target = await notifyTarget(env, userId, "telegram"); } catch {}
  try { upcoming = await telegramItems(env, userId, "upcoming", 15); } catch {}
  try { overdue = await telegramItems(env, userId, "overdue", 15); } catch {}
  const lang = (target && target.lang) || "ar";
  const facts = {
    user: { name: (target && target.full_name) || "", company: (target && target.org_name) || "" },
    now_riyadh: new Date().toLocaleString("en-GB", { timeZone: "Asia/Riyadh" }),
    upcoming_items: upcoming, overdue_items: overdue,
    counts: { upcoming: Array.isArray(upcoming) ? upcoming.length : 0, overdue: Array.isArray(overdue) ? overdue.length : 0 },
    dashboard_url: "https://appmails.net/app/dashboard.html",
  };
  const system = `أنت مساعد TheTracker داخل تلغرام، تخدم المستخدم ${facts.user.name || ""}${facts.user.company ? ` من شركة «${facts.user.company}»` : ""}.
التراكر منصة لتتبع القضايا والمخالفات والعقود والمواعيد من ملفات إكسل، مع تقويم وتنبيهات.
قواعدك:
- أجب بـ${TG_LANG_NAMES[lang] || "العربية الفصحى"} دائماً، باختصار وودّ ومباشرة، والأرقام غربية (1234567890) والتواريخ بتوقيت الرياض.
- اعتمد على الحقائق أدناه وحدها (مواعيده القادمة والمتأخرة وعدّها)؛ إن سُئلت عن شيء ليس فيها قل إنك لا تراه هنا ووجّهه إلى لوحة التحكم.
- أنت للقراءة فقط: لا تعِد بتعديل أو حذف أو إضافة شيء؛ لأي تعديل وجّهه إلى لوحة التحكم: ${facts.dashboard_url}
- لا تختلق أرقاماً أو قضايا أو تواريخ. لا تخرج عن مواضيع التراكر.
الحقائق (JSON): ${JSON.stringify(facts).slice(0, 12000)}`;
  return askAssistant(env, system, [{ role: "user", content: text }]);
}

/** POST /api/telegram/webhook — كل رسالة تُسجَّل ويُرَدّ عليها: ربط (/start الرمز)، قائمة أزرار، أو دعوة للربط */
async function handleTelegramWebhook(request, env) {
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const got = request.headers.get("x-telegram-bot-api-secret-token") || "";
    if (got !== env.TELEGRAM_WEBHOOK_SECRET) return json({ ok: false }, 401);
  }
  let update;
  try { update = await request.json(); } catch { return json({ ok: true }); }
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

  // 3) رسالة عادية أو زر: سجّلها واعرف صاحب المحادثة (إن كانت مربوطة)
  const owner = await logMessage();
  const menu = menuAction(text);
  if (!owner) { await askToLink(env, chatId, tgLang); return json({ ok: true }); }
  if (menu) { await runMenu(env, chatId, owner, menu); return json({ ok: true }); }
  if (text === "/start") { await greetLinked(env, chatId, owner, tgLang, tgName); return json({ ok: true }); }
  // نص حر من مستخدم مربوط: المساعد الذكي يجيب من بياناته؛ وإن تعذّر، رسالة الحالة المعتادة
  let target = null;
  try { target = await notifyTarget(env, owner, "telegram"); } catch {}
  const lang = (target && target.lang) || tgLang;
  let reply = null;
  try { reply = await telegramAssistantReply(env, chatId, owner, text); } catch {}
  if (!reply) reply = channelText(lang).alreadyLinked((target && target.full_name) || tgName);
  try { await sendTelegram(env, chatId, reply, menuKeyboard(lang)); } catch {}
  return json({ ok: true });
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
      if (path === "/api/config" && request.method === "GET") return handleConfig(env);
      if (path === "/api/stats" && request.method === "GET") return await handleStats(env);
      if (path === "/api/assistant" && request.method === "POST") return await handleAssistantRequest(request, env);
      if (path === "/api/contact" && request.method === "POST") return await handleContact(request, env);
      if (path === "/api/notify/test" && request.method === "POST") return await handleNotifyTest(request, env);
      if (path === "/api/telegram/webhook" && request.method === "POST") return await handleTelegramWebhook(request, env);
      if (path === "/api/telegram/link" && request.method === "POST") return await handleTelegramLink(request, env);
      if (path === "/api/whatsapp/webhook") return await handleWhatsappWebhook(request, env, url);
      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: "server error" }, 500);
    }
  },

  // Cron كل 5 دقائق: توليد التنبيهات المستحقة وإرسالها عبر القنوات
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runNotificationCron(env).then((r) => console.log("[cron]", JSON.stringify(r))).catch((e) => console.error("[cron]", String(e))));
  },
};
