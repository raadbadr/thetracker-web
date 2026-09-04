// --- عقل البوت: فهم المقصود من أي رسالة وتنفيذه ---------------------------------
// أي مدخل (نص، صوت مفرغ، نص صورة، ملف) يمر على مستخرج نية يعيد JSON: إضافة عنصر،
// إنجاز، إسناد، بحث، أو سؤال. الأفعال الكاتبة تعرض أولا وتنفذ بعد ضغطة تأكيد.
// الإيجاز الصباحي وتجهيز الغد المسائي يخرجان من Cron كل 5 دقائق بحسب توقيت كل مستخدم.
import { rpc, sendTelegram, bot as botText, menuKeyboard, urlButton } from "./notify.js";

const INTENT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const RIYADH = "Asia/Riyadh";
export const DASHBOARD_URL = "https://appmails.net/app/dashboard.html";

const INTENT_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["add", "done", "assign", "search", "question", "none"] },
    item: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["violation", "session", "task"] },
        title: { type: "string" }, due_at: { type: "string" }, amount: { type: "number" },
        client_name: { type: "string" }, case_number: { type: "string" }, violation_number: { type: "string" },
        location: { type: "string" }, notes: { type: "string" },
      },
    },
    query: { type: "string" }, member: { type: "string" }, item_id: { type: "string" },
  },
  required: ["action"],
};

