/**
 * TRACKER API Worker — proxies Supabase calls server-side.
 * Keys are read from environment variables (Secrets in Cloudflare Dashboard).
 * Static assets are served by the [assets] binding automatically.
 */

import { handleAssistantRequest } from "./assistant.js";

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
  return json({ supabaseUrl: env.SUPABASE_URL, supabaseAnonKey: env.SUPABASE_ANON_KEY });
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

// --- Main router ---

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

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
      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: "server error" }, 500);
    }
  },
};
