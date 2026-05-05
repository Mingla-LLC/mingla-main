-- ORCH-0684 — Extend query_person_hero_places_by_signal with joint-pair-history
-- personalization (D-Q2 Option B). Preserves ORCH-0668 perf foundation
-- (LANGUAGE sql STABLE, deferred to_jsonb hydration). Adds JOINs to saved_card +
-- user_visits filtered to (p_user_id, p_person_id) for boost computation.
-- Also projects distance_m so the edge-fn mapper has it (ORCH-0684 RC-1 fix).
--
-- INVARIANTS PRESERVED:
--   I-THREE-GATE-SERVING (DEC-053): is_servable + photo gate enforced verbatim.
--   I-PLACE-ID-CONTRACT: place JSONB carries place_pool.id::TEXT; experience_id
--     JOINs handle dual-shape (place_pool.id::TEXT OR legacy google_place_id).
--   I-POOL-ONLY-SERVING: reads place_pool + place_scores + saved_card +
--     user_visits. Zero card_pool refs.
--   I-RPC-LANGUAGE-SQL-FOR-HOT-PATH: this function remains LANGUAGE sql STABLE.
--
-- INVARIANTS REGISTERED:
--   I-PERSON-HERO-RPC-USES-USER-PARAMS: function body must reference
--     p_user_id AND p_person_id (not just declare). CI gate at
--     scripts/ci-check-invariants.sh.
--
-- BOOST WEIGHTS (D-Q2 Option B starting values; tuning is a separate ORCH):
--   viewer_save_boost  = 0.05   (modest — viewer saw it, may already be familiar)
--   paired_save_boost  = 0.10   (paired user saved it — relevant signal)
--   joint_save_boost   = 0.25   (BOTH saved → strong signal of mutual interest)
--   viewer_visit_boost = 0.05   (viewer visited — context-aware)
--   paired_visit_boost = 0.10   (paired user visited — places they liked)
--   joint_visit_boost  = 0.30   (visited TOGETHER → strongest signal)
-- Rationale: visits > saves (proven engagement), joint > individual (pair
-- relevance), boosts sum max ~0.85 vs base signal_score range typically 0.4-1.0,
-- meaning a perfectly-pair-relevant low-score place can outrank a high-score
-- unfamiliar place — desired behavior per D-Q2.

BEGIN;

-- ORCH-0684: the RETURNS TABLE shape gains 3 columns (distance_m,
-- personalization_boost, boost_reasons) vs the ORCH-0668 baseline.
-- PostgreSQL forbids CREATE OR REPLACE FUNCTION from changing return shape
-- (SQLSTATE 42P13). DROP first, then re-create. Safe inside the transaction:
-- if the CREATE below fails, the COMMIT never happens and the prior function
-- body remains live (PostgreSQL DDL is transactional).
DROP FUNCTION IF EXISTS public.query_person_hero_places_by_signal(
  UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT[], UUID[], INT, INT, INT, INT
);

