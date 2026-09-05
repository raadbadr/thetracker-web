/* فهم الرسائل البديهية بلا نموذج ولا توكنز: «هل توجد مخالفات؟»، «كم قضية عندنا»، «متى تنتهي الشهادة الضريبية»،
   «وش عندي اليوم»، «النهارده عندي ايه»، «بعد بكرة»، «المتأخرات»، «كم صرفنا هذا الشهر»، «رقم السجل التجاري»…
   يعيد أداة وقيودا (نوع، حالة، كلمة تصفية، نافذة زمنية، طلب عدد) أو ردا قصيرا للتحية والشكر، أو null فيترك الرسالة للنموذج.
   أي فعل كتابة صريح (أضف، أنجزت، أسند، ذكرني) ليس من شأن هذه الطبقة. */
import { VERBS, westernDigits } from "./notify.js";

export function normalize(text) {
  return String(text || "")
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[éèêëàâäîïôöûüùç]/g, (c) => LATIN[c] || c)
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .toLowerCase().replace(/\s+/g, " ").trim();
}
/* الكلمة بلا سوابق ملتصقة: «بالمخالفات» ← مخالفات، «هالاسبوع» ← اسبوع، «للسجل» ← سجل */
function bare(tok) {
  let t = tok.replace(/^(و|ف)(?=..)/, "");
  t = t.replace(/^(هال|بال|وال|فال|كال|لل)(?=..)/, "").replace(/^(ال)(?=..)/, "");
  return t;
}
/* صور الكلمة: كما هي، وبلا سوابق، وبلا لواحق الملكية (سجلنا ← سجل، شركتي ← شركه) */
function forms(tok) {
  const b = bare(tok);
  const out = [tok, b];
  const s = b.replace(/(نا|كم|هم|ها|ي)$/, "");
  if (s.length >= 3 && s !== b) { out.push(s); if (s.endsWith("ت")) out.push(s.slice(0, -1) + "ه"); }
  if (b.endsWith("ت")) out.push(b.slice(0, -1) + "ه");
  return out;
}
const S = (...w) => new Set(w);
const KIND = {
  case: S("قضايا", "قضيه", "قضاياي", "قضايانا", "دعوى", "دعوي", "دعاوي", "دعوه", "جلسات", "جلسه", "محكمه", "محاكم", "case", "cases", "hearing", "hearings", "session", "sessions", "lawsuit", "lawsuits", "court", "affaire", "affaires", "audience"),
  violation: S("مخالفات", "مخالفه", "غرامات", "غرامه", "violation", "violations", "fine", "fines", "penalty", "penalties", "ticket", "tickets", "infraction", "infractions"),
  task: S("مهام", "مهمه", "مهمات", "واجبات", "task", "tasks", "todo", "todos", "tache", "taches"),
  document: S("مستندات", "مستند", "اوراق", "ورقه", "وثائق", "وثيقه", "شهادات", "شهاده", "سجل", "سجلات", "رخصه", "رخص", "تراخيص", "ترخيص", "عقود", "عقد", "document", "documents", "paper", "papers", "certificate", "certificates", "license", "licenses", "licence", "contract", "contracts", "دستاویزات"),
};
/* كلمة تدل على ورقة رسمية بعينها: ترجح المستندات على بطاقة الشركة */
/* ورقة صريحة (شهادة، وثيقة، صورة…) ترجح المستندات حتى على عبارة رقم رسمي */
const STRONG_PAPER = S("شهاده", "شهادات", "وثيقه", "وثائق", "مستند", "مستندات", "ورقه", "اوراق", "صوره", "نسخه", "certificate", "document", "papers", "copy");
const PAPER = S("شهاده", "شهادات", "وثيقه", "وثائق", "مستند", "مستندات", "ورقه", "اوراق", "صوره", "نسخه", "سجل", "سجلات", "رخصه", "رخص", "ترخيص", "تراخيص", "عقد", "عقود", "certificate", "document", "papers", "license", "licence", "contract", "copy");
const DONE = S("منجز", "منجزه", "مكتمل", "مكتمله", "منتهي", "منتهيه", "خلصنا", "خلصت", "انجزنا", "منجزات", "done", "completed", "finished", "closed", "terminees", "terminee");
const UPCOMING = S("مواعيد", "موعد", "مواعيدي", "قادم", "قادمه", "جدول", "اجنده", "استحقاق", "upcoming", "schedule", "agenda", "deadline", "deadlines", "due", "next", "echeances", "echeance", "rendez", "vous", "تاریخیں");
const OVERDUE = S("متاخر", "متاخره", "متاخرات", "فات", "فاتت", "فائت", "فائته", "تجاوز", "تجاوزت", "overdue", "late", "missed", "retard");
const TEAM = S("فريق", "فريقي", "اعضاء", "عضو", "موظفين", "موظف", "زملاء", "زميل", "مسؤول", "مسئول", "مسوول", "مسوولين", "team", "members", "member", "staff", "colleagues", "employees", "equipe", "ٹیم");
const EXPENSES = S("مصاريف", "مصروفات", "مصروف", "نفقات", "صرفنا", "صرف", "صرفيات", "expenses", "expense", "spending", "spent", "costs", "cost", "depenses", "اخراجات");
/* كلمات بطاقة الشركة: هوية المنشأة وأرقامها الرسمية لا أوراقها المرفوعة */
const COMPANY = S("شركه", "شركات", "منشاه", "موسسه", "كيان", "company", "societe", "entreprise", "کمپنی", "بياناتي", "بياناتنا", "بيانات");
const COMPANY_FIELDS = S("ضريبي", "ضريبيه", "ضريبه", "ايبان", "iban", "موحد", "موحده", "بنكي", "بنك", "بنكيه", "باقه", "اشتراك", "اشتراكي", "vat", "cr", "plan", "subscription", "bank", "abonnement");
const COMPANY_PHRASES = [/رقم\s+(?:ال)?سجل/, /سجل\s*(?:نا|كم|هم)?\s+(?:ال)?تجاري/, /(?:ال)?رقم\s+(?:ال)?ضريبي/, /رقم\s+ضريب/, /(?:ال)?رقم\s+(?:ال)?موحد/, /رقم\s+(?:ال)?حساب/, /(?:ال)?حساب\s*(?:نا|كم)?\s+(?:ال)?بنكي/, /(?:ال)?عنوان\s*(?:نا|كم)?\s+(?:ال)?وطني/, /cr\s*number/, /vat\s*number/, /tax\s*number/, /commercial\s*regist/, /national\s*address/, /bank\s*account/, /unified\s*number/];
/* أسئلة المنصة كلها: عدد المسجلين والشركات والاشتراكات (لمدير المنصة وحده) */
const PLATFORM_WHO = S("مسجلين", "مسجل", "مشتركين", "مشترك", "مستخدمين", "مستخدم", "users", "user", "subscribers", "signups", "registrations", "accounts");
const SITE = S("الموقع", "موقع", "المنصه", "منصه", "النظام", "platform", "site", "system");
const ALL = S("الكل", "كلها", "كله", "بالكامل", "كامل", "everything", "all", "ملخص", "وضعنا", "وضعي", "الوضع", "نظره", "summary", "overview", "status", "dashboard", "لوحه", "resume");
const ALL_STATUS = ["بشكل عام", "عام", "كلها", "الكل", "السابقه", "سابقه", "قديمه", "القديمه", "history", "ever", "all time", "منذ البدايه", "حتي الان"];
const COUNT = S("كم", "عدد", "اجمالي", "مجموع", "count", "how", "many", "total", "combien");
/* النوافذ الزمنية بكل اللهجات: اليوم، غدا، بعد غد، الأسبوع، الشهر */
/* «اليوم» بأداتها يعني هذا اليوم؛ «يوم» وحدها عدد أيام لا نافذة */
const TODAY = S("اليوم", "هاليوم", "لليوم", "النهارده", "نهارده", "الليله", "today", "tonight", "aujourdhui", "hui", "اج");
const TWO_DAYS = S("يومين", "اليومين", "هاليومين");
const TOMORROW = S("غدا", "غد", "بكره", "بكرا", "باكر", "tomorrow", "tommorow", "tomorow", "tmrw", "tmw", "demain");
const WEEK = S("اسبوع", "اسبوعي", "اسبوعين", "week", "weeks", "semaine", "ہفتے", "ہفتہ");
const LATIN = { "é": "e", "è": "e", "ê": "e", "ë": "e", "à": "a", "â": "a", "ä": "a", "î": "i", "ï": "i", "ô": "o", "ö": "o", "û": "u", "ü": "u", "ù": "u", "ç": "c" };
const MONTH = S("شهر", "شهري", "شهرين", "month", "months", "mois", "مہینے");
const DAY_AFTER = [/بعد\s+(?:ال)?غد/, /بعد\s+بكر/, /day\s+after\s+tomorrow/, /apres\s*demain/];
const PAST = S("الماضي", "ماضي", "ماضيه", "الماضيه", "الفائت", "فائت", "السابق", "سابق", "last", "previous", "dernier", "derniere");
const NEAREST = S("اقرب", "قادم", "قادمه", "الجايه", "جايه", "الجاي", "جاي", "next", "nearest", "soonest", "upcoming", "prochain", "prochaine");
const EXPIRY = S("ينتهي", "تنتهي", "انتهاء", "الانتهاء", "منتهيه", "صلاحيه", "تجديد", "يجدد", "تجدد", "اصدار", "صدر", "صدرت", "expire", "expires", "expiry", "renew", "renewal", "valid", "issued", "expiration");
const FILLER = S("كم", "عدد", "اجمالي", "مجموع", "هل", "يوجد", "توجد", "فيه", "في", "عندنا", "عندي", "عندك", "عندكم", "لدينا", "لدي", "وش", "ايش", "ايه", "ما", "ماهي", "ماهو", "ماذا", "متي", "وين", "ابغى", "ابغا", "اريد", "اعرض", "عرض", "اعطني", "وريني", "ورني", "شوف", "اشوف", "لي", "لنا", "حاليا", "الحاليه", "الحالي", "الان", "بشكل", "عام", "على", "عن", "من", "الي", "مع", "هذا", "هذه", "هالشي", "ذي", "دي", "اللي", "شي", "شيء", "please", "show", "me", "list", "my", "our", "the", "what", "whats", "are", "there", "any", "is", "do", "does", "we", "have", "i", "you", "a", "an", "of", "for", "give", "get", "tell", "about", "current", "open", "on", "المفتوحه", "مفتوحه", "مفتوح", "بس", "فقط", "طيب", "و", "او", "ال", "كل", "اي", "ايها", "اذكر", "اذكرها", "اعرضها", "اعرضهم", "قائمه", "باقي", "باقيه", "متبقي", "رقم", "الرقم", "يعني", "ولا", "كيا", "ہے", "que", "quest", "ce", "jai", "est");
const GREET = /^(السلام عليكم|سلام عليكم|سلام|مرحبا|مرحبتين|هلا|اهلا|اهلين|هاي|صباح الخير|صباح النور|مساء الخير|مساء النور|hi|hello|hey|bonjour|salut|السلام|ہیلو|سلام علیکم)( .*)?$/;
const THANKS = /^(شكرا|شكرا لك|شكرا جزيلا|مشكور|مشكورين|يعطيك العافيه|تسلم|تسلمي|احسنت|ممتاز|رائع|عظيم|جميل|برافو|كفو|تمام|حلو|ok|okay|good|great|thanks|thank you|thx|perfect|nice|excellent|merci|شکریہ|بہت اچھا)( .*)?$/;
const GREET_REPLY = { ar: "أهلا. اكتب ما تريد مباشرة: قضايا، مخالفات، مهام، مستندات، مواعيد، متأخر، مصاريف، الشركة، الفريق.", en: "Hello. Just write what you need: cases, violations, tasks, documents, upcoming, overdue, expenses, company, team.", fr: "Bonjour. Écrivez directement : affaires, infractions, tâches, documents, échéances, retards, dépenses, société, équipe.", ur: "خوش آمدید۔ براہ راست لکھیں: مقدمات، خلاف ورزیاں، کام، دستاویزات، تاریخیں، تاخیر، اخراجات، کمپنی، ٹیم۔" };
const THANKS_REPLY = { ar: "على الرحب.", en: "Anytime.", fr: "Avec plaisir.", ur: "خوش آمدید۔" };
export const LABELS = {
  ar: { case: "القضايا", violation: "المخالفات", task: "المهام", document: "المستندات", all: "العناصر", done: "المنجز", upcoming: "المواعيد القادمة", overdue: "المتأخرات", search: "النتائج", today: "اليوم", tomorrow: "غدا", day_after: "بعد غد", today_tomorrow: "اليوم وغدا", week: "هذا الأسبوع", month: "هذا الشهر", none_window: "لا مواعيد", nearest: "الأقرب", none_kw: "لا شيء بهذه الكلمة ضمن" },
  en: { case: "Cases", violation: "Violations", task: "Tasks", document: "Documents", all: "Items", done: "Done", upcoming: "Upcoming", overdue: "Overdue", search: "Results", today: "today", tomorrow: "tomorrow", day_after: "the day after tomorrow", today_tomorrow: "today and tomorrow", week: "this week", month: "this month", none_window: "Nothing due", nearest: "Nearest", none_kw: "Nothing with that word among" },
  fr: { case: "Affaires", violation: "Infractions", task: "Tâches", document: "Documents", all: "Éléments", done: "Terminé", upcoming: "À venir", overdue: "En retard", search: "Résultats", today: "aujourd'hui", tomorrow: "demain", day_after: "après-demain", today_tomorrow: "aujourd'hui et demain", week: "cette semaine", month: "ce mois", none_window: "Rien d'échu", nearest: "Le plus proche", none_kw: "Rien avec ce mot parmi" },
  ur: { case: "مقدمات", violation: "خلاف ورزیاں", task: "کام", document: "دستاویزات", all: "آئٹمز", done: "مکمل", upcoming: "آنے والی", overdue: "تاخیر شدہ", search: "نتائج", today: "آج", tomorrow: "کل", day_after: "پرسوں", today_tomorrow: "آج اور کل", week: "اس ہفتے", month: "اس مہینے", none_window: "کوئی تاریخ نہیں", nearest: "قریب ترین", none_kw: "اس لفظ کے ساتھ کچھ نہیں" },
};
/* كلمات تصفية المستندات: «الضريبية» ← شهادة القيمة المضافة، «السجل» ← السجل التجاري… */
const DOC_KEYS = [
  [/^(ضريبي|ضريبيه|ضريبه|ضرائب|vat|tax)$/, /ضريب|قيمه مضافه|vat|tax/i],
  [/^(سجل|سجلات|تجاري|تجاريه|commercial|register|registration|cr)$/, /سجل|commercial|register/i],
  [/^(عقد|عقود|contract|contracts)$/, /عقد|contract/i],
  [/^(رخصه|رخص|ترخيص|تراخيص|license|licence|licenses)$/, /رخص|license|licence/i],
  [/^(هويه|هويات|identity)$/, /هوي|identity/i],
  [/^(تامين|تامينات|insurance)$/, /تامين|تأمين|insurance/i],
  [/^(زكاه|زكويه|zakat)$/, /زكا|zakat/i],
  [/^(غرفه|chamber)$/, /غرف|chamber/i],
  [/^(تاسيس|اساسي|نظام|articles|bylaws)$/, /تاسيس|تأسيس|نظام|articles|bylaw/i],
];
const DOC_PHRASES = [[/(?:ال)?قيمه\s*(?:ال)?مضافه/, /ضريب|قيمه مضافه|vat|tax/i], [/غرفه\s*(?:ال)?تجاري/, /غرف|chamber/i]];

