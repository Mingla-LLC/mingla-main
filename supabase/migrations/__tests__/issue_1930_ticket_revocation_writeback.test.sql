-- #1930 terminal ticket write-back: every ticket flow converges atomically.
-- Foreign/missing bindings fail closed, retryable truth stays observable, and
-- duplicate result delivery is harmless.
\set ON_ERROR_STOP on

DELETE FROM public.checkout_sale_revocation_outbox
WHERE event_id='19300000-0000-0000-0000-000000000811';
UPDATE public.ticket_checkout_sessions SET provider_attempt_id=NULL
WHERE event_id='19300000-0000-0000-0000-000000000811';
DELETE FROM public.ticket_checkout_provider_attempts
WHERE event_id='19300000-0000-0000-0000-000000000811';
DELETE FROM public.ticket_checkout_sessions
WHERE event_id='19300000-0000-0000-0000-000000000811';
DELETE FROM public.ticket_types
WHERE id='19300000-0000-0000-0000-000000000812';
DELETE FROM public.events
WHERE id='19300000-0000-0000-0000-000000000811';
DELETE FROM public.brands
WHERE id='19300000-0000-0000-0000-000000000810';
DELETE FROM public.creator_accounts
WHERE id='19300000-0000-0000-0000-000000000801';
DELETE FROM auth.users
WHERE id='19300000-0000-0000-0000-000000000801';

INSERT INTO auth.users(id)
VALUES('19300000-0000-0000-0000-000000000801');
INSERT INTO public.creator_accounts(id)
VALUES('19300000-0000-0000-0000-000000000801');
INSERT INTO public.brands(
  id,account_id,name,slug,default_currency,pricing_currency,payment_provider)
VALUES(
  '19300000-0000-0000-0000-000000000810',
  '19300000-0000-0000-0000-000000000801',
  'Issue 1930 writeback','issue-1930-writeback','NGN','NGN','paystack');
INSERT INTO public.events(
  id,brand_id,title,slug,event_type,status,visibility,timezone,currency)
VALUES(
  '19300000-0000-0000-0000-000000000811',
  '19300000-0000-0000-0000-000000000810',
  'Ticket writeback','issue-1930-ticket-writeback','event','scheduled','public','UTC','NGN');
INSERT INTO public.ticket_types(
  id,event_id,name,price_cents,currency,is_free,quantity_total,min_purchase_qty,
  available_online,available_in_person,display_order)
VALUES(
  '19300000-0000-0000-0000-000000000812',
  '19300000-0000-0000-0000-000000000811',
  'Writeback',1000,'NGN',false,100,1,true,false,0);

SELECT public.biz_ticket_checkout_create_session(
  '19300000-0000-0000-0000-000000000811',NULL,'No attempt',
  'no-attempt@example.com','+2348012345678',false,
  jsonb_build_array(jsonb_build_object(
    'ticketTypeId','19300000-0000-0000-0000-000000000812','quantity',1)),
  'issue-1930-writeback-no-attempt',now()+interval '15 minutes',0,'auto');
SELECT public.biz_ticket_checkout_create_session(
  '19300000-0000-0000-0000-000000000811',NULL,'Paystack',
  'paystack@example.com','+2348012345678',false,
  jsonb_build_array(jsonb_build_object(
    'ticketTypeId','19300000-0000-0000-0000-000000000812','quantity',1)),
  'issue-1930-writeback-paystack',now()+interval '15 minutes',0,'auto');
SELECT public.biz_ticket_checkout_create_session(
  '19300000-0000-0000-0000-000000000811',NULL,'Stripe Checkout',
  'stripe-checkout@example.com','+2348012345678',false,
  jsonb_build_array(jsonb_build_object(
    'ticketTypeId','19300000-0000-0000-0000-000000000812','quantity',1)),
  'issue-1930-writeback-stripe-checkout',now()+interval '15 minutes',0,'auto');
SELECT public.biz_ticket_checkout_create_session(
  '19300000-0000-0000-0000-000000000811',NULL,'Stripe native',
  'stripe-native@example.com','+2348012345678',false,
  jsonb_build_array(jsonb_build_object(
    'ticketTypeId','19300000-0000-0000-0000-000000000812','quantity',1)),
  'issue-1930-writeback-stripe-native',now()+interval '15 minutes',0,'auto');
