// --- مرسلات القنوات + Cron التنبيهات ----------------------------------------
// البريد: دالة Edge في سوبابيس (send-zoho-email — نسخة باركينزي) عبر Zoho.
// تيليغرام: Bot API. واتساب: Meta Cloud API. SMS: Unifonic أو Twilio.
// ال Worker لا يحمل مفتاح service role: يستخدم مفتاح anon + سر مشترك
// (WORKER_SECRET) تتحقق منه دوال SECURITY DEFINER في قاعدة البيانات.

const NO_CACHE = { cacheTtl: 0, cacheEverything: false };

export function anonHeaders(env) {
  return {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function rpc(env, name, args) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: anonHeaders(env),
    body: JSON.stringify(args || {}),
    cf: NO_CACHE,
  });
  if (!res.ok) throw new Error(`rpc ${name} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

const TEXT = {
  ar: { reminder: (t, due, tr) => `⏰ تذكير من TheTracker\n${t}\nالاستحقاق: ${due}${tr ? `\nالسجل: ${tr}` : ""}\nhttps://appmails.net/app/dashboard.html`,
        linked: (name, org) => `مرحبا ${name || ""}${org ? "\nالشركة: " + org : ""}`,
        badCode: "الرمز غير صحيح أو منته. افتح الإعدادات في TheTracker وانسخ الرمز الجديد.",
        needCode: "لربط حسابك: افتح الإعدادات في TheTracker ← تيليجرام ← «توليد رمز»، ثم أرسل الرمز هنا أو امسح رمز QR.",
        alreadyLinked: (name) => `أنت مرتبط${name ? " يا " + name : ""}.`,
        test: "✅ رسالة تجريبية من TheTracker: هذه القناة تعمل." },
  en: { reminder: (t, due, tr) => `⏰ TheTracker reminder\n${t}\nDue: ${due}${tr ? `\nTracker: ${tr}` : ""}\nhttps://appmails.net/app/dashboard.html`,
        linked: (name, org) => `Hello ${name || ""}${org ? "\nCompany: " + org : ""}`,
        badCode: "Invalid or expired code. Open Settings in TheTracker and copy a new code.",
        needCode: "To link your account: open Settings in TheTracker → Telegram → “Generate code”, then send the code here or scan the QR code.",
        alreadyLinked: (name) => `You are linked${name ? ", " + name : ""}.`,
        test: "✅ Test message from TheTracker: this channel works." },
  fr: { reminder: (t, due, tr) => `⏰ Rappel TheTracker\n${t}\nÉchéance : ${due}${tr ? `\nSuivi : ${tr}` : ""}\nhttps://appmails.net/app/dashboard.html`,
        linked: (name, org) => `Bonjour ${name || ""}${org ? "\nSociete : " + org : ""}`,
        badCode: "Code invalide ou expiré. Ouvrez Paramètres dans TheTracker et copiez un nouveau code.",
        needCode: "Pour lier votre compte : ouvrez Paramètres dans TheTracker → Telegram → « Générer un code », puis envoyez le code ici ou scannez le QR code.",
        alreadyLinked: (name) => `Compte lie${name ? ", " + name : ""}.`,
        test: "✅ Message de test TheTracker : ce canal fonctionne." },
  ur: { reminder: (t, due, tr) => `⏰ TheTracker یاد دہانی\n${t}\nآخری تاریخ: ${due}${tr ? `\nٹریکر: ${tr}` : ""}\nhttps://appmails.net/app/dashboard.html`,
        linked: (name, org) => `خوش آمدید ${name || ""}${org ? "\nکمپنی: " + org : ""}`,
        badCode: "کوڈ غلط یا ختم ہو چکا ہے۔ TheTracker کی ترتیبات کھول کر نیا کوڈ کاپی کریں۔",
        needCode: "اکاؤنٹ منسلک کرنے کے لیے: TheTracker کی ترتیبات ← ٹیلیگرام ← «کوڈ بنائیں»، پھر کوڈ یہاں بھیجیں یا QR کوڈ اسکین کریں۔",
        alreadyLinked: (name) => `${name ? name + "، " : ""}آپ منسلک ہیں۔`,
        test: "✅ TheTracker سے آزمائشی پیغام: یہ چینل کام کر رہا ہے۔" },
};
export function t(lang) { return TEXT[lang] || TEXT.ar; }

