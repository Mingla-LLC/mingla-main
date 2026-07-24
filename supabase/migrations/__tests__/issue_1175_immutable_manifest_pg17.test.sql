-- Issue #1175 immutable refund manifest and debt-once PostgreSQL 17 proof.
-- Run after all migrations against a disposable database. Every write rolls
-- back; any missing invariant raises and makes psql ON_ERROR_STOP fail.
BEGIN;

DO $test$
DECLARE
  v_owner constant uuid := '11750000-0000-4000-8000-000000000001';
  v_attacker constant uuid := '11750000-0000-4000-8000-000000000002';
  v_brand constant uuid := '11750000-0000-4000-8000-000000000010';
  v_buyer_event constant uuid := '11750000-0000-4000-8000-000000000020';
  v_admin_event constant uuid := '11750000-0000-4000-8000-000000000021';
  v_buyer_order constant uuid := '11750000-0000-4000-8000-000000000030';
  v_admin_order constant uuid := '11750000-0000-4000-8000-000000000031';
  v_buyer_line_a constant uuid := '11750000-0000-4000-8000-000000000040';
  v_buyer_line_b constant uuid := '11750000-0000-4000-8000-000000000041';
  v_admin_line_a constant uuid := '11750000-0000-4000-8000-000000000042';
  v_admin_line_b constant uuid := '11750000-0000-4000-8000-000000000043';
  v_buyer_ticket_a constant uuid := '11750000-0000-4000-8000-000000000050';
  v_buyer_ticket_b constant uuid := '11750000-0000-4000-8000-000000000051';
  v_admin_ticket_a constant uuid := '11750000-0000-4000-8000-000000000052';
  v_admin_ticket_b constant uuid := '11750000-0000-4000-8000-000000000053';
  v_buyer_release constant uuid := '11750000-0000-4000-8000-000000000060';
  v_admin_release constant uuid := '11750000-0000-4000-8000-000000000061';
  v_buyer jsonb;
  v_buyer_replay jsonb;
  v_admin jsonb;
  v_admin_replay jsonb;
  v_mismatch_count integer := 0;
  v_refund_id uuid;
