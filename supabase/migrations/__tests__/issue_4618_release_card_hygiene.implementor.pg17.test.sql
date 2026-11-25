-- #4618 — Release cards on the Work board that can never close.
-- MINGLA-INVARIANT: I-4618-FG-PROBLEMS-FOLLOW-CLASSIFICATION | issue #4618 | A release record carries feature_guide_missing or feature_guide_invalid only while its stored Feature Guide classification is NULL; the classification itself stays immutable (I-4179-RELEASE-REASON-ONE-WAY).
-- MINGLA-INVARIANT: I-4618-BASELINE-RECORD-COMPLETE-WITHOUT-LIVE-CHECK | issue #4618 | Only a record by mingla-bundle-baseline[bot] with no migrations, no edge functions and web projects within {mingla-business} may be bundle_baseline; it needs no live check and no web deploy, and release_kind only moves forward.
--
-- Implementor suite for 20281205034618_issue_4618_release_card_hygiene.sql on
-- the fully replayed PG17 schema. Everything is rolled back.
--   SC-1  a bundle_baseline record is complete with no live check; its card
--         checklist has no deploy or live-check item; an older standard row
--         moves forward to bundle_baseline and completes.
--   SC-2  bundle_baseline claimed by a person, with a migration, with an edge
--         function, or with another web project is invalid; a later standard
--         record never moves a bundle_baseline row back.
--   SC-3  a record first without a Feature Guide line, then with
--         "none — <reason>", ends with no Feature Guide problem and the guide
--         item done.
--   SC-4  a frozen classification stays frozen: a later missing, invalid or
--         different line changes neither feature_guide nor problems.
--   SC-8  a stale record from the PR's own comment (no issues) after a
--         linked-issue record keeps issues and no no_issue; in reverse order
--         the linked-issue record wins; with no issue slot no_issue stays.
--   SC-13 (rework P2-2) a complete row read from a linked issue stays complete
--         when a stale record from the PR's own comment (live_check null)
--         arrives; a newer live check from that comment is still taken.
--   SC-9  the migration's preflight aborts with issue4618_contract_drift on
--         drifted bodies; the one-time correction changes exactly the listed
--         rows and the probe ends with fg_stuck = 0.
--
-- Run from the repository root as supabase_admin (it reads the migration file).
\set ON_ERROR_STOP on
\set issue4618_correct `sed -n '/^DO \$correct\$/,/^\$correct\$;/p' supabase/migrations/20281205034618_issue_4618_release_card_hygiene.sql`
\set issue4618_preflight `sed -n '/^DO \$preflight\$/,/^\$preflight\$;/p' supabase/migrations/20281205034618_issue_4618_release_card_hygiene.sql`
BEGIN;

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('issue4618.correct', :'issue4618_correct', true);
SELECT set_config('issue4618.preflight', :'issue4618_preflight', true);

