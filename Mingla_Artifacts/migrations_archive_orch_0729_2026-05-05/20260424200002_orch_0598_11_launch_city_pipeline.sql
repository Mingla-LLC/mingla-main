-- ORCH-0598.11 — Launch-City Pipeline: RLS tightening + RPC two-gate + photo-backfill mode + admin_config hygiene
--
-- Spec: Mingla_Artifacts/outputs/SPEC_ORCH-0598.11_LAUNCH_CITY_PIPELINE.md
-- Investigation: Mingla_Artifacts/outputs/INVESTIGATION_ORCH-0598.11_LAUNCH_CITY_PIPELINE_REPORT.md
--
-- Establishes invariants:
--   I-SERVING-TWO-GATE              — every consumer query gates on `is_servable=true AND has-real-photos`
--   I-PHOTO-FILTER-EXPLICIT         — photos backfill has exactly two named modes (initial / refresh_servable)
--   I-PLACE-POOL-ADMIN-WRITE-ONLY   — no non-admin role may UPDATE place_pool
--
-- Idempotent. Run via `supabase db push` (NEVER via mcp__supabase__apply_migration).

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. RLS — close the open authenticated-update hole on place_pool (SEC-001)
--    The existing `admin_update_place_pool` policy stays (admin-only via
--    admin_users membership). The dropped policy was a catch-all `qual: true`
--    that allowed any authenticated user to mutate any place_pool row.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS authenticated_update_place_pool ON public.place_pool;

-- Assertion: admin_update_place_pool must remain. If a future migration drops
-- it without restoring an equivalent admin gate, this DO-block fires and the
-- deploy fails. I-PLACE-POOL-ADMIN-WRITE-ONLY enforcement.
DO $$
DECLARE
  v_update_policy_count int;
BEGIN
  SELECT count(*) INTO v_update_policy_count
  FROM pg_policies
  WHERE tablename = 'place_pool'
    AND cmd = 'UPDATE'
    AND policyname != 'service_role_all_place_pool';
  IF v_update_policy_count = 0 THEN
    RAISE EXCEPTION 'ORCH-0598.11 migration: no UPDATE policy remains on place_pool besides service_role. admin_update_place_pool must exist.';
  END IF;
  IF v_update_policy_count > 1 THEN
    RAISE NOTICE 'ORCH-0598.11 migration: more than one non-service_role UPDATE policy on place_pool. Inspect pg_policies.';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. query_pool_cards RPC — add two-gate predicate (RC-002 leak fix)
--    Adds: is_servable=true AND real-stored-photos to BOTH the count subquery
--    AND the filtered CTE. The ai_approved clause is RETAINED as belt-and-
--    suspenders during a 14-day soak window; remove in D-002 deprecation.
--    Pattern: NOT EXISTS / EXISTS subqueries on `pp_gate` alias to avoid
--    introducing JOIN-induced row duplication.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.query_pool_cards(
  p_user_id uuid,
  p_categories text[],
  p_lat_min double precision,
  p_lat_max double precision,
  p_lng_min double precision,
  p_lng_max double precision,
  p_card_type text DEFAULT 'single'::text,
  p_experience_type text DEFAULT NULL::text,
  p_exclude_card_ids uuid[] DEFAULT '{}'::uuid[],
  p_limit integer DEFAULT 200,
  p_exclude_place_ids text[] DEFAULT '{}'::text[],
  p_center_lat double precision DEFAULT NULL::double precision,
  p_center_lng double precision DEFAULT NULL::double precision,
  p_max_distance_km double precision DEFAULT NULL::double precision
) RETURNS TABLE(card jsonb, total_unseen bigint)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_total_unseen BIGINT;
  v_has_place_exclusions BOOLEAN := (array_length(p_exclude_place_ids, 1) IS NOT NULL AND array_length(p_exclude_place_ids, 1) > 0);
  v_use_haversine BOOLEAN := (p_center_lat IS NOT NULL AND p_center_lng IS NOT NULL AND p_max_distance_km IS NOT NULL);
  v_excluded_types TEXT[] := ARRAY['gym', 'fitness_center', 'dog_park', 'school', 'primary_school', 'secondary_school', 'university', 'preschool'];
  v_hidden_categories TEXT[] := ARRAY['groceries', 'flowers'];
  v_slug_categories TEXT[];
  v_num_categories INTEGER;
  v_per_category_cap INTEGER;
