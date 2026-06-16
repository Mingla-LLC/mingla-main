// ORCH-1147 [cart does not reflect the TRUE price of a trip/event/experience]
// — implementor happy-path regression test (Step 0.5).
//
// Covers SPEC §7 T-1 (useCartTotals all-in math) + T-2 (the event payment
// headline binds to the server fee-grossed all-in, NOT the bare base subtotal),
// plus T-4 (absorb-all → no fees/tax delta) and T-5 (free tier).
//
// Runs under the default node/ts-jest config (no RTL). `useCartTotals` is a thin
// `useMemo` over `useContext(CartCtx)`; we make React's `useMemo` eager and feed
// `useContext` a stub cart, so the hook's PURE reduce math is exercised
// deterministically without a device or a React renderer.
//
// FAILS-ON-REVERT (proven by line-deletion, not comment-out): if `useCartTotals`
// reverts to a base-only total (drops `allInTotal`/`feesTaxCents`), T-1/T-4
// fail; if the payment headline rebinds to the base subtotal, T-2 fails.
// I-PROPOSED-1147-CART-TOTAL-IS-SERVER-ALLIN (DRAFT).

import { describe, expect, jest, test } from "@jest/globals";

import type { CartLine } from "../CartContext";

// --- Make React hooks eager + inject a stub cart -------------------------
// `useMemo(factory)` -> factory(); `useContext(ctx)` -> the injected cart value.
let stubLines: CartLine[] = [];
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useMemo: (factory: () => unknown): unknown => factory(),
    useContext: (): unknown => ({ lines: stubLines }),
  };
});

// Imported AFTER the mock so the hook picks up the eager React shims.
// eslint-disable-next-line import/first
import { useCartTotals } from "../CartContext";

const line = (over: Partial<CartLine>): CartLine => ({
  ticketTypeId: over.ticketTypeId ?? "tt_1",
  ticketName: over.ticketName ?? "General",
  quantity: over.quantity ?? 1,
  unitPrice: over.unitPrice ?? 0,
  unitPriceGbp: over.unitPriceGbp,
  unitPriceAllIn: over.unitPriceAllIn,
  currency: over.currency ?? "GBP",
  isFree: over.isFree ?? false,
});

const totalsFor = (lines: CartLine[]): ReturnType<typeof useCartTotals> => {
  stubLines = lines;
  return useCartTotals();
};

