-- #4490 P3-1 (packages, deposits, balance, changes, sweep; 20281203144490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-ONE-HOME-FOR-OWED | issue #4490 | what a venue booking owes is computed only by issue_4490_booking_money (booking total + applied changes - online payments - payments taken at the venue + change refunds); every payment stage, check-in and email reads it.
-- MINGLA-INVARIANT: I-4490-SHARED-DAY-LIMIT | issue #4490 | entry and group packages on one capacity pool count against the same day limit, including guests added or moved by a booking change.
-- MINGLA-INVARIANT: I-4490-BALANCE-NEVER-TOUCHES-HOLD | issue #4490 | a balance payment is finalised by issue_4490_finalize_followup_payment and never converts or releases a hold; a balance paid after the booking closed is refund due.
--
-- G-1 package authoring: kind group_package built; 10..60 guests (no 50 cap); guest max above the day limit not ready;
--     start times; extras; choice; deposit; change rules; publish.
-- G-2 D P3-4 totals: Squad x12 + Cake table = 140,000 + VAT 10,500 = 150,500; Half now 75,250; the choice is required.
-- G-3 hold freezes the deposit plan and the answers. G-4 deposit paid -> confirmed, balance 75,250, allocations split.
-- G-5 shared day limit with entry. G-6 balance paid online (stage balance) -> paid in full, hold untouched.
-- G-7 guests 12 -> 14 (more owed), G-8 add an extra, G-9 paid at the venue, G-10 check-in shows the balance,
-- G-11 move the day (capacity and pass follow), G-12 guests down (ladder), G-13 refund when overpaid (snapshot ladder),
-- G-14 deposit maths (half-up, fixed above total collapses), G-15 pay mode refused, G-16 cancel refunds every payment,
-- G-17 a late payment after the sweep cancelled the hold is refund due (no transition error),
-- G-18 sweep reminders and overdue notices (idempotent), G-19 guards, G-20 permissions, G-21 entry: too late to change.
--
-- FAILS-ON-REVERT (seen): drop the commitment relaxation in issue_1388_guard_state_transition -> G-7
-- (stay_commitment_identity_immutable); restore the late branch's old state filter -> G-17 (stay_invalid_transition).
-- Remove the stage-balance branch from issue_1389_finalize_payment -> G-6b (the balance would go through the hold path).
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
-- G-2 .. G-6 a stranger books Squad for 12 on Saturday 16:00 with Party jollof
-- and the Cake table, pays half now, then the rest with the booking link.
-- ===========================================================================
SELECT public.t4490_service();
DO $g2$
DECLARE
  v_q jsonb;
  v_h jsonb;
  v_b jsonb;
  v_p jsonb;
  v_gid uuid := gen_random_uuid();
  v_win uuid := public.t4490_pkgwin((SELECT saturday FROM t4490_dates), '16:00');
  v_lines jsonb := jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'squad'), 'guests', 12));
  v_before record;
  v_after record;
  v_hold_state text;
