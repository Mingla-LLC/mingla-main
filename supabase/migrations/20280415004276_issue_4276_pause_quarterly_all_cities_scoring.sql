-- Issue #4276: pause the quarterly all-cities scoring sweep while older Intelligence
-- results are held back from live decks.
--
-- meta_orch_1009_sub_d_quarterly_all_cities_sweep (0 4 1 */3 *, from
-- 20260808000000_meta_orch_1009_sub_d_refresh_cron.sql) posts run-signal-scorer with
-- all_cities=true for every active signal. A whole-city score blends in every stored
-- Intelligence result, including the backlog Seth decided to keep held (2026-11-05), so
-- its first run (2027-01-01) would release it. run-signal-scorer now refuses city-wide
-- scoring for every caller; this removes the one scheduled caller. Scoring by place id
-- (the 15-minute rescore sweep, the city pipeline, venue claim approval) is unchanged.
--
-- THIS COMES BACK when the backlog hold is lifted (#4276): reschedule the job with the
-- same name and schedule, and lift the refusal in run-signal-scorer in the same change.
-- The worker function public.tg_meta_orch_1009_sub_d_quarterly_sweep() is kept for that.
--
-- Idempotent: nothing happens if the job is already gone.
--
-- MINGLA-INVARIANT: I-4276-NO-CITY-WIDE-SCORING-WHILE-HELD | issue #4276 | No cron job asks run-signal-scorer for city-wide scoring while older results are held, and the scorer refuses it for every caller

DO $unschedule$
DECLARE
  v_job_id bigint;
BEGIN
  FOR v_job_id IN
    SELECT jobid FROM cron.job WHERE jobname = 'meta_orch_1009_sub_d_quarterly_all_cities_sweep'
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
END;
$unschedule$;
