-- #4490 P2-2 race (20281203084490): two real sessions (dblink) hold the last 10 guests of one pool
-- through two different offers; exactly one wins. COMMITS its fixtures (suite-owned database).
--
-- MINGLA-INVARIANT: I-4490-POOL-LOCK | issue #4490 | every hold locks the shared pool row, so offers sharing a day limit cannot oversell it together.
--
-- FAILS-ON-REVERT: drop the pool FOR UPDATE in issue_4490_hold_offer_internal -> R-1a / R-1b.
\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS dblink;
-- Suite-owned database (#4490): this suite COMMITs its fixtures for the dblink
-- race, so it records the feature flags it switches on and, at the end,
-- removes everything it committed (see the cleanup block at the end).
CREATE TABLE public.t4490_cleanup_flags AS
SELECT k AS flag_key, f.is_enabled, f.flag_key IS NOT NULL AS existed
FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES', 'STAY_RESERVE_READS', 'STAY_RESERVE_WRITES']) k
LEFT JOIN public.feature_flags f ON f.flag_key = k;
BEGIN;
-- (shared #4490 P2 suite fixture; copied into each suite)
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES', 'STAY_RESERVE_READS', 'STAY_RESERVE_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

CREATE FUNCTION public.t4490_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490 FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;

CREATE FUNCTION public.t4490_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490 FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490 FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;

CREATE FUNCTION public.t4490_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
  PERFORM set_config('role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
END
$f$;

CREATE FUNCTION public.t4490_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;

CREATE FUNCTION public.t4490_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;

GRANT EXECUTE ON FUNCTION public.t4490_ok(boolean, text), public.t4490_expect(text, text, text, text),
  public.t4490_as(uuid), public.t4490_service(), public.t4490_reset() TO PUBLIC;

-- People: 01 owner, 02 finance manager, 03 venue staff (check-in), 04 scanner member,
-- 05 outsider, 06 signed-in guest, 07 event manager.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44907000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p2u' || n || '-4490@example.test', now(), now()
FROM generate_series(1, 7) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44907000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at)
VALUES ('44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000001', 'Harmattan P2 4490',
        'harmattan-p2-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44907000-0000-4000-c000-000000000002', '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000002', 'finance_manager', now()),
  ('44907000-0000-4000-c000-000000000003', '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000003', 'venue_staff', now()),
  ('44907000-0000-4000-c000-000000000004', '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000004', 'scanner', now()),
  ('44907000-0000-4000-c000-000000000007', '44907000-0000-4000-9000-000000000010', '44907000-0000-4000-8000-000000000007', 'event_manager', now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44907000-0000-4000-9000-0000000000a1', '44907000-0000-4000-9000-000000000010', 'gamelandp24490', 'Gameland P2', 6.45, 3.40, 'play', 'verified', 'NG'),
  ('44907000-0000-4000-9000-0000000000a2', '44907000-0000-4000-9000-000000000010', 'arcadep24490', 'Arcade P2', 6.45, 3.41, 'play', 'verified', 'NG'),
  ('44907000-0000-4000-9000-0000000000a3', '44907000-0000-4000-9000-000000000010', 'stayp24490', 'Stay P2', 6.46, 3.42, 'stay', 'verified', 'NG');
INSERT INTO public.brand_team_member_venue_grants (member_id, venue_id, access_profile, capabilities) VALUES
  ('44907000-0000-4000-c000-000000000003', '44907000-0000-4000-9000-0000000000a1', 'custom', ARRAY['venue.check_in']::text[]);

-- Owner switches Entry on for both play venues.
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
DO $fe$
BEGIN
  PERFORM public.issue_4490_set_venue_feature('44907000-0000-4000-9000-0000000000a1', 'entry', true, NULL, NULL, NULL, 'p2-fx-entry-a1');
  PERFORM public.issue_4490_set_venue_feature('44907000-0000-4000-9000-0000000000a2', 'entry', true, NULL, NULL, NULL, 'p2-fx-entry-a2');
END
$fe$;

-- Owner builds the Gameland entry offer: pool 300 / 50, Walk-in N5,000 every
-- day, Student N4,000 Mon-Thu (ID at the gate), all day 12:00-00:00.
CREATE TEMP TABLE t4490_ids (k text PRIMARY KEY, v uuid) ;
GRANT ALL ON t4490_ids TO PUBLIC;
DO $fx$
DECLARE
  v jsonb;
  v_pool uuid;
  v_offer uuid;
  v_ver bigint;
BEGIN
  v := public.issue_4490_manage_capacity_pool('create', '44907000-0000-4000-9000-0000000000a1',
    '{"name":"Gameland day","dailyLimit":300,"keptForWalkIns":50}'::jsonb, NULL, 'p2-fx-pool-1');
  v_pool := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('pool', v_pool);
  v := public.issue_4490_manage_offer('create_draft', '44907000-0000-4000-9000-0000000000a1',
    '{"kind":"entry","name":"Entry","entryStyle":"walk_in"}'::jsonb, NULL, 'p2-fx-offer-1');
  v_offer := (v->>'id')::uuid; v_ver := (v->>'version')::bigint;
  INSERT INTO t4490_ids VALUES ('offer', v_offer);
  v := public.issue_4490_manage_offer('set_pool', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'poolId', v_pool), v_ver, 'p2-fx-offer-2');
  v_ver := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('upsert_price_option', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'name', 'Walk-in', 'unit', 'guest', 'guestMin', 1, 'guestMax', 20,
      'priceMinor', 500000), v_ver, 'p2-fx-offer-3');
  v_ver := (v->>'version')::bigint;
  INSERT INTO t4490_ids SELECT 'walkin', (o->>'id')::uuid FROM jsonb_array_elements(v->'options') o WHERE o->>'name' = 'Walk-in';
  v := public.issue_4490_manage_offer('upsert_price_option', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'name', 'Student & NYSC', 'unit', 'guest', 'guestMin', 1, 'guestMax', 20,
      'priceMinor', 400000, 'weekdays', jsonb_build_array(0, 1, 2, 3),
      'eligibility', jsonb_build_object('label', 'Student or NYSC ID', 'checkAtGate', true)), v_ver, 'p2-fx-offer-4');
  v_ver := (v->>'version')::bigint;
  INSERT INTO t4490_ids SELECT 'student', (o->>'id')::uuid FROM jsonb_array_elements(v->'options') o WHERE o->>'name' = 'Student & NYSC';
  v := public.issue_4490_manage_offer('set_policy', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'refundLadder', jsonb_build_array(
      jsonb_build_object('minMinutesBefore', 1440, 'refundBps', 10000),
      jsonb_build_object('minMinutesBefore', 0, 'refundBps', 5000)),
      'dateChangeRule', jsonb_build_object('allowedUntilMinutesBefore', 120, 'feeBps', 0)), v_ver, 'p2-fx-offer-5');
  v_ver := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('set_schedule', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'mode', 'full_day', 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
      'startTime', '00:00', 'endTime', '23:59'), v_ver, 'p2-fx-offer-6');
  v_ver := (v->>'version')::bigint;
  INSERT INTO t4490_ids VALUES ('offer_version_before_publish', NULL);
