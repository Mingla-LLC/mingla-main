import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  normalizeCheckoutV2Lines,
} from "../../../../packages/offering-rendering/ticketCheckoutContract.ts";
import {
  canonicalCheckoutV2FingerprintInput,
  checkoutV2IdempotencyKey,
  normalizeCheckoutV2ServerLines,
} from "../../../../packages/offering-rendering/ticketCheckoutServerContract.ts";
import {
  computeMultiLineInstallmentPlan,
  MultiLineInstallmentError,
} from "../../_shared/installments/computeMultiLineInstallmentPlan.ts";
import { createTicketCheckoutCreateHandler } from "../index.ts";

const EVENT = "11111111-1111-4111-8111-111111111111";
const ATTEMPT = "22222222-2222-4222-8222-222222222222";
const STANDARD = "33333333-3333-4333-8333-333333333333";
const VIP = "44444444-4444-4444-8444-444444444444";

Deno.test("#3859 v2 requires explicit unique per-line choices and canonicalizes order", () => {
  const parsed = normalizeCheckoutV2Lines([
    { ticketTypeId: VIP, quantity: 2, paymentPlanChoice: "full" },
    { ticketTypeId: STANDARD, quantity: 1, paymentPlanChoice: "installments" },
  ]);
  assert(parsed.ok);
  assertEquals(parsed.lines.map((line) => line.ticketTypeId), [STANDARD, VIP]);
  assertEquals(
    normalizeCheckoutV2Lines([
      { ticketTypeId: STANDARD, quantity: 1 },
    ]),
    { ok: false, error: "checkout_lines_invalid" },
  );
  assertEquals(
    normalizeCheckoutV2Lines([
      { ticketTypeId: STANDARD, quantity: 1, paymentPlanChoice: "full" },
      {
        ticketTypeId: STANDARD,
        quantity: 1,
        paymentPlanChoice: "installments",
      },
    ]),
    { ok: false, error: "checkout_lines_invalid" },
  );
});

Deno.test("#3859 real create handler rejects checkout-wide scalar before auth or provider I/O", async () => {
  const rpcCalls: string[] = [];
  const handler = createTicketCheckoutCreateHandler({
    userIdFromAuthHeader: () => {
      throw new Error("auth_must_not_run");
    },
    serviceClient: (() => ({
      rpc: (name: string) => {
        rpcCalls.push(name);
        if (name !== "issue_2579_record_checkout_refusal") {
          throw new Error("commerce_rpc_must_not_run");
        }
        return Promise.resolve({ data: null, error: null });
      },
    })) as never,
    paystackInitializeTransaction: (() => {
      throw new Error("provider_must_not_run");
    }) as never,
  });
  const response = await handler(
    new Request("https://example.test/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        checkoutContractVersion: 2,
        checkoutAttemptId: ATTEMPT,
        eventId: EVENT,
        payment_plan_choice: "full",
        lines: [{
          ticketTypeId: STANDARD,
          quantity: 1,
          paymentPlanChoice: "full",
        }],
      }),
    }),
  );
  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: "checkout_scalar_plan_forbidden",
  });
  assertEquals(rpcCalls, ["issue_2579_record_checkout_refusal"]);
});

Deno.test("#3859 real create handler requires purchase terms before auth or provider I/O", async () => {
  const rpcCalls: string[] = [];
  const handler = createTicketCheckoutCreateHandler({
    userIdFromAuthHeader: () => {
      throw new Error("auth_must_not_run");
    },
    serviceClient: (() => ({
      rpc: (name: string) => {
        rpcCalls.push(name);
        if (name !== "issue_2579_record_checkout_refusal") {
          throw new Error("commerce_rpc_must_not_run");
        }
        return Promise.resolve({ data: null, error: null });
      },
    })) as never,
    paystackInitializeTransaction: (() => {
      throw new Error("provider_must_not_run");
    }) as never,
  });
  const response = await handler(
    new Request("https://example.test/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        checkoutContractVersion: 2,
        checkoutAttemptId: ATTEMPT,
        eventId: EVENT,
        lines: [{
          ticketTypeId: STANDARD,
          quantity: 1,
          paymentPlanChoice: "full",
        }],
      }),
    }),
  );
  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: "purchase_terms_required" });
  assertEquals(rpcCalls, ["issue_2579_record_checkout_refusal"]);
});

