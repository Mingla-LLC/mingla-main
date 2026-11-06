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
-- the city's remaining places plus the servable places with no reviews that a redo may
-- re-judge (place_intel_places_without_reviews), with reviews fetched afresh.
--
-- THE SCORE BACKLOG STAYS HELD (Seth, 2026-11-05). A redo never re-judges a place whose
-- AI result predates ai_score_hold_since(): re-judging would write a slice dated now,
-- clear ai_slices_predate_hold, and let the score stage release the held backlog place
-- by place. place_intel_redo_state says which no-review places are held, which are
-- unchanged since a post-hold evaluation (current, so no second Gemini bill), and which
-- are eligible; only eligible ones are redone. run-place-intelligence-trial checks the
-- slices again before it queues anything.
--
-- "No reviews on record" is the same rule the Pipeline funnel counts
-- (admin_place_pipeline_funnel): no stored review, and the last fetch did not find
-- that Google has none.
--
-- Static SQL only. Rollback: DROP FUNCTION public.city_pipeline_start_plan(uuid, uuid,
-- text, numeric, text[], boolean, boolean); DROP FUNCTION
-- public.place_intel_places_without_reviews(uuid), public.admin_place_pipeline_redo_counts(),
-- public.place_intel_redo_state(uuid), public.place_intel_planned_place_ids(uuid, boolean),
-- public.place_intel_score_held(jsonb, timestamptz).

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

-- THE ONE HOLD RULE. A place is held in the score backlog when any of its AI slices was
-- evaluated before ai_score_hold_since() (ai_slices_predate_hold), or when its latest
-- completed evaluation is from before the hold. Seth keeps the backlog held, so no
-- planned run judges a held place again: the redo set, the planned Intelligence set and
-- the price shown before a run all use this one function.
CREATE OR REPLACE FUNCTION public.place_intel_score_held(p_ai_signal_scores jsonb, p_last_eval timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT public.ai_slices_predate_hold(p_ai_signal_scores) IS TRUE
      OR (p_last_eval IS NOT NULL AND p_last_eval < public.ai_score_hold_since());
$$;

REVOKE ALL ON FUNCTION public.place_intel_score_held(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_intel_score_held(jsonb, timestamptz) TO service_role;

COMMENT ON FUNCTION public.place_intel_score_held(jsonb, timestamptz) IS
  'Issue #4276: true when a place is held in the score backlog (an AI slice or its latest '
  'completed evaluation predates ai_score_hold_since()). No planned run re-judges it.';

-- Which servable places with no reviews a redo may re-judge, and which it never may.
-- Rows only for active places Explorers can see (or held after passing) that have no
-- review on record, by the funnel's rule (no stored review, and the last fetch did not
-- find that Google has none). state is one of:
--   held      the place's AI result predates the score-backlog hold: any slice evaluated
--             before ai_score_hold_since() (ai_slices_predate_hold), or its latest
--             completed evaluation (place_intelligence_trial_runs.completed_at) is from
--             before the hold. Seth keeps the backlog held, so a redo never touches it.
--   current   evaluated after the hold, and no review fetch since: its latest completed
--             evaluation is after the hold and place_review_fetch_state.last_checked_at
--             (outcome 'fetched') is not later. Re-judging it would pay Gemini again for
--             the same result.
--   eligible  never evaluated, or reviews were fetched after its post-hold evaluation.
CREATE OR REPLACE FUNCTION public.place_intel_redo_state(p_city_id uuid DEFAULT NULL)
RETURNS TABLE (place_id uuid, city_id uuid, state text, has_ai boolean)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT pp.id, pp.city_id, pp.ai_signal_scores
      FROM public.place_pool pp
      LEFT JOIN public.place_review_fetch_state f ON f.place_id = pp.id
     WHERE (p_city_id IS NULL OR pp.city_id = p_city_id)
       AND pp.city_id IS NOT NULL
       AND pp.is_active
       AND (pp.is_servable IS TRUE OR pp.held_final_check_passed IS TRUE)
       AND NOT EXISTS (SELECT 1 FROM public.place_external_reviews e WHERE e.place_pool_id = pp.id)
       AND f.outcome IS DISTINCT FROM 'none_on_google'
  ),
  evaluated AS (
    SELECT t.place_pool_id, max(t.completed_at) AS last_eval
      FROM public.place_intelligence_trial_runs t
      JOIN candidates c ON c.id = t.place_pool_id
     WHERE t.status = 'completed'
     GROUP BY t.place_pool_id
  )
  SELECT c.id,
         c.city_id,
         CASE
           WHEN public.place_intel_score_held(c.ai_signal_scores, e.last_eval)
             THEN 'held'
           WHEN e.last_eval IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM public.place_review_fetch_state f2
                WHERE f2.place_id = c.id AND f2.outcome = 'fetched' AND f2.last_checked_at > e.last_eval
             )
             THEN 'current'
           ELSE 'eligible'
         END,
         c.ai_signal_scores IS NOT NULL
    FROM candidates c
    LEFT JOIN evaluated e ON e.place_pool_id = c.id;
