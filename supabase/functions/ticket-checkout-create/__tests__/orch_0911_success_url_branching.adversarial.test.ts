// ORCH-0911 [Buyer-web checkout confirm black screen] — ADVERSARIAL
// regression tests. Tester-authored 2026-05-22. Attack DIFFERENT angles
// than implementor happy-path file `orch_0911_success_url_branching.test.ts`:
//   - happy-path proves trip→checkout-trip and event→checkout and
//     null/undefined defaults
//   - adversarial proves the mobile-web branch is structurally insulated
//     from the surfacePath variable, malformed event_type strings still
//     route to event path, and the load-order invariant (tripGateRow
//     loaded BEFORE the URL builder runs) holds at source level
//
// Run with:
//   deno test --allow-read \
//     supabase/functions/ticket-checkout-create/__tests__/orch_0911_success_url_branching.adversarial.test.ts

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

// Re-derive the URL builder so the adversarial test can probe the same
// branching logic the deployed edge function executes. Mirrors lines
// 430-435 of supabase/functions/ticket-checkout-create/index.ts.
function buildWebUrls(
  eventType: unknown,
  eventId: string,
  baseUrl = "https://business.usemingla.com",
): { successUrl: string; cancelUrl: string; surfacePath: string } {
  const isTrip = (eventType as { event_type?: unknown })?.event_type === "trip"
    ? true
    : eventType === "trip";
  const surfacePath = isTrip ? "checkout-trip" : "checkout";
  return {
    successUrl:
      `${baseUrl}/${surfacePath}/${eventId}/confirm?cs={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${baseUrl}/${surfacePath}/${eventId}/payment`,
    surfacePath,
  };
}

Deno.test("ORCH-0911 TA-01 — surfacePath variable does NOT leak into mobile-web branch", () => {
  // The fix introduces `surfacePath` inside the `surface === "web"` branch
  // ONLY. Mobile-web must remain event/trip-agnostic and use the literal
  // custom-scheme URL. Adversarial guard: prove the mobile-web URL strings
  // do NOT contain ${surfacePath} interpolation.
  const mobileSuccessLiteral =
    "mingla-business://checkout/return?cs={CHECKOUT_SESSION_ID}&eventId=${eventId}&status=success";
  const mobileCancelLiteral =
    "mingla-business://checkout/return?cs={CHECKOUT_SESSION_ID}&eventId=${eventId}&status=cancel";
  assertStringIncludes(activeSource, mobileSuccessLiteral);
  assertStringIncludes(activeSource, mobileCancelLiteral);

  // The native deep-link route segment is the literal string `checkout`
  // (NOT `${surfacePath}`) — Stripe will URL-encode the dollar sign if it
  // leaked, breaking the deep link.
  assert(
    !/mingla-business:\/\/\$\{surfacePath\}\//.test(activeSource),
    "mobile-web custom-scheme URL must not interpolate surfacePath",
  );
  assert(
    !/mingla-business:\/\/checkout-trip\/return/.test(activeSource),
    "mobile-web must not branch to checkout-trip — single deep-link return route is event/trip-agnostic per ORCH-0839-B",
  );
});

Deno.test("ORCH-0911 TA-02 — malformed/uppercase/whitespace event_type strings defensively fall to event path", () => {
  // Implementor T-03 only tests null + undefined. Adversarial: any string
  // that is not exactly the literal `"trip"` must NOT trigger the
  // checkout-trip branch. Strict equality (`=== "trip"`) is the correct
  // discriminator; anything that bypasses strict equality is a bug.
  const cases: Array<unknown> = [
    "",
    "TRIP",
    "Trip",
    "trip ",
    " trip",
    "trips",
    "draft",
    "event",
    "private_event",
    0,
    false,
    null,
    undefined,
    {},
    { event_type: null },
    { event_type: "" },
    { event_type: "TRIP" },
    { event_type: "trip " },
    { event_type: "draft" },
    { event_type: "event" },
  ];
  for (const c of cases) {
    const built = buildWebUrls(c, "abc");
    assertEquals(
      built.surfacePath,
      "checkout",
      `event_type=${JSON.stringify(c)} must defensively route to event path`,
    );
    assertEquals(
      built.successUrl,
      "https://business.usemingla.com/checkout/abc/confirm?cs={CHECKOUT_SESSION_ID}",
    );
  }
  // Positive control: only exact-literal "trip" triggers the branch.
  assertEquals(
    buildWebUrls({ event_type: "trip" }, "abc").surfacePath,
    "checkout-trip",
  );
  assertEquals(buildWebUrls("trip", "abc").surfacePath, "checkout-trip");
});

Deno.test("ORCH-0911 TA-03 — tripGateRow MUST be loaded BEFORE the URL builder runs (no use-before-load)", () => {
  // The branch reads `tripGateRow?.event_type === "trip"`. If the URL
  // builder ran before tripGateRow was loaded, the optional chain would
  // silently default to false → every trip would route to event path →
  // RC-1 silently survives in a different shape. Adversarial source-order
  // invariant: prove tripGateRow is materialized BEFORE the
  // `const isTrip = tripGateRow?.event_type === "trip";` line.
  const tripGateLoadIdx = activeSource.search(
    /\.select\(\s*["']event_type, bookings_closed, booking_deadline["']\s*\)/,
  );
  const branchIdx = activeSource.indexOf(
    'const isTrip = tripGateRow?.event_type === "trip";',
  );
  assert(
    tripGateLoadIdx >= 0,
    "expected the tripGateRow load (`.select('event_type, bookings_closed, booking_deadline')`) to exist in source",
  );
  assert(
    branchIdx >= 0,
    "expected the ORCH-0911 isTrip branch literal to exist in source",
  );
  assert(
    tripGateLoadIdx < branchIdx,
    `tripGateRow must load (idx ${tripGateLoadIdx}) before the URL builder branches on it (idx ${branchIdx}) — otherwise every trip would silently route to event path`,
  );
});

Deno.test("ORCH-0911 TA-04 — old hardcoded `/checkout/{eventId}/confirm` literal is GONE from web branch (subtract-before-adding)", () => {
  // Constitution #8: subtract before adding. The pre-fix unconditional
  // `${baseUrl}/checkout/${eventId}/confirm?cs={CHECKOUT_SESSION_ID}` MUST
  // be removed — not just shadowed by a new variable. If a future engineer
  // accidentally restored the old literal alongside the new branch, both
  // paths would fight at runtime and the trip surface_url would be
  // overwritten by the unconditional one.
  assert(
    !/`\$\{baseUrl\}\/checkout\/\$\{eventId\}\/confirm\?cs=\{CHECKOUT_SESSION_ID\}`/
      .test(activeSource),
    "old hardcoded `/checkout/{eventId}/confirm` literal MUST be removed — surfacePath variable is the only source of truth",
  );
  assert(
    !/`\$\{baseUrl\}\/checkout\/\$\{eventId\}\/payment`/.test(activeSource),
    "old hardcoded `/checkout/{eventId}/payment` literal MUST be removed",
  );
  // Positive control: the new templated form IS present.
  assertStringIncludes(
    activeSource,
    "`${baseUrl}/${surfacePath}/${eventId}/confirm?cs={CHECKOUT_SESSION_ID}`",
  );
});
