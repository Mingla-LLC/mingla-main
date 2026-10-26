-- #3872 round 2 server contract, happy path: paid-ads usage stored true,
-- home city search/set (live and not yet live), gig counts without hired
-- creators, money_state on the workspace, and brand_promotion_overview
-- brand-wide and for one listing. Every fixture rolls back.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claim.sub',coalesce(p_user::text,''),true),
         set_config('request.jwt.claims',CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub',p_user,'role','authenticated')::text END,true);
$fn$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES
  ('38724000-0000-4000-8000-0000000000a1','r2-host@mingla.test'),
  ('38724000-0000-4000-8000-0000000000a2','r2-scanner@mingla.test'),
  ('38724000-0000-4000-8000-0000000000a3','r2-creator@mingla.test'),
  ('38724000-0000-4000-8000-0000000000a4','r2-creator2@mingla.test'),
  ('38724000-0000-4000-8000-0000000000a6','r2-creator3@mingla.test');
INSERT INTO public.brands(id,account_id,name,slug,default_currency) VALUES
  ('38724000-0000-4000-8000-0000000000b1','38724000-0000-4000-8000-0000000000a1','Round Two Rooftop','r2-rooftop','USD');
INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
  ('38724000-0000-4000-8000-0000000000b1','38724000-0000-4000-8000-0000000000a2','scanner',now());
INSERT INTO public.seeding_cities(id,google_place_id,name,country,country_code,center_lat,center_lng,bbox_sw_lat,bbox_sw_lng,bbox_ne_lat,bbox_ne_lng,is_live_for_consumers) VALUES
  ('38724000-0000-4000-8000-0000000000c1','r2-raleigh','Raleighton','United States','US',35.7,-78.6,35.6,-78.7,35.8,-78.5,true),
  ('38724000-0000-4000-8000-0000000000c2','r2-durham','Durhamville','United States','US',36.0,-78.9,35.9,-79.0,36.1,-78.8,false);
INSERT INTO public.events(id,brand_id,title,slug,status,published_at,created_at) VALUES
  ('38724000-0000-4000-8000-0000000000e1','38724000-0000-4000-8000-0000000000b1','Sunset Session','r2-sunset','scheduled',now()-interval '2 days',now()-interval '3 days'),
  ('38724000-0000-4000-8000-0000000000e2','38724000-0000-4000-8000-0000000000b1','Jazz Night','r2-jazz','scheduled',now()-interval '1 day',now()-interval '2 days'),
  ('38724000-0000-4000-8000-0000000000e4','38724000-0000-4000-8000-0000000000b1','Draft Party','r2-draft','draft',NULL,now());
INSERT INTO public.event_dates(event_id,start_at,end_at,is_master) VALUES
  ('38724000-0000-4000-8000-0000000000e1',now()+interval '10 days',now()+interval '10 days 4 hours',true);
INSERT INTO public.creator_accounts(id,email,display_name) VALUES
  ('38724000-0000-4000-8000-0000000000a3','r2-creator@mingla.test','Ada Films'),
  ('38724000-0000-4000-8000-0000000000a4','r2-creator2@mingla.test','Bo Clips'),
  ('38724000-0000-4000-8000-0000000000a6','r2-creator3@mingla.test','Cy Reels');
INSERT INTO public.creator_profiles(creator_account_id,mode_enabled,display_name,home_city_id,niches,verification,date_of_birth,agreement_version,agreement_signed_at) VALUES
  ('38724000-0000-4000-8000-0000000000a3',true,'Ada Films','38724000-0000-4000-8000-0000000000c1',ARRAY['food'],'verified','1995-01-01','v1',now()),
  ('38724000-0000-4000-8000-0000000000a4',true,'Bo Clips','38724000-0000-4000-8000-0000000000c1',ARRAY['music'],'verified','1995-01-01','v1',now());
INSERT INTO public.creator_packages(id,creator_account_id,format_key,platforms,price_minor,currency,turnaround_days) VALUES
  ('38724000-0000-4000-8000-0000000000d3','38724000-0000-4000-8000-0000000000a3','date_idea',ARRAY['instagram'],30000,'USD',5),
  ('38724000-0000-4000-8000-0000000000d4','38724000-0000-4000-8000-0000000000a4','date_idea',ARRAY['instagram'],30000,'USD',5);
INSERT INTO public.payee_accounts(user_id,stripe_account_id,stripe_status) VALUES
  ('38724000-0000-4000-8000-0000000000a3','acct_r2c1','active'),
  ('38724000-0000-4000-8000-0000000000a4','acct_r2c2','active');
INSERT INTO public.gigs(id,brand_id,listing_kind,listing_id,title_public,brief_public,format_key,deliverables,city_id,category,shoot_window_start,shoot_window_end,post_by,budget_band,currency,slots,status,created_by) VALUES
  ('38724000-0000-4000-8000-0000000000f1','38724000-0000-4000-8000-0000000000b1','event','38724000-0000-4000-8000-0000000000e1',
   'A rooftop date night','Show a relaxed evening on a rooftop with music, drinks and the view across the city.','date_idea','["1 reel"]'::jsonb,
   '38724000-0000-4000-8000-0000000000c1','nightlife',current_date+1,current_date+20,current_date+30,'b2','USD',2,'open','38724000-0000-4000-8000-0000000000a1'),
  ('38724000-0000-4000-8000-0000000000f2','38724000-0000-4000-8000-0000000000b1','event','38724000-0000-4000-8000-0000000000e2',
   'A jazz night out','Show a relaxed evening of live jazz with friends, drinks and a great view of the band.','date_idea','["1 reel"]'::jsonb,
   '38724000-0000-4000-8000-0000000000c1','nightlife',current_date+1,current_date+20,current_date+30,'b2','USD',1,'open','38724000-0000-4000-8000-0000000000a1');
INSERT INTO public.gig_interest(id,gig_id,creator_account_id,package_id,quoted_minor,status) VALUES
  ('38724000-0000-4000-8000-000000000101','38724000-0000-4000-8000-0000000000f1','38724000-0000-4000-8000-0000000000a3','38724000-0000-4000-8000-0000000000d3',30000,'sent'),
  ('38724000-0000-4000-8000-000000000102','38724000-0000-4000-8000-0000000000f1','38724000-0000-4000-8000-0000000000a4','38724000-0000-4000-8000-0000000000d4',30000,'sent'),
  ('38724000-0000-4000-8000-000000000103','38724000-0000-4000-8000-0000000000f1','38724000-0000-4000-8000-0000000000a6',NULL,25000,'sent');
-- Attributed sales: o1 (Sunset, tracking link), o2 (Jazz, promoter link),
-- o3 (Sunset, refunded: not counted).
INSERT INTO public.orders(id,event_id,total_cents,currency,payment_method,payment_status,source) VALUES
  ('38724000-0000-4000-8000-000000000201','38724000-0000-4000-8000-0000000000e1',5000,'USD','online_card','paid','manual_import'),
  ('38724000-0000-4000-8000-000000000202','38724000-0000-4000-8000-0000000000e2',7000,'USD','online_card','paid','manual_import'),
  ('38724000-0000-4000-8000-000000000203','38724000-0000-4000-8000-0000000000e1',9000,'USD','online_card','refunded','manual_import');
INSERT INTO public.tickets(order_id,ticket_type_id,event_id,qr_code,status) VALUES
  ('38724000-0000-4000-8000-000000000201',gen_random_uuid(),'38724000-0000-4000-8000-0000000000e1','r2-qr-1','valid'),
  ('38724000-0000-4000-8000-000000000201',gen_random_uuid(),'38724000-0000-4000-8000-0000000000e1','r2-qr-2','used'),
  ('38724000-0000-4000-8000-000000000202',gen_random_uuid(),'38724000-0000-4000-8000-0000000000e2','r2-qr-3','valid'),
  ('38724000-0000-4000-8000-000000000203',gen_random_uuid(),'38724000-0000-4000-8000-0000000000e1','r2-qr-4','refunded');
INSERT INTO public.host_tracking_links(id,brand_id,listing_kind,listing_id,label,slug,created_by) VALUES
  ('38724000-0000-4000-8000-000000000301','38724000-0000-4000-8000-0000000000b1','event','38724000-0000-4000-8000-0000000000e1','Flyers','r2flyers','38724000-0000-4000-8000-0000000000a1');
INSERT INTO public.referral_offers(id,brand_id,name,audience,scope_kind,reward_kind,share_bps,currency,starts_at,status,created_by) VALUES
  ('38724000-0000-4000-8000-000000000401','38724000-0000-4000-8000-0000000000b1','Everyone','invited','brand','cash',1000,'USD',now()-interval '5 days','active','38724000-0000-4000-8000-0000000000a1'),
  ('38724000-0000-4000-8000-000000000402','38724000-0000-4000-8000-0000000000b1','Jazz only','invited','listings','cash',1000,'USD',now()-interval '5 days','active','38724000-0000-4000-8000-0000000000a1'),
  ('38724000-0000-4000-8000-000000000403','38724000-0000-4000-8000-0000000000b1','Old one','invited','brand','cash',1000,'USD',now()-interval '50 days','ended','38724000-0000-4000-8000-0000000000a1');
INSERT INTO public.referral_offer_listings(offer_id,listing_kind,listing_id) VALUES
  ('38724000-0000-4000-8000-000000000402','event','38724000-0000-4000-8000-0000000000e2');
INSERT INTO public.referral_members(id,offer_id,brand_id,role,email_norm,display_name,link_slug,status) VALUES
  ('38724000-0000-4000-8000-000000000501','38724000-0000-4000-8000-000000000401','38724000-0000-4000-8000-0000000000b1','promoter','p1@mingla.test','Pat One','r2prom01','active'),
  ('38724000-0000-4000-8000-000000000502','38724000-0000-4000-8000-000000000401','38724000-0000-4000-8000-0000000000b1','promoter','p2@mingla.test','Pat Two','r2prom02','active'),
  ('38724000-0000-4000-8000-000000000503','38724000-0000-4000-8000-000000000402','38724000-0000-4000-8000-0000000000b1','promoter','p3@mingla.test','Pat Three','r2prom03','active'),
  ('38724000-0000-4000-8000-000000000504','38724000-0000-4000-8000-000000000403','38724000-0000-4000-8000-0000000000b1','promoter','p4@mingla.test','Pat Four','r2prom04','active');
INSERT INTO public.attribution_touches(id,kind,member_id,tracking_id,brand_id,listing_kind,listing_id,visitor_key,surface,expires_at) VALUES
  ('38724000-0000-4000-8000-000000000601','tracking',NULL,'38724000-0000-4000-8000-000000000301','38724000-0000-4000-8000-0000000000b1','event','38724000-0000-4000-8000-0000000000e1',repeat('a',64),'web',now()+interval '7 days'),
  ('38724000-0000-4000-8000-000000000602','tracking',NULL,'38724000-0000-4000-8000-000000000301','38724000-0000-4000-8000-0000000000b1','event','38724000-0000-4000-8000-0000000000e1',repeat('b',64),'web',now()+interval '7 days'),
  ('38724000-0000-4000-8000-000000000603','tracking',NULL,'38724000-0000-4000-8000-000000000301','38724000-0000-4000-8000-0000000000b1','event','38724000-0000-4000-8000-0000000000e1',repeat('c',64),'web',now()+interval '7 days'),
  ('38724000-0000-4000-8000-000000000604','member','38724000-0000-4000-8000-000000000503',NULL,'38724000-0000-4000-8000-0000000000b1','event','38724000-0000-4000-8000-0000000000e2',repeat('d',64),'web',now()+interval '7 days');
INSERT INTO public.order_attributions(order_kind,order_id,brand_id,source,touch_id,member_id,tracking_id,offer_id,eligible_minor,share_bps,share_minor) VALUES
  ('ticket','38724000-0000-4000-8000-000000000201','38724000-0000-4000-8000-0000000000b1','tracking_link','38724000-0000-4000-8000-000000000601',NULL,'38724000-0000-4000-8000-000000000301',NULL,5000,NULL,0),
  ('ticket','38724000-0000-4000-8000-000000000202','38724000-0000-4000-8000-0000000000b1','member_link','38724000-0000-4000-8000-000000000604','38724000-0000-4000-8000-000000000503',NULL,'38724000-0000-4000-8000-000000000402',7000,1000,700),
  ('ticket','38724000-0000-4000-8000-000000000203','38724000-0000-4000-8000-0000000000b1','tracking_link','38724000-0000-4000-8000-000000000602',NULL,'38724000-0000-4000-8000-000000000301',NULL,9000,NULL,0);
-- Referral reward on the Jazz order (host pays the gross).
INSERT INTO public.payee_shares(order_kind,order_id,payee_kind,member_id,payee_user_id,payee_email_norm,brand_id,rail,currency,gross_minor,mingla_fee_minor,net_minor,status,release_after) VALUES
  ('ticket','38724000-0000-4000-8000-000000000202','referral','38724000-0000-4000-8000-000000000503',NULL,'p3@mingla.test','38724000-0000-4000-8000-0000000000b1','stripe','USD',700,35,665,'pending',now());
-- Email campaigns: one features Sunset (event card), one is general, one draft.
INSERT INTO public.marketing_campaigns(id,account_id,brand_id,audience_id,name,channel,channel_payload,status,sent_at) VALUES
  ('38724000-0000-4000-8000-000000000701','38724000-0000-4000-8000-0000000000a1','38724000-0000-4000-8000-0000000000b1',gen_random_uuid(),'Sunset push','email',
   jsonb_build_object('kind','email','subject','Sunset','body_html','<p>Come along</p>{{event:38724000-0000-4000-8000-0000000000e1}}'),'sent',now()-interval '1 day'),
  ('38724000-0000-4000-8000-000000000702','38724000-0000-4000-8000-0000000000a1','38724000-0000-4000-8000-0000000000b1',gen_random_uuid(),'Newsletter','email',
   jsonb_build_object('kind','email','subject','News','body_html','<p>Hello</p>'),'sent',now()-interval '3 days'),
  ('38724000-0000-4000-8000-000000000703','38724000-0000-4000-8000-0000000000a1','38724000-0000-4000-8000-0000000000b1',gen_random_uuid(),'Draft','email',
   jsonb_build_object('kind','email','subject','Draft','body_html','<p>Soon</p>{{event:38724000-0000-4000-8000-0000000000e1}}'),'draft',NULL);
-- Host ad plans: Sunset is live, Jazz is a draft.
INSERT INTO public.ad_plans(id,client_kind,owner_kind,brand_id,destination_family,destination_key,state) VALUES
  ('38724000-0000-4000-8000-000000000801','host','host','38724000-0000-4000-8000-0000000000b1','public_mingla_page','event:r2-rooftop:r2-sunset','live'),
  ('38724000-0000-4000-8000-000000000802','host','host','38724000-0000-4000-8000-0000000000b1','public_mingla_page','event:r2-rooftop:r2-jazz','draft');
INSERT INTO public.ad_campaigns(id,connection_id,platform,external_campaign_id,name,objective,dest_page_type,dest_brand_slug,dest_url,dest_smart_link,currency,brand_id,owner_kind,dest_event_id) VALUES
  ('38724000-0000-4000-8000-000000000901',gen_random_uuid(),'meta','r2-ext-1','Sunset ads','OUTCOME_TRAFFIC','event','r2-rooftop','https://example.test/e','https://example.test/s','USD','38724000-0000-4000-8000-0000000000b1','host','38724000-0000-4000-8000-0000000000e1');
INSERT INTO public.ad_spend_daily(campaign_id,platform,spend_date,spend_cents,currency) VALUES
  ('38724000-0000-4000-8000-000000000901','meta',current_date-1,1200,'USD');
SET LOCAL session_replication_role = origin;

INSERT INTO public.feature_flags(flag_key,is_enabled,description) VALUES('creator_gigs_enabled',true,'test')
ON CONFLICT(flag_key) DO UPDATE SET is_enabled=true;
INSERT INTO public.program_brand_rollouts(brand_id,program,phase) VALUES('38724000-0000-4000-8000-0000000000b1','creator_gigs','pilot')
ON CONFLICT DO NOTHING;

DO $test$
DECLARE
  v_host constant uuid:='38724000-0000-4000-8000-0000000000a1';
  v_scanner constant uuid:='38724000-0000-4000-8000-0000000000a2';
  v_creator constant uuid:='38724000-0000-4000-8000-0000000000a3';
  v_creator2 constant uuid:='38724000-0000-4000-8000-0000000000a4';
  v_creator3 constant uuid:='38724000-0000-4000-8000-0000000000a6';
  v_brand constant uuid:='38724000-0000-4000-8000-0000000000b1';
  v_live_city constant uuid:='38724000-0000-4000-8000-0000000000c1';
  v_soon_city constant uuid:='38724000-0000-4000-8000-0000000000c2';
  v_sunset constant uuid:='38724000-0000-4000-8000-0000000000e1';
  v_gig constant uuid:='38724000-0000-4000-8000-0000000000f1';
  v_r jsonb; v_c1 uuid; v_c2 uuid; v_quote jsonb; v_gigrow jsonb; v_hold bigint; v_names text[];
BEGIN
  -- 1. Paid-ads usage: a false from an old client is stored as true.
  PERFORM pg_temp.act(v_creator3);
  v_r:=public.creator_profile_save('Cy Reels',NULL,NULL,ARRAY['food'],ARRAY['English'],NULL,false);
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'profile save: %',v_r; END IF;
  IF (SELECT usage_ads_opt_in FROM public.creator_profiles WHERE creator_account_id=v_creator3) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'paid-ads opt-in stored false';
  END IF;
  IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='creator_profiles' AND column_name='usage_ads_opt_in')<>'true' THEN
    RAISE EXCEPTION 'paid-ads default is not true';
  END IF;

  -- 2. Home city search.
  v_r:=public.creator_city_search(NULL);
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_r) e WHERE e->>'city_id'=v_live_city::text AND (e->>'is_live')::boolean AND e->>'country_code'='US')
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_r) e WHERE e->>'city_id'=v_soon_city::text OR NOT (e->>'is_live')::boolean) THEN
    RAISE EXCEPTION 'empty search must list live cities only: %',v_r;
  END IF;
  SELECT array_agg(e->>'name' ORDER BY ord) INTO v_names FROM jsonb_array_elements(v_r) WITH ORDINALITY x(e,ord);
  IF v_names IS DISTINCT FROM (SELECT array_agg(n ORDER BY n) FROM unnest(v_names) n) THEN RAISE EXCEPTION 'live cities not ordered by name: %',v_names; END IF;
  v_r:=public.creator_city_search('durham');
  IF v_r->0->>'city_id'<>v_soon_city::text OR (v_r->0->>'is_live')::boolean THEN RAISE EXCEPTION 'non-live city match: %',v_r; END IF;
  v_r:=public.creator_city_search('  zanzibar   town ');
  IF jsonb_array_length(v_r)<>1 OR v_r->0->>'city_id' IS NOT NULL OR v_r->0->>'name'<>'Zanzibar Town'
     OR (v_r->0->>'is_live')::boolean OR v_r->0->>'country_code'<>'US' OR v_r->0 ? 'region' IS NOT TRUE THEN
    RAISE EXCEPTION 'unknown city candidate: %',v_r;
  END IF;
  v_r:=public.creator_city_search('raleighton');
  IF v_r->0->>'city_id'<>v_live_city::text OR jsonb_array_length(v_r)<>1 THEN RAISE EXCEPTION 'live match first, no synthetic duplicate: %',v_r; END IF;

  -- Home city set: live, then not live (kept pending), then a typed name.
  v_r:=public.creator_home_city_set(v_live_city,NULL,NULL);
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true OR v_r->'home_city'->>'id'<>v_live_city::text OR (v_r->'home_city'->>'is_live')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'live city set: %',v_r;
  END IF;
  v_r:=public.creator_home_city_set(v_soon_city,NULL,NULL);
  IF v_r->'home_city'->>'id'<>v_soon_city::text OR (v_r->'home_city'->>'is_live')::boolean IS DISTINCT FROM false OR v_r->'home_city'->>'name'<>'Durhamville' THEN
    RAISE EXCEPTION 'pending city set: %',v_r;
  END IF;
  IF (SELECT home_city_id FROM public.creator_profiles WHERE creator_account_id=v_creator3) IS NOT NULL THEN
    RAISE EXCEPTION 'a city that is not live must never be matchable';
  END IF;
  v_r:=public.creator_setup_status();
  IF v_r->'home_city'->>'name'<>'Durhamville' OR (v_r->'home_city'->>'is_live')::boolean THEN RAISE EXCEPTION 'setup status home_city: %',v_r->'home_city'; END IF;
  IF public.creator_profile_home_city((SELECT p FROM public.creator_profiles p WHERE creator_account_id=v_creator3))->>'name'<>'Durhamville' THEN
    RAISE EXCEPTION 'own profile read has no home_city';
  END IF;
  -- A profile save with no city keeps the pending city.
  PERFORM public.creator_profile_save('Cy Reels',NULL,NULL,ARRAY['food'],ARRAY['English'],NULL,true);
  IF public.creator_setup_status()->'home_city'->>'name'<>'Durhamville' THEN RAISE EXCEPTION 'profile save erased the pending city'; END IF;
  v_r:=public.creator_home_city_set(NULL,'  zanzibar town ','tz');
  IF v_r->'home_city'->>'id' IS NOT NULL OR v_r->'home_city'->>'name'<>'Zanzibar Town' OR (v_r->'home_city'->>'is_live')::boolean THEN RAISE EXCEPTION 'typed city: %',v_r; END IF;
  IF (SELECT home_city_pending_country FROM public.creator_profiles WHERE creator_account_id=v_creator3)<>'TZ' THEN RAISE EXCEPTION 'typed city country not kept'; END IF;
  -- Typing a live city's name resolves to that live city.
  v_r:=public.creator_home_city_set(NULL,'raleighton',NULL);
  IF v_r->'home_city'->>'id'<>v_live_city::text OR (v_r->'home_city'->>'is_live')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'typed live city: %',v_r; END IF;
  -- When a city launches, waiting creators move onto it.
  PERFORM public.creator_home_city_set(v_soon_city,NULL,NULL);
  UPDATE public.seeding_cities SET is_live_for_consumers=true WHERE id=v_soon_city;
  IF (SELECT home_city_id FROM public.creator_profiles WHERE creator_account_id=v_creator3)<>v_soon_city THEN RAISE EXCEPTION 'launch did not move the waiting creator'; END IF;
  UPDATE public.seeding_cities SET is_live_for_consumers=false WHERE id=v_soon_city;

  -- The board: a creator waiting for their city sees no board gigs yet.
  PERFORM pg_temp.act(v_creator2);
  IF jsonb_array_length(public.creator_gig_board(NULL,NULL))=0 THEN RAISE EXCEPTION 'board empty for a live-city creator'; END IF;
  PERFORM public.creator_home_city_set(NULL,'Zanzibar',NULL);
  IF jsonb_array_length(public.creator_gig_board(NULL,NULL))<>0 THEN RAISE EXCEPTION 'non-live home city still sees board gigs'; END IF;
  PERFORM public.creator_home_city_set(v_live_city,NULL,NULL);

  -- 3/4. Hire Ada (paid out) and Bo (refunded) on the Sunset gig.
  PERFORM pg_temp.act(v_host);
  v_r:=public.gig_offer_prepare('38724000-0000-4000-8000-000000000101','{"fee_minor":30000}'::jsonb,'r2-offer-key-0001');
  v_c1:=(v_r->>'contract_id')::uuid;
  v_r:=public.gig_offer_prepare('38724000-0000-4000-8000-000000000102','{"fee_minor":30000}'::jsonb,'r2-offer-key-0002');
  v_c2:=(v_r->>'contract_id')::uuid;
  IF v_c1 IS NULL OR v_c2 IS NULL THEN RAISE EXCEPTION 'offers failed: %',v_r; END IF;
  IF public.gig_contract_workspace(v_c1)->'money_state'<>'null'::jsonb THEN RAISE EXCEPTION 'unpaid offer has a money_state'; END IF;
  PERFORM pg_temp.act(NULL);
  PERFORM public.gig_hold_mark_captured(v_c1,1,'pi_r2_1');
  PERFORM public.gig_hold_mark_captured(v_c2,1,'pi_r2_2');
  PERFORM pg_temp.act(v_host);
  IF public.gig_contract_workspace(v_c1)->>'money_state'<>'on_the_way' THEN RAISE EXCEPTION 'captured fee is not on_the_way: %',public.gig_contract_workspace(v_c1)->>'money_state'; END IF;
  PERFORM pg_temp.act(v_creator);
  PERFORM public.gig_transition(v_c1,'offered','accept','{}'::jsonb);
  IF public.gig_contract_workspace(v_c1)->>'money_state'<>'on_the_way' THEN RAISE EXCEPTION 'creator view money_state'; END IF;
  PERFORM pg_temp.act(NULL);
  v_quote:=public.gig_refund_quote(v_c2,'host_before_accept');
  PERFORM public.gig_refund_record(v_c2,'host_before_accept',(v_quote->>'refund_minor')::bigint,(v_quote->>'creator_fee_minor')::bigint,'re_r2_2');
  PERFORM public.issue_3872_contract_apply_state(v_c1,'posts_verified',now());
  PERFORM public.gig_release_record(v_c1,'tr_r2_1');
  PERFORM pg_temp.act(v_host);
  v_r:=public.gig_contract_workspace(v_c1);
  IF v_r->>'money_state'<>'paid' OR NOT (v_r ? 'contract' AND v_r ? 'events' AND v_r ? 'reveal') THEN RAISE EXCEPTION 'released stripe fee is not paid: %',v_r->>'money_state'; END IF;
  IF v_r->>'money_paid_at' IS NULL THEN RAISE EXCEPTION 'paid fee has no money_paid_at'; END IF;
  IF public.gig_contract_workspace(v_c2)->'money_paid_at'<>'null'::jsonb THEN RAISE EXCEPTION 'refunded contract has money_paid_at'; END IF;
  IF public.gig_contract_workspace(v_c2)->>'money_state'<>'refunded' THEN RAISE EXCEPTION 'refunded contract: %',public.gig_contract_workspace(v_c2)->>'money_state'; END IF;

  -- 3. Gig counts: Ada is hired, Bo was refunded, Cy is still interested.
  SELECT g INTO v_gigrow FROM jsonb_array_elements(public.gig_host_home(v_brand)->'gigs') g WHERE g->>'id'=v_gig::text;
  IF (v_gigrow->>'interest_count')::int<>1 OR (v_gigrow->>'hired_count')::int<>1 THEN RAISE EXCEPTION 'gig counts: %',v_gigrow; END IF;
  v_r:=public.gig_applicants(v_gig);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_r) e WHERE e->>'creator_id'=v_creator::text) THEN RAISE EXCEPTION 'hired creator listed as interested: %',v_r; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_r) e WHERE e->>'creator_id'=v_creator3::text) THEN RAISE EXCEPTION 'interested creator missing'; END IF;

  -- 5. Overview, brand-wide (a low-rank member may read it).
  PERFORM pg_temp.act(v_scanner);
  v_r:=public.brand_promotion_overview(v_brand);
  IF jsonb_array_length(v_r->'listings')<>2 OR v_r->'listings'->0->>'id'<>'38724000-0000-4000-8000-0000000000e2'
     OR v_r->'listings'->1->>'id'<>v_sunset::text OR v_r->'listings'->1->>'kind'<>'event' OR v_r->'listings'->1->>'starts_at' IS NULL THEN
    RAISE EXCEPTION 'listings (published, newest first): %',v_r->'listings';
  END IF;
  SELECT amount_minor INTO v_hold FROM public.gig_holds WHERE contract_id=v_c1;
  IF v_r->'listing'<>'null'::jsonb OR v_r->>'currency'<>'USD'
     OR (v_r->>'sold_minor')::bigint<>12000 OR (v_r->>'tickets')::int<>3 OR (v_r->>'clicks')::int<>4
     OR (v_r->>'spent_minor')::bigint<>v_hold+700+1200 THEN
    RAISE EXCEPTION 'brand-wide totals: %',v_r;
  END IF;
  IF (v_r->'campaigns'->>'sent')::int<>2 OR v_r->'campaigns'->>'last_sent_at' IS NULL
     OR (v_r->'ads'->>'live')::int<>1 OR (v_r->'ads'->>'draft')::int<>1 OR jsonb_typeof(v_r->'ads'->'needs_setup')<>'boolean'
     OR (v_r->'creators'->>'gigs_live')::int<>2 OR (v_r->'creators'->>'interested')::int<>1
     OR (v_r->'creators'->>'hired')::int<>1 OR (v_r->'creators'->>'paid')::int<>1
     OR (v_r->'referrals'->>'offers_live')::int<>2 OR (v_r->'referrals'->>'promoters')::int<>3 THEN
    RAISE EXCEPTION 'brand-wide rows: %',v_r;
  END IF;
  IF (v_r->'ads'->>'needs_setup')::boolean IS DISTINCT FROM NOT coalesce((public.ad_brand_currency_authority(v_brand)->>'resolved')::boolean,false) THEN
    RAISE EXCEPTION 'ads needs_setup does not follow the payout currency setup';
  END IF;

  -- Overview for the Sunset listing only.
  v_r:=public.brand_promotion_overview(v_brand,'event',v_sunset);
  IF v_r->'listing'->>'id'<>v_sunset::text OR v_r->'listing'->>'title'<>'Sunset Session'
     OR (v_r->>'sold_minor')::bigint<>5000 OR (v_r->>'tickets')::int<>2 OR (v_r->>'clicks')::int<>3
     OR (v_r->>'spent_minor')::bigint<>v_hold+1200
     OR (v_r->'campaigns'->>'sent')::int<>1 OR (v_r->'ads'->>'live')::int<>1 OR (v_r->'ads'->>'draft')::int<>0
     OR (v_r->'creators'->>'gigs_live')::int<>1 OR (v_r->'creators'->>'hired')::int<>1 OR (v_r->'creators'->>'paid')::int<>1
     OR (v_r->'creators'->>'interested')::int<>1
     OR (v_r->'referrals'->>'offers_live')::int<>1 OR (v_r->'referrals'->>'promoters')::int<>2
     OR jsonb_array_length(v_r->'listings')<>2 THEN
    RAISE EXCEPTION 'Sunset overview: %',v_r;
  END IF;
  -- A draft listing of the brand can still be scoped (zero everywhere).
  v_r:=public.brand_promotion_overview(v_brand,'event','38724000-0000-4000-8000-0000000000e4');
  IF (v_r->>'sold_minor')::bigint<>0 OR (v_r->'creators'->>'gigs_live')::int<>0 OR (v_r->'campaigns'->>'sent')::int<>0 THEN RAISE EXCEPTION 'draft listing scope: %',v_r; END IF;
END;
$test$;

-- Released but the payout is not confirmed yet (Paystack rail): ready, no
-- paid time. The paid share is frozen, so rewind it outside the RPCs.
SET LOCAL session_replication_role = replica;
UPDATE public.payee_shares SET status='releasable' WHERE order_kind='gig' AND payee_kind='gig_fee'
  AND order_id IN (SELECT id FROM public.gig_contracts WHERE gig_id='38724000-0000-4000-8000-0000000000f1');
SET LOCAL session_replication_role = origin;
DO $test$
DECLARE v_r jsonb;
BEGIN
  PERFORM pg_temp.act('38724000-0000-4000-8000-0000000000a1');
  SELECT public.gig_contract_workspace(c.id) INTO v_r FROM public.gig_contracts c
   WHERE c.gig_id='38724000-0000-4000-8000-0000000000f1' AND c.creator_account_id='38724000-0000-4000-8000-0000000000a3';
  IF v_r->>'money_state' IS DISTINCT FROM 'ready' OR v_r->'money_paid_at'<>'null'::jsonb THEN
    RAISE EXCEPTION 'ready fee: state % paid_at %',v_r->>'money_state',v_r->'money_paid_at';
  END IF;
END;
$test$;

ROLLBACK;
