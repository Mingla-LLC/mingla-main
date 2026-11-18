/**
 * #4490 — pure models behind the smart-field primitives (MoneyField,
 * WeekdayChips, DurationSelect, LeadTimeSelect). No React, no RN: unit-tested.
 */

import { LOCAL_CURRENCY_GLYPHS } from "@mingla/offering-rendering/currencyGlyph";

import { minorFromMajor, normalizeCurrency } from "../../utils/currency";

// ---------------------------------------------------------------------------
// Money (stored in minor units; NGN has exponent 2, kobo — conflict 69)
// ---------------------------------------------------------------------------

/** The largest single amount the server takes in one go (int4). */
export const MONEY_MAX_MINOR = 2_147_483_647;

/** 0 for zero-decimal currencies (JPY…), else 2. Shares the currency util's list. */
export function moneyFractionDigits(currency: string): 0 | 2 {
  return minorFromMajor(1, normalizeCurrency(currency)) === 1 ? 0 : 2;
}

export function currencySymbol(currency: string | null | undefined): string {
  const code = (currency ?? "").trim().toUpperCase();
  if (code.length === 0) return "";
  const local = LOCAL_CURRENCY_GLYPHS[code];
  if (local !== undefined) return local;
  try {
    const parts = new Intl.NumberFormat("en", { style: "currency", currency: code }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}

export type MoneyParseResult =
  | { kind: "blank" }
  | { kind: "valid"; minor: number }
  | { kind: "invalid"; reason: "format" | "precision" | "range" };

/**
 * Parse what a host typed (or pasted) into exact integer minor units.
 * Accepts "5000", "5,000", "5000.50", "₦5,000", "NGN 5,000". Never floats.
 *   NGN "5000"    → 500000
 *   GBP "5000.00" → 500000
 */
export function parseMoneyInput(text: string, currency: string): MoneyParseResult {
  const code = normalizeCurrency(currency);
  let draft = text.trim();
  if (draft.length === 0) return { kind: "blank" };
  const symbol = currencySymbol(code);
  draft = draft.split(code).join("").split(code.toLowerCase()).join("");
  if (symbol.length > 0) draft = draft.split(symbol).join("");
  draft = draft.replace(/[\s  ]/g, "");
  if (draft.length === 0) return { kind: "invalid", reason: "format" };
  let whole: string;
  let fraction = "";
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(draft);
  if (match === null) return { kind: "invalid", reason: "format" };
  whole = match[1].replace(/,/g, "");
  fraction = match[2] ?? "";
  const scale = moneyFractionDigits(code);
  if (fraction.length > scale) return { kind: "invalid", reason: "precision" };
  whole = whole.replace(/^0+(?=\d)/, "");
  const digits = `${whole}${fraction.padEnd(scale, "0")}`.replace(/^0+(?=\d)/, "");
  if (digits.length > 10) return { kind: "invalid", reason: "range" };
  const minor = Number(digits);
  if (!Number.isSafeInteger(minor) || minor > MONEY_MAX_MINOR) {
    return { kind: "invalid", reason: "range" };
  }
  return { kind: "valid", minor };
}

/** The text a field shows for a stored amount. NGN 500000 → "5,000"; 500050 → "5,000.50". */
export function formatMoneyInput(minor: number | null, currency: string): string {
  if (minor === null || !Number.isFinite(minor)) return "";
  const code = normalizeCurrency(currency);
  const scale = moneyFractionDigits(code);
  const factor = scale === 0 ? 1 : 100;
  const whole = Math.trunc(minor / factor);
  const rest = Math.abs(minor % factor);
  const grouped = whole.toLocaleString("en-US");
  if (scale === 0 || rest === 0) return grouped;
  return `${grouped}.${String(rest).padStart(2, "0")}`;
}

export function moneyErrorCopy(reason: "format" | "precision" | "range", currency: string): string {
  if (reason === "precision") {
    return moneyFractionDigits(currency) === 0
      ? "Use whole amounts for this currency."
      : "Use at most two digits after the point.";
  }
  if (reason === "range") {
    return "That amount is too large to take in one go.";
  }
  return "Enter an amount, like 5,000.";
}

// ---------------------------------------------------------------------------
// Weekdays (0 = Monday … 6 = Sunday, the brand_hours convention)
// ---------------------------------------------------------------------------

export const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function toggleWeekday(days: readonly number[], day: number): number[] {
  const set = new Set(days);
  if (set.has(day)) set.delete(day);
  else set.add(day);
  return [...set].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
}

/** "Every day", "Mon to Thu", "Weekends", "Mon, Wed, Fri", "No days". */
export function weekdaysSummary(days: readonly number[]): string {
  const sorted = [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (sorted.length === 0) return "No days";
  if (sorted.length === 7) return "Every day";
  if (sorted.length === 2 && sorted[0] === 5 && sorted[1] === 6) return "Weekends";
  if (sorted.length === 5 && sorted.every((d, i) => d === i)) return "Weekdays";
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (consecutive && sorted.length >= 3) {
    return `${WEEKDAY_SHORT[sorted[0]]} to ${WEEKDAY_SHORT[sorted[sorted.length - 1]]}`;
  }
  return sorted.map((d) => WEEKDAY_SHORT[d]).join(", ");
}

// ---------------------------------------------------------------------------
// Durations (no 60-minute cap anywhere; spec 02 §4 hard rules)
// ---------------------------------------------------------------------------

/** Minutes value meaning "the whole day" (hire sessions). */
export const FULL_DAY_MINUTES = 1440;

export interface SelectOption<T> {
  value: T;
  label: string;
}

/** "15 min", "1 hour", "1 hour 30 min", "2 hours", "Full day". */
export function durationLabel(minutes: number, fullDay = false): string {
  if (fullDay && minutes === FULL_DAY_MINUTES) return "Full day";
  if (minutes <= 0) return "None";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 0 ? "" : h === 1 ? "1 hour" : `${h} hours`;
  const mins = m === 0 ? "" : `${m} min`;
  return [hours, mins].filter((part) => part.length > 0).join(" ");
}

/** 15-minute steps from `min` to `max` (default 15 min .. 24 h); optional "Full day". */
export function durationOptions(input: {
  min?: number;
  max?: number;
  step?: number;
  includeNone?: boolean;
  includeFullDay?: boolean;
} = {}): SelectOption<number>[] {
  const step = input.step ?? 15;
  const min = Math.max(step, input.min ?? step);
  const max = Math.min(24 * 60, input.max ?? 24 * 60);
  const out: SelectOption<number>[] = [];
  if (input.includeNone === true) out.push({ value: 0, label: "None" });
  for (let m = min; m <= max; m += step) out.push({ value: m, label: durationLabel(m) });
  if (input.includeFullDay === true && !out.some((o) => o.value === FULL_DAY_MINUTES)) {
    out.push({ value: FULL_DAY_MINUTES, label: "Full day" });
  } else if (input.includeFullDay === true) {
    const index = out.findIndex((o) => o.value === FULL_DAY_MINUTES);
    out[index] = { value: FULL_DAY_MINUTES, label: "Full day" };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lead times (hours, days, months presets)
// ---------------------------------------------------------------------------

export function leadTimeLabel(minutes: number): string {
  if (minutes <= 0) return "No notice";
  if (minutes % (30 * 1440) === 0) {
    const n = minutes / (30 * 1440);
    return n === 1 ? "1 month" : `${n} months`;
  }
  if (minutes % (7 * 1440) === 0 && minutes >= 7 * 1440) {
    const n = minutes / (7 * 1440);
    return n === 1 ? "1 week" : `${n} weeks`;
  }
  if (minutes % 1440 === 0) {
    const n = minutes / 1440;
    return n === 1 ? "1 day" : `${n} days`;
  }
  return durationLabel(minutes);
}

export function leadTimeOptions(input: { includeNone?: boolean } = {}): SelectOption<number>[] {
  const hours = [1, 2, 3, 6, 12, 24, 48, 72];
  const days = [4, 5, 7, 10, 14, 21, 28];
  const months = [1, 2, 3, 6];
  const values = [
    ...(input.includeNone === true ? [0] : []),
    ...hours.map((h) => h * 60),
    ...days.map((d) => d * 1440),
    ...months.map((m) => m * 30 * 1440),
  ];
  return values.map((value) => ({ value, label: leadTimeLabel(value) }));
}
