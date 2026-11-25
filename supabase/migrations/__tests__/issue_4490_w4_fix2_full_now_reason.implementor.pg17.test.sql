-- #4490 spec 06 W4 fix 2 (20281203494490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-FULL-NOW-HAS-A-REASON | issue #4490 | a booking waiting for its first payment whose offer takes a deposit but which is offered only "full" carries the server's reason in its read (fullNowReason: balance_due_passed when the balance date, session start minus balance_due_days_before, is now or past; deposit_covers_total when the deposit is the whole amount); a booking still offered a deposit, an offer without a deposit, and a paid booking carry none; no amount, state or pay mode changes.
--
-- R-1 deposit offered (balance date ahead): payModes deposit + full, no reason.
-- R-2 the balance date had passed before booking (the W4-R1 shape: 14 days before a day 5-11 days out):
--     the quote's plan collapses (balance_due_passed), the hold asks for everything, the booking read says why.
-- R-3 a deposit offered at the hold whose balance date then passes: full only, balance_due_passed.
-- R-4 a fixed deposit at least the total: deposit_covers_total.
-- R-5 an entry offer (no deposit): no reason. R-6 paid in full: no reason.
-- R-7 the reason is internal: anon and signed-in cannot call it; the service role can.
--
-- FAILS-ON-REVERT: without 20281203494490 the booking read has no fullNowReason (R-2c, R-3, R-4 fail)
-- and issue_4490_full_now_reason does not exist (R-7 fails).
\set ON_ERROR_STOP on
BEGIN;
-- (shared #4490 P2/P3 suite fixture, copied from issue_4490_p3_packages: the Gameland entry offer and
-- the "Squad" group package, 50% deposit, balance 2 days before, bookable 3 days ahead)
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

-- ===========================================================================
-- G-1 the owner builds "Squad": N10,000 a guest, 10 to 60, starts 12/14/16/18
-- for 3 hours, book 3 days ahead, rice choice, two extras, 50% deposit with
-- the balance 2 days before, refunds 100% >= 72 h else 50%, moves until 24 h,
-- guest numbers until 48 h, at most 2 moves.
-- ===========================================================================
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
DO $g1$
DECLARE
  v jsonb;
  v_offer uuid;
  v_ver bigint;
