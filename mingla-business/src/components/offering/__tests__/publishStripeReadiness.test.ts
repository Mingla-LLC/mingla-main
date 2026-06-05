/**
 * ORCH-1076 Stream B [proactive publish banners] — resolver + server-parity
 * tests (SPEC §9 T-01…T-12).
 *
 * The per-type isPaid resolvers MUST mirror the ORCH-1075 server paid
 * predicates EXACTLY (migration 20260911000000_orch_1075_…sql) so the proactive
 * banner can never disagree with the server block. The parity blocks (T-10/
 * T-11/T-12) reproduce the server cents/total math as fixtures and assert the
 * client resolver matches for every row.
 *
 * Fails-on-revert: each row exercises the resolver's actual logic; reverting
 * the resolver (e.g. dropping the round-to-cents, the !isFree gate, or the
 * per-stop sum) flips at least one assertion.
 */

import { describe, expect, test } from "@jest/globals";

import {
  eventDraftIsPaid,
  experienceDraftIsPaid,
  offeringNeedsStripeToPublish,
  tripDraftIsPaid,
} from "../publishStripeReadiness";

describe("ORCH-1076 — offeringNeedsStripeToPublish (shared predicate)", () => {
  test("T-01 paid + inactive (onboarding) → needs Stripe", () => {
    expect(
      offeringNeedsStripeToPublish({ isPaid: true, stripeStatus: "onboarding" }),
    ).toBe(true);
  });

  test("T-02 paid + active → does NOT need Stripe", () => {
    expect(
      offeringNeedsStripeToPublish({ isPaid: true, stripeStatus: "active" }),
    ).toBe(false);
  });

  test("T-03 free + not_connected → does NOT need Stripe", () => {
    expect(
      offeringNeedsStripeToPublish({
        isPaid: false,
        stripeStatus: "not_connected",
      }),
    ).toBe(false);
  });

  test("T-04 paid + null status → needs Stripe (fail-safe to block)", () => {
    expect(
      offeringNeedsStripeToPublish({ isPaid: true, stripeStatus: null }),
    ).toBe(true);
  });

  test("paid + undefined status → needs Stripe (fail-safe)", () => {
    expect(
      offeringNeedsStripeToPublish({ isPaid: true, stripeStatus: undefined }),
    ).toBe(true);
  });

  test("every non-active status reads as needs-Stripe when paid", () => {
    for (const s of [
      "not_connected",
      "onboarding",
      "restricted",
    ] as const) {
      expect(
        offeringNeedsStripeToPublish({ isPaid: true, stripeStatus: s }),
      ).toBe(true);
    }
  });
});

describe("ORCH-1076 — tripDraftIsPaid", () => {
  test("T-05 truth-table mirrors round(price*100) > 0", () => {
    const rows: { priceMajor: string; expected: boolean }[] = [
      { priceMajor: "", expected: false },
      { priceMajor: "0", expected: false },
      { priceMajor: "0.00", expected: false },
      // Sub-cent below the half-cent boundary rounds DOWN to 0 → not paid.
      { priceMajor: "0.004", expected: false },
      { priceMajor: "10", expected: true },
    ];
    for (const r of rows) {
      expect(tripDraftIsPaid({ priceMajor: r.priceMajor })).toBe(r.expected);
    }
  });

  test("0.005 half-cent rounds UP to 1 cent → paid (server-faithful)", () => {
    // 0.005 * 100 = 0.5 exactly in IEEE-754; Math.round(0.5) = 1 cent. The
    // PostgreSQL server predicate round(0.005*100) = round(0.5) = 1 cent too
    // (numeric round-half-away-from-zero). Client and server AGREE: paid=true.
    // (SPEC §9 T-05's "rounds to 0" note assumed float imprecision that does
    // not occur for 0.005 — the parity-faithful value is true. The resolver +
    // the server move together, which is the binding INV-1 contract.)
    expect(tripDraftIsPaid({ priceMajor: "0.005" })).toBe(true);
  });

  test("0.01 (one cent) is paid", () => {
    expect(tripDraftIsPaid({ priceMajor: "0.01" })).toBe(true);
  });
});

describe("ORCH-1076 — experienceDraftIsPaid", () => {
  test("T-06 whole-price mode, non-free, total > 0 → paid", () => {
    expect(
      experienceDraftIsPaid({ isFree: false, resolvedTotalMajor: 25 }),
    ).toBe(true);
  });

  test("T-07 per-stop sum > 0 → paid", () => {
    // per-stop prices [10, 0, 5] resolve to total 15 in the wizard.
    expect(
      experienceDraftIsPaid({ isFree: false, resolvedTotalMajor: 15 }),
    ).toBe(true);
  });

  test("T-08 free overrides a non-zero price → not paid", () => {
    // isFree=true forces resolvedTotalMajor 0 in the wizard, but assert the
    // resolver gates on isFree regardless.
    expect(
      experienceDraftIsPaid({ isFree: true, resolvedTotalMajor: 0 }),
    ).toBe(false);
    expect(
      experienceDraftIsPaid({ isFree: true, resolvedTotalMajor: 99 }),
    ).toBe(false);
  });

  test("T-09 per-stop all zero → not paid", () => {
    expect(
      experienceDraftIsPaid({ isFree: false, resolvedTotalMajor: 0 }),
    ).toBe(false);
  });
});

