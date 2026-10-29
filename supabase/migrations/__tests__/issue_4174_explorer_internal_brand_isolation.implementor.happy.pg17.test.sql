-- Issue #4174 — internal/demo brands never enter Explorer catalogue readers.
-- MINGLA-INVARIANT: I-4174-EXPLORER-EXCLUDES-INTERNAL-BRANDS | issue #4174 | Discover V1/V2, facets, city context and legacy Trips/Stays readers use the canonical internal-brand classification and exclude internal inventory.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.t4174_assert(p_ok boolean,p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION '#4174 Explorer internal-brand isolation FAIL: %',p_message;
  END IF;
END
$$;

DO $$
DECLARE
  v_event_base text:=pg_get_functiondef('public.discover_v2_event_base(text[],timestamptz,timestamptz,text[],text[],text[],float8,float8,float8)'::regprocedure);
  v_items text:=pg_get_functiondef('public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,integer,integer)'::regprocedure);
  v_context text:=pg_get_functiondef('public.discover_v2_city_context(text[],float8,float8,float8,text)'::regprocedure);
  v_nearest text:=pg_get_functiondef('public.discover_v2_nearest_city(float8,float8)'::regprocedure);
  v_trips text:=pg_get_functiondef('public.pg_published_trips_public(text,text,timestamptz,timestamptz,integer,integer,integer,integer,text,integer,integer)'::regprocedure);
  v_stays text:=pg_get_functiondef('public.pg_public_stays_discover(text,date,date,integer,integer,integer,text[],text[],text,integer,integer)'::regprocedure);
BEGIN
  PERFORM pg_temp.t4174_assert(
    v_event_base LIKE '%issue_4174_explorer_brand_visible(e.brand_id)%',
    'canonical event reader carries the internal-brand boundary');
  PERFORM pg_temp.t4174_assert(
    (SELECT count(*) FROM regexp_matches(v_items,'issue_4174_explorer_brand_visible','g'))=5,
    'V2 items guards experience, three trip sources and stays');
  PERFORM pg_temp.t4174_assert(
    (SELECT count(*) FROM regexp_matches(v_context,'issue_4174_explorer_brand_visible','g'))=3,
    'city context guards experience, trip and stay metadata');
  PERFORM pg_temp.t4174_assert(
    (SELECT count(*) FROM regexp_matches(v_nearest,'issue_4174_explorer_brand_visible','g'))=4,
    'nearest-city fallback guards every offering kind');
  PERFORM pg_temp.t4174_assert(
    v_trips LIKE '%issue_4174_explorer_brand_visible(e.brand_id)%',
    'installed-client Trips reader carries the same boundary');
  PERFORM pg_temp.t4174_assert(
    v_stays LIKE '%issue_4174_explorer_brand_visible(venue.brand_id)%',
    'installed-client Stays reader carries the same boundary');
END
$$;

