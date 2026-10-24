-- #3872 R2 B2: immutable D8 snapshot, one-payee finalization, voucher fallback,
-- public link routing, and durable 60/min touch throttling.
-- MINGLA-INVARIANT: I-3872-SNAPSHOT | issue #3872 | A checkout snapshot is set once and order attribution is append-only.
-- MINGLA-INVARIANT: I-3872-ONE-PAYEE | issue #3872 | One order can materialize no more than one referral payee share.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email) VALUES
  ('38727000-0000-4000-8400-000000000001','r2-b2-owner@example.test'),
  ('38727000-0000-4000-8400-000000000002','r2-b2-payee@example.test')
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.creator_accounts(id,email) VALUES
  ('38727000-0000-4000-8400-000000000001','r2-b2-owner@example.test')
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.brands(
  id,account_id,name,slug,default_currency,payment_provider,payment_country,
  pricing_region,pricing_currency
) VALUES(
  '38727000-0000-4000-8400-000000000010',
  '38727000-0000-4000-8400-000000000001',
  'R2 B2 brand','r2-b2-brand','USD','stripe','US','US','USD'
);
INSERT INTO public.events(
  id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
) VALUES(
  '38727000-0000-4000-8400-000000000020',
  '38727000-0000-4000-8400-000000000010',
  '38727000-0000-4000-8400-000000000001',
  'R2 B2 event','r2-b2-event','event','scheduled','public','UTC','USD'
);
INSERT INTO public.event_dates(id,event_id,start_at,end_at,timezone,is_master)
VALUES(
  '38727000-0000-4000-8400-000000000021',
  '38727000-0000-4000-8400-000000000020',
  '2026-11-01T18:00:00Z','2026-11-01T20:00:00Z','UTC',true
);

UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='referrals_enabled';
INSERT INTO public.program_brand_rollouts(brand_id,program,phase)
VALUES('38727000-0000-4000-8400-000000000010','referrals','pilot');

INSERT INTO public.referral_offers(
  id,brand_id,name,audience,scope_kind,reward_kind,share_bps,voucher_template,
  budget_minor,currency,starts_at,status,created_by
) VALUES(
  '38727000-0000-4000-8400-000000000030',
  '38727000-0000-4000-8400-000000000010',
  'R2 B2 offer','both','brand','cash',1000,
  '{"value_type":"amount","value_minor":500,"expires_days":30,"scope":"brand"}'::jsonb,
  100000,'USD','2026-01-01T00:00:00Z','active',
  '38727000-0000-4000-8400-000000000001'
);
INSERT INTO public.referral_members(
  id,offer_id,brand_id,role,user_id,email_norm,display_name,link_slug,code,status
) VALUES(
  '38727000-0000-4000-8400-000000000040',
  '38727000-0000-4000-8400-000000000030',
  '38727000-0000-4000-8400-000000000010','promoter',
  '38727000-0000-4000-8400-000000000002','r2-b2-payee@example.test',
  'Amara Payee','r2b2m001','FRIEND1','active'
);
INSERT INTO public.host_tracking_links(
  id,brand_id,listing_kind,listing_id,label,slug,created_by
) VALUES(
  '38727000-0000-4000-8400-000000000050',
  '38727000-0000-4000-8400-000000000010','event',
  '38727000-0000-4000-8400-000000000020','Instagram','r2-b2-instagram',
  '38727000-0000-4000-8400-000000000001'
);
INSERT INTO public.attribution_touches(
  id,kind,member_id,brand_id,listing_kind,listing_id,visitor_key,surface,
  touched_at,expires_at
) VALUES(
  '38727000-0000-4000-8400-000000000060','member',
  '38727000-0000-4000-8400-000000000040',
  '38727000-0000-4000-8400-000000000010','event',
  '38727000-0000-4000-8400-000000000020',repeat('a',64),'web',
  '2026-10-24T12:00:00Z','2026-11-23T12:00:00Z'
);

