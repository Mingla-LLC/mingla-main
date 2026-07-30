/**
 * @mingla/location-input — shared Mapbox Search Box address/city picker
 * (field + suggestion list + service) consumed by BOTH mingla-business
 * (experience stops) and app-mobile (consumer discover/preferences/onboarding).
 *
 * THE TOKEN RULE: pure presentational + service seam. The host injects tokens,
 * Icon, supabase.functions.invoke, copy, and (for gorhom sheets) a
 * BottomSheetTextInput. No design-system or supabase coupling in the package.
 *
 * Extracted per META-ORCH-1060 [Mapbox consumer migration] §3.2.
 */

export { MapboxAddressInput } from "./src/MapboxAddressInput";
export type {
  MapboxAddressInputProps,
  LocationSelectionState,
} from "./src/MapboxAddressInput";

export {
  autocompleteMapbox,
  retrieveMapboxPlace,
  reverseGeocodeMapbox,
  forwardGeocodeMapbox,
  forwardHierarchyMapbox,
  newMapboxSessionToken,
} from "./src/mapboxGeocodeService";
export type {
  PlaceAutocompleteSuggestion,
  PlaceDetails,
  SavedLocationContext,
  HierarchicalPlaceDetails,
  HierarchicalForwardResult,
  InvokeFn,
} from "./src/mapboxGeocodeService";

export type {
  LocationInputTokens,
  LocationInputAction,
  LocationInputCopy,
  LocationInputIcon,
  LocationInputIconName,
} from "./src/types";

// Issue #1363 (device-UX F2) — pure assist-footer helpers (timing + accent),
// exported so hosts + tests can exercise the free-text ACTION-row logic.
export {
  computeShowFreeTextRow,
  resolveFreeTextRowStyle,
} from "./src/assistFooter";
export type {
  AssistFooterStatusKind,
  FreeTextRowStyle,
} from "./src/assistFooter";
