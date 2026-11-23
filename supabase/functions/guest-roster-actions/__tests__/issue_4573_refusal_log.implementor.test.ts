// MINGLA-INVARIANT: I-4573-FORM-REQUEST-REFUSAL-LOGGED | issue #4573 | every refused form request (handleFormRequest non-200) writes exactly one "[brand-form-request] refused" line with its code, status and the database error code, and never a raw database message, phone number, email or token (SC-5).
//
// #4573 SC-5: each refusal path in handleFormRequest logs one line, with the
// code, the database error code and (for form_request_unavailable) the stage.
// The enqueue failing under pg-safeupdate ("DELETE requires a WHERE clause",
// SQLSTATE 21000) returns 409 form_request_unavailable and logs
// stage "enqueue" and dbState "21000".
//
// FAILS-ON-REVERT: deleting the logFormRequestRefusal call in refuse() fails
// every case; deleting the dbState pass-through fails the 21000 case.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleFormRequest } from "../formRequest.ts";
import type { FormRequestRecipient, RpcResult } from "../../_shared/brandFormRequests.ts";
import type { DispatchV2Input, DispatchV2Result } from "../../_shared/notifyV2.ts";
import type { SmsRateV1 } from "../../_shared/smsPriceTable.ts";

const FORM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BRAND = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ACTOR = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const PHONE = "+12025550100";
const EMAIL = "guest@example.test";

const guest = (n: number, over: Partial<FormRequestRecipient> = {}): FormRequestRecipient => ({
  kind: "rsvp",
  id: `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`,
  userId: null,
  personKey: `p:${n}`,
  email: EMAIL,
  phone: PHONE,
  answered: false,
  throttled: false,
  route: ["sms", "email"],
  pushOk: false,
  smsOptedOut: false,
  ...over,
});

const audience = (recipients: FormRequestRecipient[]) => ({
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
  pushAvailable: false,
  monthlyTextCap: null,
  textsLeftThisMonth: null,
  recipients,
});

const RATES: SmsRateV1[] = [{
  country: "US",
  currency: "USD",
  minorNumerator: 1,
  minorDenominator: 1,
} as unknown as SmsRateV1];

function deps(opts: {
  recipients?: FormRequestRecipient[];
  audienceResult?: RpcResult;
  enqueue?: RpcResult;
  rates?: SmsRateV1[] | null;
}) {
  return {
    rpc: (fn: string): Promise<RpcResult> => {
      if (fn === "brand_form_request_audience") {
        return Promise.resolve(
          opts.audienceResult ?? { data: audience(opts.recipients ?? [guest(1)]), error: null },
        );
      }
      if (fn === "brand_form_request_enqueue") {
        return Promise.resolve(opts.enqueue ?? { data: { queued: 1 }, error: null });
      }
      if (fn === "brand_forms_switched_off") return Promise.resolve({ data: false, error: null });
      if (fn === "brand_form_request_claim_batch") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: true, error: null });
    },
    dispatch: (_input: DispatchV2Input): Promise<DispatchV2Result> =>
      Promise.resolve({ success: true, deliveries: [] } as unknown as DispatchV2Result),
    smsRates: () => Promise.resolve(opts.rates === undefined ? RATES : opts.rates),
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

async function capture(
  run: () => Promise<{ status: number; body: Record<string, unknown> }>,
): Promise<{ status: number; body: Record<string, unknown>; lines: string[] }> {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  try {
    const r = await run();
    return { ...r, lines };
  } finally {
    console.warn = original;
  }
}

const RAW = "raw database text that must never be logged guest@example.test +12025550100";

function assertOneSafeLine(lines: string[], code: string): Record<string, unknown> {
  const refused = lines.filter((l) => l.startsWith("[brand-form-request] refused"));
  assertEquals(refused.length, 1, `exactly one refusal line for ${code}`);
  assertEquals(lines.length, 1, `nothing else is warned for ${code}`);
  const line = refused[0];
  assert(!/\+\d/.test(line), `no phone digits in ${line}`);
  assert(!line.includes("@"), `no email in ${line}`);
  assert(!line.includes("raw database text"), `no raw database message in ${line}`);
  assert(!line.includes(FORM) && !line.includes(EVENT) && !line.includes(ACTOR), `no ids in ${line}`);
  const parsed = JSON.parse(line.slice("[brand-form-request] refused ".length)) as Record<string, unknown>;
  assertEquals(parsed.code, code);
  return parsed;
}

