import type { TicketQuote } from "@mingla/offering-rendering/discountQuote";
import { ticketCheckoutReviewFromError } from "../../../src/services/ticketCheckoutReview";

const quote: TicketQuote = {
  kind: "quote",
  currency: "USD",
  lines: [],
  listSubtotalCents: 5000,
  discountCents: 1000,
  netSubtotalCents: 4000,
  dueTodayNetCents: 4000,
  dueTodayListCents: 5000,
  installmentSchedule: null,
  discounts: [],
  codeOutcome: {
    status: "applied",
    reason: null,
    required: null,
    with: null,
    replaced: [],
  },
  notices: [],
  quoteDigest: "discounted-digest",
  quoteListDigest: "list-digest",
  feesCents: 0,
  taxCents: 0,
  buyerTotalCents: 4000,
  calculationId: "calc-1",
  subtotalCents: 4000,
  totalCents: 4000,
};

describe("#3872 checkout review on server 409", () => {
  test.each([
    "discount_changed",
    "price_changed",
    "lines",
    "fingerprint",
    "discount_code_invalid",
  ] as const)("maps %s to the revised server quote", (detail) => {
    expect(
      ticketCheckoutReviewFromError(
        {
          code: "checkout_review_required",
          detail,
          reviewQuote: quote,
        },
        5000,
      ),
    ).toEqual({
      kind: "review_required",
      detail,
      quote,
      previousTotalCents: 5000,
    });
  });

  test("refuses to manufacture a review for any other error", () => {
    expect(
      ticketCheckoutReviewFromError({ code: "sold_out" }, 5000),
    ).toBeNull();
  });
});
