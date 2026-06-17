import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ORCH-1156 [rsvp-public-redesign] — consumer RSVP source-contract regression
// (implementor-owned happy-path). rsvpDeckService.ts + ConsumerEventDetailScreen
// import RN-bound modules, so per the established app-mobile service-test pattern
// (rsvpDeckService.orch1150.test.ts) we read the source as TEXT and assert the
// LOCKED Direction-C contract:
//   (a) the consumer write enum now includes "maybe" (parity with RsvpPublicBody);
//   (b) the consumer detail consumes the SHARED RsvpMomentumDecision unit (the
//       hand-rolled 2-button dock is gone) and wires Going/Maybe/Can't;
//   (c) the consumer momentum is sourced via the anon business_public_events_view
//       (OQ-1 option a — NO deck-RPC widen, NO COMMS-0002 trip);
//   (d) the RSVP path NEVER routes to a checkout/cart/price (ticketless).
//
// FAILS-ON-REVERT (proven by true line-deletion in the implementation report):
//   removing "maybe" from the write union, or the RsvpMomentumDecision import, or
//   the fetchRsvpMomentum anon-view read, or re-pointing the RSVP tap at the cart,
//   makes the relevant assertion FAIL.

const svc = await Deno.readTextFile(
  new URL("../rsvpDeckService.ts", import.meta.url),
);
const screen = await Deno.readTextFile(
  new URL("../../screens/Event/ConsumerEventDetailScreen.tsx", import.meta.url),
);

Deno.test("ORCH-1156 T-6a: deck RSVP write enum includes 'maybe' (consumer parity)", () => {
  // submitDeckRsvp accepts going | not_going | maybe.
  assertStringIncludes(
    svc,
    'rsvpStatus: "going" | "not_going" | "maybe",',
  );
  // result status union widened to carry maybe.
  assertStringIncludes(svc, '"going" | "not_going" | "waitlisted" | "maybe"');
  // still the public-submit-rsvp edge fn, never a checkout/order.
  assertStringIncludes(svc, '"public-submit-rsvp"');
  assert(!svc.includes("ticket-checkout-create"));
  assert(!svc.includes("/checkout"));
});

Deno.test("ORCH-1156 OQ-1: consumer momentum sourced via the anon business_public_events_view", () => {
  // fetchRsvpMomentum reads the SAME anon-safe view buyer-web uses (option a) —
  // NOT a widened deck RPC (option b → COMMS-0002). Never .from('brands').
  assertStringIncludes(svc, "fetchRsvpMomentum");
  assertStringIncludes(svc, 'from("business_public_events_view")');
  assertStringIncludes(svc, "rsvp_going_count");
  assert(!svc.includes('from("brands")'));
});

Deno.test("ORCH-1156 T-8: consumer detail consumes the SHARED RsvpMomentumDecision", () => {
  assertStringIncludes(
    screen,
    'import {\n  OfferingChrome,\n  RsvpMomentumDecision,',
  );
  assertStringIncludes(screen, "<RsvpMomentumDecision");
  // Going / Maybe / Can't all wired through handleRsvp.
  assertStringIncludes(screen, 'handleRsvp("going")');
  assertStringIncludes(screen, 'handleRsvp("maybe")');
  assertStringIncludes(screen, 'handleRsvp("not_going")');
  // the anon-view momentum query feeds the unit.
  assertStringIncludes(screen, "fetchRsvpMomentum");
  assertStringIncludes(screen, "rsvpMomentum");
});

Deno.test("ORCH-1156 T-7: RSVP card docks the decision, never the cart bar (no checkout)", () => {
  // The deck-off-EBES + ORCH-1150 contract: RSVP → rsvpDock, ticketed → cart.
  assertStringIncludes(screen, "isRsvp ? rsvpDock : dockedReserve");
  assertStringIncludes(screen, "isRsvp ? null : floatingReserve");
  // the RSVP dock + momentum unit carry the ORCH-1156 testIDs.
  assertStringIncludes(screen, "orch-1150-deck-rsvp-going");
  assertStringIncludes(screen, "orch-1156-deck-rsvp-maybe");
  assertStringIncludes(screen, "orch-1150-deck-rsvp-not-going");
});

Deno.test("ORCH-1156 handleRsvp accepts the three-way reply union", () => {
  assertStringIncludes(
    screen,
    'next: "going" | "not_going" | "maybe"',
  );
});
