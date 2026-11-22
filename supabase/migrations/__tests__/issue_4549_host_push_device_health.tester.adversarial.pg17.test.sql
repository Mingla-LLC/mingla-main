-- Issue #4549 (Host push repair) -- tester adversarial suite for
-- 20281124004549_issue_4549_host_push_device_health.sql on the fully replayed
-- PG17 schema. Angles the implementor suite does not take. Everything is
-- rolled back.
--
--   A-PRIV   privilege matrix: no table privilege of any kind (incl. TRUNCATE,
--            REFERENCES, TRIGGER) for anon, authenticated or PUBLIC on either
--            new table; the three new or redefined functions are SECURITY
--            DEFINER with a pinned search_path, and only the report call is
--            executable by a signed-in user.
--   A-ORACLE the report call cannot be used to learn about, or touch, another
--            account's device: reporting another account's subscription id
--            answers exactly like an unknown id, never consumes that
--            account's queued repair, and never changes that account's row.
--   A-INPUT  hostile input is bounded: 128 / 129 characters, empty, spaces,
--            punctuation, non-ASCII, case and whitespace variants of enums,
--            64 / 65 character build labels, a garbage or empty caller.
--   A-REPEAT 300 repeated reports of the same device leave one row and never
--            mint a repair; a queued repair is delivered once, then 'none'.
--   A-CAND   the candidates limit is clamped for null, negative and huge
--            values; deleting the account removes its device rows.
--   A-3720   issue_3720_complete_notification_channel compared against a
--            verbatim copy of its previous body over every channel x prior
--            status x new status x provider-argument combination: identical
--            return value, identical delivery row, identical notification row
--            except push_sent / push_sent_at, which move only for a queued
--            push completed as 'sent' (and keep an earlier push_sent_at).
--   A-CRON   re-running the schedule statements keeps exactly one job.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.t_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4549 tester adversarial FAIL: %', p_label;
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

