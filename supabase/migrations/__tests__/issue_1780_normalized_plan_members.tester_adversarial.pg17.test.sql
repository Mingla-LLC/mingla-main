-- [TEST-MOD-APPROVED #1780]
-- Independent SPEC-compliance proof for the normalized private plan-member
-- authority required by §6, SC-05, §19, and locked decision §24. UUID arrays
-- on the plan are not an equivalent authority: each selected person must be a
-- constrained row that replace/clear, hydration, quote, seal, and dispatch use.
\set ON_ERROR_STOP on
BEGIN;

DO $catalog$
DECLARE
  v_trigger_count integer;
  v_get text;
  v_replace text;
  v_response text;
  v_enqueue text;
BEGIN
  IF NOT EXISTS(
    SELECT 1
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='private'
      AND c.relname='brand_offering_invite_plan_members'
      AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'T-1780-MEM-00 FAIL: normalized private forced-RLS plan-members table missing';
  END IF;
  IF EXISTS(
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='private'
      AND table_name='brand_offering_invite_plans'
      AND column_name='brand_person_ids'
  ) THEN
    RAISE EXCEPTION 'T-1780-MEM-00 FAIL: plan UUID array remains membership authority';
  END IF;
  IF NOT EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='private' AND table_name='brand_offering_invite_plans'
        AND column_name='id' AND data_type='uuid'
    ) OR NOT EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='private' AND table_name='brand_offering_invite_plan_members'
        AND column_name='plan_id' AND data_type='uuid'
    ) OR NOT EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='private' AND table_name='brand_offering_invite_plan_members'
        AND column_name='brand_person_id' AND data_type='uuid'
    ) OR NOT EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='private' AND table_name='brand_offering_invite_plan_members'
        AND column_name='added_by' AND data_type='uuid'
    ) OR NOT EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='private' AND table_name='brand_offering_invite_plan_members'
        AND column_name='created_at' AND data_type='timestamp with time zone'
    ) THEN
    RAISE EXCEPTION 'T-1780-MEM-00 FAIL: normalized member/plan key columns are incomplete';
  END IF;
  IF NOT EXISTS(
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class c ON c.oid=con.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='private'
      AND c.relname='brand_offering_invite_plan_members'
      AND con.contype='p'
      AND pg_get_constraintdef(con.oid)='PRIMARY KEY (plan_id, brand_person_id)'
  ) THEN
    RAISE EXCEPTION 'T-1780-MEM-00 FAIL: member PK is not (plan_id, brand_person_id)';
  END IF;
  IF NOT EXISTS(
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class c ON c.oid=con.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='private'
      AND c.relname='brand_offering_invite_plan_members'
      AND con.contype='f'
      AND pg_get_constraintdef(con.oid) ~
        '^FOREIGN KEY \(plan_id\) REFERENCES private\.brand_offering_invite_plans\(id\) ON DELETE CASCADE'
  ) OR NOT EXISTS(
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class c ON c.oid=con.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='private'
      AND c.relname='brand_offering_invite_plan_members'
      AND con.contype='f'
      AND pg_get_constraintdef(con.oid) ~
        '^FOREIGN KEY \(brand_person_id\) REFERENCES brand_people\(id\)'
  ) THEN
    RAISE EXCEPTION 'T-1780-MEM-00 FAIL: member plan/person foreign keys are incomplete';
  END IF;
  IF NOT EXISTS(
      SELECT 1
      FROM pg_constraint con
      JOIN pg_class c ON c.oid=con.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=con.conrelid
        AND a.attnum=con.conkey[1]
      JOIN pg_attribute fa ON fa.attrelid=con.confrelid
        AND fa.attnum=con.confkey[1]
      WHERE n.nspname='private'
        AND c.relname='brand_offering_invite_plans'
        AND con.contype='f'
        AND array_length(con.conkey,1)=1 AND array_length(con.confkey,1)=1
        AND a.attname='created_by' AND fa.attname='id'
        AND con.confrelid='auth.users'::regclass
    ) OR NOT EXISTS(
      SELECT 1
      FROM pg_constraint con
      JOIN pg_class c ON c.oid=con.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=con.conrelid
        AND a.attnum=con.conkey[1]
      JOIN pg_attribute fa ON fa.attrelid=con.confrelid
        AND fa.attnum=con.confkey[1]
      WHERE n.nspname='private'
        AND c.relname='brand_offering_invite_plans'
        AND con.contype='f'
        AND array_length(con.conkey,1)=1 AND array_length(con.confkey,1)=1
        AND a.attname='updated_by' AND fa.attname='id'
        AND con.confrelid='auth.users'::regclass
    ) OR NOT EXISTS(
      SELECT 1
      FROM pg_constraint con
      JOIN pg_class c ON c.oid=con.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=con.conrelid
        AND a.attnum=con.conkey[1]
      JOIN pg_attribute fa ON fa.attrelid=con.confrelid
        AND fa.attnum=con.confkey[1]
      WHERE n.nspname='private'
        AND c.relname='brand_offering_invite_plan_members'
        AND con.contype='f'
        AND array_length(con.conkey,1)=1 AND array_length(con.confkey,1)=1
        AND a.attname='added_by' AND fa.attname='id'
        AND con.confrelid='auth.users'::regclass
  ) THEN
    RAISE EXCEPTION 'T-1780-MEM-00 FAIL: binding actor auth-user FKs are incomplete';
  END IF;
  SELECT count(*) INTO v_trigger_count
  FROM pg_trigger t
  JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='private'
    AND c.relname='brand_offering_invite_plan_members'
    AND NOT t.tgisinternal AND t.tgconstraint<>0
    AND pg_get_functiondef(t.tgfoid) ~* 'brand_offering_invite_plans'
    AND pg_get_functiondef(t.tgfoid) ~* 'brand_people'
    AND pg_get_functiondef(t.tgfoid) ~* 'brand_id';
  IF v_trigger_count<>1 THEN
    RAISE EXCEPTION 'T-1780-MEM-00 FAIL: exactly one same-brand constraint trigger is required, found %',v_trigger_count;
  END IF;
  IF has_table_privilege(
      'authenticated','private.brand_offering_invite_plan_members','SELECT')
     OR has_table_privilege(
      'anon','private.brand_offering_invite_plan_members','INSERT') THEN
    RAISE EXCEPTION 'T-1780-MEM-00 FAIL: normalized members are directly exposed';
  END IF;

  v_get:=pg_get_functiondef('public.biz_get_offering_invite_plan_v1(uuid)'::regprocedure);
  v_replace:=pg_get_functiondef(
    'public.biz_replace_offering_invite_plan_v1(uuid,jsonb,bigint,uuid)'::regprocedure
  );
  v_response:=pg_get_functiondef('private.issue_1780_plan_response(uuid)'::regprocedure);
  v_enqueue:=pg_get_functiondef(
    'private.enqueue_wizard_invites_on_publish_v1(uuid,bigint,boolean)'::regprocedure
  );
  IF v_get !~* 'brand_offering_invite_plan_members'
     OR v_response !~* 'brand_offering_invite_plan_members'
     OR v_replace !~* 'DELETE[[:space:]]+FROM[[:space:]]+private\.brand_offering_invite_plan_members'
     OR v_replace !~* 'INSERT[[:space:]]+INTO[[:space:]]+private\.brand_offering_invite_plan_members'
     OR v_enqueue !~* 'brand_offering_invite_plan_members' THEN
    RAISE EXCEPTION 'T-1780-MEM-00 FAIL: replace/hydration/seal do not share normalized row authority';
  END IF;