BEGIN
  BEGIN
    PERFORM public.issue_4490_quote_offer((SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg'), v_win, v_lines,
      public.t4490_key('cart:g2'), NULL, 'p3-g2-q0', jsonb_build_array(jsonb_build_object('id', (SELECT cake FROM t4490_extra))),
      '{}'::jsonb);
    RAISE EXCEPTION 'T4490 FAIL: G-2a';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    PERFORM public.t4490_ok(SQLERRM = 'offer_answer_required', 'G-2a the rice question must be answered with one of its options');
  END;
  v_q := public.issue_4490_quote_offer((SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg'), v_win, v_lines,
    public.t4490_key('cart:g2'), NULL, 'p3-g2-q1', jsonb_build_array(jsonb_build_object('id', (SELECT cake FROM t4490_extra))),
    '{"Rice for the group":"Party jollof"}'::jsonb);
  PERFORM public.t4490_ok((v_q->>'subtotalMinor')::bigint = 14000000 AND (v_q->>'taxMinor')::bigint = 1050000
      AND (v_q->>'totalMinor')::bigint = 15050000,
    'G-2b Squad x12 + Cake table = N140,000 + VAT N10,500 = N150,500 (' || (v_q->>'totalMinor') || ')');
  PERFORM public.t4490_ok((v_q->'payPlan'->>'depositMinor')::bigint = 7525000
      AND v_q->'payPlan'->'payModes' = '["deposit","full"]'::jsonb,
    'G-2c Half now = N75,250; All now is offered too');
  PERFORM public.t4490_ok(jsonb_array_length(v_q->'extras') = 1 AND (v_q->'extras'->0->>'amountMinor')::bigint = 2000000
      AND v_q->'answers'->>'Rice for the group' = 'Party jollof', 'G-2d the quote lists the extra and the answer');
  SELECT * INTO v_before FROM public.issue_4490_pool_day_usage((SELECT t.v FROM t4490_ids t WHERE t.k = 'pool'), (SELECT saturday FROM t4490_dates));
  v_h := public.issue_4490_create_offer_group(v_gid, (v_q->>'quoteId')::uuid,
    '{"name":"Ada Party","email":"ada-4490@example.test"}'::jsonb, public.t4490_key('cart:g2'), NULL,
    sha256(convert_to('tok:g2', 'UTF8')), 'p3-g2-hold');
  PERFORM public.t4490_ok((v_h->>'depositMinor')::bigint = 7525000
      AND (v_h->>'balanceDueAt')::timestamptz = (SELECT starts_at - interval '2 days' FROM public.stay_place_windows WHERE id = v_win)
      AND v_h->'answers'->>'Rice for the group' = 'Party jollof'
      AND jsonb_array_length(v_h->'payModes') = 2,
    'G-3 the hold freezes the deposit, the balance due date (2 days before) and the answer');
  v_p := public.t4490_pay_mode(v_gid, 'g2', 'deposit');
  PERFORM public.t4490_ok(v_p->>'stage' = 'deposit' AND (v_p->>'amountMinor')::bigint = 7525000, 'G-4a the deposit stage asks N75,250');
  PERFORM public.t4490_ok((SELECT sum(charged_minor) FILTER (WHERE component = 'base') = 7000000
        AND sum(charged_minor) FILTER (WHERE component = 'tax') = 525000
      FROM public.stay_payment_allocations WHERE payment_attempt_id = (v_p->>'attemptId')::uuid),
    'G-4b the deposit is split over price and VAT (N70,000 + N5,250)');
  v_b := public.issue_4490_get_offer_booking(v_gid, sha256(convert_to('tok:g2', 'UTF8')), NULL, repeat('p', 40));
  PERFORM public.t4490_ok(v_b->>'state' = 'confirmed' AND (v_b->>'paidMinor')::bigint = 7525000
      AND (v_b->>'balanceDueMinor')::bigint = 7525000 AND (v_b->'passes'->0->>'admits')::int = 12,
    'G-4c the deposit confirms the booking: pass for 12, balance N75,250 due');
  SELECT * INTO v_after FROM public.issue_4490_pool_day_usage((SELECT t.v FROM t4490_ids t WHERE t.k = 'pool'), (SELECT saturday FROM t4490_dates));
  PERFORM public.t4490_ok(v_after.used = v_before.used + 12 AND v_after.online_left = v_before.online_left - 12,
    'G-5 the package uses 12 of the day limit it shares with entry (' || v_after.online_left || ' online left)');
  -- G-6 the balance, paid online with the booking link.
  SELECT state INTO v_hold_state FROM public.stay_inventory_holds WHERE group_id = v_gid;
  v_p := public.t4490_pay_mode(v_gid, 'g2', 'full');
  PERFORM public.t4490_ok(v_p->>'stage' = 'balance' AND (v_p->>'amountMinor')::bigint = 7525000,
    'G-6a once confirmed, paying asks the balance (stage balance, N75,250)');
  v_b := public.issue_4490_get_offer_booking(v_gid, sha256(convert_to('tok:g2', 'UTF8')), NULL, NULL);
  PERFORM public.t4490_ok((v_b->>'paidMinor')::bigint = 15050000 AND (v_b->>'balanceDueMinor')::bigint = 0
      AND v_b->>'state' = 'confirmed'
      AND (SELECT state FROM public.stay_inventory_holds WHERE group_id = v_gid) = v_hold_state,
    'G-6b the balance payment is finalised as a follow-up: paid in full, still confirmed, hold untouched');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.notification_outbox
      WHERE category_key = 'venue_balance_paid' AND payload->>'venue_group_id' = v_gid::text) = 1,
    'G-6c a venue_balance_paid email is queued');
  BEGIN
    PERFORM public.issue_4490_prepare_offer_payment(v_gid, sha256(convert_to('tok:g2', 'UTF8')), NULL, 'p3-g6d-again',
      (SELECT version FROM public.stay_reservation_groups WHERE id = v_gid), 'full');
    RAISE EXCEPTION 'T4490 FAIL: G-6d';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    PERFORM public.t4490_ok(SQLERRM = 'offer_nothing_to_pay', 'G-6d nothing more to pay');
  END;
  INSERT INTO t4490_ids VALUES ('g2', v_gid);
END
$g2$;

-- ===========================================================================
-- G-7 .. G-13 changes on the paid Squad booking (guest, by token).
-- ===========================================================================
DO $g7$
DECLARE
  v_gid uuid := (SELECT t.v FROM t4490_ids t WHERE t.k = 'g2');
  v_tok bytea := sha256(convert_to('tok:g2', 'UTF8'));
  v jsonb;
  v_b jsonb;
  v_u0 record;
  v_u1 record;
  v_u2 record;
  v_ver bigint;
