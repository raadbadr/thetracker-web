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
  /* حزمة الواجهة: PACK=individual|trainer يبدل الشريط الجانبي كما تفعل القاعدة */
  if (p.includes("/rest/v1/rpc/my_pack_config")) {
    const k = process.env.PACK || "legal";
    const svc = {
      legal: [["dashboard",1,null],["cases",2,null],["violations",3,null],["expenses",4,null],["documents",5,null],["processes",6,null],["risks",7,null],["team",8,null],["settings",9,null]],
      individual: [["dashboard",1,{ar:"لوحتي",en:"My board",fr:"Mon tableau",ur:"میرا بورڈ"}],["documents",2,{ar:"أوراقي الرسمية",en:"My papers",fr:"Mes papiers",ur:"میرے کاغذات"}],["expenses",3,{ar:"مصاريفي",en:"My expenses",fr:"Mes depenses",ur:"میرے اخراجات"}],["settings",4,null]],
      business: [["dashboard",1,null],["expenses",2,null],["documents",3,null],["team",4,null],["processes",5,null],["risks",6,null],["settings",7,null]],
      trainer: [["dashboard",1,null],["cases",2,{ar:"الدورات",en:"Courses",fr:"Formations",ur:"کورسز"}],["expenses",3,{ar:"الفواتير والمصاريف",en:"Invoices and expenses",fr:"Factures et depenses",ur:"رسیدیں اور اخراجات"}],["documents",4,{ar:"الشهادات والمستندات",en:"Certificates and documents",fr:"Attestations et documents",ur:"اسناد اور دستاویزات"}],["team",5,{ar:"المدربون والمساعدون",en:"Trainers and assistants",fr:"Formateurs et assistants",ur:"ٹرینرز اور معاونین"}],["settings",6,null]]
    }[k] || [];
    return { pack: k, names: { ar: k, en: k, fr: k, ur: k }, labels: {}, is_default: k === "legal",
             services: svc.map(([service, sort, label]) => ({ service, sort, label })) };
  }
  if (p.includes("/rest/v1/rpc/list_ui_packs")) return [
    { key: "individual", names: { ar: "شخص", en: "Individual", fr: "Particulier", ur: "فرد" }, hints: { ar: "أوراقك الرسمية ومواعيدها ومهامك ومصاريفك", en: "Your papers, dates, tasks and expenses", fr: "Vos papiers et depenses", ur: "آپ کے کاغذات اور اخراجات" }, icon: "M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-4.42 0-8 2.24-8 5v3h16v-3c0-2.76-3.58-5-8-5z", entity_default: "individual", entity_choices: ["individual"], is_default: false },
    { key: "business", names: { ar: "كيان تجاري", en: "Business entity", fr: "Entite commerciale", ur: "تجارتی ادارہ" }, hints: { ar: "وثيقة عمل حر أو مؤسسة أو شركة: لوحة ومصاريف ومستندات وفريق", en: "Freelance permit, establishment or company", fr: "Permis freelance, etablissement ou societe", ur: "فری لانس، ادارہ یا کمپنی" }, icon: "M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10z", entity_default: "company", entity_choices: ["company", "establishment", "freelance"], is_default: false },
    { key: "trainer", names: { ar: "مدرب أو محاضر", en: "Trainer", fr: "Formateur", ur: "ٹرینر" }, hints: { ar: "دوراتك وجلساتها ومتدربوك وشهاداتك وفواتيرك", en: "Courses, sessions, attendees and invoices", fr: "Formations et factures", ur: "کورسز اور رسیدیں" }, icon: "M18 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V4a2 2 0 00-2-2zm0 18H6V4h2v7l2-1.5L12 11V4h6v16z", entity_default: "freelance", entity_choices: ["freelance", "establishment", "company", "individual"], is_default: false },
    { key: "legal", names: { ar: "إدارة قانونية", en: "Legal department", fr: "Service juridique", ur: "قانونی شعبہ" }, hints: { ar: "قضايا ومخالفات ومستندات وفريق وإجراءات ومخاطر", en: "Cases, violations, documents, team", fr: "Affaires et documents", ur: "مقدمات اور دستاویزات" }, icon: "M12 3l9 4v6c0 5.25-3.75 10.15-9 11.5C6.75 23.15 3 18.25 3 13V7l9-4zm-1 6v2H9v2h2v2h2v-2h2v-2h-2V9h-2z", entity_default: "company", entity_choices: ["company", "establishment", "nonprofit", "government", "freelance"], is_default: true }
  ];


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
