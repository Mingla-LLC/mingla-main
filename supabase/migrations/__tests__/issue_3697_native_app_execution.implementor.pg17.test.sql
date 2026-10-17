BEGIN;

DO $test$
DECLARE
  v_actor uuid := gen_random_uuid();
  v_result jsonb;
  v_rejected boolean := false;
  v_campaign_constraint text;
  v_touch_constraint text;
BEGIN
  IF has_function_privilege(
    'authenticated',
    'public.set_ad_app_snap_icon(jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated can mutate the Snapchat app icon';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_campaign_constraint
  FROM pg_constraint
  WHERE conname='ad_campaigns_dest_page_type_check'
    AND conrelid='public.ad_campaigns'::regclass;
  SELECT pg_get_constraintdef(oid) INTO v_touch_constraint
  FROM pg_constraint
  WHERE conname='ad_attribution_touches_dest_page_type_check'
    AND conrelid='public.ad_attribution_touches'::regclass;
  IF v_campaign_constraint NOT LIKE '%explorer_app%'
     OR v_campaign_constraint NOT LIKE '%host_app%'
     OR v_touch_constraint NOT LIKE '%explorer_app%'
     OR v_touch_constraint NOT LIKE '%host_app%' THEN
    RAISE EXCEPTION 'native app destinations are missing from effective constraints';
  END IF;

  INSERT INTO auth.users(id,email)
  VALUES(v_actor,'issue-3697-native-app-admin@example.com');
  INSERT INTO public.admin_users(email,role,status)
  VALUES('issue-3697-native-app-admin@example.com','admin','active');

  UPDATE public.ad_app_acquisition_canaries
  SET status='expired',
      founder_approval_reference='issue-3697-test-approval',
      approved_spend_ceiling_cents=3000,
      approved_currency='USD'
  WHERE app_key='explorer' AND os='ios' AND provider='snapchat';

  SELECT public.set_ad_app_snap_icon(jsonb_build_object(
    'app_key','explorer',
    'os','ios',
    'provider','snapchat',
    'provider_app_icon_media_id','12345678-1234-4123-8123-123456789abc',
    'actor',v_actor::text,
    'reason','Record the exact Snapchat app icon media identifier.',
    'expected_current_version',1,
    'idempotency_key','36973697-3697-4697-8697-369736973697'
  )) INTO v_result;

  IF (v_result->>'binding_version')::bigint<>2
     OR (v_result->>'idempotent_replay')::boolean
     OR v_result->>'provider_app_icon_media_id'<>'12345678-1234-4123-8123-123456789abc' THEN
    RAISE EXCEPTION 'Snapchat icon did not advance exactly once: %',v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ad_app_provider_bindings
    WHERE app_key='explorer' AND os='ios' AND provider='snapchat'
      AND binding_version=2
      AND provider_app_icon_media_id='12345678-1234-4123-8123-123456789abc'
      AND native_binding_attested_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Snapchat icon was not persisted or readiness was not invalidated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ad_app_acquisition_canaries
    WHERE app_key='explorer' AND os='ios' AND provider='snapchat'
      AND status='not_started'
      AND founder_approval_reference IS NULL
      AND approved_spend_ceiling_cents IS NULL
      AND approved_currency IS NULL
  ) THEN
    RAISE EXCEPTION 'binding change did not reset prior canary authority';
  END IF;

  SELECT public.set_ad_app_snap_icon(jsonb_build_object(
    'app_key','explorer',
    'os','ios',
    'provider','snapchat',
    'provider_app_icon_media_id','12345678-1234-4123-8123-123456789abc',
    'actor',v_actor::text,
    'reason','Record the exact Snapchat app icon media identifier.',
    'expected_current_version',1,
    'idempotency_key','36973697-3697-4697-8697-369736973697'
  )) INTO v_result;
  IF NOT (v_result->>'idempotent_replay')::boolean
     OR (SELECT count(*) FROM public.ad_app_binding_audit
         WHERE idempotency_key='36973697-3697-4697-8697-369736973697')<>1 THEN
    RAISE EXCEPTION 'idempotent icon replay created duplicate state';
  END IF;

  BEGIN
    PERFORM public.set_ad_app_snap_icon(jsonb_build_object(
      'app_key','explorer',
      'os','android',
      'provider','snapchat',
      'provider_app_icon_media_id','not-a-provider-uuid',
      'actor',v_actor::text,
      'reason','Reject a malformed Snapchat app icon identifier.',
      'expected_current_version',1,
      'idempotency_key','36973697-3697-4697-8697-369736973698'
    ));
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLERRM LIKE '%invalid_safe_app_icon_change%';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'malformed Snapchat icon did not fail closed';
  END IF;

  IF public.can_create_native_app_campaign('explorer','ios','snapchat') THEN
    RAISE EXCEPTION 'default-off native campaign authority returned true';
  END IF;
END;
$test$;

ROLLBACK;
