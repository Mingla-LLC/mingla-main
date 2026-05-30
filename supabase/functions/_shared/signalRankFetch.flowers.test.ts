// ORCH-0990 — regression guard for the curated "Flowers" stop florist gate.
//
// The bug: the flowers combo slug had NO serve-time type gate. The RPC
// `fetch_local_signal_ranked` clause `(p_required_types IS NULL OR pp.types &&
// p_required_types)` was NULL-bypassed for flowers, so ANY place with a high
// popularity `flowers` score in range was eligible — florist or not. Live Lagos
// proof: "Rukkies Decor" (primary_type=general_contractor, score 99.5) and
// "BusyBee Events" (primary_type=service, score 104) were serve-eligible at the
// flower stop even though you cannot buy a bouquet there.
//
// The fix (SPEC §8): a composite primary-type-aware gate, threaded as two new
// RPC params, resolved for flowers via COMBO_SLUG_PRIMARY_TYPE_GATE, with the
// score floor dropped to 0 so genuine boutique florists (scoring 0-39) are not
// dropped. The honesty guarantee is the TYPE gate, not the popularity score.
//
// The invariants this test enforces (all FAIL ON REVERT):
//   T-02   — resolver/floor mechanism: resolvePrimaryTypeGate('flowers') gates on
//            primary_type='florist' + groceryFloralTag; resolveFilterMin('flowers')
//            === 0; resolveTypeFilter('flowers') === undefined (NOT a types[] gate).
//   T-06   — the rejected types[]-only mechanism is NOT re-introduced (flowers must
//            never appear in COMBO_SLUG_TYPE_FILTER).
//   T-07   — the floor is exactly 0, never bumped back to a positive value that
//            would drop real low-scoring florists.
//   T-01   — (fails-on-revert, source-level) the migration RPC body contains the
//            composite primary_type predicate. Reverting the RPC to the
//            types[]-only predicate (dropping the primary_type check) — which is
//            exactly what re-admits the service/general_contractor noise — flips
//            this assertion red. The live-data RPC probe (Lagos/Raleigh row sets)
//            is the tester's phase per SPEC §14 step 8; this guards the mechanism
//            the live behavior depends on.

import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  COMBO_SLUG_PRIMARY_TYPE_GATE,
  COMBO_SLUG_TYPE_FILTER,
  COMBO_SLUG_FILTER_MIN,
  resolvePrimaryTypeGate,
  resolveTypeFilter,
  resolveFilterMin,
} from './signalRankFetch.ts';

const MIGRATION_SRC_URL = new URL(
  '../../migrations/20260801000001_orch_0990_fetch_local_signal_ranked_primary_type_gate.sql',
  import.meta.url,
);

// ── T-02: resolver + floor mechanism ─────────────────────────────────────────

Deno.test('T-02 — resolvePrimaryTypeGate(flowers) gates on primary_type=florist + grocery floral tag', () => {
  const gate = resolvePrimaryTypeGate('flowers');
  assert(gate !== undefined, 'flowers MUST have a primary-type gate');
  assertEquals(gate, { primaryTypes: ['florist'], groceryFloralTag: true });
});

Deno.test('T-02 — resolveFilterMin(flowers) === 0 (score orders, never drops a verified florist)', () => {
  assertEquals(resolveFilterMin('flowers'), 0);
});

Deno.test('T-02 — resolveTypeFilter(flowers) === undefined (flowers does NOT use the types[]-overlap gate)', () => {
  assertEquals(resolveTypeFilter('flowers'), undefined);
});

// ── T-06: rejected types[]-only mechanism must NOT be re-introduced ───────────

Deno.test('T-06 — flowers is NOT in COMBO_SLUG_TYPE_FILTER (the rejected types[]-only mechanism)', () => {
  assertEquals(
    Object.prototype.hasOwnProperty.call(COMBO_SLUG_TYPE_FILTER, 'flowers'),
    false,
    'Re-adding flowers to COMBO_SLUG_TYPE_FILTER re-introduces the types[]-overlap gate that ' +
      're-admits Lagos event-planners/contractors (RC-2). The gate must key off primary_type.',
  );
});

