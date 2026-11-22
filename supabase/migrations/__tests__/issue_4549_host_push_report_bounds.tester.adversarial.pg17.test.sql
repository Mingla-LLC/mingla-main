-- Issue #4549 (Host push repair) -- tester retest suite for the rework of
-- 20281124004549_issue_4549_host_push_device_health.sql (report call limits
-- and the provider-delete claim) on the fully replayed PG17 schema. Angles the
-- implementor's T-BOUND / T-CLAIM blocks do not take. Everything is rolled back.
--
--   R-RATE   the 31st report in 10 minutes is refused with PT429 even when
--            every call names a new device id (no bypass), the refusal writes
--            nothing and does not consume a queued repair, the 32nd is still
--            refused, and another account is unaffected.
--   R-PRUNE  26 distinct devices reported over time keep exactly 25 records:
--            the oldest by last report goes, the newest stays; a legitimate
--            reinstall (a new device id) still reports and is kept.
--   R-REPEAT the first tester's 300-report intent, across ten rate windows:
--            one row, the queued repair handed out exactly once.
--   R-CLAIM  host_push_claim_provider_delete never allows more than 3 claims
--            whatever p_max_attempts says (99, null, negative), only for
--            refused_token rows, and is not executable by a signed-in user.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.t_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4549 tester retest FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.t_err(p_sql text)
RETURNS text LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.t_as(p_role text, p_sub text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_sub, ''), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', COALESCE(p_sub, ''), 'role', p_role)::text, true);
END;
$fn$;

BEGIN;

CREATE TEMP TABLE r4549 (k text PRIMARY KEY, v text);
GRANT ALL ON r4549 TO authenticated;

INSERT INTO auth.users(id, email) VALUES
  ('45496666-0000-4000-8000-000000000001', 'i4549-rt-a@example.test'),
  ('45496666-0000-4000-8000-000000000002', 'i4549-rt-b@example.test'),
  ('45496666-0000-4000-8000-000000000003', 'i4549-rt-c@example.test'),
  ('45496666-0000-4000-8000-000000000004', 'i4549-rt-d@example.test');

-- ---------------------------------------------------------------------------
-- R-RATE
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.t_as('authenticated', '45496666-0000-4000-8000-000000000001');
INSERT INTO r4549
SELECT 'rate_' || g, pg_temp.t_err(format(
  $q$SELECT public.report_host_push_device(%L, 'ios', NULL, 'granted', true, true, true, 'launch')$q$,
  'rate-dev-' || g))
  FROM generate_series(1, 30) g;
RESET ROLE;
SELECT pg_temp.t_ok((SELECT count(*) FROM r4549 WHERE k LIKE 'rate_%' AND v = 'ok') = 30,
  'R-RATE 30 reports inside 10 minutes are accepted');
-- Queue a repair on the newest record, then try the 31st and 32nd with new ids.
UPDATE public.host_push_devices SET repair_state = 'requested', repair_requests = 0
 WHERE user_id = '45496666-0000-4000-8000-000000000001' AND provider_subscription_id = 'rate-dev-30';
SELECT count(*) AS n INTO TEMP r4549_before FROM public.host_push_devices
 WHERE user_id = '45496666-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.t_as('authenticated', '45496666-0000-4000-8000-000000000001');
INSERT INTO r4549 VALUES
  ('rate_31', pg_temp.t_err($q$SELECT public.report_host_push_device('rate-dev-new-31', 'ios', NULL, 'granted', true, true, true, 'launch')$q$)),
  ('rate_32', pg_temp.t_err($q$SELECT public.report_host_push_device('rate-dev-30', 'android', NULL, 'denied', false, false, false, 'sign_in')$q$));
RESET ROLE;
SELECT pg_temp.t_ok((SELECT v FROM r4549 WHERE k = 'rate_31') = 'PT429',
  'R-RATE the 31st report with a brand-new device id is refused with PT429 (no bypass by device id)');
SELECT pg_temp.t_ok((SELECT v FROM r4549 WHERE k = 'rate_32') = 'PT429',
  'R-RATE the 32nd report (an existing device) is still refused');
SELECT pg_temp.t_ok(NOT EXISTS (SELECT 1 FROM public.host_push_devices WHERE provider_subscription_id = 'rate-dev-new-31'),
  'R-RATE a refused report writes no record');
SELECT pg_temp.t_ok((SELECT repair_state = 'requested' AND repair_requests = 0 AND platform = 'ios' AND device_permission = 'granted'
                       FROM public.host_push_devices
                      WHERE user_id = '45496666-0000-4000-8000-000000000001' AND provider_subscription_id = 'rate-dev-30'),
  'R-RATE a refused report neither consumes the queued repair nor overwrites the record');
