/**
 * #1559 [shared-venue-screen] — re-export shim.
 *
 * The reducer's ONE owner is now
 * `packages/brand-rendering/publicVenueReservationUiState.ts`, because the
 * screen that drives it moved into that package and a package may not import
 * app `src/` (I-MOR-0827-PACKAGE-ISOLATION). This file exists so the existing
 * business-side suites keep importing the same path and exercising the same
 * code — one owner, no fork.
 */
export {
  createPublicVenueReservationUiState,
  normalizePublicVenueReservationUiState,
  publicVenueReservationUiReducer,
  safePublicVenueTab,
  type PublicVenueReservationUiAction,
  type PublicVenueReservationUiContext,
  type PublicVenueReservationUiState,
} from "@mingla/brand-rendering/publicVenueReservationUiState";
