-- #1770 happy-path behavioral proof. Apply the full migration chain first.
-- Fixtures are transaction-bound and leave no rows behind.
\set ON_ERROR_STOP on
BEGIN;

DO $catalog$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'brand_people','brand_person_names','brand_person_source_links',
    'brand_person_contact_methods','brand_person_contact_method_sources',
    'brand_person_identity_conflicts','brand_person_merge_events',
    'brand_person_channel_suppressions','brand_offering_invites',
    'brand_offering_invite_tokens','marketing_send_groups',
    'marketing_send_group_campaigns','brand_offering_invite_delivery_attempts',
    'brand_person_ingest_outbox','brand_people_export_jobs','brand_people_export_audit'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'T-1770-00 FAIL: required table % is absent', v_table;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.biz_validate_offering_invite_token(text,uuid,uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.biz_validate_offering_invite_token(text,uuid,uuid,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.biz_validate_offering_invite_token(text,uuid,uuid,text,text,text)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'T-1770-00 FAIL: token validator ACL drifted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE contype='f' AND confrelid='auth.users'::regclass
      AND conrelid IN (
        'public.marketing_send_groups'::regclass,
        'public.brand_people_export_jobs'::regclass,
        'public.brand_people_export_audit'::regclass
      )
  ) THEN
    RAISE EXCEPTION 'T-1770-00 FAIL: retained actor audit would block full auth deletion';
  END IF;
  RAISE NOTICE 'T-1770-00 PASS: all Ring-1 tables and service-only validator exist';
END;
$catalog$;

DO $happy$
DECLARE
  v_owner uuid := '00000000-1770-4000-8000-000000000001';
  v_brand uuid := '00000000-1770-4000-8000-000000000002';
  v_event uuid := '00000000-1770-4000-8000-000000000003';
  v_rsvp uuid := '00000000-1770-4000-8000-000000000004';
  v_person uuid;
  v_first jsonb;
  v_second jsonb;
BEGIN
  INSERT INTO public.brands (id,account_id,slug,name,default_currency,created_at,updated_at)
  VALUES (v_brand,v_owner,'issue-1770-brand','Issue 1770 Brand','USD',now(),now());
  INSERT INTO public.events (
    id,brand_id,created_by,event_type,title,slug,description,status,visibility,
    currency,timezone,party_types,rsvp_approval_mode,rsvp_discoverable,
    created_at,updated_at,theme
  ) VALUES (
    v_event,v_brand,v_owner,'rsvp','Issue 1770 Event','issue-1770-event','fixture',
    'scheduled','public','USD','UTC',ARRAY['house-party'],'auto',false,now(),now(),'{}'::jsonb
  );
  INSERT INTO public.event_rsvps (
    id,event_id,user_id,guest_name,guest_email,guest_phone,rsvp_status,
    approval_status,plus_count,created_at
  ) VALUES (
    v_rsvp,v_event,NULL,'Ada Example',' ADA@Example.Test ',' +1 (555) 123-4567 ',
    'going','approved',0,now()
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.brand_person_ingest_outbox
    WHERE source_kind='event_rsvp' AND source_id=v_rsvp AND status='pending'
  ) THEN
    RAISE EXCEPTION 'T-1770-01 FAIL: RSVP write did not enqueue fail-open ingest';
  END IF;

  v_first := public.biz_resolve_brand_person_source_derived('event_rsvp',v_rsvp);
  v_person := (v_first->>'personId')::uuid;
  IF v_first->>'linkOutcome' <> 'linked' OR v_person IS NULL THEN
    RAISE EXCEPTION 'T-1770-01 FAIL: resolver did not link the RSVP: %', v_first;
  END IF;
  IF (SELECT count(*) FROM public.brand_person_contact_methods
      WHERE brand_person_id=v_person AND record_state='active') <> 2
     OR NOT EXISTS (SELECT 1 FROM public.brand_person_contact_methods
       WHERE brand_person_id=v_person AND channel='email' AND normalized_value='ada@example.test'
         AND provenance_scope='brand_owned' AND is_exportable)
     OR NOT EXISTS (SELECT 1 FROM public.brand_person_contact_methods
       WHERE brand_person_id=v_person AND channel='phone' AND normalized_value='+15551234567'
         AND provenance_scope='brand_owned' AND is_exportable)
  THEN
    RAISE EXCEPTION 'T-1770-01 FAIL: canonical contact projection is wrong';
  END IF;

  v_second := public.biz_resolve_brand_person_source_derived('event_rsvp',v_rsvp);
  IF v_second->>'linkOutcome' <> 'already_linked'
     OR (v_second->>'personId')::uuid <> v_person
     OR (SELECT count(*) FROM public.brand_people WHERE brand_id=v_brand AND record_status='active') <> 1
     OR (SELECT count(*) FROM public.brand_person_source_links
         WHERE source_kind='event_rsvp' AND source_id=v_rsvp AND detached_at IS NULL) <> 1
  THEN
    RAISE EXCEPTION 'T-1770-02 FAIL: replay duplicated identity or active source: %', v_second;
  END IF;
  RAISE NOTICE 'T-1770-01/02 PASS: source write enqueues and replay converges on one person';
END;
$happy$;

DO $stale_claim$
DECLARE
  v_job uuid := '00000000-1770-4000-8000-000000000040';
  v_old_lock timestamptz := now()-interval '1 hour';
BEGIN
  INSERT INTO public.brand_person_ingest_outbox(
    id,source_kind,source_id,operation,revision_key,status,locked_at
  ) VALUES(
    v_job,'event_rsvp','00000000-1770-4000-8000-000000000041','upsert','stale-claim-proof','processing',v_old_lock
  );
  PERFORM * FROM public.biz_claim_brand_person_ingest(100);
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_person_ingest_outbox
    WHERE id=v_job AND status='processing' AND locked_at>v_old_lock
  ) THEN
    RAISE EXCEPTION 'T-1770-02B FAIL: stale processing ingest was not reclaimed';
  END IF;
  RAISE NOTICE 'T-1770-02B PASS: stale processing ingest is restartable';
