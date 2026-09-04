// --- استيراد إكسل من بوت تلغرام --------------------------------------------
// منطق صفحة الاستيراد (app/import.html) نفسه منقولا إلى الخادم: اكتشاف صف العناوين،
// نوع الورقة من اسمها، تخمين الأعمدة بالكلمات المفتاحية، وبناء العناصر. القراءة بمكتبة
// SheetJS نفسها التي يستخدمها الموقع (xlsx 0.18.5). الكتابة عبر الدالة telegram_import.
import * as XLSX from "xlsx";
import { rpc } from "./notify.js";

export const ALLOWED_EXT = ["xlsx", "xlsm", "xls", "csv"];
const GRACE_DAYS = 30;          // مهلة سداد المخالفة الافتراضية في الموقع
const MAX_ROWS_PER_SHEET = 2000;
const RIYADH_OFFSET_H = 3;      // الموقع يقرأ التواريخ بتوقيت المتصفح (الرياض)، والخادم بتوقيت UTC

const HEADER_HINTS = ["رقم المخالفة", "تاريخ المخالفة", "مبلغ المخالفة", "نوع المخالفة", "حالة التظلم",
                      "رقم القضية", "رقم الدعوى", "المدعي", "المدعى عليه", "المحكمة", "الدائرة",
                      "الجهة القضائية", "المحامي", "التاريخ", "الوقت", "تاريخ الجلسة", "تاريخ الحكم",
                      "title", "due", "date", "amount"];

const FIELDS = [
  { key: "title", keywords: ["title", "عنوان", "العنوان", "name", "اسم", "الاسم", "subject", "موضوع", "الموضوع", "titre", "nom", "objet"] },
  { key: "due", keywords: ["تاريخ المخالفة", "تاريخ الجلسة القادمة", "تاريخ الجلسة", "تاريخ الدعوى", "due date", "due", "تاريخ الاستحقاق", "استحقاق", "الاستحقاق", "expiry", "expiry date", "expire", "expires", "انتهاء", "الانتهاء", "تاريخ الانتهاء", "deadline", "date", "تاريخ", "التاريخ", "échéance", "echeance", "تاریخ"] },
  { key: "category", keywords: ["category", "تصنيف", "التصنيف", "type", "نوع", "النوع", "فئة", "الفئة", "catégorie", "categorie", "زمرہ"] },
  { key: "assignee", keywords: ["assignee", "assignee email", "email", "e-mail", "بريد", "البريد", "البريد الإلكتروني", "مسؤول", "المسؤول", "responsable", "courriel", "ای میل"] },
  { key: "amount", keywords: ["مبلغ المخالفة", "المبلغ", "مبلغ", "قيمة", "amount", "fine", "value", "montant"] },
  { key: "client", keywords: ["الشركة", "العميل", "الجهة", "المدعى عليه", "client", "company", "entreprise"] },
  { key: "casenum", keywords: ["رقم الدعوى", "رقم القضية", "رقم الدعوي", "case number", "case no", "numéro de dossier"] },
  { key: "vnumber", keywords: ["رقم المخالفة", "رقم مخالفة", "المخالفة", "violation number", "violation no", "ticket", "ticket number", "fine number", "numéro d'infraction"] },
  { key: "location", keywords: ["جهة اصدار المخالفة", "جهة الإصدار", "الموقع", "موقع", "المكان", "المدينة", "location", "place", "site", "lieu", "مقام"] },
  { key: "status", keywords: ["status", "حالة", "الحالة", "statut", "état", "etat", "حالت"] },
];

const DONE_VALUES = ["done", "completed", "complete", "finished", "closed", "closed.", "yes",
                     "منجز", "منجزة", "مكتمل", "مكتملة", "تم", "تمت", "مغلق", "مغلقة", "منتهي", "منتهية",
                     "terminé", "terminée", "termine", "terminee", "fait", "faite", "fermé", "ferme",
                     "مکمل", "ہو گیا", "بند"];

