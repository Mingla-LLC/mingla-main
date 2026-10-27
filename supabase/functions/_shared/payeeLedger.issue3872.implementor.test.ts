import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handlePayeePaystackTransferEvent,
  handlePayeeStripeRefund,
  handlePayeeStripeTransferReversed,
  reversePayeeShareAfterStripeMoneyLoss,
  syncPayeeStripeAccount,
} from "./payeeLedger.ts";

Deno.test("#3872 Stripe payee reversal uses the exact share/refund idempotency identity", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let reversalCall: Record<string, unknown> | null = null;
  const supabase = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "payee_share_reverse") {
        return Promise.resolve({
          data: {
            outcome: "reversed",
            shareId: "share-1",
            providerTransferId: "tr_payee",
            providerReversalMinor: 425,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: {}, error: null });
    },
  };
  const stripe = {
    transfers: {
      createReversal(
        transferId: string,
        body: Record<string, unknown>,
        options: Record<string, unknown>,
      ) {
        reversalCall = { transferId, body, options };
        return Promise.resolve({ id: "trr_payee" });
      },
    },
  };
  const result = await reversePayeeShareAfterStripeMoneyLoss(
    supabase as never,
    stripe as never,
    { orderId: "order-1", reference: "refund:re_1", eligibleMinor: 500 },
  );
  assertObjectMatch(reversalCall ?? {}, {
    transferId: "tr_payee",
    options: { idempotencyKey: "payee_reversal:share-1:refund:re_1" },
  });
  assertEquals(result.providerReversalId, "trr_payee");
  assertEquals(rpcCalls.at(-1)?.name, "payee_record_stripe_transfer_reversal");
  assertObjectMatch(rpcCalls.at(-1)?.args ?? {}, {
    p_share_id: "share-1",
    p_provider_reversal_id: "trr_payee",
    p_amount_minor: 425,
  });
});

Deno.test("#3872 transfer.reversed remains idempotent when Stripe omits expanded reversals", async () => {
  let recorded: Record<string, unknown> | null = null;
  await handlePayeeStripeTransferReversed({
    rpc(_name: string, args: Record<string, unknown>) {
      recorded = args;
      return Promise.resolve({ data: {}, error: null });
    },
  } as never, { id: "tr_payee", amount_reversed: 700 });
  assertObjectMatch(recorded ?? {}, {
    p_transfer_id: "tr_payee",
    p_reversal_id: "stripe:tr_payee:700",
    p_amount_minor: 700,
  });
});

Deno.test("#3872 transfer.reversed uses the newest expanded reversal with the cumulative amount", async () => {
  let recorded: Record<string, unknown> | null = null;
  await handlePayeeStripeTransferReversed({
    rpc(_name: string, args: Record<string, unknown>) {
      recorded = args;
      return Promise.resolve({ data: {}, error: null });
    },
  } as never, {
    id: "tr_payee",
    amount_reversed: 900,
    reversals: { data: [{ id: "trr_new" }, { id: "trr_old" }] },
  });
  assertObjectMatch(recorded ?? {}, {
    p_transfer_id: "tr_payee",
    p_reversal_id: "trr_new",
    p_amount_minor: 900,
  });
});

Deno.test("#3872 successful refund resolves the order and reverses only eligible money", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const supabase = {
    from(table: string) {
      assertEquals(table, "orders");
      return {
        select() {
          return {
            eq(column: string, value: string) {
              assertEquals(column, "stripe_payment_intent_id");
              assertEquals(value, "pi_payee");
              return {
                maybeSingle: () =>
                  Promise.resolve({ data: { id: "order-1" }, error: null }),
              };
            },
          };
        },
      };
    },
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve({ data: { outcome: "reversed" }, error: null });
    },
  };
  await handlePayeeStripeRefund(supabase as never, { transfers: {} } as never, {
    id: "re_payee",
    status: "succeeded",
    amount: 1250,
    payment_intent: "pi_payee",
  });
  assertEquals(calls.length, 1);
  assertObjectMatch(calls[0].args, {
    p_order_kind: "ticket",
    p_order_id: "order-1",
    p_refund_ref: "refund:re_payee",
    p_refunded_eligible_minor: 1250,
  });
});

Deno.test("#3872 account.updated synchronizes only the matching payee account", async () => {
  let update: Record<string, unknown> | null = null;
  let match: [string, string] | null = null;
  await syncPayeeStripeAccount({
    from(table: string) {
      assertEquals(table, "payee_accounts");
      return {
        update(value: Record<string, unknown>) {
          update = value;
          return {
            eq(column: string, id: string) {
              match = [column, id];
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as never, {
    id: "acct_payee",
    country: "ng",
    charges_enabled: true,
    payouts_enabled: true,
    requirements: { currently_due: [], past_due: [] },
  });
  assertObjectMatch(update ?? {}, {
    stripe_status: "active",
    stripe_country: "NG",
  });
  assertEquals(match, ["stripe_account_id", "acct_payee"]);
});

Deno.test("#3872 Paystack webhook adapter ignores non-payee references", async () => {
  let calls = 0;
  const supabase = {
    rpc() {
      calls++;
      return Promise.resolve({ data: {}, error: null });
    },
  };
  await handlePayeePaystackTransferEvent(
    supabase as never,
    "transfer.success",
    { reference: "partner_123" },
  );
  await handlePayeePaystackTransferEvent(
    supabase as never,
    "transfer.success",
    {
      reference: "mpay_payout_a0",
      transfer_code: "TRF_payee",
    },
  );
  assertEquals(calls, 1);
});
