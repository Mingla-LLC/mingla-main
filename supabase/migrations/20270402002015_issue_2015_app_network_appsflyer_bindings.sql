-- Issue #2015 Phase A — provider-correct app-acquisition registry authority.
-- Default OFF: this migration cannot create provider objects, campaigns, or spend.

ALTER TABLE public.ad_app_provider_bindings
  ADD COLUMN IF NOT EXISTS provider_contract_kind text,
  ADD COLUMN IF NOT EXISTS binding_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS readiness_invalidated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.ad_app_provider_bindings
SET provider_contract_kind = CASE provider
  WHEN 'google' THEN 'app_link'
  WHEN 'reddit' THEN 'campaign_store_binding'
  ELSE 'mobile_asset'
END
WHERE provider_contract_kind IS NULL;

ALTER TABLE public.ad_app_provider_bindings
  ALTER COLUMN provider_contract_kind SET NOT NULL;

DO $block$ BEGIN
  ALTER TABLE public.ad_app_provider_bindings
    ADD CONSTRAINT ad_app_provider_contract_kind_check
    CHECK (provider_contract_kind IN ('mobile_asset','app_link','campaign_store_binding'));
EXCEPTION WHEN duplicate_object THEN NULL; END $block$;

DO $block$ BEGIN
  ALTER TABLE public.ad_app_provider_bindings
    ADD CONSTRAINT ad_app_provider_contract_matches_provider_check
    CHECK (
      (provider IN ('meta','tiktok','snapchat') AND provider_contract_kind='mobile_asset') OR
      (provider='google' AND provider_contract_kind='app_link') OR
      (provider='reddit' AND provider_contract_kind='campaign_store_binding')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $block$;

CREATE TABLE public.ad_app_measurement_configurations (
  app_key text NOT NULL,
  os text NOT NULL CHECK (os IN ('ios','android')),
  provider text NOT NULL CHECK (provider IN ('meta','tiktok','snapchat','google','reddit')),
  status text NOT NULL DEFAULT 'action_required'
    CHECK (status IN ('proven','action_required','blocked','not_applicable')),
  partner_active boolean NOT NULL DEFAULT false,
  install_mapping_enabled boolean NOT NULL DEFAULT false,
  privacy_status text NOT NULL DEFAULT 'action_required'
    CHECK (privacy_status IN ('proven','action_required','not_applicable')),
  safe_measurement_id text NULL,
  evidence_provenance text NULL
    CHECK (evidence_provenance IS NULL OR evidence_provenance IN ('appsflyer_api','appsflyer_dashboard')),
  evidence_summary text NULL CHECK (evidence_summary IS NULL OR length(evidence_summary) BETWEEN 1 AND 240),
  checked_at timestamptz NULL,
  expires_at timestamptz NULL,
  checked_by uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  configuration_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_key,os,provider),
  FOREIGN KEY (app_key,os,provider)
    REFERENCES public.ad_app_provider_bindings(app_key,os,provider) ON DELETE RESTRICT,
  CHECK (safe_measurement_id IS NULL OR safe_measurement_id ~ '^[A-Za-z0-9._:@/-]{1,160}$'),
  CHECK (
    (checked_at IS NULL AND expires_at IS NULL AND checked_by IS NULL AND evidence_provenance IS NULL)
    OR
    (checked_at IS NOT NULL AND expires_at=checked_at+interval '15 minutes' AND checked_by IS NOT NULL AND evidence_provenance IS NOT NULL)
  ),
  CHECK (status <> 'proven' OR (partner_active AND install_mapping_enabled AND privacy_status IN ('proven','not_applicable')))
);

INSERT INTO public.ad_app_measurement_configurations(app_key,os,provider)
SELECT app_key,os,provider FROM public.ad_app_provider_bindings
ON CONFLICT (app_key,os,provider) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_safe_ad_app_canary_evidence(p_evidence jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $function$
  SELECT p_evidence IS NULL OR (
    jsonb_typeof(p_evidence)='object'
    AND (p_evidence - ARRAY[
      'provenance','store_identifier','media_source','campaign_id',
      'install_timestamp','device_os','result'
    ])='{}'::jsonb
    AND (p_evidence->>'provenance') IN ('provider_api','appsflyer_api','provider_dashboard')
    AND length(p_evidence->>'store_identifier') BETWEEN 1 AND 160
    AND (p_evidence->>'store_identifier') ~ '^[A-Za-z0-9._:@/-]+$'
    AND length(p_evidence->>'media_source') BETWEEN 1 AND 80
    AND (p_evidence->>'media_source') ~ '^[A-Za-z0-9._:@/-]+$'
    AND length(p_evidence->>'campaign_id') BETWEEN 1 AND 160
    AND (p_evidence->>'campaign_id') ~ '^[A-Za-z0-9._:@/-]+$'
    AND (p_evidence->>'install_timestamp')::timestamptz IS NOT NULL
    AND (p_evidence->>'device_os') IN ('ios','android')
    AND (p_evidence->>'result') IN ('passed','failed')
  );
$function$;

CREATE TABLE public.ad_app_acquisition_canaries (
  app_key text NOT NULL,
  os text NOT NULL CHECK (os IN ('ios','android')),
  provider text NOT NULL CHECK (provider IN ('meta','tiktok','snapchat','google','reddit')),
  status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started','approval_required','paused_ready','running','passed','failed','expired')),
  founder_approval_reference text NULL,
  approved_spend_ceiling_cents bigint NULL CHECK (approved_spend_ceiling_cents >= 0),
  approved_currency text NULL CHECK (approved_currency IS NULL OR approved_currency ~ '^[A-Z]{3}$'),
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  safe_provider_campaign_id text NULL CHECK (safe_provider_campaign_id IS NULL OR safe_provider_campaign_id ~ '^[A-Za-z0-9._:@/-]{1,160}$'),
  safe_evidence jsonb NULL CHECK (public.is_safe_ad_app_canary_evidence(safe_evidence)),
  evidence_expires_at timestamptz NULL,
  canary_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_key,os,provider),
  FOREIGN KEY (app_key,os,provider)
    REFERENCES public.ad_app_provider_bindings(app_key,os,provider) ON DELETE RESTRICT,
  CHECK (status NOT IN ('paused_ready','running','passed') OR (founder_approval_reference IS NOT NULL AND approved_spend_ceiling_cents IS NOT NULL AND approved_currency IS NOT NULL)),
  CHECK (status <> 'running' OR started_at IS NOT NULL),
  CHECK (status NOT IN ('passed','failed') OR (started_at IS NOT NULL AND completed_at IS NOT NULL AND safe_provider_campaign_id IS NOT NULL AND safe_evidence IS NOT NULL))
);

