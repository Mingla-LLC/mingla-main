/**
 * #3342 — turnout forecast display copy.
 *
 * The forecast engine writes plain numbers, ISO currency codes and ISO dates
 * into its sentences ("Spend about 362083 NGN on ads…", "2026-10-13"), and the
 * AI passes echo the ISO date it was given. This module is the display
 * transform that turns those into what an organiser reads everywhere else in
 * the app: "₦362,083", "~$2,394", "Tue 13 Oct".
 *
 * Display only, like `safePromoCopy`: the engine and the stored report are
 * untouched, so forecasts saved before this change render correctly too.
 * Money uses the report's OWN currency and nothing else — a report with no
 * currency keeps its numbers as written (#962: never fabricate a currency).
 */
import type { TurnoutReport } from "../types/growthTools";
import {
  currencyCodeOrNull,
  formatCount,
  formatCurrency,
  formatCurrencyRound,
} from "./currency";
import { formatShortDate } from "./eventDateDisplay";

/** The currency a forecast was modelled in: the plan's, the echoed event's, then the caller's. */
export const turnoutReportCurrency = (
  report: TurnoutReport | null | undefined,
  fallbackCurrency?: string | null,
): string | null => {
  const plan = report?.plan as { currency?: unknown } | undefined;
  const event = report?.event as { currency?: unknown } | undefined;
  const asCode = (value: unknown): string | null =>
    typeof value === "string" ? currencyCodeOrNull(value) : null;
  return (
    asCode(plan?.currency) ??
    asCode(event?.currency) ??
    currencyCodeOrNull(fallbackCurrency)
  );
};

/**
 * A forecast amount: "₦362,083", "$0.50". Whole amounts and anything from 100
 * up drop the decimals; a small fractional amount keeps its cents. With no
 * currency it is a grouped number, never a made-up symbol.
 */
export const formatTurnoutMoney = (
  value: number | null | undefined,
  currency: string | null,
): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (currency === null) return formatTurnoutCount(value);
  return Number.isInteger(value) || Math.abs(value) >= 100
    ? formatCurrencyRound(value, currency)
    : formatCurrency(value, currency);
};

/** A forecast count with grouping: 1290 → "1,290". Decimals up to 2 are kept. */
export const formatTurnoutCount = (value: number | null | undefined): string =>
  typeof value === "number" && Number.isFinite(value)
    ? formatCount(Math.round(value * 100) / 100)
    : "—";

/**
 * A forecast day as the rest of the event wizard shows it: "Tue 13 Oct", with
 * the year added only when it is not this year. Accepts a calendar date
 * ("2026-10-13") or an instant, read in the organiser's own time zone.
 */
export const formatTurnoutDate = (value: string, now: Date = new Date()): string | null => {
  const calendar = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  let iso: string;
  if (calendar !== null) {
    const [, y, m, d] = calendar;
    const probe = new Date(Number(y), Number(m) - 1, Number(d));
    if (
      probe.getFullYear() !== Number(y) ||
      probe.getMonth() !== Number(m) - 1 ||
      probe.getDate() !== Number(d)
    ) {
      return null;
    }
    iso = value;
  } else {
    const instant = new Date(value);
    if (!Number.isFinite(instant.getTime())) return null;
    iso = [
      instant.getFullYear(),
      String(instant.getMonth() + 1).padStart(2, "0"),
      String(instant.getDate()).padStart(2, "0"),
    ].join("-");
  }
  const short = formatShortDate(iso);
  return iso.startsWith(`${now.getFullYear()}-`) ? short : `${short} ${iso.slice(0, 4)}`;
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A plain or grouped number as the engine and the AI write it: 362083, 1,290,590, 0.5
const NUMBER = "\\d[\\d,]*(?:\\.\\d+)?";
const toNumber = (raw: string): number => Number(raw.replace(/,/g, ""));

/**
 * Rewrite engine / AI copy for display: amounts in the report currency become
 * formatted money, ISO calendar dates become "Tue 13 Oct".
 *
 * @example humanizeTurnoutCopy("netting ~272 USD after ad spend", "USD") → "netting ~$272 after ad spend"
 * @example humanizeTurnoutCopy("(~1290590 NGN)", "NGN")                   → "(~₦1,290,590)"
 * @example humanizeTurnoutCopy("before 2026-10-13", null)                 → "before Tue 13 Oct"
 */
export const humanizeTurnoutCopy = (
  text: string,
  currency: string | null,
  now: Date = new Date(),
): string => {
  let out = text;
  if (currency !== null && /^[A-Z]{3}$/.test(currency) && out.includes(currency)) {
    const code = escapeRegExp(currency);
    const money = (raw: string): string => formatTurnoutMoney(toNumber(raw), currency);
    out = out
      // "5000–10000 NGN" → "₦5,000–₦10,000"
      .replace(
        new RegExp(`(${NUMBER})\\s?([–-])\\s?(${NUMBER})\\s?${code}\\b`, "g"),
        (_m, low: string, dash: string, high: string) => `${money(low)}${dash}${money(high)}`,
      )
      // "362083 NGN" → "₦362,083"
      .replace(new RegExp(`(${NUMBER})\\s?${code}\\b`, "g"), (_m, raw: string) => money(raw))
      // "NGN 362083" → "₦362,083"
      .replace(new RegExp(`\\b${code}\\s?(${NUMBER})`, "g"), (_m, raw: string) => money(raw));
  }
  return out.replace(/\b(\d{4}-\d{2}-\d{2})\b(?![T:\d])/g, (match: string) =>
    formatTurnoutDate(match, now) ?? match,
  );
};
