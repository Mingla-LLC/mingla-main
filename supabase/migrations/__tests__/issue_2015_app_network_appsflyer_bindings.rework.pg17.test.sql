BEGIN;

DO $test$
DECLARE
  v_actor uuid := '20152015-2015-4015-8015-201520152015';
  v_other_actor uuid := '20152015-2015-4015-8015-201520152016';
  v_run uuid := gen_random_uuid();
  v_connection uuid := '20152015-2015-4015-8015-201520152020';
  v_plan uuid := '20152015-2015-4015-8015-201520152017';
  v_plan_version uuid := '20152015-2015-4015-8015-201520152018';
  v_campaign uuid := '20152015-2015-4015-8015-201520152019';
  v_checked timestamptz := clock_timestamp();
  v_change jsonb;
  v_result jsonb;
  v_failed boolean;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (v_actor,'issue-2015-rework-admin@example.com'),
    (v_other_actor,'issue-2015-rework-other@example.com');
  INSERT INTO public.admin_users(email,role,status) VALUES
    ('issue-2015-rework-admin@example.com','admin','active'),
    ('issue-2015-rework-other@example.com','admin','active');

  -- Meta and Snap must use one semantic identity on both native and AppsFlyer sides.
  FOREACH v_change IN ARRAY ARRAY[
    jsonb_build_object(
      'app_key','business','os','ios','provider','meta',
      'provider_contract_kind','mobile_asset',
      'provider_app_id','123456789','provider_measurement_id','987654321',
      'actor',v_actor::text,'reason','Reject cross-app Meta identity.',
      'expected_current_version',1,
      'idempotency_key','20150000-0000-4000-8000-000000000001'
    ),
    jsonb_build_object(
      'app_key','business','os','ios','provider','snapchat',
      'provider_contract_kind','mobile_asset',
      'provider_app_id','snap_business','provider_measurement_id','snap_explorer',
      'actor',v_actor::text,'reason','Reject cross-app Snap identity.',
      'expected_current_version',1,
      'idempotency_key','20150000-0000-4000-8000-000000000002'
    )
  ] LOOP
    v_failed := false;
    BEGIN
      PERFORM public.set_ad_app_safe_binding(v_change);
    EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM LIKE '%provider_measurement_identity_mismatch%';
    END;
    IF NOT v_failed THEN
      RAISE EXCEPTION 'Meta/Snap semantic mismatch was accepted: %',v_change;
    END IF;
  END LOOP;

  -- One key is scoped to one actor, target, expected version, and fingerprint.
  v_change := jsonb_build_object(
    'app_key','explorer','os','ios','provider','tiktok',
    'provider_contract_kind','mobile_asset',
    'provider_app_id','7659045322872684562',
    'provider_measurement_id','7659045322872668178',
    'actor',v_actor::text,'reason','Record exact TikTok identities.',
    'expected_current_version',1,
    'idempotency_key','20150000-0000-4000-8000-000000000010'
  );
  SELECT public.set_ad_app_safe_binding(v_change) INTO v_result;
  IF (v_result->>'idempotent_replay')::boolean THEN
    RAISE EXCEPTION 'first safe-binding request replayed';
  END IF;
  SELECT public.set_ad_app_safe_binding(v_change) INTO v_result;
  IF NOT (v_result->>'idempotent_replay')::boolean THEN
    RAISE EXCEPTION 'exact safe-binding replay did not converge';
  END IF;

  FOREACH v_change IN ARRAY ARRAY[
    v_change || jsonb_build_object('provider_measurement_id','7659045322872668179'),
    v_change || jsonb_build_object('app_key','business'),
    v_change || jsonb_build_object('actor',v_other_actor::text)
  ] LOOP
    v_failed := false;
    BEGIN
      PERFORM public.set_ad_app_safe_binding(v_change);
    EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM LIKE '%idempotency_key_conflict%';
    END;
    IF NOT v_failed THEN
      RAISE EXCEPTION 'scoped idempotency-key reuse was accepted: %',v_change;
    END IF;
  END LOOP;

  v_failed := false;
  BEGIN
    PERFORM public.set_ad_app_safe_binding(jsonb_build_object(
      'app_key','explorer','os','ios','provider','tiktok',
      'provider_contract_kind','mobile_asset',
      'provider_app_id','7659045322872684562',
      'provider_measurement_id','7659045322872668178',
      'actor',v_actor::text,'reason','Reject stale expected version.',
      'expected_current_version',1,
      'idempotency_key','20150000-0000-4000-8000-000000000011'
    ));
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE '%binding_version_conflict%';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'stale version did not conflict'; END IF;

  -- Build one otherwise-valid exact Reddit cell, then attack every canary link.
  UPDATE public.admin_config
  SET value='true'::jsonb
  WHERE key='enable_native_app_campaign_creation';
  UPDATE public.ad_app_provider_bindings
  SET provider_app_id='com.sethogieva.minglabusiness',
      provider_measurement_id='reddit-business-link',
      readiness_invalidated_at=clock_timestamp()-interval '10 minutes'
  WHERE app_key='business' AND os='android' AND provider='reddit';
  INSERT INTO public.ad_app_readiness_runs(
    id,app_key,os,requested_by,checked_at,stale_at,duration_ms,provider_count
  ) VALUES(
    v_run,'business','android',v_actor,v_checked,
    v_checked+interval '15 minutes',10,5
  );
  INSERT INTO public.ad_app_readiness_results(
    run_id,app_key,os,provider,verdict,reason_code,
    owner_label,action_code,action_href,
    payer_evidence,identity_evidence,binding_evidence,
    measurement_evidence,funding_evidence
  ) VALUES(
    v_run,'business','android','reddit','ready','all_required_dimensions_proven',
    NULL,NULL,NULL,'{}','{}','{}','{}','{}'
  );

  -- [TEST-MOD-APPROVED #3697] The v1.4 control plane makes the approval,
  -- immutable plan, paused provider object, and stop receipt part of every
  -- passed canary. Preserve this test's AppsFlyer-binding attacks while using
  -- a fixture that satisfies the stronger lifecycle contract.
  INSERT INTO public.ad_connections(
    id,platform,lane,display_name,external_account_id,auth_kind,token_env_var,
    status,currency,connected,connected_by
  ) VALUES(
    v_connection,'reddit','business','Issue 2015 Reddit fixture','reddit-2015',
    'system_user_token','REDDIT_ACCESS_TOKEN','connected','USD',true,v_actor
  );
  INSERT INTO public.ad_plans(
    id,client_kind,owner_kind,destination_family,destination_key,state,created_by
  ) VALUES(
    v_plan,'admin','mingla','host_app','business:android','paused',v_actor
  );
  INSERT INTO public.ad_plan_versions(
    id,plan_id,version_number,canonical_plan,destination_snapshot,plan_hash,
    host_currency,host_budget_cents,created_by
  ) VALUES(
    v_plan_version,v_plan,1,'{}'::jsonb,'{}'::jsonb,repeat('a',64),
    'USD',100,v_actor
  );
  UPDATE public.ad_plans
  SET current_version_id=v_plan_version
  WHERE id=v_plan;
  INSERT INTO public.ad_campaigns(
    id,connection_id,platform,external_campaign_id,name,objective,status,
    daily_budget_cents,targeting,dest_page_type,dest_brand_slug,dest_url,
    dest_smart_link,request_id,created_by,owner_kind,cap_cents,
    lifetime_budget_cents,currency,host_currency,provider_currency,
    currency_status
  ) VALUES(
    v_campaign,v_connection,'reddit','reddit-canary-2015',
    'Issue 2015 binding canary','APP_INSTALLS','PAUSED',100,'{}'::jsonb,
    'host_app','mingla','https://usemingla.com/','https://usemingla.com/',
    'issue-2015-rework-canary',v_actor,'mingla',100,100,'USD','USD','USD',
    'aligned'
  );
  UPDATE public.ad_app_acquisition_canaries
  SET status='passed',founder_approval_reference='issue-2015-test-approval',
      approved_spend_ceiling_cents=100,approved_currency='USD',
      plan_version_id=v_plan_version,
      plan_hash=repeat('a',64),
      approval_scope_hash=repeat('b',64),
      approval_requested_by=v_actor,
      approval_requested_at=clock_timestamp()-interval '3 minutes',
      approved_by=v_actor,
      approved_at=clock_timestamp()-interval '150 seconds',
      approval_expires_at=clock_timestamp()+interval '1 hour',
      local_campaign_id=v_campaign,
      provider_objects_created_at=clock_timestamp()-interval '2 minutes',
      started_at=clock_timestamp()-interval '2 minutes',
      completed_at=clock_timestamp()-interval '1 minute',
      provider_stop_confirmed_at=clock_timestamp()-interval '1 minute',
      actual_spend_cents=0,
      safe_provider_campaign_id='reddit-canary-2015',
      safe_evidence=jsonb_build_object(
        'provenance','appsflyer_api',
        'store_identifier','com.sethogieva.minglabusiness',
        'media_source','reddit_int',
        'campaign_id','reddit-canary-2015',
        'install_timestamp',(clock_timestamp()-interval '90 seconds')::text,
        'device_os','android','result','passed'
      ),
      evidence_expires_at=clock_timestamp()+interval '10 minutes'
  WHERE app_key='business' AND os='android' AND provider='reddit';

  IF NOT public.can_create_native_app_campaign('business','android','reddit') THEN
    RAISE EXCEPTION 'valid exact canary did not satisfy the isolated test gate';
  END IF;

  UPDATE public.ad_app_acquisition_canaries SET safe_evidence=jsonb_set(safe_evidence,'{result}','"failed"')
  WHERE app_key='business' AND os='android' AND provider='reddit';
  IF public.can_create_native_app_campaign('business','android','reddit') THEN RAISE EXCEPTION 'failed result authorized creation'; END IF;
  UPDATE public.ad_app_acquisition_canaries SET safe_evidence=jsonb_set(safe_evidence,'{result}','"passed"') WHERE app_key='business' AND os='android' AND provider='reddit';

  UPDATE public.ad_app_acquisition_canaries SET safe_evidence=jsonb_set(safe_evidence,'{store_identifier}','"com.mingla.app.v2"') WHERE app_key='business' AND os='android' AND provider='reddit';
  IF public.can_create_native_app_campaign('business','android','reddit') THEN RAISE EXCEPTION 'wrong store authorized creation'; END IF;
  UPDATE public.ad_app_acquisition_canaries SET safe_evidence=jsonb_set(safe_evidence,'{store_identifier}','"com.sethogieva.minglabusiness"') WHERE app_key='business' AND os='android' AND provider='reddit';

  UPDATE public.ad_app_acquisition_canaries SET safe_evidence=jsonb_set(safe_evidence,'{device_os}','"ios"') WHERE app_key='business' AND os='android' AND provider='reddit';
  IF public.can_create_native_app_campaign('business','android','reddit') THEN RAISE EXCEPTION 'wrong OS authorized creation'; END IF;
  UPDATE public.ad_app_acquisition_canaries SET safe_evidence=jsonb_set(safe_evidence,'{device_os}','"android"') WHERE app_key='business' AND os='android' AND provider='reddit';

  UPDATE public.ad_app_acquisition_canaries SET safe_evidence=jsonb_set(safe_evidence,'{media_source}','"facebook_int"') WHERE app_key='business' AND os='android' AND provider='reddit';
  IF public.can_create_native_app_campaign('business','android','reddit') THEN RAISE EXCEPTION 'wrong provider/media source authorized creation'; END IF;
  UPDATE public.ad_app_acquisition_canaries SET safe_evidence=jsonb_set(safe_evidence,'{media_source}','"reddit_int"') WHERE app_key='business' AND os='android' AND provider='reddit';

  UPDATE public.ad_app_acquisition_canaries SET safe_evidence=jsonb_set(safe_evidence,'{campaign_id}','"other-campaign"') WHERE app_key='business' AND os='android' AND provider='reddit';
  IF public.can_create_native_app_campaign('business','android','reddit') THEN RAISE EXCEPTION 'wrong campaign authorized creation'; END IF;
  UPDATE public.ad_app_acquisition_canaries SET safe_evidence=jsonb_set(safe_evidence,'{campaign_id}','"reddit-canary-2015"') WHERE app_key='business' AND os='android' AND provider='reddit';

  UPDATE public.ad_app_acquisition_canaries SET safe_evidence=jsonb_set(safe_evidence,'{install_timestamp}',to_jsonb((started_at-interval '1 second')::text)) WHERE app_key='business' AND os='android' AND provider='reddit';
  IF public.can_create_native_app_campaign('business','android','reddit') THEN RAISE EXCEPTION 'pre-start install authorized creation'; END IF;
  UPDATE public.ad_app_acquisition_canaries SET safe_evidence=jsonb_set(safe_evidence,'{install_timestamp}',to_jsonb((completed_at+interval '1 second')::text)) WHERE app_key='business' AND os='android' AND provider='reddit';
  IF public.can_create_native_app_campaign('business','android','reddit') THEN RAISE EXCEPTION 'post-completion install authorized creation'; END IF;

  UPDATE public.ad_app_acquisition_canaries
  SET safe_evidence=jsonb_set(safe_evidence,'{install_timestamp}',to_jsonb((clock_timestamp()-interval '90 seconds')::text)),
      evidence_expires_at=clock_timestamp()-interval '1 second'
  WHERE app_key='business' AND os='android' AND provider='reddit';
  IF public.can_create_native_app_campaign('business','android','reddit') THEN RAISE EXCEPTION 'expired evidence authorized creation'; END IF;
END;
$test$;

ROLLBACK;
