-- Issue #4073 — one-page Discover server contract, PostgreSQL 17 proof.
-- MINGLA-INVARIANT: I-4073-DISCOVER-ELIGIBILITY | issue #4073 | V1 and V2 event discovery share one eligibility reader; all v2 card/facet counts use server-owned per-kind eligibility, calendar, price, radius and availability rules.
-- MINGLA-INVARIANT: I-DISCOVER-CITY-TZ | issue #4073 | All v2 calendar windows are owned by the tested SQL helper; clients send intent, never UTC window math.
-- MINGLA-INVARIANT: I-DISCOVER-ONE-PRICE-OWNER | issue #4073 | Visible, enabled, non-hidden tiers alone determine the tested Discover all-in from price.
-- MINGLA-INVARIANT: I-DISCOVER-CITY-WATCH-ONCE | issue #4073 | The tested city-watch transaction gives each row one idempotency key and marks it notified atomically.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.t4073_assert(p_ok boolean,p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION '#4073 discover v2 FAIL: %',p_message; END IF;
END
$$;

DO $$
DECLARE
  v_v1 text:=pg_get_functiondef('public.pg_discover_business_events(text[],timestamptz,timestamptz,text[],text[],text[],integer,integer,float8,float8,float8)'::regprocedure);
  v_base text:=pg_get_functiondef('public.discover_v2_event_base(text[],timestamptz,timestamptz,text[],text[],text[],float8,float8,float8)'::regprocedure);
  v_items text:=pg_get_functiondef('public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,integer,integer)'::regprocedure);
  v_facets text:=pg_get_functiondef('public.discover_v2_facets_exact(text[],float8,float8,float8,text,text,jsonb,text)'::regprocedure);
  v_price text:=pg_get_functiondef('public.discover_v2_price_option(text,text,text,integer,boolean,jsonb)'::regprocedure);
  v_context text:=pg_get_functiondef('public.discover_v2_city_context(text[],float8,float8,float8,text)'::regprocedure);
  v_nearest text:=pg_get_functiondef('public.discover_v2_nearest_city(float8,float8)'::regprocedure);
BEGIN
  PERFORM pg_temp.t4073_assert(v_v1 LIKE '%discover_v2_event_base%',
    'v1 delegates to the canonical event eligibility reader');
  PERFORM pg_temp.t4073_assert(v_base LIKE '%master_ed.is_master IS TRUE%'
    AND v_base LIKE '%occurrence.end_at>=p_lower_bound%'
    AND v_base LIKE '%issue_1931_event_ordinary_read_blocked%'
    AND v_base LIKE '%pg_brand_can_collect%'
    AND v_base LIKE '%business_event%format%online%',
    'canonical event base requires a master identity but selects the next visible recurrence with privacy, paid-supply and online-carveout guards');
  PERFORM pg_temp.t4073_assert(v_items LIKE '%tm_horizon_120%'
    AND v_items LIKE '%experience_stops%'
    AND v_items LIKE '%departure_country_code%country_code%'
    AND v_items LIKE '%discover_v2_stay_room_available%'
    AND v_items LIKE '%discover_v2_price_matches%',
    'v2 items owns event horizon plus experience, trip, stay and price eligibility');
  PERFORM pg_temp.t4073_assert(v_facets LIKE '%discover_v2_option_count%'
    AND v_facets LIKE '%v_base%'
    AND v_facets LIKE '%discover_v2_nearest_city%',
    'facet options and counts use exclude-own-group eligibility and nearest-city fallback');
  PERFORM pg_temp.t4073_assert(v_price LIKE '%p_catalog%p_kind%upper(p_currency)%',
    'price bands are selected by item currency from the edge-owned catalog');
  PERFORM pg_temp.t4073_assert(v_context LIKE '%timezone_choice%item_count DESC%nearest_km ASC%'
    AND v_context LIKE '%stay_settings%timezone%'
    AND v_context LIKE '%tzSource%',
    'city timezone is the eligible-supply majority with nearest-item tie break and explicit source');
  PERFORM pg_temp.t4073_assert(v_nearest LIKE '%distance_km<=500%'
    AND v_nearest LIKE '%concat_ws%' AND v_nearest LIKE '%country_code%',
    'nearest-city fallback is bounded and returns country-qualified labels');
