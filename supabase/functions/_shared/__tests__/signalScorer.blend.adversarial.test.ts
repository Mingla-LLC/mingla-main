// [META-ORCH-1009 Sub-B] Tester adversarial — additional edge cases for the
// AI-blended ranker that the implementor's 11-test suite did not cover.
//
// Goals (rough verdict severity in parens):
//   T-ADV-01 (P2) — Determinism under N repeated calls: same input → same
//                   output every time (no Math.random, no Date.now, no
//                   hidden state).
//   T-ADV-02 (P1) — Veto round-trip: post-veto, the SAME input set MUST
//                   produce a non-null score when inappropriate_for flips
//                   back to false (proves un-veto path is symmetric).
//   T-ADV-03 (P1) — NaN AI score is sanitized to 0 (not NaN propagating
//                   into place_scores.score and violating CHECK 0–200).
//   T-ADV-04 (P1) — Infinity AI score is clamped to 100.
//   T-ADV-05 (P2) — Non-numeric (string) AI score short-circuits to 0,
//                   not "0+NaN" propagation.
//   T-ADV-06 (P2) — Floating-point weights summing past 1.0 still clamp
//                   the final score into [0, cap]. (cap=200 guard.)
//   T-ADV-07 (P3) — Reasoning over 200 chars is correctly snippet-trimmed
//                   in contributions._ai_reasoning AND fully present in
//                   vetoed.ai_reasoning.
//   T-ADV-08 (P1) — `inappropriate_for: 'true'` (STRING) does NOT fire
//                   veto (strict === true required per signalScorer.ts).
//   T-ADV-09 (P2) — `prompt_version: 'V4'` (different case) does NOT
//                   match `expected_prompt_version: 'v4'` — case sensitivity
//                   is intentional per the discriminator.
//   T-ADV-10 (P2) — clamp_min floor is honored on the blended path —
//                   blends below clamp_min get raised to clamp_min.
//
// Run: deno test --allow-read --no-check \
//   supabase/functions/_shared/__tests__/signalScorer.blend.adversarial.test.ts

import {
  assert,
  assertEquals,
  assertAlmostEquals,
} from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  computeScore,
  DEFAULT_AI_BLEND_WEIGHT,
  DEFAULT_EXPECTED_PROMPT_VERSION,
  type AiSignalEntry,
  type PlaceForScoring,
  type SignalConfig,
} from '../signalScorer.ts';

