// ORCH-1291 [rsvp-chip-in] — implementor happy-path regression (engine guard).
//
// Proves a VOLUNTARY CONTRIBUTION prices as a GIFT through the SINGLE all-in
// engine (Constitution #2) with ZERO tax, WYSIWYG (organiser absorbs), while
// Mingla still takes its application_fee. Covers SPEC §5 SC-3 (the money math)
// + the DRAFT invariants I-PROPOSED-1291-CONTRIBUTION-TAX-ZERO /
// -CONTRIBUTION-MINGLA-FEE at the engine layer.
//
// fails-on-revert (TRUE LINE DELETION): deleting the `"voluntary_contribution"`
// member from the TaxBasis union in allInPricingEngine.ts makes the literal
// below unassignable → `deno test` FAILS TO TYPE-CHECK (the fix is gone). The
// numeric assertions additionally fail if the caller ever passed a non-zero
// taxCents for a contribution. The tester writes the adversarial counterpart.
//
// Run: deno test supabase/functions/_shared/__tests__/orch_1291_contribution_engine.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPricingBreakdown,
  computeBuyerSubtotal,
  feeFromBps,
  type ComputeAllInInput,
  type PricingSwitches,
  type TaxBasis,
} from "../allInPricingEngine.ts";

// The contribution path FORCES organiser-absorbs (WYSIWYG gift — SPEC §10 Q-B):
// pass_service_fee=false, pass_mingla_fee=false, pass_tax irrelevant.
const CONTRIBUTION_SWITCHES: PricingSwitches = {
  pass_tax: false,
  pass_mingla_fee: false,
  pass_service_fee: false,
};

// A £10 gift on a GB brand at a 150bps take rate.
const engineInput: ComputeAllInInput = {
  baseCents: 1000,
  switches: CONTRIBUTION_SWITCHES,
  region: "GB",
  currency: "GBP",
  effectiveTakeRateBps: 150,
  takeRateSource: "platform_default",
};

Deno.test("ORCH-1291 — 'voluntary_contribution' is an accepted TaxBasis member", () => {
  // Type-level proof: this assignment fails to compile if the union member is
  // deleted (fails-on-revert). Runtime: the value round-trips onto the breakdown.
  const basis: TaxBasis = "voluntary_contribution";
  assertEquals(basis, "voluntary_contribution");
});

Deno.test("ORCH-1291 — a contribution charges the buyer EXACTLY the gift (WYSIWYG, no fees passed)", () => {
  const subtotal = computeBuyerSubtotal(engineInput);
  // Organiser absorbs → the buyer subtotal is the bare base (no gross-up).
  assertEquals(subtotal.buyerSubtotalCents, 1000);
  // Mingla's cut still computed (150bps of £10 = £0.15).
  assertEquals(subtotal.miglaFeeCents, feeFromBps(1000, 150));
  assertEquals(subtotal.miglaFeeCents, 15);
});

Deno.test("ORCH-1291 — contribution breakdown is a ZERO-TAX gift with Mingla's cut retained", () => {
  const subtotal = computeBuyerSubtotal(engineInput);
  const breakdown = buildPricingBreakdown({
    input: engineInput,
    amountTotalCents: subtotal.buyerSubtotalCents, // buyer_total == the gift (no tax added)
    taxCents: 0, // GIFT: no Stripe Tax / no VAT round-trip (SPEC §10 Q-A)
    taxBasis: "voluntary_contribution",
    stripeTaxCalculationId: null,
  });

  // Self-describing GIFT basis (receipt reads as a contribution, not a tax invoice).
  assertEquals(breakdown.tax_basis, "voluntary_contribution");
  // Zero tax everywhere (I-PROPOSED-1291-CONTRIBUTION-TAX-ZERO).
  assertEquals(breakdown.components.tax_cents, 0);
  assertEquals(breakdown.passed.tax_cents, 0);
  assertEquals(breakdown.absorbed.tax_cents, 0);
  // Buyer charged EXACTLY the gift.
  assertEquals(breakdown.buyer_total_cents, 1000);
  // Mingla ALWAYS takes its cut (I-PROPOSED-1291-CONTRIBUTION-MINGLA-FEE).
  assertEquals(breakdown.application_fee_amount_cents, 15);
  assert(breakdown.application_fee_amount_cents > 0);
  // Organiser payout = gift − Mingla's cut − tax(0).
  assertEquals(breakdown.connected_account_payout_cents, 1000 - 15 - 0);
});

Deno.test("ORCH-1291 — application_fee tracks the take rate exactly (round(amount * bps / 10000))", () => {
  for (const [amount, bps, expected] of [
    [1000, 150, 15],
    [5000, 150, 75],
    [2500, 600, 150],
  ] as const) {
    const input: ComputeAllInInput = { ...engineInput, baseCents: amount, effectiveTakeRateBps: bps };
    const breakdown = buildPricingBreakdown({
      input,
      amountTotalCents: computeBuyerSubtotal(input).buyerSubtotalCents,
      taxCents: 0,
      taxBasis: "voluntary_contribution",
      stripeTaxCalculationId: null,
    });
    assertEquals(breakdown.application_fee_amount_cents, expected);
  }
});
