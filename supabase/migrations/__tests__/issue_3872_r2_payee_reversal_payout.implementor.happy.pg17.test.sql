-- #3872 R2 B3: proportional reversal, debt-safe provider reversal, payout
-- grouping/floors/fees/retries, installment maturity and fraud holds.
-- MINGLA-INVARIANT: I-3872-REFUND-NEVER-BLOCKED | issue #3872 | Payee-share reversal is ledger-first: a host refund commits even when a post-payout provider reversal cannot complete; the unpaid recovery remains in payee_debts.
-- MINGLA-INVARIANT: I-3872-PAYEE-PAYOUT-IDEMPOTENT | issue #3872 | One payout row owns immutable share/debt allocations and one deterministic provider identity per attempt; transient reconciliation reuses that attempt until a definitive failure advances it.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email) VALUES
  ('38723000-0000-4000-8400-000000000001','r2-b3-owner@example.test'),
  ('38723000-0000-4000-8400-000000000002','r2-b3-payee1@example.test'),
  ('38723000-0000-4000-8400-000000000003','r2-b3-payee2@example.test'),
  ('38723000-0000-4000-8400-000000000004','r2-b3-payee3@example.test'),
  ('38723000-0000-4000-8400-000000000005','r2-b3-payee4@example.test'),
  ('38723000-0000-4000-8400-000000000006','r2-b3-payee5@example.test'),
  ('38723000-0000-4000-8400-000000000007','r2-b3-payee6@example.test'),
  ('38723000-0000-4000-8400-000000000008','r2-b3-admin@example.test'),
  ('38723000-0000-4000-8400-000000000009','r2-b3-risk@example.test'),
  ('38723000-0000-4000-8400-000000000010','r2-b3-disconnected@example.test')
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.creator_accounts(id,email) VALUES
  ('38723000-0000-4000-8400-000000000001','r2-b3-owner@example.test')
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.admin_users(email,role,status) VALUES
  ('r2-b3-admin@example.test','admin','active')
ON CONFLICT(email) DO UPDATE SET role=excluded.role,status=excluded.status;
INSERT INTO public.brands(
  id,account_id,name,slug,default_currency,payment_provider,payment_country,
  pricing_region,pricing_currency
) VALUES(
  '38723000-0000-4000-8400-000000000010',
  '38723000-0000-4000-8400-000000000001',
  'R2 B3 brand','r2-b3-brand','USD','stripe','US','US','USD'
);
INSERT INTO public.events(
  id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency
) VALUES(
  '38723000-0000-4000-8400-000000000020',
  '38723000-0000-4000-8400-000000000010',
  '38723000-0000-4000-8400-000000000001',
  'R2 B3 event','r2-b3-event','event','scheduled','public','UTC','USD'
);
INSERT INTO public.referral_offers(
  id,brand_id,name,audience,scope_kind,reward_kind,share_bps,budget_minor,
  currency,starts_at,status,created_by
) VALUES(
  '38723000-0000-4000-8400-000000000030',
  '38723000-0000-4000-8400-000000000010','R2 B3 offer','both','brand',
  'cash',1000,10000000,'USD','2026-01-01T00:00:00Z','active',
  '38723000-0000-4000-8400-000000000001'
);
INSERT INTO public.referral_members(
  id,offer_id,brand_id,role,user_id,email_norm,display_name,link_slug,code,status
) VALUES
  ('38723000-0000-4000-8400-000000000041','38723000-0000-4000-8400-000000000030','38723000-0000-4000-8400-000000000010','promoter','38723000-0000-4000-8400-000000000002','r2-b3-payee1@example.test','Payee One','r2b3m001','B3ONE','active'),
  ('38723000-0000-4000-8400-000000000042','38723000-0000-4000-8400-000000000030','38723000-0000-4000-8400-000000000010','promoter','38723000-0000-4000-8400-000000000009','r2-b3-risk@example.test','Refund Risk','r2b3m002','B3TWO','active'),
  ('38723000-0000-4000-8400-000000000043','38723000-0000-4000-8400-000000000030','38723000-0000-4000-8400-000000000010','promoter','38723000-0000-4000-8400-000000000003','r2-b3-payee2@example.test','Below Floor','r2b3m003','B3THREE','active'),
  ('38723000-0000-4000-8400-000000000044','38723000-0000-4000-8400-000000000030','38723000-0000-4000-8400-000000000010','promoter','38723000-0000-4000-8400-000000000004','r2-b3-payee3@example.test','Paystack Payee','r2b3m004','B3FOUR','active'),
  ('38723000-0000-4000-8400-000000000045','38723000-0000-4000-8400-000000000030','38723000-0000-4000-8400-000000000010','promoter','38723000-0000-4000-8400-000000000005','r2-b3-payee4@example.test','Retry Payee','r2b3m005','B3FIVE','active'),
  ('38723000-0000-4000-8400-000000000046','38723000-0000-4000-8400-000000000030','38723000-0000-4000-8400-000000000010','promoter','38723000-0000-4000-8400-000000000006','r2-b3-payee5@example.test','Nudge Payee','r2b3m006','B3SIX','active'),
  ('38723000-0000-4000-8400-000000000047','38723000-0000-4000-8400-000000000030','38723000-0000-4000-8400-000000000010','promoter','38723000-0000-4000-8400-000000000007','r2-b3-payee6@example.test','Plan Payee','r2b3m007','B3SEVEN','active'),
  ('38723000-0000-4000-8400-000000000048','38723000-0000-4000-8400-000000000030','38723000-0000-4000-8400-000000000010','promoter',NULL,'velocity@example.test','Velocity Member','r2b3m008','B3EIGHT','active'),
  ('38723000-0000-4000-8400-000000000049','38723000-0000-4000-8400-000000000030','38723000-0000-4000-8400-000000000010','promoter','38723000-0000-4000-8400-000000000010','r2-b3-disconnected@example.test','Disconnected Payee','r2b3m009','B3NINE','active');

