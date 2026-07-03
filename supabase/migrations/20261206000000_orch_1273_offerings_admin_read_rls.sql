-- ORCH-1273 [Admin Offerings console — READ-ONLY] — offerings admin-read RLS.
--
-- Adds an is_admin_user() SELECT RLS policy to the 14 offerings / venue-config
-- tables the admin console reads directly through the browser (anon key + admin
-- JWT), per the ORCH-1271 §3 read-authz rule (whole-row single-table display
-- (NB: SPEC prose says "13" but enumerates 14 named tables — the "13" is an
--  arithmetic miscount; all 14 enumerated tables are implemented.)
-- reads → an is_admin_user() SELECT RLS policy mirroring the already-shipped
-- "brands admin can read" / "venue_listings admin can read" exemplars):
--   * events                       — base offering table (incl. DRAFT/PRIVATE/soft-deleted/cross-brand rows)
--   * event_dates                  — master + all schedule rows
--   * ticket_types                 — standard-event / trip pricing tiers
--   * trip_days                    — trip itinerary
--   * trip_pricing_tiers           — trip pricing tiers
--   * trip_inclusions              — trip included / excluded lists
--   * trip_intake_schemas          — trip per-tier intake forms
--   * experience_stops             — experience itinerary stops
--   * experience_feedback          — experience feedback (display; card_id-keyed)
--   * venue_reservation_settings   — venue reservation config
--   * venue_capacity_rules         — venue capacity rules
--   * venue_tables                 — venue tables
--   * venue_blackouts              — venue blackout windows
--   * venue_waitlist               — venue waitlist
--
-- INTENTIONALLY NOT ADDED (PII/money — reachable ONLY via the guard-first definer
-- read-RPCs in the sibling migration, which SELECT a fixed shaped column set):
--   orders, order_line_items, tickets, order_installments, event_rsvps,
--   event_rsvp_guests, reservations. Stricter than a blanket admin SELECT; the
--   correct default for a support console (SPEC §5 "PII posture").
--
-- REUSED, NOT TOUCHED: venue_listings ("venue_listings admin can read") + brands
-- ("brands admin can read") already carry is_admin_user() SELECT policies
-- [verified live]. This migration adds NONE to them.
--
-- Single admin gate: public.is_admin_user() only — never account_type='admin'
-- (preserves I-PROPOSED-1271-ADMIN-SINGLE-GATE). DROP-then-CREATE keeps the apply
-- idempotent + re-runnable (matches the 1271 flip + the brands/venue_listings
-- admin-read policies + the 1272 identity RLS). SELECT-only forever — every
-- wave-2 edit ships its OWN write RLS / definer write RPC (SPEC §6), never by
-- loosening these into write policies.
--
-- Enforces: I-PROPOSED-1273-OFFERINGS-ADMIN-READ-CROSSBRAND,
--           I-PROPOSED-1273-OFFERINGS-READ-ONLY.

--------------------------------------------------------------------------------
-- 1. events — admin can read every offering, incl. DRAFT / PRIVATE / soft-deleted
--    / cross-brand rows (the whole point of the console — no silent-empty read).
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "events admin can read" ON public.events;
CREATE POLICY "events admin can read"
  ON public.events
  FOR SELECT
  USING (public.is_admin_user());

--------------------------------------------------------------------------------
-- 2. event_dates — admin can read any offering's schedule (master + overrides).
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "event_dates admin can read" ON public.event_dates;
CREATE POLICY "event_dates admin can read"
  ON public.event_dates
  FOR SELECT
  USING (public.is_admin_user());

--------------------------------------------------------------------------------
-- 3. ticket_types — admin can read any offering's tiers (incl. soft-deleted).
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "ticket_types admin can read" ON public.ticket_types;
CREATE POLICY "ticket_types admin can read"
  ON public.ticket_types
  FOR SELECT
  USING (public.is_admin_user());

--------------------------------------------------------------------------------
-- 4. trip_days — admin can read any trip's itinerary.
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "trip_days admin can read" ON public.trip_days;
CREATE POLICY "trip_days admin can read"
  ON public.trip_days
  FOR SELECT
  USING (public.is_admin_user());

--------------------------------------------------------------------------------
-- 5. trip_pricing_tiers — admin can read any trip's pricing tiers.
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "trip_pricing_tiers admin can read" ON public.trip_pricing_tiers;
CREATE POLICY "trip_pricing_tiers admin can read"
  ON public.trip_pricing_tiers
  FOR SELECT
  USING (public.is_admin_user());

--------------------------------------------------------------------------------
-- 6. trip_inclusions — admin can read any trip's included / excluded lists.
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "trip_inclusions admin can read" ON public.trip_inclusions;
CREATE POLICY "trip_inclusions admin can read"
  ON public.trip_inclusions
  FOR SELECT
  USING (public.is_admin_user());

