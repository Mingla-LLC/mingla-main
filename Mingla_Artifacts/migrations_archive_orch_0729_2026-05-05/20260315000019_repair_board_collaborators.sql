-- Migration: 20260315000019_repair_board_collaborators.sql
-- Purpose: Repair migration for board_collaborators table.
--   Migration 20260312000001 was recorded as applied but the table was never
--   actually created in the remote database (PostgREST returns PGRST205).
--   All statements here are idempotent — safe to run whether the original
--   DDL partially executed or not.

-- ── 1. Create the table (IF NOT EXISTS) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.board_collaborators (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id      UUID        NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT        NOT NULL DEFAULT 'collaborator'
                            CHECK (role IN ('owner', 'collaborator')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (board_id, user_id)
);

-- ── 2. Indexes (IF NOT EXISTS) ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_board_collaborators_board_id
  ON public.board_collaborators(board_id);

CREATE INDEX IF NOT EXISTS idx_board_collaborators_user_id
  ON public.board_collaborators(user_id);

-- ── 3. Enable RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.board_collaborators ENABLE ROW LEVEL SECURITY;

-- ── 4. Helper functions (CREATE OR REPLACE — idempotent) ────────────────────
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

-- ── 5. RLS Policies (drop-if-exists + create — idempotent) ──────────────────
-- SELECT: use helper function to avoid infinite recursion
DROP POLICY IF EXISTS "Collaborators can view board collaborators"
  ON public.board_collaborators;

CREATE POLICY "Collaborators can view board collaborators"
  ON public.board_collaborators FOR SELECT
  USING (public.is_board_collaborator(board_id, auth.uid()));

-- INSERT: session membership is the gate (accepting user inserts rows for all
-- participants including the creator, so auth.uid() = user_id would block owner rows)
DROP POLICY IF EXISTS "Session participants can insert board collaborators"
  ON public.board_collaborators;

CREATE POLICY "Session participants can insert board collaborators"
  ON public.board_collaborators FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.collaboration_sessions cs
      JOIN public.session_participants sp
        ON sp.session_id = cs.id
      WHERE cs.board_id = board_collaborators.board_id
        AND sp.user_id = auth.uid()
        AND sp.has_accepted = TRUE
    )
  );

-- UPDATE: only the collaborator themselves can update their own row
DROP POLICY IF EXISTS "Collaborators can update their own row"
  ON public.board_collaborators;

CREATE POLICY "Collaborators can update their own row"
  ON public.board_collaborators FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE: self-remove or owner can remove anyone (uses helper to avoid recursion)
DROP POLICY IF EXISTS "Collaborators can delete their own row or owner can delete any"
  ON public.board_collaborators;

CREATE POLICY "Collaborators can delete their own row or owner can delete any"
  ON public.board_collaborators FOR DELETE
  USING (
    auth.uid() = user_id
    OR public.is_board_collaborator_as_owner(board_id, auth.uid())
  );
