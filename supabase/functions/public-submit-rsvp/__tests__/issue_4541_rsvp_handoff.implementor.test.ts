// #4541 R1.3 (SC-4, edge): the after-RSVP hand-off in public-submit-rsvp.
// The SQL decision (after_purchase mode, current RSVP, answered, 10 a day) is
// proved by the M-A pg17 suite (T-RH); this proves the edge: who is asked, the
// response field, and that the hand-off never fails the RSVP.
// MINGLA-INVARIANT: I-4541-RSVP-HANDOFF-NEVER-FAILS-RSVP | issue #4541 | public-submit-rsvp asks for the after-RSVP form link only for an approved Going or Maybe RSVP, in its own call after the RSVP committed, and any failure yields brandFormHandoff null, never an RSVP error.
//
// FAILS-ON-REVERT: dropping the brandFormHandoff field from the 200 body fails T-FIELD;
// letting an error escape fails T-NEVER-FAILS; asking for pending RSVPs fails T-WHO.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { rsvpBrandFormHandoff } from "../brandFormRsvp.ts";

const RSVP = "45410000-0000-4000-8000-0000000003a1";
const EVENT = "45410000-0000-4000-8000-0000000003e1";
const FORM = "45410000-0000-4000-8000-0000000003f1";
const TOKEN = "f".repeat(64);

function admin(reply: () => Promise<{ data: unknown; error: { message: string } | null }>) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return reply();
    },
  };
}

Deno.test("T-WHO only an approved Going or Maybe RSVP is asked for a hand-off", async () => {
  for (
    const [status, approvalStatus, asked] of [
      ["going", "approved", true],
      ["maybe", "approved", true],
      ["going", "pending", false],
      ["maybe", "pending", false],
      ["waitlisted", "approved", false],
      ["not_going", "approved", false],
    ] as const
  ) {
    const a = admin(() => Promise.resolve({ data: { outcome: "none" }, error: null }));
    await rsvpBrandFormHandoff(a, { rsvpId: RSVP, eventId: EVENT, status, approvalStatus });
    assertEquals(a.calls.length, asked ? 1 : 0, `${status}/${approvalStatus}`);
    if (asked) {
      assertEquals(a.calls[0], {
        fn: "brand_form_rsvp_handoff_link",
        args: { p_rsvp_id: RSVP, p_event_id: EVENT },
      });
    }
  }
  const a = admin(() => Promise.resolve({ data: null, error: null }));
  assertEquals(await rsvpBrandFormHandoff(a, { rsvpId: null, eventId: EVENT, status: "going", approvalStatus: "approved" }), null);
  assertEquals(a.calls.length, 0);
});

Deno.test("T-LINK a link outcome becomes {formId, token}; every other outcome is null", async () => {
  const link = admin(() => Promise.resolve({ data: { outcome: "link", formId: FORM, token: TOKEN }, error: null }));
  assertEquals(
    await rsvpBrandFormHandoff(link, { rsvpId: RSVP, eventId: EVENT, status: "going", approvalStatus: "approved" }),
    { formId: FORM, token: TOKEN },
  );
  for (const data of [{ outcome: "answered", formId: FORM }, { outcome: "none" }, { outcome: "link", formId: FORM, token: "short" }, null]) {
    const a = admin(() => Promise.resolve({ data, error: null }));
    assertEquals(await rsvpBrandFormHandoff(a, { rsvpId: RSVP, eventId: EVENT, status: "maybe", approvalStatus: "approved" }), null);
  }
});

Deno.test("T-NEVER-FAILS a database error or a throw is logged and the hand-off is null", async () => {
  const logs: string[] = [];
  const failing = admin(() => Promise.resolve({ data: null, error: { message: "rate_limited" } }));
  assertEquals(
    await rsvpBrandFormHandoff(failing, { rsvpId: RSVP, eventId: EVENT, status: "going", approvalStatus: "approved" }, (l) => logs.push(l)),
    null,
  );
  const throwing = admin(() => Promise.reject(new Error("network")));
  assertEquals(
    await rsvpBrandFormHandoff(throwing, { rsvpId: RSVP, eventId: EVENT, status: "going", approvalStatus: "approved" }, (l) => logs.push(l)),
    null,
  );
  assertEquals(logs, ["[public-submit-rsvp] handoff_skipped", "[public-submit-rsvp] handoff_skipped"]);
});

Deno.test("T-FIELD the RSVP's 200 body carries brandFormHandoff, after the RSVP write", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const write = src.indexOf('admin.rpc("submit_event_rsvp_with_form"');
  const field = src.indexOf("brandFormHandoff: await rsvpBrandFormHandoff(admin, {");
  const body = src.indexOf("return json(200, {");
  assert(write > 0 && field > 0 && body > 0, "the RSVP write, the 200 body and the field exist");
  assert(write < body && body < field, "the hand-off is asked inside the 200 body, after the RSVP write");
});
