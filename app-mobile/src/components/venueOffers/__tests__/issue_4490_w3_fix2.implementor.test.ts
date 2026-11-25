/**
 * #4490 Explorer W3 fix round 2 — app side.
 *
 *   B-1..B-3  the Buy hand-off for every EAS build profile (W3-N15): each
 *             profile's backend is the app's one owner, and (06-W4) every
 *             profile opens the native checkout sheet the same way;
 *   G-1..G-3  groups "from" in ONE unit (W3-N17): per-guest packages first,
 *             never a cheaper per-booking price worded "a guest"; a
 *             per-booking-only venue says no unit; the Ways row agrees;
 *   U-1       a hire whose cheapest row is priced by the hour says "an hour"
 *             on the page lead, the Ways row and the pane (local stack's
 *             "Hire the Lounge": ₦400,000 an hour, was "from ₦400,000").
 *
 * FAILS-ON-REVERT: putting a web origin back in the seam fails B-3; restoring the min-over-all groups price in
 * deriveVenuePage fails G-1 and G-2; dropping the unit words from the hire
 * price fails U-1.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  deriveVenuePage,
  venueGroupsFrom,
  type PublicVenueFeaturesView,
  type VenueFeatureOfferView,
} from '@mingla/brand-rendering/venueFeaturePage';

import { openVenueOfferCheckout } from '../venueOfferCheckoutSeam';
import { offerPaneRows } from '../venuePaneModel';

// The app's one backend owner (CommonJS, read by app.config.js too).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SUPABASE_URL } = require('../../../config/supabaseProject') as { SUPABASE_URL: string };

interface M {
  toBe(v: unknown): void;
  toEqual(v: unknown): void;
  toBeNull(): void;
  toMatch(v: RegExp): void;
  not: { toMatch(v: RegExp): void };
}
declare const describe: (name: string, body: () => void) => void;
declare const test: (name: string, body: () => void) => void;
declare const expect: (v: unknown) => M;

const target = { brandSlug: 'harmattan-club', venueSlug: 'gameland', tab: 'entry' as const, offerId: 'o1' };

describe('#4490 W3 fix 2 — the Buy hand-off for every build profile (W3-N15)', () => {
  const eas = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../../eas.json'), 'utf8')) as {
    build: Record<string, { env?: Record<string, string> }>;
  };
  const profiles = Object.keys(eas.build);

  test('B-1 no build profile carries a backend of its own: every profile builds against SUPABASE_URL', () => {
    expect(profiles.length > 0).toBe(true);
    for (const name of profiles) {
      const keys = Object.keys(eas.build[name].env ?? {});
      expect(keys.filter((k) => /SUPABASE|API_URL|BACKEND/i.test(k))).toEqual([]);
    }
  });

  // TEST-MOD-APPROVED #4490 (06-W4): the buyer-web hand-off is retired; the
  // native sheet opens the same on every profile's backend (it calls this
  // build's own backend, so no profile can send a guest to another system).
  test('B-2 every profile opens the native checkout for the tapped offer, the same way', () => {
    const venue = { venueId: 'v1', venueName: 'Gameland', currencyCode: 'NGN', exponent: 2, timezone: 'Africa/Lagos', lat: null, lng: null, category: null };
    for (const name of profiles) {
      const opened: Array<{ kind: string; offerId: string | null }> = [];
      expect(openVenueOfferCheckout(target, venue, (o) => opened.push({ kind: o.kind, offerId: o.offerId }))).toBe(true);
      expect(opened).toEqual([{ kind: 'entry', offerId: 'o1' }]);
      void name;
    }
  });

  test('B-3 the seam no longer reads a backend to pick a web origin', () => {
    const seam = fs.readFileSync(path.join(__dirname, '../venueOfferCheckoutSeam.ts'), 'utf8');
    expect(seam).not.toMatch(/SUPABASE_URL|backendUrl|host\.usemingla\.com/);
    void SUPABASE_URL;
  });
});

const pkg = (over: Partial<VenueFeatureOfferView>): VenueFeatureOfferView => ({
  id: 'g1', kind: 'group_package', entryStyle: null, name: 'Party', summary: null,
  fromMinor: 1200000, unit: 'guest', guestMin: 8, guestMax: 20, confirmationMode: 'instant', spaceIds: null, sortOrder: 0,
  ...over,
});
const view = (offers: VenueFeatureOfferView[]): PublicVenueFeaturesView => ({
  version: 1, features: ['group_packages'], currencyCode: 'NGN', minorUnitExponent: 2, offers, tables: null,
  memberships: null, events: [], hours: { weekly: [], specialDays: [] }, spaces: [],
});
const ctx = { menuTabVisible: false, tablesGate: 'blocked' as const };

describe('#4490 W3 fix 2 — groups "from" in one unit (W3-N17)', () => {
  test('G-1 a cheaper per-booking package never reads as a per-guest price', () => {
    const offers = [pkg({}), pkg({ id: 'g2', name: 'Whole room', unit: 'booking', fromMinor: 1000000 })];
    expect(venueGroupsFrom(offers)).toEqual({ offer: offers[0], perGuest: true });
    const page = deriveVenuePage(view(offers), ctx);
    expect(page.lead?.row?.value).toBe('Groups from ₦12,000 a guest');
    expect(page.lead?.row?.value).not.toMatch(/₦10,000/);
  });
  test('G-2 the Ways row prices the same package with the same unit', () => {
    const offers = [pkg({}), pkg({ id: 'g2', name: 'Whole room', unit: 'booking', fromMinor: 1000000 })];
    const ways = deriveVenuePage(view(offers), ctx).ways.find((w) => w.tab === 'groups');
    expect(ways?.price).toBe('from ₦12,000 a guest');
  });
  test('G-3 per-booking packages only: the price has no "a guest"', () => {
    const page = deriveVenuePage(view([pkg({ unit: 'booking', fromMinor: 6000000 })]), ctx);
    expect(page.lead?.row?.value).toBe('Groups from ₦60,000');
    expect(venueGroupsFrom([])).toBeNull();
  });
});

describe('#4490 W3 fix 2 — a hire price keeps its unit (W3-N17)', () => {
  test('U-1 an hourly hire row reads "an hour" on the lead, the Ways row and the pane', () => {
    const hire = pkg({ id: 'h1', kind: 'private_hire', name: 'Hire the Lounge', unit: 'hour', fromMinor: 40000000 });
    const v: PublicVenueFeaturesView = { ...view([hire]), features: ['private_hire'] };
    const page = deriveVenuePage(v, ctx);
    expect(page.lead?.row?.value).toBe('Hire from ₦400,000 an hour');
    expect(page.ways.find((w) => w.tab === 'hire')?.price).toBe('from ₦400,000 an hour');
    const money = (minor: number): string => `₦${(minor / 100).toLocaleString('en-GB')}`;
    expect(offerPaneRows('hire', [hire], new Map(), { code: 'NGN', exponent: 2 }, money)[0]?.price).toBe('from ₦400,000 an hour');
    const booking = offerPaneRows('hire', [{ ...hire, unit: 'booking' }], new Map(), { code: 'NGN', exponent: 2 }, money)[0]?.price;
    expect(booking).toBe('from ₦400,000');
  });
});