SELECT public.biz_ticket_checkout_create_session(
  '19300000-0000-0000-0000-000000000811',NULL,'Late reversal',
  'late-reversal@example.com','+2348012345678',false,
  jsonb_build_array(jsonb_build_object(
    'ticketTypeId','19300000-0000-0000-0000-000000000812','quantity',1)),
  'issue-1930-writeback-reversal',now()+interval '15 minutes',0,'auto');

DO $claims$
DECLARE v_session uuid;
BEGIN
  SELECT id INTO v_session FROM public.ticket_checkout_sessions
  WHERE idempotency_key='issue-1930-writeback-paystack';
  PERFORM public.issue_1930_claim_ticket_provider_attempt(
    v_session,'19300000-0000-0000-0000-000000000811','paystack',
    'paystack_redirect','issue-1930-writeback-paystack-fingerprint');

  SELECT id INTO v_session FROM public.ticket_checkout_sessions
  WHERE idempotency_key='issue-1930-writeback-stripe-checkout';
  PERFORM public.issue_1930_claim_ticket_provider_attempt(
    v_session,'19300000-0000-0000-0000-000000000811','stripe',
    'stripe_checkout','issue-1930-writeback-checkout-fingerprint');

  SELECT id INTO v_session FROM public.ticket_checkout_sessions
  WHERE idempotency_key='issue-1930-writeback-stripe-native';
  PERFORM public.issue_1930_claim_ticket_provider_attempt(
    v_session,'19300000-0000-0000-0000-000000000811','stripe',
    'stripe_native','issue-1930-writeback-native-fingerprint');

  SELECT id INTO v_session FROM public.ticket_checkout_sessions
  WHERE idempotency_key='issue-1930-writeback-reversal';
  PERFORM public.issue_1930_claim_ticket_provider_attempt(
    v_session,'19300000-0000-0000-0000-000000000811','stripe',
    'stripe_native','issue-1930-writeback-reversal-fingerprint');
END $claims$;

-- The actual transition owner revokes every session and queues its exact
-- provider-attempt binding (or NULL for a session with no provider attempt).
UPDATE public.events SET visibility='private'
WHERE id='19300000-0000-0000-0000-000000000811';

DO $test$
DECLARE
  v_no_attempt uuid;
  v_paystack uuid;
  v_checkout uuid;
  v_native uuid;
  v_reversal uuid;
  v_paystack_attempt uuid;
  v_checkout_attempt uuid;
  v_native_attempt uuid;
  v_reversal_attempt uuid;
  v_outbox uuid;
  v_error text;
  v_row record;
