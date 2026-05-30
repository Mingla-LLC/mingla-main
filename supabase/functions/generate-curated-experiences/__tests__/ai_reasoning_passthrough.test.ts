// META-ORCH-1009 Sub-B — generate-curated-experiences `aiReasoningBySignal`
// passthrough source-text assertions.
//
// The curated-experience pipeline is too tightly coupled to live supabase /
// Gemini clients to import here without a heavy mock harness. Following the
// repo convention (see orch_0909_adversarial.test.ts) we assert the source-
// level contract that the stop payload carries the per-signal reasoning slice
// when the upstream signalRankFetch.ts result populates it.
//
// Run: cd supabase && deno test --allow-read functions/generate-curated-experiences/__tests__/ai_reasoning_passthrough.test.ts

import { assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const root = new URL('../../../..', import.meta.url).pathname;
const read = async (rel: string) => await Deno.readTextFile(`${root}/${rel}`);

Deno.test('T-C-01: buildCardStop conditionally emits aiReasoningBySignal', async () => {
  const src = await read('supabase/functions/generate-curated-experiences/index.ts');
  assert(
    src.includes('(card.aiReasoningBySignal ? { aiReasoningBySignal: card.aiReasoningBySignal } : {})'),
    'buildCardStop must spread aiReasoningBySignal when present (conditional, never an empty object)',
  );
});

Deno.test('T-C-02: SignalRankResult interface declares aiReasoningBySignal', async () => {
  const src = await read('supabase/functions/_shared/signalRankFetch.ts');
  assert(
    src.includes('aiReasoningBySignal?: Record<string, string>'),
    'SignalRankResult interface must declare the new field',
  );
});

Deno.test('T-C-03: signalRankFetch hydrate SELECT pulls ai_signal_scores', async () => {
  const src = await read('supabase/functions/_shared/signalRankFetch.ts');
  // The hydrate query selects ai_signal_scores so the per-rankSignal reasoning
  // is available to the row mapper.
  assert(
    src.includes('ai_signal_scores'),
    'hydrate SELECT must include ai_signal_scores for the per-rankSignal reasoning extraction',
  );
});

Deno.test('T-C-04: signalRankFetch row mapper keys reasoning by rankSignal', async () => {
  const src = await read('supabase/functions/_shared/signalRankFetch.ts');
  // The reasoning slice in the row mapper is keyed by rankSignal so the
  // curated card surfaces the vibe-rank signal's reasoning (e.g. 'romantic'
  // for a Romantic dinner), matching the Replace flow's rankSignal stamp.
  assert(
    src.includes('[rankSignal]: reasoning'),
    'row mapper must key the reasoning by rankSignal',
  );
});

Deno.test('T-C-05: SignalRankResult interface field is optional', async () => {
  const src = await read('supabase/functions/_shared/signalRankFetch.ts');
  // The field MUST be optional so existing callers (and unevaluated places)
  // do not break.
  assert(
    src.includes('aiReasoningBySignal?:'),
    'aiReasoningBySignal must be optional to preserve backward compatibility',
  );
});
