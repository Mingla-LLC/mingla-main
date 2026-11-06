-- Issue #4276 (round 3): a run does only the stages a person picked.
--
-- The Place pool screen lets a person pick gaps for one city. run-city-pipeline turns
-- the picks into a stage list (supabase/functions/run-city-pipeline/plan.ts: the picked
-- stages, what each needs first, and what follows Intelligence) and starts the run with
-- city_pipeline_start_plan. Every stage not on the list is created as skipped, in the
-- same transaction as the run, so no tick can ever see the run with stages it was not
-- asked to do. city_pipeline_start, used when there is no stage list, is unchanged.
--
-- A redo (redoIntelligence) is written onto the Intelligence stage's cursor as
-- {"plan": true, "redo": true}. The conductor then asks run-place-intelligence-trial for
-- the city's remaining places plus the servable places that have no reviews on record
-- (place_intel_places_without_reviews), with reviews fetched afresh.
--
-- "No reviews on record" is the same rule the Pipeline funnel counts
-- (admin_place_pipeline_funnel): no stored review, and the last fetch did not find
-- that Google has none.
--
-- Static SQL only. Rollback: DROP FUNCTION public.city_pipeline_start_plan(uuid, uuid,
-- text, numeric, text[], boolean, boolean); DROP FUNCTION
-- public.place_intel_places_without_reviews(uuid).

BEGIN;

CREATE OR REPLACE FUNCTION public.city_pipeline_start_plan(
  p_city_id uuid,
  p_started_by uuid,
  p_scope text,
  p_spend_limit_usd numeric,
  p_stages text[],
  p_redo_intelligence boolean DEFAULT false,
  p_rules_only boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
  v_first text;
BEGIN
  IF p_stages IS NULL OR cardinality(p_stages) = 0 THEN
    RAISE EXCEPTION 'a planned run needs at least one stage' USING ERRCODE = '22023';
  END IF;
  IF NOT p_stages <@ ARRAY['box', 'fill', 'split', 'completeness', 'pre_check', 'photos',
                            'final_check', 'intelligence', 'score', 'release', 'thumbnails']::text[] THEN
    RAISE EXCEPTION 'unknown stage in %', p_stages USING ERRCODE = '22023';
  END IF;
  IF p_redo_intelligence AND NOT ('intelligence' = ANY (p_stages)) THEN
    RAISE EXCEPTION 'a redo needs the intelligence stage' USING ERRCODE = '22023';
  END IF;

  -- The run and all eleven stages, exactly as an unplanned run starts them.
  v_run_id := public.city_pipeline_start(p_city_id, p_started_by, p_scope, p_spend_limit_usd, false, p_rules_only);

  UPDATE public.city_pipeline_stages
     SET status = 'skipped'
   WHERE run_id = v_run_id
     AND NOT (stage = ANY (p_stages));

  UPDATE public.city_pipeline_stages
     SET cursor = cursor || jsonb_build_object('plan', true, 'redo', p_redo_intelligence)
   WHERE run_id = v_run_id
     AND stage = 'intelligence';

  SELECT s.stage INTO v_first
    FROM public.city_pipeline_stages s
   WHERE s.run_id = v_run_id AND s.status = 'pending'
   ORDER BY s.ord
   LIMIT 1;

  UPDATE public.city_pipeline_runs
     SET current_stage = v_first
   WHERE id = v_run_id;

  RETURN v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.city_pipeline_start_plan(uuid, uuid, text, numeric, text[], boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.city_pipeline_start_plan(uuid, uuid, text, numeric, text[], boolean, boolean) TO service_role;

COMMENT ON FUNCTION public.city_pipeline_start_plan(uuid, uuid, text, numeric, text[], boolean, boolean) IS
  'Issue #4276: starts a run that does only the given stages (the rest are skipped) and, '
  'with p_redo_intelligence, redoes Intelligence for servable places with no reviews.';

CREATE OR REPLACE FUNCTION public.place_intel_places_without_reviews(p_city_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(pp.id ORDER BY pp.id), ARRAY[]::uuid[])
    FROM public.place_pool pp
    LEFT JOIN public.place_review_fetch_state f ON f.place_id = pp.id
   WHERE pp.city_id = p_city_id
     AND pp.is_active
     AND (pp.is_servable IS TRUE OR pp.held_final_check_passed IS TRUE)
     AND NOT EXISTS (SELECT 1 FROM public.place_external_reviews e WHERE e.place_pool_id = pp.id)
     AND f.outcome IS DISTINCT FROM 'none_on_google';
$$;

REVOKE ALL ON FUNCTION public.place_intel_places_without_reviews(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_intel_places_without_reviews(uuid) TO service_role;

COMMENT ON FUNCTION public.place_intel_places_without_reviews(uuid) IS
  'Issue #4276: places Explorers can see (or held after passing) with no review on record, '
  'for a run that redoes Intelligence with fresh reviews.';

COMMIT;