END;
$stale_claim$;

DO $suppression$
DECLARE
  v_brand uuid := '00000000-1770-4000-8000-000000000002';
  v_person uuid;
  v_allowed boolean;
BEGIN
  SELECT id INTO v_person FROM public.brand_people WHERE brand_id=v_brand AND display_name='Ada Example';
  INSERT INTO public.channel_suppressions(id,contact,channel,scope,reason,brand_id,created_at)
    VALUES('00000000-1770-4000-8000-000000000030','ada@example.test','email','marketing','unsubscribe',v_brand,now());
  SELECT allowed INTO v_allowed
    FROM public.biz_brand_person_authorized_contact(v_brand,v_person,'email','marketing');
  IF v_allowed IS DISTINCT FROM false
     OR NOT EXISTS (SELECT 1 FROM public.brand_person_channel_suppressions
       WHERE brand_person_id=v_person AND channel='email' AND scope='marketing' AND lifted_at IS NULL)
  THEN
    RAISE EXCEPTION 'T-1770-03 FAIL: contact STOP did not suppress the canonical person';
  END IF;
  RAISE NOTICE 'T-1770-03 PASS: legacy STOP projects to person-wide email suppression';
END;
$suppression$;

CREATE OR REPLACE FUNCTION public.can_send(uuid,text,text,text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $function$ SELECT false $function$;

DO $can_send$
DECLARE
  v_brand uuid := '00000000-1770-4000-8000-000000000002';
  v_person uuid;
  v_allowed boolean;
  v_reason text;
BEGIN
  SELECT id INTO v_person FROM public.brand_people WHERE brand_id=v_brand AND display_name='Ada Example';
  SELECT allowed,reason INTO v_allowed,v_reason
    FROM public.biz_brand_person_authorized_contact(v_brand,v_person,'sms','marketing');
  IF v_allowed IS DISTINCT FROM false OR v_reason IS DISTINCT FROM 'can_send_denied' THEN
    RAISE EXCEPTION 'T-1770-03B FAIL: current can_send denial was bypassed: allowed %, reason %',v_allowed,v_reason;
  END IF;
  RAISE NOTICE 'T-1770-03B PASS: authorized contact honors the current can_send chokepoint';
END;
$can_send$;

DO $merge$
DECLARE
  v_brand uuid := '00000000-1770-4000-8000-000000000002';
  v_winner uuid;
  v_loser uuid := '00000000-1770-4000-8000-000000000020';
  v_source uuid := '00000000-1770-4000-8000-000000000021';
  v_link uuid := '00000000-1770-4000-8000-000000000022';
  v_contact uuid := '00000000-1770-4000-8000-000000000023';
  v_merge uuid;
  v_reversal jsonb;
BEGIN
  SELECT id INTO v_winner FROM public.brand_people WHERE brand_id=v_brand AND display_name='Ada Example';
  INSERT INTO public.brand_people(id,brand_id,display_name) VALUES(v_loser,v_brand,'Ada Example');
  INSERT INTO public.brand_person_source_links(
    id,brand_id,brand_person_id,source_kind,source_id,link_method,source_occurred_at
  ) VALUES(v_link,v_brand,v_loser,'manual',v_source,'manual_resolution',now());
  INSERT INTO public.brand_person_names(brand_person_id,display_name,normalized_name,name_kind,source_link_id)
    VALUES(v_loser,'Ada Example','ada example','primary',v_link);
  INSERT INTO public.brand_person_contact_methods(
    id,brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary
  ) VALUES(v_contact,v_brand,v_loser,'email','alternate@example.test','brand_owned',true,true);
  INSERT INTO public.brand_person_contact_method_sources(contact_method_id,source_link_id,provenance_kind,exportable)
    VALUES(v_contact,v_link,'manual',true);

  v_merge := public.biz_merge_brand_people(v_winner,v_loser,'manual_resolution',v_link,NULL);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF public.biz_brand_person_canonical(v_loser) <> v_winner
     OR NOT EXISTS (SELECT 1 FROM public.brand_person_source_links WHERE source_kind='manual' AND source_id=v_source AND brand_person_id=v_winner AND detached_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.brand_person_contact_methods WHERE brand_person_id=v_winner AND normalized_value='alternate@example.test' AND record_state='active')
  THEN
    RAISE EXCEPTION 'T-1770-04 FAIL: merge lost canonical source/contact truth';
  END IF;

  v_reversal := public.biz_reverse_brand_person_merge(v_merge,NULL);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF v_reversal->>'status' <> 'reversed'
     OR public.biz_brand_person_canonical(v_loser) <> v_loser
     OR NOT EXISTS (SELECT 1 FROM public.brand_person_source_links WHERE id=v_link AND detached_at IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.brand_person_contact_methods WHERE id=v_contact AND record_state='active')
     OR EXISTS (SELECT 1 FROM public.brand_person_contact_methods WHERE brand_person_id=v_winner AND normalized_value='alternate@example.test' AND record_state='active')
  THEN
    RAISE EXCEPTION 'T-1770-04 FAIL: reversal did not restore the exact partition: %', v_reversal;
  END IF;
  RAISE NOTICE 'T-1770-04 PASS: merge and safe reversal preserve source/contact provenance';
END;
$merge$;

DO $token$
DECLARE
  v_brand uuid := '00000000-1770-4000-8000-000000000002';
  v_event uuid := '00000000-1770-4000-8000-000000000003';
  v_person uuid;
  v_contact uuid;
  v_invite uuid := '00000000-1770-4000-8000-000000000010';
  v_raw text := 'issue-1770-opaque-token-material-at-least-32-bytes';
  v_pepper text := repeat('ab',32);
  v_hash text;
  v_deleted_user uuid := '00000000-1770-4000-8000-000000000050';
  v_user_token uuid;
  v_group uuid := '00000000-1770-4000-8000-000000000060';
  v_email_attempt uuid := '00000000-1770-4000-8000-000000000061';
  v_push_attempt uuid := '00000000-1770-4000-8000-000000000062';
BEGIN
  SELECT p.id,c.id INTO v_person,v_contact
    FROM public.brand_people p JOIN public.brand_person_contact_methods c ON c.brand_person_id=p.id
    WHERE p.brand_id=v_brand AND p.display_name='Ada Example' AND p.record_status='active'
      AND c.channel='email' AND c.normalized_value='ada@example.test' AND c.record_state='active';
  v_hash := encode(extensions.hmac(convert_to('mingla:offering-invite:lookup:v1','UTF8')||decode('00','hex')||convert_to(v_raw,'UTF8'),decode(v_pepper,'hex'),'sha256'),'hex');
  INSERT INTO public.brand_offering_invites(id,brand_id,event_id,brand_person_id,origin)
    VALUES(v_invite,v_brand,v_event,v_person,'wizard');
  INSERT INTO public.marketing_send_groups(id,event_id,brand_id,purpose,client_request_id,channels,selection_snapshot,
    eligibility_hash,quote_hash,quoted_at,execution_snapshot_hash,push_payload_v1,push_payload_hash,created_by)
    VALUES(v_group,v_event,v_brand,'invitation',gen_random_uuid(),ARRAY['email','push'],'{}',repeat('1',64),repeat('2',64),now(),repeat('3',64),
      '{"payloadVersion":1,"payloadHash":"64a16f2ec78dbe49aaa2043b2f5f8d4d1b2f7a88cd205ccf9e24812c48b76b41","title":"Audit","body":"Body","eventId":"00000000-1770-4000-8000-000000000003"}'::jsonb,
      '64a16f2ec78dbe49aaa2043b2f5f8d4d1b2f7a88cd205ccf9e24812c48b76b41',gen_random_uuid());
  INSERT INTO public.brand_offering_invite_delivery_attempts(id,invite_id,send_group_id,contact_method_id,channel,attempt_kind,attempt_ordinal,status)
    VALUES(v_email_attempt,v_invite,v_group,v_contact,'email','initial',1,'sending');
  INSERT INTO public.brand_offering_invite_tokens(invite_id,delivery_attempt_id,token_hash,contact_method_id,expires_at)
    VALUES(v_invite,v_email_attempt,v_hash,v_contact,now()+interval '1 hour');

  IF public.biz_validate_offering_invite_token(
      v_raw,v_event,NULL,' ADA@example.test ',NULL,v_pepper
    ) IS DISTINCT FROM v_invite
  THEN
    RAISE EXCEPTION 'T-1770-05 FAIL: event/contact-bound token did not validate';
  END IF;
  IF public.biz_validate_offering_invite_token(
      v_raw,v_event,NULL,'ada@example.test',NULL,v_pepper
    ) IS DISTINCT FROM v_invite
  THEN
    RAISE EXCEPTION 'T-1770-05 FAIL: legitimate retry lost attribution';
  END IF;
  IF public.biz_validate_offering_invite_token(
      v_raw,'00000000-1770-4000-8000-000000000099',NULL,'ada@example.test',NULL,v_pepper
    ) IS NOT NULL
  THEN
    RAISE EXCEPTION 'T-1770-05 FAIL: wrong event accepted the token';
  END IF;
  INSERT INTO auth.users(id) VALUES(v_deleted_user);
  INSERT INTO public.brand_offering_invite_delivery_attempts(id,invite_id,send_group_id,recipient_user_id,channel,attempt_kind,attempt_ordinal,status)
    VALUES(v_push_attempt,v_invite,v_group,v_deleted_user,'push','initial',1,'sending');
  INSERT INTO public.brand_offering_invite_tokens(invite_id,delivery_attempt_id,token_hash,linked_user_id,expires_at)
    VALUES(v_invite,v_push_attempt,repeat('cd',32),v_deleted_user,now()+interval '1 hour') RETURNING id INTO v_user_token;
  DELETE FROM auth.users WHERE id=v_deleted_user;
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_offering_invite_tokens
    WHERE id=v_user_token AND linked_user_id IS NULL AND revoked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'T-1770-05B FAIL: auth erasure deleted token audit instead of revoking it';
  END IF;
  RAISE NOTICE 'T-1770-05 PASS: HMAC token is event-bound and retry-idempotent';
END;
$token$;

CREATE OR REPLACE FUNCTION public.can_send(uuid,text,text,text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $function$ SELECT true $function$;

DO $execution$
DECLARE
  v_actor uuid := '00000000-0000-4000-8000-000000000013';
  v_other_actor uuid := '00000000-0000-4000-8000-000000000014';
  v_brand uuid := '00000000-0000-4000-8000-000000000011';
  v_event uuid := '00000000-0000-4000-8000-000000000010';
  v_person uuid := '00000000-0000-4000-8000-000000000012';
  v_request uuid := '00000000-0000-4000-8000-000000000020';
  v_selection jsonb := '{"kind":"all_brand_people"}';
  v_snapshot jsonb;
  v_result jsonb;
  v_claim jsonb;
  v_retry_quote jsonb;
  v_attempt_id uuid;
  v_invite_id uuid;
  v_contact_id uuid := '00000000-0000-4000-8000-000000000018';
  v_notification_id uuid := '00000000-0000-4000-8000-000000000019';
  v_provider_app uuid := '00000000-0000-4000-8000-000000000020';
  v_provider_message uuid := '00000000-0000-4000-8000-000000000021';
BEGIN
  INSERT INTO auth.users(id) VALUES(v_actor),(v_other_actor);
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
    VALUES(v_brand,v_actor,'Vector Brand','brand','USD',now(),now());
  INSERT INTO public.events(id,brand_id,created_by,event_type,title,slug,status,visibility,currency,timezone,party_types,rsvp_approval_mode,rsvp_discoverable,theme,created_at,updated_at)
    VALUES(v_event,v_brand,v_actor,'rsvp','Vector Event','event','scheduled','public','USD','UTC','{}','auto',false,'{}',now(),now());
  INSERT INTO public.brand_people(id,brand_id,linked_user_id,display_name)
    VALUES(v_person,v_brand,v_actor,'Vector Person');
  v_snapshot:=jsonb_set(
    '{"schemaVersion":1,"eventId":"00000000-0000-4000-8000-000000000010","brandId":"00000000-0000-4000-8000-000000000011","purpose":"invitation","channels":["push"],"selectionHash":"0aab0215306062746291cbf9522fbad30fcf73d09f35e674d86919503a3624ad","eligibilityHash":"70cc604457197664b3e37a2bf90b1aaa776ddc868990bc623d3e67941e08048d","quotedAt":"2026-08-10T17:00:00.000000Z","quote":{"quoteHash":"f728849956e438fca425545d5c66e1b1b64d28ac5a420cdd7e53d6d8b22f15e6","smsSegments":0,"estimatedCostMinor":0,"currency":null,"rateIds":[]},"campaigns":{"email":null,"sms":null,"push":{"payloadVersion":1,"payloadHash":"7f2bac69104ea744d8f3b8eee0aff076a688f7f0da3d6452d52d2d5979e1e190","title":"You are invited","body":"Open Mingla for details.","eventId":"00000000-0000-4000-8000-000000000010"}},"candidates":[{"candidateKey":"00000000-0000-4000-8000-000000000012:push:00000000-0000-4000-8000-000000000013","brandPersonId":"00000000-0000-4000-8000-000000000012","inviteId":null,"predecessorAttemptId":null,"channel":"push","contactMethodId":null,"recipientUserId":"00000000-0000-4000-8000-000000000013","outcome":"queued","safeReasonCode":null,"attemptKind":"initial","smsQuote":null}],"executionSnapshotHash":"abf6b0837b8ad668503d46f7e2139a145fcc06f96d25beab89108b5523e066fc"}'::jsonb,
    '{quotedAt}',to_jsonb(to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  IF public.biz_seal_offering_execution_snapshot(v_actor,v_selection,v_snapshot)->>'executionSnapshotHash'
    IS DISTINCT FROM v_snapshot->>'executionSnapshotHash' THEN
    RAISE EXCEPTION 'T-1770-06 FAIL: SQL seal disagreed with Deno vector';
  END IF;
  v_result:=public.biz_execute_offering_send_group(v_actor,v_event,'invitation',v_selection,ARRAY['push'],v_request,v_snapshot);
  IF NOT EXISTS(SELECT 1 FROM public.marketing_send_groups WHERE id=(v_result->>'groupId')::uuid
    AND created_by=v_actor AND execution_snapshot_hash=v_snapshot->>'executionSnapshotHash'
    AND push_payload_v1=v_snapshot->'campaigns'->'push'
    AND push_payload_hash=v_snapshot->'campaigns'->'push'->>'payloadHash')
    OR NOT EXISTS(SELECT 1 FROM public.brand_offering_invite_delivery_attempts
      WHERE send_group_id=(v_result->>'groupId')::uuid AND channel='push' AND status='queued') THEN
    RAISE EXCEPTION 'T-1770-06 FAIL: atomic execute lost actor/group/attempt truth';
  END IF;
  BEGIN
    UPDATE public.marketing_send_groups SET push_payload_hash=repeat('0',64)
      WHERE id=(v_result->>'groupId')::uuid;
    RAISE EXCEPTION 'T-1770-06 FAIL: service role mutated immutable push payload';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%offering_push_payload_immutable%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.brand_offering_invite_delivery_attempts SET status='failed'
      WHERE send_group_id=(v_result->>'groupId')::uuid AND channel='push';
    RAISE EXCEPTION 'T-1770-06 FAIL: direct preclaim terminal write bypassed result owner';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%offering_push_preclaim_result_owner_required%' THEN RAISE; END IF;
  END;
  SELECT invite_id INTO v_invite_id FROM public.brand_offering_invite_delivery_attempts
    WHERE send_group_id=(v_result->>'groupId')::uuid AND channel='push';
  UPDATE public.brand_offering_invites SET status='removed',removed_at=now(),removal_reason='host_removed'
    WHERE id=v_invite_id;
  BEGIN
    PERFORM public.biz_preflight_offering_push_provider_io(a.id)
      FROM public.brand_offering_invite_delivery_attempts a WHERE a.send_group_id=(v_result->>'groupId')::uuid;
    RAISE EXCEPTION 'T-1770-06 FAIL: preflight accepted inactive invite';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  UPDATE public.brand_offering_invites SET status='active',removed_at=NULL,removal_reason=NULL WHERE id=v_invite_id;
  SELECT public.biz_preflight_offering_push_provider_io(a.id) INTO v_claim
    FROM public.brand_offering_invite_delivery_attempts a WHERE a.send_group_id=(v_result->>'groupId')::uuid;
  v_claim:=public.biz_claim_offering_push_provider_io(
    (v_claim->>'attemptId')::uuid,(v_claim->>'recipientUserId')::uuid,
    v_claim->>'internalProviderClaimKey',v_claim->'pushPayload');
  IF v_claim->'pushPayload' IS DISTINCT FROM v_snapshot->'campaigns'->'push'
    OR v_claim->>'recipientUserId'<>v_actor::text THEN
    RAISE EXCEPTION 'T-1770-06 FAIL: DB claim did not return stored push payload';
  END IF;
  BEGIN
    PERFORM public.biz_record_offering_push_dispatch_result(
      (v_claim->>'attemptId')::uuid,'definitive_unsent_terminal',NULL,NULL,'provider_raw_error_text',false);
    RAISE EXCEPTION 'T-1770-06 FAIL: result RPC persisted unallowlisted provider text';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE public.brand_offering_invite_delivery_attempts SET
    status='failed',is_retryable=true,safe_reason_code='provider_rejected',failed_at=now()
    WHERE id=(v_claim->>'attemptId')::uuid;
  v_retry_quote:=public.biz_offering_send_quote_candidates(
    v_actor,v_event,'retry_delivery',
    jsonb_build_object('kind','failed_attempts_v1','failedAttemptIds',jsonb_build_array(v_claim->>'attemptId'),
      'selectionHash',repeat('4',64),'source','guest_roster_actions'),ARRAY['push']
  );
  IF v_retry_quote->'retryPushPayload' IS DISTINCT FROM v_snapshot->'campaigns'->'push' THEN
    RAISE EXCEPTION 'T-1770-06 FAIL: retry quote did not source immutable group push payload';
  END IF;
  v_attempt_id:=(v_claim->>'attemptId')::uuid;
  SELECT invite_id INTO v_invite_id FROM public.brand_offering_invite_delivery_attempts WHERE id=v_attempt_id;
  INSERT INTO public.notifications(id,user_id,type,title,body,data,idempotency_key)
    VALUES(v_notification_id,v_actor,'offering_invitation','You are invited','Open Mingla for details.','{}',v_claim->>'internalProviderClaimKey');
  PERFORM public.biz_reconcile_offering_push_event(
    '00000000-0000-4000-8000-000000000022','message.push.failed',now(),v_provider_app,
    v_provider_message,v_actor,v_attempt_id);
  IF NOT EXISTS(SELECT 1 FROM public.brand_offering_invite_delivery_attempts WHERE id=v_attempt_id
      AND status='failed' AND safe_reason_code='provider_push_failed') THEN
    RAISE EXCEPTION 'T-1770-07 FAIL: negative-only evidence lost safe failure truth';
  END IF;
  PERFORM public.biz_reconcile_offering_push_event(
    '00000000-0000-4000-8000-000000000023','message.push.sent',now(),v_provider_app,
    v_provider_message,v_actor,v_attempt_id);
  IF NOT EXISTS(SELECT 1 FROM public.notification_deliveries WHERE notification_id=v_notification_id
      AND channel='push' AND status='sent' AND provider_app_id=v_provider_app AND provider_message_id=v_provider_message::text
      AND failed_reason='provider_partial_failure')
    OR NOT EXISTS(SELECT 1 FROM public.brand_offering_invite_delivery_attempts WHERE id=v_attempt_id
      AND status='sent' AND safe_reason_code='provider_partial_failure') THEN
    RAISE EXCEPTION 'T-1770-07 FAIL: callback-before-delivery did not project sent truth';
  END IF;
  PERFORM public.biz_reconcile_offering_push_event(
    '00000000-0000-4000-8000-000000000024','message.push.received',now(),v_provider_app,
    v_provider_message,v_actor,v_attempt_id);
  IF NOT EXISTS(SELECT 1 FROM public.notification_deliveries WHERE notification_id=v_notification_id
      AND status='delivered' AND delivered_at IS NOT NULL AND failed_reason IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.brand_offering_invite_delivery_attempts WHERE id=v_attempt_id
      AND status='delivered' AND safe_reason_code IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.marketing_send_groups WHERE id=(v_result->>'groupId')::uuid AND delivered_count=1) THEN
    RAISE EXCEPTION 'T-1770-07 FAIL: received evidence did not project delivery/group truth';
  END IF;
  BEGIN
    UPDATE public.brand_offering_invite_delivery_attempts SET status='failed' WHERE id=v_attempt_id;
    RAISE EXCEPTION 'T-1770-07 FAIL: push delivered downgraded to failed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO public.brand_person_contact_methods(id,brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,suppression_eligible,is_primary)
    VALUES(v_contact_id,v_brand,v_person,'email','vector@example.com','brand_owned',true,true,true);
  INSERT INTO public.brand_offering_invite_delivery_attempts(invite_id,send_group_id,contact_method_id,channel,attempt_kind,status)
    VALUES(v_invite_id,(v_result->>'groupId')::uuid,v_contact_id,'email','initial','failed');
  BEGIN
    UPDATE public.brand_offering_invite_delivery_attempts SET status='sent'
      WHERE send_group_id=(v_result->>'groupId')::uuid AND channel='email';
    RAISE EXCEPTION 'T-1770-07 FAIL: email failed advanced to sent';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM public.biz_reconcile_offering_push_event(
    '00000000-0000-4000-8000-000000000025','message.push.unsubscribed',now(),v_provider_app,
    v_provider_message,'00000000-0000-4000-8000-000000000025','00000000-0000-4000-8000-000000000026');
  IF NOT EXISTS(SELECT 1 FROM public.offering_push_provider_events WHERE event_id='00000000-0000-4000-8000-000000000025' AND disposition='ignored_kind' AND attempt_id IS NULL AND evidence_kind IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.brand_offering_invite_delivery_attempts WHERE id=v_attempt_id AND status='delivered') THEN
    RAISE EXCEPTION 'T-1770-07 FAIL: unsubscribe was not dedupe-only';
  END IF;
  RAISE NOTICE 'T-1770-07 PASS: callback projection, monotonic delivery, channel parity, and ignored-kind dedupe hold';
  DELETE FROM public.notification_deliveries WHERE notification_id=v_notification_id;
  DELETE FROM public.notifications WHERE id=v_notification_id;
  v_snapshot:=jsonb_set(v_snapshot,'{quotedAt}',to_jsonb(to_char((clock_timestamp()+interval '1 second') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  IF (public.biz_execute_offering_send_group(v_actor,v_event,'invitation',v_selection,ARRAY['push'],v_request,v_snapshot)->>'groupId')::uuid
    IS DISTINCT FROM (v_result->>'groupId')::uuid THEN
    RAISE EXCEPTION 'T-1770-06 FAIL: stable-hash replay duplicated group';
  END IF;
  UPDATE public.brands SET account_id=v_other_actor WHERE id=v_brand;
  BEGIN
    PERFORM public.biz_execute_offering_send_group(v_other_actor,v_event,'invitation',v_selection,ARRAY['push'],v_request,v_snapshot);
    RAISE EXCEPTION 'T-1770-06 FAIL: actor-changed replay succeeded';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM NOT LIKE '%idempotency_actor_mismatch%' THEN RAISE; END IF;
  END;
  DELETE FROM auth.users WHERE id=v_actor;
  IF NOT EXISTS(SELECT 1 FROM public.marketing_send_groups WHERE id=(v_result->>'groupId')::uuid
      AND created_by=v_actor AND created_by_erased_at IS NOT NULL)
    OR NOT EXISTS(SELECT 1 FROM public.brand_offering_invite_delivery_attempts
      WHERE send_group_id=(v_result->>'groupId')::uuid AND recipient_user_id IS NULL AND recipient_erased_at IS NOT NULL) THEN
    RAISE EXCEPTION 'T-1770-06 FAIL: erasure did not preserve pseudonymous send audit';
  END IF;
  RAISE NOTICE 'T-1770-06 PASS: seal, actor-bound execute/replay, and erasure are truthful';
END;
$execution$;

-- [TEST-MOD-APPROVED #1770] The approved QA rework appends behavioral proof
-- for deterministic source revisions and server-owned export filters.
DO $source_revision$
DECLARE
  v_event uuid := '00000000-1770-4000-8000-000000000003';
  v_rsvp uuid := '00000000-1770-4000-8000-000000000081';
  v_before integer;
  v_after_noop integer;
  v_after_status integer;
  v_after_identity integer;
  v_result jsonb;
BEGIN
  INSERT INTO public.event_rsvps(id,event_id,user_id,guest_name,guest_email,guest_phone,rsvp_status,approval_status,plus_count,created_at)
  VALUES(v_rsvp,v_event,NULL,'Revision Person','revision-a@example.test','+15550000081','going','approved',0,now());
  SELECT count(*) INTO v_before FROM public.brand_person_ingest_outbox WHERE source_kind='event_rsvp' AND source_id=v_rsvp;
  UPDATE public.event_rsvps SET guest_name=guest_name WHERE id=v_rsvp;
  SELECT count(*) INTO v_after_noop FROM public.brand_person_ingest_outbox WHERE source_kind='event_rsvp' AND source_id=v_rsvp;
  UPDATE public.event_rsvps SET rsvp_status='waitlisted' WHERE id=v_rsvp;
  SELECT count(*) INTO v_after_status FROM public.brand_person_ingest_outbox WHERE source_kind='event_rsvp' AND source_id=v_rsvp;
  UPDATE public.event_rsvps SET guest_email=' REVISION-B@EXAMPLE.TEST ' WHERE id=v_rsvp;
  SELECT count(*) INTO v_after_identity FROM public.brand_person_ingest_outbox WHERE source_kind='event_rsvp' AND source_id=v_rsvp;
  IF (v_before,v_after_noop,v_after_status,v_after_identity) IS DISTINCT FROM (1,1,2,3) THEN
    RAISE EXCEPTION 'T-1770-08 FAIL: source revision counts were %/%/%/% instead of 1/1/2/3',v_before,v_after_noop,v_after_status,v_after_identity;
  END IF;
  v_result:=public.biz_resolve_brand_person_source_derived('event_rsvp',v_rsvp);
  PERFORM public.biz_resolve_brand_person_source_derived('event_rsvp',v_rsvp);
  IF (v_result->>'personId') IS NULL OR (SELECT count(*) FROM public.brand_person_source_links WHERE source_kind='event_rsvp' AND source_id=v_rsvp AND detached_at IS NULL)<>1 THEN
    RAISE EXCEPTION 'T-1770-08 FAIL: revision replay did not converge: %',v_result;
  END IF;
  RAISE NOTICE 'T-1770-08 PASS: insert/no-op/status/identity is 1/1/2/3 and resolver replay converges';
END;
$source_revision$;

DO $approval_revision$
DECLARE
  v_event uuid := '00000000-1770-4000-8000-000000000003';
  v_rsvp uuid := '00000000-1770-4000-8000-000000000085';
  v_before integer;
  v_after_approval integer;
  v_after_noop integer;
BEGIN
  INSERT INTO public.event_rsvps(id,event_id,user_id,guest_name,guest_email,guest_phone,rsvp_status,approval_status,plus_count,created_at)
  VALUES(v_rsvp,v_event,NULL,'Approval Person','approval-a@example.test','+15550000085','going','approved',0,now());
  SELECT count(*) INTO v_before FROM public.brand_person_ingest_outbox WHERE source_kind='event_rsvp' AND source_id=v_rsvp;
  UPDATE public.event_rsvps SET approval_status='pending' WHERE id=v_rsvp;
  SELECT count(*) INTO v_after_approval FROM public.brand_person_ingest_outbox WHERE source_kind='event_rsvp' AND source_id=v_rsvp;
  UPDATE public.event_rsvps SET approval_status=approval_status WHERE id=v_rsvp;
  SELECT count(*) INTO v_after_noop FROM public.brand_person_ingest_outbox WHERE source_kind='event_rsvp' AND source_id=v_rsvp;
  IF (v_before,v_after_approval,v_after_noop) IS DISTINCT FROM (1,2,2) THEN
    RAISE EXCEPTION 'T-1770-08B FAIL: approval revision counts were %/%/% instead of 1/2/2',v_before,v_after_approval,v_after_noop;
  END IF;
  RAISE NOTICE 'T-1770-08B PASS: approval change enqueues independently and its true no-op coalesces';
END;
$approval_revision$;

CREATE OR REPLACE FUNCTION public.issue_1770_test_force_enqueue_failure()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'forced_enqueue_failure';
END;
$function$;
CREATE TRIGGER issue_1770_test_force_enqueue_failure
  BEFORE INSERT ON public.brand_person_ingest_outbox
  FOR EACH ROW EXECUTE FUNCTION public.issue_1770_test_force_enqueue_failure();

DO $source_fail_open$
DECLARE
  v_rsvp uuid := '00000000-1770-4000-8000-000000000085';
  v_before integer;
BEGIN
  SELECT count(*) INTO v_before FROM public.brand_person_ingest_outbox WHERE source_kind='event_rsvp' AND source_id=v_rsvp;
  UPDATE public.event_rsvps SET approval_status='denied' WHERE id=v_rsvp;
  IF (SELECT approval_status FROM public.event_rsvps WHERE id=v_rsvp)<>'denied'
     OR (SELECT count(*) FROM public.brand_person_ingest_outbox WHERE source_kind='event_rsvp' AND source_id=v_rsvp)<>v_before THEN
    RAISE EXCEPTION 'T-1770-08C FAIL: forced enqueue failure rolled back source or wrote outbox';
  END IF;
  RAISE NOTICE 'T-1770-08C PASS: forced enqueue failure leaves the RSVP source committed';
END;
$source_fail_open$;

DROP TRIGGER issue_1770_test_force_enqueue_failure ON public.brand_person_ingest_outbox;
DROP FUNCTION public.issue_1770_test_force_enqueue_failure();

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $function$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $function$;

DO $export_filters$
DECLARE
  v_owner uuid := '00000000-1770-4000-8000-000000000001';
  v_brand uuid := '00000000-1770-4000-8000-000000000002';
  v_job uuid;
  v_rows jsonb;
  v_snapshot jsonb;
BEGIN
  SELECT account_id INTO v_owner FROM public.brands WHERE id=v_brand;
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  BEGIN
    PERFORM public.biz_export_brand_people('brand_book',NULL,'suppressed',NULL,'name_asc',
      '{"brandPersonIds":["00000000-1770-4000-8000-000000000001"],"rawSql":"select * from auth.users","email":"private@example.test"}'::jsonb,
      '00000000-1770-4000-8000-000000000082');
    RAISE EXCEPTION 'T-1770-09 FAIL: arbitrary caller snapshot was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  v_job:=(public.biz_export_brand_people('brand_book',NULL,'suppressed','  ADA  ','name_asc','{}'::jsonb,
    '00000000-1770-4000-8000-000000000083')->>'jobId')::uuid;
  SELECT filter_json INTO v_snapshot FROM public.brand_people_export_jobs WHERE id=v_job;
  SELECT COALESCE(jsonb_agg(row_data),'[]'::jsonb) INTO v_rows FROM public.biz_brand_people_export_rows(v_job);
  IF public.issue_1770_json_keys(v_snapshot)<>ARRAY['filter','search','sort']::text[]
     OR v_snapshot->>'search'<>'ada' OR jsonb_array_length(v_rows)<>1
     OR NOT (v_rows->0->>'suppressedEmail')::boolean OR v_rows->0->>'name'<>'Ada Example' THEN
    RAISE EXCEPTION 'T-1770-09 FAIL: canonical filtered export drifted; snapshot %, rows %',v_snapshot,v_rows;
  END IF;
  BEGIN
    PERFORM public.biz_export_brand_people('brand_book',NULL,'rsvpd',NULL,'action_priority','{}'::jsonb,
      '00000000-1770-4000-8000-000000000084');
    RAISE EXCEPTION 'T-1770-09 FAIL: cross-scope filter was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RAISE NOTICE 'T-1770-09 PASS: export rejects caller JSON and applies canonical suppression/search';
END;
$export_filters$;

ROLLBACK;
\echo 'issue #1770 happy path passed (T-1770-00..09)'
