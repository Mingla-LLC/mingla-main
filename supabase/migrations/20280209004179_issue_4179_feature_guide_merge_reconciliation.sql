-- Issue #4179 — reconcile the Feature Guide with every first-parent merge
-- after the last full content pass (#3982) through Ari rendition merge #4176.
--
-- Baseline: c604fb6931ecb00c939ead8023198a7648bba606 (#3982)
-- Reviewed head: 896d0482f669d9e0d9f407c6b05a7bc5617010d7 (#4176)
-- Reviewed merges: 144 (95 capability-affecting, 49 no Feature Guide effect)
--
-- A merge is not the same thing as a live release. This migration corrects
-- shipped wording and records four previously missing capabilities, but it
-- retires time-dependent proof for rewritten entries. They therefore fail
-- closed to Needs review until a current release record and live check are
-- applied through the audited Feature Guide evidence path.
--
-- INVARIANT: {"id":"I-4179-FEATURE-GUIDE-EVERY-MERGE","rule":"Every first-parent merge after #3982 through #4176 is classified exactly once as an existing capability, a new capability, or no Feature Guide effect; every referenced capability exists after this migration."}
-- INVARIANT: {"id":"I-4179-FEATURE-GUIDE-REWRITES-FAIL-CLOSED","rule":"Rewriting Feature Guide truth never carries forward release, deployment, app-release, feature-flag, or live-check proof as current; changed entries remain Needs review until current production evidence is recorded."}
-- INVARIANT: {"id":"I-4179-FEATURE-GUIDE-COVERAGE-WATERMARK","rule":"The Feature Guide is current only when a contiguous first-parent main chain reaches the observed head and every merge has either catalog-valid capability keys or a concrete no-effect reason; any gap makes otherwise-Live entries Needs review."}
-- INVARIANT: {"id":"I-4179-FEATURE-GUIDE-PER-KEY-RETRY","rule":"A release record naming a capability immediately invalidates older verification for that capability, and the record is not fully applied until every named key independently reaches Live or Retired; unknown or incomplete keys remain retryable."}

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $foundation$
BEGIN
  IF to_regclass('public.product_capabilities') IS NULL
     OR to_regclass('public.product_capability_evidence') IS NULL
     OR to_regclass('public.product_truth_audit') IS NULL
     OR to_regprocedure('public.issue_3720_feature_guide_effective_status(uuid)') IS NULL THEN
    RAISE EXCEPTION 'issue4179_feature_guide_foundation_missing';
  END IF;
END;
$foundation$;

-- Future merges carry an immutable, reasoned classification. A capability's
-- previous release evidence stops proving Live as soon as a newer classified
-- merge names it; the complete evidence packet promotes that revision again.
ALTER TABLE public.product_capabilities
  ADD COLUMN source_changed_at timestamptz,
  ADD COLUMN source_changed_sha text,
  ADD COLUMN source_changed_pr integer;
ALTER TABLE public.product_capabilities
  ADD CONSTRAINT product_capabilities_source_changed_sha_check
    CHECK (source_changed_sha IS NULL OR source_changed_sha ~ '^[0-9a-f]{40}$'),
  ADD CONSTRAINT product_capabilities_source_changed_pr_check
    CHECK (source_changed_pr IS NULL OR source_changed_pr > 0);

ALTER TABLE public.ops_release_records
  ADD COLUMN feature_guide_reason text;
ALTER TABLE public.ops_release_records
  ADD CONSTRAINT ops_release_records_feature_guide_reason_check
    CHECK (feature_guide_reason IS NULL OR char_length(btrim(feature_guide_reason)) BETWEEN 3 AND 500);

ALTER TABLE public.ops_main_commits
  ADD COLUMN first_parent_sha text;
ALTER TABLE public.ops_main_commits
  ADD CONSTRAINT ops_main_commits_first_parent_sha_check
    CHECK (first_parent_sha IS NULL OR first_parent_sha ~ '^[0-9a-f]{40}$');

CREATE TABLE public.ops_release_guide_keys (
  pr integer NOT NULL REFERENCES public.ops_release_records(pr) ON DELETE CASCADE,
  capability_key text NOT NULL CHECK (
    capability_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    AND char_length(capability_key) <= 80
  ),
  merge_sha text NOT NULL CHECK (merge_sha ~ '^[0-9a-f]{40}$'),
  merged_at timestamptz NOT NULL,
  invalidated_at timestamptz,
  applied_at timestamptz,
  last_attempt_at timestamptz,
  result text NOT NULL DEFAULT 'pending'
    CHECK (result IN ('pending','unknown_key','incomplete','live','retired')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  PRIMARY KEY (pr, capability_key)
);

CREATE TABLE public.ops_feature_guide_coverage (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  baseline_sha text NOT NULL CHECK (baseline_sha ~ '^[0-9a-f]{40}$'),
  audited_through_sha text NOT NULL CHECK (audited_through_sha ~ '^[0-9a-f]{40}$'),
  observed_head_sha text NOT NULL CHECK (observed_head_sha ~ '^[0-9a-f]{40}$'),
  state text NOT NULL CHECK (state IN ('current','pending','gap')),
  blocked_sha text CHECK (blocked_sha IS NULL OR blocked_sha ~ '^[0-9a-f]{40}$'),
  blocked_pr integer CHECK (blocked_pr IS NULL OR blocked_pr > 0),
  blocked_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'current') = (audited_through_sha = observed_head_sha)),
  CHECK ((state = 'gap') = (blocked_sha IS NOT NULL))
);
INSERT INTO public.ops_feature_guide_coverage(
  baseline_sha, audited_through_sha, observed_head_sha, state
) VALUES (
  '896d0482f669d9e0d9f407c6b05a7bc5617010d7',
  '896d0482f669d9e0d9f407c6b05a7bc5617010d7',
  '896d0482f669d9e0d9f407c6b05a7bc5617010d7',
  'current'
);

ALTER TABLE public.ops_release_guide_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_feature_guide_coverage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_release_guide_keys FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ops_feature_guide_coverage FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ops_release_guide_keys TO service_role;
GRANT ALL ON public.ops_feature_guide_coverage TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3720_feature_guide_effective_status(
  p_capability_id uuid
) RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN c.claimed_status = 'planned' THEN 'Planned'
    WHEN c.claimed_status = 'retired' THEN 'Retired'
    WHEN EXISTS (
      SELECT 1 FROM public.ops_feature_guide_coverage coverage
       WHERE coverage.singleton AND coverage.state <> 'current'
    ) THEN 'Needs review'
    WHEN EXISTS (
      SELECT 1 FROM public.ops_release_guide_keys pending
       WHERE pending.capability_key = c.capability_key
         AND pending.applied_at IS NULL
    ) THEN 'Needs review'
    WHEN c.source_changed_at IS NOT NULL
     AND (c.last_verified_at IS NULL OR c.last_verified_at < c.source_changed_at) THEN 'Needs review'
    WHEN c.verification_due_at IS NULL OR c.verification_due_at <= now() THEN 'Needs review'
    WHEN EXISTS (
      SELECT 1
        FROM public.product_capability_evidence e
       WHERE e.capability_id = c.id
         AND e.is_current
         AND (e.verdict = 'conflict' OR (e.expires_at IS NOT NULL AND e.expires_at <= now()))
    ) THEN 'Needs review'
    WHEN EXISTS (
      SELECT 1
        FROM unnest(c.required_evidence_kinds) required(kind)
       WHERE NOT EXISTS (
         SELECT 1
           FROM public.product_capability_evidence e
          WHERE e.capability_id = c.id
            AND e.evidence_kind = required.kind
            AND e.is_current
            AND e.verdict = 'verified'
            AND (e.expires_at IS NULL OR e.expires_at > now())
       )
    ) THEN 'Needs review'
    ELSE 'Live'
  END
  FROM public.product_capabilities c
  WHERE c.id = p_capability_id
$$;

CREATE FUNCTION public.issue_4179_feature_guide_freshness() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_actor uuid := auth.uid(); v public.ops_feature_guide_coverage;
BEGIN
  IF v_actor IS NULL OR NOT (public.is_admin_user() OR public.is_support_staff(v_actor)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.ops_feature_guide_coverage WHERE singleton;
  RETURN jsonb_build_object(
    'state', v.state,
    'audited_through_sha', v.audited_through_sha,
    'observed_head_sha', v.observed_head_sha,
    'blocked_sha', v.blocked_sha,
    'blocked_pr', v.blocked_pr,
    'blocked_reason', v.blocked_reason,
    'updated_at', v.updated_at
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.issue_4179_feature_guide_freshness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4179_feature_guide_freshness() TO authenticated, service_role;

CREATE FUNCTION public.issue_4179_capture_release_guide_keys() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.feature_guide IS NOT NULL
     AND NEW.feature_guide IS DISTINCT FROM OLD.feature_guide THEN
    RAISE EXCEPTION 'feature_guide_classification_immutable: PR #% was already classified.', NEW.pr
      USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.feature_guide IS NOT DISTINCT FROM OLD.feature_guide
     AND EXISTS (SELECT 1 FROM public.ops_release_guide_keys existing WHERE existing.pr = NEW.pr) THEN
    RETURN NEW;
  END IF;
  IF NEW.feature_guide IS NULL OR cardinality(NEW.feature_guide) = 0 THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.ops_release_guide_keys(pr, capability_key, merge_sha, merged_at)
  SELECT NEW.pr, key, NEW.merge_sha, NEW.merged_at
    FROM unnest(NEW.feature_guide) key
  ON CONFLICT (pr, capability_key) DO NOTHING;

  WITH changed AS (
    UPDATE public.product_capabilities c
       SET source_changed_at = NEW.merged_at,
           source_changed_sha = NEW.merge_sha,
           source_changed_pr = NEW.pr,
           verification_due_at = LEAST(COALESCE(c.verification_due_at, NEW.merged_at), NEW.merged_at),
           revision = c.revision + 1,
           updated_at = now()
     WHERE c.capability_key = ANY (NEW.feature_guide)
       AND (c.source_changed_at IS NULL OR c.source_changed_at < NEW.merged_at)
    RETURNING c.id, c.revision, c.capability_key
  )
  INSERT INTO public.product_truth_audit(action, capability_id, metadata)
  SELECT 'capability_saved', id,
         jsonb_build_object('source','issue_4179_release_invalidation','pr',NEW.pr,
           'merge_sha',NEW.merge_sha,'capability_key',capability_key,'revision',revision)
    FROM changed;

  UPDATE public.ops_release_guide_keys k
     SET invalidated_at = COALESCE(k.invalidated_at, now()),
         result = CASE WHEN c.id IS NULL THEN 'unknown_key' ELSE 'pending' END,
         details = CASE WHEN c.id IS NULL THEN jsonb_build_object('missing','catalog entry') ELSE '{}'::jsonb END
    FROM (SELECT key FROM unnest(NEW.feature_guide) key) named
    LEFT JOIN public.product_capabilities c ON c.capability_key = named.key
   WHERE k.pr = NEW.pr AND k.capability_key = named.key;
  RETURN NEW;
END;
$$;

CREATE TRIGGER issue_4179_capture_release_guide_keys
AFTER INSERT OR UPDATE OF feature_guide ON public.ops_release_records
FOR EACH ROW EXECUTE FUNCTION public.issue_4179_capture_release_guide_keys();
REVOKE EXECUTE ON FUNCTION public.issue_4179_capture_release_guide_keys() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4179_capture_release_guide_keys() TO service_role;

-- The release record for this migration can arrive before the production
-- ledger applies it. Re-touch only post-baseline rows so the new trigger
-- captures that race; older records are already covered by the audited head.
UPDATE public.ops_release_records
   SET feature_guide = feature_guide
 WHERE merged_at > '2026-10-29T08:49:31Z'::timestamptz
   AND feature_guide IS NOT NULL;
UPDATE public.ops_bridge_cursors
   SET at = LEAST(at, '2026-10-29T08:49:30Z'::timestamptz), updated_at = now()
 WHERE name = 'main_commits';

CREATE OR REPLACE FUNCTION public.ops_main_commits_ingest(p_commits jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v_n integer; v_head text;
BEGIN
  PERFORM public.ops_service_only();
  IF p_commits IS NULL OR jsonb_typeof(p_commits) <> 'array' OR jsonb_array_length(p_commits) > 100 THEN
    RAISE EXCEPTION 'invalid_commits: Send a list of at most 100 commits.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_commits) c
     WHERE jsonb_typeof(c) <> 'object'
        OR c->>'sha' !~ '^[0-9a-f]{40}$'
        OR c->>'committed_at' !~ '^\d{4}-\d{2}-\d{2}T'
        OR (c->'first_parent_sha' IS NOT NULL AND c->>'first_parent_sha' !~ '^[0-9a-f]{40}$')
        OR (c->'is_head' IS NOT NULL AND jsonb_typeof(c->'is_head') <> 'boolean')
  ) THEN
    RAISE EXCEPTION 'invalid_commits: Every commit needs a SHA, time, optional first parent and boolean head marker.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ops_main_commits (sha, committed_at, subject, author_login, pr, first_parent_sha)
  SELECT c->>'sha', (c->>'committed_at')::timestamptz,
         left(regexp_replace(COALESCE(c->>'subject', ''), '[[:cntrl:]]', ' ', 'g'), 300),
         NULLIF(left(c->>'author_login', 39), ''),
         CASE WHEN jsonb_typeof(c->'pr') = 'number' AND (c->>'pr') ~ '^[0-9]{1,7}$' AND (c->>'pr')::integer > 0
              THEN (c->>'pr')::integer END,
         NULLIF(c->>'first_parent_sha', '')
    FROM jsonb_array_elements(p_commits) c
  ON CONFLICT (sha) DO UPDATE SET
    pr = COALESCE(public.ops_main_commits.pr, EXCLUDED.pr),
    first_parent_sha = COALESCE(public.ops_main_commits.first_parent_sha, EXCLUDED.first_parent_sha);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  SELECT c->>'sha' INTO v_head FROM jsonb_array_elements(p_commits) c
   WHERE c->>'is_head' = 'true' LIMIT 1;
  IF v_head IS NOT NULL THEN
    UPDATE public.ops_feature_guide_coverage
       SET observed_head_sha = v_head,
           state = CASE WHEN audited_through_sha = v_head THEN 'current' ELSE 'pending' END,
           blocked_sha = NULL,
           blocked_pr = NULL,
           blocked_reason = NULL,
           updated_at = now()
     WHERE singleton;
  END IF;
  RETURN jsonb_build_object('inserted', v_n, 'observed_head_sha', v_head);
END;
$$;

CREATE FUNCTION public.ops_feature_guide_coverage_reconcile() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v public.ops_feature_guide_coverage; m public.ops_main_commits; r public.ops_release_records;
  v_current text; v_reason text; v_state text; v_boss text := public.ops_owner_email();
  v_res jsonb; w public.ops_work_cards;
BEGIN
  PERFORM public.ops_service_only();
  SELECT * INTO v FROM public.ops_feature_guide_coverage WHERE singleton FOR UPDATE;
  v_current := v.audited_through_sha;
  v_state := CASE WHEN v_current = v.observed_head_sha THEN 'current' ELSE 'pending' END;
  LOOP
    SELECT * INTO m FROM public.ops_main_commits c
     WHERE c.first_parent_sha = v_current
     ORDER BY c.committed_at, c.sha LIMIT 1;
    EXIT WHEN NOT FOUND;
    v_reason := NULL;
    IF m.pr IS NULL THEN
      v_reason := 'direct_push_has_no_pull_request';
    ELSE
      SELECT * INTO r FROM public.ops_release_records x
       WHERE x.pr = m.pr AND x.merge_sha = m.sha;
      IF NOT FOUND THEN
        v_reason := 'release_record_missing';
      ELSIF r.feature_guide IS NULL THEN
        v_reason := 'feature_guide_classification_missing';
      ELSIF cardinality(r.feature_guide) = 0 AND NULLIF(btrim(r.feature_guide_reason), '') IS NULL THEN
        v_reason := 'no_effect_reason_missing';
      ELSIF EXISTS (
        SELECT 1 FROM unnest(r.feature_guide) key
         WHERE NOT EXISTS (SELECT 1 FROM public.product_capabilities c WHERE c.capability_key = key)
      ) THEN
        v_reason := 'unknown_feature_guide_key';
      END IF;
    END IF;
    IF v_reason IS NOT NULL THEN
      v_state := 'gap';
      UPDATE public.ops_feature_guide_coverage SET
        audited_through_sha = v_current, state = 'gap', blocked_sha = m.sha,
        blocked_pr = m.pr, blocked_reason = v_reason, updated_at = now()
       WHERE singleton;
      EXIT;
    END IF;
    v_current := m.sha;
    v_state := CASE WHEN v_current = v.observed_head_sha THEN 'current' ELSE 'pending' END;
    UPDATE public.ops_feature_guide_coverage SET
      audited_through_sha = v_current, state = v_state, blocked_sha = NULL,
      blocked_pr = NULL, blocked_reason = NULL, updated_at = now()
     WHERE singleton;
    EXIT WHEN v_current = v.observed_head_sha;
  END LOOP;

  SELECT * INTO v FROM public.ops_feature_guide_coverage WHERE singleton;
  IF v.state = 'pending' THEN
    UPDATE public.ops_feature_guide_coverage SET state = 'gap',
      blocked_sha = observed_head_sha, blocked_pr = NULL,
      blocked_reason = 'first_parent_chain_missing', updated_at = now()
     WHERE singleton;
    SELECT * INTO v FROM public.ops_feature_guide_coverage WHERE singleton;
  END IF;
  IF v.state = 'gap' THEN
    v_res := public.ops_auto_card_upsert(
      'feature_guide_gap:sha-' || left(v.blocked_sha, 12),
      jsonb_build_object(
        'title', left(format('Feature Guide coverage stopped at %s', left(v.blocked_sha, 9)), 160),
        'instructions', left(format('The Feature Guide cannot prove every main merge after %s. Resolve %s for %s, then let the five-minute bridge reconcile again.', left(v.audited_through_sha, 9), replace(v.blocked_reason, '_', ' '), CASE WHEN v.blocked_pr IS NULL THEN 'the direct push' ELSE 'PR #' || v.blocked_pr END), 4000),
        'done_means', 'The Feature Guide freshness state is current at the observed main head.',
        'owners', CASE WHEN v_boss IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_boss) END,
        'watchers', '[]'::jsonb,
        'due_on', public.ops_today(NULL)
      ), 'task', NULL
    );
  ELSE
    FOR w IN SELECT * FROM public.ops_work_cards card
      WHERE card.auto_key LIKE 'feature\_guide\_gap:%' ESCAPE '\'
        AND card.status <> 'done' AND card.archived_at IS NULL
      FOR UPDATE LOOP
      PERFORM public.ops_auto_card_close(w.id, 'Feature Guide merge coverage is current.',
        jsonb_build_array(jsonb_build_object('text','Audited through ' || v.audited_through_sha)));
    END LOOP;
  END IF;
  RETURN to_jsonb(v);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ops_feature_guide_coverage_reconcile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_feature_guide_coverage_reconcile() TO service_role;

CREATE OR REPLACE FUNCTION public.ops_release_records_ingest(p_records jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  i jsonb; d jsonb; v_ingested integer := 0; v_invalid integer := 0; v_completed integer[] := ARRAY[]::integer[]; v_pr integer;
  v_was boolean; v_new boolean; v_url text; v_slot text; v_ok boolean;
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
      v_url := CASE WHEN jsonb_typeof(i->'comment_url') = 'string'
                         AND i->>'comment_url' ~ '^https://github[.]com/Mingla-LLC/mingla-main/(issues|pull)/[0-9]+#issuecomment-[0-9]+$'
                    THEN i->>'comment_url' END;
      v_slot := CASE WHEN jsonb_typeof(i->'issue_number') = 'number' AND (i->>'issue_number') ~ '^[0-9]{1,7}$' AND (i->>'issue_number')::integer <> v_pr
                     THEN i->>'issue_number' ELSE 'pr' END;
      SELECT x.complete INTO v_was FROM public.ops_release_records x WHERE x.pr = v_pr;
      v_new := NOT FOUND;
      INSERT INTO public.ops_release_records AS r (pr, title, pr_url, merged_at, merge_sha, merged_by_login, author_login, issues,
        migrations_added, edge_functions, web_projects, deploy_marker, deploy, feature_guide, feature_guide_reason, live_check, problems, comment_urls)
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
        CASE WHEN v_url IS NOT NULL THEN jsonb_build_object(v_slot, v_url) ELSE '{}'::jsonb END)
      ON CONFLICT (pr) DO UPDATE SET title = EXCLUDED.title, merged_at = EXCLUDED.merged_at, merge_sha = EXCLUDED.merge_sha,
        merged_by_login = EXCLUDED.merged_by_login, author_login = EXCLUDED.author_login, issues = EXCLUDED.issues,
        migrations_added = EXCLUDED.migrations_added, edge_functions = EXCLUDED.edge_functions, web_projects = EXCLUDED.web_projects,
        deploy_marker = EXCLUDED.deploy_marker, deploy = EXCLUDED.deploy,
        feature_guide = COALESCE(r.feature_guide, EXCLUDED.feature_guide),
        feature_guide_reason = CASE WHEN r.feature_guide IS NULL THEN EXCLUDED.feature_guide_reason ELSE r.feature_guide_reason END,
        live_check = EXCLUDED.live_check,
        problems = ARRAY(SELECT p FROM unnest(EXCLUDED.problems) p WHERE p NOT IN ('feature_guide_missing','feature_guide_invalid'))
          || ARRAY(SELECT p FROM unnest(r.problems) p WHERE p IN ('feature_guide_missing','feature_guide_invalid')),
        comment_urls = r.comment_urls || EXCLUDED.comment_urls, updated_at = now();
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
  RETURN jsonb_build_object('ingested', v_ingested, 'invalid', v_invalid, 'completed', to_jsonb(v_completed));
END;
$$;

CREATE OR REPLACE FUNCTION public.ops_release_guide_apply() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_actor constant text := 'system@usemingla.com'; c_repo constant text := 'https://github.com/Mingla-LLC/mingla-main/';
  r public.ops_release_records; k public.ops_release_guide_keys; v_k text; cap public.product_capabilities;
  v_new jsonb; v_kind text; v_missing text[]; v_results jsonb; v_record_url text;
  v_live_at timestamptz; v_live_url text; v_deploy text; v_test text; v_ev uuid; e jsonb; v_rev integer;
  v_live integer := 0; v_incomplete integer := 0; v_records integer := 0; v_watchers text[];
  v_res jsonb; v_boss text := public.ops_owner_email();
BEGIN
  FOR r IN SELECT x.* FROM public.ops_release_records x
            WHERE x.complete
              AND EXISTS (SELECT 1 FROM public.ops_release_guide_keys pending
                           WHERE pending.pr = x.pr AND pending.applied_at IS NULL)
            ORDER BY x.merged_at, x.pr FOR UPDATE LOOP
    v_results := '[]'::jsonb;
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
              ORDER BY pending.capability_key FOR UPDATE LOOP
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
      BEGIN
        v_watchers := ARRAY(SELECT d.email FROM public.admin_team_directory() d
                              JOIN auth.users u ON lower(btrim(u.email)) = d.email
                             WHERE d.status = 'active' AND d.email IS DISTINCT FROM v_boss AND public.is_support_staff(u.id)
                             GROUP BY d.email ORDER BY d.email LIMIT 10);
        v_res := public.ops_auto_card_upsert(format('guide_live:%s:pr-%s', v_k, r.pr), jsonb_build_object(
          'title', left(format('Feature Guide: %s is Live', cap.title), 160),
          'instructions', left(format('%s turned Live in the Feature Guide from the release record of PR #%s. When a host asks, answer with the entry''s support wording.', cap.title, r.pr), 4000),
          'done_means', 'Support knows the entry is Live.',
          'owners', CASE WHEN v_boss IS NOT NULL THEN jsonb_build_array(v_boss) ELSE '[]'::jsonb END,
          'watchers', to_jsonb(v_watchers), 'due_on', public.ops_today(NULL)), 'task', NULL);
        IF v_res->>'status' = 'added' THEN
          PERFORM public.ops_auto_card_close((v_res->>'id')::uuid, format('%s is Live in the Feature Guide.', cap.title),
            jsonb_build_array(jsonb_build_object('text', 'Release record: ' || COALESCE(v_record_url, r.pr_url))));
        END IF;
      EXCEPTION WHEN others THEN RAISE WARNING 'ops_release_guide_apply: telling Support about % stopped (% %)', v_k, SQLSTATE, SQLERRM;
      END;
    END LOOP;

    UPDATE public.ops_release_records x SET
      guide_applied_at = CASE WHEN EXISTS (SELECT 1 FROM public.ops_release_guide_keys pending
                                           WHERE pending.pr = r.pr AND pending.applied_at IS NULL) THEN NULL ELSE now() END,
      guide_result = jsonb_build_object('keys', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'key', state.capability_key, 'result', state.result, 'details', state.details
      ) ORDER BY state.capability_key) FROM public.ops_release_guide_keys state WHERE state.pr = r.pr), '[]'::jsonb)),
      updated_at = now()
     WHERE x.pr = r.pr;
    v_records := v_records + 1;
  END LOOP;
  RETURN jsonb_build_object('records', v_records, 'live', v_live, 'incomplete', v_incomplete);
