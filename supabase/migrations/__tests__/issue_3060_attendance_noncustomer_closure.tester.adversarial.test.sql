BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.issue3060_tester_uuid(seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT (substr(md5('issue3060-tester:'||seed),1,8)||'-'||substr(md5('issue3060-tester:'||seed),9,4)||'-4'||substr(md5('issue3060-tester:'||seed),14,3)||'-8'||substr(md5('issue3060-tester:'||seed),18,3)||'-'||substr(md5('issue3060-tester:'||seed),21,12))::uuid
$$;

CREATE TEMP TABLE issue3060_tester_failures(message text NOT NULL);
GRANT SELECT, INSERT ON TABLE issue3060_tester_failures TO service_role;

SET session_replication_role = replica;
INSERT INTO auth.users(id) VALUES (pg_temp.issue3060_tester_uuid('creator'));
INSERT INTO public.creator_accounts(id,email)
VALUES(pg_temp.issue3060_tester_uuid('creator'),'issue3060-tester-creator@example.test');
INSERT INTO public.brands(id,account_id,name,slug)
VALUES(
  pg_temp.issue3060_tester_uuid('brand'),
  pg_temp.issue3060_tester_uuid('creator'),
  'Issue 3060 Tester',
  'issue-3060-tester'
);
INSERT INTO public.events(
  id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,theme
) VALUES (
  pg_temp.issue3060_tester_uuid('event'),
  pg_temp.issue3060_tester_uuid('brand'),
  pg_temp.issue3060_tester_uuid('creator'),
  'Issue 3060 Tester Event',
  'issue-3060-tester-event',
  'event','scheduled','public','UTC','{}'::jsonb
);
INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,quantity_total)
VALUES(
  pg_temp.issue3060_tester_uuid('tier'),
  pg_temp.issue3060_tester_uuid('event'),
  'General',1000,'USD',20
);
INSERT INTO public.orders(
  id,event_id,buyer_email,buyer_name,total_cents,currency,payment_status,source,
  attendance_claim_token_digest,attendance_claim_token_generation,
  attendance_claim_token_created_at,attendance_claim_legacy_token_digest,
  attendance_claim_legacy_token_created_at
) VALUES
  (
    pg_temp.issue3060_tester_uuid('order-a'),
    pg_temp.issue3060_tester_uuid('event'),
    'historical-a@example.test','Historical A',1000,'USD','paid','legacy',
    decode(repeat('a7',32),'hex'),'legacy_v1',now(),
    decode(repeat('a7',32),'hex'),now()
  ),
  (
    pg_temp.issue3060_tester_uuid('order-b'),
    pg_temp.issue3060_tester_uuid('event'),
    'historical-b@example.test','Historical B',1000,'USD','paid','legacy',
    decode(repeat('b7',32),'hex'),'legacy_v1',now(),
    decode(repeat('b7',32),'hex'),now()
  );
INSERT INTO public.tickets(
  id,order_id,ticket_type_id,event_id,qr_code,status,approval_status
) VALUES
  (
    pg_temp.issue3060_tester_uuid('ticket-a'),
    pg_temp.issue3060_tester_uuid('order-a'),
    pg_temp.issue3060_tester_uuid('tier'),
    pg_temp.issue3060_tester_uuid('event'),
    'issue-3060-tester-a','valid','auto'
  ),
  (
    pg_temp.issue3060_tester_uuid('ticket-b'),
    pg_temp.issue3060_tester_uuid('order-b'),
    pg_temp.issue3060_tester_uuid('tier'),
    pg_temp.issue3060_tester_uuid('event'),
    'issue-3060-tester-b','valid','auto'
  );
INSERT INTO public.attendance_claim_deliveries(
  id,kind,source_id,event_id,status,attempt_count,next_attempt_at,last_error_code
) VALUES
  (
    pg_temp.issue3060_tester_uuid('delivery-a-email'),'order_recovery_email',
    pg_temp.issue3060_tester_uuid('order-a'),
    pg_temp.issue3060_tester_uuid('event'),'pending',0,now(),NULL
  ),
  (
    pg_temp.issue3060_tester_uuid('delivery-b-email'),'order_recovery_email',
    pg_temp.issue3060_tester_uuid('order-b'),
    pg_temp.issue3060_tester_uuid('event'),'failed_terminal',0,NULL,
    'historical_or_unavailable_email'
  ),
  (
    pg_temp.issue3060_tester_uuid('delivery-b-sms'),'order_recovery_sms',
    pg_temp.issue3060_tester_uuid('order-b'),
    pg_temp.issue3060_tester_uuid('event'),'pending',0,now(),NULL
  );
