-- ORCH-0535 (bundled into ORCH-0532): Defense-in-depth — reject user-context INSERTs
-- into board_saved_cards. Only the check_mutual_like trigger (SECURITY DEFINER,
-- owned by postgres) or the service role may insert. Prevents any future client-side
-- regression from re-introducing the quorum-bypass bug that caused ORCH-0532.
--
-- Verified via Supabase MCP:
--   - check_mutual_like is SECURITY DEFINER owned by postgres
--   - current_user resolves to 'postgres' under SECURITY DEFINER
--   - PostgREST anon/authenticated connections have current_user IN ('anon','authenticated')
--   - service_role is only granted to edge functions and server-role callers
--
-- RLS contract verification:
--   - Authenticated client INSERT   → current_user='authenticated', auth.role()='authenticated' → REJECTED
--   - Anon client INSERT            → current_user='anon', auth.role()='anon'                   → REJECTED
--   - check_mutual_like trigger     → current_user='postgres'                                   → PASSES
--   - Edge function with service    → auth.role()='service_role'                                → PASSES
--
-- Other policies on board_saved_cards are unchanged:
--   - bsc_select (SELECT) — participants can read
--   - UPDATE policy — used by check_card_lock_in to flip is_locked
--   - DELETE policy — used by remove-card flow

DROP POLICY IF EXISTS "bsc_insert" ON public.board_saved_cards;

CREATE POLICY "bsc_insert_trigger_or_service_only" ON public.board_saved_cards
FOR INSERT WITH CHECK (
  current_user = 'postgres'
  OR auth.role() = 'service_role'
);

COMMENT ON POLICY "bsc_insert_trigger_or_service_only" ON public.board_saved_cards IS
  'ORCH-0535: INSERTs restricted to check_mutual_like trigger (SECURITY DEFINER, owner postgres) and service-role edge functions. User-context INSERTs are rejected. See ORCH-0532 root cause analysis at Mingla_Artifacts/outputs/INVESTIGATION_ORCH-0532_V2_REAUDIT.md.';

-- Rollback (if needed):
--   DROP POLICY IF EXISTS "bsc_insert_trigger_or_service_only" ON public.board_saved_cards;
--   CREATE POLICY "bsc_insert" ON public.board_saved_cards
--   FOR INSERT WITH CHECK (
--     saved_by = auth.uid() AND is_session_participant(session_id, auth.uid())
--   );
