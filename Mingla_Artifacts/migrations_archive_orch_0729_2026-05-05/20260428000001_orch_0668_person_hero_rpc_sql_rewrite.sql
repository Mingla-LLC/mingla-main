-- ORCH-0668 — Rewrite query_person_hero_places_by_signal as LANGUAGE sql STABLE
--
-- ROOT CAUSE (proven in reports/INVESTIGATION_ORCH-0668_PAIRED_PROFILE_RECOMMENDATIONS_FAIL.md):
-- The plpgsql original switches to a generic cached plan after ~5 invocations,
-- materializing huge intermediate sets that exceed the 8s authenticator
-- statement_timeout. Sibling RPCs (query_servable_places_by_signal,
-- fetch_local_signal_ranked) are LANGUAGE sql STABLE and prove the fix path.
--
-- This migration:
--   (1) Rewrites as LANGUAGE sql STABLE so PostgreSQL can inline the body at
--       the call site and avoid the plpgsql plan-cache trap.
--   (2) Drops the WHILE LOOP control flow (HF-3 — dead weight at urban scale,
--       1797 places at Raleigh ≥ p_total_limit, loop never iterates).
--   (3) DEFERS to_jsonb(pp.*) hydration until AFTER LIMIT 9 — the place_pool
--       row is wide (~2271 bytes incl. stored_photo_urls + opening_hours +
--       description). Carrying it through the DISTINCT ON sort spills 707 MB
--       to disk at 11-signal scale and exceeds the 8 s timeout. Hydrating
--       only the 9 winners via PK lookup keeps the dedup sort in memory.
--   (4) Uses ORDER BY (band_idx ASC, signal_score DESC) LIMIT to express
--       "smallest progressive-radius band first, top-by-score within."
--       Verified perf: 214.8 ms p95 for 11-signal Raleigh-class workload
--       (vs 25 200 ms for the legacy plpgsql, vs 46 900 ms for a
--       to_jsonb-in-sort variant that spilled to temp).
--
-- SEMANTIC NOTE vs LEGACY plpgsql WHILE LOOP:
--   At urban locations (band 1 has ≥ p_total_limit places) the result is
--   identical: the 9 returned all come from band 1, sorted by signal_score.
--   At rural locations (band 1 has < p_total_limit places) the result
--   prefers nearer-band places when both inner and expanded bands have
--   candidates, which is a strict improvement over the legacy "use
--   smallest band that has ≥N, then top-by-score within that band only"
--   policy that could exclude nearby band-1 places when band 2 had higher
--   scores. Edge function caller behavior is unchanged (same row shape).
--
-- INVARIANTS PRESERVED:
--   I-THREE-GATE-SERVING (DEC-053): is_servable + photo gate enforced verbatim.
--   I-PLACE-ID-CONTRACT: place JSONB carries place_pool.id::TEXT.
--   I-POOL-ONLY-SERVING: reads place_pool + place_scores only. Zero card_pool refs.
--
-- INVARIANTS REGISTERED:
--   I-RPC-LANGUAGE-SQL-FOR-HOT-PATH: this function is LANGUAGE sql STABLE.
--   Reverting to plpgsql without SET plan_cache_mode = force_custom_plan
--   re-introduces the timeout. CI gate at scripts/ci-check-invariants.sh.

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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  -- ═══════════════════════════════════════════════════════════════════════
  -- [CRITICAL — ORCH-0640 + ORCH-0668]
  -- I-THREE-GATE-SERVING + I-RPC-LANGUAGE-SQL-FOR-HOT-PATH
  --   G1: pp.is_servable = true
  --   G2: JOIN place_scores ps ON ps.place_id = pp.id AND ps.signal_id = ANY(...)
  --       ORDER BY ps.score DESC
  --   G3: stored_photo_urls non-null, non-empty, not the __backfill_failed__ sentinel
  -- DO NOT add card_pool / ai_approved / ai_override references.
  -- DO NOT change LANGUAGE to plpgsql — plan-cache trap re-introduces 8s timeout.
  -- DO NOT carry to_jsonb(pp.*) through the dedup sort — 707 MB temp spill.
  -- ═══════════════════════════════════════════════════════════════════════
  WITH
  gate_passing AS (
    SELECT
      pp.id AS place_id,
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
    -- Keep highest-scoring requested signal per place (DISTINCT ON dedupe)
    -- Carries only narrow fields (id, distance, signal_id, score) — NO jsonb.
    SELECT DISTINCT ON (w.place_id)
      w.place_id,
      w.distance_m,
      ps.signal_id,
      ps.score AS signal_score
    FROM within_max w
    JOIN public.place_scores ps
      ON ps.place_id = w.place_id
     AND ps.signal_id = ANY(p_signal_ids)
    ORDER BY w.place_id, ps.score DESC
  ),
  ranked AS (
    -- Bucket each place into the smallest progressive-radius band that
    -- contains it (1 = innermost, 6 = at p_max_radius_m). Bands match
    -- legacy WHILE LOOP semantics: 15km → 22.5km → 33.75km → 50.6km →
    -- 75.9km → 100km, each capped at p_max_radius_m.
    SELECT
      d.place_id,
      d.signal_id,
      d.signal_score,
      CASE
        WHEN d.distance_m <= LEAST(p_initial_radius_m, p_max_radius_m)::DOUBLE PRECISION       THEN 1
        WHEN d.distance_m <= LEAST((p_initial_radius_m * 3) / 2, p_max_radius_m)::DOUBLE PRECISION THEN 2
        WHEN d.distance_m <= LEAST((p_initial_radius_m * 9) / 4, p_max_radius_m)::DOUBLE PRECISION THEN 3
        WHEN d.distance_m <= LEAST((p_initial_radius_m * 27) / 8, p_max_radius_m)::DOUBLE PRECISION THEN 4
        WHEN d.distance_m <= LEAST((p_initial_radius_m * 81) / 16, p_max_radius_m)::DOUBLE PRECISION THEN 5
        ELSE 6
      END AS band_idx,
      COUNT(*) OVER () AS total_count
    FROM deduped d
  ),
  top_n AS (
    -- ORDER BY (band_idx ASC, signal_score DESC) preserves "smallest
    -- progressive-radius band wins, top-by-score within band." Top-N
    -- heapsort, fits in work_mem.
    SELECT *
    FROM ranked
    ORDER BY band_idx ASC, signal_score DESC
    LIMIT p_total_limit
  )
  -- Hydrate to_jsonb only for the ≤ p_total_limit winners via PK lookup.
  SELECT
    to_jsonb(pp.*) AS place,
    t.signal_id,
    t.signal_score,
    t.total_count AS total_available
  FROM top_n t
  JOIN public.place_pool pp ON pp.id = t.place_id
  ORDER BY t.band_idx ASC, t.signal_score DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.query_person_hero_places_by_signal(
  UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT[], UUID[], INT, INT, INT, INT
) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.query_person_hero_places_by_signal(
  UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT[], UUID[], INT, INT, INT, INT
) TO authenticated, service_role;

COMMENT ON FUNCTION public.query_person_hero_places_by_signal IS
  'ORCH-0668 (supersedes ORCH-0640 plpgsql original): pool-only progressive-
   radius hero RPC, LANGUAGE sql STABLE. Enforces I-THREE-GATE-SERVING.
   Defers to_jsonb(pp.*) hydration until after LIMIT to avoid sort spill.
   Live-fire perf: 214.8 ms for 11-signal Raleigh-class workload (vs 25 s
   legacy plpgsql). See reports/INVESTIGATION_ORCH-0668_PAIRED_PROFILE_RECOMMENDATIONS_FAIL.md.';

COMMIT;

-- ROLLBACK (in case of regression):
--   Re-apply 20260425000007_orch_0640_person_hero_rpc.sql verbatim.
--   That migration is `CREATE OR REPLACE` and will replace this body.
--   Verify rollback by repeating perf test: 11-signal Raleigh should
--   return to 25 s execution / 8 s statement_timeout 500s.
