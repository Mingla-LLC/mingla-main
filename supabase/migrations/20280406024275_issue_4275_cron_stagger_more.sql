-- ---------------------------------------------------------------------------
-- Issue #4275 Part D2 — spread the every-5 and every-15 minute jobs.
--
-- pg_cron starts jobs by the minute and the cap is 32 running jobs. Read from
-- production cron.job: 37 starts at :15 (connections ran out at 00:15, with no
-- `*/10` job in that minute) and 51 at :00. Moving the `*/10` jobs (20280406014275)
-- did not touch those. This spreads the 12 `*/5` jobs across offsets 0-4 and the 10
-- `*/15` jobs across offsets 0, 3, 6, 9 and 12.
--
-- CADENCE IS UNCHANGED. Each job still runs every 5 or every 15 minutes; only its
-- phase moves, so the one effect is a single longer gap at the switch: at most 4
-- extra minutes for a `*/5` job, 12 for a `*/15` job.
--
-- The time-critical jobs do not move at all. They stay on offset 0:
--   issue_1221_source_refund_backstop, issue_2168_checkout_revocation_sweep,
--   orch_1187_reconcile_stuck_checkouts.
--   meta_orch_1009_sub_d_ai_score_rescore_sweep also stays, as the second `*/15`
--   job on offset 0.
-- orch_1161_notify_reminders moves by 1 minute: its fixed -7/+3 minute window is
-- 10 minutes wide, so the 6-minute gap at the switch still covers every reminder.
-- Payout sweeps are `*/30` and are not touched here.
--
-- issue_3720_product_avengers_reconcile and issue_3872_discount_maintenance are
-- not scheduled by a clean replay, so a replay takes the notice for them; the SQL
-- suite seeds them.
--
-- Static on purpose (RLS gate C7 refuses dynamic SQL): by job name, a notice when a
-- job is missing, commands unchanged.
-- ---------------------------------------------------------------------------

BEGIN;

DO $issue_4275_stagger_more$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'orch_1161_notify_reminders';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: orch_1161_notify_reminders not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '1,6,11,16,21,26,31,36,41,46,51,56 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'orch_0788_notification_retry_sweeper';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: orch_0788_notification_retry_sweeper not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '1,6,11,16,21,26,31,36,41,46,51,56 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'keep-functions-warm';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: keep-functions-warm not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '1,6,11,16,21,26,31,36,41,46,51,56 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'issue_1389_stay_reservation_sweep';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: issue_1389_stay_reservation_sweep not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '2,7,12,17,22,27,32,37,42,47,52,57 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'issue_4111_enquiry_guest_digest';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: issue_4111_enquiry_guest_digest not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '2,7,12,17,22,27,32,37,42,47,52,57 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'issue_1221_admin_refund_snapshot_cleanup';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: issue_1221_admin_refund_snapshot_cleanup not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '3,8,13,18,23,28,33,38,43,48,53,58 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'issue_1221_attention_cleanup';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: issue_1221_attention_cleanup not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '3,8,13,18,23,28,33,38,43,48,53,58 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'issue_1221_guest_token_scrub';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: issue_1221_guest_token_scrub not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '3,8,13,18,23,28,33,38,43,48,53,58 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'issue_2290_brand_person_ingest_worker';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: issue_2290_brand_person_ingest_worker not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '4,9,14,19,24,29,34,39,44,49,54,59 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'issue_3720_product_avengers_reconcile';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: issue_3720_product_avengers_reconcile not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '4,9,14,19,24,29,34,39,44,49,54,59 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'issue_3872_discount_maintenance';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: issue_3872_discount_maintenance not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '3,18,33,48 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'issue_2218_sms_delivery_reconcile';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: issue_2218_sms_delivery_reconcile not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '3,18,33,48 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'issue_3988_support_overdue_sweep';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: issue_3988_support_overdue_sweep not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '6,21,36,51 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'issue_4111_enquiry_nudge';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: issue_4111_enquiry_nudge not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '6,21,36,51 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'issue_2491_counter_shadow_observer';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: issue_2491_counter_shadow_observer not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '9,24,39,54 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'meta_orch_1009_sub_e_expire_agent_pending_actions';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: meta_orch_1009_sub_e_expire_agent_pending_actions not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '9,24,39,54 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'issue_2725_competitor_intel_worker';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: issue_2725_competitor_intel_worker not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '12,27,42,57 * * * *');
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'orch_1203_rsvp_qr_backfill';
  IF v_jobid IS NULL THEN
    RAISE NOTICE 'issue_4275: orch_1203_rsvp_qr_backfill not found; nothing to reschedule';
  ELSE
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '12,27,42,57 * * * *');
  END IF;
END;
$issue_4275_stagger_more$;

COMMIT;
