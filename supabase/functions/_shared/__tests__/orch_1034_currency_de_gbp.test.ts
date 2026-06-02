// ORCH-1034 [de-GBP-ify the currency layer — charge in seller currency]
// Implementor happy-path regression (Step 0.5). Proves the engine's tax_behavior
// is now a per-region DISPLAY flag (GB/EU/CH → inclusive, US → exclusive, no
// GB-throw) and the inclusive-VAT display divisor is per-region (not hardcoded
// /1.2). The tester writes the adversarial counterpart separately.
//
// fails-on-revert: on the pre-ORCH-1034 engine, taxBehaviorForRegion only had a
// "GB" case and THREW on "US"/"EU"/"CH" (the `never` default), so the US/EU/CH
// assertions below throw and the test FAILS. inclusiveVatDivisorForRegion did
// not exist (import fails to resolve on revert). Verified by stash-revert.
import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPricingBreakdown,
  computeBuyerSubtotal,
  INCLUSIVE_VAT_DIVISOR,
  inclusiveVatDivisorForRegion,
  taxBehaviorForRegion,
  type ComputeAllInInput,
  type PricingRegion,
} from "../allInPricingEngine.ts";

// ── T-01 (happy): US region → exclusive sales tax (NOT inclusive VAT). ──
Deno.test("ORCH-1034: US region → exclusive tax_behavior", () => {
  assertEquals(taxBehaviorForRegion("US"), "exclusive");
});

// ── T-06 (happy): GB still inclusive (no regression for the formerly-locked region). ──
Deno.test("ORCH-1034: GB region → inclusive tax_behavior (preserved)", () => {
  assertEquals(taxBehaviorForRegion("GB"), "inclusive");
});

// ── EU + CH are enabled and inclusive (market convention). ──
Deno.test("ORCH-1034: EU + CH regions → inclusive tax_behavior", () => {
  assertEquals(taxBehaviorForRegion("EU"), "inclusive");
  assertEquals(taxBehaviorForRegion("CH"), "inclusive");
});

// ── No throw on any enabled region (the latent GB-throw is defused). ──
Deno.test("ORCH-1034: no throw on any enabled region", () => {
  const regions: PricingRegion[] = ["GB", "US", "EU", "CH"];
  for (const r of regions) {
    // must not throw
    taxBehaviorForRegion(r);
  }
});

// ── The exhaustive `never` guard still fires for a genuinely unmapped region
//    (programming-error catch). The call site degrades BEFORE reaching here. ──
Deno.test("ORCH-1034: unmapped region literal still throws (loud guard)", () => {
  assertThrows(
    () => taxBehaviorForRegion("ZZ" as unknown as PricingRegion),
    Error,
    "unsupported_pricing_region",
  );
});

// ── Inclusive-VAT display divisor is per-region (generalizes the hardcoded /1.2). ──
Deno.test("ORCH-1034: inclusive-VAT divisor is per-region", () => {
  assertEquals(inclusiveVatDivisorForRegion("GB"), 1.2); // 20%
  assertEquals(inclusiveVatDivisorForRegion("EU"), 1.2); // 20% baseline
  assertEquals(inclusiveVatDivisorForRegion("CH"), 1.081); // 8.1%
  assertEquals(inclusiveVatDivisorForRegion("US"), 1.0); // exclusive → no divide-out
  // Map is complete for every enabled region.
  for (const r of ["GB", "US", "EU", "CH"] as PricingRegion[]) {
    assertEquals(typeof INCLUSIVE_VAT_DIVISOR[r], "number");
  }
});

// ── A US-currency order builds a breakdown carrying exclusive behavior + the
//    seller (USD) currency, with NO inclusive VAT divide-out artifact. ──
Deno.test("ORCH-1034: US breakdown carries exclusive behavior + USD currency", () => {
  const input: ComputeAllInInput = {
    baseCents: 5000, // $50.00
    switches: { pass_tax: false, pass_mingla_fee: true, pass_service_fee: true },
    region: "US",
    currency: "usd",
    effectiveTakeRateBps: 600,
    takeRateSource: "platform_default",
  };
  const sub = computeBuyerSubtotal(input);
  // flat-absorb path: amount_total == subtotal, taxCents == 0.
  const bd = buildPricingBreakdown({
    input,
    amountTotalCents: sub.buyerSubtotalCents,
    taxCents: 0,
    taxBasis: "unresolved_flat_absorb",
    stripeTaxCalculationId: null,
  });
  assertEquals(bd.tax_behavior, "exclusive");
  assertEquals(bd.currency, "usd");
  assertEquals(bd.components.tax_cents, 0);
});