BEGIN
  SELECT * INTO v_u0 FROM public.issue_4490_pool_day_usage((SELECT t.v FROM t4490_ids t WHERE t.k = 'pool'), (SELECT saturday FROM t4490_dates));
  v := public.issue_4490_guest_change_booking(v_gid, v_tok, NULL, 'change_guests', '{"guests":14}'::jsonb, true, NULL, NULL);
  PERFORM public.t4490_ok((v->>'priceDeltaMinor')::bigint = 2000000 AND (v->>'taxDeltaMinor')::bigint = 150000
      AND (v->>'amountMinor')::bigint = 2150000 AND (v->>'balanceAfterMinor')::bigint = 2150000 AND (v->>'preview')::boolean,
    'G-7a preview: 2 more guests cost N20,000 + VAT N1,500, shown before paying');
  SELECT version INTO v_ver FROM public.stay_reservation_groups WHERE id = v_gid;
  v := public.issue_4490_guest_change_booking(v_gid, v_tok, NULL, 'change_guests', '{"guests":14}'::jsonb, false, v_ver, 'p3-g7-up');
  v_b := public.issue_4490_get_offer_booking(v_gid, v_tok, NULL, NULL);
  PERFORM public.t4490_ok((v_b->>'balanceDueMinor')::bigint = 2150000 AND (v_b->'lines'->0->>'guests')::int = 14
      AND (v_b->'passes'->0->>'admits')::int = 14 AND (v_b->>'totalDueMinor')::bigint = 17200000,
    'G-7b applied: 14 guests on the pass, N21,500 more owed');
  SELECT * INTO v_u1 FROM public.issue_4490_pool_day_usage((SELECT t.v FROM t4490_ids t WHERE t.k = 'pool'), (SELECT saturday FROM t4490_dates));
  PERFORM public.t4490_ok(v_u1.used = v_u0.used + 2 AND (SELECT quantity FROM public.stay_inventory_commitments WHERE group_id = v_gid) = 14,
    'G-7c the 2 extra guests come off the shared day limit (the commitment moved to 14)');
  v := public.issue_4490_guest_change_booking(v_gid, v_tok, NULL, 'change_guests', '{"guests":14}'::jsonb, false, v_ver, 'p3-g7-up');
  PERFORM public.t4490_ok((v->>'replayed')::boolean, 'G-7d a replay returns the same change');
  -- G-8 add the Extra hour.
  SELECT version INTO v_ver FROM public.stay_reservation_groups WHERE id = v_gid;
  v := public.issue_4490_guest_change_booking(v_gid, v_tok, NULL, 'add_extras',
    jsonb_build_object('extras', jsonb_build_array(jsonb_build_object('id', (SELECT hour FROM t4490_extra)))), false, v_ver, 'p3-g8-extra');
  v_b := public.issue_4490_get_offer_booking(v_gid, v_tok, NULL, NULL);
  PERFORM public.t4490_ok((v_b->>'balanceDueMinor')::bigint = 2150000 + 5375000 AND jsonb_array_length(v_b->'extras') = 2,
    'G-8 the Extra hour adds N50,000 + VAT N3,750 to the balance; the booking lists both extras');
  INSERT INTO t4490_ids VALUES ('g2_version', NULL);
END
$g7$;

-- G-9 paid at the venue (finance manager; check-in staff cannot).
SELECT public.t4490_as('44907000-0000-4000-8000-000000000003');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_record_offline_payment(%L::uuid, 1000000, 'cash', NULL, NULL, 'p3-g9-door')$$,
  (SELECT t.v FROM t4490_ids t WHERE t.k = 'g2')), '42501', 'not_authorized', 'G-9a check-in-only staff cannot record money');
SELECT public.t4490_as('44907000-0000-4000-8000-000000000002');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_record_offline_payment(%L::uuid, 99999999, 'cash', NULL, NULL, 'p3-g9-over')$$,
  (SELECT t.v FROM t4490_ids t WHERE t.k = 'g2')), '22023', 'offer_amount_over_balance', 'G-9b more than the balance is refused');
SELECT public.t4490_ok((public.issue_4490_record_offline_payment((SELECT t.v FROM t4490_ids t WHERE t.k = 'g2'), 1000000, 'cash',
    NULL, 'Paid at the door', 'p3-g9-cash')->>'balanceMinor')::bigint = 2150000 + 5375000 - 1000000,
  'G-9c a finance manager records N10,000 cash taken at the venue; the balance drops by it');
SELECT public.t4490_ok((public.issue_4490_get_booking((SELECT t.v FROM t4490_ids t WHERE t.k = 'g2'))->'paidAtVenue'->0->>'method') = 'cash'
    AND (public.issue_4490_get_booking((SELECT t.v FROM t4490_ids t WHERE t.k = 'g2'))->>'paidAtVenueMinor')::bigint = 1000000,
  'G-9d the staff booking read lists it');
