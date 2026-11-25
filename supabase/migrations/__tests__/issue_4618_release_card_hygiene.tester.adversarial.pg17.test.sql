-- #4618 — tester adversarial suite for 20281205034618_issue_4618_release_card_hygiene.sql.
-- MINGLA-INVARIANT: I-4618-STALE-RECORD-BRINGS-NOTHING-BACK | issue #4618 | A stale or reordered release record never brings a Feature Guide problem, no_issue or an older release_kind back onto a row, and the one-time correction changes zero rows when run again.
--
-- Angles the implementor suite does not take (all on the replayed PG17 schema, rolled back):
--   A1  release_kind is never inferred: the baseline bot's record without a kind
--       stays standard; a case variant or a non-string kind is invalid; a JSON
--       null kind after bundle_baseline does not move the row back.
--   A2  ingest order: an older record (no Feature Guide line, no issue, read from
--       the PR's own comment) arriving AFTER the fixed record brings back neither
--       feature_guide_missing nor no_issue nor the issues; an older standard record
--       of a baseline PR (web not deployed, no live check) arriving after the
--       bundle_baseline one keeps the row complete with the short checklist.
--   A3  a frozen NON-EMPTY classification receiving an empty or different line is
--       still ingested (no immutability raise) and keeps its keys and reason.
--   A4  preflight drift on bodies that carry every anchor exactly once passes;
--       one anchor mutated (0) or duplicated (2) raises issue4618_contract_drift
--       naming that function and count.
--   A6  (retest, SC-13) a record from the PR's own comment never takes a live check
--       away: reverse order, an unparseable or equal timestamp, a record with issues.
--   A5  the correction's guards: a listed baseline PR that added a migration, a
--       listed Dependabot PR that is not by Dependabot, and one that links an
--       issue are not touched; a second run changes zero rows.
--
-- Run from the repository root as supabase_admin (it reads the migration file).
\set ON_ERROR_STOP on
\set issue4618_correct `sed -n '/^DO \$correct\$/,/^\$correct\$;/p' supabase/migrations/20281205034618_issue_4618_release_card_hygiene.sql`
\set issue4618_preflight `sed -n '/^DO \$preflight\$/,/^\$preflight\$;/p' supabase/migrations/20281205034618_issue_4618_release_card_hygiene.sql`
BEGIN;

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('issue4618t.correct', :'issue4618_correct', true);
SELECT set_config('issue4618t.preflight', :'issue4618_preflight', true);

CREATE FUNCTION pg_temp.t4618(
  p_pr integer,
  p_author text DEFAULT 'sethogieva',
  p_issues jsonb DEFAULT '[{"number":4618,"relation":"toward"}]'::jsonb,
  p_feature_guide jsonb DEFAULT '[]'::jsonb,
  p_reason text DEFAULT 'test only change',
  p_problems jsonb DEFAULT '[]'::jsonb,
  p_kind jsonb DEFAULT NULL,
  p_web jsonb DEFAULT '[]'::jsonb,
  p_deploy jsonb DEFAULT '{"web":{},"edge":"none"}'::jsonb,
  p_live jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
AS $fn$
  SELECT jsonb_build_object(
    'v', 1, 'repo', 'Mingla-LLC/mingla-main', 'pr', p_pr,
    'title', 'Issue 4618 tester ' || p_pr,
    'pr_url', 'https://github.com/Mingla-LLC/mingla-main/pull/' || p_pr,
    'merged_at', '2026-11-20T10:00:00Z',
    'merge_sha', md5(p_pr::text) || left(md5('t4618' || p_pr), 8),
    'merged_by', 'sethogieva', 'author', p_author,
    'issues', p_issues, 'migrations_added', '[]'::jsonb, 'migrations_applied_state', 'none',
    'edge_functions', '[]'::jsonb, 'web_projects', p_web, 'deploy_marker', false, 'deploy', p_deploy,
    'feature_guide', p_feature_guide, 'feature_guide_reason', p_reason,
    'live_check', p_live, 'test_files', '[]'::jsonb, 'problems', p_problems)
    || CASE WHEN p_kind IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('release_kind', p_kind) END
$fn$;

CREATE FUNCTION pg_temp.ti4618(p_data jsonb, p_issue integer DEFAULT 4618) RETURNS jsonb
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

CREATE FUNCTION pg_temp.tkeys4618(p_pr integer) RETURNS text[]
LANGUAGE sql
AS $fn$
  SELECT ARRAY(SELECT i->>'key' FROM jsonb_array_elements(public.ops_release_items(p_pr)) i)
$fn$;

-- ---------------------------------------------------------------- A1
DO $a1$
DECLARE v jsonb; r public.ops_release_records;
BEGIN
  -- The baseline bot's record with no kind: never inferred.
  PERFORM pg_temp.ti4618(pg_temp.t4618(9914600, 'mingla-bundle-baseline[bot]', p_web => '["mingla-business"]'::jsonb,
    p_deploy => '{"web":{"mingla-business":"not_deployed"},"edge":"none"}'::jsonb,
    p_problems => '["web_not_deployed","live_check_missing"]'::jsonb));
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9914600;
  IF r.release_kind <> 'standard' OR r.complete OR NOT ('live_check' = ANY (pg_temp.tkeys4618(9914600)))
     OR NOT ('deploy:mingla-business' = ANY (pg_temp.tkeys4618(9914600))) THEN
    RAISE EXCEPTION 'issue4618t_a1_kind_inferred:% % %', r.release_kind, r.complete, pg_temp.tkeys4618(9914600);
  END IF;

  -- A case variant, a number and an array are not a kind.
  v := pg_temp.ti4618(pg_temp.t4618(9914601, 'mingla-bundle-baseline[bot]', p_kind => '"Bundle_Baseline"'::jsonb));
  IF v->>'invalid' <> '1' THEN RAISE EXCEPTION 'issue4618t_a1_case_variant:%', v; END IF;
  v := pg_temp.ti4618(pg_temp.t4618(9914602, 'mingla-bundle-baseline[bot]', p_kind => '1'::jsonb));
  IF v->>'invalid' <> '1' THEN RAISE EXCEPTION 'issue4618t_a1_number_kind:%', v; END IF;
  v := pg_temp.ti4618(pg_temp.t4618(9914603, 'mingla-bundle-baseline[bot]', p_kind => '["bundle_baseline"]'::jsonb));
  IF v->>'invalid' <> '1' THEN RAISE EXCEPTION 'issue4618t_a1_array_kind:%', v; END IF;
  -- A bot login that only looks like the baseline app.
  v := pg_temp.ti4618(pg_temp.t4618(9914604, 'mingla-bundle-baseline', p_kind => '"bundle_baseline"'::jsonb));
  IF v->>'invalid' <> '1' THEN RAISE EXCEPTION 'issue4618t_a1_lookalike_author:%', v; END IF;
  IF EXISTS (SELECT 1 FROM public.ops_release_records WHERE pr BETWEEN 9914601 AND 9914604) THEN
    RAISE EXCEPTION 'issue4618t_a1_invalid_written';
  END IF;

  -- Forward only, against an explicit JSON null kind and an absent kind.
  PERFORM pg_temp.ti4618(pg_temp.t4618(9914600, 'mingla-bundle-baseline[bot]', p_kind => '"bundle_baseline"'::jsonb));
  PERFORM pg_temp.ti4618(pg_temp.t4618(9914600, 'mingla-bundle-baseline[bot]', p_kind => 'null'::jsonb));
  PERFORM pg_temp.ti4618(pg_temp.t4618(9914600, 'mingla-bundle-baseline[bot]'));
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9914600;
  IF r.release_kind <> 'bundle_baseline' OR NOT r.complete THEN
    RAISE EXCEPTION 'issue4618t_a1_kind_moved_back:% %', r.release_kind, r.complete;
  END IF;
  RAISE NOTICE 'PASS A1 release_kind never inferred, strict, forward only';
END;
$a1$;

-- ---------------------------------------------------------------- A2
DO $a2$
DECLARE r public.ops_release_records;
BEGIN
  -- The fixed record (issue slot, classified, live check) first.
  PERFORM pg_temp.ti4618(pg_temp.t4618(9914610, p_reason => 'test only change',
    p_live => '{"text":"walked it","by_login":"sethogieva","url":"https://github.com/Mingla-LLC/mingla-main/issues/4618#issuecomment-1","at":"2026-11-21T10:00:00Z"}'::jsonb), 4618);
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9914610;
  IF NOT r.complete THEN RAISE EXCEPTION 'issue4618t_a2_fixture:%', r.problems; END IF;
  -- Then the OLD record from the PR's own comment: no issue, no Feature Guide line.
  PERFORM pg_temp.ti4618(pg_temp.t4618(9914610, p_issues => '[]'::jsonb, p_feature_guide => 'null'::jsonb, p_reason => NULL,
    p_problems => '["no_issue","feature_guide_missing","live_check_missing"]'::jsonb), NULL);
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9914610;
  IF r.problems && ARRAY['feature_guide_missing','feature_guide_invalid','no_issue']
     OR r.issues <> '[{"number":4618,"relation":"toward"}]'::jsonb
     OR r.feature_guide IS DISTINCT FROM ARRAY[]::text[] THEN
    RAISE EXCEPTION 'issue4618t_a2_stale_record_brought_problems_back:% % %', r.problems, r.issues, r.feature_guide;
  END IF;

  -- A baseline PR: bundle_baseline first, then its pre-#4618 standard record.
  PERFORM pg_temp.ti4618(pg_temp.t4618(9914611, 'mingla-bundle-baseline[bot]', p_kind => '"bundle_baseline"'::jsonb,
    p_issues => '[{"number":3493,"relation":"toward"}]'::jsonb), 3493);
  PERFORM pg_temp.ti4618(pg_temp.t4618(9914611, 'mingla-bundle-baseline[bot]', p_web => '["mingla-business"]'::jsonb,
    p_issues => '[{"number":3493,"relation":"toward"}]'::jsonb,
    p_deploy => '{"web":{"mingla-business":"pending"},"edge":"none"}'::jsonb,
    p_problems => '["web_not_deployed","live_check_missing"]'::jsonb), 3493);
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9914611;
  IF r.release_kind <> 'bundle_baseline' OR NOT r.complete OR cardinality(r.problems) <> 0
     OR pg_temp.tkeys4618(9914611) <> ARRAY['record','issue','guide'] THEN
    RAISE EXCEPTION 'issue4618t_a2_old_baseline_record_reopened:% % % %', r.release_kind, r.complete, r.problems, pg_temp.tkeys4618(9914611);
  END IF;
  RAISE NOTICE 'PASS A2 a stale record arriving after the fixed one brings nothing back';
END;
$a2$;

-- ---------------------------------------------------------------- A3
DO $a3$
DECLARE v jsonb; r public.ops_release_records; v_key text;
BEGIN
  SELECT capability_key INTO v_key FROM public.product_capabilities ORDER BY capability_key LIMIT 1;
  IF v_key IS NULL THEN
    INSERT INTO public.product_capabilities (capability_key) VALUES ('issue-4618-tester') RETURNING capability_key INTO v_key;
  END IF;
  PERFORM pg_temp.ti4618(pg_temp.t4618(9914620, p_feature_guide => to_jsonb(ARRAY[v_key]), p_reason => NULL));
  v := pg_temp.ti4618(pg_temp.t4618(9914620, p_feature_guide => '[]'::jsonb, p_reason => 'later says none'));
  IF v->>'ingested' <> '1' OR v->>'invalid' <> '0' THEN RAISE EXCEPTION 'issue4618t_a3_empty_line_refused:%', v; END IF;
  v := pg_temp.ti4618(pg_temp.t4618(9914620, p_feature_guide => '["another-key"]'::jsonb, p_reason => NULL,
    p_problems => '["feature_guide_invalid","live_check_missing"]'::jsonb));
  IF v->>'ingested' <> '1' OR v->>'invalid' <> '0' THEN RAISE EXCEPTION 'issue4618t_a3_other_line_refused:%', v; END IF;
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9914620;
  IF r.feature_guide IS DISTINCT FROM ARRAY[v_key] OR r.feature_guide_reason IS NOT NULL
     OR r.problems && ARRAY['feature_guide_missing','feature_guide_invalid'] THEN
    RAISE EXCEPTION 'issue4618t_a3_frozen_moved:% % %', r.feature_guide, r.feature_guide_reason, r.problems;
  END IF;
  RAISE NOTICE 'PASS A3 a frozen non-empty classification stays, without an immutability raise';
END;
$a3$;

-- ---------------------------------------------------------------- A6 (retest, SC-13)
DO $a6$
DECLARE r public.ops_release_records; v_on text;
  v_l1 jsonb := '{"text":"first","by_login":"sethogieva","url":"https://github.com/Mingla-LLC/mingla-main/issues/4618#issuecomment-11","at":"2026-11-21T10:00:00Z"}';
  v_l2 jsonb := '{"text":"second","by_login":"sethogieva","url":"https://github.com/Mingla-LLC/mingla-main/pull/9914630#issuecomment-12","at":"2026-11-22T10:00:00Z"}';
BEGIN
  -- Reverse order: the PR-comment record (newer check) first, then the linked-issue record
  -- with an older check. The row ends complete, with a live check.
  PERFORM pg_temp.ti4618(pg_temp.t4618(9914630, p_live => v_l2), NULL);
  PERFORM pg_temp.ti4618(pg_temp.t4618(9914630, p_live => v_l1), 4618);
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9914630;
  IF r.live_check IS NULL OR NOT r.complete OR NOT (r.comment_urls ? 'pr' AND r.comment_urls ? '4618') THEN
    RAISE EXCEPTION 'issue4618t_a6_reverse_order_lost_check:% % %', r.live_check, r.complete, r.comment_urls;
  END IF;
  -- A later stale PR-comment record with an unparseable "at" never takes it away.
  PERFORM pg_temp.ti4618(pg_temp.t4618(9914630, p_live =>
    '{"text":"bad","by_login":"x","url":"https://github.com/Mingla-LLC/mingla-main/pull/9914630#issuecomment-13","at":"not a date"}'::jsonb), NULL);
  -- And one with exactly the same instant keeps the row's own check.
  v_on := r.live_check->>'url';
  PERFORM pg_temp.ti4618(pg_temp.t4618(9914630, p_live => jsonb_set(r.live_check, '{url}',
    '"https://github.com/Mingla-LLC/mingla-main/pull/9914630#issuecomment-14"')), NULL);
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9914630;
  IF r.live_check->>'url' IS DISTINCT FROM v_on OR NOT r.complete THEN
    RAISE EXCEPTION 'issue4618t_a6_pr_slot_replaced_check:% %', r.live_check, r.complete;
  END IF;
  -- A stale PR-comment record WITH issues (not stale for (d)) and no check: still never wipes it.
  PERFORM pg_temp.ti4618(pg_temp.t4618(9914630, p_live => NULL), NULL);
  SELECT * INTO r FROM public.ops_release_records WHERE pr = 9914630;
  IF r.live_check IS NULL OR NOT r.complete THEN
    RAISE EXCEPTION 'issue4618t_a6_pr_slot_with_issues_wiped:% %', r.live_check, r.complete;
  END IF;
  RAISE NOTICE 'PASS A6 a PR-comment record never takes a live check away, in either order';
END;
$a6$;

-- ---------------------------------------------------------------- A4
-- Stub bodies holding each preflight anchor exactly once (in comments).
CREATE OR REPLACE FUNCTION public.ops_release_records_ingest(p_records jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $s$
BEGIN
  -- || ARRAY(SELECT p FROM unnest(r.problems) p WHERE p IN ('feature_guide_missing','feature_guide_invalid'))
  -- issues = EXCLUDED.issues,
  RETURN NULL;
END;
$s$;
CREATE OR REPLACE FUNCTION public.ops_release_recompute(p_pr integer) RETURNS boolean
LANGUAGE plpgsql AS $s$
BEGIN
  -- IF r.live_check IS NULL AND NOT 'live_check_missing' = ANY (v_problems) THEN
  RETURN false;
END;
$s$;
CREATE OR REPLACE FUNCTION public.ops_release_items(p_pr integer) RETURNS jsonb
LANGUAGE plpgsql AS $s$
BEGIN
  -- jsonb_build_object('key', 'live_check'
  RETURN NULL;
END;
$s$;

DO $a4$
DECLARE v_msg text;
BEGIN
  -- Clean bodies: the preflight passes.
  EXECUTE current_setting('issue4618t.preflight');

  -- One anchor mutated (one space dropped): 0.
  EXECUTE $m$CREATE OR REPLACE FUNCTION public.ops_release_recompute(p_pr integer) RETURNS boolean
    LANGUAGE plpgsql AS $s$ BEGIN
      -- IF r.live_check IS NULL AND NOT 'live_check_missing' = ANY(v_problems) THEN
      RETURN false; END; $s$$m$;
  v_msg := NULL;
  BEGIN
    EXECUTE current_setting('issue4618t.preflight');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  IF v_msg IS DISTINCT FROM 'issue4618_contract_drift:public.ops_release_recompute(integer):0' THEN
    RAISE EXCEPTION 'issue4618t_a4_mutated_anchor_not_refused:%', v_msg;
  END IF;

  -- Restore it, then duplicate the items anchor: 2.
  EXECUTE $m$CREATE OR REPLACE FUNCTION public.ops_release_recompute(p_pr integer) RETURNS boolean
    LANGUAGE plpgsql AS $s$ BEGIN
      -- IF r.live_check IS NULL AND NOT 'live_check_missing' = ANY (v_problems) THEN
      RETURN false; END; $s$$m$;
  EXECUTE $m$CREATE OR REPLACE FUNCTION public.ops_release_items(p_pr integer) RETURNS jsonb
    LANGUAGE plpgsql AS $s$ BEGIN
      -- jsonb_build_object('key', 'live_check'
      -- jsonb_build_object('key', 'live_check'
      RETURN NULL; END; $s$$m$;
  v_msg := NULL;
  BEGIN
    EXECUTE current_setting('issue4618t.preflight');
  EXCEPTION WHEN others THEN v_msg := SQLERRM;
  END;
  IF v_msg IS DISTINCT FROM 'issue4618_contract_drift:public.ops_release_items(integer):2' THEN
    RAISE EXCEPTION 'issue4618t_a4_duplicated_anchor_not_refused:%', v_msg;
  END IF;
  RAISE NOTICE 'PASS A4 preflight passes clean bodies and names the drifted function and count';
END;
$a4$;

-- Put the migration's real bodies back for A5 (the stubs above must not leak).
ROLLBACK;
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('issue4618t.correct', :'issue4618_correct', true);

-- ---------------------------------------------------------------- A5
DO $a5$
DECLARE r public.ops_release_records; v_changed integer;
BEGIN
  DELETE FROM public.ops_release_records WHERE pr IN (4051, 4059, 4075, 4277, 4464);
  INSERT INTO public.ops_release_records (pr, title, pr_url, merged_at, merge_sha, author_login, issues, migrations_added, web_projects,
    deploy_marker, deploy, feature_guide, feature_guide_reason, live_check, problems, comment_urls)
  VALUES
    -- Listed, the baseline app, the production shape: converted.
    (4051, 'Record business-web boot payload growth', 'https://github.com/Mingla-LLC/mingla-main/pull/4051', '2026-10-21T16:58:44Z',
     repeat('a', 40), 'mingla-bundle-baseline[bot]', '[{"number":3493,"relation":"toward"}]', ARRAY[]::text[], ARRAY['mingla-business'], false,
     '{"web":{"mingla-business":"not_deployed"},"edge":"none"}', ARRAY[]::text[], 'measured baseline only, no user-facing change',
     '{"text":"x","by_login":"sethogieva","url":"https://github.com/Mingla-LLC/mingla-main/issues/3493#issuecomment-1","at":"2026-10-22T00:00:00Z"}',
     ARRAY['feature_guide_missing','web_not_deployed'], '{"3493":"https://github.com/Mingla-LLC/mingla-main/issues/3493#issuecomment-1"}'),
    -- Listed, the baseline app, but it added a migration: NOT converted.
    (4059, 'Baseline with a migration', 'https://github.com/Mingla-LLC/mingla-main/pull/4059', '2026-10-22T10:00:00Z',
     repeat('b', 40), 'mingla-bundle-baseline[bot]', '[{"number":3493,"relation":"toward"}]', ARRAY['20281205034618'], ARRAY['mingla-business'], false,
     '{"web":{"mingla-business":"not_deployed"},"edge":"none"}', ARRAY[]::text[], 'x reason', NULL,
     ARRAY['web_not_deployed','live_check_missing'], '{}'),
    -- Listed, the baseline app, another web project: NOT converted.
    (4075, 'Baseline touching admin', 'https://github.com/Mingla-LLC/mingla-main/pull/4075', '2026-10-22T11:00:00Z',
     repeat('c', 40), 'mingla-bundle-baseline[bot]', '[{"number":3493,"relation":"toward"}]', ARRAY[]::text[], ARRAY['mingla-admin'], false,
     '{"web":{"mingla-admin":"not_deployed"},"edge":"none"}', ARRAY[]::text[], 'x reason', NULL,
     ARRAY['web_not_deployed','live_check_missing'], '{}'),
    -- In the waived list but written by a person: no_issue stays.
    (4277, 'A person''s PR', 'https://github.com/Mingla-LLC/mingla-main/pull/4277', '2026-11-02T10:00:00Z',
     repeat('d', 40), 'sethogieva', '[]', ARRAY[]::text[], ARRAY[]::text[], false,
     '{"web":{},"edge":"none"}', NULL, NULL, NULL,
     ARRAY['no_issue','feature_guide_missing','live_check_missing'], '{}'),
    -- In the waived list, Dependabot, but it links an issue: not touched.
    (4464, 'Bump with an issue', 'https://github.com/Mingla-LLC/mingla-main/pull/4464', '2026-11-10T10:00:00Z',
     repeat('e', 40), 'dependabot[bot]', '[{"number":4618,"relation":"toward"}]', ARRAY[]::text[], ARRAY[]::text[], false,
     '{"web":{},"edge":"none"}', NULL, NULL, NULL,
     ARRAY['no_issue','feature_guide_missing','live_check_missing'], '{}');

  EXECUTE current_setting('issue4618t.correct');

  SELECT * INTO r FROM public.ops_release_records WHERE pr = 4051;
  IF r.release_kind <> 'bundle_baseline' OR NOT r.complete OR cardinality(r.problems) <> 0 THEN
    RAISE EXCEPTION 'issue4618t_a5_production_shape_not_complete:% % %', r.release_kind, r.complete, r.problems;
  END IF;
  IF (SELECT release_kind FROM public.ops_release_records WHERE pr = 4059) <> 'standard'
     OR (SELECT release_kind FROM public.ops_release_records WHERE pr = 4075) <> 'standard' THEN
    RAISE EXCEPTION 'issue4618t_a5_guard_bypassed_baseline';
  END IF;
  IF NOT (SELECT 'no_issue' = ANY (problems) FROM public.ops_release_records WHERE pr = 4277)
     OR NOT (SELECT 'no_issue' = ANY (problems) FROM public.ops_release_records WHERE pr = 4464) THEN
    RAISE EXCEPTION 'issue4618t_a5_guard_bypassed_no_issue';
  END IF;

  -- A second run changes zero rows (every column but updated_at compared).
  CREATE TEMP TABLE t4618_snap ON COMMIT DROP AS SELECT * FROM public.ops_release_records;
  EXECUTE current_setting('issue4618t.correct');
  SELECT count(*) INTO v_changed FROM public.ops_release_records x JOIN t4618_snap s USING (pr)
   WHERE (to_jsonb(x) - 'updated_at') IS DISTINCT FROM (to_jsonb(s) - 'updated_at');
  IF v_changed <> 0 THEN RAISE EXCEPTION 'issue4618t_a5_rerun_changed:%', v_changed; END IF;
  RAISE NOTICE 'PASS A5 correction guards hold and a re-run changes 0 rows';
END;
$a5$;

ROLLBACK;
\echo 'ISSUE-4618 TESTER ADVERSARIAL PASS'
