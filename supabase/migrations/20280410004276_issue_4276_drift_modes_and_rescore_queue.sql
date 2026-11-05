-- Issue #4276 wave 1, S1 and S2.
--
-- S1. The drift trigger inserts a parent run with mode='drift_reeval', and the
-- per-place re-evaluate button inserts mode='admin_reeval'. Neither mode was ever
-- admitted by place_intelligence_runs_mode_check, so:
--   * a re-seed or refresh that changed a scored place's business_status or a
--     summary aborted that place_pool UPDATE and failed the batch, and
--   * the re-evaluate button returned 500 on every click.
-- chk_sample_size_consistency is widened too: both modes write sample_size=1, so
-- fixing the first constraint alone would only move the failure to the second.
--
-- The trigger itself must not be able to abort a place_pool update again. Any
-- queue failure now warns and records in place_drift_queue_events. A city run
-- already holding uniq_one_running_run_per_city used to drop the event silently;
-- that is recorded as well, so a later stage can re-queue what was skipped.
--
-- S2. The 15-minute re-score sweep is capped at 500 pairs and took them
-- oldest-first by NULL timestamp. Measured in production on 2026-11-05: 367,692
-- pairs were "stale", of which at least 84,797 can never clear (Gemini vetoed, so
-- the scorer writes no row) and 50,286 had already been re-scored after the AI
-- result (rating or review floors, so the scorer stamps no AI timestamp). Those
-- permanent entries held the head of the queue, and a new Gemini result waited
-- behind them indefinitely.
--
-- A pair is now current when the scorer has already seen this AI result
-- (scored_at >= evaluated_at), when it is vetoed with no row left to delete, or
-- when an admin holds the score (the scorer would skip it anyway). This uses the
-- scorer's existing scored_at, so run-signal-scorer stays the sole writer of
-- ai_signal_scores_at (I-AI-SCORE-STALENESS-AUTO-RECOVERED). Newest results go
-- first, so nothing old can stand in front of something new.
--
-- BACKLOG HOLD. Unjamming the sweep as-is would release pairs evaluated months ago
-- into live decks: on 2026-11-05 that is 132,443 score changes across 12,898
-- places, and 60,031 vetoed pairs across 11,627 places leaving their decks. That
-- is a product decision, not a queue fix, so this selector only takes AI results
-- evaluated on or after 2026-11-05. Releasing the backlog is a one-line follow-up
-- migration, on Seth's approval.
--
-- Rollback: re-run the function bodies from
-- 20270713003526_issue_3526_drift_trigger_gemini_repin.sql and
-- 20260808000000_meta_orch_1009_sub_d_refresh_cron.sql. The widened constraints
-- and the events table are safe to leave in place.

BEGIN;

ALTER TABLE public.place_intelligence_runs
  DROP CONSTRAINT IF EXISTS place_intelligence_runs_mode_check;

ALTER TABLE public.place_intelligence_runs
  ADD CONSTRAINT place_intelligence_runs_mode_check
  CHECK (mode IN (
    'sample', 'full_city', 'retry_failed', 'remainder',
    'drift_reeval', 'admin_reeval'
  ));

ALTER TABLE public.place_intelligence_runs
  DROP CONSTRAINT IF EXISTS chk_sample_size_consistency;

ALTER TABLE public.place_intelligence_runs
  ADD CONSTRAINT chk_sample_size_consistency
  CHECK (
    (mode IN ('sample', 'drift_reeval', 'admin_reeval') AND sample_size IS NOT NULL)
    OR (mode IN ('full_city', 'retry_failed', 'remainder') AND sample_size IS NULL)
  );

CREATE TABLE public.place_drift_queue_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Deliberately no foreign key, and not called place_pool_id: recording must not
  -- be able to fail, the record should outlive the place, and this table must stay
  -- out of #2099's pinned list of tables that depend on a place.
  place_id uuid NOT NULL,
  city_id uuid,
  drift_kind text,
  outcome text NOT NULL CHECK (outcome IN ('skipped_active_run', 'queue_failed')),
  sqlstate text,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_place_drift_queue_events_created
  ON public.place_drift_queue_events (created_at DESC);

COMMENT ON TABLE public.place_drift_queue_events IS
  'Issue #4276: drift events the place_pool trigger could not queue for '
  're-evaluation. The trigger records here instead of aborting the place update.';

ALTER TABLE public.place_drift_queue_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.place_drift_queue_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.place_drift_queue_events TO authenticated;
GRANT ALL ON TABLE public.place_drift_queue_events TO service_role;