Deno.test('T-06 — COMBO_SLUG_PRIMARY_TYPE_GATE.flowers exists and includes the florist primary type', () => {
  const gate = COMBO_SLUG_PRIMARY_TYPE_GATE['flowers'];
  assert(gate !== undefined, 'COMBO_SLUG_PRIMARY_TYPE_GATE.flowers MUST exist');
  assert(gate.primaryTypes.includes('florist'), "flowers gate MUST include primary_type 'florist'");
  assertEquals(gate.groceryFloralTag, true, 'flowers gate MUST admit verified-floral groceries');
});

// ── T-07: floor must be exactly 0 ─────────────────────────────────────────────

Deno.test('T-07 — COMBO_SLUG_FILTER_MIN.flowers === 0 (a positive floor drops real florists)', () => {
  assertEquals(
    COMBO_SLUG_FILTER_MIN['flowers'],
    0,
    'A positive flowers floor drops genuine low-scoring florists (Lagos Fresh Flowers 33, ' +
      'Sparkle Gardens 0). Honesty is the type gate; the score only orders.',
  );
});

// ── T-01: fails-on-revert — the migration RPC body carries the composite gate ──
//
// This is the source-level fails-on-revert assertion. The exact thing that
// re-admits the service/general_contractor noise is reverting the RPC to the
// types[]-only predicate (i.e. dropping the primary_type check). Asserting the
// composite predicate's structural markers are present in the migration body
// means: revert the gate → this test goes red.

Deno.test('T-01 (fails-on-revert) — migration RPC body contains the composite primary_type gate', async () => {
  const sql = await Deno.readTextFile(MIGRATION_SRC_URL);

  // The new optional params exist on the RPC signature.
  assert(
    sql.includes('p_primary_type_required'),
    'RPC MUST declare p_primary_type_required — reverting to the 9-arg types[]-only RPC removes it.',
  );
  assert(
    sql.includes('p_grocery_floral_tag'),
    'RPC MUST declare p_grocery_floral_tag — the verified-floral-grocery carve-out param.',
  );

  // The composite WHERE clause keys off the canonical primary_type — NOT a
  // types[]-overlap alone. This is the exact line that excludes the Lagos
  // service/general_contractor noise.
  assert(
    sql.includes('pp.primary_type = ANY(p_primary_type_required)'),
    'RPC MUST gate on pp.primary_type (the clean discriminator). Reverting to a ' +
      'types[]-overlap-only predicate re-admits service/general_contractor primaries ' +
      '(BusyBee/Rukkies/LEE signTEC in Lagos) — the exact reported bug.',
  );

  // The narrow grocery/supermarket + florist-tag carve-out (verified floral dept).
  assert(
    /pp\.primary_type = ANY\(ARRAY\['grocery_store','supermarket'\]\)/.test(sql) &&
      /pp\.types && ARRAY\['florist'\]/.test(sql),
    'RPC MUST admit grocery/supermarket primaries that ALSO carry the florist tag ' +
      '(verified floral dept, e.g. Raleigh Harris Teeter) — else operator-flagged Raleigh goes empty.',
  );
});

// ── ADVERSARIAL: the revert shape must NOT structurally pass ──────────────────
//
// Proves the T-01 assertion is meaningful: a hypothetical reverted RPC body that
// gates ONLY on types[]-overlap (no primary_type clause) does NOT contain the
// marker, so the guard above would correctly fail against it.

Deno.test('T-01 adversarial — a types[]-only revert body lacks the primary_type marker', () => {
  const revertedBody = `
    SELECT ps_rank.place_id, ps_rank.score AS rank_score
    FROM place_pool pp
    INNER JOIN place_scores ps_filter ON ...
    WHERE pp.is_active = true AND pp.is_servable = true
      AND (p_required_types IS NULL OR pp.types && p_required_types)
    ORDER BY ps_rank.score DESC;
  `;
  assertEquals(
    revertedBody.includes('pp.primary_type = ANY(p_primary_type_required)'),
    false,
    'The reverted (types[]-only) RPC must NOT match the composite-gate marker — confirms the guard bites.',
  );
});
