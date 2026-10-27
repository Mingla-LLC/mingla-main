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

// ── #4130 (integration): the Event runway table and its two actions ─────────

function dayShort(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** The day an event must be live by for four weeks of promotion (server field). */
function goLiveBy(row) {
  return row?.go_live_by || row?.state?.by || null;
}

/** The "Live?" cell: a promised date with no event yet, a draft, or live. */
export function liveLabel(row) {
  if (row?.anchor_kind === "expected") return { label: "No event yet", tone: "default" };
  return row?.is_public ? { label: "Live", tone: "success" } : { label: "Draft", tone: "default" };
}

/** The "Promotion window" cell, from the server's state: "Go live by 21 Nov", "Promote now", … */
export function promotionWindow(row) {
  const state = row?.state || {};
  switch (state.k) {
    case "notlive": {
      const by = dayShort(goLiveBy(row));
      return { label: by ? `Go live by ${by}` : "Not live yet", tone: "warning" };
    }
    case "short": return { label: "Promote now", tone: "success" };
    case "ready": return { label: "Ready to promote", tone: "success" };
    case "late": return { label: "Too late for promo", tone: "error" };
    case "done": return { label: "Happened", tone: "default" };
    default: return { label: state.name || "No date yet", tone: "default" };
  }
}

/**
 * Which action a row offers: an event that is not live gets "Make a card"
 * (a Work card to get it live); a live one gets "Plan a post". A past event
 * gets neither.
 */
export function runwayAction(row) {
  if (!row || row.state?.k === "done") return null;
  if (row.anchor_kind === "event" && row.is_public) return "post";
  return "card";
}

function clip(text, max) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/**
 * The Work card "Make a card" adds, in the shape ops_work_add takes. Linked to
 * the event (or promised date), so the server counts its due date back from
 * the start; owned by whoever makes it.
 */
export function runwayCardItem(row, me) {
  const title = clip(row?.title, 120) || "this event";
  const host = row?.host_name || row?.brand_name || "The host";
  const by = dayShort(goLiveBy(row));
  return {
    title: clip(`Get ${title} live`, 160),
    instructions: clip(
      `${host} has ${title} on ${localWhen(row)}. It is not live on Mingla yet${by ? `; it needs to go live by ${by} to get four weeks of promotion` : ""}. Help the host publish it.`,
      4000
    ),
    done_means: "The event is live on Mingla.",
    owners: me ? [me] : [],
    links: [{ kind: row?.anchor_kind === "expected" ? "expected" : "event", id: row?.anchor_id }],
  };
}

/** The title "Plan a post" puts in the existing Add content form. */
export function runwayPostTitle(row) {
  return clip(`Promote ${clip(row?.title, 140) || "this event"}`, 160);
}
