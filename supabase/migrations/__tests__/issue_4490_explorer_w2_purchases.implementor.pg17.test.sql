-- #4490 Explorer W2 (20281203414490): executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-SWEEP-VENUE-KINDS | issue #4490 | the verified-identity sweep attaches venue bookings, plans and open waitlist places once each, labelled with kinds, route kinds, offering type and nouns the Explorer app accepts (venue_booking/pass, venue_membership/pass only for a plan that carries a pass (paid-up, payment_due or grace status) and venue_membership/booking for a payable or requested plan, venue_waitlist/booking; offering type venue), never as stay_group, and never attaches a declined, cancelled or expired never-paid plan.
-- MINGLA-INVARIANT: I-4490-VISIT-REMINDER-ONCE | issue #4490 | a live venue booking (confirmed, or partly cancelled with guests still confirmed) gets at most one day-before and one two-hours-before reminder per booking time (a moved booking is reminded for its new time), never when VENUE_VISIT_REMINDERS is off, never for a booking that is not live, never late (counted from when it was made, confirmed or last moved), never a day-before reminder for a visit on the venue's own today, and no booking is starved by the per-run limit.
-- MINGLA-INVARIANT: I-4490-SWEEP-PLAN-WINDOWS | issue #4490 | the sign-up sweep attaches a lapsed or paused plan only while the period it would restart with has not run out (one plan period after the last paid one), and a plan request only while the venue's reply clock (request_response_hours) runs.
--
-- [TEST-MOD-APPROVED #4490] W2 fix round 1: S-3 now expects a just-joined,
-- unpaid plan to be reported with noun 'booking' (W2-N1: it carries no pass);
-- S-3b..S-3e and S-5/S-7 cover every plan state; R-2/R-5/R-7/R-8 look rows up
-- by group and reason because the key now carries the slice start (W2-N3);
-- R-1b, R-12..R-15 cover fairness (W2-N2), moves (W2-N3) and partly
-- cancelled bookings (W2-N4). No assertion was removed or weakened.
--
-- [TEST-MOD-APPROVED #4490] W2 fix round 2: the R fixture now also dates the
-- bookings' confirmation three days back (they were made then) and puts the
-- first visit time on the venue's tomorrow (t4490_tomorrow) instead of "10 and
-- 9 hours from now", because the day-before reminder is now never queued for
-- a visit on the venue's own today (W2-N13) and the old times could fall on
-- today depending on the hour the suite runs. S-10 (W2-N14 windows) and
-- R-16..R-18 (W2-N13) are new. No assertion was removed or weakened.
--
-- S sweep. H sharing. L Purchases reads. R reminders. C categories. A authority.
--
-- FAILS-ON-REVERT: without 20281203414490, S-1 fails (the booking is reported as stay_group),
-- S-3/S-4 fail (memberships and waitlist places are not attached), L-1 fails
-- (issue_4490_my_waitlist_entries does not exist) and R-2 fails (no reminder).
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;
UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'VENUE_VISIT_REMINDERS';

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

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES ('44943000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'w2owner-4490@example.test', now(), now());
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44943000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at)
VALUES ('44943000-0000-4000-9000-000000000010', '44943000-0000-4000-8000-000000000001', 'Gameland W2 4490',
        'gameland-w2-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44943000-0000-4000-9000-0000000000a1', '44943000-0000-4000-9000-000000000010', 'gamelandw24490', 'Gameland W2', 6.45, 3.40, 'play', 'verified', 'NG');

CREATE TEMP TABLE t4490_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490_ids TO PUBLIC;
CREATE FUNCTION public.t4490_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v FROM t4490_ids WHERE k = p_k $f$;
CREATE FUNCTION public.t4490_key(p_seed text) RETURNS text LANGUAGE sql AS $f$ SELECT encode(sha256(convert_to(p_seed, 'UTF8')), 'hex') $f$;
GRANT EXECUTE ON FUNCTION public.t4490_id(text), public.t4490_key(text) TO PUBLIC;

-- Fixture (owner): an Entry offer (every day) and a Memberships plan.
SELECT public.t4490_as('44943000-0000-4000-8000-000000000001');
DO $fx$
DECLARE
  a1 uuid := '44943000-0000-4000-9000-0000000000a1';
  v jsonb;
  v_pool uuid;
  v_offer uuid;
BEGIN
  PERFORM public.issue_4490_set_venue_feature(a1, 'entry', true, NULL, NULL, NULL, 'w2-fx-entry');
  PERFORM public.issue_4490_set_venue_feature(a1, 'memberships', true, NULL, NULL, NULL, 'w2-fx-members');
  v := public.issue_4490_manage_capacity_pool('create', a1, '{"name":"W2 day","dailyLimit":50,"keptForWalkIns":0}'::jsonb, NULL, 'w2-fx-pool');
  v_pool := (v->>'id')::uuid;
  v := public.issue_4490_manage_offer('create_draft', a1, '{"kind":"entry","name":"Entry","entryStyle":"walk_in"}'::jsonb, NULL, 'w2-fx-o1');
  v_offer := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('offer', v_offer);
  v := public.issue_4490_manage_offer('set_pool', a1, jsonb_build_object('offerId', v_offer, 'poolId', v_pool), (v->>'version')::bigint, 'w2-fx-o2');
  v := public.issue_4490_manage_offer('upsert_price_option', a1, jsonb_build_object('offerId', v_offer, 'name', 'Walk-in', 'unit', 'guest',
    'guestMin', 1, 'guestMax', 20, 'priceMinor', 500000), (v->>'version')::bigint, 'w2-fx-o3');
  INSERT INTO t4490_ids SELECT 'walkin', (o->>'id')::uuid FROM jsonb_array_elements(v->'options') o WHERE o->>'name' = 'Walk-in';
  v := public.issue_4490_manage_offer('set_policy', a1, jsonb_build_object('offerId', v_offer, 'refundLadder', jsonb_build_array(
    jsonb_build_object('minMinutesBefore', 0, 'refundBps', 10000)), 'dateChangeRule', jsonb_build_object('allowedUntilMinutesBefore', 120, 'feeBps', 0)),
    (v->>'version')::bigint, 'w2-fx-o4');
  v := public.issue_4490_manage_offer('set_schedule', a1, jsonb_build_object('offerId', v_offer, 'mode', 'full_day',
    'weekdays', jsonb_build_array(0,1,2,3,4,5,6), 'startTime', '00:00', 'endTime', '23:59'), (v->>'version')::bigint, 'w2-fx-o5');
  v := public.issue_4490_manage_offer('publish', a1, jsonb_build_object('offerId', v_offer), (v->>'version')::bigint, 'w2-fx-o6');
  v := public.issue_4490_manage_membership_plan('create', a1, jsonb_build_object('name', 'Hot desk',
    'inclusions', jsonb_build_array('Every weekday'), 'priceMinor', 2500000, 'graceDays', 7), NULL, 'w2-fx-plan');
  INSERT INTO t4490_ids VALUES ('plan', (v->>'id')::uuid);
  v := public.issue_4490_manage_membership_plan('publish', a1, jsonb_build_object('planId', (v->>'id')::uuid), 1, 'w2-fx-plan-pub');
END
$fx$;
SELECT public.t4490_reset();

-- Service: bookings, plans and waitlist places bought by buyer-w2@example.test
-- without an account (plus look-alikes that must NOT attach).
CREATE FUNCTION pg_temp.t4490_book(p_key text, p_email text, p_guests integer, p_pay boolean)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_q jsonb;
  v_g jsonb;
  v jsonb;
BEGIN
  v_q := public.issue_4490_quote_offer(public.t4490_id('offer'), public.t4490_id('win'),
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490_id('walkin'), 'guests', p_guests)),
    public.t4490_key('cart:' || p_key), NULL, 'quote-' || p_key);
  v_g := public.issue_4490_create_offer_group(gen_random_uuid(), (v_q->>'quoteId')::uuid,
    jsonb_build_object('name', 'Tolu Adebayo', 'email', p_email, 'phone', '+2348030004821', 'phoneCountryIso', 'NG'),
    public.t4490_key('cart:' || p_key), NULL, sha256(convert_to('tok:' || p_key, 'UTF8')), 'hold-' || p_key || '-key');
  IF p_pay THEN
    v := public.issue_4490_prepare_offer_payment((v_g->>'groupId')::uuid, sha256(convert_to('tok:' || p_key, 'UTF8')), NULL,
      'pay-' || p_key || '-key', (SELECT version FROM public.stay_reservation_groups WHERE id = (v_g->>'groupId')::uuid));
    PERFORM public.issue_1389_bind_payment_attempt((v->>'attemptId')::uuid,
      'mingla_stay_' || replace(v->>'attemptId', '-', ''), NULL, NULL);
    PERFORM public.issue_1389_finalize_payment('paystack', 'evt-' || p_key, 'charge.success',
      'mingla_stay_' || replace(v->>'attemptId', '-', ''), 'ch-' || p_key, (v->>'amountMinor')::bigint, 'NGN', 0, NULL);
  END IF;
  RETURN (v_g->>'groupId')::uuid;
