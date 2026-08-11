-- #873 provider-acceptance, response, commerce-precedence, rollout, and ACL proof.
-- Run after the full migration chain on fresh PostgreSQL 17.
\set ON_ERROR_STOP on
BEGIN;

DO $catalog$
BEGIN
  IF to_regclass('public.guest_roster_change_events') IS NULL
     OR to_regclass('public.guest_roster_brand_rollouts') IS NULL THEN
    RAISE EXCEPTION 'T-873-00 FAIL: roster rollout/realtime tables missing';
  END IF;
  IF has_function_privilege('anon','public.biz_guest_roster_list(uuid,text,text,text,jsonb,integer)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.biz_guest_roster_list(uuid,text,text,text,jsonb,integer)','EXECUTE')
     OR has_function_privilege('authenticated','public.biz_guest_roster_project(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.biz_offering_guest_roster_export_rows(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'T-873-00 FAIL: read/provider ACL drift';
  END IF;
  IF (SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='guest_roster_change_events')
     IS DISTINCT FROM ARRAY['id','event_id','roster_key','fact_kind','occurred_at']::text[] THEN
    RAISE EXCEPTION 'T-873-00 FAIL: realtime invalidation gained a PII/provider column';
  END IF;
END;
$catalog$;

INSERT INTO auth.users(id) VALUES
  ('87300000-0000-4000-8000-000000000001'),
  ('87300000-0000-4000-8000-000000000002');
INSERT INTO public.creator_accounts(id)
VALUES('87300000-0000-4000-8000-000000000001');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
VALUES('87300000-0000-4000-8000-000000000010','87300000-0000-4000-8000-000000000001',
  'Issue 873 Brand','issue-873-brand','USD',now(),now());
INSERT INTO public.events(id,brand_id,created_by,event_type,title,slug,status,visibility,currency,
  timezone,party_types,rsvp_approval_mode,rsvp_discoverable,theme,created_at,updated_at)
VALUES('87300000-0000-4000-8000-000000000020','87300000-0000-4000-8000-000000000010',
  '87300000-0000-4000-8000-000000000001','rsvp','Issue 873 Event','issue-873-event',
  'scheduled','public','USD','UTC','{}','auto',false,'{}',now(),now());
INSERT INTO public.brand_people(id,brand_id,display_name)
VALUES('87300000-0000-4000-8000-000000000030','87300000-0000-4000-8000-000000000010','Casey Guest');
INSERT INTO public.brand_person_contact_methods(id,brand_id,brand_person_id,channel,normalized_value,
  provenance_scope,is_exportable,suppression_eligible,is_primary)
VALUES('87300000-0000-4000-8000-000000000031','87300000-0000-4000-8000-000000000010',
  '87300000-0000-4000-8000-000000000030','email','casey@example.test','brand_owned',true,true,true);
INSERT INTO public.brand_offering_invites(id,brand_id,event_id,brand_person_id,origin)
VALUES('87300000-0000-4000-8000-000000000040','87300000-0000-4000-8000-000000000010',
  '87300000-0000-4000-8000-000000000020','87300000-0000-4000-8000-000000000030','wizard');

INSERT INTO public.marketing_audiences(id,account_id,brand_id,name,query_definition)
VALUES('87300000-0000-4000-8000-000000000050','87300000-0000-4000-8000-000000000001',
  '87300000-0000-4000-8000-000000000010','Issue 873 Audience','{"kind":"offering_send_group"}');
INSERT INTO public.marketing_send_groups(id,event_id,brand_id,purpose,client_request_id,channels,
  selection_snapshot,selected_count,eligible_count,reachable_count,queued_count,eligibility_hash,
  quote_hash,quoted_at,execution_snapshot_hash,created_by)
VALUES('87300000-0000-4000-8000-000000000051','87300000-0000-4000-8000-000000000020',
  '87300000-0000-4000-8000-000000000010','invitation','87300000-0000-4000-8000-000000000051',
  ARRAY['email'],'{}',1,1,1,1,repeat('1',64),repeat('2',64),now(),repeat('3',64),
  '87300000-0000-4000-8000-000000000001');
INSERT INTO public.marketing_campaigns(id,account_id,brand_id,audience_id,name,channel,channel_payload,status)
VALUES('87300000-0000-4000-8000-000000000052','87300000-0000-4000-8000-000000000001',
  '87300000-0000-4000-8000-000000000010','87300000-0000-4000-8000-000000000050',
  'Issue 873 Campaign','email','{"kind":"email"}','sending');
INSERT INTO public.brand_offering_invite_delivery_attempts(id,invite_id,send_group_id,campaign_id,
  contact_method_id,channel,attempt_kind,attempt_ordinal,status,provider_message_id,
  provider_accepted_at,sent_at,queued_at)
VALUES('87300000-0000-4000-8000-000000000053','87300000-0000-4000-8000-000000000040',
  '87300000-0000-4000-8000-000000000051','87300000-0000-4000-8000-000000000052',
  '87300000-0000-4000-8000-000000000031','email','initial',1,'sent','provider-873',now(),now(),now());

INSERT INTO public.guest_roster_brand_rollouts(brand_id,phase)
VALUES('87300000-0000-4000-8000-000000000010','internal_read');
UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='guest_roster_read_enabled';
UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='guest_roster_single_actions_enabled';
UPDATE public.guest_roster_brand_rollouts SET phase='single_actions'
WHERE brand_id='87300000-0000-4000-8000-000000000010';

DO $accepted$
DECLARE v jsonb; v_item jsonb; v_action jsonb; v_preview uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','87300000-0000-4000-8000-000000000001',true);
  v:=public.biz_guest_roster_list('87300000-0000-4000-8000-000000000020','all',NULL,'action_priority',NULL,50);
  v_item:=v->'rows'->0;
  IF v_item->>'primaryStatus'<>'not_responded' OR v_item->>'invitationStatus'<>'invited'
     OR v->'summary'->>'notResponded'<>'1' THEN
    RAISE EXCEPTION 'T-873-01 FAIL: accepted invite truth wrong: %',v;
  END IF;
  IF v_item::text LIKE '%provider-873%' THEN RAISE EXCEPTION 'T-873-01 FAIL: provider ID leaked'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.guest_roster_change_events
    WHERE event_id='87300000-0000-4000-8000-000000000020'
      AND fact_kind IN ('invitation','delivery')) THEN
    RAISE EXCEPTION 'T-873-01 FAIL: invitation/delivery did not emit realtime invalidation';
  END IF;
  v_action:=public.biz_guest_roster_resolve_action(
    '87300000-0000-4000-8000-000000000001','87300000-0000-4000-8000-000000000020',
    'reminder',ARRAY['person:87300000-0000-4000-8000-000000000030'],ARRAY['email']
  );
  IF v_action->'selection'->>'kind'<>'resolved_brand_people_v1'
     OR jsonb_array_length(v_action->'selection'->'brandPersonIds')<>1 THEN
    RAISE EXCEPTION 'T-873-01B FAIL: eligible reminder selection wrong: %',v_action;
  END IF;
  BEGIN
    PERFORM public.biz_guest_roster_list(
      '87300000-0000-4000-8000-000000000020','all',NULL,'action_priority',
      jsonb_build_object('rank',2,'name','casey guest','activityAt',now(),
        'rosterKey','person:87300000-0000-4000-8000-000000000030',
        'queryHash',repeat('0',64),'watermark',(v->'summary'->>'watermark')::bigint),50
    );
    RAISE EXCEPTION 'T-873-01C FAIL: cursor was not bound to its query';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  v_preview:=public.biz_guest_roster_store_preview(
    '87300000-0000-4000-8000-000000000001','87300000-0000-4000-8000-000000000020',
    'reminder',v_action->'selection',ARRAY['email'],1,repeat('4',64),0,NULL
  );
  BEGIN
    UPDATE public.feature_flags SET is_enabled=false WHERE flag_key='guest_roster_single_actions_enabled';
    PERFORM public.biz_guest_roster_get_preview(
      '87300000-0000-4000-8000-000000000001',v_preview,
      '87300000-0000-4000-8000-000000000059'
    );
    RAISE EXCEPTION 'T-873-01D FAIL: execute survived action kill switch';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$accepted$;

