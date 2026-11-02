-- MINGLA-INVARIANT: I-ARI-FLOW-RUN-ADVANCE-NEEDS-EVIDENCE | issue #3355 | An Ari flow step becomes done, and a run completed, only through ari_flow_run_advance under a held lease with an evidence object (probe + observed); D-31: ari_manage_agent_job refuses "completed" without evidence references (edge guard: supabase/functions/_shared/__tests__/issue_3355_flow_engine.implementor.test.ts).
-- MINGLA-INVARIANT: I-ARI-FLOW-RUN-ONE-CURRENT-QUESTION | issue #3355 | A run has exactly one current question; only the edge runner moves it, and clients cannot read or write runs directly.
--
-- Issue #3355 P3 — durable Ari flow runs (implementor happy path + edges).
-- Pins, on the database clock:
--   * RLS: no client role can select or write runs, or call the functions;
--   * start returns the same live run for the same chat, one live run per chat
--     (a new flow cancels the older one), one live brand-wide run per brand
--     with "owned by someone else" for a teammate;
--   * lease: a second token is refused while the first is live (busy); after
--     the lease expires a second device continues; a teammate never leases a
--     run they did not start;
--   * advance: compare-and-swap on revision; refused without the lease; a done
--     step or a completed run without evidence is refused;
--   * D-31: ari_manage_agent_job "completed" needs evidence references.
-- Reverting any function body or constraint makes a block below raise.

\set ON_ERROR_STOP on
BEGIN;

DO $i3355fr$
DECLARE
  v_owner uuid := '33550000-0000-4000-8000-0000000003a1';
  v_mate uuid := '33550000-0000-4000-8000-0000000003a2';
  v_stranger uuid := '33550000-0000-4000-8000-0000000003a3';
  v_brand uuid := '33550000-0000-4000-8000-0000000003b1';
  v_chat uuid := '33550000-0000-4000-8000-0000000003c1';
  v_chat2 uuid := '33550000-0000-4000-8000-0000000003c2';
  v_mate_chat uuid := '33550000-0000-4000-8000-0000000003c3';
  v_tok_a uuid := gen_random_uuid();
  v_tok_b uuid := gen_random_uuid();
  v_r jsonb;
  v_run uuid;
  v_run2 uuid;
  v_site uuid;
  v_rev integer;
  v_failed boolean;
  v_text text;
  v_job jsonb;
BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    (v_owner,'owner-3355fr@example.invalid','{"full_name":"Ada Owner"}'),
    (v_mate,'mate-3355fr@example.invalid','{"full_name":"Sam Mate"}'),
    (v_stranger,'stranger-3355fr@example.invalid','{}');
  INSERT INTO public.creator_accounts(id,created_at,updated_at) VALUES (v_owner,now(),now());
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES (v_brand,v_owner,'Lantern Flow Club','lantern-3355fr','GBP');
  INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
  VALUES (v_brand,v_mate,'brand_admin',now());
  INSERT INTO public.agent_conversations(id,user_id,brand_id) VALUES
    (v_chat,v_owner,v_brand),(v_chat2,v_owner,v_brand),(v_mate_chat,v_mate,v_brand);

  -- ── Privilege: clients never touch runs ──────────────────────────────────
  IF has_table_privilege('authenticated','public.ari_flow_runs','SELECT')
     OR has_table_privilege('anon','public.ari_flow_runs','SELECT')
     OR has_table_privilege('authenticated','public.ari_flow_runs','UPDATE')
     OR has_function_privilege('authenticated','public.ari_flow_run_advance(uuid,uuid,integer,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.ari_flow_run_start(uuid,uuid,text,integer,text,uuid,uuid,jsonb)','EXECUTE')
     OR has_function_privilege('anon','public.ari_flow_run_get(uuid,uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.ari_flow_run_lease(uuid,uuid,uuid,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'flow runs must be service-role only';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class
          WHERE oid = 'public.ari_flow_runs'::regclass) THEN
    RAISE EXCEPTION 'ari_flow_runs must have forced RLS';
  END IF;

  -- ── Membership ───────────────────────────────────────────────────────────
  v_failed := false;
  BEGIN
    PERFORM public.ari_flow_run_start(v_stranger,v_brand,'create_event',1,'one_per_subject',NULL,NULL,'{}');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a non-member must not start a run'; END IF;
  v_failed := false;
  BEGIN
    PERFORM public.ari_flow_run_start(v_mate,v_brand,'create_event',1,'one_per_subject',v_chat,NULL,'{}');
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a run cannot bind to someone else''s chat'; END IF;

  -- ── Start / resume in one chat ───────────────────────────────────────────
  v_r := public.ari_flow_run_start(v_owner,v_brand,'create_event',1,'one_per_subject',v_chat,NULL,
    '{"intent_text":{"value":"Create an event","source":"owner"}}');
  IF (v_r->>'created')::boolean IS NOT TRUE OR v_r->'run'->>'status' <> 'active'
     OR (v_r->'run'->>'revision')::int <> 1 OR v_r->'run' ? 'lease_token' THEN
    RAISE EXCEPTION 'start must create an active run at revision 1 with no lease token exposed: %', v_r;
  END IF;
  v_run := (v_r->'run'->>'id')::uuid;
  v_r := public.ari_flow_run_start(v_owner,v_brand,'create_event',1,'one_per_subject',v_chat,NULL,'{}');
  IF (v_r->>'created')::boolean OR (v_r->'run'->>'id')::uuid <> v_run THEN
    RAISE EXCEPTION 'the same flow in the same chat resumes, never forks: %', v_r;
  END IF;

  -- ── Lease contention (database clock) ────────────────────────────────────
  v_r := public.ari_flow_run_lease(v_run,v_owner,v_tok_a,30);
  IF (v_r->>'ok')::boolean IS NOT TRUE OR (v_r->'run'->>'lease_held_by_me')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'first lease must be granted: %', v_r;
  END IF;
  v_r := public.ari_flow_run_lease(v_run,v_owner,v_tok_b,30);
  IF (v_r->>'ok')::boolean OR v_r->>'reason' <> 'busy' THEN
    RAISE EXCEPTION 'a second live request must get busy: %', v_r;
  END IF;
  v_r := public.ari_flow_run_lease(v_run,v_owner,v_tok_a,30);
  IF (v_r->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'the holder may renew its own lease: %', v_r;
  END IF;

  -- ── Advance: CAS, lease, evidence ────────────────────────────────────────
  v_failed := false;
  BEGIN
    PERFORM public.ari_flow_run_advance(v_run,v_tok_b,1,'{"status":"awaiting_owner"}');
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    GET STACKED DIAGNOSTICS v_text = MESSAGE_TEXT;
    v_failed := v_text = 'flow_lease_not_held';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'advance without the lease must be refused'; END IF;

  v_failed := false;
  BEGIN
    PERFORM public.ari_flow_run_advance(v_run,v_tok_a,1,
      '{"step_states":{"brand_blockers":{"state":"done"}}}');
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_text = MESSAGE_TEXT;
    v_failed := v_text = 'flow_evidence_required';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a done step without evidence must be refused'; END IF;

  v_failed := false;
  BEGIN
    PERFORM public.ari_flow_run_advance(v_run,v_tok_a,1,
      '{"step_states":{"brand_blockers":{"state":"done","evidence":{"probe":"brand_readiness"}}}}');
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'evidence must carry what was observed'; END IF;

  v_failed := false;
  BEGIN
    PERFORM public.ari_flow_run_advance(v_run,v_tok_a,1,'{"lease_owner":null}');
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a patch may not name lease or other private columns'; END IF;

  v_r := public.ari_flow_run_advance(v_run,v_tok_a,1, jsonb_build_object(
    'status','awaiting_owner',
    'current_step_key','brand_can_wait',
    'current_question_id','33550000-0000-4000-8000-0000000003d1',
    'current_artefact',jsonb_build_object('artefact_id','q:x','kind','question'),
    'step_states',jsonb_build_object(
      'brand_blockers',jsonb_build_object('state','done','evidence',
        jsonb_build_object('probe','brand_readiness','observed','[]'::jsonb)),
      'brand_can_wait',jsonb_build_object('state','asked'))));
  IF (v_r->>'revision')::int <> 2 OR v_r->>'current_question_id' <> '33550000-0000-4000-8000-0000000003d1'
     OR v_r->'step_states'->'brand_blockers'->>'state' <> 'done' THEN
    RAISE EXCEPTION 'evidence-backed advance must apply and bump the revision: %', v_r;
  END IF;

  v_failed := false;
  BEGIN
    PERFORM public.ari_flow_run_advance(v_run,v_tok_a,1,'{"status":"awaiting_owner"}');
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    GET STACKED DIAGNOSTICS v_text = MESSAGE_TEXT;
    v_failed := v_text = 'flow_revision_conflict';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a stale revision must be refused (CAS)'; END IF;

  v_failed := false;
  BEGIN
    PERFORM public.ari_flow_run_advance(v_run,v_tok_a,2,'{"status":"completed"}');
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_text = MESSAGE_TEXT;
    v_failed := v_text = 'flow_evidence_required';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'completed without evidence must be refused'; END IF;
  v_failed := false;
  BEGIN
    UPDATE public.ari_flow_runs SET status = 'completed' WHERE id = v_run;
  EXCEPTION WHEN check_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'the table itself must refuse a completed run without evidence'; END IF;

  -- Lease expiry lets a second device continue.
  UPDATE public.ari_flow_runs SET lease_expires_at = now() - interval '1 second' WHERE id = v_run;
  v_r := public.ari_flow_run_lease(v_run,v_owner,v_tok_b,30);
  IF (v_r->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'an expired lease must let a second device continue: %', v_r;
  END IF;
  v_failed := false;
  BEGIN
    PERFORM public.ari_flow_run_advance(v_run,v_tok_a,2,'{"status":"awaiting_owner"}');
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'the old device lost its lease'; END IF;

  v_r := public.ari_flow_run_advance(v_run,v_tok_b,2,jsonb_build_object(
    'status','completed','subject_id','33550000-0000-4000-8000-0000000003e1',
    'completion_evidence',jsonb_build_object('probe','offering_subject','observed','33550000-0000-4000-8000-0000000003e1')));
  IF v_r->>'status' <> 'completed' OR v_r->>'completed_at' IS NULL OR (v_r->>'lease_held')::boolean THEN
    RAISE EXCEPTION 'completion with evidence ends the run and frees the lease: %', v_r;
  END IF;
  v_r := public.ari_flow_run_lease(v_run,v_owner,v_tok_a,30);
  IF (v_r->>'ok')::boolean OR v_r->>'reason' <> 'terminal' THEN
    RAISE EXCEPTION 'a finished run is never leased again: %', v_r;
  END IF;

  -- ── One live run per chat ────────────────────────────────────────────────
  v_r := public.ari_flow_run_start(v_owner,v_brand,'create_event',1,'one_per_subject',v_chat2,NULL,'{}');
  v_run := (v_r->'run'->>'id')::uuid;
  v_r := public.ari_flow_run_start(v_owner,v_brand,'create_trip',1,'one_per_subject',v_chat2,NULL,'{}');
  v_run2 := (v_r->'run'->>'id')::uuid;
  IF v_run2 = v_run OR (SELECT status FROM public.ari_flow_runs WHERE id = v_run) <> 'cancelled' THEN
    RAISE EXCEPTION 'a new flow in a chat replaces the older live one';
  END IF;
  v_r := public.ari_flow_run_get(v_owner,NULL,v_chat2);
  IF (v_r->>'id')::uuid <> v_run2 THEN
    RAISE EXCEPTION 'resume reads the chat''s live run: %', v_r;
  END IF;
  v_failed := false;
  BEGIN
    PERFORM public.ari_flow_run_get(v_mate,NULL,v_chat2);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a teammate cannot read another member''s chat run'; END IF;

  -- ── One live brand-wide run; teammates see who is working on it ─────────
  v_r := public.ari_flow_run_start(v_owner,v_brand,'website_setup',1,'one_per_brand',NULL,NULL,'{}');
  v_site := (v_r->'run'->>'id')::uuid;
  v_r := public.ari_flow_run_start(v_mate,v_brand,'website_setup',1,'one_per_brand',v_mate_chat,NULL,'{}');
  IF (v_r->>'created')::boolean OR (v_r->'run'->>'id')::uuid <> v_site
     OR (v_r->>'owned_by_other')::boolean IS NOT TRUE OR v_r->>'owner_display_name' <> 'Ada Owner' THEN
    RAISE EXCEPTION 'a teammate joins the brand-wide run as view-only and sees who owns it: %', v_r;
  END IF;
  v_r := public.ari_flow_run_lease(v_site,v_mate,v_tok_a,30);
  IF (v_r->>'ok')::boolean OR v_r->>'reason' <> 'owned_by_other' THEN
    RAISE EXCEPTION 'a teammate never leases a run they did not start: %', v_r;
  END IF;
  v_r := public.ari_flow_run_lease(v_site,v_owner,v_tok_a,30);
  v_r := public.ari_flow_run_get(v_mate,v_site,NULL);
  IF (v_r->>'lease_held')::boolean IS NOT TRUE OR v_r->>'lease_owner_name' <> 'Ada Owner'
     OR (v_r->>'lease_held_by_me')::boolean THEN
    RAISE EXCEPTION 'a teammate sees "<name> is working on this": %', v_r;
  END IF;
  v_failed := false;
  BEGIN
    INSERT INTO public.ari_flow_runs(brand_id,flow_key,flow_version,concurrency,started_by)
    VALUES (v_brand,'website_setup',1,'one_per_brand',v_mate);
  EXCEPTION WHEN unique_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'two live brand-wide runs must be impossible'; END IF;

  -- ── D-31: model-driven jobs need evidence to complete ───────────────────
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner)::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_job := public.ari_manage_agent_job('create',NULL,v_brand,NULL,gen_random_uuid(),NULL,
    '{"goal_summary":"Fix the brand profile"}');
  v_failed := false;
  BEGIN
    PERFORM public.ari_manage_agent_job('checkpoint',(v_job->>'id')::uuid,NULL,NULL,NULL,
      (v_job->>'revision')::int,'{"status":"completed"}');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_text = MESSAGE_TEXT;
    v_failed := v_text = 'completion_evidence_required';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'D-31: completed without evidence must be refused'; END IF;
  v_job := public.ari_manage_agent_job('checkpoint',(v_job->>'id')::uuid,NULL,NULL,NULL,
    (v_job->>'revision')::int,
    '{"status":"completed","checkpoint":{"evidence_refs":[{"field_key":"contact_phone","source_type":"mingla"}]}}');
  IF v_job->>'status' <> 'completed' THEN
    RAISE EXCEPTION 'D-31: completed with evidence is accepted: %', v_job;
  END IF;
END;
$i3355fr$;

ROLLBACK;
