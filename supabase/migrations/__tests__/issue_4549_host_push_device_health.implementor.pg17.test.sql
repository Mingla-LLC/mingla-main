-- MINGLA-INVARIANT: I-4549-HOST-PUSH-DEVICES-RPC-ONLY | issue #4549 | anon and authenticated can neither read nor write host_push_devices or host_push_reconcile_state; the Host app reaches its own row only through report_host_push_device, which needs a signed-in caller and hands a queued repair back at most once (T-RLS, T-RPC, T-ONCE here).
--
-- Issue #4549 (Host push repair, build step 1) -- implementor suite for
-- 20281124004549_issue_4549_host_push_device_health.sql on the fully replayed
-- PG17 schema. Everything is rolled back.
--
--   T-RLS     anon and authenticated: no select, insert, update or delete on
--             host_push_devices and host_push_reconcile_state; no execute on
--             the reconciler and channel-completion functions.
--   T-RPC     report_host_push_device: null caller refused (PT401); every
--             enum and the subscription id validated (22023); upserts the
--             caller's own row only; the same subscription under a second
--             account is a second row; another account's row never changes.
--   T-ONCE    a queued repair ('requested') answers 'reregister' exactly once
--             and is counted; the next report answers 'none'.
--   T-CAND    host_push_reconcile_candidates: Host pushes in 48 h or a report
--             in 7 days; a consumer-only account is not picked; capped at 40.
--   T-SENT    issue_3720_complete_notification_channel: a sent push sets
--             notifications.push_sent/push_sent_at; a sent email, a failed
--             push and a non-queued row do not.
--   T-CRON    one job, every 30 minutes, calling host-push-reconcile.
--   T-BOUND   (#4549 rework P2-4) 30 reports per account per 10 minutes, then
--             PT429; at most 25 records per account, oldest pruned, never the
--             one just written; the rate table is service role only.
--   T-CLAIM   (#4549 rework P3-4) a provider delete claim happens once at a
--             time, only for refused_token, at most 3 attempts ever.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4549 host push device health FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.err(p_sql text)
RETURNS text LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ':' || SQLERRM;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.as_user(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN json_build_object('role', 'anon')::text
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
END;
$fn$;

BEGIN;

CREATE TEMP TABLE i4549 (k text PRIMARY KEY, v text);
GRANT ALL ON i4549 TO authenticated, anon, service_role;

DO $fixture$
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    ('45490000-0000-4000-8000-000000000001', 'i4549-host-a@example.test'),
    ('45490000-0000-4000-8000-000000000002', 'i4549-host-b@example.test'),
    ('45490000-0000-4000-8000-000000000003', 'i4549-consumer@example.test');

  -- Host push for A in the last 48 h; consumer push for C only.
  INSERT INTO public.notifications (id, user_id, type, title, body) VALUES
    ('45490000-0000-4000-8000-000000000101', '45490000-0000-4000-8000-000000000001',
     'business.order.paid', 'Sale', 'A sale'),
    ('45490000-0000-4000-8000-000000000102', '45490000-0000-4000-8000-000000000001',
     'business.order.paid', 'Sale', 'Email only'),
    ('45490000-0000-4000-8000-000000000103', '45490000-0000-4000-8000-000000000001',
     'business.order.paid', 'Sale', 'Refused push'),
    ('45490000-0000-4000-8000-000000000104', '45490000-0000-4000-8000-000000000003',
     'social.friend_request', 'Hi', 'Consumer push');
  INSERT INTO public.notification_deliveries (id, notification_id, channel, status) VALUES
    ('45490000-0000-4000-8000-000000000201', '45490000-0000-4000-8000-000000000101', 'push', 'queued'),
    ('45490000-0000-4000-8000-000000000202', '45490000-0000-4000-8000-000000000102', 'email', 'queued'),
    ('45490000-0000-4000-8000-000000000203', '45490000-0000-4000-8000-000000000103', 'push', 'queued'),
    ('45490000-0000-4000-8000-000000000204', '45490000-0000-4000-8000-000000000104', 'push', 'sent');
END;
$fixture$;

-- ---------------------------------------------------------------------------
-- T-RLS (authenticated)
-- ---------------------------------------------------------------------------
SELECT pg_temp.as_user('45490000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $rls_auth$
BEGIN
  PERFORM pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.host_push_devices') LIKE '42501:%',
    'T-RLS authenticated cannot select host_push_devices');
  PERFORM pg_temp.ok(pg_temp.err($q$INSERT INTO public.host_push_devices
      (user_id, provider_subscription_id, platform, last_reported_at)
      VALUES (auth.uid(), 'x', 'ios', now())$q$) LIKE '42501:%',
    'T-RLS authenticated cannot insert host_push_devices');
  PERFORM pg_temp.ok(pg_temp.err($q$UPDATE public.host_push_devices SET repair_state = 'requested'$q$) LIKE '42501:%',
    'T-RLS authenticated cannot update host_push_devices');
  PERFORM pg_temp.ok(pg_temp.err('DELETE FROM public.host_push_devices') LIKE '42501:%',
    'T-RLS authenticated cannot delete host_push_devices');
  PERFORM pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.host_push_reconcile_state') LIKE '42501:%',
    'T-RLS authenticated cannot read host_push_reconcile_state');
  PERFORM pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.host_push_reconcile_candidates(40)') LIKE '42501:%',
    'T-RLS authenticated cannot run host_push_reconcile_candidates');
  PERFORM pg_temp.ok(pg_temp.err($q$SELECT public.issue_3720_complete_notification_channel(
      '45490000-0000-4000-8000-000000000201'::uuid, 'sent')$q$) LIKE '42501:%',
    'T-RLS authenticated cannot complete a delivery');
END;
$rls_auth$;
RESET ROLE;

-- T-RLS (anon)
SELECT pg_temp.as_user(NULL);
SET LOCAL ROLE anon;
DO $rls_anon$
BEGIN
  PERFORM pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.host_push_devices') LIKE '42501:%',
    'T-RLS anon cannot select host_push_devices');
  PERFORM pg_temp.ok(pg_temp.err($q$SELECT public.report_host_push_device(
      'sub-anon', 'ios', '42', 'granted', true, true, true, 'launch')$q$) LIKE '42501:%',
    'T-RLS anon cannot execute report_host_push_device');
