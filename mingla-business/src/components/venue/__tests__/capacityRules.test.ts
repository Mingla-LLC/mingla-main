/**
 * META-ORCH-1148 sub-ORCH 2.1a — capacityRules catalog unit tests (T-2).
 *
 * Fails-on-revert anchor I-PROPOSED-1148-CAPACITY-RULE-ENFORCED-SERVER-SIDE
 * ("the 3 MVP rule kinds are the ONLY ones the catalog ships"). Adding a 4th
 * kind to the catalog, or surfacing a deferred kind, flips these to FAIL.
 */

import {
  CAPACITY_RULE_CATALOG,
  CAPACITY_RULE_DEFERRED_KINDS,
  CAPACITY_RULE_MVP_KINDS,
  depositThresholdMinParty,
  isMvpCapacityRuleKind,
} from "../capacityRules";

describe("capacity rules MVP catalog", () => {
  it("T-2 — ships EXACTLY the 3 MVP kinds, in order", () => {
    expect(CAPACITY_RULE_MVP_KINDS).toEqual([
      "party_fit",
      "deposit_threshold",
      "blackout_scope",
    ]);
    expect(CAPACITY_RULE_MVP_KINDS).toHaveLength(3);
  });

  it("T-2b — the catalog has a meta entry for each MVP kind and NO others", () => {
    const keys = Object.keys(CAPACITY_RULE_CATALOG).sort();
    expect(keys).toEqual([...CAPACITY_RULE_MVP_KINDS].sort());
  });

  it("T-2c — a deferred kind is NEVER an MVP kind (no leakage into the form)", () => {
    for (const k of CAPACITY_RULE_DEFERRED_KINDS) {
      expect(isMvpCapacityRuleKind(k)).toBe(false);
      expect(CAPACITY_RULE_MVP_KINDS as readonly string[]).not.toContain(k);
    }
  });

  it("isMvpCapacityRuleKind narrows only the 3 MVP kinds", () => {
    expect(isMvpCapacityRuleKind("party_fit")).toBe(true);
    expect(isMvpCapacityRuleKind("deposit_threshold")).toBe(true);
    expect(isMvpCapacityRuleKind("blackout_scope")).toBe(true);
    expect(isMvpCapacityRuleKind("approval_required")).toBe(false);
    expect(isMvpCapacityRuleKind("walk_in_only")).toBe(false);
    expect(isMvpCapacityRuleKind("weekend_only")).toBe(false);
    expect(isMvpCapacityRuleKind("garbage")).toBe(false);
  });

  it("depositThresholdMinParty reads a valid party size, else null", () => {
    expect(depositThresholdMinParty({ min_party_for_fee: 8 })).toBe(8);
    expect(depositThresholdMinParty({ min_party_for_fee: 6.9 })).toBe(6);
    expect(depositThresholdMinParty({ min_party_for_fee: 0 })).toBeNull();
    expect(depositThresholdMinParty({})).toBeNull();
    expect(depositThresholdMinParty(null)).toBeNull();
    expect(depositThresholdMinParty(undefined)).toBeNull();
    expect(depositThresholdMinParty({ min_party_for_fee: "8" })).toBeNull();
  });
});
