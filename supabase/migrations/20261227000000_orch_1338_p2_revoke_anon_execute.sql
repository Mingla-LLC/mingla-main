-- ORCH-1338 [guest-read-backend] P2 amendment — defense-in-depth REVOKE for the
-- two authed-only RPCs of META-ORCH-1337 [social-proof-guest-list].
--
-- WHY THIS MIGRATION EXISTS (the default-privileges footgun):
-- Supabase projects carry `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON
-- FUNCTIONS TO anon, authenticated, service_role` — so EVERY `CREATE FUNCTION`
-- lands with a direct per-ROLE `anon=X` ACL entry in pg_proc.proacl, on top of
-- the implicit PUBLIC grant. The applied migrations 20261225000000 (ORCH-1338,
-- peer_list_event_guests) and 20261226000000 (ORCH-1339,
-- biz_set_event_guest_privacy) each ran `REVOKE ALL ... FROM PUBLIC` — but a
-- PUBLIC revoke does NOT strip a direct role grant, so `anon` retained EXECUTE
-- on both authed-only functions. Proven live on prod by the tester
-- (TEST_META-ORCH-1337_SOCIAL_PROOF_GUEST_LIST.md §5 P2-1):
--   has_function_privilege('anon', 'public.peer_list_event_guests(uuid,integer,integer)', 'EXECUTE') = true
--   has_function_privilege('anon', 'public.biz_set_event_guest_privacy(uuid,boolean,boolean)', 'EXECUTE') = true
-- No exposure occurred — the in-function `authentication_required` guards held
-- (zero rows / zero writes crossed the wire) — but the grant layer was NOT the
-- barrier the ORCH-1338 impl report §10 claimed. This migration restores the
-- intended two-layer defense and makes the grants explicit + idempotent.
--
-- Do NOT edit the applied 20261225000000 / 20261226000000 files — they are on
-- prod's migration history. This is a NEW, strictly-later version.
--
-- RETEST (tester P2-1): after apply, both
--   has_function_privilege('anon', ..., 'EXECUTE')  →  false.
--
-- Deliberately untouched: pg_public_social_proof(uuid) keeps its intentional
-- anon grant (it is the anon-facing FN-A); service_role's default-privileges
-- EXECUTE on the two functions below is left intact (trusted key, bypasses
-- RLS; the originals never managed it).
--
-- SAFE-MIGRATION PROTOCOL: grants-only DDL (no CREATE/DROP FUNCTION, no table
-- DDL, no RLS change); idempotent — REVOKE/GRANT re-runs are no-ops; NOTIFY
-- pgrst at the end.
--
-- DO NOT auto-apply — orchestrator/Seth applies at SHIP.

BEGIN;

-- ORCH-1338 FN-B — authed-only guest list read.
REVOKE EXECUTE ON FUNCTION public.peer_list_event_guests(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peer_list_event_guests(uuid, integer, integer) TO authenticated;

-- ORCH-1339 write RPC — host-gated guest-privacy leaf write.
REVOKE EXECUTE ON FUNCTION public.biz_set_event_guest_privacy(uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_set_event_guest_privacy(uuid, boolean, boolean) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
