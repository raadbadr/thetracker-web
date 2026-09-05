/* وكيل تراكر على تيليغرام: نموذج لغوي يستعمل أدوات MCP نفسها (بحث، مواعيد، إضافة، إنجاز، إسناد) باسم المستخدم المرتبط،
   ويعرف من يخاطب (اسمه وشركته) ويتذكر آخر الرسائل. الردود بلغة الواجهة بلا تشكيل وبأرقام غربية. */
import { rpc, dmy, VERBS, writeGate } from "./notify.js";
import { TOOLS, callTool } from "./mcp.js";
import { understand, composeAnswer, normalize } from "./telegram-understand.js";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const LANG_NAMES = { ar: "العربية الفصحى", en: "English", fr: "français", ur: "اردو" };
const AGENT_TOOLS = TOOLS.filter((t) => ["tracker_company", "tracker_items", "tracker_search", "tracker_list", "tracker_add", "tracker_complete", "tracker_assign", "tracker_team", "tracker_remind", "tracker_expenses", "tracker_overview", "tracker_platform"].includes(t.name));

export { VERBS, writeGate } from "./notify.js";

function systemPrompt(ctx) {
  const lang = ctx.lang || "ar";
  return [
    `أنت مساعد TheTracker الذكي داخل تيليغرام. تخاطب الآن: ${ctx.name || "مستخدم مرتبط"}${ctx.orgName ? ` من شركة «${ctx.orgName}»` : ""}. أنت تعرفه وتعمل على حسابه بصلاحياته، فلا تسأله من هو ولا تطلب ربطا.`,
    `التاريخ والوقت الآن (الرياض): ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Riyadh" })}.`,
    `TheTracker منصة لتتبع القضايا والمخالفات والمهام والمستندات والمواعيد للشركات ومكاتب المحاماة.`,
    `قواعدك: أجب بلغة رسالة المستخدم نفسها (عربية، إنجليزية، فرنسية أو أردو)، وإن لم تتضح فبـ${LANG_NAMES[lang] || LANG_NAMES.ar}. بلا تشكيل، والأرقام غربية (1234567890)، بإيجاز ووضوح ومباشرة كزميل عمل محترف.`,
    `لا تحيي ولا تذكر اسمه أو شركته في كل رد؛ المحادثة مستمرة، فادخل في الجواب مباشرة. لا تكرر جملة قلتها قبل قليل، ولا تختم بعبارات مجاملة.`,
    `أسئلة الفريق (من المسؤول عن…، ماذا على فلان، عبء الأعضاء) من tracker_team. طلب «ذكرني قبل … بـ يوم/3 أيام/أسبوع» = tracker_remind بالعنصر والمهلة كما كتبها.`,
    `أسئلة بيانات الشركة (رقم السجل التجاري، الرقم الضريبي، الآيبان، العنوان، الباقة، الأوراق المرفوعة) تجاب من tracker_company بالرقم نفسه كما هو مسجل.`,
    `كلمة واحدة تكفي: «قضايا» = tracker_items(case)، «مخالفات» = (violation)، «مهام» = (task)، «مستندات» = (document)، «المنجز» = (status done)، «مواعيد/القادم» = tracker_list(upcoming)، «متأخر» = tracker_list(overdue)، «الكل/ملخص/وضعنا» = tracker_overview، «مصاريف/المصاريف/كم صرفنا» = tracker_expenses(period)، أي اسم أو رقم = tracker_search. والكلام الطويل تفهم منه المطلوب نفسه.`,
    `إن لم يوجد شيء من النوع المطلوب فلا تكرر النفي نفسه: انقل ما تقوله الأداة عن الموجود فعلا (المنجز سابقا، ما يحمل الكلمة في عنوانه، النظرة العامة على المتتبعات) لكي يفهم المستخدم صورة بياناته. «بشكل عام» أو «السابقة» أو «الكل» تعني status=all.`,
    `لا تخترع شيئا أبدا: كل رقم وكل اسم في ردك يجب أن يكون قد جاء حرفيا من نتيجة أداة في هذه المحادثة. إن لم تعد الأداة المعلومة فقل إنك لا تملكها ولا تقدر عليها، ولا تخمن عددا ولا اسما ولا تاريخا. أسئلة المنصة كلها (عدد المسجلين في الموقع، كل المستخدمين، الاشتراكات) من tracker_platform، وهي لمدير المنصة وحده.`,
    `لا تذكر أبدا أسماء حقول أو مفاتيح تقنية (مثل due_at أو client_name) ولا JSON ولا معرفات داخلية ولا صيغ تقنية (ISO 8601)؛ تكلم بلغة إنسان عادي فقط.`,
    `لا تعرض الرقم القياسي الداخلي (ITM-…) للمستخدم أبدا؛ اعرض رقم السجل أو القضية أو المخالفة أو الورقة نفسه كما هو مسجل، وتواريخ الإصدار والانتهاء.`,
    `صيغة الرد: مختصرة جدا وبلغة إنسان. للقوائم سطر لكل عنصر بلا مقدمة ولا خاتمة، منسوخ من نص الأداة كما هو: الورقة الرسمية «نوعها — رقمها — إصدار يوم-شهر-سنة — ينتهي يوم-شهر-سنة»، والقضية أو المخالفة أو المهمة «العنوان — قضية/مخالفة رقم … — العميل — الموعد». الرقم الوحيد الذي يظهر هو رقم الورقة أو القضية أو المخالفة كما هو مسجل؛ أي رمز يبدأ بـ ITM أو ORG أو USR ممنوع. التواريخ يوم-شهر-سنة (مثل 31-10-2026) بلا وقت إلا إن كان موعدا بساعة. إن لم يوجد شيء فجملة واحدة. للأسئلة: الجواب فقط. لا شرح لما فعلت ولا ذكر لأسماء الأدوات.`,
    `لكل سؤال عن بياناته (قضايا، مخالفات، مهام، مواعيد، متأخر، عميل، رقم) استعمل الأدوات ولا تخمن ولا تختلق. tracker_list للمواعيد القادمة والمتأخرة، tracker_search للبحث بأي كلمة أو رقم.`,
    `حين يطلب إضافة أو إنجاز أو إسناد بصيغة واضحة نفذ بالأداة مباشرة ثم أخبره بما تم بعنوان العنصر (لا برقمه القياسي). إن كانت المهمة بلا قضية أو مخالفة تنتمي إليها فاعرض المرشحين الذين تعيدهم الأداة واطلب اختيار واحد. إن كان الطلب غامضا اسأل سؤالا واحدا قصيرا.`,
    `الإنجاز والإضافة والإسناد لا تكون إلا بطلب صريح في رسالة المستخدم الحالية (أنجزت، أقفل، أضف، أسند…)، ولا ينفذ شيء قبل أن يؤكد بزر. كلمات المجاملة والتعليق (أحسنت، شكرا، ممتاز، تمام) ليست أوامر: رد عليها بجملة قصيرة فقط ولا تلمس أي عنصر.`,
    `لا تقل أبدا إنك تنتظر تفعيل أدوات أو دمجا تقنيا: الأدوات متاحة لك الآن. لا تخرج عن مواضيع تراكر إلا بتحية قصيرة أو توضيح.`,
    `لوحة التحكم: https://appmails.net/app/dashboard.html — المستندات: https://appmails.net/app/documents.html`,
    ctx.attachment ? `أرسل المستخدم الآن ملفا/صورة: «${ctx.attachment.name || ""}». محتواه المقروء:\n${String(ctx.attachment.content || "").slice(0, 6000)}` : "",
  ].filter(Boolean).join("\n");
}

