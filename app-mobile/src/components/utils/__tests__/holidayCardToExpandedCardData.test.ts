// @ts-nocheck — jest globals (describe/it/expect) per the app-mobile test convention
// (see friendMenu.test.ts / NotificationsSheet.test.tsx). Runtime-typechecked by jest.
// ORCH-0997 [friend-page cards → deck parity] — implementor happy-path regression.
// Locks the RC#2 fix: a friend-page HolidayCard must map onto ExpandedCardData with
// `image`/`images` (NOT `imageUrl`) and `location.{lat,lng}` (NOT flat lat/lng), so
// ExpandedCardModal renders the hero photo + location data instead of the grey
// "No images available" box. Fails-on-revert if the image/location mapping regresses.
import { holidayCardToExpandedCardData } from '../holidayCardToExpandedCardData';
import type { HolidayCard } from '../../../services/holidayCardsService';

const OPTS = { travelMode: 'walking', currencySymbol: '$', currencyRate: 1 };

function makeCard(overrides: Partial<HolidayCard> = {}): HolidayCard {
  return {
    id: 'p1',
    title: 'Nike Art Gallery',
    category: 'Icebreakers',
    categorySlug: 'icebreakers',
    imageUrl: 'https://cdn.example/0.jpg',
    rating: 4.7,
    priceLevel: null,
    address: '2 Nike Art Gallery Rd, Lekki, Lagos',
    googlePlaceId: 'gp_1',
    lat: 6.45,
    lng: 3.47,
    priceTier: 'chill',
    description: null,
    cardType: 'single',
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
    ...overrides,
  };
}

describe('holidayCardToExpandedCardData (ORCH-0997 RC#2)', () => {
  it('T-01: maps a single card to deck-fidelity ExpandedCardData (image/images/location)', () => {
    const out = holidayCardToExpandedCardData(makeCard(), OPTS);
    // RC#2 core: the modal reads `image`/`images`, not `imageUrl`.
    expect(out.image).toBe('https://cdn.example/0.jpg');
    expect(out.images).toEqual(['https://cdn.example/0.jpg']);
    // RC#2 core: the modal reads `location.{lat,lng}`, not flat lat/lng.
    expect(out.location).toEqual({ lat: 6.45, lng: 3.47 });
    expect(out.categoryIcon).toBeTruthy();
    expect(out.rating).toBe(4.7);
    expect(out.address).toBe('2 Nike Art Gallery Rd, Lekki, Lagos');
    // No fabrication (Constitution #9).
    expect(out.reviewCount).toBe(0);
    expect(out.highlights).toEqual([]);
  });

  it('T-02: missing image/coords/rating → honest empties, never undefined image or a throw', () => {
    const out = holidayCardToExpandedCardData(
      makeCard({ imageUrl: null, lat: null, lng: null, rating: null, priceTier: null }),
      OPTS,
    );
    expect(out.image).toBe('');
    expect(out.images).toEqual([]);
    expect(out.location).toBeUndefined();
    expect(out.rating).toBe(0);
    expect(out.priceRange).toBeUndefined();
  });

  it('T-03a: curated card carries cardType + stops + experienceType through to the modal', () => {
    const stopsData = [
      { stopNumber: 1, stopLabel: 'Start Here', placeId: 's1', placeName: 'A', rating: 4.5, lat: 1, lng: 2 },
      { stopNumber: 2, stopLabel: 'End With', placeId: 's2', placeName: 'B', rating: 4.2, lat: 3, lng: 4 },
    ];
    const out = holidayCardToExpandedCardData(
      makeCard({ cardType: 'curated', experienceType: 'romantic', stops: 2, stopsData }),
      OPTS,
    );
    expect(out.cardType).toBe('curated');
    expect(out.experienceType).toBe('romantic');
    expect(out.stops).toHaveLength(2);
    expect(out.stops?.[0]?.placeId).toBe('s1');
  });
});
