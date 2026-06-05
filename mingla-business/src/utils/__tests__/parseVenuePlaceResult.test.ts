// [TEST-MOD-APPROVED ORCH-1079] [TEST-RENAME-APPROVED ORCH-1079]
import { describe, expect, test } from "@jest/globals";
import type { PlaceDetails } from "../../services/mapboxGeocodeService";
import { parseVenuePlaceResult } from "../parseVenuePlaceResult";

describe("parseVenuePlaceResult (Ve1)", () => {
  test("maps PlaceDetails to persistence shape", () => {
    const details: PlaceDetails = {
      placeId: "ChIJxxx",
      formattedAddress: "1 Test St, London",
      city: "London",
      region: null,
      regionCode: null,
      regionCodeFull: null,
      countryCode: "GB",
      location: { lat: 51.5, lng: -0.12 },
    };
    expect(parseVenuePlaceResult(details)).toEqual({
      placeId: "ChIJxxx",
      formattedAddress: "1 Test St, London",
      city: "London",
      countryCode: "GB",
      lat: 51.5,
      lng: -0.12,
    });
  });
});
