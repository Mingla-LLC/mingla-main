/**
 * #4490 click-test D10 — what the add-venue Review step says (pure, tested).
 * Plain words a host reads: the full type label, money with its symbol and
 * thousands, the phone with its country code, the hours and the features the
 * venue starts with.
 */
import type { BrandHourEntry } from "../../types/brand";
import { venueTypeOption } from "../../types/venueFeatures";
import { currencySymbol } from "../ui/fieldModels";
import { dayWindows, normalizeHoursWeek } from "../../utils/venueBrandHours";

/** "Play and games" for "play"; "—" when unset. */
export function venueTypeLabel(category: string | null | undefined): string {
  return venueTypeOption(category)?.label ?? "—";
}

function money(raw: string, currency: string | null): string | null {
  const digits = raw.replace(/[,\s]/g, "").trim();
  if (digits.length === 0) return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return raw.trim();
  const amount = n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
  const symbol = currencySymbol(currency);
  return symbol.length > 0 ? `${symbol}${amount}` : amount;
}

/** "₦5,000 – ₦25,000", "From ₦5,000", or "—". */
export function priceRangeLabel(
  minInput: string | null | undefined,
  maxInput: string | null | undefined,
  currency: string | null,
): string {
  const min = money(minInput ?? "", currency);
  const max = money(maxInput ?? "", currency);
  if (min === null) return "—";
  if (max === null) return `From ${min}`;
  return `${min} – ${max}`;
}

/** "+234 801 234 5678" style: the country code, then the number as typed. */
export function phoneWithCode(dialCode: string, phone: string): string {
  const number = phone.trim();
  if (number.length === 0) return "";
  if (number.startsWith("+")) return number;
  const local = number.replace(/^0+/, "");
  return `${dialCode} ${local}`.trim();
}

const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function dayText(entry: BrandHourEntry): string {
  if (entry.isClosed) return "Closed";
  // #4490 N16: earliest window first.
  return dayWindows(entry)
    .filter((w) => (w.openTime ?? "").length > 0 && (w.closeTime ?? "").length > 0)
    .map((w) => `${w.openTime}–${w.closeTime}`)
    .join(", ");
}

/** ["Mon to Sat · 09:00–17:00", "Sun · Closed"]: runs of days with the same hours. */
export function hoursWeekLines(hours: readonly BrandHourEntry[]): string[] {
  const week = normalizeHoursWeek(hours);
  const lines: string[] = [];
  let start = 0;
  for (let i = 1; i <= week.length; i++) {
    if (i < week.length && dayText(week[i]) === dayText(week[start])) continue;
    const first = SHORT[week[start].weekday] ?? "";
    const last = SHORT[week[i - 1].weekday] ?? "";
    const days = i - 1 === start ? first : i - 1 === start + 1 ? `${first}, ${last}` : `${first} to ${last}`;
    lines.push(`${days} · ${dayText(week[start])}`);
    start = i;
  }
  return lines;
}
