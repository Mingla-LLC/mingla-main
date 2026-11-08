/**
 * #4334 — turns a Google Places (New) place or a Geocoding API result into the
 * proxy's provider-neutral `PlaceDetails` contract.
 *
 * PURE: no Deno APIs and no remote imports. The edge function imports it, and
 * the mingla-business jest suite imports it directly (golden fixtures, Ari
 * precision rules), so the rules run in a required CI lane.
 *
 * Invariants declared here (enforced by
 * supabase/functions/mapbox-geocode/__tests__/issue_4334_golden_normalizers.test.ts
 * and issue_4334_precision_table.test.ts):
 *   I-4334-PROVIDER-NEUTRAL-CONTRACT  clients see only PlaceDetails with the
 *                                     legacy featureType vocabulary.
 *   I-4334-FEATURETYPE-VOCABULARY     featureType ∈ {poi, address, street,
 *                                     postcode, neighborhood, place, district,
 *                                     region, country, null}.
 *
 * Google docs:
 *   Place (New) resource: https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places
 *   Geocoding response:   https://developers.google.com/maps/documentation/geocoding/requests-geocoding#GeocodingResponses
 *   Place types:          https://developers.google.com/maps/documentation/places/web-service/place-types
 */

import { ISO_3166_2_BY_NAME, ISO_3166_2_SUBDIVISIONS } from "./iso3166_2.ts";

/** Places (New) address component. Geocoding components are mapped to it. */
export interface GoogleAddressComponent {
  longText?: string | null;
  shortText?: string | null;
  types?: string[] | null;
}

/** The subset of a Places (New) place the proxy reads. */
export interface GooglePlace {
  id?: string | null;
  formattedAddress?: string | null;
  addressComponents?: GoogleAddressComponent[] | null;
  location?: { latitude?: number | null; longitude?: number | null } | null;
  types?: string[] | null;
  viewport?: unknown;
}

/** The subset of a Geocoding API result the proxy reads. */
export interface GeocodingResult {
  place_id?: string | null;
  formatted_address?: string | null;
  address_components?: Array<{
    long_name?: string | null;
    short_name?: string | null;
    types?: string[] | null;
  }> | null;
  geometry?: { location?: { lat?: number | null; lng?: number | null } | null } | null;
  types?: string[] | null;
}

export type FeatureType =
  | "poi"
  | "address"
  | "street"
  | "postcode"
  | "neighborhood"
  | "place"
  | "district"
  | "region"
  | "country";

export interface PlaceDetails {
  placeId: string;
  formattedAddress: string;
  city: string;
  region: string | null;
  regionCode: string | null;
  regionCodeFull: string | null;
  countryCode: string | null;
  location: { lat: number; lng: number };
  featureType: FeatureType | null;
  provider: "google";
  /** Raw Google types, for diagnostics only. No client rule may read it. */
  providerTypes: string[];
}

/** Comparison-only normalization (NFKD, no diacritics, lower-case, spaces). */
export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Geocoding API result → the Places (New) shape, so one normalizer serves both. */
export function geocodingResultToPlace(result: GeocodingResult): GooglePlace {
  const loc = result.geometry?.location;
  return {
    id: result.place_id ?? null,
    formattedAddress: result.formatted_address ?? null,
    addressComponents: (result.address_components ?? []).map((c) => ({
      longText: c.long_name ?? null,
      shortText: c.short_name ?? null,
      types: c.types ?? [],
    })),
    location: loc
      ? { latitude: loc.lat ?? null, longitude: loc.lng ?? null }
      : null,
    types: result.types ?? [],
  };
}

function componentOf(
  components: GoogleAddressComponent[],
  type: string,
): GoogleAddressComponent | null {
  return components.find((c) => (c.types ?? []).includes(type)) ?? null;
}

function longOf(components: GoogleAddressComponent[], type: string): string | null {
  const text = componentOf(components, type)?.longText;
  return typeof text === "string" && text.trim().length > 0 ? text.trim() : null;
}