CREATE FUNCTION pg_temp.r4618(
  p_pr integer,
  p_author text DEFAULT 'sethogieva',
  p_issues jsonb DEFAULT '[{"number":4618,"relation":"toward"}]'::jsonb,
  p_feature_guide jsonb DEFAULT '[]'::jsonb,
  p_reason text DEFAULT 'test only change',
  p_problems jsonb DEFAULT '[]'::jsonb,
  p_kind text DEFAULT NULL,
  p_migrations jsonb DEFAULT '[]'::jsonb,
  p_edge jsonb DEFAULT '[]'::jsonb,
  p_web jsonb DEFAULT '[]'::jsonb,
  p_deploy jsonb DEFAULT '{"web":{},"edge":"none"}'::jsonb,
  p_live jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
AS $fn$
  SELECT jsonb_build_object(
    'v', 1, 'repo', 'Mingla-LLC/mingla-main', 'pr', p_pr,
    'title', 'Issue 4618 proof ' || p_pr,
    'pr_url', 'https://github.com/Mingla-LLC/mingla-main/pull/' || p_pr,
    'merged_at', '2026-11-20T10:00:00Z',
    'merge_sha', md5(p_pr::text) || left(md5('issue4618' || p_pr), 8),
    'merged_by', 'sethogieva', 'author', p_author,
    'issues', p_issues, 'migrations_added', p_migrations, 'migrations_applied_state', 'none',
    'edge_functions', p_edge, 'web_projects', p_web, 'deploy_marker', false, 'deploy', p_deploy,
    'feature_guide', p_feature_guide, 'feature_guide_reason', p_reason,
    'live_check', p_live, 'test_files', '[]'::jsonb, 'problems', p_problems)
    || CASE WHEN p_kind IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('release_kind', p_kind) END
$fn$;

-- p_issue NULL: the record was read from the pull request's own comment.
CREATE FUNCTION pg_temp.in4618(p_data jsonb, p_issue integer DEFAULT 4618) RETURNS jsonb
LANGUAGE sql
AS $fn$
  SELECT public.ops_release_records_ingest(jsonb_build_array(jsonb_build_object(
    'data', p_data,
    'comment_url', CASE WHEN p_issue IS NULL
      THEN 'https://github.com/Mingla-LLC/mingla-main/pull/' || (p_data->>'pr') || '#issuecomment-' || (p_data->>'pr')
      ELSE 'https://github.com/Mingla-LLC/mingla-main/issues/' || p_issue || '#issuecomment-' || (p_data->>'pr') END,
    'issue_number', p_issue,
    'commented_at', '2026-11-20T10:00:00Z')))
$fn$;

CREATE FUNCTION pg_temp.item4618(p_pr integer, p_key text) RETURNS jsonb
LANGUAGE sql
AS $fn$
  SELECT i FROM jsonb_array_elements(public.ops_release_items(p_pr)) i WHERE i->>'key' = p_key
$fn$;

-- ---------------------------------------------------------------- SC-1
DO $sc1$
DECLARE v jsonb; r public.ops_release_records; v_keys text[];
BEGIN
  v := pg_temp.in4618(pg_temp.r4618(9904618, 'mingla-bundle-baseline[bot]', p_kind => 'bundle_baseline',
    p_issues => '[{"number":3493,"relation":"toward"}]'::jsonb), 3493);
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9904618;
  IF v->>'ingested' <> '1' OR r.release_kind <> 'bundle_baseline' OR NOT r.complete OR cardinality(r.problems) <> 0 THEN
    RAISE EXCEPTION 'issue4618_sc1_baseline_not_complete:% kind=% complete=% problems=%', v, r.release_kind, r.complete, r.problems;
  END IF;
  v_keys := ARRAY(SELECT i->>'key' FROM jsonb_array_elements(public.ops_release_items(9904618)) i);
  IF v_keys <> ARRAY['record','issue','guide'] THEN
    RAISE EXCEPTION 'issue4618_sc1_baseline_checklist:%', v_keys;
  END IF;

  -- An older standard record (web not deployed, no live check) moves forward.
  PERFORM pg_temp.in4618(pg_temp.r4618(9904619, 'mingla-bundle-baseline[bot]', p_web => '["mingla-business"]'::jsonb,
    p_deploy => '{"web":{"mingla-business":"not_deployed"},"edge":"none"}'::jsonb,
    p_problems => '["web_not_deployed","live_check_missing"]'::jsonb));
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9904619;
  IF r.release_kind <> 'standard' OR r.complete OR NOT ('live_check_missing' = ANY (r.problems)) THEN
    RAISE EXCEPTION 'issue4618_sc1_standard_fixture:% %', r.release_kind, r.problems;
  END IF;
  PERFORM pg_temp.in4618(pg_temp.r4618(9904619, 'mingla-bundle-baseline[bot]', p_kind => 'bundle_baseline'));
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9904619;
  IF r.release_kind <> 'bundle_baseline' OR NOT r.complete OR cardinality(r.problems) <> 0 THEN
    RAISE EXCEPTION 'issue4618_sc1_forward_not_complete:% % %', r.release_kind, r.complete, r.problems;
  END IF;
END;
$sc1$;

-- ---------------------------------------------------------------- SC-2
DO $sc2$
DECLARE v jsonb; r public.ops_release_records;
BEGIN
  v := pg_temp.in4618(pg_temp.r4618(9904620, 'sethogieva', p_kind => 'bundle_baseline'));
  IF v->>'invalid' <> '1' OR EXISTS (SELECT 1 FROM public.ops_release_records WHERE pr = 9904620) THEN
    RAISE EXCEPTION 'issue4618_sc2_person_claimed_baseline:%', v;
  END IF;
  v := pg_temp.in4618(pg_temp.r4618(9904621, 'mingla-bundle-baseline[bot]', p_kind => 'bundle_baseline',
    p_migrations => '["20281205034618"]'::jsonb));
  IF v->>'invalid' <> '1' THEN RAISE EXCEPTION 'issue4618_sc2_baseline_with_migration:%', v; END IF;
  v := pg_temp.in4618(pg_temp.r4618(9904622, 'mingla-bundle-baseline[bot]', p_kind => 'bundle_baseline',
    p_edge => '["team-agent"]'::jsonb));
  IF v->>'invalid' <> '1' THEN RAISE EXCEPTION 'issue4618_sc2_baseline_with_edge:%', v; END IF;
  v := pg_temp.in4618(pg_temp.r4618(9904623, 'mingla-bundle-baseline[bot]', p_kind => 'bundle_baseline',
    p_web => '["mingla-admin"]'::jsonb));
  IF v->>'invalid' <> '1' THEN RAISE EXCEPTION 'issue4618_sc2_baseline_with_admin:%', v; END IF;
  v := pg_temp.in4618(pg_temp.r4618(9904624, 'sethogieva', p_kind => 'something_else'));
  IF v->>'invalid' <> '1' THEN RAISE EXCEPTION 'issue4618_sc2_unknown_kind:%', v; END IF;
  IF EXISTS (SELECT 1 FROM public.ops_release_records WHERE pr BETWEEN 9904620 AND 9904624) THEN
    RAISE EXCEPTION 'issue4618_sc2_invalid_written';
  END IF;

  -- A person's standard record keeps the full checklist.
  PERFORM pg_temp.in4618(pg_temp.r4618(9904625, 'sethogieva', p_kind => 'standard'));
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9904625;
  IF r.release_kind <> 'standard' OR r.complete OR NOT ('live_check_missing' = ANY (r.problems))
     OR pg_temp.item4618(9904625, 'live_check') IS NULL THEN
    RAISE EXCEPTION 'issue4618_sc2_standard_checklist:% %', r.complete, r.problems;
  END IF;

  -- Forward only: a later standard record never moves a baseline back.
  PERFORM pg_temp.in4618(pg_temp.r4618(9904618, 'mingla-bundle-baseline[bot]', p_kind => 'standard',
    p_issues => '[{"number":3493,"relation":"toward"}]'::jsonb), 3493);
  IF (SELECT release_kind FROM public.ops_release_records WHERE pr = 9904618) <> 'bundle_baseline' THEN
    RAISE EXCEPTION 'issue4618_sc2_kind_moved_back';
  END IF;
END;
$sc2$;

-- ---------------------------------------------------------------- SC-3, SC-4
DO $sc34$
DECLARE r public.ops_release_records;
BEGIN
  PERFORM pg_temp.in4618(pg_temp.r4618(9904630, p_feature_guide => 'null'::jsonb, p_reason => NULL,
    p_problems => '["feature_guide_missing","live_check_missing"]'::jsonb));
  IF NOT ((SELECT problems FROM public.ops_release_records WHERE pr = 9904630) @> ARRAY['feature_guide_missing'])
     OR (pg_temp.item4618(9904630, 'guide')->>'done')::boolean THEN
    RAISE EXCEPTION 'issue4618_sc3_fixture';
  END IF;
  PERFORM pg_temp.in4618(pg_temp.r4618(9904630, p_reason => 'measured baseline only, no user-facing change',
    p_problems => '["live_check_missing"]'::jsonb));
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9904630;
  IF r.feature_guide IS DISTINCT FROM ARRAY[]::text[]
     OR r.problems && ARRAY['feature_guide_missing','feature_guide_invalid']
     OR NOT (pg_temp.item4618(9904630, 'guide')->>'done')::boolean THEN
    RAISE EXCEPTION 'issue4618_sc3_fg_problem_stuck:% %', r.feature_guide, r.problems;
  END IF;

  -- SC-4: later missing, invalid or different lines change nothing.
  PERFORM pg_temp.in4618(pg_temp.r4618(9904630, p_feature_guide => 'null'::jsonb, p_reason => NULL,
    p_problems => '["feature_guide_invalid","live_check_missing"]'::jsonb));
  PERFORM pg_temp.in4618(pg_temp.r4618(9904630, p_feature_guide => 'null'::jsonb, p_reason => NULL,
    p_problems => '["feature_guide_missing","live_check_missing"]'::jsonb));
  PERFORM pg_temp.in4618(pg_temp.r4618(9904630, p_feature_guide => '["some-other-key"]'::jsonb, p_reason => NULL,
    p_problems => '["live_check_missing"]'::jsonb));
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9904630;
  IF r.feature_guide IS DISTINCT FROM ARRAY[]::text[]
     OR r.feature_guide_reason IS DISTINCT FROM 'measured baseline only, no user-facing change'
     OR r.problems && ARRAY['feature_guide_missing','feature_guide_invalid'] THEN
    RAISE EXCEPTION 'issue4618_sc4_frozen_classification_moved:% % %', r.feature_guide, r.feature_guide_reason, r.problems;
  END IF;
END;
$sc34$;

-- ---------------------------------------------------------------- SC-8
DO $sc8$
DECLARE r public.ops_release_records;
BEGIN
  -- Issue-slot record first, then a stale PR-slot record with no issues.
  PERFORM pg_temp.in4618(pg_temp.r4618(9904640, p_problems => '["live_check_missing"]'::jsonb), 4618);
  PERFORM pg_temp.in4618(pg_temp.r4618(9904640, p_issues => '[]'::jsonb,
    p_problems => '["no_issue","live_check_missing"]'::jsonb), NULL);
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9904640;
  IF r.issues <> '[{"number":4618,"relation":"toward"}]'::jsonb OR 'no_issue' = ANY (r.problems)
     OR NOT (r.comment_urls ? 'pr' AND r.comment_urls ? '4618')
     OR NOT (pg_temp.item4618(9904640, 'issue')->>'done')::boolean THEN
    RAISE EXCEPTION 'issue4618_sc8_stale_pr_slot_won:% % %', r.issues, r.problems, r.comment_urls;
  END IF;

  -- Reverse order: the PR-slot record first, then the issue record wins.
  PERFORM pg_temp.in4618(pg_temp.r4618(9904641, p_issues => '[]'::jsonb,
    p_problems => '["no_issue","live_check_missing"]'::jsonb), NULL);
  PERFORM pg_temp.in4618(pg_temp.r4618(9904641, p_problems => '["live_check_missing"]'::jsonb), 4618);
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9904641;
  IF r.issues <> '[{"number":4618,"relation":"toward"}]'::jsonb OR 'no_issue' = ANY (r.problems) THEN
    RAISE EXCEPTION 'issue4618_sc8_reverse:% %', r.issues, r.problems;
  END IF;

  -- No linked-issue record: the PR-slot record's no_issue stands.
  PERFORM pg_temp.in4618(pg_temp.r4618(9904642, p_issues => '[]'::jsonb,
    p_problems => '["no_issue","live_check_missing"]'::jsonb), NULL);
  IF NOT (SELECT 'no_issue' = ANY (problems) FROM public.ops_release_records WHERE pr = 9904642) THEN
    RAISE EXCEPTION 'issue4618_sc8_no_issue_lost';
  END IF;
END;
$sc8$;

-- ---------------------------------------------------------------- SC-13
DO $sc13$
DECLARE r public.ops_release_records;
  c_live constant jsonb := '{"text":"walked production","by_login":"sethogieva","url":"https://github.com/Mingla-LLC/mingla-main/issues/4618#issuecomment-7777","at":"2026-11-21T09:00:00Z"}';
  c_newer constant jsonb := '{"text":"checked again","by_login":"sethogieva","url":"https://github.com/Mingla-LLC/mingla-main/issues/4618#issuecomment-7790","at":"2026-11-22T09:00:00Z"}';
BEGIN
  PERFORM pg_temp.in4618(pg_temp.r4618(9904660, p_live => c_live), 4618);
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9904660;
  IF NOT r.complete OR r.live_check IS NULL THEN
    RAISE EXCEPTION 'issue4618_sc13_fixture_not_complete:% %', r.complete, r.problems;
  END IF;
  -- The stale PR-slot record: no issues, no live check.
  PERFORM pg_temp.in4618(pg_temp.r4618(9904660, p_issues => '[]'::jsonb,
    p_problems => '["no_issue","live_check_missing"]'::jsonb), NULL);
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9904660;
  IF NOT r.complete OR r.live_check IS DISTINCT FROM c_live OR cardinality(r.problems) <> 0 THEN
    RAISE EXCEPTION 'issue4618_sc13_stale_pr_slot_wiped_live_check:% % %', r.complete, r.live_check, r.problems;
  END IF;
  -- With issues (not the empty-issues case) and an older check: still kept.
  PERFORM pg_temp.in4618(pg_temp.r4618(9904660, p_live => '{"text":"old","by_login":"x","url":"https://github.com/Mingla-LLC/mingla-main/pull/9904660#issuecomment-1","at":"2026-11-20T11:00:00Z"}'::jsonb), NULL);
  IF (SELECT live_check FROM public.ops_release_records WHERE pr = 9904660) IS DISTINCT FROM c_live THEN
    RAISE EXCEPTION 'issue4618_sc13_older_pr_slot_check_won';
  END IF;
  -- A newer live check read from the PR's comment is taken.
  PERFORM pg_temp.in4618(pg_temp.r4618(9904660, p_live => c_newer), NULL);
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9904660;
  IF r.live_check IS DISTINCT FROM c_newer OR NOT r.complete THEN
    RAISE EXCEPTION 'issue4618_sc13_newer_check_lost:%', r.live_check;
  END IF;
END;
$sc13$;

-- ---------------------------------------------------------------- SC-9
DO $sc9$
DECLARE v_msg text := NULL; r public.ops_release_records; v_stuck integer;
BEGIN
  -- The preflight, run against the bodies this migration already replaced,
  -- must refuse: that is what it does to any drifted body.
  IF current_setting('issue4618.preflight') NOT LIKE 'DO $preflight$%' THEN
    RAISE EXCEPTION 'issue4618_sc9_preflight_not_read';
  END IF;
  BEGIN
    EXECUTE current_setting('issue4618.preflight');
  EXCEPTION WHEN others THEN
    v_msg := SQLERRM;
  END;
  IF v_msg IS NULL OR v_msg NOT LIKE 'issue4618_contract_drift:public.ops_release_records_ingest(jsonb):0' THEN
    RAISE EXCEPTION 'issue4618_sc9_preflight_did_not_refuse:%', v_msg;
  END IF;

  -- Production-shaped rows before the correction.
  DELETE FROM public.ops_release_records WHERE pr IN (4051, 4059, 4277, 4464, 9904650, 9904651);
  INSERT INTO public.ops_release_records (pr, title, pr_url, merged_at, merge_sha, author_login, issues, web_projects,
    deploy_marker, deploy, feature_guide, feature_guide_reason, problems, comment_urls)
  VALUES
    (4051, 'Record business-web boot payload growth', 'https://github.com/Mingla-LLC/mingla-main/pull/4051', '2026-11-01T10:00:00Z',
     repeat('a', 40), 'mingla-bundle-baseline[bot]', '[{"number":3493,"relation":"toward"}]', ARRAY['mingla-business'], false,
     '{"web":{"mingla-business":"not_deployed"},"edge":"none"}', ARRAY[]::text[], 'measured baseline only, no user-facing change',
     ARRAY['feature_guide_missing','web_not_deployed'], '{"3493":"https://github.com/Mingla-LLC/mingla-main/issues/3493#issuecomment-1"}'),
    -- In the list, but not the baseline app: never touched.
    (4059, 'Not a baseline', 'https://github.com/Mingla-LLC/mingla-main/pull/4059', '2026-11-01T11:00:00Z',
     repeat('b', 40), 'sethogieva', '[{"number":3493,"relation":"toward"}]', ARRAY['mingla-business'], false,
     '{"web":{"mingla-business":"not_deployed"},"edge":"none"}', ARRAY[]::text[], 'x reason',
     ARRAY['web_not_deployed','live_check_missing'], '{}'),
    (4277, 'Bump a dependency', 'https://github.com/Mingla-LLC/mingla-main/pull/4277', '2026-11-02T10:00:00Z',
     repeat('c', 40), 'dependabot[bot]', '[]', ARRAY[]::text[], false,
     '{"web":{},"edge":"none"}', ARRAY[]::text[], 'dependency patch only',
     ARRAY['no_issue','feature_guide_missing','live_check_missing'], '{"pr":"https://github.com/Mingla-LLC/mingla-main/pull/4277#issuecomment-2"}'),
    -- Not in any list, classified, stuck: its Feature Guide problem is cleared.
    (9904650, 'A person''s PR', 'https://github.com/Mingla-LLC/mingla-main/pull/9904650', '2026-11-03T10:00:00Z',
     repeat('d', 40), 'sethogieva', '[{"number":4618,"relation":"toward"}]', ARRAY[]::text[], false,
     '{"web":{},"edge":"none"}', ARRAY[]::text[], 'x reason',
     ARRAY['feature_guide_invalid','live_check_missing'], '{}'),
    -- Unclassified: its Feature Guide problem stays.
    (9904651, 'Unclassified', 'https://github.com/Mingla-LLC/mingla-main/pull/9904651', '2026-11-03T11:00:00Z',
     repeat('e', 40), 'sethogieva', '[{"number":4618,"relation":"toward"}]', ARRAY[]::text[], false,
     '{"web":{},"edge":"none"}', NULL, NULL,
     ARRAY['feature_guide_missing','live_check_missing'], '{}');

  EXECUTE current_setting('issue4618.correct');

  SELECT * INTO r FROM public.ops_release_records WHERE pr = 4051;
  IF r.release_kind <> 'bundle_baseline' OR NOT r.complete OR cardinality(r.problems) <> 0 THEN
    RAISE EXCEPTION 'issue4618_sc9_baseline_row:% % %', r.release_kind, r.complete, r.problems;
  END IF;
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 4059;
  IF r.release_kind <> 'standard' OR r.problems <> ARRAY['web_not_deployed','live_check_missing'] THEN
    RAISE EXCEPTION 'issue4618_sc9_person_row_touched:% %', r.release_kind, r.problems;
  END IF;
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 4277;
  IF r.problems <> ARRAY['live_check_missing'] OR NOT (pg_temp.item4618(4277, 'issue')->>'done')::boolean THEN
    RAISE EXCEPTION 'issue4618_sc9_dependabot_row:%', r.problems;
  END IF;
  IF (SELECT problems FROM public.ops_release_records WHERE pr = 9904650) <> ARRAY['live_check_missing']
     OR (SELECT problems FROM public.ops_release_records WHERE pr = 9904651) <> ARRAY['feature_guide_missing','live_check_missing'] THEN
    RAISE EXCEPTION 'issue4618_sc9_fg_rows:% %',
      (SELECT problems FROM public.ops_release_records WHERE pr = 9904650),
      (SELECT problems FROM public.ops_release_records WHERE pr = 9904651);
  END IF;

  -- The probe: no classified row carries a Feature Guide problem.
  SELECT count(*) INTO v_stuck FROM public.ops_release_records
   WHERE problems && ARRAY['feature_guide_missing','feature_guide_invalid'] AND feature_guide IS NOT NULL;
  IF v_stuck <> 0 THEN RAISE EXCEPTION 'issue4618_sc9_fg_stuck:%', v_stuck; END IF;

  -- Running the correction again changes nothing.
  EXECUTE current_setting('issue4618.correct');
  IF (SELECT problems FROM public.ops_release_records WHERE pr = 4059) <> ARRAY['web_not_deployed','live_check_missing'] THEN
    RAISE EXCEPTION 'issue4618_sc9_rerun_moved_rows';
  END IF;
END;
$sc9$;

-- ---------------------------------------------------------------- grants
DO $grants$
BEGIN
  IF has_function_privilege('authenticated', 'public.ops_release_records_ingest(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ops_release_recompute(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.ops_release_items(integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.ops_release_records_ingest(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue4618_grants_changed';
  END IF;
END;
$grants$;

ROLLBACK;
\echo 'ISSUE-4618 RELEASE CARD HYGIENE PASS'
