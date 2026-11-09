// #4273 item 10 — SMS prices are automatic.
//
// The live source of SMS prices is the table public.sms_country_prices
// (service-role only, RLS on, no public read). One row per country:
//   - Twilio countries (US, CA and the 32 European ones) are refreshed daily
//     by the sms-price-refresh edge function from Twilio's Pricing API.
//   - Nigeria (Termii) is fixed at NGN 5.00 per segment (#4080 account
//     evidence) and never expires.
//   - The migration seeds US (USD 0.0083) and NG so both are priced the moment
//     this deploys, before the first fetch.
// A price is never "too old to quote": the last good price keeps quoting and
// the api-health-probe raises a staleness alert after 7 days without a
// refresh. A country with no row is honestly skipped ("can't text their
// country yet"). The quote seals the rateId and the per-person cost it used,
// so the send equals the quote.
//
// The old hand-replaced secret book (offering_invite_sms_price_book_v1 in
// MINGLA_RUNTIME_CONFIG_JSON) is no longer read by any quote or send: its
// entries expire 2026-11-22 and a whole-book expiry is exactly what this
// replaces. The runtime-config field still parses, so the secret can be left
// as is or the field dropped at the next bundle rebuild.

import { MAPPED_COUNTRIES } from "./e164Country.ts";
import { smsMarketingRoute } from "./smsCountries.ts";

export const SMS_PRICE_TABLE = "sms_country_prices";

/** The provider a country is priced on: Termii for NG, Twilio otherwise. Kept
 * free of the SMS adapter so price readers carry no provider credentials. */
function smsProviderForCountry(country: string): "twilio" | "termii" {
  return smsMarketingRoute(country, true) === "termii" ? "termii" : "twilio";
}
/** A price older than this is quoted but alerted on. */
export const SMS_PRICE_STALE_MS = 7 * 24 * 60 * 60 * 1000;
/** A fetched price more than this far from the last good one is refused. */
export const SMS_PRICE_MAX_CHANGE = 0.5;
const NEVER = "9999-12-31T23:59:59.000Z";

/** One per-segment SMS price the quote and send use (#4080 shape). */
export interface SmsRateV1 {
  rateId: string;
  provider: "twilio" | "termii";
  country: string;
  currency: string;
  unit: "sms_segment";
  minorNumerator: number;
  minorDenominator: number;
  effectiveAt: string;
  expiresAt: string;
  sourceReference: string;
}

export interface SmsCountryPriceRow {
  country: string;
  provider: "twilio" | "termii";
  currency: string;
  minor_numerator: number;
  minor_denominator: number;
  source: "twilio_pricing_api" | "termii_fixed" | "seed_4080";
  source_reference: string;
  fetched_at: string;
}

/**
 * Rows → the rates the quote prices with. A row that is malformed, on the
 * wrong route, or for a country Mingla cannot map is left out (that country
 * reads as unpriced) — one bad row never fails every quote.
 */
export function smsRatesFromRows(rows: unknown): SmsRateV1[] {
  if (!Array.isArray(rows)) return [];
  const out: SmsRateV1[] = [];
  for (const raw of rows) {
    const row = raw as Partial<SmsCountryPriceRow> | null;
    if (
      typeof row?.country !== "string" ||
      !MAPPED_COUNTRIES.includes(row.country) ||
      row.provider !== smsProviderForCountry(row.country) ||
      typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency) ||
      !Number.isSafeInteger(row.minor_numerator) ||
      (row.minor_numerator as number) <= 0 ||
      !Number.isSafeInteger(row.minor_denominator) ||
      (row.minor_denominator as number) <= 0 ||
      typeof row.fetched_at !== "string" ||
      !Number.isFinite(Date.parse(row.fetched_at)) ||
      out.some((rate) => rate.country === row.country)
    ) {
      continue;
    }
    const at = new Date(Date.parse(row.fetched_at)).toISOString();
    out.push({
      rateId: `${row.provider}-${row.country.toLowerCase()}-${at}`,
      provider: row.provider,
      country: row.country,
      currency: row.currency,
      unit: "sms_segment",
      minorNumerator: row.minor_numerator as number,
      minorDenominator: row.minor_denominator as number,
      effectiveAt: at,
      expiresAt: NEVER,
      sourceReference: `${row.source ?? "unknown"}:${
        row.source_reference ?? ""
      }`,
    });
  }
  return out;
}

