-- Issue #4276: implementor proof for 20280418004276_issue_4276_mv_refresh_slot_from_cron.sql.
--
-- MINGLA-INVARIANT: I-4276-MV-REFRESH-SLOT-FROM-CRON | issue #4276 | The place list refresh's slot is read from its cron schedule; a schedule that cannot be read gives no slot, never a guessed one
--
--   S-30     '*/30 * * * *' gives 1800 seconds
--   S-10     '*/10 * * * *' gives 600 seconds
--   S-NONE   any other schedule ('0 * * * *', '30 seconds', '*/90 * * * *'), or no job,
--            gives null
--
-- FAILS-ON-REVERT: restore the fixed 600 and S-30 and S-NONE fail.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

do $$
declare
  v_sched text;
  v_slot jsonb;
begin
  delete from cron.job where jobname = 'refresh_admin_place_pool_mv';
  if (public.city_pipeline_mv_refresh_health() -> 'interval_seconds') is distinct from 'null'::jsonb then
    raise exception 'S-NONE: no job gave slot %', public.city_pipeline_mv_refresh_health() -> 'interval_seconds';
  end if;

  perform cron.schedule('refresh_admin_place_pool_mv', '*/30 * * * *', 'select 1');
  update cron.job set active = false where jobname = 'refresh_admin_place_pool_mv';
  if (public.city_pipeline_mv_refresh_health() ->> 'interval_seconds') is distinct from '1800' then
    raise exception 'S-30: got %', public.city_pipeline_mv_refresh_health() -> 'interval_seconds';
  end if;

  update cron.job set schedule = '*/10 * * * *' where jobname = 'refresh_admin_place_pool_mv';
  if (public.city_pipeline_mv_refresh_health() ->> 'interval_seconds') is distinct from '600' then
    raise exception 'S-10: got %', public.city_pipeline_mv_refresh_health() -> 'interval_seconds';
  end if;

  foreach v_sched in array array['0 * * * *', '30 seconds', '*/90 * * * *', '*/0 * * * *', '*/15 1 * * *'] loop
    update cron.job set schedule = v_sched where jobname = 'refresh_admin_place_pool_mv';
    v_slot := public.city_pipeline_mv_refresh_health() -> 'interval_seconds';
    if v_slot is distinct from 'null'::jsonb then
      raise exception 'S-NONE: schedule % gave slot %', v_sched, v_slot;
    end if;
  end loop;
end $$;

select 'issue_4276_mv_refresh_slot: all checks passed' as result;
rollback;
