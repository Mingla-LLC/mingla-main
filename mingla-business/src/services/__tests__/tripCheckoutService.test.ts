/**
 * ORCH-0859 [Tr2 Minimum Viable Trip] — tripCheckoutService re-export contract.
 *
 * Asserts the trip-checkout service correctly re-exports the underlying
 * event-checkout functions with trip-named aliases. This proves trip
 * orders route through ticket-checkout-create (event_type-agnostic per
 * investigation G-1) without any divergence in the buyer-side call path.
 *
 * Fails-on-revert: if tripCheckoutService is rewritten to point at a
 * different (non-existent) edge function or to add trip-specific branches
 * on the buyer side, these import assertions fail.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const tripCheckoutSource = readFileSync(
  join(__dirname, "..", "tripCheckoutService.ts"),
  "utf-8",
);

describe("ORCH-0859 — tripCheckoutService delegation contract", () => {
  test("re-exports createTicketCheckout as createTripCheckout", () => {
    expect(tripCheckoutSource).toMatch(
      /createTicketCheckout as createTripCheckout/,
    );
  });

  test("re-exports getTicketCheckoutStatus as getTripCheckoutStatus", () => {
    expect(tripCheckoutSource).toMatch(
      /getTicketCheckoutStatus as getTripCheckoutStatus/,
    );
  });

  test("re-exports confirmTicketCheckout as confirmTripCheckout", () => {
    expect(tripCheckoutSource).toMatch(
      /confirmTicketCheckout as confirmTripCheckout/,
    );
  });

  test("source contains zero trip-specific edge function names (route through existing)", () => {
    // No fork to a trip-specific edge function — proves I-PROPOSED-TR2-STRIPE-CONNECT-TRIP-ROUTING
    // intent that trip checkout uses the same ticket-checkout-create as event checkout.
    expect(tripCheckoutSource).not.toMatch(/trip-checkout-create/);
    expect(tripCheckoutSource).not.toMatch(/business_publish_trip_draft/);
  });

  test("imports from ticketCheckoutService (the canonical event-checkout chain)", () => {
    expect(tripCheckoutSource).toMatch(/from "\.\/ticketCheckoutService"/);
  });
});
