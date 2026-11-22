/**
 * #4490 Explorer W3 fix round 1 — app side.
 *
 *   H-1..H-3  the card sheet's venue routes close the sheet, then leave the
 *             deck through the deck host's hand-off (collab: the shared deck's
 *             modal closes before the push); solo pushes directly (W3-N2);
 *   S-1..S-4  the Buy hand-off opens the buyer web of THIS build's backend:
 *             the hosted project's web, never production from a local or
 *             unknown backend; the pane says so instead of a dead tap (W3-N12);
 *   F-1       a free entry row reads "Free entry", never "from ₦0" (W3-N6);
 *   T-1..T-4  "Sold out today" / "Closed today" while a later day is open
 *             (the design's row tag), the row stays bookable;
 *   W-1..W-3  deck wiring: the plate tile reads the chip's tile value
 *             (W3-N13), the event chip reads the session's dates in collab
 *             (W3-N11), the sheet gets the deck host's hand-off (W3-N2).
 *
 * TEST-MOD-APPROVED #4490 (W3 fix 2, W3-N15): the hand-off takes the build's
 * backend as an injected dependency (`{ backendUrl }`) instead of a ready-made
 * origin, so S-3 passes backends and S-4 pins the default dependency; same
 * assertions otherwise.
 *
 * FAILS-ON-REVERT: deleting the closeSheet call in leaveSheetTo fails H-1;
 * deleting the origin check in buyerWebOriginFor fails S-2; deleting the
 * "Free entry" branch in offerPrice fails F-1; deleting the todayTag branch in
 * availabilitySummary fails T-1; restoring `chips.offerChip.label` as the tile
 * value fails W-1.
 */
import fs from 'node:fs';
import path from 'node:path';

import { leaveDeckTo, leaveSheetTo } from '../../deckCard/deckNavigation';
import {
  availabilitySummary,
  offerPaneRows,
  paneBar,
  PANE_COPY,
} from '../venuePaneModel';
import { buyerWebOriginFor, openVenueOfferCheckout, venueOfferCheckoutWebUrl } from '../venueOfferCheckoutSeam';

interface M {
  toBe(v: unknown): void;
  toEqual(v: unknown): void;
  toBeNull(): void;
  toMatch(v: RegExp): void;
  not: { toMatch(v: RegExp): void; toBe(v: unknown): void };
}
declare const describe: (name: string, body: () => void) => void;
declare const test: (name: string, body: () => void) => void;
declare const expect: (v: unknown) => M;

const read = (rel: string): string => fs.readFileSync(path.join(__dirname, rel), 'utf8');

describe('#4490 W3 fix 1 — the card sheet leaves the deck through its host (W3-N2)', () => {
  test('H-1 collab: the sheet closes, then the deck host closes the shared deck and owns the push', () => {
    const calls: string[] = [];
    leaveSheetTo('/b/hc/v/gameland?tab=entry', {
      closeSheet: () => calls.push('close sheet'),
      onExternalRoute: (p) => calls.push(`collab hand-off ${p}`),
      push: (p) => calls.push(`push ${p}`),
    });
    expect(calls).toEqual(['close sheet', 'collab hand-off /b/hc/v/gameland?tab=entry']);
  });
  test('H-2 solo (no deck host hand-off): the sheet closes, then the route is pushed, as before', () => {
    const calls: string[] = [];
    leaveSheetTo('/e/hc/retro-night', {
      closeSheet: () => calls.push('close sheet'),
      onExternalRoute: undefined,
      push: (p) => calls.push(`push ${p}`),
    });
    expect(calls).toEqual(['close sheet', 'push /e/hc/retro-night']);
    // The deck's own hand-off is unchanged.
    const deck: string[] = [];
    leaveDeckTo('/b/hc', { onExternalRoute: null, push: (p) => deck.push(p) });
    expect(deck).toEqual(['/b/hc']);
  });
  test('H-3 an empty path does nothing (never closes the sheet on a dead route)', () => {
    const calls: string[] = [];
    leaveSheetTo('', { closeSheet: () => calls.push('close'), onExternalRoute: () => calls.push('route'), push: () => calls.push('push') });
    expect(calls).toEqual([]);
  });
});

