// ORCH-0788 — adapter unit tests.
// Pure-function tests covering T-01 through T-05 from SPEC §12.

import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  type BuyerContext,
  orderCancelledToGenericBody,
  refundIssuedToGenericBody,
} from "../buyerLifecycleAdapters.ts";

const baseContext: BuyerContext = {
  buyerName: "Alex Stone",
  eventTitle: "Rooftop Mixer",
  brandName: "Skyline Hosts",
  orderShortId: "a3f71d85",
};

Deno.test("T-01: refundIssuedToGenericBody — full refund email renders", () => {
  const body = refundIssuedToGenericBody(
    {
      template_key: "buyer_refund_issued",
      amount_cents: 5000,
      currency: "USD",
      reason: "Customer request",
      is_full_refund: true,
    },
    baseContext,
  );
  assertEquals(body.variant, "generic_notification");
  assertEquals(body.cta, null);
  assertStringIncludes(body.title, "Your refund for Rooftop Mixer is on the way");
  assert(body.paragraphs.length >= 4);
  // Contains amount + order short id
  const joined = body.paragraphs.join(" | ");
  assertStringIncludes(joined, "$50.00");
  assertStringIncludes(joined, "#a3f71d85");
  assertStringIncludes(joined, "Reason: Customer request");
  // Full refund: no "remaining tickets are still valid" paragraph
  assertFalse(joined.includes("remaining tickets"));
});

Deno.test("T-02: refundIssuedToGenericBody — partial refund includes remaining-tickets paragraph", () => {
  const body = refundIssuedToGenericBody(
    {
      template_key: "buyer_refund_issued",
      amount_cents: 2500,
      currency: "USD",
      reason: "Partial credit",
      is_full_refund: false,
    },
    baseContext,
  );
  assertStringIncludes(body.title, "A partial refund");
  const joined = body.paragraphs.join(" | ");
  assertStringIncludes(joined, "remaining tickets on this order are still valid");
});

Deno.test("T-03: refundIssuedToGenericBody — without reason omits reason paragraph", () => {
  const body = refundIssuedToGenericBody(
    {
      template_key: "buyer_refund_issued",
      amount_cents: 5000,
      currency: "USD",
      is_full_refund: true,
    },
    baseContext,
  );
  const joined = body.paragraphs.join(" | ");
  assertFalse(joined.includes("Reason:"));
});

Deno.test("T-04: orderCancelledToGenericBody — cancel email renders", () => {
  const body = orderCancelledToGenericBody(
    {
      template_key: "buyer_order_cancelled",
      reason: "Event postponed",
    },
    baseContext,
  );
  assertEquals(body.variant, "generic_notification");
  assertEquals(body.cta, null);
  assertStringIncludes(body.title, "Your order for Rooftop Mixer has been cancelled");
  const joined = body.paragraphs.join(" | ");
  assertStringIncludes(joined, "Reason: Event postponed");
  assertStringIncludes(joined, "tickets are no longer valid");
  assertStringIncludes(joined, "refund will be processed separately");
});

Deno.test("T-05: orderCancelledToGenericBody — without reason omits reason paragraph", () => {
  const body = orderCancelledToGenericBody(
    { template_key: "buyer_order_cancelled" },
    baseContext,
  );
  const joined = body.paragraphs.join(" | ");
  assertFalse(joined.includes("Reason:"));
});

Deno.test("ORCH-0788 §5.1: adapters never double-escape — emit plain strings (renderer escapes)", () => {
  // genericBody.ts already runs escapeHtml on title + paragraphs. If adapters
  // ALSO escape, buyers see literal `&amp;` instead of `&`. This test guards
  // against future regressions where someone might add escape calls here.
  const body = refundIssuedToGenericBody(
    {
      template_key: "buyer_refund_issued",
      amount_cents: 1000,
      currency: "USD",
      reason: "Bad & sad",  // ampersand triggers escaping
      is_full_refund: true,
    },
    baseContext,
  );
  const joined = body.paragraphs.join(" | ");
  // Raw ampersand should be present (renderer will escape it once).
  assertStringIncludes(joined, "Bad & sad");
  // No double-escaped form like `&amp;` should appear here.
  assertFalse(joined.includes("&amp;"));
});

Deno.test("ORCH-0788: anonymous buyer (null buyerName) renders graceful greeting", () => {
  const body = orderCancelledToGenericBody(
    { template_key: "buyer_order_cancelled", reason: "Event postponed" },
    { ...baseContext, buyerName: null },
  );
  assertEquals(body.paragraphs[0], "Hi,");
});

Deno.test("ORCH-0788: refund renders with GBP currency", () => {
  const body = refundIssuedToGenericBody(
    {
      template_key: "buyer_refund_issued",
      amount_cents: 5000,
      currency: "GBP",
      is_full_refund: true,
    },
    baseContext,
  );
  const joined = body.paragraphs.join(" | ");
  // en-GB locale renders £
  assertStringIncludes(joined, "£50.00");
});
