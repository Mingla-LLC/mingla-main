/**
 * #4271 — Tap to Pay countries Mingla supports, on the Stripe rail. Shared by the
 * native and web builds of useTapToPaySettingsEntry.
 *
 * #4389 (D2) — decided by the bank country (`payoutCountry`, the same truth the
 * server's Terminal path reads), not by the currency: a USD brand banked
 * outside the US is not a US brand. A brand with no bank country yet falls back
 * to its currency only until setup records one.
 * [TRANSITIONAL] currency fallback — exit when no live Stripe brand has a NULL
 * payout_country (the #4389 migration backfills GBP/USD brands).
 */
const TAP_TO_PAY_COUNTRIES = new Set(["GB", "US"]);
const COUNTRY_BY_CURRENCY: Readonly<Record<string, string>> = { GBP: "GB", USD: "US" };

export const tapToPayBrandEligible = (
  brand:
    | { paymentProvider?: string | null; defaultCurrency?: string | null; payoutCountry?: string | null }
    | null
    | undefined,
): boolean => {
  if (brand === null || brand === undefined || brand.paymentProvider === "paystack") return false;
  const country = (brand.payoutCountry ?? "").trim().toUpperCase();
  if (country.length > 0) return TAP_TO_PAY_COUNTRIES.has(country);
  const currency = (brand.defaultCurrency ?? "").trim().toUpperCase();
  return COUNTRY_BY_CURRENCY[currency] !== undefined;
};
