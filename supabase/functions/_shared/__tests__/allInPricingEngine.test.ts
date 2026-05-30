// ORCH-1006 [Universal all-in pricing engine] — implementor happy-path regression.
// Proves the worked £40 numeric example from the take-rate amendment §E.2 and the
// operator-locked 6% migration default. The tester writes the adversarial
// counterpart (flat-absorb fallback, point-in-time freeze, guardrail) separately.
//
// fails-on-revert: replacing computeBuyerSubtotal's gross-up with `baseCents`
// (i.e. dropping the pass/absorb branch) makes CASE 1 buyer_subtotal 4000 not
// 4320 — the assertions below fail. Verified at HEAD before the engine existed
// (the module import itself fails to resolve on revert of allInPricingEngine.ts).
import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPricingBreakdown,
  computeBuyerSubtotal,
  feeFromBps,
  MINGLA_SERVICE_FEE_BPS,
  taxBehaviorForRegion,
  type ComputeAllInInput,
} from "../allInPricingEngine.ts";

Deno.test("feeFromBps — integer bps money math, round half-up", () => {
  assertEquals(feeFromBps(4000, 500), 200); // 5.00% of £40 = £2.00
  assertEquals(feeFromBps(4000, 300), 120); // 3.00% of £40 = £1.20
  assertEquals(feeFromBps(4000, 600), 240); // 6.00% (migration default) = £2.40
  assertEquals(feeFromBps(0, 600), 0);
});

Deno.test("GB region → inclusive VAT behavior", () => {
  assertEquals(taxBehaviorForRegion("GB"), "inclusive");
});

Deno.test("service fee launch default = 300 bps (3.00%, uniform)", () => {
  assertEquals(MINGLA_SERVICE_FEE_BPS, 300);
});

// ── Worked example (amendment §E.2): £40 ticket, 5% take, 3% service, GB. ──
const base: Omit<ComputeAllInInput, "switches"> = {
  baseCents: 4000,
  region: "GB",
  currency: "GBP",
  effectiveTakeRateBps: 500,
  takeRateSource: "platform_default",
  serviceFeeBps: 300,
};

Deno.test("CASE 1 — PASS Mingla fee + PASS service fee → buyer £43.20", () => {
  const input: ComputeAllInInput = {
    ...base,
    switches: { pass_tax: true, pass_mingla_fee: true, pass_service_fee: true },
  };
  const { miglaFeeCents, serviceFeeCents, buyerSubtotalCents } =
    computeBuyerSubtotal(input);
  assertEquals(miglaFeeCents, 200);
  assertEquals(serviceFeeCents, 120);
  assertEquals(buyerSubtotalCents, 4320); // 4000 + 200 + 120

  // GB inclusive: amount_total == buyer_subtotal; VAT extracted from inside.
  const vatCents = 4320 - Math.round(4320 / 1.2); // 4320 - 3600 = 720
  assertEquals(vatCents, 720);
  const bd = buildPricingBreakdown({
    input,
    amountTotalCents: 4320,
    taxCents: vatCents,
    taxBasis: "venue_resolved",
    stripeTaxCalculationId: "taxcalc_test",
  });
  assertEquals(bd.buyer_total_cents, 4320); // £43.20
  assertEquals(bd.application_fee_amount_cents, 200); // Mingla margin £2.00
  assertEquals(bd.components.mingla_fee_cents, 200);
  assertEquals(bd.components.service_fee_cents, 120);
  assertEquals(bd.passed.mingla_fee_cents, 200);
  assertEquals(bd.absorbed.mingla_fee_cents, 0);
  // application_fee == mingla_fee, never the service fee (no double-charge).
  assertEquals(
    bd.application_fee_amount_cents === bd.components.mingla_fee_cents,
    true,
  );
  assertEquals(
    bd.application_fee_amount_cents !== bd.components.service_fee_cents,
    true,
  );
});

