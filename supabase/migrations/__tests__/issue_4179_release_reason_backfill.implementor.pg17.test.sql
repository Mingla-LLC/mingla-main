-- #4179 — Missing no-effect reasons advance once without weakening immutable classifications.
-- MINGLA-INVARIANT: I-4179-RELEASE-REASON-ONE-WAY | issue #4179 | A release record with an immutable empty Feature Guide classification may fill its missing reason once; classifications and non-null reasons never change during re-ingestion.
\set ON_ERROR_STOP on
BEGIN;

SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE FUNCTION pg_temp.issue4179_record(
  p_pr integer,
  p_feature_guide jsonb,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
AS $fn$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'v', 1,
    'repo', 'Mingla-LLC/mingla-main',
    'pr', p_pr,
    'title', 'Issue 4179 reason repair proof ' || p_pr,
    'pr_url', 'https://github.com/Mingla-LLC/mingla-main/pull/' || p_pr,
    'merged_at', '2026-10-29T16:00:00Z',
    'merge_sha', md5(p_pr::text) || left(md5('issue4179' || p_pr), 8),
    'merged_by', 'sethogieva',
    'author', 'sethogieva',
    'issues', '[{"number":4179,"relation":"toward"}]'::jsonb,
    'migrations_added', '[]'::jsonb,
    'migrations_applied_state', 'none',
    'edge_functions', '[]'::jsonb,
    'web_projects', '[]'::jsonb,
    'deploy_marker', false,
    'deploy', '{"web":{},"edge":"none"}'::jsonb,
    'feature_guide', p_feature_guide,
    'feature_guide_reason', p_reason,
    'live_check', NULL,
    'test_files', '[]'::jsonb,
    'problems', '["live_check_missing"]'::jsonb
  ))
$fn$;

CREATE FUNCTION pg_temp.issue4179_ingest(p_data jsonb) RETURNS jsonb
LANGUAGE sql
AS $fn$
  SELECT public.ops_release_records_ingest(jsonb_build_array(jsonb_build_object(
    'data', p_data,
    'comment_url', 'https://github.com/Mingla-LLC/mingla-main/issues/4179#issuecomment-6502000769',
    'issue_number', 4179,
    'commented_at', '2026-10-29T16:00:00Z'
  )))
$fn$;

DO $proof$
DECLARE
  c_first_reason constant text := 'trusted parser repair only; no product capability changed';
  c_second_reason constant text := 'a later caller tried to rewrite the verified reason';
  v_result jsonb;
BEGIN
  IF has_function_privilege('authenticated', 'public.ops_release_records_ingest(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.ops_release_records_ingest(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue4179_release_ingest_authority_broadened';
  END IF;

  v_result := pg_temp.issue4179_ingest(pg_temp.issue4179_record(9904184, '[]'::jsonb));
  IF v_result->>'ingested' <> '1'
     OR NOT EXISTS (
       SELECT 1 FROM public.ops_release_records
        WHERE pr = 9904184
          AND cardinality(feature_guide) = 0
          AND feature_guide_reason IS NULL
     ) THEN
    RAISE EXCEPTION 'issue4179_missing_reason_fixture_failed:%', v_result;
  END IF;

  PERFORM pg_temp.issue4179_ingest(
    pg_temp.issue4179_record(9904184, '[]'::jsonb, c_first_reason)
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.ops_release_records
     WHERE pr = 9904184
       AND cardinality(feature_guide) = 0
       AND feature_guide_reason = c_first_reason
  ) THEN
    RAISE EXCEPTION 'issue4179_missing_reason_not_filled';
  END IF;

  PERFORM pg_temp.issue4179_ingest(
    pg_temp.issue4179_record(9904184, '[]'::jsonb, c_second_reason)
  );
  PERFORM pg_temp.issue4179_ingest(
    pg_temp.issue4179_record(9904184, '["trips-installments"]'::jsonb)
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.ops_release_records
     WHERE pr = 9904184
       AND cardinality(feature_guide) = 0
       AND feature_guide_reason = c_first_reason
  ) THEN
    RAISE EXCEPTION 'issue4179_empty_classification_or_reason_rewritten';
  END IF;

  PERFORM pg_temp.issue4179_ingest(
    pg_temp.issue4179_record(9904185, '["trips-installments"]'::jsonb)
  );
  PERFORM pg_temp.issue4179_ingest(
    pg_temp.issue4179_record(9904185, '[]'::jsonb, c_first_reason)
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.ops_release_records
     WHERE pr = 9904185
       AND feature_guide = ARRAY['trips-installments']
       AND feature_guide_reason IS NULL
  ) THEN
    RAISE EXCEPTION 'issue4179_named_classification_rewritten';
  END IF;
END;
$proof$;

ROLLBACK;
\echo 'ISSUE-4179 RELEASE REASON BACKFILL PASS'
