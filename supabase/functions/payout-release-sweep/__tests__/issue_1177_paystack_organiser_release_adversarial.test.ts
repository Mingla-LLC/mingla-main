// Issue #1177 (sub-issue H of #1013) — TESTER ADVERSARIAL regression guard.
//
// DIFFERENT ANGLE from the implementor happy-path file
// (issue_1177_paystack_organiser_release.test.ts): the implementor asserts
// single-invocation SNAPSHOTS of executePaystackRelease. This file attacks the
// #1030 double-pay seam as a MULTI-SWEEP CONVERGENCE against a stateful fake
// Paystack backend that enforces real reference-idempotency (POST /transfer with
// a seen reference returns the ORIGINAL transfer, never a new one) and can drop
// an initiate RESPONSE while still having created the transfer server-side.
//
// The binding invariant proven here: across an arbitrary number of sweeps, a
// single organiser leg converges to EXACTLY ONE succeeded transfer and EXACTLY
// ONE server-side money movement — a lost initiate response is resolved by
// READING Paystack (verify-by-reference), never by a blind second POST.
//
// fails-on-revert: reverting the reconcile-first ordering in
// executePaystackRelease (initiating before fetch/verify) makes sweep 2 re-POST
// the in-flight leg → `fake.postCount` becomes 2 and the "no second POST"
// assertion fails. Restoring makes it pass.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyPaystackTransferError,
  executePaystackRelease,
  type PaystackOrganiserLeg,
  type PaystackReleaseCandidate,
  type PaystackReleaseDeps,
  planOrganiserTransferChunks,
} from "../engine.ts";

const RELEASE = "11111111-2222-3333-4444-555555555555";

class PaystackApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// A stateful fake Paystack keyed by reference (Paystack's transfer idempotency
// key). It models the two facts that make #1030 dangerous:
//   1. reference-idempotency: a second POST with a seen reference returns the
//      SAME transfer (never a second money movement);
//   2. a lost response: the transfer IS created server-side but the initiate
//      call throws (network reset) so the caller never learns the code.
class FakePaystack {
  private transfers = new Map<
    string,
    { status: string; transfer_code: string; fee: number; amount: number }
  >();
  private byCode = new Map<string, string>(); // code -> reference
  postCount = 0;
  dropNextResponse = false;

  initiate(
    input: { amountSubunits: number; reference: string },
  ): Record<string, unknown> {
    this.postCount += 1;
    const existing = this.transfers.get(input.reference);
    if (existing) {
      // Reference-idempotency: return the ORIGINAL, no new money movement.
      return {
        status: existing.status,
        transfer_code: existing.transfer_code,
        reference: input.reference,
        fee: existing.fee,
        amount: existing.amount,
      };
    }
    const code = `TRF_${input.reference}`;
    this.transfers.set(input.reference, {
      status: "success",
      transfer_code: code,
      fee: 2_500,
      amount: input.amountSubunits,
    });
    this.byCode.set(code, input.reference);
    if (this.dropNextResponse) {
      this.dropNextResponse = false;
      // The transfer was created, but the response is lost in transit.
      throw new Error("connection reset by peer");
    }
    return { status: "success", transfer_code: code, reference: input.reference, fee: 2_500 };
  }

  fetch(code: string): Record<string, unknown> {
    const ref = this.byCode.get(code);
    const t = ref ? this.transfers.get(ref) : undefined;
    if (!t) throw new PaystackApiError("transfer not found", 404);
    return { status: t.status, transfer_code: code, reference: ref, fee: t.fee, amount: t.amount };
  }

  verify(reference: string): Record<string, unknown> {
    const t = this.transfers.get(reference);
    if (!t) throw new PaystackApiError("transfer not found", 404);
    return { status: t.status, transfer_code: t.transfer_code, reference, fee: t.fee, amount: t.amount };
  }

  /** Ground truth: exactly how many distinct transfers actually moved money. */
  distinctSuccessfulTransfers(): number {
    let n = 0;
    for (const t of this.transfers.values()) if (t.status === "success") n += 1;
    return n;
  }
}

// A minimal in-memory leg store the deps read/write, mirroring the RPC state
// transitions (record_paystack_transfer_leg_outcome / reconcile fee) so the
// candidate can be rebuilt between sweeps exactly like readOrganiserLegs does.
type StoredLeg = PaystackOrganiserLeg;

