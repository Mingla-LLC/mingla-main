/**
 * Issue #1363 (CHANGE 2 — pin-drop auto-center) — IMPLEMENTOR happy-path test.
 *
 * When a brand types an un-indexed Nigerian address and taps "Drop a pin" WITHOUT
 * first committing the free-text row, the field's own coordinate is still null
 * (typing nulls it). Before CHANGE 2 the PinDropSheet then opened at a blank world
 * view. `resolvePinSeed` fixes that: it returns the best coarse center to open the
 * map over — the field's coord when set, else a forward-geocode of the typed text,
 * else null — WITHOUT committing anything to the draft.
 *
 * FAILS-ON-REVERT:
 *  - Delete the forward-geocode branch (so the helper only ever returns field
 *    coords or {null,null}) ⇒ the "seeds from the typed text" assertion FAILS
 *    (a typed-but-uncommitted NG address would re-open on a blank world view).
 *
 * `resolvePinSeed` takes an injected `deps.forward`, so this is a pure node-env
 * test with a deterministic stub — no network, no react-native. Imported through
 * the source path (not the `@mingla/*` specifier) per the sibling suites' note.
 */

// Mock the business geocode service so resolveApproxLocation's module import
// chain never loads @mingla/location-input (react-native) under this node-env
// suite. resolvePinSeed takes an injected `deps.forward`, so the mock's own
// functions are never called — the mock only keeps the import graph node-safe
// (mirrors orch_1363_pindrop_freetext.implementor.test.ts).
jest.mock("../services/mapboxGeocodeService", () => ({
  forwardGeocodeMapbox: jest.fn(),
  reverseGeocodeMapbox: jest.fn(),
}));

import { resolvePinSeed } from "../utils/resolveApproxLocation";
import type { PlaceDetails } from "../services/mapboxGeocodeService";

const LEKKI: PlaceDetails = {
  placeId: "lekki.1",
  formattedAddress: "Lekki, Lagos, Nigeria",
  city: "Lagos",
  region: "Lagos",
  regionCode: null,
  regionCodeFull: null,
  countryCode: "NG",
  location: { lat: 6.4478, lng: 3.4723 },
};

describe("Issue #1363 CHANGE 2 — resolvePinSeed (pin-drop auto-center)", () => {
  it("uses the field's OWN coordinate when set — no geocode needed", async () => {
    const forward = jest.fn(async (): Promise<PlaceDetails> => LEKKI);
    const seed = await resolvePinSeed(40.7128, -74.006, "ignored typed text", {
      forward,
    });
    expect(seed).toEqual({ lat: 40.7128, lng: -74.006 });
    // The field already has a coordinate → the typed text is never geocoded.
    expect(forward).not.toHaveBeenCalled();
  });

  it("SEEDS from a forward-geocode of the typed text when the field coord is null (the NG case)", async () => {
    const forward = jest.fn(async (): Promise<PlaceDetails> => LEKKI);
    const seed = await resolvePinSeed(null, null, "23 Admiralty Way, Lekki", {
      forward,
    });
    expect(forward).toHaveBeenCalledTimes(1);
    // The map opens over the coarse Lekki/Lagos center, NOT a blank world view.
    expect(seed).toEqual({ lat: 6.4478, lng: 3.4723 });
  });

  it("returns {null,null} when the field coord is null and the geocode finds nothing (wide default; no fabricated coord)", async () => {
    const forward = jest.fn(async (): Promise<PlaceDetails> => {
      throw new Error("no match");
    });
    const seed = await resolvePinSeed(null, null, "nowhere-that-exists-zzz", {
      forward,
    });
    expect(seed).toEqual({ lat: null, lng: null });
  });

  it("returns {null,null} for empty typed text without geocoding", async () => {
    const forward = jest.fn(async (): Promise<PlaceDetails> => LEKKI);
    const seed = await resolvePinSeed(null, null, "   ", { forward });
    expect(seed).toEqual({ lat: null, lng: null });
    expect(forward).not.toHaveBeenCalled();
  });
});
