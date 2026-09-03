// --- تقويم ICS ---------------------------------------------------------------
// GET /api/calendar/:token.ics — يعيد عناصر الشركة المرتبطة بالرمز كتقويم
// يُشترَك فيه من آبل/جوجل/أوتلوك. الرمز خاص بكل مستخدم ولا يكشف بيانات غيره.

function icsEscape(s) {
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function icsDate(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

// طي الأسطر الطويلة حسب RFC 5545 (75 بايت)
function foldLine(line) {
  const out = [];
  let s = line;
  while (s.length > 73) {
    out.push(s.slice(0, 73));
    s = " " + s.slice(73);
  }
  out.push(s);
  return out.join("\r\n");
}

export function buildIcs(items, calName) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TRACKER//appmails.net//AR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(calName || "TRACKER")}`,
    "X-WR-TIMEZONE:Asia/Riyadh",
  ];
  const stamp = icsDate(new Date());
  for (const it of items) {
    const due = icsDate(it.due_at);
    if (!due) continue;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${it.id}@appmails.net`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${due}`);
    lines.push(`DTEND:${due}`);
    lines.push(foldLine(`SUMMARY:${icsEscape(it.title)}`));
    const descParts = [];
    if (it.tracker_name) descParts.push(it.tracker_name);
    if (it.category) descParts.push(it.category);
    if (it.status) descParts.push(it.status);
    if (descParts.length) lines.push(foldLine(`DESCRIPTION:${icsEscape(descParts.join(" · "))}`));
    lines.push(`URL:https://appmails.net/app/dashboard.html?item=${it.id}`);
    lines.push(`STATUS:${it.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export async function handleCalendar(token, env, serviceHeaders) {
  const safe = String(token || "").replace(/[^a-f0-9]/gi, "");
  if (!safe || safe.length < 16) return new Response("not found", { status: 404 });
  const tokRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/calendar_tokens?select=user_id,org_id&token=eq.${safe}&limit=1`,
    { headers: { ...serviceHeaders, Accept: "application/json" }, cf: { cacheTtl: 0, cacheEverything: false } }
  );
  const rows = tokRes.ok ? await tokRes.json() : [];
  if (!rows.length) return new Response("not found", { status: 404 });
  const { org_id } = rows[0];

  const itemsRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/items?select=id,title,category,due_at,status,trackers(name)&org_id=eq.${org_id}&due_at=not.is.null&status=neq.cancelled&order=due_at.asc&limit=2000`,
    { headers: { ...serviceHeaders, Accept: "application/json" }, cf: { cacheTtl: 0, cacheEverything: false } }
  );
  const items = itemsRes.ok ? await itemsRes.json() : [];
  const normalized = items.map((r) => ({
    id: r.id, title: r.title, category: r.category, due_at: r.due_at, status: r.status,
    tracker_name: r.trackers && r.trackers.name,
  }));

  const orgRes = await fetch(`${env.SUPABASE_URL}/rest/v1/organizations?select=name&id=eq.${org_id}&limit=1`, {
    headers: { ...serviceHeaders, Accept: "application/json" }, cf: { cacheTtl: 0, cacheEverything: false },
  });
  const orgRows = orgRes.ok ? await orgRes.json() : [];
  const calName = orgRows.length ? `TRACKER — ${orgRows[0].name}` : "TRACKER";

  return new Response(buildIcs(normalized, calName), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="tracker.ics"',
      "Cache-Control": "private, max-age=300",
    },
  });
}
