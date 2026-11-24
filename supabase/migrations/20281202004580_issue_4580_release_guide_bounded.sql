-- #4580 — the Feature Guide step of the release-record sync is bounded.
--
-- Since 22 Nov 2026 15:09 UTC every release-record ingest timed out: PR #4553
-- named 99 Feature Guide entries, and ops_release_guide_apply() re-ran the
-- "who on Support to tell" query for every entry, each time checking
-- is_support_staff() on every auth.users row (~90 ms). 99 x 90 ms passed the
-- 8 s statement timeout; 57014 escapes WHEN others, so the whole ingest rolled
-- back and the issue_comments cursor never moved.
--
-- A1. ops_release_guide_watchers(): the same people, worked out once per call,
--     checking is_support_staff() only on the few directory matches.
-- A2. ops_release_guide_budget(): the per-call time budget (4 s), one source.
-- A3. ops_release_guide_apply(): watchers once per call; keys already found
--     incomplete retried at most hourly; stops taking new keys once the budget
--     has passed (the next pass carries on, and says so in the Admin log); one
--     "is Live" notice per release per pass instead of one per entry.
-- A4. ops_release_record_poisoned(): the audible record of a release record
--     the bridge had to skip because it fails on its own.
-- A4b. ops_release_batch_halted() (amendment A3): when every record of a
--     batch fails, nothing is skipped; one log row and one owner notice.
--
-- ops_release_records_ingest(jsonb) is not changed: its call to
-- ops_release_guide_apply() is safe once the callee is bounded.
--
-- A0b. ops_agent_log_action_check also allows guide_deferred and
--     release_record_poisoned (added beside the current rule).
--
-- Rollback (A5): re-apply public.ops_release_guide_apply() from
-- 20280626014398_issue_4398_review_and_notices.sql, then
--   DROP FUNCTION public.ops_release_guide_watchers(),
--                 public.ops_release_guide_budget(),
--                 public.ops_release_record_poisoned(integer, text, text),
--                 public.ops_release_batch_halted(integer, integer, integer, text, text);
-- and, once no ops_agent_log row uses the two actions, restore
-- ops_agent_log_action_check from 20271202003980_issue_3980_synced_w4_backfills_guide.sql.
-- Warning: rolling back restores the timeout (one PR naming ~90+ entries
-- freezes the sync again). Move #4553's keys out of the way first.

BEGIN;

-- A0. Drift preflight. The body replaced below is the one from
-- 20280626014398_issue_4398_review_and_notices.sql (production md5 of prosrc
-- a99353b77058fc8b0443f3501a30ec8b on 23 Nov 2026).
DO $preflight$
DECLARE
  v_definition text;
  v_old constant text := 'v_watchers := ARRAY(SELECT d.email FROM public.admin_team_directory() d';
  v_n integer;
BEGIN
  SELECT pg_get_functiondef('public.ops_release_guide_apply()'::regprocedure) INTO v_definition;
  v_n := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'issue4580_guide_apply_contract_drift:%', v_n;
  END IF;
END;
$preflight$;

-- A0b. The Admin log learns the two actions this migration writes
-- (guide_deferred, release_record_poisoned). The current rule is kept as it
-- is and the two names are added beside it, so every action it already
-- allows stays allowed. Skipped when they are already allowed.
DO $log_actions$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.ops_agent_log'::regclass AND c.conname = 'ops_agent_log_action_check';
  IF v_def IS NULL OR v_def !~ '^CHECK \(.*\)$' THEN
    RAISE EXCEPTION 'issue4580_agent_log_action_check_missing:%', coalesce(v_def, '<null>');
  END IF;
  IF position('''guide_deferred''' in v_def) > 0 AND position('''release_record_poisoned''' in v_def) > 0 THEN
    RETURN;
  END IF;
  ALTER TABLE public.ops_agent_log DROP CONSTRAINT ops_agent_log_action_check;
  EXECUTE format('ALTER TABLE public.ops_agent_log ADD CONSTRAINT ops_agent_log_action_check CHECK (%s OR action IN (%L, %L))',
                 substring(v_def from '^CHECK (.*)$'), 'guide_deferred', 'release_record_poisoned');
END;
$log_actions$;

