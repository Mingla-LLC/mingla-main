-- MINGLA-INVARIANT: I-ARI-RUNS-EXPIRE | issue #3355 | An Ari flow run idle for 24 hours (database clock, ari_flow_run_last_activity) becomes expired through ari_flow_runs_expire_idle, which the Ari turn sweep calls; a chat holds at most one open (live or parked) run; a parked run comes back only through ari_flow_run_resume in its own chat, by the person who started it, and an idle one expires instead of coming back (edge side: supabase/functions/_shared/__tests__/issue_3355_wave_a_understand_first.implementor.test.ts).
--
-- Issue #3355 Wave A (A2 + A5) — parked runs and run expiry
-- (migration 20280702013355_issue_3355_flow_runs_park_and_expire.sql).
-- Pins:
--   * advance parks a live run (lease cleared, prior status kept); a parked run
--     cannot be leased (the runner treats it as not live);
--   * resume: only the starter, only in the run's own chat, only while parked;
--     it restores the prior status; an idle parked run expires instead;
--   * starting a new flow in the chat closes its parked run; the chat never
--     holds two open runs (unique index);
--   * expire_idle ends the caller's runs idle 24 h, and only those;
--   * service-role only.
-- Reverting any function body or the index makes a block below raise.

\set ON_ERROR_STOP on
BEGIN;

DO $i3355pk$
DECLARE
  v_owner uuid := '33550000-0000-4000-8000-0000000006a1';
  v_mate uuid := '33550000-0000-4000-8000-0000000006a2';
  v_brand uuid := '33550000-0000-4000-8000-0000000006b1';
  v_chat uuid := '33550000-0000-4000-8000-0000000006c1';
  v_chat2 uuid := '33550000-0000-4000-8000-0000000006c2';
  v_mate_chat uuid := '33550000-0000-4000-8000-0000000006c3';
  v_tok uuid := gen_random_uuid();
  v_r jsonb;
  v_run uuid;
  v_run2 uuid;
  v_old uuid;
  v_rev integer;
  v_failed boolean;
  v_text text;
  v_n integer;
BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    (v_owner,'owner-3355pk@example.invalid','{"full_name":"Ada Owner"}'),
    (v_mate,'mate-3355pk@example.invalid','{"full_name":"Sam Mate"}');
  INSERT INTO public.creator_accounts(id,created_at,updated_at) VALUES (v_owner,now(),now());
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES (v_brand,v_owner,'Favy Lagos','favy-3355pk','NGN');
  INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
  VALUES (v_brand,v_mate,'brand_admin',now());
  INSERT INTO public.agent_conversations(id,user_id,brand_id) VALUES
    (v_chat,v_owner,v_brand),(v_chat2,v_owner,v_brand),(v_mate_chat,v_mate,v_brand);

  -- ── Privilege ────────────────────────────────────────────────────────────
  IF has_function_privilege('authenticated','public.ari_flow_run_resume(uuid,uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.ari_flow_run_resume(uuid,uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.ari_flow_runs_expire_idle(uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.ari_flow_run_resume(uuid,uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.ari_flow_runs_expire_idle(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'resume / expire must be service-role only';
  END IF;

  -- ── Park: a live run is set aside, prior status kept, lease cleared ──────
  v_r := public.ari_flow_run_start(v_owner,v_brand,'create_event',2,'one_per_subject',v_chat,NULL,'{}');
  v_run := (v_r->'run'->>'id')::uuid;
  v_r := public.ari_flow_run_lease(v_run,v_owner,v_tok,30);
  v_rev := (v_r->'run'->>'revision')::integer;
  v_r := public.ari_flow_run_advance(v_run,v_tok,v_rev,
    '{"status":"awaiting_owner","current_step_key":"brand_blockers","current_question_id":"33550000-0000-4000-8000-0000000006d1"}');
  v_rev := (v_r->>'revision')::integer;
  v_r := public.ari_flow_run_advance(v_run,v_tok,v_rev,'{"status":"parked"}');
  IF v_r->>'status' <> 'parked' THEN RAISE EXCEPTION 'advance must park: %', v_r->>'status'; END IF;
  IF (SELECT parked_from_status FROM public.ari_flow_runs WHERE id = v_run) <> 'awaiting_owner'
     OR (SELECT lease_token FROM public.ari_flow_runs WHERE id = v_run) IS NOT NULL
     OR (SELECT parked_at FROM public.ari_flow_runs WHERE id = v_run) IS NULL THEN
    RAISE EXCEPTION 'park must keep the prior status and clear the lease';
  END IF;
  IF (v_r->>'current_question_id') <> '33550000-0000-4000-8000-0000000006d1' THEN
    RAISE EXCEPTION 'park keeps the question the run was on';
  END IF;
  v_r := public.ari_flow_run_lease(v_run,v_owner,gen_random_uuid(),30);
  IF (v_r->>'ok')::boolean OR v_r->>'reason' <> 'terminal' THEN
    RAISE EXCEPTION 'a parked run is not live: it cannot be leased';
  END IF;
  -- The chat's run read prefers it (nothing live in the chat).
  v_r := public.ari_flow_run_get(v_owner,NULL,v_chat);
  IF (v_r->>'id')::uuid <> v_run OR v_r->>'status' <> 'parked' THEN
    RAISE EXCEPTION 'the chat read returns its parked run';
  END IF;

  -- ── Resume: starter, own chat, parked only ───────────────────────────────
  v_failed := false;
  BEGIN
    PERFORM public.ari_flow_run_resume(v_mate,v_run,v_chat);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a teammate must not resume someone else''s run'; END IF;
  v_failed := false;
  BEGIN
    PERFORM public.ari_flow_run_resume(v_owner,v_run,v_chat2);
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a new chat must never resume an old run'; END IF;
  v_r := public.ari_flow_run_resume(v_owner,v_run,v_chat);
  IF v_r->>'status' <> 'awaiting_owner' THEN
    RAISE EXCEPTION 'resume restores the prior status, got %', v_r->>'status';
  END IF;
  v_failed := false;
  BEGIN
    PERFORM public.ari_flow_run_resume(v_owner,v_run,v_chat);
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    GET STACKED DIAGNOSTICS v_text = MESSAGE_TEXT;
    v_failed := v_text = 'flow_run_not_parked';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'resume of a live run must be refused'; END IF;

  -- ── One open run per chat ────────────────────────────────────────────────
  v_tok := gen_random_uuid();
  v_r := public.ari_flow_run_lease(v_run,v_owner,v_tok,30);
  v_r := public.ari_flow_run_advance(v_run,v_tok,(v_r->'run'->>'revision')::integer,'{"status":"parked"}');
  v_failed := false;
  BEGIN
    INSERT INTO public.ari_flow_runs(brand_id,flow_key,flow_version,concurrency,started_by,conversation_id,status)
    VALUES (v_brand,'create_trip',2,'one_per_subject',v_owner,v_chat,'awaiting_owner');
  EXCEPTION WHEN unique_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a chat must never hold a parked and a live run'; END IF;
  v_r := public.ari_flow_run_start(v_owner,v_brand,'create_trip',2,'one_per_subject',v_chat,NULL,'{}');
  v_run2 := (v_r->'run'->>'id')::uuid;
  IF NOT (v_r->>'created')::boolean
     OR (SELECT status FROM public.ari_flow_runs WHERE id = v_run) <> 'cancelled' THEN
    RAISE EXCEPTION 'a new flow in the chat closes its parked run';
  END IF;
  SELECT count(*) INTO v_n FROM public.ari_flow_runs
  WHERE conversation_id = v_chat
    AND status IN ('active','awaiting_owner','awaiting_approval','awaiting_handoff','blocked','parked');
  IF v_n <> 1 THEN RAISE EXCEPTION 'one open run per chat, found %', v_n; END IF;

  -- ── Expire: idle 24 h ends; recent and other people's runs stay ──────────
  v_r := public.ari_flow_run_start(v_owner,v_brand,'create_event',2,'one_per_subject',v_chat2,NULL,'{}');
  v_old := (v_r->'run'->>'id')::uuid;
  UPDATE public.ari_flow_runs
  SET updated_at = now() - interval '25 hours', last_lease_at = now() - interval '25 hours'
  WHERE id = v_old;
  v_r := public.ari_flow_run_start(v_mate,v_brand,'create_event',2,'one_per_subject',v_mate_chat,NULL,'{}');
  UPDATE public.ari_flow_runs
  SET updated_at = now() - interval '25 hours', last_lease_at = NULL
  WHERE id = (v_r->'run'->>'id')::uuid;
  v_n := public.ari_flow_runs_expire_idle(v_owner);
  IF v_n <> 1 THEN RAISE EXCEPTION 'expire_idle should end exactly the owner''s idle run, ended %', v_n; END IF;
  IF (SELECT status FROM public.ari_flow_runs WHERE id = v_old) <> 'expired'
     OR (SELECT status FROM public.ari_flow_runs WHERE id = v_run2) <> 'active'
     OR (SELECT status FROM public.ari_flow_runs WHERE id = (v_r->'run'->>'id')::uuid) <> 'active' THEN
    RAISE EXCEPTION 'expire_idle must end only the caller''s idle runs';
  END IF;
  IF public.ari_flow_runs_expire_idle(v_owner) <> 0 THEN
    RAISE EXCEPTION 'expire_idle is idempotent';
  END IF;

  -- An idle parked run expires instead of coming back.
  v_tok := gen_random_uuid();
  v_r := public.ari_flow_run_lease(v_run2,v_owner,v_tok,30);
  v_r := public.ari_flow_run_advance(v_run2,v_tok,(v_r->'run'->>'revision')::integer,'{"status":"parked"}');
  UPDATE public.ari_flow_runs
  SET updated_at = now() - interval '25 hours', last_lease_at = now() - interval '25 hours'
  WHERE id = v_run2;
  v_r := public.ari_flow_run_resume(v_owner,v_run2,v_chat);
  IF v_r->>'status' <> 'expired'
     OR (SELECT status FROM public.ari_flow_runs WHERE id = v_run2) <> 'expired' THEN
    RAISE EXCEPTION 'an idle parked run must expire on resume, got %', v_r->>'status';
  END IF;

  -- The status check knows parked and nothing invented.
  v_failed := false;
  BEGIN
    UPDATE public.ari_flow_runs SET status = 'paused' WHERE id = v_run2;
  EXCEPTION WHEN check_violation THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'unknown statuses must stay refused'; END IF;
END;
$i3355pk$;

ROLLBACK;