Deno.test("CASE 2 — ABSORB Mingla fee + PASS service fee → buyer £41.20, same Mingla margin", () => {
  const input: ComputeAllInInput = {
    ...base,
    switches: { pass_tax: true, pass_mingla_fee: false, pass_service_fee: true },
  };
  const { buyerSubtotalCents } = computeBuyerSubtotal(input);
  assertEquals(buyerSubtotalCents, 4120); // 4000 + 0 + 120

  const vatCents = 4120 - Math.round(4120 / 1.2); // 4120 - 3433 = 687
  assertEquals(vatCents, 687);
  const bd = buildPricingBreakdown({
    input,
    amountTotalCents: 4120,
    taxCents: vatCents,
    taxBasis: "venue_resolved",
    stripeTaxCalculationId: "taxcalc_test",
  });
  assertEquals(bd.buyer_total_cents, 4120); // £41.20 (£2.00 less than CASE 1)
  // Mingla margin IDENTICAL to CASE 1 — the rate sets the amount; the switch
  // only changes who bears it (the whole point of the switch).
  assertEquals(bd.application_fee_amount_cents, 200);
  assertEquals(bd.absorbed.mingla_fee_cents, 200); // brand ate it
  assertEquals(bd.passed.mingla_fee_cents, 0);
});

Deno.test("Operator-locked 6% migration default on a £40 base", () => {
  const input: ComputeAllInInput = {
    ...base,
    effectiveTakeRateBps: 600, // the deliberate migration default
    switches: { pass_tax: true, pass_mingla_fee: true, pass_service_fee: false },
  };
  const { miglaFeeCents, buyerSubtotalCents } = computeBuyerSubtotal(input);
  assertEquals(miglaFeeCents, 240); // 6.00% of £40 = £2.40
  assertEquals(buyerSubtotalCents, 4240); // 4000 + 240 (service fee absorbed)
});

// ── ORCH-1006 Slice 2 additions (SPEC §B.4 degrade + §G.3 inclusive math) ──

Deno.test("[ORCH-1006] GB inclusive: buyer_total == buyer_subtotal (tax baked in, NOT added on top)", () => {
  // The exclusive-only `amount_total − base` bug being fixed: for inclusive VAT
  // the displayed/charged number IS the all-in; tax is informational only.
  const input: ComputeAllInInput = {
    ...base,
    switches: { pass_tax: true, pass_mingla_fee: true, pass_service_fee: true },
  };
  const { buyerSubtotalCents } = computeBuyerSubtotal(input);
  assertEquals(buyerSubtotalCents, 4320);
  // Stripe inclusive: amount_total === sum(line amounts) === buyer_subtotal.
  const vatCents = 4320 - Math.round(4320 / 1.2); // 720
  const bd = buildPricingBreakdown({
    input,
    amountTotalCents: 4320, // inclusive: equals the subtotal
    taxCents: vatCents,
    taxBasis: "venue_resolved",
    stripeTaxCalculationId: "taxcalc_inclusive",
  });
  assertEquals(bd.tax_behavior, "inclusive");
  // The fixed contract: inclusive total must equal the subtotal, not subtotal+tax.
  assertEquals(bd.buyer_total_cents, bd.buyer_subtotal_cents);
  assertEquals(bd.buyer_total_cents, 4320);
  assertEquals(bd.components.tax_cents, 720);
});

Deno.test("[ORCH-1006] degrade-to-flat-absorb (T-02/T-10): tax 0, basis flat, total == subtotal", () => {
  // When the brand is unregistered / venue unresolved / the calc throws, the
  // edge function passes amount_total = buyer_subtotal, tax_cents = 0, and one
  // of the *_flat_absorb bases — the buyer still pays one clean number.
  const input: ComputeAllInInput = {
    ...base,
    switches: { pass_tax: true, pass_mingla_fee: true, pass_service_fee: true },
  };
  const { buyerSubtotalCents } = computeBuyerSubtotal(input);
  for (
    const basis of [
      "unresolved_flat_absorb",
      "country_unsupported_flat_absorb",
      "calc_failed_flat_absorb",
    ] as const
  ) {
    const bd = buildPricingBreakdown({
      input,
      amountTotalCents: buyerSubtotalCents,
      taxCents: 0,
      taxBasis: basis,
      stripeTaxCalculationId: null,
    });
    assertEquals(bd.tax_basis, basis);
    assertEquals(bd.components.tax_cents, 0);
    assertEquals(bd.buyer_total_cents, bd.buyer_subtotal_cents);
    assertEquals(bd.stripe_tax_calculation_id, null);
    // The Mingla skim is still collected on the degrade path.
    assertEquals(bd.application_fee_amount_cents, bd.components.mingla_fee_cents);
  }
});
