-- #4490 P5 follow-ups (20281203204490): by-the-hour price rule stated in the offer read, and a by-the-hour booking
-- moved to another day. Executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
--
-- MINGLA-INVARIANT: I-4490-HOUR-PRO-RATA | issue #4490 | a by-the-hour booking costs hour price x minutes / 60 (half up), in the offer's length steps; the offer read states the rule (hour.pricing).
-- MINGLA-INVARIANT: I-4490-HOUR-MOVE | issue #4490 | moving a by-the-hour booking moves its space claim in one transaction (old released 'moved', new committed); a taken place on the new day refuses the move.
--
-- Q-1 the pricing block. Q-2 90 minutes priced pro rata. Q-3 staff move to another day (taken -> refused; free -> moved,
-- claims and pass follow, the old time is free again). Q-4 the guest moves with the booking token; a stranger cannot.
-- Q-5 the Host calendar shows the current party after a guest change. Q-6 a day inside the booking notice is "too soon".
\set ON_ERROR_STOP on
BEGIN;
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
SELECT ('44905100-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p5f' || n || '-4490@example.test', now(), now()
FROM generate_series(1, 5) n;
INSERT INTO public.creator_accounts (id, created_at) VALUES ('44905100-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at)
VALUES ('44905100-0000-4000-9000-000000000010', '44905100-0000-4000-8000-000000000001', 'Harmattan P5F 4490',
        'harmattan-p5f-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code) VALUES
  ('44905100-0000-4000-9000-0000000000a1', '44905100-0000-4000-9000-000000000010', 'korap5f4490', 'Kora P5F', 6.45, 3.41, 'coworking', 'verified', 'NG');

CREATE TEMP TABLE t4490_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490_ids TO PUBLIC;
CREATE FUNCTION public.t4490_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v FROM t4490_ids WHERE k = p_k $f$;
CREATE FUNCTION public.t4490_key(p_seed text) RETURNS text LANGUAGE sql AS $f$ SELECT encode(sha256(convert_to(p_seed, 'UTF8')), 'hex') $f$;
CREATE FUNCTION public.t4490_at(p_hhmm text, p_days integer) RETURNS timestamptz LANGUAGE sql AS $f$
  SELECT (((now() AT TIME ZONE 'Africa/Lagos')::date + p_days) + p_hhmm::time) AT TIME ZONE 'Africa/Lagos' $f$;
CREATE FUNCTION public.t4490_hour(p_offer uuid, p_at timestamptz, p_minutes integer, p_seed text)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_q jsonb;
BEGIN
  v_q := public.issue_4490_quote_offer(p_offer, public.issue_4490_flexible_window(p_offer, p_at, p_minutes),
    jsonb_build_array(jsonb_build_object('guests', 2)), public.t4490_key('cart:' || p_seed), NULL, 'quote-' || p_seed);
  RETURN public.issue_4490_create_offer_group(gen_random_uuid(), (v_q->>'quoteId')::uuid,
    jsonb_build_object('name', 'Guest ' || p_seed, 'email', p_seed || '@example.test'), public.t4490_key('cart:' || p_seed), NULL,
    sha256(convert_to('tok:' || p_seed, 'UTF8')), 'hold-' || p_seed) || jsonb_build_object('quote', v_q);
END
$f$;
CREATE FUNCTION public.t4490_pay(p_group uuid, p_seed text)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_p jsonb;
  v_ref text;
BEGIN
  v_p := public.issue_4490_prepare_offer_payment(p_group, sha256(convert_to('tok:' || p_seed, 'UTF8')), NULL, 'pay-key-' || p_seed,
    (SELECT version FROM public.stay_reservation_groups WHERE id = p_group));
  v_ref := 'mingla_stay_' || replace(v_p->>'attemptId', '-', '');
  PERFORM public.issue_1389_bind_payment_attempt((v_p->>'attemptId')::uuid, v_ref, NULL, NULL);
  PERFORM public.issue_1389_finalize_payment('paystack', 'evt-' || p_seed, 'charge.success', v_ref, 'ch-' || p_seed,
    (v_p->>'amountMinor')::bigint, 'NGN', 0, NULL);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490_id(text), public.t4490_key(text), public.t4490_at(text, integer),
  public.t4490_hour(uuid, timestamptz, integer, text), public.t4490_pay(uuid, text) TO PUBLIC;

-- Owner: Boardroom N12,000 an hour, 08:00-20:00, 30-minute steps, 1-2 hours,
-- 15-minute cleanup; guests may move the day until 2 hours before.
SELECT public.t4490_as('44905100-0000-4000-8000-000000000001');
DO $fx$
DECLARE
  a1 uuid := '44905100-0000-4000-9000-0000000000a1';
  v jsonb;
  s jsonb;
  v_offer uuid;
BEGIN
  PERFORM public.issue_4490_set_venue_feature(a1, 'by_the_hour', true, NULL, NULL, NULL, 'p5f-feature');
  PERFORM public.issue_4490_save_booking_settings(a1, '{"vatMode":"added"}'::jsonb, NULL, 'p5f-vat-mode');
  s := public.issue_4490_manage_space('create', a1, '{"name":"Boardroom","setting":"indoor","capacity_seated":10}'::jsonb, NULL);
  v := public.issue_4490_manage_offer('create_draft', a1, '{"kind":"by_the_hour","name":"Boardroom"}'::jsonb, NULL, 'p5f-draft');
  v_offer := (v->>'id')::uuid;
  INSERT INTO t4490_ids VALUES ('board', v_offer);
  v := public.issue_4490_manage_hour('set_place', a1, jsonb_build_object('offerId', v_offer, 'spaceIds', jsonb_build_array(s->>'id')),
    (v->>'version')::bigint, 'p5f-place');
  v := public.issue_4490_manage_offer('upsert_price_option', a1, jsonb_build_object('offerId', v_offer, 'name', 'Per hour',
    'unit', 'hour', 'guestMin', 1, 'guestMax', 10, 'priceMinor', 1200000), (v->>'version')::bigint, 'p5f-price');
  v := public.issue_4490_manage_offer('set_policy', a1, jsonb_build_object('offerId', v_offer, 'refundLadder', jsonb_build_array(
    jsonb_build_object('minMinutesBefore', 1440, 'refundBps', 10000)),
    'dateChangeRule', jsonb_build_object('allowedUntilMinutesBefore', 120, 'feeBps', 0)), (v->>'version')::bigint, 'p5f-policy');
  v := public.issue_4490_manage_hour('set_hours', a1, jsonb_build_object('offerId', v_offer, 'weekdays', jsonb_build_array(0,1,2,3,4,5,6),
    'startTime', '08:00', 'endTime', '20:00'), (v->>'version')::bigint, 'p5f-hours');
  v := public.issue_4490_manage_hour('set_length', a1, jsonb_build_object('offerId', v_offer, 'stepMinutes', 30, 'minMinutes', 60,
    'maxMinutes', 120), (v->>'version')::bigint, 'p5f-length');
  v := public.issue_4490_manage_hour('set_rules', a1, jsonb_build_object('offerId', v_offer, 'bufferBeforeMinutes', 0,
    'bufferAfterMinutes', 15, 'noShowReleaseMinutes', NULL, 'staffCanStart', true), (v->>'version')::bigint, 'p5f-rules');
  v := public.issue_4490_manage_offer('publish', a1, jsonb_build_object('offerId', v_offer), (v->>'version')::bigint, 'p5f-publish');
  -- Q-1 the pricing rule in the offer read.
  PERFORM public.t4490_ok(v->'hour'->'pricing'->>'rule' = 'per_minute_pro_rata'
                          AND (v->'hour'->'pricing'->>'billableStepMinutes')::integer = 30
                          AND (v->'hour'->'pricing'->>'minBillableMinutes')::integer = 60,
    'Q-1 the offer read states the price rule: per minute, pro rata; billed in 30-minute steps from 60 minutes');
END
$fx$;
SELECT public.t4490_reset();

SELECT public.t4490_service();
DO $q2$
DECLARE
  v jsonb;
  g uuid;
BEGIN
  v := public.t4490_hour(public.t4490_id('board'), public.t4490_at('09:00', 3), 90, 'p5f-90');
  PERFORM public.t4490_ok((v->'quote'->>'subtotalMinor')::bigint = 1800000 AND (v->'quote'->>'taxMinor')::bigint = 135000,
    'Q-2 90 minutes: N12,000 x 90 / 60 = N18,000 + VAT N1,350 (pro rata, not rounded up to 2 hours)');
  -- Q-3 a paid 2-hour booking on day 3, someone else on day 4 at the same time.
  v := public.t4490_hour(public.t4490_id('board'), public.t4490_at('14:00', 3), 120, 'p5f-a');
  g := (v->>'groupId')::uuid;
  INSERT INTO t4490_ids VALUES ('ga', g);
  PERFORM public.t4490_pay(g, 'p5f-a');
  v := public.t4490_hour(public.t4490_id('board'), public.t4490_at('14:00', 4), 120, 'p5f-b');
  PERFORM public.t4490_pay((v->>'groupId')::uuid, 'p5f-b');
  INSERT INTO t4490_ids VALUES ('win4', public.issue_4490_flexible_window(public.t4490_id('board'), public.t4490_at('14:00', 4), 120));
  INSERT INTO t4490_ids VALUES ('win5', public.issue_4490_flexible_window(public.t4490_id('board'), public.t4490_at('14:00', 5), 120));
  INSERT INTO t4490_ids VALUES ('win6', public.issue_4490_flexible_window(public.t4490_id('board'), public.t4490_at('10:00', 6), 120));
  PERFORM public.t4490_ok((SELECT state FROM public.stay_reservation_groups WHERE id = g) = 'confirmed', 'Q-3a booking A paid (day 3, 14:00-16:00)');
END
$q2$;
SELECT public.t4490_reset();

SELECT public.t4490_as('44905100-0000-4000-8000-000000000001');
DO $q3$
DECLARE
  g uuid := public.t4490_id('ga');
  v jsonb;
BEGIN
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_change_booking(%L, 'move_date', jsonb_build_object('windowId', %L), true)$q$,
      g, public.t4490_id('win4')),
    'PT409', 'offer_space_taken', 'Q-3b moving to day 4 at 14:00 is refused: the Boardroom is booked then');
  v := public.issue_4490_change_booking(g, 'move_date', jsonb_build_object('windowId', public.t4490_id('win5')), true);
  PERFORM public.t4490_ok((v->>'amountMinor')::bigint = 0 AND (v->>'toDate')::date = (now() AT TIME ZONE 'Africa/Lagos')::date + 5,
    'Q-3c preview to day 5 at 14:00: same price, nothing more to pay');
  v := public.issue_4490_change_booking(g, 'move_date', jsonb_build_object('windowId', public.t4490_id('win5')), false,
    (v->>'groupVersion')::bigint, 'p5f-move-1');
  PERFORM public.t4490_ok(v->>'changeId' IS NOT NULL, 'Q-3c2 the owner moves booking A to day 5');
END
$q3$;
SELECT public.t4490_reset();
SELECT public.t4490_service();
DO $q3b$
DECLARE
  g uuid := public.t4490_id('ga');
  v jsonb;
BEGIN
  PERFORM public.t4490_ok(
    (SELECT count(*) FROM public.venue_space_claims c WHERE c.group_id = g AND c.state = 'committed'
       AND lower(c.booked_range) = public.t4490_at('14:00', 5) AND upper(c.booked_range) = public.t4490_at('16:00', 5)) = 1
    AND (SELECT count(*) FROM public.venue_space_claims c WHERE c.group_id = g AND c.state = 'released'
           AND c.release_reason = 'moved' AND lower(c.booked_range) = public.t4490_at('14:00', 3)) = 1
    AND (SELECT valid_local_date FROM public.venue_passes WHERE group_id = g) = (now() AT TIME ZONE 'Africa/Lagos')::date + 5,
    'Q-3d moved: the day-5 claim committed, the day-3 claim released (moved), the pass on day 5');
  PERFORM public.t4490_ok(EXISTS (SELECT 1 FROM jsonb_array_elements(
      public.pg_venue_hour_day(public.t4490_id('board'), (now() AT TIME ZONE 'Africa/Lagos')::date + 3, 2)->'starts') x
      WHERE (x->>'startsAt')::timestamptz = public.t4490_at('14:00', 3)),
    'Q-3e day 3 at 14:00 is free again for anyone');
  v := public.issue_4490_booking_projection(g, NULL);
  PERFORM public.t4490_ok((v->'hour'->>'bookedFrom')::timestamptz = public.t4490_at('14:00', 5) AND (v->'hour'->>'minutes')::integer = 120,
    'Q-3f the booking reads day 5, 14:00, 2 hours');
END
$q3b$;
SELECT public.t4490_reset();

SELECT public.t4490_service();
DO $q4$
DECLARE
  g uuid := public.t4490_id('ga');
  v jsonb;
BEGIN
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_guest_change_booking(%L, sha256(convert_to('tok:p5f-b', 'UTF8')), NULL,
      'move_date', jsonb_build_object('windowId', %L), true, NULL, NULL)$q$, g, public.t4490_id('win6')),
    'P0002', 'offer_booking_not_found', 'Q-4a another guest''s token cannot move booking A');
  PERFORM public.t4490_expect(format($q$SELECT public.issue_4490_guest_change_booking(%L, NULL, '44905100-0000-4000-8000-000000000005',
      'move_date', jsonb_build_object('windowId', %L), true, NULL, NULL)$q$, g, public.t4490_id('win6')),
    'P0002', 'offer_booking_not_found', 'Q-4b a stranger''s signed-in account cannot move it');
  v := public.issue_4490_guest_change_booking(g, sha256(convert_to('tok:p5f-a', 'UTF8')), NULL, 'move_date',
    jsonb_build_object('windowId', public.t4490_id('win6')), false,
    (SELECT version FROM public.stay_reservation_groups WHERE id = g), 'p5f-move-2');
  PERFORM public.t4490_ok((SELECT count(*) FROM public.venue_space_claims c WHERE c.group_id = g AND c.state = 'committed'
                             AND lower(c.booked_range) = public.t4490_at('10:00', 6)) = 1,
    'Q-4c the guest moves it with the booking token to day 6, 10:00 (claim moved)');
