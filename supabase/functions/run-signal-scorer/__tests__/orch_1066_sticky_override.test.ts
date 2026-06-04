// ORCH-1066 — STICKY-THROUGH-APPROVAL regression test (the load-bearing one).
//
// Operator hard requirement: an admin-set/pinned score MUST survive approval.
// Today, approving a venue runs admin-review-venue-claim runApproveGoLive →
// loops signals → invokes run-signal-scorer, which UPSERTs place_scores and would
// CLOBBER the admin's manual score. ORCH-1066 makes the scorer SKIP any
// (place_id, signal_id) whose committed contributions carry an admin marker.
//
// This test is BEHAVIORAL: it builds an in-memory place_scores table, pins a
// signal to 200 with the _admin_pin marker (as admin_pin_place_to_top does),
// then drives the EXACT sticky-skip + upsert + veto-delete loop the scorer runs
// on re-score, and asserts the admin's 200 SURVIVES (not re-computed, not deleted).
// It uses the shared pure helper (_shared/stickyOverride.ts) the scorer imports,
// so a revert of the helper or the scorer wiring fails this test.
//
// Run: cd supabase && deno test --allow-read \
//   functions/run-signal-scorer/__tests__/orch_1066_sticky_override.test.ts
//
// Fails-on-revert: at the pre-fix base, isAdminOverridden() does not exist (the
// import throws → all tests fail). After extraction, neutering the predicate to
// `return false` flips T-01/T-02/T-03 (the admin row gets clobbered/deleted).

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ADMIN_OVERRIDE_MARKERS,
  isAdminOverridden,
  protectedPlaceIds,
} from "../../_shared/stickyOverride.ts";

const SCORER_SOURCE = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

// ── In-memory place_scores simulation ────────────────────────────────────────
interface Row {
  place_id: string;
  signal_id: string;
  score: number;
  contributions: Record<string, unknown>;
}

/**
 * Faithful re-implementation of the scorer's sticky-skip + write + veto-delete
 * loop (index.ts) over an in-memory store. The ONLY shared code is the
 * isAdminOverridden predicate (imported above) — exactly as index.ts uses it.
 * If the predicate stops detecting markers, the admin row is clobbered/deleted
 * here too, so this test genuinely exercises the sticky behavior.
 */
function simulateRescore(
  store: Row[],
  signalId: string,
  computed: Array<{ place_id: string; score: number }>,
  vetoed: string[],
): Row[] {
  // 1. Build the protected set from committed rows for this signal (= scorer's
  //    sticky pre-read).
  const existingForSignal = store
    .filter((r) => r.signal_id === signalId)
    .map((r) => ({ place_id: r.place_id, contributions: r.contributions }));
  const protectedIds = protectedPlaceIds(existingForSignal);

  // 2. Drop protected ids from the write batch + veto-delete batch.
  const writes = computed.filter((w) => !protectedIds.has(w.place_id));
  const deletes = vetoed.filter((id) => !protectedIds.has(id));

  // 3. UPSERT writes (ON CONFLICT place_id,signal_id DO UPDATE score).
  for (const w of writes) {
    const idx = store.findIndex(
      (r) => r.place_id === w.place_id && r.signal_id === signalId,
    );
    if (idx >= 0) {
      store[idx].score = w.score;
      store[idx].contributions = { _recomputed: 1 };
    } else {
      store.push({
        place_id: w.place_id,
        signal_id: signalId,
        score: w.score,
        contributions: { _recomputed: 1 },
      });
    }
  }

  // 4. DELETE veto rows.
  for (const id of deletes) {
    const idx = store.findIndex(
      (r) => r.place_id === id && r.signal_id === signalId,
    );
    if (idx >= 0) store.splice(idx, 1);
  }

  return store;
}

