// Implementor-owned regression for issue #1174 P0-1 (QA RETEST 3) — the
// post-provider ledger-commit boundary.
//
// Before the fix: after Stripe accepted the partner transfer the adapter marked
// the split 'transferred' via one RPC and then issued a SEPARATE direct
// payout_transfer_legs update. If that second write failed the adapter reported
// the outcome as retryable even though the split was already terminally marked
// and could never be re-selected, stranding a moved transfer against a
// permanently 'planned' leg.
//
// After the fix: one idempotent RPC (settle_partner_split_transfer) commits both
// the split marker and its normalized leg atomically. A post-provider database
// failure rolls BOTH back, so the split stays selectable and the next sweep
// replays the SAME Stripe idempotency key to the SAME transfer id — converging
// with no duplicate provider movement.
//
// These tests exercise partnerRelease.ts at that boundary. They FAIL on revert:
// restoring the two-write seam makes mark_partner_split_transferred reappear and
// settle_partner_split_transfer vanish (assertions below flip).

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { releasePartnerSplitsForOrganiserRelease } from "../partnerRelease.ts";

const STRIPE_SPLIT = {
  id: "00000000-0000-0000-0000-0000000000e1",
  provider: "stripe",
  stripe_application_fee_id: "fee-e1",
  order_id: "00000000-0000-0000-0000-0000000000d1",
  brand_id: "00000000-0000-0000-0000-0000000000c1",
  partner_account_id: "partner-e1",
  partner_share_cents: 4_200,
  transfer_currency: "usd",
};

type RpcCall = { name: string; args: Record<string, unknown> };
type FromCall = { table: string; op: string };

