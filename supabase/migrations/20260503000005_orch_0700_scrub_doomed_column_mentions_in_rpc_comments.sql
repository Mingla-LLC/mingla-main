-- ORCH-0700 Phase 2.E follow-up — scrub doomed-column mentions from RPC comments
--
-- Migration 3 rewrote 5 admin RPCs to STOP READING the doomed columns
-- (seeding_category, ai_categories, ai_*) — but left explanatory comments
-- inside the function bodies that still mention the column names. Migration 5's
-- pre-check 2 uses `prosrc ILIKE '%seeding_category%'` which matches comment
-- text, so the drop is blocked.
--
-- This migration re-CREATE-OR-REPLACEs the 5 RPCs with identical logic but
-- comments scrubbed of doomed-column mentions. The historical context is
-- preserved by referencing ORCH-0700 + ORCH-0707 by ID instead of column name.
--
-- Affected RPCs:
--   1. admin_city_place_stats          — comment mentioned `seeding_category`
--   2. admin_edit_place                — comment mentioned `p_seeding_category`
--   3. admin_pool_category_health      — comment mentioned `mv.seeding_category`
--   4. admin_rules_preview_impact      — comments mentioned `ai_categories` x3
--   5. admin_virtual_tile_intelligence — comment mentioned `seeding_category`
--
-- Reference: ORCH-0700 spec §3.A.A6, ORCH-0707 spec §12 Appendix A.1

BEGIN;

-- ── 1. admin_city_place_stats ──
CREATE OR REPLACE FUNCTION public.admin_city_place_stats(p_city_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_places', COUNT(*) FILTER (WHERE is_active),
    'inactive_places', COUNT(*) FILTER (WHERE NOT is_active),
    'avg_rating', ROUND(AVG(rating) FILTER (WHERE is_active AND rating IS NOT NULL)::numeric, 2),
    'with_photos', COUNT(*) FILTER (WHERE is_active AND stored_photo_urls IS NOT NULL AND array_length(stored_photo_urls, 1) > 0),
    'without_photos', COUNT(*) FILTER (WHERE is_active AND (stored_photo_urls IS NULL OR array_length(stored_photo_urls, 1) IS NULL)),
    'stale_count', COUNT(*) FILTER (WHERE is_active AND last_detail_refresh < now() - interval '7 days'),
    -- ORCH-0700: groups by helper-derived Mingla category.
    'by_category', (
      SELECT COALESCE(jsonb_object_agg(
        COALESCE(derived_category, 'unknown'),
        jsonb_build_object('count', cnt, 'with_photos', photo_cnt)
      ), '{}'::jsonb)
      FROM (
        SELECT public.pg_map_primary_type_to_mingla_category(primary_type, types) AS derived_category,
               COUNT(*) as cnt,
               COUNT(*) FILTER (WHERE stored_photo_urls IS NOT NULL AND array_length(stored_photo_urls, 1) > 0) as photo_cnt
        FROM public.place_pool
        WHERE city_id = p_city_id AND is_active
        GROUP BY derived_category
      ) sub
    ),
    'price_tier_distribution', (
      SELECT COALESCE(jsonb_object_agg(COALESCE(price_tier, 'unknown'), cnt), '{}'::jsonb)
      FROM (
        SELECT price_tier, COUNT(*) as cnt
        FROM public.place_pool
        WHERE city_id = p_city_id AND is_active
        GROUP BY price_tier
      ) sub
    )
  ) INTO v_result
  FROM public.place_pool
  WHERE city_id = p_city_id;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- ── 2. admin_edit_place ──
