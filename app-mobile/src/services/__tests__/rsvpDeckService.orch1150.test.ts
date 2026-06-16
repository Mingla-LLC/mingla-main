import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ORCH-1150 [consumer RSVP deck card] Step 10 — source-contract regression.
//
// rsvpDeckService.ts + ConsumerEventDetailScreen.tsx import RN-bound modules
// (./supabase, expo-haptics, react-native), so per the established app-mobile
// service-test pattern (deckService.orch1065.test.ts) we read the source as
// text and assert the LOCKED contract:
//   (a) the deck RSVP write calls the public-submit-rsvp edge fn (NOT a checkout
//       / order RPC) and bubbles the { error } code;
//   (b) the consumer event detail screen renders a Going/Not-going dock for an
//       event_type='rsvp' card instead of the cart bar, and STILL mounts the
//       TicketCartSheet for the ticketed path (deck-off-EBES invariant);
//   (c) the RSVP write never routes to /checkout.
//
// Fails-on-revert (LOCKED): removing the public-submit-rsvp invoke, or the
// isRsvp dock branch, or re-pointing the RSVP tap at the cart, makes this FAIL.

const svc = await Deno.readTextFile(
  new URL("../rsvpDeckService.ts", import.meta.url),
);
const screen = await Deno.readTextFile(
  new URL("../../screens/Event/ConsumerEventDetailScreen.tsx", import.meta.url),
);

Deno.test("ORCH-1150 T-10a: deck RSVP write hits public-submit-rsvp, bubbles code", () => {
  assertStringIncludes(svc, '"public-submit-rsvp"');
  assertStringIncludes(svc, "submitDeckRsvp");
  // bubbles the edge-fn error code (rsvp_full / rsvp_not_open / …)
  assertStringIncludes(svc, "parsed.error");
  // never an order / checkout
  assert(!svc.includes("ticket-checkout-create"));
  assert(!svc.includes("/checkout"));
});

Deno.test("ORCH-1150 T-10b: detail screen docks Going/Not-going for an RSVP card", () => {
  assertStringIncludes(screen, 'seed?.eventType === "rsvp"');
  assertStringIncludes(screen, "isRsvp ? rsvpDock : dockedReserve");
  assertStringIncludes(screen, "submitDeckRsvp");
  assertStringIncludes(screen, "orch-1150-deck-rsvp-going");
  assertStringIncludes(screen, "orch-1150-deck-rsvp-not-going");
});

Deno.test("ORCH-1150 T-10c: ticketed path untouched — TicketCartSheet still mounted", () => {
  // The deck-off-EBES invariant: the cart stays the ticketed reserve path.
  assertStringIncludes(screen, "TicketCartSheet");
  // RSVP suppresses the cart float bar but does NOT remove the cart mount.
  assertStringIncludes(screen, "isRsvp ? null : floatingReserve");
});
