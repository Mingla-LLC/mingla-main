-- #3872 R2 B5: buyer links, safe public attribution, wallet lifecycle totals,
-- guest-email claims, and the no-balance/no-withdrawal boundary on PostgreSQL 17.
-- MINGLA-INVARIANT: I-3872-EARNINGS-IS-NOT-BALANCE | issue #3872 | Explorer reports immutable reward obligations by lifecycle state; no stored-value balance or withdrawal RPC exists.
-- MINGLA-INVARIANT: I-3872-SHARER-ALLOWLIST | issue #3872 | Public share attribution exposes only the sharer's first name and avatar after an explicit show_sharer choice.
-- MINGLA-INVARIANT: I-3872-CLAIM-EMAIL-MATCH | issue #3872 | Guest rewards can be claimed only by an authenticated user whose normalized auth email equals the hashed claim token's email.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email) VALUES
  ('38725000-0000-4000-8400-000000000001','r2-b5-owner@example.test'),
  ('38725000-0000-4000-8400-000000000002','r2-b5-guest@example.test')
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.profiles(
  id,email,first_name,last_name,display_name,username,active,
  has_completed_onboarding,visibility_mode,avatar_url
) VALUES
  ('38725000-0000-4000-8400-000000000001','r2-b5-owner@example.test',
   'Ada','Explorer','Ada Explorer','r2-b5-owner',true,true,'public',
   'https://cdn.example.test/ada.jpg'),
  ('38725000-0000-4000-8400-000000000002','r2-b5-guest@example.test',
   'Guest','Explorer','Guest Explorer','r2-b5-guest',true,true,'public',NULL)
ON CONFLICT(id) DO UPDATE SET
  first_name=excluded.first_name,display_name=excluded.display_name,
  avatar_url=excluded.avatar_url;
INSERT INTO public.creator_accounts(id,email) VALUES
  ('38725000-0000-4000-8400-000000000001','r2-b5-owner@example.test')
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.brands(
  id,account_id,name,slug,default_currency,payment_provider,payment_country,
  pricing_region,pricing_currency
) VALUES(
  '38725000-0000-4000-8400-000000000010',
  '38725000-0000-4000-8400-000000000001',
  'R2 B5 brand','r2-b5-brand','USD','stripe','US','US','USD'
);
INSERT INTO public.events(
  id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
) VALUES(
  '38725000-0000-4000-8400-000000000020',
  '38725000-0000-4000-8400-000000000010',
  '38725000-0000-4000-8400-000000000001',
  'R2 B5 event','r2-b5-event','event','scheduled','public','UTC','USD'
);
UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='referrals_enabled';
INSERT INTO public.program_brand_rollouts(brand_id,program,phase)
VALUES('38725000-0000-4000-8400-000000000010','referrals','pilot');
INSERT INTO public.referral_offers(
  id,brand_id,name,audience,scope_kind,reward_kind,share_bps,budget_minor,
  currency,starts_at,status,buyer_discount_id,created_by
) VALUES(
  '38725000-0000-4000-8400-000000000030',
  '38725000-0000-4000-8400-000000000010','R2 B5 buyer offer','both','brand',
  'cash',1000,100000,'USD','2026-01-01T00:00:00Z','active',NULL,
  '38725000-0000-4000-8400-000000000001'
);

DO $test$
DECLARE v_link jsonb;v_landing jsonb;v_member uuid;
BEGIN
  v_link:=public.issue_3872_buyer_referral_link(
    '38725000-0000-4000-8400-000000000001','R2-B5-OWNER@EXAMPLE.TEST',
    'Ada Explorer','event','38725000-0000-4000-8400-000000000020','b5buyer1'
  );
  IF v_link->>'url'<>'https://usemingla.com/r/b5buyer1?kind=event&id=38725000-0000-4000-8400-000000000020'
     OR v_link->>'brandName'<>'R2 B5 brand' THEN
    RAISE EXCEPTION 'B5 personal earning link drifted: %',v_link;
  END IF;
  SELECT id INTO v_member FROM public.referral_members WHERE link_slug='b5buyer1';
  IF public.issue_3872_buyer_referral_link(
    '38725000-0000-4000-8400-000000000001','r2-b5-owner@example.test',
    'Ada Explorer','event','38725000-0000-4000-8400-000000000020','ignore00'
  )->>'memberId'<>v_member::text THEN
    RAISE EXCEPTION 'B5 buyer-link replay created a second member';
  END IF;
  v_landing:=public.public_referral_landing(
    'b5buyer1','event','38725000-0000-4000-8400-000000000020'
  );
  IF v_landing->>'firstName'<>'Ada'
     OR v_landing->>'avatarUrl'<>'https://cdn.example.test/ada.jpg'
     OR v_landing->>'destinationUrl'<>'https://host.usemingla.com/e/r2-b5-brand/r2-b5-event'
     OR (SELECT count(*) FROM jsonb_object_keys(v_landing))<>7 THEN
    RAISE EXCEPTION 'B5 public landing allowlist/destination drifted: %',v_landing;
  END IF;
