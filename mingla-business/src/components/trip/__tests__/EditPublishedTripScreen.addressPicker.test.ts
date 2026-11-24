/**
 * ORCH-1118 [trip from/destination fields must be pick-validated addresses]
 *
 * Node-env Jest source-characterization harness (no RN renderer) → proves the
 * published-edit screen swapped its two plain TextInputs for the shared
 * AddressInput, nulls coords on type, and gates Save on a confirmed pick
 * for BOTH departure and destination (hard-required, REVISED 2026-06-12).
 *
 * Fails-on-revert: reverting either field to a plain TextInput drops the
 * <AddressInput count below 2 (T-6); removing the gate drops the
 * handleSavePress reference (T-7); reverting the handlers drops the null keys (T-8).
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

const editorSrc = (): string =>
  readFileSync(
    path.join(
      process.cwd(),
      "src/components/trip/EditPublishedTripScreen.tsx",
    ),
    "utf8",
  );
const basicsSrc = (): string =>
  readFileSync(
    path.join(process.cwd(), "src/components/trip/TripCreatorStep1Basics.tsx"),
    "utf8",
  );

describe("ORCH-1118 — EditPublishedTripScreen uses the address picker for both fields", () => {
  test("T-6: both address fields are AddressInput (exactly two)", () => {
    expect(editorSrc()).toContain("<TripCreatorStep1Basics");
    const tags = basicsSrc().match(/<AddressInput/g) ?? [];
    expect(tags.length).toBe(2);
  });

  test("T-6: the legacy plain TextInputs for departure/destination are gone", () => {
    const s = basicsSrc();
    // The departure/destination fields no longer carry the testID on a TextInput;
    // testIDs moved onto the wrapping View per the do-not-touch wrapper constraint.
    expect(s).not.toMatch(
      /<TextInput[^>]*testID="edit-trip-departure"/s,
    );
    expect(s).not.toMatch(
      /<TextInput[^>]*testID="edit-trip-destination"/s,
    );
  });

  test("T-6: imports the shared picker + the predicate/copy", () => {
    const s = `${editorSrc()}\n${basicsSrc()}`;
    expect(s).toMatch(
      /import\s*\{\s*AddressInput\s*\}\s*from\s*["'][^"']*location\/AddressInput["']/,
    );
    expect(s).toContain("departureLocationValidated");
    expect(s).toContain("destinationLocationValidated");
  });

  test("T-7: handleSavePress gates on BOTH predicates and returns before setModal", () => {
    const s = editorSrc();
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
    const s = basicsSrc();
    // Departure handler nulls structured fields.
    expect(s).toMatch(
      /departureLocationText:\s*v,\s*\n?\s*departurePlaceId:\s*null,\s*\n?\s*departureLat:\s*null,\s*\n?\s*departureLng:\s*null,/,
    );
    // Destination handler nulls structured fields.
    expect(s).toMatch(
      /destinationLocationText:\s*v,\s*\n?\s*destinationPlaceId:\s*null,\s*\n?\s*destinationLat:\s*null,\s*\n?\s*destinationLng:\s*null,/,
    );
    // onPick writes the full pick on both.
    expect(s).toContain("departurePlaceId: place.placeId");
    expect(s).toContain("destinationPlaceId: place.placeId");
  });
});
