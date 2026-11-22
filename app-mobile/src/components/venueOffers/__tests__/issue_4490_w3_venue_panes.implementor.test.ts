/**
 * #4490 Explorer W3 — the venue page panes, the W4 seam, the card sheet's
 * venue blocks, `venue_tapped_to_book`, and the wiring of the venue route, the
 * deck and the card sheet.
 *
 *   R-*  pane rows: server "from" prices in the page's words, verbs, sold out
 *        from availability (hire and entry rows), plans (full = sold out);
 *   S-*  pane states: empty, loading, error, offline, ready;
 *   B-*  the docked bar: cheapest open row, the tab's verb, none when all sold out;
 *   W-*  the availability window is the venue's own today;
 *   X-*  the seam opens the native checkout sheet (06-W4; was the buyer web);
 *   A-*  venue_tapped_to_book's exact properties;
 *   H-*  card sheet Ways to come / What's on rows and paths;
 *   G-*  wiring: route tabs + features + five panes, deck `?tab=` + event chip
 *        rule, sheet blocks + in-app main button, claimed venues via the RPC,
 *        nothing persisted.
 *
 * FAILS-ON-REVERT: route back to the two-value tab ternary and G-1 fails;
 * drop `?tab=` from the deck push and G-3 fails; put the in-app browser back on
 * the sheet's main button and G-5 fails; mark sold out on closed days and R-4
 * fails.
 */
declare const jest: { mock(path: string, factory: () => unknown): void };
import fs from 'node:fs';
import path from 'node:path';

// The analytics wrapper and the Supabase client read Expo config at import:
// stand-ins keep this suite pure (the property shape is what is pinned).
jest.mock("../../../services/postHogService", () => ({ postHogService: { capture: () => undefined } }));
jest.mock("../../../services/supabase", () => ({ supabase: {} }));

import {
  parsePublicVenueFeatures,
  type PublicVenueFeaturesView,
  type VenueFeatureOfferView,
  type VenueFeaturePlanView,
} from '@mingla/brand-rendering/venueFeaturePage';

import {
  offerPaneRows,
  paneAvailabilityWindow,
  paneBar,
  paneStatus,
  planPaneRows,
  PANE_COPY,
  soldOutFromAvailability,
  type OfferAvailability,
} from '../venuePaneModel';
import { openVenueOfferCheckout } from '../venueOfferCheckoutSeam';
import { venueTappedToBookProps } from '../venueBookAnalytics';
import { venuePagePath, venueSheetEvents, venueSheetWays } from '../../expandedCard/venueSheetModel';
import { toClaimedVenue } from '../../../hooks/useClaimedVenues';
import { shouldDehydrateMinglaQuery } from '../../../utils/queryPersistence';

interface W3Matchers {
  toBe(v: unknown): void;
  toEqual(v: unknown): void;
  toBeNull(): void;
  toMatch(v: RegExp): void;
  toMatchObject(v: unknown): void;
  toContain(v: unknown): void;
  not: { toBe(v: unknown): void; toMatch(v: RegExp): void; toBeNull(): void; toContain(v: unknown): void };
}
declare const describe: (name: string, body: () => void) => void;
declare const test: (name: string, body: () => void) => void;
declare const expect: (v: unknown) => W3Matchers;

const NGN = { code: 'NGN', exponent: 2 };
const money = (minor: number, code: string, exp: number): string => `₦${(minor / 10 ** exp).toLocaleString('en-GB')}`;
const offer = (over: Partial<VenueFeatureOfferView>): VenueFeatureOfferView => ({
  id: 'o1', kind: 'entry', entryStyle: 'walk_in', name: 'Arcade day pass', summary: 'All machines, all day',
  fromMinor: 400000, unit: 'guest', guestMin: null, guestMax: null, confirmationMode: 'instant', spaceIds: null, sortOrder: 0,
  ...over,
});
const plan = (over: Partial<VenueFeaturePlanView>): VenueFeaturePlanView => ({
  id: 'p1', name: 'Hot desk', summary: 'Any open desk', priceMinor: 2500000, period: 'month', joinMode: 'instant',
  assignedDeskAvailable: false, inclusions: [], entryIncluded: false, roomHours: 0, guestPasses: 0, discountBps: 0,
  discountKinds: [], minMonths: 1, noticeDays: 0, graceDays: 7, renewalNoticeDays: 7, full: false,
  ...over,
});
const ready = (soldOut: boolean): OfferAvailability => ({ state: 'ready', soldOut });
const read = (rel: string): string => fs.readFileSync(path.join(__dirname, rel), 'utf8');

