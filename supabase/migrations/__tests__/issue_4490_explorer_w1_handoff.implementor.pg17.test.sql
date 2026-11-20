-- #4490 Explorer W1 (20280809364490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-VENUE-CLAIM-NOUNS-KNOWN | issue #4490 | every venue claim subject resolves with a noun the Explorer app already knows (pass, pass, booking, receipt), and a stay_group link never resolves a venue offer booking.
-- MINGLA-INVARIANT: I-4490-PASS-IN-APP-FOLLOWS-FLAG | issue #4490 | the booking and member projections report passInApp from VENUE_PASS_APP_ONLY and never produce a QR without a pepper.
--
-- K claim kinds. S subjects. P projections. A authority.
--
-- FAILS-ON-REVERT: without 20280809364490 K-1 fails (claim_links_subject_kind_check / claim_kind_invalid),
-- S-4 fails (stay_group resolves the offer booking) and P-1 fails (no passInApp).
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES']) k
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
  public.t4490_as(uuid), public.t4490_reset() TO PUBLIC;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES ('44936000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'w1owner-4490@example.test', now(), now());
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44936000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at)
VALUES ('44936000-0000-4000-9000-000000000010', '44936000-0000-4000-8000-000000000001', 'Gameland W1 4490',
        'gameland-w1-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44936000-0000-4000-9000-0000000000a1', '44936000-0000-4000-9000-000000000010', 'gamelandw14490', 'Gameland W1', 6.45, 3.40, 'play', 'verified', 'NG');

CREATE TEMP TABLE t4490_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490_ids TO PUBLIC;
CREATE FUNCTION public.t4490_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v FROM t4490_ids WHERE k = p_k $f$;
CREATE FUNCTION public.t4490_key(p_seed text) RETURNS text LANGUAGE sql AS $f$ SELECT encode(sha256(convert_to(p_seed, 'UTF8')), 'hex') $f$;
GRANT EXECUTE ON FUNCTION public.t4490_id(text), public.t4490_key(text) TO PUBLIC;

-- Fixture (owner): an Entry offer (walk-in, every day) and a Memberships plan.
SELECT public.t4490_as('44936000-0000-4000-8000-000000000001');
DO $fx$
DECLARE
  a1 uuid := '44936000-0000-4000-9000-0000000000a1';
  v jsonb;
  v_pool uuid;
  v_offer uuid;
BEGIN
  PERFORM public.issue_4490_set_venue_feature(a1, 'entry', true, NULL, NULL, NULL, 'w1-fx-entry');
  PERFORM public.issue_4490_set_venue_feature(a1, 'memberships', true, NULL, NULL, NULL, 'w1-fx-members');
  v := public.issue_4490_manage_capacity_pool('create', a1, '{"name":"W1 day","dailyLimit":50,"keptForWalkIns":0}'::jsonb, NULL, 'w1-fx-pool');
  v_pool := (v->>'id')::uuid;
  v := public.issue_4490_manage_offer('create_draft', a1, '{"kind":"entry","name":"Entry","entryStyle":"walk_in"}'::jsonb, NULL, 'w1-fx-o1');
  v_offer := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('offer', v_offer);
  v := public.issue_4490_manage_offer('set_pool', a1, jsonb_build_object('offerId', v_offer, 'poolId', v_pool), (v->>'version')::bigint, 'w1-fx-o2');
  v := public.issue_4490_manage_offer('upsert_price_option', a1, jsonb_build_object('offerId', v_offer, 'name', 'Walk-in', 'unit', 'guest',
    'guestMin', 1, 'guestMax', 20, 'priceMinor', 500000), (v->>'version')::bigint, 'w1-fx-o3');
  INSERT INTO t4490_ids SELECT 'walkin', (o->>'id')::uuid FROM jsonb_array_elements(v->'options') o WHERE o->>'name' = 'Walk-in';
  v := public.issue_4490_manage_offer('set_policy', a1, jsonb_build_object('offerId', v_offer, 'refundLadder', jsonb_build_array(
    jsonb_build_object('minMinutesBefore', 0, 'refundBps', 10000)), 'dateChangeRule', jsonb_build_object('allowedUntilMinutesBefore', 120, 'feeBps', 0)),
    (v->>'version')::bigint, 'w1-fx-o4');
  v := public.issue_4490_manage_offer('set_schedule', a1, jsonb_build_object('offerId', v_offer, 'mode', 'full_day',
    'weekdays', jsonb_build_array(0,1,2,3,4,5,6), 'startTime', '00:00', 'endTime', '23:59'), (v->>'version')::bigint, 'w1-fx-o5');
  v := public.issue_4490_manage_offer('publish', a1, jsonb_build_object('offerId', v_offer), (v->>'version')::bigint, 'w1-fx-o6');
  v := public.issue_4490_manage_membership_plan('create', a1, jsonb_build_object('name', 'Hot desk',
    'inclusions', jsonb_build_array('Every weekday'), 'priceMinor', 2500000, 'graceDays', 7), NULL, 'w1-fx-plan');
  INSERT INTO t4490_ids VALUES ('plan', (v->>'id')::uuid);
  v := public.issue_4490_manage_membership_plan('publish', a1, jsonb_build_object('planId', (v->>'id')::uuid), 1, 'w1-fx-plan-pub');
