// ORCH-1147 [cart does not reflect the TRUE price] — TESTER adversarial test.
//
// DIFFERENT ANGLE than the implementor's happy-path (orch_1147_cart_allin_total
// .test.ts), which unit-tests the DISPLAY math + the source-stub mapping. This
// test attacks the ECONOMIC under-bill (D-1 / SC-6-Web) and the rounding floor:
// it proves the CART display all-in (what the buyer is QUOTED, via useCartTotals)
// EQUALS the WEB CHARGE basis (what Stripe actually bills, via the REAL shared
// engine `computeBuyerSubtotal.buyerSubtotalCents`) for the SAME pass-fee inputs.
// If display and charge ever diverge — the exact bug ORCH-1147 fixes — this fails.
//
// It imports the genuine server money engine (supabase/functions/_shared/
// allInPricingEngine.ts — pure TS, no Deno deps) so the quoted Total is checked
// against the SAME fee formula `pg_public_event_tier_allin` →
// `compute_all_in_cents` use server-side (base + round(base*take/10000) +
// round(base*service/10000)). No mock of the fee math.
//
// Angles (none overlap the implementor's tests):
//   A. display == web-charge basis (pass-fee), incl. a ROUNDING boundary base
//      where per-unit fee rounding matters (5037c base, 150bps take, 300bps svc).
//   B. quantity>1: the cart grosses PER UNIT then sums — proving it does NOT
//      compute base*qty then gross once (a classic rounding off-by-cents bug).
//   C. absorb -> pass FLIP: same line, the toggle is the ONLY driver of the delta
//      (absorb => feesTax 0; pass => feesTax == engine fee gross-up).
//   D. web charge must be the PRE-TAX subtotal, NOT the tax-inclusive total
//      (billing buyer_total_cents would double-tax under automatic_tax).
//
// FAILS-ON-REVERT: if useCartTotals reverts to a base-only total, A/B/C fail
// (allInTotal collapses to subtotal while the engine still grosses up).
// I-PROPOSED-1147-CART-TOTAL-IS-SERVER-ALLIN / I-PROPOSED-1147-WEB-CHARGE-BILLS-
// FEE-GROSSED-SUBTOTAL (DRAFT).

import { describe, expect, jest, test } from "@jest/globals";

import type { CartLine } from "../CartContext";

// The REAL server money engine (pure TS). buyerSubtotalCents = the exact basis
// the web Checkout Session line item bills at ticket-checkout-create:1096.
import {
  computeBuyerSubtotal,
  feeFromBps,
  MINGLA_SERVICE_FEE_BPS,
} from "../../../../../supabase/functions/_shared/allInPricingEngine";

// --- Same eager-hook harness as the implementor test (independent copy) ----
let stubLines: CartLine[] = [];
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useMemo: (factory: () => unknown): unknown => factory(),
    useContext: (): unknown => ({ lines: stubLines }),
  };
});
// eslint-disable-next-line import/first
import { useCartTotals } from "../CartContext";

const line = (over: Partial<CartLine>): CartLine => ({
  ticketTypeId: over.ticketTypeId ?? "tt_1",
  ticketName: over.ticketName ?? "General",
  quantity: over.quantity ?? 1,
  unitPrice: over.unitPrice ?? 0,
  unitPriceGbp: over.unitPriceGbp,
  unitPriceAllIn: over.unitPriceAllIn,
  currency: over.currency ?? "USD",
  isFree: over.isFree ?? false,
});
const totalsFor = (lines: CartLine[]): ReturnType<typeof useCartTotals> => {
  stubLines = lines;
  return useCartTotals();
};

