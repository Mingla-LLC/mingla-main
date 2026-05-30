-- META-ORCH-1009 Sub-D — post-apply read-only verification probe for
-- migration 20260808000000_meta_orch_1009_sub_d_refresh_cron.sql.
--
-- USAGE (manual; same convention as Sub-A's probe):
--   cat supabase/migrations/__tests__/sub_d_seed_idempotent.test.sql \
--     | /Users/sethogieva/bin/supabase db remote sql --linked
--
-- All checks are READ-ONLY. RAISE NOTICE on PASS, RAISE EXCEPTION on FAIL.
--
-- Coverage (per SPEC §4.1 / §4.2 / §4.4):
--   L1-01: place_scores.ai_signal_scores_at column exists, timestamptz, nullable
--   L1-03: rescore-sweep cron registered with */15 * * * * schedule
--   L2-01: drift trigger present on place_pool for the 3 columns
--   L2-02: place_intelligence_trial_runs.source column + CHECK constraint
--   L2-03: drift-reeval partial unique idx present
--   L4-01: quarterly backstop cron registered with 0 4 1 */3 * schedule
--   D-6:   seed-UPDATE is idempotent (re-running it produces zero changes)

DO $$
DECLARE
  v_type        text;
  v_nullable    text;
  v_schedule    text;
  v_trigger     int;
  v_check       int;
  v_idx         int;
  v_drift_kind  text;
  v_seed_repeat bigint;
BEGIN
  -- ─── L1-01: column exists, timestamptz, nullable ────────────────────────
  SELECT data_type, is_nullable
    INTO v_type, v_nullable
    FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name='place_scores'
     AND column_name='ai_signal_scores_at';

  IF v_type IS NULL THEN
    RAISE EXCEPTION 'L1-01 FAIL: place_scores.ai_signal_scores_at does not exist';
  END IF;
  IF v_type NOT IN ('timestamp with time zone', 'timestamptz') THEN
    RAISE EXCEPTION 'L1-01 FAIL: expected timestamptz, got %', v_type;
  END IF;
  IF v_nullable <> 'YES' THEN
    RAISE EXCEPTION 'L1-01 FAIL: expected nullable, got %', v_nullable;
  END IF;
  RAISE NOTICE 'L1-01 PASS: place_scores.ai_signal_scores_at timestamptz (nullable)';

  -- ─── L1-03: rescore-sweep cron ──────────────────────────────────────────
  SELECT schedule INTO v_schedule
    FROM cron.job
   WHERE jobname = 'meta_orch_1009_sub_d_ai_score_rescore_sweep' LIMIT 1;
  IF v_schedule IS DISTINCT FROM '*/15 * * * *' THEN
    RAISE EXCEPTION 'L1-03 FAIL: rescore-sweep cron schedule is % (expected */15 * * * *)', v_schedule;
  END IF;
  RAISE NOTICE 'L1-03 PASS: rescore-sweep cron registered at */15 * * * *';

  -- ─── L2-01: drift trigger registered on place_pool ──────────────────────
  SELECT COUNT(*) INTO v_trigger
    FROM pg_trigger
   WHERE tgname = 'tg_place_pool_drift_queue_reeval'
     AND tgrelid = 'public.place_pool'::regclass;
  IF v_trigger <> 1 THEN
    RAISE EXCEPTION 'L2-01 FAIL: drift trigger missing on place_pool (count=%)', v_trigger;
  END IF;
  RAISE NOTICE 'L2-01 PASS: drift trigger registered on place_pool';

  -- ─── L2-02: source column + CHECK constraint ────────────────────────────
  SELECT data_type, is_nullable
    INTO v_type, v_nullable
    FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name='place_intelligence_trial_runs'
     AND column_name='source';
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'L2-02 FAIL: place_intelligence_trial_runs.source does not exist';
  END IF;
  IF v_type <> 'text' THEN
    RAISE EXCEPTION 'L2-02 FAIL: expected text, got %', v_type;
  END IF;
  IF v_nullable <> 'YES' THEN
    RAISE EXCEPTION 'L2-02 FAIL: source expected nullable, got %', v_nullable;
  END IF;
  SELECT COUNT(*) INTO v_check
    FROM pg_constraint
   WHERE conname = 'pit_runs_source_chk'
     AND conrelid = 'public.place_intelligence_trial_runs'::regclass;
  IF v_check <> 1 THEN
    RAISE EXCEPTION 'L2-02 FAIL: pit_runs_source_chk CHECK constraint missing (count=%)', v_check;
  END IF;
  RAISE NOTICE 'L2-02 PASS: source column + CHECK constraint present';

  -- ─── L2-03: partial unique idx for drift dedup ──────────────────────────
  SELECT COUNT(*) INTO v_idx
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname = 'idx_pit_runs_drift_reeval_one_per_place';
  IF v_idx <> 1 THEN
    RAISE EXCEPTION 'L2-03 FAIL: partial unique idx idx_pit_runs_drift_reeval_one_per_place missing';
  END IF;
  RAISE NOTICE 'L2-03 PASS: drift-reeval partial unique idx present';

  -- ─── L4-01: quarterly backstop cron ─────────────────────────────────────
  SELECT schedule INTO v_schedule
    FROM cron.job
   WHERE jobname = 'meta_orch_1009_sub_d_quarterly_all_cities_sweep' LIMIT 1;
  IF v_schedule IS DISTINCT FROM '0 4 1 */3 *' THEN
    RAISE EXCEPTION 'L4-01 FAIL: quarterly cron schedule is % (expected 0 4 1 */3 *)', v_schedule;
  END IF;
  RAISE NOTICE 'L4-01 PASS: quarterly backstop cron registered at 0 4 1 */3 *';

  -- ─── D-6: seed-UPDATE idempotency ───────────────────────────────────────
  -- The migration's final UPDATE stamps ai_signal_scores_at for rows
  -- already up-to-date. Re-running the same WHERE predicate must return 0
  -- candidate rows (idempotent: the predicate excludes rows that already
  -- have ai_signal_scores_at set via the IS NULL guard).
  SELECT COUNT(*) INTO v_seed_repeat
    FROM public.place_scores ps
    JOIN public.place_pool pp ON pp.id = ps.place_id
   WHERE pp.ai_signal_scores IS NOT NULL
     AND pp.ai_signal_scores ? ps.signal_id
     AND ps.ai_signal_scores_at IS NULL
     AND ps.scored_at > (pp.ai_signal_scores -> ps.signal_id ->> 'evaluated_at')::timestamptz;
  IF v_seed_repeat <> 0 THEN
    RAISE EXCEPTION 'D-6 FAIL: seed-UPDATE not idempotent — % rows still match the seed predicate after migration apply', v_seed_repeat;
  END IF;
  RAISE NOTICE 'D-6 PASS: seed-UPDATE idempotent (0 candidate rows remain post-apply)';

  RAISE NOTICE '─── META-ORCH-1009 Sub-D probe: ALL CHECKS PASS ───';
END$$;
