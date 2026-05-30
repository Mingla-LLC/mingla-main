-- META-ORCH-1009 Sub-D — Refresh cron + admin re-evaluate button +
-- Google-data-drift triggers + quarterly backstop.
--
-- Closes the staleness loop that DEC-182 documented: after every Sub-C
-- backfill round writes new Gemini Q2 evaluations into
-- `place_pool.ai_signal_scores`, a 15-min pg_cron sweep auto-re-runs
-- `run-signal-scorer` for ONLY the (place, signal) pairs whose AI slice is
-- newer than the existing `place_scores` row, so the consumer deck reflects
-- the new evaluation within 15 min instead of "until operator clicks."
--
-- Layers (SPEC §3.1–§3.6):
--   1. Detection column `place_scores.ai_signal_scores_at` + 15-min rescore
--      sweep (pg_cron + pg_net → run-signal-scorer per-place mode).
--   2. Google-data-drift trigger on `place_pool` (business_status,
--      editorial_summary, generative_summary) queues a pending row into
--      `place_intelligence_trial_runs` so the existing kick_pending_trial_runs
--      cron + trial-pipeline worker re-run Gemini Q2 for that one place.
--   3. Admin button (handled in edge fn + admin UI, not this migration).
--   4. Quarterly all-cities backstop cron at `0 4 1 */3 *` calling
--      run-signal-scorer once per active signal.
--
-- Operator-locked decisions:
--   D-3 (LOCKED): drift trigger fires on all 3 columns; ship as-is, monitor
--                 cost 30 days, tighten to business_status only if drift
--                 volume > 1,000/week.
--   D-6 (LOCKED): pre-apply seed-UPDATE at the END of this migration stamps
--                 `ai_signal_scores_at` for rows that are ALREADY up-to-date.
--                 Other rows stay NULL → cron picks them up for first
--                 AI-blended rescore (correct). First-sweep drains in ~8h
--                 instead of ~13.5h.
--
-- External-API docs cited inline per COMMS-0003:
--   - Supabase pg_cron + pg_net: https://supabase.com/docs/guides/cron
--   - Gemini 2.5 Flash pricing (drift-triggered re-eval cost):
--     https://ai.google.dev/pricing/gemini-2-5-flash
--   - Gemini 2.5 Flash function-calling (called via the existing trial fn):
--     https://ai.google.dev/api/generate-content#function_calling
--     (already cited at supabase/functions/run-place-intelligence-trial/index.ts:1092)
--
-- Cross-references:
--   - SPEC: Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_D_REFRESH_CRON.md
--   - Edge fns touched: supabase/functions/run-signal-scorer/index.ts +
--     supabase/functions/_shared/signalScorer.ts +
--     supabase/functions/run-place-intelligence-trial/index.ts
--   - Pattern reference: supabase/migrations/20260527000000_orch_0788_notification_retry_cron.sql
--   - Queue worker reference: supabase/migrations/20260506000001_orch_0737_async_trial_runs.sql
--   - Invariant established on apply: I-AI-SCORE-STALENESS-AUTO-RECOVERED.

-- =============================================================
-- §1. Extension + vault pre-flight (advisory NOTICEs, not EXCEPTIONs
-- except for pg_cron which is a DDL-time requirement).
-- =============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'META-ORCH-1009 Sub-D: pg_cron extension required but not enabled. Operator must enable via Supabase dashboard (Database -> Extensions -> pg_cron) before re-running this migration.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'META-ORCH-1009 Sub-D advisory: pg_net extension not enabled. Cron jobs will register but http_post calls fail until enabled.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'vault') THEN
    RAISE NOTICE 'META-ORCH-1009 Sub-D advisory: vault schema not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url') THEN
    RAISE NOTICE 'META-ORCH-1009 Sub-D advisory: vault secret supabase_url missing. Add it before relying on the rescore-sweep cron.';
  ELSIF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
    RAISE NOTICE 'META-ORCH-1009 Sub-D advisory: vault secret service_role_key missing.';
  END IF;
END$$;

-- =============================================================
-- §2. Layer 1 — Detection column on `place_scores`
-- =============================================================

ALTER TABLE public.place_scores
  ADD COLUMN IF NOT EXISTS ai_signal_scores_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.place_scores.ai_signal_scores_at IS
  'META-ORCH-1009 Sub-D: the evaluated_at timestamp from the AI slice '
  '(place_pool.ai_signal_scores -> signal_id ->> ''evaluated_at'') that fed '
  'the last blend write into this row''s score. NULL = pre-Sub-D row OR '
  'rule-only place (no AI evaluation present at score-compute time). The '
  'Sub-D rescore-sweep cron compares this value against the live AI slice '
  'timestamp to detect stale rows; sole writer is '
  'supabase/functions/run-signal-scorer/index.ts. See '
  'I-AI-SCORE-STALENESS-AUTO-RECOVERED.';

