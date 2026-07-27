// Issue #1177 (sub-issue H of #1013) — implementor happy-path regression guard
// for Nigerian organiser Paystack Transfer execution. Adversarial angles
// (₦5,000 vs ₦5,001 boundaries, duplicate reference, missing fee evidence,
// reversal, insufficient balance) are the tester's; this file owns the exact
// plan/reconcile/idempotency contract and the fails-on-revert proof:
//   * reverting the model-B fee subtraction in planOrganiserTransferChunks
//     (i.e. organiserCash = pool, model A) breaks "delivered = pool − fee";
//   * reverting the reconcile-first ordering in executePaystackRelease (moving
//     initiate ahead of fetch/verify) breaks the #1030 lost-response guard.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildOrganiserTransferReference,
  estimatePaystackTransferCost,
  executePaystackRelease,
  type PaystackOrganiserLeg,
  type PaystackReleaseCandidate,
  type PaystackReleaseDeps,
  paystackReleaseCeilingKobo,
  planOrganiserTransferChunks,
  reconcilePaystackFee,
} from "../engine.ts";

const CAP = 1_000_000_000; // ₦10,000,000
const FLOOR = 5_000; // ₦50

// ── planOrganiserTransferChunks ────────────────────────────────────────────

Deno.test("SC-2 fee schedule thresholds are exact", () => {
  assertEquals(estimatePaystackTransferCost(500_000), { feeKobo: 1_000, stampDutyKobo: 0 }); // ₦5,000 → ₦10
  assertEquals(estimatePaystackTransferCost(500_100), { feeKobo: 2_500, stampDutyKobo: 0 }); // ₦5,001 → ₦25
  assertEquals(estimatePaystackTransferCost(999_900), { feeKobo: 2_500, stampDutyKobo: 0 }); // ₦9,999 → ₦25, no stamp
  assertEquals(estimatePaystackTransferCost(1_000_000), { feeKobo: 2_500, stampDutyKobo: 5_000 }); // ₦10,000 → +₦50 stamp
  assertEquals(estimatePaystackTransferCost(5_000_000), { feeKobo: 2_500, stampDutyKobo: 5_000 }); // ₦50,000 → ₦25
  assertEquals(estimatePaystackTransferCost(5_000_100), { feeKobo: 5_000, stampDutyKobo: 5_000 }); // ₦50,001 → ₦50
});

Deno.test("SC-1 single chunk: brand bears the fee, delivered principal = pool − fee (model B)", () => {
  const plan = planOrganiserTransferChunks(2_000_000); // ₦20,000
  assert(!("deferred" in plan));
  if ("deferred" in plan) return;
  assertEquals(plan.chunks.length, 1);
  assertEquals(plan.chunks[0].chunkIndex, 0);
  assertEquals(plan.chunks[0].estimatedFeeCents, 2_500); // ₦25
  assertEquals(plan.chunks[0].stampDutyCents, 5_000); // ₦50
  assertEquals(plan.chunks[0].principalCents, 1_992_500); // pool − 7,500
  assertEquals(plan.chunks[0].scheduleVersion, "verified-2026-07-24");
  // Model B invariant: delivered principal + fee = the whole pool (no subsidy,
  // no fee "on top"). Reverting the subtraction makes principal = pool → fails.
  assertEquals(plan.organiserCashCents + plan.feeTotalCents, 2_000_000);
});

Deno.test("model-B 2-pass tier re-solve drops the stamp when the fee pushes the principal under ₦10,000", () => {
  const plan = planOrganiserTransferChunks(1_000_000); // ₦10,000 exactly
  assert(!("deferred" in plan));
  if ("deferred" in plan) return;
  // Pass 1 fee on ₦10,000 = ₦25 + ₦50 stamp; post-fee ₦9,925 < ₦10,000, so
  // pass 2 drops the stamp → delivered ₦9,975, fee ₦25, stamp ₦0.
  assertEquals(plan.chunks[0].principalCents, 997_500);
  assertEquals(plan.chunks[0].estimatedFeeCents, 2_500);
  assertEquals(plan.chunks[0].stampDutyCents, 0);
  assertEquals(plan.organiserCashCents + plan.feeTotalCents, 1_000_000);
});

