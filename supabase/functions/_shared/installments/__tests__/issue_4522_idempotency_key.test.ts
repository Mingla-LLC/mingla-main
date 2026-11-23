/**
 * issue #4522 — I-4522-5: a changed instalment amount never reuses a Stripe
 * idempotency key. Version 0 keeps today's key byte for byte (SC-9).
 */
// MINGLA-INVARIANT: I-4522-5 | issue #4522 | A rebalanced instalment row's Stripe idempotency key carries its schedule version, so a changed amount never reuses a key; version 0 keeps the legacy key.
import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  flexPaymentIdempotencyKey,
  installmentIdempotencyKey,
  installmentKeyVersionSuffix,
} from "../installmentIdempotencyKey.ts";
import { resetPlanV2SchemaProbeForTests } from "../planV2Schema.ts";
import { createInstallmentPI } from "../createInstallmentPI.ts";

const source = await Deno.readTextFile(
  new URL("../createInstallmentPI.ts", import.meta.url),
);

Deno.test("version 0 keeps the legacy key; a rebalanced row adds :v<n>", () => {
  assertEquals(
    installmentIdempotencyKey({ orderId: "o1", ordinal: 2, retryCount: 1 }),
    "installment:o1:2:1",
  );
  assertEquals(
    installmentIdempotencyKey({
      orderId: "o1",
      ordinal: 2,
      retryCount: 1,
      scheduleVersion: 0,
    }),
    "installment:o1:2:1",
  );
  assertEquals(
    installmentIdempotencyKey({
      orderId: "o1",
      ordinal: 2,
      retryCount: 0,
      scheduleVersion: 1,
    }),
    "installment:o1:2:0:v1",
  );
  assertEquals(installmentKeyVersionSuffix(null), "");
  assertEquals(installmentKeyVersionSuffix(3), ":v3");
  assertEquals(
    flexPaymentIdempotencyKey("o1", "client-key-1"),
    "flex:o1:client-key-1",
  );
});

Deno.test("createInstallmentPI builds its key with the version suffix and reads the version", () => {
  assertMatch(
    source,
    /`installment:\$\{installment\.order_id\}:\$\{installment\.ordinal\}:\$\{installment\.retry_count\}` \+\n\s+installmentKeyVersionSuffix\(installment\.schedule_version\);/,
  );
  assertMatch(
    source,
    /retry_count, stripe_payment_intent_id, schedule_version"/,
  );
});

// ── I-4522-CHARGE-IS-WHAT-IS-OWED: the Stripe confirm waits for the mark ────

function chargeWorld(markAnswer: Record<string, unknown>) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const stripeCalls: string[] = [];
  const updates: Record<string, unknown>[] = [];
  const supabase = {
    rpc(name: string, args: Record<string, unknown> = {}) {
      rpcCalls.push({ name, args });
      if (name === "issue_4522_plan_v2_enabled") return Promise.resolve({ data: true, error: null });
      if (name === "claim_order_installment_for_charge") return Promise.resolve({ data: { ok: true }, error: null });
      if (name === "issue_4522_mark_stripe_charge_in_flight") return Promise.resolve({ data: markAnswer, error: null });
      if (name === "resolve_effective_take_rate_bps") {
        return Promise.resolve({ data: [{ effective_take_rate_bps: 150, take_rate_source: "default" }], error: null });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from() {
      const chain = {
        update(payload: Record<string, unknown>) { updates.push(payload); return chain; },
        eq() { return chain; },
        insert() { return Promise.resolve({ error: null }); },
        then(resolve: (v: { data: null; error: null }) => void) { resolve({ data: null, error: null }); },
      };
      return chain;
    },
  };
  const stripe = {
    paymentIntents: {
      create(params: Record<string, unknown>) {
        stripeCalls.push(`create:${params.amount}`);
        return Promise.resolve({ id: "pi_new", status: "requires_confirmation" });
      },
      confirm() { stripeCalls.push("confirm"); return Promise.resolve({ id: "pi_new", status: "succeeded" }); },
      cancel() { stripeCalls.push("cancel"); return Promise.resolve({ id: "pi_new", status: "canceled" }); },
    },
    refunds: { create() { stripeCalls.push("refund"); return Promise.resolve({}); } },
  };
  const input = {
    installmentId: "inst_1",
    brandId: "brand_1",
    supabase: supabase as never,
    stripe: stripe as never,
    installment: {
      id: "inst_1", order_id: "order_1", ordinal: 2, amount_cents: 15000, referral_share_minor: 0,
      currency: "USD", due_at: "2026-11-20T09:00:00Z", status: "scheduled", retry_count: 0,
      schedule_version: 1, stripe_payment_intent_id: null,
    },
    order: {
      id: "order_1", event_id: "event_1", stripe_customer_id_on_connected_account: "cus_1",
      saved_payment_method_id: "pm_1", buyer_user_id: null, buyer_email: "b@example.test", at_risk: false,
    },
    brand: { id: "brand_1", contact_email: null, name: "Brand" },
    stripeAccount: { brand_id: "brand_1", stripe_account_id: "acct_1" },
  };
  return { input, rpcCalls, stripeCalls, updates };
}

Deno.test("I-4522-CHARGE-IS-WHAT-IS-OWED: the row is marked in flight for the PaymentIntent's exact amount before it is confirmed", async () => {
  resetPlanV2SchemaProbeForTests();
  const w = chargeWorld({ ok: true, marked: true });
  const result = await createInstallmentPI(w.input as never);
  assertEquals(result.outcome, "collected");
  const mark = w.rpcCalls.find((c) => c.name === "issue_4522_mark_stripe_charge_in_flight");
  assertEquals(mark?.args, {
    p_installment_id: "inst_1", p_payment_intent_id: "pi_new", p_amount_cents: 15000, p_schedule_version: 1,
  });
  assertEquals(w.stripeCalls, ["create:15000", "confirm"]);
  // the mark replaces the pre-confirm re-claim; the post-confirm claim stays
  assertEquals(w.rpcCalls.filter((c) => c.name === "claim_order_installment_for_charge").length, 2);
});

Deno.test("I-4522-CHARGE-IS-WHAT-IS-OWED: a row that changed since its amount was read is never confirmed", async () => {
  resetPlanV2SchemaProbeForTests();
  const w = chargeWorld({ ok: false, reason: "balance_changed", amount_cents: 20000, schedule_version: 2 });
  const result = await createInstallmentPI(w.input as never);
  assertEquals(result, { ok: false, error: "balance_changed", outcome: "skipped", reason: "balance_changed", chargeId: "pi_new" });
  assertEquals(w.stripeCalls, ["create:15000", "cancel"]);
  // skipped, not failed: no failure written, no retry spent, no dunning
  assertEquals(w.updates.length, 0);
});
