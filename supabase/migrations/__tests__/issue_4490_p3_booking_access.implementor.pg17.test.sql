-- #4490 P3 booking access (20281203124490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-BOOKING-ACCESS | issue #4490 | a venue booking is read, paid or cancelled by the guest only with its booking token or as its own signed-in user (user_id / booked_by_user_id); any other user id is refused (offer_booking_not_found), never let through by a NULL comparison.
--
-- A-1 a stranger's user id cannot read a signed-out guest booking (the S1 hole).
-- A-2 a stranger's user id cannot start a payment on someone's held booking.
-- A-3 a stranger's user id gets no cancel preview; a finance manager of the venue does (staff rate).
-- A-4 the token holder can read it, signed in as anybody; a wrong token cannot.
-- A-5 a signed-in buyer's own booking opens with their user id and not with another's.
-- A-6 the helper never answers NULL.
--
-- FAILS-ON-REVERT: restore issue_4490_booking_actor_ok from 20281203084490 -> A-1a, A-2a, A-6.
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
SELECT (SELECT min(d)::date FROM generate_series(public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 2,
          public.issue_4490_venue_local_date('44907000-0000-4000-9000-0000000000a1') + 9, interval '1 day') d
        WHERE extract(isodow FROM d) = 3) AS wednesday;
GRANT SELECT ON t4490_dates TO PUBLIC;

-- Bookings: a1 = bought signed-out and paid (user_id NULL); a2 = signed-out,
-- still on hold; a3 = bought signed in by user 06 and paid.
SELECT public.t4490_service();
DO $setup$
DECLARE
  v_lines jsonb := jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 2));
  v_offer uuid := (SELECT t.v FROM t4490_ids t WHERE t.k = 'offer');
  v_g uuid;
  v_q jsonb;
  v_h jsonb;
BEGIN
  v_g := public.t4490_buy(v_offer, (SELECT wednesday FROM t4490_dates), v_lines, 'acc-a1');
  PERFORM public.t4490_pay(v_g, 'acc-a1');
  INSERT INTO t4490_ids VALUES ('a1', v_g);
  v_g := public.t4490_buy(v_offer, (SELECT wednesday FROM t4490_dates), v_lines, 'acc-a2');
  INSERT INTO t4490_ids VALUES ('a2', v_g);
  v_q := public.issue_4490_quote_offer(v_offer, public.t4490_win(v_offer, (SELECT wednesday FROM t4490_dates)), v_lines,
    public.t4490_key('user:44907000-0000-4000-8000-000000000006'), '44907000-0000-4000-8000-000000000006', 'p3-a3-quote');
  v_h := public.issue_4490_create_offer_group(gen_random_uuid(), (v_q->>'quoteId')::uuid,
    '{"name":"Signed In Guest","email":"p2u6-4490@example.test"}'::jsonb,
    public.t4490_key('user:44907000-0000-4000-8000-000000000006'), '44907000-0000-4000-8000-000000000006',
    sha256('tok:a3'::bytea), 'p3-a3-hold');
  INSERT INTO t4490_ids VALUES ('a3', (v_h->>'groupId')::uuid);
  PERFORM public.t4490_pay((v_h->>'groupId')::uuid, 'a3');
END
$setup$;
SELECT public.t4490_ok((SELECT user_id IS NULL AND booked_by_user_id IS NULL AND state = 'confirmed'
    FROM public.stay_reservation_groups WHERE id = (SELECT v FROM t4490_ids WHERE k = 'a1')),
  'A-0 fixture: a1 was bought signed-out (no user on it) and is confirmed');

-- A-1 reading a signed-out booking with someone else's user id.
SELECT public.t4490_expect(format($$SELECT public.issue_4490_get_offer_booking(%L::uuid, NULL, %L::uuid, NULL)$$,
  (SELECT v FROM t4490_ids WHERE k = 'a1'), '44907000-0000-4000-8000-000000000005'),
  'P0002', 'offer_booking_not_found', 'A-1a a stranger''s user id cannot read a signed-out guest booking');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_get_offer_booking(%L::uuid, NULL, %L::uuid, NULL)$$,
  (SELECT v FROM t4490_ids WHERE k = 'a1'), '44907000-0000-4000-8000-000000000001'),
  'P0002', 'offer_booking_not_found', 'A-1b the venue owner does not read guest bookings through the guest path either');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_get_offer_booking(%L::uuid, NULL, NULL, NULL)$$,
  (SELECT v FROM t4490_ids WHERE k = 'a1')),
  'P0002', 'offer_booking_not_found', 'A-1c no token and no user: refused');