END
$f$;

DO $buy$
DECLARE
  a1 uuid := '44943000-0000-4000-9000-0000000000a1';
  v_day date := (now() AT TIME ZONE 'Africa/Lagos')::date + 2;
  v_win uuid;
  v jsonb;
BEGIN
  SELECT id INTO v_win FROM public.stay_place_windows WHERE offering_id = public.t4490_id('offer') AND local_date = v_day ORDER BY starts_at LIMIT 1;
  INSERT INTO t4490_ids VALUES ('win', v_win);
  INSERT INTO t4490_ids VALUES ('booking', pg_temp.t4490_book('w2a', 'Buyer-W2@Example.test', 2, true));
  INSERT INTO t4490_ids VALUES ('held', pg_temp.t4490_book('w2h', 'buyer-w2@example.test', 1, false));
  INSERT INTO t4490_ids VALUES ('other', pg_temp.t4490_book('w2o', 'someone-else-w2@example.test', 1, true));
  v := public.issue_4490_membership_join(gen_random_uuid(), public.t4490_id('plan'),
    jsonb_build_object('name', 'Tolu Adebayo', 'email', 'buyer-w2@example.test'), NULL,
    public.t4490_key('cart:m1'), NULL, sha256(convert_to('mtok:w2', 'UTF8')), 'join-w2-key');
  INSERT INTO t4490_ids VALUES ('member', COALESCE((v->>'subscriptionId')::uuid, (v->>'id')::uuid));
  v := public.issue_4490_membership_join(gen_random_uuid(), public.t4490_id('plan'),
    jsonb_build_object('name', 'Tolu Adebayo', 'email', 'buyer-w2@example.test'), NULL,
    public.t4490_key('cart:m2'), NULL, sha256(convert_to('mtok:w2b', 'UTF8')), 'join-w2b-key');
  INSERT INTO t4490_ids VALUES ('member_gone', COALESCE((v->>'subscriptionId')::uuid, (v->>'id')::uuid));
  UPDATE public.venue_membership_subscriptions SET status = 'cancelled', cancelled_at = now()
   WHERE id = public.t4490_id('member_gone');
  INSERT INTO public.venue_waitlist (id, brand_id, venue_id, guest_name, guest_email, party_size, status, source,
    desired_date, desired_from, desired_to, manage_token_hash)
  VALUES
    ('44943000-0000-4000-a000-0000000000e1', '44943000-0000-4000-9000-000000000010', a1, 'Tolu Adebayo',
     'BUYER-W2@example.test', 3, 'waiting', 'guest', v_day, time '19:00', time '21:00', sha256(convert_to('wtok:w2a', 'UTF8'))),
    ('44943000-0000-4000-a000-0000000000e2', '44943000-0000-4000-9000-000000000010', a1, 'Tolu Adebayo',
     'buyer-w2@example.test', 2, 'expired', 'guest', v_day, NULL, NULL, sha256(convert_to('wtok:w2b', 'UTF8'))),
    ('44943000-0000-4000-a000-0000000000e3', '44943000-0000-4000-9000-000000000010', a1, 'Someone Else',
     'someone-else-w2@example.test', 2, 'waiting', 'guest', v_day, NULL, NULL, sha256(convert_to('wtok:w2c', 'UTF8')));
END
$buy$;
INSERT INTO t4490_ids VALUES ('wait', '44943000-0000-4000-a000-0000000000e1'),
  ('wait_closed', '44943000-0000-4000-a000-0000000000e2'), ('wait_other', '44943000-0000-4000-a000-0000000000e3');

-- W2-N1: one plan per state, joined with the buyer's email, then moved to
-- that state (fixture shaping, rolled back with the suite).
DO $plans$
DECLARE
  v jsonb;
  v_k text;
