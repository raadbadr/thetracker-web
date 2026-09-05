/* جرد العناصر الظاهرة في صفحة قبل التعديل وبعده — يمنع اختفاء بطاقة أو انزياحها بلا انتباه.
   (قاعدة تجميد التصميم: لا يُحذف ولا يُنقل شيء ظاهر إلا بأمر صريح من المهندس رعد.)

   الاستعمال:
     node tools/inventory.mjs snap processes,risks --size desktop --out .inv/before.json
     … عدّل …
     node tools/inventory.mjs snap processes,risks --size desktop --out .inv/after.json
     node tools/inventory.mjs diff .inv/before.json .inv/after.json     # يخرج 1 إن اختفى عنصر

   الخلفية وهمية كما في tools/measure.mjs: لا تمس قاعدة الإنتاج، وتفهم حزم الأجزاء. */
import puppeteer from "puppeteer-core";
import http from "http"; import fs from "fs"; import path from "path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SIZES = { phone: [375, 812], tablet: [768, 1024], desktop: [1280, 900] };
const REF = "stubproj"; const SB = "https://stubproj.supabase.co";
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", app_metadata: { provider: "google" }, user_metadata: { full_name: "المهندس رعد بدر" }, aud: "authenticated", role: "authenticated" };
const ORG = { id: "22222222-2222-4222-8222-222222222222", name: "PARKINZI Company", owner_id: USER.id, plan_code: "trial", plan_expires_at: "2026-09-18T00:00:00Z", org_number: "ORG-05092026-0001" };
const PROFILE = { id: USER.id, full_name: "المهندس رعد بدر", email: USER.email, phone: "0500000000", lang: "ar", tz: "Asia/Riyadh", is_platform_admin: true, storage_mode: "platform" };
const MEMBER = { org_id: ORG.id, user_id: USER.id, role: "owner", status: "active", department: "management", organizations: ORG };

function stub(url) {
  const u = new URL(url); const p = u.pathname;
  if (p.endsWith("/auth/v1/user")) return { user: USER };
  if (p.endsWith("/auth/v1/token")) return { access_token: "stub", token_type: "bearer", expires_in: 36000, refresh_token: "r", user: USER };
  if (p.includes("/rest/v1/rpc/my_services")) return ["dashboard", "cases", "violations", "team", "settings", "documents", "processes", "risks", "expenses"];
  if (p.includes("/rest/v1/rpc/")) return [];
  if (p.includes("/rest/v1/profiles")) return u.searchParams.has("id") && !u.searchParams.get("id").includes("in.") ? PROFILE : [PROFILE];
  if (p.includes("/rest/v1/org_members")) return [MEMBER];
  if (p.includes("/rest/v1/organizations")) return [ORG];
  if (p.includes("/rest/v1/org_profiles")) return { org_id: ORG.id, entity_type: "company", legal_name: ORG.name, cr_number: "7055060102", national_address: {} };
  if (p.includes("/rest/v1/")) return [];
  return null;
}

function serve() {
  return http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname === "/api/config") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ supabaseUrl: SB, supabaseAnonKey: "stub-anon", googleClientId: "1-x.apps.googleusercontent.com", telegramBot: "TheTrakerBot" })); }
    /* حزم الأجزاء كما يفعل الـ Worker: /app/x.js ← app/x.js.parts.json */
    const bm = u.pathname.match(/^(.*\/)([A-Za-z0-9_.-]+\.(js|css))$/);
    if (bm) {
      const manifest = path.join(ROOT, decodeURIComponent(bm[1]), bm[2] + ".parts.json");
      if (fs.existsSync(manifest)) {
        const parts = JSON.parse(fs.readFileSync(manifest, "utf8"));
        const body = parts.map((rel) => fs.readFileSync(path.join(ROOT, decodeURIComponent(bm[1]), rel), "utf8")).join("");
        res.setHeader("Content-Type", bm[3] === "js" ? "text/javascript" : "text/css"); return res.end(body);
      }
    }
    let file = path.join(ROOT, decodeURIComponent(u.pathname));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("nf"); }
    const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp", ".jpg": "image/jpeg", ".ttf": "font/ttf" };
    res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
    res.end(fs.readFileSync(file));
  }).listen(0);
}

/* ما يُجرد: كل عنصر ظاهر له معرّف، أو من العناصر التي يراها المستخدم بطاقةً أو جدولاً
   أو عنواناً أو زراً — بمفتاح ثابت لا يتغير بتغير النص، وموضعه وحجمه. */
