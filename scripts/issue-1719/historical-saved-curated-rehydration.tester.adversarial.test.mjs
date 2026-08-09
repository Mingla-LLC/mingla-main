/**
 * #1719 independent historical saved-curated rehydration oracle.
 *
 * This attacks the complete authoritative loader rather than the exported pure
 * rehydrator used by the implementor fixture. Both saved-card entry paths must
 * perform one full-select batch, ignore forged/stale public stop facts, retain
 * authored plan semantics, and keep private identity out of public envelopes.
 *
 * FAILS-ON-REVERT: holding this file fixed while restoring contentShare.ts to
 * 7ec377578 makes the valid saved-card cases fail with invalid_native_snapshot.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadAuthoritativeContentShare,
  PLACE_POOL_SHARE_SELECT,
} from '../../supabase/functions/_shared/contentShare.ts';

const PROFILE = '00000000-0000-0000-0000-000000000171';
const SAVED_ID = '10000000-0000-0000-0000-000000001719';
const IDS = ['google-stop-a', 'google-stop-b'];

const savedRow = (overrides = {}) => ({
  id: SAVED_ID,
  profile_id: PROFILE,
  experience_id: 'historical-plan',
  title: 'Database wrapper title',
  category: 'Saved category',
  image_url: null,
  card_data: {
    id: 'historical-curated-card',
    cardType: 'curated',
    title: 'Authored Saturday Plan',
    category: 'Friends day out',
    description: 'Authored plan copy survives.',
    tagline: 'Two places, one afternoon',
    estimatedDurationMinutes: 150,
    stops: [
      {
        placeId: IDS[0], stopNumber: 1, stopLabel: 'Start Here',
        placeName: 'FORGED STALE NAME A', placeType: 'forged-type', address: 'forged address',
        rating: 1, reviewCount: 1, imageUrl: 'https://usemingla.com/stale-a.jpg',
        website: 'http://legacy-a.example/path', aiDescription: 'Authored reason A',
        estimatedDurationMinutes: 45, role: 'Coffee', comboCategory: 'coffee', rankSignal: 'relaxed',
        priceTier: 'chill', distanceFromUserKm: 99, cardPoolId: 'private-card-a', providerPayload: { secret: true },
      },
      {
        placeId: IDS[1], stopNumber: 2, stopLabel: 'Finish Here',
        placeName: 'FORGED STALE NAME B', placeType: 'forged-type', address: 'forged address',
        rating: 1, reviewCount: 1, imageUrl: 'https://usemingla.com/stale-b.jpg',
        aiDescription: 'Authored reason B', estimatedDurationMinutes: 75, role: 'Dinner',
        comboCategory: 'restaurant', rankSignal: 'food', priceTier: 'comfy',
        placePoolId: 'private-pool-b', aiReasoningBySignal: { private: true },
      },
    ],
    ...overrides,
  },
});

const servedRows = () => [
  // Deliberately shuffled: saved order, never database return order, owns the card.
  {
    id: 'private-pool-row-b', google_place_id: IDS[1], name: 'Current Place B',
    primary_type_display_name: 'Indian restaurant', address: '2 Current Street', city: 'Durham',
    rating: 4.8, review_count: 802, price_level: 'PRICE_LEVEL_EXPENSIVE', price_min: 30, price_max: 60,
    opening_hours: null, utc_offset_minutes: -240, stored_photo_urls: ['https://usemingla.com/current-b.jpg'],
    website: 'http://current-b.example/', national_phone_number: '+19195550002', country_code: 'US',
    lat: 35.82, lng: -78.64, is_active: true, is_servable: true, server_secret: 'never-copy-me',
  },
  {
    id: 'private-pool-row-a', google_place_id: IDS[0], name: 'Current Place A',
    primary_type_display_name: 'Coffee shop', address: '1 Current Street', city: 'Durham',
    rating: 4.6, review_count: 401, price_level: 'PRICE_LEVEL_MODERATE', price_min: 10, price_max: 20,
    opening_hours: null, utc_offset_minutes: -240, stored_photo_urls: ['https://usemingla.com/current-a.jpg'],
    website: 'https://current-a.example/menu', national_phone_number: '+19195550001', country_code: 'US',
    lat: 35.81, lng: -78.63, is_active: true, is_servable: true, server_secret: 'never-copy-me',
  },
];

function database({ row = savedRow(), served = servedRows(), savedError = null, servedError = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push({ operation: 'from', table });
      const query = {
        select(columns) { calls.push({ operation: 'select', table, columns }); return query; },
        eq(column, value) { calls.push({ operation: 'eq', table, column, value }); return query; },
        async maybeSingle() {
          if (table !== 'saved_card') throw new Error(`unexpected maybeSingle ${table}`);
          return { data: savedError ? null : row, error: savedError };
        },
        async in(column, values) {
          if (table !== 'place_pool') throw new Error(`unexpected in ${table}`);
          calls.push({ operation: 'in', table, column, values: [...values] });
          return { data: servedError ? null : served, error: servedError };
        },
      };
      return query;
    },
  };
}

const paths = [
  ['source-record', { sourceScope: 'solo', sourceRecordId: SAVED_ID }],
  ['legacy-saved-id', { savedCardId: SAVED_ID }],
];

test('F-H1 both saved paths use one full batch and current place truth without rewriting authored plan order/copy', async () => {
  for (const [label, identity] of paths) {
    const db = database();
    const mapped = await loadAuthoritativeContentShare(db, PROFILE, 'curated', identity);
    const snapshot = mapped.nativeSnapshot;

    assert.equal(snapshot.id, 'historical-curated-card', label);
    assert.equal(snapshot.title, 'Authored Saturday Plan', label);
    assert.equal(snapshot.description, 'Authored plan copy survives.', label);
    assert.equal(snapshot.tagline, 'Two places, one afternoon', label);
    assert.equal(snapshot.estimatedDurationMinutes, 150, label);
    assert.deepEqual(snapshot.stops.map((stop) => stop.placeId), IDS, label);
    assert.deepEqual(snapshot.stops.map((stop) => stop.placeName), ['Current Place A', 'Current Place B'], label);
    assert.deepEqual(snapshot.stops.map((stop) => stop.stopLabel), ['Start Here', 'Finish Here'], label);
    assert.deepEqual(snapshot.stops.map((stop) => stop.aiDescription), ['Authored reason A', 'Authored reason B'], label);
    assert.deepEqual(snapshot.stops.map((stop) => stop.role), ['Coffee', 'Dinner'], label);
    assert.deepEqual(snapshot.stops.map((stop) => stop.rating), [4.6, 4.8], label);
    assert.equal(snapshot.stops[0].website, 'https://current-a.example/menu', label);
    assert.equal('website' in snapshot.stops[1], false, label);

    const serializedSnapshot = JSON.stringify(snapshot);
    for (const forbidden of ['FORGED STALE', 'forged address', 'stale-a.jpg', 'private-card-a', 'private-pool-b', 'never-copy-me', 'distanceFromUserKm', 'providerPayload', 'aiReasoningBySignal']) {
      assert.equal(serializedSnapshot.includes(forbidden), false, `${label}:${forbidden}`);
    }
    const publicText = JSON.stringify({ facts: mapped.facts, publicDetails: mapped.publicDetails, destination: mapped.destinationManifest });
    for (const privateValue of [...IDS, SAVED_ID, 'private-pool-row-a', 'private-pool-row-b']) {
      assert.equal(publicText.includes(privateValue), false, `${label}:${privateValue}`);
    }

    const batches = db.calls.filter((call) => call.operation === 'in' && call.table === 'place_pool');
    assert.equal(batches.length, 1, label);
    assert.deepEqual(batches[0], { operation: 'in', table: 'place_pool', column: 'google_place_id', values: IDS }, label);
    const selects = db.calls.filter((call) => call.operation === 'select' && call.table === 'place_pool');
    assert.deepEqual(selects.map((call) => call.columns), [PLACE_POOL_SHARE_SELECT], label);
  }
});

test('F-H2 missing duplicate extra inactive unservable and identity-mismatched served rows fail closed on both paths', async () => {
  const attacks = [
    ['missing', servedRows().slice(0, 1)],
    ['duplicate', [servedRows()[0], { ...servedRows()[0] }]],
    ['extra/mismatch', [...servedRows(), { ...servedRows()[0], google_place_id: 'unrequested-id' }]],
    ['inactive', servedRows().map((row, index) => index === 0 ? { ...row, is_active: false } : row)],
    ['unservable', servedRows().map((row, index) => index === 1 ? { ...row, is_servable: false } : row)],
  ];
  for (const [pathLabel, identity] of paths) {
    for (const [attackLabel, served] of attacks) {
      await assert.rejects(
        loadAuthoritativeContentShare(database({ served }), PROFILE, 'curated', identity),
        /validation/,
        `${pathLabel}:${attackLabel}`,
      );
    }
  }

  const duplicateSaved = savedRow({ stops: [savedRow().card_data.stops[0], { ...savedRow().card_data.stops[1], placeId: IDS[0] }] });
  for (const [label, identity] of paths) {
    const db = database({ row: duplicateSaved });
    await assert.rejects(loadAuthoritativeContentShare(db, PROFILE, 'curated', identity), /validation/, label);
    assert.equal(db.calls.some((call) => call.table === 'place_pool'), false, `${label}:duplicate must fail before batch`);
  }
});

test('F-H3 only credential-free HTTP is omitted; hostile saved or current non-null URLs and malformed current facts reject', async () => {
  const savedWebsite = (website) => savedRow({
    stops: savedRow().card_data.stops.map((stop, index) => index === 0 ? { ...stop, website } : stop),
  });
  for (const website of ['javascript:alert(1)', 'http://user:pass@example.com/', 'https://user:pass@example.com/', 'not a url']) {
    for (const [label, identity] of paths) {
      await assert.rejects(
        loadAuthoritativeContentShare(database({ row: savedWebsite(website) }), PROFILE, 'curated', identity),
        /invalid_native_snapshot/,
        `${label}:saved:${website}`,
      );
    }
  }

  for (const currentPatch of [
    { website: 'javascript:alert(1)' },
    { website: 'http://user:pass@example.com/' },
    { website: 'https://user:pass@example.com/' },
    { website: 'not a url' },
    { rating: '4.9' },
  ]) {
    const served = servedRows().map((row, index) => index === 1 ? { ...row, ...currentPatch } : row);
    for (const [label, identity] of paths) {
      await assert.rejects(
        loadAuthoritativeContentShare(database({ served }), PROFILE, 'curated', identity),
        /invalid_native_snapshot/,
        `${label}:current:${JSON.stringify(currentPatch)}`,
      );
    }
  }
});
