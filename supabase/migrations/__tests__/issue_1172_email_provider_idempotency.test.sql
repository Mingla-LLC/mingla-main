\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_now timestamptz := '2027-01-10 12:00:00+00';
  v_claim jsonb;
  v_delivery public.notification_deliveries;
  v_result text;
BEGIN
  v_claim:=public.claim_notification_email_delivery(
    'ops.stripe_payout_release_attempt_cap:sql-1172',
    repeat('a',64),
    repeat('b',64),
    v_now
  );
  IF v_claim->>'action'<>'send_new'
     OR nullif(v_claim->>'delivery_id','') IS NULL
     OR nullif(v_claim->>'claim_id','') IS NULL THEN
    RAISE EXCEPTION 'new email delivery was not atomically claimed: %',v_claim;
  END IF;

  SELECT * INTO v_delivery
  FROM public.notification_deliveries
  WHERE id=(v_claim->>'delivery_id')::uuid;
  IF v_delivery.notification_id IS NOT NULL
     OR v_delivery.contact IS NOT NULL
     OR v_delivery.recipient_fingerprint<>repeat('a',64)
     OR v_delivery.payload_fingerprint<>repeat('b',64)
     OR v_delivery.provider_idempotency_expires_at<>v_now+interval '24 hours'
     OR v_delivery.status<>'queued' THEN
    RAISE EXCEPTION 'email delivery leaked recipient or lost claim truth';
  END IF;

  v_result:=public.complete_notification_email_delivery(
    (v_claim->>'delivery_id')::uuid,
    (v_claim->>'claim_id')::uuid,
    'accepted',
    'email-sql-1172',
    NULL,
    v_now+interval '1 second'
  );
  IF v_result<>'provider_accepted' THEN
    RAISE EXCEPTION 'provider acceptance was not persisted';
  END IF;
  v_claim:=public.claim_notification_email_delivery(
    'ops.stripe_payout_release_attempt_cap:sql-1172',
    repeat('a',64),
    repeat('b',64),
    v_now+interval '2 seconds'
  );
  IF v_claim->>'action'<>'already_accepted'
     OR v_claim->>'provider_message_id'<>'email-sql-1172' THEN
    RAISE EXCEPTION 'accepted replay did not converge: %',v_claim;
  END IF;

  v_claim:=public.claim_notification_email_delivery(
    'ops.stripe_payout_release_attempt_cap:sql-1172',
    repeat('c',64),
    repeat('b',64),
    v_now+interval '3 seconds'
  );
  IF v_claim->>'action'<>'idempotency_conflict' THEN
    RAISE EXCEPTION 'recipient mismatch did not fail closed: %',v_claim;
  END IF;

  v_claim:=public.claim_notification_email_delivery(
    'ops.stripe_payout_release_attempt_cap:stale-inside',
    repeat('d',64),
    repeat('e',64),
    v_now
  );
  v_claim:=public.claim_notification_email_delivery(
    'ops.stripe_payout_release_attempt_cap:stale-inside',
    repeat('d',64),
    repeat('e',64),
    v_now+interval '11 minutes'
  );
  IF v_claim->>'action'<>'retry_same_provider_key' THEN
    RAISE EXCEPTION 'inside-window stale claim was not retryable: %',v_claim;
  END IF;

  v_claim:=public.claim_notification_email_delivery(
    'ops.stripe_payout_release_attempt_cap:stale-expired',
    repeat('f',64),
    repeat('0',64),
    v_now
  );
  v_claim:=public.claim_notification_email_delivery(
    'ops.stripe_payout_release_attempt_cap:stale-expired',
    repeat('f',64),
    repeat('0',64),
    v_now+interval '24 hours 1 second'
  );
  IF v_claim->>'action'<>'acceptance_unknown' THEN
    RAISE EXCEPTION 'expired ambiguity did not stop auto-send: %',v_claim;
  END IF;
  SELECT * INTO v_delivery
  FROM public.notification_deliveries
  WHERE idempotency_key=
    'ops.stripe_payout_release_attempt_cap:stale-expired'
    AND channel='email';
  IF v_delivery.status<>'failed'
     OR v_delivery.failed_reason<>'acceptance_unknown_after_provider_window' THEN
    RAISE EXCEPTION 'expired ambiguity was not durable manual review';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.claim_notification_email_delivery(text,text,text,timestamptz)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.claim_notification_email_delivery(text,text,text,timestamptz)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.complete_notification_email_delivery(uuid,uuid,text,text,text,timestamptz)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.complete_notification_email_delivery(uuid,uuid,text,text,text,timestamptz)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'email idempotency RPC leaked outside service role';
  END IF;
END;
$test$;

ROLLBACK;
