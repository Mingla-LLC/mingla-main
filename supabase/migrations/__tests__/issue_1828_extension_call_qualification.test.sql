-- ===========================================================================
-- Issue #1828 — THE CLASS GUARD.
--
-- #1828 was not three bugs. It was one bug class with three instances:
--
--   a function in `public` calls a routine that lives ONLY in `extensions`
--   without the `extensions.` qualifier, while its own search_path does not
--   guarantee `extensions`.
--
-- On production that exposure covers 79 routine names, not one — digest,
-- crypt, hmac, gen_salt, gen_random_bytes, the uuid_generate_* family,
-- unaccent, similarity, show_trgm, word_similarity, the pgp_* family,
-- encrypt/decrypt, armor/dearmor, url_encode/url_decode, verify,
-- algorithm_sign. Any one of them, written unqualified in a function whose
-- pinned path is `public, pg_temp`, is the SAME production outage: the
-- statement cannot pass parse-analysis, and the feature dies 42883 at run
-- time while every source-text test stays green.
--
-- WHY A CATALOG PROBE AND NOT A STRICT-GREP
--
-- A grep over supabase/migrations/*.sql is the wrong instrument for this
-- class, and #1828 is the proof:
--
--   1. LAST-WRITER. A function is redefined by CREATE OR REPLACE across many
--      migrations. Text matching sees every historical definition, including
--      ones that were superseded years ago; only pg_proc knows which body is
--      actually installed. A grep is therefore simultaneously too loud (old,
--      already-replaced text) and too quiet (it cannot tell which one wins).
--   2. THE ROUTINE SET IS NOT KNOWABLE FROM TEXT. Which names are
--      `extensions`-only depends on which extensions are installed and into
--      which schema. `sign(` and `gen_random_uuid(` look identical to
--      `digest(` in source but resolve fine, because pg_catalog carries a
--      same-named sibling. The probe derives the set from the live catalog and
--      gets that distinction right for free; a hard-coded grep list gets it
--      wrong the day an extension moves.
--   3. IT SEES WHAT NEVER WENT THROUGH A MIGRATION FILE. Anything hot-patched
--      straight onto the database is invisible to a repo scan and visible
--      here.
--   4. IT CANNOT BE EVADED BY FORMATTING — a call split across a line break,
--      or written with unusual whitespace, still lands in prosrc normalised by
--      the parser.
--
-- The probe ships as `public.audit_unqualified_extension_calls()` in
-- 20270318001828_issue_1828_qualify_digest_under_pinned_search_path.sql, so the
-- SAME check that gates CI is runnable, read-only, against production:
--
--   SELECT * FROM public.audit_unqualified_extension_calls();   -- must be empty
--
-- This file is the hard gate. The migration's own self-check only WARNs, so
-- that an unrelated pre-existing offender can never abort an apply and leave
-- guest cancellation broken on production.
--
-- Runs inside ONE transaction and ROLLBACKs.
-- ===========================================================================
\set ON_ERROR_STOP on
BEGIN;

-- ===========================================================================
-- G-01  The applied schema is clean.
-- ===========================================================================
DO $group_g$
DECLARE v_offenders text;
BEGIN
  SELECT string_agg(
           function_signature || '  calls unqualified ' || unqualified_routine ||
           '  [search_path: ' || pinned_search_path || ']', E'\n    '
           ORDER BY function_signature, unqualified_routine)
    INTO v_offenders
  FROM public.audit_unqualified_extension_calls();

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'G-01 unqualified extensions-routine calls under a search_path that does not guarantee `extensions`:%',
      E'\n    ' || v_offenders ||
      E'\n  Fix: qualify the call as extensions.<routine>(...) — the pattern every healthy caller already uses.';
  END IF;
END $group_g$;

-- ===========================================================================
-- H  VACUITY GUARD — a check that can never fail is not a check.
--
--    Four probe functions are planted in `public`, one per corner of the rule.
--    The guard must flag EXACTLY the two that are broken and neither of the two
--    that are safe. If G-01 above only passes because the probe is blind, this
--    group says so.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_1828_probe_pinned_without_extensions(p text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- The exact #1828 shape.
  RETURN encode(digest(p, 'sha256'), 'hex');
END $$;

CREATE OR REPLACE FUNCTION public.issue_1828_probe_unpinned(p text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- No pinned path: resolution is left to whatever the caller happens to have.
  RETURN encode(digest(p, 'sha256'), 'hex');
END $$;

CREATE OR REPLACE FUNCTION public.issue_1828_probe_qualified(p text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- The fix pattern. Tight pinned path, qualified call.
  RETURN encode(extensions.digest(p, 'sha256'), 'hex');
END $$;

CREATE OR REPLACE FUNCTION public.issue_1828_probe_path_carries_extensions(p text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
BEGIN
  -- Unqualified, but the pinned path guarantees `extensions`, so it resolves.
  -- The guard must NOT flag this: it is a legitimate second way to be correct.
  RETURN encode(digest(p, 'sha256'), 'hex');
END $$;

-- A same-named sibling in pg_catalog means an unqualified call resolves no
-- matter what the path is. `gen_random_uuid` has lived in pg_catalog since
-- PG13; if the guard flagged this it would red on half the schema.
CREATE OR REPLACE FUNCTION public.issue_1828_probe_pg_catalog_sibling()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN gen_random_uuid();
END $$;

DO $group_h$
DECLARE
  v_flagged text[];
BEGIN
  SELECT coalesce(array_agg(fn ORDER BY fn), '{}')
    INTO v_flagged
  FROM (
    SELECT DISTINCT split_part(function_signature, '(', 1) AS fn
    FROM public.audit_unqualified_extension_calls()
  ) s;

  -- H-01  Both broken shapes are caught.
  IF NOT ('issue_1828_probe_pinned_without_extensions' = ANY (v_flagged)) THEN
    RAISE EXCEPTION 'H-01 the guard MISSED the pinned-path-without-extensions shape — G-01 is vacuous';
  END IF;
  IF NOT ('issue_1828_probe_unpinned' = ANY (v_flagged)) THEN
    RAISE EXCEPTION 'H-02 the guard MISSED the unpinned shape — G-01 is vacuous';
  END IF;

  -- H-03..H-05  And no safe shape is caught, or the guard is unusable noise.
  IF 'issue_1828_probe_qualified' = ANY (v_flagged) THEN
    RAISE EXCEPTION 'H-03 the guard false-flagged a correctly qualified call';
  END IF;
  IF 'issue_1828_probe_path_carries_extensions' = ANY (v_flagged) THEN
    RAISE EXCEPTION 'H-04 the guard false-flagged a call whose pinned path contains `extensions`';
  END IF;
  IF 'issue_1828_probe_pg_catalog_sibling' = ANY (v_flagged) THEN
    RAISE EXCEPTION 'H-05 the guard false-flagged a routine that also exists in pg_catalog';
  END IF;

  -- H-06  Exactly the two planted offenders and nothing else — the applied
  --       schema contributed none, which is G-01 restated from the other side.
  IF array_length(v_flagged, 1) <> 2 THEN
    RAISE EXCEPTION 'H-06 expected exactly the 2 planted offenders, got: %', v_flagged;
  END IF;
END $group_h$;

-- ===========================================================================
-- I  The broken shapes are not a theory. They actually fail at run time, and
--    the safe shapes actually work — on THIS database, with THIS pgcrypto
--    installation. Without this group the whole class could be a
--    misunderstanding of how search_path resolution works.
-- ===========================================================================
DO $group_i$
DECLARE v_state text;
BEGIN
  BEGIN
    PERFORM public.issue_1828_probe_pinned_without_extensions('x');
    v_state := '<no error>';
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  IF v_state <> '42883' THEN
    RAISE EXCEPTION 'I-01 the pinned-without-extensions shape returned % — expected 42883', v_state;
  END IF;

  -- Both safe shapes must actually produce the same hash.
  IF public.issue_1828_probe_qualified('x')
     <> public.issue_1828_probe_path_carries_extensions('x') THEN
    RAISE EXCEPTION 'I-02 the two safe shapes disagree on the hash';
  END IF;
  IF public.issue_1828_probe_qualified('x')
     <> encode(extensions.digest('x', 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'I-03 the qualified shape does not match pgcrypto''s own output';
  END IF;
END $group_i$;

DROP FUNCTION public.issue_1828_probe_pinned_without_extensions(text);
DROP FUNCTION public.issue_1828_probe_unpinned(text);
DROP FUNCTION public.issue_1828_probe_qualified(text);
DROP FUNCTION public.issue_1828_probe_path_carries_extensions(text);
DROP FUNCTION public.issue_1828_probe_pg_catalog_sibling();

ROLLBACK;
