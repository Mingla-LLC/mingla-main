-- Issue #4134 — no database function may answer an ordinary application
-- conflict with SQLSTATE 40001 (serialization_failure) any more.
--
-- PostgREST 14 retries SQLSTATE 40001 inside the server with no limit. Every
-- function below raises 40001 for a conflict that cannot heal by itself (a
-- stale revision, a stale cursor, an expired lease, a request still marked in
-- flight, a fault turned into "try again"), so one stale call loops forever and
-- pins database CPU. That happened on 2026-10-22..26 through
-- biz_apply_trip_draft_graph. #4064 (20271213004064) fixed the same class for
-- ops_card_lock and business_update_rsvp_graph; this migration finishes the job
-- for every remaining function in the application schemas.
--
-- What changes, and nothing else:
--   1. Every RAISE site that sets ERRCODE '40001' / 'serialization_failure',
--      or raises SQLSTATE '40001' / serialization_failure directly, now uses
--      PT409. PostgREST answers PT409 once, as HTTP 409. Every message, hint,
--      detail and code path is unchanged; the clients read the message.
--   2. Every EXCEPTION handler that caught serialization_failure / SQLSTATE
--      '40001' keeps that condition and ALSO catches SQLSTATE 'PT409'. Without
--      this, a conflict that used to be re-raised or classed as "busy" would
--      fall into the next WHEN OTHERS arm and change behaviour (for example
--      biz_guest_roster_list would turn a stale cursor into
--      guest_roster_filter_invalid, and get_brand_circle_reach would swallow it
--      into an "unavailable" answer). A genuine serialization failure is still
--      caught exactly as before.
--
-- Each function is rewritten from its own live definition
-- (pg_get_functiondef), so the body that ships is the body that was there, and
-- CREATE OR REPLACE keeps the oid, owner, grants, comment, SECURITY DEFINER and
-- SET search_path. The DO block checks all of that before it commits.
--
-- No function is excluded: none uses 40001 as a transient signal that a blind
-- server-side retry could clear. The "try_again" messages ask the CALLER to
-- send the request again, which still happens, once, from the client.
--
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $issue_4134$
DECLARE
  -- A RAISE site that names 40001 / serialization_failure as its SQLSTATE.
  c_raise_errcode constant text :=
    '(errcode\s*:?=\s*)''(40001|serialization_failure)''';
  c_raise_sqlstate constant text :=
    '(raise\s+(exception\s+)?)sqlstate\s+''40001''';
  c_raise_condition constant text :=
    '(raise\s+(exception\s+)?)serialization_failure\M';
  -- A handler condition naming the old code that does not yet name PT409.
  c_handler constant text :=
    '((when|or)\s+)(serialization_failure|sqlstate\s+''40001'')(?!\s+or\s+sqlstate\s+''PT409'')';
  r record;
  v_def text;
  v_new text;
  v_count integer := 0;
  v_bad text;
BEGIN
  CREATE TEMP TABLE issue_4134_before ON COMMIT DROP AS
  SELECT p.oid,
         p.oid::pg_catalog.regprocedure::text AS signature,
         p.proowner,
         p.proacl::text AS acl,
         p.prosecdef,
         p.proconfig,
         p.provolatile,
         p.proleakproof,
         p.proisstrict,
         p.prorettype,
         p.proargtypes::text AS argtypes,
         pg_catalog.obj_description(p.oid, 'pg_proc') AS comment
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'private')
     AND p.prokind IN ('f', 'p')
     AND (p.prosrc ~* c_raise_errcode
          OR p.prosrc ~* c_raise_sqlstate
          OR p.prosrc ~* c_raise_condition
          OR p.prosrc ~* c_handler);

  FOR r IN SELECT b.oid, b.signature FROM issue_4134_before AS b ORDER BY b.signature LOOP
    v_def := pg_catalog.pg_get_functiondef(r.oid);
    v_new := pg_catalog.regexp_replace(v_def, c_raise_errcode, '\1''PT409''', 'gi');
    v_new := pg_catalog.regexp_replace(v_new, c_raise_sqlstate, '\1SQLSTATE ''PT409''', 'gi');
    v_new := pg_catalog.regexp_replace(v_new, c_raise_condition, '\1SQLSTATE ''PT409''', 'gi');
    v_new := pg_catalog.regexp_replace(v_new, c_handler, '\1\3 OR SQLSTATE ''PT409''', 'gi');
    IF v_new IS DISTINCT FROM v_def THEN
      EXECUTE v_new;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  -- Same functions, same oids, same owner, grants, security, settings and
  -- comment: only the bodies changed.
  SELECT pg_catalog.string_agg(b.signature, ', ' ORDER BY b.signature) INTO v_bad
    FROM issue_4134_before AS b
    LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = b.oid
   WHERE p.oid IS NULL
      OR p.proowner IS DISTINCT FROM b.proowner
      OR p.proacl::text IS DISTINCT FROM b.acl
      OR p.prosecdef IS DISTINCT FROM b.prosecdef
      OR p.proconfig IS DISTINCT FROM b.proconfig
      OR p.provolatile IS DISTINCT FROM b.provolatile
      OR p.proleakproof IS DISTINCT FROM b.proleakproof
      OR p.proisstrict IS DISTINCT FROM b.proisstrict
      OR p.prorettype IS DISTINCT FROM b.prorettype
      OR p.proargtypes::text IS DISTINCT FROM b.argtypes
      OR pg_catalog.obj_description(p.oid, 'pg_proc') IS DISTINCT FROM b.comment;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue_4134_verify: rewriting changed more than the body of: %', v_bad;
  END IF;

  -- No function anywhere outside the system schemas still raises 40001, and
  -- every handler that catches it also catches PT409.
  SELECT pg_catalog.string_agg(p.oid::pg_catalog.regprocedure::text, ', '
                               ORDER BY p.oid::pg_catalog.regprocedure::text) INTO v_bad
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND (p.prosrc ~* c_raise_errcode
          OR p.prosrc ~* c_raise_sqlstate
          OR p.prosrc ~* c_raise_condition
          OR p.prosrc ~* c_handler);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue_4134_verify: still raising or only catching SQLSTATE 40001: %', v_bad;
  END IF;

  RAISE NOTICE 'issue_4134: % functions now raise PT409 for application conflicts', v_count;
END
$issue_4134$;

COMMIT;
