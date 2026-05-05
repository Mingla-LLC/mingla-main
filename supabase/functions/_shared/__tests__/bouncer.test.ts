// ORCH-0588 Slice 1 — Bouncer v2 unit tests
// Run: cd supabase && deno test --allow-all functions/_shared/__tests__/bouncer.test.ts

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  bounce,
  deriveCluster,
  isOwnDomain,
  isUpscaleChainAllowlisted,
  matchFastFoodPattern,
  matchCasualChainPattern,
  type PlaceRow,
} from '../bouncer.ts';

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

// ═══════════════════════════════════════════════════════════════════════════
// ORCH-0735 — B10/B11/B12 fast-food / chain / cheap-snack rules
// ═══════════════════════════════════════════════════════════════════════════

// ───── B10 — Primary-type blocklist (5 fixtures) ─────────────────────────

Deno.test('T-B10-01: fast_food_restaurant primary_type blocked', () => {
  const place = basePlace({
    name: 'Generic Fast Food',
    types: ['fast_food_restaurant', 'restaurant', 'food'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B10:fast_food_type:fast_food_restaurant']);
});

Deno.test('T-B10-02: snack_bar blocked', () => {
  const place = basePlace({ name: 'Snack Spot', types: ['snack_bar', 'food'] });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B10:fast_food_type:snack_bar']);
});

Deno.test('T-B10-03: food_court blocked', () => {
  const place = basePlace({ name: 'Mall Food Court', types: ['food_court', 'food'] });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B10:fast_food_type:food_court']);
});

Deno.test('T-B10-04: cafeteria blocked', () => {
  const place = basePlace({ name: 'Office Cafeteria', types: ['cafeteria', 'food'] });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B10:fast_food_type:cafeteria']);
});

Deno.test('T-B10-05: convenience_store blocked', () => {
  const place = basePlace({
    name: '7-Eleven',
    types: ['convenience_store', 'store'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B10:fast_food_type:convenience_store']);
});

// ───── B11 — Fast-food / snack / coffee chain-name blocklist (18 fixtures) ─

Deno.test('T-B11-01: McDonald\'s blocked by name pattern', () => {
  const place = basePlace({
    name: "McDonald's",
    types: ['hamburger_restaurant', 'restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B11:chain_brand:mcdonalds']);
});

Deno.test('T-B11-02: Starbucks blocked', () => {
  const place = basePlace({
    name: 'Starbucks',
    types: ['coffee_shop', 'cafe'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B11:chain_brand:starbucks']);
});

Deno.test('T-B11-03: Pizza Hut blocked', () => {
  const place = basePlace({
    name: 'Pizza Hut',
    types: ['pizza_restaurant', 'restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B11:chain_brand:pizza_hut']);
});

Deno.test("T-B11-04: Domino's Pizza blocked", () => {
  const place = basePlace({
    name: "Domino's Pizza",
    types: ['pizza_restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B11:chain_brand:dominos']);
});

Deno.test('T-B11-05: Cinnabon blocked', () => {
  const place = basePlace({
    name: 'Cinnabon',
    types: ['bakery'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B11:chain_brand:cinnabon']);
});

Deno.test("T-B11-06: Auntie Anne's Pretzels blocked", () => {
  const place = basePlace({
    name: "Auntie Anne's Pretzels",
    types: ['restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B11:chain_brand:auntie_annes']);
});

Deno.test('T-B11-07: Pinkberry blocked', () => {
  const place = basePlace({
    name: 'Pinkberry',
    types: ['ice_cream_shop'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B11:chain_brand:pinkberry']);
});

Deno.test('T-B11-08: Einstein Bros Bagels blocked', () => {
  const place = basePlace({
    name: 'Einstein Bros Bagels',
    types: ['bakery'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B11:chain_brand:einstein_bros']);
});

Deno.test("T-B11-09: Nathan's Famous blocked", () => {
  const place = basePlace({
    name: "Nathan's Famous",
    types: ['restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B11:chain_brand:nathans_famous']);
});

Deno.test('T-B11-10: Greggs UK blocked', () => {
  const place = basePlace({
    name: 'Greggs',
    types: ['bakery', 'sandwich_shop'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B11:chain_brand:greggs']);
});

Deno.test('T-B11-11: Wagamama blocked by B12 (casual chain not B11)', () => {
  // wagamama is in CASUAL_CHAIN_NAME_PATTERNS not FAST_FOOD_NAME_PATTERNS.
  // B11 fires first; if no match, B12 fires.
  const place = basePlace({
    name: 'Wagamama',
    types: ['restaurant', 'asian_restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B12:casual_chain:wagamama']);
});

Deno.test('T-B11-12: Itsu UK blocked', () => {
  const place = basePlace({
    name: 'Itsu',
    types: ['restaurant', 'asian_restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B11:chain_brand:itsu']);
});

Deno.test('T-B11-13: Flunch France blocked', () => {
  const place = basePlace({
    name: 'Flunch',
    types: ['restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B11:chain_brand:flunch_france']);
});

Deno.test('T-B11-14: Vapiano Germany blocked', () => {
  const place = basePlace({
    name: 'Vapiano',
    types: ['italian_restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B11:chain_brand:vapiano']);
});

Deno.test('T-B11-15: Lizarrán Spain blocked', () => {
  const place = basePlace({
    name: 'Lizarrán',
    types: ['restaurant', 'tapas_restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B11:chain_brand:lizarran_es']);
});

Deno.test('T-B11-16: Chicken Republic Lagos blocked', () => {
  const place = basePlace({
    name: 'Chicken Republic',
    types: ['fast_food_restaurant', 'restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  // B10 fires first because primary_type=fast_food_restaurant
  assertEquals(v.reasons, ['B10:fast_food_type:fast_food_restaurant']);
});

Deno.test("T-B11-17: Mr Bigg's Lagos blocked (B11 because no fast_food primary_type)", () => {
  const place = basePlace({
    name: "Mr Bigg's",
    types: ['restaurant'],  // not fast_food_restaurant primary
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B11:chain_brand:mr_biggs_ng']);
});

Deno.test('T-B11-18 (v2 rework + v3 cleanup): "Quick" admits because pattern DROPPED', () => {
  // v2 dropped the `quick` pattern from FAST_FOOD_NAME_PATTERNS (74 false-positive
  // hits / 2 chain hits). Test was originally a REJECT assertion using the
  // (now-removed) `quick_belgium` label. v3 flips to ADMIT to match v2's drop —
  // mirrors the T-LEON-INDEPENDENT flip pattern. T-QUICK-INDEPENDENT-ADMIT
  // (v2-added) covers the explicit independent-name guard.
  const place = basePlace({
    name: 'Quick',
    types: ['restaurant'],
  });
  const v = bounce(place);
  assertEquals(
    v.is_servable,
    true,
    `v3 cleanup: "Quick" must admit after v2 dropped the pattern. Reasons: ${JSON.stringify(v.reasons)}`,
  );
});

// ───── B12 — Casual full-service chain blocklist (8 fixtures) ─────────────

Deno.test('T-B12-01: Olive Garden blocked', () => {
  const place = basePlace({
    name: 'Olive Garden',
    types: ['italian_restaurant', 'restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B12:casual_chain:olive_garden']);
});

Deno.test("T-B12-02: Applebee's blocked", () => {
  const place = basePlace({
    name: "Applebee's Grill + Bar",
    types: ['restaurant', 'american_restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B12:casual_chain:applebees']);
});

Deno.test('T-B12-03: Cheesecake Factory blocked', () => {
  const place = basePlace({
    name: 'The Cheesecake Factory',
    types: ['restaurant', 'american_restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B12:casual_chain:cheesecake_factory']);
});

Deno.test('T-B12-04: Buffalo Wild Wings blocked', () => {
  const place = basePlace({
    name: 'Buffalo Wild Wings',
    types: ['restaurant', 'sports_bar'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B12:casual_chain:buffalo_wild_wings']);
});

Deno.test('T-B12-05: Texas Roadhouse blocked', () => {
  const place = basePlace({
    name: 'Texas Roadhouse',
    types: ['restaurant', 'steak_house'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B12:casual_chain:texas_roadhouse']);
});

Deno.test('T-B12-06: California Pizza Kitchen blocked', () => {
  const place = basePlace({
    name: 'California Pizza Kitchen',
    types: ['pizza_restaurant', 'restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B12:casual_chain:california_pizza_kitchen']);
});

Deno.test("T-B12-07: P.F. Chang's blocked", () => {
  const place = basePlace({
    name: "P.F. Chang's",
    types: ['restaurant', 'asian_restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B12:casual_chain:pf_changs']);
});

Deno.test('T-B12-08: Pizza Express UK blocked', () => {
  const place = basePlace({
    name: 'Pizza Express',
    types: ['pizza_restaurant', 'italian_restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B12:casual_chain:pizza_express']);
});

// ───── Negative tests — independents survive (8 fixtures) ─────────────────

Deno.test('T-NEG-01: Pizzeria Toro independent admits', () => {
  const place = basePlace({
    name: 'Pizzeria Toro',
    types: ['pizza_restaurant', 'italian_restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `Expected admit, got reasons: ${JSON.stringify(v.reasons)}`);
});

Deno.test("T-NEG-02: Lilly's Pizza independent admits", () => {
  const place = basePlace({
    name: "Lilly's Pizza",
    types: ['pizza_restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `Expected admit, got reasons: ${JSON.stringify(v.reasons)}`);
});

Deno.test('T-NEG-03: Yellow Dog Bread Co. (artisan bakery) admits', () => {
  const place = basePlace({
    name: 'Yellow Dog Bread Co.',
    types: ['bakery'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `Expected admit, got reasons: ${JSON.stringify(v.reasons)}`);
});

Deno.test("T-NEG-04: Big Tony's Hot Dogs (independent, NOT primary fast_food_restaurant) admits", () => {
  const place = basePlace({
    name: "Big Tony's Hot Dogs",
    types: ['american_restaurant', 'restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `Expected admit, got reasons: ${JSON.stringify(v.reasons)}`);
});

Deno.test("T-NEG-05: 'The Placebo Bar' must NOT match Lagos `the place` pattern", () => {
  // Word-boundary regression: \bthe place\b should NOT match "the placebo".
  const place = basePlace({
    name: 'The Placebo Bar',
    types: ['bar'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `Expected admit, got reasons: ${JSON.stringify(v.reasons)}`);
});

Deno.test('T-NEG-06: Sublime Donuts (artisan donut shop) admits', () => {
  const place = basePlace({
    name: 'Sublime Donuts',
    types: ['donut_shop', 'bakery'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `Expected admit, got reasons: ${JSON.stringify(v.reasons)}`);
});

Deno.test('T-NEG-07: Hurts Donut (artisan, not Krispy Kreme) admits', () => {
  const place = basePlace({
    name: 'Hurts Donut',
    types: ['donut_shop'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `Expected admit, got reasons: ${JSON.stringify(v.reasons)}`);
});

Deno.test("T-NEG-08: Pizzaria Romano's must NOT false-match `pizza` chain patterns", () => {
  const place = basePlace({
    name: "Pizzaria Romano's",
    types: ['pizza_restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `Expected admit, got reasons: ${JSON.stringify(v.reasons)}`);
});

// ───── Allowlist bypass — UPSCALE_CHAIN_ALLOWLIST short-circuits B11/B12 (6) ─

Deno.test('T-ALLOW-01: The Capital Grille admits via allowlist', () => {
  const place = basePlace({
    name: 'The Capital Grille',
    types: ['fine_dining_restaurant', 'steak_house'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `Expected admit, got reasons: ${JSON.stringify(v.reasons)}`);
});

Deno.test("T-ALLOW-02: Ruth's Chris Steak House admits via allowlist", () => {
  const place = basePlace({
    name: "Ruth's Chris Steak House",
    types: ['fine_dining_restaurant', 'steak_house'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `Expected admit, got reasons: ${JSON.stringify(v.reasons)}`);
});

Deno.test('T-ALLOW-03: Hawksmoor Spitalfields admits via allowlist (D-12)', () => {
  const place = basePlace({
    name: 'Hawksmoor Spitalfields',
    types: ['steak_house', 'restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `Expected admit, got reasons: ${JSON.stringify(v.reasons)}`);
});

Deno.test('T-ALLOW-04: Cipriani 42nd Street admits via allowlist (D-12)', () => {
  const place = basePlace({
    name: 'Cipriani 42nd Street',
    types: ['italian_restaurant', 'fine_dining_restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `Expected admit, got reasons: ${JSON.stringify(v.reasons)}`);
});

Deno.test("T-ALLOW-05: Gordon Ramsay Hell's Kitchen admits via allowlist (D-12)", () => {
  const place = basePlace({
    name: "Gordon Ramsay Hell's Kitchen",
    types: ['fine_dining_restaurant', 'restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `Expected admit, got reasons: ${JSON.stringify(v.reasons)}`);
});

Deno.test("T-ALLOW-06: Houston's admits via allowlist (D-12 moved from blacklist)", () => {
  const place = basePlace({
    name: "Houston's",
    types: ['american_restaurant', 'restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `Expected admit, got reasons: ${JSON.stringify(v.reasons)}`);
});

// ───── CRITICAL REGRESSION GUARDS (D-13/D-14) — DO NOT REMOVE ─────────────

Deno.test('T-CAVA-ADMIT: CAVA Mediterranean MUST admit (D-13 operator-locked admit)', () => {
  // Operator markup 2026-05-05: REMOVED `cava ` from FAST_FOOD_NAME_PATTERNS.
  // If a future PR re-adds Cava to any blacklist, this test fails. Do NOT
  // "fix" by removing this fixture. Operator's locked decision.
  const place = basePlace({
    name: 'CAVA Mediterranean',
    types: ['restaurant', 'mediterranean_restaurant'],
  });
  const v = bounce(place);
  assertEquals(
    v.is_servable,
    true,
    `D-13 violation: CAVA Mediterranean must admit. Got reasons: ${JSON.stringify(v.reasons)}`,
  );
});

Deno.test('T-LPQ-ADMIT: Le Pain Quotidien MUST admit (D-14 operator-locked admit)', () => {
  // Operator markup 2026-05-05: REJECTED proposed addition of Le Pain Quotidien
  // to blacklist. If a future PR adds it, this test fails. Do NOT "fix" by
  // removing this fixture. Operator's locked decision.
  const place = basePlace({
    name: 'Le Pain Quotidien',
    types: ['bakery', 'restaurant'],
  });
  const v = bounce(place);
  assertEquals(
    v.is_servable,
    true,
    `D-14 violation: Le Pain Quotidien must admit. Got reasons: ${JSON.stringify(v.reasons)}`,
  );
});

Deno.test('T-CAVA-VARIANT: "Cavalry Pub" must NOT match Cava regex', () => {
  // Word-boundary regression: \bcava\b must not match within "cavalry".
  // Note: Cava is REMOVED from blacklist per D-13, so this should admit
  // regardless. But this fixture verifies the regex word-boundary is correct
  // even if a future regression re-introduces a `cava` pattern.
  const place = basePlace({
    name: 'Cavalry Pub',
    types: ['bar', 'restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `Expected admit, got reasons: ${JSON.stringify(v.reasons)}`);
});

Deno.test('T-LEON-INDEPENDENT (v2 rework): "Leon Restaurant" admits because `leon` pattern DROPPED', () => {
  // v2 rework (ORCH-0735): the standalone `\bleon\b` pattern was DROPPED from
  // FAST_FOOD_NAME_PATTERNS because it false-matched independent restaurants
  // with surname Leon (e.g., "Pupuseria Maria de Leon Bus"). After the drop,
  // any place named "Leon" admits via default bouncer rules. UK Leon chain
  // rows (~1 in pool) accepted as cost of precision protection. The
  // multi-word patterns `léon de bruxelles` / `leon de bruxelles` are
  // preserved separately — those are precise enough.
  const place = basePlace({
    name: 'Leon Restaurant',
    types: ['restaurant'],
  });
  const v = bounce(place);
  assertEquals(
    v.is_servable,
    true,
    `v2 regression: independent "Leon Restaurant" must admit. Reasons: ${JSON.stringify(v.reasons)}`,
  );
});

// ───── Pre-photo pass parity (B10/B11/B12 photo-independent) (2 fixtures) ─

Deno.test('T-PARITY-01: B10 fires identically in pre-photo pass', () => {
  const place = basePlace({
    name: 'Generic Fast Food',
    types: ['fast_food_restaurant', 'restaurant'],
    stored_photo_urls: [],  // would normally trigger B8 in final pass
  });
  const final = bounce(place);
  const pre = bounce(place, { skipStoredPhotoCheck: true });
  // B10 short-circuits in both passes — identical verdicts.
  assertEquals(final.reasons, ['B10:fast_food_type:fast_food_restaurant']);
  assertEquals(pre.reasons, ['B10:fast_food_type:fast_food_restaurant']);
  assertEquals(final.is_servable, false);
  assertEquals(pre.is_servable, false);
});

Deno.test('T-PARITY-02: B11 fires identically in pre-photo pass', () => {
  const place = basePlace({
    name: "McDonald's",
    types: ['hamburger_restaurant'],
    stored_photo_urls: [],
  });
  const final = bounce(place);
  const pre = bounce(place, { skipStoredPhotoCheck: true });
  assertEquals(final.reasons, ['B11:chain_brand:mcdonalds']);
  assertEquals(pre.reasons, ['B11:chain_brand:mcdonalds']);
});

// ───── Helper-function direct tests (3 fixtures) ──────────────────────────

Deno.test('isUpscaleChainAllowlisted — case-insensitive substring match', () => {
  assertEquals(isUpscaleChainAllowlisted('The Capital Grille'), true);
  assertEquals(isUpscaleChainAllowlisted("Ruth's Chris Steak House"), true);
  assertEquals(isUpscaleChainAllowlisted('Cipriani 42nd Street'), true);
  assertEquals(isUpscaleChainAllowlisted('Independent Bistro'), false);
  assertEquals(isUpscaleChainAllowlisted(null), false);
  assertEquals(isUpscaleChainAllowlisted(''), false);
});

Deno.test('matchFastFoodPattern — allowlist short-circuits', () => {
  // Even though "Cipriani" doesn't match a fast-food pattern, allowlist short-circuits first.
  assertEquals(matchFastFoodPattern('Cipriani 42nd Street'), null);
  // McDonald's matches and is not allowlisted → returns label.
  assertEquals(matchFastFoodPattern("McDonald's"), 'mcdonalds');
  // null/empty short-circuit.
  assertEquals(matchFastFoodPattern(null), null);
  assertEquals(matchFastFoodPattern(''), null);
});

Deno.test('matchCasualChainPattern — allowlist short-circuits', () => {
  // Allowlist bypasses B12.
  assertEquals(matchCasualChainPattern('The Capital Grille'), null);
  // Olive Garden matches and is not allowlisted.
  assertEquals(matchCasualChainPattern('Olive Garden'), 'olive_garden');
  assertEquals(matchCasualChainPattern(null), null);
});

// ───── Edge cases (2 fixtures) ─────────────────────────────────────────────

Deno.test("T-EDGE-01: empty name — B3 fires before B11 helpers can match", () => {
  // B3 short-circuits because place.name is required.
  const place = basePlace({ name: '' });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B3:missing_required_field']);
});

Deno.test('T-EDGE-02: "Starbucks at Marriott Hotel" — B11 fires', () => {
  // No B9 child-venue match (Marriott isn't in CHILD_VENUE_NAME_PATTERNS).
  // Allowlist no match. B11 catches Starbucks.
  const place = basePlace({
    name: 'Starbucks at Marriott Hotel',
    types: ['coffee_shop'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B11:chain_brand:starbucks']);
});

// ═══════════════════════════════════════════════════════════════════════════
// ORCH-0735 v2 REWORK — false-positive admit guards
// (added after dry-run surfaced collisions on `leon`/`paul`/`wasabi`/`quick`)
// ═══════════════════════════════════════════════════════════════════════════

Deno.test('T-LEON-PUPUSERIA-ADMIT (v2 rework): "Pupuseria Maria de Leon Bus" must admit', () => {
  // The `leon` pattern was DROPPED in v2 because it false-matched proper-noun
  // "Leon" inside independent restaurant names. Live evidence: Durham dry-run
  // 2026-05-05 fired B11:chain_brand:leon_uk on this exact place name.
  // If a future PR re-adds `leon` to FAST_FOOD_NAME_PATTERNS without
  // chain-context anchoring, this fixture fails. DO NOT "fix" by removing
  // this test — operator-locked admit decision.
  const place = basePlace({
    name: 'Pupuseria Maria de Leon Bus',
    types: ['mexican_restaurant', 'restaurant'],
  });
  const v = bounce(place);
  assertEquals(
    v.is_servable,
    true,
    `v2 regression: independent pupuseria with surname "Leon" must admit. Reasons: ${JSON.stringify(v.reasons)}`,
  );
});

Deno.test('T-PAUL-INDEPENDENT-ADMIT (v2 rework): "Paul and Jack" bakery must admit', () => {
  // The `paul` pattern was DROPPED in v2 — too many parks/churches/people
  // named Paul, plus independent restaurants like "Paul and Jack" bakery.
  // Live evidence: pool-wide query found 74 `paul` matches; only ~2 actual
  // Paul-chain bakeries in Brussels.
  const place = basePlace({
    name: 'Paul and Jack',
    types: ['bakery'],
  });
  const v = bounce(place);
  assertEquals(
    v.is_servable,
    true,
    `v2 regression: independent "Paul and Jack" bakery must admit. Reasons: ${JSON.stringify(v.reasons)}`,
  );
});

Deno.test('T-WASABI-INDEPENDENT-ADMIT (v2 rework): "Wasabi Sushi Lounge" admits', () => {
  // The `wasabi` pattern was DROPPED in v2 — too generic for Asian restaurant
  // names. Pool-wide query found 6 `wasabi` matches; only ~1-2 actual UK
  // Wasabi chain locations.
  const place = basePlace({
    name: 'Wasabi Sushi Lounge',
    types: ['japanese_restaurant', 'restaurant'],
  });
  const v = bounce(place);
  assertEquals(
    v.is_servable,
    true,
    `v2 regression: independent Wasabi sushi place must admit. Reasons: ${JSON.stringify(v.reasons)}`,
  );
});

Deno.test('T-QUICK-INDEPENDENT-ADMIT (v2 rework): "Quick Bites Cafe" admits', () => {
  // The `quick` pattern was DROPPED in v2 — too generic adjective. Pool-wide
  // query found 7 `quick` matches; only ~2 actual Belgian Quick chain rows.
  const place = basePlace({
    name: 'Quick Bites Cafe',
    types: ['cafe', 'restaurant'],
  });
  const v = bounce(place);
  assertEquals(
    v.is_servable,
    true,
    `v2 regression: independent "Quick Bites Cafe" must admit. Reasons: ${JSON.stringify(v.reasons)}`,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// ORCH-0735 v3 PATCH — pluralization + missing-pattern fixes
// (added after live-fire SC-16 probe surfaced 12 chain rows still admitted
//  across 9 cities post-v2 deploy 2026-05-05)
// ═══════════════════════════════════════════════════════════════════════════

// ───── v3 Reject confirmations (verify patches actually fire) ─────────────

Deno.test('T-DAIRY-QUEEN-REJECT (v3): Dairy Queen blocked by new pattern', () => {
  // v3 Change 1: ADD `dairy queen` to FAST_FOOD_NAME_PATTERNS.
  // Live evidence: SC-16 probe found 3 admitted Dairy Queen rows
  // (Baltimore, Fort Lauderdale, Raleigh) — all `ice_cream_shop` primary_type
  // so B10 didn't catch them; needs explicit name pattern.
  const place = basePlace({
    name: 'Dairy Queen',
    types: ['ice_cream_shop', 'restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B11:chain_brand:dairy_queen']);
});

Deno.test('T-PAPA-JOHNS-PLURAL-REJECT (v3): "Papa Johns Pizza" blocked by widened pattern', () => {
  // v3 Change 4: split `papa john` into `papa johns` + `papa john's`.
  // Live evidence: SC-16 probe found 2 "Papa Johns Pizza" rows admitted in
  // Raleigh — original `\bpapa john\b` failed because "ns" has no \b boundary
  // (both letters), so the bare-plural form leaked.
  const place = basePlace({
    name: 'Papa Johns Pizza',
    types: ['pizza_restaurant', 'restaurant'],
  });
  const v = bounce(place);
  assertEquals(v.is_servable, false);
  assertEquals(v.reasons, ['B11:chain_brand:papa_johns']);
});

// ───── v3 Admit-regression-guards (probe false-positives must STAY admitted) ─

Deno.test('T-PERKINS-ORCHARD-ADMIT (v3): independent "Perkins Orchard" admits', () => {
  // SC-16 probe regex caught the substring "perkins" → flagged as Perkins
  // diner-chain leak. Reality: Durham fruit orchard, no chain. We have NO
  // `perkins` pattern in any list — admits via default rules. Guard prevents
  // future PR from adding `perkins` without considering this fixture.
  const place = basePlace({
    name: 'Perkins Orchard',
    types: ['tourist_attraction', 'farm', 'park'],
    website: 'https://perkinsorchard.com',
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `v3 regression: Perkins Orchard must admit. Reasons: ${JSON.stringify(v.reasons)}`);
});

Deno.test('T-SALADELIA-DUKE-ADMIT (v3): independent café in Duke library admits', () => {
  // SC-16 probe regex caught "perkins" inside "Saladelia - Perkins Library @ Duke".
  // Reality: independent café operating inside Duke University's Perkins Library.
  // Same `perkins` no-pattern protection as T-PERKINS-ORCHARD-ADMIT.
  const place = basePlace({
    name: 'Saladelia - Perkins Library @ Duke',
    types: ['coffee_shop', 'cafe', 'restaurant'],
    website: 'https://saladelia.com',
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `v3 regression: Saladelia café must admit. Reasons: ${JSON.stringify(v.reasons)}`);
});

Deno.test('T-WELLWITHWENDY-ADMIT (v3): wellness clinic with "Wendy" in name admits', () => {
  // SC-16 probe regex caught "wendy" as Wendy's chain. Reality: "Well With Wendy"
  // is a colon-hydrotherapy / health-coaching clinic. Our `wendy's` pattern
  // (with apostrophe-s) does NOT match "Wendy" alone — admits correctly today.
  // Guard prevents future PR from adding bare `wendy` without consideration.
  const place = basePlace({
    name: 'Well With Wendy - Colon Hydrotherapy',
    types: ['wellness_center', 'health'],
    website: 'https://wellwithwendy.com',
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `v3 regression: Well With Wendy clinic must admit. Reasons: ${JSON.stringify(v.reasons)}`);
});

Deno.test('T-ROMANOS-PIZZERIA-INDIE-ADMIT (v3): independent "Romanos Pizzeria" admits', () => {
  // SC-16 probe regex caught "romanos" assuming it was Romano's Macaroni Grill.
  // Reality: independent Baltimore pizzeria. We have NO `romanos` pattern
  // (the chain "Romano's Macaroni Grill" is also not on our list). Admits
  // correctly today. Guard prevents future PR conflating the two.
  const place = basePlace({
    name: 'Romanos Pizzeria',
    types: ['pizza_restaurant', 'restaurant'],
    website: 'https://romanospizzeria-baltimore.com',
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `v3 regression: indie Romanos Pizzeria must admit. Reasons: ${JSON.stringify(v.reasons)}`);
});

Deno.test('T-SONIC-ROOM-LAGOS-ADMIT (v3): Lagos sound-room nightclub admits', () => {
  // SC-16 probe regex caught "sonic" assuming Sonic Drive-In chain. Reality:
  // SONIC ROOM LAGOS is a nightclub / sound room. Our `sonic drive` pattern
  // (multi-word) does NOT match "Sonic Room" — admits correctly today. Guard
  // prevents future PR from adding bare `sonic` without consideration.
  const place = basePlace({
    name: 'SONIC ROOM LAGOS',
    types: ['night_club', 'bar'],
    website: 'https://sonicroomlagos.com',
  });
  const v = bounce(place);
  assertEquals(v.is_servable, true, `v3 regression: Sonic Room nightclub must admit. Reasons: ${JSON.stringify(v.reasons)}`);
});
