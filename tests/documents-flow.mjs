/* يثبت أن صفحة المستندات تعمل فعلا لا فرضا: الجدول وبطاقة الأوراق
   وأزرار العرض والتنزيل والإرفاق، بخلفية وهمية لا تمس قاعدة الإنتاج.
   التشغيل: node tests/documents-flow.mjs   (يحتاج كروم المثبت محليا) */
import puppeteer from "puppeteer-core";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = process.env.ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SB = "https://stubproj.supabase.co";
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", aud: "authenticated", role: "authenticated", user_metadata: {} };
const ORG = { id: "22222222-2222-4222-8222-222222222222", name: "شركة الاختبار", owner_id: USER.id, plan_code: "trial", org_number: "ORG-1" };
const PROFILE = { id: USER.id, full_name: "مالك", email: USER.email, phone: "0500000000", lang: "ar", tz: "Asia/Riyadh", storage_mode: "platform", time_format: "24" };
const WITH_FILE = "33333333-3333-4333-8333-333333333333";
const NO_FILE = "44444444-4444-4444-8444-444444444444";
const ITEMS = [
  { id: WITH_FILE, org_id: ORG.id, title: "الشهادة الضريبية", category: "شهادة ضريبية", status: "open",
    due_at: "2027-01-01T09:00:00Z", client_name: "شركة الاختبار", data: { document_kind: "vat_certificate", number: "300000000000003" } },
  { id: NO_FILE, org_id: ORG.id, title: "السجل التجاري", category: "سجل تجاري", status: "open",
    due_at: "2027-09-01T09:00:00Z", client_name: "شركة الاختبار",
    data: { document_kind: "commercial_register", number: "7055060102",
            details: { cr_number: "7055060102", unified_number: "7001234567", company_name: "شركة الاختبار", city: "الرياض", expiry_date: "2027-09-01" },
            detail_labels: { cr_number: { ar: "رقم السجل", en: "CR number" }, unified_number: { ar: "الرقم الموحد", en: "Unified number" },
                             company_name: { ar: "اسم المنشأة", en: "Company name" }, city: { ar: "المدينة", en: "City" },
                             expiry_date: { ar: "تاريخ الانتهاء", en: "Expiry date" } } } },
];
const ATTACH = [{ id: "55555555-5555-4555-8555-555555555555", org_id: ORG.id, item_id: WITH_FILE,
  name: "الشهادة الضريبية.pdf", mime: "application/pdf", size_bytes: 12345, storage_path: ORG.id + "/" + WITH_FILE + "/x.pdf" }];