DO $$
DECLARE
  v_real_owner uuid:=gen_random_uuid();
  v_internal_owner_a uuid:=gen_random_uuid();
  v_internal_owner_b uuid:=gen_random_uuid();
  v_real_brand uuid:=gen_random_uuid();
  v_lantern_brand uuid:=gen_random_uuid();
  v_harmattan_brand uuid:=gen_random_uuid();
  v_real_event uuid:=gen_random_uuid();
  v_lantern_event uuid:=gen_random_uuid();
  v_harmattan_event uuid:=gen_random_uuid();
  v_page jsonb;
  v_v1 jsonb;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (v_real_owner,'i4174-real-'||v_real_owner||'@ordinaryhost.co'),
    (v_internal_owner_a,'i4174-lantern-'||v_internal_owner_a||'@usemingla.com'),
    (v_internal_owner_b,'i4174-harmattan-'||v_internal_owner_b||'@usemingla.com');
  INSERT INTO public.profiles(id,email) VALUES
    (v_real_owner,'i4174-real-'||v_real_owner||'@ordinaryhost.co'),
    (v_internal_owner_a,'i4174-lantern-'||v_internal_owner_a||'@usemingla.com'),
    (v_internal_owner_b,'i4174-harmattan-'||v_internal_owner_b||'@usemingla.com');
  INSERT INTO public.creator_accounts(id,created_at,updated_at) VALUES
    (v_real_owner,now(),now()),
    (v_internal_owner_a,now(),now()),
    (v_internal_owner_b,now(),now());

  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at) VALUES
    (v_real_brand,v_real_owner,'I4174 Real Host','i4174-real-'||v_real_brand,'USD',now(),now()),
    (v_lantern_brand,v_internal_owner_a,'Lantern Room','i4174-lantern-'||v_lantern_brand,'USD',now(),now()),
    (v_harmattan_brand,v_internal_owner_b,'Harmattan Club','i4174-harmattan-'||v_harmattan_brand,'USD',now(),now());

  PERFORM pg_temp.t4174_assert(
    public.issue_4174_explorer_brand_visible(v_real_brand),
    'a real host brand remains Explorer-visible');
  PERFORM pg_temp.t4174_assert(
    NOT public.issue_4174_explorer_brand_visible(v_lantern_brand)
      AND NOT public.issue_4174_explorer_brand_visible(v_harmattan_brand),
    'Lantern Room and Harmattan Club fixtures inherit the staff-account classification');

  INSERT INTO public.events(
    id,brand_id,title,slug,event_type,status,visibility,timezone,currency,city,
    published_at,created_at,updated_at
  ) VALUES
    (v_real_event,v_real_brand,'Visible event','i4174-real-event','event','scheduled','public','UTC','USD','#4174 Isolation City',now(),now(),now()),
    (v_lantern_event,v_lantern_brand,'Lantern reviewer event','i4174-lantern-event','event','scheduled','public','UTC','USD','#4174 Isolation City',now(),now(),now()),
    (v_harmattan_event,v_harmattan_brand,'Harmattan reviewer event','i4174-harmattan-event','event','scheduled','public','UTC','USD','#4174 Isolation City',now(),now(),now());
  INSERT INTO public.event_dates(id,event_id,start_at,end_at,timezone,is_master) VALUES
    (gen_random_uuid(),v_real_event,now()+interval '2 days',now()+interval '2 days 2 hours','UTC',true),
    (gen_random_uuid(),v_lantern_event,now()+interval '2 days',now()+interval '2 days 2 hours','UTC',true),
    (gen_random_uuid(),v_harmattan_event,now()+interval '2 days',now()+interval '2 days 2 hours','UTC',true);

  v_page:=public.discover_v2_items(
    'events',ARRAY['#4174 Isolation City'],0,0,50,'UTC','{}'::jsonb,0,20);
  PERFORM pg_temp.t4174_assert(
    (v_page->>'total')::integer=1
      AND jsonb_array_length(v_page->'items')=1
      AND v_page#>>'{items,0,id}'=v_real_event::text,
    'V2 cards and total exclude both internal demo brands');

  v_v1:=public.pg_discover_business_events(
    ARRAY['#4174 Isolation City'],now(),NULL,NULL,NULL,NULL,0,20,NULL,NULL,NULL);
  PERFORM pg_temp.t4174_assert(
    (v_v1->>'total')::integer=1
      AND jsonb_array_length(v_v1->'rows')=1
      AND v_v1#>>'{rows,0,id}'=v_real_event::text,
    'installed-client V1 event discovery excludes both internal demo brands');

  INSERT INTO public.admin_internal_brands(
    brand_id,is_internal,reason,marked_by
  ) VALUES(v_real_brand,true,'#4174 adversarial explicit internal mark','pg17');
  v_page:=public.discover_v2_items(
    'events',ARRAY['#4174 Isolation City'],0,0,50,'UTC','{}'::jsonb,0,20);
  PERFORM pg_temp.t4174_assert(
    (v_page->>'total')::integer=0 AND v_page->'items'='[]'::jsonb,
    'an explicit internal-brand decision immediately removes otherwise eligible inventory');

  INSERT INTO public.admin_internal_brands(
    brand_id,is_internal,reason,marked_by
  ) VALUES(
    v_lantern_brand,false,'#4174 explicit real-brand override','pg17'
  );
  v_page:=public.discover_v2_items(
    'events',ARRAY['#4174 Isolation City'],0,0,50,'UTC','{}'::jsonb,0,20);
  PERFORM pg_temp.t4174_assert(
    (v_page->>'total')::integer=1
      AND v_page#>>'{items,0,id}'=v_lantern_event::text,
    'the canonical explicit real-brand override beats the owner email fallback');
END
$$;

SELECT pg_temp.t4174_assert(
  NOT has_function_privilege('anon','public.issue_4174_explorer_brand_visible(uuid)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.issue_4174_explorer_brand_visible(uuid)','EXECUTE'),
  'the reusable classifier stays private to service-owned catalogue readers');

ROLLBACK;
