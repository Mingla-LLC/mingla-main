// #4514 wave 4 — Ask guests to answer and Remind (guest-roster-actions form ops),
// with the wave 4 review fixes.
//
// Pins: no push while the Explorer /form screen is missing (texts and emails
// carry the guest's own link; a guest with no contact is counted, never
// dropped); the host's send only queues and then drains this page in pages of
// 25, resumable after a crash or a partial failure; cost counts real segments
// (emoji and accented letters), refuses texts with no price unless the host
// confirmed, and refuses a send over the brand's daily text limit; a request
// calls only form-request SQL (decision 17: never an invite RPC).
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleFormRequest, isFormRequestBody } from "./formRequest.ts";
import {
  drainFormRequests,
  FORM_REQUEST_PUSH_ENABLED,
  type FormRequestRecipient,
  routeFor,
} from "../_shared/brandFormRequests.ts";
import {
  previewFormRequest,
  requestSmsSegments,
} from "../_shared/brandFormRequestPreview.ts";
import type { DispatchV2Input, DispatchV2Result } from "../_shared/notifyV2.ts";
import { renderCategoryMessage } from "../_shared/notifyTemplates.ts";
import { providerSafePayload } from "../_shared/notifyV2.ts";
import type { SmsRateV1 } from "../_shared/smsPriceTable.ts";

