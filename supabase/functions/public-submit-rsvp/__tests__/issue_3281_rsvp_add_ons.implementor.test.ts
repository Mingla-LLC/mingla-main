// MINGLA-INVARIANT: I-ADDON-RSVP-EDGE-ADDITIVE | issue #3281 | public-submit-rsvp sends today's submit_event_rsvp_with_form call unchanged unless the request carries a non-empty rsvpAddOns list, and then calls issue_3281_submit_rsvp_with_add_ons with the same arguments plus p_add_ons and the same client header.
/**
 * #3281 S6 — free add-ons on an RSVP, at the edge.
 * FAILS-ON-REVERT: drop the empty-list shortcut, accept a duplicate or a
 * fraction, call the wrapper without the #4541 arguments, or replace the
 * request allow-list -> red.
 */
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { parseRsvpAddOns, RSVP_ADD_ONS_RPC, rsvpAddOnRefusal } from "../rsvpAddOns.ts";

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
  assertEquals(src.split("submit_event_rsvp_with_form").length - 1, 1);
});
