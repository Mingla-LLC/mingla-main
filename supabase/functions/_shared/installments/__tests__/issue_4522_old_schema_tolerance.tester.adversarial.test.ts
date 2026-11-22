// MINGLA-INVARIANT: I-4522-16 | issue #4522 | Edge code deployed before the #4522 migrations behaves exactly as before #4522: one capability probe (issue_4522_plan_v2_enabled) maps only "does not exist" errors (42703, 42883, 42P01, PGRST202, PGRST204, PGRST205) to "not yet", every instalment read then omits kind / schedule_version, no issue_4522_* function is called, and the v2-only trip-balance-pay refuses with payment_plan_v2_unavailable instead of a 500.
/**
 * issue #4522 rework (tester F6) — deploy-order safety.
 *
 * Edge functions deploy on merge, before migrations are applied. These tests
 * drive the real handlers against a recording client whose database has no
 * #4522 schema, then against one that has it. (The same handlers were also
 * run against a database replayed from origin/main's migrations only, through
 * PostgREST, with every provider call mocked; see the #4522 rework evidence.)
 *
 * Fails on revert: the handlers select `kind` / `schedule_version` and call
 * issue_4522_* functions unconditionally, which on the old schema is an
 * error on every v1 instalment webhook and cron run.
 */
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  isMissingSchemaError,
  NOT_YET_TTL_MS,
  planV2SchemaAvailable,
  resetPlanV2SchemaProbeForTests,
} from "../planV2Schema.ts";
import {
  handleInstallmentPaymentFailed,
  handleInstallmentPaymentSucceeded,
} from "../../installmentWebhookHandlers.ts";
import { createInstallmentPI } from "../createInstallmentPI.ts";
import { processScheduledInstallments } from "../../../process-scheduled-installments/index.ts";
import { handleTripBalancePay } from "../../../trip-balance-pay/index.ts";
import { fakeSupabase, type FakeSupabase, type Result, type TableOp } from "./issue_3645_fake_supabase.ts";

const INSTALLMENT = "45220000-0000-4000-8000-0000000f6001";
const ORDER = "45220000-0000-4000-8000-0000000f6002";
const BRAND = "45220000-0000-4000-8000-0000000f6003";

const OLD = { code: "PGRST202", message: "Could not find the function public.issue_4522_plan_v2_enabled" };

function client(schemaV2: boolean, table: (op: TableOp) => Result = () => ({ data: null, error: null })): FakeSupabase {
  return fakeSupabase({
    rpc: (name) => {
      if (name === "issue_4522_plan_v2_enabled") {
        return schemaV2 ? { data: true, error: null } : { data: null, error: OLD };
      }
      if (name === "record_order_installment_provider_sale") return { data: { ok: true }, error: null };
      if (name === "claim_order_installment_for_charge") return { data: { ok: false, reason: "test_stop" }, error: null };
      return { data: { ok: true }, error: null };
    },
    table,
  });
}

/** Everything the handler asked of the database, as text. */
function asked(fake: FakeSupabase): string {
  return JSON.stringify({
    columns: fake.tableOps.map((op) => [op.columns, op.returning ?? null]),
    filters: fake.tableOps.flatMap((op) => op.filters.map((f) => f[1])),
    rpcs: fake.rpcCalls.map((c) => c.name),
  });
}

function v2Calls(fake: FakeSupabase): string[] {
  return fake.rpcCalls.map((c) => c.name).filter((n) => n.startsWith("issue_4522_") && n !== "issue_4522_plan_v2_enabled");
}

Deno.test("the probe: only 'does not exist' means not yet; a yes is remembered", async () => {
  resetPlanV2SchemaProbeForTests();
  for (const code of ["42703", "42883", "42P01", "PGRST202", "PGRST204", "PGRST205"]) {
    assert(isMissingSchemaError({ code }));
  }
  assert(!isMissingSchemaError({ code: "57014" }));
  assert(!isMissingSchemaError(null));

  let calls = 0;
  let answer: Result = { data: null, error: OLD };
  const probe = { rpc: () => { calls += 1; return Promise.resolve(answer); } };
  let now = 1_000_000;
  assertEquals(await planV2SchemaAvailable(probe, () => now), false);
  assertEquals(await planV2SchemaAvailable(probe, () => now + 1_000), false);
  assertEquals(calls, 1); // "not yet" is remembered briefly
  now += NOT_YET_TTL_MS;
  answer = { data: false, error: null }; // the migrations landed (switch may be off)
  assertEquals(await planV2SchemaAvailable(probe, () => now), true);
  answer = { data: null, error: OLD };
  assertEquals(await planV2SchemaAvailable(probe, () => now + 10 * NOT_YET_TTL_MS), true);
  assertEquals(calls, 2); // a yes is never asked again

  resetPlanV2SchemaProbeForTests();
  await assertRejects(
    () => planV2SchemaAvailable({ rpc: () => Promise.resolve({ data: null, error: { code: "57014", message: "canceling statement" } }) }),
    Error,
    "schema probe failed",
  );
  resetPlanV2SchemaProbeForTests();
});

const succeeded = {
  id: "evt_f6",
  type: "payment_intent.succeeded",
  data: { object: {
    id: "pi_f6", amount: 25_000, amount_received: 25_000, latest_charge: "ch_f6", application_fee_amount: 0,
    metadata: { mingla_installment_id: INSTALLMENT, mingla_brand_id: BRAND },
  } },
};

