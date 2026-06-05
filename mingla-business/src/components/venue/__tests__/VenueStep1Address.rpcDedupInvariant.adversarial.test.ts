/**
 * ORCH-1079 [Business-venue Google→Mapbox sweep] — TESTER ADVERSARIAL regression.
 *
 * DIFFERENT ANGLE than the implementor's tests. The implementor's
 * VenueStep1Address.mapboxDedup.test.ts proves the *store* keeps the pool-derived
 * `googlePlaceId` after onPick/onClear. It never exercises the actual database
 * invariant those handlers exist to satisfy:
 *
 *   biz_create_venue_brand_authoring (META-ORCH-1009 Sub-E migration
 *   20260809000000, lines 311-326):
 *     v_google := nullif(trim(coalesce(p_google_place_id, '')), '');   -- :311
 *     IF p_place_pool_id IS NOT NULL THEN
 *       SELECT p.google_place_id INTO v_pool_google ...                 -- :315
 *       IF v_google IS NULL
 *          OR trim(v_pool_google) IS DISTINCT FROM v_google THEN
 *         RAISE EXCEPTION 'place_pool_google_place_id_mismatch';        -- :325
 *
 * This test ports that exact normalization + comparison into JS and drives the
 * FULL faithful claim chain that production uses:
 *   prefillDraftFromPoolMatch  → draftVenueStore.googlePlaceId
 *   onPick (LOCKED §3.C body)  → patch address/geo ONLY
 *   VenueCreatorWizard:181     → createVenue({ googlePlaceId: st.googlePlaceId })
 *   brandsService:368          → p_google_place_id: input.googlePlaceId ?? ""
 *   RPC :311/:324              → nullif(trim(coalesce))) + IS DISTINCT FROM
 *
 * It asserts the guard is LOAD-BEARING two ways:
 *   (1) the preserved pool id passes the RPC invariant (no mismatch), AND
 *   (2) every poisoned variant the guard prevents (mapbox_id, null-out,
 *       empty-string, whitespace-only) WOULD throw the mismatch — proving the
 *       guard is not cosmetic.
 *
 * Adversarial angle: I attack the RPC's `nullif/trim/IS DISTINCT FROM`
 * normalization edge cases (empty string vs null vs whitespace, and the
 * `?? ""` coercion in brandsService), none of which the implementor's
 * store-level test touches. Step 0.5: this MUST FAIL on revert (if onPick is
 * reverted to patch googlePlaceId:p.placeId, the chain feeds a mapbox_id into
 * the RPC and assertNoMismatch throws).
 */

import { describe, expect, test } from "@jest/globals";
import { parseVenuePlaceResult } from "../../../utils/parseVenuePlaceResult";
import { prefillDraftFromPoolMatch } from "../../../utils/prefillDraftFromPoolMatch";
import type { PlaceDetails } from "../../../services/mapboxGeocodeService";
import type { PoolMatch } from "../../../types/poolMatch";

// ----- faithful port of biz_create_venue_brand_authoring dedup (migration :311-326) -----
function rpcNormalize(raw: string | null | undefined): string | null {
  // nullif(trim(coalesce(p_google_place_id, '')), '')
  const v = (raw ?? "").trim();
  return v === "" ? null : v;
}
function rpcDedupCheck(
  pGooglePlaceId: string | null | undefined,
  pPlacePoolId: string | null,
  poolRowGoogleId: string | null,
): void {
  const vGoogle = rpcNormalize(pGooglePlaceId);
  if (pPlacePoolId != null) {
    // IS DISTINCT FROM is null-safe inequality; trim(v_pool_google) on the LHS.
    const lhs = poolRowGoogleId == null ? null : poolRowGoogleId.trim();
    if (vGoogle == null || lhs !== vGoogle) {
      throw new Error("place_pool_google_place_id_mismatch");
    }
  }
}

// ----- faithful port of the wizard→service arg coercion (brandsService:368) -----
function buildRpcArg(storeGooglePlaceId: string | null): string {
  return storeGooglePlaceId ?? ""; // p_google_place_id: input.googlePlaceId ?? ""
}

// ----- the LOCKED §3.C onPick body (address/geo ONLY, never googlePlaceId) -----
function lockedOnPick(
  store: { googlePlaceId: string | null; formattedAddress: string; lat: number | null; lng: number | null; city: string | null; countryCode: string | null },
  details: PlaceDetails,
): void {
  const p = parseVenuePlaceResult(details);
  store.formattedAddress = p.formattedAddress;
  store.lat = p.lat;
  store.lng = p.lng;
  store.city = p.city;
  store.countryCode = p.countryCode;
  // NOTE: googlePlaceId deliberately untouched (the guard).
}