function buildDeps(
  fake: FakePaystack,
  store: Map<string, StoredLeg>,
  initiateCounter: { n: number },
  balanceKobo = 10_000_000_000,
): PaystackReleaseDeps {
  return {
    getBalanceNgnKobo: () => Promise.resolve(balanceKobo),
    fetchTransfer: (code) => Promise.resolve(fake.fetch(code)),
    verifyTransferByReference: (ref) => Promise.resolve(fake.verify(ref)),
    authorize: () => Promise.resolve(true),
    initiateTransfer: (input) => {
      initiateCounter.n += 1;
      return Promise.resolve(
        fake.initiate({ amountSubunits: input.amountSubunits, reference: input.reference }),
      );
    },
    recordLegOutcome: (input) => {
      const leg = store.get(input.legId)!;
      if (input.outcome === "succeeded") leg.status = "succeeded";
      else if (input.outcome === "in_flight") leg.status = "in_flight";
      else if (input.outcome === "retryable_error") leg.status = "in_flight"; // same ref kept, no attempt bump
      else if (input.outcome === "definitive_error") {
        leg.attemptCount += 1;
        leg.status = "planned";
        leg.providerReference = null;
        leg.providerTransferCode = null;
      } else if (input.outcome === "otp") leg.status = "in_flight";
      else if (input.outcome === "blocked_balance") { /* release-level; leg unchanged */ }
      if (input.outcome !== "definitive_error") {
        if (input.transferCode) leg.providerTransferCode = input.transferCode;
        if (input.reference) leg.providerReference = input.reference;
      }
      return Promise.resolve();
    },
    reconcileLegFee: (input) => {
      const leg = store.get(input.legId)!;
      if (input.actualFeeCents !== null) leg.status = "succeeded";
      return Promise.resolve();
    },
    reverseLeg: (input) => {
      const leg = store.get(input.legId)!;
      leg.status = "reversed";
      return Promise.resolve();
    },
  };
}

const candidateFrom = (store: Map<string, StoredLeg>): PaystackReleaseCandidate => ({
  release_id: RELEASE,
  brand_id: "brand-1177",
  recipient_code: "RCP_test",
  currency: "ngn",
  organiser_legs: [...store.values()].map((l) => ({ ...l })),
  partner_ceiling_kobo: 0,
});

Deno.test("#1030 headline: a LOST initiate response converges to exactly ONE pay across sweeps (no blind re-POST)", async () => {
  const fake = new FakePaystack();
  const store = new Map<string, StoredLeg>([[
    "leg-a",
    {
      legId: "leg-a",
      chunkIndex: 0,
      principalCents: 1_992_500,
      estimatedFeeCents: 2_500,
      stampDutyCents: 5_000,
      status: "planned",
      providerReference: null,
      providerTransferCode: null,
      attemptCount: 0,
    },
  ]]);

  // Sweep 1: the initiate creates the transfer server-side but the RESPONSE is
  // dropped → the adapter records retryable_error, keeping the SAME reference and
  // NO transfer code (it never learned it).
  fake.dropNextResponse = true;
  const sweep1Init = { n: 0 };
  const c1 = await executePaystackRelease(
    candidateFrom(store),
    buildDeps(fake, store, sweep1Init),
  );
  assertEquals(sweep1Init.n, 1, "sweep 1 initiates once");
  assertEquals(fake.postCount, 1, "one server-side transfer created");
  assertEquals(c1.retryable, 1, "dropped response classified retryable");
  assertEquals(c1.succeeded, 0);
  const afterSweep1 = store.get("leg-a")!;
  assertEquals(afterSweep1.status, "in_flight");
  assertEquals(afterSweep1.providerTransferCode, null, "code was never learned (lost response)");
  assert(afterSweep1.providerReference !== null, "reference is retained for reconcile-by-reference");

  // Sweep 2: reconcile-first must VERIFY-BY-REFERENCE (no code) and settle the
  // leg WITHOUT a second POST. This is the exact #1030 fix.
  const sweep2Init = { n: 0 };
  const c2 = await executePaystackRelease(
    candidateFrom(store),
    buildDeps(fake, store, sweep2Init),
  );
  assertEquals(sweep2Init.n, 0, "sweep 2 must NOT initiate — reconcile-by-reference settles it");
  assertEquals(fake.postCount, 1, "NO second POST /transfer — the lost-response double-pay seam is closed");
  assertEquals(c2.reconciled, 1);
  assertEquals(c2.succeeded, 1);
  assertEquals(store.get("leg-a")!.status, "succeeded");

  // Ground-truth invariant: exactly ONE money movement, ever.
  assertEquals(fake.distinctSuccessfulTransfers(), 1, "exactly one transfer moved money");

  // Sweep 3 (idempotent replay on a settled leg): zero initiates, zero re-pays.
  const sweep3Init = { n: 0 };
  await executePaystackRelease(candidateFrom(store), buildDeps(fake, store, sweep3Init));
  assertEquals(sweep3Init.n, 0);
  assertEquals(fake.postCount, 1);
  assertEquals(fake.distinctSuccessfulTransfers(), 1);
});

