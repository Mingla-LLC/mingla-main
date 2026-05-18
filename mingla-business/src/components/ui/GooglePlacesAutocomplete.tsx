/**
 * Ve1 — Google Places field; server key stays in `places-autocomplete` edge function.
 */

export {
  AddressAutocompleteInput as GooglePlacesAutocomplete,
} from "../event/AddressAutocompleteInput";
export type {
  PlaceAutocompleteSuggestion,
  PlaceDetails,
} from "../../services/googlePlacesService";
