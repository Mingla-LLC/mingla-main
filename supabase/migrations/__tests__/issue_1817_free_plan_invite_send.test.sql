-- #1817 happy-path state matrix. Run after the full migration chain on fresh PG17.
-- Every fixture and helper is transaction-bound and rolls back.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id)
VALUES ('18170000-0000-4000-8000-000000000001');

INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
VALUES (
  '18170000-0000-4000-8000-000000000002',
  '18170000-0000-4000-8000-000000000001',
  'Issue 1817 Brand','issue-1817-brand','USD',now(),now()
);

INSERT INTO public.events(
  id,brand_id,created_by,event_type,title,slug,status,visibility,currency,
  timezone,party_types,rsvp_approval_mode,rsvp_discoverable,theme,created_at,updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000010',
  '18170000-0000-4000-8000-000000000002',
  '18170000-0000-4000-8000-000000000001',
  'rsvp','Issue 1817 Event','issue-1817-event','scheduled','public','USD',
  'UTC','{}','auto',false,'{}',now(),now()
);

INSERT INTO public.brand_people(id,brand_id,linked_user_id,display_name)
VALUES (
  '18170000-0000-4000-8000-000000000003',
  '18170000-0000-4000-8000-000000000002',
  '18170000-0000-4000-8000-000000000001',
  'Issue 1817 Guest'
);

INSERT INTO public.brand_offering_invites(id,brand_id,event_id,brand_person_id,origin)
VALUES (
  '18170000-0000-4000-8000-000000000004',
  '18170000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000010',
  '18170000-0000-4000-8000-000000000003',
  'wizard'
);

INSERT INTO public.brand_person_contact_methods(
  id,brand_id,brand_person_id,channel,normalized_value,provenance_scope,
  is_exportable,suppression_eligible,is_primary
) VALUES (
  '18170000-0000-4000-8000-000000000005',
  '18170000-0000-4000-8000-000000000002',
  '18170000-0000-4000-8000-000000000003',
  'email','issue1817@example.test','brand_owned',true,true,true
);

