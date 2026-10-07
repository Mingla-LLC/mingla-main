/**
 * brandPaymentsPermission — CLIENT MIRROR of server payments predicates.
 *
 * #1863 [error-toast-covers-bank-field] §4.0.1 + #3660 Phase 3.
 *
 * SERVER SOURCE OF TRUTH (#3660):
 *
 *   biz_can_manage_payments_for_brand = effective rank >= brand_owner
 *     → bank connect / detach / onboard mutate
 *
 *   biz_can_view_payments_for_brand =
 *         biz_is_brand_admin_plus
 *      OR accepted finance_manager
 *     → status / balances / refunds visibility
 *
 * Edge mutate gate: `requirePaymentsManager` + `BRAND_PAYMENTS_ROLES`.
 * Edge view gate: `requirePaymentsViewer` + `BRAND_PAYMENTS_VIEW_ROLES`.
 *
 * `BRAND_PAYMENTS_MANAGER_ROLES` MUST stay value-identical to
 * `BRAND_PAYMENTS_ROLES` in stripeEdgeAuth.ts (#1863 C-6).
 *
 * ── THE TRAP ────────────────────────────────────────────────────────────────
 * View is still not a rank threshold — `event_manager` (40) outranks
 * `finance_manager` (30) and is denied on both predicates. Never add
 * `MANAGE_PAYMENTS` to permissionGates.ts (issue-1863 gate C-4).
 */

import type { BrandRole } from "./brandRole";

/** Value-identical to `BRAND_PAYMENTS_ROLES` in stripeEdgeAuth.ts (#3660 owner-only). */
export const BRAND_PAYMENTS_MANAGER_ROLES = ["brand_owner"] as const;

/** Value-identical to `BRAND_PAYMENTS_VIEW_ROLES` in stripeEdgeAuth.ts. */
export const BRAND_PAYMENTS_VIEW_ROLES = [
  "brand_owner",
  "brand_admin",
  "finance_manager",
] as const;

export interface BrandPaymentsPermissionInput {
  role: BrandRole | null;
  /**
   * `brand_team_members.accepted_at IS NOT NULL`. Required on both predicates.
   */
  accepted: boolean;
}

/** Mutate (bank connect/detach): brand_owner only. */
export function canManageBrandPayments(
  input: BrandPaymentsPermissionInput,
): boolean {
  const { role, accepted } = input;
  if (role === null) return false;
  if (accepted !== true) return false;
  return (BRAND_PAYMENTS_MANAGER_ROLES as readonly string[]).includes(role);
}

/** View payout status / balances: owner, admin, or finance_manager. */
export function canViewBrandPayments(
  input: BrandPaymentsPermissionInput,
): boolean {
  const { role, accepted } = input;
  if (role === null) return false;
  if (accepted !== true) return false;
  return (BRAND_PAYMENTS_VIEW_ROLES as readonly string[]).includes(role);
}

export const BRAND_PAYMENTS_DENIED_TITLE = "You don’t have permission";

/** Mutate denial — owner-only bank changes (#3660). */
export const BRAND_PAYMENTS_DENIED_BODY =
  "Only the brand owner can change payouts for this brand. Ask the brand owner if you need a bank change.";

/** View denial — not in the owner/admin/FM set. */
export const BRAND_PAYMENTS_VIEW_DENIED_BODY =
  "Only the brand owner, a brand admin, or a finance manager can view payments for this brand. Ask the brand owner to change your role.";
