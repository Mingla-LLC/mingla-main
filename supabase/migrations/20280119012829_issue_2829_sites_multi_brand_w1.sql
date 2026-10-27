BEGIN;
SET LOCAL lock_timeout = '10s';

-- #2829 W1 — Mingla Sites for more than one brand.
--
-- Until now Sites served exactly one brand: the service row carried a single
-- pilot brand/site pair and the resolver, provisioning, readiness and admin
-- functions compared against literal brand, operator, origin and hostname
-- values. This migration replaces every one of those pins with data:
--
--   * per-brand entitlements (granted / revoked by a Mingla admin, audited);
--   * `<label>.<public_host_suffix>` hosts derived from the brand's slug, with
--     reserved words and collisions resolved once and never changed after;
--   * an owner "take offline" switch and an export request;
--   * publish and rollback at rank 50 (brand admin), preview at rank 20;
--   * recovery evidence that alerts and gates a NEW site's first publish, but
--     never removes a published site from public resolution.
--
-- The single existing pilot binding is moved into an entitlement row by the
-- data it already holds (no uuid literal), and its existing hostname keeps
-- resolving because the new host rules accept it unchanged.
-- Forward-only. Historical migrations are not edited; their literals are
-- neutralised here by DROP / CREATE OR REPLACE.

-- ── 1. Service configuration: recovery alert state ─────────────────────────
ALTER TABLE public.brand_site_service_config
  ADD COLUMN recovery_alert_state text NOT NULL DEFAULT 'unknown'
    CONSTRAINT brand_site_service_config_recovery_alert_state_ck
    CHECK (recovery_alert_state IN ('unknown','fresh','late','stale')),
  ADD COLUMN recovery_alerted_at timestamptz;

-- The host-readiness evidence named one literal hostname. It now accepts any
-- well-formed hostname; the recording function checks it belongs to the site.
ALTER TABLE public.brand_site_service_config
  DROP CONSTRAINT brand_site_service_config_host_readiness_ck;
ALTER TABLE public.brand_site_service_config
  ADD CONSTRAINT brand_site_service_config_host_readiness_ck CHECK (
    (host_readiness_verified_at IS NULL AND host_readiness_hostname IS NULL
      AND tls_evidence_digest IS NULL AND public_probe_evidence_digest IS NULL
      AND public_probe_publication_id IS NULL AND public_probe_artifact_digest IS NULL)
    OR
    (host_readiness_verified_at IS NOT NULL
      AND host_readiness_hostname ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
      AND tls_evidence_digest ~ '^[0-9a-f]{64}$'
      AND public_probe_evidence_digest ~ '^[0-9a-f]{64}$'
      AND public_probe_publication_id IS NOT NULL
      AND public_probe_artifact_digest ~ '^[0-9a-f]{64}$')
  );

