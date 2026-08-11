/**
 * brandDeletePermission — who may delete a brand. Issue #1835.
 *
 * Operator ruling (2026-08-11): brand deletion is OWNER-ONLY. A brand_admin is
 * never offered the action.
 *
 * This predicate is deliberately a MIRROR OF THE SQL THAT ACTUALLY DECIDES THE
 * OUTCOME — the `Account owner can update own brand` policy on `public.brands`,
 * whose USING *and* WITH CHECK are both `account_id = auth.uid()`.
 *
 * Why not gate on the UI `Brand.role === "owner"`: that value is derived from
 * `brand_team_members.role` (`brandsService.getBrands` maps `brand_owner` →
 * `"owner"`, everything else → `"admin"`). A `brand_owner` TEAM row on a brand
 * whose `brands.account_id` points at a different account would then be shown a
 * Delete button the database always rejects — exactly the dead affordance this
 * issue exists to remove. The deed, not the job title, decides.
 *
 * FAIL-CLOSED by construction: an absent/blank `accountId` (a Brand cached
 * before this field was mapped, or a signed-out caller) yields `false`. Hiding a
 * button that would have worked is recoverable on the next list refetch; showing
 * one that can never work is the bug being fixed.
 *
 * Related: the underlying reason a brand_admin cannot soft-delete at all is that
 * `biz_brand_effective_rank` requires `brands.deleted_at IS NULL` in both arms,
 * so the admin+ policy's WITH CHECK self-invalidates the moment `deleted_at` is
 * set (issue #1835 investigation). That policy is intentionally NOT changed by
 * this work — the ruling is owner-only.
 */

import type { Brand } from "../types/brand";

/** The minimum shape `canDeleteBrand` needs. Keeps callers and tests honest. */
export type BrandDeletableSubject = Pick<Brand, "accountId">;

/**
 * True only when the signed-in user is the brand's account owner — byte-for-byte
 * the condition the `brands` UPDATE policy enforces server-side.
 */
export function canDeleteBrand(
  brand: BrandDeletableSubject | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (brand === null || brand === undefined) return false;

  const accountId = brand.accountId;
  if (typeof accountId !== "string" || accountId.trim().length === 0) {
    return false;
  }
  if (typeof userId !== "string" || userId.trim().length === 0) {
    return false;
  }

  return accountId === userId;
}