BEGIN
  -- ORCH-0443: Normalize category inputs to canonical slugs.
  -- Accepts both display names ("Upscale & Fine Dining") and slugs ("upscale_fine_dining").
  IF p_categories IS NULL OR array_length(p_categories, 1) IS NULL THEN
    v_slug_categories := '{}';
  ELSE
    SELECT COALESCE(array_agg(DISTINCT slug), '{}') INTO v_slug_categories
    FROM (
      SELECT CASE lower(trim(val))
        WHEN 'nature'                  THEN 'nature'
        WHEN 'nature & views'          THEN 'nature'
        WHEN 'nature_views'            THEN 'nature'
        WHEN 'icebreakers'             THEN 'icebreakers'
        WHEN 'drinks_and_music'        THEN 'drinks_and_music'
        WHEN 'drinks & music'          THEN 'drinks_and_music'
        WHEN 'brunch_lunch_casual'     THEN 'brunch_lunch_casual'
        WHEN 'brunch, lunch & casual'  THEN 'brunch_lunch_casual'
        WHEN 'upscale_fine_dining'     THEN 'upscale_fine_dining'
        WHEN 'upscale & fine dining'   THEN 'upscale_fine_dining'
        WHEN 'movies_theatre'          THEN 'movies_theatre'
        WHEN 'movies & theatre'        THEN 'movies_theatre'
        WHEN 'creative_arts'           THEN 'creative_arts'
        WHEN 'creative & arts'         THEN 'creative_arts'
        WHEN 'play'                    THEN 'play'
        WHEN 'flowers'                 THEN 'flowers'
        WHEN 'groceries'               THEN 'groceries'
        ELSE NULL
      END AS slug
      FROM unnest(p_categories) AS val
    ) sub
    WHERE slug IS NOT NULL;
  END IF;

  v_num_categories := GREATEST(COALESCE(array_length(v_slug_categories, 1), 0), 1);
  v_per_category_cap := CEIL(p_limit::float / v_num_categories);

  -- ── Count total matching cards ──
  SELECT COUNT(*) INTO v_total_unseen
  FROM (
    SELECT DISTINCT ON (COALESCE(cp.google_place_id, cp.id::TEXT)) cp.id
    FROM public.card_pool cp
    WHERE cp.is_active = true
      AND cp.card_type = p_card_type
      -- ORCH-0598.11 I-SERVING-TWO-GATE: place_pool peer must be Bouncer-approved
      -- AND have real downloaded photos. Closes 2,164-card leak (Cary/Durham/Apex
      -- pre-Bouncer cards bypassing serving). Single owner: run-bouncer for
      -- is_servable; backfill-place-photos for stored_photo_urls.
      AND EXISTS (
        SELECT 1 FROM public.place_pool pp_gate
        WHERE pp_gate.id = cp.place_pool_id
          AND pp_gate.is_servable = true
          AND pp_gate.stored_photo_urls IS NOT NULL
          AND array_length(pp_gate.stored_photo_urls, 1) > 0
          AND NOT (
            array_length(pp_gate.stored_photo_urls, 1) = 1
            AND pp_gate.stored_photo_urls[1] = '__backfill_failed__'
          )
      )
      AND (v_slug_categories = '{}' OR cp.categories && v_slug_categories)
      AND cp.lat BETWEEN p_lat_min AND p_lat_max
      AND cp.lng BETWEEN p_lng_min AND p_lng_max
      AND (
        NOT v_use_haversine
        OR (
          6371 * 2 * ASIN(SQRT(
            POWER(SIN(RADIANS(cp.lat - p_center_lat) / 2), 2) +
            COS(RADIANS(p_center_lat)) * COS(RADIANS(cp.lat)) *
            POWER(SIN(RADIANS(cp.lng - p_center_lng) / 2), 2)
          )) <= p_max_distance_km
        )
      )
      AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
      AND cp.id != ALL(p_exclude_card_ids)
      AND (NOT v_has_place_exclusions OR cp.google_place_id IS NULL OR cp.google_place_id != ALL(p_exclude_place_ids))
      AND NOT EXISTS (
        SELECT 1 FROM public.place_pool pp
        WHERE pp.id = cp.place_pool_id AND pp.types && v_excluded_types
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.card_pool_stops cps
        JOIN public.place_pool pp ON pp.id = cps.place_pool_id
        WHERE cps.card_pool_id = cp.id AND cp.place_pool_id IS NULL AND pp.types && v_excluded_types
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.place_pool pp, public.category_type_exclusions cte
        WHERE pp.id = cp.place_pool_id AND cte.category_slug = ANY(cp.categories) AND cte.excluded_type = ANY(pp.types)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.card_pool_stops cps
        JOIN public.place_pool pp ON pp.id = cps.place_pool_id, public.category_type_exclusions cte
        WHERE cps.card_pool_id = cp.id AND cp.place_pool_id IS NULL AND cte.category_slug = ANY(cp.categories) AND cte.excluded_type = ANY(pp.types)
      )
      AND NOT (cp.categories <@ v_hidden_categories)
      -- [TRANSITIONAL] ai_approved clause retained as belt-and-suspenders during
      -- 14d soak window post-deploy. Exit condition: D-002 deprecation charter
      -- (drop ai_approved from quality predicate after 2026-05-09).
      AND (
        cp.ai_override = true
        OR (cp.card_type = 'single' AND EXISTS (
          SELECT 1 FROM public.place_pool pp WHERE pp.id = cp.place_pool_id AND pp.ai_approved = true
        ))
        OR (cp.card_type = 'curated' AND NOT EXISTS (
          SELECT 1 FROM public.card_pool_stops cps
          JOIN public.place_pool pp ON pp.id = cps.place_pool_id
          WHERE cps.card_pool_id = cp.id AND (pp.ai_approved IS NULL OR pp.ai_approved = false)
        ))
      )
    ORDER BY COALESCE(cp.google_place_id, cp.id::TEXT), cp.popularity_score DESC
  ) matching_count;

  -- ── Return filtered, deduped, ranked, enriched cards ──
  RETURN QUERY
  WITH
  filtered AS (
    SELECT cp.*
    FROM public.card_pool cp
    WHERE cp.is_active = true
      AND cp.card_type = p_card_type
      -- ORCH-0598.11 I-SERVING-TWO-GATE (mirror of count subquery — keep in sync)
      AND EXISTS (
        SELECT 1 FROM public.place_pool pp_gate
        WHERE pp_gate.id = cp.place_pool_id
          AND pp_gate.is_servable = true
          AND pp_gate.stored_photo_urls IS NOT NULL
          AND array_length(pp_gate.stored_photo_urls, 1) > 0
          AND NOT (
            array_length(pp_gate.stored_photo_urls, 1) = 1
            AND pp_gate.stored_photo_urls[1] = '__backfill_failed__'
          )
      )
      AND (v_slug_categories = '{}' OR cp.categories && v_slug_categories)
      AND cp.lat BETWEEN p_lat_min AND p_lat_max
      AND cp.lng BETWEEN p_lng_min AND p_lng_max
      AND (
        NOT v_use_haversine
        OR (
          6371 * 2 * ASIN(SQRT(
            POWER(SIN(RADIANS(cp.lat - p_center_lat) / 2), 2) +
            COS(RADIANS(p_center_lat)) * COS(RADIANS(cp.lat)) *
            POWER(SIN(RADIANS(cp.lng - p_center_lng) / 2), 2)
          )) <= p_max_distance_km
        )
      )
      AND (p_experience_type IS NULL OR cp.experience_type = p_experience_type)
      AND cp.id != ALL(p_exclude_card_ids)
      AND (NOT v_has_place_exclusions OR cp.google_place_id IS NULL OR cp.google_place_id != ALL(p_exclude_place_ids))
      AND NOT EXISTS (SELECT 1 FROM public.place_pool pp WHERE pp.id = cp.place_pool_id AND pp.types && v_excluded_types)
      AND NOT EXISTS (SELECT 1 FROM public.card_pool_stops cps JOIN public.place_pool pp ON pp.id = cps.place_pool_id WHERE cps.card_pool_id = cp.id AND cp.place_pool_id IS NULL AND pp.types && v_excluded_types)
      AND NOT EXISTS (SELECT 1 FROM public.place_pool pp, public.category_type_exclusions cte WHERE pp.id = cp.place_pool_id AND cte.category_slug = ANY(cp.categories) AND cte.excluded_type = ANY(pp.types))
      AND NOT EXISTS (SELECT 1 FROM public.card_pool_stops cps JOIN public.place_pool pp ON pp.id = cps.place_pool_id, public.category_type_exclusions cte WHERE cps.card_pool_id = cp.id AND cp.place_pool_id IS NULL AND cte.category_slug = ANY(cp.categories) AND cte.excluded_type = ANY(pp.types))
      AND NOT (cp.categories <@ v_hidden_categories)
      AND (cp.ai_override = true OR (cp.card_type = 'single' AND EXISTS (SELECT 1 FROM public.place_pool pp WHERE pp.id = cp.place_pool_id AND pp.ai_approved = true)) OR (cp.card_type = 'curated' AND NOT EXISTS (SELECT 1 FROM public.card_pool_stops cps JOIN public.place_pool pp ON pp.id = cps.place_pool_id WHERE cps.card_pool_id = cp.id AND (pp.ai_approved IS NULL OR pp.ai_approved = false))))
  ),
  deduped AS (
    SELECT DISTINCT ON (COALESCE(f.google_place_id, f.id::TEXT)) f.*
    FROM filtered f
    ORDER BY COALESCE(f.google_place_id, f.id::TEXT), f.popularity_score DESC
  ),
  ranked AS (
    SELECT d.*,
      ROW_NUMBER() OVER (PARTITION BY d.category ORDER BY d.popularity_score DESC) AS cat_rank,
      ROW_NUMBER() OVER (PARTITION BY d.category ORDER BY d.popularity_score DESC) AS cat_position
    FROM deduped d
  ),
  enriched AS (
    SELECT r.*,
      pp.stored_photo_urls,
      pp.photos,
      COALESCE(NULLIF(r.website, ''), NULLIF(pp.website, '')) AS resolved_website
    FROM ranked r
    LEFT JOIN public.place_pool pp ON pp.id = r.place_pool_id
    WHERE r.cat_rank <= v_per_category_cap
  )
  SELECT
    CASE
      WHEN e.resolved_website IS NOT NULL AND (e.website IS NULL OR e.website = '')
      THEN to_jsonb(e.*) - 'resolved_website' - 'cat_rank' - 'cat_position' || jsonb_build_object('website', e.resolved_website)
      ELSE to_jsonb(e.*) - 'resolved_website' - 'cat_rank' - 'cat_position'
    END AS card,
    v_total_unseen AS total_unseen
  FROM enriched e
  ORDER BY e.cat_position ASC, e.popularity_score DESC
  LIMIT p_limit;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.query_pool_cards(uuid, text[], double precision, double precision, double precision, double precision, text, text, uuid[], integer, text[], double precision, double precision, double precision) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.query_pool_cards(uuid, text[], double precision, double precision, double precision, double precision, text, text, uuid[], integer, text[], double precision, double precision, double precision) TO service_role;

