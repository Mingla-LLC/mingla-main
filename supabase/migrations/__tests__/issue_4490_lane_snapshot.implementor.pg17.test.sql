-- #4490: shared migrations-lane snapshot (step 1 of 2). Runs first in the lane.
--
-- The migrations lane runs every suite against ONE replayed database, in order.
-- Some earlier suites re-apply an older migration with \ir outside a
-- transaction (#3872 R1, #4134, #4261, #4422, #4423), which commits that
-- file's definitions back over objects a #4490 migration later replaced: the
-- order-margin view, the Stay state guard, four #4334 venue and event writers,
-- the claim-link kinds and the four venue-order staff read policies. #4490's
-- migrations patch bodies under checked preconditions, so they cannot simply
-- be re-applied the way those suites re-apply theirs.
--
-- This suite records the replayed (final) definition of exactly those objects;
-- issue_4490_lane_resync.implementor.pg17.test.sql puts them back before the
-- first #4490 suite runs, proves each object matches the record again, and
-- drops the record. Nothing else in the database changes.
\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA IF NOT EXISTS ci_issue_4490;
DROP TABLE IF EXISTS ci_issue_4490.lane_snapshot;
CREATE TABLE ci_issue_4490.lane_snapshot (
  kind text NOT NULL,
  ident text NOT NULL PRIMARY KEY,
  ddl text NOT NULL,
  fingerprint text NOT NULL
);

CREATE FUNCTION pg_temp.policy_ddl(p_table regclass, p_name text) RETURNS text
LANGUAGE sql STABLE AS $f$
  SELECT format('ALTER POLICY %I ON %s%s%s', p.polname, p_table::text,
    CASE WHEN p.polqual IS NULL THEN '' ELSE ' USING (' || pg_get_expr(p.polqual, p.polrelid) || ')' END,
    CASE WHEN p.polwithcheck IS NULL THEN '' ELSE ' WITH CHECK (' || pg_get_expr(p.polwithcheck, p.polrelid) || ')' END)
  FROM pg_policy p WHERE p.polrelid = p_table AND p.polname = p_name;
$f$;

INSERT INTO ci_issue_4490.lane_snapshot (kind, ident, ddl, fingerprint)
SELECT 'function', p.oid::regprocedure::text, pg_get_functiondef(p.oid), md5(pg_get_functiondef(p.oid))
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN (
    'issue_1388_guard_state_transition',
    'biz_create_venue_listing',
    'business_patch_event_taxonomy_with_place',
    'business_publish_event_draft',
    'business_publish_rsvp_draft'
  );

INSERT INTO ci_issue_4490.lane_snapshot (kind, ident, ddl, fingerprint)
SELECT 'view', 'public.issue_3872_order_margin',
  'CREATE OR REPLACE VIEW public.issue_3872_order_margin AS ' || pg_get_viewdef('public.issue_3872_order_margin'::regclass),
  md5(pg_get_viewdef('public.issue_3872_order_margin'::regclass));

INSERT INTO ci_issue_4490.lane_snapshot (kind, ident, ddl, fingerprint)
SELECT 'constraint', 'public.claim_links.' || c.conname,
  format('ALTER TABLE public.claim_links DROP CONSTRAINT IF EXISTS %I; ALTER TABLE public.claim_links ADD CONSTRAINT %I %s',
    c.conname, c.conname, pg_get_constraintdef(c.oid)),
  md5(pg_get_constraintdef(c.oid))
FROM pg_constraint c
WHERE c.conrelid = 'public.claim_links'::regclass AND c.conname = 'claim_links_subject_kind_check';

INSERT INTO ci_issue_4490.lane_snapshot (kind, ident, ddl, fingerprint)
SELECT 'policy', t.tbl || '.' || t.pol, pg_temp.policy_ddl(t.tbl::regclass, t.pol), md5(pg_temp.policy_ddl(t.tbl::regclass, t.pol))
FROM (VALUES
  ('public.venue_orders', 'venue orders scoped staff can read'),
  ('public.venue_order_items', 'venue order items scoped staff can read'),
  ('public.venue_order_item_modifiers', 'venue order modifiers scoped staff can read'),
  ('public.venue_order_sessions', 'venue order sessions scoped staff can read')
) AS t(tbl, pol);

DO $check$
DECLARE v_functions integer; v_total integer;
BEGIN
  SELECT count(*) FILTER (WHERE kind = 'function'), count(*) INTO v_functions, v_total FROM ci_issue_4490.lane_snapshot;
  IF v_functions < 5 OR v_total < v_functions + 6 OR EXISTS (SELECT 1 FROM ci_issue_4490.lane_snapshot WHERE ddl IS NULL) THEN
    RAISE EXCEPTION '#4490 lane snapshot incomplete: % functions, % objects', v_functions, v_total;
  END IF;
  RAISE NOTICE '#4490 lane snapshot: % objects recorded', v_total;
END
$check$;
COMMIT;
