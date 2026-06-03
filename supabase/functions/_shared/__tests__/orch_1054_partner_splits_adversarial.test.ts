// ORCH-1054 adversarial regression for partnerSplits.ts.
//
// Covers the failure modes that real money can fall through:
//   * charge.succeeded with no application_fee → returns no_application_fee
//     (no row written, no Transfer call).
//   * charge.succeeded for a partner with NO Stripe Connect → marks the row
//     blocked_no_stripe, never calls Stripe.
//   * charge.succeeded for a partner with WRONG settlement currency →
//     marks the row blocked_currency_mismatch, never calls Stripe.
//   * Webhook replay (prior status='transferred') → no second Transfer.
//   * Stripe Transfer permanent error (StripeInvalidRequestError) → marks
//     'failed' (no rethrow); the webhook returns 2xx so Stripe stops retrying.
//   * Stripe Transfer retryable error (StripeAPIError) → row stays pending,
//     handler RETHROWS so Stripe webhook redelivery retries.
//   * Dispute path with no charge ref → silent no-op.
//
// Run: deno test --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/orch_1054_partner_splits_adversarial.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  handleChargeReversal,
  handleChargeSucceeded,
} from "../partnerSplits.ts";

function fakeStripe(opts: {
  transferError?: { type: string; message?: string };
} = {}) {
  const calls: Array<{ kind: string; args: unknown[] }> = [];
  // deno-lint-ignore no-explicit-any
  const stripe: any = {
    transfers: {
      create: (payload: unknown, options: unknown) => {
        calls.push({ kind: "transfers.create", args: [payload, options] });
        if (opts.transferError) {
          const err = new Error(opts.transferError.message ?? "stripe err");
          // deno-lint-ignore no-explicit-any
          (err as any).type = opts.transferError.type;
          throw err;
        }
        return Promise.resolve({ id: "tr_test" });
      },
      createReversal: () => Promise.resolve({ id: "trr_test" }),
    },
    charges: {
      retrieve: () => Promise.resolve({ application_fee: null }),
    },
  };
  return { stripe, calls };
}

interface FakeState {
  partnerLookupResult?: string | null;
  partnerStripeRow?: Record<string, unknown> | null;
  orderRow?: Record<string, unknown> | null;
  ordersForBrand?: Record<string, unknown> | null;
  priorSplitStatus?: string;
}

