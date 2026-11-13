\set ON_ERROR_STOP on

-- #4402 polish PR, migration M2 (20280704104402): the minimum creator fee
-- (D2, OQ-7, OQ-8) on the gig budget, offers, counters and interest price;
-- an open interest can change its price (E31); host home reach count (H18).
-- Every fixture rolls back.
--
-- MINGLA-INVARIANT: I-4402-FEE-1 | issue #4402 | no offer, counter, gig budget or interest price below the currency minimum (NGN 500000, USD/EUR/GBP 1000 minor; none for other currencies)

BEGIN;
CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
$$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES
  ('44020200-0000-4000-8000-0000000000a1','i4402f-host@mingla.test'),
  ('44020200-0000-4000-8000-0000000000a3','i4402f-creator@mingla.test');
INSERT INTO public.brands(id,account_id,name,slug,default_currency) VALUES
  ('44020200-0000-4000-8000-0000000000b1','44020200-0000-4000-8000-0000000000a1','Fee Floor Rooftop','i4402f-rooftop','USD');
INSERT INTO public.seeding_cities(id,google_place_id,name,country,country_code,center_lat,center_lng,bbox_sw_lat,bbox_sw_lng,bbox_ne_lat,bbox_ne_lng,is_live_for_consumers) VALUES
  ('44020200-0000-4000-8000-0000000000c1','i4402f-city','Feetown','United States','US',35.7,-78.6,35.6,-78.7,35.8,-78.5,true);
INSERT INTO public.events(id,brand_id,title,slug,status,published_at,timezone) VALUES
  ('44020200-0000-4000-8000-0000000000e1','44020200-0000-4000-8000-0000000000b1','Rooftop Night','i4402f-night','scheduled',now(),'America/New_York');
INSERT INTO public.creator_accounts(id,email,display_name) VALUES
  ('44020200-0000-4000-8000-0000000000a3','i4402f-creator@mingla.test','Ada Films');
INSERT INTO public.creator_profiles(creator_account_id,mode_enabled,display_name,home_city_id,niches,verification,date_of_birth,agreement_version,agreement_signed_at) VALUES
  ('44020200-0000-4000-8000-0000000000a3',true,'Ada Films','44020200-0000-4000-8000-0000000000c1',ARRAY['food'],'verified','1995-01-01','v1',now());
INSERT INTO public.creator_packages(id,creator_account_id,format_key,platforms,price_minor,currency,turnaround_days) VALUES
  ('44020200-0000-4000-8000-0000000000d3','44020200-0000-4000-8000-0000000000a3','date_idea',ARRAY['instagram'],30000,'USD',5);
INSERT INTO public.payee_accounts(user_id,stripe_account_id,stripe_status) VALUES
  ('44020200-0000-4000-8000-0000000000a3','acct_i4402f','active');
INSERT INTO public.gigs(id,brand_id,listing_kind,listing_id,title_public,brief_public,format_key,deliverables,city_id,category,shoot_window_start,shoot_window_end,post_by,pay_up_to_minor,currency,slots,status,created_by) VALUES
  ('44020200-0000-4000-8000-0000000000f1','44020200-0000-4000-8000-0000000000b1','event','44020200-0000-4000-8000-0000000000e1',
   'A rooftop date night','Show a relaxed evening on a rooftop with music, drinks and the view across the city.','date_idea','["1 reel"]'::jsonb,
   '44020200-0000-4000-8000-0000000000c1','nightlife',current_date+1,current_date+20,current_date+30,30000,'USD',3,'open','44020200-0000-4000-8000-0000000000a1'),
  -- The production "$1 per creator" shape: an open gig saved below the minimum.
  ('44020200-0000-4000-8000-0000000000f2','44020200-0000-4000-8000-0000000000b1','event','44020200-0000-4000-8000-0000000000e1',
   'A one dollar test gig','Show a relaxed evening on a rooftop with music, drinks and the view across the city.','date_idea','["1 reel"]'::jsonb,
   '44020200-0000-4000-8000-0000000000c1','nightlife',current_date+1,current_date+20,current_date+30,100,'USD',1,'open','44020200-0000-4000-8000-0000000000a1');
SET LOCAL session_replication_role = origin;
UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'creator_gigs_enabled';

