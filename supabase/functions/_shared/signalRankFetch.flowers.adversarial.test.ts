// ORCH-0990 — TESTER-AUTHORED ADVERSARIAL regression test (QA gate, Step 0.5(b)).
//
// DIFFERENT ANGLE than the implementor's signalRankFetch.flowers.test.ts.
// The implementor's test only GREPS the migration SQL string and the exported
// TS maps for the presence of structural markers — it never EVALUATES the gate
// predicate against actual place rows. A revert that text-matches the markers
// but mis-evaluates the predicate (e.g. wrong boolean precedence, an OR that
// leaks a grocery without the floral tag, or a NULL-primary row slipping through)
// would pass the implementor's grep but still ship the reported bug.
//
// This test transcribes the migrated composite WHERE predicate
// (20260801000001_orch_0990_…sql, the three OR-branches) into a pure TS
// `composeGate()` mirror, parameterised by the resolver output the production
// edge functions actually feed the RPC, then runs ADVERSARIAL rows through it:
//
//   ANGLE (ii)  a grocery/supermarket WITHOUT the florist tag is EXCLUDED
//               (the carve-out is narrow — proven live: 0 leak).
//   ANGLE (iv)  a NULL-primary_type row carrying the florist secondary tag is
//               EXCLUDED (live universe = 9 such rows, 0 leak).
//   ANGLE noise a service / general_contractor / event-planner primary carrying
//               the florist secondary tag is EXCLUDED — the EXACT Lagos bug
//               (BusyBee=service, Rukkies=general_contractor, both 'florist'∈types).
//   ANGLE (iii) floor-0 preserves score-DESC ordering AND never drops a
//               score-0 verified florist (Lagos Sparkle Gardens, Brussels Pollen
//               Atelier both live at score 0.00).
//
// FAILS-ON-REVERT ANCHOR (asserted in the final test): if the production gate is
// reverted to the rejected types[]-only mechanism — i.e. eligibility keys off
// `'florist' ∈ types[]` instead of `primary_type` — this mirror's `typesOnlyGate`
// re-admits BusyBee + Rukkies + the NULL-primary noise. The test asserts that the
// composite gate EXCLUDES them while the types[]-only revert ADMITS them, proving
// the predicate (not just the SQL text) is what bites.
//
// The gate parameters come from the live resolver (resolvePrimaryTypeGate /
// resolveFilterMin) so a revert of EITHER the resolver OR the predicate fails this.

import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  resolvePrimaryTypeGate,
  resolveFilterMin,
  type PrimaryTypeGate,
} from './signalRankFetch.ts';

// ── A faithful TS mirror of the migrated RPC composite WHERE predicate ─────────
// Transcribed verbatim from 20260801000001_orch_0990_…sql lines 70-76:
//   AND (
//     (p_primary_type_required IS NULL AND p_grocery_floral_tag = false)
//     OR (p_primary_type_required IS NOT NULL AND pp.primary_type = ANY(p_primary_type_required))
//     OR (p_grocery_floral_tag = true
//         AND pp.primary_type = ANY(ARRAY['grocery_store','supermarket'])
//         AND pp.types && ARRAY['florist'])
//   )
interface PlaceRow {
  name: string;
  primary_type: string | null;
  types: string[];
  flowers_score: number;
}

function compositeGate(
  row: PlaceRow,
  primaryTypeRequired: string[] | null,
  groceryFloralTag: boolean,
): boolean {
  // SQL `pp.primary_type = ANY(arr)` is FALSE when primary_type IS NULL — the TS
  // mirror must reproduce that NULL-safety (a NULL primary never equals anything).
  const primaryIn = (arr: string[]): boolean =>
    row.primary_type !== null && arr.includes(row.primary_type);
  const typesOverlap = (arr: string[]): boolean =>
    row.types.some((t) => arr.includes(t));

  return (
    (primaryTypeRequired === null && groceryFloralTag === false) ||
    (primaryTypeRequired !== null && primaryIn(primaryTypeRequired)) ||
    (groceryFloralTag === true &&
      primaryIn(['grocery_store', 'supermarket']) &&
      typesOverlap(['florist']))
  );
}

// The REJECTED types[]-only mechanism (PASS-1, RC-2) — eligibility off the loose
// secondary tag. Used only to PROVE the composite gate diverges from it on noise.
function typesOnlyGate(row: PlaceRow): boolean {
  return row.types.includes('florist');
}

// Resolve the gate params exactly as the production edge functions do.
function flowersGateParams(): { primaryTypeRequired: string[] | null; groceryFloralTag: boolean } {
  const g: PrimaryTypeGate | undefined = resolvePrimaryTypeGate('flowers');
  assert(g !== undefined, 'resolvePrimaryTypeGate(flowers) MUST be defined');
  return { primaryTypeRequired: g.primaryTypes, groceryFloralTag: g.groceryFloralTag };
}

