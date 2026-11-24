-- #4490 P2-2 (checkout and cancel, 20281203084490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-POOL-CAPACITY | issue #4490 | online sales never use the kept-for-walk-ins seats; the gate can sell up to the day limit; every hold re-checks the pool under its row lock.
-- MINGLA-INVARIANT: I-4490-PAYMENT-CAP | issue #4490 | a single payment above 2,147,483,647 minor units is refused with offer_amount_too_large before anything is held or charged.
-- MINGLA-INVARIANT: I-4490-CANCEL-EVERY-PAYMENT | issue #4490 | cancelling a venue booking refunds every succeeded payment at the snapshotted ladder (guest) or the operator rate (staff with money rights), releases the seats and marks the pass refunded.
--
-- C-1 totals (VAT added / included; the D P2-6 basket = N15,050). C-2 weekday rule. C-3 cap.
-- C-4 signed-out token path: quote, hold, pay, finalize, pass, read, wrong token; two unbound attempts.
-- C-5 public page offers. C-6 capacity 300 / 50. C-7 hold expiry + late payment. C-8 cancel ladder, staff rate, permissions.
--
-- FAILS-ON-REVERT: count gate usage as online in issue_4490_pool_day_usage -> C-6d; drop the cap check -> C-3.
\set ON_ERROR_STOP on
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
CREATE TEMP TABLE t4490_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
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
CREATE TEMP TABLE t4490_dates ON COMMIT DROP AS
SELECT public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') AS today,
       (SELECT min(d)::date FROM generate_series(public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 2,
          public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 9, interval '1 day') d
        WHERE extract(isodow FROM d) = 3) AS wednesday,
       (SELECT min(d)::date FROM generate_series(public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 2,
          public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 9, interval '1 day') d
        WHERE extract(isodow FROM d) = 5) AS friday;
GRANT SELECT ON t4490_dates TO PUBLIC;

-- ===========================================================================
-- C-1 totals: VAT added; the D P2-6 basket (2 Walk-in + 1 Student) = N15,050.
-- ===========================================================================
SELECT public.t4490_service();
DO $c1$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_quote_offer((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'),
    public.t4490_win((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT wednesday FROM t4490_dates)),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 3)),
    public.t4490_key('cart:c1'), NULL, 'p2-c1-q1');
  PERFORM public.t4490_ok((v->>'subtotalMinor')::bigint = 1500000 AND (v->>'taxMinor')::bigint = 112500
      AND (v->>'totalMinor')::bigint = 1612500 AND v->'vat'->>'mode' = 'added',
    'C-1a VAT added: N5,000 x 3 = 15,000 + 1,125 VAT = 16,125 (' || (v->>'totalMinor') || ')');
  v := public.issue_4490_quote_offer((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'),
    public.t4490_win((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT wednesday FROM t4490_dates)),
    jsonb_build_array(
      jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 2),
      jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'student'), 'guests', 1)),
    public.t4490_key('cart:c1b'), NULL, 'p2-c1-q2');
  PERFORM public.t4490_ok((v->>'subtotalMinor')::bigint = 1400000 AND (v->>'taxMinor')::bigint = 105000
      AND (v->>'totalMinor')::bigint = 1505000,
    'C-1b 2 Walk-in + 1 Student on a Wednesday = 14,000 + VAT 1,050 = 15,050');
  PERFORM public.t4490_ok(jsonb_array_length(v->'lines') = 2
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'lines') l WHERE l->>'idCheckLabel' = 'Student or NYSC ID'),
    'C-1c the quote names the ID check on the Student line');
END
$c1$;

-- VAT included: tax line marked included, total = base.
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT (public.issue_4490_save_booking_settings('44907000-0000-4000-9000-0000000000a1', '{"vatMode":"included"}'::jsonb, NULL, 'p2-c-vat-incl')->>'vatMode') AS vat;
SELECT public.t4490_service();
DO $c1c$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_quote_offer((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'),
    public.t4490_win((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT wednesday FROM t4490_dates)),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 3)),
    public.t4490_key('cart:c1c'), NULL, 'p2-c1-q3');
  PERFORM public.t4490_ok((v->>'totalMinor')::bigint = 1500000 AND (v->>'taxMinor')::bigint = 0
      AND v->'vat'->>'mode' = 'included' AND (v->'vat'->>'amountMinor')::bigint = 104651,
    'C-1d VAT included: total 15,000, VAT inside it 1,046.51, nothing added');