// ---------- بوت تلغرام: قائمة الأزرار ونصوصها ----------
const BOT = {
  ar: { company: "🏢 الشركة", upcoming: "📅 مواعيدي القادمة", overdue: "⏰ المتأخرات", dashboard: "🌐 لوحة التحكم", help: "❓ مساعدة",
        linkBtn: "🔗 ربط حسابي", openDash: "فتح لوحة التحكم",
        phoneBtn: "📱 ربط برقم جوالي", phoneHint: "أو شارك رقم جوالك المسجل في TheTracker بالزر بالأسفل فيتم الربط فورا.",
        phoneNotFound: "لم نجد حسابا بهذا الرقم. سجل الدخول إلى الموقع واضغط زر الربط أعلاه.",
        importFound: (file, n) => `📄 ${file}\nوجدت ${n} ${n === 1 ? "ورقة قابلة" : "أوراق قابلة"} للاستيراد:`, importSheet: (name, rows, skipped) => `• ${name}: ${rows} صفا${skipped ? ` (سيهمل ${skipped} بلا عنوان أو تاريخ)` : ""}`,
        importAsk: "أحفظها في شركتك الآن؟", importNothing: "لم أجد في الملف جدولا فيه عمود عنوان وعمود تاريخ (أو رقم مخالفة وتاريخها). استورده من صفحة الاستيراد لتضبط الأعمدة يدويا.", importDoneTitle: "✅ تم الحفظ:", importDoneLine: (tracker, n, isNew) => `• ${tracker}: ${n} عنصر${isNew ? " (متتبع جديد مع قاعدة تذكير قبل الاستحقاق بيوم)" : ""}`,
        importCancelled: "ألغي الاستيراد؛ لم يحفظ شيء.", importExpired: "انتهت صلاحية هذا الطلب. أرسل الملف مرة أخرى.", importLimit: "توقف الحفظ عند حد الباقة الحالية للعناصر — رق الباقة من الإعدادات ثم أعد الإرسال.", importFailed: "تعذر الحفظ. حاول مرة أخرى أو استورد من صفحة الاستيراد.",
        btnSave: "✅ حفظ", btnCancel: "❌ إلغاء",
        kindViolation: "مخالفة", kindSession: "جلسة", kindTask: "مهمة", fWhen: "الموعد", fClient: "العميل", fCase: "رقم الدعوى", fViolation: "رقم المخالفة", fAmount: "المبلغ", fPlace: "الجهة/المكان", fNotes: "ملاحظات",
        actAddTitle: "📝 سأسجل هذا:", actDoneTitle: "✔️ سأعلم كمنجز:", actAssignTitle: "👤 سأسند:", confirmAsk: "أؤكد؟",
        actSaved: (num, title, tracker, isNew) => `✅ سجل${num ? ` (${num})` : ""}: ${title}\nفي «${tracker}»${isNew ? " — متتبع جديد مع تذكير قبل الموعد بيوم" : ""}.`,
        actDoneOk: (num, title) => `✅ أنجز${num ? ` (${num})` : ""}: ${title}`,
        actAssignOk: (title, member, notified) => `✅ أسند «${title}» إلى ${member}${notified ? " وأبلغ على تلغرام" : ""}.`,
        assignedToYou: (title, num) => `👤 أسند إليك${num ? ` (${num})` : ""}: ${title}`,
        notFound: (q) => `لم أجد عنصرا مفتوحا يطابق «${q}».`, manyFound: "وجدت أكثر من عنصر مطابق:", manyHint: "حدد بالرقم القياسي أو بكلمات أدق.", noMember: (m) => `لم أجد عضوا في الفريق باسم «${m}».`,
        searchTitle: (q) => `🔎 نتائج «${q}»:`, searchNone: (q) => `لا شيء يطابق «${q}».`, statusDone: "منجز", days: "يوما", noFiles: "⚠️ بلا مرفقات",
        digestTitle: (n) => `☀️ صباح الخير${n ? ` ${n}` : ""} — إيجاز اليوم:`, digestToday: (n) => `📅 مواعيد اليوم (${n}):`, digestTodayNone: "📅 لا مواعيد اليوم.",
        digestTomorrow: (n) => `⏭ الغد (${n}):`, digestFines: (n, total) => `💸 مخالفات تنتهي مهلتها خلال 3 أيام (${n}) بمجموع ${total}:`,
        digestOverdue: (n, amt) => `⚠️ متأخر: ${n} عنصر${amt && amt !== "0" ? ` — مخالفات بمبلغ ${amt}` : ""}.`, digestNeglected: "🕸 لم تحدث منذ أكثر من 30 يوما:",
        digestFooter: (n) => `المفتوح كله: ${n}. أرسل لي أي شيء لتسجيله أو اسألني.`,
        prepTitle: (n) => `🌙 ${n ? n + "، " : ""}تجهيز الغد:`, prepNone: "لا جلسات غدا.",
        needsParent: "لأي قضية أو مخالفة تتبع هذه المهمة؟ (لا مهمة بلا أصل) — اختر:", noParents: "لا توجد قضايا أو مخالفات مفتوحة لتتبعها هذه المهمة. سجل القضية أو المخالفة أولا.",
        voiceHeard: "🎙 سمعتك: ", fileUnreadable: "تعذرت قراءة هذا الملف. أرسل PDF أو صورة أو إكسل أو CSV.", fileTooBig: "الملف أكبر من الحد المسموح (15 ميغابايت).", fileQuestion: "لخص هذا الملف باختصار، واذكر ما يمكن للمستخدم فعله به في TheTracker (مثلا استيراده من صفحة الاستيراد إن كان جدول مواعيد أو مخالفات أو قضايا).",
        linkIntro: "أهلا بك في TheTracker 👋\nاضغط الزر لربط هذا البوت بحسابك: تفتح صفحة الإعدادات في الموقع ويتم الربط تلقائيا.",
        menuHint: "اختر من الأزرار بالأسفل:",
        upcomingTitle: "📅 مواعيدك القادمة:", overdueTitle: "⏰ المواعيد المتأخرة:",
        noUpcoming: "لا مواعيد قادمة 👌", noOverdue: "لا مواعيد متأخرة 👌",
        help: "اكتب طلبك بكلامك: ابحث، مواعيدي، أضف مهمة، أنجز، أسند. أو استعمل الأزرار." },
  en: { company: "🏢 Company", upcoming: "📅 Upcoming", overdue: "⏰ Overdue", dashboard: "🌐 Dashboard", help: "❓ Help",
        linkBtn: "🔗 Link my account", openDash: "Open dashboard",
        phoneBtn: "📱 Link with my phone number", phoneHint: "Or share the phone number registered in TheTracker with the button below — the link completes instantly.",
        phoneNotFound: "No account has this number. Sign in on the website and tap the link button above.",
        importFound: (file, n) => `📄 ${file}\nFound ${n} importable ${n === 1 ? "sheet" : "sheets"}:`, importSheet: (name, rows, skipped) => `• ${name}: ${rows} rows${skipped ? ` (${skipped} without a title or date will be skipped)` : ""}`,
        importAsk: "Save them to your company now?", importNothing: "I found no table with a title column and a date column (or a violation number and date). Import it from the Import page to map the columns manually.", importDoneTitle: "✅ Saved:", importDoneLine: (tracker, n, isNew) => `• ${tracker}: ${n} items${isNew ? " (new tracker with a reminder rule one day before due)" : ""}`,
        importCancelled: "Import cancelled; nothing was saved.", importExpired: "This request has expired. Send the file again.", importLimit: "Saving stopped at your plan’s item limit — upgrade from Settings and send the file again.", importFailed: "Saving failed. Try again or import from the Import page.",
        btnSave: "✅ Save", btnCancel: "❌ Cancel",
        kindViolation: "Violation", kindSession: "Session", kindTask: "Task", fWhen: "When", fClient: "Client", fCase: "Case no.", fViolation: "Violation no.", fAmount: "Amount", fPlace: "Authority/place", fNotes: "Notes",
        actAddTitle: "📝 I will record this:", actDoneTitle: "✔️ I will mark as done:", actAssignTitle: "👤 I will assign:", confirmAsk: "Confirm?",
        actSaved: (num, title, tracker, isNew) => `✅ Saved${num ? ` (${num})` : ""}: ${title}\nin “${tracker}”${isNew ? " — new tracker with a reminder one day before" : ""}.`,
        actDoneOk: (num, title) => `✅ Done${num ? ` (${num})` : ""}: ${title}`,
        actAssignOk: (title, member, notified) => `✅ “${title}” assigned to ${member}${notified ? " and notified on Telegram" : ""}.`,
        assignedToYou: (title, num) => `👤 Assigned to you${num ? ` (${num})` : ""}: ${title}`,
        notFound: (q) => `No open item matches “${q}”.`, manyFound: "More than one item matches:", manyHint: "Specify by its number or with more precise words.", noMember: (m) => `No team member named “${m}”.`,
        searchTitle: (q) => `🔎 Results for “${q}”:`, searchNone: (q) => `Nothing matches “${q}”.`, statusDone: "done", days: "days", noFiles: "⚠️ no files",
        digestTitle: (n) => `☀️ Good morning${n ? ` ${n}` : ""} — today’s brief:`, digestToday: (n) => `📅 Today (${n}):`, digestTodayNone: "📅 Nothing due today.",
        digestTomorrow: (n) => `⏭ Tomorrow (${n}):`, digestFines: (n, total) => `💸 Fines whose deadline ends within 3 days (${n}), total ${total}:`,
        digestOverdue: (n, amt) => `⚠️ Overdue: ${n} items${amt && amt !== "0" ? ` — fines worth ${amt}` : ""}.`, digestNeglected: "🕸 Untouched for over 30 days:",
        digestFooter: (n) => `Open in total: ${n}. Send me anything to record it, or ask.`,
        prepTitle: (n) => `🌙 ${n ? n + ", " : ""}tomorrow’s prep:`, prepNone: "No sessions tomorrow.",
        needsParent: "Which case or violation does this task belong to? (no task stands alone) — pick one:", noParents: "There is no open case or violation for this task to belong to. Record the case or violation first.",
        voiceHeard: "🎙 I heard: ", fileUnreadable: "I could not read this file. Send a PDF, image, Excel or CSV.", fileTooBig: "The file exceeds the allowed size (15 MB).", fileQuestion: "Summarize this file briefly and say what the user can do with it in TheTracker (for example import it from the Import page if it is a table of due dates, violations or cases).",
        linkIntro: "Welcome to TheTracker 👋\nTap the button to link this bot to your account: the settings page opens and the link completes automatically.",
        menuHint: "Pick an option below:",
        upcomingTitle: "📅 Your upcoming due dates:", overdueTitle: "⏰ Overdue items:",
        noUpcoming: "Nothing upcoming 👌", noOverdue: "Nothing overdue 👌",
        help: "Just type: search, my dates, add a task, done, assign. Or use the buttons." },
  fr: { company: "🏢 Societe", upcoming: "📅 À venir", overdue: "⏰ En retard", dashboard: "🌐 Tableau de bord", help: "❓ Aide",
        linkBtn: "🔗 Lier mon compte", openDash: "Ouvrir le tableau de bord",
        phoneBtn: "📱 Lier avec mon numéro", phoneHint: "Ou partagez le numéro enregistré dans TheTracker avec le bouton ci-dessous : la liaison est immédiate.",
        phoneNotFound: "Aucun compte avec ce numéro. Connectez-vous sur le site et appuyez sur le bouton de liaison ci-dessus.",
        importFound: (file, n) => `📄 ${file}\n${n} feuille(s) importable(s) trouvée(s) :`, importSheet: (name, rows, skipped) => `• ${name} : ${rows} lignes${skipped ? ` (${skipped} sans titre ou date seront ignorées)` : ""}`,
        importAsk: "Les enregistrer dans votre société maintenant ?", importNothing: "Aucun tableau avec une colonne titre et une colonne date (ou numéro d’infraction et date). Importez-le depuis la page Import pour mapper les colonnes.", importDoneTitle: "✅ Enregistré :", importDoneLine: (tracker, n, isNew) => `• ${tracker} : ${n} éléments${isNew ? " (nouveau suivi avec rappel la veille)" : ""}`,
        importCancelled: "Import annulé ; rien n’a été enregistré.", importExpired: "Cette demande a expiré. Renvoyez le fichier.", importLimit: "Enregistrement arrêté à la limite d’éléments de votre forfait — passez au forfait supérieur puis renvoyez le fichier.", importFailed: "Échec de l’enregistrement. Réessayez ou importez depuis la page Import.",
        btnSave: "✅ Enregistrer", btnCancel: "❌ Annuler",
        kindViolation: "Infraction", kindSession: "Audience", kindTask: "Tâche", fWhen: "Quand", fClient: "Client", fCase: "N° d’affaire", fViolation: "N° d’infraction", fAmount: "Montant", fPlace: "Autorité/lieu", fNotes: "Notes",
        actAddTitle: "📝 Je vais enregistrer :", actDoneTitle: "✔️ Je vais marquer comme terminé :", actAssignTitle: "👤 Je vais attribuer :", confirmAsk: "Confirmer ?",
        actSaved: (num, title, tracker, isNew) => `✅ Enregistré${num ? ` (${num})` : ""} : ${title}\ndans « ${tracker} »${isNew ? " — nouveau suivi avec rappel la veille" : ""}.`,
        actDoneOk: (num, title) => `✅ Terminé${num ? ` (${num})` : ""} : ${title}`,
        actAssignOk: (title, member, notified) => `✅ « ${title} » attribué à ${member}${notified ? " et notifié sur Telegram" : ""}.`,
        assignedToYou: (title, num) => `👤 Attribué à vous${num ? ` (${num})` : ""} : ${title}`,
        notFound: (q) => `Aucun élément ouvert ne correspond à « ${q} ».`, manyFound: "Plusieurs éléments correspondent :", manyHint: "Précisez par le numéro ou des mots plus précis.", noMember: (m) => `Aucun membre nommé « ${m} ».`,
        searchTitle: (q) => `🔎 Résultats pour « ${q} » :`, searchNone: (q) => `Rien ne correspond à « ${q} ».`, statusDone: "terminé", days: "jours", noFiles: "⚠️ sans pièces",
        digestTitle: (n) => `☀️ Bonjour${n ? ` ${n}` : ""} — le point du jour :`, digestToday: (n) => `📅 Aujourd’hui (${n}) :`, digestTodayNone: "📅 Rien aujourd’hui.",
        digestTomorrow: (n) => `⏭ Demain (${n}) :`, digestFines: (n, total) => `💸 Amendes dont le délai expire sous 3 jours (${n}), total ${total} :`,
        digestOverdue: (n, amt) => `⚠️ En retard : ${n} éléments${amt && amt !== "0" ? ` — amendes de ${amt}` : ""}.`, digestNeglected: "🕸 Sans mise à jour depuis plus de 30 jours :",
        digestFooter: (n) => `Total ouvert : ${n}. Envoyez-moi n’importe quoi à enregistrer, ou posez une question.`,
        prepTitle: (n) => `🌙 ${n ? n + ", " : ""}préparation de demain :`, prepNone: "Aucune audience demain.",
        needsParent: "À quelle affaire ou infraction cette tâche appartient-elle ? (aucune tâche isolée) — choisissez :", noParents: "Aucune affaire ni infraction ouverte à laquelle rattacher cette tâche. Enregistrez-la d’abord.",
        voiceHeard: "🎙 J’ai entendu : ", fileUnreadable: "Impossible de lire ce fichier. Envoyez un PDF, une image, un Excel ou un CSV.", fileTooBig: "Le fichier dépasse la taille autorisée (15 Mo).", fileQuestion: "Résume brièvement ce fichier et indique ce que l’utilisateur peut en faire dans TheTracker (par exemple l’importer depuis la page Import s’il s’agit d’un tableau d’échéances, d’infractions ou d’affaires).",
        linkIntro: "Bienvenue sur TheTracker 👋\nAppuyez sur le bouton pour lier ce bot à votre compte : la page Paramètres s’ouvre et la liaison se fait automatiquement.",
        menuHint: "Choisissez une option ci-dessous :",
        upcomingTitle: "📅 Vos échéances à venir :", overdueTitle: "⏰ Éléments en retard :",
        noUpcoming: "Rien à venir 👌", noOverdue: "Rien en retard 👌",
        help: "Ecrivez simplement : recherche, mes echeances, ajouter une tache, termine, assigner. Ou utilisez les boutons." },
  ur: { company: "🏢 کمپنی", upcoming: "📅 آنے والی تاریخیں", overdue: "⏰ تاخیر شدہ", dashboard: "🌐 ڈیش بورڈ", help: "❓ مدد",
        linkBtn: "🔗 میرا اکاؤنٹ منسلک کریں", openDash: "ڈیش بورڈ کھولیں",
        phoneBtn: "📱 فون نمبر سے منسلک کریں", phoneHint: "یا نیچے دیے بٹن سے TheTracker میں رجسٹرڈ فون نمبر شیئر کریں — منسلکی فورا مکمل ہو جائے گی۔",
        phoneNotFound: "اس نمبر سے کوئی اکاؤنٹ نہیں ملا۔ ویب سائٹ پر سائن ان کر کے اوپر والا لنک بٹن دبائیں۔",
        importFound: (file, n) => `📄 ${file}\n${n} قابل درآمد شیٹ ملی:`, importSheet: (name, rows, skipped) => `• ${name}: ${rows} قطاریں${skipped ? ` (${skipped} بغیر عنوان یا تاریخ چھوڑ دی جائیں گی)` : ""}`,
        importAsk: "ابھی اپنی کمپنی میں محفوظ کروں؟", importNothing: "فائل میں عنوان اور تاریخ کے کالم والا جدول نہیں ملا (یا خلاف ورزی نمبر اور تاریخ)۔ کالم خود ترتیب دینے کے لیے درآمد صفحے سے درآمد کریں۔", importDoneTitle: "✅ محفوظ ہو گیا:", importDoneLine: (tracker, n, isNew) => `• ${tracker}: ${n} آئٹمز${isNew ? " (نیا ٹریکر، یاد دہانی ایک دن پہلے)" : ""}`,
        importCancelled: "درآمد منسوخ؛ کچھ محفوظ نہیں ہوا۔", importExpired: "یہ درخواست ختم ہو گئی۔ فائل دوبارہ بھیجیں۔", importLimit: "آپ کے پلان کی آئٹم حد پر محفوظ کرنا رک گیا — ترتیبات سے پلان اپ گریڈ کر کے دوبارہ بھیجیں۔", importFailed: "محفوظ نہیں ہو سکا۔ دوبارہ کوشش کریں یا درآمد صفحے سے درآمد کریں۔",
        btnSave: "✅ محفوظ کریں", btnCancel: "❌ منسوخ",
        kindViolation: "خلاف ورزی", kindSession: "سماعت", kindTask: "کام", fWhen: "کب", fClient: "کلائنٹ", fCase: "مقدمہ نمبر", fViolation: "خلاف ورزی نمبر", fAmount: "رقم", fPlace: "ادارہ/جگہ", fNotes: "نوٹس",
        actAddTitle: "📝 میں یہ درج کروں گا:", actDoneTitle: "✔️ مکمل کے طور پر نشان لگاؤں گا:", actAssignTitle: "👤 تفویض کروں گا:", confirmAsk: "تصدیق؟",
        actSaved: (num, title, tracker, isNew) => `✅ محفوظ${num ? ` (${num})` : ""}: ${title}\n«${tracker}» میں${isNew ? " — نیا ٹریکر، یاد دہانی ایک دن پہلے" : ""}۔`,
        actDoneOk: (num, title) => `✅ مکمل${num ? ` (${num})` : ""}: ${title}`,
        actAssignOk: (title, member, notified) => `✅ «${title}» ${member} کو تفویض${notified ? " اور ٹیلیگرام پر مطلع" : ""}۔`,
        assignedToYou: (title, num) => `👤 آپ کو تفویض${num ? ` (${num})` : ""}: ${title}`,
        notFound: (q) => `«${q}» سے ملتا کوئی کھلا آئٹم نہیں۔`, manyFound: "ایک سے زیادہ آئٹم ملے:", manyHint: "نمبر یا زیادہ واضح الفاظ سے بتائیں۔", noMember: (m) => `«${m}» نام کا کوئی رکن نہیں۔`,
        searchTitle: (q) => `🔎 «${q}» کے نتائج:`, searchNone: (q) => `«${q}» سے کچھ نہیں ملا۔`, statusDone: "مکمل", days: "دن", noFiles: "⚠️ بغیر فائل",
        digestTitle: (n) => `☀️ صبح بخیر${n ? ` ${n}` : ""} — آج کا خلاصہ:`, digestToday: (n) => `📅 آج (${n}):`, digestTodayNone: "📅 آج کچھ نہیں۔",
        digestTomorrow: (n) => `⏭ کل (${n}):`, digestFines: (n, total) => `💸 3 دن میں مہلت ختم ہونے والی خلاف ورزیاں (${n})، کل ${total}:`,
        digestOverdue: (n, amt) => `⚠️ تاخیر: ${n} آئٹمز${amt && amt !== "0" ? ` — ${amt} کی خلاف ورزیاں` : ""}۔`, digestNeglected: "🕸 30 دن سے زیادہ سے بغیر اپ ڈیٹ:",
        digestFooter: (n) => `کل کھلے: ${n}۔ کچھ بھی بھیجیں درج کرنے کے لیے، یا پوچھیں۔`,
        prepTitle: (n) => `🌙 ${n ? n + "، " : ""}کل کی تیاری:`, prepNone: "کل کوئی سماعت نہیں۔",
        needsParent: "یہ کام کس مقدمے یا خلاف ورزی سے متعلق ہے؟ (کوئی کام الگ نہیں) — چنیں:", noParents: "اس کام کے لیے کوئی کھلا مقدمہ یا خلاف ورزی نہیں۔ پہلے مقدمہ یا خلاف ورزی درج کریں۔",
        voiceHeard: "🎙 میں نے سنا: ", fileUnreadable: "یہ فائل پڑھی نہیں جا سکی۔ PDF، تصویر، ایکسل یا CSV بھیجیں۔", fileTooBig: "فائل اجازت شدہ حد (15 MB) سے بڑی ہے۔", fileQuestion: "اس فائل کا مختصر خلاصہ کریں اور بتائیں کہ صارف TheTracker میں اس کا کیا کر سکتا ہے (مثلا اگر یہ تاریخوں، خلاف ورزیوں یا مقدمات کا جدول ہے تو درآمد صفحے سے درآمد کریں)۔",
        linkIntro: "TheTracker میں خوش آمدید 👋\nاس بوٹ کو اپنے اکاؤنٹ سے منسلک کرنے کے لیے بٹن دبائیں: ترتیبات کا صفحہ کھلے گا اور منسلکی خود بخود مکمل ہو جائے گی۔",
        menuHint: "نیچے دیے گئے بٹنوں میں سے چنیں:",
        upcomingTitle: "📅 آپ کی آنے والی تاریخیں:", overdueTitle: "⏰ تاخیر شدہ آئٹمز:",
        noUpcoming: "کوئی آنے والی تاریخ نہیں 👌", noOverdue: "کوئی تاخیر نہیں 👌",
        help: "بس لکھیں: تلاش، میری تاریخیں، کام شامل کریں، مکمل، تفویض۔ یا بٹن استعمال کریں۔" },
};
export function bot(lang) { return BOT[lang] || BOT.ar; }

