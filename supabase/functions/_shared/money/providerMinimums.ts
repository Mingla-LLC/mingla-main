/**
 * Issue #3355 P6 — Seth's decision 6: a paid ticket price must be at least
 * the payment provider's minimum charge for its currency, so a ticket never
 * publishes and then fails at checkout.
 *
 * Source (verified 2026-11-01): Stripe "Minimum and maximum charge amounts",
 * https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts —
 * only currencies Mingla can price in (its Stripe payout countries) AND that
 * Stripe lists are here. BGN and ISK are not on Stripe's list, so they have
 * no minimum here (left out rather than guessed).
 *
 * NGN (Paystack): ₦100.00 = 10000 kobo. Source: Seth's decision, 2026-11-01
 * (#3355), not Paystack's documentation.
 *
 * Amounts are stored minor units (price_cents), the same unit Stripe takes.
 *
 * MIRRORS (kept identical by
 * `__tests__/issue_3355_money_flow.implementor.test.ts`):
 *   - SQL: public.issue_3355_provider_minimum_charge_minor(text) in
 *     supabase/migrations/20280228003355_issue_3355_paid_tier_terms_and_minimums.sql
 *   - Host: mingla-business/src/constants/providerMinimumCharges.ts
 */

import { formatMinor } from "./formatMinor.ts";

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

/** The minimum paid price in minor units, or null when none is known. */
export function providerMinimumChargeMinor(currency: unknown): number | null {
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
 * symbol is unambiguous, so the owner reads "₦100.00". Same list in the Host.
 */
const NARROW_SYMBOL_CURRENCIES: ReadonlySet<string> = new Set(["NGN"]);

function minimumText(minor: number, code: string): string {
  if (NARROW_SYMBOL_CURRENCIES.has(code)) {
    try {
      return new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: code,
        currencyDisplay: "narrowSymbol",
      }).format(minor / 100);
    } catch {
      // Fall through to the shared formatter.
    }
  }
  return formatMinor(minor, code) ?? `${(minor / 100).toFixed(2)} ${code}`;
}

/** The one owner sentence (Ari and the Host form say the same words). */
export function ticketPriceMinimumMessage(currency: string): string | null {
  const minimum = providerMinimumChargeMinor(currency);
  if (minimum === null) return null;
  return `Paid tickets must be at least ${
    minimumText(minimum, currency.trim().toUpperCase())
  }. That's the smallest amount the payment provider can charge.`;
}

/**
 * The message when a paid price is below the provider minimum; null when the
 * price is free, unknown-currency or at/above the minimum.
 */
export function ticketPriceBelowMinimum(
  priceMinor: number,
  currency: unknown,
): string | null {
  if (!Number.isFinite(priceMinor) || priceMinor <= 0) return null;
  if (typeof currency !== "string") return null;
  const minimum = providerMinimumChargeMinor(currency);
  if (minimum === null || priceMinor >= minimum) return null;
  return ticketPriceMinimumMessage(currency);
}
