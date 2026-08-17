/**
 * #2099 — React Query key factory for venue reservation settings, extracted
 * into its own keyless module for the same reason as `venueAvailabilityKeys.ts`
 * (see that file for the measured mechanism): a lazy chunk that only needs the
 * key builder must not pull in the hook module's fetchers, because a module
 * reachable from two lazy chunks is hoisted by Metro into eager `__common`.
 *
 * Pure constants — no React, no RN imports, no services. The canonical home for
 * these keys is HERE; `useVenueReservationSettings.ts` re-exports them so every
 * existing call site keeps working unchanged.
 */

export const venueReservationSettingsKeys = {
  // META-ORCH-1255 — venue-scoped key, brandId-FIRST so brand-prefix
  // invalidations keep matching every venue of the brand.
  detail: (
    brandId: string,
    venueId: string,
  ): readonly ["venueReservationSettings", string, string] =>
    ["venueReservationSettings", brandId, venueId] as const,
};
