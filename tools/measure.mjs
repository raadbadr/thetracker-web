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
const sizes = [[375, 812, "phone"], [768, 1024, "tablet"], [1280, 900, "desktop"]];
const REF = "stubproj"; const SB = "https://stubproj.supabase.co";
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", app_metadata: { provider: "google" }, user_metadata: { full_name: "المهندس رعد بدر" }, aud: "authenticated", role: "authenticated" };
const ORG = { id: "22222222-2222-4222-8222-222222222222", name: "PARKINZI Company", owner_id: USER.id, plan_code: "trial", plan_expires_at: "2026-09-18T00:00:00Z", org_number: "ORG-05092026-0001", created_at: "2026-09-04T21:39:44Z" };
const PROFILE = { id: USER.id, full_name: "المهندس رعد بدر", email: USER.email, phone: "0500000000", lang: process.env.LANG_UI || "ar", tz: "Asia/Riyadh", is_platform_admin: true, profile_number: "USR-01092026-0001", storage_mode: "platform" };
const MEMBER = { org_id: ORG.id, user_id: USER.id, role: "owner", status: "active", department: "management", created_at: "2026-09-04T21:39:44Z", organizations: ORG };
const item = (i, kind) => ({ id: "3333333" + String(i).padStart(5, "0") + "-3333-4333-8333-333333333333", org_id: ORG.id, kind, title: (kind === "violation" ? "مخالفة بلدية رقم " : "قضية تجارية رقم ") + (1000 + i), status: i % 3 ? "open" : "done", due_date: "2026-09-" + String(10 + (i % 18)).padStart(2, "0"), amount: 1500 * (i + 1), client_name: "شركة العميل " + i, case_number: "4470" + (100000 + i), item_number: "ITM-05092026-" + String(i + 1).padStart(4, "0"), data: { "المحكمة": "المحكمة التجارية بالرياض", "الحالة": "قيد النظر" }, created_at: "2026-09-0" + (1 + (i % 4)) + "T10:00:00Z", parent_id: null });
const ITEMS = Array.from({ length: 12 }, (_, i) => item(i, i % 2 ? "violation" : "case"));
function stub(url, method, body) {
  const u = new URL(url); const p = u.pathname;
  if (p.endsWith("/auth/v1/user")) return { user: USER };
  if (p.endsWith("/auth/v1/token")) return { access_token: "stub", token_type: "bearer", expires_in: 36000, refresh_token: "r", user: USER };
  if (p.includes("/rest/v1/rpc/my_services")) return ["dashboard", "cases", "violations", "team", "settings", "documents", "processes", "risks", "expenses"];
  if (p.includes("/rest/v1/rpc/platform_stats")) return { users: 12, orgs: 3, items: 120 };
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
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160)); });
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
      const calendarState = !cal ? "n/a" : (!calRect ? "HIDDEN" : (statsTop !== null && (calRect.top + window.scrollY) > statsTop ? "visible-not-first" : "visible-first"));
      return { calendarState, booting: document.documentElement.classList.contains("app-booting"), scrollY: window.scrollY, dbg, scrollWidth: de.scrollWidth, innerWidth: vw, overflow: de.scrollWidth > vw + 1, wide: wide.slice(0, 12), wideCount: wide.length, smallTargets: small.slice(0, 10), smallCount: small.length, tinyInputs: tiny.slice(0, 8), sidebar: !!document.getElementById("appSidebar"), topbar: !!document.getElementById("appTopbar") && document.getElementById("appTopbar").children.length, loading: !!(document.getElementById("loadingCard") && document.getElementById("loadingCard").offsetParent), bodyText: document.body.innerText.slice(0, 80).replace(/\s+/g, " ") };
    });
    await page.screenshot({ path: `${OUT}/${name}-${label}.png`, fullPage: false });
    report.push({ page: name, size: label, ...m, errors: errors.slice(0, 4) });
    if (process.env.DEBUG) console.log("   dbg", name, label, JSON.stringify(m.dbg));
    await page.close();
  }
}
await browser.close(); server.close();
fs.writeFileSync(OUT + "/report.json", JSON.stringify(report, null, 1));
for (const r of report) console.log(`${r.page.padEnd(10)} ${r.size.padEnd(8)} overflow=${r.overflow ? "YES " + r.scrollWidth + ">" + r.innerWidth : "no "} wide=${r.wideCount} small=${r.smallCount} tiny=${r.tinyInputs.length} shell=${r.sidebar ? "S" : "-"}${r.topbar ? "T" : "-"} loading=${r.loading} booting=${r.booting} scrollY=${r.scrollY} calendar=${r.calendarState} err=${r.errors.length}${r.wide.length ? "\n    wide: " + r.wide.slice(0, 5).join(" | ") : ""}${r.errors.length ? "\n    err: " + r.errors.slice(0, 2).join(" | ") : ""}`);
