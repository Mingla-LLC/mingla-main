/**
 * #4490 Explorer W3 — tester adversarial (L3). Pins the card, page and pane
 * wording against spec 06 §6 and the "a card never disagrees with its page"
 * rule. Tests marked FINDING fail on c28f6842cc and name the finding id.
 *
 * W3 fix 1 (implementor): assertions unchanged. The facts fixture follows the
 * server's new card facts (plansLive, membershipsPeriod, onTodayEndsAt,
 * onTodayLiveUntil): A-1 says plans are live (the server's "has live plans"
 * fact), A-2 carries what the server now sends for that venue (the cheapest
 * joinable plan, the yearly ₦10,000, with its period). The old fixture encoded
 * the pre-fix answer (monthly-only ₦25,000, no period) that the fix removes.
 */
import {
  deckBrowsesToday,
  deckVenueEventChip,
  deckVenueOfferChip,
  type DeckVenueFacts,
} from '@mingla/brand-rendering/deckVenueChip';
import { deriveVenuePage, parsePublicVenueFeatures } from '@mingla/brand-rendering/venueFeaturePage';
import { offerPaneRows, paneBar, planPaneRows } from '../venuePaneModel';

interface M {
  toBe(v: unknown): void;
  toEqual(v: unknown): void;
  toBeNull(): void;
  not: { toBe(v: unknown): void; toBeNull(): void; toMatch(r: RegExp): void };
  toMatch(r: RegExp): void;
}
declare const describe: (name: string, body: () => void) => void;
declare const test: (name: string, body: () => void) => void;
declare const expect: (v: unknown) => M;

const money = (minor: number): string => `₦${(minor / 100).toLocaleString('en-NG')}`;
const moneyText = (minor: number): string => money(minor);
const NO_PRICE = { entry: null, group_packages: null, private_hire: null, by_the_hour: null, memberships: null };
const facts = (over: Partial<DeckVenueFacts> = {}): DeckVenueFacts => ({
  venueId: 'v1', venueName: 'Kora', venueSlug: 'kora', brandId: 'b1', brandSlug: 'kora', brandName: 'Kora',
  venueType: 'coworking', timezone: 'Africa/Lagos', features: ['memberships'], isBookable: true,
  tablesReservable: false, plansLive: false, priceFrom: { ...NO_PRICE }, membershipsPeriod: null, currencyCode: 'NGN',
  minorUnitExponent: 2, onTodayStartsAt: null, onTodayEndsAt: null, onTodayLive: false, onTodayLiveUntil: null, ...over,
});
const pagePlans = (plans: Array<{ price: number; interval: 'month' | 'year' }>) =>
  parsePublicVenueFeatures({
    version: 1, features: ['memberships'], currencyCode: 'NGN', minorUnitExponent: 2, offers: [], spaces: [],
    events: { upcoming: [] }, hours: { weekly: [], specialDays: [] },
    memberships: {
      fromMinor: Math.min(...plans.map((p) => p.price)),
      interval: [...plans].sort((a, b) => a.price - b.price)[0].interval,
      plans: plans.map((p, i) => ({ id: `p${i}`, name: `Plan ${i}`, priceMinor: p.price, interval: p.interval, joinMode: 'instant', full: false, inclusions: [] })),
    },
  });
const CTX = { menuTabVisible: false, tablesGate: 'blocked' as const, tablesFirst: false };

