-- #4490 P5-1 race (20281203164490): two real sessions (dblink) (1) pick the same table for overlapping times
-- (19:00 and 19:30) through the guest reservation writer, (2) hold the only bowling lane for the same hour.
-- Exactly one wins each time. COMMITS its fixtures (suite-owned database).
--
-- MINGLA-INVARIANT: I-4490-ONE-TABLE-ONE-PARTY-RACE | issue #4490 | concurrent table picks are serialised by the venue's table lock in pg_create_guest_reservation; the second sees the first and gets table_taken.
-- MINGLA-INVARIANT: I-4490-NO-DOUBLE-HOUR-RACE | issue #4490 | concurrent holds of one by-the-hour unit cannot both hold it: the exclusion constraint on venue_space_claims decides.
--
-- FAILS-ON-REVERT (seen): without the venue table lock the 19:30 pick no longer waits (R-1a).
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

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
  ('44909100-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p5r1-4490@example.test', now(), now());
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44909100-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at)
VALUES ('44909100-0000-4000-9000-000000000010', '44909100-0000-4000-8000-000000000001', 'Harmattan P5 race', 'harmattan-p5r-4490',
        'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44909100-0000-4000-9000-0000000000a1', '44909100-0000-4000-9000-000000000010', 'lanternp5r4490', 'Lantern Race', 6.45, 3.40, 'restaurant', 'verified', 'NG');
INSERT INTO public.venue_availability_config (brand_id, venue_id, iana_timezone, service_periods, turn_times, slot_granularity_minutes, advance_window_days)
VALUES ('44909100-0000-4000-9000-000000000010', '44909100-0000-4000-9000-0000000000a1', 'Africa/Lagos',
        '[{"start":"12:00","end":"23:00","days":[0,1,2,3,4,5,6]}]'::jsonb, '{"p1":90}'::jsonb, 30, 30);
INSERT INTO public.venue_reservation_settings (brand_id, venue_id, reservations_enabled)
VALUES ('44909100-0000-4000-9000-000000000010', '44909100-0000-4000-9000-0000000000a1', true);
CREATE TABLE public.t4490_race (k text PRIMARY KEY, v text);
GRANT ALL ON public.t4490_race TO PUBLIC;
SELECT public.t4490_as('44909100-0000-4000-8000-000000000001');
DO $fx$
DECLARE
  a1 uuid := '44909100-0000-4000-9000-0000000000a1';
  s jsonb;
  v jsonb;
  v_offer uuid;
  i integer;
BEGIN
  s := public.issue_4490_manage_space('create', a1, '{"name":"Dining room","setting":"indoor","capacity_seated":20}'::jsonb, NULL);
  PERFORM public.issue_4490_set_venue_feature(a1, 'pick_a_table', true, NULL, NULL, NULL, 'p5r-pick-feature', true);
  PERFORM public.issue_4490_set_venue_feature(a1, 'by_the_hour', true, NULL, NULL, NULL, 'p5r-hour-feature');
  FOR i IN 1..3 LOOP
    v := public.issue_4490_manage_table('create', a1, jsonb_build_object('name', 'T' || i, 'capacity', 4, 'spaceId', s->>'id'), 'p5r-table-' || i);
    INSERT INTO public.t4490_race VALUES ('t' || i, v->>'id');
  END LOOP;
  s := public.issue_4490_manage_space('create', a1, '{"name":"Lane 1","setting":"indoor","capacity_seated":6}'::jsonb, NULL);
  v := public.issue_4490_manage_offer('create_draft', a1, '{"kind":"by_the_hour","name":"Bowling lane"}'::jsonb, NULL, 'p5r-draft');
  v_offer := (v->>'id')::uuid;
  INSERT INTO public.t4490_race VALUES ('lane', v_offer::text);
  v := public.issue_4490_manage_hour('set_place', a1, jsonb_build_object('offerId', v_offer, 'spaceIds', jsonb_build_array(s->>'id')), (v->>'version')::bigint, 'p5r-place');
  v := public.issue_4490_manage_offer('upsert_price_option', a1, jsonb_build_object('offerId', v_offer, 'name', 'Per hour', 'unit', 'hour',
    'guestMin', 1, 'guestMax', 6, 'priceMinor', 800000), (v->>'version')::bigint, 'p5r-price');
  v := public.issue_4490_manage_offer('set_policy', a1, jsonb_build_object('offerId', v_offer, 'refundLadder', '[]'::jsonb), (v->>'version')::bigint, 'p5r-policy');
  v := public.issue_4490_manage_hour('set_hours', a1, jsonb_build_object('offerId', v_offer, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
    'startTime', '12:00', 'endTime', '23:00'), (v->>'version')::bigint, 'p5r-hours');
  v := public.issue_4490_manage_offer('publish', a1, jsonb_build_object('offerId', v_offer), (v->>'version')::bigint, 'p5r-publish');
  PERFORM public.t4490_ok(v->>'status' = 'live', 'R-0 fixture: 3 tables, a one-lane by-the-hour offer, live');
