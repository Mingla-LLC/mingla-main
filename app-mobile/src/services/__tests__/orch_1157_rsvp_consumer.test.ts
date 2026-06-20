import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ORCH-1157 [rsvp-public-redesign] — consumer RSVP source-contract regression
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

Deno.test("ORCH-1157 T-6a: deck RSVP write enum includes 'maybe' (consumer parity)", () => {
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

Deno.test("ORCH-1157 OQ-1: consumer momentum sourced via the anon business_public_events_view", () => {
  // fetchRsvpMomentum reads the SAME anon-safe view buyer-web uses (option a) —
  // NOT a widened deck RPC (option b → COMMS-0002). Never .from('brands').
  assertStringIncludes(svc, "fetchRsvpMomentum");
  assertStringIncludes(svc, 'from("business_public_events_view")');
  assertStringIncludes(svc, "rsvp_going_count");
  assert(!svc.includes('from("brands")'));
});

// ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
// The bespoke consumer RSVP-branch (the hand-wired RsvpMomentumDecision mount +
// handleRsvp + rsvpDock/dockedReserve/floatingReserve + deck testIDs) was DELETED
// and PROMOTED into the ONE shared RsvpOfferingBody + RsvpOfferingDecisionDock. The
// INVARIANT (consumer consumes the SHARED RSVP decision, wires the three-way union,
// fed by the anon-view momentum, never a cart on the RSVP path) is preserved; it
// now lives in the shared body the consumer mounts.
Deno.test("ORCH-1157 T-8: consumer detail consumes the SHARED RsvpOfferingBody (which owns RsvpMomentumDecision)", () => {
  // imports the shared body + decision dock from the offering-rendering package.
  assertStringIncludes(screen, "RsvpOfferingBody,");
  assertStringIncludes(screen, "RsvpOfferingDecisionDock,");
  assertStringIncludes(screen, '} from "@mingla/offering-rendering";');
  assertStringIncludes(screen, "<RsvpOfferingBody");
  // the shared body owns the RsvpMomentumDecision (going/maybe/not-going) — the
  // consumer feeds it the submit wrapper that carries the three-way union.
  assertStringIncludes(screen, "onSubmit={rsvpOnSubmit}");
  assertStringIncludes(screen, 'rsvpStatus: "going" | "not_going" | "maybe"');
  // the anon-view momentum query feeds the unit (via rsvpConfig).
  assertStringIncludes(screen, "fetchRsvpMomentum");
  assertStringIncludes(screen, "rsvpMomentum");
});

// ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
Deno.test("ORCH-1157 T-7: RSVP card docks the shared decision, never the cart bar (no checkout)", () => {
  // The deck-off-EBES + ORCH-1150 contract: RSVP → shared decision dock,
  // ticketed → the cart float bar. Same invariant, new shared structure. The
  // floating-overlay branch is gated `{isRsvp ? <RsvpOfferingDecisionDock> :
  // … <EventOfferingFloatingBar>}` so an RSVP card never gets the cart bar.
  const floatBranch = screen.slice(screen.indexOf("{isRsvp ? ("));
  const dockIdx = floatBranch.indexOf("<RsvpOfferingDecisionDock");
  const barIdx = floatBranch.indexOf("<EventOfferingFloatingBar");
  assert(dockIdx !== -1 && barIdx !== -1, "both the RSVP dock and the ticketed bar exist");
  assert(dockIdx < barIdx, "RSVP gets the decision dock; the cart bar is the non-RSVP fallback");
  // The RSVP write goes through the ticketless submitDeckRsvp wrapper (rsvpOnSubmit),
  // never a checkout — proven on the service in T-6a/OQ-1 above.
  assertStringIncludes(screen, "onSubmit={rsvpOnSubmit}");
});

// ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
Deno.test("ORCH-1157 consumer RSVP submit accepts the three-way reply union", () => {
  // the consumer onSubmit wrapper (handed to the shared body) carries the union.
  assertStringIncludes(
    screen,
    'rsvpStatus: "going" | "not_going" | "maybe";',
  );
});
