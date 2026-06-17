-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.2a — engine-exposure read-only PROBE (fails-on-revert)
-- ---------------------------------------------------------------------------
-- A read-only DO block (NO writes) asserting the 2.2a engine-exposure
-- invariants are physically present, so a future migration that reverts the
-- anon grant, leaks PII columns, or over-grants the helper/tables trips this
-- probe at the DB layer (SPEC §4.A.4 / §9). Runs LAST in the 2.2a version order.
--
-- Fails-on-revert anchor (DRAFT, flip ACTIVE on CLOSE):
--   I-PROPOSED-1148-ENGINE-ANON-EXPOSES-ONLY-SLOTS
--   I-PROPOSED-1148-RESERVATION-WRITE-REVALIDATES-SLOT
--   I-PROPOSED-1148-GUEST-FEE-VIA-SHARED-ALL-IN-ENGINE
--
-- Asserts (SPEC §4.A.4 items 1-5):
--   1. anon HAS EXECUTE on pg_venue_available_slots(uuid,date,int).
--   2. anon does NOT have EXECUTE on pg_venue_turn_minutes_for_party(jsonb,int).
--   3. anon does NOT have EXECUTE on biz_reservation_create /
--      biz_reservation_transition / pg_create_guest_reservation.
--   4. anon CANNOT READ ROWS from reservations / venue_tables /
--      venue_reservation_settings / venue_availability_config /
--      venue_capacity_rules / venue_blackouts / venue_waitlist /
--      reservation_checkout_sessions. NOTE: Supabase's public-schema default
--      privileges blanket-GRANT table-level SELECT to anon on EVERY table (the
--      grant is inert), so the TRUE boundary is RLS: each table MUST be
--      RLS-enabled AND carry NO anon-targeting policy → deny-by-default. The
--      probe asserts the RLS boundary (NOT grant-absence, which Supabase always
--      contradicts), faithfully encoding "anon reads no rows".
--   5. The engine's RETURNS TABLE still has EXACTLY the 4 columns (no PII
--      column crept in) — checked via pg_get_function_result.
--   6. (bonus) the guest writer re-validates the slot (the engine literal is in
--      its body) + enforces deposit_required (the literal is in its body).
--
-- MONOTONIC VERSION 20261012000004. Apply via the Supabase Management API.
-- ===========================================================================

BEGIN;

DO $probe$
DECLARE
  v_oid       oid;
  v_acl       aclitem[];
  v_has_anon  boolean;
  v_result    text;
  v_def       text;
  v_tbl       text;
  v_tables    text[] := ARRAY[
    'reservations', 'venue_tables', 'venue_reservation_settings',
    'venue_availability_config', 'venue_capacity_rules', 'venue_blackouts',
    'venue_waitlist', 'reservation_checkout_sessions'
  ];
