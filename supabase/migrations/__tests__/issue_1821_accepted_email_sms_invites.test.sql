-- #1821 provider-accepted email/SMS invitation state and group matrix.
-- Run after the full migration chain on a fresh PostgreSQL 17 database.
\set ON_ERROR_STOP on
-- #2393: dblink opens new sessions, so inherit this run's generated CI
-- credential through this psql session only. \getenv does not print it, and
-- the setting must survive the suite's intentional first-phase ROLLBACK.
\getenv issue_2393_dblink_password PGPASSWORD
SET issue_2393.dblink_password TO :'issue_2393_dblink_password';
BEGIN;

INSERT INTO auth.users(id)
VALUES ('18210000-0000-4000-8000-000000000001');

INSERT INTO public.creator_accounts(id)
VALUES ('18210000-0000-4000-8000-000000000001');

INSERT INTO public.brands(
  id,account_id,name,slug,default_currency,created_at,updated_at
) VALUES (
  '18210000-0000-4000-8000-000000000002',
  '18210000-0000-4000-8000-000000000001',
  'Issue 1821 Brand','issue-1821-brand','USD',now(),now()
);

INSERT INTO public.events(
  id,brand_id,created_by,event_type,title,slug,status,visibility,currency,
  timezone,party_types,rsvp_approval_mode,rsvp_discoverable,theme,
  created_at,updated_at
) VALUES
(
  '18210000-0000-4000-8000-000000000003',
  '18210000-0000-4000-8000-000000000002',
  '18210000-0000-4000-8000-000000000001',
  'rsvp','Issue 1821 Event','issue-1821-event','scheduled','public','USD',
  'UTC','{}','auto',false,'{}',now(),now()
),
(
  '18210000-0000-4000-8000-000000000004',
  '18210000-0000-4000-8000-000000000002',
  '18210000-0000-4000-8000-000000000001',
  'rsvp','Issue 1821 Event Two','issue-1821-event-two','scheduled','public','USD',
  'UTC','{}','auto',false,'{}',now(),now()
);

INSERT INTO public.brand_people(id,brand_id,display_name)
VALUES (
  '18210000-0000-4000-8000-000000000005',
  '18210000-0000-4000-8000-000000000002',
  'Issue 1821 Guest'
);

INSERT INTO public.brand_offering_invites(
  id,brand_id,event_id,brand_person_id,origin
) VALUES
(
  '18210000-0000-4000-8000-000000000006',
  '18210000-0000-4000-8000-000000000002',
  '18210000-0000-4000-8000-000000000003',
  '18210000-0000-4000-8000-000000000005','wizard'
),
(
  '18210000-0000-4000-8000-000000000007',
  '18210000-0000-4000-8000-000000000002',
  '18210000-0000-4000-8000-000000000004',
  '18210000-0000-4000-8000-000000000005','wizard'
);

INSERT INTO public.brand_person_contact_methods(
  id,brand_id,brand_person_id,channel,normalized_value,provenance_scope,
  is_exportable,suppression_eligible,is_primary
) VALUES
(
  '18210000-0000-4000-8000-000000000008',
  '18210000-0000-4000-8000-000000000002',
  '18210000-0000-4000-8000-000000000005',
  'email','issue1821@example.test','brand_owned',true,true,true
),
(
  '18210000-0000-4000-8000-000000000009',
  '18210000-0000-4000-8000-000000000002',
  '18210000-0000-4000-8000-000000000005',
  'phone','+14155551821','brand_owned',true,true,true
);

INSERT INTO public.marketing_audiences(
  id,account_id,brand_id,name,query_definition
) VALUES (
  '18210000-0000-4000-8000-000000000010',
  '18210000-0000-4000-8000-000000000001',
  '18210000-0000-4000-8000-000000000002',
  'Issue 1821 Audience','{"kind":"offering_send_group"}'
);

CREATE FUNCTION pg_temp.issue_1821_campaign(
  p_campaign_id uuid,
  p_channel text
) RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO public.marketing_campaigns(
    id,account_id,brand_id,audience_id,name,channel,channel_payload,status
  ) VALUES (
    p_campaign_id,
    '18210000-0000-4000-8000-000000000001',
    '18210000-0000-4000-8000-000000000002',
    '18210000-0000-4000-8000-000000000010',
    'Issue 1821 Campaign',p_channel,
    CASE p_channel
      WHEN 'email' THEN jsonb_build_object(
        'kind','email',
        'subject','Issue 1821 accepted email fixture',
        'body_html','Issue 1821 accepted email fixture'
      )
      ELSE jsonb_build_object(
        'kind','sms','body','Issue 1821 accepted SMS fixture'
      )
    END,'sending'
  );
END;
$function$;

CREATE FUNCTION pg_temp.issue_1821_group(
  p_group_id uuid,
  p_event_id uuid,
  p_channels text[],
  p_queued integer
) RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO public.marketing_send_groups(
    id,event_id,brand_id,purpose,client_request_id,channels,
    selection_snapshot,selected_count,eligible_count,reachable_count,
    queued_count,eligibility_hash,quote_hash,quoted_at,
    execution_snapshot_hash,created_by
  ) VALUES (
    p_group_id,p_event_id,
    '18210000-0000-4000-8000-000000000002',
    'invitation',p_group_id,p_channels,'{}',p_queued,p_queued,p_queued,
    p_queued,repeat('1',64),repeat('2',64),now(),repeat('3',64),
    '18210000-0000-4000-8000-000000000001'
  );
END;
$function$;

