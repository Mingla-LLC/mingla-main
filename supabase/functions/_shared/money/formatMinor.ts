/**
 * Issue #3355 P6 (D-28) — one money formatter for everything Ari shows.
 *
 * Mingla stores money the way the payment providers take it: an integer
 * amount in the currency's provider minor unit (`price_cents`,
 * `budget_cents`…). Before this module Ari printed `(cents / 100).toFixed(2)`,
 * so a zero-decimal currency read "500.00 ISK" and a yen amount was divided
 * by a hundred.
 *
 * Display digits come from ISO 4217 through
 * `Intl.NumberFormat(…).resolvedOptions().maximumFractionDigits` (ISK, JPY:
 * 0; GBP, NGN: 2). The divisor is the same ISO exponent, except where Stripe
 * keeps a two-decimal wire representation for a currency ISO made
 * zero-decimal (ISK and UGX: "to charge 5 ISK, provide an amount value of
 * 500", https://docs.stripe.com/currencies#special-cases). Mingla follows
 * Stripe there, so 50000 stored ISK is 500 kr, shown with no decimals.
 */

/** Stripe's documented two-decimal wire form for ISO zero-decimal currencies. */
const PROVIDER_TWO_DECIMAL_WIRE: ReadonlySet<string> = new Set(["ISK", "UGX"]);

function normaliseCurrency(currency: unknown): string | null {
  if (typeof currency !== "string") return null;
  const code = currency.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/** ISO 4217 display digits for a currency (2 when the runtime doesn't know it). */
export function currencyFractionDigits(currency: unknown): number {
  const code = normaliseCurrency(currency);
  if (!code) return 2;
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: code })
      .resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** How many stored minor units make one major unit for this currency. */
export function minorUnitsPerMajor(currency: unknown): number {
  const code = normaliseCurrency(currency);
  if (code && PROVIDER_TWO_DECIMAL_WIRE.has(code)) return 100;
  return 10 ** currencyFractionDigits(code);
}

/** A stored minor amount as a major-unit number (50000 ISK → 500). */
export function majorFromMinor(minor: number, currency: unknown): number {
  return minor / minorUnitsPerMajor(currency);
}

/** A major-unit amount as the stored minor integer (500 ISK → 50000). */
export function minorFromMajor(major: number, currency: unknown): number {
  return Math.round(major * minorUnitsPerMajor(currency));
}

function digitsOnly(major: number, currency: unknown): string {
  const digits = currencyFractionDigits(currency);
  return new Intl.NumberFormat("en", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(major);
}

/**
 * The bare amount with the currency's own decimals and no symbol
 * ("300.00" NGN, "500" ISK). Callers that print "<amount> <CODE>" use this.
 * Not a safe integer → null (never a made-up number).
 */
export function formatMinorAmount(
  minor: unknown,
  currency: unknown,
): string | null {
  const value = Number(minor);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return digitsOnly(majorFromMinor(value, currency), currency);
}

/** "<amount> <CODE>", or the bare amount when no currency is known. */
export function formatMinorWithCode(
  minor: unknown,
  currency: unknown,
): string | null {
  const amount = formatMinorAmount(minor, currency);
  if (amount === null) return null;
  const code = normaliseCurrency(currency);
  return code ? `${amount} ${code}` : amount;
}

/** The same for an amount already in major units (draft ticket prices). */
export function formatMajorWithCode(
  major: unknown,
  currency: unknown,
): string | null {
  const value = Number(major);
  if (!Number.isFinite(value) || value < 0) return null;
  const amount = digitsOnly(value, currency);
  const code = normaliseCurrency(currency);
  return code ? `${amount} ${code}` : amount;
}

/**
 * Owner-facing currency text ("£35.00", "ISK 500", "₦5,000.00").
 * Unknown currency → the bare amount, never a guessed symbol.
 */
export function formatMinor(
  minor: unknown,
  currency: unknown,
  locale = "en-GB",
): string | null {
  const value = Number(minor);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  const code = normaliseCurrency(currency);
  const major = majorFromMinor(value, code);
  if (!code) return digitsOnly(major, null);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: code })
      .format(major);
  } catch {
    return `${digitsOnly(major, code)} ${code}`;
  }
}
