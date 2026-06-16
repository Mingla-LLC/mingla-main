-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.1a (Booking Core — Tables + Availability + Engine)
-- ---------------------------------------------------------------------------
-- Engine query-path indexes (the perf seam 2.0 left). SPEC §4.2.
--
-- 2.0 laid reservations(brand_id, reserved_for) + (brand_id, status). The
-- availability engine (pg_venue_available_slots, …3) also needs to:
--   (a) subtract already-booked reservations for a date window + table, where
--       ONLY live bookings consume a seat → a partial index on the live
--       statuses, and
--   (b) read the 3 active capacity-rule kinds per brand.
--
-- Additive-only (CREATE INDEX IF NOT EXISTS). No table/RLS change. The other
-- index seams the engine touches (venue_tables partial-active, venue_blackouts
-- (brand_id,date_start,date_end), venue_availability_config UNIQUE(brand_id))
-- ALREADY exist from 2.0 — NOT recreated here.
--
-- MONOTONIC VERSION: 20261006000000 is strictly greater than the current global
-- max across anchor main + all sibling worktrees:
--   2.0 venue suite  20261003000000..07
--   ORCH-1150        20261004000000 / 000001
--   ORCH-1138        20261005000000
-- Re-confirm at IMPLEMENT by scanning supabase/migrations/ + ~/Desktop/
-- mingla-orchs/*/. DO NOT run `supabase db push`; the orchestrator applies via
-- the Supabase Management API after REVIEW (CLI drift-wedged; MCP read-only).
-- ===========================================================================

BEGIN;

-- (a) The engine's overlap probe: only live bookings (requested/confirmed/
-- seated) consume a table at a slot. A partial index keyed by
-- (brand_id, table_id, reserved_for) makes the per-slot overlap subtraction a
-- range scan instead of a brand-wide seq scan.
CREATE INDEX IF NOT EXISTS reservations_brand_table_reserved_idx
  ON public.reservations (brand_id, table_id, reserved_for)
  WHERE status IN ('requested', 'confirmed', 'seated');

-- (b) The engine reads the active capacity-rule kinds per brand (party_fit /
-- deposit_threshold / blackout_scope in the 2.1 MVP).
CREATE INDEX IF NOT EXISTS venue_capacity_rules_brand_kind_idx
  ON public.venue_capacity_rules (brand_id, kind)
  WHERE is_active;

COMMIT;