/* لوحة الأزرار الدائمة أسفل المحادثة */
export function menuKeyboard(lang) {
  const b = bot(lang);
  return { reply_markup: { keyboard: [[{ text: b.company }, { text: b.dashboard }], [{ text: b.upcoming }, { text: b.overdue }]], resize_keyboard: true, is_persistent: true } };
}

/* أي زر ضغطه المستخدم بأي لغة؟ يعيد upcoming/overdue/dashboard/help أو null */
export function menuAction(text) {
  const s = String(text || "").trim();
  if (/^\/(upcoming|overdue|dashboard|help|menu)$/.test(s)) return s.slice(1);
  for (const lang of Object.keys(BOT)) {
    for (const key of ["company", "upcoming", "overdue", "dashboard", "help"]) if (BOT[lang][key] === s) return key;
  }
  return null;
}

/* زر يفتح رابطا (لوحة التحكم أو صفحة الربط) */
export function urlButton(label, url) {
  return { reply_markup: { inline_keyboard: [[{ text: label, url }]] } };
}

/* قائمة مواعيد بنص مقروء */
export function formatItems(lang, rows, title, emptyText, userTimeZone, userHour12) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return emptyText;
  const words = PAPER_WORDS[lang] || PAPER_WORDS.ar;
  const lines = list.map((r, i) => {
    if (r.document_kind || r.doc_number) {
      /* ورقة رسمية: رقمها هي (السجل/الضريبي…) وتاريخا الإصدار والانتهاء، لا الرقم القياسي ولا وقت */
      const num = r.doc_number ? ` — ${words[0]} ${r.doc_number}` : "";
      const issued = r.issue_date ? `${words[1]} ${dmy(r.issue_date)} · ` : "";
      return `${i + 1}. ${r.title || ""}${num}\n   ${issued}${r.due_at ? `${words[2]} ${dmy(r.due_at)}` : "-"}`;
    }
    const who = r.client_name ? ` — ${r.client_name}` : "";
    const caseNo = String(r.case_number || "").trim();
    const num = /[\p{L}\p{N}]/u.test(caseNo) ? ` (${caseNo})` : ""; /* شرطة أو فراغ من الاستيراد ليست رقما */
    const tr = r.tracker_name ? ` · ${r.tracker_name}` : "";
    return `${i + 1}. ${r.title || ""}${who}${num}\n   ${r.due_at ? fmtDue(r.due_at, userTimeZone, userHour12) : "-"}${tr}`;
  });
  return `${title}\n\n${lines.join("\n")}`;
}