DO $export_boundary$
DECLARE v jsonb; v_job_count integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','87300000-0000-4000-8000-000000000001',true);
  SELECT count(*) INTO v_job_count FROM public.brand_people_export_jobs;
  BEGIN
    PERFORM public.biz_export_brand_people(
      'offering_guest_roster','87300000-0000-4000-8000-000000000020','no_response',NULL,
      'action_priority','{}','87300000-0000-4000-8000-000000000054'
    );
    RAISE EXCEPTION 'T-873-01C FAIL: export job persisted before export rollout';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT count(*) FROM public.brand_people_export_jobs)<>v_job_count THEN
    RAISE EXCEPTION 'T-873-01C FAIL: disabled export left a job behind';
  END IF;
  UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='guest_roster_export_enabled';
  UPDATE public.guest_roster_brand_rollouts SET phase='ga'
  WHERE brand_id='87300000-0000-4000-8000-000000000010';
  v:=public.biz_export_brand_people(
    'offering_guest_roster','87300000-0000-4000-8000-000000000020','no_response',NULL,
    'action_priority','{}','87300000-0000-4000-8000-000000000054'
  );
  IF v->>'status' NOT IN ('pending','queued') OR v->>'jobId' IS NULL THEN
    RAISE EXCEPTION 'T-873-01D FAIL: current roster filter did not create audited export job: %',v;
  END IF;
