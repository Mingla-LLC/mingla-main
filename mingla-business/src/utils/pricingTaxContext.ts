/**
 * Client mirror of the configured-VAT rail used by allInPricingEngine.
 *
 * Nigeria is currently the only non-Stripe tax rail. The server remains the
 * authority: country_vat_config and the pricing RPC guard recompute/validate
 * this context before anything is saved or charged.
 */
export interface PricingTaxContext {
  paymentProvider?: "stripe" | "paystack" | null;
  paymentCountry?: string | null;
}

/** country_vat_config.NG — 7.5% in integer basis points. */
export const NIGERIA_VAT_RATE_BPS = 750 as const;

/** Returns the configured exclusive VAT rate, or null for Stripe-tax markets. */
export function configuredVatRateBps(
  context: PricingTaxContext,
): number | null {
  const provider = context.paymentProvider?.trim().toLowerCase();
  const country = context.paymentCountry?.trim().toUpperCase();
  return provider === "paystack" && country === "NG"
    ? NIGERIA_VAT_RATE_BPS
    : null;
}

export function usesConfiguredVat(context: PricingTaxContext): boolean {
  return configuredVatRateBps(context) !== null;
}