Deno.test("SC-3 sub-floor pool defers with no leg and no fee", () => {
  assertEquals(planOrganiserTransferChunks(4_999), { deferred: "sub_floor" });
  assertEquals(planOrganiserTransferChunks(0), { deferred: "sub_floor" });
});

Deno.test("SC-4 >₦10M chunks deterministically: ≤ cap, ≥ floor final chunk, contiguous, stable", () => {
  const pool = 1_000_004_900; // just over ₦10M
  const plan = planOrganiserTransferChunks(pool);
  assert(!("deferred" in plan));
  if ("deferred" in plan) return;
  assertEquals(plan.chunks.length, 2);
  for (let i = 0; i < plan.chunks.length; i++) {
    assertEquals(plan.chunks[i].chunkIndex, i); // contiguous 0..n-1
    assert(plan.chunks[i].principalCents <= CAP, "chunk must not exceed ₦10M cap");
    assert(plan.chunks[i].principalCents >= FLOOR, "no sub-₦50 final chunk");
  }
  // Delivered principals sum to pool − feeTotal (model B, no subsidy).
  const summed = plan.chunks.reduce((t, c) => t + c.principalCents, 0);
  assertEquals(summed, plan.organiserCashCents);
  assertEquals(plan.organiserCashCents + plan.feeTotalCents, pool);
  // Stable across re-plan (idempotent).
  const replan = planOrganiserTransferChunks(pool);
  assertEquals(replan, plan);
});

Deno.test("SC-4 large multi-chunk keeps every chunk in the top fee tier + stamp", () => {
  const pool = 35 * CAP + 12_345; // 35+ chunks
  const plan = planOrganiserTransferChunks(pool);
  assert(!("deferred" in plan));
  if ("deferred" in plan) return;
  assertEquals(plan.chunks.length, 36);
  for (const chunk of plan.chunks) {
    assert(chunk.principalCents <= CAP);
    assert(chunk.principalCents >= FLOOR);
    assertEquals(chunk.estimatedFeeCents, 5_000); // top ₦50 fee
    assertEquals(chunk.stampDutyCents, 5_000); // ₦50 stamp
  }
  assertEquals(plan.organiserCashCents + plan.feeTotalCents, pool);
});

Deno.test("ceiling = organiser (principal+fee+stamp) + partner legs", () => {
  const ceiling = paystackReleaseCeilingKobo(
    [{ principalCents: 1_992_500, estimatedFeeCents: 2_500, stampDutyCents: 5_000 }],
    30_000, // partner legs principal+fee+stamp
  );
  assertEquals(ceiling, 1_992_500 + 2_500 + 5_000 + 30_000);
});

Deno.test("SC-10 fee reconcile direction: over-estimate → debit, under → credit, equal → none", () => {
  assertEquals(reconcilePaystackFee(2_500, 5_000, 3_000, 5_000).direction, "debit");
  assertEquals(reconcilePaystackFee(2_500, 5_000, 3_000, 5_000).varianceCents, 500);
  assertEquals(reconcilePaystackFee(2_500, 5_000, 2_000, 5_000).direction, "credit");
  assertEquals(reconcilePaystackFee(2_500, 5_000, 2_500, 5_000).direction, "none");
});

Deno.test("reference is stable and money-safe per chunk/attempt", () => {
  assertEquals(
    buildOrganiserTransferReference("11111111-2222-3333-4444-555555555555", 0, 0),
    "bprel_11111111-2222-3333-4444-555555555555_c0_a0",
  );
  assertEquals(
    buildOrganiserTransferReference("11111111-2222-3333-4444-555555555555", 2, 3),
    "bprel_11111111-2222-3333-4444-555555555555_c2_a3",
  );
});

// ── executePaystackRelease (DI) ─────────────────────────────────────────────

type Recorder = {
  order: string[];
  legOutcomes: Array<{ legId: string; outcome: string; reference: string | null }>;
  fees: Array<{ legId: string; actualFeeCents: number | null }>;
  reversals: Array<{ legId: string; returnedPrincipalCents: number }>;
  initiates: Array<{ reference: string; amountSubunits: number }>;
};

