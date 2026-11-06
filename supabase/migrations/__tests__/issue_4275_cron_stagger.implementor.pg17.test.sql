\set ON_ERROR_STOP on

-- Issue #4275 Part D1 — the seven every-10-minute jobs each get their own minute.
--
--   T-D1  after replay every schedule is exact, commands and active flags are
--         unchanged, no job starts on a :x0 or :x5 minute, and at most one of
--         the seven starts in any minute.
--
-- refresh_admin_place_pool_mv is a production job no migration creates, so this
-- suite seeds it at its old cadence, re-runs the migration through \ir and
-- removes it again. The other six come from the replay.
--
-- FAILS-ON-REVERT: put any job back on `*/10 * * * *` in 20280406014275 and the
-- \ir below resets it, so T-D1 fails.
--
-- Invariant note: the migration is re-run outside a transaction because it has
-- its own BEGIN and COMMIT. It is idempotent.

SELECT cron.schedule('refresh_admin_place_pool_mv', '*/10 * * * *', 'SELECT public.cron_refresh_admin_place_pool_mv()');

\ir ../20280406014275_issue_4275_cron_stagger.sql

DO $t_d1$
DECLARE
  v_expected jsonb := jsonb_build_object(
    'kick_pending_thumb_backfill',              '1,11,21,31,41,51 * * * *',
    'issue_1179_cancel_refund_fanout_backstop', '2,12,22,32,42,52 * * * *',
    'refresh_admin_place_pool_mv',              '3,33 * * * *',
    'issue_3197_public_search_converged',       '4,14,24,34,44,54 * * * *',
    'crm_reconcile_live',                       '6,16,26,36,46,56 * * * *',
    'ops_reconcile',                            '7,17,27,37,47,57 * * * *',
    'issue_4073_city_watch_scan',               '8,18,28,38,48,58 * * * *'
  );
  v_commands jsonb := jsonb_build_object(
    'kick_pending_thumb_backfill',        'SELECT public.tg_kick_pending_thumb_backfill();',
    'refresh_admin_place_pool_mv',        'SELECT public.cron_refresh_admin_place_pool_mv()',
    'issue_3197_public_search_converged', 'SELECT public.issue_3197_assert_public_search_converged();',
    'crm_reconcile_live',                 'SELECT public.crm_reconcile_live()',
    'ops_reconcile',                      'SELECT public.ops_reconcile()',
    'issue_4073_city_watch_scan',         'SELECT public.issue_4073_scan_city_watches(50);'
  );
  v_name text;
  v_schedule text;
  v_command text;
  v_active boolean;
  v_minutes int[] := ARRAY[]::int[];
  v_minute int;
BEGIN
  FOR v_name IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT schedule, btrim(command, E' \n'), active INTO v_schedule, v_command, v_active
      FROM cron.job WHERE jobname = v_name;
    IF NOT FOUND THEN RAISE EXCEPTION 'T-D1 FAIL: % is not scheduled', v_name; END IF;
    IF v_schedule IS DISTINCT FROM v_expected->>v_name THEN
      RAISE EXCEPTION 'T-D1 FAIL: % has schedule %, expected %', v_name, v_schedule, v_expected->>v_name;
    END IF;
    IF NOT v_active THEN RAISE EXCEPTION 'T-D1 FAIL: % is not active', v_name; END IF;
    IF v_commands ? v_name AND v_command IS DISTINCT FROM v_commands->>v_name THEN
      RAISE EXCEPTION 'T-D1 FAIL: % command changed to %', v_name, v_command;
    END IF;
    IF v_name = 'issue_1179_cancel_refund_fanout_backstop' AND position('event-cancel-refund-fanout' IN v_command) = 0 THEN
      RAISE EXCEPTION 'T-D1 FAIL: the fan-out backstop lost its command';
    END IF;
    FOREACH v_minute IN ARRAY string_to_array(split_part(v_schedule, ' ', 1), ',')::int[] LOOP
      IF v_minute % 5 = 0 THEN RAISE EXCEPTION 'T-D1 FAIL: % starts on :%', v_name, v_minute; END IF;
      IF v_minute = ANY(v_minutes) THEN RAISE EXCEPTION 'T-D1 FAIL: two jobs share minute %', v_minute; END IF;
      v_minutes := v_minutes || v_minute;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'T-D1 PASS';
END;
$t_d1$;

SELECT cron.unschedule('refresh_admin_place_pool_mv');
