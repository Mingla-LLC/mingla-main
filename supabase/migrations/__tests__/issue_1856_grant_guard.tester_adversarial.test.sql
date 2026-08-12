-- Issue #1856 — independent tester adversarial regression guard.
--
-- This is intentionally a different angle from the implementor suite. Rather
-- than trusting pg_relation_is_updatable() classification alone, it executes
-- the dangerous operation through a real owner-executed view over a deny-all
-- RLS table. The anonymous insert MUST succeed while security_invoker is off
-- (proving the bypass is real), and MUST fail after the same view is changed
-- to security_invoker (proving the classifier's severity boundary is real).
--
-- It also pins two independent security boundaries the implementation suite
-- does not exercise as a caller:
--   * the catalog audit is executable by service_role only; and
--   * the shipped ordering ACL and repaired-view ACL are clean before any
--     adversarial fixture is planted.

BEGIN;

DO $preflight$
DECLARE
  v_bad text;
BEGIN
  IF to_regprocedure('public.audit_overbroad_table_grants()') IS NULL THEN
    RAISE EXCEPTION
      'T-1856-01: audit_overbroad_table_grants() is absent — #1856 migration did not apply';
  END IF;

  SELECT string_agg(
           relation_name || ':' || grantee || ':' || privilege_type,
           ', ' ORDER BY relation_name, grantee, privilege_type)
    INTO v_bad
  FROM public.audit_overbroad_table_grants()
  WHERE NOT is_baselined;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'T-1856-02: clean schema already has new offenders: %', v_bad;
  END IF;
END $preflight$;

-- The diagnostic surface contains the entire live grant backlog. It must not
-- become a public introspection RPC merely because it lives in schema public.
DO $execute_boundary$
DECLARE
  v_state text;
BEGIN
  IF has_function_privilege('anon', 'public.audit_overbroad_table_grants()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.audit_overbroad_table_grants()', 'EXECUTE') THEN
    RAISE EXCEPTION 'T-1856-03: anon/authenticated can execute the catalog audit';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.audit_overbroad_table_grants()', 'EXECUTE') THEN
    RAISE EXCEPTION 'T-1856-04: service_role cannot execute the catalog audit';
  END IF;

  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM * FROM public.audit_overbroad_table_grants();
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
    RESET ROLE;
  END;

  IF v_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION
      'T-1856-05: real authenticated audit call did not fail closed with 42501 (saw %)',
      coalesce(v_state, '<success>');
  END IF;
END $execute_boundary$;

-- Independent exact end-state check. This reads effective privileges rather
-- than matching any REVOKE/GRANT source text.
DO $shipped_acl$
DECLARE
  v_table text;
  v_view  text;
  v_priv  text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'qr_spots', 'menu_modifier_groups', 'menu_modifiers',
    'venue_ordering_settings'
  ] LOOP
    FOREACH v_priv IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] LOOP
      IF has_table_privilege('anon', 'public.' || v_table, v_priv)
         OR has_table_privilege('authenticated', 'public.' || v_table, v_priv) THEN
        RAISE EXCEPTION
          'T-1856-06: dangerous effective privilege % remains on public.%',
          v_priv, v_table;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH v_view IN ARRAY ARRAY[
    'business_public_brands_view', 'business_public_events_view',
    'claimed_venues_public_view', 'public_menus_view', 'venue_public_view',
    'ad_public_stay_destinations_view', 'brands_public_view',
    'events_public_view', 'events_with_master_date_view',
    'organisers_public_view', 'profiles_with_segment',
    'venue_claim_active_feedback', 'business_management_events_view'
  ] LOOP
    FOREACH v_priv IN ARRAY ARRAY[
      'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
    ] LOOP
      IF has_table_privilege('anon', 'public.' || v_view, v_priv)
         OR has_table_privilege('authenticated', 'public.' || v_view, v_priv) THEN
        RAISE EXCEPTION
          'T-1856-07: repaired view public.% still carries %', v_view, v_priv;
      END IF;
    END LOOP;
  END LOOP;
END $shipped_acl$;

