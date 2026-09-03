-- =====================================================================================
-- Issue #3081 — the #2489 gate registry survives a replay. IMPLEMENTOR HAPPY PATH.
--
-- WHY THIS EXISTS. `public.issue_2489_gate_registry()` was a hardcoded VALUES list that
-- two migrations re-emitted: nine entries in #2489, ten in #2986. #2489 also carries the
-- apply-time set-equality check. Re-applying #2489 therefore REWOUND the declared set to
-- nine and then compared it against a catalog that still held #2986's
-- `public_search_source_facts`, and raised. That is what turned main red on 2026-09-02
-- and blocked every merge in the repository.
--
-- The registry is now APPEND-ONLY DATA (`public.issue_2489_gate_carriers`). A
-- CREATE OR REPLACE can revert code; nothing reverts a row.
--
-- WHAT RUNS BEFORE THIS FILE. The workflow step that registers this fixture has already
-- re-applied #2489 ALONE onto the fully replayed schema — the exact partial re-apply
-- `#2333`'s replay-safety step performs, and the exact one that raised. Reaching this
-- file at all is therefore already the headline assertion; everything below pins that
-- the state it arrived in is the RIGHT state rather than merely a surviving one. A check
-- that only proved "no exception" would stay green against a registry that had been
-- silently emptied, which is the failure mode this repository keeps finding.
--
-- NOT "the whole chain twice": that operation fails on 130 unrelated migrations in this
-- tree and always has. The mid-chain re-apply below is what the repository actually does.
--
-- BEHAVIORAL, not textual: every assertion reads the applied catalog or the live table.
-- No assertion is satisfied by source text. Nothing here writes durable state.
-- =====================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- =====================================================================================
-- G-1 — THE DECLARED SET IS DATA, AND IT IS LOCKED DOWN.
--
-- A registry held in a table is only an improvement if the table cannot be rewritten by
-- a caller. New tables in `public` inherit anon/authenticated grants by default
-- privilege, so this asserts the revoke and the RLS switch rather than trusting them.
-- =====================================================================================
DO $g1$
DECLARE
  v_rls boolean;
  v_anon_write text;
BEGIN
  SELECT c.relrowsecurity INTO v_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'issue_2489_gate_carriers';

  IF v_rls IS NULL THEN
    RAISE EXCEPTION 'G-1: public.issue_2489_gate_carriers does not exist — the declared set is not data, so #3081 is not applied';
  END IF;
  IF NOT v_rls THEN
    RAISE EXCEPTION 'G-1: the carriers table exists but RLS is OFF';
  END IF;

  SELECT string_agg(priv, ',' ORDER BY priv) INTO v_anon_write
  FROM (
    SELECT p.priv
    FROM unnest(ARRAY['INSERT','UPDATE','DELETE','SELECT']) AS p(priv),
         unnest(ARRAY['anon','authenticated']) AS r(role_name)
    WHERE has_table_privilege(r.role_name, 'public.issue_2489_gate_carriers', p.priv)
  ) q;

  IF v_anon_write IS NOT NULL THEN
    RAISE EXCEPTION 'G-1: anon/authenticated hold table privileges on the gate registry: %', v_anon_write;
  END IF;

  RAISE NOTICE 'G-1 PASS — the declared set is a locked-down table';
END $g1$;

-- =====================================================================================
-- G-2 — AFTER A SECOND FULL-CHAIN APPLY AND A LONE #2489 RE-APPLY, ALL TEN CARRIERS
--       ARE STILL DECLARED.
--
-- This is the assertion the bug would have failed. Set equality against a literal list,
-- in BOTH directions — never a count, which cannot see one name being swapped for
-- another. `public_search_source_facts` is #2986's entry: the one the rewind dropped.
-- =====================================================================================
DO $g2$
DECLARE
  v_expected text[] := ARRAY[
    'business_public_events_view',
    'events_public_view',
    'issue_2489_public_theme',
    'pg_direct_event_checkout_bundle',
    'pg_discover_business_events',
    'pg_public_brand_upcoming',
    'pg_public_event_by_slug',
    'pg_public_experience_by_slug',
    'pg_public_rsvp_by_slug',
    'public_search_source_facts'
  ];
  v_declared text[];
  v_lost     text[];
  v_extra    text[];
BEGIN
  SELECT array_agg(object_name ORDER BY object_name) INTO v_declared
  FROM public.issue_2489_gate_registry();

  IF v_declared IS NULL OR cardinality(v_declared) = 0 THEN
    RAISE EXCEPTION 'G-2 is vacuous: the registry declared nothing after the replay';
  END IF;

  SELECT array_agg(x ORDER BY x) INTO v_lost
  FROM unnest(v_expected) x WHERE x <> ALL (v_declared);
  SELECT array_agg(x ORDER BY x) INTO v_extra
  FROM unnest(v_declared) x WHERE x <> ALL (v_expected);

  IF v_lost IS NOT NULL THEN
    RAISE EXCEPTION 'G-2: the replay LOST declared carriers — an older migration reverted a newer one''s extension: %',
      array_to_string(v_lost, ', ');
  END IF;
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'G-2: the registry declares objects this fixture does not know about; update the expected list deliberately: %',
      array_to_string(v_extra, ', ');
  END IF;

  RAISE NOTICE 'G-2 PASS — all ten carriers survived the replay';
