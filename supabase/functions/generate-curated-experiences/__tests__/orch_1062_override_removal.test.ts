// ORCH-1062 — implementor regression test for Part 1 (vibe rank-override removal).
//
// Proves the SPEC §6 success criteria SC-1..SC-4 + SC-6 at the resolver level:
//   - Non-nature curated stops now rank by their OWN filter signal (the override
//     map no longer carries a romantic/icebreakers/lively entry for them).
//   - The two NATURE overrides survive (take-a-stroll/nature → scenic,
//     picnic-dates/nature → picnic_friendly).
//   - EXPERIENCE_RANK_SIGNAL_OVERRIDE has exactly the two nature keys/entries.
//
// FAILS-ON-REVERT: restoring the pre-ORCH-1062 override map (which mapped
// group-fun/casual_food → 'lively', romantic/upscale_fine_dining → 'romantic',
// first-date/theatre → 'icebreakers') makes the SC-2/SC-3/SC-4 assertions FAIL,
// because resolveStopRankSignal would return the vibe signal instead of the
// stop's own category signal. The nature-survivor assertions pass in BOTH the
// old and new maps (intentional — those overrides are retained).
//
// The module's serve() is guarded by `import.meta.main` so importing it does
// NOT start the HTTP server.
//
// Run: cd supabase && deno test --allow-read --allow-env \
//   functions/generate-curated-experiences/__tests__/orch_1062_override_removal.test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { resolveStopRankSignal } from '../index.ts';
import { COMBO_SLUG_TO_FILTER_SIGNAL } from '../../_shared/signalRankFetch.ts';

// ─── SC-2 — group-fun Food stop ranks by its OWN signal, not 'lively' ─────────
Deno.test("T-02 (fails-on-revert): group-fun casual_food ranks by own signal, not 'lively'", () => {
  const resolved = resolveStopRankSignal('group-fun', 'casual_food');
  assertEquals(resolved, 'casual_food', "group-fun/casual_food must rank by its own filter signal");
  assertEquals(
    resolved,
    COMBO_SLUG_TO_FILTER_SIGNAL['casual_food'],
    "resolved signal must equal the slug's COMBO_SLUG_TO_FILTER_SIGNAL value",
  );
  assert(resolved !== 'lively', "must NOT rank by the removed 'lively' vibe override");
});

// ─── SC-3 — romantic Dinner stop ranks by 'fine_dining', not 'romantic' ───────
Deno.test("T-03 (fails-on-revert): romantic upscale_fine_dining ranks by 'fine_dining', not 'romantic'", () => {
  const resolved = resolveStopRankSignal('romantic', 'upscale_fine_dining');
  assertEquals(resolved, 'fine_dining', "romantic/upscale_fine_dining must rank by its own signal (fine_dining)");
  assert(resolved !== 'romantic', "must NOT rank by the removed 'romantic' vibe override");
});

// ─── SC (T-04) — first-date theatre stop ranks by 'theatre', not 'icebreakers' ─
Deno.test("T-04 (fails-on-revert): first-date theatre ranks by 'theatre', not 'icebreakers'", () => {
  const resolved = resolveStopRankSignal('first-date', 'theatre');
  assertEquals(resolved, 'theatre', "first-date/theatre must rank by its own signal");
  assert(resolved !== 'icebreakers', "must NOT rank by the removed 'icebreakers' vibe override");
});

// ─── SC-4 — the two NATURE overrides survive ──────────────────────────────────
Deno.test("T-05/T-06: nature overrides retained (scenic + picnic_friendly)", () => {
  assertEquals(
    resolveStopRankSignal('take-a-stroll', 'nature'),
    'scenic',
    "take-a-stroll/nature must still rank by 'scenic'",
  );
  assertEquals(
    resolveStopRankSignal('picnic-dates', 'nature'),
    'picnic_friendly',
    "picnic-dates/nature must still rank by 'picnic_friendly'",
  );
});

// ─── SC-1 — the override literal is exactly the two nature entries ────────────
Deno.test("T-01: EXPERIENCE_RANK_SIGNAL_OVERRIDE source has only the two nature keys", () => {
  const src = Deno.readTextFileSync(new URL('../index.ts', import.meta.url));
  // Slice out the literal body between the declaration and its closing brace.
  const start = src.indexOf('const EXPERIENCE_RANK_SIGNAL_OVERRIDE');
  assert(start >= 0, 'override literal must exist');
  const decl = src.slice(start, src.indexOf('};', start) + 2);

  // Exactly the two nature top-level keys.
  assert(/'take-a-stroll':\s*\{\s*'nature':\s*'scenic'\s*\}/.test(decl),
    "must contain take-a-stroll → { nature: scenic }");
  assert(/'picnic-dates':\s*\{\s*'nature':\s*'picnic_friendly'\s*\}/.test(decl),
    "must contain picnic-dates → { nature: picnic_friendly }");

  // No removed vibe overrides remain in the literal.
  for (const removed of ["'romantic'", "'first-date'", "'group-fun'", "'adventurous'", "'lively'", "'icebreakers'"]) {
    assert(!decl.includes(removed),
      `removed override key/value ${removed} must NOT appear in the literal`);
  }
});

// ─── SC-6 — generic non-nature slugs all fall back to own signal ──────────────
Deno.test("T-07: every non-nature curated slug resolves to its own COMBO_SLUG_TO_FILTER_SIGNAL", () => {
  const cases: Array<[string, string]> = [
    ['group-fun', 'play'],
    ['group-fun', 'movies'],
    ['first-date', 'brunch'],
    ['romantic', 'creative_arts'],
    ['adventurous', 'casual_food'],
    ['take-a-stroll', 'casual_food'], // the removed FOOD override on the stroll intent
  ];
  for (const [intent, slug] of cases) {
    assertEquals(
      resolveStopRankSignal(intent, slug),
      COMBO_SLUG_TO_FILTER_SIGNAL[slug],
      `${intent}/${slug} must fall back to own filter signal`,
    );
  }
});
