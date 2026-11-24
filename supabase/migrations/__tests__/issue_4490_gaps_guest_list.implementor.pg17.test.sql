-- #4490 spec 07 I: executable PostgreSQL 17 proof for venue guest lists.
-- The suite owns its fixture and rolls every row back.
--
-- MINGLA-INVARIANT: I-4490-GUEST-LIST-BOUNDARY | issue #4490 | list rows are private RPC-only data; promoter tokens scope every signed-out read and write to one promoter and one venue.
-- MINGLA-INVARIANT: I-4490-GUEST-LIST-PRICE | issue #4490 | free arrivals consume ordinary Entry capacity but never the kept-for-walk-ins reserve; paid arrivals are ordinary Entry gate sales.
--
-- FAILS-ON-REVERT: without 20281203394490 the fixture helper/first feature
-- assertion fails because guest_list and its private RPCs do not exist.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE FUNCTION public.t4490i_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'T4490I FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;
CREATE FUNCTION public.t4490i_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490I FAIL: % (expected % %, got % %)', p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490I FAIL: % (expected % %, no error)', p_label, p_state, p_message;
END
$f$;
CREATE FUNCTION public.t4490i_as(p_user uuid)
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
CREATE FUNCTION public.t4490i_service()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
END
$f$;
CREATE FUNCTION public.t4490i_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;
GRANT EXECUTE ON FUNCTION public.t4490i_ok(boolean,text), public.t4490i_expect(text,text,text,text),
  public.t4490i_as(uuid), public.t4490i_service(), public.t4490i_reset() TO PUBLIC;

INSERT INTO public.feature_flags (flag_key, is_enabled)
SELECT k, true FROM unnest(ARRAY['VENUE_OFFERS_READS','VENUE_OFFERS_WRITES','STAY_RESERVE_READS','STAY_RESERVE_WRITES']) k
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
  ('4490a100-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','guest-list-owner@example.test',now(),now()),
  ('4490a100-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','guest-list-outsider@example.test',now(),now());
INSERT INTO public.creator_accounts (id, created_at)
VALUES ('4490a100-0000-4000-8000-000000000001',now());
INSERT INTO public.brands (
  id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at
) VALUES (
  '4490a100-0000-4000-9000-000000000010','4490a100-0000-4000-8000-000000000001',
  'Guest List I 4490','guest-list-i-4490','NGN','paystack',now() - interval '1 day',now(),now());
INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code
) VALUES (
  '4490a100-0000-4000-9000-0000000000a1','4490a100-0000-4000-9000-000000000010',
  'guestlisti','Guest List Club',40.71,-74.00,'club','verified','US');
-- The list closes at this future service-day opening. The one-minute window
-- also proves that 00:00 is the next service-day time after 23:59.
INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed)
SELECT '4490a100-0000-4000-9000-000000000010',
       '4490a100-0000-4000-9000-0000000000a1', d, '23:59', '00:00', false
FROM generate_series(0,6) d;

