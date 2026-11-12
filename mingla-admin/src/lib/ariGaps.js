// Issue #3355 Wave D (D3) — the Admin "Ari gaps" view's pure helpers.
// Dependency-free so node:test can import it directly.

export const ARI_GAP_TYPES = [
  "refusal",
  "flow_parked",
  "repeated_request",
  "negative_feedback",
  "frustration",
  "empty_reply",
  "tool_error",
  "dropped_route",
];

const LABELS = {
  refusal: "Ari said it could not help",
  flow_parked: "A setup was set aside for a new request",
  repeated_request: "The host asked again",
  negative_feedback: "Thumbs down",
  frustration: "The host sounded frustrated",
  empty_reply: "Ari gave an empty reply",
  tool_error: "A tool failed",
  dropped_route: "A screen link was dropped",
};

export function gapTypeLabel(type) {
  return LABELS[type] || "Other";
}

/**
 * The weekly table: one row per week (newest first) with a count per gap
 * type and a total. `weeks` is the RPC's [{week_start, gap_type, count}].
 */
export function gapWeekRows(weeks = []) {
  const byWeek = new Map();
  for (const row of Array.isArray(weeks) ? weeks : []) {
    if (!row || typeof row.week_start !== "string") continue;
    const entry = byWeek.get(row.week_start) || { week_start: row.week_start, total: 0, counts: {} };
    const count = Number(row.count) || 0;
    entry.counts[row.gap_type] = (entry.counts[row.gap_type] || 0) + count;
    entry.total += count;
    byWeek.set(row.week_start, entry);
  }
  return [...byWeek.values()].sort((a, b) => (a.week_start < b.week_start ? 1 : -1));
}

/** The gap types that appear in the table, in the canonical order. */
export function gapTypesPresent(rows = []) {
  const present = new Set(rows.flatMap((row) => Object.keys(row.counts || {})));
  return ARI_GAP_TYPES.filter((type) => present.has(type));
}

/** A digest's Work board card in plain words. */
export function digestCardLabel(card = {}) {
  if (!card || typeof card !== "object") return "Not posted";
  if (card.status === "added" || (card.status === "kept" && card.number)) {
    return card.number ? `Work card ${card.number}` : "Work card added";
  }
  if (card.status === "kept") return "Work card already on the board";
  if (card.status === "skipped_empty") return "No gaps, no card";
  if (card.status === "refused") return "Work card refused — see the board rules";
  if (card.status === "duplicate") return "Matches an open Work card";
  return "Not posted";
}
