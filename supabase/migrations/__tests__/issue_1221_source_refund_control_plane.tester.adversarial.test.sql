\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE live_id uuid:=gen_random_uuid(); expired_id uuid:=gen_random_uuid();
DECLARE failed boolean:=false; definition text; cleanup jsonb;
BEGIN
  INSERT INTO public.admin_source_refund_query_snapshots(
    id,admin_user_id,normalized_filters,normalized_filter_hash,page_size,item_count,
    created_at,expires_at
  ) VALUES(
    live_id,gen_random_uuid(),'{}',repeat('a',64),25,1,
    statement_timestamp(),statement_timestamp()+interval '15 minutes'
  );
  INSERT INTO public.admin_source_refund_query_snapshot_items(
    snapshot_id,ordinal,item_kind,item_id,safe_summary
  ) VALUES(live_id,0,'refund_operation',gen_random_uuid(),'{"buyerState":"queued"}');
  BEGIN
    DELETE FROM public.admin_source_refund_query_snapshots WHERE id=live_id;
  EXCEPTION WHEN OTHERS THEN failed:=SQLERRM LIKE '%immutable_snapshot%'; END;
  IF NOT failed THEN RAISE EXCEPTION 'live_snapshot_delete_allowed'; END IF;
  failed:=false;
  BEGIN
    UPDATE public.admin_source_refund_query_snapshot_items
    SET safe_summary='{"buyerState":"processed"}' WHERE snapshot_id=live_id;
  EXCEPTION WHEN OTHERS THEN failed:=SQLERRM LIKE '%immutable_snapshot%'; END;
  IF NOT failed THEN RAISE EXCEPTION 'snapshot_item_update_allowed'; END IF;
  INSERT INTO public.admin_source_refund_query_snapshots(
    id,admin_user_id,normalized_filters,normalized_filter_hash,page_size,item_count,
    created_at,expires_at
  ) VALUES(
    expired_id,gen_random_uuid(),'{}',repeat('b',64),25,0,
    statement_timestamp()-interval '16 minutes',
    statement_timestamp()-interval '1 minute'
  );
  cleanup:=public.cleanup_admin_source_refund_query_snapshots(1);
  IF cleanup->>'deleted_snapshots'<>'1'
     OR EXISTS(SELECT 1 FROM public.admin_source_refund_query_snapshots WHERE id=expired_id) THEN
    RAISE EXCEPTION 'expired_snapshot_cleanup_failed';
  END IF;
  SELECT pg_get_functiondef('public.admin_list_source_refund_operations(uuid,jsonb,text,uuid,integer,integer)'::regprocedure)
    INTO definition;
  IF definition LIKE '%updated_at <%' OR definition LIKE '%snapshot_at%'
     OR definition NOT LIKE '%admin_source_refund_query_snapshot_items%' THEN
    RAISE EXCEPTION 'mutable_pagination_authority_detected';
  END IF;
  IF has_function_privilege('authenticated',
       'public.admin_list_source_refund_operations(uuid,jsonb,text,uuid,integer,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'admin_list_rpc_browser_exposed';
  END IF;
END $$;

-- SC27_EXECUTABLE_UNSEEN_ROW_UPDATE
-- SC27_LIVE_SEEK_REVERSION_PROTECTED: this journey fails if later pages read
-- source_refunds through mutable (updated_at,id) seek instead of snapshot items.
DO $$
DECLARE
  v_admin uuid:=gen_random_uuid();
  v_brand uuid:=gen_random_uuid();
  v_event uuid:=gen_random_uuid();
  v_first uuid:=gen_random_uuid();
  v_second uuid:=gen_random_uuid();
  v_unseen uuid:=gen_random_uuid();
  v_filters jsonb;
  v_page_1 record;
  v_page_2 record;
  v_page_3 record;
  v_captured_unseen_updated_at timestamptz:='2030-01-01T00:00:00Z';
  v_seen uuid[];
  v_seen_count integer;
BEGIN
  INSERT INTO auth.users(id) VALUES(v_admin);
  INSERT INTO public.creator_accounts(id,email)
  VALUES(v_admin,'issue-1221-sc27@example.test');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES(
    v_brand,
    v_admin,
    'Issue 1221 SC27',
    'issue-1221-sc27-'||replace(v_brand::text,'-',''),
    'USD'
  );
  INSERT INTO public.events(id,brand_id,title,slug,status,currency)
  VALUES(
    v_event,
    v_brand,
    'Issue 1221 SC27',
    'issue-1221-sc27-event-'||replace(v_event::text,'-',''),
    'scheduled',
    'USD'
  );
  INSERT INTO public.source_refunds(
    id,source_type,source_id,subject_id,brand_id,event_id,refund_kind,
    requested_by_type,reason,provider,currency,original_charge_cents,
    buyer_refund_requested_cents,buyer_refund_processed_cents,buyer_state,
    fee_reversal_required_cents,fee_reversal_processed_cents,fee_state,
    fee_leg_kind,financial_state,organizer_refund_liability_cents,
    platform_fee_absorption_cents,provider_payment_reference,idempotency_key,
    requested_at,updated_at
  ) VALUES
    (
      v_first,'rsvp_contribution',v_first,v_first,v_brand,v_event,
      'rsvp_discretionary','system','SC27 first','stripe','USD',1000,1000,0,
      'queued',0,0,'not_required','not_required','pending',1000,0,
      'pi_sc27_first','issue-1221-sc27-first-'||v_first,
      '2030-01-03T00:00:00Z','2030-01-03T00:00:00Z'
    ),
    (
      v_second,'rsvp_contribution',v_second,v_second,v_brand,v_event,
      'rsvp_discretionary','system','SC27 second','stripe','USD',1000,1000,0,
      'queued',0,0,'not_required','not_required','pending',1000,0,
      'pi_sc27_second','issue-1221-sc27-second-'||v_second,
      '2030-01-02T00:00:00Z','2030-01-02T00:00:00Z'
    ),
    (
      v_unseen,'rsvp_contribution',v_unseen,v_unseen,v_brand,v_event,
      'rsvp_discretionary','system','SC27 unseen','stripe','USD',1000,1000,0,
      'queued',0,0,'not_required','not_required','pending',1000,0,
      'pi_sc27_unseen','issue-1221-sc27-unseen-'||v_unseen,
      v_captured_unseen_updated_at,v_captured_unseen_updated_at
    );

  v_filters:=jsonb_build_object(
    'brandId',v_brand::text,
    'sourceType',jsonb_build_array('rsvp_contribution')
  );
  SELECT * INTO STRICT v_page_1
  FROM public.admin_list_source_refund_operations(
    v_admin,v_filters,repeat('d',64),NULL,0,1
  );
  IF v_page_1.item_count<>3
     OR jsonb_array_length(v_page_1.items)<>1
     OR (v_page_1.items->0->>'ordinal')::integer<>0
     OR (v_page_1.items->0->>'itemId')::uuid<>v_first THEN
    RAISE EXCEPTION 'sc27_page_1_capture_failed';
  END IF;

  -- Move the unseen third row ahead of the page-one timestamp. A mutable
  -- DESC (updated_at,id) cursor would now skip it permanently.
  UPDATE public.source_refunds
  SET updated_at='2030-01-04T00:00:00Z'
  WHERE id=v_unseen;

  SELECT * INTO STRICT v_page_2
  FROM public.admin_list_source_refund_operations(
    v_admin,v_filters,repeat('d',64),v_page_1.snapshot_id,1,NULL
  );
  SELECT * INTO STRICT v_page_3
  FROM public.admin_list_source_refund_operations(
    v_admin,v_filters,repeat('d',64),v_page_1.snapshot_id,2,NULL
  );

  v_seen:=ARRAY[
    (v_page_1.items->0->>'itemId')::uuid,
    (v_page_2.items->0->>'itemId')::uuid,
    (v_page_3.items->0->>'itemId')::uuid
  ];
  SELECT count(*) INTO v_seen_count
  FROM unnest(v_seen) AS seen(id)
  WHERE id=v_unseen;
  IF v_seen<>ARRAY[v_first,v_second,v_unseen]
     OR v_seen_count<>1
     OR (v_page_2.items->0->>'ordinal')::integer<>1
     OR (v_page_3.items->0->>'ordinal')::integer<>2
     OR (v_page_3.items->0->'safeSummary'->>'updatedAt')::timestamptz
       <>v_captured_unseen_updated_at
     OR (SELECT updated_at FROM public.source_refunds WHERE id=v_unseen)
       =v_captured_unseen_updated_at THEN
    RAISE EXCEPTION 'sc27_snapshot_membership_order_or_exactly_once_failed';
  END IF;
END $$;

-- Legacy Paystack venue-attempt adoption is executable, replay-safe, and
-- activation-blocking for every ambiguous evidence class.
DO $$
DECLARE
  v_owner uuid:=gen_random_uuid();
  v_brand uuid:=gen_random_uuid();
  v_venue uuid:=gen_random_uuid();
  v_reservation uuid;
  v_session uuid;
  v_attempt uuid;
  v_pending_attempt uuid;
  v_pending_refund uuid;
  v_processed_reservation uuid;
  v_processed_session uuid;
  v_processed_release uuid;
  v_status text;
  v_index integer:=0;
  v_before_events integer;
  v_before_allocations integer;
  v_before_adjustments integer;
  v_result jsonb;
  v_failed boolean:=false;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_owner,'issue1221-adoption@example.test');
  INSERT INTO public.creator_accounts(id,email)
  VALUES(v_owner,'issue1221-adoption@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider
  ) VALUES(
    v_brand,v_owner,'Issue 1221 Adoption',
    'issue1221adoption'||substr(replace(v_brand::text,'-',''),1,8),
    'NGN','paystack'
  );
  INSERT INTO public.venue_listings(
    id,brand_id,slug,name,lat,lng,venue_category,claim_status
  ) VALUES(
    v_venue,v_brand,'adoptionfixture','Adoption Fixture',6.45,3.47,
    'restaurant','verified'
  );

  FOREACH v_status IN ARRAY ARRAY['pending','accepted','processed','failed']
  LOOP
    v_index:=v_index+1;
    v_reservation:=gen_random_uuid();
    v_session:=gen_random_uuid();
    v_attempt:=gen_random_uuid();
    INSERT INTO public.reservations(
      id,brand_id,venue_id,reserved_for,party_size,status,source,created_via,
      fee_cents,fee_currency,payment_intent_id,payment_status
    ) VALUES(
      v_reservation,v_brand,v_venue,now()+interval '10 days',2,
      'cancelled_by_guest','website','consumer',10000,'NGN',
      'legacy-ref-'||v_index,'paid'
    );
    INSERT INTO public.reservation_checkout_sessions(
      id,brand_id,venue_id,reserved_for,party_size,buyer_name,buyer_email,
      buyer_phone_e164,amount_cents,currency,paystack_reference,created_via,
      status,reservation_id,application_fee_amount_cents
    ) VALUES(
      v_session,v_brand,v_venue,now()+interval '10 days',2,'Legacy Guest',
      'legacy@example.test','+2348000000000',10000,'NGN',
      'legacy-ref-'||v_index,'web','completed',v_reservation,1500
    );
    INSERT INTO public.paystack_refund_attempts(
      id,source_type,source_id,transaction_reference,merchant_note,
      provider_refund_id,amount_cents,currency,status,idempotency_key,
      created_at,updated_at
    ) VALUES(
      v_attempt,'venue_reservation',v_session,'legacy-ref-'||v_index,
      'mingla_venue_refund:'||v_reservation,
      CASE WHEN v_status IN ('accepted','processed') THEN 'provider-'||v_index ELSE NULL END,
      10000,'ngn',v_status,'paystack-refund:legacy-'||v_attempt,
      now()-interval '2 days',now()-interval '1 day'
    );
    IF v_status='pending' THEN
      v_pending_attempt:=v_attempt;
    ELSIF v_status='processed' THEN
      v_processed_reservation:=v_reservation;
      v_processed_session:=v_session;
      v_processed_release:=gen_random_uuid();
      INSERT INTO public.brand_payout_releases(
        id,brand_id,occurrence_key,surface,provider,currency,
        anchor_end_at,releasable_at,gross_cents,mingla_fee_cents,
        net_release_cents,organiser_cash_delivered_cents,status,released_at
      ) VALUES(
        v_processed_release,v_brand,'legacy-processed-'||v_session,
        'venue_reservation','paystack','ngn',
        now()-interval '5 days',now()-interval '2 days',10000,1500,
        8500,8500,'released',now()-interval '2 days'
      );
      INSERT INTO public.payout_release_items(
        release_id,source_type,source_id,gross_cents,mingla_fee_cents,
        net_cents,source_finalized_at
      ) VALUES(
        v_processed_release,'venue_reservation',v_session,10000,1500,
        8500,now()-interval '5 days'
      );
    END IF;
  END LOOP;

  -- Missing checkout-session evidence.
  v_attempt:=gen_random_uuid();
  INSERT INTO public.paystack_refund_attempts(
    id,source_type,source_id,transaction_reference,merchant_note,
    amount_cents,currency,status,idempotency_key
  ) VALUES(
    v_attempt,'venue_reservation',gen_random_uuid(),'missing-ref',
    'mingla_venue_refund:'||gen_random_uuid(),10000,'ngn','pending',
    'paystack-refund:missing-'||v_attempt
  );

  -- Three complete sources with one conflicting reference, amount, or currency.
  FOR v_index IN 5..7 LOOP
    v_reservation:=gen_random_uuid();
    v_session:=gen_random_uuid();
    v_attempt:=gen_random_uuid();
    INSERT INTO public.reservations(
      id,brand_id,venue_id,reserved_for,party_size,status,source,created_via,
      fee_cents,fee_currency,payment_intent_id,payment_status
    ) VALUES(
      v_reservation,v_brand,v_venue,now()+interval '10 days',2,
      'cancelled_by_guest','website','consumer',10000,'NGN',
      'conflict-ref-'||v_index,'paid'
    );
    INSERT INTO public.reservation_checkout_sessions(
      id,brand_id,venue_id,reserved_for,party_size,buyer_name,buyer_email,
      buyer_phone_e164,amount_cents,currency,paystack_reference,created_via,
      status,reservation_id,application_fee_amount_cents
    ) VALUES(
      v_session,v_brand,v_venue,now()+interval '10 days',2,'Conflict Guest',
      'conflict@example.test','+2348000000001',10000,'NGN',
      'conflict-ref-'||v_index,'web','completed',v_reservation,1500
    );
    INSERT INTO public.paystack_refund_attempts(
      id,source_type,source_id,transaction_reference,merchant_note,
      amount_cents,currency,status,idempotency_key
    ) VALUES(
      v_attempt,'venue_reservation',v_session,
      CASE WHEN v_index=5 THEN 'wrong-reference' ELSE 'conflict-ref-'||v_index END,
      'mingla_venue_refund:'||v_reservation,
      CASE WHEN v_index=6 THEN 9999 ELSE 10000 END,
      CASE WHEN v_index=7 THEN 'usd' ELSE 'ngn' END,
      'pending','paystack-refund:conflict-'||v_attempt
    );
  END LOOP;

  -- Unknown status is executable only after relaxing the legacy table's old
  -- input constraint inside this rollback-only adversarial fixture.
  ALTER TABLE public.paystack_refund_attempts
    DROP CONSTRAINT paystack_refund_attempts_status_check;
  v_reservation:=gen_random_uuid();
  v_session:=gen_random_uuid();
  v_attempt:=gen_random_uuid();
  INSERT INTO public.reservations(
    id,brand_id,venue_id,reserved_for,party_size,status,source,created_via,
    fee_cents,fee_currency,payment_intent_id,payment_status
  ) VALUES(
    v_reservation,v_brand,v_venue,now()+interval '10 days',2,
    'cancelled_by_guest','website','consumer',10000,'NGN',
    'unknown-ref','paid'
  );
  INSERT INTO public.reservation_checkout_sessions(
    id,brand_id,venue_id,reserved_for,party_size,buyer_name,buyer_email,
    buyer_phone_e164,amount_cents,currency,paystack_reference,created_via,
    status,reservation_id,application_fee_amount_cents
  ) VALUES(
    v_session,v_brand,v_venue,now()+interval '10 days',2,'Unknown Guest',
    'unknown@example.test','+2348000000002',10000,'NGN','unknown-ref',
    'web','completed',v_reservation,1500
  );
  INSERT INTO public.paystack_refund_attempts(
    id,source_type,source_id,transaction_reference,merchant_note,
    amount_cents,currency,status,idempotency_key
  ) VALUES(
    v_attempt,'venue_reservation',v_session,'unknown-ref',
    'mingla_venue_refund:'||v_reservation,10000,'ngn','mystery',
    'paystack-refund:unknown-'||v_attempt
  );

  v_result:=public.adopt_legacy_venue_paystack_refund_attempts();
  IF (v_result->>'adopted')::integer<>4
     OR (v_result->>'exceptions')::integer<>5
     OR (v_result->>'provider_calls')::integer<>0 THEN
    RAISE EXCEPTION 'legacy_adoption_count_or_network_contract_failed_%',v_result;
  END IF;
  IF (SELECT count(*) FROM public.source_refunds WHERE brand_id=v_brand)<>4
     OR (SELECT count(*) FROM public.source_refund_legacy_adoption_exceptions
         WHERE resolved_at IS NULL)<>5 THEN
    RAISE EXCEPTION 'legacy_adoption_or_exception_rows_failed';
  END IF;
  SELECT refund_id INTO v_pending_refund FROM public.source_refund_attempts
  WHERE id=v_pending_attempt;
  v_result:=public.ensure_source_refund_attempt(v_pending_refund,'buyer_refund');
  IF (v_result->>'attempt_no')::integer<>1
     OR v_result->>'idempotency_key'<>
       'paystack-refund:legacy-'||v_pending_attempt
     OR v_result->>'merchant_note' IS DISTINCT FROM (
       SELECT merchant_note FROM public.paystack_refund_attempts
       WHERE id=v_pending_attempt
     )
     OR (v_result->>'reconcile_only')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'legacy_conflict_winner_identity_failed_%',v_result;
  END IF;
  IF (SELECT payment_status FROM public.reservations
      WHERE id=v_processed_reservation)<>'refunded' THEN
    RAISE EXCEPTION 'legacy_processed_projection_failed';
  END IF;
  IF (SELECT count(*) FROM public.payout_ledger_adjustments
      WHERE release_id=v_processed_release
        AND kind='post_release_refund'
        AND amount_cents=8500)<>1
     OR (SELECT count(*) FROM public.organiser_payout_debts
         WHERE origin_release_id=v_processed_release
           AND kind='post_release_refund'
           AND principal_cents=8500)<>1
     OR (SELECT count(*) FROM public.source_refund_ledger_allocations
         WHERE refund_id=(
           SELECT id FROM public.source_refunds
           WHERE source_id=v_processed_session
         )
           AND state='posted')<>3 THEN
    RAISE EXCEPTION 'legacy_processed_exact_liability_failed';
  END IF;

  SELECT count(*) INTO v_before_events FROM public.source_refund_events
  WHERE refund_id IN(SELECT id FROM public.source_refunds WHERE brand_id=v_brand);
  SELECT count(*) INTO v_before_allocations
  FROM public.source_refund_ledger_allocations
  WHERE refund_id IN(SELECT id FROM public.source_refunds WHERE brand_id=v_brand);
  SELECT count(*) INTO v_before_adjustments
  FROM public.payout_ledger_adjustments
  WHERE idempotency_key LIKE 'source-refund-liability:%';
  v_result:=public.adopt_legacy_venue_paystack_refund_attempts();
  IF (SELECT count(*) FROM public.source_refund_events
      WHERE refund_id IN(SELECT id FROM public.source_refunds WHERE brand_id=v_brand))
       <>v_before_events
     OR (SELECT count(*) FROM public.source_refund_ledger_allocations
         WHERE refund_id IN(SELECT id FROM public.source_refunds WHERE brand_id=v_brand))
       <>v_before_allocations
     OR (SELECT count(*) FROM public.payout_ledger_adjustments
         WHERE idempotency_key LIKE 'source-refund-liability:%')
       <>v_before_adjustments THEN
    RAISE EXCEPTION 'legacy_adoption_replay_duplicated_truth';
  END IF;
  BEGIN
    PERFORM public.assert_legacy_venue_paystack_adoption_ready();
  EXCEPTION WHEN OTHERS THEN
    v_failed:=SQLERRM LIKE '%issue_1221_legacy_venue_paystack_adoption_blocked%';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'legacy_exception_did_not_block_activation';
  END IF;