const FORM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BRAND = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ACTOR = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const id = (n: number) =>
  `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const TOKEN = "a".repeat(64);

const guest = (
  n: number,
  over: Partial<FormRequestRecipient> = {},
): FormRequestRecipient => ({
  kind: "rsvp",
  id: id(n),
  userId: null,
  personKey: `p:${n}`,
  email: null,
  phone: null,
  answered: false,
  throttled: false,
  route: [],
  smsOptedOut: false,
  ...over,
});

const audience = (
  recipients: FormRequestRecipient[],
  over: Record<string, unknown> = {},
) => ({
  formId: FORM,
  eventId: EVENT,
  brandId: BRAND,
  formName: "Dietary",
  eventTitle: "Supper Club",
  brandName: "Lagos Supper",
  eventStartsAt: "2028-03-04T18:00:00Z",
  textsToday: 0,
  textCap: 300,
  textsWaitUntil: null,
  recipients,
  ...over,
});

const RATES: SmsRateV1[] = [{
  country: "US",
  currency: "USD",
  minorNumerator: 1,
  minorDenominator: 1,
} as unknown as SmsRateV1];

const claimed = (n: number, over: Record<string, unknown> = {}) => ({
  sendId: id(900 + n),
  token: TOKEN,
  formId: FORM,
  eventId: EVENT,
  kind: "ask",
  subjectKind: "rsvp",
  subjectId: id(n),
  userId: id(500 + n),
  route: ["sms", "email"],
  phone: "+12025550100",
  email: `g${n}@example.test`,
  brandName: "Lagos Supper",
  eventTitle: "Supper Club",
  eventTimezone: "Africa/Lagos",
  startsAt: "2028-03-04T18:00:00Z",
  ...over,
});

const ok = (channel: string): DispatchV2Result =>
  ({
    success: true,
    deliveries: [{ channel, status: "sent" }],
  }) as unknown as DispatchV2Result;

function harness(opts: {
  recipients: FormRequestRecipient[];
  pages?: unknown[][];
  enqueue?: { data: unknown; error: { message: string } | null };
  dispatch?: (input: DispatchV2Input) => Promise<DispatchV2Result>;
  rates?: SmsRateV1[] | null;
  audienceOver?: Record<string, unknown>;
}) {
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const sent: DispatchV2Input[] = [];
  const pages = [...(opts.pages ?? [])];
  return {
    rpcs,
    sent,
    deps: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        rpcs.push({ fn, args });
        if (fn === "brand_form_request_audience") {
          return Promise.resolve({
            data: audience(opts.recipients, opts.audienceOver),
            error: null,
          });
        }
        if (fn === "brand_form_request_enqueue") {
          return Promise.resolve(
            opts.enqueue ??
              {
                data: { queued: opts.recipients.length, throttled: 0 },
                error: null,
              },
          );
        }
        if (fn === "brand_form_request_claim_batch") {
          return Promise.resolve({ data: pages.shift() ?? [], error: null });
        }
        // #4541 R1.8: the drain reads the forms off switch once per run.
        if (fn === "brand_forms_switched_off") {
          return Promise.resolve({ data: false, error: null });
        }
        return Promise.resolve({ data: true, error: null });
      },
      dispatch: (input: DispatchV2Input) => {
        sent.push(input);
        return opts.dispatch
          ? opts.dispatch(input)
          : Promise.resolve(ok(input.contact?.includes("@") ? "email" : "sms"));
      },
      smsRates: () =>
        Promise.resolve(opts.rates === undefined ? RATES : opts.rates),
    },
  };
}

const body = (over: Record<string, unknown> = {}) => ({
  operation: "form_send" as const,
  eventId: EVENT,
  formId: FORM,
  kind: "ask" as const,
  audience: "unanswered" as const,
  channels: ["email", "sms"] as Array<"push" | "sms" | "email">,
  expectedCostMinor: 1000,
  currency: "USD",
  ...over,
});

Deno.test("#4514 body: Remind targets people who have not answered; unknown keys refused; push refused while the form screen is missing", () => {
  assert(isFormRequestBody(body()));
  assert(!isFormRequestBody(body({ kind: "remind", audience: "everyone" })));
  assert(!isFormRequestBody(body({ extra: 1 })));
  assertEquals(FORM_REQUEST_PUSH_ENABLED, false);
  assert(!isFormRequestBody(body({ channels: ["push"] })));
  assert(!isFormRequestBody(body({ channels: ["push", "email"] })));
  assert(isFormRequestBody(body({ confirmUnpriced: true })));
  assert(
    !isFormRequestBody({
      ...body(),
      operation: "form_preview",
      expectedCostMinor: undefined,
      currency: undefined,
      confirmUnpriced: true,
    }),
  );
});

Deno.test("#4514 route: no push even for an account; the server's contact route (text, then email) narrowed to the ticked channels", () => {
  const app = guest(1, { userId: id(7), route: ["sms", "email"] });
  assertEquals(routeFor(app, ["push", "sms", "email"]), ["sms", "email"]);
  assertEquals(routeFor(app, ["push", "email"]), ["email"]);
  assertEquals(routeFor(guest(2, { userId: id(8) }), ["push", "sms"]), []);
});

Deno.test("#4514 preview: reachable, opted out of texts and can't reach are counted, never dropped", () => {
  const p = previewFormRequest(
    audience([
      guest(1, { phone: "+12025550101", route: ["sms", "email"] }),
      guest(2, { email: "b@example.test", route: ["email"] }),
      guest(3, { phone: "+12025550103", smsOptedOut: true }),
      guest(4, { userId: id(9) }),
      guest(5, { route: ["email"], throttled: true }),
    ]),
    ["sms", "email"],
    RATES,
  );
  assertEquals(p.selectedCount, 5);
  assertEquals(p.reachableCount, 2);
  assertEquals(p.smsOptedOutCount, 1);
  assertEquals(p.unreachableCount, 1);
  assertEquals(p.throttledCount, 1);
  assertEquals(p.perChannelReachable, { push: 0, sms: 1, email: 1 });
  assertEquals(p.smsCount, 1);
});

Deno.test("#4514 cost: segments come from the SMS adapter (an emoji or accented name costs more parts)", () => {
  const plain = requestSmsSegments("Lagos Supper", "Supper Club");
  const emoji = requestSmsSegments("Lagos Supper", "Supper Club 🎉");
  const accent = requestSmsSegments("Café Ọmọ", "Fête");
  assert(plain >= 1);
  assert(emoji > plain, `emoji ${emoji} > plain ${plain}`);
  assert(accent > plain, `accent ${accent} > plain ${plain}`);
  const g = [guest(1, { phone: "+12025550101", route: ["sms"] })];
  const p1 = previewFormRequest(audience(g), ["sms"], RATES);
  const p2 = previewFormRequest(
    audience(g, { eventTitle: "Supper Club 🎉" }),
    ["sms"],
    RATES,
  );
  assertEquals(p1.estimatedCostMinor, plain);
  assertEquals(p2.estimatedCostMinor, emoji);
});

Deno.test("#4514 send: decision 17 — only form-request SQL; it queues, then drains this page; texts and emails carry the guest's own link; no push", async () => {
  const h = harness({
    recipients: [
      guest(1, { phone: "+12025550101", userId: id(5), route: ["sms"] }),
      guest(2, { email: "b@example.test", route: ["email"] }),
    ],
    pages: [[
      claimed(1, { route: ["sms"] }),
      claimed(2, { route: ["email"], phone: null }),
    ]],
  });
  const r = await handleFormRequest(
    body({ expectedCostMinor: 100 }),
    ACTOR,
    h.deps,
  );
  assertEquals(r.status, 200);
  assertEquals(r.body.queued, 2);
  assertEquals(r.body.sent, 2);
  assertEquals(r.body.status, "sent");
  const fns = h.rpcs.map((c) => c.fn);
  // Only form-request SQL (plus the #4541 R1.8 off-switch read, once per drain).
  assert(
    fns.every((f) =>
      f.startsWith("brand_form_request_") || f === "brand_forms_switched_off"
    ),
    fns.join(),
  );
  assertEquals(fns.filter((f) => f === "brand_forms_switched_off").length, 1);
  const claim = h.rpcs.find((c) => c.fn === "brand_form_request_claim_batch");
  assertEquals(claim?.args, {
    p_limit: 25,
    p_form_id: FORM,
    p_event_id: EVENT,
  });
  assertEquals(h.sent.length, 2);
  assert(
    h.sent.every((s) => s.requested_channel !== "push" && s.user_id === null),
  );
  for (const s of h.sent) {
    assertEquals(
      s.payload.form_url,
      `https://host.usemingla.com/form/${FORM}#t=${TOKEN}`,
    );
    assertEquals(s.payload.brand_name, "Lagos Supper");
    assertEquals(s.payload.event_date, "2028-03-04T18:00:00Z");
  }
  const email = h.sent.find((s) => s.contact === "g2@example.test");
  assertEquals(
    email?.email_cta?.url,
    `https://host.usemingla.com/form/${FORM}#t=${TOKEN}`,
  );
  const text = renderCategoryMessage("brand_form_request", h.sent[0].payload);
  assert(
    text.sms.includes(
      "Lagos Supper has a few questions about Supper Club on Sat 4 Mar.",
    ),
    text.sms,
  );
  assertEquals(
    Object.keys(providerSafePayload("brand_form_request", h.sent[0].payload))
      .sort(),
    ["event_id", "form_id", "rsvp_id"],
  );
});