END
$$;

-- [TEST-MOD-APPROVED #4073] Exact-main integration adds the already-scoped
-- #3872 sale contract to this initiative's canonical server-response proof.
-- D8: the durable master may be historical while a visible recurrence remains.
-- The canonical reader and v2 ordering must use that next occurrence instead
-- of dropping the whole event at the ended-master gate.
DO $$
DECLARE
  v_owner uuid:=gen_random_uuid(); v_brand uuid:=gen_random_uuid(); v_event uuid:=gen_random_uuid();
  v_ticket uuid:=gen_random_uuid(); v_sale uuid:=gen_random_uuid();
  v_watch uuid:=gen_random_uuid(); v_scanned integer; v_outbox_country text;
  v_page jsonb; v_item jsonb;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_owner,'i4073-recurrence-'||v_owner||'@example.test');
  INSERT INTO public.profiles(id,email) VALUES(v_owner,'i4073-recurrence-'||v_owner||'@example.test');
  INSERT INTO public.creator_accounts(id,created_at,updated_at) VALUES(v_owner,now(),now());
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,paystack_subaccount_code,created_at,updated_at
  ) VALUES(
    v_brand,v_owner,'I4073 recurrence','i4073-recurrence-'||v_brand,'USD',
    'ACCT_i4073_recurrence',now(),now()
  );
  PERFORM pg_temp.t4073_assert(public.pg_brand_can_collect(v_brand),
    'paid-sale fixture satisfies the production collection gate');
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='discounts_enabled';
  INSERT INTO public.program_brand_rollouts(brand_id,program,phase)
    VALUES(v_brand,'discounts','pilot');
  INSERT INTO public.events(id,brand_id,title,slug,event_type,status,visibility,timezone,currency,city,published_at,pass_mingla_fee,pass_service_fee,created_at,updated_at)
    VALUES(v_event,v_brand,'Future recurrence','i4073-future-'||v_event,'event','scheduled','public','UTC','USD','#4073 Future City',now(),false,false,now(),now());
  INSERT INTO public.event_dates(id,event_id,start_at,end_at,timezone,is_master) VALUES
    (gen_random_uuid(),v_event,now()-interval '3 days',now()-interval '2 days','UTC',true),
    (gen_random_uuid(),v_event,now()+interval '2 days',now()+interval '2 days 2 hours','UTC',false);
  INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,is_free,quantity_total,is_unlimited,min_purchase_qty,max_purchase_qty,available_online,available_in_person,display_order,is_hidden,is_disabled)
    VALUES(v_ticket,v_event,'General',2000,'USD',false,20,false,1,4,true,true,0,false,false);
  INSERT INTO public.brand_discounts(
    id,brand_id,kind,name,value_type,value_minor,currency,scope_kind,combines_with,status,created_by
  ) VALUES(v_sale,v_brand,'sale_price','Discover sale','set_price',1500,'USD','items','any','active',v_owner);
  INSERT INTO public.brand_discount_targets(discount_id,target_kind,target_id)
    VALUES(v_sale,'ticket_type',v_ticket);

  v_page:=public.discover_v2_items('events',ARRAY['#4073 Future City'],0,0,50,'UTC','{}'::jsonb,0,10);
  SELECT value INTO v_item FROM jsonb_array_elements(v_page->'items') WHERE value->>'id'=v_event::text;
  PERFORM pg_temp.t4073_assert(v_item IS NOT NULL,'future recurrence survives an ended master');
  PERFORM pg_temp.t4073_assert((v_item->>'startsAtUtc')::timestamptz>now(),'v2 emits and orders by the future recurrence');
  PERFORM pg_temp.t4073_assert(
    (v_item#>>'{price,listMinor}')::integer=2000
      AND (v_item#>>'{price,saleMinor}')::integer=1500,
    'Discover preserves the #3872 public list and sale from prices');

  -- [TEST-MOD-APPROVED #4073] Behavioural country proof for the producer
  -- classification in issue_1529_producer_catalog_audit.test.sql.
  INSERT INTO public.discover_city_watch(
    id,user_id,city_key,city_label,city_name,state_code,country_code,lat,lng
  ) VALUES(
    v_watch,v_owner,'i4073-future-city-ng','#4073 Future City','#4073 Future City',NULL,'NG',0,0
  );
  v_scanned:=public.issue_4073_scan_city_watches(50);
  SELECT country_code INTO v_outbox_country
  FROM public.notification_outbox
  WHERE idempotency_key='discover_city_plans_live:'||v_watch::text;
  PERFORM pg_temp.t4073_assert(v_scanned=1,
    'city-watch scan enqueues the newly eligible city exactly once');
  PERFORM pg_temp.t4073_assert(v_outbox_country='NG',
    'city-watch notification copies the durable watch country code');
  PERFORM pg_temp.t4073_assert(
    (SELECT notified_at IS NOT NULL FROM public.discover_city_watch WHERE id=v_watch),
    'city-watch scan atomically marks the durable watch notified');
END
$$;

-- Execute every kind through the final reader on an empty city. This is a
-- runtime compilation guard for the SQL embedded in the PL/pgSQL branches,
-- including the canonical SETOF-json event alias and first-stop geography.
DO $$
DECLARE
  v_kind text;
  v_page jsonb;
BEGIN
  FOREACH v_kind IN ARRAY ARRAY['events','experiences','trips','stays'] LOOP
    v_page:=public.discover_v2_items(
      v_kind,ARRAY['#4073-no-such-city'],0,0,
      public.discover_v2_radius_km(v_kind),'UTC','{}'::jsonb,0,10);
    PERFORM pg_temp.t4073_assert(v_page->'items'='[]'::jsonb AND (v_page->>'total')::integer=0,
      v_kind||' empty-city reader compiles and returns the canonical empty page');
  END LOOP;
END
$$;
SELECT pg_temp.t4073_assert(
  public.discover_v2_city_context(ARRAY['#4073-no-such-city'],0,0,50,'America/New_York')
    @> '{"tz":"America/New_York","tzSource":"device","majorityCurrency":null}'::jsonb,
  'city context falls back to the validated device timezone when eligible supply is absent');

-- Calendar windows are city-local, half-open, and the no-filter event horizon
-- is bounded to 120 days rather than becoming an unbounded feed.
SELECT pg_temp.t4073_assert(
  lower(public.discover_v2_window('weekend','America/New_York','2026-10-22 16:00:00+00'))
    AT TIME ZONE 'America/New_York'='2026-10-23 18:00:00'::timestamp,
  'Thursday resolves to Friday 18:00 in the city timezone');
SELECT pg_temp.t4073_assert(
  upper(public.discover_v2_window('weekend','America/New_York','2026-10-24 16:00:00+00'))
    AT TIME ZONE 'America/New_York'='2026-10-26 00:00:00'::timestamp,
  'an in-progress Saturday weekend ends at Monday city midnight');
SELECT pg_temp.t4073_assert(
  upper(public.discover_v2_window('tm_horizon_120','UTC','2026-10-24 12:00:00+00'))
    - lower(public.discover_v2_window('tm_horizon_120','UTC','2026-10-24 12:00:00+00'))=interval '120 days',
  'the default event horizon is exactly 120 days');
SELECT pg_temp.t4073_assert(
  upper(public.discover_v2_window('weekend','Europe/London','2027-03-27 20:00:00+00'))
    AT TIME ZONE 'Europe/London'='2027-03-29 00:00:00'::timestamp,
  'the spring DST weekend still ends at Monday city midnight');

-- Price classification is server-side, currency-specific, half-open at the
-- edge, and retains the free RSVP/ticket distinctions used by the UI.
SELECT pg_temp.t4073_assert(
  public.discover_v2_price_option('events','event','GBP',1999,false,
    '{"events":{"GBP":[2000,4000]}}'::jsonb)='band_1'
  AND public.discover_v2_price_option('events','event','GBP',2000,false,
    '{"events":{"GBP":[2000,4000]}}'::jsonb)='band_2'
  AND public.discover_v2_price_option('events','rsvp','GBP',NULL,false,
    '{"events":{"GBP":[2000,4000]}}'::jsonb)='free_rsvp'
  AND public.discover_v2_price_option('events','event','GBP',0,true,
    '{"events":{"GBP":[2000,4000]}}'::jsonb)='free_ticket',
  'price options use half-open per-currency bands and canonical free labels');
SELECT pg_temp.t4073_assert(
  public.discover_v2_price_matches('events','event','GBP',2000,false,
    '{"price":["band_2"],"_priceCatalog":{"events":{"GBP":[2000,4000]}}}'::jsonb)
  AND NOT public.discover_v2_price_matches('events','event','GBP',1999,false,
    '{"price":["band_2"],"_priceCatalog":{"events":{"GBP":[2000,4000]}}}'::jsonb),
  'the SQL reader applies price selections rather than post-filtering client rows');
SELECT pg_temp.t4073_assert(
  public.discover_v2_radius_km('events')=50 AND public.discover_v2_radius_km('stays')=100,
  'kind radii stay server-owned');
SELECT pg_temp.t4073_assert(public.discover_v2_nearest_city(0,0) IS NULL,
  'nearest city is null when no eligible inventory exists within 500 km');

-- A single durable row and FOR UPDATE claim implement the exact org-wide daily
-- call budget. This transaction rolls the fixture back.
SELECT pg_temp.t4073_assert(public.discover_v2_tm_budget_available('2099-12-29',2),
  'an absent budget row has capacity');
SELECT pg_temp.t4073_assert(public.discover_v2_claim_tm_budget('2099-12-29',2),
  'first Ticketmaster call is admitted');
SELECT pg_temp.t4073_assert(public.discover_v2_claim_tm_budget('2099-12-29',2),
  'second Ticketmaster call is admitted');
SELECT pg_temp.t4073_assert(NOT public.discover_v2_claim_tm_budget('2099-12-29',2),
  'the exact daily limit rejects the next call');
SELECT pg_temp.t4073_assert(NOT public.discover_v2_tm_budget_available('2099-12-29',2),
  'SWR can disclose exhaustion while serving stale L2 data');

SELECT pg_temp.t4073_assert(
  has_function_privilege('service_role','public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,integer,integer)','EXECUTE')
  AND NOT has_function_privilege('anon','public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,integer,integer)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,integer,integer)','EXECUTE'),
  'v2 data reader is service-role only');
SELECT pg_temp.t4073_assert(
  has_function_privilege('service_role','public.discover_v2_from_price_minor(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.discover_v2_from_price_minor(uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.discover_v2_from_price_minor(uuid)','EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
    WHERE p.oid='public.discover_v2_from_price_minor(uuid)'::regprocedure
      AND acl.grantee=0 AND acl.privilege_type='EXECUTE'),
  'security-definer from-price authority is service-role only');
SELECT pg_temp.t4073_assert(
  has_function_privilege('service_role','public.discover_v2_claim_tm_budget(date,integer)','EXECUTE')
  AND NOT has_function_privilege('anon','public.discover_v2_claim_tm_budget(date,integer)','EXECUTE'),
  'durable budget authority is service-role only');
SELECT pg_temp.t4073_assert(
  (SELECT prosecdef AND proowner='postgres'::regrole
     FROM pg_proc WHERE oid='public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,integer,integer)'::regprocedure),
  'v2 reader is postgres-owned SECURITY DEFINER');
SELECT pg_temp.t4073_assert(
  EXISTS(SELECT 1 FROM public.issue_2489_gate_carriers
    WHERE object_name='discover_v2_items' AND object_kind='function')
  AND EXISTS(SELECT 1 FROM public.issue_2489_gate_carriers
    WHERE object_name='discover_v2_event_base' AND object_kind='function'),
  'privacy gate carriers include the canonical and v2 readers');

SELECT pg_temp.t4073_assert(
  public.discover_v2_url_encode_component('100% fun&games=now/yes?|GB')='100%25%20fun%26games%3Dnow%2Fyes%3F%7CGB',
  'city-watch URL component encoder covers percent and reserved characters');

ROLLBACK;