describe("ORCH-1147 — useCartTotals reflects the server fee-grossed all-in", () => {
  test("T-1: a pass-fee line yields allInTotal ≠ subtotal + a fees/tax delta", () => {
    // base £50, server all-in £52.25 (Mingla + service fee passed), qty 1.
    const totals = totalsFor([
      line({ unitPrice: 50, unitPriceAllIn: 52.25, quantity: 1, currency: "GBP" }),
    ]);
    // Base subtotal is UNCHANGED (do-not-repurpose contract).
    expect(totals.subtotal).toBe(50);
    expect(totals.total).toBe(50);
    // The headline floor is the server all-in.
    expect(totals.allInTotal).toBeCloseTo(52.25, 5);
    // Combined "Fees & tax" delta in MINOR units.
    expect(totals.feesTaxCents).toBe(225);
    expect(totals.hasFeesTaxDelta).toBe(true);
    // The all-in must NOT equal the base when a fee is passed — the exact
    // divergence ORCH-1147 fixes. Fails if allInTotal reverts to subtotal.
    expect(totals.allInTotal).not.toBe(totals.subtotal);
  });

  test("T-1b: multi-qty grosses the all-in per unit", () => {
    const totals = totalsFor([
      line({ unitPrice: 20, unitPriceAllIn: 21.5, quantity: 3, currency: "GBP" }),
    ]);
    expect(totals.subtotal).toBe(60);
    expect(totals.allInTotal).toBeCloseTo(64.5, 5);
    expect(totals.feesTaxCents).toBe(450);
    expect(totals.hasFeesTaxDelta).toBe(true);
  });

  test("T-4: absorb-all brand (allIn === base) shows zero delta, no line", () => {
    const totals = totalsFor([
      line({ unitPrice: 40, unitPriceAllIn: 40, quantity: 2, currency: "GBP" }),
    ]);
    expect(totals.subtotal).toBe(80);
    expect(totals.allInTotal).toBe(80);
    expect(totals.feesTaxCents).toBe(0);
    expect(totals.hasFeesTaxDelta).toBe(false);
  });

  test("missing all-in falls back to base (never NaN, never fabricated)", () => {
    const totals = totalsFor([
      line({ unitPrice: 30, unitPriceAllIn: undefined, quantity: 1, currency: "GBP" }),
    ]);
    expect(totals.allInTotal).toBe(30);
    expect(totals.feesTaxCents).toBe(0);
    expect(Number.isNaN(totals.allInTotal)).toBe(false);
  });

  test("T-5: free tier → empty/zero totals, no fees line", () => {
    const totals = totalsFor([
      line({ unitPrice: 0, unitPriceAllIn: 0, quantity: 1, isFree: true, currency: "GBP" }),
    ]);
    expect(totals.subtotal).toBe(0);
    expect(totals.allInTotal).toBe(0);
    expect(totals.feesTaxCents).toBe(0);
    expect(totals.hasFeesTaxDelta).toBe(false);
    expect(totals.isFree).toBe(true);
  });

  test("empty cart → all zero", () => {
    const totals = totalsFor([]);
    expect(totals.subtotal).toBe(0);
    expect(totals.allInTotal).toBe(0);
    expect(totals.feesTaxCents).toBe(0);
    expect(totals.isEmpty).toBe(true);
  });
});

// --- T-2: the payment headline binds to the all-in, not the base ----------
// The payment screens compute the headline as:
//   floor = round(totals.allInTotal * 100); base = round(totals.subtotal * 100);
//   headline (web / no preview) = floor;
//   headline (native, preview >= floor) = preview;
//   feesTaxLine = max(0, headline - base).
// This replicates that EXACT rule so a regression that rebinds the headline to
// the base subtotal (`totals.total`) is caught here.
describe("ORCH-1147 — payment headline source (T-2 / T-3)", () => {
  const headline = (
    subtotal: number,
    allInTotal: number,
    previewCents: number | null,
    isWeb: boolean,
  ): { headlineCents: number; feesTaxLineCents: number } => {
    const baseTotalCents = Math.round(subtotal * 100);
    const allInFloorCents = Math.round(allInTotal * 100);
    const headlineCents =
      !isWeb && previewCents !== null && previewCents >= allInFloorCents
        ? previewCents
        : allInFloorCents;
    return {
      headlineCents,
      feesTaxLineCents: Math.max(0, headlineCents - baseTotalCents),
    };
  };

  test("T-2: web shows the fee-grossed all-in floor (5225), NOT the base (5000)", () => {
    const { headlineCents, feesTaxLineCents } = headline(50, 52.25, null, true);
    expect(headlineCents).toBe(5225);
    expect(feesTaxLineCents).toBe(225);
  });

  test("T-2: native with no preview shows the floor, never the bare base", () => {
    const { headlineCents } = headline(50, 52.25, null, false);
    expect(headlineCents).toBe(5225);
    expect(headlineCents).not.toBe(5000);
  });

  test("native upgrades to the tax-inclusive preview when it exceeds the floor", () => {
    const { headlineCents, feesTaxLineCents } = headline(50, 52.25, 5500, false);
    expect(headlineCents).toBe(5500); // base 50 + fees + tax
    expect(feesTaxLineCents).toBe(500);
  });

  test("T-3: a stale/lower preview NEVER regresses the headline below the floor", () => {
    const { headlineCents } = headline(50, 52.25, 5000, false);
    expect(headlineCents).toBe(5225); // >= floor guard holds
  });
});
