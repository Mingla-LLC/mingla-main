/**
 * #4490 Explorer W3 — what a venue card says (`deckVenueChip.ts`, shared with
 * W6's Discover card) and the Plans-before-By-the-hour lead rule.
 *
 *   C-1..C-9  the offer chip follows the page's lead, priced from the server's
 *             "from" price, verb only when there is no price, never for a venue
 *             that is not bookable, never rooms;
 *   E-1..E-8  "On tonight" / "On today" in venue time around 17:00 and 05:00,
 *             live now, a stale cached start, an unknown zone;
 *   D-1       the deck shows the event chip only while browsing today;
 *   P-1/P-2   facts parsing fails closed;
 *   L-1       Plans lead By the hour (decision 13.2); Entry still leads both.
 *   N-*       W3 fix round 1: plans priced with their own period (N3/N4), a
 *             cached event that has ended says nothing (N5), free entry (N6),
 *             the plate tile reads once (N13), a shared deck's dates (N11).
 *
 * [TEST-MOD-APPROVED #4490] W3 fix 1: the facts gain plansLive,
 * membershipsPeriod, onTodayEndsAt and onTodayLiveUntil; the chip gains
 * tileValue; C-9 now pins what its name says (a priceless plans lead shows the
 * lead's verb); E-1/E-6/E-7 carry the end times the event chip now needs.
 *
 * FAILS-ON-REVERT: swap the plans/by_the_hour branches in deriveVenuePage back
 * and L-1 fails; drop the stays re-derivation and C-6 fails; drop the 17:00
 * rule and E-2/E-3 fail; drop the night end and E-5 fails.
 */
import {
  deckBrowsesToday,
  deckVenueChips,
  sessionBrowsesToday,
  deckVenueEventChip,
  deckVenueOfferChip,
  parseDeckVenueFacts,
  venueNightEnd,
  type DeckVenueFacts,
} from '@mingla/brand-rendering/deckVenueChip';
import { deriveVenuePage, parsePublicVenueFeatures } from '@mingla/brand-rendering/venueFeaturePage';

interface W3Matchers {
  toBe(v: unknown): void;
  toEqual(v: unknown): void;
  toBeNull(): void;
  toMatchObject(v: unknown): void;
  not: { toBe(v: unknown): void; toBeNull(): void };
}
declare const describe: (name: string, body: () => void) => void;
declare const test: (name: string, body: () => void) => void;
declare const expect: (v: unknown) => W3Matchers;

const LAGOS = 'Africa/Lagos'; // UTC+1, no DST
const at = (iso: string): Date => new Date(iso);

const facts = (over: Partial<DeckVenueFacts> = {}): DeckVenueFacts => ({
  venueId: 'v1',
  venueName: 'Gameland Lagos',
  venueSlug: 'gamelandlagos',
  brandId: 'b1',
  brandSlug: 'gameland',
  brandName: 'Gameland',
  venueType: 'play',
  timezone: LAGOS,
  features: ['entry', 'group_packages', 'events_here'],
  isBookable: true,
  tablesReservable: false,
  plansLive: false,
  priceFrom: { entry: 400000, group_packages: 1200000, private_hire: null, by_the_hour: null, memberships: null },
  membershipsPeriod: null,
  currencyCode: 'NGN',
  minorUnitExponent: 2,
  onTodayStartsAt: null,
  onTodayEndsAt: null,
  onTodayLive: false,
  onTodayLiveUntil: null,
  ...over,
});
// A plain formatter so the test pins the words, not the engine's symbol table.
const money = (minor: number, code: string, exp: number): string => `${code} ${(minor / 10 ** exp).toLocaleString('en-GB')}`;