-- G-10 check-in shows the balance.
SELECT public.t4490_service();
SELECT public.t4490_ok((public.issue_4490_pass_view((SELECT id FROM public.venue_passes WHERE group_id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'g2')))
    ->>'balanceDueMinor')::bigint = 2150000 + 5375000 - 1000000,
  'G-10 the check-in pass shows the balance due');

-- G-11 move to next Saturday 16:00 (guest, within 24 h cut-off; same price).
DO $g11$
DECLARE
  v_gid uuid := (SELECT t.v FROM t4490_ids t WHERE t.k = 'g2');
  v_tok bytea := sha256(convert_to('tok:g2', 'UTF8'));
  v jsonb;
  v_b jsonb;
  v_sat0 record;
  v_nsat0 record;
  v_sat1 record;
  v_nsat1 record;
BEGIN
  SELECT * INTO v_sat0 FROM public.issue_4490_pool_day_usage((SELECT t.v FROM t4490_ids t WHERE t.k = 'pool'), (SELECT saturday FROM t4490_dates));
  SELECT * INTO v_nsat0 FROM public.issue_4490_pool_day_usage((SELECT t.v FROM t4490_ids t WHERE t.k = 'pool'), (SELECT next_saturday FROM t4490_dates));
  v := public.issue_4490_guest_change_booking(v_gid, v_tok, NULL, 'move_date',
    jsonb_build_object('windowId', public.t4490_pkgwin((SELECT next_saturday FROM t4490_dates), '16:00')), false,
    (SELECT version FROM public.stay_reservation_groups WHERE id = v_gid), 'p3-g11-move');
  PERFORM public.t4490_ok((v->>'amountMinor')::bigint = 0 AND (v->>'toDate')::date = (SELECT next_saturday FROM t4490_dates),
    'G-11a moving to next Saturday costs nothing (same price, no fee)');
  v_b := public.issue_4490_get_offer_booking(v_gid, v_tok, NULL, NULL);
  PERFORM public.t4490_ok((v_b->'window'->>'localDate')::date = (SELECT next_saturday FROM t4490_dates)
      AND (v_b->'passes'->0->>'validLocalDate')::date = (SELECT next_saturday FROM t4490_dates)
      AND (v_b->'changeRules'->>'changesUsed')::int = 1,
    'G-11b the booking and its pass are now for next Saturday; one move used');
  SELECT * INTO v_sat1 FROM public.issue_4490_pool_day_usage((SELECT t.v FROM t4490_ids t WHERE t.k = 'pool'), (SELECT saturday FROM t4490_dates));
  SELECT * INTO v_nsat1 FROM public.issue_4490_pool_day_usage((SELECT t.v FROM t4490_ids t WHERE t.k = 'pool'), (SELECT next_saturday FROM t4490_dates));
  PERFORM public.t4490_ok(v_sat1.used = v_sat0.used - 14 AND v_nsat1.used = v_nsat0.used + 14,
    'G-11c the 14 seats moved from this Saturday''s day limit to next Saturday''s');
  -- G-12 fewer guests while money is still owed: the balance drops, nothing refunded.
  v := public.issue_4490_guest_change_booking(v_gid, v_tok, NULL, 'change_guests', '{"guests":12}'::jsonb, false,
    (SELECT version FROM public.stay_reservation_groups WHERE id = v_gid), 'p3-g12-down');
  v_b := public.issue_4490_get_offer_booking(v_gid, v_tok, NULL, NULL);
  PERFORM public.t4490_ok((v->>'refundMinor')::bigint = 0 AND (v->>'feeMinor')::bigint = 0
      AND (v_b->>'balanceDueMinor')::bigint = 2150000 + 5375000 - 1000000 - 2150000,
    'G-12 14 -> 12 more than 3 days ahead (100% rung): the balance drops by N21,500, nothing to refund');
END
$g11$;

-- G-13 an overpaid booking: fewer guests refunds the difference at the
-- booking's snapshotted ladder, even after the host changes the ladder.
DO $g13a$
DECLARE
  v_q jsonb;
  v_gid uuid := gen_random_uuid();
BEGIN
  v_q := public.issue_4490_quote_offer((SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg'),
    public.t4490_pkgwin((SELECT saturday FROM t4490_dates), '12:00'),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'squad'), 'guests', 12)),
    public.t4490_key('cart:g13'), NULL, 'p3-g13-q', '[]'::jsonb, '{"Rice for the group":"Native rice"}'::jsonb);
  PERFORM public.issue_4490_create_offer_group(v_gid, (v_q->>'quoteId')::uuid,
    '{"name":"Bola Crew","email":"bola-4490@example.test"}'::jsonb, public.t4490_key('cart:g13'), NULL,
    sha256(convert_to('tok:g13', 'UTF8')), 'p3-g13-hold');
  PERFORM public.t4490_pay_mode(v_gid, 'g13', 'full');
  INSERT INTO t4490_ids VALUES ('g13', v_gid);