END
$c1c$;
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT (public.issue_4490_save_booking_settings('44907000-0000-4000-9000-0000000000a1', '{"vatMode":"added"}'::jsonb, NULL, 'p2-c-vat-added2')->>'vatMode') AS vat;

-- ===========================================================================
-- C-2 weekday rule; C-3 cap; availability.
-- ===========================================================================
SELECT public.t4490_as(NULL);
SELECT public.t4490_ok((SELECT status FROM public.pg_venue_offer_availability((SELECT v FROM t4490_ids WHERE k = 'offer'),
    (SELECT friday FROM t4490_dates), (SELECT friday FROM t4490_dates), 1, (SELECT v FROM t4490_ids WHERE k = 'student'))) = 'wrong_weekday',
  'C-2a availability (anon): the Student option on a Friday -> wrong_weekday');
SELECT public.t4490_ok((SELECT status FROM public.pg_venue_offer_availability((SELECT v FROM t4490_ids WHERE k = 'offer'),
    (SELECT wednesday FROM t4490_dates), (SELECT wednesday FROM t4490_dates), 3, NULL)) = 'available',
  'C-2b availability: Wednesday is available');
SELECT public.t4490_ok((SELECT price_minor FROM public.pg_venue_offer_availability((SELECT v FROM t4490_ids WHERE k = 'offer'),
    (SELECT friday FROM t4490_dates), (SELECT friday FROM t4490_dates), 1, NULL)) = 500000,
  'C-2c the from-price on a Friday ignores the Mon-Thu option (N5,000)');
SELECT public.t4490_service();
SELECT public.t4490_expect(format($$SELECT public.issue_4490_quote_offer(%L, public.t4490_win(%L, (SELECT friday FROM t4490_dates)),
  jsonb_build_array(jsonb_build_object('priceOptionId', %L, 'guests', 1)), public.t4490_key('cart:c2'), NULL, 'p2-c2-quote')$$,
  (SELECT v FROM t4490_ids WHERE k = 'offer'), (SELECT v FROM t4490_ids WHERE k = 'offer'), (SELECT v FROM t4490_ids WHERE k = 'student')),
  'PT409', 'offer_wrong_weekday', 'C-2d quoting the Student option on a Friday is refused');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_quote_offer(%L, public.t4490_win(%L, (SELECT wednesday FROM t4490_dates)),
  jsonb_build_array(jsonb_build_object('priceOptionId', %L, 'guests', 1)), public.t4490_key('cart:c3'), NULL, 'p2-c3-quote')$$,
  (SELECT v FROM t4490_ids WHERE k = 'offer'), (SELECT v FROM t4490_ids WHERE k = 'offer'), (SELECT v FROM t4490_ids WHERE k = 'buyout')),
  'P0001', 'offer_amount_too_large', 'C-3 a single payment above 2,147,483,647 minor units is refused (offer_amount_too_large)');

-- ===========================================================================
-- C-4 signed-out token path, idempotency, pay, confirm, pass, read.
-- ===========================================================================
DO $c4$
DECLARE
  v_q jsonb;
  v_q2 jsonb;
  v_g jsonb;
  v_g2 jsonb;
  v_gid uuid := gen_random_uuid();
  v_win uuid := public.t4490_win((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT wednesday FROM t4490_dates));
  v_lines jsonb := jsonb_build_array(
      jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 2),
      jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'student'), 'guests', 1));
  v_p jsonb;
  v_f jsonb;
  v_b jsonb;