END;
$$;

-- The compact ledger is deliberately executable. The structural regression
-- test compares this exact set with git's first-parent range above, including
-- the three merge subjects that do not end in "(#PR)".
CREATE TEMP TABLE issue_4179_merge_review ON COMMIT DROP AS
WITH impact AS (
  SELECT * FROM jsonb_to_recordset($merge_review$
[
 {"pr":3984,"disposition":"existing","capability_keys":["events-cover-media"]},
 {"pr":3983,"disposition":"existing","capability_keys":["staff-ads","marketing-host-ads"]},
 {"pr":3986,"disposition":"existing","capability_keys":["staff-community-support","staff-team-roles"]},
 {"pr":3987,"disposition":"existing","capability_keys":["staff-ads"]},
 {"pr":3989,"disposition":"existing","capability_keys":["events-cover-media","trips-create"]},
 {"pr":3979,"disposition":"existing","capability_keys":["experiences-create","checkout-trips-experiences"]},
 {"pr":3991,"disposition":"existing","capability_keys":["staff-work-board","staff-agent-log","staff-drafts","staff-content-calendar"]},
 {"pr":3993,"disposition":"existing","capability_keys":["experiences-create"]},
 {"pr":3994,"disposition":"existing","capability_keys":["staff-ads","marketing-host-ads"]},
 {"pr":3992,"disposition":"existing","capability_keys":["staff-community-support","staff-team-roles"]},
 {"pr":3996,"disposition":"existing","capability_keys":["experiences-create","checkout-trips-experiences"]},
 {"pr":3998,"disposition":"existing","capability_keys":["staff-ads","marketing-host-ads"]},
 {"pr":4003,"disposition":"existing","capability_keys":["staff-ads","marketing-host-ads"]},
 {"pr":3985,"disposition":"new","capability_keys":["account-app-updates"]},
 {"pr":4006,"disposition":"existing","capability_keys":["staff-ads","marketing-host-ads"]},
 {"pr":4005,"disposition":"existing","capability_keys":["staff-community-support","staff-support-desk"]},
 {"pr":4010,"disposition":"existing","capability_keys":["marketing-host-ads"]},
 {"pr":4009,"disposition":"existing","capability_keys":["experiences-create","checkout-trips-experiences"]},
 {"pr":4017,"disposition":"existing","capability_keys":["experiences-create","checkout-trips-experiences"]},
 {"pr":4008,"disposition":"existing","capability_keys":["events-guest-list","events-visibility"]},
 {"pr":4013,"disposition":"existing","capability_keys":["events-comp-guests","events-check-in","events-guest-list","events-reconciliation"]},
 {"pr":4021,"disposition":"existing","capability_keys":["staff-release-records"]},
 {"pr":4015,"disposition":"existing","capability_keys":["marketing-host-ads"]},
 {"pr":4028,"disposition":"existing","capability_keys":["events-comp-guests","events-check-in","events-guest-list","events-reconciliation"]},
 {"pr":4011,"disposition":"existing","capability_keys":["events-guest-list","events-visibility"]},
 {"pr":4022,"disposition":"existing","capability_keys":["staff-drafts","staff-work-board","staff-agent-log","staff-content-calendar","staff-crm","staff-team-roles","staff-my-agent","staff-release-records"]},
 {"pr":4034,"disposition":"existing","capability_keys":["staff-release-records"]},
 {"pr":4035,"disposition":"existing","capability_keys":["marketing-host-ads"]},
 {"pr":4042,"disposition":"existing","capability_keys":["experiences-create"]},
 {"pr":4044,"disposition":"existing","capability_keys":["money-mingla-fee","payouts-stripe","payouts-paystack-nigeria"]},
 {"pr":4046,"disposition":"existing","capability_keys":["staff-community-support","staff-support-desk"]},
 {"pr":4036,"disposition":"existing","capability_keys":["events-guest-list","events-private","checkout-hidden-link"]},
 {"pr":4038,"disposition":"existing","capability_keys":["staff-work-board","staff-release-records"]},
 {"pr":4053,"disposition":"existing","capability_keys":["events-guest-list"]},
 {"pr":4054,"disposition":"existing","capability_keys":["events-guest-list"]},
 {"pr":4055,"disposition":"existing","capability_keys":["payouts-timing"]},
 {"pr":4052,"disposition":"existing","capability_keys":["official-brand-groups"]},
 {"pr":4039,"disposition":"existing","capability_keys":["marketing-host-ads","marketing-analytics"]},
 {"pr":4049,"disposition":"existing","capability_keys":["marketing-analytics"]},
 {"pr":4056,"disposition":"existing","capability_keys":["events-guest-list","checkout-hidden-link"]},
 {"pr":4060,"disposition":"existing","capability_keys":["payouts-stripe"]},
 {"pr":4061,"disposition":"existing","capability_keys":["staff-ads","marketing-host-ads"]},
 {"pr":4068,"disposition":"existing","capability_keys":["staff-ads","marketing-host-ads"]},
 {"pr":4071,"disposition":"existing","capability_keys":["venues-menu","money-mingla-fee","payouts-timing"]},
 {"pr":4072,"disposition":"existing","capability_keys":["payouts-stripe","payouts-paystack-nigeria","payouts-timing"]},
 {"pr":4070,"disposition":"existing","capability_keys":["payouts-stripe","payouts-paystack-nigeria","payouts-balances-reports","payouts-timing"]},
 {"pr":4074,"disposition":"existing","capability_keys":["marketing-host-ads","marketing-analytics"]},
 {"pr":4089,"disposition":"existing","capability_keys":["marketing-host-ads"]},
 {"pr":4076,"disposition":"existing","capability_keys":["staff-community-support","staff-support-desk","events-guest-list","social-share"]},
 {"pr":4091,"disposition":"existing","capability_keys":["staff-support-desk"]},
 {"pr":4081,"disposition":"existing","capability_keys":["venues-waitlist-text"]},
 {"pr":4078,"disposition":"existing","capability_keys":["social-follow-brands"]},
 {"pr":4092,"disposition":"existing","capability_keys":["marketing-host-ads"]},
 {"pr":4066,"disposition":"existing","capability_keys":["payouts-stripe","money-mingla-fee"]},
 {"pr":4093,"disposition":"existing","capability_keys":["events-discount-codes"]},
 {"pr":4097,"disposition":"existing","capability_keys":["events-reminders","events-check-in"]},
 {"pr":4098,"disposition":"existing","capability_keys":["ari-host-assistant"]},
 {"pr":4077,"disposition":"existing","capability_keys":["rsvp-create"]},
 {"pr":4099,"disposition":"existing","capability_keys":["events-discount-codes"]},
 {"pr":4100,"disposition":"existing","capability_keys":["marketing-host-ads"]},
 {"pr":4101,"disposition":"existing","capability_keys":["events-check-in","events-scanner-team"]},
 {"pr":4085,"disposition":"existing","capability_keys":["staff-release-records"]},
 {"pr":4103,"disposition":"existing","capability_keys":["official-brand-groups","brand-files-and-guides"]},
 {"pr":4106,"disposition":"existing","capability_keys":["discover-swipe-deck","discover-events","discover-trips","discover-stays"]},
 {"pr":4107,"disposition":"existing","capability_keys":["checkout-claim-ticket"]},
 {"pr":4108,"disposition":"existing","capability_keys":["discover-events"]},
 {"pr":4110,"disposition":"existing","capability_keys":["discover-events"]},
 {"pr":4113,"disposition":"existing","capability_keys":["discover-events"]},
 {"pr":4112,"disposition":"existing","capability_keys":["checkout-claim-ticket","checkout-tickets","events-ticket-delivery"]},
 {"pr":4123,"disposition":"existing","capability_keys":["events-ticket-transfers","events-door-sales","checkout-claim-ticket"]},
 {"pr":4125,"disposition":"existing","capability_keys":["account-settings"]},
 {"pr":4126,"disposition":"existing","capability_keys":["checkout-tickets","checkout-trips-experiences","venues-reservations"]},
 {"pr":4128,"disposition":"existing","capability_keys":["web-legal"]},
 {"pr":4131,"disposition":"new","capability_keys":["brand-customer-enquiries","marketing-people","brand-profile"]},
 {"pr":4135,"disposition":"existing","capability_keys":["social-chat","social-collab-decide","brand-customer-enquiries"]},
 {"pr":4138,"disposition":"existing","capability_keys":["trips-create"]},
 {"pr":4139,"disposition":"existing","capability_keys":["programs-creators","marketing-campaigns","marketing-host-ads"]},
 {"pr":4141,"disposition":"existing","capability_keys":["trips-create"]},
 {"pr":4145,"disposition":"new","capability_keys":["staff-work-board","staff-drafts","staff-team-roles","staff-mingla-money","staff-orders-money","staff-subscriptions","staff-people-brands","staff-offerings","staff-data-room","staff-health","staff-community-support"]},
 {"pr":4149,"disposition":"existing","capability_keys":["checkout-claim-ticket"]},
 {"pr":4148,"disposition":"existing","capability_keys":["sites-brand-website","staff-sites-ops","programs-creators","trips-installments","checkout-trips-experiences"]},
 {"pr":4157,"disposition":"existing","capability_keys":["ari-host-assistant"]},
 {"pr":4155,"disposition":"existing","capability_keys":["payouts-paystack-nigeria","money-mingla-fee","payouts-balances-reports"]},
 {"pr":4158,"disposition":"existing","capability_keys":["sites-brand-website","staff-sites-ops","trips-installments","checkout-trips-experiences"]},
 {"pr":4156,"disposition":"new","capability_keys":["web-blog","web-city-guides","staff-community-support","staff-email"]},
 {"pr":4165,"disposition":"existing","capability_keys":["web-blog"]},
 {"pr":4166,"disposition":"existing","capability_keys":["marketing-analytics"]},
 {"pr":4164,"disposition":"existing","capability_keys":["account-app-updates","account-settings"]},
 {"pr":4167,"disposition":"existing","capability_keys":["sites-brand-website","staff-sites-ops","programs-creators"]},
 {"pr":4162,"disposition":"existing","capability_keys":["brand-profile"]},
 {"pr":4169,"disposition":"existing","capability_keys":["marketing-analytics"]},
 {"pr":4170,"disposition":"existing","capability_keys":["marketing-campaigns","marketing-people","help-support"]},
 {"pr":4172,"disposition":"existing","capability_keys":["marketing-analytics"]},
 {"pr":4175,"disposition":"existing","capability_keys":["brand-files-and-guides","official-brand-groups","staff-community-support","help-video-guides"]},
 {"pr":4178,"disposition":"existing","capability_keys":["account-app-updates","checkout-claim-ticket","checkout-tickets","checkout-trips-experiences","discover-events","discover-stays","discover-swipe-deck","discover-trips","events-ticket-delivery","payouts-paystack-nigeria","social-chat","social-follow-brands","social-safety","stays-hosting","venues-reservations"]}
]
$merge_review$::jsonb) AS row(pr integer, disposition text, capability_keys jsonb)
), no_effect AS (
  SELECT pr, 'no_effect'::text AS disposition, '[]'::jsonb AS capability_keys
    FROM unnest(ARRAY[
      3990,4000,4002,4004,4007,4016,4019,4014,4024,4031,4032,4033,
      4030,4041,4050,4051,4025,4059,4065,4067,4075,4057,4088,4083,
      4090,4094,4096,4105,4109,4115,4116,4117,4124,4127,4129,4132,
      4133,4136,4142,4140,4146,4147,4152,4153,4154,4161,4163,4181,4176
    ]::integer[]) pr
)
SELECT * FROM impact UNION ALL SELECT * FROM no_effect;