END;
$test$;

INSERT INTO public.content_share_links(
  id,short_code,entity_kind,creator_principal,source_key,source_reference
) VALUES(
  '38725000-0000-4000-8400-000000000040','Aa0Bb1Cc2Dd3Ee4F','event',
  '38725000-0000-4000-8400-000000000001','event:r2-b5',
  '{"eventId":"38725000-0000-4000-8400-000000000020"}'::jsonb
);
DO $test$
DECLARE v jsonb;
BEGIN
  IF public.public_content_share_sharer('Aa0Bb1Cc2Dd3Ee4F') IS NOT NULL THEN
    RAISE EXCEPTION 'B5 sharer identity was public before opt-in';
  END IF;
  PERFORM public.issue_3872_mark_content_share_sharer(
    '38725000-0000-4000-8400-000000000001',
    '38725000-0000-4000-8400-000000000040',true
  );
  v:=public.public_content_share_sharer('Aa0Bb1Cc2Dd3Ee4F');
  IF v->>'first_name'<>'Ada' OR v->>'avatar_url'<>'https://cdn.example.test/ada.jpg'
     OR (SELECT count(*) FROM jsonb_object_keys(v))<>2 THEN
    RAISE EXCEPTION 'B5 public share identity exceeded its two-field allowlist: %',v;
  END IF;
END;
$test$;

-- One owned reward powers the wallet; one guest reward and voucher are claimed
-- atomically after exact auth-email proof.
INSERT INTO public.referral_members(
  id,offer_id,brand_id,role,user_id,email_norm,display_name,link_slug,code,status,
  last_listing_kind,last_listing_id
) VALUES(
  '38725000-0000-4000-8400-000000000051',
  '38725000-0000-4000-8400-000000000030',
  '38725000-0000-4000-8400-000000000010','buyer',NULL,
  'r2-b5-guest@example.test','Guest Explorer','b5guest1','B5GUEST','active',
  'event','38725000-0000-4000-8400-000000000020'
);
INSERT INTO public.order_attributions(
  order_kind,order_id,brand_id,source,member_id,offer_id,eligible_minor,
  share_bps,share_minor
) SELECT 'ticket','38725000-0000-4000-8400-000000000061',brand_id,'code',id,
  offer_id,10000,1000,1000 FROM public.referral_members WHERE link_slug='b5buyer1';
INSERT INTO public.order_attributions(
  order_kind,order_id,brand_id,source,member_id,offer_id,eligible_minor,
  share_bps,share_minor
) VALUES(
  'ticket','38725000-0000-4000-8400-000000000062',
  '38725000-0000-4000-8400-000000000010','code',
  '38725000-0000-4000-8400-000000000051',
  '38725000-0000-4000-8400-000000000030',10000,1000,1000
);
INSERT INTO public.payee_shares(
  order_kind,order_id,payee_kind,member_id,payee_user_id,payee_email_norm,
  brand_id,rail,currency,gross_minor,mingla_fee_minor,net_minor,status,release_after
) SELECT 'ticket','38725000-0000-4000-8400-000000000061','referral',id,user_id,
  email_norm,brand_id,'stripe','USD',1000,50,950,'held_until_event',now()+interval '1 day'
  FROM public.referral_members WHERE link_slug='b5buyer1';