CREATE TEMP TABLE t4490i_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490i_ids TO PUBLIC;
CREATE FUNCTION public.t4490i_id(p_k text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT v FROM t4490i_ids WHERE k = p_k
$f$;
CREATE FUNCTION public.t4490i_date() RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
  SELECT public.issue_4490_venue_local_date('4490a100-0000-4000-9000-0000000000a1')
$f$;
CREATE FUNCTION public.t4490i_cutoff(p_time time) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
  SELECT public.issue_4490_guest_list_cutoff_at(
    '4490a100-0000-4000-9000-0000000000a1', public.t4490i_date(), p_time)
$f$;
GRANT EXECUTE ON FUNCTION public.t4490i_id(text), public.t4490i_date(), public.t4490i_cutoff(time) TO PUBLIC;

SELECT public.t4490i_as('4490a100-0000-4000-8000-000000000001');
DO $setup$
DECLARE
  v jsonb;
  v_pool uuid;
  v_offer uuid;
  v_option uuid;
  v_version bigint;
BEGIN
  PERFORM public.t4490i_ok('guest_list' = ANY(public.issue_4490_built_features()),
    'GL-DB1 guest_list is a shipped feature');
  PERFORM public.issue_4490_set_venue_feature(
    '4490a100-0000-4000-9000-0000000000a1','entry',true,NULL,NULL,NULL,'i-entry-on');
  PERFORM public.issue_4490_set_venue_feature(
    '4490a100-0000-4000-9000-0000000000a1','guest_list',true,NULL,NULL,NULL,'i-list-on');
  v := public.issue_4490_manage_capacity_pool('create',
    '4490a100-0000-4000-9000-0000000000a1',
    '{"name":"Door","dailyLimit":10,"keptForWalkIns":3}'::jsonb,NULL,'i-pool-create');
  v_pool := (v->>'id')::uuid;
  INSERT INTO t4490i_ids VALUES ('pool',v_pool);
  v := public.issue_4490_manage_offer('create_draft',
    '4490a100-0000-4000-9000-0000000000a1',
    '{"kind":"entry","name":"Door entry","entryStyle":"walk_in"}'::jsonb,NULL,'i-offer-create');
  v_offer := (v->>'id')::uuid;
  v_version := (v->>'version')::bigint;
  INSERT INTO t4490i_ids VALUES ('offer',v_offer);
  v := public.issue_4490_manage_offer('set_pool','4490a100-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId',v_offer,'poolId',v_pool),v_version,'i-pool-set');
  v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('upsert_price_option','4490a100-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId',v_offer,'name','Guest list price','unit','guest',
      'guestMin',1,'guestMax',10,'priceMinor',500000),v_version,'i-price-set');
  v_version := (v->>'version')::bigint;
  SELECT (row->>'id')::uuid INTO v_option FROM jsonb_array_elements(v->'options') row
  WHERE row->>'name'='Guest list price';
  INSERT INTO t4490i_ids VALUES ('option',v_option);
  v := public.issue_4490_manage_offer('set_policy','4490a100-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId',v_offer,'refundLadder','[]'::jsonb,'dateChangeRule','{}'::jsonb),
    v_version,'i-policy-set');
  v_version := (v->>'version')::bigint;
  v := public.issue_4490_manage_offer('set_schedule','4490a100-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId',v_offer,'mode','full_day','weekdays',jsonb_build_array(0,1,2,3,4,5,6),
      'startTime','00:00','endTime','23:59'),v_version,'i-schedule-set');
  v_version := (v->>'version')::bigint;
  PERFORM public.issue_4490_manage_offer('publish','4490a100-0000-4000-9000-0000000000a1',
    jsonb_build_object('offerId',v_offer),v_version,'i-offer-publish');
END
$setup$;
SELECT public.t4490i_reset();

-- -------------------------------------------------------------------------
-- Terms validation, unique names and plus-one limits.
-- -------------------------------------------------------------------------
SELECT public.t4490i_as('4490a100-0000-4000-8000-000000000001');
DO $terms$
DECLARE
  v jsonb;
  v_date date := public.t4490i_date();
