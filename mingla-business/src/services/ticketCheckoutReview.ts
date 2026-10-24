import type {
  CheckoutReviewDetail,
  TicketCheckoutReview,
} from "@mingla/offering-rendering/discountQuote";
import type { TicketCheckoutInvokeError } from "./ticketCheckoutService";

const REVIEW_DETAILS = new Set<CheckoutReviewDetail>([
  "discount_changed",
  "price_changed",
  "lines",
  "fingerprint",
  "discount_code_invalid",
]);

/** Convert the one server 409 shape into the shared blocking review model. */
export const ticketCheckoutReviewFromError = (
  error: unknown,
  previousTotalCents: number | null,
): TicketCheckoutReview | null => {
  const candidate = error as Partial<TicketCheckoutInvokeError> | null;
  if (candidate?.code !== "checkout_review_required") return null;
  const detail = REVIEW_DETAILS.has(candidate.detail as CheckoutReviewDetail)
    ? (candidate.detail as CheckoutReviewDetail)
    : "price_changed";
  return {
    kind: "review_required",
    detail,
    quote: candidate.reviewQuote ?? null,
    previousTotalCents,
  };
};
