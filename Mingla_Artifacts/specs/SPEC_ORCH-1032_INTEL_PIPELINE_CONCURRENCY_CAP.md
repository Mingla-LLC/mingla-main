# SPEC — ORCH-1032 [Intelligence pipeline concurrency cap + chunked enqueue]

**Author:** mingla-forensics+claude (SPEC mode)
**Date:** 2026-06-01
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1032-[intel-pipeline-concurrency-cap]/` on branch `ORCH-1032-intel-pipeline-concurrency-cap`
**Investigation (proven root cause):** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1032_INTEL_PIPELINE_CONCURRENCY_546.md`
**Confidence of upstream investigation:** root cause **proven** (live evidence 2026-06-01 ~04:34 UTC — 5 active runs, London 10,706 servable / 0 completed, interleaved 200/546 edge logs).

---

## 0. Layman summary

When the operator already has 5 intelligence-pipeline city runs going and tries to start a 6th
(London), the start request dies with "not enough compute resources" (HTTP 546) because the
pipeline was *designed* for ~5 concurrent runs but nothing ever *enforced* that ceiling, and the
single 10,706-row enqueue for London is the most memory-hungry call in the whole pipeline. This
spec makes the system pace itself: a 6th run is accepted and parked as **queued**, and the existing
once-a-minute cron auto-promotes it to **running** the moment a slot frees — no error, no lost work,
no babysitting. It also chops the giant enqueue into 1,000-row batches so even a huge city can't
blow the start request. The 5 in-flight runs are never touched.

---

## 1. Scope, Non-Goals, Assumptions

### 1.1 Scope (exactly these 6 items, nothing else)

1. **S-1 — New `'queued'` parent status.** Additive migration widening the
   `place_intelligence_runs.status` CHECK to admit `'queued'`; widen the per-city unique partial
   active index to count `queued`; update the status state-machine `COMMENT`.
2. **S-2 — Single source of truth for the cap.** A named constant `MAX_CONCURRENT_RUNS = 4`,
   referenced by the edge gate (TS) and the cron `LIMIT` (SQL), kept in sync via a cross-referencing
   comment block (decision + justification in §4.2).
3. **S-3 — Concurrency gate in `handleStartRun`.** Before the parent insert, count `running` runs;
   if `>= MAX_CONCURRENT_RUNS`, insert the parent as `'queued'` (no `started_at`, no first-chunk
   kick) and return HTTP 200 with a queued payload (incl. how many are ahead). If `< cap`, behave
   exactly as today.
4. **S-4 — Cron promotion in `tg_kick_pending_trial_runs()`.** At tick start count `running`; promote
   the oldest `queued` run(s) (`ORDER BY created_at ASC`) to `running` (stamp `started_at = now()`)
   up to `(cap - running_count)`, kick them via `pg_net` in the same tick, then keep the existing
   stale-heartbeat re-kick for already-running/cancelling runs.
5. **S-5 — Chunked enqueue in `handleStartRun`.** Replace the single `.upsert(pendingRows)` (up to
   10,706 rows) with a batched loop of `BATCH_INSERT_SIZE = 1000` upserts, preserving the existing
   `onConflict: "run_id,place_pool_id"` and the parent-row rollback-on-failure behaviour.
6. **S-6 — Admin UI `queued` rendering.** Render `'queued'` in the run list (`ActiveRunCard.jsx`) and
   the start modal (`RunRemainderConfirmModal.jsx`) as an informational waiting state — never an
   error/failure. Surface queued runs through `list_active_runs` so the control tower shows them.

### 1.2 Non-Goals (explicitly NOT in this spec)

- **NG-1** No change to the budget loop / scorer / prep iteration / `process_chunk` worker
  (`index.ts` ~2877+). The worker is healthy under the cap; out of scope.
- **NG-2** No change to `mode` semantics (`sample`/`full_city`/`retry_failed`/`remainder`), the
  cost guard, the stratified sampler, or the remainder NOT-EXISTS filter.
- **NG-3** No change to the `process_chunk` self-invoke chain, heartbeat cadence, or
  `lock_run_for_chunk`/`increment_run_counters` RPCs.
- **NG-4** The cap value itself (4 vs 5) is operator-confirmable at REVIEW; the spec ships **4** with
  one slot of headroom (investigation §4 item 4). The constant makes a later change one-line + one-SQL.
- **NG-5** No backfill / mutation of the 5 in-flight runs, no re-ordering of existing runs.

### 1.3 Assumptions (stated, not proven here — verify at IMPLEMENT)

- **A-1** The current `status` CHECK is the ORCH-0737 one (`20260506000001_…` line 33-34):
  `('pending','running','cancelling','cancelled','complete','failed')`. **Verified at SPEC:** no later
  migration alters the *status* CHECK (grep across all migrations touching `place_intelligence_runs`
  shows ORCH-0757 + ORCH-1008 widened only the *mode* CHECK). The implementor MUST re-confirm with
  a live read-only probe (§4.1 IMPL note) — the live DB constraint name may differ from the inline
  literal if a prior migration used `DROP CONSTRAINT IF EXISTS … ADD CONSTRAINT …`.
- **A-2** The latest `tg_kick_pending_trial_runs()` definition is in
  `20260506000002_orch_0737_v3_cron_filter_cancelling.sql` (NOT the v1 in `…_async_trial_runs.sql`).
  The new migration's `CREATE OR REPLACE` must be built on top of the **v3** body
  (`WHERE status IN ('running','cancelling')`), preserving the v3 cancelling fix.
- **A-3** `verify_jwt = true` for `[functions.run-place-intelligence-trial]` (`supabase/config.toml`
  line 60-61). This MUST be preserved on redeploy (hard guard HG-5).
- **A-4** The pipeline is admin-only; no consumer/business/buyer surface touches it.

---

## 2. Cross-Surface Impact (Phase 2.5 — MANDATORY)