Deno.test("T-01 [ORCH-1066] admin pin survives approval re-score (clobber path)", () => {
  const PLACE = "lantern-and-vine";
  const SIGNAL = "drinks";
  // Admin pinned drinks to 200 (admin_pin_place_to_top stamps _admin_pin).
  const store: Row[] = [{
    place_id: PLACE,
    signal_id: SIGNAL,
    score: 200,
    contributions: { _admin_pin: 1, _local_max: 140, _orch: "1066" },
  }];

  // Approval invokes the scorer: computeScore would produce e.g. 117 for drinks.
  simulateRescore(store, SIGNAL, [{ place_id: PLACE, score: 117 }], []);

  const row = store.find((r) => r.place_id === PLACE && r.signal_id === SIGNAL);
  assert(row, "admin row must still exist after re-score");
  assertEquals(row!.score, 200, "admin pin (200) must SURVIVE the re-score, not be clobbered to 117");
  assertEquals(row!.contributions._admin_pin, 1, "the admin marker must be preserved");
});

Deno.test("T-02 [ORCH-1066] admin set survives approval re-score (clobber path)", () => {
  const PLACE = "p1";
  const SIGNAL = "romantic";
  const store: Row[] = [{
    place_id: PLACE,
    signal_id: SIGNAL,
    score: 180,
    contributions: { _admin_set: 1, _set_by: "admin", _orch: "1066" },
  }];
  simulateRescore(store, SIGNAL, [{ place_id: PLACE, score: 92 }], []);
  const row = store.find((r) => r.place_id === PLACE && r.signal_id === SIGNAL)!;
  assertEquals(row.score, 180, "admin set (180) must survive re-score");
});

Deno.test("T-03 [ORCH-1066] admin override survives AI veto-delete on re-score", () => {
  const PLACE = "p2";
  const SIGNAL = "lively";
  const store: Row[] = [{
    place_id: PLACE,
    signal_id: SIGNAL,
    score: 200,
    contributions: { _admin_override: 1, _orch: "1062" },
  }];
  // Re-score AI-vetoes this (place, signal) → would normally DELETE the row.
  simulateRescore(store, SIGNAL, [], [PLACE]);
  const row = store.find((r) => r.place_id === PLACE && r.signal_id === SIGNAL);
  assert(row, "admin-overridden row must NOT be veto-deleted on re-score");
  assertEquals(row!.score, 200, "admin override must survive the veto-delete");
});

Deno.test("T-04 [ORCH-1066] non-admin (computed) rows are still re-scored normally", () => {
  const PLACE = "computed-place";
  const SIGNAL = "drinks";
  const store: Row[] = [{
    place_id: PLACE,
    signal_id: SIGNAL,
    score: 110,
    contributions: { _rating_scale: 9.4 }, // a normal computed row, no admin marker
  }];
  simulateRescore(store, SIGNAL, [{ place_id: PLACE, score: 145 }], []);
  const row = store.find((r) => r.place_id === PLACE && r.signal_id === SIGNAL)!;
  assertEquals(row.score, 145, "a normal computed row MUST be re-scored (sticky must not over-protect)");
});

Deno.test("T-05 [ORCH-1066] isAdminOverridden detects every marker, ignores plain rows", () => {
  assert(isAdminOverridden({ _admin_set: 1 }));
  assert(isAdminOverridden({ _admin_pin: 1 }));
  assert(isAdminOverridden({ _admin_override: 1 }));
  assert(!isAdminOverridden({ _rating_scale: 10 }));
  assert(!isAdminOverridden({}));
  assert(!isAdminOverridden(null));
  assert(!isAdminOverridden(undefined));
  assertEquals(ADMIN_OVERRIDE_MARKERS.length, 3);
});

Deno.test("T-06 [ORCH-1066] scorer actually wires the shared sticky predicate", () => {
  // Source guard: the scorer must import + call the shared predicate (so the
  // behavioral simulation above reflects the real code path, not a parallel copy).
  assertStringIncludes(
    SCORER_SOURCE,
    "from '../_shared/stickyOverride.ts'",
    "scorer does not import the shared sticky-override helper",
  );
  assertStringIncludes(
    SCORER_SOURCE,
    "isAdminOverridden(row.contributions)",
    "scorer does not use isAdminOverridden in its sticky pre-read",
  );
  // Protected ids must be removed from BOTH the write batch and the veto-delete batch.
  assertStringIncludes(SCORER_SOURCE, "writes.splice(i, 1)", "scorer does not drop protected rows from writes");
  assertStringIncludes(SCORER_SOURCE, "vetoedPlaceIds.splice(i, 1)", "scorer does not protect admin rows from veto-delete");
});