COMMENT ON FUNCTION public.query_pool_cards IS
  'ORCH-0598.11: two-gate serving predicate (is_servable=true AND real stored_photo_urls AND ai_approved-via-existing-clause). Was single-gate ai_approved-only. ai_approved retained 14d as belt-and-suspenders; remove in D-002 deprecation post 2026-05-09.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. photo_backfill_runs.mode column — I-PHOTO-FILTER-EXPLICIT
--    Adds enum-checked mode column so photo backfill runs are explicitly
--    one of two modes: 'initial' (filter ai_approved) or 'refresh_servable'
--    (filter is_servable). Default 'initial' for backward compat with any
--    in-flight runs. New runs from the updated UI will set mode explicitly.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.photo_backfill_runs
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'initial';

-- Add CHECK constraint separately so re-running the migration on a DB that
-- already has the column (with default 'initial') doesn't fail.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'photo_backfill_runs_mode_check'
      AND conrelid = 'public.photo_backfill_runs'::regclass
  ) THEN
    ALTER TABLE public.photo_backfill_runs
      ADD CONSTRAINT photo_backfill_runs_mode_check
      CHECK (mode IN ('initial', 'refresh_servable'));
  END IF;
END $$;

COMMENT ON COLUMN public.photo_backfill_runs.mode IS
  'ORCH-0598.11: explicit eligibility filter — initial=ai_approved-with-no-photos (first-time city setup); refresh_servable=is_servable=true (Bouncer-approved maintenance). I-PHOTO-FILTER-EXPLICIT.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. admin_config cohort hygiene (D-006 from investigation)