END
$fx$;
SELECT public.t4490_reset();

-- Service role: a held entry booking for two, a membership, a waitlist place, a classic stay group.
DO $buy$
DECLARE
  a1 uuid := '44936000-0000-4000-9000-0000000000a1';
  v_day date := (now() AT TIME ZONE 'Africa/Lagos')::date + 2;
  v_win uuid;
  v_q jsonb;
  v_g jsonb;
  v jsonb;
BEGIN
  SELECT id INTO v_win FROM public.stay_place_windows WHERE offering_id = public.t4490_id('offer') AND local_date = v_day ORDER BY starts_at LIMIT 1;
  INSERT INTO t4490_ids VALUES ('win', v_win);
  v_q := public.issue_4490_quote_offer(public.t4490_id('offer'), v_win,
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490_id('walkin'), 'guests', 2)),
    public.t4490_key('cart:w1'), NULL, 'quote-w1');
  v_g := public.issue_4490_create_offer_group(gen_random_uuid(), (v_q->>'quoteId')::uuid,
    jsonb_build_object('name', 'Tolu Adebayo', 'email', 'Tolu@Example.test'),
    public.t4490_key('cart:w1'), NULL, sha256(convert_to('tok:w1', 'UTF8')), 'hold-w1-key');
  INSERT INTO t4490_ids VALUES ('booking', (v_g->>'groupId')::uuid);
  v := public.issue_4490_membership_join(gen_random_uuid(), public.t4490_id('plan'),
    jsonb_build_object('name', 'Amaka Obi', 'email', 'amaka-w1@example.test'), NULL,
    public.t4490_key('cart:m1'), NULL, sha256(convert_to('mtok:w1', 'UTF8')), 'join-w1-key');
  INSERT INTO t4490_ids VALUES ('member', COALESCE((v->>'subscriptionId')::uuid, (v->>'id')::uuid));
  INSERT INTO public.venue_waitlist (id, brand_id, venue_id, guest_name, guest_email, party_size, status, source,
    desired_date, desired_from, desired_to, manage_token_hash)
  VALUES ('44936000-0000-4000-a000-0000000000e1', '44936000-0000-4000-9000-000000000010', a1, 'Bisi Ade',
    'bisi-w1@example.test', 3, 'waiting', 'guest', v_day, time '19:00', time '21:00', sha256(convert_to('wtok:w1', 'UTF8')));
END
$buy$;
INSERT INTO t4490_ids VALUES ('wait', '44936000-0000-4000-a000-0000000000e1');

-- ===========================================================================
-- K: the new kinds mint (service role); an unknown kind is refused.
-- ===========================================================================
DO $k$
DECLARE
  v jsonb;
  v2 jsonb;
BEGIN
  v := public.mint_claim_link('venue_booking', public.t4490_id('booking'));
  PERFORM public.t4490_ok(v->>'code' ~ '^[0-9A-Z]{10}$', 'K-1a venue_booking mints a claim code');
  v2 := public.mint_claim_link('venue_booking', public.t4490_id('booking'));
  PERFORM public.t4490_ok(v2->>'code' = v->>'code', 'K-1b a second mint returns the same code');
  v := public.mint_claim_link('venue_membership', public.t4490_id('member'));
  PERFORM public.t4490_ok(v->>'code' IS NOT NULL, 'K-1c venue_membership mints');
  v := public.mint_claim_link('venue_waitlist', public.t4490_id('wait'));
  PERFORM public.t4490_ok(v->>'code' IS NOT NULL, 'K-1d venue_waitlist mints');
  PERFORM public.t4490_expect(format('SELECT public.mint_claim_link(%L, %L)', 'venue_offer', public.t4490_id('booking')),
    '22023', 'claim_kind_invalid', 'K-2 an unknown kind is refused');
  PERFORM public.t4490_expect(format('SELECT public.mint_claim_link(%L, %L)', 'venue_till_sale', gen_random_uuid()),
    'P0002', 'claim_subject_not_found', 'K-3 venue_till_sale is a known kind with no subject until Till payments exist');
  PERFORM public.t4490_expect(format('SELECT public.mint_claim_link(%L, %L)', 'venue_booking', public.t4490_id('member')),
    'P0002', 'claim_subject_not_found', 'K-4 a venue_booking link needs an offer booking');
  PERFORM public.t4490_ok((SELECT count(*) = 3 FROM public.claim_links WHERE subject_kind IN ('venue_booking','venue_membership','venue_waitlist')
    AND subject_id IN (public.t4490_id('booking'), public.t4490_id('member'), public.t4490_id('wait'))), 'K-5 three claim rows stored');
END
$k$;

-- ===========================================================================
-- S: subjects resolve with nouns the app knows; resolve_claim_link agrees.
-- ===========================================================================
DO $s$
DECLARE
  v jsonb;
  v_code text;
