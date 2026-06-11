/**
 * ORCH-1109 — navTabGate TESTER ADVERSARIAL (append-only; tester-owned).
 *
 * Different angle from the implementor's targeted cases: instead of asserting a
 * handful of named ranks, this enumerates the ENTIRE meaningful rank space
 * (every BRAND_ROLE_RANK value + the gap ranks 1, 11, 21, 29 + NO_MEMBERSHIP)
 * and asserts the EXACT rank predicate for the Ari tab:
 *
 *     Ari visible  ⇔  rank === 0  OR  rank >= 30
 *
 * The teeth of this test: a mid-rank user (the rank-10 scanner and rank-20
 * marketing manager — the two roles ORCH-1055 deliberately locked OUT of the
 * brand-management nav) must NEVER see Ari, no matter how the carve-out is
 * refactored. Reverting the carve-out to a naive `ari:0` scalar (which would
 * regain Ari for ranks 1..29) fails the scanner/marketing rows; widening it to
 * monotonic `rank>=30` fails the rank-0 row. The carve-out is the ONLY shape
 * that passes the whole enumeration.
 *
 * Backed by live-fire: the ORCH-1108 edge-fn adversarial matrix (wrong-email
 * 403, revoked/expired/declined exclusion, decline-terminal P0007) was proven
 * against the deployed backend in the TEST report; this file is the gate-side
 * regression for the ORCH-1109 nav predicate.
 */

import type { BottomNavTab } from "../../components/ui/BottomNav";
import { BRAND_ROLE_RANK, NO_MEMBERSHIP_RANK } from "../brandRole";
import { visibleTabsForRank } from "../navTabGate";

const FULL_TABS: BottomNavTab[] = [
  { id: "home", icon: "home", label: "Home" },
  { id: "hub", icon: "calendar", label: "Hub" },
  { id: "ari", icon: "sparkle", label: "Ari" },
  { id: "marketing", icon: "send", label: "Blast" },
  { id: "account", icon: "user", label: "Account" },
];

const ariVisibleAt = (rank: number): boolean =>
  visibleTabsForRank(FULL_TABS, rank)
    .map((t) => t.id)
    .includes("ari");

describe("ORCH-1109 — Ari nav predicate over the full rank enumeration", () => {
  // The authoritative predicate the carve-out must satisfy exactly.
  const expectedAriVisible = (rank: number): boolean =>
    rank === NO_MEMBERSHIP_RANK || rank >= BRAND_ROLE_RANK.finance_manager;

  // Every named role rank + the boundary/gap ranks the carve-out must classify.
  const RANK_SPACE = [
    NO_MEMBERSHIP_RANK, // 0  → brand-less: VISIBLE
    1, // sub-scanner sliver → HIDDEN
    BRAND_ROLE_RANK.scanner, // 10 → HIDDEN (the ORCH-1055 lockout)
    11, // → HIDDEN
    BRAND_ROLE_RANK.marketing_manager, // 20 → HIDDEN
    21, // → HIDDEN
    29, // just below finance → HIDDEN
    BRAND_ROLE_RANK.finance_manager, // 30 → VISIBLE (boundary)
    BRAND_ROLE_RANK.event_manager, // 40 → VISIBLE
    BRAND_ROLE_RANK.brand_admin, // 50 → VISIBLE
    BRAND_ROLE_RANK.brand_owner, // 60 → VISIBLE
    999, // far above → VISIBLE
  ];

  it.each(RANK_SPACE)(
    "rank %i: Ari visibility matches `rank===0 || rank>=30`",
    (rank) => {
      expect(ariVisibleAt(rank)).toBe(expectedAriVisible(rank));
    },
  );

  it("the two ORCH-1055-locked mid-ranks (scanner 10, marketing 20) NEVER see Ari", () => {
    expect(ariVisibleAt(BRAND_ROLE_RANK.scanner)).toBe(false);
    expect(ariVisibleAt(BRAND_ROLE_RANK.marketing_manager)).toBe(false);
  });

  it("a brand-less rank-0 user sees Ari; the gap ranks 1..29 do not", () => {
    expect(ariVisibleAt(0)).toBe(true);
    for (const r of [1, 9, 10, 11, 19, 20, 21, 29]) {
      expect(ariVisibleAt(r)).toBe(false);
    }
  });

  it("home + account stay rank-agnostic (visible at every enumerated rank)", () => {
    for (const r of RANK_SPACE) {
      const ids = visibleTabsForRank(FULL_TABS, r).map((t) => t.id);
      expect(ids).toContain("home");
      expect(ids).toContain("account");
    }
  });
});