END
$fx$;
SELECT public.t4490_reset();
-- A second offer on the same pool, both live; a 10-guest day limit on the race day.
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
DO $r0$
DECLARE
  v jsonb;
  v_y uuid;
BEGIN
  v := public.issue_4490_manage_offer('create_draft', '44907000-0000-4000-9000-0000000000a1',
    '{"kind":"entry","name":"Day pass","entryStyle":"day_pass"}'::jsonb, NULL, 'p2-r0-y1');
  v_y := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('offer_y', v_y);
  v := public.issue_4490_manage_offer('set_pool', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_y, 'poolId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'pool')), (v->>'version')::bigint, 'p2-r0-y2');
  v := public.issue_4490_manage_offer('upsert_price_option', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_y, 'name', 'Day pass', 'unit', 'guest', 'guestMin', 1, 'guestMax', 20, 'priceMinor', 600000),
    (v->>'version')::bigint, 'p2-r0-y3');
  INSERT INTO t4490_ids SELECT 'opt_y', (o->>'id')::uuid FROM jsonb_array_elements(v->'options') o;
  v := public.issue_4490_manage_offer('set_policy', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_y), (v->>'version')::bigint, 'p2-r0-y4');
  v := public.issue_4490_manage_offer('set_schedule', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_y, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6), 'startTime', '00:00', 'endTime', '23:59'),
    (v->>'version')::bigint, 'p2-r0-y5');
  PERFORM public.issue_4490_manage_offer('publish', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_y), (v->>'version')::bigint, 'p2-r0-y6');
  PERFORM public.issue_4490_manage_offer('publish', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer')),
    (SELECT version FROM public.stay_offerings WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer')), 'p2-r0-x6');
  PERFORM public.issue_4490_set_capacity_override('44907000-0000-4000-9000-0000000000a1', (SELECT t.v FROM t4490_ids t WHERE t.k = 'pool'),
    ((now() AT TIME ZONE 'Africa/Lagos')::date + 4), 10, 0, false, false, 'p2-r0-limit');
END
$r0$;
SELECT public.t4490_reset();
CREATE TABLE public.t4490_race (k text PRIMARY KEY, v text);
GRANT ALL ON public.t4490_race TO PUBLIC;
SELECT public.t4490_service();
DO $r1$
DECLARE
  v_date date := ((now() AT TIME ZONE 'Africa/Lagos')::date + 4);
  v_qa jsonb;
  v_qb jsonb;
BEGIN
  v_qa := public.issue_4490_quote_offer((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'),
    (SELECT w.id FROM public.stay_place_windows w WHERE w.offering_id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer') AND w.local_date = v_date),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 10)),
    encode(sha256('cart:race-a'::bytea), 'hex'), NULL, 'p2-race-quote-a');
  v_qb := public.issue_4490_quote_offer((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer_y'),
    (SELECT w.id FROM public.stay_place_windows w WHERE w.offering_id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer_y') AND w.local_date = v_date),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'opt_y'), 'guests', 10)),
    encode(sha256('cart:race-b'::bytea), 'hex'), NULL, 'p2-race-quote-b');
  INSERT INTO public.t4490_race VALUES ('qa', v_qa->>'quoteId'), ('qb', v_qb->>'quoteId'), ('date', v_date::text);
END
$r1$;
SELECT public.t4490_reset();
COMMIT;

-- R-1 two sessions hold the last 10 guests of one pool through two different
-- offers at the same moment: exactly one wins, the other gets offer_sold_out.
DO $race$
DECLARE
  -- TCP loopback (trusted in the pg17 image); the unix socket asks supabase_admin for a password.
  v_conn text := format('dbname=%s user=%s host=127.0.0.1 port=%s', current_database(), current_user,
                        current_setting('port'));
  v_a text;
  v_b text;
  v_b_err text;
  v_busy integer;
BEGIN
  PERFORM dblink_connect('i4490_a', v_conn);
  PERFORM dblink_connect('i4490_b', v_conn);
  PERFORM dblink_exec('i4490_a', $s$SET request.jwt.claims TO '{"role":"service_role"}'$s$);
  PERFORM dblink_exec('i4490_b', $s$SET request.jwt.claims TO '{"role":"service_role"}'$s$);
  PERFORM dblink_send_query('i4490_a', format($q$
    SELECT (public.issue_4490_create_offer_group(gen_random_uuid(), %L::uuid, '{"name":"Race A","email":"race-a@example.test"}'::jsonb,
      encode(sha256('cart:race-a'::bytea), 'hex'), NULL, sha256('tok:race-a'::bytea), 'p2-race-hold-a')->>'groupId')
      || CASE WHEN pg_sleep(1) IS NULL THEN '' ELSE '' END
  $q$, (SELECT v FROM public.t4490_race WHERE k = 'qa')));
  PERFORM pg_sleep(0.2);
  PERFORM dblink_send_query('i4490_b', format($q$
    SELECT public.issue_4490_create_offer_group(gen_random_uuid(), %L::uuid, '{"name":"Race B","email":"race-b@example.test"}'::jsonb,
      encode(sha256('cart:race-b'::bytea), 'hex'), NULL, sha256('tok:race-b'::bytea), 'p2-race-hold-b')->>'groupId'
  $q$, (SELECT v FROM public.t4490_race WHERE k = 'qb')));
  PERFORM pg_sleep(0.2);
  v_busy := dblink_is_busy('i4490_b');
  SELECT r INTO v_a FROM dblink_get_result('i4490_a') AS t(r text);
  BEGIN
    SELECT r INTO v_b FROM dblink_get_result('i4490_b') AS t(r text);
  EXCEPTION WHEN OTHERS THEN
    v_b_err := SQLERRM;
  END;
  PERFORM dblink_disconnect('i4490_a');
  PERFORM dblink_disconnect('i4490_b');
  IF v_busy <> 1 THEN
    RAISE EXCEPTION 'T4490 FAIL: R-1a the second hold did not wait on the pool lock';
  END IF;
  RAISE NOTICE 'PASS  R-1a the second hold waited on the shared pool lock';
  IF v_a IS NULL OR v_b IS NOT NULL OR v_b_err IS NULL OR v_b_err NOT LIKE '%offer_sold_out%' THEN
    RAISE EXCEPTION 'T4490 FAIL: R-1b expected one winner, got A=% B=% err=%', v_a, v_b, v_b_err;
  END IF;
  RAISE NOTICE 'PASS  R-1b exactly one hold won the last 10 guests; the other got offer_sold_out';
END
$race$;
DO $r1c$
BEGIN
  IF (SELECT u.used FROM public.issue_4490_pool_day_usage(
        (SELECT p.id FROM public.venue_capacity_pools p WHERE p.venue_id = '44907000-0000-4000-9000-0000000000a1' AND p.name = 'Gameland day'),
        (SELECT v::date FROM public.t4490_race WHERE k = 'date')) u) <> 10 THEN
    RAISE EXCEPTION 'T4490 FAIL: R-1c the day must hold exactly 10';
  END IF;
  RAISE NOTICE 'PASS  R-1c the day holds exactly 10 guests, never 20';
END
$r1c$;

-- Suite-owned cleanup (#4490). The fixtures were COMMITted for the race, and
-- later suites in the same replayed database reuse the same fixture ids,
-- helper names and slugs. Remove every row whose uuid columns name the
-- fixture namespace (44907000-...), then, round by round, every row that
-- points at a removed row, so nothing this suite made (or left orphaned)
-- survives; drop the helpers and restore the feature flags as they were.
DO $cleanup$
DECLARE
  r record;
  v_cond text;
  v_deleted integer;
  v_total integer;
  v_round integer := 0;
BEGIN
  SET LOCAL session_replication_role = replica;
  CREATE TEMP TABLE t4490_gone (id uuid PRIMARY KEY) ON COMMIT DROP;
  LOOP
    v_round := v_round + 1;
    v_total := 0;
    FOR r IN
      SELECT n.nspname, c.relname,
             array_agg(a.attname::text ORDER BY a.attnum) AS cols,
             bool_or(a.attname = 'id') AS has_id
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        AND a.atttypid = 'uuid'::regtype
      WHERE c.relkind = 'r' AND n.nspname IN ('public', 'auth')
      GROUP BY n.nspname, c.relname
    LOOP
      SELECT string_agg(format('(%1$I::text LIKE %2$L OR %1$I IN (SELECT g.id FROM t4490_gone g))', col, '44907000-%'), ' OR ')
        INTO v_cond FROM unnest(r.cols) col;
      IF r.has_id THEN
        EXECUTE format(
          'WITH d AS (DELETE FROM %I.%I WHERE %s RETURNING id) INSERT INTO t4490_gone SELECT id FROM d WHERE id IS NOT NULL ON CONFLICT DO NOTHING',
          r.nspname, r.relname, v_cond);
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
      ELSE
        EXECUTE format('DELETE FROM %I.%I WHERE %s', r.nspname, r.relname, v_cond);
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
      END IF;
      v_total := v_total + v_deleted;
    END LOOP;
    EXIT WHEN v_total = 0 OR v_round >= 25;
  END LOOP;
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 't4490\_%'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
  FOR r IN
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 't4490\_%'
      AND c.relname <> 't4490_cleanup_flags'
  LOOP
    EXECUTE format('DROP TABLE public.%I', r.relname);
  END LOOP;
  DELETE FROM public.feature_flags f
  USING public.t4490_cleanup_flags s WHERE s.flag_key = f.flag_key AND NOT s.existed;
  UPDATE public.feature_flags f SET is_enabled = s.is_enabled
  FROM public.t4490_cleanup_flags s WHERE s.flag_key = f.flag_key AND s.existed;
  DROP TABLE public.t4490_cleanup_flags;
END
$cleanup$;
