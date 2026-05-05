-- ORCH-0540 P0 HOTFIX — swap row_to_jsonb(t) → to_jsonb(t) in 10 rules-engine RPCs
--
-- Post-flag-flip, admin Rules Filter tab errored with
-- "function row_to_jsonb(record) does not exist" on every non-overview RPC.
-- Flag was reverted to false while diagnosing.
--
-- Root cause: PL/pgSQL cannot resolve row_to_jsonb(t) when t is a subquery alias
-- OR a table alias — Postgres types the alias as generic record (or the concrete
-- composite like rule_sets) and fails to match a row_to_jsonb overload inside
-- the plpgsql caller context.
--
-- Reproduced via MCP DO block (subquery alias):
--   ERROR 42883: function row_to_jsonb(record) does not exist
-- And via MCP DO block (table alias rs):
--   ERROR 42883: function row_to_jsonb(rule_sets) does not exist
--
-- Fix verified in both cases by swapping to to_jsonb(...), which is polymorphic
-- (anyelement) and resolves cleanly.
--
-- This migration CREATE OR REPLACEs the 10 affected functions with identical
-- bodies except for the row_to_jsonb → to_jsonb swap. 21 substitutions total:
-- 16 subquery aliases + 5 table aliases. No signature changes, no gate changes,
-- no semantic changes. Return shapes identical.
--
-- Not affected: admin_rules_overview (uses jsonb_build_object), admin_rules_save
-- (uses jsonb_build_object), admin_rules_rollback (delegates to save),
-- admin_get_feature_flags (migration 4, uses jsonb_object_agg), advisory-lock RPCs.


-- ══════════════════════════════════════════════════════════════════════
-- 1. admin_rules_list (1 subquery-alias hit)
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_rules_list(
  p_scope_filter TEXT DEFAULT NULL,
  p_kind_filter TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_show_only_never_fired BOOLEAN DEFAULT false
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      rs.id,
      rs.name,
      rs.description,
      rs.kind,
      rs.scope_kind,
      rs.scope_value,
      rs.is_active,
      rs.current_version_id,
      rsv.version_number AS current_version_number,
      (SELECT COUNT(*) FROM public.rule_entries WHERE rule_set_version_id = rs.current_version_id) AS entry_count,
      (
        SELECT MAX(avr.created_at) FROM public.ai_validation_results avr
        WHERE avr.rule_set_version_id IN (
          SELECT id FROM public.rule_set_versions WHERE rule_set_id = rs.id
        )
      ) AS last_fired_at,
      (
        SELECT COUNT(*) FROM public.ai_validation_results avr
        WHERE avr.rule_set_version_id IN (
          SELECT id FROM public.rule_set_versions WHERE rule_set_id = rs.id
        ) AND avr.created_at >= now() - interval '7 days'
      ) AS fires_7d,
      (
        SELECT COUNT(*) FROM public.ai_validation_results avr
        WHERE avr.rule_set_version_id IN (
          SELECT id FROM public.rule_set_versions WHERE rule_set_id = rs.id
        )
      ) AS fires_total,
      rsv.created_at AS last_edited_at,
      rsv.created_by AS last_edited_by_id,
      (SELECT email FROM public.admin_users WHERE id = rsv.created_by) AS last_edited_by_email
    FROM public.rule_sets rs
    LEFT JOIN public.rule_set_versions rsv ON rsv.id = rs.current_version_id
    WHERE
      (p_scope_filter IS NULL OR rs.scope_kind = p_scope_filter)
      AND (p_kind_filter IS NULL OR rs.kind = p_kind_filter)
      AND (p_search IS NULL OR rs.name ILIKE '%' || p_search || '%' OR rs.description ILIKE '%' || p_search || '%')
    ORDER BY rs.scope_kind, rs.scope_value NULLS FIRST, rs.name
  ) t
  WHERE NOT p_show_only_never_fired OR (t.fires_total = 0);

  RETURN v_result;
END; $$;


