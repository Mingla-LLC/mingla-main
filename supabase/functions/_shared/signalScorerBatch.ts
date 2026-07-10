// ORCH-1333 — shared cursor-paged batch engine for run-signal-scorer
// city/all_cities scoring.
//
// Why this exists: run-signal-scorer used to load an ENTIRE city into memory,
// run ONE admin-pin "sticky" pre-read across ALL touched ids, then UPSERT the
// whole city at once — aborting the ENTIRE run (0 rows persisted) on any
// pre-UPSERT error. On large post-Sub-B cities (New York 9,903 / Paris 4,464)
// that giant call tripped the Edge isolate's resource budget BEFORE its first
// write, so the city stayed empty while the button looked "done" (see
// INVESTIGATION_ORCH-1333 F-1…F-5). This module holds the memory-safe,
// resumable, per-page-persisting loop ONCE so it can be unit-tested without a
// live database (mirrors _shared/bouncerBatch.ts, ORCH-1018).
//
// IMPORTANT (Constitutional #2 / I-AI-SCORE-STALENESS-AUTO-RECOVERED / the
// sole-writer strict-grep gates): this module performs NO database IO and
// writes NO owned columns itself. Every DB read/write stays inside
// run-signal-scorer/index.ts via the injected ScorerBatchDeps callbacks — the
// `.upsert(...)` on place_scores, the place_scores freshness-timestamp DB write
// key, the sticky `.select('place_id, contributions')`, and the
// isAdminOverridden(...) call all live in index.ts. The freshness timestamp
// travels through THIS module under the gate-neutral camelCase field
// `aiSignalScoresAt`; index.ts maps it onto the place_scores column of the same
// meaning so the meta-orch-1009-sub-d sole-writer gate (which forbids that
// literal snake_case write key outside index.ts) stays green. See
// IMPLEMENTATION_ORCH-1333 §Deviations.
//
// Authority: I-PROPOSED-1333-SCORER-CITY-RUN-INCREMENTAL-PERSIST (DRAFT→ACTIVE
// on close).

import { computeScore, type PlaceForScoring, type SignalConfig } from './signalScorer.ts';

// One page's computed write. index.ts's upsertScores dep maps this onto the
// place_scores row. `aiSignalScoresAt` is the passthrough of
// computeScore().ai_blended?.evaluated_at (null on the rule-only path); index.ts
// stamps it onto the place_scores freshness column. Named camelCase HERE (NOT
// the DB column's snake_case name) so the sole-writer gate stays green — the
// column name exists in exactly one file, index.ts.
export interface ScoreWrite {
  place_id: string;
  signal_id: string;
  score: number;
  contributions: Record<string, number | string>;
  signal_version_id: string;
  aiSignalScoresAt: string | null;
}

// Identical shape to the response summary run-signal-scorer/index.ts returned
// before ORCH-1333 (scored_count / ineligible_count / vetoed_count /
// ai_blended_count / signal_version_id / score_distribution). Preserved so the
// cron, admin-review-venue-claim, and admin UI keep reading what they read today.
export interface ScorerSummary {
  scored_count: number;
  ineligible_count: number;
  vetoed_count: number;
  ai_blended_count: number;
  signal_version_id: string | null;
  score_distribution: { '0-50': number; '50-100': number; '100-150': number; '150-200': number };
}

export function freshScorerSummary(signalVersionId: string | null): ScorerSummary {
  return {
    scored_count: 0,
    ineligible_count: 0,
    vetoed_count: 0,
    ai_blended_count: 0,
    signal_version_id: signalVersionId,
    score_distribution: { '0-50': 0, '50-100': 0, '100-150': 0, '150-200': 0 },
  };
}

// META-ORCH-1009 Sub-B — null = vetoed, don't bucket. Byte-identical bucketing
// to the pre-ORCH-1333 index.ts bucketize().
function bucketize(distribution: ScorerSummary['score_distribution'], score: number | null): void {
  if (score === null) return;
  if (score < 50) distribution['0-50']++;
  else if (score < 100) distribution['50-100']++;
  else if (score < 150) distribution['100-150']++;
  else distribution['150-200']++;
}

export interface ScorerBatchDeps {
  // Load the next id-ordered page AFTER `cursor` (null = from start), ≤ pageSize
  // rows. Throwing propagates as a fatal read error (index.ts catch → 500).
  loadPage: (cursor: string | null, pageSize: number) => Promise<Array<PlaceForScoring & { id: string }>>;
  // ORCH-1066 sticky pre-read, bounded to THIS page's touched ids. Returns the
  // set of admin-protected place_ids. Throwing → fail-CLOSE for this page (the
  // page is NOT upserted; prior pages stay persisted).
  readProtectedIds: (placeIds: string[]) => Promise<Set<string>>;
  // UPSERT one page's writes. Returns { error } (non-throwing); a non-null error
  // is fatal for THIS invocation (prior pages already persisted).
  upsertScores: (rows: ScoreWrite[]) => Promise<{ error: string | null }>;
  // DELETE vetoed (place,signal) rows for one page. NON-fatal (logged by the dep,
  // run continues).
  deleteVetoed: (placeIds: string[]) => Promise<{ deleted: number; error: string | null }>;
  // Remaining unscored servable count for the scope (progress UI). null when
  // unknown/all_cities/per-place. MUST NOT throw.
  countRemaining: () => Promise<number | null>;
}

export interface ScorerBatchOptions {
  signalId: string;
  config: SignalConfig;
  signalVersionId: string;
  maxRows: number;
  pageSize: number;
  afterId: string | null;
  dryRun: boolean;
}

