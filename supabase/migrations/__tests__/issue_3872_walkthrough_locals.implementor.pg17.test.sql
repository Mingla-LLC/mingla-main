-- #3872 walkthrough (W1 server): Mingla Locals — kill switch on the pick
-- (#3), one conflict source for picker and pick plus review date/social
-- checks (#18), voiding after the payout share exists (#15), and the
-- per-city monthly rate and payout currency.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claim.sub',coalesce(p_user::text,''),true),
         set_config('request.jwt.claims',CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub',p_user,'role','authenticated')::text END,true);
$fn$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES
  ('38723300-0000-4000-8000-0000000000a1','w1lo-local@mingla.test'),
  ('38723300-0000-4000-8000-0000000000a2','w1lo-admin@mingla.test'),
  ('38723300-0000-4000-8000-0000000000a3','w1lo-owner@mingla.test');
INSERT INTO public.admin_users(email,status) VALUES('w1lo-admin@mingla.test','active');
INSERT INTO public.profiles(id,display_name) VALUES('38723300-0000-4000-8000-0000000000a1','Lola Local') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.seeding_cities(id,google_place_id,name,country,center_lat,center_lng,bbox_sw_lat,bbox_sw_lng,bbox_ne_lat,bbox_ne_lng)
VALUES('38723300-0000-4000-8000-0000000000c1','w1lo-city','Lagos','NG',6.5,3.4,6.4,3.3,6.6,3.5);
INSERT INTO public.brands(id,account_id,name,slug) VALUES
  ('38723300-0000-4000-8000-0000000000b1','38723300-0000-4000-8000-0000000000a3','Claimed Grill','w1lo-grill');
INSERT INTO public.place_pool(id,name,lat,lng,city_id,is_active,is_servable) VALUES
  ('38723300-0000-4000-8000-0000000000d1','Claimed Grill',6.5,3.4,'38723300-0000-4000-8000-0000000000c1',true,true),
  ('38723300-0000-4000-8000-0000000000d2','Open Cafe',6.5,3.4,'38723300-0000-4000-8000-0000000000c1',true,true);
INSERT INTO public.venue_listings(id,brand_id,place_pool_id,slug,name,lat,lng,venue_category,claim_status) VALUES
  ('38723300-0000-4000-8000-0000000000e1','38723300-0000-4000-8000-0000000000b1','38723300-0000-4000-8000-0000000000d1','w1logrill','Claimed Grill',6.5,3.4,'restaurant','verified');
INSERT INTO public.locals(id,user_id,city_id,status,agreement_version) VALUES
  ('38723300-0000-4000-8000-000000000101','38723300-0000-4000-8000-0000000000a1','38723300-0000-4000-8000-0000000000c1','active','local-v1');
INSERT INTO public.local_months(id,local_id,month,place_id,status,picked_at,confirmed_at,visited_at) VALUES
  ('38723300-0000-4000-8000-000000000201','38723300-0000-4000-8000-000000000101',date_trunc('month',current_date)::date,'38723300-0000-4000-8000-0000000000d2','visited',now(),now(),now()),
  ('38723300-0000-4000-8000-000000000202','38723300-0000-4000-8000-000000000101',(date_trunc('month',current_date)-interval '1 month')::date,'38723300-0000-4000-8000-0000000000d2','published',now(),now(),now());
-- A recent paid relationship with the claiming brand (not the place author).
INSERT INTO public.payee_shares(id,order_kind,order_id,payee_kind,payee_user_id,brand_id,rail,currency,gross_minor,mingla_fee_minor,net_minor,status,release_after)
VALUES('38723300-0000-4000-8000-000000000301','gig','38723300-0000-4000-8000-000000000999','gig_fee','38723300-0000-4000-8000-0000000000a1','38723300-0000-4000-8000-0000000000b1','paystack','NGN',100,0,100,'paid',now());
INSERT INTO public.fx_rate_snapshots(provider,base_currency_code,provider_updated_at,provider_next_update_at,stale_after,expires_at,payload_sha256,status)
SELECT 'exchange_rate_api_open_v6','USD',now()-interval '1 hour',now()+interval '1 day',now()+interval '1 day',now()+interval '2 days','w1lo-'||md5(random()::text),'active'
WHERE NOT EXISTS(SELECT 1 FROM public.fx_rate_snapshots WHERE status='active');
INSERT INTO public.payee_accounts(user_id,paystack_recipient_code,paystack_status,paystack_currency)
VALUES('38723300-0000-4000-8000-0000000000a1','RCP_w1lo','verified','NGN')
ON CONFLICT(user_id) DO UPDATE SET paystack_recipient_code='RCP_w1lo',paystack_status='verified',paystack_currency='NGN';
SET LOCAL session_replication_role = origin;
-- Written the pre-walkthrough way (USD only); the rate default trigger fills it.
INSERT INTO public.local_city_programs(city_id,seats,is_open,monthly_usd_minor) VALUES('38723300-0000-4000-8000-0000000000c1',3,true,15000);

DO $test$
DECLARE
  v_local constant uuid:='38723300-0000-4000-8000-0000000000a1';
  v_admin constant uuid:='38723300-0000-4000-8000-0000000000a2';
  v_city constant uuid:='38723300-0000-4000-8000-0000000000c1';
  v_r jsonb; v_failed boolean; v_quote jsonb; v_share uuid; v_body text:=repeat('Lovely place, ',30);
BEGIN
  -- #3: the pick honours the global kill switch.
  INSERT INTO public.feature_flags(flag_key,is_enabled,description) VALUES('mingla_locals_enabled',false,'test')
  ON CONFLICT(flag_key) DO UPDATE SET is_enabled=false;
  PERFORM pg_temp.act(v_local);
  v_failed:=false;
  BEGIN PERFORM public.local_pick_place('38723300-0000-4000-8000-0000000000d2',false);
  EXCEPTION WHEN others THEN v_failed:=SQLERRM='locals_not_open'; END;
  IF NOT v_failed THEN RAISE EXCEPTION '#3 pick ignored mingla_locals_enabled'; END IF;
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='mingla_locals_enabled';

  -- #18: the picker shows the claimed place as not eligible, for the same
  -- reason the pick refuses it.
  SELECT e INTO v_r FROM jsonb_array_elements(public.local_place_candidates(NULL)) e WHERE e->>'id'='38723300-0000-4000-8000-0000000000d1';
  IF v_r IS NULL OR (v_r->>'eligible')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION '#18 picker shows a conflicted place eligible: %',v_r; END IF;
  IF public.issue_3872_local_place_conflict('38723300-0000-4000-8000-000000000101','38723300-0000-4000-8000-0000000000d1') IS DISTINCT FROM 'paid_relationship_conflict'
     OR v_r->>'reason_code' IS DISTINCT FROM 'paid_relationship_conflict' THEN
    RAISE EXCEPTION '#18 picker and pick disagree';
  END IF;

  -- #18: visited_on must be inside the Local month.
  v_failed:=false;
  BEGIN PERFORM public.local_review_submit('38723300-0000-4000-8000-000000000201',5,'Great spot',v_body,DATE '2025-01-01','moderate',ARRAY[gen_random_uuid()],'https://www.instagram.com/p/abc',true);
  EXCEPTION WHEN others THEN v_failed:=SQLERRM='visited_on_outside_month'; END;
  IF NOT v_failed THEN RAISE EXCEPTION '#18 visit outside the month accepted'; END IF;
  -- #18: the social post must be on an allowlisted host.
  v_failed:=false;
  BEGIN PERFORM public.local_review_submit('38723300-0000-4000-8000-000000000201',5,'Great spot',v_body,current_date,'moderate',ARRAY[gen_random_uuid()],'https://evil.example.com/post',true);
  EXCEPTION WHEN others THEN v_failed:=SQLERRM='social_post_url_not_allowed'; END;
  IF NOT v_failed THEN RAISE EXCEPTION '#18 non-social post URL accepted'; END IF;

  -- Per-city rate and payout currency (old p_monthly_usd_minor optional).
  PERFORM pg_temp.act(v_admin);
  v_r:=public.local_city_program_save(v_city,3,true,p_monthly_rate_minor=>20000000,p_payout_currency=>'NGN');
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'program save: %',v_r; END IF;
  v_r:=public.local_city_program_save(v_city,3,true,p_monthly_rate_minor=>-1,p_payout_currency=>'NGN');
  IF v_r->>'field' IS DISTINCT FROM 'monthly_rate_minor' THEN RAISE EXCEPTION 'program rate validation: %',v_r; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.admin_local_queue()->'programs') e
     WHERE e->>'city_id'=v_city::text AND (e->>'monthly_rate_minor')::bigint=20000000 AND e->>'payout_currency'='NGN')
     OR NOT (public.admin_local_queue() ? 'picks') THEN
    RAISE EXCEPTION 'admin queue programs/picks';
  END IF;
  PERFORM pg_temp.act(v_local);
  v_r:=public.local_landing();
  IF v_r->>'viewer_city_id' IS DISTINCT FROM v_city::text
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_r->'programs') e WHERE e->>'city_id'=v_city::text AND e->>'payout_currency'='NGN' AND (e->>'monthly_rate_minor')::bigint=20000000) THEN
    RAISE EXCEPTION 'local landing rate: %',v_r;
  END IF;
  PERFORM pg_temp.act(NULL);
  v_quote:=public.local_payout_prepare('38723300-0000-4000-8000-000000000202');
  IF v_quote->>'currency'<>'NGN' OR v_quote->>'rail'<>'paystack' OR (v_quote->>'amount_minor')::bigint<>20000000 THEN
    RAISE EXCEPTION 'payout uses the city rate/currency: %',v_quote;
  END IF;
  v_r:=public.local_payout_record('38723300-0000-4000-8000-000000000202',v_quote->>'rail',v_quote->>'currency',(v_quote->>'amount_minor')::bigint,(v_quote->>'fx_snapshot_id')::uuid);
  v_share:=(v_r->>'share_id')::uuid;

  -- #15: voiding the month reverses its still-unpaid share.
  PERFORM pg_temp.act(v_admin);
  PERFORM public.local_month_void('38723300-0000-4000-8000-000000000202','Undisclosed relationship found');
  IF (SELECT status FROM public.payee_shares WHERE id=v_share)<>'reversed' THEN
    RAISE EXCEPTION '#15 voided Local month kept a releasable share';
  END IF;
END;
$test$;

ROLLBACK;