CREATE OR REPLACE FUNCTION public.admin_edit_place(
  p_place_id uuid,
  p_name text DEFAULT NULL,
  p_price_tier text DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_price_tiers text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result JSONB;
  v_effective_tiers TEXT[];
  v_tiers_provided BOOLEAN := (p_price_tiers IS NOT NULL);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_tiers_provided THEN
    v_effective_tiers := p_price_tiers;
  ELSIF p_price_tier IS NOT NULL THEN
    v_effective_tiers := ARRAY[p_price_tier];
  ELSE
    v_effective_tiers := NULL;
  END IF;

  -- ORCH-0700: category-override capability removed (admin can no longer override
  -- a place's Mingla category — categories are derived from Google's raw type
  -- data via pg_map_primary_type_to_mingla_category). If override is needed in
  -- future, a separate place_pool_overrides table will be added.
  UPDATE public.place_pool
  SET
    name = COALESCE(p_name, name),
    price_tier = CASE
      WHEN v_effective_tiers IS NOT NULL AND array_length(v_effective_tiers, 1) > 0 THEN v_effective_tiers[1]
      WHEN v_effective_tiers IS NOT NULL THEN NULL
      ELSE price_tier
    END,
    price_tiers = COALESCE(v_effective_tiers, price_tiers),
    is_active = COALESCE(p_is_active, is_active),
    updated_at = now()
  WHERE id = p_place_id
  RETURNING jsonb_build_object(
    'id', id, 'name', name, 'price_tier', price_tier, 'price_tiers', price_tiers,
    'is_active', is_active
  )
  INTO v_result;

  IF v_result IS NULL THEN RAISE EXCEPTION 'Place not found: %', p_place_id; END IF;

  RETURN v_result;
END;
$$;

-- ── 3. admin_pool_category_health ──
CREATE OR REPLACE FUNCTION public.admin_pool_category_health(
  p_country text DEFAULT NULL,
  p_city text DEFAULT NULL
)
RETURNS TABLE(
  category text,
  total_places bigint,
  active_places bigint,
  with_photos bigint,
  photo_pct integer,
  avg_rating numeric,
  total_cards bigint,
  single_cards bigint,
  curated_cards bigint,
  places_needing_cards bigint,
  health text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active')
  THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  WITH place_stats AS (
    SELECT
      -- ORCH-0700: reads matview's helper-derived primary_category column.
      mv.primary_category,
      COUNT(*) AS total_places,
      COUNT(*) FILTER (WHERE mv.is_active) AS active_places,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.has_photos) AS with_photos,
      ROUND((AVG(mv.rating) FILTER (WHERE mv.rating IS NOT NULL))::NUMERIC, 1) AS avg_rating
    FROM admin_place_pool_mv mv
    WHERE mv.primary_category IS NOT NULL
      AND mv.primary_category <> 'uncategorized'
      AND (p_country IS NULL OR mv.pp_country = p_country)
      AND (p_city IS NULL OR mv.pp_city = p_city)
    GROUP BY mv.primary_category
  )
  SELECT
    ps.primary_category AS category,
    ps.total_places,
    ps.active_places,
    ps.with_photos,
    CASE WHEN ps.active_places > 0
      THEN ROUND(ps.with_photos * 100.0 / ps.active_places)::INTEGER
      ELSE 0 END AS photo_pct,
    ps.avg_rating,
    0::bigint AS total_cards,            -- ORCH-0640: card_pool archived
    0::bigint AS single_cards,
    0::bigint AS curated_cards,
    0::bigint AS places_needing_cards,   -- "needing cards" concept retired
    CASE
      WHEN ps.with_photos >= ps.active_places * 0.8 THEN 'green'
      WHEN ps.with_photos >= ps.active_places * 0.5 THEN 'yellow'
      ELSE 'red'
    END AS health  -- health now measures photo coverage (the actual G3 gate)
  FROM place_stats ps
  ORDER BY ps.active_places DESC;
END;
$$;

-- ── 4. admin_rules_preview_impact ──
CREATE OR REPLACE FUNCTION public.admin_rules_preview_impact(
  p_rule_set_id uuid,
  p_proposed_entries text[],
  p_proposed_thresholds jsonb DEFAULT NULL,
  p_city_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_kind TEXT; v_scope_kind TEXT; v_scope_value TEXT;
  v_would_modify INT := 0; v_would_reject INT := 0; v_total_evaluated INT := 0;
  v_sample JSONB; v_partial BOOLEAN := false;
  v_max_eval INT := 50000;
  v_start TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT kind, scope_kind, scope_value INTO v_kind, v_scope_kind, v_scope_value
  FROM public.rule_sets WHERE id = p_rule_set_id;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'Rule set not found: %', p_rule_set_id;
  END IF;

  -- Per-kind isolated impact computation. Bounded at 50K places via LIMIT;
  -- if pool larger, returns partial: true so UI can warn admin.
  SELECT COUNT(*) INTO v_total_evaluated FROM (
    SELECT id FROM public.place_pool
    WHERE is_active = true
      AND (p_city_id IS NULL OR city_id = p_city_id)
    LIMIT v_max_eval + 1
  ) t;
  IF v_total_evaluated > v_max_eval THEN
    v_partial := true;
    v_total_evaluated := v_max_eval;
  END IF;

  -- Branch by rule kind
  IF v_kind = 'blacklist' THEN
    SELECT COUNT(*) INTO v_would_reject FROM (
      SELECT pp.id FROM public.place_pool pp
      WHERE pp.is_active = true
        AND (p_city_id IS NULL OR pp.city_id = p_city_id)
        AND EXISTS (
          SELECT 1 FROM unnest(p_proposed_entries) AS e
          WHERE lower(pp.name) LIKE '%' || lower(e) || '%'
             OR pp.primary_type = e
        )
      LIMIT v_max_eval
    ) t;

  ELSIF v_kind = 'demotion' THEN
    -- ORCH-0707 Appendix A: derived-category equality check.
    SELECT COUNT(*) INTO v_would_modify FROM (
      SELECT pp.id FROM public.place_pool pp
      WHERE pp.is_active = true
        AND (p_city_id IS NULL OR pp.city_id = p_city_id)
        AND public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types) = v_scope_value
        AND EXISTS (
          SELECT 1 FROM unnest(p_proposed_entries) AS e
          WHERE lower(pp.name) LIKE '%' || lower(e) || '%'
        )
      LIMIT v_max_eval
    ) t;

  ELSIF v_kind = 'strip' THEN
    -- ORCH-0707 Appendix A: derived-category equality check.
    SELECT COUNT(*) INTO v_would_modify FROM (
      SELECT pp.id FROM public.place_pool pp
      WHERE pp.is_active = true
        AND (p_city_id IS NULL OR pp.city_id = p_city_id)
        AND public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types) = v_scope_value
        AND (pp.primary_type = ANY(p_proposed_entries) OR pp.types && p_proposed_entries)
      LIMIT v_max_eval
    ) t;

  ELSIF v_kind = 'promotion' THEN
    DECLARE v_price_levels TEXT[]; v_rating_min REAL;
    BEGIN
      v_price_levels := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_proposed_thresholds, '{"price_levels":[]}'::jsonb)->'price_levels'));
      v_rating_min := COALESCE((p_proposed_thresholds->>'rating_min')::REAL, 4.0);

      -- ORCH-0707 Appendix A: derived-category != scope (place would be promoted INTO scope).
      SELECT COUNT(*) INTO v_would_modify FROM (
        SELECT pp.id FROM public.place_pool pp
        WHERE pp.is_active = true
          AND (p_city_id IS NULL OR pp.city_id = p_city_id)
          AND pp.price_level = ANY(v_price_levels)
          AND pp.rating >= v_rating_min
          AND public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types) IS DISTINCT FROM v_scope_value
        LIMIT v_max_eval
      ) t;
    END;

  ELSIF v_kind = 'min_data_guard' THEN
    SELECT COUNT(*) INTO v_would_reject FROM (
      SELECT pp.id FROM public.place_pool pp
      WHERE pp.is_active = true
        AND (p_city_id IS NULL OR pp.city_id = p_city_id)
        AND pp.rating IS NULL
        AND COALESCE(pp.review_count, 0) = 0
        AND COALESCE(pp.website, '') = ''
      LIMIT v_max_eval
    ) t;

  ELSE
    -- whitelist / keyword_set / time_window / numeric_range — no direct verdict impact
    v_would_modify := 0;
    v_would_reject := 0;
  END IF;

  -- Sample affected places (up to 5).
  -- ORCH-0707: returns derived single category as `current_category`.
  IF v_kind IN ('blacklist', 'demotion', 'strip', 'promotion', 'min_data_guard') THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_sample FROM (
      SELECT pp.id AS place_id, pp.name, pp.address,
        public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types) AS current_category,
        CASE WHEN v_kind IN ('blacklist', 'min_data_guard') THEN 'reject'
             ELSE 'modify' END AS proposed_outcome
      FROM public.place_pool pp
      WHERE pp.is_active = true
        AND (p_city_id IS NULL OR pp.city_id = p_city_id)
        AND CASE
          WHEN v_kind = 'blacklist' THEN
            EXISTS (SELECT 1 FROM unnest(p_proposed_entries) AS e
                    WHERE lower(pp.name) LIKE '%' || lower(e) || '%' OR pp.primary_type = e)
          WHEN v_kind = 'demotion' THEN
            public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types) = v_scope_value AND
            EXISTS (SELECT 1 FROM unnest(p_proposed_entries) AS e WHERE lower(pp.name) LIKE '%' || lower(e) || '%')
          WHEN v_kind = 'strip' THEN
            public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types) = v_scope_value AND
            (pp.primary_type = ANY(p_proposed_entries) OR pp.types && p_proposed_entries)
          WHEN v_kind = 'min_data_guard' THEN
            pp.rating IS NULL AND COALESCE(pp.review_count, 0) = 0 AND COALESCE(pp.website, '') = ''
          ELSE false
        END
      LIMIT 5
    ) t;
  ELSE
    v_sample := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'would_modify', v_would_modify,
    'would_reject', v_would_reject,
    'would_no_op', GREATEST(v_total_evaluated - v_would_modify - v_would_reject, 0),
    'total_evaluated', v_total_evaluated,
    'sample_affected', v_sample,
    'partial', v_partial,
    'note', CASE WHEN v_partial THEN format('Pool exceeds %s places; result is approximate', v_max_eval) ELSE NULL END,
    'computed_in_ms', EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_start))::INT
  );
