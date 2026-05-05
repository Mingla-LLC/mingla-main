-- ORCH-0700 Phase 2.C + ORCH-0707 Appendix A — Admin RPC rewires
--
-- Rewires 7 admin RPCs that read seeding_category or ai_categories columns to
-- use either the new pg_map_primary_type_to_mingla_category helper (for
-- direct place_pool reads) or the matview's primary_category column (for
-- admin_place_pool_mv reads — primary_category exists pre + post matview
-- rebuild, just changes derivation source).
--
-- Drops admin_assign_place_category (no override target column post-drop).
-- Removes p_seeding_category param from admin_edit_place.
-- Bumps admin_rules_overview drift threshold 18 → 20 (4 new SPLIT rules added
-- - 2 legacy deactivated = +2 net active per Migration 2).
-- Rewires admin_rules_preview_impact (5 ai_categories reads → derivation).
--
-- ALL bodies were captured live via pg_proc.prosrc 2026-05-03 per D-SUB-1
-- sharpened rule (never trust migration files for current state).
--
-- Reference:
--   ORCH-0700 spec §3.A.A4
--   ORCH-0707 spec §12 Appendix A (admin_rules_preview_impact rewrite)

BEGIN;

-- ── 1. admin_rules_overview — drift threshold 18 → 20 ─────────────────────

CREATE OR REPLACE FUNCTION public.admin_rules_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_result JSONB;
  v_drift_status TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- ORCH-0700: drift threshold raised 18 → 20 after SPLIT (Migration 2 added 4
  -- new active SPLIT rules and deactivated 2 legacy bundled originals = +2 net).
  IF (SELECT COUNT(*) FROM public.rule_sets WHERE is_active = true) < 20 THEN
    v_drift_status := 'warning';
  ELSE
    v_drift_status := 'in_sync';
  END IF;

  SELECT jsonb_build_object(
    'rules_active', (SELECT COUNT(*) FROM public.rule_sets WHERE is_active = true),
    'rules_total',  (SELECT COUNT(*) FROM public.rule_sets),
    'places_governed', (SELECT COUNT(*) FROM public.place_pool WHERE is_active = true),
    'fires_7d', (
      SELECT COUNT(*) FROM public.rules_run_results
      WHERE stage_resolved = 2 AND created_at >= now() - interval '7 days'
    ),
    'fires_24h', (
      SELECT COUNT(*) FROM public.rules_run_results
      WHERE stage_resolved = 2 AND created_at >= now() - interval '24 hours'
    ),
    'current_rules_version_id', (
      SELECT id FROM public.rules_versions ORDER BY deployed_at DESC LIMIT 1
    ),
    'current_manifest_label', (
      SELECT manifest_label FROM public.rules_versions ORDER BY deployed_at DESC LIMIT 1
    ),
    'drift_status', v_drift_status,
    'vibes_ready_count', 11,
    'vibes_partial_count', 5,
    'vibes_ai_only_count', 4,
    'vibes_total', 20
  ) INTO v_result;

  RETURN v_result;
END;
$func$;

-- ── 2. admin_uncategorized_places — derive via helper instead of seeding_category ──

