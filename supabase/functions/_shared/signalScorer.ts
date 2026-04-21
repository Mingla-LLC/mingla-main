// ORCH-0588 Slice 1 — Generic signal scorer (pure logic).
//
// Imported by run-signal-scorer/index.ts (Deno edge fn) and scorer.test.ts (Deno tests).
// Zero side effects, zero IO. Pure function only.
//
// Invariants:
//   I-SIGNAL-CONTINUOUS — score is always 0-200 numeric
//   I-SCORE-NON-NEGATIVE — clamps at 0; CHECK constraint at DB enforces too
//   NULL field = NO contribution (NULL ≠ false). Don't change without re-running paper sim.

export interface SignalConfig {
  min_rating: number;
  min_reviews: number;
  bypass_rating: number;
  field_weights: Record<string, number>;
  scale: {
    rating_multiplier: number;
    rating_cap: number;
    reviews_log_multiplier: number;
    reviews_cap: number;
  };
  text_patterns: {
    summary_regex?: string;
    summary_weight?: number;
    reviews_regex?: string;
    reviews_weight?: number;
    atmosphere_regex?: string;
    atmosphere_weight?: number;
  };
  cap: number;
  clamp_min: number;
}

export interface PlaceForScoring {
  id?: string;
  rating: number | null;
  review_count: number | null;
  types: string[] | null;
  price_level: string | null;
  price_range_start_cents: number | null;
  price_range_end_cents: number | null;
  editorial_summary: string | null;
  generative_summary: string | null;
  reviews: Array<{ text?: string }> | null;
  // Boolean signal fields (any of these may be null = unknown, not false)
  serves_dinner?: boolean | null;
  serves_lunch?: boolean | null;
  serves_breakfast?: boolean | null;
  serves_brunch?: boolean | null;
  serves_wine?: boolean | null;
  serves_cocktails?: boolean | null;
  serves_dessert?: boolean | null;
  serves_vegetarian_food?: boolean | null;
  reservable?: boolean | null;
  dine_in?: boolean | null;
  delivery?: boolean | null;
  takeout?: boolean | null;
  allows_dogs?: boolean | null;
  good_for_groups?: boolean | null;
  good_for_children?: boolean | null;
  outdoor_seating?: boolean | null;
  live_music?: boolean | null;
}

export interface ScoreResult {
  score: number;
  contributions: Record<string, number | string>;
}

const PRICE_LEVEL_PREFIX = 'PRICE_LEVEL_';

function computeFieldContributions(
  place: PlaceForScoring,
  fieldWeights: Record<string, number>,
): { score: number; contribs: Record<string, number> } {
  const contribs: Record<string, number> = {};
  let score = 0;

  for (const [field, weight] of Object.entries(fieldWeights)) {
    // Type membership: types_includes_<targetType>
    if (field.startsWith('types_includes_')) {
      const targetType = field.slice('types_includes_'.length);
      const types = place.types ?? [];
      if (types.includes(targetType)) {
        contribs[field] = weight;
        score += weight;
      }
      continue;
    }

    // Bucketed price level: price_level_<bucket> (lowercase) → matches PRICE_LEVEL_<BUCKET>
    if (field.startsWith('price_level_')) {
      const targetBucket = field.slice('price_level_'.length).toUpperCase();
      const placeLevel = (place.price_level ?? '').replace(PRICE_LEVEL_PREFIX, '');
      if (placeLevel === targetBucket) {
        contribs[field] = weight;
        score += weight;
      }
      continue;
    }

    // Price range start ladder: price_range_start_above_<cents>
    if (field.startsWith('price_range_start_above_')) {
      const threshold = parseInt(field.slice('price_range_start_above_'.length), 10);
      if (
        Number.isFinite(threshold) &&
        place.price_range_start_cents != null &&
        place.price_range_start_cents > threshold
      ) {
        contribs[field] = weight;
        score += weight;
      }
      continue;
    }

    // Price range end ladder: price_range_end_above_<cents>
    if (field.startsWith('price_range_end_above_')) {
      const threshold = parseInt(field.slice('price_range_end_above_'.length), 10);
      if (
        Number.isFinite(threshold) &&
        place.price_range_end_cents != null &&
        place.price_range_end_cents > threshold
      ) {
        contribs[field] = weight;
        score += weight;
      }
      continue;
    }

    // Boolean field — apply iff explicitly true. NULL = no contribution.
    const value = (place as unknown as Record<string, unknown>)[field];
    if (value === true) {
      contribs[field] = weight;
      score += weight;
    }
  }

  return { score, contribs };
}