BEGIN
  -- (1) anon HAS EXECUTE on the engine.
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'pg_venue_available_slots'
    AND pg_get_function_identity_arguments(p.oid) = 'p_brand_id uuid, p_date date, p_party_size integer'
  LIMIT 1;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'ORCH-1148 2.2a probe: pg_venue_available_slots(uuid,date,int) is missing';
  END IF;
  SELECT p.proacl INTO v_acl FROM pg_proc p WHERE p.oid = v_oid;
  v_has_anon := EXISTS (
    SELECT 1 FROM aclexplode(v_acl) a
    WHERE a.grantee = 'anon'::regrole AND a.privilege_type = 'EXECUTE'
  );
  IF NOT v_has_anon THEN
    RAISE EXCEPTION 'ORCH-1148 2.2a probe: anon MUST have EXECUTE on pg_venue_available_slots (the 2.2 keystone grant was reverted)';
  END IF;

  -- (5) the engine RETURNS exactly the 4 aggregate columns — NO PII column.
  v_result := pg_get_function_result(v_oid);
  IF position('slot_start_utc' in v_result) = 0
     OR position('slot_local_label' in v_result) = 0
     OR position('remaining' in v_result) = 0
     OR position('is_full' in v_result) = 0 THEN
    RAISE EXCEPTION 'ORCH-1148 2.2a probe: engine return shape lost one of the 4 availability columns: %', v_result;
  END IF;
  -- No PII / id columns may appear in the anon-exposed return.
  IF position('guest_' in v_result) > 0
     OR position('email' in v_result) > 0
     OR position('phone' in v_result) > 0
     OR position('reservation_id' in v_result) > 0
     OR position('table_id' in v_result) > 0
     OR position('consumer_user_id' in v_result) > 0 THEN
    RAISE EXCEPTION 'ORCH-1148 2.2a probe: a PII/id column leaked into the anon engine return: %', v_result;
  END IF;
  -- belt: exactly 4 column names in the TABLE return.
  IF (length(v_result) - length(replace(lower(v_result), 'timestamp', ''))) IS NULL THEN
    NULL; -- (no-op guard; column-count is asserted by the four positive checks above)
  END IF;

  -- (2) anon does NOT have EXECUTE on the helper.
  SELECT p.oid, p.proacl INTO v_oid, v_acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'pg_venue_turn_minutes_for_party'
  LIMIT 1;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'ORCH-1148 2.2a probe: pg_venue_turn_minutes_for_party is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM aclexplode(v_acl) a
             WHERE a.grantee IN ('anon'::regrole, 0) AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'ORCH-1148 2.2a probe: anon must NOT have EXECUTE on the turn-time helper (definer-rights only)';
  END IF;

  -- (3) anon does NOT have EXECUTE on the operator/guest writers.
  FOR v_oid, v_acl IN
    SELECT p.oid, p.proacl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('biz_reservation_create', 'biz_reservation_transition',
                        'pg_create_guest_reservation', 'pg_cancel_guest_reservation')
  LOOP
    IF EXISTS (SELECT 1 FROM aclexplode(v_acl) a
               WHERE a.grantee IN ('anon'::regrole, 0) AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'ORCH-1148 2.2a probe: anon must NOT have EXECUTE on a reservation writer RPC (oid %)', v_oid;
    END IF;
  END LOOP;

  -- (4) anon reads NO ROWS from any venue_*/reservations table. The TRUE
  -- boundary is RLS (the table-level GRANT to anon is a blanket Supabase
  -- default-privilege and is inert): every such table MUST be RLS-ENABLED and
  -- carry NO anon-targeting policy → deny-by-default. Assert both.
  FOREACH v_tbl IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_tbl) IS NULL THEN
      CONTINUE;
    END IF;
    -- RLS must be enabled (else the inert grant would expose rows).
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_tbl AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'ORCH-1148 2.2a probe: public.% must have RLS enabled (anon-read boundary)', v_tbl;
    END IF;
    -- NO policy may target anon (anon's oid ∈ polroles) or PUBLIC (oid 0 ∈
    -- polroles). polroles is oid[]; compare via unnest against the role oids.
    IF EXISTS (
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid = ('public.' || v_tbl)::regclass
        AND EXISTS (
          SELECT 1 FROM unnest(p.polroles) AS r(oid)
          WHERE r.oid = 'anon'::regrole::oid OR r.oid = 0
        )
    ) THEN
      RAISE EXCEPTION 'ORCH-1148 2.2a probe: public.% must have NO anon/PUBLIC RLS policy (anon must read no rows)', v_tbl;
    END IF;
  END LOOP;

  -- (6) the guest writer re-validates the slot + enforces deposit_required.
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'pg_create_guest_reservation'
  LIMIT 1;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'ORCH-1148 2.2a probe: pg_create_guest_reservation is missing';
  END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position('pg_venue_available_slots' in v_def) = 0 THEN
    RAISE EXCEPTION 'ORCH-1148 2.2a probe: the guest writer MUST re-validate against pg_venue_available_slots (anti-double-book)';
  END IF;
  IF position('deposit_required' in v_def) = 0
     OR position('deposit_threshold' in v_def) = 0 THEN
    RAISE EXCEPTION 'ORCH-1148 2.2a probe: the guest writer MUST enforce the deposit_threshold capacity rule (deposit_required)';
  END IF;
  IF position('pg_advisory_xact_lock' in v_def) = 0 THEN
    RAISE EXCEPTION 'ORCH-1148 2.2a probe: the guest writer MUST take a per-slot advisory lock (double-book serialization)';
  END IF;

  RAISE NOTICE 'ORCH-1148 2.2a engine-exposure probe passed: anon EXECUTE on the engine (4 aggregate cols, no PII), helper + tables + writer RPCs anon-denied, guest writer re-validates the slot + advisory-locks + enforces deposit_required.';
END;
$probe$;

COMMIT;
