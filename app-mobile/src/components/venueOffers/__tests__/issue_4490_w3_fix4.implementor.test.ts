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
 *             and the sheet it opens (W3-N32).
 *
 * FAILS-ON-REVERT: the reducer's empty-basket guard removed -> B-1; the bar
 * handshake dropped from either surface -> B-2; the sheet-open condition out of
 * `showReserveCta` -> B-3; the sheet's title back to a fixed "Reserve a table"
 * or the chip back to a fixed "Book a table" -> R-1/R-2.
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
