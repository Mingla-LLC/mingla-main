BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.issue3060_uuid(seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT (substr(md5('issue3060:'||seed),1,8)||'-'||substr(md5('issue3060:'||seed),9,4)||'-4'||substr(md5('issue3060:'||seed),14,3)||'-8'||substr(md5('issue3060:'||seed),18,3)||'-'||substr(md5('issue3060:'||seed),21,12))::uuid
$$;

SET session_replication_role = replica;
INSERT INTO auth.users(id) VALUES (pg_temp.issue3060_uuid('creator'));
INSERT INTO public.creator_accounts(id,email)
VALUES(pg_temp.issue3060_uuid('creator'),'issue3060-creator@example.test');
INSERT INTO public.brands(id,account_id,name,slug)
VALUES(
  pg_temp.issue3060_uuid('brand'),
  pg_temp.issue3060_uuid('creator'),
  'Issue 3060',
  'issue-3060-noncustomer-history'
);
INSERT INTO public.events(
  id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,theme
) VALUES (
  pg_temp.issue3060_uuid('event'),
  pg_temp.issue3060_uuid('brand'),
  pg_temp.issue3060_uuid('creator'),
  'Issue 3060 Event',
  'issue-3060-noncustomer-history-event',
  'event','scheduled','public','UTC','{}'::jsonb
);
INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,quantity_total)
VALUES(
  pg_temp.issue3060_uuid('tier'),
  pg_temp.issue3060_uuid('event'),
  'General',1000,'USD',10
);
INSERT INTO public.orders(
  id,event_id,buyer_email,buyer_name,total_cents,currency,payment_status,source,
  attendance_claim_token_digest,attendance_claim_token_generation,
  attendance_claim_token_created_at,attendance_claim_legacy_token_digest,
  attendance_claim_legacy_token_created_at
) VALUES
  (
    pg_temp.issue3060_uuid('order-a'),pg_temp.issue3060_uuid('event'),
    'historical-a@example.test','Historical A',1000,'USD','paid','legacy',
    decode(repeat('a6',32),'hex'),'legacy_v1',now(),
    decode(repeat('a6',32),'hex'),now()
  ),
  (
    pg_temp.issue3060_uuid('order-b'),pg_temp.issue3060_uuid('event'),
    'historical-b@example.test','Historical B',1000,'USD','paid','legacy',
    decode(repeat('b6',32),'hex'),'legacy_v1',now(),
    decode(repeat('b6',32),'hex'),now()
  );
INSERT INTO public.tickets(
  id,order_id,ticket_type_id,event_id,qr_code,status,approval_status
) VALUES
  (
    pg_temp.issue3060_uuid('ticket-a'),pg_temp.issue3060_uuid('order-a'),
    pg_temp.issue3060_uuid('tier'),pg_temp.issue3060_uuid('event'),
    'issue-3060-a','valid','auto'
  ),
  (
    pg_temp.issue3060_uuid('ticket-b'),pg_temp.issue3060_uuid('order-b'),
    pg_temp.issue3060_uuid('tier'),pg_temp.issue3060_uuid('event'),
    'issue-3060-b','valid','auto'
  );
INSERT INTO public.attendance_claim_deliveries(
  id,kind,source_id,event_id,status,attempt_count,next_attempt_at,last_error_code
) VALUES
  (
    pg_temp.issue3060_uuid('delivery-a-email'),'order_recovery_email',
    pg_temp.issue3060_uuid('order-a'),pg_temp.issue3060_uuid('event'),
    'pending',0,now(),NULL
  ),
  (
    pg_temp.issue3060_uuid('delivery-b-email'),'order_recovery_email',
    pg_temp.issue3060_uuid('order-b'),pg_temp.issue3060_uuid('event'),
    'failed_terminal',0,NULL,'historical_or_unavailable_email'
  ),
  (
    pg_temp.issue3060_uuid('delivery-b-sms'),'order_recovery_sms',
    pg_temp.issue3060_uuid('order-b'),pg_temp.issue3060_uuid('event'),
    'pending',0,now(),NULL
  );
INSERT INTO public.attendance_claim_recovery_items(
  order_id,selected_token_created_at,requires_secondary_delivery,state,
  primary_delivery_id,secondary_delivery_id
) VALUES
  (
    pg_temp.issue3060_uuid('order-a'),now(),false,'selected',
    pg_temp.issue3060_uuid('delivery-a-email'),NULL
  ),
  (
    pg_temp.issue3060_uuid('order-b'),now(),true,'selected',
    pg_temp.issue3060_uuid('delivery-b-email'),
    pg_temp.issue3060_uuid('delivery-b-sms')
  );
SET session_replication_role = origin;

