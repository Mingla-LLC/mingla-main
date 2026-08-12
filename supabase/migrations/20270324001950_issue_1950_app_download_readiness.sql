-- Issue #1950 — immutable, server-owned app-download readiness evidence.

CREATE TABLE IF NOT EXISTS public.ad_app_targets (
  app_key text NOT NULL REFERENCES public.ad_advertising_apps(app_key) ON DELETE RESTRICT,
  os text NOT NULL CHECK (os IN ('ios','android')),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  store_identifier text NOT NULL CHECK (btrim(store_identifier) <> ''),
  appsflyer_app_id text NOT NULL CHECK (btrim(appsflyer_app_id) <> ''),
  onelink_url text NOT NULL CHECK (onelink_url ~ '^https://(go|biz)\.usemingla\.com/[^?]+$'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_key, os),
  UNIQUE (os, store_identifier),
  UNIQUE (appsflyer_app_id)
);

INSERT INTO public.ad_app_targets
  (app_key, os, display_name, store_identifier, appsflyer_app_id, onelink_url, active)
VALUES
  ('explorer','ios','Mingla Explorer','6760440898','id6760440898','https://go.usemingla.com/w36m',true),
  ('explorer','android','Mingla Explorer','com.mingla.app.v2','com.mingla.app.v2','https://go.usemingla.com/w36m',true),
  ('business','ios','Mingla Business','6768737367','id6768737367','https://biz.usemingla.com/ZSCW',true),
  ('business','android','Mingla Business','com.sethogieva.minglabusiness','com.sethogieva.minglabusiness','https://biz.usemingla.com/ZSCW',true)
ON CONFLICT (app_key,os) DO UPDATE SET
  display_name=excluded.display_name,
  store_identifier=excluded.store_identifier,
  appsflyer_app_id=excluded.appsflyer_app_id,
  onelink_url=excluded.onelink_url,
  active=excluded.active,
  updated_at=now();

