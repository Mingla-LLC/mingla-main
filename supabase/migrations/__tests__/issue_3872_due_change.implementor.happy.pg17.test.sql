-- #3872 video-due change after hire, happy path: offers carry the brief's
-- exact due time; a change proposed with a date AND a time is stored in the
-- listing's time zone and, once accepted, every contract read (workspace,
-- creator home, host home, post reminder) shows the agreed due; a legacy
-- post_by-only change still works and means 23:59 local. Every fixture rolls back.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claim.sub',coalesce(p_user::text,''),true),
         set_config('request.jwt.claims',CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub',p_user,'role','authenticated')::text END,true);
$fn$;

-- Host (a1) runs a New York event; Ada (a3) is hired on its gig; Bo (a4) is
-- another creator and a5 a stranger. The gig's video is due at 18:00 New York
-- time 30 days out; its shoot time is open.
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES
  ('38729000-0000-4000-8000-0000000000a1','due-h-host@mingla.test'),
  ('38729000-0000-4000-8000-0000000000a3','due-h-creator@mingla.test'),
  ('38729000-0000-4000-8000-0000000000a4','due-h-creator2@mingla.test'),
  ('38729000-0000-4000-8000-0000000000a5','due-h-stranger@mingla.test');
INSERT INTO public.brands(id,account_id,name,slug,default_currency) VALUES
  ('38729000-0000-4000-8000-0000000000b1','38729000-0000-4000-8000-0000000000a1','Due Change Rooftop','due-h-rooftop','USD');
INSERT INTO public.seeding_cities(id,google_place_id,name,country,country_code,center_lat,center_lng,bbox_sw_lat,bbox_sw_lng,bbox_ne_lat,bbox_ne_lng,is_live_for_consumers) VALUES
  ('38729000-0000-4000-8000-0000000000c1','due-h-city','Duetown','United States','US',35.7,-78.6,35.6,-78.7,35.8,-78.5,true);
INSERT INTO public.events(id,brand_id,title,slug,status,published_at,timezone) VALUES
  ('38729000-0000-4000-8000-0000000000e1','38729000-0000-4000-8000-0000000000b1','Rooftop Night','due-h-night','scheduled',now(),'America/New_York');
INSERT INTO public.creator_accounts(id,email,display_name) VALUES
  ('38729000-0000-4000-8000-0000000000a3','due-h-creator@mingla.test','Ada Films'),
  ('38729000-0000-4000-8000-0000000000a4','due-h-creator2@mingla.test','Bo Clips');
INSERT INTO public.creator_profiles(creator_account_id,mode_enabled,display_name,home_city_id,niches,verification,date_of_birth,agreement_version,agreement_signed_at) VALUES
  ('38729000-0000-4000-8000-0000000000a3',true,'Ada Films','38729000-0000-4000-8000-0000000000c1',ARRAY['food'],'verified','1995-01-01','v1',now()),
  ('38729000-0000-4000-8000-0000000000a4',true,'Bo Clips','38729000-0000-4000-8000-0000000000c1',ARRAY['music'],'verified','1995-01-01','v1',now());
INSERT INTO public.creator_packages(id,creator_account_id,format_key,platforms,price_minor,currency,turnaround_days) VALUES
  ('38729000-0000-4000-8000-0000000000d3','38729000-0000-4000-8000-0000000000a3','date_idea',ARRAY['instagram'],30000,'USD',5);
INSERT INTO public.payee_accounts(user_id,stripe_account_id,stripe_status) VALUES
  ('38729000-0000-4000-8000-0000000000a3','acct_due-h1','active');
INSERT INTO public.gigs(id,brand_id,listing_kind,listing_id,title_public,brief_public,format_key,deliverables,city_id,category,shoot_window_start,shoot_window_end,post_by,video_due_at,pay_up_to_minor,currency,slots,status,created_by) VALUES
  ('38729000-0000-4000-8000-0000000000f1','38729000-0000-4000-8000-0000000000b1','event','38729000-0000-4000-8000-0000000000e1',
   'A rooftop date night','Show a relaxed evening on a rooftop with music, drinks and the view across the city.','date_idea','["1 reel"]'::jsonb,
   '38729000-0000-4000-8000-0000000000c1','nightlife',current_date+1,current_date+20,current_date+30,
   ((current_date+30)+time '18:00') AT TIME ZONE 'America/New_York',30000,'USD',2,'open','38729000-0000-4000-8000-0000000000a1');
INSERT INTO public.gig_interest(id,gig_id,creator_account_id,package_id,quoted_minor,status) VALUES
  ('38729000-0000-4000-8000-000000000101','38729000-0000-4000-8000-0000000000f1','38729000-0000-4000-8000-0000000000a3','38729000-0000-4000-8000-0000000000d3',30000,'sent');
SET LOCAL session_replication_role = origin;

INSERT INTO public.feature_flags(flag_key,is_enabled,description) VALUES('creator_gigs_enabled',true,'test')
ON CONFLICT(flag_key) DO UPDATE SET is_enabled=true;
INSERT INTO public.program_brand_rollouts(brand_id,program,phase) VALUES('38729000-0000-4000-8000-0000000000b1','creator_gigs','pilot')
ON CONFLICT DO NOTHING;

DO $test$
DECLARE
  v_host constant uuid:='38729000-0000-4000-8000-0000000000a1';
  v_creator constant uuid:='38729000-0000-4000-8000-0000000000a3';
  v_brand constant uuid:='38729000-0000-4000-8000-0000000000b1';
  v_tz constant text:='America/New_York';
  v_brief_due timestamptz:=((current_date+30)+time '18:00') AT TIME ZONE 'America/New_York';
  v_new_due timestamptz:=((current_date+25)+time '18:00') AT TIME ZONE 'America/New_York';
  v_legacy_due timestamptz:=((current_date+27)+time '23:59') AT TIME ZONE 'America/New_York';
  v_c uuid; v_r jsonb; v_p jsonb; v_row jsonb;
BEGIN
  -- Hire Ada.
  PERFORM pg_temp.act(v_host);
  v_r:=public.gig_offer_prepare('38729000-0000-4000-8000-000000000101','{"fee_minor":30000}'::jsonb,'due-h-offer-0001');
  v_c:=(v_r->>'contract_id')::uuid;
  IF v_c IS NULL THEN RAISE EXCEPTION 'offer failed: %',v_r; END IF;
  PERFORM pg_temp.act(NULL);
  PERFORM public.gig_hold_mark_captured(v_c,1,'pi_due_h_1');
  PERFORM pg_temp.act(v_creator);
  PERFORM public.gig_transition(v_c,'offered','accept','{}'::jsonb);

  -- 1. The offer's terms carry the brief's exact due time.
  IF (SELECT video_due_at FROM public.gig_terms_versions WHERE contract_id=v_c AND version=1) IS DISTINCT FROM v_brief_due THEN
    RAISE EXCEPTION 'terms v1 due is not the brief due: %',(SELECT video_due_at FROM public.gig_terms_versions WHERE contract_id=v_c AND version=1);
  END IF;

  -- 2. The creator asks for an earlier due, with a date and a time (local).
  v_p:=public.gig_change_proposal_save(v_c,jsonb_build_object('video_due_at',to_char(current_date+25,'YYYY-MM-DD')||'T18:00'),'dates','Earlier works better');
  IF (v_p->>'ok')::boolean IS DISTINCT FROM true OR (v_p->'changes'->>'video_due_at')::timestamptz<>v_new_due
     OR (v_p->'changes'->>'post_by')::date<>current_date+25 THEN
    RAISE EXCEPTION 'proposal not stored in the event time zone: %',v_p;
  END IF;
  -- Still the old agreed due until the host accepts.
  IF (public.gig_contract_workspace(v_c)->'gig'->>'video_due_at')::timestamptz<>v_brief_due THEN RAISE EXCEPTION 'workspace moved before acceptance'; END IF;

  -- 3. The host accepts: terms v2, workspace, both homes show the new due.
  PERFORM pg_temp.act(v_host);
  v_r:=public.gig_change_proposal_respond((v_p->>'id')::uuid,true);
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true OR (v_r->>'version')::int<>2 THEN RAISE EXCEPTION 'accept: %',v_r; END IF;
  SELECT to_jsonb(t) INTO v_row FROM public.gig_terms_versions t WHERE t.contract_id=v_c AND t.version=2;
  IF (v_row->>'video_due_at')::timestamptz<>v_new_due OR (v_row->>'post_by')::date<>current_date+25 THEN RAISE EXCEPTION 'terms v2: %',v_row; END IF;
  v_r:=public.gig_contract_workspace(v_c);
  IF (v_r->'gig'->>'video_due_at')::timestamptz<>v_new_due OR (v_r->'gig'->>'post_by')::date<>current_date+25 THEN
    RAISE EXCEPTION 'host workspace shows the old due: %',v_r->'gig';
  END IF;
  IF (v_r->'terms'->-1->>'video_due_at')::timestamptz<>v_new_due THEN RAISE EXCEPTION 'workspace terms list misses video_due_at'; END IF;
  SELECT c INTO v_row FROM jsonb_array_elements(public.gig_host_home(v_brand)->'contracts') c WHERE c->>'id'=v_c::text;
  IF (v_row->>'video_due_at')::timestamptz<>v_new_due OR (v_row->>'post_by')::date<>current_date+25 THEN RAISE EXCEPTION 'host home: %',v_row; END IF;
  PERFORM pg_temp.act(v_creator);
  IF (public.gig_contract_workspace(v_c)->'gig'->>'video_due_at')::timestamptz<>v_new_due THEN RAISE EXCEPTION 'creator workspace shows the old due'; END IF;
  SELECT c INTO v_row FROM jsonb_array_elements(public.gig_creator_home()->'contracts') c WHERE c->>'id'=v_c::text;
  IF (v_row->>'video_due_at')::timestamptz<>v_new_due OR (v_row->>'post_by')::date<>current_date+25 THEN RAISE EXCEPTION 'creator home: %',v_row; END IF;

  -- 4. Legacy: the host sends post_by only; it means 23:59 local that day.
  PERFORM pg_temp.act(v_host);
  v_p:=public.gig_change_proposal_save(v_c,jsonb_build_object('post_by',to_char(current_date+27,'YYYY-MM-DD')),'dates',NULL);
  IF (v_p->'changes'->>'video_due_at')::timestamptz<>v_legacy_due THEN RAISE EXCEPTION 'legacy post_by not read as 23:59 local: %',v_p; END IF;
  PERFORM pg_temp.act(v_creator);
  PERFORM public.gig_change_proposal_respond((v_p->>'id')::uuid,true);
  IF (SELECT video_due_at FROM public.gig_terms_versions WHERE contract_id=v_c AND version=3) IS DISTINCT FROM v_legacy_due
     OR (SELECT post_by FROM public.gig_terms_versions WHERE contract_id=v_c AND version=3)<>current_date+27 THEN
    RAISE EXCEPTION 'legacy accept terms v3';
  END IF;
  IF (public.gig_contract_workspace(v_c)->'gig'->>'video_due_at')::timestamptz<>v_legacy_due THEN RAISE EXCEPTION 'workspace after legacy change'; END IF;

  -- 5. A change of something else keeps the agreed due time.
  PERFORM pg_temp.act(v_host);
  v_p:=public.gig_change_proposal_save(v_c,'{"shoot_passes":2}'::jsonb,'passes',NULL);
  PERFORM pg_temp.act(v_creator);
  PERFORM public.gig_change_proposal_respond((v_p->>'id')::uuid,true);
  IF (SELECT video_due_at FROM public.gig_terms_versions WHERE contract_id=v_c AND version=4) IS DISTINCT FROM v_legacy_due THEN
    RAISE EXCEPTION 'unrelated change moved the due';
  END IF;

  -- 6. The post reminder reads the agreed terms.
  PERFORM pg_temp.act(NULL);
  PERFORM public.issue_3872_contract_apply_state(v_c,'posting',NULL);
  PERFORM public.gig_notification_tick((current_date+27)::timestamptz+interval '12 hours');
  SELECT o.payload INTO v_row FROM public.notification_outbox o WHERE o.category_key='creator.gig.post_reminder' AND o.payload->>'contract_id'=v_c::text;
  IF v_row IS NULL OR (v_row->>'post_by')::date<>current_date+27 OR (v_row->>'video_due_at')::timestamptz<>v_legacy_due THEN
    RAISE EXCEPTION 'post reminder: %',v_row;
  END IF;
END;
$test$;

ROLLBACK;
