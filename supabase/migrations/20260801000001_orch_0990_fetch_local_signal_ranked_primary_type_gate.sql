-- ORCH-0990 [Curated "Flowers" stop resolves to real florists]
-- Re-create fetch_local_signal_ranked with a composite primary-type-aware gate
-- so the curated flowers stop can be filtered to verified bouquet sources.
--
-- WHY a migration (SPEC §8.1, REVIEW Pass-2 Defect 1): the baseline RPC
-- (20260505000000_baseline_squash_orch_0729.sql:4708-4730) gates only on
-- `pp.types && p_required_types` — a secondary-tag overlap. Google over-applies
-- the secondary `florist` tag in `types[]` to event planners / decorators /
-- general contractors (proven live in Lagos 2026-05-29), so a types[]-overlap
-- gate re-admits non-bouquet businesses. The clean discriminator is the canonical
-- single `primary_type`. The composite predicate the flowers stop needs —
--   primary_type = 'florist'
--     OR (primary_type IN ('grocery_store','supermarket') AND 'florist' = ANY(types))
-- — cannot be expressed by the single types-overlap clause, so the RPC gains TWO
-- new trailing optional params.
--
-- NO-REGRESSION GUARANTEE (SPEC §8.1 proof): every current caller
-- (generate-curated-experiences, replace-curated-stop via stopAlternatives)
-- invokes the RPC by NAMED args and never names the two new params. With both at
-- their defaults (NULL / false) the new WHERE clause reduces to an unconditional
-- TRUE → byte-identical row set for hiking, museum, and every non-flowers signal.
--
-- Forward-only + idempotent: DROP the exact old 9-arg overload FIRST (a changed
-- arg list under CREATE OR REPLACE would otherwise leave a stale overload and an
-- ambiguous-overload hazard), THEN CREATE OR REPLACE the new 11-arg version, THEN
-- re-issue OWNER / GRANT / COMMENT keyed to the NEW full signature.
--
-- STABLE SECURITY DEFINER read-only (SELECT only): no data mutation, no lock risk.
--
-- MIGRATION-FILENAME NOTE (implementor, monotonicity rule #10): SPEC §8.1 named
-- this `20260801000000_orch_0990_…`, but sibling worktree ORCH-0989 already holds
-- `20260801000000_orch_0989_brand_cover_video_target.sql`. To stay strictly
-- greater than every prefix across branches/remote/sibling worktrees, this file
-- uses `20260801000001`. Behavior is unchanged; only the timestamp prefix bumped.

-- Drop the exact old 9-arg overload (forward-only, idempotent via IF EXISTS).
DROP FUNCTION IF EXISTS "public"."fetch_local_signal_ranked"(
  "text", numeric, "text",
  numeric, numeric, numeric, numeric,
  "text"[], integer
);

CREATE OR REPLACE FUNCTION "public"."fetch_local_signal_ranked"(
  "p_filter_signal" "text", "p_filter_min" numeric, "p_rank_signal" "text",
  "p_lat_min" numeric, "p_lat_max" numeric, "p_lng_min" numeric, "p_lng_max" numeric,
  "p_required_types" "text"[] DEFAULT NULL::"text"[],
  "p_limit" integer DEFAULT 100,
  "p_primary_type_required" "text"[] DEFAULT NULL::"text"[],
  "p_grocery_floral_tag" boolean DEFAULT false)
  RETURNS TABLE("place_id" "uuid", "rank_score" numeric)
  LANGUAGE "sql" STABLE SECURITY DEFINER SET "search_path" TO 'public'
  AS $$
  SELECT ps_rank.place_id, ps_rank.score AS rank_score
  FROM place_pool pp
  INNER JOIN place_scores ps_filter ON ps_filter.place_id = pp.id AND ps_filter.signal_id = p_filter_signal AND ps_filter.score >= p_filter_min
  INNER JOIN place_scores ps_rank   ON ps_rank.place_id   = pp.id AND ps_rank.signal_id   = p_rank_signal
  WHERE pp.is_active = true AND pp.is_servable = true
    AND pp.lat BETWEEN p_lat_min AND p_lat_max
    AND pp.lng BETWEEN p_lng_min AND p_lng_max
    -- Existing secondary-tag overlap path. UNCHANGED for all current callers
    -- (hiking, museum). When p_required_types IS NULL this is a no-op (TRUE).
    AND (p_required_types IS NULL OR pp.types && p_required_types)
    -- ORCH-0990: composite primary-type-aware gate. When p_primary_type_required
    -- IS NULL AND p_grocery_floral_tag = false this is a no-op (TRUE) → EVERY
    -- existing caller (which passes neither) is byte-for-byte unaffected.
    -- For flowers: p_primary_type_required := ARRAY['florist'],
    --              p_grocery_floral_tag    := true
    --   → admits primary_type='florist'
    --      OR (primary_type IN ('grocery_store','supermarket') AND 'florist'=ANY(types))
    AND (
      (p_primary_type_required IS NULL AND p_grocery_floral_tag = false)
      OR (p_primary_type_required IS NOT NULL AND pp.primary_type = ANY(p_primary_type_required))
      OR (p_grocery_floral_tag = true
          AND pp.primary_type = ANY(ARRAY['grocery_store','supermarket'])
          AND pp.types && ARRAY['florist'])
    )
  ORDER BY ps_rank.score DESC
  LIMIT p_limit;
$$;

-- Re-issue OWNER / GRANTs / COMMENT keyed to the NEW full 11-arg signature.
ALTER FUNCTION "public"."fetch_local_signal_ranked"(
  "text", numeric, "text",
  numeric, numeric, numeric, numeric,
  "text"[], integer, "text"[], boolean
) OWNER TO "postgres";

GRANT ALL ON FUNCTION "public"."fetch_local_signal_ranked"(
  "text", numeric, "text",
  numeric, numeric, numeric, numeric,
  "text"[], integer, "text"[], boolean
) TO "anon";

GRANT ALL ON FUNCTION "public"."fetch_local_signal_ranked"(
  "text", numeric, "text",
  numeric, numeric, numeric, numeric,
  "text"[], integer, "text"[], boolean
) TO "authenticated";

GRANT ALL ON FUNCTION "public"."fetch_local_signal_ranked"(
  "text", numeric, "text",
  numeric, numeric, numeric, numeric,
  "text"[], integer, "text"[], boolean
) TO "service_role";

COMMENT ON FUNCTION "public"."fetch_local_signal_ranked"(
  "text", numeric, "text",
  numeric, numeric, numeric, numeric,
  "text"[], integer, "text"[], boolean
) IS 'ORCH-0653 v3.2 + ORCH-0990: bbox + filter-signal + rank-signal ranked place fetch. ORCH-0990 adds a composite primary-type gate (p_primary_type_required + p_grocery_floral_tag) for the flowers stop (primary_type=florist OR grocery/supermarket+florist-tag); existing types-overlap path (p_required_types) unchanged and the new clause is a no-op at defaults.';
