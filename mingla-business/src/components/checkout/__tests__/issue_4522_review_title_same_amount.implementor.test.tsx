/**
 * issue #4522 W-11 — after a provider failure the review must not say "Your
 * total changed" when the amount is the same.
 *
 * Calls the REAL `checkoutReviewTitle` and mounts the REAL
 * `TicketCheckoutReviewPanel` (the panel the buyer sees) and reads its headline.
 *
 * FAILS ON REVERT: hard-code the panel's title back to "Your total changed", or
 * make `checkoutReviewTitle` ignore the previous total.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { describe, expect, jest, test } from "@jest/globals";
import React from "react";

import { checkoutReviewTitle } from "@mingla/offering-rendering/ticketQuoteCopy";
import type {
  TicketCheckoutReview,
  TicketQuote,
} from "@mingla/offering-rendering/discountQuote";

jest.mock("../../../analytics/discountAnalytics", () => ({ captureDiscountEvent: () => undefined }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Node = { type: unknown; props: Record<string, unknown> };
type Tree = { root: { findAll: (p: (n: Node) => boolean) => Node[] } };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (work: () => void) => void;
};
const { TicketCheckoutReviewPanel } = require("../TicketQuoteSummary") as typeof import("../TicketQuoteSummary");

const quote = (buyerTotalCents: number): TicketQuote =>
  ({
    currency: "USD",
    lines: [{ ticketTypeId: "t1", ticketName: "GA", quantity: 1, lineListCents: buyerTotalCents, lineNetCents: buyerTotalCents }],
    extras: [],
    discounts: [],
    netSubtotalCents: buyerTotalCents,
    dueTodayNetCents: buyerTotalCents,
    buyerTotalCents,
    buyerFeeCents: 0,
    taxCents: 0,
  }) as unknown as TicketQuote;

const review = (previousTotalCents: number | null, total: number | null): TicketCheckoutReview => ({
  kind: "review_required",
  detail: "price_changed",
  previousTotalCents,
  quote: total === null ? null : quote(total),
});

const texts = (element: React.ReactElement): string[] => {
  let tree: Tree | undefined;
  TestRenderer.act(() => {
    tree = TestRenderer.create(element);
  });
  return (tree as Tree).root
    .findAll((n) => n.type === "Text")
    .map((n) => {
      const c = n.props.children;
      return (Array.isArray(c) ? c.join("") : String(c ?? "")).trim();
    });
};

const panel = (r: TicketCheckoutReview): string[] =>
  texts(<TicketCheckoutReviewPanel review={r} onAccept={() => undefined} onBack={() => undefined} />);

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
});

describe("the review panel the buyer sees", () => {
  test("same amount: the panel asks for a review and never says the total changed", () => {
    const shown = panel(review(124500, 124500));
    expect(shown).toContain("Please review your order");
    expect(shown).not.toContain("Your total changed");
  });
  test("different amount: the panel says the total changed", () => {
    const shown = panel(review(120000, 124500));
    expect(shown).toContain("Your total changed");
    expect(shown).not.toContain("Please review your order");
  });
});