| # | Surface | Covered? | Why / what it does |
|---|---------|----------|--------------------|
| 1 | Consumer iOS (`app-mobile/` iOS) | **NO** | Consumer app does not touch the place-intelligence pipeline. |
| 2 | Consumer Android | **NO** | Same — admin-only flow. |
| 3 | Buyer/anon Web (`mingla-business/` checkout/public) | **NO** | No buyer route exposes pipeline state. |
| 4 | Business iOS | **NO** | No business analog of the intelligence pipeline. |
| 5 | Business Android | **NO** | Same. |
| 6 | **Admin Web (`mingla-admin/`)** | **YES** | Renders run status; must show `'queued'` as a calm waiting state (S-6). Single web surface — parity is **automatic** (one React codebase, web-only). |
| 7 | Business Web preview | **NO** | No pipeline UI in business web. |

**Backend (`supabase/`)** is covered: migration (S-1), edge fn `handleStartRun` + `handleListActiveRuns`
(S-3, S-5, S-6 data), cron fn (S-4). Backend is not a "shipping surface" in the 5-surface list but is
the primary changed layer; success criteria below cover it explicitly.

Because the only UI surface is admin-web (one codebase, web-only), there is **no manual cross-platform
parity split** — a single set of UI success criteria (SC-6.x) suffices.

---

## 3. Root-cause recap (from the proven investigation)

- **RC-1 — Un-enforced concurrency ceiling.** Cron `tg_kick_pending_trial_runs()` caps at `LIMIT 5`
  ("max 5 concurrent runs") but `handleStartRun` (`index.ts` ~1262) inserts every new parent as
  `status:'running'` with **no count gate**. Only the per-city unique partial index
  (`uniq_one_running_run_per_city`) blocks a *same-city* duplicate. Operator can start a 6th run; the
  Edge compute pool can't service it → HTTP 546 at `start_run`.
- **RC-2 — Single-isolate giant enqueue.** `handleStartRun` (`index.ts` 1300-1316) builds one
  `pendingRows` array (up to 10,706 for London) and does a single `.upsert(pendingRows)` — the most
  memory-hungry single invocation in the pipeline, independently 546-prone at the margin.

This spec fixes both (S-3+S-4 for RC-1; S-5 for RC-2).

---

## 4. Layer-by-layer contract

### 4.1 Database layer — S-1: `'queued'` status (additive migration)

**New migration file:** `supabase/migrations/20260809000000_orch_1032_queued_status_and_cap.sql`

> **Filename monotonicity (codified rule):** prefix `20260809000000` must be strictly greater than the
> current max local + linked-remote head. Latest existing prefix in-tree is `20260808000000`
> (`meta_orch_1009_sub_d_refresh_cron.sql`). Implementor MUST re-confirm with
> `supabase migration list --linked` (or `mcp__supabase__list_migrations`) at IMPLEMENT and bump the
> prefix if the remote already carries `20260809…`. Per COMMS-0012, CLOSE must verify the new version
> appears on remote BEFORE the deploy banner.

**Migration body (exact contract — additive only, NO table rewrite):**

```sql
-- ORCH-1032: add 'queued' parent status + widen per-city unique active index +
-- widen cron promotion (this migration owns the status CHECK + index; §4.4 cron
-- fn is in the SAME migration file so the cap is consistent in one atomic apply).
--
-- ADDITIVE ONLY — safe to apply while runs are actively 'running':
--   * ALTER ... DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT  (CHECK widen is a
--     metadata-only validation pass over existing rows; new set is a strict
--     superset of the old, so every existing row already satisfies it — no
--     rewrite, no exclusive lock that blocks worker UPDATEs beyond the brief
--     ACCESS EXCLUSIVE needed to swap the constraint. Postgres validates the
--     new CHECK against existing rows; all current rows are in the old 6-value
--     set ⊂ new 7-value set, so validation cannot fail.)
--   * DROP INDEX / CREATE UNIQUE INDEX  (the partial unique index is recreated;
--     CREATE UNIQUE INDEX without CONCURRENTLY takes a SHARE lock that blocks
--     writes to place_intelligence_runs only for the build duration — the table
--     is tiny (low hundreds of rows), build is sub-second. Acceptable: workers
--     UPDATE via increment_run_counters which momentarily waits, then proceeds.)
--   * CREATE OR REPLACE FUNCTION  (atomic; in-flight cron tick uses old body
--     until commit, next tick uses new — same property the v3 patch relied on.)
-- No DROP TABLE, no column type change, no NOT NULL add, no data migration.
--
-- Docs verified (COMMS-0003):
--   CHECK constraints: https://www.postgresql.org/docs/current/ddl-constraints.html
--   Partial indexes:   https://www.postgresql.org/docs/current/indexes-partial.html
--   pg_cron:           https://supabase.com/docs/guides/cron
--   pg_net http_post:  https://supabase.com/docs/guides/database/extensions/pg_net

BEGIN;

-- ── S-1a: widen status CHECK to admit 'queued' ──────────────────────────────
-- Implementor: confirm the live constraint name first via read-only probe:
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'public.place_intelligence_runs'::regclass AND contype='c'
--     AND pg_get_constraintdef(oid) LIKE '%status%';
-- The ORCH-0737 inline CHECK was unnamed-in-source but Postgres auto-named it
-- 'place_intelligence_runs_status_check'. DROP IF EXISTS that name; if the live
-- name differs, drop the discovered name instead.
ALTER TABLE public.place_intelligence_runs
  DROP CONSTRAINT IF EXISTS place_intelligence_runs_status_check;

ALTER TABLE public.place_intelligence_runs
  ADD CONSTRAINT place_intelligence_runs_status_check
  CHECK (status IN ('pending','queued','running','cancelling','cancelled','complete','failed'));

-- ── S-1b: widen per-city unique partial active index to count 'queued' ──────
-- A city must NOT have a queued run AND a running run simultaneously (and never
-- two queued). Adding 'queued' to the WHERE keeps "one active commitment per
-- city" — start_run's 23505 duplicate guard now also fires if the city already
-- has a queued run. Safe with active rows: index is recreated, current rows all
-- hold distinct city_id in the active set.
DROP INDEX IF EXISTS public.uniq_one_running_run_per_city;
CREATE UNIQUE INDEX uniq_one_running_run_per_city
  ON public.place_intelligence_runs (city_id)
  WHERE status IN ('pending','queued','running','cancelling');

-- ── S-1c: update the state-machine COMMENT ──────────────────────────────────
COMMENT ON TABLE public.place_intelligence_runs IS
  'ORCH-0737 (DEC-111); ORCH-1032 added queued. Run-level parent. Children are place_intelligence_trial_runs rows linked via parent_run_id FK. Status state machine: pending -> (queued -> running) | running -> (cancelling -> cancelled) | complete | failed. queued = accepted but waiting for a concurrency slot (started_at NULL, no first-chunk kick); tg_kick_pending_trial_runs promotes oldest queued -> running when running_count < MAX_CONCURRENT_RUNS. last_heartbeat_at updated by worker chunks; pg_cron re-kicks running/cancelling runs when heartbeat is stale (>90s).';

-- ── S-4 cron promotion lives in this same file (see §4.4) ───────────────────
-- (CREATE OR REPLACE FUNCTION public.tg_kick_pending_trial_runs() … )

COMMIT;
```