Deno.test("#3859 mixed lines conserve money without a checkout-wide override", () => {
  const plan = computeMultiLineInstallmentPlan({
    bookedAt: new Date("2030-01-01T00:00:00Z"),
    lines: [
      {
        ticketTypeId: STANDARD,
        lineTotalCents: 10_000,
        paymentPlanChoice: "installments",
        template: {
          deposit_pct: 25,
          installments: [
            { ordinal: 1, pct: 75, days_after_booking: 30 },
          ],
        },
      },
      {
        ticketTypeId: VIP,
        lineTotalCents: 40_000,
        paymentPlanChoice: "full",
        template: {
          deposit_pct: 50,
          installments: [
            { ordinal: 1, pct: 50, days_after_booking: 30 },
          ],
        },
      },
    ],
  });
  assertEquals(plan.dueTodayCents, 42_500);
  assertEquals(plan.scheduled.map((row) => row.amountCents), [7_500]);
  assertEquals(plan.scheduled[0].sourceTicketTypeId, STANDARD);
  assertEquals(
    plan.dueTodayCents + plan.scheduled[0].amountCents,
    50_000,
  );
});

Deno.test("#3859 explicit installments fail closed when the selected line has no plan", () => {
  const error = assertThrows(
    () =>
      computeMultiLineInstallmentPlan({
        bookedAt: new Date("2030-01-01T00:00:00Z"),
        lines: [{
          ticketTypeId: STANDARD,
          lineTotalCents: 10_000,
          paymentPlanChoice: "installments",
          template: null,
        }],
      }),
    MultiLineInstallmentError,
  );
  assertEquals(error.code, "installment_plan_unavailable");
});

Deno.test("#3859 fingerprint is reorder-stable and binds contact, consent, intake, and quote", () => {
  const base = {
    eventId: EVENT,
    checkoutAttemptId: ATTEMPT,
    purchaseTermsAccepted: true,
    buyer: {
      userId: null,
      name: "Buyer",
      email: "buyer@example.test",
      phoneE164: "+15555550123",
      marketingOptIn: true,
    },
    providerInput: { surface: "native" as const },
    lines: [
      {
        ticketTypeId: VIP,
        quantity: 2,
        unitPriceCents: 20_000,
        totalCents: 40_000,
        paymentPlanChoice: "full" as const,
      },
      {
        ticketTypeId: STANDARD,
        quantity: 1,
        unitPriceCents: 10_000,
        totalCents: 10_000,
        paymentPlanChoice: "installments" as const,
      },
    ],
    eventDateId: null,
    eventDateIds: [VIP, STANDARD],
    intakeFormData: [
      {
        ticket_type_id: STANDARD,
        schema_version_id: "v1",
        answers: { b: "two", a: "one" },
      },
      {
        ticket_type_id: VIP,
        schema_version_id: "v2",
        answers: { c: true },
      },
    ],
    quote: {
      currency: "USD",
      fullPriceCents: 50_000,
      dueTodayCents: 42_500,
      installmentSchedule: [{ amountCents: 7_500 }],
    },
  };
  const canonical = canonicalCheckoutV2FingerprintInput(base);
  assertEquals(
    canonicalCheckoutV2FingerprintInput({
      ...base,
      lines: [...base.lines].reverse(),
      eventDateIds: [...base.eventDateIds].reverse(),
      intakeFormData: [...base.intakeFormData].reverse(),
    }),
    canonical,
  );
  assert(
    canonicalCheckoutV2FingerprintInput({
      ...base,
      purchaseTermsAccepted: false,
    }) !== canonical,
  );
  assert(
    canonicalCheckoutV2FingerprintInput({
      ...base,
      buyer: { ...base.buyer, marketingOptIn: false },
    }) !== canonical,
  );
  assert(
    canonicalCheckoutV2FingerprintInput({
      ...base,
      quote: { ...base.quote, dueTodayCents: 50_000 },
    }) !== canonical,
  );
  assert(
    canonicalCheckoutV2FingerprintInput({
      ...base,
      providerInput: { surface: "web" },
    }) !== canonical,
  );
  assertEquals(
    checkoutV2IdempotencyKey({ eventId: EVENT, checkoutAttemptId: ATTEMPT }),
    `ticket_checkout:v2:${EVENT}:${ATTEMPT}`,
  );
});