// ---------- خلايا وتواريخ (كما في common.js) ----------
function nonEmpty(v) { return !(v === null || v === undefined || (typeof v === "string" && v.trim() === "")); }
function cellText(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  return String(v).trim();
}
function cellValue(v) {
  if (!nonEmpty(v)) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "string") return v.trim();
  return v;
}
function normHeader(s) { return String(s || "").toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim(); }
function toWesternDigits(s) {
  return String(s).replace(/[٠-٩۰-۹]/g, (d) => { const c = d.charCodeAt(0); return String(c >= 0x06F0 ? c - 0x06F0 : c - 0x0660); });
}
/* الساعة الحائطية بتوقيت الرياض ← ISO */
function fromWall(y, m, d, h, mi, s) {
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d, (h || 0) - RIYADH_OFFSET_H, mi || 0, s || 0, 0));
  if (isNaN(dt.getTime())) return null;
  const chk = new Date(dt.getTime() + RIYADH_OFFSET_H * 3600000);
  if (chk.getUTCMonth() !== m - 1 || chk.getUTCDate() !== d) return null;
  return dt.toISOString();
}
function fromExcelSerial(n) {
  if (!(n > 0 && n < 2958466)) return null;
  const u = new Date(Math.round((n - 25569) * 86400000));
  return fromWall(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
}
export function parseExcelDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "number") return fromExcelSerial(value);
  const s = toWesternDigits(String(value)).trim();
  if (!s) return null;
  let m;
  if (/^\d+(\.\d+)?$/.test(s) && s.length <= 7) return fromExcelSerial(parseFloat(s));
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) { const z = new Date(s); return isNaN(z.getTime()) ? null : z.toISOString(); }
  m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return fromWall(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/);
  if (m) {
    let y = +m[3]; if (m[3].length <= 2) y += 2000;
    let h = +(m[4] || 0); const ap = (m[7] || "").toUpperCase();
    if (ap === "PM" && h < 12) h += 12; if (ap === "AM" && h === 12) h = 0;
    return fromWall(y, +m[2], +m[1], h, +(m[5] || 0), +(m[6] || 0));
  }
  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