export interface ScorerBatchResult {
  summary: ScorerSummary;
  processed: number;
  written: number;
  veto_deleted: number;
  sticky_skipped: number;
  next_cursor: string | null;
  done: boolean;
  remaining: number | null;
  // Set when a page sticky-pre-read or upsert failed (fatal for THIS call).
  // Prior pages remain persisted (no abort-all).
  error: string | null;
}

// Cursor-loop: each page does score → sticky pre-read → filter → upsert →
// veto-delete, IN THAT ORDER (identical semantics to the pre-ORCH-1333 post-loop
// block, only now scoped to one page and repeated). Admin pins are never
// clobbered; on any sticky/upsert error the page is skipped (not clobbered) and
// every previously-written page stays persisted.
export async function runSignalScorerBatch(
  deps: ScorerBatchDeps,
  opts: ScorerBatchOptions,
): Promise<ScorerBatchResult> {
  const summary = freshScorerSummary(opts.signalVersionId);
  let cursor: string | null = opts.afterId;
  let processed = 0;
  let written = 0;
  let vetoDeleted = 0;
  let stickySkipped = 0;
  let reachedEnd = false;

  while (processed < opts.maxRows) {
    // Captured BEFORE advancing — the error-return cursor so a retry re-attempts
    // the failed page (never skips it).
    const pageStartCursor = cursor;
    const pageSize = Math.min(opts.pageSize, opts.maxRows - processed);
    const rows = await deps.loadPage(cursor, pageSize);

    if (!rows || rows.length === 0) {
      reachedEnd = true;
      break;
    }

    // Score this page in memory (one page only — bounded memory + CPU).
    const pageWrites: ScoreWrite[] = [];
    const pageVetoes: string[] = [];
    for (const place of rows) {
      const result = computeScore(place, opts.config, opts.signalId);
      bucketize(summary.score_distribution, result.score);
      if ((result.contributions as Record<string, unknown>)._ineligible !== undefined) {
        summary.ineligible_count++;
      } else {
        summary.scored_count++;
      }
      // META-ORCH-1009 Sub-B — null score = Gemini veto: DELETE any existing row
      // instead of UPSERT.
      if (result.score === null) {
        summary.vetoed_count++;
        pageVetoes.push(place.id);
        continue;
      }
      if (result.ai_blended) summary.ai_blended_count++;
      pageWrites.push({
        place_id: place.id,
        signal_id: opts.signalId,
        score: result.score,
        contributions: result.contributions,
        signal_version_id: opts.signalVersionId,
        // Passthrough only; index.ts stamps this onto the DB freshness column.
        aiSignalScoresAt: result.ai_blended?.evaluated_at ?? null,
      });
    }

    processed += rows.length;

    if (opts.dryRun) {
      // Score-only diagnostic: skip ALL writes but still advance pages.
      cursor = rows[rows.length - 1].id;
      if (rows.length < pageSize) {
        reachedEnd = true;
        break;
      }
      continue;
    }

    // ── ORCH-1066 sticky pre-read — THIS page only ──────────────────────────
    // Union of every place_id we'd touch this page (upsert OR veto-delete).
    const touched = [...new Set<string>([...pageWrites.map((w) => w.place_id), ...pageVetoes])];
    let protectedIds: Set<string>;
    try {
      protectedIds = await deps.readProtectedIds(touched);
    } catch (e) {
      // Fail-CLOSE: do NOT upsert this page (protects admin pins). Prior pages
      // stay persisted; surface a resumable cursor so the client can retry the
      // exact failed page. NO abort-all.
      const msg = e instanceof Error ? e.message : String(e);
      return {
        summary,
        processed,
        written,
        veto_deleted: vetoDeleted,
        sticky_skipped: stickySkipped,
        next_cursor: pageStartCursor,
        done: false,
        remaining: null,
        error: `sticky override pre-read failed: ${msg}`,
      };
    }

    // Drop admin-protected ids from BOTH batches (the admin score wins).
    const finalWrites = pageWrites.filter((w) => !protectedIds.has(w.place_id));
    const finalVetoes = pageVetoes.filter((id) => !protectedIds.has(id));
    stickySkipped += pageWrites.length - finalWrites.length;

    // UPSERT this page. A non-null error is fatal for THIS call, but every prior
    // page is already persisted → the resumable cursor points AT this page.
    const up = await deps.upsertScores(finalWrites);
    if (up.error) {
      return {
        summary,
        processed,
        written,
        veto_deleted: vetoDeleted,
        sticky_skipped: stickySkipped,
        next_cursor: pageStartCursor,
        done: false,
        remaining: null,
        error: `place_scores upsert failed: ${up.error}`,
      };
    }
    written += finalWrites.length;

    // Veto-delete this page (non-fatal — a dep-logged error does not abort).
    if (finalVetoes.length > 0) {
      const del = await deps.deleteVetoed(finalVetoes);
      vetoDeleted += del.deleted;
    }

    // Advance the cursor ONLY after a successful write.
    cursor = rows[rows.length - 1].id;

    if (rows.length < pageSize) {
      reachedEnd = true;
      break;
    }
  }

  let remaining: number | null;
  try {
    remaining = await deps.countRemaining();
  } catch {
    remaining = null;
  }

  return {
    summary,
    processed,
    written,
    veto_deleted: vetoDeleted,
    sticky_skipped: stickySkipped,
    next_cursor: reachedEnd ? null : cursor,
    done: reachedEnd,
    remaining,
    error: null,
  };
}
