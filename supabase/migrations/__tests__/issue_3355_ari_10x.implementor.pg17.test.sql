\set ON_ERROR_STOP on

-- Issue #3355 — Ari 10x durable state, privacy boundary and admin isolation.
-- Runs after the full PG17 migration replay and rolls every fixture back.

BEGIN;

CREATE TEMP TABLE t3355_ids (key text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON t3355_ids TO authenticated;

DO $fixture$
DECLARE
  v_user uuid := gen_random_uuid();
  v_conversation uuid := gen_random_uuid();
  v_user_message uuid := gen_random_uuid();
  v_assistant_message uuid := gen_random_uuid();
  v_training uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_case uuid := gen_random_uuid();
  v_baseline uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_user, 'ari3355@example.com');
  INSERT INTO auth.users(id, email) VALUES (v_admin, 'ari3355-admin@example.com');
  INSERT INTO public.admin_users(email, role, status)
  VALUES ('ari3355-admin@example.com', 'admin', 'active');
  INSERT INTO t3355_ids VALUES ('user', v_user), ('conversation', v_conversation),
    ('user_message', v_user_message), ('assistant_message', v_assistant_message),
    ('training', v_training), ('admin', v_admin), ('case', v_case),
    ('baseline', v_baseline);
  INSERT INTO public.agent_conversations(id, user_id, title)
  VALUES (v_conversation, v_user, 'Ari 10x fixture');
  INSERT INTO public.agent_messages(id, conversation_id, user_id, role, content)
  VALUES
    (v_user_message, v_conversation, v_user, 'user', '{"text":"private raw user turn"}'),
    (v_assistant_message, v_conversation, v_user, 'assistant', '{"text":"private raw reply"}');
  INSERT INTO public.ari_training_turns(
    id, archive_conversation_key, source_user_id, source_conversation_id, source_user_message_id,
    source_assistant_message_id, sanitized_user_text, sanitized_assistant_text
  ) VALUES (
    v_training, v_conversation, v_user, v_conversation, v_user_message, v_assistant_message,
    '[email removed] wants an event', 'Prepared a safe plan.'
  );
  INSERT INTO public.ari_quality_cases(
    id, training_turn_id, source_user_id, source_conversation_id, title,
    redacted_summary, sanitized_transcript
  ) VALUES (
    v_case, v_training, v_user, v_conversation, 'Needs a better plan', 'Sanitized only',
    '[{"role":"user","text":"[email removed] wants an event"}]'
  );
  INSERT INTO public.ari_runtime_versions(
    id, version_key, kind, status, config, config_digest, created_by, approved_by, activated_at
  ) VALUES (
    v_baseline, 'issue3355.baseline', 'combined', 'active', '{}', repeat('b', 64), v_admin, v_admin, now()
  );
END
$fixture$;

DO $grants$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'ari_training_turns', 'ari_quality_cases', 'ari_quality_case_evidence',
    'ari_capability_gaps', 'ari_improvement_proposals', 'ari_runtime_versions',
    'ari_evaluation_scenarios', 'ari_evaluation_runs', 'ari_evaluation_results',
    'ari_rollouts', 'ari_quality_access_audit', 'ari_research_cache', 'ari_agent_jobs',
    'ari_message_feedback'
  ] LOOP
    IF has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
       OR has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE') THEN
      RAISE EXCEPTION 'authenticated has direct write privilege on %', v_table;
    END IF;
  END LOOP;
END
$grants$;

DO $activity_contract$
DECLARE
  v_constraint text;
  v_function text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.agent_activity_events'::regclass
    AND conname = 'agent_activity_events_event_type_check';
  SELECT pg_get_functiondef(
    'public.append_agent_activity_event(uuid,uuid,integer,text,timestamptz)'::regprocedure
  ) INTO v_function;
  IF v_constraint NOT LIKE '%planning_started%'
     OR v_constraint NOT LIKE '%research_started%'
     OR v_constraint NOT LIKE '%verification_started%' THEN
    RAISE EXCEPTION 'visible Ari plan phases are absent from the activity constraint';
  END IF;
  IF v_function NOT LIKE '%planning_started%'
     OR v_function NOT LIKE '%research_started%'
     OR v_function NOT LIKE '%verification_started%' THEN
    RAISE EXCEPTION 'visible Ari plan phases are absent from the append authority';
  END IF;
END
$activity_contract$;

