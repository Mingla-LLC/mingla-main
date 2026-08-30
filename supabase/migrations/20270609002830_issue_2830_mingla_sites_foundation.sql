-- Issue #2830 — Mingla Sites Slice A Core authority.
-- Additive only. This migration authors no infrastructure, data seed, pilot
-- enablement, DNS change, live secret, deployment, or Gogi content mutation.

CREATE TABLE public.brand_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL UNIQUE REFERENCES public.brands(id),
  renderer_key text NOT NULL DEFAULT 'restaurant-website-v1'
    CHECK (renderer_key = 'restaurant-website-v1'),
  renderer_version integer NOT NULL DEFAULT 1 CHECK (renderer_version > 0),
  status text NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('provisioning','draft','publishing','published','suspended','error')),
  payload_tenant_id text UNIQUE,
  active_publication_id uuid,
  last_successful_publication_id uuid,
  provisioning_error_code text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  suspended_at timestamptz,
  suspended_by uuid REFERENCES auth.users(id),
  suspension_reason_code text,
  CONSTRAINT brand_sites_tenant_state_ck CHECK (
    payload_tenant_id IS NOT NULL OR status IN ('provisioning','error')
  ),
  CONSTRAINT brand_sites_pointer_state_ck CHECK (
    active_publication_id IS NULL OR status IN ('published','suspended')
  ),
  CONSTRAINT brand_sites_suspension_ck CHECK (
    (status <> 'suspended' AND suspended_at IS NULL AND suspended_by IS NULL
      AND suspension_reason_code IS NULL)
    OR
    (status = 'suspended' AND suspended_at IS NOT NULL
      AND suspension_reason_code IS NOT NULL)
  ),
  CONSTRAINT brand_sites_safe_provisioning_error_ck CHECK (
    provisioning_error_code IS NULL OR provisioning_error_code IN (
      'FORBIDDEN','NOT_FOUND','INVALID_STATE','VALIDATION_FAILED',
      'REVISION_CONFLICT','SESSION_EXPIRED','OPERATION_IN_PROGRESS',
      'PUBLISH_FAILED_LAST_GOOD_PRESERVED','MEDIA_REJECTED',
      'MEDIA_PROCESSING','SERVICE_TEMPORARILY_UNAVAILABLE',
      'IDEMPOTENCY_CONFLICT'
    )
  )
);

CREATE TABLE public.brand_site_hosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.brand_sites(id),
  hostname text NOT NULL,
  kind text NOT NULL DEFAULT 'mingla_subdomain' CHECK (kind = 'mingla_subdomain'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','suspended','retired')),
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  retired_at timestamptz,
  CONSTRAINT brand_site_hosts_hostname_shape_ck CHECK (
    hostname = lower(hostname)
    AND hostname = 'gogi.sites.usemingla.com'
    AND hostname !~ '[:/*?#]'
    AND hostname !~ '\.$'
  )
);
CREATE UNIQUE INDEX brand_site_hosts_hostname_uidx
  ON public.brand_site_hosts(hostname);
CREATE UNIQUE INDEX brand_site_hosts_one_active_primary_uidx
  ON public.brand_site_hosts(site_id)
  WHERE status = 'active' AND is_primary;

CREATE OR REPLACE FUNCTION public.brand_site_json_keys_allowed(
  p_value jsonb,
  p_allowed text[]
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT p_value IS NULL OR (
    jsonb_typeof(p_value) = 'object'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_value) AS key
      WHERE NOT (key = ANY (p_allowed))
    )
  );
$$;

CREATE TABLE public.brand_site_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.brand_sites(id),
  operation_id uuid NOT NULL UNIQUE,
  source_revision_id text NOT NULL CHECK (length(source_revision_id) BETWEEN 1 AND 200),
  source_digest text NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$'),
  artifact_key text,
  artifact_digest text CHECK (artifact_digest IS NULL OR artifact_digest ~ '^[0-9a-f]{64}$'),
  artifact_schema_version integer NOT NULL DEFAULT 1 CHECK (artifact_schema_version = 1),
  renderer_key text NOT NULL DEFAULT 'restaurant-website-v1'
    CHECK (renderer_key = 'restaurant-website-v1'),
  renderer_version integer NOT NULL DEFAULT 1 CHECK (renderer_version > 0),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','validating','materializing','probing','published','failed','ambiguous','rolled_back')),
  previous_publication_id uuid REFERENCES public.brand_site_publications(id),
  rollback_source_publication_id uuid REFERENCES public.brand_site_publications(id),
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  probe_summary jsonb,
  CONSTRAINT brand_site_publications_artifact_pair_ck CHECK (
    (artifact_key IS NULL) = (artifact_digest IS NULL)
  ),
  CONSTRAINT brand_site_publications_probe_ck CHECK (
    public.brand_site_json_keys_allowed(
      probe_summary,
      ARRAY['http_ok','digest_ok','renderer_ok','schema_ok','canonical_ok',
        'assets_ok','accessibility_ok','consent_ok','cta_ok','leak_check_ok',
        'observed_digest','status_code']
    )
  ),
  CONSTRAINT brand_site_publications_safe_failure_ck CHECK (
    failure_code IS NULL OR failure_code IN (
      'FORBIDDEN','NOT_FOUND','INVALID_STATE','VALIDATION_FAILED',
      'REVISION_CONFLICT','SESSION_EXPIRED','OPERATION_IN_PROGRESS',
      'PUBLISH_FAILED_LAST_GOOD_PRESERVED','MEDIA_REJECTED',
      'MEDIA_PROCESSING','SERVICE_TEMPORARILY_UNAVAILABLE',
      'IDEMPOTENCY_CONFLICT','SIGNATURE_INVALID','REPLAY_DETECTED',
      'TENANT_MISMATCH','ARTIFACT_DIGEST_MISMATCH','PROBE_FAILED',
      'CALLBACK_AMBIGUOUS','STORAGE_UNAVAILABLE','CORE_UNAVAILABLE'
    )
  )
);

ALTER TABLE public.brand_sites
  ADD CONSTRAINT brand_sites_active_publication_fk
  FOREIGN KEY (active_publication_id)
  REFERENCES public.brand_site_publications(id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.brand_sites
  ADD CONSTRAINT brand_sites_last_successful_publication_fk
  FOREIGN KEY (last_successful_publication_id)
  REFERENCES public.brand_site_publications(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION public.brand_site_validate_publication_pointer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.active_publication_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.brand_site_publications publication
    WHERE publication.id = NEW.active_publication_id
      AND publication.site_id = NEW.id
      AND publication.status = 'published'
  ) THEN
    RAISE EXCEPTION 'brand_site_active_publication_mismatch';
  END IF;
  IF NEW.last_successful_publication_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.brand_site_publications publication
    WHERE publication.id = NEW.last_successful_publication_id
      AND publication.site_id = NEW.id
      AND publication.status = 'published'
  ) THEN
    RAISE EXCEPTION 'brand_site_last_successful_publication_mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER brand_sites_validate_publication_pointer
AFTER INSERT OR UPDATE OF active_publication_id, last_successful_publication_id
ON public.brand_sites DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.brand_site_validate_publication_pointer();

CREATE TABLE public.brand_site_editor_exchanges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.brand_sites(id),
  brand_id uuid NOT NULL REFERENCES public.brands(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  code_digest text NOT NULL UNIQUE CHECK (code_digest ~ '^[0-9a-f]{64}$'),
  destination text NOT NULL CHECK (destination IN ('studio','preview')),
  role_snapshot integer NOT NULL CHECK (role_snapshot BETWEEN 20 AND 60),
  membership_revision text NOT NULL,
  status text NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued','consumed','expired','revoked')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT brand_site_editor_exchange_ttl_ck CHECK (
    expires_at = issued_at + interval '60 seconds'
  )
);