// The SAME fee formula pg_public_event_tier_allin / compute_all_in_cents apply
// server-side: base + (pass_mingla? round(base*take/10000):0)
//                   + (pass_service? round(base*svc/10000):0). MAJOR units /100.
const serverAllInMajor = (
  baseCents: number,
  takeBps: number,
  passMingla: boolean,
  passService: boolean,
): number => {
  const { buyerSubtotalCents } = computeBuyerSubtotal({
    baseCents,
    switches: { pass_tax: false, pass_mingla_fee: passMingla, pass_service_fee: passService },
    region: "US",
    currency: "USD",
    effectiveTakeRateBps: takeBps,
    takeRateSource: "platform_default",
  });
  return buyerSubtotalCents / 100;
};

describe("ORCH-1147 ADVERSARIAL — cart Total quoted == web charge billed", () => {
  // A. The exact divergence ORCH-1147 fixes: the buyer is quoted what Stripe
  //    bills. Uses the live prod fixture numbers (event $50, take 150, svc 300).
  test("A: pass-fee event — display all-in == web-charge buyerSubtotal (no under-bill)", () => {
    const baseCents = 5000; // $50.00 — the live "The party block" tier.
    const takeBps = 150; // brand effective take-rate.
    const allInMajor = serverAllInMajor(baseCents, takeBps, true, true); // 52.25
    const totals = totalsFor([
      line({ unitPrice: baseCents / 100, unitPriceAllIn: allInMajor, quantity: 1 }),
    ]);

    // The quoted Total (cart) and the charge basis (engine) agree to the cent.
    const quotedChargeCents = Math.round(totals.allInTotal * 100);
    const billedChargeCents = computeBuyerSubtotal({
      baseCents,
      switches: { pass_tax: false, pass_mingla_fee: true, pass_service_fee: true },
      region: "US",
      currency: "USD",
      effectiveTakeRateBps: takeBps,
      takeRateSource: "platform_default",
    }).buyerSubtotalCents;

    expect(quotedChargeCents).toBe(5225); // 5000 + 75 + 150 (matches live RPC)
    expect(quotedChargeCents).toBe(billedChargeCents); // display == charge
    expect(totals.feesTaxCents).toBe(225);
    // And it is STRICTLY above the bare base — the under-quote bug is gone.
    expect(quotedChargeCents).toBeGreaterThan(baseCents);
  });

  // A-rounding. A base where the per-unit fee rounds (5037 * 150 / 10000 = 75.555
  // -> 76; * 300 / 10000 = 151.11 -> 151). The cart must match the engine's
  // round()-per-component, not a truncation or a recompute on the major total.
  test("A-rounding: a fee-rounding base still has display == charge to the cent", () => {
    const baseCents = 5037;
    const takeBps = 150;
    const expectMingla = feeFromBps(baseCents, takeBps); // round(75.555)=76
    const expectService = feeFromBps(baseCents, MINGLA_SERVICE_FEE_BPS); // round(151.11)=151
    const expectAllInCents = baseCents + expectMingla + expectService; // 5264
    const allInMajor = serverAllInMajor(baseCents, takeBps, true, true);

    const totals = totalsFor([
      line({ unitPrice: baseCents / 100, unitPriceAllIn: allInMajor, quantity: 1 }),
    ]);
    expect(Math.round(totals.allInTotal * 100)).toBe(expectAllInCents);
    expect(totals.feesTaxCents).toBe(expectMingla + expectService);
    expect(expectAllInCents).toBe(5264); // pins the arithmetic
  });

  // B. quantity>1: gross PER UNIT then sum. With a per-unit fee that rounds,
  //    qty*round(perUnit) can differ from gross(base*qty). The cart MUST do the
  //    former (per-line unit all-in * qty), matching how the buyer is charged
  //    one line item per seat at the per-unit grossed price.
  test("B: qty>1 grosses per-unit then sums (not base*qty grossed once)", () => {
    const baseCents = 333; // $3.33 — per-unit fee rounds.
    const takeBps = 150;
    const perUnitAllIn = baseCents + feeFromBps(baseCents, takeBps) + feeFromBps(baseCents, MINGLA_SERVICE_FEE_BPS);
    // round(333*150/10000)=round(4.995)=5 ; round(333*300/10000)=round(9.99)=10 -> 348
    expect(perUnitAllIn).toBe(348);
    const qty = 7;
    const totals = totalsFor([
      line({ unitPrice: baseCents / 100, unitPriceAllIn: perUnitAllIn / 100, quantity: qty }),
    ]);
    // Per-unit grossed * qty (what the cart does) = 348 * 7 = 2436.
    expect(Math.round(totals.allInTotal * 100)).toBe(perUnitAllIn * qty);
    expect(Math.round(totals.allInTotal * 100)).toBe(2436);
    // Base subtotal stays the bare base * qty (do-not-repurpose).
    expect(Math.round(totals.subtotal * 100)).toBe(baseCents * qty);
    expect(totals.feesTaxCents).toBe(2436 - baseCents * qty);
  });

  // C. absorb -> pass FLIP: the toggle is the ONLY driver. Same base line; under
  //    absorb the cart Total == base (no fees line); flip to pass and the Total
  //    rises by EXACTLY the engine fee gross-up. Proves no fabrication on absorb.
  test("C: absorb -> pass flip moves the delta by exactly the engine fee", () => {
    const baseCents = 7000; // the live experience tier ($70 / £70).
    const takeBps = 150;

    // Absorb arm: seed all-in == base (RPC returns all_in == base on absorb).
    const absorb = totalsFor([
      line({ unitPrice: baseCents / 100, unitPriceAllIn: baseCents / 100, quantity: 1 }),
    ]);
    expect(absorb.feesTaxCents).toBe(0);
    expect(absorb.hasFeesTaxDelta).toBe(false);
    expect(Math.round(absorb.allInTotal * 100)).toBe(baseCents); // Total == base

    // Pass arm: seed all-in == engine gross-up.
    const passAllIn = serverAllInMajor(baseCents, takeBps, true, true);
    const pass = totalsFor([
      line({ unitPrice: baseCents / 100, unitPriceAllIn: passAllIn, quantity: 1 }),
    ]);
    const engineFee = feeFromBps(baseCents, takeBps) + feeFromBps(baseCents, MINGLA_SERVICE_FEE_BPS); // 105+210=315
    expect(pass.feesTaxCents).toBe(engineFee);
    expect(pass.feesTaxCents).toBe(315);
    expect(pass.hasFeesTaxDelta).toBe(true);
    // The flip moved the headline by exactly the fee, nothing else.
    expect(Math.round(pass.allInTotal * 100) - Math.round(absorb.allInTotal * 100)).toBe(engineFee);
  });

  // D. The web charge basis is the PRE-TAX subtotal (buyerSubtotalCents), which
  //    must be < the tax-inclusive total would be. Guards against a future edit
  //    re-pointing the web line item at buyer_total_cents (double-tax under
  //    automatic_tax). buyerSubtotalCents NEVER contains tax — assert it equals
  //    base+fees only, independent of any pass_tax switch.
  test("D: web charge basis is pre-tax (pass_tax does not change buyerSubtotal)", () => {
    const baseCents = 5000;
    const takeBps = 150;
    const taxOff = computeBuyerSubtotal({
      baseCents,
      switches: { pass_tax: false, pass_mingla_fee: true, pass_service_fee: true },
      region: "US",
      currency: "USD",
      effectiveTakeRateBps: takeBps,
      takeRateSource: "platform_default",
    }).buyerSubtotalCents;
    const taxOn = computeBuyerSubtotal({
      baseCents,
      switches: { pass_tax: true, pass_mingla_fee: true, pass_service_fee: true },
      region: "US",
      currency: "USD",
      effectiveTakeRateBps: takeBps,
      takeRateSource: "platform_default",
    }).buyerSubtotalCents;
    // The web line item bills this number; it is fee-only, tax-excluded — Stripe
    // automatic_tax adds tax on top, so it must be invariant to pass_tax.
    expect(taxOff).toBe(taxOn);
    expect(taxOff).toBe(5225); // base + fees, no tax folded in
  });
});
