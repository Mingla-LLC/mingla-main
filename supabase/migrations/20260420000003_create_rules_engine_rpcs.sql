-- ═══════════════════════════════════════════════════════════════════════════════
-- ORCH-0526 M3 — Rules Engine RPCs + helpers + feature flag bootstrap
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- 12 admin RPCs powering the Rules Filter tab + 2 advisory lock helpers + 1
-- paginated helper + admin_config bootstrap (idempotent — table pre-exists).
--
-- All RPCs follow this pattern:
--   - LANGUAGE plpgsql SECURITY DEFINER
--   - First statement: admin gate (active admin_users check)
--   - Mutation RPCs additionally INSERT into admin_audit_log in same transaction
--
-- preview_impact uses Option 1 (per-rule isolated impact) per user direction
-- 2026-04-19 — does NOT simulate the full pipeline; just counts what THIS rule
-- would do in isolation. Trade-off accepted: small overestimate vs huge build cost
-- of full PL/pgSQL filter translation.
--
-- Spec ref: outputs/SPEC_ORCH-0526_RULES_FILTER_TAB.md §6 (Admin RPCs)
-- ═══════════════════════════════════════════════════════════════════════════════


-- ── Section 0: admin_config feature flag bootstrap ──────────────────────────

INSERT INTO public.admin_config (key, value)
VALUES ('enable_rules_filter_tab', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;


-- ── Section 1: Advisory lock helpers (ORCH-0529 backend) ────────────────────

CREATE OR REPLACE FUNCTION public.try_advisory_lock_rules_run(p_lock_key BIGINT)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT pg_try_advisory_xact_lock(p_lock_key);
$$;

CREATE OR REPLACE FUNCTION public.release_advisory_lock_rules_run(p_lock_key BIGINT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER AS $$
  SELECT pg_advisory_unlock(p_lock_key);
$$;

COMMENT ON FUNCTION public.try_advisory_lock_rules_run IS
  'ORCH-0529: edge function calls this at handler entry; returns false if a run is already active for the same (scope, city_id). Auto-released at txn end via pg_try_advisory_xact_lock semantics.';


-- ── Section 2: admin_rules_overview() ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_rules_overview()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_result JSONB;
  v_drift_status TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Lightweight drift signal (full drift detail comes from edge fn run_drift_check).
  -- This just counts active rules — if < 18 (the seeded minimum), something's off.
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
      SELECT COUNT(*) FROM public.ai_validation_results
      WHERE stage_resolved = 2 AND created_at >= now() - interval '7 days'
    ),
    'fires_24h', (
      SELECT COUNT(*) FROM public.ai_validation_results
      WHERE stage_resolved = 2 AND created_at >= now() - interval '24 hours'
    ),
    'current_rules_version_id', (
      SELECT id FROM public.rules_versions ORDER BY deployed_at DESC LIMIT 1
    ),
    'current_manifest_label', (
      SELECT manifest_label FROM public.rules_versions ORDER BY deployed_at DESC LIMIT 1
    ),
    'drift_status', v_drift_status,
    'vibes_ready_count', 11,  -- per audit §7: 11 deterministic vibes
    'vibes_partial_count', 5,  -- per audit §7: 5 partial vibes
    'vibes_ai_only_count', 4,  -- per audit §7: 4 AI-only vibes
    'vibes_total', 20
  ) INTO v_result;

  RETURN v_result;
END; $$;


-- ── Section 3: admin_rules_list(scope_filter, kind_filter, search) ───────────

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

  SELECT COALESCE(jsonb_agg(row_to_jsonb(t)), '[]'::jsonb) INTO v_result
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


