-- ORCH-0640 ch05 — Rewrite 7 admin_rules_* RPCs to reference renamed tables (DEC-045)
-- Mechanical find/replace:
--   public.ai_validation_jobs    → public.rules_runs
--   public.ai_validation_results → public.rules_run_results
-- Post-carveout, the stage IN ('rules_only','rules_only_complete') filter in
-- admin_rules_runs becomes tautological (pure-AI rows were DELETEd in ch02) — dropped.
--
-- The other 5 admin_rules_* RPCs (admin_rule_set_diff, admin_rule_set_versions,
-- admin_rules_export, admin_rules_preview_impact, admin_rules_rollback, admin_rules_save)
-- do NOT reference ai_validation_* — no rewrite needed.
-- MUST run AFTER ch02 rename (migration 20260425000002).

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. admin_rule_detail — swap ai_validation_results → rules_run_results
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_rule_detail(p_rule_set_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
        SELECT COUNT(*) FROM public.rules_run_results
        WHERE rule_set_version_id IN (SELECT id FROM public.rule_set_versions WHERE rule_set_id = p_rule_set_id)
          AND decision = 'reject' AND created_at >= now() - interval '7 days'
      ),
      'modify', (
        SELECT COUNT(*) FROM public.rules_run_results
        WHERE rule_set_version_id IN (SELECT id FROM public.rule_set_versions WHERE rule_set_id = p_rule_set_id)
          AND decision = 'reclassify' AND created_at >= now() - interval '7 days'
      )
    ),
    'most_recent_fires', COALESCE((
      SELECT jsonb_agg(to_jsonb(t)) FROM (
        SELECT pp.name AS place_name, rrr.decision, rrr.created_at, rrr.reason
        FROM public.rules_run_results rrr
        JOIN public.place_pool pp ON pp.id = rrr.place_id
        WHERE rrr.rule_set_version_id IN (SELECT id FROM public.rule_set_versions WHERE rule_set_id = p_rule_set_id)
        ORDER BY rrr.created_at DESC LIMIT 5
      ) t
    ), '[]'::jsonb)
  );
