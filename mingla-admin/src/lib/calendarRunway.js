// Issue #4130 (Wave 4a) — the Calendar's Event runway rows. Pure: no React,
// no Supabase.
//
// calendar_runway returns each event with its own start time and time zone,
// so a Lagos event reads "19 Dec, 21:00 Lagos" for everyone, never the
// viewer's clock (the old page showed New York times for Lagos events). A
// promised date with no event yet has no time, only its day.

/** "Africa/Lagos" -> "Lagos", "America/New_York" -> "New York". */
export function zoneCity(timeZone) {
  if (typeof timeZone !== "string" || !timeZone || timeZone === "UTC") return timeZone === "UTC" ? "UTC" : "";
  const last = timeZone.split("/").pop() || timeZone;
  return last.replace(/_/g, " ");
}

/** When an event starts, in its own time zone: "19 Dec, 21:00 Lagos". */
export function localWhen(row) {
  const startAt = row?.start_at ? new Date(row.start_at) : null;
  const zone = row?.timezone || null;
  if (startAt && !Number.isNaN(startAt.getTime()) && zone) {
    try {
      const parts = new Intl.DateTimeFormat("en-GB", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone,
      }).formatToParts(startAt);
      const get = (type) => parts.find((p) => p.type === type)?.value || "";
      return `${get("day")} ${get("month")}, ${get("hour")}:${get("minute")} ${zoneCity(zone)}`.trim();
    } catch {
      // An unknown zone name: fall through to the date only.
    }
  }
  if (typeof row?.start_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.start_on)) {
    const d = new Date(`${row.start_on}T12:00:00Z`);
    return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}, time not set`;
  }
  return "Date not set";
}

/** Rows to show: test brands hidden unless asked, then the search. */
export function visibleRunwayRows(rows, { showTest = false, q = "" } = {}) {
  const needle = String(q || "").trim().toLowerCase();
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!showTest && r?.is_test) return false;
    if (!needle) return true;
    return [r?.title, r?.host_name, r?.brand_name].some((v) => typeof v === "string" && v.toLowerCase().includes(needle));
  });
}

/** Ids of events and promised dates of staff or test brands (for the month grid). */
export function testAnchorIds(rows) {
  return new Set((Array.isArray(rows) ? rows : []).filter((r) => r?.is_test).map((r) => String(r.anchor_id)));
}
