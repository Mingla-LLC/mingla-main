/**
 * #4522 — refund chips and the "Deposit is non-refundable" rule of the 4-step
 * builder (keys from the slice 1 refund policy).
 *
 * Imported only by `TripRefundPolicySection`, which loads inside the refund
 * editor's own chunk. Importing `refundPolicyModel` from the wizard's chunk would
 * make Metro hoist it into `__common` (the boot payload; ORCH-1083).
 */

import type { RefundPolicy } from "../../services/refundPolicyModel";
import { NO_REFUNDS_POLICY } from "../../services/refundPolicyModel";

export type RefundChipKey = "full_30" | "half_14" | "none" | "custom";

export const REFUND_CHIPS: ReadonlyArray<{ key: RefundChipKey; label: string }> = [
  { key: "full_30", label: "Full refund until 30 days before" },
  { key: "half_14", label: "50% until 14 days before" },
  { key: "none", label: "No refunds" },
  { key: "custom", label: "Custom…" },
];

const FULL_30: RefundPolicy = {
  kind: "custom",
  tiers: [
    { days_before_start: 30, refund_pct: 100 },
    { days_before_start: 0, refund_pct: 0 },
  ],
};
const HALF_14: RefundPolicy = {
  kind: "custom",
  tiers: [
    { days_before_start: 14, refund_pct: 50 },
    { days_before_start: 0, refund_pct: 0 },
  ],
};

const sameTiers = (a: RefundPolicy, b: RefundPolicy): boolean =>
  JSON.stringify(a.tiers) === JSON.stringify(b.tiers);

/** Which chip a stored policy reads as; anything else reads as Custom. */
export function refundChipOf(policy: RefundPolicy | null): RefundChipKey | null {
  if (policy === null) return null;
  if (policy.no_refunds === true || sameTiers(policy, NO_REFUNDS_POLICY)) return "none";
  if (sameTiers(policy, FULL_30)) return "full_30";
  if (sameTiers(policy, HALF_14)) return "half_14";
  return "custom";
}

/**
 * The policy a preset chip writes. "No refunds" writes the one 0% tier every
 * buyer surface already renders; the `no_refunds` flag is not written until a
 * buyer surface renders it (the offering reader holds it as unknown today).
 * The deposit rule survives a chip change.
 */
export function applyRefundChip(
  current: RefundPolicy | null,
  key: Exclude<RefundChipKey, "custom">,
): RefundPolicy {
  const base = key === "full_30" ? FULL_30 : key === "half_14" ? HALF_14 : NO_REFUNDS_POLICY;
  const base2: RefundPolicy = { kind: base.kind, tiers: base.tiers.map((t) => ({ ...t })) };
  return current?.deposit_non_refundable === true
    ? { ...base2, deposit_non_refundable: true }
    : base2;
}

/** The key is written only when on, so a policy without the rule stays byte-identical. */
export function withDepositNonRefundable(
  policy: RefundPolicy | null,
  on: boolean,
): RefundPolicy {
  const base: RefundPolicy = policy ?? { kind: "custom", tiers: [{ days_before_start: 0, refund_pct: 0 }] };
  const { deposit_non_refundable: _drop, ...rest } = base;
  return on ? { ...rest, deposit_non_refundable: true } : rest;
}

