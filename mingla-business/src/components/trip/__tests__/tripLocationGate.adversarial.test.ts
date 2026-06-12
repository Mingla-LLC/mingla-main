/**
 * ORCH-1118 [trip from/destination fields must be Mapbox-validated addresses]
 * TESTER adversarial regression test (mingla-tester) — DIFFERENT ANGLE from the
 * implementor's source-character/regex tests.
 *
 * Where the implementor's `EditPublishedTripScreen.mapbox.test.ts` and
 * `TripCreatorStep1Basics.mapbox.test.ts` grep the file SOURCE for the presence
 * of the gate, this test BEHAVIOURALLY exercises the exported predicates the way
 * the two real gates COMPOSE them, and pins the exact boolean the save/publish
 * gate evaluates for the production "dirty row" shapes pulled live from
 * project gqnoajqerqhnvulmnyvv (read-only):
 *   - "The Sone"        — destination_text="Tulum, Quintana Roo, Mexico", departure empty
 *   - "The DC Adventure"— destination_text="Washington DC, USA",          departure empty
 * Both are scheduled trips a planner can re-edit; both MUST be blocked from
 * SAVE because (a) destination is dirty free-text (no placeId/lat/lng) AND
 * (b) departure is empty (hard-required, REVISED 2026-06-12). The gate is the
 * OR of the two `!*Validated(...)` calls — this test reproduces that exact
 * composition rather than asserting on source text.
 *
 * Fails-on-revert: if `departureLocationValidated` is loosened so an EMPTY
 * departure passes (the pre-2026-06-12 ORCH-1016 "optional departure" design),
 * the `saveGateBlocks` reproduction for a row whose destination IS a valid pick
 * but whose departure is empty flips from true→false and this test FAILS.
 *
 * Append-only; adds a NEW file (no existing test modified). Node-env, no RN
 * renderer (matches the established harness for these predicates).
 */

import { describe, expect, test } from "@jest/globals";
import {
  departureLocationValidated,
  destinationLocationValidated,
} from "../tripLocationValidated";

/**
 * Faithful reproduction of the OR-combined boolean evaluated by BOTH gates:
 *  - TripCreatorWizard.handlePublishTap → `if (!tripLocationValid)` where
 *    tripLocationValid = destinationValidated && departureValidated
 *  - EditPublishedTripScreen.handleSavePress → `if (!destValidated || !depValidated)`
 * Both reduce to: block ⇔ NOT(destValid AND depValid).
 */
const gateBlocks = (s: {
  destText: string | null;
  destPlaceId: string | null;
  destLat: number | null;
  destLng: number | null;
  depText: string | null;
  depPlaceId: string | null;
  depLat: number | null;
  depLng: number | null;
}): boolean =>
  !destinationLocationValidated(s.destText, s.destPlaceId, s.destLat, s.destLng) ||
  !departureLocationValidated(s.depText, s.depPlaceId, s.depLat, s.depLng);

describe("ORCH-1118 adversarial — the save/publish gate blocks the real dirty production rows", () => {
  test('"The Sone": dirty destination text + EMPTY departure → gate BLOCKS', () => {
    expect(
      gateBlocks({
        destText: "Tulum, Quintana Roo, Mexico",
        destPlaceId: null,
        destLat: null,
        destLng: null,
        depText: null, // empty departure (hard-required)
        depPlaceId: null,
        depLat: null,
        depLng: null,
      }),
    ).toBe(true);
  });

  test('"The DC Adventure": dirty destination text + EMPTY departure → gate BLOCKS', () => {
    expect(
      gateBlocks({
        destText: "Washington DC, USA",
        destPlaceId: null,
        destLat: null,
        destLng: null,
        depText: null,
        depPlaceId: null,
        depLat: null,
        depLng: null,
      }),
    ).toBe(true);
  });

  test("FAILS-ON-REVERT pin: valid-picked destination + EMPTY departure STILL blocks (departure hard-required)", () => {
    // This is the exact case that flips if departure is loosened back to
    // "empty is valid": destination is a real Mapbox pick, but departure is
    // empty. Under the REVISED contract the gate must STILL block on departure.
    expect(
      gateBlocks({
        destText: "Tulum, Quintana Roo, Mexico",
        destPlaceId: "mb.dest.1",
        destLat: 20.21,
        destLng: -87.46,
        depText: null,
        depPlaceId: null,
        depLat: null,
        depLng: null,
      }),
    ).toBe(true);
  });

  test("valid-picked destination + DIRTY (typed-but-unpicked) departure → gate BLOCKS", () => {
    expect(
      gateBlocks({
        destText: "Tulum, Quintana Roo, Mexico",
        destPlaceId: "mb.dest.1",
        destLat: 20.21,
        destLng: -87.46,
        depText: "Washington, DC", // typed, never picked
        depPlaceId: null,
        depLat: null,
        depLng: null,
      }),
    ).toBe(true); // dirty departure blocks even with a valid destination
  });

  test("ONLY the fully-picked both-fields shape passes the gate (does NOT block)", () => {
    expect(
      gateBlocks({
        destText: "Tulum, Quintana Roo, Mexico",
        destPlaceId: "mb.dest.1",
        destLat: 20.21,
        destLng: -87.46,
        depText: "Washington, DC, USA",
        depPlaceId: "mb.dep.1",
        depLat: 38.9,
        depLng: -77.0,
      }),
    ).toBe(false);
  });
});
