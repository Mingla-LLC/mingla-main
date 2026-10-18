-- Issue #3697: executable owner-approval and certification authority proof.
-- MINGLA-INVARIANT: I-3697-NATIVE-CANARY-SCOPE | issue #3697 | A provider canary is bound to one immutable plan, app, OS, provider, currency, spend ceiling, expiring owner approval and append-only audit row.

\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_actor constant uuid := '36972000-0000-4000-8000-000000000001';
  v_connection constant uuid := '36972000-0000-4000-8000-000000000002';
  v_plan constant uuid := '36972000-0000-4000-8000-000000000003';
  v_version constant uuid := '36972000-0000-4000-8000-000000000004';
  v_run constant uuid := '36972000-0000-4000-8000-000000000005';
  v_campaign constant uuid := '36972000-0000-4000-8000-000000000006';
  v_hash constant text := repeat('c',64);
  v_result jsonb;
  v_install timestamptz;
  v_rejected boolean := false;
BEGIN
  IF has_function_privilege(
    'authenticated','public.transition_ad_app_canary(jsonb)','EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.can_create_native_app_canary(text,text,text,uuid,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated can invoke service-only canary authority';
  END IF;

  INSERT INTO auth.users(id,email)
  VALUES(v_actor,'issue-3697-canary-owner@example.test');
  INSERT INTO public.admin_users(email,role,status)
  VALUES('issue-3697-canary-owner@example.test','owner','active');
  INSERT INTO public.ad_connections(
    id,platform,lane,display_name,external_account_id,auth_kind,token_env_var,
    status,currency,connected
  ) VALUES(
    v_connection,'reddit','consumer','Issue 3697 canary Reddit',
    'reddit-3697-canary','refresh_token','ISSUE_3697_CANARY_REDDIT_TOKEN',
    'connected','USD',true
  );
  UPDATE public.ad_app_provider_bindings SET
    payer_connection_id=v_connection,
    provider_contract_kind='campaign_store_binding',
    provider_app_id='6760440898',
    provider_measurement_id='reddit-app-3697',
    readiness_invalidated_at=now()-interval '1 hour'
  WHERE app_key='explorer' AND os='ios' AND provider='reddit';

  INSERT INTO public.ad_app_readiness_runs(
    id,app_key,os,requested_by,checked_at,stale_at,duration_ms,provider_count
  ) VALUES(
    v_run,'explorer','ios',v_actor,now(),now()+interval '15 minutes',50,5
  );
  INSERT INTO public.ad_app_readiness_results(
    run_id,app_key,os,provider,verdict,reason_code,
    payer_evidence,identity_evidence,binding_evidence,
    measurement_evidence,funding_evidence
  ) VALUES(
    v_run,'explorer','ios','reddit','ready','ready',
    '{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb
  );
  IF NOT public.can_prepare_native_app_canary('explorer','ios','reddit') THEN
    RAISE EXCEPTION 'fresh exact readiness did not authorize preparation';
  END IF;

  INSERT INTO public.ad_plans(
    id,client_kind,owner_kind,brand_id,destination_family,destination_key,
    state,review_required,created_by
  ) VALUES(
    v_plan,'admin','mingla',NULL,'explorer_app','ios','funded_held',false,v_actor
  );
  INSERT INTO public.ad_plan_versions(
    id,plan_id,version_number,canonical_plan,destination_snapshot,plan_hash,
    host_currency,host_budget_cents,created_by
  ) VALUES(
    v_version,v_plan,1,
    '{"certification_mode":true,"platforms":["reddit"],"confirmation_phrase":"CREATE PAUSED"}'::jsonb,
    '{"app_key":"explorer","os":"ios","destination_family":"explorer_app","destination_key":"ios"}'::jsonb,
    v_hash,'USD',3000,v_actor
  );
  UPDATE public.ad_plans SET current_version_id=v_version WHERE id=v_plan;
  INSERT INTO public.ad_plan_provider_allocations(
    plan_version_id,platform,connection_id,host_currency,host_budget_cents,
    host_delivery_budget_cents,provider_currency,provider_budget_cents,
    provider_delivery_budget_cents
  ) VALUES(v_version,'reddit',v_connection,'USD',3000,3000,'USD',3000,3000);
  INSERT INTO public.ad_plan_targeting_snapshots(
    plan_version_id,platform,audience_intent,compiled_targeting,verdict,
    evidence_observed_at,compiler_version
  ) VALUES(
    v_version,'reddit','{"countries":["US"]}'::jsonb,
    '{"country_codes":["US"]}'::jsonb,'exact',now(),'v1.4-canary-test'
  );
  INSERT INTO public.ad_plan_funding_holds(
    plan_id,plan_version_id,plan_hash,brand_id,funding_source,currency,
    amount_cents,state
  ) VALUES(
    v_plan,v_version,v_hash,NULL,'mingla_provider_account','USD',3000,'held'
  );
  INSERT INTO public.ad_plan_confirmations(
    plan_id,plan_version_id,plan_hash,required_phrase,provided_phrase,confirmed_by
  ) VALUES(
    v_plan,v_version,v_hash,'CREATE PAUSED','CREATE PAUSED',v_actor
  );

  SELECT public.transition_ad_app_canary(jsonb_build_object(
    'action','request_approval','app_key','explorer','os','ios',
    'provider','reddit','actor',v_actor::text,
    'reason','Request the exact bounded Reddit certification canary.',
    'expected_canary_version',1,
    'idempotency_key','36972000-0000-4000-8000-000000000011',
    'plan_version_id',v_version::text,'plan_hash',v_hash
  )) INTO v_result;
  IF v_result->>'status'<>'approval_required'
     OR v_result->>'approved_currency'<>'USD'
     OR (v_result->>'approved_spend_ceiling_cents')::bigint<>3000
     OR v_result->>'required_phrase'<>'APPROVE REDDIT EXPLORER IOS USD 3000'
     OR (v_result->>'canary_version')::bigint<>2 THEN
    RAISE EXCEPTION 'approval request did not freeze the exact scope: %',v_result;
  END IF;

  BEGIN
    PERFORM public.transition_ad_app_canary(jsonb_build_object(
      'action','approve','app_key','explorer','os','ios','provider','reddit',
      'actor',v_actor::text,'reason','Reject an inexact typed approval phrase.',
      'expected_canary_version',2,
      'idempotency_key','36972000-0000-4000-8000-000000000012',
      'approval_reference','issue-3697-test-approval',
      'confirm_phrase','APPROVE REDDIT EXPLORER IOS USD 2999'
    ));
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLERRM LIKE '%canary_approval_invalid%';
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'inexact approval phrase was accepted'; END IF;

  SELECT public.transition_ad_app_canary(jsonb_build_object(
    'action','approve','app_key','explorer','os','ios','provider','reddit',
    'actor',v_actor::text,'reason','Approve the exact bounded Reddit certification canary.',
    'expected_canary_version',2,
    'idempotency_key','36972000-0000-4000-8000-000000000013',
    'approval_reference','issue-3697-test-approval',
    'confirm_phrase','APPROVE REDDIT EXPLORER IOS USD 3000'
  )) INTO v_result;
  IF v_result->>'status'<>'approved_to_prepare'
     OR (v_result->>'canary_version')::bigint<>3
     OR (v_result->>'idempotent_replay')::boolean THEN
    RAISE EXCEPTION 'exact owner approval did not advance once: %',v_result;
  END IF;
  IF NOT public.can_create_native_app_canary(
    'explorer','ios','reddit',v_version,v_hash
  ) THEN
    RAISE EXCEPTION 'approved exact canary was not creatable';
  END IF;
  IF public.can_create_native_app_campaign('explorer','ios','reddit') THEN
    RAISE EXCEPTION 'canary approval leaked into normal campaign authority';
  END IF;

  SELECT public.transition_ad_app_canary(jsonb_build_object(
    'action','approve','app_key','explorer','os','ios','provider','reddit',
    'actor',v_actor::text,'reason','Approve the exact bounded Reddit certification canary.',
    'expected_canary_version',2,
    'idempotency_key','36972000-0000-4000-8000-000000000013',
    'approval_reference','issue-3697-test-approval',
    'confirm_phrase','APPROVE REDDIT EXPLORER IOS USD 3000'
  )) INTO v_result;
  IF NOT (v_result->>'idempotent_replay')::boolean
     OR (SELECT count(*) FROM public.ad_app_canary_audit
         WHERE idempotency_key='36972000-0000-4000-8000-000000000013')<>1 THEN
    RAISE EXCEPTION 'owner approval replay was not idempotent';
  END IF;

  UPDATE public.ad_plans SET state='creating_paused_objects' WHERE id=v_plan;
  INSERT INTO public.ad_campaigns(
    id,connection_id,platform,external_campaign_id,name,objective,status,
    dest_page_type,dest_brand_slug,dest_entity_slug,dest_url,dest_smart_link,
    brand_id,owner_kind,currency,plan_version_id,plan_hash,host_currency,
    provider_currency,host_budget_cents,provider_budget_cents,
    provider_delivery_budget_cents
  ) VALUES(
    v_campaign,v_connection,'reddit','reddit-canary-3697',
    'Issue 3697 certification canary','APP_INSTALLS','PAUSED',
    'explorer_app','mingla','ios','https://apps.apple.com/app/id6760440898',
    'https://go.usemingla.com/w36m',NULL,'mingla','USD',v_version,v_hash,
    'USD','USD',3000,3000,3000
  );
  SELECT public.transition_ad_app_canary(jsonb_build_object(
    'action','provider_prepared','app_key','explorer','os','ios',
    'provider','reddit','actor',v_actor::text,
    'reason','Record the paused Reddit certification campaign.',
    'expected_canary_version',3,
    'idempotency_key','36972000-0000-4000-8000-000000000014',
    'external_campaign_id','reddit-canary-3697',
    'local_campaign_id',v_campaign::text,
    'provider_effective_status','PAUSED'
  )) INTO v_result;
  IF v_result->>'status'<>'paused_ready'
     OR NOT public.can_run_native_app_canary(
       'explorer','ios','reddit',v_version,v_hash
     ) THEN
    RAISE EXCEPTION 'paused provider campaign did not enter runnable authority';
  END IF;

  UPDATE public.ad_plan_funding_holds SET state='released'
  WHERE plan_version_id=v_version;
  IF public.can_run_native_app_canary(
    'explorer','ios','reddit',v_version,v_hash
  ) THEN
    RAISE EXCEPTION 'released funding still authorized canary activation';
  END IF;
  UPDATE public.ad_plan_funding_holds SET state='held'
  WHERE plan_version_id=v_version;
  UPDATE public.ad_plans SET state='live' WHERE id=v_plan;

  SELECT public.transition_ad_app_canary(jsonb_build_object(
    'action','provider_started','app_key','explorer','os','ios',
    'provider','reddit','actor',v_actor::text,
    'reason','Record provider-confirmed certification activation.',
    'expected_canary_version',4,
    'idempotency_key','36972000-0000-4000-8000-000000000015',
    'provider_effective_status','ACTIVE'
  )) INTO v_result;
  PERFORM public.ad_request_campaign_stop(v_campaign,now());
  SELECT public.transition_ad_app_canary(jsonb_build_object(
    'action','provider_stopped','app_key','explorer','os','ios',
    'provider','reddit','actor',v_actor::text,
    'reason','Record provider-confirmed certification stop.',
    'expected_canary_version',5,
    'idempotency_key','36972000-0000-4000-8000-000000000016',
    'provider_effective_status','PAUSED','actual_spend_cents',0
  )) INTO v_result;
  IF v_result->>'status'<>'paused_pending_evidence' THEN
    RAISE EXCEPTION 'provider stop did not wait for final spend evidence';
  END IF;
  BEGIN
    UPDATE public.ad_campaign_settlements
    SET state='attention_required',final_provider_spend_cents=4000
    WHERE campaign_id=v_campaign;
    SELECT public.transition_ad_app_canary(jsonb_build_object(
      'action','spend_exceeded','app_key','explorer','os','ios',
      'provider','reddit','actor',v_actor::text,
      'reason','Fail the canary after authoritative spend exceeds its ceiling.',
      'expected_canary_version',6,
      'idempotency_key','36972000-0000-4000-8000-000000000018'
    )) INTO v_result;
    IF v_result->>'status'<>'failed'
       OR (v_result->>'actual_spend_cents')::bigint<>4000 THEN
      RAISE EXCEPTION 'over-cap final spend did not fail the canary';
    END IF;
    RAISE EXCEPTION 'rollback_overcap_branch';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'rollback_overcap_branch' THEN RAISE; END IF;
  END;
  PERFORM public.ad_confirm_campaign_stop(
    v_campaign,100,'USD',now(),'{"source":"certification-test"}'::jsonb,
    interval '0'
  );
  PERFORM public.ad_finalize_campaign_settlement(
    v_campaign,'issue-3697-canary-final-spend',now()+interval '1 second'
  );
  SELECT started_at INTO v_install
  FROM public.ad_app_acquisition_canaries
  WHERE app_key='explorer' AND os='ios' AND provider='reddit';
  SELECT public.transition_ad_app_canary(jsonb_build_object(
    'action','evidence_passed','app_key','explorer','os','ios',
    'provider','reddit','actor',v_actor::text,
    'reason','Record final server-bound certification install evidence.',
    'expected_canary_version',6,
    'idempotency_key','36972000-0000-4000-8000-000000000017',
    'safe_evidence',jsonb_build_object(
      'provenance','provider_api','store_identifier','6760440898',
      'media_source','reddit_int','campaign_id','reddit-canary-3697',
      'install_timestamp',v_install,'device_os','ios','result','passed'
    )
  )) INTO v_result;
  IF v_result->>'status'<>'passed'
     OR (v_result->>'actual_spend_cents')::bigint<>100 THEN
    RAISE EXCEPTION 'final spend and bounded evidence were not authoritative: %',v_result;
  END IF;

  UPDATE public.ad_app_acquisition_canaries SET
    status='not_started',canary_version=canary_version+1
  WHERE app_key='explorer' AND os='ios' AND provider='reddit';
  IF EXISTS(
    SELECT 1 FROM public.ad_app_acquisition_canaries
    WHERE app_key='explorer' AND os='ios' AND provider='reddit'
      AND (plan_version_id IS NOT NULL OR founder_approval_reference IS NOT NULL
        OR approved_spend_ceiling_cents IS NOT NULL OR approved_by IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'not_started reset retained stale certification authority';
  END IF;

  v_rejected := false;
  BEGIN
    UPDATE public.ad_app_canary_audit SET reason='mutated evidence'
    WHERE idempotency_key='36972000-0000-4000-8000-000000000013';
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLERRM LIKE '%ad_app_canary_audit_immutable%';
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'canary audit row was mutable'; END IF;
END;
$test$;

ROLLBACK;