-- =============================================================
-- §3. Layer 2 — `source` provenance column on
-- `place_intelligence_trial_runs` + idempotency idx for drift queue.
-- =============================================================

ALTER TABLE public.place_intelligence_trial_runs
  ADD COLUMN IF NOT EXISTS source TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pit_runs_source_chk'
       AND conrelid = 'public.place_intelligence_trial_runs'::regclass
  ) THEN
    ALTER TABLE public.place_intelligence_trial_runs
      ADD CONSTRAINT pit_runs_source_chk
      CHECK (source IS NULL OR source IN ('auto-refresh-drift', 'admin-reeval-button'));
  END IF;
END$$;

COMMENT ON COLUMN public.place_intelligence_trial_runs.source IS
  'META-ORCH-1009 Sub-D: provenance tag. NULL = legacy admin-initiated '
  'trial run (default for all pre-Sub-D rows + admin city sweeps from '
  'PlacePoolManagementPage). ''auto-refresh-drift'' = inserted by the '
  'place_pool drift trigger. ''admin-reeval-button'' = inserted by the '
  'per-place admin button. Used for cost attribution + the idempotency '
  'partial unique index below.';

-- Idempotency: prevent a flood of pending drift-reeval rows for the same
-- place. If a drift-reeval is already pending or running for a place,
-- subsequent drift updates are dropped (next drift after the run completes
-- will re-queue normally).
CREATE UNIQUE INDEX IF NOT EXISTS
  idx_pit_runs_drift_reeval_one_per_place
  ON public.place_intelligence_trial_runs (place_pool_id)
  WHERE source = 'auto-refresh-drift'
    AND status IN ('pending', 'running');

-- =============================================================
-- §4. Layer 1 — SECURITY DEFINER helper: select stale (place, signal) pairs.
-- =============================================================

