-- [TEST-MOD-APPROVED #1780]
-- Independent adversarial proof that wizard_invite_outbox_enqueued is commit
-- truthful. A log emitted inside the publisher can leak from an aborted
-- transaction; the durable marker below must instead roll back with the job,
-- and only a committed marker may be claimed and acknowledged for emission.
\set ON_ERROR_STOP on
BEGIN;

DO $catalog$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='private'
      AND c.relname='brand_offering_invite_observability_events'
      AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'T-1780-OBS-00 FAIL: durable forced-RLS event owner missing';
  END IF;
  IF has_table_privilege(
    'authenticated','private.brand_offering_invite_observability_events','SELECT'
  ) THEN
    RAISE EXCEPTION 'T-1780-OBS-00 FAIL: authenticated can project observability events';
  END IF;
  IF has_function_privilege(
      'authenticated','public.issue_1780_claim_wizard_invite_observability_v1(integer)','EXECUTE')
     OR has_function_privilege(
      'authenticated','public.issue_1780_complete_wizard_invite_observability_v1(bigint,uuid)','EXECUTE')
     OR NOT has_function_privilege(
      'service_role','public.issue_1780_claim_wizard_invite_observability_v1(integer)','EXECUTE')
     OR NOT has_function_privilege(
      'service_role','public.issue_1780_complete_wizard_invite_observability_v1(bigint,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'T-1780-OBS-00 FAIL: observability worker grants are unsafe';
  END IF;
END;
$catalog$;

INSERT INTO auth.users(id)
VALUES('00000000-1780-4000-8000-000000000901');
INSERT INTO public.creator_accounts(id,email,display_name)
VALUES(
  '00000000-1780-4000-8000-000000000901',
  'observability-rollback-1780@example.test',
  'Issue 1780 Observability Tester'
);
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
VALUES(
  '00000000-1780-4000-8000-000000000902',
  '00000000-1780-4000-8000-000000000901',
  'Issue 1780 Observability Brand',
  'issue-1780-observability-brand',
  'USD',now(),now()
);
INSERT INTO public.events(
  id,brand_id,created_by,event_type,title,slug,status,visibility,currency,
  timezone,party_types,rsvp_approval_mode,rsvp_discoverable,theme,created_at,updated_at
) VALUES(
  '00000000-1780-4000-8000-000000000903',
  '00000000-1780-4000-8000-000000000902',
  '00000000-1780-4000-8000-000000000901',
  'event','Commit truthful enqueue','issue-1780-observability-event',
  'draft','draft','USD','UTC','{}','auto',false,'{}',now(),now()
);
INSERT INTO public.brand_people(id,brand_id,display_name,record_status)
VALUES(
  '00000000-1780-4000-8000-000000000904',
  '00000000-1780-4000-8000-000000000902',
  'Commit Truth Tester','active'
);
INSERT INTO private.brand_offering_invite_plans(
  id,event_id,brand_id,event_type,selection_revision,
  selection_hash,created_by,updated_by
) VALUES(
  '00000000-1780-4000-8000-000000000905',
  '00000000-1780-4000-8000-000000000903',
  '00000000-1780-4000-8000-000000000902',
  'event',1,
  private.issue_1780_selection_hash(
    ARRAY['00000000-1780-4000-8000-000000000904'::uuid]
  ),
  '00000000-1780-4000-8000-000000000901',
  '00000000-1780-4000-8000-000000000901'
);
INSERT INTO private.brand_offering_invite_plan_members(
  plan_id,brand_person_id,added_by
) VALUES(
  '00000000-1780-4000-8000-000000000905',
  '00000000-1780-4000-8000-000000000904',
  '00000000-1780-4000-8000-000000000901'
);

DO $forced_later_rollback$
DECLARE v_error text;
BEGIN
  BEGIN
    PERFORM private.enqueue_wizard_invites_on_publish_v1(
      '00000000-1780-4000-8000-000000000903',1,true
    );
    IF NOT EXISTS(
      SELECT 1 FROM private.brand_offering_invite_observability_events e
      JOIN private.brand_offering_invite_publish_outbox o
        ON o.id=e.outbox_job_id
      WHERE o.event_id='00000000-1780-4000-8000-000000000903'
        AND e.event_name='wizard_invite_outbox_enqueued'
    ) THEN
      RAISE EXCEPTION 'T-1780-OBS-01 FAIL: publisher did not stage durable event';
    END IF;
    RAISE EXCEPTION 'issue_1780_forced_later_rollback';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'issue_1780_forced_later_rollback' THEN RAISE; END IF;
  END;

  IF EXISTS(
      SELECT 1 FROM private.brand_offering_invite_publish_outbox
      WHERE event_id='00000000-1780-4000-8000-000000000903'
    ) OR EXISTS(
      SELECT 1 FROM private.brand_offering_invite_selections
      WHERE event_id='00000000-1780-4000-8000-000000000903'
    ) OR EXISTS(
      SELECT 1 FROM private.brand_offering_invite_observability_events e
      JOIN private.brand_offering_invite_publish_outbox o
        ON o.id=e.outbox_job_id
      WHERE o.event_id='00000000-1780-4000-8000-000000000903'
    ) OR (SELECT state FROM private.brand_offering_invite_plans
      WHERE event_id='00000000-1780-4000-8000-000000000903')<>'draft' THEN
    RAISE EXCEPTION 'T-1780-OBS-02 FAIL: aborted publisher leaked durable state';
  END IF;

  PERFORM private.enqueue_wizard_invites_on_publish_v1(
    '00000000-1780-4000-8000-000000000903',1,true
  );
  IF (SELECT count(*) FROM private.brand_offering_invite_publish_outbox
      WHERE event_id='00000000-1780-4000-8000-000000000903')<>1
     OR (SELECT count(*)
         FROM private.brand_offering_invite_observability_events e
         JOIN private.brand_offering_invite_publish_outbox o
           ON o.id=e.outbox_job_id
         WHERE o.event_id='00000000-1780-4000-8000-000000000903'
           AND e.event_name='wizard_invite_outbox_enqueued')<>1 THEN
    RAISE EXCEPTION 'T-1780-OBS-03 FAIL: committed enqueue/event pair is not exactly once';
  END IF;
END;
$forced_later_rollback$;

SELECT set_config('request.jwt.claim.role','service_role',true);
DO $post_commit_drain$
DECLARE v_claim jsonb; v_event jsonb;
BEGIN
  v_claim:=public.issue_1780_claim_wizard_invite_observability_v1(25);
  IF jsonb_array_length(v_claim)<>1 THEN
    RAISE EXCEPTION 'T-1780-OBS-04 FAIL: committed event was not claimed exactly once: %',v_claim;
  END IF;
  v_event:=v_claim->0;
  IF v_event->>'eventName'<>'wizard_invite_outbox_enqueued'
     OR v_event->>'offeringKind'<>'event'
     OR (v_event->>'selectionRevision')::bigint<>1
     OR (v_event->>'selectedCount')::integer<>1
     OR v_event->>'jobState'<>'pending'
     OR v_event ? 'eventId'
     OR v_event ? 'brandPersonIds'
     OR v_event ? 'email'
     OR v_event ? 'phone' THEN
    RAISE EXCEPTION 'T-1780-OBS-05 FAIL: event payload is wrong or exposes recipient data: %',v_event;
  END IF;
  PERFORM public.issue_1780_complete_wizard_invite_observability_v1(
    (v_event->>'eventOccurrenceId')::bigint,
    (v_event->>'leaseToken')::uuid
  );
  IF public.issue_1780_claim_wizard_invite_observability_v1(25)<>'[]'::jsonb THEN
    RAISE EXCEPTION 'T-1780-OBS-06 FAIL: acknowledged event was re-claimed';
  END IF;
END;
$post_commit_drain$;

ROLLBACK;