Deno.test("duplicate-reference on a blind re-POST is money-safe: reference-idempotency returns the original, still ONE pay", async () => {
  // Even if a leg were re-initiated with the SAME reference (belt to the
  // reconcile-first braces), Paystack reference-idempotency must return the
  // original transfer — never a second money movement.
  const fake = new FakePaystack();
  const first = fake.initiate({ amountSubunits: 1_992_500, reference: "bprel_dup_c0_a0" });
  const second = fake.initiate({ amountSubunits: 1_992_500, reference: "bprel_dup_c0_a0" });
  assertEquals(first.transfer_code, second.transfer_code, "same reference → same transfer");
  assertEquals(fake.distinctSuccessfulTransfers(), 1, "duplicate reference never double-pays");
  assertEquals(fake.postCount, 2);
});

Deno.test("classifier taxonomy: ambiguous/operational errors are RETRYABLE (same ref), only definitive 4xx burns", () => {
  // Money-safe posture (P2-1331): anything that MIGHT have moved money is
  // retryable so the same reference is reused; only a definitive client error
  // (that could not have created a transfer) burns the attempt.
  assertEquals(classifyPaystackTransferError(new Error("insufficient balance")).kind, "retryable");
  assertEquals(classifyPaystackTransferError(new Error("duplicate reference")).kind, "retryable");
  assertEquals(classifyPaystackTransferError(new Error("reference already exists")).kind, "retryable");
  assertEquals(classifyPaystackTransferError(new Error("connection reset")).kind, "retryable"); // network → ambiguous
  assertEquals(classifyPaystackTransferError({ status: 503, message: "x" }).kind, "retryable");
  assertEquals(classifyPaystackTransferError({ status: 429, message: "x" }).kind, "retryable");
  assertEquals(classifyPaystackTransferError({ status: 400, message: "bad recipient" }).kind, "definitive");
  assertEquals(classifyPaystackTransferError({ status: 422, message: "invalid" }).kind, "definitive");
});

Deno.test("model-B no-subsidy identity holds at adversarial pool boundaries (delivered + fee === pool, fee never negative)", () => {
  // A DIFFERENT set of boundaries than the implementor file: probe just-above
  // floor, tier crossings, and a large multi-chunk. The brand-bears-fee identity
  // organiserCash + feeTotal === pool must hold exactly at every point (no cent
  // is unattributed → no Mingla subsidy and no over-delivery).
  const pools = [
    5_000, 5_001, 5_999, 6_000, 500_000, 500_100, 999_900, 1_000_000, 5_000_000,
    5_000_100, 1_000_000_000, 1_000_000_001, 3_000_000_777, 35 * 1_000_000_000 + 12_345,
  ];
  for (const pool of pools) {
    const plan = planOrganiserTransferChunks(pool);
    if ("deferred" in plan) {
      assert(pool < 5_000 || plan.deferred === "sub_floor");
      continue;
    }
    assert(plan.feeTotalCents >= 0, `fee never negative @${pool}`);
    assertEquals(
      plan.organiserCashCents + plan.feeTotalCents,
      pool,
      `no-subsidy identity must hold exactly @${pool}`,
    );
    const summed = plan.chunks.reduce((t, c) => t + c.principalCents, 0);
    assertEquals(summed, plan.organiserCashCents, `chunk principals sum to delivered cash @${pool}`);
    for (const chunk of plan.chunks) {
      assert(chunk.principalCents <= 1_000_000_000, `chunk ≤ ₦10M cap @${pool}`);
      assert(chunk.principalCents >= 5_000, `no sub-₦50 chunk @${pool}`);
    }
  }
});
