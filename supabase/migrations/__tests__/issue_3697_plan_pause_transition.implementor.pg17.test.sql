-- Issue #3697 — guarded plan pause transition and least-privilege RPC proof.
-- Fails on revert of 20271204003697_issue_3697_plan_pause_transition.sql.
-- MINGLA-INVARIANT: I-3697-PLAN-PAUSE-FOLLOWS-CAMPAIGNS | issue #3697 | A plan with provider campaigns paused through Admin or spend sync follows the guarded intermediate transition; a plan with any provider campaign still delivering keeps the mixed-provider state.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.ad_connections (
  id, platform, lane, display_name, external_account_id, auth_kind,
  token_env_var, status, currency, connected
) VALUES
  ('36970000-0000-4000-8000-000000000711', 'meta', 'consumer',
   'Issue 3697 pause Meta', 'pause-meta', 'system_user_token',
   'ISSUE_3697_PAUSE_META', 'connected', 'USD', true),
  ('36970000-0000-4000-8000-000000000712', 'tiktok', 'consumer',
   'Issue 3697 pause TikTok', 'pause-tiktok', 'system_user_token',
   'ISSUE_3697_PAUSE_TIKTOK', 'connected', 'USD', true)
ON CONFLICT (platform, lane) DO UPDATE
SET status = 'connected', currency = 'USD', connected = true;

SET LOCAL session_replication_role = replica;

INSERT INTO public.ad_plans (
  id, client_kind, owner_kind, destination_family, destination_key, state
) VALUES
  ('36970000-0000-4000-8000-000000000701', 'admin', 'mingla',
   'marketing_page', 'explorer', 'live'),
  ('36970000-0000-4000-8000-000000000702', 'admin', 'mingla',
   'marketing_page', 'host', 'live');

INSERT INTO public.ad_plan_versions (
  id, plan_id, version_number, canonical_plan, destination_snapshot,
  plan_hash, host_currency, host_budget_cents
) VALUES
  ('36970000-0000-4000-8000-000000000721',
   '36970000-0000-4000-8000-000000000701', 1, '{}'::jsonb, '{}'::jsonb,
   repeat('a', 64), 'USD', 2000),
  ('36970000-0000-4000-8000-000000000722',
   '36970000-0000-4000-8000-000000000702', 1, '{}'::jsonb, '{}'::jsonb,
   repeat('b', 64), 'USD', 2000);

UPDATE public.ad_plans SET current_version_id = CASE id
  WHEN '36970000-0000-4000-8000-000000000701'::uuid
    THEN '36970000-0000-4000-8000-000000000721'::uuid
  ELSE '36970000-0000-4000-8000-000000000722'::uuid
END
WHERE id IN (
  '36970000-0000-4000-8000-000000000701',
  '36970000-0000-4000-8000-000000000702'
);

INSERT INTO public.ad_campaigns (
  id, connection_id, platform, external_campaign_id, name, objective, status,
  dest_page_type, dest_brand_slug, dest_url, dest_smart_link, owner_kind,
  currency, provider_currency, plan_version_id, plan_hash,
  provider_budget_cents, provider_delivery_budget_cents
) VALUES
  ('36970000-0000-4000-8000-000000000731',
   (SELECT id FROM public.ad_connections WHERE platform = 'meta' AND lane = 'consumer'),
   'meta', 'pause-plan-one-meta', 'Pause plan one Meta', 'OUTCOME_TRAFFIC', 'PAUSED',
   'brand', 'issue-3697-pause-one', 'https://usemingla.com/b/one',
   'https://usemingla.com/b/one', 'mingla', 'USD', 'USD',
   '36970000-0000-4000-8000-000000000721', repeat('a', 64), 1000, 1000),
  ('36970000-0000-4000-8000-000000000732',
   (SELECT id FROM public.ad_connections WHERE platform = 'tiktok' AND lane = 'consumer'),
   'tiktok', 'pause-plan-one-tiktok', 'Pause plan one TikTok', 'TRAFFIC', 'PAUSED',
   'brand', 'issue-3697-pause-one', 'https://usemingla.com/b/one',
   'https://usemingla.com/b/one', 'mingla', 'USD', 'USD',
   '36970000-0000-4000-8000-000000000721', repeat('a', 64), 1000, 1000),
  ('36970000-0000-4000-8000-000000000733',
   (SELECT id FROM public.ad_connections WHERE platform = 'meta' AND lane = 'consumer'),
   'meta', 'pause-plan-two-meta', 'Pause plan two Meta', 'OUTCOME_TRAFFIC', 'PAUSED',
   'brand', 'issue-3697-pause-two', 'https://usemingla.com/b/two',
   'https://usemingla.com/b/two', 'mingla', 'USD', 'USD',
   '36970000-0000-4000-8000-000000000722', repeat('b', 64), 1000, 1000),
  ('36970000-0000-4000-8000-000000000734',
   (SELECT id FROM public.ad_connections WHERE platform = 'tiktok' AND lane = 'consumer'),
   'tiktok', 'pause-plan-two-tiktok', 'Pause plan two TikTok', 'TRAFFIC', 'ACTIVE',
   'brand', 'issue-3697-pause-two', 'https://usemingla.com/b/two',
   'https://usemingla.com/b/two', 'mingla', 'USD', 'USD',
   '36970000-0000-4000-8000-000000000722', repeat('b', 64), 1000, 1000);

