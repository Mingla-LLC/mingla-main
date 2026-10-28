import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { refundOneInstallment } from "../index.ts";

function fakeSupabase(pending: Record<string, unknown>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        if (name === "issue_3645_cancel_refund_installment") {
          return Promise.resolve({ data: pending, error: null });
        }
        return Promise.resolve({ data: { ok: true }, error: null });
      },
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    } as never,
  };
}

const row = {
  id: "progress-1",
  event_id: "event-1",
  source_type: "order_installment",
  source_id: "installment-1",
  provider: "paystack",
  amount_cents: 100000,
  refund_id: null,
  status: "pending",
  attempt_count: 1,
};

Deno.test("#3645 event cancel refunds a Paystack instalment and marks its own source", async () => {
  const fake = fakeSupabase({
    refund_id: "refund-1",
    order_id: "order-1",
    installment_id: "installment-1",
    provider: "paystack",
    amount_cents: 100000,
    currency: "NGN",
    source_reference: "mingla-inst-installment-1-a1",
    provider_transaction_id: "1234",
    is_full_refund: true,
    idempotent_replay: false,
  });
  const outcome = await refundOneInstallment(fake.client, "event-1", row, {
    createPaystackRefund: async () => ({
      id: "refund_ps",
      status: "processed",
      amount: 100000,
      currency: "NGN",
      integration: null,
      transaction: "1234",
      replayed: false,
    }),
  });
  assertEquals(outcome, { result: "refunded", refundId: "refund-1" });
  const recorded = fake.calls.find((call) =>
    call.name === "record_paystack_refund_outcome"
  );
  assertEquals(recorded?.args.p_source_type, "order_installment");
  assertEquals(recorded?.args.p_source_id, "installment-1");
  assertEquals(
    fake.calls.some((call) =>
      call.name === "issue_3645_mark_installment_refunded"
    ),
    true,
  );
});

Deno.test("#3645 event cancel refunds a Stripe instalment with immutable row context", async () => {
  const fake = fakeSupabase({
    refund_id: "refund-2",
    order_id: "order-1",
    installment_id: "installment-1",
    provider: "stripe",
    amount_cents: 80000,
    currency: "USD",
    source_reference: "pi_installment_1",
    stripe_charge_id: "ch_installment_1",
    application_fee_amount_cents: 3600,
    connected_account_id: "acct_brand",
    is_full_refund: true,
    idempotent_replay: false,
  });
  let input: Record<string, unknown> = {};
  const outcome = await refundOneInstallment(fake.client, "event-1", {
    ...row,
    provider: "stripe",
  }, {
    stripeTicketRefund: () =>
      ({ refunds: { create: async () => ({ id: "re_2" }) } }) as never,
    executeTicketRefundWithFeeTruth: async (value) => {
      input = value as unknown as Record<string, unknown>;
      return {
        status: "succeeded_positive",
        buyerRefundId: "re_2",
        applicationFeeRefundedCents: 3600,
        attemptId: "attempt-2",
        httpStatus: 200,
      };
    },
  });
  assertEquals(outcome, { result: "refunded", refundId: "refund-2" });
  assertEquals(input?.paymentIntentId, "pi_installment_1");
  assertEquals(input?.connectedAccountId, "acct_brand");
  assertEquals(input?.expectedApplicationFeeAmount, 3600);
});

Deno.test("#3645 below-minimum Paystack partial refund fails terminally", async () => {
  const fake = fakeSupabase({
    refund_id: "refund-3",
    order_id: "order-1",
    installment_id: "installment-1",
    provider: "paystack",
    amount_cents: 1000,
    currency: "NGN",
    source_reference: "mingla-inst-installment-1-a1",
    provider_transaction_id: null,
    is_full_refund: false,
    idempotent_replay: false,
  });
  const outcome = await refundOneInstallment(fake.client, "event-1", row);
  assertEquals(outcome.result, "failed");
  if (outcome.result !== "failed") throw new Error("expected terminal failure");
  assertEquals(
    outcome.error.startsWith("paystack_refund_below_minimum:"),
    true,
  );
  const commit = fake.calls.find((call) =>
    call.name === "admin_refund_order_commit" && call.args.p_status === "failed"
  );
  assertEquals(commit !== undefined, true);
});

Deno.test("#3645 retryable provider errors leave the instalment refund pending", async () => {
  const fake = fakeSupabase({
    refund_id: "refund-4",
    order_id: "order-1",
    installment_id: "installment-1",
    provider: "paystack",
    amount_cents: 100000,
    currency: "NGN",
    source_reference: "mingla-inst-installment-1-a1",
    provider_transaction_id: null,
    is_full_refund: true,
    idempotent_replay: false,
  });
  const outcome = await refundOneInstallment(fake.client, "event-1", row, {
    createPaystackRefund: async () => {
      throw new Error("network unavailable");
    },
  });
  assertEquals(outcome.result, "failed_retryable");
  assertEquals(
    fake.calls.some((call) =>
      call.name === "issue_3645_mark_installment_refunded"
    ),
    false,
  );
});