END
$fx$;
SELECT public.t4490_reset();
-- Two booking windows for the lane race (same hour, two quotes by two carts).
SELECT public.t4490_service();
DO $q$
DECLARE
  v_day date := (now() AT TIME ZONE 'Africa/Lagos')::date + 3;
  w uuid;
  q jsonb;
BEGIN
  w := public.issue_4490_flexible_window((SELECT v::uuid FROM public.t4490_race WHERE k = 'lane'), (v_day + time '18:00') AT TIME ZONE 'Africa/Lagos', 60);
  q := public.issue_4490_quote_offer((SELECT v::uuid FROM public.t4490_race WHERE k = 'lane'), w, '[{"guests":4}]'::jsonb,
    encode(sha256('cart:ra'::bytea), 'hex'), NULL, 'p5r-quote-a');
  INSERT INTO public.t4490_race VALUES ('qa', q->>'quoteId');
  q := public.issue_4490_quote_offer((SELECT v::uuid FROM public.t4490_race WHERE k = 'lane'), w, '[{"guests":4}]'::jsonb,
    encode(sha256('cart:rb'::bytea), 'hex'), NULL, 'p5r-quote-b');
  INSERT INTO public.t4490_race VALUES ('qb', q->>'quoteId');
  INSERT INTO public.t4490_race VALUES ('day', v_day::text);
END
$q$;
SELECT public.t4490_reset();
COMMIT;

-- R-1 two guests pick table T1 at the same moment for overlapping times (19:00 and 19:30).
DO $race1$
DECLARE
  v_conn text := format('dbname=%s user=%s host=127.0.0.1 port=%s', current_database(), current_user, current_setting('port'));
  v_day date := (SELECT v::date FROM public.t4490_race WHERE k = 'day');
  v_t1 uuid := (SELECT v::uuid FROM public.t4490_race WHERE k = 't1');
  v_a text;
  v_b text;
  v_b_err text;
  v_busy integer;
BEGIN
  PERFORM dblink_connect('i4490_ta', v_conn);
  PERFORM dblink_connect('i4490_tb', v_conn);
  PERFORM dblink_exec('i4490_ta', $s$SET request.jwt.claims TO '{"role":"service_role"}'$s$);
  PERFORM dblink_exec('i4490_tb', $s$SET request.jwt.claims TO '{"role":"service_role"}'$s$);
  PERFORM dblink_send_query('i4490_ta', format($q$
    SELECT (public.pg_create_guest_reservation('44909100-0000-4000-9000-0000000000a1', %L::timestamptz, 4, 'website', 'guest', NULL,
      'Race A', NULL, 'ra@example.test', NULL, 'NGN', NULL, 'none', NULL, NULL, NULL, 'confirmed', NULL, ARRAY[%L]::uuid[])).table_id::text
      || CASE WHEN pg_sleep(1) IS NULL THEN '' ELSE '' END
  $q$, (v_day + time '19:00') AT TIME ZONE 'Africa/Lagos', v_t1));
  PERFORM pg_sleep(0.3);
  PERFORM dblink_send_query('i4490_tb', format($q$
    SELECT (public.pg_create_guest_reservation('44909100-0000-4000-9000-0000000000a1', %L::timestamptz, 2, 'website', 'guest', NULL,
      'Race B', NULL, 'rb@example.test', NULL, 'NGN', NULL, 'none', NULL, NULL, NULL, 'confirmed', NULL, ARRAY[%L]::uuid[])).table_id::text
  $q$, (v_day + time '19:30') AT TIME ZONE 'Africa/Lagos', v_t1));
  PERFORM pg_sleep(0.3);
  v_busy := dblink_is_busy('i4490_tb');
  SELECT r INTO v_a FROM dblink_get_result('i4490_ta') AS t(r text);
  BEGIN
    SELECT r INTO v_b FROM dblink_get_result('i4490_tb') AS t(r text);
  EXCEPTION WHEN OTHERS THEN
    v_b_err := SQLERRM;
  END;
  PERFORM dblink_disconnect('i4490_ta');
  PERFORM dblink_disconnect('i4490_tb');
  IF v_busy <> 1 THEN
    RAISE EXCEPTION 'T4490 FAIL: R-1a the second pick did not wait on the first (table lock)';
  END IF;
  RAISE NOTICE 'PASS  R-1a the second pick (19:30) waited on the first session''s table lock';
  IF v_a IS DISTINCT FROM v_t1::text OR v_b IS NOT NULL OR v_b_err IS NULL OR v_b_err NOT LIKE '%table_taken%' THEN
    RAISE EXCEPTION 'T4490 FAIL: R-1b expected one winner, got A=% B=% err=%', v_a, v_b, v_b_err;
  END IF;
  RAISE NOTICE 'PASS  R-1b exactly one guest got T1 (19:00); the 19:30 pick got table_taken';
