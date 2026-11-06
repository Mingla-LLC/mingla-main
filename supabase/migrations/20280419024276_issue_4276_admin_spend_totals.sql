-- Issue #4276 (design pass): recorded spend to date, for the Place pool screens.
--
-- The approved design shows one line of recorded spend across every city: seeding,
-- photos, Gemini, and Serper counted by request until someone sets its rate. The
-- per-city ledger (city_pipeline_spend_ledger) is service-only and needs a city, so
-- this reads the same sources once, for admins only:
--   * seeding_runs.total_cost_usd           Google searches;
--   * photo_backfill_runs.actual_cost_usd   Google photo downloads;
--   * place_intelligence_runs               Gemini (cost_so_far_usd) and Serper
--                                           (serper_requests, priced only from
--                                           city_pipeline_settings).
-- Nothing is estimated here: a provider with no record reads 0, and Serper's dollars
-- stay null until a rate is set.
--
-- Admin check: is_admin_user(), the same check every admin surface uses.
-- Static SQL. Rollback: DROP FUNCTION public.admin_place_pipeline_spend_totals().

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_place_pipeline_spend_totals()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_seeding numeric;
  v_photos numeric;
  v_gemini numeric;
  v_serper_requests bigint;
  v_rate numeric;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(sum(total_cost_usd), 0)::numeric INTO v_seeding FROM public.seeding_runs;
  SELECT COALESCE(sum(actual_cost_usd), 0)::numeric INTO v_photos FROM public.photo_backfill_runs;
  SELECT COALESCE(sum(cost_so_far_usd), 0)::numeric, COALESCE(sum(serper_requests), 0)::bigint
    INTO v_gemini, v_serper_requests
    FROM public.place_intelligence_runs;
  SELECT serper_usd_per_request::numeric INTO v_rate FROM public.city_pipeline_settings LIMIT 1;

  RETURN jsonb_build_object(
    'seeding_usd', round(v_seeding, 2),
    'photos_usd', round(v_photos, 2),
    'gemini_usd', round(v_gemini, 2),
    'serper_requests', v_serper_requests,
    'serper_usd_per_request', v_rate,
    'serper_usd', CASE WHEN v_rate IS NULL THEN NULL ELSE round(v_serper_requests * v_rate, 2) END,
    'known_usd', round(v_seeding + v_photos + v_gemini
                       + CASE WHEN v_rate IS NULL THEN 0 ELSE v_serper_requests * v_rate END, 2),
    'counted_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_place_pipeline_spend_totals() FROM PUBLIC, anon;
-- Only signed-in admins can use it: is_admin_user() is false for the service role, so
-- a grant there would only ever raise.
REVOKE ALL ON FUNCTION public.admin_place_pipeline_spend_totals() FROM service_role;
GRANT EXECUTE ON FUNCTION public.admin_place_pipeline_spend_totals() TO authenticated;

COMMENT ON FUNCTION public.admin_place_pipeline_spend_totals() IS
  'Issue #4276: recorded spend to date across every city, by provider; admins only. '
  'Serper dollars stay null until city_pipeline_settings has a rate.';

COMMIT;
