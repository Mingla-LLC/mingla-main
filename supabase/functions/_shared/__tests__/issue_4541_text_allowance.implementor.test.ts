// #4541 wave 5 (R5.4, R5.5, SC-38 edge): the Ask/Remind preview shares the
// brand's one monthly text allowance and turns texts off for the whole send,
// exactly as brand_form_request_enqueue does, instead of refusing it.
// MINGLA-INVARIANT: I-4541-TEXTS-OFF-NOT-REFUSED | issue #4541 | over the monthly text allowance or the 300-a-day cap the form request preview reports textsOff with the reason and is computed without texts (email and push still go); the send is never refused for a text limit (this suite).
//
// FAILS-ON-REVERT: dropping the monthly branch in previewFormRequest fails T-MONTH;
// dropping the recomputation without texts fails T-REACH.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { previewFormRequest } from "../brandFormRequestPreview.ts";
import type { FormRequestAudience, FormRequestRecipient } from "../brandFormRequests.ts";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const guest = (n: number, over: Partial<FormRequestRecipient> = {}): FormRequestRecipient => ({
  kind: "rsvp",
  id: id(n),
  userId: null,
  personKey: `p:${n}`,
  email: `g${n}@example.test`,
  phone: `+1202555010${n}`,
  answered: false,
  throttled: false,
  route: ["sms", "email"],
  pushOk: false,
  smsOptedOut: false,
  ...over,
});
const audience = (over: Partial<FormRequestAudience> = {}): FormRequestAudience => ({
  formId: id(90),
  eventId: id(91),
  brandId: id(92),
  formName: "Dietary",
  eventTitle: "Supper Club",
  brandName: "Lagos Supper",
  eventStartsAt: null,
  textsToday: 10,
  textCap: 300,
  textsWaitUntil: null,
  pushAvailable: true,
  monthlyTextCap: 100,
  textsLeftThisMonth: 2,
  recipients: [guest(1), guest(2), guest(3, { email: null, route: ["sms"] }), guest(4, { pushOk: true, userId: id(5) })],
  ...over,
});

Deno.test("T-MONTH SC-38 needing 4 texts with 2 left: texts off for the send, the reason and numbers reported", () => {
  const p = previewFormRequest(audience(), ["push", "sms", "email"], null);
  assertEquals(p.textsOff, { reason: "monthly_allowance", needed: 4, remaining: 2 });
  assertEquals([p.textsThisSendUses, p.smsCount, p.estimatedCostMinor], [0, 0, 0]);
  assertEquals([p.monthlyTextCap, p.textsLeftThisMonth, p.textsTodayUsed, p.dailyTextCap], [100, 2, 10, 300]);
  assertEquals(p.pushAvailable, true);
});

Deno.test("T-REACH texts off: email and push still go; a text-only guest cannot be reached", () => {
  const p = previewFormRequest(audience(), ["push", "sms", "email"], null);
  assertEquals(p.perChannelReachable, { push: 1, sms: 0, email: 2 });
  assertEquals([p.reachableCount, p.unreachableCount], [3, 1]);
});

Deno.test("T-DAY the 300-a-day cap follows the same rule; overTextCap keeps today's meaning for old Host builds", () => {
  const p = previewFormRequest(audience({ textsToday: 298, textsLeftThisMonth: 1000 }), ["sms", "email"], null);
  assertEquals(p.textsOff, { reason: "daily_cap", needed: 4, remaining: 2 });
  assertEquals(p.overTextCap, true);
});

Deno.test("T-WITHIN within both limits nothing changes", () => {
  const p = previewFormRequest(audience({ textsLeftThisMonth: null }), ["sms", "email"], null);
  assertEquals(p.textsOff, null);
  assertEquals(p.textsThisSendUses, 4);
  assertEquals(p.overTextCap, false);
});
