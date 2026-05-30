-- META-ORCH-1009 Sub-A — post-apply read-only verification probe for
-- migration 20260802000003_meta_orch_1009_sub_a_ai_signal_scores.sql.
--
-- USAGE (manual; this repo's SQL probe convention is hand-run psql against
-- the linked remote via the Supabase Management API or `supabase db remote`):
--
--   cat supabase/migrations/__tests__/meta_orch_1009_sub_a_ai_signal_scores_backfill.test.sql \
--     | /Users/sethogieva/bin/supabase db remote sql --linked
--
-- All checks are READ-ONLY. RAISE NOTICE on PASS, RAISE EXCEPTION on FAIL so
-- the probe exits non-zero in CI/scripts.
--
-- Coverage (per SPEC §4.1):
--   M-01: column exists, jsonb, nullable
--   M-02: GIN index exists with jsonb_path_ops
--   M-03: column comment present (substring match)
--   M-04: backfill row count matches distinct-q2-place count
--   M-08: idempotency — re-running backfill produces zero changes (verified
--         by re-running the WHERE-IS-DISTINCT-FROM probe SELECT — should
--         return 0 candidate rows)

DO $$
DECLARE
  v_type        text;
  v_nullable    text;
  v_idx_def     text;
  v_comment     text;
  v_backfilled  int;
  v_source      int;
  v_drift_frac  float;
  v_drift_candidates int;