END
$q4$;
SELECT public.t4490_reset();

SELECT public.t4490_as('44905100-0000-4000-8000-000000000001');
DO $q5$
DECLARE
  g uuid := public.t4490_id('ga');
  v jsonb;
  c jsonb;
BEGIN
  v := public.issue_4490_change_booking(g, 'change_guests', '{"guests":4}'::jsonb, true);
  v := public.issue_4490_change_booking(g, 'change_guests', '{"guests":4}'::jsonb, false, (v->>'groupVersion')::bigint, 'p5f-guests-4');
  c := public.issue_4490_venue_calendar('44905100-0000-4000-9000-0000000000a1',
    (now() AT TIME ZONE 'Africa/Lagos')::date + 6, (now() AT TIME ZONE 'Africa/Lagos')::date + 6);
  PERFORM public.t4490_ok(EXISTS (SELECT 1 FROM jsonb_array_elements(c->'claims') x
                                  WHERE x->>'groupId' = g::text AND (x->>'guests')::integer = 4),
    'Q-5 the Host calendar shows the party of 4 after the change from 2');
  v := public.issue_4490_manage_offer('update', '44905100-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId', public.t4490_id('board'), 'minNoticeMinutes', 4320),
    (SELECT (o->>'version')::bigint FROM jsonb_array_elements(public.issue_4490_list_offers('44905100-0000-4000-9000-0000000000a1')->'offers') o
     WHERE o->>'id' = public.t4490_id('board')::text), 'p5f-notice-3d');
END
$q5$;
SELECT public.t4490_reset();
SELECT public.t4490_as(NULL);
SELECT public.t4490_ok((SELECT a.status FROM public.pg_venue_offer_availability(public.t4490_id('board'),
    (now() AT TIME ZONE 'Africa/Lagos')::date + 1, (now() AT TIME ZONE 'Africa/Lagos')::date + 1, 2) a) = 'too_soon',
  'Q-6 with 3 days'' notice, tomorrow reads "too soon" (not "taken")');
SELECT public.t4490_reset();

ROLLBACK;