describe("ORCH-1076 — eventDraftIsPaid", () => {
  test("any online priced ticket > 0 → paid", () => {
    expect(
      eventDraftIsPaid([
        { isFree: true, priceGbp: null },
        { isFree: false, priceGbp: 12 },
      ]),
    ).toBe(true);
  });

  test("all-free or zero-priced → not paid", () => {
    expect(
      eventDraftIsPaid([
        { isFree: true, priceGbp: null },
        { isFree: false, priceGbp: 0 },
      ]),
    ).toBe(false);
  });
});

// ----- T-10 / T-11 / T-12 — parity against the ORCH-1075 server predicates --

/**
 * Server trip predicate fixture: max(price_cents) WHERE available_online > 0.
 * For the single-tier wizard, price_cents = round(parseFloat(priceMajor)*100).
 * We compute the server-side boolean independently and require the client
 * resolver to match.
 */
const serverTripPaid = (priceMajor: string): boolean => {
  const priceCents = Math.round((parseFloat(priceMajor) || 0) * 100);
  return priceCents > 0; // max over a single tier
};

describe("ORCH-1076 — T-10 trip resolver matches server predicate", () => {
  test.each([
    "",
    "0",
    "0.00",
    "0.004",
    "0.005",
    "0.01",
    "1",
    "10",
    "10.50",
    "999.99",
  ])("priceMajor=%s", (priceMajor) => {
    expect(tripDraftIsPaid({ priceMajor })).toBe(serverTripPaid(priceMajor));
  });
});

/**
 * Server experience predicate fixture: NOT is_free AND v_resolved_total > 0,
 * where v_resolved_total = is_free ? 0 : whole ? whole_price_cents
 *                                              : Σ stop price_cents.
 * Computed in cents; the client computes in major units. Both gate on > 0.
 */
const serverExperiencePaid = (input: {
  is_free: boolean;
  pricing_mode: "whole" | "per_stop";
  whole_price_cents: number;
  stop_price_cents: number[];
}): boolean => {
  const resolvedCents = input.is_free
    ? 0
    : input.pricing_mode === "whole"
      ? input.whole_price_cents
      : input.stop_price_cents.reduce((a, b) => a + b, 0);
  return !input.is_free && resolvedCents > 0;
};

describe("ORCH-1076 — T-11 experience resolver matches server predicate", () => {
  const cases: {
    is_free: boolean;
    pricing_mode: "whole" | "per_stop";
    whole_price_cents: number;
    stop_price_cents: number[];
  }[] = [
    { is_free: true, pricing_mode: "whole", whole_price_cents: 2500, stop_price_cents: [] },
    { is_free: true, pricing_mode: "per_stop", whole_price_cents: 0, stop_price_cents: [1000, 500] },
    { is_free: false, pricing_mode: "whole", whole_price_cents: 0, stop_price_cents: [] },
    { is_free: false, pricing_mode: "whole", whole_price_cents: 2500, stop_price_cents: [] },
    { is_free: false, pricing_mode: "per_stop", whole_price_cents: 0, stop_price_cents: [0, 0, 0] },
    { is_free: false, pricing_mode: "per_stop", whole_price_cents: 0, stop_price_cents: [1000, 0, 500] },
  ];
  test.each(cases)("case %#", (c) => {
    const resolvedTotalMajor = c.is_free
      ? 0
      : c.pricing_mode === "whole"
        ? c.whole_price_cents / 100
        : c.stop_price_cents.reduce((a, b) => a + b, 0) / 100;
    expect(
      experienceDraftIsPaid({ isFree: c.is_free, resolvedTotalMajor }),
    ).toBe(serverExperiencePaid(c));
  });
});

/**
 * Server event predicate fixture:
 *   bool_or( availableAt IN ('online','both') AND NOT isFree
 *            AND round(price*100) > 0 ).
 * The wizard draft tickets are online-sellable by construction, so the client
 * mirror is `some(!isFree && (priceGbp ?? 0) > 0)`.
 */
const serverEventPaid = (
  tickets: { availableAt: string; isFree: boolean; price: number }[],
): boolean =>
  tickets.some(
    (t) =>
      ["online", "both"].includes(t.availableAt) &&
      !t.isFree &&
      Math.round(t.price * 100) > 0,
  );

describe("ORCH-1076 — T-12 event resolver matches server predicate", () => {
  const cases: {
    tickets: { availableAt: string; isFree: boolean; price: number }[];
  }[] = [
    { tickets: [{ availableAt: "online", isFree: true, price: 0 }] },
    { tickets: [{ availableAt: "online", isFree: false, price: 0 }] },
    { tickets: [{ availableAt: "online", isFree: false, price: 15 }] },
    { tickets: [{ availableAt: "both", isFree: false, price: 25 }] },
    {
      tickets: [
        { availableAt: "online", isFree: true, price: 0 },
        { availableAt: "both", isFree: false, price: 10 },
      ],
    },
  ];
  test.each(cases)("case %#", (c) => {
    // The client resolver consumes the draft ticket shape (no availableAt — all
    // online by construction). For T-12 every fixture row is online/both, so
    // the client mirror is exact.
    const clientTickets = c.tickets.map((t) => ({
      isFree: t.isFree,
      priceGbp: t.price,
    }));
    expect(eventDraftIsPaid(clientTickets)).toBe(serverEventPaid(c.tickets));
  });
});
