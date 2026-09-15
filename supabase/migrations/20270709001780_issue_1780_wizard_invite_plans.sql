-- Issue #1780: durable, private invite plans for Business creation wizards.
-- Selection is snapshotted while drafting; publication atomically locks the
-- snapshot and enqueues intent. Provider I/O remains post-commit in the #1770
-- offering-invite dispatcher.

BEGIN;

INSERT INTO public.feature_flags(flag_key,is_enabled,description)
VALUES
  ('business_wizard_invite_selection_v1',false,'Dark launch: invite people while creating an offering'),
  ('business_wizard_invite_dispatch_v1',false,'Dark launch: dispatch published wizard invite plans')
ON CONFLICT(flag_key) DO NOTHING;

CREATE TABLE private.brand_offering_invite_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type IN ('event','rsvp','experience','trip')),
  selection_revision bigint NOT NULL DEFAULT 0 CHECK(selection_revision>=0),
  selection_hash text NOT NULL CHECK(selection_hash~'^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','locked')),
  published_selection_revision bigint NULL CHECK(published_selection_revision>=0),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz NULL,
  CONSTRAINT issue_1780_plan_state_shape CHECK(
    (state='draft' AND published_selection_revision IS NULL AND locked_at IS NULL)
    OR (state='locked' AND published_selection_revision=selection_revision AND locked_at IS NOT NULL)
  ),
  UNIQUE(id,selection_revision)
);

CREATE TABLE private.brand_offering_invite_plan_members (
  plan_id uuid NOT NULL REFERENCES private.brand_offering_invite_plans(id) ON DELETE CASCADE,
  brand_person_id uuid NOT NULL REFERENCES public.brand_people(id) ON DELETE RESTRICT,
  added_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(plan_id,brand_person_id)
);

CREATE TABLE private.brand_offering_invite_mutation_receipts (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  client_request_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'),
  response_json jsonb NOT NULL CHECK(jsonb_typeof(response_json)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(event_id,client_request_id)
);

CREATE TABLE private.brand_offering_invite_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type IN ('event','rsvp','experience','trip')),
  selection_revision bigint NOT NULL CHECK(selection_revision>0),
  brand_person_ids uuid[] NOT NULL CHECK(cardinality(brand_person_ids) BETWEEN 1 AND 500),
  selection_hash text NOT NULL CHECK(selection_hash~'^[0-9a-f]{64}$'),
  actor_id uuid NOT NULL,
  sealed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,selection_revision)
);

CREATE TABLE private.brand_offering_invite_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type IN ('event','rsvp','experience','trip')),
  selection_revision bigint NOT NULL CHECK(selection_revision>0),
  operation_key text NOT NULL UNIQUE,
  sealed_selection_id uuid NOT NULL UNIQUE REFERENCES private.brand_offering_invite_selections(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','retryable','succeeded','terminal')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid NULL,
  lease_expires_at timestamptz NULL,
  last_error_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  UNIQUE(event_id,selection_revision),
  FOREIGN KEY(plan_id,selection_revision)
    REFERENCES private.brand_offering_invite_plans(id,selection_revision) ON DELETE RESTRICT,
  CONSTRAINT issue_1780_outbox_operation_key CHECK(
    operation_key='wizard:v1:'||event_type||':'||event_id::text||':'||selection_revision::text
  ),
  CONSTRAINT issue_1780_outbox_state_shape CHECK(
    (state IN ('pending','retryable') AND lease_token IS NULL AND lease_expires_at IS NULL AND completed_at IS NULL)
    OR (state='leased' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND completed_at IS NULL)
    OR (state IN ('succeeded','terminal') AND lease_token IS NULL AND lease_expires_at IS NULL AND completed_at IS NOT NULL)
  )
);
CREATE INDEX issue_1780_outbox_claim_idx
  ON private.brand_offering_invite_outbox(state,next_attempt_at,created_at)
  WHERE state IN ('pending','retryable','leased');

-- The full #1770 execution seal is private delivery truth, never outbox
-- metadata. A worker may create it only while holding the matching job lease;
-- retries then execute the same sealed bytes or resume the stable #1770 group.
CREATE TABLE private.brand_offering_invite_execution_seals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_job_id uuid NOT NULL UNIQUE REFERENCES private.brand_offering_invite_outbox(id) ON DELETE RESTRICT,
  sealed_selection_id uuid NOT NULL UNIQUE REFERENCES private.brand_offering_invite_selections(id) ON DELETE RESTRICT,
  execution_snapshot jsonb NOT NULL CHECK(jsonb_typeof(execution_snapshot)='object'),
  execution_snapshot_hash text NOT NULL CHECK(execution_snapshot_hash~'^[0-9a-f]{64}$'),
  queued_count integer NOT NULL CHECK(queued_count>=0),
  candidate_count integer NOT NULL CHECK(candidate_count>=0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE private.brand_offering_invite_observability_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_name text NOT NULL CHECK(event_name='wizard_invite_outbox_enqueued'),
  outbox_job_id uuid NOT NULL UNIQUE REFERENCES private.brand_offering_invite_outbox(id) ON DELETE RESTRICT,
  offering_kind text NOT NULL CHECK(offering_kind IN ('event','rsvp','experience','trip')),
  selection_revision bigint NOT NULL CHECK(selection_revision>0),
  selected_count integer NOT NULL CHECK(selected_count BETWEEN 1 AND 500),
  job_state text NOT NULL CHECK(job_state IN ('pending','leased','retryable','succeeded','terminal')),
  lease_token uuid NULL,
  lease_expires_at timestamptz NULL,
  emitted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT issue_1780_observability_lease_shape CHECK(
    (lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND emitted_at IS NULL)
  )
);

-- Aggregate-only operator alert state. The worker leases a signal before it
-- calls the shared ops-alert transport, then acknowledges only a successful
-- notification. No offering, person, destination, or provider identifiers are
-- stored here.
CREATE TABLE private.wizard_invite_alert_state (
  signal_key text PRIMARY KEY CHECK(signal_key IN (
    'expired_lease','retry_backlog_age','terminal_failure_rate',
    'duplicate_constraint','publish_without_job',
    'provider_attempt_dispatch_disabled'
  )),
  active boolean NOT NULL DEFAULT false,
  occurrence_count bigint NOT NULL DEFAULT 0 CHECK(occurrence_count>=0),
  aggregate_details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(aggregate_details)='object'),
  first_detected_at timestamptz NULL,
  last_detected_at timestamptz NULL,
  last_notified_at timestamptz NULL,
  notification_token uuid NULL,
  notification_lease_until timestamptz NULL,
  resolved_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT issue_1780_alert_state_shape CHECK(
    (active AND occurrence_count>0 AND first_detected_at IS NOT NULL AND last_detected_at IS NOT NULL AND resolved_at IS NULL)
    OR (NOT active AND occurrence_count=0 AND notification_token IS NULL AND notification_lease_until IS NULL)
  ),
  CONSTRAINT issue_1780_alert_lease_shape CHECK(
    (notification_token IS NULL AND notification_lease_until IS NULL)
    OR (notification_token IS NOT NULL AND notification_lease_until IS NOT NULL AND active)
  )
);

ALTER TABLE private.brand_offering_invite_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.brand_offering_invite_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE private.brand_offering_invite_plan_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.brand_offering_invite_plan_members FORCE ROW LEVEL SECURITY;
ALTER TABLE private.brand_offering_invite_mutation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.brand_offering_invite_mutation_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE private.brand_offering_invite_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.brand_offering_invite_selections FORCE ROW LEVEL SECURITY;
ALTER TABLE private.brand_offering_invite_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.brand_offering_invite_outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE private.brand_offering_invite_execution_seals ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.brand_offering_invite_execution_seals FORCE ROW LEVEL SECURITY;
ALTER TABLE private.brand_offering_invite_observability_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.brand_offering_invite_observability_events FORCE ROW LEVEL SECURITY;
ALTER TABLE private.wizard_invite_alert_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.wizard_invite_alert_state FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.brand_offering_invite_plans,
  private.brand_offering_invite_plan_members,
  private.brand_offering_invite_mutation_receipts,
  private.brand_offering_invite_selections,
  private.brand_offering_invite_outbox,
  private.brand_offering_invite_execution_seals,
  private.brand_offering_invite_observability_events,
  private.wizard_invite_alert_state FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE private.brand_offering_invite_observability_events_id_seq
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.issue_1780_selection_hash(p_ids uuid[])
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog
AS $fn$
  SELECT encode(extensions.digest(convert_to(
    'mingla:wizard-invite-selection:v1:'||array_to_string(COALESCE(p_ids,'{}'::uuid[]),','),
    'UTF8'),'sha256'),'hex')
$fn$;

CREATE OR REPLACE FUNCTION private.issue_1780_plan_member_same_brand()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE v_plan_brand uuid; v_person_brand uuid; v_plan_state text;
BEGIN
  SELECT p.brand_id,p.state INTO v_plan_brand,v_plan_state
  FROM private.brand_offering_invite_plans p WHERE p.id=NEW.plan_id;
  SELECT bp.brand_id INTO v_person_brand
  FROM public.brand_people bp
  WHERE bp.id=NEW.brand_person_id AND bp.record_status='active';
  IF v_plan_brand IS NULL OR v_person_brand IS NULL
     OR v_plan_brand<>v_person_brand OR v_plan_state<>'draft' THEN
    RAISE EXCEPTION 'wizard_invite_plan_member_brand_mismatch' USING ERRCODE='23514';
  END IF;
  IF (SELECT count(*) FROM private.brand_offering_invite_plan_members m
      WHERE m.plan_id=NEW.plan_id)>500 THEN
    RAISE EXCEPTION 'wizard_invite_selection_too_large' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE CONSTRAINT TRIGGER issue_1780_plan_member_same_brand
AFTER INSERT OR UPDATE OF plan_id,brand_person_id
ON private.brand_offering_invite_plan_members
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION private.issue_1780_plan_member_same_brand();