-- A1. Who on Support hears that an entry is Live: an active directory row,
-- not the owner, a matching sign-in account by lower(btrim(email)), and
-- is_support_staff() on that account. The same four conditions and the same
-- GROUP BY / ORDER BY / LIMIT 10 as the inline query it replaces; only the
-- order of evaluation changes (the directory's few emails first).
CREATE OR REPLACE FUNCTION public.ops_release_guide_watchers() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
  WITH dir AS MATERIALIZED (SELECT d.email FROM public.admin_team_directory() d
                             WHERE d.status = 'active' AND d.email IS DISTINCT FROM public.ops_owner_email()),
       cand AS MATERIALIZED (SELECT DISTINCT dir.email, u.id FROM dir JOIN auth.users u ON lower(btrim(u.email)) = dir.email)
  SELECT COALESCE(array_agg(e ORDER BY e), ARRAY[]::text[]) FROM (SELECT c.email e FROM cand c
   WHERE public.is_support_staff(c.id) GROUP BY c.email ORDER BY c.email LIMIT 10) z
$function$;
REVOKE ALL ON FUNCTION public.ops_release_guide_watchers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_release_guide_watchers() TO service_role;
COMMENT ON FUNCTION public.ops_release_guide_watchers() IS
  'Issue #4580. The owner-excluded Support watchers told that a Feature Guide entry is Live (at most 10, by email). Read once per ops_release_guide_apply() call.';

-- A2. The time budget of one ops_release_guide_apply() call. STABLE, not
-- IMMUTABLE, so a test can replace it inside its transaction.
CREATE OR REPLACE FUNCTION public.ops_release_guide_budget() RETURNS interval
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT interval '4 seconds'
$function$;
REVOKE ALL ON FUNCTION public.ops_release_guide_budget() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_release_guide_budget() TO service_role;
COMMENT ON FUNCTION public.ops_release_guide_budget() IS
  'Issue #4580. How long one ops_release_guide_apply() call keeps taking new Feature Guide keys, measured from statement_timestamp() (the clock statement_timeout uses).';

-- A3. From its latest definition (#4398), bounded. #4580.
CREATE OR REPLACE FUNCTION public.ops_release_guide_apply()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  c_actor constant text := 'system@usemingla.com'; c_repo constant text := 'https://github.com/Mingla-LLC/mingla-main/';
  r public.ops_release_records; k public.ops_release_guide_keys; v_k text; cap public.product_capabilities;
  v_new jsonb; v_kind text; v_missing text[]; v_results jsonb; v_record_url text;
  v_live_at timestamptz; v_live_url text; v_deploy text; v_test text; v_ev uuid; e jsonb; v_rev integer;
  v_live integer := 0; v_incomplete integer := 0; v_records integer := 0;
  -- #4580: Support watchers are read once per call, at the first notice.
  v_watchers text[] := NULL;
  -- #4580: keys taken in this call, and whether the time budget stopped it.
  v_done integer := 0; v_deferred boolean := false;
  -- #4580: the entries of this release that turned Live in this pass.
  v_live_keys text[]; v_live_titles text[]; v_n integer;
  v_boss text := public.ops_owner_email();
BEGIN
  FOR r IN SELECT x.* FROM public.ops_release_records x
            WHERE x.complete
              AND EXISTS (SELECT 1 FROM public.ops_release_guide_keys pending
                           WHERE pending.pr = x.pr AND pending.applied_at IS NULL
                             AND (pending.result = 'pending' OR pending.last_attempt_at IS NULL
                                  OR pending.last_attempt_at < now() - interval '1 hour'))
            ORDER BY x.merged_at, x.pr FOR UPDATE LOOP
    v_results := '[]'::jsonb;
    v_live_keys := ARRAY[]::text[]; v_live_titles := ARRAY[]::text[];
    v_record_url := (SELECT u.value FROM jsonb_each_text(r.comment_urls) u ORDER BY (u.key = 'pr'), u.key LIMIT 1);
    v_live_url := CASE WHEN r.live_check->>'url' ~ '^https://github[.]com/Mingla-LLC/mingla-main/(issues|pull)/[0-9]+#issuecomment-[0-9]+$'
                       THEN r.live_check->>'url' END;
    v_live_at := LEAST(COALESCE(public.ops_try_timestamptz(r.live_check->>'at'), r.completed_at, now()), now());
    SELECT string_agg(d, '; ') INTO v_deploy FROM (
      SELECT w.key || ' READY' AS d FROM jsonb_each_text(COALESCE(r.deploy->'web', '{}'::jsonb)) w WHERE w.value = 'ready'
      UNION ALL SELECT 'edge functions ' || array_to_string(r.edge_functions, ', ') || ' deployed' WHERE r.deploy->>'edge' = 'deployed') z;
    v_test := (SELECT t FROM unnest(r.test_files) WITH ORDINALITY u(t, o) ORDER BY u.o LIMIT 1);

    FOR k IN SELECT pending.* FROM public.ops_release_guide_keys pending
              WHERE pending.pr = r.pr AND pending.applied_at IS NULL
                AND (pending.result = 'pending' OR pending.last_attempt_at IS NULL
                     OR pending.last_attempt_at < now() - interval '1 hour')
              ORDER BY pending.capability_key FOR UPDATE LOOP
      -- #4580: stop taking new keys once the budget has passed; every call
      -- still takes at least one key, so each pass makes progress.
      IF v_done > 0 AND clock_timestamp() - statement_timestamp() > public.ops_release_guide_budget() THEN
        v_deferred := true;
        EXIT;
      END IF;
      -- Counted when taken, so every result (unknown, retired, incomplete,
      -- live) counts once.
      v_done := v_done + 1;
      v_k := k.capability_key;
      SELECT * INTO cap FROM public.product_capabilities pc WHERE pc.capability_key = v_k FOR UPDATE;
      IF NOT FOUND THEN
        UPDATE public.ops_release_guide_keys SET result = 'unknown_key', last_attempt_at = now(),
          details = jsonb_build_object('missing','catalog entry') WHERE pr = r.pr AND capability_key = v_k;
        v_results := v_results || jsonb_build_array(jsonb_build_object('key', v_k, 'result', 'unknown_key'));
        CONTINUE;
      END IF;
      IF cap.claimed_status = 'retired' THEN
        UPDATE public.ops_release_guide_keys SET result = 'retired', applied_at = now(), last_attempt_at = now(),
          details = '{}'::jsonb WHERE pr = r.pr AND capability_key = v_k;
        v_results := v_results || jsonb_build_array(jsonb_build_object('key', v_k, 'title', cap.title, 'result', 'retired'));
        CONTINUE;
      END IF;

      v_new := '[]'::jsonb;
      IF v_record_url IS NOT NULL THEN
        v_new := v_new || jsonb_build_array(jsonb_build_object('kind', 'release_record', 'url', v_record_url, 'at', COALESCE(r.completed_at, now()),
          'details', format('Release record of PR #%s (merge %s) is complete.', r.pr, left(r.merge_sha, 9))));
      END IF;
      v_new := v_new || jsonb_build_array(jsonb_build_object('kind', 'pull_request', 'url', r.pr_url, 'at', r.merged_at,
        'details', format('PR #%s merged %s UTC.', r.pr, to_char(r.merged_at AT TIME ZONE 'UTC', 'FMDD Mon YYYY HH24:MI'))));
      IF cardinality(r.migrations_added) > 0 AND r.migrations_added <@ r.migrations_applied THEN
        v_new := v_new || jsonb_build_array(jsonb_build_object('kind', 'migration', 'url', r.pr_url || '/files', 'at', r.merged_at,
          'details', format('Migrations %s are in the production ledger.', array_to_string(r.migrations_added, ', '))));
      END IF;
      IF v_deploy IS NOT NULL THEN
        v_new := v_new || jsonb_build_array(jsonb_build_object('kind', 'deployment', 'url', c_repo || 'commit/' || r.merge_sha, 'at', r.merged_at,
          'details', format('Deployed: %s.', v_deploy)));
      END IF;
      IF v_live_url IS NOT NULL THEN
        v_new := v_new || jsonb_build_array(jsonb_build_object('kind', 'live_check', 'url', v_live_url, 'at', v_live_at,
          'expires_at', v_live_at + interval '90 days',
          'details', left(format('Live check by @%s: %s', COALESCE(NULLIF(r.live_check->>'by_login', ''), 'a teammate'),
                                 COALESCE(NULLIF(btrim(r.live_check->>'text'), ''), 'checked in production.')), 2000)));
      END IF;
      -- A named capability was dirtied by this merge. Its source citation
      -- must therefore move to this exact merge even when older source proof
      -- is still current.
      v_new := v_new || jsonb_build_array(jsonb_build_object('kind', 'source', 'url', c_repo || 'commit/' || r.merge_sha, 'at', r.merged_at,
        'details', format('Merge commit of PR #%s.', r.pr)));
      IF 'test' = ANY (cap.required_evidence_kinds) AND v_test IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.product_capability_evidence pe WHERE pe.capability_id = cap.id AND pe.evidence_kind = 'test'
                            AND pe.is_current AND pe.verdict = 'verified' AND (pe.expires_at IS NULL OR pe.expires_at > now())) THEN
        v_new := v_new || jsonb_build_array(jsonb_build_object('kind', 'test', 'url', c_repo || 'blob/' || r.merge_sha || '/' || v_test, 'at', r.merged_at,
          'details', left(format('Test changed by PR #%s: %s', r.pr, v_test), 2000)));
      END IF;

      v_missing := ARRAY(
        SELECT 'no ' || replace(req.kind, '_', ' ') || ' evidence' FROM unnest(cap.required_evidence_kinds) WITH ORDINALITY req(kind, o)
         WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new) nw WHERE nw->>'kind' = req.kind
                              AND (nw->>'expires_at' IS NULL OR (nw->>'expires_at')::timestamptz > now()))
           AND NOT EXISTS (SELECT 1 FROM public.product_capability_evidence pe WHERE pe.capability_id = cap.id AND pe.evidence_kind = req.kind
                              AND pe.is_current AND pe.verdict = 'verified' AND (pe.expires_at IS NULL OR pe.expires_at > now()))
         ORDER BY req.o)
        || ARRAY(
        SELECT replace(pe.evidence_kind, '_', ' ') || ' evidence is ' || CASE WHEN pe.verdict = 'conflict' THEN 'in conflict' ELSE 'out of date' END
          FROM public.product_capability_evidence pe
         WHERE pe.capability_id = cap.id AND pe.is_current AND (pe.verdict = 'conflict' OR (pe.expires_at IS NOT NULL AND pe.expires_at <= now()))
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new) nw WHERE nw->>'kind' = pe.evidence_kind)
         ORDER BY pe.evidence_kind);
      IF cardinality(v_missing) > 0 THEN
        UPDATE public.ops_release_guide_keys SET result = 'incomplete', last_attempt_at = now(),
          details = jsonb_build_object('missing', to_jsonb(v_missing)) WHERE pr = r.pr AND capability_key = v_k;
        v_results := v_results || jsonb_build_array(jsonb_build_object('key', v_k, 'title', cap.title, 'result', 'incomplete',
          'status', cap.claimed_status, 'missing', to_jsonb(v_missing)));
        PERFORM public.ops_log_write(c_actor, 'system', 'guide_incomplete', 'info', NULL, 'release', NULL,
          format('%s stays %s: %s (PR #%s).', cap.title, initcap(cap.claimed_status), array_to_string(v_missing, ', '), r.pr),
          jsonb_build_object('pr', r.pr, 'key', v_k, 'missing', to_jsonb(v_missing)));
        v_incomplete := v_incomplete + 1;
        CONTINUE;
      END IF;

      FOR e IN SELECT x FROM jsonb_array_elements(v_new) x LOOP
        v_kind := e->>'kind';
        UPDATE public.product_capability_evidence pe SET is_current = false
         WHERE pe.capability_id = cap.id AND pe.evidence_kind = v_kind AND pe.is_current;
        INSERT INTO public.product_capability_evidence (capability_id, evidence_kind, evidence_url, verdict, details, observed_at, expires_at, recorded_by)
        VALUES (cap.id, v_kind, e->>'url', 'verified', e->>'details', (e->>'at')::timestamptz, (e->>'expires_at')::timestamptz, NULL)
        RETURNING id INTO v_ev;
        INSERT INTO public.product_truth_audit (actor_user_id, action, capability_id, evidence_id, metadata)
        VALUES (NULL, 'evidence_recorded', cap.id, v_ev, jsonb_build_object('source', 'issue_4179_bridge_b', 'pr', r.pr,
          'evidence_kind', v_kind, 'verdict', 'verified'));
      END LOOP;
      UPDATE public.product_capabilities pc SET claimed_status = 'live', verification_due_at = now() + interval '90 days',
             last_verified_at = now(), revision = pc.revision + 1, updated_at = now()
       WHERE pc.id = cap.id RETURNING pc.revision INTO v_rev;
      INSERT INTO public.product_truth_audit (actor_user_id, action, capability_id, metadata)
      VALUES (NULL, 'capability_saved', cap.id, jsonb_build_object('source', 'issue_4179_bridge_b', 'pr', r.pr, 'revision', v_rev,
        'claimed_status', 'live'));
      UPDATE public.ops_release_guide_keys SET result = 'live', applied_at = now(), last_attempt_at = now(),
        details = jsonb_build_object('evidence', (SELECT jsonb_agg(x->>'kind') FROM jsonb_array_elements(v_new) x))
       WHERE pr = r.pr AND capability_key = v_k;
      PERFORM public.ops_log_write(c_actor, 'system', 'guide_live', 'ok', NULL, 'release', NULL,
        format('%s is Live in the Feature Guide (PR #%s).', cap.title, r.pr), jsonb_build_object('pr', r.pr, 'key', v_k));
      v_results := v_results || jsonb_build_array(jsonb_build_object('key', v_k, 'title', cap.title, 'result', 'live',
        'evidence', (SELECT jsonb_agg(x->>'kind') FROM jsonb_array_elements(v_new) x)));
      v_live := v_live + 1;
      v_live_keys := v_live_keys || v_k;
      v_live_titles := v_live_titles || cap.title;
    END LOOP;

    -- #4398 (S2): an entry turning Live is an Admin activity notice for the
    -- owner and Support, never a Work card. #4580 (D1): one notice per
    -- release per pass, naming the entries, instead of one per entry.
    v_n := cardinality(v_live_keys);
    IF v_n > 0 THEN
      BEGIN
        IF v_watchers IS NULL THEN v_watchers := public.ops_release_guide_watchers(); END IF;
        PERFORM public.ops_activity_notice('guide',
          md5('guide_live_release:pr-' || r.pr || ':' || v_live_keys[1] || ':' || v_live_keys[v_n])::uuid,
          CASE WHEN v_boss IS NOT NULL THEN ARRAY[v_boss] ELSE ARRAY[]::text[] END || v_watchers,
          left(format('Feature Guide: %s %s Live (PR #%s): %s%s.', v_n, CASE WHEN v_n = 1 THEN 'entry is' ELSE 'entries are' END, r.pr,
                      array_to_string(v_live_titles[1:3], ', '), CASE WHEN v_n > 3 THEN format(' and %s more', v_n - 3) ELSE '' END), 280),
          'https://admin.usemingla.com/#/community-support?tab=feature-guide');
      EXCEPTION WHEN others THEN RAISE WARNING 'ops_release_guide_apply: telling Support about PR % stopped (% %)', r.pr, SQLSTATE, SQLERRM;
      END;
    END IF;

    UPDATE public.ops_release_records x SET
      guide_applied_at = CASE WHEN EXISTS (SELECT 1 FROM public.ops_release_guide_keys pending
                                           WHERE pending.pr = r.pr AND pending.applied_at IS NULL) THEN NULL ELSE now() END,
      guide_result = jsonb_build_object('keys', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'key', state.capability_key, 'result', state.result, 'details', state.details
      ) ORDER BY state.capability_key) FROM public.ops_release_guide_keys state WHERE state.pr = r.pr), '[]'::jsonb)),
      updated_at = now()
     WHERE x.pr = r.pr;
    v_records := v_records + 1;

    -- #4580: the budget stopped this pass. Say so, and let the next pass
    -- (job 96 or ops_reconcile) carry on from the next key.
    IF v_deferred THEN
      PERFORM public.ops_log_write(c_actor, 'system', 'guide_deferred', 'info', NULL, 'release', NULL,
        format('Feature Guide step paused after %s entries (time budget); the next pass continues (PR #%s).', v_done, r.pr),
        jsonb_build_object('pr', r.pr, 'done', v_done));
      EXIT;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('records', v_records, 'live', v_live, 'incomplete', v_incomplete,
                            'done', v_done, 'deferred', v_deferred);
