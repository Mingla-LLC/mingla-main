/**
 * #3355 P5 (C3) — Brand Edit's address is a structured search that also sets
 * the brand's city and country (and point), saved in the same update.
 *
 * Fails on revert: dropping the city/country keys from computeDirtyFieldsPatch
 * or the patch mapping turns a test below red. The field itself (pick, typed
 * address, legacy load) is rendered in
 * issue_3355_brand_edit_address_field.implementor.test.tsx. The DB half (the save clears Ari's stale address and
 * city/country flags under RLS) is proven by
 * supabase/migrations/__tests__/issue_3355_p5_home_readiness.implementor.pg17.test.sql.
 */
import { describe, expect, test } from "@jest/globals";

import type { PlaceDetails } from "../../../services/placesService";
import { mapUiToBrandUpdatePatch } from "../../../services/brandMapping";
import type { Brand } from "../../../types/brand";
import {
  brandAddressPatchFromLocation,
  brandAddressPatchFromPlace,
  brandCityCountryLine,
} from "../../../utils/brandAddressPatch";
import { computeDirtyFieldsPatch } from "../../../utils/brandPatch";

const margate: PlaceDetails = {
  placeId: "dXJuOm1ieHBvaTo",
  formattedAddress: "12 Harbour Street, Margate CT9 1EU, United Kingdom",
  city: "Margate",
  region: "England",
  regionCode: null,
  regionCodeFull: null,
  countryCode: "gb",
  location: { lat: 51.3891, lng: 1.3863 },
} as PlaceDetails;

const brand = (over: Partial<Brand> = {}): Brand =>
  ({
    id: "b1",
    displayName: "Lantern Supper Club",
    address: "1 Old Arch, London",
    city: "London",
    countryCode: "GB",
    lat: 51.5,
    lng: -0.1,
    ...over,
  }) as Brand;

describe("#3355 P5 — Brand Edit structured address", () => {
  test("a picked place writes address, city, country and point together", () => {
    expect(brandAddressPatchFromPlace(margate, "12 Harbour Street, Margate")).toEqual({
      address: "12 Harbour Street, Margate",
      city: "Margate",
      countryCode: "GB",
      lat: 51.3891,
      lng: 1.3863,
      locationProviderPlaceId: margate.placeId,
    });
  });

  test("ORCH-1079: a picked place id never reaches google_place_id", () => {
    const patch = brandAddressPatchFromPlace(margate);
    expect(Object.keys(patch)).not.toContain("googlePlaceId");
    // #4334 — it is saved, but only in its own column beside the pin.
    expect(patch.locationProviderPlaceId).toBe(margate.placeId);
  });

  test("a place with no country leaves the saved country alone (never blanks it)", () => {
    expect(
      brandAddressPatchFromLocation("Somewhere", {
        lat: 1,
        lng: 2,
        city: null,
        countryCode: null,
      }),
    ).toEqual({ address: "Somewhere", lat: 1, lng: 2, locationProviderPlaceId: null });
  });

  test("the save patch carries city/country/point to the brands row", () => {
    // Moving from Paris to Margate changes the city AND the country.
    const original = brand({ address: "1 Rue Old, Paris", city: "Paris", countryCode: "FR" });
    const draft = { ...original, ...brandAddressPatchFromPlace(margate) };
    const patch = computeDirtyFieldsPatch(draft, original);
    expect(patch).toMatchObject({
      address: margate.formattedAddress,
      city: "Margate",
      countryCode: "GB",
      lat: 51.3891,
      lng: 1.3863,
    });
    expect(mapUiToBrandUpdatePatch(patch, { existingDescription: null })).toMatchObject({
      address: margate.formattedAddress,
      city: "Margate",
      country_code: "GB",
      lat: 51.3891,
      lng: 1.3863,
    });
  });

  test("an untouched legacy free-text address loads and saves unchanged", () => {
    // A brand saved before structured search: free text, no city/country/point.
    const legacy = brand({
      address: "Upstairs at the Old Fire Station, ask for Tunde",
      city: undefined,
      countryCode: undefined,
      lat: undefined,
      lng: undefined,
    });
    // Brand Edit's draft starts as the brand itself; nothing touched → no write.
    expect(computeDirtyFieldsPatch({ ...legacy }, legacy)).toEqual({});
    // Editing another field leaves the address keys out of the patch entirely.
    const other = computeDirtyFieldsPatch({ ...legacy, displayName: "Lantern" }, legacy);
    expect(other).toEqual({ displayName: "Lantern" });
    expect(mapUiToBrandUpdatePatch(other, { existingDescription: null })).not.toHaveProperty("address");
    // The field showing it as the selected address (no re-search) is rendered
    // in issue_3355_brand_edit_address_field.implementor.test.tsx.
  });

  test("the city/country line reads back what will be saved", () => {
    expect(brandCityCountryLine("Margate", "gb")).toBe("City and country: Margate, GB");
    expect(brandCityCountryLine(undefined, undefined)).toBe(
      "No city or country yet. Pick your address to set them.",
    );
  });
});