-- A-2 paying for somebody else's held booking.
SELECT public.t4490_expect(format($$SELECT public.issue_4490_prepare_offer_payment(%L::uuid, NULL, %L::uuid, 'p3-a2-stranger-pay', %s)$$,
  (SELECT v FROM t4490_ids WHERE k = 'a2'), '44907000-0000-4000-8000-000000000005',
  (SELECT version FROM public.stay_reservation_groups WHERE id = (SELECT v FROM t4490_ids WHERE k = 'a2'))),
  'P0002', 'offer_booking_not_found', 'A-2a a stranger''s user id cannot start a payment on someone''s held booking');
SELECT public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.stay_payment_attempts
    WHERE group_id = (SELECT v FROM t4490_ids WHERE k = 'a2')),
  'A-2b and no payment attempt was written');

-- A-3 cancel preview.
SELECT public.t4490_expect(format($$SELECT public.issue_4490_cancel_preview(%L::uuid, NULL, %L::uuid)$$,
  (SELECT v FROM t4490_ids WHERE k = 'a1'), '44907000-0000-4000-8000-000000000005'),
  'P0002', 'offer_booking_not_found', 'A-3a a stranger''s user id gets no cancel preview');
SELECT public.t4490_ok((public.issue_4490_cancel_preview((SELECT v FROM t4490_ids WHERE k = 'a1'), NULL,
    '44907000-0000-4000-8000-000000000002')->>'actorType') = 'staff',
  'A-3b a finance manager of the venue gets the staff preview (money rights)');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_cancel_preview(%L::uuid, NULL, %L::uuid)$$,
  (SELECT v FROM t4490_ids WHERE k = 'a1'), '44907000-0000-4000-8000-000000000003'),
  'P0002', 'offer_booking_not_found', 'A-3c check-in-only staff get no cancel preview through the guest path');

-- A-4 the token.
SELECT public.t4490_ok((public.issue_4490_get_offer_booking((SELECT v FROM t4490_ids WHERE k = 'a1'),
    sha256('tok:acc-a1'::bytea), '44907000-0000-4000-8000-000000000005', NULL)->>'groupId')::uuid = (SELECT v FROM t4490_ids WHERE k = 'a1'),
  'A-4a a signed-in user holding the booking token opens the guest booking');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_get_offer_booking(%L::uuid, sha256('tok:wrong'::bytea), NULL, NULL)$$,
  (SELECT v FROM t4490_ids WHERE k = 'a1')),
  'P0002', 'offer_booking_not_found', 'A-4b a wrong token is refused');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_get_offer_booking(%L::uuid, sha256('tok:a3'::bytea), NULL, NULL)$$,
  (SELECT v FROM t4490_ids WHERE k = 'a1')),
  'P0002', 'offer_booking_not_found', 'A-4c another booking''s token is refused');

-- A-5 a signed-in buyer's own booking.
SELECT public.t4490_ok((public.issue_4490_get_offer_booking((SELECT v FROM t4490_ids WHERE k = 'a3'), NULL,
    '44907000-0000-4000-8000-000000000006', NULL)->>'groupId')::uuid = (SELECT v FROM t4490_ids WHERE k = 'a3'),
  'A-5a the signed-in buyer opens their own booking without a token');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_get_offer_booking(%L::uuid, NULL, %L::uuid, NULL)$$,
  (SELECT v FROM t4490_ids WHERE k = 'a3'), '44907000-0000-4000-8000-000000000005'),
  'P0002', 'offer_booking_not_found', 'A-5b another signed-in user cannot open it');

-- A-6 the helper is two-valued.
SELECT public.t4490_reset();
SELECT public.t4490_ok((SELECT public.issue_4490_booking_actor_ok(g, NULL, '44907000-0000-4000-8000-000000000005') IS NOT NULL
    AND NOT public.issue_4490_booking_actor_ok(g, NULL, '44907000-0000-4000-8000-000000000005')
    FROM public.stay_reservation_groups g WHERE g.id = (SELECT v FROM t4490_ids WHERE k = 'a1')),
  'A-6 issue_4490_booking_actor_ok answers false (never NULL) for a stranger on a signed-out booking');

-- A-7 clients cannot call the guest RPCs directly.
SELECT public.t4490_as('44907000-0000-4000-8000-000000000005');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_get_offer_booking(%L::uuid, NULL, %L::uuid, NULL)$$,
  (SELECT v FROM t4490_ids WHERE k = 'a1'), '44907000-0000-4000-8000-000000000005'),
  '42501', NULL, 'A-7 a signed-in client cannot call the guest read RPC directly');
SELECT public.t4490_reset();
ROLLBACK;