INSERT INTO public.attendance_claim_recovery_items(
  order_id,selected_token_created_at,requires_secondary_delivery,state,
  primary_delivery_id,secondary_delivery_id
) VALUES
  (
    pg_temp.issue3060_tester_uuid('order-a'),now(),false,'selected',
    pg_temp.issue3060_tester_uuid('delivery-a-email'),NULL
  ),
  (
    pg_temp.issue3060_tester_uuid('order-b'),now(),true,'replacement_issued',
    pg_temp.issue3060_tester_uuid('delivery-b-email'),
    pg_temp.issue3060_tester_uuid('delivery-b-sms')
  );
SET session_replication_role = origin;

DO $privileges$
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
    ) OR has_table_privilege(
      'anon','public.attendance_claim_recovery_operator_closures','SELECT'
    ) OR has_table_privilege(
      'authenticated','public.attendance_claim_recovery_operator_closures','SELECT'
    ) THEN
    RAISE EXCEPTION 'operator close authority escaped the service-role boundary';
  END IF;
END;
$privileges$;

SET LOCAL ROLE service_role;
DO $refusals$
DECLARE
  v_sha text;
  v_refused boolean;
BEGIN
  SELECT encode(
    extensions.digest(
      convert_to(string_agg(order_id::text, ',' ORDER BY order_id),'UTF8'),
      'sha256'
    ),
    'hex'
  ) INTO v_sha FROM public.attendance_claim_recovery_items;

  v_refused := false;
  BEGIN
    PERFORM public.close_issue_3060_attendance_noncustomer_history(1,v_sha);
  EXCEPTION WHEN OTHERS THEN
    v_refused := SQLERRM LIKE '%issue_3060_recovery_set_mismatch%';
  END;
  IF NOT v_refused THEN
    INSERT INTO issue3060_tester_failures VALUES
      ('wrong expected count was not refused');
  END IF;

  v_refused := false;
  BEGIN
    PERFORM public.close_issue_3060_attendance_noncustomer_history(
      2,repeat('f',64)
    );
  EXCEPTION WHEN OTHERS THEN
    v_refused := SQLERRM LIKE '%issue_3060_recovery_set_mismatch%';
  END;
  IF NOT v_refused THEN
    INSERT INTO issue3060_tester_failures VALUES
      ('wrong exact-set fingerprint was not refused');
  END IF;

  UPDATE public.attendance_claim_recovery_items
     SET state = 'attention_required'
   WHERE order_id = pg_temp.issue3060_tester_uuid('order-b');
  v_refused := false;
  BEGIN
    PERFORM public.close_issue_3060_attendance_noncustomer_history(2,v_sha);
  EXCEPTION WHEN OTHERS THEN
    v_refused := SQLERRM LIKE '%issue_3060_recovery_set_mismatch%';
  END;
  IF NOT v_refused THEN
    INSERT INTO issue3060_tester_failures VALUES
      ('mixed recovery state was not refused');
  END IF;
  UPDATE public.attendance_claim_recovery_items
     SET state = 'replacement_issued'
   WHERE order_id = pg_temp.issue3060_tester_uuid('order-b');

  UPDATE public.orders
     SET attendance_claim_token_digest = NULL,
         attendance_claim_token_generation = NULL,
         attendance_claim_token_consumed_at = now()
   WHERE id = pg_temp.issue3060_tester_uuid('order-b');
  v_refused := false;
  BEGIN
    PERFORM public.close_issue_3060_attendance_noncustomer_history(2,v_sha);
  EXCEPTION WHEN OTHERS THEN
    v_refused := SQLERRM LIKE '%issue_3060_buyer_activity_detected%';
  END;
  IF NOT v_refused THEN
    INSERT INTO issue3060_tester_failures VALUES
      ('buyer claim activity was not refused');
  END IF;
  UPDATE public.orders
     SET attendance_claim_token_digest = decode(repeat('b7',32),'hex'),
         attendance_claim_token_generation = 'legacy_v1',
         attendance_claim_token_consumed_at = NULL
   WHERE id = pg_temp.issue3060_tester_uuid('order-b');

  UPDATE public.attendance_claim_recovery_items
     SET primary_delivery_id = NULL
   WHERE order_id = pg_temp.issue3060_tester_uuid('order-a');
  v_refused := false;
  BEGIN
    PERFORM public.close_issue_3060_attendance_noncustomer_history(2,v_sha);
  EXCEPTION WHEN OTHERS THEN
    v_refused := SQLERRM LIKE '%issue_3060_delivery_inventory_mismatch%';
  END;
  IF NOT v_refused THEN
    INSERT INTO issue3060_tester_failures VALUES
      ('incomplete delivery inventory was not refused');
  END IF;
  UPDATE public.attendance_claim_recovery_items
     SET primary_delivery_id = pg_temp.issue3060_tester_uuid('delivery-a-email')
   WHERE order_id = pg_temp.issue3060_tester_uuid('order-a');

  UPDATE public.attendance_claim_deliveries
     SET attempt_count = 1,
         provider_attempt_started_at = now()
   WHERE id = pg_temp.issue3060_tester_uuid('delivery-a-email');
  v_refused := false;
  BEGIN
    PERFORM public.close_issue_3060_attendance_noncustomer_history(2,v_sha);
  EXCEPTION WHEN OTHERS THEN
    v_refused := SQLERRM LIKE '%issue_3060_provider_activity_detected%';
  END;
  IF NOT v_refused THEN
    INSERT INTO issue3060_tester_failures VALUES
      ('prior provider activity was not refused');
  END IF;
  UPDATE public.attendance_claim_deliveries
     SET attempt_count = 0,
         provider_attempt_started_at = NULL
   WHERE id = pg_temp.issue3060_tester_uuid('delivery-a-email');

  IF EXISTS (
    SELECT 1 FROM public.attendance_claim_recovery_operator_closures
  ) OR EXISTS (
    SELECT 1 FROM public.attendance_claim_recovery_items
     WHERE operator_closure_id IS NOT NULL
        OR resolved_via = 'operator_confirmed_no_current_buyer'
  ) THEN
    INSERT INTO issue3060_tester_failures VALUES
      ('a refused close left partial audit state');
  END IF;