export async function telegramItems(env, userId, mode, limit) {
  return rpc(env, "telegram_items", { p_secret: env.WORKER_SECRET, p_user_id: userId, p_mode: mode, p_limit: limit || 5 });
}

export async function linkChannelByPhone(env, channel, phone, externalId) {
  return rpc(env, "link_channel_by_phone", { p_secret: env.WORKER_SECRET, p_channel: channel, p_phone: String(phone || ""), p_external_id: String(externalId) });
}

/* لوحة بزر واحد يطلب مشاركة رقم الجوال (تختفي بعد الاستخدام) */
export function contactKeyboard(lang) {
  return { reply_markup: { keyboard: [[{ text: bot(lang).phoneBtn, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } };
}

export async function linkChannelDirect(env, userId, channel, externalId) {
  return rpc(env, "link_channel_direct", { p_secret: env.WORKER_SECRET, p_user_id: userId, p_channel: channel, p_external_id: String(externalId) });
}

/* الصيغة القياسية نفسها في كل قناة: dd-MM-yyyy HH:mm، ميلادي، أرقام غربية،
   بلا اختلاف بين اللغات — مطابقة app.fmtDate في الموقع ومعيار تطبيق باركينزي.
   المنطقة الزمنية وصيغة الوقت (24 أو 12 ساعة) باختيار المستلم من إعداداته
   (profiles.tz وprofiles.time_format)، والافتراض توقيت الرياض و24 ساعة. */
/* التواريخ للمستخدم دائما يوم-شهر-سنة؛ أي قيمة ليست تاريخا تعود كما هي */
/* الأرقام غربية دائما: ما يكتبه المستخدم بالأرقام العربية الشرقية أو الفارسية يُحوَّل قبل أي فهم أو تخزين */
export function westernDigits(text) {
  return String(text || "").replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => { const c = d.charCodeAt(0); return String(c >= 0x06F0 ? c - 0x06F0 : c - 0x0660); });
}
export function dmy(v) {
  const t = String(v || "").slice(0, 10);
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : t;
}
const PAPER_WORDS = { ar: ["رقم", "إصدار", "ينتهي"], en: ["No.", "issued", "expires"], fr: ["n°", "délivré le", "expire le"], ur: ["نمبر", "اجرا", "ختم"] };
function fmtDue(iso, userTimeZone, userHour12) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: userTimeZone || "Asia/Riyadh", numberingSystem: "latn",
      year: "numeric", month: "2-digit", day: "2-digit", hour: userHour12 ? "numeric" : "2-digit", minute: "2-digit", hour12: !!userHour12,
    }).formatToParts(new Date(iso));
    const by = {};
    parts.forEach((p) => { by[p.type] = p.value; });
    const dayPeriod = String(by.dayPeriod || "").replace(/\s/g, "").toUpperCase();
    const timePart = userHour12 ? `${by.hour}:${by.minute} ${dayPeriod}` : `${by.hour}:${by.minute}`;
    return `${by.day}-${by.month}-${by.year} ${timePart}`;
  } catch { return String(iso); }
}

