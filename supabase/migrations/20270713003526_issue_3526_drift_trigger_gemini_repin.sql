-- issue #3526 [Gemini repin] — migration A of three.
--
-- WHY. `tg_meta_orch_1009_sub_d_drift_queue_reeval()` is a LIVE trigger
-- function, firing today on every place_pool drift event. It stamps two
-- literals onto the rows it queues: the model label `gemini-2.5-flash` and the
-- per-place cost `0.0040`. Nothing READS that model column back to route a
-- call — verified: every occurrence of `model` under supabase/functions is a
-- WRITE (`model: GEMINI_MODEL_NAME_SHORT`), and no `select()` names it. So a
-- source-only repin does NOT leave the cron path calling a dead model.
--
-- But it DOES leave newly-created rows labelled `gemini-2.5-flash` while the
-- call actually went to 3.6, which corrupts exactly the cost data the next
-- person reads during the next incident. The label has to move.
--
-- WHY A NEW MIGRATION. `20260808000000_meta_orch_1009_sub_d_refresh_cron.sql`
-- is APPLIED. It stays byte-identical. `CREATE OR REPLACE FUNCTION` here is
-- the supported way to move a live function forward.
--
-- NOT TOUCHED: `20260802000003_meta_orch_1009_sub_a_ai_signal_scores.sql:81`.
-- That is a one-shot backfill that already ran, and its rows were genuinely
-- scored by 2.5-flash — the label is historically accurate. Rewriting it would
-- falsify history.
--
-- SAFE-MIGRATION: idempotent (CREATE OR REPLACE), no DDL on any table, no data
-- movement, reversible (re-apply the 20260808 body). The trigger binding is
-- unchanged and is NOT re-created here — replacing the function in place keeps
-- the existing `tg_place_pool_drift_queue_reeval` attachment pointing at the
-- new body with no window where the trigger is missing.
--
-- The body below is the 20260808 body VERBATIM with exactly two value changes:
--   estimated_cost_usd  0.0040 -> 0.0089   (re-measured, see the code comment
--                                           on PER_PLACE_COST_USD)
--   model label   'gemini-2.5-flash' -> 'gemini-3.6-flash'  (two sites)

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
      -- Sub-D P0 fix (tester F-01): canonical city table is seeding_cities,
      -- not 'cities' which doesn't exist on this project. F-02 defense:
      -- COALESCE → 'drift' fallback handles NULL city_id cleanly.
      COALESCE((SELECT name FROM public.seeding_cities WHERE id = NEW.city_id LIMIT 1), 'drift'),
      'drift_reeval',
      1, 1,
      -- issue #3526: repriced for gemini-3.6-flash. MUST stay equal to
      -- PER_PLACE_COST_USD in run-place-intelligence-trial/index.ts (gate G-2
      -- proves the model label; the cost is a paired manual update, called out
      -- at both sites). Rate card: https://ai.google.dev/gemini-api/docs/pricing
      0.0089, 1,
      'v4', 'gemini-3.6-flash',
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
    'pending', 'v4', 'gemini-3.6-flash', 0, 'auto-refresh-drift'
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
  'issue #3526: repinned to gemini-3.6-flash after Google closed 2.5-flash to '
  'callers without usage history; per-place cost repriced 0.0040 -> 0.0089. '
  'The model id lives in supabase/functions/_shared/geminiModel.ts and CI gate '
  'i-3526-gemini-model-single-source.mjs (G-2) proves this label equals it. '
  'External-API doc: https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash';

-- ROLLBACK (manual, forward-only pipeline — documented per safe-migration
-- protocol): re-run the CREATE OR REPLACE FUNCTION block from
-- supabase/migrations/20260808000000_meta_orch_1009_sub_d_refresh_cron.sql.
