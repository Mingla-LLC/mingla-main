/**
 * ORCH-1079 [Business-venue Google→Mapbox sweep] — trip creator swap (T-1A/T-1B/T-1C).
 *
 * Node-env Jest harness (no RN renderer) → source-characterizes the locked swap:
 * both departure + destination fields use the shared MapboxAddressInput, the
 * handler bodies are unchanged (placeId/locationText/lat/lng written; cleared to
 * null), and the Google path is fully removed.
 *
 * Step 0.5: passes on the fix; MUST FAIL on revert (reintroducing
 * AddressAutocompleteInput).
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

const src = (): string =>
  readFileSync(
    path.join(process.cwd(), "src/components/trip/TripCreatorStep1Basics.tsx"),
    "utf8",
  );

describe("ORCH-1079 — TripCreatorStep1Basics uses the shared Mapbox picker", () => {
  test("T-1C: imports MapboxAddressInput from components/location and drops the Google path", () => {
    const s = src();
    expect(s).toMatch(
      /import\s*\{[^}]*\bMapboxAddressInput\b[^}]*\}\s*from\s*["'][^"']*location\/MapboxAddressInput["']/,
    );
    expect(s).not.toContain("AddressAutocompleteInput");
    expect(s).not.toContain("googlePlacesService");
    expect(s).not.toContain("parseGooglePlaceResult");
  });

  test("T-1A: both trip fields render MapboxAddressInput (departure + destination)", () => {
    const tags = src().match(/<MapboxAddressInput/g) ?? [];
    expect(tags.length).toBe(2);
  });

  test("T-1A: onPick still writes the same opaque *PlaceId + locationText + lat/lng keys", () => {
    const s = src();
    expect(s).toContain("departurePlaceId: place.placeId");
    expect(s).toContain("departureLocationText: place.formattedAddress");
    expect(s).toContain("departureLat: place.location.lat");
    expect(s).toContain("destinationPlaceId: place.placeId");
    expect(s).toContain("destinationLocationText: place.formattedAddress");
  });

  test("T-1B: onClear still nulls all four departure*/destination* keys", () => {
    const s = src();
    expect(s).toContain("departurePlaceId: null");
    expect(s).toContain("departureLocationText: null");
    expect(s).toContain("destinationPlaceId: null");
    expect(s).toContain("destinationLocationText: null");
  });
});
