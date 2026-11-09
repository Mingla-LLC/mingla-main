/**
 * #4347 wave 4 — the Explorer layer on a host venue page: the pure model
 * (implementor happy path).
 *
 *   C-1 every brand theme gets a "When you'd go" block whose every colour pair
 *       clears its floor (text 4.5:1, bars and the active chip 3:1), themed or
 *       on the neutral fallback — swept over a grid of brand colours;
 *   C-2 a palette that cannot be read falls back to the neutral paper tokens;
 *   C-3 the sweep is not vacuous: nearly every theme stays in the host's
 *       colours (a dark accent on a dark page inverts the chosen chip);
 *   H-1 the host's published hours become weekday lines the opening-hours
 *       parser reads (closed days, overnight, unreadable rows dropped);
 *   R-1 Reserve needs ALL three `useVenueReservable` conditions AND the page's
 *       own gate; otherwise Directions. A Stay books through the page's gate;
 *   K-1 the crowd curve: the deck card's category first, else the venue's;
 *   D-1 the deck hand-off is read only for its own place, and clears;
 *   W-1 (wiring) the deck records the hand-off — the exact card, its own
 *       right-swipe save — BEFORE it leaves for the venue page, and sign-out
 *       clears it. SwipeableCards cannot be mounted in this lane, so this one
 *       reads the source; the route side is mounted in mingla-business's
 *       issue_4347_venue_explorer_slots.implementor.happy.test.tsx.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 *
 * FAILS-ON-REVERT: drop the `whenColorsPass` check in `whenColorsFor` (C-2),
 * or one of the three reservable conditions in `venuePrimaryAction` (R-1), or
 * the placePoolId match in `getDeckVenueHandoff` (D-1) — each fails here.
 */
import { resolveTheme } from '@mingla/offering-rendering/themeResolver';
import { contrastRatio, createThemePalette, type ThemePalette } from '@mingla/offering-rendering/themePalette';

import {
  NEUTRAL_WHEN_COLORS,
  brandHoursToWeekdayText,
  crowdCategoryFor,
  flatten,
  venuePrimaryAction,
  whenColorPairs,
  whenColorsFor,
  whenColorsPass,
} from '../venueExplorerModel';
import { clearDeckVenueHandoff, getDeckVenueHandoff, setDeckVenueHandoff } from '../deckVenueHandoff';
import { isPlaceOpenAt } from '../../../utils/openingHoursUtils';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as typeof import('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path') as typeof import('path');
const read = (rel: string): string => fs.readFileSync(path.join(__dirname, rel), 'utf8');

const hex = (n: number) => n.toString(16).padStart(2, '0');
const GRID: string[] = [];
for (const r of [0, 51, 102, 153, 204, 255]) {
  for (const g of [0, 51, 102, 153, 204, 255]) {
    for (const b of [0, 51, 102, 153, 204, 255]) GRID.push(`#${hex(r)}${hex(g)}${hex(b)}`);
  }
}
// Real brand colours seen on the platform, plus the Mingla default.
GRID.push('#eb7825', '#0b1f3a', '#1e3a8a', '#7c3aed', '#f5d0fe', '#fde047', '#14b8a6', '#111827');

const paletteFor = (color: string): ThemePalette =>
  createThemePalette(resolveTheme({ color, font: 'inter', animation: null } as never, null));