BEGIN
  PERFORM public.t4490_ok('group_packages' = ANY(public.issue_4490_built_features())
      AND 'group_package' = ANY(public.issue_4490_built_offer_kinds()), 'G-1a group packages are built');
  PERFORM public.issue_4490_set_venue_feature('44907000-0000-4000-9000-0000000000a1', 'group_packages', true, NULL, NULL, NULL, 'p3-g1-feature');
  PERFORM public.issue_4490_save_booking_settings('44907000-0000-4000-9000-0000000000a1', '{"vatMode":"added"}'::jsonb, NULL, 'p3-g1-vat');
  v := public.issue_4490_manage_offer('create_draft', '44907000-0000-4000-9000-0000000000a1',
    '{"kind":"group_package","name":"Squad"}'::jsonb, NULL, 'p3-g1-create');
  v_offer := (v->>'id')::uuid; v_ver := (v->>'version')::bigint;
  INSERT INTO t4490_ids VALUES ('pkg', v_offer);
  v := public.issue_4490_manage_offer('set_pool', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'poolId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'pool')), v_ver, 'p3-g1-pool');
  v_ver := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('upsert_price_option', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'name', 'Squad', 'unit', 'guest', 'guestMin', 10, 'guestMax', 60,
      'priceMinor', 1000000), v_ver, 'p3-g1-option');
  v_ver := (v->>'version')::bigint;
  INSERT INTO t4490_ids SELECT 'squad', (o->>'id')::uuid FROM jsonb_array_elements(v->'options') o;
  PERFORM public.t4490_ok((v->'options'->0->>'guestMax')::int = 60, 'G-1b 60 guests is accepted (the old 2..50 cap is gone)');
  v := public.issue_4490_manage_offer('update', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'minNoticeMinutes', 4320), v_ver, 'p3-g1-notice');
  v_ver := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('set_policy', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'refundLadder', jsonb_build_array(
      jsonb_build_object('minMinutesBefore', 4320, 'refundBps', 10000),
      jsonb_build_object('minMinutesBefore', 0, 'refundBps', 5000))), v_ver, 'p3-g1-policy');
  v_ver := (v->>'version')::bigint;
  v := public.issue_4490_manage_package('set_package', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'staffRoleLabel', 'Games Master',
      'inclusions', jsonb_build_array(
        jsonb_build_object('kind', 'perk', 'label', '3 hours of games'),
        jsonb_build_object('kind', 'staff', 'label', 'A Games Master', 'staffRatio', 15),
        jsonb_build_object('kind', 'choice', 'label', 'Rice for the group',
          'options', jsonb_build_array('Party jollof', 'Coconut rice', 'Native rice'))),
      'extras', jsonb_build_array(
        jsonb_build_object('name', 'Cake table', 'priceMinor', 2000000, 'per', 'booking'),
        jsonb_build_object('name', 'Extra hour', 'priceMinor', 5000000, 'per', 'booking'))), v_ver, 'p3-g1-package');
  v_ver := (v->>'version')::bigint;
  PERFORM public.t4490_ok(jsonb_array_length(v->'extras') = 2 AND jsonb_array_length(v->'inclusions') = 3
      AND v->'inclusions'->2->'options' = '["Party jollof","Coconut rice","Native rice"]'::jsonb
      AND v->>'staffRoleLabel' = 'Games Master',
    'G-1c inclusions (with a "guests choose one" question) and two priced extras are saved');
  v := public.issue_4490_manage_package('set_payment', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'depositKind', 'percent', 'depositValue', 5000, 'balanceDueDaysBefore', 2),
    v_ver, 'p3-g1-payment');
  v_ver := (v->>'version')::bigint;
  PERFORM public.t4490_ok(v->'deposit' = '{"kind":"percent","value":5000,"balanceDueDaysBefore":2}'::jsonb
      AND v->'payModes' = '["deposit","full"]'::jsonb, 'G-1d a 50% deposit with the balance 2 days before');
  v := public.issue_4490_manage_package('set_start_times', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'startTimes', jsonb_build_array('18:00', '12:00', '16:00', '14:00'),
      'durationMinutes', 180, 'weekdays', jsonb_build_array(0, 1, 2, 3, 4, 5, 6)), v_ver, 'p3-g1-times');
  v_ver := (v->>'version')::bigint;
  PERFORM public.t4490_ok(v->'startTimes' = '["12:00","14:00","16:00","18:00"]'::jsonb AND (v->>'durationMinutes')::int = 180,
    'G-1e start times 12:00, 14:00, 16:00, 18:00 for 3 hours');
  v := public.issue_4490_manage_package('set_change_rules', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer, 'allowedUntilMinutesBefore', 1440, 'guestChangeUntilMinutesBefore', 2880,
      'feeBps', 0, 'maxChanges', 2), v_ver, 'p3-g1-change');
  v_ver := (v->>'version')::bigint;
  PERFORM public.t4490_ok((v->'policy'->'dateChangeRule'->>'guestChangeUntilMinutesBefore')::int = 2880
      AND jsonb_array_length(v->'policy'->'refundLadder') = 2, 'G-1f change rules saved, the refund ladder kept');
  PERFORM public.t4490_ok(jsonb_array_length(v->'readiness') = 0, 'G-1g the package is ready');
  v := public.issue_4490_manage_offer('publish', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v_offer), v_ver, 'p3-g1-publish');
  PERFORM public.t4490_ok(v->>'status' = 'live' AND (v->>'windowsCreated')::int > 0, 'G-1h published with session windows');
  -- A second draft over the day limit is not ready.
  v := public.issue_4490_manage_offer('create_draft', '44907000-0000-4000-9000-0000000000a1',
    '{"kind":"group_package","name":"Mega party"}'::jsonb, NULL, 'p3-g1-mega');
  v := public.issue_4490_manage_offer('set_pool', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v->>'id', 'poolId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'pool')),
    (v->>'version')::bigint, 'p3-g1-mega-pool');
  v := public.issue_4490_manage_offer('upsert_price_option', '44907000-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', v->>'id', 'name', 'Everyone', 'unit', 'booking', 'guestMin', 100, 'guestMax', 400,
      'priceMinor', 50000000), (v->>'version')::bigint, 'p3-g1-mega-opt');
  PERFORM public.t4490_ok(v->'readiness' ? 'guest_max_over_capacity',
    'G-1i a package for more guests than the day limit (400 > 300) is not ready');
  BEGIN
    PERFORM public.issue_4490_manage_package('set_package', '44907000-0000-4000-9000-0000000000a1',
      jsonb_build_object('offerId', v->>'id', 'inclusions', jsonb_build_array(
        jsonb_build_object('kind', 'choice', 'label', 'Drinks', 'options', jsonb_build_array('Only one')))),
      (v->>'version')::bigint, 'p3-g1-badchoice');
    RAISE EXCEPTION 'T4490 FAIL: G-1j';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    PERFORM public.t4490_ok(SQLERRM = 'inclusions_invalid', 'G-1j a choice needs at least two options');
  END;
