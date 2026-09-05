/* حالات انحدار محلل المستندات — تُشغَّل قبل أي نشر يمس src/documents.js:  node tests/analyzer-cases.mjs
   كل ورقة عرفها النظام مرة يجب أن يعرفها دائما؛ أي حالة جديدة تُضاف هنا مع إصلاحها.
   details: كل بيان في الورقة بمفتاحه (بعد التنظيف)، profile: ما يصلح منها لتحديث ملف الشركة. */
import fs from "fs";
import { normalizeArabicText, rulesExtract, mergeRules, clean } from "../src/documents.js";
const fx = (name) => fs.readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");
const VAT_BILINGUAL = `TIN 3149839002 الرقم المميز
Certificate No. 100261181562796 رقم الشهادة
Certificate date 31/08/2026 تاريخ الشهادة
هيئة الزكاة والضريبة والجمارك Zakat, Tax and Customs Authority
شهادة تسجيل في ضريبة القيمة المضافة
VAT Registration Certificate
Taxpayer Name PARKINZI Company اسم المكلف
VAT Registration Number 314983900200003 رقم التسجيل الضريبي
Effective Registration Date 2026/09/01 تاريخ نفاذ التسجيل
Taxpayer Address 75,22254 جامعة الملك عبدالعزيز, Jeddah, King Abdulaziz University عنوان المكلف
CR / License Contact / ID No 7055060102 رقم السجل التجاري / الرخصة / العقد / الهوية
Tax Period Quarterly - ربع سنوي الفترة الضريبية
First Filing due date 2026/10/31 تاريخ استحقاق أول إقرار ضريبي`;
const CASES = [
  { name: "commercial register — Arabic PDF text (visual order)", text: fx("cr-ar.txt"), kind: "commercial_register", number: "7055060102", party: "شركة باركينزي", issue: "2026-08-24",
    details: { cr_number: "7055060102", unified_number: "7055060102", company_name: "شركة باركينزي", issue_date: "2026-08-24", status: "نشط" },
    profile: { cr_number: "7055060102", unified_number: "7055060102", legal_name: "شركة باركينزي" } },
  { name: "commercial register — English PDF text", text: fx("cr-en.txt"), kind: "commercial_register", number: "7055060102", party: "PARKINZI Company", issue: "2026-08-24",
    details: { cr_number: "7055060102", unified_number: "7055060102", company_name: "PARKINZI Company", issue_date: "2026-08-24", entity_type: "Company Limited liability company", characteristics: "(One person)", status: "Active" },
    profile: { cr_number: "7055060102", legal_name: "PARKINZI Company" } },
  { name: "commercial register — a ten-digit number not starting with 7 is never a CR number", text: "وزارة التجارة\nرقم المنشأة 1234567890\nاسم المنشأة: مؤسسة الاختبار", notKind: "commercial_register", notNumber: "1234567890" },
  { name: "VAT certificate (carries the CR number as a field)", text: "المملكة العربية السعودية\nهيئة الزكاة والضريبة والجمارك\nشهادة تسجيل في ضريبة القيمة المضافة\nاسم المكلف: شركة باركينزي\nالرقم الضريبي: 310123456700003\nرقم السجل التجاري: 7055060102\nتاريخ الإصدار: 2026/08/24", kind: "vat_certificate", number: "310123456700003", party: "شركة باركينزي", issue: "2026-08-24",
    details: { vat_number: "310123456700003", taxpayer_name: "شركة باركينزي", cr_number: "7055060102", certificate_date: "2026-08-24" },
    profile: { vat_number: "310123456700003", cr_number: "7055060102", legal_name: "شركة باركينزي" } },
  { name: "VAT certificate — bilingual OCR, value between the English and Arabic labels", text: VAT_BILINGUAL, kind: "vat_certificate", number: "314983900200003", party: "PARKINZI Company",
    details: { tin: "3149839002", certificate_number: "100261181562796", certificate_date: "2026-08-31", taxpayer_name: "PARKINZI Company", vat_number: "314983900200003", effective_date: "2026-09-01",
      address: /Jeddah/, cr_number: "7055060102", tax_period: /Quarterly/, first_filing_due: "2026-10-31" },
    profile: { vat_number: "314983900200003", cr_number: "7055060102", legal_name: "PARKINZI Company" } },
  { name: "GOSI certificate (لل prefix)", text: "المؤسسة العامة للتأمينات الاجتماعية\nشهادة التزام\nاسم المنشأة: شركة باركينزي\nرقم الاشتراك: 123456789\nرقم السجل التجاري: 7055060102\nصالحة حتى 2026/12/31", kind: "gosi_certificate", number: "123456789", expiry: "2026-12-31",
    details: { subscription_number: "123456789", establishment_name: "شركة باركينزي", cr_number: "7055060102", expiry_date: "2026-12-31" } },
  { name: "chamber membership", text: "الغرفة التجارية بالرياض\nشهادة عضوية\nاسم المنشأة: شركة باركينزي\nرقم العضوية: 445566\nرقم السجل التجاري: 7055060102", kind: "chamber_certificate", number: "445566", party: "شركة باركينزي",
    details: { membership_number: "445566", establishment_name: "شركة باركينزي", cr_number: "7055060102" } },
  { name: "zakat certificate", text: "هيئة الزكاة والضريبة والجمارك\nشهادة الزكاة\nاسم المكلف: شركة باركينزي\nرقم الشهادة: 998877\nرقم السجل التجاري: 7055060102\nتاريخ الانتهاء: 1448/04/30", kind: "zakat_certificate", number: "998877",
    details: { certificate_number: "998877", taxpayer_name: "شركة باركينزي", cr_number: "7055060102", expiry_date: /^2026-1[01]-\d{2}$/ } },
  { name: "saudization certificate", text: "وزارة الموارد البشرية والتنمية الاجتماعية\nشهادة السعودة\nاسم المنشأة: شركة باركينزي\nرقم المنشأة: 7-1234567\nرقم السجل التجاري: 7055060102\nصالحة حتى 2026/11/30", kind: "saudization_certificate",
    details: { establishment_number: "7-1234567", establishment_name: "شركة باركينزي", cr_number: "7055060102", expiry_date: "2026-11-30" } },
  { name: "freelance permit", text: "وثيقة العمل الحر\nاسم صاحب الوثيقة: أحمد محمد\nرقم الوثيقة: FL-2026-000123\nرقم الهوية: 1012345678\nتاريخ الانتهاء: 2027/03/01", kind: "license", entity: "freelance",
    details: { permit_number: "FL-2026-000123", holder_name: "أحمد محمد", id_number: "1012345678", expiry_date: "2027-03-01" } },
  { name: "national id", text: "المملكة العربية السعودية\nوزارة الداخلية\nبطاقة الهوية الوطنية\nالاسم: أحمد محمد علي\nرقم الهوية: 1012345678\nتاريخ الانتهاء: 1450/01/01", kind: "id_document", number: "1012345678", entity: "individual",
    details: { id_number: "1012345678", full_name: "أحمد محمد علي", expiry_date: /^2028-0[45]-\d{2}$/ } },
  { name: "hearing notice", text: "المحكمة التجارية بالرياض\nإشعار بموعد جلسة\nرقم الدعوى: 4470123456\nالمدعي: شركة باركينزي\nالمدعى عليه: مؤسسة كذا\nالدائرة: التجارية الثالثة\nموعد الجلسة: 2026/10/05 الساعة 10:30 صباحا", kind: "hearing_notice", number: "4470123456",
    details: { case_number: "4470123456", plaintiff: "شركة باركينزي", defendant: "مؤسسة كذا", circuit: "الدائرة التجارية الثالثة", hearing_date: "2026-10-05", hearing_time: "10:30 صباحا", court: "المحكمة التجارية بالرياض" } },
  { name: "tax invoice — carries a VAT number and the word ضريبة but is an invoice, not a VAT certificate; the seller's name repeats its own label", text: "فاتورة ضريبية Tax Invoice\nInvoice No: INV-2026-0042 رقم الفاتورة\nInvoice Date 2026/03/15 تاريخ الفاتورة\nالمورد: شركة المورد المحدودة\nالرقم الضريبي: 300012345600003\nالعميل: شركة باركينزي\nSubtotal 1,000.00 المجموع الفرعي\nVAT (15%) 150.00 ضريبة القيمة المضافة\nTotal 1,150.00 الإجمالي", kind: "invoice", number: "INV-2026-0042", party: "شركة باركينزي", issue: "2026-03-15",
    details: { invoice_number: "INV-2026-0042", invoice_date: "2026-03-15", seller: "شركة المورد المحدودة", buyer: "شركة باركينزي", vat_number: "300012345600003", subtotal: 1000, vat_amount: 150, total: 1150 },
    profile: {} },
  { name: "passport", text: "المملكة العربية السعودية\nالمديرية العامة للجوازات\nجواز سفر\nالاسم: أحمد محمد علي\nرقم الجواز: A1234567\nتاريخ الانتهاء: 2031/05/12", kind: "passport", number: "A1234567", entity: "individual", expiry: "2031-05-12" },
  { name: "driving licence", text: "الإدارة العامة للمرور\nرخصة قيادة خاصة\nالاسم: أحمد محمد علي\nرقم الرخصة: 1012345678\nتاريخ الانتهاء: 2029/02/20", kind: "driving_license", number: "1012345678", expiry: "2029-02-20" },
  { name: "vehicle registration", text: "الإدارة العامة للمرور\nاستمارة المركبة\nاسم المالك: أحمد محمد علي\nرقم اللوحة: ABC1234\nتاريخ الانتهاء: 2027/06/30", kind: "vehicle_registration", expiry: "2027-06-30" },
  { name: "insurance policy", text: "وثيقة تأمين مركبات\nاسم المؤمن له: أحمد محمد علي\nرقم الوثيقة: POL-77-2026\nتاريخ الانتهاء: 2027/01/15", kind: "insurance_policy", number: "POL-77-2026", expiry: "2027-01-15" },
  { name: "employment contract", text: "وزارة الموارد البشرية والتنمية الاجتماعية\nعقد عمل\nاسم الموظف: خالد سعيد\nرقم العقد: EMP-2026-77\nالراتب الأساسي: 9000\nتاريخ الانتهاء: 2028/09/01", kind: "employment_contract", expiry: "2028-09-01" },
  { name: "lease contract", text: "منصة إيجار\nعقد إيجار\nالمستأجر: شركة باركينزي\nرقم العقد: 88112233\nقيمة الإيجار: 120000\nتاريخ الانتهاء: 2027/04/01", kind: "lease_contract", number: "88112233", expiry: "2027-04-01" },
];
const same = (got, want) => (want instanceof RegExp ? want.test(String(got ?? "")) : String(got) === String(want));
let failed = 0;
for (const c of CASES) {
  const r = rulesExtract(normalizeArabicText(c.text));
  const fields = clean(mergeRules(null, r));
  const problems = [];
  if (c.kind && r.kind !== c.kind) problems.push(`kind ${r.kind} ≠ ${c.kind}`);
  if (c.notKind && r.kind === c.notKind) problems.push(`kind must not be ${c.notKind}`);
  if (c.number && String(r.number) !== c.number) problems.push(`number ${r.number} ≠ ${c.number}`);
  if (c.notNumber && String(r.number) === c.notNumber) problems.push(`number must not be ${c.notNumber}`);
  if (c.party && r.party !== c.party) problems.push(`party ${JSON.stringify(r.party)} ≠ ${c.party}`);
  if (c.issue && r.issue_date !== c.issue) problems.push(`issue ${r.issue_date} ≠ ${c.issue}`);
  if (c.expiry && r.expiry_date !== c.expiry) problems.push(`expiry ${r.expiry_date} ≠ ${c.expiry}`);
  if (c.entity && r.entity_hint !== c.entity) problems.push(`entity ${r.entity_hint} ≠ ${c.entity}`);
  for (const [key, want] of Object.entries(c.details || {})) if (!same(fields.details[key], want)) problems.push(`details.${key} ${JSON.stringify(fields.details[key])} ≠ ${want}`);
  for (const [key, want] of Object.entries(c.profile || {})) if (!same(fields.profile_updates[key], want)) problems.push(`profile.${key} ${JSON.stringify(fields.profile_updates[key])} ≠ ${want}`);
  if (problems.length) failed++;
  console.log((problems.length ? "FAIL " : "PASS ") + c.name + (problems.length ? "\n      " + problems.join("; ") : ""));
}
console.log(failed ? `\n${failed} case(s) failed` : `\nall ${CASES.length} cases pass`);
process.exit(failed ? 1 : 0);
