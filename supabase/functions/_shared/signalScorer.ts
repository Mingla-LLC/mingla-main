// ORCH-0588 Slice 1 — Generic signal scorer (pure logic).
// META-ORCH-1009 Sub-B — extended to blend a Gemini Q2 AI score on top of the
// rule score and apply Gemini's `inappropriate_for` hard veto. AI input is the
// per-signal slice of place_pool.ai_signal_scores, the canonical 6-key shape
// pinned by I-AI-SIGNAL-SCORES-SHAPE-CONTRACT. Gemini 2.5 Flash structured-
// output contract per COMMS-0003:
//   https://ai.google.dev/gemini-api/docs/models/gemini#gemini-2.5-flash
//   https://ai.google.dev/gemini-api/docs/structured-output
//
// Imported by run-signal-scorer/index.ts (Deno edge fn) and scorer.test.ts (Deno tests).
// Zero side effects, zero IO. Pure function only.
//
// Invariants:
//   I-SIGNAL-CONTINUOUS — score is always 0-200 numeric (when non-veto)
//   I-SCORE-NON-NEGATIVE — clamps at 0; CHECK constraint at DB enforces too
//   I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED — AI is ignored on prompt_version drift
//   NULL field = NO contribution (NULL ≠ false). Don't change without re-running paper sim.

// META-ORCH-1009 Sub-B — single source of truth for the expected Gemini Q2 prompt version.
// Override per-signal via signal_definition_versions.config.expected_prompt_version JSONB key.
export const DEFAULT_EXPECTED_PROMPT_VERSION = 'v4';

// META-ORCH-1009 Sub-B — default AI blend weight when signal_definition_versions.config
// omits `ai_blend_weight`. 0.6 = favor AI (operator-locked default per research §9 Q3).
// 0.0 = rule-only, 1.0 = AI-only. Always clamped to [0, 1] at apply-time.
export const DEFAULT_AI_BLEND_WEIGHT = 0.6;

// META-ORCH-1009 Sub-B — rule-score normalization divisor. The rule scorer clamps
// to [0, cap] where cap is per-signal but every shipped signal uses cap=200 (verified
// across all signal_definition_versions.config rows). Rescaling the blend back to
// [0, 200] preserves the existing CATEGORY_TO_SIGNAL.filterMin thresholds (100, 120,
// 80) in discover-cards so we don't have to re-tune them in lockstep.
export const RULE_SCORE_MAX_NORMALIZED = 200;

export interface AiSignalEntry {
  score_0_to_100: number;
  inappropriate_for: boolean;
  reasoning: string;
  evaluated_at: string;
  prompt_version: string;
  model: string;
}

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
  // META-ORCH-1009 Sub-B — per-signal-version override for the expected Gemini
  // prompt version. Absent → DEFAULT_EXPECTED_PROMPT_VERSION ('v4').
  expected_prompt_version?: string;
  // META-ORCH-1009 Sub-B — per-signal-version blend weight 0.0–1.0.
  // Absent → DEFAULT_AI_BLEND_WEIGHT (0.6). 0 = rule-only, 1 = AI-only.
  ai_blend_weight?: number;
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
  // META-ORCH-1009 Sub-B — per-place Gemini Q2 evaluation slice. Top-level keys are
  // signal_ids; each value is the canonical 6-key shape pinned by Sub-A's
  // I-AI-SIGNAL-SCORES-SHAPE-CONTRACT. Populated by run-place-intelligence-trial
  // into place_pool.ai_signal_scores. null/undefined when the place is unevaluated
  // (graceful degrade to rule-only — Sub-C is backfilling coverage in parallel).
  ai_signal_scores?: Record<string, AiSignalEntry> | null;
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
  // META-ORCH-1009 Sub-B — `null` means Gemini vetoed this (place, signal) pair
  // via `inappropriate_for=true`. The run-signal-scorer caller MUST delete any
  // existing place_scores row for the (place_id, signal_id) pair on null so the
  // RPC JOIN excludes it (place_scores.score is NOT NULL in DDL, so we use
  // row-absence instead of NULL sentinel — see deviation note in IMPLEMENTATION
  // report).
  score: number | null;
  contributions: Record<string, number | string>;
  // META-ORCH-1009 Sub-B — set when AI was present, version-matched, non-veto.
  // Lets run-signal-scorer log + admin inspector see what fed the blend.
  ai_blended?: {
    ai_score_0_to_100: number;
    rule_score_normalized: number;
    weight_used: number;
    prompt_version: string;
    // META-ORCH-1009 Sub-D — passthrough of aiEntry.evaluated_at so the caller
    // (run-signal-scorer/index.ts) can stamp `place_scores.ai_signal_scores_at`
    // on every write. The 15-min Sub-D cron compares this timestamp against
    // the live AI slice to detect stale (place, signal) pairs. See
    // I-AI-SCORE-STALENESS-AUTO-RECOVERED.
    evaluated_at: string;
  };
  // META-ORCH-1009 Sub-B — set when AI veto fired. Causes caller to delete
  // place_scores row for this (place, signal).
  vetoed?: {
    reason: 'inappropriate_for';
    ai_reasoning: string;
  };
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

