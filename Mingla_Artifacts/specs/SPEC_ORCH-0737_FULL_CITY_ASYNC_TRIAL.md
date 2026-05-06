# SPEC — ORCH-0737 FULL-CITY ASYNC TRIAL MODE

**ORCH-ID:** ORCH-0737
**Status:** BINDING — ratified for implementor dispatch
**Investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md`](../reports/INVESTIGATION_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md) (HIGH confidence)
**Authority:** ORCH-0734 (DEC-110 — sampled-sync architecture preserved); ORCH-0735 (DEC-107 — upstream pool quality gate); operator confirmation 2026-05-05/06 (Option B TOGGLE)
**DEC reservation:** DEC-111 (logged at CLOSE)

---

## §1 Scope + Non-Goals

### Scope (in)

1. New mode toggle in admin trial UI: `Sample` (default, current behavior preserved verbatim) OR `Whole city` (new durable async mode)
2. New parent table `place_intelligence_runs` storing run-level state (status / processed_count / cost_so_far / etc.)
3. New edge fn action `process_chunk` (worker) that pulls + processes pending rows in parallel-12 batches
4. pg_cron job (every 1 min) that kicks the worker for any active run with stale heartbeat
5. Trigger function `tg_kick_pending_trial_runs()` reading service-role key from `vault.decrypted_secrets`
6. Cancel UX: admin UI calls existing `cancel_trial` action (today inert) which updates parent.status='cancelling'; worker checks at chunk-start and respects
7. Cross-session resume: on admin page mount, query active runs and hydrate in-progress UI immediately
8. Cost-confirm dialog with double-confirm for runs > $5 (existing COST_GUARD_USD)
9. One-job-per-city DB enforcement via unique partial index
10. One-time data cleanup of 79 orphaned `pending` rows from pre-ORCH-0737 era
11. Run-history admin display querying parent table directly (vs current GROUP BY on per-place rows)

### Non-goals (out)

- **Sample mode architecture changes** — sample mode keeps current sync browser-loop. No async upgrade. Operator's directive.
- **External worker vendor (Inngest / Trigger.dev / etc.)** — out of scope per orchestrator dispatch
- **Realtime subscription via Supabase Realtime** — UI uses 5-second polling for status updates; Realtime can ship as ORCH-0737-followup if polling proves operator-painful
- **Auto-retry of failed rows mid-run** — failed rows stay failed; operator manually retries via separate UI affordance (deferred, out of scope)
- **Run pause** — only Cancel + restart; no pause-and-resume primitive
- **Multi-run concurrency tuning beyond per-city limit** — pg_cron LIMIT 5 is sufficient (matches max-5 cities operator might run in parallel)
- **Resume from cancelled** — `cancelled` is terminal. To re-run, operator starts a fresh run.
- **Migration cleanup of `model` column default** — defer (D-4 low-priority discovery)

### Assumptions

- `pg_cron` v1.6.4 + `pg_net` v0.19.5 are pre-installed (verified via live SQL probe)
- Vault is configured + service_role_key is stored in `vault.decrypted_secrets` (operator may need to set if not — implementor verifies pre-flight)
- Edge function default timeout (150s) is sufficient for chunk processing of 12 places (~30s) — operator does not need to bump per-function timeout in `supabase.toml`
- Gemini 2.5 Flash rate limits accommodate parallel-12 calls per chunk (Tier 1 = 1000 RPM; well below)

---

## §2 Database Layer

### Migration name

`supabase/migrations/20260506000001_orch_0737_async_trial_runs.sql`

### Migration body (verbatim)

```sql
-- ─────────────────────────────────────────────────────────────────────────
-- ORCH-0737: Full-city async trial mode
-- ─────────────────────────────────────────────────────────────────────────
-- Per DEC-111 (logged at ORCH-0737 CLOSE):
--   * NEW table place_intelligence_runs (run-level parent)
--   * FK on place_intelligence_trial_runs.parent_run_id → place_intelligence_runs(id)
--   * pg_cron job kick_pending_trial_runs (* * * * *)
--   * tg_kick_pending_trial_runs() trigger fn invoking edge fn via pg_net
--   * Unique partial index: one running/cancelling run per city
--
-- Spec: Mingla_Artifacts/specs/SPEC_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md §2
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

-- ─── 4. RLS: only active admin_users ─────────────────────────────────────

ALTER TABLE public.place_intelligence_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_full_access ON public.place_intelligence_runs
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.id = auth.uid() AND admin_users.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.id = auth.uid() AND admin_users.status = 'active'
    )
  );

-- Service role bypasses RLS (necessary for edge fn workers; default Postgres behavior).

-- ─── 5. ADD parent_run_id FK to existing per-place table ─────────────────

ALTER TABLE public.place_intelligence_trial_runs
  ADD COLUMN IF NOT EXISTS parent_run_id uuid REFERENCES public.place_intelligence_runs(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.place_intelligence_trial_runs.parent_run_id IS
  'ORCH-0737: FK to place_intelligence_runs(id). Pre-ORCH-0737 rows have NULL (no parent row exists for those — historical audit). Post-ORCH-0737 new rows MUST have parent_run_id set; child rows cascade-delete with parent.';

-- ─── 6. pg_cron job: kick_pending_trial_runs ─────────────────────────────

-- Idempotent: drop existing schedule first if any prior ORCH-0737 attempt left one
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
    '* * * * *',                                                   -- every 1 minute
    $job$ SELECT public.tg_kick_pending_trial_runs(); $job$
  );
