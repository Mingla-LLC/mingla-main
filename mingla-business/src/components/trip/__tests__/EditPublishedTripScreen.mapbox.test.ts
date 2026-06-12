/**
 * ORCH-1118 [trip from/destination fields must be Mapbox-validated addresses]
 *
 * Node-env Jest source-characterization harness (no RN renderer) → proves the
 * published-edit screen swapped its two plain TextInputs for the shared
 * MapboxAddressInput, nulls coords on type, and gates Save on a confirmed pick
 * for BOTH departure and destination (hard-required, REVISED 2026-06-12).
 *
 * Fails-on-revert: reverting either field to a plain TextInput drops the
 * <MapboxAddressInput count below 2 (T-6); removing the gate drops the
 * handleSavePress reference (T-7); reverting the handlers drops the null keys (T-8).
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

const src = (): string =>
  readFileSync(
    path.join(
      process.cwd(),
      "src/components/trip/EditPublishedTripScreen.tsx",
    ),
    "utf8",
  );

describe("ORCH-1118 — EditPublishedTripScreen uses the Mapbox picker for both fields", () => {
  test("T-6: both address fields are MapboxAddressInput (exactly two)", () => {
    const tags = src().match(/<MapboxAddressInput/g) ?? [];
    expect(tags.length).toBe(2);
  });

  test("T-6: the legacy plain TextInputs for departure/destination are gone", () => {
    const s = src();
    // The departure/destination fields no longer carry the testID on a TextInput;
    // testIDs moved onto the wrapping View per the do-not-touch wrapper constraint.
    expect(s).not.toMatch(
      /<TextInput[^>]*testID="edit-trip-departure"/s,
    );
    expect(s).not.toMatch(
      /<TextInput[^>]*testID="edit-trip-destination"/s,
    );
    // testIDs preserved on the wrapping Views (queryable for the tester).
    expect(s).toContain('testID="edit-trip-departure"');
    expect(s).toContain('testID="edit-trip-destination"');
  });

  test("T-6: imports the shared picker + the predicate/copy", () => {
    const s = src();
    expect(s).toMatch(
      /import\s*\{\s*MapboxAddressInput\s*\}\s*from\s*["'][^"']*location\/MapboxAddressInput["']/,
    );
    expect(s).toContain("departureLocationValidated");
    expect(s).toContain("destinationLocationValidated");
  });

  test("T-7: handleSavePress gates on BOTH predicates and returns before setModal", () => {
    const s = src();
    const handler = s.slice(
      s.indexOf("const handleSavePress"),
      s.indexOf("setModal({"),
    );
    expect(handler).toContain("destinationLocationValidated(");
    expect(handler).toContain("departureLocationValidated(");
    expect(handler).toContain("setShowEditAddressErrors(true)");
    expect(handler).toContain("return;");
  });

  test("T-8: typing into either field nulls its placeId/lat/lng", () => {
    const s = src();
    // Departure handler nulls structured fields.
    expect(s).toMatch(
      /departureLocationText:\s*v\.trim\(\)\.length === 0 \? null : v,\s*\n?\s*departurePlaceId:\s*null,\s*\n?\s*departureLat:\s*null,\s*\n?\s*departureLng:\s*null,/,
    );
    // Destination handler nulls structured fields.
    expect(s).toMatch(
      /destinationLocationText:\s*v\.trim\(\)\.length === 0 \? null : v,\s*\n?\s*destinationPlaceId:\s*null,\s*\n?\s*destinationLat:\s*null,\s*\n?\s*destinationLng:\s*null,/,
    );
    // onPick writes the full pick on both.
    expect(s).toContain("departurePlaceId: place.placeId");
    expect(s).toContain("destinationPlaceId: place.placeId");
  });
});
