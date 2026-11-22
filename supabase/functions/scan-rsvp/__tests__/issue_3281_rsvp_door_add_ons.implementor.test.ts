// MINGLA-INVARIANT: I-ADDON-RSVP-DOOR-OWN-FIELD | issue #3281 | scan-rsvp returns an admitted RSVP holder's add-ons as a separate top-level addOns field taken from the admission reply itself (no extra read at the door), never inside doorAnswers, and adds nothing when there are none.
/**
 * #3281 S6 — the RSVP door line (rework: no extra round trip at the door).
 * biz_rsvp_scan returns the add-ons with the admission; the edge only
 * normalises them. FAILS-ON-REVERT: a second read of the add-ons at the door,
 * a kept empty list, malformed items passed through, the field kept for a
 * plus-one scan, or the add-ons nested inside doorAnswers -> red.
 */
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { parseDoorAddOns, withDoorAddOns } from "../doorAddOns.ts";

Deno.test("#3281 S6 door line: name and quantity per add-on, nothing when empty", () => {
  assertEquals(parseDoorAddOns([{ id: "x", name: "Snack box", quantity: 2 }]), [
    { name: "Snack box", quantity: 2 },
  ]);
  assertEquals(parseDoorAddOns([]), null);
  assertEquals(parseDoorAddOns(null), null);
  assertEquals(parseDoorAddOns([{ name: "", quantity: 1 }, { name: "Tee", quantity: 0 }]), null);
});

Deno.test("#3281 S6 the admission reply's add-ons become the door line", () => {
  const admitted = { result: "success", entityType: "primary", entityId: "r1" };
  assertEquals(
    withDoorAddOns({ ...admitted, addOns: [{ id: "a", name: "Tee", quantity: 1 }] }, true),
    { ...admitted, addOns: [{ name: "Tee", quantity: 1 }] },
  );
  // none, empty or malformed: no field at all (the reply is as before)
  assertEquals(withDoorAddOns(admitted, true), admitted);
  assertEquals(withDoorAddOns({ ...admitted, addOns: [] }, true), admitted);
  assertEquals(withDoorAddOns({ ...admitted, addOns: "x" }, true), admitted);
  // a plus-one scan never shows the holder's add-ons
  assertEquals(withDoorAddOns({ ...admitted, addOns: [{ name: "Tee", quantity: 1 }] }, false), admitted);
});

Deno.test("#3281 S6 scan-rsvp makes no extra read at the door", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(!src.includes("issue_3281_rsvp_door_add_ons"), "no second RPC for the door line");
  assert(!src.includes("readRsvpDoorAddOns"), "no second read helper");
  const at = src.indexOf('withDoorAddOns(result, subject?.kind === "rsvp")');
  assert(at > src.indexOf('caller.rpc("biz_rsvp_scan"'), "normalised after admission");
  assert(at > src.indexOf("if (doorAnswers !== null) result = { ...result, doorAnswers };"), "own field, after doorAnswers");
  assert(!src.includes("doorAnswers: { ...doorAnswers, addOns"));
});