CREATE TEMP TABLE issue_4179_guide ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset($guide$
[
 {"capability_key":"account-app-updates","is_new":true,"title":"App updates and installed version","outcome_summary":"Mingla Explorer and Mingla Host check whether an installed store build is still supported and can require an update before the app is used. Critical over-the-air updates can download and restart with a bounded retry. The native Profile or Account footer shows the installed version and build number.","how_to":"On iPhone or Android, open Explorer Profile or Host Account and read the footer for the installed version and build. When Mingla shows Update required, use the store button and reopen the app. A critical Mingla update downloads in the app and restarts it after the download is ready.","limitations":"Native apps only; the version footer is intentionally absent on web. The current source is merged, but native availability depends on a separately approved App Store, Play Store or production OTA release. After two failed critical-update restarts the app opens on working code and records the failure for the team.","support_wording":"On iPhone or Android, the installed version and build appear at the bottom of Profile in Mingla or Account in Mingla Host. If the app says an update is required, install it from the store and reopen Mingla.","who_can_use":["Explorer","Host"],"surfaces":["Mingla Explorer iOS","Mingla Explorer Android","Mingla Host iOS","Mingla Host Android"],"claimed_status":"planned","required_evidence_kinds":["source","test","app_release","live_check"]},
 {"capability_key":"account-settings","is_new":false,"title":"Explorer settings and installed app version","outcome_summary":"Explorers manage language, country and currency units, birthday, privacy, activity sharing, analytics, notifications and quiet-hours messaging. On iPhone and Android, the bottom of Profile also shows the installed Mingla version and build.","how_to":"Open Mingla Explorer, tap Profile, then Account Settings to change language, country, birthday, profile visibility, activity sharing, analytics, notifications and the direct-message exception during quiet hours. Return to Profile and scroll to the bottom to read Mingla · v{version} ({build}) on a native install.","limitations":"Explorer settings only; Host settings are separate. Currency and distance units follow the selected country. Quiet hours are fixed at 10 PM to 8 AM. The installed version footer is native-only and is hidden when native version metadata is unavailable.","support_wording":"In Mingla Explorer, open Profile then Account Settings to change language, country, privacy and notification choices. The installed version and build are shown at the bottom of Profile on iPhone and Android.","who_can_use":["Explorer"],"surfaces":["Mingla Explorer iOS","Mingla Explorer Android"]},
 {"capability_key":"brand-customer-enquiries","is_new":true,"title":"Newsletter sign-up and customer enquiries","outcome_summary":"A public brand page lets a guest join the brand newsletter or message the brand without exposing the brand's raw email or phone number. Enquiries carry the relevant offering or booking context into the brand's Messages, where the team can reply, resolve, block or report them.","how_to":"On a public brand or offering page, use Stay in the loop to confirm an email subscription, or choose Message {Brand}, select what the message is about and send it. The guest can continue on the private message link. In Mingla Host, open Messages and choose the Customer enquiry to reply, resolve, block or report it. Staff see only enquiries a participant reports.","limitations":"Email subscription requires confirmation; text updates are opt-in after the confirmation link. Public messages are moderated and do not reveal the brand's direct contact details. Explorer and native Host entry points require a separately approved mobile release; the buyer and Host web flows can ship independently.","support_wording":"Guests can join a brand's newsletter or message the brand from its Mingla page without seeing a private email or phone number. The brand answers from Customer enquiries in Messages, and a guest can reopen the same private thread from its link.","who_can_use":["Guest","Buyer","Brand team","Mingla staff after a report"],"surfaces":["Buyer web","Mingla Host web","Mingla Admin"] ,"claimed_status":"live","required_evidence_kinds":["source","test","pull_request","release_record","migration","deployment","live_check"]},
 {"capability_key":"brand-files-and-guides","is_new":false,"title":"Brand files and in-app Guides","outcome_summary":"Approved brand members use private files in Brand groups and open a five-foundation Guides workspace in Mingla Host. The four compact guide cards and featured start guide stay in the app; the growing video catalog opens from View more videos without bundling every video into the app.","how_to":"Open a Brand group to browse or share authorised files and media. For Guides, open Help & Support then Guides: start with the featured guide or one of the four foundation cards. Use View more videos for the larger catalog; native opens a dismissible in-app browser and web opens a new tab.","limitations":"File access is checked against active accepted brand membership on every operation, and raw Drive links are never exposed. Brand-group downloads and shares follow the person's role. Native Guide changes require an approved mobile release; the web surface deploys separately.","support_wording":"Brand members can use private files in their Brand group and open the five foundation guides under Help & Support. View more videos opens the larger catalog without taking you out of your place in the app.","who_can_use":["Host brand member","Mingla Support","Owner/Admin"],"surfaces":["Mingla Host iOS","Mingla Host Android","Mingla Host web","Mingla Admin"]},
 {"capability_key":"brand-profile","is_new":false,"title":"Edit your brand profile, cover, contact choices and logo","outcome_summary":"Brand owners and admins edit the public brand profile: logo, display name, tagline, bio, cover media, theme, address, social links, public disclosures, attendee-count display, and whether guests may message the brand. Public pages use newsletter and enquiry controls instead of exposing raw email or phone details.","how_to":"In Mingla Host open the brand, tap Edit brand, then update About, cover, theme, address, social links, display choices and Let guests message us. Review the disclosure copy and tap Save. Use View public page to confirm the result.","limitations":"Saving requires brand admin or owner. The public slug cannot be changed after creation. Cover media follows upload size and processing limits. Turning off guest messages removes the enquiry entry point but does not delete existing enquiry threads.","support_wording":"Open the brand in Mingla Host and tap Edit brand to change its logo, description, cover, social links and guest-message choice. Public brand pages use newsletter and message controls instead of publishing the brand's private email or phone.","who_can_use":["Brand owner","Brand admin"],"surfaces":["Mingla Host iOS","Mingla Host Android","Mingla Host web","Buyer web"]},
 {"capability_key":"checkout-trips-experiences","is_new":false,"title":"Book trips and experiences, including trip payment plans","outcome_summary":"Guests book a trip or experience, answer host questions and pay securely. A trip can offer pay in full or a deposit followed by scheduled instalments. Stripe brands charge the saved card; eligible Nigerian Paystack brands can use a reusable card authorization or a secure pay link when another authorization is needed.","how_to":"Open the trip or experience and choose a package, date or spot. Add buyer and traveller details and review the full price. For a trip with a plan, choose Pay in full or the deposit option and review every due date before paying. Later instalments use the original authorised card when possible; a Paystack guest receives a secure pay link when a fresh authorization is required.","limitations":"Payment plans are for trips only and only when the host configured one. Provider, currency, total and instalment amounts are locked by the server. Nigerian sales use naira through Paystack; other supported countries use Stripe. Native checkout changes require an approved mobile release, while buyer web can ship separately.","support_wording":"At trip checkout, choose Pay in full or the host's deposit plan and review the dates. Stripe charges the saved card later; for an eligible Nigerian Paystack trip, Mingla reuses the authorised card when possible and sends a secure pay link if a new authorization is needed.","who_can_use":["Buyer","Explorer"],"surfaces":["Buyer web","Mingla Explorer iOS","Mingla Explorer Android"]},
 {"capability_key":"discover-swipe-deck","is_new":false,"title":"Swipe a deck of places and plans picked for you","outcome_summary":"The Explore tab shows a deck of places, curated plans and host experiences matched to an Explorer's preferences and location. Swipe right to save, left to pass, or tap for details.","how_to":"Open Explore. Swipe right to save a card to Likes or left to pass, and tap a card for full details. Use Preferences to change categories, travel time or dates, and Swipe History to revisit cards already seen.","limitations":"Results depend on the selected launch city, place data and current availability. Staff, test and demo brands and anything they own are excluded from customer discovery. Saving a curated plan can require Mingla+ when the promotion that unlocks it for everyone is not active.","support_wording":"Open Explore and swipe right to save a card or left to pass. Staff and test brands are kept out of the customer deck; if results run out, widen Preferences or review earlier cards.","who_can_use":["Explorer"],"surfaces":["Mingla Explorer iOS","Mingla Explorer Android"]},
 {"capability_key":"discover-events","is_new":false,"title":"Find events near you, including Ticketmaster events","outcome_summary":"Discover shows published Mingla-host events first, plus supported Ticketmaster concerts, sports, arts and film events for the selected city. Explorers filter by date and type and open the relevant ticket path.","how_to":"Open Discover and choose Events. Use the city chip and Filter for date, type and genre, then open an event. Mingla-host events use Mingla ticketing or RSVP; Ticketmaster events open Ticketmaster's ticket page.","limitations":"Ticketmaster owns its orders, refunds and seats. Results depend on provider and host supply for the selected city. Staff, test and demo brands and their events are excluded from customer discovery even if a test event is otherwise published.","support_wording":"Open Discover, choose Events and use the city and date filters. Mingla-host events book through Mingla, Ticketmaster events open Ticketmaster, and internal test events are never shown to customers.","who_can_use":["Explorer"],"surfaces":["Mingla Explorer iOS","Mingla Explorer Android"]},
 {"capability_key":"discover-trips","is_new":false,"title":"Find trips","outcome_summary":"Explorers browse published group trips, filter by destination, departure, dates, price and group size, and open a trip to review the itinerary and reserve.","how_to":"Open Discover and choose Trips. Set destination, departure, dates, price, group size or sort order, then open a trip and use Reserve when it fits.","limitations":"Only customer-facing trips from real brands can appear. Staff, test and demo brands and their trips are excluded from discovery. If no published trip matches, Discover says trips are coming and offers another category.","support_wording":"Open Discover and choose Trips to browse published group trips. Internal test trips stay out of customer results; an empty list means no real-brand trip currently matches the filters.","who_can_use":["Explorer"],"surfaces":["Mingla Explorer iOS","Mingla Explorer Android"]},
 {"capability_key":"discover-stays","is_new":false,"title":"Find and book stays","outcome_summary":"Explorers find published hotels, resorts, guest houses, lodges and apartments, check availability and reserve a room or place. A stay can confirm instantly or wait for the host to approve the request.","how_to":"Open Discover and choose Stays. Set destination, dates, guests, room count and other filters, open a stay, choose a room or place, add guest details and review the instant booking or request before confirming.","limitations":"Only live inventory from real customer brands appears; staff, test and demo brands and their stays are excluded from discovery. Request stays are not confirmed until the host accepts. Payment provider, cancellation and refund behavior follow the property's country and policy.","support_wording":"Open Discover, choose Stays and set destination and dates. Internal test stays never appear to customers; instant stays confirm with payment, while request stays wait for the host to accept.","who_can_use":["Explorer"],"surfaces":["Mingla Explorer iOS","Mingla Explorer Android"]},
 {"capability_key":"events-ticket-transfers","is_new":false,"title":"Send an eligible extra ticket to a friend","outcome_summary":"A buyer can send an eligible extra ticket from an order to a friend while keeping their own claimed ticket and QR journey. The recipient claims the sent ticket through the protected ticket flow; ownership and verified phone identity are checked on the server.","how_to":"In Mingla Explorer open Purchases, open an order with an eligible extra ticket and tap Send to a friend. Choose the ticket, add the recipient details and send the protected claim. The recipient opens the link and signs in or verifies the required identity to claim that ticket.","limitations":"Only eligible unclaimed extra tickets can be sent. The buyer's own claimed ticket is not transferred, used or cancelled tickets cannot be sent, and one verified identity cannot be retained by two accounts. Availability in the native Explorer app requires an approved mobile release.","support_wording":"If an order has an eligible extra ticket, open it in Explorer Purchases and use Send to a friend. Your own ticket stays with you; the recipient claims only the extra ticket from the protected link.","who_can_use":["Buyer","Ticket recipient"],"surfaces":["Mingla Explorer iOS","Mingla Explorer Android","Buyer web"],"claimed_status":"planned"},
 {"capability_key":"marketing-analytics","is_new":false,"title":"Home Pulse, brand analytics and listing insights","outcome_summary":"Hosts see a compact Home Pulse for live and starting-soon activity, lifetime sales by currency, ad results, page traffic, customer actions and completed outcomes. Analytics explains traffic sources and conversion separately for events, experiences, RSVPs, trips and venues, and each supported listing has its own insight rows.","how_to":"Open Mingla Host Home for Home Pulse, live activity, recent work, lifetime sales and ad results. Open Analytics for traffic, actions and completed outcomes by listing type and date window. From a supported listing, open Insights to see that listing's page traffic and outcomes. Refresh on web or pull down on mobile.","limitations":"Scanner-only members cannot open Analytics. Money is grouped by currency and is not converted. Partial windows hide incomparable conversion paths, and low-volume cards say that more data is needed instead of guessing. Door sales outside Mingla are not attributed as online outcomes.","support_wording":"Mingla Host Home shows the current pulse of your business. Open Analytics for page traffic, customer actions and completed outcomes, with wording that changes for events, experiences, RSVPs, trips and venues so unlike actions are not compared as if they were the same.","who_can_use":["Brand owner","Brand admin","Event manager","Finance manager","Marketing manager"],"surfaces":["Mingla Host iOS","Mingla Host Android","Mingla Host web"]},
 {"capability_key":"marketing-host-ads","is_new":false,"title":"Promote listings with ads, creators and referrals","outcome_summary":"The Blast workspace gives a brand one place to promote a listing or the whole brand through campaigns, paid ads, creator gigs and referral offers. Paid ads can use approved image or video creative, target supported destinations and audiences, and report real visits and completed outcomes.","how_to":"Open Blast and choose the relevant tab: Overview, Campaigns, Ads, Creators, Referrals, People or Templates. Use Promote on a listing to open its overview. For an ad, choose the destination, audience, budget, dates, creative and copy, review the immutable plan, hold Ads credit and use the required typed confirmation to launch or submit for review.","limitations":"Channels and destinations appear only when the connected provider supports them. The first reviewed campaigns and every provider still pass provider policy checks. Ads spend prepaid Ads credit; creator gigs and referral money use their own reviewed flows. Native Blast changes require an approved mobile release.","support_wording":"Open Blast in Mingla Host to promote a listing or your whole brand with campaigns, paid ads, creators or referrals. The available channels depend on connected providers, and paid ads use your brand's Ads credit.","who_can_use":["Brand owner","Brand admin","Marketing manager","Finance manager where stated"],"surfaces":["Mingla Host iOS","Mingla Host Android","Mingla Host web"]},
 {"capability_key":"official-brand-groups","is_new":false,"title":"Official Brand groups with people, files, media and mentions","outcome_summary":"Every active brand has one official group for accepted teammates and Mingla Support. Members message, reply, mention teammates, share private files, photos and videos, browse a media gallery, and see authorised People details. Threads open at the newest message but preserve deliberate scrollback.","how_to":"Open Messages and choose the Brand group. Send a message or attachment, use @ to mention an active teammate, open Media to browse shared photos and videos, or open People to see authorised names, emails, roles and mute controls. Show in Chat returns to the exact media message.","limitations":"Only active accepted members of that exact brand and authorised Mingla Support can read the group. Pending, removed and outside users are denied. A direct mention bypasses the thread mute only; global notification choices still apply. Native media and people changes require an approved mobile release.","support_wording":"Your official Brand group is the private team thread for messages, files and media. Open People for active members and roles, use @ to mention someone, and use Show in Chat to return from a photo or video to its message.","who_can_use":["Active Brand team member","Mingla Support"],"surfaces":["Mingla Host iOS","Mingla Host Android","Mingla Host web","Mingla Admin"]},
 {"capability_key":"programs-creators","is_new":false,"title":"Creator Program, creator gigs, referrals and Mingla Locals","outcome_summary":"Brands can hire creators for short-video gigs, run referral offers and see attributed sales. Explorers can join the Creator Program for gigs, contracts and earnings or apply to Mingla Locals. Program access is generally available to active brands unless an explicit safety hold applies; individual Local cities still open separately.","how_to":"Hosts open Blast, then Creators or Referrals, to post work, hire a creator, review delivery and see results. Explorers use the Creator area to complete setup, browse gigs, accept contracts and follow earnings, or use Mingla Locals when their city is open.","limitations":"Global and per-brand safety controls can still hold a program dark. General availability does not create a Local city, paid seat or budget. Cards, post checks and payouts follow the applicable provider flow. Native Creator and Local screens require a Seth-approved mobile release even when the server program is open.","support_wording":"Brands can use Blast for creator gigs and referrals. The Creator Program and Mingla Locals are generally available on the server, but a Local city must be opened separately and native screens arrive only in an approved app release.","who_can_use":["Brand team","Creator","Mingla Local","Mingla staff"],"surfaces":["Mingla Host web","Mingla Admin","Mingla Explorer iOS after release","Mingla Explorer Android after release"],"claimed_status":"live"},
 {"capability_key":"sites-brand-website","is_new":false,"title":"Mingla Sites: a multi-page brand website with Ari editing","outcome_summary":"Every active brand is entitled to create a Mingla-hosted website from the Host Website workspace. Sites supports pages, navigation, reusable design styles, media and video, forms, analytics, offering feeds, Ari-assisted planning, versioned publishing and custom-domain setup. An entitlement does not create or publish a site automatically.","how_to":"In Mingla Host web open the brand, then Website. Start the site, choose and edit pages and design, add media and offering sections, preview, then publish after the review checks pass. Use Ari for a proposed change you review before publishing. Add a custom domain from Settings when DNS and ownership checks are ready.","limitations":"The Website workspace needs marketing-manager access or higher and can be disabled by an emergency global switch or explicit brand revocation. General availability grants entitlement only: an entitlement does not mean a site exists, is published or reserves a hostname. It does not create content or redirect an existing domain. Public publishing and custom domains still fail closed on readiness checks.","support_wording":"Every active brand can start a Mingla-hosted website from Website in Mingla Host web. Nothing is created or published automatically: your team edits, previews and explicitly publishes it, and custom domains still need their ownership and DNS checks.","who_can_use":["Brand owner","Brand admin","Marketing manager"],"surfaces":["Mingla Host web","Public Mingla Sites website"],"claimed_status":"live"},
 {"capability_key":"social-chat","is_new":false,"title":"Chats with friends, groups, brands and enquiries","outcome_summary":"Explorer's Chats tab brings together one-to-one chats, groups, friend collabs, event and brand channels, and customer enquiries. People can pin, mute, archive or mark chats unread, search and filter the list, and send reliable text, replies, reactions, files, photos and videos.","how_to":"Open Chats. Use the pencil for a new message, or + for a group. Search or filter by unread, groups or events. Swipe or long-press a row to pin, mute, mark unread or archive. Inside a chat, send text or attachments, long-press to react or reply, and tap media for the private viewer. A brand channel combines the events you personally have with that brand while keeping each event audience isolated.","limitations":"Explorer is guest-only for a brand's host channels. Message access still follows friendship, event attendance, enquiry and blocking rules. Private media uses signed links, view-once is enforced on the server, videos have size and retention limits, and native availability depends on an approved app release.","support_wording":"Open the Chats tab for friend, group, event, brand and customer-enquiry conversations. You can search, filter, pin, mute or archive chats and send text or media; each event's guests still see only the event conversation they belong to.","who_can_use":["Explorer"],"surfaces":["Mingla Explorer iOS","Mingla Explorer Android"]},
 {"capability_key":"social-collab-decide","is_new":false,"title":"Decide together in a group or one-to-one friend chat","outcome_summary":"Friends swipe a shared deck together and save mutual matches. A collab can start inside an existing one-to-one friend chat without creating a new group, or from a group chat for several people; ending the collab keeps the underlying conversation.","how_to":"Open a one-to-one friend chat and start a collab, or create a group chat and choose Start swiping together. Invitees join the shared deck, set preferences and swipe. When at least two people like the same card it becomes a match and appears in the shared plan strip. End or leave the collab without deleting the chat.","limitations":"Only friends can start a one-to-one collab. A match needs at least two likes. Free-plan session limits still apply when the Mingla-wide Plus promotion ends. The updated one-to-one flow requires an approved native release.","support_wording":"Start a collab inside a friend chat or group so everyone swipes the same deck. Mutual likes become matches, and ending the collab leaves the conversation in place.","who_can_use":["Explorer"],"surfaces":["Mingla Explorer iOS","Mingla Explorer Android"]},
 {"capability_key":"staff-ads","is_new":false,"title":"Ads console, Creative Library and provider campaigns","outcome_summary":"Owners and admins operate paid ads across connected providers from one Admin workspace: readiness, Creative Library images and videos, campaign creation, staff and host plan review, launch, pause, relaunch, spend, visitor and buyer results, and lifecycle history.","how_to":"Open Growth > Ads. Use Overview for readiness and totals, Campaigns to inspect or control campaigns, Creative Library to upload, archive, restore and reuse fitted creative, and Connections for provider readiness. New campaign walks through destination, audience, budget, dates, creative and review before a typed confirmation creates or launches the provider plan.","limitations":"Owner and Admin only. A provider must be connected and pass account, billing, identity and destination checks. Creative fit is checked by media kind, and an archive can be restored. Provider review can still delay delivery, and unsupported previews use an approximation rather than pretending to be a live provider preview.","support_wording":"Mingla's internal Ads workspace covers provider readiness, reusable image and video creative, campaign launch and pause, and real visit and buyer results. Only owners and admins can use it.","who_can_use":["Owner","Admin"],"surfaces":["Mingla Admin (admin.usemingla.com)"]},
 {"capability_key":"staff-community-support","is_new":false,"title":"Separate Support and Community workspaces","outcome_summary":"Mingla Admin has separate Support and Community pages. Support contains the Inbox, Email, Blog and support People and roles. Community contains Announcements, Roadmap, Ideas from hosts, Questions, Moderation, Reported enquiries, Brand groups, Feature guide and Product inbox.","how_to":"Use Support for customer tickets, email, blog posts and support access. Use Community for public announcements and roadmap, host ideas and questions, moderation, reported enquiries, Brand groups, the Feature Guide and Product inbox. On mobile the selected Community tab stays visible, and Roadmap keeps Now, Next and Later lanes.","limitations":"Role checks remain per tab. Owner and Admin can access every administrative tab; active support teammates can work the permitted inbox and guide surfaces; Community moderation access is separate. Publishing announcements, roadmap wording, email and product changes remains Admin-controlled.","support_wording":"Mingla staff use separate Support and Community pages: Support for tickets, email and blog work, and Community for announcements, roadmap, host questions, moderation, Brand groups and the Feature Guide.","who_can_use":["Owner","Admin","Sales and marketing","Founding partner","Support or Community staff where granted"],"surfaces":["Mingla Admin (admin.usemingla.com)"]},
 {"capability_key":"staff-data-room","is_new":false,"title":"Data room documents and business analytics","outcome_summary":"Owners and admins use the Data room for governed company documents plus product and business analytics: all-user growth, Explorer and Host funnels, D7, D30 and D90 cohorts, money summaries and nightly snapshots.","how_to":"Open Company > Data room. Use the document tabs for governed files and the analytics views for growth, funnel, cohort and money trends. Choose the relevant period and inspect the latest nightly snapshot before citing a number.","limitations":"Owner and Admin only. Analytics are aggregate internal reporting, can lag until the nightly snapshot, and do not replace the transaction ledger for a specific order or payout. Document access follows the existing Data room permissions.","support_wording":"Mingla's Data room is an internal owner and admin workspace for governed company documents and aggregate growth, funnel, cohort and money analytics.","who_can_use":["Owner","Admin"],"surfaces":["Mingla Admin (admin.usemingla.com)"]},
 {"capability_key":"staff-drafts","is_new":false,"title":"Messages, spend and publish decisions inside Work","outcome_summary":"The old Needs you page is removed. Draft messages, spend approvals, publish confirmations and wording tasks now open from their Work cards, so Work is the team's single operational inbox.","how_to":"Open Home > Work and choose Board, Today, This week or This month. Open the relevant card. Review and copy a waiting message, record that it was sent, approve or send back a spend decision, confirm a publish step, or edit the requested wording inside the card. Close the card with proof when the human step is complete.","limitations":"Agents cannot send a message, approve spend or claim something was published. A person performs the external action and records the result. Undo changes Mingla's record only and cannot recall a message already sent. Access follows the Work card's owners, watchers and admin controls.","support_wording":"Messages and spend or publish decisions that need a person now live inside their Work cards. Mingla never sends or spends automatically; a teammate performs the action and records the proof.","who_can_use":["Owner","Admin","Sales and marketing","Founding partner"],"surfaces":["Mingla Admin (admin.usemingla.com)"]},
 {"capability_key":"staff-team-roles","is_new":false,"title":"Invite teammates and set roles","outcome_summary":"The owner invites people into Mingla Admin and sets their role: Admin, Sales and marketing, or Founding partner. Invitees get an email with a one-time link that expires in 7 days. The owner also sets the name the team sees for each person and their GitHub username. Separately, admins give existing teammates a Community role (Moderator or Agent) under Community & Support, Team, People and roles, and grant support access from the Support desk.","how_to":"Company access (owner): 1. In Mingla Admin open \"Team and roles\" under Company. 2. In \"Invite someone\", enter the \"Email address\", choose a role and send. 3. In \"People\", change a role from the row dropdown, \"Resend invite\", \"Invite again\" with a chosen role, or remove access (confirm \"Remove\"). Changes can be undone from the notice. 4. Under each person, type the name the team should see and, if they have one, their GitHub username; each saves when you leave the field or press Enter. Names show in every picker, in agent messages and in Agent activity; without one, Mingla uses the first part of the email.\n\nCommunity roles (Owner or Admin): 1. Open \"Community & Support\", then \"Team\", then \"People and roles\". 2. Click \"Invite teammate\", enter their Email and Display name, pick \"Moderator\" or \"Agent\" and \"Save\". 3. Use \"Manage\" on a row to change or \"Remove role\". The table shows each person's Community role, Support, Available now and Last active.","limitations":"Team and roles is Owner only; nobody can change the owner's access. Invite links last 7 days, and changing a role or resending makes the old link stop working. An address that already has a Mingla account signing in another way (phone, Google or Apple) cannot be invited. In People and roles, \"Invite teammate\" does not send an invite: it assigns a role to someone who already has a Mingla profile with that email, and active Admins cannot be given a Community role. A Community role only opens the Community tabs for someone who is also an active Mingla Admin teammate. Removing access also turns off that person's agent keys. Every active teammate role can use Work and Calendar. Only the owner sets names and GitHub usernames, and two people cannot share a GitHub username. The Team dashboard with its Runway and Sprint panels is Owner and Admin only, and turning free-text next steps into cards is Owner only.","support_wording":"Only the account owner can invite people to Mingla Admin and set their role. Community and Support roles are given by an admin to people who are already on the team.","who_can_use":["Owner","Admin (Community roles only)"],"surfaces":["Mingla Admin (admin.usemingla.com)"]},
 {"capability_key":"staff-email","is_new":false,"title":"Staff email with published Blog post blocks","outcome_summary":"Owners and admins compose reviewed Mingla email from Support > Email. A message can include the existing audience and content blocks plus a Blog post block that selects only a published public post.","how_to":"Open Support, then Email. Create or open a draft, choose its audience and add content. Add Blog post to select a published post and choose the approved layout. Review the preview and delivery checks before sending through the existing audited send flow.","limitations":"Owner and Admin only. Draft or preview Blog posts cannot be selected for email. The email composer does not publish a post, and a published post must still be live on the public Blog when the email is sent.","support_wording":"Mingla staff send reviewed email from Support > Email. A message can feature a published Mingla Blog post; drafts and previews cannot be selected.","who_can_use":["Owner","Admin"],"surfaces":["Mingla Admin (admin.usemingla.com)","Email"]},
 {"capability_key":"staff-health","is_new":false,"title":"Platform health, feature flags and system settings","outcome_summary":"Owners and admins use the consolidated System area to read platform and provider health, inspect queue and payment signals, manage audited feature flags and review settings. A missing signal is shown as unknown or stale, never healthy by assumption.","how_to":"Open System > Platform health for service, provider and queue signals and refresh when needed. Open Feature flags for audited switches and Settings for system configuration. Read the timestamp and source beside a signal before acting on it.","limitations":"Owner and Admin only. Health is read-only and cannot repair a provider. Feature-flag and settings changes use their own audited controls and may require release approval. A stale or missing probe is not a green result.","support_wording":"Mingla's owners and admins monitor platform, payment and queue health from Platform health. Missing or stale data is shown honestly instead of being treated as healthy.","who_can_use":["Owner","Admin"],"surfaces":["Mingla Admin (admin.usemingla.com)"]},
 {"capability_key":"staff-offerings","is_new":false,"title":"Offerings: what is on sale and audited fixes","outcome_summary":"Owners and admins find every event, RSVP, trip and experience, starting with what is on sale, then inspect status, visibility, money and guests. Audited actions cover visibility, booking state, cancellation, restoration, price repair and type-specific itinerary or guest fixes.","how_to":"Open Business > Offerings. Search or filter by type, status, visibility, lifecycle or brand, then open an offering. Use the relevant audited control for visibility, bookings, cancellation, held refunds, restoration, price, trip days, experience stops or RSVP guests, and provide the required reason.","limitations":"Owner and Admin only. Cancelling does not silently release paid refunds; held refunds stay in the reviewed operation. Price repair changes the amount, not the currency. Every write is audited, and unsupported type-specific changes are not shown.","support_wording":"Mingla staff can find any offering and perform an audited fix such as changing visibility, closing bookings, correcting a price or cancelling it. Refund release remains a separate reviewed step.","who_can_use":["Owner","Admin"],"surfaces":["Mingla Admin (admin.usemingla.com)"]},
 {"capability_key":"staff-orders-money","is_new":false,"title":"Orders, refunds, disputes and money operations","outcome_summary":"Owners and admins look up orders, issue eligible full or partial refunds, and use the Money ledger and Refund operations for payouts, disputes, debts, platform revenue and recovery. The redesigned pages show real provider and order states and an audited settle step when money is owed back.","how_to":"Open Money > Orders to search and inspect an order and its breakdown. Use Issue refund only when the remaining provider amount allows it. Open Money ledger for refunds, disputes, payouts, debts and revenue, and Refund operations for reconciliation, escalation and approved recovery. Use Payments for brand readiness.","limitations":"Owner and Admin only. Provider actions require the recorded provider identifiers and never infer success from a UI click. Paystack and Stripe have different dispute and refund operations. Money states can be pending, failed or require a person; only a confirmed readback counts as complete.","support_wording":"Mingla staff can inspect an order's full money record and handle eligible refunds or recovery. Provider and payout states are shown as they really are, including pending or failed work that still needs attention.","who_can_use":["Owner","Admin"],"surfaces":["Mingla Admin (admin.usemingla.com)"]},
 {"capability_key":"staff-people-brands","is_new":false,"title":"People and Brands administration","outcome_summary":"The People page separates Explorers, Hosts, Both, unfinished accounts, and staff or test users. Brand detail groups Team, Money, Offerings, Venue and Website, and staff can mark brands as real or staff/test. Delete and ban controls live only inside the selected person and require typed confirmation.","how_to":"Open Business > People and choose a segment, then open a person for identity, status and permitted account actions. Open Business > Brands, choose a brand, and use its Team, Money, Offerings, Venue or Website tab. Mark internal brands with the reviewed real or staff/test control.","limitations":"Owner and Admin only for destructive or sensitive actions. Typed confirmation and server authorization are required for delete or ban. Marking an account or brand internal changes reporting and operational treatment; it does not erase transactions.","support_wording":"Mingla staff use People for Explorer, Host and internal-account administration and Brands for team, money, offerings, venue and website operations. Sensitive actions require typed confirmation and are audited.","who_can_use":["Owner","Admin"],"surfaces":["Mingla Admin (admin.usemingla.com)"]},
 {"capability_key":"staff-sites-ops","is_new":false,"title":"Brand website operations inside Brands","outcome_summary":"Owners and admins inspect a brand's Website tab for entitlement, publication, hostname, editor and public health, history, receipts and safe recovery. Sites is generally available; this workspace handles operational state without editing or silently publishing the brand's content.","how_to":"Open Business > Brands, choose a brand, then Website. Inspect entitlement, publication, permanent addresses, history and health. Use only the offered audited controls to reconcile an ambiguous operation, suspend or resume public access, or revoke editing sessions.","limitations":"Owner and Admin only. An entitlement does not mean a site exists or is published. Safe operations cannot author content or bypass publication, domain or tenant-isolation checks. Suspending keeps the last good publication and drafts; resuming restores access without publishing a new draft.","support_wording":"Sites is generally available, and Mingla staff can inspect a brand's Website tab for health and safe recovery. Staff operations do not edit or publish the brand's site content.","who_can_use":["Owner","Admin"],"surfaces":["Mingla Admin (admin.usemingla.com)"]},
 {"capability_key":"staff-work-board","is_new":false,"title":"Work: Board, Today, This week and This month","outcome_summary":"Work is the Mingla team's single operational inbox. Cards carry owners, watchers, instructions, due dates, linked records, plans, human approvals and closeout proof. Board, Today, This week and This month support team planning and stand-up without a separate Needs you page.","how_to":"Open Home > Work. Use Board to group and filter the full queue, Today for stand-up, This week for the current sprint and This month for the wider runway. Open a card to update its plan, links, owners or result, complete any human message, spend or publish step, and close with proof.","limitations":"Every card still needs a clear outcome, owner and due date. Agents cannot perform human-only send, spend or publish steps. Duplicate open work is refused, changes are audited, and closeout requires proof. Access follows active team roles and the card's ownership.","support_wording":"Mingla's team tracks operations in Work using Board, Today, This week and This month. Human messages, spend and publish decisions open inside the card, and a card closes only with proof.","who_can_use":["Owner","Admin","Sales and marketing","Founding partner"],"surfaces":["Mingla Admin (admin.usemingla.com)","Connected team agents"]},
 {"capability_key":"staff-mingla-money","is_new":true,"title":"Mingla money: revenue, processing, profit and host money","outcome_summary":"Owners and admins read Mingla's internal money position per currency and in USD using each sale's own-day exchange rate. The page separates revenue, provider processing, Mingla profit and host money and surfaces exceptions such as sales that never entered a payout.","how_to":"Open Money > Mingla money. Choose the period and currency view, compare native-currency totals with the own-day USD view, and open exception groups before relying on a headline number. Use Orders, Payments or Money ledger for the underlying record.","limitations":"Owner and Admin only. USD is an analytical conversion using each sale's own-day rate, not a settlement amount. Exceptions must be investigated in the source ledger; this page does not move money or repair a payout.","support_wording":"Mingla money is the internal owner and admin view of revenue, processing, profit and host money by currency, with an own-day USD analytical view and explicit exceptions.","who_can_use":["Owner","Admin"],"surfaces":["Mingla Admin (admin.usemingla.com)"],"claimed_status":"live","required_evidence_kinds":["source","test","pull_request","release_record","migration","deployment","live_check"]},
 {"capability_key":"trips-installments","is_new":false,"title":"Let travellers pay for trips in instalments with Stripe or Paystack","outcome_summary":"Hosts add a deposit and up to 11 later payments to a trip package. Travellers choose pay in full or pay over time. Stripe and eligible Nigerian Paystack brands are supported; later Paystack collections use the reusable authorization when available and otherwise send a secure pay link.","how_to":"In the trip Pricing step, turn on Payment plan, set the deposit and each due amount and date, then publish. Travellers review Pay in full or the deposit plan at checkout. Open the trip Payments screen to see paid, outstanding, next payment and risk states and use the permitted charge, retry, reminder, cancel or refund action.","limitations":"Trips only. A plan must total the server-locked package price and is locked after a booking uses it. Stripe requires a connected bank. Paystack plans are in NGN and require the server capability plus an eligible authorization path; a secure pay link is used when the saved authorization cannot be reused. Failed collections, refunds, disputes and payouts keep provider-specific states.","support_wording":"Trip payment plans work for supported Stripe brands and eligible Nigerian Paystack brands. Guests pay a deposit and review the later dates; Mingla charges the authorised card when possible and sends a secure Paystack link when a new authorization is needed.","who_can_use":["Brand owner","Brand admin","Event manager","Finance manager","Buyer","Explorer"],"surfaces":["Mingla Host iOS","Mingla Host Android","Mingla Host web","Buyer web","Mingla Explorer iOS","Mingla Explorer Android","Email","Push notifications"]},
 {"capability_key":"web-blog","is_new":true,"title":"Public Mingla Blog and staff publishing workspace","outcome_summary":"Mingla's public website has a searchable Blog with four categories, public posts, previews and sitemap discovery. Staff author and publish posts from Support > Blog, and a published post can be inserted into a reviewed staff email.","how_to":"Readers open usemingla.com/blog, choose a category or post and use the public links. Staff open Mingla Admin > Support > Blog to draft, preview and publish a post. In Support > Email, add Blog post and select a published post for the approved email layout.","limitations":"Public reads return published posts only; preview and staff drafts stay access-controlled. Blog media uses the approved storage origin and rich text is sanitized. Publishing a post does not send an email, and adding it to email does not republish it.","support_wording":"Mingla's public Blog is at usemingla.com/blog. Staff draft and publish posts from Support > Blog, and only published posts can be selected for a Blog post email block.","who_can_use":["Everyone","Owner","Admin","Support staff with Blog access"],"surfaces":["Mingla website (usemingla.com)","Mingla Admin (admin.usemingla.com)","Email"],"claimed_status":"live","required_evidence_kinds":["source","test","pull_request","release_record","migration","deployment","live_check"]}
]
$guide$::jsonb) AS row(
  capability_key text, is_new boolean, title text, outcome_summary text,
  how_to text, limitations text, support_wording text, who_can_use jsonb,
  surfaces jsonb, claimed_status text, required_evidence_kinds jsonb
);