CREATE FUNCTION pg_temp.issue_1817_fixture(
  p_group_id uuid,
  p_attempt_id uuid,
  p_ordinal integer,
  p_sibling_status text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO public.marketing_send_groups(
    id,event_id,brand_id,purpose,client_request_id,channels,selection_snapshot,
    selected_count,eligible_count,reachable_count,queued_count,
    eligibility_hash,quote_hash,quoted_at,execution_snapshot_hash,
    push_payload_v1,push_payload_hash,created_by
  ) VALUES (
    p_group_id,
    '00000000-0000-4000-8000-000000000010',
    '18170000-0000-4000-8000-000000000002',
    'invitation',p_group_id,ARRAY['push'],'{}',1,1,1,
    CASE WHEN p_sibling_status='queued' THEN 2 ELSE 1 END,
    repeat('1',64),repeat('2',64),now(),repeat('3',64),
    '{"payloadVersion":1,"payloadHash":"7f2bac69104ea744d8f3b8eee0aff076a688f7f0da3d6452d52d2d5979e1e190","title":"You are invited","body":"Open Mingla for details.","eventId":"00000000-0000-4000-8000-000000000010"}'::jsonb,
    '7f2bac69104ea744d8f3b8eee0aff076a688f7f0da3d6452d52d2d5979e1e190',
    '18170000-0000-4000-8000-000000000001'
  );

  INSERT INTO public.brand_offering_invite_delivery_attempts(
    id,invite_id,send_group_id,recipient_user_id,channel,attempt_kind,
    attempt_ordinal,status,provider_idempotency_key,provider_io_claimed_at,queued_at
  ) VALUES (
    p_attempt_id,
    '18170000-0000-4000-8000-000000000004',
    p_group_id,
    '18170000-0000-4000-8000-000000000001',
    'push','initial',p_ordinal,'sending',
    format('offering:%s:push:v1',p_attempt_id),now(),now()
  );

  IF p_sibling_status IS NOT NULL THEN
    INSERT INTO public.brand_offering_invite_delivery_attempts(
      invite_id,send_group_id,contact_method_id,channel,attempt_kind,
      attempt_ordinal,status,is_retryable,safe_reason_code,queued_at,failed_at
    ) VALUES (
      '18170000-0000-4000-8000-000000000004',p_group_id,
      '18170000-0000-4000-8000-000000000005','email','initial',p_ordinal,
      p_sibling_status,false,
      CASE WHEN p_sibling_status='failed' THEN 'campaign_delivery_failed'
        WHEN p_sibling_status='suppressed' THEN 'can_send_denied' END,
      CASE WHEN p_sibling_status='queued' THEN now() END,
      CASE WHEN p_sibling_status='failed' THEN now() END
    );
  END IF;

  INSERT INTO public.notifications(id,user_id,type,title,body,data,idempotency_key)
  VALUES (
    p_attempt_id,
    '18170000-0000-4000-8000-000000000001',
    'offering_invitation','You are invited','Open Mingla for details.','{}',
    format('offering:%s:push:v1',p_attempt_id)
  );
END;
$function$;

DO $matrix$
DECLARE
  v_app uuid := '18170000-0000-4000-8000-000000000100';
  v_group uuid;
  v_attempt uuid;
  v_message uuid;
  v_first_completed timestamptz;
  v_before jsonb;
  v_result jsonb;
BEGIN
  -- T-1817-03/05: provider acceptance settles Sent and completes with no receipt row.
  v_group := '18170000-0000-4000-8000-000000000011';
  v_attempt := '18170000-0000-4000-8000-000000000012';
  v_message := '18170000-0000-4000-8000-000000000013';
  PERFORM pg_temp.issue_1817_fixture(v_group,v_attempt,1,NULL);
  v_result:=public.biz_record_offering_push_dispatch_result(
    v_attempt,'accepted',v_app,v_message,NULL,false
  );
  IF v_result->>'status'<>'sent'
    OR NOT EXISTS(
      SELECT 1 FROM public.brand_offering_invite_delivery_attempts
      WHERE id=v_attempt AND status='sent' AND provider_app_id=v_app
        AND provider_message_id=v_message::text AND provider_accepted_at IS NOT NULL
        AND sent_at IS NOT NULL AND delivered_at IS NULL AND NOT is_retryable
    )
    OR NOT EXISTS(
      SELECT 1 FROM public.notification_deliveries
      WHERE notification_id=v_attempt AND channel='push' AND status='sent'
        AND provider_app_id=v_app AND provider_message_id=v_message::text
        AND delivered_at IS NULL
    )
    OR NOT EXISTS(
      SELECT 1 FROM public.marketing_send_groups
      WHERE id=v_group AND queued_count=0 AND sent_count=1 AND delivered_count=0
        AND failed_count=0 AND status='completed' AND completed_at IS NOT NULL
    )
    OR EXISTS(SELECT 1 FROM public.offering_push_provider_events WHERE attempt_id=v_attempt)
  THEN
    RAISE EXCEPTION 'T-1817-03 FAIL: free-plan acceptance did not settle Sent/group completion: %',v_result;
  END IF;

  -- T-1817-04: exact replay is stable; a different tuple fails with zero mutation.
  SELECT completed_at INTO v_first_completed FROM public.marketing_send_groups WHERE id=v_group;
  PERFORM public.biz_record_offering_push_dispatch_result(v_attempt,'accepted',v_app,v_message,NULL,false);
  IF (SELECT completed_at FROM public.marketing_send_groups WHERE id=v_group) IS DISTINCT FROM v_first_completed
    OR (SELECT count(*) FROM public.brand_offering_invite_delivery_attempts WHERE id=v_attempt)<>1
    OR (SELECT count(*) FROM public.notification_deliveries WHERE notification_id=v_attempt AND channel='push')<>1
  THEN RAISE EXCEPTION 'T-1817-04 FAIL: exact acceptance replay duplicated or moved completion'; END IF;
  SELECT to_jsonb(a) INTO v_before FROM public.brand_offering_invite_delivery_attempts a WHERE id=v_attempt;
  BEGIN
    PERFORM public.biz_record_offering_push_dispatch_result(
      v_attempt,'accepted',v_app,'18170000-0000-4000-8000-000000000014',NULL,false
    );
    RAISE EXCEPTION 'T-1817-04 FAIL: conflicting provider tuple was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF (SELECT to_jsonb(a) FROM public.brand_offering_invite_delivery_attempts a WHERE id=v_attempt) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'T-1817-04 FAIL: tuple conflict mutated the attempt';
  END IF;

  -- T-1817-05: sent callback before result converges to Sent.
  v_group := '18170000-0000-4000-8000-000000000021';
  v_attempt := '18170000-0000-4000-8000-000000000022';
  v_message := '18170000-0000-4000-8000-000000000023';
  PERFORM pg_temp.issue_1817_fixture(v_group,v_attempt,2,NULL);
  PERFORM public.biz_reconcile_offering_push_event(
    '18170000-0000-4000-8000-000000000024','message.push.sent',now(),
    v_app,v_message,'18170000-0000-4000-8000-000000000001',v_attempt
  );
  PERFORM public.biz_record_offering_push_dispatch_result(v_attempt,'accepted',v_app,v_message,NULL,false);
  IF NOT EXISTS(
    SELECT 1 FROM public.brand_offering_invite_delivery_attempts
    WHERE id=v_attempt AND status='sent' AND provider_accepted_at IS NOT NULL
      AND safe_reason_code IS NULL
  ) THEN RAISE EXCEPTION 'T-1817-05 FAIL: sent-before-result did not converge'; END IF;

  -- T-1817-05: failed callback before result becomes accepted Sent + partial detail.
  v_group := '18170000-0000-4000-8000-000000000031';
  v_attempt := '18170000-0000-4000-8000-000000000032';
  v_message := '18170000-0000-4000-8000-000000000033';
  PERFORM pg_temp.issue_1817_fixture(v_group,v_attempt,3,NULL);
  PERFORM public.biz_reconcile_offering_push_event(
    '18170000-0000-4000-8000-000000000034','message.push.failed',now(),
    v_app,v_message,'18170000-0000-4000-8000-000000000001',v_attempt
  );
  PERFORM public.biz_record_offering_push_dispatch_result(v_attempt,'accepted',v_app,v_message,NULL,false);
  IF NOT EXISTS(
    SELECT 1 FROM public.brand_offering_invite_delivery_attempts
    WHERE id=v_attempt AND status='sent' AND provider_accepted_at IS NOT NULL
      AND failed_at IS NOT NULL AND safe_reason_code='provider_partial_failure'
      AND NOT is_retryable
  ) THEN RAISE EXCEPTION 'T-1817-05 FAIL: failed-before-result did not retain accepted truth'; END IF;

  -- T-1817-05/12: received callback before result remains the sole Delivered owner.
  v_group := '18170000-0000-4000-8000-000000000041';
  v_attempt := '18170000-0000-4000-8000-000000000042';
  v_message := '18170000-0000-4000-8000-000000000043';
  PERFORM pg_temp.issue_1817_fixture(v_group,v_attempt,4,NULL);
  PERFORM public.biz_reconcile_offering_push_event(
    '18170000-0000-4000-8000-000000000044','message.push.received',now(),
    v_app,v_message,'18170000-0000-4000-8000-000000000001',v_attempt
  );
  PERFORM public.biz_record_offering_push_dispatch_result(v_attempt,'accepted',v_app,v_message,NULL,false);
  IF NOT EXISTS(
    SELECT 1 FROM public.brand_offering_invite_delivery_attempts
    WHERE id=v_attempt AND status='delivered' AND provider_accepted_at IS NOT NULL
      AND delivered_at IS NOT NULL AND safe_reason_code IS NULL
  ) THEN RAISE EXCEPTION 'T-1817-05 FAIL: received-before-result was downgraded'; END IF;

  -- T-1817-06: accepted -> failed -> received -> failed never erases Sent/Delivered.
  v_group := '18170000-0000-4000-8000-000000000051';
  v_attempt := '18170000-0000-4000-8000-000000000052';
  v_message := '18170000-0000-4000-8000-000000000053';
  PERFORM pg_temp.issue_1817_fixture(v_group,v_attempt,5,NULL);
  PERFORM public.biz_record_offering_push_dispatch_result(v_attempt,'accepted',v_app,v_message,NULL,false);
  PERFORM public.biz_reconcile_offering_push_event(
    '18170000-0000-4000-8000-000000000054','message.push.failed',now(),
    v_app,v_message,'18170000-0000-4000-8000-000000000001',v_attempt
  );
  IF NOT EXISTS(
    SELECT 1 FROM public.brand_offering_invite_delivery_attempts
    WHERE id=v_attempt AND status='sent' AND failed_at IS NOT NULL
      AND safe_reason_code='provider_partial_failure' AND NOT is_retryable
  ) THEN RAISE EXCEPTION 'T-1817-06 FAIL: late failure erased or retried accepted Sent'; END IF;
  PERFORM public.biz_reconcile_offering_push_event(
    '18170000-0000-4000-8000-000000000055','message.push.received',now(),
    v_app,v_message,'18170000-0000-4000-8000-000000000001',v_attempt
  );
  PERFORM public.biz_reconcile_offering_push_event(
    '18170000-0000-4000-8000-000000000056','message.push.failed',now(),
    v_app,v_message,'18170000-0000-4000-8000-000000000001',v_attempt
  );
  IF NOT EXISTS(
    SELECT 1 FROM public.brand_offering_invite_delivery_attempts
    WHERE id=v_attempt AND status='delivered' AND delivered_at IS NOT NULL
      AND safe_reason_code IS NULL
  ) THEN RAISE EXCEPTION 'T-1817-06 FAIL: failure after received downgraded Delivered'; END IF;

  -- T-1817-07: ambiguity remains nonretryable Sending and group-running.
  v_group := '18170000-0000-4000-8000-000000000061';
  v_attempt := '18170000-0000-4000-8000-000000000062';
  PERFORM pg_temp.issue_1817_fixture(v_group,v_attempt,6,NULL);
  PERFORM public.biz_record_offering_push_dispatch_result(
    v_attempt,'ambiguous',NULL,NULL,'provider_outcome_unknown',false
  );
  IF NOT EXISTS(
    SELECT 1 FROM public.brand_offering_invite_delivery_attempts
    WHERE id=v_attempt AND status='sending' AND provider_accepted_at IS NULL
      AND safe_reason_code='provider_outcome_unknown' AND NOT is_retryable
  ) OR NOT EXISTS(
    SELECT 1 FROM public.marketing_send_groups
    WHERE id=v_group AND status='running' AND queued_count=1 AND sent_count=0
      AND delivered_count=0 AND completed_at IS NULL
  ) THEN RAISE EXCEPTION 'T-1817-07 FAIL: ambiguous outcome fabricated acceptance'; END IF;

  -- T-1817-08: the unchanged projector derives mixed group states from all attempts.
  v_group := '18170000-0000-4000-8000-000000000071';
  v_attempt := '18170000-0000-4000-8000-000000000072';
  PERFORM pg_temp.issue_1817_fixture(v_group,v_attempt,7,'queued');
  PERFORM public.biz_record_offering_push_dispatch_result(
    v_attempt,'accepted',v_app,'18170000-0000-4000-8000-000000000073',NULL,false
  );
  IF NOT EXISTS(
    SELECT 1 FROM public.marketing_send_groups
    WHERE id=v_group AND status='running' AND queued_count=1 AND sent_count=1
  ) THEN RAISE EXCEPTION 'T-1817-08 FAIL: nonterminal sibling did not keep group running'; END IF;

  v_group := '18170000-0000-4000-8000-000000000081';
  v_attempt := '18170000-0000-4000-8000-000000000082';
  PERFORM pg_temp.issue_1817_fixture(v_group,v_attempt,8,'failed');
  PERFORM public.biz_record_offering_push_dispatch_result(
    v_attempt,'accepted',v_app,'18170000-0000-4000-8000-000000000083',NULL,false
  );
  IF NOT EXISTS(
    SELECT 1 FROM public.marketing_send_groups
    WHERE id=v_group AND status='partial' AND queued_count=0 AND sent_count=1
      AND failed_count=1 AND completed_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'T-1817-08 FAIL: mixed terminal group did not become partial'; END IF;

  v_group := '18170000-0000-4000-8000-000000000091';
  v_attempt := '18170000-0000-4000-8000-000000000092';
  PERFORM pg_temp.issue_1817_fixture(v_group,v_attempt,9,'suppressed');
  PERFORM public.biz_record_offering_push_dispatch_result(
    v_attempt,'accepted',v_app,'18170000-0000-4000-8000-000000000093',NULL,false
  );
  IF NOT EXISTS(
    SELECT 1 FROM public.marketing_send_groups
    WHERE id=v_group AND status='completed' AND queued_count=0 AND sent_count=1
      AND suppressed_count=1 AND failed_count=0 AND completed_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'T-1817-08 FAIL: success plus suppression did not complete'; END IF;

  RAISE NOTICE 'T-1817-03..08 PASS: free-plan acceptance and callback ordering converge';
END;
$matrix$;

DO $security$
BEGIN
  IF has_function_privilege(
      'anon','public.biz_record_offering_push_dispatch_result(uuid,text,uuid,uuid,text,boolean)','EXECUTE'
    ) OR has_function_privilege(
      'authenticated','public.biz_record_offering_push_dispatch_result(uuid,text,uuid,uuid,text,boolean)','EXECUTE'
    ) OR NOT has_function_privilege(
      'service_role','public.biz_record_offering_push_dispatch_result(uuid,text,uuid,uuid,text,boolean)','EXECUTE'
    ) OR has_function_privilege(
      'anon','public.biz_reconcile_offering_push_event(uuid,text,timestamptz,uuid,uuid,uuid,uuid)','EXECUTE'
    ) OR has_function_privilege(
      'authenticated','public.biz_reconcile_offering_push_event(uuid,text,timestamptz,uuid,uuid,uuid,uuid)','EXECUTE'
    ) OR NOT has_function_privilege(
      'service_role','public.biz_reconcile_offering_push_event(uuid,text,timestamptz,uuid,uuid,uuid,uuid)','EXECUTE'
    ) OR NOT (
      SELECT relrowsecurity FROM pg_class WHERE oid='public.brand_offering_invite_delivery_attempts'::regclass
    ) OR NOT (
      SELECT relrowsecurity AND relforcerowsecurity
      FROM pg_class WHERE oid='public.offering_push_provider_events'::regclass
    )
  THEN RAISE EXCEPTION 'T-1817-09 FAIL: RPC grants or RLS/FORCE RLS drifted'; END IF;
  RAISE NOTICE 'T-1817-09 PASS: service-only RPCs and existing RLS remain intact';
END;
$security$;

SET LOCAL ROLE anon;
DO $anon_denied$
BEGIN
  BEGIN
    PERFORM public.biz_record_offering_push_dispatch_result(
      '18170000-0000-4000-8000-000000000012','accepted',
      '18170000-0000-4000-8000-000000000100',
      '18170000-0000-4000-8000-000000000013',NULL,false
    );
    RAISE EXCEPTION 'T-1817-09 FAIL: anon invoked service-only result RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$anon_denied$;
RESET ROLE;

ROLLBACK;
\echo 'issue #1817 free-plan invitation send passed (T-1817-03..09)'