BEGIN
  v_q := public.issue_4490_quote_offer((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), v_win, v_lines,
    public.t4490_key('cart:c4'), NULL, 'p2-c4-quote');
  v_q2 := public.issue_4490_quote_offer((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), v_win, v_lines,
    public.t4490_key('cart:c4'), NULL, 'p2-c4-quote');
  PERFORM public.t4490_ok(v_q->>'quoteId' = v_q2->>'quoteId', 'C-4a a quote replay returns the same quote');
  v_g := public.issue_4490_create_offer_group(v_gid, (v_q->>'quoteId')::uuid,
    '{"name":"Stranger Guest","email":"stranger-4490@example.test","phone":"+2348031234567","phoneCountryIso":"NG"}'::jsonb,
    public.t4490_key('cart:c4'), NULL, sha256('tok:c4'::bytea), 'p2-c4-hold');
  v_g2 := public.issue_4490_create_offer_group(gen_random_uuid(), (v_q->>'quoteId')::uuid,
    '{"name":"Stranger Guest","email":"stranger-4490@example.test","phone":"+2348031234567","phoneCountryIso":"NG"}'::jsonb,
    public.t4490_key('cart:c4'), NULL, sha256('tok:c4'::bytea), 'p2-c4-hold');
  PERFORM public.t4490_ok(v_g->>'groupId' = v_gid::text AND v_g2->>'groupId' = v_gid::text,
    'C-4b a signed-out hold is created with the edge-chosen id, and a replay returns it');
  PERFORM public.t4490_ok(v_g->>'state' = 'instant_payment_pending' AND (v_g->>'amountDueNowMinor')::bigint = 1505000
      AND v_g->>'holdUntil' IS NOT NULL, 'C-4c the hold says what to pay now and until when');
  PERFORM public.t4490_ok((SELECT user_id IS NULL AND buyer_token_hash = sha256('tok:c4'::bytea)
      FROM public.stay_reservation_groups WHERE id = v_gid), 'C-4d no user, only the token hash is stored');
  BEGIN
    PERFORM public.issue_4490_prepare_offer_payment(v_gid, sha256('wrong'::bytea), NULL, 'p2-c4-pay-wrong', 1);
    RAISE EXCEPTION 'T4490 FAIL: C-4e';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    PERFORM public.t4490_ok(SQLERRM = 'offer_booking_not_found', 'C-4e the wrong token cannot pay (offer_booking_not_found)');
  END;
  v_p := public.issue_4490_prepare_offer_payment(v_gid, sha256('tok:c4'::bytea), NULL, 'p2-c4-pay', 1);
  PERFORM public.t4490_ok(v_p->>'provider' = 'paystack' AND (v_p->>'amountMinor')::bigint = 1505000 AND v_p->>'stage' = 'full'
      AND v_p->>'buyerEmail' = 'stranger-4490@example.test' AND (v_p->>'applicationFeeMinor')::bigint > 0,
    'C-4f prepare: Paystack, full stage, N15,050, the buyer''s email');
  PERFORM public.t4490_ok((SELECT sum(charged_minor) FROM public.stay_payment_allocations
      WHERE payment_attempt_id = (v_p->>'attemptId')::uuid) = 1505000, 'C-4g allocations sum to the charge');
  PERFORM public.issue_1389_bind_payment_attempt((v_p->>'attemptId')::uuid, 'mingla_stay_' || replace(v_p->>'attemptId', '-', ''), NULL, NULL);
  v_f := public.issue_1389_finalize_payment('paystack', 'evt-c4', 'charge.success', 'mingla_stay_' || replace(v_p->>'attemptId', '-', ''),
    'ch-c4', 1505000, 'NGN', 0, NULL);
  v_f := public.issue_1389_finalize_payment('paystack', 'evt-c4-return', 'charge.success', 'mingla_stay_' || replace(v_p->>'attemptId', '-', ''),
    'ch-c4', 1505000, 'NGN', 0, NULL);
  PERFORM public.t4490_ok(v_f->>'state' = 'succeeded', 'C-4h the existing finalize confirms the payment (and a second confirm is a no-op)');
  v_b := public.issue_4490_get_offer_booking(v_gid, sha256('tok:c4'::bytea), NULL, repeat('p', 40));
  PERFORM public.t4490_ok(v_b->>'state' = 'confirmed' AND (v_b->>'paidMinor')::bigint = 1505000,
    'C-4i the booking is confirmed and paid');
  PERFORM public.t4490_ok(jsonb_array_length(v_b->'passes') = 1 AND (v_b->'passes'->0->>'admits')::int = 3
      AND v_b->'passes'->0->>'idCheckLabel' = 'Student or NYSC ID' AND (v_b->'passes'->0->>'idCheckCount')::int = 1
      AND v_b->'passes'->0->>'qrPayload' ~ ('^mingla:v1:vpass:' || (v_b->'passes'->0->>'passId') || ':sig:[a-f0-9]{64}$'),
    'C-4j one pass for the party: admits 3, one ID check, a signed QR');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.notification_outbox
      WHERE category_key = 'venue_booking_confirmed' AND payload->>'venue_group_id' = v_gid::text
        AND contact = 'stranger-4490@example.test') = 1,
    'C-4k a venue_booking_confirmed email is queued for the buyer (no link in the row; built at send time)');
  INSERT INTO t4490_ids VALUES ('c4_group', v_gid);
  BEGIN
    PERFORM public.issue_4490_get_offer_booking(v_gid, sha256('nope'::bytea), NULL, NULL);
    RAISE EXCEPTION 'T4490 FAIL: C-4l';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    PERFORM public.t4490_ok(true, 'C-4l a wrong token cannot read the booking');
  END;
