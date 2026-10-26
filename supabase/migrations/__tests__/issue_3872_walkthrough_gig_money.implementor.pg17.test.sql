-- #3872 walkthrough (W1 server): creator-gig money and workflow defects.
-- Covers QA #1 refund authorisation, #2 rollout gates, #6 empty applicants,
-- #7 slots / interest state / unpaid offers, #8 gig_save validation, #9 brief
-- linter, #10 state token, #11 script rounds, #12 replays, #13 upload
-- deadline, #19 detail access, plus counters, top-ups, saved gigs and
-- budget ranges from the walkthrough contract. Every fixture rolls back.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claim.sub',coalesce(p_user::text,''),true),
         set_config('request.jwt.claims',CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub',p_user,'role','authenticated')::text END,true);
$fn$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES
  ('38723000-0000-4000-8000-0000000000a1','w1-host@mingla.test'),
  ('38723000-0000-4000-8000-0000000000a2','w1-scanner@mingla.test'),
  ('38723000-0000-4000-8000-0000000000a3','w1-creator@mingla.test'),
  ('38723000-0000-4000-8000-0000000000a4','w1-creator2@mingla.test'),
  ('38723000-0000-4000-8000-0000000000a5','w1-stranger@mingla.test'),
  ('38723000-0000-4000-8000-0000000000a6','w1-other-host@mingla.test');
INSERT INTO public.brands(id,account_id,name,slug) VALUES
  ('38723000-0000-4000-8000-0000000000b1','38723000-0000-4000-8000-0000000000a1','Walkthrough Rooftop','wt-rooftop'),
  ('38723000-0000-4000-8000-0000000000b2','38723000-0000-4000-8000-0000000000a6','Other Brand','wt-other');
INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
  ('38723000-0000-4000-8000-0000000000b1','38723000-0000-4000-8000-0000000000a2','scanner',now());
INSERT INTO public.seeding_cities(id,google_place_id,name,country,center_lat,center_lng,bbox_sw_lat,bbox_sw_lng,bbox_ne_lat,bbox_ne_lng)
VALUES('38723000-0000-4000-8000-0000000000c1','wt-raleigh','Raleigh','US',35.7,-78.6,35.6,-78.7,35.8,-78.5);
INSERT INTO public.events(id,brand_id,title,slug) VALUES
  ('38723000-0000-4000-8000-0000000000e1','38723000-0000-4000-8000-0000000000b1','Sunset Session','wt-sunset'),
  ('38723000-0000-4000-8000-0000000000e2','38723000-0000-4000-8000-0000000000b2','Other Event','wt-other-event');
INSERT INTO public.creator_accounts(id,email,display_name) VALUES
  ('38723000-0000-4000-8000-0000000000a3','w1-creator@mingla.test','Ada Films'),
  ('38723000-0000-4000-8000-0000000000a4','w1-creator2@mingla.test','Bo Clips');
INSERT INTO public.creator_profiles(creator_account_id,mode_enabled,display_name,home_city_id,niches,verification,date_of_birth,agreement_version,agreement_signed_at) VALUES
  ('38723000-0000-4000-8000-0000000000a3',true,'Ada Films','38723000-0000-4000-8000-0000000000c1',ARRAY['food'],'verified','1995-01-01','v1',now()),
  ('38723000-0000-4000-8000-0000000000a4',true,'Bo Clips','38723000-0000-4000-8000-0000000000c1',ARRAY['music'],'verified','1995-01-01','v1',now());
INSERT INTO public.creator_packages(id,creator_account_id,format_key,platforms,price_minor,currency,turnaround_days) VALUES
  ('38723000-0000-4000-8000-0000000000d3','38723000-0000-4000-8000-0000000000a3','date_idea',ARRAY['instagram'],30000,'USD',5),
  ('38723000-0000-4000-8000-0000000000d4','38723000-0000-4000-8000-0000000000a4','date_idea',ARRAY['instagram'],30000,'USD',5);
INSERT INTO public.payee_accounts(user_id,stripe_account_id,stripe_status) VALUES
  ('38723000-0000-4000-8000-0000000000a3','acct_w1c1','active'),
  ('38723000-0000-4000-8000-0000000000a4','acct_w1c2','active');
INSERT INTO public.gigs(id,brand_id,listing_kind,listing_id,title_public,brief_public,format_key,deliverables,city_id,category,shoot_window_start,shoot_window_end,post_by,budget_band,currency,slots,status,created_by)
VALUES('38723000-0000-4000-8000-0000000000f1','38723000-0000-4000-8000-0000000000b1','event','38723000-0000-4000-8000-0000000000e1',
  'A rooftop date night','Show a relaxed evening on a rooftop with music, drinks and the view across the city.','date_idea','["1 reel"]'::jsonb,
  '38723000-0000-4000-8000-0000000000c1','nightlife',current_date+1,current_date+20,current_date+30,'b2','USD',1,'open','38723000-0000-4000-8000-0000000000a1'),
  ('38723000-0000-4000-8000-0000000000f2','38723000-0000-4000-8000-0000000000b1','event','38723000-0000-4000-8000-0000000000e1',
  'A second rooftop gig','Show a relaxed evening on a rooftop with music, drinks and the view across the city.','date_idea','["1 reel"]'::jsonb,
  '38723000-0000-4000-8000-0000000000c1','nightlife',current_date+1,current_date+20,current_date+30,'b2','USD',2,'open','38723000-0000-4000-8000-0000000000a1'),
  ('38723000-0000-4000-8000-0000000000f3','38723000-0000-4000-8000-0000000000b1','event','38723000-0000-4000-8000-0000000000e1',
  'A third rooftop gig','Show a relaxed evening on a rooftop with music, drinks and the view across the city.','date_idea','["1 reel"]'::jsonb,
  '38723000-0000-4000-8000-0000000000c1','nightlife',current_date+1,current_date+20,current_date+30,'b2','USD',1,'draft','38723000-0000-4000-8000-0000000000a1');
INSERT INTO public.gig_interest(id,gig_id,creator_account_id,package_id,quoted_minor,status) VALUES
  ('38723000-0000-4000-8000-000000000101','38723000-0000-4000-8000-0000000000f1','38723000-0000-4000-8000-0000000000a3','38723000-0000-4000-8000-0000000000d3',30000,'sent'),
  ('38723000-0000-4000-8000-000000000102','38723000-0000-4000-8000-0000000000f1','38723000-0000-4000-8000-0000000000a4','38723000-0000-4000-8000-0000000000d4',30000,'sent'),
  ('38723000-0000-4000-8000-000000000103','38723000-0000-4000-8000-0000000000f2','38723000-0000-4000-8000-0000000000a3','38723000-0000-4000-8000-0000000000d3',30000,'passed'),
  ('38723000-0000-4000-8000-000000000104','38723000-0000-4000-8000-0000000000f2','38723000-0000-4000-8000-0000000000a4','38723000-0000-4000-8000-0000000000d4',20000,'sent');
SET LOCAL session_replication_role = origin;

INSERT INTO public.feature_flags(flag_key,is_enabled,description) VALUES('creator_gigs_enabled',true,'test')
ON CONFLICT(flag_key) DO UPDATE SET is_enabled=true;
INSERT INTO public.program_brand_rollouts(brand_id,program,phase) VALUES('38723000-0000-4000-8000-0000000000b1','creator_gigs','pilot')
ON CONFLICT DO NOTHING;

DO $test$
DECLARE
  v_host constant uuid:='38723000-0000-4000-8000-0000000000a1';
  v_scanner constant uuid:='38723000-0000-4000-8000-0000000000a2';
  v_creator constant uuid:='38723000-0000-4000-8000-0000000000a3';
  v_creator2 constant uuid:='38723000-0000-4000-8000-0000000000a4';
  v_stranger constant uuid:='38723000-0000-4000-8000-0000000000a5';
  v_gig constant uuid:='38723000-0000-4000-8000-0000000000f1';
  v_r jsonb; v_contract uuid; v_contract2 uuid; v_failed boolean; v_state text; v_hold jsonb;
  v_quote jsonb; v_lint text[]; v_proposal uuid; v_count integer;
BEGIN
  -- #10: a fresh session never set the token; a direct state UPDATE must fail.
  PERFORM pg_temp.act(v_host);
  v_r:=public.gig_offer_prepare('38723000-0000-4000-8000-000000000101','{"fee_minor":30000}'::jsonb,'w1-offer-key-0001');
  v_contract:=(v_r->>'contract_id')::uuid;
  IF v_contract IS NULL THEN RAISE EXCEPTION 'offer prepare failed: %',v_r; END IF;
  v_failed:=false;
  BEGIN
    UPDATE public.gig_contracts SET state='accepted' WHERE id=v_contract;
  EXCEPTION WHEN others THEN v_failed:=true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION '#10 direct state update bypassed the guard on a fresh session'; END IF;

  -- #7: one slot, a second offer on the same gig must be refused.
  v_r:=public.gig_offer_prepare('38723000-0000-4000-8000-000000000102','{"fee_minor":30000}'::jsonb,'w1-offer-key-0002');
  IF coalesce(v_r->>'ok','')<>'false' OR v_r->>'error'<>'gig_full' THEN RAISE EXCEPTION '#7 slots not enforced: %',v_r; END IF;
  -- #7: passed interest cannot be offered.
  v_r:=public.gig_offer_prepare('38723000-0000-4000-8000-000000000103','{"fee_minor":30000}'::jsonb,'w1-offer-key-0003');
  IF v_r->>'error' IS DISTINCT FROM 'interest_not_open' THEN RAISE EXCEPTION '#7 interest status not checked: %',v_r; END IF;

  -- #7: the uncaptured offer is invisible and not actionable for the creator.
  PERFORM pg_temp.act(v_creator);
  IF jsonb_array_length(public.gig_creator_home()->'contracts')<>0 THEN RAISE EXCEPTION '#7 unpaid offer visible to creator'; END IF;
  v_failed:=false;
  BEGIN PERFORM public.gig_transition(v_contract,'offered','decline','{}'::jsonb);
  EXCEPTION WHEN others THEN v_failed:=SQLERRM='offer_not_ready'; END;
  IF NOT v_failed THEN RAISE EXCEPTION '#7 creator acted on unpaid offer'; END IF;

  -- #12: capture is replay-safe.
  PERFORM pg_temp.act(NULL);
  v_hold:=public.gig_hold_mark_captured(v_contract,1,'pi_w1_1');
  v_hold:=public.gig_hold_mark_captured(v_contract,1,'pi_w1_1');
  IF (v_hold->>'replayed')::boolean IS DISTINCT FROM true OR v_hold->>'status'<>'captured' THEN RAISE EXCEPTION '#12 capture replay: %',v_hold; END IF;
  PERFORM pg_temp.act(v_creator);
  IF jsonb_array_length(public.gig_creator_home()->'contracts')<>1 THEN RAISE EXCEPTION 'captured offer must be visible'; END IF;
  IF public.gig_creator_home()->'contracts'->0->>'next_action'<>'answer_offer' THEN RAISE EXCEPTION 'next_action missing'; END IF;

  -- #1: a stranger cannot authorise any refund branch.
  PERFORM pg_temp.act(v_stranger);
  v_failed:=false;
  BEGIN PERFORM public.gig_refund_authorize(v_contract,'host_before_accept');
  EXCEPTION WHEN others THEN v_failed:=true; END;
  IF NOT v_failed THEN RAISE EXCEPTION '#1 non-party authorised a refund'; END IF;
  v_failed:=false;
  BEGIN PERFORM public.gig_refund_authorize(v_contract,'creator_decline');
  EXCEPTION WHEN others THEN v_failed:=true; END;
  IF NOT v_failed THEN RAISE EXCEPTION '#1 non-party authorised creator_decline'; END IF;
  -- A low-rank team member is not a contract party either.
  PERFORM pg_temp.act(v_scanner);
  v_failed:=false;
  BEGIN PERFORM public.gig_refund_authorize(v_contract,'host_before_accept');
  EXCEPTION WHEN others THEN v_failed:=true; END;
  IF NOT v_failed THEN RAISE EXCEPTION '#8 scanner authorised a host refund'; END IF;
  PERFORM pg_temp.act(v_host);
  PERFORM public.gig_refund_authorize(v_contract,'host_before_accept');

  -- Counters: creator asks for more, host accepts, top-up gates acceptance.
  PERFORM pg_temp.act(v_creator);
  v_r:=public.gig_counter_send(v_contract,40000,'Happy to do it for a bit more');
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'counter send: %',v_r; END IF;
  v_proposal:=(v_r->>'proposal_id')::uuid;
  v_r:=public.gig_counter_send(v_contract,45000,NULL);
  IF v_r->>'error' IS DISTINCT FROM 'counter_already_open' THEN RAISE EXCEPTION 'one open counter: %',v_r; END IF;
  PERFORM pg_temp.act(v_host);
  v_r:=public.gig_counter_respond(v_proposal,true);
  IF (v_r->>'requires_topup')::boolean IS DISTINCT FROM true OR (v_r->>'topup_minor')::bigint<>11500 THEN RAISE EXCEPTION 'counter accept: %',v_r; END IF;
  v_r:=public.gig_topup_prepare(v_contract,2);
  IF (v_r->>'total_minor')::bigint<>11500 OR v_r->>'rail'<>'stripe' THEN RAISE EXCEPTION 'topup prepare: %',v_r; END IF;
  PERFORM pg_temp.act(v_creator);
  v_failed:=false;
  BEGIN PERFORM public.gig_transition(v_contract,'offered','accept','{}'::jsonb);
  EXCEPTION WHEN others THEN v_failed:=true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'accepted while top-up unpaid'; END IF;
  PERFORM pg_temp.act(NULL);
  PERFORM public.gig_topup_mark_captured(v_contract,2,'pi_w1_topup');
  -- Server-side refund quote spans the base charge and the top-up.
  v_quote:=public.gig_refund_quote(v_contract,'host_before_accept');
  IF (v_quote->>'refund_minor')::bigint<>46000 OR jsonb_array_length(v_quote->'sources')<>2 THEN RAISE EXCEPTION 'refund quote: %',v_quote; END IF;
  -- #12: a record with amounts other than the server quote is refused.
  v_failed:=false;
  BEGIN PERFORM public.gig_refund_record(v_contract,'host_before_accept',100,0,'re_w1');
  EXCEPTION WHEN others THEN v_failed:=SQLERRM='refund_amount_mismatch'; END;
  IF NOT v_failed THEN RAISE EXCEPTION '#12 refund record trusted a client amount'; END IF;

  PERFORM pg_temp.act(v_creator);
  v_r:=public.gig_transition(v_contract,'offered','accept','{}'::jsonb);
  IF v_r->>'state'<>'accepted' THEN RAISE EXCEPTION 'accept failed: %',v_r; END IF;
  -- #10: the token is cleared after the transition, so a direct update in
  -- the same transaction is still refused.
  v_failed:=false;
  BEGIN UPDATE public.gig_contracts SET state='posts_verified' WHERE id=v_contract;
  EXCEPTION WHEN others THEN v_failed:=true; END;
  IF NOT v_failed THEN RAISE EXCEPTION '#10 state token leaked past the transition'; END IF;

  -- #11: script change requests use their own two rounds.
  PERFORM public.issue_3872_contract_apply_state(v_contract,'script_sent',now()+interval '1 day');
  PERFORM pg_temp.act(v_host);
  PERFORM public.gig_transition(v_contract,'script_sent','request_script_changes','{}'::jsonb);
  PERFORM public.issue_3872_contract_apply_state(v_contract,'script_sent',now()+interval '1 day');
  PERFORM public.gig_transition(v_contract,'script_sent','request_script_changes','{}'::jsonb);
  IF (SELECT fix_rounds_used FROM public.gig_contracts WHERE id=v_contract)<>0
     OR (SELECT script_rounds_used FROM public.gig_contracts WHERE id=v_contract)<>2 THEN
    RAISE EXCEPTION '#11 script requests consumed delivery fix rounds';
  END IF;
  -- #13: locking the script sets the upload deadline.
  PERFORM public.issue_3872_contract_apply_state(v_contract,'script_sent',now()+interval '1 day');
  PERFORM public.gig_transition(v_contract,'script_sent','lock_script','{}'::jsonb);
  IF (SELECT state_deadline_at FROM public.gig_contracts WHERE id=v_contract) IS NULL THEN RAISE EXCEPTION '#13 no upload deadline at script lock'; END IF;
  -- #13: the missed deadline is a full-refund branch for the timer only.
  UPDATE public.gig_contracts SET state_deadline_at=now()-interval '1 minute' WHERE id=v_contract;
  PERFORM pg_temp.act(NULL);
  v_quote:=public.gig_refund_quote(v_contract,'upload_missed');
  IF (v_quote->>'refund_minor')::bigint<>46000 OR (v_quote->>'creator_fee_minor')::bigint<>0 THEN RAISE EXCEPTION '#13 upload_missed quote: %',v_quote; END IF;
  v_r:=public.gig_refund_record(v_contract,'upload_missed',46000,0,'re_w1_upload');
  IF v_r->>'state'<>'cancelled' THEN RAISE EXCEPTION '#13 upload_missed did not cancel: %',v_r; END IF;
  -- #12: a same-amount replay is a no-op; a different-amount replay is refused.
  v_r:=public.gig_refund_record(v_contract,'upload_missed',46000,0,'re_w1_upload');
  IF (v_r->>'replayed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION '#12 refund replay not idempotent: %',v_r; END IF;
  v_failed:=false;
  BEGIN PERFORM public.gig_refund_record(v_contract,'upload_missed',1000,0,'re_w1_upload');
  EXCEPTION WHEN others THEN v_failed:=SQLERRM='refund_replay_mismatch'; END;
  IF NOT v_failed THEN RAISE EXCEPTION '#12 refund replay with different amount accepted'; END IF;

  -- #12: release replay returns replayed instead of release_not_ready.
  PERFORM pg_temp.act(v_host);
  v_r:=public.gig_offer_prepare('38723000-0000-4000-8000-000000000104','{"fee_minor":20000}'::jsonb,'w1-offer-key-0004');
  v_contract2:=(v_r->>'contract_id')::uuid;
  PERFORM pg_temp.act(NULL);
  PERFORM public.gig_hold_mark_captured(v_contract2,1,'pi_w1_2');
  PERFORM public.issue_3872_contract_apply_state(v_contract2,'posts_verified',now());
  v_r:=public.gig_release_record(v_contract2,'tr_w1');
  v_r:=public.gig_release_record(v_contract2,'tr_w1');
  IF (v_r->>'replayed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION '#12 release replay: %',v_r; END IF;

  -- #6: a gig with no interest returns [] (not one all-null applicant).
  PERFORM pg_temp.act(v_host);
  v_r:=public.gig_applicants('38723000-0000-4000-8000-0000000000f3');
  IF v_r IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION '#6 empty applicants returned %',v_r; END IF;

  -- #8: gig_save validation.
  v_r:=public.gig_save(jsonb_build_object('brand_id','38723000-0000-4000-8000-0000000000b1','listing_kind','event','listing_id','38723000-0000-4000-8000-0000000000e2',
    'title_public','A rooftop date night','brief_public','Show a relaxed evening on a rooftop with music, drinks and the view across the city.',
    'format_key','date_idea','deliverables','["1 reel"]'::jsonb,'city_id','38723000-0000-4000-8000-0000000000c1','category','nightlife',
    'shoot_window_start',current_date+1,'shoot_window_end',current_date+5,'post_by',current_date+9,'budget_band','b2','currency','USD'));
  IF v_r->>'error' IS DISTINCT FROM 'listing_not_found' THEN RAISE EXCEPTION '#8 cross-brand listing accepted: %',v_r; END IF;
  v_r:=public.gig_save(jsonb_build_object('brand_id','38723000-0000-4000-8000-0000000000b1','listing_kind','event','listing_id','38723000-0000-4000-8000-0000000000e1',
    'title_public','A rooftop date night','brief_public','Show a relaxed evening on a rooftop with music, drinks and the view across the city.',
    'format_key','date_idea','deliverables','["1 reel"]'::jsonb,'city_id','38723000-0000-4000-8000-0000000000c1','category','nightlife',
    'shoot_window_start',current_date-10,'shoot_window_end',current_date-5,'post_by',current_date+9,'budget_band','b2','currency','USD'));
  IF v_r->>'error' IS DISTINCT FROM 'shoot_window_in_past' THEN RAISE EXCEPTION '#8 past window accepted: %',v_r; END IF;
  v_r:=public.gig_save(jsonb_build_object('brand_id','38723000-0000-4000-8000-0000000000b1','listing_kind','event','listing_id','38723000-0000-4000-8000-0000000000e1',
    'title_public','Short','brief_public','too short','format_key','date_idea','deliverables','["1 reel"]'::jsonb,'city_id','38723000-0000-4000-8000-0000000000c1',
    'category','nightlife','shoot_window_start',current_date+1,'shoot_window_end',current_date+5,'post_by',current_date+9,'budget_band','b2','currency','USD'));
  IF v_r->>'field' IS DISTINCT FROM 'title_public' THEN RAISE EXCEPTION '#8 constraint violations must be {ok:false,field}: %',v_r; END IF;
  v_r:=public.gig_save(jsonb_build_object('id','38723000-0000-4000-8000-0000000000f9','brand_id','38723000-0000-4000-8000-0000000000b1','listing_kind','event','listing_id','38723000-0000-4000-8000-0000000000e1'));
  IF v_r->>'error' IS DISTINCT FROM 'gig_not_found' THEN RAISE EXCEPTION '#8 unknown gig id silently ok: %',v_r; END IF;
  PERFORM pg_temp.act(v_scanner);
  v_failed:=false;
  BEGIN PERFORM public.gig_save(jsonb_build_object('brand_id','38723000-0000-4000-8000-0000000000b1'));
  EXCEPTION WHEN others THEN v_failed:=SQLERRM='permission_denied'; END;
  IF NOT v_failed THEN RAISE EXCEPTION '#8 rank-10 member may write gigs'; END IF;

  -- #9: bare domains and dotted phones.
  v_lint:=public.issue_3872_brief_lint(NULL,NULL,NULL,'Book at rooftopraleigh.com today');
  IF NOT 'url'=ANY(v_lint) THEN RAISE EXCEPTION '#9 bare domain missed'; END IF;
  v_lint:=public.issue_3872_brief_lint(NULL,NULL,NULL,'Call 919.555.0101 to book');
  IF NOT 'phone'=ANY(v_lint) THEN RAISE EXCEPTION '#9 dotted phone missed'; END IF;
  v_lint:=public.issue_3872_brief_lint(NULL,NULL,NULL,'Doors 10.00-12.00, e.g. a calm brunch for two at $45.');
  IF cardinality(v_lint)>0 THEN RAISE EXCEPTION '#9 false positive: %',v_lint; END IF;

  -- Budget range and saved gigs on the board; full gigs drop off.
  INSERT INTO public.gig_budget_bands(currency,band,min_minor,max_minor) VALUES('USD','b2',20000,50000);
  PERFORM pg_temp.act(v_creator);
  v_r:=public.creator_gig_save('38723000-0000-4000-8000-0000000000f2',true);
  IF (v_r->>'saved')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'save gig: %',v_r; END IF;
  v_r:=public.creator_gig_board(NULL,NULL);
  SELECT e INTO v_hold FROM jsonb_array_elements(v_r) e WHERE e->>'id'='38723000-0000-4000-8000-0000000000f2';
  IF v_hold IS NULL OR (v_hold->>'budget_min_minor')::bigint<>20000 OR (v_hold->>'saved')::boolean IS DISTINCT FROM true
     OR v_hold->>'budget_currency'<>'USD' THEN
    RAISE EXCEPTION 'board shape: %',v_r;
  END IF;
  IF jsonb_array_length(public.creator_saved_gigs())<>1 THEN RAISE EXCEPTION 'saved gigs missing'; END IF;

  -- #2: the brand's rollout gates the board and host writes.
  DELETE FROM public.program_brand_rollouts WHERE brand_id='38723000-0000-4000-8000-0000000000b1' AND program='creator_gigs';
  IF jsonb_array_length(public.creator_gig_board(NULL,NULL))<>0 THEN RAISE EXCEPTION '#2 board ignored rollout'; END IF;
  v_r:=public.gig_interest_send('38723000-0000-4000-8000-0000000000f2','38723000-0000-4000-8000-0000000000d3',30000,NULL);
  IF v_r->>'error' IS DISTINCT FROM 'gig_not_open' THEN RAISE EXCEPTION '#2 interest ignored rollout: %',v_r; END IF;
  PERFORM pg_temp.act(v_host);
  v_failed:=false;
  BEGIN PERFORM public.gig_save(jsonb_build_object('brand_id','38723000-0000-4000-8000-0000000000b1'));
  EXCEPTION WHEN others THEN v_failed:=SQLERRM='creator_gigs_disabled'; END;
  IF NOT v_failed THEN RAISE EXCEPTION '#2 gig_save ignored rollout'; END IF;

  -- #19: detail is for creator accounts only.
  PERFORM pg_temp.act(v_stranger);
  v_failed:=false;
  BEGIN PERFORM public.creator_gig_detail('38723000-0000-4000-8000-0000000000f2');
  EXCEPTION WHEN others THEN v_failed:=true; END;
  IF NOT v_failed THEN RAISE EXCEPTION '#19 non-creator read gig detail'; END IF;

  -- Grants.
  IF has_function_privilege('authenticated','public.gig_refund_quote(uuid,text)','execute')
     OR has_function_privilege('authenticated','public.issue_3872_contract_apply_state(uuid,text,timestamptz,integer,integer,text)','execute')
     OR has_function_privilege('authenticated','public.gig_topup_mark_captured(uuid,integer,text)','execute')
     OR NOT has_function_privilege('authenticated','public.gig_counter_send(uuid,bigint,text)','execute')
     OR NOT has_function_privilege('authenticated','public.gig_results(uuid,uuid)','execute')
     OR has_function_privilege('anon','public.creator_gig_detail(uuid)','execute') THEN
    RAISE EXCEPTION 'walkthrough gig grants drifted';
  END IF;
END;
$test$;

ROLLBACK;
