-- [TEST-MOD-APPROVED #1780]
-- Independent catalog + behavior proof for the binding metadata-only outbox.
-- The #1780 job owns stable operation/lease state, never recipient, provider,
-- campaign, message, group, or execution-snapshot payload.
\set ON_ERROR_STOP on
BEGIN;

DO $catalog$
DECLARE
  v_columns text[];
  v_required_column text;
  v_table_oid oid;
BEGIN
  v_table_oid:=to_regclass('private.brand_offering_invite_outbox');
  IF v_table_oid IS NULL THEN
    RAISE EXCEPTION 'T-1780-OUTBOX-00 FAIL: exact private.brand_offering_invite_outbox is missing';
  END IF;
  IF to_regclass('private.brand_offering_invite_publish_outbox') IS NOT NULL THEN
    RAISE EXCEPTION 'T-1780-OUTBOX-00 FAIL: non-contract publish_outbox shadow table remains';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_class c
    WHERE c.oid=v_table_oid AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'T-1780-OUTBOX-00 FAIL: canonical outbox is not FORCE RLS';
  END IF;
  IF has_table_privilege('authenticated',v_table_oid,'SELECT')
     OR has_table_privilege('authenticated',v_table_oid,'INSERT')
     OR has_table_privilege('anon',v_table_oid,'SELECT')
     OR has_table_privilege('anon',v_table_oid,'INSERT') THEN
    RAISE EXCEPTION 'T-1780-OUTBOX-00 FAIL: outbox table is directly exposed';
  END IF;

  SELECT array_agg(column_name ORDER BY ordinal_position) INTO v_columns
  FROM information_schema.columns
  WHERE table_schema='private' AND table_name='brand_offering_invite_outbox';
  FOREACH v_required_column IN ARRAY ARRAY[
    'id','plan_id','brand_id','event_id','event_type','selection_revision',
    'operation_key','state','attempt_count','next_attempt_at','lease_token',
    'lease_expires_at','sealed_selection_id','last_error_code','created_at',
    'updated_at','completed_at'
  ] LOOP
    IF NOT v_required_column=ANY(v_columns) THEN
      RAISE EXCEPTION 'T-1780-OUTBOX-00 FAIL: required outbox column % missing',v_required_column;
    END IF;
  END LOOP;
  IF EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='private' AND table_name='brand_offering_invite_outbox'
      AND (
        data_type='jsonb'
        OR column_name~*'(execution|payload|message|recipient|destination|provider|group|person_ids|brand_person_ids)'
      )
  ) THEN
    RAISE EXCEPTION 'T-1780-OUTBOX-00 FAIL: outbox persists forbidden delivery/group/recipient payload';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint con
    WHERE con.conrelid=v_table_oid AND con.contype='u'
      AND pg_get_constraintdef(con.oid)='UNIQUE (event_id, selection_revision)'
  ) OR NOT EXISTS(
    SELECT 1 FROM pg_constraint con
    WHERE con.conrelid=v_table_oid AND con.contype='u'
      AND pg_get_constraintdef(con.oid)='UNIQUE (operation_key)'
  ) THEN
    RAISE EXCEPTION 'T-1780-OUTBOX-00 FAIL: operation/revision uniqueness is incomplete';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint con
    WHERE con.conrelid=v_table_oid AND con.contype='f'
      AND con.confrelid='private.brand_offering_invite_plans'::regclass
      AND pg_get_constraintdef(con.oid)~
        'FOREIGN KEY \(plan_id, selection_revision\).*\(id, selection_revision\)'
  ) OR NOT EXISTS(
    SELECT 1 FROM pg_constraint con
    WHERE con.conrelid=v_table_oid AND con.contype='f'
      AND con.confrelid='public.brands'::regclass
      AND pg_get_constraintdef(con.oid)~'FOREIGN KEY \(brand_id\)'
  ) THEN
    RAISE EXCEPTION 'T-1780-OUTBOX-00 FAIL: plan revision/brand foreign keys are incomplete';
  END IF;
END;
$catalog$;

