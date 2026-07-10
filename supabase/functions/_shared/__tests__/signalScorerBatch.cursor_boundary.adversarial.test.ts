// ORCH-1333 — TESTER-OWNED adversarial regression tests for the cursor-paged
// signal-scoring engine (_shared/signalScorerBatch.ts).
//
// DIFFERENT ANGLE than both implementor files (signalScorerBatch.test.ts and
// signalScorerBatch.adversarial.test.ts). Those attack the single-call,
// maxRows=1500 path and assert only that prior pages persist after a mid-run
// failure. This file attacks the properties they leave uncovered:
//
//   TC-1 — RESUME EQUIVALENCE + NO DOUBLE-WRITE ACROSS THE FAILURE SEAM.
//          An interrupted-then-resumed run must reconstruct the EXACT end-state
//          of an uninterrupted run: same id set, same scores, and — critically —
//          every place upserted EXACTLY ONCE (no page is re-emitted after a
//          resume, no page is skipped across the seam). The implementor asserts
//          `written==1000` after the failure but never that the RESUMED run
//          completes to a byte-identical, duplicate-free end-state.
//
//   TC-2 — THE REAL PRODUCTION CITY-MODE LOOP (maxRows == pageSize == 500),
//          driven the way SignalLibraryPage.runScorerToCompletion drives it,
//          across an EXACTLY-DIVISIBLE total (1000 = 2×500). Every implementor
//          test uses maxRows=1500 (three pages in ONE call) or a non-divisible
//          750; none exercises the shipped SCORER_MAX_ROWS_PER_CALL=500 path
//          where the client loops one page per call. Proves: it TERMINATES, the
//          exactly-full final data page does NOT prematurely report done (the
//          empty terminator call is required — off-by-one guard), and every id
//          is covered EXACTLY ONCE with no duplicate across call boundaries.
//
//   TC-3 — ADMIN-PIN ON THE LAST (SHORT) PAGE. The implementor's T-C protects a
//          page-1 id. This protects an id on the final PARTIAL page to prove the
//          per-page sticky filter runs on the short last page too (before the
//          reachedEnd break), so ORCH-1066 stickiness holds on the last page.
//
// Fails-on-revert: reinstating accumulate-then-write-all (a single post-loop
// UPSERT / abort-all-on-sticky-error) makes TC-1's mid-run checkpoint see the
// store holding 0 (not 1000) rows after the page-3 failure, and the resumed
// end-state diverges from the uninterrupted golden — RED. Verified by true
// line-deletion of the per-page upsert (see QA_ORCH-1333 report §Adversarial).
//
// Run: cd supabase && deno test --allow-read --no-check \
//   functions/_shared/__tests__/signalScorerBatch.cursor_boundary.adversarial.test.ts
//
// [TEST-MOD-APPROVED ORCH-1333]

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  runSignalScorerBatch,
  type ScoreWrite,
  type ScorerBatchDeps,
} from '../signalScorerBatch.ts';
import { type PlaceForScoring, type SignalConfig } from '../signalScorer.ts';

// Permissive gates → every fabricated place scores non-null / non-ineligible /
// non-veto, so the write count is deterministic.
const CONFIG: SignalConfig = {
  min_rating: 3.0,
  min_reviews: 0,
  bypass_rating: 5.0,
  field_weights: {},
  scale: { rating_multiplier: 20, rating_cap: 100, reviews_log_multiplier: 10, reviews_cap: 50 },
  text_patterns: {},
  cap: 200,
  clamp_min: 0,
};

const SIGNAL_ID = 'lively';
const SIGNAL_VERSION_ID = 'ver-1';

// Zero-padded id so lexical order === numeric order (matches .order('id')).
function makePlace(i: number): PlaceForScoring & { id: string } {
  return {
    id: `p${String(i).padStart(5, '0')}`,
    rating: 4.5,
    review_count: 100,
    types: null,
    price_level: null,
    price_range_start_cents: null,
    price_range_end_cents: null,
    editorial_summary: null,
    generative_summary: null,
    reviews: null,
    ai_signal_scores: null,
  };
}