INSERT INTO public.ad_app_acquisition_canaries(app_key,os,provider)
SELECT app_key,os,provider FROM public.ad_app_provider_bindings
ON CONFLICT (app_key,os,provider) DO NOTHING;

CREATE TABLE public.ad_app_binding_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_key text NOT NULL,
  os text NOT NULL CHECK (os IN ('ios','android')),
  provider text NOT NULL CHECK (provider IN ('meta','tiktok','snapchat','google','reddit')),
  action text NOT NULL CHECK (action IN ('safe_binding_replaced','dashboard_attested','canary_transitioned')),
  actor uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 240),
  idempotency_key uuid NOT NULL UNIQUE,
  expected_binding_version bigint NOT NULL CHECK (expected_binding_version >= 1),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{32}$'),
  previous_safe_values jsonb NOT NULL CHECK (jsonb_typeof(previous_safe_values)='object'),
  new_safe_values jsonb NOT NULL CHECK (jsonb_typeof(new_safe_values)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (app_key,os,provider)
    REFERENCES public.ad_app_provider_bindings(app_key,os,provider) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.tg_ad_app_binding_audit_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $function$
BEGIN
  RAISE EXCEPTION 'app_binding_audit_immutable';
END;
$function$;

CREATE TRIGGER trg_ad_app_binding_audit_immutable
BEFORE UPDATE OR DELETE ON public.ad_app_binding_audit
FOR EACH ROW EXECUTE FUNCTION public.tg_ad_app_binding_audit_immutable();

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
  IF v_provider='google' AND v_measurement_id IS NOT NULL AND v_measurement_id !~ '^[0-9]{4,32}$' THEN RAISE EXCEPTION 'invalid_google_link_id'; END IF;
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

ALTER TABLE public.ad_app_measurement_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_app_acquisition_canaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_app_binding_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ad app measurement admin can read" ON public.ad_app_measurement_configurations FOR SELECT TO authenticated USING (public.is_admin_user());
CREATE POLICY "ad app canary admin can read" ON public.ad_app_acquisition_canaries FOR SELECT TO authenticated USING (public.is_admin_user());
CREATE POLICY "ad app binding audit admin can read" ON public.ad_app_binding_audit FOR SELECT TO authenticated USING (public.is_admin_user());
REVOKE ALL ON public.ad_app_measurement_configurations,public.ad_app_acquisition_canaries,public.ad_app_binding_audit FROM anon,authenticated;
GRANT SELECT ON public.ad_app_measurement_configurations,public.ad_app_acquisition_canaries,public.ad_app_binding_audit TO authenticated;
GRANT ALL ON public.ad_app_measurement_configurations,public.ad_app_acquisition_canaries,public.ad_app_binding_audit TO service_role;

DROP TRIGGER IF EXISTS trg_ad_app_measurement_updated_at ON public.ad_app_measurement_configurations;
CREATE TRIGGER trg_ad_app_measurement_updated_at BEFORE UPDATE ON public.ad_app_measurement_configurations
FOR EACH ROW EXECUTE FUNCTION public.tg_ad_engine_set_updated_at();
DROP TRIGGER IF EXISTS trg_ad_app_canary_updated_at ON public.ad_app_acquisition_canaries;
CREATE TRIGGER trg_ad_app_canary_updated_at BEFORE UPDATE ON public.ad_app_acquisition_canaries
FOR EACH ROW EXECUTE FUNCTION public.tg_ad_engine_set_updated_at();

-- This is the sole server-side creation authority. It remains false while the
-- flag is OFF and still requires a fresh exact-cell readiness result plus a
-- current passed canary if a later issue explicitly enables the flag.
CREATE OR REPLACE FUNCTION public.can_create_native_app_campaign(
  p_app_key text,
  p_os text,
  p_provider text
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $function$
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
REVOKE ALL ON FUNCTION public.can_create_native_app_campaign(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_native_app_campaign(text,text,text) TO service_role;

-- Native provider creation is a separate future gate and is installed OFF.
INSERT INTO public.admin_config(key,value)
VALUES ('enable_native_app_campaign_creation','false'::jsonb)
ON CONFLICT (key) DO NOTHING;
