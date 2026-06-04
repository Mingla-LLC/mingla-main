// ORCH-1066 — STICKY-THROUGH-APPROVAL adversarial regression (tester-authored).
//
// DIFFERENT ANGLE from the implementor's happy-path test
// (orch_1066_sticky_override.test.ts), which checks ONE protected place per test.
// This attacks the BATCH-INTERLEAVING + REVERSE-SPLICE mechanics that the real
// scorer uses at index.ts:329-340 — the place where off-by-one / forward-splice
// bugs live. A forward `splice` while iterating, or a wrong predicate, would skip
// an element and let an admin row through (or clobber an innocent one).
//
// The attack scenario is a SINGLE re-score batch that mixes, in interleaved order:
//   p_pin     — admin _admin_pin, hit by a COMPUTED write   → must STAY pinned
//   p_norm1   — no marker,        hit by a COMPUTED write   → must UPDATE
//   p_override— admin _admin_override, hit by an AI VETO    → must SURVIVE delete
//   p_norm2   — no marker,        hit by an AI VETO         → must be DELETED
//   p_set     — admin _admin_set, hit by a COMPUTED write   → must STAY set
//   p_norm3   — no marker,        hit by a COMPUTED write   → must UPDATE
// i.e. protected and unprotected rows are adjacent in BOTH the writes array and
// the vetoedPlaceIds array, so a reverse-splice that mutates indices wrong would
// be caught.
//
// It ALSO asserts the real scorer body uses the descending (reverse) splice loop
// `for (let i = writes.length - 1; i >= 0; i--)` for BOTH batches, so a refactor
// to an ascending splice (which skips the element after every removal) fails here.
//
// Run: cd supabase && deno test --allow-read \
//   functions/run-signal-scorer/__tests__/orch_1066_sticky_mixed_batch.adversarial.test.ts
//
// Fails-on-revert: neuter isAdminOverridden() → return false (in _shared/
// stickyOverride.ts) and every protected row gets clobbered/deleted → 3 asserts
// flip. Replace the reverse-splice in index.ts with a forward splice → the
// source-guard test flips.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isAdminOverridden } from "../../_shared/stickyOverride.ts";

const SCORER_SOURCE = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

interface Row {
  place_id: string;
  signal_id: string;
  score: number;
  contributions: Record<string, unknown> | null;
}

/**
 * Faithful re-implementation of the scorer's REVERSE-splice sticky guard
 * (index.ts:295-341) over an in-memory store. Mirrors the real code's control
 * flow EXACTLY: build protectedIds from committed rows via the shared predicate,
 * then reverse-splice both the writes array and the vetoedPlaceIds array, then
 * apply the surviving writes/deletes. The ONLY shared logic with production is
 * isAdminOverridden (imported above), exactly as index.ts uses it.
 */
function rescoreMixedBatch(
  store: Row[],
  signalId: string,
  writes: Array<{ place_id: string; score: number }>,
  vetoedPlaceIds: string[],
): { writtenIds: string[]; deletedIds: string[] } {
  // ── sticky pre-read: protectedIds from committed rows for this signal ──
  const protectedIds = new Set<string>();
  const existingForSignal = store.filter((r) => r.signal_id === signalId);
  for (const row of existingForSignal) {
    if (isAdminOverridden(row.contributions)) protectedIds.add(row.place_id);
  }

  // ── reverse-splice writes (mirrors index.ts:331-333) ──
  for (let i = writes.length - 1; i >= 0; i--) {
    if (protectedIds.has(writes[i].place_id)) writes.splice(i, 1);
  }
  // ── reverse-splice veto-deletes (mirrors index.ts:336-338) ──
  for (let i = vetoedPlaceIds.length - 1; i >= 0; i--) {
    if (protectedIds.has(vetoedPlaceIds[i])) vetoedPlaceIds.splice(i, 1);
  }

  // ── apply surviving writes (UPSERT) ──
  const writtenIds: string[] = [];
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
    writtenIds.push(w.place_id);
  }
  // ── apply surviving deletes ──
  const deletedIds: string[] = [];
  for (const id of vetoedPlaceIds) {
    const idx = store.findIndex(
      (r) => r.place_id === id && r.signal_id === signalId,
    );
    if (idx >= 0) {
      store.splice(idx, 1);
      deletedIds.push(id);
    }
  }
  return { writtenIds, deletedIds };
}

