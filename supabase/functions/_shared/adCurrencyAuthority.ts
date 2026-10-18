/**
 * Issue #3697 v1.4 — server-side Ads currency authority.
 *
 * Host-facing money is denominated by the brand's verified payout rail. Edge
 * functions must resolve it through the database contract and compare provider
 * objects against it; a request body's currency is never an authority.
 */

// deno-lint-ignore no-explicit-any
type RpcClient = { rpc: (...args: any[]) => any };

export type AdBrandCurrencyAuthority = {
  resolved: boolean;
  currency: string | null;
  provider: string | null;
  rail_currency?: string | null;
  reason: string | null;
};

export type AdBrandCurrencyResolution =
  | { ok: true; currency: string; authority: AdBrandCurrencyAuthority }
  | { ok: false; detail: string; authority: AdBrandCurrencyAuthority | null };

const ISO_CURRENCY = /^[A-Z]{3}$/;

export async function resolveAdBrandCurrency(
  supabase: RpcClient,
  brandId: string,
): Promise<AdBrandCurrencyResolution> {
  const { data, error } = await supabase.rpc("ad_brand_currency_authority", {
    p_brand_id: brandId,
  });
  if (error) {
    return {
      ok: false,
      detail: "currency_authority_lookup_failed",
      authority: null,
    };
  }
  const authority = data && typeof data === "object"
    ? data as AdBrandCurrencyAuthority
    : null;
  const currency = typeof authority?.currency === "string"
    ? authority.currency.trim().toUpperCase()
    : "";
  if (authority?.resolved !== true || !ISO_CURRENCY.test(currency)) {
    return {
      ok: false,
      detail: authority?.reason ?? "currency_authority_unresolved",
      authority,
    };
  }
  return { ok: true, currency, authority };
}
