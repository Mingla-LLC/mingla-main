// ORCH-1079 [Business-venue Google→Mapbox sweep] — §3.D.1 region fallback.
//
// Proves the `featureToDetails` normalizer no longer 500s ("no_locality") on a
// POI feature whose Mapbox context lacks place/locality/district: it now falls
// back to context.region.name as a last-resort human-readable locality so a real
// venue pick resolves instead of failing loudly. Additive — the new branch only
// fires when place/locality/district are ALL absent.
//   https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature
//
// Step 0.5 regression: PASSES on the fixed code; MUST FAIL on revert (if the
// city chain drops `?? ctx.region?.name` the POI feature 500s with no_locality).
//
// Run: deno test --allow-env --allow-net \
//   supabase/functions/mapbox-geocode/__tests__/orch_1079_poi_region_fallback.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { featureToDetails } from "../index.ts";

// A documented Search Box retrieve feature for a remote POI whose context has a
// region + country but NO place / locality / district (the case that 500'd).
function remotePoiNoCity() {
  return {
    geometry: { coordinates: [-87.4653, 20.2114] as [number, number] }, // [lng, lat]
    properties: {
      mapbox_id: "dXJuOm1ieHBvaTpyZW1vdGUtcG9p",
      full_address: "Carretera Tulum-Boca Paila, Quintana Roo, Mexico",
      place_formatted: "Quintana Roo, Mexico",
      context: {
        // NO place, NO locality, NO district — only region + country.
        region: {
          name: "Quintana Roo",
          region_code: "ROO",
          region_code_full: "MX-ROO",
        },
        country: { name: "Mexico", country_code: "mx" },
      },
    },
  };
}

Deno.test("T-4A: POI without place/locality/district → city falls back to region.name (no 500)", () => {
  const details = featureToDetails(remotePoiNoCity(), "fallback");
  assert(
    !("error" in details),
    "POI without a derivable city must NOT return no_locality after the region fallback",
  );
  if ("error" in details) return;
  // The region NAME is used as the last-resort locality.
  assertEquals(details.city, "Quintana Roo");
  // Structured codes are untouched by the fallback (read region_code, not name).
  assertEquals(details.region, "Quintana Roo");
  assertEquals(details.regionCode, "ROO");
  assertEquals(details.regionCodeFull, "MX-ROO");
  assertEquals(details.countryCode, "MX");
  assertEquals(details.placeId, "dXJuOm1ieHBvaTpyZW1vdGUtcG9p");
});

Deno.test("T-4A-b: a place-level feature is UNAFFECTED by the fallback (place wins)", () => {
  const feature = remotePoiNoCity();
  // Add a place — it must win over region (the fallback only fires when place,
  // locality, and district are all absent).
  (feature.properties.context as Record<string, unknown>).place = {
    name: "Tulum",
  };
  const details = featureToDetails(feature, "fallback");
  assert(!("error" in details));
  if ("error" in details) return;
  assertEquals(details.city, "Tulum"); // place wins, NOT the region name
});

Deno.test("T-4A-c: a feature with neither city-chain nor region still errors honestly", () => {
  const feature = {
    geometry: { coordinates: [1, 2] as [number, number] },
    properties: { context: { country: { name: "X", country_code: "xx" } } },
  };
  const details = featureToDetails(feature as never, "x");
  assert("error" in details, "no place/locality/district/region → still no_locality");
  if ("error" in details) assertEquals(details.error, "no_locality");
});