DO $attachment_media_contract$
DECLARE
  v_constraint text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.agent_attachments'::regclass
    AND conname = 'agent_attachments_file_type_check';
  IF v_constraint NOT LIKE '%audio%'
     OR v_constraint NOT LIKE '%video%' THEN
    RAISE EXCEPTION 'Ari media MIME support and the attachment table constraint drifted: %', v_constraint;
  END IF;
END
$attachment_media_contract$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t3355_ids WHERE key = 'user'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', (SELECT id FROM t3355_ids WHERE key = 'user'),
  'email', 'ari3355@example.com', 'role', 'authenticated'
)::text, true);

DO $owner_state$
DECLARE
  v_plan jsonb;
  v_note jsonb;
  v_job jsonb;
  v_same jsonb;
  v_conflict boolean := false;
  v_key uuid := gen_random_uuid();
BEGIN
  v_plan := public.ari_upsert_onboarding_plan(
    NULL, 'self_serve', 0,
    '{"current_step":"brand","status":"active"}',
    '{"source":"fixture"}'
  );
  IF (v_plan ->> 'revision')::integer <> 1 OR v_plan ->> 'current_step' <> 'brand' THEN
    RAISE EXCEPTION 'plan create or current step failed: %', v_plan;
  END IF;
  v_plan := public.ari_upsert_onboarding_plan(
    NULL, 'self_serve', 1,
    '{"current_step":"listing"}', '{"brand_verified":true}'
  );
  IF (v_plan ->> 'revision')::integer <> 2 OR v_plan ->> 'current_step' <> 'listing' THEN
    RAISE EXCEPTION 'plan CAS update failed: %', v_plan;
  END IF;
  BEGIN
    PERFORM public.ari_upsert_onboarding_plan(NULL, 'self_serve', 1, '{}', '{}');
  EXCEPTION WHEN OTHERS THEN
    v_conflict := SQLERRM = 'revision_conflict';
  END;
  IF NOT v_conflict THEN RAISE EXCEPTION 'stale plan revision was accepted'; END IF;

  v_note := public.ari_memory_save(NULL, 'preference', 'Use concise launch copy', NULL);
  IF jsonb_array_length(public.ari_memory_list(NULL)) <> 1 THEN
    RAISE EXCEPTION 'memory was not caller scoped and readable';
  END IF;
  v_note := public.ari_memory_update(
    (v_note ->> 'id')::uuid, 'correction', 'Use concise launch copy with exact dates', NULL
  );
  IF v_note ->> 'kind' <> 'correction'
     OR v_note ->> 'content' <> 'Use concise launch copy with exact dates' THEN
    RAISE EXCEPTION 'editable memory did not persist the correction: %', v_note;
  END IF;
  PERFORM public.ari_memory_forget((v_note ->> 'id')::uuid);
  IF jsonb_array_length(public.ari_memory_list(NULL)) <> 0 THEN
    RAISE EXCEPTION 'forgotten memory still appeared';
  END IF;

  v_job := public.ari_manage_agent_job(
    'create', NULL, NULL, (SELECT id FROM t3355_ids WHERE key = 'conversation'),
    v_key, NULL,
    '{"goal_summary":"Launch the host from supplied materials","pending_step_keys":["brand","listing","publish"]}'
  );
  v_same := public.ari_manage_agent_job(
    'create', NULL, NULL, (SELECT id FROM t3355_ids WHERE key = 'conversation'),
    v_key, NULL,
    '{"goal_summary":"This retry must not create a second job"}'
  );
  IF v_job ->> 'id' IS DISTINCT FROM v_same ->> 'id' THEN
    RAISE EXCEPTION 'idempotent job retry duplicated work';
  END IF;
  v_job := public.ari_manage_agent_job(
    'checkpoint', (v_job ->> 'id')::uuid, NULL, NULL, NULL,
    (v_job ->> 'revision')::integer,
    '{"status":"running","checkpoint":{"current_step":"listing"},"completed_step_keys":["brand"],"pending_step_keys":["listing","publish"]}'
  );
  v_job := public.ari_manage_agent_job(
    'pause', (v_job ->> 'id')::uuid, NULL, NULL, NULL,
    (v_job ->> 'revision')::integer, '{}'
  );
  v_job := public.ari_manage_agent_job(
    'resume', (v_job ->> 'id')::uuid, NULL, NULL, NULL,
    (v_job ->> 'revision')::integer, '{}'
  );
  IF v_job ->> 'status' <> 'queued' OR v_job #>> '{checkpoint,current_step}' <> 'listing' THEN
    RAISE EXCEPTION 'job pause/resume lost checkpoint: %', v_job;
  END IF;
