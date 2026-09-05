/* فهم الرسائل البديهية بلا نموذج ولا توكنز: «هل توجد مخالفات؟»، «كم قضية عندنا»، «متى تنتهي الشهادة الضريبية»،
   «وش عندي اليوم»، «المتأخرات»، «مصاريف هذا الشهر»، «من في الفريق»، «رقم السجل التجاري»…
   يعيد أداة وقيودا (نوع، حالة، كلمة تصفية، نافذة زمنية، طلب عدد) أو ردا قصيرا للتحية والشكر، أو null فيترك الرسالة للنموذج.
   أي فعل كتابة صريح (أضف، أنجزت، أسند، ذكرني) ليس من شأن هذه الطبقة. */
import { VERBS } from "./notify.js";

export function normalize(text) {
  return String(text || "")
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .toLowerCase().replace(/\s+/g, " ").trim();
}
/* الكلمة بلا أداة تعريف ولا حرف جر ملتصق: «بالمخالفات» ← مخالفات، «والقضايا» ← قضايا */
function bare(tok) {
  let t = tok;
  t = t.replace(/^(و|ف)(?=..)/, "");
  t = t.replace(/^(بال|وال|فال|كال|لل)(?=..)/, "").replace(/^(ال)(?=..)/, "");
  return t;
}
const S = (...w) => new Set(w);
const KIND = {
  case: S("قضايا", "قضيه", "قضيتي", "قضاياي", "قضايانا", "دعوى", "دعوي", "دعاوي", "دعاوى", "جلسات", "جلسه", "جلساتي", "جلساتنا", "محكمه", "محاكم", "case", "cases", "hearing", "hearings", "session", "sessions", "lawsuit", "lawsuits", "court"),
  violation: S("مخالفات", "مخالفه", "مخالفاتي", "مخالفاتنا", "غرامات", "غرامه", "violation", "violations", "fine", "fines", "penalty", "penalties", "ticket", "tickets"),
  task: S("مهام", "مهمه", "مهماتي", "مهامي", "مهامنا", "واجبات", "task", "tasks", "todo", "todos"),
  document: S("مستندات", "مستند", "مستنداتي", "مستنداتنا", "اوراق", "ورقه", "وثائق", "وثيقه", "شهادات", "شهاده", "سجل", "سجلات", "رخصه", "رخص", "تراخيص", "ترخيص", "عقود", "عقد", "document", "documents", "paper", "papers", "certificate", "certificates", "license", "licenses", "licence", "contract", "contracts"),
};
const DONE = S("منجز", "منجزه", "مكتمل", "مكتمله", "منتهي", "منتهيه", "خلصنا", "خلصت", "انجزنا", "انجزناه", "done", "completed", "finished", "closed");
const UPCOMING = S("مواعيد", "موعد", "مواعيدي", "مواعيدنا", "قادم", "قادمه", "جدول", "جدولي", "اجنده", "upcoming", "schedule", "agenda", "deadline", "deadlines", "due", "next");
const OVERDUE = S("متاخر", "متاخره", "متاخرات", "متاخراتي", "متاخراتنا", "فات", "فاتت", "فائت", "فائته", "تجاوز", "تجاوزت", "overdue", "late", "missed");
const TEAM = S("فريق", "فريقي", "فريقنا", "اعضاء", "عضو", "موظفين", "موظف", "زملاء", "زميل", "مسؤول", "مسئول", "مسوول", "مسؤولين", "مسوولين", "مسووله", "team", "members", "member", "staff", "colleagues", "employees", "who");
const EXPENSES = S("مصاريف", "مصروفات", "مصروف", "مصاريفنا", "نفقات", "صرفنا", "صرف", "صرفيات", "expenses", "expense", "spending", "spent", "costs", "cost", "depenses", "dépenses", "اخراجات");
const COMPANY = S("شركه", "شركتي", "شركتنا", "منشاه", "منشاتي", "مؤسسه", "مؤسستي", "ضريبي", "ايبان", "الايبان", "iban", "باقه", "باقتي", "اشتراك", "اشتراكي", "company", "vat", "plan", "subscription", "cr", "بياناتي", "بياناتنا");
const COMPANY_PHRASES = ["رقم السجل", "سجل تجاري", "السجل التجاري", "رقم ضريبي", "الرقم الضريبي", "رقم موحد", "الرقم الموحد", "حساب بنكي", "عنوان وطني", "العنوان الوطني", "cr number", "vat number", "commercial register", "tax number", "national address", "bank account"];
const ALL = S("الكل", "كلها", "كله", "everything", "all", "ملخص", "وضعنا", "وضعي", "الوضع", "نظره", "summary", "overview", "status", "dashboard", "لوحه");
const ALL_STATUS = ["بشكل عام", "عام", "كلها", "الكل", "السابقه", "سابقه", "قديمه", "القديمه", "history", "ever", "all time", "منذ البدايه", "حتي الان"];
const COUNT = S("كم", "عدد", "اجمالي", "مجموع", "count", "how", "many", "total", "number");
const TODAY = S("اليوم", "today"), TOMORROW = S("غدا", "غد", "بكره", "بكرا", "tomorrow"), WEEK = S("اسبوع", "الاسبوع", "week", "اسبوعي");
const EXPIRY = S("ينتهي", "تنتهي", "انتهاء", "الانتهاء", "صلاحيه", "تجديد", "يجدد", "تجدد", "اصدار", "صدر", "صدرت", "expire", "expires", "expiry", "renew", "renewal", "valid", "issued");
const FILLER = S("كم", "عدد", "اجمالي", "مجموع", "هل", "يوجد", "توجد", "فيه", "في", "عندنا", "عندي", "عندك", "عندكم", "لدينا", "لدي", "وش", "ايش", "ما", "ماهي", "ماهو", "ماذا", "ابغى", "ابغا", "اريد", "اعرض", "عرض", "اعطني", "وريني", "ورني", "شوف", "اشوف", "لي", "لنا", "حاليا", "الحاليه", "الحالي", "الان", "بشكل", "عام", "على", "عن", "من", "الي", "مع", "هذا", "هذه", "ذي", "دي", "ايه", "please", "show", "me", "list", "my", "our", "the", "what", "are", "there", "any", "is", "do", "we", "have", "i", "you", "a", "an", "of", "for", "give", "get", "tell", "about", "current", "open", "المفتوحه", "مفتوحه", "مفتوح", "بس", "فقط", "طيب", "و", "او", "ال", "كل", "شي", "شيء", "اي", "ايها", "اذكر", "اذكرها", "اعرضها", "اعرضهم", "قائمه", "ليست", "لستة", "لست");
const GREET = /^(السلام عليكم|سلام عليكم|سلام|مرحبا|مرحبتين|هلا|اهلا|اهلين|هاي|صباح الخير|صباح النور|مساء الخير|مساء النور|hi|hello|hey|bonjour|salut|السلام|ہیلو|سلام علیکم)( .*)?$/;
const THANKS = /^(شكرا|شكرا لك|شكرا جزيلا|مشكور|يعطيك العافيه|تسلم|تسلمي|احسنت|ممتاز|رائع|عظيم|جميل|برافو|كفو|تمام|حلو|good|great|thanks|thank you|thx|perfect|nice|excellent|merci|شکریہ|بہت اچھا)( .*)?$/;
const GREET_REPLY = { ar: "أهلا. اكتب ما تريد مباشرة: قضايا، مخالفات، مهام، مستندات، مواعيد، متأخر، مصاريف، الشركة، الفريق.", en: "Hello. Just write what you need: cases, violations, tasks, documents, upcoming, overdue, expenses, company, team.", fr: "Bonjour. Écrivez directement : affaires, infractions, tâches, documents, échéances, retards, dépenses, société, équipe.", ur: "خوش آمدید۔ براہ راست لکھیں: مقدمات، خلاف ورزیاں، کام، دستاویزات، تاریخیں، تاخیر، اخراجات، کمپنی، ٹیم۔" };
const THANKS_REPLY = { ar: "على الرحب.", en: "Anytime.", fr: "Avec plaisir.", ur: "خوش آمدید۔" };
export const LABELS = {
  ar: { case: "القضايا", violation: "المخالفات", task: "المهام", document: "المستندات", all: "العناصر", done: "المنجز", upcoming: "المواعيد القادمة", overdue: "المتأخرات", today: "اليوم", tomorrow: "غدا", week: "هذا الأسبوع", none_window: "لا مواعيد", nearest: "الأقرب", none_kw: "لا شيء بهذه الكلمة ضمن" },
  en: { case: "Cases", violation: "Violations", task: "Tasks", document: "Documents", all: "Items", done: "Done", upcoming: "Upcoming", overdue: "Overdue", today: "today", tomorrow: "tomorrow", week: "this week", none_window: "Nothing due", nearest: "Nearest", none_kw: "Nothing with that word among" },
  fr: { case: "Affaires", violation: "Infractions", task: "Tâches", document: "Documents", all: "Éléments", done: "Terminé", upcoming: "À venir", overdue: "En retard", today: "aujourd'hui", tomorrow: "demain", week: "cette semaine", none_window: "Rien d'échu", nearest: "Le plus proche", none_kw: "Rien avec ce mot parmi" },
  ur: { case: "مقدمات", violation: "خلاف ورزیاں", task: "کام", document: "دستاویزات", all: "آئٹمز", done: "مکمل", upcoming: "آنے والی", overdue: "تاخیر شدہ", today: "آج", tomorrow: "کل", week: "اس ہفتے", none_window: "کوئی تاریخ نہیں", nearest: "قریب ترین", none_kw: "اس لفظ کے ساتھ کچھ نہیں" },
};
/* كلمات تصفية المستندات: «الضريبية» ← شهادة القيمة المضافة، «السجل» ← السجل التجاري… */
const DOC_KEYS = [
  [/^(ضريبي|ضريبيه|ضريبه|الضريبه|ضرائب|vat|tax)$/, /ضريب|vat|tax/i],
  [/^(سجل|تجاري|تجاريه|commercial|register|cr)$/, /سجل|commercial|register/i],
  [/^(عقد|عقود|contract|contracts)$/, /عقد|contract/i],
  [/^(رخصه|رخص|ترخيص|تراخيص|license|licence|licenses)$/, /رخص|license|licence/i],
  [/^(هويه|هويات|id|identity)$/, /هوي|identity|\bid\b/i],
  [/^(تامين|تامينات|insurance)$/, /تامين|تأمين|insurance/i],
  [/^(زكاه|زكويه|zakat)$/, /زكا|zakat/i],
  [/^(غرفه|chamber)$/, /غرف|chamber/i],
  [/^(تاسيس|اساسي|النظام|نظام|articles|bylaws)$/, /تاسيس|تأسيس|نظام|articles|bylaw/i],
  [/^(ايبان|iban|بنكي|bank)$/, /ايبان|آيبان|iban|بنك|bank/i],
  [/^(وطني|عنوان|address)$/, /عنوان|address/i],
];

