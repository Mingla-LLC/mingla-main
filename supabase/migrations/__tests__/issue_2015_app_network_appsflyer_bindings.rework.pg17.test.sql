BEGIN;

DO $test$
DECLARE
  v_actor uuid := '20152015-2015-4015-8015-201520152015';
  v_other_actor uuid := '20152015-2015-4015-8015-201520152016';
  v_run uuid := gen_random_uuid();
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
  UPDATE public.ad_app_acquisition_canaries
  SET status='passed',founder_approval_reference='issue-2015-test-approval',
      approved_spend_ceiling_cents=100,approved_currency='USD',
      started_at=clock_timestamp()-interval '2 minutes',
      paused_at=clock_timestamp()-interval '1 minute',
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
  UPDATE public.ad_app_acquisition_canaries SET safe_evidence=jsonb_set(safe_evidence,'{install_timestamp}',to_jsonb((paused_at+interval '1 second')::text)) WHERE app_key='business' AND os='android' AND provider='reddit';
  IF public.can_create_native_app_campaign('business','android','reddit') THEN RAISE EXCEPTION 'post-pause install authorized creation'; END IF;

  UPDATE public.ad_app_acquisition_canaries
  SET safe_evidence=jsonb_set(safe_evidence,'{install_timestamp}',to_jsonb((clock_timestamp()-interval '90 seconds')::text)),
      evidence_expires_at=clock_timestamp()-interval '1 second'
  WHERE app_key='business' AND os='android' AND provider='reddit';
  IF public.can_create_native_app_campaign('business','android','reddit') THEN RAISE EXCEPTION 'expired evidence authorized creation'; END IF;
END;
$test$;

ROLLBACK;
