-- Migration: 20260312000003_fix_board_collaborators_rls_recursion.sql
-- Purpose:
--   CRIT-001: The SELECT and DELETE policies on board_collaborators self-reference the
--             same table, causing PostgreSQL to throw "infinite recursion detected in policy"
--             on every non-admin SELECT or DELETE. Fixed with two SECURITY DEFINER helper
--             functions that bypass RLS when called from within an RLS context.
--   CRIT-002: cleanup_stale_push_tokens was SECURITY DEFINER without SET search_path,
--             exposing a search_path hijack vector. Fixed with one-line addition.
-- =============================================================================

-- ── CRIT-002: Patch cleanup_stale_push_tokens to add SET search_path ─────────
-- A SECURITY DEFINER function without a fixed search_path is vulnerable to schema
-- injection. Adding SET search_path = public, pg_temp is the standard mitigation.
CREATE OR REPLACE FUNCTION public.cleanup_stale_push_tokens()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.user_push_tokens
  WHERE updated_at < NOW() - INTERVAL '90 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Permissions unchanged — only service_role and postgres (cron) may call this.
REVOKE ALL ON FUNCTION public.cleanup_stale_push_tokens() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_push_tokens() TO service_role;

-- ── CRIT-001: SECURITY DEFINER helper functions ───────────────────────────────
-- PostgreSQL evaluates RLS USING expressions by re-querying the same table, which
-- triggers the same policy again — infinite recursion. SECURITY DEFINER functions
-- execute as the function owner (postgres), bypassing RLS entirely. This breaks
-- the cycle without granting users elevated privileges on any other table.

-- is_board_collaborator: returns TRUE if uid is any collaborator on board_uuid.
-- Used by the SELECT policy.
CREATE OR REPLACE FUNCTION public.is_board_collaborator(board_uuid UUID, uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.board_collaborators
    WHERE board_id = board_uuid
      AND user_id = uid
  );
$$;

REVOKE ALL ON FUNCTION public.is_board_collaborator(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_board_collaborator(UUID, UUID) TO authenticated;

-- is_board_collaborator_as_owner: returns TRUE if uid is the OWNER on board_uuid.
-- Used by the DELETE policy owner-override check.
CREATE OR REPLACE FUNCTION public.is_board_collaborator_as_owner(board_uuid UUID, uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.board_collaborators
    WHERE board_id = board_uuid
      AND user_id = uid
      AND role = 'owner'
  );
$$;

REVOKE ALL ON FUNCTION public.is_board_collaborator_as_owner(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_board_collaborator_as_owner(UUID, UUID) TO authenticated;

-- ── CRIT-001: Rewrite the two self-referential policies ──────────────────────
-- Drop the broken policies and recreate them using the helper functions above.

DROP POLICY IF EXISTS "Collaborators can view board collaborators"
  ON public.board_collaborators;

CREATE POLICY "Collaborators can view board collaborators"
  ON public.board_collaborators FOR SELECT
  USING (public.is_board_collaborator(board_id, auth.uid()));

DROP POLICY IF EXISTS "Collaborators can delete their own row or owner can delete any"
  ON public.board_collaborators;

CREATE POLICY "Collaborators can delete their own row or owner can delete any"
  ON public.board_collaborators FOR DELETE
  USING (
    auth.uid() = user_id
    OR public.is_board_collaborator_as_owner(board_id, auth.uid())
  );
