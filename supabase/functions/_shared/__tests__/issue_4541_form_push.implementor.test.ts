// #4541 wave 4 (T-23 push): form requests by push behind the database switch,
// a payload app 1.3.0 opens as its purchase or pass page, the email alongside
// the push during the rollout, and a lock screen that carries nothing sensitive.
// MINGLA-INVARIANT: I-4541-FORM-PUSH-SWITCHED-AND-SAFE | issue #4541 | a form request push is sent only when BRAND_FORMS_PUSH is on and the claim put push on the route; its deep link is built from ids only; its title and body carry no link, token, address or contact; while BRAND_FORMS_PUSH_EMAIL_ALONGSIDE is on a delivered push is followed by the email, never a text (this suite).
//
// FAILS-ON-REVERT: ignoring settings.push in sendClaimed fails T-OFF; dropping the
// email-alongside branch fails T-ALONGSIDE; dropping the deep_link fails T-LINK;
// rendering the push with the email wording (a link) fails T-LOCK.
import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  drainFormRequests,
  type FormRequestDeps,
  parseClaimed,
  sendClaimed,
} from "../brandFormRequests.ts";
import {
  brandFormDeepLinkValid,
  brandFormRequestPushDeepLink,
  renderBrandFormMessage,
} from "../brandFormNotify.ts";
import { providerSafePayload } from "../notifyV2.ts";
import type {
  FormDispatchInput,
  FormDispatchResult,
} from "../brandFormDispatchTypes.ts";

const FORM = "45410000-0000-4000-8000-0000000004f1";
const EVENT = "45410000-0000-4000-8000-0000000004e1";
const ORDER = "45410000-0000-4000-8000-0000000004a1";
const RSVP = "45410000-0000-4000-8000-0000000004b1";
const GUEST = "45410000-0000-4000-8000-0000000004c1";
const USER = "45410000-0000-4000-8000-0000000004d1";
const SEND = "45410000-0000-4000-8000-000000000401";

const row = (over: Record<string, unknown> = {}) => ({
  sendId: SEND,
  token: "a".repeat(64),
  formId: FORM,
  eventId: EVENT,
  kind: "ask",
  subjectKind: "order",
  subjectId: ORDER,
  userId: USER,
  route: ["push", "sms", "email"],
  phone: "+12025550188",
  email: "guest@example.test",
  brandName: "Lagos Supper",
  eventTitle: "Supper Club",
  eventTimezone: "UTC",
  startsAt: "2028-12-01T20:00:00Z",
  ...over,
});

function deps(deliver: (i: FormDispatchInput) => boolean = () => true) {
  const sent: FormDispatchInput[] = [];
  const settles: Record<string, unknown>[] = [];
  const d: FormRequestDeps = {
    rpc: (fn, args) => {
      if (fn === "brand_form_request_settle") settles.push(args);
      return Promise.resolve({ data: true, error: null });
    },
    dispatch: (input) => {
      sent.push(input);
      const channel = input.requested_channel === "push"
        ? "push"
        : input.contact?.startsWith("+")
        ? "sms"
        : "email";
      const ok = deliver(input);
      return Promise.resolve<FormDispatchResult>({
        success: true,
        deliveries: [{ channel, status: ok ? "sent" : "failed", providerMessageId: null }],
      });
    },
  };
  return { d, sent, settles };
}

const claim = (over: Record<string, unknown> = {}) => {
  const c = parseClaimed(row(over));
  if (c === null) throw new Error("claim did not parse");
  return c;
};

Deno.test("T-PARSE a claimed route keeps push only first; the contact route after it", () => {
  assertEquals(claim().route, ["push", "sms", "email"]);
  assertEquals(claim({ route: ["sms", "push", "email"] }).route, ["sms", "email"]);
  assertEquals(claim({ kind: "remind" }).kind, "remind");
});

Deno.test("T-OFF SC-26 with BRAND_FORMS_PUSH off no form push is sent, even if the claim put push first", async () => {
  const h = deps();
  await sendClaimed(h.d, claim(), { push: false, emailAlongside: true });
  assert(h.sent.every((s) => s.requested_channel !== "push"));
  assertEquals(h.sent[0].contact, "+12025550188");
  assertEquals(h.settles[0].p_channel, "sms");
});

Deno.test("T-ALONGSIDE SC-28 a delivered push is followed by the email, never a text", async () => {
  const h = deps();
  assert(await sendClaimed(h.d, claim(), { push: true, emailAlongside: true }));
  assertEquals(h.sent.map((s) => s.requested_channel ?? (s.contact?.startsWith("+") ? "sms" : "email")), [
    "push",
    "email",
  ]);
  assertEquals(h.sent[1].contact, "guest@example.test");
  assertEquals(h.sent[1].payload.form_url, `https://host.usemingla.com/form/${FORM}#t=${"a".repeat(64)}`);
  assertEquals(h.settles[0], {
    p_send_id: SEND,
    p_channel: "push",
    p_status: "sent",
    p_reason: "push_and_email",
  });
});

Deno.test("T-PUSH-ONLY SC-28 with email alongside off: push only", async () => {
  const h = deps();
  await sendClaimed(h.d, claim(), { push: true, emailAlongside: false });
  assertEquals(h.sent.length, 1);
  assertEquals(h.sent[0].requested_channel, "push");
  assertEquals(h.settles[0].p_reason, null);
});