END;
$$;

-- ── 5. admin_virtual_tile_intelligence ──
-- Need the existing return-type signature; pull from current schema.
-- Args are (p_country text, p_city text) per Migration 3 / live schema.
CREATE OR REPLACE FUNCTION public.admin_virtual_tile_intelligence(
  p_country text,
  p_city text
)
RETURNS TABLE(
  row_idx integer,
  col_idx integer,
  center_lat double precision,
  center_lng double precision,
  active_places bigint,
  with_photos bigint,
  category_count integer,
  top_category text,
  avg_rating numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_min_lat DOUBLE PRECISION;
  v_max_lat DOUBLE PRECISION;
  v_min_lng DOUBLE PRECISION;
  v_max_lng DOUBLE PRECISION;
  v_cell_lat DOUBLE PRECISION := 0.0045;
  v_cell_lng DOUBLE PRECISION;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT MIN(pp.lat), MAX(pp.lat), MIN(pp.lng), MAX(pp.lng)
  INTO v_min_lat, v_max_lat, v_min_lng, v_max_lng
  FROM public.place_pool pp
  WHERE pp.country = p_country AND pp.city = p_city AND pp.is_active;

  IF v_min_lat IS NULL THEN
    RETURN;
  END IF;

  v_cell_lng := v_cell_lat / COS(RADIANS((v_min_lat + v_max_lat) / 2.0));

  IF v_max_lat - v_min_lat < v_cell_lat THEN
    v_min_lat := v_min_lat - v_cell_lat;
    v_max_lat := v_max_lat + v_cell_lat;
  END IF;
  IF v_max_lng - v_min_lng < v_cell_lng THEN
    v_min_lng := v_min_lng - v_cell_lng;
    v_max_lng := v_max_lng + v_cell_lng;
  END IF;

  -- ORCH-0700: derived_category via helper.
  RETURN QUERY
  SELECT
    row_idx,
    col_idx,
    v_min_lat + row_idx * v_cell_lat + v_cell_lat / 2.0 AS center_lat,
    v_min_lng + col_idx * v_cell_lng + v_cell_lng / 2.0 AS center_lng,
    COUNT(*) AS active_places,
    COUNT(*) FILTER (WHERE pp.stored_photo_urls IS NOT NULL
      AND array_length(pp.stored_photo_urls, 1) > 0) AS with_photos,
    COUNT(DISTINCT pp.derived_category) FILTER (
      WHERE pp.derived_category IS NOT NULL
    )::INTEGER AS category_count,
    MODE() WITHIN GROUP (ORDER BY pp.derived_category) AS top_category,
    ROUND((AVG(pp.rating) FILTER (WHERE pp.rating IS NOT NULL))::NUMERIC, 1) AS avg_rating
  FROM (
    SELECT
      pp2.*,
      public.pg_map_primary_type_to_mingla_category(pp2.primary_type, pp2.types) AS derived_category,
      FLOOR((pp2.lat - v_min_lat) / v_cell_lat)::INTEGER AS row_idx,
      FLOOR((pp2.lng - v_min_lng) / v_cell_lng)::INTEGER AS col_idx
    FROM public.place_pool pp2
    WHERE pp2.country = p_country AND pp2.city = p_city AND pp2.is_active
  ) pp
  GROUP BY row_idx, col_idx
  ORDER BY row_idx, col_idx;
END;
$$;

-- ── Verification: confirm zero RPCs in public schema reference any doomed column ──
DO $$
DECLARE
  v_offending_rpcs TEXT[];
BEGIN
  v_offending_rpcs := ARRAY(
    SELECT proname FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND (
        prosrc ILIKE '%seeding_category%'
        OR prosrc ILIKE '%ai_categories%'
        OR prosrc ILIKE '%ai_reason%'
        OR prosrc ILIKE '%ai_primary_identity%'
        OR prosrc ILIKE '%ai_confidence%'
        OR prosrc ILIKE '%ai_web_evidence%'
      )
  );
  IF array_length(v_offending_rpcs, 1) > 0 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.E follow-up FAIL: % RPC(s) STILL reference doomed columns: %', array_length(v_offending_rpcs, 1), v_offending_rpcs;
  END IF;
END $$;

COMMIT;