BEGIN
  FOREACH v_k IN ARRAY ARRAY['m_active', 'm_due', 'm_grace', 'm_lapsed', 'm_paused', 'm_requested',
                            'm_approved', 'm_approved_late', 'm_stale', 'm_declined']
  LOOP
    v := public.issue_4490_membership_join(gen_random_uuid(), public.t4490_id('plan'),
      jsonb_build_object('name', 'Tolu Adebayo', 'email', 'buyer-w2@example.test'), NULL,
      public.t4490_key('cart:' || v_k), NULL, sha256(convert_to('mtok:' || v_k, 'UTF8')), 'join-' || v_k || '-key');
    INSERT INTO t4490_ids VALUES (v_k, COALESCE((v->>'subscriptionId')::uuid, (v->>'id')::uuid));
  END LOOP;
END
$plans$;
ALTER TABLE public.venue_membership_subscriptions DISABLE TRIGGER USER;
UPDATE public.venue_membership_subscriptions
   SET status = CASE id
         WHEN public.t4490_id('m_active') THEN 'active' WHEN public.t4490_id('m_due') THEN 'payment_due'
         WHEN public.t4490_id('m_grace') THEN 'grace' ELSE 'lapsed' END,
       current_period_start = now() - interval '20 days', current_period_end = now() + interval '10 days'
 WHERE id IN (public.t4490_id('m_active'), public.t4490_id('m_due'), public.t4490_id('m_grace'), public.t4490_id('m_lapsed'));
UPDATE public.venue_membership_subscriptions
   SET status = 'paused', pause_reason = 'member', paused_since = now(),
       current_period_start = now() - interval '40 days', current_period_end = now() - interval '10 days'
 WHERE id = public.t4490_id('m_paused');
UPDATE public.venue_membership_subscriptions SET status = 'requested' WHERE id = public.t4490_id('m_requested');
UPDATE public.venue_membership_subscriptions SET decided_at = now() - interval '1 day'
 WHERE id = public.t4490_id('m_approved');
UPDATE public.venue_membership_subscriptions SET created_at = now() - interval '6 days', decided_at = now() - interval '4 days'
 WHERE id = public.t4490_id('m_approved_late');
UPDATE public.venue_membership_subscriptions SET created_at = now() - interval '3 days'
 WHERE id = public.t4490_id('m_stale');
UPDATE public.venue_membership_subscriptions SET status = 'declined', decided_at = now()
 WHERE id = public.t4490_id('m_declined');
ALTER TABLE public.venue_membership_subscriptions ENABLE TRIGGER USER;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('44943000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'buyer-w2-account@example.test', now(), now()),
  ('44943000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'friend-w2@example.test', now(), now()),
  ('44943000-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'stranger-w2@example.test', now(), now());
INSERT INTO public.account_claim_contacts (user_id, channel, value, verified_via)
VALUES ('44943000-0000-4000-8000-0000000000c1', 'email', 'buyer-w2@example.test', 'email_code');

-- ===========================================================================
-- S: the sweep attaches each kind once, with values the app accepts.
-- ===========================================================================
DO $s$
DECLARE
  v jsonb;
  v_item jsonb;
BEGIN
  v := public.claim_attendance_by_verified_identity('44943000-0000-4000-8000-0000000000c1');
  SELECT item INTO v_item FROM jsonb_array_elements(v->'claimed') item WHERE (item->>'id')::uuid = public.t4490_id('booking');
  PERFORM public.t4490_ok(v_item->>'kind' = 'venue_booking' AND v_item->>'routeKind' = 'venue_booking'
    AND (v_item->>'routeId')::uuid = public.t4490_id('booking') AND v_item->>'offeringType' = 'venue'
    AND v_item->>'noun' = 'pass' AND v_item->>'source' = 'booking',
    'S-1 the confirmed venue booking is reported as venue_booking / venue / pass');
  PERFORM public.t4490_ok(v_item->>'title' = 'Gameland W2' AND v_item->>'timezone' IS NOT NULL
    AND v_item->>'startsAt' IS NOT NULL AND (v_item->>'quantity')::integer = 2,
    'S-1b it carries the venue, the first slice start, the venue zone and the guests');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'claimed') item WHERE item->>'kind' = 'stay_group'),
    'S-2 no venue booking is reported as a stay_group');
  SELECT item INTO v_item FROM jsonb_array_elements(v->'claimed') item WHERE (item->>'id')::uuid = public.t4490_id('member');
  PERFORM public.t4490_ok(v_item->>'kind' = 'venue_membership' AND v_item->>'routeKind' = 'venue_membership'
    AND v_item->>'offeringType' = 'venue' AND v_item->>'noun' = 'booking' AND v_item->>'title' = 'Hot desk'
    AND v_item->>'venueLine' = 'Gameland W2',
    'S-3 a just-joined unpaid plan is attached as venue_membership / venue / booking (no pass yet)');
  PERFORM public.t4490_ok((SELECT count(*) = 3 AND bool_and(item->>'kind' = 'venue_membership'
        AND item->>'routeKind' = 'venue_membership' AND item->>'offeringType' = 'venue' AND item->>'noun' = 'pass')
      FROM jsonb_array_elements(v->'claimed') item
      WHERE (item->>'id')::uuid IN (public.t4490_id('m_active'), public.t4490_id('m_due'), public.t4490_id('m_grace'))),
    'S-3b active, payment-due and grace plans are announced as a pass');
  PERFORM public.t4490_ok((SELECT count(*) = 4 AND bool_and(item->>'kind' = 'venue_membership' AND item->>'noun' = 'booking')
      FROM jsonb_array_elements(v->'claimed') item
      WHERE (item->>'id')::uuid IN (public.t4490_id('m_lapsed'), public.t4490_id('m_paused'),
        public.t4490_id('m_requested'), public.t4490_id('m_approved'))),
    'S-3c lapsed, paused, requested and approved-awaiting-payment plans attach as a booking, never a pass');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'claimed') item
      WHERE item->>'kind' = 'venue_membership' AND item->>'noun' = 'pass'
        AND (item->>'id')::uuid NOT IN (public.t4490_id('m_active'), public.t4490_id('m_due'), public.t4490_id('m_grace'))),
    'S-3d no other plan is announced as a pass');
  SELECT item INTO v_item FROM jsonb_array_elements(v->'claimed') item WHERE (item->>'id')::uuid = public.t4490_id('wait');
  PERFORM public.t4490_ok(v_item->>'kind' = 'venue_waitlist' AND v_item->>'routeKind' = 'venue_waitlist'
    AND v_item->>'offeringType' = 'venue' AND v_item->>'noun' = 'booking' AND (v_item->>'quantity')::integer = 3
    AND v_item->>'startsAt' IS NOT NULL,
    'S-4 the open waitlist place is reported as venue_waitlist / venue / booking');
  PERFORM public.t4490_ok((v->>'count')::integer = 10 AND jsonb_array_length(v->'claimed') = 10,
    'S-5 exactly ten rows (booking, place, eight plans): held booking, cancelled/declined/expired plans, closed place and other buyers are not swept');
  PERFORM public.t4490_ok(
    (SELECT user_id FROM public.stay_reservation_groups WHERE id = public.t4490_id('booking')) = '44943000-0000-4000-8000-0000000000c1'
    AND (SELECT user_id FROM public.venue_membership_subscriptions WHERE id = public.t4490_id('member')) = '44943000-0000-4000-8000-0000000000c1'
    AND (SELECT consumer_user_id FROM public.venue_waitlist WHERE id = public.t4490_id('wait')) = '44943000-0000-4000-8000-0000000000c1',
    'S-6 the three items now belong to the account');
  PERFORM public.t4490_ok(
    (SELECT user_id IS NULL FROM public.stay_reservation_groups WHERE id = public.t4490_id('held'))
    AND (SELECT user_id IS NULL FROM public.stay_reservation_groups WHERE id = public.t4490_id('other'))
    AND (SELECT user_id IS NULL FROM public.venue_membership_subscriptions WHERE id = public.t4490_id('member_gone'))
    AND (SELECT bool_and(user_id IS NULL) FROM public.venue_membership_subscriptions
          WHERE id IN (public.t4490_id('m_declined'), public.t4490_id('m_stale'), public.t4490_id('m_approved_late')))
    AND (SELECT consumer_user_id IS NULL FROM public.venue_waitlist WHERE id = public.t4490_id('wait_closed'))
    AND (SELECT consumer_user_id IS NULL FROM public.venue_waitlist WHERE id = public.t4490_id('wait_other')),
    'S-7 a held booking, cancelled/declined/never-paid-expired plans, a closed place and a mismatched email stay unattached');
  v := public.claim_attendance_by_verified_identity('44943000-0000-4000-8000-0000000000c1');
  PERFORM public.t4490_ok((v->>'count')::integer = 0, 'S-8 a second sweep attaches nothing (once each)');
  v := public.claim_attendance_by_verified_identity('44943000-0000-4000-8000-0000000000c3');
  PERFORM public.t4490_ok((v->>'count')::integer = 0, 'S-9 an account without the contact attaches nothing');
