-- =====================================================================================
-- #3055 implementor proof — the Ari certification backlog repair is CONVERGENT.
--
-- Run AFTER the complete migration chain on supabase/postgres:17.4.1.075, from the
-- repository checkout (it reads three repo files through `git rev-parse`):
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/__tests__/issue_3055_ari_cert_backlog_repair.implementor.pg17.test.sql
--
-- The repair (20270630003055) must land ONE final state from both places it can
-- run:
--   (B) the CI chain — every stranded certification file already applied;
--   (A) production — the #2830 requirement set and #2830 function bodies, no
--       set-digest helper. Built here from the chain by reversing exactly the
--       stranded deltas and installing #2830's function statements verbatim
--       from 20270609002830, then PROVEN production-shaped against fingerprints
--       probed read-only from gqnoajqerqhnvulmnyvv on 2026-09-12.
--
-- Proves, in order:
--   B1  the chain tip agrees with docs/contracts/ari-capability-ledger.json, id for id;
--   B2  applying the real repair file to (B) changes nothing, twice;
--   A0  the (A) fixture is byte-identical to production on every fingerprint probed;
--   A1  production's defect, executed: begin_run stamps a hardcoded literal that is
--       not the digest of the set it certifies;
--   A2  applying the real repair file to (A) lands a state IDENTICAL to (B) — the
--       full ordered (capability_id, evidence_mode) set, the set digest, all three
--       function definitions / configs / ACLs / comments, the immutability
--       trigger, and a fingerprint of every ari_cert_* catalog object;
--   A3  applying it again changes nothing;
--   A4  the repaired set agrees with the ledger, id for id;
--   A5  the immutability trigger is in force again: a DELETE is refused;
--   R   the two halves agree: begin_run stamps the helper digest; a run with no
--       evidence stops at ari_cert_missing_capabilities; a run with every
--       capability covered stops at the MATRIX gate — past the digest gate — and a
--       control run whose stamped digest is tampered stops AT the digest gate, so
--       the matrix result is not vacuous.
--
-- The real migration file is applied with \ir, exactly as a psql apply would run it,
-- so its own BEGIN/COMMIT is exercised. The suite restores (B) itself and A2 proves
-- the restoration is exact. The round trip rolls back.
--
-- When a later migration changes the requirement set or re-issues these functions,
-- B2/A0/A2 move with it — the precedent is #1980/#1981 amending #2592's denominator
-- suite. The fixture fingerprints are production's, probed once, and never move.
-- =====================================================================================

\set ON_ERROR_STOP on
\set issue_3055_sites_src `cat "$(git rev-parse --show-toplevel)/supabase/migrations/20270609002830_issue_2830_mingla_sites_foundation.sql"`
\set issue_3055_ledger `cat "$(git rev-parse --show-toplevel)/docs/contracts/ari-capability-ledger.json"`

-- -------------------------------------------------------------------------------------
-- Session scaffolding. TEMP objects live for this psql session only.
-- -------------------------------------------------------------------------------------
CREATE TEMP TABLE issue_3055_input (name text PRIMARY KEY, body text NOT NULL);
INSERT INTO issue_3055_input (name, body) VALUES
  ('sites_2830', :'issue_3055_sites_src'),
  ('ledger', :'issue_3055_ledger');

CREATE TEMP TABLE issue_3055_snap (label text PRIMARY KEY, snap jsonb NOT NULL);

