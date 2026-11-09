-- MINGLA-INVARIANT: I-4273-SMS-SWITCHES-IN-DB | issue #4273 | Marketing SMS switches and the marketing Messaging Service SID live only in public.sms_country_switches / public.sms_marketing_sender_config; both are service-role read-only, and writes go only through the owner/admin audited RPCs admin_set_sms_country_switch / admin_set_sms_country_readiness.
-- MINGLA-INVARIANT: I-4273-NO-SWITCH-ON-BEFORE-READY | issue #4273 | A country cannot be marketing-enabled while it needs a local number or an unfinished sender registration (table CHECK and RPC), or while it has no SMS price (RPC).
-- #4273 — SMS country switches and the marketing sender in the database,
-- executable PostgreSQL 17 proof. Runs after the complete migration replay and
-- rolls every fixture back.
--
-- Proves (spec §7):
--   S-1  the seed: 35 rows, US/NG on, all others off, senders and registration
--        as smsCountries.ts, the config SID exact;
--   S-2  anon / authenticated cannot read or write either table or run the
--        edge read; service_role can read and run it, but cannot write;
--   S-3  even the table owner cannot turn on BE (needs a local number) or IE
--        (registration not done): check_violation;
--   S-4  the owner switches GB on then off; two audit rows with before/after
--        and the reason;
--   S-5  an admin marks IE registration done, then switches IE on;
--   S-6  the partner seat, a plain user and anon get not_authorized (42501)
--        from all three admin RPCs;
--   S-7  BE on, CA on (no price), a blank reason, an unknown country and a
--        no-change write are refused by name;
--   S-8  a stale expected_updated_at raises SQLSTATE PT409;
--   S-9  undoing IE's registration while on, changing a sender while on, and
--        changing a US sender are refused;
--   S-10 sms_marketing_switches_v1() as service_role: exact shape, reflects S-4/S-5;
--   S-11 the migration text has no dynamic EXECUTE and no 40001.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

CREATE TEMP TABLE t4273s_people (who text PRIMARY KEY, id uuid NOT NULL, email text NOT NULL) ON COMMIT DROP;
INSERT INTO t4273s_people (who, id, email) VALUES
  ('owner',   '42730000-5000-4000-a000-000000000001', 't4273s-owner@mingla-fixture.org'),
  ('admin',   '42730000-5000-4000-a000-000000000002', 't4273s-admin@mingla-fixture.org'),
  ('partner', '42730000-5000-4000-a000-000000000003', 't4273s-partner@mingla-fixture.org'),
  ('nobody',  '42730000-5000-4000-a000-000000000004', 't4273s-nobody@mingla-fixture.org');
INSERT INTO auth.users (id, email, email_confirmed_at) SELECT id, email, now() FROM t4273s_people;
INSERT INTO public.admin_users (email, role, status, accepted_at) VALUES
  ('t4273s-owner@mingla-fixture.org', 'owner', 'active', now()),
  ('t4273s-admin@mingla-fixture.org', 'admin', 'active', now()),
  ('t4273s-partner@mingla-fixture.org', 'partner', 'active', now());

-- GB and IE need a price to be switched on (the replay seeds US and NG only).
INSERT INTO public.sms_country_prices
  (country, provider, currency, minor_numerator, minor_denominator, source, source_reference, fetched_at)
VALUES
  ('GB', 'twilio', 'USD', 560, 100, 'twilio_pricing_api', 't4273s fixture', now()),
  ('IE', 'twilio', 'USD', 800, 100, 'twilio_pricing_api', 't4273s fixture', now())
ON CONFLICT (country) DO NOTHING;

CREATE TEMP TABLE t4273s_results (seq serial PRIMARY KEY, test text, label text, ok boolean, detail text) ON COMMIT DROP;

