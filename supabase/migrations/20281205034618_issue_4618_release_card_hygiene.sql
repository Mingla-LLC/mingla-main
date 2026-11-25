-- #4618 — Release cards on the Work board that can never close.
--
-- 1. A bundle-baseline pull request (mingla-bundle-baseline[bot] changing only
--    mingla-business/scripts/ci/bundle-baseline.json) ships nothing. Its
--    record is release_kind 'bundle_baseline': it needs no live check and no
--    web deploy, so its card closes by itself.
-- 2. Feature Guide problems follow the stored classification: once a record
--    has a classification, it carries no feature_guide_missing / _invalid.
--    The classification itself stays immutable (#4179 trigger and
--    I-4179-RELEASE-REASON-ONE-WAY are unchanged).
-- 3. A stale record from the pull request's own comment (no issue linked)
--    never overwrites the issues of a row already read from a linked issue.
-- 4. One-time correction (approved by Seth on #4618): the 47 bundle-baseline
--    rows, the Feature Guide problems of every classified row, and no_issue on
--    the two Dependabot rows. Each changed row is recomputed; no card is
--    written here (card sync closes them on its next run).
--
-- Read-only probe (before and after apply):
--   select release_kind, count(*),
--          count(*) filter (where problems && array['feature_guide_missing','feature_guide_invalid']
--                             and feature_guide is not null) fg_stuck,
--          count(*) filter (where not complete) incomplete
--     from public.ops_release_records group by 1;
-- Expected after apply: fg_stuck = 0 on every row; bundle_baseline = 47.
--
-- Rollback: re-apply ops_release_records_ingest from
-- 20280211004179_issue_4179_release_reason_json_null.sql, ops_release_recompute
-- from 20271129003980_issue_3980_synced_w1_foundations.sql and
-- ops_release_items from 20280626014398_issue_4398_review_and_notices.sql,
-- then ALTER TABLE public.ops_release_records DROP COLUMN release_kind.

-- ---------------------------------------------------------------------------
-- 0. Preflight: the three bodies this migration replaces are the ones it was
--    written against.
-- ---------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_checks constant text[][] := ARRAY[
    ARRAY['public.ops_release_records_ingest(jsonb)',
          '|| ARRAY(SELECT p FROM unnest(r.problems) p WHERE p IN (''feature_guide_missing'',''feature_guide_invalid''))'],
    ARRAY['public.ops_release_recompute(integer)',
          'IF r.live_check IS NULL AND NOT ''live_check_missing'' = ANY (v_problems) THEN'],
    ARRAY['public.ops_release_items(integer)',
          'jsonb_build_object(''key'', ''live_check'''],
    ARRAY['public.ops_release_records_ingest(jsonb)',
          'issues = EXCLUDED.issues,']
  ];
  v_definition text;
  v_n integer;
  i integer;
BEGIN
  FOR i IN 1 .. array_length(v_checks, 1) LOOP
    SELECT pg_get_functiondef(v_checks[i][1]::regprocedure) INTO v_definition;
    v_n := (length(v_definition) - length(replace(v_definition, v_checks[i][2], ''))) / length(v_checks[i][2]);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'issue4618_contract_drift:%:%', v_checks[i][1], v_n;
    END IF;
  END LOOP;
END;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. The release kind.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ops_release_records
  ADD COLUMN release_kind text NOT NULL DEFAULT 'standard'
  CONSTRAINT ops_release_records_release_kind_check CHECK (release_kind IN ('standard', 'bundle_baseline'));

-- ---------------------------------------------------------------------------
-- 2. Ingest. Identical to 20280211004179 except:
--    (a) release_kind is accepted only absent, null, 'standard' or
--        'bundle_baseline'; 'bundle_baseline' also needs the baseline bot as
--        author, no migrations, no edge functions and web_projects within
--        {mingla-business}. Anything else makes the record invalid.
--    (b) release_kind moves forward only (standard -> bundle_baseline).
--    (c) Feature Guide problems come from the incoming record only while the
--        stored classification is NULL.
--    (d) a record read from the pull request's own comment with no issues
--        keeps the issues (and the absence of no_issue) of a row that already
--        has a record on a linked issue.
--    (e) (rework P2-2) any record read from the pull request's own comment,
--        on a row that already has a record on a linked issue, never replaces
--        a live check with an older one or with none: the newer of the two
--        stays.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_release_records_ingest(p_records jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $ingest$
DECLARE
  i jsonb; d jsonb; v_ingested integer := 0; v_invalid integer := 0; v_completed integer[] := ARRAY[]::integer[]; v_pr integer;
  v_was boolean; v_new boolean; v_url text; v_slot text; v_ok boolean;
  v_tests text[];
  v_stale_pr_slot boolean;
  v_pr_slot_behind boolean;
BEGIN
  PERFORM public.ops_service_only();
  IF p_records IS NULL OR jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) > 100 THEN
    RAISE EXCEPTION 'invalid_records: Send a list of at most 100 release records.' USING ERRCODE = '22023';
  END IF;
  FOR i IN SELECT e FROM jsonb_array_elements(p_records) e LOOP
    d := CASE WHEN jsonb_typeof(i) = 'object' THEN i->'data' END;
    v_ok := d IS NOT NULL AND jsonb_typeof(d) = 'object'
      AND d->>'v' = '1' AND d->>'repo' = 'Mingla-LLC/mingla-main'
      AND jsonb_typeof(d->'pr') = 'number' AND (d->>'pr') ~ '^[0-9]{1,7}$'
      AND jsonb_typeof(d->'title') = 'string' AND char_length(d->>'title') BETWEEN 1 AND 300
      AND d->>'pr_url' ~ '^https://github[.]com/Mingla-LLC/mingla-main/pull/[0-9]+$'
      AND d->>'pr_url' = 'https://github.com/Mingla-LLC/mingla-main/pull/' || (d->>'pr')
      AND jsonb_typeof(d->'merged_at') = 'string' AND d->>'merged_at' ~ '^\d{4}-\d{2}-\d{2}T'
      AND d->>'merge_sha' ~ '^[0-9a-f]{40}$'
      AND jsonb_typeof(d->'issues') = 'array' AND jsonb_array_length(d->'issues') <= 10
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'issues') x
                       WHERE jsonb_typeof(x) <> 'object' OR jsonb_typeof(x->'number') <> 'number' OR (x->>'number') !~ '^[0-9]{1,7}$'
                          OR x->>'relation' NOT IN ('toward','fixes'))
      AND jsonb_typeof(d->'migrations_added') = 'array'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'migrations_added') x WHERE jsonb_typeof(x) <> 'string' OR x #>> '{}' !~ '^[0-9]{14}$')
      AND jsonb_typeof(d->'edge_functions') = 'array'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'edge_functions') x WHERE jsonb_typeof(x) <> 'string' OR char_length(x #>> '{}') > 80)
      AND jsonb_typeof(d->'web_projects') = 'array'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'web_projects') x
                       WHERE NOT (x #>> '{}') = ANY (ARRAY['mingla-admin','mingla-business','mingla-marketing','mingla-site-cms','mingla-sites']))
      AND jsonb_typeof(d->'deploy_marker') = 'boolean'
      AND jsonb_typeof(d->'deploy') = 'object'
      AND (d->'feature_guide' IS NULL OR jsonb_typeof(d->'feature_guide') IN ('array','null'))
      AND (jsonb_typeof(d->'feature_guide') IS DISTINCT FROM 'array' OR (jsonb_array_length(d->'feature_guide') <= 500
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'feature_guide') x WHERE jsonb_typeof(x) <> 'string' OR (x #>> '{}') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')))
      AND (d->'feature_guide_reason' IS NULL OR jsonb_typeof(d->'feature_guide_reason') = 'null'
           OR (jsonb_typeof(d->'feature_guide_reason') = 'string'
             AND char_length(btrim(d->>'feature_guide_reason')) BETWEEN 3 AND 500))
      AND (jsonb_typeof(d->'feature_guide') IS DISTINCT FROM 'array'
           OR jsonb_array_length(d->'feature_guide') = 0
           OR d->'feature_guide_reason' IS NULL
           OR jsonb_typeof(d->'feature_guide_reason') = 'null')
      AND (d->'live_check' IS NULL OR jsonb_typeof(d->'live_check') IN ('object','null'))
      AND jsonb_typeof(d->'problems') = 'array'
      -- #4618 (a): the release kind, and the only shape a bundle baseline may have.
      AND (d->'release_kind' IS NULL OR jsonb_typeof(d->'release_kind') = 'null'
           OR (jsonb_typeof(d->'release_kind') = 'string' AND d->>'release_kind' IN ('standard','bundle_baseline')))
      AND (d->>'release_kind' IS DISTINCT FROM 'bundle_baseline'
           OR (d->>'author' = 'mingla-bundle-baseline[bot]'
               AND jsonb_array_length(d->'migrations_added') = 0
               AND jsonb_array_length(d->'edge_functions') = 0
               AND (d->'web_projects') <@ '["mingla-business"]'::jsonb));
    IF NOT v_ok THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;
    BEGIN
      v_pr := (d->>'pr')::integer;
      -- Preserve Bridge B's bounded test-file citations. The reconciliation
      -- extends the release-record contract; it does not replace this proof.
      v_tests := ARRAY(
        SELECT x
          FROM jsonb_array_elements_text(
                 CASE WHEN jsonb_typeof(d->'test_files') = 'array'
                      THEN d->'test_files' ELSE '[]'::jsonb END
               ) WITH ORDINALITY t(x, o)
         WHERE t.o <= 50
           AND char_length(x) <= 300
           AND x ~ '^[A-Za-z0-9._/@+-]+$'
           AND x !~ '(^|/)[.][.](/|$)'
         ORDER BY t.o
      );
      v_url := CASE WHEN jsonb_typeof(i->'comment_url') = 'string'
                         AND i->>'comment_url' ~ '^https://github[.]com/Mingla-LLC/mingla-main/(issues|pull)/[0-9]+#issuecomment-[0-9]+$'
                    THEN i->>'comment_url' END;
      v_slot := CASE WHEN jsonb_typeof(i->'issue_number') = 'number' AND (i->>'issue_number') ~ '^[0-9]{1,7}$' AND (i->>'issue_number')::integer <> v_pr
                     THEN i->>'issue_number' ELSE 'pr' END;
      -- #4618 (d): a record read from the pull request's own comment, with no
      -- issues, is stale once the row already has a record on a linked issue.
      SELECT x.complete,
             v_slot = 'pr' AND EXISTS (SELECT 1 FROM jsonb_object_keys(x.comment_urls) k WHERE k ~ '^[0-9]+$')
        INTO v_was, v_pr_slot_behind
        FROM public.ops_release_records x WHERE x.pr = v_pr;
      v_new := NOT FOUND;
      v_pr_slot_behind := COALESCE(v_pr_slot_behind, false);
      v_stale_pr_slot := v_pr_slot_behind AND jsonb_array_length(d->'issues') = 0;
      INSERT INTO public.ops_release_records AS r (pr, title, pr_url, merged_at, merge_sha, merged_by_login, author_login, issues,
        migrations_added, edge_functions, web_projects, deploy_marker, deploy, feature_guide, feature_guide_reason, live_check, problems, comment_urls,
        test_files, release_kind)
      VALUES (v_pr, left(d->>'title', 300), d->>'pr_url', (d->>'merged_at')::timestamptz, d->>'merge_sha',
        NULLIF(left(d->>'merged_by', 39), ''), NULLIF(left(d->>'author', 39), ''), d->'issues',
        ARRAY(SELECT x FROM jsonb_array_elements_text(d->'migrations_added') x ORDER BY x),
        ARRAY(SELECT x FROM jsonb_array_elements_text(d->'edge_functions') x),
        ARRAY(SELECT x FROM jsonb_array_elements_text(d->'web_projects') x),
        (d->>'deploy_marker')::boolean, d->'deploy',
        CASE WHEN jsonb_typeof(d->'feature_guide') = 'array' THEN ARRAY(SELECT x FROM jsonb_array_elements_text(d->'feature_guide') x) END,
        CASE WHEN jsonb_typeof(d->'feature_guide_reason') = 'string' THEN left(btrim(d->>'feature_guide_reason'), 500) END,
        CASE WHEN jsonb_typeof(d->'live_check') = 'object' THEN jsonb_build_object('text', left(d->'live_check'->>'text', 500),
          'by_login', left(d->'live_check'->>'by_login', 39), 'url', left(d->'live_check'->>'url', 300), 'at', d->'live_check'->>'at') END,
        ARRAY(SELECT left(x, 60) FROM jsonb_array_elements_text(d->'problems') x),
        CASE WHEN v_url IS NOT NULL THEN jsonb_build_object(v_slot, v_url) ELSE '{}'::jsonb END,
        v_tests,
        COALESCE(d->>'release_kind', 'standard'))
      ON CONFLICT (pr) DO UPDATE SET title = EXCLUDED.title, merged_at = EXCLUDED.merged_at, merge_sha = EXCLUDED.merge_sha,
        merged_by_login = EXCLUDED.merged_by_login, author_login = EXCLUDED.author_login,
        issues = CASE WHEN v_stale_pr_slot THEN r.issues ELSE EXCLUDED.issues END,
        migrations_added = EXCLUDED.migrations_added, edge_functions = EXCLUDED.edge_functions, web_projects = EXCLUDED.web_projects,
        deploy_marker = EXCLUDED.deploy_marker, deploy = EXCLUDED.deploy,
        feature_guide = COALESCE(r.feature_guide, EXCLUDED.feature_guide),
        feature_guide_reason = CASE
          WHEN r.feature_guide IS NULL THEN EXCLUDED.feature_guide_reason
          WHEN cardinality(r.feature_guide) = 0
               AND cardinality(EXCLUDED.feature_guide) = 0
               AND r.feature_guide_reason IS NULL
            THEN EXCLUDED.feature_guide_reason
          ELSE r.feature_guide_reason
        END,
        -- #4618 (e): a record from the PR's own comment never takes a live
        -- check away from a row already read from a linked issue.
        live_check = CASE
          WHEN NOT v_pr_slot_behind OR r.live_check IS NULL THEN EXCLUDED.live_check
          WHEN EXCLUDED.live_check IS NULL THEN r.live_check
          WHEN public.ops_try_timestamptz(EXCLUDED.live_check->>'at')
               > COALESCE(public.ops_try_timestamptz(r.live_check->>'at'), '-infinity'::timestamptz)
            THEN EXCLUDED.live_check
          ELSE r.live_check
        END,
        -- #4618 (c)/(d): Feature Guide problems only while unclassified; a
        -- stale pull-request record keeps the row's own no_issue state.
        problems = ARRAY(SELECT p FROM unnest(EXCLUDED.problems) p
                          WHERE (p NOT IN ('feature_guide_missing','feature_guide_invalid') OR r.feature_guide IS NULL)
                            AND (p <> 'no_issue' OR NOT v_stale_pr_slot))
          || CASE WHEN v_stale_pr_slot AND 'no_issue' = ANY (r.problems) THEN ARRAY['no_issue']::text[] ELSE ARRAY[]::text[] END,
        comment_urls = r.comment_urls || EXCLUDED.comment_urls,
        test_files = EXCLUDED.test_files,
        release_kind = CASE WHEN r.release_kind = 'bundle_baseline' THEN r.release_kind ELSE EXCLUDED.release_kind END,
        updated_at = now();
      IF v_new THEN
        PERFORM public.ops_log_write('system@usemingla.com', 'system', 'release_record', 'info', NULL, 'release', NULL,
          format('Release record of PR #%s read from GitHub: %s', v_pr, left(d->>'title', 200)), jsonb_build_object('pr', v_pr));
      END IF;
      IF public.ops_release_recompute(v_pr) AND NOT COALESCE(v_was, false) THEN
        v_completed := v_completed || v_pr;
      END IF;
      v_ingested := v_ingested + 1;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'ops_release_records_ingest: record skipped (% %)', SQLSTATE, SQLERRM;
      v_invalid := v_invalid + 1;
    END;
  END LOOP;
  -- Keep Bridge B synchronous for a release record that becomes complete in
  -- this call. The periodic reconcile remains the retry path for incomplete
  -- evidence and records captured before this migration is applied.
  IF cardinality(v_completed) > 0 THEN
    BEGIN
      PERFORM public.ops_release_guide_apply();
    EXCEPTION WHEN others THEN
      RAISE WARNING 'ops_release_records_ingest: Feature Guide step stopped (% %)', SQLSTATE, SQLERRM;
    END;
  END IF;
  RETURN jsonb_build_object('ingested', v_ingested, 'invalid', v_invalid, 'completed', to_jsonb(v_completed));
END;
$ingest$;

REVOKE EXECUTE ON FUNCTION public.ops_release_records_ingest(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_release_records_ingest(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Recompute. Identical to 20271129003980 except: Feature Guide problems go
--    once the record is classified; a bundle baseline drops web_not_deployed,
--    never gets live_check_missing, ignores web deploy states, and completes
--    without a live check.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_release_recompute(p_pr integer) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE r public.ops_release_records; v_applied text[]; v_problems text[]; v_complete boolean; v_pending boolean; v_k text;
  v_baseline boolean;
BEGIN
  SELECT * INTO r FROM public.ops_release_records x WHERE x.pr = p_pr FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  v_baseline := r.release_kind = 'bundle_baseline';
  v_applied := public.ops_ledger_applied(r.migrations_added);
  v_problems := ARRAY(SELECT DISTINCT p FROM unnest(r.problems) p
                       WHERE p IN ('no_issue','feature_guide_missing','feature_guide_invalid','web_not_deployed','web_deploy_failed',
                                   'edge_deploy_failed','live_check_missing')
                         AND NOT (p = 'live_check_missing' AND (r.live_check IS NOT NULL OR v_baseline))
                         AND NOT (p IN ('feature_guide_missing','feature_guide_invalid') AND r.feature_guide IS NOT NULL)
                         AND NOT (p IN ('web_not_deployed','web_deploy_failed') AND v_baseline) ORDER BY p);
  IF r.live_check IS NULL AND NOT v_baseline AND NOT 'live_check_missing' = ANY (v_problems) THEN v_problems := v_problems || 'live_check_missing'::text; END IF;
  IF EXISTS (SELECT 1 FROM unnest(r.migrations_added) m WHERE NOT m = ANY (v_applied)) THEN
    v_problems := v_problems || 'migrations_pending'::text;
  END IF;
  FOREACH v_k IN ARRAY COALESCE(r.feature_guide, ARRAY[]::text[]) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.product_capabilities c WHERE c.capability_key = v_k) THEN
      v_problems := v_problems || ('unknown_feature_guide_key:' || left(v_k, 80));
    END IF;
  END LOOP;
  v_pending := (NOT v_baseline AND EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(r.deploy->'web', '{}'::jsonb)) w WHERE w.value = 'pending'))
               OR r.deploy->>'edge' = 'pending';
  v_complete := cardinality(v_problems) = 0 AND (r.live_check IS NOT NULL OR v_baseline) AND r.feature_guide IS NOT NULL AND NOT v_pending;
  UPDATE public.ops_release_records x SET migrations_applied = v_applied, problems = v_problems, complete = v_complete,
         completed_at = CASE WHEN v_complete AND NOT r.complete THEN now() WHEN NOT v_complete THEN NULL ELSE x.completed_at END,
         updated_at = now()
   WHERE x.pr = p_pr;
  IF v_complete AND NOT r.complete THEN
    PERFORM public.ops_log_write('system@usemingla.com', 'system', 'release_record', 'ok', NULL, 'release', NULL,
      format('Release record of PR #%s is complete: %s', r.pr, left(r.title, 200)), jsonb_build_object('pr', r.pr));
  END IF;
  RETURN v_complete;
END;
$$;

REVOKE ALL ON FUNCTION public.ops_release_recompute(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_release_recompute(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The release card's checklist. Identical to 20280626014398 except a
--    bundle baseline has no deploy items and no live-check item.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_release_items(p_pr integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE r public.ops_release_records; v_items jsonb := '[]'::jsonb; v_proj text; v_baseline boolean;
BEGIN
  SELECT * INTO r FROM public.ops_release_records x WHERE x.pr = p_pr;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_baseline := r.release_kind = 'bundle_baseline';
  v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'record', 'text', 'Release record written', 'done', true));
  v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'issue', 'text', 'The pull request names its issue',
    'done', NOT ('no_issue' = ANY (r.problems)) OR EXISTS (SELECT 1 FROM jsonb_object_keys(r.comment_urls) k WHERE k ~ '^[0-9]+$')));
  v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'guide', 'text', 'Feature Guide line on the pull request',
    'done', NOT (r.problems && ARRAY['feature_guide_missing','feature_guide_invalid']::text[])));
  IF NOT v_baseline THEN
    FOR v_proj IN SELECT e.k FROM jsonb_each_text(COALESCE(r.deploy->'web', '{}'::jsonb)) e(k, val) WHERE e.val <> 'failed' ORDER BY e.k LOOP
      v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'deploy:' || v_proj, 'text', format('%s deployed to production', v_proj),
        'done', r.deploy->'web'->>v_proj <> 'not_deployed'
                OR EXISTS (SELECT 1 FROM public.ops_release_records y WHERE y.merged_at > r.merged_at AND y.deploy->'web'->>v_proj = 'ready')));
    END LOOP;
  END IF;
  IF cardinality(r.migrations_added) > 0 THEN
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'migrations', 'text', 'Migrations applied in production',
      'done', NOT ('migrations_pending' = ANY (r.problems))));
  END IF;
  IF NOT v_baseline THEN
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'live_check', 'text', 'Live check posted on the issue',
      'done', NOT ('live_check_missing' = ANY (r.problems))));
  END IF;
  RETURN v_items;
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_release_items(integer) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. One-time correction (Seth approved the rows on #4618). Explicit lists;
--    each guarded by author so a reused number can never match another PR.
--    Every PR below was checked with GitHub: merged, by the baseline app,
--    exactly one changed file, mingla-business/scripts/ci/bundle-baseline.json.
-- ---------------------------------------------------------------------------
DO $correct$
DECLARE
  v_baseline_prs constant integer[] := ARRAY[
    4051,4059,4075,4105,4109,4124,4129,4133,4146,4154,4163,4231,4302,4307,4313,4324,
    4340,4345,4355,4358,4365,4366,4376,4390,4394,4397,4413,4417,4450,4472,4482,4503,
    4510,4515,4520,4524,4529,4537,4544,4550,4554,4558,4563,4589,4597,4608,4613];
  -- D1: Dependabot pull requests with no linked issue. No other row carried
  -- no_issue on 25 Nov (production read on #4618).
  v_waived_prs constant integer[] := ARRAY[4277,4464];
  v_kind integer[]; v_fg integer[]; v_issue integer[]; v_all integer[]; v_pr integer; v_complete integer := 0;
BEGIN
  WITH u AS (
    UPDATE public.ops_release_records x SET release_kind = 'bundle_baseline', updated_at = now()
     WHERE x.pr = ANY (v_baseline_prs) AND x.author_login = 'mingla-bundle-baseline[bot]'
       AND x.release_kind <> 'bundle_baseline'
       AND cardinality(x.migrations_added) = 0 AND cardinality(x.edge_functions) = 0
       AND x.web_projects <@ ARRAY['mingla-business']::text[]
    RETURNING x.pr)
  SELECT COALESCE(array_agg(pr ORDER BY pr), ARRAY[]::integer[]) INTO v_kind FROM u;

  WITH u AS (
    UPDATE public.ops_release_records x
       SET problems = ARRAY(SELECT p FROM unnest(x.problems) p WHERE p NOT IN ('feature_guide_missing','feature_guide_invalid')),
           updated_at = now()
     WHERE x.feature_guide IS NOT NULL
       AND x.problems && ARRAY['feature_guide_missing','feature_guide_invalid']::text[]
    RETURNING x.pr)
  SELECT COALESCE(array_agg(pr ORDER BY pr), ARRAY[]::integer[]) INTO v_fg FROM u;

  WITH u AS (
    UPDATE public.ops_release_records x
       SET problems = array_remove(x.problems, 'no_issue'), updated_at = now()
     WHERE x.pr = ANY (v_waived_prs) AND x.author_login = 'dependabot[bot]'
       AND jsonb_array_length(x.issues) = 0 AND 'no_issue' = ANY (x.problems)
    RETURNING x.pr)
  SELECT COALESCE(array_agg(pr ORDER BY pr), ARRAY[]::integer[]) INTO v_issue FROM u;

  v_all := ARRAY(SELECT DISTINCT p FROM unnest(v_kind || v_fg || v_issue) p ORDER BY p);
  FOREACH v_pr IN ARRAY v_all LOOP
    IF public.ops_release_recompute(v_pr) THEN v_complete := v_complete + 1; END IF;
  END LOOP;

  RAISE NOTICE 'issue4618_correction: bundle_baseline=% feature_guide_cleared=% no_issue_cleared=% recomputed=% complete_after=%',
    cardinality(v_kind), cardinality(v_fg), cardinality(v_issue), cardinality(v_all), v_complete;
END;
$correct$;
