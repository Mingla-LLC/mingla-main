-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.1a — P3 fix invariant probes (read-only)
-- ---------------------------------------------------------------------------
-- A read-only DO block asserting the THREE engine defect fixes (P3-1/2/3) are
-- physically present in the engine body + schema, so a future migration that
-- reverts any of them trips this probe (fails-on-revert at the DB layer). Runs
-- after the engine v2 replacement. SPEC §Defects (TEST report).
--
-- Fails-on-revert anchors:
--   I-PROPOSED-1148-ENGINE-HETEROGENEOUS-TURN  (P3-1)
--   I-PROPOSED-1148-ENGINE-NO-OVER-SEAT        (P3-2)
--   I-PROPOSED-1148-ENGINE-DST-IANA-TZ         (P3-3)
--
-- MONOTONIC VERSION 20261008000002. Apply via the Supabase Management API.
-- ===========================================================================

BEGIN;

DO $p3probe$
DECLARE
  v_oid  oid;
  v_def  text;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'pg_venue_available_slots'
    AND pg_get_function_identity_arguments(p.oid) = 'p_brand_id uuid, p_date date, p_party_size integer'
  LIMIT 1;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'ORCH-1148 P3 probe: pg_venue_available_slots(uuid,date,int) is missing';
  END IF;
  v_def := pg_get_functiondef(v_oid);

  -- P3-1: the existing-reservation overlap window must use the reservation's OWN
  -- party-size turn (per-row lookup on r.party_size), NOT the querying turn. The
  -- shared helper must be called with r.party_size in the overlap subquery.
  IF position('pg_venue_turn_minutes_for_party(v_cfg.turn_times, r.party_size)' in v_def) = 0 THEN
    RAISE EXCEPTION 'ORCH-1148 P3-1 probe: the overlap window must use each existing reservation''s OWN turn (pg_venue_turn_minutes_for_party(..., r.party_size)); the heterogeneous-turn fix is missing/reverted';
  END IF;
  IF to_regprocedure('public.pg_venue_turn_minutes_for_party(jsonb, int)') IS NULL THEN
    RAISE EXCEPTION 'ORCH-1148 P3-1 probe: the shared per-party turn helper pg_venue_turn_minutes_for_party(jsonb,int) is missing';
  END IF;

  -- P3-2: party_fit must CLAMP the effective max party to the table capacity.
  IF position('LEAST(COALESCE(t.max_party, t.capacity), t.capacity)' in v_def) = 0 THEN
    RAISE EXCEPTION 'ORCH-1148 P3-2 probe: party_fit must clamp the effective max party to capacity (LEAST(COALESCE(max_party,capacity),capacity)); the over-seat guard is missing/reverted';
  END IF;
  -- And the un-clamped predicate must be GONE (it would re-introduce over-seat).
  IF position('p_party_size BETWEEN COALESCE(t.min_party, 1) AND COALESCE(t.max_party, t.capacity)' in v_def) > 0 THEN
    RAISE EXCEPTION 'ORCH-1148 P3-2 probe: the un-clamped party_fit predicate (COALESCE(max_party,capacity) without LEAST(...,capacity)) is still present — over-seat not fixed';
  END IF;

  -- P3-3: the engine must convert via the IANA timezone, NOT a static offset.
  IF position('AT TIME ZONE v_tz' in v_def) = 0 THEN
    RAISE EXCEPTION 'ORCH-1148 P3-3 probe: the engine must convert via the venue IANA timezone (AT TIME ZONE v_tz); the DST fix is missing/reverted';
  END IF;
  IF position('utc_offset_minutes' in v_def) > 0 THEN
    RAISE EXCEPTION 'ORCH-1148 P3-3 probe: the engine still references the static utc_offset_minutes — the DST static-offset path is not removed';
  END IF;

  -- P3-3 schema: the IANA tz column exists, NOT NULL, validated CHECK present.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'venue_availability_config'
      AND column_name = 'iana_timezone' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'ORCH-1148 P3-3 probe: venue_availability_config.iana_timezone (NOT NULL) is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'venue_availability_config_validate_tz' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'ORCH-1148 P3-3 probe: the iana_timezone write-time validation trigger is missing';
  END IF;

  RAISE NOTICE 'ORCH-1148 P3 fix probe passed: P3-1 per-row turn, P3-2 capacity clamp, P3-3 IANA-tz (static offset removed).';
END;
$p3probe$;

COMMIT;