export function computeScore(
  place: PlaceForScoring,
  config: SignalConfig,
  // META-ORCH-1009 Sub-B — REQUIRED 3rd arg. Used to look up
  // place.ai_signal_scores[signalId] for the AI blend + veto. Existing call
  // sites updated in lockstep (run-signal-scorer/index.ts + scorer.test.ts).
  signalId: string,
): ScoreResult {
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
  // ORCH-0598.12 fix: Google Places v1 returns reviews[i].text as an object
  // {text: "...", languageCode: "en"}, not a plain string. Before this fix the
  // extractor ran `(r?.text ?? '').toString()` which produced "[object Object]"
  // and reviews_regex.test() never matched ANY review content across ANY signal.
  // Handle both shapes (v1 object and legacy plain string) so reviews-based
  // scoring actually works.
  const reviewsText = (place.reviews ?? [])
    .slice(0, 5)
    .map((r) => {
      const t: unknown = r?.text;
      if (typeof t === 'string') return t;
      if (t && typeof t === 'object' && 'text' in t) {
        const inner = (t as { text?: unknown }).text;
        return typeof inner === 'string' ? inner : '';
      }
      return '';
    })
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
  const ruleScore = Math.max(config.clamp_min, Math.min(config.cap, score));

  // ─── META-ORCH-1009 Sub-B — AI blend + veto ─────────────────────────────
  // Pure read of place.ai_signal_scores[signalId]. No I/O. No request-time
  // randomness. Determinism for collab decks is preserved by design — this
  // function is called offline by run-signal-scorer and the blended value
  // lands in place_scores.score, which the RPCs ORDER BY at request time.
  // I-COLLAB-DECK-DETERMINISM-PRESERVED-UNDER-AI-BLEND authority.
  const aiEntry = place.ai_signal_scores?.[signalId] ?? null;
  const expectedVersion = config.expected_prompt_version ?? DEFAULT_EXPECTED_PROMPT_VERSION;

  // Version discriminator (I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED):
  // mismatch → ignore AI entirely, fall back to rule-only.
  if (!aiEntry || aiEntry.prompt_version !== expectedVersion) {
    return { score: ruleScore, contributions: contribs };
  }

  // Hard veto (research §9 Q4): operator chose hard veto over soft penalty.
  // Returning null tells the caller to DELETE any existing place_scores row
  // for this (place, signal) — see ScoreResult.score comment.
  if (aiEntry.inappropriate_for === true) {
    const reasonSnippet = typeof aiEntry.reasoning === 'string'
      ? aiEntry.reasoning.slice(0, 200)
      : '';
    return {
      score: null,
      contributions: {
        ...contribs,
        _ai_vetoed: 1,
        _ai_reasoning: reasonSnippet,
      },
      vetoed: { reason: 'inappropriate_for', ai_reasoning: aiEntry.reasoning ?? '' },
    };
  }

  // Blend: (1 - w) * rule + w * ai on the shared 0–100 scale, then rescale
  // back to [0, RULE_SCORE_MAX_NORMALIZED] so the existing CATEGORY_TO_SIGNAL
  // filter_min thresholds keep working without coordinated re-tuning.
  const rawW = typeof config.ai_blend_weight === 'number' ? config.ai_blend_weight : DEFAULT_AI_BLEND_WEIGHT;
  const w = Math.max(0, Math.min(1, rawW));
  const ruleNormalized = (ruleScore / RULE_SCORE_MAX_NORMALIZED) * 100;
  const aiScore = Math.max(0, Math.min(100, Number(aiEntry.score_0_to_100) || 0));
  const blendedNormalized = (1 - w) * ruleNormalized + w * aiScore;
  const blended = (blendedNormalized / 100) * RULE_SCORE_MAX_NORMALIZED;
  // Re-clamp into [clamp_min, cap] for the DB CHECK constraint safety net.
  const finalBlended = Math.max(config.clamp_min, Math.min(config.cap, blended));

  return {
    score: finalBlended,
    contributions: {
      ...contribs,
      _ai_blended: 1,
      _ai_weight: w,
      _ai_score: aiScore,
      _rule_score_pre_blend: ruleScore,
    },
    ai_blended: {
      ai_score_0_to_100: aiScore,
      rule_score_normalized: ruleNormalized,
      weight_used: w,
      prompt_version: aiEntry.prompt_version,
      // META-ORCH-1009 Sub-D — passthrough so run-signal-scorer can stamp
      // place_scores.ai_signal_scores_at on the upsert.
      evaluated_at: aiEntry.evaluated_at,
    },
  };
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