CREATE TABLE public.brand_site_operation_receipts (
  operation_id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES public.brand_sites(id),
  brand_id uuid NOT NULL REFERENCES public.brands(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  kind text NOT NULL CHECK (kind IN (
    'provision','editor_session','preview','publish','rollback',
    'suspend','resume','reconcile','revoke_sessions'
  )),
  arguments_digest text NOT NULL CHECK (arguments_digest ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('authorized','executing','succeeded','failed','ambiguous')),
  result_summary jsonb,
  error_code text,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_site_receipts_result_ck CHECK (
    public.brand_site_json_keys_allowed(
      result_summary,
      ARRAY['site_id','publication_id','status','destination','expires_at',
        'revision_id','artifact_digest','last_good_preserved','retryable',
        'brand_id','user_id','rank','generated_at',
        'rollback_source_publication_id']
    )
  )
);

CREATE TABLE public.brand_site_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.brand_sites(id),
  brand_id uuid NOT NULL REFERENCES public.brands(id),
  actor_user_id uuid REFERENCES auth.users(id),
  actor_kind text NOT NULL CHECK (actor_kind IN ('user','admin','system','ari')),
  action text NOT NULL CHECK (action IN (
    'site.provision_requested','site.provisioned','site.provision_failed',
    'editor.exchange_issued','editor.exchange_consumed','editor.sessions_revoked',
    'preview.requested','preview.created',
    'publication.requested','publication.published','publication.failed',
    'publication.reconciled','publication.rollback_requested',
    'site.suspended','site.resumed','attribution.consumed'
  )),
  resource_kind text NOT NULL CHECK (length(resource_kind) BETWEEN 1 AND 64),
  resource_id text NOT NULL CHECK (length(resource_id) BETWEEN 1 AND 200),
  operation_id uuid,
  before_digest text CHECK (before_digest IS NULL OR before_digest ~ '^[0-9a-f]{64}$'),
  after_digest text CHECK (after_digest IS NULL OR after_digest ~ '^[0-9a-f]{64}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_site_audit_metadata_ck CHECK (
    public.brand_site_json_keys_allowed(
      metadata,
      ARRAY['status','safe_error_code','renderer_version','schema_version',
        'destination','reason_code','last_good_preserved']
    )
  )
);

CREATE TABLE public.brand_site_gateway_nonces (
  direction text NOT NULL CHECK (direction IN ('core_to_cms','cms_to_core','runtime_to_core')),
  nonce text NOT NULL,
  operation_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES public.brand_sites(id),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (direction, nonce)
);

CREATE TABLE public.brand_site_attribution_touches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.brand_sites(id),
  brand_id uuid NOT NULL REFERENCES public.brands(id),
  publication_id uuid NOT NULL REFERENCES public.brand_site_publications(id),
  token_digest text NOT NULL UNIQUE CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  consent_policy_version text NOT NULL CHECK (length(consent_policy_version) BETWEEN 1 AND 40),
  source_kind text NOT NULL CHECK (source_kind IN ('direct','site','campaign')),
  source_ref text CHECK (source_ref IS NULL OR source_ref ~ '^[A-Za-z0-9_.-]{1,80}$'),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  order_id uuid,
  CONSTRAINT brand_site_attribution_ttl_ck CHECK (
    expires_at <= issued_at + interval '30 minutes'
  )
);
CREATE UNIQUE INDEX brand_site_attribution_order_once_idx
  ON public.brand_site_attribution_touches(order_id)
  WHERE order_id IS NOT NULL;

ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN site_attribution_token_digest text
  CHECK (
    site_attribution_token_digest IS NULL OR
    site_attribution_token_digest ~ '^[0-9a-f]{64}$'
  );

CREATE OR REPLACE FUNCTION public.brand_site_bind_checkout_attribution()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_touch public.brand_site_attribution_touches%ROWTYPE;
BEGIN
  IF NEW.order_id IS NULL OR NEW.site_attribution_token_digest IS NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT * INTO v_touch
    FROM public.brand_site_attribution_touches touch
    WHERE touch.token_digest = NEW.site_attribution_token_digest
      AND touch.brand_id = NEW.brand_id
      AND touch.consumed_at IS NULL
      AND touch.expires_at > clock_timestamp()
    FOR UPDATE;
    IF NOT FOUND THEN RETURN NEW; END IF;
    UPDATE public.brand_site_attribution_touches
      SET consumed_at = clock_timestamp(), order_id = NEW.order_id
      WHERE id = v_touch.id AND consumed_at IS NULL;
    INSERT INTO public.brand_site_audit_log(
      site_id, brand_id, actor_kind, action, resource_kind, resource_id, metadata
    ) VALUES (
      v_touch.site_id, v_touch.brand_id, 'system', 'attribution.consumed',
      'attribution_touch', v_touch.id::text, '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    -- Analytics is additive. It may never roll back a successful checkout or
    -- make an order depend on the Sites control plane being available.
    RAISE LOG 'mingla_sites_attribution_bind_failed sqlstate=%', SQLSTATE;
    RETURN NEW;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.brand_site_bind_checkout_attribution()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER brand_site_checkout_attribution_trigger
AFTER INSERT OR UPDATE OF order_id, site_attribution_token_digest
ON public.ticket_checkout_sessions
FOR EACH ROW EXECUTE FUNCTION public.brand_site_bind_checkout_attribution();

CREATE TABLE public.brand_site_analytics_events (
  event_id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES public.brand_sites(id),
  brand_id uuid NOT NULL REFERENCES public.brands(id),
  publication_id uuid NOT NULL REFERENCES public.brand_site_publications(id),
  event_name text NOT NULL CHECK (event_name IN (
    'site_view','page_view','cta_click','offering_view','reservation_start',
    'checkout_start','checkout_complete','contact_click','consent_granted','consent_denied'
  )),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  page_role text CHECK (page_role IS NULL OR page_role IN ('home','about','menu','gallery','contact')),
  cta_kind text CHECK (cta_kind IS NULL OR cta_kind IN ('offering','reservation','checkout','contact','menu','message')),
  offering_id uuid,
  referrer_class text CHECK (referrer_class IS NULL OR referrer_class IN ('direct','search','social','mingla','other')),
  consent_policy_version text NOT NULL CHECK (consent_policy_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.brand_site_service_config (
  config_key text PRIMARY KEY CHECK (config_key = 'sites_v1'),
  cms_origin text NOT NULL,
  public_runtime_origin text NOT NULL,
  public_host_suffix text NOT NULL CHECK (public_host_suffix = 'sites.usemingla.com'),
  pilot_brand_id uuid REFERENCES public.brands(id),
  pilot_site_id uuid REFERENCES public.brand_sites(id),
  pilot_enabled boolean NOT NULL DEFAULT false,
  backup_entitlement_verified_at timestamptz,
  backup_retention_days integer CHECK (
    backup_retention_days IS NULL OR backup_retention_days >= 7
  ),
  database_backup_verified_at timestamptz,
  object_manifest_verified_at timestamptz,
  restore_drill_verified_at timestamptz,
  restore_drill_evidence_digest text CHECK (
    restore_drill_evidence_digest IS NULL OR
    restore_drill_evidence_digest ~ '^[0-9a-f]{64}$'
  ),
  configured_by uuid NOT NULL REFERENCES auth.users(id),
  configured_at timestamptz NOT NULL,
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL,
  CONSTRAINT brand_site_service_config_pair_ck CHECK (
    (pilot_brand_id IS NULL) = (pilot_site_id IS NULL)
  ),
  CONSTRAINT brand_site_service_config_enable_ck CHECK (
    NOT pilot_enabled OR (pilot_brand_id IS NOT NULL AND pilot_site_id IS NOT NULL)
  ),
  CONSTRAINT brand_site_service_config_cms_origin_ck CHECK (
    cms_origin ~ '^https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{2,5})?$'
    AND cms_origin !~ '(localhost|127\.0\.0\.1|@|\*|\?|#)'
  ),
  CONSTRAINT brand_site_service_config_runtime_origin_ck CHECK (
    public_runtime_origin ~ '^https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{2,5})?$'
    AND public_runtime_origin !~ '(localhost|127\.0\.0\.1|@|\*|\?|#)'
  )
);

CREATE OR REPLACE FUNCTION public.brand_site_validate_service_config()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.pilot_site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.brand_sites site
    WHERE site.id = NEW.pilot_site_id AND site.brand_id = NEW.pilot_brand_id
  ) THEN
    RAISE EXCEPTION 'brand_site_pilot_binding_mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER brand_site_validate_service_config
BEFORE INSERT OR UPDATE ON public.brand_site_service_config
FOR EACH ROW EXECUTE FUNCTION public.brand_site_validate_service_config();

CREATE OR REPLACE FUNCTION public.brand_site_enforce_publication_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF OLD.status IN ('published','failed','rolled_back') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'brand_site_publication_terminal';
  END IF;
  IF OLD.status = 'ambiguous' AND NEW.status NOT IN ('ambiguous','published','failed') THEN
    RAISE EXCEPTION 'brand_site_publication_reconciliation_required';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER brand_site_enforce_publication_transition
BEFORE UPDATE ON public.brand_site_publications
FOR EACH ROW EXECUTE FUNCTION public.brand_site_enforce_publication_transition();

CREATE OR REPLACE FUNCTION public.brand_site_enforce_receipt_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF OLD.status IN ('succeeded','failed') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'brand_site_receipt_terminal';
  END IF;
  IF OLD.status = 'ambiguous' AND NEW.status NOT IN ('ambiguous','succeeded','failed') THEN
    RAISE EXCEPTION 'brand_site_receipt_reconciliation_required';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER brand_site_enforce_receipt_transition
BEFORE UPDATE ON public.brand_site_operation_receipts
FOR EACH ROW EXECUTE FUNCTION public.brand_site_enforce_receipt_transition();

CREATE OR REPLACE FUNCTION public.brand_site_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER brand_sites_set_updated_at
BEFORE UPDATE ON public.brand_sites
FOR EACH ROW EXECUTE FUNCTION public.brand_site_set_updated_at();
CREATE TRIGGER brand_site_receipts_set_updated_at
BEFORE UPDATE ON public.brand_site_operation_receipts
FOR EACH ROW EXECUTE FUNCTION public.brand_site_set_updated_at();

ALTER TABLE public.brand_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_sites FORCE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_hosts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_publications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_editor_exchanges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_editor_exchanges FORCE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_operation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_operation_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_gateway_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_gateway_nonces FORCE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_attribution_touches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_attribution_touches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_analytics_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_service_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_service_config FORCE ROW LEVEL SECURITY;

CREATE POLICY brand_sites_marketing_read ON public.brand_sites
FOR SELECT TO authenticated USING (
  public.biz_brand_effective_rank(brand_id, auth.uid()) >= 20
);
CREATE POLICY brand_site_hosts_marketing_read ON public.brand_site_hosts
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.brand_sites site
  WHERE site.id = brand_site_hosts.site_id
    AND public.biz_brand_effective_rank(site.brand_id, auth.uid()) >= 20
));
CREATE POLICY brand_site_publications_marketing_read ON public.brand_site_publications
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.brand_sites site
  WHERE site.id = brand_site_publications.site_id
    AND public.biz_brand_effective_rank(site.brand_id, auth.uid()) >= 20
));
CREATE POLICY brand_site_receipts_marketing_read ON public.brand_site_operation_receipts
FOR SELECT TO authenticated USING (
  public.biz_brand_effective_rank(brand_id, auth.uid()) >= 20
);

