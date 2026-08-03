// @ts-nocheck — Jest globals follow the app-mobile test convention.
import { savedCardToExpandedCardData } from "../savedCardToExpandedCardData";
import { holidayCardToExpandedCardData } from "../holidayCardToExpandedCardData";

const canonical = {
  priceRangeStatus: "active",
  sourceMinMinor: 10000,
  sourceMaxMinor: null,
  sourceCurrencyCode: "NGN",
  sourceMinorUnitExponent: 2,
  displayMinMinor: 63,
  displayMaxMinor: null,
  displayCurrencyCode: "USD",
  displayMinorUnitExponent: 2,
  priceIsApproximate: true,
  fxSnapshotId: "00000000-0000-4000-8000-000000000001",
  fxProvider: "exchange_rate_api_open_v6",
  fxProviderUpdatedAt: "2027-01-29T00:00:00.000Z",
  fxFreshness: "fresh",
};

describe("issue #1384 saved/holiday carrier round trips", () => {
  it("retains every canonical field through a saved-card expansion", () => {
    const out = savedCardToExpandedCardData({
      id: "p1",
      title: "Source priced place",
      lat: 6.45,
      lng: 3.47,
      ...canonical,
    });
    expect(out).toMatchObject(canonical);
    expect(out?.priceTier).toBeUndefined();
  });

  it("retains every canonical field through a holiday-card expansion", () => {
    const out = holidayCardToExpandedCardData({
      id: "p1",
      title: "Source priced place",
      category: "Casual",
      categorySlug: "casual_food",
      imageUrl: null,
      rating: null,
      priceLevel: null,
      address: null,
      googlePlaceId: null,
      lat: 6.45,
      lng: 3.47,
      priceTier: "treat",
      priceRange: "Approx. $0.63+",
      description: null,
      cardType: "single",
      tagline: null,
      stops: 0,
      stopsData: null,
      totalPriceMin: null,
      totalPriceMax: null,
      website: null,
      estimatedDurationMinutes: null,
      experienceType: null,
      categories: null,
      shoppingList: null,
      ...canonical,
    }, { travelMode: "walking" });
    expect(out).toMatchObject(canonical);
    expect(out.priceTier).toBeUndefined();
  });
});
