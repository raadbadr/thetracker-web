    /* ============================================================
     * Excel import flow (uses window.trackerApp from /app/common.js
     * and SheetJS from cdnjs). Runs after the deferred scripts.
     * ============================================================ */
    (function () {
      "use strict";

      const NEW_TheTracker = "__new__";
      const MAX_PREVIEW = 20;
      const CHUNK = 200;
      const MAX_UNMATCHED_LISTED = 10;
      const ALLOWED_EXT = ["xlsx", "xlsm", "xls", "csv", "tsv", "txt", "json"];

      /* Mapping fields; keyword lists are matched against normalised header names
         (exact match first, then substring) — each header is used at most once. */
      const FIELDS = [
        { key: "title",    labelKey: "mapTitle",    required: true,
          keywords: ["title", "عنوان", "العنوان", "name", "اسم", "الاسم", "subject", "موضوع", "الموضوع", "titre", "nom", "objet"] },
        { key: "due",      labelKey: "mapDue",      required: true,
          keywords: ["تاريخ المخالفة", "تاريخ الجلسة القادمة", "تاريخ الجلسة", "تاريخ الدعوى", "due date", "due", "تاريخ الاستحقاق", "استحقاق", "الاستحقاق", "expiry", "expiry date", "expire", "expires", "انتهاء", "الانتهاء", "تاريخ الانتهاء", "deadline", "date", "تاريخ", "التاريخ", "échéance", "echeance", "تاریخ"] },
        { key: "category", labelKey: "mapCategory", required: false,
          keywords: ["category", "تصنيف", "التصنيف", "type", "نوع", "النوع", "فئة", "الفئة", "catégorie", "categorie", "زمرہ"] },
        { key: "assignee", labelKey: "mapAssignee", required: false,
          keywords: ["assignee", "assignee email", "email", "e-mail", "بريد", "البريد", "البريد الإلكتروني", "مسؤول", "المسؤول", "responsable", "courriel", "ای میل"] },
        { key: "amount",   labelKey: "mapAmount",   required: false,
          keywords: ["مبلغ المخالفة", "المبلغ", "مبلغ", "قيمة", "amount", "fine", "value", "montant"] },
        { key: "client",   labelKey: "mapClient",   required: false,
          keywords: ["الشركة", "العميل", "الجهة", "المدعى عليه", "client", "company", "entreprise"] },
        { key: "casenum",  labelKey: "mapCaseNumber", required: false,
          keywords: ["رقم الدعوى", "رقم القضية", "رقم الدعوي", "case number", "case no", "numéro de dossier"] },
        { key: "vnumber",  labelKey: "mapVNumber",  required: false,
          keywords: ["رقم المخالفة", "رقم مخالفة", "المخالفة", "violation number", "violation no", "ticket", "ticket number", "fine number", "numéro d'infraction"] },
        { key: "location", labelKey: "mapLocation", required: false,
          keywords: ["جهة اصدار المخالفة", "جهة الإصدار", "الموقع", "موقع", "المكان", "المدينة", "location", "place", "site", "lieu", "مقام"] },
        { key: "status",   labelKey: "mapStatus",   required: false,
          keywords: ["status", "حالة", "الحالة", "statut", "état", "etat", "حالت"] }
      ];

      const DONE_VALUES = ["done", "completed", "complete", "finished", "closed", "closed.", "yes",
                           "منجز", "منجزة", "مكتمل", "مكتملة", "تم", "تمت", "مغلق", "مغلقة", "منتهي", "منتهية",
                           "terminé", "terminée", "termine", "terminee", "fait", "faite", "fermé", "ferme",
                           "مکمل", "ہو گیا", "بند"];

      const state = {
        mode: "general",
        client: "",
        file: null,
        fileBase: "",
        workbook: null,
        sheetName: "",
        headers: [],
        rows: [],
        mapping: { title: -1, due: -1, category: -1, assignee: -1, status: -1 },
        trackers: [],
        memberByEmail: {},
        limits: {},
        importsUsed: 0,
        itemsCount: 0,
        analysis: null,
        busy: false,
        result: null
      };

      let els = {};

      /* ---------- small helpers ---------- */

      function $(id) { return document.getElementById(id); }

      function esc(s) {
        return String(s === null || s === undefined ? "" : s)
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      }

      function show(el, on) { if (el) el.hidden = !on; }

      function setMsg(el, text, kind) {
        if (!el) return;
        el.textContent = text || "";
        el.className = "waitlist-msg" + (kind ? " " + kind : "");
        el.hidden = !text;
      }

      function toast(message, kind) {
        if (window.trackerApp && typeof trackerApp.toast === "function") trackerApp.toast(message, kind);
      }

      function nonEmpty(v) {
        return !(v === null || v === undefined || (typeof v === "string" && v.trim() === ""));
      }

      function cellText(v) {
        if (v === null || v === undefined) return "";
        if (v instanceof Date) return isNaN(v.getTime()) ? "" : trackerApp.fmtDate(v);
        return String(v).trim();
      }

      /* Value stored in item.data for unmapped columns. */
      function cellValue(v) {
        if (!nonEmpty(v)) return null;
        if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
        if (typeof v === "string") return v.trim();
        return v;
      }

      function normHeader(s) {
        return String(s || "").toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
      }

      /* Enumeration comma that follows the active language. */
      function listSep() { return (l === "ar" || l === "ur") ? "، " : ", "; }

      function limitOf(v) {
        if (v === null || v === undefined || v === "") return null;
        const n = Number(v);
        return isNaN(n) ? null : n;
      }

      /* القالب: رأس بأسماء الحقول بلغة الصفحة وصف مثال */
      function downloadTemplate() {
        const heads = FIELDS.map((f) => t(f.labelKey));
        const sample = ["مثال: جلسة محكمة", new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), "قضية", "", "0", "", "", "", "", "open"];
        const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
        const csv = "\ufeff" + heads.map(q).join(",") + "\r\n" + sample.map(q).join(",") + "\r\n";
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        a.download = "thetracker-template.csv";
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      }

      function fileExt(name) {
        const m = String(name || "").match(/\.([^.]+)$/);
        return m ? m[1].toLowerCase() : "";
      }

      /* ---------- reading the workbook ---------- */

      function readFile(file) {
        if (!file) return;
        const ext = fileExt(file.name);
        if (ALLOWED_EXT.indexOf(ext) === -1) { setMsg(els.fileStatus, t("unsupportedType"), "error"); return; }
        if (typeof XLSX === "undefined") { setMsg(els.fileStatus, t("libMissing"), "error"); return; }
        setMsg(els.fileStatus, t("readingFile"));

        const reader = new FileReader();
        reader.onerror = function () { setMsg(els.fileStatus, t("readError"), "error"); };
        reader.onload = function () {
          try {
            let wb;
            if (ext === "json") {
              /* JSON: مصفوفة كائنات، أو {rows|items|data: [...]} — تتحول إلى ورقة فيمر بالمسار نفسه */
              const body = JSON.parse(String(reader.result || "").replace(/^\ufeff/, ""));
              const rows = Array.isArray(body) ? body : (body.rows || body.items || body.data || []);
              if (!Array.isArray(rows) || !rows.length) throw new Error("no rows");
              wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((r) => (r && typeof r === "object") ? r : { title: String(r) })), "data");
            } else if (ext === "csv" || ext === "tsv" || ext === "txt") {
              wb = XLSX.read(reader.result, { type: "string", raw: true });
            } else {
              wb = XLSX.read(new Uint8Array(reader.result), { type: "array", cellDates: true });
            }
            if (!wb || !wb.SheetNames || !wb.SheetNames.length) throw new Error("no sheets");
            state.file = file;
            state.fileBase = file.name.replace(/\.[^.]+$/, "");
            state.workbook = wb;
            state.result = null;
            state.sheetName = wb.SheetNames[0];
            els.trackerName.value = state.fileBase;
            renderSheetSelect();
            selectSheet(state.sheetName);
          } catch (e) {
            setMsg(els.fileStatus, t("readError"), "error");
          }
        };
        if (ext === "csv" || ext === "tsv" || ext === "txt" || ext === "json") reader.readAsText(file, "UTF-8");
        else reader.readAsArrayBuffer(file);
      }

      /* أوراق التقارير الحقيقية تبدأ بملخص تنفيذي فوق الجدول، فنبحث عن صف العناوين
         الحقيقي: أكثر صف يحمل عناوين نصية معروفة ويتبعه صف بيانات. */
      const HEADER_HINTS = ["رقم المخالفة", "تاريخ المخالفة", "مبلغ المخالفة", "نوع المخالفة", "حالة التظلم",
                            "رقم القضية", "رقم الدعوى", "المدعي", "المدعى عليه", "المحكمة", "الدائرة",
                            "الجهة القضائية", "المحامي", "التاريخ", "الوقت", "تاريخ الجلسة", "تاريخ الحكم",
                            "title", "due", "date", "amount"];

      function headerScore(row, next) {
        if (!row) return -1;
        let textCells = 0, hints = 0;
        row.forEach(function (cell) {
          const v = cellText(cell);
          if (!v) return;
          if (typeof cell === "number") return;
          textCells++;
          const low = v.toLowerCase();
          for (let i = 0; i < HEADER_HINTS.length; i++) {
            if (low.indexOf(HEADER_HINTS[i].toLowerCase()) !== -1) { hints++; break; }
          }
        });
        if (textCells < 3) return -1;
        const nextFilled = next ? next.filter(nonEmpty).length : 0;
        if (nextFilled < 2) return -1;
        return hints * 10 + textCells;
      }

      /* صف العناوين قد يليه سطر فارغ قبل البيانات، فنبحث عن أول صف مملوء بعده. */
      function nextDataRow(aoa, i) {
        for (let k = i + 1; k <= i + 3 && k < aoa.length; k++) {
          if (aoa[k] && aoa[k].filter(nonEmpty).length >= 2) return aoa[k];
        }
        return null;
      }

      function parseSheet(ws) {
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
        let hi = -1;
        let best = -1;
        const scanTo = Math.min(aoa.length, 30);
        for (let i = 0; i < scanTo; i++) {
          const sc = headerScore(aoa[i], nextDataRow(aoa, i));
          if (sc > best) { best = sc; hi = i; }
        }
        if (hi === -1) {
          for (let i = 0; i < aoa.length; i++) if (aoa[i] && aoa[i].some(nonEmpty)) { hi = i; break; }
        }
        if (hi === -1) return { headers: [], rows: [] };

        const rawHeaders = aoa[hi];
        let width = rawHeaders.length;
        for (let r = hi + 1; r < aoa.length; r++) if (aoa[r] && aoa[r].length > width) width = aoa[r].length;

        const headers = [];
        const seen = {};
        for (let c = 0; c < width; c++) {
          let name = cellText(rawHeaders[c]) || (t("columnN") + " " + (c + 1));
          if (seen[name]) { seen[name] += 1; name = name + " (" + seen[name] + ")"; } else { seen[name] = 1; }
          headers.push(name);
        }

        const rows = [];
        for (let r = hi + 1; r < aoa.length; r++) {
          const src = aoa[r] || [];
          if (!src.some(nonEmpty)) continue;
          const row = new Array(width);
          for (let c = 0; c < width; c++) row[c] = c < src.length ? src[c] : null;
          rows.push(row);
        }
        return { headers: headers, rows: rows };
      }

      /* اسم الورقة يحدد النوع والعميل: "مخالفات بلدي - ابراج الكهرباء" ← مخالفات، العميل: ابراج الكهرباء */
      function sheetProfile(name) {
        const n = String(name || "");
        const dash = n.split(/\s[-–]\s/);
        const client = dash.length > 1 ? dash[dash.length - 1].trim() : "";
        let kind = "general";
        if (/مخالف/.test(n)) kind = "violations";
        else if (/جلسات|قضايا|دعاو/.test(n)) kind = "cases";
        return { kind: kind, client: client };
      }

      function selectSheet(name) {
        const ws = state.workbook && state.workbook.Sheets[name];
        state.sheetName = name;
        const profile = sheetProfile(name);
        state.client = profile.client;
        state.mode = profile.kind === "violations" ? "violations" : "general";
        if (els.importMode) els.importMode.value = state.mode;
        if (els.graceField) show(els.graceField, state.mode === "violations");
        const parsed = ws ? parseSheet(ws) : { headers: [], rows: [] };
        state.headers = parsed.headers;
        state.rows = parsed.rows;

        if (!state.headers.length || !state.rows.length) {
          setMsg(els.fileStatus, t("emptySheet"), "error");
          [els.step2, els.step3, els.step4, els.step5].forEach(function (s) { show(s, false); });
          return;
        }

        setMsg(els.fileStatus, fmt("fileLoaded", { name: state.file.name, rows: state.rows.length, cols: state.headers.length }), "success");
        guessMapping();
        renderPreview();
        renderMapping();
        renderTrackerSelect();
        analyzeAndRender();
        [els.step2, els.step3, els.step4, els.step5].forEach(function (s) { show(s, true); });
        show(els.summaryCard, false);
        setMsg(els.importProgress, "");
      }

      /* ---------- mapping ---------- */

      function guessMapping() {
        const names = state.headers.map(normHeader);
        const used = {};
        FIELDS.forEach(function (f) {
          let idx = -1;
          for (let k = 0; k < f.keywords.length && idx === -1; k++) {
            const kw = f.keywords[k];
            for (let j = 0; j < names.length; j++) if (!used[j] && names[j] === kw) { idx = j; break; }
          }
          for (let k = 0; k < f.keywords.length && idx === -1; k++) {
            const kw = f.keywords[k];
            for (let j = 0; j < names.length; j++) if (!used[j] && names[j].indexOf(kw) !== -1) { idx = j; break; }
          }
          state.mapping[f.key] = idx;
          if (idx !== -1) used[idx] = true;
        });
      }

      function analyze() {
        const m = state.mapping;
        const records = [];
        let skipped = 0;
        let unmatched = 0;
        const unmatchedEmails = {};
        const mappedIdx = {};
        Object.keys(m).forEach(function (k) { if (m[k] >= 0) mappedIdx[m[k]] = true; });

        const isViolations = state.mode === "violations";
        const graceDays = Math.max(1, Math.min(365, Number(els.graceDays && els.graceDays.value) || 30));

        state.rows.forEach(function (row) {
          let title = m.title >= 0 ? cellText(row[m.title]) : "";
          let due = m.due >= 0 ? trackerApp.parseExcelDate(row[m.due]) : null;
          const vnumber = m.vnumber >= 0 ? cellText(row[m.vnumber]) : "";
          const place = m.location >= 0 ? cellText(row[m.location]) : "";

          if (isViolations) {
            /* ورقة مخالفات: رقم المخالفة وتاريخها والموقع؛ الاستحقاق = التاريخ + مهلة السداد. */
            if (!vnumber || !due) { skipped++; return; }
            title = t("violationTitle").replace("{n}", vnumber) + (place ? " — " + place : "");
            const dueDate = new Date(due);
            dueDate.setDate(dueDate.getDate() + graceDays);
            due = dueDate.toISOString();
          } else if (!title || !due) { skipped++; return; }

          const rec = { title: title, due_at: due, category: isViolations ? "مخالفة" : null, status: "open", assignee_id: null, data: {} };

          /* المبلغ يجمع لاحقا في اللوحات، والعميل يأتي من العمود أو من اسم الورقة */
          if (m.amount >= 0) {
            const raw = String(cellText(row[m.amount]) || "").replace(/[^0-9.\-]/g, "");
            const num = parseFloat(raw);
            if (!isNaN(num)) rec.amount = num;
          }
          if (m.casenum >= 0) {
            const cn = cellText(row[m.casenum]);
            if (cn) rec.case_number = cn;
          }
          var clientName = m.client >= 0 ? cellText(row[m.client]) : "";
          if (!clientName && state.client) clientName = state.client;
          if (clientName) rec.client_name = clientName;
          if (isViolations) {
            rec.data.violation_number = vnumber;
            rec.data.violation_date = m.due >= 0 ? trackerApp.parseExcelDate(row[m.due]) : null;
            if (place) rec.data.location = place;
            rec.data.grace_days = graceDays;
          }
          if (m.category >= 0) rec.category = cellText(row[m.category]) || null;
          if (m.status >= 0) {
            const sv = cellText(row[m.status]).toLowerCase();
            if (sv && DONE_VALUES.indexOf(sv) !== -1) rec.status = "done";
          }
          if (m.assignee >= 0) {
            const email = cellText(row[m.assignee]).toLowerCase();
            if (email) {
              const uid = state.memberByEmail[email];
              if (uid) rec.assignee_id = uid;
              else { unmatched++; unmatchedEmails[email] = true; }
            }
          }
          state.headers.forEach(function (h, i) { if (!mappedIdx[i]) rec.data[h] = cellValue(row[i]); });
          records.push(rec);
        });

        return { records: records, skipped: skipped, unmatched: unmatched, unmatchedEmails: Object.keys(unmatchedEmails) };
      }

      function mappingForDb() {
        const out = { sheet: state.sheetName, columns: state.headers.slice() };
        FIELDS.forEach(function (f) {
          const idx = state.mapping[f.key];
          out[f.key] = idx >= 0 ? state.headers[idx] : null;
        });
        return out;
      }

      /* ---------- rendering ---------- */

      function renderSheetSelect() {
        const names = state.workbook ? state.workbook.SheetNames : [];
        els.sheetSelect.innerHTML = "";
        names.forEach(function (n) { els.sheetSelect.appendChild(new Option(n, n)); });
        els.sheetSelect.value = state.sheetName || names[0] || "";
        show(els.sheetRow, names.length > 1);
      }

      function renderPreview() {
        const head = "<thead><tr>" + state.headers.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") + "</tr></thead>";
        const body = "<tbody>" + state.rows.slice(0, MAX_PREVIEW).map(function (r) {
          return "<tr>" + state.headers.map(function (_h, i) { return "<td>" + esc(cellText(r[i])) + "</td>"; }).join("") + "</tr>";
        }).join("") + "</tbody>";
        els.previewTable.innerHTML = head + body;
        els.previewNote.textContent = fmt("previewNote", { shown: Math.min(MAX_PREVIEW, state.rows.length), total: state.rows.length });
      }

      function renderMapping() {
        els.mappingGrid.innerHTML = "";
        FIELDS.forEach(function (f) {
          const wrap = document.createElement("div");
          wrap.className = "field";
          const label = document.createElement("label");
          label.className = "field-label";
          label.htmlFor = "map_" + f.key;
          label.textContent = t(f.labelKey) + " (" + t(f.required ? "required" : "optional") + ")";
          const sel = document.createElement("select");
          sel.className = "waitlist-input";
          sel.id = "map_" + f.key;
          sel.disabled = state.busy;
          sel.appendChild(new Option(t("notMapped"), "-1"));
          state.headers.forEach(function (h, i) { sel.appendChild(new Option(h, String(i))); });
          sel.value = String(state.mapping[f.key]);
          sel.addEventListener("change", function () {
            state.mapping[f.key] = parseInt(sel.value, 10);
            if (isNaN(state.mapping[f.key])) state.mapping[f.key] = -1;
            analyzeAndRender();
          });
          wrap.appendChild(label);
          wrap.appendChild(sel);
          els.mappingGrid.appendChild(wrap);
        });
      }

      function renderTrackerSelect() {
        const sel = els.trackerSelect;
        const prev = sel.value;
        sel.innerHTML = "";
        sel.appendChild(new Option(t("newTracker"), NEW_TheTracker));
        state.trackers.forEach(function (tr) { sel.appendChild(new Option(tr.name, tr.id)); });
        let keep = NEW_TheTracker;
        for (let i = 0; i < sel.options.length; i++) if (sel.options[i].value === prev) { keep = prev; break; }
        sel.value = keep;
        toggleTrackerName();
      }

      function toggleTrackerName() {
        show(els.trackerNameField, els.trackerSelect.value === NEW_TheTracker);
      }

      function analyzeAndRender() {
        state.analysis = analyze();
        const a = state.analysis;
        const lines = [fmt("validRows", { n: a.records.length })];
        if (a.skipped) lines.push(fmt("skippedRows", { n: a.skipped }));
        if (a.unmatched) lines.push(fmt("unmatchedAssignees", { n: a.unmatched }));
        els.mappingStats.innerHTML = lines.map(esc).join("<br>");
        els.mappingStats.className = "waitlist-msg" + (a.records.length ? "" : " error");
        els.mappingStats.hidden = false;

        if (a.unmatchedEmails.length) {
          let list = a.unmatchedEmails.slice(0, MAX_UNMATCHED_LISTED).join(listSep());
          if (a.unmatchedEmails.length > MAX_UNMATCHED_LISTED) list += " …";
          setMsg(els.unmatchedHint, fmt("unmatchedHint", { list: list }), "warning");
        } else {
          setMsg(els.unmatchedHint, "");
        }
        renderPlan();
      }

      function statCard(label, value) {
        return '<div class="platform-stat-card"><p class="platform-stat-label">' + esc(label) +
               '</p><span class="platform-stat-value">' + esc(value) + "</span></div>";
      }

      function planCheck() {
        const lim = state.limits || {};
        const impLimit = limitOf(lim.imports_per_month);
        const itemLimit = limitOf(lim.items);
        const rows = state.analysis ? state.analysis.records.length : 0;
        if (impLimit !== null && state.importsUsed >= impLimit) {
          return { ok: false, key: "planImportsExceeded", vars: { used: state.importsUsed, limit: impLimit } };
        }
        if (itemLimit !== null) {
          const remaining = Math.max(0, itemLimit - state.itemsCount);
          if (rows > remaining) {
            return { ok: false, key: "planItemsExceeded", vars: { rows: rows, remaining: remaining, limit: itemLimit } };
          }
        }
        return { ok: true };
      }

      function renderPlan() {
        const lim = state.limits || {};
        const impLimit = limitOf(lim.imports_per_month);
        const itemLimit = limitOf(lim.items);
        const rows = state.analysis ? state.analysis.records.length : 0;
        els.planStats.innerHTML =
          statCard(t("importsThisMonth"), fmt("ofLimit", { used: state.importsUsed, limit: impLimit === null ? t("unlimited") : impLimit })) +
          statCard(t("itemsUsage"), fmt("ofLimit", { used: state.itemsCount, limit: itemLimit === null ? t("unlimited") : itemLimit })) +
          statCard(t("rowsToImport"), rows);

        const check = planCheck();
        if (!check.ok) {
          setMsg(els.planMsg, fmt(check.key, check.vars), "error");
          show(els.planUpgrade, true);
          els.importBtn.disabled = true;
        } else {
          setMsg(els.planMsg, t("planOk"), "success");
          show(els.planUpgrade, false);
          els.importBtn.disabled = state.busy;
        }
      }

      function renderSummary() {
        const r = state.result;
        if (!r) return;
        els.summaryStats.innerHTML =
          statCard(t("summaryInserted"), r.inserted) +
          statCard(t("summarySkipped"), r.skipped) +
          statCard(t("summaryUnmatched"), r.unmatched);
        els.summaryTracker.textContent = fmt("summaryTracker", { name: r.trackerName });
        if (r.isNew) {
          els.summaryRule.textContent = t(r.ruleCreated ? "summaryRuleNote" : "summaryRuleFailed");
          show(els.summaryRule, true);
        } else {
          show(els.summaryRule, false);
        }
        if (r.unmatchedEmails.length) {
          let list = r.unmatchedEmails.slice(0, MAX_UNMATCHED_LISTED).join(listSep());
          if (r.unmatchedEmails.length > MAX_UNMATCHED_LISTED) list += " …";
          setMsg(els.summaryUnmatched, fmt("unmatchedHint", { list: list }), "warning");
        } else {
          setMsg(els.summaryUnmatched, "");
        }
      }

      /* Re-render language-dependent dynamic parts after setLang(). */
      function refreshDynamic() {
        if (state.busy) return;
        if (state.headers.length && state.rows.length) {
          renderPreview();
          renderMapping();
          renderTrackerSelect();
          analyzeAndRender();
          if (state.file) {
            setMsg(els.fileStatus, fmt("fileLoaded", { name: state.file.name, rows: state.rows.length, cols: state.headers.length }), "success");
          }
        } else if (els.trackerSelect) {
          renderTrackerSelect();
        }
        if (state.result) renderSummary();
      }
      window.__importPageRefresh = refreshDynamic;

      /* ---------- data loading ---------- */

      function buildMemberMap(members) {
        const map = {};
        (members || []).forEach(function (m) {
          if (m.status && m.status !== "active") return;
          const p = m.profiles || {};
          [p.email, m.invited_email].forEach(function (e) {
            const clean = String(e || "").trim().toLowerCase();
            if (clean && !map[clean]) map[clean] = m.user_id;
          });
        });
        state.memberByEmail = map;
      }

      function refreshPlanData() {
        return Promise.all([
          trackerApp.planLimits().catch(function () { return {}; }),
          trackerApp.importsThisMonth().catch(function () { return 0; }),
          trackerApp.countItems().catch(function () { return 0; })
        ]).then(function (res) {
          state.limits = res[0] || {};
          state.importsUsed = Number(res[1]) || 0;
          state.itemsCount = Number(res[2]) || 0;
        });
      }

      function loadOrgData() {
        return Promise.all([
          trackerApp.listTrackers(),
          trackerApp.listMembers().catch(function () { return []; })
        ]).then(function (res) {
          state.trackers = res[0] || [];
          buildMemberMap(res[1] || []);
          return refreshPlanData();
        });
      }

      /* ---------- import ---------- */

      function setBusy(on) {
        state.busy = on;
        els.importBtn.disabled = on;
        els.sheetSelect.disabled = on;
        els.trackerSelect.disabled = on;
        els.trackerName.disabled = on;
        els.chooseFileBtn.disabled = on;
        els.fileInput.disabled = on;
        els.mappingGrid.querySelectorAll("select").forEach(function (s) { s.disabled = on; });
      }

      function progress(text) { setMsg(els.importProgress, text); }

      async function runImport() {
        if (state.busy) return;
        const m = state.mapping;
        /* في وضع المخالفات يبنى العنوان من رقم المخالفة، فلا يلزم عمود عنوان */
        var needsTitle = state.mode !== "violations";
        if ((needsTitle && m.title < 0) || m.due < 0) {
          setMsg(els.importProgress, t(needsTitle ? "mappingRequired" : "mappingRequiredDue"), "error"); return;
        }

        const isNew = els.trackerSelect.value === NEW_TheTracker;
        const trackerName = String(els.trackerName.value || "").trim();
        if (isNew && !trackerName) { setMsg(els.importProgress, t("trackerNameRequired"), "error"); els.trackerName.focus(); return; }

        state.analysis = analyze();
        const analysis = state.analysis;
        if (!analysis.records.length) { setMsg(els.importProgress, t("noValidRows"), "error"); return; }

        setBusy(true);
        let inserted = 0;
        try {
          progress(t("checkingPlan"));
          await refreshPlanData();
          renderPlan();
          const check = planCheck();
          if (!check.ok) { setMsg(els.importProgress, fmt(check.key, check.vars), "error"); return; }

          let tracker = null;
          if (isNew) {
            progress(t("progressCreatingTracker"));
            tracker = await trackerApp.createTracker({ name: trackerName, columns: state.headers.slice() });
          } else {
            const id = els.trackerSelect.value;
            for (let i = 0; i < state.trackers.length; i++) if (state.trackers[i].id === id) { tracker = state.trackers[i]; break; }
            if (!tracker) throw new Error(t("genericError"));
          }

          progress(t("progressImport"));
          const imp = await trackerApp.createImport({
            tracker_id: tracker.id,
            filename: state.file ? state.file.name : null,
            rows_count: analysis.records.length,
            mapping: mappingForDb()
          });

          const total = analysis.records.length;
          for (let i = 0; i < total; i += CHUNK) {
            progress(fmt("progressInserting", { done: inserted, total: total }));
            const chunk = analysis.records.slice(i, i + CHUNK).map(function (r) {
              return {
                tracker_id: tracker.id,
                import_id: imp.id,
                title: r.title,
                category: r.category,
                due_at: r.due_at,
                status: r.status,
                assignee_id: r.assignee_id,
                amount: r.amount != null ? r.amount : null,
                client_name: r.client_name || null,
                case_number: r.case_number || null,
                data: r.data
              };
            });
            const res = await trackerApp.insertItems(chunk);
            inserted += (res && res.length) ? res.length : chunk.length;
            progress(fmt("progressInserting", { done: inserted, total: total }));
          }

          let ruleCreated = false;
          if (isNew) {
            progress(t("progressRule"));
            try {
              await trackerApp.saveRule({ tracker_id: tracker.id, offset_minutes: 1440, channels: ["telegram"], target: "assignee" });
              ruleCreated = true;
            } catch (e) {
              ruleCreated = false;
            }
            state.trackers.push(tracker);
          }

          state.result = {
            inserted: inserted,
            skipped: analysis.skipped,
            unmatched: analysis.unmatched,
            unmatchedEmails: analysis.unmatchedEmails,
            trackerName: tracker.name,
            isNew: isNew,
            ruleCreated: ruleCreated
          };
          setMsg(els.importProgress, "");
          renderSummary();
          [els.step1, els.step2, els.step3, els.step4, els.step5].forEach(function (s) { show(s, false); });
          show(els.summaryCard, true);
          els.summaryCard.scrollIntoView({ behavior: "smooth", block: "start" });
          toast(t("summaryTitle"), "success");
        } catch (err) {
          let msg;
          if (err && err.code === "PLAN_LIMIT") {
            msg = t("planLimitItems");
            show(els.planUpgrade, true);
          } else {
            msg = fmt("importFailed", { error: (err && err.message) ? err.message : t("genericError") });
          }
          if (inserted > 0) msg += " " + fmt("importPartial", { done: inserted });
          setMsg(els.importProgress, msg, "error");
          toast(msg, "error");
          refreshPlanData().then(renderPlan).catch(function () { /* ignore */ });
        } finally {
          setBusy(false);
          if (state.result) els.importBtn.disabled = true;
        }
      }

      function resetFlow() {
        state.file = null;
        state.fileBase = "";
        state.workbook = null;
        state.sheetName = "";
        state.headers = [];
        state.rows = [];
        state.mapping = { title: -1, due: -1, category: -1, assignee: -1, status: -1 };
        state.analysis = null;
        state.result = null;
        els.fileInput.value = "";
        els.trackerName.value = "";
        els.previewTable.innerHTML = "";
        els.mappingGrid.innerHTML = "";
        setMsg(els.fileStatus, "");
        setMsg(els.importProgress, "");
        setMsg(els.unmatchedHint, "");
        show(els.summaryCard, false);
        [els.step2, els.step3, els.step4, els.step5].forEach(function (s) { show(s, false); });
        show(els.step1, true);
        els.importBtn.disabled = false;
        renderTrackerSelect();
        refreshPlanData().catch(function () { /* ignore */ });
        els.step1.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      /* ---------- boot ---------- */

      function showUnavailable() {
        show(els.loadingCard, false);
        show(els.importFlow, false);
        show(els.unavailableCard, true);
      }

      function showNoOrg() {
        show(els.loadingCard, false);
        show(els.importFlow, false);
        show(els.noOrgCard, true);
      }

      function wireEvents() {
        if (els.importMode) els.importMode.addEventListener("change", function () {
          state.mode = this.value === "violations" ? "violations" : "general";
          show(els.graceField, state.mode === "violations");
          renderMapping();
          analyzeAndRender();
        });

        els.chooseFileBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          if (!state.busy) els.fileInput.click();
        });
        document.getElementById("templateBtn").addEventListener("click", function (e) { e.stopPropagation(); downloadTemplate(); });
        els.dropZone.addEventListener("click", function () { if (!state.busy) els.fileInput.click(); });
        els.dropZone.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!state.busy) els.fileInput.click(); }
        });
        ["dragenter", "dragover"].forEach(function (ev) {
          els.dropZone.addEventListener(ev, function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (!state.busy) els.dropZone.classList.add("is-dragover");
          });
        });
        ["dragleave", "drop"].forEach(function (ev) {
          els.dropZone.addEventListener(ev, function (e) {
            e.preventDefault();
            e.stopPropagation();
            els.dropZone.classList.remove("is-dragover");
          });
        });
        els.dropZone.addEventListener("drop", function (e) {
          if (state.busy) return;
          const files = e.dataTransfer && e.dataTransfer.files;
          if (files && files.length) readFile(files[0]);
        });
        /* Dropping outside the zone must not navigate the page away. */
        document.addEventListener("dragover", function (e) { e.preventDefault(); });
        document.addEventListener("drop", function (e) { e.preventDefault(); });

        els.fileInput.addEventListener("change", function () {
          const f = els.fileInput.files && els.fileInput.files[0];
          if (f) readFile(f);
        });
        els.sheetSelect.addEventListener("change", function () { if (state.workbook) selectSheet(els.sheetSelect.value); });
        els.trackerSelect.addEventListener("change", toggleTrackerName);
        els.importBtn.addEventListener("click", function () { runImport(); });
        els.importAnotherBtn.addEventListener("click", resetFlow);
      }

      function boot() {
        els = {
          loadingCard: $("loadingCard"), unavailableCard: $("unavailableCard"), noOrgCard: $("noOrgCard"),
          importFlow: $("importFlow"),
          step1: $("step1"), step2: $("step2"), step3: $("step3"), step4: $("step4"), step5: $("step5"),
          dropZone: $("dropZone"), chooseFileBtn: $("chooseFileBtn"), fileInput: $("fileInput"), fileStatus: $("fileStatus"),
          sheetRow: $("sheetRow"), sheetSelect: $("sheetSelect"), previewNote: $("previewNote"), previewTable: $("previewTable"),
          mappingGrid: $("mappingGrid"), mappingStats: $("mappingStats"), unmatchedHint: $("unmatchedHint"),
          importMode: $("importMode"), graceField: $("graceField"), graceDays: $("graceDays"),
          trackerSelect: $("trackerSelect"), trackerNameField: $("trackerNameField"), trackerName: $("trackerName"),
          planStats: $("planStats"), planMsg: $("planMsg"), planUpgrade: $("planUpgrade"),
          importBtn: $("importBtn"), importProgress: $("importProgress"),
          summaryCard: $("summaryCard"), summaryStats: $("summaryStats"), summaryTracker: $("summaryTracker"),
          summaryRule: $("summaryRule"), summaryUnmatched: $("summaryUnmatched"), importAnotherBtn: $("importAnotherBtn")
        };
        wireEvents();

        const app = window.trackerApp;
        if (!app || !app.ready) { showUnavailable(); return; }

        app.ready.then(function (res) {
          if (!res || res.unavailable || app.unavailable) { showUnavailable(); return null; }
          if (!app.org) { showNoOrg(); return null; }
          return loadOrgData().then(function () {
            renderTrackerSelect();
            show(els.loadingCard, false);
            show(els.importFlow, true);
          });
        }).catch(function (err) {
          show(els.loadingCard, false);
          if (err && err.code === "unavailable") { showUnavailable(); return; }
          show(els.importFlow, true);
          renderTrackerSelect();
          toast((err && err.message) || t("genericError"), "error");
        });
      }

      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
      else boot();
    })();
  