// deno-lint-ignore no-explicit-any
type Db = any;

/**
 * Read the live prices. Throws cost_unavailable:sms_rate_book_missing when the
 * table cannot be read or is empty, so quotes fail closed rather than read as
 * "every country unpriced".
 */
export async function loadSmsRates(db: Db): Promise<SmsRateV1[]> {
  const { data, error } = await db
    .from(SMS_PRICE_TABLE)
    .select(
      "country, provider, currency, minor_numerator, minor_denominator, source, source_reference, fetched_at",
    );
  if (error) throw new Error("cost_unavailable:sms_rate_book_missing");
  const rates = smsRatesFromRows(data);
  if (rates.length === 0) {
    throw new Error("cost_unavailable:sms_rate_book_missing");
  }
  return rates;
}

/** The send guard's view: null when prices cannot be read (fail safe). */
export async function loadSmsRoutes(
  db: Db,
): Promise<Array<Pick<SmsRateV1, "country" | "provider">> | null> {
  try {
    return (await loadSmsRates(db)).map(({ country, provider }) => ({
      country,
      provider,
    }));
  } catch {
    return null;
  }
}

/**
 * "0.0560" dollars → minor-unit fraction (5.60 cents = 560/100). Exact: no
 * floating point.
 */
export function decimalToMinorFraction(
  value: string,
): { numerator: number; denominator: number } | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (match === null) return null;
  const fraction = match[2] ?? "";
  const digits = BigInt(`${match[1]}${fraction}`);
  const scale = fraction.length - 2;
  const numerator = scale >= 0 ? digits : digits * 10n ** BigInt(-scale);
  const denominator = scale >= 0 ? 10n ** BigInt(scale) : 1n;
  if (numerator <= 0n) return null;
  const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
  const g = gcd(numerator, denominator);
  const n = numerator / g, d = denominator / g;
  if (
    n > BigInt(Number.MAX_SAFE_INTEGER) || d > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }
  return { numerator: Number(n), denominator: Number(d) };
}

export interface ParsedTwilioPrice {
  country: string;
  currency: string;
  price: string;
  numerator: number;
  denominator: number;
}

/**
 * Twilio Pricing API v1 `GET /v1/Messaging/Countries/{ISO}` → ONE outbound
 * price per segment: the HIGHEST `current_price` across every carrier and
 * number type in `outbound_sms_prices`, so a quote never under-states the
 * cost whatever carrier or sender type Twilio uses.
 */
export function parseTwilioMessagingPrice(
  body: unknown,
  expectedCountry: string,
): ParsedTwilioPrice {
  const json = body as {
    iso_country?: unknown;
    price_unit?: unknown;
    outbound_sms_prices?: unknown;
  } | null;
  if (json?.iso_country !== expectedCountry) {
    throw new Error("sms_price_wrong_country");
  }
  if (
    typeof json.price_unit !== "string" || !/^[A-Z]{3}$/.test(json.price_unit)
  ) {
    throw new Error("sms_price_bad_currency");
  }
  if (!Array.isArray(json.outbound_sms_prices)) {
    throw new Error("sms_price_no_outbound");
  }
  let best: { price: string; value: number } | null = null;
  for (const carrier of json.outbound_sms_prices) {
    const prices = (carrier as { prices?: unknown })?.prices;
    if (!Array.isArray(prices)) continue;
    for (const entry of prices) {
      const raw = (entry as { current_price?: unknown })?.current_price;
      const price = typeof raw === "number" ? String(raw) : raw;
      if (typeof price !== "string" || decimalToMinorFraction(price) === null) {
        continue;
      }
      const value = Number(price);
      if (best === null || value > best.value) best = { price, value };
    }
  }
  if (best === null) throw new Error("sms_price_no_outbound");
  const fraction = decimalToMinorFraction(best.price) as {
    numerator: number;
    denominator: number;
  };
  return {
    country: expectedCountry,
    currency: json.price_unit,
    price: best.price,
    numerator: fraction.numerator,
    denominator: fraction.denominator,
  };
}

