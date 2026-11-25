/**
 * #4490 Explorer W3 fix round 4 — the second device pass's findings, app side
 * and the shared packages (packages/brand-rendering, shared with buyer web).
 *
 *   B-1..B-4  the Menu tab's order (W3-N36): an empty basket never opens the
 *             review (the shared reducer and the sheet's one visibility rule);
 *             ordering owns the Menu tab's bottom edge while the guest can
 *             order or an order is open (app and buyer web report it); the
 *             venue's docked bar is never drawn while a sheet is open; the
 *             order sheet is its own native window (mounted twin: O-1..O-4);
 *   R-1/R-2   one table verb per venue on the deck tile, the Tables button
 *             and the sheet it opens (W3-N32);
 *   P-1/P-2   typical spend and place-card price lines read ₦ with no stray
 *             "· NGN" on an engine that prints the code (Hermes), other
 *             currencies byte-identical; the host's claim step unchanged (W3-N31);
 *   L-1/L-2   a link that opens a page closes the shared deck's modal; one the
 *             shell handles does not (W3-N33);
 *   T-1       a venue read that never answers fails at 10 s, not at the app
 *             fetch wrapper's 20 s cap, and is not retried (W3-N35);
 *   H-1/H-2   the phone header is solid by the end of a short page; the pinned
 *             tab strip is opaque and has a page-colour backing
 *             (W3-N34).
 *
 * FAILS-ON-REVERT: the reducer's empty-basket guard removed -> B-1; the bar
 * handshake dropped from either surface -> B-2; the sheet-open condition out of
 * `showReserveCta` -> B-3; the sheet's title back to a fixed "Reserve a table"
 * or the chip back to a fixed "Book a table" -> R-1/R-2; `display: "venue"`
 * ignored -> P-1; the glyph out of priceTiers -> P-2; no link filter / no
 * listener in CollabDeckSheet -> L-1/L-2; the race out of the venue read ->
 * T-1; the threshold back to the cover-only point -> H-1; pinned back to 0.96
 * -> H-2.
 */
import fs from 'node:fs';
import path from 'node:path';

import { deckVenueOfferChip, parseDeckVenueFacts } from '@mingla/brand-rendering/deckVenueChip';
import { deriveVenuePage, type PublicVenueFeaturesView } from '@mingla/brand-rendering/venueFeaturePage';
import {
  venueOrderingOwnsBottomEdge,
  venueOrderingSheetView,
} from '@mingla/brand-rendering/venueOrdering/venueOrderingRules';
import { venueOrderingCartStateReducer } from '@mingla/brand-rendering/venueOrdering/useVenueOrderingCart';
import { formatSourceRange } from '@mingla/brand-rendering/venueMoney';
import { glassTabFillAlpha } from '@mingla/brand-rendering/GlassTabs';
import { premiumSolidThreshold } from '@mingla/offering-rendering/ParallaxCoverShell';

import { closeSheetOnIncomingLink, incomingLinkOpensPage } from '../../deckCard/deckNavigation';
import { canonicalDiscoveryPriceLabel } from '../../../utils/priceTiers';