CREATE TEMP TABLE issue_4179_live_before ON COMMIT DROP AS
SELECT count(*)::integer AS live_rows
  FROM public.product_capabilities c
 WHERE c.claimed_status = 'live'
   AND public.issue_3720_feature_guide_effective_status(c.id) = 'Live';

DO $preflight$
DECLARE v_missing text;
BEGIN
  IF (SELECT count(*) FROM issue_4179_merge_review) <> 144
     OR (SELECT count(DISTINCT pr) FROM issue_4179_merge_review) <> 144
     OR (SELECT count(*) FROM issue_4179_merge_review WHERE disposition <> 'no_effect') <> 95
     OR (SELECT count(*) FROM issue_4179_merge_review WHERE disposition = 'no_effect') <> 49 THEN
    RAISE EXCEPTION 'issue4179_merge_review_cardinality';
  END IF;
  IF EXISTS (
    SELECT 1 FROM issue_4179_merge_review
     WHERE disposition NOT IN ('existing','new','no_effect')
        OR (disposition = 'no_effect') <> (jsonb_array_length(capability_keys) = 0)
  ) THEN
    RAISE EXCEPTION 'issue4179_merge_review_shape';
  END IF;
  IF (SELECT count(*) FROM issue_4179_guide) <> 33
     OR (SELECT count(*) FROM issue_4179_guide WHERE is_new) <> 4
     OR (SELECT count(DISTINCT capability_key) FROM issue_4179_guide) <> 33 THEN
    RAISE EXCEPTION 'issue4179_guide_payload_shape';
  END IF;
  IF EXISTS (
    SELECT 1 FROM issue_4179_guide g
     WHERE (g.is_new AND EXISTS (SELECT 1 FROM public.product_capabilities c WHERE c.capability_key = g.capability_key))
        OR (NOT g.is_new AND NOT EXISTS (SELECT 1 FROM public.product_capabilities c WHERE c.capability_key = g.capability_key))
  ) THEN
    RAISE EXCEPTION 'issue4179_new_existing_contract';
  END IF;
  SELECT string_agg(DISTINCT k, ', ' ORDER BY k) INTO v_missing
    FROM issue_4179_merge_review r
    CROSS JOIN LATERAL jsonb_array_elements_text(r.capability_keys) k
   WHERE NOT EXISTS (SELECT 1 FROM public.product_capabilities c WHERE c.capability_key = k)
     AND NOT EXISTS (SELECT 1 FROM issue_4179_guide g WHERE g.is_new AND g.capability_key = k);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'issue4179_review_unknown_capabilities: %', v_missing;
  END IF;
