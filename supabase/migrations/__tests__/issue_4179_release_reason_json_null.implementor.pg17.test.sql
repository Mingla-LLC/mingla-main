-- #4179 — The merge bot's explicit JSON null is the same as an absent no-effect reason.
-- MINGLA-INVARIANT: I-4179-RELEASE-REASON-JSON-NULL | issue #4179 | A keyed Feature Guide release record accepts an absent or explicit JSON-null reason, while a non-null reason remains forbidden.
\set ON_ERROR_STOP on
BEGIN;

SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE FUNCTION pg_temp.issue4179_json_null_record(
  p_pr integer,
  p_feature_guide jsonb,
  p_reason jsonb
) RETURNS jsonb
LANGUAGE sql
AS $fn$
  SELECT jsonb_build_object(
    'v', 1,
    'repo', 'Mingla-LLC/mingla-main',
    'pr', p_pr,
    'title', 'Issue 4179 explicit-null proof ' || p_pr,
    'pr_url', 'https://github.com/Mingla-LLC/mingla-main/pull/' || p_pr,
    'merged_at', '2026-10-29T17:29:48Z',
    'merge_sha', md5(p_pr::text) || left(md5('issue4179-json-null' || p_pr), 8),
    'merged_by', 'sethogieva',
    'author', 'sethogieva',
    'issues', '[{"number":4179,"relation":"toward"}]'::jsonb,
    'migrations_added', '["99999999999999"]'::jsonb,
    'migrations_applied_state', 'pending',
    'migrations_status', NULL,
    'edge_functions', '[]'::jsonb,
    'web_projects', '[]'::jsonb,
    'deploy_marker', false,
    'deploy', '{"web":{},"edge":"none"}'::jsonb,
    'feature_guide', p_feature_guide,
    'feature_guide_reason', p_reason,
    'live_check', jsonb_build_object(
      'text', 'Signed-in Feature Guide readback passed',
      'by_login', 'sethogieva',
      'url', 'https://github.com/Mingla-LLC/mingla-main/issues/4179#issuecomment-6503919966',
      'at', '2026-10-29T17:36:00Z'
    ),
    'test_files', '[]'::jsonb,
    'problems', '["migration_receipt_pending"]'::jsonb
  )
$fn$;

CREATE FUNCTION pg_temp.issue4179_json_null_ingest(p_data jsonb) RETURNS jsonb
LANGUAGE sql
AS $fn$
  SELECT public.ops_release_records_ingest(jsonb_build_array(jsonb_build_object(
    'data', p_data,
    'comment_url', 'https://github.com/Mingla-LLC/mingla-main/issues/4179#issuecomment-6503782843',
    'issue_number', 4179,
    'commented_at', '2026-10-29T17:36:00Z'
  )))
$fn$;

DO $proof$
DECLARE
  v_result jsonb;
BEGIN
  IF has_function_privilege('authenticated', 'public.ops_release_records_ingest(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.ops_release_records_ingest(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue4179_release_ingest_authority_broadened';
  END IF;

  v_result := pg_temp.issue4179_json_null_ingest(
    pg_temp.issue4179_json_null_record(
      9904186,
      '["staff-feature-guide"]'::jsonb,
      'null'::jsonb
    )
  );
  IF v_result->>'ingested' <> '1'
     OR v_result->>'invalid' <> '0'
     OR NOT EXISTS (
       SELECT 1
         FROM public.ops_release_records
        WHERE pr = 9904186
          AND feature_guide = ARRAY['staff-feature-guide']
          AND feature_guide_reason IS NULL
     ) THEN
    RAISE EXCEPTION 'issue4179_explicit_json_null_rejected:%', v_result;
  END IF;

  v_result := pg_temp.issue4179_json_null_ingest(
    pg_temp.issue4179_json_null_record(
      9904187,
      '["staff-feature-guide"]'::jsonb,
      to_jsonb('not allowed for keyed records'::text)
    )
  );
  IF v_result->>'ingested' <> '0'
     OR v_result->>'invalid' <> '1'
     OR EXISTS (SELECT 1 FROM public.ops_release_records WHERE pr = 9904187) THEN
    RAISE EXCEPTION 'issue4179_keyed_non_null_reason_accepted:%', v_result;
  END IF;
END;
$proof$;

ROLLBACK;
\echo 'ISSUE-4179 RELEASE REASON JSON NULL PASS'