CREATE FUNCTION pg_temp.issue_1821_attempt(
  p_attempt_id uuid,
  p_invite_id uuid,
  p_group_id uuid,
  p_campaign_id uuid,
  p_channel text,
  p_ordinal integer,
  p_status text,
  p_claimed boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO public.brand_offering_invite_delivery_attempts(
    id,invite_id,send_group_id,campaign_id,contact_method_id,channel,
    attempt_kind,attempt_ordinal,status,provider_idempotency_key,
    provider_io_claimed_at,queued_at
  ) VALUES (
    p_attempt_id,p_invite_id,p_group_id,p_campaign_id,
    CASE p_channel
      WHEN 'email' THEN '18210000-0000-4000-8000-000000000008'::uuid
      ELSE '18210000-0000-4000-8000-000000000009'::uuid
    END,
    p_channel,'initial',p_ordinal,p_status,
    CASE WHEN p_claimed THEN
      format('offering:%s:%s:v1',p_attempt_id,p_channel)
    END,
    CASE WHEN p_claimed THEN now() END,now()
  );
END;
$function$;

DO $email_sms$
DECLARE
  v_group uuid := '18210000-0000-4000-8000-000000000101';
  v_campaign uuid := '18210000-0000-4000-8000-000000000102';
  v_attempt uuid := '18210000-0000-4000-8000-000000000103';
  v_message uuid := '18210000-0000-4000-8000-000000000104';
  v_completed timestamptz;
  v_attempt_before jsonb;
  v_group_before jsonb;
  v_message_before jsonb;
BEGIN
  PERFORM pg_temp.issue_1821_campaign(v_campaign,'email');
  PERFORM pg_temp.issue_1821_group(
    v_group,'18210000-0000-4000-8000-000000000003',ARRAY['email'],1
  );
  PERFORM pg_temp.issue_1821_attempt(
    v_attempt,'18210000-0000-4000-8000-000000000006',v_group,
    v_campaign,'email',1,'sending',true
  );
  INSERT INTO public.marketing_messages(
    id,campaign_id,recipient_email,channel,status
  ) VALUES(v_message,v_campaign,' ISSUE1821@example.test ','email','queued');
  UPDATE public.marketing_messages SET
    status='sent',sent_at='2026-08-11 01:00:00+00',
    provider_message_id='resend-accepted-1821'
  WHERE id=v_message;

  IF NOT EXISTS(
    SELECT 1 FROM public.brand_offering_invite_delivery_attempts
    WHERE id=v_attempt AND status='sent' AND marketing_message_id=v_message
      AND provider_message_id='resend-accepted-1821'
      AND provider_accepted_at='2026-08-11 01:00:00+00'
      AND sent_at='2026-08-11 01:00:00+00'
      AND delivered_at IS NULL AND actual_cost_minor IS NULL
      AND NOT is_retryable
  ) OR NOT EXISTS(
    SELECT 1 FROM public.marketing_send_groups
    WHERE id=v_group AND status='completed' AND queued_count=0
      AND sent_count=1 AND delivered_count=0 AND failed_count=0
      AND completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'T-1821-01 FAIL: email accepted did not settle Sent/group completion';
  END IF;
  RAISE NOTICE 'T-1821-01 PASS: email accepted settles Sent, never Delivered';

  SELECT completed_at INTO v_completed
  FROM public.marketing_send_groups WHERE id=v_group;
  UPDATE public.marketing_messages SET status='sent' WHERE id=v_message;
  IF (SELECT completed_at FROM public.marketing_send_groups WHERE id=v_group)
      IS DISTINCT FROM v_completed
    OR (SELECT count(*) FROM public.brand_offering_invite_delivery_attempts
        WHERE id=v_attempt)<>1
  THEN
    RAISE EXCEPTION 'T-1821-03 FAIL: exact accepted replay moved identity/timestamps';
  END IF;

  SELECT to_jsonb(a) INTO v_attempt_before
  FROM public.brand_offering_invite_delivery_attempts a WHERE id=v_attempt;
  BEGIN
    UPDATE public.marketing_messages
    SET provider_message_id='resend-conflict-1821'
    WHERE id=v_message;
    RAISE EXCEPTION 'T-1821-03 FAIL: conflicting provider tuple was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF (SELECT to_jsonb(a) FROM public.brand_offering_invite_delivery_attempts a
      WHERE id=v_attempt) IS DISTINCT FROM v_attempt_before
  THEN
    RAISE EXCEPTION 'T-1821-03 FAIL: provider conflict mutated the attempt';
  END IF;
  RAISE NOTICE 'T-1821-03 PASS: replay is stable and provider tuple conflict fails atomically';

  SELECT to_jsonb(m) INTO v_message_before
  FROM public.marketing_messages m WHERE id=v_message;
  SELECT to_jsonb(a) INTO v_attempt_before
  FROM public.brand_offering_invite_delivery_attempts a WHERE id=v_attempt;
  SELECT to_jsonb(g) INTO v_group_before
  FROM public.marketing_send_groups g WHERE id=v_group;
  BEGIN
    UPDATE public.marketing_messages SET
      status='failed',provider_message_id='resend-failed-conflict-1821'
    WHERE id=v_message;
    RAISE EXCEPTION 'T-1821-03 FAIL: failed provider tuple conflict was accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'offering_marketing_message_provider_mismatch' THEN
      RAISE;
    END IF;
  END;
  IF (SELECT to_jsonb(m) FROM public.marketing_messages m WHERE id=v_message)
      IS DISTINCT FROM v_message_before
    OR (SELECT to_jsonb(a) FROM public.brand_offering_invite_delivery_attempts a
        WHERE id=v_attempt) IS DISTINCT FROM v_attempt_before
    OR (SELECT to_jsonb(g) FROM public.marketing_send_groups g WHERE id=v_group)
        IS DISTINCT FROM v_group_before
  THEN
    RAISE EXCEPTION 'T-1821-03 FAIL: failed provider conflict did not roll back all rows';
  END IF;

  BEGIN
    UPDATE public.marketing_messages SET
      status='bounced',provider_message_id='resend-bounced-conflict-1821'
    WHERE id=v_message;
    RAISE EXCEPTION 'T-1821-03 FAIL: bounced provider tuple conflict was accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'offering_marketing_message_provider_mismatch' THEN
      RAISE;
    END IF;
  END;
  IF (SELECT to_jsonb(m) FROM public.marketing_messages m WHERE id=v_message)
      IS DISTINCT FROM v_message_before
    OR (SELECT to_jsonb(a) FROM public.brand_offering_invite_delivery_attempts a
        WHERE id=v_attempt) IS DISTINCT FROM v_attempt_before
    OR (SELECT to_jsonb(g) FROM public.marketing_send_groups g WHERE id=v_group)
        IS DISTINCT FROM v_group_before
  THEN
    RAISE EXCEPTION 'T-1821-03 FAIL: bounced provider conflict did not roll back all rows';
  END IF;

  BEGIN
    UPDATE public.marketing_messages SET
      status='failed',provider_message_id=NULL
    WHERE id=v_message;
    RAISE EXCEPTION 'T-1821-03 FAIL: failed provider null erasure was accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'offering_marketing_message_provider_mismatch' THEN
      RAISE;
    END IF;
  END;
  IF (SELECT to_jsonb(m) FROM public.marketing_messages m WHERE id=v_message)
      IS DISTINCT FROM v_message_before
    OR (SELECT to_jsonb(a) FROM public.brand_offering_invite_delivery_attempts a
        WHERE id=v_attempt) IS DISTINCT FROM v_attempt_before
    OR (SELECT to_jsonb(g) FROM public.marketing_send_groups g WHERE id=v_group)
        IS DISTINCT FROM v_group_before
  THEN
    RAISE EXCEPTION 'T-1821-03 FAIL: null provider erasure did not roll back all rows';
  END IF;

  BEGIN
    UPDATE public.marketing_messages SET provider_message_id='   '
    WHERE id=v_message;
    RAISE EXCEPTION 'T-1821-03 FAIL: present blank provider id was accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'offering_marketing_message_provider_missing' THEN
      RAISE;
    END IF;
  END;
  IF (SELECT to_jsonb(m) FROM public.marketing_messages m WHERE id=v_message)
      IS DISTINCT FROM v_message_before
    OR (SELECT to_jsonb(a) FROM public.brand_offering_invite_delivery_attempts a
        WHERE id=v_attempt) IS DISTINCT FROM v_attempt_before
    OR (SELECT to_jsonb(g) FROM public.marketing_send_groups g WHERE id=v_group)
        IS DISTINCT FROM v_group_before
  THEN
    RAISE EXCEPTION 'T-1821-03 FAIL: blank provider id did not roll back all rows';
  END IF;
  RAISE NOTICE 'T-1821-03 PASS: failed/bounced/null/blank cross-state tuple conflicts roll back all rows';

  UPDATE public.marketing_messages SET status='failed' WHERE id=v_message;
  IF NOT EXISTS(
    SELECT 1 FROM public.brand_offering_invite_delivery_attempts
    WHERE id=v_attempt AND status='sent' AND failed_at IS NOT NULL
      AND safe_reason_code='provider_partial_failure' AND NOT is_retryable
  ) THEN
    RAISE EXCEPTION 'T-1821-04 FAIL: accepted then failed downgraded Sent';
  END IF;
  UPDATE public.marketing_messages SET
    status='delivered',delivered_at='2026-08-11 01:05:00+00'
  WHERE id=v_message;
  UPDATE public.marketing_messages SET status='bounced' WHERE id=v_message;
  IF NOT EXISTS(
    SELECT 1 FROM public.brand_offering_invite_delivery_attempts
    WHERE id=v_attempt AND status='delivered'
      AND delivered_at='2026-08-11 01:05:00+00'
      AND safe_reason_code IS NULL AND NOT is_retryable
  ) OR NOT EXISTS(
    SELECT 1 FROM public.marketing_send_groups
    WHERE id=v_group AND sent_count=1 AND delivered_count=1
  ) THEN
    RAISE EXCEPTION 'T-1821-04 FAIL: Delivered was downgraded by late failure';
  END IF;
  RAISE NOTICE 'T-1821-04 PASS: accepted/failure/delivery ordering is monotonic';
END;
$email_sms$;

DO $sms$
DECLARE
  v_provider text;
  v_n integer := 0;
  v_group uuid;
  v_campaign uuid;
  v_attempt uuid;
  v_message uuid;
BEGIN
  FOREACH v_provider IN ARRAY ARRAY['SM1821TWILIO','termii-message-1821'] LOOP
    v_n:=v_n+1;
    v_group:=('18210000-0000-4000-8000-' || lpad((200+v_n)::text,12,'0'))::uuid;
    v_campaign:=('18210000-0000-4000-8000-' || lpad((210+v_n)::text,12,'0'))::uuid;
    v_attempt:=('18210000-0000-4000-8000-' || lpad((220+v_n)::text,12,'0'))::uuid;
    v_message:=('18210000-0000-4000-8000-' || lpad((230+v_n)::text,12,'0'))::uuid;
    PERFORM pg_temp.issue_1821_campaign(v_campaign,'sms');
    PERFORM pg_temp.issue_1821_group(
      v_group,'18210000-0000-4000-8000-000000000003',ARRAY['sms'],1
    );
    PERFORM pg_temp.issue_1821_attempt(
      v_attempt,'18210000-0000-4000-8000-000000000006',v_group,
      v_campaign,'sms',v_n,'sending',true
    );
    INSERT INTO public.marketing_messages(
      id,campaign_id,recipient_phone,channel,status
    ) VALUES(v_message,v_campaign,'+1 (415) 555-1821','sms','queued');
    UPDATE public.marketing_messages SET
      status='sent',sent_at=now(),provider_message_id=v_provider
    WHERE id=v_message;
    IF NOT EXISTS(
      SELECT 1 FROM public.brand_offering_invite_delivery_attempts
      WHERE id=v_attempt AND status='sent' AND provider_message_id=v_provider
        AND provider_accepted_at IS NOT NULL AND sent_at IS NOT NULL
        AND delivered_at IS NULL
    ) OR NOT EXISTS(
      SELECT 1 FROM public.marketing_send_groups
      WHERE id=v_group AND status='completed' AND sent_count=1
        AND delivered_count=0 AND queued_count=0
    ) THEN
      RAISE EXCEPTION 'T-1821-02 FAIL: SMS provider % did not settle Sent',v_provider;
    END IF;
  END LOOP;
  RAISE NOTICE 'T-1821-02 PASS: Twilio and Termii acceptance IDs settle Sent';
END;
$sms$;

DO $failures$
DECLARE
  v_group uuid;
  v_campaign uuid;
  v_attempt uuid;
  v_message uuid;
BEGIN
  -- Pre-claim definitive failure.
  v_group:='18210000-0000-4000-8000-000000000301';
  v_campaign:='18210000-0000-4000-8000-000000000302';
  v_attempt:='18210000-0000-4000-8000-000000000303';
  v_message:='18210000-0000-4000-8000-000000000304';
  PERFORM pg_temp.issue_1821_campaign(v_campaign,'email');
  PERFORM pg_temp.issue_1821_group(v_group,'18210000-0000-4000-8000-000000000003',ARRAY['email'],1);
  PERFORM pg_temp.issue_1821_attempt(v_attempt,'18210000-0000-4000-8000-000000000006',v_group,v_campaign,'email',10,'queued',false);
  INSERT INTO public.marketing_messages(id,campaign_id,recipient_email,channel,status)
  VALUES(v_message,v_campaign,'issue1821@example.test','email','queued');
  UPDATE public.marketing_messages SET status='failed' WHERE id=v_message;
  IF NOT EXISTS(SELECT 1 FROM public.brand_offering_invite_delivery_attempts
    WHERE id=v_attempt AND status='failed' AND safe_reason_code='campaign_delivery_failed')
  THEN RAISE EXCEPTION 'T-1821-05 FAIL: pre-claim failure did not settle Failed'; END IF;

  -- Pre-claim preview/kill-switch suppression.
  v_group:='18210000-0000-4000-8000-000000000311';
  v_campaign:='18210000-0000-4000-8000-000000000312';
  v_attempt:='18210000-0000-4000-8000-000000000313';
  v_message:='18210000-0000-4000-8000-000000000314';
  PERFORM pg_temp.issue_1821_campaign(v_campaign,'email');
  PERFORM pg_temp.issue_1821_group(v_group,'18210000-0000-4000-8000-000000000003',ARRAY['email'],1);
  PERFORM pg_temp.issue_1821_attempt(v_attempt,'18210000-0000-4000-8000-000000000006',v_group,v_campaign,'email',11,'queued',false);
  INSERT INTO public.marketing_messages(id,campaign_id,recipient_email,channel,status)
  VALUES(v_message,v_campaign,'issue1821@example.test','email','queued');
  UPDATE public.marketing_messages SET status='preview_skipped' WHERE id=v_message;
  IF NOT EXISTS(SELECT 1 FROM public.brand_offering_invite_delivery_attempts
    WHERE id=v_attempt AND status='suppressed' AND safe_reason_code='provider_io_disabled')
  THEN RAISE EXCEPTION 'T-1821-05 FAIL: preview skip did not settle Suppressed'; END IF;

  -- Post-claim ambiguous failure.
  v_group:='18210000-0000-4000-8000-000000000321';
  v_campaign:='18210000-0000-4000-8000-000000000322';
  v_attempt:='18210000-0000-4000-8000-000000000323';
  v_message:='18210000-0000-4000-8000-000000000324';
  PERFORM pg_temp.issue_1821_campaign(v_campaign,'email');
  PERFORM pg_temp.issue_1821_group(v_group,'18210000-0000-4000-8000-000000000003',ARRAY['email'],1);
  PERFORM pg_temp.issue_1821_attempt(v_attempt,'18210000-0000-4000-8000-000000000006',v_group,v_campaign,'email',12,'sending',true);
  INSERT INTO public.marketing_messages(id,campaign_id,recipient_email,channel,status)
  VALUES(v_message,v_campaign,'issue1821@example.test','email','queued');
  UPDATE public.marketing_messages SET status='failed' WHERE id=v_message;
  IF NOT EXISTS(SELECT 1 FROM public.brand_offering_invite_delivery_attempts
    WHERE id=v_attempt AND status='sending' AND provider_accepted_at IS NULL
      AND safe_reason_code='provider_outcome_unknown' AND NOT is_retryable)
    OR NOT EXISTS(SELECT 1 FROM public.marketing_send_groups
      WHERE id=v_group AND status='running' AND queued_count=1 AND sent_count=0)
  THEN RAISE EXCEPTION 'T-1821-05 FAIL: post-claim ambiguity fabricated acceptance or retry'; END IF;
  RAISE NOTICE 'T-1821-05 PASS: pre-claim terminal states and post-claim ambiguity stay distinct';
END;
$failures$;

DO $matrix$
DECLARE
  v_group uuid;
  v_campaign uuid;
BEGIN
  -- accepted + failed => partial
  v_group:='18210000-0000-4000-8000-000000000401';
  v_campaign:='18210000-0000-4000-8000-000000000402';
  PERFORM pg_temp.issue_1821_campaign(v_campaign,'email');
  PERFORM pg_temp.issue_1821_group(v_group,'18210000-0000-4000-8000-000000000003',ARRAY['email','sms'],2);
  PERFORM pg_temp.issue_1821_attempt('18210000-0000-4000-8000-000000000403','18210000-0000-4000-8000-000000000006',v_group,v_campaign,'email',20,'sent',true);
  PERFORM pg_temp.issue_1821_attempt('18210000-0000-4000-8000-000000000404','18210000-0000-4000-8000-000000000006',v_group,v_campaign,'sms',20,'failed',false);
  PERFORM public.issue_1821_project_offering_send_group(v_group);
  IF NOT EXISTS(SELECT 1 FROM public.marketing_send_groups WHERE id=v_group
    AND status='partial' AND queued_count=0 AND sent_count=1 AND failed_count=1)
  THEN RAISE EXCEPTION 'T-1821-06 FAIL: accepted + failed was not partial'; END IF;

  -- accepted + suppressed => completed
  v_group:='18210000-0000-4000-8000-000000000411';
  v_campaign:='18210000-0000-4000-8000-000000000412';
  PERFORM pg_temp.issue_1821_campaign(v_campaign,'email');
  PERFORM pg_temp.issue_1821_group(v_group,'18210000-0000-4000-8000-000000000003',ARRAY['email','sms'],2);
  PERFORM pg_temp.issue_1821_attempt('18210000-0000-4000-8000-000000000413','18210000-0000-4000-8000-000000000006',v_group,v_campaign,'email',21,'sent',true);
  PERFORM pg_temp.issue_1821_attempt('18210000-0000-4000-8000-000000000414','18210000-0000-4000-8000-000000000006',v_group,v_campaign,'sms',21,'suppressed',false);
  PERFORM public.issue_1821_project_offering_send_group(v_group);
  IF NOT EXISTS(SELECT 1 FROM public.marketing_send_groups WHERE id=v_group
    AND status='completed' AND sent_count=1 AND suppressed_count=1 AND failed_count=0)
  THEN RAISE EXCEPTION 'T-1821-06 FAIL: accepted + suppressed was not completed'; END IF;

  -- all non-suppressed failed => failed; any queued/sending => running.
  v_group:='18210000-0000-4000-8000-000000000421';
  v_campaign:='18210000-0000-4000-8000-000000000422';
  PERFORM pg_temp.issue_1821_campaign(v_campaign,'email');
  PERFORM pg_temp.issue_1821_group(v_group,'18210000-0000-4000-8000-000000000003',ARRAY['email','sms'],3);
  PERFORM pg_temp.issue_1821_attempt('18210000-0000-4000-8000-000000000423','18210000-0000-4000-8000-000000000006',v_group,v_campaign,'email',22,'failed',false);
  PERFORM pg_temp.issue_1821_attempt('18210000-0000-4000-8000-000000000424','18210000-0000-4000-8000-000000000006',v_group,v_campaign,'sms',22,'failed',false);
  PERFORM pg_temp.issue_1821_attempt('18210000-0000-4000-8000-000000000425','18210000-0000-4000-8000-000000000006',v_group,v_campaign,'email',23,'suppressed',false);
  PERFORM public.issue_1821_project_offering_send_group(v_group);
  IF NOT EXISTS(SELECT 1 FROM public.marketing_send_groups WHERE id=v_group
    AND status='failed' AND failed_count=2 AND suppressed_count=1)
  THEN RAISE EXCEPTION 'T-1821-06 FAIL: all non-suppressed failed was not Failed'; END IF;
  v_group:='18210000-0000-4000-8000-000000000431';
  v_campaign:='18210000-0000-4000-8000-000000000432';
  PERFORM pg_temp.issue_1821_campaign(v_campaign,'email');
  PERFORM pg_temp.issue_1821_group(v_group,'18210000-0000-4000-8000-000000000003',ARRAY['email','sms'],3);
  PERFORM pg_temp.issue_1821_attempt('18210000-0000-4000-8000-000000000433','18210000-0000-4000-8000-000000000006',v_group,v_campaign,'email',24,'sending',true);
  PERFORM pg_temp.issue_1821_attempt('18210000-0000-4000-8000-000000000434','18210000-0000-4000-8000-000000000006',v_group,v_campaign,'sms',24,'failed',false);
  PERFORM pg_temp.issue_1821_attempt('18210000-0000-4000-8000-000000000435','18210000-0000-4000-8000-000000000006',v_group,v_campaign,'email',25,'suppressed',false);
  PERFORM public.issue_1821_project_offering_send_group(v_group);
  IF NOT EXISTS(SELECT 1 FROM public.marketing_send_groups WHERE id=v_group
    AND status='running' AND queued_count=1 AND failed_count=1 AND suppressed_count=1)
  THEN RAISE EXCEPTION 'T-1821-06 FAIL: nonterminal attempt did not keep Running'; END IF;
  RAISE NOTICE 'T-1821-06 PASS: mixed group matrix is exact';
END;
$matrix$;

DO $correlation$
DECLARE
  v_group_one uuid := '18210000-0000-4000-8000-000000000501';
  v_group_two uuid := '18210000-0000-4000-8000-000000000502';
  v_campaign uuid := '18210000-0000-4000-8000-000000000503';
  v_message uuid := '18210000-0000-4000-8000-000000000504';
BEGIN
  -- Ordinary marketing has zero matching attempts and remains unchanged.
  PERFORM pg_temp.issue_1821_campaign(v_campaign,'email');
  INSERT INTO public.marketing_messages(id,campaign_id,recipient_email,channel,status)
  VALUES(v_message,v_campaign,'ordinary@example.test','email','queued');
  UPDATE public.marketing_messages SET status='sent',provider_message_id='ordinary-1821'
  WHERE id=v_message;
  IF EXISTS(SELECT 1 FROM public.brand_offering_invite_delivery_attempts
    WHERE campaign_id=v_campaign)
  THEN RAISE EXCEPTION 'T-1821-08/12 FAIL: ordinary marketing created an offering attempt'; END IF;

  -- Two matches fail closed without mutating either attempt or group.
  PERFORM pg_temp.issue_1821_group(v_group_one,'18210000-0000-4000-8000-000000000003',ARRAY['email'],1);
  PERFORM pg_temp.issue_1821_group(v_group_two,'18210000-0000-4000-8000-000000000004',ARRAY['email'],1);
  PERFORM pg_temp.issue_1821_attempt('18210000-0000-4000-8000-000000000505','18210000-0000-4000-8000-000000000006',v_group_one,v_campaign,'email',30,'sending',true);
  PERFORM pg_temp.issue_1821_attempt('18210000-0000-4000-8000-000000000506','18210000-0000-4000-8000-000000000007',v_group_two,v_campaign,'email',30,'sending',true);
  BEGIN
    UPDATE public.marketing_messages SET
      recipient_email='issue1821@example.test',provider_message_id='ambiguous-1821'
    WHERE id=v_message;
    RAISE EXCEPTION 'T-1821-08 FAIL: duplicate correlation did not fail closed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF EXISTS(SELECT 1 FROM public.brand_offering_invite_delivery_attempts
    WHERE id IN ('18210000-0000-4000-8000-000000000505','18210000-0000-4000-8000-000000000506')
      AND (marketing_message_id IS NOT NULL OR status<>'sending'))
  THEN RAISE EXCEPTION 'T-1821-08 FAIL: ambiguous correlation mutated attempts'; END IF;
  RAISE NOTICE 'T-1821-08/12 PASS: zero match is no-op and duplicate match fails closed';