-- Verbatim previous body (20271020003720_issue_3720_notification_reliability.sql).
CREATE OR REPLACE FUNCTION pg_temp.t_prev_complete(
  p_delivery_id uuid,
  p_status text,
  p_provider text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_failed_reason text DEFAULT NULL,
  p_segments integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_delivery_id IS NULL OR p_status NOT IN (
    'queued', 'sent', 'delivered', 'undelivered', 'failed', 'suppressed', 'skipped'
  ) THEN
    RAISE EXCEPTION 'invalid_delivery_completion' USING ERRCODE = '22023';
  END IF;

  UPDATE public.notification_deliveries
  SET status = p_status,
      provider = COALESCE(p_provider, provider),
      provider_message_id = p_provider_message_id,
      failed_reason = p_failed_reason,
      segments = p_segments,
      delivered_at = CASE WHEN p_status = 'delivered' THEN now() ELSE delivered_at END,
      attempt_at = now()
  WHERE id = p_delivery_id
    AND status = 'queued';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;

BEGIN;

CREATE TEMP TABLE t4549 (k text PRIMARY KEY, v text);
GRANT ALL ON t4549 TO authenticated, anon, service_role;

INSERT INTO auth.users(id, email) VALUES
  ('45491111-0000-4000-8000-000000000001', 'i4549-adv-a@example.test'),
  ('45491111-0000-4000-8000-000000000002', 'i4549-adv-b@example.test'),
  ('45491111-0000-4000-8000-000000000003', 'i4549-adv-c@example.test');

-- ---------------------------------------------------------------------------
-- A-PRIV
-- ---------------------------------------------------------------------------
DO $priv$
DECLARE
  r record;
  p text;
BEGIN
  FOR r IN SELECT t, g FROM unnest(ARRAY['public.host_push_devices', 'public.host_push_reconcile_state']) t
                      CROSS JOIN unnest(ARRAY['anon', 'authenticated']) g
  LOOP
    FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      PERFORM pg_temp.t_ok(NOT has_table_privilege(r.g, r.t, p),
        format('A-PRIV %s has no %s on %s', r.g, p, r.t));
    END LOOP;
    PERFORM pg_temp.t_ok(NOT has_any_column_privilege(r.g, r.t, 'SELECT'),
      format('A-PRIV %s has no column-level SELECT on %s', r.g, r.t));
  END LOOP;
  PERFORM pg_temp.t_ok(NOT EXISTS (
      SELECT 1 FROM information_schema.table_privileges
       WHERE table_schema = 'public'
         AND table_name IN ('host_push_devices', 'host_push_reconcile_state')
         AND grantee = 'PUBLIC'),
    'A-PRIV PUBLIC holds no privilege on either table');
  PERFORM pg_temp.t_ok(NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename IN ('host_push_devices', 'host_push_reconcile_state')),
    'A-PRIV no RLS policy exists on either table (service role only)');
  PERFORM pg_temp.t_ok((SELECT bool_and(relrowsecurity) FROM pg_class
       WHERE oid IN ('public.host_push_devices'::regclass, 'public.host_push_reconcile_state'::regclass)),
    'A-PRIV RLS enabled on both tables');

  FOR r IN SELECT p.oid, p.proname, p.prosecdef, p.proconfig, p.proacl
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname IN ('report_host_push_device', 'host_push_reconcile_candidates',
                                'issue_3720_complete_notification_channel')
  LOOP
    PERFORM pg_temp.t_ok(r.prosecdef, format('A-PRIV %s is SECURITY DEFINER', r.proname));
    PERFORM pg_temp.t_ok(r.proconfig IS NOT NULL AND
      EXISTS (SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE 'search_path=%'),
      format('A-PRIV %s pins search_path', r.proname));
    PERFORM pg_temp.t_ok(NOT has_function_privilege('anon', r.oid, 'EXECUTE'),
      format('A-PRIV anon cannot execute %s', r.proname));
    PERFORM pg_temp.t_ok(
      has_function_privilege('authenticated', r.oid, 'EXECUTE') = (r.proname = 'report_host_push_device'),
      format('A-PRIV authenticated execute on %s only for the report call', r.proname));
    PERFORM pg_temp.t_ok(NOT EXISTS (SELECT 1 FROM aclexplode(r.proacl) a WHERE a.grantee = 0),
      format('A-PRIV PUBLIC has no execute on %s', r.proname));
  END LOOP;
END;
$priv$;

-- ---------------------------------------------------------------------------
-- A-ORACLE: B owns a device with a queued repair; A reports B's id.
-- ---------------------------------------------------------------------------
INSERT INTO public.host_push_devices (
  user_id, provider_subscription_id, platform, device_permission, device_opted_in,
  last_reported_at, last_report_reason, provider_state, repair_state, repair_requests,
  repair_window_started_at, app_build
) VALUES (
  '45491111-0000-4000-8000-000000000002', 'b-owned-sub-0001', 'ios', 'granted', true,
  now() - interval '1 day', 'launch', 'refused_token', 'requested', 1,
  now() - interval '1 day', 'b-build'
);
INSERT INTO t4549 SELECT 'b_before', row_to_json(d)::text FROM public.host_push_devices d
 WHERE d.provider_subscription_id = 'b-owned-sub-0001';
GRANT SELECT ON t4549 TO authenticated;

SET LOCAL ROLE authenticated;
SELECT pg_temp.t_as('authenticated', '45491111-0000-4000-8000-000000000001');
INSERT INTO t4549 VALUES
  ('a_on_b', public.report_host_push_device('b-owned-sub-0001', 'android', 'evil', 'denied', false, false, false, 'launch')::text),
  ('a_on_unknown', public.report_host_push_device('never-seen-sub-0001', 'android', 'evil', 'denied', false, false, false, 'launch')::text);
INSERT INTO t4549 VALUES ('a_select', pg_temp.t_err('SELECT count(*) FROM public.host_push_devices'));
RESET ROLE;

SELECT pg_temp.t_ok((SELECT v FROM t4549 WHERE k = 'a_on_b') = (SELECT v FROM t4549 WHERE k = 'a_on_unknown'),
  'A-ORACLE another account''s subscription id answers exactly like an unknown id');
