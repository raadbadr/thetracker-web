// --- مساعد الموقع (LLM) --------------------------------------------------
// POST /api/assistant — نفس نمط باركينزي: Claude إن وجد ANTHROPIC_API_KEY،
// وإلا Workers AI المجاني (env.AI عبر [ai] في wrangler.toml)، وإلا 503
// فتتحول الواجهة تلقائيا لمسار "تواصل مع الدعم".

const NO_CACHE = { cacheTtl: 0, cacheEverything: false };

const ASSISTANT_MODEL = "claude-sonnet-5";
const ASSISTANT_MAX_TOKENS = 1024;
const ASSISTANT_MAX_TOOL_ROUNDS = 4;
const ASSISTANT_MAX_MESSAGES = 16;
const ASSISTANT_MAX_CHARS = 2000;
const RATE_WINDOW_MS = 60_000;
// حد أشد: استدعاءات LLM أغلى بكثير من قراءات Supabase.
const ASSISTANT_RATE_MAX_PER_WINDOW = 15;
const assistantRateBuckets = new Map();

function assistantRateLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  let bucket = assistantRateBuckets.get(ip);
  if (!bucket || now - bucket.start >= RATE_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    assistantRateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (assistantRateBuckets.size > 5000) assistantRateBuckets.clear();
  return bucket.count > ASSISTANT_RATE_MAX_PER_WINDOW;
}

function supaHeaders(env) {
  return {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
  };
}

// --- حقائق ثابتة عن المنصة (تعدل هنا فقط) ------------------------------
const PLANS = [
  { code: "trial", name_ar: "التجريبية", name_en: "Trial", price_monthly_sar: 0, price_yearly_sar: 0, trial_days: 14,
    members: 5, items: 2000, channels: ["telegram"], excel_imports_per_month: null, calendar: ["ics", "google"],
    note_ar: "14 يوما بكل المزايا وبلا بطاقة بنكية، ولا تتجدد تلقائيا" },
  { code: "monthly", name_ar: "شهري", name_en: "Monthly", price_monthly_sar: 49, price_yearly_sar: null,
    members: 5, items: 2000, channels: ["telegram"], excel_imports_per_month: null, calendar: ["ics", "google"] },
  { code: "yearly", name_ar: "سنوي", name_en: "Yearly", price_monthly_sar: null, price_yearly_sar: 490,
    members: 15, items: 20000, channels: ["telegram"], excel_imports_per_month: null, calendar: ["ics", "google"], priority_support: true },
];

function toolAppInfo() {
  return {
    name: "TheTracker",
    url: "https://appmails.net",
    support_email: "support@appmails.net",
    languages: ["ar", "en", "fr", "ur"],
    login_methods: ["google"],
    features: [
      "لوحة المخالفات: جدول برقم المخالفة وتاريخها والشركة وجهة الإصدار والمبلغ ونوعها وحالة التظلم وموعد السداد، مع مؤشرات بيانية ومجاميع المبالغ ومرشح حسب الشركة",
      "لوحة القضايا: نفس الفكرة للقضايا والجلسات، ورقم الدعوى يجمع المخالفة وقضيتها وملفاتها في ملف واحد",
      "استيراد ذكي لملف التقرير الشامل: يقرأ أوراق «مخالفات بلدي - <الشركة>» و«جدول الجلسات» و«القضايا المقيدة في معين» ويكتشف صف العناوين تلقائيا ويأخذ اسم الشركة من اسم الورقة",
      "المرفقات: رفع PDF أو Word أو صورة لكل مخالفة أو قضية داخل تخزين المنصة حسب الباقة، أو لصق رابط جوجل درايف",
      "التقويم دائم الظهور بالميلادي أو الهجري (أم القرى) مع المواعيد عليه، واشتراك بنقرة في تقويم جوجل أو آبل أو أوتلوك",
      "التنبيهات داخل المنصة عبر الجرس قبل الاستحقاق بيوم، وخط زمني للإنجازات",
      "أرقام قياسية لكل مستخدم وحساب وعنصر (USR / ORG / ITM)",
      "الحساب يفتح لشركة أو مؤسسة أو صاحب وثيقة عمل حر، وكذلك لشخص أو موظف يريد ترتيب أوراقه (هويته وجوازه ورخصته واستمارته وتأمينه وعقوده)، ولكل نوع أوراقه المتوقعة وتنبيهات انتهائها"
    ],
    how_it_works: [
      "سجل دخولك ثم اختر نوع حسابك: شركة أو مؤسسة أو وثيقة عمل حر أو شخص، واكتب الاسم",
      "ارفع ملف إكسل (أو التقرير الشامل للمخالفات والجلسات) من صفحة الاستيراد؛ يكتشف النظام الأعمدة تلقائيا ويمكنك تعديل المطابقة",
      "تظهر العناصر في قائمة وتقويم، ويعطى لك رابط ICS لتقويم آبل وجوجل وأوتلوك",
      "ادع زملاءك وأسند العناصر لهم",
      "اربط حسابك بتيليغرام لتصلك التنبيهات قبل الاستحقاق",
    ],
    payment: "لا توجد باقة مجانية دائمة: يبدأ كل حساب بفترة تجريبية 14 يوما بكل المزايا، ثم تشترك شهريا أو سنويا. الاشتراكات تفعل حاليا بالتواصل مع الدعم؛ بوابة الدفع الإلكتروني قادمة.",
  };
}

