/**
 * #3645 PR10 — Home to-do "Add a bank to get paid" when charge-ready but not
 * payout-ready. Append-only; existing businessTodos.test.ts Stripe band stays.
 */
import { describe, expect, test } from "@jest/globals";

import {
  buildBusinessTodos,
  type BusinessTodoInput,
} from "../businessTodos";

const base: BusinessTodoInput = {
  hasNoBrands: false,
  hasBrandsButNoSelection: false,
  brandResolving: false,
  hasBrand: true,
  pipelineFetched: true,
  pipelineStatus: "deck_eligible",
  pipelineRoute:
    "/venue/deck-readiness?brand_id=b1&focus=review&fix=review_pipeline",
  venueDraftInProgress: false,
  hasPhysicalLocation: true,
  counts: { total: 3, live: 1, draft: 0 },
  stripeActive: true,
  payoutReady: false,
  hasDraftPaidOffering: false,
  stripeRoute: "/brand/b1/payments",
  draftRoute: null,
  venueClaimPending: false,
  venueListingRoute: "/brand/b1/listing",
  venueClaimOpenFeedbackCount: 0,
  venueFeedbackRoute: "/brand/b1/listing?focus=feedback",
};

describe("buildBusinessTodos — #3645 add bank to get paid", () => {
  test("charge-ready && !payout-ready → Add a bank to get paid", () => {
    const todos = buildBusinessTodos(base);
    const row = todos.find((t) => t.id === "add_bank_to_get_paid");
    expect(row?.label).toBe("Add a bank to get paid");
    expect(row?.action).toEqual({
      kind: "route",
      route: "/brand/b1/payments",
    });
    expect(todos.map((t) => t.id)).not.toContain("connect_stripe");
  });

  test("!charge-ready keeps connect-to-sell, not the bank row", () => {
    const todos = buildBusinessTodos({
      ...base,
      stripeActive: false,
      payoutReady: false,
    });
    expect(todos.map((t) => t.id)).toContain("connect_stripe");
    expect(todos.map((t) => t.id)).not.toContain("add_bank_to_get_paid");
  });

  test("payout-ready suppresses both bank rows", () => {
    const todos = buildBusinessTodos({
      ...base,
      stripeActive: true,
      payoutReady: true,
    });
    expect(todos.map((t) => t.id)).not.toContain("add_bank_to_get_paid");
    expect(todos.map((t) => t.id)).not.toContain("connect_stripe");
  });
});