--    Three new vibe signals shipped this session (lively/scenic/picnic_friendly)
--    were missing from admin_config.signal_serving_<id>_pct entries. They are
--    rank-only (not chip-mapped) so this doesn't affect serving — pure hygiene.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.admin_config (key, value)
VALUES
  ('signal_serving_lively_pct', '100'::jsonb),
  ('signal_serving_scenic_pct', '100'::jsonb),
  ('signal_serving_picnic_friendly_pct', '100'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (for emergency revert — execute manually if needed)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- BEGIN;
--
-- -- Restore prior query_pool_cards (pre-two-gate) — copy body verbatim from
-- -- migration 20260309000007_fix_pool_website_coalesce.sql.
-- -- (Not inlined here to avoid keeping two divergent versions in tree.)
--
-- -- Restore the open authenticated UPDATE policy (DO NOT DO THIS unless you
-- -- have a specific reason — it's a security regression).
-- CREATE POLICY authenticated_update_place_pool ON public.place_pool
--   FOR UPDATE TO authenticated USING (true);
--
-- -- Drop the mode column (only safe if no rows depend on it; typically leave
-- -- in place — additive column, harmless).
-- ALTER TABLE public.photo_backfill_runs DROP CONSTRAINT IF EXISTS photo_backfill_runs_mode_check;
-- ALTER TABLE public.photo_backfill_runs DROP COLUMN IF EXISTS mode;
--
-- -- Remove the cohort hygiene rows (also additive — typically leave in place).
-- DELETE FROM public.admin_config WHERE key IN (
--   'signal_serving_lively_pct',
--   'signal_serving_scenic_pct',
--   'signal_serving_picnic_friendly_pct'
-- );
--
-- COMMIT;