Deno.test("ADV-01 [ORCH-1066] mixed batch: protected stay, unprotected re-score (interleaved)", () => {
  const SIGNAL = "drinks";
  const store: Row[] = [
    { place_id: "p_pin", signal_id: SIGNAL, score: 200, contributions: { _admin_pin: 1, _orch: "1066" } },
    { place_id: "p_norm1", signal_id: SIGNAL, score: 90, contributions: { _rating_scale: 8 } },
    { place_id: "p_override", signal_id: SIGNAL, score: 175, contributions: { _admin_override: 1, _orch: "1062" } },
    { place_id: "p_norm2", signal_id: SIGNAL, score: 60, contributions: { _rating_scale: 4 } },
    { place_id: "p_set", signal_id: SIGNAL, score: 180, contributions: { _admin_set: 1, _orch: "1066" } },
    { place_id: "p_norm3", signal_id: SIGNAL, score: 70, contributions: { _rating_scale: 5 } },
    // A protected row that is NOT touched at all this run (should remain untouched).
    { place_id: "p_idle_admin", signal_id: SIGNAL, score: 199, contributions: { _admin_set: 1 } },
  ];

  // Interleaved writes: pin(clobber), norm1(clobber), set(clobber), norm3(clobber).
  // Interleaved vetoes: override(veto), norm2(veto).
  const { writtenIds, deletedIds } = rescoreMixedBatch(
    store,
    SIGNAL,
    [
      { place_id: "p_pin", score: 117 },
      { place_id: "p_norm1", score: 145 },
      { place_id: "p_set", score: 92 },
      { place_id: "p_norm3", score: 130 },
    ],
    ["p_override", "p_norm2"],
  );

  const get = (id: string) => store.find((r) => r.place_id === id && r.signal_id === SIGNAL);

  // Protected rows survive untouched.
  assertEquals(get("p_pin")!.score, 200, "admin pin must survive interleaved clobber");
  assertEquals(get("p_pin")!.contributions!._admin_pin, 1, "pin marker preserved");
  assertEquals(get("p_set")!.score, 180, "admin set must survive interleaved clobber");
  assert(get("p_override"), "admin override row must survive the interleaved veto-delete");
  assertEquals(get("p_override")!.score, 175, "admin override score preserved through veto");
  assertEquals(get("p_idle_admin")!.score, 199, "untouched admin row stays untouched");

  // Unprotected rows DO re-score / delete (sticky must not over-protect).
  assertEquals(get("p_norm1")!.score, 145, "normal row must re-score");
  assertEquals(get("p_norm3")!.score, 130, "normal row must re-score");
  assert(!get("p_norm2"), "normal vetoed row must be deleted");

  // Batch accounting: exactly the 2 unprotected writes wrote; exactly 1 veto deleted.
  assertEquals(writtenIds.sort(), ["p_norm1", "p_norm3"], "only unprotected writes applied");
  assertEquals(deletedIds, ["p_norm2"], "only unprotected veto deleted");
});