END;
$correlation$;

DO $catalog$
DECLARE
  v_projector text := pg_get_functiondef(
    'public.issue_1821_project_offering_send_group(uuid)'::regprocedure
  );
BEGIN
  IF position('FOR UPDATE' IN v_projector)=0
    OR position('FOR UPDATE' IN v_projector)>
       position('FROM public.brand_offering_invite_delivery_attempts' IN v_projector)
  THEN
    RAISE EXCEPTION 'T-1821-07 FAIL: group lock does not precede attempt recount';
  END IF;
  IF has_function_privilege(
      'anon','public.issue_1821_project_offering_send_group(uuid)','EXECUTE'
    ) OR has_function_privilege(
      'authenticated','public.issue_1821_project_offering_send_group(uuid)','EXECUTE'
    ) OR NOT has_function_privilege(
      'service_role','public.issue_1821_project_offering_send_group(uuid)','EXECUTE'
    ) OR has_function_privilege(
      'anon','public.issue_1770_project_offering_push_delivery(uuid)','EXECUTE'
    ) OR has_function_privilege(
      'authenticated','public.issue_1770_reconcile_marketing_message()','EXECUTE'
    ) OR NOT (
      SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']
      FROM pg_proc WHERE oid=
        'public.issue_1821_project_offering_send_group(uuid)'::regprocedure
    ) OR NOT (
      SELECT relrowsecurity FROM pg_class
      WHERE oid='public.brand_offering_invite_delivery_attempts'::regclass
    ) OR NOT (
      SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
      WHERE oid='public.offering_push_provider_events'::regclass
    )
  THEN
    RAISE EXCEPTION 'T-1821-09 FAIL: function grants/search path or RLS drifted';
  END IF;
  RAISE NOTICE 'T-1821-07/09 PASS: serialized projector and service-only catalog are pinned';
