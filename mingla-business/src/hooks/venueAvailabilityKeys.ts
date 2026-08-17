/**
 * #2099 — React Query key factory for venue availability, extracted into its own
 * keyless module so a LAZY chunk can invalidate these caches WITHOUT importing
 * `useVenueAvailability.ts` and dragging its fetchers into the eager payload.
 *
 * Same pattern, and same reason in kind, as `brandKeys.ts` and ORCH-0965's
 * `upcomingKeys.ts`: pure constants — no React, no RN imports, no services.
 *
 * The mechanism this exists to prevent, measured on #2099 (PR #2104):
 * `PendingVenueIdentityCorrectionDialog.web.tsx` is loaded on intent, so it is
 * its own async chunk. It imported `venueAvailabilityKeys` from the hook
 * module. That made the hook module reachable from TWO lazy chunks — the venue
 * route and the dialog — and Metro hoists a module shared between two lazy
 * chunks into eager `__common`. Cost, by source-map attribution:
 * `useVenueAvailability.ts` +5,571 B and `useVenueReservationSettings.ts`
 * +2,705 B of boot payload that no boot screen uses.
 *
 * The canonical home for these keys is HERE; `useVenueAvailability.ts`
 * re-exports them so every existing call site keeps working unchanged
 * (Constitutional #4 — one query key per entity).
 *
 * META-ORCH-1255 — keys are venue-scoped, brandId-FIRST so existing
 * brand-prefix invalidations (e.g. useBrandHours' pinned
 * `venueAvailabilityKeys.config(brandId)`) keep matching every venue of the
 * brand via react-query prefix matching.
 */

export const venueAvailabilityKeys = {
  config: (
    brandId: string,
    venueId?: string,
  ): readonly ("venueAvailabilityConfig" | string)[] =>
    venueId === undefined
      ? (["venueAvailabilityConfig", brandId] as const)
      : (["venueAvailabilityConfig", brandId, venueId] as const),
  blackouts: (
    brandId: string,
    venueId?: string,
  ): readonly ("venueBlackouts" | string)[] =>
    venueId === undefined
      ? (["venueBlackouts", brandId] as const)
      : (["venueBlackouts", brandId, venueId] as const),
  slots: (
    venueScopeId: string,
    date: string,
    partySize: number,
  ): readonly ["venueAvailableSlots", string, string, number] =>
    ["venueAvailableSlots", venueScopeId, date, partySize] as const,
};