-- A real RLS-bypass experiment. The base table has RLS enabled, grants INSERT
-- to anon, and deliberately has NO INSERT policy. Direct/invoker writes must
-- therefore fail. The first view executes as owner postgres, however, and the
-- owner is not subject to ordinary (non-FORCE) RLS: that write really lands.
CREATE TABLE public.issue_1856_tester_rls_target (
  id integer PRIMARY KEY,
  payload text NOT NULL
);
ALTER TABLE public.issue_1856_tester_rls_target ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.issue_1856_tester_rls_target FROM PUBLIC, anon, authenticated;
GRANT INSERT ON public.issue_1856_tester_rls_target TO anon;

CREATE VIEW public.issue_1856_tester_owner_view AS
  SELECT id, payload FROM public.issue_1856_tester_rls_target;
REVOKE ALL ON public.issue_1856_tester_owner_view FROM PUBLIC, anon, authenticated;
GRANT INSERT ON public.issue_1856_tester_owner_view TO anon;

SET LOCAL ROLE anon;
INSERT INTO public.issue_1856_tester_owner_view (id, payload)
VALUES (1, 'owner-view-bypassed-rls');
RESET ROLE;

DO $owner_view_proof$
DECLARE
  v_class text;
  v_baselined boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.issue_1856_tester_rls_target
    WHERE id = 1 AND payload = 'owner-view-bypassed-rls'
  ) THEN
    RAISE EXCEPTION
      'T-1856-08: owner-executed view did not reproduce the real RLS bypass';
  END IF;

  SELECT finding_class, is_baselined
    INTO v_class, v_baselined
  FROM public.audit_overbroad_table_grants()
  WHERE relation_name = 'issue_1856_tester_owner_view'
    AND grantee = 'anon'
    AND privilege_type = 'INSERT';

  IF v_class IS DISTINCT FROM 'rls_bypass_view_write' OR v_baselined IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'T-1856-09: live bypass was not a non-baseline rls_bypass_view_write (% / %)',
      coalesce(v_class, '<missing>'), coalesce(v_baselined::text, '<missing>');
  END IF;
END $owner_view_proof$;

-- Same relation, same anon INSERT, one semantic change. With invoker security,
-- the write reaches the base table as anon and its deny-all RLS must refuse it.
ALTER VIEW public.issue_1856_tester_owner_view SET (security_invoker = true);

DO $invoker_view_proof$
DECLARE
  v_state text;
  v_class text;
BEGIN
  BEGIN
    SET LOCAL ROLE anon;
    INSERT INTO public.issue_1856_tester_owner_view (id, payload)
    VALUES (2, 'must-not-land');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
    RESET ROLE;
  END;

  IF v_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION
      'T-1856-10: security_invoker twin did not fail through RLS with 42501 (saw %)',
      coalesce(v_state, '<success>');
  END IF;
  IF EXISTS (SELECT 1 FROM public.issue_1856_tester_rls_target WHERE id = 2) THEN
    RAISE EXCEPTION 'T-1856-11: denied invoker write still reached the base table';
  END IF;

  SELECT finding_class INTO v_class
  FROM public.audit_overbroad_table_grants()
  WHERE relation_name = 'issue_1856_tester_owner_view'
    AND grantee = 'anon'
    AND privilege_type = 'INSERT';

  IF v_class IS DISTINCT FROM 'overbroad_grant' THEN
    RAISE EXCEPTION
      'T-1856-12: security_invoker twin should remain visible as overbroad_grant, saw %',
      coalesce(v_class, '<missing>');
  END IF;
END $invoker_view_proof$;

DROP VIEW public.issue_1856_tester_owner_view;
DROP TABLE public.issue_1856_tester_rls_target;

DO $restore_proof$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(
           relation_name || ':' || grantee || ':' || privilege_type,
           ', ' ORDER BY relation_name, grantee, privilege_type)
    INTO v_bad
  FROM public.audit_overbroad_table_grants()
  WHERE NOT is_baselined;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'T-1856-13: adversarial cleanup did not restore clean state: %', v_bad;
  END IF;
END $restore_proof$;

ROLLBACK;