--------------------------------------------------------------------------------
-- 7. trip_intake_schemas — admin can read any trip's per-tier intake schemas.
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "trip_intake_schemas admin can read" ON public.trip_intake_schemas;
CREATE POLICY "trip_intake_schemas admin can read"
  ON public.trip_intake_schemas
  FOR SELECT
  USING (public.is_admin_user());

--------------------------------------------------------------------------------
-- 8. experience_stops — admin can read any experience's stops.
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "experience_stops admin can read" ON public.experience_stops;
CREATE POLICY "experience_stops admin can read"
  ON public.experience_stops
  FOR SELECT
  USING (public.is_admin_user());

--------------------------------------------------------------------------------
-- 9. experience_feedback — admin can read experience feedback (display).
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "experience_feedback admin can read" ON public.experience_feedback;
CREATE POLICY "experience_feedback admin can read"
  ON public.experience_feedback
  FOR SELECT
  USING (public.is_admin_user());

--------------------------------------------------------------------------------
-- 10. venue_reservation_settings — admin can read any venue's reservation config.
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "venue_reservation_settings admin can read" ON public.venue_reservation_settings;
CREATE POLICY "venue_reservation_settings admin can read"
  ON public.venue_reservation_settings
  FOR SELECT
  USING (public.is_admin_user());

--------------------------------------------------------------------------------
-- 11. venue_capacity_rules — admin can read any venue's capacity rules.
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "venue_capacity_rules admin can read" ON public.venue_capacity_rules;
CREATE POLICY "venue_capacity_rules admin can read"
  ON public.venue_capacity_rules
  FOR SELECT
  USING (public.is_admin_user());

--------------------------------------------------------------------------------
-- 12. venue_tables — admin can read any venue's tables.
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "venue_tables admin can read" ON public.venue_tables;
CREATE POLICY "venue_tables admin can read"
  ON public.venue_tables
  FOR SELECT
  USING (public.is_admin_user());

--------------------------------------------------------------------------------
-- 13. venue_blackouts — admin can read any venue's blackout windows.
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "venue_blackouts admin can read" ON public.venue_blackouts;
CREATE POLICY "venue_blackouts admin can read"
  ON public.venue_blackouts
  FOR SELECT
  USING (public.is_admin_user());

--------------------------------------------------------------------------------
-- 14. venue_waitlist — admin can read any venue's waitlist.
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "venue_waitlist admin can read" ON public.venue_waitlist;
CREATE POLICY "venue_waitlist admin can read"
  ON public.venue_waitlist
  FOR SELECT
  USING (public.is_admin_user());

--------------------------------------------------------------------------------
-- Self-assert: apply FAILS unless all 13 new policies exist AND are SELECT-only
-- (SPEC §9.1). Runtime-proves I-PROPOSED-1273-OFFERINGS-READ-ONLY (SELECT-only)
-- at apply time — a stray FOR ALL / FOR UPDATE policy under these names aborts.
--------------------------------------------------------------------------------
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'events','event_dates','ticket_types','trip_days','trip_pricing_tiers',
    'trip_inclusions','trip_intake_schemas','experience_stops','experience_feedback',
    'venue_reservation_settings','venue_capacity_rules','venue_tables',
    'venue_blackouts','venue_waitlist'
  ];
  v_select int;
  v_nonselect int;
BEGIN
  SELECT count(*) INTO v_select
  FROM pg_policies
  WHERE schemaname = 'public'
    AND cmd = 'SELECT'
    AND policyname = tablename || ' admin can read'
    AND tablename = ANY(v_tables);

  SELECT count(*) INTO v_nonselect
  FROM pg_policies
  WHERE schemaname = 'public'
    AND cmd <> 'SELECT'
    AND policyname = tablename || ' admin can read'
    AND tablename = ANY(v_tables);

  -- 14 = the enumerated table list (SPEC §5 + §9.1). NB: the SPEC prose says "13"
  -- but its own enumeration names 14 tables (events + event_dates + ticket_types
  -- + 4 trip + 2 experience + 5 venue-stack = 14); the "13" is an arithmetic
  -- miscount. All 14 are required — each backs a live read surface.
  IF v_select <> 14 THEN
    RAISE EXCEPTION 'ORCH-1273: expected 14 SELECT-only admin-read policies, found % SELECT', v_select;
  END IF;
  IF v_nonselect <> 0 THEN
    RAISE EXCEPTION 'ORCH-1273: found % non-SELECT policy(ies) named "<table> admin can read" — read RLS must be SELECT-only', v_nonselect;
  END IF;
END $$;