BEGIN
  v := public.issue_4490_manage_guest_list('set_terms','4490a100-0000-4000-9000-0000000000a1',
    jsonb_build_object('freeUntil','00:00','reducedUntil',NULL,'reducedPriceOptionId',NULL,
      'plusOnesMax',3,'closesMinutesBefore',0),NULL,'i-terms-free');
  PERFORM public.t4490i_ok((v#>>'{terms,freeUntil}')='00:00'
      AND public.t4490i_cutoff('00:00') > (v#>>'{terms,opensAt}')::timestamptz,
    'GL-DB2 00:00 is after a 23:59 opening on the same service day');
  v := public.issue_4490_manage_guest_list('add_entry','4490a100-0000-4000-9000-0000000000a1',
    jsonb_build_object('localDate',v_date,'guestName','Ada List','plusOnes',2),NULL,'i-add-ada');
  INSERT INTO t4490i_ids VALUES ('ada',(v#>>'{entry,id}')::uuid);
END
$terms$;
SELECT public.t4490i_expect(
  format($q$SELECT public.issue_4490_manage_guest_list('add_entry','4490a100-0000-4000-9000-0000000000a1',
    jsonb_build_object('localDate',public.t4490i_date(),
      'guestName','  ADA LIST  ','plusOnes',0),NULL,'i-add-duplicate')$q$),
  'PT409','already_on_list','GL-DB3 active names are unique after trim and case-fold');
SELECT public.t4490i_expect(
  format($q$SELECT public.issue_4490_manage_guest_list('add_entry','4490a100-0000-4000-9000-0000000000a1',
    jsonb_build_object('localDate',public.t4490i_date(),
      'guestName','Too Many','plusOnes',4),NULL,'i-add-too-many')$q$),
  '22023','guest_list_invalid_payload','GL-DB4 plus-ones cannot exceed the venue terms');
SELECT public.t4490i_reset();

-- -------------------------------------------------------------------------
-- Arrival windows: free, undo, reduced Entry sale, and normal-price fallback.
-- -------------------------------------------------------------------------
SELECT public.t4490i_service();
DO $free$
DECLARE
  v jsonb;
  v_undo jsonb;
  v_usage record;
BEGIN
  v := public.issue_4490_admit_guest_list('4490a100-0000-4000-9000-0000000000a1',
    public.t4490i_id('ada'),2,'4490a100-0000-4000-8000-000000000001');
  SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(public.t4490i_id('pool'),
    public.t4490i_date());
  PERFORM public.t4490i_ok(v->>'result'='admitted' AND (v->>'admitted')::int=2
      AND v_usage.used_online=2 AND v_usage.used_gate=0 AND v_usage.kept_left=3,
    'GL-DB5 free arrivals use online Entry capacity and leave kept walk-ins intact');
  v_undo := public.issue_4490_check_in_undo('4490a100-0000-4000-9000-0000000000a1',
    (v->>'logId')::uuid,'4490a100-0000-4000-8000-000000000001');
  SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(public.t4490i_id('pool'),
    public.t4490i_date());
  PERFORM public.t4490i_ok(v_undo->>'result'='undone'
      AND (SELECT arrived=0 FROM public.venue_guest_list_entries WHERE id=public.t4490i_id('ada'))
      AND v_usage.used_online=0,
    'GL-DB6 a free list admission has the ordinary ten-minute Undo');
END
$free$;
SELECT public.t4490i_reset();

SELECT public.t4490i_as('4490a100-0000-4000-8000-000000000001');
SELECT public.issue_4490_manage_guest_list('set_terms','4490a100-0000-4000-9000-0000000000a1',
  jsonb_build_object('freeUntil',NULL,'reducedUntil','00:00',
    'reducedPriceOptionId',public.t4490i_id('option'),'plusOnesMax',3,'closesMinutesBefore',0),
  NULL,'i-terms-reduced');
SELECT public.t4490i_reset();

SELECT public.t4490i_service();
DO $reduced$
DECLARE
  v jsonb;
  v_sale jsonb;
  v_again jsonb;
BEGIN
  v := public.issue_4490_admit_guest_list('4490a100-0000-4000-9000-0000000000a1',
    public.t4490i_id('ada'),1,'4490a100-0000-4000-8000-000000000001');
  PERFORM public.t4490i_ok(v->>'result'='sell' AND (v->>'priceOptionId')::uuid=public.t4490i_id('option')
      AND (v->>'count')::int=1,
    'GL-DB7 the reduced window returns the configured live Entry price and count');
  v_sale := public.issue_4490_guest_list_gate_sale('4490a100-0000-4000-9000-0000000000a1',
    public.t4490i_id('ada'),1,'cash','{"name":"Ada List"}'::jsonb,'i-reduced-cash',
    '4490a100-0000-4000-8000-000000000001');
  v_again := public.issue_4490_guest_list_gate_sale('4490a100-0000-4000-9000-0000000000a1',
    public.t4490i_id('ada'),1,'cash','{"name":"Ada List"}'::jsonb,'i-reduced-cash',
    '4490a100-0000-4000-8000-000000000001');
  PERFORM public.t4490i_ok(v_sale#>>'{booking,state}'='confirmed'
      AND v_again->>'replayed'='true'
      AND (SELECT arrived=1 FROM public.venue_guest_list_entries WHERE id=public.t4490i_id('ada'))
      AND (SELECT count(*)=1 FROM public.venue_guest_list_sales WHERE entry_id=public.t4490i_id('ada') AND applied_at IS NOT NULL),
    'GL-DB8 a reduced Entry sale marks the list arrival exactly once across replay');
END
$reduced$;
SELECT public.t4490i_reset();

SELECT public.t4490i_as('4490a100-0000-4000-8000-000000000001');
SELECT public.issue_4490_manage_guest_list('set_terms','4490a100-0000-4000-9000-0000000000a1',
  jsonb_build_object('freeUntil',NULL,'reducedUntil',NULL,'reducedPriceOptionId',NULL,
    'plusOnesMax',3,'closesMinutesBefore',0),NULL,'i-terms-closed-price');
SELECT public.t4490i_reset();
SELECT public.t4490i_service();
DO $closed_price$
DECLARE v jsonb;
BEGIN
  v := public.issue_4490_admit_guest_list('4490a100-0000-4000-9000-0000000000a1',
    public.t4490i_id('ada'),1,'4490a100-0000-4000-8000-000000000001');
  PERFORM public.t4490i_ok(v->>'result'='list_closed_for_price',
    'GL-DB9 after both cutoffs the door falls back to normal Entry sale');
END
$closed_price$;
SELECT public.t4490i_reset();

SELECT public.t4490i_service();
UPDATE public.venue_offer_price_options SET status='archived'
WHERE id=public.t4490i_id('option');
SELECT public.t4490i_reset();
SELECT public.t4490i_as('4490a100-0000-4000-8000-000000000001');
SELECT public.t4490i_expect(format($q$SELECT public.issue_4490_manage_guest_list(
    'set_terms','4490a100-0000-4000-9000-0000000000a1',
    jsonb_build_object('freeUntil',NULL,'reducedUntil','00:00',
      'reducedPriceOptionId',%L::uuid,'plusOnesMax',3,'closesMinutesBefore',0),
    NULL,'i-terms-invalid-price')$q$,public.t4490i_id('option')),
  '22023','guest_list_reduced_price_invalid',
  'GL-DB9b a reduced window refuses an archived or non-live Entry price');
SELECT public.t4490i_reset();

-- -------------------------------------------------------------------------
-- Promoter token boundary, list close and row-count limits.
-- -------------------------------------------------------------------------
SELECT public.t4490i_as('4490a100-0000-4000-8000-000000000001');
DO $promoters$
DECLARE
  v jsonb;
  v_replay jsonb;
BEGIN
  v := public.issue_4490_manage_guest_list('add_promoter','4490a100-0000-4000-9000-0000000000a1',
    '{"name":"Tunde","namesPerNight":2}'::jsonb,NULL,'i-promoter-tunde');
  INSERT INTO t4490i_ids VALUES ('tunde',(v#>>'{promoter,id}')::uuid);
  PERFORM set_config('t4490i.tunde_token',v->>'token',true);
  v_replay := public.issue_4490_manage_guest_list('add_promoter','4490a100-0000-4000-9000-0000000000a1',
    '{"name":"Tunde","namesPerNight":2}'::jsonb,NULL,'i-promoter-tunde');
  PERFORM public.t4490i_ok(NOT (v_replay ? 'token')
      AND v_replay#>>'{promoter,id}'=public.t4490i_id('tunde')::text,
    'GL-DB10a a promoter link secret is returned by its creating call only');
  v := public.issue_4490_manage_guest_list('add_promoter','4490a100-0000-4000-9000-0000000000a1',
    '{"name":"Bisi"}'::jsonb,NULL,'i-promoter-bisi');
  INSERT INTO t4490i_ids VALUES ('bisi',(v#>>'{promoter,id}')::uuid);
  PERFORM set_config('t4490i.bisi_token',v->>'token',true);
  PERFORM public.issue_4490_manage_guest_list('set_terms','4490a100-0000-4000-9000-0000000000a1',
    jsonb_build_object('freeUntil','00:00','reducedUntil',NULL,'reducedPriceOptionId',NULL,
      'plusOnesMax',3,'closesMinutesBefore',0),NULL,'i-terms-promoter-open');
END
$promoters$;
SELECT public.t4490i_reset();

SELECT public.t4490i_service();
DO $promoter_write$
DECLARE
  v_tunde bytea := sha256(convert_to(current_setting('t4490i.tunde_token'),'UTF8'));
  v_bisi bytea := sha256(convert_to(current_setting('t4490i.bisi_token'),'UTF8'));
  v_date date := public.t4490i_date();
  v jsonb;
  v_id uuid;
  v_get jsonb;
BEGIN
  v := public.issue_4490_guest_list_promoter_write(v_tunde,'add',
    jsonb_build_object('localDate',v_date,'guestName','Tunde Guest','plusOnes',1));
  v_id := (v#>>'{entry,id}')::uuid;
  v_get := public.issue_4490_guest_list_promoter_get(v_tunde);
  PERFORM public.t4490i_ok(v_get#>>'{promoter,name}'='Tunde'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_get->'nights') night,
        jsonb_array_elements(night->'entries') entry_row WHERE entry_row->>'id'=v_id::text),
    'GL-DB10 a promoter link reads only its own eight-night list');
  PERFORM public.t4490i_expect(format($q$SELECT public.issue_4490_guest_list_promoter_write(
      decode(%L,'hex'),'remove',jsonb_build_object('localDate',%L::date,'entryId',%L::uuid))$q$,
      encode(v_bisi,'hex'),v_date,v_id),
    'P0002','guest_list_entry_not_found',
    'GL-DB11 one promoter cannot remove another promoter''s name');
END
$promoter_write$;
SELECT public.t4490i_reset();

SELECT public.t4490i_service();
DO $rate_fixture$
DECLARE
  v_date date := public.t4490i_date();
BEGIN
  INSERT INTO public.venue_guest_list_entries (
    venue_id,brand_id,local_date,guest_name,plus_ones,added_by_kind,promoter_id
  ) SELECT '4490a100-0000-4000-9000-0000000000a1','4490a100-0000-4000-9000-000000000010',
      v_date,'Rate '||n,0,'promoter',public.t4490i_id('bisi')
    FROM generate_series(1,60) n;
END
$rate_fixture$;
SELECT public.t4490i_expect(format($q$SELECT public.issue_4490_guest_list_promoter_write(
    decode(%L,'hex'),'add',jsonb_build_object('localDate',public.t4490i_date(),
      'guestName','Rate 61','plusOnes',0))$q$,
    encode(sha256(convert_to(current_setting('t4490i.bisi_token'),'UTF8')),'hex')),
  'PT429','guest_list_rate_limited','GL-DB12 removed or active rows both count toward the 60-per-hour cap');
SELECT public.t4490i_reset();

SELECT public.t4490i_as('4490a100-0000-4000-8000-000000000001');
SELECT public.issue_4490_manage_guest_list('set_terms','4490a100-0000-4000-9000-0000000000a1',
  jsonb_build_object('freeUntil','00:00','reducedUntil',NULL,'reducedPriceOptionId',NULL,
    'plusOnesMax',3,'closesMinutesBefore',1440),NULL,'i-terms-list-closed');
SELECT public.t4490i_reset();
SELECT public.t4490i_service();
SELECT public.t4490i_expect(format($q$SELECT public.issue_4490_guest_list_promoter_write(
    decode(%L,'hex'),'add',jsonb_build_object('localDate',public.t4490i_date(),
      'guestName','Too Late','plusOnes',0))$q$,
    encode(sha256(convert_to(current_setting('t4490i.tunde_token'),'UTF8')),'hex')),
  'PT409','guest_list_closed','GL-DB13 promoter writes stop at the configured pre-opening close');

-- -------------------------------------------------------------------------
-- Raw-table isolation and scoped projections.
-- -------------------------------------------------------------------------
SELECT public.t4490i_as('4490a100-0000-4000-8000-000000000002');
SELECT public.t4490i_expect('SELECT count(*) FROM public.venue_guest_list_entries',
  '42501',NULL,'GL-DB14 authenticated callers have no raw guest-list table access');
SELECT public.t4490i_reset();

SELECT public.t4490i_service();
DO $door_list$
DECLARE v jsonb;
BEGIN
  v := public.issue_4490_check_in_list('4490a100-0000-4000-9000-0000000000a1',NULL,
    '4490a100-0000-4000-8000-000000000001');
  PERFORM public.t4490i_ok(EXISTS (SELECT 1 FROM jsonb_array_elements(v->'guestList') row
      WHERE row->>'guestName'='Ada List' AND row->>'kind'='guest_list'),
    'GL-DB15 the door list and search projection include guest-list names');
END
$door_list$;

ROLLBACK;
