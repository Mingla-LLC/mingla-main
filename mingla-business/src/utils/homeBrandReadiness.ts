/**
 * #3355 P5 — turn the canonical readiness answer into the to-do builder's
 * input. Pure (no React, no Supabase): the one place Home's view of
 * brand_readiness is shaped, so the hook and the tests use the same mapping.
 * Ari's brand-wide "not now" (item.deferral) is deliberately NOT read: Home
 * always lists every outstanding item as a reminder (Seth, 2026-11-01).
 */
import type { BrandReadiness } from "../services/brandReadinessService";
import type { BrandRole } from "./brandRole";
import type { BusinessTodoBrandReadiness } from "./businessTodos";

export interface HomeBrandReadinessInput {
  brandId: string | null;
  readiness: BrandReadiness | undefined;
  readinessFailed: boolean;
  role: BrandRole | null;
  roleLoading: boolean;
}

export function toHomeBrandReadiness({
  brandId,
  readiness,
  readinessFailed,
  role,
  roleLoading,
}: HomeBrandReadinessInput): BusinessTodoBrandReadiness | undefined {
  if (brandId === null) return undefined;
  // The role decides whether a scanner sees these rows at all: wait for it.
  if (roleLoading) return { status: "loading" };
  if (readiness !== undefined && readiness.brandId === brandId) {
    return {
      status: "ready",
      brandId,
      editRoute: `/brand/${brandId}/edit`,
      // C9 (decided in the SPEC): scanners see no profile or money rows.
      hideBrandRows: role === "scanner",
      items: readiness.items.map((item) => ({
        key: item.key,
        state: item.state,
        canCallerFix: item.fix.canCallerFix,
        whoCanFix: item.fix.whoCanFix,
      })),
    };
  }
  if (readinessFailed) return { status: "error", brandId };
  return { status: "loading" };
}