DO $test$
DECLARE
  v_snapshot jsonb := jsonb_build_object(
    'version',1,'source','member_link',
    'touchId','38727000-0000-4000-8400-000000000060',
    'memberId','38727000-0000-4000-8400-000000000040',
    'trackingId','38727000-0000-4000-8400-000000000050',
    'offerId','38727000-0000-4000-8400-000000000030',
    'rejectedReason',NULL,'eligibleMinor',10000,'shareBps',1000,'shareMinor',1000,
    'rewardKind','cash','voucherTemplate',NULL,
    'payeeUserId','38727000-0000-4000-8400-000000000002',
    'payeeEmailNorm','r2-b2-payee@example.test','rail','stripe','currency','USD',
    'listingKind','event','listingId','38727000-0000-4000-8400-000000000020',
    'orderKind','ticket'
  );
  v_order uuid := '38727000-0000-4000-8400-000000000070';
  v_raised boolean := false;
  v_name text;
BEGIN
  IF NOT public.issue_3872_referral_snapshot_valid(v_snapshot,'ticket') THEN
    RAISE EXCEPTION 'B2 valid snapshot was rejected';
  END IF;
  IF public.issue_3872_referral_snapshot_valid(
    jsonb_set(v_snapshot,'{shareMinor}','1.5'::jsonb),'ticket'
  ) THEN
    RAISE EXCEPTION 'B2 fractional share was accepted';
  END IF;

  SELECT member_first_name INTO v_name
  FROM public.referral_link_resolve('R2B2M001');
  IF v_name IS DISTINCT FROM 'Amara' THEN
    RAISE EXCEPTION 'B2 public personal link did not resolve safe first name: %',v_name;
  END IF;

  PERFORM public.issue_3872_finalize_referral_attribution(
    'ticket',v_order,'38727000-0000-4000-8400-000000000010',v_snapshot,
    '2026-11-02T20:00:00Z'
  );
  -- Idempotent replay cannot duplicate the immutable snapshot or its payee.
  PERFORM public.issue_3872_finalize_referral_attribution(
    'ticket',v_order,'38727000-0000-4000-8400-000000000010',v_snapshot,
    '2026-11-02T20:00:00Z'
  );
  IF (SELECT count(*) FROM public.order_attributions
      WHERE order_kind='ticket' AND order_id=v_order)<>1
     OR (SELECT count(*) FROM public.payee_shares
         WHERE order_kind='ticket' AND order_id=v_order)<>1 THEN
    RAISE EXCEPTION 'B2 replay duplicated order attribution/payee share';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.order_attributions
    WHERE order_kind='ticket' AND order_id=v_order
      AND source='member_link' AND tracking_id='38727000-0000-4000-8400-000000000050'
      AND eligible_minor=10000 AND share_bps=1000 AND share_minor=1000
  ) THEN
    RAISE EXCEPTION 'B2 immutable attribution snapshot mismatch';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.payee_shares
    WHERE order_kind='ticket' AND order_id=v_order
      AND gross_minor=1000 AND mingla_fee_minor=50 AND net_minor=950
      AND status='held_until_event' AND release_after='2026-11-02T20:00:00Z'
  ) THEN
    RAISE EXCEPTION 'B2 cash share fee/release snapshot mismatch';
  END IF;

  BEGIN
    UPDATE public.order_attributions SET eligible_minor=9999
    WHERE order_kind='ticket' AND order_id=v_order;
  EXCEPTION WHEN raise_exception THEN
    v_raised := sqlerrm='order_attributions_immutable';
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'B2 order attribution was mutable'; END IF;

  v_raised := false;
  BEGIN
    INSERT INTO public.payee_shares(
      order_kind,order_id,payee_kind,member_id,payee_user_id,brand_id,rail,
      currency,gross_minor,mingla_fee_minor,net_minor,status,release_after
    ) VALUES(
      'ticket',v_order,'referral','38727000-0000-4000-8400-000000000040',
      '38727000-0000-4000-8400-000000000002',
      '38727000-0000-4000-8400-000000000010','stripe','USD',1000,50,950,
      'held_until_event','2026-11-02T20:00:00Z'
    );
  EXCEPTION WHEN unique_violation THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'B2 second payee share was accepted'; END IF;
END;
$test$;

-- An installment referral is earned on the full discounted plan total, while
-- each provider payment collects only its deterministic slice. The deposit is
-- 1,000 and the two scheduled payments are 4,000 + 5,000; a 10% whole-order
-- share therefore allocates 100 + 400 + 500 exactly.
INSERT INTO public.orders(
  id,event_id,buyer_email,buyer_name,buyer_phone_e164,total_cents,currency,
  payment_status,installment_plan_root
) VALUES(
  '38727000-0000-4000-8400-000000000071',
  '38727000-0000-4000-8400-000000000020','plan-buyer@example.test','Plan Buyer',
  '+15555550124',1000,'USD','paid',true
);
INSERT INTO public.order_installments(
  id,order_id,ordinal,amount_cents,currency,due_at
) VALUES
  ('38727000-0000-4000-8400-000000000072',
   '38727000-0000-4000-8400-000000000071',1,4000,'USD',now()+interval '7 days'),
  ('38727000-0000-4000-8400-000000000073',
   '38727000-0000-4000-8400-000000000071',2,5000,'USD',now()+interval '14 days');
