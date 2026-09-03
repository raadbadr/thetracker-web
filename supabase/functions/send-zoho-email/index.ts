// deno-lint-ignore-file no-explicit-any
// TRACKER — نسخة من دالة باركينزي send-zoho-email (Zoho Mail API عبر accounts.zoho.sa)
// الأسرار: ZOHO_REFRESH_TOKEN, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REDIRECT_URI (SUPABASE_URL/ANON_KEY تلقائيان)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tracker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ZOHO_ACCOUNTS_BASE = "https://accounts.zoho.sa";
const ZOHO_MAIL_BASE = "https://mail.zoho.sa";
const FROM_EMAIL = "alerts@appmails.net";

type SendPayload = {
  to: string;
  subject: string;
  message: string;
  from_email: string;
  from_name?: string;
};

function responseJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function pickString(...values: any[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return "";
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

async function getZohoAccessToken(): Promise<string> {
  const tokenRes = await fetch(`${ZOHO_ACCOUNTS_BASE}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: requiredEnv("ZOHO_REFRESH_TOKEN"),
      client_id: requiredEnv("ZOHO_CLIENT_ID"),
      client_secret: requiredEnv("ZOHO_CLIENT_SECRET"),
      grant_type: "refresh_token",
      redirect_uri: requiredEnv("ZOHO_REDIRECT_URI"),
    }),
  });
  const json = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !json?.access_token) throw new Error(`Zoho token failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

function getEmailFromAccount(acc: any): string {
  return String(acc?.primaryEmailAddress ?? acc?.mailboxAddress ?? acc?.emailAddress?.[0]?.mailId ?? acc?.email ?? "").toLowerCase().trim();
}

async function getZohoAccountId(accessToken: string, fromEmail?: string): Promise<string> {
  const res = await fetch(`${ZOHO_MAIL_BASE}/api/accounts`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Zoho accounts failed: ${JSON.stringify(json)}`);

  const accounts = Array.isArray(json?.data) ? json.data : [];
  const want = (fromEmail ?? "").toLowerCase().trim();

  if (want) {
    const match = accounts.find((a: any) => getEmailFromAccount(a) === want);
    if (match) {
      const id = pickString(match.accountId, match.account_id);
      if (id) return id;
    }
  }

  const id = pickString(json?.data?.[0]?.accountId, json?.data?.[0]?.account_id, json?.accounts?.[0]?.accountId);
  if (!id) throw new Error(`No Zoho account found: ${JSON.stringify(json)}`);
  return id;
}


// ─── Send plain email ───
async function sendMail(payload: SendPayload) {
  if (!payload?.to || !payload?.subject || !payload?.message || !payload?.from_email) {
    throw new Error("Missing required fields");
  }

  const accessToken = await getZohoAccessToken();
  const accountId = await getZohoAccountId(accessToken, payload.from_email.trim());

  const sendRes = await fetch(`${ZOHO_MAIL_BASE}/api/accounts/${accountId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fromAddress: payload.from_email.trim(),
      toAddress: payload.to.trim(),
      subject: payload.subject.trim(),
      content: payload.message.trim(),
      mailFormat: "plaintext",
    }),
  });

  const sendJson = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok) throw new Error(`Zoho send failed: ${JSON.stringify(sendJson)}`);
  return { ok: true, result: sendJson };
}

// ─── Reminder email (TRACKER) ───
type ReminderPayload = {
  action: "send-reminder";
  to: string;
  lang?: "ar" | "en" | "fr" | "ur";
  title: string;
  due_at: string;
  tracker_name?: string;
  org_name?: string;
  link?: string;
};

function fmtDue(d: string, lang: string): string {
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return d;
    return new Intl.DateTimeFormat(lang === "ar" ? "ar-SA-u-nu-latn" : lang === "ur" ? "ur-PK-u-nu-latn" : lang === "fr" ? "fr-FR" : "en-GB", {
      timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(dt);
  } catch { return d; }
}

const REMINDER_TEXT: Record<string, { subject: string; heading: string; due: string; tracker: string; open: string; footer: string }> = {
  ar: { subject: "تذكير: {title}", heading: "موعد استحقاق قريب", due: "تاريخ الاستحقاق", tracker: "المتتبع", open: "فتح لوحة التحكم", footer: "وصلك هذا التنبيه لأنك مسؤول عن هذا العنصر في TRACKER." },
  en: { subject: "Reminder: {title}", heading: "Upcoming due date", due: "Due", tracker: "Tracker", open: "Open dashboard", footer: "You received this reminder because you are assigned to this item in TRACKER." },
  fr: { subject: "Rappel : {title}", heading: "Échéance proche", due: "Échéance", tracker: "Suivi", open: "Ouvrir le tableau de bord", footer: "Vous recevez ce rappel car cet élément vous est assigné dans TRACKER." },
  ur: { subject: "یاد دہانی: {title}", heading: "قریب آنے والی آخری تاریخ", due: "آخری تاریخ", tracker: "ٹریکر", open: "ڈیش بورڈ کھولیں", footer: "یہ یاد دہانی آپ کو اس لیے ملی کیونکہ TRACKER میں یہ آئٹم آپ کو تفویض ہے۔" },
};

function buildReminderHTML(p: ReminderPayload): { subject: string; html: string } {
  const lang = p.lang && REMINDER_TEXT[p.lang] ? p.lang : "ar";
  const t = REMINDER_TEXT[lang];
  const rtl = lang === "ar" || lang === "ur";
  const link = p.link || "https://appmails.net/app/dashboard.html";
  const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const html = `<!DOCTYPE html><html dir="${rtl ? "rtl" : "ltr"}" lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f7fc;font-family:Arial,Helvetica,sans-serif;direction:${rtl ? "rtl" : "ltr"};">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e0e8f0;">
<tr><td style="background:#1f2e38;padding:22px 24px;text-align:center;">
  <span style="font-family:'Monoton',Arial,sans-serif;font-size:22px;letter-spacing:3px;color:#ffffff;">T</span><span style="font-family:'Monoton',Arial,sans-serif;font-size:22px;letter-spacing:3px;color:#00a0d2;">RACKER</span>
</td></tr>
<tr><td style="padding:24px;">
  <div style="font-size:18px;font-weight:700;color:#1a1a26;margin-bottom:12px;">${t.heading}</div>
  <div style="font-size:16px;color:#1a1a26;margin-bottom:6px;">${esc(p.title)}</div>
  <div style="font-size:13px;color:#4d4d59;margin-bottom:4px;">${t.due}: <b dir="ltr">${esc(fmtDue(p.due_at, lang))}</b></div>
  ${p.tracker_name ? `<div style="font-size:13px;color:#4d4d59;margin-bottom:4px;">${t.tracker}: ${esc(p.tracker_name)}</div>` : ""}
  ${p.org_name ? `<div style="font-size:13px;color:#4d4d59;margin-bottom:16px;">${esc(p.org_name)}</div>` : "<div style=\"height:12px\"></div>"}
  <a href="${esc(link)}" style="display:inline-block;background:#008cf2;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:12px;font-size:14px;font-weight:600;">${t.open}</a>
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #e8e9ec;text-align:center;font-size:11px;color:#808594;">${t.footer}<br>appmails.net</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: t.subject.replace("{title}", p.title), html };
}

async function sendReminder(p: ReminderPayload) {
  if (!p?.to || !p?.title || !p?.due_at) throw new Error("Missing required fields");
  const { subject, html } = buildReminderHTML(p);
  const accessToken = await getZohoAccessToken();
  const accountId = await getZohoAccountId(accessToken, FROM_EMAIL);
  const sendRes = await fetch(`${ZOHO_MAIL_BASE}/api/accounts/${accountId}/messages`, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fromAddress: FROM_EMAIL, toAddress: p.to.trim(), subject, content: html, mailFormat: "html" }),
  });
  const sendJson = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok) throw new Error(`Zoho send failed: ${JSON.stringify(sendJson)}`);
  return { ok: true, result: sendJson };
}

async function verifyWorkerSecret(secret: string): Promise<boolean> {
  if (!secret || secret.length < 32) return false;
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!url || !anon) return false;
  const res = await fetch(`${url}/rest/v1/rpc/check_worker_secret`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_secret: secret }),
  });
  if (!res.ok) return false;
  const v = await res.json().catch(() => false);
  return v === true;
}

// ─── Router ───
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return responseJson({ error: "Method not allowed" }, 405);

  // يُستدعى من الـ Worker بسرّ مشترك (x-tracker-secret) تتحقق منه قاعدة البيانات
  const secret = req.headers.get("x-tracker-secret") || "";
  if (!(await verifyWorkerSecret(secret))) return responseJson({ error: "Unauthorized" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    if (body?.action === "send-reminder") {
      return responseJson(await sendReminder(body as ReminderPayload), 200);
    }
    // Default: plain email send (نفس واجهة باركينزي)
    return responseJson(await sendMail(body as SendPayload), 200);
  } catch (error) {
    return responseJson({ error: "Unhandled error", details: String(error) }, 500);
  }
});
