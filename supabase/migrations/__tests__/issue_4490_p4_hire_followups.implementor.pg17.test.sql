-- #4490 P4 follow-up (20281203174490): "Hours you set" with minimum hours and per-hour places, changing a hire's
-- party and day (claims move), the damage deposit returned after the event. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-HIRE-MOVE-CLAIMS | issue #4490 | moving a hire releases its old space claims and claims the new day in one transaction; the exclusion constraint refuses a day the place is taken.
-- MINGLA-INVARIANT: I-4490-DAMAGE-ONLY | issue #4490 | returning a damage deposit refunds only the damage-deposit allocations of each payment and reverses no platform fee.
--
-- K-1 authoring (Hours you set, per-hour place, extra guests, damage deposit). K-2 a 3-hour Garden booking.
-- K-3 party change with extra guests. K-4 move day (taken day refused; claims move; token / stranger refused).
-- K-5 staff return (too early, money rights, keep with reason, refund only damage, replay). K-6 hold + sweep.
--
-- FAILS-ON-REVERT (seen): restore the P4 change refusal -> K-3a raises offer_change_not_allowed.
\set ON_ERROR_STOP on
BEGIN;
-- (shared #4490 P2 suite fixture; copied into each suite)
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


INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT ('44909200-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p5k' || n || '-4490@example.test', now(), now()
FROM generate_series(1, 7) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44909200-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at)
VALUES ('44909200-0000-4000-9000-000000000010', '44909200-0000-4000-8000-000000000001', 'Harmattan P4 follow-up',
        'harmattan-p4f-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.brand_team_members (id, brand_id, user_id, role, accepted_at) VALUES
  ('44909200-0000-4000-c000-000000000002', '44909200-0000-4000-9000-000000000010', '44909200-0000-4000-8000-000000000002', 'finance_manager', now()),
  ('44909200-0000-4000-c000-000000000003', '44909200-0000-4000-9000-000000000010', '44909200-0000-4000-8000-000000000003', 'venue_staff', now()),
  ('44909200-0000-4000-c000-000000000007', '44909200-0000-4000-9000-000000000010', '44909200-0000-4000-8000-000000000007', 'event_manager', now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44909200-0000-4000-9000-0000000000a1', '44909200-0000-4000-9000-000000000010', 'parkp4f4490', 'Park P4F', 6.45, 3.40, 'play', 'verified', 'NG');

CREATE TEMP TABLE t4490_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490_ids TO PUBLIC;
CREATE FUNCTION public.t4490_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v FROM t4490_ids WHERE k = p_k $f$;
CREATE FUNCTION public.t4490_key(p_seed text) RETURNS text LANGUAGE sql AS $f$ SELECT encode(sha256(convert_to(p_seed, 'UTF8')), 'hex') $f$;
CREATE FUNCTION public.t4490_v(p_offer uuid) RETURNS bigint LANGUAGE sql AS $f$ SELECT version FROM public.stay_offerings WHERE id = p_offer $f$;
CREATE FUNCTION public.t4490_day(p_plus integer) RETURNS date LANGUAGE sql AS $f$ SELECT (now() AT TIME ZONE 'Africa/Lagos')::date + p_plus $f$;
CREATE FUNCTION public.t4490_at(p_hhmm text, p_plus integer) RETURNS timestamptz LANGUAGE sql AS $f$
  SELECT (public.t4490_day(p_plus) + p_hhmm::time) AT TIME ZONE 'Africa/Lagos' $f$;
CREATE FUNCTION public.t4490_evening(p_plus integer) RETURNS uuid LANGUAGE sql AS $f$
  SELECT w.id FROM public.stay_place_windows w JOIN public.stay_place_schedule_rules r ON r.id = w.schedule_rule_id
  WHERE w.offering_id = public.t4490_id('hire') AND w.local_date = public.t4490_day(p_plus) AND r.session_label = 'Evening' AND r.active $f$;
-- Book (instant) on a window, then pay in full: what edge venue-offers does.
CREATE FUNCTION public.t4490_book(p_window uuid, p_option uuid, p_guests integer, p_seed text)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_q jsonb;
  v_g jsonb;
  v_p jsonb;
  v_ref text;
BEGIN
  v_q := public.issue_4490_quote_offer(public.t4490_id('hire'), p_window,
    jsonb_build_array(jsonb_build_object('priceOptionId', p_option, 'guests', p_guests)),
    public.t4490_key('cart:' || p_seed), NULL, 'quote-' || p_seed);
  v_g := public.issue_4490_create_offer_group(gen_random_uuid(), (v_q->>'quoteId')::uuid,
    jsonb_build_object('name', 'Guest ' || p_seed, 'email', p_seed || '@example.test'), public.t4490_key('cart:' || p_seed), NULL,
    sha256(convert_to('tok:' || p_seed, 'UTF8')), 'hold-' || p_seed);
  v_p := public.issue_4490_prepare_offer_payment((v_g->>'groupId')::uuid, sha256(convert_to('tok:' || p_seed, 'UTF8')), NULL,
    'pay-key-' || p_seed, (SELECT version FROM public.stay_reservation_groups WHERE id = (v_g->>'groupId')::uuid), 'full');
  v_ref := 'mingla_stay_' || replace(v_p->>'attemptId', '-', '');
  PERFORM public.issue_1389_bind_payment_attempt((v_p->>'attemptId')::uuid, v_ref, NULL, NULL);
  PERFORM public.issue_1389_finalize_payment('paystack', 'evt-' || p_seed, 'charge.success', v_ref, 'ch-' || p_seed,
    (v_p->>'amountMinor')::bigint, 'NGN', 0, NULL);
  RETURN (v_g->>'groupId')::uuid;
END
$f$;
CREATE FUNCTION public.t4490_gv(p_group uuid) RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$
  SELECT version FROM public.stay_reservation_groups WHERE id = p_group $f$;
GRANT EXECUTE ON FUNCTION public.t4490_gv(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.t4490_id(text), public.t4490_key(text), public.t4490_v(uuid), public.t4490_day(integer),
  public.t4490_at(text, integer), public.t4490_evening(integer), public.t4490_book(uuid, uuid, integer, text) TO PUBLIC;

-- ===========================================================================
-- K-1 A hire with "Hours you set" (minimum 2 hours) and a place priced per hour.
-- ===========================================================================
SELECT public.t4490_as('44909200-0000-4000-8000-000000000001');
DO $k1$
DECLARE
  a1 uuid := '44909200-0000-4000-9000-0000000000a1';
  v jsonb;
  v_offer uuid;
BEGIN
  INSERT INTO t4490_ids SELECT 'hall', (public.issue_4490_manage_space('create', a1,
    '{"name":"Hall","setting":"indoor","capacity_standing":100}'::jsonb)->>'id')::uuid;
  INSERT INTO t4490_ids SELECT 'garden', (public.issue_4490_manage_space('create', a1,
    '{"name":"Garden","setting":"outdoor","capacity_standing":80}'::jsonb)->>'id')::uuid;
  PERFORM public.issue_4490_set_venue_feature(a1, 'private_hire', true, NULL, NULL, NULL, 'p4f-feature');
  PERFORM public.issue_4490_save_booking_settings(a1, '{"vatMode":"added"}'::jsonb, NULL, 'p4f-vat-added');
  v := public.issue_4490_manage_offer('create_draft', a1, '{"kind":"private_hire","name":"Hire the park"}'::jsonb, NULL, 'p4f-draft');
  v_offer := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('hire', v_offer);
  v := public.issue_4490_manage_hire('set_spaces', a1, jsonb_build_object('offerId', v_offer,
    'spaceIds', jsonb_build_array(public.t4490_id('hall'), public.t4490_id('garden'))), public.t4490_v(v_offer), 'p4f-spaces');
  v := public.issue_4490_manage_hire('set_price_row', a1, jsonb_build_object('offerId', v_offer, 'name', 'Hall',
    'spaceId', public.t4490_id('hall'), 'unit', 'booking', 'guestMin', 10, 'guestMax', 100, 'priceMinor', 50000000),
    public.t4490_v(v_offer), 'p4f-row-hall');
  v := public.issue_4490_manage_hire('set_price_row', a1, jsonb_build_object('offerId', v_offer, 'name', 'Garden by the hour',
    'spaceId', public.t4490_id('garden'), 'unit', 'hour', 'guestMin', 10, 'guestMax', 50, 'priceMinor', 10000000),
    public.t4490_v(v_offer), 'p4f-row-garden');
  INSERT INTO t4490_ids SELECT CASE WHEN r->>'name' = 'Hall' THEN 'o_hall' ELSE 'o_garden' END, (r->>'optionId')::uuid
  FROM jsonb_array_elements(v->'hire'->'rows') r;
  v := public.issue_4490_manage_hire('set_sessions', a1, jsonb_build_object('offerId', v_offer,
    'sessions', jsonb_build_array(jsonb_build_object('label', 'Evening', 'startTime', '18:00', 'endTime', '23:00')),
    'weekdays', jsonb_build_array(0, 1, 2, 3, 4, 5, 6)), public.t4490_v(v_offer), 'p4f-sessions');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_manage_hire('set_flexible', %L, jsonb_build_object('offerId', %L,
      'enabled', true, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6), 'startTime', '10:00', 'endTime', '17:00',
      'stepMinutes', 60, 'minMinutes', 90), %s, 'p4f-flex-bad')$q$, a1, v_offer, public.t4490_v(v_offer)),
    '22023', 'hire_flexible_invalid', 'K-1a minimum hours off the hour step are refused');
  v := public.issue_4490_manage_hire('set_flexible', a1, jsonb_build_object('offerId', v_offer, 'enabled', true,
    'weekdays', jsonb_build_array(0,1,2,3,4,5,6), 'startTime', '10:00', 'endTime', '17:00',
    'stepMinutes', 60, 'minMinutes', 120, 'maxMinutes', 360), public.t4490_v(v_offer), 'p4f-flex');
  PERFORM public.t4490_ok((v->'hire'->'hoursYouSet'->>'minMinutes')::integer = 120 AND v->'hire'->'hoursYouSet'->>'startTime' = '10:00'
                          AND jsonb_array_length(v->'hire'->'sessions') = 1,
    'K-1b "Hours you set" 10:00-17:00, at least 2 hours, next to the Evening session');
  v := public.issue_4490_manage_hire('set_terms', a1, jsonb_build_object('offerId', v_offer, 'hireCharge', 'hire_fee',
    'depositKind', 'none', 'balanceDueDaysBefore', 0, 'setupMinutes', 60, 'cleanupMinutes', 60,
    'damageDepositMinor', 10000000, 'extraGuestMinor', 500000), public.t4490_v(v_offer), 'p4f-terms');
  v := public.issue_4490_manage_offer('set_policy', a1, jsonb_build_object('offerId', v_offer,
    'refundLadder', jsonb_build_array(jsonb_build_object('minMinutesBefore', 0, 'refundBps', 10000)),
    'dateChangeRule', jsonb_build_object('allowedUntilMinutesBefore', 1440, 'feeBps', 0, 'maxChanges', 2)),
    public.t4490_v(v_offer), 'p4f-policy');
  v := public.issue_4490_manage_hire('set_booking', a1, jsonb_build_object('offerId', v_offer, 'mode', 'instant'),
    public.t4490_v(v_offer), 'p4f-booking');
  PERFORM public.t4490_ok(v->'readiness' = '[]'::jsonb, 'K-1c ready (a place priced per hour is allowed): ' || (v->'readiness')::text);
  v := public.issue_4490_manage_offer('publish', a1, jsonb_build_object('offerId', v_offer), public.t4490_v(v_offer), 'p4f-publish');
  PERFORM public.t4490_ok(v->>'status' = 'live', 'K-1d live');
END
$k1$;
SELECT public.t4490_reset();

-- ===========================================================================
-- K-2 A guest books the Garden for 3 hours (Hours you set).
-- ===========================================================================
SELECT public.t4490_as(NULL);
DO $k2a$
DECLARE
  v jsonb;
BEGIN
  v := public.pg_venue_hour_day(public.t4490_id('hire'), public.t4490_day(5), 40, public.t4490_id('o_garden'));
  PERFORM public.t4490_ok(v->>'status' = 'open' AND (v->>'minMinutes')::integer = 120
                          AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'starts') x
                                      WHERE (x->>'startsAt')::timestamptz = public.t4490_at('11:00', 5) AND (x->>'maxMinutes')::integer = 360),
    'K-2a the Garden day line: 11:00 free for up to 6 hours (setup 1 h from 10:00)');
