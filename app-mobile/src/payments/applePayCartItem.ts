/**
 * applePayCartItem — ORCH-1244 (Apple Guideline 4.9).
 *
 * Pure builder for the Stripe React Native Apple Pay `cartItems` summary array.
 *
 * WHY THIS EXISTS
 * ----------------
 * When PaymentSheet presents Apple Pay with NO explicit `applePay.cartItems`,
 * Stripe RN builds the PKPaymentRequest with a single default summary line whose
 * label = `merchantDisplayName` ("Mingla"). Apple flagged that as the company
 * name appearing as an unnecessary line item (Guideline 4.9). Passing an explicit
 * cartItem whose label is the PRODUCT name (the event / ticket / reservation
 * title) puts the product on the line instead of the bare merchant name.
 *
 * The grand-total line in Apple Pay takes the label of the LAST cartItem, so a
 * single product-labelled item is sufficient.
 *
 * Shape mirrors @stripe/stripe-react-native `ApplePay.CartSummaryItem`
 * (node_modules/@stripe/stripe-react-native): { label, amount, paymentType }.
 * `amount` is a decimal-string of the major-unit total; `paymentType: "Immediate"`
 * is the standard one-off charge (not a deferred/recurring item).
 *
 * FALLBACK CONTRACT (the 4.9 fix must never regress): if the product title is
 * empty / whitespace / undefined, fall back to a generic PRODUCT word
 * ("Ticket" / "Reservation"), NEVER to the merchant name "Mingla".
 */

export interface ApplePayCartItem {
  label: string;
  amount: string;
  paymentType: "Immediate";
}

/**
 * Build the single-element Apple Pay cartItems array for a checkout.
 *
 * @param title       on-screen product name (event/trip/experience/venue title).
 * @param totalCents  the order grand total in minor units (cents).
 * @param fallback    generic product label when `title` is empty — defaults to
 *                    "Ticket". Pass "Reservation" for the reserve flow. MUST be a
 *                    product word; passing the merchant name would re-introduce
 *                    the 4.9 violation, so callers never do.
 */
export function buildApplePayCartItems(
  title: string | null | undefined,
  totalCents: number,
  fallback: string = "Ticket",
): [ApplePayCartItem] {
  const label = title != null && title.trim().length > 0 ? title.trim() : fallback;
  return [
    {
      label,
      // Apple Pay expects a decimal string in the major currency unit.
      amount: (totalCents / 100).toFixed(2),
      paymentType: "Immediate",
    },
  ];
}