END
$s$;

-- W2-N14: plans are attached only while they are still actionable. A yearly
-- plan, a 24-hour reply clock for the venue, and plans at each edge
-- (fixture shaping, rolled back with the suite).
SELECT public.t4490_as('44943000-0000-4000-8000-000000000001');
DO $yp$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_manage_membership_plan('create', '44943000-0000-4000-9000-0000000000a1',
    '{"name":"Yearly desk","priceMinor":20000000,"period":"year"}'::jsonb, NULL, 'w2-fx-yplan');
  INSERT INTO t4490_ids VALUES ('yplan', (v->>'id')::uuid);
  v := public.issue_4490_manage_membership_plan('publish', '44943000-0000-4000-9000-0000000000a1',
    jsonb_build_object('planId', (v->>'id')::uuid), 1, 'w2-fx-yplan-pub');
END
$yp$;
SELECT public.t4490_reset();
ALTER TABLE public.venue_booking_settings DISABLE TRIGGER USER;
INSERT INTO public.venue_booking_settings (venue_id, brand_id, timezone, request_response_hours)
VALUES ('44943000-0000-4000-9000-0000000000a1', '44943000-0000-4000-9000-000000000010', 'Africa/Lagos', 24)
ON CONFLICT (venue_id) DO UPDATE SET request_response_hours = 24, timezone = 'Africa/Lagos';
ALTER TABLE public.venue_booking_settings ENABLE TRIGGER USER;
DO $wplans$
DECLARE
  v jsonb;
  v_k text;
BEGIN
  FOREACH v_k IN ARRAY ARRAY['w_lapsed_in', 'w_lapsed_edge', 'w_lapsed_old', 'w_paused_in', 'w_paused_edge',
                            'w_req_in', 'w_req_edge', 'w_req_old', 'w_year_in', 'w_year_edge']
  LOOP
    v := public.issue_4490_membership_join(gen_random_uuid(),
      public.t4490_id(CASE WHEN v_k LIKE 'w_year%' THEN 'yplan' ELSE 'plan' END),
      jsonb_build_object('name', 'Tolu Adebayo', 'email', 'buyer-w2@example.test'), NULL,
      public.t4490_key('cart:' || v_k), NULL, sha256(convert_to('mtok:' || v_k, 'UTF8')), 'join-' || v_k || '-key');
    INSERT INTO t4490_ids VALUES (v_k, COALESCE((v->>'subscriptionId')::uuid, (v->>'id')::uuid));
  END LOOP;
END
$wplans$;
ALTER TABLE public.venue_membership_subscriptions DISABLE TRIGGER USER;
-- Lapsed/paused: the last paid period ended 25 days ago (inside a month),
-- exactly one plan period ago (the edge: out), or 350 days ago.
UPDATE public.venue_membership_subscriptions
   SET status = CASE WHEN id IN (public.t4490_id('w_paused_in'), public.t4490_id('w_paused_edge')) THEN 'paused' ELSE 'lapsed' END,
       pause_reason = CASE WHEN id IN (public.t4490_id('w_paused_in'), public.t4490_id('w_paused_edge')) THEN 'member' END,
       paused_since = CASE WHEN id IN (public.t4490_id('w_paused_in'), public.t4490_id('w_paused_edge')) THEN now() END,
       current_period_start = now() - interval '400 days',
       current_period_end = CASE id
         WHEN public.t4490_id('w_lapsed_in') THEN now() - interval '25 days'
         WHEN public.t4490_id('w_paused_in') THEN now() - interval '25 days'
         WHEN public.t4490_id('w_lapsed_edge') THEN now() - interval '1 month'
         WHEN public.t4490_id('w_paused_edge') THEN now() - interval '1 month'
         WHEN public.t4490_id('w_lapsed_old') THEN now() - interval '350 days'
         WHEN public.t4490_id('w_year_in') THEN now() - interval '360 days'
         WHEN public.t4490_id('w_year_edge') THEN now() - interval '1 year' END
 WHERE id IN (public.t4490_id('w_lapsed_in'), public.t4490_id('w_lapsed_edge'), public.t4490_id('w_lapsed_old'),
              public.t4490_id('w_paused_in'), public.t4490_id('w_paused_edge'),
              public.t4490_id('w_year_in'), public.t4490_id('w_year_edge'));
