/**
 * #4490 Explorer W3 fix round 5 — the third device pass's ordering findings,
 * app side and the shared packages (packages/brand-rendering, shared with
 * buyer web).
 *
 *   D-1..D-5  the dock model (W3-N37): an empty basket docks nothing; one item
 *             docks "1 item · View order" with buyer web's words (spot
 *             included); an open review or a live order's status window docks
 *             nothing under it; ordering off docks nothing;
 *   D-6       the page shows a reported order bar only on the Menu tab and
 *             never under a reservation sheet (tab change takes it away);
 *   D-7       the shared screen docks it as the tab's live bar and the host's
 *             bar steps aside (one bar); the route hands the report through;
 *   K-1       a basket row's render key survives a note edit (W3-N40: the row
 *             was keyed by the line's identity, which includes the note, so
 *             each key remounted the note field);
 *   K-2       the order sheet lifts Pay clear of the keyboard's Done bar with
 *             the app's keyboard constants (W3-N38).
 *
 * FAILS-ON-REVERT: the count/view guards out of the dock model -> D-1/D-3;
 * the tab guard out of `venueMenuOrderBarOn` -> D-6; the menu bar not merged
 * into the live bar, or the host bar not yielding -> D-7; the render key back
 * to the identity key -> K-1; the spacer removed -> K-2.
 */
import fs from 'node:fs';
import path from 'node:path';

import { venueMenuOrderBarOn } from '@mingla/brand-rendering/venueFeaturePage';
import {
  venueOrderCartLineKey,
  venueOrderLineRenderKeys,
} from '@mingla/brand-rendering/venueOrdering/venueOrderingRules';
import { venueOrderingCartStateReducer } from '@mingla/brand-rendering/venueOrdering/useVenueOrderingCart';

import { consumerVenueOrderDock } from '../../venueOrdering/consumerVenueOrderDock';

const repo = path.resolve(__dirname, '../../../../..');
const read = (rel: string): string => fs.readFileSync(path.join(repo, rel), 'utf8');

const base = {
  canOrder: true,
  view: 'browse' as const,
  count: 0,
  totalCents: null,
  currency: null,
  spotLabel: null,
};

describe('#4490 W3 fix 5 — the Menu tab\'s docked order bar (W3-N37)', () => {
  test('D-1 an empty basket docks nothing', () => {
    expect(consumerVenueOrderDock(base)).toBeNull();
  });

  test('D-2 one item docks the order bar with buyer web\'s words', () => {
    expect(consumerVenueOrderDock({ ...base, count: 1 })).toEqual({
      title: '1 item',
      subtitle: 'Pay on your phone',
      ctaLabel: 'View order',
    });
    const priced = consumerVenueOrderDock({ ...base, count: 2, totalCents: 700000, currency: 'NGN' });
    expect(priced?.title.startsWith('2 items · ')).toBe(true);
    expect(priced?.title).toContain('7,000');
    expect(consumerVenueOrderDock({ ...base, count: 1, spotLabel: 'B1' })?.subtitle).toBe(
      'B1 · pay on your phone',
    );
  });

  test('D-3 an open review or a live order\'s status window docks nothing under it', () => {
    expect(consumerVenueOrderDock({ ...base, count: 1, view: 'review' })).toBeNull();
    expect(consumerVenueOrderDock({ ...base, count: 1, view: 'status' })).toBeNull();
    expect(consumerVenueOrderDock({ ...base, count: 0, view: 'status' })).toBeNull();
  });

  test('D-4 ordering off docks nothing, whatever the basket says', () => {
    expect(consumerVenueOrderDock({ ...base, canOrder: false, count: 3 })).toBeNull();
  });

  test('D-5 "Order more" after a live order docks again once something is added', () => {
    // orderMore sets the view back to browse with the basket emptied by the
    // round; the bar comes back with the first new item.
    expect(consumerVenueOrderDock({ ...base, view: 'browse', count: 0 })).toBeNull();
    expect(consumerVenueOrderDock({ ...base, view: 'browse', count: 1 })?.ctaLabel).toBe('View order');
  });

  test('D-6 the page docks a reported order bar only on the Menu tab, never under a reservation sheet', () => {
    const bar = { title: '1 item', ctaLabel: 'View order' };
    expect(venueMenuOrderBarOn('menu', bar, false)).toBe(bar);
    for (const tab of ['overview', 'entry', 'reservations', 'rooms', 'groups', 'hire', 'by_the_hour', 'plans', 'whats_on'] as const) {
      expect(venueMenuOrderBarOn(tab as never, bar, false)).toBeNull();
    }
    expect(venueMenuOrderBarOn('menu', bar, true)).toBeNull();
    expect(venueMenuOrderBarOn('menu', null, false)).toBeNull();
  });

  test('D-7 the shared screen docks it as the tab\'s live bar, the host bar steps aside, the route passes it', () => {
    const screen = read('packages/brand-rendering/PublicVenueScreen.tsx');
    expect(screen).toContain('onOrderBarChange: setMenuOrderBar,');
    expect(screen).toMatch(/const menuTabOrderBar = venueMenuOrderBarOn\(\s*normalizedReservationUiState\.activeTab,\s*menuOrderBar,\s*normalizedReservationUiState\.reservationSheetOpen,\s*\);/);
    expect(screen).toContain('const reservationTabBar = menuTabOrderBar ?? tabLiveBar;');
    expect(screen).toMatch(/actionBar === undefined \|\| menuTabOrderBar !== null\s*\? null/);
    const route = read('app-mobile/app/b/[brandSlug]/v/[venueSlug].tsx');
    expect(route).toContain('onOrderBarChange={context.onOrderBarChange}');
    // Buyer web docks its own bar and never reports one.
    const web = read('mingla-business/src/components/venueOrdering/BuyerVenueOrderingSlots.tsx');
    expect(web).not.toContain('onOrderBarChange');
  });
});