END;
$cron_setup$;

-- ─── 7. Trigger function: tg_kick_pending_trial_runs() ───────────────────

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

  -- Fetch service_role_key from vault. Operator must set this secret pre-deploy:
  --   SELECT vault.create_secret('eyJhb...', 'service_role_key');
  -- If not set, function silently skips (next cron tick retries). Implementor
  -- should add a probe in pre-flight: SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name='service_role_key');
  SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;

  IF service_key IS NULL THEN
    RAISE NOTICE 'tg_kick_pending_trial_runs: service_role_key not in vault, skipping tick';
    RETURN;
  END IF;

  -- Pick up to 5 runs needing a kick (max 5 concurrent runs)
  FOR r IN
    SELECT id FROM public.place_intelligence_runs
    WHERE status = 'running'
      AND processed_count < total_count
      AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now() - interval '90 seconds')
    ORDER BY created_at ASC                                         -- oldest first
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
  'ORCH-0737 (DEC-111): pg_cron-driven kicker. Every 1 min: picks up to 5 active runs with stale heartbeat and HTTP-POSTs the worker edge fn via pg_net. Service role key is fetched from vault (operator must set vault.create_secret(''service_role_key'', ''eyJhb...'') pre-deploy).';

-- ─── 8. ONE-TIME DATA CLEANUP: orphaned pending rows from pre-ORCH-0737 ──
-- Per Investigation D-1: 79 rows with status=pending + started_at IS NULL +
-- created_at < ORCH-0737 deploy. These have no parent_run_id and no client
-- driver. Mark them cancelled with a clear audit reason.

UPDATE public.place_intelligence_trial_runs
SET status = 'cancelled',
    error_message = 'ORCH-0737 cleanup: orphaned pending row from pre-async era',
    completed_at = now()
WHERE status = 'pending'
  AND started_at IS NULL
  AND parent_run_id IS NULL
  AND created_at < now() - interval '1 minute';                     -- protect any in-flight inserts

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK reference:
--   BEGIN;
--     SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='kick_pending_trial_runs';
--     DROP FUNCTION IF EXISTS public.tg_kick_pending_trial_runs();
--     ALTER TABLE public.place_intelligence_trial_runs DROP COLUMN IF EXISTS parent_run_id;
--     DROP TABLE IF EXISTS public.place_intelligence_runs CASCADE;
--   COMMIT;
-- (The orphaned-row cleanup is NOT reversed; those rows stay 'cancelled' as
--  they were already broken pre-ORCH-0737.)
-- ─────────────────────────────────────────────────────────────────────────
```

### Pre-flight verification (implementor runs before deploy)

```sql
-- 1. Confirm vault has service_role_key
SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') AS vault_ready;
-- If false: operator must `SELECT vault.create_secret('<service_role_key>', 'service_role_key');`

-- 2. Confirm pg_cron + pg_net extension versions match expected
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron','pg_net');

-- 3. Smoke probe: insert a test row + verify pg_cron fires once
-- (run in staging, not production)
```

---

## §3 Edge Function Layer

### Action additions to `supabase/functions/run-place-intelligence-trial/index.ts`

#### 3.1 NEW action `process_chunk` (the async worker)

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
    // 23P01 lock_not_available means another worker is processing this run
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
    // Mark any remaining pending rows cancelled too
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

  // Step 4: SELECT next chunk of pending rows (limit 12)
  const { data: pendingRows } = await db
    .from('place_intelligence_trial_runs')
    .select('id, place_pool_id, signal_id, anchor_index')
    .eq('parent_run_id', runId)
    .eq('status', 'pending')
    .limit(12);

  if (!pendingRows || pendingRows.length === 0) {
    // No pending; mark complete (defensive — should have been caught above)
    await db.from('place_intelligence_runs')
      .update({ status: 'complete', completed_at: new Date().toISOString() })
      .eq('id', runId);
    return json({ ok: true, action: 'complete_no_pending' });
  }

  // Step 5: Mark these rows as 'running' BEFORE processing (so concurrent worker
  // calls don't pick the same rows up — though the run-level FOR UPDATE already
  // guards this; belt+suspenders)
  const rowIds = pendingRows.map((r) => r.id);
  await db.from('place_intelligence_trial_runs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .in('id', rowIds);

  // Step 6: Process in parallel-12 via Promise.all (each row processed by
  // existing per-place pipeline: fetch_reviews + compose_collage + run_trial_for_place)
  const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? '';
  const serperKey = Deno.env.get('SERPER_API_KEY') ?? '';

  const results = await Promise.all(pendingRows.map(async (row) => {
    try {
      // Inline-call existing helpers (or reuse processOnePlace flow)
      // ...fetch_reviews idempotent...
      // ...compose_collage idempotent...
      // ...run_trial_for_place via processOnePlace()...
      const cost = await processOnePlace({ db, geminiKey, runId, anchor: row });
      return { ok: true, place_pool_id: row.place_pool_id, cost };
    } catch (err) {
      // Per-place failure already records itself via existing handleRunTrialForPlace error path
      return { ok: false, place_pool_id: row.place_pool_id, error: err.message };
    }
  }));

  // Step 7: Aggregate counts and update parent row
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

  // Step 8: Check if run is complete now
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
    run_complete: updatedRun.processed_count >= updatedRun.total_count,
  });
}
```