describe('#4490 W3 deck offer chip', () => {
  test('C-1 entry leads with its server price and opens the Entry tab', () => {
    expect(deckVenueOfferChip(facts(), money)).toEqual({
      tab: 'entry', tabLabel: 'Entry', label: 'Entry from NGN 4,000', tileValue: 'from NGN 4,000', leadKind: 'entry', offerKind: 'entry',
    });
  });

  test('C-2 free entry reads "Free entry"', () => {
    expect(deckVenueOfferChip(facts({ priceFrom: { entry: 0, group_packages: null, private_hire: null, by_the_hour: null, memberships: null } }), money)?.label).toBe('Free entry');
  });

  test('C-3 every lead kind words its price (§6)', () => {
    const only = (features: DeckVenueFacts['features'], priceFrom: Partial<DeckVenueFacts['priceFrom']>) =>
      deckVenueOfferChip(facts({ features, priceFrom: { entry: null, group_packages: null, private_hire: null, by_the_hour: null, memberships: null, ...priceFrom } }), money);
    expect(only(['group_packages'], { group_packages: 1200000 })).toMatchObject({ tab: 'groups', label: 'Groups from NGN 12,000', offerKind: 'group_package' });
    expect(only(['private_hire'], { private_hire: 60000000 })).toMatchObject({ tab: 'hire', label: 'Hire from NGN 600,000', offerKind: 'private_hire' });
    expect(only(['by_the_hour'], { by_the_hour: 500000 })).toMatchObject({ tab: 'by_the_hour', label: 'NGN 5,000 an hour', offerKind: 'by_the_hour' });
    expect(only(['memberships'], { memberships: 2500000 })).toMatchObject({ tab: 'plans', label: 'Plans from NGN 25,000 a month', offerKind: null });
  });

  // [TEST-MOD-APPROVED #4490] W3 fix 4 (W3-N32): a table chip says the venue's
  // ONE table verb (its Tables button and sheet say the same): "Book a table"
  // with minimum-spend tables, otherwise "Reserve a table" (deriveVenuePage).
  test('C-4 tables lead a restaurant and read the venue\'s table verb (no amount)', () => {
    const chip = deckVenueOfferChip(facts({
      venueType: 'restaurant',
      features: ['group_packages', 'table_reservations'],
      tablesReservable: true,
    }), money);
    expect(chip).toMatchObject({ tab: 'reservations', label: 'Reserve a table', leadKind: 'tables', tabLabel: 'Tables' });
    const minSpend = deckVenueOfferChip(facts({
      venueType: 'restaurant',
      features: ['group_packages', 'table_reservations', 'min_spend_tables'],
      tablesReservable: true,
    }), money);
    expect(minSpend).toMatchObject({ tab: 'reservations', label: 'Book a table', leadKind: 'tables' });
  });

  test('C-5 several features: the page lead wins (entry over groups and plans)', () => {
    const chip = deckVenueOfferChip(facts({
      features: ['entry', 'group_packages', 'by_the_hour', 'memberships'],
      priceFrom: { entry: 400000, group_packages: 1000000, private_hire: null, by_the_hour: 600000, memberships: 5000000 },
    }), money);
    expect(chip?.label).toBe('Entry from NGN 4,000');
  });

  test('C-6 a Stay with a day pass leads with the pass; rooms never lead a card', () => {
    const stay = facts({ venueType: 'stay', features: ['entry', 'menu', 'stays'], priceFrom: { entry: 1500000, group_packages: null, private_hire: null, by_the_hour: null, memberships: null } });
    expect(deckVenueOfferChip(stay, money)).toMatchObject({ tab: 'entry', label: 'Entry from NGN 15,000' });
  });

  test('C-7 a Stay with rooms only (not bookable) gets no offer chip, exactly as today', () => {
    expect(deckVenueOfferChip(facts({ venueType: 'stay', features: ['stays'], isBookable: false,
      priceFrom: { entry: null, group_packages: null, private_hire: null, by_the_hour: null, memberships: null } }), money)).toBeNull();
  });

  test('C-8 not bookable (paused offers only) is no chip, never a price', () => {
    expect(deckVenueOfferChip(facts({ isBookable: false, priceFrom: { entry: null, group_packages: null, private_hire: null, by_the_hour: null, memberships: null } }), money)).toBeNull();
  });

  test('C-9 a lead feature with no price is the lead\'s own verb, with no amount', () => {
    // Plans are live but none can be joined today (every plan full): the server sends no
    // plan price. The card still leads with Plans, as the page does, with the verb only.
    const chip = deckVenueOfferChip(facts({ features: ['memberships'], plansLive: true, priceFrom: { entry: null, group_packages: null, private_hire: null, by_the_hour: null, memberships: null } }), money);
    expect(chip).toMatchObject({ tab: 'plans', label: 'Join', tileValue: 'Join' });
    expect(chip !== null && /NGN|\d/.test(chip.label)).toBe(false);
    // No live plans at all: nothing to lead with.
    expect(deckVenueOfferChip(facts({ features: ['memberships'], plansLive: false, priceFrom: { entry: null, group_packages: null, private_hire: null, by_the_hour: null, memberships: null } }), money)).toBeNull();
    const tables = deckVenueOfferChip(facts({ venueType: 'club', features: ['table_reservations'], tablesReservable: true,
      priceFrom: { entry: null, group_packages: null, private_hire: null, by_the_hour: null, memberships: null } }), money);
    // [TEST-MOD-APPROVED #4490] W3 fix 4 (W3-N32): the venue's table verb.
    expect(tables?.label).toBe('Reserve a table');
  });

  test('C-10 the default formatter is the shared venue money formatter', () => {
    const chip = deckVenueOfferChip(facts());
    expect(typeof chip?.label === 'string' && /^Entry from .*4,000$/.test(chip.label)).toBe(true);
  });
});

