-- #3872 video-due change after hire, adversarial: a due time in the past, an
-- unreadable one, or one at/before the agreed shoot is refused next to the
-- field (and stores nothing); another creator, a stranger and the proposer
-- themselves cannot propose or accept; a stale answer is an app conflict
-- (PT409), never a serialization failure. Every fixture rolls back.
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
  ('3872a000-0000-4000-8000-0000000000a1','due-a-host@mingla.test'),
  ('3872a000-0000-4000-8000-0000000000a3','due-a-creator@mingla.test'),
  ('3872a000-0000-4000-8000-0000000000a4','due-a-creator2@mingla.test'),
  ('3872a000-0000-4000-8000-0000000000a5','due-a-stranger@mingla.test');
INSERT INTO public.brands(id,account_id,name,slug,default_currency) VALUES
  ('3872a000-0000-4000-8000-0000000000b1','3872a000-0000-4000-8000-0000000000a1','Due Change Rooftop','due-a-rooftop','USD');
INSERT INTO public.seeding_cities(id,google_place_id,name,country,country_code,center_lat,center_lng,bbox_sw_lat,bbox_sw_lng,bbox_ne_lat,bbox_ne_lng,is_live_for_consumers) VALUES
  ('3872a000-0000-4000-8000-0000000000c1','due-a-city','Duetown','United States','US',35.7,-78.6,35.6,-78.7,35.8,-78.5,true);
INSERT INTO public.events(id,brand_id,title,slug,status,published_at,timezone) VALUES
  ('3872a000-0000-4000-8000-0000000000e1','3872a000-0000-4000-8000-0000000000b1','Rooftop Night','due-a-night','scheduled',now(),'America/New_York');
INSERT INTO public.creator_accounts(id,email,display_name) VALUES
  ('3872a000-0000-4000-8000-0000000000a3','due-a-creator@mingla.test','Ada Films'),
  ('3872a000-0000-4000-8000-0000000000a4','due-a-creator2@mingla.test','Bo Clips');
INSERT INTO public.creator_profiles(creator_account_id,mode_enabled,display_name,home_city_id,niches,verification,date_of_birth,agreement_version,agreement_signed_at) VALUES
  ('3872a000-0000-4000-8000-0000000000a3',true,'Ada Films','3872a000-0000-4000-8000-0000000000c1',ARRAY['food'],'verified','1995-01-01','v1',now()),
  ('3872a000-0000-4000-8000-0000000000a4',true,'Bo Clips','3872a000-0000-4000-8000-0000000000c1',ARRAY['music'],'verified','1995-01-01','v1',now());
INSERT INTO public.creator_packages(id,creator_account_id,format_key,platforms,price_minor,currency,turnaround_days) VALUES
  ('3872a000-0000-4000-8000-0000000000d3','3872a000-0000-4000-8000-0000000000a3','date_idea',ARRAY['instagram'],30000,'USD',5);
INSERT INTO public.payee_accounts(user_id,stripe_account_id,stripe_status) VALUES
  ('3872a000-0000-4000-8000-0000000000a3','acct_due-a1','active');
INSERT INTO public.gigs(id,brand_id,listing_kind,listing_id,title_public,brief_public,format_key,deliverables,city_id,category,shoot_window_start,shoot_window_end,post_by,video_due_at,pay_up_to_minor,currency,slots,status,created_by) VALUES
  ('3872a000-0000-4000-8000-0000000000f1','3872a000-0000-4000-8000-0000000000b1','event','3872a000-0000-4000-8000-0000000000e1',
   'A rooftop date night','Show a relaxed evening on a rooftop with music, drinks and the view across the city.','date_idea','["1 reel"]'::jsonb,
   '3872a000-0000-4000-8000-0000000000c1','nightlife',current_date+1,current_date+20,current_date+30,
   ((current_date+30)+time '18:00') AT TIME ZONE 'America/New_York',30000,'USD',2,'open','3872a000-0000-4000-8000-0000000000a1');