-- Preserve existing parameter defaults (Postgres rejects CREATE OR REPLACE that
-- removes defaults — SQLSTATE 42P13). Live signature per pg_proc 2026-05-03:
--   p_country text DEFAULT NULL, p_city text DEFAULT NULL,
--   p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
CREATE OR REPLACE FUNCTION public.admin_uncategorized_places(
  p_country text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  google_place_id text,
  name text,
  address text,
  types text[],
  primary_type text,
  rating double precision,
  city text,
  country text,
  is_active boolean,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $func$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    pp.id,
    pp.google_place_id,
    pp.name,
    pp.address,
    pp.types,
    pp.primary_type,
    pp.rating,
    pp.city,
    pp.country,
    pp.is_active,
    COUNT(*) OVER() AS total_count
  FROM public.place_pool pp
  -- ORCH-0700: derive uncategorized from helper (Google's raw type data is the
  -- single owner per Constitution #2). NULL return = no Mingla category match.
  WHERE public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types) IS NULL
    AND (p_country IS NULL OR pp.country = p_country)
    AND (p_city IS NULL OR pp.city = p_city)
  ORDER BY pp.name
  LIMIT p_limit OFFSET p_offset;
END;
$func$;

-- ── 3. admin_pool_category_health — read primary_category from rebuilt matview ──
-- Note: primary_category column EXISTS pre + post matview rebuild (Migration 4
-- only changes its derivation source from ai_categories[1] to helper). This
-- RPC works correctly across the migration boundary.

-- Preserve existing parameter defaults per live signature 2026-05-03:
--   p_country text DEFAULT NULL, p_city text DEFAULT NULL
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
STABLE
SECURITY DEFINER
AS $func$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active')
  THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  WITH place_stats AS (
    SELECT
      -- ORCH-0700: switch from mv.seeding_category (column dropped) to
      -- mv.primary_category (matview's helper-derived single category column).
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
$func$;

-- ── 4. admin_city_place_stats — derive via helper instead of seeding_category ──

CREATE OR REPLACE FUNCTION public.admin_city_place_stats(
  p_city_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
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
    -- ORCH-0700: renamed key from `by_seeding_category` → `by_category` (derived);
    -- groups by helper-derived Mingla category instead of dropped seeding_category column.
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
$func$;

-- ── 5. admin_virtual_tile_intelligence — derive via helper ──

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
STABLE
SECURITY DEFINER
AS $func$
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

  -- ORCH-0700: derived_category via helper replaces dropped seeding_category column.
  RETURN QUERY
  SELECT
    r_idx,
    c_idx,
    v_min_lat + r_idx * v_cell_lat + v_cell_lat / 2.0 AS center_lat,
    v_min_lng + c_idx * v_cell_lng + v_cell_lng / 2.0 AS center_lng,
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
      FLOOR((pp2.lat - v_min_lat) / v_cell_lat)::INTEGER AS r_idx,
      FLOOR((pp2.lng - v_min_lng) / v_cell_lng)::INTEGER AS c_idx
    FROM public.place_pool pp2
    WHERE pp2.country = p_country AND pp2.city = p_city AND pp2.is_active
  ) pp
  GROUP BY r_idx, c_idx
  ORDER BY r_idx, c_idx;
END;
$func$;

-- ── 6. admin_assign_place_category — DROP (no override target column post-drop) ──
-- Both signatures dropped (defensive — exact signature was (uuid[], text) per pg_proc).
DROP FUNCTION IF EXISTS public.admin_assign_place_category(uuid[], text);
DROP FUNCTION IF EXISTS public.admin_assign_place_category(uuid, text);
DROP FUNCTION IF EXISTS public.admin_assign_place_category(uuid, text, text);

-- ── 7. admin_edit_place — REMOVE p_seeding_category param + writes ──
-- Drop the existing signature first (signature change requires drop + create
-- since CREATE OR REPLACE rejects parameter list mismatch).
DROP FUNCTION IF EXISTS public.admin_edit_place(uuid, text, text, boolean, text, text[]);

CREATE OR REPLACE FUNCTION public.admin_edit_place(
  p_place_id uuid,
  p_name text,
  p_price_tier text,
  p_is_active boolean,
  p_price_tiers text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
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

  -- ORCH-0700: removed p_seeding_category parameter + write (column dropped).
  -- Categories are now derived via pg_map_primary_type_to_mingla_category from
  -- Google's raw type data — no admin override capability remains. If override
  -- needed, future ORCH adds a place_pool_overrides table.
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
$func$;

-- ── 8. admin_rules_preview_impact — replace ai_categories scoping with helper-derived category ──
-- Per ORCH-0707 Appendix A. The 5 reads of `pp.ai_categories` are all
-- `v_scope_value = ANY(pp.ai_categories)` patterns (membership check). Replace
-- with `pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types) = v_scope_value`
-- (single-category equality — semantically equivalent under Constitution #2's
-- one-owner-per-truth model where Google's raw type data is the canonical source).
--
-- Sample SELECT also returns pp.ai_categories AS current_categories — replaced
-- with derived category as current_category (singular) since helper returns one slug.

-- Preserve existing parameter defaults per live signature 2026-05-03:
--   p_proposed_thresholds jsonb DEFAULT NULL, p_city_id uuid DEFAULT NULL
CREATE OR REPLACE FUNCTION public.admin_rules_preview_impact(
  p_rule_set_id uuid,
  p_proposed_entries text[],
  p_proposed_thresholds jsonb DEFAULT NULL,
  p_city_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
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
    -- ORCH-0707 Appendix A: replace ai_categories membership with derived category equality.
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
    -- ORCH-0707 Appendix A: same substitution.
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

      -- ORCH-0707 Appendix A: derived-category != scope (i.e., place would be promoted INTO scope).
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
  -- ORCH-0707: returns derived single category as `current_category` instead
  -- of pp.ai_categories array as `current_categories`.
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
$func$;

-- ── Verification: confirm 7 RPCs exist + admin_assign_place_category gone ──
DO $$
DECLARE
  v_rpc_count INT;
BEGIN
  SELECT COUNT(*) INTO v_rpc_count FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname IN (
      'admin_rules_overview',
      'admin_uncategorized_places',
      'admin_pool_category_health',
      'admin_city_place_stats',
      'admin_virtual_tile_intelligence',
      'admin_edit_place',
      'admin_rules_preview_impact'
    );
  IF v_rpc_count <> 7 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.C verify FAIL: expected 7 admin RPCs present, got %', v_rpc_count;
  END IF;

  -- admin_assign_place_category MUST be gone
  SELECT COUNT(*) INTO v_rpc_count FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname = 'admin_assign_place_category';
  IF v_rpc_count <> 0 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.C verify FAIL: admin_assign_place_category still present (% rows)', v_rpc_count;
  END IF;
END $$;

COMMIT;
