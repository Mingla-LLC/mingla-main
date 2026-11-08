// #4334 — every row of spec v1 §4.4: Google `types` → legacy featureType →
// coordinate precision (matrix R-PREC-1). Successor of the #1629
// feature_type test.
//
// Invariant I-4334-FEATURETYPE-VOCABULARY: featureType ∈ {poi, address,
// street, postcode, neighborhood, place, district, region, country, null}.
//
// Fails-on-revert: pass Google `types[0]` straight through as featureType, or
// reorder FEATURE_TYPE_ORDER so `premise` wins over `establishment` → red.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { featureTypeFromGoogleTypes, featureTypeToPrecision } from "../googleNormalize.ts";

const ROWS: Array<[string[], string | null, "exact" | "approximate"]> = [
  [["restaurant", "food", "point_of_interest", "establishment"], "poi", "exact"],
  [["night_club", "establishment"], "poi", "exact"],
  [["airport", "point_of_interest"], "poi", "exact"],
  [["street_address"], "address", "exact"],
  [["premise"], "address", "exact"],
  [["subpremise"], "address", "exact"],
  [["premise", "establishment"], "poi", "exact"],
  [["route"], "street", "approximate"],
  [["intersection"], "street", "approximate"],
  [["plus_code"], null, "approximate"],
  [["postal_code"], "postcode", "approximate"],
  [["neighborhood", "political"], "neighborhood", "approximate"],
  [["sublocality_level_1", "sublocality", "political"], "neighborhood", "approximate"],
  [["locality", "political"], "place", "approximate"],
  [["postal_town"], "place", "approximate"],
  [["colloquial_area", "political"], "place", "approximate"],
  [["administrative_area_level_3", "political"], "district", "approximate"],
  [["administrative_area_level_2", "political"], "district", "approximate"],
  [["administrative_area_level_1", "political"], "region", "approximate"],
  [["country", "political"], "country", "approximate"],
  [["natural_feature"], null, "approximate"],
  [["park"], null, "approximate"],
  [["geocode"], null, "approximate"],
  [[], null, "approximate"],
];

const VOCABULARY = new Set([
  "poi", "address", "street", "postcode", "neighborhood", "place", "district", "region", "country",
]);

Deno.test("P-1 every §4.4 row maps to the legacy featureType and its precision", () => {
  assertEquals(ROWS.length, 24, "vacuity guard: all §4.4 rows stay covered");
  for (const [types, featureType, precision] of ROWS) {
    const got = featureTypeFromGoogleTypes(types);
    assertEquals(got, featureType, JSON.stringify(types));
    assertEquals(featureTypeToPrecision(got), precision, JSON.stringify(types));
    if (got !== null) assertEquals(VOCABULARY.has(got), true);
  }
});

Deno.test("P-2 unknown or missing featureType is approximate (never over-claim, rule 9)", () => {
  for (const v of [undefined, null, "", "street_address", "establishment", "unknown"]) {
    assertEquals(featureTypeToPrecision(v as string | null | undefined), "approximate");
  }
  assertEquals(featureTypeToPrecision(" POI "), "exact");
});
