/**
 * issue #4271 — the scanner invite's door-payments line. On its own so the
 * scanner screens do not load the whole door sale payment list
 * (doorPaymentOptions.ts re-exports it).
 *
 * Tap to Pay does not exist on the Paystack rail (Nigeria); it is named only
 * once the brand is known to be on Stripe.
 */
export const scannerDoorPaymentsCopy = (
  paymentProvider: "stripe" | "paystack" | null | undefined,
): string =>
  paymentProvider === "stripe"
    ? "Cash, manual, pay codes and Tap to Pay. Card money goes to your bank with online sales."
    : "Cash, manual and pay codes. Card money goes to your bank with online sales.";