Deno.test("#4514 send: a partial failure settles each guest and the drain stops at a short page (no retry storm)", async () => {
  const h = harness({
    recipients: [
      guest(1, { email: "a@x.test", route: ["email"] }),
      guest(2, { email: "b@x.test", route: ["email"] }),
      guest(3, { email: "c@x.test", route: ["email"] }),
    ],
    pages: [[
      claimed(1, { route: ["email"] }),
      claimed(2, { route: ["email"] }),
      claimed(3, { route: ["email"] }),
    ]],
    dispatch: (input) =>
      input.contact === "g2@example.test"
        ? Promise.reject(new Error("provider down"))
        : Promise.resolve(ok("email")),
  });
  const r = await handleFormRequest(
    body({ channels: ["email"] }),
    ACTOR,
    h.deps,
  );
  assertEquals([r.body.sent, r.body.failed, r.body.pending], [2, 1, 0]);
  const settles = h.rpcs.filter((c) => c.fn === "brand_form_request_settle");
  assertEquals(settles.length, 3);
  assertEquals(
    settles.find((s) => s.args.p_send_id === id(902))?.args.p_reason,
    "email_dispatch_failed",
  );
  assertEquals(
    h.rpcs.filter((c) => c.fn === "brand_form_request_claim_batch").length,
    1,
  );
});

