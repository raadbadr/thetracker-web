    const translations = {
      ar: {
        templateBtn: "تنزيل القالب",
        title: "استيراد من Excel",
        subtitle: "ارفع ملف Excel أو CSV، ثم اربط أعمدته بحقول السجل، وسنتولى الباقي.",
        loading: "جاري التحميل...",
        serviceUnavailableTitle: "الخدمة قيد التجهيز",
        serviceUnavailableText: "نعمل حاليا على تجهيز الخدمة، حاول مرة أخرى لاحقا.",
        backHome: "العودة للرئيسية",
        noOrgTitle: "لا توجد شركة محددة",
        noOrgText: "أنشئ شركتك أولا من لوحة التحكم ثم عد إلى هذه الصفحة.",
        goDashboard: "الانتقال إلى لوحة التحكم",
        backBtn: "العودة إلى لوحة التحكم",
        step1Title: "1. اختر الملف",
        dropTitle: "اسحب الملف إلى هنا أو انقر لاختياره",
        dropHint: "xlsx · xls · csv · tsv · json",
        chooseFile: "اختيار ملف",
        readingFile: "جاري قراءة الملف...",
        readError: "تعذرت قراءة الملف، تأكد من أنه ملف Excel أو CSV صالح.",
        libMissing: "تعذر تحميل مكتبة قراءة الملفات، أعد تحميل الصفحة وحاول مرة أخرى.",
        unsupportedType: "نوع الملف غير مدعوم، اختر ملفا بصيغة xlsx أو xls أو csv.",
        emptySheet: "لا تحتوي هذه الورقة على بيانات.",
        fileLoaded: "تمت قراءة الملف: {name} ({rows} صفا، {cols} عمودا).",
        step2Title: "2. معاينة البيانات",
        sheetLabel: "الورقة",
        previewNote: "تعرض أول {shown} صفا من أصل {total}.",
        columnN: "عمود",
        step3Title: "3. ربط الأعمدة",
        mapTitle: "العنوان",
        mapDue: "تاريخ الاستحقاق",
        mapCategory: "التصنيف",
        mapAssignee: "بريد المسؤول",
        mapStatus: "الحالة",
        sheetKind: "نوع الورقة",
        sheetKindGeneral: "عام (مواعيد وعقود)",
        sheetKindViolations: "مخالفات",
        graceDays: "مهلة السداد (أيام)",
        mapVNumber: "رقم المخالفة",
        mapCaseNumber: "رقم الدعوى",
        mapAmount: "مبلغ المخالفة",
        mapClient: "الشركة (العميل)",
        mapLocation: "الموقع",
        violationTitle: "مخالفة رقم {n}",
        required: "مطلوب",
        optional: "اختياري",
        notMapped: "— بدون —",
        mappingHint: "الأعمدة غير المربوطة تحفظ كبيانات إضافية مع كل عنصر.",
        statusHint: "في عمود الحالة تعتبر القيم done أو منجز أو completed منجزة، وما عداها يبقى مفتوحا.",
        validRows: "الصفوف الصالحة للاستيراد: {n}",
        skippedRows: "صفوف ستتجاهل لعدم وجود عنوان أو تاريخ صالح: {n}",
        unmatchedAssignees: "صفوف ببريد مسؤول غير موجود في الفريق: {n}",
        unmatchedHint: "لم يعثر على هذه العناوين بين أعضاء الفريق، وستستورد عناصرها بدون مسؤول: {list}",
        step4Title: "4. السجل",
        trackerLabel: "أضف العناصر إلى",
        newTracker: "سجل جديد",
        trackerNamePlaceholder: "اسم السجل الجديد",
        trackerNameRequired: "أدخل اسم السجل الجديد.",
        step5Title: "5. التحقق من الباقة",
        importsThisMonth: "عمليات الاستيراد هذا الشهر",
        itemsUsage: "العناصر المستخدمة",
        rowsToImport: "الصفوف التي ستستورد",
        unlimited: "غير محدود",
        ofLimit: "{used} من {limit}",
        checkingPlan: "جاري التحقق من الباقة...",
        planOk: "باقتك الحالية تسمح بهذا الاستيراد.",
        planImportsExceeded: "وصلت إلى الحد الأقصى لعمليات الاستيراد في هذا الشهر ({used} من {limit}). رق باقتك للمتابعة.",
        planItemsExceeded: "عدد الصفوف الصالحة ({rows}) يتجاوز العناصر المتبقية في باقتك ({remaining} متبقية من أصل {limit}). رق باقتك أو قلل عدد الصفوف.",
        upgradePlan: "ترقية الباقة",
        importBtn: "بدء الاستيراد",
        mappingRequired: "اختر عمود العنوان وعمود تاريخ الاستحقاق أولا.",
        mappingRequiredDue: "اختر عمود تاريخ الاستحقاق أولا.",
        noValidRows: "لا توجد صفوف صالحة للاستيراد، تحقق من ربط الأعمدة.",
        progressCreatingTracker: "جاري إنشاء السجل...",
        progressImport: "جاري تسجيل عملية الاستيراد...",
        progressInserting: "جاري إدراج العناصر: {done} من {total}",
        progressRule: "جاري إنشاء قاعدة التنبيه الافتراضية...",
        importFailed: "فشل الاستيراد: {error}",
        importPartial: "توقف الاستيراد بعد إدراج {done} عنصرا.",
        planLimitItems: "وصلت إلى الحد الأقصى لعدد العناصر في باقتك الحالية، رق باقتك لإضافة المزيد.",
        summaryTitle: "اكتمل الاستيراد",
        summaryInserted: "عناصر مدرجة",
        summarySkipped: "صفوف متجاهلة",
        summaryUnmatched: "صفوف بمسؤول غير مطابق",
        summaryTracker: "أضيفت العناصر إلى السجل: {name}",
        summaryRuleNote: "أنشئت قاعدة تنبيه افتراضية: تذكير عبر البريد الإلكتروني قبل الاستحقاق بيوم واحد.",
        summaryRuleFailed: "تعذر إنشاء قاعدة التنبيه الافتراضية، يمكنك إضافتها لاحقا من صفحة التنبيهات.",
        importAnother: "استيراد ملف آخر",
        genericError: "حدث خطأ، حاول مرة أخرى.",
        copyrightLine2: "جميع الحقوق محفوظة",
        aboutLink: "من نحن",
        termsLink: "شروط الاستخدام",
        pricingLink: "الباقات والأسعار",
        privacyLink: "سياسة الخصوصية",
        loginLink: "تسجيل الدخول",
        dashboardLink: "لوحة التحكم",
        contactLink: "تواصل معنا",
        language: "اللغة",
        appearance: "المظهر",
        light: "فاتح",
        dark: "داكن"
      },
      en: {
        templateBtn: "Download template",
        title: "Import from Excel",
        subtitle: "Upload an Excel or CSV file, map its columns to the tracker fields, and we will handle the rest.",
        loading: "Loading...",
        serviceUnavailableTitle: "Service is being prepared",
        serviceUnavailableText: "We are setting up the service. Please try again later.",
        backHome: "Back to Home",
        noOrgTitle: "No company selected",
        noOrgText: "Create your company from the dashboard first, then come back to this page.",
        goDashboard: "Go to the dashboard",
        backBtn: "Back to the dashboard",
        step1Title: "1. Choose the file",
        dropTitle: "Drag the file here or click to choose it",
        dropHint: "xlsx · xls · csv · tsv · json",
        chooseFile: "Choose a file",
        readingFile: "Reading the file...",
        readError: "The file could not be read. Make sure it is a valid Excel or CSV file.",
        libMissing: "The file reader library could not be loaded. Reload the page and try again.",
        unsupportedType: "Unsupported file type. Choose an xlsx, xls or csv file.",
        emptySheet: "This sheet contains no data.",
        fileLoaded: "File read: {name} ({rows} rows, {cols} columns).",
        step2Title: "2. Preview the data",
        sheetLabel: "Sheet",
        previewNote: "Showing the first {shown} of {total} rows.",
        columnN: "Column",
        step3Title: "3. Map the columns",
        mapTitle: "Title",
        mapDue: "Due date",
        mapCategory: "Category",
        mapAssignee: "Assignee email",
        mapStatus: "Status",
        sheetKind: "Sheet type",
        sheetKindGeneral: "General (dates and contracts)",
        sheetKindViolations: "Violations",
        graceDays: "Payment window (days)",
        mapVNumber: "Violation number",
        mapCaseNumber: "Case number",
        mapAmount: "Fine amount",
        mapClient: "Client company",
        mapLocation: "Location",
        violationTitle: "Violation no. {n}",
        required: "required",
        optional: "optional",
        notMapped: "— none —",
        mappingHint: "Unmapped columns are stored as extra data on each item.",
        statusHint: "In the status column, the values done, منجز or completed count as done; anything else stays open.",
        validRows: "Rows ready to import: {n}",
        skippedRows: "Rows that will be skipped (missing title or valid date): {n}",
        unmatchedAssignees: "Rows whose assignee email is not a team member: {n}",
        unmatchedHint: "These addresses were not found among the team members; their items will be imported without an assignee: {list}",
        step4Title: "4. Tracker",
        trackerLabel: "Add the items to",
        newTracker: "New tracker",
        trackerNamePlaceholder: "Name of the new tracker",
        trackerNameRequired: "Enter a name for the new tracker.",
        step5Title: "5. Plan check",
        importsThisMonth: "Imports this month",
        itemsUsage: "Items in use",
        rowsToImport: "Rows to import",
        unlimited: "Unlimited",
        ofLimit: "{used} of {limit}",
        checkingPlan: "Checking your plan...",
        planOk: "Your current plan allows this import.",
        planImportsExceeded: "You have reached the import limit for this month ({used} of {limit}). Upgrade your plan to continue.",
        planItemsExceeded: "The number of valid rows ({rows}) exceeds the items remaining in your plan ({remaining} remaining of {limit}). Upgrade your plan or reduce the rows.",
        upgradePlan: "Upgrade plan",
        importBtn: "Start import",
        mappingRequired: "Choose the title column and the due date column first.",
        mappingRequiredDue: "Choose the due date column first.",
        noValidRows: "There are no valid rows to import. Check the column mapping.",
        progressCreatingTracker: "Creating the tracker...",
        progressImport: "Registering the import...",
        progressInserting: "Inserting items: {done} of {total}",
        progressRule: "Creating the default reminder rule...",
        importFailed: "Import failed: {error}",
        importPartial: "The import stopped after inserting {done} items.",
        planLimitItems: "You have reached the item limit of your current plan. Upgrade to add more.",
        summaryTitle: "Import complete",
        summaryInserted: "Items inserted",
        summarySkipped: "Rows skipped",
        summaryUnmatched: "Rows with unmatched assignee",
        summaryTracker: "The items were added to the tracker: {name}",
        summaryRuleNote: "A default reminder rule was created: an email reminder one day before the due date.",
        summaryRuleFailed: "The default reminder rule could not be created; you can add it later from the reminders page.",
        importAnother: "Import another file",
        genericError: "Something went wrong. Please try again.",
        copyrightLine2: "All rights reserved",
        aboutLink: "About Us",
        termsLink: "Terms of Use",
        pricingLink: "Plans & Pricing",
        privacyLink: "Privacy Policy",
        loginLink: "Sign in",
        dashboardLink: "Dashboard",
        contactLink: "Contact Us",
        language: "Language",
        appearance: "Appearance",
        light: "Light",
        dark: "Dark"
      },
      fr: {
        templateBtn: "Télécharger le modèle",
        title: "Importer depuis Excel",
        subtitle: "Téléversez un fichier Excel ou CSV, associez ses colonnes aux champs du suivi, et nous nous occupons du reste.",
        loading: "Chargement...",
        serviceUnavailableTitle: "Service en cours de préparation",
        serviceUnavailableText: "Nous préparons le service. Veuillez réessayer plus tard.",
        backHome: "Retour à l'accueil",
        noOrgTitle: "Aucune entreprise sélectionnée",
        noOrgText: "Créez d'abord votre entreprise depuis le tableau de bord, puis revenez sur cette page.",
        goDashboard: "Aller au tableau de bord",
        backBtn: "Retour au tableau de bord",
        step1Title: "1. Choisir le fichier",
        dropTitle: "Glissez le fichier ici ou cliquez pour le choisir",
        dropHint: "xlsx · xls · csv · tsv · json",
        chooseFile: "Choisir un fichier",
        readingFile: "Lecture du fichier...",
        readError: "Impossible de lire le fichier. Vérifiez qu'il s'agit d'un fichier Excel ou CSV valide.",
        libMissing: "La bibliothèque de lecture des fichiers n'a pas pu être chargée. Rechargez la page et réessayez.",
        unsupportedType: "Type de fichier non pris en charge. Choisissez un fichier xlsx, xls ou csv.",
        emptySheet: "Cette feuille ne contient aucune donnée.",
        fileLoaded: "Fichier lu : {name} ({rows} lignes, {cols} colonnes).",
        step2Title: "2. Aperçu des données",
        sheetLabel: "Feuille",
        previewNote: "Affichage des {shown} premières lignes sur {total}.",
        columnN: "Colonne",
        step3Title: "3. Associer les colonnes",
        mapTitle: "Titre",
        mapDue: "Date d'échéance",
        mapCategory: "Catégorie",
        mapAssignee: "E-mail du responsable",
        mapStatus: "Statut",
        sheetKind: "Type de feuille",
        sheetKindGeneral: "Général (échéances et contrats)",
        sheetKindViolations: "Infractions",
        graceDays: "Délai de paiement (jours)",
        mapVNumber: "Numéro d'infraction",
        mapCaseNumber: "Numéro de dossier",
        mapAmount: "Montant de l'amende",
        mapClient: "Entreprise cliente",
        mapLocation: "Lieu",
        violationTitle: "Infraction n° {n}",
        required: "obligatoire",
        optional: "facultatif",
        notMapped: "— aucune —",
        mappingHint: "Les colonnes non associées sont enregistrées comme données supplémentaires sur chaque élément.",
        statusHint: "Dans la colonne statut, les valeurs done, منجز ou completed comptent comme terminées ; tout le reste reste ouvert.",
        validRows: "Lignes prêtes à importer : {n}",
        skippedRows: "Lignes ignorées (titre ou date valide manquant) : {n}",
        unmatchedAssignees: "Lignes dont l'e-mail du responsable n'appartient pas à l'équipe : {n}",
        unmatchedHint: "Ces adresses n'ont pas été trouvées parmi les membres de l'équipe ; leurs éléments seront importés sans responsable : {list}",
        step4Title: "4. Suivi",
        trackerLabel: "Ajouter les éléments à",
        newTracker: "Nouveau suivi",
        trackerNamePlaceholder: "Nom du nouveau suivi",
        trackerNameRequired: "Saisissez un nom pour le nouveau suivi.",
        step5Title: "5. Vérification du forfait",
        importsThisMonth: "Importations ce mois-ci",
        itemsUsage: "Éléments utilisés",
        rowsToImport: "Lignes à importer",
        unlimited: "Illimité",
        ofLimit: "{used} sur {limit}",
        checkingPlan: "Vérification de votre forfait...",
        planOk: "Votre forfait actuel autorise cette importation.",
        planImportsExceeded: "Vous avez atteint la limite d'importations de ce mois ({used} sur {limit}). Passez à un forfait supérieur pour continuer.",
        planItemsExceeded: "Le nombre de lignes valides ({rows}) dépasse les éléments restants de votre forfait ({remaining} restants sur {limit}). Passez à un forfait supérieur ou réduisez le nombre de lignes.",
        upgradePlan: "Changer de forfait",
        importBtn: "Lancer l'importation",
        mappingRequired: "Choisissez d'abord la colonne du titre et celle de la date d'échéance.",
        mappingRequiredDue: "Choisissez d'abord la colonne de la date d'échéance.",
        noValidRows: "Aucune ligne valide à importer. Vérifiez l'association des colonnes.",
        progressCreatingTracker: "Création du suivi...",
        progressImport: "Enregistrement de l'importation...",
        progressInserting: "Insertion des éléments : {done} sur {total}",
        progressRule: "Création de la règle de rappel par défaut...",
        importFailed: "Échec de l'importation : {error}",
        importPartial: "L'importation s'est arrêtée après l'insertion de {done} éléments.",
        planLimitItems: "Vous avez atteint la limite d'éléments de votre forfait actuel. Passez à un forfait supérieur pour en ajouter.",
        summaryTitle: "Importation terminée",
        summaryInserted: "Éléments insérés",
        summarySkipped: "Lignes ignorées",
        summaryUnmatched: "Lignes avec responsable non reconnu",
        summaryTracker: "Les éléments ont été ajoutés au suivi : {name}",
        summaryRuleNote: "Une règle de rappel par défaut a été créée : un rappel par e-mail un jour avant l'échéance.",
        summaryRuleFailed: "La règle de rappel par défaut n'a pas pu être créée ; vous pourrez l'ajouter plus tard depuis la page des rappels.",
        importAnother: "Importer un autre fichier",
        genericError: "Une erreur est survenue. Veuillez réessayer.",
        copyrightLine2: "Tous droits réservés",
        aboutLink: "À propos",
        termsLink: "Conditions d'utilisation",
        pricingLink: "Forfaits et tarifs",
        privacyLink: "Politique de confidentialité",
        loginLink: "Connexion",
        dashboardLink: "Tableau de bord",
        contactLink: "Contactez-nous",
        language: "Langue",
        appearance: "Apparence",
        light: "Clair",
        dark: "Sombre"
      },
      ur: {
        templateBtn: "ٹیمپلیٹ ڈاؤن لوڈ",
        title: "Excel سے درآمد",
        subtitle: "Excel یا CSV فائل اپ لوڈ کریں، اس کے کالمز کو ٹریکر کے خانوں سے جوڑیں، باقی ہم سنبھال لیں گے۔",
        loading: "لوڈ ہو رہا ہے...",
        serviceUnavailableTitle: "سروس تیار کی جا رہی ہے",
        serviceUnavailableText: "ہم سروس تیار کر رہے ہیں، براہ کرم بعد میں دوبارہ کوشش کریں۔",
        backHome: "واپس ہوم",
        noOrgTitle: "کوئی کمپنی منتخب نہیں",
        noOrgText: "پہلے ڈیش بورڈ سے اپنی کمپنی بنائیں، پھر اس صفحے پر واپس آئیں۔",
        goDashboard: "ڈیش بورڈ پر جائیں",
        backBtn: "ڈیش بورڈ پر واپس",
        step1Title: "1. فائل منتخب کریں",
        dropTitle: "فائل یہاں گھسیٹیں یا منتخب کرنے کے لیے کلک کریں",
        dropHint: "xlsx · xls · csv · tsv · json",
        chooseFile: "فائل منتخب کریں",
        readingFile: "فائل پڑھی جا رہی ہے...",
        readError: "فائل نہیں پڑھی جا سکی۔ یقینی بنائیں کہ یہ درست Excel یا CSV فائل ہے۔",
        libMissing: "فائل پڑھنے والی لائبریری لوڈ نہیں ہو سکی۔ صفحہ دوبارہ لوڈ کریں اور دوبارہ کوشش کریں۔",
        unsupportedType: "فائل کی قسم معاون نہیں۔ xlsx، xls یا csv فائل منتخب کریں۔",
        emptySheet: "اس شیٹ میں کوئی ڈیٹا نہیں ہے۔",
        fileLoaded: "فائل پڑھ لی گئی: {name} ({rows} قطاریں، {cols} کالم)۔",
        step2Title: "2. ڈیٹا کا جائزہ",
        sheetLabel: "شیٹ",
        previewNote: "کل {total} میں سے پہلی {shown} قطاریں دکھائی جا رہی ہیں۔",
        columnN: "کالم",
        step3Title: "3. کالمز کو جوڑیں",
        mapTitle: "عنوان",
        mapDue: "مقررہ تاریخ",
        mapCategory: "زمرہ",
        mapAssignee: "ذمہ دار کا ای میل",
        mapStatus: "حالت",
        sheetKind: "شیٹ کی قسم",
        sheetKindGeneral: "عام (تاریخیں اور معاہدے)",
        sheetKindViolations: "خلاف ورزیاں",
        graceDays: "ادائیگی کی مہلت (دن)",
        mapVNumber: "خلاف ورزی نمبر",
        mapCaseNumber: "مقدمہ نمبر",
        mapAmount: "جرمانے کی رقم",
        mapClient: "کلائنٹ کمپنی",
        mapLocation: "مقام",
        violationTitle: "خلاف ورزی نمبر {n}",
        required: "لازمی",
        optional: "اختیاری",
        notMapped: "— کوئی نہیں —",
        mappingHint: "غیر منسلک کالمز ہر آئٹم کے ساتھ اضافی ڈیٹا کے طور پر محفوظ ہوتے ہیں۔",
        statusHint: "حالت کے کالم میں done، منجز یا completed کی قدریں مکمل شمار ہوتی ہیں؛ باقی سب کھلی رہتی ہیں۔",
        validRows: "درآمد کے لیے تیار قطاریں: {n}",
        skippedRows: "نظر انداز ہونے والی قطاریں (عنوان یا درست تاریخ نہیں): {n}",
        unmatchedAssignees: "ایسی قطاریں جن کے ذمہ دار کا ای میل ٹیم میں نہیں: {n}",
        unmatchedHint: "یہ ای میل پتے ٹیم کے اراکین میں نہیں ملے؛ ان کے آئٹمز بغیر ذمہ دار کے درآمد ہوں گے: {list}",
        step4Title: "4. ٹریکر",
        trackerLabel: "آئٹمز شامل کریں",
        newTracker: "نیا ٹریکر",
        trackerNamePlaceholder: "نئے ٹریکر کا نام",
        trackerNameRequired: "نئے ٹریکر کا نام درج کریں۔",
        step5Title: "5. پلان کی جانچ",
        importsThisMonth: "اس ماہ کی درآمدات",
        itemsUsage: "استعمال شدہ آئٹمز",
        rowsToImport: "درآمد ہونے والی قطاریں",
        unlimited: "لامحدود",
        ofLimit: "{limit} میں سے {used}",
        checkingPlan: "آپ کے پلان کی جانچ ہو رہی ہے...",
        planOk: "آپ کا موجودہ پلان اس درآمد کی اجازت دیتا ہے۔",
        planImportsExceeded: "آپ اس ماہ کی درآمدات کی حد تک پہنچ چکے ہیں ({limit} میں سے {used})۔ جاری رکھنے کے لیے پلان اپ گریڈ کریں۔",
        planItemsExceeded: "درست قطاروں کی تعداد ({rows}) آپ کے پلان میں باقی آئٹمز سے زیادہ ہے ({limit} میں سے {remaining} باقی)۔ پلان اپ گریڈ کریں یا قطاریں کم کریں۔",
        upgradePlan: "پلان اپ گریڈ کریں",
        importBtn: "درآمد شروع کریں",
        mappingRequired: "پہلے عنوان اور مقررہ تاریخ کے کالم منتخب کریں۔",
        mappingRequiredDue: "پہلے مقررہ تاریخ کا کالم منتخب کریں۔",
        noValidRows: "درآمد کے لیے کوئی درست قطار نہیں۔ کالمز کی منسلکی چیک کریں۔",
        progressCreatingTracker: "ٹریکر بنایا جا رہا ہے...",
        progressImport: "درآمد رجسٹر کی جا رہی ہے...",
        progressInserting: "آئٹمز شامل کیے جا رہے ہیں: {total} میں سے {done}",
        progressRule: "ڈیفالٹ یاد دہانی کا اصول بنایا جا رہا ہے...",
        importFailed: "درآمد ناکام: {error}",
        importPartial: "{done} آئٹمز شامل کرنے کے بعد درآمد رک گئی۔",
        planLimitItems: "آپ اپنے موجودہ پلان میں آئٹمز کی حد تک پہنچ چکے ہیں، مزید شامل کرنے کے لیے پلان اپ گریڈ کریں۔",
        summaryTitle: "درآمد مکمل",
        summaryInserted: "شامل کردہ آئٹمز",
        summarySkipped: "نظر انداز قطاریں",
        summaryUnmatched: "غیر مطابق ذمہ دار والی قطاریں",
        summaryTracker: "آئٹمز اس ٹریکر میں شامل کیے گئے: {name}",
        summaryRuleNote: "ڈیفالٹ یاد دہانی کا اصول بن گیا: مقررہ تاریخ سے ایک دن پہلے ای میل یاد دہانی۔",
        summaryRuleFailed: "ڈیفالٹ یاد دہانی کا اصول نہیں بن سکا؛ آپ بعد میں یاد دہانیوں کے صفحے سے اسے شامل کر سکتے ہیں۔",
        importAnother: "ایک اور فائل درآمد کریں",
        genericError: "کچھ غلط ہو گیا، براہ کرم دوبارہ کوشش کریں۔",
        copyrightLine2: "جملہ حقوق محفوظ ہیں",
        aboutLink: "ہمارے بارے میں",
        termsLink: "استعمال کی شرائط",
        pricingLink: "پلانز اور قیمتیں",
        privacyLink: "رازداری کی پالیسی",
        loginLink: "سائن ان",
        dashboardLink: "ڈیش بورڈ",
        contactLink: "ہم سے رابطہ کریں",
        language: "زبان",
        appearance: "ظہور",
        light: "روشن",
        dark: "اندھیرا"
      }
    };

    const lang = () => localStorage.getItem("tracker_lang") || "ar";
    const theme = () => localStorage.getItem("tracker_theme") || "dark";
    const langNames = { ar: "العربية", en: "English", fr: "Français", ur: "اردو" };
    let l = lang();
    document.documentElement.lang = l;
    document.documentElement.dir = (l === "ar" || l === "ur") ? "rtl" : "ltr";

    function t(key) {
      const dict = translations[l] || translations.ar;
      return (dict && dict[key]) || translations.ar[key] || key;
    }
    function fmt(key, vars) {
      let s = t(key);
      Object.keys(vars || {}).forEach(k => { s = s.split("{" + k + "}").join(String(vars[k])); });
      return s;
    }

    const placeholderKeys = { trackerName: "trackerNamePlaceholder" };
    function applyPlaceholders(code) {
      const dict = translations[code] || translations.ar;
      Object.keys(placeholderKeys).forEach(id => {
        const el = document.getElementById(id);
        if (el && dict[placeholderKeys[id]]) el.placeholder = dict[placeholderKeys[id]];
      });
    }

    function applyStatic(code) {
      document.querySelectorAll("[data-i18n]").forEach(el => {
        const k = el.dataset.i18n;
        if (translations[code] && translations[code][k]) el.textContent = translations[code][k];
      });
    }

    function setLang(code) {
      localStorage.setItem("tracker_lang", code);
      l = code;
      document.documentElement.lang = code;
      document.documentElement.dir = (code === "ar" || code === "ur") ? "rtl" : "ltr";
      document.getElementById("currentLangDisplay").textContent = langNames[code] || code;
      ["ar","en","fr","ur"].forEach(c => {
        const el = document.getElementById("check-" + c);
        if (el) el.style.display = c === code ? "inline" : "none";
      });
      const th = theme();
      document.getElementById("currentThemeDisplay").textContent = translations[code][th === "dark" ? "dark" : "light"];
      applyStatic(code);
      applyPlaceholders(code);
      document.title = (translations[code] && translations[code].title ? translations[code].title : "Import") + " | TheTracker";
      if (typeof window.__importPageRefresh === "function") window.__importPageRefresh();
      if (typeof window.__trackerAuthRefresh === "function") window.__trackerAuthRefresh();
    }

    function setTheme(th) {
      localStorage.setItem("tracker_theme", th);
      document.documentElement.dataset.theme = th;
      const meta = document.getElementById("themeColorMeta");
      if (meta) meta.content = th === "dark" ? "#1a2933" : "#0068b8";
      const logo = document.getElementById("footerLogo");
      if (logo) logo.src = th === "dark" ? "/tracker-logo-full-dark.png?v=2" : "/tracker-logo-full-light.png?v=2";
      document.getElementById("themeIcon").textContent = th === "dark" ? "🌙" : "☀️";
      document.getElementById("currentThemeDisplay").textContent = translations[l][th === "dark" ? "dark" : "light"];
      document.getElementById("check-light").style.display = th === "light" ? "inline" : "none";
      document.getElementById("check-dark").style.display = th === "dark" ? "inline" : "none";
    }

    document.getElementById("langMenuBtn").addEventListener("click", e => {
      e.stopPropagation();
      document.getElementById("langDropdown").classList.toggle("show");
      document.getElementById("themeDropdown").classList.remove("show");
    });
    // زر المظهر يبدل الثيم مباشرة بضغطة واحدة بلا قائمة (طلب المهندس رعد)
    document.getElementById("themeMenuBtn").addEventListener("click", e => {
      e.stopPropagation();
      setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
      document.getElementById("langDropdown").classList.remove("show");
    });
    document.addEventListener("click", () => {
      document.getElementById("langDropdown").classList.remove("show");
      document.getElementById("themeDropdown").classList.remove("show");
    });

    document.querySelectorAll("#langDropdown .menu-dropdown-item").forEach(item => {
      item.addEventListener("click", () => setLang(item.dataset.lang));
    });
    document.querySelectorAll("#themeDropdown .menu-dropdown-item").forEach(item => {
      item.addEventListener("click", () => {
        setTheme(item.dataset.theme);
        document.getElementById("themeDropdown").classList.remove("show");
      });
    });

    applyStatic(l);
    applyPlaceholders(l);
    document.getElementById("currentLangDisplay").textContent = langNames[l] || l;
    ["ar","en","fr","ur"].forEach(c => {
      const el = document.getElementById("check-" + c);
      if (el) el.style.display = l === c ? "inline" : "none";
    });
    document.title = (translations[l] && translations[l].title ? translations[l].title : "Import") + " | TheTracker";

    (function() {
      const th = theme();
      document.documentElement.dataset.theme = th;
      const meta = document.getElementById("themeColorMeta");
      if (meta) meta.content = th === "dark" ? "#1a2933" : "#0068b8";
      const logo = document.getElementById("footerLogo");
      if (logo) logo.src = th === "dark" ? "/tracker-logo-full-dark.png?v=2" : "/tracker-logo-full-light.png?v=2";
      document.getElementById("themeIcon").textContent = th === "dark" ? "🌙" : "☀️";
      document.getElementById("currentThemeDisplay").textContent = translations[l][th === "dark" ? "dark" : "light"];
      document.getElementById("check-light").style.display = th === "light" ? "inline" : "none";
      document.getElementById("check-dark").style.display = th === "dark" ? "inline" : "none";
    })();
  