END;
$export_boundary$;

INSERT INTO public.event_rsvps(id,event_id,user_id,guest_name,guest_email,guest_phone,rsvp_status,
  approval_status,plus_count,created_at)
VALUES('87300000-0000-4000-8000-000000000060','87300000-0000-4000-8000-000000000020',NULL,
  'Casey Guest','casey@example.test','+14155550873','going','pending',0,now());
INSERT INTO public.brand_person_source_links(id,brand_id,brand_person_id,source_kind,source_id,
  offering_invite_id,link_method,source_occurred_at)
VALUES('87300000-0000-4000-8000-000000000061','87300000-0000-4000-8000-000000000010',
  '87300000-0000-4000-8000-000000000030','event_rsvp','87300000-0000-4000-8000-000000000060',
  '87300000-0000-4000-8000-000000000040','invite_token',now());

DO $response$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','87300000-0000-4000-8000-000000000001',true);
  v:=public.biz_guest_roster_list('87300000-0000-4000-8000-000000000020','all',NULL,'action_priority',NULL,50);
  IF v->'rows'->0->>'primaryStatus'<>'awaiting_approval' OR v->'summary'->>'notResponded'<>'0'
     OR v->'summary'->>'confirmed'<>'0' THEN
    RAISE EXCEPTION 'T-873-02 FAIL: RSVP did not outrank accepted invite: %',v;
  END IF;
  BEGIN
    PERFORM public.biz_guest_roster_resolve_action(
      '87300000-0000-4000-8000-000000000001','87300000-0000-4000-8000-000000000020',
      'reminder',ARRAY['person:87300000-0000-4000-8000-000000000030'],ARRAY['email']
    );
    RAISE EXCEPTION 'T-873-02B FAIL: responded guest stayed reminder-eligible';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  v:=public.biz_guest_roster_set_rsvp_approval(
    '87300000-0000-4000-8000-000000000020','person:87300000-0000-4000-8000-000000000030',
    'approve','87300000-0000-4000-8000-000000000062'
  );
  IF v->>'primaryStatus'<>'going' THEN
    RAISE EXCEPTION 'T-873-02C FAIL: approval did not recompute Going: %',v;
  END IF;
