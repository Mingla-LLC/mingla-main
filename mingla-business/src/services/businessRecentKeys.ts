/**
 * Issue #3827 — React Query key factory for Business Home > Recent.
 *
 * Kept in its own keyless module (pure constants, no React / RN / Supabase
 * imports) so trip mutations in `useTrips` can invalidate Recent after a cover
 * save without pulling the Recent service graph into every route that loads
 * `useTrips`. `businessRecentService` re-exports this as the single factory.
 */
export const businessRecentKeys = {
  all: ["business-recent"] as const,
  index: (userId: string, brandId: string) =>
    ["business-recent-index", userId, brandId] as const,
  pages: (userId: string, brandId: string) =>
    ["business-recent-page", userId, brandId] as const,
  page: (userId: string, brandId: string, page: number, cursor: string) =>
    ["business-recent-page", userId, brandId, page, cursor] as const,
};