const mockInvoke = jest.fn();
jest.mock('../../../services/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const service = require('../../../services/venuePurchaseService') as typeof import('../../../services/venuePurchaseService');

const RealNF = Intl.NumberFormat;
/** Hermes: no naira symbol, the ISO code instead ("NGN 20,000.00"). */
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

const repo = path.resolve(__dirname, '../../../../..');
const read = (rel: string): string => fs.readFileSync(path.join(repo, rel), 'utf8');

const emptyState = {
  lines: [],
  view: 'browse' as const,
  openItemId: null,
  tip: { bps: null, flatCents: null },
  tipTouched: false,
  partySize: null,
  buyer: { name: '', email: '', phone: '' },
};

describe('#4490 W3 fix 4 — the Menu tab order (W3-N36)', () => {
  test('B-1 an empty basket never opens the review; one with an item does', () => {
    const tried = venueOrderingCartStateReducer(emptyState as never, { type: 'VIEW', view: 'review' });
    expect(tried.view).toBe('browse');
    expect(venueOrderingSheetView({ view: 'review', lineCount: 0 })).toBeNull();
    expect(venueOrderingSheetView({ view: 'browse', lineCount: 3 })).toBeNull();
    expect(venueOrderingSheetView({ view: 'review', lineCount: 1 })).toBe('review');
    expect(venueOrderingSheetView({ view: 'status', lineCount: 0 })).toBe('status');
    const withLine = venueOrderingCartStateReducer(emptyState as never, {
      type: 'CART',
      action: { type: 'ADD', line: { menuItemId: 'm1', itemName: 'Jollof', modifierIds: [], modifierNames: [], notes: null } },
    } as never);
    expect(venueOrderingCartStateReducer(withLine, { type: 'VIEW', view: 'review' }).view).toBe('review');
    // Leaving is always allowed.
    expect(venueOrderingCartStateReducer({ ...withLine, view: 'review' }, { type: 'VIEW', view: 'browse' }).view).toBe('browse');
  });

  test('B-2 ordering owns the Menu tab\'s bottom edge while the guest can order or an order is open', () => {
    expect(venueOrderingOwnsBottomEdge({ canOrder: true, sheetView: null })).toBe(true);
    expect(venueOrderingOwnsBottomEdge({ canOrder: false, sheetView: 'status' })).toBe(true);
    expect(venueOrderingOwnsBottomEdge({ canOrder: false, sheetView: null })).toBe(false);
    // The app's surface and the route both carry the handshake; buyer web keeps
    // it while its review pane is open (no lead bar over an open order).
    const app = read('app-mobile/src/components/venueOrdering/ConsumerVenueOrderingSlots.tsx');
    expect(app).toMatch(/onBottomBarChange\(ownsBottomEdge\)/);
    expect(app).toMatch(/wrapInRNModal\n/);
    const route = read('app-mobile/app/b/[brandSlug]/v/[venueSlug].tsx');
    expect(route).toContain('onBottomBarChange={context.onBottomBarChange}');
    const web = read('mingla-business/src/components/venueOrdering/BuyerVenueOrderingSlots.tsx');
    expect(web).toMatch(/onBottomBarChange\(owned\)/);
    expect(web).toMatch(/venueOrderingOwnsBottomEdge\(\{\s*canOrder,/);
  });

  test('B-3 the venue\'s docked bar is not drawn while a sheet is open; the Menu edge rule is unchanged', () => {
    const screen = read('packages/brand-rendering/PublicVenueScreen.tsx');
    expect(screen).toMatch(
      /const showReserveCta =\s*leadActionable &&\s*leadTab !== null &&\s*normalizedReservationUiState\.activeTab !== leadTab &&\s*!normalizedReservationUiState\.reservationSheetOpen;/,
    );
    expect(screen).toContain('!(orderingOwnsBar && normalizedReservationUiState.activeTab === "menu")');
  });
});

const tablesView = (features: string[]): PublicVenueFeaturesView => ({
  version: 1,
  features: features as never,
  currencyCode: 'NGN',
  minorUnitExponent: 2,
  offers: [],
  tables: { holdFromMinor: null, minSpendFromMinor: null, partyMax: 8 } as never,
  memberships: null,
  events: [],
  hours: { weekly: [], specialDays: [] },
  spaces: [],
} as never);

describe('#4490 W3 fix 4 — one table verb per venue (W3-N32)', () => {
  test('R-1 the deck tile, the Tables button and the Ways row say the same verb', () => {
    for (const [features, verb] of [
      [['table_reservations'], 'Reserve a table'],
      [['table_reservations', 'min_spend_tables'], 'Book a table'],
    ] as const) {
      const page = deriveVenuePage(tablesView([...features]), { menuTabVisible: false, tablesGate: 'ready' });
      expect(page.lead?.ctaLabel).toBe(verb);
      expect(page.tabVerbs.reservations).toBe(verb);
      const facts = parseDeckVenueFacts({
        venueId: 'v', brandSlug: 'b', brandName: 'B', venueSlug: 's', venueType: 'restaurant',
        features, isBookable: true, tablesReservable: true, currencyCode: 'NGN', minorUnitExponent: 2,
        priceFrom: { entry: null, group_packages: null, private_hire: null, by_the_hour: null, memberships: null },
      });
      expect(facts).not.toBeNull();
      const chip = deckVenueOfferChip(facts as never);
      expect(chip?.label).toBe(verb);
      expect(chip?.tileValue).toBe(verb);
    }
  });

  test('R-2 the reservation sheet is headed by the button that opened it (venue page and deck sheet)', () => {
    const sheet = read('app-mobile/src/components/expandedCard/VenueReserveSheet.tsx');
    expect(sheet).toMatch(/title = "Reserve a table",/);
    expect(sheet).toMatch(/accessibilityLabel=\{title\}/);
    expect(sheet).toMatch(/>\s*\{title\}\s*<\/Text>/);
    expect(sheet).not.toMatch(/>\s*Reserve a table\s*<\/Text>/);
    const route = read('app-mobile/app/b/[brandSlug]/v/[venueSlug].tsx');
    expect(route).toContain('title={context.title}');
    const modal = read('app-mobile/src/components/ExpandedCardModal.tsx');
    expect(modal).toContain('title={t(`cards:${deckCta.labelKey}`, { defaultValue: deckCta.fallbackLabel })}');
  });
});

describe('#4490 W3 fix 4 — typical spend and place prices read ₦ (W3-N31)', () => {
  const amber = { minMinor: 2000000, maxMinor: 15000000, currencyCode: 'NGN', exponent: 2 };
  test('P-1 the venue page\'s typical spend: ₦, whole amounts, no stray code; other currencies unchanged', () => {
    withNF(() => {
      expect(formatSourceRange({ ...amber, display: 'venue' })).toBe('₦20,000–₦150,000');
      expect(formatSourceRange({ ...amber, maxMinor: null, display: 'venue' })).toBe('₦20,000+');
      expect(formatSourceRange({ ...amber, minMinor: 2000050, display: 'venue' })).toBe('₦20,000.50–₦150,000');
      // Other currencies: exactly the original text.
      const gbp = { minMinor: 2500, maxMinor: 6000, currencyCode: 'GBP', exponent: 2, locale: 'en-GB' };
      expect(formatSourceRange({ ...gbp, display: 'venue' })).toBe(formatSourceRange(gbp));
      expect(formatSourceRange({ ...gbp, display: 'venue' })).toBe('£25.00–£60.00 · GBP');
      // The host's claim step (no display) is unchanged.
      expect(formatSourceRange(amber)).toMatch(/· NGN$/);
    });
    for (const rel of ['packages/brand-rendering/venueFirstScreen.ts', 'packages/brand-rendering/PublicVenueScreen.tsx']) {
      expect(read(rel)).toMatch(/exponent: discoveryPrice\.minorUnitExponent,\s*\/\/[^\n]*\n\s*display: "venue",/);
    }
  });

  test('P-2 a place card / card sheet price line reads ₦ for Naira and nothing else changes', () => {
    const price = {
      priceRangeStatus: 'active' as const, sourceMinMinor: 2000000, sourceMaxMinor: 15000000, sourceCurrencyCode: 'NGN',
      sourceMinorUnitExponent: 2, displayMinMinor: null, displayMaxMinor: null, displayCurrencyCode: null,
      displayMinorUnitExponent: null, priceIsApproximate: false, fxSnapshotId: null, fxProvider: null,
      fxProviderUpdatedAt: null, fxFreshness: 'not_needed' as const,
    };
    withNF(() => {
      const label = canonicalDiscoveryPriceLabel(price as never) ?? '';
      expect(label).toContain('₦20,000.00');
      expect(label).not.toContain('NGN');
      const usd = canonicalDiscoveryPriceLabel({ ...price, sourceCurrencyCode: 'USD' } as never) ?? '';
      expect(usd).toContain('$');
    });
  });
});

describe('#4490 W3 fix 4 — a link over the shared deck (W3-N33)', () => {
  test('L-1 links that open a page close the modal; links the shell handles do not', () => {
    for (const url of [
      'com.mingla.app.v2://b/harmattan-qa-local/v/gamelandqa?tab=reservations',
      'https://usemingla.com/e/acme/party',
      'https://usemingla.com/purchases/venue/abc',
      'com.mingla.app.v2://exp/acme/tour',
    ]) {
      expect(incomingLinkOpensPage(url)).toBe(true);
    }
    for (const url of ['https://usemingla.com/invite/ABC', 'https://usemingla.com/chat/1', 'https://evil.example/b/x/v/y', 'com.mingla.app.v2://']) {
      expect(incomingLinkOpensPage(url)).toBe(false);
    }
    let handler: ((e: { url: string }) => void) | null = null;
    const source = { addEventListener: (_t: 'url', h: (e: { url: string }) => void) => { handler = h; return { remove: () => { handler = null; } }; } };
    const close = jest.fn();
    const stop = closeSheetOnIncomingLink(source, close, incomingLinkOpensPage);
    handler!({ url: 'https://usemingla.com/invite/ABC' });
    expect(close).not.toHaveBeenCalled();
    handler!({ url: 'com.mingla.app.v2://b/harmattan-qa-local/v/gamelandqa' });
    expect(close).toHaveBeenCalledTimes(1);
    stop();
    expect(handler).toBeNull();
  });

  test('L-2 the shared deck listens while it is visible and closes through its own close', () => {
    const sheet = read('app-mobile/src/components/connections/CollabDeckSheet.tsx');
    expect(sheet).toMatch(/if \(!visible\) return undefined;\s*return closeSheetOnIncomingLink\(\s*Linking,/);
    expect(sheet).toMatch(/incomingLinkOpensPage,\s*\);\s*\}, \[visible, onClose\]\);/);
  });
});

describe('#4490 W3 fix 4 — the venue pane error inside 10 s (W3-N35)', () => {
  beforeEach(() => mockInvoke.mockReset());
  test('T-1 a read with no answer fails at 10 s as "venue_unreachable", once', async () => {
    jest.useFakeTimers();
    try {
      // The app's fetch wrapper drops functions-js's abort signal: the invoke
      // itself would only settle at the wrapper's 20 s cap.
      mockInvoke.mockImplementation(() => new Promise(() => undefined));
      const read = service.getVenueOfferAvailability({ offeringId: 'o1', from: '2026-11-22', to: '2026-12-05' });
      const settled = jest.fn();
      read.then(() => settled('ok'), (e: { code?: string }) => settled(e.code));
      await jest.advanceTimersByTimeAsync(9_900);
      expect(settled).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(200);
      expect(settled).toHaveBeenCalledWith('venue_unreachable');
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(service.VENUE_READ_TIMEOUT_MS).toBe(10_000);
    } finally {
      jest.useRealTimers();
    }
    // The availability query never retries a no-answer behind the spinner.
    const hook = read('app-mobile/src/components/venueOffers/useVenueOfferAvailability.ts');
    expect(hook).toMatch(/error\.code === "venue_unreachable" \|\| error\.code === "offline"/);
  });
});

describe('#4490 W3 fix 4 — header and pinned strip are solid at 375 (W3-N34)', () => {
  test('H-1 the phone header is solid by the end of a page too short to reach the usual point', () => {
    expect(premiumSolidThreshold({ base: 300, maxScroll: 180 })).toBe(178);
    expect(premiumSolidThreshold({ base: 300, maxScroll: 900 })).toBe(300);
    expect(premiumSolidThreshold({ base: 300, maxScroll: 0 })).toBe(300);
    expect(premiumSolidThreshold({ base: 300, maxScroll: null })).toBe(300);
    const shell = read('packages/offering-rendering/ParallaxCoverShell.tsx');
    expect(shell.match(/onLayout=\{onPremiumScrollLayout\}\s*onContentSizeChange=\{onPremiumContentSize\}/g)?.length).toBe(2);
  });

  test('H-2 the pinned strip is opaque (iOS and Android) and sits on a page-colour backing', () => {
    expect(glassTabFillAlpha({ platform: 'ios', pinned: true })).toBe(1);
    expect(glassTabFillAlpha({ platform: 'android', pinned: true })).toBe(1);
    expect(glassTabFillAlpha({ platform: 'android', pinned: false })).toBe(1);
    expect(glassTabFillAlpha({ platform: 'ios', pinned: false })).toBe(0.82);
    const screen = read('packages/brand-rendering/PublicVenueScreen.tsx');
    expect(screen).toMatch(/top: pinnedTabsBackingTop,\s*paddingTop: pinnedTabsTop - pinnedTabsBackingTop,\s*backgroundColor: palette\.page,/);
    expect(screen).toMatch(/pinnedTabs: \{\s*position: "absolute",\s*left: 0,\s*right: 0,/);
  });
});