END
$k2a$;
SELECT public.t4490_service();
DO $k2$
DECLARE
  w uuid;
  v jsonb;
  g uuid;
BEGIN
  PERFORM public.t4490_expect($q$SELECT public.issue_4490_flexible_window(public.t4490_id('hire'), public.t4490_at('12:00', 5), 60)$q$,
    '22023', 'offer_length_invalid', 'K-2b one hour is less than the minimum 2 hours');
  w := public.issue_4490_flexible_window(public.t4490_id('hire'), public.t4490_at('12:00', 5), 180);
  v := public.issue_4490_quote_offer(public.t4490_id('hire'), w,
    jsonb_build_array(jsonb_build_object('priceOptionId', public.t4490_id('o_garden'), 'guests', 40)),
    public.t4490_key('cart:k2-quote'), NULL, 'quote-k2-quote');
  PERFORM public.t4490_ok((v->>'subtotalMinor')::bigint = 30000000 AND (v->>'taxMinor')::bigint = 2250000
                          AND (v->>'totalMinor')::bigint = 42250000,
    'K-2c Garden 12:00-15:00: 3 x N100,000 = N300,000 + VAT N22,500 + damage deposit N100,000 = N422,500: ' || (v->>'totalMinor'));
  g := public.t4490_book(w, public.t4490_id('o_garden'), 40, 'k2-garden');
  INSERT INTO t4490_ids VALUES ('g_garden', g);
  PERFORM public.t4490_ok((SELECT state FROM public.stay_reservation_groups WHERE id = g) = 'confirmed'
                          AND (SELECT count(*) FROM public.venue_space_claims WHERE group_id = g AND state = 'committed') = 1,
    'K-2d paid in full: confirmed, the Garden claimed 11:00-16:00 (setup and cleanup)');
