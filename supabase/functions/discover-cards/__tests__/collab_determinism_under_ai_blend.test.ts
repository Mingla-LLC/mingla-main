// META-ORCH-1009 Sub-B — I-COLLAB-DECK-DETERMINISM-PRESERVED-UNDER-AI-BLEND
//
// The collab deck determinism contract requires that within a session V_n,
// every participant sees the same card at the same position. Sub-B's blend
// happens OFFLINE in signalScorer.computeScore → place_scores.score. The
// request-time RPC `query_servable_places_by_signal_intersection` only reads
// `place_scores.score` for ORDER BY — the AI blend never re-runs at request
// time, and the new `ai_reasoning` column is information-only (not in the
// ORDER BY clause).
//
// This test asserts the source-text contract: the migration adding the new
// columns DOES NOT change the ORDER BY clause, and the RPC parameters are
// unchanged. If the implementor accidentally pushed the AI read into a hot-
// path JSONB extract inside the ORDER BY (e.g.
// `ORDER BY (pp.ai_signal_scores ->> 'score_0_to_100')::numeric DESC`) this
// test would fail.
//
// Run: cd supabase && deno test --allow-read functions/discover-cards/__tests__/collab_determinism_under_ai_blend.test.ts

import { assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const root = new URL('../../../..', import.meta.url).pathname;
const read = async (rel: string) => await Deno.readTextFile(`${root}/${rel}`);

Deno.test('T-D-01: Sub-B migration preserves intersection ORDER BY clause verbatim', async () => {
  const sql = await read(
    'supabase/migrations/20260806000000_meta_orch_1009_sub_b_rpcs_with_reasoning.sql',
  );
  // Exact ORDER BY clause from baseline ORCH-0909 LCD-2 RPC.
  assert(
    sql.includes('ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST, pp.id ASC'),
    'intersection ORDER BY must remain ps.score DESC, pp.review_count DESC NULLS LAST, pp.id ASC',
  );
});

Deno.test('T-D-02: Sub-B migration preserves solo RPC ORDER BY clause verbatim', async () => {
  const sql = await read(
    'supabase/migrations/20260806000000_meta_orch_1009_sub_b_rpcs_with_reasoning.sql',
  );
  // Exact ORDER BY clause from baseline ORCH-0634 RPC.
  assert(
    sql.includes('ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST'),
    'solo ORDER BY must remain ps.score DESC, pp.review_count DESC NULLS LAST',
  );
});

Deno.test('T-D-03: Sub-B migration ORDER BY clauses do NOT reference ai_signal_scores', async () => {
  const sql = await read(
    'supabase/migrations/20260806000000_meta_orch_1009_sub_b_rpcs_with_reasoning.sql',
  );
  // Strip SQL comments first (single-line `--` comments and multi-line `/* */`)
  // so prose like "preserves the ORDER BY" doesn't trigger a false positive.
  const stripped = sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
  // Slice the literal SQL ORDER BY ... LIMIT segments and assert no JSONB
  // extract there. Anchored on `ORDER BY ps.score` (the real keyword) to
  // avoid catching prose mentions in any prefix.
  const orderByRegions = stripped.match(/ORDER BY ps\.score[^;]*?LIMIT/gs) ?? [];
  assert(orderByRegions.length >= 2, 'expected 2 ORDER BY ... LIMIT regions (solo + intersection)');
  for (const region of orderByRegions) {
    assert(
      !region.includes('ai_signal_scores'),
      `ORDER BY region must NOT reference ai_signal_scores — found: ${region}`,
    );
    assert(
      !region.includes('ai_score_raw'),
      `ORDER BY region must NOT sort by ai_score_raw (info-only column) — found: ${region}`,
    );
    assert(
      !region.includes('ai_reasoning'),
      `ORDER BY region must NOT reference ai_reasoning (info-only column) — found: ${region}`,
    );
  }
});

Deno.test('T-D-04: discover-cards intersection RPC call passes unchanged parameters', async () => {
  const src = await read('supabase/functions/discover-cards/index.ts');
  // No new request-time AI parameter was added to the RPC invocation.
  assert(
    src.includes("rpc('query_servable_places_by_signal_intersection', {"),
    'collab path still uses query_servable_places_by_signal_intersection',
  );
  // Find the call and assert it ends with p_limit (the last param), not a new
  // ai_* param.
  const m = src.match(/rpc\('query_servable_places_by_signal_intersection',\s*\{([\s\S]*?)\}\)/);
  assert(m, 'expected to find collab RPC call');
  const params = m![1];
  assert(params.includes('p_signal_id'));
  assert(params.includes('p_filter_min'));
  assert(params.includes('p_circles'));
  assert(params.includes('p_exclude_place_ids'));
  assert(params.includes('p_limit'));
  // Negative assertions
  assert(!params.includes('p_ai_'), 'no AI-side request-time parameter may be added');
  assert(!params.includes('p_prompt_version'));
});

Deno.test('T-D-05: signalScorer.computeScore is a pure function (no I/O imports)', async () => {
  const src = await read('supabase/functions/_shared/signalScorer.ts');
  // The scorer module must remain pure — no supabase/fetch/Deno.env reads.
  assert(!src.includes("from 'https://esm.sh/@supabase"));
  assert(!src.includes('Deno.env.get('));
  assert(!src.includes('fetch('));
});

Deno.test('T-D-06: blend lives in signalScorer (offline), not in discover-cards (hot path)', async () => {
  const scorer = await read('supabase/functions/_shared/signalScorer.ts');
  const discover = await read('supabase/functions/discover-cards/index.ts');
  // The blend formula keys live in the scorer module.
  assert(scorer.includes('DEFAULT_AI_BLEND_WEIGHT'));
  assert(scorer.includes('DEFAULT_EXPECTED_PROMPT_VERSION'));
  // discover-cards does NOT compute a blend at request time — it only reads
  // the precomputed place_scores.score (via the RPC) and the info-only
  // ai_reasoning column.
  assert(!discover.includes('DEFAULT_AI_BLEND_WEIGHT'));
  assert(!discover.includes('ai_blend_weight'));
});