function stub(url) {
  const p = new URL(url).pathname;
  if (p.endsWith("/auth/v1/user")) return { user: USER };
  if (p.includes("/rest/v1/rpc/org_documents_status")) {
    return { entity_type: "company", papers: [
      { kind: "vat_certificate", required: true, item_id: WITH_FILE, title: "الشهادة الضريبية", expires_at: "2027-01-01T09:00:00Z", days_left: 300, state: "valid" },
      { kind: "commercial_register", required: true, item_id: NO_FILE, title: "السجل التجاري", expires_at: "2027-09-01T09:00:00Z", days_left: 500, state: "valid" },
      { kind: "gosi_certificate", required: true, item_id: null, state: "missing" },
    ], extra: [] };
  }
  if (p.includes("/rest/v1/rpc/save_org_profile")) return { org_id: ORG.id };
  if (p.includes("/rest/v1/rpc/my_services")) return ["dashboard", "documents", "team", "settings"];
  if (p.includes("/rest/v1/rpc/")) return [];
  if (p.includes("/rest/v1/profiles")) return [PROFILE];
  if (p.includes("/rest/v1/org_members")) return [{ org_id: ORG.id, user_id: USER.id, role: "owner", status: "active", organizations: ORG }];
  if (p.includes("/rest/v1/organizations")) return [ORG];
  if (p.includes("/rest/v1/org_profiles")) return { org_id: ORG.id, entity_type: "company", legal_name: ORG.name };
  if (p.includes("/rest/v1/items")) return ITEMS;
  if (p.includes("/rest/v1/attachments")) return ATTACH;
  if (p.includes("/rest/v1/plans")) return [{ code: "trial", name_ar: "تجريبية", limits: { items: 2000, storage_mb: 200, channels: ["telegram"] } }];
  if (p.includes("/rest/v1/")) return [];
  if (p.includes("/storage/v1/object/sign/")) return { signedURL: "/stub-file.pdf?token=abc" };
  return null;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (u.pathname === "/api/config") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ supabaseUrl: SB, supabaseAnonKey: "stub-anon" })); }
  if (u.pathname === "/stub-file.pdf") { res.setHeader("Content-Type", "application/pdf"); return res.end("%PDF-1.4 stub"); }
  const bundle = u.pathname.match(/^(.*\/)([A-Za-z0-9_.-]+\.(js|css))$/);
  if (bundle) {
    const manifest = path.join(ROOT, decodeURIComponent(bundle[1]), bundle[2] + ".parts.json");
    if (fs.existsSync(manifest)) {
      const parts = JSON.parse(fs.readFileSync(manifest, "utf8"));
      res.setHeader("Content-Type", bundle[3] === "js" ? "text/javascript" : "text/css");
      return res.end(parts.map((rel) => fs.readFileSync(path.join(ROOT, decodeURIComponent(bundle[1]), rel), "utf8")).join(""));
    }
  }
  const file = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end("nf"); }
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ttf": "font/ttf" };
  res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
  res.end(fs.readFileSync(file));
}).listen(0);

const base = "http://localhost:" + server.address().port;
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();

await page.setRequestInterception(true);
page.on("console", (m) => { if (m.type() === "error") console.log("  console:", m.text().slice(0, 160)); });
const profileWrites = [];
const ANALYZED = {
  kind: "vat_certificate", title: "الشهادة الضريبية", number: "300000000000003",
  issuer: "هيئة الزكاة والضريبة والجمارك", party: "شركة الاختبار", party_en: "", issue_date: "2026-01-01", expiry_date: "",
  amount: null, case_number: "", court: "", summary: "", confidence: 0.9,
  details: { tin: "300000000000003", taxpayer_name: "شركة الاختبار", first_filing_due: "2027-04-30", tax_period: "ربع سنوي" },
  detail_labels: { tin: { ar: "الرقم الضريبي", en: "TIN" }, taxpayer_name: { ar: "اسم المكلف", en: "Taxpayer" },
                   first_filing_due: { ar: "أول إقرار مستحق", en: "First filing due" }, tax_period: { ar: "الفترة الضريبية", en: "Tax period" } },
  profile_updates: { vat_number: "300000000000003", legal_name: "شركة الاختبار" }
};
page.on("request", (r) => {
  const url = r.url();
  if (/\/api\/documents\/analyze/.test(url)) return r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ fields: ANALYZED }) });
  if (url.startsWith(SB) && /\/rest\/v1\/org_profiles/.test(url) && r.method() !== "GET" && r.method() !== "OPTIONS") {
    profileWrites.push(r.postData() || "");
  }
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS", "access-control-expose-headers": "*", "access-control-max-age": "600" };
  if (url.startsWith(SB) && r.method() === "OPTIONS") return r.respond({ status: 204, headers: cors, body: "" });
  if (url.startsWith(SB)) { const body = stub(url); return r.respond({ status: 200, contentType: "application/json", headers: { ...cors, "content-range": "0-9/10" }, body: JSON.stringify(body ?? []) }); }
  if (/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.g|googleapis|cloudflareinsights|accounts\.google/.test(url) && !/supabase-js|xlsx|qrcode|pdf/.test(url)) return r.respond({ status: 200, contentType: "text/css", body: "" });
  r.continue();
});
await page.evaluateOnNewDocument((key, sess, orgId) => {
  localStorage.setItem(key, JSON.stringify(sess));
  localStorage.setItem("tracker_lang", "ar");
  localStorage.setItem("tracker_org", orgId);
  window.__downloads = [];
  const create = document.createElement.bind(document);
  document.createElement = function (tag) {
    const el = create(tag);
    if (String(tag).toLowerCase() === "a") {
      const click = el.click.bind(el);
      el.click = function () {
        if (el.hasAttribute("download")) { window.__downloads.push({ href: el.getAttribute("href"), name: el.getAttribute("download") }); return; }
        return click();
      };
    }
    return el;
  };
}, "sb-stubproj-auth-token", { access_token: "stub", refresh_token: "r", token_type: "bearer", expires_in: 36000, expires_at: Math.floor(Date.now() / 1000) + 36000, user: USER }, ORG.id);