DO $contract$
BEGIN
  IF has_function_privilege(
      'anon',
      'public.close_issue_3060_attendance_noncustomer_history(integer,text)',
      'EXECUTE'
    ) OR has_function_privilege(
      'authenticated',
      'public.close_issue_3060_attendance_noncustomer_history(integer,text)',
      'EXECUTE'
    ) OR NOT has_function_privilege(
      'service_role',
      'public.close_issue_3060_attendance_noncustomer_history(integer,text)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'closure privilege boundary is not service-role-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'attendance_claim_recovery_operator_closures'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'operator closure receipt table is not RLS protected';
  END IF;
END;
$contract$;

SET LOCAL ROLE service_role;
DO $close$
DECLARE
  v_sha text;
  v_result jsonb;
BEGIN
  SELECT encode(
    extensions.digest(
      convert_to(string_agg(order_id::text, ',' ORDER BY order_id),'UTF8'),
      'sha256'
    ),
    'hex'
  ) INTO v_sha FROM public.attendance_claim_recovery_items;

  v_result := public.close_issue_3060_attendance_noncustomer_history(2,v_sha);
  IF v_result->>'result' <> 'closed'
     OR (v_result->>'closed')::integer <> 2
     OR (v_result->>'terminalized')::integer <> 2 THEN
    RAISE EXCEPTION 'operator close returned wrong aggregate result: %',v_result;
  END IF;

  v_result := public.close_issue_3060_attendance_noncustomer_history(2,v_sha);
  IF v_result->>'result' <> 'already_closed'
     OR (v_result->>'closed')::integer <> 2 THEN
    RAISE EXCEPTION 'same-set replay was not idempotent: %',v_result;
  END IF;

  v_result := public.finalize_issue_2979_attendance_claim_recovery();
  IF v_result->>'result' <> 'finalized'
     OR (v_result->>'retired')::integer <> 2 THEN
    RAISE EXCEPTION 'receipt-backed finalizer did not retire exact set: %',v_result;
  END IF;
END;
$close$;
RESET ROLE;

DO $assertions$
BEGIN
  IF (SELECT count(*) FROM public.attendance_claim_recovery_operator_closures
       WHERE closure_id = 'issue_3060_no_current_buyers'
         AND expected_count = 2
         AND decision_reference =
           'https://github.com/Mingla-LLC/mingla-main/issues/2979#issuecomment-5514866755'
         AND set_sha256 ~ '^[0-9a-f]{64}$') <> 1 THEN
    RAISE EXCEPTION 'durable operator receipt is missing or malformed';
  END IF;
  IF (SELECT count(*) FROM public.attendance_claim_recovery_items
       WHERE state = 'legacy_retired'
         AND resolved_via = 'operator_confirmed_no_current_buyer'
         AND operator_closure_id = 'issue_3060_no_current_buyers'
         AND reconciled_at IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 'recovery rows lost operator-resolution audit truth';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.orders
     WHERE id IN (
       pg_temp.issue3060_uuid('order-a'),
       pg_temp.issue3060_uuid('order-b')
     ) AND (
       buyer_user_id IS NOT NULL
       OR attendance_claim_token_digest IS NOT NULL
       OR attendance_claim_token_generation IS NOT NULL
       OR attendance_claim_token_created_at IS NOT NULL
       OR attendance_claim_legacy_token_digest IS NOT NULL
       OR attendance_claim_legacy_token_created_at IS NOT NULL
       OR attendance_claim_token_consumed_at IS NOT NULL
     )
  ) THEN
    RAISE EXCEPTION 'noncustomer finalization fabricated ownership or retained proof';
  END IF;
  IF (SELECT count(*) FROM public.tickets
       WHERE order_id IN (
         pg_temp.issue3060_uuid('order-a'),
         pg_temp.issue3060_uuid('order-b')
       ) AND status = 'valid' AND approval_status = 'auto') <> 2 THEN
    RAISE EXCEPTION 'ticket history was changed by operator closure';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.attendance_claim_deliveries
     WHERE source_id IN (
       pg_temp.issue3060_uuid('order-a'),
       pg_temp.issue3060_uuid('order-b')
     ) AND (
       status <> 'failed_terminal'
       OR attempt_count <> 0
       OR delivered_at IS NOT NULL
       OR provider_attempt_started_at IS NOT NULL
       OR lease_id IS NOT NULL
       OR lease_expires_at IS NOT NULL
     )
  ) THEN
    RAISE EXCEPTION 'closure fabricated or retained provider activity';
  END IF;
  IF (SELECT count(*) FROM public.attendance_claim_deliveries
       WHERE source_id IN (
         pg_temp.issue3060_uuid('order-a'),
         pg_temp.issue3060_uuid('order-b')
       ) AND last_error_code = 'operator_confirmed_no_current_buyer') <> 2
     OR (SELECT count(*) FROM public.attendance_claim_deliveries
       WHERE source_id = pg_temp.issue3060_uuid('order-b')
         AND last_error_code = 'historical_or_unavailable_email') <> 1 THEN
    RAISE EXCEPTION 'closure did not preserve historical terminal reason';
  END IF;
END;
$assertions$;

ROLLBACK;