/**
 * The sanity guard. A fetched price is refused when it is not positive, not in
 * the expected currency, or more than ±50% from the last good price for that
 * country. Null = accept.
 */
export function smsPriceRejection(
  next: { currency: string; numerator: number; denominator: number },
  last:
    | { currency: string; minor_numerator: number; minor_denominator: number }
    | null,
  expectedCurrency = "USD",
): string | null {
  if (!(next.numerator > 0) || !(next.denominator > 0)) return "not_positive";
  if (next.currency !== expectedCurrency) return "wrong_currency";
  if (last === null) return null;
  if (last.currency !== next.currency) return "currency_changed";
  const before = last.minor_numerator / last.minor_denominator;
  const after = next.numerator / next.denominator;
  if (before <= 0) return null;
  const change = Math.abs(after - before) / before;
  return change > SMS_PRICE_MAX_CHANGE ? "changed_over_50_percent" : null;
}

/** How many recent accepted prices the guard's anchor is the median of. */
export const SMS_PRICE_ANCHOR_WINDOW = 7;

/**
 * #4273 tester P3 — the guard's long anchor: the LOWER median of the last
 * {@link SMS_PRICE_ANCHOR_WINDOW} accepted prices for one country (newest
 * first in `history`). Comparing only with yesterday's price lets a bad feed
 * creep up 1.5x a day forever; against this median a drift is refused until
 * most of the last week's accepted prices already agree with it, so a creep
 * stalls and the refusals alert ops every day it is tried. A real Twilio
 * price change (one step, then stable) is still taken on the first day it is
 * within 50% of the median, which every real change we have seen is.
 * Null when there is no history (then only the last good price is checked).
 */
export function smsPriceAnchor(
  history: ReadonlyArray<
    { currency: string; minor_numerator: number; minor_denominator: number }
  >,
):
  | { currency: string; minor_numerator: number; minor_denominator: number }
  | null {
  const recent = history.slice(0, SMS_PRICE_ANCHOR_WINDOW);
  if (recent.length === 0) return null;
  const sorted = [...recent].sort((a, b) =>
    a.minor_numerator / a.minor_denominator -
    b.minor_numerator / b.minor_denominator
  );
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** Countries whose Twilio price is refreshed (every Twilio-routed country). */
export function twilioPricedCountries(): string[] {
  return MAPPED_COUNTRIES.filter((country) =>
    smsProviderForCountry(country) === "twilio"
  );
}

/**
 * The staleness alert: refreshed rows (not the fixed Termii price) older than
 * 7 days are still quoted, and named here. Null when nothing is stale.
 */
export function smsPriceStalenessAlert(
  now: Date,
  rows:
    | ReadonlyArray<
      Pick<SmsCountryPriceRow, "country" | "source" | "fetched_at">
    >
    | null,
): { subject: string; paragraphs: string[] } | null {
  if (rows === null) {
    return {
      subject: "[SMS] SMS prices can't be read",
      paragraphs: [
        `The ${SMS_PRICE_TABLE} table could not be read. Every SMS quote fails closed until it can.`,
      ],
    };
  }
  const stale = rows.filter((row) =>
    row.source !== "termii_fixed" &&
    now.getTime() - Date.parse(row.fetched_at) > SMS_PRICE_STALE_MS
  ).map((row) => row.country).sort();
  if (stale.length === 0) return null;
  return {
    subject: `[SMS] SMS prices not refreshed for 7+ days (${stale.length})`,
    paragraphs: [
      `No fresh Twilio price for: ${
        stale.join(", ")
      }. Quotes keep using the last good price.`,
      "Check the sms-price-refresh function logs and its daily cron (issue_4273_sms_price_refresh).",
    ],
  };
}
