/**
 * #4271 — Tap to Pay countries Mingla supports, on the Stripe rail. Shared by the
 * native and web builds of useTapToPaySettingsEntry.
 */
export const tapToPayBrandEligible = (
  brand: { paymentProvider?: string | null; defaultCurrency?: string | null } | null | undefined,
): boolean => {
  if (brand === null || brand === undefined || brand.paymentProvider === "paystack") return false;
  const currency = (brand.defaultCurrency ?? "").trim().toUpperCase();
  return currency === "GBP" || currency === "USD";
};