describe('#4490 W3 pane rows', () => {
  test('R-1 entry rows: the server from price, Buy for a pass and Book for a timed session', () => {
    const rows = offerPaneRows('entry', [
      offer({}),
      offer({ id: 'o2', name: 'VR session', entryStyle: 'timed_session', fromMinor: 650000 }),
      offer({ id: 'g1', kind: 'group_package', name: 'Party' }),
    ], new Map([['o1', ready(false)], ['o2', ready(false)]]), NGN, money);
    expect(rows.map((r) => [r.name, r.price, r.actionLabel, r.soldOut, r.checking])).toEqual([
      ['Arcade day pass', 'from ₦4,000', 'Buy', false, false],
      ['VR session', 'from ₦6,500', 'Book', false, false],
    ]);
  });
  test('R-2 groups per guest and per booking; by the hour; hire ask or book', () => {
    expect(offerPaneRows('groups', [offer({ kind: 'group_package', fromMinor: 1200000 })], new Map(), NGN, money)[0])
      .toMatchObject({ price: 'from ₦12,000 a guest', actionLabel: 'Book', checking: true, offerKind: 'group_package' });
    expect(offerPaneRows('groups', [offer({ kind: 'group_package', unit: 'booking', fromMinor: 5000000 })], new Map(), NGN, money)[0]?.price)
      .toBe('from ₦50,000');
    expect(offerPaneRows('by_the_hour', [offer({ kind: 'by_the_hour', unit: 'hour', fromMinor: 500000 })], new Map(), NGN, money)[0])
      .toMatchObject({ price: 'from ₦5,000 an hour', actionLabel: 'Book' });
    expect(offerPaneRows('hire', [offer({ kind: 'private_hire', confirmationMode: 'request', fromMinor: 60000000 })], new Map(), NGN, money)[0])
      .toMatchObject({ price: 'from ₦600,000', actionLabel: 'Ask' });
    expect(offerPaneRows('hire', [offer({ kind: 'private_hire', confirmationMode: 'instant' })], new Map(), NGN, money)[0]?.actionLabel).toBe('Book');
  });
  test('R-3 plans: per month or year, Join, a full plan is sold out', () => {
    expect(planPaneRows([plan({}), plan({ id: 'p2', name: 'Yearly desk', period: 'year', priceMinor: 25000000, full: true })], NGN, money)
      .map((r) => [r.name, r.price, r.actionLabel, r.soldOut])).toEqual([
      ['Hot desk', '₦25,000 a month', 'Join', false],
      ['Yearly desk', '₦250,000 a year', 'Join', true],
    ]);
  });
  test('R-4 sold out only when no day is open and a day is full; closed days alone are not sold out', () => {
    const day = (status: string, i = 0) => ({ local_date: `2026-11-2${i}`, window_id: `w${i}`, status, remaining: 0 });
    expect(soldOutFromAvailability('entry', { days: [day('sold_out', 1), day('closed', 2)] })).toBe(true);
    expect(soldOutFromAvailability('entry', { days: [day('sold_out', 1), day('available', 2)] })).toBe(false);
    expect(soldOutFromAvailability('entry', { days: [day('closed', 1), day('too_far', 2)] })).toBe(false);
    expect(soldOutFromAvailability('by_the_hour', { days: [day('taken', 1)] })).toBe(true);
    expect(soldOutFromAvailability('private_hire', { days: [day('taken', 1), day('held', 2)] })).toBe(true);
    expect(soldOutFromAvailability('private_hire', { days: [day('taken', 1), day('available', 2)] })).toBe(false);
    expect(soldOutFromAvailability('entry', { days: [] })).toBe(false);
  });
  test('R-5 a sold-out row stays listed with its price', () => {
    const rows = offerPaneRows('entry', [offer({})], new Map([['o1', ready(true)]]), NGN, money);
    expect(rows[0]).toMatchObject({ soldOut: true, price: 'from ₦4,000' });
    expect(PANE_COPY.soldOut).toBe('Sold out');
  });
});

describe('#4490 W3 pane states', () => {
  const rows = offerPaneRows('entry', [offer({})], new Map(), NGN, money);
  test('S-1 empty: the §5 line', () => {
    expect(paneStatus([], [])).toBe('empty');
    expect(PANE_COPY.empty).toBe('Nothing to book here right now.');
  });
  test('S-2 loading, error, offline, ready', () => {
    expect(paneStatus(rows, [{ state: 'loading' }])).toBe('loading');
    expect(paneStatus(rows, [{ state: 'error', offline: false }, { state: 'loading' }])).toBe('error');
    expect(paneStatus(rows, [{ state: 'error', offline: true }, { state: 'error', offline: false }])).toBe('offline');
    expect(paneStatus(rows, [ready(false)])).toBe('ready');
    expect(PANE_COPY.error).toBe('Something went wrong. Try again.');
    expect(PANE_COPY.offline).toBe("You're offline. Check your connection and try again.");
  });
});