/* داخل تيليغرام المستخدم معروف من الربط: لا يعرض على النموذج معامل telegram_user_id كي لا يخترع رقما (فعلها: "123456") */
function toolDefs() {
  return AGENT_TOOLS.map((t) => {
    const params = JSON.parse(JSON.stringify(t.inputSchema || {}));
    if (params.properties) delete params.properties.telegram_user_id;
    return { type: "function", function: { name: t.name, description: t.description, parameters: params } };
  });
}

function extractCalls(res) {
  const calls = res && (res.tool_calls || (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.tool_calls)) || [];
  return calls.map((c) => {
    const fn = c.function || c;
    let args = fn.arguments;
    if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
    return { name: fn.name || c.name, args: args || {}, id: c.id || null };
  }).filter((c) => c.name);
}

function extractText(res) {
  if (!res) return "";
  if (typeof res.response === "string") return res.response;
  const ch = res.choices && res.choices[0] && res.choices[0].message;
  return String((ch && ch.content) || res.result || "");
}

const buckets = new Map();
function limited(key, limit) {
  const now = Date.now(); let b = buckets.get(key);
  if (!b || now - b.start >= 60_000) { b = { start: now, count: 0 }; buckets.set(key, b); }
  b.count += 1; if (buckets.size > 5000) buckets.clear();
  return b.count > limit;
}