**Why one migration file for both DB objects (S-1 + S-4):** the cap literal must be consistent across
the index/CHECK widen and the cron promotion in a single atomic apply, so a half-applied state can
never admit `queued` rows that the cron doesn't yet promote (or vice versa).

**IMPL note — do NOT apply via MCP.** Per the tester discipline + operator pipeline, the operator runs
`supabase db push --linked`. The implementor writes the file; CLOSE verifies it landed on remote
(COMMS-0012). Do not use `mcp__supabase__apply_migration` (creates remote-only timestamps that break
the deploy pipeline).

### 4.2 Single source of truth for the cap — S-2

**Decision: hardcode the same integer literal in BOTH places with a cross-referencing comment block.
Justified — recommended simplest correct option.**

Rationale:
- The edge fn is TypeScript (Deno) and the cron is PL/pgSQL — they cannot share a runtime symbol.
- A DB `settings` row both read would (a) add a query to the hot `handleStartRun` path, (b) add a
  `SELECT` to every cron tick, and (c) introduce a *new* failure mode (row missing/malformed → cap
  ambiguous) for a value that changes ~never. That is more moving parts for zero benefit.
- The value is small, rarely changed, and any drift is caught by the §6 regression test SC-2 which
  asserts the literal is identical in both files by source-inspect.

**TS side — `supabase/functions/run-place-intelligence-trial/index.ts`** (add near the other run
constants ~line 770, beside `PER_PLACE_COST_USD` / `SAMPLE_SIZE_DEFAULT`):

```ts
// ─────────────────────────────────────────────────────────────────────────
// ORCH-1032: concurrency ceiling. MUST stay in sync with the cron LIMIT in
// supabase/migrations/20260809000000_orch_1032_queued_status_and_cap.sql
// (function tg_kick_pending_trial_runs, "LIMIT MAX_CONCURRENT_RUNS"). If you
// change one, change the other in the SAME PR. Default 4 leaves one slot of
// headroom under the ~5-chain Edge compute pool (ORCH-1032 investigation §4:
// intermittent worker-546s observed at 5 concurrent). Regression test SC-2
// asserts both literals match.
const MAX_CONCURRENT_RUNS = 4;

// ORCH-1032 RC-2: chunked enqueue batch size. One .upsert per batch keeps the
// start_run isolate memory bounded for 10k+ -city enqueues.
const BATCH_INSERT_SIZE = 1000;
```

**SQL side** — the cron fn (§4.4) hardcodes `LIMIT 4` with a mirrored comment pointing back to the
TS constant.

### 4.3 Edge function layer — S-3 concurrency gate + S-5 chunked enqueue

**File:** `supabase/functions/run-place-intelligence-trial/index.ts`, function `handleStartRun`
(~lines 1098-1376). `verify_jwt = true` preserved (HG-5).

#### S-3 — concurrency gate (insert BEFORE the parent insert at ~line 1262)

Insert this block immediately **after** `estMinutes` is computed (~line 1256) and **before** the
`const runId = crypto.randomUUID();` + parent insert (~1261):

```ts
// ── ORCH-1032 S-3: concurrency gate ───────────────────────────────────────
// Count runs currently consuming an Edge compute slot. ONLY 'running' counts —
// queued runs hold no slot; cancelling runs are finishing and will free a slot
// shortly but still occupy one now, so they DO count toward the ceiling.
// (Match the investigation contract: "count runs with status IN ('running')".
// cancelling is excluded here intentionally — it is transient and the per-city
// unique index already prevents a city from queueing behind its own cancel.)
const { count: runningCount, error: countErr } = await db
  .from("place_intelligence_runs")
  .select("id", { count: "exact", head: true })
  .eq("status", "running");
if (countErr) return json({ error: countErr.message }, 500);

const atCapacity = (runningCount ?? 0) >= MAX_CONCURRENT_RUNS;
```

Then branch the parent insert. **Replace** the existing single insert object's `status` +
`started_at` fields conditionally:

```ts
const runId = crypto.randomUUID();
const { error: parentInsertErr } = await db
  .from("place_intelligence_runs")
  .insert({
    id: runId,
    city_id: cityId,
    city_name: city.name,
    mode,
    sample_size: mode === "sample" ? effectiveCount : null,
    total_count: effectiveCount,
    estimated_cost_usd: estCost,
    estimated_minutes: estMinutes,
    prompt_version: PROMPT_VERSION,
    model: GEMINI_MODEL_NAME_SHORT,
    started_by: adminId,
    // ORCH-1032 S-3: at capacity → park as queued (no slot, no kick).
    status: atCapacity ? "queued" : "running",
    started_at: atCapacity ? null : new Date().toISOString(),
  });
```

The existing 23505 duplicate-guard + 500 fallback stay **unchanged** (they still apply — the per-city
unique index now also covers `queued`, so attempting to queue a 2nd run for a city that already has
any active/queued run returns the same friendly `concurrent_run` 409).

**Chunked enqueue (S-5)** still runs for both branches (queued runs need their child rows pre-inserted
so promotion has work to do). See §4.3 S-5 below.

