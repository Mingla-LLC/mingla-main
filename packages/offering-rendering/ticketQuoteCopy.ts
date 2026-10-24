import type { CheckoutReviewDetail, TicketQuote } from "./discountQuote";

export const ticketQuoteFeesAndTaxCents = (quote: TicketQuote): number =>
  Math.max(0, quote.buyerTotalCents - quote.dueTodayNetCents);

export const checkoutReviewReasonCopy = (
  detail: CheckoutReviewDetail,
): string =>
  detail === "discount_changed"
    ? "Your total changed because a discount ended or ran out."
    : "Something in your order changed. Please review it.";