END;
$response$;

INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,is_unlimited)
VALUES('87300000-0000-4000-8000-000000000070','87300000-0000-4000-8000-000000000020','General',1000,'USD',true);
INSERT INTO public.orders(id,event_id,buyer_user_id,buyer_email,buyer_name,buyer_phone,buyer_phone_e164,total_cents,currency,payment_status)
VALUES('87300000-0000-4000-8000-000000000071','87300000-0000-4000-8000-000000000020',NULL,
  'casey@example.test','Casey Guest','+14155550873','+14155550873',1000,'USD','paid');
INSERT INTO public.tickets(id,order_id,ticket_type_id,event_id,attendee_name,attendee_email,qr_code,status)
VALUES('87300000-0000-4000-8000-000000000072','87300000-0000-4000-8000-000000000071',
  '87300000-0000-4000-8000-000000000070','87300000-0000-4000-8000-000000000020',
  'Casey Guest','casey@example.test','qr-873','valid');
INSERT INTO public.brand_person_source_links(id,brand_id,brand_person_id,source_kind,source_id,
  offering_invite_id,link_method,source_occurred_at)
VALUES('87300000-0000-4000-8000-000000000073','87300000-0000-4000-8000-000000000010',
  '87300000-0000-4000-8000-000000000030','order','87300000-0000-4000-8000-000000000071',
  '87300000-0000-4000-8000-000000000040','invite_token',now());

DO $commerce$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','87300000-0000-4000-8000-000000000001',true);
  v:=public.biz_guest_roster_list('87300000-0000-4000-8000-000000000020','all',NULL,'action_priority',NULL,50);
  IF v->'rows'->0->>'primaryStatus'<>'bought_ticket' OR jsonb_array_length(v->'rows')<>1 THEN
    RAISE EXCEPTION 'T-873-03 FAIL: ticket did not win or person duplicated: %',v;
  END IF;
  UPDATE public.tickets SET status='refunded' WHERE id='87300000-0000-4000-8000-000000000072';
  UPDATE public.orders SET payment_status='refunded' WHERE id='87300000-0000-4000-8000-000000000071';
  v:=public.biz_guest_roster_list('87300000-0000-4000-8000-000000000020','all',NULL,'action_priority',NULL,50);
  IF v->'rows'->0->>'primaryStatus'<>'going' THEN
    RAISE EXCEPTION 'T-873-04 FAIL: current RSVP should remain above terminal commerce: %',v;
  END IF;
  UPDATE public.event_rsvps SET rsvp_status='maybe',approval_status='approved'
  WHERE id='87300000-0000-4000-8000-000000000060';
  v:=public.biz_guest_roster_list('87300000-0000-4000-8000-000000000020','maybe',NULL,'action_priority',NULL,50);
  IF v->'rows'->0->>'primaryStatus'<>'maybe' OR v->'rows'->0->>'rsvpStatus'<>'maybe' THEN
    RAISE EXCEPTION 'T-873-04B FAIL: Maybe RSVP fact/filter disappeared: %',v;
  END IF;
  UPDATE public.event_rsvps SET rsvp_status='waitlisted',approval_status='approved'
  WHERE id='87300000-0000-4000-8000-000000000060';
  v:=public.biz_guest_roster_list('87300000-0000-4000-8000-000000000020','all',NULL,'action_priority',NULL,50);
  IF v->'rows'->0->>'primaryStatus'<>'waitlisted' THEN RAISE EXCEPTION 'T-873-04C FAIL: waitlist missing: %',v; END IF;
  UPDATE public.event_rsvps SET approval_status='denied'
  WHERE id='87300000-0000-4000-8000-000000000060';
  v:=public.biz_guest_roster_list('87300000-0000-4000-8000-000000000020','all',NULL,'action_priority',NULL,50);
  IF v->'rows'->0->>'primaryStatus'<>'denied' THEN RAISE EXCEPTION 'T-873-04D FAIL: denied missing: %',v; END IF;
  UPDATE public.event_rsvps SET rsvp_status='not_going',approval_status='approved'
  WHERE id='87300000-0000-4000-8000-000000000060';
  v:=public.biz_guest_roster_list('87300000-0000-4000-8000-000000000020','all',NULL,'action_priority',NULL,50);
  IF v->'rows'->0->>'primaryStatus'<>'declined' THEN
    RAISE EXCEPTION 'T-873-05 FAIL: decline regressed to invite/commerce: %',v;
  END IF;
  UPDATE public.brand_person_source_links SET detached_at=now()
  WHERE id='87300000-0000-4000-8000-000000000061';
  UPDATE public.orders SET payment_status='cancelled'
  WHERE id='87300000-0000-4000-8000-000000000071';
  UPDATE public.tickets SET status='valid'
  WHERE id='87300000-0000-4000-8000-000000000072';
  v:=public.biz_guest_roster_list('87300000-0000-4000-8000-000000000020','all',NULL,'action_priority',NULL,50);
  IF v->'rows'->0->>'primaryStatus'<>'cancelled' THEN
    RAISE EXCEPTION 'T-873-05A FAIL: authoritative cancelled order missing: %',v;
  END IF;
  UPDATE public.orders SET payment_status='paid'
  WHERE id='87300000-0000-4000-8000-000000000071';
  UPDATE public.tickets SET status='transferred'
  WHERE id='87300000-0000-4000-8000-000000000072';
  v:=public.biz_guest_roster_list('87300000-0000-4000-8000-000000000020','all',NULL,'action_priority',NULL,50);
  IF v->'rows'->0->>'primaryStatus'<>'transferred' THEN
    RAISE EXCEPTION 'T-873-05B FAIL: transfer history missing: %',v;
  END IF;
