\set ON_ERROR_STOP on

-- #4402 migration 20280704604402: the upload timer follows the agreed
-- "Video needed by" time, and an accepted terms change moves the timer.
-- Every fixture rolls back.
--
-- MINGLA-INVARIANT: I-4402-UPLOAD-1 | issue #4402 | the upload timer is the agreed video_due_at (fallback post_by - 1 day UTC), never sooner than 24 h after it starts

BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES
  ('44020600-0000-4000-8000-0000000000a1','i4402u-host@mingla.test'),
  ('44020600-0000-4000-8000-0000000000a3','i4402u-creator@mingla.test');
INSERT INTO public.brands(id,account_id,name,slug,default_currency) VALUES
  ('44020600-0000-4000-8000-0000000000b1','44020600-0000-4000-8000-0000000000a1','Upload Rooftop','i4402u-rooftop','NGN');
INSERT INTO public.seeding_cities(id,google_place_id,name,country,country_code,center_lat,center_lng,bbox_sw_lat,bbox_sw_lng,bbox_ne_lat,bbox_ne_lng,is_live_for_consumers) VALUES
  ('44020600-0000-4000-8000-0000000000c1','i4402u-city','Uploadtown','Nigeria','NG',6.5,3.4,6.4,3.3,6.6,3.5,true);
INSERT INTO public.events(id,brand_id,title,slug,status,published_at,timezone,created_by) VALUES
  ('44020600-0000-4000-8000-0000000000e1','44020600-0000-4000-8000-0000000000b1','Rooftop Night','i4402u-night','scheduled',now(),'Africa/Lagos','44020600-0000-4000-8000-0000000000a1');
INSERT INTO public.creator_accounts(id,email,display_name) VALUES
  ('44020600-0000-4000-8000-0000000000a3','i4402u-creator@mingla.test','Ada Films');
INSERT INTO public.creator_profiles(creator_account_id,mode_enabled,display_name,home_city_id,niches,verification,date_of_birth,agreement_version,agreement_signed_at) VALUES
  ('44020600-0000-4000-8000-0000000000a3',true,'Ada Films','44020600-0000-4000-8000-0000000000c1',ARRAY['food'],'verified','1995-01-01','v1',now());
INSERT INTO public.gigs(id,brand_id,listing_kind,listing_id,title_public,brief_public,format_key,deliverables,city_id,category,shoot_window_start,shoot_window_end,post_by,pay_up_to_minor,currency,slots,status,created_by) VALUES
  ('44020600-0000-4000-8000-0000000000f1','44020600-0000-4000-8000-0000000000b1','event','44020600-0000-4000-8000-0000000000e1',
   'A rooftop date night','Show a relaxed evening on a rooftop with music, drinks and the view across the city.','date_idea','["1 reel"]'::jsonb,
   '44020600-0000-4000-8000-0000000000c1','nightlife',current_date+1,current_date+20,current_date+30,500000,'NGN',3,'open','44020600-0000-4000-8000-0000000000a1'),
  ('44020600-0000-4000-8000-0000000000f2','44020600-0000-4000-8000-0000000000b1','event','44020600-0000-4000-8000-0000000000e1',
   'A rooftop date night','Show a relaxed evening on a rooftop with music, drinks and the view across the city.','date_idea','["1 reel"]'::jsonb,
   '44020600-0000-4000-8000-0000000000c1','nightlife',current_date+1,current_date+20,current_date+30,500000,'NGN',3,'open','44020600-0000-4000-8000-0000000000a1'),
  ('44020600-0000-4000-8000-0000000000f3','44020600-0000-4000-8000-0000000000b1','event','44020600-0000-4000-8000-0000000000e1',
   'A rooftop date night','Show a relaxed evening on a rooftop with music, drinks and the view across the city.','date_idea','["1 reel"]'::jsonb,
   '44020600-0000-4000-8000-0000000000c1','nightlife',current_date+1,current_date+20,current_date+30,500000,'NGN',3,'open','44020600-0000-4000-8000-0000000000a1');
INSERT INTO public.gig_contracts(id,gig_id,brand_id,creator_account_id,state,current_terms_version) VALUES
  ('44020600-0000-4000-8000-000000000c01','44020600-0000-4000-8000-0000000000f1','44020600-0000-4000-8000-0000000000b1','44020600-0000-4000-8000-0000000000a3','script_sent',1),
  ('44020600-0000-4000-8000-000000000c02','44020600-0000-4000-8000-0000000000f2','44020600-0000-4000-8000-0000000000b1','44020600-0000-4000-8000-0000000000a3','script_sent',1),
  ('44020600-0000-4000-8000-000000000c03','44020600-0000-4000-8000-0000000000f3','44020600-0000-4000-8000-0000000000b1','44020600-0000-4000-8000-0000000000a3','posting',1);