-- Requests: made 23 h 59 min ago (inside the 24-hour reply clock), exactly
-- 24 hours ago (the edge: the billing run declines it now), or 200 days ago.
UPDATE public.venue_membership_subscriptions
   SET status = 'requested',
       created_at = CASE id
         WHEN public.t4490_id('w_req_in') THEN now() - interval '24 hours' + interval '1 minute'
         WHEN public.t4490_id('w_req_edge') THEN now() - interval '24 hours'
         ELSE now() - interval '200 days' END
 WHERE id IN (public.t4490_id('w_req_in'), public.t4490_id('w_req_edge'), public.t4490_id('w_req_old'));
ALTER TABLE public.venue_membership_subscriptions ENABLE TRIGGER USER;
DO $s10$
DECLARE
  v jsonb;
  v_ids uuid[];
BEGIN
  v := public.claim_attendance_by_verified_identity('44943000-0000-4000-8000-0000000000c1');
  SELECT array_agg((item->>'id')::uuid) INTO v_ids FROM jsonb_array_elements(v->'claimed') item;
  PERFORM public.t4490_ok(public.t4490_id('w_lapsed_in') = ANY(v_ids) AND public.t4490_id('w_paused_in') = ANY(v_ids)
    AND NOT public.t4490_id('w_lapsed_edge') = ANY(v_ids) AND NOT public.t4490_id('w_paused_edge') = ANY(v_ids),
    'S-10 a lapsed or paused monthly plan attaches until one month after its last paid month, not at that moment');
  PERFORM public.t4490_ok(NOT public.t4490_id('w_lapsed_old') = ANY(v_ids)
    AND (SELECT user_id IS NULL FROM public.venue_membership_subscriptions WHERE id = public.t4490_id('w_lapsed_old')),
    'S-10b a plan that lapsed long ago is not attached (nothing announced)');
  PERFORM public.t4490_ok(public.t4490_id('w_year_in') = ANY(v_ids) AND NOT public.t4490_id('w_year_edge') = ANY(v_ids),
    'S-10c a yearly plan uses its own period: inside a year attaches, a year after does not');
  PERFORM public.t4490_ok(public.t4490_id('w_req_in') = ANY(v_ids) AND NOT public.t4490_id('w_req_edge') = ANY(v_ids)
    AND NOT public.t4490_id('w_req_old') = ANY(v_ids),
    'S-10d a request attaches only while the venue''s reply clock runs (24 hours here; at 24 hours it does not)');
  PERFORM public.t4490_ok((SELECT bool_and(item->>'noun' = 'booking') FROM jsonb_array_elements(v->'claimed') item
      WHERE (item->>'id')::uuid IN (public.t4490_id('w_lapsed_in'), public.t4490_id('w_paused_in'),
        public.t4490_id('w_year_in'), public.t4490_id('w_req_in')))
    AND (v->>'count')::integer = 4,
    'S-10e exactly the four plans inside their windows attach, each as a booking');
END
$s10$;

-- ===========================================================================
-- H: sharing by verified identity never shares a venue offer booking.
-- ===========================================================================
INSERT INTO public.account_claim_contacts (user_id, channel, value, verified_via)
VALUES ('44943000-0000-4000-8000-0000000000c2', 'email', 'buyer-w2@example.test', 'email_code');
DO $h$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4473_share_purchases_by_verified_identity('44943000-0000-4000-8000-0000000000c2');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'claimed') item
      WHERE (item->>'id')::uuid = public.t4490_id('booking'))
    AND NOT EXISTS (SELECT 1 FROM public.purchase_shared_holders s
      WHERE s.source_id = public.t4490_id('booking') AND s.user_id = '44943000-0000-4000-8000-0000000000c2'),
    'H-1 the venue booking is not shared with a second account that proves the same email');
END
$h$;

-- ===========================================================================
-- L: Purchases reads (owner sees theirs, others nothing, anon refused).
-- ===========================================================================
SELECT public.t4490_as('44943000-0000-4000-8000-0000000000c1');
SELECT public.t4490_ok((SELECT count(*) = 1 AND bool_and((e->>'id')::uuid = public.t4490_id('wait'))
    AND bool_and(e->>'venueName' = 'Gameland W2' AND e->>'brandSlug' = 'gameland-w2-4490'
      AND e->>'venueSlug' = 'gamelandw24490' AND (e->>'partySize')::integer = 3 AND e->>'desiredFrom' = '19:00'
      AND e->>'desiredTo' = '21:00' AND e->>'status' = 'waiting')
    AND bool_and(e->>'timezone' = 'Africa/Lagos'
      AND (e->>'startsAt')::timestamptz = ((e->>'desiredDate')::date + time '19:00') AT TIME ZONE (e->>'timezone'))
  FROM jsonb_array_elements(public.issue_4490_my_waitlist_entries()) e),
  'L-1 my_waitlist_entries returns the owner''s place with venue, party, window, status and the venue-zone start');
SELECT public.t4490_ok((SELECT count(*) = 1 FROM jsonb_array_elements(public.issue_4490_my_offer_bookings()) b
  WHERE (b->>'groupId')::uuid = public.t4490_id('booking')), 'L-2 my_offer_bookings lists the swept booking');
SELECT public.t4490_reset();
-- A booking paid at the venue is listed too (the row is moved to that state
-- with the guard off; this is fixture shaping, rolled back with the suite).
ALTER TABLE public.stay_reservation_groups DISABLE TRIGGER USER;
UPDATE public.stay_reservation_groups SET payment_collection = 'property' WHERE id = public.t4490_id('booking');
ALTER TABLE public.stay_reservation_groups ENABLE TRIGGER USER;
SELECT public.t4490_as('44943000-0000-4000-8000-0000000000c1');
SELECT public.t4490_ok((SELECT count(*) = 1 FROM jsonb_array_elements(public.issue_4490_my_offer_bookings()) b
  WHERE (b->>'groupId')::uuid = public.t4490_id('booking') AND b->>'paymentCollection' = 'property'),
  'L-3 my_offer_bookings lists a booking paid at the venue');
SELECT public.t4490_as('44943000-0000-4000-8000-0000000000c3');
SELECT public.t4490_ok(public.issue_4490_my_waitlist_entries() = '[]'::jsonb
  AND public.issue_4490_my_offer_bookings() = '[]'::jsonb, 'L-4 another account sees nothing');
SELECT public.t4490_as(NULL);
SELECT public.t4490_expect('SELECT public.issue_4490_my_waitlist_entries()', '42501', NULL, 'L-5 anon cannot read waitlist places');
SELECT public.t4490_reset();
ALTER TABLE public.stay_reservation_groups DISABLE TRIGGER USER;
UPDATE public.stay_reservation_groups SET payment_collection = 'mingla' WHERE id = public.t4490_id('booking');
ALTER TABLE public.stay_reservation_groups ENABLE TRIGGER USER;

