-- Issue #3040: one read-only health view for the video lane, consumed by
-- api-health-probe so ready-but-unclaimed, stuck and slow videos reach the
-- existing Bunny alert rail. Separate from the lane migration so the view can
-- be rolled forward on its own.
--
-- Bounds come from the #3040 job state machine. Each "stuck" bound adds five
-- minutes (five reaper ticks) of grace so a job the reaper is about to move on
-- its next tick is not reported as stuck.
-- SLO figures exclude rows created before 2026-10-18: their source_uploaded_at
-- was backfilled from a later clock and would read as 0 s processing.

BEGIN;

CREATE OR REPLACE VIEW public.cover_video_lane_health_v
WITH (security_invoker = true) AS
SELECT
  (SELECT count(*) FROM public.event_cover_video_jobs j
    WHERE j.status = 'ready'
      AND j.completed_at < now() - interval '15 minutes')::bigint
    AS ready_unclaimed_count,
  (SELECT count(*) FROM public.event_cover_video_jobs j
    WHERE (
      -- allocation never started (10 min bound)
      (j.status = 'source_uploading' AND j.source_asset_id IS NULL
        AND j.provider_allocation_uncertain_at IS NULL
        AND j.created_at < now() - interval '15 minutes')
      -- allocation uncertain (30 min bound)
      OR (j.status = 'source_uploading' AND j.source_asset_id IS NULL
        AND j.provider_allocation_uncertain_at IS NOT NULL
        AND j.provider_allocation_uncertain_at < now() - interval '35 minutes')
      -- transfer: lease plus the 30 min unverifiable window
      OR (j.status = 'source_uploading' AND j.source_asset_id IS NOT NULL
        AND coalesce(j.tus_expires_at, j.created_at + interval '1 hour')
          < now() - interval '35 minutes')
      -- processing: 10 min from the final byte
      OR (j.status IN ('source_uploaded','processing_queued','processing')
        AND coalesce(j.source_uploaded_at, j.created_at) < now() - interval '15 minutes')
      -- ready: 24 h owner TTL
      OR (j.status = 'ready' AND j.completed_at < now() - interval '24 hours 5 minutes')
    ))::bigint
    AS stuck_nonterminal_count,
  (SELECT count(*) FROM public.event_cover_video_jobs j
    WHERE j.processing_slo_alerted_at >= now() - interval '1 hour'
      AND j.created_at >= timestamptz '2026-10-18 00:00:00+00')::bigint
    AS slo_breaches_1h,
  (SELECT floor(extract(epoch FROM (now() - min(j.completed_at))))::bigint
    FROM public.event_cover_video_jobs j
    WHERE j.status = 'ready')
    AS oldest_ready_age_s;

REVOKE ALL ON public.cover_video_lane_health_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cover_video_lane_health_v TO service_role;

COMMENT ON VIEW public.cover_video_lane_health_v IS
  'Issue #3040 video lane health for api-health-probe: ready-unclaimed, stuck past bound, SLO breaches in the last hour, oldest ready age.';

DO $verify$
BEGIN
  IF to_regclass('public.cover_video_lane_health_v') IS NULL THEN
    RAISE EXCEPTION 'issue #3040: lane health view missing';
  END IF;
  IF has_table_privilege('anon', 'public.cover_video_lane_health_v', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cover_video_lane_health_v', 'SELECT') THEN
    RAISE EXCEPTION 'issue #3040: lane health view leaked to a client role';
  END IF;
  PERFORM ready_unclaimed_count, stuck_nonterminal_count, slo_breaches_1h, oldest_ready_age_s
  FROM public.cover_video_lane_health_v;
END $verify$;

COMMIT;
