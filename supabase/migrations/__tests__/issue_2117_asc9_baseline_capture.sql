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

-- The probe. This covers BOTH roles in the governed audience -- the
-- unauthenticated caller AND the signed-in stranger -- not just the first.
--
-- WHY BOTH, AND WHY THE BASELINE TOO. This issue governs "an unauthenticated
-- caller AND a signed-in stranger" everywhere else: SC-5, A-SC-14 and the
-- gap itself are all stated over both. A probe scoped to one of them cannot
-- see an arrival in the other half, and that half is where the worst
-- re-exposure lives -- a dormant allowlisted STATE-MUTATING definer silently
-- regaining signed-in access is invisible to an anon-only probe while the
-- scalars and the shipped forward gate stay identical to a correct run.
--
-- The BASELINE is widened with it, deliberately. Widening the probe against
-- a narrow baseline does not close the hole, it MOVES it: every signature
-- that is authenticated-executable but not anon-executable would show up as
-- a spurious arrival on the first run and, once accommodated, as a permanent
-- blind spot. The before and after sets must be taken over the same
-- predicate or the difference between them means nothing.
--
-- The shipped forward gate remains anon-scoped -- that is its contract and
-- clause (e) asserts it unchanged. This probe is deliberately WIDER than the
-- gate, because (a), (b) and (d) are about the governed AUDIENCE, not about
-- reproducing the gate.
-- Membership is tracked PER ROLE -- (role, signature) pairs, not a union of
-- signatures. A union is wide enough to see an object ARRIVING in either
-- half, but blind to one LEAVING a single half: a public reader that loses
-- signed-in access while keeping anonymous access is still in the union, so
-- it never registers as a departure, and that is an availability regression
-- for every logged-in buyer. Pairs catch both directions in both halves.
CREATE VIEW i2117_asc9.probe_now AS
  SELECT r.role_name, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
  WHERE p.prosecdef
    AND n.nspname = 'public'
    AND p.prorettype <> 'pg_catalog.trigger'::regtype
    AND has_function_privilege(r.role_name, p.oid, 'EXECUTE');

-- The shipped gate's own anon-scoped probe, kept separately so clause (e)
-- reproduces the gate exactly rather than the widened audience.
CREATE VIEW i2117_asc9.probe_now_anon AS
  SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosecdef
    AND n.nspname = 'public'
    AND p.prorettype <> 'pg_catalog.trigger'::regtype
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- Frozen BEFORE snapshots. Materialised, not views — they must not track
-- the schema once the #2117 migration lands. Both are captured over the
-- SAME predicate as their AFTER counterparts; see the note above on why the
-- baseline is widened together with the probe.
CREATE TABLE i2117_asc9.probe_before      AS SELECT role_name, sig FROM i2117_asc9.probe_now;
CREATE TABLE i2117_asc9.probe_before_anon AS SELECT sig FROM i2117_asc9.probe_now_anon;

-- The stale-warning set is the shipped gate's own notion, so it is taken
-- against the ANON-scoped probe -- that is what the gate prints.
CREATE TABLE i2117_asc9.stale_before AS
  SELECT a.sig FROM i2117_asc9.allowlist a
  WHERE a.sig NOT IN (SELECT sig FROM i2117_asc9.probe_before_anon);

DO $capture$
DECLARE v_probe int; v_stale int; v_allow int; v_anon int; v_extra int;
BEGIN
  SELECT count(*) INTO v_probe FROM i2117_asc9.probe_before;
  SELECT count(*) INTO v_stale FROM i2117_asc9.stale_before;
  SELECT count(*) INTO v_allow FROM i2117_asc9.allowlist;
  SELECT count(*) INTO v_anon  FROM i2117_asc9.probe_before_anon;
  IF v_probe = 0 OR v_allow = 0 THEN
    RAISE EXCEPTION
      'A-SC-9 BASELINE CAPTURE FAILED: probe_before=% allowlist=%. An empty baseline would make every set difference vacuously satisfiable.',
      v_probe, v_allow;
  END IF;
  -- The widened probe must be a superset of the anon-scoped one, or the two
  -- predicates have drifted apart and the difference between them is noise.
  SELECT count(*) INTO v_extra
  FROM (SELECT sig FROM i2117_asc9.probe_before_anon
        EXCEPT SELECT sig FROM i2117_asc9.probe_before WHERE role_name='anon') x;
  IF v_extra <> 0 THEN
    RAISE EXCEPTION
      'A-SC-9 BASELINE CAPTURE FAILED: the anon-scoped baseline is not contained in the governed-audience baseline (% stragglers).',
      v_extra;
  END IF;
  RAISE NOTICE 'A-SC-9 baseline captured: governed-audience (role,sig) pairs=%, anon-only sigs=%, stale_before=%, allowlist=%',
    v_probe, v_anon, v_stale, v_allow;
END $capture$;