const fails = [];
const check = (name, ok, detail) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok || detail == null ? "" : " — " + detail)); if (!ok) fails.push(name); };

await page.goto(base + "/app/documents.html", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 1500));

page.on("console", (m) => { if (m.type() === "error") console.log("  console:", m.text().slice(0, 160)); });
page.on("pageerror", (e) => console.log("  pageerror:", String(e).slice(0, 200)));

const seen = await page.evaluate(() => ({
  rows: document.querySelectorAll("#docsBody tr:not(.detail-line)").length,
  fileLinks: document.querySelectorAll("#docsBody [data-open]").length,
  downloads: document.querySelectorAll("#docsBody [data-get]").length,
  attaches: document.querySelectorAll("#docsBody [data-attach]").length,
  papersRows: document.querySelectorAll("#papersBody tr:not(.detail-line)").length,
  paperOpen: document.querySelectorAll("#papersBody [data-paper-open]").length,
  paperGet: document.querySelectorAll("#papersBody [data-paper-get]").length,
  paperAttach: document.querySelectorAll("#papersBody [data-paper-attach]").length,
  ellipsis: [...document.querySelectorAll("#docsBody *, #papersBody *")].filter((el) => getComputedStyle(el).textOverflow === "ellipsis").length,
  fileName: (document.querySelector("#docsBody [data-open]") || {}).textContent || "",
}));

check("the documents table lists both papers", seen.rows === 2, "rows=" + seen.rows);
check("the stored file is listed by name", seen.fileName.includes(".pdf"), seen.fileName);
check("a download button sits beside the file", seen.downloads === 1, "n=" + seen.downloads);
check("every document offers attach", seen.attaches === 2, "n=" + seen.attaches);
check("the papers card lists the expected papers", seen.papersRows === 3, "rows=" + seen.papersRows);
check("the paper with a file offers view and download", seen.paperOpen === 1 && seen.paperGet === 1, "open=" + seen.paperOpen + " get=" + seen.paperGet);
check("papers without a file offer attach", seen.paperAttach === 1, "n=" + seen.paperAttach);
check("nothing is cut with an ellipsis", seen.ellipsis === 0, "n=" + seen.ellipsis);

const gaps = await page.evaluate(() => {
  const out = {};
  ["#docsBody tr:first-child .row-actions", "#docsBody tr:nth-child(2) .row-actions", "#papersBody tr:first-child .row-actions"].forEach((sel, i) => {
    const box = document.querySelector(sel);
    if (!box) { out[sel] = null; return; }
    const kids = [...box.children].map((el) => el.getBoundingClientRect());
    const g = [];
    for (let k = 1; k < kids.length; k++) {
      const prev = kids[k - 1], cur = kids[k];
      g.push(Math.round(Math.abs(Math.min(prev.left, cur.left) === cur.left ? prev.left - cur.right : cur.left - prev.right)));
    }
    out[sel] = { count: kids.length, gaps: g };
  });
  return out;
});
console.log("  gaps:", JSON.stringify(gaps));
Object.keys(gaps).forEach((sel) => {
  const g = gaps[sel];
  if (!g || g.count < 2) return;
  check("buttons are evenly spaced in " + sel.replace(" .row-actions", ""), new Set(g.gaps).size === 1, JSON.stringify(g.gaps));
});