export function computeScore(place: PlaceForScoring, config: SignalConfig): ScoreResult {
  const contribs: Record<string, number | string> = {};

  // Hard eligibility — rating gate
  if (place.rating == null || place.rating < config.min_rating) {
    return {
      score: 0,
      contributions: { _ineligible: 0, _reason: 'min_rating' },
    };
  }

  // Hard eligibility — reviews gate (with bypass for very-high rating)
  const reviewCount = place.review_count ?? 0;
  if (reviewCount < config.min_reviews && place.rating < config.bypass_rating) {
    return {
      score: 0,
      contributions: { _ineligible: 0, _reason: 'min_reviews' },
    };
  }

  let score = 0;

  // Field weights
  const fieldRes = computeFieldContributions(place, config.field_weights);
  score += fieldRes.score;
  for (const [k, v] of Object.entries(fieldRes.contribs)) contribs[k] = v;

  // Scale: rating
  const ratingScore = Math.min(
    config.scale.rating_cap,
    (place.rating ?? 0) * config.scale.rating_multiplier,
  );
  contribs._rating_scale = Math.round(ratingScore * 10) / 10;
  score += ratingScore;

  // Scale: reviews (log10)
  const reviewScore = Math.min(
    config.scale.reviews_cap,
    Math.log10(reviewCount + 1) * config.scale.reviews_log_multiplier,
  );
  contribs._reviews_scale = Math.round(reviewScore * 10) / 10;
  score += reviewScore;

  // Text patterns
  const summaryText = `${place.editorial_summary ?? ''} ${place.generative_summary ?? ''}`.toLowerCase();
  const reviewsText = (place.reviews ?? [])
    .slice(0, 5)
    .map((r) => (r?.text ?? '').toString())
    .join(' ')
    .toLowerCase();

  const tp = config.text_patterns;
  if (tp.summary_regex && tp.summary_weight && new RegExp(tp.summary_regex, 'i').test(summaryText)) {
    contribs._summary_match = tp.summary_weight;
    score += tp.summary_weight;
  }
  if (tp.reviews_regex && tp.reviews_weight && new RegExp(tp.reviews_regex, 'i').test(reviewsText)) {
    contribs._reviews_match = tp.reviews_weight;
    score += tp.reviews_weight;
  }
  if (tp.atmosphere_regex && tp.atmosphere_weight) {
    const allText = `${summaryText} ${reviewsText}`;
    if (new RegExp(tp.atmosphere_regex, 'i').test(allText)) {
      contribs._atmosphere_match = tp.atmosphere_weight;
      score += tp.atmosphere_weight;
    }
  }

  // Clamp to [clamp_min, cap]
  const finalScore = Math.max(config.clamp_min, Math.min(config.cap, score));
  return { score: finalScore, contributions: contribs };
}

// ───── Cohort hash (used by discover-cards and tests) ────────────────────

export function stableHash(s: string): number {
  // Simple 32-bit hash (FNV-like). Pure, deterministic, no DB lookups.
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0; // force 32-bit signed
  }
  return h;
}

export function isInCohort(userId: string, pct: number): boolean {
  if (!userId || pct <= 0) return false;
  if (pct >= 100) return true;
  return Math.abs(stableHash(userId)) % 100 < pct;
}
