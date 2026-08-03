// Issue #1219 (+ #1218 parse nuance) — implementor happy-path regression guard.
//
// #1219: on a transfer.reversed the sweep must credit ONLY the amount Paystack
// actually returned, and 0 when the amount is absent (mirroring the money-safe
// webhook path) — NEVER the fabricated full leg principal. The fails-on-revert
// anchor: reverting engine.ts's reversed branches back to `leg.principalCents`
// makes the absent-amount cases credit 1_992_500 instead of 0 → these tests fail.
//
// #1218: parsePaystackTransferCost must reflect the ACTUAL stamp from Paystack's
// itemised fees_breakdown rather than hardcoding actualStampCents:0. Reverting to
// the hardcode makes the breakdown case return stamp 0 → that test fails.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  executePaystackRelease,
  parsePaystackTransferCost,
  type PaystackOrganiserLeg,
  type PaystackReleaseCandidate,
  type PaystackReleaseDeps,
} from "../engine.ts";

const LEG_PRINCIPAL = 1_992_500;

type Rec = {
  reversals: Array<{ legId: string; returnedPrincipalCents: number }>;
  initiates: number;
};

const leg = (over: Partial<PaystackOrganiserLeg> = {}): PaystackOrganiserLeg => ({
  legId: "leg-1219",
  chunkIndex: 0,
  principalCents: LEG_PRINCIPAL,
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
): PaystackReleaseCandidate => ({
  release_id: "12190000-0000-0000-0000-000000000001",
  brand_id: "brand-1219",
  recipient_code: "RCP_test",
  currency: "ngn",
  organiser_legs: legs,
  partner_ceiling_kobo: 0,
});

function deps(
  rec: Rec,
  over: Partial<PaystackReleaseDeps> = {},
): PaystackReleaseDeps {
  return {
    getBalanceNgnKobo: () => Promise.resolve(10_000_000_000),
    fetchTransfer: (code) =>
      Promise.resolve({ status: "success", transfer_code: code, fee: 2_500 }),
    verifyTransferByReference: (ref) =>
      Promise.resolve({ status: "success", transfer_code: "TRF_x", reference: ref, fee: 2_500 }),
    authorize: () => Promise.resolve(true),
    initiateTransfer: (input) => {
      rec.initiates += 1;
      return Promise.resolve({ status: "success", transfer_code: "TRF_new", reference: input.reference, fee: 2_500 });
    },
    recordLegOutcome: () => Promise.resolve(),
    reconcileLegFee: () => Promise.resolve(),
    reverseLeg: (input) => {
      rec.reversals.push(input);
      return Promise.resolve();
    },
    ...over,
  };
}

const newRec = (): Rec => ({ reversals: [], initiates: 0 });

// ── #1219: reconcile-path reversal (data from fetch) ────────────────────────

Deno.test("#1219 reconcile reversal credits ONLY the returned amount", async () => {
  const rec = newRec();
  await executePaystackRelease(
    candidate([leg({ status: "in_flight", providerTransferCode: "TRF_rev" })]),
    deps(rec, {
      fetchTransfer: (code) =>
        Promise.resolve({ status: "reversed", transfer_code: code, amount: 700_000 }),
    }),
  );
  assertEquals(rec.reversals.length, 1);
  assertEquals(rec.reversals[0].returnedPrincipalCents, 700_000);
  assertEquals(rec.initiates, 0);
});

Deno.test("#1219 reconcile reversal with ABSENT amount credits 0, never the leg principal", async () => {
  const rec = newRec();
  await executePaystackRelease(
    candidate([leg({ status: "in_flight", providerTransferCode: "TRF_rev" })]),
    deps(rec, {
      fetchTransfer: (code) =>
        Promise.resolve({ status: "reversed", transfer_code: code }), // no amount
    }),
  );
  assertEquals(rec.reversals.length, 1);
  // Money-safety anchor: 0, NOT the fabricated LEG_PRINCIPAL.
  assertEquals(rec.reversals[0].returnedPrincipalCents, 0);
  assert(
    rec.reversals[0].returnedPrincipalCents !== LEG_PRINCIPAL,
    "absent reversal amount must never fabricate the full leg principal",
  );
});

Deno.test("#1219 reconcile reversal with invalid (0 / negative) amount credits 0", async () => {
  for (const bad of [0, -5, 1.5]) {
    const rec = newRec();
    await executePaystackRelease(
      candidate([leg({ status: "in_flight", providerTransferCode: "TRF_rev" })]),
      deps(rec, {
        fetchTransfer: (code) =>
          Promise.resolve({ status: "reversed", transfer_code: code, amount: bad }),
      }),
    );
    assertEquals(rec.reversals[0].returnedPrincipalCents, 0);
  }
});

// ── #1219: initiate-path reversal (data from initiate response) ─────────────

Deno.test("#1219 initiate-response reversal with ABSENT amount credits 0", async () => {
  const rec = newRec();
  await executePaystackRelease(
    candidate([leg()]), // fresh planned leg → eligible → initiate
    deps(rec, {
      initiateTransfer: (input) => {
        rec.initiates += 1;
        return Promise.resolve({ status: "reversed", transfer_code: "TRF_rev", reference: input.reference });
      },
    }),
  );
  assertEquals(rec.initiates, 1);
  assertEquals(rec.reversals.length, 1);
  assertEquals(rec.reversals[0].returnedPrincipalCents, 0);
});

Deno.test("#1219 initiate-response reversal credits ONLY the returned amount", async () => {
  const rec = newRec();
  await executePaystackRelease(
    candidate([leg()]),
    deps(rec, {
      initiateTransfer: (input) => {
        rec.initiates += 1;
        return Promise.resolve({ status: "reversed", transfer_code: "TRF_rev", reference: input.reference, amount: 500_000 });
      },
    }),
  );
  assertEquals(rec.reversals[0].returnedPrincipalCents, 500_000);
});

// ── #1218: parsePaystackTransferCost reflects the ACTUAL stamp ──────────────

Deno.test("#1218 parse reflects the actual stamp from fees_breakdown (not hardcoded 0)", () => {
  const cost = parsePaystackTransferCost({
    status: "success",
    fee_charged: 7_500,
    fees_breakdown: [
      { amount: 2_500, type: "transfer" },
      { amount: 5_000, type: "stamp_duty" },
    ],
  });
  assertEquals(cost, { actualFeeCents: 2_500, actualStampCents: 5_000 });
});

Deno.test("#1218 parse falls back to combined fee (stamp 0) when no breakdown is reported", () => {
  assertEquals(parsePaystackTransferCost({ status: "success", fee_charged: 2_500 }), {
    actualFeeCents: 2_500,
    actualStampCents: 0,
  });
  // Legacy `fee` field still honoured (existing #1177 mocks use it).
  assertEquals(parsePaystackTransferCost({ status: "success", fee: 2_500 }), {
    actualFeeCents: 2_500,
    actualStampCents: 0,
  });
  // No fee truth at all → null (leg goes fee_unreconciled).
  assertEquals(parsePaystackTransferCost({ status: "success" }), null);
});
