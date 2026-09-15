-- #1780 implementor happy path: private snapshots, exact revisions, 500-person
-- ceiling, old-client no-plan behavior, and publish-time durable intent.
\set ON_ERROR_STOP on
BEGIN;

DO $catalog$
DECLARE v_name text; v_signature text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.feature_flags
      WHERE flag_key='business_wizard_invite_selection_v1' AND NOT is_enabled)
     OR NOT EXISTS(SELECT 1 FROM public.feature_flags
      WHERE flag_key='business_wizard_invite_dispatch_v1' AND NOT is_enabled) THEN
    RAISE EXCEPTION 'T-1780-00 FAIL: rollout flags are not default-off';
  END IF;
  FOREACH v_name IN ARRAY ARRAY[
    'brand_offering_invite_plans',
    'brand_offering_invite_mutation_receipts',
    'brand_offering_invite_selections',
    'brand_offering_invite_publish_outbox'
  ] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='private' AND c.relname=v_name AND c.relrowsecurity AND c.relforcerowsecurity) THEN
      RAISE EXCEPTION 'T-1780-00 FAIL: private/forced-RLS relation % missing',v_name;
    END IF;
    IF has_table_privilege('authenticated',format('private.%I',v_name),'SELECT') THEN
      RAISE EXCEPTION 'T-1780-00 FAIL: authenticated can project private %',v_name;
    END IF;
    IF EXISTS(
      SELECT 1
      FROM pg_constraint con
      JOIN pg_class c ON c.oid=con.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_class foreign_c ON foreign_c.oid=con.confrelid
      JOIN pg_namespace foreign_n ON foreign_n.oid=foreign_c.relnamespace
      WHERE n.nspname='private' AND c.relname=v_name
        AND con.contype='f' AND foreign_n.nspname='auth'
        AND foreign_c.relname='users'
    ) THEN
      RAISE EXCEPTION 'T-1780-00 FAIL: private % blocks auth-user erasure',v_name;
    END IF;
  END LOOP;
  IF EXISTS(
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.prosecdef AND (
      p.proname LIKE 'issue_1780_%'
      OR p.proname IN (
        'biz_get_offering_invite_plan_v1','biz_replace_offering_invite_plan_v1',
        'biz_clear_offering_invite_plan_v1','biz_seal_offering_execution_snapshot',
        'issue_1719_publish_event_with_poster','issue_1719_publish_experience_with_poster',
        'business_publish_rsvp_graph','biz_publish_trip_command'
      )
    ) AND NOT COALESCE(p.proconfig,'{}') @> ARRAY['search_path=pg_catalog']
  ) THEN
    RAISE EXCEPTION 'T-1780-00 FAIL: a #1780 SECURITY DEFINER does not pin pg_catalog search_path';
  END IF;
  FOREACH v_signature IN ARRAY ARRAY[
    'public.issue_1780_claim_wizard_invite_outbox_v1(integer)',
    'public.issue_1780_execute_wizard_invite_outbox_v1(uuid,uuid,uuid,jsonb)',
    'public.issue_1780_fail_wizard_invite_outbox_v1(uuid,uuid,text,boolean)',
    'public.issue_1780_complete_wizard_invite_outbox_v1(uuid,uuid,uuid)',
    'public.issue_1780_complete_wizard_invite_outbox_no_recipients_v1(uuid,uuid,uuid,jsonb)'
  ] LOOP
    IF has_function_privilege('authenticated',v_signature,'EXECUTE')
       OR has_function_privilege('anon',v_signature,'EXECUTE')
       OR NOT has_function_privilege('service_role',v_signature,'EXECUTE') THEN
      RAISE EXCEPTION 'T-1780-00 FAIL: worker function grants are unsafe for %',v_signature;
    END IF;
  END LOOP;
END;
$catalog$;

UPDATE public.feature_flags SET is_enabled=true
WHERE flag_key='business_wizard_invite_selection_v1';

