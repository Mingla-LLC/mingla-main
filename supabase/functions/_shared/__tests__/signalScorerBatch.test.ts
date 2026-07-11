// ORCH-1333 — happy-path + load-bearing regression tests for the cursor-paged
// signal-scoring engine (_shared/signalScorerBatch.ts).
//
// WHY THIS EXISTS (do not delete — I-PROPOSED-1333-SCORER-CITY-RUN-INCREMENTAL-PERSIST):
// run-signal-scorer used to load an ENTIRE city into memory, run ONE admin-pin
// sticky pre-read across ALL touched ids, then UPSERT the whole city at once —
// so ANY pre-UPSERT error (F-4/F-5: the Edge isolate's resource budget on a
// large post-Sub-B city) aborted the ENTIRE run and persisted 0 rows. New York
// (9,903 servable) + Paris (4,464) were stuck at 35 / 15 scored while the button
// looked "done" (INVESTIGATION_ORCH-1333 F-1…F-5). The fix scores ONE bounded
// page per call, persisting each page as it goes, so a failure on page N can
// never wipe pages 1..N-1.
//
// These tests inject an in-memory fake store (mirrors bouncerBatch.test.ts's
// makeFakeStore) so the loop is proven behaviorally, with NO live database.
//
// Fails-on-revert: if the engine reverts to accumulate-then-write-all (a single
// post-loop UPSERT) or abort-all-on-sticky-error, the incremental-persist test
// (T-B) below flips written 1000 → 0 and RED. The multi-page (T-A) and resume
// (T-E) tests break if a future refactor drops a page or double-writes.
//
// Run: cd supabase && deno test --allow-read --no-check \
//   functions/_shared/__tests__/signalScorerBatch.test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  runSignalScorerBatch,
  type ScoreWrite,
  type ScorerBatchDeps,
} from '../signalScorerBatch.ts';
import { type PlaceForScoring, type SignalConfig } from '../signalScorer.ts';

// A config with permissive gates so every fabricated place SCORES (non-null,
// non-ineligible, non-veto) → deterministic write count. No AI slice → rule-only.
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

// In-memory fake of the place_pool slice (id-ordered) + place_scores table.
// protectedFor: ids the sticky pre-read reports as admin-protected.
// stickyThrowOnCall: 1-based call index on which readProtectedIds THROWS.
function makeFakeStore(
  total: number,
  opts: { protectedFor?: Set<string>; stickyThrowOnCall?: number } = {},
) {
  const all = Array.from({ length: total }, (_, i) => makePlace(i + 1));
  const upserted = new Map<string, ScoreWrite>();
  const vetoDeleted = new Set<string>();
  let stickyCalls = 0;
  const deps: ScorerBatchDeps = {
    loadPage: (cursor, pageSize) => {
      const start = cursor ? all.findIndex((p) => p.id > cursor) : 0;
      const slice = start < 0 ? [] : all.slice(start, start + pageSize);
      return Promise.resolve(slice);
    },
    readProtectedIds: (ids) => {
      stickyCalls++;
      if (opts.stickyThrowOnCall && stickyCalls === opts.stickyThrowOnCall) {
        return Promise.reject(new Error('simulated sticky pre-read failure'));
      }
      const out = new Set<string>();
      for (const id of ids) {
        if (opts.protectedFor?.has(id)) out.add(id);
      }
      return Promise.resolve(out);
    },
    upsertScores: (rows) => {
      for (const r of rows) upserted.set(r.place_id, r);
      return Promise.resolve({ error: null });
    },
    deleteVetoed: (ids) => {
      for (const id of ids) vetoDeleted.add(id);
      return Promise.resolve({ deleted: ids.length, error: null });
    },
    countRemaining: () => Promise.resolve(total - upserted.size),
  };
  return { all, upserted, vetoDeleted, get stickyCalls() { return stickyCalls; }, deps };
}