INSERT INTO public.gig_interest(id,gig_id,creator_account_id,package_id,quoted_minor,status) VALUES
  ('3872a000-0000-4000-8000-000000000101','3872a000-0000-4000-8000-0000000000f1','3872a000-0000-4000-8000-0000000000a3','3872a000-0000-4000-8000-0000000000d3',30000,'sent');
SET LOCAL session_replication_role = origin;

INSERT INTO public.feature_flags(flag_key,is_enabled,description) VALUES('creator_gigs_enabled',true,'test')
ON CONFLICT(flag_key) DO UPDATE SET is_enabled=true;
INSERT INTO public.program_brand_rollouts(brand_id,program,phase) VALUES('3872a000-0000-4000-8000-0000000000b1','creator_gigs','pilot')
ON CONFLICT DO NOTHING;

DO $test$
DECLARE
  v_host constant uuid:='3872a000-0000-4000-8000-0000000000a1';
  v_creator constant uuid:='3872a000-0000-4000-8000-0000000000a3';
  v_creator2 constant uuid:='3872a000-0000-4000-8000-0000000000a4';
  v_stranger constant uuid:='3872a000-0000-4000-8000-0000000000a5';
  v_c uuid; v_r jsonb; v_p jsonb; v_raised boolean; v_state text; v_count int;
  v_day text:=to_char(current_date+5,'YYYY-MM-DD');