INSERT INTO public.payee_accounts(
  user_id,stripe_account_id,stripe_status,paystack_recipient_code,paystack_status,
  paystack_country,paystack_currency
) VALUES
  ('38723000-0000-4000-8400-000000000002','acct_r2b3_payee1','active',NULL,'none',NULL,NULL),
  ('38723000-0000-4000-8400-000000000003','acct_r2b3_payee2','active',NULL,'none',NULL,NULL),
  ('38723000-0000-4000-8400-000000000004',NULL,'none','RCP_r2b3payee3','verified','NG','NGN'),
  ('38723000-0000-4000-8400-000000000005','acct_r2b3_payee4','active',NULL,'none',NULL,NULL),
  ('38723000-0000-4000-8400-000000000007','acct_r2b3_payee6','active',NULL,'none',NULL,NULL),
  ('38723000-0000-4000-8400-000000000010','acct_r2b3_disconnected','active',NULL,'none',NULL,NULL);

-- Proportional partial + full reversal is exact and idempotent before payout.
-- created_at must sit inside the 30-day refund-ratio window relative to
-- payee_share_reverse → issue_3872_evaluate_referral_risk(..., now()). A fixed
-- 2026-10-01 stamp fell outside that window once wall-clock crossed 2026-10-31.
INSERT INTO public.order_attributions(
  order_kind,order_id,brand_id,source,member_id,offer_id,eligible_minor,
  share_bps,share_minor,created_at
) VALUES(
  'ticket','38723000-0000-4000-8400-000000000101','38723000-0000-4000-8400-000000000010','code','38723000-0000-4000-8400-000000000042','38723000-0000-4000-8400-000000000030',10000,1000,1000,now() - interval '2 days'
);
INSERT INTO public.payee_shares(
  order_kind,order_id,payee_kind,member_id,payee_user_id,brand_id,rail,currency,
  gross_minor,mingla_fee_minor,net_minor,status,release_after
) VALUES(
  'ticket','38723000-0000-4000-8400-000000000101','referral','38723000-0000-4000-8400-000000000042','38723000-0000-4000-8400-000000000009','38723000-0000-4000-8400-000000000010','stripe','USD',1000,50,950,'held_until_event','2026-10-02T00:00:00Z'
);
DO $test$
DECLARE v jsonb;
BEGIN
  v:=public.payee_share_reverse('ticket','38723000-0000-4000-8400-000000000101','refund:partial',4000);
  IF (v->>'grossReversedMinor')::bigint<>400 OR (v->>'netReversedMinor')::bigint<>380 THEN
    RAISE EXCEPTION 'B3 partial reversal drifted: %',v;
  END IF;
  PERFORM public.payee_share_reverse('ticket','38723000-0000-4000-8400-000000000101','refund:partial',4000);
  IF (SELECT reversed_minor FROM public.payee_shares WHERE order_id='38723000-0000-4000-8400-000000000101')<>400
     OR (SELECT count(*) FROM public.payee_share_reversals WHERE share_id=(SELECT id FROM public.payee_shares WHERE order_id='38723000-0000-4000-8400-000000000101'))<>1 THEN
    RAISE EXCEPTION 'B3 replay changed the partial reversal: reversed=%, rows=%',
      (SELECT reversed_minor FROM public.payee_shares WHERE order_id='38723000-0000-4000-8400-000000000101'),
      (SELECT count(*) FROM public.payee_share_reversals WHERE share_id=(SELECT id FROM public.payee_shares WHERE order_id='38723000-0000-4000-8400-000000000101'));
  END IF;
  PERFORM public.payee_share_reverse('ticket','38723000-0000-4000-8400-000000000101','refund:rest',6000);
  IF (SELECT count(*) FROM public.payee_share_reversals WHERE share_id=(SELECT id FROM public.payee_shares WHERE order_id='38723000-0000-4000-8400-000000000101'))<>2
     OR (SELECT reversed_minor FROM public.payee_shares WHERE order_id='38723000-0000-4000-8400-000000000101')<>1000 THEN
    RAISE EXCEPTION 'B3 full/replayed reversal was not exact';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.referral_member_risk_holds
    WHERE member_id='38723000-0000-4000-8400-000000000042' AND active AND source='refund_ratio') THEN
    RAISE EXCEPTION 'B3 >30 percent refund ratio did not hold member';
  END IF;
