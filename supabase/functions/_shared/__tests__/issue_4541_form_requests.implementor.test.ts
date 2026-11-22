// #4541 wave 1 (T-23 part): form requests to claimed plus-ones send (R1.15,
// SC-16) and the off switch stops the drain (R1.8, SC-11 edge).
// MINGLA-INVARIANT: I-4541-PLUS-ONE-REQUESTS-SEND | issue #4541 | an rsvp_guest audience row and claimed request parse and send with rsvp_guest_id in the payload; the drain reads the forms off switch once per run and, when it is on, claims and sends nothing (T-GUEST, T-SWITCH).
//
// FAILS-ON-REVERT: dropping rsvp_guest from the subject kinds fails T-GUEST; dropping the
// switch read in drainFormRequests fails T-SWITCH.
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  drainFormRequests,
  type FormRequestDeps,
  parseAudience,
  parseClaimed,
} from "../brandFormRequests.ts";
import type {
  FormDispatchInput,
  FormDispatchResult,
} from "../brandFormDispatchTypes.ts";

const FORM = "45410000-0000-4000-8000-0000000002f1";
const EVENT = "45410000-0000-4000-8000-0000000002e1";
const BRAND = "45410000-0000-4000-8000-0000000002b1";
const GUEST = "45410000-0000-4000-8000-0000000002a1";
const SEND = "45410000-0000-4000-8000-0000000002c1";

const claimed = {
  sendId: SEND,
  token: "c".repeat(64),
  formId: FORM,
  eventId: EVENT,
  kind: "ask",
  subjectKind: "rsvp_guest",
  subjectId: GUEST,
  userId: "45410000-0000-4000-8000-0000000002d1",
  route: ["email"],
  phone: null,
  email: "guest@example.test",
  brandName: "Brand",
  eventTitle: "Night",
  eventTimezone: "UTC",
  startsAt: "2028-12-01T20:00:00Z",
};

function deps(opts: { off?: unknown; offError?: boolean; pages?: unknown[][] } = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const sent: FormDispatchInput[] = [];
  const pages = [...(opts.pages ?? [[claimed], []])];
  const d: FormRequestDeps = {
    rpc: (fn, args) => {
      calls.push({ fn, args });
      if (fn === "brand_forms_switched_off") {
        return Promise.resolve(
          opts.offError
            ? { data: null, error: { message: "down" } }
            : { data: opts.off ?? false, error: null },
        );
      }
      if (fn === "brand_form_request_claim_batch") {
        return Promise.resolve({ data: pages.shift() ?? [], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    dispatch: (input) => {
      sent.push(input);
      return Promise.resolve({
        success: true,
        deliveries: [{ channel: "email", status: "sent", providerMessageId: null }],
      } as FormDispatchResult);
    },
  };
  return { d, calls, sent };
}

Deno.test("T-GUEST SC-16 a claimed plus-one row parses in the audience and in the claim", () => {
  const aud = parseAudience({
    formId: FORM,
    eventId: EVENT,
    brandId: BRAND,
    recipients: [{ kind: "rsvp_guest", id: GUEST, personKey: "user:x", route: ["email"], email: "guest@example.test" }],
  });
  assertEquals(aud.recipients[0].kind, "rsvp_guest");
  const c = parseClaimed(claimed);
  assert(c !== null);
  assertEquals(c.subjectKind, "rsvp_guest");
  assertEquals(parseClaimed({ ...claimed, subjectKind: "user" }), null);
});

Deno.test("T-GUEST SC-16 a plus-one request is sent with rsvp_guest_id and settles sent", async () => {
  const { d, calls, sent } = deps();
  const out = await drainFormRequests(d, { budgetMs: 10_000 });
  assertEquals(out.sent, 1);
  assertEquals(out.failed, 0);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].payload.rsvp_guest_id, GUEST);
  assert(!("rsvp_id" in sent[0].payload) && !("order_id" in sent[0].payload));
  const settle = calls.find((c) => c.fn === "brand_form_request_settle");
  assertEquals(settle?.args, { p_send_id: SEND, p_channel: "email", p_status: "sent", p_reason: null });
});

Deno.test("T-SWITCH SC-11 with the off switch on, the drain claims and sends nothing", async () => {
  const { d, calls, sent } = deps({ off: true });
  const out = await drainFormRequests(d, { budgetMs: 10_000 });
  assertEquals(out, { pages: 0, sent: 0, failed: 0, more: false, paused: true });
  assertEquals(calls.map((c) => c.fn), ["brand_forms_switched_off"]);
  assertEquals(sent.length, 0);
});

Deno.test("T-SWITCH the switch is read once per run; a read error stops the drain loudly", async () => {
  const { d, calls } = deps({ pages: [[claimed], [claimed], []] });
  await drainFormRequests(d, { budgetMs: 10_000 });
  assertEquals(calls.filter((c) => c.fn === "brand_forms_switched_off").length, 1);
  const broken = deps({ offError: true });
  await assertRejects(() => drainFormRequests(broken.d, { budgetMs: 10_000 }), Error, "brand_forms_switched_off");
  assertEquals(broken.sent.length, 0);
});