SELECT pg_temp.t_ok((SELECT v FROM t4549 WHERE k = 'a_on_b')::jsonb = '{"action":"none"}'::jsonb,
  'A-ORACLE another account''s queued repair is not handed to the caller');
SELECT pg_temp.t_ok((SELECT v FROM t4549 WHERE k = 'a_select') = '42501',
  'A-ORACLE the caller still cannot read the table directly');
SELECT pg_temp.t_ok(
  (SELECT row_to_json(d)::text FROM public.host_push_devices d
    WHERE d.user_id = '45491111-0000-4000-8000-000000000002')
  = (SELECT v FROM t4549 WHERE k = 'b_before'),
  'A-ORACLE the other account''s row is byte-identical afterwards (repair still queued)');
SELECT pg_temp.t_ok(
  (SELECT count(*) FROM public.host_push_devices
    WHERE user_id = '45491111-0000-4000-8000-000000000001') = 2,
  'A-ORACLE the caller''s reports landed only on the caller''s own rows');

-- ---------------------------------------------------------------------------
-- A-INPUT
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.t_as('authenticated', '45491111-0000-4000-8000-000000000003');
INSERT INTO t4549 VALUES
  ('in_128', pg_temp.t_err(format($q$SELECT public.report_host_push_device(%L,'ios',NULL,'granted',true,true,true,'launch')$q$, repeat('a', 128)))),
  ('in_129', pg_temp.t_err(format($q$SELECT public.report_host_push_device(%L,'ios',NULL,'granted',true,true,true,'launch')$q$, repeat('a', 129)))),
  ('in_big', pg_temp.t_err(format($q$SELECT public.report_host_push_device(%L,'ios',NULL,'granted',true,true,true,'launch')$q$, repeat('a', 100000)))),
  ('in_empty', pg_temp.t_err($q$SELECT public.report_host_push_device('','ios',NULL,'granted',true,true,true,'launch')$q$)),
  ('in_null', pg_temp.t_err($q$SELECT public.report_host_push_device(NULL,'ios',NULL,'granted',true,true,true,'launch')$q$)),
  ('in_space', pg_temp.t_err($q$SELECT public.report_host_push_device('abc def','ios',NULL,'granted',true,true,true,'launch')$q$)),
  ('in_punct', pg_temp.t_err($q$SELECT public.report_host_push_device('abc'';--','ios',NULL,'granted',true,true,true,'launch')$q$)),
  ('in_newline', pg_temp.t_err(format($q$SELECT public.report_host_push_device(%L,'ios',NULL,'granted',true,true,true,'launch')$q$, 'abc' || chr(10)))),
  ('in_unicode', pg_temp.t_err($q$SELECT public.report_host_push_device('abcé','ios',NULL,'granted',true,true,true,'launch')$q$)),
  ('in_platform_case', pg_temp.t_err($q$SELECT public.report_host_push_device('abc1','IOS',NULL,'granted',true,true,true,'launch')$q$)),
  ('in_platform_web', pg_temp.t_err($q$SELECT public.report_host_push_device('abc1','web',NULL,'granted',true,true,true,'launch')$q$)),
  ('in_perm_space', pg_temp.t_err($q$SELECT public.report_host_push_device('abc1','ios',NULL,'granted ',true,true,true,'launch')$q$)),
  ('in_reason_null', pg_temp.t_err($q$SELECT public.report_host_push_device('abc1','ios',NULL,'granted',true,true,true,NULL)$q$)),
  ('in_reason_bad', pg_temp.t_err($q$SELECT public.report_host_push_device('abc1','ios',NULL,'granted',true,true,true,'cron')$q$)),
  ('in_build_64', pg_temp.t_err(format($q$SELECT public.report_host_push_device('abc2','ios',%L,'granted',true,true,true,'launch')$q$, repeat('9', 64)))),
  ('in_build_65', pg_temp.t_err(format($q$SELECT public.report_host_push_device('abc3','ios',%L,'granted',true,true,true,'launch')$q$, repeat('9', 65)))),
  ('in_bool_null', pg_temp.t_err($q$SELECT public.report_host_push_device('abc4','android',NULL,'not_determined',NULL,NULL,NULL,'foreground')$q$)),
  ('in_bool_text', pg_temp.t_err($q$SELECT public.report_host_push_device('abc5','ios',NULL,'granted','maybe',true,true,'launch')$q$));
