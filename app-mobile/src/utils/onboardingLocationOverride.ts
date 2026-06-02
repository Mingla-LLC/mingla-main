/**
 * ORCH-1036 [launch-city gate override clobber]
 *
 * Pure derivation of the four location-override fields that the FINAL onboarding
 * preferences save (`handleSavePreferences` in OnboardingFlow.tsx) must persist.
 *
 * Why this exists as its own pure function:
 * The launch-city gate (ORCH-1028 `handleLaunchGateConfirmCity`) writes
 * `custom_location` + `custom_lat/lng` + `use_gps_location=false` to the
 * `preferences` row at the location step. A LATER onboarding step
 * (`handleSavePreferences`) re-upserts the same row. PostgREST upsert is
 * column-scoped: any key present in the payload (including an explicit `null`)
 * overwrites that column; omitted keys are preserved. The bug (ORCH-1036) was
 * that `handleSavePreferences` sourced `custom_location` from the always-null
 * `data.manualLocation` (the gate never sets `manualLocation`), nulling the
 * gate's `custom_location` while the coords survived — a deck-works-but-
 * blank-city state.
 *
 * The fix: derive all four fields from the SAME onboarding state the location
 * step populated, keyed off `use_gps_location`. This is a derivation of existing
 * state, NOT a third independent writer of the location fields
 * (I-1028-ONE-LOCATION-OWNER honored).
 *
 *  - GPS user (use_gps_location=true)  → custom_location/lat/lng = null
 *  - non-GPS user (false)              → custom_location = gate's cityName,
 *                                        falling back to the legacy manual-location
 *                                        string; coords from data.coordinates.
 */
export interface OnboardingLocationState {
  useGpsLocation: boolean
  /** Set by the launch-city gate (ORCH-1028) AND by GPS capture. */
  cityName: string | null
  /** Set by the legacy manual-location flow (typed city). Gate never sets this. */
  manualLocation: string | null
  coordinates: { lat: number; lng: number } | null
}

export interface ResolvedLocationOverride {
  custom_location: string | null
  custom_lat: number | null
  custom_lng: number | null
}

/**
 * Resolve the location-override columns for the final onboarding preferences save
 * so that a launch-city / manual-location override SURVIVES the save, while a true
 * GPS user ends up with a clean (null) custom location.
 */
export function resolveOnboardingLocationOverride(
  state: OnboardingLocationState
): ResolvedLocationOverride {
  if (state.useGpsLocation) {
    // True GPS user: no custom override. Never leave a stale custom_location.
    return { custom_location: null, custom_lat: null, custom_lng: null }
  }
  // Non-GPS: preserve whatever the location step wrote. The launch-city gate sets
  // `cityName`; the legacy manual-location flow sets `manualLocation`.
  return {
    custom_location: state.cityName ?? state.manualLocation ?? null,
    custom_lat: state.coordinates?.lat ?? null,
    custom_lng: state.coordinates?.lng ?? null,
  }
}