END;
$preflight$;

-- Rewritten truth cannot inherit a previous release's time-dependent proof.
UPDATE public.product_capability_evidence e
   SET is_current = false
  FROM public.product_capabilities c
  JOIN issue_4179_guide g ON g.capability_key = c.capability_key
 WHERE e.capability_id = c.id
   AND e.is_current
   AND e.evidence_kind IN ('release_record','feature_flag','deployment','app_release','live_check');

WITH saved AS (
  UPDATE public.product_capabilities c
     SET title = g.title,
         outcome_summary = g.outcome_summary,
         how_to = g.how_to,
         limitations = g.limitations,
         support_wording = g.support_wording,
         who_can_use = ARRAY(SELECT jsonb_array_elements_text(g.who_can_use)),
         surfaces = ARRAY(SELECT jsonb_array_elements_text(g.surfaces)),
         claimed_status = COALESCE(g.claimed_status, c.claimed_status),
         verification_due_at = now(),
         revision = c.revision + 1,
         updated_at = now()
    FROM issue_4179_guide g
   WHERE NOT g.is_new
     AND c.capability_key = g.capability_key
  RETURNING c.id, c.revision
)
INSERT INTO public.product_truth_audit(action, capability_id, metadata)
SELECT 'capability_saved', id,
       jsonb_build_object('source','issue_4179_feature_guide_merge_reconciliation',
         'issue',4179,'baseline','c604fb6931ecb00c939ead8023198a7648bba606',
         'reviewed_head','896d0482f669d9e0d9f407c6b05a7bc5617010d7',
         'reviewed_merges',144,'revision',revision)
  FROM saved;

