\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE statuses text[];
BEGIN
  SELECT array_agg(x ORDER BY x) INTO statuses FROM unnest(ARRAY[
    'awaiting_application_fee','application_fee_timeout','application_fee_conflict',
    'rejected_preflight','pending_visibility','succeeded_positive',
    'fee_evidence_unavailable','evidence_conflict','not_applicable','unknown_legacy'
  ]) x;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='ticket_refund_attempts') THEN RAISE EXCEPTION 'attempt table missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='ticket_refund_fee_evidence') THEN RAISE EXCEPTION 'evidence table missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='ticket_refund_quarantine') THEN RAISE EXCEPTION 'quarantine table missing'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='refunds'
    AND column_name='application_fee_refunded_cents' AND is_nullable<>'YES') THEN RAISE EXCEPTION 'fee amount must be nullable'; END IF;
  IF has_table_privilege('authenticated','public.ticket_refund_attempts','INSERT')
    OR has_table_privilege('authenticated','public.ticket_refund_attempts','UPDATE') THEN RAISE EXCEPTION 'client can mutate attempts'; END IF;
  IF has_function_privilege('authenticated','public.issue_2097_finalize_refund_attempt(uuid,uuid,bigint,text,text,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'client can finalize'; END IF;
END $$;

DO $$ DECLARE definition text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
    WHERE conname='ticket_refund_attempt_amount_check';
  IF definition IS NULL OR definition NOT LIKE '%succeeded_positive%[1-9]%'
    OR definition NOT LIKE '%not_applicable%fee_refund_amount_text = ''0''%' THEN
    RAISE EXCEPTION 'positive/zero truth constraint drifted: %',definition;
  END IF;
END $$;

DO $$ DECLARE body text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO body FROM pg_proc p
    WHERE p.proname='issue_2097_finalize_refund_attempt';
  IF body NOT LIKE '%v_attempt_count=v_expected_count%'
    OR body NOT LIKE '%a.refund_id=v.refund_id%'
    OR body NOT LIKE '%ticket_refund_quarantine%' THEN
    RAISE EXCEPTION 'multi-attempt aggregate/quarantine finalization drifted';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO body FROM pg_proc p
    WHERE p.proname='issue_2097_prepare_refund_attempt';
  IF body NOT LIKE '%provider_call_permitted%false%'
    OR body LIKE '%v_existing.provider_call_permitted_at%IS NOT NULL%' THEN
    RAISE EXCEPTION 'durable replay can repeat provider mutation';
  END IF;
END $$;

DO $$ DECLARE body text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO body FROM pg_proc p
    WHERE p.proname='issue_2097_record_pre_refund_state';
  IF body NOT LIKE '%next_observation_at IS NOT NULL%' OR body NOT LIKE '%next_observation_at > now()%'
    OR body NOT LIKE '%observation_result%retry_not_due%'
    OR body NOT LIKE '%p_status = ''application_fee_conflict''%' OR body NOT LIKE '%status = ''application_fee_conflict''%'
    OR body NOT LIKE '%interval ''5 seconds''%interval ''30 seconds''%interval ''2 minutes''%interval ''10 minutes''%interval ''30 minutes''%interval ''2 hours''%interval ''24 hours''%' THEN
    RAISE EXCEPTION 'pre-refund due/conflict/eight-observation owner drifted';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO body FROM pg_proc p
    WHERE p.proname='issue_2097_record_pending_observation';
  IF body NOT LIKE '%stale_refund_lease%'
    OR body NOT LIKE '%next_observation_at IS NOT NULL%' OR body NOT LIKE '%next_observation_at>now()%'
    OR body NOT LIKE '%fee_evidence_unavailable%'
    OR body NOT LIKE '%observation_count=v_new_count%' THEN
    RAISE EXCEPTION 'post-refund durable observation/exhaustion owner drifted';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO body FROM pg_proc p
    WHERE p.proname='issue_2097_claim_refund_attempt';
  IF body NOT LIKE '%status%retry_not_due%'
    OR body NOT LIKE '%next_observation_at IS NOT NULL%' OR body NOT LIKE '%next_observation_at > now()%' THEN
    RAISE EXCEPTION 'claim permits an early provider observation';
  END IF;
END $$;

DO $$ DECLARE fn regprocedure;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.issue_2097_prepare_refund_attempt(uuid,text,text,text,text,text,text,text,text,text,text,jsonb,text,boolean,integer,uuid)'::regprocedure,
    'public.issue_2097_record_pre_refund_state(uuid,text,text,text,text,text,text,text,text,text,text,integer,uuid)'::regprocedure,
    'public.issue_2097_record_buyer_refund(uuid,uuid,bigint,text,text)'::regprocedure,
    'public.issue_2097_record_pending_observation(uuid,uuid,bigint,text)'::regprocedure,
    'public.issue_2097_finalize_refund_attempt(uuid,uuid,bigint,text,text,text,text,text)'::regprocedure,
    'public.issue_2097_claim_refund_attempt(uuid,uuid)'::regprocedure
  ] LOOP
    IF has_function_privilege('anon',fn,'EXECUTE') OR has_function_privilege('authenticated',fn,'EXECUTE')
      OR NOT has_function_privilege('service_role',fn,'EXECUTE') THEN
      RAISE EXCEPTION 'service-only RPC grant drifted for %',fn;
    END IF;
  END LOOP;
  IF has_table_privilege('anon','public.ticket_refund_attempts','SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('authenticated','public.ticket_refund_attempts','SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('anon','public.ticket_refund_fee_evidence','SELECT,INSERT,UPDATE,DELETE')
    OR has_table_privilege('authenticated','public.ticket_refund_fee_evidence','SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'evidence tables leaked to client roles';
  END IF;
END $$;

SET LOCAL session_replication_role = replica;
DO $$
DECLARE
  v_event uuid:=gen_random_uuid(); v_type uuid:=gen_random_uuid();
  v_order uuid:=gen_random_uuid(); v_refund uuid:=gen_random_uuid(); v_attempt uuid:=gen_random_uuid();
  v_owner uuid:=gen_random_uuid(); v_other uuid:=gen_random_uuid(); v_result jsonb; i integer;
  v_no_fee_order uuid:=gen_random_uuid(); v_no_fee_refund uuid:=gen_random_uuid();
  v_no_fee_attempt uuid:=gen_random_uuid(); v_ticket uuid:=gen_random_uuid();
BEGIN
  INSERT INTO public.orders(id,event_id,total_cents,currency,payment_status,source)
    VALUES(v_order,v_event,100,'USD','paid','legacy'),(v_no_fee_order,v_event,100,'USD','paid','legacy');
  INSERT INTO public.refunds(id,order_id,amount_cents,currency,status,reason,
    application_fee_refund_status,buyer_refund_status)
    VALUES(v_refund,v_order,100,'USD','pending','issue 2097 test','pending_visibility','succeeded'),
      (v_no_fee_refund,v_no_fee_order,100,'USD','pending','issue 2097 test','pending_visibility','succeeded');
  INSERT INTO public.ticket_refund_attempts(id,refund_id,order_id,request_fingerprint,provider,provider_mode,
    connected_account_id,currency,charge_id,payment_intent_id,application_fee_id,application_fee_amount_text,
    captured_charge_amount_text,requested_refund_amount_text,baseline_amount_refunded_text,buyer_refund_id,
    buyer_refund_amount_text,buyer_refunded_at,status,observation_count,next_observation_at,lease_owner,
    lease_epoch,lease_expires_at,provider_call_permitted_at)
  VALUES(v_attempt,v_refund,v_order,'pending-matrix','stripe','test','acct_test','USD','ch_test','pi_test',
    'fee_test','25','100','100','0','re_test','100',now(),'pending_visibility',0,now()+interval '5 seconds',
    v_owner,1,now()+interval '120 seconds',now());

  v_result:=public.issue_2097_claim_refund_attempt(v_attempt,v_owner);
  IF v_result->>'status'<>'retry_not_due' OR (SELECT observation_count FROM public.ticket_refund_attempts WHERE id=v_attempt)<>0 THEN
    RAISE EXCEPTION 'not-due claim changed the durable observation';
  END IF;
  BEGIN
    PERFORM public.issue_2097_record_pending_observation(v_attempt,v_other,1,'0');
    RAISE EXCEPTION 'stale lease was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%stale_refund_lease%' THEN RAISE; END IF;
  END;
  FOR i IN 1..8 LOOP
    UPDATE public.ticket_refund_attempts SET next_observation_at=now()-interval '1 second' WHERE id=v_attempt;
    v_result:=public.issue_2097_record_pending_observation(v_attempt,v_owner,1,'0');
    IF (v_result->>'observation_count')::integer<>i THEN RAISE EXCEPTION 'observation % not durable',i; END IF;
  END LOOP;
  IF v_result->>'status'<>'fee_evidence_unavailable' THEN RAISE EXCEPTION 'eighth observation did not exhaust'; END IF;
  PERFORM public.issue_2097_finalize_refund_attempt(v_attempt,v_owner,1,'fee_evidence_unavailable',NULL,NULL,'0',NULL);
  IF (SELECT status FROM public.ticket_refund_attempts WHERE id=v_attempt)<>'fee_evidence_unavailable'
     OR (SELECT application_fee_refunded_cents FROM public.refunds WHERE id=v_refund) IS NOT NULL THEN
    RAISE EXCEPTION 'exhaustion fabricated or lost fee truth';
  END IF;

  INSERT INTO public.ticket_refund_attempts(id,refund_id,order_id,request_fingerprint,provider,provider_mode,
    connected_account_id,currency,charge_id,payment_intent_id,application_fee_amount_text,
    captured_charge_amount_text,requested_refund_amount_text,baseline_amount_refunded_text,buyer_refund_id,
    buyer_refund_amount_text,buyer_refunded_at,status,observation_count,lease_owner,lease_epoch,
    lease_expires_at,provider_call_permitted_at)
  VALUES(v_no_fee_attempt,v_no_fee_refund,v_no_fee_order,'no-fee-matrix','stripe','test','acct_test','USD',
    'ch_no_fee','pi_no_fee','0','100','100','0','re_no_fee','100',now(),'pending_visibility',8,
    v_owner,1,now()+interval '120 seconds',now());
  INSERT INTO public.tickets(id,order_id,ticket_type_id,event_id,qr_code,status)
    VALUES(v_ticket,v_no_fee_order,v_type,v_event,'issue-2097-no-fee-ticket','refund_pending');
  INSERT INTO public.ticket_refund_quarantine(attempt_id,ticket_id,prior_status)
    VALUES(v_no_fee_attempt,v_ticket,'valid');
  PERFORM public.issue_2097_finalize_refund_attempt(v_no_fee_attempt,v_owner,1,'not_applicable',NULL,'0','0',NULL);
  IF (SELECT status FROM public.tickets WHERE id=v_ticket)<>'refunded'
     OR (SELECT status FROM public.refunds WHERE id=v_no_fee_refund)<>'succeeded'
     OR (SELECT application_fee_refunded_cents FROM public.refunds WHERE id=v_no_fee_refund)<>0
     OR (SELECT payment_status FROM public.orders WHERE id=v_no_fee_order)<>'refunded' THEN
    RAISE EXCEPTION 'no-fee shared aggregate finalizer left fulfillment or money incomplete';
  END IF;
END $$;

DO $$
DECLARE
  v_event uuid:=gen_random_uuid(); v_order uuid:=gen_random_uuid();
  v_refund uuid:=gen_random_uuid(); v_timeout_refund uuid:=gen_random_uuid();
  v_conflict_refund uuid:=gen_random_uuid(); v_owner uuid:=gen_random_uuid();
  v_result jsonb; v_attempt uuid; i integer;
  v_delays integer[]:=ARRAY[5,30,120,600,1800,7200,86400];
BEGIN
  INSERT INTO public.orders(id,event_id,total_cents,currency,payment_status,source)
    VALUES(v_order,v_event,300,'USD','paid','legacy');
  INSERT INTO public.refunds(id,order_id,amount_cents,currency,status,reason)
    VALUES(v_refund,v_order,100,'USD','pending','issue 2097 no-fee schedule'),
      (v_timeout_refund,v_order,100,'USD','pending','issue 2097 timeout schedule'),
      (v_conflict_refund,v_order,100,'USD','pending','issue 2097 conflict schedule');

  v_result:=public.issue_2097_record_pre_refund_state(v_refund,'no-fee-eight','test','acct_test',
    'USD','ch_no_fee','pi_no_fee','0','100','100','awaiting_application_fee',1,v_owner);
  v_attempt:=(v_result->>'attempt_id')::uuid;
  IF (SELECT observation_count FROM public.ticket_refund_attempts WHERE id=v_attempt)<>1
     OR (v_result->>'provider_call_permitted')::boolean THEN
    RAISE EXCEPTION 'first no-fee observation mutated or failed to persist';
  END IF;
  v_result:=public.issue_2097_record_pre_refund_state(v_refund,'no-fee-eight','test','acct_test',
    'USD','ch_no_fee','pi_no_fee','0','100','100','awaiting_application_fee',1,v_owner);
  IF v_result->>'observation_result'<>'retry_not_due'
     OR (SELECT observation_count FROM public.ticket_refund_attempts WHERE id=v_attempt)<>1 THEN
    RAISE EXCEPTION 'not-due no-fee replay changed durable count';
  END IF;
  FOR i IN 2..7 LOOP
    UPDATE public.ticket_refund_attempts SET next_observation_at=now()-interval '1 second' WHERE id=v_attempt;
    v_result:=public.issue_2097_record_pre_refund_state(v_refund,'no-fee-eight','test','acct_test',
      'USD','ch_no_fee','pi_no_fee','0','100','100','awaiting_application_fee',1,v_owner);
    IF (SELECT observation_count FROM public.ticket_refund_attempts WHERE id=v_attempt)<>i
       OR (v_result->>'provider_call_permitted')::boolean
       OR (SELECT round(extract(epoch FROM (next_observation_at-first_observed_at)))::integer
           FROM public.ticket_refund_attempts WHERE id=v_attempt)<>v_delays[i] THEN
      RAISE EXCEPTION 'no-fee observation % schedule/admission drifted',i;
    END IF;
  END LOOP;
  UPDATE public.ticket_refund_attempts SET next_observation_at=now()-interval '1 second' WHERE id=v_attempt;
  v_result:=public.issue_2097_record_pre_refund_state(v_refund,'no-fee-eight','test','acct_test',
    'USD','ch_no_fee','pi_no_fee','0','100','100','awaiting_application_fee',1,v_owner);
  IF (SELECT observation_count FROM public.ticket_refund_attempts WHERE id=v_attempt)<>8
     OR NOT (v_result->>'provider_call_permitted')::boolean
     OR (SELECT next_observation_at FROM public.ticket_refund_attempts WHERE id=v_attempt) IS NOT NULL THEN
    RAISE EXCEPTION 'eighth no-fee observation did not exclusively admit provider mutation';
  END IF;

  v_result:=public.issue_2097_record_pre_refund_state(v_timeout_refund,'fee-timeout-eight','test','acct_test',
    'USD','ch_timeout','pi_timeout','25','100','100','awaiting_application_fee',1,v_owner);
  v_attempt:=(v_result->>'attempt_id')::uuid;
  FOR i IN 2..8 LOOP
    UPDATE public.ticket_refund_attempts SET next_observation_at=now()-interval '1 second' WHERE id=v_attempt;
    v_result:=public.issue_2097_record_pre_refund_state(v_timeout_refund,'fee-timeout-eight','test','acct_test',
      'USD','ch_timeout','pi_timeout','25','100','100','awaiting_application_fee',1,v_owner);
  END LOOP;
  IF v_result->>'status'<>'application_fee_timeout'
     OR (v_result->>'provider_call_permitted')::boolean THEN
    RAISE EXCEPTION 'eighth positive-fee absence did not stop as application_fee_timeout';
  END IF;

  v_result:=public.issue_2097_record_pre_refund_state(v_conflict_refund,'later-fee-conflict','test','acct_test',
    'USD','ch_conflict','pi_conflict','25','100','100','awaiting_application_fee',1,v_owner);
  v_attempt:=(v_result->>'attempt_id')::uuid;
  v_result:=public.issue_2097_record_pre_refund_state(v_conflict_refund,'later-fee-conflict','test','acct_test',
    'USD','ch_conflict','pi_conflict','25','100','100','application_fee_conflict',1,v_owner);
  IF v_result->>'status'<>'application_fee_conflict'
     OR (SELECT observation_count FROM public.ticket_refund_attempts WHERE id=v_attempt)<>1
     OR (SELECT next_observation_at FROM public.ticket_refund_attempts WHERE id=v_attempt) IS NOT NULL THEN
    RAISE EXCEPTION 'later authentic Fee conflict was lost or counted as absence';
  END IF;
  v_result:=public.issue_2097_record_pre_refund_state(v_conflict_refund,'later-fee-conflict','test','acct_test',
    'USD','ch_conflict','pi_conflict','25','100','100','awaiting_application_fee',1,v_owner);
  IF v_result->>'status'<>'application_fee_conflict'
     OR (SELECT observation_count FROM public.ticket_refund_attempts WHERE id=v_attempt)<>1 THEN
    RAISE EXCEPTION 'Fee conflict replay was not stable';
  END IF;
END $$;

DO $$
DECLARE
  v_event uuid:=gen_random_uuid(); v_order uuid:=gen_random_uuid();
  v_refund uuid:=gen_random_uuid(); v_status text; v_reason text;
  v_accepted boolean; v_amount integer;
BEGIN
  INSERT INTO public.orders(id,event_id,total_cents,currency,payment_status,source)
    VALUES(v_order,v_event,100,'USD','paid','legacy');
  INSERT INTO public.refunds(id,order_id,amount_cents,currency,status,reason)
    VALUES(v_refund,v_order,100,'USD','pending','issue 2097 status reason matrix');
  FOREACH v_status IN ARRAY ARRAY[
    'awaiting_application_fee','application_fee_timeout','application_fee_conflict',
    'rejected_preflight','pending_visibility','succeeded_positive',
    'fee_evidence_unavailable','evidence_conflict','not_applicable','unknown_legacy'
  ] LOOP
    v_amount:=CASE WHEN v_status='succeeded_positive' THEN 1 WHEN v_status='not_applicable' THEN 0 END;
    FOREACH v_reason IN ARRAY ARRAY[
      'invalid_provider_amount','partial_fee_below_provider_cent','fee_preflight_conflict'
    ] LOOP
      v_accepted:=true;
      BEGIN
        UPDATE public.refunds SET application_fee_refund_status=v_status,
          application_fee_refund_terminal_reason=v_reason,
          application_fee_refunded_cents=v_amount WHERE id=v_refund;
      EXCEPTION WHEN check_violation THEN
        v_accepted:=false;
      END;
      IF v_accepted IS DISTINCT FROM (v_status='rejected_preflight') THEN
        RAISE EXCEPTION 'status/reason matrix accepted=% for %/%',v_accepted,v_status,v_reason;
      END IF;
      UPDATE public.refunds SET application_fee_refund_status='unknown_legacy',
        application_fee_refund_terminal_reason=NULL,application_fee_refunded_cents=NULL WHERE id=v_refund;
    END LOOP;
    v_accepted:=true;
    BEGIN
      UPDATE public.refunds SET application_fee_refund_status=v_status,
        application_fee_refund_terminal_reason=NULL,
        application_fee_refunded_cents=v_amount WHERE id=v_refund;
    EXCEPTION WHEN check_violation THEN
      v_accepted:=false;
    END;
    IF v_accepted IS DISTINCT FROM (v_status<>'rejected_preflight') THEN
      RAISE EXCEPTION 'status/null-reason matrix accepted=% for %',v_accepted,v_status;
    END IF;
    UPDATE public.refunds SET application_fee_refund_status='unknown_legacy',
      application_fee_refund_terminal_reason=NULL,application_fee_refunded_cents=NULL WHERE id=v_refund;
  END LOOP;
END $$;

DO $$
DECLARE
  v_event uuid:=gen_random_uuid(); v_type uuid:=gen_random_uuid(); v_order uuid:=gen_random_uuid();
  v_refund uuid:=gen_random_uuid(); v_attempt_one uuid:=gen_random_uuid();
  v_attempt_two uuid:=gen_random_uuid(); v_ticket_one uuid:=gen_random_uuid();
  v_ticket_two uuid:=gen_random_uuid(); v_owner uuid:=gen_random_uuid(); v_result jsonb;
BEGIN
  INSERT INTO public.orders(id,event_id,total_cents,currency,payment_status,source)
    VALUES(v_order,v_event,200,'USD','paid','legacy');
  INSERT INTO public.refunds(id,order_id,amount_cents,currency,status,reason,
    application_fee_refund_status,buyer_refund_status)
    VALUES(v_refund,v_order,200,'USD','pending','issue 2097 multi PI','pending_visibility','succeeded');
  INSERT INTO public.ticket_refund_attempts(id,refund_id,order_id,request_fingerprint,expected_attempt_count,
    provider,provider_mode,connected_account_id,currency,charge_id,payment_intent_id,application_fee_id,
    application_fee_amount_text,captured_charge_amount_text,requested_refund_amount_text,
    baseline_amount_refunded_text,buyer_refund_id,buyer_refund_amount_text,buyer_refunded_at,status,
    lease_owner,lease_epoch,lease_expires_at,provider_call_permitted_at)
  VALUES
    (v_attempt_one,v_refund,v_order,'multi-positive',2,'stripe','test','acct_test','USD','ch_multi_1',
      'pi_multi_1','fee_multi_1','25','100','100','0','re_multi_1','100',now(),'pending_visibility',
      v_owner,1,now()+interval '120 seconds',now()),
    (v_attempt_two,v_refund,v_order,'multi-no-fee',2,'stripe','test','acct_test','USD','ch_multi_2',
      'pi_multi_2',NULL,'0','100','100','0','re_multi_2','100',now(),'pending_visibility',
      v_owner,1,now()+interval '120 seconds',now());
  INSERT INTO public.tickets(id,order_id,ticket_type_id,event_id,qr_code,status)
    VALUES(v_ticket_one,v_order,v_type,v_event,'issue-2097-multi-1','refund_pending'),
      (v_ticket_two,v_order,v_type,v_event,'issue-2097-multi-2','refund_pending');
  INSERT INTO public.ticket_refund_quarantine(attempt_id,ticket_id,prior_status)
    VALUES(v_attempt_one,v_ticket_one,'valid'),(v_attempt_two,v_ticket_two,'valid');

  v_result:=public.issue_2097_finalize_refund_attempt(v_attempt_one,v_owner,1,
    'succeeded_positive','fr_multi_1','25','25',NULL);
  IF v_result->>'aggregate_status'<>'pending_visibility'
     OR (SELECT status FROM public.refunds WHERE id=v_refund)<>'pending'
     OR (SELECT application_fee_refunded_cents FROM public.refunds WHERE id=v_refund) IS NOT NULL
     OR EXISTS(SELECT 1 FROM public.tickets WHERE id IN (v_ticket_one,v_ticket_two) AND status<>'refund_pending') THEN
    RAISE EXCEPTION 'first multi-PI terminal leg escaped the aggregate stop';
  END IF;
  v_result:=public.issue_2097_finalize_refund_attempt(v_attempt_one,v_owner,1,
    'succeeded_positive','fr_multi_1','25','25',NULL);
  IF NOT (v_result->>'idempotent_replay')::boolean
     OR (SELECT count(*) FROM public.ticket_refund_fee_evidence WHERE attempt_id=v_attempt_one)<>1 THEN
    RAISE EXCEPTION 'multi-PI finalizer replay duplicated evidence';
  END IF;
  v_result:=public.issue_2097_finalize_refund_attempt(v_attempt_two,v_owner,1,
    'not_applicable',NULL,'0','0',NULL);
  IF v_result->>'aggregate_status'<>'succeeded_positive'
     OR (SELECT status FROM public.refunds WHERE id=v_refund)<>'succeeded'
     OR (SELECT application_fee_refunded_cents FROM public.refunds WHERE id=v_refund)<>25
     OR EXISTS(SELECT 1 FROM public.tickets WHERE id IN (v_ticket_one,v_ticket_two) AND status<>'refunded')
     OR (SELECT count(*) FROM public.ticket_refund_fee_evidence WHERE attempt_id IN (v_attempt_one,v_attempt_two))<>2 THEN
    RAISE EXCEPTION 'multi-PI terminal convergence did not finalize exact aggregate/quarantine';
  END IF;
END $$;

SET LOCAL session_replication_role = origin;

ROLLBACK;