describe('#4490 W3 deck event chip', () => {
  // 19:00 Lagos = 18:00Z.
  test('E-1 live now is "On tonight" until that date ends', () => {
    expect(deckVenueEventChip(facts({ onTodayLive: true, onTodayLiveUntil: '2026-11-19T11:00:00Z' }), at('2026-11-19T10:00:00Z'))).toBe('On tonight');
    expect(deckVenueEventChip(facts({ onTodayLive: true, onTodayLiveUntil: '2026-11-19T11:00:00Z' }), at('2026-11-19T11:00:00Z'))).toBeNull();
    expect(deckVenueEventChip(facts({ onTodayLive: true, onTodayLiveUntil: null }), at('2026-11-19T10:00:00Z'))).toBeNull();
  });
  test('E-2 a start at 17:00 local or later is "On tonight"', () => {
    expect(deckVenueEventChip(facts({ onTodayStartsAt: '2026-11-19T16:00:00Z' }), at('2026-11-19T10:00:00Z'))).toBe('On tonight');
    expect(deckVenueEventChip(facts({ onTodayStartsAt: '2026-11-19T18:00:00Z' }), at('2026-11-19T10:00:00Z'))).toBe('On tonight');
  });
  test('E-3 a start later today before 17:00 local is "On today"', () => {
    expect(deckVenueEventChip(facts({ onTodayStartsAt: '2026-11-19T15:59:00Z' }), at('2026-11-19T10:00:00Z'))).toBe('On today');
    expect(deckVenueEventChip(facts({ onTodayStartsAt: '2026-11-19T12:00:00Z' }), at('2026-11-19T10:00:00Z'))).toBe('On today');
  });
  test('E-4 after midnight until 04:59 local is still "On tonight"', () => {
    // 03:30 Lagos on the 20th, browsing at 23:00 on the 19th.
    expect(deckVenueEventChip(facts({ onTodayStartsAt: '2026-11-20T02:30:00Z' }), at('2026-11-19T22:00:00Z'))).toBe('On tonight');
  });
  test('E-5 around 05:00 local: a start at or after the night end says nothing', () => {
    // Browsing at 04:59 Lagos: the night ends at 05:00; an 05:00 start is the next day.
    expect(deckVenueEventChip(facts({ onTodayStartsAt: '2026-11-20T04:00:00Z' }), at('2026-11-20T03:59:00Z'))).toBeNull();
    expect(venueNightEnd(at('2026-11-20T03:59:30Z'), LAGOS)?.toISOString()).toBe('2026-11-20T04:00:00.000Z');
    // At 05:00 exactly the next night ends a day later.
    expect(venueNightEnd(at('2026-11-20T04:00:00Z'), LAGOS)?.toISOString()).toBe('2026-11-21T04:00:00.000Z');
  });
  test('E-6 a cached start that has passed means it is on now, until its own end', () => {
    expect(deckVenueEventChip(facts({ onTodayStartsAt: '2026-11-19T12:00:00Z', onTodayEndsAt: '2026-11-19T15:00:00Z' }), at('2026-11-19T12:30:00Z'))).toBe('On tonight');
    // N5: the 10:00 event ended at 13:00; at 20:00 (cache still holding it) it says nothing.
    expect(deckVenueEventChip(facts({ onTodayStartsAt: '2026-11-19T09:00:00Z', onTodayEndsAt: '2026-11-19T12:00:00Z' }), at('2026-11-19T19:00:00Z'))).toBeNull();
    // No end known: a start that has passed claims nothing.
    expect(deckVenueEventChip(facts({ onTodayStartsAt: '2026-11-19T12:00:00Z' }), at('2026-11-19T12:30:00Z'))).toBeNull();
  });
  test('E-7 unknown zone claims nothing (rule 12)', () => {
    const until = '2026-11-19T11:00:00Z';
    expect(deckVenueEventChip(facts({ timezone: null, onTodayLive: true, onTodayLiveUntil: until }), at('2026-11-19T10:00:00Z'))).toBeNull();
    expect(deckVenueEventChip(facts({ timezone: 'Lagos time', onTodayLive: true, onTodayLiveUntil: until }), at('2026-11-19T10:00:00Z'))).toBeNull();
  });
  test('E-8 nothing on today is no chip; chips combine', () => {
    expect(deckVenueChips(facts(), at('2026-11-19T10:00:00Z'), money)).toEqual({
      offerChip: { tab: 'entry', tabLabel: 'Entry', label: 'Entry from NGN 4,000', tileValue: 'from NGN 4,000', leadKind: 'entry', offerKind: 'entry' },
      eventChip: null,
    });
  });
  test('E-9 a half-hour zone ends the night at its own 05:00', () => {
    // Kolkata UTC+5:30: 05:00 local = 23:30Z the day before.
    expect(venueNightEnd(at('2026-11-19T20:00:00Z'), 'Asia/Kolkata')?.toISOString()).toBe('2026-11-19T23:30:00.000Z');
  });
});