const edgeSource = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);
const migrationSource = await Deno.readTextFile(
  new URL(
    "../../../migrations/20271016003859_issue_3859_checkout_line_authority.sql",
    import.meta.url,
  ),
);

Deno.test("#3859 v2 binds before every provider boundary while v1 remains separate", () => {
  const resolve = edgeSource.indexOf('"issue_3859_resolve_checkout_attempt"');
  const create = edgeSource.indexOf('"biz_ticket_checkout_create_session"');
  const bind = edgeSource.indexOf('"issue_3859_bind_checkout_contract"');
  assert(resolve > 0);
  assert(resolve < create);
  assert(bind > create);
  assert(bind < edgeSource.indexOf("deps.paystackInitializeTransaction({"));
  assert(bind < edgeSource.indexOf("stripeWeb.checkout.sessions.create("));
  assert(bind < edgeSource.indexOf("stripe.paymentIntents.create("));
  assert(edgeSource.includes('error: "checkout_scalar_plan_forbidden"'));
  assertEquals(
    edgeSource.match(/checkoutFingerprint: checkoutV2Fingerprint/g)?.length,
    3,
  );
});

Deno.test("#3859 migration binds one fingerprint and preserves line/order provenance", () => {
  assert(migrationSource.includes("issue_3859_resolve_checkout_attempt"));
  assert(migrationSource.includes("checkout_fingerprint_conflict"));
  assert(
    migrationSource.includes(
      "p_due_today_cents + v_scheduled_total <> p_full_price_cents",
    ),
  );
  assert(migrationSource.includes("ADD COLUMN payment_plan_choice text"));
  assert(
    migrationSource.includes(
      "ADD COLUMN ticket_type_id uuid REFERENCES public.ticket_types",
    ),
  );
  assert(migrationSource.includes("issue_3859_order_line_plan_choice"));
  assert(migrationSource.includes("issue_3859_installment_ticket_type"));
  assert(migrationSource.includes("TO service_role"));
  assert(!migrationSource.includes("TO anon"));
  assert(!migrationSource.includes("TO authenticated"));
});

Deno.test("#3281 v2 keeps byDate, derives quantity and leaves plain lines alone", () => {
  const DAY_ONE = "55555555-5555-4555-8555-555555555555";
  const DAY_TWO = "66666666-6666-4666-8666-666666666666";
  const parsed = normalizeCheckoutV2ServerLines([{
    ticketTypeId: VIP,
    quantity: 1,
    paymentPlanChoice: "full",
    byDate: { [DAY_ONE]: 2, [DAY_TWO]: 0 },
  }]);
  assert(parsed.ok);
  assertEquals(parsed.lines, [{
    ticketTypeId: VIP,
    quantity: 2,
    paymentPlanChoice: "full",
    byDate: { [DAY_ONE]: 2 },
  }]);

  const plain = normalizeCheckoutV2ServerLines([
    { ticketTypeId: VIP, quantity: 2, paymentPlanChoice: "full" },
  ]);
  assert(plain.ok);
  assertEquals("byDate" in plain.lines[0], false);

  for (
    const byDate of [
      null,
      [],
      {},
      { [DAY_ONE]: 0 },
      { [DAY_ONE]: -1 },
      { [DAY_ONE]: 1.5 },
      { "not-a-date": 1 },
    ]
  ) {
    assertEquals(
      normalizeCheckoutV2ServerLines([{
        ticketTypeId: VIP,
        quantity: 1,
        paymentPlanChoice: "full",
        byDate,
      }]),
      { ok: false, error: "checkout_lines_invalid" },
    );
  }
});

Deno.test("#3281 a changed date map changes the client attempt lines", () => {
  const DAY_ONE = "55555555-5555-4555-8555-555555555555";
  const parsed = normalizeCheckoutV2Lines([{
    ticketTypeId: VIP,
    quantity: 2,
    paymentPlanChoice: "full",
    byDate: { [DAY_ONE]: 2 },
  }]);
  assert(parsed.ok);
  assertEquals(parsed.lines[0].byDate, { [DAY_ONE]: 2 });
});
