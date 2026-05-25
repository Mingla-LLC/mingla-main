/**
 * ORCH-0965 — React Query key factory for the home-dashboard composite
 * `useUpcomingForBrand` hook. Extracted into its own keyless module so
 * `useBusinessEvents` + `useTrips` can invalidate it from their
 * mutation `onSuccess` blocks without creating a require-cycle through
 * the hook file. Pure constants — no React, no RN imports.
 *
 * Cycle previously detected by `.github/scripts/strict-grep/i-proposed-k-require-cycles.mjs`:
 *   useUpcomingForBrand.ts → useBusinessEvents.ts → useUpcomingForBrand.ts (for upcomingKeys)
 *   useUpcomingForBrand.ts → useTrips.ts          → useUpcomingForBrand.ts (for upcomingKeys)
 * Breaking via this module is the canonical fix per the cycle gate's
 * help text.
 */

export const upcomingKeys = {
  all: ["upcoming"] as const,
  forBrand: (brandId: string | null): readonly ["upcoming", string | null] =>
    ["upcoming", brandId] as const,
};
