-- #3872 round 2 server contract, adversarial: a non-member cannot read the
-- promotion overview, another creator cannot set my city, a false paid-ads
-- opt-in is still stored true (and cannot be written false), hired creators
-- never appear as interested, and money_state says paid after release and
-- is never "on the way" again. Every fixture rolls back.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claim.sub',coalesce(p_user::text,''),true),
         set_config('request.jwt.claims',CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub',p_user,'role','authenticated')::text END,true);
$fn$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES
  ('38725000-0000-4000-8000-0000000000a1','r2a-host@mingla.test'),
  ('38725000-0000-4000-8000-0000000000a3','r2a-creator@mingla.test'),
  ('38725000-0000-4000-8000-0000000000a4','r2a-creator2@mingla.test'),
  ('38725000-0000-4000-8000-0000000000a5','r2a-stranger@mingla.test'),
  ('38725000-0000-4000-8000-0000000000a6','r2a-other-host@mingla.test');
INSERT INTO public.brands(id,account_id,name,slug,default_currency) VALUES
  ('38725000-0000-4000-8000-0000000000b1','38725000-0000-4000-8000-0000000000a1','Adversarial Rooftop','r2a-rooftop','USD'),
  ('38725000-0000-4000-8000-0000000000b2','38725000-0000-4000-8000-0000000000a6','Other Brand','r2a-other','USD');
INSERT INTO public.seeding_cities(id,google_place_id,name,country,country_code,center_lat,center_lng,bbox_sw_lat,bbox_sw_lng,bbox_ne_lat,bbox_ne_lng,is_live_for_consumers) VALUES
  ('38725000-0000-4000-8000-0000000000c1','r2a-live','Adversaria','United States','US',35.7,-78.6,35.6,-78.7,35.8,-78.5,true);
INSERT INTO public.events(id,brand_id,title,slug,status,published_at) VALUES
  ('38725000-0000-4000-8000-0000000000e1','38725000-0000-4000-8000-0000000000b1','Rooftop Night','r2a-night','scheduled',now()),
  ('38725000-0000-4000-8000-0000000000e2','38725000-0000-4000-8000-0000000000b2','Other Night','r2a-other-night','scheduled',now());
INSERT INTO public.creator_accounts(id,email,display_name) VALUES
  ('38725000-0000-4000-8000-0000000000a3','r2a-creator@mingla.test','Ada Films'),
  ('38725000-0000-4000-8000-0000000000a4','r2a-creator2@mingla.test','Bo Clips');
INSERT INTO public.creator_profiles(creator_account_id,mode_enabled,display_name,home_city_id,niches,verification,date_of_birth,agreement_version,agreement_signed_at) VALUES
  ('38725000-0000-4000-8000-0000000000a3',true,'Ada Films','38725000-0000-4000-8000-0000000000c1',ARRAY['food'],'verified','1995-01-01','v1',now()),
  ('38725000-0000-4000-8000-0000000000a4',true,'Bo Clips','38725000-0000-4000-8000-0000000000c1',ARRAY['music'],'verified','1995-01-01','v1',now());
INSERT INTO public.creator_packages(id,creator_account_id,format_key,platforms,price_minor,currency,turnaround_days) VALUES
  ('38725000-0000-4000-8000-0000000000d3','38725000-0000-4000-8000-0000000000a3','date_idea',ARRAY['instagram'],30000,'USD',5);
INSERT INTO public.payee_accounts(user_id,stripe_account_id,stripe_status) VALUES
  ('38725000-0000-4000-8000-0000000000a3','acct_r2a1','active');
INSERT INTO public.gigs(id,brand_id,listing_kind,listing_id,title_public,brief_public,format_key,deliverables,city_id,category,shoot_window_start,shoot_window_end,post_by,budget_band,currency,slots,status,created_by) VALUES
  ('38725000-0000-4000-8000-0000000000f1','38725000-0000-4000-8000-0000000000b1','event','38725000-0000-4000-8000-0000000000e1',
   'A rooftop date night','Show a relaxed evening on a rooftop with music, drinks and the view across the city.','date_idea','["1 reel"]'::jsonb,
   '38725000-0000-4000-8000-0000000000c1','nightlife',current_date+1,current_date+20,current_date+30,'b2','USD',2,'open','38725000-0000-4000-8000-0000000000a1');
INSERT INTO public.gig_interest(id,gig_id,creator_account_id,package_id,quoted_minor,status) VALUES
  ('38725000-0000-4000-8000-000000000101','38725000-0000-4000-8000-0000000000f1','38725000-0000-4000-8000-0000000000a3','38725000-0000-4000-8000-0000000000d3',30000,'sent');
SET LOCAL session_replication_role = origin;

INSERT INTO public.feature_flags(flag_key,is_enabled,description) VALUES('creator_gigs_enabled',true,'test')
ON CONFLICT(flag_key) DO UPDATE SET is_enabled=true;
INSERT INTO public.program_brand_rollouts(brand_id,program,phase) VALUES('38725000-0000-4000-8000-0000000000b1','creator_gigs','pilot')
ON CONFLICT DO NOTHING;

DO $test$
DECLARE
  v_host constant uuid:='38725000-0000-4000-8000-0000000000a1';
  v_creator constant uuid:='38725000-0000-4000-8000-0000000000a3';
  v_creator2 constant uuid:='38725000-0000-4000-8000-0000000000a4';
  v_stranger constant uuid:='38725000-0000-4000-8000-0000000000a5';
  v_other_host constant uuid:='38725000-0000-4000-8000-0000000000a6';
  v_brand constant uuid:='38725000-0000-4000-8000-0000000000b1';
  v_city constant uuid:='38725000-0000-4000-8000-0000000000c1';
  v_gig constant uuid:='38725000-0000-4000-8000-0000000000f1';
  v_r jsonb; v_c uuid; v_failed boolean; v_state text; v_gigrow jsonb;
BEGIN
  -- Grants: the new reads are for signed-in users only; helpers stay internal.
  IF to_regprocedure('public.brand_promotion_overview(uuid,text,uuid)') IS NULL
     OR has_function_privilege('anon','public.brand_promotion_overview(uuid,text,uuid)','execute')
     OR has_function_privilege('anon','public.creator_city_search(text)','execute')
     OR has_function_privilege('anon','public.creator_home_city_set(uuid,text,text)','execute')
     OR NOT has_function_privilege('authenticated','public.creator_home_city_set(uuid,text,text)','execute')
     OR has_function_privilege('authenticated','public.issue_3872_store_home_city(uuid,uuid,text,text)','execute')
     OR has_function_privilege('authenticated','public.issue_3872_contract_money_state(uuid)','execute')
     OR has_function_privilege('authenticated','public.issue_3872_creator_hired_on_gig(uuid,uuid)','execute') THEN
    RAISE EXCEPTION 'round 2 grants drifted';
  END IF;

  -- Non-members cannot read the promotion overview.
  FOREACH v_c IN ARRAY ARRAY[v_stranger,v_other_host,v_creator] LOOP
    PERFORM pg_temp.act(v_c);
    v_failed:=false;
    BEGIN PERFORM public.brand_promotion_overview(v_brand);
    EXCEPTION WHEN others THEN v_failed:=SQLERRM='permission_denied'; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'non-member % read the overview',v_c; END IF;
  END LOOP;
  PERFORM pg_temp.act(NULL);
  v_failed:=false;
  BEGIN PERFORM public.brand_promotion_overview(v_brand);
  EXCEPTION WHEN others THEN v_failed:=true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'signed-out caller read the overview'; END IF;
  -- A member cannot pull another brand's listing through their own brand.
  PERFORM pg_temp.act(v_host);
  v_r:=public.brand_promotion_overview(v_brand,'event','38725000-0000-4000-8000-0000000000e2');
  IF v_r->>'error' IS DISTINCT FROM 'listing_not_found' OR (v_r->>'ok')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'cross-brand listing: %',v_r; END IF;
  v_r:=public.brand_promotion_overview(v_brand,'trip','38725000-0000-4000-8000-0000000000e1');
  IF v_r->>'error' IS DISTINCT FROM 'listing_required' THEN RAISE EXCEPTION 'bad listing kind: %',v_r; END IF;
  v_r:=public.brand_promotion_overview(v_brand,'event',NULL);
  IF v_r->>'field' IS DISTINCT FROM 'listing_id' THEN RAISE EXCEPTION 'kind without id: %',v_r; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(public.brand_promotion_overview(v_brand)->'listings') l WHERE l->>'id'='38725000-0000-4000-8000-0000000000e2') THEN
    RAISE EXCEPTION 'another brand''s listing in the picker';
  END IF;

  -- Another creator cannot set my city: the RPC only ever writes the caller.
  PERFORM pg_temp.act(v_creator2);
  v_r:=public.creator_home_city_set(NULL,'Mars Colony',NULL);
  IF (SELECT home_city_id FROM public.creator_profiles WHERE creator_account_id=v_creator) IS DISTINCT FROM v_city
     OR (SELECT home_city_pending_name FROM public.creator_profiles WHERE creator_account_id=v_creator) IS NOT NULL THEN
    RAISE EXCEPTION 'another creator changed my city';
  END IF;
  -- A non-creator cannot set a city at all.
  PERFORM pg_temp.act(v_stranger);
  v_failed:=false;
  BEGIN PERFORM public.creator_home_city_set(v_city,NULL,NULL);
  EXCEPTION WHEN others THEN v_failed:=SQLERRM='creator_account_required'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'non-creator set a home city'; END IF;
  -- Empty, blank and unknown input is a field error, never a silent success.
  PERFORM pg_temp.act(v_creator);
  v_r:=public.creator_home_city_set(NULL,'   ',NULL);
  IF v_r->>'error' IS DISTINCT FROM 'city_required' THEN RAISE EXCEPTION 'blank city: %',v_r; END IF;
  v_r:=public.creator_home_city_set('38725000-0000-4000-8000-0000000000ff',NULL,NULL);
  IF v_r->>'error' IS DISTINCT FROM 'city_required' THEN RAISE EXCEPTION 'unknown city id: %',v_r; END IF;
  v_r:=public.creator_home_city_set(NULL,'x',NULL);
  IF v_r->>'error' IS DISTINCT FROM 'city_required' THEN RAISE EXCEPTION 'one-letter city: %',v_r; END IF;
  IF (SELECT home_city_id FROM public.creator_profiles WHERE creator_account_id=v_creator) IS DISTINCT FROM v_city THEN RAISE EXCEPTION 'failed set changed the city'; END IF;
  -- LIKE wildcards in a query are text, not patterns.
  v_r:=public.creator_city_search('%');
  IF jsonb_array_length(v_r)<>1 OR v_r->0->>'city_id' IS NOT NULL THEN RAISE EXCEPTION 'wildcard search matched cities: %',v_r; END IF;

  -- False paid-ads opt-in is still stored true, and true cannot be undone.
  PERFORM public.creator_profile_save('Ada Films',NULL,NULL,ARRAY['food'],ARRAY['English'],NULL,false);
  IF (SELECT usage_ads_opt_in FROM public.creator_profiles WHERE creator_account_id=v_creator) IS DISTINCT FROM true THEN RAISE EXCEPTION 'false opt-in stored'; END IF;
  PERFORM public.creator_profile_save('Ada Films',NULL,NULL,ARRAY['food'],ARRAY['English'],NULL,NULL);
  IF (SELECT usage_ads_opt_in FROM public.creator_profiles WHERE creator_account_id=v_creator) IS DISTINCT FROM true THEN RAISE EXCEPTION 'null opt-in stored false'; END IF;
  v_failed:=false;
  BEGIN UPDATE public.creator_profiles SET usage_ads_opt_in=false WHERE creator_account_id=v_creator;
  EXCEPTION WHEN check_violation THEN v_failed:=true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a direct write stored paid-ads false'; END IF;

  -- Hire Ada through the real offer path.
  PERFORM pg_temp.act(v_host);
  v_r:=public.gig_offer_prepare('38725000-0000-4000-8000-000000000101','{"fee_minor":30000}'::jsonb,'r2a-offer-key-0001');
  v_c:=(v_r->>'contract_id')::uuid;
  PERFORM pg_temp.act(NULL);
  PERFORM public.gig_hold_mark_captured(v_c,1,'pi_r2a_1');
  PERFORM pg_temp.act(v_creator);
  PERFORM public.gig_transition(v_c,'offered','accept','{}'::jsonb);

  -- Hired creators never appear as interested, even if their interest row
  -- is still open (a re-sent interest or an older record).
  PERFORM pg_temp.act(v_host);
  IF jsonb_array_length(public.gig_applicants(v_gig))<>0 THEN RAISE EXCEPTION 'hired creator in the interest list: %',public.gig_applicants(v_gig); END IF;
  UPDATE public.gig_interest SET status='sent' WHERE id='38725000-0000-4000-8000-000000000101';
  IF jsonb_array_length(public.gig_applicants(v_gig))<>0 THEN RAISE EXCEPTION 'hired creator with open interest listed'; END IF;
  SELECT g INTO v_gigrow FROM jsonb_array_elements(public.gig_host_home(v_brand)->'gigs') g WHERE g->>'id'=v_gig::text;
  IF (v_gigrow->>'interest_count')::int<>0 OR (v_gigrow->>'hired_count')::int<>1 THEN RAISE EXCEPTION 'hired creator counted as interested: %',v_gigrow; END IF;
  IF (public.brand_promotion_overview(v_brand)->'creators'->>'interested')::int<>0 THEN RAISE EXCEPTION 'overview counts the hired creator as interested'; END IF;

  -- money_state: on the way while working, paid after release, never back.
  IF public.gig_contract_workspace(v_c)->>'money_state'<>'on_the_way' THEN RAISE EXCEPTION 'in-progress money_state'; END IF;
  PERFORM pg_temp.act(NULL);
  PERFORM public.issue_3872_contract_apply_state(v_c,'posts_verified',now());
  PERFORM public.gig_release_record(v_c,'tr_r2a_1');
  PERFORM public.gig_release_record(v_c,'tr_r2a_1');
  FOREACH v_c IN ARRAY ARRAY[v_host,v_creator] LOOP
    PERFORM pg_temp.act(v_c);
    SELECT public.gig_contract_workspace(c.id)->>'money_state' INTO v_state FROM public.gig_contracts c WHERE c.gig_id=v_gig;
    IF v_state IS DISTINCT FROM 'paid' THEN RAISE EXCEPTION 'money_state after release for %: %',v_c,v_state; END IF;
  END LOOP;
  -- The stranger still cannot open the workspace.
  PERFORM pg_temp.act(v_stranger);
  v_failed:=false;
  BEGIN PERFORM public.gig_contract_workspace((SELECT id FROM public.gig_contracts WHERE gig_id=v_gig));
  EXCEPTION WHEN others THEN v_failed:=SQLERRM='permission_denied'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'stranger read the workspace'; END IF;
