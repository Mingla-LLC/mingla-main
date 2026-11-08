-- Issue #4276 (resume resets progress): implementor proof for
-- 20280509004276_issue_4276_resume_resets_progress.sql.
--
-- MINGLA-INVARIANT: I-4276-RESUME-RESTARTS-STALL-CLOCK | issue #4276 | An Intelligence run that leaves paused for queued or running restarts its no-progress clock, so the 30-minute stall reaper can't re-pause a run it was just told to resume
--
--   T-RESUME    paused -> queued sets last_progress_at to now and last_progress_count to processed_count
--   T-REAPER    a resumed run is not paused again by place_intel_reap_stalled_runs()
--   T-OTHER     other status changes (running -> paused) leave last_progress_at alone
--
-- Fails on revert: without the trigger, T-RESUME sees the old timestamp and T-REAPER sees the run re-paused.

BEGIN;

DO $$
DECLARE
  v_run uuid := gen_random_uuid();
  v_city uuid := gen_random_uuid();
  v_old timestamptz := now() - interval '2 hours';
  v_row record;
BEGIN
  INSERT INTO public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng,
    coverage_radius_km, status, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng)
  VALUES (v_city, 'implementor-4276-resume-city', 'Resume Clock City', 'Testland', 'TL', 31, 31, 5, 'seeded', 30.99, 30.99, 31.01, 31.01);

  INSERT INTO public.place_intelligence_runs (id, city_id, city_name, mode, total_count, estimated_cost_usd,
    estimated_minutes, prompt_version, model, status, processed_count, last_progress_at, last_progress_count, paused_since)
  VALUES (v_run, v_city, 'Resume Clock City', 'remainder', 840, 7.48, 60, 'v4', 'gemini-3.6-flash', 'paused', 0, v_old, 0, now());

  UPDATE public.place_intelligence_runs SET status = 'queued', paused_since = NULL WHERE id = v_run;
  SELECT * INTO v_row FROM public.place_intelligence_runs WHERE id = v_run;
  IF v_row.last_progress_at IS NULL OR v_row.last_progress_at < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'T-RESUME: resuming did not restart the clock: %', v_row.last_progress_at;
  END IF;
  IF v_row.last_progress_count IS DISTINCT FROM v_row.processed_count THEN
    RAISE EXCEPTION 'T-RESUME: last_progress_count % <> processed_count %', v_row.last_progress_count, v_row.processed_count;
  END IF;

  UPDATE public.place_intelligence_runs SET status = 'running' WHERE id = v_run;
  PERFORM public.place_intel_reap_stalled_runs();
  SELECT * INTO v_row FROM public.place_intelligence_runs WHERE id = v_run;
  IF v_row.status <> 'running' THEN
    RAISE EXCEPTION 'T-REAPER: a just-resumed run was paused again (status %, reason %)', v_row.status, v_row.error_reason;
  END IF;

  UPDATE public.place_intelligence_runs SET last_progress_at = v_old WHERE id = v_run;
  UPDATE public.place_intelligence_runs SET status = 'paused', paused_since = now() WHERE id = v_run;
  SELECT * INTO v_row FROM public.place_intelligence_runs WHERE id = v_run;
  IF v_row.last_progress_at <> v_old THEN
    RAISE EXCEPTION 'T-OTHER: pausing changed last_progress_at to %', v_row.last_progress_at;
  END IF;

  RAISE NOTICE 'issue_4276_resume_resets_progress: all checks passed';
END
$$;

ROLLBACK;
