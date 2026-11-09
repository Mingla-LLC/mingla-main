/**
 * #4347 rework (P2-1) — the phone-calendar note for a plan.
 *
 * An AI plan's note gives its spend level (Decision 2). A BRAND EXPERIENCE's
 * stops all carry price 0 (its price is the envelope, in the host's currency),
 * so a spend level computed from them reads "Free" over a paid experience.
 * Likes and Calendar copies can lose `cardType`; the service must recognise
 * the experience the same way savedCardToExpandedCardData and
 * ExpandedCardModal do (isBrandExperiencePayload: brandId + eventId + stops).
 *
 * Runs in the app-mobile render lane (jest.issue2774.render.cjs), with
 * expo-calendar mocked.
 *
 * FAILS-ON-REVERT: going back to `card?.cardType !== 'experience'` writes
 * "Spend level: Free" for the tag-less experience and fails E-2; deciding by
 * isBrandExperiencePayload (which trusts an explicit 'curated' tag) fails E-4.
 */
jest.mock(
  "expo-calendar",
  () => ({
    AlarmMethod: { ALERT: "alert" },
    EntityTypes: { EVENT: "event" },
  }),
  { virtual: true },
);

import { DeviceCalendarService } from "../deviceCalendarService";

const START = new Date("2026-11-20T18:00:00.000Z");

const experienceStops = [
  { placeName: "Terra Kulture", address: "Victoria Island", rating: 0, priceTier: "free", priceMin: 0, priceMax: 0 },
  { placeName: "Nok", address: "Ikoyi", rating: 0, priceTier: "free", priceMin: 0, priceMax: 0 },
];

describe("#4347 device calendar spend level", () => {
  it("E-1 an AI plan's note gives its spend level and no amount", () => {
    const event = DeviceCalendarService.createEventFromCuratedCard(
      {
        cardType: "curated",
        tagline: "A night out",
        stops: [
          { placeName: "Cafe", address: "A", rating: 4.5, priceTier: "chill", priceMin: 0, priceMax: 50 },
          { placeName: "Bistro", address: "B", rating: 4.6, priceTier: "comfy", priceMin: 50, priceMax: 150 },
        ],
        totalPriceMin: 50,
        totalPriceMax: 200,
      },
      START,
      120,
    );
    expect(event.notes).toContain("Spend level: Moderate");
    expect(event.notes).not.toMatch(/\$\d/);
  });

  it("E-2 a paid brand experience that lost its cardType gets no spend-level line", () => {
    const event = DeviceCalendarService.createEventFromCuratedCard(
      {
        // No cardType: the Likes / Calendar copy dropped it.
        brandId: "brand-1",
        eventId: "event-1",
        tagline: "Lagos food walk",
        stops: experienceStops,
        totalPriceMin: 100000,
        totalPriceMax: 100000,
        currency: "NGN",
      },
      START,
      150,
    );
    expect(event.notes).not.toContain("Spend level");
    expect(event.notes).not.toContain("Free");
  });

  it("E-4 a paid brand experience WRONGLY tagged curated still gets no spend-level line", () => {
    const event = DeviceCalendarService.createEventFromCuratedCard(
      {
        cardType: "curated",
        brandId: "brand-1",
        eventId: "event-1",
        tagline: "Lagos food walk",
        stops: experienceStops,
        totalPriceMin: 100000,
        totalPriceMax: 100000,
        currency: "NGN",
      },
      START,
      150,
    );
    expect(event.notes).not.toContain("Spend level");
  });

  it("E-3 a tagged brand experience gets no spend-level line either", () => {
    const event = DeviceCalendarService.createEventFromCuratedCard(
      { cardType: "experience", brandId: "b", eventId: "e", stops: experienceStops, currency: "NGN" },
      START,
      150,
    );
    expect(event.notes).not.toContain("Spend level");
  });
});