function fakeSupabase(state: FakeState) {
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  // deno-lint-ignore no-explicit-any
  const sb: any = {
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      if (name === "resolve_partner_for_brand_at_time") {
        return Promise.resolve({
          data: state.partnerLookupResult ?? null,
          error: null,
        });
      }
      if (name === "record_partner_split_attempt") {
        return Promise.resolve({
          data: { status: state.priorSplitStatus ?? "pending" },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      const chain = {
        _table: table,
        _filters: [] as Array<[string, unknown]>,
        select: () => chain,
        eq: (col: string, val: unknown) => {
          chain._filters.push([col, val]);
          return chain;
        },
        update: () => chain,
        maybeSingle: () => {
          if (table === "orders") {
            if (chain._filters.some(([c]) => c === "stripe_payment_intent_id")) {
              return Promise.resolve({ data: state.orderRow ?? null, error: null });
            }
            return Promise.resolve({
              data: state.ordersForBrand ?? null,
              error: null,
            });
          }
          if (table === "partner_stripe_connect_accounts") {
            return Promise.resolve({
              data: state.partnerStripeRow ?? null,
              error: null,
            });
          }
          if (table === "partner_splits") {
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  };
  return { sb, rpcCalls };
}

Deno.test("charge.succeeded with NO application_fee → no_application_fee status", async () => {
  const { stripe, calls } = fakeStripe();
  const { sb, rpcCalls } = fakeSupabase({});
  const event = {
    id: "evt_x",
    type: "charge.succeeded",
    data: {
      object: {
        id: "ch_x",
        currency: "usd",
        payment_intent: "pi_x",
        created: 1,
        // application_fee absent
      },
    },
  };
  const result = await handleChargeSucceeded(sb, stripe, event);
  assertEquals(result.status, "no_application_fee");
  assertEquals(calls.length, 0);
  assertEquals(rpcCalls.length, 0);
});

Deno.test("partner with NO Stripe → blocked_no_stripe; no Transfer call", async () => {
  const { stripe, calls } = fakeStripe();
  const { sb, rpcCalls } = fakeSupabase({
    orderRow: { id: "ord_1" },
    ordersForBrand: { event_id: "evt_1", events: { brand_id: "brand_1" } },
    partnerLookupResult: "user_p1",
    partnerStripeRow: null, // ← no row at all
  });
  const event = {
    id: "evt_blocked",
    type: "charge.succeeded",
    data: {
      object: {
        id: "ch_b",
        currency: "usd",
        application_fee: "fee_b",
        application_fee_amount: 150,
        payment_intent: "pi_b",
        created: 1,
        metadata: { mingla_order_id: "ord_1" },
      },
    },
  };
  const result = await handleChargeSucceeded(sb, stripe, event);
  assertEquals(result.status, "blocked_no_stripe");
  assertEquals(calls.length, 0);
  const failed = rpcCalls.find((c) => c.name === "mark_partner_split_failed");
  assert(failed, "row should be marked failed=blocked_no_stripe");
  // deno-lint-ignore no-explicit-any
  assertEquals((failed!.args as any).p_reason, "blocked_no_stripe");
});

Deno.test("partner with wrong currency → blocked_currency_mismatch; no Transfer call", async () => {
  const { stripe, calls } = fakeStripe();
  const { sb, rpcCalls } = fakeSupabase({
    orderRow: { id: "ord_2" },
    ordersForBrand: { event_id: "evt_2", events: { brand_id: "brand_2" } },
    partnerLookupResult: "user_p2",
    partnerStripeRow: {
      account_id: "user_p2",
      stripe_account_id: "acct_p2",
      charges_enabled: true,
      payouts_enabled: true,
      external_account_currencies: ["eur"], // charge is USD → mismatch
      detached_at: null,
    },
  });
  const event = {
    id: "evt_mismatch",
    type: "charge.succeeded",
    data: {
      object: {
        id: "ch_m",
        currency: "usd",
        application_fee: "fee_m",
        application_fee_amount: 150,
        payment_intent: "pi_m",
        created: 1,
        metadata: { mingla_order_id: "ord_2" },
      },
    },
  };
  const result = await handleChargeSucceeded(sb, stripe, event);
  assertEquals(result.status, "blocked_currency_mismatch");
  assertEquals(calls.length, 0);
  const failed = rpcCalls.find((c) => c.name === "mark_partner_split_failed");
  // deno-lint-ignore no-explicit-any
  assertEquals((failed!.args as any).p_reason, "blocked_currency_mismatch");
});

Deno.test("webhook replay with prior status='transferred' → no second Transfer", async () => {
  const { stripe, calls } = fakeStripe();
  const { sb } = fakeSupabase({
    orderRow: { id: "ord_3" },
    ordersForBrand: { event_id: "evt_3", events: { brand_id: "brand_3" } },
    partnerLookupResult: "user_p3",
    partnerStripeRow: {
      account_id: "user_p3",
      stripe_account_id: "acct_p3",
      charges_enabled: true,
      payouts_enabled: true,
      external_account_currencies: ["usd"],
      detached_at: null,
    },
    priorSplitStatus: "transferred", // ← already done
  });
  const event = {
    id: "evt_replay",
    type: "charge.succeeded",
    data: {
      object: {
        id: "ch_r",
        currency: "usd",
        application_fee: "fee_r",
        application_fee_amount: 150,
        payment_intent: "pi_r",
        created: 1,
        metadata: { mingla_order_id: "ord_3" },
      },
    },
  };
  const result = await handleChargeSucceeded(sb, stripe, event);
  assertEquals(result.status, "transferred");
  assertEquals(calls.length, 0, "second Transfer must NOT be created on replay");
});

Deno.test("Stripe permanent error (StripeInvalidRequestError) → marks failed, no rethrow", async () => {
  const { stripe } = fakeStripe({
    transferError: { type: "StripeInvalidRequestError", message: "Account no longer valid" },
  });
  const { sb, rpcCalls } = fakeSupabase({
    orderRow: { id: "ord_4" },
    ordersForBrand: { event_id: "evt_4", events: { brand_id: "brand_4" } },
    partnerLookupResult: "user_p4",
    partnerStripeRow: {
      account_id: "user_p4",
      stripe_account_id: "acct_p4",
      charges_enabled: true,
      payouts_enabled: true,
      external_account_currencies: ["usd"],
      detached_at: null,
    },
  });
  const event = {
    id: "evt_perm_fail",
    type: "charge.succeeded",
    data: {
      object: {
        id: "ch_pf",
        currency: "usd",
        application_fee: "fee_pf",
        application_fee_amount: 150,
        payment_intent: "pi_pf",
        created: 1,
        metadata: { mingla_order_id: "ord_4" },
      },
    },
  };
  const result = await handleChargeSucceeded(sb, stripe, event);
  assertEquals(result.status, "failed");
  const failed = rpcCalls.find((c) => c.name === "mark_partner_split_failed");
  assert(failed, "should mark failed on permanent error");
});

Deno.test("Stripe retryable error → handler rethrows so webhook redelivers", async () => {
  const { stripe } = fakeStripe({
    transferError: { type: "StripeAPIError", message: "API down" },
  });
  const { sb } = fakeSupabase({
    orderRow: { id: "ord_5" },
    ordersForBrand: { event_id: "evt_5", events: { brand_id: "brand_5" } },
    partnerLookupResult: "user_p5",
    partnerStripeRow: {
      account_id: "user_p5",
      stripe_account_id: "acct_p5",
      charges_enabled: true,
      payouts_enabled: true,
      external_account_currencies: ["usd"],
      detached_at: null,
    },
  });
  const event = {
    id: "evt_retryable",
    type: "charge.succeeded",
    data: {
      object: {
        id: "ch_rt",
        currency: "usd",
        application_fee: "fee_rt",
        application_fee_amount: 150,
        payment_intent: "pi_rt",
        created: 1,
        metadata: { mingla_order_id: "ord_5" },
      },
    },
  };
  await assertRejects(
    () => handleChargeSucceeded(sb, stripe, event),
    Error,
    "API down",
  );
});

Deno.test("dispute with no charge ref → silent no-op", async () => {
  const { stripe, calls } = fakeStripe();
  const { sb, rpcCalls } = fakeSupabase({});
  const event = {
    id: "evt_dispute_noref",
    type: "charge.dispute.created",
    data: { object: { id: "dp_x" /* no charge field */ } },
  };
  await handleChargeReversal(sb, stripe, event, "dispute");
  assertEquals(calls.length, 0);
  assertEquals(rpcCalls.length, 0);
});

Deno.test("partner_account_id pinned to charge time — uses charge.created not now()", async () => {
  // We assert the args passed to resolve_partner_for_brand_at_time include
  // the ISO-translated charge.created, NOT a wall-clock now.
  const { stripe } = fakeStripe();
  const { sb, rpcCalls } = fakeSupabase({
    orderRow: { id: "ord_t" },
    ordersForBrand: { event_id: "evt_t", events: { brand_id: "brand_t" } },
    partnerLookupResult: null, // doesn't matter — just want to see the args
  });
  const chargeCreatedUnix = 1_600_000_000;
  const expectedIso = new Date(chargeCreatedUnix * 1000).toISOString();
  const event = {
    id: "evt_time",
    type: "charge.succeeded",
    data: {
      object: {
        id: "ch_t",
        currency: "usd",
        application_fee: "fee_t",
        application_fee_amount: 100,
        payment_intent: "pi_t",
        created: chargeCreatedUnix,
        metadata: { mingla_order_id: "ord_t" },
      },
    },
  };
  await handleChargeSucceeded(sb, stripe, event);
  const resolveCall = rpcCalls.find((c) =>
    c.name === "resolve_partner_for_brand_at_time"
  );
  assert(resolveCall);
  // deno-lint-ignore no-explicit-any
  assertEquals((resolveCall!.args as any).p_at, expectedIso);
});