END;
$refusals$;

DO $close_and_tamper_proof$
DECLARE
  v_sha text;
  v_result jsonb;
  v_refused boolean;
BEGIN
  SELECT encode(
    extensions.digest(
      convert_to(string_agg(order_id::text, ',' ORDER BY order_id),'UTF8'),
      'sha256'
    ),
    'hex'
  ) INTO v_sha FROM public.attendance_claim_recovery_items;

  v_result := public.close_issue_3060_attendance_noncustomer_history(2,v_sha);
  IF v_result->>'result' <> 'closed' THEN
    INSERT INTO issue3060_tester_failures VALUES
      ('valid exact set did not close: '||v_result::text);
  END IF;

  v_refused := false;
  BEGIN
    PERFORM public.close_issue_3060_attendance_noncustomer_history(3,v_sha);
  EXCEPTION WHEN OTHERS THEN
    v_refused := SQLERRM LIKE '%issue_3060_closure_receipt_mismatch%';
  END;
  IF NOT v_refused THEN
    INSERT INTO issue3060_tester_failures VALUES
      ('mismatched receipt replay was not refused');
  END IF;

  UPDATE public.attendance_claim_recovery_items
     SET resolved_via = 'lifecycle_ineligible', operator_closure_id = NULL
   WHERE order_id = pg_temp.issue3060_tester_uuid('order-b');
  v_refused := false;
  BEGIN
    PERFORM public.finalize_issue_2979_attendance_claim_recovery();
  EXCEPTION WHEN OTHERS THEN
    v_refused := SQLERRM LIKE '%issue_3060_operator_receipt_mismatch%';
  END;
  IF NOT v_refused THEN
    INSERT INTO issue3060_tester_failures VALUES
      ('tampered receipt membership was not refused');
  END IF;
  UPDATE public.attendance_claim_recovery_items
     SET resolved_via = 'operator_confirmed_no_current_buyer',
         operator_closure_id = 'issue_3060_no_current_buyers'
   WHERE order_id = pg_temp.issue3060_tester_uuid('order-b');

  BEGIN
    v_result := public.finalize_issue_2979_attendance_claim_recovery();
    IF v_result->>'result' <> 'finalized'
       OR (v_result->>'retired')::integer <> 2 THEN
      INSERT INTO issue3060_tester_failures VALUES
        ('valid operator set finalized with wrong aggregate: '||v_result::text);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO issue3060_tester_failures VALUES
      ('valid operator set did not finalize: '||SQLERRM);
  END;
END;
$close_and_tamper_proof$;

RESET ROLE;