**First-chunk kick — gate on `!atCapacity`.** Change the kick condition (~line 1333) from:

```ts
if ((mode === "full_city" || mode === "remainder") && serviceKey) {
```
to:
```ts
// ORCH-1032 S-3: only kick immediately when we actually started 'running'.
// A queued run is NOT kicked here — tg_kick_pending_trial_runs promotes + kicks
// it when a slot frees. (sample mode never kicked; browser drives it.)
if (!atCapacity && (mode === "full_city" || mode === "remainder") && serviceKey) {
```

**Response shape — queued payload.** Change the final `return json({...})` (~1357) to carry the queued
state. Add a `queued` boolean + `aheadCount` and keep all existing fields:

```ts
// ORCH-1032 S-3: how many runs are ahead of this one in line (running + any
// queued created earlier). Read-only, best-effort — used only for the UI copy.
let aheadCount = 0;
if (atCapacity) {
  const { count: ahead } = await db
    .from("place_intelligence_runs")
    .select("id", { count: "exact", head: true })
    .or(
      `status.eq.running,and(status.eq.queued,created_at.lt.${
        // the row we just inserted; use its created_at via now() upper bound is
        // racy, so count running + queued strictly older than this run instead.
        new Date().toISOString()
      })`,
    );
  aheadCount = (ahead ?? 0) > 0 ? (ahead as number) - 1 : 0; // exclude self
}

return json({
  runId,
  cityId: city.id,
  cityName: city.name,
  cityCountry: city.country,
  mode,
  totalServable,
  totalPlaces: effectiveCount,
  estimatedCostUsd: estCost,
  estimatedMinutes: estMinutes,
  provider: "gemini",
  model: GEMINI_MODEL_NAME_SHORT,
  // ORCH-1032 S-3:
  status: atCapacity ? "queued" : "running",
  queued: atCapacity,
  aheadCount,                       // runs ahead in line (0 when not queued)
  maxConcurrentRuns: MAX_CONCURRENT_RUNS,
  anchors: mode === "sample"
    ? sampledIds.map((ppId) => ({ place_pool_id: ppId, signal_id: null }))
    : [],
});
```

> **IMPL simplification allowed (🎨 OPEN):** the `aheadCount` count query is best-effort UI sugar. The
> implementor MAY compute it more simply (e.g. `running_count` when atCapacity, since queued-ahead is
> usually 0 given the per-city unique index limits queued depth) as long as it never throws and never
> blocks the 200 response. The **LOCKED** contract is only: `status:'queued'` + `queued:true` +
> `maxConcurrentRuns` present in the at-capacity payload, HTTP 200.

#### S-5 — chunked enqueue (replace the single `.upsert(pendingRows)` at ~1314-1327)

**Replace** lines ~1314-1327 (the single `db.from(...).upsert(pendingRows, {...})` + its rollback)
with a batched loop:

```ts
// ── ORCH-1032 S-5: chunked enqueue ────────────────────────────────────────
// RC-2: a single .upsert of up to ~10,706 objects (London) is the most
// memory-hungry call in the pipeline and independently 546-prone. Insert in
// fixed BATCH_INSERT_SIZE chunks so the start_run isolate stays bounded
// (~1000 small rows per request). onConflict preserved for idempotent re-runs.
// Rollback-on-failure preserved: any failed batch fails the whole start_run and
// marks the parent 'failed' (children already inserted are harmless orphans the
// worker never picks up because the parent is terminal).
let enqueueErr: { message: string } | null = null;
for (let i = 0; i < pendingRows.length; i += BATCH_INSERT_SIZE) {
  const batch = pendingRows.slice(i, i + BATCH_INSERT_SIZE);
  const { error: batchErr } = await db
    .from("place_intelligence_trial_runs")
    .upsert(batch, { onConflict: "run_id,place_pool_id" });
  if (batchErr) {
    enqueueErr = batchErr;
    break;
  }
}
if (enqueueErr) {
  // Roll back parent row to keep DB consistent (identical to pre-ORCH-1032).
  await db.from("place_intelligence_runs")
    .update({
      status: "failed",
      error_reason: `child insert failed: ${enqueueErr.message}`,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
  return json({ error: enqueueErr.message }, 500);
}
```

`pendingRows` construction (~1301-1313) is **unchanged**.

#### S-6 data — `handleListActiveRuns` must surface queued (`index.ts` ~2867)

Add `'queued'` to the status `.in(...)` so the admin control tower polls and renders queued runs:

```ts
async function handleListActiveRuns(db: SupabaseClient): Promise<Response> {
  const { data, error } = await db
    .from("place_intelligence_runs")
    .select("*")
    // ORCH-1032: include 'queued' so the control tower shows parked runs.
    .in("status", ["pending", "queued", "running", "cancelling"])
    .order("created_at", { ascending: false });
  if (error) return json({ error: error.message }, 500);
  return json({ runs: data || [] });
}
```

> **No worker change.** `process_chunk` is never called on a `queued` run because the first-chunk kick
> is gated (`!atCapacity`) and the cron only kicks rows it has just promoted to `running`. A queued run
> has child rows in `'pending'` waiting; promotion flips the parent to `running` and the normal worker
> path takes over. (NG-1.)

### 4.4 Cron layer — S-4 promotion (same migration file, §4.1)

**`CREATE OR REPLACE FUNCTION public.tg_kick_pending_trial_runs()`** — built on the **v3** body
(`20260506000002`), adding a promotion block at tick start. Full new body:

