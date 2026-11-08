/**
 * @mingla/location-input — the shared address/city picker (field + suggestion
 * list + service) used by mingla-business (every Host address field) and
 * app-mobile (Explorer discover/preferences/onboarding). Google Maps Platform
 * behind one edge proxy since #4334.
 *
 * THE TOKEN RULE: pure presentational + service seam. The host injects tokens,
 * Icon, supabase.functions.invoke, copy, and (for gorhom sheets) a
 * BottomSheetTextInput. No design-system or supabase coupling in the package.
 */

export { AddressInput, PoweredByGoogle } from "./src/AddressInput";
export type {
  AddressInputProps,
  LocationSelectionState,
} from "./src/AddressInput";

export {
  ADDRESS_PROXY_FN,
  autocompleteAddress,
  autocompletePlaces,
  createThrottledReporter,
  errorCodeFromInvokeError,
  forwardGeocode,
  forwardHierarchy,
  newPlacesSessionToken,
  PlacesServiceError,
  // Issue #1629 — single source for "how precise is this coordinate?". Every
  // address surface must call this instead of hardcoding a precision string.
  precisionFromPlaceDetails,
  retrievePlace,
  reverseGeocode,
} from "./src/placesService";
export type {
  AutocompleteResult,
  HierarchicalForwardResult,
  HierarchicalPlaceDetails,
  InvokeFn,
  LocationBias,
  PlaceAutocompleteSuggestion,
  PlaceDetails,
  SavedLocationContext,
} from "./src/placesService";

export type {
  LocationInputAction,
  LocationInputAttribution,
  LocationInputCopy,
  LocationInputIcon,
  LocationInputIconName,
  LocationInputTokens,
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
