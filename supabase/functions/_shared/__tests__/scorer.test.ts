// ORCH-0588 Slice 1 — Signal scorer + cohort unit tests
// Run: cd supabase && deno test --allow-all functions/_shared/__tests__/scorer.test.ts

import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  computeScore,
  isInCohort,
  stableHash,
  type PlaceForScoring,
  type SignalConfig,
} from '../signalScorer.ts';

// ───── Fine Dining v1.0.0 config (mirrors Migration 4 verbatim) ──────────

const FINE_DINING_CONFIG: SignalConfig = {
  min_rating: 4.0,
  min_reviews: 50,
  bypass_rating: 4.6,
  field_weights: {
    types_includes_restaurant: 30,
    types_includes_fine_dining_restaurant: 60,
    types_includes_steak_house: 30,
    types_includes_seafood_restaurant: 30,
    types_includes_sushi_restaurant: 30,
    types_includes_french_restaurant: 30,
    types_includes_italian_restaurant: 30,
    types_includes_japanese_restaurant: 30,
    serves_dinner: 30,
    reservable: 30,
    dine_in: 15,
    serves_wine: 10,
    serves_dessert: 8,
    serves_cocktails: 5,
    serves_lunch: 5,
    serves_vegetarian_food: 5,
    price_level_expensive: 25,
    price_level_very_expensive: 50,
    price_range_start_above_2500: 10,
    price_range_start_above_4500: 15,
    price_range_start_above_7000: 15,
    price_range_end_above_8000: 10,
    price_range_end_above_15000: 15,
    delivery: -20,
    takeout: -10,
    allows_dogs: -20,
    good_for_groups: -10,
    good_for_children: -15,
    serves_brunch: -5,
    types_includes_fast_food_restaurant: -40,
    types_includes_meal_takeaway: -25,
    types_includes_meal_delivery: -25,
  },
  scale: {
    rating_multiplier: 10,
    rating_cap: 50,
    reviews_log_multiplier: 5,
    reviews_cap: 25,
  },
  text_patterns: {
    summary_regex: 'fine dining|upscale|elegant|refined|tasting menu|chef|cuisine|sommelier|prix fixe|white tablecloth',
    summary_weight: 25,
    reviews_regex: 'fine dining|special occasion|anniversary|tasting|prix fixe|chef|impeccable',
    reviews_weight: 15,
    atmosphere_regex: 'candle|fireplace|wine cellar|tasting room|piano',
    atmosphere_weight: 10,
  },
  cap: 200,
  clamp_min: 0,
};

function basePlaceForScoring(overrides: Partial<PlaceForScoring> = {}): PlaceForScoring {
  return {
    rating: 4.5,
    review_count: 100,
    types: ['restaurant'],
    price_level: null,
    price_range_start_cents: null,
    price_range_end_cents: null,
    editorial_summary: null,
    generative_summary: null,
    reviews: null,
    ...overrides,
  };
}

// ───── T-06: Hard eligibility — too low rating ───────────────────────────

Deno.test('T-06: hard eligibility — rating below min_rating', () => {
  const r = computeScore(basePlaceForScoring({ rating: 3.5 }), FINE_DINING_CONFIG);
  assertEquals(r.score, 0);
  assertEquals(r.contributions._reason, 'min_rating');
});

// ───── T-07: Hard eligibility — too few reviews + rating below bypass ────

Deno.test('T-07: hard eligibility — too few reviews + below bypass_rating', () => {
  const r = computeScore(
    basePlaceForScoring({ rating: 4.1, review_count: 20 }),
    FINE_DINING_CONFIG,
  );
  assertEquals(r.score, 0);
  assertEquals(r.contributions._reason, 'min_reviews');
});

// ───── T-08: Bypass triggers when rating very high ───────────────────────

Deno.test('T-08: bypass triggers when rating >= bypass_rating', () => {
  const r = computeScore(
    basePlaceForScoring({ rating: 4.7, review_count: 20, types: ['restaurant'] }),
    FINE_DINING_CONFIG,
  );
  // Should be eligible — score > 0 (restaurant +30, rating *10 cap 50, reviews log)
  assert(r.score > 0, `expected eligible score > 0, got ${r.score}`);
  assert(r.contributions._reason !== 'min_reviews');
});

// ───── T-09: NULL field — no positive contribution ───────────────────────

