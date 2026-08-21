-- Issue #2063 executable brand-management matrix.
-- Run after #1972 and #2063 on disposable/local Supabase PostgreSQL 17.
-- All fixtures and mutations roll back.

\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner constant uuid := '20630000-0000-4000-8000-000000000001';
  v_admin constant uuid := '20630000-0000-4000-8000-000000000002';
  v_finance constant uuid := '20630000-0000-4000-8000-000000000003';
  v_outsider constant uuid := '20630000-0000-4000-8000-000000000004';
  v_create_op constant uuid := '20630000-0000-4000-8000-000000000101';
  v_update_op constant uuid := '20630000-0000-4000-8000-000000000102';
  v_hours_op constant uuid := '20630000-0000-4000-8000-000000000103';
  v_swap_op constant uuid := '20630000-0000-4000-8000-000000000104';
  v_currency_op constant uuid := '20630000-0000-4000-8000-000000000105';
  v_revoked_op constant uuid := '20630000-0000-4000-8000-000000000106';
  v_wrong_delete_op constant uuid := '20630000-0000-4000-8000-000000000107';
  v_delete_op constant uuid := '20630000-0000-4000-8000-000000000108';
  v_forged_op constant uuid := '20630000-0000-4000-8000-000000000109';
  v_overnight_op constant uuid := '20630000-0000-4000-8000-000000000110';
  v_equal_hours_op constant uuid := '20630000-0000-4000-8000-000000000111';
  v_missing_version_op constant uuid := '20630000-0000-4000-8000-000000000112';
  v_venue constant uuid := '20630000-0000-4000-8000-000000000201';
  v_other_brand constant uuid := '20630000-0000-4000-8000-000000000202';
  v_other_venue constant uuid := '20630000-0000-4000-8000-000000000203';
  v_guard_brand constant uuid := '20630000-0000-4000-8000-000000000204';
  v_event constant uuid := '20630000-0000-4000-8000-000000000205';
  v_brand_id uuid;
  v_args jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_delete_blocked boolean := false;
  v_hours jsonb := '[
    {"weekday":0,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":1,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":2,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":3,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":4,"open_time":"09:00","close_time":"17:00","is_closed":false},
    {"weekday":5,"open_time":"10:00","close_time":"16:00","is_closed":false},
    {"weekday":6,"open_time":null,"close_time":null,"is_closed":true}
  ]'::jsonb;