-- Every ari_cert_* catalog object: function bodies/configs/ACLs/comments, columns,
-- constraints, non-internal triggers, policies, table ACL + RLS flags.
CREATE FUNCTION pg_temp.issue_3055_catalog_lines()
RETURNS SETOF text
LANGUAGE sql
STABLE
AS $fn$
  SELECT line FROM (
    SELECT 'fn ' || p.oid::regprocedure::text || ' ' || md5(p.prosrc) || ' '
           || coalesce(array_to_string(p.proconfig, ','), '') || ' ' || p.prosecdef::text || ' '
           || p.provolatile::text || ' ' || p.proowner::regrole::text || ' ' || coalesce(p.proacl::text, '')
           || ' ' || coalesce(md5(obj_description(p.oid, 'pg_proc')), '<no comment>') AS line
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private') AND p.proname LIKE 'ari\_cert%'
    UNION ALL
    SELECT 'col ' || c.table_schema || '.' || c.table_name || '.' || c.column_name || ' '
           || c.data_type || ' ' || coalesce(c.column_default, '') || ' ' || c.is_nullable
    FROM information_schema.columns c
    WHERE c.table_schema IN ('public', 'private') AND c.table_name LIKE 'ari\_cert%'
    UNION ALL
    SELECT 'con ' || con.conrelid::regclass::text || '.' || con.conname || ' ' || md5(pg_get_constraintdef(con.oid))
    FROM pg_constraint con
    WHERE con.conrelid::regclass::text LIKE '%ari\_cert%'
    UNION ALL
    SELECT 'trg ' || c.relname || '.' || t.tgname || ' ' || pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'private') AND c.relname LIKE 'ari\_cert%' AND NOT t.tgisinternal
    UNION ALL
    SELECT 'pol ' || pol.schemaname || '.' || pol.tablename || '.' || pol.policyname || ' '
           || md5(coalesce(pol.qual, '') || coalesce(pol.with_check, '') || array_to_string(pol.roles, ',') || pol.cmd)
    FROM pg_policies pol
    WHERE pol.tablename LIKE 'ari\_cert%'
    UNION ALL
    SELECT 'tbl ' || n.nspname || '.' || c.relname || ' ' || coalesce(c.relacl::text, '') || ' '
           || c.relrowsecurity::text || ' ' || c.relforcerowsecurity::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'private') AND c.relname LIKE 'ari\_cert%' AND c.relkind = 'r'
  ) x
  ORDER BY line COLLATE "C";
$fn$;

CREATE FUNCTION pg_temp.issue_3055_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_helper regprocedure := to_regprocedure('private.ari_cert_requirements_set_digest_v1()');
  v_helper_digest text;
  v_result jsonb;
BEGIN
  IF v_helper IS NOT NULL THEN
    EXECUTE 'SELECT private.ari_cert_requirements_set_digest_v1()' INTO v_helper_digest;
  END IF;

  SELECT jsonb_build_object(
    'rows', (
      SELECT coalesce(jsonb_agg(jsonb_build_array(r.capability_id, r.evidence_mode)
                                ORDER BY r.capability_id COLLATE "C"), '[]'::jsonb)
      FROM public.ari_cert_capability_requirements r),
    'row_count', (SELECT count(*) FROM public.ari_cert_capability_requirements),
    'set_md5', (
      SELECT md5(coalesce(string_agg(r.capability_id || '=' || r.evidence_mode, E'\n'
                                     ORDER BY r.capability_id COLLATE "C"), ''))
      FROM public.ari_cert_capability_requirements r),
    -- The digest computed straight from the primitive, so it exists in BOTH shapes.
    'set_digest_primitive', (
      SELECT private.ari_cert_digest_v1(
        'requirements-set',
        coalesce(array_agg(private.ari_cert_digest_v1('requirement', ARRAY[r.capability_id, r.evidence_mode])
                           ORDER BY r.capability_id), ARRAY[]::text[]))
      FROM public.ari_cert_capability_requirements r),
    'set_digest_helper', v_helper_digest,
    'functions', (
      SELECT jsonb_object_agg(f.sig, CASE WHEN p.oid IS NULL THEN NULL ELSE jsonb_build_object(
               'prosrc_md5', md5(p.prosrc),
               'config', p.proconfig,
               'security_definer', p.prosecdef,
               'volatility', p.provolatile,
               'owner', p.proowner::regrole::text,
               'acl', p.proacl::text,
               'comment', obj_description(p.oid, 'pg_proc'),
               'definition_md5', md5(pg_get_functiondef(p.oid))) END)
      FROM (VALUES
        ('private.ari_cert_requirements_set_digest_v1()'),
        ('public.ari_cert_begin_run(text,jsonb,text,jsonb,jsonb)'),
        ('public.ari_cert_finalize_run(uuid)')
      ) f(sig)
      LEFT JOIN pg_proc p ON p.oid = to_regprocedure(f.sig)),
    'trigger', (
      SELECT jsonb_build_object('count', count(*),
                                'definition', min(pg_get_triggerdef(t.oid)),
                                'enabled', min(t.tgenabled::text))
      FROM pg_trigger t
      WHERE t.tgrelid = 'public.ari_cert_capability_requirements'::regclass
        AND t.tgname = 'ari_cert_capability_requirements_immutable_trigger'
        AND NOT t.tgisinternal),
    'catalog_md5', (
      SELECT md5(string_agg(line, E'\n' ORDER BY line COLLATE "C")) FROM pg_temp.issue_3055_catalog_lines() AS line)
  ) INTO v_result;
  RETURN v_result;