Deno.test("T-FALLBACK a push that does not deliver continues as today: text, then email", async () => {
  const h = deps((i) => i.requested_channel !== "push");
  await sendClaimed(h.d, claim(), { push: true, emailAlongside: true });
  assertEquals(h.sent.length, 2);
  assertEquals(h.sent[1].contact, "+12025550188");
  assertEquals(h.settles[0].p_channel, "sms");
});

Deno.test("T-LINK SC-27 the push opens what app 1.3.0 understands: the purchase page with the form named", async () => {
  const h = deps();
  await sendClaimed(h.d, claim(), { push: true, emailAlongside: false });
  const push = h.sent[0];
  assertEquals(push.deep_link, `mingla://purchases/order/${ORDER}?form=${FORM}&event=${EVENT}`);
  assertEquals(push.user_id, USER);
  assertFalse("form_url" in push.payload, "the push payload never carries the personal link");
  assert(brandFormDeepLinkValid("brand_form_request", push.deep_link, push.payload));
  assertEquals(
    brandFormRequestPushDeepLink({ formId: FORM, eventId: EVENT, subjectKind: "rsvp", subjectId: RSVP }),
    `mingla://purchases/rsvp/${RSVP}?form=${FORM}&event=${EVENT}`,
  );
  assertEquals(
    brandFormRequestPushDeepLink({ formId: FORM, eventId: EVENT, subjectKind: "rsvp_guest", subjectId: GUEST }),
    `mingla://form/${FORM}?event=${EVENT}&as=rsvp_guest&sid=${GUEST}&from=push`,
  );
  // Only the link the payload's own ids build is accepted.
  assertFalse(brandFormDeepLinkValid("brand_form_request", "mingla://purchases/order/x", push.payload));
  assertFalse(
    brandFormDeepLinkValid("brand_form_request", push.deep_link, { ...push.payload, order_id: RSVP }),
  );
  assert(brandFormDeepLinkValid("brand_form_request", null, push.payload));
});

Deno.test("T-LOCK SC-29 the lock screen: title and body per R3.6, no link, token, address or contact", () => {
  const payload = {
    form_id: FORM,
    event_id: EVENT,
    order_id: ORDER,
    brand_name: "A very long brand name that goes on and on @lagos https://x.example",
    event_title: "Supper Club t=abcdef",
    event_date: "2028-12-01T20:00:00Z",
    event_timezone: "UTC",
    form_url: `https://host.usemingla.com/form/${FORM}#t=${"a".repeat(64)}`,
    request_kind: "ask",
  };
  const ask = renderBrandFormMessage("brand_form_request", payload).push;
  const remind = renderBrandFormMessage("brand_form_request", { ...payload, request_kind: "auto" }).push;
  for (const p of [ask, remind]) {
    for (const text of [p.title, p.body]) {
      assertFalse(/t=|http|@/i.test(text), text);
    }
  }
  // Cut to 40 characters with "…".
  assertEquals(ask.title, "Questions from A very long brand name that goes on and…");
  assert(ask.body.endsWith(" about Supper Club on Fri 1 Dec. Tap to answer."), ask.body);
  assertEquals(remind.body, "Still to answer: a few questions about Supper Club on Fri 1 Dec.");
  // Ids only reach the push provider.
  const safe = providerSafePayload("brand_form_request", { ...payload, rsvp_guest_id: GUEST });
  assertEquals(Object.keys(safe).sort(), ["event_id", "form_id", "order_id", "rsvp_guest_id"]);
});

Deno.test("T-DRAIN the drain reads the push switches once per run", async () => {
  const calls: string[] = [];
  let page = 0;
  const d: FormRequestDeps = {
    rpc: (fn) => {
      calls.push(fn);
      if (fn === "brand_forms_switched_off") return Promise.resolve({ data: false, error: null });
      if (fn === "brand_form_push_settings") {
        return Promise.resolve({ data: { push: true, emailAlongside: false }, error: null });
      }
      if (fn === "brand_form_request_claim_batch") {
        page += 1;
        return Promise.resolve({ data: page === 1 ? [row(), row({ sendId: "45410000-0000-4000-8000-000000000402" })] : [], error: null });
      }
      return Promise.resolve({ data: true, error: null });
    },
    dispatch: () =>
      Promise.resolve({ success: true, deliveries: [{ channel: "push", status: "sent", providerMessageId: null }] }),
  };
  const out = await drainFormRequests(d, { budgetMs: 10_000 });
  assertEquals(out.sent, 2);
  assertEquals(calls.filter((f) => f === "brand_form_push_settings").length, 1);
});

Deno.test("T-UNREADABLE an unreadable switch never turns push on", async () => {
  const sent: FormDispatchInput[] = [];
  let page = 0;
  const d: FormRequestDeps = {
    rpc: (fn) => {
      if (fn === "brand_forms_switched_off") return Promise.resolve({ data: false, error: null });
      if (fn === "brand_form_push_settings") return Promise.resolve({ data: null, error: { message: "down" } });
      if (fn === "brand_form_request_claim_batch") {
        page += 1;
        return Promise.resolve({ data: page === 1 ? [row()] : [], error: null });
      }
      return Promise.resolve({ data: true, error: null });
    },
    dispatch: (i) => {
      sent.push(i);
      return Promise.resolve({ success: true, deliveries: [{ channel: "sms", status: "sent", providerMessageId: null }] });
    },
  };
  const err = console.error;
  console.error = () => {};
  try {
    await drainFormRequests(d, { budgetMs: 10_000 });
  } finally {
    console.error = err;
  }
  assert(sent.every((s) => s.requested_channel !== "push"));
});