CREATE OR REPLACE FUNCTION private.issue_1780_event_scope(p_event_id uuid,p_actor_id uuid)
RETURNS TABLE(
  brand_id uuid,event_type text,event_status text,event_visibility text,event_deleted boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
BEGIN
  IF p_actor_id IS NULL THEN RAISE EXCEPTION 'wizard_invite_auth_required' USING ERRCODE='42501'; END IF;
  RETURN QUERY
    SELECT e.brand_id,e.event_type,e.status::text,e.visibility::text,e.deleted_at IS NOT NULL
    FROM public.events e
    WHERE e.id=p_event_id
      AND e.event_type IN ('event','rsvp','experience','trip')
      AND public.biz_brand_effective_rank(e.brand_id,p_actor_id)>=public.biz_role_rank('event_manager');
  IF NOT FOUND THEN RAISE EXCEPTION 'wizard_invite_not_found_or_forbidden' USING ERRCODE='42501'; END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION private.issue_1780_plan_response(p_event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
  SELECT jsonb_build_object(
    'eventId',p.event_id,
    'eventType',p.event_type,
    'selectionRevision',p.selection_revision,
    'selectedCount',count(m.brand_person_id),
    'brandPersonIds',COALESCE(
      jsonb_agg(m.brand_person_id ORDER BY m.brand_person_id)
        FILTER(WHERE m.brand_person_id IS NOT NULL),'[]'::jsonb),
    'selectionHash',p.selection_hash,
    'state',p.state,
    'publishedSelectionRevision',p.published_selection_revision,
    'updatedAt',p.updated_at
  )
  FROM private.brand_offering_invite_plans p
  LEFT JOIN private.brand_offering_invite_plan_members m ON m.plan_id=p.id
  WHERE p.event_id=p_event_id
  GROUP BY p.id,p.event_id,p.event_type,p.selection_revision,p.selection_hash,
    p.state,p.published_selection_revision,p.updated_at
$fn$;

CREATE OR REPLACE FUNCTION public.biz_get_offering_invite_plan_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_scope record; v_result jsonb;
BEGIN
  SELECT * INTO v_scope FROM private.issue_1780_event_scope(p_event_id,v_actor);
  IF v_scope.event_deleted THEN
    RAISE EXCEPTION 'wizard_invite_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object(
    'eventId',p.event_id,'eventType',p.event_type,
    'selectionRevision',p.selection_revision,
    'selectedCount',count(m.brand_person_id),
    'brandPersonIds',COALESCE(
      jsonb_agg(m.brand_person_id ORDER BY m.brand_person_id)
        FILTER(WHERE m.brand_person_id IS NOT NULL),'[]'::jsonb),
    'selectionHash',p.selection_hash,'state',p.state,
    'publishedSelectionRevision',p.published_selection_revision,
    'updatedAt',p.updated_at)
  INTO v_result
  FROM private.brand_offering_invite_plans p
  LEFT JOIN private.brand_offering_invite_plan_members m ON m.plan_id=p.id
  WHERE p.event_id=p_event_id
  GROUP BY p.id,p.event_id,p.event_type,p.selection_revision,p.selection_hash,
    p.state,p.published_selection_revision,p.updated_at;
  RETURN COALESCE(v_result,jsonb_build_object(
    'eventId',p_event_id,'eventType',v_scope.event_type,'selectionRevision',0,
    'selectedCount',0,'brandPersonIds','[]'::jsonb,'selectionHash',private.issue_1780_selection_hash('{}'::uuid[]),
    'state','draft','publishedSelectionRevision',NULL,'updatedAt',NULL));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.biz_replace_offering_invite_plan_v1(
  p_event_id uuid,p_selection jsonb,p_expected_revision bigint,p_client_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE
  v_actor uuid:=auth.uid(); v_scope record; v_plan private.brand_offering_invite_plans%ROWTYPE;
  v_plan_id uuid;
  v_ids uuid[]:='{}'; v_explicit uuid[]:='{}'; v_excluded uuid[]:='{}';
  v_groups uuid[]:='{}'; v_everyone boolean;
  v_request_hash text; v_prior private.brand_offering_invite_mutation_receipts%ROWTYPE; v_result jsonb;
BEGIN
  SELECT * INTO v_scope FROM private.issue_1780_event_scope(p_event_id,v_actor);
  IF p_client_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0
     OR jsonb_typeof(p_selection)<>'object'
     OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_selection) k)
        <>ARRAY['excludedPersonIds','includeEveryone','manualGroupIds','personIds']::text[]
     OR jsonb_typeof(p_selection->'manualGroupIds')<>'array'
     OR jsonb_typeof(p_selection->'personIds')<>'array'
     OR jsonb_typeof(p_selection->'excludedPersonIds')<>'array'
     OR jsonb_typeof(p_selection->'includeEveryone')<>'boolean' THEN
    RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE='22023';
  END IF;
  BEGIN
    SELECT COALESCE(array_agg(DISTINCT x::uuid ORDER BY x::uuid),'{}') INTO v_explicit
      FROM jsonb_array_elements_text(p_selection->'personIds') x;
    SELECT COALESCE(array_agg(DISTINCT x::uuid ORDER BY x::uuid),'{}') INTO v_groups
      FROM jsonb_array_elements_text(p_selection->'manualGroupIds') x;
    SELECT COALESCE(array_agg(DISTINCT x::uuid ORDER BY x::uuid),'{}') INTO v_excluded
      FROM jsonb_array_elements_text(p_selection->'excludedPersonIds') x;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'wizard_invite_selection_invalid' USING ERRCODE='22023';
  END;
  v_everyone:=(p_selection->>'includeEveryone')::boolean;
  v_request_hash:=encode(extensions.digest(convert_to(
    jsonb_build_object('expectedRevision',p_expected_revision,'selection',p_selection)::text,'UTF8'),'sha256'),'hex');
  -- One event lock serializes both receipt replay and first-plan creation;
  -- request-scoped locks would allow two revision-0 inserts to overwrite.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text,1780));
  SELECT * INTO v_prior FROM private.brand_offering_invite_mutation_receipts
    WHERE event_id=p_event_id AND client_request_id=p_client_request_id;
  IF FOUND THEN
    IF v_prior.actor_id<>v_actor OR v_prior.request_hash<>v_request_hash THEN
      RAISE EXCEPTION 'wizard_invite_idempotency_conflict' USING ERRCODE='23505';
    END IF;
    RETURN v_prior.response_json||jsonb_build_object('replayed',true);
  END IF;
  IF v_scope.event_deleted OR v_scope.event_status<>'draft' OR v_scope.event_visibility<>'draft' THEN
    RAISE EXCEPTION 'wizard_invite_offering_not_draft' USING ERRCODE='55000';
  END IF;
  IF NOT COALESCE((SELECT is_enabled FROM public.feature_flags
      WHERE flag_key='business_wizard_invite_selection_v1'),false) THEN
    RAISE EXCEPTION 'wizard_invite_feature_disabled' USING ERRCODE='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(v_groups) gid LEFT JOIN public.marketing_audiences a
      ON a.id=gid AND a.brand_id=v_scope.brand_id AND a.deleted_at IS NULL
      AND NOT a.is_system_generated AND a.query_definition='{"kind":"manual_group"}'::jsonb
      WHERE a.id IS NULL)
     OR EXISTS(SELECT 1 FROM unnest(v_explicit||v_excluded) pid LEFT JOIN public.brand_people bp
      ON bp.id=pid AND bp.brand_id=v_scope.brand_id AND bp.record_status='active' WHERE bp.id IS NULL) THEN
    RAISE EXCEPTION 'wizard_invite_selection_stale' USING ERRCODE='40001';
  END IF;
  SELECT COALESCE(array_agg(id ORDER BY id),'{}') INTO v_ids FROM (
    SELECT bp.id FROM public.brand_people bp
      WHERE v_everyone AND bp.brand_id=v_scope.brand_id AND bp.record_status='active'
    UNION
    SELECT bp.id FROM unnest(v_explicit) requested(id)
      JOIN public.brand_people bp ON bp.id=requested.id AND bp.brand_id=v_scope.brand_id AND bp.record_status='active'
    UNION
    SELECT bp.id FROM public.marketing_manual_group_memberships gm
      JOIN public.brand_people bp ON bp.id=gm.brand_person_id AND bp.brand_id=gm.brand_id AND bp.record_status='active'
      WHERE gm.audience_id=ANY(v_groups) AND gm.brand_id=v_scope.brand_id AND gm.state='active'
  ) selected WHERE NOT (id=ANY(v_excluded));
  IF cardinality(v_ids)>500 THEN RAISE EXCEPTION 'wizard_invite_selection_too_large' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_plan FROM private.brand_offering_invite_plans WHERE event_id=p_event_id FOR UPDATE;
  IF FOUND AND v_plan.state='locked' THEN RAISE EXCEPTION 'wizard_invite_plan_locked' USING ERRCODE='55000'; END IF;
  IF COALESCE(v_plan.selection_revision,0)<>p_expected_revision THEN
    RAISE EXCEPTION 'wizard_invite_revision_conflict' USING ERRCODE='40001',
      DETAIL=jsonb_build_object('currentRevision',COALESCE(v_plan.selection_revision,0))::text;
  END IF;
  INSERT INTO private.brand_offering_invite_plans(
    event_id,brand_id,event_type,selection_revision,selection_hash,created_by,updated_by)
  VALUES(p_event_id,v_scope.brand_id,v_scope.event_type,p_expected_revision+1,
    private.issue_1780_selection_hash(v_ids),v_actor,v_actor)
  ON CONFLICT(event_id) DO UPDATE SET
    selection_revision=EXCLUDED.selection_revision,
    selection_hash=EXCLUDED.selection_hash,updated_by=EXCLUDED.updated_by,updated_at=now()
  RETURNING id INTO v_plan_id;
  DELETE FROM private.brand_offering_invite_plan_members
  WHERE plan_id=v_plan_id;
  INSERT INTO private.brand_offering_invite_plan_members(
    plan_id,brand_person_id,added_by)
  SELECT v_plan_id,id,v_actor FROM unnest(v_ids) selected(id);
  v_result:=private.issue_1780_plan_response(p_event_id)||jsonb_build_object('replayed',false);
  INSERT INTO private.brand_offering_invite_mutation_receipts(event_id,client_request_id,actor_id,request_hash,response_json)
    VALUES(p_event_id,p_client_request_id,v_actor,v_request_hash,v_result);
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.biz_clear_offering_invite_plan_v1(
  p_event_id uuid,p_expected_revision bigint,p_client_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
BEGIN
  RETURN public.biz_replace_offering_invite_plan_v1(
    p_event_id,jsonb_build_object('includeEveryone',false,'manualGroupIds','[]'::jsonb,
      'personIds','[]'::jsonb,'excludedPersonIds','[]'::jsonb),
    p_expected_revision,p_client_request_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION private.enqueue_wizard_invites_on_publish_v1(
  p_event_id uuid,p_expected_revision bigint,p_confirmed boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE v_plan private.brand_offering_invite_plans%ROWTYPE;
  v_selection_id uuid; v_outbox_id uuid; v_outbox_state text;
  v_selected_count integer; v_ids uuid[];
BEGIN
  SELECT * INTO v_plan FROM private.brand_offering_invite_plans
    WHERE event_id=p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('inviteDelivery',jsonb_build_object(
      'planned',false,'selectedCount',0,'status','not_requested'));
  END IF;
  SELECT COALESCE(array_agg(m.brand_person_id ORDER BY m.brand_person_id),'{}'::uuid[])
    INTO v_ids
  FROM private.brand_offering_invite_plan_members m
  WHERE m.plan_id=v_plan.id;
  v_selected_count:=cardinality(v_ids);
  IF v_plan.state='locked' THEN
    SELECT o.id,o.state INTO v_outbox_id,v_outbox_state
    FROM private.brand_offering_invite_selections s
    LEFT JOIN private.brand_offering_invite_outbox o ON o.plan_id=v_plan.id
      AND o.selection_revision=s.selection_revision
    WHERE s.event_id=p_event_id AND s.selection_revision=v_plan.published_selection_revision;
    RETURN jsonb_build_object('inviteDelivery',jsonb_build_object(
      'planned',v_selected_count>0,
      'selectedCount',v_selected_count,
      'selectionRevision',v_plan.published_selection_revision,
      'outboxJobId',v_outbox_id,'status',COALESCE(v_outbox_state,'empty')));
  END IF;
  IF v_selected_count=0 THEN
    UPDATE private.brand_offering_invite_plans SET
      state='locked',published_selection_revision=selection_revision,locked_at=now(),updated_at=now()
    WHERE event_id=p_event_id;
    RETURN jsonb_build_object('inviteDelivery',jsonb_build_object(
      'planned',false,'selectedCount',0,'selectionRevision',v_plan.selection_revision,'status','empty'));
  END IF;
  IF NOT COALESCE(p_confirmed,false) OR p_expected_revision IS NULL
     OR p_expected_revision<>v_plan.selection_revision THEN
    RAISE EXCEPTION 'wizard_invite_publish_confirmation_required' USING ERRCODE='40001';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(v_ids) pid
    LEFT JOIN public.brand_people bp ON bp.id=pid AND bp.brand_id=v_plan.brand_id AND bp.record_status='active'
    WHERE bp.id IS NULL) THEN
    RAISE EXCEPTION 'wizard_invite_selection_stale' USING ERRCODE='40001';
  END IF;
  INSERT INTO private.brand_offering_invite_selections(
    event_id,brand_id,event_type,selection_revision,brand_person_ids,selection_hash,actor_id)
  VALUES(p_event_id,v_plan.brand_id,v_plan.event_type,v_plan.selection_revision,
    v_ids,v_plan.selection_hash,v_plan.updated_by)
  ON CONFLICT(event_id,selection_revision) DO UPDATE SET event_id=EXCLUDED.event_id
  RETURNING id INTO v_selection_id;
  INSERT INTO private.brand_offering_invite_outbox(
    plan_id,brand_id,event_id,event_type,selection_revision,operation_key,sealed_selection_id)
  VALUES(v_plan.id,v_plan.brand_id,p_event_id,v_plan.event_type,v_plan.selection_revision,
    'wizard:v1:'||v_plan.event_type||':'||p_event_id::text||':'||v_plan.selection_revision::text,
    v_selection_id)
  ON CONFLICT(event_id,selection_revision) DO UPDATE
    SET operation_key=EXCLUDED.operation_key
  RETURNING id,state INTO v_outbox_id,v_outbox_state;
  INSERT INTO private.brand_offering_invite_observability_events(
    event_name,outbox_job_id,offering_kind,selection_revision,selected_count,job_state)
  VALUES('wizard_invite_outbox_enqueued',v_outbox_id,v_plan.event_type,
    v_plan.selection_revision,v_selected_count,v_outbox_state)
  ON CONFLICT(outbox_job_id) DO NOTHING;
  UPDATE private.brand_offering_invite_plans SET
    state='locked',published_selection_revision=selection_revision,locked_at=now(),updated_at=now()
  WHERE event_id=p_event_id;
  RETURN jsonb_build_object('inviteDelivery',jsonb_build_object(
    'planned',true,'selectedCount',v_selected_count,
    'selectionRevision',v_plan.selection_revision,'outboxJobId',v_outbox_id,'status',v_outbox_state));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_1780_claim_wizard_invite_outbox_v1(p_limit integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE v_rows jsonb;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE='42501'; END IF;
  IF p_limit NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'wizard_invite_worker_limit_invalid' USING ERRCODE='22023'; END IF;
  -- Dispatch rollback is checked before any row is locked or mutated.
  IF NOT EXISTS(SELECT 1 FROM public.feature_flags f
    WHERE f.flag_key='business_wizard_invite_dispatch_v1' AND f.is_enabled) THEN
    RETURN '[]'::jsonb;
  END IF;
  WITH candidates AS (
    SELECT o.id FROM private.brand_offering_invite_outbox o
    WHERE ((o.state IN ('pending','retryable') AND o.next_attempt_at<=now())
      OR (o.state='leased' AND o.lease_expires_at<=now()))
    ORDER BY o.next_attempt_at,o.created_at,o.id
    FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE private.brand_offering_invite_outbox o SET
      state='leased',attempt_count=o.attempt_count+1,lease_token=gen_random_uuid(),
      lease_expires_at=now()+interval '4 minutes',updated_at=now(),last_error_code=NULL
    FROM candidates c WHERE o.id=c.id
    RETURNING o.*
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'outboxJobId',c.id,'sealedSelectionId',s.id,'eventId',c.event_id,
    'eventType',s.event_type,'actorId',s.actor_id,'brandPersonIds',to_jsonb(s.brand_person_ids),
    'selectionHash',s.selection_hash,'selectionRevision',s.selection_revision,
    'leaseToken',c.lease_token,'attemptCount',c.attempt_count,
    'executionSealed',xs.id IS NOT NULL,
    'sealedQueuedCount',xs.queued_count,
    'committedGroupId',g.id,'committedChannels',to_jsonb(g.channels))
    ORDER BY c.created_at,c.id),'[]'::jsonb) INTO v_rows
  FROM claimed c
  JOIN private.brand_offering_invite_selections s ON s.id=c.sealed_selection_id
  LEFT JOIN private.brand_offering_invite_execution_seals xs ON xs.outbox_job_id=c.id
  LEFT JOIN public.marketing_send_groups g
    ON g.brand_id=c.brand_id AND g.client_request_id=c.id;
  RETURN v_rows;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_1780_seal_wizard_invite_execution_v1(
  p_outbox_job_id uuid,p_sealed_selection_id uuid,p_lease_token uuid,p_execution_snapshot jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE v_job private.brand_offering_invite_outbox%ROWTYPE;
  v_selection private.brand_offering_invite_selections%ROWTYPE;
  v_selection_json jsonb; v_validated jsonb; v_existing private.brand_offering_invite_execution_seals%ROWTYPE;
  v_queued integer; v_candidates integer; v_seal_id uuid;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_job FROM private.brand_offering_invite_outbox
  WHERE id=p_outbox_job_id AND sealed_selection_id=p_sealed_selection_id
    AND state='leased' AND lease_token=p_lease_token AND lease_expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wizard_invite_worker_lease_invalid' USING ERRCODE='40001'; END IF;
  SELECT * INTO v_selection FROM private.brand_offering_invite_selections
  WHERE id=p_sealed_selection_id AND event_id=v_job.event_id
    AND brand_id=v_job.brand_id AND event_type=v_job.event_type
    AND selection_revision=v_job.selection_revision;
  IF NOT FOUND OR p_execution_snapshot IS NULL
     OR p_execution_snapshot->>'eventId'<>v_job.event_id::text
     OR p_execution_snapshot->>'brandId'<>v_job.brand_id::text
     OR p_execution_snapshot->>'purpose'<>'invitation'
     OR p_execution_snapshot->>'selectionHash'<>v_selection.selection_hash
     OR jsonb_typeof(p_execution_snapshot->'candidates')<>'array' THEN
    RAISE EXCEPTION 'wizard_invite_execution_snapshot_invalid' USING ERRCODE='22023';
  END IF;
  v_selection_json:=jsonb_build_object('kind','resolved_brand_people_v1','source','guest_roster_actions',
    'brandPersonIds',to_jsonb(v_selection.brand_person_ids),'selectionHash',v_selection.selection_hash);
  v_candidates:=jsonb_array_length(p_execution_snapshot->'candidates');
  SELECT count(*) INTO v_queued FROM jsonb_array_elements(p_execution_snapshot->'candidates') c
    WHERE c->>'outcome'='queued';
  -- The #1770 validator remains the authority. This transaction-local marker
  -- permits only this leased wizard job to validate a literal zero-candidate seal.
  PERFORM set_config('mingla.issue_1780_zero_candidate_outbox_id',v_job.id::text,true);
  v_validated:=public.biz_seal_offering_execution_snapshot(
    v_selection.actor_id,v_selection_json,p_execution_snapshot);
  SELECT * INTO v_existing FROM private.brand_offering_invite_execution_seals
    WHERE outbox_job_id=v_job.id FOR UPDATE;
  IF FOUND THEN
    IF v_existing.execution_snapshot_hash<>v_validated->>'executionSnapshotHash' THEN
      RAISE EXCEPTION 'wizard_invite_execution_seal_conflict' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('sealId',v_existing.id,'replayed',true,
      'queuedCount',v_existing.queued_count,'candidateCount',v_existing.candidate_count);
  END IF;
  INSERT INTO private.brand_offering_invite_execution_seals(
    outbox_job_id,sealed_selection_id,execution_snapshot,execution_snapshot_hash,
    queued_count,candidate_count)
  VALUES(v_job.id,p_sealed_selection_id,p_execution_snapshot,
    v_validated->>'executionSnapshotHash',v_queued,v_candidates)
  RETURNING id INTO v_seal_id;
  RETURN jsonb_build_object('sealId',v_seal_id,'replayed',false,
    'queuedCount',v_queued,'candidateCount',v_candidates);
END;
$fn$;

CREATE OR REPLACE FUNCTION private.execute_brand_offering_invite_wizard_v1(
  p_outbox_job_id uuid,p_sealed_selection_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE v_job private.brand_offering_invite_outbox%ROWTYPE;
  v_selection private.brand_offering_invite_selections%ROWTYPE;
  v_seal private.brand_offering_invite_execution_seals%ROWTYPE;
  v_selection_json jsonb; v_channels text[]; v_result jsonb;
BEGIN
  SELECT * INTO v_job FROM private.brand_offering_invite_outbox
    WHERE id=p_outbox_job_id AND sealed_selection_id=p_sealed_selection_id FOR UPDATE;
  IF NOT FOUND OR v_job.state<>'leased' OR v_job.lease_expires_at<=now() THEN
    RAISE EXCEPTION 'wizard_invite_worker_lease_invalid' USING ERRCODE='40001';
  END IF;
  SELECT * INTO v_selection FROM private.brand_offering_invite_selections
    WHERE id=p_sealed_selection_id AND event_id=v_job.event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'wizard_invite_seal_invalid' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_seal FROM private.brand_offering_invite_execution_seals
    WHERE outbox_job_id=v_job.id AND sealed_selection_id=v_selection.id;
  IF NOT FOUND OR v_seal.queued_count<=0 THEN
    RAISE EXCEPTION 'wizard_invite_execution_seal_invalid' USING ERRCODE='22023';
  END IF;
  v_selection_json:=jsonb_build_object('kind','resolved_brand_people_v1','source','guest_roster_actions',
    'brandPersonIds',to_jsonb(v_selection.brand_person_ids),'selectionHash',v_selection.selection_hash);
  PERFORM set_config('mingla.issue_1780_outbox_job_id',v_job.id::text,true);
  PERFORM set_config('mingla.issue_1780_outbox_lease_token',v_job.lease_token::text,true);
  SELECT array_agg(value ORDER BY ord) INTO v_channels
    FROM jsonb_array_elements_text(v_seal.execution_snapshot->'channels') WITH ORDINALITY q(value,ord);
  v_result:=public.biz_execute_offering_send_group(
    v_selection.actor_id,v_selection.event_id,'invitation',v_selection_json,v_channels,
    v_job.id,v_seal.execution_snapshot);
  -- Keep the durable job leased after database execution. Provider handoff is
  -- post-commit; only the completion RPC below may mark the job succeeded.
  RETURN v_result||jsonb_build_object('channels',to_jsonb(v_channels));
END;
$fn$;

CREATE OR REPLACE FUNCTION private.issue_1780_stamp_new_wizard_invite_origin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE v_job uuid; v_lease uuid;
BEGIN
  BEGIN
    v_job:=NULLIF(current_setting('mingla.issue_1780_outbox_job_id',true),'')::uuid;
    v_lease:=NULLIF(current_setting('mingla.issue_1780_outbox_lease_token',true),'')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;
  IF EXISTS(
    SELECT 1 FROM private.brand_offering_invite_outbox o
    JOIN private.brand_offering_invite_selections s ON s.id=o.sealed_selection_id
    WHERE o.id=v_job AND o.lease_token=v_lease AND o.state='leased'
      AND o.lease_expires_at>now() AND s.event_id=NEW.event_id
      AND NEW.brand_person_id=ANY(s.brand_person_ids)
  ) THEN
    NEW.origin:='wizard';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER issue_1780_stamp_new_wizard_invite_origin
BEFORE INSERT ON public.brand_offering_invites
FOR EACH ROW EXECUTE FUNCTION private.issue_1780_stamp_new_wizard_invite_origin();

CREATE OR REPLACE FUNCTION public.issue_1780_execute_wizard_invite_outbox_v1(
  p_outbox_job_id uuid,p_sealed_selection_id uuid,p_lease_token uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM private.brand_offering_invite_outbox
    WHERE id=p_outbox_job_id AND sealed_selection_id=p_sealed_selection_id
      AND state='leased' AND lease_token=p_lease_token AND lease_expires_at>now()) THEN
    RAISE EXCEPTION 'wizard_invite_worker_lease_invalid' USING ERRCODE='40001';
  END IF;
  RETURN private.execute_brand_offering_invite_wizard_v1(p_outbox_job_id,p_sealed_selection_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_1780_fail_wizard_invite_outbox_v1(
  p_outbox_job_id uuid,p_lease_token uuid,p_error_code text,p_retryable boolean
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE v_state text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE='42501'; END IF;
  IF p_error_code IS NULL OR p_error_code!~'^[a-z0-9_]{1,80}$' THEN
    RAISE EXCEPTION 'wizard_invite_worker_error_invalid' USING ERRCODE='22023';
  END IF;
  UPDATE private.brand_offering_invite_outbox SET
    state=CASE WHEN p_retryable AND attempt_count<8 THEN 'retryable' ELSE 'terminal' END,
    next_attempt_at=CASE WHEN p_retryable AND attempt_count<8
      THEN now()+make_interval(secs=>LEAST(3600,15*(2^LEAST(attempt_count,8))::integer)) ELSE next_attempt_at END,
    lease_token=NULL,lease_expires_at=NULL,last_error_code=p_error_code,
    completed_at=CASE WHEN p_retryable AND attempt_count<8 THEN NULL ELSE now() END,updated_at=now()
  WHERE id=p_outbox_job_id AND state='leased' AND lease_token=p_lease_token
  RETURNING state INTO v_state;
  IF v_state IS NULL THEN RAISE EXCEPTION 'wizard_invite_worker_lease_invalid' USING ERRCODE='40001'; END IF;
  RETURN v_state;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_1780_complete_wizard_invite_outbox_v1(
  p_outbox_job_id uuid,p_sealed_selection_id uuid,p_lease_token uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE='42501'; END IF;
  UPDATE private.brand_offering_invite_outbox o SET
    state='succeeded',lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL,
    completed_at=now(),updated_at=now()
  WHERE o.id=p_outbox_job_id AND o.sealed_selection_id=p_sealed_selection_id
    AND o.state='leased' AND o.lease_token=p_lease_token AND o.lease_expires_at>now()
    AND EXISTS(SELECT 1 FROM private.brand_offering_invite_execution_seals xs
      WHERE xs.outbox_job_id=o.id AND xs.queued_count>0)
    AND EXISTS(SELECT 1 FROM public.marketing_send_groups g
      WHERE g.brand_id=o.brand_id AND g.client_request_id=o.id
        AND g.status IN ('running','completed'));
  IF NOT FOUND THEN RAISE EXCEPTION 'wizard_invite_worker_lease_invalid' USING ERRCODE='40001'; END IF;
  RETURN true;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_1780_complete_wizard_invite_outbox_no_recipients_v1(
  p_outbox_job_id uuid,p_sealed_selection_id uuid,p_lease_token uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE v_job private.brand_offering_invite_outbox%ROWTYPE;
  v_seal private.brand_offering_invite_execution_seals%ROWTYPE;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_job FROM private.brand_offering_invite_outbox
    WHERE id=p_outbox_job_id AND sealed_selection_id=p_sealed_selection_id
      AND state='leased' AND lease_token=p_lease_token AND lease_expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wizard_invite_worker_lease_invalid' USING ERRCODE='40001'; END IF;
  SELECT * INTO v_seal FROM private.brand_offering_invite_execution_seals
    WHERE outbox_job_id=v_job.id AND sealed_selection_id=p_sealed_selection_id;
  IF NOT FOUND OR v_seal.queued_count<>0 THEN
    RAISE EXCEPTION 'wizard_invite_zero_reachable_snapshot_invalid' USING ERRCODE='22023';
  END IF;
  UPDATE private.brand_offering_invite_outbox SET
    state='succeeded',lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL,
    completed_at=now(),updated_at=now()
  WHERE id=v_job.id AND state='leased' AND lease_token=p_lease_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'wizard_invite_worker_lease_invalid' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('outboxJobId',v_job.id,'status','succeeded','providerIo',false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_1780_claim_wizard_invite_observability_v1(
  p_limit integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE v_result jsonb;
BEGIN
  IF auth.role()<>'service_role' THEN
    RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'wizard_invite_observability_limit_invalid' USING ERRCODE='22023';
  END IF;
  WITH due AS (
    SELECT e.id
    FROM private.brand_offering_invite_observability_events e
    WHERE e.emitted_at IS NULL
      AND (e.lease_expires_at IS NULL OR e.lease_expires_at<=now())
    ORDER BY e.id FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE private.brand_offering_invite_observability_events e SET
      lease_token=gen_random_uuid(),lease_expires_at=now()+interval '10 minutes'
    FROM due d WHERE e.id=d.id
    RETURNING e.id,e.event_name,e.offering_kind,e.selection_revision,
      e.selected_count,e.job_state,e.lease_token
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'eventOccurrenceId',c.id,'eventName',c.event_name,
    'offeringKind',c.offering_kind,'selectionRevision',c.selection_revision,
    'selectedCount',c.selected_count,'jobState',c.job_state,
    'leaseToken',c.lease_token) ORDER BY c.id),'[]'::jsonb)
  INTO v_result FROM claimed c;
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_1780_complete_wizard_invite_observability_v1(
  p_event_occurrence_id bigint,p_lease_token uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
BEGIN
  IF auth.role()<>'service_role' THEN
    RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE='42501';
  END IF;
  UPDATE private.brand_offering_invite_observability_events SET
    emitted_at=now(),lease_token=NULL,lease_expires_at=NULL
  WHERE id=p_event_occurrence_id AND emitted_at IS NULL
    AND lease_token=p_lease_token AND lease_expires_at>now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wizard_invite_observability_lease_invalid' USING ERRCODE='40001';
  END IF;
  RETURN true;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_1780_claim_wizard_invite_health_v1()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE
  v_expired_lease bigint;
  v_retry_backlog_age bigint;
  v_terminal_count bigint;
  v_terminal_window bigint;
  v_terminal_failure_rate bigint;
  v_duplicate_constraint bigint;
  v_publish_without_job bigint;
  v_provider_attempt_dispatch_disabled bigint;
  v_signal record;
  v_result jsonb;
BEGIN
  IF auth.role()<>'service_role' THEN
    RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE='42501';
  END IF;

  SELECT count(*) INTO v_expired_lease
  FROM private.brand_offering_invite_outbox o
  WHERE o.state='leased' AND o.lease_expires_at<now();

  SELECT count(*) INTO v_retry_backlog_age
  FROM private.brand_offering_invite_outbox o
  WHERE o.state='retryable'
    AND o.next_attempt_at<now()-interval '15 minutes';

  SELECT count(*) FILTER(WHERE o.state='terminal'),count(*)
    INTO v_terminal_count,v_terminal_window
  FROM private.brand_offering_invite_outbox o
  WHERE o.created_at>=now()-interval '1 hour';
  v_terminal_failure_rate:=CASE
    WHEN v_terminal_count>=3 AND v_terminal_count*100>=v_terminal_window*20
      THEN v_terminal_count ELSE 0 END;

  SELECT count(*) INTO v_duplicate_constraint
  FROM private.brand_offering_invite_outbox o
  WHERE o.updated_at>=now()-interval '1 hour'
    AND o.last_error_code IN ('23505','unique_violation','duplicate_constraint_violation');

  SELECT count(*) INTO v_publish_without_job
  FROM private.brand_offering_invite_plans p
  WHERE p.state='locked'
    AND EXISTS(SELECT 1 FROM private.brand_offering_invite_plan_members m
      WHERE m.plan_id=p.id)
    AND NOT EXISTS(
      SELECT 1
      FROM private.brand_offering_invite_selections s
      JOIN private.brand_offering_invite_outbox o
        ON o.sealed_selection_id=s.id
      WHERE s.event_id=p.event_id
        AND s.selection_revision=p.published_selection_revision
    );

  SELECT count(*) INTO v_provider_attempt_dispatch_disabled
  FROM public.brand_offering_invite_delivery_attempts a
  JOIN public.brand_offering_invites i ON i.id=a.invite_id
  JOIN public.feature_flags f
    ON f.flag_key='business_wizard_invite_dispatch_v1'
  WHERE NOT f.is_enabled AND i.origin='wizard'
    AND a.created_at>=f.updated_at;

  FOR v_signal IN
    SELECT * FROM (VALUES
      ('expired_lease'::text,v_expired_lease,
        jsonb_build_object('count',v_expired_lease)),
      ('retry_backlog_age'::text,v_retry_backlog_age,
        jsonb_build_object('count',v_retry_backlog_age,'age_threshold_minutes',15)),
      ('terminal_failure_rate'::text,v_terminal_failure_rate,
        jsonb_build_object('terminal_count',v_terminal_count,'window_count',v_terminal_window,'window_minutes',60)),
      ('duplicate_constraint'::text,v_duplicate_constraint,
        jsonb_build_object('count',v_duplicate_constraint,'window_minutes',60)),
      ('publish_without_job'::text,v_publish_without_job,
        jsonb_build_object('count',v_publish_without_job)),
      ('provider_attempt_dispatch_disabled'::text,v_provider_attempt_dispatch_disabled,
        jsonb_build_object('count',v_provider_attempt_dispatch_disabled))
    ) AS signals(signal_key,occurrence_count,aggregate_details)
  LOOP
    INSERT INTO private.wizard_invite_alert_state(
      signal_key,active,occurrence_count,aggregate_details,
      first_detected_at,last_detected_at,resolved_at,updated_at)
    VALUES(
      v_signal.signal_key,v_signal.occurrence_count>0,v_signal.occurrence_count,
      v_signal.aggregate_details,
      CASE WHEN v_signal.occurrence_count>0 THEN now() ELSE NULL END,
      CASE WHEN v_signal.occurrence_count>0 THEN now() ELSE NULL END,
      CASE WHEN v_signal.occurrence_count=0 THEN now() ELSE NULL END,now())
    ON CONFLICT(signal_key) DO UPDATE SET
      active=EXCLUDED.active,
      occurrence_count=EXCLUDED.occurrence_count,
      aggregate_details=EXCLUDED.aggregate_details,
      first_detected_at=CASE
        WHEN EXCLUDED.active AND private.wizard_invite_alert_state.active
          THEN private.wizard_invite_alert_state.first_detected_at
        WHEN EXCLUDED.active THEN now() ELSE NULL END,
      last_detected_at=CASE WHEN EXCLUDED.active THEN now()
        ELSE private.wizard_invite_alert_state.last_detected_at END,
      last_notified_at=CASE
        WHEN EXCLUDED.active AND NOT private.wizard_invite_alert_state.active THEN NULL
        ELSE private.wizard_invite_alert_state.last_notified_at END,
      notification_token=CASE
        WHEN EXCLUDED.active AND private.wizard_invite_alert_state.active
          THEN private.wizard_invite_alert_state.notification_token
        ELSE NULL END,
      notification_lease_until=CASE
        WHEN EXCLUDED.active AND private.wizard_invite_alert_state.active
          THEN private.wizard_invite_alert_state.notification_lease_until
        ELSE NULL END,
      resolved_at=CASE
        WHEN EXCLUDED.active THEN NULL
        WHEN private.wizard_invite_alert_state.active THEN now()
        ELSE private.wizard_invite_alert_state.resolved_at END,
      updated_at=now();
  END LOOP;

  WITH due AS (
    SELECT a.signal_key
    FROM private.wizard_invite_alert_state a
    WHERE a.active
      AND (a.last_notified_at IS NULL OR a.last_notified_at<=now()-interval '6 hours')
      AND (a.notification_lease_until IS NULL OR a.notification_lease_until<=now())
    ORDER BY a.signal_key
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE private.wizard_invite_alert_state a SET
      notification_token=gen_random_uuid(),
      notification_lease_until=now()+interval '10 minutes',updated_at=now()
    FROM due d WHERE a.signal_key=d.signal_key
    RETURNING a.signal_key,a.occurrence_count,a.aggregate_details,
      a.first_detected_at,a.notification_token
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'signalKey',c.signal_key,'occurrenceCount',c.occurrence_count,
    'aggregateDetails',c.aggregate_details,'firstDetectedAt',c.first_detected_at,
    'notificationToken',c.notification_token) ORDER BY c.signal_key),'[]'::jsonb)
  INTO v_result FROM claimed c;
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_1780_complete_wizard_invite_health_alert_v1(
  p_signal_key text,p_notification_token uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
BEGIN
  IF auth.role()<>'service_role' THEN
    RAISE EXCEPTION 'wizard_invite_worker_forbidden' USING ERRCODE='42501';
  END IF;
  UPDATE private.wizard_invite_alert_state SET
    last_notified_at=now(),notification_token=NULL,
    notification_lease_until=NULL,updated_at=now()
  WHERE signal_key=p_signal_key AND active
    AND notification_token=p_notification_token
    AND notification_lease_until>now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wizard_invite_alert_lease_invalid' USING ERRCODE='40001';
  END IF;
  RETURN true;
END;
$fn$;

-- A 500-person plan can legally produce three channel candidates per person.
-- Widen only the internal #1770 sealed-candidate envelope; the public person
-- selection remains hard-capped at 500 above.
CREATE OR REPLACE FUNCTION public.biz_seal_offering_execution_snapshot(
  p_actor_id uuid,p_selection jsonb,p_execution_snapshot jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $function$
DECLARE
  v_event uuid; v_brand uuid; v_purpose text; v_channels text[]; v_selection_hash text;
  v_live jsonb; v_candidate jsonb; v_live_candidate jsonb; v_campaign jsonb; v_sms jsonb;
  v_payload_hash text; v_payload_hashes text[]:='{}'; v_eligibility text; v_quote text; v_execution text;
  v_bytes bytea; v_index integer:=0; v_channel text; v_expected_cost bigint:=0; v_segments bigint:=0;
  v_alloc bigint:=0; v_candidate_count integer; v_previous_key text:=NULL; v_rate_ids text[]:='{}';
  v_replay_semantics boolean:=false; v_allow_wizard_zero boolean:=false;
BEGIN
  IF p_execution_snapshot IS NULL OR octet_length(convert_to(p_execution_snapshot::text,'UTF8')) NOT BETWEEN 1 AND 1048576
    OR public.issue_1770_json_keys(p_execution_snapshot)<>ARRAY['brandId','campaigns','candidates','channels','eligibilityHash','eventId','executionSnapshotHash','purpose','quote','quotedAt','schemaVersion','selectionHash']::text[]
    OR p_execution_snapshot->>'schemaVersion'<>'1' THEN
    RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023';
  END IF;
  BEGIN v_event:=(p_execution_snapshot->>'eventId')::uuid; v_brand:=(p_execution_snapshot->>'brandId')::uuid;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023'; END;
  v_purpose:=p_execution_snapshot->>'purpose';
  SELECT array_agg(x ORDER BY ord) INTO v_channels FROM jsonb_array_elements_text(p_execution_snapshot->'channels') WITH ORDINALITY q(x,ord);
  IF v_purpose NOT IN ('invitation','reminder','retry_delivery') OR NOT public.issue_1770_channels_valid(v_channels)
    OR v_brand<>public.issue_1770_offering_actor_brand(p_actor_id,v_event,false) THEN
    RAISE EXCEPTION 'offering_send_actor_forbidden' USING ERRCODE='42501';
  END IF;
  v_selection_hash:=public.issue_1770_selection_hash(p_selection);
  IF p_execution_snapshot->>'selectionHash'<>v_selection_hash THEN RAISE EXCEPTION 'offering_execution_snapshot_stale' USING ERRCODE='22023'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.marketing_send_groups g WHERE g.event_id=v_event AND g.brand_id=v_brand
    AND g.created_by=p_actor_id AND g.execution_snapshot_hash=p_execution_snapshot->>'executionSnapshotHash') INTO v_replay_semantics;
  IF v_replay_semantics THEN v_live:=jsonb_build_object('candidates',p_execution_snapshot->'candidates');
  ELSE v_live:=public.biz_offering_send_quote_candidates(p_actor_id,v_event,v_purpose,p_selection,v_channels); END IF;
  IF NOT v_replay_semantics AND v_purpose='retry_delivery' AND 'push'=ANY(v_channels)
    AND p_execution_snapshot->'campaigns'->'push' IS DISTINCT FROM v_live->'retryPushPayload' THEN
    RAISE EXCEPTION 'retry_payload_mismatch' USING ERRCODE='22023';
  END IF;
  v_candidate_count:=jsonb_array_length(p_execution_snapshot->'candidates');
  v_allow_wizard_zero:=v_candidate_count=0 AND EXISTS(
    SELECT 1 FROM private.brand_offering_invite_outbox o
    JOIN private.brand_offering_invite_selections s ON s.id=o.sealed_selection_id
    WHERE o.id=NULLIF(current_setting('mingla.issue_1780_zero_candidate_outbox_id',true),'')::uuid
      AND o.state='leased' AND s.event_id=v_event AND s.brand_id=v_brand
      AND s.selection_hash=v_selection_hash AND s.actor_id=p_actor_id
  );
  IF (v_candidate_count=0 AND NOT v_allow_wizard_zero)
    OR v_candidate_count>1500
    OR v_candidate_count<>jsonb_array_length(v_live->'candidates') THEN
    RAISE EXCEPTION 'offering_execution_snapshot_stale' USING ERRCODE='22023';
  END IF;
  IF public.issue_1770_json_keys(p_execution_snapshot->'campaigns')<>ARRAY['email','push','sms']::text[]
    OR public.issue_1770_json_keys(p_execution_snapshot->'quote')<>ARRAY['currency','estimatedCostMinor','quoteHash','rateIds','smsSegments']::text[] THEN
    RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023';
  END IF;
  FOREACH v_channel IN ARRAY ARRAY['email','push','sms']::text[] LOOP
    v_campaign:=p_execution_snapshot->'campaigns'->v_channel;
    IF v_channel=ANY(v_channels) AND (v_campaign IS NULL OR v_campaign='null'::jsonb) THEN RAISE EXCEPTION 'offering_execution_content_invalid' USING ERRCODE='22023'; END IF;
    IF NOT(v_channel=ANY(v_channels)) AND v_campaign<>'null'::jsonb THEN RAISE EXCEPTION 'offering_execution_content_invalid' USING ERRCODE='22023'; END IF;
  END LOOP;
  FOREACH v_channel IN ARRAY v_channels LOOP
    v_campaign:=p_execution_snapshot->'campaigns'->v_channel;
    IF v_channel='email' THEN
      IF public.issue_1770_json_keys(v_campaign)<>ARRAY['bodyHtml','bodyText','embeddedEventIds','payloadHash','payloadVersion','subject','volatileLinkMarker']::text[]
        OR v_campaign->>'payloadVersion'<>'1' OR v_campaign->>'volatileLinkMarker'<>'__MINGLA_OFFERING_INVITE_URL_V1__'
        OR v_campaign->'embeddedEventIds'<>jsonb_build_array(v_event::text)
        OR octet_length(convert_to(v_campaign->>'subject','UTF8'))>200 OR octet_length(convert_to(v_campaign->>'bodyHtml','UTF8'))>50000
        OR octet_length(convert_to(v_campaign->>'bodyText','UTF8'))>10000
        OR (length(v_campaign->>'bodyHtml')-length(replace(v_campaign->>'bodyHtml','__MINGLA_OFFERING_INVITE_URL_V1__','')))/length('__MINGLA_OFFERING_INVITE_URL_V1__')<>1
        OR (length(v_campaign->>'bodyText')-length(replace(v_campaign->>'bodyText','__MINGLA_OFFERING_INVITE_URL_V1__','')))/length('__MINGLA_OFFERING_INVITE_URL_V1__')<>1
        THEN RAISE EXCEPTION 'offering_execution_content_invalid' USING ERRCODE='22023'; END IF;
      v_bytes:=public.issue_1770_frame('mingla:offering-payload:v1')||public.issue_1770_frame(v_channel)||public.issue_1770_frame('1')
        ||public.issue_1770_frame(v_campaign->>'subject')||public.issue_1770_frame(v_campaign->>'bodyHtml')||public.issue_1770_frame(v_campaign->>'bodyText')
        ||public.issue_1770_frame(v_event::text)||public.issue_1770_frame(v_campaign->>'volatileLinkMarker');
    ELSIF v_channel='sms' THEN
      IF public.issue_1770_json_keys(v_campaign)<>ARRAY['body','embeddedEventIds','payloadHash','payloadVersion','volatileLinkMarker']::text[]
        OR v_campaign->>'payloadVersion'<>'1' OR v_campaign->>'volatileLinkMarker'<>'__MINGLA_OFFERING_INVITE_URL_V1__'
        OR v_campaign->'embeddedEventIds'<>jsonb_build_array(v_event::text) OR octet_length(convert_to(v_campaign->>'body','UTF8'))>10000
        OR (length(v_campaign->>'body')-length(replace(v_campaign->>'body','__MINGLA_OFFERING_INVITE_URL_V1__','')))/length('__MINGLA_OFFERING_INVITE_URL_V1__')<>1
        THEN RAISE EXCEPTION 'offering_execution_content_invalid' USING ERRCODE='22023'; END IF;
      v_bytes:=public.issue_1770_frame('mingla:offering-payload:v1')||public.issue_1770_frame(v_channel)||public.issue_1770_frame('1')
        ||public.issue_1770_frame(v_campaign->>'body')||public.issue_1770_frame(v_event::text)||public.issue_1770_frame(v_campaign->>'volatileLinkMarker');
    ELSE
      IF public.issue_1770_json_keys(v_campaign)<>ARRAY['body','eventId','payloadHash','payloadVersion','title']::text[]
        OR v_campaign->>'payloadVersion'<>'1' OR v_campaign->>'eventId'<>v_event::text
        OR octet_length(convert_to(v_campaign->>'title','UTF8'))>200 OR octet_length(convert_to(v_campaign->>'body','UTF8'))>10000
        OR v_campaign::text LIKE '%__MINGLA_OFFERING_INVITE_URL_V1__%' THEN RAISE EXCEPTION 'offering_execution_content_invalid' USING ERRCODE='22023'; END IF;
      v_bytes:=public.issue_1770_frame('mingla:offering-payload:v1')||public.issue_1770_frame(v_channel)||public.issue_1770_frame('1')
        ||public.issue_1770_frame(v_campaign->>'title')||public.issue_1770_frame(v_campaign->>'body')||public.issue_1770_frame(v_event::text);
    END IF;
    IF (v_campaign::text~'(?i)(oi=|javascript:|data:|http://)') OR v_campaign::text~E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]'
      OR regexp_replace(v_campaign::text,'https://(business\\.usemingla\\.com|cdn\\.usemingla\\.com|mingla\\.app|usemingla\\.com|www\\.usemingla\\.com)','', 'gi')~'(?i)https://' THEN
      RAISE EXCEPTION 'offering_execution_content_invalid' USING ERRCODE='22023';
    END IF;
    v_payload_hash:=encode(extensions.digest(v_bytes,'sha256'),'hex');
    IF v_campaign->>'payloadHash'<>v_payload_hash THEN RAISE EXCEPTION 'offering_execution_hash_mismatch' USING ERRCODE='22023'; END IF;
    v_payload_hashes:=array_append(v_payload_hashes,v_payload_hash);
  END LOOP;
  v_bytes:=public.issue_1770_frame('mingla:offering-eligibility:v1')||public.issue_1770_frame(v_event::text)||public.issue_1770_frame(v_brand::text)
    ||public.issue_1770_frame(v_purpose)||public.issue_1770_frame(v_selection_hash);
  FOR v_candidate IN SELECT value FROM jsonb_array_elements(p_execution_snapshot->'candidates') LOOP
    v_index:=v_index+1; v_live_candidate:=v_live->'candidates'->(v_index-1);
    IF public.issue_1770_json_keys(v_candidate)<>ARRAY['attemptKind','brandPersonId','candidateKey','channel','contactMethodId','inviteId','outcome','predecessorAttemptId','recipientUserId','safeReasonCode','smsQuote']::text[]
      OR v_previous_key IS NOT NULL AND v_candidate->>'candidateKey'<=v_previous_key
      OR (v_candidate->>'candidateKey')<>concat(v_candidate->>'brandPersonId',':',v_candidate->>'channel',':',COALESCE(v_candidate->>'contactMethodId',v_candidate->>'recipientUserId'))
      OR (NOT v_replay_semantics AND ((v_candidate->>'brandPersonId')<>(v_live_candidate->>'brandPersonId') OR (v_candidate->>'channel')<>(v_live_candidate->>'channel')
      OR (v_candidate->>'channel'<>'push' AND COALESCE(v_candidate->>'contactMethodId','')<>COALESCE(v_live_candidate->>'contactMethodId',''))
      OR (v_candidate->>'channel'='push' AND COALESCE(v_candidate->>'recipientUserId','')<>COALESCE(v_live_candidate->>'recipientUserId',''))
      OR COALESCE(v_candidate->>'inviteId','')<>COALESCE(v_live_candidate->>'inviteId','') OR COALESCE(v_candidate->>'predecessorAttemptId','')<>COALESCE(v_live_candidate->>'predecessorAttemptId','')
      OR (NOT (
        v_candidate->>'channel'='sms' AND (v_live_candidate->>'allowed')::boolean
        AND v_candidate->>'outcome'='suppressed' AND v_candidate->>'safeReasonCode'='suppressed'
      ) AND (
        (v_candidate->>'outcome')<>(CASE WHEN (v_live_candidate->>'allowed')::boolean THEN 'queued' ELSE 'suppressed' END)
        OR COALESCE(v_candidate->>'safeReasonCode','')<>COALESCE(v_live_candidate->>'safeReasonCode','')
      )))) THEN
      RAISE EXCEPTION 'offering_execution_snapshot_stale' USING ERRCODE='22023';
    END IF;
    v_previous_key:=v_candidate->>'candidateKey';
    v_bytes:=v_bytes||public.issue_1770_frame(v_candidate->>'candidateKey')||public.issue_1770_frame(v_candidate->>'brandPersonId')
      ||public.issue_1770_frame(v_candidate->>'inviteId')||public.issue_1770_frame(v_candidate->>'predecessorAttemptId')||public.issue_1770_frame(v_candidate->>'channel')
      ||public.issue_1770_frame(v_candidate->>'contactMethodId')||public.issue_1770_frame(v_candidate->>'recipientUserId')||public.issue_1770_frame(v_candidate->>'outcome')
      ||public.issue_1770_frame(v_candidate->>'safeReasonCode')||public.issue_1770_frame(v_candidate->>'attemptKind');
  END LOOP;
  v_eligibility:=encode(extensions.digest(v_bytes,'sha256'),'hex');
  IF p_execution_snapshot->>'eligibilityHash'<>v_eligibility THEN RAISE EXCEPTION 'offering_execution_hash_mismatch' USING ERRCODE='22023'; END IF;
  BEGIN v_segments:=(p_execution_snapshot->'quote'->>'smsSegments')::bigint; v_expected_cost:=(p_execution_snapshot->'quote'->>'estimatedCostMinor')::bigint;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023'; END;
  SELECT COALESCE(array_agg(x ORDER BY x),'{}') INTO v_rate_ids FROM jsonb_array_elements_text(p_execution_snapshot->'quote'->'rateIds') x;
  IF v_rate_ids<>ARRAY(SELECT DISTINCT unnest(v_rate_ids) ORDER BY 1) THEN RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023'; END IF;
  v_bytes:=public.issue_1770_frame('mingla:offering-quote:v1')||public.issue_1770_frame(v_event::text)||public.issue_1770_frame(v_purpose);
  FOREACH v_channel IN ARRAY v_channels LOOP v_bytes:=v_bytes||public.issue_1770_frame(v_channel); END LOOP;
  v_bytes:=v_bytes||public.issue_1770_frame(v_eligibility)||public.issue_1770_frame(v_segments::text)||public.issue_1770_frame(v_expected_cost::text)||public.issue_1770_frame(p_execution_snapshot->'quote'->>'currency');
  FOREACH v_payload_hash IN ARRAY v_rate_ids LOOP v_bytes:=v_bytes||public.issue_1770_frame(v_payload_hash); END LOOP;
  FOREACH v_payload_hash IN ARRAY v_payload_hashes LOOP v_bytes:=v_bytes||public.issue_1770_frame(v_payload_hash); END LOOP;
  FOR v_candidate IN
    SELECT value FROM jsonb_array_elements(p_execution_snapshot->'candidates')
    ORDER BY value->>'brandPersonId',value->>'channel',value->>'contactMethodId'
  LOOP
    v_bytes:=v_bytes||public.issue_1770_frame(v_candidate->>'candidateKey')||public.issue_1770_frame(v_candidate->>'outcome'); v_sms:=v_candidate->'smsQuote';
    IF v_sms IS NULL OR v_sms='null'::jsonb THEN v_bytes:=v_bytes||public.issue_1770_frame(NULL);
    ELSE
      IF public.issue_1770_json_keys(v_sms)<>ARRAY['allocatedCostMinor','country','currency','minorDenominator','minorNumerator','provider','rateId','segments']::text[] THEN RAISE EXCEPTION 'offering_execution_snapshot_invalid' USING ERRCODE='22023'; END IF;
      v_bytes:=v_bytes||public.issue_1770_frame(v_sms->>'segments')||public.issue_1770_frame(v_sms->>'rateId')||public.issue_1770_frame(v_sms->>'provider')||public.issue_1770_frame(v_sms->>'country')||public.issue_1770_frame(v_sms->>'currency')||public.issue_1770_frame(v_sms->>'minorNumerator')||public.issue_1770_frame(v_sms->>'minorDenominator')||public.issue_1770_frame(v_sms->>'allocatedCostMinor');
      v_alloc:=v_alloc+(v_sms->>'allocatedCostMinor')::bigint;
    END IF;
  END LOOP;
  IF v_alloc<>v_expected_cost THEN RAISE EXCEPTION 'offering_execution_cost_invalid' USING ERRCODE='22023'; END IF;
  v_quote:=encode(extensions.digest(v_bytes,'sha256'),'hex');
  IF p_execution_snapshot->'quote'->>'quoteHash'<>v_quote THEN RAISE EXCEPTION 'offering_execution_hash_mismatch' USING ERRCODE='22023'; END IF;
  v_bytes:=public.issue_1770_frame('mingla:offering-execution:v1')||public.issue_1770_frame('1')||public.issue_1770_frame(v_event::text)||public.issue_1770_frame(v_brand::text)||public.issue_1770_frame(v_purpose);
  FOREACH v_channel IN ARRAY v_channels LOOP v_bytes:=v_bytes||public.issue_1770_frame(v_channel); END LOOP;
  v_bytes:=v_bytes||public.issue_1770_frame(v_selection_hash)||public.issue_1770_frame(v_eligibility)||public.issue_1770_frame(v_quote);
  FOREACH v_payload_hash IN ARRAY v_payload_hashes LOOP v_bytes:=v_bytes||public.issue_1770_frame(v_payload_hash); END LOOP;
  FOR v_candidate IN SELECT value FROM jsonb_array_elements(p_execution_snapshot->'candidates') LOOP
    v_bytes:=v_bytes||public.issue_1770_frame(v_candidate->>'candidateKey')||public.issue_1770_frame(v_candidate->>'brandPersonId')||public.issue_1770_frame(v_candidate->>'inviteId')||public.issue_1770_frame(v_candidate->>'predecessorAttemptId')||public.issue_1770_frame(v_candidate->>'channel')||public.issue_1770_frame(v_candidate->>'contactMethodId')||public.issue_1770_frame(v_candidate->>'recipientUserId')||public.issue_1770_frame(v_candidate->>'outcome')||public.issue_1770_frame(v_candidate->>'attemptKind');
  END LOOP;
  v_execution:=encode(extensions.digest(v_bytes,'sha256'),'hex');
  IF p_execution_snapshot->>'executionSnapshotHash'<>v_execution THEN RAISE EXCEPTION 'offering_execution_hash_mismatch' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('eligibilityHash',v_eligibility,'quoteHash',v_quote,'executionSnapshotHash',v_execution,'valid',true);
END;

$function$;


-- Event and Experience payloads carry only the plan receipt. Strip it before
-- calling the existing publishers so invite selection can never leak into the
-- public event theme/graph.
CREATE OR REPLACE FUNCTION private.issue_1780_payload_has_forbidden_invite_tail(
  p_value jsonb
) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog
AS $fn$
DECLARE v_key text; v_child jsonb;
  v_forbidden constant text[]:=ARRAY[
    'invitees','invitePeople','invitationChannels','inviteChannels',
    'inviteeIds','personIds','brandPersonIds','groupIds','resolvedPeople',
    'channels','destinations','origin','message','cost','selector'
  ];
BEGIN
  IF p_value IS NULL THEN RETURN false; END IF;
  IF jsonb_typeof(p_value)='object' THEN
    FOR v_key,v_child IN SELECT key,value FROM jsonb_each(p_value) LOOP
      IF v_key=ANY(v_forbidden)
         OR private.issue_1780_payload_has_forbidden_invite_tail(v_child) THEN
        RETURN true;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(p_value)='array' THEN
    FOR v_child IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF private.issue_1780_payload_has_forbidden_invite_tail(v_child) THEN
        RETURN true;
      END IF;
    END LOOP;
  END IF;
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_1719_publish_event_with_poster(
  p_event_id uuid,p_draft_payload jsonb,p_client_revision integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE v_result jsonb;v_url text;v_type text;v_poster text;v_payload jsonb;
  v_invite_revision bigint;v_invite_confirmed boolean;
BEGIN
  IF private.issue_1780_payload_has_forbidden_invite_tail(p_draft_payload) THEN
    RAISE EXCEPTION 'wizard_invite_payload_forbidden' USING ERRCODE='22023';
  END IF;
  v_invite_revision:=NULLIF(p_draft_payload->>'invite_selection_revision','')::bigint;
  v_invite_confirmed:=COALESCE((p_draft_payload->>'invite_selection_confirmed')::boolean,false);
  v_payload:=p_draft_payload-ARRAY['invite_selection_revision','invite_selection_confirmed'];
  PERFORM public.business_assert_event_visibility(v_payload#>'{theme,business_draft,requestedVisibility}');
  v_url:=NULLIF(v_payload->>'cover_media_url','');v_type:=NULLIF(v_payload->>'cover_media_type','');
  v_poster:=COALESCE(NULLIF(v_payload->>'cover_media_poster_url',''),CASE WHEN v_type='image' THEN v_url END);
  PERFORM public.assert_cover_media_triplet(v_url,v_type,v_poster);
  v_result:=public.business_publish_event_draft(p_event_id,v_payload,p_client_revision);
  UPDATE public.events SET cover_media_poster_url=v_poster WHERE id=p_event_id
    AND cover_media_url IS NOT DISTINCT FROM v_url AND cover_media_type IS NOT DISTINCT FROM v_type;
  IF NOT FOUND THEN RAISE EXCEPTION 'cover_media_persist_mismatch';END IF;
  RETURN v_result||private.enqueue_wizard_invites_on_publish_v1(p_event_id,v_invite_revision,v_invite_confirmed);
END;$fn$;

CREATE OR REPLACE FUNCTION public.issue_1719_publish_experience_with_poster(
  p_event_id uuid,p_payload jsonb,p_publish boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE v_result jsonb;v_cover jsonb;v_url text;v_type text;v_poster text;v_has_cover boolean;
  v_payload jsonb;v_invite_revision bigint;v_invite_confirmed boolean;
BEGIN
  IF private.issue_1780_payload_has_forbidden_invite_tail(p_payload) THEN
    RAISE EXCEPTION 'wizard_invite_payload_forbidden' USING ERRCODE='22023';
  END IF;
  v_invite_revision:=NULLIF(p_payload->>'invite_selection_revision','')::bigint;
  v_invite_confirmed:=COALESCE((p_payload->>'invite_selection_confirmed')::boolean,false);
  v_payload:=p_payload-ARRAY['invite_selection_revision','invite_selection_confirmed'];
  v_has_cover:=v_payload ? 'cover';
  IF NOT v_has_cover THEN
    v_result:=public.biz_publish_experience(p_event_id,v_payload,p_publish);
  ELSE
    v_cover:=COALESCE(v_payload->'cover','{}'::jsonb);
    v_url:=NULLIF(v_cover->>'coverMediaUrl','');v_type:=NULLIF(v_cover->>'coverMediaType','');
    v_poster:=COALESCE(NULLIF(v_cover->>'coverMediaPosterUrl',''),CASE WHEN v_type='image' THEN v_url END);
    PERFORM public.assert_cover_media_triplet(v_url,v_type,v_poster);
    v_result:=public.biz_publish_experience(p_event_id,v_payload,p_publish);
    UPDATE public.events SET cover_media_poster_url=v_poster WHERE id=p_event_id
      AND cover_media_url IS NOT DISTINCT FROM v_url AND cover_media_type IS NOT DISTINCT FROM v_type;
    IF NOT FOUND THEN RAISE EXCEPTION 'cover_media_persist_mismatch';END IF;
  END IF;
  IF p_publish THEN
    v_result:=v_result||private.enqueue_wizard_invites_on_publish_v1(p_event_id,v_invite_revision,v_invite_confirmed);
  END IF;
  RETURN v_result;
END;$fn$;

CREATE OR REPLACE FUNCTION public.business_publish_rsvp_graph(
  p_event_id uuid,p_client_request_id uuid,p_invite_selection_revision bigint,p_invite_selection_confirmed boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_payload jsonb; v_result jsonb; v_hash text; v_hash_payload jsonb;
  v_prior public.rsvp_domain_operation_receipts%ROWTYPE; v_revision integer; v_event public.events%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='rsvp';
  IF NOT FOUND OR public.biz_brand_effective_rank(v_event.brand_id,v_actor)<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  v_hash_payload:=jsonb_build_object('eventId',p_event_id);
  IF p_invite_selection_revision IS NOT NULL OR COALESCE(p_invite_selection_confirmed,false) THEN
    v_hash_payload:=v_hash_payload||jsonb_build_object(
      'inviteSelectionRevision',p_invite_selection_revision,
      'inviteSelectionConfirmed',COALESCE(p_invite_selection_confirmed,false));
  END IF;
  v_hash:=encode(extensions.digest(convert_to(v_hash_payload::text,'UTF8'),'sha256'),'hex');
  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text||':rsvp_publish:'||p_client_request_id::text,0));
    SELECT * INTO v_prior FROM public.rsvp_domain_operation_receipts
      WHERE actor_id=v_actor AND operation='publish' AND client_request_id=p_client_request_id;
    IF FOUND THEN
      IF v_prior.request_hash<>v_hash OR v_prior.event_id IS DISTINCT FROM p_event_id THEN
        RAISE EXCEPTION 'rsvp_idempotency_hash_mismatch' USING ERRCODE='23505';
      END IF;
      RETURN v_prior.result||jsonb_build_object('replayed',true);
    END IF;
  END IF;
  v_payload:=public.issue_1977_current_rsvp_publish_payload(p_event_id);
  v_revision:=COALESCE((v_payload#>>'{theme,business_draft,clientRevision}')::integer,0);
  PERFORM public.business_publish_rsvp_draft(p_event_id,v_payload,v_revision);
  v_result:=public.issue_1977_rsvp_graph(p_event_id)
    ||private.enqueue_wizard_invites_on_publish_v1(
      p_event_id,p_invite_selection_revision,p_invite_selection_confirmed);
  IF p_client_request_id IS NOT NULL THEN
    INSERT INTO public.rsvp_domain_operation_receipts(actor_id,operation,client_request_id,event_id,request_hash,result)
    VALUES(v_actor,'publish',p_client_request_id,p_event_id,v_hash,v_result);
  END IF;
  RETURN v_result||jsonb_build_object('replayed',false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.business_publish_rsvp_graph(
  p_event_id uuid,p_client_request_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
  SELECT public.business_publish_rsvp_graph(p_event_id,p_client_request_id,NULL::bigint,false)
$fn$;

CREATE OR REPLACE FUNCTION public.biz_publish_trip_command(
  p_event_id uuid,p_expected_updated_at timestamptz,p_operation_id uuid,
  p_invite_selection_revision bigint,p_invite_selection_confirmed boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE
  v_event public.events%ROWTYPE; v_begin jsonb; v_result jsonb; v_start timestamptz;
  v_end timestamptz; v_payload jsonb; v_command_payload jsonb;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'trip_not_found'; END IF;
  IF v_event.event_type<>'trip' THEN RAISE EXCEPTION 'event_not_a_trip'; END IF;
  PERFORM public.biz_trip_require_manager(v_event.brand_id);
  v_command_payload:=jsonb_build_object('expected_updated_at',p_expected_updated_at);
  IF p_invite_selection_revision IS NOT NULL OR COALESCE(p_invite_selection_confirmed,false) THEN
    v_command_payload:=v_command_payload||jsonb_build_object(
      'invite_selection_revision',p_invite_selection_revision,
      'invite_selection_confirmed',COALESCE(p_invite_selection_confirmed,false));
  END IF;
  v_begin:=public.biz_trip_command_begin(
    p_operation_id,'publish_trip',v_event.brand_id,p_event_id,v_command_payload);
  IF (v_begin->>'replay')::boolean THEN RETURN v_begin->'result'; END IF;
  IF p_expected_updated_at IS NULL OR v_event.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'trip_revision_conflict' USING ERRCODE='40001';
  END IF;
  SELECT start_at,end_at INTO v_start,v_end FROM public.event_dates
    WHERE event_id=p_event_id AND is_master=true ORDER BY start_at LIMIT 1;
  v_payload:=jsonb_build_object(
    'title',v_event.title,'description',v_event.description,'timezone',v_event.timezone,
    'cover_media_url',v_event.cover_media_url,'cover_media_poster_url',v_event.cover_media_poster_url,
    'cover_media_type',v_event.cover_media_type,'cover_media_provider',v_event.cover_media_provider,
    'cover_media_source_url',v_event.cover_media_source_url,'cover_media_credit',v_event.cover_media_credit,
    'cover_media_credit_url',v_event.cover_media_credit_url,'cover_media_alt',v_event.cover_media_alt,
    'cover_media_gallery',v_event.cover_media_gallery,
    'theme',jsonb_set(COALESCE(v_event.theme,'{}'::jsonb),'{business_trip}',
      COALESCE(v_event.theme->'business_trip','{}'::jsonb)||jsonb_build_object(
        'destinationLocationText',v_event.destination_text,'departureLocationText',v_event.departure_text,
        'startAt',v_start,'endAt',v_end),true));
  v_result:=public.issue_1719_publish_trip_with_poster(p_event_id,v_payload,NULL);
  IF COALESCE((v_result->>'ok')::boolean,true) THEN
    v_result:=v_result||jsonb_build_object(
      'graph',public.biz_get_trip_draft_graph(p_event_id),
      'revision',(SELECT updated_at FROM public.events WHERE id=p_event_id))
      ||private.enqueue_wizard_invites_on_publish_v1(
        p_event_id,p_invite_selection_revision,p_invite_selection_confirmed);
  END IF;
  RETURN public.biz_trip_command_finish(p_operation_id,v_result);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.biz_publish_trip_command(
  p_event_id uuid,p_expected_updated_at timestamptz,p_operation_id uuid
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
  SELECT public.biz_publish_trip_command(
    p_event_id,p_expected_updated_at,p_operation_id,NULL::bigint,false)
$fn$;

REVOKE ALL ON FUNCTION public.biz_get_offering_invite_plan_v1(uuid),
  public.biz_replace_offering_invite_plan_v1(uuid,jsonb,bigint,uuid),
  public.biz_clear_offering_invite_plan_v1(uuid,bigint,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.biz_get_offering_invite_plan_v1(uuid),
  public.biz_replace_offering_invite_plan_v1(uuid,jsonb,bigint,uuid),
  public.biz_clear_offering_invite_plan_v1(uuid,bigint,uuid) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.issue_1780_claim_wizard_invite_outbox_v1(integer),
  public.issue_1780_seal_wizard_invite_execution_v1(uuid,uuid,uuid,jsonb),
  public.issue_1780_execute_wizard_invite_outbox_v1(uuid,uuid,uuid),
  public.issue_1780_fail_wizard_invite_outbox_v1(uuid,uuid,text,boolean),
  public.issue_1780_complete_wizard_invite_outbox_v1(uuid,uuid,uuid),
  public.issue_1780_complete_wizard_invite_outbox_no_recipients_v1(uuid,uuid,uuid),
  public.issue_1780_claim_wizard_invite_observability_v1(integer),
  public.issue_1780_complete_wizard_invite_observability_v1(bigint,uuid),
  public.issue_1780_claim_wizard_invite_health_v1(),
  public.issue_1780_complete_wizard_invite_health_alert_v1(text,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1780_claim_wizard_invite_outbox_v1(integer),
  public.issue_1780_seal_wizard_invite_execution_v1(uuid,uuid,uuid,jsonb),
  public.issue_1780_execute_wizard_invite_outbox_v1(uuid,uuid,uuid),
  public.issue_1780_fail_wizard_invite_outbox_v1(uuid,uuid,text,boolean),
  public.issue_1780_complete_wizard_invite_outbox_v1(uuid,uuid,uuid),
  public.issue_1780_complete_wizard_invite_outbox_no_recipients_v1(uuid,uuid,uuid),
  public.issue_1780_claim_wizard_invite_observability_v1(integer),
  public.issue_1780_complete_wizard_invite_observability_v1(bigint,uuid),
  public.issue_1780_claim_wizard_invite_health_v1(),
  public.issue_1780_complete_wizard_invite_health_alert_v1(text,uuid)
  TO service_role;

REVOKE ALL ON FUNCTION private.issue_1780_selection_hash(uuid[]),
  private.issue_1780_plan_member_same_brand(),
  private.issue_1780_payload_has_forbidden_invite_tail(jsonb),
  private.issue_1780_event_scope(uuid,uuid),private.issue_1780_plan_response(uuid),
  private.enqueue_wizard_invites_on_publish_v1(uuid,bigint,boolean),
  private.execute_brand_offering_invite_wizard_v1(uuid,uuid),
  private.issue_1780_stamp_new_wizard_invite_origin()
  FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION public.issue_1719_publish_event_with_poster(uuid,jsonb,integer),
  public.issue_1719_publish_experience_with_poster(uuid,jsonb,boolean),
  public.business_publish_rsvp_graph(uuid,uuid),public.business_publish_rsvp_graph(uuid,uuid,bigint,boolean),
  public.biz_publish_trip_command(uuid,timestamptz,uuid),
  public.biz_publish_trip_command(uuid,timestamptz,uuid,bigint,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_1719_publish_event_with_poster(uuid,jsonb,integer),
  public.issue_1719_publish_experience_with_poster(uuid,jsonb,boolean),
  public.business_publish_rsvp_graph(uuid,uuid),public.business_publish_rsvp_graph(uuid,uuid,bigint,boolean),
  public.biz_publish_trip_command(uuid,timestamptz,uuid),
  public.biz_publish_trip_command(uuid,timestamptz,uuid,bigint,boolean) TO authenticated,service_role;

DO $block$
BEGIN
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='issue_1780_wizard_invite_dispatch') THEN
    PERFORM cron.unschedule('issue_1780_wizard_invite_dispatch');
  END IF;
END;
$block$;
SELECT cron.schedule(
  'issue_1780_wizard_invite_dispatch','* * * * *',
  $cron$
    SELECT net.http_post(
      url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='supabase_url' LIMIT 1)
        ||'/functions/v1/offering-invite-dispatch',
      headers:=jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1),
        'x-mingla-internal-service-key',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)),
      body:='{"mode":"wizard_worker"}'::jsonb,timeout_milliseconds:=30000);
  $cron$);

COMMIT;