```sql
CREATE OR REPLACE FUNCTION public.tg_kick_pending_trial_runs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
  q record;
  worker_url text;
  service_key text;
  running_count int;
  free_slots int;
BEGIN
  worker_url := 'https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/run-place-intelligence-trial';

  SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;

  IF service_key IS NULL THEN
    RAISE NOTICE 'tg_kick_pending_trial_runs: service_role_key not in vault, skipping tick';
    RETURN;
  END IF;

  -- ── ORCH-1032 S-4: promote queued runs into free slots, THEN kick them ────
  -- MAX_CONCURRENT_RUNS = 4. MUST stay in sync with the TS constant
  -- MAX_CONCURRENT_RUNS in
  -- supabase/functions/run-place-intelligence-trial/index.ts (ORCH-1032 S-2).
  -- Change one, change the other in the SAME PR. Regression test SC-2 asserts
  -- the two literals match.
  SELECT count(*) INTO running_count
    FROM public.place_intelligence_runs
    WHERE status = 'running';

  free_slots := 4 - running_count;   -- LITERAL 4 == MAX_CONCURRENT_RUNS (ORCH-1032 S-2)

  IF free_slots > 0 THEN
    FOR q IN
      SELECT id FROM public.place_intelligence_runs
      WHERE status = 'queued'
      ORDER BY created_at ASC                                       -- oldest queued first
      LIMIT free_slots
      FOR UPDATE SKIP LOCKED                                        -- never block a concurrent tick
    LOOP
      UPDATE public.place_intelligence_runs
        SET status = 'running',
            started_at = now()
        WHERE id = q.id;
      -- kick the freshly-promoted run immediately (don't wait for next tick)
      PERFORM net.http_post(
        url := worker_url,
        body := jsonb_build_object('action', 'process_chunk', 'run_id', q.id),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || service_key
        )
      );
    END LOOP;
  END IF;

  -- ── existing stale-heartbeat re-kick (v3 — unchanged) ─────────────────────
  -- Picks already-running/cancelling runs with a stale heartbeat (>90s) and
  -- re-kicks them. LIMIT 4 mirrors the cap (was 5 pre-ORCH-1032). A promoted
  -- run from the block above is freshly 'running' with NULL heartbeat, so it
  -- could match here too — harmless (idempotent kick), but we already kicked it,
  -- so the 90s-stale filter naturally excludes it next tick.
  FOR r IN
    SELECT id FROM public.place_intelligence_runs
    WHERE status IN ('running', 'cancelling')
      AND processed_count < total_count
      AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now() - interval '90 seconds')
    ORDER BY created_at ASC
    LIMIT 4                                                          -- ORCH-1032: was 5; == MAX_CONCURRENT_RUNS
  LOOP
    PERFORM net.http_post(
      url := worker_url,
      body := jsonb_build_object('action', 'process_chunk', 'run_id', r.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
      )
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.tg_kick_pending_trial_runs IS
  'ORCH-0737 (DEC-111) v3 + ORCH-1032. pg_cron-driven kicker, every 1 min. ORCH-1032 S-4: at tick start, if running_count < MAX_CONCURRENT_RUNS (=4), promote the oldest queued run(s) to running (stamp started_at) up to the free-slot count and kick them via pg_net. Then re-kick already-running/cancelling runs with a stale heartbeat (>90s), LIMIT 4. queued runs auto-start as slots free. Service role key from vault.decrypted_secrets; if missing, skips silently (RAISE NOTICE). Docs: https://supabase.com/docs/guides/cron , https://supabase.com/docs/guides/database/extensions/pg_net';
```

**Notes on the cron contract:**
- `FOR UPDATE SKIP LOCKED` on the queued select guards the (rare) case of two overlapping ticks — a
  tick never blocks on another tick's promotion. (Postgres row-locking;
  https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE.)
- The promotion `UPDATE … started_at = now()` satisfies the same downstream contract `handleStartRun`
  used for a directly-started run (parent `running` + `started_at` set + child rows `pending`).
- The stale re-kick `LIMIT` drops from `5` → `4` to mirror the cap (consistency; at most 4 runs ever
  `running`, so 5 was already unreachable — but keep it equal to the constant for clarity + the SC-2
  match assertion).

### 4.5 Admin UI layer — S-6 `queued` rendering (admin-web only)

#### `mingla-admin/src/components/placeIntelligenceTrial/ActiveRunCard.jsx`

Three additions — all token-styled, calm/informational, never error/failure:

1. **`statusPillClasses(status)`** (~line 48): add a `queued` branch. Use the neutral/info waiting
   palette (NOT warning, NOT error):
   ```js
   if (status === "queued") {
     return "bg-[var(--gray-100)] text-[var(--color-text-secondary)]";
   }
   ```
   🔒 LOCKED: must use a neutral gray token pair, not `--color-error-*` / `--color-warning-*`.
   Contrast: `--color-text-secondary` on `--gray-100` is the existing default-pill pairing already in
   this file's fallthrough `return` (line 64), so it inherits the design system's proven ≥4.5:1 body
   contrast. 🎨 OPEN: implementor may instead use `--color-info-50` / `--color-info-700` (same pair as
   `running`) if the designer prefers visual continuity with the running state — either is acceptable
   as long as it reads as "waiting," not "problem."

2. **`statusLabel(status)`** (~line 67): add:
   ```js
   if (status === "queued") return "Queued";
   ```

3. **Action row** (~line 233): add a queued waiting affordance mirroring the `isCancelling` spinner
   pattern (line 245-250) but with calm copy and NO spinner (queued is idle, not working):
   ```jsx
   {run.status === "queued" && (
     <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
       <Clock className="w-3.5 h-3.5" aria-hidden="true" />
       <span>Queued — waiting for a free slot</span>
     </div>
   )}
   ```
   `Clock` is already imported (line 23). 🔒 LOCKED copy: "Queued — waiting for a free slot".
   For a queued run the progress bar shows 0% and counts `0 / total` — acceptable and correct (no work
   done yet). `isRunning` / `isTerminal` / `isCancelling` branches are unchanged; queued is none of
   them, so no Cancel/View button shows (a queued run has no slot to cancel; operator waits or can
   cancel via the same `cancel_trial` path if S-6.4 below is added — OPEN, see below).

   🎨 OPEN (implementor discretion, not required): optionally allow cancelling a queued run by showing
   the existing Cancel button for `status === "queued"` too (the `cancel_trial` worker path already
   marks parent + children cancelled). If added, gate it the same as `isRunning`. Not required for
   this ORCH; if skipped, a queued run simply waits or is promoted.

#### `mingla-admin/src/components/placeIntelligenceTrial/RunRemainderConfirmModal.jsx`

