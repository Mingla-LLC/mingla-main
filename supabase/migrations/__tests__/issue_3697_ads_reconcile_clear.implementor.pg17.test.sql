-- Issue #3697: a dead Mingla plan is cleared only on provider evidence that
-- every recorded object is gone; its provider-account hold is then released.
-- Production 2026-10-20 (plan 534424c7): the create failed while saving after
-- Meta made campaign 52609719519827, the plan sat in creation_failed_terminal
-- and its $120 hold stayed "held" with no action that could release it.
-- Database half of I-3697-RECONCILE-CLEARS-ONLY-ON-ABSENCE (declared beside
-- the Deno gate, supabase/functions/_shared/__tests__/issue_3697_ads_reconcile.test.ts).

\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_user constant uuid := '36973100-0000-4000-8000-000000000001';
  v_connection constant uuid := '36973100-0000-4000-8000-000000000021';
  v_plan public.ad_plans%ROWTYPE;
  v_version public.ad_plan_versions%ROWTYPE;
  v_result jsonb;
  v_hold public.ad_plan_funding_holds%ROWTYPE;
  v_event public.ad_status_events%ROWTYPE;
  v_failed text;
  v_absent jsonb;
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES (v_user, 'issue-3697-reconcile@example.test');
  INSERT INTO public.creator_accounts (id, email)
  VALUES (v_user, 'issue-3697-reconcile@example.test');
  INSERT INTO public.ad_connections (
    id, platform, lane, display_name, external_account_id, auth_kind,
    token_env_var, status, currency, connected
  ) VALUES (
    v_connection, 'meta', 'consumer', 'Issue 3697 reconcile Meta',
    'act_issue3697_reconcile', 'system_user_token',
    'ISSUE_3697_RECONCILE_TOKEN', 'connected', 'USD', true
  );

  v_plan := public.ad_plan_open(
    'admin', 'mingla', NULL, 'marketing_page', 'explorer', '[]'::jsonb, v_user
  );
  v_version := public.ad_plan_create_version(
    v_plan.id,
    jsonb_build_object(
      'name', 'Deserted Island 6.0 — first attempt',
      'platforms', jsonb_build_array('meta'),
      'confirmation_phrase', 'CREATE PAUSED',
      'media_rights', jsonb_build_object(
        'rights_confirmed', true, 'rights_basis', 'owned',
        'ai_generated', false, 'house_reuse_allowed', false,
        'attested_by', v_user::text, 'attested_at', now()
      )
    ),
    12000, 'USD', jsonb_build_array(jsonb_build_object(
      'platform', 'meta', 'connection_id', v_connection,
      'host_budget_cents', 12000, 'host_delivery_budget_cents', 3000,
      'provider_budget_cents', 12000, 'provider_delivery_budget_cents', 3000
    )), v_user
  );
  INSERT INTO public.ad_plan_targeting_snapshots (
    plan_version_id, platform, audience_intent, compiled_targeting, verdict,
    evidence_observed_at, compiler_version
  ) VALUES (
    v_version.id, 'meta', '{"countries":["NG"]}'::jsonb,
    '{"geo_locations":{"countries":["NG"]}}'::jsonb, 'exact', now(),
    'v1.4-issue-3697-reconcile'
  );
  PERFORM public.ad_plan_mark_ready(v_version.id, v_version.plan_hash);
  PERFORM public.ad_plan_mark_admin_funded(v_version.id, v_version.plan_hash);
  PERFORM public.ad_plan_confirm_launch(
    v_version.id, v_version.plan_hash, 'CREATE PAUSED', v_user
  );

  -- The production failure: the persist failed after Meta made a campaign.
  INSERT INTO public.ad_status_events (
    campaign_id, platform, entity, action, actor, external_ids, provider_response
  ) VALUES (
    NULL, 'meta', 'campaign', 'create_failed', v_user,
    jsonb_build_object(
      'external_campaign_id', '52609719519827',
      'external_adset_id', NULL,
      'plan_version_id', v_version.id::text,
      'plan_hash', v_version.plan_hash
    ),
    '{"db_error":"ad_campaign_plan_binding_mismatch","campaign_rolled_back":false}'::jsonb
  );
  PERFORM public.ad_record_provider_attempt(
    v_version.id, v_version.plan_hash, 'meta', 'create_paused_objects',
    v_version.plan_hash || ':meta:create', 'failed_terminal',
    '{"external_campaign_id":"52609719519827"}'::jsonb, NULL,
    'db_persist_failed_platform_rolled_back'
  );
  UPDATE public.ad_plans SET state = 'creation_failed_terminal'
  WHERE id = v_plan.id;

  -- Baseline: the existing cancel path still refuses (provider evidence).
  v_failed := NULL;
  BEGIN
    PERFORM public.ad_plan_cancel_before_create(
      v_version.id, v_version.plan_hash, 'issue-3697-cancel', 'test', v_user
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN v_failed := SQLERRM;
  END;
  IF v_failed IS DISTINCT FROM 'ad_plan_provider_objects_may_exist' THEN
    RAISE EXCEPTION 'cancel_before_create must keep refusing: %', v_failed;
  END IF;

  -- (1) No evidence for the recorded campaign → refused, nothing changes.
  v_failed := NULL;
  BEGIN
    PERFORM public.ad_plan_reconcile_clear(
      v_version.id, v_version.plan_hash, '[]'::jsonb, v_user
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN v_failed := SQLERRM;
  END;
  IF v_failed IS DISTINCT FROM 'ad_plan_reconcile_evidence_incomplete:meta:52609719519827' THEN
    RAISE EXCEPTION 'missing evidence must refuse: %', v_failed;
  END IF;

  -- (2) The provider still has it → refused.
  v_failed := NULL;
  BEGIN
    PERFORM public.ad_plan_reconcile_clear(
      v_version.id, v_version.plan_hash,
      '[{"platform":"meta","level":"campaign","external_id":"52609719519827","verdict":"exists"}]'::jsonb,
      v_user
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN v_failed := SQLERRM;
  END;
  IF v_failed IS DISTINCT FROM 'ad_plan_reconcile_object_not_absent' THEN
    RAISE EXCEPTION 'a surviving object must refuse: %', v_failed;
  END IF;

  -- (3) An unchecked object (unknown) → refused.
  v_failed := NULL;
  BEGIN
    PERFORM public.ad_plan_reconcile_clear(
      v_version.id, v_version.plan_hash,
      '[{"platform":"meta","level":"campaign","external_id":"52609719519827","verdict":"unknown"}]'::jsonb,
      v_user
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN v_failed := SQLERRM;
  END;
  IF v_failed IS DISTINCT FROM 'ad_plan_reconcile_object_not_absent' THEN
    RAISE EXCEPTION 'an unchecked object must refuse: %', v_failed;
  END IF;
  IF (SELECT state FROM public.ad_plan_funding_holds WHERE plan_version_id = v_version.id) <> 'held'
     OR (SELECT state FROM public.ad_plans WHERE id = v_plan.id) <> 'creation_failed_terminal' THEN
    RAISE EXCEPTION 'a refused reconcile changed the plan or hold';
  END IF;

  -- (4) Meta says it is gone → hold released, plan closed, audit row written.
  v_absent := '[{"platform":"meta","level":"campaign","external_id":"52609719519827","verdict":"absent","provider_status":null}]'::jsonb;
  v_result := public.ad_plan_reconcile_clear(
    v_version.id, v_version.plan_hash, v_absent, v_user
  );
  IF v_result->'plan'->>'state' <> 'cancelled_before_create' THEN
    RAISE EXCEPTION 'plan was not closed: %', v_result;
  END IF;
  SELECT * INTO v_hold FROM public.ad_plan_funding_holds
  WHERE plan_version_id = v_version.id;
  IF v_hold.state <> 'released' OR v_hold.released_at IS NULL
     OR v_hold.released_by IS DISTINCT FROM v_user
     OR v_hold.release_reason <> 'provider_reconciled_absent'
     OR v_hold.amount_cents <> 12000 THEN
    RAISE EXCEPTION 'hold was not released: %', row_to_json(v_hold);
  END IF;
  SELECT * INTO v_event FROM public.ad_status_events
  WHERE action = 'reconcile_cleared'
    AND external_ids->>'plan_version_id' = v_version.id::text;
  IF NOT FOUND OR v_event.actor IS DISTINCT FROM v_user
     OR (v_event.provider_response->>'hold_amount_cents')::bigint <> 12000
     OR v_event.provider_response->>'plan_name' <> 'Deserted Island 6.0 — first attempt' THEN
    RAISE EXCEPTION 'reconcile_cleared audit row missing or wrong';
  END IF;

  -- (5) It leaves the recovery states for good: a second clear is refused.
  v_failed := NULL;
  BEGIN
    PERFORM public.ad_plan_reconcile_clear(
      v_version.id, v_version.plan_hash, v_absent, v_user
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN v_failed := SQLERRM;
  END;
  IF v_failed IS DISTINCT FROM 'ad_plan_reconcile_state_invalid' THEN
    RAISE EXCEPTION 'a cleared plan must not clear twice: %', v_failed;
  END IF;

  -- (6) The function is service-role only.
  IF has_function_privilege('authenticated',
       'public.ad_plan_reconcile_clear(uuid,text,jsonb,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must not execute ad_plan_reconcile_clear';
  END IF;
END;
$test$;

ROLLBACK;