SELECT pg_temp.t_ok((SELECT calls FROM public.host_push_report_rate WHERE user_id = '45496666-0000-4000-8000-000000000001') = 30,
  'R-RATE refused calls are not counted (the counter stays at 30)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.t_as('authenticated', '45496666-0000-4000-8000-000000000002');
INSERT INTO r4549 VALUES ('rate_other', pg_temp.t_err($q$SELECT public.report_host_push_device('rate-dev-b', 'ios', NULL, 'granted', true, true, true, 'launch')$q$));
SELECT pg_temp.t_ok(pg_temp.t_err($q$SELECT count(*) FROM public.host_push_report_rate$q$) = '42501',
  'R-RATE a signed-in user cannot read the rate table');
SELECT pg_temp.t_ok(pg_temp.t_err($q$UPDATE public.host_push_report_rate SET calls = 0$q$) = '42501',
  'R-RATE a signed-in user cannot reset the rate counter');
RESET ROLE;
SELECT pg_temp.t_ok((SELECT v FROM r4549 WHERE k = 'rate_other') = 'ok',
  'R-RATE the limit is per account: another account still reports');
-- After the window, the same account reports again (the queued repair is now delivered).
UPDATE public.host_push_report_rate SET window_started_at = now() - interval '10 minutes'
 WHERE user_id = '45496666-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.t_as('authenticated', '45496666-0000-4000-8000-000000000001');
INSERT INTO r4549 VALUES ('rate_next', public.report_host_push_device('rate-dev-30', 'ios', NULL, 'granted', true, true, true, 'launch')::text);
RESET ROLE;
SELECT pg_temp.t_ok((SELECT v FROM r4549 WHERE k = 'rate_next')::jsonb ->> 'action' = 'reregister',
  'R-RATE exactly at 10 minutes a new window opens and the held repair is delivered');

-- ---------------------------------------------------------------------------
-- R-PRUNE: 26 devices with distinct report times; the oldest goes.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE g integer;
BEGIN
  FOR g IN 1..26 LOOP
    PERFORM pg_temp.t_as('authenticated', '45496666-0000-4000-8000-000000000003');
    SET LOCAL ROLE authenticated;
    PERFORM public.report_host_push_device('prune-dev-' || g, 'ios', NULL, 'granted', true, true, true, 'launch');
    RESET ROLE;
    -- age every earlier record by one more hour, so prune-dev-1 is the oldest
    UPDATE public.host_push_devices SET last_reported_at = last_reported_at - interval '1 hour'
     WHERE user_id = '45496666-0000-4000-8000-000000000003';
  END LOOP;
END
$do$;
SELECT pg_temp.t_ok((SELECT count(*) FROM public.host_push_devices WHERE user_id = '45496666-0000-4000-8000-000000000003') = 25,
  'R-PRUNE 26 devices leave exactly 25 records');
SELECT pg_temp.t_ok(NOT EXISTS (SELECT 1 FROM public.host_push_devices WHERE provider_subscription_id = 'prune-dev-1'),
  'R-PRUNE the oldest record by last report is the one removed');
SELECT pg_temp.t_ok(EXISTS (SELECT 1 FROM public.host_push_devices WHERE provider_subscription_id = 'prune-dev-26')
                AND EXISTS (SELECT 1 FROM public.host_push_devices WHERE provider_subscription_id = 'prune-dev-2'),
  'R-PRUNE the newest and the second-oldest stay');
-- A reinstall: a new device id on a full account still reports and is kept.
SET LOCAL ROLE authenticated;
SELECT pg_temp.t_as('authenticated', '45496666-0000-4000-8000-000000000003');
INSERT INTO r4549 VALUES ('reinstall', public.report_host_push_device('prune-dev-reinstall', 'ios', 'b2', 'granted', true, true, true, 'launch')::text);
RESET ROLE;
SELECT pg_temp.t_ok((SELECT v FROM r4549 WHERE k = 'reinstall')::jsonb ->> 'action' = 'none'
                AND EXISTS (SELECT 1 FROM public.host_push_devices WHERE provider_subscription_id = 'prune-dev-reinstall')
                AND NOT EXISTS (SELECT 1 FROM public.host_push_devices WHERE provider_subscription_id = 'prune-dev-2')
                AND (SELECT count(*) FROM public.host_push_devices WHERE user_id = '45496666-0000-4000-8000-000000000003') = 25,
  'R-PRUNE a reinstall on a full account is kept and the next-oldest goes');

-- ---------------------------------------------------------------------------
-- R-REPEAT: 300 reports of one device over ten windows; one repair handed out.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.t_as('authenticated', '45496666-0000-4000-8000-000000000004');
SELECT public.report_host_push_device('repeat-dev', 'ios', NULL, 'granted', true, true, true, 'launch');
RESET ROLE;
UPDATE public.host_push_devices SET repair_state = 'requested', repair_requests = 1 WHERE provider_subscription_id = 'repeat-dev';
DO $do$
DECLARE w integer; g integer; r jsonb;
BEGIN
  FOR w IN 1..10 LOOP
    UPDATE public.host_push_report_rate SET window_started_at = now() - interval '11 minutes'
     WHERE user_id = '45496666-0000-4000-8000-000000000004';
    FOR g IN 1..30 LOOP
      PERFORM pg_temp.t_as('authenticated', '45496666-0000-4000-8000-000000000004');
      SET LOCAL ROLE authenticated;
      r := public.report_host_push_device('repeat-dev', 'ios', NULL, 'granted', true, true, true, 'foreground');
      RESET ROLE;
      INSERT INTO r4549 VALUES (format('rep_%s_%s', w, g), r::text);
    END LOOP;
  END LOOP;
END
$do$;
SELECT pg_temp.t_ok((SELECT count(*) FROM r4549 WHERE k LIKE 'rep\_%') = 300,
  'R-REPEAT 300 reports across ten windows were all accepted');
SELECT pg_temp.t_ok((SELECT count(*) FROM r4549 WHERE k LIKE 'rep\_%' AND v::jsonb ->> 'action' = 'reregister') = 1
                AND (SELECT v FROM r4549 WHERE k = 'rep_1_1')::jsonb ->> 'action' = 'reregister',
  'R-REPEAT the queued repair is handed out exactly once, on the first report');
SELECT pg_temp.t_ok((SELECT count(*) FROM public.host_push_devices WHERE user_id = '45496666-0000-4000-8000-000000000004') = 1
                AND (SELECT repair_requests FROM public.host_push_devices WHERE provider_subscription_id = 'repeat-dev') = 2,
  'R-REPEAT one row, counted once (1 -> 2)');

-- ---------------------------------------------------------------------------
-- R-CLAIM
-- ---------------------------------------------------------------------------
UPDATE public.host_push_devices SET provider_state = 'refused_token', repair_state = 'none', provider_delete_attempts = 0
 WHERE provider_subscription_id = 'repeat-dev';
DO $do$
DECLARE i integer; won integer := 0; id_ uuid;
BEGIN
  SELECT id INTO id_ FROM public.host_push_devices WHERE provider_subscription_id = 'repeat-dev';
  FOR i IN 1..10 LOOP
    IF public.host_push_claim_provider_delete(id_, 99) THEN won := won + 1; END IF;
    -- release exactly as host-push-reconcile does after a failed delete
    UPDATE public.host_push_devices SET repair_state = 'none', provider_deleted_at = NULL
     WHERE id = id_ AND repair_state = 'provider_deleted';
  END LOOP;
  INSERT INTO r4549 VALUES ('claims_99', won::text);
END
$do$;
SELECT pg_temp.t_ok((SELECT v FROM r4549 WHERE k = 'claims_99') = '3',
  'R-CLAIM ten claim-and-release cycles with p_max_attempts = 99 win exactly 3');
SELECT pg_temp.t_ok(
  (SELECT NOT public.host_push_claim_provider_delete(d.id, NULL) AND NOT public.host_push_claim_provider_delete(d.id, -5)
     FROM public.host_push_devices d WHERE d.provider_subscription_id = 'rate-dev-1'),
  'R-CLAIM a null or negative maximum allows no claim');
SELECT pg_temp.t_ok(
  (SELECT NOT public.host_push_claim_provider_delete(d.id, 3)
     FROM public.host_push_devices d WHERE d.provider_subscription_id = 'prune-dev-26'),
  'R-CLAIM a record that is not refused_token cannot be claimed');
SET LOCAL ROLE authenticated;
SELECT pg_temp.t_as('authenticated', '45496666-0000-4000-8000-000000000004');
SELECT pg_temp.t_ok(pg_temp.t_err($q$SELECT public.host_push_claim_provider_delete(gen_random_uuid(), 3)$q$) = '42501',
  'R-CLAIM a signed-in user cannot call the claim');
RESET ROLE;

ROLLBACK;
