/**
 * ORCH-1246 (Apple 4.9 pre-empt) — Apple Pay sheet line items.
 *
 * Without an explicit `cartItems` array, Stripe's PaymentSheet falls back to
 * showing the `merchantDisplayName` (the COMPANY) on the Apple Pay total line.
 * Apple flags a wallet sheet that shows the company name instead of what the
 * user is buying. This helper builds a single Immediate line item labelled with
 * the on-screen product/event/trip/experience title so the Apple Pay sheet reads
 * "<Event Title> … $X.YZ" — never the company name.
 */

/** Mirror of @stripe/stripe-react-native ImmediateCartSummaryItem (subset). */
export interface ApplePayCartItem {
  label: string;
  amount: string;
  paymentType: "Immediate";
}

/**
 * @param title       on-screen product/event/trip/experience title (may be empty)
 * @param totalCents  all-in total in cents (server-authoritative)
 * @param fallback    label to use when `title` is empty — NEVER the company name
 *                    (e.g. "Ticket" / "Reservation" / "Experience")
 */
export function buildApplePayCartItems(
  title: string | null | undefined,
  totalCents: number,
  fallback: string,
): ApplePayCartItem[] {
  const trimmed = (title ?? "").trim();
  const label = trimmed.length > 0 ? trimmed : fallback;
  return [
    {
      label,
      amount: (totalCents / 100).toFixed(2),
      paymentType: "Immediate",
    },
  ];
}
