-- Migration: 20260311100004_fix_boards_rls_and_referral_credits.sql
-- Description: Two fixes:
-- 1. Extend boards RLS policies to include board_collaborators so all
--    session participants can access collaborative boards.
-- 2. Add missing updated_at column to referral_credits (the extended
--    trigger references it but it was never created).

-- ============================================================
-- 1. BOARDS RLS — grant collaborator access
-- ============================================================

-- SELECT: collaborators can view boards they participate in
DROP POLICY IF EXISTS "Users can view public boards and their own boards" ON public.boards;
CREATE POLICY "Users can view public boards and their own boards" ON public.boards
  FOR SELECT USING (
    is_public = true
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.board_collaborators
      WHERE board_id = boards.id AND user_id = auth.uid()
    )
  );

-- UPDATE: collaborators can update boards they participate in
DROP POLICY IF EXISTS "Users can update their own boards" ON public.boards;
CREATE POLICY "Users can update their own boards" ON public.boards
  FOR UPDATE USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.board_collaborators
      WHERE board_id = boards.id AND user_id = auth.uid()
    )
  );

-- DELETE: only board creator can delete (unchanged but re-stated for clarity)
DROP POLICY IF EXISTS "Users can delete their own boards" ON public.boards;
CREATE POLICY "Users can delete their own boards" ON public.boards
  FOR DELETE USING (auth.uid() = created_by);

-- INSERT: allow any authenticated user to create boards for themselves
-- (unchanged — auth.uid() = created_by)
DROP POLICY IF EXISTS "Users can create boards" ON public.boards;
CREATE POLICY "Users can create boards" ON public.boards
  FOR INSERT WITH CHECK (auth.uid() = created_by);

-- ============================================================
-- 2. REFERRAL_CREDITS — add missing updated_at column
-- ============================================================

ALTER TABLE public.referral_credits
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