// `releaseRowsPerCall[i]` is the split set returned by the i-th
// release_partner_splits_for_organiser_release call (one per sweep).
// `settleOutcomes[i]` is the i-th settle_partner_split_transfer result: `null`
// commits, `{ message }` is a rolled-back database failure.
function makeSupabase(
  releaseRowsPerCall: Array<Array<Record<string, unknown>>>,
  settleOutcomes: Array<{ message: string } | null>,
) {
  const rpcCalls: RpcCall[] = [];
  const fromCalls: FromCall[] = [];
  let releaseCallIndex = 0;
  let settleIndex = 0;
  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "release_partner_splits_for_organiser_release") {
        const rows = releaseRowsPerCall[releaseCallIndex] ?? [];
        releaseCallIndex++;
        return Promise.resolve({ data: rows, error: null });
      }
      if (name === "settle_partner_split_transfer") {
        const outcome = settleOutcomes[settleIndex] ?? null;
        settleIndex++;
        return Promise.resolve({ data: null, error: outcome });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      const chain = {
        select: (_columns: string) => chain,
        eq: (_column: string, _value: unknown) => chain,
        is: (_column: string, _value: unknown) => chain,
        update: (_payload: unknown) => {
          fromCalls.push({ table, op: "update" });
          return chain;
        },
        maybeSingle: () => {
          if (table === "partner_stripe_connect_accounts") {
            return Promise.resolve({
              data: {
                account_id: "partner-e1",
                stripe_account_id: "acct_partner_e1",
                charges_enabled: true,
                payouts_enabled: true,
                external_account_currencies: ["usd"],
                detached_at: null,
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  };
  return { client, rpcCalls, fromCalls };
}

// Models Stripe idempotency: the same idempotency key ALWAYS returns the same
// transfer id and never represents a second provider movement.
function idempotentStripe() {
  const calls: Array<
    { payload: Record<string, unknown>; options: Record<string, unknown> }
  > = [];
  const byKey = new Map<string, string>();
  let minted = 0;
  return {
    stripe: {
      transfers: {
        create: (
          payload: Record<string, unknown>,
          options: Record<string, unknown>,
        ) => {
          calls.push({ payload, options });
          const key = String(options.idempotencyKey);
          let id = byKey.get(key);
          if (!id) {
            minted++;
            id = `tr_platform_${minted}`;
            byKey.set(key, id);
          }
          return Promise.resolve({ id });
        },
      },
    },
    calls,
    distinctMovements: () => byKey.size,
  };
}

Deno.test("settle is one atomic RPC — the two-write seam is gone on the happy path", async () => {
  const { client, rpcCalls, fromCalls } = makeSupabase([[STRIPE_SPLIT]], [null]);
  const { stripe, calls } = idempotentStripe();

  const result = await releasePartnerSplitsForOrganiserRelease(
    client as never,
    stripe as never,
    "release-e",
  );

  assertEquals(result, {
    releasedStripe: 1,
    pendingPaystack: 0,
    retryableStripe: 0,
    blockedStripe: 0,
  });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].options.idempotencyKey, "partner_split_fee-e1");

  const settle = rpcCalls.filter((c) =>
    c.name === "settle_partner_split_transfer"
  );
  assertEquals(settle.length, 1);
  assertEquals(settle[0].args.p_application_fee_id, "fee-e1");
  assertEquals(settle[0].args.p_transfer_id, "tr_platform_1");
  // The removed seam must never come back.
  assertFalse(
    rpcCalls.some((c) => c.name === "mark_partner_split_transferred"),
  );
  assertFalse(fromCalls.some((c) => c.table === "payout_transfer_legs"));
});

Deno.test("post-provider ledger failure is genuinely retryable and never terminally marks the split", async () => {
  const { client, rpcCalls, fromCalls } = makeSupabase(
    [[STRIPE_SPLIT]],
    [{ message: "settle_partner_split_transfer: injected leg write failure" }],
  );
  const { stripe, calls } = idempotentStripe();

  const result = await releasePartnerSplitsForOrganiserRelease(
    client as never,
    stripe as never,
    "release-e",
  );

  // Stripe moved money exactly once, but the atomic RPC rolled back, so this is
  // a real retry — NOT a release, NOT a block, NOT a silent success.
  assertEquals(result, {
    releasedStripe: 0,
    pendingPaystack: 0,
    retryableStripe: 1,
    blockedStripe: 0,
  });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].options.idempotencyKey, "partner_split_fee-e1");

  // The split is never marked transferred through any separate, non-atomic
  // seam, and no direct leg write ever fires. There is nothing durable to strand.
  assertFalse(
    rpcCalls.some((c) => c.name === "mark_partner_split_transferred"),
  );
  assertFalse(fromCalls.some((c) => c.table === "payout_transfer_legs"));
  assertEquals(
    rpcCalls.filter((c) => c.name === "settle_partner_split_transfer").length,
    1,
  );
});

Deno.test("the next sweep replays the same idempotency key and converges with no duplicate movement", async () => {
  // Sweep 1: settle fails and rolls back, so the split stays selectable.
  // Sweep 2: the SAME split is re-selected; settle succeeds this time.
  const { client, rpcCalls } = makeSupabase(
    [[STRIPE_SPLIT], [STRIPE_SPLIT]],
    [{ message: "settle_partner_split_transfer: injected leg write failure" }, null],
  );
  const { stripe, calls, distinctMovements } = idempotentStripe();

  const first = await releasePartnerSplitsForOrganiserRelease(
    client as never,
    stripe as never,
    "release-e",
  );
  const second = await releasePartnerSplitsForOrganiserRelease(
    client as never,
    stripe as never,
    "release-e",
  );

  assertEquals(first.retryableStripe, 1);
  assertEquals(first.releasedStripe, 0);
  assertEquals(second.releasedStripe, 1);
  assertEquals(second.retryableStripe, 0);

  // Both sweeps hit Stripe with the SAME idempotency key → one provider
  // movement, one transfer id, no duplicate cash out.
  assertEquals(calls.length, 2);
  assertEquals(calls[0].options.idempotencyKey, "partner_split_fee-e1");
  assertEquals(calls[1].options.idempotencyKey, "partner_split_fee-e1");
  assertEquals(distinctMovements(), 1);

  const settles = rpcCalls.filter((c) =>
    c.name === "settle_partner_split_transfer"
  );
  assertEquals(settles.length, 2);
  // The converging retry settles the SAME transfer id Stripe returned first.
  assertEquals(settles[0].args.p_transfer_id, "tr_platform_1");
  assertEquals(settles[1].args.p_transfer_id, "tr_platform_1");
  assert(
    rpcCalls.every((c) => c.name !== "mark_partner_split_transferred"),
  );
});
