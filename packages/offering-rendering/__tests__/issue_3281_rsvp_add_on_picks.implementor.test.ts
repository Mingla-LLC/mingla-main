// MINGLA-INVARIANT: I-ADDON-RSVP-FREE-PICKS-ONLY | issue #3281 | Until paid RSVP add-ons are decided, a guest can pick only free RSVP add-ons, up to maxPerTicket for each person in their party and never more than the places left on any date the add-on runs.
/**
 * issue #3281 S6 (checkpoint 16) — the RSVP add-on picks (pure half), mirroring
 * issue_3281_submit_rsvp_with_add_ons: free only, cap = maxPerTicket x party,
 * bounded by places left (per date for a dated add-on), and the guest's copy
 * for each refusal public-submit-rsvp returns.
 *
 * FAILS-ON-REVERT: drop the priceCents filter, count the party as 1, ignore a
 * dated add-on's per-date places, or return null for an add-on refusal -> red.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  freeRsvpAddOns,
  rsvpAddOnCap,
  rsvpAddOnLines,
  rsvpAddOnPicksFit,
  withRsvpAddOnQuantity,
} from "../rsvpAddOnPicks.ts";
import { rsvpAddOnRefusalCopy, rsvpRefusalLine } from "../rsvpAddOnErrors.ts";

const item = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: "a1",
  name: "Reserved seat",
  description: null,
  priceCents: 0,
  priceAllInCents: 0,
  maxPerTicket: 1,
  isUnlimited: true,
  validOccurrenceIds: null,
  remaining: null,
  showOnPublicPage: true,
  ...over,
});

Deno.test("#3281 S6 only free RSVP add-ons can be picked, hidden ones included", () => {
  const extras = freeRsvpAddOns([
    item({ id: "free" }),
    item({ id: "paid", name: "Drinks", priceCents: 1500, priceAllInCents: 1650 }),
    item({ id: "hidden", name: "Wristband", showOnPublicPage: false }),
    "junk",
  ]);
  assertEquals(extras.map((e) => e.id), ["free", "hidden"]);
  assertEquals(freeRsvpAddOns(null), []);
});

Deno.test("#3281 S6 the cap counts every person in the party and the places left", () => {
  const [unlimited] = freeRsvpAddOns([item({ maxPerTicket: 2 })]);
  assertEquals(rsvpAddOnCap(unlimited, 1), 2);
  assertEquals(rsvpAddOnCap(unlimited, 3), 6);
  const [limited] = freeRsvpAddOns([item({ maxPerTicket: 2, isUnlimited: false, remaining: 3 })]);
  assertEquals(rsvpAddOnCap(limited, 3), 3);
  const [soldOut] = freeRsvpAddOns([item({ isUnlimited: false, remaining: 0 })]);
  assertEquals(rsvpAddOnCap(soldOut, 2), 0);
  const [dated] = freeRsvpAddOns([
    item({ maxPerTicket: 4, isUnlimited: false, validOccurrenceIds: ["d1", "d2"], remaining: { d1: 5, d2: 1 } }),
  ]);
  assertEquals(rsvpAddOnCap(dated, 2), 1);
});

Deno.test("#3281 S6 picks fit only when every one is offered and within the party's cap", () => {
  const extras = freeRsvpAddOns([item({ id: "tee", maxPerTicket: 2 })]);
  assertEquals(rsvpAddOnPicksFit([{ addOnId: "tee", quantity: 4 }], extras, 2), true);
  assertEquals(rsvpAddOnPicksFit([{ addOnId: "tee", quantity: 4 }], extras, 1), false);
  assertEquals(rsvpAddOnPicksFit([{ addOnId: "gone", quantity: 1 }], extras, 1), false);
  assertEquals(rsvpAddOnPicksFit([], extras, 1), true);
});

Deno.test("#3281 S6 the confirmation line names what was sent", () => {
  const raw = [item({ id: "seat", name: "Reserved seat" }), item({ id: "tee", name: "Tee", maxPerTicket: 2 })];
  assertEquals(
    rsvpAddOnLines(raw, [{ addOnId: "tee", quantity: 2 }, { addOnId: "seat", quantity: 1 }]),
    [{ name: "Tee", quantity: 2 }, { name: "Reserved seat", quantity: 1 }],
  );
});

Deno.test("#3281 S6 every add-on refusal has the guest's copy; others are not ours", () => {
  assertEquals(rsvpAddOnRefusalCopy("rsvp_add_ons_unavailable"), "Add-ons open once your spot is confirmed.");
  assertEquals(
    rsvpAddOnRefusalCopy("extra_capacity_exceeded"),
    "One of your add-ons just sold out. Pick fewer to continue.",
  );
  assertEquals(
    rsvpAddOnRefusalCopy("extra_quantity_above_max"),
    "You've picked more of an add-on than your party allows.",
  );
  assertEquals(
    rsvpAddOnRefusalCopy("extra_not_available"),
    "One of your add-ons is no longer on sale. Remove it to continue.",
  );
  assertEquals(
    rsvpAddOnRefusalCopy("rsvp_add_on_needs_payment"),
    "One of your add-ons is no longer on sale. Remove it to continue.",
  );
  assertEquals(
    rsvpAddOnRefusalCopy("rsvp_add_ons_invalid"),
    "We couldn't read your add-ons. Change them and try again.",
  );
  assertEquals(rsvpAddOnRefusalCopy("rsvp_full"), null);
});

Deno.test("#3281 S6 the body's one refusal line: a guest refusal first, else an add-on one", () => {
  assertEquals(rsvpRefusalLine("rsvp_guest_own_number"), "That's you. Enter a friend's number.");
  assertEquals(
    rsvpRefusalLine("extra_capacity_exceeded"),
    "One of your add-ons just sold out. Pick fewer to continue.",
  );
  assertEquals(rsvpRefusalLine("rsvp_full"), null);
});

Deno.test("#3281 S6 setting a pick keeps one entry per add-on; zero removes it", () => {
  const one = withRsvpAddOnQuantity([], "b", 1);
  const two = withRsvpAddOnQuantity(one, "a", 2);
  assertEquals(two, [{ addOnId: "a", quantity: 2 }, { addOnId: "b", quantity: 1 }]);
  assertEquals(withRsvpAddOnQuantity(two, "a", 3), [{ addOnId: "a", quantity: 3 }, { addOnId: "b", quantity: 1 }]);
  assertEquals(withRsvpAddOnQuantity(two, "a", 0), [{ addOnId: "b", quantity: 1 }]);
});
