/**
 * brandPayoutCountryService — #3645: remembers the payout country a host
 * picked (`brands.payout_country`).
 *
 * DISPLAY-ONLY. The column answers one question: which country row the
 * payout-country picker shows for this brand. Nothing reads it to decide tax,
 * a payment rail, a currency or an address; those stay with `country_code`,
 * `payment_country`, `payment_provider` and `default_currency`.
 *
 * It is written in its OWN update, after the pick itself has been saved, and a
 * failure here never fails the pick: the host's currency and rail are already
 * correct, and the picker falls back to deriving the country from the currency
 * exactly as it did before the column existed. That also keeps a build that
 * reaches a database without the column (the app can ship before the
 * migration is applied) fully working.
 */

import { supabase } from "./supabase";

const ISO2 = /^[A-Z]{2}$/;

/**
 * Saves (or, with null, clears) the remembered payout country.
 * Resolves true when the brand row was updated. Never throws.
 */
export async function rememberBrandPayoutCountry(
  brandId: string,
  countryCode: string | null,
): Promise<boolean> {
  const value = typeof countryCode === "string"
    ? countryCode.trim().toUpperCase()
    : null;
  if (value !== null && !ISO2.test(value)) return false;
  try {
    const { data, error } = await supabase
      .from("brands")
      .update({ payout_country: value })
      .eq("id", brandId)
      .is("deleted_at", null)
      .select("id");
    if (error !== null) {
      console.warn(
        "[brandPayoutCountry] the payout country pick was not remembered",
        { code: error.code ?? null },
      );
      return false;
    }
    return Array.isArray(data) && data.length === 1;
  } catch (error) {
    console.warn(
      "[brandPayoutCountry] the payout country pick was not remembered",
      { name: error instanceof Error ? error.name : "unknown" },
    );
    return false;
  }
}
