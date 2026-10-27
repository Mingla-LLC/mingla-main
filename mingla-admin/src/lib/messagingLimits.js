// Issue #4130 (Wave 2b) — Pricing and limits › Messaging limits.
//
// Pure helpers: no React, no Supabase. The server owns the limits
// (brand_messaging_limits, read through admin_messaging_limits_overview);
// these only turn what it returns into words and check what an admin types
// before it is sent.

/** Largest limit the server accepts (matches its check). */
export const MAX_MONTHLY_LIMIT = 10_000_000;

/** "1,000 a month", or "No limit" when the server says null. */
export function formatLimit(value) {
  if (value === null || value === undefined) return "No limit";
  return `${Number(value).toLocaleString("en-US")} a month`;
}

/** "123 / 3,000" (or "123 / No limit"). */
export function formatUsage(used, limit) {
  const u = Number(used ?? 0).toLocaleString("en-US");
  if (limit === null || limit === undefined) return `${u} / No limit`;
  return `${u} / ${Number(limit).toLocaleString("en-US")}`;
}

/** Share of the limit used, 0–100, or null when there is no limit. */
export function usagePercent(used, limit) {
  if (limit === null || limit === undefined) return null;
  const cap = Number(limit);
  if (!Number.isFinite(cap) || cap <= 0) return Number(used) > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, (Number(used ?? 0) / cap) * 100));
}

/** "Near the limit" from 80%, "At the limit" from 100%. */
export function usageTone(used, limit) {
  const pct = usagePercent(used, limit);
  if (pct === null) return "default";
  if (pct >= 100) return "error";
  if (pct >= 80) return "warning";
  return "default";
}

/**
 * Parse one limit field. Whole numbers only. `allowBlank` (push) treats an
 * empty field or "no limit" as unlimited (null).
 * Returns { value } or { error } with words an admin can act on.
 */
export function parseLimitInput(raw, { allowBlank = false, label = "This limit" } = {}) {
  const text = String(raw ?? "").trim().replace(/,/g, "");
  if (text === "" || /^no\s*limit$/i.test(text)) {
    return allowBlank ? { value: null } : { error: `${label} needs a number.` };
  }
  if (!/^\d+$/.test(text)) return { error: `${label} must be a whole number.` };
  const value = Number(text);
  if (value > MAX_MONTHLY_LIMIT) return { error: `${label} can be at most ${MAX_MONTHLY_LIMIT.toLocaleString("en-US")}.` };
  return { value };
}

/** The "warn the host after this many blasts in a week" field: 1–1,000. */
export function parseWeekWarningInput(raw) {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return { error: "Enter how many blasts in a week, e.g. 3." };
  const value = Number(text);
  if (value < 1 || value > 1000) return { error: "Use a number from 1 to 1,000." };
  return { value };
}

/** Start of the next calendar month after `now`, in UTC (limits reset on the 1st, UTC). */
export function startOfNextMonthUtc(now = new Date(), monthsAhead = 1) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsAhead, 1));
}

/**
 * The "Until" choices for a raised limit. `ends_at` is the instant the
 * override stops applying (null = no end date).
 */
export function untilOptions(now = new Date()) {
  return [
    { id: "this_month", label: "End of this month", endsAt: startOfNextMonthUtc(now, 1).toISOString() },
    { id: "next_month", label: "End of next month", endsAt: startOfNextMonthUtc(now, 2).toISOString() },
    { id: "date", label: "Pick a date", endsAt: undefined },
    { id: "none", label: "No end date", endsAt: null },
  ];
}

/** A picked calendar day (YYYY-MM-DD) → the end of that day in UTC, or an error. */
export function endsAtFromDay(day, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day ?? ""))) return { error: "Pick the last day the limits apply." };
  const [y, m, d] = String(day).split("-").map(Number);
  // #4130: a day that does not exist (2026-02-30, 2026-13-01) is refused, not
  // rolled over into the next month.
  const day0 = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(day0.getTime()) || day0.getUTCFullYear() !== y || day0.getUTCMonth() !== m - 1 || day0.getUTCDate() !== d) {
    return { error: "That date doesn't exist. Pick the last day the limits apply." };
  }
  const end = new Date(Date.UTC(y, m - 1, d + 1));
  if (end.getTime() <= now.getTime()) return { error: "Pick a day that has not passed." };
  return { value: end.toISOString() };
}

/** Plain words for where a brand's limits come from. */
export function limitSourceLabel(row) {
  if (row?.source === "override") {
    return row?.override?.set_by_name ? `Raised by ${row.override.set_by_name}` : "Raised for this brand";
  }
  if (row?.override && row.override.active === false) return "Default (raise ended)";
  return "Default";
}

/** Server refusals in plain words. */
export function messagingLimitErrorMessage(error) {
  const msg = String(error?.message ?? error ?? "");
  if (msg.includes("not_authorized")) return "You don't have permission to change messaging limits.";
  if (msg.includes("reason_required")) return "Add a reason. It is saved with your name.";
  if (msg.includes("messaging_limit_out_of_bounds")) return "Limits must be whole numbers from 0 to 10,000,000, and the weekly warning from 1 to 1,000.";
  if (msg.includes("messaging_limit_end_in_past")) return "The end date has already passed. Pick a later one.";
  if (msg.includes("brand_not_found")) return "That brand could not be found.";
  return "Couldn't save the limits. Check your connection and try again.";
}
