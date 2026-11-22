/**
 * #4490 — the deck place sheet's main button follows what the venue SELLS.
 *
 *   D-1 a venue that takes tables keeps "Reserve a table" and the in-place sheet;
 *   D-2 a venue with NO table feature never offers tables, even when the old
 *       reserve gate says reservable (the Gameland defect);
 *   D-3 a lead that is not tables opens the venue page on the lead's tab;
 *   D-4 no lead is Directions, never a dead Reserve;
 *   D-5 no features (unclaimed, not loaded, read failed) is TODAY's button;
 *   D-6 a stay keeps its own flow (unchanged);
 *   D-7 every label the page can produce has an i18n key and an English line;
 *   D-8 (wiring) the sheet's hook is mounted and the pinned bar reads the model.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 * FAILS-ON-REVERT: drop the `tables` lead check or the three reservable
 * conditions in `deckVenueCta` and D-1/D-2/D-5 fail.
 */
import fs from 'node:fs';
import path from 'node:path';

import { deriveVenuePage, parsePublicVenueFeatures, ALL_VENUE_TABS } from '@mingla/brand-rendering/venueFeaturePage';
import {
  DECK_CTA_LABEL_KEYS,
  deckVenueCta,
  type DeckReservableGate,
} from '../deckVenueCta';

const READY: DeckReservableGate = { reservable: true, brand_id: 'b1', venue_id: 'v1' };
const NOT_READY: DeckReservableGate = { reservable: false, brand_id: null, venue_id: null };
const SPACE = { id: 's1', name: 'The Lounge Side', setting: 'covered', capacityStanding: 150 };

const place = (features: string[], extra: Record<string, unknown> = {}) => {
  const parsed = parsePublicVenueFeatures({
    features,
    spaces: [SPACE],
    currencyCode: 'NGN',
    minorUnitExponent: 2,
    offers: [],
    tables: features.includes('table_reservations') ? { partyMax: 8 } : null,
    ...extra,
  });
  if (parsed === null) throw new Error('fixture');
  return { brandSlug: 'gameland', venueSlug: 'lagos', features: parsed };
};

