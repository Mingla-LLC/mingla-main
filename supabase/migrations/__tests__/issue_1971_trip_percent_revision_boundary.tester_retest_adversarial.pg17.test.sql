-- Issue #1971 independent retest: percentage validation must reject boundary
-- encodings before every draft/grouped-live/Business-live writer, and a live
-- receipt must bind the caller's expected revision as part of its identity.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner constant uuid := '1971eeee-0000-4000-8000-000000000001';
  v_brand constant uuid := '1971eeee-0000-4000-8000-000000000002';
  v_create_operation constant uuid := '1971eeee-0000-4000-8000-000000000003';
  v_zero_deposit_operation constant uuid := '1971eeee-0000-4000-8000-000000000004';
  v_hundred_installment_operation constant uuid := '1971eeee-0000-4000-8000-000000000005';
  v_bad_sum_draft_operation constant uuid := '1971eeee-0000-4000-8000-000000000006';
  v_valid_boundary_operation constant uuid := '1971eeee-0000-4000-8000-000000000007';
  v_grouped_live_operation constant uuid := '1971eeee-0000-4000-8000-000000000008';
  v_business_live_operation constant uuid := '1971eeee-0000-4000-8000-000000000009';
  v_live_replay_operation constant uuid := '1971eeee-0000-4000-8000-000000000010';
  v_graph jsonb;
  v_event uuid;
  v_ticket_type uuid;
  v_revision timestamptz;
  v_revision_after_valid timestamptz;
  v_revision_after_live timestamptz;
  v_original_metadata jsonb;
  v_valid_metadata jsonb;
  v_patch jsonb;
  v_first_result jsonb;
  v_replay_result jsonb;
