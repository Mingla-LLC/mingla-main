-- #4490 P4-1 race (20281203154490): two real sessions (dblink) approve hire requests for Half Green and
-- Whole Green (a combination containing Half Green) on the same evening at the same moment; the venue has
-- no day-limit pool, so nothing but the space-claim exclusion constraint stands between them. Exactly one
-- wins; the other gets PT409 offer_space_taken. COMMITS its fixtures (suite-owned database).
--
-- MINGLA-INVARIANT: I-4490-NO-DOUBLE-HIRE-RACE | issue #4490 | concurrent approvals of overlapping spaces cannot both hold the space: the exclusion constraint on venue_space_claims decides, never a read-then-write check.
--
-- FAILS-ON-REVERT (seen): drop venue_space_claims_no_overlap -> R-2a (the second approval no longer waits; both win).
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
CREATE TEMP TABLE t4490_ids (k text PRIMARY KEY, v uuid);
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

-- ===========================================================================
-- Checkout helpers (service role; they mirror what edge venue-offers does).
-- ===========================================================================
CREATE FUNCTION public.t4490_win(p_offer uuid, p_date date)
RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM public.stay_place_windows WHERE offering_id = p_offer AND local_date = p_date ORDER BY starts_at LIMIT 1;
$f$;
CREATE FUNCTION public.t4490_key(p_seed text)
RETURNS text LANGUAGE sql AS $f$ SELECT encode(sha256(convert_to(p_seed, 'UTF8')), 'hex') $f$;
CREATE FUNCTION public.t4490_buy(p_offer uuid, p_date date, p_lines jsonb, p_seed text, p_email text DEFAULT 'buyer-4490@example.test')
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_q jsonb;
  v_g jsonb;
BEGIN
  v_q := public.issue_4490_quote_offer(p_offer, public.t4490_win(p_offer, p_date), p_lines,
    public.t4490_key('cart:' || p_seed), NULL, 'quote-' || p_seed);
  v_g := public.issue_4490_create_offer_group(gen_random_uuid(), (v_q->>'quoteId')::uuid,
    jsonb_build_object('name', 'Guest ' || p_seed, 'email', p_email), public.t4490_key('cart:' || p_seed), NULL,
    sha256(convert_to('tok:' || p_seed, 'UTF8')), 'hold-' || p_seed);
  RETURN (v_g->>'groupId')::uuid;
END
$f$;
-- Pay: prepare + bind + finalize (the webhook / confirm_return path).
CREATE FUNCTION public.t4490_pay(p_group uuid, p_seed text)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_p jsonb;
  v_ref text;
BEGIN
  v_p := public.issue_4490_prepare_offer_payment(p_group, sha256(convert_to('tok:' || p_seed, 'UTF8')), NULL, 'pay-key-' || p_seed,
    (SELECT version FROM public.stay_reservation_groups WHERE id = p_group));
  v_ref := 'mingla_stay_' || replace(v_p->>'attemptId', '-', '');
  PERFORM public.issue_1389_bind_payment_attempt((v_p->>'attemptId')::uuid, v_ref, NULL, NULL);
  RETURN public.issue_1389_finalize_payment('paystack', 'evt-' || p_seed, 'charge.success', v_ref, 'ch-' || p_seed,
    (v_p->>'amountMinor')::bigint, 'NGN', 0, NULL);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490_win(uuid, date), public.t4490_key(text), public.t4490_buy(uuid, date, jsonb, text, text),
  public.t4490_pay(uuid, text) TO PUBLIC;