INSERT INTO public.payee_shares(
  order_kind,order_id,payee_kind,member_id,payee_email_norm,brand_id,rail,currency,
  gross_minor,mingla_fee_minor,net_minor,status,release_after
) VALUES(
  'ticket','38725000-0000-4000-8400-000000000062','referral',
  '38725000-0000-4000-8400-000000000051','r2-b5-guest@example.test',
  '38725000-0000-4000-8400-000000000010','stripe','USD',1000,50,950,
  'held_until_event',now()+interval '1 day'
);
INSERT INTO public.brand_discounts(
  id,brand_id,kind,code,name,value_type,value_bps,scope_kind,combines_with,
  starts_at,ends_at,max_total_uses,max_uses_per_buyer,status,source,source_ref,created_by
) VALUES(
  '38725000-0000-4000-8400-000000000070',
  '38725000-0000-4000-8400-000000000010','voucher','B5CLAIM','Guest voucher',
  'percent',1000,'brand','automatic_only',now(),now()+interval '30 days',1,1,
  'active','referral','38725000-0000-4000-8400-000000000030',
  '38725000-0000-4000-8400-000000000001'
);
INSERT INTO public.discount_grants(
  id,brand_id,discount_id,member_id,grantee_email_norm,origin_order_kind,
  origin_order_id,expires_at
) VALUES(
  '38725000-0000-4000-8400-000000000071',
  '38725000-0000-4000-8400-000000000010',
  '38725000-0000-4000-8400-000000000070',
  '38725000-0000-4000-8400-000000000051','r2-b5-guest@example.test',
  'ticket','38725000-0000-4000-8400-000000000062',now()+interval '30 days'
);
INSERT INTO public.payee_accounts(user_id,stripe_account_id,stripe_status)
VALUES('38725000-0000-4000-8400-000000000001','acct_r2b5','active');

DO $test$
DECLARE v jsonb;v_claim jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','38725000-0000-4000-8400-000000000001',true);
  v:=public.issue_3872_my_earnings_summary();
  IF v#>>'{totals,USD,onWayMinor}'<>'950'
     OR jsonb_array_length(v->'shares')<>1
     OR jsonb_array_length(v->'links')<>1
     OR v#>>'{payoutAccount,stripe,status}'<>'active'
     OR v ? 'balance' OR v ? 'withdrawal' OR v::text ~* 'cash.?out' THEN
    RAISE EXCEPTION 'B5 wallet/no-balance contract drifted: %',v;
  END IF;

  PERFORM public.issue_3872_create_payee_claim_token(
    'r2-b5-guest@example.test',repeat('c',64),now()+interval '1 day'
  );
  BEGIN
    PERFORM public.issue_3872_claim_guest_earnings(
      '38725000-0000-4000-8400-000000000001','r2-b5-owner@example.test',repeat('c',64)
    );
    RAISE EXCEPTION 'B5 wrong email claimed guest rewards';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='B5 wrong email claimed guest rewards' THEN RAISE; END IF;
    IF SQLERRM<>'claim_not_found' AND SQLERRM<>'claim_email_mismatch' THEN
      RAISE EXCEPTION 'B5 wrong email failure drifted: %',SQLERRM;
    END IF;
  END;
  v_claim:=public.issue_3872_claim_guest_earnings(
    '38725000-0000-4000-8400-000000000002','r2-b5-guest@example.test',repeat('c',64)
  );
  IF v_claim<>jsonb_build_object(
      'membersClaimed',1,'sharesClaimed',1,'vouchersClaimed',1
    ) OR NOT EXISTS(
      SELECT 1 FROM public.payee_claim_tokens WHERE token_hash=repeat('c',64)
        AND consumed_at IS NOT NULL AND claimed_by='38725000-0000-4000-8400-000000000002'
    ) THEN RAISE EXCEPTION 'B5 atomic guest claim drifted: %',v_claim; END IF;

  IF has_function_privilege('anon','public.issue_3872_my_earnings_summary()','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.issue_3872_claim_guest_earnings(uuid,text,text)','EXECUTE')
     OR NOT has_function_privilege('anon',
       'public.public_referral_landing(text,text,uuid)','EXECUTE')
     OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
       WHERE oid='public.payee_claim_tokens'::regclass) THEN
    RAISE EXCEPTION 'B5 ACL/RLS boundary drifted';
  END IF;
END;
$test$;

ROLLBACK;
\echo 'issue_3872_r2_buyer_referrals.implementor.happy: all cases passed'
