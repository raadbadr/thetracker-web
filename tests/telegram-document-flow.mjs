/* تدفق «ورقة في تيليغرام ← مستند في المستندات»: الأجزاء الصرفة بلا شبكة ولا قاعدة —
   القارئ بلا نموذج، نص التأكيد، نص الحفظ، توقيع رابط الملف، ومسار الملف بجلب مزيف.
   التشغيل: node tests/telegram-document-flow.mjs */
import fs from "fs";
import { analyzeTextOffline } from "../src/documents.js";
import { docConfirmText, docSavedText, profileOfferText, telegramFileSig, telegramFileUrl, verifyFileSig, telegramFileRoute,
         handleTelegramFile, attachmentName, dmy } from "../src/telegram-documents.js";

const fx = (name) => fs.readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8").trimEnd();
let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed++;
  console.log((ok ? "PASS " : "FAIL ") + name + (ok || detail === undefined ? "" : "\n      " + detail));
}
const SNAKE = /\b[a-z]+_[a-z_]+\b/;
const DIACRITICS = /[ً-ْٰ]/;
const clean = (text) => !/ITM-/.test(text) && !SNAKE.test(text) && !DIACRITICS.test(text) && !/…/.test(text) && !/[٠-٩]/.test(text);

/* 1) القارئ بلا نموذج يعيد ما يعيده المسار السريع للمحلل */
const vat = analyzeTextOffline(fx("vat-bilingual.txt"));
check("offline analyzer: VAT certificate recognised", vat && vat.kind === "vat_certificate", JSON.stringify(vat && vat.kind));
check("offline analyzer: the paper's own number", vat && vat.number === "314983900200003", vat && vat.number);
check("offline analyzer: issue date from the certificate date", vat && vat.issue_date === "2026-08-31", vat && vat.issue_date);
/* هذه الشهادة بلا تاريخ انتهاء صريح؛ المحلل يأخذ «تاريخ استحقاق أول إقرار» موعد متابعة (سلوكه القائم في tests/analyzer-cases.mjs) */
check("offline analyzer: a follow-up date is read as the expiry", vat && /^\d{4}-\d{2}-\d{2}$/.test(vat.expiry_date || ""), vat && vat.expiry_date);
const vatExpiry = vat ? dmy(vat.expiry_date) : "";
check("offline analyzer: details carry the CR number", vat && vat.details && vat.details.cr_number === "7055060102", vat && JSON.stringify(vat.details));
check("offline analyzer: profile updates offered, not written", vat && vat.profile_updates && vat.profile_updates.vat_number === "314983900200003");
check("offline analyzer: unknown text is 'other'", (analyzeTextOffline("مرحبا، كيف حالك اليوم؟ هذا نص عادي بلا ورقة.") || {}).kind === "other");
check("offline analyzer: too short is null", analyzeTextOffline("hi") === null);

/* 2) نص التأكيد: الرقم والتاريخان، بلا رقم قياسي ولا أسماء حقول ولا تشكيل */
for (const lang of ["ar", "en", "fr", "ur"]) {
  const text = docConfirmText(lang, vat);
  check(`confirm text (${lang}) has the number and both dates`, text.includes("314983900200003") && text.includes("31-08-2026") && text.includes(vatExpiry), text);
  check(`confirm text (${lang}) shows nothing internal`, clean(text), text);
}
const arConfirm = docConfirmText("ar", vat);
check("confirm text (ar) names the paper in Arabic", arConfirm.startsWith("📄 الشهادة الضريبية"), arConfirm.split("\n")[0]);
check("confirm text (ar) ends with the question", arConfirm.endsWith("أحفظها في المستندات؟"));
check("confirm text (ar) names the party", arConfirm.includes("باسم: PARKINZI Company"));

/* 3) نصا الحفظ والتحديث */
const saved = docSavedText("ar", { status: "created", kind: "commercial_register", number: "7055060102", expiry_date: "2027-08-24" });
check("saved text (ar)", saved === "حفظت في المستندات: السجل التجاري — رقم 7055060102 — ينتهي 24-08-2027", saved);
const updated = docSavedText("ar", { status: "updated", kind: "vat_certificate", number: "314983900200003", expiry_date: "2027-08-31" });
check("updated text (ar)", updated === "حدثت في المستندات: الشهادة الضريبية — رقم 314983900200003 — ينتهي 31-08-2027", updated);
check("saved text (en) is clean", clean(docSavedText("en", { status: "created", kind: "gosi_certificate", number: "123456789", expiry_date: "2026-12-31" })));
const offer = profileOfferText("ar", { vat_number: "314983900200003", legal_name_en: "PARKINZI Company" }, { vat_number: null, legal_name_en: "Parkinzi" });
check("profile offer (ar) shows labels, not keys", offer.includes("الرقم الضريبي: 314983900200003 (المسجل: غير مسجل)") && offer.includes("الاسم النظامي بالإنجليزية") && !SNAKE.test(offer), offer);
check("dmy formats day-month-year", dmy("2026-09-05") === "05-09-2026" && dmy(null) === "");

