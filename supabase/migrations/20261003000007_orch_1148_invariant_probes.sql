-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.0 — invariant probes (read-only DB assertion)
-- ---------------------------------------------------------------------------
-- A read-only DO block (NO writes) that asserts the 2.0 invariants are
-- physically present, so a future migration that drops/weakens them trips this
-- probe (fails-on-revert at the DB layer). Runs LAST in the version order.
--
-- Fails-on-revert anchor: I-PROPOSED-1148-RESERVATIONS-RLS-BRAND-SCOPED.
--
-- MONOTONIC VERSION 20261003000007. Apply via the Supabase Management API.
-- ===========================================================================

BEGIN;

DO $probe$
DECLARE
  v_tbl text;
  v_tables text[] := ARRAY[
    'venue_tables',
    'venue_capacity_rules',
    'venue_availability_config',
    'venue_blackouts',
    'venue_reservation_settings',
    'reservations',
    'venue_waitlist'
  ];
  v_status_def text;
  v_default text;
BEGIN
  -- (1) All 7 tables exist.
  FOREACH v_tbl IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_tbl) IS NULL THEN
      RAISE EXCEPTION 'ORCH-1148 probe: table public.% is missing', v_tbl;
    END IF;

    -- (2) RLS enabled on all 7.
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_tbl AND c.relrowsecurity = true
    ) THEN
      RAISE EXCEPTION 'ORCH-1148 probe: RLS is not enabled on public.%', v_tbl;
    END IF;

    -- (5) Each table has the member-read policy AND the manager-plus write policy.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_tbl
        AND policyname = v_tbl || ' brand member can read'
    ) THEN
      RAISE EXCEPTION 'ORCH-1148 probe: member-read policy missing on public.%', v_tbl;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_tbl
        AND policyname = v_tbl || ' manager plus can write'
    ) THEN
      RAISE EXCEPTION 'ORCH-1148 probe: manager-plus write policy missing on public.%', v_tbl;
    END IF;
  END LOOP;

  -- (3) venue_reservation_settings.reservations_enabled exists, boolean, default false.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'venue_reservation_settings'
      AND column_name = 'reservations_enabled'
      AND data_type = 'boolean'
  ) THEN
    RAISE EXCEPTION 'ORCH-1148 probe: venue_reservation_settings.reservations_enabled missing or not boolean';
  END IF;
  SELECT column_default INTO v_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'venue_reservation_settings'
    AND column_name = 'reservations_enabled';
  IF v_default IS NULL OR position('false' in v_default) = 0 THEN
    RAISE EXCEPTION 'ORCH-1148 probe: venue_reservation_settings.reservations_enabled default is not false (got %)', v_default;
  END IF;

  -- (4) reservations.status CHECK contains all 8 enum values.
  -- Disambiguate the `status` lifecycle CHECK from the `payment_status` CHECK:
  -- both constraintdefs contain the substring 'status', so an ambiguous
  -- ILIKE '%status%' match could non-deterministically pick the payment_status
  -- CHECK and cause a false RAISE that aborts the apply. We anchor on
  -- lifecycle-only values ('requested' + 'seated' + 'completed') that can NEVER
  -- appear in payment_status's ('none','paid','refunded') CHECK, and LIMIT 1
  -- defensively. Read-only.
  SELECT pg_get_constraintdef(con.oid) INTO v_status_def
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'reservations'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%''requested''%'
    AND pg_get_constraintdef(con.oid) ILIKE '%''seated''%'
    AND pg_get_constraintdef(con.oid) ILIKE '%''completed''%'
  LIMIT 1;
  IF v_status_def IS NULL THEN
    RAISE EXCEPTION 'ORCH-1148 probe: reservations.status CHECK constraint not found';
  END IF;
  IF position('requested' in v_status_def) = 0
     OR position('confirmed' in v_status_def) = 0
     OR position('seated' in v_status_def) = 0
     OR position('completed' in v_status_def) = 0
     OR position('no_show' in v_status_def) = 0
     OR position('cancelled_by_guest' in v_status_def) = 0
     OR position('cancelled_by_venue' in v_status_def) = 0
     OR position('waitlisted' in v_status_def) = 0 THEN
    RAISE EXCEPTION 'ORCH-1148 probe: reservations.status CHECK is missing one of the 8 lifecycle states (got %)', v_status_def;
  END IF;

  RAISE NOTICE 'ORCH-1148 invariant probe passed: 7 tables present, RLS enabled, policies present, toggle default false, 8-state lifecycle intact.';
END;
$probe$;

COMMIT;