describe('#4490 W3 fix 1 — the Buy hand-off opens this build\'s buyer web (W3-N12)', () => {
  test('S-1 the hosted project (every EAS profile) hands off to host.usemingla.com', () => {
    expect(buyerWebOriginFor('https://abcdefghijklmnop.supabase.co')).toBe('https://host.usemingla.com');
  });
  test('S-2 a local or unknown backend never opens production', () => {
    expect(buyerWebOriginFor('http://127.0.0.1:57521')).toBeNull();
    expect(buyerWebOriginFor('http://192.168.1.20:57521')).toBeNull();
    expect(buyerWebOriginFor('http://abc.supabase.co')).toBeNull();
    expect(buyerWebOriginFor('https://supabase.co.example.test')).toBeNull();
    expect(buyerWebOriginFor('not a url')).toBeNull();
  });
  test('S-3 with no buyer web the hand-off opens nothing and reports it', () => {
    const opened: string[] = [];
    const target = { brandSlug: 'hc', venueSlug: 'gameland', tab: 'entry' as const, offerId: 'o1' };
    expect(openVenueOfferCheckout(target, (u) => opened.push(u), { backendUrl: 'http://127.0.0.1:57521' })).toBe(false);
    expect(venueOfferCheckoutWebUrl(target, null)).toBeNull();
    expect(opened).toEqual([]);
    expect(openVenueOfferCheckout(target, (u) => opened.push(u), { backendUrl: 'https://abcdefghijklmnop.supabase.co' })).toBe(true);
    expect(opened).toEqual(['https://host.usemingla.com/b/hc/v/gameland?tab=entry']);
  });
  test('S-4 the origin follows the app\'s one backend owner; the pane shows the error line, never a dead tap', () => {
    const seam = read('../venueOfferCheckoutSeam.ts');
    expect(seam).toMatch(/import \{ SUPABASE_URL \} from "\.\.\/\.\.\/config\/supabaseProject";/);
    expect(seam).toMatch(/const BUILD_HANDOFF_DEPS: VenueOfferHandoffDeps = \{ backendUrl: SUPABASE_URL \};/);
    expect(seam).toMatch(/deps: VenueOfferHandoffDeps = BUILD_HANDOFF_DEPS/);
    const pane = read('../VenueOfferPane.tsx');
    expect(pane).toMatch(/const opened = openVenueOfferCheckout\(/);
    // [TEST-MOD-APPROVED #4490] W3 fix 3 (W3-N23): the failure is held per
    // row (the row that raised it), not one pane-wide flag.
    expect(pane).toMatch(/setHandoffFailedRowId\(opened \? null : row\.id\)/);
    expect(pane).toMatch(/handoffFailedRowId === row\.id \?[\s\S]*PANE_COPY\.error/);
  });
});

describe('#4490 W3 fix 1 — pane words', () => {
  const offer = (id: string, fromMinor: number) => ({
    id, kind: 'entry' as const, entryStyle: 'walk_in' as const, name: `Entry ${id}`, summary: null, fromMinor,
    unit: 'guest' as const, guestMin: null, guestMax: null, confirmationMode: 'instant' as const, spaceIds: null, sortOrder: 0,
  });
  const money = (minor: number): string => `₦${(minor / 100).toLocaleString('en-NG')}`;
  test('F-1 a free entry row reads "Free entry" (§6), a paid one "from ₦4,000"', () => {
    const rows = offerPaneRows('entry', [offer('free', 0), offer('paid', 400000)],
      new Map([['free', { state: 'ready' as const, soldOut: false }], ['paid', { state: 'ready' as const, soldOut: false }]]),
      { code: 'NGN', exponent: 2 }, money);
    expect(rows[0]?.price).toBe('Free entry');
    expect(rows[1]?.price).toBe('from ₦4,000');
  });
});

describe('#4490 W3 fix 1 — "Sold out today" / "Closed today" (design row tag)', () => {
  const day = (localDate: string, status: string) => ({ local_date: localDate, window_id: `w-${localDate}-${status}`, status });
  test('T-1 today full, a later day open: "Sold out today", the row stays bookable', () => {
    const summary = availabilitySummary('entry', { days: [day('2026-11-22', 'sold_out'), day('2026-11-23', 'available')] }, '2026-11-22');
    expect(summary).toEqual({ soldOut: false, todayTag: 'Sold out today' });
    const rows = offerPaneRows('entry', [{
      id: 'o1', kind: 'entry', entryStyle: 'walk_in', name: 'Arcade', summary: null, fromMinor: 400000, unit: 'guest',
      guestMin: null, guestMax: null, confirmationMode: 'instant', spaceIds: null, sortOrder: 0,
    }], new Map([['o1', { state: 'ready' as const, ...summary }]]), { code: 'NGN', exponent: 2 }, (m) => `₦${m / 100}`);
    expect(rows[0]?.todayTag).toBe('Sold out today');
    expect(rows[0]?.soldOut).toBe(false);
    expect(paneBar('entry', rows, [], 'Buy entry')?.rowId).toBe('o1');
    expect(PANE_COPY.soldOutToday).toBe('Sold out today');
  });
  test('T-2 today closed, a later day open: "Closed today"; hire uses its own statuses', () => {
    expect(availabilitySummary('entry', { days: [day('2026-11-22', 'closed'), day('2026-11-24', 'available')] }, '2026-11-22'))
      .toEqual({ soldOut: false, todayTag: 'Closed today' });
    expect(availabilitySummary('private_hire', { days: [day('2026-11-22', 'taken'), day('2026-11-25', 'available')] }, '2026-11-22'))
      .toEqual({ soldOut: false, todayTag: 'Sold out today' });
  });
  test('T-3 today open, or nothing later open: no tag; nothing open at all is "Sold out"', () => {
    expect(availabilitySummary('entry', { days: [day('2026-11-22', 'available'), day('2026-11-23', 'sold_out')] }, '2026-11-22'))
      .toEqual({ soldOut: false, todayTag: null });
    expect(availabilitySummary('entry', { days: [day('2026-11-22', 'sold_out'), day('2026-11-23', 'closed')] }, '2026-11-22'))
      .toEqual({ soldOut: true, todayTag: null });
    expect(availabilitySummary('entry', { days: [day('2026-11-22', 'too_soon'), day('2026-11-23', 'available')] }, '2026-11-22'))
      .toEqual({ soldOut: false, todayTag: null });
  });
  test('T-4 the pane draws the tag under the price and says it to screen readers', () => {
    const pane = read('../VenueOfferPane.tsx');
    expect(pane).toMatch(/row\.todayTag === "Sold out today" \? PANE_COPY\.soldOutToday : PANE_COPY\.closedToday/);
    expect(pane).toMatch(/row\.todayTag !== null \? `, \$\{row\.todayTag\}`/);
    const hook = read('../useVenueOfferAvailability.ts');
    expect(hook).toMatch(/availabilitySummary\(\s*offer\.kind,[\s\S]*window\.from,/);
  });
});

describe('#4490 W3 fix 1 — deck wiring', () => {
  const deck = read('../../SwipeableCards.tsx');
  test('W-1 the plate tile reads the chip\'s tile value under the tab name (W3-N13)', () => {
    expect(deck).toMatch(/\{ label: chips\.offerChip\.tabLabel, value: chips\.offerChip\.tileValue \}/);
    expect(deck).not.toMatch(/value: chips\.offerChip\.label/);
  });
  test('W-2 the event chip reads the session\'s dates on a shared deck, the user\'s own solo (W3-N11)', () => {
    expect(deck).toMatch(/const deckShowsToday = isBoardSession\s*\?\s*sessionBrowsesToday\(allParticipantPrefs\)\s*:\s*deckBrowsesToday\(userPreferences\?\.date_option\);/);
    expect(deck).toMatch(/currentVenueChips\?\.eventChip && deckShowsToday/);
  });
  test('W-3 the deck hands its route hand-off to the card sheet, which uses it for every venue route (W3-N2)', () => {
    expect(deck).toMatch(/<ExpandedCardModal[\s\S]*?onExternalRoute=\{onExternalRoute\}/);
    const sheet = read('../../ExpandedCardModal.tsx');
    expect((sheet.match(/leaveSheetTo\(/g) ?? []).length).toBe(2);
    expect(sheet).toMatch(/leaveSheetTo\(deckCta\.path, \{\s*closeSheet: onClose,\s*onExternalRoute,/);
    expect(sheet).toMatch(/onOpenPath=\{\(path\) =>\s*leaveSheetTo\(path, \{\s*closeSheet: onClose,\s*onExternalRoute,/);
    expect(sheet).not.toMatch(/onClose\(\);\s*router\.push\(deckCta\.path/);
  });
});