Deno.test('T-09: NULL field treated as no contribution (positive)', () => {
  const r = computeScore(
    basePlaceForScoring({
      rating: 4.5, review_count: 100,
      types: ['restaurant'],
      dine_in: null, // explicit null
    }),
    FINE_DINING_CONFIG,
  );
  // dine_in weight is +15 — must NOT appear in contributions
  assertEquals(r.contributions.dine_in, undefined);
});

// ───── T-10: NULL field — no negative contribution ───────────────────────

Deno.test('T-10: NULL field treated as no contribution (negative)', () => {
  const r = computeScore(
    basePlaceForScoring({
      rating: 4.5, review_count: 100,
      types: ['restaurant'],
      delivery: null, // explicit null
    }),
    FINE_DINING_CONFIG,
  );
  // delivery weight is -20 — must NOT appear in contributions
  assertEquals(r.contributions.delivery, undefined);
});

// ───── T-11: Boolean true triggers positive weight ───────────────────────

Deno.test('T-11: boolean true triggers positive weight', () => {
  const r = computeScore(
    basePlaceForScoring({
      rating: 4.5, review_count: 100,
      types: ['restaurant'],
      reservable: true,
    }),
    FINE_DINING_CONFIG,
  );
  assertEquals(r.contributions.reservable, 30);
});

// ───── T-12: Boolean true triggers negative weight ───────────────────────

Deno.test('T-12: boolean true triggers negative weight', () => {
  const r = computeScore(
    basePlaceForScoring({
      rating: 4.5, review_count: 100,
      types: ['restaurant'],
      delivery: true,
    }),
    FINE_DINING_CONFIG,
  );
  assertEquals(r.contributions.delivery, -20);
});

// ───── T-13: Score clamps at 0 (not negative) ────────────────────────────

Deno.test('T-13: score clamps at 0 (negatives can sink but never invert)', () => {
  const r = computeScore(
    basePlaceForScoring({
      rating: 4.0, // gives +40 from rating scale
      review_count: 50, // gives +5 log10(51)*5 ≈ 8.5
      types: ['restaurant', 'fast_food_restaurant', 'meal_takeaway', 'meal_delivery'],
      // restaurant +30 + fast_food -40 + meal_takeaway -25 + meal_delivery -25 = -60
      // plus rating 40, reviews ~8.5 → total ~ -11.5 → clamps to 0
      delivery: true, takeout: true, allows_dogs: true,
      good_for_groups: true, good_for_children: true, serves_brunch: true,
    }),
    FINE_DINING_CONFIG,
  );
  assertEquals(r.score, 0);
});

// ───── T-14: Score clamps at 200 cap ─────────────────────────────────────

Deno.test('T-14: score clamps at 200 cap (max contributors)', () => {
  // Construct a place that would score way over 200 uncapped
  const r = computeScore(
    {
      rating: 5.0, review_count: 100000,
      types: [
        'restaurant', 'fine_dining_restaurant', 'steak_house',
        'italian_restaurant', 'french_restaurant',
      ],
      price_level: 'PRICE_LEVEL_VERY_EXPENSIVE',
      price_range_start_cents: 10000,
      price_range_end_cents: 20000,
      editorial_summary: 'fine dining upscale elegant tasting menu sommelier',
      generative_summary: 'refined chef cuisine prix fixe white tablecloth',
      reviews: [{ text: 'fine dining special occasion anniversary tasting prix fixe chef impeccable' }],
      reservable: true, dine_in: true,
      serves_dinner: true, serves_wine: true, serves_cocktails: true,
      serves_dessert: true, serves_lunch: true, serves_vegetarian_food: true,
    },
    FINE_DINING_CONFIG,
  );
  assertEquals(r.score, 200);
});

// ───── T-15: Capital Grille produces 200 (real Raleigh row) ─────────────

Deno.test('T-15: Capital Grille (Raleigh) caps at 200', () => {
  // Mirrors actual MCP-pulled fields from investigation Q8.
  const r = computeScore(
    {
      rating: 4.6, review_count: 2188,
      types: ['fine_dining_restaurant', 'steak_house', 'wine_bar', 'seafood_restaurant', 'bar', 'american_restaurant', 'restaurant', 'food'],
      price_level: 'PRICE_LEVEL_VERY_EXPENSIVE',
      price_range_start_cents: 10000,
      price_range_end_cents: null,
      editorial_summary: 'Outpost of the upscale steakhouse chain offers classic American fare & a clubby, refined setting.',
      generative_summary: null,
      reviews: null,
      reservable: true, dine_in: true,
      delivery: false, takeout: true,
      allows_dogs: false,
      good_for_children: true, good_for_groups: true,
      serves_dinner: true, serves_wine: true, serves_cocktails: true,
    },
    FINE_DINING_CONFIG,
  );
  assertEquals(r.score, 200);
});

