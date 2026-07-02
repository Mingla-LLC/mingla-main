/**
 * ORCH-1251 — React Query key factory for brand queries, extracted into its own
 * keyless module so AuthContext.tsx can import `brandKeys` (for the token-attach
 * cache reconcile) WITHOUT creating a require-cycle through useBrands.ts (which
 * imports `useAuth` from AuthContext). Pure constants — no React, no RN imports,
 * no AuthContext import.
 *
 * Cycle that would otherwise be introduced (detected by
 * `.github/scripts/strict-grep/i-proposed-k-require-cycles.mjs`):
 *   AuthContext.tsx → useBrands.ts → AuthContext.tsx (for brandKeys)
 * Breaking via this module is the canonical fix per the cycle gate's help text
 * (same pattern as ORCH-0965's upcomingKeys.ts).
 *
 * The canonical home for these keys is HERE; useBrands.ts re-exports them for
 * backward compat so all existing `import { brandKeys } from "./useBrands"`
 * call sites keep working unchanged (Constitutional #4 — one query key per entity).
 */

export const brandKeys = {
  all: ["brands"] as const,
  lists: (): readonly ["brands", "list"] => [...brandKeys.all, "list"] as const,
  list: (
    accountId: string,
  ): readonly ["brands", "list", string] =>
    [...brandKeys.lists(), accountId] as const,
  details: (): readonly ["brands", "detail"] =>
    [...brandKeys.all, "detail"] as const,
  detail: (
    brandId: string,
  ): readonly ["brands", "detail", string] =>
    [...brandKeys.details(), brandId] as const,
  cascadePreview: (
    brandId: string,
  ): readonly ["brands", "cascade-preview", string] =>
    [...brandKeys.all, "cascade-preview", brandId] as const,
  offeringCounts: (
    brandId: string,
  ): readonly ["brand", string, "offeringCounts"] =>
    ["brand", brandId, "offeringCounts"] as const,
  // ORCH-1064 — venue-claim feedback (active round) for a brand. One key per
  // entity, from the factory (Constitution #4).
  feedback: (
    brandId: string,
  ): readonly ["brands", "feedback", string] =>
    [...brandKeys.all, "feedback", brandId] as const,
};
