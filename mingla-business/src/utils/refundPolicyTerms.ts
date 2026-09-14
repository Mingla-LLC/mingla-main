/**
 * refundPolicyTerms — issue #3284 [refund terms on events and experiences].
 *
 * The pure, dependency-free helpers the refund-terms AUTHORING surfaces share:
 *   - the client tier validator (moved here from RefundPolicyEditor so the event
 *     wizard's step validation and the editor's inline errors are ONE rule);
 *   - the "No refunds" shape check;
 *   - the organiser-facing policy name used by the published-event change summary.
 *
 * Type-only imports: importing this module never pulls the Supabase client, so
 * the draft validator and the live-event adapter stay pure.
 *
 * The validator mirrors `validate_refund_policy` (migration 20260612000000): the
 * database CHECK stays authoritative; this is the early, inline half.
 */

import type {
  RefundPolicy,
  RefundPolicyTier,
} from "../services/refundPolicyService";

/** Most tiers a policy may carry (validate_refund_policy: 1–8). */
export const REFUND_POLICY_MAX_TIERS = 8 as const;

export interface RefundTierValidationError {
  message: string;
  isDaysError: boolean;
  isPctError: boolean;
}

/**
 * Inline error per tier, in the same order as `tiers` (null = that tier is fine).
 * The four message strings are the shipped trip copy, unchanged.
 */
export function validateRefundPolicyTiers(
  tiers: readonly RefundPolicyTier[],
): Array<RefundTierValidationError | null> {
  return tiers.map((tier, idx) => {
    if (
      !Number.isInteger(tier.days_before_start) ||
      tier.days_before_start < 0
    ) {
      return { message: "Days must be 0 or higher.", isDaysError: true, isPctError: false };
    }
    if (
      !Number.isInteger(tier.refund_pct) ||
      tier.refund_pct < 0 ||
      tier.refund_pct > 100
    ) {
      return { message: "Refund % must be between 0 and 100.", isDaysError: false, isPctError: true };
    }
    if (idx > 0) {
      const prev = tiers[idx - 1];
      if (tier.days_before_start >= prev.days_before_start) {
        return {
          message: `Days must count down. Previous tier is ${prev.days_before_start}.`,
          isDaysError: true,
          isPctError: false,
        };
      }
      if (tier.refund_pct > prev.refund_pct) {
        return {
          message: `Refund % must be ≤ ${prev.refund_pct}% (previous tier).`,
          isDaysError: false,
          isPctError: true,
        };
      }
    }
    return null;
  });
}

/** The first tier error of a policy, or null when every tier is valid (or no policy). */
export function firstRefundPolicyError(
  policy: RefundPolicy | null | undefined,
): RefundTierValidationError | null {
  if (policy === null || policy === undefined) return null;
  if (policy.tiers.length === 0 || policy.tiers.length > REFUND_POLICY_MAX_TIERS) {
    return {
      message: "Policy must have 1–8 tiers.",
      isDaysError: false,
      isPctError: false,
    };
  }
  for (const error of validateRefundPolicyTiers(policy.tiers)) {
    if (error !== null) return error;
  }
  return null;
}

/**
 * True when `policy` is exactly the "No refunds" preset: one custom tier, 0% from
 * the moment of purchase (NO_REFUNDS_POLICY in refundPolicyService).
 */
export function isNoRefundsPolicy(
  policy: RefundPolicy | null | undefined,
): boolean {
  return (
    policy !== null &&
    policy !== undefined &&
    policy.kind === "custom" &&
    policy.tiers.length === 1 &&
    policy.tiers[0].days_before_start === 0 &&
    policy.tiers[0].refund_pct === 0
  );
}

/** Structural equality of two policies; `undefined` and `null` are both "no policy". */
export function refundPoliciesEqual(
  a: RefundPolicy | null | undefined,
  b: RefundPolicy | null | undefined,
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * The organiser-facing name of a policy for the published-event change summary:
 * Flexible | Standard | Strict | No refunds | Custom (N tiers) | No policy.
 */
export function refundPolicyDisplayName(
  policy: RefundPolicy | null | undefined,
): string {
  if (policy === null || policy === undefined) return "No policy";
  if (isNoRefundsPolicy(policy)) return "No refunds";
  switch (policy.kind) {
    case "flexible":
      return "Flexible";
    case "standard":
      return "Standard";
    case "strict":
      return "Strict";
    case "custom": {
      const n = policy.tiers.length;
      return `Custom (${n} tier${n === 1 ? "" : "s"})`;
    }
    default: {
      const exhaustive: never = policy.kind;
      return String(exhaustive);
    }
  }
}