END
$k2$;

-- ===========================================================================
-- K-3 Change a hire's party (extra guests above the row's 50).
-- ===========================================================================
SELECT public.t4490_as('44909200-0000-4000-8000-000000000007');
DO $k3$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_change_booking(public.t4490_id('g_garden'), 'change_guests', '{"guests":60}'::jsonb, true);
  PERFORM public.t4490_ok((v->>'priceDeltaMinor')::bigint = 5000000 AND (v->>'taxDeltaMinor')::bigint = 375000,
    'K-3a 40 -> 60 guests: 10 above the row''s 50 x N5,000 = N50,000 + VAT N3,750: ' || v::text);
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_change_booking(%L, 'change_guests', '{"guests":90}'::jsonb, true)$q$,
    public.t4490_id('g_garden')), '22023', 'offer_guests_out_of_range', 'K-3b 90 is more than the Garden holds (80)');
  v := public.issue_4490_change_booking(public.t4490_id('g_garden'), 'change_guests', '{"guests":60}'::jsonb, false,
    public.t4490_gv(public.t4490_id('g_garden')), 'k3-guests-60');
  PERFORM public.t4490_ok((public.issue_4490_get_booking(public.t4490_id('g_garden'))->'hire'->>'guests')::integer = 60
                          AND (public.issue_4490_get_booking(public.t4490_id('g_garden'))->>'balanceDueMinor')::bigint = 5375000,
    'K-3c applied: the hire reads 60 guests, N53,750 to pay');