describe('#4490 W3 deck date option', () => {
  test('D-1 only today (or unset, or a legacy today) shows the event chip', () => {
    expect(deckBrowsesToday(undefined)).toBe(true);
    expect(deckBrowsesToday(null)).toBe(true);
    expect(deckBrowsesToday('today')).toBe(true);
    expect(deckBrowsesToday('now')).toBe(true);
    expect(deckBrowsesToday('this_weekend')).toBe(false);
    expect(deckBrowsesToday('pick_dates')).toBe(false);
    expect(deckBrowsesToday('weekend')).toBe(false);
  });
});

describe('#4490 W3 facts parsing', () => {
  test('P-1 a server row parses; unknown features drop; bad prices are null', () => {
    const parsed = parseDeckVenueFacts({
      venueId: 'v1', venueName: 'Kora Works', venueSlug: 'koraworks', brandId: 'b1', brandSlug: 'hc', brandName: 'HC',
      venueType: 'coworking', timezone: LAGOS, features: ['entry', 'teleport', 'memberships'], isBookable: true,
      tablesReservable: false, priceFrom: { entry: 600000, memberships: 8500000, by_the_hour: -1, private_hire: '5' },
      currencyCode: 'ngn', minorUnitExponent: 2, onTodayStartsAt: 'not a date', onTodayLive: false,
      plansLive: true, membershipsPeriod: 'year', onTodayEndsAt: '2026-11-19T12:00:00Z', onTodayLiveUntil: 7,
    });
    expect(parsed).toMatchObject({
      features: ['entry', 'memberships'],
      priceFrom: { entry: 600000, memberships: 8500000, by_the_hour: null, private_hire: null, group_packages: null },
      currencyCode: 'NGN',
      onTodayStartsAt: null,
      plansLive: true,
      membershipsPeriod: 'year',
      onTodayEndsAt: '2026-11-19T12:00:00Z',
      onTodayLiveUntil: null,
    });
    expect(parseDeckVenueFacts({ venueId: 'v', venueSlug: 'v', brandSlug: 'b', membershipsPeriod: 'week' })).toMatchObject({
      membershipsPeriod: null, plansLive: false,
    });
  });
  test('P-2 a row without slugs is not a card', () => {
    expect(parseDeckVenueFacts({ venueId: 'v1', venueSlug: '', brandSlug: 'b' })).toBeNull();
    expect(parseDeckVenueFacts(null)).toBeNull();
    expect(parseDeckVenueFacts([])).toBeNull();
  });
});

describe('#4490 W3 lead order (decision 13.2)', () => {
  const view = (features: string[], extra: Record<string, unknown>) => {
    const v = parsePublicVenueFeatures({ features, spaces: [], currencyCode: 'NGN', minorUnitExponent: 2, offers: [], ...extra });
    if (v === null) throw new Error('fixture');
    return v;
  };
  const hourOffer = { id: 'h1', kind: 'by_the_hour', name: 'Room', fromMinor: 500000, unit: 'hour', confirmationMode: 'instant' };
  test('L-1 Plans lead By the hour', () => {
    const page = deriveVenuePage(view(['by_the_hour', 'memberships'], {
      offers: [hourOffer], memberships: { fromMinor: 2500000, interval: 'month' },
    }), { menuTabVisible: false, tablesGate: 'blocked' });
    expect(page.lead?.kind).toBe('memberships');
    expect(page.lead?.tab).toBe('plans');
    // The tab strip keeps its order; Ways to come puts the lead first.
    expect(page.tabs).toEqual(['overview', 'by_the_hour', 'plans']);
    expect(page.ways[0]?.tab).toBe('plans');
  });
  test('L-2 By the hour still leads when there are no plans; Entry still leads both', () => {
    expect(deriveVenuePage(view(['by_the_hour'], { offers: [hourOffer] }), { menuTabVisible: false, tablesGate: 'blocked' }).lead?.kind).toBe('by_the_hour');
    const entry = { id: 'e1', kind: 'entry', name: 'Day pass', fromMinor: 600000, entryStyle: 'day_pass', unit: 'guest', confirmationMode: 'instant' };
    expect(deriveVenuePage(view(['entry', 'by_the_hour', 'memberships'], {
      offers: [entry, hourOffer], memberships: { fromMinor: 2500000, interval: 'month' },
    }), { menuTabVisible: false, tablesGate: 'blocked' }).lead?.kind).toBe('entry');
  });
});