BEGIN
  IF to_regprocedure('public.ari_execute_brand_operation(uuid,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION '#2063 wrapper missing';
  END IF;
  IF has_function_privilege('anon', 'public.ari_execute_brand_operation(uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '#2063 anonymous role can execute brand wrapper';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.ari_execute_brand_operation(uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '#2063 authenticated execution grant missing';
  END IF;

  INSERT INTO auth.users (id, email) VALUES
    (v_owner, 'issue2063-owner@test.local'),
    (v_admin, 'issue2063-admin@test.local'),
    (v_finance, 'issue2063-finance@test.local'),
    (v_outsider, 'issue2063-outsider@test.local');
  INSERT INTO public.creator_accounts (id) VALUES
    (v_owner), (v_admin), (v_finance), (v_outsider);

  -- #1972 is the shared execution-attestation owner. Brand execution must not
  -- revive an old or forged row, and authenticated callers cannot create or
  -- transition pending actions directly around the Edge confirmation gate.
  IF has_table_privilege('authenticated', 'public.agent_pending_actions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.agent_pending_actions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.agent_pending_actions', 'DELETE') THEN
    RAISE EXCEPTION '#2063 pending-action server ownership is not sealed';
  END IF;
  v_args := '{"name":"Forged Brand"}'::jsonb;
  INSERT INTO public.agent_pending_actions
    (id, user_id, tool_name, tool_args, status, source)
  VALUES (v_forged_op, v_owner, 'create_brand', v_args, 'executing', 'hub_experience');
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  BEGIN
    PERFORM public.ari_execute_brand_operation(v_forged_op, 'create_brand', v_args);
    RAISE EXCEPTION '#2063 unattested operation unexpectedly executed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'operation_not_executing' THEN
      RAISE;
    END IF;
  END;

  -- Create and replay: one brand row, one receipt, identical readback, and the
  -- first-brand default selected by the shared database trigger.
  v_args := '{"name":"Issue 2063 Brand","description":"created"}'::jsonb;
  INSERT INTO public.agent_pending_actions
    (id, user_id, tool_name, tool_args, status, source, server_proposed_at, execution_attested_at)
  VALUES (v_create_op, v_owner, 'create_brand', v_args, 'executing', 'hub_experience', now(), now());
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_result := public.ari_execute_brand_operation(v_create_op, 'create_brand', v_args);
  v_replay := public.ari_execute_brand_operation(v_create_op, 'create_brand', v_args);
  v_brand_id := (v_result #>> '{brand,id}')::uuid;
  IF v_replay IS DISTINCT FROM v_result THEN
    RAISE EXCEPTION '#2063 replay returned different readback';
  END IF;
  IF (SELECT count(*) FROM public.brands WHERE slug = 'issue-2063-brand') <> 1
     OR (SELECT count(*) FROM public.agent_operation_receipts WHERE operation_id = v_create_op) <> 1 THEN
    RAISE EXCEPTION '#2063 create replay duplicated domain or receipt rows';
  END IF;
  IF (SELECT default_brand_id FROM public.creator_accounts WHERE id = v_owner) IS DISTINCT FROM v_brand_id THEN
    RAISE EXCEPTION '#2063 first-brand default was not selected atomically';
  END IF;

  INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at) VALUES
    (v_brand_id, v_admin, 'brand_admin', now()),
    (v_brand_id, v_finance, 'finance_manager', now());
  INSERT INTO public.venue_listings
    (id, brand_id, slug, name, lat, lng, venue_category)
  VALUES (v_venue, v_brand_id, 'issue2063venue', 'Issue 2063 Venue', 40.71, -74.00, 'restaurant');
  INSERT INTO public.brands (id, account_id, name, slug)
  VALUES (v_other_brand, v_outsider, 'Issue 2063 Other Brand', 'issue-2063-other');
  INSERT INTO public.venue_listings
    (id, brand_id, slug, name, lat, lng, venue_category)
  VALUES (v_other_venue, v_other_brand, 'issue2063other', 'Issue 2063 Other Venue', 40.72, -74.01, 'restaurant');

  -- Accepted brand_admin can update and manage the brand's exact venue hours.
  v_args := jsonb_build_object('brand_id', v_brand_id, 'description', 'delegated update');
  INSERT INTO public.agent_pending_actions
    (id, user_id, tool_name, tool_args, status, source, server_proposed_at, execution_attested_at)
  VALUES (v_update_op, v_admin, 'update_brand', v_args, 'executing', 'hub_experience', now(), now());
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_result := public.ari_execute_brand_operation(v_update_op, 'update_brand', v_args);
  IF v_result #>> '{brand,description}' IS DISTINCT FROM 'delegated update' THEN
    RAISE EXCEPTION '#2063 delegated update readback mismatch';
  END IF;

  v_args := jsonb_build_object('brand_id', v_brand_id, 'venue_id', v_venue, 'hours', v_hours);
  INSERT INTO public.agent_pending_actions
    (id, user_id, tool_name, tool_args, status, source, server_proposed_at, execution_attested_at)
  VALUES (v_hours_op, v_admin, 'manage_brand_hours', v_args, 'executing', 'hub_experience', now(), now());
  v_result := public.ari_execute_brand_operation(v_hours_op, 'manage_brand_hours', v_args);
  v_replay := public.ari_execute_brand_operation(v_hours_op, 'manage_brand_hours', v_args);
  IF jsonb_array_length(v_result -> 'hours') <> 7 OR v_replay IS DISTINCT FROM v_result
     OR (SELECT count(*) FROM public.brand_hours WHERE venue_id = v_venue) <> 7 THEN
    RAISE EXCEPTION '#2063 hours write/readback/replay mismatch';
  END IF;

  -- Overnight spans are canonical Business behavior; equal times remain
  -- invalid because they cannot communicate a usable service window.
  v_hours := jsonb_set(
    jsonb_set(v_hours, '{5,open_time}', '"22:00"'::jsonb),
    '{5,close_time}',
    '"02:00"'::jsonb
  );
  v_args := jsonb_build_object('brand_id', v_brand_id, 'venue_id', v_venue, 'hours', v_hours);
  INSERT INTO public.agent_pending_actions
    (id, user_id, tool_name, tool_args, status, source, server_proposed_at, execution_attested_at)
  VALUES (v_overnight_op, v_admin, 'manage_brand_hours', v_args, 'executing', 'hub_experience', now(), now());
  v_result := public.ari_execute_brand_operation(v_overnight_op, 'manage_brand_hours', v_args);
  IF v_result #>> '{hours,5,open_time}' IS DISTINCT FROM '22:00:00'
     OR v_result #>> '{hours,5,close_time}' IS DISTINCT FROM '02:00:00' THEN
    RAISE EXCEPTION '#2063 canonical overnight hours were not preserved';
  END IF;

  v_hours := jsonb_set(
    jsonb_set(v_hours, '{5,open_time}', '"09:00"'::jsonb),
    '{5,close_time}',
    '"09:00"'::jsonb
  );
  v_args := jsonb_build_object('brand_id', v_brand_id, 'venue_id', v_venue, 'hours', v_hours);
  INSERT INTO public.agent_pending_actions
    (id, user_id, tool_name, tool_args, status, source, server_proposed_at, execution_attested_at)
  VALUES (v_equal_hours_op, v_admin, 'manage_brand_hours', v_args, 'executing', 'hub_experience', now(), now());
  BEGIN
    PERFORM public.ari_execute_brand_operation(v_equal_hours_op, 'manage_brand_hours', v_args);
    RAISE EXCEPTION '#2063 equal open/close hours unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.agent_operation_receipts WHERE operation_id = v_equal_hours_op) THEN
    RAISE EXCEPTION '#2063 rejected equal hours produced a receipt';
  END IF;

  v_hours := jsonb_set(v_hours, '{5,close_time}', '"17:00"'::jsonb);

  -- A venue id from another brand is rejected before any hours row can move.
  v_args := jsonb_build_object('brand_id', v_brand_id, 'venue_id', v_other_venue, 'hours', v_hours);
  INSERT INTO public.agent_pending_actions
    (id, user_id, tool_name, tool_args, status, source, server_proposed_at, execution_attested_at)
  VALUES (v_swap_op, v_admin, 'manage_brand_hours', v_args, 'executing', 'hub_experience', now(), now());
  BEGIN
    PERFORM public.ari_execute_brand_operation(v_swap_op, 'manage_brand_hours', v_args);
    RAISE EXCEPTION '#2063 cross-brand venue swap unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.agent_operation_receipts WHERE operation_id = v_swap_op) THEN
    RAISE EXCEPTION '#2063 failed cross-brand write produced a receipt';
  END IF;

  -- The accepted finance role reaches the canonical optimistic currency owner.
  v_args := jsonb_build_object(
    'brand_id', v_brand_id,
    'action', 'set_provisional_currency',
    'currency_code', 'usd'
  );
  INSERT INTO public.agent_pending_actions
    (id, user_id, tool_name, tool_args, status, source, server_proposed_at, execution_attested_at)
  VALUES (v_missing_version_op, v_finance, 'manage_brand_discovery_currency', v_args, 'executing', 'hub_experience', now(), now());
  PERFORM set_config('request.jwt.claim.sub', v_finance::text, true);
  BEGIN
    PERFORM public.ari_execute_brand_operation(v_missing_version_op, 'manage_brand_discovery_currency', v_args);
    RAISE EXCEPTION '#2063 missing expected currency version unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.agent_operation_receipts WHERE operation_id = v_missing_version_op) THEN
    RAISE EXCEPTION '#2063 missing currency version produced a receipt';
  END IF;

  v_args := jsonb_build_object(
    'brand_id', v_brand_id,
    'action', 'set_provisional_currency',
    'currency_code', 'usd',
    'expected_state_version', 1
  );
  INSERT INTO public.agent_pending_actions
    (id, user_id, tool_name, tool_args, status, source, server_proposed_at, execution_attested_at)
  VALUES (v_currency_op, v_finance, 'manage_brand_discovery_currency', v_args, 'executing', 'hub_experience', now(), now());
  v_result := public.ari_execute_brand_operation(v_currency_op, 'manage_brand_discovery_currency', v_args);
  v_replay := public.ari_execute_brand_operation(v_currency_op, 'manage_brand_discovery_currency', v_args);
  IF v_replay IS DISTINCT FROM v_result
     OR (SELECT btrim(provisional_currency_code::text) FROM public.brands WHERE id = v_brand_id) IS DISTINCT FROM 'USD' THEN
    RAISE EXCEPTION '#2063 finance currency write/readback/replay mismatch';
  END IF;

  -- Removing the delegated role is observed at confirmation execution time.
  UPDATE public.brand_team_members SET removed_at = now()
  WHERE brand_id = v_brand_id AND user_id = v_admin;
  v_args := jsonb_build_object('brand_id', v_brand_id, 'name', 'Revoked Update');
  INSERT INTO public.agent_pending_actions
    (id, user_id, tool_name, tool_args, status, source, server_proposed_at, execution_attested_at)
  VALUES (v_revoked_op, v_admin, 'update_brand', v_args, 'executing', 'hub_experience', now(), now());
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  BEGIN
    PERFORM public.ari_execute_brand_operation(v_revoked_op, 'update_brand', v_args);
    RAISE EXCEPTION '#2063 revoked admin unexpectedly updated brand';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF (SELECT name FROM public.brands WHERE id = v_brand_id) IS DISTINCT FROM 'Issue 2063 Brand' THEN
    RAISE EXCEPTION '#2063 revoked update changed domain state';
  END IF;

  -- The deletion trigger also protects direct/manual Business writes using
  -- actual future end time, including multi-date events.
  INSERT INTO public.brands (id, account_id, name, slug, default_currency)
  VALUES (v_guard_brand, v_outsider, 'Issue 2063 Guard Brand', 'issue-2063-guard', 'USD');
  INSERT INTO public.events (id, brand_id, created_by, title, slug, status)
  VALUES (v_event, v_guard_brand, v_outsider, 'Future Event', 'issue-2063-future', 'scheduled');
  INSERT INTO public.event_dates (event_id, start_at, end_at)
  VALUES (v_event, now() + interval '1 day', now() + interval '2 days');
  BEGIN
    UPDATE public.brands SET deleted_at = now() WHERE id = v_guard_brand;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'brand_delete_blocked_by_events:%' THEN
      v_delete_blocked := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_delete_blocked
     OR (SELECT deleted_at FROM public.brands WHERE id = v_guard_brand) IS NOT NULL THEN
    RAISE EXCEPTION '#2063 future-event delete guard failed';
  END IF;

  -- Deed owner must type the exact brand name; the successful soft delete is
  -- replayable and clears the selected default in the same transaction.
  v_args := jsonb_build_object('brand_id', v_brand_id, 'confirm_phrase', 'wrong');
  INSERT INTO public.agent_pending_actions
    (id, user_id, tool_name, tool_args, status, source, server_proposed_at, execution_attested_at)
  VALUES (v_wrong_delete_op, v_owner, 'delete_brand', v_args, 'executing', 'hub_experience', now(), now());
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  BEGIN
    PERFORM public.ari_execute_brand_operation(v_wrong_delete_op, 'delete_brand', v_args);
    RAISE EXCEPTION '#2063 wrong typed confirmation unexpectedly deleted brand';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;
  v_args := jsonb_build_object('brand_id', v_brand_id, 'confirm_phrase', 'Issue 2063 Brand');
  INSERT INTO public.agent_pending_actions
    (id, user_id, tool_name, tool_args, status, source, server_proposed_at, execution_attested_at)
  VALUES (v_delete_op, v_owner, 'delete_brand', v_args, 'executing', 'hub_experience', now(), now());
  v_result := public.ari_execute_brand_operation(v_delete_op, 'delete_brand', v_args);
  v_replay := public.ari_execute_brand_operation(v_delete_op, 'delete_brand', v_args);
  IF v_replay IS DISTINCT FROM v_result
     OR (SELECT deleted_at FROM public.brands WHERE id = v_brand_id) IS NULL
     OR (SELECT default_brand_id FROM public.creator_accounts WHERE id = v_owner) IS NOT NULL THEN
    RAISE EXCEPTION '#2063 owner delete/readback/replay/default cleanup mismatch';
  END IF;

  RAISE NOTICE '#2063 PG17 PASS: exact-once, roles, containment, hours, currency, and delete guards';
END;
$test$;

ROLLBACK;
