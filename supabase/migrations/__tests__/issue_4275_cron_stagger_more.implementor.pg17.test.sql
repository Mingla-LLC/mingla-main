\set ON_ERROR_STOP on

-- Issue #4275 Part D2 — the every-5 and every-15 minute jobs are spread out, and
-- no moved job runs less often than it did.
--
--   T-D3  after replay every moved schedule is exact, with its command and active
--         flag unchanged; the four jobs that stay on offset 0 are still `*/5` or
--         `*/15`; every job's longest gap between starts is exactly its old cadence;
--         the moved jobs start in even groups, at most 5 of them in any minute.
--
-- issue_3720_product_avengers_reconcile and issue_3872_discount_maintenance are not
-- scheduled by a clean replay, so this suite seeds them at their old cadence, re-runs
-- the migration through \ir and removes them again.
--
-- FAILS-ON-REVERT: put any job back on its old schedule in 20280406024275 and the
-- \ir below resets it, so T-D3 fails. Remove a minute from a list and the gap check
-- fails even if the literal is edited to match.

SELECT cron.schedule('issue_3720_product_avengers_reconcile', '*/5 * * * *', 'SELECT 3720');
SELECT cron.schedule('issue_3872_discount_maintenance', '*/15 * * * *', 'SELECT 3872');

CREATE TEMP TABLE t4275d_commands AS
  SELECT jobname, command FROM cron.job;

\ir ../20280406024275_issue_4275_cron_stagger_more.sql

DO $t_d3$
DECLARE
  v_expected jsonb := jsonb_build_object(
    'orch_1161_notify_reminders', '1,6,11,16,21,26,31,36,41,46,51,56 * * * *',
    'orch_0788_notification_retry_sweeper', '1,6,11,16,21,26,31,36,41,46,51,56 * * * *',
    'keep-functions-warm', '1,6,11,16,21,26,31,36,41,46,51,56 * * * *',
    'issue_1389_stay_reservation_sweep', '2,7,12,17,22,27,32,37,42,47,52,57 * * * *',
    'issue_4111_enquiry_guest_digest', '2,7,12,17,22,27,32,37,42,47,52,57 * * * *',
    'issue_1221_admin_refund_snapshot_cleanup', '3,8,13,18,23,28,33,38,43,48,53,58 * * * *',
    'issue_1221_attention_cleanup', '3,8,13,18,23,28,33,38,43,48,53,58 * * * *',
    'issue_1221_guest_token_scrub', '3,8,13,18,23,28,33,38,43,48,53,58 * * * *',
    'issue_2290_brand_person_ingest_worker', '4,9,14,19,24,29,34,39,44,49,54,59 * * * *',
    'issue_3720_product_avengers_reconcile', '4,9,14,19,24,29,34,39,44,49,54,59 * * * *',
    'issue_3872_discount_maintenance', '3,18,33,48 * * * *',
    'issue_2218_sms_delivery_reconcile', '3,18,33,48 * * * *',
    'issue_3988_support_overdue_sweep', '6,21,36,51 * * * *',
    'issue_4111_enquiry_nudge', '6,21,36,51 * * * *',
    'issue_2491_counter_shadow_observer', '9,24,39,54 * * * *',
    'meta_orch_1009_sub_e_expire_agent_pending_actions', '9,24,39,54 * * * *',
    'issue_2725_competitor_intel_worker', '12,27,42,57 * * * *',
    'orch_1203_rsvp_qr_backfill', '12,27,42,57 * * * *'
  );
  v_unmoved jsonb := jsonb_build_object(
    'issue_1221_source_refund_backstop', '*/5 * * * *',
    'issue_2168_checkout_revocation_sweep', '*/5 * * * *',
    'orch_1187_reconcile_stuck_checkouts', '*/15 * * * *',
    'meta_orch_1009_sub_d_ai_score_rescore_sweep', '*/15 * * * *'
  );
  v_name text;
  v_row record;
  v_minutes int[];
  v_gap int;
  v_cadence int;
  v_i int;
  v_at_minute int[] := array_fill(0, ARRAY[60]);
BEGIN
  FOR v_name IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT j.schedule, j.active, j.command = c.command AS same_command INTO v_row
      FROM cron.job j JOIN t4275d_commands c USING (jobname) WHERE j.jobname = v_name;
    IF NOT FOUND THEN RAISE EXCEPTION 'T-D3 FAIL: % is not scheduled', v_name; END IF;
    IF v_row.schedule IS DISTINCT FROM v_expected->>v_name THEN
      RAISE EXCEPTION 'T-D3 FAIL: % has schedule %, expected %', v_name, v_row.schedule, v_expected->>v_name;
    END IF;
    IF NOT v_row.active THEN RAISE EXCEPTION 'T-D3 FAIL: % is not active', v_name; END IF;
    IF NOT v_row.same_command THEN RAISE EXCEPTION 'T-D3 FAIL: % command changed', v_name; END IF;
    IF split_part(v_row.schedule, ' ', 2) <> '*' THEN RAISE EXCEPTION 'T-D3 FAIL: % is not hourly-repeating', v_name; END IF;

    -- The limit every one of these rests on: never a longer gap than before.
    v_minutes := string_to_array(split_part(v_row.schedule, ' ', 1), ',')::int[];
    v_cadence := 60 / array_length(v_minutes, 1);
    IF v_cadence NOT IN (5, 15) THEN RAISE EXCEPTION 'T-D3 FAIL: % runs every % minutes', v_name, v_cadence; END IF;
    FOR v_i IN 1 .. array_length(v_minutes, 1) LOOP
      v_gap := (v_minutes[(v_i % array_length(v_minutes, 1)) + 1] - v_minutes[v_i] + 60) % 60;
      IF v_gap <> v_cadence THEN
        RAISE EXCEPTION 'T-D3 FAIL: % has a % minute gap, cadence is %', v_name, v_gap, v_cadence;
      END IF;
      v_at_minute[v_minutes[v_i] + 1] := v_at_minute[v_minutes[v_i] + 1] + 1;
    END LOOP;
  END LOOP;

  FOR v_name IN SELECT jsonb_object_keys(v_unmoved) LOOP
    IF (SELECT schedule FROM cron.job WHERE jobname = v_name) IS DISTINCT FROM v_unmoved->>v_name THEN
      RAISE EXCEPTION 'T-D3 FAIL: % must stay on %', v_name, v_unmoved->>v_name;
    END IF;
  END LOOP;

  IF (SELECT max(n) FROM unnest(v_at_minute) n) > 5 THEN
    RAISE EXCEPTION 'T-D3 FAIL: % moved jobs start in one minute', (SELECT max(n) FROM unnest(v_at_minute) n);
  END IF;
  RAISE NOTICE 'T-D3 PASS';
END;
$t_d3$;

SELECT cron.unschedule('issue_3720_product_avengers_reconcile');
SELECT cron.unschedule('issue_3872_discount_maintenance');
DROP TABLE t4275d_commands;
