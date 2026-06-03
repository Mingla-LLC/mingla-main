// ORCH-1054 happy-path regression for partnerSplits.ts.
//
// Covers:
//   * charge.succeeded with a flagged partner + matching currency →
//     Stripe Transfer created with source-currency + Idempotency-Key, and
//     mark_partner_split_transferred is called.
//   * charge.succeeded with no partner → returns no_partner, no Transfer call.
//   * charge.refunded with an already-transferred split → TransferReversal
//     created with idempotency key partner_split_reversal_<af_id>.
//   * account.updated for a known partner stripe_account_id → populates
//     external_account_currencies + charges/payouts/requirements/capabilities.
//
// Run: deno test --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/orch_1054_partner_splits_happy.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  handleChargeReversal,
  handleChargeSucceeded,
  PARTNER_SHARE_OF_FEE,
  syncPartnerAccountFromEvent,
} from "../partnerSplits.ts";

// ---------- Fake Stripe client ----------
function fakeStripe(opts: {
  failTransfer?: { type?: string; message?: string };
} = {}) {
  const calls: Array<{ kind: string; args: unknown[] }> = [];
  const stripe = {
    transfers: {
      create: (payload: unknown, options: unknown) => {
        calls.push({ kind: "transfers.create", args: [payload, options] });
        if (opts.failTransfer) {
          const err = new Error(opts.failTransfer.message ?? "boom");
          // deno-lint-ignore no-explicit-any
          (err as any).type = opts.failTransfer.type;
          throw err;
        }
        return Promise.resolve({ id: "tr_test_abc" });
      },
      createReversal: (
        transferId: string,
        payload: unknown,
        options: unknown,
      ) => {
        calls.push({
          kind: "transfers.createReversal",
          args: [transferId, payload, options],
        });
        return Promise.resolve({ id: "trr_test_xyz" });
      },
    },
    charges: {
      retrieve: (_id: string, _opts: unknown) => {
        calls.push({ kind: "charges.retrieve", args: [_id, _opts] });
        return Promise.resolve({ application_fee: "fee_test_dispute" });
      },
    },
  };
  // deno-lint-ignore no-explicit-any
  return { stripe: stripe as any, calls };
}

// ---------- Fake Supabase ----------
interface FakeState {
  partnerLookupResult?: string | null;
  partnerStripeRow?: Record<string, unknown> | null;
  orderRow?: Record<string, unknown> | null;
  ordersForBrand?: Record<string, unknown> | null;
  priorSplitStatus?: string;
  partnerSplitsRow?: Record<string, unknown> | null;
  partnerAccountLookupRow?: Record<string, unknown> | null;
}

