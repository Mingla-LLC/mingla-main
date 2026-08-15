import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { executeTicketRefundWithFeeTruth } from "../issue2097TicketRefundTruth.ts";

const migration = Deno.readTextFileSync(
  "supabase/migrations/20270412002097_issue_2097_stripe_fee_refund_truth.sql",
);

function pendingFixture(options: { expectedFee: number; feeIdentity: string | null }) {
  const rpcCalls: string[] = [];
  let refundCreates = 0;
  let feeReads = 0;
  const supabase = {
    rpc: async (name: string) => {
      rpcCalls.push(name);
      if (name === "issue_2097_prepare_refund_attempt") {
        return {
          data: {
            attempt_id: "attempt_1",
            status: "awaiting_application_fee",
            provider_call_permitted: true,
            idempotent_replay: false,
            lease_epoch: 1,
          },
          error: null,
        };
      }
      if (name === "issue_2097_record_pre_refund_state") {
        return {
          data: {
            attempt_id: "attempt_1",
            status: "awaiting_application_fee",
            provider_call_permitted: false,
            idempotent_replay: false,
          },
          error: null,
        };
      }
      return { data: { status: "pending_visibility" }, error: null };
    },
    from: () => {
      throw new Error("unexpected table lookup");
    },
  };
  const stripe = {
    paymentIntents: {
      retrieve: async () => ({
        latest_charge: {
          id: "ch_1",
          amount_captured: 100,
          application_fee: options.feeIdentity,
          livemode: false,
        },
      }),
    },
    charges: { retrieve: async () => { throw new Error("unexpected charge lookup"); } },
    applicationFees: {
      retrieve: async () => ({
        id: "fee_1",
        amount: options.expectedFee,
        amount_refunded: feeReads++ === 0 ? 0 : 0,
        currency: "usd",
        charge: "ch_1",
        account: "acct_1",
        livemode: false,
      }),
      listRefunds: async () => ({ data: [], has_more: false }),
    },
    refunds: {
      create: async () => {
        refundCreates += 1;
        return { id: "re_1", amount: 100 };
      },
    },
  };
  return { supabase, stripe, rpcCalls, refundCreates: () => refundCreates };
}

Deno.test("#2097 tester: provider-proven no-fee truth waits for the bounded oracle before mutation", async () => {
  const fixture = pendingFixture({ expectedFee: 0, feeIdentity: null });
  const result = await executeTicketRefundWithFeeTruth({
    supabase: fixture.supabase as never,
    stripe: fixture.stripe as never,
    refundId: "refund_1",
    orderId: "order_1",
    paymentIntentId: "pi_1",
    connectedAccountId: "acct_1",
    expectedCurrency: "usd",
    expectedApplicationFeeAmount: 0,
    requestedRefundAmount: 100,
    requestFingerprint: "same",
  });
  assertEquals(result.status, "awaiting_application_fee");
  assertEquals(fixture.refundCreates(), 0, "the first missing-Fee observation must not create a buyer Refund");
});

Deno.test("#2097 tester: a pending post-refund observation is durably scheduled", async () => {
  const fixture = pendingFixture({ expectedFee: 25, feeIdentity: "fee_1" });
  const result = await executeTicketRefundWithFeeTruth({
    supabase: fixture.supabase as never,
    stripe: fixture.stripe as never,
    refundId: "refund_1",
    orderId: "order_1",
    paymentIntentId: "pi_1",
    connectedAccountId: "acct_1",
    expectedCurrency: "usd",
    expectedApplicationFeeAmount: 25,
    requestedRefundAmount: 100,
    requestFingerprint: "same",
  });
  assertEquals(result.status, "pending_visibility");
  assert(
    fixture.rpcCalls.length >= 3 &&
      fixture.rpcCalls.at(-1) !== "issue_2097_record_buyer_refund",
    "the no-object observation must be committed after buyer-refund quarantine instead of returning from memory",
  );
});

Deno.test("#2097 tester: due-time and later Fee-identity conflict are enforced in the database owner", () => {
  assert(
    /next_observation_at\s+IS\s+NOT\s+NULL[\s\S]{0,240}next_observation_at\s*>\s*now\(\)/i.test(migration) &&
      migration.includes("retry_not_due"),
    "claim/recovery must reject observations before their durable next-observation timestamp",
  );
  assert(
    /IF\s+p_status\s*=\s*'application_fee_conflict'[\s\S]{0,500}status\s*=\s*'application_fee_conflict'/i.test(migration),
    "an awaiting attempt must become application_fee_conflict when a later authentic read conflicts",
  );
});

Deno.test("#2097 tester: nonterminal fee truth stops outer refund side effects", () => {
  for (const [path, downstreamMutation] of [
    ["supabase/functions/refund-order/index.ts", "tax.transactions.createReversal"],
    ["supabase/functions/admin-refund-order/index.ts", "tax.transactions.createReversal"],
    ["supabase/functions/event-cancel-refund-fanout/index.ts", "tax.transactions.createReversal"],
  ] as const) {
    const source = Deno.readTextFileSync(path);
    const resolver = source.indexOf("executeTicketRefundWithFeeTruth({");
    const mutation = source.indexOf(downstreamMutation, resolver);
    assert(resolver >= 0 && mutation > resolver, `${path} fixture could not locate the refund boundary`);
    const between = source.slice(resolver, mutation);
    assert(
      /if\s*\(\s*stripeFeeTruth[\s\S]*?return/.test(between),
      `${path} must return the typed nonterminal result before tax, audit, notification, or local completion work`,
    );
  }
});