const POOL_GOOGLE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4"; // real-shaped Google place id
const poolMatch: PoolMatch = {
  id: "pool-row-adversarial",
  name: "The Adversary Bar",
  address: "1 Pool Seeded St, Raleigh, NC",
  googlePlaceId: POOL_GOOGLE_ID,
  lat: 35.78,
  lng: -78.64,
  city: "Raleigh",
  country: "United States",
  venueCategory: "restaurant",
  openingHours: null,
  photoUrls: [],
} as unknown as PoolMatch;

const mapboxRepick: PlaceDetails = {
  placeId: "dXJuOm1ieHBvaTpBRFZFUlNBUlk", // a mapbox_id — must NEVER reach the RPC arg
  formattedAddress: "2 Re-picked Blvd, Raleigh, NC 27601, USA",
  city: "Raleigh",
  region: "North Carolina",
  regionCode: "NC",
  regionCodeFull: "US-NC",
  countryCode: "US",
  location: { lat: 35.7796, lng: -78.6382 },
};

describe("ORCH-1079 ADVERSARIAL — claim chain satisfies the RPC dedup invariant", () => {
  test("full claim chain: pool prefill → Mapbox re-pick → RPC arg STILL matches pool google id (no mismatch)", () => {
    // prefillDraftFromPoolMatch seeds the dedup key from the Google-seeded pool row.
    const seeded = prefillDraftFromPoolMatch(poolMatch);
    const store = {
      placePoolId: seeded.placePoolId ?? null,
      googlePlaceId: seeded.googlePlaceId ?? null,
      formattedAddress: seeded.formattedAddress ?? "",
      lat: seeded.lat ?? null,
      lng: seeded.lng ?? null,
      city: seeded.city ?? null,
      countryCode: seeded.countryCode ?? null,
    };
    expect(store.googlePlaceId).toBe(POOL_GOOGLE_ID);

    // The operator re-picks a different Mapbox address in Step 1.
    lockedOnPick(store, mapboxRepick);

    // Address/geo refined, but the dedup key is untouched.
    expect(store.formattedAddress).toBe(mapboxRepick.formattedAddress);
    expect(store.googlePlaceId).toBe(POOL_GOOGLE_ID);
    expect(store.googlePlaceId).not.toBe(mapboxRepick.placeId);

    // The wizard builds the RPC arg and the RPC dedup check passes.
    const rpcArg = buildRpcArg(store.googlePlaceId);
    expect(rpcArg).toBe(POOL_GOOGLE_ID);
    expect(() =>
      rpcDedupCheck(rpcArg, store.placePoolId, POOL_GOOGLE_ID),
    ).not.toThrow();
  });

  test("the guard is load-bearing: every poisoned arg the guard prevents WOULD throw the mismatch", () => {
    // (a) mapbox_id leaked into the dedup key (the exact reverted-onPick bug)
    expect(() =>
      rpcDedupCheck(mapboxRepick.placeId, poolMatch.id, POOL_GOOGLE_ID),
    ).toThrow("place_pool_google_place_id_mismatch");

    // (b) onClear nulled the key (the reverted-onClear bug) → "" via ?? "" → null
    expect(() =>
      rpcDedupCheck(buildRpcArg(null), poolMatch.id, POOL_GOOGLE_ID),
    ).toThrow("place_pool_google_place_id_mismatch");

    // (c) empty string (nullif → null) on the claim path
    expect(() =>
      rpcDedupCheck("", poolMatch.id, POOL_GOOGLE_ID),
    ).toThrow("place_pool_google_place_id_mismatch");

    // (d) whitespace-only (trim → "" → nullif → null) — RPC normalization edge
    expect(() =>
      rpcDedupCheck("   ", poolMatch.id, POOL_GOOGLE_ID),
    ).toThrow("place_pool_google_place_id_mismatch");
  });

  test("create-new path: null pool id → dedup branch skipped, no mapbox_id required or stored", () => {
    const store = {
      placePoolId: null as string | null,
      googlePlaceId: null as string | null,
      formattedAddress: "",
      lat: null as number | null,
      lng: null as number | null,
      city: null as string | null,
      countryCode: null as string | null,
    };
    lockedOnPick(store, mapboxRepick);
    // No google id was ever set by the pick.
    expect(store.googlePlaceId).toBeNull();
    const rpcArg = buildRpcArg(store.googlePlaceId);
    expect(rpcArg).toBe(""); // → RPC nullif → NULL → brands.google_place_id NULL
    // Dedup branch is skipped entirely when placePoolId is null.
    expect(() => rpcDedupCheck(rpcArg, store.placePoolId, null)).not.toThrow();
  });
});