-- ── Section 4: admin_rule_detail(rule_set_id) ────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_rule_detail(p_rule_set_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result JSONB; v_rule_set JSONB; v_current_version JSONB; v_entries JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT row_to_jsonb(rs) INTO v_rule_set FROM public.rule_sets rs WHERE rs.id = p_rule_set_id;
  IF v_rule_set IS NULL THEN
    RAISE EXCEPTION 'Rule set not found: %', p_rule_set_id USING ERRCODE = 'P0002';
  END IF;

  SELECT row_to_jsonb(rsv) INTO v_current_version
  FROM public.rule_set_versions rsv
  WHERE rsv.id = (v_rule_set->>'current_version_id')::UUID;

  SELECT COALESCE(jsonb_agg(row_to_jsonb(re) ORDER BY re.position, re.value), '[]'::jsonb) INTO v_entries
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
      SELECT jsonb_agg(row_to_jsonb(t)) FROM (
        SELECT pp.name AS place_name, avr.decision, avr.created_at, avr.reason
        FROM public.ai_validation_results avr
        JOIN public.place_pool pp ON pp.id = avr.place_id
        WHERE avr.rule_set_version_id IN (SELECT id FROM public.rule_set_versions WHERE rule_set_id = p_rule_set_id)
        ORDER BY avr.created_at DESC LIMIT 5
      ) t
    ), '[]'::jsonb)
  );
END; $$;


-- ── Section 5: admin_rule_set_versions(rule_set_id) ─────────────────────────

CREATE OR REPLACE FUNCTION public.admin_rule_set_versions(p_rule_set_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_jsonb(t) ORDER BY t.version_number DESC), '[]'::jsonb) INTO v_result
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