END;
$catalog$;

INSERT INTO auth.users(id)
VALUES('00000000-1780-4000-8000-000000000801');
INSERT INTO public.creator_accounts(id,email,display_name)
VALUES(
  '00000000-1780-4000-8000-000000000801',
  'normalized-members-1780@example.test',
  'Issue 1780 Member Tester'
);
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
VALUES
('00000000-1780-4000-8000-000000000802','00000000-1780-4000-8000-000000000801',
 'Issue 1780 Member Brand','issue-1780-member-brand','USD',now(),now()),
('00000000-1780-4000-8000-000000000803','00000000-1780-4000-8000-000000000801',
 'Issue 1780 Foreign Member Brand','issue-1780-foreign-member-brand','USD',now(),now());
INSERT INTO public.events(
  id,brand_id,created_by,event_type,title,slug,status,visibility,currency,
  timezone,party_types,rsvp_approval_mode,rsvp_discoverable,theme,created_at,updated_at
) VALUES(
  '00000000-1780-4000-8000-000000000804',
  '00000000-1780-4000-8000-000000000802',
  '00000000-1780-4000-8000-000000000801',
  'event','Normalized member plan','issue-1780-member-event',
  'draft','draft','USD','UTC','{}','auto',false,'{}',now(),now()
);
INSERT INTO public.brand_people(id,brand_id,display_name,record_status) VALUES
('00000000-1780-4000-8000-000000000811','00000000-1780-4000-8000-000000000802','Member One','active'),
('00000000-1780-4000-8000-000000000812','00000000-1780-4000-8000-000000000802','Member Two','active'),
('00000000-1780-4000-8000-000000000813','00000000-1780-4000-8000-000000000802','Member Three','active'),
('00000000-1780-4000-8000-000000000814','00000000-1780-4000-8000-000000000803','Foreign Member','active');
INSERT INTO public.marketing_audiences(
  id,account_id,brand_id,name,query_definition,is_system_generated,created_by
) VALUES(
  '00000000-1780-4000-8000-000000000821',
  '00000000-1780-4000-8000-000000000801',
  '00000000-1780-4000-8000-000000000802',
  'Normalized group','{"kind":"manual_group"}',false,
  '00000000-1780-4000-8000-000000000801'
);
INSERT INTO public.marketing_manual_group_memberships(
  id,brand_id,audience_id,brand_person_id,state,source,created_by,
  ended_by,ended_at,end_reason
) VALUES
('00000000-1780-4000-8000-000000000831','00000000-1780-4000-8000-000000000802',
 '00000000-1780-4000-8000-000000000821','00000000-1780-4000-8000-000000000811',
 'active','book_picker','00000000-1780-4000-8000-000000000801',NULL,NULL,NULL),
