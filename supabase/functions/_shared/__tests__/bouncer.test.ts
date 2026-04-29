// ORCH-0588 Slice 1 — Bouncer v2 unit tests
// Run: cd supabase && deno test --allow-all functions/_shared/__tests__/bouncer.test.ts

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { bounce, deriveCluster, isOwnDomain, type PlaceRow } from '../bouncer.ts';

function basePlace(overrides: Partial<PlaceRow> = {}): PlaceRow {
  return {
    id: 'test-id',
    name: 'Test Place',
    lat: 35.78,
    lng: -78.65,
    types: ['restaurant'],
    business_status: 'OPERATIONAL',
    website: 'https://example.com',
    opening_hours: { monday: '9-5' },
    photos: [{ name: 'p1' }],
    stored_photo_urls: ['https://storage.example.com/p1.jpg'],
    review_count: 100,
    rating: 4.5,
    ...overrides,
  };
}

// ───── Cluster derivation ─────────────────────────────────────────────────

Deno.test('deriveCluster — EXCLUDED beats everything', () => {
  assertEquals(deriveCluster(['gym', 'restaurant', 'park']), 'EXCLUDED');
  assertEquals(deriveCluster(['fitness_center']), 'EXCLUDED');
});

Deno.test('deriveCluster — C_NATURAL when park-like types present', () => {
  assertEquals(deriveCluster(['park']), 'C_NATURAL');
  assertEquals(deriveCluster(['state_park', 'tourist_attraction']), 'C_NATURAL');
});

Deno.test('deriveCluster — B_CULTURAL when no park but museum-like', () => {
  assertEquals(deriveCluster(['museum']), 'B_CULTURAL');
  assertEquals(deriveCluster(['historical_landmark']), 'B_CULTURAL');
});

Deno.test('deriveCluster — A_COMMERCIAL is the default', () => {
  assertEquals(deriveCluster(['restaurant']), 'A_COMMERCIAL');
  assertEquals(deriveCluster(['bar', 'cafe']), 'A_COMMERCIAL');
  assertEquals(deriveCluster(['unknown_type']), 'A_COMMERCIAL');
  assertEquals(deriveCluster([]), 'A_COMMERCIAL');
  assertEquals(deriveCluster(null), 'A_COMMERCIAL');
});

// ───── Own-domain check ───────────────────────────────────────────────────

Deno.test('isOwnDomain — null/empty fails', () => {
  assertEquals(isOwnDomain(null), false);
  assertEquals(isOwnDomain(''), false);
  assertEquals(isOwnDomain('   '), false);
});

Deno.test('isOwnDomain — social domains fail', () => {
  assertEquals(isOwnDomain('https://facebook.com/restaurant'), false);
  assertEquals(isOwnDomain('http://www.instagram.com/foo'), false);
  assertEquals(isOwnDomain('https://yelp.com/biz/x'), false);
  assertEquals(isOwnDomain('https://opentable.com/bar'), false);
});

Deno.test('isOwnDomain — actual own domains pass', () => {
  assertEquals(isOwnDomain('https://angusbarn.com'), true);
  assertEquals(isOwnDomain('http://www.deathandtaxesraleigh.com'), true);
  assertEquals(isOwnDomain('https://stanburyrestaurant.com/menu'), true);
});

// ───── T-01: Cluster A passes when all data present ──────────────────────

