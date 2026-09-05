/* خادم MCP لتراكر (نقل HTTP القياسي، JSON-RPC 2.0) — يربط أي وكيل ذكاء اصطناعي (هرمس على تيليغرام مثلا) بأدوات تراكر.
   المصادقة: Authorization: Bearer tt_live_… (مفتاح API من الإعدادات ← API)؛ المفتاح يحدد الشركة والمستخدم صاحب المفتاح،
   وكل أداة تمر عبر دوال القاعدة المحمية بسر الـ Worker نفسها التي يستعملها بوت تيليغرام، فالصلاحيات واحدة.
   بلا حالة: كل طلب مستقل (Mcp-Session-Id يقبل ويعاد إن أرسله العميل). */
import { rpc, dmy } from "./notify.js";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "thetracker", version: "1.0.0" };
const INSTRUCTIONS =
  "TheTracker: cases, violations and tasks for one company. Numbers/identifiers are never translated. " +
  "On Telegram ALWAYS pass telegram_user_id (the numeric id of the person you are talking to) to every tool so you act as that member with their permissions. " +
  "If a tool answers status=unlinked, call tracker_link_telegram with their telegram_user_id and the phone number they share (or a link code from the site), then continue. " +
  "Use tracker_search before completing or assigning; when tracker_add returns needs_parent, ask which case/violation the task belongs to and call again with parent_id.";

const buckets = new Map();
function rateLimited(key, limit) {
  const now = Date.now(); let b = buckets.get(key);
  if (!b || now - b.start >= 60_000) { b = { start: now, count: 0 }; buckets.set(key, b); }
  b.count += 1; if (buckets.size > 5000) buckets.clear();
  return b.count > limit;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Max-Age": "600",
};

function jsonResponse(data, status, extra) {
  return new Response(data === null ? null : JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS, ...(extra || {}) } });
}
const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message, data) => ({ jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } });

/* ---------- الأدوات ---------- */
export const TOOLS = [
  { name: "tracker_whoami", description: "Who the current person is (by telegram_user_id if linked, else the key owner), the company, and headline counts.",
    inputSchema: { type: "object", properties: { telegram_user_id: { type: "string", description: "Numeric Telegram user id of the person talking" } }, additionalProperties: false } },
  { name: "tracker_link_telegram", description: "Link a Telegram user to their TheTracker account so the bot knows who they are. Identify them by the phone number they shared (matches the account phone) or by a link code from the site's settings; with neither, the key owner's account is linked.",
    inputSchema: { type: "object", properties: { telegram_user_id: { type: "string" }, phone: { type: "string", description: "Phone as shared on Telegram, any format" }, code: { type: "string", description: "8-character link code from Settings → Telegram" } }, required: ["telegram_user_id"], additionalProperties: false } },
  { name: "tracker_search", description: "Search cases, violations and tasks by title, client, case number or violation number. Returns id, title, status, due_at, client, amount, roles.",
    inputSchema: { type: "object", properties: { telegram_user_id: { type: "string", description: "Telegram user id of the person talking (Telegram only)" }, query: { type: "string", description: "Free text or a number" }, limit: { type: "integer", minimum: 1, maximum: 20, default: 8 } }, required: ["query"], additionalProperties: false } },
  { name: "tracker_company", description: "The user's company record as registered on the site: legal name, commercial register number, VAT number, unified number, IBAN and bank, national address, contacts, plan, and the official papers on file with their extracted details. Use it for questions like 'what is my CR number?'.",
    inputSchema: { type: "object", properties: { telegram_user_id: { type: "string" } }, additionalProperties: false } },
  { name: "tracker_items", description: "List the user's items by kind and status: kind case|violation|task|document|all, status open|done|all. Use it for one-word requests like قضايا, مخالفات, مهام, مستندات, المنجز.",
    inputSchema: { type: "object", properties: { telegram_user_id: { type: "string" }, kind: { type: "string", enum: ["case", "violation", "task", "document", "all"], default: "all" }, status: { type: "string", enum: ["open", "done", "all"], default: "open" }, limit: { type: "integer", minimum: 1, maximum: 30, default: 10 } }, additionalProperties: false } },
  { name: "tracker_list", description: "Open items with a due date: 'upcoming' (soonest first) or 'overdue'.",
    inputSchema: { type: "object", properties: { telegram_user_id: { type: "string", description: "Telegram user id of the person talking (Telegram only)" }, mode: { type: "string", enum: ["upcoming", "overdue"], default: "upcoming" }, limit: { type: "integer", minimum: 1, maximum: 20, default: 10 } }, additionalProperties: false } },
  { name: "tracker_add", description: "Create a case, violation or task. A task must belong to a case or violation: pass parent_id (item id) or the call returns status=needs_parent with candidates to choose from.",
    inputSchema: { type: "object", properties: { telegram_user_id: { type: "string", description: "Telegram user id of the person talking (Telegram only)" },
      kind: { type: "string", enum: ["case", "violation", "task"] }, title: { type: "string" },
      client_name: { type: "string" }, case_number: { type: "string" }, violation_number: { type: "string" },
      amount: { type: "number" }, due_at: { type: "string", description: "ISO 8601 date or datetime" },
      location: { type: "string" }, notes: { type: "string" }, category: { type: "string" },
      parent_id: { type: "string", description: "Item id of the parent case/violation (tasks only)" } },
      required: ["kind", "title"], additionalProperties: false } },
  { name: "tracker_complete", description: "Mark an item done. Give a query (item number, title, case number) or an exact item_id; ambiguous queries return candidates.",
    inputSchema: { type: "object", properties: { telegram_user_id: { type: "string", description: "Telegram user id of the person talking (Telegram only)" }, query: { type: "string" }, item_id: { type: "string" } }, additionalProperties: false } },
  { name: "tracker_assign", description: "Assign an item to a team member (by name or email) as responsible.",
    inputSchema: { type: "object", properties: { telegram_user_id: { type: "string", description: "Telegram user id of the person talking (Telegram only)" }, query: { type: "string", description: "Item number, title or case number" }, member: { type: "string", description: "Member name or email" } }, required: ["query", "member"], additionalProperties: false } },
  { name: "tracker_team", description: "The company's team: each member's name, role, department, open and overdue counts, next due date and their nearest items. Use for 'who is responsible for…', 'what is on Ahmed this week', 'the team'.",
    inputSchema: { type: "object", properties: { telegram_user_id: { type: "string" } }, additionalProperties: false } },
  { name: "tracker_expenses", description: "Operating expenses of the user's company for a period: total in SAR, count, top categories and the latest expenses. Use for 'how are my expenses', 'what did we spend this month/week/year'.",
    inputSchema: { type: "object", properties: { telegram_user_id: { type: "string" }, period: { type: "string", enum: ["month", "week", "year", "all"], default: "month", description: "month (default), week, year or all" } }, additionalProperties: false } },
  { name: "tracker_remind", description: "Set a personal reminder lead time for one item: remind before its due date by e.g. 'يوم', '3 أيام', 'أسبوع', '2 hours'. Identify the item by query (title, case number, violation number). Returns ambiguous candidates when several match.",
    inputSchema: { type: "object", properties: { telegram_user_id: { type: "string" }, query: { type: "string" }, before: { type: "string", description: "Lead time as written by the user" } }, required: ["query", "before"], additionalProperties: false } },
  { name: "tracker_import_rows", description: "Bulk-import rows (objects with Arabic or English column names, e.g. title, client_name, case_number, due_at, amount, status) into a tracker of this company.",
    inputSchema: { type: "object", properties: { telegram_user_id: { type: "string", description: "Telegram user id of the person talking (Telegram only)" }, rows: { type: "array", items: { type: "object" }, minItems: 1, maxItems: 500 }, tracker: { type: "string", description: "Tracker (sheet) name; default: the company's main tracker" } }, required: ["rows"], additionalProperties: false } },
];

function text(s) { return { content: [{ type: "text", text: String(s) }] }; }
function result(obj, summary) { return { content: [{ type: "text", text: summary || JSON.stringify(obj) }], structuredContent: obj }; }
function fail(msg, obj) { return { content: [{ type: "text", text: String(msg) }], isError: true, ...(obj ? { structuredContent: obj } : {}) }; }

