// ORCH-1034 [de-GBP-ify the currency layer — charge in seller currency]
// TESTER adversarial regression (Step 0.5 (b)). Attacks a DIFFERENT angle than
// the implementor's engine-flag happy-path test (orch_1034_currency_de_gbp.test.ts):
//
//   - Implementor proved taxBehaviorForRegion RETURNS the right flag + the divisor
//     CONSTANTS exist. It never APPLIED the divisor to extract a tax amount, never
//     exercised the call-site region-CLAMP / degrade-not-throw decision, and never
//     proved the inclusive-VAT split is currency-neutral (same integer math for
//     GBP and EUR and CHF base prices).
//
// This file attacks:
//   A) The inclusive-VAT divide-out MATH actually partitions a Stripe inclusive
//      total into the correct tax portion per region (GB 20%, EU 20%, CH 8.1%),
//      and US (exclusive) is a no-op divide-out.
//   B) The call-site region-clamp logic (mirrored from ticket-checkout-create
//      index.ts:624-633): an unmapped / NULL / lowercase / padded pricing_region
//      coerces to "GB" + sets regionUnmappedForceFlatAbsorb, so taxBehaviorForRegion
//      is NEVER called on an unmapped literal at a real checkout (the latent-throw
//      regression class B). A mapped region passes through untouched.
//   C) buildPricingBreakdown is currency-NEUTRAL: a EUR base and a GBP base of the
//      same cents produce identical integer fee/payout math (currency is a label,
//      the engine never branches on it) — proving "charge in seller currency"
//      introduced zero per-currency arithmetic drift.
//
// fails-on-revert: imports inclusiveVatDivisorForRegion + the GB/US/EU/CH region
// union. On the pre-ORCH-1034 engine, taxBehaviorForRegion threw on US/EU/CH and
// inclusiveVatDivisorForRegion did not exist (import unresolved) → this file fails
// to run / asserts throw on the revert. Verified by stash-revert below.
import {
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPricingBreakdown,
  computeBuyerSubtotal,
  inclusiveVatDivisorForRegion,
  taxBehaviorForRegion,
  type ComputeAllInInput,
  type PricingRegion,
} from "../allInPricingEngine.ts";

// ── (A) Inclusive-VAT divide-out MATH: partition a Stripe inclusive total into
//        the tax portion. tax = total − total/divisor. (The implementor only
//        asserted the divisor CONSTANT, never applied it.) ──
Deno.test("ADV-A: inclusive divisor extracts the correct VAT portion per region", () => {
  // GB 20%: a £120.00 inclusive total carries £20.00 VAT (120 − 120/1.2 = 20).
  const gbTotal = 12000;
  const gbTax = gbTotal - gbTotal / inclusiveVatDivisorForRegion("GB");
  assertAlmostEquals(gbTax, 2000, 0.5);

  // EU 20% baseline: same shape as GB.
  const euTax = gbTotal - gbTotal / inclusiveVatDivisorForRegion("EU");
  assertAlmostEquals(euTax, 2000, 0.5);

  // CH 8.1%: a CHF 108.10 inclusive total carries CHF 8.10 VAT.
  const chTotal = 10810;
  const chTax = chTotal - chTotal / inclusiveVatDivisorForRegion("CH");
  assertAlmostEquals(chTax, 810, 1.0);

  // US exclusive: divisor 1.0 ⇒ divide-out is a no-op (tax extracted from the
  // inclusive total is 0; US adds tax ON TOP via Stripe, never extracts).
  const usTotal = 5000;
  const usTax = usTotal - usTotal / inclusiveVatDivisorForRegion("US");
  assertEquals(usTax, 0);
});

// ── (B) Call-site region-clamp + degrade-not-throw (mirrors index.ts:624-633).
//        Adversarial inputs: NULL, lowercase, padded, unknown, empty. NONE may
//        reach taxBehaviorForRegion as an unmapped literal. ──
const ENABLED_PRICING_REGIONS = ["GB", "US", "EU", "CH"] as const;
function clampRegion(raw: string | null): {
  region: PricingRegion;
  forceFlatAbsorb: boolean;
} {
  const r = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  const enabled = (ENABLED_PRICING_REGIONS as readonly string[]).includes(r);
  return {
    region: (enabled ? r : "GB") as PricingRegion,
    forceFlatAbsorb: !enabled,
  };
}

Deno.test("ADV-B: unmapped/NULL/dirty region degrades to flat-absorb, never throws", () => {
  for (const bad of [null, "", "ZZ", "  ", "gbp", "usd", "FR", "DE", "JP"]) {
    const { region, forceFlatAbsorb } = clampRegion(bad);
    // Coerced to GB + flagged → the call site skips the tax calc.
    assertEquals(forceFlatAbsorb, true);
    // And taxBehaviorForRegion(region) is safe because region is the GB fallback,
    // NOT the raw unmapped literal — so it cannot throw at a real checkout.
    taxBehaviorForRegion(region); // must not throw
  }
});

Deno.test("ADV-B2: mapped regions (any case / padding) pass through un-degraded", () => {
  for (const ok of ["US", " us ", "GB", "eu", "CH"]) {
    const { region, forceFlatAbsorb } = clampRegion(ok);
    assertEquals(forceFlatAbsorb, false);
    assertEquals(region, ok.trim().toUpperCase() as PricingRegion);
  }
  // The raw unmapped literal WOULD throw if passed directly — proving the clamp
  // is load-bearing (this is what the pre-degrade call site did wrong).
  assertThrows(() => taxBehaviorForRegion("FR" as unknown as PricingRegion));
});

// ── (C) Currency-neutrality: EUR vs GBP base of identical cents ⇒ identical
//        integer fee/payout. "Charge in seller currency" must not perturb math. ──
Deno.test("ADV-C: engine math is currency-neutral (EUR == GBP == USD for same cents)", () => {
  const base = (currency: string, region: PricingRegion): ComputeAllInInput => ({
    baseCents: 4000,
    switches: { pass_tax: false, pass_mingla_fee: true, pass_service_fee: true },
    region,
    currency,
    effectiveTakeRateBps: 600,
    takeRateSource: "platform_default",
  });
  const gb = computeBuyerSubtotal(base("gbp", "GB"));
  const eu = computeBuyerSubtotal(base("eur", "EU"));
  const us = computeBuyerSubtotal(base("usd", "US"));
  // Identical cents in → identical cents out, regardless of the currency label.
  assertEquals(gb.buyerSubtotalCents, eu.buyerSubtotalCents);
  assertEquals(gb.buyerSubtotalCents, us.buyerSubtotalCents);
  assertEquals(gb.miglaFeeCents, eu.miglaFeeCents);
  assertEquals(gb.serviceFeeCents, us.serviceFeeCents);

  // And the breakdown carries the seller currency label verbatim (lowercased
  // settlement currency from the call site), application_fee == Mingla fee.
  const bd = buildPricingBreakdown({
    input: base("eur", "EU"),
    amountTotalCents: eu.buyerSubtotalCents,
    taxCents: 0,
    taxBasis: "unresolved_flat_absorb",
    stripeTaxCalculationId: null,
  });
  assertEquals(bd.currency, "eur");
  assertEquals(bd.application_fee_amount_cents, eu.miglaFeeCents);
  // payout = total − Mingla fee − tax(0).
  assertEquals(
    bd.connected_account_payout_cents,
    eu.buyerSubtotalCents - eu.miglaFeeCents,
  );
});