describe('#4490 W3 fix 5 — the order sheet\'s fields and keyboard (W3-N40, W3-N38)', () => {
  test('K-1 a basket row keeps its render key while its note is typed', () => {
    let state = venueOrderingCartStateReducer(
      {
        lines: [],
        view: 'browse',
        openItemId: null,
        tip: { bps: null, flatCents: null },
        tipTouched: false,
        partySize: null,
        buyer: { name: '', email: '', phone: '' },
      } as never,
      { type: 'CART', action: { type: 'ADD', line: { menuItemId: 'mocktail', itemName: 'Mocktail', modifierIds: [], modifierNames: [], notes: null } } } as never,
    );
    const before = venueOrderLineRenderKeys(state.lines);
    const identityBefore = state.lines[0].key;
    for (const note of ['N', 'No', 'No ice']) {
      state = venueOrderingCartStateReducer(state, { type: 'SET_NOTES', key: state.lines[0].key, notes: note } as never);
    }
    // The LINE's identity follows the note (two lines with different notes are
    // two lines) ...
    expect(state.lines[0].key).not.toBe(identityBefore);
    expect(state.lines[0].key).toBe(venueOrderCartLineKey({ menuItemId: 'mocktail', modifierIds: [], notes: 'No ice' }));
    // ... the ROW's render key does not.
    expect(venueOrderLineRenderKeys(state.lines)).toEqual(before);
    // Two lines of one item stay two distinct rows.
    const two = venueOrderLineRenderKeys([
      { menuItemId: 'mocktail', modifierIds: [] },
      { menuItemId: 'mocktail', modifierIds: [] },
      { menuItemId: 'juice', modifierIds: ['b', 'a'] },
    ]);
    expect(new Set(two).size).toBe(3);
    const pane = read('packages/brand-rendering/venueOrdering/VenueOrderReviewPane.tsx');
    expect(pane).toContain('key={rowKey}');
    expect(pane).not.toContain('key={line.key}');
  });

  test('K-2 the review lifts Pay clear of the keyboard\'s Done bar with the app\'s keyboard constants', () => {
    const app = read('app-mobile/src/components/venueOrdering/ConsumerVenueOrderingSlots.tsx');
    expect(app).toContain('{view === "review" ? <OrderSheetKeyboardSpacer /> : null}');
    expect(app).toContain('keyboardSpacer: { height: KEYBOARD_SCROLL_BOTTOM_OFFSET }');
  });
});