INSERT INTO auth.users(id) VALUES('00000000-1780-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id,email,display_name)
VALUES('00000000-1780-4000-8000-000000000001','owner-1780@example.test','Issue 1780 Owner');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
VALUES('00000000-1780-4000-8000-000000000002','00000000-1780-4000-8000-000000000001',
  'Issue 1780 Brand','issue-1780-brand','USD',now(),now()),
('00000000-1780-4000-8000-000000000003','00000000-1780-4000-8000-000000000001',
  'Foreign Issue 1780 Brand','foreign-issue-1780-brand','USD',now(),now());
INSERT INTO public.events(
  id,brand_id,created_by,event_type,title,slug,status,visibility,currency,
  timezone,party_types,rsvp_approval_mode,rsvp_discoverable,theme,created_at,updated_at
) VALUES
('00000000-1780-4000-8000-000000000010','00000000-1780-4000-8000-000000000002',
 '00000000-1780-4000-8000-000000000001','event','Invite snapshot','issue-1780-event',
 'draft','draft','USD','UTC','{}','auto',false,'{}',now(),now()),
('00000000-1780-4000-8000-000000000011','00000000-1780-4000-8000-000000000002',
 '00000000-1780-4000-8000-000000000001','rsvp','No plan','issue-1780-no-plan',
 'draft','draft','USD','UTC','{}','auto',false,'{}',now(),now()),
('00000000-1780-4000-8000-000000000012','00000000-1780-4000-8000-000000000002',
 '00000000-1780-4000-8000-000000000001','trip','Empty plan','issue-1780-empty',
 'draft','draft','USD','UTC','{}','auto',false,'{}',now(),now());

INSERT INTO public.brand_people(id,brand_id,display_name,record_status) VALUES
('00000000-1780-4000-8000-000000000020','00000000-1780-4000-8000-000000000002','Ada Active','active'),
('00000000-1780-4000-8000-000000000021','00000000-1780-4000-8000-000000000002','Bea Active','active'),
('00000000-1780-4000-8000-000000000022','00000000-1780-4000-8000-000000000002','Cal Removed','active');
INSERT INTO public.brand_people(id,brand_id,display_name,record_status) VALUES
('00000000-1780-4000-8000-000000000023','00000000-1780-4000-8000-000000000003','Foreign Person','active');
INSERT INTO public.marketing_audiences(
  id,account_id,brand_id,name,query_definition,is_system_generated,created_by
) VALUES('00000000-1780-4000-8000-000000000030','00000000-1780-4000-8000-000000000001',
  '00000000-1780-4000-8000-000000000002','Launch friends','{"kind":"manual_group"}',false,
  '00000000-1780-4000-8000-000000000001');
INSERT INTO public.marketing_manual_group_memberships(
  id,brand_id,audience_id,brand_person_id,state,source,created_by,ended_by,ended_at,end_reason
) VALUES
('00000000-1780-4000-8000-000000000040','00000000-1780-4000-8000-000000000002',
 '00000000-1780-4000-8000-000000000030','00000000-1780-4000-8000-000000000020','active','book_picker','00000000-1780-4000-8000-000000000001',NULL,NULL,NULL),
('00000000-1780-4000-8000-000000000041','00000000-1780-4000-8000-000000000002',
 '00000000-1780-4000-8000-000000000030','00000000-1780-4000-8000-000000000021','active','book_picker','00000000-1780-4000-8000-000000000001',NULL,NULL,NULL),
('00000000-1780-4000-8000-000000000042','00000000-1780-4000-8000-000000000002',
 '00000000-1780-4000-8000-000000000030','00000000-1780-4000-8000-000000000022','removed','book_picker','00000000-1780-4000-8000-000000000001','00000000-1780-4000-8000-000000000001',now(),'test_removed');

SELECT set_config('request.jwt.claim.sub','00000000-1780-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;

DO $snapshot$
DECLARE v_first jsonb;
BEGIN
  v_first:=public.biz_replace_offering_invite_plan_v1(
    '00000000-1780-4000-8000-000000000010',
    '{"includeEveryone":true,"manualGroupIds":["00000000-1780-4000-8000-000000000030","00000000-1780-4000-8000-000000000030"],"personIds":["00000000-1780-4000-8000-000000000020","00000000-1780-4000-8000-000000000020"],"excludedPersonIds":["00000000-1780-4000-8000-000000000022"]}',
    0,'00000000-1780-4000-8000-000000000050');
  IF (v_first->>'selectedCount')::integer<>2 OR (v_first->>'selectionRevision')::integer<>1
     OR v_first->'brandPersonIds'<>jsonb_build_array(
       '00000000-1780-4000-8000-000000000020','00000000-1780-4000-8000-000000000021') THEN
    RAISE EXCEPTION 'T-1780-01 FAIL: manual group snapshot was not sorted/deduped: %',v_first;
  END IF;
END;
$snapshot$;

RESET ROLE;
UPDATE public.marketing_manual_group_memberships SET state='removed',ended_at=now(),
  ended_by='00000000-1780-4000-8000-000000000001',end_reason='test'
  WHERE id='00000000-1780-4000-8000-000000000041';
UPDATE public.feature_flags SET is_enabled=false WHERE flag_key='business_wizard_invite_selection_v1';
INSERT INTO public.event_dates(event_id,start_at,end_at,timezone,is_master)
VALUES('00000000-1780-4000-8000-000000000010',now()+interval '2 days',
  now()+interval '2 days 2 hours','UTC',true);
UPDATE public.events SET status='scheduled',visibility='public'
WHERE id='00000000-1780-4000-8000-000000000010';
SET LOCAL ROLE authenticated;

DO $snapshot_replay$
DECLARE v_replay jsonb; v_after jsonb; v_state text;
BEGIN
  v_replay:=public.biz_replace_offering_invite_plan_v1(
    '00000000-1780-4000-8000-000000000010',
    '{"includeEveryone":true,"manualGroupIds":["00000000-1780-4000-8000-000000000030","00000000-1780-4000-8000-000000000030"],"personIds":["00000000-1780-4000-8000-000000000020","00000000-1780-4000-8000-000000000020"],"excludedPersonIds":["00000000-1780-4000-8000-000000000022"]}',
    0,'00000000-1780-4000-8000-000000000050');
  v_after:=public.biz_get_offering_invite_plan_v1('00000000-1780-4000-8000-000000000010');
  IF (v_replay->>'replayed')::boolean IS DISTINCT FROM true
     OR (v_replay->>'selectedCount')::integer<>2 OR (v_after->>'selectedCount')::integer<>2 THEN
    RAISE EXCEPTION 'T-1780-02 FAIL: receipt replay/group edit mutated saved snapshot';
  END IF;
  BEGIN
    PERFORM public.biz_replace_offering_invite_plan_v1(
      '00000000-1780-4000-8000-000000000010',
      '{"includeEveryone":false,"manualGroupIds":[],"personIds":[],"excludedPersonIds":[]}',
      0,'00000000-1780-4000-8000-000000000051');
    RAISE EXCEPTION 'T-1780-03 FAIL: published offering accepted a new mutation';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE;
    IF v_state<>'55000' OR SQLERRM NOT LIKE '%wizard_invite_offering_not_draft%' THEN RAISE; END IF;
  END;
END;
$snapshot_replay$;

RESET ROLE;
UPDATE public.events SET deleted_at=now()
WHERE id='00000000-1780-4000-8000-000000000010';
SET LOCAL ROLE authenticated;
DO $deleted_replay$
DECLARE v_replay jsonb;
BEGIN
  v_replay:=public.biz_replace_offering_invite_plan_v1(
    '00000000-1780-4000-8000-000000000010',
    '{"includeEveryone":true,"manualGroupIds":["00000000-1780-4000-8000-000000000030","00000000-1780-4000-8000-000000000030"],"personIds":["00000000-1780-4000-8000-000000000020","00000000-1780-4000-8000-000000000020"],"excludedPersonIds":["00000000-1780-4000-8000-000000000022"]}',
    0,'00000000-1780-4000-8000-000000000050');
  IF (v_replay->>'replayed')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'T-1780-03A FAIL: deleted offering lost acknowledged receipt replay';
  END IF;
  BEGIN
    PERFORM public.biz_replace_offering_invite_plan_v1(
      '00000000-1780-4000-8000-000000000010',
      '{"includeEveryone":false,"manualGroupIds":[],"personIds":[],"excludedPersonIds":[]}',
      1,'00000000-1780-4000-8000-000000000057');
    RAISE EXCEPTION 'T-1780-03B FAIL: deleted offering accepted a new mutation';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%wizard_invite_offering_not_draft%' THEN RAISE; END IF;
  END;
END;
$deleted_replay$;

RESET ROLE;
UPDATE public.events SET status='draft',visibility='draft',deleted_at=NULL
WHERE id='00000000-1780-4000-8000-000000000010';
SET LOCAL ROLE authenticated;
DO $flag_and_foreign_guards$
DECLARE v_detail text;
BEGIN
  BEGIN
    PERFORM public.biz_replace_offering_invite_plan_v1(
      '00000000-1780-4000-8000-000000000010',
      '{"includeEveryone":false,"manualGroupIds":[],"personIds":[],"excludedPersonIds":[]}',
      1,'00000000-1780-4000-8000-000000000053');
    RAISE EXCEPTION 'T-1780-03C FAIL: flag-off empty replace was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%wizard_invite_feature_disabled%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.biz_clear_offering_invite_plan_v1(
      '00000000-1780-4000-8000-000000000010',1,'00000000-1780-4000-8000-000000000054');
    RAISE EXCEPTION 'T-1780-03D FAIL: flag-off clear was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%wizard_invite_feature_disabled%' THEN RAISE; END IF;
  END;
END;
$flag_and_foreign_guards$;
RESET ROLE;
UPDATE public.feature_flags SET is_enabled=true WHERE flag_key='business_wizard_invite_selection_v1';
SET LOCAL ROLE authenticated;
DO $stale_and_foreign$
DECLARE v_detail text;
BEGIN
  BEGIN
    PERFORM public.biz_replace_offering_invite_plan_v1(
      '00000000-1780-4000-8000-000000000010',
      '{"includeEveryone":false,"manualGroupIds":[],"personIds":[],"excludedPersonIds":["00000000-1780-4000-8000-000000000023"]}',
      1,'00000000-1780-4000-8000-000000000055');
    RAISE EXCEPTION 'T-1780-03E FAIL: foreign exclusion was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%wizard_invite_selection_stale%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.biz_replace_offering_invite_plan_v1(
      '00000000-1780-4000-8000-000000000010',
      '{"includeEveryone":false,"manualGroupIds":[],"personIds":[],"excludedPersonIds":[]}',
      0,'00000000-1780-4000-8000-000000000056');
    RAISE EXCEPTION 'T-1780-03F FAIL: stale revision was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail=PG_EXCEPTION_DETAIL;
    IF SQLERRM NOT LIKE '%wizard_invite_revision_conflict%'
       OR v_detail<>'{"currentRevision": 1}'
       OR v_detail LIKE '%brandPersonIds%' THEN RAISE; END IF;
  END;