END;
$catalog$;

SET LOCAL ROLE anon;
DO $anon_denied$
BEGIN
  BEGIN
    PERFORM public.issue_1821_project_offering_send_group(
      '18210000-0000-4000-8000-000000000101'
    );
    RAISE EXCEPTION 'T-1821-09 FAIL: anon invoked internal group projector';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$anon_denied$;
RESET ROLE;

ROLLBACK;

-- T-1821-07: three real sessions complete email, SMS, and push through their
-- production owners. The email session deliberately holds the group lock while
-- the other two finish their own attempt rows and wait to project. The final
-- projector must recount all three committed rows, never publish stale totals.
CREATE EXTENSION IF NOT EXISTS dblink;

INSERT INTO auth.users(id)
VALUES ('18218888-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id)
VALUES ('18218888-0000-4000-8000-000000000001');
INSERT INTO public.brands(
  id,account_id,name,slug,default_currency,created_at,updated_at
) VALUES (
  '18218888-0000-4000-8000-000000000002',
  '18218888-0000-4000-8000-000000000001',
  'Issue 1821 Concurrency Brand','issue-1821-concurrency-brand','USD',now(),now()
);
INSERT INTO public.events(
  id,brand_id,created_by,event_type,title,slug,status,visibility,currency,
  timezone,party_types,rsvp_approval_mode,rsvp_discoverable,theme,
  created_at,updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000010',
  '18218888-0000-4000-8000-000000000002',
  '18218888-0000-4000-8000-000000000001',
  'rsvp','Issue 1821 Concurrent Event','issue-1821-concurrent-event',
  'scheduled','public','USD','UTC','{}','auto',false,'{}',now(),now()
);
INSERT INTO public.brand_people(id,brand_id,linked_user_id,display_name)
VALUES (
  '18218888-0000-4000-8000-000000000003',
  '18218888-0000-4000-8000-000000000002',
  '18218888-0000-4000-8000-000000000001',
  'Issue 1821 Concurrent Guest'
);
INSERT INTO public.brand_offering_invites(
  id,brand_id,event_id,brand_person_id,origin
) VALUES (
  '18218888-0000-4000-8000-000000000004',
  '18218888-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000010',
  '18218888-0000-4000-8000-000000000003','wizard'
);
INSERT INTO public.brand_person_contact_methods(
  id,brand_id,brand_person_id,channel,normalized_value,provenance_scope,
  is_exportable,suppression_eligible,is_primary
) VALUES
(
  '18218888-0000-4000-8000-000000000005',
  '18218888-0000-4000-8000-000000000002',
  '18218888-0000-4000-8000-000000000003',
  'email','issue1821-concurrent@example.test','brand_owned',true,true,true
),
(
  '18218888-0000-4000-8000-000000000006',
  '18218888-0000-4000-8000-000000000002',
  '18218888-0000-4000-8000-000000000003',
  'phone','+14155558888','brand_owned',true,true,true
);
INSERT INTO public.marketing_audiences(
  id,account_id,brand_id,name,query_definition
) VALUES (
  '18218888-0000-4000-8000-000000000007',
  '18218888-0000-4000-8000-000000000001',
  '18218888-0000-4000-8000-000000000002',
  'Issue 1821 Concurrent Audience','{"kind":"offering_send_group"}'
);
INSERT INTO public.marketing_campaigns(
  id,account_id,brand_id,audience_id,name,channel,channel_payload,status
) VALUES
(
  '18218888-0000-4000-8000-000000000008',
  '18218888-0000-4000-8000-000000000001',
  '18218888-0000-4000-8000-000000000002',
  '18218888-0000-4000-8000-000000000007',
  'Concurrent Email','email','{"kind":"email","subject":"Issue 1821 concurrent email fixture","body_html":"Issue 1821 concurrent email fixture"}','sending'
),
(
  '18218888-0000-4000-8000-000000000009',
  '18218888-0000-4000-8000-000000000001',
  '18218888-0000-4000-8000-000000000002',
  '18218888-0000-4000-8000-000000000007',
  'Concurrent SMS','sms','{"kind":"sms","body":"Issue 1821 concurrent SMS fixture"}','sending'
);
INSERT INTO public.marketing_send_groups(
  id,event_id,brand_id,purpose,client_request_id,channels,selection_snapshot,
  selected_count,eligible_count,reachable_count,queued_count,
  eligibility_hash,quote_hash,quoted_at,execution_snapshot_hash,
  push_payload_v1,push_payload_hash,created_by
) VALUES (
  '18218888-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000010',
  '18218888-0000-4000-8000-000000000002',
  'invitation','18218888-0000-4000-8000-000000000010',
  ARRAY['email','push','sms'],'{}',3,3,3,3,
  repeat('1',64),repeat('2',64),now(),repeat('3',64),
  '{"payloadVersion":1,"payloadHash":"7f2bac69104ea744d8f3b8eee0aff076a688f7f0da3d6452d52d2d5979e1e190","title":"You are invited","body":"Open Mingla for details.","eventId":"00000000-0000-4000-8000-000000000010"}'::jsonb,
  '7f2bac69104ea744d8f3b8eee0aff076a688f7f0da3d6452d52d2d5979e1e190',
  '18218888-0000-4000-8000-000000000001'
);
INSERT INTO public.brand_offering_invite_delivery_attempts(
  id,invite_id,send_group_id,campaign_id,contact_method_id,
  recipient_user_id,channel,attempt_kind,attempt_ordinal,status,
  provider_idempotency_key,provider_io_claimed_at,queued_at
) VALUES
(
  '18218888-0000-4000-8000-000000000011',
  '18218888-0000-4000-8000-000000000004',
  '18218888-0000-4000-8000-000000000010',
  '18218888-0000-4000-8000-000000000008',
  '18218888-0000-4000-8000-000000000005',NULL,
  'email','initial',1,'sending',
  'offering:18218888-0000-4000-8000-000000000011:email:v1',now(),now()
),
(
  '18218888-0000-4000-8000-000000000012',
  '18218888-0000-4000-8000-000000000004',
  '18218888-0000-4000-8000-000000000010',
  '18218888-0000-4000-8000-000000000009',
  '18218888-0000-4000-8000-000000000006',NULL,
  'sms','initial',1,'sending',
  'offering:18218888-0000-4000-8000-000000000012:sms:v1',now(),now()
),
(
  '18218888-0000-4000-8000-000000000013',
  '18218888-0000-4000-8000-000000000004',
  '18218888-0000-4000-8000-000000000010',NULL,NULL,
  '18218888-0000-4000-8000-000000000001',
  'push','initial',1,'sending',
  'offering:18218888-0000-4000-8000-000000000013:push:v1',now(),now()
);
INSERT INTO public.marketing_messages(
  id,campaign_id,recipient_email,recipient_phone,channel,status
) VALUES
(
  '18218888-0000-4000-8000-000000000014',
  '18218888-0000-4000-8000-000000000008',
  'issue1821-concurrent@example.test',NULL,'email','queued'
),
(
  '18218888-0000-4000-8000-000000000015',
  '18218888-0000-4000-8000-000000000009',
  NULL,'+14155558888','sms','queued'
);

CREATE OR REPLACE FUNCTION public.issue_1821_test_email_hold()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  UPDATE public.marketing_messages SET
    status='sent',sent_at=now(),provider_message_id='resend-concurrent-1821'
  WHERE id='18218888-0000-4000-8000-000000000014';
  PERFORM pg_sleep(1.2);
  RETURN true;
END;
$function$;

DO $concurrency$
DECLARE
  v_conn text:=format(
    'dbname=%L user=%L password=%L host=%L port=%L',
    current_database(),current_user,
    current_setting('issue_2393.dblink_password'),
    current_setting('unix_socket_directories'),current_setting('port')
  );
  v_ok boolean;
  v_push jsonb;
BEGIN
  PERFORM dblink_connect('issue1821_email',v_conn);
  PERFORM dblink_connect('issue1821_sms',v_conn);
  PERFORM dblink_connect('issue1821_push',v_conn);

  PERFORM dblink_send_query(
    'issue1821_email',
    'SELECT public.issue_1821_test_email_hold()'
  );
  PERFORM pg_sleep(0.15);
  PERFORM dblink_send_query(
    'issue1821_sms',
    $query$
      UPDATE public.marketing_messages SET
        status='sent',sent_at=now(),provider_message_id='SM1821CONCURRENT'
      WHERE id='18218888-0000-4000-8000-000000000015'
      RETURNING true
    $query$
  );
  PERFORM dblink_send_query(
    'issue1821_push',
    $query$
      SELECT public.biz_record_offering_push_dispatch_result(
        '18218888-0000-4000-8000-000000000013',
        'accepted',
        '18218888-0000-4000-8000-000000000016',
        '18218888-0000-4000-8000-000000000017',
        NULL,false
      )
    $query$
  );
  PERFORM pg_sleep(0.15);
  IF dblink_is_busy('issue1821_email')<>1
    OR dblink_is_busy('issue1821_sms')<>1
    OR dblink_is_busy('issue1821_push')<>1
  THEN
    RAISE EXCEPTION 'T-1821-07 FAIL: concurrent sessions did not overlap at the group lock';
  END IF;

  SELECT ok INTO v_ok
  FROM dblink_get_result('issue1821_email') AS result(ok boolean);
  SELECT ok INTO v_ok
  FROM dblink_get_result('issue1821_sms') AS result(ok boolean);
  SELECT result INTO v_push
  FROM dblink_get_result('issue1821_push') AS response(result jsonb);

  PERFORM dblink_disconnect('issue1821_email');
  PERFORM dblink_disconnect('issue1821_sms');
  PERFORM dblink_disconnect('issue1821_push');

  IF v_push->>'status'<>'sent'
    OR NOT EXISTS(
      SELECT 1 FROM public.marketing_send_groups
      WHERE id='18218888-0000-4000-8000-000000000010'
        AND status='completed' AND queued_count=0 AND sent_count=3
        AND delivered_count=0 AND failed_count=0 AND suppressed_count=0
        AND completed_at IS NOT NULL
    ) OR (SELECT count(*) FROM public.brand_offering_invite_delivery_attempts
          WHERE send_group_id='18218888-0000-4000-8000-000000000010'
            AND status='sent')<>3
  THEN
    RAISE EXCEPTION 'T-1821-07 FAIL: concurrent email/SMS/push projection published stale totals';
  END IF;
  RAISE NOTICE 'T-1821-07 PASS: concurrent email/SMS/push completion serialized to Sent=3';
END;
$concurrency$;

DELETE FROM public.brand_offering_invite_delivery_attempts
WHERE send_group_id='18218888-0000-4000-8000-000000000010';
DELETE FROM public.marketing_messages
WHERE id IN (
  '18218888-0000-4000-8000-000000000014',
  '18218888-0000-4000-8000-000000000015'
);
DROP FUNCTION public.issue_1821_test_email_hold();
DELETE FROM public.marketing_send_groups
WHERE id='18218888-0000-4000-8000-000000000010';
DELETE FROM public.marketing_campaigns
WHERE id IN (
  '18218888-0000-4000-8000-000000000008',
  '18218888-0000-4000-8000-000000000009'
);
DELETE FROM public.marketing_audiences
WHERE id='18218888-0000-4000-8000-000000000007';
DELETE FROM public.brand_person_contact_methods
WHERE brand_person_id='18218888-0000-4000-8000-000000000003';
DELETE FROM public.brand_offering_invites
WHERE id='18218888-0000-4000-8000-000000000004';
DELETE FROM public.brand_people
WHERE id='18218888-0000-4000-8000-000000000003';
DELETE FROM public.events
WHERE id='00000000-0000-4000-8000-000000000010';
DELETE FROM public.brands
WHERE id='18218888-0000-4000-8000-000000000002';
DELETE FROM auth.users
WHERE id='18218888-0000-4000-8000-000000000001';

\echo 'issue #1821 accepted email/SMS invitation tests passed (T-1821-01..12)'