function nowRiyadh() {
  return new Date().toLocaleString("en-GB", { timeZone: RIYADH, weekday: "long", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function intentSystem(ctx) {
  return `You turn one message from a lawyer using TheTracker (cases, court sessions, municipal violations/fines, deadlines) into a single JSON action. Output JSON only.
Now in Riyadh: ${nowRiyadh()} (timezone ${RIYADH}, UTC+3). Resolve relative dates ("Sunday", "tomorrow", "after 3 days", "next week", "10 AM") against this moment; output due_at as ISO 8601 with +03:00 offset. If no time is given for a session use 09:00; for a violation deadline use 23:59.
Actions:
- "add": the user wants to record/remember something new (a session/hearing, a fine/violation, a task, a deadline, a payment). Fill item: kind (violation = fine/مخالفة, session = hearing/جلسة/قضية date, task = anything else), title (short, in the user's language, e.g. "جلسة القضية 4521 — شركة الأبراج"), due_at, amount (number, fine amount), client_name, case_number, violation_number, location (issuing authority/place), notes.
- "done": the user says something is finished/paid/closed. query = the identifying words (case number, violation number, title words, client).
- "assign": the user wants to hand an item to a team member. query = item identifier, member = the person's name or email.
- "search": the user asks where/what/when about specific items ("where is case 4521", "what do we have for Al-Abraj", "sessions next week"). query = the key words only (no stop words).
- "question": general questions about their workload, counts, summaries, advice ("how many overdue", "what's urgent").
- "none": greetings or chit-chat.
${ctx && ctx.attachment ? `The message came with a ${ctx.attachment.kind} whose extracted text is included; if it is a fine, court notice, decision or session notice, prefer "add" with every field you can read from it.` : ""}
Never invent numbers; leave fields absent if unknown.`;
}

/* حل تاريخ ووقت فعليين بتوقيت الرياض من نص عربي: أرقام، أيام الأسبوع، غدا/بعد غد،
   "بعد N يوم" — بلا نموذج لغوي. يطابق افتراضات النظام في intentSystem أعلاه. */
const QUICK_ADD_WEEKDAYS = { "الاحد": 0, "الأحد": 0, "الاثنين": 1, "الإثنين": 1, "الثلاثاء": 2, "الاربعاء": 3, "الأربعاء": 3, "الخميس": 4, "الجمعة": 5, "السبت": 6 };
function riyadhNowParts() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: RIYADH, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const wallClock = {}; parts.forEach((part) => { wallClock[part.type] = part.value; });
  return { year: Number(wallClock.year), month: Number(wallClock.month), day: Number(wallClock.day) };
}
function riyadhWeekday(year, month, day) { return new Date(Date.UTC(year, month - 1, day, -3)).getUTCDay(); }
function addDaysInRiyadh(fromDate, daysToAdd) {
  const shifted = new Date(Date.UTC(fromDate.year, fromDate.month - 1, fromDate.day) + daysToAdd * 86400000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}
function riyadhIso(year, month, day, hour, minute) {
  const pad = (num) => String(num).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+03:00`;
}
function extractTimeOfDay(text, defaultHour, defaultMinute) {
  let match = text.match(/الساعة\s*(\d{1,2})(?::(\d{2}))?\s*(ص|صباحا|صباحا|م|مساء|مساء|am|pm)?/i);
  if (match) return timeOfDayFromMatch(match[1], match[2], match[3]);
  match = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (match) return timeOfDayFromMatch(match[1], match[2], null);
  match = text.match(/\b(\d{1,2})\s*(ص|صباحا|صباحا|م|مساء|مساء|am|pm)\b/i);
  if (match) return timeOfDayFromMatch(match[1], null, match[2]);
  return { hour: defaultHour, minute: defaultMinute };
}
function timeOfDayFromMatch(hourText, minuteText, meridiemMark) {
  let hour = Number(hourText) || 0; const minute = Number(minuteText) || 0; meridiemMark = (meridiemMark || "").toLowerCase();
  if (/^(م|مساء|مساء|pm)$/.test(meridiemMark) && hour < 12) hour += 12;
  if (/^(ص|صباحا|صباحا|am)$/.test(meridiemMark) && hour === 12) hour = 0;
  return { hour, minute };
}
function extractDueDate(text) {
  const now = riyadhNowParts();
  if (/بعد\s*غد/.test(text)) return addDaysInRiyadh(now, 2);
  if (/غدا|غدا|بكرة|بكره/.test(text)) return addDaysInRiyadh(now, 1);
  const daysAfterMatch = text.match(/بعد\s*(\d{1,3})\s*(?:يوم|أيام|ايام)/);
  if (daysAfterMatch) return addDaysInRiyadh(now, Number(daysAfterMatch[1]));
  const isoDateMatch = text.match(/\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/);
  if (isoDateMatch) return { year: Number(isoDateMatch[1]), month: Number(isoDateMatch[2]), day: Number(isoDateMatch[3]) };
  const dayMonthYearMatch = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (dayMonthYearMatch) {
    let fullYear = Number(dayMonthYearMatch[3]); if (fullYear < 100) fullYear += 2000;
    return { year: fullYear, month: Number(dayMonthYearMatch[2]), day: Number(dayMonthYearMatch[1]) };
  }
  for (const weekdayName in QUICK_ADD_WEEKDAYS) {
    if (!text.includes(weekdayName)) continue;
    const targetWeekday = QUICK_ADD_WEEKDAYS[weekdayName];
    let daysUntilTarget = (targetWeekday - riyadhWeekday(now.year, now.month, now.day) + 7) % 7;
    if (daysUntilTarget === 0) daysUntilTarget = 7;
    if (/القادم|القادمة|الجاي|الجاية|بعد اسبوع|بعد أسبوع/.test(text)) daysUntilTarget += 7;
    return addDaysInRiyadh(now, daysUntilTarget);
  }
  return null;
}

/* تصنيف احتياطي بالقواعد: موعد/جلسة/مخالفة مع تاريخ ← تسجيل، حتى لو تعثر النموذج */
const DATE_RX = /(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})|(\d{4}-\d{2}-\d{2})|(الأحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت|غد|بكرة|بعد غد|بعد\s*\d{1,3}\s*(?:يوم|أيام|ايام)|الأسبوع|الشهر|صباح|مساء|الساعة|\d{1,2}\s*(ص|م|صباحا|مساء|AM|PM))/i;
const ADD_RX = /(سجل|سجل|أضف|اضف|ضيف|موعد|جلسة|جلسه|نظر الدعوى|مخالفة|مخالفه|غرامة|مهمة|مهمه|deadline|hearing|session|fine|violation|appointment|add|schedule)/i;
const DONE_RX = /(خلصت|خلصت|أنجزت|انجزت|تم سداد|سددت|أغلقت|اغلقت|انتهت|منجز|done|completed|paid|closed)/i;
const ASSIGN_RX = /(أسند|اسند|حول|حول|كلف|كلف|assign|hand)/i;
const SEARCH_RX = /^(وين|أين|اين|فين|ابحث|دور|ما هي|ماهي|what|where|find|show)/i;
export function heuristicIntent(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (DONE_RX.test(t)) return { action: "done", query: t.replace(DONE_RX, "").replace(/[^\p{L}\p{N}\s\-\/]/gu, " ").trim().slice(0, 80) };
  if (ASSIGN_RX.test(t)) return null; // يحتاج فهم الاسم من النموذج
  if (SEARCH_RX.test(t)) return { action: "search", query: t.replace(SEARCH_RX, "").replace(/[؟?]/g, "").trim().slice(0, 80) };
  if (ADD_RX.test(t) && DATE_RX.test(t)) {
    const kind = /(مخالفة|مخالفه|غرامة|fine|violation)/i.test(t) ? "violation" : /(جلسة|جلسه|نظر الدعوى|hearing|session|قضية|دعوى)/i.test(t) ? "session" : "task";
    const caseNo = (t.match(/(?:دعوى|قضية|القضية|الدعوى|case)\s*(?:رقم|no\.?|#)?\s*([0-9]{2,})/i) || [])[1] || null;
    const violNo = (t.match(/(?:مخالفة|مخالفه)\s*(?:رقم|no\.?|#)?\s*([0-9]{2,})/i) || [])[1] || null;
    const date = extractDueDate(t);
    let due_at = null;
    if (date) { const time = extractTimeOfDay(t, kind === "violation" ? 23 : 9, kind === "violation" ? 59 : 0); due_at = riyadhIso(date.year, date.month, date.day, time.hour, time.minute); }
    return { action: "add", item: { kind, title: t.slice(0, 160), case_number: caseNo, violation_number: violNo, due_at }, confident: !!due_at };
  }
  return null;
}

function firstJson(text) {
  const s = String(text || "");
  const i = s.indexOf("{"); const j = s.lastIndexOf("}");
  if (i === -1 || j <= i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; }
}

/* يستخرج نية واحدة من الرسالة (ومحتوى المرفق إن وجد) */
export async function extractIntent(env, text, ctx) {
  /* نمط واضح بلا مرفق يحتاج قراءة: تاريخ محلول ونوع معروف — لا حاجة للنموذج إطلاقا */
  if (!ctx || !ctx.attachment) {
    const quick = heuristicIntent(text);
    if (quick && (quick.action === "done" || quick.action === "search" || (quick.action === "add" && quick.confident))) return quick;
  }
  if (!env.AI) return heuristicIntent(text) || { action: "question" };
  const user = (ctx && ctx.attachment ? `[${ctx.attachment.kind}: ${ctx.attachment.name}]\n${String(ctx.attachment.content || "").slice(0, 6000)}\n\nUser message: ` : "") + String(text || "");
  const messages = [{ role: "system", content: intentSystem(ctx) }, { role: "user", content: user }];
  let out = null;
  try {
    out = await env.AI.run(INTENT_MODEL, { messages, max_tokens: 500, temperature: 0.1, response_format: { type: "json_schema", json_schema: INTENT_SCHEMA } });
  } catch (e) {
    try { out = await env.AI.run(INTENT_MODEL, { messages, max_tokens: 500, temperature: 0.1 }); } catch (e2) { return { action: "question" }; }
  }
  const raw = out && (typeof out.response === "string" ? out.response : (out.response ? JSON.stringify(out.response) : ""));
  const parsed = (out && typeof out.response === "object" && out.response) || firstJson(raw);
  const guess = heuristicIntent(text);
  if (!parsed || !parsed.action) return guess || { action: "question" };
  // النموذج قال "سؤال/لا شيء" بينما القواعد ترى موعدا أو إنجازا واضحا: القواعد أولى
  if ((parsed.action === "question" || parsed.action === "none") && guess && guess.action !== "search") return guess;
  if (parsed.action === "add" && parsed.item && !parsed.item.due_at && guess && guess.action === "add" && !parsed.item.title) parsed.item.title = guess.item.title;
  return parsed;
}

// ---------- تنسيق ----------
/* اسم اليوم بلغة المستخدم، والتاريخ والوقت بالصيغة القياسية الثابتة
   (dd-MM-yyyy HH:mm، أرقام غربية) — نفس app.fmtDate في الموقع، بلا اختلاف
   بين اللغات في ترتيب الأرقام، مع إضافة مفيدة لسياق المحادثة: اسم اليوم. */
export function fmtWhen(iso, lang, userTimeZone, userHour12) {
  if (!iso) return "-";
  try {
    const date = new Date(iso);
    const weekdayLocale = lang === "ar" ? "ar-SA-u-ca-gregory" : lang === "ur" ? "ur-PK" : lang === "fr" ? "fr-FR" : "en-GB";
    const weekday = new Intl.DateTimeFormat(weekdayLocale, { timeZone: userTimeZone || RIYADH, weekday: "short" }).format(date);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: userTimeZone || RIYADH, numberingSystem: "latn",
      year: "numeric", month: "2-digit", day: "2-digit", hour: userHour12 ? "numeric" : "2-digit", minute: "2-digit", hour12: !!userHour12,
    }).formatToParts(date);
    const by = {};
    parts.forEach((p) => { by[p.type] = p.value; });
    const dayPeriod = String(by.dayPeriod || "").replace(/\s/g, "").toUpperCase();
    const timePart = userHour12 ? `${by.hour}:${by.minute} ${dayPeriod}` : `${by.hour}:${by.minute}`;
    return `${weekday} ${by.day}-${by.month}-${by.year} ${timePart}`;
  } catch { return String(iso); }
}
/* المبلغ القياسي: خانتان عشريتان ثابتتان دائما + فاصلة آلاف — نفس معيار
   باركينزي (formatAmountWestern) ونفس app.fmtAmount في الموقع. */
function money(n) {
  const v = Number(n);
  return isNaN(v) ? "" : new Intl.NumberFormat("en-US", { numberingSystem: "latn", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

export function describeAction(lang, intent, userTimeZone, userHour12) {
  const b = botText(lang);
  const it = intent.item || {};
  if (intent.action === "add") {
    const kind = it.kind === "violation" ? b.kindViolation : it.kind === "session" ? b.kindSession : b.kindTask;
    const lines = [b.actAddTitle, `• ${kind}: ${it.title || "-"}`];
    if (it.due_at) lines.push(`• ${b.fWhen}: ${fmtWhen(it.due_at, lang, userTimeZone, userHour12)}`);
    if (it.client_name) lines.push(`• ${b.fClient}: ${it.client_name}`);
    if (it.case_number) lines.push(`• ${b.fCase}: ${it.case_number}`);
    if (it.violation_number) lines.push(`• ${b.fViolation}: ${it.violation_number}`);
    if (it.amount != null && it.amount !== "") lines.push(`• ${b.fAmount}: ${money(it.amount)}`);
    if (it.location) lines.push(`• ${b.fPlace}: ${it.location}`);
    if (it.notes) lines.push(`• ${b.fNotes}: ${it.notes}`);
    return lines.join("\n") + "\n\n" + b.confirmAsk;
  }
  if (intent.action === "done") return `${b.actDoneTitle} «${intent.query || ""}»\n\n${b.confirmAsk}`;
  if (intent.action === "assign") return `${b.actAssignTitle} «${intent.query || ""}» → ${intent.member || ""}\n\n${b.confirmAsk}`;
  return "";
}

export function formatSearch(lang, query, rows, userTimeZone, userHour12) {
  const b = botText(lang);
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return b.searchNone(query);
  const lines = list.map((r, i) => {
    const bits = [r.title];
    if (r.client_name) bits.push(r.client_name);
    if (r.case_number) bits.push(`${b.fCase} ${r.case_number}`);
    const tail = [r.due_at ? fmtWhen(r.due_at, lang, userTimeZone, userHour12) : null, r.amount != null ? money(r.amount) : null, r.status === "done" ? b.statusDone : null, r.attachments ? `📎${r.attachments}` : null].filter(Boolean).join(" · ");
    const roles = r.roles ? `\n   👥 ${r.roles}` : "";
    return `${i + 1}. ${bits.filter(Boolean).join(" — ")}${r.item_number ? ` (${r.item_number})` : ""}${tail ? `\n   ${tail}` : ""}${roles}`;
  });
  return `${b.searchTitle(query)}\n\n${lines.join("\n")}`;
}

// ---------- تنفيذ الأفعال (بعد التأكيد) ----------
export async function executeAction(env, userId, intent, lang) {
  const b = botText(lang);
  if (intent.action === "add") {
    const r = await rpc(env, "telegram_add_item", { p_secret: env.WORKER_SECRET, p_user_id: userId, p_item: intent.item || {} });
    if (r && r.status === "needs_parent") {
      const cands = Array.isArray(r.candidates) ? r.candidates.slice(0, 6) : [];
      if (!cands.length) return { text: b.noParents, extra: menuKeyboard(lang) };
      const rows = cands.map((c) => [{ text: [c.title, c.client_name, c.case_number ? `${b.fCase} ${c.case_number}` : null].filter(Boolean).join(" — ").slice(0, 60), callback_data: "par:" + c.id }]);
      return { text: b.needsParent, extra: { reply_markup: { inline_keyboard: rows } }, keepDraft: true };
    }
    return { text: b.actSaved(r && r.item_number, (intent.item && intent.item.title) || "", r && r.tracker_name, !!(r && r.tracker_new)), extra: urlButton(b.openDash, DASHBOARD_URL) };
  }
  if (intent.action === "done") {
    const r = await rpc(env, "telegram_complete", { p_secret: env.WORKER_SECRET, p_user_id: userId, p_query: intent.query || "", p_item_id: intent.item_id || null });
    if (!r || r.status === "not_found") return { text: b.notFound(intent.query || ""), extra: menuKeyboard(lang) };
    if (r.status === "ambiguous") {
      const rows = (r.candidates || []).map((c) => `${c.item_number ? c.item_number + " — " : ""}${c.title}${c.client_name ? " — " + c.client_name : ""}`);
      return { text: b.manyFound + "\n" + rows.map((x, i) => `${i + 1}. ${x}`).join("\n") + "\n\n" + b.manyHint, extra: menuKeyboard(lang) };
    }
    return { text: b.actDoneOk(r.item_number, r.title), extra: menuKeyboard(lang) };
  }
  if (intent.action === "assign") {
    const r = await rpc(env, "telegram_assign", { p_secret: env.WORKER_SECRET, p_user_id: userId, p_query: intent.query || "", p_member: intent.member || "" });
    if (!r || r.status === "not_found") return { text: b.notFound(intent.query || ""), extra: menuKeyboard(lang) };
    if (r.status === "ambiguous") return { text: b.manyFound + "\n" + b.manyHint, extra: menuKeyboard(lang) };
    if (r.status === "no_member") return { text: b.noMember(intent.member || ""), extra: menuKeyboard(lang) };
    if (r.member_chat) {
      const ml = botText(r.member_lang || "ar");
      try { await sendTelegram(env, r.member_chat, ml.assignedToYou(r.title, r.item_number), urlButton(ml.openDash, DASHBOARD_URL)); } catch {}
    }
    return { text: b.actAssignOk(r.title, r.member_name, !!r.member_chat), extra: menuKeyboard(lang) };
  }
  return { text: b.help, extra: menuKeyboard(lang) };
}

// ---------- الإيجاز الصباحي وتجهيز الغد ----------
function itemLine(lang, r, b, userTimeZone, userHour12) {
  const bits = [r.due_at ? fmtWhen(r.due_at, lang, userTimeZone, userHour12) : null, r.title, r.client_name, r.case_number ? `${b.fCase} ${r.case_number}` : null].filter(Boolean);
  return `• ${bits.join(" — ")}${r.attachments ? ` 📎${r.attachments}` : ""}`;
}

export function formatDigest(lang, name, d, kind, userTimeZone, userHour12) {
  const b = botText(lang);
  const lines = [];
  if (kind === "evening") {
    lines.push(b.prepTitle(name));
    if (!d.tomorrow.length) lines.push(b.prepNone);
    else {
      d.tomorrow.forEach((r) => lines.push(itemLine(lang, r, b, userTimeZone, userHour12) + (r.attachments ? "" : ` ${b.noFiles}`)));
    }
    return lines.join("\n");
  }
  lines.push(b.digestTitle(name));
  lines.push(d.today.length ? b.digestToday(d.today.length) : b.digestTodayNone);
  d.today.forEach((r) => lines.push(itemLine(lang, r, b, userTimeZone, userHour12)));
  if (d.tomorrow.length) { lines.push(b.digestTomorrow(d.tomorrow.length)); d.tomorrow.forEach((r) => lines.push(itemLine(lang, r, b, userTimeZone, userHour12))); }
  if (d.violations_soon.length) {
    lines.push(b.digestFines(d.violations_soon.length, money(d.violations_soon_total)));
    d.violations_soon.forEach((r) => lines.push(`• ${r.title}${r.client_name ? " — " + r.client_name : ""}${r.amount != null ? " — " + money(r.amount) : ""} — ${fmtWhen(r.due_at, lang, userTimeZone, userHour12)}`));
  }
  if (d.overdue_count) lines.push(b.digestOverdue(d.overdue_count, money(d.overdue_amount)));
  if (d.neglected.length) { lines.push(b.digestNeglected); d.neglected.forEach((r) => lines.push(`• ${r.title}${r.client_name ? " — " + r.client_name : ""} (${r.days} ${b.days})`)); }
  lines.push(b.digestFooter(d.open_total));
  return lines.join("\n");
}

export async function runTelegramDigests(env) {
  if (!env.WORKER_SECRET || !env.TELEGRAM_BOT_TOKEN) return { skipped: "not configured" };
  let targets = [];
  try { targets = await rpc(env, "telegram_digest_targets", { p_secret: env.WORKER_SECRET }); } catch (e) { return { error: String((e && e.message) || e).slice(0, 200) }; }
  let sent = 0;
  for (const t of (Array.isArray(targets) ? targets : [])) {
    try {
      const d = await rpc(env, "telegram_digest", { p_secret: env.WORKER_SECRET, p_user_id: t.user_id });
      if (t.kind === "evening" && (!d || !d.tomorrow || !d.tomorrow.length)) {
        await rpc(env, "telegram_mark_digest", { p_secret: env.WORKER_SECRET, p_user_id: t.user_id, p_kind: "evening" });
        continue; // لا جلسات غدا: لا إزعاج
      }
      const text = formatDigest(t.lang || "ar", t.name || "", d || { today: [], tomorrow: [], violations_soon: [], neglected: [] }, t.kind, t.tz || "Asia/Riyadh", t.time_format === "12");
      await sendTelegram(env, t.chat_id, text, urlButton(botText(t.lang || "ar").openDash, DASHBOARD_URL));
      await rpc(env, "telegram_mark_digest", { p_secret: env.WORKER_SECRET, p_user_id: t.user_id, p_kind: t.kind });
      sent++;
    } catch (e) { console.error("[digest]", String((e && e.message) || e).slice(0, 200)); }
  }
  return { targets: Array.isArray(targets) ? targets.length : 0, sent };
}
