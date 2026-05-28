import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { curatedCardToCard, resolveHolidayCategorySlugs, resolveSignalIds } from "./personHeroCards.ts";

Deno.test("ORCH-0986 curated combo maps camelCase image and fields", () => {
  const card = curatedCardToCard({
    id: "curated_test",
    title: "Dinner -> Theatre",
    categoryLabel: "Celebration",
    imageUrl: "https://example.com/hero.jpg",
    stops: [
      {
        placeName: "Dinner",
        imageUrl: "https://example.com/hero.jpg",
        priceTier: "bougie",
      },
      {
        placeName: "Theatre",
        imageUrl: "https://example.com/theatre.jpg",
      },
    ],
    totalPriceMin: 80,
    totalPriceMax: 140,
    estimatedDurationMinutes: 180,
    shoppingList: ["tickets"],
  }, "celebration");

  assertEquals(card.imageUrl, "https://example.com/hero.jpg");
  assertEquals(card.category, "Celebration");
  assertEquals(card.priceTier, "bougie");
  assertEquals(card.totalPriceMin, 80);
  assertEquals(card.totalPriceMax, 140);
  assertEquals(card.estimatedDurationMinutes, 180);
  assertEquals(card.shoppingList, ["tickets"]);
  assertEquals(card.stops, 2);
});

Deno.test("ORCH-0986 curated combo falls back to real stop image without fabrication", () => {
  const card = curatedCardToCard({
    id: "curated_test_stop_image",
    title: "Gallery -> Drinks",
    stops: [{ imageUrl: "https://example.com/stop.jpg" }],
  }, "curated");

  assertEquals(card.imageUrl, "https://example.com/stop.jpg");
});

Deno.test("ORCH-0986 batched profile derives occasion-specific singles signals", () => {
  const genericClientSlugs = ["romantic", "adventurous", "upscale_fine_dining", "movies", "play"];
  const birthdaySignals = resolveSignalIds(resolveHolidayCategorySlugs({
    holidayKey: "birthday",
    isCustomHoliday: false,
    categorySlugs: genericClientSlugs,
    curatedExperienceType: null,
  }));
  const valentinesSignals = resolveSignalIds(resolveHolidayCategorySlugs({
    holidayKey: "valentines_day",
    isCustomHoliday: false,
    categorySlugs: genericClientSlugs,
    curatedExperienceType: null,
  }));

  assert(birthdaySignals.join("|") !== valentinesSignals.join("|"));
  assert(birthdaySignals.includes("play"));
  assert(!valentinesSignals.includes("play"));
  assert(valentinesSignals.includes("flowers"));
});
