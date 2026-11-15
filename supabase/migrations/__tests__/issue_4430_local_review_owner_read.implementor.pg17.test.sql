\set ON_ERROR_STOP on

-- #4430 L-3: the Explorer reads the Local's own submitted review (including Admin's
-- requested changes) straight from public.local_reviews. This locks the RLS read the
-- app now depends on; no schema change. Everything rolls back.
--
-- MINGLA-INVARIANT: I-4430-L3-RLS | issue #4430 | a Local reads exactly their own local_reviews row, changes_requested included, and no other signed-in user reads it (T-L3-RLS)

BEGIN;

DO $l3rls$
DECLARE
  v_owner constant uuid := '44301000-0000-4000-8000-000000000001';
  v_other constant uuid := '44301000-0000-4000-8000-000000000002';
  v_city constant uuid := '44301000-0000-4000-8000-000000000004';
  v_place constant uuid := '44301000-0000-4000-8000-000000000005';
  v_month constant uuid := '44301000-0000-4000-8000-000000000006';
  v_media constant uuid := '44301000-0000-4000-8000-000000000007';
  v_local uuid;
  v_seen integer;
  v_requested text[];
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (v_owner,'issue-4430-l3-owner@test.local'),
    (v_other,'issue-4430-l3-other@test.local');
  INSERT INTO public.seeding_cities(id,google_place_id,name,country,country_code,center_lat,center_lng,
    bbox_sw_lat,bbox_sw_lng,bbox_ne_lat,bbox_ne_lng)
  VALUES (v_city,'issue-4430-l3-city','L3 City','Nigeria','NG',6.5,3.4,6.4,3.3,6.6,3.5);
  INSERT INTO public.local_city_programs(city_id,seats,is_open,monthly_usd_minor,monthly_rate_minor,payout_currency)
  VALUES (v_city,2,true,15000,15000,'USD');
  INSERT INTO public.locals(user_id,city_id,agreement_version) VALUES (v_owner,v_city,'local-ng-1.0')
  RETURNING id INTO v_local;
  INSERT INTO public.place_pool(id,name,lat,lng,city_id,is_active,is_servable)
  VALUES (v_place,'Issue 4430 L3 place',6.5,3.4,v_city,true,true);
  INSERT INTO public.local_months(id,local_id,month,place_id,status,picked_at,confirmed_at,visited_at,submitted_at,changes_due_at)
  VALUES (v_month,v_local,date_trunc('month',current_date)::date,v_place,'changes_requested',
    now(),now(),now(),now(),now()+interval '5 days');
  INSERT INTO public.creator_media_jobs(id,client_operation_id,owner_kind,owner_id,purpose,local_month_id,bunny_video_id,status,ready_at,created_at)
  VALUES (v_media,gen_random_uuid(),'local',v_owner,'local_review',v_month,'4430-l3-video','ready',now(),now());
  INSERT INTO public.local_reviews(local_month_id,rating,title,body,visited_on,spend_band,media_job_ids,social_post_url,disclosure_ack,changes_requested)
  VALUES (v_month,4,'Small plates worth the trip',repeat('A first-hand Local review of the place. ',10),current_date,'moderate',
    ARRAY[v_media],'https://www.instagram.com/p/issue4430l3',true,ARRAY['Show the receipt','Say the place name']);

  -- The owner reads their own row, with Admin's request.
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',v_owner,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  SELECT count(*), max(changes_requested) INTO v_seen, v_requested FROM public.local_reviews WHERE local_month_id=v_month;
  RESET ROLE;
  IF v_seen<>1 OR v_requested IS DISTINCT FROM ARRAY['Show the receipt','Say the place name'] THEN
    RAISE EXCEPTION '#4430 L3 the owner could not read their own review and its requested changes (rows %, changes %)',v_seen,v_requested;
  END IF;

  -- Another signed-in user reads nothing.
  PERFORM set_config('request.jwt.claim.sub',v_other::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',v_other,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM public.local_reviews WHERE local_month_id=v_month;
  RESET ROLE;
  IF v_seen<>0 THEN
    RAISE EXCEPTION '#4430 L3 another user read a Local''s private review (% rows)',v_seen;
  END IF;

  -- Signed out (anon) reads nothing either.
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','',true);
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO v_seen FROM public.local_reviews WHERE local_month_id=v_month;
  EXCEPTION WHEN insufficient_privilege THEN
    v_seen:=0;
  END;
  RESET ROLE;
  IF v_seen<>0 THEN
    RAISE EXCEPTION '#4430 L3 a signed-out caller read a Local review (% rows)',v_seen;
  END IF;
END;
$l3rls$;

ROLLBACK;
\echo 'issue #4430 Local review owner read passed'