function inWindow(iso, win, tz) {
  if (!iso) return false;
  try {
    const day = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    const now = new Date(), due = new Date(iso);
    if (win === "today") return day(due) === day(now);
    if (win === "tomorrow") return day(due) === day(new Date(now.getTime() + 86400000));
    return due.getTime() >= now.getTime() - 86400000 && due.getTime() <= now.getTime() + 7 * 86400000;
  } catch { return false; }
}

/* الفهم نفسه: يعيد {reply} أو {tool,args,label,count,filter,window,keyword} أو null */
export function understand(text, lang) {
  const L = LABELS[lang] || LABELS.ar;
  const raw = String(text || "").trim();
  if (!raw) return null;
  const n = normalize(raw);
  if (!n || n.length > 160) return null;
  if (GREET.test(n)) return { reply: GREET_REPLY[lang] || GREET_REPLY.ar, kind: "greeting" };
  if (THANKS.test(n)) return { reply: THANKS_REPLY[lang] || THANKS_REPLY.ar, kind: "thanks" };
  const toks = n.split(" ");
  const bares = toks.map(bare);
  const has = (set) => bares.some((b, i) => set.has(b) || set.has(toks[i]));
  const numbers = (raw.match(/\d{3,}/g) || []);
  /* سؤال مفهومي (الفرق، كيف، لماذا، اشرح) ليس طلب بيانات؛ يجيبه النموذج */
  if (/(الفرق|معني|كيف|لماذا|ليش|اشرح|شرح|تعريف|difference|explain|how do|how to|why)/.test(" " + n + " ")) return null;
  /* فعل كتابة صريح مع هدف ← ليس سؤالا؛ يبقى للمسار المؤكد. «السجل» و«سجل تجاري» أسماء لا فعل «سجّل» */
  const noNouns = raw.replace(/السجل|سجل(?:ات)? (?:ال)?تجاري|سجلات|السجلات/g, "");
  if (VERBS.add.test(noNouns) || VERBS.assign.test(raw) || VERBS.remind.test(raw)) return null;
  if (VERBS.done.test(raw) && (numbers.length || toks.length >= 3) && !has(COUNT)) return null;
  const count = has(COUNT) || /how many|كم /.test(n + " ");
  const statusAll = ALL_STATUS.some((p) => (" " + n + " ").includes(" " + p + " ")) || bares.includes("عام");
  const window = has(TODAY) ? "today" : has(TOMORROW) ? "tomorrow" : has(WEEK) ? "week" : null;
  const wantsDone = has(DONE);
  let kind = null;
  for (const k of ["violation", "case", "task", "document"]) if (has(KIND[k])) { kind = k; break; }
  const companyPhrase = COMPANY_PHRASES.some((p) => n.includes(p));
  const expiry = has(EXPIRY);
  const wantsCompany = companyPhrase || has(COMPANY);
  /* ورقة بعينها بسؤال عن انتهائها/رقمها: مستندات مصفاة بكلمتها؛ «رقم السجل» أو «الشركة» ← بطاقة الشركة */
  const docKeyword = (() => { for (const b of bares) for (const [re, f] of DOC_KEYS) if (re.test(b)) return f; return null; })();
  if (companyPhrase && !expiry && !wantsDone) return { tool: "tracker_company", args: {}, label: "company" };
  if (wantsCompany && !kind && !expiry && !window && !wantsDone) return { tool: "tracker_company", args: {}, label: "company" };
  if (has(TEAM) && (!kind || /مسوول|مسؤول|مسئول|who/.test(n))) return { tool: "tracker_team", args: {}, label: "team" };
  if (expiry && !kind && !docKeyword && !wantsCompany) return { tool: "tracker_items", args: { kind: "document", status: statusAll ? "all" : "open", limit: 30 }, label: L.document, count };
  if ((kind === "document" || docKeyword) && (expiry || kind === "document" || !wantsCompany)) {
    if (docKeyword || kind === "document") {
      const filterRe = docKeyword;
      return { tool: "tracker_items", args: { kind: "document", status: statusAll ? "all" : "open", limit: 30 }, label: L.document, count, keyword: filterRe ? String(filterRe) : null,
        filter: filterRe ? (r) => filterRe.test(String(r.title || "") + " " + String(r.document_kind || "") + " " + String(r.category || "")) : null };
    }
  }
  if (wantsCompany && !kind) return { tool: "tracker_company", args: {}, label: "company" };
  if (has(TEAM) && !kind) return { tool: "tracker_team", args: {}, label: "team" };
  if (has(EXPENSES) && !kind) {
    const period = has(WEEK) ? "week" : /سنه|السنه|year|annual/.test(n) ? "year" : statusAll ? "all" : "month";
    return { tool: "tracker_expenses", args: { period }, label: "expenses" };
  }
  if (has(OVERDUE)) return { tool: "tracker_list", args: { mode: "overdue", limit: 20 }, label: L.overdue, count, kindFilter: kind };
  if (window || (has(UPCOMING) && !kind)) return { tool: "tracker_list", args: { mode: "upcoming", limit: 20 }, label: window ? L.upcoming + " " + L[window] : L.upcoming, count, window, kindFilter: kind };
  if (kind) {
    const numFilter = numbers.length ? (r) => numbers.some((num) => [r.case_number, r.violation_number, r.doc_number, r.title].some((v) => String(v || "").includes(num))) : null;
    /* اسم عميل أو كلمة زائدة: تصفية اختيارية تطبق فقط إن أصابت */
    const leftover = bares.filter((b, i) => b.length >= 3 && !FILLER.has(b) && !FILLER.has(toks[i]) && !KIND[kind].has(b) && !DONE.has(b) && !COUNT.has(b) && !UPCOMING.has(b) && !COMPANY.has(b) && !/^\d+$/.test(b) && !ALL_STATUS.includes(b));
    const nameFilter = leftover.length ? (r) => leftover.some((w) => normalize(String(r.client_name || "") + " " + String(r.title || "")).includes(w)) : null;
    return { tool: "tracker_items", args: { kind, status: wantsDone ? "done" : statusAll ? "all" : "open", limit: 30 }, label: wantsDone ? L.done + " — " + L[kind] : L[kind], count, filter: numFilter, softFilter: nameFilter };
  }
  if (wantsDone) return { tool: "tracker_items", args: { kind: "all", status: "done", limit: 20 }, label: L.done, count };
  if (has(ALL) && toks.length <= 4) return { tool: "tracker_overview", args: {}, label: "overview" };
  if (has(UPCOMING)) return { tool: "tracker_list", args: { mode: "upcoming", limit: 20 }, label: L.upcoming, count };
  return null;
}