describe('#4490 W3 docked bar', () => {
  test('B-1 the cheapest open row with the tab verb; waits while checking', () => {
    const offers = [offer({ fromMinor: 500000 }), offer({ id: 'o2', name: 'Kids pass', fromMinor: 300000 })];
    const rows = offerPaneRows('entry', offers, new Map([['o1', ready(false)], ['o2', ready(true)]]), NGN, money);
    expect(paneBar('entry', rows, offers, 'Buy a day pass')).toEqual({
      title: 'Arcade day pass', subtitle: 'from ₦5,000', ctaLabel: 'Buy a day pass', enabled: true, rowId: 'o1',
    });
    const checking = offerPaneRows('entry', offers, new Map(), NGN, money);
    expect(paneBar('entry', checking, offers, 'Buy entry')?.enabled).toBe(false);
  });
  test('B-2 every row sold out: no bar (the rows say why)', () => {
    const rows = offerPaneRows('entry', [offer({})], new Map([['o1', ready(true)]]), NGN, money);
    expect(paneBar('entry', rows, [offer({})], 'Buy entry')).toBeNull();
  });
  // [TEST-MOD-APPROVED #4490] W3 fix 3 (W3-N22/N27): the bar's verb is the
  // tab verb the shared page hands in (deriveVenuePage tabVerbs), one owner;
  // by the hour says "Book" (was "Book a room"). The pane no longer keeps a list.
  test('B-3 the verbs are the tab verbs the page hands in', () => {
    const g = [offer({ kind: 'group_package' })];
    expect(paneBar('groups', offerPaneRows('groups', g, new Map([['o1', ready(false)]]), NGN, money), g, 'Book for a group')?.ctaLabel).toBe('Book for a group');
    const h = [offer({ kind: 'private_hire', confirmationMode: 'request' })];
    expect(paneBar('hire', offerPaneRows('hire', h, new Map([['o1', ready(false)]]), NGN, money), h, 'Ask about a date')?.ctaLabel).toBe('Ask about a date');
    const r = [offer({ kind: 'by_the_hour' })];
    expect(paneBar('by_the_hour', offerPaneRows('by_the_hour', r, new Map([['o1', ready(false)]]), NGN, money), r, 'Book')?.ctaLabel).toBe('Book');
    expect(paneBar('plans', planPaneRows([plan({})], NGN, money), [], 'Join')?.ctaLabel).toBe('Join');
  });
});

describe('#4490 W3 availability window', () => {
  test('W-1 the venue\'s own today, fourteen days', () => {
    // 23:30 UTC on the 19th is already the 20th in Lagos.
    expect(paneAvailabilityWindow(new Date('2026-11-19T23:30:00Z'), 'Africa/Lagos')).toEqual({ from: '2026-11-20', to: '2026-12-03' });
  });
});

