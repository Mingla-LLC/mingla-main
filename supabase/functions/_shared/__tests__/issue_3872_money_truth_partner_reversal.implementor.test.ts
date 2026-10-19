// Issue #3872 PR 1 (money truth, F5) — partner reversals are proportional.
//
// MINGLA-INVARIANT: I-3872-PARTNER-REVERSAL-STRIPE-CALLS | issue #3872 | A refund makes at most one Stripe transfer reversal per cumulative target, for only the part not yet given back, and a dispute keeps its full reversal.
//
// The database half (issue_3872_partner_split_refund_plan / _record_reversal)
// is exercised for real by
// supabase/migrations/__tests__/issue_3872_money_truth_partner_reversal.implementor.happy.pg17.test.sql;
// here a faithful in-memory model of those two functions drives the REAL edge
// code (handleChargeReversal) to prove the Stripe calls.
//
// Fails before #3872: a refund created ONE full TransferReversal keyed
// `partner_split_reversal_<fee>`, so a second partial refund did nothing and
// the first took back the whole share.

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { handleChargeReversal } from "../partnerSplits.ts";

interface SplitModel {
  status: string;
  transferId: string | null;
  share: number;
  original: number | null;
  reversed: number;
}

function model(split: SplitModel) {
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  // deno-lint-ignore no-explicit-any
  const sb: any = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcs.push({ name, args });
      if (name === "issue_3872_partner_split_refund_plan") {
        const fee = Number(args.p_fee_amount_cents);
        const refunded = Math.min(Number(args.p_fee_refunded_cents), fee);
        const original = split.status === "transferred"
          ? (split.original ?? split.share)
          : (split.original ?? split.share + split.reversed);
        const target = Math.min(original, Math.floor((original * refunded) / fee));
        if (["reversed", "reversed_pending", "cancelled_refund"].includes(split.status)) {
          return Promise.resolve({ data: { outcome: "already_closed" }, error: null });
        }
        if (target <= split.reversed) {
          return Promise.resolve({ data: { outcome: "nothing_to_reverse" }, error: null });
        }
        if (split.status === "transferred") {
          return Promise.resolve({
            data: {
              outcome: "reverse",
              transfer_id: split.transferId,
              target_reversed_cents: target,
              reverse_cents: target - split.reversed,
            },
            error: null,
          });
        }
        split.original = original;
        split.share = original - target;
        split.reversed = target;
        if (split.share === 0) split.status = split.status === "held" ? "cancelled_refund" : "reversed_pending";
        return Promise.resolve({ data: { outcome: "reduced_in_place" }, error: null });
      }
      if (name === "issue_3872_partner_split_record_reversal") {
        const original = split.original ?? split.share;
        split.original = original;
        split.reversed = Math.max(split.reversed, Number(args.p_target_reversed_cents));
        if (split.reversed >= original) split.status = "reversed";
        return Promise.resolve({ data: { outcome: "recorded" }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { sb, rpcs };
}

function fakeStripe(feeTotals?: { amount: number; amount_refunded: number }) {
  const reversals: Array<{ transfer: string; amount: number; key: string }> = [];
  const seenKeys = new Set<string>();
  // deno-lint-ignore no-explicit-any
  const stripe: any = {
    applicationFees: {
      retrieve: (_id: string) => Promise.resolve({ id: _id, ...feeTotals }),
    },
    transfers: {
      createReversal: (transfer: string, payload: { amount: number }, options: { idempotencyKey: string }) => {
        // Stripe replays an idempotency key instead of moving money twice.
        if (!seenKeys.has(options.idempotencyKey)) {
          reversals.push({ transfer, amount: payload.amount, key: options.idempotencyKey });
          seenKeys.add(options.idempotencyKey);
        }
        return Promise.resolve({ id: `trr_${options.idempotencyKey}` });
      },
    },
  };
  return { stripe, reversals };
}

function refundEvent(id: string, feeAmount: number, feeRefunded: number) {
  return {
    id,
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_3872",
        application_fee: { id: "fee_3872", amount: feeAmount, amount_refunded: feeRefunded },
      },
    },
  };
}

Deno.test("two partial refunds on a transferred split reverse 10% then the rest", async () => {
  const split: SplitModel = { status: "transferred", transferId: "tr_3872", share: 1500, original: null, reversed: 0 };
  const { sb } = model(split);
  const { stripe, reversals } = fakeStripe();
  // Fee 15000 (share 1500). First refund returns 10% of the fee.
  await handleChargeReversal(sb, stripe, refundEvent("evt_1", 15000, 1500), "refund");
  // Second refund returns the rest of the fee.
  await handleChargeReversal(sb, stripe, refundEvent("evt_2", 15000, 15000), "refund");
  assertEquals(reversals, [
    { transfer: "tr_3872", amount: 150, key: "partner_split_reversal_fee_3872_to_150" },
    { transfer: "tr_3872", amount: 1350, key: "partner_split_reversal_fee_3872_to_1500" },
  ]);
  assertEquals(split.reversed, 1500);
  assertEquals(split.status, "reversed");
});

Deno.test("a replayed or out-of-order refund event never reverses twice", async () => {
  const split: SplitModel = { status: "transferred", transferId: "tr_3872", share: 1500, original: null, reversed: 0 };
  const { sb } = model(split);
  const { stripe, reversals } = fakeStripe();
  await handleChargeReversal(sb, stripe, refundEvent("evt_2", 15000, 15000), "refund");
  await handleChargeReversal(sb, stripe, refundEvent("evt_1", 15000, 1500), "refund"); // late, older
  await handleChargeReversal(sb, stripe, refundEvent("evt_2", 15000, 15000), "refund"); // replay
  assertEquals(reversals.map((r) => r.amount), [1500]);
});

Deno.test("a held split is reduced in place with no Stripe call", async () => {
  const split: SplitModel = { status: "held", transferId: null, share: 1500, original: null, reversed: 0 };
  const { sb, rpcs } = model(split);
  const { stripe, reversals } = fakeStripe();
  await handleChargeReversal(sb, stripe, refundEvent("evt_1", 15000, 1500), "refund");
  assertEquals(reversals.length, 0);
  assertEquals(split.share, 1350);
  assertEquals(split.status, "held");
  await handleChargeReversal(sb, stripe, refundEvent("evt_2", 15000, 15000), "refund");
  assertEquals(split.share, 0);
  assertEquals(split.status, "cancelled_refund");
  assert(rpcs.every((c) => c.name === "issue_3872_partner_split_refund_plan"));
});

Deno.test("a refund that keeps Mingla's whole fee leaves the partner share alone", async () => {
  const split: SplitModel = { status: "transferred", transferId: "tr_3872", share: 1500, original: null, reversed: 0 };
  const { sb } = model(split);
  const { stripe, reversals } = fakeStripe();
  await handleChargeReversal(sb, stripe, refundEvent("evt_1", 15000, 0), "refund");
  assertEquals(reversals.length, 0);
  assertEquals(split.reversed, 0);
});

Deno.test("when the charge only names the fee, its refunded total is read from Stripe", async () => {
  const split: SplitModel = { status: "transferred", transferId: "tr_3872", share: 1500, original: null, reversed: 0 };
  const { sb } = model(split);
  const { stripe, reversals } = fakeStripe({ amount: 15000, amount_refunded: 7500 });
  await handleChargeReversal(sb, stripe, {
    id: "evt_1",
    type: "charge.refunded",
    data: { object: { id: "ch_3872", application_fee: "fee_3872", application_fee_amount: 15000 } },
  }, "refund");
  assertEquals(reversals, [{ transfer: "tr_3872", amount: 750, key: "partner_split_reversal_fee_3872_to_750" }]);
});

Deno.test("disputes keep the full treatment (unchanged)", async () => {
  const rpcs: string[] = [];
  // deno-lint-ignore no-explicit-any
  const sb: any = {
    rpc: (name: string) => {
      rpcs.push(name);
      return Promise.resolve({ data: null, error: null });
    },
    from: () => {
      // deno-lint-ignore no-explicit-any
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () =>
          Promise.resolve({
            data: { id: "s", status: "transferred", stripe_transfer_id: "tr_d", partner_share_cents: 1500 },
            error: null,
          }),
      };
      return chain;
    },
  };
  const keys: string[] = [];
  // deno-lint-ignore no-explicit-any
  const stripe: any = {
    charges: { retrieve: () => Promise.resolve({ application_fee: "fee_d" }) },
    transfers: {
      createReversal: (_t: string, payload: Record<string, unknown>, o: { idempotencyKey: string }) => {
        assertEquals(payload.amount, undefined); // full reversal
        keys.push(o.idempotencyKey);
        return Promise.resolve({ id: "trr_d" });
      },
    },
  };
  await handleChargeReversal(sb, stripe, {
    id: "evt_d",
    type: "charge.dispute.created",
    data: { object: { charge: "ch_d" } },
  }, "dispute");
  assertEquals(keys, ["partner_split_reversal_fee_d"]);
  assert(rpcs.includes("mark_partner_split_reversed"));
});