WITH inserted AS (
  INSERT INTO public.product_capabilities(
    capability_key, title, outcome_summary, who_can_use, surfaces, how_to,
    limitations, support_wording, claimed_status, required_evidence_kinds,
    verification_due_at
  )
  SELECT g.capability_key, g.title, g.outcome_summary,
         ARRAY(SELECT jsonb_array_elements_text(g.who_can_use)),
         ARRAY(SELECT jsonb_array_elements_text(g.surfaces)),
         g.how_to, g.limitations, g.support_wording, g.claimed_status,
         ARRAY(SELECT jsonb_array_elements_text(g.required_evidence_kinds)),
         CASE WHEN g.claimed_status = 'live' THEN now() ELSE NULL END
    FROM issue_4179_guide g
   WHERE g.is_new
  RETURNING id, revision
)
INSERT INTO public.product_truth_audit(action, capability_id, metadata)
SELECT 'capability_saved', id,
       jsonb_build_object('source','issue_4179_feature_guide_merge_reconciliation',
         'issue',4179,'baseline','c604fb6931ecb00c939ead8023198a7648bba606',
         'reviewed_head','896d0482f669d9e0d9f407c6b05a7bc5617010d7',
         'reviewed_merges',144,'revision',revision,'new',true)
  FROM inserted;

