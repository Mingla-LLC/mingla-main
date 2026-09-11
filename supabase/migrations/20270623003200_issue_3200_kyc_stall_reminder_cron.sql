-- #3200 — schedule `stripe-kyc-stall-reminder`. It has never had a caller.
--
-- WHAT WAS WRONG. The function reminds a brand's payment managers when Stripe
-- Connect onboarding has stalled with requirements due, and warns them 7, 3 and
-- 1 days before a Stripe deadline. A host stalled there cannot take money.
-- `docs/runbooks/B2_GO_LIVE_CHECKLIST.md` required
--     "Cron schedules configured: stripe-kyc-stall-reminder daily"
-- and that box was never ticked: on 2026-09-11 `cron.job` held 52 rows and none
-- invoked this function, and `function_edge_logs` showed zero invocations. It
-- was also unreachable if called — its guard required `CRON_SECRET`, which has
-- never been set, so every request was refused. Both are fixed by #3200: the
-- guard now accepts the vault service-role bearer below (see
-- `_shared/cronCallerAuth.ts`), and this migration supplies the caller.
--
-- `docs/design/948-949-EXECUTION-SPEC.md` cut a "we'll remind you" promise on
-- the grounds that this reminder "still covers anyone who DOES start onboarding
-- and stalls". Until this migration, that sentence was false.
--
-- FIRST-TICK BLAST RADIUS, measured read-only on 2026-09-11: 3 Stripe Connect
-- accounts, 2 with charges disabled, both stalled > 1 day and never reminded.
-- The first run notifies those 2 brands' payment managers once;
-- `kyc_stall_reminder_sent_at` makes the stall reminder once-per-account, and
-- each deadline warning is keyed per tier per deadline date.
--
-- WHY DAILY AT 10:15 UTC. Daily is the checklist's cadence and the function's
-- own design: it selects accounts stalled > 1 day. 10:15 UTC is late morning in
-- London and Lagos and early morning on the US east coast — a human hour in
-- every live market, and clear of the 10:00 `notify-lifecycle-daily` tick.
--
-- INVOCATION. Copies 20270423002290 (#2290) in shape: net.http_post with the
-- URL and the service-role key read from the vault. No new secret and no new
-- mechanism. One deliberate difference: `timeout_milliseconds := 60000`. The
-- function sleeps up to MAX_CRON_JITTER_MS (30s) before working, and pg_net's
-- default timeout is 5s; the 60s value is the one this repo already uses for
-- slow callees (20261112000001_orch_1161_subc_reminders_cron.sql).
--
-- IDEMPOTENT. Unschedule-if-exists then schedule, so re-applying is safe.

BEGIN;

DO $block$
BEGIN
  IF to_regnamespace('cron') IS NULL
     OR to_regnamespace('net') IS NULL
     OR to_regnamespace('vault') IS NULL THEN
    RAISE EXCEPTION 'issue_3200_kyc_reminder_dependencies_missing';
  END IF;
  -- Advisory only, never fatal, matching #2290: the job must register even on
  -- an environment whose vault is not seeded.
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url') THEN
    RAISE NOTICE 'issue-3200 advisory: vault.decrypted_secrets row "supabase_url" missing. The KYC stall reminder cron will register but its http_post calls will fail until the operator creates it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
    RAISE NOTICE 'issue-3200 advisory: vault.decrypted_secrets row "service_role_key" missing. The KYC stall reminder cron will register but its http_post calls will fail until the operator creates it.';
  END IF;
END;
$block$;

SELECT cron.unschedule('issue_3200_stripe_kyc_stall_reminder')
 WHERE EXISTS (SELECT 1 FROM cron.job
                WHERE jobname = 'issue_3200_stripe_kyc_stall_reminder');

SELECT cron.schedule(
  'issue_3200_stripe_kyc_stall_reminder',
  '15 10 * * *',
  $cron$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url' LIMIT 1)
        || '/functions/v1/stripe-kyc-stall-reminder',
      headers := jsonb_build_object(
        'authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1),
        'content-type','application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$
);

COMMIT;