END;
$commerce$;

INSERT INTO public.brand_offering_invite_delivery_attempts(
  id,invite_id,send_group_id,campaign_id,contact_method_id,channel,attempt_kind,
  attempt_ordinal,retry_of_attempt_id,status,is_retryable,safe_reason_code,failed_at
) VALUES(
  '87300000-0000-4000-8000-000000000080','87300000-0000-4000-8000-000000000040',
  '87300000-0000-4000-8000-000000000051','87300000-0000-4000-8000-000000000052',
  '87300000-0000-4000-8000-000000000031','email','retry',2,
  '87300000-0000-4000-8000-000000000053','failed',true,'provider_transient',now()
),(
  '87300000-0000-4000-8000-000000000081','87300000-0000-4000-8000-000000000040',
  '87300000-0000-4000-8000-000000000051','87300000-0000-4000-8000-000000000052',
  '87300000-0000-4000-8000-000000000031','email','retry',3,
  '87300000-0000-4000-8000-000000000080','queued',false,NULL,now()
);

DO $stale_retry$
BEGIN
  BEGIN
    PERFORM public.biz_execute_offering_delivery_retry(
      '87300000-0000-4000-8000-000000000001','87300000-0000-4000-8000-000000000020',
      ARRAY['87300000-0000-4000-8000-000000000080'::uuid],ARRAY['email'],
      '87300000-0000-4000-8000-000000000082','{}'::jsonb
    );
    RAISE EXCEPTION 'T-873-05B FAIL: stale failed attempt was retried after a newer attempt existed';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
END;
$stale_retry$;

DO $forbidden$
BEGIN
  PERFORM set_config('request.jwt.claim.sub','87300000-0000-4000-8000-000000000002',true);
  BEGIN
    PERFORM public.biz_guest_roster_list('87300000-0000-4000-8000-000000000020','all',NULL,'action_priority',NULL,50);
    RAISE EXCEPTION 'T-873-06 FAIL: cross-brand caller read roster';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$forbidden$;

ROLLBACK;