END;
$test$;

-- Two mature shares group once; debt and provider fees reduce only payee cash.
INSERT INTO public.order_attributions(order_kind,order_id,brand_id,source,member_id,offer_id,eligible_minor,share_bps,share_minor,created_at)
VALUES
 ('ticket','38723000-0000-4000-8400-000000000111','38723000-0000-4000-8400-000000000010','code','38723000-0000-4000-8400-000000000041','38723000-0000-4000-8400-000000000030',10000,1000,1000,'2026-10-01T00:00:00Z'),
 ('ticket','38723000-0000-4000-8400-000000000112','38723000-0000-4000-8400-000000000010','code','38723000-0000-4000-8400-000000000041','38723000-0000-4000-8400-000000000030',10000,1000,1000,'2026-10-01T00:01:00Z');
INSERT INTO public.payee_shares(order_kind,order_id,payee_kind,member_id,payee_user_id,brand_id,rail,currency,gross_minor,mingla_fee_minor,net_minor,status,release_after)
VALUES
 ('ticket','38723000-0000-4000-8400-000000000111','referral','38723000-0000-4000-8400-000000000041','38723000-0000-4000-8400-000000000002','38723000-0000-4000-8400-000000000010','stripe','USD',1000,50,950,'held_until_event','2026-10-02T00:00:00Z'),
 ('ticket','38723000-0000-4000-8400-000000000112','referral','38723000-0000-4000-8400-000000000041','38723000-0000-4000-8400-000000000002','38723000-0000-4000-8400-000000000010','stripe','USD',1000,50,950,'held_until_event','2026-10-02T00:00:00Z');
INSERT INTO public.brand_payout_releases(id,brand_id,occurrence_key,surface,provider,currency,anchor_end_at,releasable_at,gross_cents,mingla_fee_cents,net_release_cents,status)
VALUES
 ('38723000-0000-4000-8400-000000000211','38723000-0000-4000-8400-000000000010','r2-b3-release-111','order','stripe','usd','2026-10-01','2026-10-02',1000,50,950,'pending'),
 ('38723000-0000-4000-8400-000000000212','38723000-0000-4000-8400-000000000010','r2-b3-release-112','order','stripe','usd','2026-10-01','2026-10-02',1000,50,950,'pending');
INSERT INTO public.payout_release_items(release_id,source_type,source_id,gross_cents,mingla_fee_cents,net_cents,source_finalized_at)
VALUES
 ('38723000-0000-4000-8400-000000000211','order','38723000-0000-4000-8400-000000000111',1000,50,950,'2026-10-01'),
 ('38723000-0000-4000-8400-000000000212','order','38723000-0000-4000-8400-000000000112',1000,50,950,'2026-10-01');