// Fake place_pool slice (id-ordered) + place_scores. Tracks per-id upsert COUNTS
// (not just presence) so a double-write across a resume seam is detectable.
function makeStore(
  total: number,
  opts: { protectedFor?: Set<string>; stickyThrowOnCall?: number } = {},
) {
  const all = Array.from({ length: total }, (_, i) => makePlace(i + 1));
  const upserted = new Map<string, ScoreWrite>();
  const upsertCounts = new Map<string, number>();
  const vetoDeleted = new Set<string>();
  let stickyCalls = 0;
  const deps: ScorerBatchDeps = {
    loadPage: (cursor, pageSize) => {
      const start = cursor ? all.findIndex((p) => p.id > cursor) : 0;
      return Promise.resolve(start < 0 ? [] : all.slice(start, start + pageSize));
    },
    readProtectedIds: (ids) => {
      stickyCalls++;
      if (opts.stickyThrowOnCall && stickyCalls === opts.stickyThrowOnCall) {
        return Promise.reject(new Error('simulated sticky pre-read failure'));
      }
      const out = new Set<string>();
      for (const id of ids) if (opts.protectedFor?.has(id)) out.add(id);
      return Promise.resolve(out);
    },
    upsertScores: (rows) => {
      for (const r of rows) {
        upserted.set(r.place_id, r);
        upsertCounts.set(r.place_id, (upsertCounts.get(r.place_id) ?? 0) + 1);
      }
      return Promise.resolve({ error: null });
    },
    deleteVetoed: (ids) => {
      for (const id of ids) vetoDeleted.add(id);
      return Promise.resolve({ deleted: ids.length, error: null });
    },
    countRemaining: () => Promise.resolve(null),
  };
  return {
    all,
    upserted,
    upsertCounts,
    vetoDeleted,
    get stickyCalls() { return stickyCalls; },
    deps,
  };
}

function baseOpts(over: Partial<Parameters<typeof runSignalScorerBatch>[1]> = {}) {
  return {
    signalId: SIGNAL_ID,
    config: CONFIG,
    signalVersionId: SIGNAL_VERSION_ID,
    maxRows: 1500,
    pageSize: 500,
    afterId: null as string | null,
    dryRun: false,
    ...over,
  };
}

Deno.test('TC-1 [ORCH-1333 tester] interrupted+resumed run == uninterrupted run, byte-identical, ZERO double-writes across the failure seam', async () => {
  const TOTAL = 1300; // 500 + 500 + 300

  // ── Golden: one uninterrupted run over 1300 rows. ──
  const golden = makeStore(TOTAL);
  const gResult = await runSignalScorerBatch(golden.deps, baseOpts());
  assertEquals(gResult.written, TOTAL, 'golden: every row written once');
  assertEquals(gResult.done, true, 'golden: done');
  assertEquals(golden.upserted.size, TOTAL, 'golden: all rows present');

  // ── Interrupted: same 1300 rows, sticky THROWS on its 3rd call (page 3). ──
  const store = makeStore(TOTAL, { stickyThrowOnCall: 3 });
  const r1 = await runSignalScorerBatch(store.deps, baseOpts());

  // Mid-run incremental-persist checkpoint (this is what a revert to
  // accumulate-then-write-all breaks — it would be 0 here):
  assertEquals(r1.written, 1000, 'pages 1-2 persisted BEFORE the page-3 failure');
  assertEquals(store.upserted.size, 1000, 'store holds pages 1-2 after the failure — NO abort-all/wipe');
  assert(r1.error !== null, 'the fatal page error is surfaced');
  assertEquals(r1.done, false, 'not done — the failed page is resumable');
  assertEquals(r1.next_cursor, 'p01000', 'cursor points AT the failed page (last id of page 2)');

  // ── Resume from the returned cursor; sticky no longer throws. Share the SAME
  // upserted store so we can detect any double-write of pages 1-2. ──
  const resumeDeps: ScorerBatchDeps = {
    ...store.deps,
    readProtectedIds: () => Promise.resolve(new Set<string>()),
  };
  const r2 = await runSignalScorerBatch(resumeDeps, baseOpts({ afterId: r1.next_cursor }));
  assertEquals(r2.done, true, 'resume reaches done');

  // Equivalence: the resumed end-state matches the uninterrupted golden EXACTLY.
  assertEquals(store.upserted.size, TOTAL, 'resume completes the whole city (no page skipped across the seam)');
  assertEquals(
    [...store.upserted.keys()].sort(),
    [...golden.upserted.keys()].sort(),
    'resumed id set == uninterrupted id set (no skip, no extra)',
  );
  for (const [id, w] of store.upserted) {
    assertEquals(w.score, golden.upserted.get(id)!.score, `score for ${id} matches golden`);
  }

  // NO DOUBLE-WRITE across the seam: page-3 rows (p01001..) were fail-closed
  // (never upserted) on r1, so resume writes them for the FIRST time; pages 1-2
  // are NOT re-emitted. Every id upserted exactly once across r1+r2.
  const maxWrites = Math.max(...store.upsertCounts.values());
  assertEquals(maxWrites, 1, 'every place upserted EXACTLY once across the interrupted+resumed sequence');
  assertEquals(store.upsertCounts.size, TOTAL, 'exactly the whole city was upserted');
});

