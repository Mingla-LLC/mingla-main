-- #4490: shared migrations-lane resync (step 2 of 2). Runs right before the
-- first #4490 suite. See issue_4490_lane_snapshot.implementor.pg17.test.sql:
-- earlier suites' \ir re-applies of older migrations put back definitions
-- #4490 replaced; this restores the recorded final definitions, proves each
-- one matches the record again, and drops the record. Fails closed when the
-- snapshot step did not run.
\set ON_ERROR_STOP on
BEGIN;
DO $resync$
DECLARE r record; v_now text; v_count integer := 0;
BEGIN
  IF to_regclass('ci_issue_4490.lane_snapshot') IS NULL THEN
    RAISE EXCEPTION '#4490 lane resync: no snapshot (issue_4490_lane_snapshot must run first in the lane)';
  END IF;
  FOR r IN SELECT * FROM ci_issue_4490.lane_snapshot ORDER BY kind, ident LOOP
    EXECUTE r.ddl;
    v_count := v_count + 1;
  END LOOP;
  FOR r IN SELECT * FROM ci_issue_4490.lane_snapshot LOOP
    v_now := CASE r.kind
      WHEN 'function' THEN md5(pg_get_functiondef(r.ident::regprocedure))
      WHEN 'view' THEN md5(pg_get_viewdef(r.ident::regclass))
      WHEN 'constraint' THEN (SELECT md5(pg_get_constraintdef(c.oid)) FROM pg_constraint c
        WHERE c.conrelid = 'public.claim_links'::regclass AND c.conname = split_part(r.ident, '.', 3))
      WHEN 'policy' THEN (SELECT md5(format('ALTER POLICY %I ON %s%s%s', p.polname, p.polrelid::regclass::text,
          CASE WHEN p.polqual IS NULL THEN '' ELSE ' USING (' || pg_get_expr(p.polqual, p.polrelid) || ')' END,
          CASE WHEN p.polwithcheck IS NULL THEN '' ELSE ' WITH CHECK (' || pg_get_expr(p.polwithcheck, p.polrelid) || ')' END))
        FROM pg_policy p
        WHERE p.polrelid = (split_part(r.ident, '.', 1) || '.' || split_part(r.ident, '.', 2))::regclass
          AND p.polname = substr(r.ident, length(split_part(r.ident, '.', 1) || '.' || split_part(r.ident, '.', 2)) + 2))
    END;
    IF v_now IS DISTINCT FROM r.fingerprint THEN
      RAISE EXCEPTION '#4490 lane resync: % % does not match its recorded definition', r.kind, r.ident;
    END IF;
  END LOOP;
  RAISE NOTICE '#4490 lane resync: % objects restored and verified', v_count;
END
$resync$;
DROP SCHEMA ci_issue_4490 CASCADE;
COMMIT;