INSERT INTO public.payee_debts(payee_user_id,rail,currency,amount_minor,reason)
VALUES('38723000-0000-4000-8400-000000000002','stripe','USD',300,'payout_reversal');
DO $test$
DECLARE v record;v_reclaimed record;v_share uuid;v_reverse jsonb;v_debts integer;
BEGIN
  SELECT * INTO v FROM public.payee_prepare_payout_sweep('2026-10-24T00:00:00Z',50)
    WHERE payee_user_id='38723000-0000-4000-8400-000000000002';
  IF v.amount_minor<>1600 OR (SELECT gross_share_minor FROM public.payee_payouts WHERE id=v.payout_id)<>1900
     OR (SELECT debt_withheld_minor FROM public.payee_payouts WHERE id=v.payout_id)<>300
     OR (SELECT sum(provider_amount_minor) FROM public.payee_payout_items WHERE payout_id=v.payout_id)<>1600
     OR v.transfer_group<>'payee_'||v.payout_id::text
     OR (SELECT idempotency_key FROM public.payee_payouts WHERE id=v.payout_id)
        <>'payee_share:'||v.payout_id::text||':0' THEN
    RAISE EXCEPTION 'B3 Stripe group/debt allocation drifted: %',row_to_json(v);
  END IF;
  SELECT * INTO v_reclaimed
  FROM public.payee_prepare_payout_sweep('2026-10-24T00:16:00Z',50)
  WHERE payout_id=v.payout_id;
  IF v_reclaimed.payout_id IS DISTINCT FROM v.payout_id THEN
    RAISE EXCEPTION 'B3 stale pending payout was not reclaimed idempotently';
  END IF;
  PERFORM public.payee_mark_payout_attempt(v.payout_id,NULL,'2026-10-24T00:17:00Z');
  PERFORM public.payee_record_payout_outcome(v.payout_id,'paid','tr_r2b3_paid',NULL,false,'2026-10-24T00:18:00Z');
  v_reverse:=public.payee_share_reverse('ticket','38723000-0000-4000-8400-000000000111','refund:after-paid',1000);
  IF (v_reverse->>'providerReversalMinor')::bigint<>95 OR v_reverse->>'providerTransferId'<>'tr_r2b3_paid' THEN
    RAISE EXCEPTION 'B3 after-payout provider reversal request drifted: %',v_reverse;
  END IF;
  v_share:=(v_reverse->>'shareId')::uuid;
  PERFORM public.payee_record_stripe_transfer_reversal(v_share,'trr_r2b3_refund',95);
  PERFORM public.payee_record_stripe_transfer_reversal(v_share,'trr_r2b3_refund',95);
  IF (SELECT count(*) FROM public.payee_provider_reversals WHERE provider_reversal_id='trr_r2b3_refund')<>1
     OR NOT EXISTS(SELECT 1 FROM public.payee_debts WHERE origin_share_id=v_share AND reason='refund_after_payout' AND status='recovered') THEN
    RAISE EXCEPTION 'B3 refund transfer reversal was not debt-safe/idempotent';
  END IF;
  PERFORM public.payee_record_stripe_transfer_reversed('tr_r2b3_paid','trr_r2b3_cumulative_700',700,'2026-10-24T00:02:00Z');
  IF (SELECT sum(provider_reversed_minor) FROM public.payee_payout_items WHERE payout_id=v.payout_id)<>700 THEN
    RAISE EXCEPTION 'B3 cumulative Stripe reversal over-counted its first delta';
  END IF;
  PERFORM public.payee_record_stripe_transfer_reversed('tr_r2b3_paid','trr_r2b3_full',1600,'2026-10-24T00:03:00Z');
  SELECT count(*) INTO v_debts FROM public.payee_debts WHERE origin_payout_id=v.payout_id AND reason='payout_reversal';
  PERFORM public.payee_record_stripe_transfer_reversed('tr_r2b3_paid','trr_r2b3_full',1600,'2026-10-24T00:04:00Z');
  IF (SELECT status FROM public.payee_payouts WHERE id=v.payout_id)<>'reversed'
     OR (SELECT count(*) FROM public.payee_debts WHERE origin_payout_id=v.payout_id AND reason='payout_reversal')<>v_debts
     OR (SELECT sum(provider_reversed_minor) FROM public.payee_payout_items WHERE payout_id=v.payout_id)<>1600 THEN
    RAISE EXCEPTION 'B3 whole transfer reversal allocation/replay drifted';
  END IF;
  PERFORM public.payee_record_payout_outcome(
    v.payout_id,'paid','tr_r2b3_paid',NULL,false,'2026-10-24T00:05:00Z'
  );
  IF (SELECT status FROM public.payee_payouts WHERE id=v.payout_id)<>'reversed' THEN
    RAISE EXCEPTION 'B3 late provider success resurrected a reversed payout';
  END IF;
