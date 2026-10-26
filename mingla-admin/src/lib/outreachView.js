// Issue #4130 (Wave 4a) — Hosts and creators: the funnel, the due chips, the
// late-stage board and phone masking. Pure: no React, no Supabase.
//
// The counts on the funnel and the chips come from outreach_summary (every
// card, server-side). The list a chip shows is the loaded cards filtered by
// the SAME rules as the server's counts (pinned by a test):
//   today    due on the viewer's today, not Lost or Passed
//   week     due from today to today + 6, not Lost or Passed
//   stale    due before today, not Lost or Passed
//   replied  in Replied (they answered; the next move is ours)
//   noregion no region yet, not Lost or Passed
//   nodue    no due date yet, not Lost or Passed

const TERMINAL = new Set(["lost", "passed"]);

export const DUE_CHIPS = Object.freeze({
  hosts: Object.freeze([
    { id: "today", label: "Due today", key: "due_today" },
    { id: "week", label: "This week", key: "due_week" },
    { id: "stale", label: "Stale", key: "stale" },
    { id: "replied", label: "Replied, waiting on us", key: "replied" },
  ]),
  creators: Object.freeze([
    { id: "week", label: "Due this week", key: "due_week" },
    { id: "stale", label: "Stale", key: "stale" },
    { id: "noregion", label: "No region", key: "no_region" },
    { id: "nodue", label: "No due date", key: "no_due" },
  ]),
});

export const DUE_CHIP_IDS = Object.freeze(["today", "week", "stale", "replied", "noregion", "nodue"]);

function addDays(isoDay, n) {
  const [y, m, d] = String(isoDay).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Does one card belong under a chip? `today` is the viewer's YYYY-MM-DD. */
export function inDueChip(record, chip, today) {
  if (!record || typeof today !== "string") return false;
  const open = !TERMINAL.has(record.stage);
  const due = typeof record.due_on === "string" ? record.due_on : null;
  switch (chip) {
    case "today":
      return open && due === today;
    case "week":
      return open && !!due && due >= today && due <= addDays(today, 6);
    case "stale":
      return open && !!due && due < today;
    case "replied":
      return record.stage === "replied";
    case "noregion":
      return open && !record.region_id;
    case "nodue":
      return open && !due;
    default:
      return true;
  }
}

export function filterByDueChip(records, chip, today) {
  const list = Array.isArray(records) ? records : [];
  if (!chip) return list;
  return list.filter((r) => inDueChip(r, chip, today));
}

/** Ids of the loaded cards that are stale: what "Reset due dates" sends. */
export function staleIds(records, today) {
  return filterByDueChip(records, "stale", today).map((r) => r.id);
}

/**
 * The funnel strip: the pipeline's stages in order (Lost / Passed left out),
 * each with its count, its bar width against the biggest stage, and its
 * conversion from the stage before. The weakest step is marked.
 */
export function funnelSteps(def, stageCounts) {
  const stages = (def?.stages || []).filter((s) => !s.terminal);
  const counts = stages.map((s) => Number(stageCounts?.[s.id] ?? 0));
  const max = Math.max(1, ...counts);
  const steps = stages.map((s, i) => {
    const prev = i > 0 ? counts[i - 1] : null;
    const conversion = prev ? Math.round((counts[i] / prev) * 100) : null;
    return {
      id: s.id,
      label: s.label,
      count: counts[i],
      widthPercent: counts[i] === 0 ? 0 : Math.max(1, Math.round((counts[i] / max) * 100)),
      conversion,
      from: i > 0 ? stages[i - 1].label : null,
      weakest: false,
    };
  });
  let weakest = null;
  for (const step of steps) {
    if (step.conversion == null) continue;
    if (weakest == null || step.conversion < weakest.conversion) weakest = step;
  }
  if (weakest) weakest.weakest = true;
  return steps;
}

/**
 * The stages the board shows: from Replied to the last stage before Lost or
 * Passed. Early stages are hundreds of cards and live in the list.
 */
export function lateStageDef(def) {
  const stages = def?.stages || [];
  const from = stages.findIndex((s) => s.id === "replied");
  if (from < 0) return def;
  return { ...def, stages: stages.slice(from).filter((s) => !s.terminal) };
}

export function lateStageIds(def) {
  return (lateStageDef(def)?.stages || []).map((s) => s.id);
}

/** "Replied → Live": the board's range in words. */
export function lateStageRange(def) {
  const stages = lateStageDef(def)?.stages || [];
  if (!stages.length) return "";
  return `${stages[0].label} → ${stages[stages.length - 1].label}`;
}

// A run of digits with the usual phone separators, optionally starting with "+".
const PHONE = /(?<![\w,.:+])\+?(?:\(\d{1,4}\)[\s.-]?)?\d(?:[\s.-]?\d){6,}(?![\w,:]|\.\d)/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Hide phone numbers in free text: "+234 803 555 0101" -> "+••• 101". A run
 * needs 9 or more digits to count as a phone number, so dates, prices and
 * counts are left alone.
 */
export function maskPhones(text) {
  if (typeof text !== "string" || text === "") return text;
  return text.replace(PHONE, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 9 || ISO_DATE.test(match.trim())) return match;
    return `${match.trim().startsWith("+") ? "+" : ""}••• ${digits.slice(-3)}`;
  });
}

/** A card as the list and board show it: the next step without phone numbers. */
export function forDisplay(record) {
  if (!record || typeof record.next_action !== "string") return record;
  const masked = maskPhones(record.next_action);
  return masked === record.next_action ? record : { ...record, next_action: masked };
}

/** The local date a week from `today`, the default for "Reset due dates". */
export function defaultResetDue(today) {
  return addDays(today, 7);
}