('00000000-1780-4000-8000-000000000832','00000000-1780-4000-8000-000000000802',
 '00000000-1780-4000-8000-000000000821','00000000-1780-4000-8000-000000000812',
 'active','book_picker','00000000-1780-4000-8000-000000000801',NULL,NULL,NULL);
UPDATE public.feature_flags SET is_enabled=true
WHERE flag_key='business_wizard_invite_selection_v1';

SELECT set_config('request.jwt.claim.sub','00000000-1780-4000-8000-000000000801',true);
SET LOCAL ROLE authenticated;
DO $initial_group_snapshot$
DECLARE v_plan jsonb;
BEGIN
  v_plan:=public.biz_replace_offering_invite_plan_v1(
    '00000000-1780-4000-8000-000000000804',
    '{"includeEveryone":false,"manualGroupIds":["00000000-1780-4000-8000-000000000821"],"personIds":["00000000-1780-4000-8000-000000000811","00000000-1780-4000-8000-000000000811"],"excludedPersonIds":[]}',
    0,'00000000-1780-4000-8000-000000000841'
  );
  IF (v_plan->>'selectionRevision')::bigint<>1
     OR v_plan->'brandPersonIds'<>jsonb_build_array(
       '00000000-1780-4000-8000-000000000811',
       '00000000-1780-4000-8000-000000000812') THEN
    RAISE EXCEPTION 'T-1780-MEM-01 FAIL: group/direct overlap did not normalize: %',v_plan;
  END IF;
END;
$initial_group_snapshot$;

RESET ROLE;
UPDATE public.marketing_manual_group_memberships SET
  state='removed',ended_by='00000000-1780-4000-8000-000000000801',
  ended_at=now(),end_reason='snapshot_drift_test'