END;
$test$;

-- USD floor accumulates; Paystack fee is deducted from the payee share.
INSERT INTO public.order_attributions(order_kind,order_id,brand_id,source,member_id,offer_id,eligible_minor,share_bps,share_minor)
VALUES
 ('ticket','38723000-0000-4000-8400-000000000121','38723000-0000-4000-8400-000000000010','code','38723000-0000-4000-8400-000000000043','38723000-0000-4000-8400-000000000030',5000,1000,500),
 ('ticket','38723000-0000-4000-8400-000000000122','38723000-0000-4000-8400-000000000010','code','38723000-0000-4000-8400-000000000044','38723000-0000-4000-8400-000000000030',2000000,1000,200000);
INSERT INTO public.payee_shares(order_kind,order_id,payee_kind,member_id,payee_user_id,brand_id,rail,currency,gross_minor,mingla_fee_minor,net_minor,status,release_after)
VALUES
 ('ticket','38723000-0000-4000-8400-000000000121','referral','38723000-0000-4000-8400-000000000043','38723000-0000-4000-8400-000000000003','38723000-0000-4000-8400-000000000010','stripe','USD',500,25,475,'held_until_event','2026-10-02'),
 ('ticket','38723000-0000-4000-8400-000000000122','referral','38723000-0000-4000-8400-000000000044','38723000-0000-4000-8400-000000000004','38723000-0000-4000-8400-000000000010','paystack','NGN',200000,10000,190000,'held_until_event','2026-10-02');
INSERT INTO public.brand_payout_releases(id,brand_id,occurrence_key,surface,provider,currency,anchor_end_at,releasable_at,gross_cents,mingla_fee_cents,net_release_cents,status)
VALUES
 ('38723000-0000-4000-8400-000000000221','38723000-0000-4000-8400-000000000010','r2-b3-release-121','order','stripe','usd','2026-10-01','2026-10-02',500,25,475,'pending'),
 ('38723000-0000-4000-8400-000000000222','38723000-0000-4000-8400-000000000010','r2-b3-release-122','order','paystack','ngn','2026-10-01','2026-10-02',200000,10000,190000,'pending');
INSERT INTO public.payout_release_items(release_id,source_type,source_id,gross_cents,mingla_fee_cents,net_cents,source_finalized_at)
VALUES
 ('38723000-0000-4000-8400-000000000221','order','38723000-0000-4000-8400-000000000121',500,25,475,'2026-10-01'),
 ('38723000-0000-4000-8400-000000000222','order','38723000-0000-4000-8400-000000000122',200000,10000,190000,'2026-10-01');
DO $test$
DECLARE v record;
BEGIN
  PERFORM * FROM public.payee_prepare_payout_sweep('2026-10-24',50);
  IF (SELECT status FROM public.payee_shares WHERE order_id='38723000-0000-4000-8400-000000000121')<>'accumulating'
     OR EXISTS(SELECT 1 FROM public.payee_payouts WHERE payee_user_id='38723000-0000-4000-8400-000000000003') THEN
    RAISE EXCEPTION 'B3 USD five-dollar floor was bypassed';
  END IF;
  SELECT * INTO v FROM public.payee_payouts WHERE payee_user_id='38723000-0000-4000-8400-000000000004';
  IF v.gross_share_minor<>190000 OR v.provider_fee_minor<>1000 OR v.amount_minor<>189000 THEN
    RAISE EXCEPTION 'B3 Paystack fee was not payee-absorbed: %',row_to_json(v);
  END IF;
END;
$test$;