/** ISO 3166-1 alpha-2 from the `country` component, or null. */
export function countryCodeOf(components: GoogleAddressComponent[]): string | null {
  const short = componentOf(components, "country")?.shortText;
  if (typeof short !== "string") return null;
  const upper = short.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : null;
}

const NG_LAGOS_NAMES = new Set(["lagos", "lagos state"]);
const NG_ABUJA_NAMES = new Set([
  "federal capital territory",
  "fct",
  "abuja federal capital territory",
]);
const NYC_BOROUGHS: Record<string, string> = {
  "brooklyn": "Brooklyn",
  "queens": "Queens",
  "bronx": "Bronx",
  "the bronx": "Bronx",
  "staten island": "Staten Island",
  "manhattan": "Manhattan",
};

/**
 * City, per spec v2 §3.3 (Seth decision D1). Returns null when no component
 * gives a city (the caller answers `no_locality`).
 *   NG + Lagos State  → "Lagos" always (areas stay in the address line).
 *   NG + FCT          → "Abuja".
 *   US                → locality → NYC borough → postal_town → admin_3 → admin_2.
 *   elsewhere         → locality → postal_town → sublocality_level_1 →
 *                       sublocality → admin_3 → admin_2 → admin_1.
 */
export function cityOf(components: GoogleAddressComponent[]): string | null {
  const cc = countryCodeOf(components);
  const admin1 = componentOf(components, "administrative_area_level_1");
  const admin1Short = typeof admin1?.shortText === "string"
    ? admin1.shortText.trim().toUpperCase()
    : "";
  const admin1Long = typeof admin1?.longText === "string"
    ? normalizeName(admin1.longText)
    : "";

  if (cc === "NG") {
    if (admin1Short === "LA" || NG_LAGOS_NAMES.has(admin1Long)) return "Lagos";
    if (admin1Short === "FC" || NG_ABUJA_NAMES.has(admin1Long)) return "Abuja";
  }

  if (cc === "US") {
    const locality = longOf(components, "locality");
    if (locality) return locality;
    const sub1 = longOf(components, "sublocality_level_1");
    if (sub1) {
      const borough = NYC_BOROUGHS[normalizeName(sub1)];
      if (borough) return borough;
    }
    return longOf(components, "postal_town") ??
      longOf(components, "administrative_area_level_3") ??
      longOf(components, "administrative_area_level_2");
  }

  return longOf(components, "locality") ??
    longOf(components, "postal_town") ??
    longOf(components, "sublocality_level_1") ??
    longOf(components, "sublocality") ??
    longOf(components, "administrative_area_level_3") ??
    longOf(components, "administrative_area_level_2") ??
    longOf(components, "administrative_area_level_1");
}

/**
 * ISO 3166-2 subdivision code (the part after the country prefix), or null.
 * shortText is used only when it is a real subdivision of the country;
 * otherwise the long name is looked up; never sliced from a name (INV-3).
 */
export function regionCodeOf(components: GoogleAddressComponent[]): string | null {
  const cc = countryCodeOf(components);
  if (cc === null) return null;
  const admin1 = componentOf(components, "administrative_area_level_1");
  if (!admin1) return null;
  const valid = ISO_3166_2_SUBDIVISIONS[cc];
  const short = typeof admin1.shortText === "string"
    ? admin1.shortText.trim().toUpperCase()
    : "";
  if (valid && short.length > 0 && valid.has(short)) return short;
  const byName = ISO_3166_2_BY_NAME[cc];
  if (byName) {
    for (const text of [admin1.longText, admin1.shortText]) {
      if (typeof text !== "string") continue;
      const code = byName[normalizeName(text)];
      if (code) return code;
    }
  }
  return null;
}

/**
 * Legacy featureType vocabulary from Google `types`, first match wins
 * (v1 spec §4.3). Unknown → null, which every precision rule reads as
 * approximate (Constitution rule 9).
 */
