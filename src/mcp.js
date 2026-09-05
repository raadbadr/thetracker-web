/* خادم MCP لتراكر (نقل HTTP القياسي، JSON-RPC 2.0) — يربط أي وكيل ذكاء اصطناعي (هرمس على تيليغرام مثلا) بأدوات تراكر.
   المصادقة: Authorization: Bearer tt_live_… (مفتاح API من الإعدادات ← API)؛ المفتاح يحدد الشركة والمستخدم صاحب المفتاح،
   وكل أداة تمر عبر دوال القاعدة المحمية بسر الـ Worker نفسها التي يستعملها بوت تيليغرام، فالصلاحيات واحدة.
   بلا حالة: كل طلب مستقل (Mcp-Session-Id يُقبل ويُعاد إن أرسله العميل). */
import { rpc } from "./notify.js";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "thetracker", version: "1.0.0" };
const INSTRUCTIONS =
  "TheTracker: cases, violations and tasks for one company. Numbers/identifiers are never translated. " +
  "Use tracker_search before completing or assigning; when tracker_add returns needs_parent, ask the user which case/violation the task belongs to and call again with parent_id.";

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
const TOOLS = [
  { name: "tracker_whoami", description: "Which company and user this API key acts for, with headline counts.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "tracker_search", description: "Search cases, violations and tasks by title, client, case number, violation number or item number. Returns id, item_number, title, status, due_at, client, amount, roles.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Free text or a number" }, limit: { type: "integer", minimum: 1, maximum: 20, default: 8 } }, required: ["query"], additionalProperties: false } },
  { name: "tracker_list", description: "Open items with a due date: 'upcoming' (soonest first) or 'overdue'.",
    inputSchema: { type: "object", properties: { mode: { type: "string", enum: ["upcoming", "overdue"], default: "upcoming" }, limit: { type: "integer", minimum: 1, maximum: 20, default: 10 } }, additionalProperties: false } },
  { name: "tracker_add", description: "Create a case, violation or task. A task must belong to a case or violation: pass parent_id (item id) or the call returns status=needs_parent with candidates to choose from.",
    inputSchema: { type: "object", properties: {
      kind: { type: "string", enum: ["case", "violation", "task"] }, title: { type: "string" },
      client_name: { type: "string" }, case_number: { type: "string" }, violation_number: { type: "string" },
      amount: { type: "number" }, due_at: { type: "string", description: "ISO 8601 date or datetime" },
      location: { type: "string" }, notes: { type: "string" }, category: { type: "string" },
      parent_id: { type: "string", description: "Item id of the parent case/violation (tasks only)" } },
      required: ["kind", "title"], additionalProperties: false } },
  { name: "tracker_complete", description: "Mark an item done. Give a query (item number, title, case number) or an exact item_id; ambiguous queries return candidates.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, item_id: { type: "string" } }, additionalProperties: false } },
  { name: "tracker_assign", description: "Assign an item to a team member (by name or email) as responsible.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Item number, title or case number" }, member: { type: "string", description: "Member name or email" } }, required: ["query", "member"], additionalProperties: false } },
  { name: "tracker_import_rows", description: "Bulk-import rows (objects with Arabic or English column names, e.g. title, client_name, case_number, due_at, amount, status) into a tracker of this company.",
    inputSchema: { type: "object", properties: { rows: { type: "array", items: { type: "object" }, minItems: 1, maxItems: 500 }, tracker: { type: "string", description: "Tracker (sheet) name; default: the company's main tracker" } }, required: ["rows"], additionalProperties: false } },
];

function text(s) { return { content: [{ type: "text", text: String(s) }] }; }
function result(obj, summary) { return { content: [{ type: "text", text: summary || JSON.stringify(obj) }], structuredContent: obj }; }
function fail(msg, obj) { return { content: [{ type: "text", text: String(msg) }], isError: true, ...(obj ? { structuredContent: obj } : {}) }; }

function describeRows(rows) {
  if (!rows || !rows.length) return "No items.";
  return rows.map((r) => [r.item_number, r.title, r.status, r.client_name, r.case_number, r.due_at ? "due " + String(r.due_at).slice(0, 16) : null, r.amount != null ? r.amount + " SAR" : null].filter(Boolean).join(" | ")).join("\n");
}

export async function callTool(name, args, ctx) {
  const a = args || {};
  const secret = ctx.env.WORKER_SECRET, user = ctx.who.user_id;
  switch (name) {
    case "tracker_whoami": {
      let counts = null;
      try { const rows = await ctx.rpc("api_items_export", { p_secret: secret, p_hash: ctx.hash, p_tracker: null }); counts = { items: (rows || []).length, open: (rows || []).filter((r) => r.status === "open").length }; } catch (e) { counts = null; }
      const info = { org: ctx.who.org_name, org_id: ctx.who.org_id, user_id: user, counts };
      return result(info, `Company: ${ctx.who.org_name}` + (counts ? ` — ${counts.items} items, ${counts.open} open` : ""));
    }
    case "tracker_search": {
      const rows = await ctx.rpc("telegram_search", { p_secret: secret, p_user_id: user, p_query: String(a.query || ""), p_limit: Math.min(20, Math.max(1, Number(a.limit) || 8)) });
      return result({ items: rows || [] }, describeRows(rows));
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
      return result(r, `Added ${item.kind}: ${item.title}` + (r && r.item_number ? ` (${r.item_number})` : ""));
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
