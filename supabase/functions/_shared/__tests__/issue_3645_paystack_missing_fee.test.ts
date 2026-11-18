// Issue #3645 — a Paystack instalment payment whose answer carries no fee is
// never recorded with fee 0 (that netted the host's payout without Paystack's
// fee and overpaid them now that instalment payouts are on). The fee goes to
// the resolver as null, and the instalment waits until the sweep reads it.
// Fails on revert: restoring `: 0` / `data.fees ?? 0` sends 0 instead of null.
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { handlePaystackChargeSuccess } from "../paystackWebhookRouter.ts";
import { classifyPaystackChargeResponse, paystackFeeOrNull } from "../paystack.ts";
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


for (const [label, fees] of [["missing", undefined], ["null", null], ["empty", ""], ["not a number", "n/a"]] as const) {
  Deno.test(`#3645 a ${label} Paystack fee reaches the resolver as unknown (null), never 0`, async () => {
    const h = harness({ ok: true, outcome: "collected", remaining: 1, order_id: "order-1" });
    const t = txn();
    if (fees === undefined) delete (t as Record<string, unknown>).fees;
    else (t as Record<string, unknown>).fees = fees;
    await h.run(t);
    const resolve = h.fake.rpcCalls.find((c) => c.name === "issue_3645_resolve_installment_attempt")!;
    assertEquals(resolve.args.p_provider_fee_cents, null);
  });
}

Deno.test("#3645 a present Paystack fee is passed as-is (including a real 0)", async () => {
  for (const fees of [4060, "4060", 0]) {
    const h = harness({ ok: true, outcome: "collected", remaining: 1, order_id: "order-1" });
    await h.run(txn({ fees }));
    const resolve = h.fake.rpcCalls.find((c) => c.name === "issue_3645_resolve_installment_attempt")!;
    assertEquals(resolve.args.p_provider_fee_cents, Number(fees));
  }
});

Deno.test("#3645 a stored-card charge answer without fees classifies with an unknown fee", () => {
  const r = (body: unknown) => ({ kind: "response" as const, httpStatus: 200, body });
  const missing = classifyPaystackChargeResponse(r({ status: true, data: { status: "success", id: 1, amount: 100 } }));
  assertEquals(missing.outcome === "succeeded" && missing.feesSubunits, null);
  const present = classifyPaystackChargeResponse(r({ status: true, data: { status: "success", id: 1, amount: 100, fees: 15 } }));
  assertEquals(present.outcome === "succeeded" && present.feesSubunits, 15);
  assertEquals(paystackFeeOrNull(undefined), null);
  assertEquals(paystackFeeOrNull(-5), null);
  assertEquals(paystackFeeOrNull("12.9"), 12);
});
