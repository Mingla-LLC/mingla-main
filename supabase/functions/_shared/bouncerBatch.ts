// ORCH-1018 — shared cursor-paged batch runner for the two Bouncer passes.
//
// Why this exists: both run-bouncer (final) and run-pre-photo-bouncer used to
// load an ENTIRE city into memory and fire one giant write burst, then abort
// the whole run on the first per-row error. On large cities that blew the Edge
// runtime's compute budget (HTTP 546) and never finished. This module holds the
// memory-safe, resumable, non-aborting loop ONCE so both passes share it and it
// can be unit-tested without a live database.
//
// IMPORTANT (Constitutional #2 / I-*-SOLE-WRITER): this module performs NO
// column writes itself. The actual `.update({ <owned columns> })` stays inside
// each pass's own index.ts via the injected `writeRow` callback, preserving the
// sole-writer invariants enforced by the strict-grep gate.

import { bounce, type PlaceRow, type Cluster, type BouncerVerdict } from './bouncer.ts';

export interface BouncerSummary {
  pass_count: number;
  reject_count: number;
  by_cluster: Record<Cluster, { pass: number; reject: number }>;
  by_reason: Record<string, number>;
}

export function freshSummary(): BouncerSummary {
  return {
    pass_count: 0,
    reject_count: 0,
    by_cluster: {
      A_COMMERCIAL: { pass: 0, reject: 0 },
      B_CULTURAL: { pass: 0, reject: 0 },
      C_NATURAL: { pass: 0, reject: 0 },
      EXCLUDED: { pass: 0, reject: 0 },
    },
    by_reason: {},
  };
}

export interface BatchDeps {
  // Load the next page of id-ordered rows AFTER `cursor` (null = from start),
  // at most `pageSize` rows. Throwing propagates (fatal read error).
  loadPage: (cursor: string | null, pageSize: number) => Promise<PlaceRow[]>;
  // Persist one row's verdict. Return `{ error }` for a non-fatal per-row
  // failure (counted, run continues) — NEVER throw for an expected row error.
  writeRow: (place: PlaceRow, verdict: BouncerVerdict) => Promise<{ error?: string | null }>;
  // How many rows remain unjudged for this scope (for caller progress UI).
  countRemaining: () => Promise<number | null>;
}

export interface BatchOptions {
  maxRows: number;
  pageSize: number;
  writeConcurrency: number;
  dryRun: boolean;
  afterId: string | null;
  bounceOpts?: { skipStoredPhotoCheck?: boolean };
}

export interface BatchResult {
  summary: BouncerSummary;
  processed: number;
  written: number;
  write_errors: number;
  first_write_error: string | null;
  next_cursor: string | null;
  done: boolean;
  remaining: number | null;
}

export async function runBouncerBatch(deps: BatchDeps, opts: BatchOptions): Promise<BatchResult> {
  const summary = freshSummary();
  let cursor: string | null = opts.afterId;
  let processed = 0;
  let written = 0;
  let writeErrors = 0;
  let firstWriteError: string | null = null;
  let reachedEnd = false;

  while (processed < opts.maxRows) {
    const pageSize = Math.min(opts.pageSize, opts.maxRows - processed);
    const rows = await deps.loadPage(cursor, pageSize);

    if (!rows || rows.length === 0) {
      reachedEnd = true;
      break;
    }

    // Evaluate this page in memory (one page only — bounded memory).
    const verdicts: Array<{ place: PlaceRow; verdict: BouncerVerdict }> = [];
    for (const place of rows) {
      const verdict = bounce(place, opts.bounceOpts);
      if (verdict.is_servable) {
        summary.pass_count++;
        summary.by_cluster[verdict.cluster].pass++;
      } else {
        summary.reject_count++;
        summary.by_cluster[verdict.cluster].reject++;
        for (const r of verdict.reasons) {
          summary.by_reason[r] = (summary.by_reason[r] || 0) + 1;
        }
      }
      verdicts.push({ place, verdict });
    }

    processed += rows.length;
    cursor = rows[rows.length - 1].id;

    // Concurrency-limited writes; a per-row error is COUNTED, never fatal.
    if (!opts.dryRun) {
      for (let i = 0; i < verdicts.length; i += opts.writeConcurrency) {
        const chunk = verdicts.slice(i, i + opts.writeConcurrency);
        const results = await Promise.all(chunk.map((v) => deps.writeRow(v.place, v.verdict)));
        for (const r of results) {
          if (r?.error) {
            writeErrors++;
            if (!firstWriteError) firstWriteError = r.error;
          } else {
            written++;
          }
        }
      }
    }

    if (rows.length < pageSize) {
      reachedEnd = true;
      break;
    }
  }

  const remaining = await deps.countRemaining();

  return {
    summary,
    processed,
    written,
    write_errors: writeErrors,
    first_write_error: firstWriteError,
    next_cursor: reachedEnd ? null : cursor,
    done: reachedEnd,
    remaining,
  };
}
