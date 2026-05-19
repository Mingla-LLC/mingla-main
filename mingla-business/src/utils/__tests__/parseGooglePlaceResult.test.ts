import { describe, expect, test } from "@jest/globals";
import type { PlaceDetails } from "../../services/googlePlacesService";
import { parseGooglePlaceResult } from "../parseGooglePlaceResult";

describe("parseGooglePlaceResult (Ve1)", () => {
  test("maps PlaceDetails to persistence shape", () => {
    const details: PlaceDetails = {
      placeId: "ChIJxxx",
      formattedAddress: "1 Test St, London",
      city: "London",
      region: null,
      countryCode: "GB",
      location: { lat: 51.5, lng: -0.12 },
    };
    expect(parseGooglePlaceResult(details)).toEqual({
      googlePlaceId: "ChIJxxx",
      formattedAddress: "1 Test St, London",
      city: "London",
      countryCode: "GB",
      lat: 51.5,
      lng: -0.12,
    });
  });
});