INSERT INTO public.admin_config(key,value)
VALUES ('enable_app_download_readiness','false'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ad_app_provider_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_key text NOT NULL,
  os text NOT NULL CHECK (os IN ('ios','android')),
  provider text NOT NULL CHECK (provider IN ('meta','tiktok','snapchat','google','reddit')),
  payer_connection_id uuid NULL REFERENCES public.ad_connections(id) ON DELETE RESTRICT,
  public_identity_required boolean NOT NULL,
  provider_app_id text NULL,
  provider_measurement_id text NULL,
  native_binding_attested_at timestamptz NULL,
  native_binding_attestation_expires_at timestamptz NULL,
  native_binding_attestation_safe_id text NULL,
  native_binding_attestation_provenance text NULL CHECK (native_binding_attestation_provenance IS NULL OR native_binding_attestation_provenance='provider_dashboard'),
  native_binding_attested_by uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  measurement_attested_at timestamptz NULL,
  measurement_attestation_expires_at timestamptz NULL,
  measurement_attestation_safe_id text NULL,
  measurement_attestation_provenance text NULL CHECK (measurement_attestation_provenance IS NULL OR measurement_attestation_provenance='appsflyer_dashboard'),
  measurement_attested_by uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  measurement_partner text NOT NULL DEFAULT 'appsflyer' CHECK (measurement_partner='appsflyer'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (app_key,os) REFERENCES public.ad_app_targets(app_key,os) ON DELETE RESTRICT,
  UNIQUE (app_key,os,provider),
  CONSTRAINT provider_app_id_clean CHECK (provider_app_id IS NULL OR (provider_app_id=btrim(provider_app_id) AND provider_app_id<>'')),
  CONSTRAINT provider_measurement_id_clean CHECK (provider_measurement_id IS NULL OR (provider_measurement_id=btrim(provider_measurement_id) AND provider_measurement_id<>''))
);
ALTER TABLE public.ad_app_provider_bindings
  ADD COLUMN IF NOT EXISTS native_binding_attested_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS native_binding_attestation_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS native_binding_attestation_safe_id text NULL,
  ADD COLUMN IF NOT EXISTS native_binding_attestation_provenance text NULL,
  ADD COLUMN IF NOT EXISTS native_binding_attested_by uuid NULL,
  ADD COLUMN IF NOT EXISTS measurement_attested_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS measurement_attestation_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS measurement_attestation_safe_id text NULL,
  ADD COLUMN IF NOT EXISTS measurement_attestation_provenance text NULL,
  ADD COLUMN IF NOT EXISTS measurement_attested_by uuid NULL;
DO $block$ BEGIN
  ALTER TABLE public.ad_app_provider_bindings ADD CONSTRAINT ad_app_native_binding_attestation_complete CHECK (
    (native_binding_attested_at IS NULL AND native_binding_attestation_expires_at IS NULL AND native_binding_attestation_safe_id IS NULL AND native_binding_attestation_provenance IS NULL AND native_binding_attested_by IS NULL)
    OR (native_binding_attested_at IS NOT NULL AND native_binding_attestation_expires_at=native_binding_attested_at+interval '15 minutes' AND native_binding_attestation_safe_id=provider_app_id AND native_binding_attestation_safe_id ~ '^[A-Za-z0-9._:@/-]{1,160}$' AND native_binding_attestation_provenance='provider_dashboard' AND native_binding_attested_by IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $block$;
DO $block$ BEGIN
  ALTER TABLE public.ad_app_provider_bindings ADD CONSTRAINT ad_app_measurement_attestation_complete CHECK (
    (measurement_attested_at IS NULL AND measurement_attestation_expires_at IS NULL AND measurement_attestation_safe_id IS NULL AND measurement_attestation_provenance IS NULL AND measurement_attested_by IS NULL)
    OR (measurement_attested_at IS NOT NULL AND measurement_attestation_expires_at=measurement_attested_at+interval '15 minutes' AND measurement_attestation_safe_id=provider_measurement_id AND measurement_attestation_safe_id ~ '^[A-Za-z0-9._:@/-]{1,160}$' AND measurement_attestation_provenance='appsflyer_dashboard' AND measurement_attested_by IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $block$;
CREATE INDEX IF NOT EXISTS ad_app_provider_bindings_payer_idx ON public.ad_app_provider_bindings(payer_connection_id);

INSERT INTO public.ad_app_provider_bindings
  (app_key,os,provider,payer_connection_id,public_identity_required,active)
SELECT t.app_key, t.os, p.provider, c.id, p.provider IN ('meta','tiktok'), true
FROM public.ad_app_targets t
CROSS JOIN (VALUES ('meta'),('tiktok'),('snapchat'),('google'),('reddit')) AS p(provider)
LEFT JOIN public.ad_connections c ON c.platform=p.provider AND c.lane='consumer'
WHERE t.app_key IN ('explorer','business') AND t.os IN ('ios','android')
ON CONFLICT (app_key,os,provider) DO UPDATE SET
  payer_connection_id=excluded.payer_connection_id,
  public_identity_required=excluded.public_identity_required,
  active=true,
  updated_at=now();

CREATE TABLE IF NOT EXISTS public.ad_app_readiness_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_key text NOT NULL,
  os text NOT NULL CHECK (os IN ('ios','android')),
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  checked_at timestamptz NOT NULL,
  stale_at timestamptz NOT NULL,
  duration_ms integer NOT NULL CHECK (duration_ms BETWEEN 0 AND 60000),
  provider_count smallint NOT NULL CHECK (provider_count=5),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (app_key,os) REFERENCES public.ad_app_targets(app_key,os) ON DELETE RESTRICT,
  CHECK (stale_at = checked_at + interval '15 minutes')
);
CREATE INDEX IF NOT EXISTS ad_app_readiness_runs_target_latest_idx
  ON public.ad_app_readiness_runs(app_key,os,checked_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS public.ad_app_readiness_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.ad_app_readiness_runs(id) ON DELETE CASCADE,
  app_key text NOT NULL,
  os text NOT NULL CHECK (os IN ('ios','android')),
  provider text NOT NULL CHECK (provider IN ('meta','tiktok','snapchat','google','reddit')),
  verdict text NOT NULL CHECK (verdict IN ('ready','action_required','blocked')),
  reason_code text NOT NULL,
  owner_label text NULL CHECK (owner_label IS NULL OR owner_label IN ('Mingla Admin','Growth operations','Engineering','Finance','Provider support')),
  action_code text NULL CHECK (action_code IS NULL OR action_code IN ('review_mingla_configuration','review_provider_billing','reauthorize_provider','contact_provider_support','retry_check','review_blocker')),
  action_href text NULL CHECK (action_href IS NULL OR action_href ~ '^https://[^?#]+$'),
  payer_evidence jsonb NOT NULL,
  identity_evidence jsonb NOT NULL,
  binding_evidence jsonb NOT NULL,
  measurement_evidence jsonb NOT NULL,
  funding_evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id,provider),
  FOREIGN KEY (app_key,os,provider) REFERENCES public.ad_app_provider_bindings(app_key,os,provider) ON DELETE RESTRICT,
  CHECK ((verdict='ready' AND owner_label IS NULL AND action_code IS NULL AND action_href IS NULL)
      OR (verdict<>'ready' AND owner_label IS NOT NULL AND action_code IS NOT NULL)),
  CHECK (jsonb_typeof(payer_evidence)='object' AND jsonb_typeof(identity_evidence)='object'
     AND jsonb_typeof(binding_evidence)='object' AND jsonb_typeof(measurement_evidence)='object'
     AND jsonb_typeof(funding_evidence)='object')
);
CREATE INDEX IF NOT EXISTS ad_app_readiness_results_target_provider_idx
  ON public.ad_app_readiness_results(app_key,os,provider,created_at DESC);

CREATE TABLE IF NOT EXISTS public.ad_app_readiness_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  event_name text NOT NULL CHECK (event_name IN ('readiness_viewed','target_changed','check_started','check_completed','action_opened','retry','detail_toggled')),
  app_key text NOT NULL CHECK (app_key IN ('explorer','business')),
  os text NOT NULL CHECK (os IN ('ios','android')),
  provider text NULL CHECK (provider IS NULL OR provider IN ('meta','tiktok','snapchat','google','reddit')),
  verdict text NULL CHECK (verdict IS NULL OR verdict IN ('ready','action_required','blocked','stale')),
  reason_code text NULL,
  duration_bucket text NULL CHECK (duration_bucket IS NULL OR duration_bucket IN ('lt_1s','1_3s','3_10s','10_30s','30_60s','timeout')),
  freshness_bucket text NULL CHECK (freshness_bucket IS NULL OR freshness_bucket IN ('none','current','stale')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_app_readiness_events_created_idx ON public.ad_app_readiness_events(created_at DESC);
CREATE INDEX IF NOT EXISTS ad_app_readiness_events_target_idx ON public.ad_app_readiness_events(app_key,os,created_at DESC);

DROP TRIGGER IF EXISTS trg_ad_app_targets_updated_at ON public.ad_app_targets;
CREATE TRIGGER trg_ad_app_targets_updated_at BEFORE UPDATE ON public.ad_app_targets
FOR EACH ROW EXECUTE FUNCTION public.tg_ad_engine_set_updated_at();
DROP TRIGGER IF EXISTS trg_ad_app_provider_bindings_updated_at ON public.ad_app_provider_bindings;
CREATE TRIGGER trg_ad_app_provider_bindings_updated_at BEFORE UPDATE ON public.ad_app_provider_bindings
FOR EACH ROW EXECUTE FUNCTION public.tg_ad_engine_set_updated_at();

CREATE OR REPLACE FUNCTION public.tg_ad_app_readiness_immutable()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'readiness_evidence_immutable';
END;
$function$;

DO $block$ BEGIN
  CREATE TRIGGER trg_ad_app_readiness_runs_immutable BEFORE UPDATE OR DELETE ON public.ad_app_readiness_runs FOR EACH ROW EXECUTE FUNCTION public.tg_ad_app_readiness_immutable();
EXCEPTION WHEN duplicate_object THEN NULL; END $block$;
DO $block$ BEGIN
  CREATE TRIGGER trg_ad_app_readiness_results_immutable BEFORE UPDATE OR DELETE ON public.ad_app_readiness_results FOR EACH ROW EXECUTE FUNCTION public.tg_ad_app_readiness_immutable();
EXCEPTION WHEN duplicate_object THEN NULL; END $block$;
DO $block$ BEGIN
  CREATE TRIGGER trg_ad_app_readiness_events_immutable BEFORE UPDATE OR DELETE ON public.ad_app_readiness_events FOR EACH ROW EXECUTE FUNCTION public.tg_ad_app_readiness_immutable();
EXCEPTION WHEN duplicate_object THEN NULL; END $block$;

ALTER TABLE public.ad_app_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_app_provider_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_app_readiness_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_app_readiness_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_app_readiness_events ENABLE ROW LEVEL SECURITY;

DO $block$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ad_app_targets','ad_app_provider_bindings','ad_app_readiness_runs','ad_app_readiness_results'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' admin can read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_admin_user())', t || ' admin can read', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $block$;
REVOKE ALL ON public.ad_app_readiness_events FROM anon, authenticated;
GRANT SELECT, INSERT ON public.ad_app_readiness_events TO service_role;

CREATE OR REPLACE FUNCTION public.normalize_ad_app_readiness_evidence(p_evidence jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $function$
DECLARE
  v_status text := p_evidence->>'status';
  v_summary text := p_evidence->>'summary';
  v_source text := p_evidence->>'source_class';
  v_checked text := p_evidence->>'source_checked_at';
  v_safe_id text := p_evidence->>'safe_id';
  v_safe_url text := p_evidence->>'safe_url';
BEGIN
  IF jsonb_typeof(p_evidence)<>'object'
     OR (p_evidence ?& ARRAY['status','summary','source_class','source_checked_at']) IS NOT TRUE
     OR v_status NOT IN ('proven','action_required','blocked','not_applicable')
     OR v_source NOT IN ('provider_api','appsflyer_api','canonical_registry','dashboard_attestation')
     OR v_summary IS NULL OR length(btrim(v_summary)) NOT BETWEEN 1 AND 240 OR v_summary ~ '[[:cntrl:]]'
     OR v_checked IS NULL OR v_checked::timestamptz IS NULL
     OR (v_safe_id IS NOT NULL AND (length(v_safe_id) NOT BETWEEN 1 AND 160 OR v_safe_id !~ '^[A-Za-z0-9._:@/-]+$'))
     OR (v_safe_url IS NOT NULL AND v_safe_url !~ '^https://(business\.facebook\.com|ads\.tiktok\.com|ads\.snapchat\.com|ads\.google\.com|ads\.reddit\.com|www\.facebook\.com|www\.tiktok\.com|support\.google\.com|businesshelp\.snapchat\.com|business\.reddithelp\.com|go\.usemingla\.com|biz\.usemingla\.com)(/[^?#]*)?([?#].*)?$') THEN
    RAISE EXCEPTION 'invalid_readiness_evidence';
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'status',v_status,
    'summary',btrim(v_summary),
    'source_class',v_source,
    'source_checked_at',v_checked,
    'safe_id',v_safe_id,
    'safe_url',CASE WHEN v_safe_url IS NULL THEN NULL ELSE regexp_replace(v_safe_url,'[?#].*$','') END
  ));
END;
$function$;
REVOKE ALL ON FUNCTION public.normalize_ad_app_readiness_evidence(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_ad_app_readiness_evidence(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.attest_ad_app_readiness_dimension(
  p_app_key text,
  p_os text,
  p_provider text,
  p_dimension text,
  p_safe_id text,
  p_attested_by uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_now timestamptz := clock_timestamp(); v_count integer;
BEGIN
  IF p_app_key NOT IN ('explorer','business') OR p_os NOT IN ('ios','android')
     OR p_provider NOT IN ('meta','tiktok','snapchat','google','reddit')
     OR p_dimension NOT IN ('native_binding','measurement')
     OR p_safe_id IS NULL OR p_safe_id !~ '^[A-Za-z0-9._:@/-]{1,160}$'
     OR p_attested_by IS NULL OR NOT EXISTS (
       SELECT 1
       FROM auth.users u
       JOIN public.admin_users au ON lower(au.email)=lower(u.email)
       WHERE u.id=p_attested_by
         AND au.status='active'
         AND au.role IN ('owner','admin')
     ) THEN
    RAISE EXCEPTION 'invalid_readiness_attestation';
  END IF;
  IF p_dimension='native_binding' THEN
    UPDATE public.ad_app_provider_bindings SET
      native_binding_attested_at=v_now,
      native_binding_attestation_expires_at=v_now+interval '15 minutes',
      native_binding_attestation_safe_id=p_safe_id,
      native_binding_attestation_provenance='provider_dashboard',
      native_binding_attested_by=p_attested_by
    WHERE app_key=p_app_key AND os=p_os AND provider=p_provider AND active=true
      AND provider_app_id=p_safe_id;
  ELSE
    UPDATE public.ad_app_provider_bindings SET
      measurement_attested_at=v_now,
      measurement_attestation_expires_at=v_now+interval '15 minutes',
      measurement_attestation_safe_id=p_safe_id,
      measurement_attestation_provenance='appsflyer_dashboard',
      measurement_attested_by=p_attested_by
    WHERE app_key=p_app_key AND os=p_os AND provider=p_provider AND active=true
      AND provider_measurement_id=p_safe_id;
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count<>1 THEN RAISE EXCEPTION 'readiness_attestation_target_mismatch'; END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.attest_ad_app_readiness_dimension(text,text,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attest_ad_app_readiness_dimension(text,text,text,text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.persist_ad_app_readiness_run(p_run jsonb,p_results jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE
  v_id uuid := gen_random_uuid(); v_checked timestamptz := clock_timestamp();
  v_app text := p_run->>'app_key'; v_os text := p_run->>'os';
  v_requested uuid := (p_run->>'requested_by')::uuid; v_duration int := (p_run->>'duration_ms')::int;
  r jsonb; v_provider text; v_statuses text[]; v_verdict text; v_reason text; v_owner text; v_action text;
  v_output jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_run)<>'object' OR (p_run - ARRAY['app_key','os','requested_by','duration_ms'])<>'{}'::jsonb
     OR v_app NOT IN ('explorer','business') OR v_os NOT IN ('ios','android') OR v_duration NOT BETWEEN 0 AND 60000
     OR jsonb_typeof(p_results)<>'array' OR jsonb_array_length(p_results)<>5
     OR (SELECT count(DISTINCT x.value->>'provider') FROM jsonb_array_elements(p_results) x(value))<>5
     OR (SELECT array_agg(x.value->>'provider' ORDER BY x.ordinality) FROM jsonb_array_elements(p_results) WITH ORDINALITY x(value,ordinality))<>ARRAY['meta','tiktok','snapchat','google','reddit'] THEN
    RAISE EXCEPTION 'invalid_readiness_run';
  END IF;
  INSERT INTO public.ad_app_readiness_runs(id,app_key,os,requested_by,checked_at,stale_at,duration_ms,provider_count)
  VALUES(v_id,v_app,v_os,v_requested,v_checked,v_checked+interval '15 minutes',v_duration,5);
  FOR r IN SELECT value FROM jsonb_array_elements(p_results) LOOP
    IF jsonb_typeof(r)<>'object' OR (r - ARRAY['provider','reason_code','payer','identity','binding','measurement','funding'])<>'{}'::jsonb THEN
      RAISE EXCEPTION 'invalid_readiness_result';
    END IF;
    v_provider := r->>'provider';
    r := jsonb_build_object(
      'provider',v_provider,
      'reason_code',r->>'reason_code',
      'payer',public.normalize_ad_app_readiness_evidence(r->'payer'),
      'identity',public.normalize_ad_app_readiness_evidence(r->'identity'),
      'binding',public.normalize_ad_app_readiness_evidence(r->'binding'),
      'measurement',public.normalize_ad_app_readiness_evidence(r->'measurement'),
      'funding',public.normalize_ad_app_readiness_evidence(r->'funding')
    );
    v_statuses := ARRAY[r#>>'{payer,status}',r#>>'{identity,status}',r#>>'{binding,status}',r#>>'{measurement,status}',r#>>'{funding,status}'];
    IF array_position(v_statuses,NULL) IS NOT NULL
       OR NOT (v_statuses <@ ARRAY['proven','action_required','blocked','not_applicable']::text[])
       OR (v_provider IN ('meta','tiktok') AND v_statuses[2]='not_applicable')
       OR (v_provider NOT IN ('meta','tiktok') AND v_statuses[2]<>'not_applicable')
       OR COALESCE(r->>'reason_code','') NOT IN (
         'target_missing_or_inactive','binding_missing','payer_missing','provider_timeout','provider_unreachable',
         'provider_response_invalid','permission_missing','capability_unsupported','native_binding_missing',
         'measurement_missing','event_mapping_missing','funding_missing','billing_inactive','oauth_scope_missing',
         'public_identity_missing','payer_mismatch','public_identity_mismatch','native_binding_mismatch',
         'measurement_mismatch','provider_permission_blocked','incomplete_provider_result',
         'unknown_verification_failure','all_required_dimensions_proven'
       ) THEN
      RAISE EXCEPTION 'invalid_readiness_evidence';
    END IF;
    IF v_statuses <@ ARRAY['proven','not_applicable']::text[] AND NOT ('not_applicable'=ANY(v_statuses) AND v_provider IN ('meta','tiktok')) THEN
      v_verdict:='ready'; v_reason:='all_required_dimensions_proven'; v_owner:=NULL; v_action:=NULL;
    ELSIF 'blocked'=ANY(v_statuses) THEN
      v_verdict:='blocked'; v_reason:=COALESCE(r->>'reason_code','unknown_verification_failure');
      v_owner:=CASE
        WHEN v_reason IN ('payer_mismatch','public_identity_mismatch','native_binding_mismatch','measurement_mismatch') THEN 'Growth operations'
        WHEN v_reason IN ('permission_missing','oauth_scope_missing','provider_permission_blocked') THEN 'Mingla Admin'
        WHEN v_reason='capability_unsupported' THEN 'Provider support'
        ELSE 'Engineering' END;
      v_action:=CASE
        WHEN v_owner='Growth operations' THEN 'review_blocker'
        WHEN v_owner='Mingla Admin' THEN 'reauthorize_provider'
        WHEN v_owner='Provider support' THEN 'contact_provider_support'
        ELSE 'retry_check' END;
    ELSE
      v_verdict:='action_required'; v_reason:=COALESCE(r->>'reason_code','binding_missing');
      v_owner:=CASE WHEN v_reason='funding_missing' OR v_reason='billing_inactive' THEN 'Finance' WHEN v_reason='oauth_scope_missing' OR v_reason='permission_missing' THEN 'Mingla Admin' ELSE 'Engineering' END;
      v_action:=CASE WHEN v_owner='Finance' THEN 'review_provider_billing' WHEN v_owner='Mingla Admin' THEN 'reauthorize_provider' ELSE 'review_mingla_configuration' END;
    END IF;
    INSERT INTO public.ad_app_readiness_results(run_id,app_key,os,provider,verdict,reason_code,owner_label,action_code,action_href,payer_evidence,identity_evidence,binding_evidence,measurement_evidence,funding_evidence)
    VALUES(v_id,v_app,v_os,v_provider,v_verdict,v_reason,v_owner,v_action,NULL,r->'payer',r->'identity',r->'binding',r->'measurement',r->'funding');
    v_output:=v_output||jsonb_build_array(jsonb_build_object('provider',v_provider,'verdict',v_verdict,'reason_code',v_reason,'owner_label',v_owner,'action_code',v_action,'action_href',NULL,'evidence',jsonb_build_object('payer',r->'payer','identity',r->'identity','binding',r->'binding','measurement',r->'measurement','funding',r->'funding')));
  END LOOP;
  RETURN jsonb_build_object('run_id',v_id,'checked_at',v_checked,'stale_at',v_checked+interval '15 minutes','duration_ms',v_duration,'results',v_output);
END;
$function$;
REVOKE ALL ON FUNCTION public.persist_ad_app_readiness_run(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_ad_app_readiness_run(jsonb,jsonb) TO service_role;