**Companion DB RPCs (in same migration):**

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

#### 3.2 MODIFY action `start_run` (add `mode` body field)

**Old signature (preserved):** `{ action: 'start_run', city_id, sample_size }` (sample-mode, current)
**New signature:** `{ action: 'start_run', city_id, mode: 'sample'|'full_city', sample_size?: number }` (sample_size required if mode='sample', null if mode='full_city')

**New behavior:**

```typescript
const mode = body.mode ?? 'sample';            // backward-compat default
if (mode !== 'sample' && mode !== 'full_city') {
  return json({ error: "mode must be 'sample' or 'full_city'" }, 400);
}

// ... validate city, pull pool ...

const effectiveSize = mode === 'full_city'
  ? totalServable
  : Math.min(sampleSize, totalServable);

const estCost = +(effectiveSize * PER_PLACE_COST_USD).toFixed(4);

// COST_GUARD_USD enforcement: in full_city mode the body MUST include
// `confirm_high_cost: true` if cost > guard. UI sends this after double-confirm.
if (estCost > COST_GUARD_USD && mode === 'full_city' && body.confirm_high_cost !== true) {
  return json({
    error: 'cost_above_guard',
    estimated_cost_usd: estCost,
    cost_guard_usd: COST_GUARD_USD,
    message: 'Full-city run exceeds $5 cost guard. Resubmit with confirm_high_cost=true to override.',
  }, 400);
}

// In full_city mode: skip stratified random; take ALL servable rows
const sampledIds = mode === 'full_city'
  ? pool.map((p) => p.id)
  : computeStratifiedSample(pool, effectiveSize);   // existing logic extracted

// NEW: insert parent run row FIRST (so child FK validates)
const runId = crypto.randomUUID();
const { error: parentInsertErr } = await db
  .from('place_intelligence_runs')
  .insert({
    id: runId,
    city_id: cityId,
    city_name: city.name,
    mode,
    sample_size: mode === 'sample' ? effectiveSize : null,
    total_count: effectiveSize,
    estimated_cost_usd: estCost,
    estimated_minutes: Math.ceil(effectiveSize * PER_PLACE_WALL_SECONDS / 60),
    prompt_version: PROMPT_VERSION,
    model: GEMINI_MODEL_NAME_SHORT,
    started_by: userId,
    status: 'running',
    started_at: new Date().toISOString(),
  });

if (parentInsertErr) {
  // 23505 unique violation = one already running for this city
  if (parentInsertErr.code === '23505') {
    return json({ error: 'concurrent_run', message: `A run is already in progress for ${city.name}.` }, 409);
  }
  return json({ error: parentInsertErr.message }, 500);
}

// THEN insert pending child rows with parent_run_id set
const pendingRows = sampledIds.map((ppId) => ({
  run_id: runId,                                // legacy column kept for compat
  parent_run_id: runId,                          // NEW
  place_pool_id: ppId,
  city_id: cityId,
  signal_id: null,
  anchor_index: null,
  input_payload: {},
  status: 'pending',
  prompt_version: PROMPT_VERSION,
  model: GEMINI_MODEL_NAME_SHORT,
  retry_count: 0,
}));
await db.from('place_intelligence_trial_runs').upsert(pendingRows, { onConflict: 'run_id,place_pool_id' });

// Kick first chunk immediately via pg_net (don't wait for cron)
// ... (worker URL + service key from env) ...

return json({
  runId,
  cityId, cityName: city.name, cityCountry: city.country,
  totalServable,
  totalPlaces: effectiveSize,
  mode,
  estimatedCostUsd: estCost,
  estimatedMinutes: Math.ceil(effectiveSize * PER_PLACE_WALL_SECONDS / 60),
  // Browser-loop compat: only return anchors for sample mode (since browser
  // still drives sample loop). Full-city mode returns empty array.
  anchors: mode === 'sample'
    ? sampledIds.map((ppId) => ({ place_pool_id: ppId, signal_id: null }))
    : [],
});
```

#### 3.3 MODIFY action `cancel_trial`

**Old behavior:** UPDATE per-place rows to status='cancelled' WHERE run_id=X AND status IN ('pending','running')
**New behavior:** ALSO UPDATE parent place_intelligence_runs SET status='cancelling' WHERE id=runId AND status='running'. Worker picks up cancel signal at next chunk and finalizes to 'cancelled'.

```typescript
async function handleCancelTrial(db, body, userId) {
  const runId = body.run_id;
  if (!runId) return json({ error: 'run_id required' }, 400);

  // Update parent: signal cancellation
  const { data: run, error: parentErr } = await db
    .from('place_intelligence_runs')
    .update({ status: 'cancelling', cancelled_by: userId })
    .eq('id', runId)
    .eq('status', 'running')
    .select()
    .single();

  if (parentErr || !run) {
    // Parent row may not exist (legacy run pre-ORCH-0737) OR run already terminal
    // Fall back to legacy behavior: cancel per-place rows directly
    await db.from('place_intelligence_trial_runs')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('run_id', runId)
      .in('status', ['pending', 'running']);
    return json({ ok: true, mode: 'legacy' });
  }

  // Worker will see status='cancelling' on next chunk and finalize.
  return json({ ok: true, mode: 'async', run_status: 'cancelling' });
}
```

