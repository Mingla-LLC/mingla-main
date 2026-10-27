-- #2829 W8 (AD-10, Phase 2) — a brand's own domain on its Mingla website.
--
-- The hosts table already knows two kinds (mingla_subdomain, custom_domain)
-- and the custom-domain columns (W1). This migration adds what the domain
-- flow needs and the five functions the brand-site-domains edge function
-- calls:
--   * brand_site_domain_attach        (rank 50) a new custom host, 'pending'
--   * brand_site_domain_record_check  (service) one check's facts -> state
--   * brand_site_domain_set_primary   (rank 50) only an active host
--   * brand_site_domain_detach        (rank 50) primary moves FIRST, then the
--                                     host redirects for 30 days
--   * brand_site_domain_release       (service) the host is retired
-- plus a brand-scoped list (rank 20, read only below 50), the sweep list,
-- the probe resolver the runtime's /.well-known/mingla-site route uses, and
-- the pg_cron job that runs the sweep every 6 hours.
--
-- #4111 compatibility (amendment A4): brand_site_hosts.hostname and the
-- meaning of status = 'active' are unchanged.
--
-- Drift policy (spec W8): an active host whose check fails twice in a row is
-- 'misconfigured' (owner and Mingla admins are notified); misconfigured for 7
-- days while it is the main address -> the Mingla subdomain becomes the main
-- address again automatically and the owner is told. A certificate expiring
-- within 14 days alerts admins. The email (MX) records seen at the first check
-- are remembered; if they later disappear the owner is warned (Mingla never
-- asks anyone to change MX, TXT/SPF or NS records).
--
-- Forward-only.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ── 1. Hosts: the columns the domain flow keeps ────────────────────────────
CREATE OR REPLACE FUNCTION public.brand_site_valid_dns_records(p_records jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_records IS NULL OR (
    jsonb_typeof(p_records) = 'array'
    AND jsonb_array_length(p_records) <= 6
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_records) AS record
      WHERE jsonb_typeof(record) <> 'object'
        OR NOT public.brand_site_json_keys_allowed(record, ARRAY['type','name','value'])
        OR NOT (record->>'type' = ANY (ARRAY['A','AAAA','CNAME','TXT']))
        OR length(COALESCE(record->>'name', '')) NOT BETWEEN 1 AND 253
        OR length(COALESCE(record->>'value', '')) NOT BETWEEN 1 AND 512
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.brand_site_valid_dns_records(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_valid_dns_records(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.brand_site_valid_name_list(p_names jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_names IS NULL OR (
    jsonb_typeof(p_names) = 'array'
    AND jsonb_array_length(p_names) <= 20
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_names) AS name
      WHERE jsonb_typeof(name) <> 'string'
        OR length(name #>> '{}') NOT BETWEEN 1 AND 253
        OR (name #>> '{}') !~ '^[a-z0-9._-]+$'
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.brand_site_valid_name_list(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_valid_name_list(jsonb) TO service_role;

ALTER TABLE public.brand_site_hosts
  ADD COLUMN misconfigured_checks integer NOT NULL DEFAULT 0
    CHECK (misconfigured_checks BETWEEN 0 AND 100000),
  ADD COLUMN dns_records jsonb
    CHECK (public.brand_site_valid_dns_records(dns_records)),
  ADD COLUMN registrar text
    CHECK (registrar IS NULL OR registrar IN (
      'cloudflare','godaddy','squarespace','wix','ionos','namecheap','unknown'
    )),
  ADD COLUMN mx_at_attach jsonb
    CHECK (public.brand_site_valid_name_list(mx_at_attach)),
  ADD COLUMN mx_missing_since timestamptz,
  ADD COLUMN tls_expires_at timestamptz,
  ADD CONSTRAINT brand_site_hosts_custom_only_ck CHECK (
    kind = 'custom_domain' OR (
      dns_records IS NULL AND mx_at_attach IS NULL AND redirect_until IS NULL
    )
  ),
  ADD CONSTRAINT brand_site_hosts_detaching_window_ck CHECK (
    status <> 'detaching' OR (redirect_until IS NOT NULL AND NOT is_primary)
  );

-- A released (retired) address can be attached again later, by this brand or
-- another one; every address that is not retired belongs to exactly one site.
DROP INDEX IF EXISTS public.brand_site_hosts_hostname_uidx;
CREATE UNIQUE INDEX brand_site_hosts_hostname_uidx
  ON public.brand_site_hosts(hostname)
  WHERE status <> 'retired';
CREATE INDEX IF NOT EXISTS brand_site_hosts_custom_sweep_idx
  ON public.brand_site_hosts(last_checked_at NULLS FIRST)
  WHERE kind = 'custom_domain' AND status IN ('pending','verifying','active','detaching');

-- ── 2. Receipt and audit vocabularies ──────────────────────────────────────
ALTER TABLE public.brand_site_operation_receipts
  DROP CONSTRAINT brand_site_receipts_result_ck;
ALTER TABLE public.brand_site_operation_receipts
  ADD CONSTRAINT brand_site_receipts_result_ck CHECK (
    public.brand_site_json_keys_allowed(
      result_summary,
      ARRAY['site_id','publication_id','status','destination','expires_at',
        'revision_id','artifact_digest','last_good_preserved','retryable',
        'brand_id','user_id','rank','generated_at',
        'rollback_source_publication_id','public_reachable',
        'public_status_code','public_checked_at',
        'offline','download_url','bytes','reason_code',
        'font_warnings','artifact_schema_version','design_key',
        'host_id','hostname','release_now']
    )
  );

ALTER TABLE public.brand_site_audit_log
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
    'host.set_primary','host.released',
    'domain.attached','domain.verifying','domain.activated',
    'domain.misconfigured','domain.recovered','domain.primary_fallback',
    'domain.detach_requested','domain.released','domain.mx_missing',
    'domain.tls_expiring'
  )),
  ADD CONSTRAINT brand_site_audit_metadata_ck CHECK (
    public.brand_site_json_keys_allowed(
      metadata,
      ARRAY['status','safe_error_code','renderer_version','schema_version',
        'destination','reason_code','last_good_preserved','hostname',
        'publication_id','status_code','reachable','digest_ok','label',
        'dns_state','tls_state','registrar','host_kind']
    )
  );

-- ── 3. Notifications (rendered by the generic title/body template) ─────────
INSERT INTO public.notification_categories (
  key, section, is_transactional, urgency, default_channels, reach_mode, active
) VALUES
  ('business.site_domain', 'business', true, 'normal',
    ARRAY['inapp', 'push', 'email']::text[], 'reach_once', true),
  ('admin.site_domain', 'support', true, 'normal',
    ARRAY['inapp', 'email']::text[], 'reach_once', true)
ON CONFLICT (key) DO NOTHING;

-- One producer for every domain notice. Owner notices go to members ranked
-- brand admin or above; admin notices to Mingla's product owners. The
-- incident stamp makes a repeated check a no-op and a NEW incident a new row.
-- Customer text names the address and the brand's subdomain only: never an
-- infrastructure provider.
CREATE OR REPLACE FUNCTION public.brand_site_domain_notify(
  p_host_id uuid, p_event text, p_stamp text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_host public.brand_site_hosts%ROWTYPE;
  v_brand_id uuid;
  v_subdomain text;
  v_title text;
  v_body text;
  v_owner boolean;
  v_admin boolean;
  v_user uuid;
  v_count integer := 0;
  v_rows integer;
BEGIN
  SELECT * INTO v_host FROM public.brand_site_hosts WHERE id = p_host_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT site.brand_id INTO v_brand_id FROM public.brand_sites site
  WHERE site.id = v_host.site_id;
  SELECT host.hostname INTO v_subdomain FROM public.brand_site_hosts host
  WHERE host.site_id = v_host.site_id AND host.kind = 'mingla_subdomain'
    AND host.status <> 'retired'
  ORDER BY host.created_at LIMIT 1;

  v_owner := p_event IN ('activated','misconfigured','fallback','mx_missing');
  v_admin := p_event IN ('misconfigured','fallback','tls_expiring');
  v_title := CASE p_event
    WHEN 'activated' THEN 'Your website address is live'
    WHEN 'misconfigured' THEN 'Your website address needs attention'
    WHEN 'fallback' THEN 'Your website moved back to your Mingla address'
    WHEN 'mx_missing' THEN 'Your email records changed'
    WHEN 'tls_expiring' THEN 'A website certificate is about to expire'
    ELSE NULL END;
  IF v_title IS NULL THEN RAISE EXCEPTION 'sites_validation_failed'; END IF;
  v_body := CASE p_event
    WHEN 'activated' THEN v_host.hostname || ' now opens your website.'
    WHEN 'misconfigured' THEN v_host.hostname ||
      ' is not pointing at your website any more. Open Website, then Your addresses, in Mingla Business to see the records to fix.'
    WHEN 'fallback' THEN v_host.hostname ||
      ' could not be reached for 7 days, so your website is back on ' ||
      COALESCE(v_subdomain, 'your Mingla address') ||
      '. Fix the records, then make ' || v_host.hostname || ' your main address again.'
    WHEN 'mx_missing' THEN 'Your email records changed for ' || v_host.hostname ||
      '. We didn''t touch them, but check with your email provider.'
    ELSE 'The certificate for ' || v_host.hostname ||
      ' expires within 14 days and has not renewed. Recheck it in Mingla Admin.'
    END;

  IF v_owner THEN
    FOR v_user IN
      SELECT DISTINCT candidate.user_id FROM (
        SELECT brand.account_id AS user_id FROM public.brands brand WHERE brand.id = v_brand_id
        UNION
        SELECT member.user_id FROM public.brand_team_members member
        WHERE member.brand_id = v_brand_id AND member.removed_at IS NULL
          AND member.accepted_at IS NOT NULL
      ) candidate
      WHERE public.biz_brand_effective_rank(v_brand_id, candidate.user_id) >= 50
    LOOP
      INSERT INTO public.notification_outbox(
        category_key, user_id, brand_id, payload, idempotency_key
      ) VALUES (
        'business.site_domain', v_user, v_brand_id,
        jsonb_build_object('title', v_title, 'body', v_body,
          'site_id', v_host.site_id, 'host_id', v_host.id, 'event', p_event),
        'site-domain:' || v_host.id || ':' || p_event || ':' ||
          COALESCE(p_stamp, '-') || ':' || v_user
      ) ON CONFLICT (idempotency_key) DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_count := v_count + v_rows;
    END LOOP;
  END IF;
  IF v_admin AND to_regprocedure('public.issue_3988_product_owners()') IS NOT NULL THEN
    FOR v_user IN SELECT public.issue_3988_product_owners() LOOP
      INSERT INTO public.notification_outbox(
        category_key, user_id, brand_id, payload, idempotency_key
      ) VALUES (
        'admin.site_domain', v_user, v_brand_id,
        jsonb_build_object('title', v_title, 'body', v_body,
          'site_id', v_host.site_id, 'host_id', v_host.id, 'event', p_event),
        'site-domain-admin:' || v_host.id || ':' || p_event || ':' ||
          COALESCE(p_stamp, '-') || ':' || v_user
      ) ON CONFLICT (idempotency_key) DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_count := v_count + v_rows;
    END LOOP;
  END IF;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_domain_notify(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_domain_notify(uuid, text, text) TO service_role;

-- ── 4. Attach ──────────────────────────────────────────────────────────────
-- The edge function validates the name first (public-suffix apex detection,
-- Mingla and provider domains refused) and passes is_apex in; the same
-- refusals are repeated here so no caller can skip them.
CREATE OR REPLACE FUNCTION public.brand_site_domain_attach(
  p_site_id uuid, p_hostname text, p_is_apex boolean, p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_site public.brand_sites%ROWTYPE;
  v_hostname text := lower(COALESCE(p_hostname, ''));
  v_environment text;
  v_digest text;
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
  v_host_id uuid;
  v_result jsonb;
BEGIN
  IF p_site_id IS NULL OR p_operation_id IS NULL OR p_is_apex IS NULL THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT * INTO v_site FROM public.brand_sites WHERE id = p_site_id FOR UPDATE;
  IF NOT FOUND OR v_actor IS NULL
    OR public.biz_brand_effective_rank(v_site.brand_id, v_actor) < 50 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  v_digest := encode(extensions.digest(concat_ws(E'\n',
    p_site_id::text, 'domain_attach', v_hostname, p_is_apex::text), 'sha256'), 'hex');
  SELECT * INTO v_receipt FROM public.brand_site_operation_receipts
  WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.site_id <> p_site_id OR v_receipt.kind <> 'domain_attach'
      OR v_receipt.arguments_digest <> v_digest THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN v_receipt.result_summary;
  END IF;
  IF NOT public.brand_site_entitled(v_site.brand_id)
    OR v_site.status = 'suspended'
    OR EXISTS (SELECT 1 FROM public.brands brand
      WHERE brand.id = v_site.brand_id AND brand.deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'sites_invalid_state';
  END IF;
  SELECT config.environment INTO v_environment
  FROM public.brand_site_service_config config WHERE config.config_key = 'sites_v1';
  IF length(v_hostname) NOT BETWEEN 4 AND 253
    OR v_hostname !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    OR v_hostname ~ '^[0-9.]+$'
    -- Mingla's own and its providers' domains are never a brand's address.
    OR v_hostname ~ '(^|\.)(usemingla\.com|mingla\.app|sites\.localhost|localhost|vercel\.app|vercel\.com|vercel-dns\.com|now\.sh|supabase\.co|supabase\.in|b-cdn\.net|bunny\.net)$'
    -- Reserved test names only in a developer's local stack (AD-12).
    OR (COALESCE(v_environment, 'production') <> 'local'
      AND v_hostname ~ '\.(test|local|invalid|example|internal|onion)$')
    OR (v_environment = 'local'
      AND v_hostname ~ '\.(local|invalid|example|internal|onion)$') THEN
    RAISE EXCEPTION 'sites_domain_invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_site_hosts host
    WHERE host.hostname = v_hostname AND host.status <> 'retired') THEN
    RAISE EXCEPTION 'sites_domain_taken';
  END IF;
  IF (SELECT count(*) FROM public.brand_site_hosts host
      WHERE host.site_id = p_site_id AND host.kind = 'custom_domain'
        AND host.status <> 'retired') >= 4 THEN
    RAISE EXCEPTION 'sites_domain_limit';
  END IF;

  INSERT INTO public.brand_site_hosts(
    site_id, hostname, kind, status, is_primary, is_apex, dns_state, tls_state
  ) VALUES (
    p_site_id, v_hostname, 'custom_domain', 'pending', false, p_is_apex,
    'pending', 'pending'
  ) RETURNING id INTO v_host_id;
  v_result := jsonb_build_object('site_id', p_site_id, 'status', 'pending',
    'host_id', v_host_id, 'hostname', v_hostname);
  INSERT INTO public.brand_site_operation_receipts(
    operation_id, site_id, brand_id, user_id, kind, arguments_digest,
    status, result_summary, started_at, completed_at
  ) VALUES (
    p_operation_id, p_site_id, v_site.brand_id, v_actor, 'domain_attach',
    v_digest, 'succeeded', v_result, now(), now()
  );
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action, resource_kind,
    resource_id, operation_id, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, v_actor, 'user', 'domain.attached', 'host',
    v_host_id::text, p_operation_id,
    jsonb_build_object('hostname', v_hostname, 'host_kind', 'custom_domain')
  );
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_domain_attach(uuid, text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_domain_attach(uuid, text, boolean, uuid) TO authenticated, service_role;

-- ── 5. Record one check ────────────────────────────────────────────────────
-- p_dns_state is the provider's verdict: 'ok' (verified and configured),
-- 'misconfigured', or 'pending' (not verified yet). p_verification carries the
-- other facts: records (shown to the owner), txt (the provider's ownership
-- challenge, if any), registrar, mx (null when DNS could not answer),
-- probe_ok (the HTTPS site-id probe), tls_expires_at.
CREATE OR REPLACE FUNCTION public.brand_site_domain_record_check(
  p_host_id uuid, p_dns_state text, p_tls_state text,
  p_verification jsonb, p_provider_ref text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_host public.brand_site_hosts%ROWTYPE;
  v_site public.brand_sites%ROWTYPE;
  v_records jsonb := p_verification->'records';
  v_txt jsonb := p_verification->'txt';
  v_mx jsonb := p_verification->'mx';
  v_registrar text := p_verification->>'registrar';
  v_probe_ok boolean := COALESCE((p_verification->>'probe_ok')::boolean, false);
  v_tls_expires timestamptz;
  v_healthy boolean;
  v_status text;
  v_dns text;
  v_checks integer;
  v_since timestamptz;
  v_fell_back boolean := false;
  v_subdomain_id uuid;
  v_prev public.brand_site_hosts%ROWTYPE;
BEGIN
  IF p_host_id IS NULL
    OR p_dns_state NOT IN ('ok','misconfigured','pending')
    OR p_tls_state NOT IN ('unknown','pending','issued','expiring','failed')
    OR p_verification IS NULL OR jsonb_typeof(p_verification) <> 'object'
    OR NOT public.brand_site_json_keys_allowed(p_verification,
      ARRAY['records','txt','registrar','mx','probe_ok','tls_expires_at'])
    OR NOT public.brand_site_valid_dns_records(v_records)
    OR (v_txt IS NOT NULL AND jsonb_typeof(v_txt) <> 'null'
      AND NOT public.brand_site_valid_dns_records(jsonb_build_array(v_txt)))
    OR (v_mx IS NOT NULL AND jsonb_typeof(v_mx) <> 'null'
      AND NOT public.brand_site_valid_name_list(v_mx))
    OR (v_registrar IS NOT NULL AND v_registrar NOT IN (
      'cloudflare','godaddy','squarespace','wix','ionos','namecheap','unknown'))
    OR (p_provider_ref IS NOT NULL AND length(p_provider_ref) > 200) THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  IF jsonb_typeof(v_txt) = 'null' THEN v_txt := NULL; END IF;
  IF jsonb_typeof(v_mx) = 'null' THEN v_mx := NULL; END IF;
  BEGIN
    v_tls_expires := (p_verification->>'tls_expires_at')::timestamptz;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'sites_validation_failed';
  END;

  SELECT * INTO v_host FROM public.brand_site_hosts WHERE id = p_host_id FOR UPDATE;
  IF NOT FOUND OR v_host.kind <> 'custom_domain' THEN
    RAISE EXCEPTION 'sites_not_found';
  END IF;
  IF v_host.status = 'retired' THEN RAISE EXCEPTION 'sites_invalid_state'; END IF;
  SELECT * INTO v_site FROM public.brand_sites WHERE id = v_host.site_id;
  v_prev := v_host;

  v_healthy := p_dns_state = 'ok' AND v_probe_ok;
  v_status := v_host.status;
  v_dns := v_host.dns_state;
  v_checks := v_host.misconfigured_checks;
  v_since := v_host.misconfigured_since;

  IF v_host.status IN ('pending','verifying') THEN
    -- Activation needs the provider's verdict AND the site-id probe, so a
    -- domain someone else points at the provider can never bind this site.
    IF v_healthy THEN
      v_status := 'active';
      v_dns := 'ok';
    ELSIF p_dns_state = 'ok' THEN
      v_status := 'verifying';
      v_dns := 'ok';
    ELSE
      v_dns := 'pending';
    END IF;
    v_checks := 0;
  ELSIF v_host.status IN ('active','suspended') THEN
    IF v_healthy THEN
      v_checks := 0;
      v_since := NULL;
      v_dns := 'ok';
    ELSE
      v_checks := v_checks + 1;
      IF v_checks >= 2 THEN
        v_dns := 'misconfigured';
        v_since := COALESCE(v_since, clock_timestamp());
      END IF;
    END IF;
  ELSE
    -- detaching: recorded for the admin view, never activated again.
    v_dns := CASE WHEN p_dns_state = 'ok' THEN 'ok' ELSE p_dns_state END;
  END IF;

  UPDATE public.brand_site_hosts SET
    status = v_status,
    activated_at = CASE WHEN v_status = 'active' AND v_host.status <> 'active'
      THEN clock_timestamp() ELSE activated_at END,
    dns_state = v_dns,
    tls_state = p_tls_state,
    tls_expires_at = v_tls_expires,
    misconfigured_checks = v_checks,
    misconfigured_since = v_since,
    dns_records = COALESCE(v_records, dns_records),
    verification = COALESCE(v_txt, verification),
    registrar = COALESCE(v_registrar, registrar),
    mx_at_attach = CASE WHEN mx_at_attach IS NULL THEN v_mx ELSE mx_at_attach END,
    mx_missing_since = CASE
      WHEN v_mx IS NULL OR mx_at_attach IS NULL THEN mx_missing_since
      WHEN jsonb_array_length(mx_at_attach) > 0 AND jsonb_array_length(v_mx) = 0
        THEN COALESCE(mx_missing_since, clock_timestamp())
      ELSE NULL END,
    provider_ref = COALESCE(p_provider_ref, provider_ref),
    last_checked_at = clock_timestamp()
  WHERE id = p_host_id
  RETURNING * INTO v_host;

  IF v_status = 'active' AND v_prev.status IN ('pending','verifying') THEN
    INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_kind, action,
      resource_kind, resource_id, metadata)
    VALUES (v_host.site_id, v_site.brand_id, 'system', 'domain.activated', 'host',
      p_host_id::text, jsonb_build_object('hostname', v_host.hostname, 'dns_state', 'ok'));
    PERFORM public.brand_site_domain_notify(p_host_id, 'activated',
      extract(epoch FROM v_host.activated_at)::bigint::text);
  ELSIF v_status = 'verifying' AND v_prev.status = 'pending' THEN
    INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_kind, action,
      resource_kind, resource_id, metadata)
    VALUES (v_host.site_id, v_site.brand_id, 'system', 'domain.verifying', 'host',
      p_host_id::text, jsonb_build_object('hostname', v_host.hostname, 'dns_state', 'ok'));
  END IF;

  -- Drift: newly misconfigured (the second failing check in a row).
  IF v_dns = 'misconfigured' AND v_prev.dns_state <> 'misconfigured' THEN
    INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_kind, action,
      resource_kind, resource_id, metadata)
    VALUES (v_host.site_id, v_site.brand_id, 'system', 'domain.misconfigured', 'host',
      p_host_id::text, jsonb_build_object('hostname', v_host.hostname,
        'dns_state', 'misconfigured'));
    PERFORM public.brand_site_domain_notify(p_host_id, 'misconfigured',
      extract(epoch FROM v_since)::bigint::text);
  END IF;
  -- Recovered after having been misconfigured.
  IF v_dns = 'ok' AND v_prev.dns_state = 'misconfigured' AND v_status <> 'detaching' THEN
    INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_kind, action,
      resource_kind, resource_id, metadata)
    VALUES (v_host.site_id, v_site.brand_id, 'system', 'domain.recovered', 'host',
      p_host_id::text, jsonb_build_object('hostname', v_host.hostname, 'dns_state', 'ok'));
  END IF;
  -- Misconfigured for 7 days as the main address: the Mingla subdomain takes
  -- over automatically.
  IF v_dns = 'misconfigured' AND v_host.is_primary
    AND v_since <= clock_timestamp() - interval '7 days' THEN
    SELECT host.id INTO v_subdomain_id FROM public.brand_site_hosts host
    WHERE host.site_id = v_host.site_id AND host.kind = 'mingla_subdomain'
      AND host.status = 'active'
    ORDER BY host.created_at LIMIT 1;
    IF v_subdomain_id IS NOT NULL THEN
      UPDATE public.brand_site_hosts SET is_primary = false WHERE id = p_host_id;
      UPDATE public.brand_site_hosts SET is_primary = true WHERE id = v_subdomain_id;
      v_fell_back := true;
      INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_kind, action,
        resource_kind, resource_id, metadata)
      VALUES (v_host.site_id, v_site.brand_id, 'system', 'domain.primary_fallback',
        'host', p_host_id::text, jsonb_build_object('hostname', v_host.hostname,
          'dns_state', 'misconfigured'));
      PERFORM public.brand_site_domain_notify(p_host_id, 'fallback',
        extract(epoch FROM v_since)::bigint::text);
    END IF;
  END IF;
  -- Email records disappeared since the first check.
  IF v_host.mx_missing_since IS NOT NULL AND v_prev.mx_missing_since IS NULL THEN
    INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_kind, action,
      resource_kind, resource_id, metadata)
    VALUES (v_host.site_id, v_site.brand_id, 'system', 'domain.mx_missing', 'host',
      p_host_id::text, jsonb_build_object('hostname', v_host.hostname));
    PERFORM public.brand_site_domain_notify(p_host_id, 'mx_missing',
      extract(epoch FROM v_host.mx_missing_since)::bigint::text);
  END IF;
  -- Certificate about to expire without renewal: admins.
  IF p_tls_state = 'expiring' AND v_prev.tls_state <> 'expiring' THEN
    INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_kind, action,
      resource_kind, resource_id, metadata)
    VALUES (v_host.site_id, v_site.brand_id, 'system', 'domain.tls_expiring', 'host',
      p_host_id::text, jsonb_build_object('hostname', v_host.hostname,
        'tls_state', 'expiring'));
    PERFORM public.brand_site_domain_notify(p_host_id, 'tls_expiring',
      COALESCE(to_char(v_tls_expires, 'YYYY-MM-DD'), 'unknown'));
  END IF;

  RETURN jsonb_build_object(
    'host_id', p_host_id, 'site_id', v_host.site_id, 'hostname', v_host.hostname,
    'status', v_host.status, 'dns_state', v_host.dns_state,
    'tls_state', v_host.tls_state, 'misconfigured_checks', v_host.misconfigured_checks,
    'misconfigured_since', v_host.misconfigured_since,
    'mx_missing', v_host.mx_missing_since IS NOT NULL,
    'fell_back', v_fell_back
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_domain_record_check(uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_domain_record_check(uuid, text, text, jsonb, text) TO service_role;

-- ── 6. Set primary (only an active host) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.brand_site_domain_set_primary(
  p_site_id uuid, p_host_id uuid, p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_site public.brand_sites%ROWTYPE;
  v_host public.brand_site_hosts%ROWTYPE;
  v_digest text;
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_site_id IS NULL OR p_host_id IS NULL OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT * INTO v_site FROM public.brand_sites WHERE id = p_site_id FOR UPDATE;
  IF NOT FOUND OR v_actor IS NULL
    OR public.biz_brand_effective_rank(v_site.brand_id, v_actor) < 50 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  v_digest := encode(extensions.digest(concat_ws(E'\n',
    p_site_id::text, 'domain_set_primary', p_host_id::text), 'sha256'), 'hex');
  SELECT * INTO v_receipt FROM public.brand_site_operation_receipts
  WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.site_id <> p_site_id OR v_receipt.kind <> 'domain_set_primary'
      OR v_receipt.arguments_digest <> v_digest THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN v_receipt.result_summary;
  END IF;
  SELECT * INTO v_host FROM public.brand_site_hosts
  WHERE id = p_host_id AND site_id = p_site_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sites_not_found'; END IF;
  IF v_host.status <> 'active' OR NOT public.brand_site_entitled(v_site.brand_id) THEN
    RAISE EXCEPTION 'sites_invalid_state';
  END IF;
  UPDATE public.brand_site_hosts SET is_primary = false
  WHERE site_id = p_site_id AND is_primary AND id <> p_host_id;
  UPDATE public.brand_site_hosts SET is_primary = true WHERE id = p_host_id;
  v_result := jsonb_build_object('site_id', p_site_id, 'status', 'succeeded',
    'host_id', p_host_id, 'hostname', v_host.hostname);
  INSERT INTO public.brand_site_operation_receipts(
    operation_id, site_id, brand_id, user_id, kind, arguments_digest,
    status, result_summary, started_at, completed_at
  ) VALUES (
    p_operation_id, p_site_id, v_site.brand_id, v_actor, 'domain_set_primary',
    v_digest, 'succeeded', v_result, now(), now()
  );
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action, resource_kind,
    resource_id, operation_id, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, v_actor, 'user', 'host.set_primary', 'host',
    p_host_id::text, p_operation_id,
    jsonb_build_object('hostname', v_host.hostname, 'host_kind', v_host.kind)
  );
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_domain_set_primary(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_domain_set_primary(uuid, uuid, uuid) TO authenticated, service_role;

-- ── 7. Detach ──────────────────────────────────────────────────────────────
-- A live address: if it is the main address, the Mingla subdomain becomes the
-- main address FIRST (same transaction); the address then redirects for 30
-- days. Calling detach again on a detaching address is the owner confirming
-- they moved their DNS: the result says release_now. An address that never
-- went live has nothing to redirect and is released at once.
CREATE OR REPLACE FUNCTION public.brand_site_domain_detach(
  p_site_id uuid, p_host_id uuid, p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_site public.brand_sites%ROWTYPE;
  v_host public.brand_site_hosts%ROWTYPE;
  v_subdomain_id uuid;
  v_digest text;
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
  v_status text;
  v_release boolean := false;
  v_result jsonb;
BEGIN
  IF p_site_id IS NULL OR p_host_id IS NULL OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT * INTO v_site FROM public.brand_sites WHERE id = p_site_id FOR UPDATE;
  IF NOT FOUND OR v_actor IS NULL
    OR public.biz_brand_effective_rank(v_site.brand_id, v_actor) < 50 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  v_digest := encode(extensions.digest(concat_ws(E'\n',
    p_site_id::text, 'domain_detach', p_host_id::text), 'sha256'), 'hex');
  SELECT * INTO v_receipt FROM public.brand_site_operation_receipts
  WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.site_id <> p_site_id OR v_receipt.kind <> 'domain_detach'
      OR v_receipt.arguments_digest <> v_digest THEN
      RAISE EXCEPTION 'sites_idempotency_conflict';
    END IF;
    RETURN v_receipt.result_summary;
  END IF;
  SELECT * INTO v_host FROM public.brand_site_hosts
  WHERE id = p_host_id AND site_id = p_site_id FOR UPDATE;
  IF NOT FOUND OR v_host.kind <> 'custom_domain' THEN
    RAISE EXCEPTION 'sites_not_found';
  END IF;
  IF v_host.status = 'retired' THEN RAISE EXCEPTION 'sites_invalid_state'; END IF;

  IF v_host.is_primary THEN
    SELECT host.id INTO v_subdomain_id FROM public.brand_site_hosts host
    WHERE host.site_id = p_site_id AND host.kind = 'mingla_subdomain'
      AND host.status = 'active'
    ORDER BY host.created_at LIMIT 1;
    IF v_subdomain_id IS NULL THEN RAISE EXCEPTION 'sites_invalid_state'; END IF;
    -- #2829 — the subdomain takes over BEFORE the custom address stops being
    -- the main one, so the site never has no main address.
    UPDATE public.brand_site_hosts SET is_primary = false WHERE id = p_host_id;
    UPDATE public.brand_site_hosts SET is_primary = true WHERE id = v_subdomain_id;
  END IF;

  IF v_host.status = 'detaching' THEN
    v_status := 'detaching';
    v_release := true;
  ELSIF v_host.status IN ('active','suspended') THEN
    UPDATE public.brand_site_hosts SET status = 'detaching',
      detach_requested_at = clock_timestamp(),
      redirect_until = clock_timestamp() + interval '30 days'
    WHERE id = p_host_id;
    v_status := 'detaching';
  ELSE
    v_status := v_host.status;
    v_release := true;
  END IF;
  v_result := jsonb_build_object('site_id', p_site_id, 'status', v_status,
    'host_id', p_host_id, 'hostname', v_host.hostname, 'release_now', v_release);
  INSERT INTO public.brand_site_operation_receipts(
    operation_id, site_id, brand_id, user_id, kind, arguments_digest,
    status, result_summary, started_at, completed_at
  ) VALUES (
    p_operation_id, p_site_id, v_site.brand_id, v_actor, 'domain_detach',
    v_digest, 'succeeded', v_result, now(), now()
  );
  INSERT INTO public.brand_site_audit_log(
    site_id, brand_id, actor_user_id, actor_kind, action, resource_kind,
    resource_id, operation_id, metadata
  ) VALUES (
    p_site_id, v_site.brand_id, v_actor, 'user', 'domain.detach_requested', 'host',
    p_host_id::text, p_operation_id,
    jsonb_build_object('hostname', v_host.hostname, 'status', v_status)
  );
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_domain_detach(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_domain_detach(uuid, uuid, uuid) TO authenticated, service_role;

-- ── 8. Release (service role) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.brand_site_domain_release(
  p_host_id uuid, p_reason_code text DEFAULT 'REDIRECT_WINDOW_ENDED'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_host public.brand_site_hosts%ROWTYPE;
  v_brand_id uuid;
BEGIN
  IF p_host_id IS NULL OR p_reason_code IS NULL
    OR p_reason_code NOT IN ('REDIRECT_WINDOW_ENDED','OWNER_CONFIRMED','NEVER_LIVE') THEN
    RAISE EXCEPTION 'sites_validation_failed';
  END IF;
  SELECT * INTO v_host FROM public.brand_site_hosts WHERE id = p_host_id FOR UPDATE;
  IF NOT FOUND OR v_host.kind <> 'custom_domain' THEN
    RAISE EXCEPTION 'sites_not_found';
  END IF;
  IF v_host.status = 'retired' THEN
    RETURN jsonb_build_object('host_id', p_host_id, 'status', 'retired', 'replayed', true);
  END IF;
  -- The main address is never released; only an address that is redirecting
  -- (window over, or the owner confirmed) or never went live.
  IF v_host.is_primary
    OR (v_host.status = 'detaching' AND p_reason_code = 'REDIRECT_WINDOW_ENDED'
      AND v_host.redirect_until > clock_timestamp())
    OR (v_host.status = 'detaching' AND p_reason_code = 'NEVER_LIVE')
    OR (v_host.status IN ('active','suspended'))
    OR (v_host.status IN ('pending','verifying') AND p_reason_code <> 'NEVER_LIVE') THEN
    RAISE EXCEPTION 'sites_invalid_state';
  END IF;
  UPDATE public.brand_site_hosts SET status = 'retired', retired_at = clock_timestamp()
  WHERE id = p_host_id;
  SELECT site.brand_id INTO v_brand_id FROM public.brand_sites site WHERE site.id = v_host.site_id;
  INSERT INTO public.brand_site_audit_log(site_id, brand_id, actor_kind, action,
    resource_kind, resource_id, metadata)
  VALUES (v_host.site_id, v_brand_id, 'system', 'domain.released', 'host',
    p_host_id::text, jsonb_build_object('hostname', v_host.hostname,
      'reason_code', p_reason_code));
  RETURN jsonb_build_object('host_id', p_host_id, 'status', 'retired', 'replayed', false);
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_domain_release(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_domain_release(uuid, text) TO service_role;

-- ── 9. Reads ───────────────────────────────────────────────────────────────
-- The brand's addresses, for the Business app: rank 20 reads, rank 50
-- manages. No other brand's rows, ever.
CREATE OR REPLACE FUNCTION public.brand_site_domains_list(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_site public.brand_sites%ROWTYPE;
  v_rank integer;
BEGIN
  SELECT * INTO v_site FROM public.brand_sites WHERE id = p_site_id;
  v_rank := CASE WHEN FOUND AND v_actor IS NOT NULL
    THEN COALESCE(public.biz_brand_effective_rank(v_site.brand_id, v_actor), 0)
    ELSE 0 END;
  IF v_rank < 20 THEN RAISE EXCEPTION 'sites_forbidden'; END IF;
  RETURN jsonb_build_object(
    'site_id', v_site.id,
    'can_manage', v_rank >= 50 AND public.brand_site_entitled(v_site.brand_id),
    'max_custom_domains', 4,
    'hosts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', host.id, 'hostname', host.hostname, 'kind', host.kind,
        'status', host.status, 'is_primary', host.is_primary,
        'is_apex', host.is_apex, 'dns_state', host.dns_state,
        'tls_state', host.tls_state, 'records', COALESCE(host.dns_records, '[]'::jsonb),
        'verification', host.verification, 'registrar', host.registrar,
        'mx_missing', host.mx_missing_since IS NOT NULL,
        'misconfigured_since', host.misconfigured_since,
        'redirect_until', host.redirect_until,
        'last_checked_at', host.last_checked_at,
        'activated_at', host.activated_at, 'created_at', host.created_at
      ) ORDER BY host.kind DESC, host.created_at)
      FROM public.brand_site_hosts host
      WHERE host.site_id = v_site.id AND host.status <> 'retired'
    ), '[]'::jsonb)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_domains_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_domains_list(uuid) TO authenticated, service_role;

-- The sweep's work list: every custom address still in play, oldest check first.
CREATE OR REPLACE FUNCTION public.brand_site_domains_due(p_limit integer DEFAULT 200)
RETURNS TABLE(host_id uuid, site_id uuid, hostname text, status text,
  is_apex boolean, redirect_until timestamptz, provider_ref text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT host.id, host.site_id, host.hostname, host.status, host.is_apex,
    host.redirect_until, host.provider_ref
  FROM public.brand_site_hosts host
  WHERE host.kind = 'custom_domain'
    AND host.status IN ('pending','verifying','active','detaching')
  ORDER BY host.last_checked_at NULLS FIRST, host.created_at
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
$function$;
REVOKE ALL ON FUNCTION public.brand_site_domains_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_domains_due(integer) TO service_role;

-- Which site a custom address is being attached to, for the runtime's
-- /.well-known/mingla-site probe. Answers for an address still waiting for
-- DNS (the probe is what activates it) as well as a live one; never for a
-- revoked, deleted or suspended brand's site. No brand data leaves the
-- runtime: it only returns a hash of the site id.
CREATE OR REPLACE FUNCTION public.brand_site_resolve_probe_host(p_hostname text)
RETURNS TABLE(site_id uuid, hostname text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT site.id, host.hostname
  FROM public.brand_site_hosts host
  JOIN public.brand_sites site ON site.id = host.site_id
  JOIN public.brands brand ON brand.id = site.brand_id
  JOIN public.brand_site_entitlements entitlement
    ON entitlement.brand_id = site.brand_id AND entitlement.status = 'granted'
  WHERE host.hostname = lower(p_hostname)
    AND (host.status IN ('active','detaching')
      OR (host.kind = 'custom_domain' AND host.status IN ('pending','verifying')))
    AND brand.deleted_at IS NULL
    AND site.status <> 'suspended';
$function$;
REVOKE ALL ON FUNCTION public.brand_site_resolve_probe_host(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_resolve_probe_host(text) TO service_role;

-- ── 10. Public resolution: a detaching address redirects only inside its
-- window, and the runtime learns every address the site has ever had (an
-- artifact published while another address was primary keeps rendering, with
-- the CURRENT primary as its canonical). No brand, operator, origin or
-- hostname literal and no recovery-evidence predicate (W1 assertions).
DROP FUNCTION IF EXISTS public.brand_site_resolve_publication(text);
CREATE OR REPLACE FUNCTION public.brand_site_resolve_publication(p_hostname text)
RETURNS TABLE(
  site_id uuid, brand_id uuid, publication_id uuid, artifact_key text,
  artifact_digest text, artifact_schema_version integer, renderer_key text,
  renderer_version integer, hostname text, primary_hostname text,
  is_primary boolean, host_kind text, design_key text, site_hostnames text[]
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
    host.kind, publication.design_key,
    ARRAY(
      SELECT DISTINCT every_host.hostname FROM public.brand_site_hosts every_host
      WHERE every_host.site_id = site.id ORDER BY every_host.hostname
    )
  FROM public.brand_site_hosts host
  JOIN public.brand_sites site ON site.id = host.site_id
  JOIN public.brands brand ON brand.id = site.brand_id
  JOIN public.brand_site_entitlements entitlement
    ON entitlement.brand_id = site.brand_id AND entitlement.status = 'granted'
  JOIN public.brand_site_publications publication
    ON publication.id = site.active_publication_id
    AND publication.site_id = site.id
  WHERE host.hostname = lower(p_hostname)
    AND (host.status = 'active'
      OR (host.status = 'detaching' AND host.redirect_until > clock_timestamp()))
    -- #2829 — a soft-deleted brand's site goes dark at once.
    AND brand.deleted_at IS NULL
    AND site.status = 'published'
    AND site.owner_offline_at IS NULL
    AND publication.status = 'published'
    AND publication.artifact_key IS NOT NULL
    AND publication.artifact_digest IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_resolve_publication(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_resolve_publication(text) TO service_role;

CREATE OR REPLACE FUNCTION public.brand_site_resolve_host(p_hostname text)
RETURNS TABLE(site_id uuid, brand_id uuid, hostname text, primary_hostname text,
  is_primary boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
    AND (host.status = 'active'
      OR (host.status = 'detaching' AND host.redirect_until > clock_timestamp()))
    AND brand.deleted_at IS NULL
    AND site.status <> 'suspended';
$function$;
REVOKE ALL ON FUNCTION public.brand_site_resolve_host(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_resolve_host(text) TO service_role;

-- ── 11. Admin detail: each address with its id and domain state ────────────
CREATE OR REPLACE FUNCTION public.brand_site_admin_detail(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
        'host_id', host.id,
        'hostname', host.hostname, 'kind', host.kind, 'status', host.status,
        'is_primary', host.is_primary, 'activated_at', host.activated_at,
        'label', host.label, 'dns_state', host.dns_state,
        'tls_state', host.tls_state, 'last_checked_at', host.last_checked_at,
        'misconfigured_since', host.misconfigured_since,
        'redirect_until', host.redirect_until,
        'tls_expires_at', host.tls_expires_at,
        'mx_missing', host.mx_missing_since IS NOT NULL
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
        WHERE brand_site_publications.site_id = site.id ORDER BY requested_at DESC LIMIT 25
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
        WHERE brand_site_operation_receipts.site_id = site.id ORDER BY updated_at DESC LIMIT 50
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
        WHERE brand_site_audit_log.site_id = site.id ORDER BY occurred_at DESC LIMIT 100
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
$function$;
REVOKE ALL ON FUNCTION public.brand_site_admin_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_admin_detail(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.brand_site_domain_attach(uuid, text, boolean, uuid) IS
  '#2829 W8 — attach a brand''s own domain (rank 50, max 4, one site per name, no Mingla or provider domains).';
COMMENT ON FUNCTION public.brand_site_domain_record_check(uuid, text, text, jsonb, text) IS
  '#2829 W8 — record one domain check: activation needs provider verdict + site-id probe; two failing checks = misconfigured; 7 days misconfigured as primary = subdomain takes over.';

-- ── 12. The sweep every 6 hours (drift and certificate monitoring) ─────────
-- Same Vault-advisory posture as the #3429 worker: CI replays the chain on a
-- Vault-less database, so a missing secret is a NOTICE here and a release
-- runbook check, never an exception.
DO $advisory$
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'Issue #2829 advisory: Vault decrypted_secrets is unavailable; the domain sweep cannot authenticate until it is.';
  END IF;
END
$advisory$;

DO $cron_replace$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'brand-site-domains-sweep') THEN
    PERFORM cron.unschedule('brand-site-domains-sweep');
  END IF;
END
$cron_replace$;

SELECT cron.schedule(
  'brand-site-domains-sweep',
  '23 */6 * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'supabase_url' LIMIT 1
      ) || '/functions/v1/brand-site-domains/internal/v1/domains/sweep',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'service_role_key' LIMIT 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$
);

COMMIT;
