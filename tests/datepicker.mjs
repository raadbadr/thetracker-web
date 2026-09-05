/* يثبت أن منتقي التاريخ الموحد (app/common/part.6.js) يعمل فعلا لا فرضا:
   الحقل الأصلي يخفى ويبقى حاملا للقيمة ISO، النقر على يوم يكتب القيمة ويطلق change،
   وعلى الجوال (375px) تكون النافذة ورقة ملتصقة بأسفل الشاشة. خلفية وهمية لا تمس قاعدة الإنتاج.
   التشغيل: node tests/datepicker.mjs   (يحتاج كروم المثبت محليا) */
import puppeteer from "puppeteer-core";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = process.env.ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SB = "https://stubproj.supabase.co";
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", aud: "authenticated", role: "authenticated", user_metadata: { full_name: "مالك الاختبار" } };
const ORG = { id: "22222222-2222-4222-8222-222222222222", name: "شركة الاختبار", owner_id: USER.id, plan_code: "trial", plan_expires_at: "2026-09-18T00:00:00Z", org_number: "ORG-1", created_at: "2026-09-04T21:39:44Z" };
const PROFILE = { id: USER.id, full_name: "مالك الاختبار", email: USER.email, phone: "+966500000000", lang: "ar", tz: "Asia/Riyadh", storage_mode: "platform", time_format: "24", profile_number: "USR-1" };
const MEMBER = { org_id: ORG.id, user_id: USER.id, role: "owner", status: "active", department: "management", organizations: ORG };
const ITEMS = [{ id: "33333333-0000-4333-8333-333333333333", org_id: ORG.id, kind: "case", title: "قضية تجارية", status: "open", due_at: "2026-09-20T09:00:00Z", amount: 1500, client_name: "شركة العميل", case_number: "4470100000", item_number: "ITM-1", data: {}, created_at: "2026-09-01T10:00:00Z", parent_id: null }];

function stub(url) {
  const u = new URL(url); const p = u.pathname;
  if (p.endsWith("/auth/v1/user")) return { user: USER };
  if (p.endsWith("/auth/v1/token")) return { access_token: "stub", token_type: "bearer", expires_in: 36000, refresh_token: "r", user: USER };
  if (p.includes("/rest/v1/rpc/my_services")) return ["dashboard", "cases", "violations", "team", "settings", "documents", "processes", "risks", "expenses"];
  if (p.includes("/rest/v1/rpc/")) return [];
  if (p.includes("/rest/v1/profiles")) return u.searchParams.has("id") && !u.searchParams.get("id").includes("in.") ? PROFILE : [PROFILE];
  if (p.includes("/rest/v1/org_members")) return [MEMBER];
  if (p.includes("/rest/v1/organizations")) return [ORG];
  if (p.includes("/rest/v1/org_profiles")) return { org_id: ORG.id, entity_type: "company", legal_name: ORG.name };
  if (p.includes("/rest/v1/items")) return ITEMS;
  if (p.includes("/rest/v1/trackers")) return [{ id: "66666666-6666-4666-8666-666666666666", org_id: ORG.id, name: "القضايا" }];
  if (p.includes("/rest/v1/plans")) return [{ code: "trial", name_ar: "التجريبية", name_en: "Trial", limits: { items: 2000, members: 5, storage_mb: 50, channels: ["telegram"] }, sort_order: 1 }];
  if (p.includes("/rest/v1/")) return [];
  return null;
}

/* الخادم يجمع حزم الأجزاء (x.js.parts.json) كما يفعل الـ Worker */
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (u.pathname === "/api/config") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ supabaseUrl: SB, supabaseAnonKey: "stub-anon", googleClientId: "1-x.apps.googleusercontent.com", telegramBot: "TheTrakerBot" })); }
  if (u.pathname === "/api/stats") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ users: 1 })); }
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
  const ext = path.extname(file); const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp" };
  res.setHeader("Content-Type", types[ext] || "application/octet-stream"); res.end(fs.readFileSync(file));
}).listen(0);
const base = "http://localhost:" + server.address().port;
const chrome = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-gpu"] });

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? "  -> " + JSON.stringify(detail) : ""));
  if (!ok) failures++;
}

/* حقل العرض يسبق الحقل الأصلي داخل .dp-wrap، فلا يصل إليه محدد CSS من معرف الأصل */
async function displayOf(page, id) {
  const native = await page.$("#" + id);
  const display = await native.evaluateHandle((el) => el.closest(".dp-wrap").querySelector(".dp-input"));
  /* الشريطان العلويان ثابتان؛ نضع الحقل في منتصف الشاشة كي لا تقع النقرة تحتهما */
  await display.evaluate((el) => el.scrollIntoView({ block: "center" }));
  return display;
}

