-- toward #3697: keep authenticated ad read models read-only under permissive default grants.
BEGIN;

REVOKE ALL ON public.ad_region_config FROM authenticated;
GRANT SELECT ON public.ad_region_config TO authenticated;

REVOKE ALL ON public.ad_event_stage_summary_daily FROM authenticated;
GRANT SELECT ON public.ad_event_stage_summary_daily TO authenticated;

COMMIT;