// ───── T-16: Neomonde produces ~94 (Mediterranean casual) ───────────────

Deno.test('T-16: Neomonde Mediterranean (Raleigh) scores in 80-110 range', () => {
  const r = computeScore(
    {
      rating: 4.6, review_count: 4378,
      types: ['lebanese_restaurant', 'mediterranean_restaurant', 'middle_eastern_restaurant', 'vegan_restaurant', 'vegetarian_restaurant', 'restaurant', 'food'],
      price_level: 'PRICE_LEVEL_MODERATE',
      price_range_start_cents: 1000,
      price_range_end_cents: 2000,
      editorial_summary: 'Relaxed cafe with patio seating serving kebabs, hummus & other Mediterranean dishes since 1977.',
      generative_summary: null,
      reviews: null,
      reservable: false, dine_in: true,
      delivery: true, takeout: true,
      allows_dogs: false,
      good_for_children: true, good_for_groups: true,
      serves_dinner: true, serves_wine: true, serves_cocktails: false,
    },
    FINE_DINING_CONFIG,
  );
  // Hand calc: restaurant +30 + serves_dinner +30 + dine_in +15 + serves_wine +10
  // - delivery -20 - takeout -10 - good_for_groups -10 - good_for_children -15
  // + rating 4.6*10=46 + log10(4379)*5≈18.2 = ~94
  assert(r.score >= 80 && r.score <= 115, `expected 80-115, got ${r.score}`);
});

// ───── T-18: Cohort hash stable across calls ─────────────────────────────

Deno.test('T-18: isInCohort stable across calls', () => {
  const userId = '550e8400-e29b-41d4-a716-446655440000';
  const a = isInCohort(userId, 25);
  const b = isInCohort(userId, 25);
  const c = isInCohort(userId, 25);
  assertEquals(a, b);
  assertEquals(b, c);
});

Deno.test('T-18b: isInCohort 0% always false; 100% always true', () => {
  for (const id of ['user-a', 'user-b', 'user-c', '12345', 'abcdef']) {
    assertEquals(isInCohort(id, 0), false);
    assertEquals(isInCohort(id, 100), true);
  }
});

// ───── T-19: Cohort distributes uniformly ────────────────────────────────

Deno.test('T-19: isInCohort distributes ~uniformly across 1000 random userIds at pct=25', () => {
  let inCohort = 0;
  // Use deterministic synthetic ids so the test is reproducible
  for (let i = 0; i < 1000; i++) {
    const id = `synthetic-user-${i}-${i * 1234567 + 89}`;
    if (isInCohort(id, 25)) inCohort++;
  }
  // Expected ~250 ± wide tolerance for a small sample (±60)
  assert(inCohort >= 190 && inCohort <= 310, `expected ~250 ± 60, got ${inCohort}`);
});

// ───── stableHash regression ─────────────────────────────────────────────

Deno.test('stableHash — same input produces same output', () => {
  assertEquals(stableHash('test'), stableHash('test'));
  assertEquals(stableHash('user-123'), stableHash('user-123'));
});

Deno.test('stableHash — different inputs typically produce different outputs', () => {
  // Not a hard guarantee but for these 5 simple cases it should hold.
  const seen = new Set<number>();
  for (const s of ['a', 'b', 'c', 'd', 'e']) seen.add(stableHash(s));
  assert(seen.size >= 4, `expected diversity, got ${seen.size}`);
});

// ═════════════════════════════════════════════════════════════════════════════
// ORCH-0590 Slice 2 — Drinks signal tests (paper-sim anchors)
// ═════════════════════════════════════════════════════════════════════════════

