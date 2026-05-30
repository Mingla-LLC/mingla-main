// supabase/functions/__tests__/orch_0955_native_stripe_tax.test.ts
//
// [TEST-MOD-APPROVED ORCH-1006]
//
// ORCH-0955 ORIGINALLY locked the native paid-checkout tax contract as:
//   - tax_behavior: "exclusive" (tax added on top), and
//   - customer_details.address sourced from the BUYER's billing address.
//
// ORCH-1006 Slice 2 INVERTS that contract per SPEC §B (Tax-Sourcing Contract):
//   - Tax is sourced at the VENUE (events.venue_tax_address), never the buyer
//     (SPEC §B.1/§B.3). The buyer-address parse/validate helpers are DELETED
//     (SPEC §B.6) — invariant I-PROPOSED-ALLIN-VENUE-TAX-BASIS.
//   - tax_behavior is derived from the region (GB → "inclusive"), never a
//     hardcoded literal (SPEC §B.5) — invariant I-PROPOSED-ALLIN-REGION-TAX-BEHAVIOR.
//   - A tax-calc failure / unregistered brand / unresolved venue DEGRADES to
//     flat brand-absorbed pricing (one clean number), NEVER a failed session
//     (SPEC §B.4, tests T-02/T-10).
//   - The application fee is the resolved take-rate (Slice 1), not the old
//     hardcoded Math.round(totalCents * 0.015).
//
// This is a source-contract test (greps the edge function + webhook + refund
// source) rewritten to the ORCH-1006 contract. The behavioural engine math is
// covered by _shared/__tests__/allInPricingEngine.test.ts.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const read = (path: string): string =>
  Deno.readTextFileSync(`${Deno.cwd()}/${path}`);
const exists = (path: string): boolean => {
  try {
    Deno.statSync(`${Deno.cwd()}/${path}`);
    return true;
  } catch {
    return false;
  }
};

const EDGE = "supabase/functions/ticket-checkout-create/index.ts";

Deno.test("[ORCH-1006] tax calc runs before the native PI", () => {
  const src = read(EDGE);
  assert(
    src.indexOf("tax.calculations.create(") <
      src.indexOf("paymentIntents.create("),
  );
});

Deno.test("[ORCH-1006] tax_behavior is region-derived, NOT a hardcoded exclusive literal", () => {
  const src = read(EDGE);
  // The region map drives behavior (GB → inclusive).
  assertStringIncludes(src, "taxBehaviorForRegion(pricingRegion)");
  assertStringIncludes(src, "tax_behavior: taxBehavior");
  // The old hardcoded exclusive literal must be GONE
  // (invariant I-PROPOSED-ALLIN-REGION-TAX-BEHAVIOR).
  assertEquals(src.includes('tax_behavior: "exclusive"'), false);
});

Deno.test("[ORCH-1006] tax basis is the VENUE address, NOT the buyer's", () => {
  const src = read(EDGE);
  assertStringIncludes(src, "address: pricing.venue_tax_address");
  // Buyer-address parse/validate helpers are DELETED (SPEC §B.6).
  assertEquals(src.includes("function parseBuyerAddress"), false);
  assertEquals(src.includes("function validateBuyerAddress"), false);
  assertEquals(src.includes("buyer_address_required"), false);
});

Deno.test("[ORCH-1006] tax-calc failure DEGRADES to flat-absorb, not a failed session", () => {
  const src = read(EDGE);
  // The degrade basis values appear; the old hard-fail on tax error is gone.
  assertStringIncludes(src, "calc_failed_flat_absorb");
  assertStringIncludes(src, "country_unsupported_flat_absorb");
  assertStringIncludes(src, "degraded to flat-absorb");
  // The PI amount is the engine all-in, not the raw exclusive amount_total.
  assertStringIncludes(src, "amount: pricingBreakdown.buyer_total_cents");
});

Deno.test("[ORCH-1006] application fee is the resolved take-rate (Slice 1), not 1.5% hardcoded", () => {
  const src = read(EDGE);
  assertEquals(src.includes("applicationFeeAmountCents = Math.round"), false);
  assertEquals(src.includes("MINGLA_APPLICATION_FEE_RATE"), false);
  assertStringIncludes(
    src,
    "applicationFeeAmountCents = buyerSubtotal.miglaFeeCents",
  );
});

Deno.test("[ORCH-1006] pricing_breakdown is built + persisted + returned", () => {
  const src = read(EDGE);
  assertStringIncludes(src, "buildPricingBreakdown(");
  assertStringIncludes(src, "pricing_breakdown: pricingBreakdown");
  assertStringIncludes(src, "pricingBreakdown,"); // in the responses
});

Deno.test("[ORCH-1006] registration gate probes active registrations before charging tax", () => {
  const src = read(EDGE);
  assertStringIncludes(src, "tax.registrations.list(");
  assertStringIncludes(src, 'status: "active"');
});

Deno.test("[ORCH-1006] webhook still commits the Stripe Tax transaction on success", () => {
  const src = read("supabase/functions/_shared/stripeWebhookRouter.ts");
  assertStringIncludes(src, "mingla_tax_calculation_id");
  assert(/tax\.transactions\s*\.\s*createFromCalculation\s*\(/.test(src));
  assertStringIncludes(src, "stripe_tax_transaction_id");
});

Deno.test("[ORCH-1006] refund-order still reverses tax (full + partial)", () => {
  const src = read("supabase/functions/refund-order/index.ts");
  assertStringIncludes(src, "tax.transactions.createReversal(");
  assertStringIncludes(src, 'mode: isFullRefund ? "full" : "partial"');
});

Deno.test("[ORCH-1006] legacy region gate + dashboard fn remain removed (ORCH-0955)", () => {
  assertEquals(exists("supabase/functions/_shared/stripeTax.ts"), false);
  const legacyTaxFn = ["brand", "stripe", "tax", "dashboard", "link"].join("-");
  assertEquals(exists(`supabase/functions/${legacyTaxFn}/index.ts`), false);
});
