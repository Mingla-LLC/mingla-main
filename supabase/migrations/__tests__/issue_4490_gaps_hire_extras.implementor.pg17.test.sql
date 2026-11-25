-- #4490 spec 07-C: priced private-hire extras, their immutable booking
-- snapshot, and a host quote edit whose base includes those extras.
-- Executable PostgreSQL 17 proof. BEGIN ... ROLLBACK.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true
FROM unnest(ARRAY['VENUE_OFFERS_READS', 'VENUE_OFFERS_WRITES', 'STAY_RESERVE_READS', 'STAY_RESERVE_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

CREATE FUNCTION public.t4490c_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490C FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;

CREATE FUNCTION public.t4490c_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490C FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490C FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;

CREATE FUNCTION public.t4490c_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
  PERFORM set_config('request.jwt.claims', CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
    ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
  PERFORM set_config('role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
END
$f$;

CREATE FUNCTION public.t4490c_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;

CREATE FUNCTION public.t4490c_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;

GRANT EXECUTE ON FUNCTION public.t4490c_ok(boolean, text), public.t4490c_expect(text, text, text, text),
  public.t4490c_as(uuid), public.t4490c_service(), public.t4490c_reset() TO PUBLIC;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES ('4490c000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'hire-extras-4490@example.test', now(), now());
INSERT INTO public.creator_accounts (id, created_at)
VALUES ('4490c000-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at)
VALUES ('4490c000-0000-4000-9000-000000000010', '4490c000-0000-4000-8000-000000000001',
  'Hire extras 4490', 'hire-extras-4490', 'NGN', 'paystack', now() - interval '1 day', now(), now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code)
VALUES ('4490c000-0000-4000-9000-0000000000a1', '4490c000-0000-4000-9000-000000000010',
  'hireextras4490', 'Hire Extras Hall', 6.45, 3.40, 'play', 'verified', 'NG');

CREATE TEMP TABLE t4490c_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490c_ids TO PUBLIC;

SELECT public.t4490c_as('4490c000-0000-4000-8000-000000000001');
DO $build$
DECLARE
  v jsonb;
  v_offer uuid;
  v_space uuid;
  v_option uuid;
  v_generated text;
  v_before bigint;
  v_replay jsonb;
  a1 constant uuid := '4490c000-0000-4000-9000-0000000000a1';
BEGIN
  v_space := (public.issue_4490_manage_space('create', a1,
    '{"name":"Main Hall","setting":"covered","capacity_standing":120}'::jsonb)->>'id')::uuid;
  INSERT INTO t4490c_ids VALUES ('space', v_space);
  PERFORM public.issue_4490_set_venue_feature(a1, 'private_hire', true, NULL, NULL, NULL, 'c-feature-on');
  PERFORM public.issue_4490_save_booking_settings(a1, '{"vatMode":"added"}'::jsonb, NULL, 'c-vat-added');
  v := public.issue_4490_manage_offer('create_draft', a1,
    '{"kind":"private_hire","name":"Private hire"}'::jsonb, NULL, 'c-create-hire');
  v_offer := (v->>'id')::uuid;
  INSERT INTO t4490c_ids VALUES ('offer', v_offer);
  v := public.issue_4490_manage_hire('set_spaces', a1,
    jsonb_build_object('offerId', v_offer, 'spaceIds', jsonb_build_array(v_space), 'combinationIds', '[]'::jsonb),
    (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'c-hire-spaces');
  v := public.issue_4490_manage_hire('set_price_row', a1,
    jsonb_build_object('offerId', v_offer, 'name', 'Main Hall', 'spaceId', v_space, 'unit', 'booking',
      'guestMin', 1, 'guestMax', 100, 'priceMinor', 100000000),
    (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'c-hire-price');
  SELECT (r->>'optionId')::uuid INTO v_option
  FROM jsonb_array_elements(v->'hire'->'rows') r WHERE r->>'name' = 'Main Hall';
  INSERT INTO t4490c_ids VALUES ('option', v_option);
  v := public.issue_4490_manage_hire('set_sessions', a1, jsonb_build_object('offerId', v_offer,
    'sessions', jsonb_build_array(jsonb_build_object('label', 'Full day', 'startTime', '10:00', 'endTime', '22:00')),
    'weekdays', jsonb_build_array(0,1,2,3,4,5,6)),
    (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'c-hire-times');
  v := public.issue_4490_manage_hire('set_terms', a1, jsonb_build_object('offerId', v_offer,
    'hireCharge', 'hire_fee', 'depositKind', 'percent', 'depositValue', 5000,
    'balanceDueDaysBefore', 14, 'setupMinutes', 60, 'cleanupMinutes', 60,
    'damageDepositMinor', 0, 'overtimeMinorPerHour', NULL),
    (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'c-hire-terms');
  v := public.issue_4490_manage_offer('set_policy', a1, jsonb_build_object('offerId', v_offer,
    'refundLadder', jsonb_build_array(jsonb_build_object('minMinutesBefore', 0, 'refundBps', 0))),
    (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'c-hire-policy');
  v := public.issue_4490_manage_hire('set_booking', a1, jsonb_build_object('offerId', v_offer,
    'mode', 'request', 'requestResponseHours', 48, 'approvedPaymentMinutes', 4320),
    (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'c-hire-booking');

  v_before := (SELECT version FROM public.stay_offerings WHERE id = v_offer);
  v := public.issue_4490_manage_hire('set_extras', a1, jsonb_build_object('offerId', v_offer, 'extras', jsonb_build_array(
    jsonb_build_object('id', 'projector', 'name', ' Projector ', 'priceMinor', 2500000, 'per', 'booking'),
    jsonb_build_object('name', 'Welcome drink', 'priceMinor', 150000, 'per', 'guest'))),
    v_before, 'c-hire-extras-one');
  v_generated := v->'extras'->1->>'id';
  PERFORM public.t4490c_ok((v->>'version')::bigint = v_before + 1
    AND v->'extras'->0->>'id' = 'projector' AND v->'extras'->0->>'name' = 'Projector'
    AND v_generated ~ '^x[a-f0-9]{10}$',
    'C-DB1 hire extras save, trim, generate an id and bump the offer version');

  v_replay := public.issue_4490_manage_hire('set_extras', a1, jsonb_build_object('offerId', v_offer, 'extras', jsonb_build_array(
    jsonb_build_object('id', 'projector', 'name', ' Projector ', 'priceMinor', 2500000, 'per', 'booking'),
    jsonb_build_object('name', 'Welcome drink', 'priceMinor', 150000, 'per', 'guest'))),
    v_before, 'c-hire-extras-one');
  PERFORM public.t4490c_ok((v_replay->>'replayed')::boolean
    AND (SELECT version FROM public.stay_offerings WHERE id = v_offer) = v_before + 1,
    'C-DB2 repeating the receipt key replays without a second version bump');

  v := public.issue_4490_manage_hire('set_extras', a1, jsonb_build_object('offerId', v_offer, 'extras', jsonb_build_array(
    jsonb_build_object('id', 'projector', 'name', 'Projector and screen', 'priceMinor', 3000000, 'per', 'booking'),
    jsonb_build_object('id', v_generated, 'name', 'Welcome drink', 'priceMinor', 150000, 'per', 'guest'))),
    (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'c-hire-extras-two');
  PERFORM public.t4490c_ok(v->'extras'->0->>'id' = 'projector' AND v->'extras'->1->>'id' = v_generated,
    'C-DB3 editing extras preserves every durable id');

  PERFORM public.t4490c_expect(format($$SELECT public.issue_4490_manage_hire('set_extras', %L::uuid,
    jsonb_build_object('offerId', %L::uuid, 'extras', (SELECT jsonb_agg(jsonb_build_object(
      'id', 'x' || n, 'name', 'Extra ' || n, 'priceMinor', 1, 'per', 'booking')) FROM generate_series(1,21) n)),
    %s, 'c-too-many')$$, a1, v_offer, (SELECT version FROM public.stay_offerings WHERE id = v_offer)),
    '22023', 'extras_invalid', 'C-DB4 more than 20 extras is refused');
  PERFORM public.t4490c_expect(format($$SELECT public.issue_4490_manage_hire('set_extras', %L::uuid,
    jsonb_build_object('offerId', %L::uuid, 'extras', jsonb_build_array(
      jsonb_build_object('id','same','name','One','priceMinor',1,'per','booking'),
      jsonb_build_object('id','same','name','Two','priceMinor',2,'per','guest'))), %s, 'c-duplicates')$$,
    a1, v_offer, (SELECT version FROM public.stay_offerings WHERE id = v_offer)),
    '22023', 'extras_invalid', 'C-DB5 duplicate extra ids are refused');

  v := public.issue_4490_manage_offer('publish', a1, jsonb_build_object('offerId', v_offer),
    (SELECT version FROM public.stay_offerings WHERE id = v_offer), 'c-hire-publish');
  PERFORM public.t4490c_ok(v->>'status' = 'live', 'C-DB6 the hire with extras publishes');
END
$build$;
SELECT public.t4490c_reset();

SELECT public.t4490c_service();
DO $quote$
DECLARE
  v_offer uuid := (SELECT v FROM t4490c_ids WHERE k = 'offer');
  v_option uuid := (SELECT v FROM t4490c_ids WHERE k = 'option');
  v_window uuid;
  v_extra_id text;
  v_q jsonb;
  v_g jsonb;
  v_group uuid;
  v_projection jsonb;
  v_approved jsonb;
BEGIN
  SELECT id INTO v_window FROM public.stay_place_windows
  WHERE offering_id = v_offer AND starts_at > now() + interval '30 days'
  ORDER BY starts_at LIMIT 1;
  SELECT extras->1->>'id' INTO v_extra_id FROM public.stay_offerings WHERE id = v_offer;
  v_q := public.issue_4490_quote_offer(v_offer, v_window,
    jsonb_build_array(jsonb_build_object('priceOptionId', v_option, 'guests', 10)),
    repeat('1', 64), NULL, 'c-hire-quote-one',
    jsonb_build_array(jsonb_build_object('id', 'projector'), jsonb_build_object('id', v_extra_id)),
    '{"occasion":"Team day"}'::jsonb);
  PERFORM public.t4490c_ok((v_q->>'subtotalMinor')::bigint = 104500000
    AND (v_q->>'taxMinor')::bigint = 7837500 AND (v_q->>'totalMinor')::bigint = 112337500
    AND (SELECT sum((x->>'amountMinor')::bigint) FROM jsonb_array_elements(v_q->'extras') x) = 4500000
    AND (v_q->'hire'->'payPlan'->>'depositMinor')::bigint = 56168750,
    'C-DB7 quote prices booking and per-guest extras, VAT and 50% deposit');
  PERFORM public.t4490c_ok((SELECT price_snapshot->'extras' FROM public.stay_quote_lines
      WHERE quote_id = (v_q->>'quoteId')::uuid)->0->>'name' = 'Projector and screen'
    AND (SELECT (price_snapshot->'extras'->1->>'qty')::integer FROM public.stay_quote_lines
      WHERE quote_id = (v_q->>'quoteId')::uuid) = 10,
    'C-DB8 the quote line snapshots the chosen extra names, prices and quantities');

  v_g := public.issue_4490_create_offer_group(gen_random_uuid(), (v_q->>'quoteId')::uuid,
    '{"name":"Hire Guest","email":"hire-guest@example.test"}'::jsonb,
    repeat('1', 64), NULL, sha256(convert_to('c-hire-token', 'UTF8')), 'c-hire-hold-one');
  v_group := (v_g->>'groupId')::uuid;
  INSERT INTO t4490c_ids VALUES ('group', v_group);
  v_projection := public.issue_4490_booking_projection(v_group, NULL);
  PERFORM public.t4490c_ok(jsonb_array_length(v_projection->'extras') = 2
    AND v_projection->'extras'->0->>'name' = 'Projector and screen'
    AND (v_projection->'extras'->1->>'amountMinor')::bigint = 1500000,
    'C-DB9 the request reads its immutable chosen extras back');

  v_approved := public.issue_4490_manage_request_for(
    '4490c000-0000-4000-8000-000000000001', v_group, 'approve',
    '{"quoteEdit":{"baseMinor":90000000,"note":"Agreed package"}}'::jsonb,
    (SELECT version FROM public.stay_reservation_groups WHERE id = v_group), 'c-approve-edit');
  PERFORM public.t4490c_ok((v_approved->>'totalDueMinor')::bigint = 96750000
    AND (v_approved->>'depositMinor')::bigint = 48375000,
    'C-DB10 quote edit treats hire plus extras as one pre-tax base and recomputes VAT and deposit');
  v_projection := public.issue_4490_booking_projection(v_group, NULL);
  PERFORM public.t4490c_ok(jsonb_array_length(v_projection->'extras') = 2
    AND v_projection->'extras'->0->>'name' = 'Projector and screen'
    AND (SELECT count(*) FROM public.venue_booking_amendments a WHERE a.group_id = v_group
      AND a.kind = 'balance_adjust' AND a.price_delta_minor = -14500000 AND a.tax_delta_minor = -1087500) = 1,
    'C-DB11 editing the whole base keeps the extra snapshot and records the exact amendment');
END
$quote$;
SELECT public.t4490c_reset();

ROLLBACK;
