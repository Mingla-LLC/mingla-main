-- Issue #3606 — the public Sites runtime resolver spent part of its freshness
-- budget before the job that refills it had even finished.
--
-- `public.brand_site_resolve_publication` re-checks recovery evidence on EVERY
-- page request. Four readiness fields were each required to be newer than 26
-- hours, and the OLDEST of them bound the whole window. Three of the four are
-- stamped at job completion. The fourth, `database_backup_verified_at`, is NOT
-- a completion moment at all: `scripts/sites/backup-sites-cms.mjs` sets it to
-- the upstream Supabase managed backup's own `inserted_at`, which is taken
-- hours before the job that observes it.
--
-- Measured on run 36419324279, a single successful run on 2026-09-28:
--
--   database_backup_verified_at     10:42:47Z   <- bound the window
--   object_manifest_verified_at     12:03:39Z
--   restore_drill_verified_at       12:04:56Z
--   backup_entitlement_verified_at  12:04:59Z   <- job completion
--
-- 1 hour 21 minutes of a 26-hour budget was already spent the instant the run
-- succeeded, leaving an effective window of ~24.6 hours for a job whose GitHub
-- schedule has been dispatching 4.5 to 5.7 hours late and drifting later. That
-- is why a daily job defending a 26-hour window came within 47 minutes of
-- serving 404 on every page of the live pilot host.
--
-- This migration makes the resolver measure the availability window against the
-- job's COMPLETION, and re-asserts the recovery-point bound relative to the
-- verification that observed it rather than dropping it.
--
-- WHY THIS DOES NOT WEAKEN THE GATE
--
-- The artifact the pilot is actually restored from is the encrypted bundle
-- dumped DURING the job and proven by the isolated restore drill in the same
-- run. Its freshness is carried by `object_manifest_verified_at`, which stays
-- on the unchanged 26-hour completion budget below. `database_backup_verified_at`
-- attests to a SECOND, independent recovery path — that Supabase's own managed
-- backup service is current — and that attestation is already enforced twice at
-- write time and remains enforced here:
--
--   * `MAX_BACKUP_AGE_MS` in `scripts/sites/lib/sites-ops.mjs` refuses to build a
--     bundle at all when the newest completed managed backup is over 26 hours
--     old (`DATABASE_BACKUP_STALE`), and a refusing job fails, which triggers
--     signed pilot deactivation.
--   * `public.brand_site_record_readiness_evidence` raises
--     `sites_readiness_blocked` when the submitted
--     `database_backup_verified_at` is more than 26 hours before the accepting
--     transaction.
--   * The clause added below re-asserts exactly that same 26-hour bound at READ
--     time, anchored to the verification moment, so evidence that was accepted
--     always resolves and evidence that was never that fresh never does.
--
-- Resolution still fails closed on genuinely stale recovery evidence. What
-- changes is only which instant the clock starts from.

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
    ON publication.id = site.active_publication_id
    AND publication.site_id = site.id
  JOIN public.brand_site_service_config config
    ON config.config_key = 'sites_v1'
    AND config.pilot_enabled
    AND config.pilot_brand_id = '733bc470-45e1-4684-8896-acd7e26074ff'::uuid
    AND config.pilot_brand_id = site.brand_id
    AND config.pilot_site_id = site.id
    AND config.configured_by = '1f3d2ddf-b741-4e2f-8884-d7222a660c7e'::uuid
    AND config.cms_origin = 'https://studio.sites.usemingla.com'
    AND config.public_runtime_origin = 'https://gogi.sites.usemingla.com'
    AND COALESCE(config.backup_retention_days, 0) >= 7
    -- #3606 — the availability window is measured from the moment the
    -- verification COMPLETED. These three fields are all stamped at job
    -- completion, so the budget below is the whole budget, not a remainder.
    AND config.backup_entitlement_verified_at >
      statement_timestamp() - interval '26 hours'
    AND config.object_manifest_verified_at >
      statement_timestamp() - interval '26 hours'
    AND config.restore_drill_verified_at >
      statement_timestamp() - interval '100 days'
    -- #3606 — `database_backup_verified_at` is a RECOVERY POINT, not a
    -- completion: it is the upstream managed backup's own `inserted_at`,
    -- stamped hours before the job observed it. Measuring the public window
    -- from it spent part of the budget before the run finished. It is instead
    -- bound to the verification that observed it, which is the identical
    -- 26-hour bound `brand_site_record_readiness_evidence` already enforced
    -- when it accepted the evidence. A managed backup that was never that
    -- fresh still cannot resolve.
    AND config.database_backup_verified_at IS NOT NULL
    AND config.database_backup_verified_at >
      config.backup_entitlement_verified_at - interval '26 hours'
  WHERE host.hostname = lower(p_hostname)
    AND p_hostname = 'gogi.sites.usemingla.com'
    AND host.status = 'active' AND host.is_primary
    AND site.status = 'published' AND publication.status = 'published'
    AND publication.artifact_key IS NOT NULL
    AND publication.artifact_digest IS NOT NULL;
$$;

COMMENT ON FUNCTION public.brand_site_resolve_publication(text) IS
  'Issue #3606: per-request public host resolution. The 26-hour recovery '
  'freshness budget is measured from the completion-stamped readiness fields; '
  'database_backup_verified_at carries the upstream managed backup recovery '
  'point and is bound relative to the verification that observed it. Fails '
  'closed on stale evidence.';

-- Re-asserted, not changed: CREATE OR REPLACE preserves privileges, and these
-- statements are the same ones #2830 and #2893 established. Stating them keeps
-- the function's reachable surface readable in one place.
REVOKE ALL ON FUNCTION public.brand_site_resolve_publication(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_resolve_publication(text)
  TO service_role;