END
$c4$;
SELECT public.t4490_reset();

-- Public page now lists the live entry offer with the venue VAT.
SELECT public.t4490_as(NULL);
SELECT public.t4490_ok((SELECT jsonb_array_length(p->'offers') = 1 AND p->'offers'->0->>'kind' = 'entry'
      AND p->'offers'->0->>'entryStyle' = 'walk_in' AND (p->'offers'->0->>'fromMinor')::bigint = 400000
      AND p->'vat'->>'mode' = 'added' AND (p->'vat'->>'ratePct')::numeric = 7.5
      AND p->'features' ? 'entry'
    FROM public.pg_public_venue_page('harmattan-p2-4490', 'gamelandp24490') p),
  'C-5 the public page lists the live entry offer (from N4,000) and VAT 7.5% added');
SELECT public.t4490_reset();

-- C-4m two buyers preparing at the same time (both unbound) do not collide.
SELECT public.t4490_service();
DO $c4m$
DECLARE
  v_a uuid;
  v_b uuid;
BEGIN
  v_a := public.t4490_buy((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT wednesday FROM t4490_dates),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 1)), 'c4m-a');
  v_b := public.t4490_buy((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT wednesday FROM t4490_dates),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 1)), 'c4m-b');
  PERFORM public.issue_4490_prepare_offer_payment(v_a, sha256(convert_to('tok:c4m-a', 'UTF8')), NULL, 'pay-key-c4m-a', 1);
  PERFORM public.issue_4490_prepare_offer_payment(v_b, sha256(convert_to('tok:c4m-b', 'UTF8')), NULL, 'pay-key-c4m-b', 1);
  PERFORM public.t4490_ok((SELECT count(*) FROM public.stay_payment_attempts
      WHERE group_id IN (v_a, v_b) AND provider_payment_ref IS NULL) = 2,
    'C-4m two unbound payment attempts no longer collide on a NULL provider reference');
END
$c4m$;
SELECT public.t4490_reset();

-- ===========================================================================
-- C-6 capacity with kept-for-walk-ins: pool 300 / 50 today.
-- ===========================================================================
SELECT public.t4490_service();
DO $c6$
DECLARE
  i integer;
  v_g uuid;
  v_u record;