-- ── 2. Per-brand entitlements ──────────────────────────────────────────────
CREATE TABLE public.brand_site_entitlements (
  brand_id uuid PRIMARY KEY REFERENCES public.brands(id),
  status text NOT NULL CHECK (status IN ('granted','revoked')),
  source text NOT NULL CHECK (source IN ('admin','pilot_migration','rule')),
  granted_by uuid REFERENCES auth.users(id),
  granted_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  revoked_at timestamptz,
  reason_code text NOT NULL CHECK (reason_code IN (
    'pilot','rollout','support','abuse','owner_request','other'
  )),
  note text CHECK (note IS NULL OR length(note) <= 500),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_site_entitlements_state_ck CHECK (
    (status = 'granted' AND granted_at IS NOT NULL AND revoked_at IS NULL
      AND revoked_by IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);
ALTER TABLE public.brand_site_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_entitlements FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_site_entitlements FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.brand_site_entitlements TO service_role;
CREATE TRIGGER brand_site_entitlements_set_updated_at
BEFORE UPDATE ON public.brand_site_entitlements
FOR EACH ROW EXECUTE FUNCTION public.brand_site_set_updated_at();

-- Data move: the one pilot binding becomes an entitlement. Data-driven.
INSERT INTO public.brand_site_entitlements(
  brand_id, status, source, granted_by, granted_at, reason_code
)
SELECT pilot_brand_id, 'granted', 'pilot_migration', configured_by,
  configured_at, 'pilot'
FROM public.brand_site_service_config
WHERE pilot_brand_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── 3. Subtract the pilot binding ──────────────────────────────────────────
DROP FUNCTION IF EXISTS public.brand_site_activate_gogi_pilot(uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.brand_site_deactivate_gogi_pilot(uuid, uuid, text, uuid, text);
DROP FUNCTION IF EXISTS public.brand_site_configure_pilot_binding(uuid, uuid, text, text, uuid, uuid);
ALTER TABLE public.brand_site_service_config
  DROP CONSTRAINT brand_site_service_config_pair_ck,
  DROP CONSTRAINT brand_site_service_config_enable_ck;
DROP TRIGGER brand_site_validate_service_config ON public.brand_site_service_config;
DROP FUNCTION public.brand_site_validate_service_config();
ALTER TABLE public.brand_site_service_config
  DROP COLUMN pilot_brand_id,
  DROP COLUMN pilot_site_id,
  DROP COLUMN pilot_enabled;

-- ── 4. Sites: renderer union, owner offline, design key ────────────────────
ALTER TABLE public.brand_sites DROP CONSTRAINT brand_sites_renderer_key_check;
ALTER TABLE public.brand_sites
  ADD CONSTRAINT brand_sites_renderer_key_check
    CHECK (renderer_key IN ('restaurant-website-v1','sites-v2')),
  ALTER COLUMN renderer_key SET DEFAULT 'sites-v2',
  ADD COLUMN owner_offline_at timestamptz,
  ADD COLUMN owner_offline_by uuid REFERENCES auth.users(id),
  ADD COLUMN owner_offline_reason text
    CHECK (owner_offline_reason IS NULL OR length(owner_offline_reason) <= 200),
  ADD COLUMN design_key text
    CHECK (design_key IS NULL OR design_key ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD CONSTRAINT brand_sites_owner_offline_pair_ck
    CHECK ((owner_offline_at IS NULL) = (owner_offline_by IS NULL));

-- ── 5. Publications: renderer and schema unions, design ────────────────────
ALTER TABLE public.brand_site_publications
  DROP CONSTRAINT brand_site_publications_renderer_key_check,
  DROP CONSTRAINT brand_site_publications_artifact_schema_version_check;
ALTER TABLE public.brand_site_publications
  ADD CONSTRAINT brand_site_publications_renderer_key_check
    CHECK (renderer_key IN ('restaurant-website-v1','sites-v2')),
  ADD CONSTRAINT brand_site_publications_artifact_schema_version_check
    CHECK (artifact_schema_version IN (1, 2)),
  ADD COLUMN design_key text
    CHECK (design_key IS NULL OR design_key ~ '^[a-z][a-z0-9-]{1,31}$'),
  ADD COLUMN design_version integer
    CHECK (design_version IS NULL OR design_version > 0);

-- ── 6. Hosts: any brand's subdomain, later custom domains ──────────────────
-- #2829 — the shape rule mirrors isValidSiteHostname() in
-- supabase/functions/_shared/sitesContracts.ts (parity tested).
ALTER TABLE public.brand_site_hosts
  DROP CONSTRAINT brand_site_hosts_hostname_shape_ck,
  DROP CONSTRAINT brand_site_hosts_kind_check,
  DROP CONSTRAINT brand_site_hosts_status_check;
ALTER TABLE public.brand_site_hosts
  ADD CONSTRAINT brand_site_hosts_hostname_shape_ck CHECK (
    hostname = lower(hostname)
    AND length(hostname) BETWEEN 4 AND 253
    AND hostname ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    AND hostname !~ '[*:/?#@]'
    AND hostname !~ '\.$'
  ),
  ADD CONSTRAINT brand_site_hosts_kind_check
    CHECK (kind IN ('mingla_subdomain','custom_domain')),
  ADD CONSTRAINT brand_site_hosts_status_check
    CHECK (status IN ('pending','verifying','active','detaching','suspended','retired')),
  ADD COLUMN label text
    CHECK (label IS NULL OR label ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  ADD COLUMN is_apex boolean NOT NULL DEFAULT false,
  ADD COLUMN verification jsonb
    CHECK (public.brand_site_json_keys_allowed(verification, ARRAY['type','name','value'])),
  ADD COLUMN dns_state text NOT NULL DEFAULT 'unknown'
    CHECK (dns_state IN ('unknown','pending','ok','misconfigured')),
  ADD COLUMN tls_state text NOT NULL DEFAULT 'unknown'
    CHECK (tls_state IN ('unknown','pending','issued','expiring','failed')),
  ADD COLUMN last_checked_at timestamptz,
  ADD COLUMN misconfigured_since timestamptz,
  ADD COLUMN detach_requested_at timestamptz,
  ADD COLUMN redirect_until timestamptz,
  ADD COLUMN provider_ref text
    CHECK (provider_ref IS NULL OR length(provider_ref) <= 200);

-- Data-driven backfill of the existing subdomain host(s).
UPDATE public.brand_site_hosts
SET label = split_part(hostname, '.', 1)
WHERE kind = 'mingla_subdomain' AND label IS NULL;

CREATE OR REPLACE FUNCTION public.brand_site_validate_host()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_suffix text;
BEGIN
  IF NEW.kind = 'mingla_subdomain' THEN
    SELECT config.public_host_suffix INTO v_suffix
    FROM public.brand_site_service_config config
    WHERE config.config_key = 'sites_v1';
    IF v_suffix IS NULL OR NEW.label IS NULL
      OR NEW.hostname <> NEW.label || '.' || v_suffix THEN
      RAISE EXCEPTION 'sites_host_invalid';
    END IF;
  ELSE
    IF NEW.hostname ~ '(^|\.)(usemingla\.com|sites\.localhost|vercel\.app|supabase\.co|mingla\.app)$' THEN
      RAISE EXCEPTION 'sites_host_invalid';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.hostname IS DISTINCT FROM OLD.hostname
    OR NEW.label IS DISTINCT FROM OLD.label
    OR NEW.site_id IS DISTINCT FROM OLD.site_id) THEN
    -- A site's address never changes after it is created.
    RAISE EXCEPTION 'sites_host_immutable';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.brand_site_validate_host() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER brand_site_validate_host
BEFORE INSERT OR UPDATE ON public.brand_site_hosts
FOR EACH ROW EXECUTE FUNCTION public.brand_site_validate_host();

-- ── 7. Reserved labels ─────────────────────────────────────────────────────
CREATE TABLE public.brand_site_reserved_labels (
  label text PRIMARY KEY
    CHECK (label ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  reason text NOT NULL CHECK (reason IN ('system','brand_protection','profanity')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.brand_site_reserved_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_site_reserved_labels FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_site_reserved_labels FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.brand_site_reserved_labels TO service_role;
INSERT INTO public.brand_site_reserved_labels(label, reason)
SELECT word, 'system' FROM unnest(ARRAY[
  'www','admin','api','app','studio','mail','email','smtp','ftp','sites',
  'site','preview','media','static','cdn','assets','help','support','status',
  'mingla','host','hosts','business','checkout','pay','auth','login','account',
  'dashboard','docs','blog','dev','test','staging','internal','root','ns1','ns2'
]) AS word
ON CONFLICT (label) DO NOTHING;

-- ── 8. Receipts, audit and readiness vocabularies ──────────────────────────
ALTER TABLE public.brand_site_operation_receipts
  DROP CONSTRAINT brand_site_operation_receipts_kind_check,
  DROP CONSTRAINT brand_site_receipts_result_ck;
ALTER TABLE public.brand_site_operation_receipts
  ADD CONSTRAINT brand_site_operation_receipts_kind_check CHECK (kind IN (
    'provision','editor_session','preview','publish','rollback',
    'suspend','resume','reconcile','revoke_sessions',
    'offline','online','export','domain_attach','domain_check',
    'domain_set_primary','domain_detach','plan_update'
  )),
  ADD CONSTRAINT brand_site_receipts_result_ck CHECK (
    public.brand_site_json_keys_allowed(
      result_summary,
      ARRAY['site_id','publication_id','status','destination','expires_at',
        'revision_id','artifact_digest','last_good_preserved','retryable',
        'brand_id','user_id','rank','generated_at',
        'rollback_source_publication_id','public_reachable',
        'public_status_code','public_checked_at',
        'offline','download_url','bytes']
    )
  );

-- Entitlement grants and reserved labels are audited even when no site
-- exists yet, so those (and only those) rows may omit the site.
ALTER TABLE public.brand_site_audit_log
  ALTER COLUMN site_id DROP NOT NULL,
  ALTER COLUMN brand_id DROP NOT NULL,
  DROP CONSTRAINT brand_site_audit_log_action_check,
  DROP CONSTRAINT brand_site_audit_metadata_ck;
ALTER TABLE public.brand_site_audit_log
  ADD CONSTRAINT brand_site_audit_log_action_check CHECK (action IN (
    'site.provision_requested','site.provisioned','site.provision_failed',
    'editor.exchange_issued','editor.exchange_consumed','editor.sessions_revoked',
    'preview.requested','preview.created',
    'publication.requested','publication.published','publication.failed',
    'publication.reconciled','publication.rollback_requested',
    'publication.public_check','operation.reconcile_checked',
    'site.suspended','site.resumed','attribution.consumed',
    'pilot.activated','pilot.deactivated',
    'site.owner_offline','site.owner_online',
    'site.export_requested','site.export_ready',
    'entitlement.granted','entitlement.revoked','label.reserved',
    'host.set_primary','host.released'
  )),
  ADD CONSTRAINT brand_site_audit_metadata_ck CHECK (
    public.brand_site_json_keys_allowed(
      metadata,
      ARRAY['status','safe_error_code','renderer_version','schema_version',
        'destination','reason_code','last_good_preserved','hostname',
        'publication_id','status_code','reachable','digest_ok','label']
    )
  ),
  ADD CONSTRAINT brand_site_audit_log_scope_ck CHECK (
    (site_id IS NOT NULL AND brand_id IS NOT NULL)
    OR (site_id IS NULL AND brand_id IS NOT NULL
      AND action IN ('entitlement.granted','entitlement.revoked'))
    OR (site_id IS NULL AND brand_id IS NULL AND action = 'label.reserved')
  );

-- Recovery alerts are service-wide (one CMS project backs every site).
ALTER TABLE public.brand_site_readiness_receipts
  ALTER COLUMN brand_id DROP NOT NULL,
  DROP CONSTRAINT brand_site_readiness_receipts_evidence_kind_check,
  ADD COLUMN evidence_source text NOT NULL DEFAULT 'scheduled_job'
    CHECK (evidence_source IN ('scheduled_job','local_synthetic'));
ALTER TABLE public.brand_site_readiness_receipts
  ADD CONSTRAINT brand_site_readiness_receipts_evidence_kind_check
    CHECK (evidence_kind IN (
      'pilot_configuration','nightly_backup','restore_drill','host_probe',
      'pilot_activation','pilot_deactivation','public_check','recovery_alert'
    )),
  ADD CONSTRAINT brand_site_readiness_receipts_scope_ck CHECK (
    brand_id IS NOT NULL
    OR (evidence_kind = 'recovery_alert' AND site_id IS NULL)
  );

-- ── 9. Functions ───────────────────────────────────────────────────────────

-- 9.1 Labels. Lowercase ASCII only: accents are folded with a fixed table
-- (Latin-1 Supplement + Latin Extended-A), so the result does not depend on
-- which extensions or collations a database has.
CREATE OR REPLACE FUNCTION public.brand_site_subdomain_label(p_seed text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(NULLIF(
    trim(BOTH '-' FROM left(
      trim(BOTH '-' FROM regexp_replace(
        lower(translate(
          replace(replace(replace(replace(replace(replace(replace(replace(replace(
            COALESCE(p_seed, ''),
            'Æ', 'AE'), 'æ', 'ae'), 'Œ', 'OE'), 'œ', 'oe'), 'ß', 'ss'),
            'Þ', 'TH'), 'þ', 'th'), 'Ĳ', 'IJ'), 'ĳ', 'ij'),
          'ÀÁÂÃÄÅĀĂĄàáâãäåāăąÇĆĈĊČçćĉċčÐĎĐðďđÈÉÊËĒĔĖĘĚèéêëēĕėęěĜĞĠĢĝğġģĤĦĥħÌÍÎÏĨĪĬĮİìíîïĩīĭįıĴĵĶķĸĹĻĽĿŁĺļľŀłÑŃŅŇŊñńņňŉŋÒÓÔÕÖØŌŎŐòóôõöøōŏőŔŖŘŕŗřŚŜŞŠśŝşšſŢŤŦţťŧÙÚÛÜŨŪŬŮŰŲùúûüũūŭůűųŴŵÝŶŸýÿŷŹŻŽźżž',
          'AAAAAAAAAaaaaaaaaaCCCCCcccccDDDdddEEEEEEEEEeeeeeeeeeGGGGggggHHhhIIIIIIIIIiiiiiiiiiJjKkkLLLLLlllllNNNNNnnnnnnOOOOOOOOOoooooooooRRRrrrSSSSsssssTTTtttUUUUUUUUUUuuuuuuuuuuWwYYYyyyZZZzzz'
        )),
        '[^a-z0-9]+', '-', 'g'
      )),
      63
    )),
  ''), 'site');
$$;
REVOKE ALL ON FUNCTION public.brand_site_subdomain_label(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_subdomain_label(text) TO authenticated, service_role;

-- The first free label for a seed: reserved words and taken hostnames get
-- -2, -3, ... (the base is shortened so the result stays within 63 chars).
CREATE OR REPLACE FUNCTION public.brand_site_available_label(p_seed text, p_suffix text)
RETURNS text
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_base text := public.brand_site_subdomain_label(p_seed);
  v_candidate text := v_base;
  v_n integer := 1;
  v_tail text;
BEGIN
  LOOP
    IF NOT EXISTS (
        SELECT 1 FROM public.brand_site_reserved_labels reserved
        WHERE reserved.label = v_candidate)
      AND NOT EXISTS (
        SELECT 1 FROM public.brand_site_hosts host
        WHERE host.hostname = v_candidate || '.' || p_suffix) THEN
      RETURN v_candidate;
    END IF;
    v_n := v_n + 1;
    IF v_n > 1000 THEN RAISE EXCEPTION 'sites_label_unavailable'; END IF;
    v_tail := '-' || v_n::text;
    v_candidate := trim(BOTH '-' FROM left(v_base, 63 - length(v_tail))) || v_tail;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.brand_site_available_label(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_available_label(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.brand_site_entitled(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.brand_site_entitlements entitlement
    JOIN public.brands brand ON brand.id = entitlement.brand_id
    WHERE entitlement.brand_id = p_brand_id
      AND entitlement.status = 'granted'
      AND brand.deleted_at IS NULL
  );
$$;
REVOKE ALL ON FUNCTION public.brand_site_entitled(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_entitled(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.brand_site_propose_label(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_suffix text;
  v_existing record;
  v_seed text;
  v_label text;
BEGIN
  IF v_actor IS NULL OR public.biz_brand_effective_rank(p_brand_id, v_actor) < 50
    OR NOT public.brand_site_entitled(p_brand_id) THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  SELECT config.public_host_suffix INTO v_suffix
  FROM public.brand_site_service_config config WHERE config.config_key = 'sites_v1';
  IF v_suffix IS NULL THEN RAISE EXCEPTION 'sites_service_unconfigured'; END IF;
  -- The address never changes once it exists.
  SELECT host.label, host.hostname INTO v_existing
  FROM public.brand_site_hosts host
  JOIN public.brand_sites site ON site.id = host.site_id
  WHERE site.brand_id = p_brand_id AND host.kind = 'mingla_subdomain'
  ORDER BY host.created_at LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('label', v_existing.label,
      'hostname', v_existing.hostname, 'existing', true);
  END IF;
  SELECT COALESCE(NULLIF(brand.slug, ''), brand.name) INTO v_seed
  FROM public.brands brand WHERE brand.id = p_brand_id;
  v_label := public.brand_site_available_label(v_seed, v_suffix);
  RETURN jsonb_build_object('label', v_label,
    'hostname', v_label || '.' || v_suffix, 'existing', false);
END;
$$;
REVOKE ALL ON FUNCTION public.brand_site_propose_label(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_propose_label(uuid) TO authenticated, service_role;

-- 9.2 Provisioning. Any entitled brand; the host is derived, never a literal.
DROP FUNCTION IF EXISTS public.brand_site_provision(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.brand_site_provision(
  p_brand_id uuid,
  p_operation_id uuid,
  p_arguments_digest text,
  p_label text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_site public.brand_sites%ROWTYPE;
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
  v_suffix text;
  v_label text;
  v_seed text;
BEGIN
  IF v_actor IS NULL OR public.biz_brand_effective_rank(p_brand_id, v_actor) < 50 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF p_arguments_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  -- #2829 — the entitlement is the allowlist; a deleted brand never qualifies.
  IF NOT public.brand_site_entitled(p_brand_id) THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  SELECT config.public_host_suffix INTO v_suffix
  FROM public.brand_site_service_config config
  WHERE config.config_key = 'sites_v1'
  FOR SHARE;
  IF v_suffix IS NULL THEN RAISE EXCEPTION 'sites_forbidden'; END IF;
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
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brand_site_hosts host
    WHERE host.site_id = v_site.id AND host.kind = 'mingla_subdomain'
  ) THEN
    IF p_label IS NOT NULL THEN
      IF public.brand_site_subdomain_label(p_label) <> p_label
        OR EXISTS (SELECT 1 FROM public.brand_site_reserved_labels reserved
          WHERE reserved.label = p_label)
        OR EXISTS (SELECT 1 FROM public.brand_site_hosts host
          WHERE host.hostname = p_label || '.' || v_suffix) THEN
        RAISE EXCEPTION 'sites_label_unavailable';
      END IF;
      v_label := p_label;
    ELSE
      SELECT COALESCE(NULLIF(brand.slug, ''), brand.name) INTO v_seed
      FROM public.brands brand WHERE brand.id = p_brand_id;
      v_label := public.brand_site_available_label(v_seed, v_suffix);
    END IF;
    -- Wildcard DNS covers every label, so the host only waits for the CMS
    -- tenant: brand_site_complete_provision activates it.
    INSERT INTO public.brand_site_hosts(site_id, hostname, kind, status, is_primary, label)
    VALUES (v_site.id, v_label || '.' || v_suffix, 'mingla_subdomain', 'pending', true, v_label);
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
REVOKE ALL ON FUNCTION public.brand_site_provision(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_provision(uuid, uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brand_site_complete_provision(
  p_site_id uuid, p_operation_id uuid, p_payload_tenant_id text
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
  -- #2829 — the subdomain is live as soon as the tenant exists (wildcard DNS
  -- and certificate). Nothing resolves until a publication is published.
  UPDATE public.brand_site_hosts SET status = 'active', activated_at = clock_timestamp()
  WHERE site_id = p_site_id AND kind = 'mingla_subdomain'
    AND is_primary AND status = 'pending';
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

-- 9.3 What the Business app may show and do.
CREATE OR REPLACE FUNCTION public.brand_site_business_availability(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_rank integer;
  v_site public.brand_sites%ROWTYPE;
BEGIN
  v_rank := public.biz_brand_effective_rank(p_brand_id, v_actor);
  IF v_actor IS NULL OR v_rank < 20 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF NOT public.brand_site_entitled(p_brand_id) THEN
    RETURN jsonb_build_object('available', false, 'can_create', false,
      'can_publish', false, 'can_edit', false);
  END IF;
  SELECT * INTO v_site FROM public.brand_sites site
  WHERE site.brand_id = p_brand_id;
  RETURN jsonb_build_object(
    'available', true,
    'can_create', v_rank >= 50,
    'can_publish', v_rank >= 50,
    'can_edit', v_rank >= 20,
    'site', CASE WHEN v_site.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_site.id,
      'brand_id', v_site.brand_id,
      'renderer_key', v_site.renderer_key,
      'renderer_version', v_site.renderer_version,
      'status', v_site.status,
      'active_publication_id', v_site.active_publication_id,
      'last_successful_publication_id', v_site.last_successful_publication_id,
      'provisioning_error_code', v_site.provisioning_error_code,
      'owner_offline_at', v_site.owner_offline_at,
      'created_at', v_site.created_at,
      'updated_at', v_site.updated_at,
      'brand_site_hosts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'hostname', host.hostname, 'status', host.status,
          'is_primary', host.is_primary, 'kind', host.kind, 'label', host.label
        ) ORDER BY host.is_primary DESC, host.created_at)
        FROM public.brand_site_hosts host WHERE host.site_id = v_site.id
          AND host.status <> 'retired'
      ), '[]'::jsonb)
    ) END
  );
END;
$$;

-- 9.4 Operation authorization: preview 20, publish and rollback 50.
CREATE OR REPLACE FUNCTION public.brand_site_authorize_operation(
  p_site_id uuid, p_operation_id uuid, p_kind text, p_arguments_digest text,
  p_expected_revision text, p_source_digest text
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
  v_latest_source text;
  v_generated_at timestamptz;
BEGIN
  SELECT * INTO STRICT v_site FROM public.brand_sites WHERE id = p_site_id FOR UPDATE;
  v_rank := public.biz_brand_effective_rank(v_site.brand_id, v_actor);
  -- #2829 — publish and rollback need brand admin (rank 50); a marketing
  -- manager (20) can preview and edit drafts but never change what is live.
  IF v_actor IS NULL OR v_rank < 20
    OR (p_kind IN ('publish','rollback') AND v_rank < 50)
    OR NOT public.brand_site_entitled(v_site.brand_id) THEN
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
      -- A NEW site's first publish still needs recorded recovery evidence.
      SELECT * INTO v_config
      FROM public.brand_site_service_config config
      WHERE config.config_key = 'sites_v1';
      SELECT receipt.evidence_source INTO v_latest_source
      FROM public.brand_site_readiness_receipts receipt
      WHERE receipt.evidence_kind IN ('nightly_backup','restore_drill')
      ORDER BY receipt.accepted_at DESC LIMIT 1;
      IF v_config.config_key IS NULL OR NOT (
        (COALESCE(v_config.backup_retention_days, 0) >= 7
          AND v_config.backup_entitlement_verified_at IS NOT NULL
          AND v_config.database_backup_verified_at IS NOT NULL
          AND v_config.database_backup_verified_at > clock_timestamp() - interval '26 hours'
          AND v_config.object_manifest_verified_at IS NOT NULL
          AND v_config.object_manifest_verified_at > clock_timestamp() - interval '26 hours'
          AND v_config.restore_drill_verified_at IS NOT NULL
          AND v_config.restore_drill_verified_at > clock_timestamp() - interval '100 days'
          AND v_config.restore_drill_evidence_digest IS NOT NULL)
        OR (v_config.environment = 'local' AND v_latest_source = 'local_synthetic')
      ) THEN
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

-- 9.5 Public resolution. No brand, operator, origin or hostname literal and
-- no recovery-evidence predicate: backups alert, they never take a site down.
DROP FUNCTION IF EXISTS public.brand_site_resolve_publication(text);
CREATE OR REPLACE FUNCTION public.brand_site_resolve_publication(p_hostname text)
RETURNS TABLE(
  site_id uuid, brand_id uuid, publication_id uuid, artifact_key text,
  artifact_digest text, artifact_schema_version integer, renderer_key text,
  renderer_version integer, hostname text, primary_hostname text,
  is_primary boolean, host_kind text, design_key text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT site.id, site.brand_id, publication.id, publication.artifact_key,
    publication.artifact_digest, publication.artifact_schema_version,
    publication.renderer_key, publication.renderer_version, host.hostname,
    COALESCE((
      SELECT primary_host.hostname FROM public.brand_site_hosts primary_host
      WHERE primary_host.site_id = site.id AND primary_host.is_primary
        AND primary_host.status = 'active'
      ORDER BY primary_host.created_at LIMIT 1
    ), host.hostname),
    host.is_primary AND host.status = 'active',
    host.kind, publication.design_key
  FROM public.brand_site_hosts host
  JOIN public.brand_sites site ON site.id = host.site_id
  JOIN public.brands brand ON brand.id = site.brand_id
  JOIN public.brand_site_entitlements entitlement
    ON entitlement.brand_id = site.brand_id AND entitlement.status = 'granted'
  JOIN public.brand_site_publications publication
    ON publication.id = site.active_publication_id
    AND publication.site_id = site.id
  WHERE host.hostname = lower(p_hostname)
    AND host.status IN ('active','detaching')
    -- #2829 — a soft-deleted brand's site goes dark at once.
    AND brand.deleted_at IS NULL
    AND site.status = 'published'
    AND site.owner_offline_at IS NULL
    AND publication.status = 'published'
    AND publication.artifact_key IS NOT NULL
    AND publication.artifact_digest IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.brand_site_resolve_publication(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_resolve_publication(text) TO service_role;

-- 9.6 Owner offline / online.
CREATE OR REPLACE FUNCTION public.brand_site_set_owner_offline(
  p_site_id uuid, p_offline boolean, p_operation_id uuid, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_site public.brand_sites%ROWTYPE;
  v_kind text := CASE WHEN p_offline THEN 'offline' ELSE 'online' END;
  v_digest text;
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_site_id IS NULL OR p_offline IS NULL OR p_operation_id IS NULL
    OR (p_reason IS NOT NULL AND length(p_reason) > 200) THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT * INTO v_site FROM public.brand_sites WHERE id = p_site_id FOR UPDATE;
  IF NOT FOUND OR v_actor IS NULL
    OR public.biz_brand_effective_rank(v_site.brand_id, v_actor) < 50 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  v_digest := encode(extensions.digest(concat_ws(E'\n',
    p_site_id::text, v_kind, COALESCE(p_reason, '-')), 'sha256'), 'hex');
  SELECT * INTO v_receipt FROM public.brand_site_operation_receipts
  WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.site_id <> p_site_id OR v_receipt.kind <> v_kind
      OR v_receipt.arguments_digest <> v_digest THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN v_receipt.result_summary;
  END IF;
  IF p_offline THEN
    UPDATE public.brand_sites SET owner_offline_at = clock_timestamp(),
      owner_offline_by = v_actor, owner_offline_reason = p_reason
    WHERE id = p_site_id AND owner_offline_at IS NULL;
  ELSE
    UPDATE public.brand_sites SET owner_offline_at = NULL,
      owner_offline_by = NULL, owner_offline_reason = NULL
    WHERE id = p_site_id;
  END IF;
  v_result := jsonb_build_object('site_id', p_site_id, 'status', 'succeeded',
    'offline', p_offline);
  INSERT INTO public.brand_site_operation_receipts(
    operation_id, site_id, brand_id, user_id, kind, arguments_digest,
    status, result_summary, started_at, completed_at
  ) VALUES (
    p_operation_id, p_site_id, v_site.brand_id, v_actor, v_kind, v_digest,
    'succeeded', v_result, now(), now()
  );
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action, resource_kind,
    resource_id, operation_id, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, v_actor, 'user',
    CASE WHEN p_offline THEN 'site.owner_offline' ELSE 'site.owner_online' END,
    'site', p_site_id::text, p_operation_id,
    jsonb_build_object('status', CASE WHEN p_offline THEN 'offline' ELSE 'online' END)
  );
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.brand_site_set_owner_offline(uuid, boolean, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_set_owner_offline(uuid, boolean, uuid, text) TO authenticated, service_role;

-- 9.7 Export ("Download everything").
CREATE OR REPLACE FUNCTION public.brand_site_request_export(
  p_site_id uuid, p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_site public.brand_sites%ROWTYPE;
  v_rank integer;
  v_digest text;
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_site_id IS NULL OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT * INTO v_site FROM public.brand_sites WHERE id = p_site_id;
  v_rank := COALESCE(public.biz_brand_effective_rank(v_site.brand_id, v_actor), 0);
  IF NOT FOUND OR v_actor IS NULL OR v_rank < 50 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF v_site.payload_tenant_id IS NULL THEN
    RAISE EXCEPTION 'sites_invalid_state';
  END IF;
  v_digest := encode(extensions.digest(concat_ws(E'\n', p_site_id::text, 'export'),
    'sha256'), 'hex');
  SELECT * INTO v_receipt FROM public.brand_site_operation_receipts
  WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.site_id <> p_site_id OR v_receipt.kind <> 'export'
      OR v_receipt.user_id <> v_actor THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN v_receipt.result_summary || jsonb_build_object(
      'brand_id', v_site.brand_id, 'user_id', v_actor, 'rank', v_rank);
  END IF;
  v_result := jsonb_build_object('site_id', p_site_id, 'status', 'authorized',
    'brand_id', v_site.brand_id, 'user_id', v_actor, 'rank', v_rank);
  INSERT INTO public.brand_site_operation_receipts(
    operation_id, site_id, brand_id, user_id, kind, arguments_digest,
    status, result_summary, started_at
  ) VALUES (
    p_operation_id, p_site_id, v_site.brand_id, v_actor, 'export', v_digest,
    'executing', v_result, now()
  );
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action, resource_kind,
    resource_id, operation_id, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, v_actor, 'user', 'site.export_requested',
    'site', p_site_id::text, p_operation_id,
    jsonb_build_object('status', 'executing')
  );
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.brand_site_request_export(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_request_export(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brand_site_complete_export(
  p_site_id uuid, p_operation_id uuid, p_download_url text,
  p_expires_at timestamptz, p_bytes bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO STRICT v_receipt FROM public.brand_site_operation_receipts
  WHERE operation_id = p_operation_id AND site_id = p_site_id AND kind = 'export'
  FOR UPDATE;
  IF v_receipt.status = 'succeeded' THEN RETURN v_receipt.result_summary; END IF;
  IF v_receipt.status NOT IN ('executing','ambiguous')
    OR p_download_url IS NULL OR length(p_download_url) > 2000
    OR p_download_url !~ '^https?://[^\s]+$'
    OR p_expires_at IS NULL
    OR p_expires_at > clock_timestamp() + interval '24 hours 5 minutes'
    OR p_bytes IS NULL OR p_bytes < 0 THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  v_result := jsonb_build_object('site_id', p_site_id, 'status', 'succeeded',
    'download_url', p_download_url, 'expires_at', p_expires_at, 'bytes', p_bytes);
  UPDATE public.brand_site_operation_receipts SET status = 'succeeded',
    result_summary = v_result, completed_at = clock_timestamp()
  WHERE operation_id = p_operation_id;
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_kind, action, resource_kind, resource_id,
    operation_id, metadata
  ) VALUES (
    p_site_id, v_receipt.brand_id, 'system', 'site.export_ready', 'site',
    p_site_id::text, p_operation_id, jsonb_build_object('status', 'succeeded')
  );
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.brand_site_complete_export(uuid, uuid, text, timestamptz, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_complete_export(uuid, uuid, text, timestamptz, bigint) TO service_role;

-- 9.8 Internal authorization (Studio and Ari): entitled, non-deleted brands.
CREATE OR REPLACE FUNCTION public.brand_site_internal_authorize(
  p_site_id uuid, p_user_id uuid, p_min_rank integer
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
  IF NOT public.brand_site_entitled(v_site.brand_id) THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  v_rank := public.biz_brand_effective_rank(v_site.brand_id, p_user_id);
  IF v_rank < p_min_rank THEN RAISE EXCEPTION 'sites_forbidden'; END IF;
  RETURN jsonb_build_object(
    'site_id', p_site_id, 'brand_id', v_site.brand_id,
    'user_id', p_user_id, 'rank', v_rank, 'authorized', true
  );
END;
$$;

-- 9.9 Admin list and detail: per-site entitlement, host and offline state;
-- recovery evidence is service-wide.
CREATE OR REPLACE FUNCTION public.brand_site_admin_list(
  p_search text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
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
      COALESCE(entitlement.status, 'none') AS entitlement_status,
      site.owner_offline_at,
      config.recovery_alert_state,
      CASE
        WHEN site.payload_tenant_id IS NULL THEN 'not_configured'
        WHEN site.status = 'error' THEN 'attention_needed'
        ELSE 'ready'
      END AS editor_health,
      CASE
        WHEN site.status = 'suspended' THEN 'suspended'
        WHEN COALESCE(entitlement.status, 'none') <> 'granted' THEN 'not_entitled'
        WHEN brand.deleted_at IS NOT NULL THEN 'brand_deleted'
        WHEN site.owner_offline_at IS NOT NULL THEN 'owner_offline'
        WHEN publication.id IS NOT NULL AND host.status = 'active' THEN 'verified'
        WHEN publication.id IS NOT NULL THEN 'last_good_ready'
        ELSE 'not_published'
      END AS public_health,
      NULL::integer AS media_backlog
    FROM public.brand_sites site
    JOIN public.brands brand ON brand.id = site.brand_id
    LEFT JOIN public.brand_site_entitlements entitlement
      ON entitlement.brand_id = site.brand_id
    LEFT JOIN LATERAL (
      SELECT h.hostname, h.status
      FROM public.brand_site_hosts h
      WHERE h.site_id = site.id AND h.is_primary AND h.status <> 'retired'
      ORDER BY h.created_at DESC LIMIT 1
    ) host ON true
    LEFT JOIN public.brand_site_publications publication
      ON publication.id = site.active_publication_id
    LEFT JOIN public.brand_site_service_config config
      ON config.config_key = 'sites_v1'
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
      'suspension_reason_code', site.suspension_reason_code,
      'owner_offline_at', site.owner_offline_at,
      'brand_deleted', brand.deleted_at IS NOT NULL,
      'entitlement_status', COALESCE(entitlement.status, 'none'),
      'entitlement_reason_code', entitlement.reason_code
    ),
    'hosts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'hostname', host.hostname, 'kind', host.kind, 'status', host.status,
        'is_primary', host.is_primary, 'activated_at', host.activated_at,
        'label', host.label, 'dns_state', host.dns_state,
        'tls_state', host.tls_state, 'last_checked_at', host.last_checked_at
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
        WHEN COALESCE(entitlement.status, 'none') <> 'granted' THEN 'not_entitled'
        WHEN brand.deleted_at IS NOT NULL THEN 'brand_deleted'
        WHEN site.owner_offline_at IS NOT NULL THEN 'owner_offline'
        WHEN site.active_publication_id IS NOT NULL THEN 'verified'
        ELSE 'not_published' END,
      'media', 'not_reported',
      'backup', COALESCE(config.recovery_alert_state, 'unknown')
    ),
    'readiness', jsonb_build_object(
      'recovery_alert_state', COALESCE(config.recovery_alert_state, 'unknown'),
      'recovery_alerted_at', config.recovery_alerted_at,
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
  LEFT JOIN public.brand_site_entitlements entitlement
    ON entitlement.brand_id = site.brand_id
  LEFT JOIN public.brand_site_service_config config
    ON config.config_key = 'sites_v1'
  WHERE site.id = p_site_id;

  IF v_result IS NULL THEN RAISE EXCEPTION 'sites_not_found'; END IF;
  RETURN v_result;
END;
$$;

-- 9.10 Admin site actions gain set_primary_host and release_host.
DROP FUNCTION IF EXISTS public.brand_site_admin_action(uuid, uuid, text, text, uuid);
CREATE OR REPLACE FUNCTION public.brand_site_admin_action(
  p_site_id uuid, p_operation_id uuid, p_action text, p_reason_code text,
  p_target_operation_id uuid DEFAULT NULL, p_hostname text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_kind text;
  v_status text;
  v_arguments_digest text;
  v_target_receipt public.brand_site_operation_receipts%ROWTYPE;
  v_target_publication public.brand_site_publications%ROWTYPE;
  v_target_status text;
  v_reconciled boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF p_action NOT IN ('reconcile','suspend','resume','revoke_editor_sessions',
      'set_primary_host','release_host')
    OR p_reason_code !~ '^[A-Z][A-Z0-9_]{2,63}$' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  IF (p_action = 'reconcile') <> (p_target_operation_id IS NOT NULL)
    OR (p_action IN ('set_primary_host','release_host')) <> (p_hostname IS NOT NULL) THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;

  SELECT * INTO STRICT v_site FROM public.brand_sites
  WHERE id = p_site_id FOR UPDATE;
  v_kind := CASE WHEN p_action = 'revoke_editor_sessions' THEN 'revoke_sessions'
    WHEN p_action = 'set_primary_host' THEN 'domain_set_primary'
    WHEN p_action = 'release_host' THEN 'domain_detach'
    ELSE p_action END;
  v_arguments_digest := encode(extensions.digest(
    p_site_id::text || ':' || p_action || ':' || p_reason_code || ':' ||
      COALESCE(p_target_operation_id::text, '-') || ':' || COALESCE(p_hostname, '-'),
    'sha256'
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
        'status', v_status, 'replayed', true,
        'target_operation_id', p_target_operation_id
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
    UPDATE public.brand_site_hosts SET status = 'active'
    WHERE site_id = p_site_id AND status = 'suspended';
  ELSIF p_action = 'revoke_editor_sessions' THEN
    UPDATE public.brand_site_editor_exchanges SET status = 'revoked', revoked_at = now()
    WHERE site_id = p_site_id AND status = 'issued';
  ELSIF p_action = 'set_primary_host' THEN
    IF NOT EXISTS (SELECT 1 FROM public.brand_site_hosts host
      WHERE host.site_id = p_site_id AND host.hostname = lower(p_hostname)
        AND host.status = 'active') THEN
      RAISE EXCEPTION 'sites_invalid_state';
    END IF;
    UPDATE public.brand_site_hosts SET is_primary = false
    WHERE site_id = p_site_id AND is_primary AND hostname <> lower(p_hostname);
    UPDATE public.brand_site_hosts SET is_primary = true
    WHERE site_id = p_site_id AND hostname = lower(p_hostname);
  ELSIF p_action = 'release_host' THEN
    -- The primary address is never released; move the primary first.
    UPDATE public.brand_site_hosts SET status = 'retired', retired_at = now()
    WHERE site_id = p_site_id AND hostname = lower(p_hostname)
      AND NOT is_primary AND status <> 'retired';
    IF NOT FOUND THEN RAISE EXCEPTION 'sites_invalid_state'; END IF;
  ELSIF p_action = 'reconcile' THEN
    SELECT * INTO STRICT v_target_receipt
    FROM public.brand_site_operation_receipts receipt
    WHERE receipt.site_id = p_site_id
      AND receipt.operation_id = p_target_operation_id
      AND receipt.status = 'ambiguous'
    FOR UPDATE;
    SELECT * INTO v_target_publication
    FROM public.brand_site_publications publication
    WHERE publication.site_id = p_site_id
      AND publication.operation_id = p_target_operation_id;

    IF v_target_receipt.kind = 'provision' AND v_site.payload_tenant_id IS NOT NULL THEN
      UPDATE public.brand_site_operation_receipts
      SET status = 'succeeded', error_code = NULL, completed_at = clock_timestamp(),
        result_summary = jsonb_build_object('site_id', p_site_id, 'status', 'succeeded')
      WHERE operation_id = p_target_operation_id;
      v_target_status := 'succeeded';
      v_reconciled := true;
    ELSIF v_target_publication.id IS NOT NULL
      AND v_target_publication.status = 'published' THEN
      UPDATE public.brand_site_operation_receipts
      SET status = 'succeeded', error_code = NULL, completed_at = clock_timestamp(),
        result_summary = jsonb_build_object(
          'site_id', p_site_id,
          'publication_id', v_target_publication.id,
          'artifact_digest', v_target_publication.artifact_digest,
          'status', 'succeeded'
        )
      WHERE operation_id = p_target_operation_id;
      v_target_status := 'succeeded';
      v_reconciled := true;
    ELSIF v_target_publication.id IS NOT NULL
      AND v_target_publication.status = 'failed' THEN
      UPDATE public.brand_site_operation_receipts
      SET status = 'failed',
        error_code = COALESCE(v_target_publication.failure_code,
          'PUBLISH_FAILED_LAST_GOOD_PRESERVED'),
        completed_at = clock_timestamp(),
        result_summary = jsonb_build_object(
          'site_id', p_site_id,
          'publication_id', v_target_publication.id,
          'status', 'failed',
          'last_good_preserved', v_site.last_successful_publication_id IS NOT NULL,
          'retryable', false
        )
      WHERE operation_id = p_target_operation_id;
      v_target_status := 'failed';
      v_reconciled := true;
    ELSE
      v_target_status := 'ambiguous';
    END IF;
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
      WHEN 'set_primary_host' THEN 'host.set_primary'
      WHEN 'release_host' THEN 'host.released'
      ELSE CASE WHEN v_reconciled
        THEN 'publication.reconciled'
        ELSE 'operation.reconcile_checked' END
    END,
    CASE WHEN p_action = 'reconcile' THEN 'operation'
      WHEN p_action IN ('set_primary_host','release_host') THEN 'host'
      ELSE 'brand_site' END,
    CASE WHEN p_action = 'reconcile' THEN p_target_operation_id::text
      WHEN p_action IN ('set_primary_host','release_host') THEN lower(p_hostname)
      ELSE p_site_id::text END,
    p_operation_id,
    jsonb_build_object(
      'reason_code', p_reason_code,
      'status', CASE WHEN p_action = 'reconcile' THEN v_target_status ELSE 'succeeded' END
    )
  );

  RETURN jsonb_build_object(
    'operation_id', p_operation_id, 'site_id', p_site_id,
    'status', 'succeeded', 'replayed', false,
    'target_operation_id', p_target_operation_id,
    'target_status', v_target_status
  );
END;
$$;
REVOKE ALL ON FUNCTION public.brand_site_admin_action(uuid, uuid, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_admin_action(uuid, uuid, text, text, uuid, text) TO authenticated, service_role;

-- 9.11 Recovery evidence. Shared by every site (one CMS project backs all of
-- them); checked against the service row, never against literals.
DROP FUNCTION IF EXISTS public.brand_site_record_readiness_evidence(uuid, uuid, text, jsonb);
CREATE OR REPLACE FUNCTION public.brand_site_record_readiness_evidence(
  p_site_id uuid, p_operation_id uuid, p_body_digest text, p_evidence jsonb,
  p_evidence_source text DEFAULT 'scheduled_job'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_config public.brand_site_service_config%ROWTYPE;
  v_site public.brand_sites%ROWTYPE;
  v_receipt public.brand_site_readiness_receipts%ROWTYPE;
  v_kind text;
  v_observed_at timestamptz;
  v_database_at timestamptz;
  v_manifest_at timestamptz;
  v_restore_at timestamptz;
  v_retention integer;
  v_object_count bigint;
  v_object_bytes bigint;
  v_tenant_count bigint;
  v_document_count bigint;
  v_accepted_at timestamptz := clock_timestamp();
  v_result jsonb;
BEGIN
  IF p_body_digest !~ '^[0-9a-f]{64}$'
    OR p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object'
    OR p_evidence->>'schema_version' <> '1'
    OR p_evidence_source IS NULL
    OR p_evidence_source NOT IN ('scheduled_job','local_synthetic') THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  v_kind := p_evidence->>'evidence_kind';
  IF v_kind NOT IN ('nightly_backup','restore_drill') THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;

  SELECT * INTO STRICT v_config
  FROM public.brand_site_service_config config
  WHERE config.config_key = 'sites_v1'
  FOR UPDATE;
  -- #2829 — synthetic evidence exists only so a developer's local stack can
  -- publish. A production row refuses it outright.
  IF p_evidence_source = 'local_synthetic' AND v_config.environment <> 'local' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT * INTO STRICT v_site
  FROM public.brand_sites site
  WHERE site.id = p_site_id
  FOR SHARE;

  SELECT * INTO v_receipt
  FROM public.brand_site_readiness_receipts receipt
  WHERE receipt.operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.site_id <> p_site_id
      OR v_receipt.brand_id <> v_site.brand_id
      OR v_receipt.evidence_kind <> v_kind
      OR v_receipt.body_digest <> p_body_digest THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN v_receipt.result_summary;
  END IF;

  IF (p_evidence->>'observed_at') !~
      '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  v_observed_at := (p_evidence->>'observed_at')::timestamptz;
  IF v_observed_at > v_accepted_at + interval '5 minutes' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;

  IF v_kind = 'nightly_backup' THEN
    IF NOT public.brand_site_json_keys_allowed(p_evidence, ARRAY[
      'schema_version','evidence_kind','observed_at','backup_retention_days',
      'database_backup_verified_at','object_manifest_verified_at',
      'manifest_digest','backup_bundle_digest','object_count','object_bytes'
    ])
      OR jsonb_typeof(p_evidence->'backup_retention_days') <> 'number'
      OR jsonb_typeof(p_evidence->'object_count') <> 'number'
      OR jsonb_typeof(p_evidence->'object_bytes') <> 'number'
      OR (p_evidence->>'backup_retention_days') !~ '^[0-9]+$'
      OR (p_evidence->>'object_count') !~ '^[0-9]+$'
      OR (p_evidence->>'object_bytes') !~ '^[0-9]+$'
      OR (p_evidence->>'database_backup_verified_at') !~
        '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$'
      OR (p_evidence->>'object_manifest_verified_at') !~
        '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$'
      OR (p_evidence->>'manifest_digest') !~ '^[0-9a-f]{64}$'
      OR (p_evidence->>'backup_bundle_digest') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'sites_validation_failed';
    END IF;
    v_retention := (p_evidence->>'backup_retention_days')::integer;
    v_object_count := (p_evidence->>'object_count')::bigint;
    v_object_bytes := (p_evidence->>'object_bytes')::bigint;
    v_database_at := (p_evidence->>'database_backup_verified_at')::timestamptz;
    v_manifest_at := (p_evidence->>'object_manifest_verified_at')::timestamptz;
    IF v_retention < 7
      OR v_object_count > 9007199254740991
      OR v_object_bytes > 9007199254740991
      OR v_database_at > v_observed_at OR v_manifest_at > v_observed_at
      OR v_database_at > v_accepted_at + interval '5 minutes'
      OR v_manifest_at > v_accepted_at + interval '5 minutes'
      OR v_database_at <= v_accepted_at - interval '26 hours'
      OR v_manifest_at <= v_accepted_at - interval '26 hours' THEN
      RAISE EXCEPTION 'sites_readiness_blocked';
    END IF;
    UPDATE public.brand_site_service_config SET
      backup_entitlement_verified_at = v_observed_at,
      backup_retention_days = v_retention,
      database_backup_verified_at = v_database_at,
      object_manifest_verified_at = v_manifest_at,
      backup_bundle_evidence_digest = p_evidence->>'backup_bundle_digest',
      object_manifest_evidence_digest = p_evidence->>'manifest_digest',
      recovery_alert_state = 'fresh',
      updated_at = v_accepted_at
    WHERE config_key = 'sites_v1';
  ELSE
    IF NOT public.brand_site_json_keys_allowed(p_evidence, ARRAY[
      'schema_version','evidence_kind','observed_at','restore_drill_verified_at',
      'restore_drill_evidence_digest','tenant_count','document_count',
      'object_count','object_bytes'
    ])
      OR jsonb_typeof(p_evidence->'tenant_count') <> 'number'
      OR jsonb_typeof(p_evidence->'document_count') <> 'number'
      OR jsonb_typeof(p_evidence->'object_count') <> 'number'
      OR jsonb_typeof(p_evidence->'object_bytes') <> 'number'
      OR (p_evidence->>'tenant_count') !~ '^[0-9]+$'
      OR (p_evidence->>'document_count') !~ '^[0-9]+$'
      OR (p_evidence->>'object_count') !~ '^[0-9]+$'
      OR (p_evidence->>'object_bytes') !~ '^[0-9]+$'
      OR (p_evidence->>'restore_drill_verified_at') !~
        '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$'
      OR (p_evidence->>'restore_drill_evidence_digest') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'sites_validation_failed';
    END IF;
    v_tenant_count := (p_evidence->>'tenant_count')::bigint;
    v_document_count := (p_evidence->>'document_count')::bigint;
    v_object_count := (p_evidence->>'object_count')::bigint;
    v_object_bytes := (p_evidence->>'object_bytes')::bigint;
    v_restore_at := (p_evidence->>'restore_drill_verified_at')::timestamptz;
    IF v_tenant_count < 1 OR v_document_count < 1
      OR v_tenant_count > 9007199254740991
      OR v_document_count > 9007199254740991
      OR v_object_count > 9007199254740991
      OR v_object_bytes > 9007199254740991
      OR v_restore_at > v_observed_at
      OR v_restore_at > v_accepted_at + interval '5 minutes'
      OR v_restore_at <= v_accepted_at - interval '100 days' THEN
      RAISE EXCEPTION 'sites_readiness_blocked';
    END IF;
    UPDATE public.brand_site_service_config SET
      restore_drill_verified_at = v_restore_at,
      restore_drill_evidence_digest =
        p_evidence->>'restore_drill_evidence_digest',
      updated_at = v_accepted_at
    WHERE config_key = 'sites_v1';
  END IF;

  SELECT jsonb_build_object(
    'site_id', p_site_id,
    'evidence_kind', v_kind,
    'accepted_at', v_accepted_at,
    'readiness', jsonb_build_object(
      'backup_retention_days', config.backup_retention_days,
      'database_backup_verified_at', config.database_backup_verified_at,
      'object_manifest_verified_at', config.object_manifest_verified_at,
      'restore_drill_verified_at', config.restore_drill_verified_at,
      'restore_drill_evidence_digest', config.restore_drill_evidence_digest
    )
  ) INTO v_result
  FROM public.brand_site_service_config config
  WHERE config.config_key = 'sites_v1';

  INSERT INTO public.brand_site_readiness_receipts(
    operation_id, site_id, brand_id, evidence_kind, body_digest,
    evidence_payload, result_summary, accepted_at, evidence_source
  ) VALUES (
    p_operation_id, p_site_id, v_site.brand_id, v_kind, p_body_digest,
    p_evidence, v_result, v_accepted_at, p_evidence_source
  );
  RETURN v_result;
EXCEPTION
  WHEN numeric_value_out_of_range OR invalid_text_representation OR datetime_field_overflow THEN
    RAISE EXCEPTION 'sites_validation_failed';
END;
$$;
REVOKE ALL ON FUNCTION public.brand_site_record_readiness_evidence(uuid, uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_record_readiness_evidence(uuid, uuid, text, jsonb, text) TO service_role;

CREATE OR REPLACE FUNCTION public.brand_site_record_host_readiness(
  p_site_id uuid, p_operation_id uuid, p_observed_at timestamptz,
  p_hostname text, p_publication_id uuid, p_artifact_digest text,
  p_tls_evidence_digest text, p_probe_evidence_digest text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_publication public.brand_site_publications%ROWTYPE;
  v_receipt public.brand_site_readiness_receipts%ROWTYPE;
  v_digest text;
  v_result jsonb;
  v_accepted_at timestamptz := clock_timestamp();
BEGIN
  IF p_hostname IS NULL
    OR p_artifact_digest !~ '^[0-9a-f]{64}$'
    OR p_tls_evidence_digest !~ '^[0-9a-f]{64}$'
    OR p_probe_evidence_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'sites_readiness_blocked';
  END IF;
  PERFORM 1 FROM public.brand_site_service_config config
  WHERE config.config_key = 'sites_v1' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sites_readiness_blocked'; END IF;
  SELECT * INTO STRICT v_site
  FROM public.brand_sites site
  WHERE site.id = p_site_id
  FOR SHARE;
  v_digest := encode(extensions.digest(concat_ws(E'\n',
    p_site_id::text, p_observed_at::text, p_hostname, p_publication_id::text,
    p_artifact_digest, p_tls_evidence_digest, p_probe_evidence_digest
  ), 'sha256'), 'hex');
  SELECT * INTO v_receipt FROM public.brand_site_readiness_receipts receipt
  WHERE receipt.operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.site_id <> p_site_id OR v_receipt.evidence_kind <> 'host_probe'
      OR v_receipt.body_digest <> v_digest THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN v_receipt.result_summary;
  END IF;
  IF p_observed_at > v_accepted_at + interval '5 minutes'
    OR p_observed_at <= v_accepted_at - interval '15 minutes' THEN
    RAISE EXCEPTION 'sites_readiness_blocked';
  END IF;
  SELECT * INTO STRICT v_publication
  FROM public.brand_site_publications publication
  WHERE publication.id = p_publication_id
    AND publication.site_id = p_site_id
    AND publication.status = 'published'
    AND publication.artifact_digest = p_artifact_digest;
  IF v_site.status <> 'published'
    OR v_site.active_publication_id <> p_publication_id
    OR v_site.last_successful_publication_id <> p_publication_id
    -- #2829 — the probed host must be this site's own primary address.
    OR NOT EXISTS (
      SELECT 1 FROM public.brand_site_hosts host
      WHERE host.site_id = p_site_id
        AND host.hostname = lower(p_hostname)
        AND host.is_primary
        AND host.status IN ('pending','active')
    )
    OR COALESCE((v_publication.probe_summary->>'http_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'digest_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'renderer_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'schema_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'canonical_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'assets_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'accessibility_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'consent_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'cta_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'leak_check_ok')::boolean, false) IS NOT TRUE
    OR COALESCE((v_publication.probe_summary->>'status_code')::integer, 0) <> 200
    OR v_publication.probe_summary->>'observed_digest' <> p_artifact_digest THEN
    RAISE EXCEPTION 'sites_readiness_blocked';
  END IF;

  UPDATE public.brand_site_service_config SET
    host_readiness_verified_at = p_observed_at,
    host_readiness_hostname = lower(p_hostname),
    tls_evidence_digest = p_tls_evidence_digest,
    public_probe_evidence_digest = p_probe_evidence_digest,
    public_probe_publication_id = p_publication_id,
    public_probe_artifact_digest = p_artifact_digest,
    updated_at = v_accepted_at
  WHERE config_key = 'sites_v1';
  v_result := jsonb_build_object(
    'site_id', p_site_id, 'hostname', lower(p_hostname),
    'publication_id', p_publication_id, 'status', 'verified',
    'accepted_at', v_accepted_at
  );
  INSERT INTO public.brand_site_readiness_receipts(
    operation_id, site_id, brand_id, evidence_kind, body_digest,
    evidence_payload, result_summary, accepted_at
  ) VALUES (
    p_operation_id, p_site_id, v_site.brand_id, 'host_probe', v_digest,
    jsonb_build_object(
      'observed_at', p_observed_at, 'hostname', lower(p_hostname),
      'publication_id', p_publication_id, 'artifact_digest', p_artifact_digest,
      'tls_evidence_digest', p_tls_evidence_digest,
      'probe_evidence_digest', p_probe_evidence_digest
    ), v_result, v_accepted_at
  );
  RETURN v_result;
END;
$$;

-- Public reachability names the site's own primary host, whatever its kind.
CREATE OR REPLACE FUNCTION public.brand_site_record_public_reachability(
  p_site_id uuid, p_operation_id uuid, p_publication_id uuid,
  p_observed_at timestamptz, p_status_code integer, p_observed_digest text,
  p_reachable boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_site public.brand_sites%ROWTYPE;
  v_publication public.brand_site_publications%ROWTYPE;
  v_receipt public.brand_site_readiness_receipts%ROWTYPE;
  v_hostname text;
  v_digest_ok boolean;
  v_body_digest text;
  v_annotated boolean := false;
  v_result jsonb;
  v_accepted_at timestamptz := clock_timestamp();
BEGIN
  IF p_site_id IS NULL OR p_operation_id IS NULL OR p_publication_id IS NULL
    OR p_observed_at IS NULL OR p_reachable IS NULL
    OR (p_status_code IS NOT NULL
      AND (p_status_code < 100 OR p_status_code > 599))
    OR (p_observed_digest IS NOT NULL
      AND p_observed_digest !~ '^[0-9a-f]{64}$')
    OR p_observed_at > v_accepted_at + interval '5 minutes'
    OR p_observed_at <= v_accepted_at - interval '60 minutes' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;

  v_body_digest := encode(extensions.digest(concat_ws(E'\n',
    p_site_id::text, p_publication_id::text, p_observed_at::text,
    COALESCE(p_status_code::text, '-'), COALESCE(p_observed_digest, '-'),
    p_reachable::text
  ), 'sha256'), 'hex');

  SELECT * INTO v_receipt FROM public.brand_site_readiness_receipts receipt
  WHERE receipt.operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.site_id IS DISTINCT FROM p_site_id
      OR v_receipt.evidence_kind <> 'public_check'
      OR v_receipt.body_digest <> v_body_digest THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN v_receipt.result_summary;
  END IF;

  SELECT * INTO STRICT v_site FROM public.brand_sites site
  WHERE site.id = p_site_id FOR SHARE;
  SELECT * INTO STRICT v_publication
  FROM public.brand_site_publications publication
  WHERE publication.id = p_publication_id AND publication.site_id = p_site_id
  FOR UPDATE;

  SELECT host.hostname INTO v_hostname
  FROM public.brand_site_hosts host
  WHERE host.site_id = p_site_id AND host.is_primary
    AND host.retired_at IS NULL AND host.status <> 'retired'
  ORDER BY host.created_at LIMIT 1;

  v_digest_ok := p_observed_digest IS NOT NULL
    AND v_publication.artifact_digest IS NOT NULL
    AND p_observed_digest = v_publication.artifact_digest;

  UPDATE public.brand_site_publications SET
    public_checked_at = p_observed_at,
    public_status_code = p_status_code,
    public_reachable = p_reachable
  WHERE id = p_publication_id;

  UPDATE public.brand_site_operation_receipts SET
    result_summary = COALESCE(result_summary, '{}'::jsonb) || jsonb_build_object(
      'public_reachable', p_reachable,
      'public_status_code', p_status_code,
      'public_checked_at', p_observed_at
    )
  WHERE operation_id = p_operation_id AND site_id = p_site_id
    AND kind = 'publish' AND status = 'succeeded'
    AND NOT (COALESCE(result_summary, '{}'::jsonb) ? 'public_reachable');
  v_annotated := FOUND;

  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action, resource_kind,
    resource_id, operation_id, after_digest, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, auth.uid(),
    CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
    'publication.public_check', 'publication', p_publication_id::text,
    p_operation_id, v_publication.artifact_digest,
    jsonb_build_object(
      'hostname', v_hostname,
      'publication_id', p_publication_id,
      'status_code', p_status_code,
      'reachable', p_reachable,
      'digest_ok', v_digest_ok
    )
  );

  v_result := jsonb_build_object(
    'site_id', p_site_id,
    'publication_id', p_publication_id,
    'hostname', v_hostname,
    'checked_at', p_observed_at,
    'status_code', p_status_code,
    'reachable', p_reachable,
    'digest_ok', v_digest_ok,
    'operation_annotated', v_annotated,
    'live_pointer_changed', false
  );

  INSERT INTO public.brand_site_readiness_receipts(
    operation_id, site_id, brand_id, evidence_kind, body_digest,
    evidence_payload, result_summary, accepted_at
  ) VALUES (
    p_operation_id, p_site_id, v_site.brand_id, 'public_check', v_body_digest,
    jsonb_build_object(
      'observed_at', p_observed_at,
      'hostname', v_hostname,
      'publication_id', p_publication_id,
      'status_code', p_status_code,
      'observed_digest', p_observed_digest,
      'reachable', p_reachable
    ), v_result, v_accepted_at
  );
  RETURN v_result;
END;
$$;

-- Retention protection for any site (was: the pilot site only).
CREATE OR REPLACE FUNCTION public.brand_site_retention_protection(p_site_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH bound_site AS (
    SELECT site.id, site.brand_id, site.active_publication_id,
      site.last_successful_publication_id
    FROM public.brand_sites site
    WHERE site.id = p_site_id
  ), ranked AS (
    SELECT publication.id, publication.artifact_key, publication.requested_at,
      publication.rollback_source_publication_id,
      row_number() OVER (ORDER BY publication.requested_at DESC) AS newest_rank
    FROM public.brand_site_publications publication
    JOIN bound_site site ON site.id = publication.site_id
    WHERE publication.artifact_key IS NOT NULL
  ), protected AS (
    SELECT DISTINCT row.artifact_key, row.requested_at
    FROM ranked row CROSS JOIN bound_site site
    WHERE row.newest_rank <= 50
      OR row.requested_at >= clock_timestamp() - interval '90 days'
      OR row.id IN (site.active_publication_id, site.last_successful_publication_id)
      OR EXISTS (
        SELECT 1 FROM ranked reference
        WHERE reference.rollback_source_publication_id = row.id
      )
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM bound_site) THEN
    jsonb_build_object('protected_artifact_keys', COALESCE((
      SELECT jsonb_agg(artifact_key ORDER BY requested_at DESC) FROM protected
    ), '[]'::jsonb))
  ELSE NULL END;
$$;

-- 9.12 Recovery alert state. Records and alerts; never touches availability.
-- invariant: I-PROPOSED-2829-02 (DRAFT) — enforced by
-- supabase/migrations/__tests__/issue_2829_sites_multi_brand.test.sql.
CREATE OR REPLACE FUNCTION public.brand_site_record_recovery_state(
  p_state text, p_observed_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_accepted_at timestamptz := clock_timestamp();
  v_previous text;
  v_result jsonb;
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('fresh','late','stale')
    OR p_observed_at IS NULL
    OR p_observed_at > v_accepted_at + interval '5 minutes'
    OR p_observed_at <= v_accepted_at - interval '7 days' THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT config.recovery_alert_state INTO v_previous
  FROM public.brand_site_service_config config
  WHERE config.config_key = 'sites_v1' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sites_service_unconfigured'; END IF;
  UPDATE public.brand_site_service_config SET
    recovery_alert_state = p_state,
    recovery_alerted_at = CASE WHEN p_state IN ('late','stale')
      THEN v_accepted_at ELSE recovery_alerted_at END,
    updated_at = v_accepted_at
  WHERE config_key = 'sites_v1';
  v_result := jsonb_build_object('state', p_state, 'previous_state', v_previous,
    'observed_at', p_observed_at, 'accepted_at', v_accepted_at,
    'sites_affected', 0);
  INSERT INTO public.brand_site_readiness_receipts(
    operation_id, site_id, brand_id, evidence_kind, body_digest,
    evidence_payload, result_summary, accepted_at
  ) VALUES (
    gen_random_uuid(), NULL, NULL, 'recovery_alert',
    encode(extensions.digest(concat_ws(E'\n', p_state, p_observed_at::text,
      v_accepted_at::text), 'sha256'), 'hex'),
    jsonb_build_object('state', p_state, 'observed_at', p_observed_at),
    v_result, v_accepted_at
  );
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.brand_site_record_recovery_state(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_record_recovery_state(text, timestamptz) TO service_role;

-- 9.13 Service configuration. The environment is insert-only (W0 trigger);
-- this updates the CMS origin and host suffix of the existing row only.
CREATE OR REPLACE FUNCTION public.brand_site_configure_service(
  p_cms_origin text, p_public_host_suffix text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_config public.brand_site_service_config%ROWTYPE;
BEGIN
  UPDATE public.brand_site_service_config SET
    cms_origin = p_cms_origin,
    public_host_suffix = p_public_host_suffix,
    updated_at = clock_timestamp()
  WHERE config_key = 'sites_v1'
  RETURNING * INTO v_config;
  IF NOT FOUND THEN RAISE EXCEPTION 'sites_service_unconfigured'; END IF;
  RETURN jsonb_build_object('environment', v_config.environment,
    'cms_origin', v_config.cms_origin,
    'public_host_suffix', v_config.public_host_suffix);
END;
$$;
REVOKE ALL ON FUNCTION public.brand_site_configure_service(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_configure_service(text, text) TO service_role;

-- 9.14 Mingla admin: grant, revoke, reserve. Reason required, audited.
CREATE OR REPLACE FUNCTION public.brand_site_admin_grant(
  p_brand_id uuid, p_reason_code text, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_site_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF p_reason_code IS NULL OR p_reason_code NOT IN
      ('pilot','rollout','support','abuse','owner_request','other')
    OR (p_note IS NOT NULL AND length(p_note) > 500)
    OR NOT EXISTS (SELECT 1 FROM public.brands brand
      WHERE brand.id = p_brand_id AND brand.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  INSERT INTO public.brand_site_entitlements(
    brand_id, status, source, granted_by, granted_at, reason_code, note
  ) VALUES (
    p_brand_id, 'granted', 'admin', v_actor, clock_timestamp(), p_reason_code, p_note
  )
  ON CONFLICT (brand_id) DO UPDATE SET
    status = 'granted', source = 'admin', granted_by = v_actor,
    granted_at = clock_timestamp(), revoked_by = NULL, revoked_at = NULL,
    reason_code = EXCLUDED.reason_code, note = EXCLUDED.note;
  SELECT site.id INTO v_site_id FROM public.brand_sites site WHERE site.brand_id = p_brand_id;
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action, resource_kind,
    resource_id, metadata
  ) VALUES (
    v_site_id, p_brand_id, v_actor, 'admin', 'entitlement.granted',
    'entitlement', p_brand_id::text,
    jsonb_build_object('reason_code', p_reason_code, 'status', 'granted')
  );
  RETURN jsonb_build_object('brand_id', p_brand_id, 'status', 'granted');
END;
$$;
REVOKE ALL ON FUNCTION public.brand_site_admin_grant(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_admin_grant(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brand_site_admin_revoke(
  p_brand_id uuid, p_reason_code text, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_site_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF p_reason_code IS NULL OR p_reason_code NOT IN
      ('pilot','rollout','support','abuse','owner_request','other')
    OR (p_note IS NOT NULL AND length(p_note) > 500) THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  -- Drafts and publications are kept; the site simply stops resolving.
  UPDATE public.brand_site_entitlements SET status = 'revoked',
    revoked_by = v_actor, revoked_at = clock_timestamp(),
    reason_code = p_reason_code, note = p_note
  WHERE brand_id = p_brand_id AND status = 'granted';
  IF NOT FOUND THEN RAISE EXCEPTION 'sites_invalid_state'; END IF;
  SELECT site.id INTO v_site_id FROM public.brand_sites site WHERE site.brand_id = p_brand_id;
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action, resource_kind,
    resource_id, metadata
  ) VALUES (
    v_site_id, p_brand_id, v_actor, 'admin', 'entitlement.revoked',
    'entitlement', p_brand_id::text,
    jsonb_build_object('reason_code', p_reason_code, 'status', 'revoked')
  );
  RETURN jsonb_build_object('brand_id', p_brand_id, 'status', 'revoked');
END;
$$;
REVOKE ALL ON FUNCTION public.brand_site_admin_revoke(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_admin_revoke(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brand_site_admin_reserve_label(
  p_label text, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('brand_protection','profanity')
    OR p_label IS NULL OR public.brand_site_subdomain_label(p_label) <> p_label THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  INSERT INTO public.brand_site_reserved_labels(label, reason)
  VALUES (p_label, p_reason)
  ON CONFLICT (label) DO NOTHING;
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action, resource_kind,
    resource_id, metadata
  ) VALUES (
    NULL, NULL, v_actor, 'admin', 'label.reserved', 'label', p_label,
    jsonb_build_object('label', p_label, 'reason_code', upper(p_reason))
  );
  RETURN jsonb_build_object('label', p_label, 'reason', p_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.brand_site_admin_reserve_label(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_admin_reserve_label(text, text) TO authenticated, service_role;

-- Admin view of which brands may have a site (searchable).
CREATE OR REPLACE FUNCTION public.brand_site_admin_entitlements(
  p_search text DEFAULT NULL, p_limit integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_search text := NULLIF(trim(COALESCE(p_search, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.brand_name)
    FROM (
      SELECT brand.id AS brand_id, brand.name AS brand_name, brand.slug AS brand_slug,
        COALESCE(entitlement.status, 'none') AS entitlement_status,
        entitlement.reason_code, entitlement.granted_at, entitlement.revoked_at,
        site.id AS site_id
      FROM public.brands brand
      LEFT JOIN public.brand_site_entitlements entitlement ON entitlement.brand_id = brand.id
      LEFT JOIN public.brand_sites site ON site.brand_id = brand.id
      WHERE brand.deleted_at IS NULL
        AND (v_search IS NULL
          OR brand.name ILIKE '%' || replace(replace(v_search, '%', '\%'), '_', '\_') || '%' ESCAPE '\'
          OR brand.slug ILIKE '%' || replace(replace(v_search, '%', '\%'), '_', '\_') || '%' ESCAPE '\'
          OR brand.id::text = v_search)
      ORDER BY brand.name
      LIMIT v_limit
    ) row_value
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.brand_site_admin_entitlements(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_admin_entitlements(text, integer) TO authenticated, service_role;

-- 9.15 #3652 — spending an attribution touch binds BOTH ends: the order must
-- belong to the touch's brand and to the site's own orderable venue, and must
-- have been placed after the touch was issued. One consume per token.
CREATE OR REPLACE FUNCTION public.brand_site_consume_attribution(
  p_token_digest text, p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_touch public.brand_site_attribution_touches%ROWTYPE;
  v_order record;
BEGIN
  SELECT * INTO STRICT v_touch FROM public.brand_site_attribution_touches
    WHERE token_digest = p_token_digest FOR UPDATE;
  IF v_touch.expires_at <= clock_timestamp() OR v_touch.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'sites_attribution_forbidden';
  END IF;
  SELECT venue_order.id, venue_order.brand_id, venue_order.venue_id,
    venue_order.created_at
  INTO v_order
  FROM public.venue_orders venue_order
  WHERE venue_order.id = p_order_id;
  IF NOT FOUND
    OR v_order.brand_id IS DISTINCT FROM v_touch.brand_id
    OR v_order.venue_id IS DISTINCT FROM public.brand_site_orderable_venue(v_touch.site_id)
    OR v_order.created_at < v_touch.issued_at THEN
    RAISE EXCEPTION 'sites_attribution_forbidden';
  END IF;
  UPDATE public.brand_site_attribution_touches
    SET consumed_at = clock_timestamp(), order_id = p_order_id
    WHERE id = v_touch.id AND consumed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'sites_attribution_forbidden'; END IF;
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_kind, action, resource_kind, resource_id, metadata
  ) VALUES (
    v_touch.site_id, v_touch.brand_id, 'system', 'attribution.consumed',
    'attribution_touch', v_touch.id::text, '{}'::jsonb
  );
  RETURN jsonb_build_object('accepted', true, 'touch_id', v_touch.id);
END;
$$;
REVOKE ALL ON FUNCTION public.brand_site_consume_attribution(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_consume_attribution(text, uuid) TO service_role;

-- 9.16 Which site a host belongs to, whether or not anything is published.
-- The runtime uses it to bind a PREVIEW to the host it is shown on.
CREATE OR REPLACE FUNCTION public.brand_site_resolve_host(p_hostname text)
RETURNS TABLE(site_id uuid, brand_id uuid, hostname text, primary_hostname text,
  is_primary boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT site.id, site.brand_id, host.hostname,
    COALESCE((
      SELECT primary_host.hostname FROM public.brand_site_hosts primary_host
      WHERE primary_host.site_id = site.id AND primary_host.is_primary
        AND primary_host.status = 'active'
      ORDER BY primary_host.created_at LIMIT 1
    ), host.hostname),
    host.is_primary AND host.status = 'active'
  FROM public.brand_site_hosts host
  JOIN public.brand_sites site ON site.id = host.site_id
  JOIN public.brands brand ON brand.id = site.brand_id
  JOIN public.brand_site_entitlements entitlement
    ON entitlement.brand_id = site.brand_id AND entitlement.status = 'granted'
  WHERE host.hostname = lower(p_hostname)
    AND host.status IN ('active','detaching')
    AND brand.deleted_at IS NULL
    AND site.status <> 'suspended';
$$;
REVOKE ALL ON FUNCTION public.brand_site_resolve_host(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_resolve_host(text) TO service_role;

-- 9.17 The Studio session learns the site's live address (for "View live
-- site" and the computed canonical) and needs a granted entitlement.
CREATE OR REPLACE FUNCTION public.brand_site_consume_editor_exchange(
  p_code text, p_destination text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_digest text := encode(extensions.digest(p_code, 'sha256'), 'hex');
  v_exchange public.brand_site_editor_exchanges%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_exchange FROM public.brand_site_editor_exchanges
    WHERE code_digest = v_digest FOR UPDATE;
  IF v_exchange.status <> 'issued' OR v_exchange.expires_at <= clock_timestamp()
     OR v_exchange.destination <> p_destination
     OR public.biz_brand_effective_rank(v_exchange.brand_id, v_exchange.user_id) < 20
     OR NOT public.brand_site_entitled(v_exchange.brand_id) THEN
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
    'primary_hostname', (
      SELECT host.hostname FROM public.brand_site_hosts host
      WHERE host.site_id = v_exchange.site_id AND host.is_primary
        AND host.status IN ('pending','active')
      ORDER BY host.created_at LIMIT 1
    ),
    'absolute_expires_at', clock_timestamp() + interval '8 hours',
    'idle_expires_at', clock_timestamp() + interval '30 minutes'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.brand_site_consume_editor_exchange(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_consume_editor_exchange(text, text) TO service_role;

-- ── 10. Advertisable live sites: offline and revoked sites are not live ────
CREATE OR REPLACE VIEW public.ad_public_site_destinations_view AS
SELECT
  site.id,
  site.brand_id,
  b.slug AS brand_slug,
  b.name AS brand_name,
  host.hostname
FROM public.brand_sites site
JOIN public.brands b ON b.id = site.brand_id
JOIN public.brand_site_hosts host
  ON host.site_id = site.id
 AND host.is_primary IS TRUE
 AND host.status = 'active'
JOIN public.brand_site_publications pub
  ON pub.id = site.active_publication_id
WHERE b.deleted_at IS NULL
  AND site.status = 'published'
  AND site.owner_offline_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.brand_site_entitlements entitlement
    WHERE entitlement.brand_id = site.brand_id AND entitlement.status = 'granted'
  )
  AND coalesce(pub.public_reachable, false) IS TRUE;
ALTER VIEW public.ad_public_site_destinations_view SET (security_invoker = false);
REVOKE ALL ON public.ad_public_site_destinations_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ad_public_site_destinations_view TO authenticated, service_role;

-- ── 11. Grants on the replaced functions (restated like the originals) ─────
REVOKE ALL ON FUNCTION public.brand_site_complete_provision(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_complete_provision(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_business_availability(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_business_availability(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.brand_site_authorize_operation(uuid, uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_authorize_operation(uuid, uuid, text, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.brand_site_internal_authorize(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_internal_authorize(uuid, uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_admin_list(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_admin_list(text, integer, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.brand_site_admin_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_admin_detail(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.brand_site_record_host_readiness(uuid, uuid, timestamptz, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_record_host_readiness(uuid, uuid, timestamptz, text, uuid, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_record_public_reachability(uuid, uuid, uuid, timestamptz, integer, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_record_public_reachability(uuid, uuid, uuid, timestamptz, integer, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_retention_protection(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_retention_protection(uuid) TO service_role;

COMMENT ON TABLE public.brand_site_entitlements IS
  '#2829 Which brands may have a Mingla Site. Written only by Mingla admins through brand_site_admin_grant / brand_site_admin_revoke (and the one-time pilot move).';
COMMENT ON TABLE public.brand_site_reserved_labels IS
  '#2829 Subdomain labels no brand may take. System words are seeded; admins add brand-protection and profanity rows through brand_site_admin_reserve_label.';

COMMIT;
