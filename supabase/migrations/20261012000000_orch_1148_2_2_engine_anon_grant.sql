-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.2a — ENGINE ANON-GRANT (THE KEYSTONE) ⭐
-- ---------------------------------------------------------------------------
-- 2.1a froze the truthful availability engine `pg_venue_available_slots` as
-- authenticated-only and pre-authored the EXACT seam for 2.2 at
-- 20261008000001 lines 295-298:
--     GRANT EXECUTE ON FUNCTION public.pg_venue_available_slots(uuid, date, int) TO anon;
-- This migration FLIPS that seam ON so the login-free anonymous buyer web (and
-- any anon-browsing app path) can see truthful open slots.
--
-- EXPOSURE VERDICT (SPEC §4.A.1 — the load-bearing safety check):
--   * The function is SECURITY DEFINER STABLE with SET search_path = public,
--     pg_temp and a FROZEN RETURNS TABLE of EXACTLY 4 columns:
--       (slot_start_utc timestamptz, slot_local_label text,
--        remaining int, is_full boolean)
--     — all AGGREGATE availability data; ZERO reservation PII (no guest
--     name/phone/email, no reservation/table ids, no other-brand rows).
--   * Internally it reads venue_reservation_settings / venue_availability_config
--     / venue_blackouts / venue_tables / reservations, but ONLY to gate on
--     reservations_enabled, compute candidate slots, and count(*) overlapping
--     LIVE reservations for `remaining`. The only thing derived from
--     `reservations` that ESCAPES the function is the integer remaining/is_full
--     — a count, not a row. NO reservation row leaves the function.
--   * Because the engine is SECURITY DEFINER, granting anon EXECUTE on the
--     ENGINE ALONE is sufficient: the body runs as the function OWNER, so its
--     reads of the locked-down tables and its internal call to the helper
--     pg_venue_turn_minutes_for_party(jsonb,int) execute under the owner's
--     privileges. anon NEVER needs (and must NOT get) direct EXECUTE on the
--     helper or direct SELECT on those tables. The 2.2a probe migration
--     (20261012000003) asserts the helper stays anon-REVOKE'd and the tables
--     stay anon-unreadable (defense-in-depth / least privilege).
--   * Inputs are (brand_id, date, party_size). An anon caller can enumerate
--     brand ids to probe availability — but availability IS public demand data
--     by design (the whole point of a public reserve page is to show open
--     tables). Brand-id is not a secret. VERDICT: SAFE to grant anon EXECUTE.
--
-- INVARIANT (DRAFT — orchestrator flips ACTIVE on CLOSE):
--   I-PROPOSED-1148-ENGINE-ANON-EXPOSES-ONLY-SLOTS — the anon-callable engine
--   returns EXACTLY the 4 availability columns and the helper + underlying
--   tables remain anon-unreadable. Fails-on-revert: 20261012000003 probe.
--
-- The ENGINE BODY is FROZEN — the ONLY change here is the anon GRANT. The
-- authenticated grant (from 20261008000001) is PRESERVED (this is additive,
-- not a re-REVOKE). Idempotent, additive, BEGIN/COMMIT. MONOTONIC VERSION
-- 20261012000000 (one above the 2.1b global max 20261011000001). Apply via the
-- Supabase Management API (never `supabase db push`).
-- ===========================================================================

BEGIN;

-- THE SEAM (2.1a 20261008000001:296). Availability is public-facing demand data;
-- exposes NO reservation PII — only slot times + remaining counts. The engine's
-- SECURITY DEFINER rights are the only path to the underlying tables; anon gets
-- NOTHING else (the helper + tables stay anon-REVOKE'd — see the 2.2a probe).
GRANT EXECUTE ON FUNCTION public.pg_venue_available_slots(uuid, date, int) TO anon;

-- DEFENSE-IN-DEPTH (least privilege): re-assert the helper stays anon-REVOKE'd
-- even though 20261008000003 already did this. A SECURITY DEFINER engine does
-- NOT need anon to reach the helper directly; the explicit revoke is the belt
-- so a future careless grant on the helper trips the probe.
REVOKE EXECUTE ON FUNCTION public.pg_venue_turn_minutes_for_party(jsonb, int) FROM anon;

COMMENT ON FUNCTION public.pg_venue_available_slots(uuid, date, int) IS
  'META-ORCH-1148 venue availability engine. SECURITY DEFINER, FROZEN 4-column return (slot_start_utc/slot_local_label/remaining/is_full) — aggregate availability ONLY, ZERO reservation PII. 2.2a grants anon EXECUTE (public demand data); the helper pg_venue_turn_minutes_for_party + the underlying venue_*/reservations tables stay anon-unreadable (definer-rights only). I-PROPOSED-1148-ENGINE-ANON-EXPOSES-ONLY-SLOTS.';

COMMIT;