END
$k3$;
SELECT public.t4490_reset();

-- ===========================================================================
-- K-4 Move a hire's day: the Hall moves only to a free evening; claims move.
-- ===========================================================================
SELECT public.t4490_service();
DO $k4$
BEGIN
  INSERT INTO t4490_ids VALUES ('g_hall', public.t4490_book(public.t4490_evening(6), public.t4490_id('o_hall'), 80, 'k4-hall-a'));
  INSERT INTO t4490_ids VALUES ('g_hall_b', public.t4490_book(public.t4490_evening(7), public.t4490_id('o_hall'), 50, 'k4-hall-b'));
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_guest_change_booking(%L, sha256('tok:k4-hall-a'::bytea), NULL,
      'move_date', jsonb_build_object('windowId', %L), true, NULL, NULL)$q$, public.t4490_id('g_hall'), public.t4490_evening(7)),
    'PT409', 'offer_space_taken', 'K-4a the guest cannot move to an evening the Hall is booked');
  PERFORM public.issue_4490_guest_change_booking(public.t4490_id('g_hall'), sha256('tok:k4-hall-a'::bytea), NULL,
    'move_date', jsonb_build_object('windowId', public.t4490_evening(8)), false,
    (SELECT version FROM public.stay_reservation_groups WHERE id = public.t4490_id('g_hall')), 'k4-move-8');
  PERFORM public.t4490_ok(
    (SELECT count(*) FROM public.venue_space_claims c WHERE c.group_id = public.t4490_id('g_hall') AND c.state = 'committed'
       AND lower(c.booked_range) = public.t4490_at('18:00', 8) AND lower(c.claim_range) = public.t4490_at('17:00', 8)) = 1
    AND (SELECT count(*) FROM public.venue_space_claims c WHERE c.group_id = public.t4490_id('g_hall') AND c.release_reason = 'moved') = 1
    AND (public.issue_4490_booking_projection(public.t4490_id('g_hall'), NULL)->'hire'->>'bookedFrom')::timestamptz = public.t4490_at('18:00', 8)
    AND (public.issue_4490_booking_projection(public.t4490_id('g_hall'), NULL)->'window'->>'localDate')::date = public.t4490_day(8),
    'K-4b moved to day 8: the Hall claim moved (17:00 setup), the old one released "moved", the booking reads the new day');
  PERFORM public.t4490_ok((SELECT s.status FROM public.issue_4490_spaces_status(ARRAY[public.t4490_id('hall')],
                             tstzrange(public.t4490_at('17:00', 6), public.t4490_at('23:59', 6)), NULL) s) = 'free',
    'K-4c day 6 is free again for the Hall');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_guest_change_booking(%L, sha256('tok:wrong'::bytea), NULL,
      'move_date', jsonb_build_object('windowId', %L), true, NULL, NULL)$q$, public.t4490_id('g_hall'), public.t4490_evening(9)),
    'P0002', 'offer_booking_not_found', 'K-4d a wrong token moves nothing');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_guest_change_booking(%L, NULL, '44909200-0000-4000-8000-000000000005',
      'move_date', jsonb_build_object('windowId', %L), true, NULL, NULL)$q$, public.t4490_id('g_hall'), public.t4490_evening(9)),
    'P0002', 'offer_booking_not_found', 'K-4e a stranger''s account moves nothing');
