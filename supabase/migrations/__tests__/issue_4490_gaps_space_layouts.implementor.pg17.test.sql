-- #4490 spec 07-H: layout authoring, combination capacity, readiness,
-- quote refusal and immutable request/booking facts. PostgreSQL 17 proof.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

CREATE FUNCTION public.t4490h_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490H FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;

CREATE FUNCTION public.t4490h_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490H FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490H FAIL: % (no error)', p_label;
END
$f$;

CREATE FUNCTION public.t4490h_as(p_user uuid)
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

CREATE FUNCTION public.t4490h_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;

CREATE FUNCTION public.t4490h_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490h_ok(boolean,text), public.t4490h_expect(text,text,text,text),
  public.t4490h_as(uuid), public.t4490h_service(), public.t4490h_reset() TO PUBLIC;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES ('4490d000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','layouts-4490@example.test',now(),now());
INSERT INTO public.creator_accounts (id, created_at)
VALUES ('4490d000-0000-4000-8000-000000000001',now());
INSERT INTO public.brands (id, account_id, name, slug, default_currency, payment_provider, payout_hold_cutover_at, created_at, updated_at)
VALUES ('4490d000-0000-4000-9000-000000000010','4490d000-0000-4000-8000-000000000001',
  'Layouts 4490','layouts-4490','NGN','paystack',now() - interval '1 day',now(),now());
INSERT INTO public.venue_listings (id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code)
VALUES ('4490d000-0000-4000-9000-0000000000a1','4490d000-0000-4000-9000-000000000010',
  'layouts4490','Layouts Hall',6.45,3.40,'play','verified','NG');

CREATE TEMP TABLE t4490h_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490h_ids TO PUBLIC;

SELECT public.t4490h_as('4490d000-0000-4000-8000-000000000001');
DO $build$
DECLARE
  v jsonb;
  v_offer uuid;
  v_a uuid;
  v_b uuid;
  v_combo uuid;
  v_option uuid;
  a1 constant uuid := '4490d000-0000-4000-9000-0000000000a1';