BEGIN
  PERFORM pg_temp.act(v_host);
  v_r:=public.gig_offer_prepare('3872a000-0000-4000-8000-000000000101','{"fee_minor":30000}'::jsonb,'due-a-offer-0001');
  v_c:=(v_r->>'contract_id')::uuid;
  PERFORM pg_temp.act(NULL);
  PERFORM public.gig_hold_mark_captured(v_c,1,'pi_due_a_1');
  PERFORM pg_temp.act(v_creator);
  PERFORM public.gig_transition(v_c,'offered','accept','{}'::jsonb);
  -- The shoot is agreed for 19:00 New York time in five days.
  PERFORM public.gig_shoot_plan_save(v_c,(current_date+5+time '19:00') AT TIME ZONE 'America/New_York','Front door',true);

  -- 1. Past, unreadable and empty due times: video_due_required.
  v_r:=public.gig_change_proposal_save(v_c,jsonb_build_object('video_due_at',to_char(current_date-1,'YYYY-MM-DD')||'T18:00'),'dates',NULL);
  IF v_r<>'{"ok":false,"error":"video_due_required","field":"video_due_at"}'::jsonb THEN RAISE EXCEPTION 'past due: %',v_r; END IF;
  v_r:=public.gig_change_proposal_save(v_c,'{"video_due_at":"next friday"}'::jsonb,'dates',NULL);
  IF v_r->>'error'<>'video_due_required' OR v_r->>'field'<>'video_due_at' THEN RAISE EXCEPTION 'unreadable due: %',v_r; END IF;
  v_r:=public.gig_change_proposal_save(v_c,'{"video_due_at":""}'::jsonb,'dates',NULL);
  IF v_r->>'error'<>'video_due_required' THEN RAISE EXCEPTION 'empty due: %',v_r; END IF;
  v_r:=public.gig_change_proposal_save(v_c,jsonb_build_object('post_by',to_char(current_date-2,'YYYY-MM-DD')),'dates',NULL);
  IF v_r->>'error'<>'video_due_required' THEN RAISE EXCEPTION 'past legacy post_by: %',v_r; END IF;

  -- 2. At or before the agreed shoot (local 18:00 and 19:00 on the shoot day).
  v_r:=public.gig_change_proposal_save(v_c,jsonb_build_object('video_due_at',v_day||'T18:00'),'dates',NULL);
  IF v_r<>'{"ok":false,"error":"video_due_before_shoot","field":"video_due_at"}'::jsonb THEN RAISE EXCEPTION 'before shoot: %',v_r; END IF;
  v_r:=public.gig_change_proposal_save(v_c,jsonb_build_object('video_due_at',v_day||'T19:00'),'dates',NULL);
  IF v_r->>'error'<>'video_due_before_shoot' THEN RAISE EXCEPTION 'at shoot: %',v_r; END IF;
  -- A UTC time that is before the shoot in New York is refused the same way.
  v_r:=public.gig_change_proposal_save(v_c,jsonb_build_object('video_due_at',v_day||'T22:00:00Z'),'dates',NULL);
  IF v_r->>'error'<>'video_due_before_shoot' THEN RAISE EXCEPTION 'offset time before shoot: %',v_r; END IF;
  SELECT count(*) INTO v_count FROM public.gig_change_proposals WHERE contract_id=v_c;
  IF v_count<>0 THEN RAISE EXCEPTION 'refused changes stored a proposal'; END IF;

  -- 3. Others cannot propose.
  FOREACH v_state IN ARRAY ARRAY[v_creator2::text,v_stranger::text] LOOP
    PERFORM pg_temp.act(v_state::uuid);
    v_raised:=false;
    BEGIN
      PERFORM public.gig_change_proposal_save(v_c,jsonb_build_object('video_due_at',to_char(current_date+9,'YYYY-MM-DD')||'T10:00'),'dates',NULL);
    EXCEPTION WHEN insufficient_privilege THEN v_raised:=true;
    END;
    IF NOT v_raised THEN RAISE EXCEPTION 'outsider % proposed a due change',v_state; END IF;
  END LOOP;

  -- 4. One after the shoot is accepted; the proposer cannot answer it, nor can an outsider.
  PERFORM pg_temp.act(v_creator);
  v_p:=public.gig_change_proposal_save(v_c,jsonb_build_object('video_due_at',v_day||'T21:00'),'dates',NULL);
  IF (v_p->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'valid due refused: %',v_p; END IF;
  v_raised:=false;
  BEGIN PERFORM public.gig_change_proposal_respond((v_p->>'id')::uuid,true);
  EXCEPTION WHEN insufficient_privilege THEN v_raised:=true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'proposer accepted own change'; END IF;
  PERFORM pg_temp.act(v_creator2);
  v_raised:=false;
  BEGIN PERFORM public.gig_change_proposal_respond((v_p->>'id')::uuid,true);
  EXCEPTION WHEN insufficient_privilege THEN v_raised:=true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'another creator accepted the change'; END IF;
  PERFORM pg_temp.act(v_host);
  PERFORM public.gig_change_proposal_respond((v_p->>'id')::uuid,true);

  -- 5. Answering it again is an app conflict (PT409), not 40001.
  v_state:=NULL;
  BEGIN PERFORM public.gig_change_proposal_respond((v_p->>'id')::uuid,false);
  EXCEPTION WHEN others THEN v_state:=SQLSTATE; END;
  IF v_state IS DISTINCT FROM 'PT409' THEN RAISE EXCEPTION 'stale answer SQLSTATE %',v_state; END IF;

  -- 6. The fee still cannot move through a due change, and unknown keys are refused.
  v_raised:=false;
  BEGIN PERFORM public.gig_change_proposal_save(v_c,jsonb_build_object('video_due_at',v_day||'T22:00','fee_minor',1),'dates',NULL);
  EXCEPTION WHEN invalid_parameter_value THEN v_raised:=true; END;
  IF NOT v_raised THEN RAISE EXCEPTION 'fee moved with a due change'; END IF;

  -- 7. No new function in this change raises 40001.
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN ('gig_change_proposal_save','gig_change_proposal_respond','issue_3872_terms_due_at','issue_3872_terms_due_fill')
       AND (p.prosrc LIKE '%40001%' OR p.prosrc ILIKE '%serialization_failure%')) THEN
    RAISE EXCEPTION 'a due-change function raises a serialization failure';
  END IF;
END;
$test$;

ROLLBACK;
