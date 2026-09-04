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
        linked: (name, org) => `مرحباً ${name || ""} 👋\n✅ تم ربط حسابك بـ TheTracker بنجاح.${org ? `\nالشركة: ${org}` : ""}\nستصلك تنبيهات مواعيدك هنا.`,
        badCode: "الرمز غير صحيح أو منتهٍ. افتح الإعدادات في TheTracker وانسخ الرمز الجديد.",
        needCode: "لربط حسابك: افتح الإعدادات في TheTracker ← تيليجرام ← «توليد رمز»، ثم أرسل الرمز هنا أو امسح رمز QR.",
        alreadyLinked: (name) => `حسابك مرتبط${name ? ` يا ${name}` : ""} ✅\nستصلك تنبيهات مواعيدك هنا تلقائياً.`,
        test: "✅ رسالة تجريبية من TheTracker: هذه القناة تعمل." },
  en: { reminder: (t, due, tr) => `⏰ TheTracker reminder\n${t}\nDue: ${due}${tr ? `\nTracker: ${tr}` : ""}\nhttps://appmails.net/app/dashboard.html`,
        linked: (name, org) => `Hello ${name || ""} 👋\n✅ Your TheTracker account is now linked.${org ? `\nCompany: ${org}` : ""}\nYour reminders will arrive here.`,
        badCode: "Invalid or expired code. Open Settings in TheTracker and copy a new code.",
        needCode: "To link your account: open Settings in TheTracker → Telegram → “Generate code”, then send the code here or scan the QR code.",
        alreadyLinked: (name) => `Your account is linked${name ? `, ${name}` : ""} ✅\nYour reminders will arrive here automatically.`,
        test: "✅ Test message from TheTracker: this channel works." },
  fr: { reminder: (t, due, tr) => `⏰ Rappel TheTracker\n${t}\nÉchéance : ${due}${tr ? `\nSuivi : ${tr}` : ""}\nhttps://appmails.net/app/dashboard.html`,
        linked: (name, org) => `Bonjour ${name || ""} 👋\n✅ Votre compte TheTracker est maintenant lié.${org ? `\nSociété : ${org}` : ""}\nVos rappels arriveront ici.`,
        badCode: "Code invalide ou expiré. Ouvrez Paramètres dans TheTracker et copiez un nouveau code.",
        needCode: "Pour lier votre compte : ouvrez Paramètres dans TheTracker → Telegram → « Générer un code », puis envoyez le code ici ou scannez le QR code.",
        alreadyLinked: (name) => `Votre compte est lié${name ? `, ${name}` : ""} ✅\nVos rappels arriveront ici automatiquement.`,
        test: "✅ Message de test TheTracker : ce canal fonctionne." },
  ur: { reminder: (t, due, tr) => `⏰ TheTracker یاد دہانی\n${t}\nآخری تاریخ: ${due}${tr ? `\nٹریکر: ${tr}` : ""}\nhttps://appmails.net/app/dashboard.html`,
        linked: (name, org) => `خوش آمدید ${name || ""} 👋\n✅ آپ کا TheTracker اکاؤنٹ منسلک ہو گیا۔${org ? `\nکمپنی: ${org}` : ""}\nآپ کی یاد دہانیاں یہاں آئیں گی۔`,
        badCode: "کوڈ غلط یا ختم ہو چکا ہے۔ TheTracker کی ترتیبات کھول کر نیا کوڈ کاپی کریں۔",
        needCode: "اکاؤنٹ منسلک کرنے کے لیے: TheTracker کی ترتیبات ← ٹیلیگرام ← «کوڈ بنائیں»، پھر کوڈ یہاں بھیجیں یا QR کوڈ اسکین کریں۔",
        alreadyLinked: (name) => `${name ? name + "، " : ""}آپ کا اکاؤنٹ منسلک ہے ✅\nآپ کی یاد دہانیاں یہاں خود بخود آئیں گی۔`,
        test: "✅ TheTracker سے آزمائشی پیغام: یہ چینل کام کر رہا ہے۔" },
};
export function t(lang) { return TEXT[lang] || TEXT.ar; }