END
$k4$;
SELECT public.t4490_reset();

-- ===========================================================================
-- K-5 The damage deposit after the event.
-- ===========================================================================
SELECT public.t4490_as('44909200-0000-4000-8000-000000000002');
SELECT public.t4490_expect(format($q$SELECT public.issue_4490_release_damage_deposit(%L, 0, NULL, 'k5-early-release')$q$,
  public.t4490_id('g_hall')), 'P0001', 'deposit_release_too_early', 'K-5a the deposit is not returned before the hire ends');
SELECT public.t4490_reset();
-- Time travel: the Hall hire ended yesterday; the Garden hire ended 8 days ago.
UPDATE public.venue_space_claims SET booked_range = tstzrange(now() - interval '30 hours', now() - interval '25 hours'),
  claim_range = tstzrange(now() - interval '31 hours', now() - interval '24 hours') WHERE group_id = public.t4490_id('g_hall');
UPDATE public.venue_space_claims SET booked_range = tstzrange(now() - interval '8 days 5 hours', now() - interval '8 days'),
  claim_range = tstzrange(now() - interval '8 days 6 hours', now() - interval '8 days') + tstzrange(now() - interval '8 days', now() - interval '7 days 23 hours')
  WHERE group_id = public.t4490_id('g_garden');
SELECT public.t4490_as('44909200-0000-4000-8000-000000000003');
SELECT public.t4490_expect(format($q$SELECT public.issue_4490_release_damage_deposit(%L, 0, NULL, 'k5-no-money')$q$,
  public.t4490_id('g_hall')), '42501', 'not_authorized', 'K-5b venue staff without money rights cannot return a deposit');
SELECT public.t4490_as('44909200-0000-4000-8000-000000000002');
DO $k5$
DECLARE
  v jsonb;