describe('#4490 deck place sheet main button', () => {
  test('D-1 tables: Reserve a table, opening the in-place sheet', () => {
    expect(deckVenueCta({ place: place(['table_reservations', 'menu']), reservable: READY })).toEqual({
      kind: 'reserve',
      labelKey: 'sheet.reserve',
      fallbackLabel: 'Reserve a table',
    });
  });

  test('D-1 tables with a minimum spend read Book a table', () => {
    const p = place(['table_reservations', 'min_spend_tables'], {
      tables: { partyMax: 8, holdFromMinor: 2000000, minSpendFromMinor: 8000000 },
    });
    expect(deckVenueCta({ place: p, reservable: READY })).toMatchObject({
      kind: 'reserve',
      labelKey: 'sheet.book_table',
      fallbackLabel: 'Book a table',
    });
  });

  test('D-1 the sheet needs all three reserve conditions, else Directions (no dead tap)', () => {
    const p = place(['table_reservations']);
    expect(deckVenueCta({ place: p, reservable: NOT_READY })).toEqual({ kind: 'directions' });
    expect(deckVenueCta({ place: p, reservable: { reservable: true, brand_id: null, venue_id: 'v1' } })).toEqual({ kind: 'directions' });
    expect(deckVenueCta({ place: p, reservable: { reservable: true, brand_id: 'b1', venue_id: null } })).toEqual({ kind: 'directions' });
    // Still checking: nothing to sell yet, so Directions rather than a guess.
    expect(deckVenueCta({ place: p, reservable: undefined })).toEqual({ kind: 'directions' });
  });

  test('D-2 no table feature: never tables, whatever the old gate says', () => {
    const gameland = place(['events_here', 'menu']);
    expect(deckVenueCta({ place: gameland, reservable: READY })).toEqual({ kind: 'directions' });
    expect(deckVenueCta({ place: gameland, reservable: NOT_READY })).toEqual({ kind: 'directions' });
  });

  test('D-3 a lead that is not tables opens the venue page on its tab', () => {
    // Offers are built in later phases; the derivation is the same one the page
    // uses, so a Gameland-like venue's lead is Buy entry. Prove the mapping with
    // every built tab allowed, through the page model itself.
    const entry = parsePublicVenueFeatures({
      features: ['entry', 'events_here'],
      spaces: [SPACE],
      offers: [{ id: 'o1', kind: 'entry', name: 'Walk-in', fromMinor: 400000, entryStyle: 'walk_in', unit: 'guest', confirmationMode: 'instant' }],
    });
    const model = deriveVenuePage(entry, { menuTabVisible: false, tablesGate: 'blocked', built: ALL_VENUE_TABS });
    expect(model.lead?.ctaLabel).toBe('Buy entry');
    expect(DECK_CTA_LABEL_KEYS['Buy entry']).toBe('sheet.buy_entry');
    expect(model.lead?.tab).toBe('entry');
  });

  // [TEST-MOD-APPROVED #4490] Explorer W3: the venue lead opens the venue page
  // IN THE APP (its native tabs); the buyer web `webUrl` path is deleted
  // (rule 8), so this test now pins the in-app path and its absence.
  // [TEST-MOD-APPROVED #4490] W3 fix 1 (W3-N2): the push now goes through the
  // deck host's hand-off (leaveSheetTo: the sheet closes, then collab closes the
  // shared deck before the push), so the source pin names that path.
  test('D-3b W3: a Gameland-like venue gets Buy entry, opening the app venue page on Entry', () => {
    const p = place(['entry', 'events_here'], {
      offers: [{ id: 'o1', kind: 'entry', name: 'Walk-in', fromMinor: 400000, entryStyle: 'walk_in', unit: 'guest', confirmationMode: 'instant' }],
    });
    expect(deckVenueCta({ place: p, reservable: NOT_READY })).toEqual({
      kind: 'venue',
      tab: 'entry',
      path: '/b/gameland/v/lagos?tab=entry',
      labelKey: 'sheet.buy_entry',
      fallbackLabel: 'Buy entry',
    });
    const modal = fs.readFileSync(path.join(__dirname, '../../ExpandedCardModal.tsx'), 'utf8');
    expect(modal).not.toMatch(/deckCta\.webUrl/);
    expect(modal).toMatch(/leaveSheetTo\(deckCta\.path, \{/);
    const cta = fs.readFileSync(path.join(__dirname, '../deckVenueCta.ts'), 'utf8');
    expect(cta).not.toMatch(/host\.usemingla\.com/);
  });

  test('D-4 no lead is Directions', () => {
    expect(deckVenueCta({ place: place([]), reservable: READY })).toEqual({ kind: 'directions' });
    expect(deckVenueCta({ place: place(['menu']), reservable: NOT_READY })).toEqual({ kind: 'directions' });
  });

  test('D-5 no features read is today\'s button', () => {
    expect(deckVenueCta({ place: null, reservable: READY })).toEqual({
      kind: 'reserve',
      labelKey: 'sheet.reserve',
      fallbackLabel: 'Reserve a table',
    });
    expect(deckVenueCta({ place: undefined, reservable: READY }).kind).toBe('reserve');
    expect(deckVenueCta({ place: null, reservable: NOT_READY })).toEqual({ kind: 'directions' });
    expect(deckVenueCta({ place: undefined, reservable: undefined })).toEqual({ kind: 'directions' });
  });

  test('D-6 a stay keeps its own flow', () => {
    const stay = place(['stays'], { spaces: [] });
    expect(deckVenueCta({ place: stay, reservable: NOT_READY })).toEqual({ kind: 'directions' });
    expect(deckVenueCta({ place: stay, reservable: READY }).kind).toBe('reserve');
  });

  test('D-7 every label has an i18n key, and en has every key', () => {
    const en = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../../i18n/locales/en/cards.json'), 'utf8'),
    ) as Record<string, string>;
    for (const [label, key] of Object.entries(DECK_CTA_LABEL_KEYS)) {
      expect({ label, key, en: en[key] }).toEqual({ label, key, en: label });
    }
  });

  test('D-8 wiring: the modal mounts the hook and the pinned bar reads the model', () => {
    const modal = fs.readFileSync(path.join(__dirname, '../../ExpandedCardModal.tsx'), 'utf8');
    expect(modal).toMatch(/useVenueFeaturesForPlace\(card\?\.id\)/);
    expect(modal).toMatch(/deckVenueCta\(\{ place: venueFeatures, reservable: venueReservable \}\)/);
    expect(modal).toMatch(/deckCta\.kind === 'venue'/);
    // The reserve SHEET still needs all three conditions on top of the model.
    expect(modal).toMatch(/deckCta\.kind === 'reserve' &&\s*venueReservable\?\.reservable === true/);
  });
});
