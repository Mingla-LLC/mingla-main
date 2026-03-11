-- Migration: 20260311100004_fix_boards_rls_and_referral_credits.sql
-- Description: Two fixes:
-- 1. Extend boards RLS policies so session participants can access
--    collaborative boards (via collaboration_sessions.board_id →
--    session_participants).
-- 2. Add missing updated_at column to referral_credits (the extended
--    trigger references it but it was never created).

-- ============================================================
-- 1. BOARDS RLS — grant session participant access
-- ============================================================

-- SELECT: session participants can view boards linked to their sessions
DROP POLICY IF EXISTS "Users can view public boards and their own boards" ON public.boards;
CREATE POLICY "Users can view public boards and their own boards" ON public.boards
  FOR SELECT USING (
    is_public = true
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.collaboration_sessions cs
      JOIN public.session_participants sp ON sp.session_id = cs.id
      WHERE cs.board_id = boards.id
        AND sp.user_id = auth.uid()
        AND sp.has_accepted = true
    )
  );

-- UPDATE: session participants can update boards linked to their sessions
DROP POLICY IF EXISTS "Users can update their own boards" ON public.boards;
CREATE POLICY "Users can update their own boards" ON public.boards
  FOR UPDATE USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.collaboration_sessions cs
      JOIN public.session_participants sp ON sp.session_id = cs.id
      WHERE cs.board_id = boards.id
        AND sp.user_id = auth.uid()
        AND sp.has_accepted = true
    )
  );

-- DELETE: only board creator can delete (unchanged)
DROP POLICY IF EXISTS "Users can delete their own boards" ON public.boards;
CREATE POLICY "Users can delete their own boards" ON public.boards
  FOR DELETE USING (auth.uid() = created_by);

-- INSERT: any authenticated user can create boards for themselves (unchanged)
DROP POLICY IF EXISTS "Users can create boards" ON public.boards;
CREATE POLICY "Users can create boards" ON public.boards
  FOR INSERT WITH CHECK (auth.uid() = created_by);

-- ============================================================
-- 2. REFERRAL_CREDITS — add missing updated_at column
-- ============================================================

ALTER TABLE public.referral_credits
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