DO $test$
DECLARE
  v_snapshot jsonb := jsonb_build_object(
    'version',1,'source','code','touchId',NULL,
    'memberId','38727000-0000-4000-8400-000000000040','trackingId',NULL,
    'offerId','38727000-0000-4000-8400-000000000030','rejectedReason',NULL,
    'eligibleMinor',10000,'shareBps',1000,'shareMinor',1000,
    'rewardKind','cash','voucherTemplate',NULL,
    'payeeUserId','38727000-0000-4000-8400-000000000002',
    'payeeEmailNorm','r2-b2-payee@example.test','rail','stripe','currency','USD',
    'listingKind','event','listingId','38727000-0000-4000-8400-000000000020',
    'orderKind','ticket'
  );
BEGIN
  PERFORM public.issue_3872_finalize_referral_attribution(
    'ticket','38727000-0000-4000-8400-000000000071',
    '38727000-0000-4000-8400-000000000010',v_snapshot,
    '2026-11-02T20:00:00Z'
  );
  IF (SELECT referral_share_minor FROM public.order_installments
      WHERE id='38727000-0000-4000-8400-000000000072')<>400
     OR (SELECT referral_share_minor FROM public.order_installments
         WHERE id='38727000-0000-4000-8400-000000000073')<>500
     OR (SELECT sum(referral_share_minor) FROM public.order_installments
         WHERE order_id='38727000-0000-4000-8400-000000000071')<>900 THEN
    RAISE EXCEPTION 'B2 installment referral share allocation drifted';
  END IF;
END;
$test$;

-- The checkout row can receive one create-time snapshot and can never be
-- rewritten by a retry after the provider amount has been composed.
INSERT INTO public.ticket_checkout_sessions(
  id,event_id,brand_id,buyer_name,buyer_email,buyer_phone_e164,
  subtotal_cents,application_fee_amount_cents,total_cents,currency,status,
  idempotency_key,cart_fingerprint,expires_at
) VALUES(
  '38727000-0000-4000-8400-000000000080',
  '38727000-0000-4000-8400-000000000020',
  '38727000-0000-4000-8400-000000000010','Buyer','buyer@example.test',
  '+15555550123',10000,0,10000,'USD','requires_payment','r2-b2-session',
  repeat('f',64),now()+interval '15 minutes'
);
DO $test$
DECLARE
  v_raised boolean := false;
  v_snapshot jsonb := jsonb_build_object(
    'version',1,'source','none','touchId',NULL,'memberId',NULL,'trackingId',NULL,
    'offerId',NULL,'rejectedReason',NULL,'eligibleMinor',10000,'shareBps',NULL,
    'shareMinor',0,'rewardKind',NULL,'voucherTemplate',NULL,'payeeUserId',NULL,
    'payeeEmailNorm',NULL,'rail','stripe','currency','USD','listingKind','event',
    'listingId','38727000-0000-4000-8400-000000000020','orderKind','ticket'
  );
BEGIN
  IF public.issue_3872_freeze_ticket_referral_snapshot(
    '38727000-0000-4000-8400-000000000080',
    '38727000-0000-4000-8400-000000000020',v_snapshot
  ) IS DISTINCT FROM v_snapshot THEN
    RAISE EXCEPTION 'B2 first snapshot freeze returned the wrong value';
  END IF;
  IF public.issue_3872_freeze_ticket_referral_snapshot(
    '38727000-0000-4000-8400-000000000080',
    '38727000-0000-4000-8400-000000000020',
    jsonb_set(v_snapshot,'{eligibleMinor}','9999'::jsonb)
  ) IS DISTINCT FROM v_snapshot THEN
    RAISE EXCEPTION 'B2 retry did not reuse the first frozen snapshot';
  END IF;
  BEGIN
    UPDATE public.ticket_checkout_sessions
    SET referral_attribution_snapshot=jsonb_set(
      referral_attribution_snapshot,'{eligibleMinor}','9999'::jsonb
    ) WHERE id='38727000-0000-4000-8400-000000000080';
  EXCEPTION WHEN raise_exception THEN
    v_raised := sqlerrm='referral_attribution_snapshot_immutable';
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'B2 checkout snapshot was mutable'; END IF;
END;
$test$;

