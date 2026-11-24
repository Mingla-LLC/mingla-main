// MINGLA-INVARIANT: I-ADDON-BUYER-WORD | issue #3281 | Every buyer-facing checkout refusal about add-ons says "add-on(s)", never "extra(s)", in the #3281 spec section 7 wording.
/**
 * issue #3281 S7 (checkpoint 16) — the buyer copy for the server's add-on
 * refusals (ticketExtrasRefusal, read by the Host web / buyer web and Explorer
 * carts) and the cart picker's heading say "Add-ons". Codes are unchanged.
 *
 * FAILS-ON-REVERT: put any "extra(s)" wording back in ticketExtrasRefusal.ts
 * or the TicketExtrasPicker heading -> red.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { extrasRefusalCopy } from "../ticketExtrasRefusal.ts";

const SPEC: Record<string, string> = {
  extras_invalid: "We couldn't read your add-ons. Change them and try again.",
  extra_not_available: "One of your add-ons is no longer on sale. Remove it to continue.",
  extra_quantity_above_max: "You've picked more of an add-on than your tickets allow.",
  extra_not_on_chosen_days: "One of your add-ons isn't on the dates you picked.",
  extra_capacity_exceeded: "One of your add-ons just sold out. Pick fewer to continue.",
  extras_need_paid_ticket: "Paid add-ons need a paid ticket.",
  extras_not_on_installments: "Add-ons are paid in full, so they can't go on a payment plan.",
};

Deno.test("#3281 S7 each add-on refusal reads in the spec's words", () => {
  for (const code of Object.keys(SPEC)) assertEquals(extrasRefusalCopy(code), SPEC[code]);
});

Deno.test("#3281 S7 no buyer refusal or picker heading says extra", async () => {
  for (const code of Object.keys(SPEC)) {
    assertEquals(/\bextras?\b/i.test(extrasRefusalCopy(code) ?? ""), false, code);
  }
  const picker = await Deno.readTextFile(new URL("../TicketExtrasPicker.tsx", import.meta.url));
  const heading = picker.match(/styles\.heading[^>]*>\s*([^<]+?)\s*</);
  assertEquals(heading?.[1], "Add-ons");
});