const EMPTY = { ar: "لا يوجد.", en: "Nothing.", fr: "Rien.", ur: "کچھ نہیں۔" };
const NO_DATA = {
  ar: "لا أملك هذه المعلومة في بياناتك، ولن أخمنها. اكتب: قضايا، مخالفات، مهام، مستندات، مواعيد، متأخر، مصاريف، الشركة، الفريق.",
  en: "I do not have that in your data, and I will not guess. Try: cases, violations, tasks, documents, upcoming, overdue, expenses, company, team.",
  fr: "Je n'ai pas cette information dans vos données et je ne vais pas la deviner. Essayez : affaires, infractions, tâches, documents, échéances, retards, dépenses, société, équipe.",
  ur: "یہ معلومات آپ کے ڈیٹا میں نہیں ہیں، اور میں اندازہ نہیں لگاوں گا۔ لکھیں: مقدمات، خلاف ورزیاں، کام، دستاویزات، تاریخیں، تاخیر، اخراجات، کمپنی، ٹیم۔",
};
/* حارس التأريض: لا يخرج رقم ولا اسم لم تعده أداة.
   النموذج اخترع مرة «مستخدمون الموقع: 5» وأسماء لا وجود لها، فصار كل رقم وكل عنصر قائمة يقابل بالبيانات. */
/* مفردات المحادثة المسموحة في المسار الحر (مطبعة بلا همز ولا تاء مربوطة): كلمات ربط وإرشاد ووصف،
   لا أسماء أشخاص ولا شركات ولا أرقام — تلك من الأدوات وحدها */
const TALK = new Set(normalize("اهلا مرحبا شكرا عفوا نعم لن ولن لم ليس ليست غير سوي لا يوجد توجد لدي لديك عندك عندي لديه هذا هذه ذلك تلك التي الذي ما ماذا كيف متي اين هل ان انا انت نحن هو هي هم يمكن اقدر استطيع اعرف اعلم املك املكها اخمن اخمنها معلومه معلومات بيانات بياناتك حسابك الموقع المنصه النظام البوت مساعد اكتب جرب اطلب اسال سؤالك رسالتك الان حاليا فقط ايضا لكن او و في من علي الي مع بلا بدون شيء شي كل اي جميع قضايا قضيه قضاياك مخالفات مخالفه مهام مهمه مستندات مستند اوراق ورقه شهاده شهادات سجل السجل رخصه عقد مواعيد موعد متاخر متاخرات مصاريف مصروفات شركه الشركه شركتك فريق الفريق فريقك عضو اعضاء مستخدم مستخدمين مسجل مسجلين مشتركين مسؤول مسئول المسؤول عن يتابع المنجز منجز مفتوح مفتوحه تذكير تنبيه ينتهي تنتهي انتهاء اصدار صادر رقم ارقام تاريخ تواريخ عدد اجمالي مجموع نتيجه نتائج قائمه سوف سا رجاء الرحب اهلين طيب حسنا تمام ريال يوم ايام اسبوع شهر سنه ok yes no i you we the a an is are do does not have has can cannot know about your my data account site platform bot assistant write try ask question message now only also but or and in of on to with for nothing none there help hello hi thanks welcome please sorry cases case violations violation tasks task documents document upcoming overdue expenses company team done items item number date").split(" "));
export function ungrounded(text, evidence, usedTools) {
  const body = String(text || "");
  const ev = String(evidence || "");
  const evLetters = ev.replace(/[^\p{L}\p{N}]/gu, "");
  const digits = body.match(/\d+/g) || [];
  if (digits.length && !usedTools) return true;
  for (const d of digits) { if (!new RegExp("(?<!\\d)" + d + "(?!\\d)").test(ev)) return true; }
  const parts = body.split(/[،,\n]/).map((p) => p.trim()).filter((p) => p.length >= 3);
  if (parts.length >= 3) { for (const p of parts) if (!evLetters.includes(p.replace(/[^\p{L}\p{N}]/gu, ""))) return true; }
  /* ادعاء نثري باسم واحد («أحمد هو المسؤول») لا يحمل رقما ولا قائمة: كل كلمة ذات معنى
     يجب أن تكون في بيانات الأداة أو في مفردات المحادثة، وإلا فهي كيان مخترع */
  const evNorm = normalize(ev).replace(/\s+/g, "");
  for (const w of normalize(body).split(" ")) {
    if (w.length < 3) continue;
    const k = w.replace(/^(بال|وال|فال|لل|ال|و|ف|ب|ل)/, "");
    if (TALK.has(w) || TALK.has(k)) continue;
    if (evNorm.includes(w) || evNorm.includes(k)) continue;
    return true;
  }
  return false;
}
function rowsText(rows) {
  return (rows || []).map((r) => {
    if (r.document_kind || r.doc_number) return [r.title, r.doc_number ? "رقم " + r.doc_number : null, r.issue_date ? "إصدار " + dmy(r.issue_date) : null, r.due_at ? "ينتهي " + dmy(r.due_at) : null].filter(Boolean).join(" — ");
    return [r.title, r.case_number ? "قضية " + r.case_number : null, r.violation_number ? "مخالفة " + r.violation_number : null, r.client_name, r.due_at ? dmy(r.due_at) : null].filter(Boolean).join(" | ");
  }).join("\n");
}
const TEXT_TOOLS = new Set(["tracker_company", "tracker_team", "tracker_expenses", "tracker_overview", "tracker_platform"]);
/* الرسائل البديهية تُفهم وتُجاب من البيانات مباشرة بلا نموذج (telegram-understand.js) */
async function oneWord(env, ctx) {
  const u = understand(ctx.text, ctx.lang);
  if (!u) return null;
  if (u.reply) return { text: u.reply, tools: [] };
  const toolCtx = { env, who: { org_id: ctx.orgId || null, org_name: ctx.orgName || "", user_id: ctx.userId }, hash: null, trusted: true, rpc: (name, args) => rpc(env, name, args) };
  const out = await callTool(u.tool, u.args, toolCtx);
  if (!out || out.isError) return null;
  const toolText = out.content && out.content[0] && out.content[0].text;
  if (TEXT_TOOLS.has(u.tool)) return toolText ? { text: toolText, tools: [u.tool] } : null;
  const rows = out.structuredContent && out.structuredContent.items;
  if (!Array.isArray(rows)) return null;
  let text = composeAnswer(u, rows, ctx.lang, rowsText, toolText, ctx.userTimeZone);
  /* ورقة بعينها غير مرفوعة بعد: بطاقة الشركة تحمل رقمها كما سُجل */
  if (!text && u.tool === "tracker_items" && u.args.kind === "document" && u.keyword) {
    const c = await callTool("tracker_company", {}, toolCtx);
    text = c && !c.isError && c.content && c.content[0] ? c.content[0].text : null;
  }
  return text ? { text, tools: [u.tool] } : null;
}

