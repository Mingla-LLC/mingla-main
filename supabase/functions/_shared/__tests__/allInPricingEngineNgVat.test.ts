// META-ORCH-1076 [Paystack Africa] Phase 1 — NG VAT engine regression.
//
// Proves the config-driven NG VAT path (region "NG", exclusive, computed
// in-engine from country_vat_config bps — NO Stripe round-trip) and that the
// GB/US/EU/CH paths are untouched.
//
// fails-on-revert: removing `case "NG":` from taxBehaviorForRegion makes the
// exhaustive `never` default throw "unsupported_pricing_region:NG" → the first
// NG assertion below throws. Removing computeConfigVat makes the module import
// fail to resolve → every test errors. Both verified before the META-ORCH-1076
// engine extension existed.
import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPricingBreakdown,
  computeBuyerSubtotal,
  computeConfigVat,
  feeFromBps,
  MINGLA_SERVICE_FEE_BPS,
  taxBehaviorForRegion,
  type ComputeAllInInput,
} from "../allInPricingEngine.ts";

Deno.test("NG region → exclusive VAT behavior (added on top)", () => {
  assertEquals(taxBehaviorForRegion("NG"), "exclusive");
});

Deno.test("GB/US/EU/CH tax behaviors are UNCHANGED by the NG addition", () => {
  assertEquals(taxBehaviorForRegion("GB"), "inclusive");
  assertEquals(taxBehaviorForRegion("EU"), "inclusive");
  assertEquals(taxBehaviorForRegion("CH"), "inclusive");
  assertEquals(taxBehaviorForRegion("US"), "exclusive");
});

Deno.test("computeConfigVat — pass_tax=true adds 7.5% NG VAT on top", () => {
  // ₦5,000 base = 500000 kobo. 7.5% = 750 bps.
  const subtotal = 500000;
  const { taxCents, buyerTotalCents } = computeConfigVat(subtotal, 750, true);
  assertEquals(taxCents, 37500); // 7.5% of 500000 = 37500 kobo (₦375)
  assertEquals(buyerTotalCents, 537500); // 500000 + 37500
});

Deno.test("computeConfigVat — pass_tax=false: buyer pays subtotal, VAT recorded but NOT added", () => {
  const subtotal = 500000;
  const { taxCents, buyerTotalCents } = computeConfigVat(subtotal, 750, false);
  // taxCents still reflects the VAT the BRAND owes (for absorbed reporting)…
  assertEquals(taxCents, 37500);
  // …but the buyer total excludes it (the brand absorbs the VAT).
  assertEquals(buyerTotalCents, 500000);
});

Deno.test("computeConfigVat — zero vat bps yields zero tax", () => {
  assertEquals(computeConfigVat(500000, 0, true), { taxCents: 0, buyerTotalCents: 500000 });
});

Deno.test("NG all-in: base + passed fees + 7.5% VAT, in kobo (config_vat basis)", () => {
  // ₦5,000 base, 600 bps take-rate, all switches pass=true.
  const input: ComputeAllInInput = {
    baseCents: 500000,
    switches: { pass_tax: true, pass_mingla_fee: true, pass_service_fee: true },
    region: "NG",
    currency: "NGN",
    effectiveTakeRateBps: 600,
    takeRateSource: "platform_default",
    serviceFeeBps: MINGLA_SERVICE_FEE_BPS, // 300
  };
  const subtotal = computeBuyerSubtotal(input);
  const miglaFee = feeFromBps(500000, 600); // 30000
  const serviceFee = feeFromBps(500000, 300); // 15000
  assertEquals(subtotal.miglaFeeCents, miglaFee);
  assertEquals(subtotal.serviceFeeCents, serviceFee);
  assertEquals(subtotal.buyerSubtotalCents, 500000 + miglaFee + serviceFee); // 545000

  const { taxCents, buyerTotalCents } = computeConfigVat(
    subtotal.buyerSubtotalCents,
    750,
    true,
  );
  assertEquals(taxCents, feeFromBps(545000, 750)); // 40875
  assertEquals(buyerTotalCents, 545000 + 40875); // 585875

  const breakdown = buildPricingBreakdown({
    input,
    amountTotalCents: buyerTotalCents,
    taxCents,
    taxBasis: "config_vat",
    stripeTaxCalculationId: null,
  });
  assertEquals(breakdown.tax_basis, "config_vat");
  assertEquals(breakdown.tax_behavior, "exclusive");
  assertEquals(breakdown.buyer_total_cents, 585875);
  assertEquals(breakdown.components.tax_cents, 40875);
  assertEquals(breakdown.passed.tax_cents, 40875); // passed
  assertEquals(breakdown.absorbed.tax_cents, 0);
  assertEquals(breakdown.application_fee_amount_cents, miglaFee);
  assertEquals(breakdown.currency, "NGN");
});

Deno.test("NG all-in absorbed VAT: buyer total excludes VAT, breakdown records it absorbed", () => {
  const input: ComputeAllInInput = {
    baseCents: 500000,
    switches: { pass_tax: false, pass_mingla_fee: true, pass_service_fee: true },
    region: "NG",
    currency: "NGN",
    effectiveTakeRateBps: 600,
    takeRateSource: "platform_default",
    serviceFeeBps: 300,
  };
  const subtotal = computeBuyerSubtotal(input);
  const { taxCents, buyerTotalCents } = computeConfigVat(
    subtotal.buyerSubtotalCents,
    750,
    false,
  );
  // Buyer pays subtotal only (no VAT line).
  assertEquals(buyerTotalCents, subtotal.buyerSubtotalCents);

  const breakdown = buildPricingBreakdown({
    input,
    amountTotalCents: buyerTotalCents,
    taxCents,
    taxBasis: "config_vat",
    stripeTaxCalculationId: null,
  });
  assertEquals(breakdown.passed.tax_cents, 0);
  assertEquals(breakdown.absorbed.tax_cents, taxCents); // brand absorbs it
});

Deno.test("unmapped region still throws (exhaustive guard intact)", () => {
  assertThrows(
    // deno-lint-ignore no-explicit-any
    () => taxBehaviorForRegion("ZZ" as any),
    Error,
    "unsupported_pricing_region",
  );
});
