// #4334 — golden normalizer tests (spec v1 §7.2, v2 §3.3; matrix R-CITY-1,
// R-COPY-2, R-DIST-1, the D1 Lagos rule).
//
// Invariant I-4334-PROVIDER-NEUTRAL-CONTRACT: clients see only PlaceDetails,
// with the legacy featureType vocabulary (googleNormalize.ts).
//
// Inputs: the real Google Place Details responses recorded in the #4334
// bake-off (fixtures/issue4334/bakeoff_places.json), plus hand-built Google
// shapes for cases the bake-off did not cover (London, Zaventem, Abuja, a
// Plus Code address, axis and sentinel checks). Each hand-built case says so.
//
// Fails-on-revert:
//   G-1 drop the NG/Lagos branch in cityOf      → "Lekki" comes back, red.
//   G-2 drop the US NYC-borough branch          → Brooklyn → county, red.
//   G-4 return shortText unvalidated            → "England" as a code, red.
//   G-6 swap latitude/longitude in validLocation→ axis assertion red.
//   G-7 remove stripPlusCode                    → plus code kept, red.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  featureTypeToPrecision,
  geocodingResultToPlace,
  type GooglePlace,
  googlePlaceToDetails,
  type PlaceDetails,
} from "../googleNormalize.ts";

const doc = JSON.parse(
  await Deno.readTextFile(new URL("./fixtures/issue4334/bakeoff_places.json", import.meta.url)),
) as {
  fixtures: Array<{
    id: string;
    query: string;
    google_place: GooglePlace;
    google_geocoding_result: Record<string, unknown>;
    before_4334: { country_code: string | null; city: string | null; feature_type: string | null };
  }>;
};

function details(place: GooglePlace): PlaceDetails {
  const d = googlePlaceToDetails(place, "fallback");
  if ("error" in d) throw new Error(`unexpected ${d.error}`);
  return d;
}

/** Expected per bake-off fixture (city per D1; precision per spec v1 §4.4). */
const EXPECTED: Record<string, { city: string; regionCode: string; country: string; precision: "exact" | "approximate" }> = {
  "1_addr": { city: "Lagos", regionCode: "LA", country: "NG", precision: "exact" },
  "2_name": { city: "Lagos", regionCode: "LA", country: "NG", precision: "exact" },
  "2_addr": { city: "Lagos", regionCode: "LA", country: "NG", precision: "exact" },
  "3_name": { city: "Lagos", regionCode: "LA", country: "NG", precision: "exact" },
  "3_addr": { city: "Lagos", regionCode: "LA", country: "NG", precision: "exact" },
  "4_name": { city: "Lagos", regionCode: "LA", country: "NG", precision: "exact" },
  "4_addr": { city: "Lagos", regionCode: "LA", country: "NG", precision: "exact" },
  "5_name": { city: "Lagos", regionCode: "LA", country: "NG", precision: "exact" },
  // "Gameland, Admiralty Way": Google answers with the street (route) → approximate.
  "5_addr": { city: "Lagos", regionCode: "LA", country: "NG", precision: "approximate" },
  "6_name": { city: "Lagos", regionCode: "LA", country: "NG", precision: "exact" },
  "6_addr": { city: "Lagos", regionCode: "LA", country: "NG", precision: "exact" },
  "7_name": { city: "Raleigh", regionCode: "NC", country: "US", precision: "exact" },
  "7_addr": { city: "Raleigh", regionCode: "NC", country: "US", precision: "exact" },
  "8_name": { city: "Cary", regionCode: "NC", country: "US", precision: "exact" },
  "8_addr": { city: "Cary", regionCode: "NC", country: "US", precision: "exact" },
  "9_addr": { city: "Raleigh", regionCode: "NC", country: "US", precision: "exact" },
  "10_addr": { city: "Brooklyn", regionCode: "NY", country: "US", precision: "exact" },
};

Deno.test("G-0 every recorded bake-off fixture has an expectation (vacuity guard)", () => {
  assertEquals(doc.fixtures.length, 17);
  for (const f of doc.fixtures) assert(EXPECTED[f.id], `no expectation for ${f.id}`);
});

