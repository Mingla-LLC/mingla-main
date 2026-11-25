/**
 * #4490 — small venue value helpers split from venueFeaturePage.ts (which
 * re-exports them): a calendar date's short label and a plan payment's charge.
 * A leaf, so the venue screens that only need these never load the page model.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const asInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const WEEKDAY_SHORT_MON_FIRST = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

/** "Fri 25 Dec" from `2026-12-25`, with no timezone maths (a calendar date). */
export function venueDateLabel(date: string): string {
  if (!DATE_ONLY.test(date)) return date;
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(utc.getTime()) || utc.getUTCMonth() !== m - 1) return date;
  const mondayFirst = (utc.getUTCDay() + 6) % 7;
  return `${WEEKDAY_SHORT_MON_FIRST[mondayFirst]} ${d} ${MONTH_SHORT[m - 1]}`;
}

/** #4490 06-W4 fix 1 (W4-N2): a plan payment's money, in minor units, as the server charges it. */
export interface VenuePlanCharge {
  baseMinor: number;
  feeMinor: number;
  /** The VAT: added on top (`vatMode` "added") or the part of the base that is VAT ("included"). */
  taxMinor: number;
  /** What the payment page asks for. */
  totalMinor: number;
  vatMode: "added" | "included" | "none";
  vatRatePct: number;
}

/** A server charge block (`plans[].charge`, `plan.charge`, `paymentDue`); null when it is not one. Fail closed. */
export function parsePlanCharge(raw: unknown): VenuePlanCharge | null {
  if (!isRecord(raw)) return null;
  const base = asInt(raw.baseMinor);
  const total = asInt(raw.totalMinor) ?? asInt(raw.amountMinor);
  const tax = asInt(raw.taxMinor) ?? 0;
  const fee = asInt(raw.feeMinor) ?? 0;
  if (base === null || total === null || base < 0 || total < 0) return null;
  const rate = typeof raw.vatRatePct === "number" && Number.isFinite(raw.vatRatePct) ? raw.vatRatePct
    : typeof raw.vatRatePct === "string" && Number.isFinite(Number(raw.vatRatePct)) ? Number(raw.vatRatePct) : 0;
  return {
    baseMinor: base,
    feeMinor: fee,
    taxMinor: tax,
    totalMinor: total,
    vatMode: raw.vatMode === "added" || raw.vatMode === "included" ? raw.vatMode : "none",
    vatRatePct: rate,
  };
}