-- Publish the fixture offer, add a very expensive option for the cap check.
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
DO $pub$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_manage_offer('upsert_price_option', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), 'name', 'Whole floor buyout', 'unit', 'guest',
      'guestMin', 1, 'guestMax', 1, 'priceMinor', 2147483648),
    (SELECT version FROM public.stay_offerings WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer')), 'p2-c-cap-opt');
  INSERT INTO t4490_ids SELECT 'buyout', (o->>'id')::uuid FROM jsonb_array_elements(v->'options') o WHERE o->>'name' = 'Whole floor buyout';
  v := public.issue_4490_save_booking_settings('44907000-0000-4000-9000-0000000000a1', '{"vatMode":"added"}'::jsonb, NULL, 'p2-c-vat-added');
  v := public.issue_4490_manage_offer('publish', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer')),
    (SELECT version FROM public.stay_offerings WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer')), 'p2-c-pub');
  INSERT INTO t4490_ids VALUES ('today', NULL);
END
$pub$;
SELECT public.t4490_reset();
CREATE TEMP TABLE t4490_dates AS
SELECT public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') AS today,
       (SELECT min(d)::date FROM generate_series(public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 5,
          public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 11, interval '1 day') d
        WHERE extract(isodow FROM d) = 6) AS saturday,
       (SELECT min(d)::date FROM generate_series(public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 12,
          public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 18, interval '1 day') d
        WHERE extract(isodow FROM d) = 6) AS next_saturday,
       (SELECT min(d)::date FROM generate_series(public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 2,
          public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 9, interval '1 day') d
        WHERE extract(isodow FROM d) = 3) AS wednesday;
GRANT SELECT ON t4490_dates TO PUBLIC;

-- Pay helpers: a chosen pay mode, and a balance payment with the booking token.
CREATE FUNCTION public.t4490_pay_mode(p_group uuid, p_seed text, p_mode text)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_p jsonb;
  v_ref text;
BEGIN
  v_p := public.issue_4490_prepare_offer_payment(p_group, sha256(convert_to('tok:' || p_seed, 'UTF8')), NULL,
    'pay-' || p_mode || '-' || p_seed || '-' || (SELECT version FROM public.stay_reservation_groups WHERE id = p_group),
    (SELECT version FROM public.stay_reservation_groups WHERE id = p_group), p_mode);
  v_ref := 'mingla_stay_' || replace(v_p->>'attemptId', '-', '');
  PERFORM public.issue_1389_bind_payment_attempt((v_p->>'attemptId')::uuid, v_ref, NULL, NULL);
  PERFORM public.issue_1389_finalize_payment('paystack', 'evt-' || (v_p->>'attemptId'), 'charge.success', v_ref,
    'ch-' || (v_p->>'attemptId'), (v_p->>'amountMinor')::bigint, 'NGN', 0, NULL);
  RETURN v_p;
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490_pay_mode(uuid, text, text) TO PUBLIC;

-- Arcade P2 (no day-limit pool): Half Green (120), Other Half (120), Whole Green = both.
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
DO $rs$
DECLARE
  v jsonb;
  v_offer uuid;
  a2 constant uuid := '44907000-0000-4000-9000-0000000000a2';
  v_half uuid;
  v_other uuid;
  v_whole uuid;
BEGIN
  v_half := (public.issue_4490_manage_space('create', a2, '{"name":"Half Green","setting":"outdoor","capacity_standing":120}'::jsonb)->>'id')::uuid;
  v_other := (public.issue_4490_manage_space('create', a2, '{"name":"Other Half","setting":"outdoor","capacity_standing":120}'::jsonb)->>'id')::uuid;
  v_whole := (public.issue_4490_manage_space_combination('create', a2,
    jsonb_build_object('name', 'Whole Green', 'space_ids', jsonb_build_array(v_half, v_other)))->>'id')::uuid;
  PERFORM public.issue_4490_set_venue_feature(a2, 'private_hire', true, NULL, NULL, NULL, 'p4-race-feature');
  v := public.issue_4490_manage_offer('create_draft', a2, '{"kind":"private_hire","name":"Hire the green"}'::jsonb, NULL, 'p4-race-draft');
  v_offer := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('rhire', v_offer), ('rhalf', v_half);
  v := public.issue_4490_manage_hire('set_spaces', a2, jsonb_build_object('offerId', v_offer,
    'spaceIds', jsonb_build_array(v_half, v_other), 'combinationIds', jsonb_build_array(v_whole)), (v->>'version')::bigint, 'p4-race-spaces');
  v := public.issue_4490_manage_hire('set_price_row', a2, jsonb_build_object('offerId', v_offer, 'name', 'Half Green',
    'spaceId', v_half, 'unit', 'booking', 'guestMin', 10, 'guestMax', 120, 'priceMinor', 100000000), (v->>'version')::bigint, 'p4-race-r1');
  v := public.issue_4490_manage_hire('set_price_row', a2, jsonb_build_object('offerId', v_offer, 'name', 'Whole Green',
    'combinationId', v_whole, 'unit', 'booking', 'guestMin', 50, 'guestMax', 240, 'priceMinor', 180000000), (v->>'version')::bigint, 'p4-race-r2');
  INSERT INTO t4490_ids SELECT CASE r->>'name' WHEN 'Half Green' THEN 'rhalf_opt' ELSE 'rwhole_opt' END, (r->>'optionId')::uuid
    FROM jsonb_array_elements(v->'hire'->'rows') r;
  v := public.issue_4490_manage_hire('set_sessions', a2, jsonb_build_object('offerId', v_offer,
    'sessions', jsonb_build_array(jsonb_build_object('label', 'Evening', 'startTime', '18:00', 'endTime', '23:00')),
    'weekdays', jsonb_build_array(0, 1, 2, 3, 4, 5, 6)), (v->>'version')::bigint, 'p4-race-sessions');
  v := public.issue_4490_manage_offer('set_policy', a2, jsonb_build_object('offerId', v_offer), (v->>'version')::bigint, 'p4-race-policy');
  v := public.issue_4490_manage_offer('publish', a2, jsonb_build_object('offerId', v_offer), (v->>'version')::bigint, 'p4-race-publish');
END
$rs$;
SELECT public.t4490_reset();
CREATE TABLE public.t4490_race (k text PRIMARY KEY, v text);
GRANT ALL ON public.t4490_race TO PUBLIC;
SELECT public.t4490_service();
DO $rq$
DECLARE
  v_date date := public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a2') + 30;
  v_win uuid;
  v_q jsonb;
  v_g jsonb;
  v_seed text;
  v_opt text;
BEGIN
  SELECT w.id INTO v_win FROM public.stay_place_windows w
  WHERE w.offering_id = (SELECT v FROM t4490_ids WHERE k = 'rhire') AND w.local_date = v_date;
  FOREACH v_seed IN ARRAY ARRAY['a', 'b'] LOOP
    v_opt := CASE v_seed WHEN 'a' THEN 'rhalf_opt' ELSE 'rwhole_opt' END;
    v_q := public.issue_4490_quote_offer((SELECT v FROM t4490_ids WHERE k = 'rhire'), v_win,
      jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT v FROM t4490_ids WHERE k = v_opt), 'guests', 100)),
      public.t4490_key('cart:race-' || v_seed), NULL, 'rquote-key-' || v_seed);
    v_g := public.issue_4490_create_offer_group(gen_random_uuid(), (v_q->>'quoteId')::uuid,
      jsonb_build_object('name', 'Race ' || v_seed, 'email', 'race-' || v_seed || '@example.test'),
      public.t4490_key('cart:race-' || v_seed), NULL, sha256(convert_to('tok:race-' || v_seed, 'UTF8')), 'rhold-key-' || v_seed);
    INSERT INTO public.t4490_race VALUES ('g' || v_seed, v_g->>'groupId'), ('v' || v_seed, v_g->>'version');
  END LOOP;
  INSERT INTO public.t4490_race VALUES ('half', (SELECT v FROM t4490_ids WHERE k = 'rhalf')::text);