END;
$rls_anon$;
RESET ROLE;

DO $rls_state$
BEGIN
  PERFORM pg_temp.ok(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.host_push_devices'::regclass)
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.host_push_reconcile_state'::regclass),
    'T-RLS row level security is on for both tables');
  PERFORM pg_temp.ok(NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename IN ('host_push_devices', 'host_push_reconcile_state')),
    'T-RLS no client policy exists on either table');
END;
$rls_state$;

-- ---------------------------------------------------------------------------
-- T-RPC
-- ---------------------------------------------------------------------------
-- A signed-in role with no subject (auth.uid() is null) is refused.
SELECT pg_temp.as_user(NULL);
SET LOCAL ROLE authenticated;
DO $rpc_null$
BEGIN
  PERFORM pg_temp.ok(pg_temp.err($q$SELECT public.report_host_push_device(
      'sub-a-1', 'ios', '42', 'granted', true, true, true, 'launch')$q$) LIKE 'PT401:%',
    'T-RPC null caller is refused with PT401');
END;
$rpc_null$;
RESET ROLE;

SELECT pg_temp.as_user('45490000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $rpc_a$
DECLARE
  v jsonb;
BEGIN
  PERFORM pg_temp.ok(pg_temp.err($q$SELECT public.report_host_push_device(
      'sub-a-1', 'web', '42', 'granted', true, true, true, 'launch')$q$) LIKE '22023:%invalid_platform%',
    'T-RPC invalid platform refused');
  PERFORM pg_temp.ok(pg_temp.err($q$SELECT public.report_host_push_device(
      'sub-a-1', 'ios', '42', 'maybe', true, true, true, 'launch')$q$) LIKE '22023:%invalid_permission%',
    'T-RPC invalid permission refused');
  PERFORM pg_temp.ok(pg_temp.err($q$SELECT public.report_host_push_device(
      'sub-a-1', 'ios', '42', 'granted', true, true, true, 'boot')$q$) LIKE '22023:%invalid_reason%',
    'T-RPC invalid reason refused');
  PERFORM pg_temp.ok(pg_temp.err($q$SELECT public.report_host_push_device(
      NULL, 'ios', '42', 'granted', true, true, true, 'launch')$q$) LIKE '22023:%invalid_subscription_id%',
    'T-RPC missing subscription id refused');
  PERFORM pg_temp.ok(pg_temp.err($q$SELECT public.report_host_push_device(
      'sub a; drop', 'ios', '42', 'granted', true, true, true, 'launch')$q$) LIKE '22023:%invalid_subscription_id%',
    'T-RPC malformed subscription id refused');

  v := public.report_host_push_device('sub-a-1', 'ios', '42', 'granted', false, true, true, 'launch');
  PERFORM pg_temp.ok(v = '{"action":"none"}'::jsonb, 'T-RPC first report answers none');
  v := public.report_host_push_device('sub-shared', 'android', '42', 'not_determined', false, false, true, 'sign_in');
  PERFORM pg_temp.ok(v = '{"action":"none"}'::jsonb, 'T-RPC second device for A answers none');
END;
$rpc_a$;
RESET ROLE;

SELECT pg_temp.as_user('45490000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $rpc_b$
BEGIN
  -- The same provider record reported under account B (a phone that switched
  -- accounts) is B's own row.
  PERFORM public.report_host_push_device('sub-shared', 'android', '43', 'denied', false, true, true, 'sign_in');
END;
$rpc_b$;
RESET ROLE;

DO $rpc_check$
DECLARE
  v_a public.host_push_devices%ROWTYPE;
BEGIN
  SELECT * INTO v_a FROM public.host_push_devices
   WHERE user_id = '45490000-0000-4000-8000-000000000001' AND provider_subscription_id = 'sub-a-1';
  PERFORM pg_temp.ok(v_a.platform = 'ios' AND v_a.device_permission = 'granted'
      AND v_a.device_opted_in = false AND v_a.device_token_present AND v_a.device_linked
      AND v_a.app_build = '42' AND v_a.last_report_reason = 'launch'
      AND v_a.provider_state = 'unknown' AND v_a.repair_state = 'none',
    'T-RPC the caller''s row holds the reported fields');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.host_push_devices
      WHERE provider_subscription_id = 'sub-shared') = 2,
    'T-RPC one row per account for a shared provider record');
  PERFORM pg_temp.ok((SELECT device_permission FROM public.host_push_devices
      WHERE provider_subscription_id = 'sub-shared'
        AND user_id = '45490000-0000-4000-8000-000000000001') = 'not_determined',
    'T-RPC account B''s report never changes account A''s row');
