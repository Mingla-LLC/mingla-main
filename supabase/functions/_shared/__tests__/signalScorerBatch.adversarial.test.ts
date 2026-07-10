// ORCH-1333 — adversarial regression tests for the cursor-paged signal-scoring
// engine (_shared/signalScorerBatch.ts). A DIFFERENT angle than the happy-path
// file: the two failure modes that made the whole-city scorer persist 0 rows for
// New York + Paris (INVESTIGATION_ORCH-1333 F-4/F-5) and the ORCH-1066 admin-pin
// stickiness that MUST hold per page.
//
//   T-B — a per-page sticky pre-read failure MUST NOT abort-all. The pre-ORCH-1333
//         code ran ONE sticky pre-read across the whole city then ONE UPSERT, so
//         a single pre-UPSERT error stranded the ENTIRE city at 0 written. This
//         asserts pages before the failure stay persisted and the run is
//         resumable at the exact failed page.
//   T-C — an admin-pinned place (ORCH-1066 _admin_pin/_admin_set/_admin_override)
//         is NEITHER re-scored (upserted) NOR veto-deleted, enforced per page.
//
// Fails-on-revert: reinstating accumulate-then-write-all makes T-B see written=0
// (RED); dropping the per-page sticky filter makes T-C upsert the protected place
// (RED).
//
// Run: cd supabase && deno test --allow-read --no-check \
//   functions/_shared/__tests__/signalScorerBatch.adversarial.test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  runSignalScorerBatch,
  type ScoreWrite,
  type ScorerBatchDeps,
} from '../signalScorerBatch.ts';
import { type PlaceForScoring, type SignalConfig } from '../signalScorer.ts';

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

function makeStore(
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

const OPTS = {
  signalId: 'lively',
  config: CONFIG,
  signalVersionId: 'ver-1',
  maxRows: 1500,
  pageSize: 500,
  afterId: null as string | null,
  dryRun: false,
};

Deno.test('T-B [ORCH-1333 adversarial] sticky failure mid-run keeps prior pages + is resumable (NO abort-all)', async () => {
  const store = makeStore(1500, { stickyThrowOnCall: 3 });
  const result = await runSignalScorerBatch(store.deps, { ...OPTS });

  // The load-bearing assertion: pages 1-2 persisted BEFORE the page-3 failure.
  // Reverting to accumulate-then-write-all makes this 0.
  assertEquals(result.written, 1000, 'incremental persist: 2 pages landed before the failure');
  assertEquals(store.upserted.size, 1000, 'prior pages remain in the store — never wiped');
  assert(result.error !== null, 'the page error is surfaced (Constitution #5)');
  assertEquals(result.done, false, 'resumable, not done');
  assertEquals(result.next_cursor, 'p01000', 'cursor re-attempts the failed page');
});

Deno.test('T-B2 [ORCH-1333 adversarial] a page UPSERT error also persists prior pages + resumes', async () => {
  // Same abort-all guard on the OTHER fatal path: the UPSERT itself failing.
  const store = makeStore(1500);
  let upsertCalls = 0;
  const failingDeps: ScorerBatchDeps = {
    ...store.deps,
    upsertScores: (rows) => {
      upsertCalls++;
      if (upsertCalls === 3) return Promise.resolve({ error: 'simulated upsert failure' });
      for (const r of rows) store.upserted.set(r.place_id, r);
      return Promise.resolve({ error: null });
    },
  };
  const result = await runSignalScorerBatch(failingDeps, { ...OPTS });

  assertEquals(result.written, 1000, 'pages 1-2 persisted before the page-3 upsert failure');
  assert(/place_scores upsert failed/.test(result.error ?? ''), 'upsert error surfaced');
  assertEquals(result.done, false);
  assertEquals(result.next_cursor, 'p01000', 'resumable at the failed page');
});

Deno.test('T-C [ORCH-1333 adversarial] admin-pinned place is neither re-scored nor veto-deleted (per page)', async () => {
  const PROTECTED = 'p00003';
  const store = makeStore(600, { protectedFor: new Set([PROTECTED]) });
  const result = await runSignalScorerBatch(store.deps, { ...OPTS });

  assert(!store.upserted.has(PROTECTED), 'admin-pinned place is NOT re-scored (upsert skipped)');
  assert(!store.vetoDeleted.has(PROTECTED), 'admin-pinned place is NOT veto-deleted');
  assertEquals(result.sticky_skipped, 1, 'exactly the protected write is counted as skipped');
  assertEquals(result.written, 599, 'every other servable place still persisted');
  assertEquals(store.upserted.size, 599);
  assertEquals(result.done, true);
});