END;
$stale_and_foreign$;

RESET ROLE;
INSERT INTO public.brand_people(brand_id,display_name,record_status)
SELECT '00000000-1780-4000-8000-000000000002','Overflow '||n,'active'
FROM generate_series(1,499) n;
SET LOCAL ROLE authenticated;
DO $ceiling$
BEGIN
  BEGIN
    PERFORM public.biz_replace_offering_invite_plan_v1(
      '00000000-1780-4000-8000-000000000010',
      '{"includeEveryone":true,"manualGroupIds":[],"personIds":[],"excludedPersonIds":[]}',
      1,'00000000-1780-4000-8000-000000000052');
    RAISE EXCEPTION 'T-1780-04 FAIL: >500 selection was truncated/accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%wizard_invite_selection_too_large%' THEN RAISE; END IF;
  END;
  IF (public.biz_get_offering_invite_plan_v1('00000000-1780-4000-8000-000000000010')->>'selectedCount')::integer<>2 THEN
    RAISE EXCEPTION 'T-1780-04 FAIL: oversized replace damaged prior plan';
  END IF;
END;
$ceiling$;

RESET ROLE;
DO $publication$
DECLARE v_none jsonb; v_empty jsonb; v_locked jsonb;
BEGIN
  v_none:=private.enqueue_wizard_invites_on_publish_v1(
    '00000000-1780-4000-8000-000000000011',NULL,false);
  IF v_none#>>'{inviteDelivery,status}'<>'not_requested' THEN
    RAISE EXCEPTION 'T-1780-05 FAIL: no-plan old-client behavior changed: %',v_none;
  END IF;
  INSERT INTO private.brand_offering_invite_plans(
    event_id,brand_id,event_type,selection_revision,brand_person_ids,selection_hash,created_by,updated_by
  ) VALUES('00000000-1780-4000-8000-000000000012','00000000-1780-4000-8000-000000000002','trip',1,
    '{}',private.issue_1780_selection_hash('{}'),'00000000-1780-4000-8000-000000000001','00000000-1780-4000-8000-000000000001');
  v_empty:=private.enqueue_wizard_invites_on_publish_v1(
    '00000000-1780-4000-8000-000000000012',NULL,false);
  IF v_empty#>>'{inviteDelivery,status}'<>'empty' THEN
    RAISE EXCEPTION 'T-1780-05 FAIL: empty plan unexpectedly enqueued: %',v_empty;
  END IF;
  BEGIN
    PERFORM private.enqueue_wizard_invites_on_publish_v1(
      '00000000-1780-4000-8000-000000000010',0,true);
    RAISE EXCEPTION 'T-1780-06 FAIL: wrong confirmed revision was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%wizard_invite_publish_confirmation_required%' THEN RAISE; END IF;
  END;
  v_locked:=private.enqueue_wizard_invites_on_publish_v1(
    '00000000-1780-4000-8000-000000000010',1,true);
  IF v_locked#>>'{inviteDelivery,status}'<>'pending'
     OR (SELECT state FROM private.brand_offering_invite_plans
       WHERE event_id='00000000-1780-4000-8000-000000000010')<>'locked'
     OR (SELECT count(*) FROM private.brand_offering_invite_publish_outbox
       WHERE event_id='00000000-1780-4000-8000-000000000010')<>1
     OR EXISTS(SELECT 1 FROM public.marketing_send_groups
       WHERE event_id='00000000-1780-4000-8000-000000000010') THEN
    RAISE EXCEPTION 'T-1780-07 FAIL: publication did not seal exactly one provider-dark intent: %',v_locked;
  END IF;
