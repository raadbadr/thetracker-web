/* حالات انحدار محلل المستندات — تُشغَّل قبل أي نشر يمس src/documents.js:  node tests/analyzer-cases.mjs
   كل ورقة عرفها النظام مرة يجب أن يعرفها دائما؛ أي حالة جديدة تُضاف هنا مع إصلاحها. */
import fs from "fs";
import { normalizeArabicText, rulesExtract } from "../src/documents.js";
const fx = (name) => fs.readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");
const CASES = [
  { name: "commercial register — Arabic PDF text (visual order)", text: fx("cr-ar.txt"), kind: "commercial_register", number: "7055060102", party: "شركة باركينزي", issue: "2026-08-24" },
  { name: "commercial register — English PDF text", text: fx("cr-en.txt"), kind: "commercial_register", number: "7055060102", party: "PARKINZI Company", issue: "2026-08-24" },
  { name: "VAT certificate (carries the CR number as a field)", text: "المملكة العربية السعودية\nهيئة الزكاة والضريبة والجمارك\nشهادة تسجيل في ضريبة القيمة المضافة\nاسم المكلف: شركة باركينزي\nالرقم الضريبي: 310123456700003\nرقم السجل التجاري: 7055060102\nتاريخ الإصدار: 2026/08/24", kind: "vat_certificate", number: "310123456700003", party: "شركة باركينزي", issue: "2026-08-24" },
  { name: "GOSI certificate (لل prefix)", text: "المؤسسة العامة للتأمينات الاجتماعية\nشهادة التزام\nاسم المنشأة: شركة باركينزي\nرقم الاشتراك: 123456789\nرقم السجل التجاري: 7055060102\nصالحة حتى 2026/12/31", kind: "gosi_certificate", number: "123456789", expiry: "2026-12-31" },
  { name: "chamber membership", text: "الغرفة التجارية بالرياض\nشهادة عضوية\nاسم المنشأة: شركة باركينزي\nرقم العضوية: 445566\nرقم السجل التجاري: 7055060102", kind: "chamber_certificate", number: "445566", party: "شركة باركينزي" },
  { name: "zakat certificate", text: "هيئة الزكاة والضريبة والجمارك\nشهادة الزكاة\nاسم المكلف: شركة باركينزي\nرقم الشهادة: 998877\nرقم السجل التجاري: 7055060102\nتاريخ الانتهاء: 1448/04/30", kind: "zakat_certificate", number: "998877" },
  { name: "saudization certificate", text: "وزارة الموارد البشرية والتنمية الاجتماعية\nشهادة السعودة\nاسم المنشأة: شركة باركينزي\nرقم المنشأة: 7-1234567\nرقم السجل التجاري: 7055060102\nصالحة حتى 2026/11/30", kind: "saudization_certificate" },
  { name: "freelance permit", text: "وثيقة العمل الحر\nاسم صاحب الوثيقة: أحمد محمد\nرقم الوثيقة: FL-2026-000123\nرقم الهوية: 1012345678\nتاريخ الانتهاء: 2027/03/01", kind: "license", entity: "freelance" },
  { name: "national id", text: "المملكة العربية السعودية\nوزارة الداخلية\nبطاقة الهوية الوطنية\nالاسم: أحمد محمد علي\nرقم الهوية: 1012345678\nتاريخ الانتهاء: 1450/01/01", kind: "id_document", number: "1012345678", entity: "individual" },
  { name: "passport", text: "المملكة العربية السعودية\nالمديرية العامة للجوازات\nجواز سفر\nالاسم: أحمد محمد علي\nرقم الجواز: A1234567\nتاريخ الانتهاء: 2031/05/12", kind: "passport", number: "A1234567", entity: "individual", expiry: "2031-05-12" },
  { name: "driving licence", text: "الإدارة العامة للمرور\nرخصة قيادة خاصة\nالاسم: أحمد محمد علي\nرقم الرخصة: 1012345678\nتاريخ الانتهاء: 2029/02/20", kind: "driving_license", number: "1012345678", expiry: "2029-02-20" },
  { name: "vehicle registration", text: "الإدارة العامة للمرور\nاستمارة المركبة\nاسم المالك: أحمد محمد علي\nرقم اللوحة: ABC1234\nتاريخ الانتهاء: 2027/06/30", kind: "vehicle_registration", expiry: "2027-06-30" },
  { name: "insurance policy", text: "وثيقة تأمين مركبات\nاسم المؤمن له: أحمد محمد علي\nرقم الوثيقة: POL-77-2026\nتاريخ الانتهاء: 2027/01/15", kind: "insurance_policy", number: "POL-77-2026", expiry: "2027-01-15" },
  { name: "employment contract", text: "وزارة الموارد البشرية والتنمية الاجتماعية\nعقد عمل\nاسم الموظف: خالد سعيد\nرقم العقد: EMP-2026-77\nالراتب الأساسي: 9000\nتاريخ الانتهاء: 2028/09/01", kind: "employment_contract", expiry: "2028-09-01" },
  { name: "lease contract", text: "منصة إيجار\nعقد إيجار\nالمستأجر: شركة باركينزي\nرقم العقد: 88112233\nقيمة الإيجار: 120000\nتاريخ الانتهاء: 2027/04/01", kind: "lease_contract", number: "88112233", expiry: "2027-04-01" },
  { name: "hearing notice", text: "المحكمة التجارية بالرياض\nإشعار بموعد جلسة\nرقم الدعوى: 4470123456\nالمدعي: شركة باركينزي\nموعد الجلسة: 2026/10/05", kind: "hearing_notice", number: "4470123456" },
];
let failed = 0;
for (const c of CASES) {
  const r = rulesExtract(normalizeArabicText(c.text));
  const problems = [];
  if (c.kind && r.kind !== c.kind) problems.push(`kind ${r.kind} ≠ ${c.kind}`);
  if (c.number && String(r.number) !== c.number) problems.push(`number ${r.number} ≠ ${c.number}`);
  if (c.party && r.party !== c.party) problems.push(`party ${JSON.stringify(r.party)} ≠ ${c.party}`);
  if (c.issue && r.issue_date !== c.issue) problems.push(`issue ${r.issue_date} ≠ ${c.issue}`);
  if (c.expiry && r.expiry_date !== c.expiry) problems.push(`expiry ${r.expiry_date} ≠ ${c.expiry}`);
  if (c.entity && r.entity_hint !== c.entity) problems.push(`entity ${r.entity_hint} ≠ ${c.entity}`);
  if (problems.length) failed++;
  console.log((problems.length ? "FAIL " : "PASS ") + c.name + (problems.length ? "\n      " + problems.join("; ") : ""));
}
console.log(failed ? `\n${failed} case(s) failed` : `\nall ${CASES.length} cases pass`);
process.exit(failed ? 1 : 0);