SELECT pg_temp.t_as('authenticated', 'not-a-uuid');
INSERT INTO t4549 VALUES ('in_garbage_sub', pg_temp.t_err($q$SELECT public.report_host_push_device('abc6','ios',NULL,'granted',true,true,true,'launch')$q$));
SELECT pg_temp.t_as('authenticated', '');
INSERT INTO t4549 VALUES ('in_empty_sub', pg_temp.t_err($q$SELECT public.report_host_push_device('abc7','ios',NULL,'granted',true,true,true,'launch')$q$));
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.t_as('anon', NULL);
INSERT INTO t4549 VALUES ('in_anon', pg_temp.t_err($q$SELECT public.report_host_push_device('abc8','ios',NULL,'granted',true,true,true,'launch')$q$));
RESET ROLE;

SELECT pg_temp.t_ok((SELECT v FROM t4549 WHERE k = 'in_128') = 'ok', 'A-INPUT a 128-character id is accepted');
SELECT pg_temp.t_ok((SELECT v FROM t4549 WHERE k = 'in_129') = '22023', 'A-INPUT a 129-character id is refused 22023');
SELECT pg_temp.t_ok((SELECT v FROM t4549 WHERE k = 'in_big') = '22023', 'A-INPUT a 100 000-character id is refused 22023');
SELECT pg_temp.t_ok((SELECT bool_and(v = '22023') FROM t4549 WHERE k IN
  ('in_empty','in_null','in_space','in_punct','in_newline','in_unicode','in_platform_case','in_platform_web',
   'in_perm_space','in_reason_null','in_reason_bad','in_build_65')),
  'A-INPUT empty, null, spaces, punctuation, newline, non-ASCII, enum case/space variants, bad reason, 65-char build: all 22023');
SELECT pg_temp.t_ok((SELECT v FROM t4549 WHERE k = 'in_build_64') = 'ok', 'A-INPUT a 64-character build label is accepted');
SELECT pg_temp.t_ok((SELECT v FROM t4549 WHERE k = 'in_bool_null') = 'ok', 'A-INPUT unknown booleans are stored as unknown (null)');
SELECT pg_temp.t_ok((SELECT v FROM t4549 WHERE k = 'in_bool_text') = '22P02', 'A-INPUT a non-boolean flag is refused before the call (22P02)');
SELECT pg_temp.t_ok((SELECT v FROM t4549 WHERE k = 'in_garbage_sub') = '22P02', 'A-INPUT a garbage caller id is refused (22P02), nothing written');
SELECT pg_temp.t_ok((SELECT v FROM t4549 WHERE k = 'in_empty_sub') = 'PT401', 'A-INPUT an empty caller id is PT401');
SELECT pg_temp.t_ok((SELECT v FROM t4549 WHERE k = 'in_anon') = '42501', 'A-INPUT anon cannot call the report at all (42501)');
SELECT pg_temp.t_ok(
  (SELECT count(*) FROM public.host_push_devices WHERE user_id = '45491111-0000-4000-8000-000000000003') = 3,
  'A-INPUT only the three accepted reports wrote rows');
SELECT pg_temp.t_ok(
  (SELECT device_opted_in IS NULL AND device_token_present IS NULL AND device_linked IS NULL
     FROM public.host_push_devices WHERE provider_subscription_id = 'abc4'),
  'A-INPUT null flags are not coerced to false');

-- ---------------------------------------------------------------------------
-- A-REPEAT: 300 reports of one device; a queued repair delivered once.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.t_as('authenticated', '45491111-0000-4000-8000-000000000002');
INSERT INTO t4549
SELECT 'rep_' || g, public.report_host_push_device('b-owned-sub-0001', 'ios', 'b-build', 'granted', true, true, true,
         CASE g % 3 WHEN 0 THEN 'launch' WHEN 1 THEN 'foreground' ELSE 'sign_in' END)::text
  FROM generate_series(1, 300) g;