Deno.test("ADV-02 [ORCH-1066] all-protected batch is a no-op (no clobber, no delete)", () => {
  const SIGNAL = "romantic";
  const store: Row[] = [
    { place_id: "a", signal_id: SIGNAL, score: 200, contributions: { _admin_pin: 1 } },
    { place_id: "b", signal_id: SIGNAL, score: 188, contributions: { _admin_set: 1 } },
    { place_id: "c", signal_id: SIGNAL, score: 160, contributions: { _admin_override: 1 } },
  ];
  const { writtenIds, deletedIds } = rescoreMixedBatch(
    store,
    SIGNAL,
    [{ place_id: "a", score: 50 }, { place_id: "b", score: 40 }],
    ["c"],
  );
  assertEquals(writtenIds, [], "no writes when every touched row is admin-protected");
  assertEquals(deletedIds, [], "no deletes when every veto target is admin-protected");
  assertEquals(store.find((r) => r.place_id === "a")!.score, 200);
  assertEquals(store.find((r) => r.place_id === "b")!.score, 188);
  assertEquals(store.find((r) => r.place_id === "c")!.score, 160);
});

Deno.test("ADV-03 [ORCH-1066] a place pinned for signal X is NOT protected on a re-score of signal Y", () => {
  // Cross-signal isolation: stickiness is per (place_id, signal_id). A pin on
  // 'drinks' must NOT shield the SAME place's 'romantic' computed row.
  const PLACE = "multi-signal-place";
  const store: Row[] = [
    { place_id: PLACE, signal_id: "drinks", score: 200, contributions: { _admin_pin: 1 } },
    { place_id: PLACE, signal_id: "romantic", score: 80, contributions: { _rating_scale: 6 } },
  ];
  // Re-score 'romantic' only.
  rescoreMixedBatch(store, "romantic", [{ place_id: PLACE, score: 140 }], []);
  assertEquals(
    store.find((r) => r.place_id === PLACE && r.signal_id === "drinks")!.score,
    200,
    "the drinks pin is untouched (different signal)",
  );
  assertEquals(
    store.find((r) => r.place_id === PLACE && r.signal_id === "romantic")!.score,
    140,
    "the romantic computed row IS re-scored — pin on drinks must not leak across signals",
  );
});

Deno.test("ADV-04 [ORCH-1066] scorer body uses REVERSE splice for both batches (forward-splice would skip)", () => {
  // A forward splice (`for (let i=0; i<arr.length; i++) arr.splice(i,1)`) skips the
  // element after each removal, leaking an admin row when two protected rows are
  // adjacent. Lock the descending iteration in source for BOTH arrays.
  assertStringIncludes(
    SCORER_SOURCE,
    "for (let i = writes.length - 1; i >= 0; i--)",
    "scorer must reverse-splice the writes batch (forward splice skips adjacent protected rows)",
  );
  assertStringIncludes(
    SCORER_SOURCE,
    "for (let i = vetoedPlaceIds.length - 1; i >= 0; i--)",
    "scorer must reverse-splice the veto-delete batch",
  );
  // And the protected set must be built from the COMMITTED pre-read, not from the
  // in-flight computed contributions (which carry no admin marker).
  assertStringIncludes(
    SCORER_SOURCE,
    "from('place_scores')",
    "scorer must pre-read committed place_scores to find admin markers",
  );
});

Deno.test("ADV-05 [ORCH-1066] sticky pre-read FAILS CLOSED (500), never silently clobbers", () => {
  // The load-bearing fail-safe: if the pre-read of existing overrides errors, the
  // scorer must abort with 500 BEFORE the upsert/delete batches run — never
  // proceed and risk clobbering an admin pin it couldn't see.
  const idxPreRead = SCORER_SOURCE.indexOf("sticky override pre-read failed");
  const idxUpsert = SCORER_SOURCE.indexOf(".upsert(chunk, { onConflict: 'place_id,signal_id' })");
  assert(idxPreRead > 0, "fail-close 500 branch must exist for the sticky pre-read");
  assert(idxUpsert > 0, "the upsert batch must exist");
  assert(
    idxPreRead < idxUpsert,
    "the fail-close return must be positioned BEFORE the upsert (abort, do not clobber)",
  );
  assertStringIncludes(
    SCORER_SOURCE,
    "status: 500",
    "sticky pre-read failure must return HTTP 500 (Constitution #5 — no silent failure)",
  );
});