BEGIN
  v := public.issue_4490_manage_space('create', a1,
    '{"name":"Hall A","setting":"indoor","capacity_standing":100,"capacity_seated":60,"layouts":[{"layout":"banquet","capacity":70},{"layout":"theatre","capacity":80}]}'::jsonb);
  v_a := (v->>'id')::uuid;
  PERFORM public.t4490h_ok(v->'layouts' = '[{"layout":"banquet","capacity":70},{"layout":"theatre","capacity":80}]'::jsonb,
    'H-DB1 create owns and returns the fixed other-layout rows');
  v := public.issue_4490_manage_space('create', a1,
    '{"name":"Hall B","setting":"indoor","capacity_standing":80,"capacity_seated":40,"layouts":[{"layout":"theatre","capacity":55}]}'::jsonb);
  v_b := (v->>'id')::uuid;
  v_combo := (public.issue_4490_manage_space_combination('create', a1,
    jsonb_build_object('name','Whole Hall','space_ids',jsonb_build_array(v_a,v_b)))->>'id')::uuid;
  INSERT INTO t4490h_ids VALUES ('a',v_a),('b',v_b),('combo',v_combo);

  PERFORM public.issue_4490_set_venue_feature(a1,'private_hire',true,NULL,NULL,NULL,'h-layout-feature');
  v := public.issue_4490_manage_offer('create_draft',a1,'{"kind":"private_hire","name":"Private hire"}'::jsonb,NULL,'h-layout-offer');
  v_offer := (v->>'id')::uuid;
  INSERT INTO t4490h_ids VALUES ('offer',v_offer);
  v := public.issue_4490_manage_hire('set_spaces',a1,
    jsonb_build_object('offerId',v_offer,'spaceIds','[]'::jsonb,'combinationIds',jsonb_build_array(v_combo)),
    (SELECT version FROM public.stay_offerings WHERE id=v_offer),'h-layout-spaces');
  v := public.issue_4490_manage_hire('set_price_row',a1,
    jsonb_build_object('offerId',v_offer,'name','Whole Hall','combinationId',v_combo,'unit','booking',
      'guestMin',1,'guestMax',180,'priceMinor',100000000),
    (SELECT version FROM public.stay_offerings WHERE id=v_offer),'h-layout-price');
  SELECT (r->>'optionId')::uuid INTO v_option FROM jsonb_array_elements(v->'hire'->'rows') r LIMIT 1;
  INSERT INTO t4490h_ids VALUES ('option',v_option);
  v := public.issue_4490_manage_hire('set_layouts',a1,
    jsonb_build_object('offerId',v_offer,'layouts',jsonb_build_array('banquet')),
    (SELECT version FROM public.stay_offerings WHERE id=v_offer),'h-layout-choice');
  PERFORM public.t4490h_ok(v->'hire'->'layouts' = '["banquet"]'::jsonb
    AND v#>'{hire,rows,0,layoutCapacities,banquet}' = 'null'::jsonb
    AND v->'readiness' ? 'layout_capacity_missing',
    'H-DB3 a combination missing the layout on one part refuses readiness');

  v := public.issue_4490_manage_space('update',a1,
    jsonb_build_object('id',v_b,'layouts',jsonb_build_array(jsonb_build_object('layout','banquet','capacity',50),jsonb_build_object('layout','theatre','capacity',55))),
    (SELECT version FROM public.venue_spaces WHERE id=v_b));
  v := public.issue_4490_manage_hire('set_layouts',a1,
    jsonb_build_object('offerId',v_offer,'layouts',jsonb_build_array('banquet')),
    (SELECT version FROM public.stay_offerings WHERE id=v_offer),'h-layout-refresh');
  PERFORM public.t4490h_ok((v#>>'{hire,rows,0,layoutCapacities,banquet}')::integer = 120
    AND (v#>>'{hire,rows,0,capacity}')::integer = 180,
    'H-DB4 a combination sums layout capacity while the old capacity remains unchanged');

  v := public.issue_4490_manage_hire('set_sessions',a1,jsonb_build_object('offerId',v_offer,
    'sessions',jsonb_build_array(jsonb_build_object('label','Full day','startTime','10:00','endTime','22:00')),
    'weekdays',jsonb_build_array(0,1,2,3,4,5,6)),
    (SELECT version FROM public.stay_offerings WHERE id=v_offer),'h-layout-times');
  v := public.issue_4490_manage_hire('set_terms',a1,jsonb_build_object('offerId',v_offer,
    'hireCharge','hire_fee','depositKind','none','setupMinutes',60,'cleanupMinutes',60,'damageDepositMinor',0),
    (SELECT version FROM public.stay_offerings WHERE id=v_offer),'h-layout-terms');
  v := public.issue_4490_manage_offer('set_policy',a1,jsonb_build_object('offerId',v_offer,
    'refundLadder',jsonb_build_array(jsonb_build_object('minMinutesBefore',0,'refundBps',0))),
    (SELECT version FROM public.stay_offerings WHERE id=v_offer),'h-layout-policy');
  v := public.issue_4490_manage_hire('set_booking',a1,jsonb_build_object('offerId',v_offer,
    'mode','request','requestResponseHours',48,'approvedPaymentMinutes',4320),
    (SELECT version FROM public.stay_offerings WHERE id=v_offer),'h-layout-book');
  PERFORM public.t4490h_ok(NOT (v->'readiness' ? 'layout_capacity_missing'),
    'H-DB5 filling the missing part clears layout readiness');
  v := public.issue_4490_manage_offer('publish',a1,jsonb_build_object('offerId',v_offer),
    (SELECT version FROM public.stay_offerings WHERE id=v_offer),'h-layout-publish');
  PERFORM public.t4490h_ok(v->>'status'='live','H-DB6 a complete layout-aware hire publishes');
END
$build$;
SELECT public.t4490h_reset();

SELECT public.t4490h_ok(
  public.issue_4490_layouts_valid(ARRAY['banquet'], 'group_package')
  AND NOT public.issue_4490_layouts_valid(ARRAY['banquet','theatre'], 'group_package')
  AND NOT public.issue_4490_layouts_valid(ARRAY['banquet'], 'entry'),
  'H-DB12 a group package may carry exactly one canonical layout'
);

SELECT public.t4490h_service();
DO $quote$
DECLARE
  v_offer uuid := (SELECT v FROM t4490h_ids WHERE k='offer');
  v_option uuid := (SELECT v FROM t4490h_ids WHERE k='option');
  v_window uuid;
  v_q jsonb;
  v_g jsonb;
  v_group uuid;
  v_detail text;
  v_projection jsonb;
BEGIN
  PERFORM public.t4490h_ok(public.issue_4490_space_capacity((SELECT v FROM t4490h_ids WHERE k='a')) = 100
    AND public.issue_4490_space_layout_capacity((SELECT v FROM t4490h_ids WHERE k='a'),'standing') = 100
    AND public.issue_4490_space_layout_capacity((SELECT v FROM t4490h_ids WHERE k='a'),'seated') = 60
    AND public.issue_4490_space_layout_capacity((SELECT v FROM t4490h_ids WHERE k='a'),'banquet') = 70
    AND public.issue_4490_option_layout_capacity(v_option,'banquet') = 120,
    'H-DB2 old one-argument capacity is unchanged and new helpers own layout capacity');
  SELECT id INTO v_window FROM public.stay_place_windows
  WHERE offering_id=v_offer AND starts_at > now() + interval '30 days' ORDER BY starts_at LIMIT 1;
  PERFORM public.t4490h_expect(format($$SELECT public.issue_4490_quote_offer(%L::uuid,%L::uuid,
    jsonb_build_array(jsonb_build_object('priceOptionId',%L::uuid,'guests',100)),repeat('1',64),NULL,
    'h-layout-no-choice','[]'::jsonb,'{}'::jsonb)$$,v_offer,v_window,v_option),
    '22023','offer_invalid_payload','H-DB7 layout is required when the offer lists layouts');
  BEGIN
    PERFORM public.issue_4490_quote_offer(v_offer,v_window,
      jsonb_build_array(jsonb_build_object('priceOptionId',v_option,'guests',121,'layout','banquet')),
      repeat('2',64),NULL,'h-layout-too-big','[]'::jsonb,'{}'::jsonb);
    RAISE EXCEPTION 'T4490H FAIL: H-DB8 no error';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    PERFORM public.t4490h_ok(SQLERRM='offer_group_too_big'
      AND v_detail::jsonb @> '{"placeName":"Whole Hall","capacity":120,"layout":"banquet"}'::jsonb,
      'H-DB8 121 banquet guests are refused with the 120 capacity detail');
  END;
  v_q := public.issue_4490_quote_offer(v_offer,v_window,
    jsonb_build_array(jsonb_build_object('priceOptionId',v_option,'guests',120,'layout','banquet')),
    repeat('3',64),NULL,'h-layout-quote','[]'::jsonb,'{}'::jsonb);
  PERFORM public.t4490h_ok(v_q->'hire'->>'layout'='banquet'
    AND (v_q->'hire'->>'layoutCapacity')::integer=120
    AND (SELECT price_snapshot->>'layout' FROM public.stay_quote_lines WHERE quote_id=(v_q->>'quoteId')::uuid)='banquet',
    'H-DB9 quote and immutable line snapshot carry Banquet 120');
  v_g := public.issue_4490_create_offer_group(gen_random_uuid(),(v_q->>'quoteId')::uuid,
    '{"name":"Layout Guest","email":"layout-guest@example.test"}'::jsonb,
    repeat('3',64),NULL,sha256(convert_to('h-layout-token','UTF8')),'h-layout-hold');
  v_group := (v_g->>'groupId')::uuid;
  INSERT INTO t4490h_ids VALUES ('group',v_group);
  v_projection := public.issue_4490_booking_projection(v_group,NULL);
  PERFORM public.t4490h_ok(v_projection->'hire'->>'layout'='banquet'
    AND (v_projection->'hire'->>'layoutCapacity')::integer=120,
    'H-DB10 booking facts read Banquet 120 from the immutable snapshot');
END
$quote$;
SELECT public.t4490h_reset();

SELECT public.t4490h_as('4490d000-0000-4000-8000-000000000001');
DO $host$
DECLARE v jsonb;
BEGIN
  v := public.issue_4490_requests_list('4490d000-0000-4000-9000-0000000000a1','all');
  PERFORM public.t4490h_ok(v->'requests'->0->>'layout'='banquet'
    AND (v->'requests'->0->>'layoutCapacity')::integer=120,
    'H-DB11 the host request card reads Banquet 120');
END
$host$;

ROLLBACK;
