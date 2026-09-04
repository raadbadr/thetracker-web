/* ترجمة العرض التلقائية: نص حر كتبه مستخدم بلغة يظهر لمستخدم آخر بلغة واجهته.
   - كشف لغة المصدر من الحروف (عربي / أردو / لاتيني)، ولا يُترجم ما لغته لغة الهدف أو ما هو أرقام ورموز فقط.
   - تخزين مؤقت في القاعدة بمفتاح sha256(الهدف + النص) عبر دالتَي RPC محميتين بسر الـ Worker.
   - النموذج: llama-3.3-70b (اختير بعد مقارنة فعلية: يحفظ أسماء الشركات والأشخاص والأرقام)، واحتياط gpt-oss-20b.
   - العربية في الناتج بلا تشكيل (قاعدة المهندس رعد). */
import { rpc } from "./notify.js";

const PRIMARY_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const FALLBACK_MODEL = "@cf/openai/gpt-oss-20b";
const LANG_NAMES = { ar: "Arabic", en: "English", fr: "French", ur: "Urdu" };
const MAX_TEXTS = 40;
const MAX_CHARS = 600;

const URDU_LETTERS = /[ٹڈڑںھہۃیےۓکگ]/;
const ARABIC_LETTERS = /[ء-يٱ-ۓ]/;
const LATIN_LETTERS = /[A-Za-zÀ-ɏ]/;
const FRENCH_HINTS = /[àâçéèêëîïôûùüÿœ]|\b(le|la|les|des|du|une|un|et|pour|avec|dans|sur|est|sont|par)\b/i;

export function detectLang(text) {
  const t = String(text || "");
  if (!/[A-Za-zÀ-ɏ؀-ۿ]/.test(t)) return "none";      /* أرقام ورموز فقط */
  const arabicCount = (t.match(/[؀-ۿ]/g) || []).length;
  const latinCount = (t.match(/[A-Za-zÀ-ɏ]/g) || []).length;
  if (arabicCount >= latinCount) return URDU_LETTERS.test(t) ? "ur" : "ar";
  return FRENCH_HINTS.test(t) ? "fr" : "en";
}

export function stripArabicDiacritics(text) {
  return String(text || "").replace(/[ً-ْٰ]/g, "");
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function systemPrompt(target) {
  return "You translate short user-written texts from a legal and business tracking app into " + LANG_NAMES[target] + ". " +
    "Translate faithfully and naturally; keep the register (titles stay short). Keep proper names of people and companies, case numbers, " +
    "identifiers, dates, amounts and URLs exactly as written (transliterate a personal name only if it has no Latin form). " +
    (target === "ar" || target === "ur" ? "Do not use any diacritics (tashkeel). " : "") +
    "Return ONLY a JSON array of strings with exactly the same length and order as the input array. No commentary.";
}

function parseArray(raw, expected) {
  const s = String(raw || "");
  const start = s.indexOf("["), end = s.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  try {
    const arr = JSON.parse(s.slice(start, end + 1));
    if (!Array.isArray(arr) || arr.length !== expected) return null;
    return arr.map((x) => (x == null ? "" : String(x)));
  } catch { return null; }
}

async function runModel(env, model, target, texts) {
  const user = "Input JSON array:\n" + JSON.stringify(texts);
  let out;
  if (model.indexOf("gpt-oss") !== -1) {
    const res = await env.AI.run(model, { input: systemPrompt(target) + "\n\n" + user, reasoning: { effort: "low" } });
    out = "";
    for (const item of (res && res.output) || []) if (item.type === "message") for (const c of item.content || []) out += c.text || "";
  } else {
    const res = await env.AI.run(model, { messages: [{ role: "system", content: systemPrompt(target) }, { role: "user", content: user }], max_tokens: 1800, temperature: 0.1 });
    out = res && (res.response || res.result) || "";
  }
  return parseArray(out, texts.length);
}

/* يترجم دفعة بحد أقصى 40 نصا؛ يعيد مصفوفة بنفس الترتيب (النص كما هو إن لم يحتج ترجمة أو فشلت) */
export async function translateBatch(env, texts, target) {
  const out = texts.map((t) => String(t == null ? "" : t).slice(0, MAX_CHARS));
  const need = []; /* مؤشرات ما يحتاج ترجمة */
  out.forEach((t, i) => { if (t.trim() && detectLang(t) !== "none" && detectLang(t) !== target) need.push(i); });
  if (!need.length) return { translations: out, cached: 0, translated: 0 };

  const hashes = await Promise.all(need.map((i) => sha256Hex(target + "\n" + out[i])));
  let cached = {};
  try {
    const rows = await rpc(env, "translations_get", { p_secret: env.WORKER_SECRET, p_hashes: hashes });
    for (const r of rows || []) cached[r.hash] = r.text_out;
  } catch (e) { cached = {}; }

  const missing = need.filter((i, k) => !cached[hashes[k]]);
  need.forEach((i, k) => { if (cached[hashes[k]]) out[i] = cached[hashes[k]]; });

  let translated = 0;
  if (missing.length && env.AI) {
    const inputs = missing.map((i) => out[i]);
    let result = null, model = PRIMARY_MODEL;
    try { result = await runModel(env, PRIMARY_MODEL, target, inputs); } catch (e) { result = null; }
    if (!result) { model = FALLBACK_MODEL; try { result = await runModel(env, FALLBACK_MODEL, target, inputs); } catch (e) { result = null; } }
    if (result) {
      const rows = [];
      missing.forEach((i, k) => {
        let t = String(result[k] || "").trim();
        if (target === "ar" || target === "ur") t = stripArabicDiacritics(t);
        if (!t) return;
        out[i] = t; translated++;
        rows.push({ hash: hashes[need.indexOf(i)], target, source_lang: detectLang(inputs[k]), text_out: t, model });
      });
      if (rows.length) { try { await rpc(env, "translations_put", { p_secret: env.WORKER_SECRET, p_rows: rows }); } catch (e) { /* التخزين المؤقت اختياري */ } }
    }
  }
  return { translations: out, cached: need.length - missing.length, translated };
}

export async function handleTranslate(request, env) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!body || !Array.isArray(body.texts)) return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400, headers });
  const target = String(body.target || "").toLowerCase();
  if (!LANG_NAMES[target]) return new Response(JSON.stringify({ error: "bad_target" }), { status: 400, headers });
  const texts = body.texts.slice(0, MAX_TEXTS);
  const result = await translateBatch(env, texts, target);
  return new Response(JSON.stringify(result), { headers });
}
