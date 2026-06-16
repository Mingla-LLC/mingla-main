/**
 * META-ORCH-1148 sub-ORCH 2.1a — Smart Capacity Rules MVP catalog (pure).
 *
 * Ships ONLY the three rule kinds the 2.1a engine honours:
 *   - party_fit         — block too-small parties on large tables (the min/max
 *                         party fit; ENFORCED server-side inside the engine +
 *                         create RPC, the form just configures the default).
 *   - deposit_threshold — parties >= N are flagged for a fee/deposit (a DISPLAY
 *                         seam in 2.1; the CALLER reads it, the engine stays
 *                         purely time/seat — SPEC §5.0 step 8).
 *   - blackout_scope    — surfaces the blackout scope choice (all/zone/table)
 *                         that the Availability blackout sheet writes.
 *
 * The 2.0 CHECK lays the full catalog (approval_required / walk_in_only /
 * weekend_only / combinable auto-merge) but those are NAMED SEAMS — NOT offered
 * by the 2.1a form. This module is the fails-on-revert anchor for
 * I-PROPOSED-1148-CAPACITY-RULE-ENFORCED-SERVER-SIDE ("the 3 MVP rule kinds are
 * the ONLY ones the catalog ships"). Pure, dependency-free, unit-tested.
 */

import type { VenueCapacityRuleKind } from "../../types/venueReservation";

/** The 3 MVP rule kinds, declaration-ordered. The ONLY kinds the catalog ships. */
export const CAPACITY_RULE_MVP_KINDS: readonly VenueCapacityRuleKind[] = [
  "party_fit",
  "deposit_threshold",
  "blackout_scope",
] as const;

/**
 * The deferred kinds (2.0 CHECK lays them; 2.1a does NOT offer them). Listed so
 * a test can assert the form never surfaces one of these (revert guard).
 */
export const CAPACITY_RULE_DEFERRED_KINDS: readonly string[] = [
  "approval_required",
  "walk_in_only",
  "weekend_only",
] as const;

export interface CapacityRuleMeta {
  readonly kind: VenueCapacityRuleKind;
  readonly label: string;
  readonly summary: string;
  /** The single param key the form edits (null for the seam-only rules). */
  readonly paramKey: string | null;
  /** Human label for the param input (null when paramKey is null). */
  readonly paramLabel: string | null;
}

/** Canonical metadata for the 3 MVP rules (the form reads this verbatim). */
export const CAPACITY_RULE_CATALOG: Readonly<
  Record<VenueCapacityRuleKind, CapacityRuleMeta>
> = {
  party_fit: {
    kind: "party_fit",
    label: "Party fit",
    summary:
      "Only offer a table when the party fits its min/max size. Enforced automatically when guests book.",
    paramKey: null,
    paramLabel: null,
  },
  deposit_threshold: {
    kind: "deposit_threshold",
    label: "Deposit for large parties",
    summary:
      "Flag parties at or above a size for a deposit or reservation fee.",
    paramKey: "min_party_for_fee",
    paramLabel: "Party size that needs a deposit",
  },
  blackout_scope: {
    kind: "blackout_scope",
    label: "Blackout scope",
    summary:
      "Choose whether a closure applies to the whole venue, a zone, or a single table.",
    paramKey: null,
    paramLabel: null,
  },
};

/** True iff a kind is one of the 3 MVP kinds the 2.1a catalog ships. */
export function isMvpCapacityRuleKind(
  kind: string,
): kind is VenueCapacityRuleKind {
  return (CAPACITY_RULE_MVP_KINDS as readonly string[]).includes(kind);
}

/**
 * Read the deposit-threshold party size from a rule's params. Returns null when
 * the rule is absent or the param is missing/invalid. Pure.
 */
export function depositThresholdMinParty(
  params: Record<string, unknown> | null | undefined,
): number | null {
  if (params == null) return null;
  const raw = params["min_party_for_fee"];
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  return null;
}
