/**
 * #3355 P5 — React Query keys for the canonical brand readiness read.
 *
 * Deliberately NESTED under `brandKeys.detail(brandId)`: every brand write
 * path that already invalidates the brand detail (Brand Edit's useUpdateBrand,
 * payments return, Stripe realtime, Ari's confirm, cover uploads, …) then
 * refreshes readiness too by prefix match, with no second list of call sites
 * to keep in sync. Nothing reads `brandKeys.details()` as a list of Brand
 * records, so the nesting cannot leak a non-Brand value into a Brand read.
 * Pure constants — no React, no Supabase import.
 */
import { brandKeys } from "./brandKeys";
import type { BrandReadinessAction } from "../services/brandReadinessService";

export const brandReadinessKeys = {
  /** Every readiness read for one brand (all actions). Invalidate this. */
  brand: (
    brandId: string,
  ): readonly ["brands", "detail", string, "readiness"] =>
    [...brandKeys.detail(brandId), "readiness"] as const,
  /** One readiness read: the whole list (`null` action) or one action's view. */
  detail: (
    brandId: string,
    action: BrandReadinessAction | null,
  ): readonly ["brands", "detail", string, "readiness", string] =>
    [...brandReadinessKeys.brand(brandId), action ?? "all"] as const,
};
