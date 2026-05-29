// @ts-nocheck — jest globals per the app-mobile test convention (friendMenu/NotificationsSheet).
// ORCH-0997 [friend-page cards → deck parity] — TESTER adversarial regression.
// Attacks a DIFFERENT angle than the implementor's happy-path (T-01/T-02/T-03a):
// malformed/invalid input + invalid enums + curated boundaries. The mapper must
// never throw and must never fabricate data from bad input (Constitution #9).
import { holidayCardToExpandedCardData } from '../holidayCardToExpandedCardData';
import type { HolidayCard } from '../../../services/holidayCardsService';

const OPTS = { travelMode: 'driving', currencySymbol: '€', currencyRate: 0.92 };

function makeCard(overrides: Partial<HolidayCard> = {}): HolidayCard {
  return {
    id: 'adv1', title: 'X', category: 'Drink', categorySlug: 'drink',
    imageUrl: 'https://cdn/x.jpg', rating: 4.0, priceLevel: null, address: 'addr',
    googlePlaceId: 'g1', lat: 1, lng: 2, priceTier: 'comfy', description: null,
    cardType: 'single', tagline: null, stops: 0, stopsData: null, totalPriceMin: null,
    totalPriceMax: null, website: null, estimatedDurationMinutes: null,
    experienceType: null, categories: null, shoppingList: null, ...overrides,
  };
}

describe('holidayCardToExpandedCardData — adversarial (ORCH-0997)', () => {
  it('A-01: curated card with stopsData=null → stops undefined, cardType preserved, no throw', () => {
    const out = holidayCardToExpandedCardData(
      makeCard({ cardType: 'curated', stopsData: null, experienceType: 'romantic' }),
      OPTS,
    );
    expect(out.cardType).toBe('curated');
    expect(out.stops).toBeUndefined();
    expect(out.experienceType).toBe('romantic');
  });

  it('A-02: curated card with non-array stopsData (string) → stops undefined, no throw', () => {
    const out = holidayCardToExpandedCardData(
      makeCard({ cardType: 'curated', stopsData: 'corrupt' as unknown as HolidayCard['stopsData'] }),
      OPTS,
    );
    expect(out.cardType).toBe('curated');
    expect(out.stops).toBeUndefined();
  });

  it('A-03: invalid priceTier enum → priceTier AND priceRange undefined (no fabrication, Constitution #9)', () => {
    const out = holidayCardToExpandedCardData(
      makeCard({ priceTier: 'premium' as unknown as HolidayCard['priceTier'] }),
      OPTS,
    );
    expect(out.priceTier).toBeUndefined();
    expect(out.priceRange).toBeUndefined();
  });

  it('A-04: curated card with empty stopsData [] → stops is empty array, no throw', () => {
    const out = holidayCardToExpandedCardData(
      makeCard({ cardType: 'curated', stopsData: [] }),
      OPTS,
    );
    expect(out.cardType).toBe('curated');
    expect(Array.isArray(out.stops)).toBe(true);
    expect(out.stops).toHaveLength(0);
  });

  it('A-05: curated card with malformed stop elements → mapper passes through without throwing', () => {
    const malformed = [{ junk: true }, null, 42];
    const out = holidayCardToExpandedCardData(
      makeCard({ cardType: 'curated', stopsData: malformed as unknown as HolidayCard['stopsData'] }),
      OPTS,
    );
    // The mapper does not element-validate (the curated renderer + deck share the
    // same source shape); it must at least not crash and must preserve the count.
    expect(out.stops).toHaveLength(3);
  });

  it('A-06: lat present but lng null → location undefined (partial coords are not half-trusted)', () => {
    const out = holidayCardToExpandedCardData(makeCard({ lat: 5, lng: null }), OPTS);
    expect(out.location).toBeUndefined();
  });

  it('A-07: empty-string imageUrl is treated as no image (images stays empty, no [""])', () => {
    const out = holidayCardToExpandedCardData(makeCard({ imageUrl: '' }), OPTS);
    expect(out.image).toBe('');
    expect(out.images).toEqual([]);
  });
});
