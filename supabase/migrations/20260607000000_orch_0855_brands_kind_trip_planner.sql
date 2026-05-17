-- ORCH-0855 — Tr1 Trip Planner Brand Onboarding: widen brands.kind to admit 'trip_planner'.
--
-- Pre-state (verified live 2026-05-17 via MCP execute_sql):
--   brands_kind_check = CHECK ((kind = ANY (ARRAY['physical'::text, 'popup'::text])))
--   Live row count by kind: 12 popup, 0 physical, 0 trip_planner.
-- Post-state:
--   brands_kind_check = CHECK ((kind = ANY (ARRAY['physical'::text, 'popup'::text, 'trip_planner'::text])))
--
-- RLS: zero policies on public.brands reference kind (verified via pg_policy probe).
--      Migration is fully RLS-transparent -- no policy changes needed.
-- Data backfill: not needed (no existing rows have or need 'trip_planner').
-- Revert: DROP CONSTRAINT brands_kind_check; ADD CONSTRAINT brands_kind_check CHECK (kind IN ('physical','popup'));
--
-- Per I-1.2-BRAND-AS-CONTAINER (PROJECT_SPEC §54): kind is starting identity, NOT capability gate.
-- Per DEC-4 (project spec §8): Stripe Connect doubles as identity proof for trip planners
--   (no admin phone-callback flow needed).
--
-- Spec: Mingla_Artifacts/specs/SPEC_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md §4.1
-- Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md

BEGIN;

ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS brands_kind_check;

ALTER TABLE public.brands
  ADD CONSTRAINT brands_kind_check
  CHECK (kind IN ('physical', 'popup', 'trip_planner'));

COMMENT ON COLUMN public.brands.kind IS
  'Mingla Business 1.2: physical=owns/leases venue (Ve1+); popup=organizer w/o fixed venue (today''s default); trip_planner=multi-day trips with Stripe-required identity (Tr1+). Per I-1.2-BRAND-AS-CONTAINER, kind is starting identity only — any brand can author any offering type via the universal "+" creator.';

-- Self-verification probe: confirm the constraint is in place and admits all 3 values.
DO $$
DECLARE
  constraint_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO constraint_def
  FROM pg_constraint
  WHERE conrelid = 'public.brands'::regclass AND conname = 'brands_kind_check';

  IF constraint_def IS NULL THEN
    RAISE EXCEPTION 'ORCH-0855 migration: brands_kind_check was not created';
  END IF;

  IF position('trip_planner' IN constraint_def) = 0 THEN
    RAISE EXCEPTION 'ORCH-0855 migration: brands_kind_check does not admit ''trip_planner'' -- got: %', constraint_def;
  END IF;

  IF position('physical' IN constraint_def) = 0 OR position('popup' IN constraint_def) = 0 THEN
    RAISE EXCEPTION 'ORCH-0855 migration: brands_kind_check dropped a legacy kind -- got: %', constraint_def;
  END IF;

  RAISE NOTICE 'ORCH-0855 migration complete: brands_kind_check widened to (physical, popup, trip_planner)';
END $$;

COMMIT;
