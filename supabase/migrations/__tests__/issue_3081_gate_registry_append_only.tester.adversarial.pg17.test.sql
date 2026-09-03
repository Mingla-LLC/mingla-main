-- =====================================================================================
-- Issue #3081 — TESTER ADVERSARIAL. The declared set is APPEND-ONLY, it is a LIVE
-- reader, and it must not have become readable by the public in the process.
--
-- DIFFERENT ANGLE, DELIBERATELY. The implementor's happy-path fixture
-- (`issue_3081_gate_registry_replay.implementor.happy.test.sql`) asserts the END STATE
-- after one specific replay: RLS is on, anon/authenticated hold no TABLE privileges,
-- the declared set equals a literal ten, and the set still equals the catalog. Its
-- negative control stages the shipped defect in ONE direction — DELETING #2986's entry
-- — and requires the equality to catch it.
--
-- Four things that fixture cannot see, and that this file attacks instead:
--
--   A-1  It only ever REMOVES from the declared set. Nothing proves the registry GROWS
--        when a row is added, which is the direction the entire fix exists to protect.
--   A-2  It never asserts the function's VOLATILITY. `IMMUTABLE` on a function that
--        reads a table is not a style nit: the planner is entitled to constant-fold and
--        inline it, so the pre-#3081 declaration would let a stale carrier set survive
--        inside a cached plan. A revert restores `IMMUTABLE` and the fixture stays green.
--   A-3  It proves the set survived ONE replay order. It never replays the shipped seed
--        statements themselves against a set that has since grown — which is the exact
--        operation a future migration's eleventh carrier has to survive, and the exact
--        claim #3081 makes ("immune without knowing this issue exists"). The workflow
--        step tests that, but a workflow step is not append-only and can be edited away;
--        this pins it in a test file.
--   A-4  It asserts anon/authenticated hold no TABLE privileges. It never asserts they
--        cannot reach the same rows THROUGH the function they still hold EXECUTE on.
--        The obvious "tidy-up" for the permission-denied that EXECUTE now produces is to
--        mark the registry SECURITY DEFINER — which would silently publish the complete
--        map of address-privacy gate carriers to every anonymous caller. That is a
--        privacy regression the happy-path fixture would applaud.
--
--   A-5  The apply-time equality has TWO catalog arms — functions and VIEWS. Every
--        staged carrier anywhere in this issue's suites is a FUNCTION, so the `relkind
--        = 'v'` arm has never once been exercised. Two of the ten declared carriers are
--        views.
--
-- BEHAVIORAL, NOT TEXTUAL. Every assertion reads the applied catalog or executes the
-- live function. Nothing here is satisfied by matching source text (#2113).
--
-- DURABLE STATE: none. The whole file is one transaction and ends in ROLLBACK.
-- =====================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- =====================================================================================
-- A-1 — THE REGISTRY IS A LIVE READER, IN THE APPEND DIRECTION.
--
-- A hardcoded VALUES list satisfies every "the ten are still there" assertion forever.
-- It cannot satisfy this one: add a name nobody has ever declared, and the function's
-- own output must change in the same transaction. This is the property that makes the
-- set append-only, asserted in the direction the fix is for.
-- =====================================================================================
DO $a1$
DECLARE
  v_before int;
  v_after  int;
  v_seen   boolean;
BEGIN
  SELECT count(*) INTO v_before FROM public.issue_2489_gate_registry();
  IF v_before = 0 THEN
    RAISE EXCEPTION 'A-1 is vacuous: the registry declared nothing before the probe';
  END IF;

  INSERT INTO public.issue_2489_gate_carriers (object_name, object_kind)
  VALUES ('orch3081_adversarial_appended', 'function')
  ON CONFLICT (object_name) DO NOTHING;

  SELECT count(*) INTO v_after FROM public.issue_2489_gate_registry();
  SELECT EXISTS (
    SELECT 1 FROM public.issue_2489_gate_registry()
    WHERE object_name = 'orch3081_adversarial_appended'
  ) INTO v_seen;

  IF NOT v_seen OR v_after <> v_before + 1 THEN
    RAISE EXCEPTION
      'A-1: a row was appended to public.issue_2489_gate_carriers and the registry did NOT grow (% -> %). '
      'The registry is not reading the table — it is a hardcoded list again, and the append-only property is gone',
      v_before, v_after;
  END IF;

  DELETE FROM public.issue_2489_gate_carriers WHERE object_name = 'orch3081_adversarial_appended';
  RAISE NOTICE 'A-1 PASS — the registry grew with the table (% -> %)', v_before, v_after;
END $a1$;

-- =====================================================================================
-- A-2 — VOLATILITY MUST BE STABLE, NEVER IMMUTABLE.
--
-- The pre-#3081 registry was IMMUTABLE, which was honest while it was a VALUES list and
-- becomes a lie to the planner the moment it reads a table. Reverting #3081 restores
-- IMMUTABLE. Nothing else in this issue's suites looks at pg_proc.provolatile.
-- =====================================================================================
DO $a2$
DECLARE
  v_vol "char";
  v_secdef boolean;
BEGIN
  SELECT p.provolatile, p.prosecdef INTO v_vol, v_secdef
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'issue_2489_gate_registry';

  IF v_vol IS NULL THEN
    RAISE EXCEPTION 'A-2: public.issue_2489_gate_registry() does not exist';
  END IF;
  IF v_vol <> 's' THEN
    RAISE EXCEPTION
      'A-2: the registry reads a table but is declared volatility "%" (expected "s"/STABLE). '
      'IMMUTABLE lets the planner constant-fold and inline it, so a cached plan can keep '
      'declaring a carrier set the table no longer holds', v_vol;
  END IF;
  IF v_secdef THEN
    RAISE EXCEPTION
      'A-2: the registry is SECURITY DEFINER. It holds EXECUTE for anon and authenticated, '
      'so definer rights would publish the full address-privacy carrier map to anonymous callers';
  END IF;

  RAISE NOTICE 'A-2 PASS — registry is STABLE and SECURITY INVOKER';
END $a2$;

-- =====================================================================================
-- A-3 — THE ELEVENTH CARRIER SURVIVES A REPLAY OF THE SHIPPED SEED STATEMENTS.
--
-- The claim #3081 makes is that a future migration adds a carrier with one INSERT and is
-- immune, without knowing this issue exists. So: stage that eleventh carrier, then replay
-- BOTH shipped seeds verbatim — #2489's nine-row list (the one whose CREATE OR REPLACE
-- reverted the set and reddened main) and #3081's ten-row list — and require the eleventh
-- to still stand afterwards. Under the old design the equivalent operation discarded it.
-- =====================================================================================
DO $a3$
DECLARE
  v_declared text[];
  v_n        int;
BEGIN
  INSERT INTO public.issue_2489_gate_carriers (object_name, object_kind)
  VALUES ('orch3081_eleventh_carrier', 'function')
  ON CONFLICT (object_name) DO NOTHING;

  -- Verbatim replay of #2489's seed — the older file, re-applied after the newer one.
  INSERT INTO public.issue_2489_gate_carriers (object_name, object_kind) VALUES
    ('issue_2489_public_theme',          'function'),
    ('business_public_events_view',      'view'),
    ('events_public_view',               'view'),
    ('pg_discover_business_events',      'function'),
    ('pg_public_brand_upcoming',         'function'),
    ('pg_public_event_by_slug',          'function'),
    ('pg_public_rsvp_by_slug',           'function'),
    ('pg_public_experience_by_slug',     'function'),
    ('pg_direct_event_checkout_bundle',  'function')
  ON CONFLICT (object_name) DO NOTHING;

  -- Verbatim replay of #3081's seed.
  INSERT INTO public.issue_2489_gate_carriers (object_name, object_kind) VALUES
    ('issue_2489_public_theme',          'function'),
    ('business_public_events_view',      'view'),
    ('events_public_view',               'view'),
    ('pg_discover_business_events',      'function'),
    ('pg_public_brand_upcoming',         'function'),
    ('pg_public_event_by_slug',          'function'),
    ('pg_public_rsvp_by_slug',           'function'),
    ('pg_public_experience_by_slug',     'function'),
    ('pg_direct_event_checkout_bundle',  'function'),
    ('public_search_source_facts',       'function')
  ON CONFLICT (object_name) DO NOTHING;

  SELECT array_agg(object_name ORDER BY object_name), count(*)
    INTO v_declared, v_n
  FROM public.issue_2489_gate_registry();

  IF NOT ('orch3081_eleventh_carrier' = ANY (v_declared)) THEN
    RAISE EXCEPTION
      'A-3: replaying the shipped seed statements DISCARDED a later migration''s carrier. '
      'The declared set is not append-only and the #3081 replay trap is still armed';
  END IF;
  IF NOT ('public_search_source_facts' = ANY (v_declared)) THEN
    RAISE EXCEPTION 'A-3: replaying #2489''s nine-row seed rewound #2986''s entry — the original defect';
  END IF;
  IF v_n <> 11 THEN
    RAISE EXCEPTION 'A-3: expected 11 declared carriers after the staged eleventh, found %', v_n;
  END IF;

  DELETE FROM public.issue_2489_gate_carriers WHERE object_name = 'orch3081_eleventh_carrier';
  RAISE NOTICE 'A-3 PASS — an eleventh carrier survives a verbatim replay of both shipped seeds';
END $a3$;

-- =====================================================================================
-- A-4 — THE CARRIER MAP MUST NOT LEAK THROUGH THE FUNCTION.
--
-- anon and authenticated keep EXECUTE on the registry. The table is revoked from them and
-- carries RLS, so the call must FAIL for them rather than return the set. If a later
-- change "fixes" that error by marking the function SECURITY DEFINER or by granting
-- SELECT on the table, this is the assertion that notices — the happy-path fixture checks
-- table privileges only and would stay green while the map became public.
-- =====================================================================================
DO $a4$
DECLARE
  v_role   text;
  v_denied boolean;
  v_n      int;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    v_denied := false;
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    BEGIN
      SELECT count(*) INTO v_n FROM public.issue_2489_gate_registry();
    EXCEPTION WHEN insufficient_privilege THEN
      v_denied := true;
    END;
    RESET ROLE;

    IF NOT v_denied THEN
      RAISE EXCEPTION
        'A-4: role % read % rows of the address-privacy carrier map through '
        'issue_2489_gate_registry(). The complete list of gated objects is now public',
        v_role, v_n;
    END IF;
  END LOOP;

  RAISE NOTICE 'A-4 PASS — anon and authenticated are denied the carrier map through the function';
END $a4$;

-- =====================================================================================
-- A-5 — THE EQUALITY'S VIEW ARM ACTUALLY FIRES.
--
-- The apply-time check UNIONs pg_proc with pg_class WHERE relkind = 'v'. Two of the ten
-- declared carriers are views, but every carrier STAGED by this issue's suites — the
-- implementor's NC-1, the workflow's probe — is a function, so the view arm has never
-- been shown to detect anything. Stage an undeclared VIEW that carries the gate and
-- require the same both-directions equality to name it.
-- =====================================================================================
DO $a5$
DECLARE
  v_declared   text[];
  v_found      text[];
  v_undeclared text[];
BEGIN
  CREATE VIEW public.orch3081_adversarial_gate_view AS
    SELECT public.issue_2489_address_withheld('{}'::jsonb) AS withheld;

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

  IF v_undeclared IS NULL
     OR NOT ('orch3081_adversarial_gate_view' = ANY (v_undeclared)) THEN
    RAISE EXCEPTION
      'A-5: an undeclared VIEW carrying the address-privacy gate was NOT detected. '
      'The view arm of the equality is blind, so a gate spreading into a view goes unreported';
  END IF;

  DROP VIEW public.orch3081_adversarial_gate_view;
  RAISE NOTICE 'A-5 PASS — the view arm names an undeclared gate-carrying view';
END $a5$;

ROLLBACK;
