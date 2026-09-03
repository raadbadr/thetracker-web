// --- مرسلات القنوات + Cron التنبيهات ----------------------------------------
// البريد: دالة Edge في سوبابيس (send-zoho-email — نسخة باركينزي) عبر Zoho.
// تيليغرام: Bot API. واتساب: Meta Cloud API. SMS: Unifonic أو Twilio.
// كل ما هنا يعمل بمفتاح service role داخل الـ Worker فقط (أبداً في المتصفح).

const NO_CACHE = { cacheTtl: 0, cacheEverything: false };

export function serviceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

const TEXT = {
  ar: { reminder: (t, due, tr) => `⏰ تذكير من TRACKER\n${t}\nالاستحقاق: ${due}${tr ? `\nالمتتبع: ${tr}` : ""}\nhttps://appmails.net/app/dashboard.html`,
        linked: "✅ تم ربط حسابك بـ TRACKER بنجاح. ستصلك التنبيهات هنا.",
        badCode: "الرمز غير صحيح أو منتهٍ. افتح الإعدادات في TRACKER وانسخ الرمز الجديد.",
        test: "✅ رسالة تجريبية من TRACKER: هذه القناة تعمل." },
  en: { reminder: (t, due, tr) => `⏰ TRACKER reminder\n${t}\nDue: ${due}${tr ? `\nTracker: ${tr}` : ""}\nhttps://appmails.net/app/dashboard.html`,
        linked: "✅ Your account is now linked to TRACKER. Reminders will arrive here.",
        badCode: "Invalid or expired code. Open Settings in TRACKER and copy a new code.",
        test: "✅ Test message from TRACKER: this channel works." },
  fr: { reminder: (t, due, tr) => `⏰ Rappel TRACKER\n${t}\nÉchéance : ${due}${tr ? `\nSuivi : ${tr}` : ""}\nhttps://appmails.net/app/dashboard.html`,
        linked: "✅ Votre compte est lié à TRACKER. Les rappels arriveront ici.",
        badCode: "Code invalide ou expiré. Ouvrez Paramètres dans TRACKER et copiez un nouveau code.",
        test: "✅ Message de test TRACKER : ce canal fonctionne." },
  ur: { reminder: (t, due, tr) => `⏰ TRACKER یاد دہانی\n${t}\nآخری تاریخ: ${due}${tr ? `\nٹریکر: ${tr}` : ""}\nhttps://appmails.net/app/dashboard.html`,
        linked: "✅ آپ کا اکاؤنٹ TRACKER سے منسلک ہو گیا۔ یاد دہانیاں یہاں آئیں گی۔",
        badCode: "کوڈ غلط یا ختم ہو چکا ہے۔ TRACKER کی ترتیبات کھول کر نیا کوڈ کاپی کریں۔",
        test: "✅ TRACKER سے آزمائشی پیغام: یہ چینل کام کر رہا ہے۔" },
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
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("email not configured");
  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/send-zoho-email`, {
    method: "POST",
    headers: serviceHeaders(env),
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
  if (!safe) return null;
  const q = `${env.SUPABASE_URL}/rest/v1/channel_links?select=id,user_id&channel=eq.${channel}&verify_code=eq.${safe}&verified_at=is.null&limit=1`;
  const res = await fetch(q, { headers: { ...serviceHeaders(env), Accept: "application/json" }, cf: NO_CACHE });
  const rows = res.ok ? await res.json() : [];
  if (!rows.length) return null;
  const upd = await fetch(`${env.SUPABASE_URL}/rest/v1/channel_links?id=eq.${rows[0].id}`, {
    method: "PATCH",
    headers: { ...serviceHeaders(env), Prefer: "return=minimal" },
    body: JSON.stringify({ external_id: String(externalId), verified_at: new Date().toISOString(), verify_code: null }),
  });
  return upd.ok ? rows[0].user_id : null;
}

async function userLang(env, userId) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?select=lang&id=eq.${userId}&limit=1`, {
    headers: { ...serviceHeaders(env), Accept: "application/json" }, cf: NO_CACHE,
  });
  const rows = res.ok ? await res.json() : [];
  return (rows[0] && rows[0].lang) || "ar";
}

// ---------- Cron: توليد التنبيهات المستحقة وإرسالها ----------
export async function runNotificationCron(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { skipped: "not configured" };
  const H = serviceHeaders(env);

  // 1) توليد التنبيهات من القواعد
  await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/generate_due_notifications`, {
    method: "POST", headers: { ...H, Accept: "application/json" }, body: "{}", cf: NO_CACHE,
  });

  // 2) قراءة المعلّقة المستحقة
  const nowIso = new Date().toISOString();
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/notifications?select=id,org_id,item_id,user_id,channel,payload,items(title,due_at,trackers(name)),organizations(name),profiles:user_id(email,phone,lang)&status=eq.pending&scheduled_at=lte.${encodeURIComponent(nowIso)}&order=scheduled_at.asc&limit=100`,
    { headers: { ...H, Accept: "application/json" }, cf: NO_CACHE }
  );
  if (!res.ok) return { error: `select ${res.status}` };
  const pending = await res.json();
  let sent = 0, failed = 0;

  for (const n of pending) {
    const prof = n.profiles || {};
    const lang = prof.lang || "ar";
    const title = (n.items && n.items.title) || (n.payload && n.payload.title) || "";
    const dueAt = (n.items && n.items.due_at) || (n.payload && n.payload.due_at) || null;
    const trackerName = n.items && n.items.trackers && n.items.trackers.name;
    const orgName = n.organizations && n.organizations.name;
    const text = t(lang).reminder(title, dueAt ? fmtDue(dueAt, lang) : "-", trackerName);
    let status = "sent", error = null;
    try {
      if (n.channel === "email") {
        if (!prof.email) throw new Error("no email");
        await sendEmail(env, { to: prof.email, lang, title, due_at: dueAt, tracker_name: trackerName, org_name: orgName });
      } else {
        const linkRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/channel_links?select=external_id&user_id=eq.${n.user_id}&channel=eq.${n.channel}&verified_at=not.is.null&limit=1`,
          { headers: { ...H, Accept: "application/json" }, cf: NO_CACHE }
        );
        const links = linkRes.ok ? await linkRes.json() : [];
        const ext = links[0] && links[0].external_id;
        if (!ext) { status = "skipped"; error = "channel not linked"; }
        else if (n.channel === "telegram") await sendTelegram(env, ext, text);
        else if (n.channel === "whatsapp") await sendWhatsapp(env, ext, text);
        else if (n.channel === "sms") await sendSms(env, ext, text);
        else { status = "skipped"; error = "unknown channel"; }
      }
    } catch (e) {
      status = "failed"; error = String((e && e.message) || e).slice(0, 300);
    }
    if (status === "sent") sent++; else if (status === "failed") failed++;
    await fetch(`${env.SUPABASE_URL}/rest/v1/notifications?id=eq.${n.id}`, {
      method: "PATCH", headers: { ...H, Prefer: "return=minimal" },
      body: JSON.stringify({ status, error, sent_at: status === "sent" ? new Date().toISOString() : null }),
    });
  }
  return { pending: pending.length, sent, failed };
}
