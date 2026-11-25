/**
 * #4490 Explorer W3 fix round 3 — the first device pass's findings, app side
 * and the shared page model (packages/brand-rendering, shared with buyer web).
 *
 *   T-1..T-4  event and day times in the venue's zone WITHOUT Intl parts
 *             (W3-N21). Hermes on iOS types the hour and minute of
 *             "Sat 28 Nov at 19:00" as literals (proven in the react-native
 *             Hermes VM); the shims below replay that, and a harsher engine
 *             with no usable parts at all;
 *   M-1/M-2   Naira reads ₦ when the engine prints "NGN 4,000" (W3-N24):
 *             venue money, menu prices, the Stay bar and Stay totals;
 *   V-1..V-4  each tab's own action (W3-N22, W3-N27): the Tables tab's button
 *             and sheet say "Reserve a table" on a venue that leads with entry,
 *             the lead's bar is not drawn over Tables or Rooms, by the hour
 *             says "Book" (never "a room"), a Stay's day pass says
 *             "Buy a day pass";
 *   W-1       the Groups Ways row says "from" like every other row (W3-N28);
 *   S-1/S-2   a read with no answer is "offline" only when the phone is
 *             offline; online it is the server ("venue_unreachable"), the read
 *             gives up after 10 s and is not retried behind a spinner (W3-N25);
 *   K-1       each pane is keyed by its tab in the route, and the hand-off
 *             error sits under its own row (W3-N23, mounted in the render twin);
 *   L-1       a link opened while the card sheet is up closes the sheet (W3-N29).
 *
 * FAILS-ON-REVERT: venueEventWhen back on formatToParts -> T-1 ("Sat 28 Nov · :");
 * the tab verbs dropped (lead verb on the table body) -> V-1; the by-the-hour
 * verb back to "Book a room" -> V-3; the glyph rule out of formatVenueMoney ->
 * M-1; the groups "from" condition back -> W-1; the FunctionsFetchError always
 * "offline" -> S-1.
 */
import fs from 'node:fs';
import path from 'node:path';

import { onlineManager } from '@tanstack/react-query';
import { venueNightEnd } from '@mingla/brand-rendering/deckVenueChip';
import { formatMenuPrice } from '@mingla/brand-rendering/PublicMenuSections';
import { formatStayMoney, formatStayRate } from '@mingla/brand-rendering/stayGuestMoney';
import {
  deriveVenuePage,
  formatVenueMoney,
  venueEventWhen,
  venueLeadBarAllowedOn,
  venueLocalDay,
  venuePageVerbs,
  type PublicVenueFeaturesView,
  type VenueFeatureOfferView,
} from '@mingla/brand-rendering/venueFeaturePage';
import { venueWallClock } from '@mingla/brand-rendering/venueOpenState';

import { DECK_CTA_LABEL_KEYS } from '../../expandedCard/deckVenueCta';
import { venueSheetEvents } from '../../expandedCard/venueSheetModel';
import { closeSheetOnIncomingLink } from '../../deckCard/deckNavigation';
import { offerPaneRows, paneBar } from '../venuePaneModel';

