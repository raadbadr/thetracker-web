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
    due_at: "2027-09-01T09:00:00Z", client_name: "شركة الاختبار", data: { document_kind: "commercial_register", number: "7055060102" } },
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
page.on("request", (r) => {
  const url = r.url();
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
  rows: document.querySelectorAll("#docsBody tr").length,
  fileLinks: document.querySelectorAll("#docsBody [data-open]").length,
  downloads: document.querySelectorAll("#docsBody [data-get]").length,
  attaches: document.querySelectorAll("#docsBody [data-attach]").length,
  papersRows: document.querySelectorAll("#papersBody tr").length,
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
  ["#docsBody tr:first-child .row-actions", "#papersBody tr:first-child .row-actions"].forEach((sel, i) => {
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
  check("buttons are evenly spaced in " + sel.split(" ")[0], new Set(g.gaps).size === 1, JSON.stringify(g.gaps));
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
    papers: [...document.querySelectorAll("#papersBody tr")].length,
    docs: [...document.querySelectorAll("#docsBody tr")].length,
  };
});
check("pressing a tile filters both tables to that state", filtered.papers === 1 && filtered.docs === 0 && filtered.pressed === "true", JSON.stringify(filtered));

const cleared = await page.evaluate(() => {
  document.querySelector('#papersStats [data-paper-state="missing"]').click();
  return { papers: document.querySelectorAll("#papersBody tr").length, docs: document.querySelectorAll("#docsBody tr").length };
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