// ---------- قراءة الورقة (import.html) ----------
function headerScore(row, next) {
  if (!row) return -1;
  let textCells = 0, hints = 0;
  row.forEach((cell) => {
    const v = cellText(cell);
    if (!v) return;
    if (typeof cell === "number") return;
    textCells++;
    const low = v.toLowerCase();
    for (let i = 0; i < HEADER_HINTS.length; i++) if (low.indexOf(HEADER_HINTS[i].toLowerCase()) !== -1) { hints++; break; }
  });
  if (textCells < 3) return -1;
  const nextFilled = next ? next.filter(nonEmpty).length : 0;
  if (nextFilled < 2) return -1;
  return hints * 10 + textCells;
}
function nextDataRow(aoa, i) {
  for (let k = i + 1; k <= i + 3 && k < aoa.length; k++) if (aoa[k] && aoa[k].filter(nonEmpty).length >= 2) return aoa[k];
  return null;
}
function parseSheet(ws) {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
  let hi = -1, best = -1;
  const scanTo = Math.min(aoa.length, 30);
  for (let i = 0; i < scanTo; i++) { const sc = headerScore(aoa[i], nextDataRow(aoa, i)); if (sc > best) { best = sc; hi = i; } }
  if (hi === -1) for (let i = 0; i < aoa.length; i++) if (aoa[i] && aoa[i].some(nonEmpty)) { hi = i; break; }
  if (hi === -1) return { headers: [], rows: [] };
  const rawHeaders = aoa[hi];
  let width = rawHeaders.length;
  for (let r = hi + 1; r < aoa.length; r++) if (aoa[r] && aoa[r].length > width) width = aoa[r].length;
  const headers = [], seen = {};
  for (let c = 0; c < width; c++) {
    let name = cellText(rawHeaders[c]) || ("عمود " + (c + 1));
    if (seen[name]) { seen[name] += 1; name = name + " (" + seen[name] + ")"; } else seen[name] = 1;
    headers.push(name);
  }
  const rows = [];
  for (let r = hi + 1; r < aoa.length; r++) {
    const src = aoa[r] || [];
    if (!src.some(nonEmpty)) continue;
    const row = new Array(width);
    for (let c = 0; c < width; c++) row[c] = c < src.length ? src[c] : null;
    rows.push(row);
    if (rows.length >= MAX_ROWS_PER_SHEET) break;
  }
  return { headers, rows };
}
function sheetProfile(name) {
  const n = String(name || "");
  const dash = n.split(/\s[-–]\s/);
  const client = dash.length > 1 ? dash[dash.length - 1].trim() : "";
  let kind = "general";
  if (/مخالف/.test(n)) kind = "violations";
  else if (/جلسات|قضايا|دعاو/.test(n)) kind = "cases";
  return { kind, client };
}
function guessMapping(headers) {
  const names = headers.map(normHeader), used = {}, mapping = {};
  FIELDS.forEach((f) => {
    let idx = -1;
    for (let k = 0; k < f.keywords.length && idx === -1; k++) { const kw = f.keywords[k]; for (let j = 0; j < names.length; j++) if (!used[j] && names[j] === kw) { idx = j; break; } }
    for (let k = 0; k < f.keywords.length && idx === -1; k++) { const kw = f.keywords[k]; for (let j = 0; j < names.length; j++) if (!used[j] && names[j].indexOf(kw) !== -1) { idx = j; break; } }
    mapping[f.key] = idx;
    if (idx !== -1) used[idx] = true;
  });
  return mapping;
}
function analyze(headers, rows, m, mode, sheetClient) {
  const records = []; let skipped = 0;
  const mappedIdx = {}; Object.keys(m).forEach((k) => { if (m[k] >= 0) mappedIdx[m[k]] = true; });
  const isViolations = mode === "violations";
  rows.forEach((row) => {
    let title = m.title >= 0 ? cellText(row[m.title]) : "";
    let due = m.due >= 0 ? parseExcelDate(row[m.due]) : null;
    const vnumber = m.vnumber >= 0 ? cellText(row[m.vnumber]) : "";
    const place = m.location >= 0 ? cellText(row[m.location]) : "";
    if (isViolations) {
      if (!vnumber || !due) { skipped++; return; }
      title = "مخالفة رقم " + vnumber + (place ? " — " + place : "");
      const dueDate = new Date(due); dueDate.setUTCDate(dueDate.getUTCDate() + GRACE_DAYS); due = dueDate.toISOString();
    } else if (!title || !due) { skipped++; return; }
    const rec = { title, due_at: due, category: isViolations ? "مخالفة" : null, status: "open", data: {} };
    if (m.amount >= 0) { const num = parseFloat(String(cellText(row[m.amount]) || "").replace(/[^0-9.\-]/g, "")); if (!isNaN(num)) rec.amount = num; }
    if (m.casenum >= 0) { const cn = cellText(row[m.casenum]); if (cn) rec.case_number = cn; }
    let clientName = m.client >= 0 ? cellText(row[m.client]) : "";
    if (!clientName && sheetClient) clientName = sheetClient;
    if (clientName) rec.client_name = clientName;
    if (isViolations) {
      rec.data.violation_number = vnumber;
      rec.data.violation_date = m.due >= 0 ? parseExcelDate(row[m.due]) : null;
      if (place) rec.data.location = place;
      rec.data.grace_days = GRACE_DAYS;
    }
    if (m.category >= 0) rec.category = cellText(row[m.category]) || null;
    if (m.status >= 0) { const sv = cellText(row[m.status]).toLowerCase(); if (sv && DONE_VALUES.indexOf(sv) !== -1) rec.status = "done"; }
    if (m.assignee >= 0) { const email = cellText(row[m.assignee]).toLowerCase(); if (email) rec.assignee_email = email; }
    headers.forEach((h, i) => { if (!mappedIdx[i]) rec.data[h] = cellValue(row[i]); });
    records.push(rec);
  });
  return { records, skipped };
}
function mappingForDb(sheetName, headers, mapping) {
  const out = { sheet: sheetName, columns: headers.slice() };
  FIELDS.forEach((f) => { const idx = mapping[f.key]; out[f.key] = idx >= 0 ? headers[idx] : null; });
  return out;
}