RESET ROLE;
SELECT pg_temp.t_ok((SELECT count(*) FROM t4549 WHERE k LIKE 'rep_%' AND v::jsonb ->> 'action' = 'reregister') = 1,
  'A-REPEAT 300 reports: the queued repair is handed out exactly once');
SELECT pg_temp.t_ok((SELECT v FROM t4549 WHERE k = 'rep_1')::jsonb ->> 'action' = 'reregister',
  'A-REPEAT it is the first report that gets it');
SELECT pg_temp.t_ok((SELECT count(*) FROM public.host_push_devices WHERE user_id = '45491111-0000-4000-8000-000000000002') = 1,
  'A-REPEAT 300 reports of one device leave one row');
SELECT pg_temp.t_ok((SELECT repair_state = 'none' AND repair_requests = 2 AND provider_state = 'refused_token'
     FROM public.host_push_devices WHERE user_id = '45491111-0000-4000-8000-000000000002'),
  'A-REPEAT counted once (1 -> 2); provider verdict untouched by the app');

-- At the cap: a queued repair at 3 is still delivered once and never exceeds 3.
UPDATE public.host_push_devices SET repair_state = 'requested', repair_requests = 3
 WHERE user_id = '45491111-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT pg_temp.t_as('authenticated', '45491111-0000-4000-8000-000000000002');
INSERT INTO t4549 VALUES ('cap_1', public.report_host_push_device('b-owned-sub-0001', 'ios', NULL, 'granted', true, true, true, 'launch')::text),
                         ('cap_2', public.report_host_push_device('b-owned-sub-0001', 'ios', NULL, 'granted', true, true, true, 'launch')::text);
RESET ROLE;
SELECT pg_temp.t_ok((SELECT v FROM t4549 WHERE k = 'cap_1')::jsonb ->> 'action' = 'reregister'
                AND (SELECT v FROM t4549 WHERE k = 'cap_2')::jsonb ->> 'action' = 'none'
                AND (SELECT repair_requests FROM public.host_push_devices WHERE user_id = '45491111-0000-4000-8000-000000000002') = 3,
  'A-REPEAT at the cap the counter stays 3 and the check constraint never fires');

-- ---------------------------------------------------------------------------
-- A-CAND
-- ---------------------------------------------------------------------------
SELECT pg_temp.t_ok((SELECT count(*) FROM public.host_push_reconcile_candidates(NULL)) = 0, 'A-CAND null limit returns nothing');
SELECT pg_temp.t_ok((SELECT count(*) FROM public.host_push_reconcile_candidates(-5)) = 0, 'A-CAND negative limit returns nothing');
SELECT pg_temp.t_ok((SELECT count(*) FROM public.host_push_reconcile_candidates(2147483647)) <= 40, 'A-CAND a huge limit is clamped to 40');
SELECT pg_temp.t_ok(EXISTS (SELECT 1 FROM public.host_push_reconcile_candidates(40) c
                             WHERE c.user_id = '45491111-0000-4000-8000-000000000002'),
  'A-CAND an account that reported this week is a candidate');
DELETE FROM auth.users WHERE id = '45491111-0000-4000-8000-000000000002';
SELECT pg_temp.t_ok(NOT EXISTS (SELECT 1 FROM public.host_push_devices WHERE user_id = '45491111-0000-4000-8000-000000000002'),
  'A-CAND deleting the account deletes its device rows');
SELECT pg_temp.t_ok(NOT EXISTS (SELECT 1 FROM public.host_push_reconcile_candidates(40) c
                             WHERE c.user_id = '45491111-0000-4000-8000-000000000002'),
  'A-CAND a deleted account is never a candidate');

-- ---------------------------------------------------------------------------
-- A-3720: old body vs new body over the whole matrix.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.t_call(p_fn text, p_d uuid, p_st text, p_prov text)
RETURNS text LANGUAGE plpgsql AS $fn$
DECLARE v text;
BEGIN
  EXECUTE format('SELECT %s(%L::uuid, %L, %L, %L, %L, %s)::text', p_fn, p_d, p_st, p_prov, 'msg-1', 'why', 2) INTO v;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN 'E' || SQLSTATE;