-- Three definitive failures release the share without deleting its immutable
-- attempt history; a later sweep may claim it with a new payout id.
INSERT INTO public.order_attributions(order_kind,order_id,brand_id,source,member_id,offer_id,eligible_minor,share_bps,share_minor)
VALUES('ticket','38723000-0000-4000-8400-000000000131','38723000-0000-4000-8400-000000000010','code','38723000-0000-4000-8400-000000000045','38723000-0000-4000-8400-000000000030',10000,1000,1000);
INSERT INTO public.payee_shares(order_kind,order_id,payee_kind,member_id,payee_user_id,brand_id,rail,currency,gross_minor,mingla_fee_minor,net_minor,status,release_after)
VALUES('ticket','38723000-0000-4000-8400-000000000131','referral','38723000-0000-4000-8400-000000000045','38723000-0000-4000-8400-000000000005','38723000-0000-4000-8400-000000000010','stripe','USD',1000,50,950,'held_until_event','2026-10-02');
INSERT INTO public.brand_payout_releases(id,brand_id,occurrence_key,surface,provider,currency,anchor_end_at,releasable_at,gross_cents,mingla_fee_cents,net_release_cents,status)
VALUES('38723000-0000-4000-8400-000000000231','38723000-0000-4000-8400-000000000010','r2-b3-release-131','order','stripe','usd','2026-10-01','2026-10-02',1000,50,950,'pending');
INSERT INTO public.payout_release_items(release_id,source_type,source_id,gross_cents,mingla_fee_cents,net_cents,source_finalized_at)
VALUES('38723000-0000-4000-8400-000000000231','order','38723000-0000-4000-8400-000000000131',1000,50,950,'2026-10-01');
DO $test$
DECLARE v uuid;v_share uuid;
BEGIN
  SELECT payout_id INTO v FROM public.payee_prepare_payout_sweep('2026-10-24',50)
    WHERE payee_user_id='38723000-0000-4000-8400-000000000005';
  PERFORM public.payee_record_payout_outcome(v,'failed',NULL,'definitive',true,'2026-10-24T00:00:00Z');
  IF (SELECT attempt FROM public.payee_payouts WHERE id=v)<>1
     OR (SELECT idempotency_key FROM public.payee_payouts WHERE id=v)
        <>'payee_share:'||v::text||':1' THEN
    RAISE EXCEPTION 'B3 first retry identity did not advance exactly once';
  END IF;
  PERFORM public.payee_record_payout_outcome(v,'failed',NULL,'definitive',true,'2026-10-24T00:00:01Z');
  IF (SELECT attempt FROM public.payee_payouts WHERE id=v)<>1 THEN
    RAISE EXCEPTION 'B3 replayed definitive failure advanced the attempt twice';
  END IF;
  PERFORM * FROM public.payee_prepare_payout_sweep('2026-10-24T01:00:00Z',50);
  PERFORM public.payee_record_payout_outcome(v,'failed',NULL,'definitive',true,'2026-10-24T01:00:00Z');
  IF (SELECT attempt FROM public.payee_payouts WHERE id=v)<>2
     OR (SELECT idempotency_key FROM public.payee_payouts WHERE id=v)
        <>'payee_share:'||v::text||':2' THEN
    RAISE EXCEPTION 'B3 second retry identity did not advance';
  END IF;
  PERFORM * FROM public.payee_prepare_payout_sweep('2026-10-24T07:00:00Z',50);
  PERFORM public.payee_record_payout_outcome(v,'failed',NULL,'definitive',true,'2026-10-24T07:00:00Z');
  SELECT id INTO v_share FROM public.payee_shares WHERE order_id='38723000-0000-4000-8400-000000000131';
  IF (SELECT payout_id FROM public.payee_shares WHERE id=v_share) IS NOT NULL THEN
    RAISE EXCEPTION 'B3 exhausted payout kept the share captive';
  END IF;
  PERFORM * FROM public.payee_prepare_payout_sweep('2026-10-25',50);
  IF (SELECT count(*) FROM public.payee_payout_items WHERE share_id=v_share)<>2 THEN
    RAISE EXCEPTION 'B3 exhausted share could not be safely reclaimed';
  END IF;
END;
$test$;

