// ORCH-1021 — curated-stop timezone passthrough source-text assertions.
//
// The curated generator is coupled to live Supabase/Gemini clients, so this
// follows the existing source-contract pattern in ai_reasoning_passthrough.test.ts.
//
// Run: cd supabase && deno test --allow-read functions/generate-curated-experiences/__tests__/utc_offset_passthrough.test.ts

import { assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const root = new URL('../../../..', import.meta.url).pathname;
const read = async (rel: string) => await Deno.readTextFile(`${root}/${rel}`);

Deno.test('ORCH-1021 T-06: signalRankFetch hydrates place_pool.utc_offset_minutes', async () => {
  const src = await read('supabase/functions/_shared/signalRankFetch.ts');
  assert(
    src.includes('utc_offset_minutes'),
    'signalRankFetch must continue selecting and mapping place_pool.utc_offset_minutes',
  );
});

Deno.test('ORCH-1021 T-07: generate-curated-experiences emits per-stop utcOffsetMinutes', async () => {
  const src = await read('supabase/functions/generate-curated-experiences/index.ts');
  assert(
    src.includes('utcOffsetMinutes: card.utc_offset_minutes ?? null'),
    'buildCardStop must pass utc_offset_minutes into each curated stop as utcOffsetMinutes',
  );
});
