/**
 * ORCH-1118 [trip from/destination fields must be Mapbox-validated addresses]
 *
 * Unit tests for the shared trip-location predicate. The contract: BOTH
 * departure and destination are valid ONLY when a real Mapbox pick is present
 * (placeId + lat + lng all non-null). Empty text and dirty (typed-but-unpicked)
 * text are BOTH invalid for BOTH fields.
 *
 * Fails-on-revert: T-2/T-3 fail if either field helper is loosened to accept
 * text-without-coords (e.g. reverting departure to an "empty is valid" branch).
 */

import { describe, expect, test } from "@jest/globals";
import {
  departureLocationValidated,
  destinationLocationValidated,
  tripPlacePicked,
  TRIP_DEPARTURE_PICK_ERROR,
  TRIP_DESTINATION_PICK_ERROR,
} from "../tripLocationValidated";

describe("ORCH-1118 — tripLocationValidated predicate", () => {
  test("T-1: tripPlacePicked accepts a full pick", () => {
    expect(tripPlacePicked("mb.1", 21.1, -87.4)).toBe(true);
  });

  test("T-1: tripPlacePicked rejects any missing coordinate", () => {
    expect(tripPlacePicked(null, 21.1, -87.4)).toBe(false);
    expect(tripPlacePicked("mb.1", null, -87.4)).toBe(false);
    expect(tripPlacePicked("mb.1", 21.1, null)).toBe(false);
    expect(tripPlacePicked(null, null, null)).toBe(false);
  });

  test("T-2: destination rejects text-without-coords (dirty)", () => {
    expect(destinationLocationValidated("Tulum", null, null, null)).toBe(false);
  });

  test("T-2: destination rejects empty text", () => {
    expect(destinationLocationValidated("", null, null, null)).toBe(false);
    expect(destinationLocationValidated(null, null, null, null)).toBe(false);
  });

  test("T-2: destination accepts a full pick", () => {
    expect(
      destinationLocationValidated("Tulum", "mb.2", 21.1, -87.4),
    ).toBe(true);
  });

  test("T-3: departure EMPTY is INVALID (hard-required, REVISED 2026-06-12)", () => {
    expect(departureLocationValidated("", null, null, null)).toBe(false);
    expect(departureLocationValidated(null, null, null, null)).toBe(false);
  });

  test("T-3: departure dirty (typed-but-unpicked) is INVALID", () => {
    expect(departureLocationValidated("DC", null, null, null)).toBe(false);
  });

  test("T-3: departure accepts ONLY a full pick", () => {
    expect(departureLocationValidated("DC", "mb.1", 38.9, -77.0)).toBe(true);
  });

  test("error copy is provider-neutral and stable", () => {
    expect(TRIP_DESTINATION_PICK_ERROR).toBe(
      "Pick the destination from the suggestions.",
    );
    expect(TRIP_DEPARTURE_PICK_ERROR).toBe(
      "Pick the departure city from the suggestions.",
    );
  });
});