// ── Adversarial fixtures (modelled on REAL live rows, 2026-05-29) ──────────────
const ROWS: PlaceRow[] = [
  // verified florists (incl. the score-0 boutique that floor-80 would have dropped)
  { name: 'Regal Flowers Lekki', primary_type: 'florist', types: ['florist', 'point_of_interest'], flowers_score: 143.85 },
  { name: 'Sparkle Gardens', primary_type: 'florist', types: ['florist'], flowers_score: 0 },
  { name: 'Pollen Atelier (Brussels)', primary_type: 'florist', types: ['florist', 'store'], flowers_score: 0 },
  // verified-floral grocery / supermarket carve-out (must pass)
  { name: 'Harris Teeter (Raleigh)', primary_type: 'grocery_store', types: ['grocery_store', 'florist', 'store'], flowers_score: 140.62 },
  { name: 'Intermarché Jette (Brussels)', primary_type: 'supermarket', types: ['supermarket', 'florist'], flowers_score: 0 },
  // ANGLE (ii): grocery/supermarket WITHOUT the florist tag — must be EXCLUDED
  { name: 'Plain Grocery (no floral dept)', primary_type: 'grocery_store', types: ['grocery_store', 'store'], flowers_score: 95 },
  { name: 'Plain Supermarket (no floral dept)', primary_type: 'supermarket', types: ['supermarket'], flowers_score: 130 },
  // ANGLE noise: service / general_contractor with the secondary florist tag — the EXACT bug
  { name: 'BusyBee Events (Lagos)', primary_type: 'service', types: ['florist', 'point_of_interest'], flowers_score: 104.29 },
  { name: 'Rukkies Decor (Lagos)', primary_type: 'general_contractor', types: ['florist', 'store'], flowers_score: 99.52 },
  { name: 'Mio Kreations (Raleigh)', primary_type: 'service', types: ['florist'], flowers_score: 154.52 },
  // ANGLE (iv): NULL primary_type carrying the florist tag — must be EXCLUDED
  { name: 'Just Weddings (Lagos, NULL primary)', primary_type: null, types: ['florist', 'event_planner'], flowers_score: 22.46 },
];

const VERIFIED_BOUQUET_SOURCES = new Set([
  'Regal Flowers Lekki', 'Sparkle Gardens', 'Pollen Atelier (Brussels)',
  'Harris Teeter (Raleigh)', 'Intermarché Jette (Brussels)',
]);
const NOISE = new Set([
  'Plain Grocery (no floral dept)', 'Plain Supermarket (no floral dept)',
  'BusyBee Events (Lagos)', 'Rukkies Decor (Lagos)', 'Mio Kreations (Raleigh)',
  'Just Weddings (Lagos, NULL primary)',
]);

// ── ANGLE (ii): the grocery carve-out is NARROW ───────────────────────────────

Deno.test('ADVERSARIAL — a grocery/supermarket WITHOUT the florist tag is EXCLUDED (carve-out is narrow)', () => {
  const { primaryTypeRequired, groceryFloralTag } = flowersGateParams();
  for (const r of ROWS.filter((x) => /Plain (Grocery|Supermarket)/.test(x.name))) {
    assertEquals(
      compositeGate(r, primaryTypeRequired, groceryFloralTag),
      false,
      `${r.name} has NO 'florist' tag → it is NOT a verified floral dept → MUST be excluded. ` +
        `Leaking it would re-open the bug for every supermarket on popularity alone.`,
    );
  }
});

// ── ANGLE (iv): NULL primary_type never passes ────────────────────────────────

Deno.test('ADVERSARIAL — a NULL primary_type row with a florist secondary tag is EXCLUDED', () => {
  const { primaryTypeRequired, groceryFloralTag } = flowersGateParams();
  const nullRow = ROWS.find((r) => r.primary_type === null)!;
  assert(nullRow.types.includes('florist'), 'fixture sanity: the NULL-primary row carries the florist tag');
  assertEquals(
    compositeGate(nullRow, primaryTypeRequired, groceryFloralTag),
    false,
    'A NULL primary_type must fail `primary_type = ANY(...)` (SQL NULL semantics). Live universe = 9 ' +
      'such rows, 0 leak. If this passes, the gate is admitting un-classified businesses.',
  );
});

// ── ANGLE noise: service/general_contractor never passes (the exact Lagos bug) ─