CREATE POLICY place_drift_queue_events_admin_read
  ON public.place_drift_queue_events
  FOR SELECT TO authenticated
  USING (public.is_admin_user());

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
  v_child_rows integer := 0;
  v_sqlstate text;
  v_message text;
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
  -- Guard 2: only queue if the place HAS an AI evaluation.
  IF NEW.ai_signal_scores IS NULL THEN RETURN NEW; END IF;
  -- Guard 3: only servable places (matches the consumer-ranker scope).
  IF NEW.is_servable IS NOT TRUE THEN RETURN NEW; END IF;

  -- This block is one subtransaction: if either insert fails, neither row stays,
  -- so no childless 'running' parent can hold the city's run slot.
  BEGIN
    -- A drift re-evaluation already queued for this place covers this event too.
    IF EXISTS (
      SELECT 1 FROM public.place_intelligence_trial_runs t
      WHERE t.place_pool_id = NEW.id
        AND t.source = 'auto-refresh-drift'
        AND t.status IN ('pending', 'running')
    ) THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.place_intelligence_runs (
      id, city_id, city_name, mode, sample_size, total_count,
      estimated_cost_usd, estimated_minutes,
      prompt_version, model, started_by, status, started_at
    ) VALUES (
      v_run_id, NEW.city_id,
      COALESCE((SELECT name FROM public.seeding_cities WHERE id = NEW.city_id LIMIT 1), 'drift'),
      'drift_reeval',
      1, 1,
      -- MUST stay equal to PER_PLACE_COST_USD in run-place-intelligence-trial/index.ts.
      0.0089, 1,
      'v4', 'gemini-3.6-flash',
      NULL,        -- system-initiated (no admin user)
      'running', now()
    );

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

    GET DIAGNOSTICS v_child_rows = ROW_COUNT;
    IF v_child_rows = 0 THEN
      -- Lost a race with another drift event for this place: it has it covered.
      DELETE FROM public.place_intelligence_runs WHERE id = v_run_id;
    END IF;

    RETURN NEW;
  EXCEPTION
    WHEN unique_violation THEN
      -- A run already holds this city's slot. Keep the update; record the skip.
      v_sqlstate := SQLSTATE;
      v_message := SQLERRM;
      BEGIN
        INSERT INTO public.place_drift_queue_events (
          place_id, city_id, drift_kind, outcome, sqlstate, message
        ) VALUES (
          NEW.id, NEW.city_id, v_drift_kind, 'skipped_active_run', v_sqlstate, v_message
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'place drift skip for % could not be recorded: % %', NEW.id, SQLSTATE, SQLERRM;
      END;
      RETURN NEW;
    WHEN OTHERS THEN
      v_sqlstate := SQLSTATE;
      v_message := SQLERRM;
      RAISE WARNING 'place drift re-evaluation for % was not queued: % %', NEW.id, v_sqlstate, v_message;
      BEGIN
        INSERT INTO public.place_drift_queue_events (
          place_id, city_id, drift_kind, outcome, sqlstate, message
        ) VALUES (
          NEW.id, NEW.city_id, v_drift_kind, 'queue_failed', v_sqlstate, v_message
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'place drift failure for % could not be recorded: % %', NEW.id, SQLSTATE, SQLERRM;
      END;
      RETURN NEW;
  END;
END;
$$;

COMMENT ON FUNCTION public.tg_meta_orch_1009_sub_d_drift_queue_reeval() IS
  'When business_status, editorial_summary or generative_summary changes on a '
  'servable place that has ai_signal_scores, queue a re-evaluation. Must never '
  'abort the place_pool update: failures warn and go to place_drift_queue_events '
  '(#4276). The model label is proved equal to GEMINI_MODEL_ID by CI gate '
  'i-3526-gemini-model-single-source.mjs (G-2).';

CREATE OR REPLACE FUNCTION public.pg_meta_orch_1009_sub_d_select_stale_pairs(
  p_limit int DEFAULT 500
)
RETURNS TABLE (place_id uuid, signal_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ai_keys AS (
    SELECT pp.id AS place_id,
           k.signal_id,
           (k.slice ->> 'evaluated_at')::timestamptz AS ai_evaluated_at,
           (k.slice ->> 'inappropriate_for') = 'true' AS vetoed
    FROM public.place_pool pp
    CROSS JOIN LATERAL jsonb_each(pp.ai_signal_scores) AS k(signal_id, slice)
    -- The scorer refuses an inactive or versionless signal outright, so a pair
    -- for one could only ever sit in the queue.
    JOIN public.signal_definitions sd
      ON sd.id = k.signal_id
     AND sd.is_active = true
     AND sd.current_version_id IS NOT NULL
    WHERE pp.ai_signal_scores IS NOT NULL
      AND pp.is_servable = true
      AND pp.is_active = true
  )
  SELECT ak.place_id, ak.signal_id
  FROM ai_keys ak
  LEFT JOIN public.place_scores ps
    ON ps.place_id = ak.place_id AND ps.signal_id = ak.signal_id
  WHERE
    -- BACKLOG HOLD (see the header). Remove on Seth's approval.
    ak.ai_evaluated_at >= TIMESTAMPTZ '2026-11-05 00:00:00+00'
    AND (
      -- New pair. A vetoed pair with no row has nothing to do, ever.
      (ps.place_id IS NULL AND ak.vetoed IS NOT TRUE)
      OR (
        ps.place_id IS NOT NULL
        -- Admin-held scores stay protected; the scorer skips them anyway.
        AND NOT (ps.contributions ?| ARRAY['_admin_set', '_admin_pin', '_admin_override'])
        AND (
          -- Not scored since this AI result. Rows the scorer has already seen
          -- (rating floor, review floor) have a NULL AI timestamp for good, so
          -- scored_at is the test, not the NULL.
          ps.scored_at < ak.ai_evaluated_at
          -- Scored after this result was written but from an older slice.
          OR ps.ai_signal_scores_at < ak.ai_evaluated_at
        )
      )
    )
  ORDER BY ak.ai_evaluated_at DESC, ak.place_id, ak.signal_id
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.pg_meta_orch_1009_sub_d_select_stale_pairs(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_meta_orch_1009_sub_d_select_stale_pairs(int) FROM anon;
REVOKE ALL ON FUNCTION public.pg_meta_orch_1009_sub_d_select_stale_pairs(int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pg_meta_orch_1009_sub_d_select_stale_pairs(int) TO service_role;

COMMENT ON FUNCTION public.pg_meta_orch_1009_sub_d_select_stale_pairs(int) IS
  'Per-tick selector for the 15-minute re-score sweep. Service-role only. Excludes '
  'pairs that can never clear, newest AI result first. Holds AI results evaluated '
  'before 2026-11-05 out of the sweep until Seth approves releasing them (#4276).';

COMMIT;