Deno.test('TC-2 [ORCH-1333 tester] real city-mode loop (maxRows==pageSize==500) terminates across an exactly-divisible boundary, every id once, no premature done', async () => {
  const TOTAL = 1000; // EXACTLY 2 full pages of 500
  const PAGE = 500;
  const store = makeStore(TOTAL);

  // Drive it the way SignalLibraryPage.runScorerToCompletion does: one 500-row
  // page per call, feeding next_cursor as after_id, until done. Bound the loop
  // so a non-terminating cursor fails loudly instead of hanging.
  let cursor: string | null = null;
  let calls = 0;
  let sawDone = false;
  const perCallWritten: number[] = [];
  const doneFlags: boolean[] = [];
  const MAX_CALLS = 50;
  while (calls < MAX_CALLS) {
    calls += 1;
    const r = await runSignalScorerBatch(
      store.deps,
      baseOpts({ maxRows: PAGE, pageSize: PAGE, afterId: cursor }),
    );
    perCallWritten.push(r.written);
    doneFlags.push(r.done);
    if (r.done) { sawDone = true; break; }
    assert(r.next_cursor !== null, 'a non-done call must return a resume cursor');
    assert(r.next_cursor !== cursor, 'cursor must strictly advance (no infinite loop)');
    cursor = r.next_cursor;
  }

  assert(sawDone, 'the loop TERMINATES with a done:true call');
  assertEquals(calls, 3, 'exactly 3 calls: page1, page2, empty-terminator (exactly-divisible needs the terminator)');
  assertEquals(perCallWritten, [500, 500, 0], 'two full pages then the empty terminator');
  // Off-by-one guard: the SECOND call read a FULL final data page (500==pageSize)
  // so it must NOT prematurely report done — the boundary is only known empty on
  // the 3rd call.
  assertEquals(doneFlags, [false, false, true], 'full final data page does not prematurely report done');

  // Coverage: every id p00001..p01000 upserted exactly once, none skipped/dup.
  assertEquals(store.upserted.size, TOTAL, 'every servable place covered across the multi-call loop');
  assertEquals(Math.max(...store.upsertCounts.values()), 1, 'no id upserted twice across call boundaries');
  for (let i = 1; i <= TOTAL; i++) {
    assert(store.upserted.has(`p${String(i).padStart(5, '0')}`), `id p${String(i).padStart(5, '0')} was scored`);
  }
});

Deno.test('TC-3 [ORCH-1333 tester] admin-pin on the LAST (short) page is neither re-scored nor veto-deleted', async () => {
  const TOTAL = 1300; // pages 500, 500, 300 — the pin lives on the SHORT final page
  const PROTECTED = 'p01250'; // inside the last 300-row page
  const store = makeStore(TOTAL, { protectedFor: new Set([PROTECTED]) });
  const result = await runSignalScorerBatch(store.deps, baseOpts());

  assertEquals(result.done, true, 'run completes');
  assert(!store.upserted.has(PROTECTED), 'last-page admin-pin is NOT re-scored (upsert skipped)');
  assert(!store.vetoDeleted.has(PROTECTED), 'last-page admin-pin is NOT veto-deleted');
  assertEquals(result.sticky_skipped, 1, 'exactly the last-page protected write is counted as skipped');
  assertEquals(result.written, TOTAL - 1, 'every OTHER servable place across all three pages persisted');
  assertEquals(store.upserted.size, TOTAL - 1);
});