-- ===========================================================================
-- R: visit reminders (24 hours and 2 hours before the first slice).
-- ===========================================================================
-- Fixture shaping (rolled back): the booking was made three days ago; a
-- second confirmed booking is cancelled; a third was made just now.
INSERT INTO t4490_ids VALUES ('late', pg_temp.t4490_book('w2l', 'late-w2@example.test', 1, true));
INSERT INTO t4490_ids VALUES ('gone', pg_temp.t4490_book('w2g', 'gone-w2@example.test', 1, true));
ALTER TABLE public.stay_reservation_groups DISABLE TRIGGER USER;
UPDATE public.stay_reservation_groups SET created_at = now() - interval '3 days'
 WHERE id IN (public.t4490_id('booking'), public.t4490_id('gone'), public.t4490_id('other'));
UPDATE public.stay_reservation_groups SET state = 'cancelled' WHERE id = public.t4490_id('gone');
ALTER TABLE public.stay_reservation_groups ENABLE TRIGGER USER;
-- They were paid (confirmed) when they were made, three days ago.
ALTER TABLE public.stay_reservation_events DISABLE TRIGGER USER;
UPDATE public.stay_reservation_events SET created_at = now() - interval '3 days'
 WHERE event_type = 'stay_reservation_confirmed'
   AND group_id IN (public.t4490_id('booking'), public.t4490_id('gone'), public.t4490_id('other'));
ALTER TABLE public.stay_reservation_events ENABLE TRIGGER USER;
SELECT public.t4490_ok((SELECT count(*) = 2 FROM public.stay_reservation_events
  WHERE event_type = 'stay_reservation_confirmed' AND group_id IN (public.t4490_id('booking'), public.t4490_id('other'))),
  'R-0 a paid booking carries its confirmation event (the reminder clock reads it)');
-- A time on the venue's tomorrow that is less than 24 hours away: p_frac of
-- the way from the venue's next midnight to now + 24 hours.
CREATE FUNCTION pg_temp.t4490_tomorrow(p_frac double precision)
RETURNS timestamptz LANGUAGE sql AS $f$
  SELECT x.t + (now() + interval '24 hours' - x.t) * p_frac
  FROM (SELECT (((now() AT TIME ZONE public.issue_4490_venue_timezone('44943000-0000-4000-9000-0000000000a1'))::date + 1)::timestamp
          AT TIME ZONE public.issue_4490_venue_timezone('44943000-0000-4000-9000-0000000000a1')) AS t) x
$f$;
ALTER TABLE public.stay_place_windows DISABLE TRIGGER USER;
UPDATE public.stay_place_windows SET starts_at = pg_temp.t4490_tomorrow(0.5), ends_at = pg_temp.t4490_tomorrow(0.5) + interval '10 hours'
 WHERE id = public.t4490_id('win');
ALTER TABLE public.stay_place_windows ENABLE TRIGGER USER;

SELECT public.t4490_service();
DO $r$
DECLARE
  v jsonb;
  v_row public.notification_outbox%ROWTYPE;
BEGIN
  v := public.issue_4490_offer_sweep(200);
  PERFORM public.t4490_ok((v->>'visitReminders')::integer = 0
    AND NOT EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'venue_visit_reminder'),
    'R-1 with VENUE_VISIT_REMINDERS off nothing is queued');
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'VENUE_VISIT_REMINDERS';
  -- W2-N2: with a limit of one, two due bookings are both reminded over two
  -- runs (the run moves past bookings already reminded), then nothing more.
  v := public.issue_4490_offer_sweep(1);
  PERFORM public.t4490_ok((v->>'visitReminders')::integer = 1, 'R-1b run 1 with limit 1 queues one reminder');
  v := public.issue_4490_offer_sweep(1);
  PERFORM public.t4490_ok((v->>'visitReminders')::integer = 1
    AND (SELECT count(DISTINCT payload->>'venue_group_id') = 2 FROM public.notification_outbox
         WHERE category_key = 'venue_visit_reminder'),
    'R-12 run 2 with limit 1 reminds the second booking (no booking is starved by the limit)');
  v := public.issue_4490_offer_sweep(200);
  SELECT * INTO v_row FROM public.notification_outbox
   WHERE category_key = 'venue_visit_reminder' AND payload->>'reminder_reason' = '24h'
     AND (payload->>'venue_group_id')::uuid = public.t4490_id('booking');
  PERFORM public.t4490_ok(v_row.id IS NOT NULL AND v_row.category_key = 'venue_visit_reminder'
    AND v_row.user_id = '44943000-0000-4000-8000-0000000000c1' AND v_row.contact = 'buyer-w2@example.test'
    AND v_row.country_code IS NULL AND v_row.payload->>'reminder_reason' = '24h'
    AND (v_row.payload->>'venue_group_id')::uuid = public.t4490_id('booking')
    AND (v_row.payload->>'venue_id')::uuid = '44943000-0000-4000-9000-0000000000a1'
    AND v_row.idempotency_key = 'venue_visit_reminder:' || public.t4490_id('booking') || ':24h:'
      || floor(extract(epoch FROM (v_row.payload->>'starts_at')::timestamptz))::bigint,
    'R-2 the day-before reminder is queued for the confirmed booking (owner, email, ids only, NULL country)');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'venue_visit_reminder'
      AND (payload->>'venue_group_id')::uuid IN (public.t4490_id('gone'), public.t4490_id('held'))),
    'R-3 a cancelled and an unpaid booking get no reminder');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'venue_visit_reminder'
      AND (payload->>'venue_group_id')::uuid = public.t4490_id('late')),
    'R-4 a booking made after the day-before moment gets no late day-before reminder');
  PERFORM public.t4490_ok((SELECT count(*) = 1 FROM public.notification_outbox
      WHERE category_key = 'venue_visit_reminder' AND payload->>'reminder_reason' = '24h'
        AND (payload->>'venue_group_id')::uuid = public.t4490_id('other')),
    'R-5 every confirmed booking in range gets its own reminder');
  v := public.issue_4490_offer_sweep(200);
  PERFORM public.t4490_ok((v->>'visitReminders')::integer = 0
    AND (SELECT count(*) = 2 FROM public.notification_outbox WHERE category_key = 'venue_visit_reminder'),
    'R-6 a second run queues nothing new (once each)');
END
$r$;
SELECT public.t4490_reset();
ALTER TABLE public.stay_place_windows DISABLE TRIGGER USER;
UPDATE public.stay_place_windows SET starts_at = now() + interval '90 minutes'
 WHERE id = public.t4490_id('win');
