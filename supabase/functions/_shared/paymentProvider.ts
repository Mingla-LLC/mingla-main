/**
 * paymentProvider — the (provider, country) routing spine (META-ORCH-1076).
 *
 * One source of truth for which money rail a brand settles through. Phase 1
 * resolves provider/country/currency from the brand row already loaded by
 * resolve_event_pricing_inputs; the (provider, country) tuple selects keys
 * (resolvePaystackSecretKey already exists in _shared/paystack.ts) + channel
 * capabilities downstream. Phase 2-5 + Ghana ADD config + a key pair here —
 * they never rewrite this resolver.
 *
 * HARD CONSTRAINT: default is ALWAYS 'stripe'. A brand becomes a Paystack brand
 * only by explicitly setting brands.payment_provider='paystack'. There are no
 * pre-existing NG/NGN brands, so this can only fire for net-new brands.
 *
 * Paystack docs cited where load-bearing:
 *   - Payment channels enum (NG allowlist; mobile_money is Ghana-only):
 *       https://paystack.com/docs/payments/payment-channels/
 *   - Supported countries/currencies (NG=NGN, accounts are country-specific):
 *       https://paystack.com/docs/api/miscellaneous/
 * Reference: Mingla_Artifacts/PAYSTACK_INTEGRATION_REFERENCE.md (Part 1.6, Part 5).
 */

export type PaymentProvider = "stripe" | "paystack";

export interface ProviderRouting {
  provider: PaymentProvider;
  country: string; // ISO-2, e.g. "NG"; "" when unknown
  currency: string; // "NGN" | "GBP" | ...; "" when unknown
}

export interface BrandProviderRow {
  payment_provider: PaymentProvider | string | null;
  payment_country: string | null;
  pricing_currency: string | null;
}

/**
 * Resolve the (provider, country, currency) tuple for a brand row.
 * Default-stripe: anything that is not the literal string 'paystack' resolves
 * to the Stripe rail (fail-safe — a corrupt/unknown value never silently routes
 * money to Paystack).
 */
export function resolveProviderRouting(brand: BrandProviderRow): ProviderRouting {
  const rawProvider = typeof brand.payment_provider === "string"
    ? brand.payment_provider.trim().toLowerCase()
    : "";
  const provider: PaymentProvider = rawProvider === "paystack" ? "paystack" : "stripe";
  const country = typeof brand.payment_country === "string"
    ? brand.payment_country.trim().toUpperCase()
    : "";
  const currency = typeof brand.pricing_currency === "string"
    ? brand.pricing_currency.trim().toUpperCase()
    : "";
  return { provider, country, currency };
}

/**
 * Paystack channel allowlist by country. NG = card|bank|ussd|bank_transfer.
 * NEVER includes mobile_money — that is Ghana/Kenya/CIV only (NOT Nigeria).
 * https://paystack.com/docs/payments/payment-channels/
 * Invariant I-PAYSTACK-NG-NO-MOBILE-MONEY.
 */
export function paystackChannelsForCountry(country: string): string[] {
  const iso = country.trim().toUpperCase();
  switch (iso) {
    case "NG":
      // Nigeria: card, bank (pay-with-bank), ussd, bank_transfer. NO mobile_money.
      return ["card", "bank", "ussd", "bank_transfer"];
    default:
      // Phase 1 only ships Nigeria. Any other country falls to a card-only safe
      // default (still NEVER mobile_money) until Phase 2+ adds its config.
      return ["card", "bank_transfer"];
  }
}
