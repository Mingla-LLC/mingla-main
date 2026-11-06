-- Issue #4276: two guards around the city pipeline's final steps.
--
-- 1. The final-score stage never hands the scorer a place whose AI result predates the
--    backlog hold. city_pipeline_places_to_score used to pick places by trial status
--    alone, so a trial row that completed without rewriting place_pool.ai_signal_scores
--    (the slice write is non-fatal) sent a 2026-09 slice to be blended into a live
--    score. A place with any AI slice evaluated before the hold date, or with no
--    evaluated_at, is now left out. The date has one SQL home,
--    public.ai_score_hold_since(); the 15-minute rescore selector keeps its literal, and
--    the pg proof pins the two equal (the scorer's TypeScript constant is pinned by a
--    Deno test against this file).
--
-- 2. Release is the only way from held to live. Clearing serving_hold outside
--    city_pipeline_release_places is refused with PT409. The release sets a
--    transaction-local flag for the length of its two updates. Nothing else in the code
--    base clears serving_hold; the final check, admin edits and business-owner updates
--    never touch it, and a held place's is_servable is already kept away from true.
--
-- Invariant I-4276-SCORE-STAGE-NEVER-RELEASES-HELD-AI is declared in its contract test under __tests__/.
-- Invariant I-4276-RELEASE-ONLY-PATH-TO-LIVE is declared in its contract test under __tests__/.
--
-- Rollback: restore city_pipeline_places_to_score, tg_place_pool_serving_hold and
-- city_pipeline_release_places from 20280410034276_issue_4276_city_pipeline_conductor.sql
-- and DROP FUNCTION public.ai_score_hold_since(), public.ai_slices_predate_hold(jsonb).

BEGIN;

-- ── The hold date ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ai_score_hold_since()
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  -- BACKLOG HOLD (#4276). Same instant as pg_meta_orch_1009_sub_d_select_stale_pairs
  -- and AI_SCORE_HOLD_SINCE in supabase/functions/_shared/aiScoreHold.ts.
  SELECT TIMESTAMPTZ '2026-11-05 00:00:00+00';
$$;

-- True when any AI slice on the place was evaluated before the hold, or carries no
-- evaluated_at at all. NULL or empty AI is not held: there is nothing to blend.
CREATE OR REPLACE FUNCTION public.ai_slices_predate_hold(p_ai jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(bool_or(
           (s.slice ->> 'evaluated_at') IS NULL
           OR (s.slice ->> 'evaluated_at')::timestamptz < public.ai_score_hold_since()
         ), false)
  FROM jsonb_each(CASE WHEN jsonb_typeof(p_ai) = 'object' THEN p_ai ELSE '{}'::jsonb END) AS s (signal_id, slice);
$$;

-- ── 1. The final-score selector ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.city_pipeline_places_to_score(
  p_run_id uuid,
  p_after_id uuid,
  p_limit integer
)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH run AS (
    SELECT r.id, r.city_id, r.rules_only FROM public.city_pipeline_runs r WHERE r.id = p_run_id
  ),
  intel AS (
    SELECT (x.value)::uuid AS parent_run_id
    FROM public.city_pipeline_stages s
    JOIN run ON run.id = s.run_id
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s.refs -> 'intel_run_ids', '[]'::jsonb)) AS x (value)
    WHERE s.stage = 'intelligence'
  ),
  evaluated AS (
    SELECT DISTINCT t.place_pool_id AS id
    FROM public.place_intelligence_trial_runs t
    JOIN intel ON intel.parent_run_id = t.parent_run_id
    WHERE t.status = 'completed'
  ),
  wanted AS (
    SELECT pp.id
    FROM public.place_pool pp
    JOIN run ON run.city_id = pp.city_id
    WHERE pp.is_active AND pp.serving_hold AND pp.held_final_check_passed
      AND (run.rules_only OR pp.ai_signal_scores IS NOT NULL)
    UNION
    SELECT e.id FROM evaluated e
    JOIN public.place_pool pp ON pp.id = e.id
    WHERE pp.is_active AND (pp.is_servable IS TRUE OR pp.held_final_check_passed IS TRUE)
  )
  SELECT COALESCE(array_agg(w.id ORDER BY w.id), ARRAY[]::uuid[])
  FROM (
    SELECT wanted.id FROM wanted
    JOIN public.place_pool pp ON pp.id = wanted.id
    -- #4276: an AI result from before the hold never reaches the scorer from here.
    WHERE NOT public.ai_slices_predate_hold(pp.ai_signal_scores)
      AND (p_after_id IS NULL OR wanted.id > p_after_id)
    ORDER BY wanted.id
    LIMIT p_limit
  ) w;
$$;

-- ── 2. Release is the only path from held to live ──────────────────────────
CREATE OR REPLACE FUNCTION public.tg_place_pool_serving_hold()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.serving_hold AND NOT NEW.serving_hold THEN
    IF COALESCE(current_setting('mingla.city_pipeline_release', true), '') <> 'on' THEN
      RAISE EXCEPTION 'place % is held; only city_pipeline_release_places can release it', OLD.id
        USING ERRCODE = 'PT409';
    END IF;
    NEW.held_final_check_passed := NULL;
    RETURN NEW;
  END IF;
  IF NOT NEW.serving_hold THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NOT OLD.serving_hold THEN
    IF OLD.is_servable IS TRUE THEN
      RAISE EXCEPTION 'place % is live, so it cannot be held', OLD.id USING ERRCODE = 'PT409';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.is_servable IS TRUE THEN
    NEW.held_final_check_passed := true;
    NEW.is_servable := false;
  ELSIF NEW.is_servable IS FALSE THEN
    NEW.held_final_check_passed := false;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_place_pool_serving_hold() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.city_pipeline_release_places(p_city_id uuid, p_rules_only boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rejected integer;
  v_released integer;
  v_unfinished integer;
BEGIN
  -- Transaction-local: the flag lives only for this call's transaction.
  PERFORM set_config('mingla.city_pipeline_release', 'on', true);

  UPDATE public.place_pool
     SET is_servable = false, serving_hold = false
   WHERE city_id = p_city_id AND serving_hold AND held_final_check_passed IS FALSE;
  GET DIAGNOSTICS v_rejected = ROW_COUNT;

  UPDATE public.place_pool
     SET is_servable = true, serving_hold = false
   WHERE city_id = p_city_id AND serving_hold AND held_final_check_passed
     AND (p_rules_only OR ai_signal_scores IS NOT NULL);
  GET DIAGNOSTICS v_released = ROW_COUNT;

  PERFORM set_config('mingla.city_pipeline_release', 'off', true);

  SELECT count(*) INTO v_unfinished
    FROM public.place_pool
   WHERE city_id = p_city_id AND serving_hold;

  RETURN jsonb_build_object('released', v_released, 'rejected', v_rejected, 'unfinished', v_unfinished);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_score_hold_since() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_slices_predate_hold(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.city_pipeline_places_to_score(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.city_pipeline_release_places(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_score_hold_since() TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_slices_predate_hold(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.city_pipeline_places_to_score(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.city_pipeline_release_places(uuid, boolean) TO service_role;

COMMIT;