END
$g1$;
SELECT public.t4490_reset();
CREATE TEMP TABLE t4490_extra ON COMMIT DROP AS
SELECT (SELECT e->>'id' FROM public.stay_offerings o, jsonb_array_elements(o.extras) e
        WHERE o.id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg') AND e->>'name' = 'Cake table') AS cake,
       (SELECT e->>'id' FROM public.stay_offerings o, jsonb_array_elements(o.extras) e
        WHERE o.id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg') AND e->>'name' = 'Extra hour') AS hour;
GRANT SELECT ON t4490_extra TO PUBLIC;
CREATE FUNCTION public.t4490_pkgwin(p_date date, p_time text)
RETURNS uuid LANGUAGE sql AS $f$
  SELECT w.id FROM public.stay_place_windows w
  WHERE w.offering_id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg') AND w.local_date = p_date
    AND to_char(w.starts_at AT TIME ZONE 'Africa/Lagos', 'HH24:MI') = p_time;
$f$;
GRANT EXECUTE ON FUNCTION public.t4490_pkgwin(date, text) TO PUBLIC;

-- ===========================================================================
-- R-1 .. R-6
-- ===========================================================================
SELECT public.t4490_service();
DO $r1$
DECLARE
  v_q jsonb;
  v_h jsonb;
  v_b jsonb;
  v_gid uuid := gen_random_uuid();
BEGIN
  v_q := public.issue_4490_quote_offer((SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg'),
    public.t4490_pkgwin((SELECT saturday FROM t4490_dates), '12:00'),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'squad'), 'guests', 10)),
    public.t4490_key('cart:r1'), NULL, 'w4f2-r1-q', '[]'::jsonb, '{"Rice for the group":"Party jollof"}'::jsonb);
  v_h := public.issue_4490_create_offer_group(v_gid, (v_q->>'quoteId')::uuid,
    '{"name":"Ada Deposit","email":"ada-w4f2@example.test"}'::jsonb, public.t4490_key('cart:r1'), NULL,
    sha256(convert_to('tok:r1', 'UTF8')), 'w4f2-r1-hold');
  v_b := public.issue_4490_get_offer_booking(v_gid, sha256(convert_to('tok:r1', 'UTF8')), NULL, NULL);
  PERFORM public.t4490_ok(jsonb_array_length(v_b->'payModes') = 2 AND v_b ? 'fullNowReason' AND v_b->'fullNowReason' = 'null'::jsonb,
    'R-1 a deposit still offered: deposit + full, no reason (' || (v_b->'payModes')::text || ')');
  INSERT INTO t4490_ids VALUES ('r1', v_gid);