-- ── Section 6: admin_rule_set_diff(version_a, version_b) ────────────────────

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

  SELECT row_to_jsonb(t) INTO v_va FROM (
    SELECT id, version_number, created_at, change_summary FROM public.rule_set_versions WHERE id = p_version_a
  ) t;
  SELECT row_to_jsonb(t) INTO v_vb FROM (
    SELECT id, version_number, created_at, change_summary FROM public.rule_set_versions WHERE id = p_version_b
  ) t;

  IF v_va IS NULL OR v_vb IS NULL THEN
    RAISE EXCEPTION 'One or both versions not found';
  END IF;

  -- Entries in B that aren't in A → added
  SELECT COALESCE(jsonb_agg(row_to_jsonb(t)), '[]'::jsonb) INTO v_added FROM (
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
  SELECT COALESCE(jsonb_agg(row_to_jsonb(t)), '[]'::jsonb) INTO v_removed FROM (
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


-- ── Section 7: admin_rules_preview_impact (Option 1 — per-rule isolated) ────

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
    -- Count places whose name OR primary_type matches any proposed entry (case-insensitive)
    -- Special: BLOCKED_PRIMARY_TYPES checks primary_type only; FAST_FOOD_BLACKLIST checks name only;
    -- EXCLUSION_KEYWORDS checks both. Simplification for v1: check both, accept slight overcount on
    -- BLOCKED_PRIMARY_TYPES (which would also match name patterns coincidentally — rare in practice).
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
    -- Count places matching name AND in scope_value category
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
    -- Count places where primary_type OR types-array matches AND in scope_value category
    SELECT COUNT(*) INTO v_would_modify FROM (
      SELECT pp.id FROM public.place_pool pp
      WHERE pp.is_active = true
        AND (p_city_id IS NULL OR pp.city_id = p_city_id)
        AND v_scope_value = ANY(pp.ai_categories)
        AND (pp.primary_type = ANY(p_proposed_entries) OR pp.types && p_proposed_entries)
      LIMIT v_max_eval
    ) t;

  ELSIF v_kind = 'promotion' THEN
    -- Promotion uses thresholds, not entries. p_proposed_thresholds carries new threshold values.
    -- Count places matching threshold conditions AND not already in scope_value category.
    -- For v1: hardcoded for the 2 known promotion rules (T1: VERY_EXPENSIVE+4.0, T2: EXPENSIVE+4.0).
    -- Future-proof: could parse p_proposed_thresholds JSONB but v1 keeps it simple.
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
    -- (whitelist + keyword_set are inputs to other rules; time_window + numeric_range are vibe stubs in v1)
    v_would_modify := 0;
    v_would_reject := 0;
  END IF;

  -- Sample affected places (up to 5) — best-effort, may be empty for whitelist/keyword_set kinds
  IF v_kind IN ('blacklist', 'demotion', 'strip', 'promotion', 'min_data_guard') THEN
    SELECT COALESCE(jsonb_agg(row_to_jsonb(t)), '[]'::jsonb) INTO v_sample FROM (
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


-- ── Section 8: admin_rules_save (creates new version + manifest + audit log) ─

CREATE OR REPLACE FUNCTION public.admin_rules_save(
  p_rule_set_id UUID,
  p_new_entries JSONB,  -- Array of {value, sub_category, position, reason}
  p_change_summary TEXT,
  p_new_thresholds JSONB DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_id UUID; v_admin_email TEXT;
  v_kind TEXT; v_current_version_id UUID; v_current_version_num INT;
  v_new_version_id UUID; v_new_version_num INT;
  v_current_thresholds JSONB; v_final_thresholds JSONB;
  v_current_entries JSONB; v_diff JSONB;
  v_new_manifest_id UUID; v_audit_id UUID;
  v_existing_keys JSONB;
BEGIN
  v_admin_email := lower(auth.email());
  SELECT id INTO v_admin_id FROM public.admin_users WHERE email = v_admin_email AND status = 'active';
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT kind, current_version_id INTO v_kind, v_current_version_id
  FROM public.rule_sets WHERE id = p_rule_set_id;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'Rule set not found: %', p_rule_set_id USING ERRCODE = 'P0002';
  END IF;

  SELECT version_number, thresholds INTO v_current_version_num, v_current_thresholds
  FROM public.rule_set_versions WHERE id = v_current_version_id;
  v_new_version_num := COALESCE(v_current_version_num, 0) + 1;

  -- DEC-034 Q3: reason REQUIRED for blacklist + demotion adds; OPTIONAL for others
  -- An entry is "new" if it doesn't exist in current version
  IF v_kind IN ('blacklist', 'demotion') THEN
    SELECT COALESCE(jsonb_agg(value || COALESCE(sub_category, '')), '[]'::jsonb) INTO v_existing_keys
    FROM public.rule_entries WHERE rule_set_version_id = v_current_version_id;

    PERFORM 1 FROM jsonb_array_elements(p_new_entries) AS e
    WHERE NOT (v_existing_keys @> jsonb_build_array((e->>'value') || COALESCE(e->>'sub_category', '')))
      AND COALESCE(e->>'reason', '') = '';
    IF FOUND THEN
      RAISE EXCEPTION 'Reason required for blacklist/demotion add (DEC-034 Q3)' USING ERRCODE = '23514';
    END IF;
  END IF;

  v_final_thresholds := COALESCE(p_new_thresholds, v_current_thresholds);

  -- Snapshot current entries for audit-log diff
  SELECT COALESCE(jsonb_agg(jsonb_build_object('value', value, 'sub_category', sub_category)), '[]'::jsonb)
    INTO v_current_entries
  FROM public.rule_entries WHERE rule_set_version_id = v_current_version_id;

  -- Create new version
  INSERT INTO public.rule_set_versions (rule_set_id, version_number, change_summary, thresholds, created_by)
  VALUES (p_rule_set_id, v_new_version_num, p_change_summary, v_final_thresholds, v_admin_id)
  RETURNING id INTO v_new_version_id;

  -- Insert all proposed entries into new version
  INSERT INTO public.rule_entries (rule_set_version_id, value, sub_category, position, reason)
  SELECT
    v_new_version_id,
    lower(e->>'value'),
    NULLIF(e->>'sub_category', ''),
    COALESCE((e->>'position')::INT, ord::INT),
    NULLIF(e->>'reason', '')
  FROM jsonb_array_elements(p_new_entries) WITH ORDINALITY AS t(e, ord);

  -- Move current_version_id pointer
  UPDATE public.rule_sets SET current_version_id = v_new_version_id, updated_at = now()
  WHERE id = p_rule_set_id;

  -- New manifest (snapshot = previous manifest + this rule's new version)
  INSERT INTO public.rules_versions (manifest_label, snapshot, summary, deployed_by)
  SELECT
    format('save-%s-v%s', (SELECT name FROM public.rule_sets WHERE id = p_rule_set_id), v_new_version_num),
    COALESCE(
      (SELECT snapshot FROM public.rules_versions ORDER BY deployed_at DESC LIMIT 1),
      '{}'::jsonb
    ) || jsonb_build_object(p_rule_set_id::text, v_new_version_id::text),
    format('Saved %s v%s: %s', (SELECT name FROM public.rule_sets WHERE id = p_rule_set_id), v_new_version_num, COALESCE(p_change_summary, '(no summary)')),
    v_admin_id
  RETURNING id INTO v_new_manifest_id;

  -- Audit log (I-AUDIT-LOG-COMPLETE invariant)
  v_diff := jsonb_build_object(
    'previous_entries', v_current_entries,
    'new_entries', p_new_entries,
    'thresholds_change', CASE WHEN v_current_thresholds IS DISTINCT FROM v_final_thresholds
      THEN jsonb_build_object('from', v_current_thresholds, 'to', v_final_thresholds) ELSE NULL END
  );
  INSERT INTO public.admin_audit_log (admin_email, action, target_type, target_id, metadata)
  VALUES (
    v_admin_email,
    'rules.save',
    'rule_set',
    p_rule_set_id::text,
    jsonb_build_object('summary', p_change_summary, 'new_version_id', v_new_version_id::text, 'new_version_number', v_new_version_num, 'manifest_id', v_new_manifest_id::text, 'diff', v_diff)
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'success', true,
    'new_version_id', v_new_version_id,
    'new_version_number', v_new_version_num,
    'new_rules_version_id', v_new_manifest_id,
    'audit_log_id', v_audit_id
  );
END; $$;


-- ── Section 9: admin_rules_rollback (creates new version matching target) ───

CREATE OR REPLACE FUNCTION public.admin_rules_rollback(
  p_rule_set_id UUID,
  p_target_version_id UUID,
  p_reason TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_id UUID; v_admin_email TEXT;
  v_target_version_num INT; v_target_thresholds JSONB; v_target_entries JSONB;
  v_save_result JSONB; v_audit_id UUID;
  v_current_version_num INT;
BEGIN
  v_admin_email := lower(auth.email());
  SELECT id INTO v_admin_id FROM public.admin_users WHERE email = v_admin_email AND status = 'active';
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT version_number, thresholds INTO v_target_version_num, v_target_thresholds
  FROM public.rule_set_versions
  WHERE id = p_target_version_id AND rule_set_id = p_rule_set_id;
  IF v_target_version_num IS NULL THEN
    RAISE EXCEPTION 'Target version not found or does not belong to this rule set';
  END IF;

  SELECT version_number INTO v_current_version_num
  FROM public.rule_set_versions
  WHERE id = (SELECT current_version_id FROM public.rule_sets WHERE id = p_rule_set_id);

  -- Build entries array from target version
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'value', value, 'sub_category', sub_category,
    'position', position, 'reason', COALESCE(reason, format('Rolled back to v%s', v_target_version_num))
  )), '[]'::jsonb) INTO v_target_entries
  FROM public.rule_entries
  WHERE rule_set_version_id = p_target_version_id;

  -- Delegate to save (which creates new version + manifest + base audit log)
  v_save_result := public.admin_rules_save(
    p_rule_set_id,
    v_target_entries,
    format('Rollback v%s → v%s: %s', v_current_version_num, v_target_version_num, p_reason),
    v_target_thresholds
  );

  -- Additional audit log entry distinguishing rollback from generic save
  INSERT INTO public.admin_audit_log (admin_email, action, target_type, target_id, metadata)
  VALUES (
    v_admin_email,
    'rules.rollback',
    'rule_set',
    p_rule_set_id::text,
    jsonb_build_object(
      'rolled_back_from_version', v_current_version_num,
      'rolled_back_to_version', v_target_version_num,
      'new_version_id', v_save_result->>'new_version_id',
      'reason', p_reason
    )
  )
  RETURNING id INTO v_audit_id;

  RETURN v_save_result || jsonb_build_object(
    'rolled_back_from_version', v_current_version_num,
    'rolled_back_to_version', v_target_version_num,
    'rollback_audit_log_id', v_audit_id
  );
END; $$;


-- ── Section 10: admin_rules_runs(city_id, limit, offset) ────────────────────

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

  -- Filter to rules-only runs (stage='rules_only' for in-flight, 'rules_only_complete' for finished)
  SELECT COUNT(*) INTO v_total
  FROM public.ai_validation_jobs avj
  WHERE avj.stage IN ('rules_only', 'rules_only_complete')
    AND (p_city_id IS NULL OR avj.city_id = p_city_id);

  SELECT COALESCE(jsonb_agg(row_to_jsonb(t)), '[]'::jsonb) INTO v_result FROM (
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


-- ── Section 11: admin_rules_run_detail(job_id) ──────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_rules_run_detail(p_job_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_run JSONB; v_manifest JSONB; v_top_rules JSONB; v_affected_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT row_to_jsonb(t) INTO v_run FROM (
    SELECT avj.*, (SELECT email FROM public.admin_users WHERE id = avj.triggered_by) AS triggered_by_email
    FROM public.ai_validation_jobs avj WHERE avj.id = p_job_id
  ) t;
  IF v_run IS NULL THEN
    RAISE EXCEPTION 'Run not found: %', p_job_id;
  END IF;

  SELECT row_to_jsonb(rv) INTO v_manifest FROM public.rules_versions rv
  WHERE rv.id = (v_run->>'rules_version_id')::UUID;

  -- Top firing rules in this run
  SELECT COALESCE(jsonb_agg(row_to_jsonb(t)), '[]'::jsonb) INTO v_top_rules FROM (
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


-- ── Section 12: admin_rules_run_diff(job_a, job_b) ──────────────────────────

CREATE OR REPLACE FUNCTION public.admin_rules_run_diff(p_job_a UUID, p_job_b UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_a JSONB; v_b JSONB; v_rule_diff JSONB; v_delta JSONB;
  v_a_places JSONB; v_b_places JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT row_to_jsonb(t) INTO v_a FROM (
    SELECT id, status, processed, rejected, reclassified, unchanged, city_filter, completed_at
    FROM public.ai_validation_jobs WHERE id = p_job_a
  ) t;
  SELECT row_to_jsonb(t) INTO v_b FROM (
    SELECT id, status, processed, rejected, reclassified, unchanged, city_filter, completed_at
    FROM public.ai_validation_jobs WHERE id = p_job_b
  ) t;

  IF v_a IS NULL OR v_b IS NULL THEN
    RAISE EXCEPTION 'One or both runs not found';
  END IF;

  -- Per-rule fires comparison
  SELECT COALESCE(jsonb_agg(row_to_jsonb(t)), '[]'::jsonb) INTO v_rule_diff FROM (
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


-- ── Section 13: admin_rules_export() — JSON manifest for backup (DEC-034 Q2) ─

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
    'rule_sets', COALESCE(jsonb_agg(row_to_jsonb(t)), '[]'::jsonb)
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


-- ── Section 14: admin_rules_run_affected_places (paginated) ─────────────────

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

  SELECT COALESCE(jsonb_agg(row_to_jsonb(t)), '[]'::jsonb) INTO v_result FROM (
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


-- ── Section 15: Permissions (allow authenticated callers via RPC pattern) ───

-- All RPCs are SECURITY DEFINER with internal admin gate; grant EXECUTE to authenticated.
-- RLS on the underlying tables protects against direct table access.
GRANT EXECUTE ON FUNCTION public.admin_rules_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rules_list(TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rule_detail(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rule_set_versions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rule_set_diff(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rules_preview_impact(UUID, TEXT[], JSONB, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rules_save(UUID, JSONB, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rules_rollback(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rules_runs(UUID, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rules_run_detail(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rules_run_diff(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rules_export() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_rules_run_affected_places(UUID, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.try_advisory_lock_rules_run(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_advisory_lock_rules_run(BIGINT) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════════
-- END OF M3 — 12 admin RPCs + 1 paginated helper + 2 advisory lock helpers + 1 admin_config row.
--
-- Verification checklist (run post-deploy):
--   SELECT routine_name FROM information_schema.routines
--     WHERE routine_schema='public' AND routine_name LIKE 'admin_rules%'
--     ORDER BY routine_name;
--                                                       -- expect 11 admin_rules_* rows
--   SELECT routine_name FROM information_schema.routines
--     WHERE routine_schema='public' AND routine_name IN
--     ('admin_rule_detail', 'admin_rule_set_versions', 'admin_rule_set_diff',
--      'try_advisory_lock_rules_run', 'release_advisory_lock_rules_run');
--                                                       -- expect 5 rows
--   SELECT key, value FROM admin_config WHERE key='enable_rules_filter_tab';
--                                                       -- expect (enable_rules_filter_tab, false)
--   SELECT public.admin_rules_overview();               -- requires admin auth; expect health JSON
--   SELECT public.admin_rules_list();                   -- requires admin auth; expect 18 rules
-- ═══════════════════════════════════════════════════════════════════════════════
