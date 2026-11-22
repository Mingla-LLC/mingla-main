// MINGLA-INVARIANT: I-ADDON-RSVP-DOOR-OWN-FIELD | issue #3281 | scan-rsvp returns an admitted RSVP's add-ons as a separate top-level addOns field read after admission, never inside doorAnswers, and adds nothing when there are none or the read fails.
/**
 * #3281 S6 — the RSVP door line.
 * FAILS-ON-REVERT: keep an empty list, let a failed read throw, nest the
 * add-ons inside doorAnswers, or read them for a plus-one scan -> red.
 */
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { type DoorAddOnsClient, parseDoorAddOns, readRsvpDoorAddOns } from "../doorAddOns.ts";

const RSVP = "33333333-3333-4333-8333-333333333333";

const client = (
  answer: { data: unknown; error: { message: string } | null } | Error,
  calls: Array<{ fn: string; args: Record<string, unknown> }> = [],
): DoorAddOnsClient => ({
  rpc(fn, args) {
    calls.push({ fn, args });
    return {
      abortSignal: (_signal: AbortSignal) =>
        answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
    };
  },
});

Deno.test("#3281 S6 door line: name and quantity per add-on, nothing when empty", () => {
  assertEquals(parseDoorAddOns([{ id: "x", name: "Snack box", quantity: 2 }]), [
    { name: "Snack box", quantity: 2 },
  ]);
  assertEquals(parseDoorAddOns([]), null);
  assertEquals(parseDoorAddOns(null), null);
  assertEquals(parseDoorAddOns([{ name: "", quantity: 1 }, { name: "Tee", quantity: 0 }]), null);
});

Deno.test("#3281 S6 door read calls the service function for the RSVP", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const lines = await readRsvpDoorAddOns(
    client({ data: [{ name: "Tee", quantity: 1 }], error: null }, calls),
    RSVP,
  );
  assertEquals(lines, [{ name: "Tee", quantity: 1 }]);
  assertEquals(calls, [{ fn: "issue_3281_rsvp_door_add_ons", args: { p_rsvp_id: RSVP } }]);
});

Deno.test("#3281 S6 a failed or aborted door read adds nothing and never throws", async () => {
  assertEquals(await readRsvpDoorAddOns(client({ data: null, error: { message: "boom" } }), RSVP), null);
  assertEquals(await readRsvpDoorAddOns(client(new DOMException("late", "AbortError")), RSVP), null);
});

Deno.test("#3281 S6 scan-rsvp adds the line after admission, as its own field, for the RSVP holder", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const at = src.indexOf("readRsvpDoorAddOns(service");
  assert(at > src.indexOf('caller.rpc("biz_rsvp_scan"'), "read after admission");
  assert(src.includes('if (subject?.kind === "rsvp" && serviceKey) {'));
  assert(src.includes("if (addOns !== null) result = { ...result, addOns };"));
  assert(!src.includes("doorAnswers: { ...doorAnswers, addOns"));
});
