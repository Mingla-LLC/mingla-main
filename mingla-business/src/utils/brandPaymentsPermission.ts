/**
 * brandPaymentsPermission — the CLIENT MIRROR of the server's payments predicate.
 *
 * #1863 [error-toast-covers-bank-field] §4.0.1. Leaf module: the only import is
 * the `BrandRole` TYPE from ./brandRole, so `queryClient.ts` and every hook can
 * import it at boot without a cycle.
 *
 * SERVER SOURCE OF TRUTH — mirrored, never the reverse:
 *
 *   biz_can_manage_payments_for_brand(brand, user) =
 *         biz_is_brand_admin_plus(brand, user)              -- effective rank >= 50
 *      OR EXISTS (accepted, not-removed brand_team_members row
 *                 with role = 'finance_manager')
 *
 *   supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:3059-3073
 *   (biz_is_brand_admin_plus at :3136-3142; biz_brand_effective_rank current
 *   definition at supabase/migrations/20260819000000_orch_1047_*.sql:134-164,
 *   whose membership branch requires removed_at IS NULL AND accepted_at IS NOT
 *   NULL AND brands.deleted_at IS NULL).
 *
 * The edge functions reach it through `requirePaymentsManager` in
 * `supabase/functions/_shared/stripeEdgeAuth.ts`, which already names the answer
 * as a constant: `BRAND_PAYMENTS_ROLES = ["brand_owner","brand_admin",
 * "finance_manager"]`. `BRAND_PAYMENTS_MANAGER_ROLES` below MUST stay
 * value-identical to it.
 *
 * ── THE TRAP ────────────────────────────────────────────────────────────────
 * `event_manager` is rank 40 and `finance_manager` is rank 30, so the role that
 * OUTRANKS finance manager is the one that is denied. This predicate is not
 * expressible as a rank threshold — see `issue-1863` test T-A6, which enumerates
 * every role and asserts that NO threshold reproduces the table. `>= 30` wrongly
 * admits `event_manager`; `>= 50` wrongly denies `finance_manager`. Adding a
 * `MANAGE_PAYMENTS` entry to `./permissionGates.ts` is FORBIDDEN and the
 * class-A gate `issue-1863-payments-permission-gate.mjs` (C-4) fails the build
 * if one appears.
 *
 * Authority: the SERVER is authoritative, always. This mirror is a UX and cost
 * layer — it stops a wall of unanswerable requests and stops offering controls
 * that cannot work. It is NOT access control.
 */

import type { BrandRole } from "./brandRole";

/**
 * Value-identical to `BRAND_PAYMENTS_ROLES` in
 * `supabase/functions/_shared/stripeEdgeAuth.ts` (the parity clause of
 * I-PROPOSED-1863-CLIENT-PAYMENTS-PERMISSION-PARITY; gate assertion C-6 checks
 * these three literals against that real server file on every PR).
 */
export const BRAND_PAYMENTS_MANAGER_ROLES = [
  "brand_owner",
  "brand_admin",
  "finance_manager",
] as const;

export interface BrandPaymentsPermissionInput {
  role: BrandRole | null;
  /**
   * `brand_team_members.accepted_at IS NOT NULL`. Required, not optional: the
   * server requires acceptance on BOTH branches of the disjunction. A client
   * that ignored it would grant a PENDING `brand_admin` the full surface and
   * hand them the identical 403 storm this issue exists to kill — the same bug,
   * one invitation away.
   */
  accepted: boolean;
}

/**
 * Role-set MEMBERSHIP test. No rank arithmetic anywhere in this body.
 */
export function canManageBrandPayments(
  input: BrandPaymentsPermissionInput,
): boolean {
  const { role, accepted } = input;
  if (role === null) return false;
  if (accepted !== true) return false;
  return (BRAND_PAYMENTS_MANAGER_ROLES as readonly string[]).includes(role);
}

/**
 * Denial copy. Exported so the route gate, the payments view's stale-role
 * fallback, the onboard `permission-denied` ViewState and both regression
 * suites share ONE string and cannot drift.
 *
 * #1863 §4.4.1 replaced the shipped copy, which said "Only Brand Admin or
 * Finance Manager RANK can set up payments. Ask your account owner to invite
 * you with a higher role." Three concrete faults: (1) an `event_manager` at
 * rank 40 outranks Finance Manager's 30, so "rank" tells them they qualify and
 * the app is broken; (2) it omits Brand Owner, who is also allowed; (3)
 * "account owner" is a label renamed to `brand_owner` at ORCH-1047, and
 * "invite you" is wrong for someone who is already a member — they need a
 * CHANGED role, not an invitation.
 *
 * Roles are named as ROLES, never ranks, and the allowed set is stated
 * completely in the same order as BRAND_PAYMENTS_MANAGER_ROLES. There is no
 * mention of connection or retry, because there is nothing to retry.
 */
export const BRAND_PAYMENTS_DENIED_TITLE = "You don’t have permission";

export const BRAND_PAYMENTS_DENIED_BODY =
  "Only the brand owner, a brand admin, or a finance manager can manage payments for this brand. Ask the brand owner to change your role.";