END; $function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. admin_rules_list — swap ai_validation_results → rules_run_results
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_rules_list(p_scope_filter text DEFAULT NULL::text, p_kind_filter text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_show_only_never_fired boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      rs.id, rs.name, rs.description, rs.kind, rs.scope_kind, rs.scope_value,
      rs.is_active, rs.current_version_id,
      rsv.version_number AS current_version_number,
      (SELECT COUNT(*) FROM public.rule_entries WHERE rule_set_version_id = rs.current_version_id) AS entry_count,
      (
        SELECT MAX(rrr.created_at) FROM public.rules_run_results rrr
        WHERE rrr.rule_set_version_id IN (
          SELECT id FROM public.rule_set_versions WHERE rule_set_id = rs.id
        )
      ) AS last_fired_at,
      (
        SELECT COUNT(*) FROM public.rules_run_results rrr
        WHERE rrr.rule_set_version_id IN (
          SELECT id FROM public.rule_set_versions WHERE rule_set_id = rs.id
        ) AND rrr.created_at >= now() - interval '7 days'
      ) AS fires_7d,
      (
        SELECT COUNT(*) FROM public.rules_run_results rrr
        WHERE rrr.rule_set_version_id IN (
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
END; $function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. admin_rules_overview — swap ai_validation_results → rules_run_results
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_rules_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_result JSONB;
  v_drift_status TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF (SELECT COUNT(*) FROM public.rule_sets WHERE is_active = true) < 18 THEN
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
END; $function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. admin_rules_run_affected_places — swap ai_validation_results → rules_run_results
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_rules_run_affected_places(p_job_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_total INT; v_result JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = lower(auth.email()) AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM public.rules_run_results
  WHERE job_id = p_job_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_result FROM (
    SELECT
      rrr.id, rrr.place_id, pp.name AS place_name, pp.address AS place_address,
      pp.primary_type, rrr.decision, rrr.previous_categories, rrr.new_categories,
      rrr.reason, rrr.created_at,
      rrr.rule_set_version_id,
      rs.name AS rule_set_name,
      rsv.version_number AS rule_set_version_number,
      prior.decision    AS prior_decision,
      prior.reason      AS prior_reason,
      prior.created_at  AS prior_created_at
    FROM public.rules_run_results rrr
    JOIN public.place_pool pp ON pp.id = rrr.place_id
    LEFT JOIN public.rule_set_versions rsv ON rsv.id = rrr.rule_set_version_id
    LEFT JOIN public.rule_sets rs ON rs.id = rsv.rule_set_id
    LEFT JOIN LATERAL (
      SELECT prev.decision, prev.reason, prev.created_at
      FROM public.rules_run_results prev
      WHERE prev.place_id = rrr.place_id
        AND prev.created_at < rrr.created_at
      ORDER BY prev.created_at DESC
      LIMIT 1
    ) prior ON true
    WHERE rrr.job_id = p_job_id
    ORDER BY rrr.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN jsonb_build_object(
    'places', v_result,
    'total',  v_total,
    'limit',  p_limit,
    'offset', p_offset
  );
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. admin_rules_run_detail — swap ai_validation_jobs → rules_runs + results
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_rules_run_detail(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_run JSONB; v_manifest JSONB; v_top_rules JSONB; v_affected_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT to_jsonb(t) INTO v_run FROM (
    SELECT rr.*, (SELECT email FROM public.admin_users WHERE id = rr.triggered_by) AS triggered_by_email
    FROM public.rules_runs rr WHERE rr.id = p_job_id
  ) t;
  IF v_run IS NULL THEN
    RAISE EXCEPTION 'Run not found: %', p_job_id;
  END IF;

  SELECT to_jsonb(rv) INTO v_manifest FROM public.rules_versions rv
  WHERE rv.id = (v_run->>'rules_version_id')::UUID;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_top_rules FROM (
    SELECT
      rs.id AS rule_set_id,
      rs.name AS rule_set_name,
      rs.kind,
      COUNT(*) AS fires
    FROM public.rules_run_results rrr
    JOIN public.rule_set_versions rsv ON rsv.id = rrr.rule_set_version_id
    JOIN public.rule_sets rs ON rs.id = rsv.rule_set_id
    WHERE rrr.job_id = p_job_id
    GROUP BY rs.id, rs.name, rs.kind
    ORDER BY COUNT(*) DESC
    LIMIT 5
  ) t;

  SELECT COUNT(*) INTO v_affected_count FROM public.rules_run_results WHERE job_id = p_job_id;

  RETURN jsonb_build_object(
    'run', v_run,
    'rules_version', v_manifest,
    'top_firing_rules', v_top_rules,
    'affected_places_count', v_affected_count
  );
END; $function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. admin_rules_run_diff — swap ai_validation_jobs → rules_runs + results
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_rules_run_diff(p_job_a uuid, p_job_b uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_a JSONB; v_b JSONB; v_rule_diff JSONB; v_delta JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT to_jsonb(t) INTO v_a FROM (
    SELECT id, status, processed, rejected, reclassified, unchanged, city_filter, completed_at
    FROM public.rules_runs WHERE id = p_job_a
  ) t;
  SELECT to_jsonb(t) INTO v_b FROM (
    SELECT id, status, processed, rejected, reclassified, unchanged, city_filter, completed_at
    FROM public.rules_runs WHERE id = p_job_b
  ) t;

  IF v_a IS NULL OR v_b IS NULL THEN
    RAISE EXCEPTION 'One or both runs not found';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rule_diff FROM (
    SELECT
      rs.name AS rule_set_name,
      COUNT(*) FILTER (WHERE rrr.job_id = p_job_a) AS fires_a,
      COUNT(*) FILTER (WHERE rrr.job_id = p_job_b) AS fires_b
    FROM public.rules_run_results rrr
    JOIN public.rule_set_versions rsv ON rsv.id = rrr.rule_set_version_id
    JOIN public.rule_sets rs ON rs.id = rsv.rule_set_id
    WHERE rrr.job_id IN (p_job_a, p_job_b)
    GROUP BY rs.name
    ORDER BY (COUNT(*) FILTER (WHERE rrr.job_id = p_job_a) + COUNT(*) FILTER (WHERE rrr.job_id = p_job_b)) DESC
  ) t;

  WITH places_a AS (SELECT DISTINCT place_id FROM public.rules_run_results WHERE job_id = p_job_a),
       places_b AS (SELECT DISTINCT place_id FROM public.rules_run_results WHERE job_id = p_job_b)
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
END; $function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. admin_rules_runs — swap ai_validation_jobs → rules_runs; drop stage filter
--    (post-carveout, ALL rows in rules_runs are rules-runs — filter tautological)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_rules_runs(p_city_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_result JSONB; v_total INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- ORCH-0640 ch05: stage IN ('rules_only','rules_only_complete') filter removed post-carveout.
  -- All rows in rules_runs are now Rules Engine runs by definition (pure-AI rows were
  -- DELETEd in ch02). Keeping the filter would be dead code.
  SELECT COUNT(*) INTO v_total
  FROM public.rules_runs rr
  WHERE (p_city_id IS NULL OR rr.city_id = p_city_id);

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_result FROM (
    SELECT
      rr.id,
      rr.status,
      rr.stage,
      rr.dry_run,
      rr.total_places,
      rr.processed,
      rr.rejected,
      rr.reclassified,
      rr.unchanged,
      rr.cost_usd,
      rr.rules_version_id,
      (SELECT manifest_label FROM public.rules_versions WHERE id = rr.rules_version_id) AS manifest_label,
      rr.city_id,
      rr.city_filter,
      rr.triggered_by,
      (SELECT email FROM public.admin_users WHERE id = rr.triggered_by) AS triggered_by_email,
      rr.created_at,
      rr.started_at,
      rr.completed_at,
      EXTRACT(EPOCH FROM (rr.completed_at - rr.started_at))::INT AS duration_seconds
    FROM public.rules_runs rr
    WHERE (p_city_id IS NULL OR rr.city_id = p_city_id)
    ORDER BY rr.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN jsonb_build_object('runs', v_result, 'total', v_total, 'limit', p_limit, 'offset', p_offset);
END; $function$;

COMMIT;