#### 3.4 MODIFY action `run_status`

**Old behavior:** GROUP BY run_id of per-place rows
**New behavior:** SELECT parent row FIRST, then per-place rows JOIN — return both run-level status + per-place rows.

```typescript
async function handleRunStatus(db, body) {
  const runId = body.run_id;
  if (!runId) return json({ error: 'run_id required' }, 400);

  const { data: parent } = await db
    .from('place_intelligence_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle();

  const { data: rows } = await db
    .from('place_intelligence_trial_runs')
    .select('place_pool_id, signal_id, anchor_index, status, cost_usd, error_message, started_at, completed_at, reviews_count')
    .eq('run_id', runId);

  return json({
    runId,
    parent,                                       // NEW: run-level state
    totalPlaces: rows?.length || 0,
    statusCounts: {
      pending: rows?.filter((r) => r.status === 'pending').length || 0,
      running: rows?.filter((r) => r.status === 'running').length || 0,
      completed: rows?.filter((r) => r.status === 'completed').length || 0,
      failed: rows?.filter((r) => r.status === 'failed').length || 0,
      cancelled: rows?.filter((r) => r.status === 'cancelled').length || 0,
    },
    totalCostUsd: rows?.reduce((s, r) => s + Number(r.cost_usd || 0), 0) || 0,
    rows: rows || [],
  });
}
```

#### 3.5 NEW action `list_active_runs`

For admin UI cross-session resume on mount:

```typescript
async function handleListActiveRuns(db) {
  const { data, error } = await db
    .from('place_intelligence_runs')
    .select('*')
    .in('status', ['pending', 'running', 'cancelling'])
    .order('created_at', { ascending: false });
  if (error) return json({ error: error.message }, 500);
  return json({ runs: data || [] });
}
```

---

## §4 Admin UI Layer

### 4.1 File: `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx`

#### 4.1.1 ADD mode toggle

Above city + sample size pickers:

```jsx
<div className="flex flex-col gap-2">
  <label className="block text-sm font-medium text-[var(--color-text-primary)]">
    Mode
  </label>
  <div className="flex gap-2 p-1 bg-[var(--gray-100)] rounded-lg">
    <button
      type="button"
      onClick={() => setMode('sample')}
      disabled={running || loading}
      className={[
        'flex-1 h-9 text-sm font-medium rounded-md transition-colors duration-150',
        mode === 'sample'
          ? 'bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm cursor-pointer'
          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer',
        'disabled:cursor-not-allowed disabled:opacity-50',
      ].join(' ')}
      aria-pressed={mode === 'sample'}
    >
      Sample
    </button>
    <button
      type="button"
      onClick={() => setMode('full_city')}
      disabled={running || loading}
      className={[
        'flex-1 h-9 text-sm font-medium rounded-md transition-colors duration-150',
        mode === 'full_city'
          ? 'bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm cursor-pointer'
          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer',
        'disabled:cursor-not-allowed disabled:opacity-50',
      ].join(' ')}
      aria-pressed={mode === 'full_city'}
    >
      Whole city
    </button>
  </div>
  <p className="text-xs text-[var(--color-text-tertiary)]">
    {mode === 'sample'
      ? 'Stratified random — top half by review_count + random fill. ~75 min for 200 places. Don\'t refresh during the run.'
      : 'Process every servable place in the city. Runs on the server — you can close this tab and come back later. Cancel anytime.'}
  </p>
</div>
```

#### 4.1.2 HIDE sample-size input when mode='full_city'

Wrap existing `<input type="number" id="trial-sample-size" />` in `{mode === 'sample' && (...)}`. When in full-city mode, sample size is meaningless.

#### 4.1.3 UPDATE cost+time estimate strip

```jsx
const effectiveCount = !selectedCity
  ? 0
  : mode === 'full_city'
    ? selectedCity.servable_count
    : Math.min(sampleSize, selectedCity.servable_count);

const estCostUsd = (effectiveCount * PER_PLACE_COST_USD).toFixed(2);
const estMinutes = Math.ceil((effectiveCount * PER_PLACE_WALL_SECONDS) / 60);
const estHours = (estMinutes / 60).toFixed(1);

// helper text:
selectedCity ? (
  <>
    {effectiveCount} of {selectedCity.servable_count} servable places
    · ~${estCostUsd}
    · ~{estMinutes < 60 ? `${estMinutes} min` : `${estHours} hrs`}
    {Number(estCostUsd) > 5 && <strong className="text-[var(--color-warning-700)]"> · cost guard requires double-confirm</strong>}
  </>
) : (
  <>...</>
)
```

#### 4.1.4 REWRITE `handleRunTrial` to branch on mode