WHERE id='00000000-1780-4000-8000-000000000832';
INSERT INTO public.marketing_manual_group_memberships(
  id,brand_id,audience_id,brand_person_id,state,source,created_by
) VALUES(
  '00000000-1780-4000-8000-000000000833','00000000-1780-4000-8000-000000000802',
  '00000000-1780-4000-8000-000000000821','00000000-1780-4000-8000-000000000813',
  'active','book_picker','00000000-1780-4000-8000-000000000801'
);
SET LOCAL ROLE authenticated;
DO $hydrate_and_replace_clear$
DECLARE v_plan jsonb;
BEGIN
  v_plan:=public.biz_get_offering_invite_plan_v1(
    '00000000-1780-4000-8000-000000000804'
  );
  IF v_plan->'brandPersonIds'<>jsonb_build_array(
      '00000000-1780-4000-8000-000000000811',
      '00000000-1780-4000-8000-000000000812') THEN
    RAISE EXCEPTION 'T-1780-MEM-02 FAIL: later group edit mutated normalized snapshot: %',v_plan;
  END IF;

  v_plan:=public.biz_replace_offering_invite_plan_v1(
    '00000000-1780-4000-8000-000000000804',
    '{"includeEveryone":false,"manualGroupIds":[],"personIds":["00000000-1780-4000-8000-000000000811","00000000-1780-4000-8000-000000000813"],"excludedPersonIds":[]}',
    1,'00000000-1780-4000-8000-000000000842'
  );
  IF (v_plan->>'selectionRevision')::bigint<>2
     OR v_plan->'brandPersonIds'<>jsonb_build_array(
       '00000000-1780-4000-8000-000000000811',
       '00000000-1780-4000-8000-000000000813') THEN
    RAISE EXCEPTION 'T-1780-MEM-03 FAIL: exact row replacement failed: %',v_plan;
  END IF;

  v_plan:=public.biz_clear_offering_invite_plan_v1(
    '00000000-1780-4000-8000-000000000804',2,
    '00000000-1780-4000-8000-000000000843'
  );
  IF (v_plan->>'selectionRevision')::bigint<>3
     OR (v_plan->>'selectedCount')::integer<>0
     OR v_plan->'brandPersonIds'<>'[]'::jsonb THEN
    RAISE EXCEPTION 'T-1780-MEM-04 FAIL: clear did not delete normalized rows: %',v_plan;
  END IF;

  v_plan:=public.biz_replace_offering_invite_plan_v1(
    '00000000-1780-4000-8000-000000000804',
    '{"includeEveryone":false,"manualGroupIds":["00000000-1780-4000-8000-000000000821"],"personIds":["00000000-1780-4000-8000-000000000811"],"excludedPersonIds":["00000000-1780-4000-8000-000000000813"]}',
    3,'00000000-1780-4000-8000-000000000844'
  );
  IF (v_plan->>'selectionRevision')::bigint<>4
     OR v_plan->'brandPersonIds'<>jsonb_build_array(
       '00000000-1780-4000-8000-000000000811') THEN
    RAISE EXCEPTION 'T-1780-MEM-05 FAIL: row snapshot after clear is wrong: %',v_plan;
  END IF;
END;
$hydrate_and_replace_clear$;

RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
DO $cross_brand_constraint$
DECLARE v_plan_id uuid; v_before integer; v_error text;
BEGIN
  SELECT id INTO v_plan_id FROM private.brand_offering_invite_plans
  WHERE event_id='00000000-1780-4000-8000-000000000804';
  SELECT count(*) INTO v_before FROM private.brand_offering_invite_plan_members
  WHERE plan_id=v_plan_id;
  BEGIN
    INSERT INTO private.brand_offering_invite_plan_members(
      plan_id,brand_person_id,added_by
    ) VALUES(
      v_plan_id,'00000000-1780-4000-8000-000000000814',
      '00000000-1780-4000-8000-000000000801'
    );
    RAISE EXCEPTION 'T-1780-MEM-06 FAIL: cross-brand member row was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error='T-1780-MEM-06 FAIL: cross-brand member row was accepted' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM private.brand_offering_invite_plan_members
      WHERE plan_id=v_plan_id)<>v_before THEN
    RAISE EXCEPTION 'T-1780-MEM-06 FAIL: rejected cross-brand row changed membership';
  END IF;
END;
$cross_brand_constraint$;

INSERT INTO public.marketing_audiences(
  id,account_id,brand_id,name,query_definition,is_system_generated,created_by
) VALUES(
  '00000000-1780-4000-8000-000000000822',
  '00000000-1780-4000-8000-000000000801',
  '00000000-1780-4000-8000-000000000802',
  'Over cap group','{"kind":"manual_group"}',false,
  '00000000-1780-4000-8000-000000000801'
);
WITH people AS (
  INSERT INTO public.brand_people(brand_id,display_name,record_status)
  SELECT '00000000-1780-4000-8000-000000000802','Over cap '||n,'active'
  FROM generate_series(1,501) n
  RETURNING id
)
INSERT INTO public.marketing_manual_group_memberships(
  id,brand_id,audience_id,brand_person_id,state,source,created_by
)
SELECT gen_random_uuid(),'00000000-1780-4000-8000-000000000802',
  '00000000-1780-4000-8000-000000000822',id,'active','book_picker',
  '00000000-1780-4000-8000-000000000801'
FROM people;