async function openPage(pagePath, width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 900, hasTouch: width < 900 });
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const url = r.url();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS", "access-control-expose-headers": "*" };
    if (url.startsWith(SB) && r.method() === "OPTIONS") return r.respond({ status: 204, headers: cors, body: "" });
    if (url.startsWith(SB)) return r.respond({ status: 200, contentType: "application/json", headers: { ...cors, "content-range": "0-9/10" }, body: JSON.stringify(stub(url) ?? []) });
    if (/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.g|googleapis|cloudflareinsights|accounts\.google/.test(url) && !/supabase-js|xlsx|qrcode|pdf/.test(url)) return r.respond({ status: 200, contentType: "text/css", body: "" });
    r.continue();
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160)); });
  await page.evaluateOnNewDocument((key, sess) => { localStorage.setItem(key, JSON.stringify(sess)); localStorage.setItem("tracker_lang", "ar"); localStorage.setItem("tracker_org", "22222222-2222-4222-8222-222222222222"); }, "sb-stubproj-auth-token", { access_token: "stub", refresh_token: "r", token_type: "bearer", expires_in: 36000, expires_at: Math.floor(Date.now() / 1000) + 36000, user: USER });
  await page.goto(base + pagePath, { waitUntil: "networkidle0", timeout: 45000 });
  await page.waitForFunction(() => !document.documentElement.classList.contains("app-booting"), { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 400));
  return { page, errors };
}