const DRINKS_CONFIG: SignalConfig = {
  min_rating: 4.0,
  min_reviews: 30,
  bypass_rating: 4.6,
  field_weights: {
    types_includes_bar: 40,
    types_includes_cocktail_bar: 60,
    types_includes_wine_bar: 50,
    types_includes_brewery: 50,
    types_includes_winery: 50,
    types_includes_distillery: 50,
    types_includes_pub: 40,
    types_includes_irish_pub: 40,
    types_includes_beer_garden: 40,
    types_includes_lounge_bar: 35,
    types_includes_sports_bar: 30,
    types_includes_night_club: 30,
    serves_cocktails: 20,
    serves_wine: 10,
    serves_beer: 10,
    dine_in: 5,
    live_music: 15,
    outdoor_seating: 10,
    good_for_groups: 15,
    price_level_moderate: 5,
    price_level_expensive: 10,
    delivery: -10,
    takeout: -5,
    serves_breakfast: -10,
    types_includes_fast_food_restaurant: -40,
    types_includes_meal_takeaway: -30,
    types_includes_meal_delivery: -30,
    types_includes_chicken_wings_restaurant: -15,
  },
  scale: {
    rating_multiplier: 10,
    rating_cap: 35,
    reviews_log_multiplier: 5,
    reviews_cap: 25,
  },
  text_patterns: {
    summary_regex: 'cocktail|brewery|beer garden|wine bar|taproom|bourbon|spirits|bartender|mixology|craft beer|wine list|pub|tavern|dive bar|speakeasy',
    summary_weight: 25,
    reviews_regex: 'great cocktails|craft beer|wine selection|bartender|mixology|bourbon|whiskey|speakeasy|happy hour|best drinks',
    reviews_weight: 15,
    atmosphere_regex: 'dimly lit|vintage|prohibition|live music|rooftop|patio|fireplace',
    atmosphere_weight: 10,
  },
  cap: 200,
  clamp_min: 0,
};

// ───── T-20: drinks — Foundation (pure cocktail bar) ≥ filter_min 120 ────

Deno.test('T-20: drinks — Foundation (bar, cocktail-focused, 4.8/176) scores ≥ 120', () => {
  const r = computeScore(
    {
      rating: 4.8,
      review_count: 176,
      types: ['bar', 'point_of_interest', 'establishment'],
      price_level: null,
      price_range_start_cents: 1000,
      price_range_end_cents: null,
      editorial_summary: null,
      generative_summary: 'Popular cocktail bar with a focus on bourbon, plus other spirits and beer, offered in a dark space.',
      reviews: null,
      serves_cocktails: true,
      serves_wine: true,
      serves_beer: true,
    },
    DRINKS_CONFIG,
  );
  assert(r.score >= 120, `Foundation score=${r.score}, expected ≥120`);
});

// ───── T-21: drinks — Crawford and Son (restaurant with bar) < filter_min ──

Deno.test('T-21: drinks — Crawford and Son (american_restaurant, 4.7/1062) scores < 120', () => {
  const r = computeScore(
    {
      rating: 4.7,
      review_count: 1062,
      types: ['american_restaurant', 'restaurant', 'food', 'point_of_interest', 'establishment'],
      price_level: 'PRICE_LEVEL_EXPENSIVE',
      price_range_start_cents: 4000,
      price_range_end_cents: null,
      editorial_summary: null,
      generative_summary: 'American plates with vegetarian options served in a casual venue with a bar.',
      reviews: null,
      serves_cocktails: true,
      serves_wine: true,
      serves_beer: true,
      serves_dinner: true,
      dine_in: true,
      reservable: true,
    },
    DRINKS_CONFIG,
  );
  // Restaurant without bar/cocktail_bar type. Bare "bar" intentionally NOT in summary_regex
  // so "casual venue with a bar" does NOT get a text_weight. Scores below filter_min.
  assert(r.score < 120, `Crawford score=${r.score}, expected <120 (it's a restaurant, not a bar)`);
});

// ───── T-22: drinks — Trophy Brewing & Taproom (brewery, sparse data) ≥ 120 ──

Deno.test('T-22: drinks — Trophy Brewing & Taproom (brewery, 4.6/447, sparse) scores ≥ 120', () => {
  const r = computeScore(
    {
      rating: 4.6,
      review_count: 447,
      types: ['brewery', 'bar', 'manufacturer', 'food', 'point_of_interest', 'service', 'establishment'],
      price_level: null,
      price_range_start_cents: null,
      price_range_end_cents: null,
      editorial_summary: null,
      generative_summary: null,
      reviews: null,
      serves_beer: true,
    },
    DRINKS_CONFIG,
  );
  // brewery +50 + bar +40 + serves_beer +10 + rating 35 (cap) + log10(448)*5 ≈ 13.3 = ~148
  assert(r.score >= 120, `Trophy Taproom score=${r.score}, expected ≥120`);
});
