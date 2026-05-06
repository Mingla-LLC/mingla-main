# SPEC v2 — ORCH-0737 FULL-CITY ASYNC TRIAL MODE

**ORCH-ID:** ORCH-0737
**Status:** **BINDING (v2)** — supersedes v1; ratified for implementor dispatch
**v1 file (preserved as audit trail; no longer binding):** [`SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md`](./SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md)
**Investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md`](../reports/INVESTIGATION_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md) (HIGH confidence — UNCHANGED)
**Authority:** ORCH-0734 (DEC-110); ORCH-0735 (DEC-107); operator confirmation 2026-05-05/06 (Option B TOGGLE); orchestrator REVIEW 2026-05-06 (gaps caught)
**DEC reservation:** DEC-111 (logged at CLOSE)

---

## §0 v1 → v2 Change Log

**Trigger:** Orchestrator REVIEW 2026-05-06 (`OPEN_INVESTIGATIONS.md` latest++++++++++++++++) caught 2 gaps in v1. Operator chose formal SPEC v2 path over implementor-amendment path for full audit rigor.

**Both fixes are mechanical** — no architecture change, no scope expansion, no re-investigation. Investigation report stands verbatim. v1 SPEC sections §1, §4, §5, §6 (T-01..T-20), §7 (SC-01..SC-20), §8, §9, §10, §11, §12, §13, §14 are **inherited unchanged**. Only §2 step 4 (RLS policy) and §3.1 step 4 (worker pickup query) are patched, plus 5 new T-cases (T-21..T-25) and 2 new SCs (SC-21, SC-22) are appended.

### Patch 1 — §2 RLS policy (S1-high)

**Defect in v1 (§2 migration step 4):**

```sql
CREATE POLICY admin_full_access ON public.place_intelligence_runs
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.id = auth.uid() AND admin_users.status = 'active'
    )
  )
  WITH CHECK (...);
```

The policy assumes `admin_users.id = auth.uid()`. **VERIFIED VIA LIVE SQL PROBE 2026-05-06 (orchestrator-side):** these are different UUIDs in this database.

| user | admin_users.id | auth.users.id | match |
|------|----------------|---------------|-------|
| seth@usemingla.com | `4c336470-70b5-44f3-9e64-5bee8a292fa7` | `63835860-56bc-4ac9-a643-630558e111b5` | **false** |
| sethogieva@gmail.com | `f5a27a1a-23e7-4dcf-b8a9-0a0a48137376` | `b17e3e15-218d-475b-8c80-32d4948d6905` | **false** |

`admin_users` is keyed by `email`. Existing convention in `run-place-intelligence-trial/index.ts:309-314` correctly matches admin_users by EMAIL, not by id-equals-auth.uid().

**Impact if v1 shipped as-is:** RLS would block every admin read/write to `place_intelligence_runs`. Service-role writes (the worker) would bypass RLS automatically — so the worker still runs — but the admin UI's `list_active_runs` query would return empty results, the status panel would never hydrate, and Cancel button would silently fail. **Feature non-functional for every admin.**

**Fix:** RLS policy joins through email via `auth.users`. See §2.PATCHED below.

### Patch 2 — §3.1 worker pickup query (S2-medium)

**Defect in v1 (§3.1 process_chunk pseudocode, "Step 4: SELECT next chunk of pending rows"):**

```typescript
const { data: pendingRows } = await db
  .from('place_intelligence_trial_runs')
  .select('id, place_pool_id, signal_id, anchor_index')
  .eq('parent_run_id', runId)
  .eq('status', 'pending')
  .limit(12);
