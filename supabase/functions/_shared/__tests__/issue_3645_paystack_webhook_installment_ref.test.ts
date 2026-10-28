// Issue #3645 — charge.success for an instalment reference (SC-15..SC-19).
// Fails on revert: removing the refund_due branch in
// handleInstallmentPaystackCharge makes "duplicate payment is refunded" fail.
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { handlePaystackChargeSuccess } from "../paystackWebhookRouter.ts";
import { isInstallmentPaystackReference } from "../installments/paystackInstallmentWebhook.ts";
import { fakeSupabase, ok, type TableOp } from "../installments/__tests__/issue_3645_fake_supabase.ts";

const INST = "44444444-4444-4444-8444-444444444444";
const REF = `mingla-inst-${INST}-l2`;

function txn(over: Record<string, unknown> = {}) {
  return {
    status: "success", amount: 270_625, currency: "NGN", id: 5550001, fees: 4060, gateway_response: "Approved",
    reference: REF, channel: "card", customer: { email: "payer@example.test" },
    authorization: { authorization_code: "AUTH_paylink", reusable: true, channel: "card", last4: "4081" },
    ...over,
  };
}

function harness(resolve: Record<string, unknown>, opts: { attempt?: Record<string, unknown> | null } = {}) {
  const emails: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const refunds: Array<Record<string, unknown>> = [];
  const alerts: string[] = [];
  const attempt = opts.attempt === undefined
    ? { id: "att-2", installment_id: INST, method: "pay_link", state: "created", amount_cents: 270_625, reference: REF,
      provider_transaction_id: null }
    : opts.attempt;
  let attemptState = String(attempt?.state ?? "");
  const fake = fakeSupabase({
    rpc: (name) => {
      if (name === "issue_3645_resolve_installment_attempt") {
        if (resolve.outcome === "refund_due") attemptState = "refund_due";
        return ok(resolve);
      }
      return ok({ ok: true });
    },
    table: (op: TableOp) => {
      if (op.table === "order_installment_charge_attempts" && op.kind === "select") {
        return ok(attempt === null ? null : { ...attempt, state: attemptState, provider_transaction_id: "5550001" });
      }
      if (op.table === "order_installments") return ok({ id: INST, order_id: "order-1", currency: "NGN" });
      if (op.table === "refunds" && op.kind === "insert") return ok({ id: "refund-dup" });
      return ok(null);
    },
  });
  const deps = {
    dispatchBuyerEmail: (kind: string, payload: Record<string, unknown>) => {
      emails.push({ kind, payload });
      return Promise.resolve(true);
    },
    createPaystackRefund: (p: Record<string, unknown>) => {
      refunds.push(p);
      return Promise.resolve({ id: "rf_9", amount: 270_625, status: "processed", currency: "NGN", integration: null,
        transaction: "5550001", replayed: false });
    },
    alertOps: (subject: string) => {
      alerts.push(subject);
      return Promise.resolve();
    },
  };
  const run = (t = txn()) => handlePaystackChargeSuccess(fake.client as never, { reference: REF }, () => Promise.resolve(t), deps as never);
  return { fake, emails, refunds, alerts, run };
}

Deno.test("#3645 instalment references are recognised; session references are not", () => {
  assert(isInstallmentPaystackReference(REF));
  assert(isInstallmentPaystackReference(`mingla-inst-${INST}-a12`));
  assert(!isInstallmentPaystackReference(`mingla_${INST}`));
  assert(!isInstallmentPaystackReference(`mingla-inst-${INST}-x1`));
});

Deno.test("#3645 SC-15 pay link paid: collected from the verified amount and fees, no ticket finalize", async () => {
  const h = harness({ ok: true, outcome: "collected", remaining: 1, order_id: "order-1" });
  const r = await h.run();
  assertEquals(r.status, "installment_collected");
  const resolve = h.fake.rpcCalls.find((c) => c.name === "issue_3645_resolve_installment_attempt")!;
  assertEquals(resolve.args.p_outcome, "succeeded");
  assertEquals(resolve.args.p_verified_amount_cents, 270_625);
  assertEquals(resolve.args.p_provider_fee_cents, 4060);
  assertEquals(resolve.args.p_provider_transaction_id, "5550001");
  assert(!h.fake.rpcCalls.some((c) => c.name === "biz_ticket_checkout_finalize"));
  assert(!h.fake.tableOps.some((op) => op.table === "ticket_checkout_sessions"));
});