On a successful `start_run` where `data.queued === true`, the toast must read as a calm waiting state,
not the "started" copy. Modify `handleRun`'s success branch (~line 122-131):

```jsx
if (data.queued) {
  addToast({
    variant: "info",
    title: "Queued — waiting for a free slot",
    description:
      `${data.cityName} · ${data.totalPlaces} places · will auto-start when a run finishes` +
      (data.aheadCount > 0 ? ` (${data.aheadCount} ahead)` : ""),
  });
} else {
  addToast({
    variant: "info",
    title: "Remainder run started",
    description:
      `${data.cityName} · ${data.totalPlaces} places · ~$${
        Number(data.estimatedCostUsd ?? 0).toFixed(2)
      } · run ${String(data.runId).slice(0, 8)}…`,
  });
}
onStarted?.({ runId: data.runId, cityName: data.cityName });
onClose?.();
```

🔒 LOCKED: queued success uses `variant: "info"` (never `"error"`/`"warning"`), title "Queued —
waiting for a free slot". The existing `concurrent_run` 409 error path (different concern — same-city
duplicate) is **unchanged**.

**No other admin component changes.** `ActiveRunsControlTower.jsx` already renders whatever
`useActiveRunsPoller` returns; once `list_active_runs` includes `queued` (§4.3 S-6 data) and the poller
treats those as active runs, queued cards appear automatically. **Verify** `useActiveRunsPoller.js`
buckets `queued` into `activeRuns` (it currently buckets by "runs present in `list_active_runs`
response" → automatic; confirm at IMPLEMENT that no client-side status allowlist re-filters them out —
source read shows it keys off presence in the response, not a hardcoded status set, so this is
automatic, but the implementor MUST confirm).

---

## 5. Success Criteria (observable, testable, unambiguous)

| ID | Criterion |
|----|-----------|
| **SC-1** | After the migration applies, `place_intelligence_runs.status` accepts an INSERT/UPDATE with value `'queued'` and rejects any value outside the 7-value set. The 5 in-flight runs remain `running` with unchanged `processed_count` (no mutation). |
| **SC-2** | The integer cap literal is identical in `index.ts` (`MAX_CONCURRENT_RUNS = 4`) and the cron fn (`LIMIT 4` / `free_slots := 4 - running_count`). A source-inspect test asserts both read `4`. |
| **SC-3** | `start_run` while `running_count < 4` behaves exactly as today: parent inserted `status:'running'`, `started_at` set, first-chunk kicked, HTTP 200 with `queued:false`. |
| **SC-4** | `start_run` while `running_count >= 4` (e.g. the 5th concurrent / London-at-capacity case): parent inserted `status:'queued'`, `started_at` NULL, NO first-chunk kick fired, HTTP **200** (not 546, not 4xx) with `queued:true`, `status:'queued'`, `maxConcurrentRuns:4` in the payload. |
| **SC-5** | A same-city second `start_run` (running OR queued already exists for that city) still returns 409 `concurrent_run` (per-city unique index now covers `queued`). |
| **SC-6** | The chunked enqueue inserts all `effectiveCount` child rows for a 10,706-place city across ceil(10706/1000)=11 upserts; final child-row count == `effectiveCount`; `onConflict 'run_id,place_pool_id'` preserved (re-running start_run for the same run_id is idempotent). |
| **SC-7** | If any enqueue batch errors, the parent row is updated to `status:'failed'` with `error_reason` and the function returns 500 — identical rollback contract to pre-ORCH-1032. |
| **SC-8** | When `running_count` drops below 4 (a run completes/cancels), the next cron tick promotes the **oldest** `queued` run to `running` (stamps `started_at`), kicks it, and promotes **no more than** `(4 - running_count)` runs in that tick. |
| **SC-9 (admin-web)** | A `queued` run renders in the Active Runs control tower with the pill label "Queued", a neutral (non-error/non-warning) color, and the line "Queued — waiting for a free slot". No Cancel/View button is required for queued; no spinner. |
| **SC-10 (admin-web)** | Starting a run that comes back `queued:true` shows an `info` toast titled "Queued — waiting for a free slot" (with "(N ahead)" when `aheadCount>0`), NEVER an error/warning banner. |
| **SC-11** | `verify_jwt` for `run-place-intelligence-trial` remains `true` after redeploy (config.toml line 60-61 unchanged). |

---

## 6. Invariants

**Preserved (must not regress):**

| ID | Invariant | How preserved | Verified by |
|----|-----------|---------------|-------------|
| **INV-P1** | One active commitment per city (`uniq_one_running_run_per_city`). | Index recreated to cover `queued` too — strictly tighter. | SC-5, T-05 |
| **INV-P2** | `chk_sample_size_consistency` unaffected. | Not touched by this migration. | migration apply |
| **INV-P3** | Worker `process_chunk` / budget loop / heartbeat / `lock_run_for_chunk` unchanged. | NG-1, NG-3. | T-08 source-inspect (no worker diff) |
| **INV-P4** | v3 cancelling re-kick (`status IN ('running','cancelling')`) preserved. | New cron body keeps the v3 stale-heartbeat loop verbatim except `LIMIT 5→4`. | T-09 |
| **INV-P5** | The 5 in-flight runs are never stopped/cancelled/mutated. | Migration is additive; gate only affects *new* inserts; cron promotion only touches `queued` rows. | SC-1, HG-1 |
| **INV-P6** | `verify_jwt = true` on redeploy. | HG-5, SC-11. | config.toml diff check |

**New (this change establishes):**

| ID | Invariant | Statement |
|----|-----------|-----------|
| **I-PROPOSED-INTEL-CONCURRENCY-CAP-ENFORCED** | `handleStartRun` inserts `status:'running'` only when `running_count < MAX_CONCURRENT_RUNS`; otherwise `status:'queued'` with no kick. The cron is the sole promoter of `queued → running`. (status: DRAFT → ACTIVE on CLOSE.) |
| **I-PROPOSED-INTEL-CAP-SINGLE-SOURCE** | The cap literal is identical in the edge fn TS constant and the cron SQL `LIMIT`; a regression test enforces equality. (status: DRAFT → ACTIVE on CLOSE.) |
| **I-PROPOSED-INTEL-ENQUEUE-CHUNKED** | Child-row pre-insert in `handleStartRun` is batched at `BATCH_INSERT_SIZE` and never issues a single upsert larger than that. (status: DRAFT → ACTIVE on CLOSE.) |