/* ---- الحاسب: لوحة التحكم، حقل موعد الاستحقاق (datetime-local) ---- */
{
  const { page, errors } = await openPage("/app/dashboard.html", 1280, 900);
  const enhanced = await page.evaluate(() => {
    const native = document.getElementById("addDue");
    const wrap = native && native.closest(".dp-wrap");
    const display = wrap && wrap.querySelector(".dp-input");
    return { hasWrap: !!wrap, hasDisplay: !!display, nativeHidden: native ? getComputedStyle(native).display === "none" : null, displayDir: display && display.dir,
             total: document.querySelectorAll('input[type=date],input[type=datetime-local]').length, enhancedCount: document.querySelectorAll('input[data-dp]').length };
  });
  check("dashboard: every date input is enhanced", enhanced.hasWrap && enhanced.hasDisplay && enhanced.total === enhanced.enhancedCount, enhanced);
  check("dashboard: native input hidden, display is rtl for Arabic", enhanced.nativeHidden === true && enhanced.displayDir === "rtl", enhanced);

  /* الصفحة تكتب القيمة مباشرة؛ حقل العرض يجب أن يتبعها بلا حدث */
  const synced = await page.evaluate(() => {
    const native = document.getElementById("addDue");
    native.value = "2026-09-22T09:30";
    const wrap = native.closest(".dp-wrap");
    return { display: wrap.querySelector(".dp-input").value, sub: wrap.querySelector(".dp-sub").textContent };
  });
  check("dashboard: display follows programmatic value (Gregorian + Hijri, Western digits)",
    /22 سبتمبر 2026 09:30/.test(synced.display) && /1448 هـ$/.test(synced.sub) && !/[٠-٩]/.test(synced.display + synced.sub), synced);

  /* نفتح لوحة الإضافة كما يفعل المستخدم ثم ننقر الحقل */
  await page.click("#addItemBtn");
  await page.waitForSelector("#addItemPanel:not([hidden])");
  await page.evaluate(() => {
    const native = document.getElementById("addDue");
    native.value = "";
    window.__dpEvents = { input: 0, change: 0, lastValue: null };
    native.addEventListener("input", () => { window.__dpEvents.input++; });
    native.addEventListener("change", () => { window.__dpEvents.change++; window.__dpEvents.lastValue = native.value; });
  });
  await (await displayOf(page, "addDue")).click();
  await page.waitForSelector(".dp-pop.is-open", { timeout: 3000 });
  const popState = await page.evaluate(() => {
    const pop = document.querySelector(".dp-pop"); const r = pop.getBoundingClientRect();
    const inp = document.getElementById("addDue").closest(".dp-wrap").querySelector(".dp-input").getBoundingClientRect();
    const clear = r.top >= inp.bottom || r.bottom <= inp.top || r.left >= inp.right || r.right <= inp.left;
    const noRoom = inp.bottom + 6 + r.height > window.innerHeight - 8 && inp.top - 6 - r.height < 8 && inp.left - 8 - r.width < 8 && inp.right + 8 + r.width > window.innerWidth - 8;
    return { isSheet: pop.classList.contains("is-sheet"), clearOfInput: clear || noRoom, popHeight: Math.round(r.height), insideViewport: r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
             days: pop.querySelectorAll(".dp-day").length, dows: pop.querySelectorAll(".dp-dow").length, timeVisible: !pop.querySelector(".dp-time").hidden, month: pop.querySelector(".dp-month").textContent,
             pills: Array.from(pop.querySelectorAll(".dp-pill")).map((b) => b.textContent), todayMarked: pop.querySelectorAll(".dp-day.is-today").length };
  });
  check("desktop: popover beside its input (below, above, or alongside) without covering it, inside the viewport, 42 days, time row shown", !popState.isSheet && popState.clearOfInput && popState.insideViewport && popState.days === 42 && popState.dows === 7 && popState.timeVisible && popState.todayMarked === 1, popState);

  await page.click(".dp-pop .dp-day:not(.is-out)");
  await new Promise((r) => setTimeout(r, 100));
  const afterDay = await page.evaluate(() => ({ value: document.getElementById("addDue").value, ev: window.__dpEvents, stillOpen: document.querySelector(".dp-pop").classList.contains("is-open") }));
  check("desktop: clicking a day writes ISO datetime and fires input + change", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(afterDay.value) && afterDay.ev.change >= 1 && afterDay.ev.input >= 1 && afterDay.ev.lastValue === afterDay.value, afterDay);
  check("desktop: datetime picker stays open for the time until Done", afterDay.stillOpen === true, afterDay);

  /* الوقت: تغيير الساعة يعيد كتابة القيمة */
  await page.select(".dp-pop .dp-hour", "14");
  await page.select(".dp-pop .dp-min", "45");
  const afterTime = await page.evaluate(() => document.getElementById("addDue").value);
  check("desktop: hour/minute selects rewrite the time part", /T14:45$/.test(afterTime), afterTime);

  /* التبديل إلى الهجري */
  await page.click('.dp-pop .dp-pill[data-cal="h"]');
  const hijriView = await page.evaluate(() => {
    const pop = document.querySelector(".dp-pop");
    const firstIn = pop.querySelector(".dp-day:not(.is-out)");
    return { month: pop.querySelector(".dp-month").textContent, active: pop.querySelector(".dp-pill.is-active").getAttribute("data-cal"), firstIn: firstIn && firstIn.firstChild.textContent, inCount: pop.querySelectorAll(".dp-day:not(.is-out)").length };
  });
  check("desktop: Hijri grid starts at day 1 with 29 or 30 days", hijriView.active === "h" && hijriView.firstIn === "1" && (hijriView.inCount === 29 || hijriView.inCount === 30) && /هـ$/.test(hijriView.month), hijriView);

  await page.click(".dp-pop .dp-done");
  const closed = await page.evaluate(() => !document.querySelector(".dp-pop").classList.contains("is-open"));
  check("desktop: Done closes the popover", closed);

  /* الكتابة في حقل العرض: هجري ثم ميلادي */
  const typed = await page.evaluate(() => {
    const native = document.getElementById("addDue");
    const display = native.closest(".dp-wrap").querySelector(".dp-input");
    display.focus(); display.value = "1448/03/10 08:15"; display.dispatchEvent(new Event("input", { bubbles: true }));
    display.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const hijri = native.value;
    display.value = "25/12/2026"; display.dispatchEvent(new Event("input", { bubbles: true })); display.blur();
    return { hijri, greg: native.value };
  });
  check("desktop: typed Hijri 1448/03/10 08:15 converts to Gregorian ISO with time", /^\d{4}-\d{2}-\d{2}T08:15$/.test(typed.hijri), typed);
  check("desktop: typed 25/12/2026 keeps the previous time", typed.greg === "2026-12-25T08:15", typed);

  /* الأسهم تحرك اليوم والهروب يغلق */
  await page.evaluate(() => { const d = document.getElementById("addDue").closest(".dp-wrap").querySelector(".dp-input"); d.focus(); });
  await page.keyboard.press("Escape");
  await page.keyboard.press("ArrowDown");
  const arrowed = await page.evaluate(() => ({ value: document.getElementById("addDue").value, open: document.querySelector(".dp-pop").classList.contains("is-open") }));
  check("desktop: ArrowDown moves seven days forward", arrowed.value === "2027-01-01T08:15", arrowed);

  check("dashboard: no page errors", errors.length === 0, errors);
  await page.close();
}