export function fileExt(name) { const m = String(name || "").match(/\.([^.]+)$/); return m ? m[1].toLowerCase() : ""; }

/* يقرأ المصنف كله ويعيد الأوراق القابلة للاستيراد مع عناصرها الجاهزة */
export function parseWorkbook(bytes, filename) {
  const ext = fileExt(filename);
  const wb = ext === "csv"
    ? XLSX.read(new TextDecoder("utf-8").decode(new Uint8Array(bytes)), { type: "string", raw: true })
    : XLSX.read(new Uint8Array(bytes), { type: "array", cellDates: true });
  const base = String(filename || "file").replace(/\.[^.]+$/, "");
  const sheets = [];
  (wb.SheetNames || []).forEach((name) => {
    const ws = wb.Sheets[name];
    if (!ws) return;
    const parsed = parseSheet(ws);
    if (!parsed.headers.length || !parsed.rows.length) return;
    const profile = sheetProfile(name);
    const mode = profile.kind === "violations" ? "violations" : "general";
    const mapping = guessMapping(parsed.headers);
    const ok = mode === "violations" ? (mapping.vnumber >= 0 && mapping.due >= 0) : (mapping.title >= 0 && mapping.due >= 0);
    if (!ok) { sheets.push({ name, tracker: null, kind: profile.kind, records: [], skipped: parsed.rows.length, unmapped: true }); return; }
    const a = analyze(parsed.headers, parsed.rows, mapping, mode, profile.client);
    const generic = /^(sheet|ورقة|feuil|feuille)\s*\d*$/i.test(name.trim());
    sheets.push({
      name, kind: profile.kind, tracker: generic ? base : name,
      columns: parsed.headers, mapping: mappingForDb(name, parsed.headers, mapping),
      records: a.records, skipped: a.skipped, unmapped: false,
    });
  });
  return { filename, sheets: sheets.filter((s) => s.records.length), unusable: sheets.filter((s) => !s.records.length) };
}

/* المسودة المخزنة بين "وجدت…" و"حفظ" */
export function draftPayload(parsed) {
  return { filename: parsed.filename, sheets: parsed.sheets.map((s) => ({ name: s.name, tracker: s.tracker, columns: s.columns, mapping: s.mapping, rows: s.records })) };
}

/* الحفظ الفعلي: ورقة ← استدعاء واحد للدالة المحمية */
export async function commitImport(env, userId, payload) {
  const results = [], errors = [];
  for (const s of (payload && payload.sheets) || []) {
    try {
      const r = await rpc(env, "telegram_import", {
        p_secret: env.WORKER_SECRET, p_user_id: userId, p_filename: payload.filename || null, p_sheet: s.name,
        p_tracker_name: s.tracker || s.name, p_columns: s.columns || [], p_mapping: s.mapping || {}, p_rows: s.rows || [],
      });
      results.push(r || { tracker_name: s.tracker, inserted: 0 });
    } catch (e) {
      const msg = String((e && e.message) || e);
      errors.push({ sheet: s.name, limit: /PLAN_LIMIT/.test(msg), message: msg.slice(0, 200) });
    }
  }
  return { results, errors };
}
