-- toward #3697 — provider-native app campaign execution authority.
-- Schema only: no provider object, campaign, activation, spend, or deploy.

BEGIN;

-- App-store destinations are first-class campaign/attribution destinations.
ALTER TABLE public.ad_campaigns
  DROP CONSTRAINT IF EXISTS ad_campaigns_dest_page_type_check;
ALTER TABLE public.ad_campaigns
  ADD CONSTRAINT ad_campaigns_dest_page_type_check CHECK (
    dest_page_type IN (
      'event', 'rsvp', 'trip', 'experience', 'brand', 'venue', 'reservation',
      'site', 'marketing', 'explorer_app', 'host_app'
    )
  );

ALTER TABLE public.ad_attribution_touches
  DROP CONSTRAINT IF EXISTS ad_attribution_touches_dest_page_type_check;
ALTER TABLE public.ad_attribution_touches
  ADD CONSTRAINT ad_attribution_touches_dest_page_type_check CHECK (
    dest_page_type IS NULL
    OR dest_page_type IN (
      'event', 'rsvp', 'trip', 'experience', 'brand', 'venue', 'reservation',
      'site', 'marketing', 'explorer_app', 'host_app'
    )
  );

COMMENT ON COLUMN public.ad_campaigns.dest_url IS
  'Ad-visible canonical destination: public usemingla.com URL for web campaigns, exact App Store/Play Store URL for provider-native app campaigns.';
COMMENT ON COLUMN public.ad_campaigns.dest_smart_link IS
  'Attribution/deep-link destination stored separately from dest_url: AppsFlyer OneLink for native-app campaigns; never substituted for a provider-required exact store URL.';

-- Snapchat APP_INSTALL creatives require a separately uploaded square app icon.
-- Keep that immutable provider asset next to the exact provider app binding.
ALTER TABLE public.ad_app_provider_bindings
  ADD COLUMN IF NOT EXISTS provider_app_icon_media_id text NULL;

