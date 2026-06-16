-- META-ORCH-1148 2.1a — least-privilege: explicitly revoke anon EXECUTE on the
-- availability turn-time helper. The function is IMMUTABLE (pure arithmetic over
-- its args, no table access → no data exposure), and 20261008000001 already does
-- REVOKE ALL ... FROM PUBLIC, but Supabase's public-schema default privileges
-- auto-GRANT EXECUTE to `anon` separately from PUBLIC, so the explicit revoke is
-- required to keep the helper authenticated-only — mirroring the main engine
-- pg_venue_available_slots (which carries the same explicit anon REVOKE).
-- Additive, idempotent. EXIT: permanent (least-privilege invariant for the
-- venue availability engine family; see I-PROPOSED-1148-RESERVATIONS-RLS-BRAND-SCOPED).
REVOKE EXECUTE ON FUNCTION public.pg_venue_turn_minutes_for_party(jsonb, int) FROM anon;
