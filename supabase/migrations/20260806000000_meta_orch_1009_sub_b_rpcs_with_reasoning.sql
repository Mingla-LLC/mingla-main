-- META-ORCH-1009 Sub-B — extend consumer-deck RPCs with AI reasoning
--
-- WHAT THIS MIGRATION DOES
--   Replaces two SECURITY DEFINER SQL functions that the consumer-deck pipeline
--   uses to fetch servable places by signal:
--     • query_servable_places_by_signal             (solo Home + curated)
--     • query_servable_places_by_signal_intersection (collab positional deck)
--   Each function now returns TWO additional columns:
--     • ai_reasoning   jsonb    — the full 6-key per-signal slice of
--                                 place_pool.ai_signal_scores (or NULL when
--                                 the place is unevaluated for this signal).
--     • ai_score_raw   numeric  — convenience: ai_reasoning ->> 'score_0_to_100'
--                                 cast to numeric, for admin inspector visibility.
--
-- WHY
--   Sub-B's user-felt moment is "Why we picked this for you" on the card back.
--   discover-cards + generate-curated-experiences read these RPCs already, so
--   surfacing the per-signal Gemini Q2 reasoning here means the consumer mobile
--   gets it via the existing card payload spread — no new RPC call, no extra
--   round-trip. The blend lives in signalScorer.computeScore (write-time, in
--   place_scores.score); the reasoning column is information-only and does NOT
--   influence card ORDER BY — preserving I-COLLAB-DECK-DETERMINISM-PRESERVED-
--   UNDER-AI-BLEND.
--
-- SHAPE & ORDER PRESERVED
--   All existing 19 columns kept in the same order. The two new columns are
--   appended at the end so positional tuple consumers (none today) wouldn't
--   regress. TS-side callers spread the row → backward compatible.
--
-- AUTHORITY
--   • I-AI-SIGNAL-SCORES-SHAPE-CONTRACT (ACTIVE post-Sub-A)  — the JSONB shape
--     this column surfaces is the 6-key contract Sub-A's writer pins.
--   • I-CONSUMER-READS-AI-SIGNAL-SCORES-NOT-TRIAL-TABLE (ACTIVE post-Sub-B) —
--     the column is sourced ONLY from place_pool.ai_signal_scores, never from
--     place_intelligence_trial_runs.
--
-- DETERMINISM
--   ORDER BY clause unchanged: `ps.score DESC, pp.review_count DESC NULLS LAST`
--   on the solo function, `ps.score DESC, pp.review_count DESC NULLS LAST,
--   pp.id ASC` on the intersection function. The new ai_reasoning column is a
--   pure function of place_pool state → identical inputs produce identical
--   outputs across calls in the same session V_n.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. query_servable_places_by_signal — solo Home + curated
-- ─────────────────────────────────────────────────────────────────────────────

-- Postgres rejects CREATE OR REPLACE FUNCTION when the return TABLE shape
-- changes (SQLSTATE 42P13 "cannot change return type of existing function").
-- We're appending 2 new columns (ai_reasoning + ai_score_raw) so we must
-- DROP first. No DB-level dependents (the deck edge fns call these at
-- runtime, not as DB-managed dependencies) so plain DROP IF EXISTS is safe.
DROP FUNCTION IF EXISTS public.query_servable_places_by_signal(text, numeric, double precision, double precision, double precision, uuid[], integer);