END
$rq$;
SELECT public.t4490_reset();
SELECT public.t4490_ok((SELECT count(*) FROM public.venue_capacity_pools WHERE venue_id = '44907000-0000-4000-9000-0000000000a2') = 0,
  'R-2 setup: the venue has no day-limit pool (only the exclusion constraint can decide)');
COMMIT;

DO $race$
DECLARE
  v_conn text := format('dbname=%s user=%s host=127.0.0.1 port=%s', current_database(), current_user,
                        current_setting('port'));
  v_a text;
  v_b text;
  v_b_err text;
  v_busy integer;
BEGIN
  PERFORM dblink_connect('i4490_ha', v_conn);
  PERFORM dblink_connect('i4490_hb', v_conn);
  PERFORM dblink_exec('i4490_ha', $s$SET request.jwt.claims TO '{"role":"service_role"}'$s$);
  PERFORM dblink_exec('i4490_hb', $s$SET request.jwt.claims TO '{"role":"service_role"}'$s$);
  PERFORM dblink_send_query('i4490_ha', format($q$
    SELECT (public.issue_4490_manage_request_for('44907000-0000-4000-8000-000000000001'::uuid, %L::uuid, 'approve', '{}'::jsonb,
      %s, 'p4-race-approve-a')->>'state') || CASE WHEN pg_sleep(1) IS NULL THEN '' ELSE '' END
  $q$, (SELECT v FROM public.t4490_race WHERE k = 'ga'), (SELECT v FROM public.t4490_race WHERE k = 'va')));
  PERFORM pg_sleep(0.3);
  PERFORM dblink_send_query('i4490_hb', format($q$
    SELECT public.issue_4490_manage_request_for('44907000-0000-4000-8000-000000000001'::uuid, %L::uuid, 'approve', '{}'::jsonb,
      %s, 'p4-race-approve-b')->>'state'
  $q$, (SELECT v FROM public.t4490_race WHERE k = 'gb'), (SELECT v FROM public.t4490_race WHERE k = 'vb')));
  PERFORM pg_sleep(0.3);
  v_busy := dblink_is_busy('i4490_hb');
  SELECT r INTO v_a FROM dblink_get_result('i4490_ha') AS t(r text);
  BEGIN
    SELECT r INTO v_b FROM dblink_get_result('i4490_hb') AS t(r text);
  EXCEPTION WHEN OTHERS THEN
    v_b_err := SQLERRM;
  END;
  PERFORM dblink_disconnect('i4490_ha');
  PERFORM dblink_disconnect('i4490_hb');
  IF v_busy <> 1 THEN
    RAISE EXCEPTION 'T4490 FAIL: R-2a the second approval did not wait on the first one''s claim';
  END IF;
  RAISE NOTICE 'PASS  R-2a the second approval waited on the first session''s uncommitted claim (exclusion check)';
  IF v_a IS DISTINCT FROM 'approved_payment_required' OR v_b IS NOT NULL OR v_b_err IS NULL
     OR v_b_err NOT LIKE '%offer_space_taken%' THEN
    RAISE EXCEPTION 'T4490 FAIL: R-2b expected one winner, got A=% B=% err=%', v_a, v_b, v_b_err;
  END IF;
  RAISE NOTICE 'PASS  R-2b exactly one approval took Half Green; Whole Green got offer_space_taken';
END
$race$;
DO $r2c$
BEGIN
  IF (SELECT count(*) FROM public.venue_space_claims WHERE state = 'held'
      AND space_id = (SELECT v::uuid FROM public.t4490_race WHERE k = 'half')) <> 1
     OR (SELECT state FROM public.stay_reservation_groups WHERE id = (SELECT v::uuid FROM public.t4490_race WHERE k = 'gb')) <> 'request_pending' THEN
    RAISE EXCEPTION 'T4490 FAIL: R-2c Half Green must be held exactly once and the loser still waiting';
  END IF;
  RAISE NOTICE 'PASS  R-2c Half Green is held once; the losing request is still to answer (it can be queued)';
END
$r2c$;

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