// ---------- بوت تلغرام: قائمة الأزرار ونصوصها ----------
const BOT = {
  ar: { upcoming: "📅 مواعيدي القادمة", overdue: "⏰ المتأخرات", dashboard: "🌐 لوحة التحكم", help: "❓ مساعدة",
        linkBtn: "🔗 ربط حسابي", openDash: "فتح لوحة التحكم",
        phoneBtn: "📱 ربط برقم جوالي", phoneHint: "أو شارك رقم جوالك المسجَّل في TheTracker بالزر بالأسفل فيتم الربط فوراً.",
        phoneNotFound: "لم نجد حساباً بهذا الرقم. سجّل الدخول إلى الموقع واضغط زر الربط أعلاه.",
        linkIntro: "أهلاً بك في TheTracker 👋\nاضغط الزر لربط هذا البوت بحسابك: تُفتح صفحة الإعدادات في الموقع ويتم الربط تلقائياً.",
        menuHint: "اختر من الأزرار بالأسفل:",
        upcomingTitle: "📅 مواعيدك القادمة:", overdueTitle: "⏰ المواعيد المتأخرة:",
        noUpcoming: "لا مواعيد قادمة 👌", noOverdue: "لا مواعيد متأخرة 👌",
        help: "ستصلك هنا تذكيرات مواعيدك تلقائياً حسب قواعد التذكير في الإعدادات.\nالأزرار: مواعيدك القادمة، المتأخرات، ولوحة التحكم." },
  en: { upcoming: "📅 Upcoming", overdue: "⏰ Overdue", dashboard: "🌐 Dashboard", help: "❓ Help",
        linkBtn: "🔗 Link my account", openDash: "Open dashboard",
        phoneBtn: "📱 Link with my phone number", phoneHint: "Or share the phone number registered in TheTracker with the button below — the link completes instantly.",
        phoneNotFound: "No account has this number. Sign in on the website and tap the link button above.",
        linkIntro: "Welcome to TheTracker 👋\nTap the button to link this bot to your account: the settings page opens and the link completes automatically.",
        menuHint: "Pick an option below:",
        upcomingTitle: "📅 Your upcoming due dates:", overdueTitle: "⏰ Overdue items:",
        noUpcoming: "Nothing upcoming 👌", noOverdue: "Nothing overdue 👌",
        help: "Your reminders arrive here automatically, following the reminder rules in Settings.\nButtons: upcoming, overdue, dashboard." },
  fr: { upcoming: "📅 À venir", overdue: "⏰ En retard", dashboard: "🌐 Tableau de bord", help: "❓ Aide",
        linkBtn: "🔗 Lier mon compte", openDash: "Ouvrir le tableau de bord",
        phoneBtn: "📱 Lier avec mon numéro", phoneHint: "Ou partagez le numéro enregistré dans TheTracker avec le bouton ci-dessous : la liaison est immédiate.",
        phoneNotFound: "Aucun compte avec ce numéro. Connectez-vous sur le site et appuyez sur le bouton de liaison ci-dessus.",
        linkIntro: "Bienvenue sur TheTracker 👋\nAppuyez sur le bouton pour lier ce bot à votre compte : la page Paramètres s’ouvre et la liaison se fait automatiquement.",
        menuHint: "Choisissez une option ci-dessous :",
        upcomingTitle: "📅 Vos échéances à venir :", overdueTitle: "⏰ Éléments en retard :",
        noUpcoming: "Rien à venir 👌", noOverdue: "Rien en retard 👌",
        help: "Vos rappels arrivent ici automatiquement selon les règles définies dans Paramètres.\nBoutons : à venir, en retard, tableau de bord." },
  ur: { upcoming: "📅 آنے والی تاریخیں", overdue: "⏰ تاخیر شدہ", dashboard: "🌐 ڈیش بورڈ", help: "❓ مدد",
        linkBtn: "🔗 میرا اکاؤنٹ منسلک کریں", openDash: "ڈیش بورڈ کھولیں",
        phoneBtn: "📱 فون نمبر سے منسلک کریں", phoneHint: "یا نیچے دیے بٹن سے TheTracker میں رجسٹرڈ فون نمبر شیئر کریں — منسلکی فوراً مکمل ہو جائے گی۔",
        phoneNotFound: "اس نمبر سے کوئی اکاؤنٹ نہیں ملا۔ ویب سائٹ پر سائن ان کر کے اوپر والا لنک بٹن دبائیں۔",
        linkIntro: "TheTracker میں خوش آمدید 👋\nاس بوٹ کو اپنے اکاؤنٹ سے منسلک کرنے کے لیے بٹن دبائیں: ترتیبات کا صفحہ کھلے گا اور منسلکی خود بخود مکمل ہو جائے گی۔",
        menuHint: "نیچے دیے گئے بٹنوں میں سے چنیں:",
        upcomingTitle: "📅 آپ کی آنے والی تاریخیں:", overdueTitle: "⏰ تاخیر شدہ آئٹمز:",
        noUpcoming: "کوئی آنے والی تاریخ نہیں 👌", noOverdue: "کوئی تاخیر نہیں 👌",
        help: "آپ کی یاد دہانیاں ترتیبات کے اصولوں کے مطابق یہاں خود بخود آئیں گی۔\nبٹن: آنے والی، تاخیر شدہ، ڈیش بورڈ۔" },
};
export function bot(lang) { return BOT[lang] || BOT.ar; }

