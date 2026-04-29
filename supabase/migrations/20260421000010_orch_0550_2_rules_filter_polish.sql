-- ORCH-0550.2 — Rules Filter polish (ORCH-0544 prefix/echo + ORCH-0545 prior-verdict)
--
-- Spec: Mingla_Artifacts/outputs/SPEC_ORCH-0550_2_RULES_FILTER_POLISH.md
-- Investigation: Mingla_Artifacts/outputs/INVESTIGATION_ORCH-0550_2_RULES_FILTER_POLISH.md
--
-- Changes in this migration:
--   1. Composite index on ai_validation_results (place_id, created_at DESC) — speeds up
--      the new LATERAL prior-verdict lookup from ~7ms to sub-2ms at current scale,
--      future-proofs against 10x catalog growth.
--   2. CREATE OR REPLACE admin_rules_run_affected_places — adds prior_decision,
--      prior_reason, prior_created_at fields via LEFT JOIN LATERAL. Schema unchanged;
--      output gains 3 fields. NULL when no prior verdict exists for the place.
--
-- Invariants:
--   - I-PRIOR-VERDICT-COMPUTED-LIVE (new): prior verdict is computed from
--     ai_validation_results via LATERAL subquery; no separate storage; always fresh.
--   - I-AI-VALIDATION-RESULTS-IMMUTABLE (carried): no UPDATE/DELETE of historical rows.
--   - I-RULE-VERSION-IMMUTABLE (carried): no rule_set_versions writes.
--
-- Per migration-chain rule (MEMORY: feedback_forensic_thoroughness), this CREATE OR
-- REPLACE supersedes the prior body in 20260420000005_fix_rules_rpcs_to_jsonb.sql.
-- Do NOT edit that file — last-writer wins.
--
-- Rollback: see spec §12 — single CREATE OR REPLACE reverting to prior body, plus
-- optional DROP INDEX IF EXISTS idx_avr_place_id_created_at.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Composite index (additive, idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_avr_place_id_created_at
  ON public.ai_validation_results (place_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. admin_rules_run_affected_places — add prior-verdict fields via LATERAL
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_rules_run_affected_places(
  p_job_id UUID, p_limit INT DEFAULT 50, p_offset INT DEFAULT 0
)
RETURNS JSONB
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
  FROM public.ai_validation_results
  WHERE job_id = p_job_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_result FROM (
    SELECT
      avr.id, avr.place_id, pp.name AS place_name, pp.address AS place_address,
      pp.primary_type, avr.decision, avr.previous_categories, avr.new_categories,
      avr.reason, avr.created_at,
      avr.rule_set_version_id,
      rs.name AS rule_set_name,
      rsv.version_number AS rule_set_version_number,
      prior.decision    AS prior_decision,
      prior.reason      AS prior_reason,
      prior.created_at  AS prior_created_at
    FROM public.ai_validation_results avr
    JOIN public.place_pool pp ON pp.id = avr.place_id
    LEFT JOIN public.rule_set_versions rsv ON rsv.id = avr.rule_set_version_id
    LEFT JOIN public.rule_sets rs ON rs.id = rsv.rule_set_id
    LEFT JOIN LATERAL (
      SELECT prev.decision, prev.reason, prev.created_at
      FROM public.ai_validation_results prev
      WHERE prev.place_id = avr.place_id
        AND prev.created_at < avr.created_at
      ORDER BY prev.created_at DESC
      LIMIT 1
    ) prior ON true
    WHERE avr.job_id = p_job_id
    ORDER BY avr.created_at DESC
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

-- Re-grant (idempotent — already granted by ORCH-0526 migration)
GRANT EXECUTE ON FUNCTION public.admin_rules_run_affected_places(UUID, INT, INT) TO authenticated;