/* الأوامر المباشرة (كلمة أو سؤال قصير معروف) تجاب قبل أي تخمين نية: لا «سأسجل هذا» لكلمة «المستندات» */
export async function quickAnswer(env, ctx) {
  if (!env.WORKER_SECRET) return null;
  try { return await oneWord(env, ctx); } catch (e) { return null; }
}

/* يعيد نص الرد أو null إن تعذر (فيسقط المتصل إلى الرد التقليدي) */
export async function agentReply(env, ctx) {
  if (!env.AI || !env.WORKER_SECRET) { console.log("agent: no AI or secret"); return null; }
  try { const quick = await oneWord(env, ctx); if (quick) { console.log("agent: one-word", quick.tools.join(",")); return quick; } } catch (e) { console.log("agent: one-word failed", String(e && e.message || e).slice(0, 200)); }
  if (limited("agent:" + ctx.chatId, 30)) { console.log("agent: rate limited"); return null; }
  let history = [];
  try { history = (await rpc(env, "telegram_history", { p_secret: env.WORKER_SECRET, p_chat_id: String(ctx.chatId), p_limit: 10 })) || []; } catch (e) { history = []; }
  const messages = [{ role: "system", content: systemPrompt(ctx) }];
  for (const h of history.slice(-10)) {
    if (!h || !h.body) continue;
    if (h.body === ctx.text && h.role === "user") continue; /* الرسالة الحالية سجلت قبل الرد؛ لا نكررها */
    messages.push({ role: h.role === "assistant" ? "assistant" : "user", content: String(h.body).replace(/\b(?:ITM|ORG|USR)-\d{8}-\d{4}\b\s*[|—-]?\s*/g, "").slice(0, 1500) });
  }
  messages.push({ role: "user", content: String(ctx.text || "").slice(0, 3000) });

  const toolCtx = { env, who: { org_id: ctx.orgId || null, org_name: ctx.orgName || "", user_id: ctx.userId }, hash: null, trusted: true, rpc: (name, args) => rpc(env, name, args) };
  const tools = toolDefs();
  let toolsUsed = [];
  const answers = []; /* نصوص الأدوات: هي وحدها ما يراه المستخدم */
  /* كل ما أعادته الأدوات: هو وحده مصدر الأرقام والأسماء في الرد */
  let evidence = String(ctx.text || "") + "\n" + String(ctx.name || "") + "\n" + String(ctx.orgName || "");
  const seen = new Set();
  for (let round = 0; round < 3; round++) {
    /* بعد تنفيذ الأدوات يطلب جواب نصي صريح (بلا أدوات) كي لا يعيد النموذج النداء نفسه بلا نهاية */
    const withTools = toolsUsed.length === 0;
    const res = await env.AI.run(MODEL, withTools ? { messages, tools, max_tokens: 700, temperature: 0.2 } : { messages, max_tokens: 700, temperature: 0.2 });
    let calls = withTools ? extractCalls(res) : [];
    calls = calls.filter((c) => { const k = c.name + JSON.stringify(c.args || {}); if (seen.has(k)) return false; seen.add(k); return true; });
    if (!calls.length) {
      const text = extractText(res).trim();
      if (text) {
        const clean = text.replace(/[\u064B-\u0652\u0670]/g, "");
        if (ungrounded(clean, evidence, toolsUsed.length > 0)) { console.log("agent: ungrounded reply blocked", clean.slice(0, 120)); return { text: NO_DATA[ctx.lang] || NO_DATA.ar, tools: toolsUsed }; }
        return { text: clean, tools: toolsUsed };
      }
      if (round < 2) { messages.push({ role: "user", content: "أجب الآن نصا مباشرا من نتائج الأدوات أعلاه، باختصار." }); continue; }
      console.log("agent: empty text after tools", toolsUsed.join(","), JSON.stringify(res).slice(0, 300));
      return null;
    }
    const assistantMsg = { role: "assistant", content: extractText(res) || "", tool_calls: calls.map((c, i) => ({ id: c.id || ("call_" + round + "_" + i), type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) };
    messages.push(assistantMsg);
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      let out;
      if (c.args && typeof c.args === "object") delete c.args.telegram_user_id; /* الهوية من الربط لا من النموذج */
      const gate = writeGate(c.name, c.args, ctx.text);
      if (gate.pending) { console.log("agent: pending", c.name, JSON.stringify(c.args).slice(0, 200)); return { text: "", pending: gate.pending, tools: toolsUsed.concat(c.name) }; }
      if (gate.blocked) { console.log("agent: blocked", c.name, JSON.stringify(c.args).slice(0, 200)); out = { content: [{ type: "text", text: gate.reason }], isError: true }; }
      else try { out = await callTool(c.name, c.args, toolCtx); } catch (e) { out = { content: [{ type: "text", text: "tool error: " + String(e && e.message || e).slice(0, 200) }], isError: true }; }
      toolsUsed.push(c.name);
      console.log("agent: tool", c.name, JSON.stringify(c.args).slice(0, 200), "→", (out && out.isError) ? "error" : "ok");
      const stripInternal = (v) => { if (Array.isArray(v)) return v.map(stripInternal); if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) if (k !== "item_number" && k !== "org_id" && k !== "user_id") o[k] = stripInternal(v[k]); return o; } return v; };
      const payload = out && out.structuredContent ? JSON.stringify(stripInternal(out.structuredContent)).slice(0, 6000) : String((out && out.content && out.content[0] && out.content[0].text) || "").slice(0, 6000);
      evidence += "\n" + payload + "\n" + String((out && out.content && out.content[0] && out.content[0].text) || "");
      messages.push({ role: "tool", tool_call_id: assistantMsg.tool_calls[i].id, name: c.name, content: payload });
      const shown = out && !out.isError && out.content && out.content[0] && out.content[0].text;
      if (shown) {
        const rows = out.structuredContent && out.structuredContent.items;
        answers.push(Array.isArray(rows) && rows.length ? rowsText(rows) : String(shown));
      }
    }
    /* دور النموذج ينتهي هنا: اختار الأداة، والنص يبنى من بياناتها لا من كلامه.
       (أمر المهندس رعد: مساعد أقرب إلى بوت مع لمسة نموذج، فلا جملة حقيقة يولدها النموذج حرا) */
    if (answers.length) return { text: answers.join("\n"), tools: toolsUsed };
  }
  console.log("agent: rounds exhausted", toolsUsed.join(","));
  return null;
}