DO $block$ BEGIN
  ALTER TABLE public.ad_app_provider_bindings
    ADD CONSTRAINT ad_app_provider_icon_shape_check CHECK (
      provider_app_icon_media_id IS NULL
      OR (
        provider = 'snapchat'
        AND provider_app_icon_media_id = btrim(provider_app_icon_media_id)
        AND provider_app_icon_media_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $block$;

ALTER TABLE public.ad_app_binding_audit
  DROP CONSTRAINT IF EXISTS ad_app_binding_audit_action_check;
ALTER TABLE public.ad_app_binding_audit
  ADD CONSTRAINT ad_app_binding_audit_action_check CHECK (
    action IN (
      'safe_binding_replaced', 'safe_app_icon_replaced',
      'dashboard_attested', 'canary_transitioned'
    )
  );

CREATE OR REPLACE FUNCTION public.set_ad_app_snap_icon(p_change jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_app text := p_change->>'app_key';
  v_os text := p_change->>'os';
  v_provider text := p_change->>'provider';
  v_icon text := btrim(p_change->>'provider_app_icon_media_id');
  v_actor uuid := (p_change->>'actor')::uuid;
  v_reason text := btrim(p_change->>'reason');
  v_expected bigint := (p_change->>'expected_current_version')::bigint;
  v_key uuid := (p_change->>'idempotency_key')::uuid;
  v_fingerprint text;
  v_row public.ad_app_provider_bindings%ROWTYPE;
  v_existing_audit public.ad_app_binding_audit%ROWTYPE;
  v_prior jsonb;
  v_next jsonb;
BEGIN
  IF jsonb_typeof(p_change) <> 'object'
     OR (p_change - ARRAY[
       'app_key','os','provider','provider_app_icon_media_id','actor','reason',
       'expected_current_version','idempotency_key'
     ]) <> '{}'::jsonb
     OR v_app NOT IN ('explorer','business')
     OR v_os NOT IN ('ios','android')
     OR v_provider <> 'snapchat'
     OR v_icon IS NULL
     OR v_icon !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR length(v_reason) NOT BETWEEN 8 AND 240
     OR NOT EXISTS (
       SELECT 1 FROM auth.users u
       JOIN public.admin_users a ON lower(a.email)=lower(u.email)
       WHERE u.id=v_actor AND a.status='active' AND a.role IN ('owner','admin')
     ) THEN
    RAISE EXCEPTION 'invalid_safe_app_icon_change';
  END IF;

  SELECT * INTO v_row
  FROM public.ad_app_provider_bindings
  WHERE app_key=v_app AND os=v_os AND provider='snapchat'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'app_binding_not_found'; END IF;

  v_fingerprint := substr(encode(extensions.digest(convert_to(
    jsonb_build_object(
      'app_key',v_app,'os',v_os,'provider','snapchat',
      'provider_app_icon_media_id',v_icon,'actor',v_actor,'reason',v_reason,
      'expected_current_version',v_expected
    )::text,'UTF8'),'sha256'),'hex'),1,32);
  SELECT * INTO v_existing_audit
  FROM public.ad_app_binding_audit
  WHERE idempotency_key=v_key;
  IF FOUND THEN
    IF v_existing_audit.actor=v_actor
       AND v_existing_audit.app_key=v_app
       AND v_existing_audit.os=v_os
       AND v_existing_audit.provider='snapchat'
       AND v_existing_audit.expected_binding_version=v_expected
       AND v_existing_audit.request_fingerprint=v_fingerprint THEN
      RETURN v_existing_audit.new_safe_values ||
        jsonb_build_object('idempotent_replay',true);
    END IF;
    RAISE EXCEPTION 'idempotency_key_conflict';
  END IF;
  IF v_row.binding_version <> v_expected THEN
    RAISE EXCEPTION 'app_binding_version_conflict';
  END IF;

  v_prior := jsonb_build_object(
    'provider_app_icon_media_id',v_row.provider_app_icon_media_id,
    'binding_version',v_row.binding_version
  );
  v_next := jsonb_build_object(
    'app_key',v_app,'os',v_os,'provider','snapchat',
    'provider_app_icon_media_id',v_icon,
    'binding_version',v_row.binding_version+1
  );

  BEGIN
    INSERT INTO public.ad_app_binding_audit(
      app_key,os,provider,action,actor,reason,idempotency_key,
      expected_binding_version,request_fingerprint,previous_safe_values,new_safe_values
    ) VALUES(
      v_app,v_os,'snapchat','safe_app_icon_replaced',v_actor,v_reason,v_key,
      v_expected,v_fingerprint,v_prior,v_next
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing_audit
    FROM public.ad_app_binding_audit WHERE idempotency_key=v_key;
    IF FOUND
       AND v_existing_audit.actor=v_actor
       AND v_existing_audit.app_key=v_app
       AND v_existing_audit.os=v_os
       AND v_existing_audit.provider='snapchat'
       AND v_existing_audit.expected_binding_version=v_expected
       AND v_existing_audit.request_fingerprint=v_fingerprint THEN
      RETURN v_existing_audit.new_safe_values ||
        jsonb_build_object('idempotent_replay',true);
    END IF;
    RAISE EXCEPTION 'idempotency_key_conflict';
  END;

  UPDATE public.ad_app_provider_bindings
  SET provider_app_icon_media_id=v_icon,
      binding_version=binding_version+1,
      readiness_invalidated_at=clock_timestamp(),
      native_binding_attested_at=NULL,
      native_binding_attestation_expires_at=NULL,
      native_binding_attestation_safe_id=NULL,
      native_binding_attestation_provenance=NULL,
      native_binding_attested_by=NULL
  WHERE app_key=v_app AND os=v_os AND provider='snapchat';

  UPDATE public.ad_app_acquisition_canaries
  SET status='not_started', founder_approval_reference=NULL,
      approved_spend_ceiling_cents=NULL, approved_currency=NULL,
      started_at=NULL, completed_at=NULL, safe_provider_campaign_id=NULL,
      safe_evidence=NULL, evidence_expires_at=NULL,
      canary_version=canary_version+1
  WHERE app_key=v_app AND os=v_os AND provider='snapchat';

  RETURN v_next || jsonb_build_object('idempotent_replay',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_ad_app_snap_icon(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_ad_app_snap_icon(jsonb) TO service_role;

-- Keep the single normal-create authority false unless the exact app/OS/provider
-- cell has current readiness, passed canary evidence, and (for Snap) an icon.
CREATE OR REPLACE FUNCTION public.can_create_native_app_campaign(
  p_app_key text,
  p_os text,
  p_provider text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=''
AS $function$
  SELECT COALESCE((
    SELECT c.value='true'::jsonb
    FROM public.admin_config c
    WHERE c.key='enable_native_app_campaign_creation'
  ),false)
  AND EXISTS (
    SELECT 1
    FROM public.ad_app_provider_bindings b
    JOIN public.ad_app_targets t
      ON t.app_key=b.app_key AND t.os=b.os AND t.active=true
    JOIN LATERAL (
      SELECT r.id,r.checked_at,r.stale_at
      FROM public.ad_app_readiness_runs r
      WHERE r.app_key=b.app_key AND r.os=b.os
      ORDER BY r.checked_at DESC,r.id DESC
      LIMIT 1
    ) latest ON true
    JOIN public.ad_app_readiness_results result
      ON result.run_id=latest.id AND result.provider=b.provider
    JOIN public.ad_app_acquisition_canaries canary
      ON canary.app_key=b.app_key AND canary.os=b.os AND canary.provider=b.provider
    WHERE b.app_key=p_app_key AND b.os=p_os AND b.provider=p_provider
      AND b.active=true
      AND b.provider_app_id IS NOT NULL
      AND b.provider_measurement_id IS NOT NULL
      AND (b.provider<>'snapchat' OR b.provider_app_icon_media_id IS NOT NULL)
      AND latest.checked_at>b.readiness_invalidated_at
      AND latest.stale_at>clock_timestamp()
      AND result.verdict='ready'
      AND canary.status='passed'
      AND canary.safe_evidence->>'result'='passed'
      AND canary.safe_evidence->>'store_identifier'=t.store_identifier
      AND canary.safe_evidence->>'device_os'=p_os
      AND canary.safe_evidence->>'media_source'=CASE p_provider
        WHEN 'meta' THEN 'facebook_int'
        WHEN 'tiktok' THEN 'tiktokglobal_int'
        WHEN 'snapchat' THEN 'snapchat_int'
        WHEN 'google' THEN 'googleadwords_int'
        WHEN 'reddit' THEN 'reddit_int'
        ELSE NULL
      END
      AND canary.safe_evidence->>'campaign_id'=canary.safe_provider_campaign_id
      AND (canary.safe_evidence->>'install_timestamp')::timestamptz>=canary.started_at
      AND (canary.safe_evidence->>'install_timestamp')::timestamptz<=canary.completed_at
      AND (canary.safe_evidence->>'install_timestamp')::timestamptz<canary.evidence_expires_at
      AND canary.completed_at IS NOT NULL
      AND canary.evidence_expires_at>clock_timestamp()
      AND public.is_safe_ad_app_canary_evidence(canary.safe_evidence)
  );
$function$;

REVOKE ALL ON FUNCTION public.can_create_native_app_campaign(text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_native_app_campaign(text,text,text)
  TO service_role;

COMMIT;
