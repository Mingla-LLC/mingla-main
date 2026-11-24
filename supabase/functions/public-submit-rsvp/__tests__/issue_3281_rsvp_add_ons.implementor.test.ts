// MINGLA-INVARIANT: I-ADDON-RSVP-EDGE-ADDITIVE | issue #3281 | public-submit-rsvp sends today's submit_event_rsvp_with_form call unchanged unless the request carries a non-empty rsvpAddOns list, and then calls issue_3281_submit_rsvp_with_add_ons with the same arguments plus p_add_ons and the same client header.
// MINGLA-INVARIANT: I-ADDON-RSVP-SAVED-WHEN-ADDONS-OFF | issue #3281 | An RSVP sent with rsvpAddOns while RSVP add-ons are unavailable (switch off, not offered, or no wrapper) is still saved with its form answers through the plain submit_event_rsvp_with_form call; the add-ons are ignored and the reply carries rsvpAddOnsIgnored: true. Other add-on refusals still refuse the RSVP.
/**
 * #3281 S6 — free add-ons on an RSVP, at the edge.
 * FAILS-ON-REVERT: drop the empty-list shortcut, accept a duplicate or a
 * fraction, call the wrapper without the #4541 arguments, or replace the
 * request allow-list -> red.
 */
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  parseRsvpAddOns,
  RSVP_ADD_ONS_RPC,
  rsvpAddOnRefusal,
  rsvpAddOnsUnavailable,
} from "../rsvpAddOns.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

Deno.test("#3281 S6 no add-ons asked for means today's RSVP call", () => {
  assertEquals(parseRsvpAddOns(undefined), { ok: true, addOns: null });
  assertEquals(parseRsvpAddOns(null), { ok: true, addOns: null });
  assertEquals(parseRsvpAddOns([]), { ok: true, addOns: null });
});

Deno.test("#3281 S6 the list is closed-shape: uuid, whole quantity, once each", () => {
  assertEquals(parseRsvpAddOns([{ addOnId: A, quantity: 2 }, { addOnId: B, quantity: 1 }]), {
    ok: true,
    addOns: [{ addOnId: A, quantity: 2 }, { addOnId: B, quantity: 1 }],
  });
  for (
    const bad of [
      "x",
      {},
      [{ addOnId: "nope", quantity: 1 }],
      [{ addOnId: A, quantity: 0 }],
      [{ addOnId: A, quantity: 1.5 }],
      [{ addOnId: A, quantity: "1" }],
      [{ addOnId: A, quantity: 401 }],
      [{ addOnId: A, quantity: 1, priceCents: 0 }],
      [{ addOnId: A, quantity: 1 }, { addOnId: A.toUpperCase(), quantity: 1 }],
      Array.from({ length: 41 }, () => ({ addOnId: A, quantity: 1 })),
    ]
  ) {
    const parsed = parseRsvpAddOns(bad);
    assert(!parsed.ok, JSON.stringify(bad));
    assertEquals(parsed, { ok: false, status: 400, body: { error: "rsvp_add_ons_invalid" } });
  }
});

Deno.test("#3281 S6 database refusals map to the RSVP form's codes", () => {
  assertEquals(rsvpAddOnRefusal({ message: "rsvp_add_ons_unavailable" }), {
    status: 409,
    body: { error: "rsvp_add_ons_unavailable" },
  });
  assertEquals(rsvpAddOnRefusal({ message: "extra_capacity_exceeded" })?.status, 409);
  assertEquals(rsvpAddOnRefusal({ message: "extra_quantity_above_max" })?.status, 400);
  assertEquals(rsvpAddOnRefusal({ message: "rsvp_add_on_needs_payment" })?.status, 409);
  assertEquals(rsvpAddOnRefusal({ message: "rsvp_full" }), null);
  assertEquals(rsvpAddOnRefusal(null), null);
});

Deno.test("#3281 S6 the handler keeps the #4541 call and adds the wrapper only with add-ons", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assertEquals(RSVP_ADD_ONS_RPC, "issue_3281_submit_rsvp_with_add_ons");
  // The allow-list keeps every #4541 field and gains rsvpAddOns.
  for (const key of ["brandFormStep", "brandForm", "rsvpAddOns", "guests", "ad_context"]) {
    assert(src.includes(`"${key}",`), key);
  }
  // Without add-ons: today's call, byte for byte, still with the client header.
  const plain = src.indexOf('? await admin.rpc("submit_event_rsvp_with_form", rsvpArgs)');
  assert(plain > 0);
  assert(src.slice(plain, plain + 160).includes('.setHeader("x-mingla-rsvp-client", inviterClient)'));
  // With add-ons: the wrapper, the same arguments plus p_add_ons, the same header.
  const wrapped = src.indexOf(": await admin.rpc(RSVP_ADD_ONS_RPC, { ...rsvpArgs, p_add_ons: parsedAddOns.addOns })");
  assert(wrapped > plain);
  assert(src.slice(wrapped, wrapped + 200).includes('.setHeader("x-mingla-rsvp-client", inviterClient)'));
  assert(src.includes("p_form: parsedBrandForm.form,\n  };"));
  // #3281 (T3-10): the only second plain call is the add-ons-unavailable fallback.
  assertEquals(src.split("submit_event_rsvp_with_form").length - 1, 2);
});

Deno.test("#3281 T3-10 only 'unavailable' falls back to saving the RSVP without add-ons", () => {
  assert(rsvpAddOnsUnavailable({ message: "rsvp_add_ons_unavailable" }));
  assert(rsvpAddOnsUnavailable({ code: "PGRST202", message: "Could not find the function" }));
  assert(rsvpAddOnsUnavailable({ code: "42883", message: "function does not exist" }));
  for (const code of ["rsvp_add_on_needs_payment", "extra_capacity_exceeded", "extra_not_available", "rsvp_full"]) {
    assert(!rsvpAddOnsUnavailable({ message: code }), code);
  }
  assert(!rsvpAddOnsUnavailable(null));
});

Deno.test("#3281 T3-10 the handler re-submits the same RSVP plainly and says the add-ons were ignored", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const fallback = src.indexOf("if (error !== null && parsedAddOns.addOns !== null && rsvpAddOnsUnavailable(error)) {");
  assert(fallback > 0);
  const block = src.slice(fallback, fallback + 320);
  assert(block.includes("rsvpAddOnsIgnored = true;"));
  assert(block.includes('await admin.rpc("submit_event_rsvp_with_form", rsvpArgs)'));
  assert(block.includes('.setHeader("x-mingla-rsvp-client", inviterClient)'));
  // the fallback's own error is never re-mapped as an add-on refusal
  assert(src.includes("parsedAddOns.addOns === null || rsvpAddOnsIgnored ? null : rsvpAddOnRefusal(error)"));
  // additive optional reply field, absent unless ignored (add-ons-off replies unchanged)
  assert(src.includes("...(rsvpAddOnsIgnored ? { rsvpAddOnsIgnored: true } : {}),"));
});