SET LOCAL session_replication_role = origin;

DO $test$
DECLARE
  v_all_paused constant uuid := '36970000-0000-4000-8000-000000000701';
  v_partial constant uuid := '36970000-0000-4000-8000-000000000702';
  v_result jsonb;
  v_direct_rejected boolean := false;
BEGIN
  IF to_regprocedure('public.ad_plan_mark_paused(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'ad_plan_mark_paused_missing';
  END IF;
  IF has_function_privilege('anon', 'public.ad_plan_mark_paused(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.ad_plan_mark_paused(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.ad_plan_mark_paused(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ad_plan_mark_paused_acl_wrong';
  END IF;

  BEGIN
    UPDATE public.ad_plans SET state = 'paused' WHERE id = v_all_paused;
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_direct_rejected := SQLERRM = 'ad_plan_state_transition_invalid:live->paused';
  END;
  IF NOT v_direct_rejected THEN
    RAISE EXCEPTION 'direct_live_to_paused_bypassed_transition_guard';
  END IF;

  v_result := public.ad_plan_mark_paused(v_all_paused, 'spend_fetch_failed');
  IF v_result->>'state' <> 'paused'
     OR v_result->'transition_path' <> '["live","pause_requested","paused"]'::jsonb
     OR (SELECT state FROM public.ad_plans WHERE id = v_all_paused) <> 'paused' THEN
    RAISE EXCEPTION 'all_paused_transition_wrong:%', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ad_status_events
    WHERE action = 'pause'
      AND external_ids->>'plan_id' = v_all_paused::text
      AND provider_response->>'reason' = 'spend_fetch_failed'
      AND provider_response->>'source' = 'ad_plan_mark_paused'
  ) THEN
    RAISE EXCEPTION 'plan_pause_audit_missing';
  END IF;

  v_result := public.ad_plan_mark_paused(v_partial, 'cap_98_percent');
  IF v_result->>'state' <> 'partially_live'
     OR v_result->'transition_path' <> '["live","partially_live"]'::jsonb
     OR (SELECT state FROM public.ad_plans WHERE id = v_partial) <> 'partially_live' THEN
    RAISE EXCEPTION 'partial_pause_transition_wrong:%', v_result;
  END IF;

  UPDATE public.ad_campaigns
  SET status = 'PAUSED', auto_pause_reason = 'end_date_passed'
  WHERE id = '36970000-0000-4000-8000-000000000734';
  v_result := public.ad_plan_mark_paused(v_partial, 'end_date_passed');
  IF v_result->>'state' <> 'paused'
     OR v_result->'transition_path' <>
       '["partially_live","pause_requested","paused"]'::jsonb
     OR (SELECT auto_pause_reason FROM public.ad_campaigns
         WHERE id = '36970000-0000-4000-8000-000000000734') <> 'end_date_passed' THEN
    RAISE EXCEPTION 'partial_to_all_paused_transition_wrong:%', v_result;
  END IF;
END;
$test$;

ROLLBACK;