function describeRows(rows) {
  if (!rows || !rows.length) return "No items.";
  return rows.map((r) => {
    if (r.document_kind || r.doc_number) {
      /* ورقة رسمية: رقمها هي (السجل/الضريبي…) لا الرقم القياسي للعنصر */
      return [r.title, r.doc_number ? "رقم " + r.doc_number : null, r.issue_date ? "إصدار " + dmy(r.issue_date) : null, r.due_at ? "ينتهي " + dmy(r.due_at) : null].filter(Boolean).join(" — ");
    }
    /* الرقم القياسي (ITM-…) داخلي للإدارة؛ المستخدم يرى رقم القضية أو المخالفة أو الورقة */
    return [r.title, r.case_number ? "قضية " + r.case_number : null, r.violation_number ? "مخالفة " + r.violation_number : null, r.client_name, r.status === "open" ? null : r.status, r.due_at ? "الموعد " + dmy(r.due_at) : null, r.amount != null ? r.amount + " ريال" : null].filter(Boolean).join(" | ");
  }).join("\n");
}

async function resolveActor(ctx, a) {
  const tg = a && a.telegram_user_id ? String(a.telegram_user_id).trim() : "";
  if (!tg) return { user: ctx.who.user_id, name: null, tg: "" };
  let hit = null;
  try { hit = await ctx.rpc("channel_user_lookup", { p_secret: ctx.env.WORKER_SECRET, p_channel: "telegram", p_external_id: tg }); } catch (e) { hit = null; }
  if (hit && hit.user_id) return { user: hit.user_id, name: hit.name || null, tg };
  return { user: null, name: null, tg };
}