describe('#4490 W3 fix 1', () => {
  const none = { entry: null, group_packages: null, private_hire: null, by_the_hour: null, memberships: null };
  test('N-3 a yearly-only plan is priced with its period on the chip and the tile', () => {
    const chip = deckVenueOfferChip(facts({ features: ['memberships'], plansLive: true,
      priceFrom: { ...none, memberships: 20000000 }, membershipsPeriod: 'year' }), money);
    expect(chip).toMatchObject({ tab: 'plans', label: 'Plans from NGN 200,000 a year', tileValue: 'from NGN 200,000 a year' });
  });
  test('N-4 the card and the page read one plan headline with one period', () => {
    const page = parsePublicVenueFeatures({ features: ['memberships'], spaces: [], currencyCode: 'NGN', minorUnitExponent: 2, offers: [],
      memberships: { fromMinor: 1000000, interval: 'year', plans: [] } });
    if (page === null) throw new Error('fixture');
    const derived = deriveVenuePage(page, { menuTabVisible: false, tablesGate: 'blocked' });
    const card = deckVenueOfferChip(facts({ features: ['memberships'], plansLive: true,
      priceFrom: { ...none, memberships: 1000000 }, membershipsPeriod: 'year' }));
    expect(derived.lead?.row?.value).toBe(card?.label);
    expect(derived.ways.find((w) => w.tab === 'plans')?.price).toBe(card?.tileValue);
  });
  test('N-6 free entry: "Free entry" on the card and the page, "Free" in the tile', () => {
    const chip = deckVenueOfferChip(facts({ features: ['entry'], priceFrom: { ...none, entry: 0 } }), money);
    expect(chip).toMatchObject({ label: 'Free entry', tileValue: 'Free' });
    const page = parsePublicVenueFeatures({ features: ['entry'], spaces: [], currencyCode: 'NGN', minorUnitExponent: 2,
      offers: [{ id: 'e1', kind: 'entry', name: 'Open night', fromMinor: 0, entryStyle: 'walk_in', unit: 'guest', confirmationMode: 'instant' }] });
    if (page === null) throw new Error('fixture');
    const derived = deriveVenuePage(page, { menuTabVisible: false, tablesGate: 'blocked' });
    expect(derived.lead?.row?.value).toBe('Free entry');
    expect(derived.ways.find((w) => w.tab === 'entry')?.price).toBe('Free entry');
  });
  test('N-13 the plate tile reads once: the tab name over the price part only', () => {
    expect(deckVenueOfferChip(facts(), money)).toMatchObject({ tabLabel: 'Entry', tileValue: 'from NGN 4,000' });
    expect(deckVenueOfferChip(facts({ features: ['private_hire'], priceFrom: { ...none, private_hire: 60000000 } }), money))
      .toMatchObject({ tabLabel: 'Private hire', tileValue: 'from NGN 600,000' });
    expect(deckVenueOfferChip(facts({ features: ['by_the_hour'], priceFrom: { ...none, by_the_hour: 500000 } }), money))
      .toMatchObject({ tabLabel: 'By the hour', tileValue: 'from NGN 5,000' });
    const tables = deckVenueOfferChip(facts({ venueType: 'club', features: ['table_reservations'], tablesReservable: true, priceFrom: none }), money);
    // [TEST-MOD-APPROVED #4490] W3 fix 4 (W3-N32): the venue's table verb.
    expect(tables).toMatchObject({ tabLabel: 'Reservations', tileValue: 'Reserve a table' });
  });
  test('N-11 a shared deck shows "On tonight" only when every participant browses today', () => {
    expect(sessionBrowsesToday({ u1: { date_option: 'today' }, u2: { date_option: null } })).toBe(true);
    expect(sessionBrowsesToday({ u1: { date_option: 'today' }, u2: { date_option: 'this_weekend' } })).toBe(false);
    expect(sessionBrowsesToday([{ user_id: 'u1', date_option: 'pick_dates' }])).toBe(false);
    expect(sessionBrowsesToday([{ user_id: 'u1', date_option: 'today' }])).toBe(true);
    // Not loaded yet: claim nothing.
    expect(sessionBrowsesToday(null)).toBe(false);
    expect(sessionBrowsesToday({})).toBe(false);
  });
});
