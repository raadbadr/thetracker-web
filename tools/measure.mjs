/* قياس صفحات التطبيق على الجوال واللوح والحاسب بكروم المثبت محليا وخلفية وهمية (لا يلمس قاعدة الإنتاج).
   الاستعمال:  npm i   ثم   node tools/measure.mjs dashboard,settings   (بلا وسيط: كل الصفحات)
   المطلوب قبل أي نشر يمس الصفحات: overflow=no، err=0، loading=false، booting=false، scrollY=0.
   اللقطات في .measure-shots/ (متجاهلة في git). يفهم حزم الأجزاء (x.js.parts.json) كما يفعل الـ Worker. */
import puppeteer from "puppeteer-core";
import http from "http"; import fs from "fs"; import path from "path";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = process.env.OUT || path.join(ROOT, ".measure-shots");
fs.mkdirSync(OUT, { recursive: true });
const pages = (process.argv[2] || "dashboard,documents,team,settings,admin,import,processes,risks").split(",");
const sizes = (process.env.SIZES ? process.env.SIZES.split(",").map((w) => [Number(w), 900, w]) : [[375, 812, "phone"], [768, 1024, "tablet"], [1280, 900, "desktop"]]);
const REF = "stubproj"; const SB = "https://stubproj.supabase.co";
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", app_metadata: { provider: "google" }, user_metadata: { full_name: "المهندس رعد بدر" }, aud: "authenticated", role: "authenticated" };
const ORG = { id: "22222222-2222-4222-8222-222222222222", name: "PARKINZI Company", owner_id: USER.id, plan_code: "trial", plan_expires_at: "2026-09-18T00:00:00Z", org_number: "ORG-05092026-0001", created_at: "2026-09-04T21:39:44Z" };
const PROFILE = { id: USER.id, full_name: "المهندس رعد بدر", email: USER.email, phone: "0500000000", lang: process.env.LANG_UI || "ar", tz: "Asia/Riyadh", is_platform_admin: true, profile_number: "USR-01092026-0001", storage_mode: "platform" };
const MEMBER = { org_id: ORG.id, user_id: USER.id, role: "owner", status: "active", department: "management", created_at: "2026-09-04T21:39:44Z", organizations: ORG };
const item = (i, kind) => ({ id: "3333333" + String(i).padStart(5, "0") + "-3333-4333-8333-333333333333", org_id: ORG.id, kind, title: (kind === "violation" ? "مخالفة بلدية رقم " : "قضية تجارية رقم ") + (1000 + i), status: i % 3 ? "open" : "done", due_date: "2026-09-" + String(10 + (i % 18)).padStart(2, "0"), due_at: "2026-09-" + String(10 + (i % 18)).padStart(2, "0") + "T09:00:00Z", amount: 1500 * (i + 1), client_name: "شركة العميل " + i, case_number: "4470" + (100000 + i), item_number: "ITM-05092026-" + String(i + 1).padStart(4, "0"), data: { "المحكمة": "المحكمة التجارية بالرياض", "الحالة": "قيد النظر" }, created_at: "2026-09-0" + (1 + (i % 4)) + "T10:00:00Z", parent_id: null });
const ITEMS = Array.from({ length: 12 }, (_, i) => item(i, i % 2 ? "violation" : "case"));
function stub(url, method, body) {
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


  if (p.includes("/rest/v1/rpc/platform_stats")) return { users: 12, orgs: 3, items: 120 };
  /* أحداث الخط الزمني في الشهر الجاري، اثنان منها في يوم واحد (للتنقل بين المتزامنة) */
  if (p.includes("/rest/v1/rpc/activity_feed")) { const y = new Date().getFullYear(), m = new Date().getMonth(); const at = (d, h) => new Date(y, m, d, h, 0, 0).toISOString();
    return [{ at: at(2, 9), kind: "import", title: "التقرير الشامل للمخالفات", meta: {} }, { at: at(4, 10), kind: "attachment", title: "السجل التجاري — PARKINZI Company", meta: {} }, { at: at(4, 10), kind: "item_done", title: "قضية تجارية رقم 1002", meta: {} }, { at: at(5, 8), kind: "member", title: "المهندس رعد بدر", meta: {} }, { at: at(5, 12), kind: "item_created", title: "RSK-05092026-0001 · عدم ارتكاب المخالفة والالتزام بالإجراءات والمقاييس المعتمدة في كل الفروع", meta: {} }]; }
  if (p.includes("/rest/v1/rpc/")) return [];
  if (p.includes("/rest/v1/profiles")) return u.searchParams.has("id") && !u.searchParams.get("id").includes("in.") ? PROFILE : [PROFILE];
  if (p.includes("/rest/v1/org_members")) return [MEMBER];
  if (p.includes("/rest/v1/organizations")) return [ORG];
  if (p.includes("/rest/v1/org_profiles")) return { org_id: ORG.id, entity_type: "company", legal_name: ORG.name, cr_number: "7055060102", national_address: { short: "RRRD2929" } };
  if (p.includes("/rest/v1/items")) return ITEMS;
  if (p.includes("/rest/v1/plans")) return [{ code: "trial", name_ar: "التجريبية", name_en: "Trial", limits: { items: 2000, members: 5, storage_mb: 50, channels: ["telegram"], calendar: ["ics", "google"] }, sort_order: 1 }, { code: "monthly", name_ar: "شهري", name_en: "Monthly", price_monthly_sar: 49, limits: { items: 2000, members: 5, storage_mb: 1000, channels: ["telegram"] }, sort_order: 2 }];
  if (p.includes("/rest/v1/notifications")) return [];
  if (p.includes("/rest/v1/")) return [];
  return null;
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (u.pathname === "/api/config") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ supabaseUrl: SB, supabaseAnonKey: "stub-anon", googleClientId: "1-x.apps.googleusercontent.com", telegramBot: "TheTrakerBot" })); }
  if (u.pathname === "/api/stats") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ users: 12 })); }
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
  const ext = path.extname(file); const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp", ".jpg": "image/jpeg" };
  res.setHeader("Content-Type", types[ext] || "application/octet-stream"); res.end(fs.readFileSync(file));
}).listen(0);
const base = "http://localhost:" + server.address().port;
const chrome = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const report = [];
for (const name of pages) {
  for (const [w, h, label] of sizes) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 900, hasTouch: w < 900 });
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      const url = r.url();
      const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS", "access-control-expose-headers": "*", "access-control-max-age": "600" };
      if (url.startsWith(SB) && r.method() === "OPTIONS") return r.respond({ status: 204, headers: cors, body: "" });
      if (url.startsWith(SB)) { const body = stub(url, r.method(), r.postData()); return r.respond({ status: 200, contentType: "application/json", headers: { ...cors, "content-range": "0-9/10" }, body: JSON.stringify(body ?? []) }); }
      if (/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.g|googleapis|cloudflareinsights|accounts\.google/.test(url) && !/supabase-js|xlsx|qrcode|pdf/.test(url)) return r.respond({ status: 200, contentType: "text/css", body: "" });
      r.continue();
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push((String(e.message) + " @ " + String(e.stack || "").split("\n").slice(1, 3).join(" > ").replace(/http:\/\/localhost:\d+/g, "")).slice(0, 260)));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160)); });
    page.on("response", (res) => { if (res.status() >= 400) errors.push("http " + res.status() + ": " + res.url().replace(base, "").slice(0, 120)); });
    await page.evaluateOnNewDocument((key, sess) => { localStorage.setItem(key, JSON.stringify(sess)); localStorage.setItem("tracker_lang", "ar"); localStorage.setItem("tracker_org", "22222222-2222-4222-8222-222222222222"); }, "sb-" + REF + "-auth-token", { access_token: "stub", refresh_token: "r", token_type: "bearer", expires_in: 36000, expires_at: Math.floor(Date.now() / 1000) + 36000, user: USER });
    try { await page.goto(base + "/app/" + name + ".html", { waitUntil: "networkidle0", timeout: 45000 }); } catch (e) { errors.push("goto: " + e.message.slice(0, 120)); }
    await new Promise((r) => setTimeout(r, 1200));
    const m = await page.evaluate(() => {
      const de = document.documentElement; const vw = window.innerWidth;
      const wide = []; document.querySelectorAll("body *").forEach((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); let anc = el.parentElement, offCanvas = false; while (anc && anc !== document.body) { const acs = getComputedStyle(anc); if (acs.position === "fixed" && acs.transform !== "none") { offCanvas = true; break; } anc = anc.parentElement; } if (!offCanvas && r.width > 0 && (r.right > vw + 1 || r.left < -1) && cs.position !== "fixed" && cs.visibility !== "hidden" && cs.opacity !== "0" && cs.display !== "none" && !el.closest("[hidden]")) wide.push((el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "")) + " " + Math.round(r.left) + "→" + Math.round(r.right)); });
      const small = []; document.querySelectorAll("a,button,input,select,textarea,[role=button]").forEach((el) => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && (r.height < 32 || r.width < 32) && getComputedStyle(el).visibility !== "hidden") small.push((el.id || el.className || el.tagName).toString().slice(0, 40) + " " + Math.round(r.width) + "x" + Math.round(r.height)); });
      const tiny = []; document.querySelectorAll("input,select,textarea").forEach((el) => { const fs = parseFloat(getComputedStyle(el).fontSize); if (fs && fs < 16 && el.offsetParent) tiny.push((el.id || el.name || el.tagName) + ":" + fs); });
      const tb = document.getElementById("appTopbar"); const tbr = tb ? tb.getBoundingClientRect() : null; const tbs = tb ? getComputedStyle(tb) : null;
      let widest = null; document.querySelectorAll("body *").forEach((el) => { const r = el.getBoundingClientRect(); if (r.width > vw + 1 && (!widest || r.width > widest.w)) widest = { w: Math.round(r.width), sel: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "") }; });
      const dbg = { topbar: tbr ? { pos: tbs.position, x: Math.round(tbr.left), w: Math.round(tbr.width), parent: tb.parentElement.tagName.toLowerCase() + (tb.parentElement.id ? "#" + tb.parentElement.id : "") + "." + String(tb.parentElement.className).split(" ")[0] } : null, bodyW: document.body.scrollWidth, widest };
      const cal = document.getElementById("calendarPanel"); const calRect = cal && cal.offsetParent ? cal.getBoundingClientRect() : null;
      const statsEl = document.querySelector(".stats-section"); const statsTop = statsEl && statsEl.offsetParent ? statsEl.getBoundingClientRect().top + window.scrollY : null;
      /* المطلوب: المربعات الأربعة ثم التقويم مباشرة (أمر المهندس رعد)؛ أي شيء آخر بينهما أو إخفاء = خطأ */
      let calendarState = !cal ? "n/a" : (!calRect ? "HIDDEN" : "visible");
      if (calRect && statsEl && statsEl.offsetParent) { let n = statsEl.nextElementSibling; while (n && n.hidden) n = n.nextElementSibling; calendarState = n && n.contains(cal) ? "visible-after-tiles" : "visible-WRONG-PLACE"; }
      return { calendarState, booting: document.documentElement.classList.contains("app-booting"), scrollY: window.scrollY, dbg, scrollWidth: de.scrollWidth, innerWidth: vw, overflow: de.scrollWidth > vw + 1, wide: wide.slice(0, 12), wideCount: wide.length, smallTargets: small.slice(0, 10), smallCount: small.length, tinyInputs: tiny.slice(0, 8), sidebar: !!document.getElementById("appSidebar"), topbar: !!document.getElementById("appTopbar") && document.getElementById("appTopbar").children.length, loading: !!(document.getElementById("loadingCard") && document.getElementById("loadingCard").offsetParent), bodyText: document.body.innerText.slice(0, 80).replace(/\s+/g, " ") };
    });
    await page.screenshot({ path: `${OUT}/${name}-${label}.png`, fullPage: false });
    /* لقطة عنصر بعينه للتحقق البصري: SHOT_SEL=#id، وقبلها PREP_JS يجهز الحالة (مثل إظهار عنوان إنجاز) */
    if (process.env.PREP_JS) { try { await page.evaluate(process.env.PREP_JS); await new Promise((r) => setTimeout(r, 250)); } catch (e) { errors.push("prep: " + e.message.slice(0, 120)); } }
    if (process.env.SHOT_SEL) { const el = await page.$(process.env.SHOT_SEL); if (el) { await el.evaluate((n) => n.scrollIntoView({ block: "center" })); await new Promise((r) => setTimeout(r, 200)); await el.screenshot({ path: `${OUT}/${name}-${label}-el.png` }); } }
    /* زر الإغلاق الدائري: يقاس بعد اللقطة بفتح اللوحات المخفية — دائرة 40 على بداية الاتجاه */
    const closeX = await page.evaluate(() => {
      ["editPanel", "addItemPanel", "docForm", "editorCard", "renameOrgForm", "newOrgForm", "newTrackerForm"].forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = false; });
      try { if (!document.getElementById("appNewOrg") && window.trackerApp && window.trackerApp.openNewOrgDialog) window.trackerApp.openNewOrgDialog(); } catch (e) { /* الصفحة بلا نافذة حساب */ }
      const rtl = getComputedStyle(document.documentElement).direction === "rtl";
      return [...document.querySelectorAll(".close-x")].map((b) => {
        const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); const host = b.closest(".has-close-x");
        const hr = host ? host.getBoundingClientRect() : null;
        return (b.id || "?") + " " + Math.round(r.width) + "x" + Math.round(r.height) + " r=" + cs.borderRadius.split(" ")[0] +
          " words=" + b.textContent.trim().length + " label=" + (b.getAttribute("aria-label") || "-") +
          (hr ? " inset=" + Math.round(rtl ? hr.right - r.right : r.left - hr.left) : " inline");
      });
    });
    if (await page.$("#appNewOrg")) await page.screenshot({ path: `${OUT}/${name}-${label}-newaccount.png`, fullPage: false });
    report.push({ page: name, size: label, ...m, closeX, errors: errors.slice(0, 4) });
    if (process.env.DEBUG) console.log("   dbg", name, label, JSON.stringify(m.dbg));
    await page.close();
  }
}
await browser.close(); server.close();
fs.writeFileSync(OUT + "/report.json", JSON.stringify(report, null, 1));
for (const r of report) console.log(`${r.page.padEnd(10)} ${r.size.padEnd(8)} overflow=${r.overflow ? "YES " + r.scrollWidth + ">" + r.innerWidth : "no "} wide=${r.wideCount} small=${r.smallCount} tiny=${r.tinyInputs.length} shell=${r.sidebar ? "S" : "-"}${r.topbar ? "T" : "-"} loading=${r.loading} booting=${r.booting} scrollY=${r.scrollY} calendar=${r.calendarState} err=${r.errors.length}${r.wide.length ? "\n    wide: " + r.wide.slice(0, 5).join(" | ") : ""}${r.errors.length ? "\n    err: " + r.errors.slice(0, 2).join(" | ") : ""}${r.closeX && r.closeX.length ? "\n    close-x: " + r.closeX.join(" | ") : ""}`);