-- A payout account disconnected after an ambiguous provider response keeps its
-- exact immutable allocation and frozen destination. Releasing it could pay the
-- same share twice if the provider accepted the first request before timing out.
INSERT INTO public.order_attributions(order_kind,order_id,brand_id,source,member_id,offer_id,eligible_minor,share_bps,share_minor)
VALUES('ticket','38723000-0000-4000-8400-000000000132','38723000-0000-4000-8400-000000000010','code','38723000-0000-4000-8400-000000000049','38723000-0000-4000-8400-000000000030',10000,1000,1000);
INSERT INTO public.payee_shares(order_kind,order_id,payee_kind,member_id,payee_user_id,brand_id,rail,currency,gross_minor,mingla_fee_minor,net_minor,status,release_after)
VALUES('ticket','38723000-0000-4000-8400-000000000132','referral','38723000-0000-4000-8400-000000000049','38723000-0000-4000-8400-000000000010','38723000-0000-4000-8400-000000000010','stripe','USD',1000,50,950,'held_until_event','2026-10-02');
INSERT INTO public.brand_payout_releases(id,brand_id,occurrence_key,surface,provider,currency,anchor_end_at,releasable_at,gross_cents,mingla_fee_cents,net_release_cents,status)
VALUES('38723000-0000-4000-8400-000000000232','38723000-0000-4000-8400-000000000010','r2-b3-release-132','order','stripe','usd','2026-10-01','2026-10-02',1000,50,950,'pending');
INSERT INTO public.payout_release_items(release_id,source_type,source_id,gross_cents,mingla_fee_cents,net_cents,source_finalized_at)
VALUES('38723000-0000-4000-8400-000000000232','order','38723000-0000-4000-8400-000000000132',1000,50,950,'2026-10-01');
DO $test$
DECLARE v_payout uuid;v_returned integer;v_account_ref text;
BEGIN
  SELECT payout_id INTO v_payout
  FROM public.payee_prepare_payout_sweep('2026-10-24T00:00:00Z',50)
  WHERE payee_user_id='38723000-0000-4000-8400-000000000010';
  PERFORM public.payee_record_payout_outcome(
    v_payout,'failed',NULL,'provider_timeout',false,'2026-10-24T00:00:00Z'
  );
  UPDATE public.payee_accounts SET stripe_status='restricted'
  WHERE user_id='38723000-0000-4000-8400-000000000010';
  SELECT count(*),max(account_ref) INTO v_returned,v_account_ref
  FROM public.payee_prepare_payout_sweep('2026-10-24T00:15:00Z',50)
  WHERE payout_id=v_payout;
  IF v_returned<>1 OR v_account_ref<>'acct_r2b3_disconnected'
     OR (SELECT status FROM public.payee_payouts WHERE id=v_payout)<>'pending'
     OR (SELECT account_ref FROM public.payee_payouts WHERE id=v_payout)<>'acct_r2b3_disconnected'
     OR (SELECT payout_id FROM public.payee_shares WHERE order_id='38723000-0000-4000-8400-000000000132') IS DISTINCT FROM v_payout THEN
    RAISE EXCEPTION 'B3 ambiguous retry abandoned its frozen destination or allocation';
  END IF;
END;
$test$;

-- Weekly account nudges stop after four sends.
INSERT INTO public.order_attributions(order_kind,order_id,brand_id,source,member_id,offer_id,eligible_minor,share_bps,share_minor)
VALUES('ticket','38723000-0000-4000-8400-000000000141','38723000-0000-4000-8400-000000000010','code','38723000-0000-4000-8400-000000000046','38723000-0000-4000-8400-000000000030',10000,1000,1000);
INSERT INTO public.payee_shares(order_kind,order_id,payee_kind,member_id,payee_user_id,brand_id,rail,currency,gross_minor,mingla_fee_minor,net_minor,status,release_after)
VALUES('ticket','38723000-0000-4000-8400-000000000141','referral','38723000-0000-4000-8400-000000000046','38723000-0000-4000-8400-000000000006','38723000-0000-4000-8400-000000000010','stripe','USD',1000,50,950,'releasable','2026-10-02');
DO $test$
DECLARE v_count integer;
BEGIN
  PERFORM * FROM public.payee_claim_account_nudges('2026-10-01',50);
  PERFORM * FROM public.payee_claim_account_nudges('2026-10-08',50);
  PERFORM * FROM public.payee_claim_account_nudges('2026-10-15',50);
  PERFORM * FROM public.payee_claim_account_nudges('2026-10-22',50);
  SELECT count(*) INTO v_count FROM public.payee_claim_account_nudges('2026-10-29',50);
  IF v_count<>0 OR (SELECT sent_count FROM public.payee_account_nudges WHERE payee_user_id='38723000-0000-4000-8400-000000000006')<>4 THEN
    RAISE EXCEPTION 'B3 account nudge cap drifted';
  END IF;
END;
$test$;