// ---------- القنوات ----------
export async function sendEmail(env, { to, lang, title, due_at, tracker_name, org_name, tz: userTimeZone, hour12: userHour12 }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.WORKER_SECRET) throw new Error("email not configured");
  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/send-zoho-email`, {
    method: "POST",
    headers: { ...anonHeaders(env), "x-tracker-secret": env.WORKER_SECRET },
    body: JSON.stringify({ action: "send-reminder", to, lang, title, due_at, tracker_name, org_name, tz: userTimeZone, hour12: userHour12 }),
    cf: NO_CACHE,
  });
  if (!res.ok) throw new Error(`email ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

export async function sendTelegram(env, chatId, text, extra) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("telegram not configured");
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, ...(extra || {}) }),
  });
  if (!res.ok) throw new Error(`telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

/* «يكتب الآن…» ريثما يحضر الرد (صوت/ملف/نموذج) */
export async function sendChatAction(env, chatId, action) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: action || "typing" }),
    });
  } catch {}
}

/* تنزيل ملف أرسله المستخدم (صوت/مستند/صورة) عبر getFile — بحد أقصى للحجم */
export const TELEGRAM_FILE_MAX = 15 * 1024 * 1024;
export async function fetchTelegramFile(env, fileId) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("telegram not configured");
  const info = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`).then((r) => r.json());
  const path = info && info.ok && info.result && info.result.file_path;
  if (!path) throw new Error("getFile failed");
  const size = Number((info.result && info.result.file_size) || 0);
  if (size > TELEGRAM_FILE_MAX) throw new Error("file too big");
  const res = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`);
  if (!res.ok) throw new Error(`file download ${res.status}`);
  return { bytes: await res.arrayBuffer(), path };
}

export function bytesToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

/* رد على ضغطة زر داخلي وإزالة الأزرار من الرسالة بعد الاختيار */
export async function answerCallback(env, callbackId, text) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackId, text: text || undefined }),
    });
  } catch {}
}
export async function clearInlineButtons(env, chatId, messageId) {
  if (!env.TELEGRAM_BOT_TOKEN || !messageId) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageReplyMarkup`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }),
    });
  } catch {}
}
/* زرا التأكيد يحملان رمز المسودة كي لا ينفذ زر قديم مسودة أحدث */
export function actionButtons(lang, token) {
  const b = bot(lang);
  const t = token ? ":" + token : "";
  return { reply_markup: { inline_keyboard: [[{ text: b.btnSave, callback_data: "act:y" + t }, { text: b.btnCancel, callback_data: "act:n" + t }]] } };
}