-- Cross-rail fallback creates one ordinary, single-use R1 voucher + grant. It
-- never creates stored value or a cash share.
DO $test$
DECLARE
  v_order uuid := '38727000-0000-4000-8400-000000000090';
  v_snapshot jsonb := jsonb_build_object(
    'version',1,'source','code','touchId',NULL,
    'memberId','38727000-0000-4000-8400-000000000040','trackingId',NULL,
    'offerId','38727000-0000-4000-8400-000000000030',
    'rejectedReason','cross_rail','eligibleMinor',5000,'shareBps',1000,
    'shareMinor',0,'rewardKind','voucher','voucherTemplate',
    '{"value_type":"amount","value_minor":500,"expires_days":30,"scope":"brand"}'::jsonb,
    'payeeUserId','38727000-0000-4000-8400-000000000002',
    'payeeEmailNorm','r2-b2-payee@example.test','rail','stripe','currency','USD',
    'listingKind','event','listingId','38727000-0000-4000-8400-000000000020',
    'orderKind','ticket'
  );
BEGIN
  PERFORM public.issue_3872_finalize_referral_attribution(
    'ticket',v_order,'38727000-0000-4000-8400-000000000010',v_snapshot,
    '2026-11-02T20:00:00Z'
  );
  IF EXISTS(SELECT 1 FROM public.payee_shares WHERE order_id=v_order)
     OR NOT EXISTS(
       SELECT 1 FROM public.discount_grants grant_row
       JOIN public.brand_discounts discount ON discount.id=grant_row.discount_id
       WHERE grant_row.origin_order_kind='ticket' AND grant_row.origin_order_id=v_order
         AND discount.kind='voucher' AND discount.source='referral'
         AND discount.value_type='amount' AND discount.value_minor=500
         AND discount.max_total_uses=1 AND discount.max_uses_per_buyer=1
     ) THEN
    RAISE EXCEPTION 'B2 cross-rail voucher fallback did not materialize exactly once';
  END IF;
END;
$test$;

-- Both dimensions stop at exactly 60 requests per UTC minute.
DO $test$
DECLARE v_i integer; v_raised boolean := false;
BEGIN
  FOR v_i IN 1..60 LOOP
    PERFORM public.issue_3872_claim_referral_touch_rate(
      repeat('b',64),repeat('c',64),'2026-10-24T12:34:30Z'
    );
  END LOOP;
  BEGIN
    PERFORM public.issue_3872_claim_referral_touch_rate(
      repeat('b',64),repeat('c',64),'2026-10-24T12:34:59Z'
    );
  EXCEPTION WHEN raise_exception THEN
    v_raised := sqlerrm='referral_touch_rate_limited';
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'B2 61st touch was accepted'; END IF;
  IF (SELECT min(hit_count) FROM public.referral_touch_rate_limits)<>60
     OR (SELECT max(hit_count) FROM public.referral_touch_rate_limits)<>60 THEN
    RAISE EXCEPTION 'B2 rate-limit counters drifted past the cap';
  END IF;
END;
$test$;

DO $test$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM pg_trigger
  WHERE NOT tgisinternal AND tgname IN (
    'issue_3872_ticket_referral_finalize','issue_3872_venue_referral_finalize',
    'ticket_checkout_referral_snapshot_immutable',
    'venue_order_referral_snapshot_immutable'
  );
  IF v_count<>4 THEN RAISE EXCEPTION 'B2 finalize/immutability trigger count %',v_count; END IF;
  IF has_table_privilege('anon','public.referral_touch_rate_limits','select')
     OR has_function_privilege(
       'anon','public.issue_3872_claim_referral_touch_rate(text,text,timestamptz)','execute'
     ) OR has_function_privilege(
       'authenticated','public.issue_3872_freeze_ticket_referral_snapshot(uuid,uuid,jsonb)','execute'
     ) THEN
    RAISE EXCEPTION 'B2 anonymous role can read or mutate touch-rate state';
  END IF;
  RAISE NOTICE 'issue_3872_r2_attribution_finalize happy: PASS';
END;
$test$;

ROLLBACK;