BEGIN
  v := public.issue_4063_claim_subject('venue_booking', public.t4490_id('booking'));
  PERFORM public.t4490_ok(v->>'noun' = 'pass' AND v->>'title' = 'Gameland W1' AND (v->>'quantity')::int = 2
    AND v->>'email' = 'tolu@example.test' AND v->>'timezone' IS NOT NULL
    AND (v->>'startsAt')::timestamptz = (SELECT starts_at FROM public.stay_place_windows WHERE id = public.t4490_id('win'))
    AND v->>'preferredProof' = 'email' AND (v->>'claimed')::boolean = false,
    'S-1 venue_booking: noun pass, venue title, 2 guests, window start, venue zone');
  v := public.issue_4063_claim_subject('venue_membership', public.t4490_id('member'));
  PERFORM public.t4490_ok(v->>'noun' = 'pass' AND v->>'title' = 'Hot desk' AND v->>'email' = 'amaka-w1@example.test',
    'S-2 venue_membership: noun pass, plan name');
  v := public.issue_4063_claim_subject('venue_waitlist', public.t4490_id('wait'));
  PERFORM public.t4490_ok(v->>'noun' = 'booking' AND (v->>'quantity')::int = 3 AND v->>'title' = 'Gameland W1'
    AND (v->>'startsAt')::timestamptz = ((((now() AT TIME ZONE 'Africa/Lagos')::date + 2) + time '19:00') AT TIME ZONE (v->>'timezone')),
    'S-3 venue_waitlist: noun booking, party of 3, desired date and time in the venue zone');
  PERFORM public.t4490_ok(public.issue_4063_claim_subject('stay_group', public.t4490_id('booking')) IS NULL,
    'S-4 stay_group no longer resolves a venue offer booking');
  UPDATE public.venue_waitlist SET status = 'converted' WHERE id = public.t4490_id('wait');
  PERFORM public.t4490_ok(public.issue_4063_claim_subject('venue_waitlist', public.t4490_id('wait')) IS NULL,
    'S-5 a closed waitlist place does not resolve');
  UPDATE public.venue_waitlist SET status = 'waiting' WHERE id = public.t4490_id('wait');
  SELECT code INTO v_code FROM public.claim_links WHERE subject_kind = 'venue_booking' AND subject_id = public.t4490_id('booking');
  v := public.resolve_claim_link(v_code);
  PERFORM public.t4490_ok(v->>'kind' = 'venue_booking' AND v->>'noun' = 'pass', 'S-6 resolve_claim_link returns kind venue_booking, noun pass');
END
$s$;

-- ===========================================================================
-- P: passInApp follows the flag; no pepper, no QR.
-- ===========================================================================
DO $p$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_booking_projection(public.t4490_id('booking'), NULL);
  PERFORM public.t4490_ok(v ? 'passInApp' AND (v->>'passInApp')::boolean = false, 'P-1a booking passInApp false while the flag is off');
  v := public.issue_4490_member_projection(public.t4490_id('member'), 'guest', NULL);
  PERFORM public.t4490_ok((v->>'passInApp')::boolean = false AND NOT v ? 'pass', 'P-1b member passInApp false; no pepper, no pass');
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'VENUE_PASS_APP_ONLY';
  v := public.issue_4490_booking_projection(public.t4490_id('booking'), NULL);
  PERFORM public.t4490_ok((v->>'passInApp')::boolean, 'P-2a booking passInApp true with the flag on');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'passes') p WHERE p->>'qrPayload' IS NOT NULL),
    'P-2b no pepper: no pass carries a QR');
  v := public.issue_4490_member_projection(public.t4490_id('member'), 'guest', NULL);
  PERFORM public.t4490_ok((v->>'passInApp')::boolean AND NOT v ? 'pass', 'P-2c member passInApp true; no pepper, no pass');
  PERFORM public.t4490_ok((SELECT count(*) = 2 FROM public.feature_flags WHERE flag_key IN ('VENUE_APP_HANDOFF', 'VENUE_PASS_APP_ONLY')),
    'P-3 both W1 flags exist');
END
$p$;

-- ===========================================================================
-- A: anon and signed-in callers cannot reach the projections or the claim helpers.
-- ===========================================================================
SELECT public.t4490_as(NULL);
SELECT public.t4490_expect(format('SELECT public.issue_4490_booking_projection(%L, NULL)', public.t4490_id('booking')),
  '42501', NULL, 'A-1 anon cannot call the booking projection');
SELECT public.t4490_expect(format('SELECT public.issue_4063_claim_subject(%L, %L)', 'venue_booking', public.t4490_id('booking')),
  '42501', NULL, 'A-2 anon cannot read a claim subject');
SELECT public.t4490_as('44936000-0000-4000-8000-000000000001');
SELECT public.t4490_expect(format('SELECT public.issue_4490_member_projection(%L, %L, NULL)', public.t4490_id('member'), 'guest'),
  '42501', NULL, 'A-3 a signed-in user cannot call the member projection');
SELECT public.t4490_expect(format('SELECT public.mint_claim_link(%L, %L)', 'venue_booking', public.t4490_id('booking')),
  '42501', NULL, 'A-4 a signed-in user cannot mint a claim link');
SELECT public.t4490_reset();

ROLLBACK;
