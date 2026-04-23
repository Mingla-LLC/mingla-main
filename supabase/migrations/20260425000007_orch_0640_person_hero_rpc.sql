-- ORCH-0640 ch04 — query_person_hero_places_by_signal RPC
-- Replaces both overloads of query_person_hero_cards (DROPPED in ch11).
-- Pool-only: reads place_pool + place_scores. No card_pool references.
-- Enforces I-THREE-GATE-SERVING: G1 is_servable, G2 score DESC, G3 real photos.
-- Preserves progressive-radius expansion (15km → 100km × 1.5× steps).
-- Dedup via p_exclude_place_ids (caller feeds from person_card_impressions post-pivot).

BEGIN;

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
  place            JSONB,
  signal_id        TEXT,
  signal_score     NUMERIC,
  total_available  BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
-- ═══════════════════════════════════════════════════════════════════════════
-- I-THREE-GATE-SERVING: this RPC enforces all three gates.
--   G1: WHERE pp.is_servable = true
--   G2: JOIN place_scores ps ON ps.place_id = pp.id AND ps.signal_id = ANY(p_signal_ids)
--       ORDER BY ps.score DESC
--   G3: AND pp.stored_photo_urls IS NOT NULL
--       AND array_length(pp.stored_photo_urls, 1) > 0
--       AND pp.stored_photo_urls <> ARRAY['__backfill_failed__']::text[]
--
-- ORCH-0640: DO NOT add card_pool / ai_approved / ai_override references.
-- Protective comment mandated by spec §14.2 + DEC-053 I-THREE-GATE-SERVING.
-- ═══════════════════════════════════════════════════════════════════════════
DECLARE
  v_radius           INT := p_initial_radius_m;
  v_current_count    INT := 0;
BEGIN
  -- Progressive radius expansion (15km → 22.5km → 33.75km ... ≤100km)
  WHILE v_radius <= p_max_radius_m LOOP
    -- Materialize gate-passing rows within current radius across all requested signals
    RETURN QUERY
    WITH ranked AS (
      SELECT DISTINCT ON (pp.id)
        to_jsonb(pp.*) AS place,
        ps.signal_id,
        ps.score AS signal_score
      FROM public.place_pool pp
      JOIN public.place_scores ps
        ON ps.place_id = pp.id
       AND ps.signal_id = ANY(p_signal_ids)
      WHERE pp.is_active = true
        AND pp.is_servable = true
        AND pp.stored_photo_urls IS NOT NULL
        AND array_length(pp.stored_photo_urls, 1) > 0
        AND pp.stored_photo_urls <> ARRAY['__backfill_failed__']::text[]
        AND (
          6371000.0 * 2.0 * ASIN(SQRT(
            POWER(SIN(RADIANS(pp.lat - p_lat) / 2.0), 2) +
            COS(RADIANS(p_lat)) * COS(RADIANS(pp.lat)) *
            POWER(SIN(RADIANS(pp.lng - p_lng) / 2.0), 2)
          ))
        ) <= v_radius
        AND NOT (pp.id = ANY(p_exclude_place_ids))
      ORDER BY pp.id, ps.score DESC  -- DISTINCT ON dedupe: keep highest-scoring signal per place
    ),
    final AS (
      SELECT r.*, COUNT(*) OVER () AS total_count
      FROM ranked r
      ORDER BY r.signal_score DESC
      LIMIT p_total_limit
    )
    SELECT
      f.place,
      f.signal_id,
      f.signal_score,
      f.total_count AS total_available
    FROM final f;

    GET DIAGNOSTICS v_current_count = ROW_COUNT;

    -- Exit as soon as we have enough results
    IF v_current_count >= p_total_limit THEN
      RETURN;
    END IF;

    -- Expand radius 1.5× for next iteration
    v_radius := LEAST((v_radius * 3) / 2, p_max_radius_m);
    -- Break once we hit the cap without having already returned
    IF v_radius = p_max_radius_m AND v_current_count < p_total_limit THEN
      EXIT;
    END IF;
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.query_person_hero_places_by_signal(
  UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT[], UUID[], INT, INT, INT, INT
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.query_person_hero_places_by_signal(
  UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT[], UUID[], INT, INT, INT, INT
) TO authenticated, service_role;

COMMENT ON FUNCTION public.query_person_hero_places_by_signal IS
  'ORCH-0640: pool-only replacement for query_person_hero_cards. Progressive-radius hero
   cards (15km → 100km × 1.5×). Enforces 3 gates (I-THREE-GATE-SERVING per DEC-044).
   Dedup via p_exclude_place_ids (caller feeds from person_card_impressions post-pivot
   in ch04 migration 20260425000008). Ordered by signal_score DESC. Caller picks
   highest-scoring signal per place via DISTINCT ON.';

COMMIT;