END;
$publication$;

-- Worker execution is committed before provider handoff. A crash leaves the
-- outbox reclaimable with the same group/snapshot, and the trigger changes
-- provenance only for an invite newly inserted by this wizard execution.
INSERT INTO auth.users(id) VALUES
  ('00000000-1780-4000-8000-000000000101'),
  ('00000000-1780-4000-8000-000000000102');
UPDATE public.brand_people SET linked_user_id=CASE id
  WHEN '00000000-1780-4000-8000-000000000020'::uuid THEN '00000000-1780-4000-8000-000000000101'::uuid
  WHEN '00000000-1780-4000-8000-000000000021'::uuid THEN '00000000-1780-4000-8000-000000000102'::uuid
END WHERE id IN (
  '00000000-1780-4000-8000-000000000020',
  '00000000-1780-4000-8000-000000000021'
);
INSERT INTO public.brand_offering_invites(
  id,brand_id,event_id,brand_person_id,status,origin,created_by
) VALUES(
  '00000000-1780-4000-8000-000000000060',
  '00000000-1780-4000-8000-000000000002',
  '00000000-1780-4000-8000-000000000010',
  '00000000-1780-4000-8000-000000000020','active','attached_blast',
  '00000000-1780-4000-8000-000000000001'
);
UPDATE public.feature_flags SET is_enabled=true
WHERE flag_key='business_wizard_invite_dispatch_v1';
SELECT set_config('request.jwt.claim.role','service_role',true);