END
$owner_state$;

DO $admin_guard$
DECLARE
  v_denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.ari_admin_improvement_workspace(10);
  EXCEPTION WHEN OTHERS THEN
    v_denied := SQLERRM = 'not_authorized';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'non-admin opened the Improvement Lab'; END IF;
END
$admin_guard$;

RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM t3355_ids WHERE key = 'admin'), true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', (SELECT id FROM t3355_ids WHERE key = 'admin'),
  'email', 'ari3355-admin@example.com', 'role', 'authenticated'
)::text, true);

DO $admin_lifecycle$
DECLARE
  v_proposal jsonb;
  v_version jsonb;
  v_run jsonb;
  v_rollout jsonb;
  v_results jsonb;
  v_denied boolean := false;
BEGIN
  v_proposal := public.ari_admin_create_improvement_proposal(
    (SELECT id FROM t3355_ids WHERE key = 'case'), NULL, 'tool',
    'Recover from missing listing details',
    'A bounded clarification before writes will improve completion.',
    '{"module":"agent-loop","change":"ask only for blocking fields"}',
    'Hosts finish a valid plan without repeated continue prompts.',
    'medium', '{"required_pass_rate":1,"max_regressions":0}',
    'PG17 improvement lifecycle proof'
  );
  BEGIN
    PERFORM public.ari_admin_transition_improvement_proposal(
      (v_proposal ->> 'id')::uuid, 'approved_for_rollout', 'Attempt to skip evaluation'
    );
  EXCEPTION WHEN OTHERS THEN
    v_denied := SQLERRM = 'invalid_proposal_transition';
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'proposal skipped the evaluation gate'; END IF;

  v_proposal := public.ari_admin_transition_improvement_proposal(
    (v_proposal ->> 'id')::uuid, 'approved_for_eval', 'Approve the local candidate evaluation'
  );
  v_run := public.ari_admin_start_evaluation(
    'local_live', NULL, (v_proposal ->> 'id')::uuid,
    'Prove an incomplete local run can be cancelled safely'
  );
  v_run := public.ari_admin_cancel_evaluation(
    (v_run ->> 'id')::uuid, 'Cancel the intentionally incomplete local run'
  );
  IF v_run ->> 'status' <> 'cancelled' THEN
    RAISE EXCEPTION 'evaluation cancellation was not durable: %', v_run;
  END IF;
  v_version := public.ari_admin_create_runtime_version(
    (v_proposal ->> 'id')::uuid, 'issue3355.candidate', 'combined',
    (SELECT id FROM t3355_ids WHERE key = 'baseline'),
    '{"prompt":"candidate","toolset":"bounded"}', repeat('a', 64),
    'Create reproducible candidate version'
  );
  v_run := public.ari_admin_start_evaluation(
    'deterministic', (v_version ->> 'id')::uuid, (v_proposal ->> 'id')::uuid,
    'Run the complete deterministic suite'
  );
  SELECT jsonb_agg(jsonb_build_object(
    'scenario_key', scenario ->> 'scenario_key',
    'passed', true,
    'score', 1,
    'failure_codes', '[]'::jsonb,
    'trace', jsonb_build_array(jsonb_build_object('proof', 'pg17')),
    'metrics', jsonb_build_object('latency_ms', 1, 'estimated_cost_micros', 0)
  ) ORDER BY scenario ->> 'scenario_key') INTO v_results
  FROM jsonb_array_elements(
    public.ari_admin_improvement_workspace(100) -> 'evaluation_scenarios'
  ) scenario
  WHERE scenario ->> 'status' = 'active';
  v_run := public.ari_admin_finish_evaluation(
    (v_run ->> 'id')::uuid, v_results, 'Record the complete deterministic result'
  );
  IF v_run ->> 'status' <> 'passed'
     OR (v_run #>> '{summary,total}')::integer <> jsonb_array_length(v_results) THEN
    RAISE EXCEPTION 'complete evaluation did not pass: %', v_run;
  END IF;
  v_proposal := public.ari_admin_transition_improvement_proposal(
    (v_proposal ->> 'id')::uuid, 'approved_for_rollout', 'Approve bounded local pilot after the passing suite'
  );
  v_rollout := public.ari_admin_control_rollout(
    'create_pilot', NULL, (v_version ->> 'id')::uuid, 5,
    '{"brands":["harmattan","lantern-room"]}',
    '{"max_error_rate":0.02,"rollback_on_regression":true}',
    (SELECT id FROM t3355_ids WHERE key = 'baseline'),
    'Begin a five-percent reversible pilot'
  );
  v_rollout := public.ari_admin_control_rollout(
    'expand', (v_rollout ->> 'id')::uuid, NULL, 25, '{}', '{}', NULL,
    'Expand after monitored local evidence'
  );
  v_rollout := public.ari_admin_control_rollout(
    'pause', (v_rollout ->> 'id')::uuid, NULL, NULL, '{}', '{}', NULL,
    'Pause to prove the kill switch'
  );
  v_rollout := public.ari_admin_control_rollout(
    'rollback', (v_rollout ->> 'id')::uuid, NULL, NULL, '{}', '{}', NULL,
    'Rollback to the known-good baseline'
  );
  IF v_rollout ->> 'status' <> 'rolled_back' OR (v_rollout ->> 'rollout_percent')::integer <> 0 THEN
    RAISE EXCEPTION 'rollback was not immediate and complete: %', v_rollout;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      public.ari_admin_improvement_workspace(100) -> 'access_audit'
    ) audit
    WHERE audit ->> 'action' = 'rollout_change'
      AND audit #>> '{metadata,action}' = 'rollback'
  ) THEN RAISE EXCEPTION 'rollout change was not audited'; END IF;