$$;

REVOKE ALL ON FUNCTION public.place_intel_redo_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_intel_redo_state(uuid) TO service_role;

COMMENT ON FUNCTION public.place_intel_redo_state(uuid) IS
  'Issue #4276: for servable places with no reviews, whether a redo may re-judge them '
  '(eligible), never may because the score backlog is held (held), or need not because '
  'nothing changed since their post-hold evaluation (current).';

-- The places a redo re-judges: only the eligible ones.
CREATE OR REPLACE FUNCTION public.place_intel_places_without_reviews(p_city_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(s.place_id ORDER BY s.place_id), ARRAY[]::uuid[])
    FROM public.place_intel_redo_state(p_city_id) s
   WHERE p_city_id IS NOT NULL
     AND s.state = 'eligible';
$$;

REVOKE ALL ON FUNCTION public.place_intel_places_without_reviews(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_intel_places_without_reviews(uuid) TO service_role;

COMMENT ON FUNCTION public.place_intel_places_without_reviews(uuid) IS
  'Issue #4276: the servable places with no reviews that a redo may re-judge: never ones '
  'held in the score backlog, never ones unchanged since a post-hold evaluation.';

-- The places a planned Intelligence run judges, in the order it takes them (most reviews
-- first): servable places, and places held for their first evaluation that passed the
-- final check, in the city, that are
--   * never held in the score backlog (place_intel_score_held), and
--   * not yet evaluated in this city, or, with p_include_redo, in the redo set
--     (place_intel_places_without_reviews).
-- run-place-intelligence-trial takes exactly this list for a planned run, both to price
-- it (estimate_only, which the run's preview and limits read) and to queue it, then
-- checks the slices of every id again before it queues anything.
CREATE OR REPLACE FUNCTION public.place_intel_planned_place_ids(p_city_id uuid, p_include_redo boolean DEFAULT false)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH pool AS (
    SELECT pp.id, pp.review_count, pp.ai_signal_scores
      FROM public.place_pool pp
     WHERE pp.city_id = p_city_id
       AND (pp.is_servable IS TRUE OR pp.held_final_check_passed IS TRUE)
  ),
  evaluated AS (
    SELECT t.place_pool_id,
           max(t.completed_at) AS last_eval,
           bool_or(t.city_id = p_city_id) AS in_city
      FROM public.place_intelligence_trial_runs t
      JOIN pool p ON p.id = t.place_pool_id
     WHERE t.status = 'completed'
     GROUP BY t.place_pool_id
  ),
  redo AS (
    SELECT unnest(public.place_intel_places_without_reviews(p_city_id)) AS id
     WHERE p_include_redo
  )
  SELECT COALESCE(array_agg(p.id ORDER BY p.review_count DESC NULLS LAST, p.id), ARRAY[]::uuid[])
    FROM pool p
    LEFT JOIN evaluated e ON e.place_pool_id = p.id
   WHERE NOT public.place_intel_score_held(p.ai_signal_scores, e.last_eval)
     AND (e.in_city IS NOT TRUE OR p.id IN (SELECT r.id FROM redo r));
$$;

REVOKE ALL ON FUNCTION public.place_intel_planned_place_ids(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_intel_planned_place_ids(uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.place_intel_planned_place_ids(uuid, boolean) IS
  'Issue #4276: the places a planned Intelligence run judges and prices: servable or '
  'held-passed places in the city not yet evaluated there (or in the redo set), never '
  'places held in the score backlog.';

-- Per city, for the Pipeline gaps table: how many no-review places a pick may reach and
-- how many sit in the held backlog. Admins only.
CREATE OR REPLACE FUNCTION public.admin_place_pipeline_redo_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_object_agg(x.city_id, jsonb_build_object(
      'reviews_eligible', x.reviews_eligible,
      'reviews_held', x.reviews_held,
      'redo_eligible', x.redo_eligible,
      'redo_held', x.redo_held
    ))
    FROM (
      SELECT s.city_id,
             count(*) FILTER (WHERE s.state = 'eligible') AS reviews_eligible,
             count(*) FILTER (WHERE s.state = 'held') AS reviews_held,
             count(*) FILTER (WHERE s.state = 'eligible' AND s.has_ai) AS redo_eligible,
             count(*) FILTER (WHERE s.state = 'held' AND s.has_ai) AS redo_held
        FROM public.place_intel_redo_state(NULL) s
       GROUP BY s.city_id
    ) x
  ), '{}'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_place_pipeline_redo_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_place_pipeline_redo_counts() TO authenticated;

COMMENT ON FUNCTION public.admin_place_pipeline_redo_counts() IS
  'Issue #4276: per city, the no-review places a pick may reach and those held in the '
  'score backlog, for the Pipeline gaps table. Admins only.';

COMMIT;
