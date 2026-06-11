/**
 * ORCH-1055 — navTabGate unit tests.
 *
 * Asserts the rank-aware filter in `navTabGate.ts` produces the correct
 * scanner-only nav surface (rank 10 → Home + Account) and the full
 * surface for brand_owner (rank 60).
 *
 * Per SPEC §5 / Step 0.5 regression tests.
 */

import type { BottomNavTab } from "../../components/ui/BottomNav";
import { BRAND_ROLE_RANK } from "../brandRole";
import {
  MIN_RANK_FOR_TAB,
  isScannerOnlyRank,
  visibleTabsForRank,
} from "../navTabGate";

const FULL_TABS: BottomNavTab[] = [
  { id: "home", icon: "home", label: "Home" },
  { id: "hub", icon: "calendar", label: "Hub" },
  { id: "ari", icon: "sparkle", label: "Ari" },
  { id: "marketing", icon: "send", label: "Blast" },
  { id: "account", icon: "user", label: "Account" },
];

describe("visibleTabsForRank", () => {
  it("hides every brand-management tab for a rank-10 scanner", () => {
    const visible = visibleTabsForRank(FULL_TABS, BRAND_ROLE_RANK.scanner);
    const ids = visible.map((t) => t.id);
    expect(ids).toEqual(["home", "account"]);
  });

  // ORCH-1109 — SANCTIONED behavior change: a brand-less rank-0 user now sees
  // the Ari tab (the non-monotonic carve-out lets them create their first
  // brand via Ari's create_brand tool). This replaces the prior ORCH-1055
  // assertion that rank-0 saw Home + Account only. Recorded against the
  // tests-append-only invariant as the single sanctioned existing-test edit
  // (I-PROPOSED-1055-AMEND DRAFT).
  it("surfaces ari for a brand-less rank-0 user (ORCH-1109)", () => {
    const visible = visibleTabsForRank(FULL_TABS, 0);
    const ids = visible.map((t) => t.id);
    expect(ids).toEqual(["home", "ari", "account"]);
  });

  it("surfaces marketing for marketing_manager (rank 20)", () => {
    const visible = visibleTabsForRank(
      FULL_TABS,
      BRAND_ROLE_RANK.marketing_manager,
    );
    const ids = visible.map((t) => t.id);
    expect(ids).toEqual(["home", "marketing", "account"]);
  });

  // ORCH-1109 — the carve-out must NOT re-grant Ari to a rank-10 scanner; the
  // ORCH-1055 scanner lockout (Home + Account only) is preserved. Reverting the
  // carve-out to a naive `ari:0` scalar would regain ari here → this fails.
  it("rank-10 scanner still does NOT see ari after the ORCH-1109 carve-out", () => {
    const visible = visibleTabsForRank(FULL_TABS, BRAND_ROLE_RANK.scanner);
    expect(visible.map((t) => t.id)).toEqual(["home", "account"]);
  });

  // ORCH-1109 — a rank-20 marketing manager sees Home + Blast + Account, NOT
  // ari. The non-monotonic carve-out is scoped to rank 0 and rank>=30 only.
  it("rank-20 marketing manager does NOT see ari (ORCH-1109)", () => {
    const visible = visibleTabsForRank(
      FULL_TABS,
      BRAND_ROLE_RANK.marketing_manager,
    );
    expect(visible.map((t) => t.id)).toEqual(["home", "marketing", "account"]);
  });

  it("surfaces hub + ari for finance_manager (rank 30)", () => {
    const visible = visibleTabsForRank(
      FULL_TABS,
      BRAND_ROLE_RANK.finance_manager,
    );
    const ids = visible.map((t) => t.id);
    expect(ids).toEqual(["home", "hub", "ari", "marketing", "account"]);
  });

  it("surfaces every tab for brand_owner (rank 60)", () => {
    const visible = visibleTabsForRank(
      FULL_TABS,
      BRAND_ROLE_RANK.brand_owner,
    );
    expect(visible.map((t) => t.id)).toEqual([
      "home",
      "hub",
      "ari",
      "marketing",
      "account",
    ]);
  });

  it("drops tabs whose id is not declared in MIN_RANK_FOR_TAB", () => {
    const tabsWithUnknown: BottomNavTab[] = [
      ...FULL_TABS,
      // Intentionally undeclared id — should be dropped (default-closed).
      { id: "rogue", icon: "home", label: "Rogue" } as BottomNavTab,
    ];
    const visible = visibleTabsForRank(
      tabsWithUnknown,
      BRAND_ROLE_RANK.brand_owner,
    );
    expect(visible.map((t) => t.id)).not.toContain("rogue");
  });

  it("preserves stable order from the input", () => {
    const reordered: BottomNavTab[] = [
      { id: "account", icon: "user", label: "Account" },
      { id: "home", icon: "home", label: "Home" },
    ];
    const visible = visibleTabsForRank(reordered, BRAND_ROLE_RANK.scanner);
    expect(visible.map((t) => t.id)).toEqual(["account", "home"]);
  });
});

describe("isScannerOnlyRank", () => {
  it("returns true ONLY for rank=10 (scanner)", () => {
    expect(isScannerOnlyRank(BRAND_ROLE_RANK.scanner)).toBe(true);
  });

  it("returns false for rank 0 (no membership) so the empty-brand prompt still renders", () => {
    expect(isScannerOnlyRank(0)).toBe(false);
  });

  it("returns false for any rank above scanner", () => {
    expect(isScannerOnlyRank(BRAND_ROLE_RANK.marketing_manager)).toBe(false);
    expect(isScannerOnlyRank(BRAND_ROLE_RANK.finance_manager)).toBe(false);
    expect(isScannerOnlyRank(BRAND_ROLE_RANK.event_manager)).toBe(false);
    expect(isScannerOnlyRank(BRAND_ROLE_RANK.brand_admin)).toBe(false);
    expect(isScannerOnlyRank(BRAND_ROLE_RANK.brand_owner)).toBe(false);
  });
});

describe("MIN_RANK_FOR_TAB", () => {
  it("contains an entry for every id used by the registered TABS superset", () => {
    // Parity check at unit-test level (the strict-grep gate enforces this
    // against the live source files; this test guards the constant itself).
    const declared = Object.keys(MIN_RANK_FOR_TAB);
    const expected = ["home", "hub", "ari", "marketing", "account"];
    for (const id of expected) {
      expect(declared).toContain(id);
    }
  });

  it("threshold for scanner-allowed tabs is at most BRAND_ROLE_RANK.scanner", () => {
    // Home + Account MUST admit a rank-10 scanner.
    expect(MIN_RANK_FOR_TAB.home).toBeLessThanOrEqual(BRAND_ROLE_RANK.scanner);
    expect(MIN_RANK_FOR_TAB.account).toBeLessThanOrEqual(
      BRAND_ROLE_RANK.scanner,
    );
  });

  it("threshold for brand-management tabs is strictly above BRAND_ROLE_RANK.scanner", () => {
    expect(MIN_RANK_FOR_TAB.hub).toBeGreaterThan(BRAND_ROLE_RANK.scanner);
    expect(MIN_RANK_FOR_TAB.ari).toBeGreaterThan(BRAND_ROLE_RANK.scanner);
    expect(MIN_RANK_FOR_TAB.marketing).toBeGreaterThan(BRAND_ROLE_RANK.scanner);
  });
});
