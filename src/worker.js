/**
 * TheTracker API Worker — proxies Supabase calls server-side.
 * Keys are read from environment variables (Secrets in Cloudflare Dashboard).
 * Static assets are served by the [assets] binding automatically.
 */

import { handleAssistantRequest } from "./assistant.js";
import { handleCalendar } from "./calendar.js";
import { runNotificationCron, linkChannelByCode, notifyTarget, sendTelegram, sendWhatsapp, sendSms, sendEmail, t as channelText } from "./notify.js";

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

/** POST /api/telegram/webhook — /start CODE يربط الحساب */
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
  if (!chatId || !text) return json({ ok: true });
  const m = text.match(/^\/start\s+([A-Za-z0-9]{4,12})$/) || text.match(/^([A-Za-z0-9]{6,12})$/);
  if (m) {
    const userId = await linkChannelByCode(env, "telegram", m[1], chatId);
    const lang = "ar";
    try { await sendTelegram(env, chatId, userId ? channelText(lang).linked : channelText(lang).badCode); } catch {}
  }
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

    // تقويم ICS — /api/calendar/<token>.ics
    const cal = path.match(/^\/api\/calendar\/([a-f0-9]{16,64})\.ics$/i);
    if (cal && request.method === "GET") {
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return new Response("not configured", { status: 503 });
      return handleCalendar(cal[1], env);
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