```

**Impact:** Step 5 then UPDATEs these rows to `status='running'` before processing them. If the worker process dies (Deno edge fn crash, network blip, OOM, server restart) AFTER step 5 but BEFORE step 6 finishes, those rows are **stranded in `'running'` status forever**. Parent-level heartbeat recovery (90s stale → cron re-fires worker) DOES bring a new worker online, but the new worker's pickup query `WHERE status='pending' LIMIT 12` does NOT include the stuck `'running'` rows. **Same bug class ORCH-0737 is fixing, just at a smaller granularity.**

**Fix:** Worker pickup query self-heals stuck rows by including `'running'` rows whose `started_at < now() - 5 min`. See §3.1.PATCHED below.

The 5-min threshold is intentionally well above:
- Worst-case 12-row chunk wallclock (~30s steady-state, ~60s with Gemini retry-once on every row)
- Worker startup + lock acquire (~1-2s)

Genuine in-flight rows are never falsely reclaimed.

### Other discoveries during v2 patch authoring

**None.** Scope locked exactly to the 2 gaps per dispatch prompt.

---

## §1 Scope + Non-Goals

**UNCHANGED from v1.** See [v1 §1](./SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md#§1-scope--non-goals).

---

## §2 Database Layer (PATCHED)

### Migration name (UNCHANGED)

`supabase/migrations/20260506000001_orch_0737_async_trial_runs.sql`

### Migration body (FULL — patched RLS step inline)

> **Differences from v1:** only step 4 RLS policy is patched. All other steps (1, 2, 3, 5, 6, 7, 8) are identical to v1. Reproduced in full here for self-containment.

```sql
-- ─────────────────────────────────────────────────────────────────────────
-- ORCH-0737: Full-city async trial mode (v2 — RLS policy fixed)
-- ─────────────────────────────────────────────────────────────────────────
-- Per DEC-111 (logged at ORCH-0737 CLOSE):
--   * NEW table place_intelligence_runs (run-level parent)
--   * FK on place_intelligence_trial_runs.parent_run_id → place_intelligence_runs(id)
--   * pg_cron job kick_pending_trial_runs (* * * * *)
--   * tg_kick_pending_trial_runs() trigger fn invoking edge fn via pg_net
--   * Unique partial index: one running/cancelling run per city
--   * RLS policy joining auth.users → admin_users by email (v2 fix per orchestrator REVIEW 2026-05-06;
--     v1 incorrectly assumed admin_users.id = auth.uid(), but they are different UUIDs)
--
-- Spec: Mingla_Artifacts/specs/SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL_v2.md §2
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. NEW TABLE place_intelligence_runs (run-level parent) ──────────────

CREATE TABLE IF NOT EXISTS public.place_intelligence_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id         uuid NOT NULL REFERENCES public.seeding_cities(id) ON DELETE RESTRICT,
  city_name       text NOT NULL,
  mode            text NOT NULL CHECK (mode IN ('sample','full_city')),
  sample_size     integer,
  total_count     integer NOT NULL,
  processed_count integer NOT NULL DEFAULT 0,
  succeeded_count integer NOT NULL DEFAULT 0,
  failed_count    integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','cancelling','cancelled','complete','failed')),
  cost_so_far_usd numeric(10,4) NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(10,4) NOT NULL,
  estimated_minutes integer NOT NULL,
  prompt_version  text NOT NULL,
  model           text NOT NULL,
  started_by      uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  cancelled_by    uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  error_reason    text,
  last_heartbeat_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  completed_at    timestamptz,

  CONSTRAINT chk_sample_size_consistency CHECK (
    (mode = 'sample' AND sample_size IS NOT NULL)
    OR (mode = 'full_city' AND sample_size IS NULL)
  )
);

COMMENT ON TABLE public.place_intelligence_runs IS
  'ORCH-0737 (DEC-111): run-level parent. Children are place_intelligence_trial_runs rows linked via parent_run_id FK. Status state machine: pending -> running -> (cancelling -> cancelled) | (complete) | (failed). last_heartbeat_at is updated by worker chunks; pg_cron job re-kicks workers when heartbeat is stale (>90s).';

-- ─── 2. UNIQUE PARTIAL INDEX: one running/cancelling run per city ────────

CREATE UNIQUE INDEX IF NOT EXISTS uniq_one_running_run_per_city
  ON public.place_intelligence_runs (city_id)
  WHERE status IN ('pending','running','cancelling');

-- ─── 3. INDEX for pg_cron pickup (status + stale heartbeat) ──────────────