INSERT INTO public.gig_terms_versions(contract_id,version,fee_minor,booking_fee_minor,currency,deliverables,format_key,post_by,video_due_at,usage_days,shoot_passes,proposed_by,rights_model) VALUES
  -- Agreed due Dec-15-style: 18:00 Lagos on post_by (the walk-3 shape).
  ('44020600-0000-4000-8000-000000000c01',1,10000,1500,'NGN','["1 reel"]'::jsonb,'date_idea',current_date+20,((current_date+20)::timestamp+time '18:00') AT TIME ZONE 'Africa/Lagos',90,1,'host','creator_v1_perpetual'),
  -- No agreed time (older terms): the old post_by - 1 day rule.
  ('44020600-0000-4000-8000-000000000c02',1,10000,1500,'NGN','["1 reel"]'::jsonb,'date_idea',current_date+20,NULL,90,1,'host','creator_v1_perpetual'),
  ('44020600-0000-4000-8000-000000000c03',1,10000,1500,'NGN','["1 reel"]'::jsonb,'date_idea',current_date+20,NULL,90,1,'host','creator_v1_perpetual'),
  ('44020600-0000-4000-8000-000000000c03',2,10000,1500,'NGN','["1 reel"]'::jsonb,'date_idea',current_date+25,NULL,90,1,'host','creator_v1_perpetual'),
  -- A due change on c01: new agreed time two days later.
  ('44020600-0000-4000-8000-000000000c01',2,10000,1500,'NGN','["1 reel"]'::jsonb,'date_idea',current_date+22,((current_date+22)::timestamp+time '12:00') AT TIME ZONE 'Africa/Lagos',90,1,'host','creator_v1_perpetual');
SET LOCAL session_replication_role = origin;

DO $test$
DECLARE
  c1 constant uuid := '44020600-0000-4000-8000-000000000c01';
  c2 constant uuid := '44020600-0000-4000-8000-000000000c02';
  c3 constant uuid := '44020600-0000-4000-8000-000000000c03';
  v timestamptz;
BEGIN
  -- Entering the upload step uses the agreed time, not post_by - 1 at 00:00 UTC.
  PERFORM set_config('issue3872.transition', c1::text, true);
  UPDATE public.gig_contracts SET state='script_locked', state_deadline_at=((current_date+19)::timestamp AT TIME ZONE 'UTC') WHERE id=c1;
  SELECT state_deadline_at INTO v FROM public.gig_contracts WHERE id=c1;
  IF v IS DISTINCT FROM ((current_date+20)::timestamp+time '18:00') AT TIME ZONE 'Africa/Lagos' THEN
    RAISE EXCEPTION 'T-U1 agreed time: %', v;
  END IF;

  -- An accepted change (new terms version) moves the timer to the new agreed time.
  UPDATE public.gig_contracts SET current_terms_version=2 WHERE id=c1;
  SELECT state_deadline_at INTO v FROM public.gig_contracts WHERE id=c1;
  IF v IS DISTINCT FROM ((current_date+22)::timestamp+time '12:00') AT TIME ZONE 'Africa/Lagos' THEN
    RAISE EXCEPTION 'T-U2 change moves the timer: %', v;
  END IF;

  -- No agreed time: the old rule stays.
  PERFORM set_config('issue3872.transition', c2::text, true);
  UPDATE public.gig_contracts SET state='script_locked' WHERE id=c2;
  SELECT state_deadline_at INTO v FROM public.gig_contracts WHERE id=c2;
  IF v IS DISTINCT FROM ((current_date+19)::timestamp AT TIME ZONE 'UTC') THEN RAISE EXCEPTION 'T-U3 fallback: %', v; END IF;

  -- Never sooner than 24 hours from the moment the step starts.
  UPDATE public.gig_contracts SET current_terms_version=1, state_deadline_at=NULL WHERE id=c2;  -- no version change: untouched
  SELECT state_deadline_at INTO v FROM public.gig_contracts WHERE id=c2;
  IF v IS NOT NULL THEN RAISE EXCEPTION 'T-U4 only state/terms changes move it: %', v; END IF;
  INSERT INTO public.gig_terms_versions(contract_id,version,fee_minor,booking_fee_minor,currency,deliverables,format_key,post_by,video_due_at,usage_days,shoot_passes,proposed_by,rights_model)
    VALUES (c2,2,10000,1500,'NGN','["1 reel"]'::jsonb,'date_idea',current_date+20,now()+interval '2 hours',90,1,'host','creator_v1_perpetual');
  UPDATE public.gig_contracts SET current_terms_version=2 WHERE id=c2;
  SELECT state_deadline_at INTO v FROM public.gig_contracts WHERE id=c2;
  IF v < now()+interval '23 hours 59 minutes' THEN RAISE EXCEPTION 'T-U5 24 h floor: %', v; END IF;

  -- Posting: a terms change moves the post deadline to the new post_by.
  UPDATE public.gig_contracts SET current_terms_version=2 WHERE id=c3;
  SELECT state_deadline_at INTO v FROM public.gig_contracts WHERE id=c3;
  IF v IS DISTINCT FROM (((current_date+26)::timestamp AT TIME ZONE 'Africa/Lagos')+interval '24 hours') THEN
    RAISE EXCEPTION 'T-U6 posting deadline follows the change: %', v;
  END IF;
END;
$test$;

ROLLBACK;
\echo 'issue #4402 upload deadline follows the agreed due passed'