```jsx
async function handleRunTrial() {
  if (isRunningRef.current) return;
  isRunningRef.current = true;

  if (!cityId) { /* ... */ return; }
  const selectedCity = cities.find((c) => c.id === cityId);
  if (!selectedCity) { /* ... */ return; }

  if (mode === 'sample') {
    return handleRunSampleTrial(selectedCity);          // existing logic, untouched
  }

  // FULL-CITY MODE
  const totalPlaces = selectedCity.servable_count;
  const estCost = (totalPlaces * PER_PLACE_COST_USD).toFixed(2);
  const estMinutes = Math.ceil((totalPlaces * PER_PLACE_WALL_SECONDS) / 60);
  const estHoursStr = estMinutes >= 60 ? `~${(estMinutes / 60).toFixed(1)} hrs` : `~${estMinutes} min`;

  // First confirm
  if (!window.confirm(
    `About to run a FULL-CITY trial for ${totalPlaces} places in ${selectedCity.name}, ${selectedCity.country}.\n\n` +
    `Estimated cost: ~$${estCost} USD\n` +
    `Estimated wall time: ${estHoursStr}\n\n` +
    `The run will execute on Mingla's servers. You can close this tab and come back hours later — the run keeps going until you click Cancel.\n\n` +
    `Continue?`
  )) {
    isRunningRef.current = false;
    return;
  }

  // Second confirm if cost > $5 guard
  const costNum = Number(estCost);
  if (costNum > 5 && !window.confirm(
    `⚠️ This run will charge approximately $${estCost} on the Gemini API.\n\n` +
    `The default cost guard is $5. You're authorizing an override.\n\n` +
    `I understand this will charge ~$${estCost}. Confirm again?`
  )) {
    isRunningRef.current = false;
    return;
  }

  setRunning(true);
  try {
    const { data: created, error: startErr } = await invokeWithRefresh('run-place-intelligence-trial', {
      body: {
        action: 'start_run',
        city_id: cityId,
        mode: 'full_city',
        confirm_high_cost: costNum > 5,
      },
    });
    if (startErr) throw new Error(await extractFunctionError(startErr, 'start_run failed'));

    addToast({
      variant: 'info',
      title: 'Full-city run started',
      description: `${created.cityName} · ${created.totalPlaces} places · est ${formatCost(created.estimatedCostUsd)} · ~${created.estimatedMinutes} min`,
    });

    // Start polling parent run for status updates
    setActiveRunId(created.runId);
    // (polling effect handles rest)
  } catch (err) {
    addToast({ variant: 'error', title: 'Couldn\'t start run', description: err.message });
  } finally {
    setRunning(false);
    isRunningRef.current = false;
  }
}
```

#### 4.1.5 ADD polling for active run status

```jsx
// Top-level state
const [activeRunId, setActiveRunId] = useState(null);
const [activeRun, setActiveRun] = useState(null);

// Cross-session resume on mount
useEffect(() => {
  async function hydrate() {
    const { data, error } = await invokeWithRefresh('run-place-intelligence-trial', {
      body: { action: 'list_active_runs' },
    });
    if (error) return;
    if (data?.runs?.length > 0) {
      // Pick the most recent active run; UI displays it as in-progress
      setActiveRunId(data.runs[0].id);
    }
  }
  hydrate();
}, []);