END;
$fn$;

DO $m$
DECLARE
  ch text; prior text; st text; prov text; with_n boolean;
  n_old uuid; n_new uuid; d_old uuid; d_new uuid;
  r_old text; r_new text;
  pre_sent timestamptz;
  dj_old jsonb; dj_new jsonb; nj_old jsonb; nj_new jsonb;
  expect_mark boolean;
  cases integer := 0; marked integer := 0;
BEGIN
  FOREACH ch IN ARRAY ARRAY['push', 'email', 'sms', 'inapp'] LOOP
   FOREACH prior IN ARRAY ARRAY['queued', 'sending', 'sent', 'failed', 'deferred'] LOOP
    FOREACH st IN ARRAY ARRAY['queued', 'sent', 'delivered', 'undelivered', 'failed', 'suppressed', 'skipped', 'sending', 'bogus'] LOOP
     FOREACH prov IN ARRAY ARRAY['onesignal', NULL] LOOP
      FOREACH with_n IN ARRAY ARRAY[true, false] LOOP
        n_old := gen_random_uuid(); n_new := gen_random_uuid();
        d_old := gen_random_uuid(); d_new := gen_random_uuid();
        -- Half the cases start with an earlier push_sent_at that must be kept.
        pre_sent := CASE WHEN prov IS NULL THEN now() - interval '1 hour' END;
        IF with_n THEN
          INSERT INTO public.notifications (id, user_id, type, title, body, push_sent, push_sent_at) VALUES
            (n_old, '45491111-0000-4000-8000-000000000001', 'business.order.paid', 't', 'b', pre_sent IS NOT NULL, pre_sent),
            (n_new, '45491111-0000-4000-8000-000000000001', 'business.order.paid', 't', 'b', pre_sent IS NOT NULL, pre_sent);
        END IF;
        INSERT INTO public.notification_deliveries (id, notification_id, channel, status, contact, provider) VALUES
          (d_old, CASE WHEN with_n THEN n_old END, ch, prior, 'x', 'p0'),
          (d_new, CASE WHEN with_n THEN n_new END, ch, prior, 'x', 'p0');

        r_old := pg_temp.t_call('pg_temp.t_prev_complete', d_old, st, prov);
        r_new := pg_temp.t_call('public.issue_3720_complete_notification_channel', d_new, st, prov);
        IF r_old IS DISTINCT FROM r_new THEN
          RAISE EXCEPTION 'issue #4549 tester adversarial FAIL: A-3720 return differs for %/%/%/%/%: old % new %',
            ch, prior, st, prov, with_n, r_old, r_new;
        END IF;

        SELECT to_jsonb(d) - 'id' - 'notification_id' INTO dj_old FROM public.notification_deliveries d WHERE d.id = d_old;
        SELECT to_jsonb(d) - 'id' - 'notification_id' INTO dj_new FROM public.notification_deliveries d WHERE d.id = d_new;
        IF dj_old IS DISTINCT FROM dj_new THEN
          RAISE EXCEPTION 'issue #4549 tester adversarial FAIL: A-3720 delivery row differs for %/%/%/%/%', ch, prior, st, prov, with_n;
        END IF;

        IF with_n THEN
          SELECT to_jsonb(n) - 'id' INTO nj_old FROM public.notifications n WHERE n.id = n_old;
          SELECT to_jsonb(n) - 'id' INTO nj_new FROM public.notifications n WHERE n.id = n_new;
          expect_mark := ch = 'push' AND prior = 'queued' AND st = 'sent';
          IF (nj_old - 'push_sent' - 'push_sent_at') IS DISTINCT FROM (nj_new - 'push_sent' - 'push_sent_at') THEN
            RAISE EXCEPTION 'issue #4549 tester adversarial FAIL: A-3720 notification row differs beyond push_sent for %/%/%/%', ch, prior, st, prov;
          END IF;
          IF (nj_old ->> 'push_sent')::boolean IS DISTINCT FROM (pre_sent IS NOT NULL)
             OR (nj_old ->> 'push_sent_at')::timestamptz IS DISTINCT FROM pre_sent THEN
            RAISE EXCEPTION 'issue #4549 tester adversarial FAIL: A-3720 the old body moved push_sent (harness broken)';
          END IF;
          IF expect_mark THEN
            marked := marked + 1;
            IF NOT (nj_new ->> 'push_sent')::boolean
               OR (nj_new ->> 'push_sent_at')::timestamptz IS DISTINCT FROM COALESCE(pre_sent, now()) THEN
              RAISE EXCEPTION 'issue #4549 tester adversarial FAIL: A-3720 a queued push completed as sent did not set push_sent / keep push_sent_at (%/%)', prov, pre_sent;
            END IF;
          ELSIF nj_new IS DISTINCT FROM nj_old THEN
            RAISE EXCEPTION 'issue #4549 tester adversarial FAIL: A-3720 push_sent moved for %/%/%/%', ch, prior, st, prov;
          END IF;
        END IF;
        cases := cases + 1;
      END LOOP;
     END LOOP;
    END LOOP;
   END LOOP;
  END LOOP;
  PERFORM pg_temp.t_ok(cases = 720 AND marked = 2,
    format('A-3720 old and new body agree on all %s cases; push_sent moves in exactly the %s queued-push-sent cases', cases, marked));
  PERFORM pg_temp.t_ok(pg_temp.t_call('pg_temp.t_prev_complete', NULL, 'sent', NULL)
                       = pg_temp.t_call('public.issue_3720_complete_notification_channel', NULL, 'sent', NULL),
    'A-3720 a null delivery id fails the same way in both bodies');
  PERFORM pg_temp.t_ok(pg_temp.t_call('public.issue_3720_complete_notification_channel', gen_random_uuid(), 'sent', NULL) = 'false',
    'A-3720 an unknown delivery id returns false and writes nothing');