END
$admin_lifecycle$;

RESET ROLE;

DO $scenario_seed$
DECLARE
  v_product integer;
  v_mechanics integer;
  v_research_regression integer;
BEGIN
  SELECT count(*) FILTER (WHERE 'product' = ANY(tags)),
         count(*) FILTER (WHERE 'mechanics' = ANY(tags)),
         count(*) FILTER (WHERE 'research' = ANY(tags) AND 'regression' = ANY(tags))
    INTO v_product, v_mechanics, v_research_regression
  FROM public.ari_evaluation_scenarios;
  IF v_product <> 57 OR v_mechanics <> 13 OR v_research_regression <> 1 THEN
    RAISE EXCEPTION 'scenario seed is incomplete: product=%, mechanics=%, research_regressions=%',
      v_product, v_mechanics, v_research_regression;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ari_evaluation_scenarios
    WHERE input_fixture ->> 'fixture_kind' NOT IN (
      'synthetic_private-safe', 'mechanics'
    )
  ) THEN
    RAISE EXCEPTION 'scenario seed contains a non-private-safe fixture';
  END IF;
END
$scenario_seed$;

DELETE FROM public.agent_conversations
WHERE id = (SELECT id FROM t3355_ids WHERE key = 'conversation');

DO $retention$
DECLARE
  v_turn public.ari_training_turns%ROWTYPE;
  v_case public.ari_quality_cases%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_turn FROM public.ari_training_turns
  WHERE id = (SELECT id FROM t3355_ids WHERE key = 'training');
  IF v_turn.source_user_id IS NOT NULL OR v_turn.source_conversation_id IS NOT NULL
     OR v_turn.source_user_message_id IS NOT NULL OR v_turn.source_assistant_message_id IS NOT NULL
     OR v_turn.source_deleted_at IS NULL THEN
    RAISE EXCEPTION 'training turn retained reversible source links after chat deletion';
  END IF;
  IF v_turn.archive_conversation_key IS DISTINCT FROM
     (SELECT id FROM t3355_ids WHERE key = 'conversation') THEN
    RAISE EXCEPTION 'sanitized archive lost its pseudonymous thread grouping';
  END IF;
  SELECT * INTO STRICT v_case FROM public.ari_quality_cases
  WHERE training_turn_id = v_turn.id;
  IF v_case.source_user_id IS NOT NULL OR v_case.source_conversation_id IS NOT NULL
     OR v_case.retention_state <> 'source_deleted' THEN
    RAISE EXCEPTION 'quality case retained source identity after chat deletion';
  END IF;
  IF v_turn.sanitized_user_text <> '[email removed] wants an event' THEN
    RAISE EXCEPTION 'sanitized training asset did not survive deletion';
  END IF;
END
$retention$;

SELECT 'issue_3355_ari_10x: grants, visible phases, CAS, memory, durable jobs, admin guard, retention PASS' AS result;
ROLLBACK;