// Polling effect — runs every 5 seconds while activeRunId is set
useEffect(() => {
  if (!activeRunId) return;
  let cancelled = false;
  async function poll() {
    while (!cancelled) {
      const { data } = await invokeWithRefresh('run-place-intelligence-trial', {
        body: { action: 'run_status', run_id: activeRunId },
      });
      if (cancelled) break;
      if (data?.parent) {
        setActiveRun(data.parent);
        if (['complete', 'cancelled', 'failed'].includes(data.parent.status)) {
          // Terminal — stop polling, refresh full results
          setActiveRunId(null);
          await refresh();
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  poll();
  return () => { cancelled = true; };
}, [activeRunId]);
```

#### 4.1.6 ADD active-run progress panel

When `activeRun` is set, render a panel above the run history:

```jsx
{activeRun && (
  <div className="border border-[var(--color-brand-200)] rounded-lg p-4 space-y-3 bg-[var(--color-brand-50)]">
    <div className="flex items-baseline justify-between">
      <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
        {activeRun.mode === 'full_city' ? '🌍 Full-city run' : '⚡ Sample run'} — {activeRun.city_name}
      </h4>
      <span className="text-xs font-mono text-[var(--color-text-secondary)]">
        {activeRun.processed_count} / {activeRun.total_count}
        ({Math.round((activeRun.processed_count / activeRun.total_count) * 100)}%)
      </span>
    </div>
    <div className="h-2 bg-[var(--gray-200)] rounded-full overflow-hidden">
      <div
        className="h-full bg-[var(--color-brand-500)] transition-all duration-200"
        style={{ width: `${(activeRun.processed_count / activeRun.total_count) * 100}%` }}
      />
    </div>
    <div className="flex items-center gap-3 text-xs">
      <span className="text-[var(--color-success-700)]">✓ {activeRun.succeeded_count}</span>
      <span className="text-[var(--color-error-700)]">✗ {activeRun.failed_count}</span>
      <span className="text-[var(--color-text-secondary)]">cost: {formatCost(activeRun.cost_so_far_usd)}</span>
      <span className="ml-auto">
        <StatusBadge status={activeRun.status} />
      </span>
    </div>
    {activeRun.status === 'running' && (
      <Button variant="danger" size="sm" icon={Square} onClick={() => handleCancelActiveRun(activeRun.id)}>
        Cancel run
      </Button>
    )}
    {activeRun.status === 'cancelling' && (
      <p className="text-xs text-[var(--color-warning-700)]">Cancelling… will stop after current chunk (~30-90s)</p>
    )}
  </div>
)}
```

#### 4.1.7 ADD `handleCancelActiveRun(runId)`

```jsx
async function handleCancelActiveRun(runId) {
  if (!window.confirm('Cancel this run? Partial results will be preserved.')) return;
  const { error } = await invokeWithRefresh('run-place-intelligence-trial', {
    body: { action: 'cancel_trial', run_id: runId },
  });
  if (error) {
    addToast({ variant: 'error', title: 'Cancel failed', description: error.message });
    return;
  }
  addToast({ variant: 'info', title: 'Cancelling…', description: 'Run will stop after current chunk.' });
}
```

#### 4.1.8 PRESERVE existing sample-mode behavior

Rename existing `handleRunTrial` body to `handleRunSampleTrial`. Sample mode runs the existing browser-loop verbatim. Cancel for sample mode still uses client-side `stopRef.stop` flag PLUS calls `cancel_trial` action (defensive update so DB reflects the cancel).

### 4.2 File: `mingla-admin/src/pages/PlaceIntelligenceTrialPage.jsx`

Update the AlertCard "How this works" copy:

```jsx
<AlertCard variant="info" title="How this works">
  Pick a city → choose Sample or Whole city mode → click Run trial.
  Sample mode runs in your browser (~75 min for 200 places, $0.84 typical).
  Whole city mode runs on Mingla's servers — close the tab, come back hours later, the run keeps going. Cancel anytime.
</AlertCard>
```

---

## §5 Migration Deploy Ordering

1. **Pre-flight check** (operator runs in Supabase SQL editor):
   - Confirm `vault.decrypted_secrets` has `service_role_key` (if not: `SELECT vault.create_secret('<service_role_key>', 'service_role_key');`)
   - Confirm pg_cron + pg_net extension versions
2. **Deploy migration** `20260506000001_orch_0737_async_trial_runs.sql` (`supabase db push`)
3. **Verify pg_cron job is registered**: `SELECT * FROM cron.job WHERE jobname='kick_pending_trial_runs';`
4. **Deploy edge function** `run-place-intelligence-trial` (operator runs `supabase functions deploy run-place-intelligence-trial`)
5. **Deploy admin UI** (Vite build + push to deployment target)
6. **Smoke test** (Cary 50 sample mode — preserves existing flow); confirm 50/50 PASS
7. **Smoke test** (Cary full-city mode — ~64 min × $3.20); confirm completes durably
8. **Tab-close test** (start a Cary full-city, close tab after 5 min, return after 30 min, confirm progress continued)
9. **Cancel test** (start a London full-city, click Cancel after 5 min, verify worker stops at next chunk and partial results preserved)

---

## §6 Test Cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| **T-01** | Sample mode unchanged | Click Sample → Cary → 50 → Run | Existing browser-loop runs verbatim; 50/50 PASS in ~25 min for $0.21 | Full stack |
| **T-02** | Full-city happy path | Click Whole city → Cary → Run | parent row created with mode='full_city', 761 pending child rows; pg_cron picks up; ~64 min later all completed | Full stack |
| **T-03** | Tab close survives | Start full-city Cary → close tab after 5 min → reopen 30 min later | Active-run panel renders with current progress (e.g., 200/761 processed); no rows lost | UI hydration + worker durability |
| **T-04** | Cancel mid-run | Start London full-city → click Cancel after 5 min | parent.status='cancelling' → worker finalizes 'cancelled' at next chunk; partial rows preserved with their state | Edge fn + worker |
| **T-05** | Cost > $5 double-confirm | Click Whole city → London → Run | First window.confirm shows cost+time; second window.confirm shows red "I understand this will charge ~$14" | UI |
| **T-06** | Cost > $5 cancel via UI | Click Whole city → London → confirm first dialog → click Cancel on second | No run created; UI returns to idle | UI |
| **T-07** | Cost > $5 backend rejection | Send POST start_run with mode=full_city + city_id=london + confirm_high_cost omitted | 400 error 'cost_above_guard' with cost detail | Edge fn input validation |
| **T-08** | One-job-per-city block | Start Cary full-city → without waiting, try start_run for Cary again | 409 'concurrent_run' with city_name in message; UI displays toast | Schema unique partial index |
| **T-09** | Cross-city parallel allowed | Start Cary full-city → start Lagos full-city in parallel | Both runs progress concurrently; pg_cron LIMIT 5 picks both up | pg_cron + worker |
| **T-10** | Heartbeat stale recovery | Start Cary full-city → kill worker mid-chunk (simulated via DB UPDATE clearing last_heartbeat_at) | pg_cron next tick (within 90s window expiry) re-kicks; run completes | pg_cron watchdog |
| **T-11** | Cron double-tick no double-process | Force pg_cron tick twice in 10s | Second invocation hits FOR UPDATE NOWAIT → returns concurrent_worker; no duplicate rows | Worker concurrency guard |
| **T-12** | Cancelled is terminal | Start full-city → cancel → try start_run for same city | 409 if cancelling not yet finalized; otherwise allowed (cancelled is terminal) | UI + Schema |
| **T-13** | All places fail gracefully | Force Gemini API to 500 for every call | Each row records status='failed' with error_message; parent reaches 'complete' (vs 'failed' which means the run-level harness died); failed_count=total_count | Edge fn + parent state machine |
| **T-14** | Vault secret missing | Remove `service_role_key` from vault | tg_kick_pending_trial_runs() RAISE NOTICE + skip; no error spam; operator must fix | DB |
| **T-15** | Resumed-from-tab-reopen renders correctly | Start full-city → close tab → reopen | Active-run panel shows latest processed_count + cost_so_far; polling kicks off; UI eventually shows complete | UI hydration |
| **T-16** | Sample mode + active full-city co-exist | Start full-city Cary → in another browser session, start sample for Lagos | Both runs visible in run history; sample mode operates independently of full-city pg_cron | Architecture independence |
| **T-17** | Page-load with multiple active runs | Have 2 active full-city runs (Cary + London) → reload admin page | UI displays the most recent (London); panel shows London's progress; Cary is reachable via run-history | UI ordering |
| **T-18** | Cleanup migration handles orphans | Apply migration to DB with 79 orphaned pending rows | All 79 → status='cancelled' + error_message='ORCH-0737 cleanup: orphaned pending row from pre-async era' | Migration |
| **T-19** | Worker exits cleanly on heartbeat update conflict | Trigger race: two workers picking same chunk | First gets FOR UPDATE NOWAIT lock; second gets 23P01 → returns 'concurrent_worker'; no duplicates | Worker locking |
| **T-20** | Realtime cancel signal propagates within 90s | Start full-city → cancel → measure time-to-finalization | Worker sees cancelling within 30-90s of user click (one chunk boundary); UI status flips to cancelled | Latency |

---

## §7 Success Criteria (each observable + testable + unambiguous)

- **SC-01**: New `place_intelligence_runs` parent table exists with all columns specified in §2 migration. Verifiable via `\d place_intelligence_runs`.
- **SC-02**: Unique partial index `uniq_one_running_run_per_city` exists; second `start_run` for same city while previous is active returns HTTP 409.
- **SC-03**: `place_intelligence_trial_runs.parent_run_id` column exists; new rows post-deploy have non-null value; pre-deploy rows can be NULL.
- **SC-04**: pg_cron job `kick_pending_trial_runs` exists with schedule `* * * * *`. Verifiable via `SELECT * FROM cron.job WHERE jobname='kick_pending_trial_runs';`.
- **SC-05**: Function `tg_kick_pending_trial_runs()` exists; calling it manually with no eligible runs returns silently; with 1 eligible run, dispatches 1 `pg_net.http_post` call (verifiable via `pg_net.http_request_queue`).
- **SC-06**: Edge fn action `process_chunk` exists; called with valid `run_id`, processes up to 12 pending rows in parallel, updates parent row counters atomically.
- **SC-07**: Edge fn action `start_run` accepts `mode='full_city'` body field; without `confirm_high_cost=true`, returns 400 with `cost_above_guard` if estimated cost > $5.
- **SC-08**: Edge fn action `cancel_trial` updates parent.status='cancelling'; worker observes within next chunk boundary (≤90s) and finalizes parent.status='cancelled'.
- **SC-09**: Edge fn action `list_active_runs` returns rows where status IN ('pending','running','cancelling'), ordered by created_at DESC.
- **SC-10**: Admin UI mode toggle renders Sample/Whole city; clicking Whole city hides sample-size input and shows full-city helper text.
- **SC-11**: Cost-confirm dialog renders 2 confirms (first = standard cost+time; second = red high-cost double-confirm) when full-city cost > $5.
- **SC-12**: After tab close + reopen on a running full-city run, active-run panel hydrates from `list_active_runs` action and displays current progress.
- **SC-13**: Cancel button in active-run panel calls `cancel_trial` action; UI flips to 'cancelling' status; within ≤90s, status flips to 'cancelled'.
- **SC-14**: 79 orphaned pending rows get cleaned to status='cancelled' with audit message after migration deploy.
- **SC-15**: Sample mode (`mode='sample'`) functionally unchanged from pre-ORCH-0737; T-01 PASS verbatim against existing test fixtures.
- **SC-16**: Concurrent same-city `start_run` returns HTTP 409 'concurrent_run'; concurrent cross-city `start_run` succeeds for both.
- **SC-17**: Worker heartbeat updates `last_heartbeat_at` at start of each chunk; pg_cron skips runs with heartbeat < 90s old.
- **SC-18**: All 5 invariants in §10 of investigation preserved; CI gate (if applicable) shows 0 violations.
- **SC-19**: tsc clean; no new TS errors introduced; existing tests still pass.
- **SC-20**: Operator can run a full-city Cary sweep end-to-end (start → tab-close → return → cancel → restart → complete) in a smoke test session.

---

## §8 Implementation Order

1. **Pre-flight** — verify pg_cron + pg_net + vault.service_role_key
2. **Migration** (`20260506000001_orch_0737_async_trial_runs.sql`) — schema + cron + trigger + cleanup
3. **DB RPCs** — `lock_run_for_chunk()` + `increment_run_counters()` (in same migration)
4. **Edge fn** — add `process_chunk` action + `list_active_runs` action
5. **Edge fn** — modify `start_run` for mode='full_city' + parent row insert
6. **Edge fn** — modify `cancel_trial` for parent.status='cancelling' update
7. **Edge fn** — modify `run_status` to include parent state
8. **Admin UI** — add mode toggle + state
9. **Admin UI** — modify `handleRunTrial` to branch on mode
10. **Admin UI** — add `handleRunFullCityTrial` with double-confirm
11. **Admin UI** — add active-run polling + hydration on mount
12. **Admin UI** — add active-run progress panel + cancel button
13. **Admin UI** — preserve sample-mode behavior verbatim (rename existing handler)
14. **Admin UI** — update AlertCard copy
15. **Smoke deploy + Cary 50 sample mode** (regression check, T-01)
16. **Smoke deploy + Cary 761 full-city** (T-02)
17. **Smoke deploy + tab-close test** (T-03)
18. **Smoke deploy + Cancel test** (T-04)
19. **Implementor report**

---

## §9 Effort Estimate

| Phase | Hours |
|-------|------|
| Migration + DB RPCs | 2 |
| Edge fn additions (process_chunk + list_active_runs) | 4 |
| Edge fn modifications (start_run + cancel_trial + run_status) | 2 |
| Admin UI (mode toggle + handler split + cost dialog) | 3 |
| Admin UI (polling + hydration + active-run panel) | 4 |
| Smoke testing (Cary sample + Cary full + tab-close + cancel) | 2 |
| Report writing | 1 |
| **Total** | **~18 hours** |

Single focused session feasible; could split across 2 sessions (DB+edge fn first, UI second).

---

## §10 Operator Open Questions

**None.** All defaults from dispatch prompt confirmed by operator:
- Cancel control: operator-only (no auto-cancel)
- Concurrency: one-job-per-city; cross-city parallel allowed
- Sampled-sync mode: stays sync (no async upgrade)

---

## §11 Invariants Preservation Strategy

| Invariant | Preservation in this SPEC |
|-----------|---------------------------|
| I-TRIAL-CITY-RUNS-CANONICAL (DEC-110) | parent.city_id NOT NULL FK preserved on `place_intelligence_runs`; child unchanged |
| I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING | Worker only writes to `place_intelligence_runs` + `place_intelligence_trial_runs`; no production rerank tables touched |
| I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS (DEC-107) | start_run still queries `is_servable=true` for the pool; full-city mode inherits this filter |
| I-TRIAL-RUN-SCOPED-TO-CITY (pre-cursor DEC-105) | parent + child both NOT NULL on city_id |
| I-PHOTO-AESTHETIC-DATA-SOLE-OWNER | Worker calls existing `compose_collage` only via existing path; no new writers |
| I-COLLAGE-SOLE-OWNER | Same — delegates to existing pipeline |
| I-BOUNCER-DETERMINISTIC | Bouncer untouched |
| I-TWO-PASS-BOUNCER-RULE-PARITY | Bouncer untouched |

**No new invariants.** Pattern is feature-additive within established invariant frame.

---

## §12 Regression Prevention

1. **Worker double-execution prevention**: `lock_run_for_chunk()` uses `FOR UPDATE NOWAIT`; second worker hits 23P01 and returns immediately
2. **Race with cancel signal**: Worker checks `parent.status` at chunk start (after FOR UPDATE lock); cancel signal seen within ≤90s of click
3. **Stale heartbeat recovery**: pg_cron re-kicks after 90s; worker death recovered automatically
4. **Cost guard preservation**: Existing $5 guard enforced server-side; UI double-confirm is layered safety
5. **Migration idempotency**: All ALTERs use IF NOT EXISTS / DROP IF EXISTS; safe to re-apply
6. **Rollback path**: Migration provides explicit rollback SQL in comments; under 5 min to restore

---

## §13 Lifecycle After CLOSE

- DEC-111 logged at CLOSE
- Memory file (none new — existing memories cover this scope)
- Backup snapshot retention: N/A (no DROP TABLE in this migration; only ADD + cleanup)
- Future ORCH-0737-followup candidates:
  - **Pattern D upgrade**: add self-invocation chain alongside pg_cron for lower latency (only if 1-min cron tick proves operator-painful)
  - **Realtime subscription** for status panel (replace polling)
  - **Auto-retry of failed rows mid-run**
  - **Resume from cancelled** (if operator wants this primitive)

---

## §14 Cross-references

- Investigation: [`reports/INVESTIGATION_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md`](../reports/INVESTIGATION_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md)
- Forensics dispatch: [`prompts/INVESTIGATOR_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md`](../prompts/INVESTIGATOR_ORCH-0737_FULL_CITY_ASYNC_TRIAL.md)
- Predecessor SPEC: [`specs/SPEC_ORCH-0734_CITY_RUNS.md`](./SPEC_ORCH-0734_CITY_RUNS.md)
- DEC-110 (ORCH-0734 CLOSE), DEC-107 (ORCH-0735 CLOSE)
- INVARIANT_REGISTRY.md — I-TRIAL-CITY-RUNS-CANONICAL section
- Memory: `feedback_signal_anchors_decommissioned.md` (post-ORCH-0734) — context for why parent/child split is the natural evolution