END
$g13a$;
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT (public.issue_4490_manage_offer('set_policy', '44907000-0000-4000-9000-0000000000a1',
  jsonb_build_object('offerId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg'), 'refundLadder', '[]'::jsonb),
  (SELECT version FROM public.stay_offerings WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg')), 'p3-g13-noladder')->>'status') AS s;
SELECT public.t4490_service();
DO $g13b$
DECLARE
  v_gid uuid := (SELECT t.v FROM t4490_ids t WHERE t.k = 'g13');
  v jsonb;
  v_b jsonb;
BEGIN
  v := public.issue_4490_guest_change_booking(v_gid, sha256(convert_to('tok:g13', 'UTF8')), NULL, 'change_guests',
    '{"guests":10}'::jsonb, false, (SELECT version FROM public.stay_reservation_groups WHERE id = v_gid), 'p3-g13-down');
  PERFORM public.t4490_ok((v->>'refundMinor')::bigint = 2150000,
    'G-13a paid in full, 12 -> 10 refunds N21,500 (the booking''s 100% rung, not the host''s new "no refunds")');
  PERFORM public.t4490_ok((SELECT count(*) = 1 AND sum(amount_minor) = 2150000 FROM public.stay_refunds
      WHERE group_id = v_gid AND idempotency_key LIKE 'offer-change-refund:%' AND state = 'submitted')
    AND (SELECT sum(ra.amount_minor) FROM public.stay_refund_allocations ra JOIN public.stay_refunds r ON r.id = ra.refund_id
         WHERE r.group_id = v_gid) = 2150000
    AND (SELECT count(*) FROM public.source_refunds s JOIN public.stay_refunds r ON r.source_refund_id = s.id
         WHERE r.group_id = v_gid) = 1,
    'G-13b one refund through the source-refund rail, allocations sum to it');
  v_b := public.issue_4490_get_offer_booking(v_gid, sha256(convert_to('tok:g13', 'UTF8')), NULL, NULL);
  PERFORM public.t4490_ok((v_b->>'totalDueMinor')::bigint = 10750000 AND (v_b->>'balanceDueMinor')::bigint = 0
      AND (v_b->'passes'->0->>'admits')::int = 10, 'G-13c total due N107,500, nothing owed, pass for 10');
END
$g13b$;

-- G-14 deposit maths.
SELECT public.t4490_ok((public.issue_4490_deposit_plan((SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg'),
    public.t4490_pkgwin((SELECT saturday FROM t4490_dates), '12:00'), 201001)->>'depositMinor')::bigint = 100501,
  'G-14a 50% of 201,001 is 100,501 (half up); deposit + balance = total');
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT (public.issue_4490_manage_package('set_payment', '44907000-0000-4000-9000-0000000000a1',
  jsonb_build_object('offerId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg'), 'depositKind', 'fixed', 'depositValue', 99999999,
    'balanceDueDaysBefore', 2),
  (SELECT version FROM public.stay_offerings WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg')), 'p3-g14-fixed')->>'status') AS s;
SELECT public.t4490_service();
SELECT public.t4490_ok((SELECT p->'payModes' = '["full"]'::jsonb AND p->>'collapsed' = 'deposit_covers_total'
    FROM public.issue_4490_deposit_plan((SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg'),
      public.t4490_pkgwin((SELECT saturday FROM t4490_dates), '12:00'), 15050000) p),
  'G-14b a fixed deposit above the total collapses to paying in full');

-- G-15 Half now is refused when the booking has no deposit plan.
DO $g15$
DECLARE
  v_q jsonb;
  v_gid uuid := gen_random_uuid();
BEGIN
  v_q := public.issue_4490_quote_offer((SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg'),
    public.t4490_pkgwin((SELECT saturday FROM t4490_dates), '18:00'),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'squad'), 'guests', 10)),
    public.t4490_key('cart:g15'), NULL, 'p3-g15-q', '[]'::jsonb, '{"Rice for the group":"Coconut rice"}'::jsonb);
  PERFORM public.issue_4490_create_offer_group(v_gid, (v_q->>'quoteId')::uuid,
    '{"name":"Chi Late","email":"chi-4490@example.test"}'::jsonb, public.t4490_key('cart:g15'), NULL,
    sha256(convert_to('tok:g15', 'UTF8')), 'p3-g15-hold');
  BEGIN
    PERFORM public.issue_4490_prepare_offer_payment(v_gid, sha256(convert_to('tok:g15', 'UTF8')), NULL, 'p3-g15-dep', 1, 'deposit');
    RAISE EXCEPTION 'T4490 FAIL: G-15';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    PERFORM public.t4490_ok(SQLERRM = 'offer_pay_mode_unavailable', 'G-15 Half now is refused when the plan is pay in full');
  END;
  INSERT INTO t4490_ids VALUES ('g15', v_gid);
END
$g15$;

-- G-16 cancelling the Squad booking refunds both online payments (deposit and
-- balance) at its ladder; cash taken at the venue stays with the venue.
DO $g16$
DECLARE
  v_gid uuid := (SELECT t.v FROM t4490_ids t WHERE t.k = 'g2');
  v_tok bytea := sha256(convert_to('tok:g2', 'UTF8'));
  v_pv jsonb;
  v_ids uuid[];
  v_c jsonb;
BEGIN
  v_pv := public.issue_4490_cancel_preview(v_gid, v_tok, NULL);
  PERFORM public.t4490_ok(jsonb_array_length(v_pv->'previews') = 2 AND (v_pv->>'paidMinor')::bigint = 15050000
      AND (v_pv->>'refundMinor')::bigint = 15050000,
    'G-16a two payments, two preview rows, all N150,500 paid online back (100% rung)');
  SELECT array_agg((x #>> '{}')::uuid) INTO v_ids FROM jsonb_array_elements(v_pv->'previewIds') x;
  v_c := public.issue_4490_cancel(v_ids, v_pv->>'previewHash', 'p3-g16-cancel', 'Plans changed', v_tok, NULL);
  PERFORM public.t4490_ok(v_c->>'state' = 'cancelled' AND jsonb_array_length(v_c->'refunds') = 2
      AND (v_c->>'refundMinor')::bigint = 15050000, 'G-16b cancelled with two refunds');
  PERFORM public.t4490_ok((SELECT status FROM public.venue_passes WHERE group_id = v_gid) = 'refunded'
      AND (SELECT count(*) FROM public.stay_inventory_commitments WHERE group_id = v_gid AND state = 'active') = 0,
    'G-16c the pass is refunded and the seats return to next Saturday');
END
$g16$;

-- G-17 a payment that lands after the hold lapsed and the sweep cancelled the
-- booking is refund due; the booking stays cancelled (no transition error).
DO $g17$
DECLARE
  v_gid uuid := (SELECT t.v FROM t4490_ids t WHERE t.k = 'g15');
  v_p jsonb;
  v_ref text;
  v_f jsonb;
BEGIN
  v_p := public.issue_4490_prepare_offer_payment(v_gid, sha256(convert_to('tok:g15', 'UTF8')), NULL, 'p3-g17-pay', 1, 'full');
  v_ref := 'mingla_stay_' || replace(v_p->>'attemptId', '-', '');
  PERFORM public.issue_1389_bind_payment_attempt((v_p->>'attemptId')::uuid, v_ref, NULL, NULL);
  UPDATE public.stay_inventory_holds SET expires_at = now() - interval '1 minute' WHERE group_id = v_gid;
  PERFORM public.issue_1388_expire_groups(50, gen_random_uuid());
  PERFORM public.t4490_ok((SELECT state FROM public.stay_reservation_groups WHERE id = v_gid) IN ('cancelled', 'request_expired'),
    'G-17a the sweep closed the lapsed booking');
  v_f := public.issue_1389_finalize_payment('paystack', 'evt-g17', 'charge.success', v_ref, 'ch-g17',
    (v_p->>'amountMinor')::bigint, 'NGN', 0, NULL);
  PERFORM public.t4490_ok(v_f->>'state' = 'refund_due'
      AND (SELECT state FROM public.stay_reservation_groups WHERE id = v_gid) IN ('cancelled', 'request_expired'),
    'G-17b the late payment is recorded as refund due and the booking keeps its closed state');
END
$g17$;

-- G-18 the offer sweep: one reminder before the due date, overdue notices on
-- the due date and 3 days after; a second run sends nothing new.
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT (public.issue_4490_manage_package('set_payment', '44907000-0000-4000-9000-0000000000a1',
  jsonb_build_object('offerId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg'), 'depositKind', 'percent', 'depositValue', 5000,
    'balanceDueDaysBefore', 2),
  (SELECT version FROM public.stay_offerings WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg')), 'p3-g18-percent')->>'status') AS s;
SELECT public.t4490_service();
DO $g18$
DECLARE
  v_q jsonb;
  v_gid uuid := gen_random_uuid();
BEGIN
  v_q := public.issue_4490_quote_offer((SELECT t.v FROM t4490_ids t WHERE t.k = 'pkg'),
    public.t4490_pkgwin((SELECT saturday FROM t4490_dates), '14:00'),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'squad'), 'guests', 10)),
    public.t4490_key('cart:g18'), NULL, 'p3-g18-q', '[]'::jsonb, '{"Rice for the group":"Party jollof"}'::jsonb);
  PERFORM public.issue_4490_create_offer_group(v_gid, (v_q->>'quoteId')::uuid,
    '{"name":"Dayo Owes","email":"dayo-4490@example.test"}'::jsonb, public.t4490_key('cart:g18'), NULL,
    sha256(convert_to('tok:g18', 'UTF8')), 'p3-g18-hold');
  PERFORM public.t4490_pay_mode(v_gid, 'g18', 'deposit');
  INSERT INTO t4490_ids VALUES ('g18', v_gid);
END
$g18$;
-- Time travel (test only): the booking was made 10 days ago, due in 12 hours.
SELECT public.t4490_reset();
SET LOCAL session_replication_role = replica;
UPDATE public.stay_reservation_groups SET created_at = now() - interval '10 days', balance_due_at = now() + interval '12 hours'
WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'g18');
SET LOCAL session_replication_role = origin;
SELECT public.t4490_service();
CREATE TEMP TABLE t4490_sweep ON COMMIT DROP AS SELECT public.issue_4490_offer_sweep(100) AS r;
GRANT SELECT ON t4490_sweep TO PUBLIC;
SELECT public.t4490_ok((SELECT (r->>'reminders')::int FROM t4490_sweep) = 1 AND (SELECT count(*) FROM public.notification_outbox
    WHERE category_key = 'venue_balance_due' AND payload->>'venue_group_id' = (SELECT t.v FROM t4490_ids t WHERE t.k = 'g18')::text) = 1,
  'G-18a 12 hours before the due date: one balance reminder (the 1-day one)');
SELECT public.t4490_ok((public.issue_4490_offer_sweep(100)->>'reminders')::int = 0, 'G-18b a second run sends nothing new');
SELECT public.t4490_reset();
SET LOCAL session_replication_role = replica;
UPDATE public.stay_reservation_groups SET balance_due_at = now() - interval '1 hour'
WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'g18');
SET LOCAL session_replication_role = origin;
SELECT public.t4490_service();
SELECT (public.issue_4490_offer_sweep(100)->>'overdue') AS overdue_on_due_date;
SELECT public.t4490_reset();
SET LOCAL session_replication_role = replica;
UPDATE public.stay_reservation_groups SET balance_due_at = now() - interval '3 days 1 hour'
WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'g18');
SET LOCAL session_replication_role = origin;
SELECT public.t4490_service();
SELECT (public.issue_4490_offer_sweep(100)->>'overdue') AS overdue_after_3_days;
SELECT (public.issue_4490_offer_sweep(100)->>'overdue') AS overdue_again;
SELECT public.t4490_ok((SELECT count(*) FROM public.notification_outbox
    WHERE category_key = 'venue_balance_overdue'
      AND payload->>'venue_group_id' = (SELECT t.v FROM t4490_ids t WHERE t.k = 'g18')::text) = 2
  AND (SELECT state FROM public.stay_reservation_groups WHERE id = (SELECT t.v FROM t4490_ids t WHERE t.k = 'g18')) = 'confirmed',
  'G-18c overdue notices on the due date and 3 days after, once each; the booking is not cancelled');

-- G-19 guards. (This suite is one transaction: clear the change markers the
-- earlier changes left, as a new request would start without them.)
SELECT set_config('mingla.issue_4490_booking_change', '', true), set_config('mingla.issue_4490_offer_rail', '', true);
SELECT public.t4490_expect(format($$UPDATE public.stay_inventory_commitments SET quantity = 99 WHERE group_id = %L::uuid$$,
  (SELECT t.v FROM t4490_ids t WHERE t.k = 'g13')), '55000', 'stay_commitment_identity_immutable',
  'G-19a a commitment cannot change outside a booking change');
SELECT public.t4490_expect(format($$INSERT INTO public.venue_booking_amendments (group_id, kind, price_delta_minor, actor_type,
    idempotency_key, request_hash) VALUES (%L::uuid, 'balance_adjust', -100000, 'staff', 'sneaky-adjust', repeat('a', 64))$$,
  (SELECT t.v FROM t4490_ids t WHERE t.k = 'g18')), '42501', 'offer_rail_required', 'G-19b amendments are written only by the change RPC');
SELECT public.t4490_expect($$UPDATE public.venue_booking_amendments SET price_delta_minor = 0$$, '55000',
  'venue_booking_history_immutable', 'G-19c amendments are append-only');
SELECT public.t4490_expect(format($$UPDATE public.stay_reservation_groups SET booking_answers = '{}'::jsonb WHERE id = %L::uuid$$,
  (SELECT t.v FROM t4490_ids t WHERE t.k = 'g13')), '55000', 'stay_group_snapshot_immutable', 'G-19d the answers are frozen');

-- G-20 permissions.
SELECT public.t4490_reset();
DO $g20$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.issue_4490_guest_change_booking(uuid,bytea,uuid,text,jsonb,boolean,bigint,text)',
    'public.issue_4490_record_offline_payment_for(uuid,uuid,bigint,text,text)',
    'public.issue_4490_offer_sweep(integer)',
    'public.issue_4490_quote_offer(uuid,uuid,jsonb,text,uuid,text,jsonb,jsonb)',
    'public.issue_4490_prepare_offer_payment(uuid,bytea,uuid,text,bigint,text)',
    'public.issue_4490_change_booking_internal(uuid,text,jsonb,boolean,text,uuid,bytea,bigint,text)',
    'public.issue_4490_refund_amount_internal(uuid,bigint,text,uuid,bytea,text,text)'] LOOP
    PERFORM public.t4490_ok(NOT has_function_privilege('anon', v_fn, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'G-20a clients cannot call ' || v_fn);
  END LOOP;
  PERFORM public.t4490_ok(NOT has_table_privilege('authenticated', 'public.venue_booking_amendments', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.venue_offline_payments', 'SELECT')
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.venue_offline_payments'::regclass),
    'G-20b new tables: RLS on, no client writes, no anon reads');
END
$g20$;
SELECT public.t4490_as('44907000-0000-4000-8000-000000000005');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_change_booking(%L::uuid, 'change_guests', '{"guests":11}'::jsonb, true)$$,
  (SELECT t.v FROM t4490_ids t WHERE t.k = 'g18')), '42501', 'not_authorized', 'G-20c an outsider cannot change a booking');
SELECT public.t4490_expect(format($$SELECT public.issue_4490_get_booking(%L::uuid)$$,
  (SELECT t.v FROM t4490_ids t WHERE t.k = 'g18')), '42501', 'not_authorized', 'G-20d an outsider cannot read it');
SELECT public.t4490_ok((SELECT count(*) FROM public.venue_booking_amendments) = 0, 'G-20e an outsider reads no amendments (RLS)');
SELECT public.t4490_as('44907000-0000-4000-8000-000000000001');
SELECT public.t4490_ok((SELECT count(*) FROM public.venue_booking_amendments) >= 4, 'G-20f the owner reads the venue''s amendments');
SELECT public.t4490_ok((public.issue_4490_change_booking((SELECT t.v FROM t4490_ids t WHERE t.k = 'g18'), 'change_guests',
    '{"guests":11}'::jsonb, true)->>'amountMinor')::bigint = 1075000,
  'G-20g the owner previews a staff change (+1 guest = N10,750)');
SELECT public.t4490_ok((public.issue_4490_preview_day_closure('44907000-0000-4000-9000-0000000000a1',
    (SELECT saturday FROM t4490_dates))->>'count')::int >= 2,
  'G-20h day closure preview lists the bookings on that day');

-- G-21 entry passes: changes follow the entry rule (moves until 2 h before).
SELECT public.t4490_service();
DO $g21$
DECLARE
  v_today uuid;
  v_wed uuid;
  v jsonb;
  v_friday date := (SELECT min(d)::date FROM generate_series((SELECT wednesday FROM t4490_dates) + 1,
                      (SELECT wednesday FROM t4490_dates) + 3, interval '1 day') d WHERE extract(isodow FROM d) = 5);
BEGIN
  v_today := public.t4490_buy((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT today FROM t4490_dates),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 1)), 'g21-today');
  PERFORM public.t4490_pay(v_today, 'g21-today');
  BEGIN
    PERFORM public.issue_4490_guest_change_booking(v_today, sha256(convert_to('tok:g21-today', 'UTF8')), NULL,
      'change_guests', '{"guests":2}'::jsonb, true, NULL, NULL);
    RAISE EXCEPTION 'T4490 FAIL: G-21a';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM public.t4490_ok(SQLERRM = 'offer_change_too_late', 'G-21a today''s pass can no longer be changed by the guest');
  END;
  v_wed := public.t4490_buy((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), (SELECT wednesday FROM t4490_dates),
    jsonb_build_array(jsonb_build_object('priceOptionId', (SELECT t.v FROM t4490_ids t WHERE t.k = 'walkin'), 'guests', 2)), 'g21-wed');
  PERFORM public.t4490_pay(v_wed, 'g21-wed');
  v := public.issue_4490_guest_change_booking(v_wed, sha256(convert_to('tok:g21-wed', 'UTF8')), NULL, 'move_date',
    jsonb_build_object('windowId', public.t4490_win((SELECT t.v FROM t4490_ids t WHERE t.k = 'offer'), v_friday)), false,
    (SELECT version FROM public.stay_reservation_groups WHERE id = v_wed), 'p3-g21-move');
  PERFORM public.t4490_ok((v->>'toDate')::date = v_friday
      AND (SELECT valid_local_date FROM public.venue_passes WHERE group_id = v_wed) = v_friday,
    'G-21b an entry pass moves to Friday (pass valid on Friday)');
END
$g21$;
SELECT public.t4490_reset();
ROLLBACK;
