-- #4179 — Let a corrected release record fill one missing no-effect reason.

DO $preflight$
DECLARE
  v_definition text;
  v_old constant text := 'feature_guide_reason = CASE WHEN r.feature_guide IS NULL THEN EXCLUDED.feature_guide_reason ELSE r.feature_guide_reason END,';
  v_occurrences integer;
BEGIN
  SELECT pg_get_functiondef('public.ops_release_records_ingest(jsonb)'::regprocedure)
    INTO v_definition;

  v_occurrences := (
    length(v_definition) - length(replace(v_definition, v_old, ''))
  ) / length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'issue4179_release_ingest_contract_drift:%', v_occurrences;
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.ops_release_records_ingest(p_records jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $ingest$
DECLARE
  i jsonb; d jsonb; v_ingested integer := 0; v_invalid integer := 0; v_completed integer[] := ARRAY[]::integer[]; v_pr integer;
  v_was boolean; v_new boolean; v_url text; v_slot text; v_ok boolean;
  v_tests text[];
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
      AND (jsonb_typeof(d->'feature_guide') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'feature_guide') = 0 OR d->'feature_guide_reason' IS NULL)
      AND (d->'live_check' IS NULL OR jsonb_typeof(d->'live_check') IN ('object','null'))
      AND jsonb_typeof(d->'problems') = 'array';
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
      SELECT x.complete INTO v_was FROM public.ops_release_records x WHERE x.pr = v_pr;
      v_new := NOT FOUND;
      INSERT INTO public.ops_release_records AS r (pr, title, pr_url, merged_at, merge_sha, merged_by_login, author_login, issues,
        migrations_added, edge_functions, web_projects, deploy_marker, deploy, feature_guide, feature_guide_reason, live_check, problems, comment_urls,
        test_files)
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
        v_tests)
      ON CONFLICT (pr) DO UPDATE SET title = EXCLUDED.title, merged_at = EXCLUDED.merged_at, merge_sha = EXCLUDED.merge_sha,
        merged_by_login = EXCLUDED.merged_by_login, author_login = EXCLUDED.author_login, issues = EXCLUDED.issues,
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
        live_check = EXCLUDED.live_check,
        problems = ARRAY(SELECT p FROM unnest(EXCLUDED.problems) p WHERE p NOT IN ('feature_guide_missing','feature_guide_invalid'))
          || ARRAY(SELECT p FROM unnest(r.problems) p WHERE p IN ('feature_guide_missing','feature_guide_invalid')),
        comment_urls = r.comment_urls || EXCLUDED.comment_urls,
        test_files = EXCLUDED.test_files,
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

DO $repair_pr_4184$
DECLARE
  c_merge_sha constant text := '5d6c44510329da1b0c17478a76dc356558f1d037';
  c_reason constant text := 'trusted release-record parser and regression-test change only; no product capability changed';
BEGIN
  IF EXISTS (SELECT 1 FROM public.ops_release_records WHERE pr = 4184) THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.ops_release_records
       WHERE pr = 4184
         AND merge_sha = c_merge_sha
         AND cardinality(feature_guide) = 0
         AND (feature_guide_reason IS NULL OR feature_guide_reason = c_reason)
    ) THEN
      RAISE EXCEPTION 'issue4179_pr_4184_release_record_drift';
    END IF;

    UPDATE public.ops_release_records
       SET feature_guide_reason = c_reason,
           updated_at = now()
     WHERE pr = 4184
       AND merge_sha = c_merge_sha
       AND cardinality(feature_guide) = 0
       AND feature_guide_reason IS NULL;
  END IF;
END;
$repair_pr_4184$;
