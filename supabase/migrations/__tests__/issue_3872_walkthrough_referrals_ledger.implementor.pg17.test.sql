-- #3872 walkthrough (W1 server): referral offer JSON nulls (#4), public names
-- never from email (#16), self-referral backstop (#20), frozen payee shares
-- (#17), every payee kind in the admin ledger (#14) and the creator earnings
-- summary (On the way / Ready / Paid).
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claim.sub',coalesce(p_user::text,''),true),
         set_config('request.jwt.claims',CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub',p_user,'role','authenticated')::text END,true);
$fn$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES
  ('38723200-0000-4000-8000-0000000000a1','w1rf-host@mingla.test'),
  ('38723200-0000-4000-8000-0000000000a2','ada.lovelace@mingla.test'),
  ('38723200-0000-4000-8000-0000000000a3','w1rf-buyer@mingla.test'),
  ('38723200-0000-4000-8000-0000000000a4','w1rf-creator@mingla.test'),
  ('38723200-0000-4000-8000-0000000000a5','w1rf-admin@mingla.test');
INSERT INTO public.admin_users(email,status) VALUES('w1rf-admin@mingla.test','active');
INSERT INTO public.brands(id,account_id,name,slug) VALUES
  ('38723200-0000-4000-8000-0000000000b1','38723200-0000-4000-8000-0000000000a1','Referral Rooftop','w1rf-rooftop');
INSERT INTO public.events(id,brand_id,title,slug) VALUES
  ('38723200-0000-4000-8000-0000000000e1','38723200-0000-4000-8000-0000000000b1','Rooftop Night','w1rf-night');
INSERT INTO public.seeding_cities(id,google_place_id,name,country,center_lat,center_lng,bbox_sw_lat,bbox_sw_lng,bbox_ne_lat,bbox_ne_lng)
VALUES('38723200-0000-4000-8000-0000000000c1','w1rf-city','Durham','US',36,-78.9,35.9,-79,36.1,-78.8);
INSERT INTO public.creator_accounts(id,email,display_name) VALUES('38723200-0000-4000-8000-0000000000a4','w1rf-creator@mingla.test','Cy Reels');
INSERT INTO public.creator_profiles(creator_account_id,mode_enabled,display_name,verification) VALUES('38723200-0000-4000-8000-0000000000a4',true,'Cy Reels','verified');
INSERT INTO public.gigs(id,brand_id,listing_kind,listing_id,title_public,brief_public,format_key,deliverables,city_id,category,shoot_window_start,shoot_window_end,post_by,budget_band,currency,status,created_by)
VALUES('38723200-0000-4000-8000-0000000000f1','38723200-0000-4000-8000-0000000000b1','event','38723200-0000-4000-8000-0000000000e1',
  'Rooftop night reel','A short reel that shows the rooftop at night with music and the city skyline behind.','date_idea','["1 reel"]'::jsonb,
  '38723200-0000-4000-8000-0000000000c1','nightlife',current_date,current_date+5,current_date+9,'b1','USD','open','38723200-0000-4000-8000-0000000000a1'),
  ('38723200-0000-4000-8000-0000000000f2','38723200-0000-4000-8000-0000000000b1','event','38723200-0000-4000-8000-0000000000e1',
  'Rooftop brunch reel','A short reel that shows the rooftop brunch with music and the city skyline behind.','date_idea','["1 reel"]'::jsonb,
  '38723200-0000-4000-8000-0000000000c1','food',current_date,current_date+5,current_date+9,'b1','USD','open','38723200-0000-4000-8000-0000000000a1');
INSERT INTO public.gig_contracts(id,gig_id,brand_id,creator_account_id,state) VALUES
  ('38723200-0000-4000-8000-000000000201','38723200-0000-4000-8000-0000000000f1','38723200-0000-4000-8000-0000000000b1','38723200-0000-4000-8000-0000000000a4','released'),
  ('38723200-0000-4000-8000-000000000202','38723200-0000-4000-8000-0000000000f2','38723200-0000-4000-8000-0000000000b1','38723200-0000-4000-8000-0000000000a4','script_locked');
INSERT INTO public.gig_terms_versions(contract_id,version,fee_minor,booking_fee_minor,currency,format_key,deliverables,post_by,usage_days,shoot_passes,proposed_by) VALUES
  ('38723200-0000-4000-8000-000000000201',1,20000,3000,'USD','date_idea','["1 reel"]'::jsonb,current_date+9,90,1,'host'),
  ('38723200-0000-4000-8000-000000000202',1,15000,2250,'USD','date_idea','["1 reel"]'::jsonb,current_date+9,90,1,'host');
INSERT INTO public.gig_holds(contract_id,terms_version,rail,amount_minor,currency,status,idempotency_key,provider_ref,captured_at) VALUES
  ('38723200-0000-4000-8000-000000000202',1,'stripe',17250,'USD','captured','w1rf-hold-2','pi_w1rf_2',now());
INSERT INTO public.orders(id,event_id,buyer_user_id,buyer_email,buyer_phone_e164) VALUES
  ('38723200-0000-4000-8000-000000000301','38723200-0000-4000-8000-0000000000e1','38723200-0000-4000-8000-0000000000a2','ada.lovelace@mingla.test','+19195550101'),
  ('38723200-0000-4000-8000-000000000302','38723200-0000-4000-8000-0000000000e1','38723200-0000-4000-8000-0000000000a3','w1rf-buyer@mingla.test','+19195550102');
SET LOCAL session_replication_role = origin;

INSERT INTO public.feature_flags(flag_key,is_enabled,description) VALUES('referrals_enabled',true,'test')
ON CONFLICT(flag_key) DO UPDATE SET is_enabled=true;
INSERT INTO public.program_brand_rollouts(brand_id,program,phase) VALUES('38723200-0000-4000-8000-0000000000b1','referrals','pilot')
ON CONFLICT DO NOTHING;

DO $test$
DECLARE
  v_host constant uuid:='38723200-0000-4000-8000-0000000000a1';
  v_promoter constant uuid:='38723200-0000-4000-8000-0000000000a2';
  v_creator constant uuid:='38723200-0000-4000-8000-0000000000a4';
  v_admin constant uuid:='38723200-0000-4000-8000-0000000000a5';
  v_brand constant uuid:='38723200-0000-4000-8000-0000000000b1';
  v_offer jsonb; v_offer_id uuid; v_member uuid:='38723200-0000-4000-8000-000000000401';
  v_snapshot jsonb; v_r jsonb; v_name text; v_failed boolean; v_row jsonb;
BEGIN
  -- #4: voucherTemplate:null on a cash offer is SQL NULL, so it saves.
  v_offer:=public.issue_3872_referral_offer_write(v_host,'create',jsonb_build_object(
    'brandId',v_brand,'name','Friends of the roof','audience','invited','scopeKind','brand','rewardKind','cash',
    'shareBps',1000,'voucherTemplate',NULL,'perkText',NULL,'perkThreshold',NULL,'currency','usd','listings',NULL,'tiers',NULL));
  v_offer_id:=(v_offer->>'id')::uuid;
  IF v_offer_id IS NULL OR v_offer->'voucher_template' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION '#4 cash offer: %',v_offer; END IF;
  -- #4: perk offers too.
  v_r:=public.issue_3872_referral_offer_write(v_host,'create',jsonb_build_object(
    'brandId',v_brand,'name','Perk draft','audience','buyers','scopeKind','brand','rewardKind','perk',
    'voucherTemplate',NULL,'shareBps',NULL,'perkText','Free drink','perkThreshold',3,'currency','USD','status','draft'));
  IF v_r->>'reward_kind'<>'perk' THEN RAISE EXCEPTION '#4 perk offer: %',v_r; END IF;
  -- #4: an update with JSON nulls keeps working.
  v_r:=public.issue_3872_referral_offer_write(v_host,'update',jsonb_build_object(
    'id',v_offer_id,'brandId',v_brand,'version',(v_offer->>'version')::integer,'name','Friends of the roof','audience','invited','scopeKind','brand',
    'rewardKind','cash','shareBps',1200,'voucherTemplate',NULL,'currency','USD','listings',NULL,'tiers',NULL));
  IF (v_r->>'share_bps')::integer<>1200 THEN RAISE EXCEPTION '#4 update: %',v_r; END IF;

  -- #16: an invite stored with the email-derived default name never shows it.
  INSERT INTO public.referral_members(id,offer_id,brand_id,role,user_id,email_norm,display_name,link_slug,status,joined_at)
  VALUES(v_member,v_offer_id,v_brand,'promoter',v_promoter,'ada.lovelace@mingla.test','ada.lovelace','w1rfslug','active',now());
  SELECT member_first_name INTO v_name FROM public.referral_link_resolve('w1rfslug');
  IF v_name IS NOT NULL THEN RAISE EXCEPTION '#16 public name derived from email: %',v_name; END IF;
  UPDATE public.referral_members SET display_name='Ada Lovelace' WHERE id=v_member;
  SELECT member_first_name INTO v_name FROM public.referral_link_resolve('w1rfslug');
  IF v_name IS DISTINCT FROM 'Ada' THEN RAISE EXCEPTION '#16 member-set name missing: %',v_name; END IF;
  UPDATE public.referral_offers SET status='paused',paused_reason='host' WHERE id=v_offer_id;
  SELECT member_first_name INTO v_name FROM public.referral_link_resolve('w1rfslug');
  IF v_name IS NOT NULL THEN RAISE EXCEPTION '#16 name shown for inactive offer'; END IF;
  UPDATE public.referral_offers SET status='active',paused_reason=NULL WHERE id=v_offer_id;

  -- #20: the promoter buying through their own code earns nothing.
  v_snapshot:=jsonb_build_object('version','1','orderKind','ticket','source','code','listingKind','event',
    'listingId','38723200-0000-4000-8000-0000000000e1','rail','stripe','currency','USD','eligibleMinor','10000','shareMinor','1200',
    'shareBps',1200,'rewardKind','cash','rejectedReason',NULL,'touchId',NULL,'memberId',v_member,'trackingId',NULL,
    'offerId',v_offer_id,'payeeUserId',v_promoter,'payeeEmailNorm',NULL);
  PERFORM pg_temp.act(NULL);
  PERFORM public.issue_3872_finalize_referral_attribution('ticket','38723200-0000-4000-8000-000000000301',v_brand,v_snapshot,now()+interval '1 day');
  IF EXISTS(SELECT 1 FROM public.payee_shares WHERE order_kind='ticket' AND order_id='38723200-0000-4000-8000-000000000301') THEN
    RAISE EXCEPTION '#20 self-referral created a payee share';
  END IF;
  IF (SELECT rejected_reason FROM public.order_attributions WHERE order_kind='ticket' AND order_id='38723200-0000-4000-8000-000000000301') IS DISTINCT FROM 'self_referral' THEN
    RAISE EXCEPTION '#20 self-referral not recorded';
  END IF;
  -- A different buyer still earns the promoter a share.
  PERFORM public.issue_3872_finalize_referral_attribution('ticket','38723200-0000-4000-8000-000000000302',v_brand,v_snapshot,now()+interval '1 day');
  IF NOT EXISTS(SELECT 1 FROM public.payee_shares WHERE order_kind='ticket' AND order_id='38723200-0000-4000-8000-000000000302') THEN
    RAISE EXCEPTION 'genuine referral lost its share';
  END IF;

  -- #17: no direct writes, and money/identity columns are frozen.
  IF has_table_privilege('service_role','public.payee_shares','update') OR has_table_privilege('service_role','public.payee_shares','insert') THEN
    RAISE EXCEPTION '#17 service_role can still write payee_shares';
  END IF;
  v_failed:=false;
  BEGIN UPDATE public.payee_shares SET currency='EUR' WHERE order_id='38723200-0000-4000-8000-000000000302';
  EXCEPTION WHEN others THEN v_failed:=SQLERRM='payee_share_frozen'; END;
  IF NOT v_failed THEN RAISE EXCEPTION '#17 share currency changed'; END IF;

  -- #14: gig fee shares appear in the admin ledger with a payee name.
  INSERT INTO public.payee_shares(order_kind,order_id,payee_kind,payee_user_id,brand_id,rail,currency,gross_minor,mingla_fee_minor,net_minor,status,release_after)
  VALUES('gig','38723200-0000-4000-8000-000000000201','gig_fee',v_creator,v_brand,'stripe','USD',20000,0,20000,'releasable',now());
  PERFORM pg_temp.act(v_admin);
  v_r:=public.admin_list_payee_ledger(NULL,NULL,NULL,50,0,'gig_fee');
  SELECT e INTO v_row FROM jsonb_array_elements(v_r->'rows') e WHERE e->>'order_id'='38723200-0000-4000-8000-000000000201';
  IF v_row IS NULL OR v_row->>'payee_kind'<>'gig_fee' OR v_row->>'payee_name'<>'Cy Reels' OR v_row->>'rail'<>'stripe' THEN
    RAISE EXCEPTION '#14 gig share missing from ledger: %',v_r;
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_r->'rows') e WHERE e->>'payee_kind'<>'gig_fee') THEN RAISE EXCEPTION 'kind filter ignored'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.admin_list_payee_ledger('Referral Rooftop',NULL,NULL,50,0,NULL)->'rows') e WHERE e->>'payee_kind'='referral') THEN
    RAISE EXCEPTION 'referral shares lost from the ledger';
  END IF;

  -- Earnings: the released fee is Ready, the in-progress captured fee is On the way.
  PERFORM pg_temp.act(v_creator);
  v_r:=public.creator_earnings_summary();
  IF v_r->>'currency'<>'USD' OR (v_r->>'ready_minor')::bigint<>20000 OR (v_r->>'on_the_way_minor')::bigint<>15000
     OR (v_r->>'paid_minor')::bigint<>0 OR jsonb_array_length(v_r->'rows')<>2 THEN
    RAISE EXCEPTION 'earnings summary: %',v_r;
  END IF;
  -- Only the caller's own money.
  PERFORM pg_temp.act(v_promoter);
  v_r:=public.creator_earnings_summary();
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_r->'rows') e WHERE e->>'kind'<>'referral') THEN RAISE EXCEPTION 'earnings leaked other kinds: %',v_r; END IF;
END;
$test$;

ROLLBACK;