-- A normal delivery-safe buyer remains governed by the original 72-hour
-- safety window, and finalization preserves the active governed proof.
SET session_replication_role = replica;
INSERT INTO public.orders(
  id,event_id,buyer_email,buyer_name,total_cents,currency,payment_status,source,
  attendance_claim_token_digest,attendance_claim_token_generation,
  attendance_claim_token_created_at,attendance_claim_legacy_token_digest,
  attendance_claim_legacy_token_created_at
) VALUES (
  pg_temp.issue3060_tester_uuid('normal-order'),
  pg_temp.issue3060_tester_uuid('event'),
  'normal@example.test','Normal Buyer',1000,'USD','paid','legacy',
  decode(repeat('c7',32),'hex'),'governed_v2',now(),
  decode(repeat('d7',32),'hex'),now()
);
INSERT INTO public.tickets(
  id,order_id,ticket_type_id,event_id,qr_code,status,approval_status
) VALUES (
  pg_temp.issue3060_tester_uuid('normal-ticket'),
  pg_temp.issue3060_tester_uuid('normal-order'),
  pg_temp.issue3060_tester_uuid('tier'),
  pg_temp.issue3060_tester_uuid('event'),
  'issue-3060-normal','valid','auto'
);
INSERT INTO public.attendance_claim_deliveries(
  id,kind,source_id,event_id,status,attempt_count,next_attempt_at,delivered_at
) VALUES (
  pg_temp.issue3060_tester_uuid('normal-delivery'),'order_recovery_email',
  pg_temp.issue3060_tester_uuid('normal-order'),
  pg_temp.issue3060_tester_uuid('event'),'sent',1,NULL,now()
);
INSERT INTO public.attendance_claim_recovery_items(
  order_id,selected_token_created_at,state,primary_delivery_id,delivery_safe_at
) VALUES (
  pg_temp.issue3060_tester_uuid('normal-order'),now(),'delivery_safe',
  pg_temp.issue3060_tester_uuid('normal-delivery'),
  now()-interval '71 hours 59 minutes 59 seconds'
);
SET session_replication_role = origin;

SET LOCAL ROLE service_role;
DO $ordinary_path$
DECLARE
  v_refused boolean := false;
  v_result jsonb;
BEGIN
  BEGIN
    PERFORM public.finalize_issue_2979_attendance_claim_recovery();
  EXCEPTION WHEN OTHERS THEN
    v_refused := SQLERRM LIKE '%issue_2979_grace_period_active%';
  END;
  IF NOT v_refused THEN
    INSERT INTO issue3060_tester_failures VALUES
      ('ordinary delivery-safe row bypassed the 72-hour grace');
  END IF;

  UPDATE public.attendance_claim_recovery_items
     SET delivery_safe_at = now()-interval '72 hours 1 second'
   WHERE order_id = pg_temp.issue3060_tester_uuid('normal-order');
  BEGIN
    v_result := public.finalize_issue_2979_attendance_claim_recovery();
    IF v_result->>'result' <> 'finalized'
       OR (v_result->>'retired')::integer <> 1 THEN
      INSERT INTO issue3060_tester_failures VALUES
        ('ordinary finalization returned wrong aggregate: '||v_result::text);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO issue3060_tester_failures VALUES
      ('ordinary finalization failed after 72 hours: '||SQLERRM);
  END;
END;
$ordinary_path$;
RESET ROLE;

DO $assertions$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.orders
     WHERE id IN (
       pg_temp.issue3060_tester_uuid('order-a'),
       pg_temp.issue3060_tester_uuid('order-b')
     ) AND (
       attendance_claim_token_digest IS NOT NULL
       OR attendance_claim_token_generation IS NOT NULL
       OR attendance_claim_token_created_at IS NOT NULL
       OR attendance_claim_legacy_token_digest IS NOT NULL
       OR attendance_claim_legacy_token_created_at IS NOT NULL
     )
  ) THEN
    RAISE EXCEPTION 'operator-confirmed historical proof was not fully retired';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = pg_temp.issue3060_tester_uuid('normal-order')
       AND attendance_claim_token_digest = decode(repeat('c7',32),'hex')
       AND attendance_claim_token_generation = 'governed_v2'
       AND attendance_claim_token_created_at IS NOT NULL
       AND attendance_claim_legacy_token_digest IS NULL
       AND attendance_claim_legacy_token_created_at IS NULL
  ) THEN
    RAISE EXCEPTION 'ordinary finalization did not preserve governed proof';
  END IF;
  IF (SELECT count(*) FROM public.tickets
       WHERE order_id IN (
         pg_temp.issue3060_tester_uuid('order-a'),
         pg_temp.issue3060_tester_uuid('order-b'),
         pg_temp.issue3060_tester_uuid('normal-order')
       )) <> 3 THEN
    RAISE EXCEPTION 'closure or finalization deleted ticket history';
  END IF;
END;
$assertions$;

DO $verdict$
DECLARE
  v_failures text;
BEGIN
  SELECT string_agg(message, E'\n- ' ORDER BY message) INTO v_failures
    FROM issue3060_tester_failures;
  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION E'issue #3060 tester adversarial failures:\n- %', v_failures;
  END IF;
END;
$verdict$;

ROLLBACK;