END
$r1$;
SELECT public.t4490_reset();

-- The offer's balance is now due 14 days before (the hire on the local stack:
-- 50%, 14 days, a session 8 days out). Every bookable Saturday (5..11 days out)
-- is already past its balance date.
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT (public.issue_4490_manage_package('set_payment', '44907000-0000-4000-9000-0000000000a1',
  jsonb_build_object('offerId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg'), 'depositKind', 'percent', 'depositValue', 5000,
    'balanceDueDaysBefore', 14),
  (SELECT version FROM public.stay_offerings WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg')), 'w4f2-r2-14days')->>'status') AS s;
SELECT public.t4490_service();
DO $r2$
DECLARE
  v_q jsonb;
  v_h jsonb;
  v_b jsonb;
  v_gid uuid := gen_random_uuid();
BEGIN
  v_q := public.issue_4490_quote_offer((SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg'),
    public.t4490_pkgwin((SELECT saturday FROM t4490_dates), '14:00'),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'squad'), 'guests', 10)),
    public.t4490_key('cart:r2'), NULL, 'w4f2-r2-q', '[]'::jsonb, '{"Rice for the group":"Party jollof"}'::jsonb);
  PERFORM public.t4490_ok(v_q->'payPlan'->'payModes' = '["full"]'::jsonb
      AND v_q->'payPlan'->>'collapsed' = 'balance_due_passed' AND v_q->'payPlan'->>'depositKind' = 'percent',
    'R-2a the balance date passed: the quote folds the 50% deposit into one payment (balance_due_passed)');
  v_h := public.issue_4490_create_offer_group(v_gid, (v_q->>'quoteId')::uuid,
    '{"name":"Bola Close","email":"bola-w4f2@example.test"}'::jsonb, public.t4490_key('cart:r2'), NULL,
    sha256(convert_to('tok:r2', 'UTF8')), 'w4f2-r2-hold');
  v_b := public.issue_4490_get_offer_booking(v_gid, sha256(convert_to('tok:r2', 'UTF8')), NULL, NULL);
  PERFORM public.t4490_ok(v_b->'depositMinor' = 'null'::jsonb
      AND (v_b->>'amountDueNowMinor')::bigint = (v_q->>'totalMinor')::bigint
      AND v_b->'payModes' = jsonb_build_array(jsonb_build_object('mode', 'full', 'amountMinor', (v_q->>'totalMinor')::bigint)),
    'R-2b the booking asks for everything now (' || (v_b->>'amountDueNowMinor') || '), no deposit');
  PERFORM public.t4490_ok(v_b->>'fullNowReason' = 'balance_due_passed',
    'R-2c the booking read says why: balance_due_passed');
  INSERT INTO t4490_ids VALUES ('r2', v_gid);
END
$r2$;
SELECT public.t4490_reset();

-- R-3 the R-1 booking (deposit offered at the hold) whose balance date then
-- passes while it waits for payment (time travel, test only).
SET LOCAL session_replication_role = replica;
UPDATE public.stay_reservation_groups SET balance_due_at = now() - interval '1 hour'
WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'r1');
SET LOCAL session_replication_role = origin;
SELECT public.t4490_service();
SELECT public.t4490_ok((SELECT b->'payModes' = jsonb_build_array(jsonb_build_object('mode', 'full', 'amountMinor', (b->>'totalDueMinor')::bigint))
      AND b->>'fullNowReason' = 'balance_due_passed'
    FROM public.issue_4490_get_offer_booking((SELECT t.v FROM t4490_ids t WHERE t.k = 'r1'),
      sha256(convert_to('tok:r1', 'UTF8')), NULL, NULL) b),
  'R-3 the balance date passed after the hold: full only, balance_due_passed');
