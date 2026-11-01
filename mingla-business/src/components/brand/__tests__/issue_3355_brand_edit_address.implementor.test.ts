/**
 * #3355 P5 (C3) — Brand Edit's address is a structured search that also sets
 * the brand's city and country (and point), saved in the same update.
 *
 * Fails on revert: putting back the free-text Input, dropping the city/country
 * keys from computeDirtyFieldsPatch, or forking the creation search all turn
 * a test below red. The DB half (the save clears Ari's stale address and
 * city/country flags under RLS) is proven by
 * supabase/migrations/__tests__/issue_3355_p5_home_readiness.implementor.pg17.test.sql.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

import type { PlaceDetails } from "../../../services/mapboxGeocodeService";
import { mapUiToBrandUpdatePatch } from "../../../services/brandMapping";
import type { Brand } from "../../../types/brand";
import {
  brandAddressPatchFromLocation,
  brandAddressPatchFromPlace,
  brandCityCountryLine,
} from "../../../utils/brandAddressPatch";
import { computeDirtyFieldsPatch } from "../../../utils/brandPatch";

const VIEW = readFileSync(join(__dirname, "..", "BrandEditView.tsx"), "utf8");
const FIELD = readFileSync(join(__dirname, "..", "BrandEditAddressField.tsx"), "utf8");

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
    });
  });

  test("ORCH-1079: a Mapbox id never reaches google_place_id", () => {
    const patch = brandAddressPatchFromPlace(margate);
    expect(Object.keys(patch)).not.toContain("googlePlaceId");
    expect(JSON.stringify(patch)).not.toContain(margate.placeId);
  });

  test("a place with no country leaves the saved country alone (never blanks it)", () => {
    expect(
      brandAddressPatchFromLocation("Somewhere", {
        lat: 1,
        lng: 2,
        city: null,
        countryCode: null,
      }),
    ).toEqual({ address: "Somewhere", lat: 1, lng: 2 });
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
    // The field shows the saved text as the selected address (no re-search).
    expect(FIELD).toContain('text.trim().length > 0 ? "selected" : "editing"');
    expect(FIELD).toContain("selectedLabel={text.length > 0 ? text : null}");
  });

  test("the city/country line reads back what will be saved", () => {
    expect(brandCityCountryLine("Margate", "gb")).toBe("City and country: Margate, GB");
    expect(brandCityCountryLine(undefined, undefined)).toBe(
      "No city or country yet. Pick your address to set them.",
    );
  });

  test("Brand Edit renders the structured field, not a free-text address Input", () => {
    expect(VIEW).toContain("<BrandEditAddressField");
    expect(VIEW).not.toContain('placeholder="e.g. 12 Old Street, London EC1V 9HL"');
    expect(VIEW).toContain('onLayout={handleSectionLayout("address")}');
  });

  test("the field reuses brand creation's search, it does not fork it", () => {
    expect(FIELD).toContain('from "../location/MapboxAddressInput"');
    expect(FIELD).toContain("resolveFreeTextLocation");
    expect(FIELD).toContain("isFreeTextResolveStale");
    expect(FIELD).not.toMatch(/fetch\(|mapbox\.com|functions\.invoke/);
  });
});
