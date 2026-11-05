-- MINGLA-INVARIANT: I-ARI-FLOW-ENGINE-OWNS-PROGRESS | issue #2830 | Takeover never marks a step done and never writes evidence; it only resets a parked current step to pending.
--
-- Issue #2830 — takeover, one status, not-applicable, research limit.
-- Reverting any function body below makes a block raise.

\set ON_ERROR_STOP on
BEGIN;

DO $i2830$
DECLARE
  v_owner uuid := '28300000-0000-4000-8000-0000000000a1';
  v_admin uuid := '28300000-0000-4000-8000-0000000000a2';
  v_events uuid := '28300000-0000-4000-8000-0000000000a3';
  v_other_owner uuid := '28300000-0000-4000-8000-0000000000a4';
  v_brand uuid := '28300000-0000-4000-8000-0000000000b1';
  v_brand2 uuid := '28300000-0000-4000-8000-0000000000b2';
  v_admin_chat uuid := '28300000-0000-4000-8000-0000000000c1';
  v_owner_chat uuid := '28300000-0000-4000-8000-0000000000c2';
  v_owner_chat2 uuid := '28300000-0000-4000-8000-0000000000c3';
  v_foreign_chat uuid := '28300000-0000-4000-8000-0000000000c4';
  v_r jsonb;
  v_run uuid;
  v_rev integer;
  v_failed text;
  v_tok uuid := gen_random_uuid();
  v_pending uuid;
  v_status jsonb;
  v_part jsonb;
  v_audit jsonb;
  v_rev_text text;
  v_count integer;
BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    (v_owner,'owner-2830@example.invalid','{"full_name":"Olu Owner"}'),
    (v_admin,'admin-2830@example.invalid','{"full_name":"Info Admin"}'),
    (v_events,'events-2830@example.invalid','{"full_name":"Eve Events"}'),
    (v_other_owner,'other-2830@example.invalid','{"full_name":"Other Owner"}');
  INSERT INTO public.creator_accounts(id,created_at,updated_at) VALUES
    (v_owner,now(),now()),(v_other_owner,now(),now());
  INSERT INTO public.brands(id,account_id,name,slug,default_currency) VALUES
    (v_brand,v_owner,'Lantern Room','lantern-2830','GBP'),
    (v_brand2,v_other_owner,'Other Room','other-2830','GBP');
  INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
    (v_brand,v_admin,'brand_admin',now()),
    (v_brand,v_events,'event_manager',now());
  INSERT INTO public.agent_conversations(id,user_id,brand_id) VALUES
    (v_admin_chat,v_admin,v_brand),(v_owner_chat,v_owner,v_brand),
    (v_owner_chat2,v_owner,v_brand),(v_foreign_chat,v_other_owner,v_brand2);

  -- T-TAKE-14: clients reach nothing.
  IF has_function_privilege('authenticated','public.ari_flow_run_take_over(uuid,uuid,uuid,integer,text)','EXECUTE')
    OR has_function_privilege('anon','public.ari_flow_run_take_over(uuid,uuid,uuid,integer,text)','EXECUTE')
    OR has_function_privilege('authenticated','public.ari_flow_brand_run_get(uuid,uuid,text)','EXECUTE')
    OR has_function_privilege('authenticated','public.ari_flow_run_displacement_get(uuid,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.ari_flow_run_displacement_mark(uuid,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.ari_brand_research_claim(uuid,uuid,text)','EXECUTE')
    OR has_function_privilege('authenticated','public.ari_brand_research_finish(uuid,text,jsonb,text)','EXECUTE')
    OR has_table_privilege('authenticated','public.ari_flow_run_takeovers','SELECT')
    OR has_table_privilege('authenticated','public.ari_brand_setup_research','SELECT') THEN
    RAISE EXCEPTION 'T-TAKE-14: takeover and research must be service-role only';
  END IF;

  -- Admin starts, answers one thing.
  v_r := public.ari_flow_run_start(v_admin,v_brand,'website_setup',1,'one_per_brand',v_admin_chat,NULL,
    '{"seed":{"value":"kept","source":"owner"}}');
  v_run := (v_r->'run'->>'id')::uuid;
  v_r := public.ari_flow_run_lease(v_run,v_admin,v_tok,30);
  v_r := public.ari_flow_run_advance(v_run,v_tok,1,jsonb_build_object(
    'status','awaiting_owner','current_step_key','brand',
    'session_skips',jsonb_build_array('website:theme'),
    'step_states',jsonb_build_object(
      'offer',jsonb_build_object('state','done','evidence',jsonb_build_object('probe','site_plan','observed',true)),
      'brand',jsonb_build_object('state','asked','data',jsonb_build_object('field_key','contact_email')))));
  PERFORM public.ari_flow_run_release(v_run,v_tok);
  v_rev := (v_r->>'revision')::int;

  -- T-IDLE-1: 29 min not stopped, 31 min stopped, a lease resets it.
  UPDATE public.ari_flow_runs SET updated_at = now() - interval '29 minutes',
    last_lease_at = now() - interval '29 minutes' WHERE id = v_run;
  v_r := public.ari_flow_run_get(v_owner,v_run,NULL);
  IF (v_r->>'stopped')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'T-IDLE-1: 29 min is not stopped: %', v_r; END IF;

  -- T-TAKE-2: an active run refuses "continue".
  v_failed := NULL;
  BEGIN
    PERFORM public.ari_flow_run_take_over(v_owner,v_run,NULL,v_rev,'continue');
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_failed := SQLERRM;
  END;
  IF v_failed IS DISTINCT FROM 'flow_run_active' THEN RAISE EXCEPTION 'T-TAKE-2: got %', v_failed; END IF;

  UPDATE public.ari_flow_runs SET updated_at = now() - interval '31 minutes',
    last_lease_at = now() - interval '31 minutes' WHERE id = v_run;
  v_r := public.ari_flow_run_get(v_owner,v_run,NULL);
  IF (v_r->>'stopped')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'T-IDLE-1: 31 min is stopped: %', v_r; END IF;
  v_tok := gen_random_uuid();
  PERFORM public.ari_flow_run_lease(v_run,v_admin,v_tok,30);
  v_r := public.ari_flow_run_get(v_owner,v_run,NULL);
  IF (v_r->>'stopped')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'T-IDLE-1: a lease is activity: %', v_r; END IF;

  -- T-TAKE-6: live lease.
  v_failed := NULL;
  BEGIN
    PERFORM public.ari_flow_run_take_over(v_owner,v_run,NULL,v_rev,'take_over');
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_failed := SQLERRM;
  END;
  IF v_failed IS DISTINCT FROM 'flow_run_busy' THEN RAISE EXCEPTION 'T-TAKE-6 lease: got %', v_failed; END IF;
  PERFORM public.ari_flow_run_release(v_run,v_tok);

  -- T-TAKE-6: executing proposal.
  INSERT INTO public.agent_pending_actions(user_id,conversation_id,tool_name,tool_args,status)
  VALUES (v_admin,v_admin_chat,'update_brand_context','{}','executing') RETURNING id INTO v_pending;
  v_failed := NULL;
  BEGIN
    PERFORM public.ari_flow_run_take_over(v_owner,v_run,NULL,v_rev,'take_over');
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_failed := SQLERRM;
  END;
  IF v_failed IS DISTINCT FROM 'flow_run_busy' THEN RAISE EXCEPTION 'T-TAKE-6 executing: got %', v_failed; END IF;
  UPDATE public.agent_pending_actions SET status='failed' WHERE id = v_pending;

  -- T-TAKE-4: rank 40.
  v_failed := NULL;
  BEGIN
    PERFORM public.ari_flow_run_take_over(v_events,v_run,NULL,v_rev,'take_over');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := 'refused';
  END;
  IF v_failed IS NULL THEN RAISE EXCEPTION 'T-TAKE-4: rank 40 must be refused'; END IF;

  -- T-TAKE-5: stale revision is PT409, never 40001.
  v_failed := NULL;
  BEGIN
    PERFORM public.ari_flow_run_take_over(v_owner,v_run,NULL,v_rev + 99,'take_over');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLSTATE || ':' || SQLERRM;
  END;
  IF v_failed IS DISTINCT FROM 'PT409:flow_revision_conflict' THEN RAISE EXCEPTION 'T-TAKE-5: got %', v_failed; END IF;

  -- T-TAKE-8: someone else's chat, another brand's.
  v_failed := NULL;
  BEGIN
    PERFORM public.ari_flow_run_take_over(v_owner,v_run,v_admin_chat,v_rev,'take_over');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := 'refused';
  END;
  IF v_failed IS NULL THEN RAISE EXCEPTION 'T-TAKE-8: another person''s chat'; END IF;
  v_failed := NULL;
  BEGIN
    PERFORM public.ari_flow_run_take_over(v_owner,v_run,v_foreign_chat,v_rev,'take_over');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := 'refused';
  END;
  IF v_failed IS NULL THEN RAISE EXCEPTION 'T-TAKE-8: another brand''s chat'; END IF;

  -- T-TAKE-1, T-TAKE-7, T-TAKE-9, T-TAKE-10: a stopped run, continued by the owner.
  INSERT INTO public.agent_pending_actions(user_id,conversation_id,tool_name,tool_args,status)
  VALUES (v_admin,v_admin_chat,'update_brand_context','{}','pending') RETURNING id INTO v_pending;
  -- The owner's chat already holds another live run.
  PERFORM public.ari_flow_run_start(v_owner,v_brand,'create_event',1,'one_per_subject',v_owner_chat,NULL,'{}');
  -- Parked on a delegated step in the old chat.
  UPDATE public.ari_flow_runs
  SET current_step_key='brand',
      step_states = step_states || jsonb_build_object('brand',jsonb_build_object(
        'state','delegated','data',jsonb_build_object('field_key','contact_email','request','Create an event'))),
      updated_at = now() - interval '2 hours', last_lease_at = now() - interval '2 hours'
  WHERE id = v_run RETURNING revision INTO v_rev;
  v_r := public.ari_flow_run_take_over(v_owner,v_run,v_owner_chat,v_rev,'continue');
  IF (v_r->>'changed')::boolean IS NOT TRUE OR v_r->>'kind' <> 'continued_stopped' THEN
    RAISE EXCEPTION 'T-TAKE-1: %', v_r;
  END IF;
  IF (v_r->'run'->>'started_by_me')::boolean IS NOT TRUE
    OR v_r->'run'->>'conversation_id' <> v_owner_chat::text
    OR v_r->'run'->'answers'->'seed'->>'value' <> 'kept'
    OR NOT (v_r->'run'->'session_skips' ? 'website:theme') THEN
    RAISE EXCEPTION 'T-TAKE-1: owner, chat, answers and skips: %', v_r;
  END IF;
  IF v_r->'run'->'step_states'->'brand'->>'state' <> 'pending'
    OR v_r->'run'->'step_states'->'brand'->'data' ? 'request'
    OR v_r->'run'->'step_states'->'offer'->>'state' <> 'done' THEN
    RAISE EXCEPTION 'T-TAKE-10: only the parked current step resets: %', v_r->'run'->'step_states';
  END IF;
  SELECT count(*) INTO v_count FROM public.ari_flow_run_takeovers WHERE run_id = v_run;
  IF v_count <> 1 THEN RAISE EXCEPTION 'T-TAKE-1: one takeover row, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.brand_site_audit_log
  WHERE brand_id = v_brand AND action = 'plan.taken_over' AND metadata->>'reason_code' = 'ari_flow_continued';
  IF v_count <> 1 THEN RAISE EXCEPTION 'T-TAKE-1: one audit row, got %', v_count; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_site_plans
    WHERE brand_id = v_brand AND lock_holder = v_owner AND lock_expires_at > now()) THEN
    RAISE EXCEPTION 'T-TAKE-1: the caller takes the plan lock';
  END IF;
  IF (SELECT status FROM public.agent_pending_actions WHERE id = v_pending) <> 'superseded'
    OR (SELECT failure_reason FROM public.agent_pending_actions WHERE id = v_pending) <> 'flow_taken_over' THEN
    RAISE EXCEPTION 'T-TAKE-7: the old chat''s proposal is superseded';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ari_flow_runs
    WHERE flow_key = 'create_event' AND brand_id = v_brand
      AND status IN ('active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked')) THEN
    RAISE EXCEPTION 'T-TAKE-9: the chat''s other live run must be cancelled';
  END IF;

  -- T-TAKE-15: the old starter can no longer work on it.
  v_r := public.ari_flow_run_lease(v_run,v_admin,gen_random_uuid(),30);
  IF v_r->>'reason' <> 'owned_by_other' THEN RAISE EXCEPTION 'T-TAKE-15: %', v_r; END IF;

  -- T-TAKE-12: same owner twice is a no-op.
  v_rev := (public.ari_flow_run_get(v_owner,v_run,NULL)->>'revision')::int;
  v_r := public.ari_flow_run_take_over(v_owner,v_run,v_owner_chat,v_rev,'take_over');
  IF (v_r->>'changed')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'T-TAKE-12: %', v_r; END IF;
  SELECT count(*) INTO v_count FROM public.ari_flow_run_takeovers WHERE run_id = v_run;
  IF v_count <> 1 THEN RAISE EXCEPTION 'T-TAKE-12: still one row, got %', v_count; END IF;

  -- Displacement: the old person's chat sees why.
  v_r := public.ari_flow_run_displacement_get(v_admin,v_admin_chat);
  IF v_r->>'to_name' <> 'Olu Owner' OR v_r->>'notified_at' IS NOT NULL THEN RAISE EXCEPTION 'displacement: %', v_r; END IF;
  IF public.ari_flow_run_displacement_get(v_owner,v_admin_chat) IS NOT NULL THEN
    RAISE EXCEPTION 'displacement belongs only to the displaced person';
  END IF;
  PERFORM public.ari_flow_run_displacement_mark((v_r->>'id')::uuid, v_admin);
  IF (public.ari_flow_run_displacement_get(v_admin,v_admin_chat))->>'notified_at' IS NULL THEN
    RAISE EXCEPTION 'displacement mark';
  END IF;

  -- brand_run_get.
  v_r := public.ari_flow_brand_run_get(v_admin,v_brand,'website_setup');
  IF (v_r->>'can_take_over')::boolean IS NOT TRUE OR v_r->'last_takeover'->>'to_name' <> 'Olu Owner' THEN
    RAISE EXCEPTION 'brand_run_get: %', v_r;
  END IF;
  IF (public.ari_flow_brand_run_get(v_events,v_brand,'website_setup')->>'can_take_over')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'brand_run_get: rank 40 cannot take over';
  END IF;

  -- T-TAKE-3: an active run taken with the warning.
  v_rev := (public.ari_flow_run_get(v_admin,v_run,NULL)->>'revision')::int;
  v_r := public.ari_flow_run_take_over(v_admin,v_run,NULL,v_rev,'take_over');
  IF v_r->>'kind' <> 'took_over_active' THEN RAISE EXCEPTION 'T-TAKE-3: %', v_r; END IF;
  IF v_r->'run'->>'conversation_id' IS NOT NULL THEN RAISE EXCEPTION 'T-TAKE-3: a by-hand takeover has no chat: %', v_r; END IF;

  -- T-START-1: own run, no chat: start attaches the chat asking now.
  v_r := public.ari_flow_run_start(v_admin,v_brand,'website_setup',1,'one_per_brand',v_admin_chat,NULL,'{}');
  IF v_r->'run'->>'conversation_id' <> v_admin_chat::text OR (v_r->>'created')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'T-START-1: %', v_r;
  END IF;

  -- T-TAKE-11: a per-subject run.
  v_r := public.ari_flow_run_start(v_owner,v_brand,'create_event',1,'one_per_subject',v_owner_chat2,NULL,'{}');
  v_failed := NULL;
  BEGIN
    PERFORM public.ari_flow_run_take_over(v_admin,(v_r->'run'->>'id')::uuid,NULL,(v_r->'run'->>'revision')::int,'take_over');
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := SQLERRM;
  END;
  IF v_failed IS DISTINCT FROM 'flow_takeover_invalid' THEN RAISE EXCEPTION 'T-TAKE-11: got %', v_failed; END IF;

  -- T-TAKE-13: a suspended site pauses takeover.
  INSERT INTO public.brand_sites(brand_id,status,created_by,payload_tenant_id,suspended_at,suspension_reason_code)
  VALUES (v_brand,'suspended',v_owner,gen_random_uuid(),now(),'policy');
  v_rev := (public.ari_flow_run_get(v_owner,v_run,NULL)->>'revision')::int;
  v_failed := NULL;
  BEGIN
    PERFORM public.ari_flow_run_take_over(v_owner,v_run,NULL,v_rev,'take_over');
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_failed := SQLERRM;
  END;
  IF v_failed IS DISTINCT FROM 'flow_brand_paused' THEN RAISE EXCEPTION 'T-TAKE-13: got %', v_failed; END IF;
  DELETE FROM public.brand_sites WHERE brand_id = v_brand;

  -- ── One status ───────────────────────────────────────────────────────────
  UPDATE public.brands SET description = 'Evenings planned for you' WHERE id = v_brand;
  v_status := public.brand_site_setup_status_internal(v_brand);
  SELECT value INTO v_part FROM jsonb_array_elements(v_status->'parts') WHERE value->>'key' = 'brand';
  -- T-STAT-1: the plan's old tick is true (name + description) and the new one is not.
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.brand_site_plan_status_internal(v_brand)->'parts') p
    WHERE p.value->>'key' = 'brand' AND (p.value->>'done')::boolean) THEN
    RAISE EXCEPTION 'T-STAT-1: the old status must stay unchanged';
  END IF;
  IF (v_part->>'done')::boolean IS NOT FALSE OR NOT (v_part->'open_fields' ? 'contact_email')
    OR (v_part->>'field_count')::int < 3 THEN
    RAISE EXCEPTION 'T-STAT-1: an open field means no tick: %', v_part;
  END IF;
  IF (v_status->>'total')::int <> 8 THEN RAISE EXCEPTION 'T-STAT: total: %', v_status; END IF;

  -- T-STAT-3: skipped first offering reads skipped, not done; a skipped look with no design stays open.
  UPDATE public.brand_site_plans SET skipped_parts = ARRAY['first_offering','look'],
    offerings_selected = ARRAY['events'] WHERE brand_id = v_brand;
  v_status := public.brand_site_setup_status_internal(v_brand);
  SELECT value INTO v_part FROM jsonb_array_elements(v_status->'parts') WHERE value->>'key' = 'first_offering';
  IF (v_part->>'skipped')::boolean IS NOT TRUE OR (v_part->>'done')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'T-STAT-3: skipped: %', v_part;
  END IF;
  SELECT value INTO v_part FROM jsonb_array_elements(v_status->'parts') WHERE value->>'key' = 'look';
  IF (v_part->>'done')::boolean IS NOT FALSE OR (v_part->>'skipped')::boolean IS NOT FALSE
    OR NOT (v_part->'open_fields' ? 'design_key') THEN
    RAISE EXCEPTION 'T-STAT-3: a skipped look with no design is open: %', v_part;
  END IF;

  -- T-STAT-6: found on production. Provision worked and compose never ran: a
  -- draft site with built_at null is not built, whatever the site's status says.
  INSERT INTO public.brand_sites(brand_id,status,created_by,payload_tenant_id)
  VALUES (v_brand,'draft',v_owner,gen_random_uuid()::text);
  UPDATE public.brand_site_plans SET built_at = NULL, built_pages = NULL WHERE brand_id = v_brand;
  SELECT value INTO v_part FROM jsonb_array_elements(public.brand_site_setup_status_internal(v_brand)->'parts')
  WHERE value->>'key' = 'build';
  IF (v_part->>'done')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'T-STAT-6: no compose means no build tick: %', v_part;
  END IF;
  DELETE FROM public.brand_sites WHERE brand_id = v_brand;

  -- T-STAT-2: a published site reads done everywhere, gaps or not.
  -- The publication FK is deferred and this block rolls back, so no row is needed.
  INSERT INTO public.brand_sites(brand_id,status,created_by,payload_tenant_id,last_successful_publication_id)
  VALUES (v_brand,'draft',v_owner,gen_random_uuid(),gen_random_uuid());
  v_status := public.brand_site_setup_status_internal(v_brand);
  IF (v_status->>'done_count')::int <> 8 OR v_status->>'next_part' IS NOT NULL
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_status->'parts') p
      WHERE jsonb_array_length(p.value->'open_fields') > 0) THEN
    RAISE EXCEPTION 'T-STAT-2: %', v_status;
  END IF;
  DELETE FROM public.brand_sites WHERE brand_id = v_brand;

  -- ── Not applicable ──────────────────────────────────────────────────────
  UPDATE public.brand_site_plans SET lock_holder = NULL, lock_expires_at = NULL WHERE brand_id = v_brand;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_rev_text := public.brand_context_revision(v_brand);
  -- T-NA: a required field is refused.
  v_failed := NULL;
  BEGIN
    PERFORM public.brand_context_mark_not_applicable(v_brand,'name',v_rev_text);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := SQLERRM;
  END;
  IF v_failed IS DISTINCT FROM 'invalid_exception' THEN RAISE EXCEPTION 'T-NA name: got %', v_failed; END IF;
  -- T-NA: stale context is PT409.
  v_failed := NULL;
  BEGIN
    PERFORM public.brand_context_mark_not_applicable(v_brand,'contact_email',repeat('0',64));
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_failed := SQLERRM;
  END;
  IF v_failed IS DISTINCT FROM 'sites_revision_conflict' THEN RAISE EXCEPTION 'T-NA stale: got %', v_failed; END IF;
  -- T-NA: lock held by another.
  UPDATE public.brand_site_plans SET lock_holder = v_admin, lock_expires_at = now() + interval '5 minutes' WHERE brand_id = v_brand;
  v_failed := NULL;
  BEGIN
    PERFORM public.brand_context_mark_not_applicable(v_brand,'contact_email',v_rev_text);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM;
  END;
  IF v_failed IS DISTINCT FROM 'sites_plan_locked' THEN RAISE EXCEPTION 'T-NA lock: got %', v_failed; END IF;
  UPDATE public.brand_site_plans SET lock_holder = NULL, lock_expires_at = NULL WHERE brand_id = v_brand;
  -- T-NA: a recommended key settles and drops the count.
  v_audit := public.brand_context_mark_not_applicable(v_brand,'contact_email',v_rev_text);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_audit->'fields') f
    WHERE f->>'key' = 'contact_email' AND f->>'state' = 'not_applicable') THEN
    RAISE EXCEPTION 'T-NA: contact_email settles: %', v_audit;
  END IF;
  SELECT value INTO v_part FROM jsonb_array_elements(public.brand_site_setup_status_internal(v_brand)->'parts')
  WHERE value->>'key' = 'brand';
  IF v_part->'open_fields' ? 'contact_email' THEN RAISE EXCEPTION 'T-NA: the count drops: %', v_part; END IF;
  -- T-NA: rank 40 is refused.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',v_events)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_events::text, true);
  v_failed := NULL;
  BEGIN
    PERFORM public.brand_context_mark_not_applicable(v_brand,'address',public.brand_context_revision(v_brand));
  EXCEPTION WHEN insufficient_privilege THEN v_failed := 'refused';
  END;
  IF v_failed IS NULL THEN RAISE EXCEPTION 'T-NA: rank 40 must be refused'; END IF;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- ── Research limit ──────────────────────────────────────────────────────
  -- Permission refusal.
  v_failed := NULL;
  BEGIN
    PERFORM public.ari_brand_research_claim(v_events,v_brand);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := 'refused';
  END;
  IF v_failed IS NULL THEN RAISE EXCEPTION 'research: rank 40 must be refused'; END IF;
  -- First call may search.
  v_r := public.ari_brand_research_claim(v_owner,v_brand);
  IF (v_r->>'allowed')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'research claim 1: %', v_r; END IF;
  -- In flight: no second search.
  v_r := public.ari_brand_research_claim(v_admin,v_brand);
  IF (v_r->>'allowed')::boolean IS NOT FALSE OR v_r->>'status' <> 'running' THEN RAISE EXCEPTION 'research in flight: %', v_r; END IF;
  -- Provider down: exactly one retry, then never again.
  PERFORM public.ari_brand_research_finish(v_brand,'unavailable','{}');
  v_r := public.ari_brand_research_claim(v_owner,v_brand);
  IF (v_r->>'allowed')::boolean IS NOT TRUE OR (v_r->>'attempts')::int <> 2 THEN RAISE EXCEPTION 'research retry: %', v_r; END IF;
  PERFORM public.ari_brand_research_finish(v_brand,'unavailable','{}');
  v_r := public.ari_brand_research_claim(v_owner,v_brand);
  IF (v_r->>'allowed')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'research limit: %', v_r; END IF;
  -- Cache hit: a found result is served without a search, to any editor.
  UPDATE public.ari_brand_setup_research SET status = 'running', attempts = 1 WHERE brand_id = v_brand;
  PERFORM public.ari_brand_research_finish(v_brand,'found','{"contact_email":[{"value":"a@b.co"}]}');
  v_r := public.ari_brand_research_claim(v_admin,v_brand);
  IF (v_r->>'allowed')::boolean IS NOT FALSE OR v_r->>'status' <> 'found'
    OR v_r->'candidates'->'contact_email'->0->>'value' <> 'a@b.co' THEN
    RAISE EXCEPTION 'research cache hit: %', v_r;
  END IF;
  -- A rename: the old result is cleared, an unconfirmed finding goes, one new search.
  UPDATE public.ari_brand_setup_research SET identity = 'lantern room|lagos' WHERE brand_id = v_brand;
  INSERT INTO public.brand_context_field_evidence(brand_id,field_key,disposition,source_type,source_ref,source_url,evidence_candidates)
  VALUES (v_brand,'contact_phone','stale','public_research','research:x','https://x.example/','[]');
  v_r := public.ari_brand_research_claim(v_owner,v_brand,'lantern room|lagos');
  IF (v_r->>'allowed')::boolean IS NOT FALSE OR v_r->>'status' <> 'found' THEN RAISE EXCEPTION 'same identity is a cache hit: %', v_r; END IF;
  v_r := public.ari_brand_research_claim(v_owner,v_brand,'new name|lagos');
  IF (v_r->>'allowed')::boolean IS NOT TRUE OR (v_r->>'cleared')::boolean IS NOT TRUE OR v_r->'candidates' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'a rename must clear and search again: %', v_r;
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_context_field_evidence WHERE brand_id = v_brand AND field_key = 'contact_phone') THEN
    RAISE EXCEPTION 'a rename must drop unconfirmed findings';
  END IF;
  -- A search that finishes for the old name is dropped.
  IF public.ari_brand_research_finish(v_brand,'found','{"contact_email":[{"value":"old@b.co"}]}','lantern room|lagos') THEN
    RAISE EXCEPTION 'a late result for the old name was kept';
  END IF;
  -- At most 3 renames search; after that, cleared and no search.
  UPDATE public.ari_brand_setup_research SET identity_resets = 3 WHERE brand_id = v_brand;
  v_r := public.ari_brand_research_claim(v_owner,v_brand,'third name|lagos');
  IF (v_r->>'allowed')::boolean IS NOT FALSE OR (v_r->>'cleared')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'rename cap: %', v_r;
  END IF;
  -- One person, 25 searches a day across brands.
  DELETE FROM public.ari_brand_setup_research WHERE brand_id = v_brand;
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  SELECT gen_random_uuid(),v_other_owner,'Cap '||g,'cap-2830-'||g,'GBP' FROM generate_series(1,25) g;
  INSERT INTO public.ari_brand_setup_research(brand_id,status,started_by)
  SELECT id,'nothing',v_owner FROM public.brands WHERE slug LIKE 'cap-2830-%';
  v_r := public.ari_brand_research_claim(v_owner,v_brand);
  IF (v_r->>'allowed')::boolean IS NOT FALSE OR v_r->>'status' <> 'capped' THEN
    RAISE EXCEPTION 'daily cap: %', v_r;
  END IF;
  -- Public values stay untouched by all of that.
  IF (SELECT contact_email FROM public.brands WHERE id = v_brand) IS NOT NULL THEN
    RAISE EXCEPTION 'research must never write the brand';
  END IF;
END;
$i2830$;

ROLLBACK;
