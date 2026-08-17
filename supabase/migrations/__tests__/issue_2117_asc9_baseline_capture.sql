-- =====================================================================
-- issue #2117 — A-SC-9 BASELINE CAPTURE.
--
-- Contract: A-SC-9 as replaced by AMENDMENT 3 (#issuecomment-5310882620),
-- approved at #issuecomment-5310929665, with the two recorded reasons
-- corrected by AMENDMENT 4 (#issuecomment-5310959026).
--
-- A-SC-9 is a SET DIFFERENCE, not a count. A count is a lossy projection
-- of a set, and the loss is exactly where an unenumerated change hides:
-- a forgery containing two real defects — an unrelated allowlisted reader
-- silently LOSING the governed audience's EXECUTE (an availability
-- regression) and an allowlisted-but-unreachable object silently REGAINING
-- it (a re-exposure) — is byte-identical to a correct implementation on
-- both scalars (probe 187→184, stale 5→8) and on the forward gate.
--
-- Computing a set difference requires a genuine BEFORE snapshot. This file
-- captures it and MUST be run:
--   * AFTER every migration in timestamp order EXCEPT the #2117 migration;
--   * BEFORE the #2117 migration is applied.
-- The suite raises a distinct, explicit failure if this snapshot is absent
-- or empty, so a skipped capture can never be mistaken for a pass.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f <this file>
-- from the repository root (the \copy below is repo-root-relative).
-- =====================================================================

\set ON_ERROR_STOP on

DROP SCHEMA IF EXISTS i2117_asc9 CASCADE;
CREATE SCHEMA i2117_asc9;

-- The allowlist FILE, loaded verbatim. The stale-warning set is an
-- allowlist-versus-probe difference, so the criterion cannot be evaluated
-- from the catalog alone.
CREATE TABLE i2117_asc9.allowlist_raw(line text);
\copy i2117_asc9.allowlist_raw(line) FROM 'supabase/security/anon_executable_definer_allowlist.txt'

-- Same normalisation the shipped gate applies: drop # comments and blank
-- lines, strip trailing whitespace.
CREATE VIEW i2117_asc9.allowlist AS
  SELECT regexp_replace(line, '[[:space:]]*$', '') AS sig
  FROM i2117_asc9.allowlist_raw
  WHERE line !~ '^[[:space:]]*#' AND line !~ '^[[:space:]]*$';

-- The shipped gate's own probe expression, verbatim in substance: every
-- non-trigger SECURITY DEFINER function in public that the unauthenticated
-- role may EXECUTE, identified by its identity signature.
CREATE VIEW i2117_asc9.probe_now AS
  SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosecdef
    AND n.nspname = 'public'
    AND p.prorettype <> 'pg_catalog.trigger'::regtype
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- Frozen BEFORE snapshots. Materialised, not views — they must not track
-- the schema once the #2117 migration lands.
CREATE TABLE i2117_asc9.probe_before AS SELECT sig FROM i2117_asc9.probe_now;
CREATE TABLE i2117_asc9.stale_before AS
  SELECT a.sig FROM i2117_asc9.allowlist a
  WHERE a.sig NOT IN (SELECT sig FROM i2117_asc9.probe_before);

DO $capture$
DECLARE v_probe int; v_stale int; v_allow int;
BEGIN
  SELECT count(*) INTO v_probe FROM i2117_asc9.probe_before;
  SELECT count(*) INTO v_stale FROM i2117_asc9.stale_before;
  SELECT count(*) INTO v_allow FROM i2117_asc9.allowlist;
  IF v_probe = 0 OR v_allow = 0 THEN
    RAISE EXCEPTION
      'A-SC-9 BASELINE CAPTURE FAILED: probe_before=% allowlist=%. An empty baseline would make every set difference vacuously satisfiable.',
      v_probe, v_allow;
  END IF;
  RAISE NOTICE 'A-SC-9 baseline captured: probe_before=%, stale_before=%, allowlist=%',
    v_probe, v_stale, v_allow;
END $capture$;