const mockInvoke = jest.fn();
jest.mock('../../../services/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const service = require('../../../services/venuePurchaseService') as typeof import('../../../services/venuePurchaseService');

const ROOT = path.join(__dirname, '../../../../..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── Intl shims ───────────────────────────────────────────────────────────────
const RealDTF = Intl.DateTimeFormat;
const RealNF = Intl.NumberFormat;
type Opts = Intl.DateTimeFormatOptions | undefined;
const FIELDS = ['weekday', 'era', 'year', 'month', 'day', 'hour', 'minute', 'second'] as const;

/** What the react-native Hermes VM returned on Apple (recorded 22 Nov 2026). */
function hermesAppleDTF(locale?: string | string[], options?: Opts): Intl.DateTimeFormat {
  const real = new RealDTF(locale, options);
  const o = (options ?? {}) as Record<string, unknown>;
  const count = FIELDS.filter((k) => o[k] !== undefined).length;
  const dateAndTime = o.hour !== undefined && (o.weekday !== undefined || o.day !== undefined || o.month !== undefined);
  return {
    format: (d?: Date | number) => real.format(d),
    resolvedOptions: () => real.resolvedOptions(),
    formatToParts: (d?: Date | number) => {
      // en-US { weekday } alone came back as ONE literal part.
      if (count === 1) return [{ type: 'literal', value: real.format(d) }];
      // "EEE d MMM 'at' HH:mm": the hour and minute typed literal.
      if (dateAndTime) {
        return real.formatToParts(d).map((p) =>
          p.type === 'hour' || p.type === 'minute' || p.type === 'dayPeriod' ? { type: 'literal' as const, value: p.value } : p,
        );
      }
      return real.formatToParts(d);
    },
    formatRange: real.formatRange?.bind(real),
    formatRangeToParts: real.formatRangeToParts?.bind(real),
  } as unknown as Intl.DateTimeFormat;
}
/** Harsher still: formatToParts gives no typed part at all. */
function noPartsDTF(locale?: string | string[], options?: Opts): Intl.DateTimeFormat {
  const real = new RealDTF(locale, options);
  return {
    format: (d?: Date | number) => real.format(d),
    resolvedOptions: () => real.resolvedOptions(),
    formatToParts: (d?: Date | number) => [{ type: 'literal', value: real.format(d) }],
  } as unknown as Intl.DateTimeFormat;
}
function withDTF<T>(shim: typeof hermesAppleDTF, run: () => T): T {
  (Intl as { DateTimeFormat: unknown }).DateTimeFormat = shim;
  try {
    return run();
  } finally {
    (Intl as { DateTimeFormat: unknown }).DateTimeFormat = RealDTF;
  }
}
/** Hermes: no narrow naira symbol, the ISO code instead ("NGN 4,000"). */
function hermesNF(locale?: string | string[], options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const real = new RealNF(locale, options);
  return {
    format: (n: number) => real.format(n).replace(/₦\s?/g, 'NGN '),
    formatToParts: (n: number) => real.formatToParts(n),
    resolvedOptions: () => real.resolvedOptions(),
  } as unknown as Intl.NumberFormat;
}
function withNF<T>(run: () => T): T {
  (Intl as { NumberFormat: unknown }).NumberFormat = hermesNF;
  try {
    return run();
  } finally {
    (Intl as { NumberFormat: unknown }).NumberFormat = RealNF;
  }
}

const LAGOS = 'Africa/Lagos';
const SAT_19 = '2026-11-28T18:00:00Z';

describe('#4490 W3 fix 3 — times in the venue zone without Intl parts (W3-N21)', () => {
  test('T-1 Hermes on iOS: the What\'s on row says "Sat 28 Nov · 19:00", never "· :"', () => {
    withDTF(hermesAppleDTF, () => {
      expect(venueEventWhen(SAT_19, LAGOS)).toBe('Sat 28 Nov · 19:00');
      const rows = venueSheetEvents(
        [{ id: 'e1', kind: 'event', title: 'Lounge Takeover', startsAt: SAT_19, spaceName: null, fromMinor: null, href: '/e/b/x' }],
        LAGOS,
      );
      expect(rows[0]?.when).toBe('Sat 28 Nov · 19:00');
    });
  });

  test('T-2 an engine with no usable parts: event time, venue day and the night end still right', () => {
    withDTF(noPartsDTF, () => {
      expect(venueEventWhen(SAT_19, LAGOS)).toBe('Sat 28 Nov · 19:00');
      expect(venueLocalDay(new Date(SAT_19), LAGOS)).toEqual({ date: '2026-11-28', weekday: 5 });
      expect(venueNightEnd(new Date(SAT_19), LAGOS)?.toISOString()).toBe('2026-11-29T04:00:00.000Z');
    });
  });

  test('T-3 the wall clock: midnight is 00, summer time counts, unknown or offset zones claim nothing', () => {
    expect(venueEventWhen('2026-11-28T23:05:00Z', LAGOS)).toBe('Sun 29 Nov · 00:05');
    expect(venueEventWhen('2026-07-01T18:30:00Z', 'Europe/London')).toBe('Wed 1 Jul · 19:30');
    expect(venueWallClock(new Date('2026-11-28T23:05:00Z'), LAGOS)).toEqual({
      year: 2026, month: 11, day: 29, hour: 0, minute: 5, weekday: 6,
    });
    expect(venueEventWhen(SAT_19, null)).toBeNull();
    expect(venueEventWhen(SAT_19, '+01:00')).toBeNull();
    expect(venueEventWhen(SAT_19, 'Mars/Olympus_Mons')).toBeNull();
    expect(venueEventWhen('not a date', LAGOS)).toBeNull();
  });

  test('T-4 the W3 owners of a venue clock read no Intl parts', () => {
    for (const file of ['packages/brand-rendering/venueFeaturePage.ts', 'packages/brand-rendering/deckVenueChip.ts']) {
      const code = read(file).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(/formatToParts\s*\(/.test(code)).toBe(false);
    }
  });
});

describe('#4490 W3 fix 3 — Naira reads ₦ on every engine (W3-N24)', () => {
  test('M-1 venue money: "₦4,000", not "NGN 4,000"', () => {
    withNF(() => {
      expect(formatVenueMoney(400000, 'NGN', 2)).toBe('₦4,000');
      expect(formatVenueMoney(400050, 'NGN', 2)).toBe('₦4,000.50');
      expect(formatVenueMoney(2000, 'GBP', 2)).toBe('£20');
    });
  });
  test('M-2 the same page: menu price, the Stay bar and Stay totals', () => {
    withNF(() => {
      expect(formatMenuPrice(1000000, 'NGN')).toBe('₦10,000');
      expect(formatStayRate('1000000', 'NGN', 'en')).toBe('₦10,000');
      expect(formatStayMoney('1075000', 'NGN', 'en')).toBe('₦10,750.00');
    });
  });
});

// ── the Gameland-like venue: entry leads, tables beside it ───────────────────
const offer = (over: Partial<VenueFeatureOfferView>): VenueFeatureOfferView => ({
  id: 'o1', kind: 'entry', entryStyle: 'walk_in', name: 'Entry', summary: null,
  fromMinor: 400000, unit: 'guest', guestMin: null, guestMax: null, confirmationMode: 'instant', spaceIds: null, sortOrder: 0,
  ...over,
} as VenueFeatureOfferView);
const gameland: PublicVenueFeaturesView = {
  version: 1,
  features: ['entry', 'group_packages', 'by_the_hour', 'table_reservations'],
  currencyCode: 'NGN', minorUnitExponent: 2,
  offers: [
    offer({}),
    offer({ id: 'g1', kind: 'group_package', entryStyle: null, name: 'Squad', fromMinor: 1000000 }),
    offer({ id: 'h1', kind: 'by_the_hour', entryStyle: null, name: 'Pool table', fromMinor: 600000, unit: 'hour' }),
  ],
  tables: { partyMax: 8, pickATable: false, holdFromMinor: null, minSpendFromMinor: null, largePartyRequest: false, guestWaitlist: false },
  memberships: null, events: [], hours: { weekly: [], specialDays: [] }, spaces: [],
};
const ready = { menuTabVisible: false, tablesGate: 'ready' as const };

describe('#4490 W3 fix 3 — each tab says its own action (W3-N22, W3-N27)', () => {
  test('V-1 a venue that leads with entry: the Tables tab body and sheet say "Reserve a table"', () => {
    const page = deriveVenuePage(gameland, ready);
    expect(page.lead?.tab).toBe('entry');
    const verbs = venuePageVerbs(page, { reservationsKind: 'table', legacyReserveAction: 'Reserve a table' });
    expect(verbs).toEqual({ lead: 'Buy entry', rail: 'Reserve a table', table: 'Reserve a table', stay: 'Book' });
    expect(page.tabVerbs.reservations).toBe('Reserve a table');
    // The screen hands these to the table body, its sheet and the host bar.
    const screen = read('packages/brand-rendering/PublicVenueScreen.tsx');
    expect(screen).toMatch(/reserveAction: pageVerbs\.table,/);
    expect(screen).toMatch(/reserveAction: pageVerbs\.stay,/);
    expect(screen).toMatch(/title: railVerb,\s*children: reservationsSheetBlock/);
  });

  test('V-2 the lead\'s bar is not drawn over Tables or Rooms on a features page (today\'s page unchanged)', () => {
    const page = deriveVenuePage(gameland, ready);
    expect(venueLeadBarAllowedOn(page, 'reservations')).toBe(false);
    expect(venueLeadBarAllowedOn(page, 'rooms')).toBe(false);
    for (const tab of ['entry', 'groups', 'hire', 'by_the_hour', 'plans'] as const) {
      expect(venueLeadBarAllowedOn(page, tab)).toBe(false);
    }
    expect(venueLeadBarAllowedOn(page, 'overview')).toBe(true);
    expect(venueLeadBarAllowedOn(page, 'whats_on')).toBe(true);
    const legacy = deriveVenuePage(null, ready);
    expect(venueLeadBarAllowedOn(legacy, 'reservations')).toBe(true);
    expect(venuePageVerbs(legacy, { reservationsKind: 'stay', legacyReserveAction: 'Reserve this Stay' }).rail).toBe('Reserve this Stay');
  });

  test('V-3 by the hour says "Book" on the tab, the lead, the pane bar and the deck button; never "a room"', () => {
    const page = deriveVenuePage(gameland, ready);
    expect(page.tabVerbs.by_the_hour).toBe('Book');
    const hourOnly = deriveVenuePage({ ...gameland, features: ['by_the_hour'], offers: [gameland.offers[2]], tables: null }, ready);
    expect(hourOnly.lead).toMatchObject({ tab: 'by_the_hour', ctaLabel: 'Book' });
    const money = (minor: number): string => `₦${(minor / 100).toLocaleString('en-GB')}`;
    const rows = offerPaneRows('by_the_hour', [gameland.offers[2]], new Map(), { code: 'NGN', exponent: 2 }, money);
    expect(paneBar('by_the_hour', rows, [gameland.offers[2]], page.tabVerbs.by_the_hour ?? '')?.ctaLabel).toBe('Book');
    expect(DECK_CTA_LABEL_KEYS.Book).toBe('sheet.book');
    expect(Object.keys(DECK_CTA_LABEL_KEYS).some((k) => /room/i.test(k))).toBe(false);
    const en = JSON.parse(read('app-mobile/src/i18n/locales/en/cards.json')) as Record<string, string>;
    expect(en['sheet.book']).toBe('Book');
  });

  test('V-4 a Stay\'s day pass says "Buy a day pass" on its Entry tab though the Stay leads', () => {
    const stay: PublicVenueFeaturesView = {
      ...gameland,
      features: ['stays', 'entry'],
      offers: [offer({ entryStyle: 'day_pass', name: 'Pool day pass', fromMinor: 1500000 })],
      tables: null,
    };
    const page = deriveVenuePage(stay, ready);
    expect(page.lead?.kind).toBe('stays');
    expect(page.tabVerbs.entry).toBe('Buy a day pass');
    expect(read('packages/brand-rendering/PublicVenueScreen.tsx')).toMatch(/verb: page\.tabVerbs\.entry \?\? "Buy entry",/);
  });
});

describe('#4490 W3 fix 3 — the Groups row says "from" (W3-N28)', () => {
  test('W-1 one per-guest package: "from ₦10,000 a guest"', () => {
    const page = deriveVenuePage(gameland, ready);
    expect(page.ways.find((w) => w.tab === 'groups')?.price).toBe('from ₦10,000 a guest');
  });
});

describe('#4490 W3 fix 3 — offline is not a server failure (W3-N25)', () => {
  afterEach(() => onlineManager.setOnline(true));

  test('S-1 no answer while online is "venue_unreachable"; offline is "offline"', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError' } });
    onlineManager.setOnline(true);
    await expect(service.getVenueOfferAvailability({ offeringId: 'o1', from: '2026-11-22', to: '2026-12-05' }))
      .rejects.toMatchObject({ code: 'venue_unreachable' });
    onlineManager.setOnline(false);
    await expect(service.getVenueOfferAvailability({ offeringId: 'o1', from: '2026-11-22', to: '2026-12-05' }))
      .rejects.toMatchObject({ code: 'offline' });
    expect(service.venueNoAnswerCode(true)).toBe('venue_unreachable');
  });

  test('S-2 the availability read gives up after 10 s and a no-answer is not retried behind the spinner', async () => {
    mockInvoke.mockResolvedValue({ data: { kind: 'success', data: { days: [] } }, error: null });
    await service.getVenueOfferAvailability({ offeringId: 'o1', from: '2026-11-22', to: '2026-12-05' });
    expect(mockInvoke.mock.calls.at(-1)?.[1]).toMatchObject({ timeout: 10_000 });
    const hook = read('app-mobile/src/components/venueOffers/useVenueOfferAvailability.ts');
    expect(hook).toMatch(/error\.code === "venue_unreachable" \|\| error\.code === "offline"/);
  });
});

describe('#4490 W3 fix 3 — pane state per tab, sheet under a link (W3-N23, W3-N29)', () => {
  test('K-1 the route keys each pane by its tab', () => {
    expect(read('app-mobile/app/b/[brandSlug]/v/[venueSlug].tsx')).toMatch(/key=\{`venue-pane-\$\{kind\}`\}/);
  });

  test('L-1 an incoming link closes the open card sheet; unsubscribing stops it', () => {
    let handler: ((e: { url: string }) => void) | null = null;
    let removed = 0;
    const source = {
      addEventListener: (_type: 'url', h: (e: { url: string }) => void) => {
        handler = h;
        return { remove: () => { removed += 1; } };
      },
    };
    let closed = 0;
    const stop = closeSheetOnIncomingLink(source, () => { closed += 1; });
    (handler as unknown as (e: { url: string }) => void)({ url: 'com.mingla.app.v2://b/harmattan-qa-local/v/studionine?tab=entry' });
    expect(closed).toBe(1);
    (handler as unknown as (e: { url: string }) => void)({ url: '' });
    expect(closed).toBe(1);
    stop();
    expect(removed).toBe(1);
    expect(read('app-mobile/src/components/ExpandedCardModal.tsx')).toMatch(/closeSheetOnIncomingLink\(Linking, onClose\)/);
  });
});