/* 4) اسم المرفق: اسم الملف كما أرسل، وللصور اسم الورقة بالعربية */
check("attachment name keeps the sent file name", attachmentName("vat_certificate", "شهادة.pdf", "application/pdf") === "شهادة.pdf");
check("attachment name for a photo is the Arabic label", attachmentName("commercial_register", "", "image/jpeg") === "السجل التجاري.jpg");
check("attachment name for a generic name uses the label", attachmentName("id_document", "photo.jpg", "image/png") === "الهوية.png");

/* 5) توقيع الرابط: ثابت، ومرفوض عند أي تلاعب */
const env = { WORKER_SECRET: "test-secret-0123456789abcdef0123456789abcdef", TELEGRAM_BOT_TOKEN: "000:fake" };
const fileId = "BQACAgQAAxkBAAIB-mTest_file-id_0123456789";
const sig1 = await telegramFileSig(env, fileId), sig2 = await telegramFileSig(env, fileId);
check("signature is deterministic and 32 hex chars", sig1 === sig2 && /^[a-f0-9]{32}$/.test(sig1), sig1);
check("signature differs for another file", (await telegramFileSig(env, fileId + "x")) !== sig1);
check("signature differs for another secret", (await telegramFileSig({ WORKER_SECRET: "other-secret-0123456789abcdef0123456789" }, fileId)) !== sig1);
check("valid signature verifies", await verifyFileSig(env, fileId, sig1));
const tampered = (sig1[0] === "a" ? "b" : "a") + sig1.slice(1);
check("tampered signature is rejected", !(await verifyFileSig(env, fileId, tampered)));
check("signature for another file is rejected", !(await verifyFileSig(env, fileId + "x", sig1)));
check("no secret means no verification", !(await verifyFileSig({}, fileId, sig1)));
const url = await telegramFileUrl(env, fileId, "السجل التجاري.pdf");
check("file url is absolute and routes back to the worker", url.startsWith(`https://appmails.net/api/telegram/file/${fileId}/${sig1}?name=`), url);
const route = telegramFileRoute(new URL(url).pathname);
check("route parser recovers file id and signature", route && route.fileId === fileId && route.sig === sig1);
check("route parser ignores other paths", telegramFileRoute("/api/telegram/webhook") === null && telegramFileRoute(`/api/telegram/file/${fileId}/short`) === null);

/* 6) مسار الملف بجلب مزيف: 404 قبل أي اتصال عند توقيع خاطئ، وتمرير الملف برؤوسه الصحيحة عند توقيع سليم */
const realFetch = globalThis.fetch;
let calls = [];
globalThis.fetch = async (input) => {
  const u = String(input); calls.push(u);
  if (u.includes("/getFile")) return new Response(JSON.stringify({ ok: true, result: { file_path: "documents/file_12.pdf", file_size: 5 } }), { headers: { "Content-Type": "application/json" } });
  if (u.includes("/file/bot")) return new Response("%PDF-", { headers: { "Content-Type": "application/octet-stream", "Content-Length": "5" } });
  return new Response("nope", { status: 500 });
};
try {
  const bad = await handleTelegramFile(env, fileId, tampered, new URL(url));
  check("bad signature: 404 without touching Telegram", bad.status === 404 && calls.length === 0, String(calls));
  calls = [];
  const good = await handleTelegramFile(env, fileId, sig1, new URL(url));
  const cd = good.headers.get("Content-Disposition") || "";
  check("good signature: 200 and the bytes stream through", good.status === 200 && (await good.text()) === "%PDF-", String(good.status));
  check("good signature: content type from the name", good.headers.get("Content-Type") === "application/pdf", good.headers.get("Content-Type"));
  check("good signature: inline with a UTF-8 file name", cd.startsWith("inline;") && cd.includes("filename*=UTF-8''" + encodeURIComponent("السجل التجاري.pdf")), cd);
  check("good signature: private cache for an hour", good.headers.get("Cache-Control") === "private, max-age=3600");
  check("good signature: getFile then download, nothing else", calls.length === 2 && calls[0].includes("/getFile?file_id=") && calls[1].includes("/file/bot"), String(calls));
  check("token never appears in the response", !JSON.stringify([...good.headers]).includes("000:fake"));
} finally { globalThis.fetch = realFetch; }

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks pass");
process.exit(failed ? 1 : 0);