BEGIN
  FOR i IN 1..12 LOOP
    v_g := public.t4490_buy((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT today FROM t4490_dates),
      jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 20)), 'c6-' || i);
  END LOOP;
  v_g := public.t4490_buy((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT today FROM t4490_dates),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 10)), 'c6-13');
  SELECT * INTO v_u FROM public.issue_4490_pool_day_usage((SELECT t.v FROM t4490_ids t WHERE t.k = 'pool'), (SELECT today FROM t4490_dates));
  PERFORM public.t4490_ok(v_u.used = 250 AND v_u.online_left = 0 AND v_u.gate_left = 50 AND v_u.kept_left = 50,
    'C-6a online sells 250 of 300 (50 kept for walk-ins): online 0 left, gate 50 left');
  BEGIN
    PERFORM public.t4490_buy((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT today FROM t4490_dates),
      jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 1)), 'c6-251');
    RAISE EXCEPTION 'T4490 FAIL: C-6b';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    PERFORM public.t4490_ok(SQLERRM = 'offer_sold_out', 'C-6b the 251st online guest gets PT409 offer_sold_out');
  END;
END
$c6$;
SELECT public.t4490_as(NULL);
SELECT public.t4490_ok((SELECT status FROM public.pg_venue_offer_availability((SELECT v FROM t4490_ids WHERE k = 'offer'),
    (SELECT today FROM t4490_dates), (SELECT today FROM t4490_dates), 1, NULL)) = 'gate_only',
  'C-6c the guest sees "at the gate only" for today');
SELECT public.t4490_service();
DO $c6g$
DECLARE
  v jsonb;
  v_u record;
BEGIN
  v := public.issue_4490_gate_sale('44907000-0000-4000-9000-0000000000a1', (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 20)),
    'cash', '{}'::jsonb, 'p2-c6-gate-1', '44907000-0000-4000-8000-000000000003');
  v := public.issue_4490_gate_sale('44907000-0000-4000-9000-0000000000a1', (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 20)),
    'transfer', '{"name":"Door Guest"}'::jsonb, 'p2-c6-gate-2', '44907000-0000-4000-8000-000000000003');
  v := public.issue_4490_gate_sale('44907000-0000-4000-9000-0000000000a1', (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 10)),
    'cash', '{}'::jsonb, 'p2-c6-gate-3', '44907000-0000-4000-8000-000000000003');
  SELECT * INTO v_u FROM public.issue_4490_pool_day_usage((SELECT t.v FROM t4490_ids t WHERE t.k = 'pool'), (SELECT today FROM t4490_dates));
  PERFORM public.t4490_ok(v_u.used = 300 AND v_u.gate_left = 0, 'C-6d the gate still sells the kept seats, to 300');
  BEGIN
    PERFORM public.issue_4490_gate_sale('44907000-0000-4000-9000-0000000000a1', (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'),
      jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 1)),
      'cash', '{}'::jsonb, 'p2-c6-gate-4', '44907000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'T4490 FAIL: C-6e';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    PERFORM public.t4490_ok(SQLERRM = 'offer_sold_out', 'C-6e and not one more');
  END;
END
$c6g$;
SELECT public.t4490_reset();

-- ===========================================================================
-- C-7 hold expiry: expire, a new hold succeeds, the sweep cancels the old
-- group, a late payment goes to refund_due.
-- ===========================================================================
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT (public.issue_4490_set_capacity_override('44907000-0000-4000-9000-0000000000a1', (SELECT v FROM t4490_ids WHERE k = 'pool'),
  (SELECT wednesday FROM t4490_dates) + 7, 3, 0, false, false, 'p2-c7-override')->>'dailyLimit') AS limit3;
SELECT public.t4490_service();
DO $c7$
DECLARE
  v_old uuid;
  v_new uuid;
  v_unpaid uuid;
  v_p jsonb;
  v_f jsonb;
  v_sweep jsonb;