Deno.test('T-01: Cluster A passes when all data present (Angus Barn-like)', () => {
  const place = basePlace({
    name: 'Angus Barn',
    types: ['steak_house', 'fine_dining_restaurant', 'restaurant'],
    website: 'https://angusbarn.com',
    opening_hours: { monday: '5pm-10pm' },
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true);
  assertEquals(v.cluster, 'A_COMMERCIAL');
  assertEquals(v.reasons, []);
});

// ───── T-02: Cluster A fails on social-only website ──────────────────────

Deno.test('T-02: Cluster A fails on social-only website (B5)', () => {
  const place = basePlace({
    name: "O'Malley's Pub",
    types: ['irish_pub', 'restaurant'],
    website: 'http://www.facebook.com/omalleys.raleigh',
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.cluster, 'A_COMMERCIAL');
  assertEquals(v.reasons.includes('B5:social_only'), true);
});

// ───── T-03: Cluster C passes without website/hours ──────────────────────

Deno.test('T-03: Cluster C passes without website/hours (Umstead)', () => {
  const place = basePlace({
    name: 'Umstead State Park',
    types: ['state_park', 'park'],
    website: null,
    opening_hours: null,
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true);
  assertEquals(v.cluster, 'C_NATURAL');
  assertEquals(v.reasons, []);
});

// ───── T-04: Cluster B famous bypass ─────────────────────────────────────

Deno.test('T-04: Cluster B famous bypass (NCMA — review_count>=500 + rating>=4.5)', () => {
  const place = basePlace({
    name: 'NC Museum of Art',
    types: ['museum', 'art_gallery'],
    website: null, // no own domain — but famous
    review_count: 8000,
    rating: 4.8,
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true);
  assertEquals(v.cluster, 'B_CULTURAL');
});

Deno.test('T-04b: Cluster B WITHOUT famous bypass fails on no-website', () => {
  const place = basePlace({
    name: 'Tiny Local Gallery',
    types: ['art_gallery'],
    website: null,
    review_count: 50,
    rating: 4.4,
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.cluster, 'B_CULTURAL');
  assertEquals(v.reasons.includes('B4:no_website'), true);
});

// ───── T-05: EXCLUDED type rejected ──────────────────────────────────────

Deno.test('T-05: EXCLUDED type rejected (Planet Fitness)', () => {
  const place = basePlace({
    name: 'Planet Fitness',
    types: ['gym', 'fitness_center', 'spa'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.cluster, 'EXCLUDED');
  assertEquals(v.reasons.length, 1);
  assertEquals(v.reasons[0], 'B1:gym');
});

// ───── Boundary cases ────────────────────────────────────────────────────

Deno.test('B2: closed business rejected', () => {
  const place = basePlace({ business_status: 'CLOSED_PERMANENTLY' });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons[0], 'B2:closed');
});

Deno.test('B3: missing name rejected', () => {
  const v = bounce(basePlace({ name: null }));
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons[0], 'B3:missing_required_field');
});

Deno.test('B7+B8: missing photos accumulates reasons (multi-reason concat)', () => {
  const place = basePlace({
    photos: null,
    stored_photo_urls: null,
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons.includes('B7:no_google_photos'), true);
  assertEquals(v.reasons.includes('B8:no_stored_photos'), true);
});

Deno.test('Cluster C ignores missing website AND missing hours', () => {
  const place = basePlace({
    types: ['hiking_area'],
    website: null,
    opening_hours: null,
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true);
  assertEquals(v.cluster, 'C_NATURAL');
});

Deno.test('Cluster C still requires photos', () => {
  const place = basePlace({
    types: ['park'],
    photos: null,
    stored_photo_urls: null,
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons.includes('B7:no_google_photos'), true);
});

// ───── ORCH-0678: Two-pass Bouncer (skipStoredPhotoCheck opts flag) ──────

Deno.test('ORCH-0678 T-03a: pre-photo pass — clean place with no stored photos passes', () => {
  // Has google photos but stored_photo_urls is null. In pre-photo pass this
  // should pass (B8 skipped); in final pass it would fail B8.
  const place = basePlace({
    types: ['restaurant'],
    website: 'https://x.com', // not in SOCIAL_DOMAINS — own-domain
    opening_hours: { monday: '9-5' },
    photos: [{ name: 'p1' }],
    stored_photo_urls: null, // ← no stored photos yet
  });
  const v = bounce(place, { skipStoredPhotoCheck: true });
  assertEquals(v.is_servable, true);
  assertEquals(v.reasons, []);
});

Deno.test('ORCH-0678 T-03b: final pass — same place fails B8', () => {
  const place = basePlace({
    types: ['restaurant'],
    website: 'https://x.com',
    opening_hours: { monday: '9-5' },
    photos: [{ name: 'p1' }],
    stored_photo_urls: null,
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B8:no_stored_photos']);
});

Deno.test('ORCH-0678 T-03c: pre-photo pass — Cluster A no-website still fails B4 (B8 not in list)', () => {
  const place = basePlace({
    types: ['restaurant'],
    website: null, // ← no website
    opening_hours: { monday: '9-5' },
    stored_photo_urls: null,
  });
  const v = bounce(place, { skipStoredPhotoCheck: true });
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons.includes('B4:no_website'), true);
  assertEquals(v.reasons.includes('B8:no_stored_photos'), false); // ← key
});

Deno.test('ORCH-0678 T-03d: pre-photo pass — B7 still fires (zero google photo metadata)', () => {
  // B7 is NOT skipped by opts.skipStoredPhotoCheck — only B8 is. The point of
  // pre-photo pass is to weed out things that can't possibly succeed at photo
  // download; zero google photo metadata means nothing to download, so reject.
  const place = basePlace({
    types: ['park'],
    website: null,
    opening_hours: null,
    photos: [], // ← zero google photos
    stored_photo_urls: null,
  });
  const v = bounce(place, { skipStoredPhotoCheck: true });
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons.includes('B7:no_google_photos'), true);
});

Deno.test('ORCH-0678 T-03e: pre-photo pass — excluded type still B1 short-circuits', () => {
  const place = basePlace({
    name: 'Planet Fitness',
    types: ['gym', 'fitness_center'],
    stored_photo_urls: null,
  });
  const v = bounce(place, { skipStoredPhotoCheck: true });
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons.length, 1);
  assertEquals(v.reasons[0], 'B1:gym');
});

Deno.test('ORCH-0678 I-TWO-PASS-BOUNCER-RULE-PARITY: 50 randomized places differ ONLY by B8', () => {
  // The two passes must produce identical verdicts EXCEPT for the presence/
  // absence of B8 in reasons. Any other divergence violates the parity invariant.
  const websites = [null, 'https://example.com', 'https://facebook.com/x', ''];
  const types = [['restaurant'], ['park'], ['museum'], ['gym'], []];
  const closed = [null, 'OPERATIONAL', 'CLOSED_PERMANENTLY'];
  const photos: Array<unknown> = [null, [], [{ name: 'p1' }, { name: 'p2' }]];
  const stored = [null, [], ['stored1'], ['__backfill_failed__']];
  const hours = [null, {}, { monday: '9-5' }];

  let rng = 12345;
  const next = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng; };
  const pick = <T>(arr: T[]): T => arr[next() % arr.length];

  for (let i = 0; i < 50; i++) {
    const place = basePlace({
      website: pick(websites),
      types: pick(types),
      business_status: pick(closed),
      photos: pick(photos),
      stored_photo_urls: pick(stored),
      opening_hours: pick(hours),
      review_count: next() % 1000,
      rating: 1 + (next() % 50) / 10,
    });
    const final = bounce(place);
    const pre = bounce(place, { skipStoredPhotoCheck: true });

    // Cluster must agree (it's derived from types only).
    assertEquals(pre.cluster, final.cluster);

    // Reasons must differ ONLY by the presence of B8:no_stored_photos.
    // B1 short-circuit cases: both passes return identical [B1:*] reasons.
    // B2/B3/B9 short-circuit cases: same — short-circuit happens before B8.
    const finalReasonsNoB8 = final.reasons.filter((r) => r !== 'B8:no_stored_photos');
    assertEquals(
      pre.reasons,
      finalReasonsNoB8,
      `Parity violation at iteration ${i}: pre=${JSON.stringify(pre.reasons)} vs final-without-B8=${JSON.stringify(finalReasonsNoB8)}`,
    );
  }
});
