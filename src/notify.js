// --- مرسلات القنوات + Cron التنبيهات ----------------------------------------
// البريد: دالة Edge في سوبابيس (send-zoho-email — نسخة باركينزي) عبر Zoho.
// تيليغرام: Bot API. واتساب: Meta Cloud API. SMS: Unifonic أو Twilio.
// الـ Worker لا يحمل مفتاح service role: يستخدم مفتاح anon + سرّ مشترك
// (WORKER_SECRET) تتحقق منه دوال SECURITY DEFINER في قاعدة البيانات.

const NO_CACHE = { cacheTtl: 0, cacheEverything: false };

export function anonHeaders(env) {
  return {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function rpc(env, name, args) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: anonHeaders(env),
    body: JSON.stringify(args || {}),
    cf: NO_CACHE,
  });
  if (!res.ok) throw new Error(`rpc ${name} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

const TEXT = {
  ar: { reminder: (t, due, tr) => `⏰ تذكير من TheTracker\n${t}\nالاستحقاق: ${due}${tr ? `\nالسجل: ${tr}` : ""}\nhttps://appmails.net/app/dashboard.html`,
        linked: "✅ تم ربط حسابك بـ TheTracker بنجاح. ستصلك التنبيهات هنا.",
        badCode: "الرمز غير صحيح أو منتهٍ. افتح الإعدادات في TheTracker وانسخ الرمز الجديد.",
        test: "✅ رسالة تجريبية من TheTracker: هذه القناة تعمل." },
  en: { reminder: (t, due, tr) => `⏰ TheTracker reminder\n${t}\nDue: ${due}${tr ? `\nTracker: ${tr}` : ""}\nhttps://appmails.net/app/dashboard.html`,
        linked: "✅ Your account is now linked to TheTracker. Reminders will arrive here.",
        badCode: "Invalid or expired code. Open Settings in TheTracker and copy a new code.",
        test: "✅ Test message from TheTracker: this channel works." },
  fr: { reminder: (t, due, tr) => `⏰ Rappel TheTracker\n${t}\nÉchéance : ${due}${tr ? `\nSuivi : ${tr}` : ""}\nhttps://appmails.net/app/dashboard.html`,
        linked: "✅ Votre compte est lié à TheTracker. Les rappels arriveront ici.",
        badCode: "Code invalide ou expiré. Ouvrez Paramètres dans TheTracker et copiez un nouveau code.",
        test: "✅ Message de test TheTracker : ce canal fonctionne." },
  ur: { reminder: (t, due, tr) => `⏰ TheTracker یاد دہانی\n${t}\nآخری تاریخ: ${due}${tr ? `\nٹریکر: ${tr}` : ""}\nhttps://appmails.net/app/dashboard.html`,
        linked: "✅ آپ کا اکاؤنٹ TheTracker سے منسلک ہو گیا۔ یاد دہانیاں یہاں آئیں گی۔",
        badCode: "کوڈ غلط یا ختم ہو چکا ہے۔ TheTracker کی ترتیبات کھول کر نیا کوڈ کاپی کریں۔",
        test: "✅ TheTracker سے آزمائشی پیغام: یہ چینل کام کر رہا ہے۔" },
};
export function t(lang) { return TEXT[lang] || TEXT.ar; }

function fmtDue(iso, lang) {
  try {
    return new Intl.DateTimeFormat(lang === "ar" ? "ar-SA-u-nu-latn" : lang === "ur" ? "ur-PK-u-nu-latn" : lang === "fr" ? "fr-FR" : "en-GB", {
      timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
  } catch { return String(iso); }
}

// ---------- القنوات ----------
export async function sendEmail(env, { to, lang, title, due_at, tracker_name, org_name }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.WORKER_SECRET) throw new Error("email not configured");
  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/send-zoho-email`, {
    method: "POST",
    headers: { ...anonHeaders(env), "x-tracker-secret": env.WORKER_SECRET },
    body: JSON.stringify({ action: "send-reminder", to, lang, title, due_at, tracker_name, org_name }),
    cf: NO_CACHE,
  });
  if (!res.ok) throw new Error(`email ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

export async function sendTelegram(env, chatId, text) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("telegram not configured");
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

export async function sendWhatsapp(env, phone, text) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) throw new Error("whatsapp not configured");
  const res = await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: String(phone).replace(/[^\d]/g, ""), type: "text", text: { body: text } }),
  });
  if (!res.ok) throw new Error(`whatsapp ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

export async function sendSms(env, phone, text) {
  const provider = (env.SMS_PROVIDER || "").toLowerCase();
  if (provider === "twilio") {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) throw new Error("sms not configured");
    const body = new URLSearchParams({ To: phone, From: env.TWILIO_FROM, Body: text });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`sms ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return true;
  }
  if (provider === "unifonic") {
    if (!env.UNIFONIC_APPSID || !env.UNIFONIC_SENDER) throw new Error("sms not configured");
    const body = new URLSearchParams({ AppSid: env.UNIFONIC_APPSID, SenderID: env.UNIFONIC_SENDER, Recipient: String(phone).replace(/[^\d]/g, ""), Body: text });
    const res = await fetch("https://el.cloud.unifonic.com/rest/SMS/messages", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
    });
    if (!res.ok) throw new Error(`sms ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return true;
  }
  throw new Error("sms not configured");
}

// ---------- ربط القنوات (رمز تحقق من الإعدادات) ----------
export async function linkChannelByCode(env, channel, code, externalId) {
  const safe = String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!safe || !env.WORKER_SECRET) return null;
  try {
    const userId = await rpc(env, "link_channel", { p_secret: env.WORKER_SECRET, p_channel: channel, p_code: safe, p_external_id: String(externalId) });
    return userId || null;
  } catch { return null; }
}

export async function notifyTarget(env, userId, channel) {
  return rpc(env, "notify_target", { p_secret: env.WORKER_SECRET, p_user_id: userId, p_channel: channel });
}

// ---------- Cron: توليد التنبيهات المستحقة وإرسالها ----------
export async function runNotificationCron(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.WORKER_SECRET) return { skipped: "not configured" };

  let pending;
  try {
    pending = await rpc(env, "cron_pending_notifications", { p_secret: env.WORKER_SECRET });
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 200) };
  }
  if (!Array.isArray(pending)) pending = [];
  let sent = 0, failed = 0;

  for (const n of pending) {
    const lang = n.lang || "ar";
    const text = t(lang).reminder(n.title || "", n.due_at ? fmtDue(n.due_at, lang) : "-", n.tracker_name);
    let status = "sent", error = null;
    try {
      if (n.channel === "email") {
        if (!n.email) throw new Error("no email");
        await sendEmail(env, { to: n.email, lang, title: n.title, due_at: n.due_at, tracker_name: n.tracker_name, org_name: n.org_name });
      } else if (!n.external_id) {
        status = "skipped"; error = "channel not linked";
      } else if (n.channel === "telegram") await sendTelegram(env, n.external_id, text);
      else if (n.channel === "whatsapp") await sendWhatsapp(env, n.external_id, text);
      else if (n.channel === "sms") await sendSms(env, n.external_id, text);
      else { status = "skipped"; error = "unknown channel"; }
    } catch (e) {
      status = "failed"; error = String((e && e.message) || e).slice(0, 300);
    }
    if (status === "sent") sent++; else if (status === "failed") failed++;
    try {
      await rpc(env, "cron_mark_notification", { p_secret: env.WORKER_SECRET, p_id: n.id, p_status: status, p_error: error });
    } catch {}
  }
  return { pending: pending.length, sent, failed };
}