BEGIN
  v_old := public.t4490_buy((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT wednesday FROM t4490_dates) + 7,
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 3)), 'c7-old');
  v_p := public.issue_4490_prepare_offer_payment(v_old, sha256(convert_to('tok:c7-old', 'UTF8')), NULL, 'pay-c7-old', 1);
  PERFORM public.issue_1389_bind_payment_attempt((v_p->>'attemptId')::uuid, 'mingla_stay_' || replace(v_p->>'attemptId', '-', ''), NULL, NULL);
  BEGIN
    PERFORM public.t4490_buy((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT wednesday FROM t4490_dates) + 7,
      jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 1)), 'c7-blocked');
    RAISE EXCEPTION 'T4490 FAIL: C-7a';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    PERFORM public.t4490_ok(SQLERRM = 'offer_sold_out', 'C-7a a day limit of 3 is full while the hold lives');
  END;
  UPDATE public.stay_inventory_holds SET expires_at = now() - interval '1 second' WHERE group_id = v_old;
  v_new := public.t4490_buy((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT wednesday FROM t4490_dates) + 7,
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 3)), 'c7-new');
  PERFORM public.t4490_ok(v_new IS NOT NULL, 'C-7b once the hold lapses a new hold takes the seats');
  v_f := public.issue_1389_finalize_payment('paystack', 'evt-c7-late', 'charge.success',
    'mingla_stay_' || replace(v_p->>'attemptId', '-', ''), 'ch-c7', (v_p->>'amountMinor')::bigint, 'NGN', 0, NULL);
  PERFORM public.t4490_ok(v_f->>'state' = 'refund_due', 'C-7c a late payment for the lapsed hold goes to refund_due');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.venue_passes WHERE group_id = v_old), 'C-7d and issues no pass');
  -- An unpaid lapsed hold: the existing Stays sweep cancels it.
  v_unpaid := public.t4490_buy((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT wednesday FROM t4490_dates) + 8,
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 2)), 'c7-unpaid');
  UPDATE public.stay_inventory_holds SET expires_at = now() - interval '1 second' WHERE group_id = v_unpaid;
  v_sweep := public.issue_1389_run_stay_sweep(100, NULL);
  PERFORM public.t4490_ok((SELECT state FROM public.stay_reservation_groups WHERE id = v_unpaid) = 'cancelled'
      AND (SELECT state FROM public.stay_reservation_groups WHERE id = v_old) = 'reconciliation_required',
    'C-7e the existing Stays sweep cancels the unpaid lapsed booking and leaves the refund-due one');
END
$c7$;
SELECT public.t4490_reset();

-- ===========================================================================
-- C-8 cancel: the guest's ladder (by token), staff operator rate, release.
-- ===========================================================================
SELECT public.t4490_service();
DO $c8$
DECLARE
  v_far uuid;
  v_pv jsonb;
  v_c jsonb;
  v_c2 jsonb;
  v_ids uuid[];
  v_u_before integer;
  v_u_after integer;