const leg = (over: Partial<PaystackOrganiserLeg> = {}): PaystackOrganiserLeg => ({
  legId: "leg-a",
  chunkIndex: 0,
  principalCents: 1_992_500,
  estimatedFeeCents: 2_500,
  stampDutyCents: 5_000,
  status: "planned",
  providerReference: null,
  providerTransferCode: null,
  attemptCount: 0,
  ...over,
});

const candidate = (
  legs: PaystackOrganiserLeg[],
  partner = 0,
): PaystackReleaseCandidate => ({
  release_id: "11111111-2222-3333-4444-555555555555",
  brand_id: "brand-1177",
  recipient_code: "RCP_test",
  currency: "ngn",
  organiser_legs: legs,
  partner_ceiling_kobo: partner,
});

function deps(
  rec: Recorder,
  over: Partial<PaystackReleaseDeps> = {},
): PaystackReleaseDeps {
  return {
    getBalanceNgnKobo: () => {
      rec.order.push("balance");
      return Promise.resolve(10_000_000_000);
    },
    fetchTransfer: (code) => {
      rec.order.push(`fetch:${code}`);
      return Promise.resolve({ status: "success", transfer_code: code, fee: 2_500 });
    },
    verifyTransferByReference: (ref) => {
      rec.order.push(`verify:${ref}`);
      return Promise.resolve({ status: "success", transfer_code: "TRF_recovered", reference: ref, fee: 2_500 });
    },
    authorize: () => {
      rec.order.push("authorize");
      return Promise.resolve(true);
    },
    initiateTransfer: (input) => {
      rec.order.push(`initiate:${input.reference}`);
      rec.initiates.push({ reference: input.reference, amountSubunits: input.amountSubunits });
      return Promise.resolve({ status: "success", transfer_code: "TRF_new", reference: input.reference, fee: 2_500 });
    },
    recordLegOutcome: (input) => {
      rec.order.push(`record:${input.outcome}`);
      rec.legOutcomes.push({ legId: input.legId, outcome: input.outcome, reference: input.reference });
      return Promise.resolve();
    },
    reconcileLegFee: (input) => {
      rec.order.push("reconcile-fee");
      rec.fees.push({ legId: input.legId, actualFeeCents: input.actualFeeCents });
      return Promise.resolve();
    },
    reverseLeg: (input) => {
      rec.order.push("reverse");
      rec.reversals.push(input);
      return Promise.resolve();
    },
    ...over,
  };
}

const newRecorder = (): Recorder => ({
  order: [],
  legOutcomes: [],
  fees: [],
  reversals: [],
  initiates: [],
});

Deno.test("SC-5/SC-9 happy path: balance ceiling, authorize, initiate, succeed + fee reconcile", async () => {
  const rec = newRecorder();
  const counts = await executePaystackRelease(candidate([leg()]), deps(rec));
  assertEquals(counts.succeeded, 1);
  assertEquals(rec.initiates.length, 1);
  assertEquals(rec.initiates[0].reference, "bprel_11111111-2222-3333-4444-555555555555_c0_a0");
  assertEquals(rec.initiates[0].amountSubunits, 1_992_500);
  assertEquals(rec.fees[0].actualFeeCents, 2_500);
  // Ceiling is read BEFORE authorize BEFORE initiate.
  assertEquals(rec.order.slice(0, 3), ["balance", "authorize", "initiate:bprel_11111111-2222-3333-4444-555555555555_c0_a0"]);
});

Deno.test("SC-7/#1030 lost response: a leg with a reference (no code) is reconciled by reference BEFORE any initiate", async () => {
  const rec = newRecorder();
  const lostLeg = leg({
    status: "in_flight",
    providerReference: "bprel_11111111-2222-3333-4444-555555555555_c0_a0",
    providerTransferCode: null,
  });
  const counts = await executePaystackRelease(candidate([lostLeg]), deps(rec));
  // Verify-by-reference resolved it → succeeded, NO second POST /transfer.
  assertEquals(counts.reconciled, 1);
  assertEquals(counts.succeeded, 1);
  assertEquals(rec.initiates.length, 0, "a lost initiate response must never trigger a second transfer");
  assert(rec.order.some((s) => s.startsWith("verify:")), "verify-by-reference must run");
  assert(!rec.order.some((s) => s.startsWith("initiate:")), "initiate must not run for a reconciled leg");
});

