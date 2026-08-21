-- Issue #1971 independent tester round 2: deletion and order confirmation
-- must serialize in both directions. A failed/manual order can coexist with a
-- trip that is subsequently deleted, but it must never transition to paid.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner constant uuid := '1971cccc-0000-4000-8000-000000000001';
  v_brand constant uuid := '1971cccc-0000-4000-8000-000000000002';
  v_create_operation constant uuid := '1971cccc-0000-4000-8000-000000000003';
  v_delete_operation constant uuid := '1971cccc-0000-4000-8000-000000000004';
  v_order constant uuid := '1971cccc-0000-4000-8000-000000000005';
  v_graph jsonb;
  v_event uuid;
  v_revision timestamptz;
  v_delete_result jsonb;
BEGIN
  INSERT INTO auth.users(id,aud,role,email)
  VALUES(v_owner,'authenticated','authenticated','issue1971-transition@example.invalid');
  INSERT INTO public.creator_accounts(id,email,display_name)
  VALUES(v_owner,'issue1971-transition@example.invalid','Issue 1971 Transition Owner');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES(v_brand,v_owner,'Issue 1971 Transition Brand','issue-1971-transition-brand','USD');
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  v_graph := public.biz_create_trip_draft(
    v_brand,'{"title":"Deleted trip order transition"}'::jsonb,v_create_operation
  );
  v_event := (v_graph#>>'{event,id}')::uuid;
  SELECT updated_at INTO v_revision FROM public.events WHERE id=v_event;

  INSERT INTO public.orders(
    id,event_id,total_cents,currency,payment_method,payment_status,source
  ) VALUES(v_order,v_event,2500,'USD','manual','failed','manual_import');

  v_delete_result := public.biz_soft_delete_trip(
    v_event,v_revision,v_delete_operation
  );
  IF COALESCE((v_delete_result->>'deleted')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION
      'issue_1971_trip_delete_order_transition: zero-confirmed-order delete failed: %',
      v_delete_result;
  END IF;

  BEGIN
    UPDATE public.orders
    SET payment_status='paid',confirmed_at=clock_timestamp()
    WHERE id=v_order;
    RAISE EXCEPTION
      'issue_1971_trip_delete_order_transition: deleted trip accepted paid transition';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'trip_deleted_order_forbidden' THEN RAISE; END IF;
  END;

  IF (SELECT payment_status FROM public.orders WHERE id=v_order) <> 'failed' THEN
    RAISE EXCEPTION
      'issue_1971_trip_delete_order_transition: rejected transition changed order';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.events WHERE id=v_event AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'issue_1971_trip_delete_order_transition: rejected transition revived trip';
  END IF;
  IF (SELECT count(*) FROM public.biz_trip_command_receipts
      WHERE operation_id IN(v_create_operation,v_delete_operation)) <> 2 THEN
    RAISE EXCEPTION
      'issue_1971_trip_delete_order_transition: receipt count drifted';
  END IF;
END;
$test$;

ROLLBACK;
