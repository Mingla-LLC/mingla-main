/**
 * #4389 I-4389-NO-ZERO-VAT-FALLBACK — a Paystack brand with no VAT country
 * (`payment_country` NULL) must never be charged as if VAT were 0%.
 * `resolve_event_pricing_inputs` reports it as `vat_country_missing`; every
 * Paystack money path refuses with `brand_setup_incomplete` instead of
 * computing `vat_rate_bps ?? 0`.
 */

export const BRAND_SETUP_INCOMPLETE = "brand_setup_incomplete" as const;

export interface VatCountryRow {
  payment_provider?: string | null;
  payment_country?: string | null;
  vat_country_missing?: boolean | null;
}

export function vatCountryMissing(row: VatCountryRow, provider: string): boolean {
  if (provider.trim().toLowerCase() !== "paystack") return false;
  if (row.vat_country_missing === true) return true;
  // Older RPC shape (no column yet): read the country itself.
  return typeof row.payment_country !== "string" || row.payment_country.trim().length === 0;
}

export function assertVatCountryResolved(row: VatCountryRow, provider: string): void {
  if (vatCountryMissing(row, provider)) throw new Error(BRAND_SETUP_INCOMPLETE);
}
