import type { CheckoutReviewDetail, TicketQuote } from "./discountQuote";

export const ticketQuoteFeesAndTaxCents = (quote: TicketQuote): number =>
  Math.max(0, quote.buyerTotalCents - quote.dueTodayNetCents);

export const checkoutReviewReasonCopy = (
  detail: CheckoutReviewDetail,
): string =>
  detail === "discount_changed"
    ? "Your total changed because a discount ended or ran out."
    : "Something in your order changed. Please review it.";

/**
 * issue #4522 W-11 — the review's headline. "Your total changed" is true only
 * when the new total differs from the one the buyer saw; when the amount is the
 * same (a provider hiccup re-priced the cart to the same figure) it says only
 * that the order needs a look.
 */
export const checkoutReviewTitle = (review: {
  previousTotalCents: number | null;
  quote: { buyerTotalCents: number } | null;
}): string =>
  review.quote !== null &&
  review.previousTotalCents !== null &&
  review.previousTotalCents === review.quote.buyerTotalCents
    ? "Please review your order"
    : "Your total changed";
