-- ORCH-1153 [experience-reserve-checkout-integrity] — WS1 rolling-refresh cron.
--
-- Registers a daily pg_cron job that tops every published/scheduled recurring
-- experience back toward the 52-forward window (the durable F-2 fix: a
-- daily/never rule materialises 52 dates at publish and otherwise drains to zero
-- over ~52 days). Schedule 0 9 * * * (09:00 UTC) per SPEC §4. OQ-WS1-1
-- (Seth-approved) reverses the original "NO cron" decision; I-4 stays the
-- authoritative publish-time path — the cron only ADDS forward occurrences,
-- never changes the rule or the master (I-PROPOSED-1153-TOPUP-IDEMPOTENT).
--
-- Idempotent registration: unschedule any prior same-name job first so re-apply
-- never duplicates (pg_cron has no native upsert).

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'orch-1153-topup-recurring-experiences') THEN
    PERFORM cron.unschedule('orch-1153-topup-recurring-experiences');
  END IF;

  PERFORM cron.schedule(
    'orch-1153-topup-recurring-experiences',
    '0 9 * * *',
    $$ SELECT public.pg_topup_recurring_experiences(14); $$
  );
END;
$cron$;