END;
$m$;

-- ---------------------------------------------------------------------------
-- A-CRON: re-running the schedule statements keeps exactly one job.
-- ---------------------------------------------------------------------------
INSERT INTO t4549 SELECT 'cron_cmd', command FROM cron.job WHERE jobname = 'issue_4549_host_push_reconcile';
-- pg_cron matches a job name per owner; migrations run (and own the job) as postgres.
GRANT SELECT ON t4549 TO postgres;
SET LOCAL ROLE postgres;
select cron.unschedule('issue_4549_host_push_reconcile')
 where exists (select 1 from cron.job where jobname = 'issue_4549_host_push_reconcile');
select cron.schedule('issue_4549_host_push_reconcile', '*/30 * * * *', (SELECT v FROM t4549 WHERE k = 'cron_cmd'));
select cron.unschedule('issue_4549_host_push_reconcile')
 where exists (select 1 from cron.job where jobname = 'issue_4549_host_push_reconcile');
select cron.schedule('issue_4549_host_push_reconcile', '*/30 * * * *', (SELECT v FROM t4549 WHERE k = 'cron_cmd'));
RESET ROLE;
SELECT pg_temp.t_ok((SELECT count(*) FROM cron.job WHERE jobname = 'issue_4549_host_push_reconcile') = 1,
  'A-CRON re-applying the schedule twice leaves exactly one job');
SELECT pg_temp.t_ok((SELECT count(*) FROM cron.job WHERE command LIKE '%/functions/v1/host-push-reconcile%') = 1,
  'A-CRON exactly one job in the whole schedule calls host-push-reconcile');
SELECT pg_temp.t_ok((SELECT v FROM t4549 WHERE k = 'cron_cmd') NOT LIKE '%eyJ%'
                AND (SELECT v FROM t4549 WHERE k = 'cron_cmd') NOT LIKE '%supabase.co%'
                AND (SELECT v FROM t4549 WHERE k = 'cron_cmd') LIKE '%vault.decrypted_secrets%',
  'A-CRON the job holds no key and no URL; both are read from the vault at run time');

ROLLBACK;
