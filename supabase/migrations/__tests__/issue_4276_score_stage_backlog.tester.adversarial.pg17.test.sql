-- Issue #4276 tester adversarial: the final-score stage must never hand the scorer a
-- place whose only AI result predates the 2026-11-05 backlog hold.
--
-- Angle the implementor tests do not take: an Intelligence trial row that ended
-- 'completed' while place_pool.ai_signal_scores was NOT rewritten (the slice write is
-- non-fatal in run-place-intelligence-trial: an empty or malformed Gemini evaluation,
-- or a failed update, still completes the row). city_pipeline_places_to_score selects
-- by trial status alone, so the place goes to run-signal-scorer with include_held and
-- its 2026-09 slice is blended into a live score.
--
-- Expected today (defect present): this file RAISES. It passes once the selector (or
-- the scorer) refuses AI slices evaluated before the hold date, or before the run.
-- Runs in a rolled-back transaction on a replayed database, as supabase_admin.
BEGIN;

DO $$
DECLARE
  v_city uuid := '42768000-0000-4000-a000-000000000001';
  v_admin uuid := '42768000-0000-4000-e000-000000000001';
  v_run uuid := '42768000-0000-4000-c000-000000000001';
  v_intel uuid := '42768000-0000-4000-d000-000000000001';
  v_place uuid := '42768000-0000-4000-b000-000000000001';
  v_ids uuid[];
BEGIN
  INSERT INTO public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng,
    coverage_radius_km, status, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng)
  VALUES (v_city, 'tester-4276-city', 'Tester Leak City', 'Testland', 'TL', 30, 30, 5, 'seeded', 29.99, 29.99, 30.01, 30.01);

  INSERT INTO public.admin_users (id, email, role, status) VALUES (v_admin, 'tester-4276-leak@local.test', 'admin', 'active');

  -- A live place whose AI result is from the held backlog.
  INSERT INTO public.place_pool (id, google_place_id, name, lat, lng, city_id, is_active, is_servable,
    rating, review_count, types, primary_type, ai_signal_scores)
  VALUES (v_place, 'tester-4276-leak', 'Backlog bar', 30, 30, v_city, true, true, 4.5, 300, ARRAY['bar'], 'bar',
    jsonb_build_object('drinks', jsonb_build_object('score_0_to_100', 99, 'inappropriate_for', false,
      'reasoning', 'held', 'evaluated_at', '2026-09-01T00:00:00Z', 'prompt_version', 'v4', 'model', 'gemini-3.6-flash')));

  INSERT INTO public.place_intelligence_runs (id, city_id, city_name, mode, total_count, estimated_cost_usd,
    estimated_minutes, prompt_version, model, status)
  VALUES (v_intel, v_city, 'Tester Leak City', 'remainder', 1, 0.01, 1, 'v4', 'gemini-3.6-flash', 'complete');

  -- The trial row completed, but the slice write did not land.
  INSERT INTO public.place_intelligence_trial_runs (run_id, parent_run_id, place_pool_id, city_id, input_payload,
    status, prompt_version, model, retry_count)
  VALUES (v_intel, v_intel, v_place, v_city, '{}'::jsonb, 'completed', 'v4', 'gemini-3.6-flash', 0);

  INSERT INTO public.city_pipeline_runs (id, city_id, spend_limit_usd, started_by, status)
  VALUES (v_run, v_city, 10, v_admin, 'running');
  INSERT INTO public.city_pipeline_stages (run_id, stage, ord, status, refs)
  VALUES (v_run, 'intelligence', 8, 'complete', jsonb_build_object('intel_run_ids', jsonb_build_array(v_intel::text)));

  -- Control: the 15-minute sweep holds it.
  IF EXISTS (SELECT 1 FROM public.pg_meta_orch_1009_sub_d_select_stale_pairs(100000) WHERE place_id = v_place) THEN
    RAISE EXCEPTION 'control failed: the rescore selector offered a pre-hold AI result';
  END IF;

  v_ids := public.city_pipeline_places_to_score(v_run, NULL, 10000);
  IF v_place = ANY (v_ids) THEN
    RAISE EXCEPTION 'DEFECT: city_pipeline_places_to_score hands the scorer a place whose only AI result (2026-09-01) predates the backlog hold';
  END IF;
  RAISE NOTICE 'issue 4276 score-stage backlog: held';
END $$;

ROLLBACK;