function inWindow(iso, win, tz) {
  if (!iso) return false;
  try {
    const zone = tz || "Asia/Riyadh";
    const day = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    const now = new Date(), due = new Date(iso);
    const plus = (k) => day(new Date(now.getTime() + k * 86400000));
    if (win === "today") return day(due) === day(now);
    if (win === "tomorrow") return day(due) === plus(1);
    if (win === "day_after") return day(due) === plus(2);
    if (win === "today_tomorrow") return day(due) === day(now) || day(due) === plus(1);
    if (win === "month") return day(due).slice(0, 7) === day(now).slice(0, 7) && due.getTime() >= now.getTime() - 86400000;
    return due.getTime() >= now.getTime() - 86400000 && due.getTime() <= now.getTime() + 7 * 86400000;
  } catch { return false; }
}

/* الفهم نفسه: يعيد {reply} أو {tool,args,label,count,filter,window,keyword} أو null */
export function understand(text, lang) {
  const L = LABELS[lang] || LABELS.ar;
  const raw = westernDigits(String(text || "")).trim();
  if (!raw) return null;
  const n = normalize(raw);
  if (!n || n.length > 160) return null;
  if (GREET.test(n)) return { reply: GREET_REPLY[lang] || GREET_REPLY.ar, kind: "greeting" };
  if (THANKS.test(n)) return { reply: THANKS_REPLY[lang] || THANKS_REPLY.ar, kind: "thanks" };
  const toks = n.split(" ");
  const all = toks.map(forms);
  const has = (set) => all.some((fs) => fs.some((f) => set.has(f)));
  const numbers = (raw.match(/\d{3,}/g) || []);
  const spaced = " " + n + " ";
  /* سؤال مفهومي (الفرق، كيف، لماذا، اشرح) ليس طلب بيانات؛ يجيبه النموذج */
  if (/(الفرق|معني|كيف|لماذا|ليش|اشرح|شرح|تعريف|difference|explain|how do|how to|why)/.test(spaced)) return null;
  /* فعل كتابة صريح ← ليس سؤالا؛ يبقى للمسار المؤكد. «السجل» و«سجل تجاري» أسماء لا فعل «سجل» */
  /* «سجل» اسم لا فعل حين تحيط به قرائن الورقة (تجاري، الشركة، رقم، ينتهي، صورة…) */
  const sajilNoun = /سجل/.test(n) && /(تجاري|شرك|رقم|ينتهي|تنتهي|انتهاء|صلاحي|تجديد|صور|نسخ|باقي|متبقي|مؤسس|موسس)/.test(n);
  const noNouns = sajilNoun ? raw.replace(/سجل(?:ات|نا|كم|هم)?/g, "") : raw;
  if (VERBS.add.test(noNouns) || VERBS.assign.test(raw) || VERBS.remind.test(raw)) return null;
  /* «المنجزة» صفة لقائمة لا فعل إنجاز؛ تحذف قبل اختبار أفعال الكتابة */
  const noAdj = raw.replace(/(?:ال)?منجزات?|(?:ال)?منجزة|(?:ال)?منجز|(?:ال)?مكتملة|(?:ال)?مكتمل|(?:ال)?منتهية/g, "");
  if (VERBS.done.test(noAdj) && (numbers.length || toks.length >= 3) && !has(COUNT)) return null;

  const count = has(COUNT) || /how many|combien/.test(spaced);
  const statusAll = ALL_STATUS.some((p) => spaced.includes(" " + p + " "));
  const past = has(PAST);
  const window = DAY_AFTER.some((re) => re.test(n)) ? "day_after"
    : (has(TODAY) && has(TOMORROW)) ? "today_tomorrow"
    : has(TODAY) ? "today" : has(TOMORROW) ? "tomorrow" : has(TWO_DAYS) ? "today_tomorrow" : has(WEEK) ? "week" : has(MONTH) ? "month" : null;
  const wantsDone = has(DONE);
  const expiry = has(EXPIRY);
  let kind = null;
  for (const k of ["violation", "case", "task", "document"]) if (has(KIND[k])) { kind = k; break; }
  const paper = has(PAPER);
  const docKeyword = (() => {
    for (const [re, f] of DOC_PHRASES) if (re.test(n)) return f;
    for (const fs of all) for (const b of fs) for (const [re, f] of DOC_KEYS) if (re.test(b)) return f;
    return null;
  })();
  const companyPhrase = COMPANY_PHRASES.some((re) => re.test(n));
  const companyField = has(COMPANY_FIELDS);
  const wantsCompany = has(COMPANY);
  const docs = (kw) => ({ tool: "tracker_items", args: { kind: "document", status: statusAll ? "all" : "open", limit: 30 }, label: L.document, count, window,
    keyword: kw ? String(kw) : null, filter: kw ? (r) => kw.test(String(r.title || "") + " " + String(r.document_kind || "") + " " + String(r.category || "")) : null });
  const company = { tool: "tracker_company", args: {}, label: "company" };

  /* عبارة صريحة عن رقم رسمي (رقم السجل، الرقم الضريبي، الحساب البنكي…) ← بطاقة الشركة */
  if (companyPhrase && !has(STRONG_PAPER) && !expiry) return company;
  /* ورقة رسمية: كلمة ورقة أو كلمة نوعها أو سؤال عن انتهاء أو إصدار ← المستندات */
  if (kind === "document" || paper || docKeyword || (expiry && !wantsCompany && !companyField)) return docs(docKeyword);
  if (companyPhrase || companyField || (wantsCompany && !kind)) return company;
  /* «كم المسجلين في الموقع» ليست سؤال فريق: بيانات المنصة كلها */
  if (has(PLATFORM_WHO) || (has(SITE) && (count || has(ALL)))) return { tool: "tracker_platform", args: {}, label: "platform" };
  if (has(TEAM) && (!kind || /مسوول|مسؤول|مسئول|who/.test(n))) return { tool: "tracker_team", args: {}, label: "team" };
  if (has(EXPENSES) && !kind) {
    const period = window === "week" ? "week" : window === "month" ? "month" : /سنه|سنوي|year|annual|annee/.test(spaced) ? "year" : statusAll ? "all" : "month";
    return { tool: "tracker_expenses", args: { period }, label: "expenses" };
  }
  if (has(OVERDUE) || (past && (has(UPCOMING) || window))) return { tool: "tracker_list", args: { mode: "overdue", limit: 20 }, label: L.overdue, count, kindFilter: kind };
  /* أقرب موعد أو نافذة زمنية ← قائمة مرتبة بالموعد، مصفاة بالنوع إن ذكر */
  if (!wantsDone && (window || has(UPCOMING) || has(NEAREST))) {
    return { tool: "tracker_list", args: { mode: "upcoming", limit: 20 }, label: window ? L.upcoming + " " + L[window] : L.upcoming, count, window, kindFilter: kind };
  }
  if (kind) {
    const numFilter = numbers.length ? (r) => numbers.some((num) => [r.case_number, r.violation_number, r.doc_number, r.title].some((v) => String(v || "").includes(num))) : null;
    /* اسم عميل أو كلمة زائدة: تصفية اختيارية تطبق فقط إن أصابت */
    const leftover = [];
    all.forEach((fs) => { const b = fs[1] || fs[0]; if (b.length >= 3 && !fs.some((f) => FILLER.has(f) || KIND[kind].has(f) || DONE.has(f) || COUNT.has(f) || UPCOMING.has(f) || COMPANY.has(f) || COMPANY_FIELDS.has(f) || NEAREST.has(f)) && !/^\d+$/.test(b) && !ALL_STATUS.includes(b)) leftover.push(b); });
    const nameFilter = leftover.length ? (r) => leftover.some((w) => normalize(String(r.client_name || "") + " " + String(r.title || "")).includes(w)) : null;
    return { tool: "tracker_items", args: { kind, status: wantsDone ? "done" : statusAll ? "all" : "open", limit: 30 }, label: wantsDone ? L.done + " — " + L[kind] : L[kind], count, filter: numFilter, softFilter: nameFilter };
  }
  if (wantsDone) return { tool: "tracker_items", args: { kind: "all", status: "done", limit: 20 }, label: L.done, count };
  if (has(ALL) && toks.length <= 4) return { tool: "tracker_overview", args: {}, label: "overview" };
  /* رقم وحده (أو «رقم 4471») ← بحث في كل الأنواع */
  if (numbers.length === 1 && toks.every((t, i) => /^\d+$/.test(t) || FILLER.has(t) || FILLER.has(all[i][1]))) {
    return { tool: "tracker_search", args: { query: numbers[0], limit: 10 }, label: L.search };
  }
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
    if (!w.length) {
      const future = list.filter((r) => r.due_at && new Date(r.due_at).getTime() >= Date.now() - 86400000).sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
      return `${L.none_window} ${L[u.window]}.` + (future.length ? `\n${L.nearest}:\n${rowsText(future.slice(0, 3))}` : "");
    }
    list = w;
  }
  if (!list.length) return toolText && toolText !== "No items." ? toolText : null;
  const head = u.count ? `${u.label}: ${list.length}\n` : "";
  return head + rowsText(list);
}