const FEATURE_TYPE_ORDER: Array<[FeatureType, ReadonlyArray<string>]> = [
  ["poi", ["establishment", "point_of_interest"]],
  ["address", ["street_address", "premise", "subpremise"]],
  ["street", ["route", "intersection"]],
  ["postcode", ["postal_code"]],
  ["neighborhood", [
    "neighborhood",
    "sublocality",
    "sublocality_level_1",
    "sublocality_level_2",
    "sublocality_level_3",
    "sublocality_level_4",
    "sublocality_level_5",
  ]],
  ["place", ["locality", "postal_town", "colloquial_area"]],
  ["district", ["administrative_area_level_2", "administrative_area_level_3"]],
  ["region", ["administrative_area_level_1"]],
  ["country", ["country"]],
];

export function featureTypeFromGoogleTypes(
  types: ReadonlyArray<string> | null | undefined,
): FeatureType | null {
  const set = new Set(types ?? []);
  for (const [featureType, googleTypes] of FEATURE_TYPE_ORDER) {
    if (googleTypes.some((t) => set.has(t))) return featureType;
  }
  return null;
}

const EXACT_FEATURE_TYPES = new Set(["address", "poi"]);

/** Issue #1629 — exact iff the coordinate is a real point for that entity. */
export function featureTypeToPrecision(
  featureType: string | null | undefined,
): "exact" | "approximate" {
  if (typeof featureType !== "string") return "approximate";
  return EXACT_FEATURE_TYPES.has(featureType.trim().toLowerCase())
    ? "exact"
    : "approximate";
}

const PLUS_CODE_PREFIX =
  /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\b,?\s*/;

/** Never show a Plus Code as an address. */
export function stripPlusCode(formatted: string): string {
  return formatted.replace(PLUS_CODE_PREFIX, "").trim();
}

/** A usable coordinate: finite, in range, not the (0,0) sentinel. */
export function validLocation(
  location: GooglePlace["location"],
): { lat: number; lng: number } | null {
  const lat = location?.latitude;
  const lng = location?.longitude;
  if (
    typeof lat !== "number" || typeof lng !== "number" ||
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180 ||
    (lat === 0 && lng === 0)
  ) {
    return null;
  }
  return { lat, lng };
}

/**
 * Normalize a Google place into PlaceDetails. Returns `{ error: "no_location" }`
 * without a usable coordinate and `{ error: "no_locality" }` without a city.
 * Axis order: Google gives latitude/longitude by name — never an array.
 */
export function googlePlaceToDetails(
  place: GooglePlace,
  fallbackPlaceId: string,
): PlaceDetails | { error: "no_location" | "no_locality" } {
  const location = validLocation(place.location);
  if (location === null) return { error: "no_location" };

  const components = place.addressComponents ?? [];
  const city = cityOf(components);
  if (city === null) return { error: "no_locality" };

  const countryCode = countryCodeOf(components);
  const regionCode = regionCodeOf(components);
  const region = longOf(components, "administrative_area_level_1");
  const formatted = typeof place.formattedAddress === "string"
    ? stripPlusCode(place.formattedAddress)
    : "";
  const types = Array.isArray(place.types) ? [...place.types] : [];

  return {
    placeId: typeof place.id === "string" && place.id.length > 0
      ? place.id
      : fallbackPlaceId,
    formattedAddress: formatted.length > 0 ? formatted : city,
    city,
    region,
    regionCode,
    regionCodeFull: regionCode !== null && countryCode !== null
      ? `${countryCode}-${regionCode}`
      : null,
    countryCode,
    location,
    featureType: featureTypeFromGoogleTypes(types),
    provider: "google",
    providerTypes: types,
  };
}

/** Administrative names of a place, normalized, for the #1363 hierarchy match. */
export function administrativeNames(
  components: GoogleAddressComponent[],
): string[] {
  const wanted = [
    "locality",
    "postal_town",
    "sublocality",
    "sublocality_level_1",
    "administrative_area_level_2",
    "administrative_area_level_1",
  ];
  const names: string[] = [];
  for (const c of components) {
    if (!(c.types ?? []).some((t) => wanted.includes(t))) continue;
    if (typeof c.longText === "string") {
      const n = normalizeName(c.longText);
      if (n.length > 0) names.push(n);
    }
  }
  const city = cityOf(components);
  if (city !== null) names.push(normalizeName(city));
  return names;
}