const audienceCodes: Array<[string, string, number, string]> = [
  ["brand_form_forbidden", "forbidden", 403, "42501"],
  ["forms_paused", "forms_paused", 503, "55000"],
  ["form_closed", "form_closed", 409, "P0001"],
  ["form_not_live", "form_not_live", 409, "P0001"],
  ["form_not_on_event", "form_not_on_event", 409, "P0001"],
  ["form_not_found", "form_not_found", 409, "P0001"],
  ["event_not_found", "event_not_found", 409, "P0001"],
  ["audience_too_large", "audience_too_large", 409, "P0001"],
  ["something else", "form_request_unavailable", 409, "XX000"],
];

for (const [message, code, status, dbCode] of audienceCodes) {
  Deno.test(`#4573 SC-5: audience refusal ${code} logs one safe line`, async () => {
    const r = await capture(() =>
      handleFormRequest(
        body(),
        ACTOR,
        deps({ audienceResult: { data: null, error: { message: `${message}: ${RAW}`, code: dbCode } } }),
      )
    );
    assertEquals(r.status, status);
    assertEquals(r.body.code, code);
    const line = assertOneSafeLine(r.lines, code);
    assertEquals(line.status, status);
    assertEquals(line.dbState, dbCode);
    assertEquals(line.op, "form_send");
    if (code === "form_request_unavailable") assertEquals(line.stage, "audience");
    else assertEquals(line.stage, undefined);
  });
}

Deno.test("#4573 SC-5: an enqueue refused by pg-safeupdate is form_request_unavailable at stage enqueue, dbState 21000", async () => {
  const r = await capture(() =>
    handleFormRequest(
      body(),
      ACTOR,
      deps({ enqueue: { data: null, error: { message: "DELETE requires a WHERE clause", code: "21000" } } }),
    )
  );
  assertEquals(r.status, 409);
  assertEquals(r.body, { ok: false, code: "form_request_unavailable" });
  const line = assertOneSafeLine(r.lines, "form_request_unavailable");
  assertEquals(line.stage, "enqueue");
  assertEquals(line.dbState, "21000");
  assertEquals(line.smsCount, 1);
  assertEquals(line.reachable, 1);
  assert(!r.lines[0].includes("WHERE clause"), "the database message is not logged");
});

Deno.test("#4573 SC-5: enqueue text cap and an unparseable audience each log one line", async () => {
  const cap = await capture(() =>
    handleFormRequest(
      body(),
      ACTOR,
      deps({ enqueue: { data: null, error: { message: `form_request_text_cap ${RAW}`, code: "P0001" } } }),
    )
  );
  assertEquals(cap.body.code, "text_cap");
  assertEquals(assertOneSafeLine(cap.lines, "text_cap").dbState, "P0001");

  const parse = await capture(() =>
    handleFormRequest(body(), ACTOR, deps({ audienceResult: { data: { nope: true }, error: null } }))
  );
  assertEquals(parse.status, 502);
  const line = assertOneSafeLine(parse.lines, "form_request_unavailable");
  assertEquals(line.stage, "parse");
  assertEquals(line.dbState, null);
});

Deno.test("#4573 SC-5: no_recipients, cost_unpriced and preview_stale_cost each log one line", async () => {
  const none = await capture(() =>
    handleFormRequest(body(), ACTOR, deps({ recipients: [guest(1, { route: [], email: null, phone: null })] }))
  );
  assertEquals(none.body.code, "no_recipients");
  assertEquals(assertOneSafeLine(none.lines, "no_recipients").reachable, 0);

  const unpriced = await capture(() => handleFormRequest(body(), ACTOR, deps({ rates: null })));
  assertEquals(unpriced.body.code, "cost_unpriced");
  assertEquals(assertOneSafeLine(unpriced.lines, "cost_unpriced").smsCount, 1);

  const stale = await capture(() => handleFormRequest(body({ expectedCostMinor: 0, currency: "EUR" }), ACTOR, deps({})));
  assertEquals(stale.body.code, "preview_stale_cost");
  assertOneSafeLine(stale.lines, "preview_stale_cost");
});

Deno.test("#4573 SC-5: a database code that is not a short token is logged as null", async () => {
  const r = await capture(() =>
    handleFormRequest(
      body(),
      ACTOR,
      deps({ enqueue: { data: null, error: { message: "x", code: "+12025550100 guest@example.test" } } }),
    )
  );
  assertEquals(assertOneSafeLine(r.lines, "form_request_unavailable").dbState, null);
});

Deno.test("#4573: a preview and a successful send log no refusal", async () => {
  const preview = await capture(() =>
    handleFormRequest(
      { ...body(), operation: "form_preview", expectedCostMinor: undefined, currency: undefined },
      ACTOR,
      deps({}),
    )
  );
  assertEquals(preview.status, 200);
  assertEquals(preview.lines.length, 0);
  const sent = await capture(() => handleFormRequest(body(), ACTOR, deps({}), 50));
  assertEquals(sent.status, 200);
  assertEquals(sent.lines.filter((l) => l.includes("refused")).length, 0);
});