CREATE INDEX IF NOT EXISTS idx_runs_active_for_cron
  ON public.place_intelligence_runs (status, last_heartbeat_at)
  WHERE status = 'running';

-- ─── 4. RLS: only active admin_users (v2 PATCHED — joins through email) ──

ALTER TABLE public.place_intelligence_runs ENABLE ROW LEVEL SECURITY;

-- v2 fix: admin_users.id ≠ auth.users.id in this database (verified via live
-- SQL probe 2026-05-06). admin_users is keyed by email per established
-- convention. Policy must join through auth.users to resolve the email-to-uid
-- mapping. Service-role writes bypass RLS automatically (standard PostgreSQL
-- behavior); applies to worker edge fn calls.
CREATE POLICY admin_full_access ON public.place_intelligence_runs
  USING (
    EXISTS (
      SELECT 1
      FROM auth.users u
      JOIN public.admin_users au ON au.email = u.email
      WHERE u.id = auth.uid()
        AND au.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM auth.users u
      JOIN public.admin_users au ON au.email = u.email
      WHERE u.id = auth.uid()
        AND au.status = 'active'
    )
  );

-- ─── 5. ADD parent_run_id FK to existing per-place table (UNCHANGED) ─────

ALTER TABLE public.place_intelligence_trial_runs
  ADD COLUMN IF NOT EXISTS parent_run_id uuid REFERENCES public.place_intelligence_runs(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.place_intelligence_trial_runs.parent_run_id IS
  'ORCH-0737: FK to place_intelligence_runs(id). Pre-ORCH-0737 rows have NULL (no parent row exists for those — historical audit). Post-ORCH-0737 new rows MUST have parent_run_id set; child rows cascade-delete with parent.';

-- ─── 6. pg_cron job: kick_pending_trial_runs (UNCHANGED) ─────────────────

DO $cron_setup$
DECLARE
  job_id bigint;
BEGIN
  SELECT jobid INTO job_id FROM cron.job WHERE jobname = 'kick_pending_trial_runs';
  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;

  PERFORM cron.schedule(
    'kick_pending_trial_runs',
    '* * * * *',
    $job$ SELECT public.tg_kick_pending_trial_runs(); $job$
  );
END;
$cron_setup$;

-- ─── 7. Trigger function: tg_kick_pending_trial_runs() (UNCHANGED) ───────

CREATE OR REPLACE FUNCTION public.tg_kick_pending_trial_runs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
  worker_url text;
  service_key text;
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

  FOR r IN
    SELECT id FROM public.place_intelligence_runs
    WHERE status = 'running'
      AND processed_count < total_count
      AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now() - interval '90 seconds')
    ORDER BY created_at ASC
    LIMIT 5
  LOOP
    PERFORM net.http_post(
      url := worker_url,
      body := jsonb_build_object(
        'action', 'process_chunk',
        'run_id', r.id
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
      )
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.tg_kick_pending_trial_runs IS
  'ORCH-0737 (DEC-111): pg_cron-driven kicker. Every 1 min: picks up to 5 active runs with stale heartbeat and HTTP-POSTs the worker edge fn via pg_net. Service role key is fetched from vault (operator must set vault.create_secret(''<service_role_key>'', ''service_role_key'') pre-deploy).';

-- ─── 8. ONE-TIME DATA CLEANUP: orphaned pending rows (UNCHANGED) ─────────

UPDATE public.place_intelligence_trial_runs
SET status = 'cancelled',
    error_message = 'ORCH-0737 cleanup: orphaned pending row from pre-async era',
    completed_at = now()
WHERE status = 'pending'
  AND started_at IS NULL
  AND parent_run_id IS NULL
  AND created_at < now() - interval '1 minute';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK reference:
--   BEGIN;
--     SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='kick_pending_trial_runs';
--     DROP FUNCTION IF EXISTS public.tg_kick_pending_trial_runs();
--     ALTER TABLE public.place_intelligence_trial_runs DROP COLUMN IF EXISTS parent_run_id;
--     DROP TABLE IF EXISTS public.place_intelligence_runs CASCADE;
--   COMMIT;
-- ─────────────────────────────────────────────────────────────────────────
```

### Pre-flight verification (UNCHANGED)

```sql
-- 1. Confirm vault has service_role_key
SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') AS vault_ready;

-- 2. Confirm pg_cron + pg_net extension versions match expected
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron','pg_net');

-- v2 ADDITION: 3. Confirm RLS policy resolves correctly for the current admin user
-- Run while authenticated as admin via Supabase JS client (NOT via service role).
SELECT EXISTS (
  SELECT 1
  FROM auth.users u
  JOIN public.admin_users au ON au.email = u.email
  WHERE u.id = auth.uid()
    AND au.status = 'active'
) AS rls_grants_access;
-- Expected: true for an admin; false otherwise.
```

### Companion DB RPCs (UNCHANGED — same as v1)

```sql
CREATE OR REPLACE FUNCTION public.lock_run_for_chunk(p_run_id uuid)
RETURNS public.place_intelligence_runs
LANGUAGE plpgsql
AS $$
DECLARE
  r public.place_intelligence_runs;
BEGIN
  SELECT * INTO r FROM public.place_intelligence_runs
    WHERE id = p_run_id
    FOR UPDATE NOWAIT;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_run_counters(
  p_run_id uuid,
  p_processed int,
  p_succeeded int,
  p_failed int,
  p_cost numeric
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.place_intelligence_runs
  SET processed_count = processed_count + p_processed,
      succeeded_count = succeeded_count + p_succeeded,
      failed_count    = failed_count + p_failed,
      cost_so_far_usd = cost_so_far_usd + p_cost
  WHERE id = p_run_id;
END;
$$;
```

---

## §3 Edge Function Layer

### §3.1 NEW action `process_chunk` (the async worker) — PATCHED

> **Differences from v1:** only step 4 pickup query is patched. All other steps (1, 2, 3, 5, 6, 7, 8) are identical to v1. Reproduced in full here for self-containment.

**Trigger:** pg_cron via `pg_net.http_post` OR self-invoke chain (deferred to ORCH-0737-followup if Pattern D adopted)
**Input:** `{ action: 'process_chunk', run_id: string }`
**Auth:** service-role only (rejects user JWT). Verify `req.headers.Authorization` matches service-role key bearer.

**Behavior (sequential pseudocode):**

```typescript
async function handleProcessChunk(db, body) {
  const runId = body.run_id;
  if (!runId) return json({ error: 'run_id required' }, 400);

  // Step 1: SELECT FOR UPDATE the parent row to get exclusive ownership of this chunk
  const { data: run, error: lockErr } = await db.rpc('lock_run_for_chunk', { p_run_id: runId });
  if (lockErr) {
    if (lockErr.code === '55P03' || lockErr.code === '23P01') {
      return json({ skipped: true, reason: 'concurrent_worker' });
    }
    return json({ error: lockErr.message }, 500);
  }
  if (!run) return json({ error: 'run not found' }, 404);

  // Step 2: Check status; bail on cancellation
  if (run.status === 'cancelling') {
    await db.from('place_intelligence_runs')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('id', runId);
    await db.from('place_intelligence_trial_runs')
      .update({ status: 'cancelled', completed_at: new Date().toISOString(), error_message: 'cancelled by operator' })
      .eq('parent_run_id', runId)
      .in('status', ['pending']);
    return json({ ok: true, action: 'cancelled' });
  }
  if (run.status !== 'running') return json({ skipped: true, reason: `status=${run.status}` });
  if (run.processed_count >= run.total_count) {
    await db.from('place_intelligence_runs')
      .update({ status: 'complete', completed_at: new Date().toISOString() })
      .eq('id', runId);
    return json({ ok: true, action: 'complete' });
  }

  // Step 3: Update heartbeat
  await db.from('place_intelligence_runs')
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq('id', runId);

  // ─── Step 4 (v2 PATCHED): SELECT next chunk — pickup pending AND stuck-running ───
  //
  // v2 fix: a row stuck in 'running' for > 5 minutes means a previous worker
  // died mid-chunk after marking the row 'running' but before completing it.
  // The 5-min threshold is well above worst-case chunk wallclock (~30s
  // steady-state, ~60s with Gemini retry-once on every row), so genuine
  // in-flight rows are never reclaimed mid-flight. Self-healing recovery.
  const stuckCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: pickupRows } = await db
    .from('place_intelligence_trial_runs')
    .select('id, place_pool_id, signal_id, anchor_index, status, started_at')
    .eq('parent_run_id', runId)
    .or(`status.eq.pending,and(status.eq.running,started_at.lt.${stuckCutoff})`)
    .limit(12);

  if (!pickupRows || pickupRows.length === 0) {
    await db.from('place_intelligence_runs')
      .update({ status: 'complete', completed_at: new Date().toISOString() })
      .eq('id', runId);
    return json({ ok: true, action: 'complete_no_pending' });
  }

  // v2 ADDITION: log when stuck-running rows are reclaimed (operational visibility)
  const reclaimed = pickupRows.filter((r) => r.status === 'running').length;
  if (reclaimed > 0) {
    console.warn(
      `[process_chunk] reclaimed ${reclaimed} stuck-running rows for run=${runId}`,
    );
  }

  // Step 5: Mark these rows as 'running' BEFORE processing (UNCHANGED).
  // The UPDATE is idempotent for already-'running' reclaimed rows; refreshes
  // started_at to now() so subsequent stuck-row recovery uses fresh timestamps.
  const rowIds = pickupRows.map((r) => r.id);
  await db.from('place_intelligence_trial_runs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .in('id', rowIds);

  // Step 6: Process in parallel-12 via Promise.all (UNCHANGED)
  const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
  // const serperKey = Deno.env.get('SERPER_API_KEY') ?? '';  // available for fetch_reviews step inside processOnePlace path

  const results = await Promise.all(pickupRows.map(async (row) => {
    try {
      // Inline-call existing helpers (or reuse processOnePlace flow)
      // ...fetch_reviews idempotent...
      // ...compose_collage idempotent...
      // ...run_trial_for_place via processOnePlace()...
      const cost = await processOnePlace({ db, geminiKey, runId, anchor: row });
      return { ok: true, place_pool_id: row.place_pool_id, cost };
    } catch (err) {
      return { ok: false, place_pool_id: row.place_pool_id, error: err.message };
    }
  }));

  // Step 7: Aggregate counts and update parent row (UNCHANGED)
  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;
  const chunkCost = results.reduce((s, r) => s + (r.cost || 0), 0);

  await db.rpc('increment_run_counters', {
    p_run_id: runId,
    p_processed: results.length,
    p_succeeded: succeeded,
    p_failed: failed,
    p_cost: chunkCost,
  });

  // Step 8: Check if run is complete now (UNCHANGED)
  const { data: updatedRun } = await db
    .from('place_intelligence_runs')
    .select('processed_count, total_count')
    .eq('id', runId)
    .single();

  if (updatedRun.processed_count >= updatedRun.total_count) {
    await db.from('place_intelligence_runs')
      .update({ status: 'complete', completed_at: new Date().toISOString() })
      .eq('id', runId);
  }

  return json({
    ok: true,
    chunk_size: results.length,
    succeeded,
    failed,
    chunk_cost_usd: chunkCost,
    reclaimed,                                                    // v2 ADDITION
    run_complete: updatedRun.processed_count >= updatedRun.total_count,
  });
}
```

### §3.2–§3.5 (UNCHANGED from v1)

`start_run` MODIFIED (mode='full_city' branch + parent insert + first-chunk kick), `cancel_trial` MODIFIED (parent.status='cancelling'), `run_status` MODIFIED (returns parent), `list_active_runs` NEW. See [v1 §3.2-§3.5](./SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md#§3-edge-function-layer) for full pseudocode.

---

## §4 Admin UI Layer

**UNCHANGED from v1.** See [v1 §4](./SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md#§4-admin-ui-layer).

---

## §5 Migration Deploy Ordering (UPDATED with v2 RLS verification step)

1. **Pre-flight check** (operator runs in Supabase SQL editor):
   - Confirm `vault.decrypted_secrets` has `service_role_key`
   - Confirm pg_cron + pg_net extension versions
   - **v2 ADDITION:** confirm `admin_users` has at least one `status='active'` row matching the operator's `auth.users.email` (safety check before deploy — if false, RLS will block the operator post-deploy)
2. **Deploy migration** `20260506000001_orch_0737_async_trial_runs.sql`
3. **Verify pg_cron job is registered**: `SELECT * FROM cron.job WHERE jobname='kick_pending_trial_runs';`
4. **v2 ADDITION: Verify RLS policy resolves for current admin** — run `SELECT EXISTS(...)` probe per §2 pre-flight verification step 3 (must return `true`); if `false`, **rollback before deploying edge fn**
5. **Deploy edge function** `run-place-intelligence-trial`
6. **Deploy admin UI**
7. **Smoke test**: Cary 50 sample mode (regression)
8. **Smoke test**: Cary 761 full-city mode (~64 min × $3.20)
9. **Tab-close test**: start Cary full-city, close tab after 5 min, return after 30 min, confirm progress continued
10. **Cancel test**: start London full-city, click Cancel after 5 min, verify worker stops at next chunk and partial results preserved

---

## §6 Test Cases — v2 ADDITIONS (T-21..T-25)

> v1 T-01..T-20 are **inherited unchanged**. See [v1 §6](./SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md#§6-test-cases).

### Patch 1 verification (Gap 1 — row-level stale recovery)

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| **T-21** | Worker dies mid-chunk after marking rows 'running' | Simulated via DB direct UPDATE: `UPDATE place_intelligence_trial_runs SET status='running', started_at=now()-interval '6 minutes' WHERE parent_run_id=:runId AND status='pending' LIMIT 12;` mid-active-run | Next pg_cron tick re-kicks worker; worker's v2-patched pickup query reclaims the 12 stuck rows; processes them; logs `[process_chunk] reclaimed 12 stuck-running rows` to console; eventually run completes with all rows successful. Run completes with `succeeded_count` matching `total_count`. | Worker pickup logic + recovery |
| **T-22** | Active in-flight chunk NOT falsely reclaimed | Worker chunk in progress (rows marked 'running' < 30s old). Concurrent worker call somehow bypasses FOR UPDATE NOWAIT (force via direct fn call from SQL editor): `SELECT public.tg_kick_pending_trial_runs();` immediately after observing the heartbeat update | Stuck-cutoff filter (`started_at < now()-5min`) excludes these rows. No double-processing. Concurrent worker either sees `concurrent_worker` from FOR UPDATE NOWAIT lock OR finds zero pickup rows (in-flight rows NOT eligible). | Worker pickup logic + race protection |

### Patch 2 verification (Gap 2 — RLS correctness)

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| **T-23** | Admin SELECT on `place_intelligence_runs` succeeds via JS client | Authenticated as admin user (e.g., `seth@usemingla.com`); `await supabase.from('place_intelligence_runs').select('*').limit(10)` from admin UI | RLS grants access. Rows visible. `error` is null. `data` is array of run rows the admin user is authorized to see (i.e., all runs since policy is `admin_full_access`). | RLS + DB |
| **T-24** | Non-admin SELECT on `place_intelligence_runs` blocked | Authenticated as non-admin user (any non-admin auth.users entry — e.g., a buyer-side user); same query | RLS blocks. `data` is empty array `[]`. `error` is null (RLS does not raise; returns no rows). | RLS + DB |
| **T-25** | Service-role bypass preserved | Worker edge fn (using service role key) writes to `place_intelligence_runs` (e.g., via `processOnePlace` → `increment_run_counters` → UPDATE) during chunk processing | Bypasses RLS as standard PostgreSQL behavior. UPDATE succeeds. Row state advances normally. | RLS + service role + worker |

---

## §7 Success Criteria — v2 ADDITIONS (SC-21, SC-22)

> v1 SC-01..SC-20 are **inherited unchanged**. See [v1 §7](./SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md#§7-success-criteria-each-observable--testable--unambiguous).

- **SC-21:** Worker pickup query in §3.1 step 4 reclaims rows stuck in `'running'` status with `started_at < now() - 5 min`. Worker logs `[process_chunk] reclaimed N stuck-running rows for run=<runId>` to console when reclamation happens. Verifiable via T-21 simulated worker-death scenario; verifiable via T-22 that non-stuck rows are NOT falsely reclaimed.

- **SC-22:** RLS policy `admin_full_access` on `place_intelligence_runs` correctly grants access to authenticated admin users (matched by email through `auth.users` join) and blocks all other authenticated users. Service-role writes bypass RLS as standard PostgreSQL behavior. Verifiable via T-23 (admin GRANTED), T-24 (non-admin BLOCKED), T-25 (service-role BYPASS).

---

## §8 Implementation Order

**UNCHANGED from v1.** See [v1 §8](./SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md#§8-implementation-order).

The 2 v2 patches integrate into existing implementation steps:
- Patch 1 (worker pickup) folds into v1 step 4 ("Edge fn — add `process_chunk` action + `list_active_runs` action") — the implementor uses the v2.PATCHED pseudocode in §3.1 above
- Patch 2 (RLS) folds into v1 step 2 ("Migration") — the implementor uses the v2.PATCHED migration body in §2 above

---

## §9 Effort Estimate

**v1 estimate: ~18h.** v2 adds ~30 min implementor time:
- ~10 min for the 2 mechanical patches themselves
- ~20 min for the 5 added test cases (T-21..T-25)

**v2 total: ~18.5h.** Single focused session feasible.

---

## §10 Operator Open Questions

**None.** All defaults from v1 dispatch + this v2 patch dispatch confirmed.

---

## §11 Invariants Preservation Strategy

**UNCHANGED from v1.** See [v1 §11](./SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md#§11-invariants-preservation-strategy).

Both v2 patches are invariant-preserving:
- Patch 1 (stale-row recovery) strengthens **I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING** by ensuring no stuck rows leak into ranking-feeding paths
- Patch 2 (RLS) restores admin authorization correctness; trial output remains PM-eval only (admins must be active to read)

---

## §12 Regression Prevention

**UNCHANGED from v1.** See [v1 §12](./SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md#§12-regression-prevention).

v2 ADDITION:
7. **Stuck-row recovery test fixture**: T-21 added to the test suite ensures any future regression that changes the pickup query and forgets stuck-row reclamation will FAIL the test.
8. **RLS smoke probe**: T-23 + T-24 added to the test suite ensures any future regression that changes the RLS policy and forgets the email-join will FAIL the test.

---

## §13 Lifecycle After CLOSE

**UNCHANGED from v1.** See [v1 §13](./SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md#§13-lifecycle-after-close).

---

## §14 Cross-references

- Investigation: [`reports/INVESTIGATION_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md`](../reports/INVESTIGATION_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md) (UNCHANGED)
- v1 SPEC (audit trail): [`specs/SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md`](./SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md)
- Forensics dispatch (v2 patch): [`prompts/FORENSICS_ORCH-0737_SPEC_V2_PATCH.md`](../prompts/FORENSICS_ORCH-0737_SPEC_V2_PATCH.md)
- Forensics dispatch (v1 IA): [`prompts/INVESTIGATOR_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md`](../prompts/INVESTIGATOR_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md)
- Predecessor SPEC: [`specs/SPEC_ORCH-0734_CITY_RUNS.md`](./SPEC_ORCH-0734_CITY_RUNS.md)
- DEC-110 (ORCH-0734 CLOSE), DEC-107 (ORCH-0735 CLOSE)
- INVARIANT_REGISTRY.md — I-TRIAL-CITY-RUNS-CANONICAL section
- Memory: `feedback_signal_anchors_decommissioned.md` (post-ORCH-0734)
- Orchestrator REVIEW evidence: live SQL probe 2026-05-06 confirming `admin_users.id ≠ auth.users.id`