-- Installment shares remain held until every scheduled payment is collected.
INSERT INTO public.orders(id,event_id,buyer_email,buyer_name,buyer_phone_e164,total_cents,currency,payment_status,installment_plan_root)
VALUES('38723000-0000-4000-8400-000000000151','38723000-0000-4000-8400-000000000020','plan@example.test','Plan Buyer','+15555550100',1000,'USD','paid',true);
INSERT INTO public.order_installments(id,order_id,ordinal,amount_cents,currency,due_at,status)
VALUES('38723000-0000-4000-8400-000000000152','38723000-0000-4000-8400-000000000151',1,9000,'USD','2026-10-05','scheduled');
INSERT INTO public.order_attributions(order_kind,order_id,brand_id,source,member_id,offer_id,eligible_minor,share_bps,share_minor)
VALUES('ticket','38723000-0000-4000-8400-000000000151','38723000-0000-4000-8400-000000000010','code','38723000-0000-4000-8400-000000000047','38723000-0000-4000-8400-000000000030',10000,1000,1000);
INSERT INTO public.payee_shares(order_kind,order_id,payee_kind,member_id,payee_user_id,brand_id,rail,currency,gross_minor,mingla_fee_minor,net_minor,status,release_after)
VALUES('ticket','38723000-0000-4000-8400-000000000151','referral','38723000-0000-4000-8400-000000000047','38723000-0000-4000-8400-000000000007','38723000-0000-4000-8400-000000000010','stripe','USD',1000,50,950,'held_until_event','2026-10-02');
INSERT INTO public.brand_payout_releases(id,brand_id,occurrence_key,surface,provider,currency,anchor_end_at,releasable_at,gross_cents,mingla_fee_cents,net_release_cents,status)
VALUES('38723000-0000-4000-8400-000000000251','38723000-0000-4000-8400-000000000010','r2-b3-release-151','order','stripe','usd','2026-10-01','2026-10-02',1000,50,950,'pending');
INSERT INTO public.payout_release_items(release_id,source_type,source_id,gross_cents,mingla_fee_cents,net_cents,source_finalized_at)
VALUES('38723000-0000-4000-8400-000000000251','order','38723000-0000-4000-8400-000000000151',1000,50,950,'2026-10-01');
DO $test$
BEGIN
  PERFORM * FROM public.payee_prepare_payout_sweep('2026-10-24',50);
  IF (SELECT status FROM public.payee_shares WHERE order_id='38723000-0000-4000-8400-000000000151')<>'held_until_event' THEN
    RAISE EXCEPTION 'B3 incomplete installment became payable';
  END IF;
  UPDATE public.order_installments SET status='collected',collected_at='2026-10-24',
    stripe_payment_intent_id='pi_r2b3_installment'
  WHERE id='38723000-0000-4000-8400-000000000152';
  PERFORM * FROM public.payee_prepare_payout_sweep('2026-10-25',50);
  IF (SELECT payout_id FROM public.payee_shares WHERE order_id='38723000-0000-4000-8400-000000000151') IS NULL THEN
    RAISE EXCEPTION 'B3 completed installment did not become payable';
  END IF;
END;
$test$;

-- More than 20 referred orders in one hour creates an automatic hold.
INSERT INTO public.order_attributions(
  order_kind,order_id,brand_id,source,member_id,offer_id,eligible_minor,share_bps,
  share_minor,created_at
)
SELECT 'ticket',gen_random_uuid(),'38723000-0000-4000-8400-000000000010','code',
  '38723000-0000-4000-8400-000000000048','38723000-0000-4000-8400-000000000030',
  100,1000,10,'2026-10-24T12:30:00Z'
FROM generate_series(1,21);
DO $test$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.referral_member_risk_holds
    WHERE member_id='38723000-0000-4000-8400-000000000048' AND active
      AND source='velocity' AND observed_orders_hour=21) THEN
    RAISE EXCEPTION 'B3 >20/hour velocity did not hold member';
  END IF;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub','38723000-0000-4000-8400-000000000008',true);
  PERFORM public.admin_set_referral_member_hold(
    '38723000-0000-4000-8400-000000000048',false,'review cleared'
  );
  RESET ROLE;
  IF EXISTS(SELECT 1 FROM public.referral_member_risk_holds
    WHERE member_id='38723000-0000-4000-8400-000000000048' AND active) THEN
    RAISE EXCEPTION 'B3 admin clear did not release fraud hold';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.admin_audit_log
    WHERE actor_uid='38723000-0000-4000-8400-000000000008'
      AND action='referral_member.payout_clear'
      AND target_id='38723000-0000-4000-8400-000000000048') THEN
    RAISE EXCEPTION 'B3 admin hold clear was not audited';
  END IF;
END;
$test$;

ROLLBACK;
