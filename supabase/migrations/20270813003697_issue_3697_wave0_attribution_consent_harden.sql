-- toward #3697 Wave 0: first-party consent on ad touches, conversion share flag,
-- 90-day touch retention (D10), least-privilege grants on attribution tables.
-- Folded #3702/#3703 public ACs. No security exploit detail in this file.

-- 0. Widen touch dest_page_type for experience landings (Wave 0a / #3699).
ALTER TABLE public.ad_attribution_touches
  DROP CONSTRAINT IF EXISTS ad_attribution_touches_dest_page_type_check;
ALTER TABLE public.ad_attribution_touches
  ADD CONSTRAINT ad_attribution_touches_dest_page_type_check
  CHECK (
    dest_page_type IS NULL
    OR dest_page_type IN ('event', 'trip', 'brand', 'venue', 'experience')
  );

-- 1. Consent on first-party touches. Default 'granted' preserves pre-Wave-0 rows
--    (legacy clicks already implied share). New pre-consent captures set pending
--    explicitly from the client.
ALTER TABLE public.ad_attribution_touches
  ADD COLUMN IF NOT EXISTS consent_state text NOT NULL DEFAULT 'granted'
    CHECK (consent_state IN ('pending', 'granted', 'rejected'));

COMMENT ON COLUMN public.ad_attribution_touches.consent_state IS
  'toward #3697 / #3703: pending = recorded before cookie choice; granted = Accept (also legacy default); rejected = Reject. Server CAPI/Events sends only when granted. Mingla still counts conversions for rejected/pending clicks.';

CREATE INDEX IF NOT EXISTS idx_ad_attribution_touches_consent_state
  ON public.ad_attribution_touches (consent_state)
  WHERE consent_state <> 'granted';

-- 2. Whether this conversion was shared with ad platforms (false when Reject).
ALTER TABLE public.ad_conversions
  ADD COLUMN IF NOT EXISTS shared_with_platforms boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.ad_conversions.shared_with_platforms IS
  'toward #3697 F-3 / #3703: false when the attributed touch has consent_state=rejected (or unknown denied). Counted in Mingla; never sent outbound.';

-- 3. Least-privilege: match newer ad tables — revoke broad roles, re-grant narrow.
REVOKE ALL ON public.ad_attribution_touches FROM PUBLIC, anon;
REVOKE ALL ON public.ad_conversions FROM PUBLIC, anon;
GRANT SELECT ON public.ad_attribution_touches TO authenticated;
GRANT SELECT ON public.ad_conversions TO authenticated;
GRANT ALL ON public.ad_attribution_touches TO service_role;
GRANT ALL ON public.ad_conversions TO service_role;

REVOKE ALL ON public.ad_connections FROM PUBLIC, anon;
REVOKE ALL ON public.ad_campaigns FROM PUBLIC, anon;
REVOKE ALL ON public.ad_sets FROM PUBLIC, anon;
REVOKE ALL ON public.ads FROM PUBLIC, anon;
REVOKE ALL ON public.ad_status_events FROM PUBLIC, anon;
GRANT SELECT ON public.ad_connections TO authenticated;
GRANT SELECT ON public.ad_campaigns TO authenticated;
GRANT SELECT ON public.ad_sets TO authenticated;
GRANT SELECT ON public.ads TO authenticated;
GRANT SELECT ON public.ad_status_events TO authenticated;
GRANT ALL ON public.ad_connections TO service_role;
GRANT ALL ON public.ad_campaigns TO service_role;
GRANT ALL ON public.ad_sets TO service_role;
GRANT ALL ON public.ads TO service_role;
GRANT ALL ON public.ad_status_events TO service_role;

-- 4. D10-1: delete pre-consent / first-party touch rows older than 90 days.
CREATE OR REPLACE FUNCTION public.purge_ad_attribution_touches_older_than_90d()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.ad_attribution_touches
  WHERE created_at < (now() - interval '90 days');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_ad_attribution_touches_older_than_90d()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_ad_attribution_touches_older_than_90d()
  TO service_role;

COMMENT ON FUNCTION public.purge_ad_attribution_touches_older_than_90d() IS
  'toward #3697 D10-1: scheduled purge of first-party ad click records older than 90 days.';

-- Schedule nightly purge when pg_cron is available (fail-open if extension absent).
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;
  SELECT j.jobid INTO v_job_id
  FROM cron.job j
  WHERE j.jobname = 'purge_ad_attribution_touches_90d'
  LIMIT 1;
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
  PERFORM cron.schedule(
    'purge_ad_attribution_touches_90d',
    '17 4 * * *',
    $cron$SELECT public.purge_ad_attribution_touches_older_than_90d()$cron$
  );
EXCEPTION
  WHEN undefined_table THEN
    NULL;
  WHEN OTHERS THEN
    RAISE NOTICE 'toward #3697: pg_cron schedule skipped: %', SQLERRM;
END;
$$;