END
$race1$;
DO $r1c$
BEGIN
  IF (SELECT count(*) FROM public.reservations WHERE table_id = (SELECT v::uuid FROM public.t4490_race WHERE k = 't1')
        AND status = 'confirmed') <> 1 THEN
    RAISE EXCEPTION 'T4490 FAIL: R-1c T1 must hold exactly one booking';
  END IF;
  RAISE NOTICE 'PASS  R-1c T1 holds exactly one booking';
END
$r1c$;

-- R-2 two guests hold the one bowling lane for the same hour at the same moment.
DO $race2$
DECLARE
  v_conn text := format('dbname=%s user=%s host=127.0.0.1 port=%s', current_database(), current_user, current_setting('port'));
  v_a text;
  v_b text;
  v_b_err text;
  v_busy integer;
BEGIN
  PERFORM dblink_connect('i4490_la', v_conn);
  PERFORM dblink_connect('i4490_lb', v_conn);
  PERFORM dblink_exec('i4490_la', $s$SET request.jwt.claims TO '{"role":"service_role"}'$s$);
  PERFORM dblink_exec('i4490_lb', $s$SET request.jwt.claims TO '{"role":"service_role"}'$s$);
  PERFORM dblink_send_query('i4490_la', format($q$
    SELECT (public.issue_4490_create_offer_group(gen_random_uuid(), %L::uuid, '{"name":"Lane A","email":"la@example.test"}'::jsonb,
      encode(sha256('cart:ra'::bytea), 'hex'), NULL, sha256('tok:la'::bytea), 'p5r-hold-a')->>'state')
      || CASE WHEN pg_sleep(1) IS NULL THEN '' ELSE '' END
  $q$, (SELECT v FROM public.t4490_race WHERE k = 'qa')));
  PERFORM pg_sleep(0.3);
  PERFORM dblink_send_query('i4490_lb', format($q$
    SELECT public.issue_4490_create_offer_group(gen_random_uuid(), %L::uuid, '{"name":"Lane B","email":"lb@example.test"}'::jsonb,
      encode(sha256('cart:rb'::bytea), 'hex'), NULL, sha256('tok:lb'::bytea), 'p5r-hold-b')->>'state'
  $q$, (SELECT v FROM public.t4490_race WHERE k = 'qb')));
  PERFORM pg_sleep(0.3);
  v_busy := dblink_is_busy('i4490_lb');
  SELECT r INTO v_a FROM dblink_get_result('i4490_la') AS t(r text);
  BEGIN
    SELECT r INTO v_b FROM dblink_get_result('i4490_lb') AS t(r text);
  EXCEPTION WHEN OTHERS THEN
    v_b_err := SQLERRM;
  END;
  PERFORM dblink_disconnect('i4490_la');
  PERFORM dblink_disconnect('i4490_lb');
  IF v_busy <> 1 THEN
    RAISE EXCEPTION 'T4490 FAIL: R-2a the second hold did not wait on the first one''s claim';
  END IF;
  RAISE NOTICE 'PASS  R-2a the second hold waited on the first session''s uncommitted lane claim (exclusion check)';
  IF v_a IS DISTINCT FROM 'instant_payment_pending' OR v_b IS NOT NULL OR v_b_err IS NULL OR v_b_err NOT LIKE '%offer_space_taken%' THEN
    RAISE EXCEPTION 'T4490 FAIL: R-2b expected one winner, got A=% B=% err=%', v_a, v_b, v_b_err;
  END IF;
  RAISE NOTICE 'PASS  R-2b exactly one guest holds the lane 18:00-19:00; the other got offer_space_taken';
END
$race2$;
DO $r2c$
BEGIN
  IF (SELECT count(*) FROM public.venue_space_claims c JOIN public.venue_spaces s ON s.id = c.space_id
      WHERE s.name = 'Lane 1' AND s.venue_id = '44909100-0000-4000-9000-0000000000a1' AND c.state = 'held') <> 1 THEN
    RAISE EXCEPTION 'T4490 FAIL: R-2c the lane must be held exactly once';
  END IF;
  RAISE NOTICE 'PASS  R-2c the lane is held exactly once';
END
$r2c$;

-- Suite-owned cleanup (#4490). The fixtures were COMMITted for the race, and
-- later suites in the same replayed database reuse the same fixture ids,
-- helper names and slugs. Remove every row whose uuid columns name the
-- fixture namespace (44909100-...), then, round by round, every row that
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
      SELECT string_agg(format('(%1$I::text LIKE %2$L OR %1$I IN (SELECT g.id FROM t4490_gone g))', col, '44909100-%'), ' OR ')
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
