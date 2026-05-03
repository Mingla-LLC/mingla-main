// ORCH-0707 / I-CURATED-LABEL-SOURCE — Regression check.
//
// The curated pipeline (generate-curated-experiences + stopAlternatives +
// signalRankFetch) MUST NOT read place_pool.ai_categories. The authority is
// comboCategory. If this test fails, a code change re-introduced the
// deprecated column read — find and remove it.
//
// See: Mingla_Artifacts/INVARIANT_REGISTRY.md (I-CURATED-LABEL-SOURCE)
//      Mingla_Artifacts/specs/SPEC_ORCH-0707_CURATED_CATEGORY_DERIVATION_REWIRE.md (§3.F)
//
// Run: deno test supabase/functions/_shared/__tests__/no_ai_categories_in_curated.test.ts

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';

const CURATED_PATH_FILES = [
  'supabase/functions/generate-curated-experiences/index.ts',
  'supabase/functions/_shared/stopAlternatives.ts',
  'supabase/functions/_shared/signalRankFetch.ts',
];

// Strip line-comments and block-comments before checking. We only care about
// CODE references to ai_categories, not historical comments noting the
// deprecation.
function stripComments(src: string): string {
  // remove /* ... */ block comments (non-greedy, dot matches newline)
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // remove // line comments
  out = out.replace(/\/\/.*$/gm, '');
  return out;
}

Deno.test('no_ai_categories_reads_in_curated_pipeline', async () => {
  for (const filePath of CURATED_PATH_FILES) {
    const src = await Deno.readTextFile(filePath);
    const stripped = stripComments(src);
    const matches = stripped.match(/ai_categories/g) ?? [];
    assertEquals(
      matches.length,
      0,
      `[ORCH-0707 regression] ${filePath} contains ${matches.length} non-comment 'ai_categories' reference(s). ` +
      `Curated path must NOT read place_pool.ai_categories — comboCategory is the authority. ` +
      `Find and remove the references. See I-CURATED-LABEL-SOURCE in INVARIANT_REGISTRY.md.`,
    );
  }
});
