// META-ORCH-1009 Sub-B — AI blend + inappropriate_for veto + prompt_version
// discriminator unit tests for `computeScore`.
//
// Run: cd supabase && deno test --allow-all functions/_shared/__tests__/signalScorer.blend.test.ts
//
// Test coverage map (SPEC §4.1):
//   T-B1  AI present + version-matched + non-veto → blended (math correctness)
//   T-B2  AI present + inappropriate_for=true → null score (veto)
//   T-B3  AI absent (null/missing) → rule-only result
//   T-B4  AI present + prompt_version mismatch → rule-only (DISCRIMINATOR enforcement)
//   T-B5  ai_blend_weight=0 → rule-only path through blend formula
//   T-B6  expected_prompt_version absent in config → DEFAULT_EXPECTED_PROMPT_VERSION used
//   T-B7  ai_blend_weight=1 → AI-only (with rule normalization preserved)
//   T-B8  weight clamping outside [0,1] is normalized at apply-time
//
// Gemini Q2 score shape pinned by I-AI-SIGNAL-SCORES-SHAPE-CONTRACT (Sub-A);
// model + structured-output contract documented at:
//   https://ai.google.dev/gemini-api/docs/models/gemini#gemini-2.5-flash
//   https://ai.google.dev/gemini-api/docs/structured-output

import { assertEquals, assert, assertAlmostEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  computeScore,
  DEFAULT_EXPECTED_PROMPT_VERSION,
  DEFAULT_AI_BLEND_WEIGHT,
  RULE_SCORE_MAX_NORMALIZED,
  type AiSignalEntry,
  type PlaceForScoring,
  type SignalConfig,
} from '../signalScorer.ts';

// ─── Shared fixtures ─────────────────────────────────────────────────────

const ROMANTIC_CONFIG_BASE: SignalConfig = {
  min_rating: 4.0,
  min_reviews: 50,
  bypass_rating: 4.6,
  field_weights: {
    serves_dinner: 30,
    reservable: 30,
    serves_wine: 10,
  },
  scale: {
    rating_multiplier: 10,
    rating_cap: 50,
    reviews_log_multiplier: 5,
    reviews_cap: 25,
  },
  text_patterns: {},
  cap: 200,
  clamp_min: 0,
};

function basePlace(overrides: Partial<PlaceForScoring> = {}): PlaceForScoring {
  return {
    id: 'fixture-place-001',
    rating: 4.5,
    review_count: 100,
    types: ['restaurant'],
    price_level: null,
    price_range_start_cents: null,
    price_range_end_cents: null,
    editorial_summary: null,
    generative_summary: null,
    reviews: null,
    serves_dinner: true,
    reservable: true,
    serves_wine: true,
    ...overrides,
  };
}

function aiEntry(overrides: Partial<AiSignalEntry> = {}): AiSignalEntry {
  return {
    score_0_to_100: 80,
    inappropriate_for: false,
    reasoning: 'Test reasoning — intimate booth seating, candle-lit, curated wine list.',
    evaluated_at: '2026-05-08T08:09:50.856Z',
    prompt_version: DEFAULT_EXPECTED_PROMPT_VERSION,
    model: 'gemini-2.5-flash',
    ...overrides,
  };
}

// Compute the rule-only score for a given place + config (i.e. what the pre-
// Sub-B scorer returned). Used as a reference value in the blend tests.
function ruleOnlyReference(place: PlaceForScoring, config: SignalConfig): number {
  const result = computeScore({ ...place, ai_signal_scores: null }, config, 'romantic');
  if (typeof result.score !== 'number') {
    throw new Error('ruleOnlyReference produced a non-numeric score — fixture is inconsistent');
  }
  return result.score;
}

// ─── T-B1: AI present + version-matched + non-veto → blended ────────────