-- Static proof for the four new entries. Release, deployment, app-release and
-- live-check evidence are intentionally absent until a person verifies them.
WITH evidence(capability_key, kind, url, details, observed_at) AS (
  VALUES
    ('account-app-updates','source','https://github.com/Mingla-LLC/mingla-main/blob/896d0482f669d9e0d9f407c6b05a7bc5617010d7/app-mobile/src/services/appVersionPolicy.ts','Reviewed Explorer update-policy source at the reconciliation head.','2026-10-29T08:49:31Z'::timestamptz),
    ('account-app-updates','test','https://github.com/Mingla-LLC/mingla-main/blob/896d0482f669d9e0d9f407c6b05a7bc5617010d7/app-mobile/src/services/__tests__/issue_2075_app_version_policy.test.ts','Store-floor and update-policy regression proof.','2026-10-29T08:49:31Z'),
    ('brand-customer-enquiries','source','https://github.com/Mingla-LLC/mingla-main/blob/896d0482f669d9e0d9f407c6b05a7bc5617010d7/mingla-business/src/services/publicEnquiryService.ts','Reviewed public enquiry source at the reconciliation head.','2026-10-29T08:49:31Z'),
    ('brand-customer-enquiries','test','https://github.com/Mingla-LLC/mingla-main/blob/896d0482f669d9e0d9f407c6b05a7bc5617010d7/app-mobile/src/components/brandEnquiry/__tests__/issue_4111_explorer_enquiry_model.implementor.happy.test.ts','Customer-enquiry model regression proof.','2026-10-29T08:49:31Z'),
    ('brand-customer-enquiries','pull_request','https://github.com/Mingla-LLC/mingla-main/pull/4131','Reviewed newsletter and customer-enquiry merge.','2026-10-26T20:50:26Z'),
    ('brand-customer-enquiries','migration','https://github.com/Mingla-LLC/mingla-main/blob/896d0482f669d9e0d9f407c6b05a7bc5617010d7/supabase/migrations/20271221004111_issue_4111_brand_enquiries_schema.sql','Customer-enquiry schema migration at the reconciliation head.','2026-10-29T08:49:31Z'),
    ('staff-mingla-money','source','https://github.com/Mingla-LLC/mingla-main/blob/896d0482f669d9e0d9f407c6b05a7bc5617010d7/mingla-admin/src/pages/MinglaMoneyPage.jsx','Reviewed Mingla money Admin source at the reconciliation head.','2026-10-29T08:49:31Z'),
    ('staff-mingla-money','test','https://github.com/Mingla-LLC/mingla-main/blob/896d0482f669d9e0d9f407c6b05a7bc5617010d7/mingla-admin/src/__tests__/issue_4130_w2a_money.implementor.test.js','Admin money regression proof.','2026-10-29T08:49:31Z'),
    ('staff-mingla-money','pull_request','https://github.com/Mingla-LLC/mingla-main/pull/4145','Reviewed Admin business-operations merge.','2026-10-27T11:27:00Z'),
    ('staff-mingla-money','migration','https://github.com/Mingla-LLC/mingla-main/blob/896d0482f669d9e0d9f407c6b05a7bc5617010d7/supabase/migrations/20280111004130_issue_4130_mingla_money.sql','Mingla money schema migration at the reconciliation head.','2026-10-29T08:49:31Z'),
    ('web-blog','source','https://github.com/Mingla-LLC/mingla-main/blob/896d0482f669d9e0d9f407c6b05a7bc5617010d7/mingla-marketing/app/blog/page.tsx','Reviewed public Blog source at the reconciliation head.','2026-10-29T08:49:31Z'),
    ('web-blog','test','https://github.com/Mingla-LLC/mingla-main/blob/896d0482f669d9e0d9f407c6b05a7bc5617010d7/mingla-admin/src/__tests__/issue_4137_blog_admin.implementor.test.ts','Admin Blog regression proof.','2026-10-29T08:49:31Z'),
    ('web-blog','pull_request','https://github.com/Mingla-LLC/mingla-main/pull/4156','Reviewed public and staff Blog merge.','2026-10-28T12:25:50Z'),
    ('web-blog','migration','https://github.com/Mingla-LLC/mingla-main/blob/896d0482f669d9e0d9f407c6b05a7bc5617010d7/supabase/migrations/20280120004137_issue_4137_blog_schema.sql','Blog schema migration at the reconciliation head.','2026-10-29T08:49:31Z')
), retired AS (
  UPDATE public.product_capability_evidence e
     SET is_current = false
    FROM public.product_capabilities c, evidence x
   WHERE c.capability_key = x.capability_key
     AND e.capability_id = c.id
     AND e.evidence_kind = x.kind
     AND e.is_current
  RETURNING e.id
), inserted AS (
  INSERT INTO public.product_capability_evidence(
    capability_id, evidence_kind, evidence_url, verdict, details, observed_at,
    expires_at, is_current
  )
  SELECT c.id, x.kind, x.url, 'verified', x.details, x.observed_at,
         NULL, true
    FROM evidence x
    JOIN public.product_capabilities c USING (capability_key)
  RETURNING id, capability_id, evidence_kind
)
INSERT INTO public.product_truth_audit(action, capability_id, evidence_id, metadata)
SELECT 'evidence_recorded', capability_id, id,
       jsonb_build_object('source','issue_4179_feature_guide_merge_reconciliation',
         'issue',4179,'kind',evidence_kind,'verdict','verified')
  FROM inserted;

