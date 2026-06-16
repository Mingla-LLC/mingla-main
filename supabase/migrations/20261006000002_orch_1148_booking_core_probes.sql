-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.1a — booking-core invariant probes (read-only)
-- ---------------------------------------------------------------------------
-- A read-only DO block (NO writes) asserting the 2.1a engine invariants are
-- physically present, so a future migration that drops/weakens them trips this
-- probe (fails-on-revert at the DB layer). Runs LAST in the 2.1a version order.
-- SPEC §5.4 (the 2.1a engine slice; the lifecycle/history/SMS probe rows belong
-- to 2.1b and are NOT asserted here).
--
-- Fails-on-revert anchors:
--   I-PROPOSED-1148-AVAILABILITY-ENGINE-SOLE-SLOT-SOURCE
--   I-PROPOSED-1148-CAPACITY-RULE-ENFORCED-SERVER-SIDE
--
-- MONOTONIC VERSION 20261006000002. Apply via the Supabase Management API.
-- ===========================================================================

BEGIN;

DO $probe$
DECLARE
  v_oid       oid;
  v_result    text;
  v_args      text;
  v_acl       aclitem[];
  v_has_auth  boolean;
  v_has_anon  boolean;
  v_secdef    boolean;
BEGIN
  -- (1) pg_venue_available_slots exists with the EXACT arg types (uuid,date,int).
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'pg_venue_available_slots'
    AND pg_get_function_identity_arguments(p.oid) = 'p_brand_id uuid, p_date date, p_party_size integer'
  LIMIT 1;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'ORCH-1148 2.1a probe: pg_venue_available_slots(uuid,date,int) is missing or has the wrong arg signature';
  END IF;

  -- (2) It returns the 4 FROZEN-CONTRACT columns (slot_start_utc, slot_local_label,
  -- remaining, is_full). pg_get_function_result renders the TABLE(...) shape.
  v_result := pg_get_function_result(v_oid);
  IF position('slot_start_utc' in v_result) = 0
     OR position('slot_local_label' in v_result) = 0
     OR position('remaining' in v_result) = 0
     OR position('is_full' in v_result) = 0 THEN
    RAISE EXCEPTION 'ORCH-1148 2.1a probe: pg_venue_available_slots return shape is missing a frozen-contract column (got %)', v_result;
  END IF;

  -- (3) It is SECURITY DEFINER (prosecdef) — required so it reads across the
  -- brand's tables without per-table grants to the caller.
  SELECT p.prosecdef INTO v_secdef FROM pg_proc p WHERE p.oid = v_oid;
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'ORCH-1148 2.1a probe: pg_venue_available_slots must be SECURITY DEFINER';
  END IF;

  -- (4) GRANT BOUNDARY: EXECUTE to `authenticated`, NOT to `anon`/`public`.
  -- The anon grant is the ONLY 2.2 widening; if it appears in 2.1a the boundary
  -- has been crossed prematurely.
  SELECT p.proacl INTO v_acl FROM pg_proc p WHERE p.oid = v_oid;
  v_has_auth := EXISTS (
    SELECT 1 FROM aclexplode(v_acl) a
    WHERE a.grantee = 'authenticated'::regrole AND a.privilege_type = 'EXECUTE'
  );
  v_has_anon := EXISTS (
    SELECT 1 FROM aclexplode(v_acl) a
    WHERE a.grantee IN ('anon'::regrole, 0)  -- 0 = PUBLIC
      AND a.privilege_type = 'EXECUTE'
  );
  IF NOT v_has_auth THEN
    RAISE EXCEPTION 'ORCH-1148 2.1a probe: pg_venue_available_slots must GRANT EXECUTE to authenticated';
  END IF;
  IF v_has_anon THEN
    RAISE EXCEPTION 'ORCH-1148 2.1a probe: pg_venue_available_slots must NOT GRANT EXECUTE to anon/PUBLIC in 2.1a (that is the 2.2 consumer seam)';
  END IF;

  -- (5) CAPACITY-RULE-ENFORCED-SERVER-SIDE: party_fit is computed inside the
  -- engine. Assert the function body references the min_party/max_party party-fit
  -- predicate (so a revert that drops server-side party_fit trips the probe).
  IF position('min_party' in pg_get_functiondef(v_oid)) = 0
     OR position('max_party' in pg_get_functiondef(v_oid)) = 0 THEN
    RAISE EXCEPTION 'ORCH-1148 2.1a probe: the engine must enforce party_fit (min_party/max_party) server-side';
  END IF;

  -- (6) The engine query-path indexes exist (the §4.2 perf seam).
  IF to_regclass('public.reservations_brand_table_reserved_idx') IS NULL THEN
    RAISE EXCEPTION 'ORCH-1148 2.1a probe: reservations_brand_table_reserved_idx (engine overlap index) is missing';
  END IF;
  IF to_regclass('public.venue_capacity_rules_brand_kind_idx') IS NULL THEN
    RAISE EXCEPTION 'ORCH-1148 2.1a probe: venue_capacity_rules_brand_kind_idx (engine rule index) is missing';
  END IF;

  RAISE NOTICE 'ORCH-1148 2.1a invariant probe passed: engine present (uuid,date,int → 4-col contract), SECURITY DEFINER, authenticated-only grant (no anon), party_fit server-side, engine indexes present.';
END;
$probe$;

COMMIT;