BEGIN
  INSERT INTO auth.users(id,aud,role,email)
  VALUES(v_owner,'authenticated','authenticated','issue1971-retest@example.invalid');
  INSERT INTO public.creator_accounts(id,email,display_name)
  VALUES(v_owner,'issue1971-retest@example.invalid','Issue 1971 Retest Owner');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES(v_brand,v_owner,'Issue 1971 Retest Brand','issue-1971-retest-brand','USD');
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  v_graph:=public.biz_create_trip_draft(
    v_brand,'{"title":"Retest percentage trip"}'::jsonb,v_create_operation
  );
  v_event:=(v_graph#>>'{event,id}')::uuid;
  v_ticket_type:=(v_graph#>>'{tiers,0,ticket_type_id}')::uuid;
  SELECT e.updated_at,t.tier_metadata
  INTO v_revision,v_original_metadata
  FROM public.events e
  JOIN public.trip_pricing_tiers t ON t.event_id=e.id
  WHERE e.id=v_event AND t.ticket_type_id=v_ticket_type;

  -- A deposit at the exclusive lower bound must fail before any draft write.
  v_patch:=jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object(
    'ticket_type_id',v_ticket_type,
    'tier_metadata',jsonb_build_object('installments',jsonb_build_object(
      'deposit_pct',0,
      'installments',jsonb_build_array(jsonb_build_object(
        'ordinal',1,'pct',99.99,'days_after_booking',30
      ))
    ))
  )));
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,v_patch,v_revision,v_zero_deposit_operation
    );
    RAISE EXCEPTION 'issue_1971_trip_percent_revision: zero deposit was accepted';
  EXCEPTION
    WHEN invalid_parameter_value THEN
      IF SQLERRM<>'installment_deposit_pct_out_of_range' THEN RAISE; END IF;
  END;

  -- An installment at the exclusive upper bound must fail independently.
  v_patch:=jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object(
    'ticket_type_id',v_ticket_type,
    'tier_metadata',jsonb_build_object('installments',jsonb_build_object(
      'deposit_pct',0.01,
      'installments',jsonb_build_array(jsonb_build_object(
        'ordinal',1,'pct',100,'days_after_booking',30
      ))
    ))
  )));
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,v_patch,v_revision,v_hundred_installment_operation
    );
    RAISE EXCEPTION 'issue_1971_trip_percent_revision: 100 percent installment was accepted';
  EXCEPTION
    WHEN invalid_parameter_value THEN
      IF SQLERRM<>'installment_pct_out_of_range' THEN RAISE; END IF;
  END;

  -- A total outside the explicit 0.01 tolerance must fail atomically.
  v_patch:=jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object(
    'ticket_type_id',v_ticket_type,
    'tier_metadata',jsonb_build_object('installments',jsonb_build_object(
      'deposit_pct',50,
      'installments',jsonb_build_array(jsonb_build_object(
        'ordinal',1,'pct',49.989,'days_after_booking',30
      ))
    ))
  )));
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,v_patch,v_revision,v_bad_sum_draft_operation
    );
    RAISE EXCEPTION 'issue_1971_trip_percent_revision: bad draft percentage sum was accepted';
  EXCEPTION
    WHEN invalid_parameter_value THEN
      IF SQLERRM<>'installment_pct_sum_mismatch' THEN RAISE; END IF;
  END;

  IF (SELECT updated_at FROM public.events WHERE id=v_event) IS DISTINCT FROM v_revision
     OR (SELECT tier_metadata FROM public.trip_pricing_tiers
         WHERE event_id=v_event AND ticket_type_id=v_ticket_type)
        IS DISTINCT FROM v_original_metadata
     OR EXISTS(
       SELECT 1 FROM public.biz_trip_command_receipts
       WHERE operation_id IN(
         v_zero_deposit_operation,v_hundred_installment_operation,
         v_bad_sum_draft_operation
       )
     ) THEN
    RAISE EXCEPTION 'issue_1971_trip_percent_revision: rejected draft boundary wrote state';
  END IF;

  -- The nearest valid decimal boundary remains usable.
  v_valid_metadata:=jsonb_build_object('installments',jsonb_build_object(
    'deposit_pct',0.01,
    'installments',jsonb_build_array(jsonb_build_object(
      'ordinal',1,'pct',99.99,'days_after_booking',30
    ))
  ));
  v_patch:=jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object(
    'ticket_type_id',v_ticket_type,'tier_metadata',v_valid_metadata
  )));
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,v_patch,v_revision,v_valid_boundary_operation
  );
  SELECT updated_at INTO v_revision_after_valid
  FROM public.events WHERE id=v_event;
  IF (SELECT tier_metadata FROM public.trip_pricing_tiers
      WHERE event_id=v_event AND ticket_type_id=v_ticket_type)
       IS DISTINCT FROM v_valid_metadata THEN
    RAISE EXCEPTION 'issue_1971_trip_percent_revision: valid decimal boundary did not persist';
  END IF;

  INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
  VALUES(
    v_event,clock_timestamp()+interval '10 days',
    clock_timestamp()+interval '10 days 2 hours','UTC',true
  );
  UPDATE public.events
  SET status='scheduled',visibility='public',updated_at=clock_timestamp()
  WHERE id=v_event
  RETURNING updated_at INTO v_revision_after_valid;

  -- Grouped Ari live vocabulary must reject a zero installment before delegate.
  v_patch:=jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object(
    'ticket_type_id',v_ticket_type,
    'tier_metadata',jsonb_build_object('installments',jsonb_build_object(
      'deposit_pct',100,
      'installments',jsonb_build_array(jsonb_build_object(
        'ordinal',1,'pct',0,'days_after_booking',30
      ))
    ))
  )));
  BEGIN
    PERFORM public.biz_update_trip_live_command(
      v_event,v_patch,'Rejected grouped Ari percentage boundary.',
      v_revision_after_valid,v_grouped_live_operation
    );
    RAISE EXCEPTION 'issue_1971_trip_percent_revision: grouped live zero installment was accepted';
  EXCEPTION
    WHEN invalid_parameter_value THEN
      IF SQLERRM<>'installment_pct_out_of_range' THEN RAISE; END IF;
  END;

  -- Shared Business top-level vocabulary must enforce the same sum tolerance.
  v_patch:=jsonb_build_object('pricing_tiers',jsonb_build_array(jsonb_build_object(
    'ticket_type_id',v_ticket_type,
    'tier_metadata',jsonb_build_object('installments',jsonb_build_object(
      'deposit_pct',50,
      'installments',jsonb_build_array(jsonb_build_object(
        'ordinal',1,'pct',50.011,'days_after_booking',30
      ))
    ))
  )));
  BEGIN
    PERFORM public.biz_update_trip_live_command(
      v_event,v_patch,'Rejected Business percentage sum boundary.',
      v_revision_after_valid,v_business_live_operation
    );
    RAISE EXCEPTION 'issue_1971_trip_percent_revision: Business live bad sum was accepted';
  EXCEPTION
    WHEN invalid_parameter_value THEN
      IF SQLERRM<>'installment_pct_sum_mismatch' THEN RAISE; END IF;
  END;

  IF (SELECT updated_at FROM public.events WHERE id=v_event)
       IS DISTINCT FROM v_revision_after_valid
     OR (SELECT tier_metadata FROM public.trip_pricing_tiers
         WHERE event_id=v_event AND ticket_type_id=v_ticket_type)
        IS DISTINCT FROM v_valid_metadata
     OR EXISTS(
       SELECT 1 FROM public.biz_trip_command_receipts
       WHERE operation_id IN(v_grouped_live_operation,v_business_live_operation)
     ) THEN
    RAISE EXCEPTION 'issue_1971_trip_percent_revision: rejected live boundary wrote state';
  END IF;

  -- Distinct from the implementor's draft proof: bind a successful live edit
  -- receipt to its expected revision and prove exact replay at that revision.
  v_patch:='{"title":"Revision-bound live trip"}'::jsonb;
  v_first_result:=public.biz_update_trip_live_command(
    v_event,v_patch,'Recorded the exact live revision.',
    v_revision_after_valid,v_live_replay_operation
  );
  SELECT updated_at INTO v_revision_after_live
  FROM public.events WHERE id=v_event;
  v_replay_result:=public.biz_update_trip_live_command(
    v_event,v_patch,'Recorded the exact live revision.',
    v_revision_after_valid,v_live_replay_operation
  );
  IF v_replay_result IS DISTINCT FROM v_first_result
     OR (SELECT updated_at FROM public.events WHERE id=v_event)
        IS DISTINCT FROM v_revision_after_live
     OR (SELECT count(*) FROM public.biz_trip_command_receipts
         WHERE operation_id=v_live_replay_operation)<>1 THEN
    RAISE EXCEPTION 'issue_1971_trip_percent_revision: live exact replay was not exact-once';
  END IF;

  BEGIN
    PERFORM public.biz_update_trip_live_command(
      v_event,v_patch,'Recorded the exact live revision.',
      v_revision_after_live+interval '1 microsecond',v_live_replay_operation
    );
    RAISE EXCEPTION 'issue_1971_trip_percent_revision: changed live revision replay was accepted';
  EXCEPTION
    WHEN unique_violation THEN
      IF SQLERRM<>'idempotency_conflict' THEN RAISE; END IF;
  END;
  IF (SELECT updated_at FROM public.events WHERE id=v_event)
       IS DISTINCT FROM v_revision_after_live
     OR (SELECT title FROM public.events WHERE id=v_event)
        IS DISTINCT FROM 'Revision-bound live trip'
     OR (SELECT count(*) FROM public.biz_trip_command_receipts
         WHERE operation_id=v_live_replay_operation)<>1 THEN
    RAISE EXCEPTION 'issue_1971_trip_percent_revision: changed revision conflict wrote state';
  END IF;
END;
$test$;

ROLLBACK;