-- Run one SQL expression as a persona (or anon / service_role); returns its
-- text value or ERR:<sqlstate>:<message>.
CREATE FUNCTION pg_temp.t4273s_as(p_who text, p_sql text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid; v_email text; v_out text;
BEGIN
  BEGIN
    IF p_who = 'anon' THEN
      SET LOCAL ROLE anon;
      PERFORM set_config('request.jwt.claim.sub', '', true);
      PERFORM set_config('request.jwt.claim.email', '', true);
      PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    ELSIF p_who = 'service_role' THEN
      SET LOCAL ROLE service_role;
      PERFORM set_config('request.jwt.claim.sub', '', true);
      PERFORM set_config('request.jwt.claim.email', '', true);
      PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    ELSIF p_who = 'owner_table' THEN
      NULL; -- the test runner, i.e. the table owner
    ELSE
      SELECT id, email INTO STRICT v_id, v_email FROM t4273s_people WHERE who = p_who;
      SET LOCAL ROLE authenticated;
      PERFORM set_config('request.jwt.claim.sub', v_id::text, true);
      PERFORM set_config('request.jwt.claim.email', v_email, true);
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
    END IF;
    EXECUTE p_sql INTO v_out;
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claim.email', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN COALESCE(v_out, 'NULL');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claim.email', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM;
  END;
END;
$fn$;

CREATE FUNCTION pg_temp.t4273s_check(p_test text, p_label text, p_got text, p_want text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO t4273s_results (test, label, ok, detail)
  VALUES (p_test, p_label, p_got IS NOT DISTINCT FROM p_want,
          format('got %s, want %s', COALESCE(left(p_got, 600), '<null>'), COALESCE(p_want, '<null>')));
END;
$fn$;

CREATE FUNCTION pg_temp.t4273s_like(p_test text, p_label text, p_got text, p_pattern text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO t4273s_results (test, label, ok, detail)
  VALUES (p_test, p_label, COALESCE(p_got LIKE p_pattern, false),
          format('got %s, want like %s', COALESCE(left(p_got, 600), '<null>'), p_pattern));
END;
$fn$;

-- ─────────────────────────────── S-1 seed ───────────────────────────────────
DO $s1$
BEGIN
  PERFORM pg_temp.t4273s_check('S-1', '35 rows',
    (SELECT count(*)::text FROM public.sms_country_switches), '35');
  PERFORM pg_temp.t4273s_check('S-1', 'on = exactly US and NG',
    (SELECT string_agg(country, ',' ORDER BY country) FROM public.sms_country_switches WHERE marketing_enabled), 'NG,US');
  PERFORM pg_temp.t4273s_check('S-1', 'toll_free = CA,US',
    (SELECT string_agg(country, ',' ORDER BY country) FROM public.sms_country_switches WHERE sender = 'toll_free'), 'CA,US');
  PERFORM pg_temp.t4273s_check('S-1', 'termii = NG',
    (SELECT string_agg(country, ',' ORDER BY country) FROM public.sms_country_switches WHERE sender = 'termii'), 'NG');
  PERFORM pg_temp.t4273s_check('S-1', 'needs_local_number = BE,HU',
    (SELECT string_agg(country, ',' ORDER BY country) FROM public.sms_country_switches WHERE sender = 'needs_local_number'), 'BE,HU');
  PERFORM pg_temp.t4273s_check('S-1', 'marketing_service = the other 30',
    (SELECT count(*)::text FROM public.sms_country_switches WHERE sender = 'marketing_service'), '30');
  PERFORM pg_temp.t4273s_check('S-1', 'registration required = AT,BG,CZ,ES,FI,IE,RO, none done',
    (SELECT string_agg(country || ':' || (registration_done_at IS NOT NULL)::text, ',' ORDER BY country)
       FROM public.sms_country_switches WHERE registration_required),
    'AT:false,BG:false,CZ:false,ES:false,FI:false,IE:false,RO:false');
  PERFORM pg_temp.t4273s_check('S-1', 'config SID and label exact',
    (SELECT marketing_messaging_service_sid || '|' || label FROM public.sms_marketing_sender_config),
    'MG9d42785c51834395018b52144736b9a7|Mingla Marketing');
  PERFORM pg_temp.t4273s_check('S-1', 'RLS on both tables',
    (SELECT string_agg(relname || ':' || relrowsecurity::text, ',' ORDER BY relname) FROM pg_class
      WHERE oid IN ('public.sms_country_switches'::regclass, 'public.sms_marketing_sender_config'::regclass)),
    'sms_country_switches:true,sms_marketing_sender_config:true');
  PERFORM pg_temp.t4273s_check('S-1', 'no API role holds a write privilege on either table',
    (SELECT count(*)::text FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name IN ('sms_country_switches', 'sms_marketing_sender_config')
        AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
        AND privilege_type <> 'SELECT'), '0');
  PERFORM pg_temp.t4273s_check('S-1', 'only service_role may SELECT',
    (SELECT string_agg(DISTINCT grantee, ',') FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name IN ('sms_country_switches', 'sms_marketing_sender_config')
        AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')), 'service_role');
  PERFORM pg_temp.t4273s_like('S-1', 'the transactional SID can never be the marketing sender',
    pg_temp.t4273s_as('owner_table',
      $q$UPDATE public.sms_marketing_sender_config SET marketing_messaging_service_sid = 'MG1942fbb549187fcf77c0e860405abf58' RETURNING 'x'$q$),
    'ERR:23514:%');
END;
$s1$;

-- ─────────────────────── S-2 direct access by API roles ────────────────────
DO $s2$
DECLARE
  v_who text;
  v_tbl text;
BEGIN
  FOREACH v_who IN ARRAY ARRAY['anon', 'nobody', 'owner'] LOOP
    FOREACH v_tbl IN ARRAY ARRAY['sms_country_switches', 'sms_marketing_sender_config'] LOOP
      PERFORM pg_temp.t4273s_like('S-2', v_who || ' SELECT ' || v_tbl,
        pg_temp.t4273s_as(v_who, format('SELECT count(*)::text FROM public.%I', v_tbl)), 'ERR:42501:%');
      PERFORM pg_temp.t4273s_like('S-2', v_who || ' UPDATE ' || v_tbl,
        pg_temp.t4273s_as(v_who, format('UPDATE public.%I SET updated_at = now() RETURNING ''x''', v_tbl)), 'ERR:42501:%');
      PERFORM pg_temp.t4273s_like('S-2', v_who || ' DELETE ' || v_tbl,
        pg_temp.t4273s_as(v_who, format('DELETE FROM public.%I RETURNING ''x''', v_tbl)), 'ERR:42501:%');
    END LOOP;
    PERFORM pg_temp.t4273s_like('S-2', v_who || ' INSERT sms_country_switches',
      pg_temp.t4273s_as(v_who, $q$INSERT INTO public.sms_country_switches (country, sender) VALUES ('ZZ', 'marketing_service') RETURNING 'x'$q$),
      'ERR:42501:%');
    PERFORM pg_temp.t4273s_like('S-2', v_who || ' INSERT sms_marketing_sender_config',
      pg_temp.t4273s_as(v_who, $q$INSERT INTO public.sms_marketing_sender_config (id, marketing_messaging_service_sid) VALUES (1, 'MG00000000000000000000000000000000') RETURNING 'x'$q$),
      'ERR:42501:%');
    PERFORM pg_temp.t4273s_like('S-2', v_who || ' runs sms_marketing_switches_v1',
      pg_temp.t4273s_as(v_who, 'SELECT public.sms_marketing_switches_v1()::text'), 'ERR:42501:%');
  END LOOP;

  PERFORM pg_temp.t4273s_check('S-2', 'service_role reads the switches',
    pg_temp.t4273s_as('service_role', 'SELECT count(*)::text FROM public.sms_country_switches'), '35');
  PERFORM pg_temp.t4273s_check('S-2', 'service_role reads the config',
    pg_temp.t4273s_as('service_role', 'SELECT count(*)::text FROM public.sms_marketing_sender_config'), '1');
  PERFORM pg_temp.t4273s_like('S-2', 'service_role cannot write the switches',
    pg_temp.t4273s_as('service_role', $q$UPDATE public.sms_country_switches SET marketing_enabled = true WHERE country = 'GB' RETURNING 'x'$q$),
    'ERR:42501:%');
  PERFORM pg_temp.t4273s_like('S-2', 'service_role cannot write the config',
    pg_temp.t4273s_as('service_role', $q$UPDATE public.sms_marketing_sender_config SET label = 'x' RETURNING 'x'$q$),
    'ERR:42501:%');
  PERFORM pg_temp.t4273s_like('S-2', 'service_role runs sms_marketing_switches_v1',
    pg_temp.t4273s_as('service_role', 'SELECT public.sms_marketing_switches_v1()::text'), '{%');
END;
$s2$;

-- ─────────────────────── S-3 the table CHECK, as owner ─────────────────────
DO $s3$
BEGIN
  PERFORM pg_temp.t4273s_like('S-3', 'BE on (needs a local number) refused by CHECK',
    pg_temp.t4273s_as('owner_table', $q$UPDATE public.sms_country_switches SET marketing_enabled = true WHERE country = 'BE' RETURNING 'x'$q$),
    'ERR:23514:%sms_country_switches_enable_only_when_ready%');
  PERFORM pg_temp.t4273s_like('S-3', 'IE on (registration not done) refused by CHECK',
    pg_temp.t4273s_as('owner_table', $q$UPDATE public.sms_country_switches SET marketing_enabled = true WHERE country = 'IE' RETURNING 'x'$q$),
    'ERR:23514:%sms_country_switches_enable_only_when_ready%');
  PERFORM pg_temp.t4273s_like('S-3', 'US on the marketing service refused by CHECK',
    pg_temp.t4273s_as('owner_table', $q$UPDATE public.sms_country_switches SET sender = 'marketing_service' WHERE country = 'US' RETURNING 'x'$q$),
    'ERR:23514:%sms_country_switches_sender_class%');
  PERFORM pg_temp.t4273s_like('S-3', 'NG toll-free refused by CHECK',
    pg_temp.t4273s_as('owner_table', $q$UPDATE public.sms_country_switches SET sender = 'toll_free' WHERE country = 'NG' RETURNING 'x'$q$),
    'ERR:23514:%sms_country_switches_sender_class%');
  PERFORM pg_temp.t4273s_like('S-3', 'registration done on a country that needs none refused by CHECK',
    pg_temp.t4273s_as('owner_table', $q$UPDATE public.sms_country_switches SET registration_done_at = now() WHERE country = 'GB' RETURNING 'x'$q$),
    'ERR:23514:%sms_country_switches_registration_shape%');
END;
$s3$;

-- ─────────────────────── S-4 owner switches GB on and off ──────────────────
DO $s4$
DECLARE
  v_out text;
  v_at text;
  v_list jsonb;
BEGIN
  v_list := pg_temp.t4273s_as('owner', 'SELECT public.admin_sms_country_switches_list()::text')::jsonb;
  PERFORM pg_temp.t4273s_check('S-4', 'owner lists 35 countries',
    jsonb_array_length(v_list -> 'countries')::text, '35');
  PERFORM pg_temp.t4273s_check('S-4', 'list shows the marketing service',
    (v_list -> 'marketingService')::text, '{"sid": "MG9d42785c51834395018b52144736b9a7", "label": "Mingla Marketing"}');
  SELECT x ->> 'updatedAt' INTO v_at FROM jsonb_array_elements(v_list -> 'countries') x WHERE x ->> 'country' = 'GB';
  PERFORM pg_temp.t4273s_check('S-4', 'GB price in the list',
    (SELECT (x -> 'price' ->> 'provider') || ':' || (x -> 'price' ->> 'currency') || ':' || (x -> 'price' ->> 'minorNumerator') || '/' || (x -> 'price' ->> 'minorDenominator')
       FROM jsonb_array_elements(v_list -> 'countries') x WHERE x ->> 'country' = 'GB'), 'twilio:USD:560/100');
  PERFORM pg_temp.t4273s_check('S-4', 'blocked reasons',
    (SELECT string_agg((x ->> 'country') || ':' || COALESCE(x ->> 'blockedReason', '-'), ',' ORDER BY x ->> 'country')
       FROM jsonb_array_elements(v_list -> 'countries') x WHERE x ->> 'country' IN ('BE', 'CA', 'GB', 'IE', 'FR', 'US')),
    'BE:needs_local_number,CA:unpriced,FR:unpriced,GB:-,IE:registration_pending,US:-');

  v_out := pg_temp.t4273s_as('owner',
    format($q$SELECT public.admin_set_sms_country_switch(' gb ', true, 'UK first, alpha sender', %L::timestamptz)::text$q$, v_at));
  PERFORM pg_temp.t4273s_like('S-4', 'owner switches GB on', v_out, '{"ok": true, "country": "GB", "updatedAt": %, "marketingEnabled": true}');
  v_at := (v_out::jsonb) ->> 'updatedAt';
  PERFORM pg_temp.t4273s_check('S-4', 'GB is on and stamped with the owner',
    (SELECT marketing_enabled::text || '|' || updated_by_email || '|' || updated_by::text FROM public.sms_country_switches WHERE country = 'GB'),
    'true|t4273s-owner@mingla-fixture.org|42730000-5000-4000-a000-000000000001');

  v_out := pg_temp.t4273s_as('owner',
    format($q$SELECT public.admin_set_sms_country_switch('GB', false, 'pause the UK', %L::timestamptz)::text$q$, v_at));
  PERFORM pg_temp.t4273s_like('S-4', 'owner switches GB off', v_out, '{"ok": true, %"marketingEnabled": false}');

  PERFORM pg_temp.t4273s_check('S-4', 'two audit rows with before/after and the reason',
    (SELECT string_agg(action || '|' || admin_email || '|' || reason || '|' || (metadata -> 'before' ->> 'marketingEnabled') || '>' || (metadata -> 'after' ->> 'marketingEnabled'), ' ; ' ORDER BY created_at, reason DESC)
       FROM public.admin_audit_log WHERE target_type = 'sms_country_switches' AND target_id = 'GB'),
    'sms_country.switch_set|t4273s-owner@mingla-fixture.org|UK first, alpha sender|false>true ; sms_country.switch_set|t4273s-owner@mingla-fixture.org|pause the UK|true>false');
  -- Put GB back on for S-10 (no expected timestamp: last write wins).
  PERFORM pg_temp.t4273s_as('owner', $q$SELECT public.admin_set_sms_country_switch('GB', true, 'S-10 fixture', NULL)::text$q$);
END;
$s4$;

-- ─────────────── S-5 admin marks IE registration done, then on ─────────────
DO $s5$
DECLARE v_out text;
BEGIN
  v_out := pg_temp.t4273s_as('admin',
    $q$SELECT public.admin_set_sms_country_readiness('IE', true, NULL, 'Twilio approved the IE sender', NULL)::text$q$);
  PERFORM pg_temp.t4273s_like('S-5', 'admin marks IE registration done', v_out, '{"ok": true, "sender": "marketing_service", "country": "IE", %');
  PERFORM pg_temp.t4273s_check('S-5', 'IE registration_done_at set',
    (SELECT (registration_done_at IS NOT NULL)::text FROM public.sms_country_switches WHERE country = 'IE'), 'true');
  v_out := pg_temp.t4273s_as('admin',
    $q$SELECT public.admin_set_sms_country_switch('IE', true, 'IE registered', NULL)::text$q$);
  PERFORM pg_temp.t4273s_like('S-5', 'admin switches IE on', v_out, '{"ok": true, "country": "IE", %"marketingEnabled": true}');
  PERFORM pg_temp.t4273s_check('S-5', 'readiness audited with before/after',
    (SELECT string_agg(action || '|' || reason || '|' || COALESCE(metadata -> 'before' ->> 'registrationDoneAt', 'null') || '>' || ((metadata -> 'after' ->> 'registrationDoneAt') IS NOT NULL)::text, ';')
       FROM public.admin_audit_log WHERE target_type = 'sms_country_switches' AND target_id = 'IE' AND action = 'sms_country.readiness_set'),
    'sms_country.readiness_set|Twilio approved the IE sender|null>true');
  -- Local number added for BE: the sender moves to the marketing service.
  v_out := pg_temp.t4273s_as('admin',
    $q$SELECT public.admin_set_sms_country_readiness('BE', NULL, 'marketing_service', 'local number added in Twilio', NULL)::text$q$);
  PERFORM pg_temp.t4273s_like('S-5', 'admin changes BE to the marketing service', v_out, '{"ok": true, "sender": "marketing_service", "country": "BE", %');
END;
$s5$;

-- ─────────────── S-6 partner, plain user and anon are refused ──────────────
DO $s6$
DECLARE
  v_who text;
BEGIN
  FOREACH v_who IN ARRAY ARRAY['partner', 'nobody', 'anon'] LOOP
    PERFORM pg_temp.t4273s_like('S-6', v_who || ' list',
      pg_temp.t4273s_as(v_who, 'SELECT public.admin_sms_country_switches_list()::text'), 'ERR:42501:%');
    PERFORM pg_temp.t4273s_like('S-6', v_who || ' switch',
      pg_temp.t4273s_as(v_who, $q$SELECT public.admin_set_sms_country_switch('FR', true, 'r', NULL)::text$q$), 'ERR:42501:%');
    PERFORM pg_temp.t4273s_like('S-6', v_who || ' readiness',
      pg_temp.t4273s_as(v_who, $q$SELECT public.admin_set_sms_country_readiness('AT', true, NULL, 'r', NULL)::text$q$), 'ERR:42501:%');
  END LOOP;
  PERFORM pg_temp.t4273s_like('S-6', 'partner refusal names not_authorized',
    pg_temp.t4273s_as('partner', 'SELECT public.admin_sms_country_switches_list()::text'), 'ERR:42501:not_authorized');
END;
$s6$;

-- ─────────────────────── S-7 named refusals ────────────────────────────────
DO $s7$
BEGIN
  PERFORM pg_temp.t4273s_check('S-7', 'HU on needs a local number',
    pg_temp.t4273s_as('owner', $q$SELECT public.admin_set_sms_country_switch('HU', true, 'r', NULL)::text$q$),
    'ERR:P0001:sms_country_needs_local_number');
  PERFORM pg_temp.t4273s_check('S-7', 'AT on before registration',
    pg_temp.t4273s_as('owner', $q$SELECT public.admin_set_sms_country_switch('AT', true, 'r', NULL)::text$q$),
    'ERR:P0001:sms_country_registration_pending');
  PERFORM pg_temp.t4273s_check('S-7', 'CA on with no price',
    pg_temp.t4273s_as('owner', $q$SELECT public.admin_set_sms_country_switch('CA', true, 'r', NULL)::text$q$),
    'ERR:P0001:sms_country_unpriced');
  PERFORM pg_temp.t4273s_check('S-7', 'blank reason',
    pg_temp.t4273s_as('owner', format($q$SELECT public.admin_set_sms_country_switch('FR', false, %L, NULL)::text$q$, E' \t' || chr(8203))),
    'ERR:P0001:reason_required');
  PERFORM pg_temp.t4273s_check('S-7', 'unknown country',
    pg_temp.t4273s_as('owner', $q$SELECT public.admin_set_sms_country_switch('XX', true, 'r', NULL)::text$q$),
    'ERR:P0001:unknown_country');
  PERFORM pg_temp.t4273s_check('S-7', 'missing state',
    pg_temp.t4273s_as('owner', $q$SELECT public.admin_set_sms_country_switch('FR', NULL, 'r', NULL)::text$q$),
    'ERR:P0001:state_required');
  PERFORM pg_temp.t4273s_check('S-7', 'no change',
    pg_temp.t4273s_as('owner', $q$SELECT public.admin_set_sms_country_switch('FR', false, 'r', NULL)::text$q$),
    'ERR:P0001:no_change');
  PERFORM pg_temp.t4273s_check('S-7', 'readiness with nothing to change',
    pg_temp.t4273s_as('owner', $q$SELECT public.admin_set_sms_country_readiness('AT', NULL, NULL, 'r', NULL)::text$q$),
    'ERR:P0001:no_change');
  PERFORM pg_temp.t4273s_check('S-7', 'registration on a country that needs none',
    pg_temp.t4273s_as('owner', $q$SELECT public.admin_set_sms_country_readiness('FR', true, NULL, 'r', NULL)::text$q$),
    'ERR:P0001:registration_not_required');
  PERFORM pg_temp.t4273s_check('S-7', 'refusals wrote no audit rows',
    (SELECT count(*)::text FROM public.admin_audit_log
      WHERE target_type = 'sms_country_switches' AND target_id IN ('HU', 'AT', 'CA', 'FR', 'XX')), '0');
END;
$s7$;

-- ─────────────────────── S-8 stale write raises PT409 ──────────────────────
DO $s8$
BEGIN
  PERFORM pg_temp.t4273s_check('S-8', 'stale switch write',
    pg_temp.t4273s_as('owner', $q$SELECT public.admin_set_sms_country_switch('FR', true, 'r', '2000-01-01T00:00:00Z')::text$q$),
    'ERR:PT409:sms_country_switch_stale');
  PERFORM pg_temp.t4273s_check('S-8', 'stale readiness write',
    pg_temp.t4273s_as('owner', $q$SELECT public.admin_set_sms_country_readiness('AT', true, NULL, 'r', '2000-01-01T00:00:00Z')::text$q$),
    'ERR:PT409:sms_country_switch_stale');
  PERFORM pg_temp.t4273s_check('S-8', 'FR still off',
    (SELECT marketing_enabled::text FROM public.sms_country_switches WHERE country = 'FR'), 'false');
END;
$s8$;

-- ─────────────────────── S-9 readiness while on ────────────────────────────
DO $s9$
BEGIN
  PERFORM pg_temp.t4273s_check('S-9', 'IE registration undone while on',
    pg_temp.t4273s_as('owner', $q$SELECT public.admin_set_sms_country_readiness('IE', false, NULL, 'r', NULL)::text$q$),
    'ERR:P0001:switch_off_first');
  PERFORM pg_temp.t4273s_check('S-9', 'GB sender change while on',
    pg_temp.t4273s_as('owner', $q$SELECT public.admin_set_sms_country_readiness('GB', NULL, 'needs_local_number', 'r', NULL)::text$q$),
    'ERR:P0001:switch_off_first');
  PERFORM pg_temp.t4273s_check('S-9', 'US sender change',
    pg_temp.t4273s_as('owner', $q$SELECT public.admin_set_sms_country_readiness('US', NULL, 'marketing_service', 'r', NULL)::text$q$),
    'ERR:P0001:sender_not_changeable');
  PERFORM pg_temp.t4273s_check('S-9', 'unknown sender value',
    pg_temp.t4273s_as('owner', $q$SELECT public.admin_set_sms_country_readiness('FR', NULL, 'toll_free', 'r', NULL)::text$q$),
    'ERR:P0001:sender_not_changeable');
END;
$s9$;

-- ─────────────────────── S-10 the edge read ────────────────────────────────
DO $s10$
DECLARE v_snap jsonb;
BEGIN
  v_snap := pg_temp.t4273s_as('service_role', 'SELECT public.sms_marketing_switches_v1()::text')::jsonb;
  PERFORM pg_temp.t4273s_check('S-10', 'top-level keys',
    (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(v_snap) k), 'countries,marketingServiceSid');
  PERFORM pg_temp.t4273s_check('S-10', 'SID',
    v_snap ->> 'marketingServiceSid', 'MG9d42785c51834395018b52144736b9a7');
  PERFORM pg_temp.t4273s_check('S-10', '35 countries, ordered',
    (SELECT string_agg(x ->> 'country', '' ORDER BY ord) FROM jsonb_array_elements(v_snap -> 'countries') WITH ORDINALITY AS t(x, ord)),
    (SELECT string_agg(country, '' ORDER BY country) FROM public.sms_country_switches));
  PERFORM pg_temp.t4273s_check('S-10', 'row shape exact (GB on)',
    (SELECT (x = '{"sender": "marketing_service", "country": "GB", "registrationDone": false, "marketingEnabled": true, "registrationRequired": false}'::jsonb)::text FROM jsonb_array_elements(v_snap -> 'countries') x WHERE x ->> 'country' = 'GB'),
    'true');
  PERFORM pg_temp.t4273s_check('S-10', 'IE on and registered',
    (SELECT (x = '{"sender": "marketing_service", "country": "IE", "registrationDone": true, "marketingEnabled": true, "registrationRequired": true}'::jsonb)::text FROM jsonb_array_elements(v_snap -> 'countries') x WHERE x ->> 'country' = 'IE'),
    'true');
  PERFORM pg_temp.t4273s_check('S-10', 'US and NG still on with their own senders',
    (SELECT string_agg((x ->> 'country') || ':' || (x ->> 'sender') || ':' || (x ->> 'marketingEnabled'), ',' ORDER BY x ->> 'country')
       FROM jsonb_array_elements(v_snap -> 'countries') x WHERE x ->> 'country' IN ('US', 'NG')),
    'NG:termii:true,US:toll_free:true');
END;
$s10$;

-- ─────────────────────── S-11 static scan of the migration ─────────────────
\set t4273s_mig `cat "$(git rev-parse --show-toplevel)/supabase/migrations/20280523004273_issue_4273_sms_country_switches.sql"`
SELECT set_config('t4273s.mig', :'t4273s_mig', true) IS NOT NULL AS loaded \gset
DO $s11$
DECLARE v_sql text := current_setting('t4273s.mig');
BEGIN
  PERFORM pg_temp.t4273s_check('S-11', 'migration text loaded', (length(v_sql) > 1000)::text, 'true');
  -- Every EXECUTE is a GRANT/REVOKE privilege name; none runs dynamic SQL.
  PERFORM pg_temp.t4273s_check('S-11', 'no dynamic EXECUTE',
    (SELECT count(*)::text FROM regexp_matches(v_sql, '(?<!GRANT |REVOKE )\mEXECUTE\M(?! ON FUNCTION)', 'gi')), '0');
  PERFORM pg_temp.t4273s_check('S-11', 'no 40001', (strpos(v_sql, '40001') = 0)::text, 'true');
END;
$s11$;

SELECT count(*) AS t4273s_total, count(*) FILTER (WHERE NOT ok) AS t4273s_failed,
       COALESCE(string_agg(test || ' ' || label || ' [' || detail || ']', E'\n' ORDER BY seq) FILTER (WHERE NOT ok), 'none') AS t4273s_failures
  FROM t4273s_results \gset
ROLLBACK;

SELECT (:t4273s_total < 80 OR :t4273s_failed > 0) AS t4273s_bad \gset
\if :t4273s_bad
  \echo 'ISSUE-4273 SMS COUNTRY SWITCHES FAILED:' :t4273s_failed 'of' :t4273s_total
  \echo :t4273s_failures
  DO $$ BEGIN RAISE EXCEPTION 'ISSUE-4273 SMS COUNTRY SWITCHES FAIL'; END $$;
\endif
\echo 'ISSUE-4273 SMS COUNTRY SWITCHES PASS:' :t4273s_total 'checks, 0 failed'
