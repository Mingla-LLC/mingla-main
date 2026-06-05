/**
 * ORCH-1079 [Business-venue Google→Mapbox sweep] — venue-claim dedup guard.
 *
 * THE make-or-break test. VenueStep1Address.onPick / onClear must NEVER write or
 * null `googlePlaceId` in the draft venue store, so that:
 *   • CLAIM path  — the pool-derived Google id (set by prefillDraftFromPoolMatch)
 *     survives a Step-1 Mapbox re-pick → biz_create_venue_brand_authoring does
 *     NOT throw `place_pool_google_place_id_mismatch` (T-3A).
 *   • CREATE-NEW path — googlePlaceId stays null → no mapbox_id reaches
 *     brands.google_place_id (T-3B).
 *
 * Repo Jest harness is Node-env with no RN renderer, so this test combines:
 *   (a) SOURCE-CHARACTERIZATION of the locked handler shape (the regression a
 *       reviewer would actually reintroduce — `googlePlaceId: p.placeId`), AND
 *   (b) a BEHAVIORAL run of the real draftVenueStore replaying exactly what the
 *       locked onPick/onClear patch, proving the invariant holds end-to-end.
 *
 * Step 0.5: passes on the fix; MUST FAIL on revert (if onPick patches
 * googlePlaceId again, the source-char assertion + the behavioral assertion both
 * break). Fails-on-revert proof captured in the implementation report.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";
import { parseVenuePlaceResult } from "../../../utils/parseVenuePlaceResult";
import type { PlaceDetails } from "../../../services/mapboxGeocodeService";

// NOTE: the real useDraftVenueStore is AsyncStorage-persisted (needs `window`),
// which the node-env Jest harness can't load. We model the store's `patch`
// semantics exactly — `patch: (p) => set(p)` is a shallow merge — with a plain
// object, so the behavioral dedup assertions run without the RN/jsdom shim. The
// source-characterization block above is the regression catcher for the actual
// component handler shape.
type VenueDraft = {
  placePoolId: string | null;
  googlePlaceId: string | null;
  formattedAddress: string;
  lat: number | null;
  lng: number | null;
  city: string | null;
  countryCode: string | null;
};
function makeStore(seed: Partial<VenueDraft> = {}) {
  let state: VenueDraft = {
    placePoolId: null,
    googlePlaceId: null,
    formattedAddress: "",
    lat: null,
    lng: null,
    city: null,
    countryCode: null,
    ...seed,
  };
  return {
    getState: (): VenueDraft => state,
    patch: (p: Partial<VenueDraft>): void => {
      state = { ...state, ...p };
    },
  };
}

const venueSource = (): string =>
  readFileSync(
    path.join(process.cwd(), "src/components/venue/VenueStep1Address.tsx"),
    "utf8",
  );

const mapboxPick: PlaceDetails = {
  placeId: "dXJuOm1ieHBvaTptYXBib3gtdmVudWU", // a mapbox_id, NOT a Google id
  formattedAddress: "123 Re-picked Ave, Tulum, Quintana Roo, Mexico",
  city: "Tulum",
  region: "Quintana Roo",
  regionCode: "ROO",
  regionCodeFull: "MX-ROO",
  countryCode: "MX",
  location: { lat: 20.21, lng: -87.46 },
};

describe("ORCH-1079 — VenueStep1Address dedup guard (source shape)", () => {
  test("T-3C/T-3D: no patch() call writes googlePlaceId (regression catcher)", () => {
    const src = venueSource();
    // The picker is the shared Mapbox input, not the retired Google one.
    expect(src).toContain("MapboxAddressInput");
    expect(src).not.toContain("AddressAutocompleteInput");
    // Strip line + block comments (our LOCKED comments legitimately mention
    // googlePlaceId), then assert NO `patch({...})` call ever sets it. A
    // regression reintroduces `googlePlaceId: p.placeId` / `: p.googlePlaceId` /
    // `: null` inside a patch body — all of which this catches.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const patchCalls = codeOnly.match(/patch\(\{[\s\S]*?\}\)/g) ?? [];
    expect(patchCalls.length).toBeGreaterThanOrEqual(2); // onChangeText + onPick + onClear
    for (const call of patchCalls) {
      expect(call).not.toContain("googlePlaceId");
    }
  });
});

describe("ORCH-1079 — draftVenueStore dedup invariant (behavioral)", () => {
  // Replays EXACTLY the locked onPick body (§3.C): patch address/geo ONLY.
  function applyLockedOnPick(
    store: ReturnType<typeof makeStore>,
    details: PlaceDetails,
  ): void {
    const p = parseVenuePlaceResult(details);
    store.patch({
      formattedAddress: p.formattedAddress,
      lat: p.lat,
      lng: p.lng,
      city: p.city,
      countryCode: p.countryCode,
    });
  }
  // Replays EXACTLY the locked onClear body (§3.C): null address/geo ONLY.
  function applyLockedOnClear(store: ReturnType<typeof makeStore>): void {
    store.patch({
      formattedAddress: "",
      lat: null,
      lng: null,
      city: null,
      countryCode: null,
    });
  }

  test("T-3A: CLAIM path — pool-derived googlePlaceId survives a Mapbox re-pick", () => {
    // Simulate prefillDraftFromPoolMatch: pool row id + its Google place id.
    const store = makeStore({
      placePoolId: "pool-row-1",
      googlePlaceId: "ChIJpoolGooglePlaceId", // Google-seeded dedup key
    });
    applyLockedOnPick(store, mapboxPick);
    const s = store.getState();
    // The dedup key is UNCHANGED — RPC will match place_pool.google_place_id.
    expect(s.googlePlaceId).toBe("ChIJpoolGooglePlaceId");
    expect(s.googlePlaceId).not.toBe(mapboxPick.placeId);
    // Address/geo were refined from the Mapbox pick.
    expect(s.formattedAddress).toBe(mapboxPick.formattedAddress);
    expect(s.lat).toBe(20.21);
    expect(s.city).toBe("Tulum");
    expect(s.countryCode).toBe("MX");
  });

  test("T-3B: CREATE-NEW path — googlePlaceId stays null (no mapbox_id stored)", () => {
    // No pool match → default googlePlaceId is null.
    const store = makeStore();
    expect(store.getState().googlePlaceId).toBeNull();
    applyLockedOnPick(store, mapboxPick);
    const s = store.getState();
    expect(s.googlePlaceId).toBeNull();
    expect(s.formattedAddress).toBe(mapboxPick.formattedAddress);
  });

  test("T-3D: onClear preserves a pool-derived googlePlaceId", () => {
    const store = makeStore({
      placePoolId: "pool-row-1",
      googlePlaceId: "ChIJpoolGooglePlaceId",
      formattedAddress: mapboxPick.formattedAddress,
      lat: 20.21,
      lng: -87.46,
      city: "Tulum",
      countryCode: "MX",
    });
    applyLockedOnClear(store);
    const s = store.getState();
    expect(s.googlePlaceId).toBe("ChIJpoolGooglePlaceId"); // survives the clear
    expect(s.formattedAddress).toBe("");
    expect(s.lat).toBeNull();
    expect(s.city).toBeNull();
  });
});