ALTER TABLE public.stay_place_windows ENABLE TRIGGER USER;
-- W2-N4: 'other' becomes partly cancelled (its line is still confirmed).
ALTER TABLE public.stay_reservation_groups DISABLE TRIGGER USER;
UPDATE public.stay_reservation_groups SET state = 'partially_cancelled' WHERE id = public.t4490_id('other');
ALTER TABLE public.stay_reservation_groups ENABLE TRIGGER USER;
SELECT public.t4490_service();
DO $r2$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_offer_sweep(200);
  PERFORM public.t4490_ok((SELECT count(*) = 1 FROM public.notification_outbox
      WHERE category_key = 'venue_visit_reminder' AND payload->>'reminder_reason' = '2h'
        AND (payload->>'venue_group_id')::uuid = public.t4490_id('booking')),
    'R-7 the two-hours-before reminder is queued');
  PERFORM public.t4490_ok((SELECT count(*) = 1 FROM public.notification_outbox
      WHERE category_key = 'venue_visit_reminder' AND payload->>'reminder_reason' = '2h'
        AND (payload->>'venue_group_id')::uuid = public.t4490_id('other')),
    'R-13 a partly cancelled booking with guests still confirmed gets its reminder');
  PERFORM public.t4490_ok((SELECT count(*) = 1 FROM public.notification_outbox
      WHERE (payload->>'venue_group_id')::uuid = public.t4490_id('booking') AND category_key = 'venue_visit_reminder'
        AND payload->>'reminder_reason' = '24h'),
    'R-8 the day-before reminder is not sent again');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.notification_outbox WHERE category_key = 'venue_visit_reminder'
      AND (payload->>'venue_group_id')::uuid = public.t4490_id('late')),
    'R-9 a booking made inside the two-hour mark gets no late reminder');
  v := public.issue_4490_offer_sweep(200);
  PERFORM public.t4490_ok((v->>'visitReminders')::integer = 0, 'R-10 the two-hour reminder is queued once');
END
$r2$;
SELECT public.t4490_reset();
-- W2-N3: the booking moves to a new time, earlier on the venue's tomorrow
-- (its first reminder was for a later time). It was booked three days ago,
-- so the day-before reminder for the NEW time is due.
ALTER TABLE public.stay_place_windows DISABLE TRIGGER USER;
UPDATE public.stay_place_windows SET starts_at = pg_temp.t4490_tomorrow(0.25)
 WHERE id = public.t4490_id('win');
ALTER TABLE public.stay_place_windows ENABLE TRIGGER USER;
SELECT public.t4490_service();
DO $r4$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_offer_sweep(200);
  PERFORM public.t4490_ok((SELECT count(*) = 1 FROM public.notification_outbox
      WHERE category_key = 'venue_visit_reminder' AND payload->>'reminder_reason' = '24h'
        AND (payload->>'venue_group_id')::uuid = public.t4490_id('booking')
        AND (payload->>'starts_at')::timestamptz = (SELECT starts_at FROM public.stay_place_windows WHERE id = public.t4490_id('win'))),
    'R-14 a booking moved to a new time gets the day-before reminder for the new time');
  v := public.issue_4490_offer_sweep(200);
  PERFORM public.t4490_ok((v->>'visitReminders')::integer = 0, 'R-14b once each per booking time');
END
$r4$;
SELECT public.t4490_reset();
-- A move made just now (inside the day-before mark) is not reminded late.
ALTER TABLE public.stay_place_windows DISABLE TRIGGER USER;
UPDATE public.stay_place_windows SET starts_at = now() + interval '12 hours'
 WHERE id = public.t4490_id('win');
ALTER TABLE public.stay_place_windows ENABLE TRIGGER USER;
ALTER TABLE public.stay_reservation_events DISABLE TRIGGER USER;
INSERT INTO public.stay_reservation_events (group_id, event_type, actor_type, idempotency_key, safe_metadata)
VALUES (public.t4490_id('booking'), 'stay_offer_changed', 'guest', 'offer-change:w2-move-now',
        jsonb_build_object('action', 'move_date'));
ALTER TABLE public.stay_reservation_events ENABLE TRIGGER USER;
SELECT public.t4490_service();
DO $r5$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_offer_sweep(200);
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.notification_outbox
      WHERE category_key = 'venue_visit_reminder' AND (payload->>'venue_group_id')::uuid = public.t4490_id('booking')
        AND (payload->>'starts_at')::timestamptz = (SELECT starts_at FROM public.stay_place_windows WHERE id = public.t4490_id('win'))),
    'R-15 a booking moved inside the day-before mark gets no late day-before reminder');
END
$r5$;
SELECT public.t4490_reset();
ALTER TABLE public.stay_place_windows DISABLE TRIGGER USER;
UPDATE public.stay_place_windows SET starts_at = now() - interval '30 minutes'
 WHERE id = public.t4490_id('win');
ALTER TABLE public.stay_place_windows ENABLE TRIGGER USER;
DELETE FROM public.notification_outbox WHERE category_key = 'venue_visit_reminder';
SELECT public.t4490_service();
DO $r3$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_offer_sweep(200);
  PERFORM public.t4490_ok((v->>'visitReminders')::integer = 0, 'R-11 a visit that already started gets no reminder');
END
$r3$;
SELECT public.t4490_reset();

-- W2-N13: the "never late" clock counts from confirmation. 'other' was made
-- three days ago but only confirmed a minute after its day-before mark (a
-- request approved and paid late, a payment finalized late): no day-before
-- reminder; 'booking' (made and confirmed three days ago) is the control.
ALTER TABLE public.stay_place_windows DISABLE TRIGGER USER;
UPDATE public.stay_place_windows SET starts_at = pg_temp.t4490_tomorrow(0.6)
 WHERE id = public.t4490_id('win');
ALTER TABLE public.stay_place_windows ENABLE TRIGGER USER;
ALTER TABLE public.stay_reservation_events DISABLE TRIGGER USER;
-- (R-15's "moved just now" event is taken away so 'booking' is a clean control.)
DELETE FROM public.stay_reservation_events WHERE idempotency_key = 'offer-change:w2-move-now';
UPDATE public.stay_reservation_events
   SET created_at = (SELECT starts_at FROM public.stay_place_windows WHERE id = public.t4490_id('win'))
                    - interval '24 hours' + interval '1 minute'
 WHERE event_type = 'stay_reservation_confirmed' AND group_id = public.t4490_id('other');
ALTER TABLE public.stay_reservation_events ENABLE TRIGGER USER;
DELETE FROM public.notification_outbox WHERE category_key = 'venue_visit_reminder';
SELECT public.t4490_service();
DO $r6$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_offer_sweep(200);
  PERFORM public.t4490_ok((SELECT count(*) = 1 FROM public.notification_outbox
      WHERE category_key = 'venue_visit_reminder' AND payload->>'reminder_reason' = '24h'
        AND (payload->>'venue_group_id')::uuid = public.t4490_id('booking')),
    'R-16 control: a booking made and confirmed days ago gets the day-before reminder for a visit on the venue''s tomorrow');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.notification_outbox
      WHERE category_key = 'venue_visit_reminder' AND (payload->>'venue_group_id')::uuid = public.t4490_id('other')),
    'R-16b a booking confirmed inside the day-before mark gets no late day-before reminder, however old the booking');