/* البلاطات: أربع في صف، والنقر يفلتر الجدولين، ونقرة ثانية تعيد الكل */
const tiles = await page.evaluate(() => {
  const list = [...document.querySelectorAll("#papersStats [data-paper-state]")];
  const box = document.getElementById("papersStats").getBoundingClientRect();
  return {
    count: list.length,
    states: list.map((b) => b.getAttribute("data-paper-state")),
    icons: list.filter((b) => b.querySelector("svg")).length,
    buttons: list.filter((b) => b.tagName === "BUTTON" && b.hasAttribute("aria-pressed")).length,
    rows: new Set(list.map((b) => Math.round(b.getBoundingClientRect().top))).size,
    height: Math.round(box.height),
  };
});
check("the papers card shows four state tiles", tiles.count === 4 && tiles.states.join(",") === "valid,expiring,expired,missing", JSON.stringify(tiles.states));
check("each tile carries an icon and is a button", tiles.icons === 4 && tiles.buttons === 4, "icons=" + tiles.icons + " buttons=" + tiles.buttons);
check("the tiles sit on one row on the desktop", tiles.rows === 1, "rows=" + tiles.rows);

const filtered = await page.evaluate(() => {
  const tile = document.querySelector('#papersStats [data-paper-state="missing"]');
  tile.click();
  const after = document.querySelector('#papersStats [data-paper-state="missing"]');
  return {
    pressed: after.getAttribute("aria-pressed"),
    papers: [...document.querySelectorAll("#papersBody tr:not(.detail-line)")].length,
    docs: [...document.querySelectorAll("#docsBody tr:not(.detail-line)")].length,
  };
});
check("pressing a tile filters both tables to that state", filtered.papers === 1 && filtered.docs === 0 && filtered.pressed === "true", JSON.stringify(filtered));

const cleared = await page.evaluate(() => {
  document.querySelector('#papersStats [data-paper-state="missing"]').click();
  return { papers: document.querySelectorAll("#papersBody tr:not(.detail-line)").length, docs: document.querySelectorAll("#docsBody tr:not(.detail-line)").length };
});
check("pressing the same tile again clears the filter", cleared.papers === 3 && cleared.docs === 2, JSON.stringify(cleared));

await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
await new Promise((r) => setTimeout(r, 400));
const small = await page.evaluate(() => {
  const list = [...document.querySelectorAll("#papersStats [data-paper-state]")];
  const rows = new Set(list.map((b) => Math.round(b.getBoundingClientRect().top))).size;
  const card = document.getElementById("papersCard").getBoundingClientRect();
  return { rows, overflow: document.documentElement.scrollWidth > 375, height: Math.round(card.height),
           tile: Math.round(list[0].getBoundingClientRect().height) };
});
console.log("  phone 375:", JSON.stringify(small));
check("the tiles fall into two rows on the phone", small.rows === 2, "rows=" + small.rows);
check("nothing overflows sideways at 375", !small.overflow, "scrollWidth over 375");
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
await new Promise((r) => setTimeout(r, 300));

/* تفاصيل المستند: زر يفتح صفا يعرض كل بيان بتسميته وقيمته كاملة */
const details = await page.evaluate(() => {
  const btn = document.querySelector("#docsBody [data-details]");
  if (!btn) return { missing: true };
  const line = document.querySelector("#docsBody [data-details-for]");
  const before = line.hidden;
  btn.click();
  const rows = [...line.querySelectorAll(".detail-row")].map((r) => ({
    key: r.querySelector(".detail-key").textContent.trim(),
    val: r.querySelector(".detail-val").textContent.trim(),
    cut: getComputedStyle(r.querySelector(".detail-val")).textOverflow === "ellipsis",
  }));
  btn.click();
  return { before, afterHidden: line.hidden, rows };
});
check("a document with read fields offers its details", !details.missing && details.before === true, JSON.stringify(details).slice(0, 120));
check("the details list every field with its label", (details.rows || []).length === 5, "n=" + (details.rows || []).length);
check("dates in the details read day-month-year", (details.rows || []).some((r) => r.val === "01-09-2027"), JSON.stringify((details.rows || []).map((r) => r.val)));
check("no detail value is cut", !(details.rows || []).some((r) => r.cut), "some values truncate");
check("pressing details again folds the row", details.afterHidden === true, "stayed open");