const BASE_CONFIG: SignalConfig = {
  min_rating: 4.0,
  min_reviews: 50,
  bypass_rating: 4.6,
  field_weights: { serves_dinner: 30, reservable: 30, serves_wine: 10 },
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

function basePlace(extra: Partial<PlaceForScoring> = {}): PlaceForScoring {
  return {
    id: 'adv-fixture-001',
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
    ...extra,
  };
}

function aiEntry(extra: Partial<AiSignalEntry> = {}): AiSignalEntry {
  return {
    score_0_to_100: 80,
    inappropriate_for: false,
    reasoning: 'baseline reasoning',
    evaluated_at: '2026-05-30T00:00:00.000Z',
    prompt_version: DEFAULT_EXPECTED_PROMPT_VERSION,
    model: 'gemini-2.5-flash',
    ...extra,
  };
}

// ─── T-ADV-01: determinism under repeated calls ─────────────────────────

Deno.test('T-ADV-01: 100 repeated calls produce byte-identical results', () => {
  const place = basePlace({
    ai_signal_scores: { romantic: aiEntry({ score_0_to_100: 70 }) },
  });
  const config = { ...BASE_CONFIG, expected_prompt_version: 'v4', ai_blend_weight: 0.6 };
  const first = computeScore(place, config, 'romantic');
  for (let i = 0; i < 100; i++) {
    const next = computeScore(place, config, 'romantic');
    assertEquals(next.score, first.score, `call ${i} diverged`);
    assertEquals(next.ai_blended?.weight_used, first.ai_blended?.weight_used);
    assertEquals(next.ai_blended?.ai_score_0_to_100, first.ai_blended?.ai_score_0_to_100);
  }
});

// ─── T-ADV-02: veto round-trip — flipping inappropriate_for false re-emits ──

Deno.test('T-ADV-02: un-veto round trip — flipping inappropriate_for false re-emits a numeric score', () => {
  const config = { ...BASE_CONFIG, expected_prompt_version: 'v4', ai_blend_weight: 0.6 };
  // Veto pass
  const vetoed = computeScore(
    basePlace({
      ai_signal_scores: {
        movies: aiEntry({ inappropriate_for: true, score_0_to_100: 0 }),
      },
    }),
    config,
    'movies',
  );
  assertEquals(vetoed.score, null);
  assert(vetoed.vetoed, 'first pass should be vetoed');

  // Same shape, inappropriate_for flipped → must produce a numeric score
  const unvetoed = computeScore(
    basePlace({
      ai_signal_scores: {
        movies: aiEntry({ inappropriate_for: false, score_0_to_100: 50 }),
      },
    }),
    config,
    'movies',
  );
  assert(typeof unvetoed.score === 'number', 'un-veto must produce numeric score');
  assertEquals(unvetoed.vetoed, undefined);
  assert(unvetoed.ai_blended, 'un-veto must populate ai_blended');
});

// ─── T-ADV-03: NaN AI score sanitized to 0 ──────────────────────────────

Deno.test('T-ADV-03: NaN AI score is sanitized to 0 (no NaN propagation to place_scores)', () => {
  const place = basePlace({
    ai_signal_scores: {
      // NaN cast to number; signalScorer's `Number(x) || 0` guard handles this.
      romantic: aiEntry({ score_0_to_100: Number.NaN }),
    },
  });
  const config = { ...BASE_CONFIG, expected_prompt_version: 'v4', ai_blend_weight: 0.6 };
  const result = computeScore(place, config, 'romantic');
  assert(typeof result.score === 'number', 'score must be numeric, not NaN');
  assert(!Number.isNaN(result.score as number), 'score must not be NaN');
  assertEquals(result.ai_blended?.ai_score_0_to_100, 0, 'NaN sanitized to 0');
});

// ─── T-ADV-04: Infinity AI score clamped to 100 ────────────────────────

Deno.test('T-ADV-04: Infinity AI score is clamped to 100 (max), then blended', () => {
  const place = basePlace({
    ai_signal_scores: { romantic: aiEntry({ score_0_to_100: Number.POSITIVE_INFINITY }) },
  });
  const config = { ...BASE_CONFIG, expected_prompt_version: 'v4', ai_blend_weight: 1.0 };
  const result = computeScore(place, config, 'romantic');
  // w=1 → blended_norm = ai = 100; rescaled = 200; clamped to cap=200
  assertAlmostEquals(result.score as number, 200, 0.001);
  assertEquals(result.ai_blended?.ai_score_0_to_100, 100);
});

// ─── T-ADV-05: string AI score short-circuits to 0 ─────────────────────

Deno.test('T-ADV-05: non-numeric (string) AI score is sanitized to 0 via Number() || 0', () => {
  const place = basePlace({
    ai_signal_scores: {
      // Bypass strict typing — simulate a malformed JSONB entry from upstream.
      romantic: aiEntry({ score_0_to_100: 'not-a-number' as unknown as number }),
    },
  });
  const config = { ...BASE_CONFIG, expected_prompt_version: 'v4', ai_blend_weight: 0.6 };
  const result = computeScore(place, config, 'romantic');
  assert(typeof result.score === 'number');
  assert(!Number.isNaN(result.score as number));
  assertEquals(result.ai_blended?.ai_score_0_to_100, 0);
});

// ─── T-ADV-06: weight=1 + AI=100 + cap=200 — final clamp into [0, cap] ──

Deno.test('T-ADV-06: blended value never exceeds config.cap, even with extreme inputs', () => {
  const place = basePlace({
    ai_signal_scores: { romantic: aiEntry({ score_0_to_100: 100 }) },
  });
  const config = { ...BASE_CONFIG, cap: 150, expected_prompt_version: 'v4', ai_blend_weight: 1.0 };
  const result = computeScore(place, config, 'romantic');
  // w=1, ai=100 → rescaled = 200 → clamped to cap=150
  assertEquals(result.score, 150, 'final must be clamped to config.cap');
});

// ─── T-ADV-07: long reasoning snippet trimmed in contributions ─────────

Deno.test('T-ADV-07: reasoning >200 chars trimmed in contributions._ai_reasoning, full text in vetoed.ai_reasoning', () => {
  const longText = 'X'.repeat(500);
  const place = basePlace({
    ai_signal_scores: {
      movies: aiEntry({ inappropriate_for: true, reasoning: longText }),
    },
  });
  const config = { ...BASE_CONFIG, expected_prompt_version: 'v4' };
  const result = computeScore(place, config, 'movies');
  assertEquals(result.score, null);
  assert(result.vetoed, 'must be vetoed');
  assertEquals(result.vetoed!.ai_reasoning.length, 500, 'vetoed sentinel preserves full text');
  const snippet = result.contributions._ai_reasoning as string;
  assert(typeof snippet === 'string');
  assert(snippet.length <= 200, `contributions snippet must be ≤200 chars, got ${snippet.length}`);
});

// ─── T-ADV-08: STRING "true" inappropriate_for does NOT fire veto ──────

Deno.test('T-ADV-08: string "true" inappropriate_for does NOT fire veto (strict === true required)', () => {
  const place = basePlace({
    ai_signal_scores: {
      // Simulate JSONB coercion glitch — boolean-as-string sneaks in.
      romantic: aiEntry({ inappropriate_for: 'true' as unknown as boolean, score_0_to_100: 80 }),
    },
  });
  const config = { ...BASE_CONFIG, expected_prompt_version: 'v4', ai_blend_weight: 0.6 };
  const result = computeScore(place, config, 'romantic');
  // Must NOT veto on truthy-but-not-=== values — that would over-veto and
  // delete real rows. Scorer must follow the JSONB shape contract strictly.
  assertEquals(result.vetoed, undefined);
  assert(typeof result.score === 'number', 'string "true" must not vetoize');
  assert(result.ai_blended, 'must still blend AI');
});

// ─── T-ADV-09: case-sensitive prompt_version match ─────────────────────

Deno.test('T-ADV-09: prompt_version case mismatch (V4 vs v4) → rule-only fallback', () => {
  const place = basePlace({
    ai_signal_scores: { romantic: aiEntry({ prompt_version: 'V4', score_0_to_100: 80 }) },
  });
  const config = { ...BASE_CONFIG, expected_prompt_version: 'v4', ai_blend_weight: 0.6 };
  const result = computeScore(place, config, 'romantic');
  assertEquals(result.ai_blended, undefined, 'case mismatch must fall back to rule-only');
});

// ─── T-ADV-10: clamp_min raises blends below floor ─────────────────────

Deno.test('T-ADV-10: blended score below clamp_min is raised to clamp_min', () => {
  const place = basePlace({
    ai_signal_scores: { romantic: aiEntry({ score_0_to_100: 0 }) },
  });
  const config = {
    ...BASE_CONFIG,
    clamp_min: 50,
    expected_prompt_version: 'v4',
    ai_blend_weight: 1.0, // ai-only path
  };
  const result = computeScore(place, config, 'romantic');
  // w=1, ai=0 → rescaled=0 → raised by clamp_min to 50
  assertEquals(result.score, 50, 'clamp_min must raise sub-floor blends');
});