async function toolPlatformStats(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return {};
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/platform_stats`, {
    method: "POST",
    headers: { ...supaHeaders(env), Accept: "application/json", "Content-Type": "application/json" },
    body: "{}",
    cf: NO_CACHE,
  });
  return res.ok ? await res.json() : {};
}

const TOOLS = [
  {
    name: "get_plans",
    description: "Lists TheTracker subscription plans (free, monthly, yearly) with prices in SAR and limits (members, items, channels).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_app_info",
    description: "Returns static facts about the TheTracker platform: what it does, how it works, login methods, support email.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_platform_stats",
    description: "Live aggregate counts: organizations, trackers, tracked items, notifications sent.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

async function callTool(name, args, env) {
  switch (name) {
    case "get_plans": return { plans: PLANS };
    case "get_app_info": return toolAppInfo();
    case "get_platform_stats": return await toolPlatformStats(env);
    default: return { error: "unknown tool" };
  }
}

function assistantSystemPrompt() {
  return `أنت مساعد TheTracker الرسمي على موقع appmails.net — منصة لتتبع عقود الشركات وتراخيصها ومهامها من ملف إكسل، مع تقويم وتنبيهات على تيليغرام.

قواعدك:
- أجب بلغة رسالة الزائر (عربية فصحى، إنجليزية، فرنسية، أو أردو).
- كن مختصرا وودودا ومباشرا؛ الأرقام دائما غربية (1234567890).
- استخدم الأدوات لأي معلومة (الباقات، طريقة العمل، الأرقام الحية) — لا تختلق بيانات أبدا.
- لطلبات الدعم الشخصية (مشكلة حساب، تفعيل اشتراك، فاتورة): وجه الزائر لزر "التواصل مع الدعم" في هذه المحادثة أو support@appmails.net — لا تجمع بياناته بنفسك.
- لا تناقش مواضيع خارج TheTracker والتتبع والتنبيهات؛ اعتذر بلطف وأعد التوجيه.`;
}

export async function handleAssistantRequest(request, env) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const ip = request.headers.get("cf-connecting-ip") || "";
  if (assistantRateLimited(ip)) {
    return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers });
  }

  let body;
  try { body = await request.json(); } catch { body = null; }
  const incoming = body && Array.isArray(body.messages) ? body.messages : null;
  if (!incoming || !incoming.length || incoming.length > ASSISTANT_MAX_MESSAGES) {
    return new Response(JSON.stringify({ error: "invalid_messages" }), { status: 400, headers });
  }
  const messages = [];
  for (const m of incoming) {
    const role = m && m.role === "assistant" ? "assistant" : "user";
    const text = String((m && m.content) || "").slice(0, ASSISTANT_MAX_CHARS).trim();
    if (!text) continue;
    messages.push({ role, content: text });
  }
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return new Response(JSON.stringify({ error: "invalid_messages" }), { status: 400, headers });
  }

  /* بلا مفتاح Anthropic: Workers AI المجاني؛ وبلا الاثنين: 503 فتتحول الواجهة لمسار الدعم */
  if (!env.ANTHROPIC_API_KEY) {
    if (env.AI) return workersAiAssistant(messages, env, headers);
    return new Response(JSON.stringify({ error: "assistant_unavailable" }), { status: 503, headers });
  }

  const tools = TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));

  const anthropicHeaders = {
    "x-api-key": env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };

  try {
    for (let round = 0; round <= ASSISTANT_MAX_TOOL_ROUNDS; round++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: anthropicHeaders,
        body: JSON.stringify({
          model: ASSISTANT_MODEL,
          max_tokens: ASSISTANT_MAX_TOKENS,
          system: assistantSystemPrompt(),
          messages,
          tools,
        }),
        cf: NO_CACHE,
      });
      if (!res.ok) {
        return new Response(JSON.stringify({ error: "assistant_error" }), { status: 502, headers });
      }
      const data = await res.json();

      if (data.stop_reason === "tool_use" && round < ASSISTANT_MAX_TOOL_ROUNDS) {
        messages.push({ role: "assistant", content: data.content });
        const results = [];
        for (const block of data.content) {
          if (block.type !== "tool_use") continue;
          let out;
          try {
            out = await callTool(block.name, block.input || {}, env);
          } catch (e) {
            out = { error: String((e && e.message) || e) };
          }
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(out).slice(0, 12000),
          });
        }
        messages.push({ role: "user", content: results });
        continue;
      }

      const reply = (data.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (!reply) {
        return new Response(JSON.stringify({ error: "assistant_error" }), { status: 502, headers });
      }
      return new Response(JSON.stringify({ reply }), { status: 200, headers });
    }
    return new Response(JSON.stringify({ error: "assistant_error" }), { status: 502, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: "assistant_error" }), { status: 502, headers });
  }
}

// --- محرك عام: تعليمات + محادثة ← نص الجواب (يستخدمه بوت تلغرام) -------------
// نفس ترتيب الأفضلية: Claude إن وجد المفتاح، وإلا Workers AI المجاني، وإلا null.
// الحقائق توضع في التعليمات مباشرة (بلا أدوات) فيعمل المساران بسلوك واحد.
export async function askAssistant(env, system, messages) {
  const convo = (messages || []).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, ASSISTANT_MAX_CHARS) }))
    .filter((m) => m.content.trim()).slice(-ASSISTANT_MAX_MESSAGES);
  if (!convo.length) return null;
  if (env.ANTHROPIC_API_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model: ASSISTANT_MODEL, max_tokens: 700, system, messages: convo }),
        cf: NO_CACHE,
      });
      if (res.ok) {
        const data = await res.json();
        const reply = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
        if (reply) return reply;
      }
    } catch (e) { /* نسقط إلى Workers AI */ }
  }
  if (env.AI) {
    try {
      const out = await env.AI.run(WORKERS_AI_MODEL, {
        messages: [{ role: "system", content: system }].concat(convo),
        max_tokens: 600,
        temperature: 0.2,
      });
      const reply = String((out && (out.response || out.result)) || "").trim();
      if (reply) return reply;
    } catch (e) { console.error("[assistant] telegram workers-ai failed:", String((e && e.message) || e).slice(0, 200)); }
  }
  return null;
}

// --- مسار Workers AI المجاني -----------------------------------------------
// نفس الأدوات بصيغة OpenAI-style function calling التي يفهمها Workers AI.
const WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/* Workers AI لا يجيد استدعاء الأدوات، فنضع الحقائق كلها في التعليمات ونطلب
   إجابة واحدة مباشرة. هكذا لا يخترع أزرارا ولا أسعارا. */
async function groundedSystemPrompt(env) {
  let stats = {};
  try { stats = await toolPlatformStats(env); } catch (e) { stats = {}; }
  const facts = { plans: PLANS, app: toolAppInfo(), live_stats: stats };
  return assistantSystemPrompt() +
    "\n\nالحقائق المعتمدة (لا تخرج عنها ولا تخترع غيرها):\n" +
    JSON.stringify(facts) +
    "\n\nأسلوب الرد:\n" +
    "- أجب عن سؤال الزائر مباشرة بجملتين أو ثلاث، بلا مقدمات ولا خواتيم مثل \"هل لديك أسئلة أخرى\".\n" +
    "- لا تذكر اسم زر أو شاشة غير موجودة في الحقائق أعلاه؛ صف الخطوة بكلماتك.\n" +
    "- إن كانت الرسالة تحية أو غير مفهومة: رحب بسطر واحد ثم اعرض ثلاثة أمور تستطيع مساعدته فيها (الباقات، استيراد إكسل، التنبيهات).\n" +
    "- إن لم تعرف الجواب من الحقائق: قل ذلك صراحة ووجهه إلى support@appmails.net.";
}

async function workersAiAssistant(messages, env, headers) {
  try {
    const out = await env.AI.run(WORKERS_AI_MODEL, {
      messages: [{ role: "system", content: await groundedSystemPrompt(env) }].concat(messages),
      max_tokens: 700,
      temperature: 0.3,
    });
    const reply = String((out && (out.response || out.result)) || "").trim();
    if (reply) {
      return new Response(JSON.stringify({ reply, engine: "workers-ai" }), { headers });
    }
  } catch (e) { /* نسقط إلى المسار القديم بالأدوات */ }
  return workersAiAssistantWithTools(messages, env, headers);
}

async function workersAiAssistantWithTools(messages, env, headers) {
  const tools = TOOLS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
  const msgs = [{ role: "system", content: assistantSystemPrompt() }].concat(messages);

  try {
    for (let round = 0; round <= ASSISTANT_MAX_TOOL_ROUNDS; round++) {
      const out = await env.AI.run(WORKERS_AI_MODEL, {
        messages: msgs,
        tools,
        max_tokens: ASSISTANT_MAX_TOKENS,
      });
      const calls = out && Array.isArray(out.tool_calls) ? out.tool_calls : [];

      if (calls.length && round < ASSISTANT_MAX_TOOL_ROUNDS) {
        /* Workers AI يتحقق من صيغة OpenAI الكاملة في الجولة التالية:
           id + type:"function" لكل استدعاء، وtool_call_id في نتيجة الأداة */
        const normalized = calls.map((c, i) => {
          const fn = c.function || c;
          const name = fn.name || c.name;
          const rawArgs = fn.arguments != null ? fn.arguments : c.arguments;
          const argsStr = typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs || {});
          let argsObj = {};
          try { argsObj = JSON.parse(argsStr) || {}; } catch { argsObj = {}; }
          return { id: c.id || ("call_" + round + "_" + i), name, argsStr, argsObj };
        });
        msgs.push({
          role: "assistant",
          content: String((out && out.response) || ""),
          tool_calls: normalized.map((n) => ({
            id: n.id,
            type: "function",
            function: { name: n.name, arguments: n.argsStr },
          })),
        });
        for (const n of normalized) {
          let result;
          try {
            result = await callTool(n.name, n.argsObj, env);
          } catch (e) {
            result = { error: String((e && e.message) || e) };
          }
          msgs.push({
            role: "tool",
            tool_call_id: n.id,
            name: n.name,
            content: JSON.stringify(result).slice(0, 12000),
          });
        }
        continue;
      }

      const reply = String((out && out.response) || "").trim();
      if (!reply) {
        console.error("[assistant] workers-ai empty reply; keys=", out && typeof out === "object" ? Object.keys(out).join(",") : typeof out);
        return new Response(JSON.stringify({ error: "assistant_error" }), { status: 502, headers });
      }
      return new Response(JSON.stringify({ reply, engine: "workers-ai" }), { status: 200, headers });
    }
    return new Response(JSON.stringify({ error: "assistant_error" }), { status: 502, headers });
  } catch (e) {
    const detail = String((e && e.message) || e).slice(0, 300);
    console.error("[assistant] workers-ai failed:", detail);
    return new Response(JSON.stringify({ error: "assistant_error" }), { status: 502, headers });
  }
}