DO $postcheck$
DECLARE v_text text;
BEGIN
  IF (SELECT count(*) FROM public.product_capabilities) < 159 THEN
    RAISE EXCEPTION 'issue4179_catalog_missing_rows';
  END IF;
  IF (SELECT count(*) FROM public.product_capabilities
       WHERE capability_key IN ('account-app-updates','brand-customer-enquiries','staff-mingla-money','web-blog')) <> 4 THEN
    RAISE EXCEPTION 'issue4179_new_capabilities_missing';
  END IF;
  IF (SELECT count(*) FROM public.product_truth_audit
       WHERE metadata->>'source' = 'issue_4179_feature_guide_merge_reconciliation'
         AND action = 'capability_saved') <> 33 THEN
    RAISE EXCEPTION 'issue4179_capability_audit_missing';
  END IF;
  IF (SELECT count(*)::integer FROM public.product_capabilities c
       WHERE c.claimed_status = 'live'
         AND public.issue_3720_feature_guide_effective_status(c.id) = 'Live')
     > (SELECT live_rows FROM issue_4179_live_before) THEN
    RAISE EXCEPTION 'issue4179_reconciliation_promoted_entry';
  END IF;
  IF EXISTS (
    SELECT 1 FROM issue_4179_guide g
    JOIN public.product_capabilities c USING (capability_key)
    WHERE c.claimed_status = 'live'
      AND public.issue_3720_feature_guide_effective_status(c.id) = 'Live'
  ) THEN
    RAISE EXCEPTION 'issue4179_rewritten_entry_did_not_fail_closed';
  END IF;
  SELECT concat_ws(' ', title, outcome_summary, how_to, limitations, support_wording)
    INTO v_text FROM public.product_capabilities WHERE capability_key = 'trips-installments';
  IF v_text ILIKE '%Paystack) brands cannot%'
     OR v_text ILIKE '%not available for brands paid out in Nigeria%'
     OR v_text NOT ILIKE '%eligible Nigerian Paystack%' THEN
    RAISE EXCEPTION 'issue4179_paystack_installment_truth_stale';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_capabilities
      WHERE capability_key = 'events-ticket-transfers'
        AND claimed_status <> 'retired'
        AND outcome_summary ILIKE '%send an eligible extra ticket%') THEN
    RAISE EXCEPTION 'issue4179_ticket_transfer_truth_stale';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_capabilities
      WHERE capability_key = 'sites-brand-website'
        AND outcome_summary ILIKE '%Every active brand%'
        AND limitations ILIKE '%does not mean a site exists%') THEN
    RAISE EXCEPTION 'issue4179_sites_ga_truth_stale';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.product_capabilities c
    JOIN issue_4179_guide g USING (capability_key)
    WHERE concat_ws(' ', c.title, c.outcome_summary, c.how_to, c.limitations, c.support_wording)
      ILIKE ANY (ARRAY['%Community & Support console%','%private pilot with one brand%','%Creators program isn''t available yet%'])
  ) THEN
    RAISE EXCEPTION 'issue4179_retired_wording_remains';
  END IF;
END;
$postcheck$;

COMMIT;