export async function callTool(name, args, ctx) {
  const a = args || {};
  const secret = ctx.env.WORKER_SECRET;
  const actor = await resolveActor(ctx, a);
  if (name === "tracker_link_telegram") {
    const tg = String(a.telegram_user_id || "").trim();
    if (!tg) return fail("telegram_user_id is required");
    try {
      let linkedUser = null;
      if (a.code) linkedUser = await ctx.rpc("link_channel", { p_secret: secret, p_channel: "telegram", p_code: String(a.code).trim().toUpperCase(), p_external_id: tg });
      else if (a.phone) linkedUser = await ctx.rpc("link_channel_by_phone", { p_secret: secret, p_channel: "telegram", p_phone: String(a.phone), p_external_id: tg });
      else linkedUser = await ctx.rpc("link_channel_direct", { p_secret: secret, p_user_id: ctx.who.user_id, p_channel: "telegram", p_external_id: tg });
      const who = await ctx.rpc("channel_user_lookup", { p_secret: secret, p_channel: "telegram", p_external_id: tg });
      if (!who || !who.user_id) return fail("No account matched" + (a.phone ? " that phone number" : a.code ? " that code" : "") + ". Ask for the phone registered on the site or a link code from Settings.", { status: "unlinked", raw: linkedUser });
      return result({ status: "linked", user_id: who.user_id, name: who.name, telegram_user_id: tg }, "Linked: " + (who.name || who.user_id) + " ↔ Telegram " + tg);
    } catch (e) { return fail("Link failed: " + String(e && e.message || e).slice(0, 200)); }
  }
  if (actor.tg && !actor.user) return result({ status: "unlinked", telegram_user_id: actor.tg }, "unlinked: this Telegram user is not linked to a TheTracker account yet. Ask for their phone number (share contact) or a link code and call tracker_link_telegram.");
  const user = actor.user;
  switch (name) {
    case "tracker_whoami": {
      let counts = null;
      try { const rows = await ctx.rpc("api_items_export", { p_secret: secret, p_hash: ctx.hash, p_tracker: null }); counts = { items: (rows || []).length, open: (rows || []).filter((r) => r.status === "open").length }; } catch (e) { counts = null; }
      const info = { org: ctx.who.org_name, org_id: ctx.who.org_id, user_id: user, user_name: actor.name, telegram_user_id: actor.tg || null, counts };
      return result(info, (actor.name ? `You are ${actor.name}. ` : "") + `Company: ${ctx.who.org_name}` + (counts ? ` — ${counts.items} items, ${counts.open} open` : ""));
    }
    case "tracker_search": {
      const rows = await ctx.rpc("telegram_search", { p_secret: secret, p_user_id: user, p_query: String(a.query || ""), p_limit: Math.min(20, Math.max(1, Number(a.limit) || 8)) });
      return result({ items: rows || [] }, describeRows(rows));
    }
    case "tracker_company": {
      const orgs = (await ctx.rpc("telegram_company_profile", { p_secret: secret, p_user_id: user })) || [];
      if (!orgs.length) return fail("No company on this account.");
      /* شركته (مالك/مدير) أولا؛ العضويات في شركات غيره تُذكر بعدها باسمها فقط */
      const mine = orgs.filter((o) => o.role === "owner" || o.role === "admin");
      const shown = mine.length ? mine : orgs.slice(0, 1);
      const lines = [];
      for (const o of shown) {
        lines.push(o.legal_name || o.name);
        if (o.cr_number) lines.push("رقم السجل التجاري: " + o.cr_number);
        if (o.unified_number) lines.push("الرقم الموحد: " + o.unified_number);
        if (o.vat_number) lines.push("الرقم الضريبي: " + o.vat_number);
        if (o.iban) lines.push("الآيبان: " + o.iban);
        if (o.national_address && o.national_address.short) lines.push("العنوان المختصر: " + o.national_address.short);
        if (o.plan) lines.push("الباقة: " + o.plan + (o.plan_expires_at ? " حتى " + dmy(o.plan_expires_at) : ""));
        for (const d of o.documents || []) {
          const det = d.details || {};
          const issue = det.issue_date || det.certificate_date || det.effective_date || null;
          lines.push("• " + (d.title || d.kind) + (d.number ? " — رقم " + d.number : "") + (issue ? " — إصدار " + dmy(issue) : "") + (d.expires_at ? " — ينتهي " + dmy(d.expires_at) : "") + (d.files ? "" : " (بلا ملف)"));
        }
      }
      const others = orgs.filter((o) => !shown.includes(o));
      if (others.length) lines.push("عضو أيضا في: " + others.map((o) => o.name).join("، "));
      return result({ companies: orgs }, lines.join("\n"));
    }
    case "tracker_items": {
      const rows = await ctx.rpc("telegram_items_by_kind", { p_secret: secret, p_user_id: user, p_kind: a.kind || "all", p_status: a.status || "open", p_limit: Math.min(30, Math.max(1, Number(a.limit) || 10)) });
      return result({ kind: a.kind || "all", status: a.status || "open", count: (rows || []).length, items: rows || [] }, (rows && rows.length ? rows.length + " items\n" : "") + describeRows(rows));
    }
    case "tracker_list": {
      const rows = await ctx.rpc("telegram_items", { p_secret: secret, p_user_id: user, p_mode: a.mode === "overdue" ? "overdue" : "upcoming", p_limit: Math.min(20, Math.max(1, Number(a.limit) || 10)) });
      return result({ mode: a.mode || "upcoming", items: rows || [] }, describeRows(rows));
    }
    case "tracker_add": {
      const item = {};
      for (const k of ["kind", "title", "client_name", "case_number", "violation_number", "amount", "due_at", "location", "notes", "category", "parent_id"]) if (a[k] !== undefined && a[k] !== null && a[k] !== "") item[k] = a[k];
      const r = await ctx.rpc("telegram_add_item", { p_secret: secret, p_user_id: user, p_item: item });
      if (r && r.status === "needs_parent") return result(r, "needs_parent: a task must belong to a case or violation. Candidates:\n" + describeRows(r.candidates || []) + "\nCall tracker_add again with parent_id.");
      if (r && r.status && r.status !== "ok" && r.status !== "created") return fail("Could not add: " + r.status, r);
      return result(r, `Added ${item.kind}: ${item.title}`);
    }
    case "tracker_complete": {
      const r = await ctx.rpc("telegram_complete", { p_secret: secret, p_user_id: user, p_query: String(a.query || ""), p_item_id: a.item_id || null });
      if (!r || r.status === "not_found") return fail("No matching item.", r);
      if (r.status === "ambiguous") return result(r, "Ambiguous — candidates:\n" + describeRows(r.candidates || []) + "\nCall again with item_id.");
      return result(r, "Done: " + (r.title || a.query));
    }
    case "tracker_assign": {
      const r = await ctx.rpc("telegram_assign", { p_secret: secret, p_user_id: user, p_query: String(a.query || ""), p_member: String(a.member || "") });
      if (!r || r.status === "not_found") return fail("No matching item.", r);
      if (r.status === "ambiguous") return result(r, "Ambiguous — candidates:\n" + describeRows(r.candidates || []) + "\nUse the item number.");
      if (r.status === "no_member") return fail("No such team member: " + a.member, r);
      return result(r, `Assigned ${r.title || a.query} to ${r.member_name || a.member}`);
    }
    case "tracker_team": {
      const r = await ctx.rpc("telegram_team", { p_secret: secret, p_user_id: user });
      if (!r || r.status === "no_org") return fail("No team found.");
      const lines = (r.members || []).map((m) => {
        const ROLE = { owner: "مالك", admin: "مشرف", member: "عضو" }, DEPT = { management: "الإدارة", legal: "القانوني", hr: "الموارد البشرية", finance: "المالي", operations: "التشغيل", other: "أخرى" };
        const head = [m.full_name || m.email, ROLE[m.role] || m.role, DEPT[m.department] || m.department, m.job_title].filter(Boolean).join(" — ");
        const load = "مفتوح " + (m.open || 0) + (m.overdue ? " (متأخر " + m.overdue + ")" : "") + (m.next_due ? " — أقرب موعد " + dmy(m.next_due) : "");
        const items = (m.items || []).slice(0, 3).map((it) => "   • " + [it.title, it.case_number ? "قضية " + it.case_number : null, it.violation_number ? "مخالفة " + it.violation_number : null, it.due_at ? dmy(it.due_at) : null].filter(Boolean).join(" | ")).join("\n");
        return head + "\n   " + load + (items ? "\n" + items : "");
      });
      return result(r, (r.org && r.org.name ? r.org.name + "\n" : "") + (lines.length ? lines.join("\n") : "لا أعضاء."));
    }
    case "tracker_expenses": {
      const period = ["month", "week", "year", "all"].includes(a.period) ? a.period : "month";
      const r = await ctx.rpc("telegram_expenses", { p_secret: secret, p_user_id: user, p_period: period });
      if (!r || r.status === "no_org") return fail("No company found.");
      const LABEL = { month: "هذا الشهر", week: "هذا الأسبوع", year: "هذه السنة", all: "منذ البداية" };
      const money = (v) => Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " ريال";
      if (!Number(r.count || 0)) return result(r, "لا مصاريف مسجلة " + LABEL[period] + ". تُسجَّل من لوحة التحكم ← مصاريف التشغيل: https://appmails.net/app/dashboard.html");
      const cats = (r.by_category || []).map((c) => c.name + " " + money(c.total) + " (" + c.count + ")").join("، ");
      const latest = (r.latest || []).map((e) => "• " + [e.title, money(e.amount), e.date ? dmy(e.date) : null, e.category].filter(Boolean).join(" — ")).join("\n");
      const head = "مصاريف " + LABEL[period] + (r.period_start && period !== "all" ? " (" + dmy(r.period_start) + " إلى " + dmy(r.period_end) + ")" : "") + ": " + money(r.total) + " في " + r.count + " مصروف.";
      return result(r, head + (cats ? "\nأعلى التصنيفات: " + cats : "") + (latest ? "\nآخر المصاريف:\n" + latest : ""));
    }
    case "tracker_remind": {
      const r = await ctx.rpc("telegram_set_reminder", { p_secret: secret, p_user_id: user, p_query: String(a.query || ""), p_before: String(a.before || "") });
      if (!r || r.status === "not_found") return fail("No matching item.", r);
      if (r.status === "ambiguous") return result(r, "Ambiguous — candidates:\n" + describeRows(r.candidates || []) + "\nAsk which one, then call again with a more specific query.");
      if (r.status === "bad_interval") return fail("Could not read the lead time: " + (r.given || a.before), r);
      return result(r, "تم: تذكير قبل " + (r.remind_before || a.before) + " لـ " + (r.title || a.query) + (r.remind_at ? " (سيصل " + String(r.remind_at).slice(0, 16).replace("T", " ") + ")" : ""));
    }
    case "tracker_import_rows": {
      if (!ctx.importRows) return fail("import not available");
      const r = await ctx.importRows(a.rows, a.tracker || null);
      return r.ok ? result(r, `Imported ${r.imported ?? ""} rows`.trim()) : fail("Import failed", r);
    }
    default:
      return fail("Unknown tool: " + name);
  }
}

