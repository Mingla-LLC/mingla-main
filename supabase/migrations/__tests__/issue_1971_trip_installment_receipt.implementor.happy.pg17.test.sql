-- Issue #1971 implementor happy path: valid payment-plan boundaries persist,
-- malformed percentage bounds are atomic, and revision-bound replay is exact.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner constant uuid := '1971dddd-0000-4000-8000-000000000001';
  v_brand constant uuid := '1971dddd-0000-4000-8000-000000000002';
  v_create_operation constant uuid := '1971dddd-0000-4000-8000-000000000003';
  v_bad_deposit_operation constant uuid := '1971dddd-0000-4000-8000-000000000004';
  v_bad_negative_operation constant uuid := '1971dddd-0000-4000-8000-000000000005';
  v_bad_over_operation constant uuid := '1971dddd-0000-4000-8000-000000000006';
  v_boundary_one_operation constant uuid := '1971dddd-0000-4000-8000-000000000007';
  v_boundary_two_operation constant uuid := '1971dddd-0000-4000-8000-000000000008';
  v_bad_live_operation constant uuid := '1971dddd-0000-4000-8000-000000000009';
  v_graph jsonb;
  v_event uuid;
  v_ticket_type uuid;
  v_revision timestamptz;
  v_revision_after_first timestamptz;
  v_original_metadata jsonb;
  v_patch jsonb;
  v_first_result jsonb;
  v_replay_result jsonb;