END
$r6$;
SELECT public.t4490_reset();
-- Same-day: the venue's zone is set so that "now" is mid-morning there and
-- the visit is three hours away, on the venue's own today. The booking was
-- made and confirmed three days ago and has had no reminder for this time.
DO $tz$
DECLARE
  v_tz text;
BEGIN
  SELECT z INTO v_tz FROM unnest(ARRAY['Etc/GMT+12','Etc/GMT+10','Etc/GMT+8','Etc/GMT+6','Etc/GMT+4','Etc/GMT+2','Etc/GMT',
      'Etc/GMT-2','Etc/GMT-4','Etc/GMT-6','Etc/GMT-8','Etc/GMT-10','Etc/GMT-12','Etc/GMT-14']) z
   WHERE (now() AT TIME ZONE z)::time BETWEEN time '06:00' AND time '15:00' LIMIT 1;
  ALTER TABLE public.venue_booking_settings DISABLE TRIGGER USER;
  UPDATE public.venue_booking_settings SET timezone = v_tz WHERE venue_id = '44943000-0000-4000-9000-0000000000a1';
  ALTER TABLE public.venue_booking_settings ENABLE TRIGGER USER;
  ALTER TABLE public.stay_place_windows DISABLE TRIGGER USER;
  UPDATE public.stay_place_windows SET starts_at = now() + interval '3 hours' WHERE id = public.t4490_id('win');
  ALTER TABLE public.stay_place_windows ENABLE TRIGGER USER;
  PERFORM public.t4490_ok(v_tz IS NOT NULL
    AND ((now() + interval '3 hours') AT TIME ZONE public.issue_4490_venue_timezone('44943000-0000-4000-9000-0000000000a1'))::date
      = (now() AT TIME ZONE public.issue_4490_venue_timezone('44943000-0000-4000-9000-0000000000a1'))::date,
    'R-17 fixture: the visit is on the venue''s own today');
END
$tz$;
SELECT public.t4490_service();
DO $r7$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_offer_sweep(200);
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.notification_outbox
      WHERE category_key = 'venue_visit_reminder' AND payload->>'reminder_reason' = '24h'
        AND (payload->>'venue_group_id')::uuid = public.t4490_id('booking')
        AND (payload->>'starts_at')::timestamptz = now() + interval '3 hours'),
    'R-17 no "tomorrow" reminder is queued for a visit later the same day (backlog, switch turned on late)');
END
$r7$;
SELECT public.t4490_reset();
-- Two hours before: 'other' confirmed ten minutes ago, inside the two-hour
-- mark of a visit 90 minutes away; 'booking' is the control.
ALTER TABLE public.stay_place_windows DISABLE TRIGGER USER;
UPDATE public.stay_place_windows SET starts_at = now() + interval '90 minutes' WHERE id = public.t4490_id('win');
ALTER TABLE public.stay_place_windows ENABLE TRIGGER USER;
ALTER TABLE public.stay_reservation_events DISABLE TRIGGER USER;
UPDATE public.stay_reservation_events SET created_at = now() - interval '10 minutes'
 WHERE event_type = 'stay_reservation_confirmed' AND group_id = public.t4490_id('other');
ALTER TABLE public.stay_reservation_events ENABLE TRIGGER USER;
DELETE FROM public.notification_outbox WHERE category_key = 'venue_visit_reminder';
SELECT public.t4490_service();
DO $r8$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_offer_sweep(200);
  PERFORM public.t4490_ok((SELECT count(*) = 1 FROM public.notification_outbox
      WHERE category_key = 'venue_visit_reminder' AND payload->>'reminder_reason' = '2h'
        AND (payload->>'venue_group_id')::uuid = public.t4490_id('booking')),
    'R-18 control: the two-hours-before reminder is queued for a booking confirmed long before');
  PERFORM public.t4490_ok(NOT EXISTS (SELECT 1 FROM public.notification_outbox
      WHERE category_key = 'venue_visit_reminder' AND (payload->>'venue_group_id')::uuid = public.t4490_id('other')),
    'R-18b a booking confirmed inside the two-hour mark gets no late two-hours-before reminder');
END
$r8$;
SELECT public.t4490_reset();

-- ===========================================================================
-- C: categories.
-- ===========================================================================
SELECT public.t4490_ok((SELECT default_channels = ARRAY['inapp','push','email'] AND section = 'Venue bookings'
  FROM public.notification_categories WHERE key = 'venue_visit_reminder'),
  'C-1 venue_visit_reminder reaches in-app, push and email (no SMS)');
SELECT public.t4490_ok((SELECT 'push' = ANY(default_channels) AND 'sms' = ANY(default_channels)
  FROM public.notification_categories WHERE key = 'venue_membership_renewal'),
  'C-2 the plan renewal notice reaches push and SMS');
SELECT public.t4490_ok(EXISTS (SELECT 1 FROM public.feature_flags WHERE flag_key = 'VENUE_VISIT_REMINDERS'),
  'C-3 the reminder flag row exists (inserted off by the migration)');

-- ===========================================================================
-- A: authority.
-- ===========================================================================
SELECT public.t4490_as('44943000-0000-4000-8000-0000000000c1');
SELECT public.t4490_expect(format('SELECT public.claim_attendance_by_verified_identity(%L)', '44943000-0000-4000-8000-0000000000c1'),
  '42501', NULL, 'A-1 a signed-in user cannot run the sweep directly');
SELECT public.t4490_expect('SELECT public.issue_4490_offer_sweep(10)', '42501', NULL, 'A-2 a signed-in user cannot run the offer sweep');
SELECT public.t4490_reset();
SELECT public.t4490_ok(NOT has_function_privilege('anon', 'public.issue_4490_my_waitlist_entries()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.issue_4490_my_waitlist_entries()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.issue_4490_my_offer_bookings()', 'EXECUTE'),
  'A-3 the Purchases reads are for signed-in users only');

ROLLBACK;