INSERT INTO auth.users(id,email)
VALUES('00000000-1780-4000-8000-000000000a01','outbox-1780@example.test');
INSERT INTO public.creator_accounts(id,email,display_name)
VALUES(
  '00000000-1780-4000-8000-000000000a01',
  'outbox-1780@example.test','Issue 1780 Outbox Tester'
);
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
VALUES(
  '00000000-1780-4000-8000-000000000a02',
  '00000000-1780-4000-8000-000000000a01',
  'Issue 1780 Outbox Brand','issue-1780-outbox-brand','USD',now(),now()
);
INSERT INTO public.events(
  id,brand_id,created_by,event_type,title,slug,status,visibility,currency,
  timezone,party_types,rsvp_approval_mode,rsvp_discoverable,theme,created_at,updated_at
) VALUES
(
  '00000000-1780-4000-8000-000000000a03',
  '00000000-1780-4000-8000-000000000a02',
  '00000000-1780-4000-8000-000000000a01',
  'event','Outbox rollback','issue-1780-outbox-event','draft','draft','USD','UTC',
  '{}','auto',false,'{}',now(),now()
),
(
  '00000000-1780-4000-8000-000000000a04',
  '00000000-1780-4000-8000-000000000a02',
  '00000000-1780-4000-8000-000000000a01',
  'rsvp','Outbox empty','issue-1780-outbox-empty','draft','draft','USD','UTC',
  '{}','auto',false,'{}',now(),now()
);
INSERT INTO public.brand_people(id,brand_id,display_name,record_status)
VALUES(
  '00000000-1780-4000-8000-000000000a05',
  '00000000-1780-4000-8000-000000000a02','Outbox Person','active'
);
INSERT INTO private.brand_offering_invite_plans(
  id,event_id,brand_id,event_type,selection_revision,selection_hash,
  state,published_selection_revision,created_by,updated_by,locked_at
) VALUES
(
  '00000000-1780-4000-8000-000000000a06',
  '00000000-1780-4000-8000-000000000a03',
  '00000000-1780-4000-8000-000000000a02','event',1,
  private.issue_1780_selection_hash(
    ARRAY['00000000-1780-4000-8000-000000000a05'::uuid]
  ),'draft',NULL,
  '00000000-1780-4000-8000-000000000a01',
  '00000000-1780-4000-8000-000000000a01',NULL
),
(
  '00000000-1780-4000-8000-000000000a07',
  '00000000-1780-4000-8000-000000000a04',
  '00000000-1780-4000-8000-000000000a02','rsvp',1,
  private.issue_1780_selection_hash('{}'::uuid[]),'draft',NULL,
  '00000000-1780-4000-8000-000000000a01',
  '00000000-1780-4000-8000-000000000a01',NULL
);
INSERT INTO private.brand_offering_invite_plan_members(
  plan_id,brand_person_id,added_by
) VALUES(
  '00000000-1780-4000-8000-000000000a06',
  '00000000-1780-4000-8000-000000000a05',
  '00000000-1780-4000-8000-000000000a01'
);

DO $forced_rollback$
DECLARE v_error text;
BEGIN
  BEGIN
    PERFORM private.enqueue_wizard_invites_on_publish_v1(
      '00000000-1780-4000-8000-000000000a03',1,true
    );
    IF NOT EXISTS(
      SELECT 1 FROM private.brand_offering_invite_outbox
      WHERE event_id='00000000-1780-4000-8000-000000000a03'
    ) THEN
      RAISE EXCEPTION 'T-1780-OUTBOX-01 enqueue_missing';
    END IF;
    RAISE EXCEPTION 'T-1780-OUTBOX-01 force_later_publisher_rollback';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'T-1780-OUTBOX-01 force_later_publisher_rollback' THEN RAISE; END IF;
  END;
  IF EXISTS(
      SELECT 1 FROM private.brand_offering_invite_outbox
      WHERE event_id='00000000-1780-4000-8000-000000000a03'
    ) OR (SELECT state FROM private.brand_offering_invite_plans
      WHERE id='00000000-1780-4000-8000-000000000a06')<>'draft' THEN
    RAISE EXCEPTION 'T-1780-OUTBOX-01 FAIL: later publisher rollback leaked job/plan lock';
  END IF;
END;
$forced_rollback$;

DO $stable_operation$
DECLARE
  v_first jsonb;
  v_second jsonb;
  v_first_job_id text;
  v_second_job_id text;
  v_job_id uuid;
  v_expected_key text;
BEGIN
  v_first:=private.enqueue_wizard_invites_on_publish_v1(
    '00000000-1780-4000-8000-000000000a03',1,true
  );
  v_second:=private.enqueue_wizard_invites_on_publish_v1(
    '00000000-1780-4000-8000-000000000a03',1,true
  );
  SELECT id,operation_key INTO v_job_id,v_expected_key
  FROM private.brand_offering_invite_outbox
  WHERE event_id='00000000-1780-4000-8000-000000000a03';
  v_first_job_id:=COALESCE(
    v_first#>>'{inviteDelivery,outboxJobId}',
    v_first#>>'{invite_delivery,job_id}'
  );
  v_second_job_id:=COALESCE(
    v_second#>>'{inviteDelivery,outboxJobId}',
    v_second#>>'{invite_delivery,job_id}'
  );
  IF v_expected_key<>'wizard:v1:event:00000000-1780-4000-8000-000000000a03:1'
     OR (SELECT count(*) FROM private.brand_offering_invite_outbox
       WHERE event_id='00000000-1780-4000-8000-000000000a03')<>1
     OR v_first_job_id IS DISTINCT FROM v_job_id::text
     OR v_second_job_id IS DISTINCT FROM v_job_id::text
     OR EXISTS(
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='private' AND table_name='brand_offering_invite_outbox'
         AND data_type='jsonb'
     ) THEN
    RAISE EXCEPTION 'T-1780-OUTBOX-02 FAIL: operation replay/payload boundary drifted: %, %',v_first,v_second;
  END IF;
END;
$stable_operation$;

DO $empty_no_payload$
DECLARE v_empty jsonb;
BEGIN
  v_empty:=private.enqueue_wizard_invites_on_publish_v1(
    '00000000-1780-4000-8000-000000000a04',NULL,false
  );
  IF EXISTS(
      SELECT 1 FROM private.brand_offering_invite_outbox
      WHERE event_id='00000000-1780-4000-8000-000000000a04'
    ) OR v_empty#>>'{inviteDelivery,status}' NOT IN ('empty','not_requested','no_send') THEN
    RAISE EXCEPTION 'T-1780-OUTBOX-03 FAIL: empty selection created a job/payload: %',v_empty;
  END IF;
END;
$empty_no_payload$;

ROLLBACK;