END;
$rpc_check$;

-- Upsert path: A reports sub-a-1 again with new fields.
SELECT pg_temp.as_user('45490000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT public.report_host_push_device('sub-a-1', 'ios', '44', 'granted', true, true, true, 'foreground');
RESET ROLE;
DO $rpc_upsert$
BEGIN
  PERFORM pg_temp.ok((SELECT count(*) FROM public.host_push_devices
      WHERE provider_subscription_id = 'sub-a-1') = 1
    AND (SELECT device_opted_in AND app_build = '44' AND last_report_reason = 'foreground'
           FROM public.host_push_devices WHERE provider_subscription_id = 'sub-a-1'),
    'T-RPC a second report updates the same row');
END;
$rpc_upsert$;

-- ---------------------------------------------------------------------------
-- T-ONCE: the reconciler queues a repair (service role path).
-- ---------------------------------------------------------------------------
UPDATE public.host_push_devices
   SET provider_state = 'refused_token', repair_state = 'requested',
       repair_window_started_at = now()
 WHERE provider_subscription_id = 'sub-a-1';

SELECT pg_temp.as_user('45490000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
INSERT INTO i4549 VALUES ('once1',
  public.report_host_push_device('sub-a-1', 'ios', '44', 'granted', true, true, true, 'launch')->>'action');
INSERT INTO i4549 VALUES ('once2',
  public.report_host_push_device('sub-a-1', 'ios', '44', 'granted', true, true, true, 'foreground')->>'action');
RESET ROLE;
DO $once$
BEGIN
  PERFORM pg_temp.ok((SELECT v FROM i4549 WHERE k = 'once1') = 'reregister',
    'T-ONCE a requested repair answers reregister');
  PERFORM pg_temp.ok((SELECT v FROM i4549 WHERE k = 'once2') = 'none',
    'T-ONCE the next report answers none');
  PERFORM pg_temp.ok((SELECT repair_requests = 1 AND repair_state = 'none'
      FROM public.host_push_devices WHERE provider_subscription_id = 'sub-a-1'),
    'T-ONCE the delivered request is counted once');
  PERFORM pg_temp.ok(pg_temp.err($q$UPDATE public.host_push_devices SET repair_requests = 4
      WHERE provider_subscription_id = 'sub-a-1'$q$) LIKE '23514:%',
    'T-ONCE repair_requests can never exceed 3');
END;
$once$;

-- ---------------------------------------------------------------------------
-- T-CAND
-- ---------------------------------------------------------------------------
DO $cand$
DECLARE
  v_users uuid[];
BEGIN
  SELECT array_agg(user_id) INTO v_users FROM public.host_push_reconcile_candidates(40);
  PERFORM pg_temp.ok('45490000-0000-4000-8000-000000000001' = ANY(v_users),
    'T-CAND an account with a Host push and reports is picked');
  PERFORM pg_temp.ok('45490000-0000-4000-8000-000000000002' = ANY(v_users),
    'T-CAND an account with a recent Host app report is picked');
  PERFORM pg_temp.ok(NOT ('45490000-0000-4000-8000-000000000003' = ANY(v_users)),
    'T-CAND a consumer-only account is not picked');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.host_push_reconcile_candidates(500)) <= 40,
    'T-CAND never more than 40 per run');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.host_push_reconcile_candidates(-1)) = 0,
    'T-CAND a negative limit picks nobody');
