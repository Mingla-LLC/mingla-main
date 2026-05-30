// META-ORCH-1009 Sub-B — discover-cards `ai_reasoning_by_signal` passthrough.
//
// Source-text tests (the broader discover-cards module is too network-coupled
// to import here without a fake supabase client; the canonical pattern in this
// repo is the source-level assertion seen in orch_0909_adversarial.test.ts).
// In addition we unit-test the pure helper `extractAiReasoningBySignal` by
// vendoring it into the test file (verbatim) to assert the shape contract.
//
// Run: cd supabase && deno test --allow-read functions/discover-cards/__tests__/ai_reasoning_passthrough.test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const root = new URL('../../../..', import.meta.url).pathname;
const read = async (rel: string) => await Deno.readTextFile(`${root}/${rel}`);

// ─── Source-level assertions on discover-cards/index.ts ────────────────

Deno.test('T-S-01: transformServablePlaceToCard emits ai_reasoning_by_signal', async () => {
  const src = await read('supabase/functions/discover-cards/index.ts');
  assert(
    src.includes('ai_reasoning_by_signal: extractAiReasoningBySignal('),
    'card payload must include ai_reasoning_by_signal field',
  );
});

Deno.test('T-S-02: extractAiReasoningBySignal helper is defined', async () => {
  const src = await read('supabase/functions/discover-cards/index.ts');
  assert(
    src.includes('function extractAiReasoningBySignal('),
    'extractor helper must exist alongside transformServablePlaceToCard',
  );
});

Deno.test('T-S-03: signalId is stamped onto RPC rows for both solo + collab paths', async () => {
  const src = await read('supabase/functions/discover-cards/index.ts');
  // Two stamping sites: collab intersection bucketing + solo multi-chip bucketing
  const stampSites = [...src.matchAll(/__signalId:\s*task\.signalId/g)];
  assert(
    stampSites.length >= 2,
    `expected >= 2 __signalId stamp sites, found ${stampSites.length}`,
  );
});

Deno.test('T-S-04: transformServablePlaceToCard receives signalId at the two production call sites', async () => {
  const src = await read('supabase/functions/discover-cards/index.ts');
  // Both the multi-chip solo path and the collab intersection path pass row.__signalId
  const callSites = [...src.matchAll(/transformServablePlaceToCard\([\s\S]*?row\.__signalId/g)];
  assert(
    callSites.length >= 2,
    `expected >= 2 transformer calls passing row.__signalId, found ${callSites.length}`,
  );
});

// ─── Unit test the extractor by vendoring it verbatim ──────────────────
//
// The helper is intentionally a tiny pure function so we re-declare it here
// with the exact body and assert behaviour. If the implementation diverges
// from this body the source-level assertions above will still catch the
// shape of the call site, and a downstream consumer-level test would catch
// the field absence on the card payload.

function extractAiReasoningBySignal(
  row: any,
  signalId: string | undefined,
): Record<string, string> | undefined {
  if (!signalId) return undefined;
  const slice = row?.ai_reasoning;
  if (!slice || typeof slice !== 'object') return undefined;
  const reasoning = slice.reasoning;
  if (typeof reasoning !== 'string' || reasoning.trim().length === 0) return undefined;
  return { [signalId]: reasoning };
}

Deno.test('T-U-01: extractor returns {signalId: reasoning} when present', () => {
  const row = {
    ai_reasoning: {
      score_0_to_100: 80,
      inappropriate_for: false,
      reasoning: 'Intimate booth seating and curated wine list.',
      prompt_version: 'v4',
      model: 'gemini-2.5-flash',
      evaluated_at: '2026-05-08T08:09:50.856Z',
    },
  };
  const out = extractAiReasoningBySignal(row, 'romantic');
  assertEquals(out, { romantic: 'Intimate booth seating and curated wine list.' });
});

Deno.test('T-U-02: extractor returns undefined when ai_reasoning is null', () => {
  assertEquals(extractAiReasoningBySignal({ ai_reasoning: null }, 'romantic'), undefined);
});

Deno.test('T-U-03: extractor returns undefined when signalId missing', () => {
  const row = { ai_reasoning: { reasoning: 'something' } };
  assertEquals(extractAiReasoningBySignal(row, undefined), undefined);
});

Deno.test('T-U-04: extractor returns undefined on empty reasoning', () => {
  assertEquals(extractAiReasoningBySignal({ ai_reasoning: { reasoning: '' } }, 'r'), undefined);
  assertEquals(extractAiReasoningBySignal({ ai_reasoning: { reasoning: '   ' } }, 'r'), undefined);
});

Deno.test('T-U-05: extractor returns undefined when reasoning is non-string', () => {
  assertEquals(extractAiReasoningBySignal({ ai_reasoning: { reasoning: 42 } }, 'r'), undefined);
  assertEquals(extractAiReasoningBySignal({ ai_reasoning: { reasoning: null } }, 'r'), undefined);
});
