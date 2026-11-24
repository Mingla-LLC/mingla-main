/**
 * issue #4522 rework (tester F1, F2) — a Stripe success for a row that is no
 * longer open is recorded, never looped and never kept silently.
 *
 * A superseded planned row (its charge landed after a flexible payment
 * re-spread the balance) is held as an overpayment and the webhook acks; a
 * released flexible payment confirmed late is collected, settled once and
 * then accounted like any collected row. If the database cannot record it,
 * the webhook throws so the inbox retries.
 */
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { handleInstallmentPaymentSucceeded } from "../../installmentWebhookHandlers.ts";
import { resetPlanV2SchemaProbeForTests } from "../planV2Schema.ts";
import { fakeSupabase, type Result } from "./issue_3645_fake_supabase.ts";

const ID = "45220000-0000-4000-8000-0000000f1a01";
const BRAND = "45220000-0000-4000-8000-0000000f1a02";
const event = {
  id: "evt_late",
  type: "payment_intent.succeeded",
  data: { object: { id: "pi_late", amount: 30_000, amount_received: 30_000, latest_charge: "ch_late",
    application_fee_amount: 0, metadata: { mingla_installment_id: ID, mingla_brand_id: BRAND } } },
};

function world(late: Result, statusAfter: string) {
  let loads = 0;
  return fakeSupabase({
    rpc: (name) => {
      if (name === "issue_4522_plan_v2_enabled") return { data: true, error: null };
      if (name === "issue_4522_record_late_collection") return late;
      if (name === "record_order_installment_provider_sale") return { data: { ok: true }, error: null };
      return { data: { ok: true }, error: null };
    },
    table: (op) => {
      if (op.kind === "update") return { data: null, error: null }; // not open any more
      loads += 1;
      return { data: { id: ID, amount_cents: 30_000, status: loads === 1 ? "superseded" : statusAfter,
        payout_accounting_state: "pending", application_fee_amount_cents: null, kind: "flex" }, error: null };
    },
  });
}

Deno.test("a superseded row's late charge is held and the webhook acks", async () => {
  resetPlanV2SchemaProbeForTests();
  const fake = world({ data: { ok: true, outcome: "held", kind: "scheduled" }, error: null }, "superseded");
  // deno-lint-ignore no-explicit-any
  assertEquals(await handleInstallmentPaymentSucceeded(fake.client as any, event as any), BRAND);
  const late = fake.rpcCalls.find((c) => c.name === "issue_4522_record_late_collection");
  assertEquals(late?.args, { p_installment_id: ID, p_amount_minor: 30_000, p_provider_ref: "pi_late", p_charge_ref: "ch_late" });
  // held money is not a sale: it never enters payout accounting
  assertEquals(fake.rpcCalls.some((c) => c.name === "record_order_installment_provider_sale"), false);
});

Deno.test("a released flexible payment confirmed late is collected, then accounted", async () => {
  resetPlanV2SchemaProbeForTests();
  const fake = world({ data: { ok: true, outcome: "flex_collected", kind: "flex" }, error: null }, "collected");
  // deno-lint-ignore no-explicit-any
  await handleInstallmentPaymentSucceeded(fake.client as any, event as any);
  assert(fake.rpcCalls.some((c) => c.name === "record_order_installment_provider_sale"));
});

Deno.test("if the late charge cannot be recorded, the inbox retries", async () => {
  resetPlanV2SchemaProbeForTests();
  const fake = world({ data: { ok: false, reason: "amount_mismatch" }, error: null }, "superseded");
  await assertRejects(
    // deno-lint-ignore no-explicit-any
    () => handleInstallmentPaymentSucceeded(fake.client as any, event as any),
    Error,
    "issue_4522_record_late_collection failed: amount_mismatch",
  );
  resetPlanV2SchemaProbeForTests();
});
