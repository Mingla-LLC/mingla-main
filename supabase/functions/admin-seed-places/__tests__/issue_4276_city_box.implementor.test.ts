// Issue #4276 B1: Google's box applies automatically; a person is asked only for a
// state or region result, or a seed estimate above $500. Real measured sizes, in km,
// width x height, stored then Google, from production and Google on 2026-11-05.
//
// MINGLA-INVARIANT: I-4276-BOX-NEVER-LOSES-AREA | issue #4276 | An automatic city box keeps the larger of Google's and the stored box on each edge
//
// FAILS-ON-REVERT: return `input.google` from mergeBoxes and London's row fails. Remove
// the region check and Enugu's row fails.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideCityBox, geocodeQueryForCity, isRegionResult, mergeBoxes } from "../cityBox.ts";
import {
  type Box,
  boxSizeKm,
  countGridTiles,
  estimateSeedCostUsd,
  METERS_PER_DEGREE_LAT,
  metersPerDegreeLng,
} from "../../_shared/seedingGeometry.ts";

const LOCALITY = ["locality", "political"];

function boxOf(lat: number, lng: number, widthKm: number, heightKm: number): Box {
  const dLat = (heightKm * 500) / METERS_PER_DEGREE_LAT;
  const dLng = (widthKm * 500) / metersPerDegreeLng(lat);
  return { swLat: lat - dLat, swLng: lng - dLng, neLat: lat + dLat, neLng: lng + dLng };
}

const estimate = (radius: number) => (b: Box) => estimateSeedCostUsd(countGridTiles(b, radius), 14);

const TABLE = [
  { city: "Berlin", lat: 52.52, lng: 13.4, r: 1500, stored: [20, 20], google: [46, 38], want: [46, 38] },
  { city: "Dallas", lat: 32.78, lng: -96.8, r: 1500, stored: [20, 20], google: [50, 46], want: [50, 46] },
  { city: "Chicago", lat: 41.88, lng: -87.63, r: 1500, stored: [20, 20], google: [35, 42], want: [35, 42] },
  { city: "Toronto", lat: 43.65, lng: -79.38, r: 1500, stored: [20, 20], google: [42, 30], want: [42, 30] },
  { city: "London", lat: 51.5, lng: -0.12, r: 2500, stored: [39, 55], google: [35, 32], want: [39, 55] },
] as const;

for (const row of TABLE) {
  Deno.test(`${row.city}: applies by itself, at ${row.want[0]} x ${row.want[1]} km`, () => {
    const d = decideCityBox({
      stored: boxOf(row.lat, row.lng, row.stored[0], row.stored[1]),
      google: boxOf(row.lat, row.lng, row.google[0], row.google[1]),
      resultTypes: LOCALITY,
      estimateSeedCostUsd: estimate(row.r),
    });
    assertEquals(d.autoApply, true, `asked: ${d.askReasons}`);
    assertEquals(d.askReasons, []);
    const size = boxSizeKm(d.box);
    assert(Math.abs(size.widthKm - row.want[0]) < 0.5, `width ${size.widthKm}`);
    assert(Math.abs(size.heightKm - row.want[1]) < 0.5, `height ${size.heightKm}`);
  });
}

Deno.test("London: the stored box wins on every edge, so nothing changes", () => {
  const stored = boxOf(51.5, -0.12, 39, 55);
  const d = decideCityBox({
    stored,
    google: boxOf(51.5, -0.12, 35, 32),
    resultTypes: LOCALITY,
    estimateSeedCostUsd: estimate(2500),
  });
  assertEquals(d.changed, false);
  assertEquals(d.grewEdges, []);
  assertEquals(d.box, stored);
});

Deno.test("each edge keeps whichever box reaches further, separately", () => {
  const merged = mergeBoxes(
    { swLat: 1, swLng: 10, neLat: 3, neLng: 12 },
    { swLat: 0, swLng: 11, neLat: 2, neLng: 15 },
  );
  assertEquals(merged, { swLat: 0, swLng: 10, neLat: 3, neLng: 15 });
});

Deno.test("Enugu returns a state, so it asks a person", () => {
  const d = decideCityBox({
    stored: boxOf(6.45, 7.5, 35, 35),
    google: boxOf(6.45, 7.5, 90, 80),
    resultTypes: ["administrative_area_level_1", "political"],
    estimateSeedCostUsd: () => 10,
  });
  assertEquals(d.autoApply, false);
  assertEquals(d.askReasons, ["state_or_region_result"]);
});

Deno.test("a seed estimate above $500 asks a person, and exactly $500 doesn't", () => {
  const input = { stored: null, google: boxOf(1, 1, 5, 5), resultTypes: LOCALITY };
  assertEquals(decideCityBox({ ...input, estimateSeedCostUsd: () => 500 }).autoApply, true);
  const d = decideCityBox({ ...input, estimateSeedCostUsd: () => 500.01 });
  assertEquals(d.autoApply, false);
  assertEquals(d.askReasons, ["seed_estimate_over_limit"]);
  // The real thing: Dallas at 80 x 80 km and 1,500 m.
  const big = decideCityBox({
    stored: null,
    google: boxOf(32.78, -96.8, 80, 80),
    resultTypes: LOCALITY,
    estimateSeedCostUsd: estimate(1500),
  });
  assertEquals(big.askReasons, ["seed_estimate_over_limit"]);
});

Deno.test("what counts as a state or region", () => {
  assertEquals(isRegionResult(LOCALITY), false);
  assertEquals(isRegionResult(["postal_town", "political"]), false);
  assertEquals(isRegionResult(["administrative_area_level_1", "political"]), true);
  assertEquals(isRegionResult(["administrative_area_level_1", "locality", "political"]), true, "Tokyo");
  assertEquals(isRegionResult(["administrative_area_level_2", "political"]), true);
  assertEquals(isRegionResult(["administrative_area_level_2", "locality", "political"]), false);
  assertEquals(isRegionResult(["country", "political"]), true);
});

Deno.test("Washington geocodes as Washington, DC; everything else is city, country", () => {
  assertEquals(geocodeQueryForCity({ name: "Washington", country: "United States", country_code: "US" }), "Washington, DC");
  assertEquals(geocodeQueryForCity({ name: "Washington", country: "United Kingdom", country_code: "GB" }), "Washington, United Kingdom");
  assertEquals(geocodeQueryForCity({ name: "Enugu", country: "Nigeria", country_code: "NG" }), "Enugu, Nigeria");
});
