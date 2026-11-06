-- Issue #2830 — tester's attack on takeover, status and research, from angles the
-- implementor's suite does not take: stale leases and receipts, a third person's
-- live form, what a real stuck run looks like, and the tick on a brand with gaps.
\set ON_ERROR_STOP on
BEGIN;

DO $t2830$
DECLARE
  v_owner uuid := '28310000-0000-4000-8000-0000000000a1';
  v_admin uuid := '28310000-0000-4000-8000-0000000000a2';
  v_third uuid := '28310000-0000-4000-8000-0000000000a3';
  v_stranger uuid := '28310000-0000-4000-8000-0000000000a4';
  v_events uuid := '28310000-0000-4000-8000-0000000000a5';
  v_brand uuid := '28310000-0000-4000-8000-0000000000b1';
  v_owner_chat uuid := '28310000-0000-4000-8000-0000000000c1';
  v_admin_chat uuid := '28310000-0000-4000-8000-0000000000c2';
  v_token uuid := gen_random_uuid();
  v_r jsonb;
  v_run uuid;
  v_rev integer;
  v_failed text;
  v_state text;
  v_status jsonb;
  v_part jsonb;
BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    (v_owner,'tester-owner-2830@example.invalid','{"full_name":"Olu Owner"}'),
    (v_admin,'tester-admin-2830@example.invalid','{"full_name":"Ada Admin"}'),
    (v_third,'tester-third-2830@example.invalid','{"full_name":"Tayo Third"}'),
    (v_stranger,'tester-stranger-2830@example.invalid','{"full_name":"Sam Stranger"}'),
    (v_events,'tester-events-2830@example.invalid','{"full_name":"Eve Events"}');
  INSERT INTO public.creator_accounts(id,created_at,updated_at) VALUES (v_owner,now(),now());
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES (v_brand,v_owner,'Tester Room','tester-2830','GBP');
  INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
    (v_brand,v_admin,'brand_admin',now()),
    (v_brand,v_third,'brand_admin',now()),
    (v_brand,v_events,'event_manager',now());
  INSERT INTO public.agent_conversations(id,user_id,brand_id) VALUES
    (v_owner_chat,v_owner,v_brand),(v_admin_chat,v_admin,v_brand);

  -- ── The two production shapes: awaiting_owner, idle, rank 50 and rank 60 ──
  v_r := public.ari_flow_run_start(v_admin,v_brand,'website_setup',1,'one_per_brand',NULL,NULL,'{"kept":"yes"}');
  v_run := (v_r->'run'->>'id')::uuid;
  UPDATE public.ari_flow_runs
  SET status='awaiting_owner', current_step_key='brand', updated_at=now()-interval '3 days'
  WHERE id=v_run;
  v_rev := (SELECT revision FROM public.ari_flow_runs WHERE id=v_run);
  -- The owner's Continue, with a NULL-chat run and no chat of their own yet.
  v_r := public.ari_flow_run_take_over(v_owner,v_run,NULL,v_rev,'continue');
  IF (v_r->>'changed')::boolean IS NOT TRUE OR (v_r->>'kind') <> 'continued_stopped' THEN
    RAISE EXCEPTION 'null-chat stuck run: %', v_r;
  END IF;
  IF (SELECT answers->>'kept' FROM public.ari_flow_runs WHERE id=v_run) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'null-chat stuck run lost its answers';
  END IF;
  -- The owner's Ari then attaches its chat to the same run: no second run.
  v_r := public.ari_flow_run_start(v_owner,v_brand,'website_setup',1,'one_per_brand',v_owner_chat,NULL,'{}');
  IF (v_r->>'created')::boolean OR (v_r->'run'->>'id')::uuid <> v_run
    OR (v_r->'run'->>'conversation_id')::uuid <> v_owner_chat THEN
    RAISE EXCEPTION 'chat did not attach to the taken run: %', v_r;
  END IF;

  -- ── A displaced person's token is dead the moment they lose the run ───────
  v_r := public.ari_flow_run_lease(v_run,v_owner,v_token,5);
  UPDATE public.ari_flow_runs SET lease_expires_at = now()-interval '1 second' WHERE id=v_run;
  v_rev := (SELECT revision FROM public.ari_flow_runs WHERE id=v_run);
  PERFORM public.ari_flow_run_take_over(v_admin,v_run,v_admin_chat,v_rev,'take_over');
  v_failed := NULL;
  BEGIN
    PERFORM public.ari_flow_run_advance(v_run,v_token,v_rev+1,'{"answers":{"stolen":"yes"}}'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLSTATE || ':' || SQLERRM;
  END;
  IF v_failed IS NULL THEN RAISE EXCEPTION 'old lease token still advanced the run'; END IF;
  IF v_failed LIKE '40001%' THEN RAISE EXCEPTION 'old token raised 40001: %', v_failed; END IF;
  IF (SELECT answers ? 'stolen' FROM public.ari_flow_runs WHERE id=v_run) THEN
    RAISE EXCEPTION 'the displaced write landed';
  END IF;
  v_r := public.ari_flow_run_lease(v_run,v_owner,gen_random_uuid(),5);
  IF v_r->>'reason' IS DISTINCT FROM 'owned_by_other' THEN RAISE EXCEPTION 'displaced lease: %', v_r; END IF;

  -- ── Permission rules at the edges of "rank" ───────────────────────────────
  v_rev := (SELECT revision FROM public.ari_flow_runs WHERE id=v_run);
  FOREACH v_failed IN ARRAY ARRAY['take_over','continue'] LOOP
    v_state := NULL;
    BEGIN
      PERFORM public.ari_flow_run_take_over(v_events,v_run,NULL,v_rev,v_failed);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_state := 'refused';
    END;
    IF v_state IS NULL THEN RAISE EXCEPTION 'rank 40 took a run with %', v_failed; END IF;
    v_state := NULL;
    BEGIN
      PERFORM public.ari_flow_run_take_over(v_stranger,v_run,NULL,v_rev,v_failed);
    EXCEPTION WHEN SQLSTATE '42501' THEN v_state := 'refused';
    END;
    IF v_state IS NULL THEN RAISE EXCEPTION 'a stranger took a run with %', v_failed; END IF;
  END LOOP;
  -- A removed admin is no admin.
  UPDATE public.brand_team_members SET removed_at = now() WHERE brand_id=v_brand AND user_id=v_third;
  v_state := NULL;
  BEGIN
    PERFORM public.ari_flow_run_take_over(v_third,v_run,NULL,v_rev,'take_over');
  EXCEPTION WHEN SQLSTATE '42501' THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'a removed admin took a run'; END IF;
  UPDATE public.brand_team_members SET removed_at = NULL WHERE brand_id=v_brand AND user_id=v_third;

  -- ── A conflict is never 40001 ─────────────────────────────────────────────
  v_state := NULL;
  BEGIN
    PERFORM public.ari_flow_run_take_over(v_owner,v_run,NULL,v_rev-1,'take_over');
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  IF v_state IS DISTINCT FROM 'PT409' THEN RAISE EXCEPTION 'stale revision raised %', v_state; END IF;

  -- ── The tick never lies ───────────────────────────────────────────────────
  -- A brand with only name and description: the server's old rule ticks "brand".
  UPDATE public.brands SET description='Evenings' WHERE id=v_brand;
  v_status := public.brand_site_setup_status_internal(v_brand);
  FOR v_part IN SELECT value FROM jsonb_array_elements(v_status->'parts') LOOP
    IF (v_part->>'done')::boolean AND jsonb_array_length(v_part->'open_fields') > 0 THEN
      RAISE EXCEPTION 'a tick with open fields: %', v_part;
    END IF;
    IF (v_part->>'key') IN ('brand','look','story','approve')
      AND (v_part->>'field_count')::int = 0 THEN
      RAISE EXCEPTION 'a part reads no fields, so it can never be open: %', v_part;
    END IF;
  END LOOP;
  IF (v_status->>'done_count')::int <> (
    SELECT count(*) FROM jsonb_array_elements(v_status->'parts') p
    WHERE (p.value->>'done')::boolean OR (p.value->>'skipped')::boolean) THEN
    RAISE EXCEPTION 'done_count disagrees with its own parts: %', v_status;
  END IF;

  -- ── Research: the limit holds however it is asked ─────────────────────────
  v_state := NULL;
  BEGIN
    PERFORM public.ari_brand_research_claim(v_events,v_brand);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_state := 'refused';
  END;
  IF v_state IS NULL THEN RAISE EXCEPTION 'rank 40 claimed a search'; END IF;
  IF (public.ari_brand_research_claim(v_owner,v_brand)->>'allowed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'first claim refused';
  END IF;
  IF (public.ari_brand_research_claim(v_admin,v_brand)->>'allowed')::boolean THEN
    RAISE EXCEPTION 'second search while one is running';
  END IF;
  PERFORM public.ari_brand_research_finish(v_brand,'unavailable','{}'::jsonb);
  IF (public.ari_brand_research_claim(v_owner,v_brand)->>'allowed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'the one retry refused';
  END IF;
  UPDATE public.ari_brand_setup_research SET started_at = now()-interval '10 minutes' WHERE brand_id=v_brand;
  IF (public.ari_brand_research_claim(v_owner,v_brand)->>'allowed')::boolean THEN
    RAISE EXCEPTION 'a third search after a died retry';
  END IF;
  PERFORM public.ari_brand_research_finish(v_brand,'found','{}'::jsonb);
  IF (SELECT status FROM public.ari_brand_setup_research WHERE brand_id=v_brand) <> 'unavailable' THEN
    RAISE EXCEPTION 'a late finish rewrote a settled result';
  END IF;
END;
$t2830$;

-- ── Defect repros: each raises today ───────────────────────────────────────
-- A receipt stuck `executing` past its lease must not lock the owner out. The
-- repo's own rule: "An executing row older than 2 minutes no longer blocks chat".
DO $stuck$
DECLARE
  v_owner uuid := '28310000-0000-4000-8000-0000000000a1';
  v_admin uuid := '28310000-0000-4000-8000-0000000000a2';
  v_brand uuid := '28310000-0000-4000-8000-0000000000b1';
  v_admin_chat uuid := '28310000-0000-4000-8000-0000000000c2';
  v_run uuid;
  v_rev integer;
BEGIN
  SELECT id, revision INTO v_run, v_rev FROM public.ari_flow_runs
  WHERE brand_id=v_brand AND flow_key='website_setup';
  UPDATE public.ari_flow_runs SET updated_at=now()-interval '3 days', last_lease_at=NULL,
    lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL WHERE id=v_run;
  INSERT INTO public.agent_pending_actions(user_id,conversation_id,tool_name,tool_args,status,
    source,expires_at,executing_started_at)
  SELECT v_admin,v_admin_chat,'save_x','{}'::jsonb,'executing','ari',now()+interval '1 day',
    now()-interval '2 days';
  PERFORM public.ari_flow_run_take_over(v_owner,v_run,NULL,v_rev,'continue');
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'DEFECT stuck executing receipt locks the owner out for good: % %', SQLSTATE, SQLERRM;
END;
$stuck$;

-- A third person's live form: "Continue" must not take their lock with no warning.
DO $lock$
DECLARE
  v_owner uuid := '28310000-0000-4000-8000-0000000000a1';
  v_admin uuid := '28310000-0000-4000-8000-0000000000a2';
  v_third uuid := '28310000-0000-4000-8000-0000000000a3';
  v_brand uuid := '28310000-0000-4000-8000-0000000000b1';
  v_run uuid;
  v_rev integer;
  v_caught text;
BEGIN
  SELECT id INTO v_run FROM public.ari_flow_runs WHERE brand_id=v_brand AND flow_key='website_setup';
  UPDATE public.ari_flow_runs SET started_by=v_admin, conversation_id=NULL, status='awaiting_owner',
    updated_at=now()-interval '3 days', last_lease_at=NULL, lease_owner=NULL, lease_token=NULL,
    lease_expires_at=NULL, revision=revision+1 WHERE id=v_run RETURNING revision INTO v_rev;
  INSERT INTO public.brand_site_plans(brand_id,started_by,updated_by,offerings_selected)
  VALUES (v_brand,v_third,v_third,ARRAY[]::text[]) ON CONFLICT (brand_id) DO NOTHING;
  UPDATE public.brand_site_plans SET lock_holder=v_third, lock_expires_at=now()+interval '9 minutes'
  WHERE brand_id=v_brand;
  BEGIN
    PERFORM public.ari_flow_run_take_over(v_owner,v_run,NULL,v_rev,'continue');
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_caught := SQLERRM;
  END;
  IF v_caught IS NULL THEN
    RAISE EXCEPTION 'DEFECT Continue took a teammate''s live form lock with no warning';
  END IF;
END;
$lock$;

ROLLBACK;
