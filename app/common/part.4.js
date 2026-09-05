    var nav = document.createElement("nav");
    nav.id = "appSidebar";
    nav.className = "app-sidebar";
    nav.setAttribute("aria-label", sidebarLabel({ ar: "قائمة الخدمات", en: "Services menu", fr: "Menu des services", ur: "خدمات کا مینو" }));
    document.body.insertBefore(nav, document.body.firstChild);
    document.body.classList.add("has-app-sidebar");
    var backdrop = document.createElement("div");
    backdrop.className = "app-drawer-backdrop";
    backdrop.id = "appDrawerBackdrop";
    document.body.insertBefore(backdrop, nav.nextSibling);
    backdrop.addEventListener("click", function () { setDrawer(false); });
    nav.addEventListener("click", function (ev) {
      if (ev.target.closest("a") || ev.target.closest("[data-drawer-close]")) setDrawer(false);
    });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") setDrawer(false); });
    if (window.matchMedia) {
      var mq = window.matchMedia(MOBILE_SHELL);
      var onChange = function () { if (!mq.matches) setDrawer(false); };
      if (mq.addEventListener) mq.addEventListener("change", onChange); else if (mq.addListener) mq.addListener(onChange);
    }

    /* روابط الأعلى صارت مكررة مع القائمة الجانبية. */
    var quick = document.getElementById("quickLinks");
    if (quick) quick.hidden = true;

    var ready = app && app.ready && typeof app.ready.then === "function" ? app.ready : null;
    var paint = function () {
      if (isPlatformAdmin()) nav.dataset.admin = "1";
      sidebarReady = true;
      renderSidebar();
    };
    if (ready) ready.then(paint, paint);
    else paint();

    /* إعادة الرسم عند تغيير اللغة (setLang يغير lang/dir على <html>). */
    if (typeof MutationObserver !== "undefined") {
      new MutationObserver(function () { renderSidebar(); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ["lang", "dir"] });
    }
  }

  app.listTrackers = listTrackers;
  app.createTracker = createTracker;
  app.deleteTracker = deleteTracker;
  app.listItems = listItems;
  app.countItems = countItems;
  app.insertItems = insertItems;
  app.updateItem = updateItem;
  app.deleteItem = deleteItem;
  app.listImports = listImports;
  app.createImport = createImport;
  app.importsThisMonth = importsThisMonth;
  app.listMembers = listMembers;
  app.listInvitations = listInvitations;
  app.inviteMember = inviteMember;
  app.cancelInvitation = cancelInvitation;
  app.teamWorkItems = teamWorkItems;
  app.assignItem = assignItem;
  app.listTeamMessages = listTeamMessages;
  app.sendTeamMessage = sendTeamMessage;
  app.deleteTeamMessage = deleteTeamMessage;
  app.markChatRead = markChatRead;
  app.exportCsv = exportCsv;
  app.apiKeys = apiKeys;
  app.createApiKey = createApiKey;
  app.revokeApiKey = revokeApiKey;
  app.removeMember = removeMember;
  app.setMemberRole = setMemberRole;
  app.listRules = listRules;
  app.saveRule = saveRule;
  app.deleteRule = deleteRule;
  app.channelLinks = channelLinks;
  app.requestChannelCode = requestChannelCode;
  app.setSmsPhone = setSmsPhone;
  app.unlinkChannel = unlinkChannel;
  app.listItemRoles = listItemRoles;
  app.setItemRole = setItemRole;
  app.distributeItem = distributeItem;
  app.parseIntent = parseIntent;
  app.sendTeamFile = sendTeamFile;
  app.listChatFiles = listChatFiles;
  app.quickAddItem = quickAddItem;
  app.linkTelegramByToken = linkTelegramByToken;
  app.testChannel = testChannel;
  app.calendarToken = calendarToken;
  app.calendarUrl = calendarUrl;
  app.regenerateCalendarToken = regenerateCalendarToken;
  app.updateProfile = updateProfile;
  app.isPlatformAdmin = isPlatformAdmin;
  app.platformAdmins = platformAdmins;
  app.setPlatformAdmin = setPlatformAdmin;
  app.activityFeed = activityFeed;
  app.achievements = achievements;
  /* قاعدة الثبات: لا كتابة بمحتوى مطابق، والعنصر يظهر مع محتواه لا قبله */
  function paint(el, html) {
    var node = typeof el === "string" ? document.getElementById(el) : el;
    if (!node) return false;
    if (node.__sig === html) return false;
    node.__sig = html;
    node.innerHTML = html;
    if (node.hidden) node.hidden = false;
    return true;
  }

  /* اسم الطرف أو العميل: بالإنجليزية في الواجهتين الإنجليزية والفرنسية إن وجد */
  function clientDisplayName(row) {
    if (!row) return "";
    var wantEn = ["en", "fr"].indexOf(lang()) !== -1;
    return (wantEn ? (row.client_name_en || row.client_name) : (row.client_name || row.client_name_en)) || "";
  }

  app.clientDisplayName = clientDisplayName;
  app.orgDisplayName = orgDisplayName;
  app.paint = paint;
  app.exportXlsx = exportXlsx;
  app.setMemberPerson = setMemberPerson;
  app.departments = departments;
  app.openNewOrgDialog = openNewOrgDialog;
  app.registrationRule = registrationRule;
  app.departmentLabel = departmentLabel;
  app.serviceAllowed = serviceAllowed;
  app.entityTypes = function () { return ENTITY_TYPES.slice(); };
  app.entityLabel = entityLabel;
  app.isPersonType = isPersonType;
  app.orgProfile = orgProfile;
  app.saveOrgProfile = saveOrgProfile;
  app.orgDocumentsStatus = orgDocumentsStatus;
  app.listProcesses = listProcesses;
  app.saveProcess = saveProcess;
  app.deleteProcess = deleteProcess;
  app.listRisks = listRisks;
  app.saveRisk = saveRisk;
  app.deleteRisk = deleteRisk;
  app.caseBundle = caseBundle;
  app.listAttachments = listAttachments;
  app.uploadAttachment = uploadAttachment;
  app.addAttachmentLink = addAttachmentLink;
  app.driveAvailable = driveAvailable;
  app.driveOAuthAvailable = driveOAuthAvailable;
  app.translateTexts = translateTexts;
  app.translateNodes = translateNodes;
  app.storageMode = storageMode;
  app.connectDrive = driveAccessToken;
  /* مجلد درايف الخاص بالشركة الحالية: ينشأ إن لم يوجد، ويعاد معرفه ورابطه لعرضه في الإعدادات */
  app.driveFolder = function () {
    var orgId = requireOrg();
    var orgName = (app.org && app.org.name) || "";
    return driveAccessToken().then(function (token) { return driveFolderFor(token, orgId, orgName); })
      .then(function (id) { return { id: id, url: "https://drive.google.com/drive/folders/" + id, path: DRIVE_ROOT_NAME + "/" + (orgName || "Company") }; });
  };
  app.driveFolderCached = function () {
    try { var id = localStorage.getItem("tracker_drive_folder:" + requireOrg()); return id ? { id: id, url: "https://drive.google.com/drive/folders/" + id, path: DRIVE_ROOT_NAME + "/" + ((app.org && app.org.name) || "Company") } : null; } catch (e) { return null; }
  };
  app.readDocumentFile = readDocumentFile;
  app.pickFromDrive = pickFromDrive;
  app.driveDownload = driveDownload;
  app.attachDriveFiles = attachDriveFiles;
  app.attachmentUrl = attachmentUrl;
  app.deleteAttachment = deleteAttachment;
  app.storageUsed = storageUsed;
  app.renameOrg = renameOrg;
  app.deleteOrg = deleteOrg;
  app.findProfileForInvite = findProfileForInvite;
  app.requestPlan = requestPlan;
  app.planRequests = planRequests;
  app.cancelPlanRequest = cancelPlanRequest;
  app.adminPlanRequests = adminPlanRequests;
  app.adminDecideRequest = adminDecideRequest;
  app.adminListOrgs = adminListOrgs;
  app.adminActivate = adminActivate;
  app.adminContactMessages = adminContactMessages;
  app.adminTelegramMessages = adminTelegramMessages;
  app.lang = lang;
  app.t = t;
  app.fmtDate = fmtDate;
  app.fmtAmount = fmtAmount;
  app.parseExcelDate = parseExcelDate;
  app.toast = toast;
  app.escapeHtml = escapeHtml;
  app.randomCode = randomCode;
  app.unavailableMessage = unavailableMessage;

  /* ============================================================
   * الشريط العلوي للتطبيق — روابط الخدمات، واسم المستخدم، وجرس التنبيهات،
   * وزر خروج صغير. يظهر أسفل شريط الموقع في كل صفحات /app.
   * ============================================================ */

  /* الشريط العلوي للتنقل العام، والقائمة الجانبية للخدمات: لا يتكرر عنصر بينهما. */
  var TOPNAV = [
    { href: "/about.html", labels: { ar: "الدليل", en: "Guide", fr: "Guide", ur: "رہنما" } },
    { href: "/#contact", labels: { ar: "تواصل معنا", en: "Contact us", fr: "Nous contacter", ur: "رابطہ کریں" } }
  ];

  var BELL_LABELS = { ar: "التنبيهات", en: "Notifications", fr: "Notifications", ur: "اطلاعات" };
  var ORG_LABELS = { ar: "الحساب", en: "Account", fr: "Compte", ur: "اکاؤنٹ" };
  var NEW_ORG_LABELS = { ar: "＋ حساب جديد", en: "＋ New account", fr: "＋ Nouveau compte", ur: "＋ نیا اکاؤنٹ" };
  var BELL_DELETE = { ar: "حذف التنبيه", en: "Delete", fr: "Supprimer", ur: "حذف کریں" };
  var BELL_CLEAR = { ar: "حذف كل التنبيهات", en: "Clear all", fr: "Tout effacer", ur: "سب حذف کریں" };
  var BELL_EMPTY = { ar: "لا توجد تنبيهات بعد.", en: "No notifications yet.", fr: "Aucune notification pour le moment.", ur: "ابھی کوئی اطلاع نہیں۔" };
  var BELL_SEEN_KEY = "tracker_bell_seen";

  var TOPBAR_CSS = [
    ".app-topbar{position:fixed;inset-block-start:var(--site-header-h,61px);inset-inline:0;height:64px;box-sizing:border-box;z-index:45;display:flex;align-items:center;",
    "justify-content:space-between;gap:1.5rem;padding:0 1.75rem;background:var(--glass);-webkit-backdrop-filter:blur(20px);",
    ".app-topbar>*{max-height:40px}",
    "backdrop-filter:blur(20px);border-bottom:1px solid var(--glass-border);box-shadow:0 6px 18px rgba(0,0,0,.12)}",
    ".app-topnav{display:flex;align-items:center;gap:.4rem;overflow:visible;scrollbar-width:none;margin-inline-end:auto}",
    ".app-sidebar-toggle{flex:0 0 auto;margin-inline-end:-.9rem}",
    ".app-topnav::-webkit-scrollbar{display:none}",
    ".app-topnav>a,.app-topnav>button,.app-menu-wrap>button{position:relative;display:inline-flex;align-items:center;gap:.4rem;height:40px;box-sizing:border-box;padding:0 1rem;border:0;",
    ".app-topbar button{-webkit-appearance:none;appearance:none}",
    "border-radius:12px;background:transparent;color:var(--text-secondary);font:inherit;font-size:.92rem;font-weight:600;",
    "white-space:nowrap;text-decoration:none;cursor:pointer;transition:all .25s ease}",
    ".app-topnav>a:hover,.app-topnav>button:hover{background:var(--glass-border);color:var(--text-primary)}",
    ".app-topnav>a.is-active{color:var(--primary)}",
    ".app-topnav>a.is-active{background:var(--glass-border);color:var(--text-primary)}",
    ".app-topnav>a.is-active::after{content:'';position:absolute;inset-inline:1rem;bottom:-.65rem;height:3px;border-radius:3px;background:var(--primary)}",
    ".app-userbox{display:flex;align-items:center;gap:.75rem;flex:0 0 auto;max-height:40px}",
    ".app-orgbox{display:flex;align-items:center;gap:.55rem;height:40px;box-sizing:border-box;padding:0 .55rem 0 .9rem;border-radius:14px;",
    "background:var(--glass);border:1px solid var(--glass-border);color:var(--text-primary)}",
    ".app-orgbox:hover{border-color:var(--primary)}",
    ".app-orglabel{font-size:.72rem;font-weight:700;color:var(--text-secondary);letter-spacing:.02em}",
    /* لا سهم على أي قائمة: كان يرسم فوق النص ويتداخل معه (أمر المهندس رعد) */
    ".app-orgselect{max-width:190px;padding:.3rem .5rem;border:0;border-radius:10px;background:transparent;background-image:none;",
    "color:var(--text-primary);font:inherit;font-size:.88rem;font-weight:700;cursor:pointer;-webkit-appearance:none;appearance:none;",
    "text-overflow:clip}",
    ".app-orgselect option{color:#12212b;background:#fff}",
    "body select,body .waitlist-input select,body select.waitlist-input{-webkit-appearance:none;appearance:none;background-image:none}",
    "body select::-ms-expand{display:none}",
    /* اسم المستخدم رابط إلى ملفه الشخصي في الإعدادات (طلب المهندس رعد) */
    ".app-username{display:inline-flex;align-items:center;gap:.5rem;max-width:240px;height:40px;box-sizing:border-box;padding:0 1rem;border-radius:14px;",
    "background:var(--glass-border);color:var(--text-primary);font-size:.85rem;font-weight:700;white-space:nowrap;overflow-x:auto;scrollbar-width:none;text-overflow:clip;text-decoration:none;cursor:pointer}",
    /* لا قص بثلاث نقاط في أي مكان (قاعدة المهندس رعد): الاسم الطويل يتمرر أفقيا ويبقى كاملا */
    ".app-username::-webkit-scrollbar{display:none}",
    ".app-username:hover{background:var(--primary);color:var(--btn-ink,#fff)}",
    ".app-iconbtn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;box-sizing:border-box;padding:0;border:1px solid var(--glass-border);",
    "[dir=rtl] #topSignOut svg{transform:scaleX(-1)}",
    "border-radius:12px;background:transparent;color:var(--text-secondary);cursor:pointer;transition:all .25s ease}",
    ".app-iconbtn:hover{background:var(--glass-border);color:var(--text-primary)}",
    ".app-iconbtn svg{width:19px;height:19px;fill:currentColor}",
    "html[dir=\"rtl\"] #topSignOut svg{transform:scaleX(-1)}",
    ".app-bell-badge{position:absolute;inset-block-start:-6px;inset-inline-end:-6px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;",
    "background:#e5484d;color:#fff;font-size:.68rem;font-weight:700;display:flex;align-items:center;justify-content:center}",
    ".app-bell-panel{position:absolute;inset-block-start:46px;inset-inline-end:0;width:300px;max-height:60vh;overflow-y:auto;padding:.5rem;",
    "border-radius:16px;background:var(--bg-mid,#1a2933);",
    "border:1px solid var(--glass-border);box-shadow:0 18px 40px var(--shadow-dark);display:none;z-index:60}",
    ".app-bell-panel.is-open{display:block}",
    ".app-bell-item{padding:.65rem .75rem;border-radius:12px;font-size:.82rem;color:var(--text-secondary);margin-bottom:.25rem}",
    ".app-bell-item.is-unread{background:var(--glass-border)}",
    ".app-bell-item.is-link{cursor:pointer}",
    ".app-bell-item.is-link:hover{background:var(--glass-border)}",
    ".app-bell-num{display:block;font-size:.72rem;opacity:.75;margin-bottom:.15rem}",
    ".app-bell-item{position:relative;padding-inline-end:1.9rem}",
    ".app-bell-del{position:absolute;inset-inline-end:.35rem;inset-block-start:.45rem;width:22px;height:22px;padding:0;",
    "border:0;border-radius:8px;background:transparent;color:var(--text-secondary);font-size:.8rem;line-height:1;cursor:pointer}",
    ".app-bell-del:hover{background:var(--glass-border);color:var(--text-primary)}",
    ".app-bell-clear{display:block;width:100%;margin-top:.35rem;padding:.5rem;border:0;border-radius:10px;",
    "background:transparent;color:var(--text-secondary);font:inherit;font-size:.8rem;font-weight:700;cursor:pointer}",
    ".app-bell-clear:hover{background:var(--glass-border);color:var(--text-primary)}",
    ".app-bell-item strong{display:block;color:var(--text-primary);font-size:.9rem;margin-bottom:.15rem}",
    ".app-bell-empty{padding:.9rem .7rem;font-size:.85rem;color:var(--text-secondary);text-align:center}",
    ".app-menu-wrap{position:relative;display:inline-flex}",
    ".app-menu-panel{position:absolute;inset-block-start:46px;inset-inline-start:0;width:220px;padding:.4rem;border-radius:16px;background:var(--bg-mid,#1a2933);",
    "border:1px solid var(--glass-border);",
    "box-shadow:0 18px 40px var(--shadow-dark);display:none;z-index:60}",
    ".app-menu-panel.is-open{display:block}",
    ".app-menu-panel a{display:block;padding:.6rem .75rem;border-radius:10px;color:var(--text-secondary);font-size:.9rem;font-weight:600;text-decoration:none}",
    ".app-menu-panel a:hover{background:var(--glass-border);color:var(--text-primary)}",
    "body.has-app-topbar{padding-top:calc(var(--site-header-h,61px) + 64px)}",
    "body.has-app-topbar .container>.header{display:none}",   /* العناوين الكبيرة (لوحة التحكم/القضايا…) لا داعي لها: الموقع واضح من الشريطين */
    "body.has-app-topbar .container{padding-top:2rem}",
    "body.has-app-topbar .app-sidebar{inset-block-start:calc(var(--site-header-h,61px) + 64px)}",
    /* ــ الجوال (≤900px): صف واحد ثابت 56px: ☰ ثم بطاقة الشركة تملأ الوسط ثم الجرس والخروج؛ الروابط والاسم في الدرج ــ */
    "@media(max-width:900px){.app-topbar{height:56px;padding:0 .75rem;gap:.5rem}",
    ".app-topnav,.app-username{display:none}",
    /* أساس المرونة صفر: حجم البطاقة من المساحة المتاحة لا من طول اسم الشركة، فلا يفيض الصف */
    ".app-userbox{flex:1 1 0%;min-width:0;max-width:100%;gap:.5rem}",
    ".app-orgbox{flex:1 1 0%;min-width:0;max-width:100%;padding:0 .5rem}",
    ".app-orglabel{display:none}",
    /* 16 بكسل على الجوال: iOS يكبّر الصفحة تلقائيا عند لمس أي حقل خطه أصغر */
    ".app-orgselect{flex:1 1 0%;width:0;min-width:0;max-width:100%;font-size:16px}",
    ".app-sidebar-toggle{margin-inline-end:0}",
    "body.has-app-topbar{padding-top:calc(var(--site-header-h,61px) + 56px)}",
    "body.has-app-topbar .container{padding-top:1rem}",
    ".app-bell-panel,.app-menu-panel{position:fixed;inset-block-start:calc(var(--site-header-h,61px) + 60px);inset-inline:.75rem;width:auto;max-height:70vh}}"
  ].join("");

  /* الاسم بلغة الواجهة: الإنجليزي حين تكون اللغة en/fr وهو موجود، وإلا العربي —
     كلاهما يكتبه المستخدم بنفسه في الإعدادات، لا اشتقاق آلي بينهما. */
  function userDisplayName() {
    var p = app.profile || {};
    var u = app.user || {};
    var meta = (u.user_metadata || {});
    var preferEnglish = lang() === "en" || lang() === "fr";
    if (preferEnglish && p.full_name_en) return p.full_name_en;
    return p.full_name || p.full_name_en || meta.full_name || meta.name || u.email || "";
  }

  function bellSeenAt() {
    try { return localStorage.getItem(BELL_SEEN_KEY) || ""; } catch (e) { return ""; }
  }

  function myNotifications() {
    return run(function (client) {
      return client.from("notifications")
        .select("id,status,channel,scheduled_at,sent_at,created_at,read_at,payload")
        .eq("user_id", app.user.id)
        .eq("channel", "inapp")
        .order("created_at", { ascending: false })
        .limit(12)
        .then(unwrap);
    });
  }

  function deleteNotification(id) {
    return run(function (client) {
      return client.from("notifications").delete().eq("id", id).eq("user_id", app.user.id).then(unwrap);
    });
  }

  function clearNotifications() {
    return run(function (client) {
      return client.from("notifications").delete().eq("user_id", app.user.id).eq("channel", "inapp").then(unwrap);
    });
  }

  /* تصدير CSV: BOM ليفتحه إكسل بالعربية، وكل خلية محاطة بعلامتي اقتباس */
  function exportCsv(filename, rows, columns) {
    var cols = columns || Object.keys((rows && rows[0]) || {});
    var q = function (v) {
      if (v === null || v === undefined) v = "";
      else if (typeof v === "object") v = JSON.stringify(v);
      return '"' + String(v).replace(/"/g, '""') + '"';
    };
    var lines = [cols.map(function (c) { return q(c.label || c); }).join(",")];
    (rows || []).forEach(function (r) {
      lines.push(cols.map(function (c) { return q(typeof c === "object" ? (typeof c.get === "function" ? c.get(r) : r[c.key]) : r[c]); }).join(","));
    });
    var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename || "export.csv";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- التصدير إلى إكسل: ملف xlsx حقيقي بالعربية بلا تشويه ---------- */
  var XLSX_SRC = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  var xlsxPromise = null;

  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise(function (resolve, reject) {
      var el = document.createElement("script");
      el.src = XLSX_SRC;
      el.onload = function () { window.XLSX ? resolve(window.XLSX) : reject(new Error("xlsx_missing")); };
      el.onerror = function () { xlsxPromise = null; reject(new Error("xlsx_load_failed")); };
      document.head.appendChild(el);
    });
    return xlsxPromise;
  }

  function cellValue(row, col) {
    var value = (typeof col === "object")
      ? (typeof col.get === "function" ? col.get(row) : row[col.key])
      : row[col];
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return value;
  }

  /* نفس توقيع exportCsv تماما: (اسم الملف، الصفوف، الأعمدة) */
  function exportXlsx(filename, rows, columns, sheetName) {
    var cols = columns || Object.keys((rows && rows[0]) || {});
    return loadXlsx().then(function (XLSX) {
      var header = cols.map(function (col) { return String(col.label || col); });
      var body = (rows || []).map(function (row) {
        return cols.map(function (col) {
          var value = cellValue(row, col);
          var numericOrValue = (typeof value === "string" && value.trim() !== "" && isFinite(Number(value))) ? Number(value) : value;
          return numericOrValue;
        });
      });
      var worksheet = XLSX.utils.aoa_to_sheet([header].concat(body));
      /* عرض العمود يتبع أطول قيمة فيه حتى يقرأ الجدول بلا توسيع يدوي */
      worksheet["!cols"] = header.map(function (label, columnIndex) {
        var longest = label.length;
        body.forEach(function (row) { var len = String(row[columnIndex] == null ? "" : row[columnIndex]).length; if (len > longest) longest = len; });
        return { wch: Math.min(60, Math.max(10, longest + 2)) };
      });
      var name = String(sheetName || "").slice(0, 28) || "Sheet1";
      var workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, name);
      XLSX.writeFile(workbook, filename || "export.xlsx");
      return true;
    });
  }

  function apiKeys() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("api_keys").select("id,name,prefix,created_at,last_used_at,revoked_at")
        .eq("org_id", orgId).is("revoked_at", null).order("created_at", { ascending: false }).then(unwrap);
    });
  }
  function createApiKey(name) {
    return run(function (client) {
      var orgId = requireOrg();
      return client.rpc("api_key_create", { p_org: orgId, p_name: String(name || "").trim() }).then(unwrap);
    });
  }
  function revokeApiKey(id) {
    return run(function (client) { return client.rpc("api_key_revoke", { p_id: id }).then(unwrap); });
  }

  function markChatRead(peerId) {
    return run(function (client) {
      return client.rpc("mark_chat_read", { peer: peerId || null }).then(unwrap);
    });
  }

  function markNotificationsRead() {
    return run(function (client) {
      return client.rpc("mark_notifications_read").then(unwrap);
    });
  }

  /* أين أنا الآن؟ اسم الشركة الحالية ظاهر دائما ويبدل من مكانه. */
  var REG_TEXT = {
    ar: { readExpiryAssumed: "تاريخ متابعة مفترض", expiryAssumed: "مفترض: سنة من تاريخ الإصدار، عدله إن كان لديك تاريخ آخر", expiryHint: "1447/05/10 هجري أو 2026-12-01 ميلادي", expiryReads: "يفهمه النظام:", expiryBad: "لم أفهم التاريخ — اكتبه هكذا 1447/05/10 أو 2026-12-01.", expiryNone: "اتركه فارغا إن كان المستند بلا تاريخ انتهاء (السجل التجاري الجديد لا ينتهي).", fileFirst: "ارفع المستند الرسمي (سجل تجاري أو وثيقة عمل حر أو هوية) ليقرأ منه كل شيء", reading: "جاري قراءة المستند…", readDone: "قرئ المستند وعبئ منه:", readNothing: "قرئ المستند ولم تستخرج بيانات، أكمل الحقول.", readFailed: "تعذرت قراءة المستند، أكمل الحقول يدويا.", readName: "الاسم", readNumber: "الرقم", readExpiry: "تاريخ الانتهاء", commercial_register: "رقم السجل التجاري", id_document: "رقم الهوية الوطنية", license: "رقم الرخصة / الوثيقة", expiry: "تاريخ انتهاء المستند (إن وجد)", file: "ملف المستند (PDF أو صورة، اختياري)",
          gate: "لا تنشأ الجهة بلا مستندها الرسمي: الرقم وتاريخ الانتهاء إلزاميان، ويسجل أول مستند في ملفها.", invalid: "الرقم غير صحيح.", expiryRequired: "تاريخ الانتهاء إلزامي.", fileFailed: "أنشئت الجهة لكن تعذر رفع الملف؛ أضفه من صفحة المستندات." },
    en: { readExpiryAssumed: "assumed follow-up date", expiryAssumed: "assumed: one year from the issue date — change it if you know the real one", expiryHint: "1447/05/10 Hijri or 2026-12-01", expiryReads: "Understood as:", expiryBad: "Date not understood — write 1447/05/10 or 2026-12-01.", expiryNone: "Leave empty if the document has no expiry (the new commercial register never expires).", fileFirst: "Upload the official document (commercial register, freelance permit or ID) and it fills the fields", reading: "Reading the document…", readDone: "Read and filled in:", readNothing: "The document was read but nothing was extracted; fill the fields.", readFailed: "Could not read the document; fill the fields manually.", readName: "name", readNumber: "number", readExpiry: "expiry date", commercial_register: "Commercial register number", id_document: "National ID number", license: "License / permit number", expiry: "Document expiry date (if any)", file: "Document file (PDF or image, optional)",
          gate: "No entity without its official document: number and expiry are required, and it becomes the first paper on file.", invalid: "Invalid number.", expiryRequired: "Expiry date is required.", fileFailed: "Created, but the file could not be uploaded; add it from Documents." },
    fr: { readExpiryAssumed: "date de suivi supposée", expiryAssumed: "supposée : un an après l’émission — modifiez-la si vous connaissez la vraie", expiryHint: "1447/05/10 hégirien ou 2026-12-01", expiryReads: "Compris comme :", expiryBad: "Date non comprise — écrivez 1447/05/10 ou 2026-12-01.", expiryNone: "Laissez vide si le document n’expire pas (le nouveau registre de commerce n’expire jamais).", fileFirst: "Téléversez le document officiel (registre de commerce, permis d’indépendant ou pièce d’identité) : il remplit les champs", reading: "Lecture du document…", readDone: "Lu et rempli :", readNothing: "Document lu, rien n’a été extrait ; complétez les champs.", readFailed: "Lecture impossible ; complétez les champs à la main.", readName: "nom", readNumber: "numéro", readExpiry: "date d’expiration", commercial_register: "Numéro du registre de commerce", id_document: "Numéro de carte d’identité", license: "Numéro de licence / permis", expiry: "Date d’expiration du document (le cas échéant)", file: "Fichier du document (PDF ou image, facultatif)",
          gate: "Aucune entité sans son document officiel : numéro et date d’expiration obligatoires ; il devient la première pièce du dossier.", invalid: "Numéro invalide.", expiryRequired: "Date d’expiration obligatoire.", fileFailed: "Créée, mais le fichier n’a pu être envoyé ; ajoutez-le depuis Documents." },
    ur: { readExpiryAssumed: "فرضی تاریخ", expiryAssumed: "فرضی: اجرا سے ایک سال — اصل معلوم ہو تو بدل دیں", expiryHint: "1447/05/10 ہجری یا 2026-12-01", expiryReads: "سسٹم نے سمجھا:", expiryBad: "تاریخ سمجھ نہیں آئی — 1447/05/10 یا 2026-12-01 لکھیں۔", expiryNone: "اگر دستاویز کی میعاد نہیں تو خالی چھوڑیں (نیا کمرشل رجسٹر ختم نہیں ہوتا)۔", fileFirst: "سرکاری دستاویز اپ لوڈ کریں (کمرشل رجسٹر، فری لانس اجازت نامہ یا شناخت) — خانے خود بھر جائیں گے", reading: "دستاویز پڑھی جا رہی ہے…", readDone: "پڑھ کر بھر دیا:", readNothing: "دستاویز پڑھی گئی مگر کچھ نہ ملا؛ خانے بھریں۔", readFailed: "دستاویز نہیں پڑھی جا سکی؛ خانے خود بھریں۔", readName: "نام", readNumber: "نمبر", readExpiry: "میعاد", commercial_register: "کمرشل رجسٹر نمبر", id_document: "قومی شناختی نمبر", license: "لائسنس / اجازت نامہ نمبر", expiry: "دستاویز کی میعاد (اگر ہو)", file: "دستاویز کی فائل (PDF یا تصویر، اختیاری)",
          gate: "سرکاری دستاویز کے بغیر کوئی ادارہ نہیں: نمبر اور میعاد لازمی ہیں، اور یہ فائل کی پہلی دستاویز بنتی ہے۔", invalid: "نمبر غلط ہے۔", expiryRequired: "میعاد ختم ہونے کی تاریخ لازمی ہے۔", fileFailed: "بن گیا، مگر فائل اپ لوڈ نہ ہو سکی؛ دستاویزات سے شامل کریں۔" }
  };

  var NEW_ORG_TEXT = {
    ar: { title: "حساب جديد", hint: "اختر نوع الحساب ثم اكتب الاسم.", type: "نوع الحساب", name: "اسم الجهة بالعربية", nameEn: "اسم الجهة بالإنجليزية", nameSelf: "اسمك الكامل", nameSelfEn: "اسمك بالإنجليزية", oneName: "اكتب الاسم بالعربية أو بالإنجليزية، أحدهما يكفي.", save: "إنشاء", cancel: "إلغاء", error: "تعذر الإنشاء، حاول مرة أخرى." },
    en: { title: "New account", hint: "Choose the account type, then enter the name.", type: "Account type", name: "Entity name in Arabic", nameEn: "Entity name in English", nameSelf: "Your full name", nameSelfEn: "Your name in English", oneName: "Enter the name in Arabic or English; either one is enough.", save: "Create", cancel: "Cancel", error: "Could not create it, try again." },
    fr: { title: "Nouveau compte", hint: "Choisissez le type de compte, puis saisissez le nom.", type: "Type de compte", name: "Nom de l'entité en arabe", nameEn: "Nom de l'entité en anglais", nameSelf: "Votre nom complet", nameSelfEn: "Votre nom en anglais", oneName: "Saisissez le nom en arabe ou en anglais ; l'un suffit.", save: "Créer", cancel: "Annuler", error: "Création impossible, réessayez." },
    ur: { title: "نیا اکاؤنٹ", hint: "اکاؤنٹ کی قسم منتخب کریں پھر نام لکھیں۔", type: "اکاؤنٹ کی قسم", name: "ادارے کا نام عربی میں", nameEn: "ادارے کا نام انگریزی میں", nameSelf: "آپ کا پورا نام", nameSelfEn: "آپ کا نام انگریزی میں", oneName: "نام عربی یا انگریزی میں لکھیں؛ ایک کافی ہے۔", save: "بنائیں", cancel: "منسوخ", error: "نہیں بن سکا، دوبارہ کوشش کریں۔" }
  };

  /* إضافة شركة من الشريط العلوي مباشرة */
  function openNewOrgDialog() {
    if (document.getElementById("appNewOrg")) return;
    var t = NEW_ORG_TEXT[lang()] || NEW_ORG_TEXT.ar;
    var rt = REG_TEXT[lang()] || REG_TEXT.ar;
    var style = document.createElement("style");
    style.textContent = PROFILE_CSS;
    document.head.appendChild(style);

    var gate = document.createElement("div");
    gate.id = "appNewOrg";
    gate.className = "app-gate";
    gate.innerHTML =
      '<div class="app-gate-card" role="dialog" aria-modal="true">' +
        "<h2>" + escapeHtml(t.title) + "</h2><p>" + escapeHtml(t.hint) + "</p>" +
        "<label>" + escapeHtml(rt.fileFirst) +
          '<input type="file" id="newOrgFile" accept=".pdf,image/*"></label>' +
        '<div id="newOrgRead" style="font-size:.85rem;color:var(--text-secondary);margin:-.4rem 0 .8rem"></div>' +
        "<label>" + escapeHtml(t.type) +
          '<select id="newOrgType">' + ENTITY_TYPES.map(function (e) {
            return '<option value="' + e.value + '">' + escapeHtml(e[lang()] || e.ar) + "</option>";
          }).join("") + "</select></label>" +
        '<label id="newOrgNameLabel">' + escapeHtml(t.name) +
          '<input type="text" id="newOrgInput" maxlength="120" autocomplete="organization" dir="auto"></label>' +
        '<label id="newOrgLabelEn">' + escapeHtml(t.nameEn) +
          '<input type="text" id="newOrgInputEn" maxlength="120" dir="ltr" autocomplete="organization"></label>' +
        '<p class="app-gate-hint" style="font-size:.8rem;color:var(--text-secondary);margin:-.5rem 0 .6rem">' + escapeHtml(t.oneName) + "</p>" +
        '<p class="app-gate-hint" style="font-size:.85rem;color:var(--text-secondary);margin:.25rem 0 .5rem">' + escapeHtml(rt.gate) + "</p>" +
        '<label id="newOrgRegLabel">' + escapeHtml(rt.commercial_register) +
          '<input type="text" id="newOrgReg" maxlength="40" dir="ltr" inputmode="numeric" autocomplete="off"></label>' +
        "<label>" + escapeHtml(rt.expiry) +
          '<input type="text" id="newOrgExpiry" dir="ltr" inputmode="numeric" maxlength="10" autocomplete="off" placeholder="' + escapeHtml(rt.expiryHint) + '"></label>' +
        '<div id="newOrgExpiryEcho" style="font-size:.8rem;color:var(--text-secondary);margin:-.6rem 0 .8rem"></div>' +

        '<button type="button" id="newOrgSave">' + escapeHtml(t.save) + "</button>" +
        '<button type="button" id="newOrgCancelBtn"></button>' +
        '<div class="app-gate-msg" id="newOrgErr"></div>' +
      "</div>";
    document.body.appendChild(gate);
    try { closeXify(document.getElementById("newOrgCancelBtn"), gate.querySelector(".app-gate-card")); } catch (e) { /* تجاهل */ }
    var input = document.getElementById("newOrgInput");
    if (input) input.focus();

    document.getElementById("newOrgCancelBtn").addEventListener("click", function () { gate.remove(); });
    var typeSel = document.getElementById("newOrgType");
    var nameLabel = document.getElementById("newOrgNameLabel");
    var regLabel = document.getElementById("newOrgRegLabel");
    var syncRegLabel = function () { if (regLabel) regLabel.childNodes[0].nodeValue = rt[registrationRule(typeSel ? typeSel.value : "company").kind]; };
    syncRegLabel();
    if (typeSel && nameLabel) typeSel.addEventListener("change", function () {
      syncRegLabel();
      nameLabel.childNodes[0].nodeValue = isPersonType(typeSel.value) ? t.nameSelf : t.name;
      if (isPersonType(typeSel.value) && !String(input.value || "").trim() && app.profile && app.profile.full_name) {
        input.value = app.profile.full_name;
        input.dataset.prefill = "1"; /* قيمة مقترحة: يستبدلها اسم المستند */
      }
    });
    /* ما فهمه النظام من التاريخ يعرض تحته: ميلادي وهجري معا */
    var expiryEl = document.getElementById("newOrgExpiry");
    var expiryEcho = document.getElementById("newOrgExpiryEcho");
    function showExpiry() {
      if (!expiryEl || !expiryEcho) return;
      var raw = String(expiryEl.value || "").trim();
      if (!raw) { expiryEcho.textContent = rt.expiryNone; return; }
      var iso = parseAnyDate(raw);
      var assumed = expiryEl.dataset.assumed === "1" ? " — " + rt.expiryAssumed : "";
      expiryEcho.textContent = iso ? (rt.expiryReads + " " + iso + " — " + gregorianToHijriText(iso) + assumed) : rt.expiryBad;
    }
    if (expiryEl) {
      /* يكتب الأرقام فقط والشرطات تضاف وحدها: 14470512 ← 1447/05/12 */
      expiryEl.addEventListener("input", function () {
        this.dataset.assumed = "";
        var digits = String(this.value || "").replace(/[^\d]/g, "").slice(0, 8);
        if (digits.length >= 5 && String(this.value || "").indexOf("/") === -1 && String(this.value || "").indexOf("-") === -1) {
          this.value = digits.slice(0, 4) + "/" + digits.slice(4, 6) + (digits.length > 6 ? "/" + digits.slice(6, 8) : "");
        }
        showExpiry();
      });
      showExpiry();
    }

    /* الورقة تقرأ فور اختيارها فتملأ النوع والاسم والرقم وتاريخ الانتهاء */
    if (input) input.addEventListener("input", function () { delete this.dataset.prefill; });
    var fileInput = document.getElementById("newOrgFile");
    var readMsg = document.getElementById("newOrgRead");
    if (fileInput) fileInput.addEventListener("change", function () {
      var f = this.files && this.files[0];
      if (!f || !readMsg) return;
      readMsg.textContent = rt.reading;
      readDocumentFile(f).then(function (fields) {
        if (!fields) throw new Error("empty");
        var filled = [];
        if (fields.entity_hint && typeSel) {
          typeSel.value = entityTypeValue(fields.entity_hint);
          syncRegLabel();
          nameLabel.childNodes[0].nodeValue = isPersonType(typeSel.value) ? t.nameSelf : t.name;
          filled.push(entityLabel(typeSel.value));
        }
        /* اسم الجهة من الورقة يعلو على أي اسم مقترح: هو الاسم النظامي */
        if (fields.party && input && (!String(input.value || "").trim() || input.dataset.prefill === "1")) {
          input.value = fields.party;
          delete input.dataset.prefill;
          filled.push(rt.readName);
        }
        var regEl = document.getElementById("newOrgReg");
        if (fields.number && regEl && !String(regEl.value || "").trim()) { regEl.value = String(fields.number).replace(/\s/g, ""); filled.push(rt.readNumber); }
        var expEl = document.getElementById("newOrgExpiry");
        if (fields.expiry_date && expEl && !String(expEl.value || "").trim()) {
          expEl.value = String(fields.expiry_date).slice(0, 10);
          /* تاريخ مفترض (سنة من الإصدار) يقال صراحة ليصححه صاحبه */
          expEl.dataset.assumed = fields.expiry_assumed ? "1" : "";
          showExpiry();
          filled.push(fields.expiry_assumed ? rt.readExpiryAssumed : rt.readExpiry);
        }
        if (!fields.expiry_date) showExpiry();
        readMsg.textContent = filled.length ? rt.readDone + " " + filled.join("، ") : rt.readNothing;
      }).catch(function () { readMsg.textContent = rt.readFailed; });
    });

    document.getElementById("newOrgSave").addEventListener("click", function () {
      var name = String(input.value || "").trim();
      var nameEn = String((document.getElementById("newOrgInputEn") || {}).value || "").trim();
      var err = document.getElementById("newOrgErr");
      if (!name && !nameEn) { input.focus(); return; }
      var type = typeSel ? typeSel.value : "company";
      var reg = String((document.getElementById("newOrgReg") || {}).value || "").replace(/\s/g, "");
      var expiryRaw = String((document.getElementById("newOrgExpiry") || {}).value || "").trim();
      var expiry = expiryRaw ? parseAnyDate(expiryRaw) : null;
      if (expiryRaw && !expiry) { err.textContent = rt.expiryBad; document.getElementById("newOrgExpiry").focus(); return; }
      var fileEl = document.getElementById("newOrgFile");
      var file = fileEl && fileEl.files && fileEl.files[0];
      if (!registrationRule(type).pattern.test(reg)) { err.textContent = rt.invalid; document.getElementById("newOrgReg").focus(); return; }
      err.textContent = "";
      var btn = this;
      btn.disabled = true;
      createOrg(name, type, reg, expiry, nameEn).then(function (org) {
        /* الملف نفسه يرفع مرفقا على مستند التسجيل الذي أنشأته القاعدة */
        if (file && org && org.item_id) {
          return uploadAttachment(org.item_id, file).catch(function () { err.textContent = rt.fileFailed; return null; });
        }
        return null;
      }).then(function () {
        window.location.href = "/app/dashboard.html";
      }).catch(function (e) {
        btn.disabled = false;
        var code = String((e && e.message) || "");
        err.textContent = /REG_NUMBER_INVALID/.test(code) ? rt.invalid : /REG_EXPIRY_REQUIRED/.test(code) ? rt.expiryRequired : t.error;
      });
    });
  }

  /* الاسم المعروض للجهة: بالإنجليزية في الواجهتين الإنجليزية والفرنسية إن وجد */
  function orgDisplayName(o) {
    if (!o) return "";
    var wantEn = ["en", "fr"].indexOf(lang()) !== -1;
    return (wantEn ? (o.name_en || o.name) : (o.name || o.name_en)) || "";
  }

  function orgBoxHtml() {
    var orgs = (app && app.orgs) || [];
    var current = app && app.org ? app.org : null;
    if (!current && !orgs.length) return "";
    /* الاسم كما هو في السجل التجاري بلا أي لاحقة، والنوع تلميح عند المرور */
    var opts = orgs.map(function (o) {
      var type = o.entity_type ? entityLabel(o.entity_type) : "";
      return '<option value="' + escapeHtml(o.id) + '"' + (current && o.id === current.id ? " selected" : "") +
             (type ? ' title="' + escapeHtml(type) + '"' : "") + ">" +
             escapeHtml(orgDisplayName(o)) + "</option>";
    }).join("");
    opts += '<option value="__new">' + escapeHtml(sidebarLabel(NEW_ORG_LABELS)) + "</option>";
    return '<div class="app-orgbox" title="' + escapeHtml(sidebarLabel(ORG_LABELS)) + '">' +
             '<span class="app-orglabel">' + escapeHtml(sidebarLabel(ORG_LABELS)) + "</span>" +
             '<select class="app-orgselect" id="topOrgSelect">' + opts + "</select>" +
           "</div>";
  }

  var topbarHtml = "";

  function renderTopbar() {
    var bar = document.getElementById("appTopbar");
    if (!bar) return;
    var nav = topnavLinksHtml();

    var html =
      '<button type="button" class="app-iconbtn app-sidebar-toggle" id="topSidebarToggle" aria-controls="appSidebar" ' +
        'aria-label="' + escapeHtml(sidebarLabel(SIDEBAR_TOGGLE_LABELS)) + '" title="' + escapeHtml(sidebarLabel(SIDEBAR_TOGGLE_LABELS)) + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg></button>' +
      '<nav class="app-topnav">' + nav + "</nav>" +
      '<div class="app-userbox">' +
        orgBoxHtml() +
        '<a class="app-username" id="topUserName" href="/app/settings.html#profileCard" title="' + escapeHtml(userDisplayName()) + '">' + escapeHtml(userDisplayName()) + "</a>" +
        '<button type="button" class="app-iconbtn" id="topBellBtn" aria-label="' + escapeHtml(sidebarLabel(BELL_LABELS)) + '">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5S10.5 3.17 10.5 4v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>' +
          '<span class="app-bell-badge" id="topBellBadge" hidden>0</span></button>' +
        '<button type="button" class="app-iconbtn" id="topSignOut" aria-label="' + escapeHtml(sidebarLabel(SIGN_OUT_LABELS)) + '">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.59L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg></button>' +
        '<div class="app-bell-panel" id="topBellPanel"><div class="app-bell-empty">' + escapeHtml(sidebarLabel(BELL_EMPTY)) + "</div></div>" +
      "</div>";

    if (html === topbarHtml) return;   /* نفس المحتوى: لا إعادة رسم ولا مستمعون جدد */
    topbarHtml = html;
    bar.innerHTML = html;

    var bell = document.getElementById("topBellBtn");
    var bellPanel = document.getElementById("topBellPanel");

    var toggle = document.getElementById("topSidebarToggle");
    if (toggle) {
      applySidebarVisibility(sidebarVisible());
      toggle.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (isMobileShell()) { setDrawer(!document.body.classList.contains("drawer-open")); return; }
        applySidebarVisibility(!sidebarVisible(), true);
      });
    }

    if (bellPanel) bellPanel.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var go = ev.target.closest("[data-bell-go]");
      if (go && !ev.target.closest("[data-bell-del]")) { window.location.href = go.dataset.bellGo; return; }
      var del = ev.target.closest("[data-bell-del]");
      if (del) {
        del.disabled = true;
        deleteNotification(del.dataset.bellDel).then(function () { loadBell(); }).catch(function () { del.disabled = false; });
        return;
      }
      if (ev.target.closest("#bellClearAll")) {
        clearNotifications().then(function () { loadBell(); }).catch(function () { /* تجاهل */ });
      }
    });

    if (bell && bellPanel) bell.addEventListener("click", function (ev) {
      ev.stopPropagation();
      bellPanel.classList.toggle("is-open");
      if (!bellPanel.classList.contains("is-open")) return;
      var badge = document.getElementById("topBellBadge");
      if (badge) { badge.hidden = true; badge.textContent = "0"; }
      /* نعلمها مقروءة أولا ثم نعيد التحميل، وإلا عاد العداد بصف لم يحدث بعد. */
      markNotificationsRead().then(function () { loadBell(); }).catch(function () { loadBell(); });
    });

    document.addEventListener("click", function () {
      if (bellPanel) bellPanel.classList.remove("is-open");
    });

    var orgSel = document.getElementById("topOrgSelect");
    if (orgSel) orgSel.addEventListener("change", function () {
      if (this.value === "__new") {
        this.value = app.org ? app.org.id : "";
        openNewOrgDialog();
        return;
      }
      if (app.org && this.value !== app.org.id) setCurrentOrg(this.value);
    });

    var out = document.getElementById("topSignOut");
    if (out) out.addEventListener("click", function () {
      var auth = window.trackerAuth;
      var done = function () { window.location.replace("/login"); };
      if (auth && typeof auth.signOut === "function") auth.signOut().then(done, done);
      else done();
    });
  }

  /* تنبيهات الفريق تخزن بنوعها لا بنصها، فيقرأها كل مستخدم بلغته. */
  var BELL_TEAM_TEXT = {
    invite: {
      ar: "دعوة للانضمام إلى شركة {org}", en: "Invitation to join {org}",
      fr: "Invitation à rejoindre {org}", ur: "{org} میں شامل ہونے کی دعوت"
    },
    joined: {
      ar: "انضممت إلى شركة {org}", en: "You joined {org}",
      fr: "Vous avez rejoint {org}", ur: "آپ {org} میں شامل ہو گئے"
    },
    member_joined: {
      ar: "{actor} انضم إلى شركة {org}", en: "{actor} joined {org}",
      fr: "{actor} a rejoint {org}", ur: "{actor} {org} میں شامل ہو گئے"
    },
    team_room: {
      ar: "{actor} في دردشة الفريق: {item}", en: "{actor} in team chat: {item}",
      fr: "{actor} dans la discussion : {item}", ur: "{actor} ٹیم چیٹ میں: {item}"
    },
    team_message: {
      ar: "رسالة من {actor}", en: "Message from {actor}",
      fr: "Message de {actor}", ur: "{actor} کی طرف سے پیغام"
    },
    assigned: {
      ar: "أسندت إليك: {item}", en: "Assigned to you: {item}",
      fr: "Qui vous est assigné : {item}", ur: "آپ کے سپرد: {item}"
    }
  };

  function bellTitle(payload) {
    var map = BELL_TEAM_TEXT[payload.kind];
    if (!map) return "";
    return sidebarLabel(map)
      .replace("{org}", payload.org_name || "")
      .replace("{actor}", payload.actor || "")
      .replace("{item}", payload.item_title || payload.excerpt || "");
  }

  /* وجهة كل تنبيه: رسالة فريق → المحادثة، دعوة → الفريق، عنصر → لوحته مفتوحا على العنصر */
  function bellTarget(n) {
    var p = n.payload || {};
    var kind = p.kind || "";
    if (kind === "team_message") return "/app/team.html?chat=" + encodeURIComponent(p.author_id || "");
    if (kind === "invite") return "/app/team.html";
    if (p.item_id) {
      var cat = String(p.category || p.item_category || "");
      var view = /مخالف/.test(cat) ? "?type=violations&" : (/قض|دعو/.test(cat) ? "?type=cases&" : "?");
      return "/app/dashboard.html" + view + "item=" + encodeURIComponent(p.item_id);
    }
    return "";
  }

  function loadBell() {
    var panel = document.getElementById("topBellPanel");
    if (!panel) return;
    myNotifications().then(function (rows) {
      var list = rows || [];
      if (!list.length) {
        panel.innerHTML = '<div class="app-bell-empty">' + escapeHtml(sidebarLabel(BELL_EMPTY)) + "</div>";
        return;
      }
      var html = "";
      var unseen = 0;
      list.forEach(function (n) {
        var payload = n.payload || {};
        var title = bellTitle(payload) || payload.title || payload.item_title || "";
        var due = payload.due_at || null;
        /* الرقم القياسي داخلي: يظهر رقم الورقة أو القضية إن حملته الرسالة، وإلا فلا رقم */
        var number = payload.number || payload.case_number || payload.doc_number || "";
        if (!n.read_at) unseen++;
        var target = bellTarget(n);
        html += '<div class="app-bell-item' + (n.read_at ? "" : " is-unread") + (target ? " is-link" : "") + '"' +
                (target ? ' data-bell-go="' + escapeHtml(target) + '"' : "") + ">" +
                '<button type="button" class="app-bell-del" data-bell-del="' + escapeHtml(n.id) + '" aria-label="' +
                escapeHtml(sidebarLabel(BELL_DELETE)) + '" title="' + escapeHtml(sidebarLabel(BELL_DELETE)) + '">✕</button>' +
                "<strong>" + escapeHtml(title || sidebarLabel(BELL_LABELS)) + "</strong>" +
                (number ? '<span class="app-bell-num">' + escapeHtml(number) + "</span>" : "") +
                escapeHtml(due ? fmtDate(due, { withTime: true }) : fmtDate(n.created_at, { withTime: true })) +
                "</div>";
      });
      panel.innerHTML = html +
        '<button type="button" class="app-bell-clear" id="bellClearAll">' + escapeHtml(sidebarLabel(BELL_CLEAR)) + "</button>";
      var badge = document.getElementById("topBellBadge");
      if (!badge) return;
      if (unseen > 0 && !panel.classList.contains("is-open")) {
        badge.textContent = String(unseen);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }).catch(function () { /* التنبيهات ليست حرجة */ });
  }

  /* داخل التطبيق لا يخرج المستخدم من حسابه: روابط الموقع العام تفتح في تبويب
     جديد، ورابط "تسجيل الدخول" في التذييل لا معنى له بعد الدخول. */
  function keepInsideApp() {
    /* لا شيء يخرج المستخدم من لوحته: روابط الموقع العام في التذييل تزال داخل
       التطبيق، وما تبقى من روابط خارجية يفتح في تبويب جديد. */
    /* نخفي روابط الموقع العام في التذييل فقط، ونبقي روابط التطبيق مثل لوحة التحكم. */
    var footerRows = document.querySelectorAll(".footer-links");
    for (var f = 0; f < footerRows.length; f++) {
      var kids = footerRows[f].querySelectorAll("a[href]");
      var visible = 0;
      for (var j = 0; j < kids.length; j++) {
        var h = kids[j].getAttribute("href") || "";
        if (h.indexOf("/app/") === 0) { visible++; continue; }
        kids[j].hidden = true;
      }
      footerRows[f].hidden = visible === 0;
    }

    /* زر الخروج واحد فقط، في الشريط العلوي؛ أي زر آخر في الصفحات يخفى. */
    var strays = document.querySelectorAll("#signOutCard, #signOutBtn, #quickLinks");
    for (var i = 0; i < strays.length; i++) strays[i].hidden = true;

    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.getAttribute("href") || "";
      if (href.indexOf("/login") === 0 || href.indexOf("login.html") !== -1) { a.hidden = true; continue; }
      if (href.charAt(0) === "#" || href.indexOf("mailto:") === 0 || href.indexOf("webcal:") === 0) continue;
      var outside = href.indexOf("/app/") !== 0 && href.indexOf("http") !== 0 ? true : (href.indexOf(window.location.origin + "/app/") === 0 ? false : href.indexOf("http") === 0);
      if (href.indexOf("/app/") === 0) continue;
      if (outside && !a.target) { a.target = "_blank"; a.rel = "noopener"; }
    }
  }

  function syncSiteHeaderHeight() {
    var h = document.querySelector(".site-header");
    var px = h ? Math.round(h.getBoundingClientRect().height) : 61;
    if (px > 0) document.documentElement.style.setProperty("--site-header-h", px + "px");
  }

