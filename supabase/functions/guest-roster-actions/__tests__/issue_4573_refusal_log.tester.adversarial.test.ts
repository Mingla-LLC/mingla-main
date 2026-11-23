// #4573 tester adversarial (L3): hostile database error text and a hostile error code must never reach the refusal log.
// FAILS-ON-REVERT: removing the DB_STATE token filter in logFormRequestRefusal fails case A (the email reaches dbState).
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleFormRequest } from "../formRequest.ts";
import type {
  FormRequestRecipient,
  RpcResult,
} from "../../_shared/brandFormRequests.ts";
import type {
  DispatchV2Input,
  DispatchV2Result,
} from "../../_shared/notifyV2.ts";
import type { SmsRateV1 } from "../../_shared/smsPriceTable.ts";

const FORM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BRAND = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ACTOR = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const PHONE = "+12025550100";
const EMAIL = "guest@example.test";

const guest = (
  n: number,
  over: Partial<FormRequestRecipient> = {},
): FormRequestRecipient => ({
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
          opts.audienceResult ??
            { data: audience(opts.recipients ?? [guest(1)]), error: null },
        );
      }
      if (fn === "brand_form_request_enqueue") {
        return Promise.resolve(
          opts.enqueue ?? { data: { queued: 1 }, error: null },
        );
      }
      if (fn === "brand_forms_switched_off") {
        return Promise.resolve({ data: false, error: null });
      }
      if (fn === "brand_form_request_claim_batch") {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: true, error: null });
    },
    dispatch: (_input: DispatchV2Input): Promise<DispatchV2Result> =>
      Promise.resolve(
        { success: true, deliveries: [] } as unknown as DispatchV2Result,
      ),
    smsRates: () =>
      Promise.resolve(opts.rates === undefined ? RATES : opts.rates),
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

const HOSTILE = "guest@example.test +2348030000001 Ada";
const clean = (line: string) => {
  assert(!line.includes("@"), `no email in ${line}`);
  assert(!/\+\d/.test(line), `no phone in ${line}`);
  assert(!line.includes("Ada"), `no name in ${line}`);
  assert(
    !line.includes(FORM) && !line.includes(EVENT) && !line.includes(ACTOR),
    `no ids in ${line}`,
  );
};

Deno.test("#4573 tester A: a hostile error code is dropped from dbState, audience stage", async () => {
  const r = await capture(() =>
    handleFormRequest(
      body(),
      ACTOR,
      deps({
        audienceResult: {
          data: null,
          error: { message: HOSTILE, code: HOSTILE },
        },
      }) as never,
    )
  );
  assertEquals(r.status, 409);
  assertEquals(r.body, { ok: false, code: "form_request_unavailable" });
  assertEquals(r.lines.length, 1);
  clean(r.lines[0]);
  const j = JSON.parse(r.lines[0].replace("[brand-form-request] refused ", ""));
  assertEquals(j.dbState, null);
  assertEquals(j.stage, "audience");
});

Deno.test("#4573 tester B: an enqueue error naming a known code plus contact text maps, logs no contact", async () => {
  const r = await capture(() =>
    handleFormRequest(
      body(),
      ACTOR,
      deps({
        enqueue: {
          data: null,
          error: { message: `form_not_found ${HOSTILE}`, code: "P0001" },
        },
      }) as never,
    )
  );
  assertEquals(r.status, 409);
  assertEquals(r.body.code, "form_not_found");
  assertEquals(r.lines.length, 1);
  clean(r.lines[0]);
  const j = JSON.parse(r.lines[0].replace("[brand-form-request] refused ", ""));
  assertEquals(j.dbState, "P0001");
  assertEquals("stage" in j, false);
});

Deno.test("#4573 tester C: a lowercase or over-long code is not a token", async () => {
  for (const code of ["21000x", "abcde", "PGRST1160", "21 000", ""]) {
    const r = await capture(() =>
      handleFormRequest(
        body(),
        ACTOR,
        deps({
          enqueue: { data: null, error: { message: "x", code } },
        }) as never,
      )
    );
    const j = JSON.parse(
      r.lines[0].replace("[brand-form-request] refused ", ""),
    );
    assertEquals(j.dbState, null, code);
  }
});

Deno.test("#4573 tester D: a refused preview logs exactly one line with op form_preview", async () => {
  const r = await capture(() =>
    handleFormRequest(
      body({
        operation: "form_preview",
        expectedCostMinor: undefined,
        currency: undefined,
      }),
      ACTOR,
      deps({
        audienceResult: {
          data: null,
          error: { message: "brand_form_forbidden", code: "42501" },
        },
      }) as never,
    )
  );
  assertEquals(r.status, 403);
  assertEquals(r.lines.length, 1);
  const j = JSON.parse(r.lines[0].replace("[brand-form-request] refused ", ""));
  assertEquals([j.op, j.code, j.dbState], [
    "form_preview",
    "forbidden",
    "42501",
  ]);
});

Deno.test("#4573 tester E: a successful send logs no refusal line", async () => {
  const r = await capture(() =>
    handleFormRequest(body(), ACTOR, deps({}) as never, 1)
  );
  assertEquals(r.status, 200);
  assertEquals(r.lines.filter((l) => l.includes("refused")).length, 0);
});