Deno.test("#4514 send: a text that fails falls back to the email on the route", async () => {
  const h = harness({
    recipients: [
      guest(1, {
        phone: "+12025550101",
        email: "a@x.test",
        route: ["sms", "email"],
      }),
    ],
    pages: [[claimed(1)]],
    dispatch: (input) =>
      Promise.resolve(
        input.contact?.includes("@")
          ? ok("email")
          : ({ success: false, reason: "sms_disabled" } as DispatchV2Result),
      ),
  });
  const r = await handleFormRequest(
    body({ expectedCostMinor: 100 }),
    ACTOR,
    h.deps,
  );
  assertEquals(r.body.sent, 1);
  assertEquals(h.sent.map((s) => s.idempotency_key), [
    `brand_form_request:${id(901)}:sms`,
    `brand_form_request:${id(901)}:email`,
  ]);
});

Deno.test("#4514 retry: a retried claim whose text already went answers duplicate; it counts as sent, no email follows and it is not failed", async () => {
  // The first try died after the provider took the text; the claim came back
  // after 10 minutes and the dispatcher's (key, channel) slot says duplicate.
  const h = harness({
    recipients: [],
    pages: [[claimed(1)]],
    dispatch: (input) =>
      Promise.resolve(
        input.contact?.includes("@") ? ok("email") : ({
          success: true,
          deliveries: [{
            channel: "sms",
            status: "duplicate",
            providerMessageId: null,
          }],
        } as DispatchV2Result),
      ),
  });
  const out = await drainFormRequests(h.deps, { budgetMs: 1_000 });
  assertEquals([out.sent, out.failed], [1, 0]);
  assertEquals(h.sent.map((s) => s.idempotency_key), [
    `brand_form_request:${id(901)}:sms`,
  ]);
  const settle = h.rpcs.find((c) => c.fn === "brand_form_request_settle");
  assertEquals(
    [settle?.args.p_status, settle?.args.p_channel, settle?.args.p_reason],
    ["sent", "sms", null],
  );
});

Deno.test("#4514 drain: a full page keeps draining; when the time budget runs out the rest stays queued for the cron (resumable)", async () => {
  const full = Array.from(
    { length: 25 },
    (_, i) => claimed(i + 1, { route: ["email"] }),
  );
  const h = harness({ recipients: [], pages: [full, full, full] });
  let t = 0;
  const out = await drainFormRequests(h.deps, {
    budgetMs: 70,
    now: () => {
      t += 30;
      return t;
    },
  });
  assert(out.more, "budget spent with pages still coming");
  assertEquals([out.pages, out.sent], [2, 50]);
});

Deno.test("#4514 send: a crash in the drain after queueing still answers queued (nothing lost; the cron resumes)", async () => {
  const h = harness({
    recipients: [guest(1, { email: "a@x.test", route: ["email"] })],
  });
  const deps = {
    ...h.deps,
    rpc: (fn: string, args: Record<string, unknown>) =>
      fn === "brand_form_request_claim_batch"
        ? Promise.resolve({ data: null, error: { message: "timeout" } })
        : h.deps.rpc(fn, args),
  };
  const r = await handleFormRequest(body({ channels: ["email"] }), ACTOR, deps);
  assertEquals(r.status, 200);
  assertEquals([r.body.status, r.body.queued, r.body.pending], [
    "queued",
    1,
    1,
  ]);
});