async function snapshot(pages, sizeName) {
  const [w, h] = SIZES[sizeName] || SIZES.desktop;
  const server = serve(); const base = "http://localhost:" + server.address().port;
  const chrome = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  const out = { size: sizeName, viewport: [w, h], pages: {} };
  for (const name of pages) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 900, hasTouch: w < 900 });
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      const url = r.url();
      const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS", "access-control-expose-headers": "*" };
      if (url.startsWith(SB) && r.method() === "OPTIONS") return r.respond({ status: 204, headers: cors, body: "" });
      if (url.startsWith(SB)) return r.respond({ status: 200, contentType: "application/json", headers: { ...cors, "content-range": "0-9/10" }, body: JSON.stringify(stub(url) ?? []) });
      if (/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.g|googleapis|cloudflareinsights|accounts\.google/.test(url) && !/supabase-js|xlsx|qrcode|pdf/.test(url)) return r.respond({ status: 200, contentType: "text/css", body: "" });
      r.continue();
    });
    await page.evaluateOnNewDocument((key, sess) => {
      localStorage.setItem(key, JSON.stringify(sess));
      localStorage.setItem("tracker_lang", "ar");
      localStorage.setItem("tracker_org", "22222222-2222-4222-8222-222222222222");
    }, "sb-" + REF + "-auth-token", { access_token: "stub", refresh_token: "r", token_type: "bearer", expires_in: 36000, expires_at: Math.floor(Date.now() / 1000) + 36000, user: USER });
    try { await page.goto(base + "/app/" + name + ".html", { waitUntil: "networkidle0", timeout: 45000 }); } catch (e) { /* تُسجَّل الصفحة بما ظهر */ }
    await new Promise((r) => setTimeout(r, 1200));
    out.pages[name] = await page.evaluate(() => {
      const KEEP = "section,.content,.platform-stat-card,.svc-card,table,form,h1,h2,h3,nav,.tlx,.cal-grid,.chart-card,.ind-card,.total-card,.wl-col,.heat";
      const seen = new Map();
      const key = (el) => {
        if (el.id) return "#" + el.id;
        const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
        const base = el.tagName.toLowerCase() + cls;
        const n = (seen.get(base) || 0) + 1; seen.set(base, n);
        return base + "[" + n + "]";
      };
      const items = [];
      document.querySelectorAll(KEEP).forEach((el) => {
        if (!el.offsetParent && getComputedStyle(el).position !== "fixed") return;      /* مخفي */
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) return;
        items.push({
          key: key(el),
          text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40),
          x: Math.round(r.left), y: Math.round(r.top + window.scrollY),
          w: Math.round(r.width), h: Math.round(r.height),
        });
      });
      return items;
    });
    await page.close();
  }
  await browser.close(); server.close();
  return out;
}

function diff(before, after) {
  let missing = 0, moved = 0, added = 0;
  const names = Array.from(new Set([...Object.keys(before.pages), ...Object.keys(after.pages)]));
  for (const name of names) {
    const b = new Map((before.pages[name] || []).map((i) => [i.key, i]));
    const a = new Map((after.pages[name] || []).map((i) => [i.key, i]));
    const lines = [];
    for (const [k, i] of b) {
      const j = a.get(k);
      if (!j) { missing++; lines.push(`  اختفى   ${k}  «${i.text}»`); continue; }
      const dy = Math.abs(j.y - i.y), dx = Math.abs(j.x - i.x);
      const dw = i.w ? Math.abs(j.w - i.w) / i.w : 0;
      if (dy > 24 || dx > 24 || dw > 0.25) { moved++; lines.push(`  تحرك   ${k}  ${i.x},${i.y} ${i.w}x${i.h} ← ${j.x},${j.y} ${j.w}x${j.h}`); }
    }
    for (const k of a.keys()) if (!b.has(k)) { added++; lines.push(`  جديد   ${k}  «${a.get(k).text}»`); }
    console.log(`${name} (${before.size}): ${lines.length ? "" : "لا تغيير"}`);
    lines.forEach((l) => console.log(l));
  }
  console.log(`\nاختفى ${missing} · تحرك ${moved} · جديد ${added}`);
  return missing;
}

const cmd = process.argv[2];
if (cmd === "snap") {
  const pages = (process.argv[3] || "processes,risks").split(",");
  const sizeArg = process.argv.indexOf("--size");
  const outArg = process.argv.indexOf("--out");
  const size = sizeArg > -1 ? process.argv[sizeArg + 1] : "desktop";
  const out = outArg > -1 ? process.argv[outArg + 1] : ".inv/snapshot.json";
  const data = await snapshot(pages, size);
  fs.mkdirSync(path.dirname(path.resolve(ROOT, out)), { recursive: true });
  fs.writeFileSync(path.resolve(ROOT, out), JSON.stringify(data, null, 1));
  const counts = Object.entries(data.pages).map(([k, v]) => `${k}=${v.length}`).join(" ");
  console.log(`جرد ${size}: ${counts}  →  ${out}`);
} else if (cmd === "diff") {
  const b = JSON.parse(fs.readFileSync(path.resolve(ROOT, process.argv[3]), "utf8"));
  const a = JSON.parse(fs.readFileSync(path.resolve(ROOT, process.argv[4]), "utf8"));
  process.exit(diff(b, a) ? 1 : 0);
} else {
  console.log("snap <pages> [--size phone|tablet|desktop] [--out file]   |   diff <before.json> <after.json>");
  process.exit(2);
}