Deno.test('T-B1: blend formula — AI=80, w=0.6, rule pre-computed → exact math', () => {
  const place = basePlace({
    ai_signal_scores: {
      romantic: aiEntry({ score_0_to_100: 80, prompt_version: 'v4' }),
    },
  });
  const config: SignalConfig = {
    ...ROMANTIC_CONFIG_BASE,
    expected_prompt_version: 'v4',
    ai_blend_weight: 0.6,
  };

  // Get the rule score for this exact fixture (zero AI input).
  const ruleScore = ruleOnlyReference(place, config);
  // Reference algorithm (mirror of signalScorer):
  const ruleNormalized = (ruleScore / RULE_SCORE_MAX_NORMALIZED) * 100;
  const expectedBlendedNormalized = 0.4 * ruleNormalized + 0.6 * 80;
  const expectedBlended = (expectedBlendedNormalized / 100) * RULE_SCORE_MAX_NORMALIZED;

  const result = computeScore(place, config, 'romantic');
  assertAlmostEquals(result.score as number, expectedBlended, 0.001);
  assert(result.ai_blended, 'ai_blended should be populated');
  assertEquals(result.ai_blended!.weight_used, 0.6);
  assertEquals(result.ai_blended!.ai_score_0_to_100, 80);
  assertEquals(result.ai_blended!.prompt_version, 'v4');
  assertAlmostEquals(result.ai_blended!.rule_score_normalized, ruleNormalized, 0.001);
  assertEquals(result.contributions._ai_blended, 1);
  assertEquals(result.contributions._ai_weight, 0.6);
  assertEquals(result.contributions._ai_score, 80);
});

// ─── T-B2: AI present + inappropriate_for=true → null score (veto) ──────

Deno.test('T-B2: hard veto — inappropriate_for=true → score=null', () => {
  const place = basePlace({
    ai_signal_scores: {
      movies: aiEntry({
        score_0_to_100: 0,
        inappropriate_for: true,
        reasoning: 'This establishment is a sushi restaurant, not a cinema.',
        prompt_version: 'v4',
      }),
    },
  });
  const config: SignalConfig = { ...ROMANTIC_CONFIG_BASE, expected_prompt_version: 'v4' };

  const result = computeScore(place, config, 'movies');
  assertEquals(result.score, null);
  assert(result.vetoed, 'vetoed sentinel must be set');
  assertEquals(result.vetoed!.reason, 'inappropriate_for');
  assert(result.vetoed!.ai_reasoning.includes('sushi restaurant'));
  assertEquals(result.contributions._ai_vetoed, 1);
  assert(typeof result.contributions._ai_reasoning === 'string');
  // Reasoning snippet capped at 200 chars
  assert((result.contributions._ai_reasoning as string).length <= 200);
});

// ─── T-B3: AI absent → rule-only ────────────────────────────────────────

Deno.test('T-B3: AI absent (null) → result equals rule-only score', () => {
  const place = basePlace({ ai_signal_scores: null });
  const config: SignalConfig = { ...ROMANTIC_CONFIG_BASE, expected_prompt_version: 'v4' };

  const result = computeScore(place, config, 'romantic');
  const ruleScore = ruleOnlyReference(place, config);
  assertEquals(result.score, ruleScore);
  assertEquals(result.ai_blended, undefined);
  assertEquals(result.vetoed, undefined);
  // No _ai_blended / _ai_vetoed contribution markers
  assertEquals(result.contributions._ai_blended, undefined);
  assertEquals(result.contributions._ai_vetoed, undefined);
});

Deno.test('T-B3b: AI signal map present but key missing → rule-only', () => {
  const place = basePlace({
    ai_signal_scores: {
      // Has fine_dining but not romantic
      fine_dining: aiEntry({ score_0_to_100: 70, prompt_version: 'v4' }),
    },
  });
  const config: SignalConfig = { ...ROMANTIC_CONFIG_BASE, expected_prompt_version: 'v4' };

  const result = computeScore(place, config, 'romantic');
  const ruleScore = ruleOnlyReference(place, config);
  assertEquals(result.score, ruleScore);
  assertEquals(result.ai_blended, undefined);
});

// ─── T-B4: prompt_version mismatch → DISCRIMINATOR enforcement ──────────

Deno.test('T-B4: I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED — v3 entry with v4 expected → ignored', () => {
  const place = basePlace({
    ai_signal_scores: {
      romantic: aiEntry({ score_0_to_100: 80, prompt_version: 'v3' }),
    },
  });
  const config: SignalConfig = { ...ROMANTIC_CONFIG_BASE, expected_prompt_version: 'v4' };

  const result = computeScore(place, config, 'romantic');
  const ruleScore = ruleOnlyReference(place, config);
  assertEquals(result.score, ruleScore);
  assertEquals(result.ai_blended, undefined);
  assertEquals(result.contributions._ai_blended, undefined);
});

Deno.test('T-B4b: veto with prompt_version mismatch does NOT fire (discriminator runs first)', () => {
  const place = basePlace({
    ai_signal_scores: {
      movies: aiEntry({
        score_0_to_100: 0,
        inappropriate_for: true,
        prompt_version: 'v3',
      }),
    },
  });
  const config: SignalConfig = { ...ROMANTIC_CONFIG_BASE, expected_prompt_version: 'v4' };

  const result = computeScore(place, config, 'movies');
  // Veto must NOT fire — discriminator rejected the entry first.
  assertEquals(result.vetoed, undefined);
  assert(typeof result.score === 'number', 'score should be the rule-only result, not null');
});

