/**
 * #1719 historical saved curated rehydration — implementor happy path.
 *
 * Fixture shape is the exact two-stop production shape that failed on
 * saved_card 4e79024b-e1bb-49f6-bd0a-d7cfc30591ab: legacy HTTP websites,
 * first-generation stop fields, and later additive internal fields coexist.
 *
 * FAILS-ON-REVERT: removing serve-time rehydration restores stale HTTP URLs or
 * stale place facts and makes this suite red while this file remains unchanged.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildNativeContentCardSnapshot,
  rehydrateSavedCuratedCardRow,
} from '../../supabase/functions/_shared/contentShare.ts';

const source = readFileSync(new URL('../../supabase/functions/_shared/contentShare.ts', import.meta.url), 'utf8');

const historical = {
  id: '4e79024b-e1bb-49f6-bd0a-d7cfc30591ab',
  title: 'Buffaloe Lanes North Family Bowling Center → Tamasha Modern Indian',
  category: 'Group Fun',
  card_data: {
    id: 'curated_group-fun_1786129598489_y9kf68',
    cardType: 'curated',
    title: 'Buffaloe Lanes North Family Bowling Center → Tamasha Modern Indian',
    category: 'Group Fun',
    description: 'Good times are better together',
    estimatedDurationMinutes: 189,
    stops: [
      {
        placeId: 'ChIJa2hqk71ZrIkRQuFy-piezbI', placeName: 'Stale bowling name', placeType: 'play',
        stopNumber: 1, stopLabel: 'Start Here', website: 'http://www.buffaloelanesnorth.com/',
        aiDescription: 'A great play worth visiting.', estimatedDurationMinutes: 90, role: 'Activity',
        comboCategory: 'play', rankSignal: 'play', priceTier: 'chill', distanceFromUserKm: 4.2,
      },
      {
        placeId: 'ChIJ66WDseBZrIkRgVdJEkqPJQk', placeName: 'Stale restaurant name', placeType: 'upscale_fine_dining',
        stopNumber: 2, stopLabel: 'End With', website: 'http://tamashanc.com/', aiDescription: '',
        estimatedDurationMinutes: 90, role: 'Dinner', comboCategory: 'upscale_fine_dining',
        rankSignal: 'fine_dining', priceTier: 'chill', aiReasoningBySignal: { private: 'legacy' },
        cardPoolId: 'private-card-pool-id', placePoolId: 'private-place-pool-id',
      },
    ],
  },
};

const rows = [
  {
    google_place_id: 'ChIJ66WDseBZrIkRgVdJEkqPJQk', name: 'Tamasha Modern Indian',
    primary_type_display_name: 'Indian restaurant', address: '4200 Six Forks Rd Suite # 130, Raleigh, NC 27609, USA',
    rating: 4.7, review_count: 804, price_min: 0, price_max: 0, utc_offset_minutes: -240,
    generative_summary: 'Current restaurant summary.', stored_photo_urls: ['https://usemingla.com/tamasha.jpg'],
    website: 'http://tamashanc.com/', national_phone_number: '(919) 900-7015', country_code: 'US',
    lat: 35.8358919, lng: -78.638385, is_active: true, is_servable: true,
  },
  {
    google_place_id: 'ChIJa2hqk71ZrIkRQuFy-piezbI', name: 'Buffaloe Lanes North Family Bowling Center',
    primary_type_display_name: 'Bowling alley', address: '5900 Oak Forest Dr, Raleigh, NC 27616, USA',
    rating: 4.4, review_count: 1296, price_min: 0, price_max: 0, utc_offset_minutes: -240,
    editorial_summary: 'Current authoritative bowling summary.', stored_photo_urls: ['https://usemingla.com/bowling.jpg'],
    website: 'http://www.buffaloelanesnorth.com/', national_phone_number: '(919) 876-5681', country_code: 'US',
    lat: 35.8630805, lng: -78.5880144, is_active: true, is_servable: true,
  },
];

test('exact historical card keeps its authored plan while every place is refreshed in saved order', () => {
  const hydrated = rehydrateSavedCuratedCardRow(historical, rows);
  const snapshot = buildNativeContentCardSnapshot('curated', hydrated);

  assert.equal(snapshot.id, historical.card_data.id);
  assert.equal(snapshot.title, historical.card_data.title);
  assert.equal(snapshot.cardType, 'curated');
  assert.equal(snapshot.description, historical.card_data.description);
  assert.equal(snapshot.estimatedDurationMinutes, 189);
  assert.deepEqual(snapshot.stops.map((stop) => stop.placeId), historical.card_data.stops.map((stop) => stop.placeId));
  assert.deepEqual(snapshot.stops.map((stop) => stop.stopLabel), ['Start Here', 'End With']);
  assert.deepEqual(snapshot.stops.map((stop) => stop.role), ['Activity', 'Dinner']);
  assert.deepEqual(snapshot.stops.map((stop) => stop.comboCategory), ['play', 'upscale_fine_dining']);
  assert.equal(snapshot.stops[0].aiDescription, 'A great play worth visiting.');
  assert.equal(snapshot.stops[1].aiDescription, undefined);

  assert.equal(snapshot.stops[0].placeName, 'Buffaloe Lanes North Family Bowling Center');
  assert.equal(snapshot.stops[0].placeType, 'Bowling alley');
  assert.equal(snapshot.stops[0].rating, 4.4);
  assert.equal(snapshot.stops[0].reviewCount, 1296);
  assert.equal(snapshot.stops[1].placeName, 'Tamasha Modern Indian');
  assert.equal(snapshot.stops[1].address, '4200 Six Forks Rd Suite # 130, Raleigh, NC 27609, USA');
  assert.equal(snapshot.stops[1].reviewCount, 804);
  assert.equal(snapshot.stops[0].website, undefined);
  assert.equal(snapshot.stops[1].website, undefined);
  assert.equal(JSON.stringify(snapshot).includes('private-card-pool-id'), false);
  assert.equal(JSON.stringify(snapshot).includes('distanceFromUserKm'), false);
});

test('both saved branches share one full-select batch loader before snapshot construction', () => {
  assert.match(source, /loadRehydratedSavedCuratedCard[\s\S]+select\(PLACE_POOL_SHARE_SELECT\)\.in\("google_place_id",savedIds\)/);
  assert.equal((source.match(/await loadRehydratedSavedCuratedCard\(db,/g) ?? []).length, 2);
  const loader = source.slice(source.indexOf('const loadRehydratedSavedCuratedCard'), source.indexOf('const durationLabel'));
  assert.equal((loader.match(/\.from\("place_pool"\)/g) ?? []).length, 1);
});

test('the compatibility exception is limited to credential-free HTTP websites', () => {
  const unsafe = (website) => ({
    ...historical,
    card_data: {
      ...historical.card_data,
      stops: historical.card_data.stops.map((stop, index) => index === 0 ? { ...stop, website } : stop),
    },
  });
  for (const website of ['javascript:alert(1)', 'http://user:pass@example.com/', 'not a url']) {
    assert.throws(() => rehydrateSavedCuratedCardRow(unsafe(website), rows), /invalid_native_snapshot/);
  }
});