DO $test$
DECLARE
  v_host constant uuid := '44020200-0000-4000-8000-0000000000a1';
  v_creator constant uuid := '44020200-0000-4000-8000-0000000000a3';
  v_gig constant uuid := '44020200-0000-4000-8000-0000000000f1';
  v_pkg constant uuid := '44020200-0000-4000-8000-0000000000d3';
  v_r jsonb; v_payload jsonb; v_int uuid; v_c uuid; v_day date := current_date + 5; v_prop uuid; v_cur text;
BEGIN
  -- The minimum itself (D2) and no minimum elsewhere (OQ-7).
  IF public.issue_4402_gig_min_fee_minor('NGN') <> 500000 OR public.issue_4402_gig_min_fee_minor('usd') <> 1000
     OR public.issue_4402_gig_min_fee_minor('EUR') <> 1000 OR public.issue_4402_gig_min_fee_minor('GBP') <> 1000
     OR public.issue_4402_gig_min_fee_minor('CAD') IS NOT NULL THEN
    RAISE EXCEPTION 'T-M2 minimum table';
  END IF;

  -- gig_save: min-1 refused per currency, min accepted, no-minimum currency accepted.
  PERFORM pg_temp.act(v_host);
  v_payload := jsonb_build_object('brand_id','44020200-0000-4000-8000-0000000000b1','listing_kind','event','listing_id','44020200-0000-4000-8000-0000000000e1',
    'title_public','An evening rooftop reel','brief_public','Show a relaxed evening on a rooftop with music, drinks and the view across the city.',
    'format_key','date_idea','deliverables','[{"platform":"instagram","kind":"reel","count":1}]'::jsonb,'city_id','44020200-0000-4000-8000-0000000000c1',
    'category','experience','shoot_window_start',v_day,'shoot_window_end',v_day,'post_by',v_day+2,
    'video_due_at',to_char(v_day+2,'YYYY-MM-DD')||'T18:30','pay_up_to_minor',999,'currency','USD','slots',1,'status','open');
  FOREACH v_cur IN ARRAY ARRAY['USD','EUR','GBP','NGN'] LOOP
    v_r := public.gig_save(v_payload || jsonb_build_object('currency',v_cur,'pay_up_to_minor',public.issue_4402_gig_min_fee_minor(v_cur)-1));
    IF v_r IS DISTINCT FROM jsonb_build_object('ok',false,'error','fee_below_minimum','field','pay_up_to_minor',
         'min_minor',public.issue_4402_gig_min_fee_minor(v_cur),'currency',v_cur) THEN
      RAISE EXCEPTION 'T-M2 gig_save % below minimum: %', v_cur, v_r;
    END IF;
  END LOOP;
  v_r := public.gig_save(v_payload || jsonb_build_object('pay_up_to_minor',1000));
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'T-M2 gig_save at the minimum: %', v_r; END IF;
  v_r := public.gig_save(v_payload || jsonb_build_object('currency','CAD','pay_up_to_minor',1));
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'T-M2 OQ-7 CAD has no minimum: %', v_r; END IF;
  -- The $1 gig can still be closed.
  SELECT to_jsonb(g) INTO v_r FROM public.gigs g WHERE g.id='44020200-0000-4000-8000-0000000000f2';
  v_r := public.gig_save(v_payload || jsonb_build_object('id','44020200-0000-4000-8000-0000000000f2','pay_up_to_minor',100,'status','closed',
    'title_public','A one dollar test gig'));
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'T-M2 closing a below-minimum gig: %', v_r; END IF;

  -- Interest price (OQ-8) and changing an open interest (E31).
  PERFORM pg_temp.act(v_creator);
  v_r := public.gig_interest_send(v_gig, v_pkg, 999, NULL);
  IF v_r->>'error' IS DISTINCT FROM 'fee_below_minimum' OR v_r->>'field' <> 'quoted_minor' THEN RAISE EXCEPTION 'T-M2 interest below: %', v_r; END IF;
  v_r := public.gig_interest_send(v_gig, v_pkg, 1000, NULL);
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'T-M2 interest at minimum: %', v_r; END IF;
  SELECT id INTO v_int FROM public.gig_interest WHERE gig_id = v_gig AND creator_account_id = v_creator;
  v_r := public.gig_interest_send(v_gig, v_pkg, 25000, 'Happy to shoot at golden hour.');
  IF (v_r->>'updated')::boolean IS DISTINCT FROM true
     OR (SELECT quoted_minor FROM public.gig_interest WHERE id = v_int) <> 25000
     OR (SELECT status FROM public.gig_interest WHERE id = v_int) <> 'sent' THEN
    RAISE EXCEPTION 'T-M2 E31 open interest price change: %', v_r;
  END IF;
  UPDATE public.gig_interest SET status = 'shortlisted' WHERE id = v_int;
  v_r := public.gig_interest_send(v_gig, v_pkg, 20000, NULL);
  IF (SELECT status FROM public.gig_interest WHERE id = v_int) <> 'shortlisted' OR (SELECT quoted_minor FROM public.gig_interest WHERE id = v_int) <> 20000 THEN
    RAISE EXCEPTION 'T-M2 E31 shortlisted keeps status: %', v_r;
  END IF;

  -- Offer prepare: below refused, at the minimum accepted.
  PERFORM pg_temp.act(v_host);
  v_r := public.gig_offer_prepare(v_int, '{"fee_minor":999,"rights_accepted":true}'::jsonb, 'i4402f-offer-low');
  IF v_r->>'error' IS DISTINCT FROM 'fee_below_minimum' OR (v_r->>'min_minor')::bigint <> 1000 THEN RAISE EXCEPTION 'T-M2 offer below: %', v_r; END IF;
  v_r := public.gig_offer_prepare(v_int, '{"fee_minor":1000,"rights_accepted":true}'::jsonb, 'i4402f-offer-ok');
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'T-M2 offer at minimum: %', v_r; END IF;
  v_c := (v_r->>'contract_id')::uuid;
  -- Offered interest cannot be repriced.
  PERFORM pg_temp.act(v_creator);
  v_r := public.gig_interest_send(v_gig, v_pkg, 30000, NULL);
  IF v_r->>'error' IS DISTINCT FROM 'already_interested' THEN RAISE EXCEPTION 'T-M2 offered interest repriced: %', v_r; END IF;

  -- Counters.
  PERFORM pg_temp.act(NULL);
  PERFORM public.gig_hold_set_provider_ref(v_c, 1, 'gig_hold', 'pi_i4402f');
  PERFORM public.gig_hold_mark_captured(v_c, 1, 'pi_i4402f');
  PERFORM pg_temp.act(v_creator);
  v_r := public.gig_counter_send(v_c, 999, NULL);
  IF v_r->>'error' IS DISTINCT FROM 'fee_below_minimum' THEN RAISE EXCEPTION 'T-M2 counter below: %', v_r; END IF;
  v_r := public.gig_counter_send(v_c, 1500, NULL);
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'T-M2 counter above: %', v_r; END IF;
  -- A counter opened before the minimum existed cannot be accepted below it.
  v_prop := (v_r->>'proposal_id')::uuid;
  UPDATE public.gig_change_proposals SET changes = '{"fee_minor":500}'::jsonb WHERE id = v_prop;
  PERFORM pg_temp.act(v_host);
  v_r := public.gig_counter_respond(v_prop, true);
  IF v_r->>'error' IS DISTINCT FROM 'fee_below_minimum' THEN RAISE EXCEPTION 'T-M2 counter respond below: %', v_r; END IF;
  UPDATE public.gig_change_proposals SET changes = '{"fee_minor":1500}'::jsonb WHERE id = v_prop;
  v_r := public.gig_counter_respond(v_prop, true);
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'T-M2 counter respond at/above: %', v_r; END IF;

  -- H18: an aggregate count of verified creators in the gig's city.
  SELECT g INTO v_r FROM jsonb_array_elements(public.gig_host_home('44020200-0000-4000-8000-0000000000b1')->'gigs') g WHERE g->>'id' = v_gig::text;
  IF (v_r->>'verified_creator_count')::int <> 1 OR v_r->>'city_name' <> 'Feetown' OR (v_r->>'min_fee_minor')::bigint <> 1000 THEN
    RAISE EXCEPTION 'T-M2 H18 reach: %', v_r;
  END IF;
END;
$test$;

ROLLBACK;
\echo 'issue #4402 polish M2 (minimum fee, interest edit, reach count) passed'
