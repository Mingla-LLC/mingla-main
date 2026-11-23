// Issue #4571 W6 — the SOP tooling's words and shapes, pure so node tests pin
// them: the weekly outreach numbers (rates shown as -- when the server says
// null, never 0%), merge counts, duplicate pair
// reasons and the nightly sweep's report. Every number comes from the server
// (crm_outreach_numbers, crm_cadence_state, crm_record_merge,
// crm_cadence_sweep_runs); nothing here counts or guesses.

/** A rate from the server (0..1 or null) as words. Null means nothing to divide by. */
export function rateWords(rate) {
  if (rate === null || rate === undefined || !Number.isFinite(Number(rate))) return "--";
  return `${Math.round(Number(rate) * 100)}%`;
}

export const OUTREACH_COLUMNS = Object.freeze([
  { key: "calls", label: "Calls" },
  { key: "connected", label: "Connected" },
  { key: "demos_booked", label: "Demos booked" },
  { key: "emails_sent", label: "Emails sent" },
  { key: "replies", label: "Replies" },
]);

/** Monday of the week holding `iso` (YYYY-MM-DD), as YYYY-MM-DD. */
export function weekStart(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  const dow = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - dow);
  return day.toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d + n));
  return day.toISOString().slice(0, 10);
}

/**
 * The server's answer as rows for the table: one row per rep (totals for the
 * week, with the rates the server computed) and, under each, the days that
 * have any number. Reps are in the server's order.
 */
export function outreachRows(data) {
  const reps = Array.isArray(data?.reps) ? data.reps : [];
  return reps.map((r) => ({
    rep: r.rep,
    name: r.name || r.rep,
    totals: r.totals || {},
    connectRate: rateWords(r.totals?.connect_rate),
    demoRate: rateWords(r.totals?.demo_rate),
    days: (Array.isArray(r.days) ? r.days : []).map((d) => ({
      ...d,
      connectRate: rateWords(d.connect_rate),
      demoRate: rateWords(d.demo_rate),
    })),
  }));
}

const MOVED_WORDS = [
  ["activity", "touch or note", "touches and notes"],
  ["identifiers", "contact", "contacts"],
  ["owners", "owner", "owners"],
  ["watchers", "watcher", "watchers"],
  ["demos", "demo", "demos"],
  ["files", "file", "files"],
  ["links", "Work link", "Work links"],
];

/** "Moved 4 touches and notes, 1 contact and 1 demo." */
export function mergeMovedWords(moved) {
  const bits = MOVED_WORDS
    .map(([key, one, many]) => {
      const n = Number(moved?.[key] || 0);
      return n > 0 ? `${n} ${n === 1 ? one : many}` : "";
    })
    .filter(Boolean);
  if (!bits.length) return "Nothing else needed moving.";
  const last = bits.pop();
  return `Moved ${bits.length ? `${bits.join(", ")} and ${last}` : last}.`;
}

export function pairReasonWords(reason) {
  switch (reason) {
    case "shared_email": return "Same email";
    case "shared_phone": return "Same phone";
    case "shared_handle": return "Same social handle";
    case "shared_website": return "Same website";
    case "similar_name": return "Similar name";
    default: return "Possible duplicate";
  }
}

export const SWEEP_MODES = Object.freeze([
  { value: "off", label: "Off" },
  { value: "dry_run", label: "Dry run" },
  { value: "apply", label: "On" },
]);

export function sweepModeWords(mode) {
  return SWEEP_MODES.find((m) => m.value === mode)?.label || "Off";
}

export const SWEEP_ACTION_WORDS = Object.freeze({
  lost: "To Lost",
  contacted: "Prospect to Contacted",
  advance: "Next round dated",
});