SET LOCAL ROLE authenticated;
DO $cap_rollback$
DECLARE v_before jsonb; v_after jsonb; v_error text;
BEGIN
  v_before:=public.biz_get_offering_invite_plan_v1(
    '00000000-1780-4000-8000-000000000804'
  );
  BEGIN
    PERFORM public.biz_replace_offering_invite_plan_v1(
      '00000000-1780-4000-8000-000000000804',
      '{"includeEveryone":false,"manualGroupIds":["00000000-1780-4000-8000-000000000822"],"personIds":[],"excludedPersonIds":[]}',
      4,'00000000-1780-4000-8000-000000000845'
    );
    RAISE EXCEPTION 'T-1780-MEM-07 FAIL: 501 normalized members were accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error='T-1780-MEM-07 FAIL: 501 normalized members were accepted' THEN RAISE; END IF;
    IF v_error NOT LIKE '%wizard_invite_selection_too_large%' THEN RAISE; END IF;
  END;
  v_after:=public.biz_get_offering_invite_plan_v1(
    '00000000-1780-4000-8000-000000000804'
  );
  IF v_after->'brandPersonIds' IS DISTINCT FROM v_before->'brandPersonIds'
     OR v_after->>'selectionRevision' IS DISTINCT FROM v_before->>'selectionRevision' THEN
    RAISE EXCEPTION 'T-1780-MEM-08 FAIL: rejected 501 replace partially mutated plan: before %, after %',v_before,v_after;
  END IF;
  PERFORM set_config('mingla.issue_1780_member_quote_plan',v_after::text,true);
END;
$cap_rollback$;

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $quote_from_normalized_rows$
DECLARE v_after jsonb; v_quote jsonb;
BEGIN
  v_after:=current_setting('mingla.issue_1780_member_quote_plan')::jsonb;
  v_quote:=public.biz_offering_send_quote_candidates(
    '00000000-1780-4000-8000-000000000801',
    '00000000-1780-4000-8000-000000000804','invitation',
    jsonb_build_object(
      'kind','resolved_brand_people_v1','source','guest_roster_actions',
      'brandPersonIds',v_after->'brandPersonIds',
      'selectionHash',v_after->>'selectionHash'
    ),ARRAY['push']::text[]
  );
  IF (v_quote->>'selectedCount')::integer<>1 THEN
    RAISE EXCEPTION 'T-1780-MEM-09 FAIL: quote did not consume hydrated normalized rows: %',v_quote;
  END IF;
END;
$quote_from_normalized_rows$;

RESET ROLE;
DO $seal_from_rows$
DECLARE v_result jsonb; v_member_ids uuid[]; v_sealed_ids uuid[];
BEGIN
  v_result:=private.enqueue_wizard_invites_on_publish_v1(
    '00000000-1780-4000-8000-000000000804',4,true
  );
  SELECT array_agg(m.brand_person_id ORDER BY m.brand_person_id)
    INTO v_member_ids
  FROM private.brand_offering_invite_plan_members m
  JOIN private.brand_offering_invite_plans p ON p.id=m.plan_id
  WHERE p.event_id='00000000-1780-4000-8000-000000000804';
  SELECT s.brand_person_ids INTO v_sealed_ids
  FROM private.brand_offering_invite_selections s
  WHERE s.event_id='00000000-1780-4000-8000-000000000804'
    AND s.selection_revision=4;
  IF v_result#>>'{inviteDelivery,status}'<>'pending'
     OR v_member_ids IS DISTINCT FROM v_sealed_ids
     OR v_sealed_ids IS DISTINCT FROM
       ARRAY['00000000-1780-4000-8000-000000000811'::uuid] THEN
    RAISE EXCEPTION 'T-1780-MEM-10 FAIL: publish seal did not consume normalized rows: %, %, %',v_result,v_member_ids,v_sealed_ids;
  END IF;
END;
$seal_from_rows$;

UPDATE public.feature_flags SET is_enabled=true
WHERE flag_key='business_wizard_invite_dispatch_v1';
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $dispatch_claim$
DECLARE v_jobs jsonb; v_job jsonb;
BEGIN
  v_jobs:=public.issue_1780_claim_wizard_invite_outbox_v1(10);
  SELECT value INTO v_job FROM jsonb_array_elements(v_jobs)
  WHERE value->>'eventId'='00000000-1780-4000-8000-000000000804';
  IF v_job IS NULL
     OR v_job->'brandPersonIds'<>jsonb_build_array(
       '00000000-1780-4000-8000-000000000811') THEN
    RAISE EXCEPTION 'T-1780-MEM-11 FAIL: dispatch did not receive normalized sealed rows: %',v_jobs;
  END IF;
END;
$dispatch_claim$;

ROLLBACK;
