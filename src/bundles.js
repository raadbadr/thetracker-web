/* حزم الملفات الكبيرة (قاعدة المهندس رعد: لا ملف مصدر يتجاوز 1000 سطر):
   الملف المطلوب /app/common.js مثلا يخدم بتجميع أجزائه المذكورة في /app/common.js.parts.json
   بالترتيب وبلا أي تغيير في المحتوى، فيبقى سلوك التشغيل واحدا بينما المصدر مقسم أجزاء صغيرة.
   إن لم يوجد ملف أجزاء يترك الطلب للأصول الثابتة كما هو. */
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const TYPES = { js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8" };

export async function serveBundle(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const m = url.pathname.match(/^(.*\/)([A-Za-z0-9_.-]+)\.(js|css)$/);
  if (!m || !env.ASSETS) return null;
  const dir = m[1], name = m[2], ext = m[3];
  const manifestUrl = new URL(`${dir}${name}.${ext}.parts.json`, url.origin);
  const manRes = await env.ASSETS.fetch(new Request(manifestUrl.href));
  if (!manRes.ok) return null;
  let parts;
  try { parts = await manRes.json(); } catch { return null; }
  if (!Array.isArray(parts) || !parts.length) return null;
  const texts = await Promise.all(parts.map(async (rel) => {
    const r = await env.ASSETS.fetch(new Request(new URL(dir + String(rel), url.origin).href));
    if (!r.ok) throw new Error("bundle part missing: " + rel);
    return r.text();
  }));
  const body = texts.join("");
  const etag = `"b-${(await sha256Hex(body)).slice(0, 32)}"`;
  const headers = {
    "content-type": TYPES[ext],
    "cache-control": "public, max-age=0, must-revalidate",
    "etag": etag,
    "x-content-type-options": "nosniff",
    "x-bundle-parts": String(parts.length),
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : body, { headers });
}