END $$;

-- A11/A12 executable recovery: correction is send-dark, records only HMACs,
-- and the subsequent generation change creates a claimable dedicated row.
DO $$
DECLARE
  v_admin uuid:=gen_random_uuid();
  v_owner uuid:=gen_random_uuid();
  v_brand uuid:=gen_random_uuid();
  v_venue uuid:=gen_random_uuid();
  v_reservation uuid:=gen_random_uuid();
  v_session uuid:=gen_random_uuid();
  v_refund uuid:=gen_random_uuid();
  v_event bigint;
  v_outbox uuid;
  v_sms_outbox uuid;
  v_delivery uuid;
  v_after_hmac text:='v1:currentkid:'||repeat('B',43);
  v_before_hmac text:='v1:oldkid:'||repeat('A',43);
  v_recipient_key bytea:=decode(repeat('01',32),'hex');
  v_recipient_key_b64 text;
  v_current_email_hmac text;
  v_current_sms_hmac text;
  v_before_sms_hmac text:='v1:oldkid:'||repeat('D',43);
  v_result jsonb;
  v_failed boolean:=false;
  v_before_outboxes integer;
BEGIN
  v_recipient_key_b64:=encode(v_recipient_key,'base64');
  v_current_email_hmac:='v1:currentkid:'||
    rtrim(translate(encode(extensions.hmac(
      convert_to('source_refund_notification_recipient:v1','UTF8')||
      decode('00','hex')||convert_to('currentkid','UTF8')||
      decode('00','hex')||convert_to('email','UTF8')||
      decode('00','hex')||convert_to('new-recipient@example.test','UTF8'),
      v_recipient_key,'sha256'
    ),'base64'),'+/','-_'),'=');
  v_current_sms_hmac:='v1:currentkid:'||
    rtrim(translate(encode(extensions.hmac(
      convert_to('source_refund_notification_recipient:v1','UTF8')||
      decode('00','hex')||convert_to('currentkid','UTF8')||
      decode('00','hex')||convert_to('sms','UTF8')||
      decode('00','hex')||convert_to('+2348000000011','UTF8'),
      v_recipient_key,'sha256'
    ),'base64'),'+/','-_'),'=');
  INSERT INTO auth.users(id,email) VALUES
    (v_admin,'issue1221-recovery-admin@example.test'),
    (v_owner,'issue1221-recovery-owner@example.test');
  INSERT INTO public.admin_users(id,email,status,accepted_at)
  VALUES(v_admin,'issue1221-recovery-admin@example.test','active',now());
  INSERT INTO public.creator_accounts(id,email)
  VALUES(v_owner,'issue1221-recovery-owner@example.test');
  INSERT INTO public.brands(
    id,account_id,name,slug,default_currency,payment_provider
  ) VALUES(
    v_brand,v_owner,'Issue 1221 Recovery',
    'issue1221recovery'||substr(replace(v_brand::text,'-',''),1,8),
    'NGN','paystack'
  );
  INSERT INTO public.venue_listings(
    id,brand_id,slug,name,lat,lng,venue_category,claim_status
  ) VALUES(
    v_venue,v_brand,'recoveryfixture','Recovery Fixture',6.45,3.47,
    'restaurant','verified'
  );
  INSERT INTO public.reservations(
    id,brand_id,venue_id,reserved_for,party_size,status,source,created_via,
    fee_cents,fee_currency,payment_intent_id,payment_status
  ) VALUES(
    v_reservation,v_brand,v_venue,now()+interval '10 days',2,
    'cancelled_by_guest','website','consumer',10000,'NGN',
    'recovery-reference','paid'
  );
  INSERT INTO public.reservation_checkout_sessions(
    id,brand_id,venue_id,reserved_for,party_size,buyer_name,buyer_email,
    buyer_phone_e164,amount_cents,currency,paystack_reference,created_via,
    status,reservation_id,application_fee_amount_cents
  ) VALUES(
    v_session,v_brand,v_venue,now()+interval '10 days',2,'Recovery Guest',
    'old-recipient@example.test','+2348000000011',10000,'NGN',
    'recovery-reference','web','completed',v_reservation,1500
  );
  INSERT INTO public.source_refunds(
    id,source_type,source_id,subject_id,brand_id,venue_id,refund_kind,
    requested_by_type,reason,provider,currency,original_charge_cents,
    buyer_refund_requested_cents,buyer_refund_processed_cents,buyer_state,
    fee_reversal_required_cents,fee_reversal_processed_cents,fee_state,
    fee_leg_kind,financial_state,organizer_refund_liability_cents,
    platform_fee_absorption_cents,provider_payment_reference,idempotency_key,
    ops_status,attention_generation,attention_action_type,attention_expires_at,
    attention_message_code,attention_token_hash,attention_token_key_id
  ) VALUES(
    v_refund,'venue_reservation',v_session,v_reservation,v_brand,v_venue,
    'venue_eligible_cancel','guest','Recovery test','paystack','NGN',
    10000,10000,0,'needs_attention',1500,0,'queued',
    'paystack_ledger_allocation','needs_attention',8500,1500,
    'recovery-reference','source-refund-recovery-'||v_refund,
    'needs_review',3,'bank_details',now()+interval '72 hours',
    'bank_details_required','v1:tokenkid:'||repeat('a',64),'tokenkid'
  );
  INSERT INTO public.source_refund_events(
    refund_id,event_key,event_type,actor_type,safe_reason_code
  ) VALUES(
    v_refund,'recovery-initial:'||v_refund,'notification_enqueued',
    'system','attention_required'
  ) RETURNING id INTO v_event;
  INSERT INTO public.notification_outbox(
    category_key,brand_id,payload,idempotency_key,status,channel,
    notification_group_key,contract_version,attention_generation,
    source_refund_event_id,next_attempt_at,brand_name_snapshot
  ) VALUES(
    'source_refund_buyer_state',v_brand,
    jsonb_build_object(
      'message','Action needed','state','needs_attention',
      'source_refund_id',v_refund,'audience','buyer'
    ),
    'source_refund:old:'||v_refund,'pending','email',
    'source_refund:'||v_refund||':3',9,3,v_event,now(),'Mingla'
  ) RETURNING id INTO v_outbox;
  INSERT INTO public.notification_outbox(
    category_key,brand_id,payload,idempotency_key,status,channel,
    notification_group_key,contract_version,attention_generation,
    source_refund_event_id,next_attempt_at,brand_name_snapshot
  ) VALUES(
    'source_refund_buyer_state',v_brand,
    jsonb_build_object(
      'message','Action needed','state','needs_attention',
      'source_refund_id',v_refund,'audience','buyer'
    ),
    'source_refund:old-sms:'||v_refund,'pending','sms',
    'source_refund:'||v_refund||':3',9,3,v_event,now(),'Mingla'
  ) RETURNING id INTO v_sms_outbox;
  INSERT INTO public.source_refund_notification_deliveries(
    refund_id,source_refund_event_id,outbox_id,attention_generation,audience,
    channel,recipient_revision,recipient_key_id,recipient_fingerprint,
    payload_fingerprint,serializer_version,idempotency_key,status,next_attempt_at
  ) VALUES(
    v_refund,v_event,v_outbox,3,'buyer','email',0,'oldkid',v_before_hmac,
    repeat('a',64),9,'source_refund:old:'||v_refund,'queued',now()
  ) RETURNING id INTO v_delivery;
  INSERT INTO public.source_refund_notification_deliveries(
    refund_id,source_refund_event_id,outbox_id,attention_generation,audience,
    channel,recipient_revision,recipient_key_id,recipient_fingerprint,
    payload_fingerprint,serializer_version,idempotency_key,status,next_attempt_at
  ) VALUES(
    v_refund,v_event,v_sms_outbox,3,'buyer','sms',0,'oldkid',
    v_before_sms_hmac,repeat('a',64),9,
    'source_refund:old-sms:'||v_refund,'queued',now()
  );
  SELECT count(*) INTO v_before_outboxes
  FROM public.notification_outbox WHERE source_refund_event_id=v_event;

  PERFORM set_config(
    'request.headers',
    jsonb_build_object('x-source-refund-recipient-hmac',v_after_hmac)::text,
    true
  );
  v_result:=public.admin_request_source_refund_attention_recovery(
    v_refund,'correct_attention_contact',3,NULL,'email',
    'new-recipient@example.test','recipient_updated_contact',
    v_admin,'issue1221-recovery-admin@example.test'
  );
  IF v_result->'recovery'->>'contactRevision'<>'1'
     OR (SELECT attention_recipient_email_override
         FROM public.source_refunds WHERE id=v_refund)
       <>'new-recipient@example.test'
     OR (SELECT buyer_email FROM public.reservation_checkout_sessions
         WHERE id=v_session)<>'old-recipient@example.test'
     OR (SELECT attention_token_hash FROM public.source_refunds
         WHERE id=v_refund) IS NOT NULL
     OR (SELECT status FROM public.source_refund_notification_deliveries
         WHERE id=v_delivery)<>'superseded'
     OR (SELECT count(*) FROM public.notification_outbox
         WHERE source_refund_event_id=v_event)<>v_before_outboxes THEN
    RAISE EXCEPTION 'attention_contact_correction_contract_failed_%',v_result;
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.source_refund_events e
    WHERE e.refund_id=v_refund AND e.event_type='attention_contact_corrected'
      AND e.safe_payload->>'beforeRecipientHmac'=v_before_hmac
      AND e.safe_payload->>'afterRecipientHmac'=v_after_hmac
      AND e.safe_payload::text NOT LIKE '%new-recipient@example.test%'
      AND e.safe_payload::text NOT LIKE '%old-recipient@example.test%'
  ) THEN
    RAISE EXCEPTION 'attention_contact_hmac_audit_failed';
  END IF;

  PERFORM set_config(
    'request.headers',
    jsonb_build_object(
      'x-source-refund-recipient-kid','currentkid',
      'x-source-refund-recipient-key-b64',v_recipient_key_b64
    )::text,
    true
  );
  v_result:=public.admin_request_source_refund_attention_recovery(
    v_refund,'invalidate_and_resend_attention',3,NULL,NULL,NULL,
    'recipient_contact_corrected',v_admin,
    'issue1221-recovery-admin@example.test'
  );
  IF v_result->'recovery'->>'generation'<>'4'
     OR (SELECT attention_generation FROM public.source_refunds
         WHERE id=v_refund)<>4
     OR (SELECT count(*) FROM public.source_refund_notification_deliveries
         WHERE refund_id=v_refund AND attention_generation=4)<>2
     OR NOT EXISTS(
    SELECT 1 FROM public.source_refund_notification_deliveries d
    JOIN public.notification_outbox o ON o.id=d.outbox_id
    WHERE d.refund_id=v_refund AND d.attention_generation=4
      AND d.recipient_revision=1 AND d.recipient_key_id='currentkid'
      AND d.recipient_fingerprint=v_current_email_hmac
      AND d.status='queued' AND o.status='pending' AND o.contact IS NULL
      AND o.idempotency_key=
        'source_refund:'||v_refund||':'||d.source_refund_event_id||
        ':4:buyer:email'
  )
     OR NOT EXISTS(
    SELECT 1 FROM public.source_refund_notification_deliveries d
    JOIN public.notification_outbox o ON o.id=d.outbox_id
    WHERE d.refund_id=v_refund AND d.attention_generation=4
      AND d.channel='sms' AND d.recipient_revision=1
      AND d.recipient_key_id='currentkid'
      AND d.recipient_fingerprint=v_current_sms_hmac
      AND d.status='queued' AND o.status='pending' AND o.contact IS NULL
      AND o.idempotency_key=
        'source_refund:'||v_refund||':'||d.source_refund_event_id||
        ':4:buyer:sms'
  ) THEN
    RAISE EXCEPTION 'attention_regeneration_delivery_materialization_failed_%',
      v_result;
  END IF;
  BEGIN
    PERFORM public.admin_request_source_refund_attention_recovery(
      v_refund,'invalidate_and_resend_attention',3,NULL,NULL,NULL,
      'recipient_contact_corrected',v_admin,
      'issue1221-recovery-admin@example.test'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed:=SQLERRM LIKE '%attention_recovery_conflict%';
  END;
  IF NOT v_failed
     OR (SELECT attention_generation FROM public.source_refunds
         WHERE id=v_refund)<>4
     OR (SELECT count(*) FROM public.source_refund_notification_deliveries
         WHERE refund_id=v_refund AND attention_generation=4)<>2 THEN
    RAISE EXCEPTION 'attention_regeneration_replay_not_rejected';
  END IF;
END $$;
ROLLBACK;