END;
$test$;

-- A provider payout that is still pending (Paystack rail) reads Ready, never
-- on the way. The paid share is frozen, so rewind it outside the RPCs.
SET LOCAL session_replication_role = replica;
UPDATE public.payee_shares SET status='releasable' WHERE order_kind='gig' AND order_id=(SELECT id FROM public.gig_contracts WHERE gig_id='38725000-0000-4000-8000-0000000000f1');
SET LOCAL session_replication_role = origin;
DO $test$
DECLARE v_state text;
BEGIN
  PERFORM pg_temp.act('38725000-0000-4000-8000-0000000000a1');
  SELECT public.gig_contract_workspace(c.id)->>'money_state' INTO v_state FROM public.gig_contracts c WHERE c.gig_id='38725000-0000-4000-8000-0000000000f1';
  IF v_state IS DISTINCT FROM 'ready' THEN RAISE EXCEPTION 'released but unpaid fee reads %',v_state; END IF;
END;
$test$;

-- Exact times: the video due time is required, in the future and after the
-- shoot; a shoot time must sit in its window. gig_results keeps its old
-- call shape and p_since never widens what a stranger can read.
DO $test$
DECLARE
  v_day date:=current_date+5; v_base jsonb; v_r jsonb; v_failed boolean;
BEGIN
  PERFORM pg_temp.act('38725000-0000-4000-8000-0000000000a1');
  v_base:=jsonb_build_object('brand_id','38725000-0000-4000-8000-0000000000b1','listing_kind','event','listing_id','38725000-0000-4000-8000-0000000000e1',
    'title_public','An evening rooftop reel','brief_public','Show a relaxed evening on a rooftop with music, drinks and the view across the city.',
    'format_key','date_idea','deliverables','[{"platform":"instagram","kind":"reel","count":1}]'::jsonb,'city_id','38725000-0000-4000-8000-0000000000c1',
    'category','experience','shoot_window_start',v_day,'shoot_window_end',v_day,
    'budget_band','b2','currency','USD','slots',1,'status','open');
  v_r:=public.gig_save(v_base);
  IF v_r->>'error' IS DISTINCT FROM 'video_due_required' OR v_r->>'field' IS DISTINCT FROM 'video_due_at' THEN RAISE EXCEPTION 'missing due time: %',v_r; END IF;
  v_r:=public.gig_save(v_base||jsonb_build_object('video_due_at','next tuesday'));
  IF v_r->>'error' IS DISTINCT FROM 'video_due_required' THEN RAISE EXCEPTION 'unreadable due time: %',v_r; END IF;
  v_r:=public.gig_save(v_base||jsonb_build_object('video_due_at',to_char(current_date-1,'YYYY-MM-DD')||'T12:00','shoot_window_start',current_date,'shoot_window_end',current_date));
  IF v_r->>'error' IS DISTINCT FROM 'video_due_required' OR v_r->>'field' IS DISTINCT FROM 'video_due_at' THEN RAISE EXCEPTION 'past due time: %',v_r; END IF;
  v_r:=public.gig_save(v_base||jsonb_build_object('video_due_at',to_char(v_day,'YYYY-MM-DD')||'T18:00','shoot_at',to_char(v_day,'YYYY-MM-DD')||'T20:00'));
  IF v_r->>'error' IS DISTINCT FROM 'video_due_before_shoot' OR v_r->>'field' IS DISTINCT FROM 'video_due_at' THEN RAISE EXCEPTION 'due before shoot: %',v_r; END IF;
  v_r:=public.gig_save(v_base||jsonb_build_object('video_due_at',to_char(v_day,'YYYY-MM-DD')||'T20:00','shoot_at',to_char(v_day,'YYYY-MM-DD')||'T20:00'));
  IF v_r->>'error' IS DISTINCT FROM 'video_due_before_shoot' THEN RAISE EXCEPTION 'due equal to shoot: %',v_r; END IF;
  v_r:=public.gig_save(v_base||jsonb_build_object('video_due_at',to_char(v_day+5,'YYYY-MM-DD')||'T20:00','shoot_at',to_char(v_day+2,'YYYY-MM-DD')||'T20:00','post_by',v_day+5));
  IF v_r->>'error' IS DISTINCT FROM 'shoot_outside_window' OR v_r->>'field' IS DISTINCT FROM 'shoot_at' THEN RAISE EXCEPTION 'shoot outside window: %',v_r; END IF;
  IF EXISTS(SELECT 1 FROM public.gigs WHERE brand_id='38725000-0000-4000-8000-0000000000b1' AND title_public='An evening rooftop reel') THEN
    RAISE EXCEPTION 'a refused save wrote a gig';
  END IF;

  -- gig_results: the old named and positional calls still work.
  PERFORM public.gig_results('38725000-0000-4000-8000-0000000000b1');
  PERFORM public.gig_results('38725000-0000-4000-8000-0000000000b1','38725000-0000-4000-8000-0000000000f1');
  v_r:=public.gig_results('38725000-0000-4000-8000-0000000000b1',NULL,now()+interval '1 day');
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_r) r WHERE (r->>'orders')::int>0 OR (r->>'clicks')::int>0) THEN RAISE EXCEPTION 'future p_since still counted: %',v_r; END IF;
  IF to_regprocedure('public.gig_results(uuid,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'an ambiguous two-argument gig_results remains'; END IF;
  PERFORM pg_temp.act('38725000-0000-4000-8000-0000000000a5');
  v_failed:=false;
  BEGIN PERFORM public.gig_results('38725000-0000-4000-8000-0000000000b1',NULL,now()-interval '1 year');
  EXCEPTION WHEN others THEN v_failed:=SQLERRM='permission_denied'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'stranger read results with p_since'; END IF;
END;
$test$;

ROLLBACK;