---

## 7. Test Cases

**Test runner conventions** (match existing files): Deno tests under
`supabase/functions/run-place-intelligence-trial/__tests__/*.test.ts` using
`https://deno.land/std@0.224.0/assert/mod.ts`; SQL/migration assertions under
`supabase/migrations/__tests__/`. The established two-key pattern (behavioral simulator that
fails-on-revert + source-inspect that catches a malicious edit) is mandatory — see existing
`runRemainder.test.ts`.

### 7.1 REQUIRED (a) — implementor happy-path test (MUST fail on revert)

**File:** `supabase/functions/run-place-intelligence-trial/__tests__/concurrencyCap.test.ts`

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Gate decision below cap | `runningCount=3`, `MAX=4` | `atCapacity===false` → status `'running'`, kick fires | edge logic (extracted pure fn) |
| T-02 | Gate decision at cap | `runningCount=4`, `MAX=4` | `atCapacity===true` → status `'queued'`, NO kick | edge logic |
| T-03 | Gate decision above cap | `runningCount=5` (e.g. legacy) | `atCapacity===true` → `'queued'` | edge logic |
| T-04 | Chunking math | `effectiveCount=10706`, `BATCH=1000` | 11 batches, last batch = 706, sum == 10706, no batch > 1000 | edge logic |
| T-05 | Source-inspect: gate exists | read `index.ts` | contains `MAX_CONCURRENT_RUNS`, `atCapacity`, `status: atCapacity ? "queued" : "running"`, `!atCapacity &&` on the kick | source guard |
| T-06 | Source-inspect: chunked enqueue exists | read `index.ts` | contains `BATCH_INSERT_SIZE`, `slice(i, i + BATCH_INSERT_SIZE)`, `onConflict: "run_id,place_pool_id"` | source guard |
| T-07 | Source-inspect: list_active_runs includes queued | read `index.ts` | `handleListActiveRuns` `.in("status", [...])` array contains `"queued"` | source guard |

Implement the gate decision + chunk math as small **pure exported helpers** (or inline-mirrored
functions in the test, matching the `runRemainder.test.ts` style) so the behavioral half fails the
moment the literal/branch is reverted. The source-inspect half catches a mirror-only revert.

**Why these fail on revert:** T-02/T-03 fail if the gate is removed (every run becomes `running`).
T-04 fails if the loop reverts to a single upsert. T-05/T-06/T-07 fail if the source branch/constant is
deleted.

### 7.2 REQUIRED (b) — tester adversarial test (different angle: cap-boundary race + over-promotion)

**File:** `supabase/functions/run-place-intelligence-trial/__tests__/concurrencyCap_adversarial.test.ts`
**and** `supabase/migrations/__tests__/orch_1032_cron_promotion.test.ts` (SQL-shape assertion).

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-08 | **(cap+1)th run yields queued not 546** | Simulate `runningCount=4` → start the 5th | decision = `queued`, response `queued:true`, status code path is the 200-return (NOT the 546/edge-compute path) — i.e. the gate short-circuits BEFORE any heavy work that could 546 | adversarial edge logic |
| T-09 | **Cron promotes exactly free-slot count, no more** | `running_count=2`, 5 queued rows | `free_slots = 4 - 2 = 2`; promotion loop `LIMIT free_slots` ⇒ exactly 2 promoted, 3 stay queued; never promotes when `free_slots<=0` | SQL source-inspect + arithmetic sim |
| T-10 | **Over-cap guard** | `running_count=4`, 3 queued | `free_slots = 0` ⇒ `IF free_slots > 0` is false ⇒ zero promotions; the 4 running are untouched | SQL source-inspect |
| T-11 | **Oldest-first promotion** | queued rows created at t0<t1<t2, 1 free slot | the t0 row is promoted (ORDER BY created_at ASC LIMIT 1) | SQL source-inspect (assert `ORDER BY created_at ASC` + `LIMIT free_slots` present in migration body) |
| T-12 | **Migration is additive/safe** | read migration SQL | contains `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT … CHECK (status IN (… 'queued' …))`; contains the widened unique index `WHERE status IN ('pending','queued','running','cancelling')`; contains NO `DROP TABLE`, NO `ALTER COLUMN … TYPE`, NO `SET NOT NULL` | migration source guard |
| T-13 | **v3 cancelling re-kick preserved** | read migration SQL | the stale-heartbeat loop still has `status IN ('running', 'cancelling')` | migration source guard (INV-P4) |
| T-14 | **cap literals match** (SC-2) | read both files | the integer after `MAX_CONCURRENT_RUNS =` in `index.ts` equals the `LIMIT` integer and the `4 - running_count` integer in the migration | cross-file source guard |

T-08 attacks the exact reported symptom from a different angle than the implementor's happy-path
(proving the 5th start can NEVER reach the 546-prone heavy path). T-09/T-10/T-11 attack the cron
promotion arithmetic (the new failure surface) — exactly-free-slot-count and oldest-first.

---

## 8. Implementation Order

1. **DB first.** Write `supabase/migrations/20260809000000_orch_1032_queued_status_and_cap.sql`
   (§4.1 S-1 CHECK + index + comment, AND §4.4 S-4 cron `CREATE OR REPLACE` in the same file).
   Re-confirm filename prefix monotonicity vs `mcp__supabase__list_migrations` and bump if needed.
   Re-confirm the live status-constraint name via the read-only probe in §4.1 before finalizing the
   `DROP CONSTRAINT` name. **Do NOT apply via MCP** — operator runs `supabase db push`.
2. **Edge fn — constants.** Add `MAX_CONCURRENT_RUNS = 4` + `BATCH_INSERT_SIZE = 1000` (§4.2) with
   the cross-referencing comment.
3. **Edge fn — gate (S-3).** Insert the running-count gate before the parent insert; branch
   `status`/`started_at`; gate the first-chunk kick on `!atCapacity`; extend the response payload.