BEGIN
  INSERT INTO auth.users(id) VALUES(v_owner),(v_attacker);
  INSERT INTO public.creator_accounts(id,email)
  VALUES(v_owner,'owner-1175@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,payment_provider,pricing_region,pricing_currency,
    default_currency
  ) VALUES(
    v_brand,v_owner,'Issue 1175 Brand','issue-1175-brand',
    'paystack','NG','NGN','NGN'
  );
  INSERT INTO public.events(id,brand_id,title,slug,status,currency)
  VALUES
    (v_buyer_event,v_brand,'Buyer Refund','buyer-refund','ended','NGN'),
    (v_admin_event,v_brand,'Admin Refund','admin-refund','ended','NGN');
  INSERT INTO public.ticket_types(id,event_id,name,price_cents)
  VALUES
    (v_buyer_ticket_a,v_buyer_event,'Buyer A',6000),
    (v_buyer_ticket_b,v_buyer_event,'Buyer B',4000),
    (v_admin_ticket_a,v_admin_event,'Admin A',6000),
    (v_admin_ticket_b,v_admin_event,'Admin B',4000);
  INSERT INTO public.orders(
    id,event_id,total_cents,currency,payment_status,
    stripe_payment_intent_id,stripe_charge_id,source
  ) VALUES
    (
      v_buyer_order,v_buyer_event,10000,'NGN','paid',
      'paystack-buyer-transaction','paystack-buyer-charge','legacy'
    ),
    (
      v_admin_order,v_admin_event,10000,'NGN','paid',
      'paystack-admin-transaction','paystack-admin-charge','legacy'
    );
  INSERT INTO public.order_line_items(
    id,order_id,ticket_type_id,quantity,unit_price_cents,total_cents
  ) VALUES
    (v_buyer_line_a,v_buyer_order,v_buyer_ticket_a,1,6000,6000),
    (v_buyer_line_b,v_buyer_order,v_buyer_ticket_b,1,4000,4000),
    (v_admin_line_a,v_admin_order,v_admin_ticket_a,1,6000,6000),
    (v_admin_line_b,v_admin_order,v_admin_ticket_b,1,4000,4000);

  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_buyer := public.biz_refund_order(
    v_buyer_order,
    jsonb_build_array(
      jsonb_build_object(
        'order_line_item_id',v_buyer_line_a,'quantity',1,'amount_cents',6000
      ),
      jsonb_build_object(
        'order_line_item_id',v_buyer_line_b,'quantity',1,'amount_cents',4000
      )
    ),
    '  Full buyer refund reason  ',
    'issue-1175-buyer-key'
  );
  v_buyer_replay := public.biz_refund_order(
    v_buyer_order,
    jsonb_build_array(
      jsonb_build_object(
        'order_line_item_id',v_buyer_line_b,'quantity',1,'amount_cents',4000
      ),
      jsonb_build_object(
        'order_line_item_id',v_buyer_line_a,'quantity',1,'amount_cents',6000
      )
    ),
    'Full buyer refund reason',
    'issue-1175-buyer-key'
  );
  IF (v_buyer->>'is_full_refund')::boolean IS NOT TRUE
     OR (v_buyer_replay->>'is_full_refund')::boolean IS NOT TRUE
     OR (v_buyer_replay->>'idempotent_replay')::boolean IS NOT TRUE
     OR v_buyer_replay->>'refund_id' <> v_buyer->>'refund_id'
     OR v_buyer_replay->>'amount_cents' <> v_buyer->>'amount_cents'
     OR v_buyer_replay->>'reason' <> 'Full buyer refund reason'
     OR v_buyer_replay->'lines' <> v_buyer->'lines' THEN
    RAISE EXCEPTION 'buyer_exact_replay_manifest_failed';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_attacker::text,true);
  BEGIN
    PERFORM public.biz_refund_order(
      v_buyer_order,v_buyer->'lines','Full buyer refund reason',
      'issue-1175-buyer-key'
    );
    RAISE EXCEPTION 'buyer_replay_disclosed_before_authorization';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%permission_denied%' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);

  BEGIN
    PERFORM public.biz_refund_order(
      v_buyer_order,
      jsonb_build_array(
        jsonb_build_object(
          'order_line_item_id',v_buyer_line_a,'quantity',1,'amount_cents',6000
        )
      ),
      'Full buyer refund reason','issue-1175-buyer-key'
    );
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM LIKE '%idempotency_request_mismatch%' THEN
      v_mismatch_count := v_mismatch_count + 1;
    ELSE RAISE;
    END IF;
  END;
  BEGIN
    PERFORM public.biz_refund_order(
      v_buyer_order,
      jsonb_build_array(
        jsonb_build_object(
          'order_line_item_id',v_buyer_line_a,'quantity',2,'amount_cents',6000
        ),
        jsonb_build_object(
          'order_line_item_id',v_buyer_line_b,'quantity',1,'amount_cents',4000
        )
      ),
      'Full buyer refund reason','issue-1175-buyer-key'
    );
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM LIKE '%idempotency_request_mismatch%' THEN
      v_mismatch_count := v_mismatch_count + 1;
    ELSE RAISE;
    END IF;
  END;
  BEGIN
    PERFORM public.biz_refund_order(
      v_buyer_order,
      jsonb_build_array(
        jsonb_build_object(
          'order_line_item_id',v_buyer_line_a,'quantity',1,'amount_cents',5999
        ),
        jsonb_build_object(
          'order_line_item_id',v_buyer_line_b,'quantity',1,'amount_cents',4000
        )
      ),
      'Full buyer refund reason','issue-1175-buyer-key'
    );
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM LIKE '%idempotency_request_mismatch%' THEN
      v_mismatch_count := v_mismatch_count + 1;
    ELSE RAISE;
    END IF;
  END;
  BEGIN
    PERFORM public.biz_refund_order(
      v_buyer_order,v_buyer->'lines','Different buyer refund reason',
      'issue-1175-buyer-key'
    );
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM LIKE '%idempotency_request_mismatch%' THEN
      v_mismatch_count := v_mismatch_count + 1;
    ELSE RAISE;
    END IF;
  END;
  IF v_mismatch_count <> 4 THEN
    RAISE EXCEPTION 'buyer_mismatch_count_%',v_mismatch_count;
  END IF;

  -- service_role execution has auth.uid() NULL, matching the edge function.
  PERFORM set_config('request.jwt.claim.sub','',true);
  v_admin := public.admin_refund_order(
    v_admin_order,
    jsonb_build_array(
      jsonb_build_object(
        'order_line_item_id',v_admin_line_a,'quantity',1,'amount_cents',6000
      ),
      jsonb_build_object(
        'order_line_item_id',v_admin_line_b,'quantity',1,'amount_cents',4000
      )
    ),
    '  Full admin refund reason  ',
    'issue-1175-admin-key'
  );
  v_admin_replay := public.admin_refund_order(
    v_admin_order,
    jsonb_build_array(
      jsonb_build_object(
        'order_line_item_id',v_admin_line_b,'quantity',1,'amount_cents',4000
      ),
      jsonb_build_object(
        'order_line_item_id',v_admin_line_a,'quantity',1,'amount_cents',6000
      )
    ),
    'Full admin refund reason',
    'issue-1175-admin-key'
  );
  IF (v_admin->>'is_full_refund')::boolean IS NOT TRUE
     OR (v_admin_replay->>'is_full_refund')::boolean IS NOT TRUE
     OR (v_admin_replay->>'idempotent_replay')::boolean IS NOT TRUE
     OR v_admin_replay->>'refund_id' <> v_admin->>'refund_id'
     OR v_admin_replay->'lines' <> v_admin->'lines' THEN
    RAISE EXCEPTION 'admin_exact_replay_manifest_failed';
  END IF;

  v_mismatch_count := 0;
  BEGIN
    PERFORM public.admin_refund_order(
      v_admin_order,
      jsonb_build_array(
        jsonb_build_object(
          'order_line_item_id',v_admin_line_a,'quantity',1,'amount_cents',6000
        )
      ),
      'Full admin refund reason','issue-1175-admin-key'
    );
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM LIKE '%idempotency_request_mismatch%' THEN
      v_mismatch_count := v_mismatch_count + 1;
    ELSE RAISE;
    END IF;
  END;
  BEGIN
    PERFORM public.admin_refund_order(
      v_admin_order,
      jsonb_build_array(
        jsonb_build_object(
          'order_line_item_id',v_admin_line_a,'quantity',2,'amount_cents',6000
        ),
        jsonb_build_object(
          'order_line_item_id',v_admin_line_b,'quantity',1,'amount_cents',4000
        )
      ),
      'Full admin refund reason','issue-1175-admin-key'
    );
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM LIKE '%idempotency_request_mismatch%' THEN
      v_mismatch_count := v_mismatch_count + 1;
    ELSE RAISE;
    END IF;
  END;
  BEGIN
    PERFORM public.admin_refund_order(
      v_admin_order,
      jsonb_build_array(
        jsonb_build_object(
          'order_line_item_id',v_admin_line_a,'quantity',1,'amount_cents',5999
        ),
        jsonb_build_object(
          'order_line_item_id',v_admin_line_b,'quantity',1,'amount_cents',4000
        )
      ),
      'Full admin refund reason','issue-1175-admin-key'
    );
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM LIKE '%idempotency_request_mismatch%' THEN
      v_mismatch_count := v_mismatch_count + 1;
    ELSE RAISE;
    END IF;
  END;
  BEGIN
    PERFORM public.admin_refund_order(
      v_admin_order,v_admin->'lines','Different admin refund reason',
      'issue-1175-admin-key'
    );
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM LIKE '%idempotency_request_mismatch%' THEN
      v_mismatch_count := v_mismatch_count + 1;
    ELSE RAISE;
    END IF;
  END;
  IF v_mismatch_count <> 4 THEN
    RAISE EXCEPTION 'admin_mismatch_count_%',v_mismatch_count;
  END IF;

  INSERT INTO public.brand_payout_releases(
    id,brand_id,event_id,occurrence_key,surface,provider,currency,
    anchor_end_at,releasable_at,gross_cents,net_release_cents,
    organiser_cash_delivered_cents,status,released_at
  ) VALUES
    (
      v_buyer_release,v_brand,v_buyer_event,'buyer','order','paystack','ngn',
      now()-interval '4 days',now()-interval '1 day',10000,10000,10000,
      'released',now()-interval '1 day'
    ),
    (
      v_admin_release,v_brand,v_admin_event,'admin','order','paystack','ngn',
      now()-interval '4 days',now()-interval '1 day',10000,10000,10000,
      'released',now()-interval '1 day'
    );
  INSERT INTO public.payout_release_items(
    release_id,source_type,source_id,gross_cents,net_cents,source_finalized_at
  ) VALUES
    (v_buyer_release,'order',v_buyer_order,10000,10000,now()-interval '4 days'),
    (v_admin_release,'order',v_admin_order,10000,10000,now()-interval '4 days');

  FOR i IN 1..3 LOOP
    v_refund_id := (v_buyer->>'refund_id')::uuid;
    PERFORM public.record_paystack_refund_outcome(
      'order',v_buyer_order,v_refund_id,'paystack-buyer-transaction',
      'mingla_refund:'||v_refund_id,'provider-buyer-refund',10000,
      'processed',NULL,now()
    );
    v_refund_id := (v_admin->>'refund_id')::uuid;
    PERFORM public.record_paystack_refund_outcome(
      'order',v_admin_order,v_refund_id,'paystack-admin-transaction',
      'mingla_admin_refund:'||v_refund_id,'provider-admin-refund',10000,
      'processed',NULL,now()
    );
  END LOOP;

  IF (
    SELECT count(*) FROM public.paystack_refund_attempts
    WHERE local_refund_id IN (
      (v_buyer->>'refund_id')::uuid,(v_admin->>'refund_id')::uuid
    )
  ) <> 2 THEN
    RAISE EXCEPTION 'refund_attempt_not_once_per_surface';
  END IF;
  IF (
    SELECT count(*) FROM public.payout_ledger_adjustments
    WHERE release_id IN (v_buyer_release,v_admin_release)
      AND kind='post_release_refund'
  ) <> 2 THEN
    RAISE EXCEPTION 'refund_adjustment_not_once_per_surface';
  END IF;
  IF (
    SELECT count(*) FROM public.organiser_payout_debts
    WHERE origin_release_id IN (v_buyer_release,v_admin_release)
      AND kind='post_release_refund' AND principal_cents=10000
  ) <> 2 THEN
    RAISE EXCEPTION 'refund_debt_not_once_per_surface';
  END IF;

  RAISE NOTICE
    'issue_1175_pg17_pass buyer/admin exact replay, auth-first, mismatch, and one debt';
END;
$test$;

ROLLBACK;