describe('#4490 W3 tester adversarial', () => {
  test('A-1 FINDING W3-N3: a venue with only yearly plans — the page leads Plans, the card must too (verb, no amount)', () => {
    const view = pagePlans([{ price: 20000000, interval: 'year' }]);
    const page = view === null ? null : deriveVenuePage(view, CTX);
    expect(page?.lead?.tab).toBe('plans');
    const chip = deckVenueOfferChip(facts({ plansLive: true }), money);
    // §6: "With no price for the lead feature, the chip is the lead's existing verb".
    expect(chip?.tab).toBe('plans');
  });

  test('A-2 FINDING W3-N4: a yearly plan cheaper than the monthly one — page row and card price must not disagree', () => {
    const view = pagePlans([{ price: 2500000, interval: 'month' }, { price: 1000000, interval: 'year' }]);
    const page = view === null ? null : deriveVenuePage(view, CTX);
    const card = deckVenueOfferChip(facts({ plansLive: true, priceFrom: { ...NO_PRICE, memberships: 1000000 }, membershipsPeriod: 'year' }), money);
    expect(page?.lead?.row?.value).toBe(card?.label);
  });

  test('A-3 FINDING W3-N5: a cached daytime start that has long ended does not say "On tonight" at 20:00', () => {
    // Event started 10:00 Lagos; facts cached; now 20:00 Lagos the same day.
    const chip = deckVenueEventChip(
      facts({ onTodayStartsAt: '2026-11-22T09:00:00Z' }),
      new Date('2026-11-22T19:00:00Z'),
    );
    expect(chip).toBeNull();
  });

  test('A-4 a start after the next 05:00 says nothing; a start before says tonight', () => {
    expect(deckVenueEventChip(facts({ onTodayStartsAt: '2026-11-23T04:00:00Z' }), new Date('2026-11-22T19:00:00Z'))).toBeNull();
    expect(deckVenueEventChip(facts({ onTodayStartsAt: '2026-11-23T03:59:00Z' }), new Date('2026-11-22T19:00:00Z'))).toBe('On tonight');
    expect(deckVenueEventChip(facts({ onTodayStartsAt: '2026-11-22T15:59:00Z' }), new Date('2026-11-22T08:00:00Z'))).toBe('On today');
    expect(deckVenueEventChip(facts({ onTodayStartsAt: '2026-11-22T16:00:00Z' }), new Date('2026-11-22T08:00:00Z'))).toBe('On tonight');
  });

  test('A-5 the deck date options: only today/unset/legacy-now show the event chip', () => {
    expect(deckBrowsesToday('today')).toBe(true);
    expect(deckBrowsesToday('now')).toBe(true);
    expect(deckBrowsesToday(undefined)).toBe(true);
    for (const other of ['this_weekend', 'pick_dates', 'this-weekend', 'weekend', 'pick-a-date', 'custom']) {
      expect(deckBrowsesToday(other)).toBe(false);
    }
  });

  test('A-6 FINDING W3-N6: a free entry row on the pane never reads "from ₦0"', () => {
    const rows = offerPaneRows('entry', [{ id: 'o1', kind: 'entry', entryStyle: 'walk_in', name: 'Free night', summary: null,
      fromMinor: 0, unit: 'guest', guestMin: null, guestMax: null, confirmationMode: 'instant', spaceIds: null, sortOrder: 0 }],
      new Map([['o1', { state: 'ready', soldOut: false }]]), { code: 'NGN', exponent: 2 }, moneyText);
    expect(rows[0]?.price).not.toMatch(/₦0\b/);
  });

  test('A-7 a sold-out cheapest row is never the bar; a yearly plan reads "a year"', () => {
    const rows = planPaneRows([
      { id: 'p1', name: 'Cheap', summary: null, priceMinor: 100000, period: 'month', joinMode: 'instant', assignedDeskAvailable: false,
        inclusions: [], entryIncluded: false, roomHours: 0, guestPasses: 0, discountBps: 0, discountKinds: [], minMonths: 1,
        noticeDays: 0, graceDays: 0, renewalNoticeDays: 0, full: true },
      { id: 'p2', name: 'Year', summary: null, priceMinor: 900000, period: 'year', joinMode: 'request', assignedDeskAvailable: false,
        inclusions: [], entryIncluded: false, roomHours: 0, guestPasses: 0, discountBps: 0, discountKinds: [], minMonths: 1,
        noticeDays: 0, graceDays: 0, renewalNoticeDays: 0, full: false },
    ], { code: 'NGN', exponent: 2 }, moneyText);
    expect(rows[1]?.price).toMatch(/a year$/);
    expect(paneBar('plans', rows, [], 'Buy entry')?.rowId).toBe('p2');
  });

  test('A-8 a non-bookable venue never gets an offer chip, even with stale prices', () => {
    expect(deckVenueOfferChip(facts({ isBookable: false, priceFrom: { ...NO_PRICE, memberships: 2500000 } }), money)).toBeNull();
  });
});