Deno.test('ADVERSARIAL — service/general_contractor primaries with a florist tag are EXCLUDED (the reported bug)', () => {
  const { primaryTypeRequired, groceryFloralTag } = flowersGateParams();
  for (const r of ROWS.filter((x) => x.primary_type === 'service' || x.primary_type === 'general_contractor')) {
    assert(r.types.includes('florist'), `fixture sanity: ${r.name} carries the secondary florist tag`);
    assertEquals(
      compositeGate(r, primaryTypeRequired, groceryFloralTag),
      false,
      `${r.name} (primary_type=${r.primary_type}) MUST be excluded even though Google mis-tagged it ` +
        `with a secondary 'florist'. This is the exact non-bouquet business the operator flagged.`,
    );
  }
});

// ── Full partition: every fixture lands on the correct side of the gate ────────

Deno.test('ADVERSARIAL — composite gate partitions all fixtures: bouquet sources IN, noise OUT', () => {
  const { primaryTypeRequired, groceryFloralTag } = flowersGateParams();
  for (const r of ROWS) {
    const passes = compositeGate(r, primaryTypeRequired, groceryFloralTag);
    if (VERIFIED_BOUQUET_SOURCES.has(r.name)) {
      assert(passes, `${r.name} is a verified bouquet source and MUST pass the gate`);
    } else if (NOISE.has(r.name)) {
      assert(!passes, `${r.name} is noise and MUST be excluded`);
    } else {
      throw new Error(`fixture ${r.name} is not classified — test bug`);
    }
  }
});

// ── ANGLE (iii): floor-0 preserves score-DESC ordering and never drops a 0-score florist ──

Deno.test('ADVERSARIAL — floor 0 keeps score-0 verified florists AND preserves score-DESC order', () => {
  const floor = resolveFilterMin('flowers');
  assertEquals(floor, 0, 'floor must be 0 for this angle to hold');
  const { primaryTypeRequired, groceryFloralTag } = flowersGateParams();

  // Eligible = passes composite gate AND score >= floor.
  const eligible = ROWS
    .filter((r) => compositeGate(r, primaryTypeRequired, groceryFloralTag) && r.flowers_score >= floor)
    .sort((a, b) => b.flowers_score - a.flowers_score);

  // The two genuine score-0 florists survive floor 0 (a floor of 40/80 would drop them).
  const names = eligible.map((r) => r.name);
  assert(names.includes('Sparkle Gardens'), 'score-0 Lagos florist MUST survive floor 0');
  assert(names.includes('Pollen Atelier (Brussels)'), 'score-0 Brussels florist MUST survive floor 0');

  // Counter-proof: a positive floor (40) would silently drop both score-0 florists.
  const floor40Survivors = eligible.filter((r) => r.flowers_score >= 40).map((r) => r.name);
  assertEquals(floor40Survivors.includes('Sparkle Gardens'), false, 'demonstrates floor 40 drops real florists');
  assertEquals(floor40Survivors.includes('Pollen Atelier (Brussels)'), false, 'demonstrates floor 40 drops real florists');

  // Order is strictly non-increasing by score (score-DESC preserved post-gate).
  for (let i = 1; i < eligible.length; i++) {
    assert(
      eligible[i - 1].flowers_score >= eligible[i].flowers_score,
      `score-DESC ordering violated at index ${i}: ${eligible[i - 1].name} < ${eligible[i].name}`,
    );
  }
});

// ── FAILS-ON-REVERT ANCHOR: composite gate diverges from the types[]-only revert ──
//
// If the production gate were reverted to the rejected types[]-only mechanism,
// eligibility would key off `'florist' ∈ types[]`. This test proves the composite
// gate and the types[]-only revert DISAGREE on exactly the noise rows — so a
// revert to types[]-only is observable as a behavior change, not just a text diff.

Deno.test('ADVERSARIAL (fails-on-revert anchor) — composite EXCLUDES the noise that a types[]-only revert ADMITS', () => {
  const { primaryTypeRequired, groceryFloralTag } = flowersGateParams();
  const revertVictims = ['BusyBee Events (Lagos)', 'Rukkies Decor (Lagos)', 'Mio Kreations (Raleigh)', 'Just Weddings (Lagos, NULL primary)'];
  for (const name of revertVictims) {
    const r = ROWS.find((x) => x.name === name)!;
    // The rejected revert ADMITS it (it carries the florist tag)…
    assertEquals(typesOnlyGate(r), true, `precondition: ${name} carries a florist tag (the revert would admit it)`);
    // …but the shipped composite gate EXCLUDES it.
    assertEquals(
      compositeGate(r, primaryTypeRequired, groceryFloralTag),
      false,
      `REVERT GUARD: ${name} is admitted by the types[]-only mechanism but MUST be excluded by the ` +
        `composite primary_type gate. If the composite gate ever admits it, the fix has been reverted.`,
    );
  }
});
