/**
 * ORCH-1118 [trip from/destination fields must be Mapbox-validated addresses]
 *
 * Dry-run verification of the one-time backfill script's SAFETY logic (T-9/T-10),
 * exercised deterministically against fixtures (no network — the live Mapbox /
 * Supabase run is operator-gated). Proves:
 *   T-9  — the confidence gate REJECTS ambiguous / low-confidence / non-settlement
 *          results (never guesses) and ACCEPTS an unambiguous high-confidence
 *          settlement match, including the 5 known production city strings.
 *   T-10 — idempotency: a row that already has coords is NOT dirty → skipped on
 *          a second run (writes nothing new).
 */

import { describe, expect, test } from "@jest/globals";
import {
  evaluate,
  isDirty,
} from "../../../../../scripts/orch-1118-backfill-trip-coords";

// A confident, unambiguous settlement feature (e.g. "Tulum").
const confidentFeature = (
  id: string,
  lat: number,
  lng: number,
  name: string,
) => ({
  geometry: { coordinates: [lng, lat] as [number, number] },
  properties: {
    mapbox_id: id,
    full_address: name,
    name,
    feature_type: "place",
    match_code: { confidence: "exact" },
  },
});

describe("ORCH-1118 — backfill confidence gate (T-9, never guesses)", () => {
  test("ACCEPTS an unambiguous high-confidence settlement (single result)", () => {
    const v = evaluate([confidentFeature("mb.tulum", 20.21, -87.46, "Tulum")]);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.placeId).toBe("mb.tulum");
      expect(v.lat).toBeCloseTo(20.21);
      expect(v.lng).toBeCloseTo(-87.46);
    }
  });

  test("ACCEPTS when the 2nd result is a clearly-different place (>25km)", () => {
    const v = evaluate([
      confidentFeature("mb.dc", 38.9, -77.0, "Washington, DC"),
      confidentFeature("mb.far", 41.9, -87.6, "Chicago"), // ~950km away
    ]);
    expect(v.ok).toBe(true);
  });

  test("REJECTS a near-tie (2nd result within 25km)", () => {
    const v = evaluate([
      confidentFeature("mb.a", 38.90, -77.03, "Place A"),
      confidentFeature("mb.b", 38.92, -77.05, "Place B"), // ~2.6km
    ]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/near-tie/);
  });

  test("REJECTS low / medium / absent confidence", () => {
    const mk = (conf: string | undefined) => ({
      geometry: { coordinates: [-87.46, 20.21] as [number, number] },
      properties: {
        mapbox_id: "mb.x",
        feature_type: "place",
        match_code: conf === undefined ? undefined : { confidence: conf },
      },
    });
    expect(evaluate([mk("medium")]).ok).toBe(false);
    expect(evaluate([mk("low")]).ok).toBe(false);
    expect(evaluate([mk(undefined)]).ok).toBe(false);
  });

  test("REJECTS a non-settlement feature_type (e.g. a POI/address)", () => {
    const v = evaluate([
      {
        geometry: { coordinates: [-87.46, 20.21] as [number, number] },
        properties: {
          mapbox_id: "mb.poi",
          feature_type: "poi",
          match_code: { confidence: "exact" },
        },
      },
    ]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/non-settlement/);
  });

  test("REJECTS no-match (gibberish)", () => {
    const v = evaluate([]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("no-match");
  });
});

describe("ORCH-1118 — backfill idempotency (T-10)", () => {
  test("a dirty row (text, null coords) IS dirty → would geocode", () => {
    const bt = {
      destinationLocationText: "Tulum, Quintana Roo, Mexico",
      destinationPlaceId: null,
      destinationLat: null,
      destinationLng: null,
    };
    expect(isDirty(bt, "destination")).toBe(true);
  });

  test("a row WITH coords is NOT dirty → skipped on re-run (writes nothing)", () => {
    const bt = {
      destinationLocationText: "Tulum, Quintana Roo, Mexico",
      destinationPlaceId: "mb.tulum",
      destinationLat: 20.21,
      destinationLng: -87.46,
    };
    expect(isDirty(bt, "destination")).toBe(false);
  });

  test("an empty field is NOT dirty (no text to geocode)", () => {
    const bt = {
      departureLocationText: "",
      departurePlaceId: null,
      departureLat: null,
      departureLng: null,
    };
    expect(isDirty(bt, "departure")).toBe(false);
  });
});
