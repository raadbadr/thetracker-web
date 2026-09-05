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
  /* حزم الواجهة كما في القاعدة: PACK=<key> يبدل الشريط الجانبي، والبطاقات تأتي من القائمة نفسها */
  const PACK_ROWS = [
    ["individual", "شخص", "أوراقك الرسمية ومواعيدها ومهامك ومصاريفك", "M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-4.42 0-8 2.24-8 5v3h16v-3c0-2.76-3.58-5-8-5z", [["dashboard","لوحتي"],["documents","أوراقي الرسمية"],["expenses","مصاريفي"],["settings",null]]],
    ["business", "كيان تجاري", "وثيقة عمل حر أو مؤسسة أو شركة", "M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10z", [["dashboard",null],["expenses",null],["documents",null],["team",null],["processes",null],["risks",null],["settings",null]]],
    ["legal", "محاماة وإدارة قانونية", "قضايا ومخالفات ومستندات وفريق وإجراءات ومخاطر", "M12 3l9 4v6c0 5.25-3.75 10.15-9 11.5C6.75 23.15 3 18.25 3 13V7l9-4z", [["dashboard",null],["cases",null],["violations",null],["expenses",null],["documents",null],["processes",null],["risks",null],["team",null],["settings",null]]],
    ["trainer", "مدرب أو محاضر", "دوراتك وجلساتها ومتدربوك وشهاداتك وفواتيرك", "M18 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V4a2 2 0 00-2-2zm0 18H6V4h2v7l2-1.5L12 11V4h6v16z", [["dashboard",null],["cases","الدورات"],["expenses","الفواتير والمصاريف"],["documents","الشهادات والمستندات"],["team","المدربون والمساعدون"],["settings",null]]],
    ["clinic", "عيادة", "مواعيد المراجعين وتراخيص المنشأة وفواتيرها وطاقمها", "M19 8h-2V3H7v5H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2v-9a2 2 0 00-2-2zM9 5h6v3H9V5z", [["dashboard",null],["cases","المراجعون والمواعيد"],["expenses","الفواتير والمصاريف"],["documents","التراخيص والمستندات"],["team","الطاقم الطبي"],["settings",null]]],
    ["engineer", "مهندس أو مكتب هندسي", "مشاريعك ومستخلصاتها ورخصها ومخاطرها وفريقها", "M22 9L12 2 2 9h3v11h5v-6h4v6h5V9h3z", [["dashboard",null],["cases","المشاريع"],["expenses","المستخلصات والمصاريف"],["documents","الرخص والمخططات"],["risks","مخاطر المشاريع"],["team","فريق المشروع"],["settings",null]]],
    ["hr", "موارد بشرية", "الموظفون وعقودهم ووثائقهم ورواتبهم وإجراءات التوظيف", "M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3z", [["dashboard",null],["team","الموظفون"],["expenses","الرواتب والمصاريف"],["documents","العقود والوثائق"],["processes","إجراءات التوظيف"],["settings",null]]],
    ["finance", "مالية", "المصاريف والإيرادات والفواتير والمستحقات والمخاطر المالية", "M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21z", [["dashboard",null],["expenses","المصاريف والإيرادات"],["documents","الفواتير والمستندات"],["risks","المخاطر المالية"],["team",null],["settings",null]]],
    ["sales", "مبيعات", "العملاء والصفقات وعروض الأسعار والعقود والفواتير", "M7 18c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z", [["dashboard",null],["cases","العملاء والصفقات"],["expenses","الفواتير والتحصيل"],["documents","العقود والعروض"],["team","فريق المبيعات"],["settings",null]]],
    ["procurement", "مشتريات", "أوامر الشراء والموردون وعقودهم ومدفوعاتهم", "M19 6h-2c0-2.76-2.24-5-5-5S7 3.24 7 6H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2z", [["dashboard",null],["cases","أوامر الشراء"],["expenses","المدفوعات والمصاريف"],["documents","عقود الموردين"],["team",null],["settings",null]]],
    ["marketing", "تسويق", "الحملات وميزانياتها ومواعيدها وموادها", "M18 11v2h4v-2h-4zm-2 6.61c.96.71 2.21 1.65 3.2 2.39.4-.53.8-1.07 1.2-1.6-.99-.74-2.24-1.68-3.2-2.4z", [["dashboard",null],["cases","الحملات"],["expenses","ميزانية الحملات"],["documents","المواد والمستندات"],["team","فريق التسويق"],["settings",null]]],
    ["design", "تصاميم", "طلبات التصميم ومواعيد تسليمها وملفاتها وفواتيرها", "M12 2l-5.5 9h11L12 2zm5.5 11a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM3 21.5h8v-8H3v8z", [["dashboard",null],["cases","طلبات التصميم"],["expenses","الفواتير والمصاريف"],["documents","الملفات والمخرجات"],["team",null],["settings",null]]]
  ];
  if (p.includes("/rest/v1/rpc/my_pack_config")) {
    const k = process.env.PACK || "legal";
    const row = PACK_ROWS.filter((r) => r[0] === k)[0] || PACK_ROWS.filter((r) => r[0] === "legal")[0];
    return { pack: row[0], names: { ar: row[1], en: row[0], fr: row[0], ur: row[1] }, labels: {}, is_default: row[0] === "legal",
             services: row[4].map(([service, label], i) => ({ service, sort: i + 1, label: label ? { ar: label, en: label, fr: label, ur: label } : null })) };
  }
  if (p.includes("/rest/v1/rpc/list_ui_packs")) return PACK_ROWS.map((r) => ({
    key: r[0], names: { ar: r[1], en: r[0], fr: r[0], ur: r[1] }, hints: { ar: r[2], en: r[2], fr: r[2], ur: r[2] },
    icon: r[3], entity_default: r[0] === "individual" ? "individual" : "company",
    entity_choices: r[0] === "individual" ? ["individual"] : ["company", "establishment", "freelance"], is_default: r[0] === "legal"
  }));



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