Deno.test("G-1 bake-off fixtures: city (D1), region code, country, precision", () => {
  for (const f of doc.fixtures) {
    const want = EXPECTED[f.id];
    const d = details(f.google_place);
    assertEquals(d.city, want.city, `${f.id} city`);
    assertEquals(d.regionCode, want.regionCode, `${f.id} regionCode`);
    assertEquals(d.regionCodeFull, `${want.country}-${want.regionCode}`, `${f.id} regionCodeFull`);
    assertEquals(d.countryCode, want.country, `${f.id} countryCode`);
    assertEquals(featureTypeToPrecision(d.featureType), want.precision, `${f.id} precision`);
    assertEquals(d.provider, "google");
    assert(d.formattedAddress.length > 0, `${f.id} empty address`);
    // Same country as the pre-#4334 answer whenever it found the right place.
    if (f.before_4334.country_code === "NG" || f.before_4334.country_code === "US") {
      assertEquals(d.countryCode, f.before_4334.country_code, `${f.id} country vs before`);
    }
  }
});

Deno.test("G-1b D1: every Lagos State address is city Lagos, whatever the locality (Lekki, Ikate)", () => {
  const quays = doc.fixtures.find((f) => f.id === "2_name")!;
  const locality = quays.google_place.addressComponents!.find((c) => c.types?.includes("locality"));
  assertEquals(locality?.longText, "Lekki");
  assertEquals(details(quays.google_place).city, "Lagos");
  // the area stays in the address line
  assert(details(quays.google_place).formattedAddress.includes("Lekki"));
});

Deno.test("G-1c the Geocoding shape normalizes to the same answer as the Places shape", () => {
  for (const f of doc.fixtures) {
    const a = details(f.google_place);
    const b = details(geocodingResultToPlace(f.google_geocoding_result));
    assertEquals(b.city, a.city, f.id);
    assertEquals(b.regionCode, a.regionCode, f.id);
    assertEquals(b.countryCode, a.countryCode, f.id);
    assertEquals(b.location, a.location, f.id);
    assertEquals(b.featureType, a.featureType, f.id);
  }
});

Deno.test("G-2 US: Brooklyn (sublocality, no locality) is the city, never Kings County", () => {
  const f = doc.fixtures.find((x) => x.id === "10_addr")!;
  assertEquals(details(f.google_place).city, "Brooklyn");
});

// ── hand-built Google shapes (cases the bake-off did not record) ────────────
const comp = (longText: string, shortText: string, ...types: string[]) => ({ longText, shortText, types });

Deno.test("G-3 Abuja FCT → city Abuja, region FC (hand-built shape)", () => {
  const d = details({
    id: "ChIJhandbuilt_abuja",
    formattedAddress: "Plot 1, Herbert Macaulay Way, Central Business District, Abuja 900103, Federal Capital Territory, Nigeria",
    addressComponents: [
      comp("Central Business District", "Central Business District", "neighborhood", "political"),
      comp("Abuja Municipal Area Council", "AMAC", "administrative_area_level_2", "political"),
      comp("Federal Capital Territory", "FC", "administrative_area_level_1", "political"),
      comp("Nigeria", "NG", "country", "political"),
    ],
    location: { latitude: 9.0579, longitude: 7.4951 },
    types: ["street_address"],
  });
  assertEquals(d.city, "Abuja");
  assertEquals(d.regionCode, "FC");
});

Deno.test("G-4 London: shortText 'England' is not ISO → mapped to ENG by name; never a sliced name", () => {
  const d = details({
    id: "ChIJhandbuilt_london",
    formattedAddress: "10 Downing St, London SW1A 2AA, UK",
    addressComponents: [
      comp("London", "London", "postal_town"),
      comp("Greater London", "Greater London", "administrative_area_level_2", "political"),
      comp("England", "England", "administrative_area_level_1", "political"),
      comp("United Kingdom", "GB", "country", "political"),
    ],
    location: { latitude: 51.5033635, longitude: -0.1276248 },
    types: ["premise"],
  });
  assertEquals(d.city, "London");
  assertEquals(d.regionCode, "ENG");
  assertEquals(d.regionCodeFull, "GB-ENG");
});