CREATE OR REPLACE FUNCTION public.query_person_hero_places_by_signal(
  p_user_id              UUID,
  p_person_id            UUID,
  p_lat                  DOUBLE PRECISION,
  p_lng                  DOUBLE PRECISION,
  p_signal_ids           TEXT[],
  p_exclude_place_ids    UUID[]  DEFAULT '{}'::UUID[],
  p_initial_radius_m     INT     DEFAULT 15000,
  p_max_radius_m         INT     DEFAULT 100000,
  p_per_signal_limit     INT     DEFAULT 3,
  p_total_limit          INT     DEFAULT 9
)
RETURNS TABLE (
  place                  JSONB,
  signal_id              TEXT,
  signal_score           NUMERIC,
  total_available        BIGINT,
  distance_m             DOUBLE PRECISION,   -- ORCH-0684: projected for mapper
  personalization_boost  NUMERIC,             -- ORCH-0684: surfaced for telemetry
  boost_reasons          TEXT[]               -- ORCH-0684: debug array
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  -- ═══════════════════════════════════════════════════════════════════════
  -- ORCH-0684: pool-only progressive-radius hero RPC with joint-pair
  -- personalization. Three-gate serving preserved verbatim from ORCH-0668.
  -- Personalization is a WHERE-clause-neutral score adjustment — places that
  -- fail the gates never appear, regardless of boost. ORDER BY tiebreaks on
  -- (band_idx ASC, signal_score+boost DESC) so geographic preference still
  -- wins, but within a band the most pair-relevant places rise.
  -- ═══════════════════════════════════════════════════════════════════════
  WITH
  gate_passing AS (
    SELECT
      pp.id AS place_id,
      pp.google_place_id,
      6371000.0 * 2.0 * ASIN(SQRT(
        POWER(SIN(RADIANS(pp.lat - p_lat) / 2.0), 2) +
        COS(RADIANS(p_lat)) * COS(RADIANS(pp.lat)) *
        POWER(SIN(RADIANS(pp.lng - p_lng) / 2.0), 2)
      )) AS distance_m
    FROM public.place_pool pp
    WHERE pp.is_active = true
      AND pp.is_servable = true
      AND pp.stored_photo_urls IS NOT NULL
      AND array_length(pp.stored_photo_urls, 1) > 0
      AND pp.stored_photo_urls <> ARRAY['__backfill_failed__']::text[]
      AND NOT (pp.id = ANY(p_exclude_place_ids))
  ),
  within_max AS (
    SELECT * FROM gate_passing WHERE distance_m <= p_max_radius_m
  ),
  deduped AS (
    SELECT DISTINCT ON (w.place_id)
      w.place_id,
      w.google_place_id,
      w.distance_m,
      ps.signal_id,
      ps.score AS signal_score
    FROM within_max w
    JOIN public.place_scores ps
      ON ps.place_id = w.place_id
     AND ps.signal_id = ANY(p_signal_ids)
    ORDER BY w.place_id, ps.score DESC
  ),
  -- ─── Personalization layer (D-Q2 Option B) ──────────────────────────
  -- saved_card.experience_id is TEXT and may hold either place_pool.id::TEXT
  -- (post-ORCH-0640) or google_place_id (legacy rows). Match both shapes.
  -- p_user_id is the viewer; p_person_id is the paired user.
  saves AS (
    SELECT
      d.place_id,
      BOOL_OR(sc.profile_id = p_user_id)   AS viewer_saved,
      BOOL_OR(sc.profile_id = p_person_id) AS paired_saved
    FROM deduped d
    LEFT JOIN public.saved_card sc
      ON  sc.profile_id IN (p_user_id, p_person_id)
      AND (sc.experience_id = d.place_id::TEXT
           OR sc.experience_id = d.google_place_id)
    GROUP BY d.place_id
  ),
  visits AS (
    SELECT
      d.place_id,
      BOOL_OR(uv.user_id = p_user_id)   AS viewer_visited,
      BOOL_OR(uv.user_id = p_person_id) AS paired_visited
    FROM deduped d
    LEFT JOIN public.user_visits uv
      ON  uv.user_id IN (p_user_id, p_person_id)
      AND (uv.experience_id = d.place_id::TEXT
           OR uv.experience_id = d.google_place_id)
    GROUP BY d.place_id
  ),
  boosted AS (
    SELECT
      d.place_id,
      d.signal_id,
      d.signal_score,
      d.distance_m,
      -- Boost computation per D-Q2 Option B:
      (CASE
         WHEN COALESCE(s.viewer_saved, false) AND COALESCE(s.paired_saved, false) THEN 0.25
         WHEN COALESCE(s.paired_saved, false) THEN 0.10
         WHEN COALESCE(s.viewer_saved, false) THEN 0.05
         ELSE 0.0
       END
       +
       CASE
         WHEN COALESCE(v.viewer_visited, false) AND COALESCE(v.paired_visited, false) THEN 0.30
         WHEN COALESCE(v.paired_visited, false) THEN 0.10
         WHEN COALESCE(v.viewer_visited, false) THEN 0.05
         ELSE 0.0
       END
      ) AS personalization_boost,
      -- Debug array of which boosts fired (telemetry):
      ARRAY_REMOVE(ARRAY[
        CASE WHEN COALESCE(s.viewer_saved, false) AND COALESCE(s.paired_saved, false) THEN 'joint_save' END,
        CASE WHEN COALESCE(s.paired_saved, false) AND NOT COALESCE(s.viewer_saved, false) THEN 'paired_save' END,
        CASE WHEN COALESCE(s.viewer_saved, false) AND NOT COALESCE(s.paired_saved, false) THEN 'viewer_save' END,
        CASE WHEN COALESCE(v.viewer_visited, false) AND COALESCE(v.paired_visited, false) THEN 'joint_visit' END,
        CASE WHEN COALESCE(v.paired_visited, false) AND NOT COALESCE(v.viewer_visited, false) THEN 'paired_visit' END,
        CASE WHEN COALESCE(v.viewer_visited, false) AND NOT COALESCE(v.paired_visited, false) THEN 'viewer_visit' END
      ], NULL) AS boost_reasons
    FROM deduped d
    LEFT JOIN saves s  ON s.place_id = d.place_id
    LEFT JOIN visits v ON v.place_id = d.place_id
  ),
  ranked AS (
    SELECT
      b.place_id,
      b.signal_id,
      b.signal_score,
      b.distance_m,
      b.personalization_boost,
      b.boost_reasons,
      CASE
        WHEN b.distance_m <= LEAST(p_initial_radius_m, p_max_radius_m)::DOUBLE PRECISION       THEN 1
        WHEN b.distance_m <= LEAST((p_initial_radius_m * 3) / 2, p_max_radius_m)::DOUBLE PRECISION THEN 2
        WHEN b.distance_m <= LEAST((p_initial_radius_m * 9) / 4, p_max_radius_m)::DOUBLE PRECISION THEN 3
        WHEN b.distance_m <= LEAST((p_initial_radius_m * 27) / 8, p_max_radius_m)::DOUBLE PRECISION THEN 4
        WHEN b.distance_m <= LEAST((p_initial_radius_m * 81) / 16, p_max_radius_m)::DOUBLE PRECISION THEN 5
        ELSE 6
      END AS band_idx,
      COUNT(*) OVER () AS total_count
    FROM boosted b
  ),
  top_n AS (
    SELECT *
    FROM ranked
    ORDER BY band_idx ASC, (signal_score + personalization_boost) DESC
    LIMIT p_total_limit
  )
  SELECT
    to_jsonb(pp.*) AS place,
    t.signal_id,
    t.signal_score,
    t.total_count                AS total_available,
    t.distance_m,
    t.personalization_boost,
    t.boost_reasons
  FROM top_n t
  JOIN public.place_pool pp ON pp.id = t.place_id
  ORDER BY t.band_idx ASC, (t.signal_score + t.personalization_boost) DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.query_person_hero_places_by_signal(
  UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT[], UUID[], INT, INT, INT, INT
) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.query_person_hero_places_by_signal(
  UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT[], UUID[], INT, INT, INT, INT
) TO authenticated, service_role;

COMMENT ON FUNCTION public.query_person_hero_places_by_signal IS
  'ORCH-0684 (supersedes ORCH-0668): pool-only progressive-radius hero RPC,
   LANGUAGE sql STABLE, with D-Q2 Option B joint-pair-history personalization.
   Enforces I-THREE-GATE-SERVING. Projects distance_m + personalization_boost +
   boost_reasons for telemetry. Boost weights documented inline; tuning is a
   separate ORCH. See specs/SPEC_ORCH-0684_PAIRED_VIEW_REWIRE.md.';

COMMIT;

-- ROLLBACK: re-apply 20260428000001_orch_0668_person_hero_rpc_sql_rewrite.sql verbatim.
-- That migration is CREATE OR REPLACE and will replace this body. Verify rollback
-- by repeating perf test: 11-signal Raleigh should return < 250 ms with no
-- distance_m/personalization_boost/boost_reasons columns in projection.