BEGIN
  SELECT id,provider_attempt_id INTO v_no_attempt,v_outbox
  FROM public.ticket_checkout_sessions
  WHERE idempotency_key LIKE 'issue-1930-writeback-no-attempt:%';
  IF v_outbox IS NOT NULL THEN
    RAISE EXCEPTION 'no-attempt fixture unexpectedly has an attempt';
  END IF;

  SELECT id,provider_attempt_id INTO v_paystack,v_paystack_attempt
  FROM public.ticket_checkout_sessions
  WHERE idempotency_key LIKE 'issue-1930-writeback-paystack:%';
  SELECT id,provider_attempt_id INTO v_checkout,v_checkout_attempt
  FROM public.ticket_checkout_sessions
  WHERE idempotency_key LIKE 'issue-1930-writeback-stripe-checkout:%';
  SELECT id,provider_attempt_id INTO v_native,v_native_attempt
  FROM public.ticket_checkout_sessions
  WHERE idempotency_key LIKE 'issue-1930-writeback-stripe-native:%';
  SELECT id,provider_attempt_id INTO v_reversal,v_reversal_attempt
  FROM public.ticket_checkout_sessions
  WHERE idempotency_key LIKE 'issue-1930-writeback-reversal:%';

  IF (SELECT count(*) FROM public.checkout_sale_revocation_outbox
      WHERE event_id='19300000-0000-0000-0000-000000000811')<>5 THEN
    RAISE EXCEPTION 'expected five exact ticket outbox rows';
  END IF;

  -- A foreign attempt cannot terminalize either the outbox or subject truth.
  UPDATE public.checkout_sale_revocation_outbox SET
    provider_attempt_id=v_paystack_attempt,state='leased',
    lease_owner='foreign-binding',leased_at=now()
  WHERE subject_id=v_checkout RETURNING id INTO v_outbox;
  BEGIN
    PERFORM public.issue_1930_record_revocation_result(
      v_outbox,'foreign-binding','neutralized',NULL);
    RAISE EXCEPTION 'foreign binding unexpectedly accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error<>'revocation_attempt_binding_invalid' THEN RAISE; END IF;
  END;
  IF NOT EXISTS(SELECT 1 FROM public.checkout_sale_revocation_outbox
      WHERE id=v_outbox AND state='leased' AND lease_owner='foreign-binding')
     OR NOT EXISTS(SELECT 1 FROM public.ticket_checkout_sessions
      WHERE id=v_checkout AND reversal_state='neutralization_pending') THEN
    RAISE EXCEPTION 'foreign binding did not fail closed';
  END IF;
  UPDATE public.checkout_sale_revocation_outbox SET
    provider_attempt_id=v_checkout_attempt,state='queued',
    lease_owner=NULL,leased_at=NULL
  WHERE id=v_outbox;

  -- A missing outbox binding cannot silently terminalize a bound session.
  UPDATE public.checkout_sale_revocation_outbox SET
    provider_attempt_id=NULL,state='leased',lease_owner='missing-binding',leased_at=now()
  WHERE subject_id=v_native RETURNING id INTO v_outbox;
  BEGIN
    PERFORM public.issue_1930_record_revocation_result(
      v_outbox,'missing-binding','neutralized',NULL);
    RAISE EXCEPTION 'missing binding unexpectedly accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error<>'revocation_attempt_binding_invalid' THEN RAISE; END IF;
  END;
  UPDATE public.checkout_sale_revocation_outbox SET
    provider_attempt_id=v_native_attempt,state='queued',
    lease_owner=NULL,leased_at=NULL
  WHERE id=v_outbox;

  -- Unknown provider truth remains retryable: session stays pending, attempt
  -- becomes explicit provider_unknown, and the outbox carries a retry time.
  UPDATE public.checkout_sale_revocation_outbox SET
    state='leased',lease_owner='unknown-result',leased_at=now(),attempt_count=1
  WHERE subject_id=v_paystack RETURNING id INTO v_outbox;
  PERFORM public.issue_1930_record_revocation_result(
    v_outbox,'unknown-result','provider_unknown','provider_identity_missing');
  IF NOT EXISTS(SELECT 1 FROM public.ticket_checkout_sessions
       WHERE id=v_paystack AND reversal_state='neutralization_pending')
     OR NOT EXISTS(SELECT 1 FROM public.ticket_checkout_provider_attempts
       WHERE id=v_paystack_attempt AND state='provider_unknown')
     OR NOT EXISTS(SELECT 1 FROM public.checkout_sale_revocation_outbox
       WHERE id=v_outbox AND state='provider_unknown' AND next_retry_at IS NOT NULL
         AND last_error_code='provider_identity_missing') THEN
    RAISE EXCEPTION 'provider-unknown result lost pending/observable truth';
  END IF;
  UPDATE public.checkout_sale_revocation_outbox SET
    state='queued',next_retry_at=NULL
  WHERE id=v_outbox;

  -- No-attempt, Paystack redirect, Stripe Checkout, and Stripe native all
  -- terminalize the leased outbox and exact ticket truth together.
  FOR v_row IN
    SELECT id,subject_id FROM public.checkout_sale_revocation_outbox
    WHERE subject_id IN (v_no_attempt,v_paystack,v_checkout,v_native)
    ORDER BY subject_id
  LOOP
    UPDATE public.checkout_sale_revocation_outbox SET
      state='leased',lease_owner='terminal-result',leased_at=now()
    WHERE id=v_row.id;
    PERFORM public.issue_1930_record_revocation_result(
      v_row.id,'terminal-result','neutralized',NULL);
  END LOOP;

  IF (SELECT count(*) FROM public.ticket_checkout_sessions
      WHERE id IN (v_no_attempt,v_paystack,v_checkout,v_native)
        AND reversal_state='neutralized')<>4
     OR (SELECT count(*) FROM public.ticket_checkout_provider_attempts
      WHERE id IN (v_paystack_attempt,v_checkout_attempt,v_native_attempt)
        AND state='neutralized' AND neutralized_at IS NOT NULL)<>3
     OR (SELECT count(*) FROM public.checkout_sale_revocation_outbox
      WHERE subject_id IN (v_no_attempt,v_paystack,v_checkout,v_native)
        AND state='neutralized' AND lease_owner IS NULL AND leased_at IS NULL)<>4 THEN
    RAISE EXCEPTION 'terminal ticket flow shapes did not converge together';
  END IF;

  -- Duplicate delivery after lease release is a no-op.
  SELECT id INTO v_outbox FROM public.checkout_sale_revocation_outbox
  WHERE subject_id=v_no_attempt;
  PERFORM public.issue_1930_record_revocation_result(
    v_outbox,'terminal-result','failed_terminal','duplicate_replay');
  IF NOT EXISTS(SELECT 1 FROM public.ticket_checkout_sessions
      WHERE id=v_no_attempt AND reversal_state='neutralized') THEN
    RAISE EXCEPTION 'duplicate result changed terminal ticket truth';
  END IF;

  -- The same exact binding supports a verified late-payment reversal without
  -- creating any order/ticket/value: pending first, then terminal + timestamps.
  UPDATE public.checkout_sale_revocation_outbox SET
    state='leased',lease_owner='reversal-pending',leased_at=now()
  WHERE subject_id=v_reversal RETURNING id INTO v_outbox;
  PERFORM public.issue_1930_record_revocation_result(
    v_outbox,'reversal-pending','paid_reversal_pending',NULL);
  IF NOT EXISTS(SELECT 1 FROM public.ticket_checkout_sessions
       WHERE id=v_reversal AND reversal_state='paid_reversal_pending'
         AND order_id IS NULL)
     OR NOT EXISTS(SELECT 1 FROM public.ticket_checkout_provider_attempts
       WHERE id=v_reversal_attempt AND state='paid_reversal_pending') THEN
    RAISE EXCEPTION 'paid reversal pending truth did not converge';
  END IF;
  UPDATE public.checkout_sale_revocation_outbox SET
    state='leased',lease_owner='reversal-terminal',leased_at=now()
  WHERE id=v_outbox;
  PERFORM public.issue_1930_record_revocation_result(
    v_outbox,'reversal-terminal','paid_reversed',NULL);
  IF NOT EXISTS(SELECT 1 FROM public.ticket_checkout_sessions
       WHERE id=v_reversal AND reversal_state='paid_reversed'
         AND reversed_at IS NOT NULL AND order_id IS NULL)
     OR NOT EXISTS(SELECT 1 FROM public.ticket_checkout_provider_attempts
       WHERE id=v_reversal_attempt AND state='paid_reversed'
         AND reversed_at IS NOT NULL)
     OR NOT EXISTS(SELECT 1 FROM public.checkout_sale_revocation_outbox
       WHERE id=v_outbox AND state='paid_reversed') THEN
    RAISE EXCEPTION 'terminal paid reversal truth did not converge';
  END IF;
END $test$;

DELETE FROM public.checkout_sale_revocation_outbox
WHERE event_id='19300000-0000-0000-0000-000000000811';
UPDATE public.ticket_checkout_sessions SET provider_attempt_id=NULL
WHERE event_id='19300000-0000-0000-0000-000000000811';
DELETE FROM public.ticket_checkout_provider_attempts
WHERE event_id='19300000-0000-0000-0000-000000000811';
DELETE FROM public.ticket_checkout_sessions
WHERE event_id='19300000-0000-0000-0000-000000000811';
DELETE FROM public.ticket_types
WHERE id='19300000-0000-0000-0000-000000000812';
DELETE FROM public.events
WHERE id='19300000-0000-0000-0000-000000000811';
DELETE FROM public.brands
WHERE id='19300000-0000-0000-0000-000000000810';
DELETE FROM public.creator_accounts
WHERE id='19300000-0000-0000-0000-000000000801';
DELETE FROM auth.users
WHERE id='19300000-0000-0000-0000-000000000801';
