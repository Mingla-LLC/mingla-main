/**
 * ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — happy-path regression
 * test for the client-side monotonicity validator in refundPolicyService.
 *
 * Per ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5
 * gate: implementor MUST ship a happy-path test that fails on revert. This
 * test exercises I-PROPOSED-TR4-REFUND-CASCADE-MONOTONICITY at the client
 * layer (the DB CHECK constraint is the authoritative enforcement, but the
 * client validator catches the bad input earlier so the buyer sees inline
 * error feedback instead of a round-trip 23514).
 *
 * Fails-on-revert verified: remove the monotonicity check in
 * updateRefundPolicy's client-side validation loop (the `if (tier.refund_pct
 * > prevPct)` block) → test_monotonicity_rejected FAILS because the service
 * silently sends bad input to the DB instead of throwing locally.
 */

import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../supabase", () => ({
  supabase: {
    from: jest.fn(() => ({
      update: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: null })),
      })),
    })),
  },
}));

import {
  STANDARD_POLICY,
  updateRefundPolicy,
  type RefundPolicy,
} from "../refundPolicyService";

const EVENT_ID = "00000000-0000-0000-0000-000000000001";

describe("ORCH-0875 refundPolicyService monotonicity validator", () => {
  test("happy-path: standard preset accepted (client validation passes through to DB)", async () => {
    await expect(
      updateRefundPolicy(EVENT_ID, STANDARD_POLICY),
    ).resolves.toBeUndefined();
  });

  test("happy-path: null policy accepted (clears refund policy)", async () => {
    await expect(updateRefundPolicy(EVENT_ID, null)).resolves.toBeUndefined();
  });

  test("monotonicity rejected: refund_pct increases (50 → 80) throws monotonicity_violation locally", async () => {
    const badPolicy: RefundPolicy = {
      kind: "custom",
      tiers: [
        { days_before_start: 30, refund_pct: 50 },
        { days_before_start: 14, refund_pct: 80 },
      ],
    };
    await expect(updateRefundPolicy(EVENT_ID, badPolicy)).rejects.toMatchObject({
      code: "monotonicity_violation",
    });
  });

  test("days-ascending rejected: tiers must descend by days_before_start", async () => {
    const badPolicy: RefundPolicy = {
      kind: "custom",
      tiers: [
        { days_before_start: 30, refund_pct: 50 },
        { days_before_start: 60, refund_pct: 50 },
      ],
    };
    await expect(updateRefundPolicy(EVENT_ID, badPolicy)).rejects.toMatchObject({
      code: "days_not_descending",
    });
  });

  test("tier_pct out-of-range rejected: refund_pct=150 caught at client", async () => {
    const badPolicy: RefundPolicy = {
      kind: "custom",
      tiers: [{ days_before_start: 0, refund_pct: 150 }],
    };
    await expect(updateRefundPolicy(EVENT_ID, badPolicy)).rejects.toMatchObject({
      code: "tier_pct_out_of_range",
    });
  });

  test("tier count cap rejected: 9 tiers throws (max 8)", async () => {
    const badPolicy: RefundPolicy = {
      kind: "custom",
      tiers: Array.from({ length: 9 }, (_, i) => ({
        days_before_start: 100 - i * 10,
        refund_pct: 100 - i * 10,
      })),
    };
    await expect(updateRefundPolicy(EVENT_ID, badPolicy)).rejects.toMatchObject({
      code: "tier_count_invalid",
    });
  });

  test("kind invalid rejected: 'premium' is not in flexible/standard/strict/custom", async () => {
    // Intentionally bad kind — exercises the validator. Cast through unknown
    // to bypass the RefundPolicyKind literal union check.
    const badPolicy = {
      kind: "premium",
      tiers: [{ days_before_start: 0, refund_pct: 0 }],
    } as unknown as RefundPolicy;
    await expect(updateRefundPolicy(EVENT_ID, badPolicy)).rejects.toMatchObject({
      code: "kind_invalid",
    });
  });
});