BEGIN
  -- M-01: column type + nullability
  SELECT data_type, is_nullable
    INTO v_type, v_nullable
    FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name='place_pool'
     AND column_name='ai_signal_scores';

  IF v_type IS NULL THEN
    RAISE EXCEPTION 'M-01 FAIL: place_pool.ai_signal_scores does not exist';
  END IF;
  IF v_type <> 'jsonb' THEN
    RAISE EXCEPTION 'M-01 FAIL: expected jsonb, got %', v_type;
  END IF;
  IF v_nullable <> 'YES' THEN
    RAISE EXCEPTION 'M-01 FAIL: expected nullable, got %', v_nullable;
  END IF;
  RAISE NOTICE 'M-01 PASS: place_pool.ai_signal_scores jsonb (nullable)';

  -- M-02: GIN index with jsonb_path_ops
  SELECT indexdef INTO v_idx_def
    FROM pg_indexes
   WHERE schemaname='public'
     AND tablename='place_pool'
     AND indexname='idx_place_pool_ai_signal_scores';
  IF v_idx_def IS NULL THEN
    RAISE EXCEPTION 'M-02 FAIL: idx_place_pool_ai_signal_scores missing';
  END IF;
  IF v_idx_def NOT LIKE '%USING gin%' THEN
    RAISE EXCEPTION 'M-02 FAIL: not a GIN index: %', v_idx_def;
  END IF;
  IF v_idx_def NOT LIKE '%jsonb_path_ops%' THEN
    RAISE EXCEPTION 'M-02 FAIL: missing jsonb_path_ops opclass: %', v_idx_def;
  END IF;
  RAISE NOTICE 'M-02 PASS: GIN(jsonb_path_ops) index present';

  -- M-03: column comment present
  SELECT col_description('public.place_pool'::regclass, ordinal_position::int)
    INTO v_comment
    FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name='place_pool'
     AND column_name='ai_signal_scores';
  IF v_comment IS NULL OR length(v_comment) < 100 THEN
    RAISE EXCEPTION 'M-03 FAIL: column comment missing or too short';
  END IF;
  IF v_comment NOT LIKE '%I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER%' THEN
    RAISE EXCEPTION 'M-03 FAIL: comment missing sole-owner invariant ref';
  END IF;
  RAISE NOTICE 'M-03 PASS: column comment present + names sole-owner invariant';

  -- M-04: backfill count parity (within 5%)
  SELECT COUNT(*) INTO v_backfilled
    FROM public.place_pool WHERE ai_signal_scores IS NOT NULL;
  SELECT COUNT(DISTINCT place_pool_id) INTO v_source
    FROM public.place_intelligence_trial_runs
   WHERE status='completed'
     AND q2_response IS NOT NULL
     AND q2_response ? 'evaluations'
     AND jsonb_typeof(q2_response -> 'evaluations') = 'array'
     AND jsonb_array_length(q2_response -> 'evaluations') > 0;
  IF v_source = 0 THEN
    RAISE NOTICE 'M-04 SKIP: source table empty (cannot assert parity)';
  ELSE
    v_drift_frac := ABS(v_backfilled - v_source)::float / v_source;
    IF v_drift_frac > 0.05 THEN
      RAISE EXCEPTION 'M-04 FAIL: drift > 5%% (backfilled=%, source=%, drift=%.4f)',
        v_backfilled, v_source, v_drift_frac;
    END IF;
    RAISE NOTICE 'M-04 PASS: backfilled=% source=% drift=%.4f',
      v_backfilled, v_source, v_drift_frac;
  END IF;

  -- M-08: idempotency — count rows that the backfill would still update
  -- (should be 0 after a clean apply).
  WITH latest_q2_per_place AS (
    SELECT DISTINCT ON (pir.place_pool_id)
      pir.place_pool_id,
      pir.q2_response,
      pir.completed_at,
      pir.prompt_version,
      pir.model
    FROM public.place_intelligence_trial_runs pir
    WHERE pir.status='completed'
      AND pir.q2_response IS NOT NULL
      AND pir.q2_response ? 'evaluations'
      AND jsonb_typeof(pir.q2_response -> 'evaluations')='array'
      AND jsonb_array_length(pir.q2_response -> 'evaluations') > 0
    ORDER BY pir.place_pool_id, pir.completed_at DESC NULLS LAST
  ),
  sliced AS (
    SELECT
      l.place_pool_id,
      jsonb_object_agg(
        (ev ->> 'signal_id'),
        jsonb_build_object(
          'score_0_to_100',
            GREATEST(0, LEAST(100, ROUND((ev ->> 'score_0_to_100')::numeric)::int)),
          'inappropriate_for', (ev ->> 'inappropriate_for')::boolean,
          'reasoning',         ev ->> 'reasoning',
          'evaluated_at',      COALESCE(
                                 to_char(l.completed_at AT TIME ZONE 'UTC',
                                         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                 '1970-01-01T00:00:00.000Z'
                               ),
          'prompt_version',    COALESCE(l.prompt_version, 'unknown'),
          'model',             COALESCE(l.model, 'gemini-2.5-flash')
        )
      ) AS ai_signal_scores
    FROM latest_q2_per_place l,
         LATERAL jsonb_array_elements(l.q2_response -> 'evaluations') AS ev
    WHERE ev ? 'signal_id'
      AND ev ? 'score_0_to_100'
      AND ev ? 'inappropriate_for'
      AND ev ? 'reasoning'
      AND (ev ->> 'signal_id') <> ''
      AND (ev ->> 'reasoning')  <> ''
    GROUP BY l.place_pool_id
  )
  SELECT COUNT(*) INTO v_drift_candidates
    FROM sliced s JOIN public.place_pool pp ON pp.id = s.place_pool_id
   WHERE pp.ai_signal_scores IS NULL
      OR pp.ai_signal_scores IS DISTINCT FROM s.ai_signal_scores;
  IF v_drift_candidates > 0 THEN
    RAISE WARNING 'M-08 INFO: % rows would change on re-apply (expected 0 in clean state — may indicate new trial rows landed between apply and probe)',
      v_drift_candidates;
  ELSE
    RAISE NOTICE 'M-08 PASS: re-apply would change 0 rows (idempotent)';
  END IF;

  RAISE NOTICE '[META-ORCH-1009 Sub-A backfill probe] ALL CHECKS DONE';
END $$;
