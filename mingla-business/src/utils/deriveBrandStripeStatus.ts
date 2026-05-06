/**
 * TS twin of pg_derive_brand_stripe_status.
 * MUST stay byte-for-byte equivalent to the SQL helper per
 * SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.1.3.
 *
 * Inputs come from either:
 *  - brands.stripe_* denormalized cache (used by mapBrandRowToUi for fast list rendering)
 *  - stripe_connect_accounts row (used directly when full state is loaded)
 *
 * Returns: one of "not_connected" | "onboarding" | "active" | "restricted"
 *
 * Used by:
 *  - mapBrandRowToUi (services/brandMapping.ts) for fast list rendering from cache
 *  - useBrandStripeStatus hook (when reading full stripe_connect_accounts row)
 *
 * Pairs with SQL function pg_derive_brand_stripe_status which the
 * brand-stripe-refresh-status edge function calls server-side.
 *
 * Test parity: __tests__/deriveBrandStripeStatus.test.ts covers ≥12 cases
 * mirroring the SQL CASE branches.
 */

import type { BrandStripeStatus } from "../store/currentBrandStore";

export interface DeriveBrandStripeStatusInput {
  /** Whether a stripe_connect_accounts row exists for this brand. */
  has_account: boolean;
  /** From stripe_connect_accounts.charges_enabled (or brands.stripe_charges_enabled cache). */
  charges_enabled: boolean | null | undefined;
  /** From stripe_connect_accounts.payouts_enabled (or cache). */
  payouts_enabled: boolean | null | undefined;
  /**
   * From stripe_connect_accounts.requirements JSONB. Cache does NOT carry
   * this — pass `null` when reading from the brands.stripe_* cache.
   */
  requirements?: { disabled_reason?: string | null } | null;
  /**
   * From stripe_connect_accounts.detached_at. NULL while account active.
   * Cache does NOT carry this — pass `null` from the brands.stripe_* cache;
   * detach state will read as "active" (cache stale until trigger fires on
   * actual detach in B2b).
   */
  detached_at?: string | null;
}

export function deriveBrandStripeStatus(
  input: DeriveBrandStripeStatusInput,
): BrandStripeStatus {
  // Mirror of SQL CASE branches:
  // 1. No row → not_connected
  if (!input.has_account) return "not_connected";
  // 2. detached_at IS NOT NULL → not_connected
  if (input.detached_at != null) return "not_connected";
  // 3. requirements has disabled_reason → restricted
  if (input.requirements?.disabled_reason) return "restricted";
  // 4. charges_enabled = true → active
  if (input.charges_enabled === true) return "active";
  // 5. else → onboarding
  return "onboarding";
}