/* بطاقة الأوراق تعرض ما قُرئ من الورقة نفسها */
const paperDetails = await page.evaluate(() => {
  const btn = document.querySelector("#papersBody [data-paper-details]");
  if (!btn) return { missing: true };
  const line = document.querySelector("#papersBody [data-paper-details-for]");
  const before = line.hidden;
  btn.click();
  const rows = [...line.querySelectorAll(".detail-row")].length;
  const shown = !line.hidden;
  btn.click();
  return { before, rows, shown, folded: line.hidden };
});
check("a paper shows what was read from it", !paperDetails.missing && paperDetails.before === true && paperDetails.shown, JSON.stringify(paperDetails));
check("the paper's details list every field", paperDetails.rows === 5, "n=" + paperDetails.rows);
check("pressing it again folds the paper's details", paperDetails.folded === true, "stayed open");

/* المسار الحقيقي: صورة تُرفع من حقل الملف، والمحلل يرد بعقده الجديد */
await page.evaluate(() => {
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
  const file = new File([png], "الشهادة الضريبية.png", { type: "image/png" });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.getElementById("docFile");
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 1200));
const shown = await page.evaluate(() => ({
  detailRows: document.querySelectorAll("#docDetailRows .detail-row").length,
  detailsOpen: !document.getElementById("docDetails").hidden,
  askOpen: !document.getElementById("docProfileAsk").hidden,
  askRows: [...document.querySelectorAll("#docProfileRows .detail-row")].map((r) => r.querySelector(".detail-key").textContent.trim()),
  expiry: document.getElementById("fExpiry").value,
  expiryShown: (() => {
    const n = document.getElementById("fExpiry");
    const wrap = n && n.closest(".dp-wrap, .date-field");
    const disp = wrap && wrap.querySelector("input[type=text]");
    return disp ? disp.value : "";
  })(),
}));
check("every read field is shown in the form", shown.detailRows === 4 && shown.detailsOpen, JSON.stringify(shown));
check("the paper's own date becomes the due date", shown.expiry === "2027-04-30" && shown.expiryShown === "30-04-2027", shown.expiry + " / " + shown.expiryShown);
check("the company update is offered, not written", shown.askOpen && profileWrites.length === 0, JSON.stringify(shown) + " writes=" + profileWrites.length);
check("only the field that differs is offered", shown.askRows.length === 1 && /الرقم الضريبي/.test(shown.askRows[0]), JSON.stringify(shown.askRows));

await page.evaluate(() => { document.getElementById("docProfileApply").click(); });
await new Promise((r) => setTimeout(r, 600));
const after = await page.evaluate(() => ({ askOpen: !document.getElementById("docProfileAsk").hidden }));
check("pressing update writes the company details once", profileWrites.length === 1 && !after.askOpen,
      "writes=" + profileWrites.length + " " + JSON.stringify(profileWrites[0] || null).slice(0, 120) + " open=" + after.askOpen);

await page.click("#docsBody [data-get]");
await new Promise((r) => setTimeout(r, 1500));
const dl = await page.evaluate(() => window.__downloads || []);
check("pressing download saves the file under its name", dl.length === 1 && /stub-file\.pdf/.test(dl[0].href || ""), JSON.stringify(dl));

const picker = await page.evaluate(() => {
  const before = document.getElementById("docAttachInput");
  if (!before) return { opened: false, target: "", missing: true };
  let opened = false;
  before.click = () => { opened = true; };
  document.querySelector("#docsBody [data-attach]").click();
  return { opened, target: before.dataset.item || "" };
});
check("pressing attach opens the picker for that document", picker.opened && picker.target.length === 36, JSON.stringify(picker));

await browser.close();
server.close();
console.log(fails.length ? "\n" + fails.length + " case(s) failed" : "\nall document flows pass");
process.exit(fails.length ? 1 : 0);