/* أفعال الكتابة: لا تنفذ بلا طلب صريح في رسالة المستخدم نفسها، ثم لا تنفذ إلا بعد تأكيده.
   كلمات المجاملة (أحسنت، شكرا…) ليست أوامر — هذا ما أقفل مخالفة بالخطأ ذات مرة. */
export const VERBS = {
  add: /(أضف|اضف|ضيف|سجل|سجّل|أنشئ|انشئ|اعمل|سوي|سو |افتح قضية|افتح مخالفة|add|create|new task|register|ajoute|enregistre|شامل کر|درج کر)/i,
  done: /(أنجزت|انجزت|أنجزنا|انجزنا|تم إنجاز|تم انجاز|تم إنهاء|تم انهاء|أنهيت|انهيت|أنهينا|انهينا|أقفل|اقفل|أغلق|اغلق|إقفال|اقفال|إغلاق|اغلاق|خلصت|خلصنا|انتهت|انتهى|انتهينا|اعتبرها منجزة|اعتبره منجزا|كمنجز|منجزة|سددت|سُددت|تم سداد|تم دفع|دفعنا|دفعت|تم الدفع|تم السداد|\bdone\b|complete|finish|\bclose|paid|termin|clôtur|مکمل|ختم کر)/i,
  assign: /(أسند|اسند|إسناد|اسناد|كلف|كلّف|تكليف|حوّل|حول|عيّن|عين|assign|delegate|hand (?:it )?to|attribue|confie|تفویض|سونپ)/i,
  remind: /(ذكرني|ذكّرني|ذكرنا|ذكّرنا|نبهني|نبّهني|نبهنا|remind (?:me|us)|rappelle|یاد دلا)/i,
};
/* التذكير ينفذ مباشرة، لذلك يشترط طلبا موجبا بمهلة، ولا إلغاء ولا نفي ولا سؤال في الرسالة */
const REMIND_LEAD = /(\d+|يوم|أيام|ساعة|ساعات|أسبوع|أسبوعين|شهر|قبل|day|hour|week|month|before|jour|heure|semaine|دن|گھنٹ|ہفت)/i;
const REMIND_NEG = /(ألغ|الغ|احذف|أزل|ازل|شيل|لا تذكر|لا تنبه|بدون|هل |؟|\?|cancel|remove|delete|stop|don't|do not|is there|annule|supprime)/i;
const WRITE_TOOLS = { tracker_add: "add", tracker_complete: "done", tracker_assign: "assign", tracker_remind: "remind" };
/* يحكم نداء أداة كتابة: ممنوع بلا فعل صريح، وإلا يتحول إلى نية تنتظر تأكيد المستخدم (لا تنفيذ هنا) */
export function writeGate(name, args, text) {
  const action = WRITE_TOOLS[name];
  if (!action) return { allow: true };
  const t = String(text || "");
  if (action === "remind") {
    if (VERBS.remind.test(t) && REMIND_LEAD.test(t) && !REMIND_NEG.test(t)) return { allow: true };
    return { blocked: true, reason: "لم يطلب المستخدم تذكيرا جديدا بصيغة صريحة (ذكرني قبل … بـ …)؛ لا تغير التذكيرات. إن كان يسأل أو يلغي فأجبه نصا فقط." };
  }
  if (!VERBS[action].test(t)) return { blocked: true, reason: "لم يطلب المستخدم هذا الإجراء في رسالته؛ لا تنفذه ولا تقترحه. أجب على رسالته كما هي (إن كانت مجاملة أو شكرا فرد بجملة قصيرة)." };
  const a = args && typeof args === "object" ? args : {};
  const q = String(a.query || "").trim();
  /* بلا تحديد للعنصر لا شيء يمر: استعلام فارغ في القاعدة يطابق كل شيء */
  if (action === "done" && !a.item_id && !q) return { blocked: true, reason: "حدد العنصر المطلوب إنجازه (عنوانه أو رقم القضية أو المخالفة)، واسأل المستخدم سؤالا واحدا إن لم يتضح." };
  if (action === "assign" && (!q || !String(a.member || "").trim())) return { blocked: true, reason: "حدد العنصر واسم العضو، واسأل المستخدم سؤالا واحدا إن لم يتضح." };
  if (action === "done") return { pending: { action: "done", query: q, item_id: a.item_id || null } };
  if (action === "assign") return { pending: { action: "assign", query: q, member: String(a.member || "").trim() } };
  const item = {};
  for (const k of ["kind", "title", "client_name", "case_number", "violation_number", "amount", "due_at", "location", "notes", "category", "parent_id"]) if (a[k] != null && a[k] !== "") item[k] = a[k];
  return { pending: { action: "add", item } };
}
/* وصف قصير لما سيحدث، لعميل MCP كي يعرضه على صاحبه قبل التأكيد */
export function describePending(p) {
  if (!p) return "";
  if (p.action === "done") return "mark as done: " + (p.query || p.item_id || "");
  if (p.action === "assign") return "assign «" + p.query + "» to " + p.member;
  const it = p.item || {};
  return "add " + (it.kind || "task") + ": " + (it.title || "") + (it.due_at ? " — due " + dmy(it.due_at) : "") + (it.client_name ? " — " + it.client_name : "");
}
export function confirmButtons(lang) {
  const b = bot(lang);
  return { reply_markup: { inline_keyboard: [[{ text: b.btnSave, callback_data: "imp:y" }, { text: b.btnCancel, callback_data: "imp:n" }]] } };
}

export async function sendWhatsapp(env, phone, text) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) throw new Error("whatsapp not configured");
  const res = await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: String(phone).replace(/[^\d]/g, ""), type: "text", text: { body: text } }),
  });
  if (!res.ok) throw new Error(`whatsapp ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

export async function sendSms(env, phone, text) {
  const provider = (env.SMS_PROVIDER || "").toLowerCase();
  if (provider === "twilio") {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) throw new Error("sms not configured");
    const body = new URLSearchParams({ To: phone, From: env.TWILIO_FROM, Body: text });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`sms ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return true;
  }
  if (provider === "unifonic") {
    if (!env.UNIFONIC_APPSID || !env.UNIFONIC_SENDER) throw new Error("sms not configured");
    const body = new URLSearchParams({ AppSid: env.UNIFONIC_APPSID, SenderID: env.UNIFONIC_SENDER, Recipient: String(phone).replace(/[^\d]/g, ""), Body: text });
    const res = await fetch("https://el.cloud.unifonic.com/rest/SMS/messages", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
    });
    if (!res.ok) throw new Error(`sms ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return true;
  }
  throw new Error("sms not configured");
}

// ---------- ربط القنوات (رمز تحقق من الإعدادات) ----------
export async function linkChannelByCode(env, channel, code, externalId) {
  const safe = String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!safe || !env.WORKER_SECRET) return null;
  try {
    const userId = await rpc(env, "link_channel", { p_secret: env.WORKER_SECRET, p_channel: channel, p_code: safe, p_external_id: String(externalId) });
    return userId || null;
  } catch { return null; }
}

export async function notifyTarget(env, userId, channel) {
  return rpc(env, "notify_target", { p_secret: env.WORKER_SECRET, p_user_id: userId, p_channel: channel });
}

// ---------- Cron: توليد التنبيهات المستحقة وإرسالها ----------
export async function runNotificationCron(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.WORKER_SECRET) return { skipped: "not configured" };

  let pending;
  try {
    pending = await rpc(env, "cron_pending_notifications", { p_secret: env.WORKER_SECRET });
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 200) };
  }
  if (!Array.isArray(pending)) pending = [];
  let sent = 0, failed = 0;

  for (const n of pending) {
    const lang = n.lang || "ar";
    const userTimeZone = n.tz || "Asia/Riyadh";
    const userHour12 = n.time_format === "12";
    const text = t(lang).reminder(n.title || "", n.due_at ? fmtDue(n.due_at, userTimeZone, userHour12) : "-", n.tracker_name);
    let status = "sent", error = null;
    try {
      if (n.channel === "email") {
        if (!n.email) throw new Error("no email");
        await sendEmail(env, { to: n.email, lang, title: n.title, due_at: n.due_at, tracker_name: n.tracker_name, org_name: n.org_name, tz: userTimeZone, hour12: userHour12 });
      } else if (!n.external_id) {
        status = "skipped"; error = "channel not linked";
      } else if (n.channel === "telegram") await sendTelegram(env, n.external_id, text);
      else if (n.channel === "whatsapp") await sendWhatsapp(env, n.external_id, text);
      else if (n.channel === "sms") await sendSms(env, n.external_id, text);
      else { status = "skipped"; error = "unknown channel"; }
    } catch (e) {
      status = "failed"; error = String((e && e.message) || e).slice(0, 300);
    }
    if (status === "sent") sent++; else if (status === "failed") failed++;
    try {
      await rpc(env, "cron_mark_notification", { p_secret: env.WORKER_SECRET, p_id: n.id, p_status: status, p_error: error });
    } catch {}
  }
  return { pending: pending.length, sent, failed };
}