Deno.test("#3645 SC-17 paying a pay link by a reusable card upgrades later payments", async () => {
  const h = harness({ ok: true, outcome: "collected", remaining: 1, order_id: "order-1" });
  await h.run();
  const bind = h.fake.rpcCalls.find((c) => c.name === "issue_3645_paystack_plan_bind")!;
  assertEquals(bind.args.p_upgrade, true);
  assertEquals((bind.args.p_authorization as Record<string, unknown>).reusable, true);
  // A bank-transfer payment never upgrades.
  const bank = harness({ ok: true, outcome: "collected", remaining: 1, order_id: "order-1" });
  await bank.run(txn({ channel: "bank_transfer", authorization: { reusable: false, channel: "bank_transfer" } }));
  const b = bank.fake.rpcCalls.find((c) => c.name === "issue_3645_paystack_plan_bind");
  assertEquals(b === undefined || (b.args.p_authorization as Record<string, unknown>).reusable === false, true);
});

Deno.test("#3645 last payment: paid-in-full email", async () => {
  const h = harness({ ok: true, outcome: "collected", remaining: 0, order_id: "order-1" });
  await h.run();
  assert(h.emails.some((e) => e.kind === "installment_plan_paid_in_full" && e.payload.orderId === "order-1"));
});

Deno.test("#3645 SC-19 duplicate payment (already collected) is refunded in full automatically", async () => {
  const h = harness({ ok: true, outcome: "refund_due", reason: "installment_collected" });
  const r = await h.run();
  assertEquals(r.status, "installment_refund_due");
  assertEquals(h.refunds.length, 1);
  assertEquals(h.refunds[0].merchantNote, "mingla_inst_dup:att-2");
  assertEquals(h.refunds[0].amountSubunits, undefined); // full refund
  const outcome = h.fake.rpcCalls.find((c) => c.name === "record_paystack_refund_outcome")!;
  assertEquals(outcome.args.p_source_type, "order_installment");
  assertEquals(outcome.args.p_status, "processed");
  const refundRow = h.fake.tableOps.find((op) => op.table === "refunds" && op.kind === "insert")!;
  assertEquals(refundRow.values!.order_installment_id, INST);
  assert(h.emails.some((e) => e.kind === "installment_duplicate_refunded"));
});

Deno.test("#3645 SC-19 a success on a cancelled instalment is refunded too", async () => {
  const h = harness({ ok: true, outcome: "refund_due", reason: "installment_cancelled" });
  await h.run();
  assertEquals(h.refunds.length, 1);
});

Deno.test("#3645 amount mismatch: ops alerted, nothing collected or refunded", async () => {
  const h = harness({ ok: false, reason: "amount_mismatch" });
  const r = await h.run(txn({ amount: 1 }));
  assertEquals(r.status, "amount_mismatch");
  assertEquals(h.refunds.length, 0);
  assertEquals(h.alerts.length, 1);
});

Deno.test("#3645 wrong currency is never accepted as the attempt's amount", async () => {
  const h = harness({ ok: false, reason: "amount_mismatch" });
  await h.run(txn({ currency: "GHS" }));
  const resolve = h.fake.rpcCalls.find((c) => c.name === "issue_3645_resolve_installment_attempt")!;
  assertEquals(resolve.args.p_verified_amount_cents, null);
});

Deno.test("#3645 unknown instalment reference: orphan, audited, nothing resolved", async () => {
  const h = harness({ ok: true, outcome: "collected" }, { attempt: null });
  const r = await h.run();
  assertEquals(r.status, "orphan");
  assert(!h.fake.rpcCalls.some((c) => c.name === "issue_3645_resolve_installment_attempt"));
});

Deno.test("#3645 replayed success: no second refund, no email", async () => {
  const h = harness({ ok: true, outcome: "replayed" });
  const r = await h.run();
  assertEquals(r.status, "installment_replayed");
  assertEquals(h.refunds.length + h.emails.length, 0);
});
