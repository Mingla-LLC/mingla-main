/**
 * Per-action minimum role rank thresholds (Cycle 13a).
 *
 * Single chokepoint for all mobile UI gates. Mirrors RLS server-side checks
 * via biz_role_rank thresholds in the SECURITY DEFINER wrappers.
 *
 * I-32: thresholds MUST match RLS server-side enforcement. If RLS allows
 * an action, mobile MUST surface it (no UX dishonesty); if RLS blocks, mobile
 * MUST hide/disable (no dead taps per Const #1).
 *
 * Per Cycle 13a SPEC §4.5.
 */

import { BRAND_ROLE_RANK } from "./brandRole";

export const MIN_RANK = {
  // J-T6 gates (Cycle 13a)
  EDIT_EVENT: BRAND_ROLE_RANK.event_manager, // 40
  EDIT_TICKET_PRICE: BRAND_ROLE_RANK.finance_manager, // 30
  REFUND_ORDER: BRAND_ROLE_RANK.finance_manager, // 30
  REFUND_DOOR_SALE: BRAND_ROLE_RANK.finance_manager, // 30
  // Cycle 13 — read-only reconciliation surface (D-13-3 per DEC-095).
  // Forward-compat: when B-cycle wires server-side reconciliation RPC, the
  // RLS policy MUST mirror finance_manager+ rank gate to preserve I-32.
  VIEW_RECONCILIATION: BRAND_ROLE_RANK.finance_manager, // 30
  ADD_COMP_GUEST: BRAND_ROLE_RANK.event_manager, // 40
  MANAGE_SCANNERS: BRAND_ROLE_RANK.event_manager, // 40
  CREATE_EVENT: BRAND_ROLE_RANK.event_manager, // 40
  // Team management gates (J-T1..J-T4)
  INVITE_TEAM_MEMBER: BRAND_ROLE_RANK.brand_admin, // 50
  REMOVE_TEAM_MEMBER: BRAND_ROLE_RANK.brand_admin, // 50
  REVOKE_INVITATION: BRAND_ROLE_RANK.brand_admin, // 50
  VIEW_AUDIT_LOG: BRAND_ROLE_RANK.brand_admin, // 50
  // 13b expansion targets (defined now for forward-compat; not used in 13a):
  EDIT_PERMISSIONS_OVERRIDE: BRAND_ROLE_RANK.brand_admin, // 50 — 13b
  ASSIGN_EVENT_MANAGER_TO_EVENT: BRAND_ROLE_RANK.brand_admin, // 50 — 13b
} as const;

export type GatedAction = keyof typeof MIN_RANK;

export const canPerformAction = (
  currentRank: number,
  action: GatedAction,
): boolean => currentRank >= MIN_RANK[action];

/**
 * Friendly disabled-state caption for a gated action.
 * Const #1 No dead taps — gated buttons disable WITH a caption explaining why.
 */
export const gateCaptionFor = (action: GatedAction): string => {
  const requiredRank = MIN_RANK[action];
  const requiredRoleName = ((): string => {
    if (requiredRank >= BRAND_ROLE_RANK.account_owner) return "account owner";
    if (requiredRank >= BRAND_ROLE_RANK.brand_admin)
      return "brand admin or above";
    if (requiredRank >= BRAND_ROLE_RANK.event_manager)
      return "event manager or above";
    if (requiredRank >= BRAND_ROLE_RANK.finance_manager)
      return "finance manager or above";
    return "team member";
  })();
  return `Your role doesn't include this action. Ask a ${requiredRoleName}.`;
};