/* ---- الحاسب: المستندات، حقل تاريخ (date) يغلق عند الاختيار ---- */
{
  const { page, errors } = await openPage("/app/documents.html", 1280, 900);
  const state = await page.evaluate(() => {
    const native = document.getElementById("fIssue");
    const wrap = native && native.closest(".dp-wrap");
    if (!wrap) return { enhanced: false };
    /* بطاقة النموذج قد تكون مخفية حتى يختار المستخدم ورقة؛ نظهر سلسلة الأسلاف لنقر حقيقي */
    let el = wrap; while (el && el !== document.body) { if (el.hidden) el.hidden = false; el = el.parentElement; }
    window.__dpChange = 0; native.addEventListener("change", () => { window.__dpChange++; });
    return { enhanced: true, hijriHeight: getComputedStyle(wrap.querySelector(".dp-input")).height };
  });
  check("documents: date input enhanced with the 42px field height", state.enhanced && state.hijriHeight === "42px", state);
  await (await displayOf(page, "fIssue")).click();
  await page.waitForSelector(".dp-pop.is-open", { timeout: 3000 });
  await page.click(".dp-pop .dp-today");
  await new Promise((r) => setTimeout(r, 100));
  const after = await page.evaluate(() => ({ value: document.getElementById("fIssue").value, change: window.__dpChange, open: document.querySelector(".dp-pop").classList.contains("is-open") }));
  const today = new Date(); const iso = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  check("documents: Today writes ISO date, fires change, and closes", after.value === iso && after.change === 1 && after.open === false, after);
  check("documents: no page errors", errors.length === 0, errors);
  await page.close();
}

/* ---- الجوال 375px: ورقة سفلية ملتصقة بأسفل الشاشة ---- */
{
  const { page, errors } = await openPage("/app/dashboard.html", 375, 812);
  await page.evaluate(() => { const p = document.getElementById("addItemPanel"); if (p) p.hidden = false; });
  const display = await displayOf(page, "addDue");
  /* لمسة حقيقية في الجزء الظاهر من الحقل (لوحة التحكم تفيض أفقيا على الجوال حين توجد عناصر: علة قائمة في الصفحة لا في المنتقي) */
  const pt = await display.evaluate((el) => { const r = el.getBoundingClientRect(); const l = Math.max(r.left, 0), rt = Math.min(r.right, window.innerWidth); return { x: (l + rt) / 2, y: r.top + r.height / 2, visibleWidth: rt - l, fullWidth: r.width }; });
  await page.touchscreen.tap(pt.x, pt.y);
  let opened = true;
  try { await page.waitForSelector(".dp-pop.is-open", { timeout: 3000 }); }
  catch (e) { opened = false; }
  check("mobile: a real tap on the display input opens the sheet", opened, pt);
  const sheet = opened ? await page.evaluate(() => {
    const pop = document.querySelector(".dp-pop"); const r = pop.getBoundingClientRect();
    const small = Array.from(pop.querySelectorAll("button,select")).filter((b) => { const br = b.getBoundingClientRect(); return br.width > 0 && br.height > 0 && br.height < 44; }).map((b) => b.className + " " + Math.round(b.getBoundingClientRect().height));
    const display = document.getElementById("addDue").closest(".dp-wrap").querySelector(".dp-input");
    return { isSheet: pop.classList.contains("is-sheet"), bottom: r.bottom, innerHeight: window.innerHeight, left: r.left, right: r.right, innerWidth: window.innerWidth, backdrop: getComputedStyle(document.querySelector(".dp-backdrop")).display, small, readOnly: display.readOnly, scrollLocked: document.body.classList.contains("dp-sheet-open") };
  }) : {};
  check("mobile: popover is a bottom sheet whose bottom edge equals innerHeight (+-1) and spans the width", !!sheet.isSheet && Math.abs(sheet.bottom - sheet.innerHeight) <= 1 && sheet.left <= 0.5 && Math.abs(sheet.right - sheet.innerWidth) <= 1 && sheet.backdrop === "block", sheet);
  check("mobile: every visible control in the sheet is at least 44px tall, display is readonly, body scroll locked", opened && sheet.small.length === 0 && sheet.readOnly === true && sheet.scrollLocked === true, { small: sheet.small, readOnly: sheet.readOnly, scrollLocked: sheet.scrollLocked });
  if (opened) {
    await page.touchscreen.tap(5, 60);   /* لمسة على طبقة التعتيم فوق الورقة */
    await new Promise((r) => setTimeout(r, 150));
    const closed = await page.evaluate(() => !document.querySelector(".dp-pop").classList.contains("is-open") && !document.body.classList.contains("dp-sheet-open"));
    check("mobile: tapping the backdrop closes the sheet", closed);
  }
  check("mobile: no page errors", errors.length === 0, errors);
  await page.close();
}

await browser.close(); server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall date picker checks passed");
process.exit(failures ? 1 : 0);
