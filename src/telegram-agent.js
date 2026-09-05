/* وكيل تراكر على تيليغرام: نموذج لغوي يستعمل أدوات MCP نفسها (بحث، مواعيد، إضافة، إنجاز، إسناد) باسم المستخدم المرتبط،
   ويعرف من يخاطب (اسمه وشركته) ويتذكر آخر الرسائل. الردود بلغة الواجهة بلا تشكيل وبأرقام غربية. */
import { rpc } from "./notify.js";
import { TOOLS, callTool } from "./mcp.js";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const LANG_NAMES = { ar: "العربية الفصحى", en: "English", fr: "français", ur: "اردو" };
const AGENT_TOOLS = TOOLS.filter((t) => ["tracker_search", "tracker_list", "tracker_add", "tracker_complete", "tracker_assign"].includes(t.name));

function systemPrompt(ctx) {
  const lang = ctx.lang || "ar";
  return [
    `أنت مساعد TheTracker الذكي داخل تيليغرام. تخاطب الآن: ${ctx.name || "مستخدم مرتبط"}${ctx.orgName ? ` من شركة «${ctx.orgName}»` : ""}. أنت تعرفه وتعمل على حسابه بصلاحياته، فلا تسأله من هو ولا تطلب ربطا.`,
    `التاريخ والوقت الآن (الرياض): ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Riyadh" })}.`,
    `TheTracker منصة لتتبع القضايا والمخالفات والمهام والمستندات والمواعيد للشركات ومكاتب المحاماة.`,
    `قواعدك: أجب بلغة رسالة المستخدم نفسها (عربية، إنجليزية، فرنسية أو أردو)، وإن لم تتضح فبـ${LANG_NAMES[lang] || LANG_NAMES.ar}. بلا تشكيل، والأرقام غربية (1234567890)، بإيجاز ووضوح ومباشرة كزميل عمل محترف.`,
    `لا تحيي ولا تذكر اسمه أو شركته في كل رد؛ المحادثة مستمرة، فادخل في الجواب مباشرة. لا تكرر جملة قلتها قبل قليل، ولا تختم بعبارات مجاملة.`,
    `لكل سؤال عن بياناته (قضايا، مخالفات، مهام، مواعيد، متأخر، عميل، رقم) استعمل الأدوات ولا تخمن ولا تختلق. tracker_list للمواعيد القادمة والمتأخرة، tracker_search للبحث بأي كلمة أو رقم.`,
    `حين يطلب إضافة أو إنجاز أو إسناد بصيغة واضحة نفذ بالأداة مباشرة ثم أخبره بما تم برقم العنصر. إن كانت المهمة بلا قضية أو مخالفة تنتمي إليها فاعرض المرشحين الذين تعيدهم الأداة واطلب اختيار واحد. إن كان الطلب غامضا اسأل سؤالا واحدا قصيرا.`,
    `لا تقل أبدا إنك تنتظر تفعيل أدوات أو دمجا تقنيا: الأدوات متاحة لك الآن. لا تخرج عن مواضيع تراكر إلا بتحية قصيرة أو توضيح.`,
    `لوحة التحكم: https://appmails.net/app/dashboard.html — المستندات: https://appmails.net/app/documents.html`,
    ctx.attachment ? `أرسل المستخدم الآن ملفا/صورة: «${ctx.attachment.name || ""}». محتواه المقروء:\n${String(ctx.attachment.content || "").slice(0, 6000)}` : "",
  ].filter(Boolean).join("\n");
}

function toolDefs() {
  return AGENT_TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
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

/* يعيد نص الرد أو null إن تعذر (فيسقط المتصل إلى الرد التقليدي) */
export async function agentReply(env, ctx) {
  if (!env.AI || !env.WORKER_SECRET) return null;
  if (limited("agent:" + ctx.chatId, 30)) return null;
  let history = [];
  try { history = (await rpc(env, "telegram_history", { p_secret: env.WORKER_SECRET, p_chat_id: String(ctx.chatId), p_limit: 10 })) || []; } catch (e) { history = []; }
  const messages = [{ role: "system", content: systemPrompt(ctx) }];
  for (const h of history.slice(-10)) {
    if (!h || !h.body) continue;
    if (h.body === ctx.text && h.role === "user") continue; /* الرسالة الحالية سجلت قبل الرد؛ لا نكررها */
    messages.push({ role: h.role === "assistant" ? "assistant" : "user", content: String(h.body).slice(0, 1500) });
  }
  messages.push({ role: "user", content: String(ctx.text || "").slice(0, 3000) });

  const toolCtx = { env, who: { org_id: ctx.orgId || null, org_name: ctx.orgName || "", user_id: ctx.userId }, hash: null, rpc: (name, args) => rpc(env, name, args) };
  const tools = toolDefs();
  let toolsUsed = [];
  for (let round = 0; round < 4; round++) {
    const res = await env.AI.run(MODEL, { messages, tools, max_tokens: 700, temperature: 0.2 });
    const calls = extractCalls(res);
    if (!calls.length) {
      const text = extractText(res).trim();
      return text ? { text: text.replace(/[-]/g, ""), tools: toolsUsed } : null;
    }
    const assistantMsg = { role: "assistant", content: extractText(res) || "", tool_calls: calls.map((c, i) => ({ id: c.id || ("call_" + round + "_" + i), type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) };
    messages.push(assistantMsg);
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      let out;
      try { out = await callTool(c.name, c.args, toolCtx); } catch (e) { out = { content: [{ type: "text", text: "tool error: " + String(e && e.message || e).slice(0, 200) }], isError: true }; }
      toolsUsed.push(c.name);
      const payload = out && out.structuredContent ? JSON.stringify(out.structuredContent).slice(0, 6000) : String((out && out.content && out.content[0] && out.content[0].text) || "").slice(0, 6000);
      messages.push({ role: "tool", tool_call_id: assistantMsg.tool_calls[i].id, name: c.name, content: payload });
    }
  }
  return null;
}
