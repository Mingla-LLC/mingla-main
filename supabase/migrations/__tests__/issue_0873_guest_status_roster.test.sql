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
END;
$catalog$;

INSERT INTO auth.users(id) VALUES
  ('87300000-0000-4000-8000-000000000001'),
  ('87300000-0000-4000-8000-000000000002');
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

DO $accepted$
DECLARE v jsonb; v_item jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','87300000-0000-4000-8000-000000000001',true);
  v:=public.biz_guest_roster_list('87300000-0000-4000-8000-000000000020','all',NULL,'action_priority',NULL,50);
  v_item:=v->'rows'->0;
  IF v_item->>'primaryStatus'<>'not_responded' OR v_item->>'invitationStatus'<>'invited'
     OR v->'summary'->>'notResponded'<>'1' THEN
    RAISE EXCEPTION 'T-873-01 FAIL: accepted invite truth wrong: %',v;
  END IF;
  IF v_item::text LIKE '%provider-873%' THEN RAISE EXCEPTION 'T-873-01 FAIL: provider ID leaked'; END IF;
END;
$accepted$;

INSERT INTO public.event_rsvps(id,event_id,user_id,guest_name,guest_email,guest_phone,rsvp_status,
  approval_status,plus_count,created_at)
VALUES('87300000-0000-4000-8000-000000000060','87300000-0000-4000-8000-000000000020',NULL,
  'Casey Guest','casey@example.test','+14155550873','going','approved',0,now());
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
  IF v->'rows'->0->>'primaryStatus'<>'going' OR v->'summary'->>'notResponded'<>'0'
     OR v->'summary'->>'confirmed'<>'1' THEN
    RAISE EXCEPTION 'T-873-02 FAIL: RSVP did not outrank accepted invite: %',v;
  END IF;
END;
$response$;

INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,is_unlimited)
VALUES('87300000-0000-4000-8000-000000000070','87300000-0000-4000-8000-000000000020','General',1000,'USD',true);
INSERT INTO public.orders(id,event_id,buyer_user_id,buyer_email,buyer_name,total_cents,currency,payment_status)
VALUES('87300000-0000-4000-8000-000000000071','87300000-0000-4000-8000-000000000020',NULL,
  'casey@example.test','Casey Guest',1000,'USD','paid');
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
  UPDATE public.event_rsvps SET rsvp_status='not_going' WHERE id='87300000-0000-4000-8000-000000000060';
  v:=public.biz_guest_roster_list('87300000-0000-4000-8000-000000000020','all',NULL,'action_priority',NULL,50);
  IF v->'rows'->0->>'primaryStatus'<>'declined' THEN
    RAISE EXCEPTION 'T-873-05 FAIL: decline regressed to invite/commerce: %',v;
  END IF;
END;
$commerce$;

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
