-- #4572 item 15: Go live refused with a bare INVALID_STATE while the Publish
-- panel said "Checks: Ready".
--
-- A NEW site's first publish needs recent recovery evidence (backup,
-- manifest, restore drill). That condition lived only inside
-- public.brand_site_authorize_operation, so the Host could not see it and said
-- "Ready" while the server refused (two owners of "ready", Constitution 2).
--
--   1. public.brand_site_first_publish_ready(): the ONE definition of the
--      recovery condition. It reads the #4574 budget helpers
--      (brand_site_database_backup_budget, brand_site_object_manifest_budget);
--      no budget is written here. Service role only.
--   2. public.brand_site_authorize_operation re-emitted from
--      20281128004574 byte for byte except that the inline condition becomes a
--      call to (1). Drift guard: md5 of the live #4574 body.
--   3. public.brand_site_publishing_paused(p_site_id): what the Host reads.
--      true only while the site has never published AND (1) is false. The
--      caller must hold content rank 20 on the site's brand, as for preview.
--
-- INVARIANT sites-first-publish-ready-one-owner: brand_site_first_publish_ready()
-- is the only definition of the first-publish recovery condition; the gate and
-- the Host's paused state both call it.
--
-- Release order: either. Applied before the Host deploy, nothing reads (3) yet
-- and the gate behaves exactly as today. Host code deployed first treats a
-- missing (3) as "not paused" (today's behaviour).
-- Rollback: re-run section 2 of 20281128004574 (the helpers can stay).

BEGIN;

SET LOCAL lock_timeout = '10s';

DO $drift_guard$
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_proc p
      WHERE p.oid = 'public.brand_site_authorize_operation(uuid, uuid, text, text, text, text)'::regprocedure)
     IS DISTINCT FROM '79c1db01ce338c24a834d2097792ad87' THEN
    RAISE EXCEPTION 'issue #4572 drift: public.brand_site_authorize_operation no longer matches its #4574 definition';
  END IF;
END;
$drift_guard$;

-- ── 1. The one owner of the first-publish recovery condition ───────────────
CREATE OR REPLACE FUNCTION public.brand_site_first_publish_ready()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_config public.brand_site_service_config%ROWTYPE;
  v_latest_source text;
BEGIN
  SELECT * INTO v_config
  FROM public.brand_site_service_config config
  WHERE config.config_key = 'sites_v1';
  SELECT receipt.evidence_source INTO v_latest_source
  FROM public.brand_site_readiness_receipts receipt
  WHERE receipt.evidence_kind IN ('nightly_backup','restore_drill')
  ORDER BY receipt.accepted_at DESC LIMIT 1;
  RETURN NOT (v_config.config_key IS NULL OR NOT (
        (COALESCE(v_config.backup_retention_days, 0) >= 7
          AND v_config.backup_entitlement_verified_at IS NOT NULL
          AND v_config.database_backup_verified_at IS NOT NULL
          AND v_config.database_backup_verified_at > clock_timestamp() - public.brand_site_database_backup_budget()
          AND v_config.object_manifest_verified_at IS NOT NULL
          AND v_config.object_manifest_verified_at > clock_timestamp() - public.brand_site_object_manifest_budget()
          AND v_config.restore_drill_verified_at IS NOT NULL
          AND v_config.restore_drill_verified_at > clock_timestamp() - interval '100 days'
          AND v_config.restore_drill_evidence_digest IS NOT NULL)
        OR (v_config.environment = 'local' AND v_latest_source = 'local_synthetic')
  ));
END;
$function$;
COMMENT ON FUNCTION public.brand_site_first_publish_ready() IS
  '#4572 item 15 — INVARIANT sites-first-publish-ready-one-owner: the only definition of the recovery evidence a NEW site''s first publish needs. Read by brand_site_authorize_operation and brand_site_publishing_paused. Budgets come from the #4574 helpers.';
REVOKE ALL ON FUNCTION public.brand_site_first_publish_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_first_publish_ready() TO service_role;

-- ── 2. The gate calls (1) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.brand_site_authorize_operation(
  p_site_id uuid, p_operation_id uuid, p_kind text, p_arguments_digest text,
  p_expected_revision text, p_source_digest text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_site public.brand_sites%ROWTYPE;
  v_receipt public.brand_site_operation_receipts%ROWTYPE;
  v_publication_id uuid;
  v_rollback_source_id uuid;
  v_rank integer;
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
      -- #4572 item 15 — the condition has ONE owner,
      -- public.brand_site_first_publish_ready(); the Host's "Publishing is
      -- paused" state reads the same function.
      IF NOT public.brand_site_first_publish_ready() THEN
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
$function$;
-- CREATE OR REPLACE keeps the existing grants (authenticated, service_role).

-- ── 3. What the Host reads ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.brand_site_publishing_paused(p_site_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_site public.brand_sites%ROWTYPE;
BEGIN
  SELECT * INTO v_site FROM public.brand_sites WHERE id = p_site_id;
  IF NOT FOUND OR v_actor IS NULL
    OR public.biz_brand_effective_rank(v_site.brand_id, v_actor) < 20 THEN
    RAISE EXCEPTION 'sites_forbidden';
  END IF;
  -- NULL from the condition means the gate lets the publish through, so the
  -- Host must not say paused either.
  RETURN v_site.last_successful_publication_id IS NULL
    AND COALESCE(NOT public.brand_site_first_publish_ready(), false);
END;
$function$;
COMMENT ON FUNCTION public.brand_site_publishing_paused(uuid) IS
  '#4572 item 15 — true while a never-published site''s first Go live would be refused for recovery evidence (brand_site_first_publish_ready() false). Content rank 20 on the site''s brand; anyone else gets sites_forbidden.';
REVOKE ALL ON FUNCTION public.brand_site_publishing_paused(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_publishing_paused(uuid) TO authenticated, service_role;

COMMIT;
