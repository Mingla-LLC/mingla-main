-- #2168 — schedule the revocation worker, and the 72-hour escalation with it.
--
-- Until now `cron.job` held no entry for `checkout-sale-revocation`, so
-- CHECKOUT_REVOCATION_EXECUTE was a permission with no caller: arming it changed
-- nothing. Every sibling money-path worker is scheduled —
-- issue_1221_source_refund_backstop and issue_1221_admin_refund_snapshot_cleanup
-- at */5, issue_1179_cancel_refund_fanout_backstop at */10,
-- issue_1171_payout_release_dark_sweep at */30. A stranded provider hold on a
-- buyer's card belongs in the */5 tier.
--
-- */5 does not hammer anything: per-row pacing stays owned by
-- issue_1930_record_revocation_result's existing backoff (30s doubling to a
-- one-hour ceiling). Cron only offers opportunities; backoff decides which rows
-- are actually due. Throughput is 25 rows per invocation.
--
-- Invocation copies issue_1221_source_refund_backstop exactly: net.http_post
-- with the URL and service-role key read from the vault. No new secret, no new
-- mechanism, and it satisfies the function's own service-role auth check.

BEGIN;

SELECT cron.unschedule('issue_2168_checkout_revocation_sweep')
 WHERE EXISTS (SELECT 1 FROM cron.job
                WHERE jobname = 'issue_2168_checkout_revocation_sweep');

SELECT cron.schedule(
  'issue_2168_checkout_revocation_sweep',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets
             WHERE name = 'supabase_url' LIMIT 1)
           || '/functions/v1/checkout-sale-revocation',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (SELECT decrypted_secret
                                      FROM vault.decrypted_secrets
                                     WHERE name = 'service_role_key' LIMIT 1)),
    body := '{}'::jsonb);
  $cron$);

SELECT cron.unschedule('issue_2168_revocation_attention_escalation')
 WHERE EXISTS (SELECT 1 FROM cron.job
                WHERE jobname = 'issue_2168_revocation_attention_escalation');

-- Hourly is enough for a 72-hour deadline, and keeps the escalation independent
-- of the sweep: if the worker is disarmed or failing, the deadline still speaks.
SELECT cron.schedule(
  'issue_2168_revocation_attention_escalation',
  '0 * * * *',
  $cron$SELECT public.issue_2168_escalate_overdue_revocation_attention();$cron$);

COMMIT;
