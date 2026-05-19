import { prefillDraftFromPoolMatch } from "../prefillDraftFromPoolMatch";
import type { PoolMatch } from "../../types/poolMatch";

const sample: PoolMatch = {
  id: "pool-1",
  name: "Joe's Pizza",
  address: "123 Main St",
  city: "New York",
  country: "US",
  lat: 40.7,
  lng: -74.0,
  googlePlaceId: "ChIJx",
  primaryPhotoUrl: "https://cdn/a.jpg",
  primaryType: "pizza_restaurant",
  types: [],
  venueCategory: "restaurant",
  openingHours: null,
  photoUrls: ["https://cdn/a.jpg"],
};

describe("prefillDraftFromPoolMatch", () => {
  test("sets placePoolId and location fields", () => {
    const p = prefillDraftFromPoolMatch(sample);
    expect(p.placePoolId).toBe("pool-1");
    expect(p.googlePlaceId).toBe("ChIJx");
    expect(p.displayName).toBe("Joe's Pizza");
    expect(p.formattedAddress).toBe("123 Main St");
    expect(p.photoUris).toEqual(["https://cdn/a.jpg"]);
    expect(p.venueCategory).toBe("restaurant");
  });
});