Deno.test("old schema: the success webhook collects a v1 row exactly as before", async () => {
  resetPlanV2SchemaProbeForTests();
  const fake = client(false, (op) =>
    op.kind === "update"
      ? { data: { id: INSTALLMENT, order_id: ORDER, ordinal: 1, amount_cents: 25_000 }, error: null }
      : { data: null, error: null, count: 1 }
  );
  // deno-lint-ignore no-explicit-any
  await handleInstallmentPaymentSucceeded(fake.client as any, succeeded as any);
  const text = asked(fake);
  assert(!text.includes("kind"), text);
  assertEquals(v2Calls(fake), []);
  assert(fake.rpcCalls.some((c) => c.name === "record_order_installment_provider_sale"));
});

Deno.test("new schema: the success webhook reads kind (positive control)", async () => {
  resetPlanV2SchemaProbeForTests();
  const fake = client(true, (op) =>
    op.kind === "update"
      ? { data: { id: INSTALLMENT, order_id: ORDER, ordinal: 1, amount_cents: 25_000, kind: "scheduled" }, error: null }
      : { data: null, error: null, count: 1 }
  );
  // deno-lint-ignore no-explicit-any
  await handleInstallmentPaymentSucceeded(fake.client as any, succeeded as any);
  assert(asked(fake).includes("kind"));
  resetPlanV2SchemaProbeForTests();
});

Deno.test("old schema: the failure webhook records a v1 failure and never calls rollover", async () => {
  resetPlanV2SchemaProbeForTests();
  const fake = client(false, (op) =>
    op.kind === "select"
      ? { data: { id: INSTALLMENT, order_id: ORDER, ordinal: 1, retry_count: 2, status: "scheduled", due_at: "2026-11-01T00:00:00Z" }, error: null }
      : { data: null, error: null }
  );
  await handleInstallmentPaymentFailed(
    // deno-lint-ignore no-explicit-any
    fake.client as any,
    // deno-lint-ignore no-explicit-any
    { id: "evt_f6f", type: "payment_intent.payment_failed", data: { object: {
      id: "pi_f6f", last_payment_error: { code: "card_declined", message: "declined" },
      metadata: { mingla_installment_id: INSTALLMENT, mingla_brand_id: BRAND },
    } } } as any,
  );
  const text = asked(fake);
  assert(!text.includes("kind"), text);
  assertEquals(v2Calls(fake), []);
  // the third failure flags the booking at risk exactly as before
  assert(fake.tableOps.some((op) => op.table === "orders" && op.kind === "update" && op.values?.at_risk === true));
});

Deno.test("old schema: the cron's charge reads the row without schedule_version", async () => {
  resetPlanV2SchemaProbeForTests();
  const fake = client(false, (op) => {
    if (op.table === "order_installments") {
      return { data: { id: INSTALLMENT, order_id: ORDER, ordinal: 1, amount_cents: 25_000, referral_share_minor: 0, currency: "USD", due_at: "2026-11-01T00:00:00Z", status: "scheduled", retry_count: 0, stripe_payment_intent_id: null }, error: null };
    }
    if (op.table === "orders") return { data: { id: ORDER, event_id: "e", stripe_customer_id_on_connected_account: "cus", saved_payment_method_id: "pm", buyer_user_id: null, buyer_email: "b@example.test", at_risk: false, cancelled_at: null }, error: null };
    if (op.table === "brands") return { data: { id: BRAND, contact_email: null, name: "B" }, error: null };
    return { data: { brand_id: BRAND, stripe_account_id: "acct" }, error: null };
  });
  // deno-lint-ignore no-explicit-any
  const result = await createInstallmentPI({ installmentId: INSTALLMENT, brandId: BRAND, supabase: fake.client as any });
  assertEquals(result.reason, "test_stop"); // reached the claim, no Stripe call
  const text = asked(fake);
  assert(!text.includes("schedule_version"), text);
  assertEquals(v2Calls(fake), []);
});

Deno.test("old schema: the cron never filters on kind and never sweeps; new schema does both", async () => {
  for (const schemaV2 of [false, true]) {
    resetPlanV2SchemaProbeForTests();
    const fake = client(schemaV2, () => ({ data: [], error: null }));
    // deno-lint-ignore no-explicit-any
    const result = await processScheduledInstallments(fake.client as any, { deps: {
      flexStripe: () => ({ paymentIntents: {
        retrieve: () => Promise.resolve({}),
        cancel: () => Promise.resolve({}),
      } }),
    } });
    assertEquals(result.errors, []);
    const filters = fake.tableOps.flatMap((op) => op.filters.map((f) => f[1]));
    assertEquals(filters.includes("kind"), schemaV2);
    // issue #4522 (N3 / N2) — the v2 sweeps run only with the v2 schema.
    assertEquals(fake.rpcCalls.some((c) => c.name === "issue_4522_flex_payments_to_verify"), schemaV2);
    assertEquals(fake.rpcCalls.some((c) => c.name === "issue_4522_overpayments_due"), schemaV2);
  }
  resetPlanV2SchemaProbeForTests();
});

Deno.test("old schema: trip-balance-pay refuses cleanly, never a 500", async () => {
  resetPlanV2SchemaProbeForTests();
  const fake = client(false);
  const res = await handleTripBalancePay(
    new Request("http://x", { method: "POST", body: JSON.stringify({ action: "view", orderId: ORDER }) }),
    // deno-lint-ignore no-explicit-any
    { supabase: fake.client as any },
  );
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "payment_plan_v2_unavailable" });
  assertEquals(v2Calls(fake), []);
  resetPlanV2SchemaProbeForTests();
});
