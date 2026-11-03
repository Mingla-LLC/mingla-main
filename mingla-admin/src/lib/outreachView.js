// Issue #4130 (Wave 4a) — Hosts and creators: the funnel, the due filter,
// the board and phone masking. Pure: no React, no Supabase.
//
// Issue #4255 (card 606): the board is the only view and it never hides a
// card. Every stage is a column, Lost/Passed last, and a Stale column comes
// first (D1); a stale card sits ONLY in Stale, tagged with its stage (D2).
// The funnel and the column headers are the only counts on the page and both
// count the cards the board shows, after the same filters. One rule decides
// stale everywhere (isStale: due before today, not Lost or Passed).
//
// The Due filter keeps the server's outreach_summary rules (pinned by a test):
//   today    due on the viewer's today, not Lost or Passed
//   week     due from today to today + 6, not Lost or Passed
//   stale    due before today, not Lost or Passed
//   replied  in Replied (they answered; the next move is ours)
//   noregion no region yet, not Lost or Passed
//   nodue    no due date yet, not Lost or Passed

const TERMINAL = new Set(["lost", "passed"]);

// The Due dropdown. "No next event" and "Go live soon" need each host's next
// dated thing (ops_host_next), so the page applies those two itself.
export const DUE_OPTIONS = Object.freeze({
  hosts: Object.freeze([
    { value: "", label: "Any" },
    { value: "today", label: "Due today" },
    { value: "week", label: "This week" },
    { value: "stale", label: "Stale" },
    { value: "replied", label: "Replied, waiting on us" },
    { value: "nonext", label: "No next event" },
    { value: "soon", label: "Go live soon" },
    { value: "nodue", label: "No due date" },
  ]),
  creators: Object.freeze([
    { value: "", label: "Any" },
    { value: "week", label: "This week" },
    { value: "stale", label: "Stale" },
    { value: "noregion", label: "No region" },
    { value: "nodue", label: "No due date" },
  ]),
});

/** Due choices this module decides by itself (the rest need host-next rows). */
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
  if (!chip || !DUE_CHIP_IDS.includes(chip)) return list;
  return list.filter((r) => inDueChip(r, chip, today));
}

/** The one stale rule: due before today, not Lost or Passed. */
export function isStale(record, today) {
  return inDueChip(record, "stale", today);
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

/** Each stage's count among `records` (the cards on the board), for the funnel. */
export function stageCounts(records) {
  const out = {};
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || typeof r.stage !== "string") continue;
    out[r.stage] = (out[r.stage] || 0) + 1;
  }
  return out;
}

/** A column shows this many cards first, then "Show all N". */
export const COLUMN_PAGE = 8;

function byDueOldestFirst(a, b) {
  const da = typeof a?.due_on === "string" ? a.due_on : "9999-99-99";
  const db = typeof b?.due_on === "string" ? b.due_on : "9999-99-99";
  if (da !== db) return da < db ? -1 : 1;
  return String(a?.name || "").localeCompare(String(b?.name || ""));
}

/**
 * The board's columns for the cards on screen (already filtered):
 *   stale    first: every stale card, oldest due date first, whatever its stage
 *   <stage>  one per stage, in order, without the stale cards; Lost/Passed is
 *            last and starts folded
 *   other    only when a card names a stage the pipeline no longer has, so no
 *            card is ever dropped (it is reported once)
 * Every card is in exactly one column, so the columns add up to the cards.
 */
export function boardColumns(def, records, today, { warn = (msg) => console.warn(msg) } = {}) {
  const stages = Array.isArray(def?.stages) ? def.stages : [];
  const known = new Set(stages.map((s) => s.id));
  const list = Array.isArray(records) ? records : [];
  const stale = [];
  const byStage = new Map(stages.map((s) => [s.id, []]));
  const other = [];
  for (const r of list) {
    if (!r) continue;
    if (isStale(r, today)) stale.push(r);
    else if (known.has(r.stage)) byStage.get(r.stage).push(r);
    else other.push(r);
  }
  if (other.length) warn(`[outreach] ${other.length} card(s) name a stage this pipeline does not have: shown under Other`);
  const columns = [
    { id: "stale", label: "Stale", hint: "Past their next-step date", kind: "stale", stageId: null, terminal: false, cards: stale.sort(byDueOldestFirst) },
    ...stages.map((s) => ({ id: s.id, label: s.label, hint: s.hint || "", kind: "stage", stageId: s.id, auto: !!s.auto, terminal: !!s.terminal, cards: byStage.get(s.id).sort(byDueOldestFirst) })),
  ];
  if (other.length) columns.push({ id: "other", label: "Other", hint: "A stage this pipeline no longer has", kind: "other", stageId: null, terminal: false, cards: other.sort(byDueOldestFirst) });
  return columns;
}

/** How many cards a column shows: 8 (none for a folded Lost/Passed), or all. */
export function columnShown(column, expanded) {
  const cards = Array.isArray(column?.cards) ? column.cards : [];
  if (expanded) return { shown: cards, hidden: 0 };
  const limit = column?.terminal ? 0 : COLUMN_PAGE;
  return { shown: cards.slice(0, limit), hidden: Math.max(0, cards.length - limit) };
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
