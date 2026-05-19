import { mapMinglaSlugToVenueCategory } from "../mapMinglaSlugToVenueCategory";

describe("mapMinglaSlugToVenueCategory", () => {
  test("play slug → play", () => {
    expect(mapMinglaSlugToVenueCategory("play")).toBe("play");
  });

  test("creative_arts slug → creative_and_arts", () => {
    expect(mapMinglaSlugToVenueCategory("creative_arts")).toBe(
      "creative_and_arts",
    );
  });

  test("dining slugs → restaurant", () => {
    expect(mapMinglaSlugToVenueCategory("brunch_lunch_casual")).toBe(
      "restaurant",
    );
    expect(mapMinglaSlugToVenueCategory(null)).toBe("restaurant");
  });
});
