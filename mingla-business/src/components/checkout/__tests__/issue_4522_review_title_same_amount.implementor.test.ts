/**
 * issue #4522 W-11 — after a provider failure the review must not say "Your
 * total changed" when the amount is the same.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

import { checkoutReviewTitle } from "@mingla/offering-rendering/ticketQuoteCopy";

describe("checkoutReviewTitle", () => {
  test("a different amount says the total changed", () => {
    expect(checkoutReviewTitle({ previousTotalCents: 120000, quote: { buyerTotalCents: 124500 } })).toBe(
      "Your total changed",
    );
  });
  test("the same amount does not", () => {
    expect(checkoutReviewTitle({ previousTotalCents: 124500, quote: { buyerTotalCents: 124500 } })).toBe(
      "Please review your order",
    );
  });
  test("an unknown previous total or no quote keeps the old headline", () => {
    expect(checkoutReviewTitle({ previousTotalCents: null, quote: { buyerTotalCents: 5 } })).toBe("Your total changed");
    expect(checkoutReviewTitle({ previousTotalCents: 5, quote: null })).toBe("Your total changed");
  });
  test("the review panel's quote branch uses it", () => {
    const src = readFileSync(path.join(__dirname, "..", "TicketQuoteSummary.tsx"), "utf-8");
    expect(src).toMatch(/title=\{checkoutReviewTitle\(review\)\}/);
  });
});