END;
$cand$;

-- ---------------------------------------------------------------------------
-- T-SENT
-- ---------------------------------------------------------------------------
DO $sent$
BEGIN
  PERFORM pg_temp.ok(public.issue_3720_complete_notification_channel(
      '45490000-0000-4000-8000-000000000201', 'sent', 'onesignal', 'msg-1'),
    'T-SENT the push completion returns true');
  PERFORM pg_temp.ok((SELECT push_sent AND push_sent_at IS NOT NULL FROM public.notifications
      WHERE id = '45490000-0000-4000-8000-000000000101'),
    'T-SENT a sent push sets push_sent and push_sent_at');
  PERFORM public.issue_3720_complete_notification_channel(
      '45490000-0000-4000-8000-000000000202', 'sent', 'resend', 'msg-2');
  PERFORM pg_temp.ok((SELECT NOT push_sent AND push_sent_at IS NULL FROM public.notifications
      WHERE id = '45490000-0000-4000-8000-000000000102'),
    'T-SENT a sent email leaves push_sent false');
  PERFORM public.issue_3720_complete_notification_channel(
      '45490000-0000-4000-8000-000000000203', 'failed', 'onesignal', NULL, 'provider_no_valid_subscription');
  PERFORM pg_temp.ok((SELECT NOT push_sent FROM public.notifications
      WHERE id = '45490000-0000-4000-8000-000000000103'),
    'T-SENT a failed push leaves push_sent false');
  PERFORM pg_temp.ok(NOT public.issue_3720_complete_notification_channel(
      '45490000-0000-4000-8000-000000000204', 'sent', 'onesignal', 'msg-4'),
    'T-SENT a row that is not queued is not completed again');
  PERFORM pg_temp.ok((SELECT NOT push_sent FROM public.notifications
      WHERE id = '45490000-0000-4000-8000-000000000104'),
    'T-SENT a non-queued row does not flip push_sent');
  PERFORM pg_temp.ok(pg_temp.err($q$SELECT public.issue_3720_complete_notification_channel(
      '45490000-0000-4000-8000-000000000201'::uuid, 'bogus')$q$) LIKE '22023:%',
    'T-SENT the existing status validation is kept');
END;
$sent$;

-- ---------------------------------------------------------------------------
-- T-CRON
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  PERFORM pg_temp.ok((SELECT count(*) FROM cron.job
      WHERE jobname = 'issue_4549_host_push_reconcile'
        AND schedule = '*/30 * * * *'
        AND command LIKE '%/functions/v1/host-push-reconcile%'
        AND command LIKE '%service_role_key%') = 1,
    'T-CRON one job every 30 minutes calls host-push-reconcile with the vault key');
END;
$cron$;

-- ---------------------------------------------------------------------------
-- T-BOUND (P2-4)
-- ---------------------------------------------------------------------------
DO $bound_setup$
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    ('45490000-0000-4000-8000-000000000004', 'i4549-flood@example.test');
END;
$bound_setup$;

SELECT pg_temp.as_user('45490000-0000-4000-8000-000000000004');
SET LOCAL ROLE authenticated;
DO $bound$
DECLARE
  i integer;
  v_err text;