BEGIN
  PERFORM public.t4490_ok(public.issue_4490_get_booking(public.t4490_id('g_hall'))->'hire'->'damageDeposit'->>'status' = 'collected',
    'K-5c the Hall deposit (N100,000) is collected, waiting to be returned');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_release_damage_deposit(%L, 3000000, NULL, 'k5-keep-noreason')$q$,
    public.t4490_id('g_hall')), '22023', 'deposit_keep_reason_required', 'K-5d keeping part needs a reason');
  v := public.issue_4490_release_damage_deposit(public.t4490_id('g_hall'), 3000000, 'A broken chair', 'k5-keep-30k');
  PERFORM public.t4490_ok(v->>'status' = 'released' AND (v->>'refundedMinor')::bigint = 7000000 AND (v->>'keptMinor')::bigint = 3000000,
    'K-5e returned N70,000, kept N30,000 ("A broken chair"): ' || v::text);
  v := public.issue_4490_release_damage_deposit(public.t4490_id('g_hall'), 0, NULL, 'k5-again');
  PERFORM public.t4490_ok((v->>'replayed')::boolean AND (v->>'refundedMinor')::bigint = 7000000, 'K-5g returning again changes nothing');
  PERFORM public.t4490_ok((public.issue_4490_get_booking(public.t4490_id('g_hall'))->>'balanceDueMinor')::bigint = 0,
    'K-5h the booking still owes nothing');
END
$k5$;
SELECT public.t4490_reset();
DO $k5f$
BEGIN
  PERFORM public.t4490_ok((SELECT count(*) FROM public.stay_refunds r WHERE r.group_id = public.t4490_id('g_hall')
                             AND r.amount_minor = 7000000 AND r.application_fee_reversal_minor = 0
                             AND r.idempotency_key LIKE 'offer-deposit-refund:%') = 1
                          AND NOT EXISTS (SELECT 1 FROM public.stay_refund_allocations ra
                             JOIN public.stay_refunds r ON r.id = ra.refund_id
                             JOIN public.stay_payment_allocations a ON a.id = ra.payment_allocation_id
                             WHERE r.group_id = public.t4490_id('g_hall')
                               AND NOT public.issue_4490_is_damage_allocation(a.component, a.component_ref)),
    'K-5f one refund of N70,000, only from the damage deposit, no platform fee reversed');
END
$k5f$;
SELECT public.t4490_service();
DO $k6$
DECLARE
  v jsonb;
BEGIN
  -- Third booking on the Garden (another day), held by the venue: the sweep leaves it.
  INSERT INTO t4490_ids VALUES ('g_garden2', public.t4490_book(
    public.issue_4490_flexible_window(public.t4490_id('hire'), public.t4490_at('12:00', 9), 120), public.t4490_id('o_garden'), 20, 'k6-garden2'));
END
$k6$;
SELECT public.t4490_reset();
UPDATE public.venue_space_claims SET booked_range = tstzrange(now() - interval '9 days 2 hours', now() - interval '9 days'),
  claim_range = tstzrange(now() - interval '9 days 3 hours', now() - interval '8 days 23 hours') WHERE group_id = public.t4490_id('g_garden2');
SELECT public.t4490_as('44909200-0000-4000-8000-000000000001');
SELECT public.t4490_ok(public.issue_4490_hold_damage_deposit(public.t4490_id('g_garden2'), 'Checking the lawn', 'k6-hold-garden')->>'status' = 'held_by_venue',
  'K-6a the owner holds the second Garden deposit (a claim)');
SELECT public.t4490_service();
DO $k6b$
DECLARE
  v jsonb;
BEGIN
  v := public.issue_4490_offer_sweep(50);
  PERFORM public.t4490_ok((v->>'depositsReleased')::integer = 1, 'K-6b the sweep returns one deposit 7 days after the hire: ' || v::text);
  PERFORM public.t4490_ok(public.issue_4490_damage_deposit_state(public.t4490_id('g_garden'))->>'status' = 'released'
                          AND (public.issue_4490_damage_deposit_state(public.t4490_id('g_garden'))->>'refundedMinor')::bigint = 10000000
                          AND public.issue_4490_damage_deposit_state(public.t4490_id('g_garden2'))->>'status' = 'held_by_venue',
    'K-6c the first Garden deposit came back in full (N100,000); the held one stays held');
  v := public.issue_4490_offer_sweep(50);
  PERFORM public.t4490_ok((v->>'depositsReleased')::integer = 0, 'K-6d a second sweep returns nothing more');
END
$k6b$;
SELECT public.t4490_reset();
ROLLBACK;