/* لوحة الأزرار الدائمة أسفل المحادثة */
export function menuKeyboard(lang) {
  const b = bot(lang);
  return { reply_markup: { keyboard: [[{ text: b.upcoming }, { text: b.overdue }], [{ text: b.dashboard }, { text: b.help }]], resize_keyboard: true, is_persistent: true } };
}

/* أي زر ضغطه المستخدم بأي لغة؟ يعيد upcoming/overdue/dashboard/help أو null */
export function menuAction(text) {
  const s = String(text || "").trim();
  if (/^\/(upcoming|overdue|dashboard|help|menu)$/.test(s)) return s.slice(1);
  for (const lang of Object.keys(BOT)) {
    for (const key of ["upcoming", "overdue", "dashboard", "help"]) if (BOT[lang][key] === s) return key;
  }
  return null;
}

/* زر يفتح رابطاً (لوحة التحكم أو صفحة الربط) */
export function urlButton(label, url) {
  return { reply_markup: { inline_keyboard: [[{ text: label, url }]] } };
}

/* قائمة مواعيد بنص مقروء */
export function formatItems(lang, rows, title, emptyText) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return emptyText;
  const lines = list.map((r, i) => {
    const who = r.client_name ? ` — ${r.client_name}` : "";
    const num = r.case_number ? ` (${r.case_number})` : "";
    const tr = r.tracker_name ? ` · ${r.tracker_name}` : "";
    return `${i + 1}. ${r.title || ""}${who}${num}\n   ${r.due_at ? fmtDue(r.due_at, lang) : "-"}${tr}`;
  });
  return `${title}\n\n${lines.join("\n")}`;
}

export async function telegramItems(env, userId, mode, limit) {
  return rpc(env, "telegram_items", { p_secret: env.WORKER_SECRET, p_user_id: userId, p_mode: mode, p_limit: limit || 5 });
}

export async function linkChannelByPhone(env, channel, phone, externalId) {
  return rpc(env, "link_channel_by_phone", { p_secret: env.WORKER_SECRET, p_channel: channel, p_phone: String(phone || ""), p_external_id: String(externalId) });
}

/* لوحة بزر واحد يطلب مشاركة رقم الجوال (تختفي بعد الاستخدام) */
export function contactKeyboard(lang) {
  return { reply_markup: { keyboard: [[{ text: bot(lang).phoneBtn, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } };
}

export async function linkChannelDirect(env, userId, channel, externalId) {
  return rpc(env, "link_channel_direct", { p_secret: env.WORKER_SECRET, p_user_id: userId, p_channel: channel, p_external_id: String(externalId) });
}

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

export async function sendTelegram(env, chatId, text, extra) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("telegram not configured");
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, ...(extra || {}) }),
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
