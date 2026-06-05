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
export type { MapboxAddressInputProps } from "./src/MapboxAddressInput";

export {
  autocompleteMapbox,
  retrieveMapboxPlace,
  reverseGeocodeMapbox,
  forwardGeocodeMapbox,
  newMapboxSessionToken,
} from "./src/mapboxGeocodeService";
export type {
  PlaceAutocompleteSuggestion,
  PlaceDetails,
  InvokeFn,
} from "./src/mapboxGeocodeService";

export type {
  LocationInputTokens,
  LocationInputCopy,
  LocationInputIcon,
  LocationInputIconName,
} from "./src/types";
