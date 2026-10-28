/**
 * ORCH-0859 / Issue #3801 — React Query key factory for trips, in its own
 * keyless module (the `upcomingKeys` precedent) so `useIntakeSchema`, which
 * `useTrips` imports, can invalidate `tripKeys.detail` without a require-cycle.
 * Pure constants — no React, no RN imports. `useTrips` re-exports it.
 */

export const tripKeys = {
  all: ["trips"] as const,
  lists: (): readonly ["trips", "list"] =>
    [...tripKeys.all, "list"] as const,
  listByBrand: (brandId: string) =>
    [...tripKeys.lists(), brandId] as const,
  details: (): readonly ["trips", "detail"] =>
    [...tripKeys.all, "detail"] as const,
  detail: (eventId: string) =>
    [...tripKeys.details(), eventId] as const,
  soldCountsByTier: (eventId: string) =>
    [...tripKeys.detail(eventId), "soldCountsByTier"] as const,
  installmentCapability: (brandId: string) =>
    [...tripKeys.all, "installmentCapability", brandId] as const,
  public: (): readonly ["trips", "public"] =>
    [...tripKeys.all, "public"] as const,
  publicBySlug: (brandSlug: string, tripSlug: string) =>
    [...tripKeys.public(), brandSlug, tripSlug] as const,
  // Issue #2829 W4 — the trip guide: the editor's read (team only) and the
  // public read every surface draws the trip page from.
  guide: (eventId: string) => [...tripKeys.detail(eventId), "guide"] as const,
  publicGuide: (eventId: string) =>
    [...tripKeys.public(), "guide", eventId] as const,
};