4. **Edge fn — chunked enqueue (S-5).** Replace the single upsert with the batched loop + preserved
   rollback.
5. **Edge fn — list_active_runs (S-6 data).** Add `"queued"` to the `.in(...)`.
6. **Admin UI (S-6).** `ActiveRunCard.jsx` pill class + label + queued waiting row;
   `RunRemainderConfirmModal.jsx` queued-toast branch. Confirm `useActiveRunsPoller.js` buckets queued
   into `activeRuns` (no client-side status allowlist drops it).
7. **Tests.** Author 7.1 (implementor) + 7.2 (adversarial) test files.
8. **Strict-grep allowlist (COMMS-0002).** The new migration + new edge-fn test files touch
   `supabase/`. Add the new file paths to `ORCH_0863`/META backend allowlist
   (`.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` C7 `no-new-backend-files`) in the
   SAME commit, or the PR's required check fails (COMMS-0002). Edge fn `index.ts` is a modify (not new),
   so only the new migration + new test files need allowlisting.
9. **Deploy (CLOSE-time, orchestrator).** Per COMMS-0015: merge PR to main FIRST, confirm origin/main
   has the squash commit + content probe, THEN redeploy `run-place-intelligence-trial` from main with
   `verify_jwt` preserved (HG-5/SC-11), THEN verify the migration version is on remote
   (`mcp__supabase__list_migrations`, per COMMS-0012) BEFORE the close banner. Never deploy-from-worktree
   as the durable deploy.

---

## 9. Regression Prevention

- **Structural safeguard:** the cap is a single named constant on each side, with a mandatory
  cross-referencing comment block; T-14 fails the build if the two literals drift.
- **Test that catches recurrence:** T-02/T-03/T-08 fail if anyone removes the gate (re-introducing the
  un-capped 6th-run 546). T-04/T-06 fail if anyone reverts to the single giant upsert.
- **Protective comments:** every changed block carries an `ORCH-1032` marker explaining *why* (cap
  headroom, RC-2 memory rationale, sync requirement) so a future editor sees the constraint before
  touching it. The migration's additive-safety comment block documents why the apply is safe with
  active rows.

---

## 10. Hard Guards (verbatim — carry into IMPLEMENT + TEST)

- **HG-1** MUST NOT stop, cancel, mutate, or slow the 5 in-flight runs (Washington / Brussels / Fort
  Lauderdale / Lagos / Durham). The gate affects only *new* inserts; the cron promotion touches only
  `queued` rows; the migration is additive.
- **HG-2** Migration additive-only and safe with active rows present: CHECK widen +
  `CREATE OR REPLACE FUNCTION` + index recreate only. NO table rewrite, NO `DROP TABLE`, NO column type
  change, NO `SET NOT NULL`, nothing that locks workers out for more than the sub-second index build.
- **HG-3** The cron's v3 cancelling fix (`status IN ('running','cancelling')` in the stale-heartbeat
  loop) MUST be preserved verbatim (INV-P4).
- **HG-4** No refactor of the budget loop, scorer, prep iteration, `process_chunk`, or the
  cost-guard/sampler/remainder logic (NG-1/NG-2/NG-3). Scope is strictly the 6 items in §1.1.
- **HG-5** Preserve the edge fn's existing `verify_jwt = true` (config.toml line 60-61) on redeploy.
- **HG-6** No secrets in code. The cron continues to read `service_role_key` from
  `vault.decrypted_secrets`; no key literal is introduced anywhere.

---

## 11. 🔒 LOCKED vs 🎨 OPEN

**🔒 LOCKED (implementor hits exactly):**
- The 7-value status CHECK set; the widened unique index `WHERE` clause; the additive-only migration
  shape (HG-2).
- `MAX_CONCURRENT_RUNS = 4` + `BATCH_INSERT_SIZE = 1000` as named constants; the SQL `LIMIT 4` /
  `4 - running_count` matching literal + sync comment.
- The gate semantics: count `status = 'running'`; `>= cap` ⇒ `queued` + no kick + HTTP 200 + `queued:true`
  payload; `< cap` ⇒ unchanged behaviour.
- The cron promotion semantics: oldest-first, `LIMIT free_slots`, stamp `started_at`, kick, `IF free_slots
  > 0` guard, `FOR UPDATE SKIP LOCKED`; v3 re-kick preserved.
- Chunked enqueue: fixed-size batches, `onConflict 'run_id,place_pool_id'`, parent rollback-on-failure.
- `list_active_runs` includes `'queued'`.
- Admin: queued pill is neutral (never error/warning); queued toast `variant:"info"`; copy "Queued —
  waiting for a free slot".
- All hard guards HG-1…HG-6; all success criteria SC-1…SC-11; both required test files.

**🎨 OPEN (implementor craft):**
- The exact `aheadCount` computation (best-effort; may simplify so long as it never throws / never
  blocks the 200).
- The queued pill's precise token pair (neutral gray vs info palette — designer continuity call).
- Whether to also allow cancelling a queued run via the existing Cancel button (optional; same
  `cancel_trial` path).
- Internal helper structure / extraction for testability (pure fn vs inline mirror).
- Test file internal organization beyond the required T-01…T-14 coverage.

---

## 12. External-API / Postgres docs cited (COMMS-0003 compliance)

- pg_cron scheduling: https://supabase.com/docs/guides/cron
- pg_net async http_post: https://supabase.com/docs/guides/database/extensions/pg_net
- Scheduling Edge Functions: https://supabase.com/docs/guides/functions/schedule-functions
- Postgres CHECK constraints: https://www.postgresql.org/docs/current/ddl-constraints.html
- Postgres partial indexes: https://www.postgresql.org/docs/current/indexes-partial.html
- Postgres `SELECT … FOR UPDATE SKIP LOCKED`: https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE
- supabase-js count with head: https://supabase.com/docs/reference/javascript/select (count/head options)

All are Postgres/Supabase contracts (no external SaaS API), so no provider-enum/payload verification
against a third-party API is required beyond the SQL/CLI shapes above.
