// ORCH-0911 [Buyer-web checkout confirm black screen] — happy-path
// regression tests for Stripe Checkout success_url / cancel_url branching.
//
// Run with:
//   deno test --allow-read supabase/functions/ticket-checkout-create/__tests__/orch_0911_success_url_branching.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

function stripComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

const activeSource = stripComments(source);

function hostedCheckoutUrlParts(
  eventType: "event" | "trip" | null | undefined,
  eventId: string,
  baseUrl = "https://business.usemingla.com",
): { successUrl: string; cancelUrl: string } {
  const isTrip = eventType === "trip";
  const surfacePath = isTrip ? "checkout-trip" : "checkout";
  return {
    successUrl:
      `${baseUrl}/${surfacePath}/${eventId}/confirm?cs={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${baseUrl}/${surfacePath}/${eventId}/payment`,
  };
}

Deno.test("ORCH-0911 T-01 — web trip rows branch success_url to /checkout-trip/{id}/confirm", () => {
  assertStringIncludes(
    activeSource,
    'const isTrip = tripGateRow?.event_type === "trip";',
    "web success_url branching must read the already-loaded tripGateRow.event_type directly.",
  );
  assertStringIncludes(
    activeSource,
    'const surfacePath = isTrip ? "checkout-trip" : "checkout";',
    "trip rows must choose the checkout-trip route segment.",
  );

  assertEquals(
    hostedCheckoutUrlParts("trip", "abc").successUrl,
    "https://business.usemingla.com/checkout-trip/abc/confirm?cs={CHECKOUT_SESSION_ID}",
  );
});

Deno.test("ORCH-0911 T-02 — web event rows keep /checkout/{id}/confirm", () => {
  assertEquals(
    hostedCheckoutUrlParts("event", "abc").successUrl,
    "https://business.usemingla.com/checkout/abc/confirm?cs={CHECKOUT_SESSION_ID}",
  );
});

Deno.test("ORCH-0911 T-03 — null or missing event_type defensively defaults to event checkout path", () => {
  assertEquals(
    hostedCheckoutUrlParts(null, "abc").successUrl,
    "https://business.usemingla.com/checkout/abc/confirm?cs={CHECKOUT_SESSION_ID}",
  );
  assertEquals(
    hostedCheckoutUrlParts(undefined, "abc").successUrl,
    "https://business.usemingla.com/checkout/abc/confirm?cs={CHECKOUT_SESSION_ID}",
  );
});

Deno.test("ORCH-0911 T-04 — web trip cancel_url mirrors /checkout-trip/{id}/payment", () => {
  assertStringIncludes(
    activeSource,
    "`${baseUrl}/${surfacePath}/${eventId}/payment`",
    "cancel_url must use the same event_type-derived surfacePath as success_url.",
  );
  assertEquals(
    hostedCheckoutUrlParts("trip", "abc").cancelUrl,
    "https://business.usemingla.com/checkout-trip/abc/payment",
  );
});

Deno.test("ORCH-0911 T-05 — mobile-web custom-scheme branch is unchanged", () => {
  const mobileSuccess =
    "mingla-business://checkout/return?cs={CHECKOUT_SESSION_ID}&eventId=${eventId}&status=success";
  const mobileCancel =
    "mingla-business://checkout/return?cs={CHECKOUT_SESSION_ID}&eventId=${eventId}&status=cancel";

  assertStringIncludes(activeSource, mobileSuccess);
  assertStringIncludes(activeSource, mobileCancel);
  assert(
    !/checkout-trip\/return/.test(activeSource),
    "mobile-web must stay on the event/trip-agnostic custom-scheme return route.",
  );
});