Deno.test("SC-7 reconcile-by-code precedes initiate for an in-flight leg carrying a transfer code", async () => {
  const rec = newRecorder();
  const inflight = leg({
    status: "in_flight",
    providerTransferCode: "TRF_live",
    providerReference: "bprel_11111111-2222-3333-4444-555555555555_c0_a0",
  });
  await executePaystackRelease(candidate([inflight]), deps(rec));
  assert(rec.order[0] === "fetch:TRF_live", "code reconcile must be first");
  assertEquals(rec.initiates.length, 0);
});

Deno.test("SC-12 idempotent: a still-pending in-flight leg is never re-initiated", async () => {
  const rec = newRecorder();
  const inflight = leg({ status: "in_flight", providerTransferCode: "TRF_pending" });
  const counts = await executePaystackRelease(
    candidate([inflight]),
    deps(rec, {
      fetchTransfer: (code) => {
        rec.order.push(`fetch:${code}`);
        return Promise.resolve({ status: "pending", transfer_code: code });
      },
    }),
  );
  assertEquals(counts.inFlight, 1);
  assertEquals(rec.initiates.length, 0);
});

Deno.test("SC-8 OTP blocks the rail: no further chunk is initiated", async () => {
  const rec = newRecorder();
  const counts = await executePaystackRelease(
    candidate([leg({ legId: "leg-a", chunkIndex: 0 }), leg({ legId: "leg-b", chunkIndex: 1 })]),
    deps(rec, {
      initiateTransfer: (input) => {
        rec.order.push(`initiate:${input.reference}`);
        rec.initiates.push({ reference: input.reference, amountSubunits: input.amountSubunits });
        return Promise.resolve({ status: "otp" });
      },
    }),
  );
  assertEquals(counts.blockedOtp, 1);
  assertEquals(rec.initiates.length, 1, "OTP on the first chunk stops the rail");
});

Deno.test("SC-5 insufficient balance blocks with NO initiate (ceiling-only, no subsidy)", async () => {
  const rec = newRecorder();
  const counts = await executePaystackRelease(
    candidate([leg()], 30_000),
    deps(rec, { getBalanceNgnKobo: () => Promise.resolve(1_000) }),
  );
  assertEquals(counts.blockedBalance, 1);
  assertEquals(rec.initiates.length, 0);
  assertEquals(rec.legOutcomes[0].outcome, "blocked_balance");
});

Deno.test("SC-11 reversal credits only the returned principal", async () => {
  const rec = newRecorder();
  const reversedLeg = leg({ status: "in_flight", providerTransferCode: "TRF_rev" });
  await executePaystackRelease(
    candidate([reversedLeg]),
    deps(rec, {
      fetchTransfer: (code) =>
        Promise.resolve({ status: "reversed", transfer_code: code, amount: 1_000_000 }),
    }),
  );
  assertEquals(rec.reversals.length, 1);
  assertEquals(rec.reversals[0].returnedPrincipalCents, 1_000_000);
  assertEquals(rec.initiates.length, 0);
});

Deno.test("missing fee evidence marks fee_unreconciled, never a silent Mingla charge", async () => {
  const rec = newRecorder();
  const counts = await executePaystackRelease(
    candidate([leg()]),
    deps(rec, {
      initiateTransfer: (input) => {
        rec.initiates.push({ reference: input.reference, amountSubunits: input.amountSubunits });
        return Promise.resolve({ status: "success", transfer_code: "TRF_nofee", reference: input.reference });
      },
    }),
  );
  assertEquals(counts.feeUnreconciled, 1);
  assertEquals(counts.succeeded, 0);
  // A reconcile with null fee is still requested so the RPC flips fee_unreconciled.
  assertEquals(rec.fees[0].actualFeeCents, null);
});
