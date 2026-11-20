// #4514 wave 4 — Ask guests to answer and Remind (guest-roster-actions form ops).
//
// Pins: Remind reaches only people who have not answered; push carries no link
// and texts and emails carry the guest's own form link; a request calls only the
// form-request SQL (decision 17: never an invite RPC, never the offering
// dispatcher); a throttled guest is skipped; a grown cost is refused; channel
// choice follows the guest's contact on file.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleFormRequest, isFormRequestBody } from "./formRequest.ts";
import {
  type FormRequestRecipient,
  previewFormRequest,
  routeFor,
} from "../_shared/brandFormRequests.ts";
import type { DispatchV2Input } from "../_shared/notifyV2.ts";
import { renderCategoryMessage } from "../_shared/notifyTemplates.ts";
import { providerSafePayload } from "../_shared/notifyV2.ts";

const FORM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BRAND = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ACTOR = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const id = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;

const guest = (n: number, over: Partial<FormRequestRecipient> = {}): FormRequestRecipient => ({
  kind: "rsvp", id: id(n), userId: null, email: null, phone: null, answered: false, throttled: false,
  smsAllowed: true, emailAllowed: true, ...over,
});

function harness(recipients: FormRequestRecipient[], claim: (subjectId: string) => Record<string, unknown>) {
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const sent: DispatchV2Input[] = [];
  return {
    rpcs, sent,
    deps: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        rpcs.push({ fn, args });
        if (fn === "brand_form_request_audience") {
          return Promise.resolve({ data: { formId: FORM, eventId: EVENT, brandId: BRAND, formName: "Sign-up",
            eventTitle: "Open mic", brandName: "Brand A", recipients }, error: null });
        }
        if (fn === "brand_form_request_claim") {
          return Promise.resolve({ data: claim((args.p_subject as { id: string }).id), error: null });
        }
        return Promise.resolve({ data: true, error: null });
      },
      dispatch: (input: DispatchV2Input) => {
        sent.push(input);
        const channel = input.requested_channel ?? (input.contact?.includes("@") ? "email" : "sms");
        return Promise.resolve({ success: true, deliveries: [{ channel, status: "sent", providerMessageId: "m" }] });
      },
      smsRates: () => Promise.resolve(null),
    },
  };
}

const body = (over: Record<string, unknown> = {}) => ({
  operation: "form_send", eventId: EVENT, formId: FORM, kind: "ask", audience: "unanswered",
  channels: ["email", "push", "sms"], expectedCostMinor: null, currency: null, ...over,
});

Deno.test("#4514 body: Remind must target people who have not answered; unknown keys refused", () => {
  assert(isFormRequestBody(body()));
  assert(isFormRequestBody(body({ kind: "remind" })));
  assertEquals(isFormRequestBody(body({ kind: "remind", audience: "everyone" })), false);
  assertEquals(isFormRequestBody(body({ inviteId: id(1) })), false);
  assertEquals(isFormRequestBody(body({ operation: "form_preview" })), false); // preview carries no cost
  assertEquals(isFormRequestBody({ ...body({ operation: "form_preview" }), expectedCostMinor: undefined, currency: undefined }), true);
});

Deno.test("#4514 route: push first for an account, then the contact on file (phone before email), consent applied", () => {
  const all = ["email", "push", "sms"] as const;
  assertEquals(routeFor(guest(1, { userId: ACTOR, phone: "+12025550101", email: "a@x.test" }), all), ["push", "sms"]);
  assertEquals(routeFor(guest(2, { phone: "+12025550101", email: "a@x.test", smsAllowed: false }), all), ["email"]);
  assertEquals(routeFor(guest(3, { phone: "+12025550101" }), ["email", "push"]), []);
  assertEquals(routeFor(guest(4, { userId: ACTOR }), ["sms"]), []);
});

Deno.test("#4514 preview: reach line counts (reachable, opted out of texts, can't be reached, throttled)", () => {
  const p = previewFormRequest({ formId: FORM, eventId: EVENT, brandId: BRAND, formName: "", eventTitle: "E", brandName: "B",
    recipients: [guest(1, { phone: "+12025550101" }), guest(2, { phone: "+12025550102", smsAllowed: false }),
      guest(3), guest(4, { email: "x@y.test", throttled: true }), guest(5, { userId: ACTOR })] },
    ["email", "push", "sms"], null);
  assertEquals([p.reachableCount, p.smsOptedOutCount, p.unreachableCount, p.throttledCount], [2, 1, 1, 1]);
  assertEquals(p.perChannelReachable, { push: 1, sms: 1, email: 0 });
  assertEquals(p.smsCount, 1);
  assertEquals(p.estimatedCostMinor, null); // no rates: no amount, never a guess
});