END;
$fn$;

CREATE FUNCTION pg_temp.issue_3055_capture(p_label text)
RETURNS jsonb
LANGUAGE sql
AS $fn$
  INSERT INTO issue_3055_snap (label, snap) VALUES (p_label, pg_temp.issue_3055_snapshot())
  RETURNING jsonb_build_object('label', label, 'rows', snap -> 'row_count',
                               'set_digest', snap -> 'set_digest_primitive',
                               'catalog_md5', snap -> 'catalog_md5');
$fn$;

-- Raises naming every top-level facet that differs.
CREATE FUNCTION pg_temp.issue_3055_assert_same(p_code text, p_left text, p_right text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_left jsonb := (SELECT snap FROM issue_3055_snap WHERE label = p_left);
  v_right jsonb := (SELECT snap FROM issue_3055_snap WHERE label = p_right);
  v_diff text;
BEGIN
  IF v_left IS NULL OR v_right IS NULL THEN
    RAISE EXCEPTION '%: snapshot missing (% present=%, % present=%)',
      p_code, p_left, v_left IS NOT NULL, p_right, v_right IS NOT NULL;
  END IF;
  SELECT string_agg(k, ', ' ORDER BY k) INTO v_diff
  FROM (SELECT jsonb_object_keys(v_left) UNION SELECT jsonb_object_keys(v_right)) keys(k)
  WHERE (v_left -> k) IS DISTINCT FROM (v_right -> k);
  IF v_diff IS NOT NULL THEN
    RAISE EXCEPTION '%: "%" and "%" differ in: %', p_code, p_left, p_right, v_diff;
  END IF;
END;
$fn$;

-- Ledger ids vs live requirement ids, both directions.
CREATE FUNCTION pg_temp.issue_3055_assert_ledger_agreement(p_code text)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_ledger_ids text[];
  v_only_ledger text;
  v_only_db text;
  v_db_rows integer;
BEGIN
  SELECT array_agg(value #>> '{}' ORDER BY value #>> '{}')
    INTO v_ledger_ids
  FROM issue_3055_input i,
       LATERAL jsonb_path_query(i.body::jsonb, '$.capabilities[*].id') AS value
  WHERE i.name = 'ledger';
  IF coalesce(cardinality(v_ledger_ids), 0) = 0 THEN
    RAISE EXCEPTION '%: ledger has no capability ids — refusing to pass vacuously', p_code;
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(v_ledger_ids) x) <> cardinality(v_ledger_ids) THEN
    RAISE EXCEPTION '%: ledger capability ids are not unique', p_code;
  END IF;
  SELECT count(*) INTO v_db_rows FROM public.ari_cert_capability_requirements;
  SELECT string_agg(x, ', ' ORDER BY x) INTO v_only_ledger
  FROM unnest(v_ledger_ids) x
  WHERE NOT EXISTS (SELECT 1 FROM public.ari_cert_capability_requirements r WHERE r.capability_id = x);
  SELECT string_agg(r.capability_id, ', ' ORDER BY r.capability_id) INTO v_only_db
  FROM public.ari_cert_capability_requirements r
  WHERE r.capability_id <> ALL (v_ledger_ids);
  IF v_only_ledger IS NOT NULL OR v_only_db IS NOT NULL OR v_db_rows <> cardinality(v_ledger_ids) THEN
    RAISE EXCEPTION '%: requirement set disagrees with the ledger — ledger % ids, db % rows; only in ledger [%]; only in db [%]',
      p_code, cardinality(v_ledger_ids), v_db_rows, v_only_ledger, v_only_db;
  END IF;
  RETURN v_db_rows;
END;
$fn$;

-- One CREATE OR REPLACE FUNCTION statement, verbatim, from a migration source.
CREATE FUNCTION pg_temp.issue_3055_function_statement(p_src text, p_head text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  v_start integer := strpos(p_src, p_head);
  v_rest text;
  v_body_open integer;
  v_after_open text;
  v_body_close integer;
BEGIN
  IF v_start = 0 THEN
    RAISE EXCEPTION 'issue_3055_fixture: "%" not found in source', p_head;
  END IF;
  IF strpos(substr(p_src, v_start + length(p_head)), p_head) > 0 THEN
    RAISE EXCEPTION 'issue_3055_fixture: "%" declared more than once in source', p_head;
  END IF;
  v_rest := substr(p_src, v_start);
  v_body_open := strpos(v_rest, 'AS $function$');
  v_after_open := substr(v_rest, v_body_open + length('AS $function$'));
  v_body_close := strpos(v_after_open, '$function$;');
  IF v_body_open = 0 OR v_body_close = 0 THEN
    RAISE EXCEPTION 'issue_3055_fixture: "%" has no $function$ body', p_head;
  END IF;
  RETURN substr(v_rest, 1, v_body_open + length('AS $function$') - 1 + v_body_close + length('$function$;') - 1);
END;
$fn$;

-- (A): production's shape. Reverses exactly the stranded deltas and installs the
-- #2830 function statements that production runs, with production's COMMENTs.
CREATE FUNCTION pg_temp.issue_3055_install_production_shape()
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_sites text := (SELECT body FROM issue_3055_input WHERE name = 'sites_2830');
BEGIN
  ALTER TABLE public.ari_cert_capability_requirements
    DISABLE TRIGGER ari_cert_capability_requirements_immutable_trigger;
  DELETE FROM public.ari_cert_capability_requirements
  WHERE capability_id IN (
    'ari.rsvp.update',
    'ari.marketing.update_draft', 'ari.marketing.delete_draft', 'ari.growth.read_report',
    'ari.order.refund_preview', 'ari.installment.list');
  INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
  VALUES ('ari.guests.set_approval', 'write');
  UPDATE public.ari_cert_capability_requirements
  SET evidence_mode = 'unsupported'
  WHERE capability_id = 'ari.rsvp.contribution_settings';
  ALTER TABLE public.ari_cert_capability_requirements
    ENABLE TRIGGER ari_cert_capability_requirements_immutable_trigger;

  DROP FUNCTION private.ari_cert_requirements_set_digest_v1();
  EXECUTE pg_temp.issue_3055_function_statement(v_sites, 'CREATE OR REPLACE FUNCTION public.ari_cert_begin_run(');
  EXECUTE pg_temp.issue_3055_function_statement(v_sites, 'CREATE OR REPLACE FUNCTION public.ari_cert_finalize_run(');
  -- Production's comments: #2592 on begin_run, the #2060 foundation on finalize_run.
  COMMENT ON FUNCTION public.ari_cert_begin_run(text, jsonb, text, jsonb, jsonb) IS
    'Issue #2592: opens a certification run stamped with the SAME reviewed requirement-set digest ari_cert_finalize_run checks. The two literals are one contract; a static CI gate fails closed if they ever diverge again.';
  COMMENT ON FUNCTION public.ari_cert_finalize_run(uuid) IS
    'Issue #2060: the sole terminal-status writer; fails closed unless the canonical 116 IDs, complete scenario/surface/role matrix, server-owned digests, seven exact-release artifacts, cleanup, tester PASS, and rollback proof are complete.';
END;
$fn$;

-- =====================================================================================
-- B — the chain.
-- =====================================================================================
SELECT pg_temp.issue_3055_capture('B');

DO $b1$
DECLARE v_rows integer;
BEGIN
  v_rows := pg_temp.issue_3055_assert_ledger_agreement('T-3055-B1');
  IF (SELECT snap -> 'functions' -> 'private.ari_cert_requirements_set_digest_v1()' FROM issue_3055_snap WHERE label = 'B') = 'null'::jsonb THEN
    RAISE EXCEPTION 'T-3055-B1: the chain has no set-digest helper — this is not state (B)';
  END IF;
  RAISE NOTICE 'T-3055-B1 PASS: chain holds % requirement rows, id-for-id equal to the ledger', v_rows;
END;
$b1$;

\ir ../20270630003055_issue_3055_ari_cert_backlog_repair.sql
SELECT pg_temp.issue_3055_capture('B+repair');
\ir ../20270630003055_issue_3055_ari_cert_backlog_repair.sql
SELECT pg_temp.issue_3055_capture('B+repair+repair');

DO $b2$
BEGIN
  PERFORM pg_temp.issue_3055_assert_same('T-3055-B2 repair is not a no-op on the chain', 'B', 'B+repair');
  PERFORM pg_temp.issue_3055_assert_same('T-3055-B2 second repair on the chain changed state', 'B+repair', 'B+repair+repair');
  RAISE NOTICE 'T-3055-B2 PASS: repair applied twice to (B) changed nothing';
END;
$b2$;

-- =====================================================================================
-- A — production.
-- =====================================================================================
BEGIN;
SELECT pg_temp.issue_3055_install_production_shape();
COMMIT;
SELECT pg_temp.issue_3055_capture('A');

DO $a0$
DECLARE
  v_a jsonb := (SELECT snap FROM issue_3055_snap WHERE label = 'A');
  v_fns jsonb := v_a -> 'functions';
BEGIN
  -- Fingerprints probed read-only from production (gqnoajqerqhnvulmnyvv), 2026-09-12.
  IF v_a ->> 'set_md5' <> 'ba7d5b4d9ba9c6556dffd75f650c581b' THEN
    RAISE EXCEPTION 'T-3055-A0: fixture requirement set is not production''s (set_md5 %)', v_a ->> 'set_md5';
  END IF;
  IF v_a ->> 'set_digest_primitive' <> '0cd416301cdef1265e9606a2c65d19c790011e46fe92236ff1122e9761d11a33' THEN
    RAISE EXCEPTION 'T-3055-A0: fixture set digest is not production''s (%)', v_a ->> 'set_digest_primitive';
  END IF;
  IF v_fns -> 'private.ari_cert_requirements_set_digest_v1()' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'T-3055-A0: production has no set-digest helper; the fixture does';
  END IF;
  IF v_fns -> 'public.ari_cert_begin_run(text,jsonb,text,jsonb,jsonb)' ->> 'prosrc_md5' <> '9ca0a49f036b26ec7a1a51a6ab385cd8'
     OR v_fns -> 'public.ari_cert_finalize_run(uuid)' ->> 'prosrc_md5' <> '4eb3d34b07e622ef7092430f2427c87e' THEN
    RAISE EXCEPTION 'T-3055-A0: fixture function bodies are not production''s (begin %, finalize %)',
      v_fns -> 'public.ari_cert_begin_run(text,jsonb,text,jsonb,jsonb)' ->> 'prosrc_md5',
      v_fns -> 'public.ari_cert_finalize_run(uuid)' ->> 'prosrc_md5';
  END IF;
  IF v_fns -> 'public.ari_cert_begin_run(text,jsonb,text,jsonb,jsonb)' -> 'config' <> '["search_path=public, pg_temp"]'::jsonb
     OR v_fns -> 'public.ari_cert_finalize_run(uuid)' -> 'config' <> '["search_path=public, pg_temp"]'::jsonb THEN
    RAISE EXCEPTION 'T-3055-A0: fixture function search_path is not production''s';
  END IF;
  IF md5(v_fns -> 'public.ari_cert_begin_run(text,jsonb,text,jsonb,jsonb)' ->> 'comment') <> 'a252329c947c02c71440c1f2116ee147'
     OR md5(v_fns -> 'public.ari_cert_finalize_run(uuid)' ->> 'comment') <> 'f433c278070b454346090d4298d449bd' THEN
    RAISE EXCEPTION 'T-3055-A0: fixture function comments are not production''s';
  END IF;
  IF v_fns -> 'public.ari_cert_begin_run(text,jsonb,text,jsonb,jsonb)' ->> 'acl' <> '{postgres=X/postgres,service_role=X/postgres}'
     OR v_fns -> 'public.ari_cert_finalize_run(uuid)' ->> 'acl' <> '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'T-3055-A0: fixture function ACLs are not production''s';
  END IF;
  IF v_a -> 'trigger' ->> 'count' <> '1' OR v_a -> 'trigger' ->> 'enabled' <> 'O' THEN
    RAISE EXCEPTION 'T-3055-A0: fixture immutability trigger is not armed';
  END IF;
  RAISE NOTICE 'T-3055-A0 PASS: fixture (A) matches production — % rows, set_md5 %, set digest %, #2830 bodies, no helper',
    v_a ->> 'row_count', v_a ->> 'set_md5', v_a ->> 'set_digest_primitive';
END;
$a0$;

-- A1 — production's defect, executed (rolled back).
BEGIN;
DO $a1$
DECLARE
  v_release_sha constant text := repeat('a', 40);
  v_native constant jsonb := '[
    {"surface":"business_ios_simulator","artifact_id":"issue-3055-a-ios-sim","runtime_version":"1.1.5","device":"iPhone simulator"},
    {"surface":"business_ios_physical","artifact_id":"issue-3055-a-ios-phys","runtime_version":"1.1.5","device":"Physical iPhone"},
    {"surface":"business_android","artifact_id":"issue-3055-a-android","runtime_version":"1.1.5","device":"Pixel 7"}
  ]'::jsonb;
  v_run_id uuid;
  v_stamped text;
  v_set_digest text := (SELECT snap ->> 'set_digest_primitive' FROM issue_3055_snap WHERE label = 'A');
BEGIN
  SET LOCAL ROLE service_role;
  v_run_id := public.ari_cert_begin_run(v_release_sha,
    '{"agent_chat":"v1","agent_confirm_action":"v1"}'::jsonb, 'issue-3055-a-web', v_native, '{}'::jsonb);
  RESET ROLE;
  SELECT requirements_digest INTO v_stamped FROM public.ari_cert_runs WHERE id = v_run_id;
  IF v_stamped <> '0de714ca5cf4f3a78dea892dabaadde8c22d09407d939ec366a239b6d63953ad' THEN
    RAISE EXCEPTION 'T-3055-A1: production-shaped begin_run did not stamp #2830''s literal (%)', v_stamped;
  END IF;
  IF v_stamped = v_set_digest THEN
    RAISE EXCEPTION 'T-3055-A1: #2830''s literal unexpectedly equals the digest of production''s set';
  END IF;
  RAISE NOTICE 'T-3055-A1 PASS: production stamps literal % while the set it certifies digests to % — the halves agree on a number that is not the set',
    v_stamped, v_set_digest;
END;
$a1$;
ROLLBACK;

\ir ../20270630003055_issue_3055_ari_cert_backlog_repair.sql
SELECT pg_temp.issue_3055_capture('A+repair');
\ir ../20270630003055_issue_3055_ari_cert_backlog_repair.sql
SELECT pg_temp.issue_3055_capture('A+repair+repair');

DO $a2$
DECLARE
  v_a jsonb := (SELECT snap FROM issue_3055_snap WHERE label = 'A+repair');
  v_b jsonb := (SELECT snap FROM issue_3055_snap WHERE label = 'B');
  v_rows integer;
BEGIN
  RAISE NOTICE 'T-3055-A2 convergence: (A)+repair rows=% set_digest=% catalog_md5=%',
    v_a ->> 'row_count', v_a ->> 'set_digest_helper', v_a ->> 'catalog_md5';
  RAISE NOTICE 'T-3055-A2 convergence: (B)        rows=% set_digest=% catalog_md5=%',
    v_b ->> 'row_count', v_b ->> 'set_digest_helper', v_b ->> 'catalog_md5';
  -- The full ordered set, not a count.
  IF v_a -> 'rows' IS DISTINCT FROM v_b -> 'rows' THEN
    RAISE EXCEPTION 'T-3055-A2: repaired production set differs from the chain set — only in (A)+repair: %; only in (B): %',
      (SELECT jsonb_agg(e) FROM jsonb_array_elements(v_a -> 'rows') e WHERE NOT (v_b -> 'rows') @> jsonb_build_array(e)),
      (SELECT jsonb_agg(e) FROM jsonb_array_elements(v_b -> 'rows') e WHERE NOT (v_a -> 'rows') @> jsonb_build_array(e));
  END IF;
  IF v_a ->> 'set_digest_helper' IS NULL OR v_a ->> 'set_digest_helper' <> v_b ->> 'set_digest_helper' THEN
    RAISE EXCEPTION 'T-3055-A2: set digest (A)+repair % vs (B) %', v_a ->> 'set_digest_helper', v_b ->> 'set_digest_helper';
  END IF;
  PERFORM pg_temp.issue_3055_assert_same('T-3055-A2 (A)+repair does not converge on (B)', 'A+repair', 'B');
  RAISE NOTICE 'T-3055-A2 PASS: (A)+repair is identical to (B) on rows, digest, functions, trigger and every ari_cert_* catalog object';

  PERFORM pg_temp.issue_3055_assert_same('T-3055-A3 second repair on (A) changed state', 'A+repair', 'A+repair+repair');
  RAISE NOTICE 'T-3055-A3 PASS: repair applied twice to (A) changed nothing the second time';

  v_rows := pg_temp.issue_3055_assert_ledger_agreement('T-3055-A4');
  RAISE NOTICE 'T-3055-A4 PASS: repaired set holds % requirement rows, id-for-id equal to the ledger', v_rows;
END;
$a2$;

-- A5 — the immutability trigger is in force again.
BEGIN;
DO $a5$
DECLARE v_message text;
BEGIN
  BEGIN
    DELETE FROM public.ari_cert_capability_requirements WHERE capability_id = 'ari.rsvp.update';
    RAISE EXCEPTION 'T-3055-A5: DELETE on the requirement set succeeded after the repair — immutability trigger not in force';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
  END;
  IF v_message <> 'ari_cert_evidence_is_immutable' THEN
    RAISE EXCEPTION 'T-3055-A5: DELETE refused for the wrong reason: %', v_message;
  END IF;
  RAISE NOTICE 'T-3055-A5 PASS: DELETE after the repair is refused (%)', v_message;
END;
$a5$;
ROLLBACK;

-- =====================================================================================
-- R — the two halves agree after the repair (all fixtures roll back).
-- =====================================================================================
BEGIN;
DO $round_trip$
DECLARE
  v_release_sha constant text := repeat('b', 40);
  v_run_id uuid;
  v_control_run_id uuid;
  v_stamped text;
  v_live text := private.ari_cert_requirements_set_digest_v1();
  v_requirements integer := (SELECT count(*) FROM public.ari_cert_capability_requirements);
  v_covered integer;
  v_finalized boolean;
  v_message text;
BEGIN
  SET LOCAL ROLE service_role;
  v_run_id := public.ari_cert_begin_run(v_release_sha,
    '{"agent_chat":"v1","agent_confirm_action":"v1"}'::jsonb, 'issue-3055-web',
    '[{"surface":"business_ios_simulator","artifact_id":"issue-3055-ios-sim","runtime_version":"1.1.5","device":"iPhone simulator"},
      {"surface":"business_ios_physical","artifact_id":"issue-3055-ios-phys","runtime_version":"1.1.5","device":"Physical iPhone"},
      {"surface":"business_android","artifact_id":"issue-3055-android","runtime_version":"1.1.5","device":"Pixel 7"}]'::jsonb,
    '{}'::jsonb);
  PERFORM public.ari_cert_record_release_artifact(v_run_id, 'business_ios_simulator', 'issue-3055-ios-sim', v_release_sha, repeat('1', 64));
  PERFORM public.ari_cert_record_release_artifact(v_run_id, 'business_ios_physical', 'issue-3055-ios-phys', v_release_sha, repeat('2', 64));
  PERFORM public.ari_cert_record_release_artifact(v_run_id, 'business_android', 'issue-3055-android', v_release_sha, repeat('3', 64));
  RESET ROLE;

  SELECT requirements_digest INTO v_stamped FROM public.ari_cert_runs WHERE id = v_run_id;
  IF v_stamped IS NULL OR v_stamped !~ '^[0-9a-f]{64}$' OR v_stamped <> v_live THEN
    RAISE EXCEPTION 'T-3055-R1: begin_run stamped % but the helper computes %', v_stamped, v_live;
  END IF;
  RAISE NOTICE 'T-3055-R1 PASS: begin_run stamped the helper digest %', v_stamped;

  -- R2: no evidence. The capability gate precedes the digest gate, so this alone
  -- does NOT prove the halves agree — R3 does.
  v_finalized := false;
  BEGIN
    PERFORM public.ari_cert_finalize_run(v_run_id);
    v_finalized := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
  END;
  IF v_finalized OR v_message <> 'ari_cert_missing_capabilities:0' THEN
    RAISE EXCEPTION 'T-3055-R2: a run with no evidence finalized=% message=%', v_finalized, v_message;
  END IF;
  RAISE NOTICE 'T-3055-R2 PASS: no-evidence run refused with % (not the digest gate)', v_message;

  -- R3: every requirement covered, so the run passes the capability gate and
  -- reaches the digest gate. It must go PAST it, to the matrix gate.
  INSERT INTO public.ari_cert_evidence (
    run_id, capability_id, surface, tenant_case, role_case, scenario,
    artifact_type, artifact_id, outcome, safe_evidence, evidence_digest)
  SELECT v_run_id, r.capability_id, 'business_web', 'owner_tenant', 'owner',
         'confirm_one_side_effect', 'business_web', 'issue-3055-web', 'passed', '{}'::jsonb, repeat('e', 64)
  FROM public.ari_cert_capability_requirements r;
  SELECT count(DISTINCT capability_id) INTO v_covered FROM public.ari_cert_evidence WHERE run_id = v_run_id;
  IF v_covered <> v_requirements THEN
    RAISE EXCEPTION 'T-3055-R3: fixture covers % of % capabilities', v_covered, v_requirements;
  END IF;
  v_finalized := false;
  v_message := NULL;
  BEGIN
    PERFORM public.ari_cert_finalize_run(v_run_id);
    v_finalized := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
  END;
  IF v_finalized THEN
    RAISE EXCEPTION 'T-3055-R3: fixture evidence certified';
  END IF;
  IF v_message = 'ari_cert_requirements_digest_mismatch' THEN
    RAISE EXCEPTION 'T-3055-R3: finalize_run rejected the digest begin_run stamped — the two halves disagree';
  END IF;
  IF v_message LIKE 'ari_cert_missing_capabilities:%' THEN
    RAISE EXCEPTION 'T-3055-R3: finalizer denominator disagrees with the % requirement rows (%)', v_requirements, v_message;
  END IF;
  IF v_message NOT LIKE 'ari_cert_missing_matrix_evidence:%' THEN
    RAISE EXCEPTION 'T-3055-R3: finalizer stopped at an unexpected gate: %', v_message;
  END IF;
  RAISE NOTICE 'T-3055-R3 PASS: % capabilities covered, finalize went past the digest gate to "%"', v_covered, v_message;

  -- R4: control. Same evidence shape, stamped digest tampered: must stop AT the
  -- digest gate, proving R3 passed a live gate rather than a missing one.
  SET LOCAL ROLE service_role;
  v_control_run_id := public.ari_cert_begin_run(repeat('c', 40),
    '{"agent_chat":"v1","agent_confirm_action":"v1"}'::jsonb, 'issue-3055-control-web',
    '[{"surface":"business_ios_simulator","artifact_id":"issue-3055-c-ios-sim","runtime_version":"1.1.5","device":"iPhone simulator"},
      {"surface":"business_ios_physical","artifact_id":"issue-3055-c-ios-phys","runtime_version":"1.1.5","device":"Physical iPhone"},
      {"surface":"business_android","artifact_id":"issue-3055-c-android","runtime_version":"1.1.5","device":"Pixel 7"}]'::jsonb,
    '{}'::jsonb);
  PERFORM public.ari_cert_record_release_artifact(v_control_run_id, 'business_ios_simulator', 'issue-3055-c-ios-sim', repeat('c', 40), repeat('4', 64));
  PERFORM public.ari_cert_record_release_artifact(v_control_run_id, 'business_ios_physical', 'issue-3055-c-ios-phys', repeat('c', 40), repeat('5', 64));
  PERFORM public.ari_cert_record_release_artifact(v_control_run_id, 'business_android', 'issue-3055-c-android', repeat('c', 40), repeat('6', 64));
  RESET ROLE;
  INSERT INTO public.ari_cert_evidence (
    run_id, capability_id, surface, tenant_case, role_case, scenario,
    artifact_type, artifact_id, outcome, safe_evidence, evidence_digest)
  SELECT v_control_run_id, r.capability_id, 'business_web', 'owner_tenant', 'owner',
         'confirm_one_side_effect', 'business_web', 'issue-3055-control-web', 'passed', '{}'::jsonb, repeat('f', 64)
  FROM public.ari_cert_capability_requirements r;
  UPDATE public.ari_cert_runs SET requirements_digest = repeat('0', 64) WHERE id = v_control_run_id;
  v_finalized := false;
  v_message := NULL;
  BEGIN
    PERFORM public.ari_cert_finalize_run(v_control_run_id);
    v_finalized := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
  END;
  IF v_finalized OR v_message IS DISTINCT FROM 'ari_cert_requirements_digest_mismatch' THEN
    RAISE EXCEPTION 'T-3055-R4: a tampered stamped digest finalized=% message=% — the digest gate is not live', v_finalized, v_message;
  END IF;
  RAISE NOTICE 'T-3055-R4 PASS: tampered control run refused at the digest gate (%)', v_message;
END;
$round_trip$;
ROLLBACK;

DO $done$
BEGIN
  PERFORM pg_temp.issue_3055_assert_same('T-3055-END the suite did not leave the chain as it found it', 'B', 'A+repair+repair');
  RAISE NOTICE '#3055 Ari certification backlog repair: convergent from production and chain, idempotent, ledger-exact, halves agree — ALL PASSED';
END;
$done$;
