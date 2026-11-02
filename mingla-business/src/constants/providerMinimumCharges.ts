/**
 * Issue #3355 P6 — Seth's decision 6: a paid ticket price must be at least
 * the payment provider's minimum charge for its currency.
 *
 * Source: Stripe "Minimum and maximum charge amounts"
 * (https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts),
 * limited to currencies Mingla prices in. BGN and ISK have no verified
 * minimum, so none is enforced for them. NGN (Paystack) is ₦100.00 = 10000
 * kobo: Seth's decision, 2026-11-01 (#3355), not Paystack's documentation.
 *
 * MIRROR of supabase/functions/_shared/money/providerMinimums.ts and the SQL
 * function public.issue_3355_provider_minimum_charge_minor(text). The Deno
 * parity test (supabase/functions/_shared/__tests__/
 * issue_3355_money_flow.implementor.test.ts) imports this file and fails when
 * the three drift. Dependency-free on purpose so that test can import it.
 *
 * Values are minor units (cents), the unit `price_cents` and Stripe use.
 */

export const PROVIDER_MINIMUM_CHARGE_MINOR: Readonly<Record<string, number>> =
  Object.freeze({
    CAD: 50,
    CHF: 50,
    CZK: 1500,
    DKK: 250,
    EUR: 50,
    GBP: 30,
    HUF: 17500,
    NGN: 10000,
    NOK: 300,
    PLN: 200,
    RON: 200,
    SEK: 300,
    USD: 50,
  });

export function providerMinimumChargeMinor(
  currency: string | null | undefined,
): number | null {
  if (typeof currency !== "string") return null;
  const code = currency.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(
    PROVIDER_MINIMUM_CHARGE_MINOR,
    code,
  )
    ? PROVIDER_MINIMUM_CHARGE_MINOR[code]
    : null;
}

/**
 * Currencies whose en-GB form is the bare code ("NGN 100.00") but whose own
 * symbol is unambiguous, so the host reads "₦100.00". Same list as Ari's.
 */
const NARROW_SYMBOL_CURRENCIES: ReadonlySet<string> = new Set(["NGN"]);

function formatMinimum(minor: number, code: string): string {
  // Every currency in the table uses two decimals.
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
      ...(NARROW_SYMBOL_CURRENCIES.has(code)
        ? { currencyDisplay: "narrowSymbol" as const }
        : {}),
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${code}`;
  }
}

/** The one sentence the ticket price field shows (Ari says the same words). */
export function ticketPriceMinimumMessage(
  currency: string | null | undefined,
): string | null {
  const minimum = providerMinimumChargeMinor(currency);
  if (minimum === null || typeof currency !== "string") return null;
  return `Paid tickets must be at least ${formatMinimum(
    minimum,
    currency.trim().toUpperCase(),
  )}. That's the smallest amount the payment provider can charge.`;
}

/**
 * The message when a typed paid price (major units, e.g. "0.20") is below the
 * provider minimum; null when free, unparsable, unknown-currency or enough.
 */
export function ticketPriceBelowMinimum(
  priceMajor: number,
  currency: string | null | undefined,
): string | null {
  if (!Number.isFinite(priceMajor) || priceMajor <= 0) return null;
  const minimum = providerMinimumChargeMinor(currency);
  if (minimum === null) return null;
  return Math.round(priceMajor * 100) < minimum
    ? ticketPriceMinimumMessage(currency)
    : null;
}