-- ══════════════════════════════════════════════════════════════════════
-- 2. admin_rule_detail (3 table-alias + 1 subquery-alias = 4 hits)
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_rule_detail(p_rule_set_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result JSONB; v_rule_set JSONB; v_current_version JSONB; v_entries JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT to_jsonb(rs) INTO v_rule_set FROM public.rule_sets rs WHERE rs.id = p_rule_set_id;
  IF v_rule_set IS NULL THEN
    RAISE EXCEPTION 'Rule set not found: %', p_rule_set_id USING ERRCODE = 'P0002';
  END IF;

  SELECT to_jsonb(rsv) INTO v_current_version
  FROM public.rule_set_versions rsv
  WHERE rsv.id = (v_rule_set->>'current_version_id')::UUID;

  SELECT COALESCE(jsonb_agg(to_jsonb(re) ORDER BY re.position, re.value), '[]'::jsonb) INTO v_entries
  FROM public.rule_entries re
  WHERE re.rule_set_version_id = (v_rule_set->>'current_version_id')::UUID;

  RETURN jsonb_build_object(
    'rule_set', v_rule_set,
    'current_version', v_current_version,
    'entries', v_entries,
    'version_count', (SELECT COUNT(*) FROM public.rule_set_versions WHERE rule_set_id = p_rule_set_id),
    'fires_7d_by_outcome', jsonb_build_object(
      'reject', (
        SELECT COUNT(*) FROM public.ai_validation_results
        WHERE rule_set_version_id IN (SELECT id FROM public.rule_set_versions WHERE rule_set_id = p_rule_set_id)
          AND decision = 'reject' AND created_at >= now() - interval '7 days'
      ),
      'modify', (
        SELECT COUNT(*) FROM public.ai_validation_results
        WHERE rule_set_version_id IN (SELECT id FROM public.rule_set_versions WHERE rule_set_id = p_rule_set_id)
          AND decision = 'reclassify' AND created_at >= now() - interval '7 days'
      )
    ),
    'most_recent_fires', COALESCE((
      SELECT jsonb_agg(to_jsonb(t)) FROM (
        SELECT pp.name AS place_name, avr.decision, avr.created_at, avr.reason
        FROM public.ai_validation_results avr
        JOIN public.place_pool pp ON pp.id = avr.place_id
        WHERE avr.rule_set_version_id IN (SELECT id FROM public.rule_set_versions WHERE rule_set_id = p_rule_set_id)
        ORDER BY avr.created_at DESC LIMIT 5
      ) t
    ), '[]'::jsonb)
  );
END; $$;


-- ══════════════════════════════════════════════════════════════════════
-- 3. admin_rule_set_versions (1 subquery-alias hit)
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_rule_set_versions(p_rule_set_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.version_number DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      rsv.id,
      rsv.version_number,
      rsv.change_summary,
      rsv.thresholds,
      rsv.created_at,
      rsv.created_by,
      (SELECT email FROM public.admin_users WHERE id = rsv.created_by) AS created_by_email,
      (SELECT COUNT(*) FROM public.rule_entries WHERE rule_set_version_id = rsv.id) AS entry_count,
      (rsv.id = (SELECT current_version_id FROM public.rule_sets WHERE id = p_rule_set_id)) AS is_current
    FROM public.rule_set_versions rsv
    WHERE rsv.rule_set_id = p_rule_set_id
    ORDER BY rsv.version_number DESC
  ) t;

  RETURN v_result;
END; $$;


-- ══════════════════════════════════════════════════════════════════════
-- 4. admin_rule_set_diff (4 subquery-alias hits)
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_rule_set_diff(p_version_a UUID, p_version_b UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_va JSONB; v_vb JSONB;
  v_added JSONB; v_removed JSONB; v_unchanged_count INT;
  v_thresholds_a JSONB; v_thresholds_b JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT to_jsonb(t) INTO v_va FROM (
    SELECT id, version_number, created_at, change_summary FROM public.rule_set_versions WHERE id = p_version_a
  ) t;
  SELECT to_jsonb(t) INTO v_vb FROM (
    SELECT id, version_number, created_at, change_summary FROM public.rule_set_versions WHERE id = p_version_b
  ) t;

  IF v_va IS NULL OR v_vb IS NULL THEN
    RAISE EXCEPTION 'One or both versions not found';
  END IF;

  -- Entries in B that aren't in A → added
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_added FROM (
    SELECT b.value, b.sub_category, b.reason FROM public.rule_entries b
    WHERE b.rule_set_version_id = p_version_b
    AND NOT EXISTS (
      SELECT 1 FROM public.rule_entries a
      WHERE a.rule_set_version_id = p_version_a
        AND a.value = b.value
        AND COALESCE(a.sub_category, '') = COALESCE(b.sub_category, '')
    )
  ) t;

  -- Entries in A that aren't in B → removed
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_removed FROM (
    SELECT a.value, a.sub_category FROM public.rule_entries a
    WHERE a.rule_set_version_id = p_version_a
    AND NOT EXISTS (
      SELECT 1 FROM public.rule_entries b
      WHERE b.rule_set_version_id = p_version_b
        AND b.value = a.value
        AND COALESCE(b.sub_category, '') = COALESCE(a.sub_category, '')
    )
  ) t;

  SELECT COUNT(*) INTO v_unchanged_count FROM public.rule_entries a
  WHERE a.rule_set_version_id = p_version_a
  AND EXISTS (
    SELECT 1 FROM public.rule_entries b
    WHERE b.rule_set_version_id = p_version_b
      AND b.value = a.value
      AND COALESCE(b.sub_category, '') = COALESCE(a.sub_category, '')
  );

  SELECT thresholds INTO v_thresholds_a FROM public.rule_set_versions WHERE id = p_version_a;
  SELECT thresholds INTO v_thresholds_b FROM public.rule_set_versions WHERE id = p_version_b;

  RETURN jsonb_build_object(
    'version_a', v_va,
    'version_b', v_vb,
    'added_entries', v_added,
    'removed_entries', v_removed,
    'unchanged_entries_count', v_unchanged_count,
    'thresholds_changed', CASE
      WHEN v_thresholds_a IS DISTINCT FROM v_thresholds_b
        THEN jsonb_build_object('from', v_thresholds_a, 'to', v_thresholds_b)
      ELSE NULL
    END
  );
END; $$;


-- ══════════════════════════════════════════════════════════════════════
-- 5. admin_rules_preview_impact (1 subquery-alias hit)
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_rules_preview_impact(
  p_rule_set_id UUID,
  p_proposed_entries TEXT[],
  p_proposed_thresholds JSONB DEFAULT NULL,
  p_city_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    SELECT COUNT(*) INTO v_would_modify FROM (
      SELECT pp.id FROM public.place_pool pp
      WHERE pp.is_active = true
        AND (p_city_id IS NULL OR pp.city_id = p_city_id)
        AND v_scope_value = ANY(pp.ai_categories)
        AND EXISTS (
          SELECT 1 FROM unnest(p_proposed_entries) AS e
          WHERE lower(pp.name) LIKE '%' || lower(e) || '%'
        )
      LIMIT v_max_eval
    ) t;

  ELSIF v_kind = 'strip' THEN
    SELECT COUNT(*) INTO v_would_modify FROM (
      SELECT pp.id FROM public.place_pool pp
      WHERE pp.is_active = true
        AND (p_city_id IS NULL OR pp.city_id = p_city_id)
        AND v_scope_value = ANY(pp.ai_categories)
        AND (pp.primary_type = ANY(p_proposed_entries) OR pp.types && p_proposed_entries)
      LIMIT v_max_eval
    ) t;

  ELSIF v_kind = 'promotion' THEN
    DECLARE v_price_levels TEXT[]; v_rating_min REAL;
    BEGIN
      v_price_levels := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_proposed_thresholds, '{"price_levels":[]}'::jsonb)->'price_levels'));
      v_rating_min := COALESCE((p_proposed_thresholds->>'rating_min')::REAL, 4.0);

      SELECT COUNT(*) INTO v_would_modify FROM (
        SELECT pp.id FROM public.place_pool pp
        WHERE pp.is_active = true
          AND (p_city_id IS NULL OR pp.city_id = p_city_id)
          AND pp.price_level = ANY(v_price_levels)
          AND pp.rating >= v_rating_min
          AND NOT (v_scope_value = ANY(COALESCE(pp.ai_categories, '{}'::TEXT[])))
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

  -- Sample affected places (up to 5)
  IF v_kind IN ('blacklist', 'demotion', 'strip', 'promotion', 'min_data_guard') THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_sample FROM (
      SELECT pp.id AS place_id, pp.name, pp.address, pp.ai_categories AS current_categories,
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
            v_scope_value = ANY(pp.ai_categories) AND
            EXISTS (SELECT 1 FROM unnest(p_proposed_entries) AS e WHERE lower(pp.name) LIKE '%' || lower(e) || '%')
          WHEN v_kind = 'strip' THEN
            v_scope_value = ANY(pp.ai_categories) AND
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
END; $$;


-- ══════════════════════════════════════════════════════════════════════
-- 6. admin_rules_runs (1 subquery-alias hit)
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_rules_runs(
  p_city_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result JSONB; v_total INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM public.ai_validation_jobs avj
  WHERE avj.stage IN ('rules_only', 'rules_only_complete')
    AND (p_city_id IS NULL OR avj.city_id = p_city_id);

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_result FROM (
    SELECT
      avj.id,
      avj.status,
      avj.stage,
      avj.dry_run,
      avj.total_places,
      avj.processed,
      avj.rejected,
      avj.reclassified,
      avj.unchanged,
      avj.cost_usd,
      avj.rules_version_id,
      (SELECT manifest_label FROM public.rules_versions WHERE id = avj.rules_version_id) AS manifest_label,
      avj.city_id,
      avj.city_filter,
      avj.triggered_by,
      (SELECT email FROM public.admin_users WHERE id = avj.triggered_by) AS triggered_by_email,
      avj.created_at,
      avj.started_at,
      avj.completed_at,
      EXTRACT(EPOCH FROM (avj.completed_at - avj.started_at))::INT AS duration_seconds
    FROM public.ai_validation_jobs avj
    WHERE avj.stage IN ('rules_only', 'rules_only_complete')
      AND (p_city_id IS NULL OR avj.city_id = p_city_id)
    ORDER BY avj.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN jsonb_build_object('runs', v_result, 'total', v_total, 'limit', p_limit, 'offset', p_offset);
END; $$;


-- ══════════════════════════════════════════════════════════════════════
-- 7. admin_rules_run_detail (2 subquery-alias + 1 table-alias = 3 hits)
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_rules_run_detail(p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_run JSONB; v_manifest JSONB; v_top_rules JSONB; v_affected_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT to_jsonb(t) INTO v_run FROM (
    SELECT avj.*, (SELECT email FROM public.admin_users WHERE id = avj.triggered_by) AS triggered_by_email
    FROM public.ai_validation_jobs avj WHERE avj.id = p_job_id
  ) t;
  IF v_run IS NULL THEN
    RAISE EXCEPTION 'Run not found: %', p_job_id;
  END IF;

  SELECT to_jsonb(rv) INTO v_manifest FROM public.rules_versions rv
  WHERE rv.id = (v_run->>'rules_version_id')::UUID;

  -- Top firing rules in this run
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_top_rules FROM (
    SELECT
      rs.id AS rule_set_id,
      rs.name AS rule_set_name,
      rs.kind,
      COUNT(*) AS fires
    FROM public.ai_validation_results avr
    JOIN public.rule_set_versions rsv ON rsv.id = avr.rule_set_version_id
    JOIN public.rule_sets rs ON rs.id = rsv.rule_set_id
    WHERE avr.job_id = p_job_id
    GROUP BY rs.id, rs.name, rs.kind
    ORDER BY COUNT(*) DESC
    LIMIT 5
  ) t;

  SELECT COUNT(*) INTO v_affected_count FROM public.ai_validation_results WHERE job_id = p_job_id;

  RETURN jsonb_build_object(
    'run', v_run,
    'rules_version', v_manifest,
    'top_firing_rules', v_top_rules,
    'affected_places_count', v_affected_count
  );
END; $$;


-- ══════════════════════════════════════════════════════════════════════
-- 8. admin_rules_run_diff (3 subquery-alias hits)
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_rules_run_diff(p_job_a UUID, p_job_b UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_a JSONB; v_b JSONB; v_rule_diff JSONB; v_delta JSONB;
  v_a_places JSONB; v_b_places JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT to_jsonb(t) INTO v_a FROM (
    SELECT id, status, processed, rejected, reclassified, unchanged, city_filter, completed_at
    FROM public.ai_validation_jobs WHERE id = p_job_a
  ) t;
  SELECT to_jsonb(t) INTO v_b FROM (
    SELECT id, status, processed, rejected, reclassified, unchanged, city_filter, completed_at
    FROM public.ai_validation_jobs WHERE id = p_job_b
  ) t;

  IF v_a IS NULL OR v_b IS NULL THEN
    RAISE EXCEPTION 'One or both runs not found';
  END IF;

  -- Per-rule fires comparison
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rule_diff FROM (
    SELECT
      rs.name AS rule_set_name,
      COUNT(*) FILTER (WHERE avr.job_id = p_job_a) AS fires_a,
      COUNT(*) FILTER (WHERE avr.job_id = p_job_b) AS fires_b
    FROM public.ai_validation_results avr
    JOIN public.rule_set_versions rsv ON rsv.id = avr.rule_set_version_id
    JOIN public.rule_sets rs ON rs.id = rsv.rule_set_id
    WHERE avr.job_id IN (p_job_a, p_job_b)
    GROUP BY rs.name
    ORDER BY (COUNT(*) FILTER (WHERE avr.job_id = p_job_a) + COUNT(*) FILTER (WHERE avr.job_id = p_job_b)) DESC
  ) t;

  -- Place-set delta (additional vs no_longer)
  WITH places_a AS (SELECT DISTINCT place_id FROM public.ai_validation_results WHERE job_id = p_job_a),
       places_b AS (SELECT DISTINCT place_id FROM public.ai_validation_results WHERE job_id = p_job_b)
  SELECT jsonb_build_object(
    'additional_in_b', (SELECT COUNT(*) FROM places_b WHERE place_id NOT IN (SELECT place_id FROM places_a)),
    'no_longer_in_b', (SELECT COUNT(*) FROM places_a WHERE place_id NOT IN (SELECT place_id FROM places_b)),
    'in_both', (SELECT COUNT(*) FROM places_a WHERE place_id IN (SELECT place_id FROM places_b))
  ) INTO v_delta;

  RETURN jsonb_build_object(
    'job_a', v_a,
    'job_b', v_b,
    'delta', v_delta,
    'rule_diff_summary', v_rule_diff
  );
END; $$;


-- ══════════════════════════════════════════════════════════════════════
-- 9. admin_rules_export (1 subquery-alias hit)
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_rules_export()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result JSONB; v_current_manifest UUID; v_manifest_label TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT id, manifest_label INTO v_current_manifest, v_manifest_label
  FROM public.rules_versions ORDER BY deployed_at DESC LIMIT 1;

  SELECT jsonb_build_object(
    'exported_at', now(),
    'rules_version_id', v_current_manifest,
    'manifest_label', v_manifest_label,
    'schema_version', 1,
    'rule_sets', COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  ) INTO v_result FROM (
    SELECT
      rs.id, rs.name, rs.description, rs.kind, rs.scope_kind, rs.scope_value, rs.is_active,
      rsv.id AS version_id,
      rsv.version_number,
      rsv.thresholds,
      (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'value', re.value, 'sub_category', re.sub_category,
          'position', re.position, 'reason', re.reason
        ) ORDER BY re.position, re.value), '[]'::jsonb)
        FROM public.rule_entries re WHERE re.rule_set_version_id = rsv.id
      ) AS entries
    FROM public.rule_sets rs
    JOIN public.rule_set_versions rsv ON rsv.id = rs.current_version_id
    ORDER BY rs.scope_kind, rs.scope_value NULLS FIRST, rs.name
  ) t;

  RETURN v_result;
END; $$;


-- ══════════════════════════════════════════════════════════════════════
-- 10. admin_rules_run_affected_places (1 subquery-alias hit)
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_rules_run_affected_places(
  p_job_id UUID,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_total INT; v_result JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT COUNT(*) INTO v_total FROM public.ai_validation_results WHERE job_id = p_job_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_result FROM (
    SELECT
      avr.id, avr.place_id, pp.name AS place_name, pp.address AS place_address,
      pp.primary_type, avr.decision, avr.previous_categories, avr.new_categories,
      avr.reason, avr.created_at,
      avr.rule_set_version_id,
      rs.name AS rule_set_name,
      rsv.version_number AS rule_set_version_number
    FROM public.ai_validation_results avr
    JOIN public.place_pool pp ON pp.id = avr.place_id
    LEFT JOIN public.rule_set_versions rsv ON rsv.id = avr.rule_set_version_id
    LEFT JOIN public.rule_sets rs ON rs.id = rsv.rule_set_id
    WHERE avr.job_id = p_job_id
    ORDER BY avr.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN jsonb_build_object('places', v_result, 'total', v_total, 'limit', p_limit, 'offset', p_offset);
END; $$;


-- ══════════════════════════════════════════════════════════════════════
-- Verification probes (run as authenticated admin in Supabase SQL editor):
--
-- SELECT public.admin_rules_list(NULL, NULL, NULL, false);
--   -- expect JSONB array of 18 rule objects
--
-- SELECT public.admin_rules_runs(NULL, 5, 0);
--   -- expect {"runs": [...], "total": N, ...}
--
-- DO block (service-role context, bypasses admin gate for pattern verification):
--
-- DO $$
-- DECLARE v_result JSONB;
-- BEGIN
--   SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_result
--   FROM (SELECT rs.id, rs.name FROM public.rule_sets rs LIMIT 2) t;
--   RAISE NOTICE 'subquery-alias OK: %', v_result;
--
--   SELECT to_jsonb(rs) INTO v_result
--   FROM public.rule_sets rs LIMIT 1;
--   RAISE NOTICE 'table-alias OK: %', v_result;
-- END; $$;
-- ══════════════════════════════════════════════════════════════════════
