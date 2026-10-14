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

// ---------------------------------------------------------------------------
// #3645 — the remembered pick is a convenience and can go stale (a save that
// failed, or an older app build that changed the country without writing the
// column). It is never authoritative over a real payment account: wherever the
// app learns the account's country, the remembered pick is corrected to it.
// ---------------------------------------------------------------------------

const healedPicks = new Set<string>();

/**
 * Corrects the remembered payout country to the payment account's real one,
 * when they differ. Fire-and-forget: at most one write per brand and country
 * for the life of the page, and a failure changes nothing the host sees.
 */
export function healRememberedPayoutCountry(input: {
  brandId: string | null | undefined;
  rememberedCountry: string | null | undefined;
  accountCountry: string | null | undefined;
}): void {
  const brandId = input.brandId ?? null;
  const account = typeof input.accountCountry === "string"
    ? input.accountCountry.trim().toUpperCase()
    : "";
  if (brandId === null || !ISO2.test(account)) return;
  const remembered = typeof input.rememberedCountry === "string"
    ? input.rememberedCountry.trim().toUpperCase()
    : null;
  if (remembered === account) return;
  const key = `${brandId}:${account}`;
  if (healedPicks.has(key)) return;
  healedPicks.add(key);
  void rememberBrandPayoutCountry(brandId, account);
}

/**
 * The country of the brand's current card payment account, read straight from
 * the account row (the same read the refund history makes; payments viewers
 * only). Null when there is no live account, the reader may not see it, or the
 * read fails. Never throws.
 */
export async function fetchBrandCardAccountCountry(
  brandId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("stripe_connect_accounts")
      .select("country, detached_at")
      .eq("brand_id", brandId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ country: string | null; detached_at: string | null }>();
    if (error !== null || data === null || data.detached_at !== null) return null;
    const country = typeof data.country === "string"
      ? data.country.trim().toUpperCase()
      : "";
    return ISO2.test(country) ? country : null;
  } catch {
    return null;
  }
}