SELECT public.t4490_reset();

-- R-4 a fixed deposit of at least the total.
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT (public.issue_4490_manage_package('set_payment', '44907000-0000-4000-9000-0000000000a1',
  jsonb_build_object('offerId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg'), 'depositKind', 'fixed', 'depositValue', 99999999,
    'balanceDueDaysBefore', 2),
  (SELECT version FROM public.stay_offerings WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg')), 'w4f2-r4-fixed')->>'status') AS s;
SELECT public.t4490_service();
DO $r4$
DECLARE
  v_q jsonb;
  v_b jsonb;
  v_gid uuid := gen_random_uuid();
BEGIN
  v_q := public.issue_4490_quote_offer((SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg'),
    public.t4490_pkgwin((SELECT saturday FROM t4490_dates), '16:00'),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'squad'), 'guests', 10)),
    public.t4490_key('cart:r4'), NULL, 'w4f2-r4-q', '[]'::jsonb, '{"Rice for the group":"Party jollof"}'::jsonb);
  PERFORM public.issue_4490_create_offer_group(v_gid, (v_q->>'quoteId')::uuid,
    '{"name":"Chidi Fixed","email":"chidi-w4f2@example.test"}'::jsonb, public.t4490_key('cart:r4'), NULL,
    sha256(convert_to('tok:r4', 'UTF8')), 'w4f2-r4-hold');
  v_b := public.issue_4490_get_offer_booking(v_gid, sha256(convert_to('tok:r4', 'UTF8')), NULL, NULL);
  PERFORM public.t4490_ok(jsonb_array_length(v_b->'payModes') = 1 AND v_b->>'fullNowReason' = 'deposit_covers_total',
    'R-4 a fixed deposit above the total: full only, deposit_covers_total');
END
$r4$;

-- R-5 an entry booking (the offer takes no deposit): no reason.
DO $r5$
DECLARE
  v_gid uuid;
  v_b jsonb;
BEGIN
  v_gid := public.t4490_buy((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT saturday FROM t4490_dates),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 1)), 'w4f2-r5');
  v_b := public.issue_4490_get_offer_booking(v_gid, sha256(convert_to('tok:w4f2-r5', 'UTF8')), NULL, NULL);
  PERFORM public.t4490_ok(v_b->>'state' = 'instant_payment_pending' AND v_b->'fullNowReason' = 'null'::jsonb,
    'R-5 an entry booking (no deposit on the offer): no reason');
  -- R-6 once paid in full there is nothing to explain.
  PERFORM public.t4490_pay_mode((SELECT t.v FROM t4490_ids t WHERE t.k = 'r2'), 'r2', 'full');
  v_b := public.issue_4490_get_offer_booking((SELECT t.v FROM t4490_ids t WHERE t.k = 'r2'), sha256(convert_to('tok:r2', 'UTF8')), NULL, NULL);
  PERFORM public.t4490_ok(v_b->>'state' = 'confirmed' AND v_b->'fullNowReason' = 'null'::jsonb
      AND v_b->'payModes' = '[]'::jsonb, 'R-6 paid in full: confirmed, no reason');
END
$r5$;
SELECT public.t4490_reset();

-- R-7 privileges: internal only.
SELECT public.t4490_ok(NOT has_function_privilege('anon', 'public.issue_4490_full_now_reason(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_4490_full_now_reason(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.issue_4490_full_now_reason(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4490_booking_projection(uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_4490_booking_projection(uuid,text)', 'EXECUTE'),
  'R-7 the reason and the booking read stay internal (service role only)');
SELECT public.t4490_as('44907000-0000-4000-8000-000000000006');
SELECT public.t4490_expect($$SELECT public.issue_4490_full_now_reason('00000000-0000-0000-0000-000000000000')$$, '42501', NULL,
  'R-7b a signed-in guest cannot call it');
SELECT public.t4490_reset();
ROLLBACK;
