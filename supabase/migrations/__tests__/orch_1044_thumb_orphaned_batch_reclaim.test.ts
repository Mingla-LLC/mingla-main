// ORCH-1044 [Thumbnail generation must fit the edge compute budget + reliably
// drain] — migration regression test (T-02): orphaned 'running'-batch reclaim.
//
// Read-only assertions against the parsed migration SQL (the tester does NOT
// apply migrations — Discipline Rule 13). This locks the reclaim contract so a
// future "tidy-up" cannot silently drop step (c), widen the stale bound away
// from the locked floor, touch run counters on reclaim, break the discriminator
// scoping, or weaken the SECURITY DEFINER boundary.
//
// Root Cause 2 (proven live): a 546-killed process_chunk leaves its claimed
// batch in 'running' with no terminal write, and nothing ever resets it — so
// the run can never reach completion (live DB: 11 orphaned 'running' batches
// froze run 7b782c45 at 1/691). The fix extends tg_kick_pending_thumb_backfill()
// with a step (c) that resets stale 'running' batches → 'pending'.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const migrationRaw = await Deno.readTextFile(
  new URL(
    "../20260818000000_orch_1044_thumb_orphaned_batch_reclaim.sql",
    import.meta.url,
  ),
);

// Strip SQL line comments (-- …) so prose in the docs/rollback reference blocks
// (which legitimately MENTION DROP/counter/interval words to explain) never
// trips an executable-statement scan.
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}
const migration = stripSqlComments(migrationRaw);
const collapsed = migration.replace(/\s+/g, " ");

// ── T-02a: extends the existing kicker fn (CREATE OR REPLACE, SECURITY DEFINER) ─
Deno.test("T-02a reclaim is added to tg_kick_pending_thumb_backfill (CREATE OR REPLACE, SECURITY DEFINER preserved)", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.tg_kick_pending_thumb_backfill\(\)/i.test(migration),
    "must CREATE OR REPLACE public.tg_kick_pending_thumb_backfill() (idempotent extend, not a new fn)",
  );
  assert(
    /tg_kick_pending_thumb_backfill[\s\S]*SECURITY DEFINER/i.test(migration),
    "kicker function must remain SECURITY DEFINER",
  );
  // Never embed a literal service-role JWT (the kicker reads it from vault).
  assert(!/Bearer\s+eyJ/.test(migrationRaw), "must NOT embed a literal service-role JWT");
});

// ── T-02b: the reclaim UPDATE flips stale 'running' → 'pending', clears started_at ─
Deno.test("T-02b reclaim resets stale running batches to pending and clears started_at", () => {
  // UPDATE photo_backfill_batches SET status='pending', started_at=NULL ... WHERE b.status='running'
  assert(
    /UPDATE public\.photo_backfill_batches/i.test(migration),
    "must UPDATE public.photo_backfill_batches",
  );
  assert(
    /SET\s+status\s*=\s*'pending'\s*,\s*started_at\s*=\s*NULL/i.test(collapsed),
    "reclaim must SET status='pending', started_at=NULL",
  );
  assert(
    /b\.status\s*=\s*'running'/i.test(collapsed),
    "reclaim must only target batches currently in status='running'",
  );
});

// ── T-02c: stale bound is the LOCKED 3-minute floor (started_at older than 3 min) ─
Deno.test("T-02c reclaim stale bound is 3 minutes (and tolerates NULL started_at)", () => {
  assert(
    /started_at\s+IS\s+NULL\s+OR\s+b?\.?started_at\s*<\s*now\(\)\s*-\s*interval '3 minutes'/i.test(collapsed),
    "stale bound must be (started_at IS NULL OR started_at < now() - interval '3 minutes')",
  );
});

// ── T-02d: scoped to the active servable thumbs run discriminator only ──────────
Deno.test("T-02d reclaim is scoped to the active servable thumbs run (discriminator + status='running')", () => {
  // Joined to photo_backfill_runs filtered by the ORCH-0957 thumbs discriminator,
  // GLOBAL country, and run status='running' — never touches other runs/Photos runs.
  assert(
    /city\s*=\s*'ORCH-0957 place-photo thumbs'/i.test(migration),
    "reclaim must scope to the thumbs discriminator city",
  );
  assert(
    /country\s*=\s*'GLOBAL'/i.test(migration),
    "reclaim must scope to country='GLOBAL'",
  );
  // The run side of the join must require the RUN to be 'running' too.
  assert(
    /run\.status\s*=\s*'running'/i.test(collapsed),
    "reclaim must only act on batches of an actively-running thumbs run",
  );
});

// ── T-02e: reclaim does NOT touch run counters (status-only reset) ──────────────
Deno.test("T-02e reclaim does NOT mutate run counters (no double-count risk)", () => {
  // The reclaim UPDATE targets photo_backfill_batches and sets ONLY status +
  // started_at. There must be NO counter columns in the reclaim's SET clause.
  const reclaimStart = collapsed.search(/UPDATE public\.photo_backfill_batches b SET/i);
  assert(reclaimStart >= 0, "reclaim UPDATE must exist");
  const reclaimStmt = collapsed.slice(reclaimStart, collapsed.indexOf(";", reclaimStart));
  for (const counter of ["completed_batches", "failed_batches", "total_succeeded", "total_failed", "succeeded", "failed", "skipped"]) {
    assert(
      !new RegExp(`${counter}\\s*=`, "i").test(reclaimStmt),
      `reclaim must NOT write the ${counter} counter (status-only reset, no double-count)`,
    );
  }
});

// ── T-02f: reclaim runs BEFORE the ensure/re-kick steps (LOCKED ordering) ───────
Deno.test("T-02f reclaim (c) runs before ensure_auto_run (a) and stale-heartbeat re-kick (b)", () => {
  const reclaimIdx = migration.search(/UPDATE public\.photo_backfill_batches/i);
  const ensureIdx = migration.search(/'action',\s*'ensure_auto_run'/i);
  const rekickIdx = migration.search(/'action',\s*'process_chunk'/i);
  assert(reclaimIdx >= 0, "reclaim must exist");
  assert(ensureIdx >= 0, "ensure_auto_run POST must exist");
  assert(rekickIdx >= 0, "process_chunk re-kick POST must exist");
  assert(reclaimIdx < ensureIdx, "reclaim must precede the ensure_auto_run POST");
  assert(reclaimIdx < rekickIdx, "reclaim must precede the stale-heartbeat process_chunk re-kick");
});

// ── T-02g (adversarial): additive/idempotent — no destructive ops ───────────────
Deno.test("T-02g migration is non-destructive (no DROP/TRUNCATE/type-change/NOT NULL)", () => {
  assert(!/DROP TABLE/i.test(migration), "must NOT DROP TABLE");
  assert(!/TRUNCATE/i.test(migration), "must NOT TRUNCATE");
  assert(!/ALTER COLUMN[\s\S]*?TYPE/i.test(migration), "must NOT change an existing column TYPE");
  assert(!/SET NOT NULL/i.test(migration), "must NOT add SET NOT NULL to an existing column");
  // The preflight may RAISE EXCEPTION only for the hard ORCH-1043 dependency
  // (the function we extend must exist) — that is the ONLY allowed exception.
  const exceptions = migration.match(/RAISE EXCEPTION/gi) ?? [];
  assertEquals(exceptions.length, 1, "the only RAISE EXCEPTION is the ORCH-1043 prereq preflight guard");
  assert(
    /tg_kick_pending_thumb_backfill[\s\S]*?RAISE EXCEPTION/i.test(migration),
    "the one exception must guard the tg_kick_pending_thumb_backfill prerequisite",
  );
});
