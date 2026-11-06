-- Issue #4276: after the full replay, the quarterly all-cities scoring sweep is not
-- scheduled, the worker it called is kept for when the hold is lifted, and the
-- 15-minute rescore sweep by place id is still scheduled.
--
-- MINGLA-INVARIANT: I-4276-NO-CITY-WIDE-SCORING-WHILE-HELD | issue #4276 | No cron job asks run-signal-scorer for city-wide scoring while older results are held, and the scorer refuses it for every caller
--
-- FAILS-ON-REVERT: without 20280415004276_issue_4276_pause_quarterly_all_cities_scoring.sql
-- the replay leaves the job scheduled and Q-GONE fails.
--
-- Run from the repository root as supabase_admin. Read only.

\set ON_ERROR_STOP on
begin;

do $$
begin
  -- Q-GONE
  if exists (select 1 from cron.job where jobname = 'meta_orch_1009_sub_d_quarterly_all_cities_sweep') then
    raise exception 'Q-GONE: the quarterly all-cities scoring sweep is still scheduled';
  end if;
  -- Q-NO-OTHER: no other job asks the scorer for every city.
  if exists (select 1 from cron.job where command ilike '%quarterly_sweep%' or command ilike '%all_cities%') then
    raise exception 'Q-NO-OTHER: a cron job still schedules city-wide scoring';
  end if;
  -- Q-KEPT: the worker stays, so the job can come back when the hold is lifted.
  if to_regprocedure('public.tg_meta_orch_1009_sub_d_quarterly_sweep()') is null then
    raise exception 'Q-KEPT: the quarterly sweep worker was dropped';
  end if;
  -- Q-RESCORE: scoring by place id is untouched.
  if not exists (select 1 from cron.job where jobname = 'meta_orch_1009_sub_d_ai_score_rescore_sweep') then
    raise exception 'Q-RESCORE: the 15-minute rescore sweep is gone';
  end if;
end $$;

select 'issue_4276_quarterly_scoring_paused: all checks passed' as result;
rollback;
