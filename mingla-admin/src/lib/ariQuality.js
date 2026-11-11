// Issue #3355 Wave F (F2) — the Admin "Ari quality" panel's pure helpers.
// Dependency-free so node:test can import it directly.

/** The windows the panel offers (days). The RPC clamps to 1..180. */
export const ARI_QUALITY_WINDOWS = [7, 30, 90];
export const ARI_QUALITY_DEFAULT_DAYS = 30;

/**
 * One row per rate: label, the RPC field, what "good" looks like, and the
 * counts it is made of (shown beside it). `goodWhen` drives the badge only.
 */
export const ARI_QUALITY_RATES = [
  { key: "flow_completion", label: "Setups finished", goodWhen: "high", target: 0.7, of: (m) => `${m.flows?.completed ?? 0} of ${m.flows?.started ?? 0} setups` },
  { key: "park", label: "Setups set aside", goodWhen: "low", target: null, of: (m) => `${m.flows?.parked ?? 0} of ${m.flows?.started ?? 0} setups` },
  { key: "refusal", label: "Ari said it could not help", goodWhen: "low", target: null, of: (m) => `${m.turns?.refusals ?? 0} of ${m.turns?.ari_replies ?? 0} replies` },
  { key: "repeat_request", label: "Host asked again", goodWhen: "low", target: 0.03, of: (m) => `${m.turns?.repeat_requests ?? 0} of ${m.turns?.host_turns ?? 0} host turns` },
  { key: "empty_reply", label: "Empty replies", goodWhen: "low", target: 0, of: (m) => `${m.turns?.empty_replies ?? 0} of ${m.turns?.ari_replies ?? 0} replies` },
  { key: "thumbs_up", label: "Thumbs up", goodWhen: "high", target: null, of: (m) => `${m.feedback?.up ?? 0} up · ${m.feedback?.down ?? 0} down` },
];

/** A 0..1 rate as a percentage; null (no data) stays "No data". */
export function formatRate(value) {
  if (value === null || value === undefined || value === "") return "No data";
  const number = Number(value);
  if (!Number.isFinite(number)) return "No data";
  const percent = number * 100;
  return `${percent >= 10 || percent === 0 ? Math.round(percent) : percent.toFixed(1)}%`;
}

/** Whether a rate meets its target: "good", "bad", or null (no target / no data). */
export function rateVerdict(row, value) {
  if (row.target === null || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (row.goodWhen === "high") return number >= row.target ? "good" : "bad";
  return number <= row.target ? "good" : "bad";
}

/** The rate rows for a metrics payload from ari_admin_quality_metrics. */
export function qualityRows(metrics) {
  const rates = metrics?.rates || {};
  return ARI_QUALITY_RATES.map((row) => ({
    key: row.key,
    label: row.label,
    value: formatRate(rates[row.key]),
    detail: row.of(metrics || {}),
    verdict: rateVerdict(row, rates[row.key]),
  }));
}

const FLOW_LABELS = {
  create_event: "Event",
  create_trip: "Trip",
  create_experience: "Experience",
  create_venue: "Venue",
  create_stay: "Stay",
  website_setup: "Website setup",
  import_contacts: "Contact import",
};

export function flowLabel(flowKey) {
  return FLOW_LABELS[flowKey] || String(flowKey || "Other").replace(/_/g, " ");
}

/** Turns-to-done rows, most completed first, labelled. */
export function turnsToDoneRows(metrics) {
  const rows = Array.isArray(metrics?.turns_to_done) ? metrics.turns_to_done : [];
  return rows
    .filter((row) => row && typeof row.flow_key === "string")
    .map((row) => ({
      flow_key: row.flow_key,
      label: flowLabel(row.flow_key),
      completed: Number(row.completed) || 0,
      avg: row.avg_turns === null || row.avg_turns === undefined ? "—" : String(row.avg_turns),
      median: row.median_turns === null || row.median_turns === undefined ? "—" : String(row.median_turns),
    }))
    .sort((a, b) => b.completed - a.completed || a.label.localeCompare(b.label));
}

/** True when the window has nothing at all to show. */
export function qualityIsEmpty(metrics) {
  if (!metrics) return true;
  const flows = Number(metrics.flows?.started) || 0;
  const turns = (Number(metrics.turns?.host_turns) || 0) + (Number(metrics.turns?.ari_replies) || 0);
  const feedback = (Number(metrics.feedback?.up) || 0) + (Number(metrics.feedback?.down) || 0);
  return flows + turns + feedback === 0;
}
