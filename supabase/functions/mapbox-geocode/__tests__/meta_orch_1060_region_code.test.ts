// META-ORCH-1060 [Mapbox consumer migration] — keystone regression test.
//
// Proves the `featureToDetails` normalizer extracts the STRUCTURED ISO codes
// (regionCode / regionCodeFull / countryCode) from Mapbox context.region /
// context.country — NEVER parsed from a display string — and preserves all v19
// fields. Mocks a documented Mapbox Search Box /retrieve feature shape:
//   https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature
//
// CLOSE Step 0.5: PASSES on the keystone commit, MUST FAIL on revert (e.g. if
// the handler reverts to `region = ctx.region?.name` only and drops regionCode,
// or if codes are derived from a string parse instead of region_code).
//
// Run: deno test --allow-env --allow-net \
//   supabase/functions/mapbox-geocode/__tests__/meta_orch_1060_region_code.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { featureToDetails } from "../index.ts";

// Documented Search Box retrieve feature for Raleigh, NC (structured context).
function raleighFeature() {
  return {
    geometry: { coordinates: [-78.6382, 35.7796] as [number, number] }, // [lng, lat]
    properties: {
      mapbox_id: "dXJuOm1ieHBvaTpyYWxlaWdo",
      full_address: "Raleigh, North Carolina, United States",
      place_formatted: "Raleigh, North Carolina, United States",
      context: {
        place: { name: "Raleigh" },
        region: {
          name: "North Carolina",
          region_code: "NC", // ISO 3166-2 subdivision part
          region_code_full: "US-NC",
        },
        country: { name: "United States", country_code: "us" },
      },
    },
  };
}

Deno.test("T-01 keystone happy: Raleigh → structured regionCode NC + countryCode US", () => {
  const details = featureToDetails(raleighFeature(), "fallback");
  assert(!("error" in details), "should not error on a complete feature");
  if ("error" in details) return;
  assertEquals(details.city, "Raleigh"); // exact-matches events.city token
  assertEquals(details.region, "North Carolina"); // name preserved (v19 field)
  assertEquals(details.regionCode, "NC"); // STRUCTURED, uppercased
  assertEquals(details.regionCodeFull, "US-NC");
  assertEquals(details.countryCode, "US");
  assertEquals(details.location, { lat: 35.7796, lng: -78.6382 });
  assertEquals(details.placeId, "dXJuOm1ieHBvaTpyYWxlaWdo");
});

Deno.test("T-01c keystone region omitted: regionCode is null (no throw, no parse)", () => {
  const feature = raleighFeature();
  // A feature whose display string ("Raleigh, North Carolina, ...") WOULD parse
  // to "NC", but with NO structured region_code — must yield null, proving the
  // code follows region_code, NOT the string (INV-3).
  feature.properties.context.region = { name: "North Carolina" } as any;
  const details = featureToDetails(feature, "fallback");
  assert(!("error" in details));
  if ("error" in details) return;
  assertEquals(details.regionCode, null);
  assertEquals(details.regionCodeFull, null);
  assertEquals(details.region, "North Carolina"); // name still present
  assertEquals(details.countryCode, "US");
});

Deno.test("T-01b keystone non-US: London → countryCode GB, structured region", () => {
  const feature = {
    geometry: { coordinates: [-0.1276, 51.5072] as [number, number] },
    properties: {
      mapbox_id: "london",
      full_address: "London, England, United Kingdom",
      context: {
        place: { name: "London" },
        region: { name: "England", region_code: "ENG", region_code_full: "GB-ENG" },
        country: { name: "United Kingdom", country_code: "gb" },
      },
    },
  };
  const details = featureToDetails(feature, "london");
  assert(!("error" in details));
  if ("error" in details) return;
  assertEquals(details.city, "London");
  assertEquals(details.countryCode, "GB");
  assertEquals(details.regionCode, "ENG");
});

Deno.test("keystone honest error: no coordinates → no_location", () => {
  const feature = { properties: { context: { place: { name: "Nowhere" } } } } as any;
  const details = featureToDetails(feature, "x");
  assert("error" in details);
  if ("error" in details) assertEquals(details.error, "no_location");
});

Deno.test("keystone honest error: no derivable city → no_locality", () => {
  const feature = {
    geometry: { coordinates: [1, 2] as [number, number] },
    properties: { context: { region: { name: "X", region_code: "X1" } } },
  };
  const details = featureToDetails(feature as any, "x");
  assert("error" in details);
  if ("error" in details) assertEquals(details.error, "no_locality");
});
