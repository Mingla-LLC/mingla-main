-- #1977 canonical RSVP graph, minimized reads, exact guest effects, and replay.
-- Run after the full migration chain on fresh PostgreSQL 17.
\set ON_ERROR_STOP on
BEGIN;

DO $catalog$
BEGIN
  IF to_regclass('public.rsvp_domain_operation_receipts') IS NULL THEN
    RAISE EXCEPTION 'T-1977-00 FAIL: RSVP domain receipt table missing';
  END IF;
  IF has_table_privilege('authenticated','public.rsvp_domain_operation_receipts','SELECT')
     OR has_function_privilege('anon','public.business_list_rsvp_roster(uuid,text,jsonb,integer)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.business_set_rsvp_guest_status(uuid,text,text,text[],bigint,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.business_list_rsvp_contributions(uuid,text,jsonb,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'T-1977-00 FAIL: RSVP sidecar/function privilege drift';
  END IF;
END;
$catalog$;

INSERT INTO auth.users(id,email) VALUES
  ('19770000-0000-4000-8000-000000000001','owner-1977@example.test');
INSERT INTO public.creator_accounts(id)
VALUES('19770000-0000-4000-8000-000000000001');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
VALUES('19770000-0000-4000-8000-000000000010','19770000-0000-4000-8000-000000000001',
  'Issue 1977 Brand','issue-1977-brand','NGN',now(),now());

DO $draft_publish$
DECLARE v_create jsonb; v_replay jsonb; v_publish jsonb; v_event uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','19770000-0000-4000-8000-000000000001',true);
  v_create:=public.business_create_rsvp_draft_graph(
    '19770000-0000-4000-8000-000000000010',
    jsonb_build_object(
      'title','Jollof and Jazz','timezone','Africa/Lagos','format','in_person',
      'location_text','Lagos','partyTypes',jsonb_build_array('themed-party'),
      'vibeTags',jsonb_build_array('vibrant'),'musicGenres',jsonb_build_array('afrobeats'),
      'when',jsonb_build_object('date','2030-08-31','doorsOpen','19:00','endsAt','23:00','timezone','Africa/Lagos'),
      'requestedVisibility','private','tickets','[]'::jsonb,'isRsvp',true,
      'rsvpCapacity',10,'rsvpApprovalMode','manual','rsvpContributionEnabled',false
    ),'19770000-0000-4000-8000-000000000020');
  v_event:=(v_create->'event'->>'id')::uuid;
  IF v_create->>'replayed'<>'false'
     OR (v_create->'event'->>'event_type')<>'rsvp'
     OR (v_create->'event'->>'status')<>'draft'
     OR (v_create->'event'->>'visibility')<>'draft'
     OR EXISTS(SELECT 1 FROM public.event_dates WHERE event_id=v_event)
     OR EXISTS(SELECT 1 FROM public.ticket_types WHERE event_id=v_event AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'T-1977-01 FAIL: canonical draft graph invariant failed: %',v_create;
  END IF;
  v_replay:=public.business_create_rsvp_draft_graph(
    '19770000-0000-4000-8000-000000000010',
    jsonb_build_object(
      'title','Jollof and Jazz','timezone','Africa/Lagos','format','in_person',
      'location_text','Lagos','partyTypes',jsonb_build_array('themed-party'),
      'vibeTags',jsonb_build_array('vibrant'),'musicGenres',jsonb_build_array('afrobeats'),
      'when',jsonb_build_object('date','2030-08-31','doorsOpen','19:00','endsAt','23:00','timezone','Africa/Lagos'),
      'requestedVisibility','private','tickets','[]'::jsonb,'isRsvp',true,
      'rsvpCapacity',10,'rsvpApprovalMode','manual','rsvpContributionEnabled',false
    ),'19770000-0000-4000-8000-000000000020');
  IF v_replay->>'replayed'<>'true' OR (v_replay->'event'->>'id')::uuid<>v_event
     OR (SELECT count(*) FROM public.events WHERE brand_id='19770000-0000-4000-8000-000000000010')<>1 THEN
    RAISE EXCEPTION 'T-1977-02 FAIL: create replay duplicated the graph: %',v_replay;
  END IF;
  v_publish:=public.business_publish_rsvp_graph(v_event,'19770000-0000-4000-8000-000000000021');
  IF v_publish->'event'->>'status'<>'scheduled' OR jsonb_array_length(v_publish->'eventDates')<>1
     OR EXISTS(SELECT 1 FROM public.ticket_types WHERE event_id=v_event AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'T-1977-03 FAIL: publish graph was not canonical: %',v_publish;
  END IF;
  v_replay:=public.business_publish_rsvp_graph(v_event,'19770000-0000-4000-8000-000000000021');
  IF v_replay->>'replayed'<>'true' THEN
    RAISE EXCEPTION 'T-1977-04 FAIL: post-publish replay did not return receipt: %',v_replay;
  END IF;
  PERFORM set_config('issue1977.event_id',v_event::text,true);
END;
$draft_publish$;

INSERT INTO public.event_rsvps(id,event_id,guest_name,guest_email,guest_phone,rsvp_status,approval_status,plus_count,qr_code)
VALUES('19770000-0000-4000-8000-000000000030',current_setting('issue1977.event_id')::uuid,
  'Ada Guest','ada.secret@example.test','+2348000000000','going','pending',1,'mingla-rsvp:1977-pass');

DO $roster_status$
DECLARE v_event uuid:=current_setting('issue1977.event_id')::uuid; v_list jsonb; v_apply jsonb; v_replay jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','19770000-0000-4000-8000-000000000001',true);
  v_list:=public.business_list_rsvp_roster(v_event,NULL,NULL,50);
  IF v_list::text LIKE '%ada.secret@example.test%' OR v_list::text LIKE '%+2348000000000%'
     OR v_list->'rows'->0->>'rosterKey'<>'rsvp:19770000-0000-4000-8000-000000000030' THEN
    RAISE EXCEPTION 'T-1977-05 FAIL: roster projection leaked PII or lost opaque key: %',v_list;
  END IF;
  v_apply:=public.business_set_rsvp_guest_status(v_event,'approve','selected',
    ARRAY['rsvp:19770000-0000-4000-8000-000000000030'],NULL,
    '19770000-0000-4000-8000-000000000031');
  IF v_apply->>'appliedCount'<>'1' OR NOT EXISTS(
    SELECT 1 FROM public.event_rsvps WHERE id='19770000-0000-4000-8000-000000000030'
      AND approval_status='approved' AND rsvp_status='going')
     OR NOT EXISTS(SELECT 1 FROM public.rsvp_notifications
       WHERE rsvp_id='19770000-0000-4000-8000-000000000030' AND template_key='rsvp_pass') THEN
    RAISE EXCEPTION 'T-1977-06 FAIL: approval/pass effect was incomplete: %',v_apply;
  END IF;
  v_replay:=public.business_set_rsvp_guest_status(v_event,'approve','selected',
    ARRAY['rsvp:19770000-0000-4000-8000-000000000030'],NULL,
    '19770000-0000-4000-8000-000000000031');
  IF v_replay->>'replayed'<>'true' OR v_replay->>'appliedCount'<>'1' THEN
    RAISE EXCEPTION 'T-1977-07 FAIL: guest-status replay changed the result: %',v_replay;
  END IF;
END;
$roster_status$;

INSERT INTO public.event_rsvp_contributions(
  id,event_id,rsvp_id,brand_id,guest_name,guest_email,provider,currency,
  amount_cents,buyer_total_cents,application_fee_amount_cents,pricing_breakdown,status,
  stripe_payment_intent_id,stripe_charge_id
) VALUES(
  '19770000-0000-4000-8000-000000000040',current_setting('issue1977.event_id')::uuid,
  '19770000-0000-4000-8000-000000000030','19770000-0000-4000-8000-000000000010',
  'Ada Guest','ada.money@example.test','paystack','NGN',500000,500000,25000,'{}','paid',
  'paystack-ref-secret-1977','paystack-transaction-secret-1977'
);

DO $contribution_projection$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','19770000-0000-4000-8000-000000000001',true);
  v:=public.business_list_rsvp_contributions(current_setting('issue1977.event_id')::uuid,NULL,NULL,50);
  IF v::text LIKE '%ada.money@example.test%' OR v::text LIKE '%paystack-ref-secret-1977%'
     OR v->'rows'->0->>'contributionId'<>'19770000-0000-4000-8000-000000000040'
     OR v->'rows'->0->'refundable'->>'discretionaryCents'<>'475000' THEN
    RAISE EXCEPTION 'T-1977-08 FAIL: contribution projection leaked or miscomputed: %',v;
  END IF;
END;
$contribution_projection$;

ROLLBACK;
