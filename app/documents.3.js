    (function () {
      "use strict";
      var app = null;
      var state = { items: [], attachments: {}, file: null, fields: null, tracker: null, kind: "", search: "", papers: null, pendingKind: null, wantedKind: null };
      var PDF_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      var PDF_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      var KINDS = ["commercial_register","articles_of_association","bylaws","chamber_certificate","gosi_certificate","zakat_certificate","saudization_certificate","vat_certificate","license","lease_contract","contract","case_filing","court_ruling","hearing_notice","violation","invoice","power_of_attorney","id_document","passport","driving_license","vehicle_registration","insurance_policy","employment_contract","other"];
      var TRACKER_NAME = { ar: "المستندات", en: "Documents", fr: "Documents", ur: "دستاویزات" };

      function $(id) { return document.getElementById(id); }
      function t(key) { if (app && app.t) return app.t(key); var d = translations[lang()] || translations.ar; return d[key] || translations.ar[key] || key; }
      function esc(s) { return app && app.escapeHtml ? app.escapeHtml(s) : String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]; }); }
      function show(id, on) { var el = $(id); if (el) el.hidden = !on; }
      function setStatus(text, kind) { var el = $("docStatus"); el.textContent = text || ""; el.className = "waitlist-msg" + (kind ? " " + kind : ""); el.hidden = !text; }
      function kindLabel(k) { return t("kind_" + (KINDS.indexOf(k) !== -1 ? k : "other")); }

      /* ---------- قراءة الملف ---------- */
      function loadScript(src) {
        return new Promise(function (resolve, reject) {
          if (window.pdfjsLib) { resolve(); return; }
          var s = document.createElement("script"); s.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
        });
      }
      /* الصور تصغر إلى 1800px كحد أقصى قبل الإرسال: صور الجوال الكبيرة كانت تفشل القراءة */
      function fileToBase64(file) {
        return new Promise(function (resolve, reject) {
          var r = new FileReader(); r.onload = function () { resolve(String(r.result)); }; r.onerror = reject; r.readAsDataURL(file);
        }).then(function (dataUrl) {
          return new Promise(function (resolve) {
            var img = new Image();
            img.onload = function () {
              var MAX = 1800, w = img.width, h = img.height;
              if (w <= MAX && h <= MAX) { resolve(dataUrl); return; }
              var k = Math.min(MAX / w, MAX / h);
              var c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
              c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
              resolve(c.toDataURL("image/jpeg", 0.85));
            };
            img.onerror = function () { resolve(dataUrl); };
            img.src = dataUrl;
          });
        });
      }
      function pdfToText(file) {
        return loadScript(PDF_SRC).then(function () {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
          return file.arrayBuffer();
        }).then(function (buf) {
          return window.pdfjsLib.getDocument({ data: buf }).promise;
        }).then(function (pdf) {
          var pages = Math.min(pdf.numPages, 6), chain = Promise.resolve(""), text = "";
          for (var p = 1; p <= pages; p++) {
            (function (n) {
              chain = chain.then(function () { return pdf.getPage(n); })
                .then(function (page) { return page.getTextContent(); })
                .then(function (tc) { text += tc.items.map(function (i) { return i.str; }).join(" ") + "\n"; });
            })(p);
          }
          return chain.then(function () { return { text: text.trim(), pdf: pdf }; });
        });
      }
      function pdfPageImage(pdf, n) {
        return pdf.getPage(n).then(function (page) {
          var base = page.getViewport({ scale: 1 });
          var scale = Math.min(2, 1800 / Math.max(base.width, base.height));
          var vp = page.getViewport({ scale: scale });
          var canvas = document.createElement("canvas"); canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
          var ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
          return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () { return canvas.toDataURL("image/jpeg", 0.85); });
        });
      }
      function pdfFirstPageImage(pdf) { return pdfPageImage(pdf, 1); }
      var ERROR_TEXT = { ar: { unauthorized: "انتهت الجلسة، سجل الدخول من جديد.", rate_limited: "طلبات كثيرة، انتظر دقيقة ثم أعد المحاولة.", ai_unavailable: "خدمة القراءة غير متاحة الآن.", no_text: "لم يقرأ نص من الملف. جرب صورة أوضح.", image_read_failed: "تعذرت قراءة الصورة.", extract_failed: "قرئ النص لكن تعذر فهم المستند." },
                         en: { unauthorized: "Session expired, sign in again.", rate_limited: "Too many requests, wait a minute and try again.", ai_unavailable: "Reading service unavailable.", no_text: "No text could be read. Try a clearer image.", image_read_failed: "Could not read the image.", extract_failed: "Text was read but the document could not be understood." } };
      function errorText(code) { var d = ERROR_TEXT[lang()] || ERROR_TEXT.ar; return d[code] || (ERROR_TEXT.ar[code]) || ""; }

      function analyze(payload) {
        return window.trackerAuth.getSession().then(function (session) {
          var jwt = session && session.access_token;
          var headers = { "Content-Type": "application/json" };
          if (jwt) headers.Authorization = "Bearer " + jwt;
          return fetch("/api/documents/analyze", { method: "POST", headers: headers, body: JSON.stringify(payload) });
        }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "analyze"); return d.fields; }); });
      }

      function isSheetFile(file) {
        var ext = String(file.name || "").split(".").pop().toLowerCase();
        var known = (window.trackerImport && window.trackerImport.extensions) || ["xlsx", "xlsm", "xls", "csv", "tsv", "txt", "json"];
        return known.indexOf(ext) !== -1;
      }

      function handleFile(file) {
        if (!file) return;
        /* جدول بيانات يذهب إلى الاستيراد، والمستند يقرأ ويحفظ: منطقة رفع واحدة تكفي */
        if (isSheetFile(file)) {
          state.pendingKind = null;
          setStatus("");
          show("docForm", false);
          if (window.trackerImport && window.trackerImport.accept) {
            window.trackerImport.accept(file);
            var flow = $("importFlow");
            if (flow) { flow.hidden = false; try { flow.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { /* ignore */ } }
          } else {
            setStatus(t("libMissing"), "error");
          }
          $("docFile").value = "";
          return;
        }
        state.file = file;
        var wantedKind = state.pendingKind; state.pendingKind = null;
        state.wantedKind = wantedKind;
        show("docForm", false);
        setStatus(t("docReading"));
        var isPdf = /pdf$/i.test(file.name) || file.type === "application/pdf";
        /* PDF نصي → النص؛ PDF ممسوح أو صورة → OCR للصفحة الأولى، وإن لم تكف فالثانية */
        var work = isPdf
          ? pdfToText(file).then(function (r) {
              if (r.text.length >= 60) return analyze({ text: r.text });
              setStatus(t("docOcr"));
              return pdfFirstPageImage(r.pdf).then(function (img) { return analyze({ image: img }); })
                .catch(function (e) {
                  if (r.pdf.numPages < 2) throw e;
                  return pdfPageImage(r.pdf, 2).then(function (img) { return analyze({ image: img }); });
                });
            })
          : fileToBase64(file).then(function (img) { setStatus(t("docOcr")); return analyze({ image: img }); });
        work.then(function (fields) {
          state.fields = fields;
          fillForm(fields);
          setStatus(t("docReady"), "success");
          show("docForm", true);
          return applyToOrg(fields);
        }).catch(function (err) {
          var why = errorText(err && err.message);
          setStatus(t("docFailed") + (why ? " — " + why : ""), "error");
        });
      }

      /* ---------- الورقة الرسمية تبني المنشأة بنفسها ---------- */
      /* السجل التجاري يعني شركة، ووثيقة العمل الحر تعني عملا حرا: لا سؤال ولا خطوة. */
      var ORG_FROM_DOC = {
        commercial_register: { entity: "company", field: "cr_number" },
        articles_of_association: { entity: "company", field: null },
        vat_certificate: { entity: null, field: "vat_number" },
        license: { entity: "freelance", field: "license_number" }
      };

      function applyToOrg(f) {
        var map = f && ORG_FROM_DOC[f.kind];
        if (!map) return null;
        var name = String((f.party || "") || "").trim();
        var nameEn = String(f.party_en || "").trim();
        var number = String(f.number || "").trim();

        /* لا شركة بعد؟ الورقة نفسها تنشئها. */
        if (!app.org) {
          if ((!name && !nameEn) || !map.entity) return null;
          return app.createOrg(name, map.entity, map.entity === "company" ? number : "", f.expiry_date || null, nameEn)
            .then(function (org) {
              toast(fmtOne("orgCreatedFromDoc", org.name), "success");
              return saveProfileFields(f, map, name, number);
            })
            .catch(function () { return null; });
        }
        return saveProfileFields(f, map, name, number);
      }

      /* تملأ الحقول الفارغة فقط: ما أدخله المستخدم لا يمس */
      function saveProfileFields(f, map, name, number) {
        return app.orgProfile().then(function (current) {
          var have = current || {};
          var patch = {};
          if (map.field && number && !have[map.field]) patch[map.field] = number;
          if (name && !have.legal_name) patch.legal_name = name;
          if (nameEn && !have.legal_name_en) patch.legal_name_en = nameEn;
          if (!Object.keys(patch).length) return null;
          return app.saveOrgProfile(patch).then(function () {
            toast(t("orgProfileFilled"), "success");
            return loadPapers();
          });
        }).catch(function () { return null; });
      }

      function fmtOne(key, value) { return String(t(key)).replace("{name}", value == null ? "" : value); }

      function fillForm(f) {
        var wanted = state.wantedKind; state.wantedKind = null;
        var kind = (wanted && KINDS.indexOf(wanted) !== -1) ? wanted : (KINDS.indexOf(f.kind) !== -1 ? f.kind : "other");
        $("fKind").value = kind;
        $("fTitle").value = f.title || (f.number ? kindLabel(kind) + " " + f.number : kindLabel(kind));
        $("fNumber").value = f.number || "";
        $("fIssuer").value = f.issuer || "";
        $("fParty").value = f.party || "";
        $("fPartyEn").value = f.party_en || "";
        $("fIssue").value = f.issue_date || "";
        $("fExpiry").value = f.expiry_date || "";
        $("fAmount").value = f.amount != null ? f.amount : "";
        $("fCase").value = f.case_number || "";
        $("fCourt").value = f.court || "";
        $("fSummary").textContent = f.summary || "";
      }

      /* ---------- الحفظ: عنصر متابع + مرفق ---------- */
      function ensureTracker() {
        if (state.tracker) return Promise.resolve(state.tracker);
        return app.listTrackers().then(function (list) {
          var names = Object.keys(TRACKER_NAME).map(function (k) { return TRACKER_NAME[k]; });
          var found = (list || []).filter(function (tr) { return names.indexOf(tr.name) !== -1; })[0];
          if (found) { state.tracker = found; return found; }
          return app.createTracker({ name: TRACKER_NAME[lang()] || TRACKER_NAME.ar }).then(function (tr) {
            state.tracker = tr;
            /* انتهاء الترخيص يجب أن ينبه قبل شهر وقبل أسبوع، لا قبل يوم واحد */
            return Promise.all([
              app.saveRule({ tracker_id: tr.id, offset_minutes: 43200, channels: ["telegram"], target: "all" }),
              app.saveRule({ tracker_id: tr.id, offset_minutes: 10080, channels: ["telegram"], target: "all" })
            ]).catch(function () { return null; }).then(function () { return tr; });
          });
        });
      }

      function save(ev) {
        ev.preventDefault();
        if (!state.file) return;
        var btn = $("docSaveBtn"); btn.disabled = true;
        setStatus(t("docSaving"));
        var kind = $("fKind").value;
        var expiry = $("fExpiry").value ? new Date($("fExpiry").value + "T09:00:00").toISOString() : null;
        var amount = parseFloat($("fAmount").value); if (!isFinite(amount)) amount = null;
        ensureTracker().then(function (tr) {
          var row = {
            tracker_id: tr.id,
            title: String($("fTitle").value || "").trim() || kindLabel(kind),
            due_at: expiry,
            status: "open",
            category: kindLabel(kind),
            amount: amount,
            client_name: String($("fParty").value || "").trim() || null,
            client_name_en: String($("fPartyEn").value || "").trim() || null,
            case_number: String($("fCase").value || "").trim() || null,
            data: {
              document_kind: kind,
              number: String($("fNumber").value || "").trim() || null,
              issuer: String($("fIssuer").value || "").trim() || null,
              issue_date: $("fIssue").value || null,
              court: String($("fCourt").value || "").trim() || null,
              summary: $("fSummary").textContent || null
            }
          };
          return app.insertItems([row]);
        }).then(function (inserted) {
          var id = inserted && inserted[0] && inserted[0].id;
          if (!id) throw new Error("insert");
          if (state.driveDoc) {
            return app.attachDriveFiles(id, [state.driveDoc]).then(function () { return true; })
              .catch(function () { return false; });
          }
          return app.uploadAttachment(id, state.file).then(function () { return true; })
            .catch(function (err) {
              state.fileError = String((err && (err.message || err.code)) || "upload");
              return false;
            });
        }).then(function (stored) {
          /* الملف أهم من السطر: لا نقول «حُفظ» ما لم يُخزَّن فعلا */
          if (stored === false) {
            var code = state.fileError || ""; state.fileError = null;
            setStatus(code.indexOf("PLAN_LIMIT_STORAGE") !== -1 ? t("docStorageLimit") : t("docFileFailed"), "error");
            show("docForm", false);
            state.file = null; state.driveDoc = null; $("docFile").value = "";
            return loadAll();
          }
          setStatus(t("docSaved"), "success");
          show("docForm", false);
          state.file = null; state.driveDoc = null; $("docFile").value = "";
          return loadAll();
        }).catch(function () { setStatus(t("docFailed"), "error"); })
          .finally(function () { btn.disabled = false; });
      }

      /* ---------- القائمة ---------- */
      function daysLeft(iso) {
        if (!iso) return null;
        return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
      }
      function render() {
        var rows = state.items.filter(function (it) {
          var d = it.data || {};
          if (state.kind && d.document_kind !== state.kind) return false;
          if (state.search) {
            var hay = ((it.title || "") + " " + (d.number || "") + " " + (it.client_name || "")).toLowerCase();
            if (hay.indexOf(state.search.toLowerCase()) === -1) return false;
          }
          return true;
        });
        var body = $("docsBody"); body.innerHTML = "";
        show("docsWrap", rows.length > 0); show("docsEmpty", rows.length === 0);
        rows.forEach(function (it) {
          var d = it.data || {}; var left = daysLeft(it.due_at);
          var leftText = left == null ? "-" : (left < 0 ? t("docExpired") : (left + " " + t("docDays")));
          var cls = left == null ? "" : (left < 0 ? "status-overdue" : (left <= 30 ? "status-open" : ""));
          var files = state.attachments[it.id] || [];
          var tr = document.createElement("tr");
          tr.innerHTML =
            "<td>" + esc(kindLabel(d.document_kind)) + "</td>" +
            '<td><span class="item-title" data-tr>' + esc(it.title) + "</span></td>" +
            '<td dir="ltr">' + esc(d.number || "-") + "</td>" +
            '<td data-tr>' + esc((app.clientDisplayName ? app.clientDisplayName(it) : it.client_name) || "-") + "</td>" +
            "<td>" + (it.due_at ? esc(app.fmtDate(it.due_at)) : "-") + "</td>" +
            '<td><span class="' + cls + '">' + esc(leftText) + "</span></td>" +
            "<td>" + (files.length
              ? files.map(function (a) {
                  return '<span class="file-row"><a href="#" data-open="' + esc(a.id) + '" title="' + esc(a.name) + '">' + esc(a.name) + "</a>" +
                         '<button type="button" class="chat-option-btn file-get" data-get="' + esc(a.id) + '" title="' + esc(t("pDownload")) + '">' + esc(t("pDownload")) + "</button></span>";
                }).join("")
              : "-") + "</td>" +
            '<td><div class="chat-options row-actions">' +
              '<button type="button" class="chat-option-btn" data-attach="' + esc(it.id) + '">' + esc(t(files.length ? "docAddAnother" : "docAttachFile")) + "</button>" +
              '<button type="button" class="chat-option-btn is-danger" data-del="' + esc(it.id) + '">' + esc(t("delete")) + "</button>" +
            "</div></td>";
          body.appendChild(tr);
        });
        if (app.translateNodes) app.translateNodes($("listCard"));
      }
      /* ---------- الأوراق الرسمية: ما تحتاجه كل منشأة، وما ينقصها ---------- */
      var PAPER_STATE = { missing: { key: "pMissing", cls: "status-overdue" }, expired: { key: "pExpired", cls: "status-overdue" },
        expiring: { key: "pExpiring", cls: "status-open" }, valid: { key: "pValid", cls: "status-done" },
        stored: { key: "pStored", cls: "" } };

      /* ملف الورقة المحفوظ: أول مرفق للعنصر الذي تمثله */
      function paperFile(p) {
        if (!p || !p.item_id) return null;
        var list = state.attachments[p.item_id] || [];
        return list.length ? list[0] : null;
      }

      function attachmentById(id) {
        var found = null;
        Object.keys(state.attachments).forEach(function (k) {
          state.attachments[k].forEach(function (a) { if (a.id === id) found = a; });
        });
        return found;
      }

      function renderPapers() {
        var data = state.papers;
        if (!data || !data.papers || !data.papers.length) { show("papersCard", false); return; }
        show("papersCard", true);
        var counts = { valid: 0, expiring: 0, expired: 0, missing: 0 };
        data.papers.forEach(function (p) {
          if (p.state === "missing") { if (p.required) counts.missing += 1; }
          else if (p.state === "expired") counts.expired += 1;
          else if (p.state === "expiring") counts.expiring += 1;
          else counts.valid += 1;
        });
        $("papersStats").innerHTML = [
          ["pStatValid", counts.valid, ""], ["pStatExpiring", counts.expiring, "status-open"],
          ["pStatExpired", counts.expired, "status-overdue"], ["pStatMissing", counts.missing, "status-overdue"]
        ].map(function (c) {
          /* نفس ترتيب بطاقات الموقع: التسمية أولا ثم الرقم تحتها */
          return '<div class="platform-stat-card"><h3 class="platform-stat-label">' + esc(t(c[0])) +
                 '</h3><span class="platform-stat-value ' + c[2] + '">' + c[1] + "</span></div>";
        }).join("");

        var body = $("papersBody"); body.innerHTML = "";
        data.papers.forEach(function (p) {
          var st = PAPER_STATE[p.state] || PAPER_STATE.stored;
          var left = p.days_left == null ? "-" : (p.days_left < 0 ? t("docExpired") : (p.days_left + " " + t("docDays")));
          var tr = document.createElement("tr");
          tr.innerHTML =
            '<td><div class="cell-stack"><span class="item-title">' + esc(kindLabel(p.kind)) + "</span>" +
              '<span class="item-cat">' + esc(t(p.required ? "pRequired" : "pOptional")) + "</span></div></td>" +
            '<td dir="ltr">' + esc(p.number || "-") + "</td>" +
            "<td>" + (p.expires_at ? esc(app.fmtDate(p.expires_at)) : "-") + "</td>" +
            '<td><span class="' + st.cls + '">' + esc(p.state === "missing" ? "-" : left) + "</span></td>" +
            '<td><span class="' + st.cls + '">' + esc(t(st.key)) + "</span></td>" +
            '<td><div class="chat-options row-actions">' +
              (paperFile(p) ? '<button type="button" class="chat-option-btn" data-paper-open="' + esc(paperFile(p).id) + '">' + esc(t("pOpen")) + "</button>" +
                              '<button type="button" class="chat-option-btn" data-paper-get="' + esc(paperFile(p).id) + '">' + esc(t("pDownload")) + "</button>" : "") +
              (p.item_id && !paperFile(p)
                ? '<button type="button" class="chat-option-btn" data-paper-attach="' + esc(p.item_id) + '">' + esc(t("docAttachFile")) + "</button>"
                : '<button type="button" class="chat-option-btn" data-paper-add="' + esc(p.kind) + '">' +
                    esc(t(p.state === "missing" ? "pAdd" : "docReplace")) + "</button>") +
            "</div></td>";
          body.appendChild(tr);
        });
      }

      function loadPapers() {
        return app.orgDocumentsStatus().then(function (d) {
          state.papers = d && d.papers ? d : null;
          renderPapers();
        }).catch(function () { show("papersCard", false); });
      }

      /* رسمة واحدة: الجدول وبطاقة الأوراق يظهران معا بعد وصول بياناتهما */
      function loadAll() {
        return Promise.all([
          app.listItems({}),
          app.listAttachments(null),
          app.orgDocumentsStatus().catch(function () { return null; })
        ]).then(function (res) {
          state.items = (res[0] || []).filter(function (it) { return it.data && it.data.document_kind; });
          state.attachments = {};
          (res[1] || []).forEach(function (a) { if (a.item_id) (state.attachments[a.item_id] = state.attachments[a.item_id] || []).push(a); });
          state.papers = res[2] && res[2].papers ? res[2] : null;
          render();
          renderPapers();
        });
      }

      function loadDocs() {
        return Promise.all([app.listItems({}), app.listAttachments(null)]).then(function (res) {
          state.items = (res[0] || []).filter(function (it) { return it.data && it.data.document_kind; });
          state.attachments = {};
          (res[1] || []).forEach(function (a) { if (a.item_id) (state.attachments[a.item_id] = state.attachments[a.item_id] || []).push(a); });
          render();
        });
      }

      function renderKindSelects() {
        var opts = KINDS.map(function (k) { return '<option value="' + k + '">' + esc(kindLabel(k)) + "</option>"; }).join("");
        $("fKind").innerHTML = opts;
        $("filterKind").innerHTML = '<option value="">' + esc(t("allKinds")) + "</option>" + opts;
      }

      function wire() {
        $("docChooseBtn").addEventListener("click", function () { $("docFile").click(); });

        /* Google Drive: الملف يبقى في درايف المستخدم، ننزله ليقرأه المحلل ونربط رابطه بالعنصر. */
        function syncDriveBtn() {
          var b = $("docDriveBtn");
          if (b) b.hidden = !(app && app.driveAvailable && app.driveAvailable());
        }
        document.addEventListener("tracker:drive", syncDriveBtn);
        syncDriveBtn();
        $("docDriveBtn").addEventListener("click", function () {
          var btn = this; btn.disabled = true;
          setStatus(t("docReading"));
          app.pickFromDrive({ multi: false }).then(function (docs) {
            var picked = docs && docs[0];
            if (!picked) throw new Error("cancelled");
            return app.driveDownload(picked).then(function (file) {
              state.driveDoc = picked;
              handleFile(file);
            });
          }).catch(function (err) {
            state.driveDoc = null;
            setStatus(String((err && err.message) || "") === "cancelled" ? "" : t("docDriveFailed"),
                      String((err && err.message) || "") === "cancelled" ? "" : "error");
          }).finally(function () { btn.disabled = false; });
        });
        $("docFile").addEventListener("change", function () { state.driveDoc = null; handleFile(this.files && this.files[0]); });
        var dz = $("docDrop");
        dz.addEventListener("dragover", function (e) { e.preventDefault(); dz.classList.add("is-over"); });
        dz.addEventListener("dragleave", function () { dz.classList.remove("is-over"); });
        dz.addEventListener("drop", function (e) { e.preventDefault(); dz.classList.remove("is-over"); handleFile(e.dataTransfer.files && e.dataTransfer.files[0]); });
        $("docForm").addEventListener("submit", save);
        $("docCancelBtn").addEventListener("click", function () { show("docForm", false); state.file = null; state.driveDoc = null; $("docFile").value = ""; setStatus(""); });
        $("filterKind").addEventListener("change", function () { state.kind = this.value; render(); });
        $("filterSearch").addEventListener("input", function () { state.search = this.value.trim(); render(); });
        $("papersBody").addEventListener("click", function (e) {
          var btn = e.target.closest("[data-paper-add]");
          if (!btn) return;
          e.preventDefault();
          state.pendingKind = btn.getAttribute("data-paper-add");
          $("docFile").click();
        });
        $("papersBody").addEventListener("click", function (e) {
          var pat = e.target.closest("[data-paper-attach]");
          if (pat) {
            e.preventDefault();
            var picker = $("docAttachInput");
            picker.dataset.item = pat.dataset.paperAttach;
            picker.click();
            return;
          }
          var open = e.target.closest("[data-paper-open]"), get = e.target.closest("[data-paper-get]");
          if (!open && !get) return;
          e.preventDefault();
          var att = attachmentById((open || get).getAttribute(open ? "data-paper-open" : "data-paper-get"));
          if (!att) return;
          /* النافذة تفتح مع النقرة لا بعد الوعد: سفاري يحجب ما يفتح لاحقا */
          var win = open ? window.open("about:blank", "_blank") : null;
          app.attachmentUrl(att, open ? undefined : { download: att.name || true }).then(function (u) {
            if (!u) { if (win) win.close(); return; }
            if (open) { if (win) win.location = u; else window.location.assign(u); return; }
            var a = document.createElement("a");
            a.href = u; a.download = att.name || "document"; a.rel = "noopener";
            document.body.appendChild(a); a.click(); a.remove();
          }).catch(function () { if (win) win.close(); setStatus(t("docFailed"), "error"); });
        });
        $("docAttachInput").addEventListener("change", function () {
          var file = this.files && this.files[0];
          var itemId = this.dataset.item;
          this.value = "";
          if (!file || !itemId) return;
          setStatus(t("docSaving"));
          app.uploadAttachment(itemId, file).then(function () {
            setStatus(t("docFileAdded"), "success");
            return loadAll();
          }).catch(function (err) {
            var code = String((err && (err.message || err.code)) || "");
            setStatus(code.indexOf("PLAN_LIMIT_STORAGE") !== -1 ? t("docStorageLimit") : t("docFileFailed"), "error");
          });
        });
        $("docsBody").addEventListener("click", function (e) {
          var at = e.target.closest("[data-attach]");
          if (at) {
            e.preventDefault();
            var picker = $("docAttachInput");
            picker.dataset.item = at.dataset.attach;
            picker.click();
            return;
          }
          var g = e.target.closest("[data-get]");
          if (g) {
            e.preventDefault();
            var gatt = attachmentById(g.dataset.get);
            if (!gatt) return;
            app.attachmentUrl(gatt, { download: gatt.name || true }).then(function (u) {
              if (!u) return;
              var link = document.createElement("a");
              link.href = u; link.download = gatt.name || "document"; link.rel = "noopener";
              document.body.appendChild(link); link.click(); link.remove();
            }).catch(function () { setStatus(t("docFailed"), "error"); });
            return;
          }
          var o = e.target.closest("[data-open]"), d = e.target.closest("[data-del]");
          if (o) {
            e.preventDefault();
            var att = null; Object.keys(state.attachments).forEach(function (k) { state.attachments[k].forEach(function (a) { if (a.id === o.dataset.open) att = a; }); });
            if (att) {
              var w = window.open("about:blank", "_blank");
              app.attachmentUrl(att).then(function (u) {
                if (!u) { if (w) w.close(); return; }
                if (w) w.location = u; else window.location.assign(u);
              }).catch(function () { if (w) w.close(); });
            }
          } else if (d) {
            if (!window.confirm(t("docDeleteConfirm"))) return;
            app.deleteItem(d.dataset.del).then(loadDocs).catch(function () { setStatus(t("docFailed"), "error"); });
          }
        });
      }

      window.__docsRefresh = function () { renderKindSelects(); render(); renderPapers(); };

      function boot() {
        app = window.trackerApp;
        if (!app || !app.ready) { show("loadingCard", false); show("unavailableCard", true); return; }
        app.ready.then(function (res) {
          show("loadingCard", false);
          if (!res || res.unavailable || app.unavailable) { show("unavailableCard", true); return; }
          if (!app.org) { show("noOrgCard", true); return; }
          renderKindSelects(); wire();
          show("docsView", true);
          return loadAll();
        }).catch(function () { show("loadingCard", false); show("unavailableCard", true); });
      }
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
    })();
  