describe('#4347 wave 4 — venue Explorer model', () => {
  test('C-1 every theme: every drawn pair clears its floor', () => {
    expect(GRID.length).toBeGreaterThan(200);
    const failures: string[] = [];
    for (const color of GRID) {
      const { colors } = whenColorsFor(paletteFor(color));
      for (const pair of whenColorPairs(colors)) {
        const ratio = contrastRatio(pair.fg, pair.bg);
        if (ratio < pair.min) failures.push(`${color} ${pair.name} ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('C-2 an unreadable palette falls back to the neutral paper tokens', () => {
    const grey: ThemePalette = {
      ...paletteFor('#eb7825'),
      page: '#777777',
      card: 'rgba(255,255,255,0.10)',
      primaryText: '#ffffff',
      secondaryText: 'rgba(255,255,255,0.78)',
      tertiaryText: 'rgba(255,255,255,0.58)',
    };
    const result = whenColorsFor(grey);
    expect(result.themed).toBe(false);
    expect(result.colors).toBe(NEUTRAL_WHEN_COLORS);
    // The fallback itself is measured, not assumed.
    expect(whenColorsPass(NEUTRAL_WHEN_COLORS)).toBe(true);
    expect(whenColorsFor(null).themed).toBe(false);
  });

  test('C-3 the sweep is not vacuous: nearly every theme stays in the host colours', () => {
    const themed = GRID.filter((c) => whenColorsFor(paletteFor(c)).themed).length;
    expect(themed / GRID.length).toBeGreaterThan(0.9);
    // A dark brand page keeps a dark block, in the host's colours.
    const dark = whenColorsFor(paletteFor('#eb7825'));
    expect(dark.themed).toBe(true);
    expect(dark.colors.surface).not.toBe(NEUTRAL_WHEN_COLORS.surface);
  });

  test('flatten paints translucent colours over the page', () => {
    expect(flatten('rgba(255,255,255,0.5)', '#000000')).toBe('#808080');
    expect(flatten('#123456', '#ffffff')).toBe('#123456');
    expect(flatten('not-a-colour', '#ffffff')).toBeNull();
  });

  test('H-1 host hours become weekday lines the parser reads', () => {
    const lines = brandHoursToWeekdayText([
      { weekday: 0, openTime: '09:00', closeTime: '17:00', isClosed: false },
      { weekday: 4, openTime: '18:00:00', closeTime: '02:00:00', isClosed: false },
      { weekday: 5, openTime: '12:00', closeTime: '23:00', isClosed: false },
      { weekday: 6, openTime: null, closeTime: null, isClosed: true },
      { weekday: 2, openTime: null, closeTime: null, isClosed: false },
      { weekday: 9, openTime: '09:00', closeTime: '10:00', isClosed: false },
    ]);
    expect(lines).toEqual([
      'Monday: 9:00 AM – 5:00 PM',
      'Friday: 6:00 PM – 2:00 AM',
      'Saturday: 12:00 PM – 11:00 PM',
      'Sunday: Closed',
    ]);
    // Friday 23:30 UTC (offset 0) is open; Saturday 01:00 is still Friday night.
    expect(isPlaceOpenAt(lines, new Date('2026-11-13T23:30:00Z'), 0)).toBe(true);
    expect(isPlaceOpenAt(lines, new Date('2026-11-14T01:00:00Z'), 0)).toBe(true);
    expect(isPlaceOpenAt(lines, new Date('2026-11-15T12:00:00Z'), 0)).toBe(false);
    expect(brandHoursToWeekdayText([])).toBeNull();
    expect(brandHoursToWeekdayText(null)).toBeNull();
  });

  test('R-1 Reserve needs all three reservable conditions and the page gate', () => {
    const ok = { reservable: true, brand_id: 'b', venue_id: 'v' };
    expect(venuePrimaryAction({ bookingKind: 'table', canReserve: true, reservable: ok })).toBe('reserve');
    expect(venuePrimaryAction({ bookingKind: 'table', canReserve: true, reservable: { ...ok, reservable: false } })).toBe('directions');
    expect(venuePrimaryAction({ bookingKind: 'table', canReserve: true, reservable: { ...ok, brand_id: null } })).toBe('directions');
    expect(venuePrimaryAction({ bookingKind: 'table', canReserve: true, reservable: { ...ok, venue_id: null } })).toBe('directions');
    expect(venuePrimaryAction({ bookingKind: 'table', canReserve: false, reservable: ok })).toBe('directions');
    expect(venuePrimaryAction({ bookingKind: 'table', canReserve: true, reservable: undefined })).toBe('directions');
    expect(venuePrimaryAction({ bookingKind: 'stay', canReserve: true, reservable: null })).toBe('reserve');
    expect(venuePrimaryAction({ bookingKind: 'stay', canReserve: false, reservable: ok })).toBe('directions');
  });

  test('K-1 the crowd curve: deck category first, then the venue category', () => {
    expect(crowdCategoryFor('drink', 'restaurant')).toBe('drink');
    expect(crowdCategoryFor(null, 'restaurant')).toBe('casual_eats');
    expect(crowdCategoryFor('', 'creative_and_arts')).toBe('creative_arts');
    expect(crowdCategoryFor(undefined, 'stay')).toBeNull();
  });

  test('D-1 the deck hand-off is read only for its own place, and clears', () => {
    const entry = {
      placePoolId: 'p-1',
      card: { id: 'p-1', title: 'Ìtàn Garden' } as never,
      currentMode: 'solo',
      isSaved: false,
      save: async () => undefined,
      canAccessCurated: true,
    };
    setDeckVenueHandoff(entry);
    expect(getDeckVenueHandoff('p-1')).toBe(entry);
    expect(getDeckVenueHandoff('p-2')).toBeNull();
    expect(getDeckVenueHandoff(null)).toBeNull();
    clearDeckVenueHandoff();
    expect(getDeckVenueHandoff('p-1')).toBeNull();
  });

  test('W-1 the deck hands the venue page its card and save path before it leaves', () => {
    const deck = read('../../SwipeableCards.tsx');
    const fn = deck.slice(deck.indexOf('const handleCardExpand = async () => {'), deck.indexOf('const handleCloseExpandedModal'));
    const handoffAt = fn.indexOf('setDeckVenueHandoff({');
    const leaveAt = fn.indexOf('leaveDeckTo(');
    expect(handoffAt).toBeGreaterThan(0);
    expect(leaveAt).toBeGreaterThan(handoffAt);
    const block = fn.slice(handoffAt, leaveAt);
    expect(block).toMatch(/placePoolId: currentClaimedVenue\.placePoolId/);
    expect(block).toMatch(/card: recommendationToExpanded\(venueRec\)/);
    expect(block).toMatch(/await handleSwipe\("right", venueRec\)/);
    expect(read('../../../utils/authCleanup.ts')).toMatch(/clearDeckVenueHandoff\(\);/);
  });
});