function baseOpts(over: Partial<Parameters<typeof runSignalScorerBatch>[1]> = {}) {
  return {
    signalId: SIGNAL_ID,
    config: CONFIG,
    signalVersionId: SIGNAL_VERSION_ID,
    maxRows: 1500,
    pageSize: 500,
    afterId: null,
    dryRun: false,
    ...over,
  };
}

Deno.test('T-A [ORCH-1333] processes an entire multi-page city via cursor paging, every id written once', async () => {
  const store = makeFakeStore(1200);
  const result = await runSignalScorerBatch(store.deps, baseOpts());

  assertEquals(result.processed, 1200, 'every servable row evaluated');
  assertEquals(result.written, 1200, 'every row written exactly once');
  assertEquals(store.upserted.size, 1200, 'all distinct rows persisted');
  assertEquals(result.summary.scored_count, 1200, 'all rows scored (permissive config)');
  assertEquals(result.done, true, 'run reports done when rows exhausted');
  assertEquals(result.next_cursor, null, 'no cursor once done');
  assertEquals(result.remaining, 0, 'zero rows left unscored');
  assertEquals(result.error, null, 'no error on the happy path');
});

Deno.test('T-B [ORCH-1333] a sticky pre-read failure on page 3 does NOT abort-all (pages 1-2 persist)', async () => {
  // F-4/F-5 guard: 1500 rows over three 500-row pages; readProtectedIds throws
  // on its 3rd call (page 3). Pages 1-2 MUST already be persisted.
  const store = makeFakeStore(1500, { stickyThrowOnCall: 3 });
  const result = await runSignalScorerBatch(store.deps, baseOpts());

  assertEquals(result.written, 1000, 'pages 1-2 (2×500) persisted before the page-3 failure');
  assertEquals(store.upserted.size, 1000, 'the store still holds pages 1-2 — NO abort-all/wipe');
  assert(result.error !== null, 'the fatal page error is surfaced');
  assert(/sticky override pre-read failed/.test(result.error ?? ''), 'error names the sticky pre-read');
  assertEquals(result.done, false, 'not done — the failed page is resumable');
  // next_cursor = id at the START of page 3 = last id of page 2 (p01000), so a
  // retry with after_id=next_cursor re-attempts page 3 (never skips it).
  assertEquals(result.next_cursor, 'p01000', 'resumable cursor points AT the failed page');
});

Deno.test('T-D [ORCH-1333] dry_run scores but writes nothing', async () => {
  const store = makeFakeStore(600);
  const result = await runSignalScorerBatch(store.deps, baseOpts({ dryRun: true }));

  assertEquals(result.written, 0, 'dry_run writes nothing');
  assertEquals(store.upserted.size, 0, 'store unchanged on dry_run');
  assertEquals(store.stickyCalls, 0, 'dry_run never runs the sticky pre-read');
  assertEquals(result.summary.scored_count, 600, 'dry_run still evaluates every row');
  assertEquals(result.done, true, 'short final page ⇒ done');
});

Deno.test('T-E [ORCH-1333] max_rows budget is resumable via next_cursor (union = all, no double-write)', async () => {
  const store = makeFakeStore(750);
  const opts = baseOpts({ maxRows: 500, pageSize: 500 });

  const r1 = await runSignalScorerBatch(store.deps, { ...opts, afterId: null });
  assertEquals(r1.processed, 500, 'first call bounded to one 500-row page');
  assertEquals(r1.done, false, 'not done — more rows remain');
  assert(r1.next_cursor !== null, 'returns a resume cursor');
  assertEquals(r1.written, 500);

  const r2 = await runSignalScorerBatch(store.deps, { ...opts, afterId: r1.next_cursor });
  assertEquals(r2.processed, 250, 'second call finishes the short final page');
  assertEquals(r2.done, true, 'short final page ⇒ done');
  assertEquals(r2.next_cursor, null);

  assertEquals(store.upserted.size, 750, 'every distinct row persisted exactly once across resumable calls');
});