CREATE OR REPLACE FUNCTION public.pg_meta_orch_1009_sub_d_select_stale_pairs(
  p_limit int DEFAULT 500
)
RETURNS TABLE (place_id uuid, signal_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- META-ORCH-1009 Sub-D: returns (place, signal) pairs where the existing
  -- place_scores row is older than the AI evaluation timestamp stored in
  -- place_pool.ai_signal_scores. Includes BOTH:
  --   (a) drift pairs — ps row exists but its ai_signal_scores_at is NULL
  --       or older than the live ai slice evaluated_at.
  --   (b) new pairs — ai slice exists but ps row absent (LEFT JOIN catches
  --       these via ps.scored_at IS NULL).
  -- Bouncer is upstream: only is_servable places are returned (matches
  -- run-signal-scorer's own WHERE clause).
  -- Ordered oldest-stale-first so the cron drains the worst staleness over
  -- successive ticks. LIMIT bounds memory + edge-fn batch size; default 500
  -- = signal-scorer BATCH_SIZE.
  WITH ai_keys AS (
    SELECT pp.id AS place_id,
           k.signal_id,
           (pp.ai_signal_scores -> k.signal_id ->> 'evaluated_at')::timestamptz AS ai_evaluated_at
    FROM public.place_pool pp
    CROSS JOIN LATERAL jsonb_object_keys(pp.ai_signal_scores) AS k(signal_id)
    WHERE pp.ai_signal_scores IS NOT NULL
      AND pp.is_servable = true
      AND pp.is_active = true
  )
  SELECT ak.place_id, ak.signal_id
  FROM ai_keys ak
  LEFT JOIN public.place_scores ps
    ON ps.place_id = ak.place_id AND ps.signal_id = ak.signal_id
  WHERE ps.scored_at IS NULL
     OR ps.ai_signal_scores_at IS NULL
     OR ps.ai_signal_scores_at < ak.ai_evaluated_at
  ORDER BY COALESCE(ps.ai_signal_scores_at, '1970-01-01'::timestamptz) ASC,
           ak.place_id, ak.signal_id
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.pg_meta_orch_1009_sub_d_select_stale_pairs(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_meta_orch_1009_sub_d_select_stale_pairs(int) FROM anon;
REVOKE ALL ON FUNCTION public.pg_meta_orch_1009_sub_d_select_stale_pairs(int) FROM authenticated;

COMMENT ON FUNCTION public.pg_meta_orch_1009_sub_d_select_stale_pairs(int) IS
  'META-ORCH-1009 Sub-D: per-tick stale-pair selector for the 15-min rescore '
  'cron. Service-role only.';

-- =============================================================
-- §5. Layer 1 — pg_cron kicker fn + 15-min schedule.
-- =============================================================

CREATE OR REPLACE FUNCTION public.tg_meta_orch_1009_sub_d_kick_rescores()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  worker_url text;
  service_key text;
  per_signal_chunks jsonb := '{}'::jsonb;
  sig text;
  chunk_ids text[];
BEGIN
  -- Vault secret lookup (same pattern as orch_0788).
  SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  IF service_key IS NULL THEN
    RAISE NOTICE 'tg_meta_orch_1009_sub_d_kick_rescores: service_role_key not in vault, skipping tick';
    RETURN;
  END IF;
  SELECT decrypted_secret INTO worker_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  IF worker_url IS NULL THEN
    RAISE NOTICE 'tg_meta_orch_1009_sub_d_kick_rescores: supabase_url not in vault, skipping tick';
    RETURN;
  END IF;
  worker_url := worker_url || '/functions/v1/run-signal-scorer';

  -- Gather stale pairs (cap 500 per tick) and bucket by signal_id so we
  -- fire one HTTP request per signal containing up to N place_ids. Avoids
  -- 16 separate requests when only 2 signals are dirty; keeps the per-signal
  -- request bounded for run-signal-scorer's existing 500-place BATCH_SIZE.
  FOR r IN SELECT * FROM public.pg_meta_orch_1009_sub_d_select_stale_pairs(500)
  LOOP
    per_signal_chunks := jsonb_set(
      per_signal_chunks,
      ARRAY[r.signal_id],
      COALESCE(per_signal_chunks -> r.signal_id, '[]'::jsonb) || to_jsonb(r.place_id::text),
      true
    );
  END LOOP;

  -- Empty = nothing stale; quiet exit (no HTTP fires).
  IF per_signal_chunks = '{}'::jsonb THEN RETURN; END IF;

  -- One HTTP POST per affected signal.
  FOR sig IN SELECT jsonb_object_keys(per_signal_chunks) LOOP
    SELECT array_agg(value) INTO chunk_ids
      FROM jsonb_array_elements_text(per_signal_chunks -> sig);
    PERFORM net.http_post(
      url := worker_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body := jsonb_build_object(
        'signal_id', sig,
        'place_ids', to_jsonb(chunk_ids),
        'source', 'meta-orch-1009-sub-d-stale-sweep'
      ),
      timeout_milliseconds := 60000
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.tg_meta_orch_1009_sub_d_kick_rescores() IS
  'META-ORCH-1009 Sub-D: pg_cron-driven re-score kicker. Every 15 min, '
  'selects up to 500 (place, signal) pairs where place_scores is stale '
  'vs place_pool.ai_signal_scores and HTTP-POSTs run-signal-scorer in '
  'per-place mode (NEW request shape introduced by Sub-D). Vault secrets '
  'supabase_url + service_role_key required.';

-- Idempotent unschedule + schedule.
DO $cron_setup$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job
    WHERE jobname = 'meta_orch_1009_sub_d_ai_score_rescore_sweep';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;

  PERFORM cron.schedule(
    'meta_orch_1009_sub_d_ai_score_rescore_sweep',
    '*/15 * * * *',
    $job$ SELECT public.tg_meta_orch_1009_sub_d_kick_rescores(); $job$
  );
END;
$cron_setup$;

-- =============================================================
-- §6. Layer 2 — Google-data-drift trigger on place_pool.
-- =============================================================

CREATE OR REPLACE FUNCTION public.tg_meta_orch_1009_sub_d_drift_queue_reeval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_drift_kind text;
  v_changed boolean := false;
BEGIN
  -- Determine WHICH of the 3 columns drifted (for the audit log).
  IF NEW.business_status IS DISTINCT FROM OLD.business_status THEN
    v_changed := true; v_drift_kind := 'business_status';
  ELSIF NEW.editorial_summary IS DISTINCT FROM OLD.editorial_summary THEN
    v_changed := true; v_drift_kind := 'editorial_summary';
  ELSIF NEW.generative_summary IS DISTINCT FROM OLD.generative_summary THEN
    v_changed := true; v_drift_kind := 'generative_summary';
  END IF;

  -- Guard 1: at least one of the 3 columns actually changed.
  IF NOT v_changed THEN RETURN NEW; END IF;
  -- Guard 2: only queue if the place HAS an AI evaluation (no point
  -- re-evaluating something Sub-C hasn't covered yet — Sub-C's backfill
  -- will pick it up on its own schedule).
  IF NEW.ai_signal_scores IS NULL THEN RETURN NEW; END IF;
  -- Guard 3: only servable places (matches the consumer-ranker scope).
  IF NEW.is_servable IS NOT TRUE THEN RETURN NEW; END IF;

  -- Insert parent run row (mode='drift_reeval'). The existing
  -- place_intelligence_runs unique partial index on (city_id) WHERE status
  -- IN ('pending','running','cancelling') can conflict with an existing
  -- city run — we tolerate by catching unique_violation and silently
  -- skipping the queue (the next drift event after the city run completes
  -- will re-queue).
  BEGIN
    INSERT INTO public.place_intelligence_runs (
      id, city_id, city_name, mode, sample_size, total_count,
      estimated_cost_usd, estimated_minutes,
      prompt_version, model, started_by, status, started_at
    ) VALUES (
      v_run_id, NEW.city_id,
      COALESCE((SELECT name FROM public.cities WHERE id = NEW.city_id LIMIT 1), 'drift'),
      'drift_reeval',
      1, 1,
      0.0040, 1,   -- ~$0.0040/place Gemini Q2 cost per https://ai.google.dev/pricing/gemini-2-5-flash
      'v4', 'gemini-2.5-flash',
      NULL,        -- system-initiated (no admin user)
      'running', now()
    );
  EXCEPTION WHEN unique_violation THEN
    -- A city run is already active for this city; skip the queue.
    -- Next drift event after that run completes will re-fire.
    RETURN NEW;
  END;

  -- Insert pending child row. The Sub-D partial unique index prevents
  -- duplicates per place.
  INSERT INTO public.place_intelligence_trial_runs (
    run_id, parent_run_id, place_pool_id, city_id, signal_id,
    anchor_index, input_payload, status, prompt_version, model,
    retry_count, source
  ) VALUES (
    v_run_id, v_run_id, NEW.id, NEW.city_id, NULL, NULL,
    jsonb_build_object('drift_kind', v_drift_kind,
                       'triggered_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'pending', 'v4', 'gemini-2.5-flash', 0, 'auto-refresh-drift'
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_meta_orch_1009_sub_d_drift_queue_reeval() IS
  'META-ORCH-1009 Sub-D: when business_status / editorial_summary / '
  'generative_summary changes on a place that already has ai_signal_scores '
  'populated, queue a pending row into place_intelligence_trial_runs with '
  'source=auto-refresh-drift. The existing kick_pending_trial_runs cron + '
  'trial-pipeline worker handle the actual Gemini Q2 re-evaluation. '
  'External-API doc: Gemini 2.5 Flash invoked via the existing trial fn — '
  'https://ai.google.dev/api/generate-content#function_calling already '
  'cited at supabase/functions/run-place-intelligence-trial/index.ts:1092.';

DROP TRIGGER IF EXISTS tg_place_pool_drift_queue_reeval ON public.place_pool;
CREATE TRIGGER tg_place_pool_drift_queue_reeval
  AFTER UPDATE OF business_status, editorial_summary, generative_summary
  ON public.place_pool
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_meta_orch_1009_sub_d_drift_queue_reeval();

-- =============================================================
-- §7. Layer 4 — Quarterly backstop fn + cron schedule.
-- =============================================================

CREATE OR REPLACE FUNCTION public.tg_meta_orch_1009_sub_d_quarterly_sweep()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  worker_url text;
  service_key text;
  sig text;
BEGIN
  SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  SELECT decrypted_secret INTO worker_url
    FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  IF service_key IS NULL OR worker_url IS NULL THEN
    RAISE NOTICE 'tg_meta_orch_1009_sub_d_quarterly_sweep: vault secrets missing, skipping tick';
    RETURN;
  END IF;
  worker_url := worker_url || '/functions/v1/run-signal-scorer';

  -- Iterate active signals; one HTTP per signal with all_cities=true.
  -- Spaced 60s apart by pg_sleep to avoid stacking 16 long-running worker
  -- invocations on the edge fn fleet.
  FOR sig IN SELECT id FROM public.signal_definitions WHERE is_active = true ORDER BY id LOOP
    PERFORM net.http_post(
      url := worker_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body := jsonb_build_object(
        'signal_id', sig,
        'all_cities', true,
        'source', 'meta-orch-1009-sub-d-quarterly-backstop'
      ),
      timeout_milliseconds := 60000
    );
    PERFORM pg_sleep(60);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.tg_meta_orch_1009_sub_d_quarterly_sweep() IS
  'META-ORCH-1009 Sub-D: 90-day all-cities backstop sweep. Iterates active '
  'signals; one HTTP POST per signal with all_cities=true; 60s gap between. '
  'Safety net for anything the drift trigger missed.';

DO $cron_setup$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job
    WHERE jobname = 'meta_orch_1009_sub_d_quarterly_all_cities_sweep';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;

  PERFORM cron.schedule(
    'meta_orch_1009_sub_d_quarterly_all_cities_sweep',
    '0 4 1 */3 *',
    $job$ SELECT public.tg_meta_orch_1009_sub_d_quarterly_sweep(); $job$
  );
END;
$cron_setup$;

-- =============================================================
-- §8. Verification probes — schema + cron registration.
-- =============================================================

DO $$
DECLARE
  v_schedule text;
BEGIN
  -- Column added on place_scores.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'place_scores'
       AND column_name = 'ai_signal_scores_at'
  ) THEN
    RAISE EXCEPTION 'META-ORCH-1009 Sub-D probe failed: place_scores.ai_signal_scores_at did not land';
  END IF;

  -- Column added on place_intelligence_trial_runs.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'place_intelligence_trial_runs'
       AND column_name = 'source'
  ) THEN
    RAISE EXCEPTION 'META-ORCH-1009 Sub-D probe failed: place_intelligence_trial_runs.source did not land';
  END IF;

  -- Rescore-sweep cron registered with correct schedule.
  SELECT schedule INTO v_schedule FROM cron.job
    WHERE jobname = 'meta_orch_1009_sub_d_ai_score_rescore_sweep' LIMIT 1;
  IF v_schedule IS DISTINCT FROM '*/15 * * * *' THEN
    RAISE EXCEPTION 'META-ORCH-1009 Sub-D probe failed: rescore-sweep cron schedule is % (expected */15 * * * *)', v_schedule;
  END IF;

  -- Quarterly backstop cron registered with correct schedule.
  SELECT schedule INTO v_schedule FROM cron.job
    WHERE jobname = 'meta_orch_1009_sub_d_quarterly_all_cities_sweep' LIMIT 1;
  IF v_schedule IS DISTINCT FROM '0 4 1 */3 *' THEN
    RAISE EXCEPTION 'META-ORCH-1009 Sub-D probe failed: quarterly cron schedule is % (expected 0 4 1 */3 *)', v_schedule;
  END IF;

  -- Drift trigger present on place_pool.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'tg_place_pool_drift_queue_reeval'
       AND tgrelid = 'public.place_pool'::regclass
  ) THEN
    RAISE EXCEPTION 'META-ORCH-1009 Sub-D probe failed: drift trigger not registered on place_pool';
  END IF;
END$$;

-- =============================================================
-- §9. D-6 (LOCKED) — pre-apply seed-UPDATE for rows already up-to-date.
--
-- Stamps ai_signal_scores_at for (place, signal) pairs where the existing
-- place_scores row was scored AFTER the AI slice's evaluated_at. These are
-- rows that already absorbed the AI input via Sub-B; the cron should NOT
-- re-do them on first tick. Other rows (NULL ai_signal_scores_at where
-- scored_at <= ai_evaluated_at, or ps row missing entirely) stay NULL so
-- the cron picks them up for first AI-blended rescore.
--
-- This shrinks the first-sweep drain from ~13.5h to ~8h per operator
-- decision 2026-05-30.
-- =============================================================

UPDATE public.place_scores ps
SET ai_signal_scores_at = (pp.ai_signal_scores -> ps.signal_id ->> 'evaluated_at')::timestamptz
FROM public.place_pool pp
WHERE pp.id = ps.place_id
  AND pp.ai_signal_scores IS NOT NULL
  AND pp.ai_signal_scores ? ps.signal_id
  AND ps.ai_signal_scores_at IS NULL
  AND ps.scored_at > (pp.ai_signal_scores -> ps.signal_id ->> 'evaluated_at')::timestamptz;

-- =============================================================
-- §10. Final NOTICE — operator-visible apply summary.
-- =============================================================

DO $$
DECLARE
  v_seeded_count bigint;
  v_stale_remaining bigint;
BEGIN
  SELECT COUNT(*) INTO v_seeded_count
    FROM public.place_scores WHERE ai_signal_scores_at IS NOT NULL;
  SELECT COUNT(*) INTO v_stale_remaining
    FROM public.pg_meta_orch_1009_sub_d_select_stale_pairs(99999);
  RAISE NOTICE 'META-ORCH-1009 Sub-D apply complete. ai_signal_scores_at populated: % rows. Stale pairs queued for first cron tick: %.',
    v_seeded_count, v_stale_remaining;
END$$;
