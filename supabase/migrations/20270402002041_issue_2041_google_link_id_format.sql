-- Issue #2041: Google Ads Data Manager emits 32-character hexadecimal
-- shareable Link IDs. Preserve the audited safe-binding contract while
-- accepting that provider-authoritative format instead of digits only.

CREATE OR REPLACE FUNCTION public.set_ad_app_safe_binding(p_change jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_app text := p_change->>'app_key'; v_os text := p_change->>'os'; v_provider text := p_change->>'provider';
  v_contract text := p_change->>'provider_contract_kind'; v_app_id text := p_change->>'provider_app_id';
  v_measurement_id text := p_change->>'provider_measurement_id'; v_actor uuid := (p_change->>'actor')::uuid;
  v_reason text := btrim(p_change->>'reason'); v_expected bigint := (p_change->>'expected_current_version')::bigint;
  v_key uuid := (p_change->>'idempotency_key')::uuid; v_row public.ad_app_provider_bindings%ROWTYPE;
  v_prior jsonb; v_existing jsonb; v_expected_contract text; v_fingerprint text;
  v_existing_audit public.ad_app_binding_audit%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_change)<>'object'
     OR (p_change - ARRAY['app_key','os','provider','provider_contract_kind','provider_app_id','provider_measurement_id','actor','reason','expected_current_version','idempotency_key']) <> '{}'::jsonb
     OR v_app NOT IN ('explorer','business') OR v_os NOT IN ('ios','android')
     OR v_provider NOT IN ('meta','tiktok','snapchat','google','reddit')
     OR length(v_reason) NOT BETWEEN 8 AND 240
     OR NOT EXISTS (SELECT 1 FROM auth.users u JOIN public.admin_users a ON lower(a.email)=lower(u.email)
                    WHERE u.id=v_actor AND a.status='active' AND a.role IN ('owner','admin')) THEN
    RAISE EXCEPTION 'invalid_safe_binding_change';
  END IF;
  SELECT * INTO v_row FROM public.ad_app_provider_bindings
  WHERE app_key=v_app AND os=v_os AND provider=v_provider AND active=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'binding_target_mismatch'; END IF;
  v_fingerprint := md5(jsonb_build_object(
    'provider_contract_kind',v_contract,
    'provider_app_id',v_app_id,
    'provider_measurement_id',v_measurement_id,
    'reason',v_reason
  )::text);
  SELECT * INTO v_existing_audit FROM public.ad_app_binding_audit WHERE idempotency_key=v_key;
  IF FOUND THEN
    IF v_existing_audit.actor=v_actor
       AND v_existing_audit.app_key=v_app
       AND v_existing_audit.os=v_os
       AND v_existing_audit.provider=v_provider
       AND v_existing_audit.expected_binding_version=v_expected
       AND v_existing_audit.request_fingerprint=v_fingerprint THEN
      RETURN v_existing_audit.new_safe_values || jsonb_build_object('idempotent_replay',true);
    END IF;
    RAISE EXCEPTION 'idempotency_key_conflict';
  END IF;
  IF v_row.binding_version<>v_expected THEN RAISE EXCEPTION 'binding_version_conflict'; END IF;
  v_expected_contract := CASE v_provider WHEN 'google' THEN 'app_link' WHEN 'reddit' THEN 'campaign_store_binding' ELSE 'mobile_asset' END;
  IF v_contract<>v_expected_contract THEN RAISE EXCEPTION 'provider_contract_mismatch'; END IF;
  IF v_app_id IS NOT NULL AND (v_app_id<>btrim(v_app_id) OR v_app_id !~ '^[A-Za-z0-9._:@/-]{1,160}$') THEN RAISE EXCEPTION 'invalid_provider_app_id'; END IF;
  IF v_measurement_id IS NOT NULL AND (v_measurement_id<>btrim(v_measurement_id) OR v_measurement_id !~ '^[A-Za-z0-9._:@/-]{1,160}$') THEN RAISE EXCEPTION 'invalid_provider_measurement_id'; END IF;
  IF v_provider IN ('meta','tiktok') AND ((v_app_id IS NOT NULL AND v_app_id !~ '^[0-9]{6,32}$') OR (v_measurement_id IS NOT NULL AND v_measurement_id !~ '^[0-9]{6,32}$')) THEN RAISE EXCEPTION 'invalid_numeric_provider_id'; END IF;
  IF v_provider='snapchat' AND v_app_id IS NOT NULL AND v_app_id !~ '^[A-Za-z0-9_-]{6,80}$' THEN RAISE EXCEPTION 'invalid_snap_app_id'; END IF;
  IF v_provider='google' AND v_measurement_id IS NOT NULL AND v_measurement_id !~ '^[A-Fa-f0-9]{32}$' THEN RAISE EXCEPTION 'invalid_google_link_id'; END IF;
  IF v_provider IN ('meta','snapchat') AND v_app_id IS DISTINCT FROM v_measurement_id THEN RAISE EXCEPTION 'provider_measurement_identity_mismatch'; END IF;
  IF v_provider IN ('google','reddit') AND v_app_id IS NOT NULL AND v_app_id<>(SELECT store_identifier FROM public.ad_app_targets WHERE app_key=v_app AND os=v_os) THEN RAISE EXCEPTION 'store_identifier_mismatch'; END IF;
  IF v_provider IN ('meta','snapchat') AND EXISTS (
    SELECT 1 FROM public.ad_app_provider_bindings b WHERE b.app_key=v_app AND b.os<>v_os AND b.provider=v_provider
      AND b.provider_app_id IS NOT NULL AND b.provider_app_id<>v_app_id
  ) THEN RAISE EXCEPTION 'product_app_id_mismatch'; END IF;

  v_prior := jsonb_build_object('provider_contract_kind',v_row.provider_contract_kind,'provider_app_id',v_row.provider_app_id,'provider_measurement_id',v_row.provider_measurement_id,'binding_version',v_row.binding_version);
  v_existing := jsonb_build_object('app_key',v_app,'os',v_os,'provider',v_provider,'provider_contract_kind',v_contract,
    'provider_app_id',v_app_id,'provider_measurement_id',v_measurement_id,'binding_version',v_row.binding_version+1);
  BEGIN
    INSERT INTO public.ad_app_binding_audit(
      app_key,os,provider,action,actor,reason,idempotency_key,
      expected_binding_version,request_fingerprint,previous_safe_values,new_safe_values
    ) VALUES(
      v_app,v_os,v_provider,'safe_binding_replaced',v_actor,v_reason,v_key,
      v_expected,v_fingerprint,v_prior,v_existing
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing_audit FROM public.ad_app_binding_audit WHERE idempotency_key=v_key;
    IF FOUND
       AND v_existing_audit.actor=v_actor
       AND v_existing_audit.app_key=v_app
       AND v_existing_audit.os=v_os
       AND v_existing_audit.provider=v_provider
       AND v_existing_audit.expected_binding_version=v_expected
       AND v_existing_audit.request_fingerprint=v_fingerprint THEN
      RETURN v_existing_audit.new_safe_values || jsonb_build_object('idempotent_replay',true);
    END IF;
    RAISE EXCEPTION 'idempotency_key_conflict';
  END;
  UPDATE public.ad_app_provider_bindings SET provider_contract_kind=v_contract, provider_app_id=v_app_id,
    provider_measurement_id=v_measurement_id, binding_version=binding_version+1, readiness_invalidated_at=clock_timestamp(),
    native_binding_attested_at=NULL,native_binding_attestation_expires_at=NULL,native_binding_attestation_safe_id=NULL,
    native_binding_attestation_provenance=NULL,native_binding_attested_by=NULL,measurement_attested_at=NULL,
    measurement_attestation_expires_at=NULL,measurement_attestation_safe_id=NULL,measurement_attestation_provenance=NULL,
    measurement_attested_by=NULL
  WHERE app_key=v_app AND os=v_os AND provider=v_provider;
  UPDATE public.ad_app_measurement_configurations SET status='action_required',partner_active=false,
    install_mapping_enabled=false,privacy_status='action_required',safe_measurement_id=NULL,evidence_provenance=NULL,
    evidence_summary=NULL,checked_at=NULL,expires_at=NULL,checked_by=NULL,configuration_version=configuration_version+1
  WHERE app_key=v_app AND os=v_os AND provider=v_provider;
  UPDATE public.ad_app_acquisition_canaries SET status='not_started',founder_approval_reference=NULL,
    approved_spend_ceiling_cents=NULL,approved_currency=NULL,started_at=NULL,completed_at=NULL,
    safe_provider_campaign_id=NULL,safe_evidence=NULL,evidence_expires_at=NULL,canary_version=canary_version+1
  WHERE app_key=v_app AND os=v_os AND provider=v_provider;
  RETURN v_existing || jsonb_build_object('idempotent_replay',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_ad_app_safe_binding(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_ad_app_safe_binding(jsonb) TO service_role;