function fakeSupabase(state: FakeState) {
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const fromCalls: Array<{ table: string; op: string; args: unknown }> = [];
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
        select: (_cols: string) => chain,
        eq: (col: string, val: unknown) => {
          chain._filters.push([col, val]);
          return chain;
        },
        update: (payload: unknown) => {
          fromCalls.push({ table, op: "update", args: payload });
          // After update we still chain .eq()
          return chain;
        },
        maybeSingle: () => {
          fromCalls.push({ table, op: "maybeSingle", args: chain._filters });
          if (table === "orders") {
            // Two shapes are queried: by stripe_payment_intent_id (returns id)
            // and by id (returns event_id + events join).
            if (chain._filters.some(([c]) => c === "stripe_payment_intent_id")) {
              return Promise.resolve({
                data: state.orderRow ?? null,
                error: null,
              });
            }
            return Promise.resolve({
              data: state.ordersForBrand ?? null,
              error: null,
            });
          }
          if (table === "partner_stripe_connect_accounts") {
            // Two shapes: by account_id (partner stripe lookup) and by
            // stripe_account_id (syncPartnerAccountFromEvent).
            if (chain._filters.some(([c]) => c === "account_id")) {
              return Promise.resolve({
                data: state.partnerStripeRow ?? null,
                error: null,
              });
            }
            return Promise.resolve({
              data: state.partnerAccountLookupRow ?? null,
              error: null,
            });
          }
          if (table === "partner_splits") {
            return Promise.resolve({
              data: state.partnerSplitsRow ?? null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  };
  return { sb, rpcCalls, fromCalls };
}

Deno.test("PARTNER_SHARE_OF_FEE constant = 10% of the application fee", () => {
  assertEquals(PARTNER_SHARE_OF_FEE, 0.10);
});

Deno.test("charge.succeeded → resolves partner + creates Transfer with zero-FX currency", async () => {
  const { stripe, calls } = fakeStripe();
  const { sb, rpcCalls } = fakeSupabase({
    orderRow: { id: "ord_1" },
    ordersForBrand: { event_id: "evt_1", events: { brand_id: "brand_1" } },
    partnerLookupResult: "user_partner_1",
    partnerStripeRow: {
      account_id: "user_partner_1",
      stripe_account_id: "acct_partner_test",
      charges_enabled: true,
      payouts_enabled: true,
      external_account_currencies: ["usd", "eur"],
      detached_at: null,
    },
  });

  const event = {
    id: "evt_charge_succeeded_1",
    type: "charge.succeeded",
    data: {
      object: {
        id: "ch_test_1",
        currency: "usd", // SOURCE currency
        application_fee: "fee_test_1",
        application_fee_amount: 150, // 1.5% of $100 = 150c
        payment_intent: "pi_test_1",
        created: 1_700_000_000,
        metadata: { mingla_order_id: "ord_1" },
      },
    },
  };

  const result = await handleChargeSucceeded(sb, stripe, event);
  assertEquals(result.status, "transferred");
  assertEquals(result.brandId, "brand_1");

  // Stripe Transfer created with source currency + Idempotency-Key.
  const transferCall = calls.find((c) => c.kind === "transfers.create");
  assert(transferCall, "Transfer should have been created");
  // deno-lint-ignore no-explicit-any
  const [payload, options] = transferCall!.args as [any, any];
  assertEquals(payload.amount, 15); // round(150 * 0.10) = 15
  assertEquals(payload.currency, "usd"); // ZERO FX
  assertEquals(payload.destination, "acct_partner_test");
  assertEquals(payload.source_transaction, "ch_test_1");
  assertEquals(payload.metadata.mingla_application_fee_id, "fee_test_1");
  assertEquals(options.idempotencyKey, "partner_split_fee_test_1");

  // RPC chain: resolve → record → mark_transferred.
  const rpcNames = rpcCalls.map((c) => c.name);
  assertEquals(rpcNames[0], "resolve_partner_for_brand_at_time");
  assert(rpcNames.includes("record_partner_split_attempt"));
  assert(rpcNames.includes("mark_partner_split_transferred"));
});

Deno.test("charge.succeeded with no partner → no Transfer, no record", async () => {
  const { stripe, calls } = fakeStripe();
  const { sb, rpcCalls } = fakeSupabase({
    orderRow: { id: "ord_2" },
    ordersForBrand: { event_id: "evt_2", events: { brand_id: "brand_2" } },
    partnerLookupResult: null, // ← no partner
  });

  const event = {
    id: "evt_charge_succeeded_2",
    type: "charge.succeeded",
    data: {
      object: {
        id: "ch_test_2",
        currency: "usd",
        application_fee: "fee_test_2",
        application_fee_amount: 150,
        payment_intent: "pi_test_2",
        created: 1_700_000_000,
        metadata: { mingla_order_id: "ord_2" },
      },
    },
  };

  const result = await handleChargeSucceeded(sb, stripe, event);
  assertEquals(result.status, "no_partner");
  assertEquals(calls.length, 0); // no Stripe calls
  assert(
    !rpcCalls.some((c) => c.name === "record_partner_split_attempt"),
    "no row recorded when no partner present",
  );
});

Deno.test("charge.refunded with transferred split → TransferReversal w/ idempotency-key", async () => {
  const { stripe, calls } = fakeStripe();
  const { sb, rpcCalls } = fakeSupabase({
    partnerSplitsRow: {
      id: "split_1",
      status: "transferred",
      stripe_transfer_id: "tr_test_abc",
      partner_share_cents: 15,
    },
  });

  const event = {
    id: "evt_refund_1",
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_test_1",
        application_fee: "fee_test_1",
      },
    },
  };

  await handleChargeReversal(sb, stripe, event, "refund");

  const reversal = calls.find((c) => c.kind === "transfers.createReversal");
  assert(reversal, "TransferReversal should be created");
  // deno-lint-ignore no-explicit-any
  const [transferId, _payload, options] = reversal!.args as [string, any, any];
  assertEquals(transferId, "tr_test_abc");
  assertEquals(options.idempotencyKey, "partner_split_reversal_fee_test_1");
  assert(rpcCalls.some((c) => c.name === "mark_partner_split_reversed"));
});

Deno.test("charge.refunded with pending split → marks reversed_pending, no Stripe call", async () => {
  const { stripe, calls } = fakeStripe();
  const { sb, rpcCalls } = fakeSupabase({
    partnerSplitsRow: {
      id: "split_2",
      status: "pending",
      stripe_transfer_id: null,
      partner_share_cents: 15,
    },
  });

  const event = {
    id: "evt_refund_2",
    type: "charge.refunded",
    data: {
      object: { id: "ch_test_2", application_fee: "fee_test_2" },
    },
  };

  await handleChargeReversal(sb, stripe, event, "refund");

  assertEquals(calls.length, 0); // no Stripe calls (nothing transferred)
  const reverseCall = rpcCalls.find((c) => c.name === "mark_partner_split_reversed");
  assert(reverseCall, "RPC should still mark the row reversed_pending");
});

Deno.test("account.updated for known partner stripe_account_id → populates currencies", async () => {
  const { stripe } = fakeStripe();
  const { sb, fromCalls } = fakeSupabase({
    partnerAccountLookupRow: { account_id: "user_partner_1" },
  });

  const account = {
    id: "acct_partner_test",
    charges_enabled: true,
    payouts_enabled: true,
    requirements: { currently_due: [] },
    capabilities: { transfers: "active" },
    external_accounts: {
      data: [
        { currency: "USD" },
        { currency: "USD" }, // dup → dedupe
        { currency: "eur" },
      ],
    },
  };

  const updated = await syncPartnerAccountFromEvent(sb, account);
  assertEquals(updated, true);

  const updateCall = fromCalls.find((c) =>
    c.table === "partner_stripe_connect_accounts" && c.op === "update"
  );
  assert(updateCall, "update should have been called");
  // deno-lint-ignore no-explicit-any
  const payload = updateCall!.args as any;
  assertEquals(payload.external_account_currencies, ["eur", "usd"]); // sorted+lowered
  assertEquals(payload.charges_enabled, true);
  assertEquals(payload.payouts_enabled, true);

  // Silence unused warning.
  assert(stripe);
});

Deno.test("account.updated for unknown stripe_account_id → no-op (returns false)", async () => {
  const { sb } = fakeSupabase({ partnerAccountLookupRow: null });
  const updated = await syncPartnerAccountFromEvent(sb, {
    id: "acct_not_a_partner",
    external_accounts: { data: [{ currency: "usd" }] },
  });
  assertEquals(updated, false);
});

Deno.test("Math.round (not floor) on partner share — protects against cent loss", async () => {
  // 1.5% of $9.95 = 14.925c application fee. 10% of that = 1.4925 → round = 1.
  // But Stripe sends integer application_fee_amount, so test with 149c:
  //   round(149 * 0.10) = 15 (NOT 14 as floor would).
  const { stripe, calls } = fakeStripe();
  const { sb } = fakeSupabase({
    orderRow: { id: "ord_3" },
    ordersForBrand: { event_id: "evt_3", events: { brand_id: "brand_3" } },
    partnerLookupResult: "user_partner_2",
    partnerStripeRow: {
      account_id: "user_partner_2",
      stripe_account_id: "acct_p2",
      charges_enabled: true,
      payouts_enabled: true,
      external_account_currencies: ["usd"],
      detached_at: null,
    },
  });
  const event = {
    id: "evt_x",
    type: "charge.succeeded",
    data: {
      object: {
        id: "ch_x",
        currency: "usd",
        application_fee: "fee_x",
        application_fee_amount: 149,
        payment_intent: "pi_x",
        created: 1_700_000_000,
        metadata: { mingla_order_id: "ord_3" },
      },
    },
  };
  await handleChargeSucceeded(sb, stripe, event);
  // deno-lint-ignore no-explicit-any
  const [payload] = calls[0].args as [any, any];
  assertEquals(payload.amount, 15, "Math.round(149*0.10)=15 — not 14 (floor)");
});