// TEST-MOD-APPROVED #4490 (06-W4): the seam's [TRANSITIONAL] exit landed: it
// now opens the native checkout sheet (no web page, no browser).
describe('#4490 W4 seam', () => {
  test('X-1 a pane tap opens the native sheet on the tapped offer', () => {
    const opened: Array<{ kind: string; offerId: string | null; brandSlug: string }> = [];
    const venue = { venueId: 'v1', venueName: 'Gameland QA', currencyCode: 'NGN', exponent: 2, timezone: 'Africa/Lagos', lat: null, lng: null, category: null };
    openVenueOfferCheckout({ brandSlug: 'harmattan qa', venueSlug: 'gamelandqa', tab: 'by_the_hour', offerId: 'o1' }, venue, (o) =>
      opened.push({ kind: o.kind, offerId: o.offerId, brandSlug: o.brandSlug }),
    );
    expect(opened).toEqual([{ kind: 'by_the_hour', offerId: 'o1', brandSlug: 'harmattan qa' }]);
  });
  test('X-2 the seam is the only caller, no longer transitional, and never a browser', () => {
    const seam = read('../venueOfferCheckoutSeam.ts');
    expect(seam).not.toMatch(/\[TRANSITIONAL\]/);
    expect(seam).not.toMatch(/openBrowserAsync|Linking\.openURL/);
    const pane = read('../VenueOfferPane.tsx');
    expect(pane).toMatch(/openVenueOfferCheckout\(/);
    expect(pane).not.toMatch(/useOpenInMingla\(\)/);
    expect(pane).not.toMatch(/openBrowserAsync|Linking\.openURL/);
  });
});

describe('#4490 W3 venue_tapped_to_book', () => {
  test('A-1 the spec\'s exact property names', () => {
    expect(venueTappedToBookProps({
      venueId: 'v1', tab: 'entry', offerKind: 'entry', source: 'deck_card', positionInDeck: 3, isHostedVenue: true, mode: 'collab',
    })).toEqual({ venue_id: 'v1', tab: 'entry', offer_kind: 'entry', source: 'deck_card', position_in_deck: 3, is_hosted_venue: true, mode: 'collab' });
  });
});

describe('#4490 W3 card sheet blocks', () => {
  const features = (): PublicVenueFeaturesView => {
    const v = parsePublicVenueFeatures({
      features: ['entry', 'group_packages', 'menu', 'events_here', 'table_reservations'],
      spaces: [], currencyCode: 'NGN', minorUnitExponent: 2,
      offers: [
        { id: 'o1', kind: 'entry', name: 'Day pass', fromMinor: 400000, entryStyle: 'day_pass', unit: 'guest', summary: 'All day' },
        { id: 'g1', kind: 'group_package', name: 'Party', fromMinor: 1200000, unit: 'guest' },
      ],
      tables: { partyMax: 8 },
      events: { upcoming: [
        { id: 'e3', title: 'Third', startsAt: '2026-11-23T18:00:00Z', href: '/e/b/third' },
        { id: 'e1', title: 'First', startsAt: '2026-11-21T18:00:00Z', href: '/e/b/first' },
        { id: 'e2', title: 'Second', startsAt: '2026-11-22T11:30:00Z', href: '/exp/b/second' },
        { id: 'e4', title: 'Fourth', startsAt: '2026-11-24T18:00:00Z', href: '/e/b/fourth' },
      ] },
    });
    if (v === null) throw new Error('fixture');
    return v;
  };
  test('H-1 Ways to come: the page rows without Menu, lead first, ₦ prices', () => {
    const ways = venueSheetWays(features(), { tablesReservable: true, venueType: 'play' });
    expect(ways.map((w) => w.tab)).toEqual(['entry', 'groups', 'reservations']);
    expect(ways[0]).toEqual({ tab: 'entry', title: 'Entry', line: 'All day', price: 'from ₦4,000' });
    // A restaurant whose tables are reservable leads with tables.
    expect(venueSheetWays(features(), { tablesReservable: true, venueType: 'restaurant' })[0]?.tab).toBe('reservations');
  });
  test('H-2 What\'s on: the first three by start, day-first 24-hour in the venue zone', () => {
    expect(venueSheetEvents(features().events, 'Africa/Lagos')).toEqual([
      { id: 'e1', title: 'First', when: 'Sat 21 Nov · 19:00', href: '/e/b/first' },
      { id: 'e2', title: 'Second', when: 'Sun 22 Nov · 12:30', href: '/exp/b/second' },
      { id: 'e3', title: 'Third', when: 'Mon 23 Nov · 19:00', href: '/e/b/third' },
    ]);
    expect(venueSheetEvents(features().events, null)[0]?.when).toBeNull();
  });
  test('H-3 the venue page path carries the tab', () => {
    expect(venuePagePath('harmattan-qa-local', 'gamelandqa', 'whats_on')).toBe('/b/harmattan-qa-local/v/gamelandqa?tab=whats_on');
    expect(venuePagePath('b', 'v', null)).toBe('/b/b/v/v');
  });
});

describe('#4490 W3 wiring', () => {
  test('G-1 the venue route parses every tab with the shared parser and passes features and the five panes', () => {
    const route = read('../../../../app/b/[brandSlug]/v/[venueSlug].tsx');
    expect(route).toMatch(/initialTab=\{venueTabFromParam\(requestedTab\) \?\? "overview"\}/);
    expect(route).not.toMatch(/requestedTab === "menu"\s*\?\s*"menu"/);
    for (const prop of ['features={features}', 'onOpenEvent={handleOpenEvent}', 'entryBody={renderEntryBody}', 'groupsBody={renderGroupsBody}',
      'hireBody={renderHireBody}', 'hourBody={renderHourBody}', 'plansBody={renderPlansBody}']) {
      expect(route).toContain(prop);
    }
    // The page waits for its features, as buyer web does.
    expect(route).toMatch(/routeState === "cold-loading" \|\| featuresPending/);
    // Panes load lazily behind their own boundary (no module-scope import).
    expect(route).toMatch(/React\.lazy\(async \(\) => \{\s*\/\/ eslint-disable-next-line @typescript-eslint\/no-require-imports\s*const mod = require\("\.\.\/\.\.\/\.\.\/\.\.\/src\/components\/venueOffers\/VenueOfferPane"\)/);
    expect(route).not.toMatch(/^import .*VenueOfferPane"/m);
  });
  test('G-2 the five named panes exist and fix their kind', () => {
    for (const [file, kind] of [['EntryPane', 'entry'], ['GroupsPane', 'groups'], ['HirePane', 'hire'], ['HourPane', 'by_the_hour'], ['PlansPane', 'plans']]) {
      expect(read(`../${file}.tsx`)).toMatch(new RegExp(`kind="${kind}"`));
    }
  });
  test('G-3 the deck opens a claimed venue on its lead tab, fires venue_tapped_to_book, and shows the event chip only while browsing today', () => {
    const deck = read('../../SwipeableCards.tsx');
    expect(deck).toMatch(/leadTab === null \? '' : `\?tab=\$\{encodeURIComponent\(leadTab\)\}`/);
    expect(deck).toMatch(/source: 'deck_card'/);
    // [TEST-MOD-APPROVED #4490] W3 fix 1 (W3-N11): solo reads the user's own date
    // option; a shared deck reads the session's dates (pinned in the fix suite W-2).
    expect(deck).toMatch(/deckBrowsesToday\(userPreferences\?\.date_option\)/);
    expect(deck).toMatch(/currentVenueChips\?\.eventChip && deckShowsToday/);
    expect(deck).toMatch(/offerTileFor\(currentVenueChips\)/);
  });
  test('G-4 claimed venues read the deck facts RPC rows', () => {
    const venue = toClaimedVenue({ place_pool_id: 'p1', facts: {
      venueId: 'v1', venueSlug: 'gamelandqa', brandSlug: 'harmattan-qa-local', brandName: 'Harmattan QA', venueName: 'Gameland QA',
      venueType: 'play', timezone: 'Africa/Lagos', features: ['entry'], isBookable: true, tablesReservable: false,
      priceFrom: { entry: 400000 }, currencyCode: 'NGN', minorUnitExponent: 2, onTodayStartsAt: null, onTodayLive: true,
    } });
    expect(venue).toMatchObject({
      placePoolId: 'p1', venueSlug: 'gamelandqa', isBookable: true, venueType: 'play',
      priceFrom: { entry: 400000, group_packages: null }, currency: { code: 'NGN', exponent: 2 }, onToday: { startsAt: null, live: true },
    });
    expect(read('../../../hooks/useClaimedVenues.ts')).not.toMatch(/venue_public_view"\)/);
  });
  test('G-5 the card sheet: blocks after About, main button pushes the app path (no web browser)', () => {
    const modal = read('../../ExpandedCardModal.tsx');
    const about = modal.indexOf('<CardInfoSection description={card.description}');
    const blocks = modal.indexOf('<VenueSheetBlocks');
    expect(about > 0 && blocks > about).toBe(true);
    expect(modal).toMatch(/source: 'expanded_sheet'/);
    expect(modal).not.toMatch(/setBrowserUrl\(deckCta\.webUrl\)/);
    const blocksFile = read('../../expandedCard/VenueSheetBlocks.tsx');
    expect(blocksFile).toMatch(/CalendarPlanMessageButton/);
    expect(blocksFile).toMatch(/displayName: venueName/);
  });
  test('G-6 venue facts, features and availability are never persisted', () => {
    for (const key of [['claimedVenues', 'a'], ['venueFeaturesForPlace', 'p'], ['publicVenueFeatures', 'b', 'v'], ['venueOfferAvailability', 'o', 'f', 't']]) {
      expect(shouldDehydrateMinglaQuery({ queryKey: key, state: { status: 'success', fetchStatus: 'idle', data: {} } }, null)).toBe(false);
    }
  });
  test('G-7 every new string has an English line', () => {
    const en = JSON.parse(read('../../../i18n/locales/en/cards.json')) as Record<string, string>;
    expect([en['deck.on_tonight'], en['deck.on_today'], en['sheet.ways_to_come'], en['sheet.whats_on'], en['sheet.see_all']])
      .toEqual(['On tonight', 'On today', 'Ways to come', "What's on", 'See all']);
  });
});