BEGIN
  PERFORM pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.host_push_report_rate') LIKE '42501:%',
    'T-BOUND authenticated cannot read the rate table');
  FOR i IN 1..30 LOOP
    PERFORM public.report_host_push_device('flood-' || i, 'ios', '42', 'granted', true, true, true, 'foreground');
  END LOOP;
  v_err := pg_temp.err($q$SELECT public.report_host_push_device(
      'flood-31', 'ios', '42', 'granted', true, true, true, 'foreground')$q$);
  PERFORM pg_temp.ok(v_err LIKE 'PT429:%report_rate_limited%',
    'T-BOUND the 31st report inside 10 minutes is refused with PT429');
END;
$bound$;
RESET ROLE;

DO $bound_check$
BEGIN
  PERFORM pg_temp.ok((SELECT count(*) FROM public.host_push_devices
      WHERE user_id = '45490000-0000-4000-8000-000000000004') = 25,
    'T-BOUND an account keeps at most 25 records');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.host_push_devices
      WHERE user_id = '45490000-0000-4000-8000-000000000004'
        AND provider_subscription_id = 'flood-30'),
    'T-BOUND the record just written is kept');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.host_push_devices
      WHERE user_id = '45490000-0000-4000-8000-000000000004'
        AND provider_subscription_id = 'flood-31'),
    'T-BOUND the refused report wrote nothing');
  -- A new window: the counter resets.
  UPDATE public.host_push_report_rate SET window_started_at = now() - interval '11 minutes'
   WHERE user_id = '45490000-0000-4000-8000-000000000004';
END;
$bound_check$;

SELECT pg_temp.as_user('45490000-0000-4000-8000-000000000004');
SET LOCAL ROLE authenticated;
DO $bound_window$
BEGIN
  PERFORM pg_temp.ok(pg_temp.err($q$SELECT public.report_host_push_device(
      'flood-32', 'ios', '42', 'granted', true, true, true, 'foreground')$q$) = 'ok',
    'T-BOUND after the 10-minute window the account may report again');
END;
$bound_window$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- T-CLAIM (P3-4)
-- ---------------------------------------------------------------------------
DO $claim$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.host_push_devices
   WHERE user_id = '45490000-0000-4000-8000-000000000004' AND provider_subscription_id = 'flood-30';
  UPDATE public.host_push_devices SET provider_state = 'subscribed' WHERE id = v_id;
  PERFORM pg_temp.ok(NOT public.host_push_claim_provider_delete(v_id, 3),
    'T-CLAIM a subscribed record is never claimed');
  UPDATE public.host_push_devices SET provider_state = 'refused_token' WHERE id = v_id;
  PERFORM pg_temp.ok(public.host_push_claim_provider_delete(v_id, 3), 'T-CLAIM first claim wins');
  PERFORM pg_temp.ok(NOT public.host_push_claim_provider_delete(v_id, 3),
    'T-CLAIM a second claim while one is held is refused');
  -- release (what the function does after a failed call), twice more
  UPDATE public.host_push_devices SET repair_state = 'none', provider_deleted_at = NULL WHERE id = v_id;
  PERFORM pg_temp.ok(public.host_push_claim_provider_delete(v_id, 3), 'T-CLAIM retry 2 allowed');
  UPDATE public.host_push_devices SET repair_state = 'none', provider_deleted_at = NULL WHERE id = v_id;
  PERFORM pg_temp.ok(public.host_push_claim_provider_delete(v_id, 3), 'T-CLAIM retry 3 allowed');
  UPDATE public.host_push_devices SET repair_state = 'none', provider_deleted_at = NULL WHERE id = v_id;
  PERFORM pg_temp.ok(NOT public.host_push_claim_provider_delete(v_id, 99),
    'T-CLAIM never more than 3 attempts, whatever the caller asks');
  PERFORM pg_temp.ok((SELECT provider_delete_attempts FROM public.host_push_devices WHERE id = v_id) = 3,
    'T-CLAIM attempts counted');
END;
$claim$;

SELECT pg_temp.as_user('45490000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
DO $claim_priv$
BEGIN
  PERFORM pg_temp.ok(pg_temp.err($q$SELECT public.host_push_claim_provider_delete(gen_random_uuid(), 3)$q$) LIKE '42501:%',
    'T-CLAIM authenticated cannot claim a delete');
END;
$claim_priv$;
RESET ROLE;

ROLLBACK;