Deno.test("#4514 cost: texts with no price are refused unless the host confirms; then they queue", async () => {
  const recipients = [guest(1, { phone: "+2348012345678", route: ["sms"] })];
  const h = harness({ recipients, rates: RATES });
  const refused = await handleFormRequest(
    body({ expectedCostMinor: null, currency: null }),
    ACTOR,
    h.deps,
  );
  assertEquals([refused.status, refused.body.code], [409, "cost_unpriced"]);
  assert(!h.rpcs.some((c) => c.fn === "brand_form_request_enqueue"));
  const h2 = harness({ recipients, rates: RATES });
  const okSend = await handleFormRequest(
    body({ expectedCostMinor: null, currency: null, confirmUnpriced: true }),
    ACTOR,
    h2.deps,
  );
  assertEquals(okSend.status, 200);
  assert(h2.rpcs.some((c) => c.fn === "brand_form_request_enqueue"));
});

Deno.test("#4514 cap: over the brand's daily text limit nothing is queued; the database refusal maps to the same code", async () => {
  const recipients = [guest(1, { phone: "+12025550101", route: ["sms"] })];
  const h = harness({ recipients, audienceOver: { textsToday: 300 } });
  const r = await handleFormRequest(body(), ACTOR, h.deps);
  assertEquals([r.status, r.body.code, r.body.textCap], [409, "text_cap", 300]);
  assert(!h.rpcs.some((c) => c.fn === "brand_form_request_enqueue"));
  const h2 = harness({
    recipients,
    enqueue: { data: null, error: { message: "form_request_text_cap" } },
  });
  const r2 = await handleFormRequest(body(), ACTOR, h2.deps);
  assertEquals([r2.status, r2.body.code], [409, "text_cap"]);
  assertEquals(h2.sent.length, 0);
});

Deno.test("#4514 send: a cost that grew past the preview is refused before anything is queued", async () => {
  const h = harness({
    recipients: [guest(1, { phone: "+12025550101", route: ["sms"] })],
  });
  const r = await handleFormRequest(
    body({ expectedCostMinor: 0 }),
    ACTOR,
    h.deps,
  );
  assertEquals([r.status, r.body.code], [409, "preview_stale_cost"]);
  assert(!h.rpcs.some((c) => c.fn === "brand_form_request_enqueue"));
});

Deno.test("#4514 send: below event manager the audience read refuses and nothing is queued or sent", async () => {
  const h = harness({ recipients: [] });
  const deps = {
    ...h.deps,
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.rpcs.push({ fn, args });
      return Promise.resolve({
        data: null,
        error: { message: "brand_form_forbidden" },
      });
    },
  };
  const r = await handleFormRequest(body(), ACTOR, deps);
  assertEquals([r.status, r.body.code], [403, "forbidden"]);
  assertEquals(h.rpcs.map((c) => c.fn), ["brand_form_request_audience"]);
  assertEquals(h.sent.length, 0);
});

Deno.test("#4514 concurrency: two Asks at once each queue through the database (the brand lock decides), and the second's throttled people are reported", async () => {
  const recipients = [guest(1, { email: "a@x.test", route: ["email"] })];
  const first = harness({
    recipients,
    enqueue: { data: { queued: 1, throttled: 0 }, error: null },
    pages: [[claimed(1, { route: ["email"] })]],
  });
  const second = harness({
    recipients,
    enqueue: { data: { queued: 0, throttled: 1 }, error: null },
  });
  const [a, b] = await Promise.all([
    handleFormRequest(body({ channels: ["email"] }), ACTOR, first.deps),
    handleFormRequest(body({ channels: ["email"] }), ACTOR, second.deps),
  ]);
  assertEquals([a.body.queued, a.body.sent], [1, 1]);
  assertEquals([
    b.body.queued,
    b.body.sent,
    (b.body.skipped as Record<string, number>).throttled,
  ], [0, 0, 1]);
  assertEquals(first.sent.length + second.sent.length, 1);
});
