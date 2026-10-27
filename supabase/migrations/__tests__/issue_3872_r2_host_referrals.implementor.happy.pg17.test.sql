-- #3872 R2 B4: Host offer/member/link operations, promoter reads, reports,
-- notifications, and least-privilege function boundaries on a full PG17 replay.
-- MINGLA-INVARIANT: I-3872-REFERRAL-WRITES-SERVER-OWNED | issue #3872 | Offers, members and tracking links are mutated only through caller-bound SECURITY DEFINER functions invoked by reviewed edge functions or Ari.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email) VALUES
  ('38724000-0000-4000-8400-000000000001','r2-b4-owner@example.test'),
  ('38724000-0000-4000-8400-000000000002','r2-b4-marketing@example.test'),
  ('38724000-0000-4000-8400-000000000003','r2-b4-promoter@example.test')
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.creator_accounts(id,email) VALUES
  ('38724000-0000-4000-8400-000000000001','r2-b4-owner@example.test')
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.brands(
  id,account_id,name,slug,default_currency,payment_provider,payment_country,
  pricing_region,pricing_currency
) VALUES(
  '38724000-0000-4000-8400-000000000010',
  '38724000-0000-4000-8400-000000000001',
  'R2 B4 brand','r2-b4-brand','USD','stripe','US','US','USD'
);
INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at,invited_at)
VALUES(
  '38724000-0000-4000-8400-000000000010',
  '38724000-0000-4000-8400-000000000002',
  'marketing_manager',now(),now()
);
UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='referrals_enabled';
INSERT INTO public.program_brand_rollouts(brand_id,program,phase)
VALUES('38724000-0000-4000-8400-000000000010','referrals','pilot');

DO $test$
DECLARE v jsonb;
BEGIN
  BEGIN
    PERFORM public.issue_3872_referral_offer_write(
      '38724000-0000-4000-8400-000000000002','create',
      jsonb_build_object(
        'brandId','38724000-0000-4000-8400-000000000010',
        'name','Marketing cash','audience','buyers','scopeKind','brand',
        'rewardKind','cash','shareBps',1000,'currency','USD','status','active',
        'listings','[]'::jsonb,'tiers','[]'::jsonb
      )
    );
    RAISE EXCEPTION 'B4 marketing rank created a cash offer';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='B4 marketing rank created a cash offer' THEN RAISE; END IF;
    IF SQLERRM<>'insufficient_permission' THEN
      RAISE EXCEPTION 'B4 wrong cash permission error: %',SQLERRM;
    END IF;
  END;

  v:=public.issue_3872_referral_offer_write(
    '38724000-0000-4000-8400-000000000001','create',
    jsonb_build_object(
      'brandId','38724000-0000-4000-8400-000000000010',
      'name','Every buyer earns','audience','buyers','scopeKind','brand',
      'rewardKind','cash','shareBps',1000,'budgetMinor',100000,
      'currency','USD','status','active','listings','[]'::jsonb,
      'tiers',jsonb_build_array(jsonb_build_object('minSales',5,'shareBps',1200))
    )
  );
  IF v->>'name'<>'Every buyer earns' OR jsonb_array_length(v->'tiers')<>1 THEN
    RAISE EXCEPTION 'B4 cash offer response drifted: %',v;
  END IF;

  v:=public.issue_3872_referral_offer_write(
    '38724000-0000-4000-8400-000000000002','create',
    jsonb_build_object(
      'brandId','38724000-0000-4000-8400-000000000010',
      'name','Invited advocates','audience','invited','scopeKind','brand',
      'rewardKind','voucher','currency','USD','status','active',
      'voucherTemplate',jsonb_build_object(
        'value_type','percent','value_bps',1000,'expires_days',30
      ),'listings','[]'::jsonb,'tiers','[]'::jsonb
    )
  );
  IF v->>'reward_kind'<>'voucher' THEN
    RAISE EXCEPTION 'B4 marketing voucher offer response drifted: %',v;
  END IF;
END;
$test$;

DO $test$
DECLARE v_offer uuid;v_member jsonb;v_accept jsonb;
BEGIN
  SELECT id INTO v_offer FROM public.referral_offers WHERE name='Invited advocates';
  SELECT * INTO v_member FROM public.issue_3872_referral_member_invite(
    '38724000-0000-4000-8400-000000000002',v_offer,
    jsonb_build_array(jsonb_build_object(
      'email','R2-B4-PROMOTER@EXAMPLE.TEST','displayName','Ada Promoter',
      'tokenHash',repeat('a',64),'linkSlug','b4invite','code','B4ADA'
    )),now()+interval '14 days'
  );
  IF v_member->>'email'<>'r2-b4-promoter@example.test' THEN
    RAISE EXCEPTION 'B4 invite did not normalize the email: %',v_member;
  END IF;
  BEGIN
    PERFORM public.issue_3872_referral_invite_accept(
      '38724000-0000-4000-8400-000000000003','wrong@example.test',repeat('a',64)
    );
    RAISE EXCEPTION 'B4 wrong email accepted an invite';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='B4 wrong email accepted an invite' THEN RAISE; END IF;
    IF SQLERRM<>'invite_email_mismatch' THEN
      RAISE EXCEPTION 'B4 wrong invite mismatch error: %',SQLERRM;
    END IF;
  END;
  v_accept:=public.issue_3872_referral_invite_accept(
    '38724000-0000-4000-8400-000000000003',
    'r2-b4-promoter@example.test',repeat('a',64)
  );
  IF v_accept->>'status'<>'active' THEN
    RAISE EXCEPTION 'B4 invite acceptance drifted: %',v_accept;
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.notification_outbox
    WHERE category_key='business.referral.member_joined'
      AND payload->>'member_id'=v_accept->>'member_id'
  ) THEN
    RAISE EXCEPTION 'B4 member-joined notification was not queued';
  END IF;