async function dispatch(msg, ctx) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg && msg.id !== undefined ? msg.id : null, -32600, "Invalid Request");
  const id = msg.id, params = msg.params || {};
  const isNotification = id === undefined || id === null;
  switch (msg.method) {
    case "initialize": {
      const asked = String(params.protocolVersion || "");
      const version = PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return rpcResult(id, { protocolVersion: version, capabilities: { tools: { listChanged: false }, resources: {}, prompts: {} }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "ping": return rpcResult(id, {});
    case "tools/list": return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const name = String(params.name || "");
      if (!TOOLS.some((t) => t.name === name)) return rpcError(id, -32602, "Unknown tool: " + name);
      try { return rpcResult(id, await callTool(name, params.arguments || {}, ctx)); }
      catch (e) { return rpcResult(id, fail("Tool failed: " + String(e && e.message || e).slice(0, 300))); }
    }
    case "resources/list": return rpcResult(id, { resources: [] });
    case "resources/templates/list": return rpcResult(id, { resourceTemplates: [] });
    case "prompts/list": return rpcResult(id, { prompts: [] });
    case "logging/setLevel": return rpcResult(id, {});
    case "completion/complete": return rpcResult(id, { completion: { values: [] } });
    default:
      if (isNotification || msg.method.startsWith("notifications/")) return null;
      return rpcError(id, -32601, "Method not found: " + msg.method);
  }
}

/* نقطة الدخول: /mcp — OPTIONS للـ CORS، POST للرسائل، GET بلا بث (405)، DELETE لإنهاء الجلسة */
export async function handleMcp(request, env, url, deps) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method === "GET") return jsonResponse({ error: "This MCP server is stateless; use POST." }, 405, { Allow: "POST, DELETE, OPTIONS" });
  if (request.method === "DELETE") return new Response(null, { status: 200, headers: CORS });
  if (request.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405, { Allow: "POST, DELETE, OPTIONS" });

  const auth = await deps.authenticate(request, env);
  if (auth.error) return jsonResponse({ jsonrpc: "2.0", id: null, error: { code: -32001, message: auth.message || "unauthorized" } }, auth.status || 401, { "WWW-Authenticate": 'Bearer realm="thetracker-mcp"' });
  if (rateLimited("mcp:" + auth.who.org_id, 120)) return jsonResponse({ jsonrpc: "2.0", id: null, error: { code: -32029, message: "rate limited" } }, 429);

  let body;
  try { body = await request.json(); } catch { return jsonResponse(rpcError(null, -32700, "Parse error"), 400); }
  const ctx = { env, who: auth.who, hash: auth.hash, rpc: deps.rpc || ((name, args) => rpc(env, name, args)), importRows: deps.importRows ? (rows, tracker) => deps.importRows(env, auth.hash, rows, tracker) : null };
  const session = request.headers.get("Mcp-Session-Id") || crypto.randomUUID();
  const extra = { "Mcp-Session-Id": session, "MCP-Protocol-Version": PROTOCOL_VERSIONS[0] };

  const messages = Array.isArray(body) ? body : [body];
  const responses = [];
  for (const m of messages) { const r = await dispatch(m, ctx); if (r) responses.push(r); }
  if (!responses.length) return new Response(null, { status: 202, headers: { ...CORS, ...extra } });
  return jsonResponse(Array.isArray(body) ? responses : responses[0], 200, extra);
}