BEGIN
  v_far := public.t4490_buy((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT wednesday FROM t4490_dates) + 14,
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 2)), 'c8-far');
  PERFORM public.t4490_pay(v_far, 'c8-far');
  SELECT used INTO v_u_before FROM public.issue_4490_pool_day_usage((SELECT t.v FROM t4490_ids t WHERE t.k = 'pool'), (SELECT wednesday FROM t4490_dates) + 14);
  v_pv := public.issue_4490_cancel_preview(v_far, sha256(convert_to('tok:c8-far', 'UTF8')), NULL);
  PERFORM public.t4490_ok(v_pv->>'actorType' = 'guest' AND (v_pv->>'refundMinor')::bigint = 1075000
      AND (v_pv->>'paidMinor')::bigint = 1075000,
    'C-8a two weeks ahead the ladder gives the guest a full refund (N10,750 incl. VAT)');
  SELECT array_agg((x #>> '{}')::uuid) INTO v_ids FROM jsonb_array_elements(v_pv->'previewIds') x;
  v_c := public.issue_4490_cancel(v_ids, v_pv->>'previewHash', 'p2-c8-cancel', 'Plans changed',
    sha256(convert_to('tok:c8-far', 'UTF8')), NULL);
  v_c2 := public.issue_4490_cancel(v_ids, v_pv->>'previewHash', 'p2-c8-cancel', 'Plans changed',
    sha256(convert_to('tok:c8-far', 'UTF8')), NULL);
  PERFORM public.t4490_ok(v_c->>'state' = 'cancelled' AND (v_c->>'refundMinor')::bigint = 1075000
      AND (v_c2->>'replayed')::boolean AND (v_c2->>'refundMinor')::bigint = 1075000,
    'C-8b cancel refunds every payment; a replay returns the same result');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.stay_refunds r JOIN public.source_refunds s ON s.id = r.source_refund_id
      WHERE r.group_id = v_far AND s.source_type = 'stay_reservation' AND s.buyer_refund_requested_cents = 1075000) = 1,
    'C-8c the refund goes through the source-refund control plane');
  SELECT used INTO v_u_after FROM public.issue_4490_pool_day_usage((SELECT t.v FROM t4490_ids t WHERE t.k = 'pool'), (SELECT wednesday FROM t4490_dates) + 14);
  PERFORM public.t4490_ok(v_u_before - v_u_after = 2, 'C-8d the seats go back to the day');
  PERFORM public.t4490_ok((SELECT status FROM public.venue_passes WHERE group_id = v_far) = 'refunded', 'C-8e the pass is marked refunded');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.notification_outbox WHERE category_key = 'venue_booking_cancelled'
      AND payload->>'venue_group_id' = v_far::text) = 1, 'C-8f a venue_booking_cancelled email is queued');
END
$c8$;

-- Today's booking (already started, no rung met): the guest gets nothing back;
-- a finance manager cancelling gives the operator rate (100%).
DO $c8b$
DECLARE
  v_g uuid;
  v_pv jsonb;
BEGIN
  v_g := (SELECT g.id FROM public.stay_reservation_groups g WHERE g.idempotency_key = 'hold-c6-1');
  PERFORM public.t4490_pay(v_g, 'c6-1');
  v_pv := public.issue_4490_cancel_preview(v_g, sha256(convert_to('tok:c6-1', 'UTF8')), NULL);
  PERFORM public.t4490_ok((v_pv->>'refundMinor')::bigint = 0 AND (v_pv->>'keepMinor')::bigint = (v_pv->>'paidMinor')::bigint,
    'C-8g on the day itself the ladder gives the guest no refund');
  INSERT INTO t4490_ids VALUES ('c8_today', v_g);
END
$c8b$;
SELECT public.t4490_as('44907000-0000-4000-8000-000000000002');
DO $c8c$
DECLARE
  v_pv jsonb;
  v_ids uuid[];
  v_c jsonb;
BEGIN
  v_pv := public.issue_4490_cancel_preview((SELECT t.v FROM t4490_ids t WHERE t.k = 'c8_today'));
  PERFORM public.t4490_ok(v_pv->>'actorType' = 'staff' AND (v_pv->>'refundMinor')::bigint = (v_pv->>'paidMinor')::bigint,
    'C-8h a finance manager cancelling refunds at the operator rate (100%)');
  SELECT array_agg((x #>> '{}')::uuid) INTO v_ids FROM jsonb_array_elements(v_pv->'previewIds') x;
  v_c := public.issue_4490_cancel(v_ids, v_pv->>'previewHash', 'p2-c8-staff', 'Venue closed early');
  PERFORM public.t4490_ok(v_c->>'state' = 'cancelled', 'C-8i staff cancel with refund');
END
$c8c$;
SELECT public.t4490_as('44907000-0000-4000-8000-000000000003');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_cancel_preview(%L::uuid)$$,
  (SELECT v FROM t4490_ids WHERE k = 'c4_group')), '42501', 'not_authorized',
  'C-8j check-in-only staff cannot cancel or refund (money action)');
SELECT public.t4490_as('44907000-0000-4000-8000-000000000005');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_cancel_preview(%L::uuid)$$,
  (SELECT v FROM t4490_ids WHERE k = 'c4_group')), '42501', 'not_authorized',
  'C-8k an outsider cannot cancel');
SELECT public.t4490_reset();
ROLLBACK;