END $g2$;

-- =====================================================================================
-- G-3 — THE DECLARED SET STILL EQUALS WHAT THE CATALOG ACTUALLY CARRIES.
--
-- G-2 proves the registry kept its rows. It does not prove those rows still describe
-- reality: a registry frozen at ten while the schema drifted underneath would satisfy
-- G-2 and be worthless. This is the same both-directions equality #2489 asserts at apply
-- time, re-run here on the twice-applied schema, so "the check passes" is proven by
-- EXECUTING it rather than by the absence of an error earlier in the job.
-- =====================================================================================
DO $g3$
DECLARE
  v_declared   text[];
  v_found      text[];
  v_missing    text[];
  v_undeclared text[];
BEGIN
  SELECT array_agg(object_name ORDER BY object_name) INTO v_declared
  FROM public.issue_2489_gate_registry();

  SELECT array_agg(name ORDER BY name) INTO v_found FROM (
    SELECT p.proname::text AS name
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname <> 'issue_2489_address_withheld'
      AND p.proname <> 'issue_2489_gate_registry'
      AND (p.prosrc LIKE '%issue_2489_address_withheld%' OR p.prosrc LIKE '%issue_2489_public_theme%')
    UNION
    SELECT c.relname::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
      AND (pg_get_viewdef(c.oid) LIKE '%issue_2489_address_withheld%'
        OR pg_get_viewdef(c.oid) LIKE '%issue_2489_public_theme%')
  ) q;

  SELECT array_agg(x ORDER BY x) INTO v_missing
  FROM unnest(v_declared) x WHERE x <> ALL (COALESCE(v_found, ARRAY[]::text[]));
  SELECT array_agg(x ORDER BY x) INTO v_undeclared
  FROM unnest(COALESCE(v_found, ARRAY[]::text[])) x WHERE x <> ALL (v_declared);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'G-3: a declared object no longer carries the shared gate: %',
      array_to_string(v_missing, ', ');
  END IF;
  IF v_undeclared IS NOT NULL THEN
    RAISE EXCEPTION 'G-3: an undeclared object carries the shared gate: %',
      array_to_string(v_undeclared, ', ');
  END IF;

  RAISE NOTICE 'G-3 PASS — declared and actual carriers are the same set, both directions';
END $g3$;

-- =====================================================================================
-- NC-1 — THE NEGATIVE CONTROL.
--
-- G-1..G-3 are green. That is only evidence if this file can go RED for the reason it
-- claims to watch. So this stages the ACTUAL defect inside a savepoint — an older
-- migration reverting the declared set to its pre-#2986 nine — and REQUIRES G-3's
-- equality to catch it, naming the carrier that was dropped. If the rewind goes
-- undetected the fixture fails HERE, because a green tick from a suite that cannot see
-- the shipped bug is worse than no suite: it vouches for the bug.
-- =====================================================================================
DO $nc1$
DECLARE
  v_declared   text[];
  v_found      text[];
  v_undeclared text[];
  v_caught     boolean := false;
BEGIN
  -- Stage the rewind exactly as the pre-fix CREATE OR REPLACE did: drop #2986's entry.
  DELETE FROM public.issue_2489_gate_carriers WHERE object_name = 'public_search_source_facts';

  SELECT array_agg(object_name ORDER BY object_name) INTO v_declared
  FROM public.issue_2489_gate_registry();

  SELECT array_agg(name ORDER BY name) INTO v_found FROM (
    SELECT p.proname::text AS name
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname <> 'issue_2489_address_withheld'
      AND p.proname <> 'issue_2489_gate_registry'
      AND (p.prosrc LIKE '%issue_2489_address_withheld%' OR p.prosrc LIKE '%issue_2489_public_theme%')
    UNION
    SELECT c.relname::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
      AND (pg_get_viewdef(c.oid) LIKE '%issue_2489_address_withheld%'
        OR pg_get_viewdef(c.oid) LIKE '%issue_2489_public_theme%')
  ) q;

  SELECT array_agg(x ORDER BY x) INTO v_undeclared
  FROM unnest(COALESCE(v_found, ARRAY[]::text[])) x WHERE x <> ALL (v_declared);

  v_caught := v_undeclared IS NOT NULL
          AND 'public_search_source_facts' = ANY (v_undeclared);

  IF NOT v_caught THEN
    RAISE EXCEPTION 'NC-1: the registry was rewound to its pre-#2986 set and the equality did NOT catch it — every assertion above is blind';
  END IF;

  -- Put it back. The outer ROLLBACK would too; this makes the restoration explicit so a
  -- later reader cannot mistake the staged rewind for shipped state.
  INSERT INTO public.issue_2489_gate_carriers (object_name, object_kind)
  VALUES ('public_search_source_facts', 'function')
  ON CONFLICT (object_name) DO NOTHING;

  RAISE NOTICE 'NC-1 PASS — the equality catches a rewound registry, naming %',
    array_to_string(v_undeclared, ', ');
END $nc1$;

ROLLBACK;
