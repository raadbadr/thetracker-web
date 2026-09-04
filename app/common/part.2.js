  function addAttachmentLink(itemId, name, url) {
    return run(function (client) {
      var orgId = requireOrg();
      var clean = String(url || "").trim();
      if (!/^https?:\/\//i.test(clean)) throw new Error("invalid url");
      return client.from("attachments").insert({
        org_id: orgId,
        item_id: itemId || null,
        name: String(name || clean).slice(0, 200),
        external_url: clean,
        uploaded_by: app.user.id
      }).select("*").single().then(unwrap);
    });
  }

  /* ---------- قراءة المستندات: الورقة تقرأ في المتصفح ثم يحللها الخادم ----------
     كل ما يمكن استخراجه من المستند يملأ تلقائيا، والإدخال اليدوي للمراجعة فقط. */
  var PDF_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  var PDF_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  function fileToImageData(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = reject;
      r.readAsDataURL(file);
    }).then(function (dataUrl) {
      /* صور الجوال الكبيرة تفشل قراءتها: تصغر إلى 1800 بكسل */
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          var MAX = 1800, w = img.width, h = img.height;
          if (w <= MAX && h <= MAX) { resolve(dataUrl); return; }
          var k = Math.min(MAX / w, MAX / h);
          var c = document.createElement("canvas");
          c.width = Math.round(w * k); c.height = Math.round(h * k);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL("image/jpeg", 0.85));
        };
        img.onerror = function () { resolve(dataUrl); };
        img.src = dataUrl;
      });
    });
  }

  function pdfRead(file) {
    return loadScriptOnce(PDF_SRC, function () { return !!window.pdfjsLib; }).then(function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
      return file.arrayBuffer();
    }).then(function (buf) {
      return window.pdfjsLib.getDocument({ data: buf }).promise;
    }).then(function (pdf) {
      var pages = Math.min(pdf.numPages, 4), chain = Promise.resolve(), text = "";
      for (var i = 1; i <= pages; i++) {
        (function (n) {
          chain = chain.then(function () { return pdf.getPage(n); })
            .then(function (page) { return page.getTextContent(); })
            .then(function (tc) { text += tc.items.map(function (it) { return it.str; }).join(" ") + "\n"; });
        })(i);
      }
      return chain.then(function () { return { text: text.trim(), pdf: pdf }; });
    });
  }

  function pdfPageImage(pdf, n) {
    return pdf.getPage(n).then(function (page) {
      var base = page.getViewport({ scale: 1 });
      var scale = Math.min(2, 1800 / Math.max(base.width, base.height));
      var vp = page.getViewport({ scale: scale });
      var c = document.createElement("canvas");
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      var ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () { return c.toDataURL("image/jpeg", 0.85); });
    });
  }

  function analyzeDocument(payload) {
    var auth = window.trackerAuth;
    var session = auth && auth.getSession ? auth.getSession() : Promise.resolve(null);
    return Promise.resolve(session).then(function (sess) {
      var headers = { "Content-Type": "application/json" };
      var jwt = sess && sess.access_token;
      if (jwt) headers.Authorization = "Bearer " + jwt;
      return fetch("/api/documents/analyze", { method: "POST", headers: headers, body: JSON.stringify(payload) });
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || "analyze_failed");
        return d.fields;
      });
    });
  }

  /* أوراقنا الرسمية تكتب تاريخها هجريا أو ميلاديا، وحقل التاريخ القياسي
     في المتصفح ميلادي فقط. نقبل الصيغتين ونحول الهجري بتقويم أم القرى. */
  function hijriPartsOf(date) {
    var fmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn",
      { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric" });
    var out = {};
    fmt.formatToParts(date).forEach(function (part) {
      if (part.type === "year" || part.type === "month" || part.type === "day") out[part.type] = parseInt(part.value, 10);
    });
    return out;
  }

  function hijriToGregorianISO(year, month, day) {
    var approx = new Date(Date.UTC(622, 6, 16) + ((year - 1) * 354.367 + (month - 1) * 29.53 + (day - 1)) * 86400000);
    for (var off = -40; off <= 40; off++) {
      var candidate = new Date(approx.getTime() + off * 86400000);
      var h = hijriPartsOf(candidate);
      if (h.year === year && h.month === month && h.day === day) return candidate.toISOString().slice(0, 10);
    }
    return null;
  }

  /* يقبل 1447/05/10 و1447-05-10 و2026-12-01 و01/12/2026، ويعيد ISO ميلاديا */
  function parseAnyDate(value) {
    var text = String(value == null ? "" : value).trim();
    if (!text) return null;
    text = text.replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
               .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });
    var ymd = text.match(/^(\d{3,4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
    var dmy = text.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{3,4})$/);
    var year, month, day;
    if (ymd) { year = +ymd[1]; month = +ymd[2]; day = +ymd[3]; }
    else if (dmy) { day = +dmy[1]; month = +dmy[2]; year = +dmy[3]; }
    else return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (year >= 1300 && year < 1600) return hijriToGregorianISO(year, month, day);
    if (year < 1900 || year > 2200) return null;
    return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }

  /* التاريخ الميلادي مكتوبا بالهجري ليطمئن صاحبه أن ما فهمه النظام صحيح */
  function gregorianToHijriText(iso) {
    if (!iso) return "";
    var d = new Date(iso + "T12:00:00Z");
    if (isNaN(d.getTime())) return "";
    var h = hijriPartsOf(d);
    if (!h.year) return "";
    return h.year + "/" + String(h.month).padStart(2, "0") + "/" + String(h.day).padStart(2, "0") + " هـ";
  }

  /* ملفات PDF العربية كثيرا ما تخرج نصا مشوها (أشكال عرض وحروف مفرقة
     بترتيب بصري) لا يقرأ: نكتشفه ونرسل صورة الصفحة ليقرأها نموذج الرؤية. */
  function textLooksMangled(text) {
    var value = String(text || "");
    var singles = (value.match(/(?:^|\s)[\u0600-\u06FF](?=\s|$)/g) || []).length;
    var words = (value.match(/\S+/g) || []).length;
    return words > 10 && singles / words > 0.3;
  }

  /* يعيد حقول المستند: نوعه، الجهة التي يفتحها، الاسم، الرقم، تاريخ الانتهاء */
  function readDocumentFile(file) {
    if (!file) return Promise.reject(new Error("no_file"));
    var isPdf = /\.pdf$/i.test(file.name || "") || file.type === "application/pdf";
    if (!isPdf) return fileToImageData(file).then(function (img) { return analyzeDocument({ image: img }); });
    return pdfRead(file).then(function (r) {
      var text = String(r.text || "").normalize("NFKC");
      if (text.length >= 40 && !textLooksMangled(text)) return analyzeDocument({ text: text });
      /* نص ناقص أو مفكك: ترسل صورة الصفحة معه ليختار الخادم أوضحهما */
      return pdfPageImage(r.pdf, 1).then(function (img) {
        return analyzeDocument(text.length >= 40 ? { text: text, image: img } : { image: img });
      });
    });
  }

  /* ---------- Google Drive: اختيار ملف من درايف المستخدم وربطه بالعنصر ----------
     يعمل عبر Google Picker بصلاحية drive.file (غير حساسة): المستخدم يختار الملف
     بنفسه، ونخزن رابطه واسمه فقط؛ الملف يبقى في درايفه. */
  var DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
  var driveConfig = { clientId: null, apiKey: null };
  var driveToken = null;

  function driveAvailable() { return !!(driveConfig.clientId && driveConfig.apiKey); }

  function driveAppId() { return String(driveConfig.clientId || "").split("-")[0] || ""; }

  function loadScriptOnce(src, test) {
    return new Promise(function (resolve, reject) {
      if (test()) { resolve(); return; }
      var el = document.createElement("script");
      el.src = src; el.async = true;
      el.onload = function () { resolve(); };
      el.onerror = function () { reject(new Error("load_failed")); };
      document.head.appendChild(el);
    });
  }

  function driveAccessToken() {
    if (driveToken && driveToken.expires > Date.now()) return Promise.resolve(driveToken.token);
    return loadScriptOnce("https://accounts.google.com/gsi/client", function () { return !!(window.google && window.google.accounts && window.google.accounts.oauth2); })
      .then(function () {
        return new Promise(function (resolve, reject) {
          var tc = window.google.accounts.oauth2.initTokenClient({
            client_id: driveConfig.clientId,
            scope: DRIVE_SCOPE,
            callback: function (resp) {
              if (!resp || !resp.access_token) { reject(new Error("no_token")); return; }
              driveToken = { token: resp.access_token, expires: Date.now() + (Number(resp.expires_in) || 3000) * 1000 - 60000 };
              resolve(resp.access_token);
            },
            error_callback: function () { reject(new Error("denied")); }
          });
          tc.requestAccessToken({ prompt: driveToken ? "" : "consent" });
        });
      });
  }

  function pickFromDrive(opts) {
    var multi = !opts || opts.multi !== false;
    if (!driveAvailable()) return Promise.reject(new Error("drive_unavailable"));
    return driveAccessToken().then(function (token) {
      return loadScriptOnce("https://apis.google.com/js/api.js", function () { return !!window.gapi; })
        .then(function () { return new Promise(function (resolve) { window.gapi.load("picker", { callback: resolve }); }); })
        .then(function () {
          return new Promise(function (resolve, reject) {
            var view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
            var builder = new window.google.picker.PickerBuilder()
              .setOAuthToken(token)
              .setDeveloperKey(driveConfig.apiKey)
              .setAppId(driveAppId())
              .setLocale(lang() === "ar" || lang() === "ur" ? "ar" : lang())
              .addView(view);
            if (multi) builder.enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED);
            var picker = builder
              .setCallback(function (data) {
                if (data.action === window.google.picker.Action.PICKED) resolve(data.docs || []);
                else if (data.action === window.google.picker.Action.CANCEL) reject(new Error("cancelled"));
              })
              .build();
            picker.setVisible(true);
          });
        });
    });
  }

  /* ملف درايف المختار ينزل مؤقتا في المتصفح ليقرأه المحلل، ولا يرفع لتخزيننا.
     ملفات جوجل (مستند/جدول) تصدر PDF أو XLSX لأنها لا تنزل كما هي. */
  var GOOGLE_EXPORT = {
    "application/vnd.google-apps.document": ["application/pdf", ".pdf"],
    "application/vnd.google-apps.presentation": ["application/pdf", ".pdf"],
    "application/vnd.google-apps.drawing": ["application/pdf", ".pdf"],
    "application/vnd.google-apps.spreadsheet": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"]
  };

  function driveDownload(doc) {
    if (!doc || !doc.id) return Promise.reject(new Error("no_file"));
    return driveAccessToken().then(function (token) {
      var exp = GOOGLE_EXPORT[doc.mimeType];
      var url = exp
        ? "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(doc.id) + "/export?mimeType=" + encodeURIComponent(exp[0])
        : "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(doc.id) + "?alt=media";
      return fetch(url, { headers: { Authorization: "Bearer " + token } }).then(function (r) {
        if (!r.ok) throw new Error("drive_download_" + r.status);
        return r.blob();
      }).then(function (blob) {
        var name = String(doc.name || "drive-file");
        if (exp && name.slice(-exp[1].length).toLowerCase() !== exp[1]) name += exp[1];
        try { return new File([blob], name, { type: blob.type || (exp ? exp[0] : doc.mimeType) || "application/octet-stream" }); }
        catch (e) { blob.name = name; return blob; }
      });
    });
  }

  /* يربط ملفات درايف المختارة بعنصر: صف مرفق لكل ملف برابطه (بلا رفع) */
  /* ------------------------------------------------------------
   * ترجمة العرض التلقائية (أمر المهندس رعد): نص حر كتبه مستخدم بلغة يظهر لغيره بلغة واجهته.
   * الصفحة تضع data-tr على عناصر النص الحر وتنادي app.translateNodes(container) بعد كل رسم.
   * لا يُرسل شيء حين تتطابق لغة النص مع لغة الواجهة أو حين يكون النص أرقاما ورموزا فقط.
   * ------------------------------------------------------------ */
  var TR_MEM = {};
  var TR_PREFIX = "tracker_tr:";
  var TR_MAX_LOCAL = 400;
  function trScript(text) {
    var t = String(text || "");
    if (!/[A-Za-z\u00C0-\u024F\u0600-\u06FF]/.test(t)) return "none";
    var ar = (t.match(/[\u0600-\u06FF]/g) || []).length, la = (t.match(/[A-Za-z\u00C0-\u024F]/g) || []).length;
    if (ar >= la) return /[ٹڈڑںھہۃیےۓکگ]/.test(t) ? "ur" : "ar";
    return "latin";
  }
  function trNeeded(text, target) {
    var sc = trScript(text);
    if (sc === "none") return false;
    if (sc === "latin") return target === "ar" || target === "ur";   /* إنجليزي/فرنسي لا يُفرَّق بينهما من الحروف: لا يُترجم بينهما */
    return sc !== target;
  }
  function trKey(text, target) {
    var h = 5381, str = target + "\n" + text;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return TR_PREFIX + target + ":" + (h >>> 0).toString(36) + ":" + str.length;
  }
  function trLocalGet(key) { if (TR_MEM[key]) return TR_MEM[key]; try { return localStorage.getItem(key); } catch (e) { return null; } }
  function trLocalSet(key, value) {
    TR_MEM[key] = value;
    try {
      var n = Number(localStorage.getItem(TR_PREFIX + "count") || 0);
      if (n > TR_MAX_LOCAL) { Object.keys(localStorage).forEach(function (k) { if (k.indexOf(TR_PREFIX) === 0) localStorage.removeItem(k); }); n = 0; }
      localStorage.setItem(key, value); localStorage.setItem(TR_PREFIX + "count", String(n + 1));
    } catch (e) { /* التخزين محجوب */ }
  }
  var trPending = null;
  function translateTexts(texts, target) {
    target = target || lang();
    var list = (texts || []).map(function (t) { return String(t == null ? "" : t); });
    var out = list.slice();
    var ask = [], askIdx = [];
    list.forEach(function (t, i) {
      var trimmed = t.trim();
      if (!trimmed || !trNeeded(trimmed, target)) return;
      var hit = trLocalGet(trKey(trimmed, target));
      if (hit) { out[i] = hit; return; }
      if (ask.indexOf(trimmed) === -1) ask.push(trimmed);
      askIdx.push(i);
    });
    if (!ask.length) return Promise.resolve(out);
    var auth = window.trackerAuth;
    var session = auth && auth.getSession ? auth.getSession() : Promise.resolve(null);
    var chunks = []; for (var c = 0; c < ask.length; c += 40) chunks.push(ask.slice(c, c + 40));
    return Promise.resolve(session).then(function (sess) {
      var headers = { "Content-Type": "application/json" };
      if (sess && sess.access_token) headers.Authorization = "Bearer " + sess.access_token;
      var map = {};
      return chunks.reduce(function (p, chunk) {
        return p.then(function () {
          return fetch("/api/translate", { method: "POST", headers: headers, body: JSON.stringify({ texts: chunk, target: target }) })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
              var tr = d && d.translations || [];
              chunk.forEach(function (t, k) { if (tr[k] && tr[k] !== t) { map[t] = tr[k]; trLocalSet(trKey(t, target), tr[k]); } });
            }).catch(function () { /* الشبكة أو الحد: يبقى النص الأصلي */ });
        });
      }, Promise.resolve()).then(function () {
        askIdx.forEach(function (i) { var t = list[i].trim(); if (map[t]) out[i] = map[t]; });
        return out;
      });
    });
  }
  /* يترجم كل [data-tr] داخل root (أو root نفسه) لغة العارض، ويحفظ الأصل في data-tr-original وفي title */
  function translateNodes(root, target) {
    target = target || lang();
    root = root || document;
    var nodes = [];
    if (root !== document && root.matches && root.matches("[data-tr]")) nodes.push(root);
    (root.querySelectorAll ? root.querySelectorAll("[data-tr]") : []).forEach(function (el) { nodes.push(el); });
    nodes = nodes.filter(function (el) { return el.dataset.trDone !== target; });
    if (!nodes.length) return Promise.resolve(0);
    var originals = nodes.map(function (el) { return el.dataset.trOriginal !== undefined ? el.dataset.trOriginal : el.textContent; });
    return translateTexts(originals, target).then(function (tr) {
      var changed = 0;
      nodes.forEach(function (el, i) {
        var original = originals[i];
        el.dataset.trOriginal = original;
        el.dataset.trDone = target;
        if (tr[i] && tr[i] !== original) {
          el.textContent = tr[i]; el.title = original; el.classList.add("is-translated"); el.setAttribute("dir", "auto"); changed++;
        } else if (el.dataset.trOriginal !== undefined && el.textContent !== original) {
          el.textContent = original; el.removeAttribute("title"); el.classList.remove("is-translated");
        }
      });
      return changed;
    });
  }

  /* ------------------------------------------------------------
   * التخزين في Google Drive الخاص بالمستخدم (خيار؛ الافتراضي تخزين المنصة)
   * الرفع يحتاج رمز OAuth فقط (drive.file) ولا يحتاج مفتاح Picker.
   * ------------------------------------------------------------ */
  var DRIVE_API = "https://www.googleapis.com/drive/v3";
  var DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
  var DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
  var DRIVE_ROOT_NAME = "TheTracker";
  var DRIVE_FALLBACK_TEXT = {
    ar: "لم يتم الحفظ في Google Drive، فحفظ الملف في تخزين المنصة.",
    en: "Google Drive was unavailable, so the file was saved to platform storage.",
    fr: "Google Drive indisponible : le fichier a été enregistré sur la plateforme.",
    ur: "Google Drive دستیاب نہیں تھا، فائل پلیٹ فارم اسٹوریج میں محفوظ ہو گئی۔"
  };

  function driveOAuthAvailable() { return !!driveConfig.clientId; }

  /* وضع التخزين الفعال: درايف فقط إن اختاره المستخدم في ملفه وكان عميل جوجل مضبوطا */
  function storageMode() {
    var mode = app.profile && app.profile.storage_mode;
    return mode === "drive" && driveOAuthAvailable() ? "drive" : "platform";
  }

  function driveFetch(token, url, opts) {
    var o = opts || {};
    var headers = Object.assign({ Authorization: "Bearer " + token }, o.headers || {});
    return fetch(url, { method: o.method || "GET", headers: headers, body: o.body }).then(function (res) {
      if (res.status === 204) return null;
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) {
          var err = new Error("drive_" + res.status);
          err.status = res.status; err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function driveEscape(v) { return String(v || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }

  function driveFindOrCreateFolder(token, name, parentId, props) {
    var q = "mimeType='" + DRIVE_FOLDER_MIME + "' and trashed=false and '" + (parentId || "root") + "' in parents";
    if (props && props.tracker_org) q += " and appProperties has { key='tracker_org' and value='" + driveEscape(props.tracker_org) + "' }";
    else q += " and name='" + driveEscape(name) + "'";
    return driveFetch(token, DRIVE_API + "/files?q=" + encodeURIComponent(q) + "&fields=files(id,name)&pageSize=1&spaces=drive")
      .then(function (data) {
        var found = data && data.files && data.files[0];
        if (found) return found.id;
        var meta = { name: name, mimeType: DRIVE_FOLDER_MIME, parents: [parentId || "root"] };
        if (props) meta.appProperties = props;
        return driveFetch(token, DRIVE_API + "/files?fields=id", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(meta)
        }).then(function (f) { return f.id; });
      });
  }

  /* مجلد «TheTracker/اسم الشركة» في درايف المستخدم، مع تخزين معرفه محليا */
  function driveFolderFor(token, orgId, orgName, fresh) {
    var key = "tracker_drive_folder:" + orgId;
    var cached = !fresh && localStorage.getItem(key);
    if (cached) return Promise.resolve(cached);
    return driveFindOrCreateFolder(token, DRIVE_ROOT_NAME, "root", null)
      .then(function (rootId) { return driveFindOrCreateFolder(token, orgName || "Company", rootId, { tracker_org: orgId }); })
      .then(function (id) { localStorage.setItem(key, id); return id; });
  }

  function driveUploadFile(token, file, folderId) {
    var boundary = "tracker" + randomCode(12);
    var meta = { name: file.name || "file", parents: [folderId] };
    var body = new Blob([
      "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) + "\r\n",
      "--" + boundary + "\r\nContent-Type: " + (file.type || "application/octet-stream") + "\r\n\r\n",
      file,
      "\r\n--" + boundary + "--"
    ]);
    return driveFetch(token, DRIVE_UPLOAD + "?uploadType=multipart&fields=id,name,mimeType,size,webViewLink", {
      method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body: body
    });
  }

  /* مشاركة الملف (قراءة) مع أعضاء الشركة الفعالين — بلا رسائل بريد، وبلا إيقاف الرفع عند الفشل */
  function driveShareWithTeam(token, fileId) {
    return listMembers().then(function (members) {
      var emails = [];
      (members || []).forEach(function (m) {
        var email = m.profiles && m.profiles.email;
        if (m.status === "active" && m.user_id !== app.user.id && email && emails.indexOf(email) === -1) emails.push(email);
      });
      return emails.reduce(function (p, email) {
        return p.then(function () {
          return driveFetch(token, DRIVE_API + "/files/" + fileId + "/permissions?sendNotificationEmail=false&fields=id", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "user", role: "reader", emailAddress: email })
          }).catch(function () { return null; });
        });
      }, Promise.resolve());
    }).catch(function () { return null; });
  }

  function storeInDrive(file) {
    var orgId = requireOrg();
    var orgName = (app.org && app.org.name) || "";
    return driveAccessToken().then(function (token) {
      return driveFolderFor(token, orgId, orgName).then(function (folderId) {
        return driveUploadFile(token, file, folderId).catch(function (err) {
          if (err && err.status !== 404) throw err;
          /* المجلد المخزن محليا حذف من درايف: أعد إيجاده مرة واحدة */
          return driveFolderFor(token, orgId, orgName, true).then(function (fid) { return driveUploadFile(token, file, fid); });
        });
      }).then(function (f) {
        return driveShareWithTeam(token, f.id).then(function () {
          return { id: f.id, name: f.name || file.name, mime: f.mimeType || file.type || null,
                   size: Number(f.size) || file.size || 0, url: f.webViewLink || ("https://drive.google.com/file/d/" + f.id + "/view") };
        });
      });
    });
  }

  /* الطريق الواحد لحفظ ملف وتسجيله في attachments: درايف إن اختاره المستخدم (مع سقوط آمن إلى المنصة)، وإلا تخزين المنصة */
  function storeAttachment(file, meta, path) {
    if (!file) return Promise.reject(new Error("file required"));
    var orgId = requireOrg();
    var base = Object.assign({ org_id: orgId, uploaded_by: app.user.id }, meta || {});
    function viaPlatform() {
      return run(function (client) {
        return client.storage.from(ATTACH_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })
          .then(function (res) {
            if (res && res.error) throw res.error;
            return client.from("attachments").insert(Object.assign({}, base, {
              name: file.name || "file", mime: file.type || null, size_bytes: file.size || 0, storage_path: path
            })).select("*").single().then(unwrap)
              .catch(function (err) {
                /* لا نترك ملفا يتيما في التخزين إذا رفضت القاعدة الصف */
                client.storage.from(ATTACH_BUCKET).remove([path]);
                throw err;
              });
          });
      });
    }
    if (storageMode() !== "drive") return viaPlatform();
    return storeInDrive(file).then(function (d) {
      return run(function (client) {
        return client.from("attachments").insert(Object.assign({}, base, {
          name: String(d.name || "file").slice(0, 200), mime: d.mime, size_bytes: d.size,
          external_url: d.url, drive_file_id: d.id
        })).select("*").single().then(unwrap);
      });
    }).catch(function (err) {
      if (err && /^drive_|^no_token$|^denied$|^load_failed$/.test(String(err.message || ""))) {
        toast(DRIVE_FALLBACK_TEXT[lang()] || DRIVE_FALLBACK_TEXT.ar, "error");
        return viaPlatform();
      }
      throw err;
    });
  }

  function attachDriveFiles(itemId, docs) {
    var list = (docs || []).filter(function (d) { return d && d.url; });
    return list.reduce(function (p, d) {
      return p.then(function () {
        return run(function (client) {
          var orgId = requireOrg();
          return client.from("attachments").insert({
            org_id: orgId, item_id: itemId || null,
            name: String(d.name || "Google Drive").slice(0, 200),
            mime: d.mimeType || null,
            size_bytes: Number(d.sizeBytes) || 0,
            external_url: d.url,
            uploaded_by: app.user.id
          }).then(unwrap);
        });
      });
    }, Promise.resolve()).then(function () { return list.length; });
  }

  /* رابط المرفق: للعرض (افتراضي) أو للتنزيل الحقيقي ({download:true|اسم الملف}):
     تخزين المنصة يرسل Content-Disposition: attachment من الخادم نفسه (سمة download لا تعمل عبر النطاقات)،
     وملف درايف يُحمَّل من uc?export=download بمعرّفه، وإلا يُفتح في عارض درايف. */
  function attachmentUrl(att, opts) {
    if (!att) return Promise.resolve(null);
    var download = opts && opts.download;
    if (att.external_url) {
      if (download && att.drive_file_id) return Promise.resolve("https://drive.google.com/uc?export=download&id=" + encodeURIComponent(att.drive_file_id));
      return Promise.resolve(att.external_url);
    }
    return run(function (client) {
      var options = download ? { download: typeof download === "string" ? download : (att.name || true) } : undefined;
      return client.storage.from(ATTACH_BUCKET).createSignedUrl(att.storage_path, 300, options).then(function (res) {
        if (res && res.error) throw res.error;
        return res.data ? res.data.signedUrl : null;
      });
    });
  }

  function deleteAttachment(att) {
    return run(function (client) {
      if (!att || !att.id) throw new Error("attachment required");
      return client.from("attachments").delete().eq("id", att.id).then(unwrap).then(function () {
        if (att.storage_path) return client.storage.from(ATTACH_BUCKET).remove([att.storage_path]);
        return null;
      });
    });
  }

  function storageUsed() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("attachments").select("size_bytes").eq("org_id", orgId).not("storage_path", "is", null).then(unwrap)
        .then(function (rows) {
          return (rows || []).reduce(function (sum, r) { return sum + (Number(r.size_bytes) || 0); }, 0);
        });
    });
  }

  function renameOrg(name, nameEn) {
    return run(function (client) {
      var orgId = requireOrg();
      var clean = String(name || "").trim();
      var cleanEn = String(nameEn == null ? (app.org && app.org.name_en) || "" : nameEn).trim();
      if (!clean && !cleanEn) throw new Error("name required");
      return client.rpc("rename_org", { p_org: orgId, p_name: clean, p_name_en: cleanEn || null })
        .then(unwrap)
        .then(function (row) {
          app.org.name = row.name;
          app.org.name_en = row.name_en || null;
          for (var i = 0; i < app.orgs.length; i++) if (app.orgs[i].id === row.id) {
            app.orgs[i].name = row.name; app.orgs[i].name_en = row.name_en || null;
          }
          return row;
        });
    });
  }

  function deleteOrg(orgId) {
    return run(function (client) {
      var id = orgId || requireOrg();
      return client.from("organizations").delete().eq("id", id).then(unwrap).then(function () {
        app.orgs = app.orgs.filter(function (o) { return o.id !== id; });
        app.org = app.orgs.length ? app.orgs[0] : null;
        try { app.org ? localStorage.setItem(ORG_KEY, app.org.id) : localStorage.removeItem(ORG_KEY); } catch (e) { /* ignore */ }
        return true;
      });
    });
  }

  /* بحث عن مستخدم مسجل لدعوته (مطابقة تامة للبريد أو الجوال أو رقمه القياسي). */
  function findProfileForInvite(query) {
    return run(function (client) {
      return client.rpc("find_profile_for_invite", { p_query: String(query || "") }).then(unwrap);
    });
  }

  function effectivePlan() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.rpc("effective_plan", { o: orgId }).then(unwrap).then(function (code) { return code || "trial"; });
    });
  }

  function plans() {
    return run(function (client) {
      return client.from("plans").select("*").order("sort_order", { ascending: true }).then(unwrap);
    });
  }

  function planLimits() {
    return Promise.all([effectivePlan(), plans()]).then(function (res) {
      var code = res[0];
      var list = res[1] || [];
      for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i].limits || {};
      return {};
    });
  }

  function subscription() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("subscriptions").select("*")
        .eq("org_id", orgId).eq("status", "active")
        .order("created_at", { ascending: false }).limit(1).maybeSingle()
        .then(unwrap);
    });
  }

  /* ============================================================
   * Trackers
   * ============================================================ */

  function listTrackers() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("trackers").select("*").eq("org_id", orgId)
        .order("created_at", { ascending: true }).then(unwrap);
    });
  }

  function createTracker(tracker) {
    return run(function (client) {
      var orgId = requireOrg();
      var row = {
        org_id: orgId,
        name: String((tracker && tracker.name) || "").trim(),
        color: (tracker && tracker.color) || null,
        columns: (tracker && tracker.columns) || [],
        created_by: app.user.id
      };
      if (!row.name) throw new Error("name required");
      return client.from("trackers").insert(row).select("*").single().then(unwrap);
    });
  }

  function deleteTracker(id) {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("trackers").delete().eq("org_id", orgId).eq("id", id).then(unwrap);
    });
  }

  /* ============================================================
   * Items
   * ============================================================ */

  function listItems(filters) {
    var f = filters || {};
    return run(function (client) {
      var orgId = requireOrg();
      var q = client.from("items").select(ITEM_COLUMNS).eq("org_id", orgId);
      if (f.trackerId) q = q.eq("tracker_id", f.trackerId);
      if (f.status) q = q.eq("status", f.status);
      if (f.from) q = q.gte("due_at", f.from);
      if (f.to) q = q.lte("due_at", f.to);
      if (f.search) {
        var term = String(f.search).trim().replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
        if (term) q = q.ilike("title", "%" + term + "%");
      }
      q = q.order("due_at", { ascending: true, nullsFirst: false }).limit(f.limit || 500);
      return q.then(unwrap).then(function (rows) { return rows || []; });
    });
  }

  function countItems(filters) {
    var f = filters || {};
    return run(function (client) {
      var orgId = requireOrg();
      var q = client.from("items").select("id", { count: "exact", head: true }).eq("org_id", orgId);
      if (f.trackerId) q = q.eq("tracker_id", f.trackerId);
      if (f.status) q = q.eq("status", f.status);
      return q.then(unwrapCount);
    });
  }

  function insertItems(rows) {
    return run(function (client) {
      var orgId = requireOrg();
      var list = (rows || []).map(function (r) {
        if (!r || !r.tracker_id) throw new Error("tracker_id required on every item");
        var row = {};
        for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) row[k] = r[k];
        row.org_id = orgId;
        row.title = String(row.title || "").trim() || "-";
        if (!row.created_by) row.created_by = app.user.id;
        return row;
      });
      var inserted = [];
      var chunks = [];
      for (var i = 0; i < list.length; i += INSERT_CHUNK) chunks.push(list.slice(i, i + INSERT_CHUNK));
      return chunks.reduce(function (p, chunk) {
        return p.then(function () {
          return client.from("items").insert(chunk).select("id").then(unwrap).then(function (data) {
            inserted = inserted.concat(data || []);
          });
        });
      }, Promise.resolve()).then(function () { return inserted; });
    });
  }

  function updateItem(id, patch) {
    return run(function (client) {
      var orgId = requireOrg();
      var clean = {};
      for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k) && k !== "id" && k !== "org_id") clean[k] = patch[k];
      return client.from("items").update(clean).eq("org_id", orgId).eq("id", id).select(ITEM_COLUMNS).single().then(unwrap);
    });
  }

  function deleteItem(id) {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("items").delete().eq("org_id", orgId).eq("id", id).then(unwrap);
    });
  }

  /* ============================================================
   * Imports
   * ============================================================ */

  function listImports() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("imports").select("*, trackers(name)").eq("org_id", orgId)
        .order("created_at", { ascending: false }).then(unwrap);
    });
  }

  function createImport(imp) {
    return run(function (client) {
      var orgId = requireOrg();
      var row = {
        org_id: orgId,
        tracker_id: (imp && imp.tracker_id) || null,
        filename: (imp && imp.filename) || null,
        rows_count: (imp && imp.rows_count) || 0,
        mapping: (imp && imp.mapping) || {},
        created_by: app.user.id
      };
      return client.from("imports").insert(row).select("*").single().then(unwrap);
    });
  }

  function importsThisMonth() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("imports").select("id", { count: "exact", head: true })
        .eq("org_id", orgId).gte("created_at", startOfMonthIso()).then(unwrapCount);
    });
  }

  /* ============================================================
   * Members & invitations
   * ============================================================ */

  function listMembers() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("org_members").select("org_id,user_id,role,status,invited_email,created_at,job_title,person_kind,department")
        .eq("org_id", orgId).order("created_at", { ascending: true })
        .then(unwrap)
        .then(function (members) {
          members = members || [];
          if (!members.length) return members;
          var ids = members.map(function (m) { return m.user_id; });
          /* org_members.user_id points at auth.users, so profiles are fetched separately and attached. */
          return client.from("profiles").select("id,full_name,email,phone").in("id", ids)
            .then(unwrap)
            .then(function (profiles) {
              var byId = {};
              (Array.isArray(profiles) ? profiles : []).forEach(function (p) { byId[p.id] = p; });
              members.forEach(function (m) {
                var p = byId[m.user_id] || null;
                m.profiles = p ? { full_name: p.full_name, email: p.email, phone: p.phone }
                               : { full_name: null, email: m.invited_email || null, phone: null };
              });
              return members;
            });
        });
    });
  }

  function listInvitations() {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("invitations").select("*").eq("org_id", orgId).is("accepted_at", null)
        .order("created_at", { ascending: false }).then(unwrap);
    });
  }

  function inviteMember(email, memberRole) {
    return run(function (client) {
      var orgId = requireOrg();
      var clean = String(email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error("invalid email");
      var r = memberRole === "admin" ? "admin" : "member";
      return client.from("invitations")
        .insert({ org_id: orgId, email: clean, role: r, invited_by: app.user.id })
        .select("*").single().then(unwrap);
    });
  }

  function cancelInvitation(id) {
    return run(function (client) {
      var orgId = requireOrg();
      return client.from("invitations").delete().eq("org_id", orgId).eq("id", id).then(unwrap);
    });
  }

