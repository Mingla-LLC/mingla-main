-- MINGLA-INVARIANT: I-2830-CONTEXT-IS-SERVER-TRUTH | issue #2830 | Website setup completeness, provenance and initial provisioning eligibility are computed in Core; plan ticks and clients cannot award completion.
-- MINGLA-INVARIANT: I-2830-NO-DRAFT-BEFORE-SETUP | issue #2830 | Provisioning is refused until the first five plan parts and every required or recommended brand-context field are resolved.
-- MINGLA-INVARIANT: I-2830-PRE-DRAFT-DESIGN | issue #2830 | A revision-safe design choice lives on the shared setup plan before a brand_sites row exists.
-- MINGLA-INVARIANT: I-2830-CONTEXT-WRITES-RECEIPTED | issue #2830 | Ari brand-context writes require owner authority, plan-and-context compare-and-set, and one canonical operation receipt.

\set ON_ERROR_STOP on
BEGIN;

DO $i2830$
DECLARE
  v_owner uuid := '28300000-0000-4000-8000-000000000001';
  v_other uuid := '28300000-0000-4000-8000-000000000002';
  v_admin uuid := '28300000-0000-4000-8000-000000000003';
  v_brand uuid := '28300000-0000-4000-8000-000000000010';
  v_conversation uuid := '28300000-0000-4000-8000-000000000020';
  v_manifest jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_job_id uuid;
  v_context_revision text;
  v_operation_stale uuid := gen_random_uuid();
  v_operation_one uuid := gen_random_uuid();
  v_operation_two uuid := gen_random_uuid();
  v_failed boolean;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (v_owner,'owner-2830@example.invalid'),
    (v_other,'other-2830@example.invalid'),
    (v_admin,'admin-2830@example.invalid');
  INSERT INTO public.creator_accounts(id,created_at,updated_at)
  VALUES (v_owner,now(),now()),(v_other,now(),now());
  INSERT INTO public.admin_users(email,role,status,accepted_at)
  VALUES ('admin-2830@example.invalid','admin','active',now());
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES (v_brand,v_owner,'North Star','north-star-2830','USD');
  INSERT INTO public.agent_conversations(id,user_id,brand_id)
  VALUES (v_conversation,v_owner,v_brand);

  DELETE FROM public.brand_site_service_config;
  INSERT INTO public.brand_site_service_config(
    config_key,cms_origin,public_runtime_origin,public_host_suffix,
    configured_by,configured_at,updated_by,updated_at
  ) VALUES (
    'sites_v1','https://studio.sites.usemingla.com',
    'https://www.sites.usemingla.com','sites.usemingla.com',
    v_admin,now(),v_admin,now()
  );
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_admin)::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM public.brand_site_admin_grant(v_brand,'rollout',NULL);

  INSERT INTO public.brand_site_plans(
    brand_id,revision,offerings_selected,story,approved_plan,approved_at,
    approved_by,started_by,updated_by
  ) VALUES (
    v_brand,1,ARRAY[]::text[],
    '{"who":"Curious neighbours","why":"Owner-led gatherings","main_action":"Join the next event"}',
    '{"for":"Curious neighbours","main_action":"Join the next event","look":"Owner choice","pages":"Home · About · Contact","wont_do":"Invent claims"}',
    now(),v_owner,v_owner,v_owner
  );

  -- An incomplete brand has real plan ticks but is not Website-ready.
  v_manifest := public.brand_context_completeness_internal(v_brand);
  IF (v_manifest->>'required_gap_count')::integer < 2
    OR (v_manifest->>'recommended_gap_count')::integer < 5
    OR (v_manifest->>'failed_validation_count')::integer < 2
    OR (v_manifest->>'context_complete')::boolean THEN
    RAISE EXCEPTION 'empty context was awarded completion: %',v_manifest;
  END IF;
  IF v_manifest->>'context_revision' !~ '^[0-9a-f]{64}$'
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_manifest->'fields') field
      WHERE jsonb_typeof(field->'evidence_candidates') <> 'array'
    ) THEN
    RAISE EXCEPTION 'manifest context revision or evidence shape is unstable: %',v_manifest;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_manifest->'fields') field
    WHERE jsonb_array_length(field->'dependent_surfaces') = 0
      OR jsonb_array_length(field->'recheck_triggers') = 0
  ) THEN
    RAISE EXCEPTION 'canonical manifest omitted dependency or recheck metadata: %',v_manifest;
  END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner)::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_provision(v_brand,gen_random_uuid(),repeat('0',64),NULL);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM IN ('sites_plan_not_ready','sites_context_incomplete');
  END;
  IF NOT v_failed OR EXISTS (SELECT 1 FROM public.brand_sites WHERE brand_id=v_brand) THEN
    RAISE EXCEPTION 'direct provision bypassed incomplete setup';
  END IF;

  -- Design lives on the plan, creates no site and invalidates older approval.
  v_result := public.brand_site_plan_save_design(v_brand,1,'voyage','owner',NULL);
  IF v_result->'plan'->>'design_key' <> 'voyage'
    OR (v_result->'plan'->>'revision')::integer <> 2
    OR v_result->'plan'->>'approved_at' IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.brand_sites WHERE brand_id=v_brand) THEN
    RAISE EXCEPTION 'pre-draft design created a site or preserved stale approval: %',v_result;
  END IF;
  v_manifest := public.brand_context_completeness_internal(v_brand);
  IF (SELECT field->>'source_type' FROM jsonb_array_elements(v_manifest->'fields') field
      WHERE field->>'key'='design_key') <> 'owner'
    OR (SELECT field->>'owner_confirmed_at' FROM jsonb_array_elements(v_manifest->'fields') field
        WHERE field->>'key'='design_key') IS NULL THEN
    RAISE EXCEPTION 'design choice lost its owner provenance: %',v_manifest;
  END IF;

  -- Fill canonical values; recommended media are owner-provided HTTPS assets.
  UPDATE public.brands SET
    description='Owner-led gatherings for curious neighbours.',
    contact_email='hello@example.com',contact_phone='+12125550100',
    address='10 Orchard Street',city='Brooklyn',country_code='US',
    social_links='{"website":"https://example.com","instagram":"https://instagram.com/northstar"}',
    profile_photo_url='https://cdn.example.com/logo.png',
    cover_media_url='https://cdn.example.com/cover.jpg',cover_media_type='image',
    theme_color='#EA7825',theme_font='inter',theme_animation='none'
  WHERE id=v_brand;
  UPDATE public.brand_site_plans SET
    approved_plan='{"for":"Curious neighbours","main_action":"Join the next event","look":"Voyage","pages":"Home · About · Contact","wont_do":"Invent claims"}',
    approved_at=now(),approved_by=v_owner,lock_holder=NULL,lock_expires_at=NULL
  WHERE brand_id=v_brand;

  v_manifest := public.brand_context_completeness_internal(v_brand);
  IF NOT (v_manifest->>'context_complete')::boolean
    OR (v_manifest->>'gap_count')::integer <> 0
    OR (v_manifest->>'failed_validation_count')::integer <> 0
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_manifest->'validation_checks') check_item
      WHERE check_item->>'state'<>'pass') THEN
    RAISE EXCEPTION 'filled canonical context stayed incomplete: %',v_manifest;
  END IF;
  IF (SELECT field->>'source_ref' FROM jsonb_array_elements(v_manifest->'fields') field
      WHERE field->>'key'='name') IS NULL THEN
    RAISE EXCEPTION 'canonical Mingla value lost its provenance reference: %',v_manifest;
  END IF;

  -- A valid custom link satisfies the public-link field without a social account.
  UPDATE public.brands SET
    social_links='{}'::jsonb,
    custom_links='[{"label":"Book","url":"https://example.com/book"}]'::jsonb
  WHERE id=v_brand;
  v_manifest := public.brand_context_completeness_internal(v_brand);
  IF NOT (v_manifest->>'context_complete')::boolean THEN
    RAISE EXCEPTION 'valid custom link did not satisfy public links: %',v_manifest;
  END IF;
  UPDATE public.brands SET
    social_links='{"website":"https://example.com","instagram":"https://instagram.com/northstar"}'::jsonb,
    custom_links='[]'::jsonb
  WHERE id=v_brand;

  -- Read-only research can preserve conflicting candidates without changing
  -- the public value, then keep the field open when the selected evidence is stale.
  v_failed := false;
  BEGIN
    PERFORM public.ari_record_brand_context_finding(
      v_brand,'social_links','stale',jsonb_build_array(jsonb_build_object(
        'value',jsonb_build_object('unsafe','shape'),'source_type','public_research',
        'source_ref','Bad shape','source_url','https://example.com',
        'observed_at',now()::text,'confidence',0.8))
    );
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM='invalid_finding'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'non-string research candidate was accepted'; END IF;
  v_failed := false;
  BEGIN
    PERFORM public.ari_record_brand_context_finding(
      v_brand,'social_links','stale',jsonb_build_array(jsonb_build_object(
        'value','https://instagram.com/northstar','source_type','public_research',
        'source_ref','Future source','source_url','https://example.com',
        'observed_at',(now()+interval '1 day')::text,'confidence',0.8))
    );
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM='invalid_finding'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'future-dated research candidate was accepted'; END IF;
  v_result := public.ari_record_brand_context_finding(
    v_brand,'social_links','conflict',jsonb_build_array(
      jsonb_build_object(
        'value','https://instagram.com/northstar','source_type','mingla',
        'source_ref','brand:social_links','observed_at',now()::text,'confidence',1),
      jsonb_build_object(
        'value','https://instagram.com/northstarclub','source_type','public_research',
        'source_ref','Official contact page','source_url','https://example.com/contact',
        'observed_at',now()::text,'confidence',0.8)
    )
  );
  v_manifest := public.brand_context_completeness_internal(v_brand);
  IF (SELECT field->>'state' FROM jsonb_array_elements(v_manifest->'fields') field
      WHERE field->>'key'='social_links') <> 'conflict'
    OR jsonb_array_length((SELECT field->'evidence_candidates'
      FROM jsonb_array_elements(v_manifest->'fields') field
      WHERE field->>'key'='social_links')) <> 2 THEN
    RAISE EXCEPTION 'conflicting candidates were not preserved: %',v_manifest;
  END IF;
  v_result := public.ari_record_brand_context_finding(
    v_brand,'social_links','stale',jsonb_build_array(jsonb_build_object(
      'value','https://instagram.com/northstar','source_type','public_research',
      'source_ref','Official website','source_url','https://example.com',
      'observed_at',(now()-interval '181 days')::text,'confidence',0.9))
  );
  v_manifest := public.brand_context_completeness_internal(v_brand);
  IF (SELECT field->>'state' FROM jsonb_array_elements(v_manifest->'fields') field
      WHERE field->>'key'='social_links') <> 'stale'
    OR (v_manifest->>'context_complete')::boolean THEN
    RAISE EXCEPTION 'stale research did not reopen the gap: %',v_manifest;
  END IF;

  -- Fix all starts one durable job with evidence, blocked/human handoffs and
  -- a deterministic next action, then reuses it after the gaps are resolved.
  UPDATE public.brands SET profile_photo_url=NULL WHERE id=v_brand;
  v_result := public.ari_start_brand_completeness_job(v_brand);
  v_job_id := (v_result#>>'{job,id}')::uuid;
  IF NOT (v_result#>'{job,pending_step_keys}' ?& ARRAY['social_links','profile_photo'])
    OR NOT (v_result#>'{job,completed_step_keys}' ?& ARRAY['name','design_key','contact_email'])
    OR NOT (v_result#>'{job,checkpoint,human_action_step_keys}' ? 'profile_photo')
    OR NOT (v_result#>'{job,checkpoint,blocked_step_keys}' ? 'profile_photo')
    OR jsonb_array_length(v_result#>'{job,checkpoint,evidence}') < 10
    OR v_result#>>'{job,checkpoint,next_action,field_key}' <> 'social_links'
    OR v_result#>>'{job,checkpoint,next_action,kind}' <> 'refresh_evidence' THEN
    RAISE EXCEPTION 'durable job omitted authoritative checkpoint state: %',v_result;
  END IF;
  INSERT INTO public.ari_agent_jobs(
    user_id,brand_id,idempotency_key,goal_summary,status,checkpoint
  ) VALUES (
    v_other,v_brand,gen_random_uuid(),'Competing Website completion job','running',
    '{"kind":"brand_completeness"}'::jsonb
  );
  v_result := public.ari_start_brand_completeness_job(v_brand,false);
  IF NOT COALESCE((v_result->>'blocked_by_other_job')::boolean,false)
    OR COALESCE((v_result->>'takeover_available')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'competing Fix all job was not blocked: %',v_result;
  END IF;
  v_result := public.ari_start_brand_completeness_job(v_brand,true);
  IF (v_result#>>'{job,id}')::uuid <> v_job_id
    OR NOT COALESCE((v_result->>'resumed')::boolean,false)
    OR EXISTS (
      SELECT 1 FROM public.ari_agent_jobs
      WHERE brand_id=v_brand AND user_id=v_other AND status<>'cancelled'
    ) THEN
    RAISE EXCEPTION 'explicit Fix all takeover did not preserve one active owner: %',v_result;
  END IF;
  UPDATE public.brands SET profile_photo_url='https://cdn.example.com/logo.png' WHERE id=v_brand;
  -- Simulate the successful readback that follows the refresh step. The
  -- protected-write contract is exercised independently below; this assertion
  -- is about the resumable job re-reading canonical evidence rather than
  -- trusting its old checkpoint.
  UPDATE public.brand_context_field_evidence SET
    disposition='verified',evidence_candidates='[]'::jsonb,
    observed_at=now(),updated_at=now()
    WHERE brand_id=v_brand AND field_key='social_links';
  v_result := public.ari_start_brand_completeness_job(v_brand);
  IF (v_result#>>'{job,id}')::uuid <> v_job_id
    OR v_result#>>'{job,status}' <> 'completed'
    OR jsonb_array_length(v_result#>'{job,pending_step_keys}') <> 0
    OR NOT (v_result#>'{job,completed_step_keys}' ?&
      ARRAY['social_links','profile_photo','contact_phone'])
    OR v_result#>>'{job,checkpoint,next_action,kind}' <> 'fresh_terminal_read' THEN
    RAISE EXCEPTION 'Fix all did not resume and finish the same job: %',v_result;
  END IF;

  -- A recommended field may be resolved only by an explicit owner exception;
  -- changing a dependency reopens that exception until the owner reconfirms it.
  UPDATE public.brands SET contact_phone=NULL WHERE id=v_brand;
  v_manifest := public.brand_context_completeness_internal(v_brand);
  v_context_revision := v_manifest->>'context_revision';

  -- A manual or teammate edit changes context truth even when the plan revision
  -- stays put, so Ari must re-read instead of overwriting the newer value.
  UPDATE public.brands SET description='A teammate edited this story.' WHERE id=v_brand;
  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,tool_name,tool_args,status,source,related_brand_id,
    server_proposed_at,execution_attested_at
  ) VALUES (
    v_operation_stale,v_owner,v_conversation,'update_brand_context',jsonb_build_object(
      'brand_id',v_brand,'expected_plan_revision',2,
      'expected_context_revision',v_context_revision,
      'patch','{"name":"North Star"}'::jsonb,'exceptions','[]'::jsonb,
      'evidence','{"source_type":"owner"}'::jsonb),
    'executing','ari',v_brand,now(),now()
  );
  v_failed := false;
  BEGIN
    PERFORM public.ari_update_brand_context(
      v_operation_stale,v_brand,2,v_context_revision,
      '{"name":"North Star"}'::jsonb,'[]'::jsonb,
      '{"source_type":"owner"}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM='sites_context_revision_conflict';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'stale context revision overwrote a teammate edit'; END IF;
  UPDATE public.brands
  SET description='Owner-led gatherings for curious neighbours.'
  WHERE id=v_brand;
  v_manifest := public.brand_context_completeness_internal(v_brand);
  v_context_revision := v_manifest->>'context_revision';
  v_failed := false;
  BEGIN
    PERFORM public.ari_update_brand_context(
      gen_random_uuid(),v_brand,2,v_context_revision,
      '{"description":123}'::jsonb,'[]'::jsonb,
      '{"source_type":"owner"}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM='invalid_args'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'non-string context patch was accepted'; END IF;
  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,tool_name,tool_args,status,source,related_brand_id,
    server_proposed_at,execution_attested_at
  ) VALUES (
    v_operation_one,v_owner,v_conversation,'update_brand_context',jsonb_build_object(
      'brand_id',v_brand,'expected_plan_revision',2,
      'expected_context_revision',v_context_revision,'patch','{}'::jsonb,
      'exceptions','[{"field_key":"contact_phone","reason":"This brand accepts enquiries by email only."}]'::jsonb,
      'evidence','{"source_type":"owner"}'::jsonb),
    'executing','ari',v_brand,now(),now()
  );
  v_result := public.ari_update_brand_context(
    v_operation_one,v_brand,2,v_context_revision,'{}'::jsonb,
    '[{"field_key":"contact_phone","reason":"This brand accepts enquiries by email only."}]'::jsonb,
    '{"source_type":"owner"}'::jsonb
  );
  v_replay := public.ari_update_brand_context(
    v_operation_one,v_brand,2,v_context_revision,'{}'::jsonb,
    '[{"field_key":"contact_phone","reason":"This brand accepts enquiries by email only."}]'::jsonb,
    '{"source_type":"owner"}'::jsonb
  );
  IF v_replay IS DISTINCT FROM v_result THEN
    RAISE EXCEPTION 'confirmed context write did not replay its exact receipt';
  END IF;
  v_manifest := public.brand_context_completeness_internal(v_brand);
  IF NOT (v_manifest->>'context_complete')::boolean
    OR (SELECT field->>'state' FROM jsonb_array_elements(v_manifest->'fields') field
        WHERE field->>'key'='contact_phone') <> 'not_applicable' THEN
    RAISE EXCEPTION 'owner exception did not resolve the recommended field: %',v_manifest;
  END IF;
  UPDATE public.brands SET country_code='CA' WHERE id=v_brand;
  v_manifest := public.brand_context_completeness_internal(v_brand);
  v_context_revision := v_manifest->>'context_revision';
  IF (SELECT field->>'state' FROM jsonb_array_elements(v_manifest->'fields') field
      WHERE field->>'key'='contact_phone') <> 'stale'
    OR (v_manifest->>'context_complete')::boolean THEN
    RAISE EXCEPTION 'dependency change did not reopen owner exception: %',v_manifest;
  END IF;
  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,tool_name,tool_args,status,source,related_brand_id,
    server_proposed_at,execution_attested_at
  ) VALUES (
    v_operation_two,v_owner,v_conversation,'update_brand_context',jsonb_build_object(
      'brand_id',v_brand,'expected_plan_revision',3,
      'expected_context_revision',v_context_revision,'patch','{}'::jsonb,
      'exceptions','[{"field_key":"contact_phone","reason":"This Canadian brand still accepts enquiries by email only."}]'::jsonb,
      'evidence','{"source_type":"owner"}'::jsonb),
    'executing','ari',v_brand,now(),now()
  );
  v_result := public.ari_update_brand_context(
    v_operation_two,v_brand,3,v_context_revision,'{}'::jsonb,
    '[{"field_key":"contact_phone","reason":"This Canadian brand still accepts enquiries by email only."}]'::jsonb,
    '{"source_type":"owner"}'::jsonb
  );
  v_manifest := public.brand_context_completeness_internal(v_brand);
  IF NOT (v_manifest->>'context_complete')::boolean THEN
    RAISE EXCEPTION 'reconfirmed owner exception did not close the reopened gap: %',v_manifest;
  END IF;
  UPDATE public.brands SET contact_phone='+14165550100' WHERE id=v_brand;
  v_manifest := public.brand_context_completeness_internal(v_brand);
  IF (SELECT field->>'state' FROM jsonb_array_elements(v_manifest->'fields') field
      WHERE field->>'key'='contact_phone') <> 'verified'
    OR (SELECT field->>'source_type' FROM jsonb_array_elements(v_manifest->'fields') field
        WHERE field->>'key'='contact_phone') <> 'mingla'
    OR (SELECT field->>'exception_reason' FROM jsonb_array_elements(v_manifest->'fields') field
        WHERE field->>'key'='contact_phone') IS NOT NULL THEN
    RAISE EXCEPTION 'a current real value stayed masked by an older exception: %',v_manifest;
  END IF;
  UPDATE public.brands SET contact_phone=NULL WHERE id=v_brand;

  -- Provision authorization is the final server gate, not a client promise.
  v_result := public.brand_site_plan_authorize_provision(v_brand);
  IF v_result->>'design_key' <> 'voyage'
    OR NOT (v_result#>>'{context,context_complete}')::boolean THEN
    RAISE EXCEPTION 'complete setup could not authorize provision: %',v_result;
  END IF;
  v_result := public.brand_site_provision(v_brand,gen_random_uuid(),repeat('1',64),NULL);
  IF v_result->>'status' <> 'executing'
    OR NOT EXISTS (SELECT 1 FROM public.brand_sites WHERE brand_id=v_brand) THEN
    RAISE EXCEPTION 'complete setup could not cross the direct provision boundary: %',v_result;
  END IF;

  UPDATE public.brands SET description=NULL WHERE id=v_brand;
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_plan_authorize_provision(v_brand);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM IN ('sites_plan_not_ready','sites_context_incomplete');
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'incomplete setup authorized a first draft'; END IF;
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_provision(v_brand,gen_random_uuid(),repeat('2',64),NULL);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM IN ('sites_plan_not_ready','sites_context_incomplete');
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'direct provision accepted a newly reopened gap'; END IF;

  -- Cross-tenant reads and direct table access remain closed.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_other)::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_other::text,true);
  v_failed := false;
  BEGIN PERFORM public.brand_context_completeness(v_brand);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM='sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'another owner read brand context'; END IF;
  IF has_table_privilege('authenticated','public.brand_context_field_evidence','SELECT')
    OR has_table_privilege('authenticated','public.brand_site_plans','UPDATE') THEN
    RAISE EXCEPTION 'context or plan tables bypass their RPC boundary';
  END IF;
END;
$i2830$;

ROLLBACK;