Deno.test("#4514 send: decision 17 — only form-request SQL, push without a link, text and email with the guest's own link", async () => {
  const h = harness([
    guest(1, { userId: ACTOR, phone: "+12025550101" }),
    guest(2, { phone: "+12025550102" }),
    guest(3, { email: "g3@example.test" }),
  ], (sid) => ({ claimed: true, sendId: sid, token: sid.slice(7, 8).repeat(64) }));
  const res = await handleFormRequest(body() as never, ACTOR, h.deps);
  assertEquals(res.status, 200);
  assertEquals(res.body.sent, 3);
  const fns = [...new Set(h.rpcs.map((r) => r.fn))].sort();
  assertEquals(fns, ["brand_form_request_audience", "brand_form_request_claim", "brand_form_request_settle"]);
  assert(h.rpcs.every((r) => !/invite|offering|guest_roster/.test(r.fn)));
  const push = h.sent.find((s) => s.requested_channel === "push");
  assertEquals(push?.user_id, ACTOR);
  assertEquals("form_url" in (push?.payload ?? {}), false);
  const sms = h.sent.find((s) => s.contact === "+12025550102");
  assertEquals(sms?.payload.form_url, `https://host.usemingla.com/form/${FORM}#t=${"2".repeat(64)}`);
  assertEquals(sms?.user_id, null);
  const email = h.sent.find((s) => s.contact === "g3@example.test");
  assertEquals(email?.email_cta?.url, `https://host.usemingla.com/form/${FORM}#t=${"3".repeat(64)}`);
  // The link renders into the text, and never reaches the push provider.
  assert(renderCategoryMessage("brand_form_request", sms!.payload).sms.includes(String(sms!.payload.form_url)));
  assertEquals(providerSafePayload("brand_form_request", sms!.payload).form_url, undefined);
});

Deno.test("#4514 send: a guest the server throttles is skipped and nothing is sent to them", async () => {
  const h = harness([guest(1, { email: "a@x.test" }), guest(2, { email: "b@x.test" })],
    (sid) => sid === id(1) ? { claimed: false, reason: "throttled" } : { claimed: true, sendId: sid, token: "b".repeat(64) });
  const res = await handleFormRequest(body() as never, ACTOR, h.deps);
  assertEquals(res.body.sent, 1);
  assertEquals((res.body.skipped as Record<string, number>).throttled, 1);
  assertEquals(h.sent.map((s) => s.contact), ["b@x.test"]);
});

Deno.test("#4514 send: Remind skips anyone who has answered before claiming", async () => {
  const h = harness([guest(1, { email: "a@x.test", answered: true }), guest(2, { email: "b@x.test" })],
    (sid) => ({ claimed: true, sendId: sid, token: "c".repeat(64) }));
  const res = await handleFormRequest(body({ kind: "remind" }) as never, ACTOR, h.deps);
  assertEquals(res.body.sent, 1);
  assertEquals(h.rpcs.filter((r) => r.fn === "brand_form_request_claim").map((r) => (r.args.p_subject as { id: string }).id), [id(2)]);
  assertEquals(h.rpcs.find((r) => r.fn === "brand_form_request_claim")?.args.p_kind, "remind");
});

Deno.test("#4514 send: a cost that grew past the preview is refused before anything is sent", async () => {
  const h = harness([guest(1, { phone: "+12025550101" })], (sid) => ({ claimed: true, sendId: sid, token: "d".repeat(64) }));
  const deps = { ...h.deps, smsRates: () => Promise.resolve([{ rateId: "r", provider: "twilio" as const, country: "US",
    currency: "USD", unit: "sms_segment" as const, minorNumerator: 1, minorDenominator: 1, effectiveAt: "", expiresAt: "",
    sourceReference: "" }]) };
  const res = await handleFormRequest(body({ expectedCostMinor: 0, currency: null }) as never, ACTOR, deps);
  assertEquals([res.status, res.body.code], [409, "preview_stale_cost"]);
  assertEquals(h.sent.length, 0);
  assertEquals(h.rpcs.some((r) => r.fn === "brand_form_request_claim"), false);
});

Deno.test("#4514 send: below event manager the audience read refuses and nothing is sent", async () => {
  const sent: DispatchV2Input[] = [];
  const res = await handleFormRequest(body() as never, ACTOR, {
    rpc: () => Promise.resolve({ data: null, error: { message: "brand_form_forbidden" } }),
    dispatch: (i) => { sent.push(i); return Promise.resolve({ success: true }); },
    smsRates: () => Promise.resolve(null),
  });
  assertEquals([res.status, res.body.code], [403, "forbidden"]);
  assertEquals(sent.length, 0);
});
