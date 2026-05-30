// META-ORCH-1009 Sub-D — verifies `computeScore` threads aiEntry.evaluated_at
// through to the returned `ai_blended.evaluated_at` field so the upstream
// caller (run-signal-scorer/index.ts) can stamp place_scores.ai_signal_scores_at.
//
// SPEC: Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_D_REFRESH_CRON.md §3.1
//
// Run: cd supabase && deno test --allow-all functions/_shared/__tests__/signalScorer.evaluated_at_passthrough.test.ts
//
// Fails-on-revert: at Sub-D-implementor base commit, removing the
// `evaluated_at: aiEntry.evaluated_at` line in signalScorer.computeScore's
// ai_blended return object flips T-01 → fail.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeScore,
  DEFAULT_EXPECTED_PROMPT_VERSION,
  type AiSignalEntry,
  type PlaceForScoring,
  type SignalConfig,
} from "../signalScorer.ts";

const ROMANTIC_CONFIG: SignalConfig = {
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
  expected_prompt_version: "v4",
  ai_blend_weight: 0.6,
};

function basePlace(
  overrides: Partial<PlaceForScoring> = {},
): PlaceForScoring & { id: string } {
  return {
    id: "fixture-place-d01",
    rating: 4.5,
    review_count: 100,
    types: ["restaurant"],
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
  } as PlaceForScoring & { id: string };
}

function aiEntry(overrides: Partial<AiSignalEntry> = {}): AiSignalEntry {
  return {
    score_0_to_100: 80,
    inappropriate_for: false,
    reasoning: "test reasoning",
    evaluated_at: "2026-05-30T18:00:00.000Z",
    prompt_version: DEFAULT_EXPECTED_PROMPT_VERSION,
    model: "gemini-2.5-flash",
    ...overrides,
  };
}

Deno.test("T-01 [Sub-D] ai_blended.evaluated_at echoes aiEntry.evaluated_at exactly", () => {
  const place = basePlace({
    ai_signal_scores: {
      romantic: aiEntry({ evaluated_at: "2026-05-30T18:00:00.000Z" }),
    },
  });
  const result = computeScore(place, ROMANTIC_CONFIG, "romantic");
  assert(result.ai_blended, "ai_blended should be populated for version-matched non-veto");
  assertEquals(
    result.ai_blended!.evaluated_at,
    "2026-05-30T18:00:00.000Z",
    "evaluated_at must echo aiEntry.evaluated_at",
  );
});

Deno.test("T-02 [Sub-D] rule-only path produces NO ai_blended (so caller writes ai_signal_scores_at=NULL)", () => {
  // SPEC §3.1: rule-only path returns no ai_blended field; caller maps
  // missing ai_blended → ai_signal_scores_at: null on the upsert.
  const place = basePlace({ ai_signal_scores: null });
  const result = computeScore(place, ROMANTIC_CONFIG, "romantic");
  assertEquals(
    result.ai_blended,
    undefined,
    "rule-only path must not produce ai_blended",
  );
});

Deno.test("T-03 [Sub-D] prompt-version mismatch path produces NO ai_blended (rule-only fallback)", () => {
  const place = basePlace({
    ai_signal_scores: {
      romantic: aiEntry({ prompt_version: "v3", evaluated_at: "2026-05-30T18:00:00.000Z" }),
    },
  });
  const result = computeScore(place, ROMANTIC_CONFIG, "romantic");
  assertEquals(
    result.ai_blended,
    undefined,
    "version-mismatch path must not produce ai_blended (discriminator fail-closed)",
  );
});

Deno.test("T-04 [Sub-D] veto path produces null score (caller deletes the row, never writes ai_signal_scores_at)", () => {
  const place = basePlace({
    ai_signal_scores: {
      romantic: aiEntry({ inappropriate_for: true, reasoning: "not appropriate" }),
    },
  });
  const result = computeScore(place, ROMANTIC_CONFIG, "romantic");
  assertEquals(
    result.score,
    null,
    "veto path produces null (caller deletes; no ai_signal_scores_at write happens)",
  );
});

Deno.test("T-05 [Sub-D] evaluated_at distinct values are not deduped or rewritten", () => {
  // Defensive: future refactor must not normalize/round the timestamp.
  const exact = "2026-05-30T18:00:00.123456Z";
  const place = basePlace({
    ai_signal_scores: {
      romantic: aiEntry({ evaluated_at: exact }),
    },
  });
  const result = computeScore(place, ROMANTIC_CONFIG, "romantic");
  assertEquals(
    result.ai_blended!.evaluated_at,
    exact,
    "evaluated_at must be byte-identical to the input slice",
  );
});