// ─── T-B5: ai_blend_weight=0 → rule-only path ───────────────────────────

Deno.test('T-B5: ai_blend_weight=0 → blend yields ruleNormalized rescaled = original rule score', () => {
  const place = basePlace({
    ai_signal_scores: {
      romantic: aiEntry({ score_0_to_100: 80, prompt_version: 'v4' }),
    },
  });
  const config: SignalConfig = {
    ...ROMANTIC_CONFIG_BASE,
    expected_prompt_version: 'v4',
    ai_blend_weight: 0,
  };

  const result = computeScore(place, config, 'romantic');
  const ruleScore = ruleOnlyReference(place, config);
  // (1-0)*ruleNormalized + 0*80 = ruleNormalized; rescaled = ruleScore.
  assertAlmostEquals(result.score as number, ruleScore, 0.001);
  assert(result.ai_blended, 'ai_blended still populated to record the blend ran');
  assertEquals(result.ai_blended!.weight_used, 0);
});

// ─── T-B6: expected_prompt_version absent → default used ────────────────

Deno.test('T-B6: config without expected_prompt_version uses DEFAULT_EXPECTED_PROMPT_VERSION', () => {
  assertEquals(DEFAULT_EXPECTED_PROMPT_VERSION, 'v4', 'sanity: default is v4');
  const place = basePlace({
    ai_signal_scores: {
      romantic: aiEntry({ score_0_to_100: 80, prompt_version: 'v4' }),
    },
  });
  // No expected_prompt_version, no ai_blend_weight set on config
  const config: SignalConfig = { ...ROMANTIC_CONFIG_BASE };

  const result = computeScore(place, config, 'romantic');
  assert(result.ai_blended, 'AI must be blended — default version matches v4');
  assertEquals(result.ai_blended!.weight_used, DEFAULT_AI_BLEND_WEIGHT);
});

// ─── T-B7: ai_blend_weight=1 → AI-only with rule normalization preserved ─

Deno.test('T-B7: ai_blend_weight=1 → blended value driven entirely by AI score', () => {
  const place = basePlace({
    ai_signal_scores: {
      romantic: aiEntry({ score_0_to_100: 80, prompt_version: 'v4' }),
    },
  });
  const config: SignalConfig = {
    ...ROMANTIC_CONFIG_BASE,
    expected_prompt_version: 'v4',
    ai_blend_weight: 1.0,
  };

  const result = computeScore(place, config, 'romantic');
  // ai-only rescaled = (80/100)*200 = 160
  assertAlmostEquals(result.score as number, 160, 0.001);
  assertEquals(result.ai_blended!.weight_used, 1.0);
});

// ─── T-B8: weight clamping ──────────────────────────────────────────────

Deno.test('T-B8: ai_blend_weight outside [0,1] is clamped at apply-time', () => {
  const place = basePlace({
    ai_signal_scores: {
      romantic: aiEntry({ score_0_to_100: 80, prompt_version: 'v4' }),
    },
  });
  const configHigh: SignalConfig = {
    ...ROMANTIC_CONFIG_BASE,
    expected_prompt_version: 'v4',
    ai_blend_weight: 2.0, // > 1 → clamp to 1
  };
  const resultHigh = computeScore(place, configHigh, 'romantic');
  assertEquals(resultHigh.ai_blended!.weight_used, 1);

  const configNeg: SignalConfig = {
    ...ROMANTIC_CONFIG_BASE,
    expected_prompt_version: 'v4',
    ai_blend_weight: -0.5, // < 0 → clamp to 0
  };
  const resultNeg = computeScore(place, configNeg, 'romantic');
  assertEquals(resultNeg.ai_blended!.weight_used, 0);
});

// ─── Bonus: ineligible places still return early, AI never consulted ─────

Deno.test('T-B9: hard rule eligibility precedes blend — AI not even read on rating<min', () => {
  const place = basePlace({
    rating: 3.5, // below min_rating
    ai_signal_scores: {
      romantic: aiEntry({ score_0_to_100: 100, prompt_version: 'v4' }),
    },
  });
  const config: SignalConfig = { ...ROMANTIC_CONFIG_BASE, expected_prompt_version: 'v4' };

  const result = computeScore(place, config, 'romantic');
  assertEquals(result.score, 0);
  assertEquals(result.contributions._reason, 'min_rating');
  assertEquals(result.ai_blended, undefined);
  assertEquals(result.vetoed, undefined);
});
