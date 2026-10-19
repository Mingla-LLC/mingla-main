-- Issue #3720 Wave 3 upkeep — weekly Feature Guide drift notes through the
-- existing Product Inbox ↔ Avengers sync worker.
--
-- INVARIANT: {"id":"I-3720-FEATURE-GUIDE-WEEKLY-DRIFT","rule":"At most one Feature Guide drift note is posted per ISO week; a failed or abandoned attempt may be reclaimed, and only the service-owned Avengers sync path can claim or complete a run."}

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $foundation$
BEGIN
  IF to_regclass('public.product_capabilities') IS NULL
     OR to_regclass('public.product_capability_evidence') IS NULL
     OR to_regclass('public.product_avengers_commands') IS NULL
     OR to_regprocedure('public.issue_3720_feature_guide_effective_status(uuid)') IS NULL THEN
    RAISE EXCEPTION 'issue3720_feature_guide_drift_foundation_missing';
  END IF;
END;
$foundation$;

CREATE TABLE public.feature_guide_drift_runs (
  week_start date PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('running', 'posted', 'failed')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  issue_comment_id text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object'),
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feature_guide_drift_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.feature_guide_drift_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.feature_guide_drift_runs TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3720_feature_guide_drift_snapshot()
RETURNS TABLE (
  capability_key text,
  title text,
  effective_status text,
  verification_due_at timestamptz,
  pinned_source_urls text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.capability_key,
         c.title,
         public.issue_3720_feature_guide_effective_status(c.id),
         c.verification_due_at,
         COALESCE(
           array_agg(e.evidence_url ORDER BY e.evidence_url)
             FILTER (WHERE e.evidence_url IS NOT NULL),
           ARRAY[]::text[]
         )
    FROM public.product_capabilities c
    LEFT JOIN public.product_capability_evidence e
      ON e.capability_id = c.id
     AND e.evidence_kind = 'source'
     AND e.is_current
   GROUP BY c.id, c.capability_key, c.title, c.verification_due_at
   ORDER BY c.capability_key
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_claim_feature_guide_drift(
  p_week_start date
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claimed boolean := false;
BEGIN
  IF p_week_start IS NULL OR extract(isodow FROM p_week_start) <> 1 THEN
    RAISE EXCEPTION 'invalid_week_start' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.feature_guide_drift_runs(week_start, state)
  VALUES (p_week_start, 'running')
  ON CONFLICT (week_start) DO UPDATE
    SET state = 'running',
        attempts = public.feature_guide_drift_runs.attempts + 1,
        error_code = NULL,
        started_at = now(),
        updated_at = now()
  WHERE (public.feature_guide_drift_runs.state = 'failed'
    AND public.feature_guide_drift_runs.updated_at <= now() - interval '30 minutes')
     OR (public.feature_guide_drift_runs.state = 'running'
    AND public.feature_guide_drift_runs.started_at <= now() - interval '30 minutes')
  RETURNING true INTO v_claimed;
  RETURN COALESCE(v_claimed, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_complete_feature_guide_drift(
  p_week_start date,
  p_comment_id text,
  p_summary jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NULLIF(btrim(COALESCE(p_comment_id, '')), '') IS NULL
     OR jsonb_typeof(COALESCE(p_summary, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'invalid_drift_completion' USING ERRCODE = '22023';
  END IF;
  UPDATE public.feature_guide_drift_runs
     SET state = 'posted',
         issue_comment_id = p_comment_id,
         summary = p_summary,
         error_code = NULL,
         completed_at = now(),
         updated_at = now()
   WHERE week_start = p_week_start
     AND state = 'running';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'drift_run_not_claimed' USING ERRCODE = '55000';
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_3720_fail_feature_guide_drift(
  p_week_start date,
  p_error_code text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.feature_guide_drift_runs
     SET state = 'failed',
         error_code = left(COALESCE(NULLIF(btrim(p_error_code), ''), 'DRIFT_FAILED'), 80),
         updated_at = now()
   WHERE week_start = p_week_start
     AND state = 'running';
  RETURN FOUND;
END;
$$;

DO $privileges$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.issue_3720_feature_guide_drift_snapshot()',
    'public.issue_3720_claim_feature_guide_drift(date)',
    'public.issue_3720_complete_feature_guide_drift(date,text,jsonb)',
    'public.issue_3720_fail_feature_guide_drift(date,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);
  END LOOP;
END;
$privileges$;

DO $guard$
BEGIN
  IF has_table_privilege('authenticated', 'public.feature_guide_drift_runs', 'SELECT')
     OR has_function_privilege('authenticated', 'public.issue_3720_feature_guide_drift_snapshot()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_3720_claim_feature_guide_drift(date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue3720_feature_guide_drift_acl_invalid';
  END IF;
END;
$guard$;

COMMIT;
