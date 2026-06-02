/**
 * navTabGate — minimum-rank gate for top-level (tabs) navigation entries.
 *
 * ORCH-1055 (META-ORCH-1048 sub-F): a rank-10 scanner (brand_team_members
 * role='scanner' from ORCH-1051's brand-scoped scanner, OR an `event_scanners`
 * row whose enclosing brand membership synthesises rank 10) MUST NOT see the
 * full brand-management nav surface. ORCH-1047/Cycle 13a permission gates
 * hide individual actions, but the bottom-nav capsule in
 * `app/(tabs)/_layout.tsx` previously rendered all 5 tabs unconditionally.
 *
 * This module is the single chokepoint that decides which tab ids are
 * visible at the nav-shell level. The thresholds mirror the user-facing
 * action gates in `permissionGates.ts`:
 *
 *   - home    → 0  (everyone with a brand membership; scanner sees ScannerHome)
 *   - hub     → 30 (finance_manager+; gate matches VIEW_RECONCILIATION/event mgmt)
 *   - ari     → 30 (AI assistant — same threshold as hub since the actions
 *                   it triggers gate at 30+ anyway)
 *   - marketing → 20 (marketing_manager+)
 *   - account → 0  (sign-out + profile; everyone)
 *
 * I-32 parity note: these are UI-shell convenience filters layered on top
 * of the per-action `MIN_RANK` chokepoint. Server-side RLS remains the
 * ultimate safety net — if a scanner deep-links into /hub/events, the
 * event-mgmt RPCs still refuse them.
 *
 * Per ORCH-1055 SPEC §2 / OPTION B implementation.
 */

import type { BottomNavTab } from "../components/ui/BottomNav";
import { BRAND_ROLE_RANK } from "./brandRole";

/**
 * Per-tab minimum rank to surface the tab in the bottom-nav capsule.
 *
 * Any tab id added to `TABS` in `app/(tabs)/_layout.tsx` MUST appear here.
 * Strict-grep gate `tests/strict-grep/nav-tab-gate-declared.test.ts`
 * enforces this — adds will fail CI if they omit a threshold entry.
 *
 * // orch-strict-grep-anchor MIN_RANK_FOR_TAB
 */
export const MIN_RANK_FOR_TAB = {
  home: 0,
  hub: BRAND_ROLE_RANK.finance_manager, // 30
  ari: BRAND_ROLE_RANK.finance_manager, // 30
  marketing: BRAND_ROLE_RANK.marketing_manager, // 20
  account: 0,
  // ORCH-1052 hotfix — partner earnings tab. Rank gate is 0 (any brand
  // member) but the tab is further gated by partner_enabled in
  // visibleTabsForRank below. Non-flagged users never see this tab even
  // though their rank passes.
  partner: 0,
} as const;

export type TabId = keyof typeof MIN_RANK_FOR_TAB;

/**
 * Filter the registered tab set down to those a caller at the given rank
 * is allowed to see. Stable order preserved.
 *
 * Tabs whose id is not declared in `MIN_RANK_FOR_TAB` are dropped (safer
 * default-closed posture than letting an unknown tab through). The
 * strict-grep gate prevents this from happening accidentally in code
 * review.
 */
export interface NavGateExtras {
  /**
   * Whether `creator_accounts.partner_enabled = true` for the signed-in
   * account. When false, the `partner` tab is hidden regardless of rank
   * (so non-flagged users don't see a useless Earnings tab). When true,
   * the tab surfaces immediately on the next render — paired with
   * `refetchOnWindowFocus` on `usePartnerStripeStatus`, this gives
   * near-instant visibility after an admin flips the flag.
   */
  partnerEnabled?: boolean;
}

export const visibleTabsForRank = <T extends BottomNavTab>(
  tabs: readonly T[],
  rank: number,
  extras: NavGateExtras = {},
): T[] =>
  tabs.filter((tab) => {
    // Partner-tab gate: account-level flag overrides rank-based passes.
    if (tab.id === "partner" && extras.partnerEnabled !== true) return false;
    const min = (MIN_RANK_FOR_TAB as Record<string, number | undefined>)[tab.id];
    if (min === undefined) return false;
    return rank >= min;
  });

/**
 * Returns true if the caller is a pure scanner (rank=10) with no
 * higher-tier role on the current brand. Used by `home.tsx` to early-branch
 * into the stripped-down `<ScannerHome>` surface.
 *
 * rank 0 (NO_MEMBERSHIP_RANK) is NOT scanner — those callers see the
 * regular empty-brand prompt so they can create or join.
 */
export const isScannerOnlyRank = (rank: number): boolean =>
  rank === BRAND_ROLE_RANK.scanner;