REVOKE ALL ON TABLE public.brand_sites FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_site_hosts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_site_publications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_site_editor_exchanges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_site_operation_receipts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_site_audit_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_site_gateway_nonces FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_site_attribution_touches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_site_analytics_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.brand_site_service_config FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.brand_sites TO authenticated;
GRANT SELECT ON TABLE public.brand_site_hosts TO authenticated;
GRANT SELECT ON TABLE public.brand_site_publications TO authenticated;
GRANT SELECT ON TABLE public.brand_site_operation_receipts TO authenticated;
GRANT ALL ON TABLE public.brand_sites, public.brand_site_hosts,
  public.brand_site_publications, public.brand_site_editor_exchanges,
  public.brand_site_operation_receipts, public.brand_site_audit_log,
  public.brand_site_gateway_nonces, public.brand_site_attribution_touches,
  public.brand_site_analytics_events, public.brand_site_service_config
  TO service_role;

CREATE OR REPLACE FUNCTION public.brand_site_provision(
  p_brand_id uuid,
  p_operation_id uuid,
  p_arguments_digest text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_site public.brand_sites%ROWTYPE;
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR public.biz_brand_effective_rank(p_brand_id, v_actor) < 50 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF p_arguments_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT * INTO v_receipt FROM public.brand_site_operation_receipts
    WHERE operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_receipt.arguments_digest <> p_arguments_digest OR
       v_receipt.brand_id <> p_brand_id OR v_receipt.kind <> 'provision' THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN COALESCE(v_receipt.result_summary, jsonb_build_object(
      'site_id', v_receipt.site_id, 'status', v_receipt.status));
  END IF;
  SELECT * INTO v_site FROM public.brand_sites WHERE brand_id = p_brand_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.brand_sites(brand_id, created_by)
    VALUES (p_brand_id, v_actor) RETURNING * INTO v_site;
    INSERT INTO public.brand_site_hosts(site_id, hostname)
    VALUES (v_site.id, 'gogi.sites.usemingla.com');
  END IF;
  INSERT INTO public.brand_site_operation_receipts(
    operation_id, site_id, brand_id, user_id, kind, arguments_digest,
    status, result_summary, started_at
  ) VALUES (
    p_operation_id, v_site.id, p_brand_id, v_actor, 'provision',
    p_arguments_digest, 'executing',
    jsonb_build_object('site_id', v_site.id, 'status', 'executing'), now()
  );
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action,
    resource_kind, resource_id, operation_id, metadata
  ) VALUES (
    v_site.id, p_brand_id, v_actor, 'user', 'site.provision_requested',
    'site', v_site.id::text, p_operation_id,
    jsonb_build_object('status', 'executing', 'renderer_version', 1)
  );
  RETURN jsonb_build_object('site_id', v_site.id, 'status', 'executing');
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_issue_editor_exchange(
  p_brand_id uuid,
  p_operation_id uuid,
  p_destination text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_site public.brand_sites%ROWTYPE;
  v_code text;
  v_digest text;
  v_arguments_digest text;
  v_exchange_id uuid;
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
  v_issued timestamptz := clock_timestamp();
  v_rank integer;
BEGIN
  v_rank := public.biz_brand_effective_rank(p_brand_id, v_actor);
  IF v_actor IS NULL OR v_rank < 20 OR p_destination <> 'studio' THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  SELECT * INTO STRICT v_site FROM public.brand_sites WHERE brand_id = p_brand_id;
  v_arguments_digest := encode(
    digest(p_destination || ':' || v_site.id::text, 'sha256'),
    'hex'
  );
  SELECT * INTO v_receipt FROM public.brand_site_operation_receipts
    WHERE operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_receipt.arguments_digest <> v_arguments_digest OR
       v_receipt.site_id <> v_site.id OR
       v_receipt.brand_id <> p_brand_id OR
       v_receipt.user_id <> v_actor OR
       v_receipt.kind <> 'editor_session' THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    -- Raw exchange codes are deliberately never persisted. A transport retry
    -- receives the recorded result and cannot mint a second live credential.
    RETURN COALESCE(v_receipt.result_summary, '{}'::jsonb);
  END IF;
  v_code := replace(replace(trim(trailing '=' FROM encode(gen_random_bytes(32), 'base64')), '+', '-'), '/', '_');
  v_digest := encode(digest(v_code, 'sha256'), 'hex');
  INSERT INTO public.brand_site_editor_exchanges(
    site_id, brand_id, user_id, code_digest, destination, role_snapshot,
    membership_revision, issued_at, expires_at
  ) VALUES (
    v_site.id, p_brand_id, v_actor, v_digest, p_destination, v_rank,
    v_rank::text || ':' || extract(epoch FROM now())::bigint::text,
    v_issued, v_issued + interval '60 seconds'
  ) RETURNING id INTO v_exchange_id;
  INSERT INTO public.brand_site_operation_receipts(
    operation_id, site_id, brand_id, user_id, kind, arguments_digest,
    status, result_summary, completed_at
  ) VALUES (
    p_operation_id, v_site.id, p_brand_id, v_actor, 'editor_session',
    v_arguments_digest,
    'succeeded', jsonb_build_object(
      'site_id', v_site.id, 'status', 'succeeded',
      'destination', p_destination, 'expires_at', v_issued + interval '60 seconds'
    ), now()
  );
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action,
    resource_kind, resource_id, operation_id, metadata
  ) VALUES (
    v_site.id, p_brand_id, v_actor, 'user', 'editor.exchange_issued',
    'editor_exchange', v_exchange_id::text, p_operation_id,
    jsonb_build_object('destination', p_destination)
  );
  RETURN jsonb_build_object(
    'site_id', v_site.id,
    'code', v_code,
    'destination', p_destination,
    'expires_at', v_issued + interval '60 seconds'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_authorize_operation(
  p_site_id uuid,
  p_operation_id uuid,
  p_kind text,
  p_arguments_digest text,
  p_expected_revision text,
  p_source_digest text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_site public.brand_sites%ROWTYPE;
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
  v_publication_id uuid;
  v_rollback_source_id uuid;
  v_rank integer;
  v_config public.brand_site_service_config%ROWTYPE;
  v_generated_at timestamptz;
BEGIN
  SELECT * INTO STRICT v_site FROM public.brand_sites WHERE id = p_site_id FOR UPDATE;
  v_rank := public.biz_brand_effective_rank(v_site.brand_id, v_actor);
  IF v_actor IS NULL OR v_rank < 20 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF p_kind NOT IN ('preview','publish','rollback') OR
     p_arguments_digest !~ '^[0-9a-f]{64}$' OR
     p_source_digest !~ '^[0-9a-f]{64}$' OR
     length(p_expected_revision) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT * INTO v_receipt FROM public.brand_site_operation_receipts
    WHERE operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF v_receipt.arguments_digest <> p_arguments_digest OR
       v_receipt.site_id <> p_site_id OR
       v_receipt.brand_id <> v_site.brand_id OR
       v_receipt.user_id <> v_actor OR
       v_receipt.kind <> p_kind THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN COALESCE(v_receipt.result_summary, '{}'::jsonb) || jsonb_build_object(
      'brand_id', v_site.brand_id, 'user_id', v_actor, 'rank', v_rank
    );
  END IF;
  IF p_kind IN ('publish','rollback') THEN
    IF p_kind = 'publish' AND v_site.last_successful_publication_id IS NULL THEN
      SELECT * INTO v_config
      FROM public.brand_site_service_config config
      WHERE config.config_key = 'sites_v1'
        AND config.pilot_site_id = v_site.id
        AND config.pilot_brand_id = v_site.brand_id;
      IF NOT FOUND OR COALESCE(v_config.backup_retention_days, 0) < 7
        OR v_config.backup_entitlement_verified_at IS NULL
        OR v_config.database_backup_verified_at IS NULL
        OR v_config.database_backup_verified_at <= clock_timestamp() - interval '26 hours'
        OR v_config.object_manifest_verified_at IS NULL
        OR v_config.object_manifest_verified_at <= clock_timestamp() - interval '26 hours'
        OR v_config.restore_drill_verified_at IS NULL
        OR v_config.restore_drill_verified_at <= clock_timestamp() - interval '100 days'
        OR v_config.restore_drill_evidence_digest IS NULL THEN
        RAISE EXCEPTION 'sites_readiness_blocked';
      END IF;
    END IF;
    IF p_kind = 'rollback' THEN
      SELECT publication.id INTO STRICT v_rollback_source_id
      FROM public.brand_site_publications publication
      WHERE publication.site_id = p_site_id
        AND publication.status = 'published'
        AND publication.source_revision_id = p_expected_revision
        AND publication.source_digest = p_source_digest;
    END IF;
    v_publication_id := gen_random_uuid();
    INSERT INTO public.brand_site_publications(
      id, site_id, operation_id, source_revision_id, source_digest,
      previous_publication_id, rollback_source_publication_id, requested_by
    ) VALUES (
      v_publication_id, p_site_id, p_operation_id, p_expected_revision,
      p_source_digest, v_site.active_publication_id,
      v_rollback_source_id,
      v_actor
    ) RETURNING requested_at INTO v_generated_at;
    IF p_kind = 'publish' AND v_site.active_publication_id IS NULL THEN
      UPDATE public.brand_sites
      SET status = 'publishing', provisioning_error_code = NULL
      WHERE id = p_site_id;
    END IF;
  END IF;
  INSERT INTO public.brand_site_operation_receipts(
    operation_id, site_id, brand_id, user_id, kind, arguments_digest,
    status, result_summary
  ) VALUES (
    p_operation_id, p_site_id, v_site.brand_id, v_actor, p_kind,
    p_arguments_digest, 'authorized', jsonb_build_object(
      'site_id', p_site_id, 'status', 'authorized',
      'brand_id', v_site.brand_id, 'user_id', v_actor, 'rank', v_rank,
      'revision_id', p_expected_revision,
      'publication_id', v_publication_id,
      'generated_at', v_generated_at,
      'rollback_source_publication_id', v_rollback_source_id
    )
  );
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action,
    resource_kind, resource_id, operation_id, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, v_actor, 'user',
    CASE WHEN p_kind = 'rollback' THEN 'publication.rollback_requested'
         WHEN p_kind = 'preview' THEN 'preview.requested'
         ELSE 'publication.requested' END,
    p_kind, COALESCE(v_publication_id::text, p_expected_revision), p_operation_id,
    jsonb_build_object('status', 'authorized')
  );
  RETURN jsonb_build_object(
    'site_id', p_site_id, 'status', 'authorized',
    'brand_id', v_site.brand_id, 'user_id', v_actor, 'rank', v_rank,
    'revision_id', p_expected_revision, 'publication_id', v_publication_id,
    'generated_at', v_generated_at,
    'rollback_source_publication_id', v_rollback_source_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_complete_preview(
  p_site_id uuid,
  p_operation_id uuid,
  p_revision_id text,
  p_expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_receipt
  FROM public.brand_site_operation_receipts
  WHERE operation_id = p_operation_id
    AND site_id = p_site_id
    AND kind = 'preview'
  FOR UPDATE;
  IF v_receipt.status = 'succeeded' THEN
    RETURN v_receipt.result_summary;
  END IF;
  IF v_receipt.status NOT IN ('authorized','executing','ambiguous') OR
     p_revision_id <> v_receipt.result_summary->>'revision_id' OR
     p_expires_at <= clock_timestamp() OR
     p_expires_at > clock_timestamp() + interval '30 minutes' THEN
    RAISE EXCEPTION 'sites_invalid_state';
  END IF;
  UPDATE public.brand_site_operation_receipts
  SET status = 'succeeded', completed_at = clock_timestamp(),
    result_summary = jsonb_build_object(
      'site_id', p_site_id,
      'status', 'succeeded',
      'revision_id', p_revision_id,
      'expires_at', p_expires_at
    )
  WHERE operation_id = p_operation_id;
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action,
    resource_kind, resource_id, operation_id, metadata
  ) VALUES (
    p_site_id, v_receipt.brand_id, v_receipt.user_id, 'user',
    'preview.created', 'preview', p_revision_id, p_operation_id,
    jsonb_build_object('status', 'succeeded')
  );
  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'status', 'succeeded',
    'revision_id', p_revision_id,
    'expires_at', p_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_consume_editor_exchange(
  p_code text,
  p_destination text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_digest text := encode(digest(p_code, 'sha256'), 'hex');
  v_exchange public.brand_site_editor_exchanges%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_exchange FROM public.brand_site_editor_exchanges
    WHERE code_digest = v_digest FOR UPDATE;
  IF v_exchange.status <> 'issued' OR v_exchange.expires_at <= clock_timestamp()
     OR v_exchange.destination <> p_destination
     OR public.biz_brand_effective_rank(v_exchange.brand_id, v_exchange.user_id) < 20 THEN
    RAISE EXCEPTION 'sites_session_expired';
  END IF;
  UPDATE public.brand_site_editor_exchanges
    SET status = 'consumed', consumed_at = clock_timestamp()
    WHERE id = v_exchange.id AND status = 'issued';
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action,
    resource_kind, resource_id, metadata
  ) VALUES (
    v_exchange.site_id, v_exchange.brand_id, v_exchange.user_id, 'user',
    'editor.exchange_consumed', 'editor_exchange', v_exchange.id::text,
    jsonb_build_object('destination', p_destination)
  );
  RETURN jsonb_build_object(
    'site_id', v_exchange.site_id,
    'brand_id', v_exchange.brand_id,
    'user_id', v_exchange.user_id,
    'rank', public.biz_brand_effective_rank(v_exchange.brand_id, v_exchange.user_id),
    'absolute_expires_at', clock_timestamp() + interval '8 hours',
    'idle_expires_at', clock_timestamp() + interval '30 minutes'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_complete_provision(
  p_site_id uuid,
  p_operation_id uuid,
  p_payload_tenant_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
BEGIN
  IF p_payload_tenant_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT * INTO STRICT v_site FROM public.brand_sites WHERE id = p_site_id FOR UPDATE;
  SELECT * INTO STRICT v_receipt FROM public.brand_site_operation_receipts
    WHERE operation_id = p_operation_id AND site_id = p_site_id
      AND kind = 'provision' FOR UPDATE;
  IF v_receipt.status = 'succeeded' THEN
    IF v_site.payload_tenant_id <> p_payload_tenant_id THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN v_receipt.result_summary;
  END IF;
  IF v_receipt.status NOT IN ('authorized','executing','ambiguous') THEN
    RAISE EXCEPTION 'sites_invalid_state';
  END IF;
  UPDATE public.brand_sites SET payload_tenant_id = p_payload_tenant_id,
    status = 'draft', provisioning_error_code = NULL
  WHERE id = p_site_id;
  UPDATE public.brand_site_operation_receipts SET status = 'succeeded',
    result_summary = jsonb_build_object(
      'site_id', p_site_id, 'status', 'succeeded'
    ), completed_at = clock_timestamp()
  WHERE operation_id = p_operation_id;
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_kind, action, resource_kind,
    resource_id, operation_id, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, 'system', 'site.provisioned',
    'site', p_site_id::text, p_operation_id,
    jsonb_build_object('status', 'draft', 'renderer_version', 1)
  );
  RETURN jsonb_build_object('site_id', p_site_id, 'status', 'succeeded');
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_commercial_projection(
  p_site_id uuid,
  p_offering_ids uuid[]
) RETURNS TABLE (
  id uuid,
  kind text,
  title text,
  summary text,
  url text,
  checkout_url text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_brand_id uuid;
BEGIN
  SELECT brand_id INTO STRICT v_brand_id FROM public.brand_sites WHERE id = p_site_id;
  IF cardinality(p_offering_ids) > 20 OR array_position(p_offering_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  RETURN QUERY
  SELECT event.id,
    CASE event.event_type
      WHEN 'trip' THEN 'offering'
      WHEN 'experience' THEN 'offering'
      ELSE 'offering'
    END,
    event.title,
    left(COALESCE(event.description, ''), 500),
    'https://host.usemingla.com/' ||
      CASE event.event_type WHEN 'trip' THEN 't/' WHEN 'experience' THEN 'exp/' ELSE 'e/' END ||
      brand.slug || '/' || event.slug,
    CASE WHEN event.event_type IN ('event','rsvp')
      THEN 'https://host.usemingla.com/checkout/' || event.id::text
      ELSE 'https://host.usemingla.com/' ||
        CASE event.event_type WHEN 'trip' THEN 't/' ELSE 'exp/' END ||
        brand.slug || '/' || event.slug
    END
  FROM public.events event
  JOIN public.brands brand ON brand.id = event.brand_id
  WHERE event.id = ANY(p_offering_ids)
    AND event.brand_id = v_brand_id
    AND event.deleted_at IS NULL
    AND event.visibility IN ('public','discover')
    AND event.status IN ('scheduled','live');
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_complete_publication(
  p_site_id uuid,
  p_operation_id uuid,
  p_publication_id uuid,
  p_source_revision_id text,
  p_source_digest text,
  p_artifact_key text,
  p_artifact_digest text,
  p_probe_summary jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_publication public.brand_site_publications%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_site FROM public.brand_sites WHERE id = p_site_id FOR UPDATE;
  SELECT * INTO STRICT v_publication FROM public.brand_site_publications
    WHERE id = p_publication_id AND operation_id = p_operation_id
      AND site_id = p_site_id FOR UPDATE;
  IF v_publication.status = 'published' THEN
    RETURN jsonb_build_object(
      'site_id', p_site_id, 'publication_id', p_publication_id,
      'artifact_digest', v_publication.artifact_digest, 'status', 'published'
    );
  END IF;
  IF v_publication.status NOT IN ('queued','validating','materializing','probing','ambiguous')
     OR v_publication.source_revision_id <> p_source_revision_id
     OR v_publication.source_digest <> p_source_digest
     OR p_artifact_digest !~ '^[0-9a-f]{64}$'
     OR p_artifact_key <> 'publications/' || p_site_id::text || '/' ||
        p_publication_id::text || '/' || p_artifact_digest || '.json'
     OR NOT public.brand_site_json_keys_allowed(
       p_probe_summary,
       ARRAY['http_ok','digest_ok','renderer_ok','schema_ok','canonical_ok',
        'assets_ok','accessibility_ok','consent_ok','cta_ok','leak_check_ok',
        'observed_digest','status_code']
     )
     OR COALESCE((p_probe_summary->>'http_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'digest_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'renderer_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'schema_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'canonical_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'assets_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'accessibility_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'consent_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'cta_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'leak_check_ok')::boolean, false) IS NOT TRUE
     OR COALESCE((p_probe_summary->>'status_code')::integer, 0) <> 200
     OR p_probe_summary->>'observed_digest' <> p_artifact_digest THEN
    RAISE EXCEPTION 'sites_callback_ambiguous';
  END IF;
  UPDATE public.brand_site_publications SET
    artifact_key = p_artifact_key,
    artifact_digest = p_artifact_digest,
    probe_summary = p_probe_summary,
    status = 'published',
    completed_at = clock_timestamp()
  WHERE id = p_publication_id;
  UPDATE public.brand_sites SET
    status = 'published', active_publication_id = p_publication_id,
    last_successful_publication_id = p_publication_id,
    provisioning_error_code = NULL
  WHERE id = p_site_id;
  UPDATE public.brand_site_operation_receipts SET
    status = 'succeeded', completed_at = clock_timestamp(),
    result_summary = jsonb_build_object(
      'site_id', p_site_id, 'publication_id', p_publication_id,
      'artifact_digest', p_artifact_digest, 'status', 'succeeded'
    )
  WHERE operation_id = p_operation_id;
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_kind, action, resource_kind, resource_id,
    operation_id, after_digest, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, 'system', 'publication.published',
    'publication', p_publication_id::text, p_operation_id, p_artifact_digest,
    jsonb_build_object('status', 'published', 'schema_version', 1, 'renderer_version', 1)
  );
  RETURN jsonb_build_object(
    'site_id', p_site_id, 'publication_id', p_publication_id,
    'artifact_digest', p_artifact_digest, 'status', 'published'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_fail_publication(
  p_site_id uuid,
  p_operation_id uuid,
  p_publication_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_publication public.brand_site_publications%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_site
  FROM public.brand_sites WHERE id = p_site_id FOR UPDATE;
  SELECT * INTO STRICT v_publication
  FROM public.brand_site_publications
  WHERE id = p_publication_id
    AND site_id = p_site_id
    AND operation_id = p_operation_id
  FOR UPDATE;
  IF v_publication.status = 'published' THEN
    RAISE EXCEPTION 'sites_invalid_state';
  END IF;
  UPDATE public.brand_site_publications
  SET status = 'failed', failed_at = clock_timestamp(),
    failure_code = 'PUBLISH_FAILED_LAST_GOOD_PRESERVED'
  WHERE id = p_publication_id;
  UPDATE public.brand_sites
  SET status = CASE
      WHEN last_successful_publication_id IS NULL THEN 'draft'
      ELSE 'published'
    END,
    provisioning_error_code = 'PUBLISH_FAILED_LAST_GOOD_PRESERVED'
  WHERE id = p_site_id;
  UPDATE public.brand_site_operation_receipts
  SET status = 'failed', completed_at = clock_timestamp(),
    error_code = 'PUBLISH_FAILED_LAST_GOOD_PRESERVED',
    result_summary = jsonb_build_object(
      'site_id', p_site_id,
      'publication_id', p_publication_id,
      'status', 'failed',
      'last_good_preserved', v_site.last_successful_publication_id IS NOT NULL,
      'retryable', false
    )
  WHERE operation_id = p_operation_id;
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_kind, action, resource_kind, resource_id,
    operation_id, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, 'system', 'publication.failed',
    'publication', p_publication_id::text, p_operation_id,
    jsonb_build_object(
      'status', 'failed',
      'safe_error_code', 'PUBLISH_FAILED_LAST_GOOD_PRESERVED',
      'last_good_preserved', v_site.last_successful_publication_id IS NOT NULL
    )
  );
  RETURN jsonb_build_object(
    'site_id', p_site_id,
    'publication_id', p_publication_id,
    'status', 'failed',
    'last_good_preserved', v_site.last_successful_publication_id IS NOT NULL,
    'retryable', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_internal_authorize(
  p_site_id uuid,
  p_user_id uuid,
  p_min_rank integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_rank integer;
BEGIN
  IF p_min_rank NOT IN (20, 50) THEN RAISE EXCEPTION 'sites_forbidden'; END IF;
  SELECT * INTO STRICT v_site FROM public.brand_sites WHERE id = p_site_id;
  v_rank := public.biz_brand_effective_rank(v_site.brand_id, p_user_id);
  IF v_rank < p_min_rank THEN RAISE EXCEPTION 'sites_forbidden'; END IF;
  RETURN jsonb_build_object(
    'site_id', p_site_id, 'brand_id', v_site.brand_id,
    'user_id', p_user_id, 'rank', v_rank, 'authorized', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_resolve_publication(p_hostname text)
RETURNS TABLE (
  site_id uuid,
  brand_id uuid,
  publication_id uuid,
  artifact_key text,
  artifact_digest text,
  artifact_schema_version integer,
  renderer_key text,
  renderer_version integer,
  hostname text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT site.id, site.brand_id, publication.id, publication.artifact_key,
    publication.artifact_digest, publication.artifact_schema_version,
    publication.renderer_key, publication.renderer_version, host.hostname
  FROM public.brand_site_hosts host
  JOIN public.brand_sites site ON site.id = host.site_id
  JOIN public.brand_site_publications publication
    ON publication.id = site.active_publication_id AND publication.site_id = site.id
  JOIN public.brand_site_service_config config
    ON config.config_key = 'sites_v1' AND config.pilot_enabled
    AND config.pilot_site_id = site.id AND config.pilot_brand_id = site.brand_id
  WHERE host.hostname = lower(p_hostname)
    AND p_hostname = 'gogi.sites.usemingla.com'
    AND host.status = 'active' AND host.is_primary
    AND site.status = 'published' AND publication.status = 'published'
    AND publication.artifact_key IS NOT NULL
    AND publication.artifact_digest IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_consume_attribution(
  p_token_digest text,
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_touch public.brand_site_attribution_touches%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_touch FROM public.brand_site_attribution_touches
    WHERE token_digest = p_token_digest FOR UPDATE;
  IF v_touch.expires_at <= clock_timestamp() OR v_touch.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'sites_attribution_forbidden';
  END IF;
  UPDATE public.brand_site_attribution_touches
    SET consumed_at = clock_timestamp(), order_id = p_order_id
    WHERE id = v_touch.id AND consumed_at IS NULL;
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_kind, action, resource_kind, resource_id, metadata
  ) VALUES (
    v_touch.site_id, v_touch.brand_id, 'system', 'attribution.consumed',
    'attribution_touch', v_touch.id::text, '{}'::jsonb
  );
  RETURN jsonb_build_object('accepted', true, 'touch_id', v_touch.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_record_analytics_event(p_event jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_publication public.brand_site_publications%ROWTYPE;
  v_event_id uuid;
  v_occurred_at timestamptz;
BEGIN
  IF NOT public.brand_site_json_keys_allowed(
    p_event,
    ARRAY['event_name','occurred_at','site_id','brand_id','publication_id',
      'page_role','cta_kind','offering_id','referrer_class',
      'consent_policy_version','event_id']
  ) THEN RAISE EXCEPTION 'sites_validation_failed'; END IF;
  v_event_id := (p_event->>'event_id')::uuid;
  v_occurred_at := COALESCE((p_event->>'occurred_at')::timestamptz, now());
  IF v_occurred_at < now() - interval '24 hours' OR v_occurred_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT * INTO STRICT v_site FROM public.brand_sites
    WHERE id = (p_event->>'site_id')::uuid
      AND brand_id = (p_event->>'brand_id')::uuid;
  SELECT * INTO STRICT v_publication FROM public.brand_site_publications
    WHERE id = (p_event->>'publication_id')::uuid
      AND site_id = v_site.id AND status = 'published';
  IF v_site.active_publication_id <> v_publication.id THEN
    RAISE EXCEPTION 'sites_invalid_state';
  END IF;
  INSERT INTO public.brand_site_analytics_events(
    event_id, site_id, brand_id, publication_id, event_name, occurred_at,
    page_role, cta_kind, offering_id, referrer_class, consent_policy_version
  ) VALUES (
    v_event_id, v_site.id, v_site.brand_id, v_publication.id,
    p_event->>'event_name', v_occurred_at, NULLIF(p_event->>'page_role',''),
    NULLIF(p_event->>'cta_kind',''), NULLIF(p_event->>'offering_id','')::uuid,
    NULLIF(p_event->>'referrer_class',''), p_event->>'consent_policy_version'
  ) ON CONFLICT (event_id) DO NOTHING;
  RETURN jsonb_build_object('accepted', true, 'event_id', v_event_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_customer_analytics(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_brand_id uuid;
BEGIN
  SELECT brand_id INTO STRICT v_brand_id FROM public.brand_sites WHERE id = p_site_id;
  IF auth.uid() IS NULL OR public.biz_brand_effective_rank(v_brand_id, auth.uid()) < 20 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'site_id', p_site_id,
      'issued_handoffs', count(*),
      'consumed_handoffs', count(*) FILTER (WHERE consumed_at IS NOT NULL),
      'events_30d', (
        SELECT count(*) FROM public.brand_site_analytics_events event
        WHERE event.site_id = p_site_id AND event.occurred_at >= now() - interval '30 days'
      ),
      'generated_at', now()
    ) FROM public.brand_site_attribution_touches WHERE site_id = p_site_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_customer_audit(p_site_id uuid)
RETURNS TABLE (
  occurred_at timestamptz,
  action text,
  resource_kind text,
  resource_id text,
  operation_id uuid,
  metadata jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_brand_id uuid;
BEGIN
  SELECT brand_id INTO STRICT v_brand_id FROM public.brand_sites WHERE id = p_site_id;
  IF auth.uid() IS NULL OR public.biz_brand_effective_rank(v_brand_id, auth.uid()) < 50 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  RETURN QUERY SELECT log.occurred_at, log.action, log.resource_kind,
    log.resource_id, log.operation_id, log.metadata
  FROM public.brand_site_audit_log log
  WHERE log.site_id = p_site_id ORDER BY log.occurred_at DESC LIMIT 100;
END;
$$;

-- The operations console reads through guard-first projections. It never gains
-- direct table access and never receives editor exchange digests, gateway
-- nonces, attribution tokens, service origins, or credential material.
CREATE OR REPLACE FUNCTION public.brand_site_admin_list(
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(trim(COALESCE(p_search, '')), '');
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.brand_sites site
  JOIN public.brands brand ON brand.id = site.brand_id
  WHERE v_search IS NULL
    OR brand.name ILIKE '%' || replace(replace(v_search, '%', '\%'), '_', '\_') || '%' ESCAPE '\'
    OR site.id::text = v_search
    OR site.brand_id::text = v_search;

  SELECT COALESCE(jsonb_agg(to_jsonb(row_value) ORDER BY row_value.updated_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT site.id AS site_id, site.brand_id, brand.name AS brand_name,
      site.status, site.renderer_key, site.renderer_version,
      site.active_publication_id, site.last_successful_publication_id,
      site.provisioning_error_code AS safe_error_code, site.updated_at,
      host.hostname AS permanent_hostname, host.status AS host_status,
      publication.completed_at AS last_published_at,
      CASE
        WHEN site.payload_tenant_id IS NULL THEN 'not_configured'
        WHEN site.status = 'error' THEN 'attention_needed'
        ELSE 'ready'
      END AS editor_health,
      CASE
        WHEN site.status = 'suspended' THEN 'suspended'
        WHEN config.pilot_enabled AND publication.id IS NOT NULL AND host.status = 'active'
          THEN 'verified'
        WHEN publication.id IS NOT NULL THEN 'last_good_ready'
        ELSE 'not_published'
      END AS public_health,
      NULL::integer AS media_backlog,
      COALESCE(config.pilot_enabled, false) AS pilot_enabled
    FROM public.brand_sites site
    JOIN public.brands brand ON brand.id = site.brand_id
    LEFT JOIN LATERAL (
      SELECT h.hostname, h.status
      FROM public.brand_site_hosts h
      WHERE h.site_id = site.id AND h.is_primary
      ORDER BY h.created_at DESC LIMIT 1
    ) host ON true
    LEFT JOIN public.brand_site_publications publication
      ON publication.id = site.active_publication_id
    LEFT JOIN public.brand_site_service_config config
      ON config.config_key = 'sites_v1'
      AND config.pilot_site_id = site.id
      AND config.pilot_brand_id = site.brand_id
    WHERE v_search IS NULL
      OR brand.name ILIKE '%' || replace(replace(v_search, '%', '\%'), '_', '\_') || '%' ESCAPE '\'
      OR site.id::text = v_search
      OR site.brand_id::text = v_search
    ORDER BY site.updated_at DESC
    LIMIT v_limit OFFSET v_offset
  ) row_value;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_admin_detail(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;

  SELECT jsonb_build_object(
    'site', jsonb_build_object(
      'site_id', site.id, 'brand_id', site.brand_id, 'brand_name', brand.name,
      'status', site.status, 'renderer_key', site.renderer_key,
      'renderer_version', site.renderer_version,
      'active_publication_id', site.active_publication_id,
      'last_successful_publication_id', site.last_successful_publication_id,
      'safe_error_code', site.provisioning_error_code,
      'created_at', site.created_at, 'updated_at', site.updated_at,
      'suspended_at', site.suspended_at,
      'suspension_reason_code', site.suspension_reason_code
    ),
    'hosts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'hostname', host.hostname, 'kind', host.kind, 'status', host.status,
        'is_primary', host.is_primary, 'activated_at', host.activated_at
      ) ORDER BY host.created_at DESC)
      FROM public.brand_site_hosts host WHERE host.site_id = site.id
    ), '[]'::jsonb),
    'publications', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'publication_id', publication.id, 'operation_id', publication.operation_id,
        'source_revision_id', publication.source_revision_id,
        'source_digest', publication.source_digest,
        'artifact_digest', publication.artifact_digest,
        'artifact_schema_version', publication.artifact_schema_version,
        'renderer_key', publication.renderer_key,
        'renderer_version', publication.renderer_version,
        'status', publication.status,
        'previous_publication_id', publication.previous_publication_id,
        'rollback_source_publication_id', publication.rollback_source_publication_id,
        'failure_code', publication.failure_code,
        'requested_at', publication.requested_at,
        'completed_at', publication.completed_at
      ) ORDER BY publication.requested_at DESC)
      FROM (
        SELECT * FROM public.brand_site_publications
        WHERE site_id = site.id ORDER BY requested_at DESC LIMIT 25
      ) publication
    ), '[]'::jsonb),
    'receipts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'operation_id', receipt.operation_id, 'kind', receipt.kind,
        'status', receipt.status, 'error_code', receipt.error_code,
        'authorized_at', receipt.authorized_at, 'started_at', receipt.started_at,
        'completed_at', receipt.completed_at, 'updated_at', receipt.updated_at
      ) ORDER BY receipt.updated_at DESC)
      FROM (
        SELECT * FROM public.brand_site_operation_receipts
        WHERE site_id = site.id ORDER BY updated_at DESC LIMIT 50
      ) receipt
    ), '[]'::jsonb),
    'audit', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'occurred_at', audit.occurred_at, 'actor_kind', audit.actor_kind,
        'action', audit.action, 'resource_kind', audit.resource_kind,
        'resource_id', audit.resource_id, 'operation_id', audit.operation_id,
        'metadata', audit.metadata
      ) ORDER BY audit.occurred_at DESC)
      FROM (
        SELECT * FROM public.brand_site_audit_log
        WHERE site_id = site.id ORDER BY occurred_at DESC LIMIT 100
      ) audit
    ), '[]'::jsonb),
    'health', jsonb_build_object(
      'editor', CASE WHEN site.payload_tenant_id IS NULL THEN 'not_configured'
        WHEN site.status = 'error' THEN 'attention_needed' ELSE 'ready' END,
      'public', CASE WHEN site.status = 'suspended' THEN 'suspended'
        WHEN config.pilot_enabled AND site.active_publication_id IS NOT NULL THEN 'verified'
        WHEN site.active_publication_id IS NOT NULL THEN 'last_good_ready'
        ELSE 'not_published' END,
      'media', 'not_reported', 'backup', 'not_reported'
    ),
    'readiness', jsonb_build_object(
      'pilot_enabled', COALESCE(config.pilot_enabled, false),
      'backup_entitlement_verified_at', config.backup_entitlement_verified_at,
      'backup_retention_days', config.backup_retention_days,
      'backup_last_verified_at', config.database_backup_verified_at,
      'manifest_last_verified_at', config.object_manifest_verified_at,
      'restore_last_tested_at', config.restore_drill_verified_at,
      'backup_age_hours', CASE WHEN config.database_backup_verified_at IS NULL THEN NULL
        ELSE extract(epoch FROM (now() - config.database_backup_verified_at)) / 3600 END,
      'manifest_age_hours', CASE WHEN config.object_manifest_verified_at IS NULL THEN NULL
        ELSE extract(epoch FROM (now() - config.object_manifest_verified_at)) / 3600 END,
      'restore_age_days', CASE WHEN config.restore_drill_verified_at IS NULL THEN NULL
        ELSE extract(epoch FROM (now() - config.restore_drill_verified_at)) / 86400 END,
      'media_counts', jsonb_build_object('processing', NULL, 'failed', NULL, 'ready', NULL)
    )
  ) INTO v_result
  FROM public.brand_sites site
  JOIN public.brands brand ON brand.id = site.brand_id
  LEFT JOIN public.brand_site_service_config config
    ON config.config_key = 'sites_v1'
    AND config.pilot_site_id = site.id
    AND config.pilot_brand_id = site.brand_id
  WHERE site.id = p_site_id;

  IF v_result IS NULL THEN RAISE EXCEPTION 'sites_not_found'; END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.brand_site_admin_action(
  p_site_id uuid,
  p_operation_id uuid,
  p_action text,
  p_reason_code text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_kind text;
  v_status text;
  v_arguments_digest text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF p_action NOT IN ('reconcile','suspend','resume','revoke_editor_sessions')
    OR p_reason_code !~ '^[A-Z][A-Z0-9_]{2,63}$' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;

  SELECT * INTO STRICT v_site FROM public.brand_sites
  WHERE id = p_site_id FOR UPDATE;
  v_kind := CASE WHEN p_action = 'revoke_editor_sessions'
    THEN 'revoke_sessions' ELSE p_action END;
  v_arguments_digest := encode(digest(
    p_site_id::text || ':' || p_action || ':' || p_reason_code, 'sha256'
  ), 'hex');

  SELECT receipt.status INTO v_status
  FROM public.brand_site_operation_receipts receipt
  WHERE receipt.operation_id = p_operation_id;
  IF FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.brand_site_operation_receipts receipt
      WHERE receipt.operation_id = p_operation_id
        AND receipt.site_id = p_site_id
        AND receipt.kind = v_kind
        AND receipt.arguments_digest = v_arguments_digest
    ) THEN
      RETURN jsonb_build_object(
        'operation_id', p_operation_id, 'site_id', p_site_id,
        'status', v_status, 'replayed', true
      );
    END IF;
    RAISE EXCEPTION 'sites_idempotency_conflict';
  END IF;

  IF p_action = 'suspend' THEN
    UPDATE public.brand_sites SET status = 'suspended', suspended_at = now(),
      suspended_by = auth.uid(), suspension_reason_code = p_reason_code
    WHERE id = p_site_id AND status <> 'suspended';
    UPDATE public.brand_site_hosts SET status = 'suspended'
    WHERE site_id = p_site_id AND status = 'active';
  ELSIF p_action = 'resume' THEN
    IF v_site.status <> 'suspended' THEN RAISE EXCEPTION 'sites_invalid_state'; END IF;
    UPDATE public.brand_sites SET
      status = CASE WHEN active_publication_id IS NULL THEN 'draft' ELSE 'published' END,
      suspended_at = NULL, suspended_by = NULL, suspension_reason_code = NULL
    WHERE id = p_site_id;
    UPDATE public.brand_site_hosts host SET status = CASE
      WHEN EXISTS (
        SELECT 1 FROM public.brand_site_service_config config
        WHERE config.config_key = 'sites_v1' AND config.pilot_enabled
          AND config.pilot_site_id = p_site_id
      ) THEN 'active' ELSE 'pending' END
    WHERE host.site_id = p_site_id AND host.status = 'suspended';
  ELSIF p_action = 'revoke_editor_sessions' THEN
    UPDATE public.brand_site_editor_exchanges SET status = 'revoked', revoked_at = now()
    WHERE site_id = p_site_id AND status = 'issued';
  ELSIF p_action = 'reconcile' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.brand_site_operation_receipts receipt
      WHERE receipt.site_id = p_site_id AND receipt.status IN ('failed','ambiguous')
    ) THEN RAISE EXCEPTION 'sites_invalid_state'; END IF;
  END IF;

  INSERT INTO public.brand_site_operation_receipts(
    operation_id, site_id, brand_id, user_id, kind, arguments_digest,
    status, result_summary, started_at, completed_at
  ) VALUES (
    p_operation_id, p_site_id, v_site.brand_id, auth.uid(), v_kind,
    v_arguments_digest, 'succeeded',
    jsonb_build_object('site_id', p_site_id, 'status', 'succeeded'),
    now(), now()
  );

  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action, resource_kind,
    resource_id, operation_id, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, auth.uid(), 'admin',
    CASE p_action
      WHEN 'suspend' THEN 'site.suspended'
      WHEN 'resume' THEN 'site.resumed'
      WHEN 'revoke_editor_sessions' THEN 'editor.sessions_revoked'
      ELSE 'publication.reconciled'
    END,
    'brand_site', p_site_id::text, p_operation_id,
    jsonb_build_object('reason_code', p_reason_code)
  );

  RETURN jsonb_build_object(
    'operation_id', p_operation_id, 'site_id', p_site_id,
    'status', 'succeeded', 'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.brand_site_json_keys_allowed(jsonb,text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_provision(uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.brand_site_issue_editor_exchange(uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.brand_site_authorize_operation(uuid,uuid,text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.brand_site_consume_editor_exchange(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_complete_provision(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_complete_preview(uuid,uuid,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_commercial_projection(uuid,uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_complete_publication(uuid,uuid,uuid,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_fail_publication(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_internal_authorize(uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_resolve_publication(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_consume_attribution(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_record_analytics_event(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.brand_site_customer_analytics(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.brand_site_customer_audit(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.brand_site_admin_list(text,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.brand_site_admin_detail(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.brand_site_admin_action(uuid,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_provision(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_issue_editor_exchange(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_authorize_operation(uuid,uuid,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_customer_analytics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_customer_audit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_admin_list(text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_admin_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_admin_action(uuid,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_consume_editor_exchange(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_complete_provision(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_complete_preview(uuid,uuid,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_commercial_projection(uuid,uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_complete_publication(uuid,uuid,uuid,text,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_fail_publication(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_internal_authorize(uuid,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_resolve_publication(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_consume_attribution(text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.brand_site_record_analytics_event(jsonb) TO service_role;

COMMENT ON TABLE public.brand_sites IS
  '#2830 Core-owned site identity, renderer and last-good publication pointers.';
COMMENT ON TABLE public.brand_site_service_config IS
  '#2830 private nonsecret service origins and disabled-by-default Gogi pilot binding.';
COMMENT ON FUNCTION public.brand_site_resolve_publication(text) IS
  '#2830 exact-host, active-pointer-only public runtime projection; never returns draft state.';
