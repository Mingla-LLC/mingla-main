/**
 * #4271 — the Tap to Pay product names (and the onboarding card built only from
 * them), on their own so records that only print the name (payment labels,
 * reconciliation, orders, CSV, Settings rows, brand onboarding) do not load every
 * Tap to Pay screen string into the shared web bundle. tapToPayCopy.ts
 * re-exports them.
 *
 * Device-facing text uses tapToPayName(os). Records (labels, reconciliation,
 * orders, CSV) and the shared push use TAP_TO_PAY_SHORT, because they are read
 * on other devices and on the web.
 */
export const TAP_TO_PAY_SHORT = "Tap to Pay";

export const tapToPayName = (os: string): string =>
  os === "ios" ? "Tap to Pay on iPhone" : TAP_TO_PAY_SHORT;

export const tapOnboardingCopy = (os: string): { title: string; body: string; button: string } => ({
  title: `Take cards with ${tapToPayName(os)}`,
  body: "No card machine. Guests tap a card or phone on your phone at the door.",
  button: `Set up ${tapToPayName(os)}`,
});