END;
$test$;

DO $test$
DECLARE v jsonb;
BEGIN
  v:=public.issue_3872_tracking_link_write(
    '38724000-0000-4000-8400-000000000002','create',
    jsonb_build_object(
      'brandId','38724000-0000-4000-8400-000000000010',
      'label','Newsletter','slug','b4-newsletter'
    )
  );
  IF v->>'label'<>'Newsletter' OR v ? 'member_id' THEN
    RAISE EXCEPTION 'B4 tracking-only link acquired a payee identity: %',v;
  END IF;
END;
$test$;

INSERT INTO public.order_attributions(
  order_kind,order_id,brand_id,source,member_id,offer_id,eligible_minor,
  share_bps,share_minor
)
SELECT
  'ticket','38724000-0000-4000-8400-000000000101',offer.brand_id,'code',
  member.id,offer.id,10000,1000,1000
FROM public.referral_members member
JOIN public.referral_offers offer ON offer.id=member.offer_id
WHERE member.email_norm='r2-b4-promoter@example.test';
INSERT INTO public.payee_shares(
  order_kind,order_id,payee_kind,member_id,payee_user_id,payee_email_norm,
  brand_id,rail,currency,gross_minor,mingla_fee_minor,net_minor,status,release_after
)
SELECT
  attribution.order_kind,attribution.order_id,'referral',member.id,member.user_id,
  member.email_norm,attribution.brand_id,'stripe','USD',1000,50,950,
  'held_until_event',now()+interval '1 day'
FROM public.order_attributions attribution
JOIN public.referral_members member ON member.id=attribution.member_id
WHERE attribution.order_id='38724000-0000-4000-8400-000000000101';

DO $test$
DECLARE v jsonb;v_count integer;v_member jsonb;v_link jsonb;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.notification_outbox
    WHERE category_key='creator.referral.sale'
      AND payload->>'amount_cents'='950'
  ) OR NOT EXISTS(
    SELECT 1 FROM public.notification_outbox
    WHERE category_key='business.referral.sale'
  ) THEN
    RAISE EXCEPTION 'B4 referral-sale notifications were not queued';
  END IF;

  PERFORM set_config('request.jwt.claim.sub','38724000-0000-4000-8400-000000000002',true);
  v:=public.brand_referral_report(
    '38724000-0000-4000-8400-000000000010',now()-interval '1 day',now()+interval '1 day',NULL
  );
  IF (v->>'orders')::integer<>1 OR (v->>'shareMinor')::integer<>950 THEN
    RAISE EXCEPTION 'B4 report multiplied or lost totals: %',v;
  END IF;
  SELECT count(*) INTO v_count FROM public.brand_referral_members(
    '38724000-0000-4000-8400-000000000010',NULL
  );
  IF v_count<>1 THEN RAISE EXCEPTION 'B4 member read returned % rows',v_count; END IF;
  SELECT item INTO v_member FROM public.brand_referral_members(
    '38724000-0000-4000-8400-000000000010',NULL
  ) AS rows(item) LIMIT 1;
  IF NOT (v_member ? 'invited_at') OR jsonb_array_length(v_member->'activity')<>1 THEN
    RAISE EXCEPTION 'B4 promoter detail timeline is incomplete: %',v_member;
  END IF;
  SELECT item INTO v_link FROM public.brand_tracking_links(
    '38724000-0000-4000-8400-000000000010'
  ) AS rows(item) LIMIT 1;
  IF (v_link->>'touch_count')::integer<>0 OR (v_link->>'order_count')::integer<>0 THEN
    RAISE EXCEPTION 'B4 tracking-link stats drifted: %',v_link;
  END IF;

  PERFORM set_config('request.jwt.claim.sub','38724000-0000-4000-8400-000000000003',true);
  SELECT count(*) INTO v_count FROM public.my_promoting_offers();
  IF v_count<>1 THEN RAISE EXCEPTION 'B4 promoter home returned % offers',v_count; END IF;

  IF has_function_privilege('authenticated',
       'public.issue_3872_referral_offer_write(uuid,text,jsonb)','EXECUTE')
     OR has_function_privilege('anon',
       'public.issue_3872_referral_member_invite(uuid,uuid,jsonb,timestamptz)','EXECUTE')
     OR NOT has_function_privilege('authenticated',
       'public.brand_referral_report(uuid,timestamptz,timestamptz,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated',
       'public.brand_tracking_links(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'B4 function ACL boundary drifted';
  END IF;

  SELECT count(*) INTO v_count FROM pg_class
  WHERE oid=ANY(ARRAY[
    'public.referral_offers'::regclass,'public.referral_members'::regclass,
    'public.host_tracking_links'::regclass
  ]) AND relrowsecurity AND relforcerowsecurity;
  IF v_count<>3 THEN RAISE EXCEPTION 'B4 referral tables lost forced RLS'; END IF;
END;
$test$;

ROLLBACK;
\echo 'issue_3872_r2_host_referrals.implementor.happy: all cases passed'