Deno.test("G-4b Zaventem: Belgian province by name → VBR; an unknown region is null, not a guess", () => {
  const d = details({
    id: "ChIJhandbuilt_zaventem",
    formattedAddress: "1930 Zaventem, Belgium",
    addressComponents: [
      comp("Zaventem", "Zaventem", "locality", "political"),
      comp("Vlaams-Brabant", "VB", "administrative_area_level_2", "political"),
      comp("Vlaams-Brabant", "VB", "administrative_area_level_1", "political"),
      comp("Belgium", "BE", "country", "political"),
    ],
    location: { latitude: 50.8838, longitude: 4.4715 },
    types: ["locality", "political"],
  });
  assertEquals(d.regionCode, "VBR");
  const fr = details({
    id: "ChIJhandbuilt_paris",
    formattedAddress: "Paris, France",
    addressComponents: [
      comp("Paris", "Paris", "locality", "political"),
      comp("Île-de-France", "IDF", "administrative_area_level_1", "political"),
      comp("France", "FR", "country", "political"),
    ],
    location: { latitude: 48.8566, longitude: 2.3522 },
    types: ["locality", "political"],
  });
  assertEquals(fr.regionCode, null);
  assertEquals(fr.regionCodeFull, null);
});

Deno.test("G-5 Lekki the AREA (locality pick) → city Lagos, precision approximate", () => {
  const d = details({
    id: "ChIJhandbuilt_lekki",
    formattedAddress: "Lekki, Lagos, Nigeria",
    addressComponents: [
      comp("Lekki", "Lekki", "locality", "political"),
      comp("Eti Osa", "Eti Osa", "administrative_area_level_2", "political"),
      comp("Lagos", "LA", "administrative_area_level_1", "political"),
      comp("Nigeria", "NG", "country", "political"),
    ],
    location: { latitude: 6.4698, longitude: 3.5852 },
    types: ["locality", "political"],
  });
  assertEquals(d.city, "Lagos");
  assertEquals(d.featureType, "place");
  assertEquals(featureTypeToPrecision(d.featureType), "approximate");
});

Deno.test("G-6 axis order: location is {lat: latitude, lng: longitude}; (0,0) and out-of-range rejected", () => {
  const f = doc.fixtures.find((x) => x.id === "6_name")!;
  const d = details(f.google_place);
  assertEquals(d.location, { lat: 6.4325387, lng: 3.4236888999999997 });
  const zero = googlePlaceToDetails({ ...f.google_place, location: { latitude: 0, longitude: 0 } }, "x");
  assertEquals(zero, { error: "no_location" });
  const bad = googlePlaceToDetails({ ...f.google_place, location: { latitude: 120, longitude: 3 } }, "x");
  assertEquals(bad, { error: "no_location" });
});

Deno.test("G-7 a Plus Code never reaches the address line (hand-built rural NG shape)", () => {
  const d = details({
    id: "ChIJhandbuilt_rural",
    formattedAddress: "6FR5CCMF+2F, Epe, Nigeria",
    addressComponents: [
      comp("Epe", "Epe", "locality", "political"),
      comp("Lagos", "LA", "administrative_area_level_1", "political"),
      comp("Nigeria", "NG", "country", "political"),
    ],
    location: { latitude: 6.58, longitude: 3.98 },
    types: ["plus_code"],
  });
  assertEquals(d.formattedAddress, "Epe, Nigeria");
  assertEquals(d.featureType, null);
});

Deno.test("G-8 no derivable city → no_locality", () => {
  const r = googlePlaceToDetails({
    id: "x",
    formattedAddress: "Somewhere",
    addressComponents: [comp("Nowhere Land", "NL", "country", "political")],
    location: { latitude: 1, longitude: 1 },
    types: ["country"],
  }, "x");
  assertEquals(r, { error: "no_locality" });
});
