// Issue #1629 — coordinate precision must be READ from Mapbox, not asserted.
//
// THE DEFECT: every business address surface hardcoded
// `coordinatePrecision: "approximate"` inside `onPick` — the branch that fires
// when a brand picks a REAL suggestion from the dropdown. `"exact"` existed in
// the type and was UNREACHABLE: production carried 0 exact rows across events,
// venue_listings and experience_stops. #1373's "Approximate location" caption
// would therefore have appeared on every venue, event and trip — including ones
// with a precise, verified address.
//
// The answer was already in the response and thrown away: `featureToDetails`
// omitted `properties.feature_type`, even though the field is declared on
// MapboxFeature and already used for hierarchy classification.
//
// FAILS-ON-REVERT: drop `featureType` from featureToDetails' return (or make
// featureTypeToPrecision always return "approximate") and T-2/T-3/T-5 fail.
//
// Run: deno test supabase/functions/mapbox-geocode/__tests__/issue1629_feature_type_precision.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { featureToDetails, featureTypeToPrecision } from "../index.ts";

// Mapbox's documented feature types — https://docs.mapbox.com/api/search/search-box/
// Encoded here as the provider defines them, not as we wish they were.
const POINT_LEVEL = ["address", "poi"] as const;
const AREA_LEVEL = [
  "street", // "the street, with no house number"
  "neighborhood",
  "locality",
  "place",
  "district",
  "postcode",
  "region",
  "country",
  "block",
] as const;

// ─── T-1 — the documented taxonomy, exhaustively ─────────────────────────────
Deno.test("T-1 #1629: every documented Mapbox feature_type maps to the right precision", () => {
  for (const ft of POINT_LEVEL) {
    assertEquals(
      featureTypeToPrecision(ft),
      "exact",
      `"${ft}" is a specific building/business — it must be exact`,
    );
  }
  for (const ft of AREA_LEVEL) {
    assertEquals(
      featureTypeToPrecision(ft),
      "approximate",
      `"${ft}" is an area centroid — claiming exact would fabricate precision`,
    );
  }
  // Vacuity guard: an emptied list must fail, not silently pass over nothing.
  assertEquals(POINT_LEVEL.length, 2);
  assert(AREA_LEVEL.length >= 8, "area-level coverage must stay exhaustive");
});

// ─── T-2 — `exact` is REACHABLE. This is the bug, stated directly. ───────────
Deno.test("T-2 #1629: a picked street address yields exact, not approximate", () => {
  assertEquals(featureTypeToPrecision("address"), "exact");
  assertEquals(featureTypeToPrecision("poi"), "exact");
});

// ─── T-3 — end-to-end through the real mapper ────────────────────────────────
Deno.test("T-3 #1629: featureToDetails passes feature_type through, structured", () => {
  const feature = {
    geometry: { coordinates: [-0.1278, 51.5074] as [number, number] },
    properties: {
      mapbox_id: "dXJuOm1ieHBvaTox",
      feature_type: "address",
      full_address: "10 Downing St, London SW1A 2AA",
      context: {
        place: { name: "London" },
        country: { name: "United Kingdom", country_code: "gb" },
      },
    },
  };
  const d = featureToDetails(feature, "fallback");
  assert(!("error" in d), "a valid address feature must resolve");
  if ("error" in d) return;
  assertEquals(d.featureType, "address", "feature_type must survive the mapper");
  assertEquals(featureTypeToPrecision(d.featureType), "exact");
});

// ─── T-4 — a picked CITY is still approximate (no over-correction) ───────────
// The consumer place-search picks cities. Those must NOT become "exact" just
// because the user tapped a suggestion.
Deno.test("T-4 #1629: a picked city resolves approximate, not exact", () => {
  const feature = {
    geometry: { coordinates: [3.3792, 6.5244] as [number, number] },
    properties: {
      mapbox_id: "dXJuOm1ieHBsYzpjaXR5",
      feature_type: "place",
      place_formatted: "Lagos, Nigeria",
      context: {
        place: { name: "Lagos" },
        country: { name: "Nigeria", country_code: "ng" },
      },
    },
  };
  const d = featureToDetails(feature, "");
  assert(!("error" in d));
  if ("error" in d) return;
  assertEquals(d.featureType, "place");
  assertEquals(featureTypeToPrecision(d.featureType), "approximate");
});

// ─── T-5 — ADVERSARIAL: unknown/missing must NEVER claim exact ───────────────
// Over-claiming precision is fabricated data (Constitution rule 9) and a lie the
// user cannot detect. Under-claiming is conservative and visible. Note this is
// the OPPOSITE default to #1622's failure classifier — same principle, inverted
// inputs: pick the direction whose failure mode is VISIBLE, not silent.
Deno.test("T-5 #1629 ADVERSARIAL: unknown or missing feature_type is never exact", () => {
  for (
    const bad of [
      null,
      undefined,
      "",
      "   ",
      "ADDRESS_BUT_NOT_REALLY",
      "something_mapbox_adds_in_2027",
      "category",
    ]
  ) {
    assertEquals(
      featureTypeToPrecision(bad as string | null | undefined),
      "approximate",
      `${JSON.stringify(bad)} must not resolve to exact — that fabricates precision`,
    );
  }
});

// ─── T-6 — case/whitespace drift must not silently downgrade a real address ──
Deno.test("T-6 #1629: feature_type matching tolerates case and padding", () => {
  assertEquals(featureTypeToPrecision("Address"), "exact");
  assertEquals(featureTypeToPrecision("  poi  "), "exact");
  assertEquals(featureTypeToPrecision("POI"), "exact");
});

// ─── T-7 — a feature with NO feature_type still resolves (no regression) ─────
// Pre-#1629 responses had no such field; the mapper must not start erroring.
Deno.test("T-7 #1629: a feature lacking feature_type still maps, as approximate", () => {
  const feature = {
    geometry: { coordinates: [-78.6382, 35.7796] as [number, number] },
    properties: {
      mapbox_id: "x",
      full_address: "Raleigh, NC",
      context: { place: { name: "Raleigh" }, country: { country_code: "us" } },
    },
  };
  const d = featureToDetails(feature, "");
  assert(!("error" in d), "a feature without feature_type must still resolve");
  if ("error" in d) return;
  assertEquals(d.featureType, null);
  assertEquals(featureTypeToPrecision(d.featureType), "approximate");
});