END;
$function$;

-- A4. A release record the bridge skipped because it fails on its own: a
-- 'stopped' row in the Admin log and one Admin notice to the owner. The same
-- record skipped twice is told once.
CREATE OR REPLACE FUNCTION public.ops_release_record_poisoned(p_pr integer, p_comment_url text, p_code text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_boss text;
BEGIN
  PERFORM public.ops_service_only();
  IF p_pr IS NULL OR p_pr NOT BETWEEN 1 AND 9999999
     OR (p_comment_url IS NOT NULL
         AND p_comment_url !~ '^https://github[.]com/Mingla-LLC/mingla-main/(issues|pull)/[0-9]+#issuecomment-[0-9]+$')
     OR p_code IS NULL OR p_code !~ '^[A-Z0-9_]{1,60}$' THEN
    RAISE EXCEPTION 'invalid_poisoned_record: Send a pull request number, its record comment link and a short code.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.ops_log_write('system@usemingla.com', 'system', 'release_record_poisoned', 'stopped', NULL, 'release', NULL,
    format('Release record of PR #%s could not be read into Mingla (%s). It was skipped so later records keep flowing. Re-read it once the cause is fixed.', p_pr, p_code),
    jsonb_build_object('pr', p_pr, 'comment_url', p_comment_url, 'code', p_code));
  v_boss := public.ops_owner_email();
  IF v_boss IS NOT NULL THEN
    PERFORM public.ops_activity_notice('alert', md5('release_poisoned:pr-' || p_pr || ':' || coalesce(p_comment_url, ''))::uuid,
      ARRAY[v_boss],
      left(format('Release record of PR #%s was skipped by the sync (%s). Later records keep flowing; re-read it once the cause is fixed.', p_pr, p_code), 280),
      'https://admin.usemingla.com/#/work-board');
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_release_record_poisoned(integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_release_record_poisoned(integer, text, text) TO service_role;
COMMENT ON FUNCTION public.ops_release_record_poisoned(integer, text, text) IS
  'Issue #4580. The bridge skipped a release record that fails on its own: one stopped row in the Admin log (release_record_poisoned) and one Admin notice (alert) to the owner, once per record comment.';

-- A4b (amendment A3). Every record of a batch failed (more than one record):
-- that is not a bad record but a broken ingest, so nothing is skipped. The
-- bridge stops the run without moving the cursor, and this writes one
-- 'stopped' row in the Admin log per run and one notice to the owner per
-- batch; the next run retries the same batch.
CREATE OR REPLACE FUNCTION public.ops_release_batch_halted(p_from_pr integer, p_to_pr integer, p_count integer,
                                                           p_code text, p_first_error text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_boss text; v_error text;
BEGIN
  PERFORM public.ops_service_only();
  IF p_from_pr IS NULL OR p_from_pr NOT BETWEEN 1 AND 9999999 OR p_to_pr IS NULL OR p_to_pr NOT BETWEEN p_from_pr AND 9999999
     OR p_count IS NULL OR p_count NOT BETWEEN 2 AND 100
     OR p_code IS NULL OR p_code !~ '^[A-Z0-9_]{1,60}$' THEN
    RAISE EXCEPTION 'invalid_halted_batch: Send the batch''s first and last pull request, its size (2 to 100) and a short code.' USING ERRCODE = '22023';
  END IF;
  v_error := COALESCE(NULLIF(left(public.ops_one_line(p_first_error), 160), ''), 'no message');
  PERFORM public.ops_log_write('system@usemingla.com', 'system', 'release_record', 'stopped', NULL, 'release', NULL,
    format('Release-record sync stopped: all %s records of PRs #%s to #%s failed (%s: %s). Nothing was skipped; the next run retries them.',
           p_count, p_from_pr, p_to_pr, p_code, v_error),
    jsonb_build_object('batch_halted', true, 'from_pr', p_from_pr, 'to_pr', p_to_pr, 'count', p_count, 'code', p_code, 'first_error', v_error));
  v_boss := public.ops_owner_email();
  IF v_boss IS NOT NULL THEN
    PERFORM public.ops_activity_notice('alert', md5('release_batch_halted:pr-' || p_from_pr || '-' || p_to_pr)::uuid,
      ARRAY[v_boss],
      left(format('Release-record sync stopped: all %s records of PRs #%s to #%s failed (%s: %s). Nothing was skipped; it retries every run.',
                  p_count, p_from_pr, p_to_pr, p_code, v_error), 280),
      'https://admin.usemingla.com/#/work-board');
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.ops_release_batch_halted(integer, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_release_batch_halted(integer, integer, integer, text, text) TO service_role;
COMMENT ON FUNCTION public.ops_release_batch_halted(integer, integer, integer, text, text) IS
  'Issue #4580 (A3). Every record of a release-record batch failed: one stopped row in the Admin log (action release_record, detail batch_halted) per run and one Admin notice (alert) to the owner per batch. Nothing is skipped and the cursor does not move.';

COMMIT;