/* يبني نص الجواب من صفوف الأداة بحسب ما فهم (تصفية، نافذة، عدد) */
export function composeAnswer(u, rows, lang, rowsText, toolText, tz) {
  const L = LABELS[lang] || LABELS.ar;
  let list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  if (u.kindFilter && list.length) { const KF = { case: /قض|جلس|case|hearing|session/i, violation: /مخالف|violation|fine/i, task: /مهم|task/i, document: /مستند|document|سجل|شهاد/i }[u.kindFilter]; if (KF) { const f = list.filter((r) => KF.test(String(r.tracker_name || "") + " " + String(r.category || "") + " " + String(r.title || "")) || (u.kindFilter === "document" && (r.document_kind || r.doc_number))); if (f.length) list = f; } }
  if (u.filter && list.length) { const f = list.filter(u.filter); if (f.length) list = f; else return `${L.none_kw} ${u.label} (${total}).\n${rowsText(list)}`; }
  if (u.softFilter && list.length) { const f = list.filter(u.softFilter); if (f.length) list = f; }
  if (u.window && list.length) {
    const w = list.filter((r) => inWindow(r.due_at, u.window, tz));
    if (!w.length) return `${L.none_window} ${L[u.window]}.` + (list.length ? `\n${L.nearest}:\n${rowsText(list.slice(0, 3))}` : "");
    list = w;
  }
  if (!list.length) return toolText && toolText !== "No items." ? toolText : null;
  const head = u.count ? `${u.label}: ${list.length}\n` : "";
  return head + rowsText(list);
}