CREATE OR REPLACE FUNCTION public.query_servable_places_by_signal(
  p_signal_id text,
  p_filter_min numeric,
  p_lat double precision,
  p_lng double precision,
  p_radius_m double precision,
  p_exclude_place_ids uuid[] DEFAULT '{}'::uuid[],
  p_limit integer DEFAULT 20
) RETURNS TABLE(
  place_id uuid,
  google_place_id text,
  name text,
  address text,
  lat double precision,
  lng double precision,
  rating numeric,
  review_count integer,
  price_level text,
  price_range_start_cents integer,
  price_range_end_cents integer,
  opening_hours jsonb,
  website text,
  photos jsonb,
  stored_photo_urls text[],
  types text[],
  primary_type text,
  signal_score numeric,
  signal_contributions jsonb,
  -- META-ORCH-1009 Sub-B (NEW):
  ai_reasoning jsonb,
  ai_score_raw numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    pp.id AS place_id,
    pp.google_place_id,
    pp.name,
    pp.address,
    pp.lat,
    pp.lng,
    pp.rating,
    pp.review_count,
    pp.price_level,
    pp.price_range_start_cents,
    pp.price_range_end_cents,
    pp.opening_hours,
    pp.website,
    pp.photos,
    pp.stored_photo_urls,
    pp.types,
    pp.primary_type,
    ps.score AS signal_score,
    ps.contributions AS signal_contributions,
    -- META-ORCH-1009 Sub-B: surface the per-signal AI evaluation slice for the
    -- "Why we picked this for you" expand-modal section. NULL when the place
    -- is unevaluated for this signal (Sub-C is backfilling coverage).
    pp.ai_signal_scores -> p_signal_id AS ai_reasoning,
    NULLIF((pp.ai_signal_scores -> p_signal_id ->> 'score_0_to_100'), '')::numeric AS ai_score_raw
  FROM public.place_pool pp
  JOIN public.place_scores ps
    ON ps.place_id = pp.id
   AND ps.signal_id = p_signal_id
  WHERE pp.is_servable = true
    AND pp.is_active = true
    AND ps.score >= p_filter_min
    AND pp.stored_photo_urls IS NOT NULL
    AND array_length(pp.stored_photo_urls, 1) > 0
    AND NOT (
      array_length(pp.stored_photo_urls, 1) = 1
      AND pp.stored_photo_urls[1] = '__backfill_failed__'
    )
    AND (
      6371000.0 * 2.0 * ASIN(SQRT(
        POWER(SIN(RADIANS(pp.lat - p_lat) / 2.0), 2) +
        COS(RADIANS(p_lat)) * COS(RADIANS(pp.lat)) *
        POWER(SIN(RADIANS(pp.lng - p_lng) / 2.0), 2)
      ))
    ) <= p_radius_m
    AND NOT (pp.id = ANY(p_exclude_place_ids))
  ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST
  LIMIT p_limit;
$$;

ALTER FUNCTION public.query_servable_places_by_signal(text, numeric, double precision, double precision, double precision, uuid[], integer) OWNER TO postgres;

COMMENT ON FUNCTION public.query_servable_places_by_signal(text, numeric, double precision, double precision, double precision, uuid[], integer) IS
  'ORCH-0634: signal-scored servable places within radius. Three-gate serving enforced. META-ORCH-1009 Sub-B: extended return shape with ai_reasoning (per-signal Gemini Q2 evaluation slice from place_pool.ai_signal_scores) + ai_score_raw (admin visibility). Vetoed (place, signal) pairs have their place_scores row DELETED by run-signal-scorer so the JOIN excludes them.';

GRANT ALL ON FUNCTION public.query_servable_places_by_signal(text, numeric, double precision, double precision, double precision, uuid[], integer) TO anon;
GRANT ALL ON FUNCTION public.query_servable_places_by_signal(text, numeric, double precision, double precision, double precision, uuid[], integer) TO authenticated;
GRANT ALL ON FUNCTION public.query_servable_places_by_signal(text, numeric, double precision, double precision, double precision, uuid[], integer) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. query_servable_places_by_signal_intersection — collab positional deck
-- ─────────────────────────────────────────────────────────────────────────────

-- Same DROP-first pattern as above — return TABLE shape changes need DROP.
DROP FUNCTION IF EXISTS public.query_servable_places_by_signal_intersection(text, numeric, jsonb, uuid[], integer);

CREATE OR REPLACE FUNCTION public.query_servable_places_by_signal_intersection(
  p_signal_id text,
  p_filter_min numeric,
  p_circles jsonb,
  p_exclude_place_ids uuid[] DEFAULT '{}'::uuid[],
  p_limit integer DEFAULT 200
)
RETURNS TABLE(
  place_id uuid,
  google_place_id text,
  name text,
  address text,
  lat double precision,
  lng double precision,
  rating numeric,
  review_count integer,
  price_level text,
  price_range_start_cents integer,
  price_range_end_cents integer,
  opening_hours jsonb,
  website text,
  photos jsonb,
  stored_photo_urls text[],
  types text[],
  primary_type text,
  signal_score numeric,
  signal_contributions jsonb,
  -- META-ORCH-1009 Sub-B (NEW):
  ai_reasoning jsonb,
  ai_score_raw numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH circles AS (
    SELECT
      ST_SetSRID(ST_MakePoint((c->>'lng')::double precision, (c->>'lat')::double precision), 4326)::geography AS center,
      (c->>'radius_m')::double precision AS rad_m
    FROM jsonb_array_elements(p_circles) AS c
    WHERE (c->>'lat') IS NOT NULL
      AND (c->>'lng') IS NOT NULL
      AND (c->>'radius_m') IS NOT NULL
  ),
  candidate_places AS (
    SELECT pp.id
    FROM public.place_pool pp
    WHERE pp.is_servable = true
      AND pp.is_active = true
      AND pp.lat IS NOT NULL
      AND pp.lng IS NOT NULL
      AND (
        NOT EXISTS (SELECT 1 FROM circles)
        OR NOT EXISTS (
          SELECT 1
          FROM circles c
          WHERE NOT ST_DWithin(
            c.center,
            ST_SetSRID(ST_MakePoint(pp.lng, pp.lat), 4326)::geography,
            c.rad_m
          )
        )
      )
  )
  SELECT
    pp.id AS place_id,
    pp.google_place_id,
    pp.name,
    pp.address,
    pp.lat,
    pp.lng,
    pp.rating,
    pp.review_count,
    pp.price_level,
    pp.price_range_start_cents,
    pp.price_range_end_cents,
    pp.opening_hours,
    pp.website,
    pp.photos,
    pp.stored_photo_urls,
    pp.types,
    pp.primary_type,
    ps.score AS signal_score,
    ps.contributions AS signal_contributions,
    -- META-ORCH-1009 Sub-B: same column shape as the solo RPC for cross-surface
    -- parity. Collab determinism preserved: ORDER BY clause unchanged, the new
    -- column is a pure function of place_pool state at score-write time.
    pp.ai_signal_scores -> p_signal_id AS ai_reasoning,
    NULLIF((pp.ai_signal_scores -> p_signal_id ->> 'score_0_to_100'), '')::numeric AS ai_score_raw
  FROM public.place_pool pp
  JOIN candidate_places cp ON cp.id = pp.id
  JOIN public.place_scores ps ON ps.place_id = pp.id AND ps.signal_id = p_signal_id
  WHERE ps.score >= p_filter_min
    AND pp.stored_photo_urls IS NOT NULL
    AND array_length(pp.stored_photo_urls, 1) > 0
    AND NOT (
      array_length(pp.stored_photo_urls, 1) = 1
      AND pp.stored_photo_urls[1] = '__backfill_failed__'
    )
    AND NOT (pp.id = ANY(p_exclude_place_ids))
  ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST, pp.id ASC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.query_servable_places_by_signal_intersection(text, numeric, jsonb, uuid[], integer) IS
  'ORCH-0909 LCD-2: servable places inside the INTERSECTION of all GPS-bearing participant reachable circles using PostGIS ST_DWithin. META-ORCH-1009 Sub-B: extended return shape with ai_reasoning + ai_score_raw (same as solo RPC for cross-surface parity). Determinism contract preserved — ORDER BY clause unchanged + new column is pure function of place_pool state.';