BEGIN
  INSERT INTO auth.users(id,aud,role,email)
  VALUES(v_owner,'authenticated','authenticated','issue1971-installments@example.invalid');
  INSERT INTO public.creator_accounts(id,email,display_name)
  VALUES(v_owner,'issue1971-installments@example.invalid','Issue 1971 Installment Owner');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES(v_brand,v_owner,'Issue 1971 Installment Brand','issue-1971-installment-brand','USD');
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  v_graph:=public.biz_create_trip_draft(
    v_brand,'{"title":"Installment boundary trip"}'::jsonb,v_create_operation
  );
  v_event:=(v_graph#>>'{event,id}')::uuid;
  v_ticket_type:=(v_graph#>>'{tiers,0,ticket_type_id}')::uuid;
  SELECT e.updated_at,t.tier_metadata
  INTO v_revision,v_original_metadata
  FROM public.events e
  JOIN public.trip_pricing_tiers t ON t.event_id=e.id
  WHERE e.id=v_event AND t.ticket_type_id=v_ticket_type;

  v_patch:=jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object(
    'ticket_type_id',v_ticket_type,
    'tier_metadata',jsonb_build_object('installments',jsonb_build_object(
      'deposit_pct',101,
      'installments',jsonb_build_array(jsonb_build_object(
        'ordinal',1,'pct',-1,'days_after_booking',30
      ))
    ))
  )));
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,v_patch,v_revision,v_bad_deposit_operation
    );
    RAISE EXCEPTION 'issue_1971_installment_receipt: over-100 deposit was accepted';
  EXCEPTION
    WHEN invalid_parameter_value THEN
      IF SQLERRM<>'installment_deposit_pct_out_of_range' THEN RAISE; END IF;
  END;

  v_patch:=jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object(
    'ticket_type_id',v_ticket_type,
    'tier_metadata',jsonb_build_object('installments',jsonb_build_object(
      'deposit_pct',50,
      'installments',jsonb_build_array(jsonb_build_object(
        'ordinal',1,'pct',-50,'days_after_booking',30
      ))
    ))
  )));
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,v_patch,v_revision,v_bad_negative_operation
    );
    RAISE EXCEPTION 'issue_1971_installment_receipt: negative installment was accepted';
  EXCEPTION
    WHEN invalid_parameter_value THEN
      IF SQLERRM<>'installment_pct_out_of_range' THEN RAISE; END IF;
  END;

  v_patch:=jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object(
    'ticket_type_id',v_ticket_type,
    'tier_metadata',jsonb_build_object('installments',jsonb_build_object(
      'deposit_pct',1,
      'installments',jsonb_build_array(jsonb_build_object(
        'ordinal',1,'pct',101,'days_after_booking',30
      ))
    ))
  )));
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,v_patch,v_revision,v_bad_over_operation
    );
    RAISE EXCEPTION 'issue_1971_installment_receipt: over-100 installment was accepted';
  EXCEPTION
    WHEN invalid_parameter_value THEN
      IF SQLERRM<>'installment_pct_out_of_range' THEN RAISE; END IF;
  END;

  IF (SELECT updated_at FROM public.events WHERE id=v_event) IS DISTINCT FROM v_revision
     OR (SELECT tier_metadata FROM public.trip_pricing_tiers
         WHERE event_id=v_event AND ticket_type_id=v_ticket_type)
        IS DISTINCT FROM v_original_metadata
     OR EXISTS(
       SELECT 1 FROM public.biz_trip_command_receipts
       WHERE operation_id IN(
         v_bad_deposit_operation,v_bad_negative_operation,v_bad_over_operation
       )
     ) THEN
    RAISE EXCEPTION 'issue_1971_installment_receipt: rejected bounds wrote state';
  END IF;

  v_patch:=jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object(
    'ticket_type_id',v_ticket_type,
    'tier_metadata',jsonb_build_object('installments',jsonb_build_object(
      'deposit_pct',1,
      'installments',jsonb_build_array(jsonb_build_object(
        'ordinal',1,'pct',99,'days_after_booking',30
      ))
    ))
  )));
  v_first_result:=public.biz_apply_trip_draft_graph(
    v_event,v_patch,v_revision,v_boundary_one_operation
  );
  SELECT updated_at INTO v_revision_after_first
  FROM public.events WHERE id=v_event;

  IF (SELECT tier_metadata#>>'{installments,deposit_pct}'
      FROM public.trip_pricing_tiers
      WHERE event_id=v_event AND ticket_type_id=v_ticket_type)<>'1' THEN
    RAISE EXCEPTION 'issue_1971_installment_receipt: valid 1/99 boundary did not persist';
  END IF;

  v_replay_result:=public.biz_apply_trip_draft_graph(
    v_event,v_patch,v_revision,v_boundary_one_operation
  );
  IF v_replay_result IS DISTINCT FROM v_first_result
     OR (SELECT updated_at FROM public.events WHERE id=v_event)
        IS DISTINCT FROM v_revision_after_first
     OR (SELECT count(*) FROM public.biz_trip_command_receipts
         WHERE operation_id=v_boundary_one_operation)<>1 THEN
    RAISE EXCEPTION 'issue_1971_installment_receipt: exact replay was not exact-once';
  END IF;

  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,v_patch,v_revision_after_first+interval '1 microsecond',
      v_boundary_one_operation
    );
    RAISE EXCEPTION 'issue_1971_installment_receipt: changed revision replay was accepted';
  EXCEPTION
    WHEN unique_violation THEN
      IF SQLERRM<>'idempotency_conflict' THEN RAISE; END IF;
  END;
  IF (SELECT updated_at FROM public.events WHERE id=v_event)
       IS DISTINCT FROM v_revision_after_first
     OR (SELECT count(*) FROM public.biz_trip_command_receipts
         WHERE operation_id=v_boundary_one_operation)<>1 THEN
    RAISE EXCEPTION 'issue_1971_installment_receipt: revision conflict wrote state';
  END IF;

  v_patch:=jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object(
    'ticket_type_id',v_ticket_type,
    'tier_metadata',jsonb_build_object('installments',jsonb_build_object(
      'deposit_pct',99,
      'installments',jsonb_build_array(jsonb_build_object(
        'ordinal',1,'pct',1,'days_after_booking',30
      ))
    ))
  )));
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,v_patch,v_revision_after_first,v_boundary_two_operation
  );
  IF (SELECT tier_metadata#>>'{installments,deposit_pct}'
      FROM public.trip_pricing_tiers
      WHERE event_id=v_event AND ticket_type_id=v_ticket_type)<>'99'
     OR (SELECT count(*) FROM public.biz_trip_command_receipts
         WHERE operation_id IN(
           v_create_operation,v_boundary_one_operation,v_boundary_two_operation
         ))<>3 THEN
    RAISE EXCEPTION 'issue_1971_installment_receipt: valid 99/1 boundary failed';
  END IF;

  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
  VALUES(
    v_event,clock_timestamp()+interval '10 days',
    clock_timestamp()+interval '10 days 2 hours','UTC',true
  );
  UPDATE public.events
  SET status='scheduled',visibility='public'
  WHERE id=v_event
  RETURNING updated_at INTO v_revision_after_first;
  v_patch:=jsonb_build_object('pricing_tiers',jsonb_build_array(jsonb_build_object(
    'ticket_type_id',v_ticket_type,
    'tier_metadata',jsonb_build_object('installments',jsonb_build_object(
      'deposit_pct',150,
      'installments',jsonb_build_array(jsonb_build_object(
        'ordinal',1,'pct',-50,'days_after_booking',30
      ))
    ))
  )));
  BEGIN
    PERFORM public.biz_update_trip_live_command(
      v_event,v_patch,'Validated the live payment plan.',
      v_revision_after_first,v_bad_live_operation
    );
    RAISE EXCEPTION 'issue_1971_installment_receipt: live Business bounds were accepted';
  EXCEPTION
    WHEN invalid_parameter_value THEN
      IF SQLERRM<>'installment_deposit_pct_out_of_range' THEN RAISE; END IF;
  END;
  IF (SELECT tier_metadata#>>'{installments,deposit_pct}'
      FROM public.trip_pricing_tiers
      WHERE event_id=v_event AND ticket_type_id=v_ticket_type)<>'99'
     OR EXISTS(
       SELECT 1 FROM public.biz_trip_command_receipts
       WHERE operation_id=v_bad_live_operation
     ) THEN
    RAISE EXCEPTION 'issue_1971_installment_receipt: rejected live bounds wrote state';
  END IF;
END;
$test$;

ROLLBACK;