DO $execute_before_handoff$
DECLARE v_claim jsonb; v_job jsonb; v_snapshot jsonb; v_result jsonb;
  v_group uuid; v_early_state text;
BEGIN
  v_claim:=public.issue_1780_claim_wizard_invite_outbox_v1(10);
  v_job:=v_claim->0;
  IF jsonb_array_length(v_claim)<>1
     OR v_job->>'eventId'<>'00000000-1780-4000-8000-000000000010' THEN
    RAISE EXCEPTION 'T-1780-08 FAIL: pending publication was not claimed exactly once: %',v_claim;
  END IF;
  v_snapshot:=jsonb_set(
    '{"schemaVersion":1,"eventId":"00000000-1780-4000-8000-000000000010","brandId":"00000000-1780-4000-8000-000000000002","purpose":"invitation","channels":["push"],"selectionHash":"97170759f62743e6dc786d3ce9ffc8a71f2f90f65a0505af630f526cf1f857c3","eligibilityHash":"6c7731e3d86770a8f8f60728578477ad458cebcad3f8da7d20eb4649fecf0a08","quotedAt":"2026-09-15T12:00:00.000000Z","quote":{"quoteHash":"bf28b91b22b63f98b9cb8b4053612c92b55bcf579e4943c26cf2da60409ade8c","smsSegments":0,"estimatedCostMinor":0,"currency":null,"rateIds":[]},"campaigns":{"email":null,"sms":null,"push":{"payloadVersion":1,"payloadHash":"90540edf16ccbfd8d49bc68e551b722677e92627ebf1e8b46269ac3410430f70","title":"Youre invited","body":"Open Mingla for details.","eventId":"00000000-1780-4000-8000-000000000010"}},"candidates":[{"candidateKey":"00000000-1780-4000-8000-000000000020:push:00000000-1780-4000-8000-000000000101","brandPersonId":"00000000-1780-4000-8000-000000000020","inviteId":"00000000-1780-4000-8000-000000000060","predecessorAttemptId":null,"channel":"push","contactMethodId":null,"recipientUserId":"00000000-1780-4000-8000-000000000101","outcome":"queued","safeReasonCode":null,"attemptKind":"initial","smsQuote":null},{"candidateKey":"00000000-1780-4000-8000-000000000021:push:00000000-1780-4000-8000-000000000102","brandPersonId":"00000000-1780-4000-8000-000000000021","inviteId":null,"predecessorAttemptId":null,"channel":"push","contactMethodId":null,"recipientUserId":"00000000-1780-4000-8000-000000000102","outcome":"queued","safeReasonCode":null,"attemptKind":"initial","smsQuote":null}],"executionSnapshotHash":"16c2d5ef08ebb0f49507083d7acc0c2e766dcdb90254a3ff6012f3b450c7a462"}'::jsonb,
    '{quotedAt}',to_jsonb(to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  );
  -- Restore the apostrophe used by the Deno vector without changing its hash.
  v_snapshot:=jsonb_set(v_snapshot,'{campaigns,push,title}',to_jsonb('You''re invited'::text));
  v_result:=public.issue_1780_execute_wizard_invite_outbox_v1(
    (v_job->>'outboxJobId')::uuid,(v_job->>'sealedSelectionId')::uuid,
    (v_job->>'leaseToken')::uuid,v_snapshot);
  v_group:=(v_result->>'groupId')::uuid;
  IF (SELECT state FROM private.brand_offering_invite_publish_outbox
        WHERE id=(v_job->>'outboxJobId')::uuid)<>'leased'
     OR (SELECT send_group_id FROM private.brand_offering_invite_publish_outbox
        WHERE id=(v_job->>'outboxJobId')::uuid) IS DISTINCT FROM v_group
     OR (SELECT count(*) FROM public.marketing_send_groups
        WHERE event_id='00000000-1780-4000-8000-000000000010')<>1 THEN
    RAISE EXCEPTION 'T-1780-08 FAIL: DB execute marked success before provider handoff or duplicated the group';
  END IF;
  IF (SELECT origin FROM public.brand_offering_invites
        WHERE id='00000000-1780-4000-8000-000000000060')<>'attached_blast'
     OR (SELECT origin FROM public.brand_offering_invites
        WHERE event_id='00000000-1780-4000-8000-000000000010'
          AND brand_person_id='00000000-1780-4000-8000-000000000021')<>'wizard' THEN
    RAISE EXCEPTION 'T-1780-09 FAIL: wizard execution overwrote prior provenance or missed new provenance';
  END IF;
  BEGIN
    PERFORM public.issue_1780_complete_wizard_invite_outbox_v1(
      (v_job->>'outboxJobId')::uuid,(v_job->>'sealedSelectionId')::uuid,
      (v_job->>'leaseToken')::uuid);
    RAISE EXCEPTION 'T-1780-10 FAIL: queued group completed before provider handoff';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_early_state=RETURNED_SQLSTATE;
    IF v_early_state<>'40001' THEN RAISE; END IF;
  END;
END;
$execute_before_handoff$;

RESET ROLE;
UPDATE private.brand_offering_invite_publish_outbox SET leased_until=now()-interval '1 second'
WHERE event_id='00000000-1780-4000-8000-000000000010';
DO $resume_after_crash$
DECLARE v_claim jsonb; v_job jsonb; v_group uuid;
BEGIN
  v_claim:=public.issue_1780_claim_wizard_invite_outbox_v1(10);
  v_job:=v_claim->0;
  v_group:=(v_job->>'sendGroupId')::uuid;
  IF jsonb_array_length(v_claim)<>1 OR v_job->'executionSnapshot' IS NULL
     OR v_group IS NULL OR (v_job->>'attemptCount')::integer<>2
     OR (SELECT count(*) FROM public.marketing_send_groups
       WHERE event_id='00000000-1780-4000-8000-000000000010')<>1 THEN
    RAISE EXCEPTION 'T-1780-10 FAIL: expired lease did not resume stored execution truth: %',v_claim;
  END IF;
  UPDATE public.marketing_send_groups SET status='running',started_at=now() WHERE id=v_group;
  PERFORM public.issue_1780_complete_wizard_invite_outbox_v1(
    (v_job->>'outboxJobId')::uuid,(v_job->>'sealedSelectionId')::uuid,
    (v_job->>'leaseToken')::uuid);
  IF (SELECT state FROM private.brand_offering_invite_publish_outbox
      WHERE id=(v_job->>'outboxJobId')::uuid)<>'succeeded' THEN
    RAISE EXCEPTION 'T-1780-10 FAIL: provider-handoff completion did not terminalize success';
  END IF;
END;
$resume_after_crash$;

-- A nonempty plan with literally zero current candidates seals an empty
-- authoritative snapshot and succeeds without creating delivery rows.
RESET ROLE;
INSERT INTO private.brand_offering_invite_plans(
  event_id,brand_id,event_type,selection_revision,brand_person_ids,selection_hash,created_by,updated_by
) VALUES(
  '00000000-1780-4000-8000-000000000011','00000000-1780-4000-8000-000000000002','rsvp',1,
  ARRAY['00000000-1780-4000-8000-000000000022'::uuid],
  private.issue_1780_selection_hash(ARRAY['00000000-1780-4000-8000-000000000022'::uuid]),
  '00000000-1780-4000-8000-000000000001','00000000-1780-4000-8000-000000000001'
);
SELECT private.enqueue_wizard_invites_on_publish_v1(
  '00000000-1780-4000-8000-000000000011',1,true);
DO $zero_candidates$
DECLARE v_claim jsonb; v_job jsonb; v_snapshot jsonb; v_state text;
BEGIN
  v_claim:=public.issue_1780_claim_wizard_invite_outbox_v1(10);
  v_job:=v_claim->0;
  v_snapshot:=jsonb_set(
    '{"schemaVersion":1,"eventId":"00000000-1780-4000-8000-000000000011","brandId":"00000000-1780-4000-8000-000000000002","purpose":"invitation","channels":["push"],"selectionHash":"687bd891397894ea7a6f9c484a249c6732665082f0c3ca84728db126bf811c60","eligibilityHash":"0798148ddc43779df7ef78b71b7ae81c3274f337a8c48431ed22c70d4c3db57e","quotedAt":"2026-09-15T12:00:00.000000Z","quote":{"quoteHash":"07e4e42e32c67a391db369813b7ffa8ffa0f46d9a8ab0d851ebaf6f431089fb1","smsSegments":0,"estimatedCostMinor":0,"currency":null,"rateIds":[]},"campaigns":{"email":null,"sms":null,"push":{"payloadVersion":1,"payloadHash":"179be262dea49e4e34ca9d6af5fb76dab4c511b960278ed4e49b196acb56bb5a","title":"Youre invited","body":"Open Mingla for details.","eventId":"00000000-1780-4000-8000-000000000011"}},"candidates":[],"executionSnapshotHash":"ab1e5b988a937f1baad52c0e34a4b6310cefb0f8e7ebd44e1c47788803bdd9c1"}'::jsonb,
    '{quotedAt}',to_jsonb(to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  );
  v_snapshot:=jsonb_set(v_snapshot,'{campaigns,push,title}',to_jsonb('You''re invited'::text));
  BEGIN
    PERFORM public.issue_1780_complete_wizard_invite_outbox_no_recipients_v1(
      (v_job->>'outboxJobId')::uuid,(v_job->>'sealedSelectionId')::uuid,
      (v_job->>'leaseToken')::uuid,jsonb_set(v_snapshot,'{selectionHash}',to_jsonb(repeat('f',64))));
    RAISE EXCEPTION 'T-1780-11 FAIL: mismatched empty snapshot was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE;
    IF v_state<>'22023' THEN RAISE; END IF;
  END;
  PERFORM public.issue_1780_complete_wizard_invite_outbox_no_recipients_v1(
    (v_job->>'outboxJobId')::uuid,(v_job->>'sealedSelectionId')::uuid,
    (v_job->>'leaseToken')::uuid,v_snapshot);
  IF (SELECT state FROM private.brand_offering_invite_publish_outbox
      WHERE id=(v_job->>'outboxJobId')::uuid)<>'succeeded'
     OR EXISTS(SELECT 1 FROM public.brand_offering_invites
        WHERE event_id='00000000-1780-4000-8000-000000000011')
     OR EXISTS(SELECT 1 FROM public.marketing_send_groups
        WHERE event_id='00000000-1780-4000-8000-000000000011') THEN
    RAISE EXCEPTION 'T-1780-11 FAIL: zero-candidate completion created delivery work or failed';
  END IF;
END;
$zero_candidates$;

ROLLBACK;
